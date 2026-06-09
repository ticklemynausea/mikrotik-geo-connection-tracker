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

// Set<"section:ip"> — section ∈ {incoming, outgoing, mixed, transit} and is
// the HOST's fixed classification (from its overall direction set), not the
// per-item direction. An item is hidden iff either of its endpoints is keyed
// off in the section of the host it belongs to. Sections never cross-cut:
// toggling MIXED only affects items routed through mixed-classified hosts.
export const hiddenScopes = writable(new Set())

function scopeKey(section, ip) {
  return `${section}:${ip}`
}

// Same shape as `groups` but with items filtered by hiddenScopes. Entries
// with no surviving items are dropped. The host's section is preserved as-is
// — marker colour and sidebar placement reflect the natural classification,
// not the visible-after-filter slice.
export const visibleGroups = derived([groups, hiddenScopes], ([$groups, $hidden]) => {
  const out = new Map()
  for (const [ip, entry] of $groups) {
    const s = entry.section
    const items = entry.items.filter((it) => {
      if (it.remote.ip && $hidden.has(scopeKey(s, it.remote.ip))) return false
      if (it.local.ip && $hidden.has(scopeKey(s, it.local.ip))) return false
      return true
    })
    if (items.length === 0) continue
    out.set(ip, { ip, items, directions: entry.directions, section: s })
  }
  return out
})

export function isHiddenScope(hidden, section, ip) {
  return hidden.has(scopeKey(section, ip))
}

export function toggleScope(section, ip) {
  hiddenScopes.update((s) => {
    const next = new Set(s)
    const k = scopeKey(section, ip)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return next
  })
}

export function setScopeVisibility(section, ips, visible) {
  hiddenScopes.update((s) => {
    const next = new Set(s)
    for (const ip of ips) {
      const k = scopeKey(section, ip)
      if (visible) next.delete(k)
      else next.add(k)
    }
    return next
  })
}
