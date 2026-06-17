import { get, writable } from 'svelte/store'
import { authHeader, config } from './config.js'

export const connections = writable([])
export const connectionError = writable(null)
// Live polling state — exposed so the header can render a pause/resume
// affordance and so other surfaces can dim themselves when we're not
// fetching.
export const polling = writable(true)

let timer = null

// Relative path — Vite dev server proxies /rest/* to the router (see vite.config.js).
// cache: 'no-store' is load-bearing: RouterOS doesn't set Cache-Control on
// REST responses, so without it the browser will happily serve the first
// poll's body for every subsequent identical-URL fetch. Connection counts
// looked frozen because they literally were — the cached response, not
// the router, was answering.
async function fetchTable(path) {
  const res = await fetch(path, {
    headers: { Authorization: authHeader() },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`${res.status}`)
  const list = await res.json()
  return Array.isArray(list) ? list : []
}

// IPv4 and IPv6 conntrack live at separate REST endpoints. We poll both
// concurrently and merge into one list. allSettled (not all) is deliberate:
// many home routers run with IPv6 disabled or the firewall package
// missing, in which case the v6 endpoint 4xxs. v4 should keep rendering.
async function fetchOnce() {
  const [v4, v6] = await Promise.allSettled([
    fetchTable('/rest/ip/firewall/connection'),
    fetchTable('/rest/ipv6/firewall/connection'),
  ])
  const out = []
  const errs = []
  if (v4.status === 'fulfilled') out.push(...v4.value)
  else errs.push(`v4: ${v4.reason.message}`)
  if (v6.status === 'fulfilled') out.push(...v6.value)
  else errs.push(`v6: ${v6.reason.message}`)
  if (v4.status === 'rejected' && v6.status === 'rejected') {
    throw new Error(errs.join(' · '))
  }
  return { list: out, partialError: errs.length > 0 ? errs.join(' · ') : null }
}

export function startPolling() {
  if (timer) return
  const tick = async () => {
    try {
      const { list, partialError } = await fetchOnce()
      connections.set(list)
      connectionError.set(partialError)
    } catch (err) {
      connectionError.set(err.message)
    }
  }
  tick()
  timer = setInterval(tick, config.pollIntervalMs)
}

export function stopPolling() {
  if (timer) clearInterval(timer)
  timer = null
}

// Toggle live polling. When resuming we kick off an immediate tick via
// startPolling so the UI doesn't have to wait a full interval to refresh.
export function togglePolling() {
  const next = !get(polling)
  polling.set(next)
  if (next) startPolling()
  else stopPolling()
}
