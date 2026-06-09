<script>
  import {
    groups,
    hiddenScopes,
    hiddenStates,
    stateCounts,
    toggleScope,
    setScopeVisibility,
    isHiddenScope,
    toggleState,
    setStateVisibility,
  } from './groups.js'
  import { DIRECTION_COLOR, STATE_ORDER, stateLabel } from './connection.js'
  import { lookupSync } from './geoip.js'

  const SECTIONS = [
    { key: 'incoming', label: 'Incoming' },
    { key: 'outgoing', label: 'Outgoing' },
    { key: 'mixed', label: 'Mixed' },
    { key: 'transit', label: 'Transit' },
  ]

  let collapsed = $state({})
  let subCollapsed = $state({})
  let statesCollapsed = $state(false)

  function toggleSection(key) {
    collapsed[key] = !collapsed[key]
  }

  function toggleSub(sectionKey, kind) {
    const k = `${sectionKey}:${kind}`
    subCollapsed[k] = !subCollapsed[k]
  }

  // States currently present in conntrack, ordered by STATE_ORDER (with
  // unknown keys appended alphabetically). We only render rows that have at
  // least one flow OR are currently hidden — keeping a hidden-with-zero row
  // visible means the user can still un-hide it after traffic returns.
  const stateRows = $derived.by(() => {
    const counts = $stateCounts
    const keys = new Set(counts.keys())
    for (const k of $hiddenStates) keys.add(k)
    const order = new Map(STATE_ORDER.map((k, i) => [k, i]))
    return [...keys]
      .sort((a, b) => {
        const ai = order.get(a)
        const bi = order.get(b)
        if (ai != null && bi != null) return ai - bi
        if (ai != null) return -1
        if (bi != null) return 1
        return a.localeCompare(b)
      })
      .map((key) => ({ key, count: counts.get(key) ?? 0 }))
  })

  function stateBulkState(rows, hidden) {
    if (rows.length === 0) return 'empty'
    let h = 0
    for (const r of rows) if (hidden.has(r.key)) h++
    if (h === 0) return 'all'
    if (h === rows.length) return 'none'
    return 'partial'
  }

  const stateBulk = $derived(stateBulkState(stateRows, $hiddenStates))
  const totalFlows = $derived(stateRows.reduce((n, r) => n + r.count, 0))

  // Partition hosts (= remote-IP-keyed entries from `groups`) by their fixed
  // section. Each remote appears in exactly one section: incoming-only,
  // outgoing-only, mixed (does both), or transit. Within a section's Local
  // sub-list we list the local IPs that show up in items belonging to that
  // section's remotes — so a LAN box that talks to both an incoming-only
  // remote and a mixed remote shows up under INCOMING ▸ Local AND
  // MIXED ▸ Local independently, each scoped to its own remote-class slice.
  const bySection = $derived.by(() => {
    const bump = (m, ip) => m.set(ip, (m.get(ip) ?? 0) + 1)
    const sections = {
      incoming: { remote: new Map(), local: new Map() },
      outgoing: { remote: new Map(), local: new Map() },
      mixed: { remote: new Map(), local: new Map() },
      transit: { remote: new Map(), local: new Map() },
    }

    for (const entry of $groups.values()) {
      const slot = sections[entry.section]
      if (!slot) continue
      // Drop items whose state is hidden so directional counts and lists
      // match what's actually on the map. A host whose only flows are all
      // state-hidden disappears from the sidebar entirely (its marker is
      // already gone from visibleGroups).
      const items = entry.items.filter((it) => !$hiddenStates.has(it.state))
      if (items.length === 0) continue
      slot.remote.set(entry.ip, items.length)
      for (const it of items) {
        if (it.local.ip) bump(slot.local, it.local.ip)
      }
    }

    const toList = (m) =>
      [...m].map(([ip, count]) => ({ ip, count })).sort((a, b) => b.count - a.count)

    return {
      incoming: { remote: toList(sections.incoming.remote), local: toList(sections.incoming.local) },
      outgoing: { remote: toList(sections.outgoing.remote), local: toList(sections.outgoing.local) },
      mixed: { remote: toList(sections.mixed.remote), local: toList(sections.mixed.local) },
      transit: { remote: toList(sections.transit.remote), local: toList(sections.transit.local) },
    }
  })

  function countryFor(ip) {
    const g = lookupSync(ip)
    return g?.record?.country?.iso_code ?? ''
  }

  function bulkState(direction, list, hidden) {
    if (list.length === 0) return 'empty'
    let h = 0
    for (const e of list) if (isHiddenScope(hidden, direction, e.ip)) h++
    if (h === 0) return 'all'
    if (h === list.length) return 'none'
    return 'partial'
  }
