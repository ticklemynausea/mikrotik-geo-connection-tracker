import { writable } from 'svelte/store'
import { authHeader, config } from './config.js'

export const connections = writable([])
export const connectionError = writable(null)

let timer = null

async function fetchOnce() {
  // Relative path — Vite dev server proxies /rest/* to the router (see vite.config.js).
  const res = await fetch('/rest/ip/firewall/connection', {
    headers: { Authorization: authHeader() },
  })
  if (!res.ok) throw new Error(`Mikrotik responded ${res.status}`)
  return res.json()
}

export function startPolling() {
  if (timer) return
  const tick = async () => {
    try {
      const list = await fetchOnce()
      connections.set(Array.isArray(list) ? list : [])
      connectionError.set(null)
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
