<script>
  import { onMount, onDestroy } from 'svelte'
  import L from 'leaflet'
  import { lookup, lookupSync } from './geoip.js'
  import { DIRECTION_COLOR } from './connection.js'
  import { visibleGroups } from './groups.js'
  import { getCachedRdns, reverseLookup } from './rdns.js'

  let mapEl
  let map
  // remote ip -> { marker, sig, period, baseRgb }
  // `period` is the pulse period in ms (0 = static). `baseRgb` is the
  // section colour pre-parsed once so the animation loop doesn't redo
  // hex→rgb every frame.
  const markers = new Map()

  const BASE_RADIUS = 5
  const STATIC_OPACITY = 0.7
  const PULSE_OPACITY_BASE = 0.55
  const PULSE_OPACITY_AMP = 0.4
  // How far toward white the colour lerps at the peak of the pulse. 1.0
  // would wash out to pure white; 0.65 keeps the section hue readable
  // while still flashing brightly.
  const PULSE_LIGHTEN = 0.65
  const WHITE = [255, 255, 255]

  function hexToRgb(hex) {
    const h = hex.startsWith('#') ? hex.slice(1) : hex
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ]
  }
  function rgbToHex(r, g, b) {
    const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  }
  function mixRgb(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  }

  // Total accumulated bytes (orig + repl across the host's current flows) →
  // pulse period in ms. The endpoint exposes cumulative counters, not a
  // rate, but flows expire from conntrack as they idle so the standing
  // total tracks "how loud" the remote currently is.
  function pulsePeriodFor(bytes) {
    if (bytes >= 1024 * 1024) return 350      // > 1MB — fastest
    if (bytes >= 100 * 1024) return 800       // 100KB–1MB — rapid
    if (bytes >= 1024) return 1800            // 1KB–100KB — slow
    return 0                                  // < 1KB — none
  }

  function totalBytesFor(entry) {
    let sum = 0
    for (const it of entry.items) {
      sum += Number(it.conn['orig-bytes'] ?? 0)
      sum += Number(it.conn['repl-bytes'] ?? 0)
    }
    return sum
  }

  let rafHandle = null
  function animateMarkers(now) {
    rafHandle = null
    let anyPulsing = false
    for (const m of markers.values()) {
      if (!m.period) continue
      anyPulsing = true
      const phase = (now % m.period) / m.period
      // Smooth 0→1→0 over the period; cosine gives a soft heartbeat
      // rather than a triangular snap.
      const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase)
      const [r, g, b] = mixRgb(m.baseRgb, WHITE, PULSE_LIGHTEN * k)
      const c = rgbToHex(r, g, b)
      m.marker.setStyle({
        color: c,
        fillColor: c,
        fillOpacity: PULSE_OPACITY_BASE + PULSE_OPACITY_AMP * k,
      })
    }
    if (anyPulsing) rafHandle = requestAnimationFrame(animateMarkers)
  }

  function ensureAnimation() {
    if (rafHandle != null) return
    for (const m of markers.values()) {
      if (m.period) {
        rafHandle = requestAnimationFrame(animateMarkers)
        return
      }
    }
  }

  onMount(() => {
    // preferCanvas: render all circleMarkers into a single <canvas> instead of
    // one SVG <path> each. Panning/zoom becomes a canvas translate — orders of
    // magnitude cheaper once there are more than a handful of markers.
    map = L.map(mapEl, { preferCanvas: true, zoomControl: false, minZoom: 2 }).setView([25, 10], 3)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    // CartoDB Dark Matter — free, no API key, reads as near-black with muted
    // landmasses so the coloured markers do the talking. {r} swaps in @2x
    // tiles on retina displays automatically. noWrap stops the world tiling
    // horizontally past ±180° so markers don't double up across copies.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      noWrap: true,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map)
  })

  onDestroy(() => {
    if (rafHandle != null) cancelAnimationFrame(rafHandle)
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
      // `timeout` is conntrack's per-flow countdown to expiry (resets on each
      // observed packet) — high+steady means the flow is active, decreasing
      // monotonically means it's idle. Not the connection's age.
      const timeout = escapeHtml(it.conn.timeout ?? '')
      const dirBadge = `<span style="color:${DIRECTION_COLOR[it.direction] ?? '#888'}">●</span>`
      return `
        <div class="pop-row">
          <div class="pop-addr">${dirBadge} <code>${escapeHtml(from)}</code> → <code>${escapeHtml(to)}</code></div>
          <div class="pop-meta">${proto}${state ? ` · ${escapeHtml(state)}` : ''} · ↑${orig} ↓${repl}${timeout ? ` · exp ${timeout}` : ''}</div>
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
      const period = pulsePeriodFor(totalBytesFor(entry))
      // `timeout` ticks down every poll, so we need to refresh the popup
      // content even when nothing in the signature changed — but only if
      // the popup is actually open. Closed popups can wait for the next
      // sig-changing event, which keeps the steady-state reconciliation
      // skip cheap.
      const popupOpen = existing?.marker.isPopupOpen() ?? false

      // Pulse period must update every poll regardless of sig (bytes
      // aren't part of the signature). Dropping to 0 means we need to
      // park the marker back at its base colour/opacity — the animation
      // loop won't touch it again to reset it for us.
      if (existing && existing.period !== period) {
        existing.period = period
        if (period === 0) {
          const base = rgbToHex(...existing.baseRgb)
          existing.marker.setStyle({ color: base, fillColor: base, fillOpacity: STATIC_OPACITY })
        }
      }
      if (existing && existing.sig === sig && !popupOpen) continue

      let geo = lookupSync(ip)
      if (geo === undefined) geo = await lookup(ip).catch(() => null)
      if (!geo) continue

      const color = DIRECTION_COLOR[entry.section] ?? '#888'
      const html = popupHtml(ip, entry, geo)
      if (existing) {
        if (existing.sig !== sig) {
          existing.baseRgb = hexToRgb(color)
          // When pulsing, the animation loop will overwrite this on the
          // next frame; setting it here keeps non-pulsing markers in sync.
          existing.marker.setStyle({ color, fillColor: color })
          existing.sig = sig
        }
        existing.marker.setPopupContent(html)
      } else {
        const marker = L.circleMarker([geo.lat, geo.lon], {
          radius: BASE_RADIUS,
          color,
          fillColor: color,
          fillOpacity: STATIC_OPACITY,
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
        markers.set(ip, { marker, sig, period, baseRgb: hexToRgb(color) })
      }
    }

    for (const [ip, { marker }] of markers) {
      if (!groupsMap.has(ip)) {
        marker.remove()
        markers.delete(ip)
      }
    }

    ensureAnimation()
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
  :global(.leaflet-container) { background: #0b0f15; }
  :global(.leaflet-popup-content-wrapper) {
    background: #161b24;
    color: #e6e6e6;
    border: 1px solid #2a313d;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }
  :global(.leaflet-popup-tip) {
    background: #161b24;
    border: 1px solid #2a313d;
  }
  :global(.leaflet-popup-close-button) { color: #888 !important; }
  :global(.leaflet-popup-close-button:hover) { color: #e6e6e6 !important; }
  :global(.leaflet-control-attribution) {
    background: rgba(20, 25, 33, 0.78) !important;
    color: #9aa3b2 !important;
    padding: 2px 6px !important;
    backdrop-filter: blur(2px);
  }
  :global(.leaflet-control-attribution a) { color: #b9c4d6 !important; }
  :global(.leaflet-bar) {
    background: #161b24 !important;
    border: 1px solid #2a313d !important;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4) !important;
  }
  :global(.leaflet-bar a) {
    background: #161b24 !important;
    color: #e6e6e6 !important;
    border-bottom-color: #2a313d !important;
  }
  :global(.leaflet-bar a:hover) { background: #1f2632 !important; }
  :global(.pop) { font: 12px/1.4 system-ui, sans-serif; }
  :global(.pop-head) { font-size: 13px; margin-bottom: 2px; color: #f0f3f8; }
  :global(.pop-rdns) { color: #9aa3b2; font-size: 11px; margin: 1px 0 4px; }
  :global(.pop-rdns .rdns-val) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #d6dde8; word-break: break-all; }
  :global(.pop-count) { color: #8a93a4; margin-bottom: 6px; font-size: 11px; }
  :global(.pop-row) { padding: 3px 0; border-top: 1px solid #232a36; }
  :global(.pop-row:first-of-type) { border-top: none; }
  :global(.pop-addr code) { font-size: 11px; color: #d6dde8; background: transparent; }
  :global(.pop-meta) { color: #8a93a4; font-size: 11px; margin-top: 1px; }
  :global(.pop-more) { color: #6c7689; font-size: 11px; padding-top: 4px; font-style: italic; }
</style>
