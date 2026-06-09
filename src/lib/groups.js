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

// Set<"direction:ip"> — direction ∈ {incoming, outgoing, mixed, transit}.
// Each entry hides every item whose direction matches AND that touches the IP
// on either side. The MIXED scope additionally hides incoming/outgoing items
// for the IP — unchecking under MIXED takes the address out of the
// mixed-view, which functionally means "drop its incoming and outgoing
// items in one click."
export const hiddenScopes = writable(new Set())

function scopeKey(direction, ip) {
  return `${direction}:${ip}`
}

function itemHidden(item, hidden) {
  const dir = item.direction
  const rIp = item.remote.ip
  const lIp = item.local.ip
  if (rIp && hidden.has(scopeKey(dir, rIp))) return true
  if (lIp && hidden.has(scopeKey(dir, lIp))) return true
  if (dir === 'incoming' || dir === 'outgoing') {
    if (rIp && hidden.has(scopeKey('mixed', rIp))) return true
    if (lIp && hidden.has(scopeKey('mixed', lIp))) return true
  }
  return false
}

// Same shape as `groups` but with items dropped according to hiddenScopes.
// Entries with no surviving items are removed; directions and section are
// recomputed from the survivors so marker colour follows visible state.
export const visibleGroups = derived([groups, hiddenScopes], ([$groups, $hidden]) => {
  const out = new Map()
  for (const [ip, entry] of $groups) {
    const items = entry.items.filter((it) => !itemHidden(it, $hidden))
    if (items.length === 0) continue
    const directions = new Set(items.map((it) => it.direction))
    const section = directions.size > 1 ? 'mixed' : [...directions][0]
    out.set(ip, { ip, items, directions, section })
  }
  return out
})

export function isHiddenScope(hidden, direction, ip) {
  return hidden.has(scopeKey(direction, ip))
}

export function toggleScope(direction, ip) {
  hiddenScopes.update((s) => {
    const next = new Set(s)
    const k = scopeKey(direction, ip)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return next
  })
}

export function setScopeVisibility(direction, ips, visible) {
  hiddenScopes.update((s) => {
    const next = new Set(s)
    for (const ip of ips) {
      const k = scopeKey(direction, ip)
      if (visible) next.delete(k)
      else next.add(k)
    }
    return next
  })
}
