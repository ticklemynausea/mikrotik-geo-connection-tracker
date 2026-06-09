<script>
  import { onMount, onDestroy } from 'svelte'
  import L from 'leaflet'
  import { lookup, lookupSync } from './geoip.js'
  import { DIRECTION_COLOR } from './connection.js'
  import { groups, hiddenHosts } from './groups.js'

  let mapEl
  let map
  // remote ip -> { marker, sig }
  const markers = new Map()

  onMount(() => {
    // preferCanvas: render all circleMarkers into a single <canvas> instead of
    // one SVG <path> each. Panning/zoom becomes a canvas translate — orders of
    // magnitude cheaper once there are more than a handful of markers.
    map = L.map(mapEl, { worldCopyJump: true, preferCanvas: true }).setView([20, 0], 2)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)
  })

  onDestroy(() => {
    if (map) map.remove()
  })

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]))
  }

  function colorFor(directions) {
    if (directions.size > 1) return DIRECTION_COLOR.mixed
    const [only] = directions
    return DIRECTION_COLOR[only] ?? '#888'
  }

  function fmtBytes(n) {
    const v = Number(n)
    if (!Number.isFinite(v) || v === 0) return '0'
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0, x = v
    while (x >= 1024 && i < units.length - 1) { x /= 1024; i++ }
    return `${x.toFixed(x < 10 ? 1 : 0)} ${units[i]}`
  }

  function fmtAddr({ ip, port }) {
    if (!ip) return ''
    return port ? `${ip}:${port}` : ip
  }

  function popupHtml(remoteIp, entry, geo) {
    const place = [geo?.record?.city?.names?.en, geo?.record?.country?.names?.en].filter(Boolean).join(', ')
    const rows = entry.items.slice(0, 20).map((it) => {
      const local = fmtAddr(it.local)
      const remote = fmtAddr(it.remote)
      const [from, to] = it.direction === 'incoming' ? [remote, local] : [local, remote]
      const proto = escapeHtml(it.conn.protocol ?? '')
      const state = escapeHtml(it.conn['tcp-state'] ?? '')
      const orig = fmtBytes(it.conn['orig-bytes'])
      const repl = fmtBytes(it.conn['repl-bytes'])
      const dirBadge = `<span style="color:${DIRECTION_COLOR[it.direction] ?? '#888'}">●</span>`
      return `
        <div class="pop-row">
          <div class="pop-addr">${dirBadge} <code>${escapeHtml(from)}</code> → <code>${escapeHtml(to)}</code></div>
          <div class="pop-meta">${proto}${state ? ` · ${escapeHtml(state)}` : ''} · ↑${orig} ↓${repl}</div>
        </div>`
    }).join('')
    const more = entry.items.length > 20 ? `<div class="pop-more">+${entry.items.length - 20} more</div>` : ''
    return `
      <div class="pop">
        <div class="pop-head"><strong>${escapeHtml(remoteIp)}</strong>${place ? ` · ${escapeHtml(place)}` : ''}</div>
        <div class="pop-count">${entry.items.length} connection${entry.items.length === 1 ? '' : 's'}</div>
        ${rows}
        ${more}
      </div>`
  }

  function signatureFor(entry) {
    const dirs = [...entry.directions].sort().join(',')
    const ids = entry.items
      .map((it) => `${it.conn['.id'] ?? ''}|${it.conn['tcp-state'] ?? ''}`)
      .sort()
      .join(';')
    return `${dirs}::${ids}`
  }

  async function syncMarkers(groupsMap, hidden) {
    if (!map) return

    for (const [ip, entry] of groupsMap) {
      if (hidden.has(ip)) {
        const existing = markers.get(ip)
        if (existing) {
          existing.marker.remove()
          markers.delete(ip)
        }
        continue
      }
      const existing = markers.get(ip)
      const sig = signatureFor(entry)
      if (existing && existing.sig === sig) continue

      let geo = lookupSync(ip)
      if (geo === undefined) geo = await lookup(ip).catch(() => null)
      if (!geo) continue

      const color = colorFor(entry.directions)
      const html = popupHtml(ip, entry, geo)
      if (existing) {
        existing.marker.setStyle({ color, fillColor: color })
        existing.marker.setPopupContent(html)
        existing.sig = sig
      } else {
        const marker = L.circleMarker([geo.lat, geo.lon], {
          radius: 5,
          color,
          fillColor: color,
          fillOpacity: 0.7,
          weight: 1,
        })
          .bindPopup(html, { maxWidth: 360, maxHeight: 320 })
          .addTo(map)
        markers.set(ip, { marker, sig })
      }
    }

    for (const [ip, { marker }] of markers) {
      if (!groupsMap.has(ip)) {
        marker.remove()
        markers.delete(ip)
      }
    }
  }

  $effect(() => {
    syncMarkers($groups, $hiddenHosts)
  })
</script>

<div bind:this={mapEl} class="map"></div>

<style>
  .map {
    width: 100%;
    height: 100%;
  }
  :global(.pop) { font: 12px/1.4 system-ui, sans-serif; }
  :global(.pop-head) { font-size: 13px; margin-bottom: 2px; }
  :global(.pop-count) { color: #666; margin-bottom: 6px; font-size: 11px; }
  :global(.pop-row) { padding: 3px 0; border-top: 1px solid #eee; }
  :global(.pop-row:first-of-type) { border-top: none; }
  :global(.pop-addr code) { font-size: 11px; }
  :global(.pop-meta) { color: #666; font-size: 11px; margin-top: 1px; }
  :global(.pop-more) { color: #999; font-size: 11px; padding-top: 4px; font-style: italic; }
</style>
