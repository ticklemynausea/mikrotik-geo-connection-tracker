# Mikrotik Internet Map

A live, client-side world map of every connection passing through a Mikrotik
home router. The browser polls the RouterOS REST API, classifies each
conntrack row, and drops a coloured dot on the geolocation of the remote IP.
Click a dot to see the underlying flows; use the sidebar to scope what's
shown.

No backend. No external services at runtime besides the OSM tile server (and
Cloudflare's DoH resolver for optional reverse-DNS in popups). The GeoIP
lookup is fully offline against a bundled MaxMind database.

##Disclaimer

This is a personal project created for personal use and to experiment with LLM-assisted code generation. Use at your own discretion.

---

## What you see

- **Dots** — one per unique remote IP currently in conntrack, placed at the
  city/country MaxMind returns.
- **Colour** — by host classification:
  - `outgoing` (blue) — only outbound flows
  - `incoming` (red) — only inbound flows (incl. port-forwarded inbound, where
    DNAT is detected via `reply-src-address`)
  - `mixed` (amber) — both inbound and outbound to/from the same remote
  - `transit` (purple) — both endpoints look public, no LAN involvement
- **Popup** — `src:port → dst:port` for each flow, protocol, TCP state,
  bytes orig/repl, plus a reverse-DNS line resolved on demand.
- **Sidebar** — four collapsible sections (Incoming / Outgoing / Mixed /
  Transit). Each partitions hosts by their classification. Within a section,
  two sub-lists: **Remote** (the public IPs whose marker is on the map) and
  **Local** (the LAN IPs that talked to those remotes). Checkboxes hide; the
  `all` / `none` bulk buttons act on the whole sub-list.

### Sidebar scope rules

The unit of hiding is `(section, ip)`. Toggling a host under MIXED only
affects markers that belong to MIXED — it never reaches into INCOMING or
OUTGOING. A LAN host that talks to both an incoming-only remote and a mixed
remote shows up under INCOMING ▸ Local AND MIXED ▸ Local independently; you
can mute one without the other.

---

## Setup

### Prerequisites

- Node 20+ and a package manager (yarn/npm/pnpm — examples use yarn)
- A RouterOS device with the REST API enabled and a user that can read
  `/ip/firewall/connection`
- A free MaxMind account for the GeoLite2-City database

### Install

```sh
yarn install
```

### Drop the GeoIP database

1. Sign up at <https://www.maxmind.com/en/geolite2/signup>.
2. Download **GeoLite2-City.mmdb** (binary `.mmdb`, not CSV).
3. Place it at:

   ```
   public/geoip/GeoLite2-City.mmdb
   ```

   Vite serves `public/` as-is, so the app fetches `/geoip/GeoLite2-City.mmdb`
   at boot. About 70 MB; the browser caches it after the first load.

   Country-only DB works too if you swap the URL via `VITE_GEOIP_DB_URL`
   (smaller, ~6 MB, no city granularity).

### Enable RouterOS REST

```routeros
/ip service set www-ssl disabled=no
/ip service set www disabled=no   # or HTTPS-only — see below
```

REST is exposed at `http://<router>/rest/`. Use a non-privileged read-only
user where possible. The app issues `GET /rest/ip/firewall/connection`.

---

## Running

Credentials come from environment variables on the same line as the run
command — no `.env`, no wrapper script. `USER` is only honoured when `PASS`
is also set (because the shell pre-populates `$USER` with your login name).

```sh
USER=monitor PASS=hunter2 URL=http://192.168.200.1 yarn start
```

Then open <http://localhost:5173>.

Variables read at startup:

| Var                       | Required | Default                          |
|---------------------------|----------|----------------------------------|
| `USER`                    | yes¹     | —                                |
| `PASS`                    | yes      | —                                |
| `URL`                     | no       | `http://192.168.200.1`           |
| `LAN_V6_PREFIXES`         | no       | —                                |
| `VITE_POLL_INTERVAL_MS`   | no       | `3000`                           |
| `VITE_GEOIP_DB_URL`       | no       | `/geoip/GeoLite2-City.mmdb`      |

¹ Effectively required. If you omit `PASS`, `USER` is ignored.

`LAN_V6_PREFIXES` is a comma-separated list of IPv6 CIDRs that belong to
your LAN — typically your ISP's delegated prefix (e.g.
`2001:db8:abcd::/56`). Flows where one endpoint is inside one of these
prefixes get classified as incoming/outgoing instead of transit. Home IPv6
networks don't NAT, so LAN devices have GUA addresses that otherwise look
"public" to the classifier and end up in the Transit bucket.

