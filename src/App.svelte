<script>
  import { onMount } from 'svelte'
  import WorldMap from './lib/WorldMap.svelte'
  import Sidebar from './lib/Sidebar.svelte'
  import { connections, connectionError, polling, startPolling, stopPolling, togglePolling } from './lib/mikrotik.js'
  import { warmup } from './lib/geoip.js'
  import { DIRECTION_COLOR } from './lib/connection.js'

  let geoStatus = $state('loading geoip db…')
  // Desktop opens with the sidebar visible; mobile starts collapsed so the map
  // gets the full viewport. Read matchMedia at module init — script bodies in
  // Svelte components only run in the browser, so `window` is always defined.
  let sidebarOpen = $state(!window.matchMedia('(max-width: 768px)').matches)

  const legend = [
    { label: 'outgoing', color: DIRECTION_COLOR.outgoing },
    { label: 'incoming', color: DIRECTION_COLOR.incoming },
    { label: 'mixed', color: DIRECTION_COLOR.mixed },
    { label: 'transit', color: DIRECTION_COLOR.transit },
  ]

  onMount(() => {
    warmup()
      .then(() => (geoStatus = 'geoip ready'))
      .catch((err) => (geoStatus = `geoip error: ${err.message}`))
    startPolling()
    return stopPolling
  })

  // After the sidebar collapses/expands, the map container's width changes.
  // Leaflet auto-listens for window resize, so a synthetic event after the
  // CSS transition is the cheapest way to trigger invalidateSize without
  // wiring a prop through WorldMap.
  $effect(() => {
    sidebarOpen
    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 220)
    return () => clearTimeout(id)
  })
</script>

<main>
  <header>
    <button
      class="sidebar-toggle"
      onclick={() => (sidebarOpen = !sidebarOpen)}
      aria-label={sidebarOpen ? 'hide sidebar' : 'show sidebar'}
      aria-expanded={sidebarOpen}
      title={sidebarOpen ? 'hide sidebar' : 'show sidebar'}
    >
      <span class="bars" aria-hidden="true"></span>
    </button>
    <h1>mikrotik geo connection tracker</h1>
    <span class="status">{geoStatus}</span>
    <button
      class="poll-toggle"
      onclick={togglePolling}
      aria-label={$polling ? 'pause polling' : 'resume polling'}
      aria-pressed={!$polling}
      title={$polling ? 'pause polling' : 'resume polling'}
    >
      {#if $polling}
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="2" y="1.5" width="3" height="9" rx="0.5"/><rect x="7" y="1.5" width="3" height="9" rx="0.5"/></svg>
      {:else}
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 1.5 L10 6 L3 10.5 Z"/></svg>
      {/if}
    </button>
    <span class="status live" class:stalled={$connectionError} class:paused={!$polling}>
      <span class="live-dot" aria-hidden="true"></span>
      {$connections.length} connections
    </span>
    {#if $connectionError}
      <span class="error">router: {$connectionError}</span>
    {/if}
    <span class="spacer"></span>
    <ul class="legend">
      {#each legend as l}
        <li><span class="dot" style="background:{l.color}"></span>{l.label}</li>
      {/each}
    </ul>
  </header>
  <div class="body">
    <Sidebar open={sidebarOpen} onClose={() => (sidebarOpen = false)} />
    <section class="map-wrap">
      <WorldMap />
    </section>
  </div>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 0.6rem 1rem;
    background: #1a1f29;
    border-bottom: 1px solid #2a313d;
  }
  h1 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }
  .sidebar-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: transparent;
    border: 1px solid #2a313d;
    border-radius: 4px;
    color: #c8cfd9;
    cursor: pointer;
  }
  .sidebar-toggle:hover { background: #2a3140; border-color: #3a4250; }
  .bars {
    position: relative;
    width: 16px;
    height: 12px;
  }
  .bars::before, .bars::after, .bars { background-clip: padding-box; }
  .bars::before, .bars::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: currentColor;
    border-radius: 1px;
  }
  .bars::before { top: 0; box-shadow: 0 5px 0 currentColor; }
  .bars::after  { bottom: 0; }
  @media (max-width: 768px) {
    header {
      gap: 0.75rem;
      padding: 0.55rem 0.75rem;
      flex-wrap: wrap;
    }
    h1 { font-size: 0.9rem; }
    .legend { display: none; }
    .spacer { display: none; }
  }
  .status {
    font-size: 0.85rem;
    opacity: 0.7;
  }
  .error {
    font-size: 0.85rem;
    color: #ff7a7a;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .map-wrap {
    flex: 1;
    position: relative;
  }
  .spacer { flex: 1; }
  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 0.9rem;
    font-size: 0.8rem;
    opacity: 0.85;
  }
  .legend li { display: flex; align-items: center; gap: 0.35rem; }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    opacity: 1;
  }
  .live-dot {
    position: relative;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #22ff88;
  }
  /* Expanding ring — a clean "ping" radiating outward. */
  .live-dot::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: #22ff88;
    animation: live-ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite;
    pointer-events: none;
  }
  /* Breathing halo — a large blurred disc behind the dot. Animating opacity
     and scale together makes the green visibly swell and recede each cycle,
     which is much more legible than a box-shadow ramp. */
  .live-dot::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 24px;
    height: 24px;
    margin: -12px 0 0 -12px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(34, 255, 136, 0.9) 0%, rgba(34, 255, 136, 0) 70%);
    filter: blur(2px);
    animation: live-halo 1.6s ease-in-out infinite;
    pointer-events: none;
    z-index: -1;
  }
  .live.stalled .live-dot {
    background: #ff7a7a;
  }
  .live.stalled .live-dot::before,
  .live.stalled .live-dot::after {
    display: none;
  }
  .live.paused .live-dot {
    background: #6a7280;
  }
  .live.paused .live-dot::before,
  .live.paused .live-dot::after {
    display: none;
  }
  .poll-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: 1px solid #2a313d;
    border-radius: 4px;
    color: #c8cfd9;
    cursor: pointer;
  }
  .poll-toggle:hover { background: #2a3140; border-color: #3a4250; }
  .poll-toggle svg { fill: currentColor; }
  .poll-toggle[aria-pressed='true'] {
    color: #ffc14e;
    border-color: #5a4a26;
    background: #2a2014;
  }
  @keyframes live-ping {
    0%        { transform: scale(1);   opacity: 0.7; }
    75%, 100% { transform: scale(1.9); opacity: 0;   }
  }
  @keyframes live-halo {
    0%, 100% { transform: scale(0.7); opacity: 0.3; }
    50%      { transform: scale(1.1); opacity: 1;   }
  }
</style>
