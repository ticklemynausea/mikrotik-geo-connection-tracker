import { derived, writable } from 'svelte/store'
import { connections } from './mikrotik.js'
import { classify } from './connection.js'

// Map<remoteIp, {ip, directions: Set, items: [], section}> — the shared grouped
// view of conntrack rows, derived from the polling store. Both the world map
// and the sidebar consume this so classification only happens once per poll.
export const groups = derived(connections, ($conns) => {
  const m = new Map()
  for (const conn of $conns) {
    const c = classify(conn)
    if (!c) continue
    const ip = c.remote.ip
    if (!ip) continue
    let e = m.get(ip)
    if (!e) {
      e = { ip, directions: new Set(), items: [] }
      m.set(ip, e)
    }
    e.directions.add(c.direction)
    e.items.push({ conn, direction: c.direction, local: c.local, remote: c.remote })
  }
  for (const e of m.values()) {
    e.section = e.directions.size > 1 ? 'mixed' : [...e.directions][0]
  }
  return m
})

// Set<ip> — hosts the user has hidden via sidebar checkboxes. May be either
// remote (public) or local (LAN) IPs. A connection is "visible" iff neither
// of its endpoints is in this set.
export const hiddenHosts = writable(new Set())

// Same shape as `groups` but with items filtered by hiddenHosts (either side).
// Entries with no visible items are dropped; directions and section are
// recomputed from the surviving items so colour follows visible state.
export const visibleGroups = derived([groups, hiddenHosts], ([$groups, $hidden]) => {
  const out = new Map()
  for (const [ip, entry] of $groups) {
    const items = entry.items.filter(
      (it) => !$hidden.has(it.remote.ip) && !$hidden.has(it.local.ip)
    )
    if (items.length === 0) continue
    const directions = new Set(items.map((it) => it.direction))
    const section = directions.size > 1 ? 'mixed' : [...directions][0]
    out.set(ip, { ip, items, directions, section })
  }
  return out
})

export function toggleHost(ip) {
  hiddenHosts.update((s) => {
    const next = new Set(s)
    if (next.has(ip)) next.delete(ip)
    else next.add(ip)
    return next
  })
}

export function setSectionVisibility(ips, visible) {
  hiddenHosts.update((s) => {
    const next = new Set(s)
    for (const ip of ips) {
      if (visible) next.delete(ip)
      else next.add(ip)
    }
    return next
  })
}
