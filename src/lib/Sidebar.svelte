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

  function toggleSection(key) {
    collapsed[key] = !collapsed[key]
  }

  let bySection = $derived.by(() => {
    const out = { incoming: [], outgoing: [], mixed: [], transit: [] }
    for (const e of $groups.values()) {
      const arr = out[e.section]
      if (arr) arr.push(e)
    }
    for (const arr of Object.values(out)) arr.sort((a, b) => b.items.length - a.items.length)
    return out
  })

  function countryFor(ip) {
    const g = lookupSync(ip)
    return g?.record?.country?.iso_code ?? ''
  }

  // Returns 'all' (no hidden), 'none' (all hidden), 'partial', or 'empty'.
  function sectionState(list, hidden) {
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
    {@const list = bySection[s.key]}
    {@const isCollapsed = !!collapsed[s.key]}
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
          <span class="count">{list.length}</span>
        </button>
        {#if list.length > 0}
          {@const state = sectionState(list, $hiddenHosts)}
          <button
            class="bulk"
            class:active={state === 'all'}
            disabled={state === 'all'}
            onclick={() => setSectionVisibility(list.map((e) => e.ip), true)}
            title="show all in section"
          >all</button>
          <button
            class="bulk"
            class:active={state === 'none'}
            disabled={state === 'none'}
            onclick={() => setSectionVisibility(list.map((e) => e.ip), false)}
            title="hide all in section"
          >none</button>
        {/if}
      </header>
      {#if !isCollapsed}
        {#if list.length > 0}
          <ul>
            {#each list as e (e.ip)}
              {@const cc = countryFor(e.ip)}
              {@const hidden = $hiddenHosts.has(e.ip)}
              <li class:dim={hidden}>
                <label>
                  <input type="checkbox" checked={!hidden} onchange={() => toggleHost(e.ip)} />
                  <span class="ip">{e.ip}</span>
                  {#if cc}<span class="cc">{cc}</span>{/if}
                  <span class="n">{e.items.length}</span>
                </label>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty">no hosts</p>
        {/if}
      {/if}
    </section>
  {/each}
</aside>

<style>
  aside {
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
    z-index: 1;
    display: flex;
    align-items: center;
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
    padding: 0.45rem 0.7rem;
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
    margin-right: 0.25rem;
  }
  .bulk {
    flex-shrink: 0;
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
  li {
    border-top: 1px solid #14191f;
  }
  li:first-child { border-top: none; }
  li label {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 0.7rem;
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
