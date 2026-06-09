<script>
  import { onMount } from 'svelte'
  import WorldMap from './lib/WorldMap.svelte'
  import { connections, connectionError, startPolling, stopPolling } from './lib/mikrotik.js'
  import { warmup } from './lib/geoip.js'
  import { DIRECTION_COLOR } from './lib/connection.js'

  let geoStatus = $state('loading geoip db…')

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
</script>

<main>
  <header>
    <h1>mikrotik internet map</h1>
    <span class="status">{geoStatus}</span>
    <span class="status">{$connections.length} connections</span>
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
  <section class="map-wrap">
    <WorldMap connections={$connections} />
  </section>
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
  .status {
    font-size: 0.85rem;
    opacity: 0.7;
  }
  .error {
    font-size: 0.85rem;
    color: #ff7a7a;
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
</style>