### Build

```sh
yarn build
yarn preview
```

`yarn build` produces a static bundle under `dist/`. Note: a pure static
deploy will hit CORS against the router (see *Architecture › CORS*); for
production use you need a reverse proxy (Caddy / nginx / RouterOS container)
that fronts the router's REST endpoint under the same origin as the app.

### Docker

A multi-stage `Dockerfile` builds the bundle and ships it behind nginx,
which serves the static files and proxies `/rest/*` to the router with a
server-injected `Authorization` header. Router credentials live in the
container's runtime env — never in the image, never in the JS bundle.

```sh
docker build -t mikrotik-geo-connection-tracker .

docker run -d --name mikrotik-geo -p 8080:80 \
  -e ROUTER_URL=http://192.168.200.1 \
  -e ROUTER_USER=monitor \
  -e ROUTER_PASS=hunter2 \
  -e LAN_V6_PREFIXES=2001:db8:abcd::/56 \
  --restart unless-stopped \
  mikrotik-geo-connection-tracker
```

Then open <http://localhost:8080>.

All three env vars are mandatory — the entrypoint aborts container start
with a clear error if any is missing. For ergonomics, drop them in an
env file and use `--env-file mikrotik.env` instead of three `-e` flags.

| Var                | Required | Notes                                |
|--------------------|----------|--------------------------------------|
| `ROUTER_URL`       | yes      | e.g. `http://192.168.200.1`          |
| `ROUTER_USER`      | yes      | RouterOS user with REST read access  |
| `ROUTER_PASS`      | yes      | Password for that user               |
| `LAN_V6_PREFIXES`  | no       | CSV of CIDRs — see *Running*         |

`LAN_V6_PREFIXES` is also a runtime env var here — change the value and
restart the container, no rebuild. An entrypoint script writes the value
into a tiny `runtime-config.js` that the SPA loads before its main bundle.

---

## Architecture

Plain JavaScript throughout — no TypeScript, no `tsconfig`, no `@types/*`.
Svelte 5 with runes (`$state`, `$derived`, `$effect`), Vite 5, Leaflet 1.9.

```
src/
├── main.js                  # boot: polyfill Buffer, mount <App />
├── App.svelte               # header (legend, status) + body (sidebar + map)
├── app.css                  # global resets
└── lib/
    ├── buffer-polyfill.js   # globalThis.Buffer = ... (mmdb-lib needs it)
    ├── net-shim.js          # net.isIP shim (Vite alias replaces Node `net`)
    ├── config.js            # reads import.meta.env.VITE_MIKROTIK_*
    ├── mikrotik.js          # writable `connections` store + setInterval poll
    ├── connection.js        # classify() + parseAddr() + DIRECTION_COLOR
    ├── geoip.js             # loads .mmdb, lookup() / lookupSync() / warmup()
    ├── rdns.js              # Cloudflare DoH PTR lookup with in-memory cache
    ├── groups.js            # derived stores: groups, hiddenScopes, visibleGroups
    ├── WorldMap.svelte      # Leaflet map; subscribes to visibleGroups
    └── Sidebar.svelte       # sections, sub-lists, checkboxes
```

### Data flow

```
                                      ┌─── connections ────┐
RouterOS /rest/ip/firewall/connection ─┤  (mikrotik.js)    │
                                      └────────────┬───────┘
                                                   │
                                       classify() per row
                                                   ▼
                            ┌──────── groups: Map<remoteIp, entry> ────────┐
                            │  entry = {ip, items, directions, section}    │
                            └────────┬───────────────────────┬─────────────┘
                                     │                       │
                       (filter by hiddenScopes)               │
                                     │                       │
                                     ▼                       ▼
                              visibleGroups            Sidebar.bySection
                                     │                       │
                                     ▼                       ▼
                               WorldMap markers         Sidebar lists / checkboxes
```

- **`groups`** is keyed by *remote IP*. Each entry collects every conntrack
  row touching that remote, the set of directions seen, and a `section` —
  the host's fixed classification. A host is `mixed` iff its `directions`
  Set has more than one element.
