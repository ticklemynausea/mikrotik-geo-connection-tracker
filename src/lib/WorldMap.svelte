<script>
  import { onMount, onDestroy } from 'svelte'
  import L from 'leaflet'
  import { lookup, lookupSync } from './geoip.js'
  import { DIRECTION_COLOR } from './connection.js'
  import { visibleGroups } from './groups.js'
  import { getCachedRdns, reverseLookup } from './rdns.js'

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

  function rdnsLabel(ip) {
    const r = getCachedRdns(ip)
    if (r === undefined) return '…'
    return r ?? '(no PTR record)'
  }

  function popupHtml(remoteIp, entry, geo) {
    const place = [geo?.record?.city?.names?.en, geo?.record?.country?.names?.en].filter(Boolean).join(', ')
    const rdns = rdnsLabel(remoteIp)
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
        <div class="pop-rdns">rDNS: <span class="rdns-val">${escapeHtml(rdns)}</span></div>
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

  async function syncMarkers(groupsMap) {
    if (!map) return

    for (const [ip, entry] of groupsMap) {
      // LAN entries have only private IPs — no geoip record exists, and the
      // host belongs to the sidebar-only LAN section. Skip before paying for
      // a lookup (and so we don't churn the rDNS cache on RFC1918 IPs).
      if (entry.section === 'lan') continue
      const existing = markers.get(ip)
      const sig = signatureFor(entry)
      if (existing && existing.sig === sig) continue

      let geo = lookupSync(ip)
      if (geo === undefined) geo = await lookup(ip).catch(() => null)
      if (!geo) continue

      const color = DIRECTION_COLOR[entry.section] ?? '#888'
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
        // Lazy PTR lookup on first popup open. Result is cached, so future
        // popupHtml() rebuilds will inline the value; here we patch the DOM
        // of the currently-open popup directly.
        marker.on('popupopen', () => {
          if (getCachedRdns(ip) !== undefined) return
          reverseLookup(ip).then((name) => {
            const el = marker.getPopup()?.getElement()
            const span = el?.querySelector('.rdns-val')
            if (span) span.textContent = name ?? '(no PTR record)'
          })
        })
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
    syncMarkers($visibleGroups)
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
  :global(.pop-rdns) { color: #555; font-size: 11px; margin: 1px 0 4px; }
  :global(.pop-rdns .rdns-val) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #333; word-break: break-all; }
  :global(.pop-count) { color: #666; margin-bottom: 6px; font-size: 11px; }
  :global(.pop-row) { padding: 3px 0; border-top: 1px solid #eee; }
  :global(.pop-row:first-of-type) { border-top: none; }
  :global(.pop-addr code) { font-size: 11px; }
  :global(.pop-meta) { color: #666; font-size: 11px; margin-top: 1px; }
  :global(.pop-more) { color: #999; font-size: 11px; padding-top: 4px; font-style: italic; }
</style>
