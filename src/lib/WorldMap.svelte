<script>
  import { onMount, onDestroy } from 'svelte'
  import L from 'leaflet'
  import { lookup } from './geoip.js'
  import { classify, DIRECTION_COLOR } from './connection.js'

  let { connections = [] } = $props()

  let mapEl
  let map
  // remote ip -> { marker, directions: Set<string>, conns: [] }
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
      // Always render as "initiator → target": LAN side for outgoing, public side for incoming.
      const [from, to] = it.direction === 'incoming' ? [remote, local] : [local, remote]
      const proto = escapeHtml(it.conn.protocol ?? '')
      const state = escapeHtml(it.conn['tcp-state'] ?? '')
      const orig = fmtBytes(it.conn['orig-bytes'])
      const repl = fmtBytes(it.conn['repl-bytes'])
      const dirBadge = `<span style="color:${DIRECTION_COLOR[it.direction] ?? '#888'}">●</span>`
      return `
        <div class="pop-row">
          <div class="pop-addr">${dirBadge} <code>${escapeHtml(from)}</code> → <code>${escapeHtml(to)}</code></div>
          <div class="pop-meta">${proto}${state ? ` · ${state}` : ''} · ↑${orig} ↓${repl}</div>
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

  async function syncMarkers(list) {
    if (!map) return
    // Group classified connections by remote IP.
    const grouped = new Map()
    for (const conn of list) {
      const c = classify(conn)
      if (!c) continue
      const ip = c.remote.ip
      if (!ip) continue
      const item = { conn, direction: c.direction, local: c.local, remote: c.remote }
      if (!grouped.has(ip)) grouped.set(ip, { directions: new Set(), items: [] })
      const entry = grouped.get(ip)
      entry.directions.add(c.direction)
      entry.items.push(item)
    }

    for (const [ip, entry] of grouped) {
      const geo = await lookup(ip).catch(() => null)
      if (!geo) continue
      const color = colorFor(entry.directions)
      const html = popupHtml(ip, entry, geo)
      const existing = markers.get(ip)
      if (existing) {
        existing.marker.setStyle({ color, fillColor: color })
        existing.marker.setPopupContent(html)
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
        markers.set(ip, { marker })
      }
    }

    for (const [ip, { marker }] of markers) {
      if (!grouped.has(ip)) {
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
  :global(.pop) { font: 12px/1.4 system-ui, sans-serif; }
  :global(.pop-head) { font-size: 13px; margin-bottom: 2px; }
  :global(.pop-count) { color: #666; margin-bottom: 6px; font-size: 11px; }
  :global(.pop-row) { padding: 3px 0; border-top: 1px solid #eee; }
  :global(.pop-row:first-of-type) { border-top: none; }
  :global(.pop-addr code) { font-size: 11px; }
  :global(.pop-meta) { color: #666; font-size: 11px; margin-top: 1px; }
  :global(.pop-more) { color: #999; font-size: 11px; padding-top: 4px; font-style: italic; }
</style>