- **`hiddenScopes`** is `Set<"section:ip">`. The scope's `section` is the
  *host's* section, not a per-item direction. This guarantees sections are
  independent: toggling MIXED never touches markers classified as OUTGOING.
- **`visibleGroups`** is a derived store: each `groups` entry filtered by
  `hiddenScopes`, with the host's section preserved as-is (the marker stays
  amber for a mixed host even if some of its items are hidden).
- **Sidebar.bySection** partitions hosts into the four sections by
  `entry.section`. The Remote sub-list lists the hosts themselves; the
  Local sub-list lists LAN IPs that appear in those hosts' items.

### Classification (`connection.js › classify`)

Each conntrack row produces one item with a `direction`:

| Heuristic                                              | direction  |
|--------------------------------------------------------|------------|
| `src` private, `dst` public                            | `outgoing` |
| `src` public, `dst` private                            | `incoming` |
| both public **and** `reply-src` private (DNAT inbound) | `incoming` |
| both public, no reply hint                             | `transit`  |
| both private                                           | dropped    |

Port-forwarded inbound flows would otherwise look like transit because both
endpoints are public (router WAN + remote origin) until DNAT rewrites
`dst-address`. Checking `reply-src-address` recovers the LAN target.

Ports are pulled from inline `ip:port` form first, then from the separate
`src-port` / `dst-port` fields — RouterOS varies by version.

### CORS

The router REST endpoint doesn't set CORS headers. To keep the browser
fetch same-origin, Vite proxies `/rest/*` → router server-side. The app
talks to `localhost:5173`, Vite talks to the router.

A pure static deploy (no Vite running) loses this hop. Three workable
options:

1. Front the app with Caddy / nginx that also proxies `/rest/*` to the
   router. Same origin, no CORS.
2. Run the bundle from inside a RouterOS container with the same trick.
3. Launch Chrome with `--disable-web-security --user-data-dir=/tmp/x` for
   throwaway local use. Not recommended.

### GeoIP

`mmdb-lib` reads MaxMind's binary `.mmdb` format directly in the browser.
Two host-environment quirks:

- The library expects Node's `Buffer` at module-eval time. `buffer-polyfill.js`
  binds `globalThis.Buffer` to the npm `buffer` package before any module
  that uses it loads — that's why it's the first import in `main.js`.
- `mmdb-lib` imports Node's `net` for `net.isIP`. Vite aliases `net` to
  `src/lib/net-shim.js`, a regex-based replacement.

The DB is fetched once at boot. Each `lookup(ip)` is async (returns a Promise
the first time); `lookupSync(ip)` reads the in-memory cache only and lets
the hot path (marker creation, sidebar tags) skip the microtask hop when the
IP has already been resolved.

### Map performance

Leaflet renders into a single `<canvas>` (`preferCanvas: true`) instead of
one SVG `<path>` per marker. Panning becomes a canvas transform — cheap even
with a few hundred markers.

Markers are reconciled across polls by `WorldMap.svelte:syncMarkers`. Each
entry gets a stable signature (sorted item IDs + tcp-state); if the signature
is unchanged, the marker keeps its existing popup and style. Only new,
changed, or removed markers are touched.

### Reverse DNS

Done lazily, only when a popup opens. The lookup hits Cloudflare's
DNS-over-HTTPS endpoint (`https://cloudflare-dns.com/dns-query`) for a PTR
record, with an in-memory cache. The first popup for a fresh IP shows `…`
and patches the DOM when the answer arrives.

**Privacy note**: every IP whose popup you open is sent to Cloudflare. If
that's not acceptable, swap `rdns.js` for a different resolver or stub it.

---

## Caveats

- The GeoLite2 database is updated weekly by MaxMind. The bundled file goes
  stale — replace it occasionally.
- Conntrack on RouterOS is an in-memory cache of live flows; brief
  connections (TCP handshake then close) may not appear at all.
- This app reads the router but never writes. It's safe to point at a
  production router; the worst it can do is open `GET /rest/ip/firewall/connection`
  every few seconds.
- The Vite dev proxy means dev and prod are not the same origin shape — a
  static deploy needs its own reverse proxy for the same-origin trick.

---

## Project scripts

| Command          | What it does                                       |
|------------------|----------------------------------------------------|
| `yarn start`     | Vite dev server on port 5173, HMR, `/rest` proxy   |
| `yarn build`     | Static bundle under `dist/`                        |
| `yarn preview`   | Serve the built `dist/` for a sanity check         |
