import { derived, writable } from 'svelte/store'
import { connections } from './mikrotik.js'
import { classify, familyOf, stateKey } from './connection.js'

// Map<remoteIp, {ip, directions: Set, items: [], section}> — the shared grouped
// view of conntrack rows, derived from the polling store. Both the world map
// and the sidebar consume this so classification only happens once per poll.
// Each item carries its `state` (see connection.js › stateKey) so downstream
// filters and counts don't need to re-derive it from `conn`.
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
    e.items.push({
      conn,
      direction: c.direction,
      local: c.local,
      remote: c.remote,
      state: stateKey(conn),
    })
  }
  for (const e of m.values()) {
    e.section = e.directions.size > 1 ? 'mixed' : [...e.directions][0]
  }
  return m
})

// Map<stateKey, flowCount> — total items per state across the whole
// (unfiltered) groups map. The State filter UI reads this to size each row;
// counts ignore both hiddenStates and hiddenScopes so the user can see what
// they're toggling against.
export const stateCounts = derived(groups, ($groups) => {
  const m = new Map()
  for (const entry of $groups.values()) {
    for (const it of entry.items) {
      m.set(it.state, (m.get(it.state) ?? 0) + 1)
    }
  }
  return m
})

// Map<'v4'|'v6', hostCount> — count of public (non-LAN) hosts per family.
// LAN entries are excluded because their endpoints are private on both
// sides; the LAN section in the sidebar groups them separately and the
// family filter doesn't apply to them.
export const familyCounts = derived(groups, ($groups) => {
  const m = new Map()
  for (const e of $groups.values()) {
    if (e.section === 'lan') continue
    const f = familyOf(e.ip)
    m.set(f, (m.get(f) ?? 0) + 1)
  }
  return m
})

// Set<"section:ip"> — section ∈ {incoming, outgoing, mixed, transit} and is
// the HOST's fixed classification (from its overall direction set), not the
// per-item direction. An item is hidden iff either of its endpoints is keyed
// off in the section of the host it belongs to. Sections never cross-cut:
// toggling MIXED only affects items routed through mixed-classified hosts.
export const hiddenScopes = writable(new Set())

// Set<stateKey> — flows whose state (tcp:established, udp, …) is in this set
// are filtered out of `visibleGroups`. Orthogonal to hiddenScopes: state
// filtering happens flow-by-flow, scope filtering happens host-by-host.
export const hiddenStates = writable(new Set())

// Set<'v4'|'v6'> — address families whose hosts are dropped from
// visibleGroups in full. Operates at the entry (host) level: an entry's
// family is uniquely determined by its remote IP, so no per-item check is
// needed. LAN entries are exempt — their family is meaningless externally.
export const hiddenFamilies = writable(new Set())

function scopeKey(section, ip) {
  return `${section}:${ip}`
}

// Same shape as `groups` but with items filtered by hiddenScopes and
// hiddenStates. Entries with no surviving items are dropped. The host's
// section is preserved as-is — marker colour and sidebar placement reflect
// the natural classification, not the visible-after-filter slice.
export const visibleGroups = derived(
  [groups, hiddenScopes, hiddenStates, hiddenFamilies],
  ([$groups, $hidden, $hiddenStates, $hiddenFamilies]) => {
    const out = new Map()
    for (const [ip, entry] of $groups) {
      const s = entry.section
      if (s !== 'lan' && $hiddenFamilies.has(familyOf(ip))) continue
      const items = entry.items.filter((it) => {
        if ($hiddenStates.has(it.state)) return false
        if (it.remote.ip && $hidden.has(scopeKey(s, it.remote.ip))) return false
        if (it.local.ip && $hidden.has(scopeKey(s, it.local.ip))) return false
        return true
      })
      if (items.length === 0) continue
      out.set(ip, { ip, items, directions: entry.directions, section: s })
    }
    return out
  }
)

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

export function toggleState(key) {
  hiddenStates.update((s) => {
    const next = new Set(s)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
}

export function setStateVisibility(keys, visible) {
  hiddenStates.update((s) => {
    const next = new Set(s)
    for (const k of keys) {
      if (visible) next.delete(k)
      else next.add(k)
    }
    return next
  })
}

export function toggleFamily(family) {
  hiddenFamilies.update((s) => {
    const next = new Set(s)
    if (next.has(family)) next.delete(family)
    else next.add(family)
    return next
  })
}

export function setFamilyVisibility(families, visible) {
  hiddenFamilies.update((s) => {
    const next = new Set(s)
    for (const f of families) {
      if (visible) next.delete(f)
      else next.add(f)
    }
    return next
  })
}
