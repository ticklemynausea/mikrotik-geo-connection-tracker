// Reverse DNS via DNS-over-HTTPS (Cloudflare). Browser-only, no backend
// required; results are cached in memory for the session.
//
// Privacy note: every IP looked up gets sent to Cloudflare's resolver.

const cache = new Map() // ip -> string | null  (null = no PTR record)
const inFlight = new Map() // ip -> Promise<string|null>

function expandV6(addr) {
  let [head, tail] = addr.split('::')
  if (tail === undefined) {
    tail = ''
  }
  const hParts = head ? head.split(':') : []
  const tParts = tail ? tail.split(':') : []
  const missing = 8 - hParts.length - tParts.length
  const middle = Array(Math.max(0, missing)).fill('0')
  const groups = [...hParts, ...middle, ...tParts]
  return groups.map((g) => g.padStart(4, '0')).join('').toLowerCase()
}

function reverseName(ip) {
  if (ip.includes(':')) {
    return expandV6(ip).split('').reverse().join('.') + '.ip6.arpa'
  }
  return ip.split('.').reverse().join('.') + '.in-addr.arpa'
}

async function doLookup(ip) {
  try {
    const url = `https://cloudflare-dns.com/dns-query?name=${reverseName(ip)}&type=PTR`
    const res = await fetch(url, { headers: { Accept: 'application/dns-json' } })
    if (!res.ok) return null
    const data = await res.json()
    const ans = data.Answer?.find((a) => a.type === 12)
    if (!ans) return null
    return ans.data.replace(/\.$/, '')
  } catch {
    return null
  }
}

// Read cached value synchronously. Returns:
//   undefined → never looked up
//   null      → looked up, no PTR record
//   string    → resolved hostname
export function getCachedRdns(ip) {
  return cache.get(ip)
}

export function reverseLookup(ip) {
  if (cache.has(ip)) return Promise.resolve(cache.get(ip))
  if (inFlight.has(ip)) return inFlight.get(ip)
  const p = doLookup(ip).then((v) => {
    cache.set(ip, v)
    inFlight.delete(ip)
    return v
  })
  inFlight.set(ip, p)
  return p
}