</script>

<aside>
  <section>
    <header class="states-head">
      <button
        class="head-btn"
        onclick={() => (statesCollapsed = !statesCollapsed)}
        aria-expanded={!statesCollapsed}
        title={statesCollapsed ? 'expand' : 'collapse'}
      >
        <span class="chevron" class:open={!statesCollapsed}>▸</span>
        <span class="title">States</span>
        <span class="count">{totalFlows}</span>
      </button>
      {#if stateRows.length > 0}
        <button
          class="bulk"
          class:active={stateBulk === 'all'}
          disabled={stateBulk === 'all'}
          onclick={() => setStateVisibility(stateRows.map((r) => r.key), true)}
          title="show all states"
        >all</button>
        <button
          class="bulk"
          class:active={stateBulk === 'none'}
          disabled={stateBulk === 'none'}
          onclick={() => setStateVisibility(stateRows.map((r) => r.key), false)}
          title="hide all states"
        >none</button>
      {/if}
    </header>
    {#if !statesCollapsed}
      {#if stateRows.length === 0}
        <p class="empty">no flows</p>
      {:else}
        <ul>
          {#each stateRows as r (r.key)}
            {@const hidden = $hiddenStates.has(r.key)}
            <li class:dim={hidden}>
              <label>
                <input type="checkbox" checked={!hidden} onchange={() => toggleState(r.key)} />
                <span class="ip">{stateLabel(r.key)}</span>
                <span class="n">{r.count}</span>
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>
  {#each SECTIONS as s (s.key)}
    {@const sub = bySection[s.key]}
    {@const isCollapsed = !!collapsed[s.key]}
    {@const total = sub.remote.length + sub.local.length}
    <section>
      <header style="border-left-color:{DIRECTION_COLOR[s.key]}">
        <button
          class="head-btn"
          onclick={() => toggleSection(s.key)}
          aria-expanded={!isCollapsed}
          title={isCollapsed ? 'expand' : 'collapse'}
        >
          <span class="chevron" class:open={!isCollapsed}>▸</span>
          <span class="dot" style="background:{DIRECTION_COLOR[s.key]}"></span>
          <span class="title">{s.label}</span>
          <span class="count">{total}</span>
        </button>
      </header>
      {#if !isCollapsed}
        {#if total === 0}
          <p class="empty">no hosts</p>
        {:else}
          {#each [{ kind: 'remote', label: 'Remote', list: sub.remote }, { kind: 'local', label: 'Local', list: sub.local }] as group (group.kind)}
            {#if group.list.length > 0}
              {@const state = bulkState(s.key, group.list, $hiddenScopes)}
              {@const isSubCollapsed = !!subCollapsed[`${s.key}:${group.kind}`]}
              <div class="sub-head">
                <button
                  class="sub-toggle"
                  onclick={() => toggleSub(s.key, group.kind)}
                  aria-expanded={!isSubCollapsed}
                  title={isSubCollapsed ? 'expand' : 'collapse'}
                >
                  <span class="chevron sub-chevron" class:open={!isSubCollapsed}>▸</span>
                  <span class="sub-label">{group.label}</span>
                  <span class="sub-count">{group.list.length}</span>
                </button>
                <button
                  class="bulk"
                  class:active={state === 'all'}
                  disabled={state === 'all'}
                  onclick={() => setScopeVisibility(s.key, group.list.map((e) => e.ip), true)}
                  title="show all"
                >all</button>
                <button
                  class="bulk"
                  class:active={state === 'none'}
                  disabled={state === 'none'}
                  onclick={() => setScopeVisibility(s.key, group.list.map((e) => e.ip), false)}
                  title="hide all"
                >none</button>
              </div>
              {#if !isSubCollapsed}
                <ul>
                  {#each group.list as e (e.ip)}
                    {@const cc = group.kind === 'remote' ? countryFor(e.ip) : ''}
                    {@const hidden = isHiddenScope($hiddenScopes, s.key, e.ip)}
                    <li class:dim={hidden}>
                      <label>
                        <input type="checkbox" checked={!hidden} onchange={() => toggleScope(s.key, e.ip)} />
                        <span class="ip">{e.ip}</span>
                        {#if cc}<span class="cc">{cc}</span>{/if}
                        <span class="n">{e.count}</span>
                      </label>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          {/each}
        {/if}
      {/if}
    </section>
  {/each}
</aside>

<style>
  aside {
    --head-h: 32px;
    --sub-h: 26px;
    width: 320px;
    background: #0c1015;
    border-right: 1px solid #2a313d;
    overflow-y: auto;
    overflow-x: hidden;
    height: 100%;
    font-size: 0.85rem;
  }
  section { border-bottom: 1px solid #1c2230; }
  section > header {
    position: sticky;
    top: 0;
    z-index: 2;
    height: var(--head-h);
    display: flex;
    align-items: stretch;
    gap: 0.35rem;
    padding-right: 0.7rem;
    background: #161b24;
    border-left: 3px solid transparent;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    color: #c8cfd9;
  }
  .states-head { border-bottom: 1px solid #1c2230; }
  .head-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.7rem;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    text-align: left;
    cursor: pointer;
  }
  .head-btn:hover { background: #1c2230; }
  .chevron {
    display: inline-block;
    width: 0.6rem;
    font-size: 0.65rem;
    color: #8a93a3;
    transition: transform 0.12s ease;
  }
  .chevron.open { transform: rotate(90deg); }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .title { flex: 1; }
  .count {
    color: #8a93a3;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .sub-head {
    position: sticky;
    top: var(--head-h);
    z-index: 1;
    height: var(--sub-h);
    display: flex;
    align-items: stretch;
    gap: 0.35rem;
    padding-right: 0.7rem;
    background: #11151c;
    border-bottom: 1px solid #1c2230;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #8a93a3;
  }
  .sub-toggle {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.7rem 0 1.6rem;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    text-align: left;
    cursor: pointer;
  }
  .sub-toggle:hover { background: #161b24; color: #c8cfd9; }
  .sub-chevron { font-size: 0.55rem; width: 0.55rem; }
  .sub-label { flex: 1; }
  .sub-count { font-variant-numeric: tabular-nums; }

  .bulk {
    flex-shrink: 0;
    align-self: center;
    background: transparent;
    color: #8a93a3;
    border: 1px solid #2a313d;
    border-radius: 3px;
    padding: 2px 7px;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .bulk:hover:not(:disabled) { color: #e6e6e6; border-color: #3a4250; }
  .bulk.active {
    background: #2a3140;
    color: #e6e6e6;
    border-color: #3a4250;
    cursor: default;
  }
  .bulk:disabled { cursor: default; }

  ul { list-style: none; margin: 0; padding: 0; }
  li { border-top: 1px solid #14191f; }
  li:first-child { border-top: none; }
  li label {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 0.7rem 0.35rem 1.6rem;
    cursor: pointer;
  }
  li label:hover { background: #14191f; }
  li.dim label { opacity: 0.4; }
  li input[type='checkbox'] {
    accent-color: #4ea1ff;
    cursor: pointer;
  }
  .ip {
    flex: 1;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.76rem;
    color: #d8dee6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cc {
    font-size: 0.66rem;
    color: #8a93a3;
    padding: 0 0.32rem;
    border: 1px solid #2a313d;
    border-radius: 3px;
    letter-spacing: 0.04em;
  }
  .n {
    color: #8a93a3;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    min-width: 1.5rem;
    text-align: right;
  }
  .empty {
    margin: 0;
    padding: 0.5rem 0.7rem;
    color: #5a6273;
    font-size: 0.74rem;
    font-style: italic;
  }
</style>
