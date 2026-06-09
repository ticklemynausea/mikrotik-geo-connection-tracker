<script>
  import { groups, hiddenHosts, toggleHost, setSectionVisibility } from './groups.js'
  import { DIRECTION_COLOR } from './connection.js'
  import { lookupSync } from './geoip.js'

  const SECTIONS = [
    { key: 'incoming', label: 'Incoming' },
    { key: 'outgoing', label: 'Outgoing' },
    { key: 'mixed', label: 'Mixed' },
    { key: 'transit', label: 'Transit' },
  ]

  let collapsed = $state({})
  let subCollapsed = $state({})

  function toggleSection(key) {
    collapsed[key] = !collapsed[key]
  }

  function toggleSub(sectionKey, kind) {
    const k = `${sectionKey}:${kind}`
    subCollapsed[k] = !subCollapsed[k]
  }

  // Tally connections by (direction, role, ip). A host appears in EVERY section
  // it participates in — so a LAN box that has both outbound and inbound shows
  // up under INCOMING ▸ Local AND OUTGOING ▸ Local (each with its own count).
  // MIXED is then a derived intersection: hosts present in BOTH incoming and
  // outgoing (in either role), useful as a "find chatty multi-direction hosts"
  // filter; the same hosts will also appear in their per-direction sections.
  const bySection = $derived.by(() => {
    const bump = (m, ip) => m.set(ip, (m.get(ip) ?? 0) + 1)
    const dirs = ['incoming', 'outgoing', 'transit']
    const counts = {}
    for (const d of dirs) counts[d] = { remote: new Map(), local: new Map() }

    for (const entry of $groups.values()) {
      for (const it of entry.items) {
        const slot = counts[it.direction]
        if (!slot) continue
        if (it.remote.ip) bump(slot.remote, it.remote.ip)
        if (it.local.ip) bump(slot.local, it.local.ip)
      }
    }

    // Hosts that participate in BOTH incoming and outgoing (in either role).
    const incomingIps = new Set([
      ...counts.incoming.remote.keys(),
      ...counts.incoming.local.keys(),
    ])
    const outgoingIps = new Set([
      ...counts.outgoing.remote.keys(),
      ...counts.outgoing.local.keys(),
    ])
    const mixedIps = new Set([...incomingIps].filter((ip) => outgoingIps.has(ip)))

    const mixedSlot = { remote: new Map(), local: new Map() }
    for (const ip of mixedIps) {
      const r =
        (counts.incoming.remote.get(ip) ?? 0) + (counts.outgoing.remote.get(ip) ?? 0)
      const l =
        (counts.incoming.local.get(ip) ?? 0) + (counts.outgoing.local.get(ip) ?? 0)
      if (r > 0) mixedSlot.remote.set(ip, r)
      if (l > 0) mixedSlot.local.set(ip, l)
    }

    const toList = (m) =>
      [...m].map(([ip, count]) => ({ ip, count })).sort((a, b) => b.count - a.count)

    return {
      incoming: { remote: toList(counts.incoming.remote), local: toList(counts.incoming.local) },
      outgoing: { remote: toList(counts.outgoing.remote), local: toList(counts.outgoing.local) },
      mixed: { remote: toList(mixedSlot.remote), local: toList(mixedSlot.local) },
      transit: { remote: toList(counts.transit.remote), local: toList(counts.transit.local) },
    }
  })

  function countryFor(ip) {
    const g = lookupSync(ip)
    return g?.record?.country?.iso_code ?? ''
  }

  function bulkState(list, hidden) {
    if (list.length === 0) return 'empty'
    let h = 0
    for (const e of list) if (hidden.has(e.ip)) h++
    if (h === 0) return 'all'
    if (h === list.length) return 'none'
    return 'partial'
  }
</script>

<aside>
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
              {@const state = bulkState(group.list, $hiddenHosts)}
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
                  onclick={() => setSectionVisibility(group.list.map((e) => e.ip), true)}
                  title="show all"
                >all</button>
                <button
                  class="bulk"
                  class:active={state === 'none'}
                  disabled={state === 'none'}
                  onclick={() => setSectionVisibility(group.list.map((e) => e.ip), false)}
                  title="hide all"
                >none</button>
              </div>
              {#if !isSubCollapsed}
                <ul>
                  {#each group.list as e (e.ip)}
                    {@const cc = group.kind === 'remote' ? countryFor(e.ip) : ''}
                    {@const hidden = $hiddenHosts.has(e.ip)}
                    <li class:dim={hidden}>
                      <label>
                        <input type="checkbox" checked={!hidden} onchange={() => toggleHost(e.ip)} />
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
