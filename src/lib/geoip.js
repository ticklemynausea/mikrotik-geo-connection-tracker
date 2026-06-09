import { Reader } from 'mmdb-lib'
import { Buffer } from 'buffer'
import { config } from './config.js'

// Drop a GeoLite2-City.mmdb file at public/geoip/ (see PROBLEM.md).
// The DB is fetched once at app start and queried in-memory thereafter.

let readerPromise = null
const cache = new Map()

function loadReader() {
  if (readerPromise) return readerPromise
  readerPromise = fetch(config.geoipUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`GeoIP DB not found at ${config.geoipUrl} (status ${res.status})`)
      const ctype = res.headers.get('content-type') ?? ''
      // Vite serves index.html as a fallback for unknown paths — catch that
      // before mmdb-lib chokes on HTML with a cryptic "Unknown type" error.
      if (ctype.includes('text/html')) {
        throw new Error(
          `GeoIP DB missing at ${config.geoipUrl}: server returned HTML. ` +
          `Drop GeoLite2-City.mmdb into public/geoip/ (see PROBLEM.md).`
        )
      }
      return res.arrayBuffer()
    })
    .then((buf) => new Reader(Buffer.from(buf)))
  return readerPromise
}

export async function lookup(ip) {
  if (cache.has(ip)) return cache.get(ip)
  const reader = await loadReader()
  const record = reader.get(ip)
  const loc = record?.location
    ? { lat: record.location.latitude, lon: record.location.longitude, record }
    : null
  cache.set(ip, loc)
  return loc
}

// Synchronous read of the in-memory cache. Returns the cached value (a loc
// object or null) on hit, or `undefined` if the IP hasn't been resolved yet.
// Lets the hot path avoid awaiting a resolved Promise once per marker.
export function lookupSync(ip) {
  return cache.has(ip) ? cache.get(ip) : undefined
}

export function warmup() {
  return loadReader()
}
