<script>
  import { onMount } from 'svelte'
  import WorldMap from './lib/WorldMap.svelte'
  import { connections, connectionError, startPolling, stopPolling } from './lib/mikrotik.js'
  import { warmup } from './lib/geoip.js'

  let geoStatus = $state('loading geoip db…')

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
</style>
