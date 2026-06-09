<script>
  import { onMount, onDestroy } from 'svelte'
  import L from 'leaflet'
  import { lookup } from './geoip.js'

  let { connections = [] } = $props()

  let mapEl
  let map
  // ip -> { marker, lat, lon }
  const markers = new Map()

  onMount(() => {
    map = L.map(mapEl, { worldCopyJump: true }).setView([20, 0], 2)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)
  })

  onDestroy(() => {
    if (map) map.remove()
  })

  function remoteIp(conn) {
    // Mikrotik connection rows include `src-address` and `dst-address` as "ip:port".
    // Caller may pre-filter to outbound; here we just use dst as the remote endpoint.
    const dst = conn['dst-address'] ?? conn.dstAddress ?? ''
    return dst.split(':')[0]
  }

  async function syncMarkers(list) {
    if (!map) return
    const seen = new Set()
    for (const conn of list) {
      const ip = remoteIp(conn)
      if (!ip) continue
      seen.add(ip)
      if (markers.has(ip)) continue
      const loc = await lookup(ip).catch(() => null)
      if (!loc) continue
      const marker = L.circleMarker([loc.lat, loc.lon], {
        radius: 5,
        color: '#4ea1ff',
        fillColor: '#4ea1ff',
        fillOpacity: 0.7,
        weight: 1,
      })
        .bindPopup(`<strong>${ip}</strong><br/>${loc.record?.city?.names?.en ?? ''} ${loc.record?.country?.names?.en ?? ''}`)
        .addTo(map)
      markers.set(ip, { marker, lat: loc.lat, lon: loc.lon })
    }
    for (const [ip, { marker }] of markers) {
      if (!seen.has(ip)) {
        marker.remove()
        markers.delete(ip)
      }
    }
  }

  $effect(() => {
    syncMarkers(connections)
  })
</script>

<div bind:this={mapEl} class="map"></div>

<style>
  .map {
    width: 100%;
    height: 100%;
  }
</style>
