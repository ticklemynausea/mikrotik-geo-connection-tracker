// Helpers for interpreting a Mikrotik conntrack row.

const PRIVATE_V4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^255\.255\.255\.255$/,
]
const PRIVATE_V6 = [
  /^::1$/,
  /^::$/,
  /^fe80:/i,
  /^fc/i,
  /^fd/i,
  /^ff/i,
]

// Parse "2001:db8::/56" → { bytes: Uint8Array(16), bits: 56 }, or null on
// garbage. Used to recognise the router's own delegated v6 prefix as "local"
// so home LAN devices (which have GUA addresses, no NAT) get classified as
// incoming/outgoing instead of transit.
function parseV6(ip) {
  if (!ip || !ip.includes(':')) return null
  let parts
  if (ip.includes('::')) {
    const [head, tail] = ip.split('::')
    const headParts = head ? head.split(':') : []
    const tailParts = tail ? tail.split(':') : []
    const fill = 8 - headParts.length - tailParts.length
    if (fill < 0) return null
    parts = [...headParts, ...new Array(fill).fill('0'), ...tailParts]
  } else {
    parts = ip.split(':')
  }
  if (parts.length !== 8) return null
  const out = new Uint8Array(16)
  for (let i = 0; i < 8; i++) {
    const v = parseInt(parts[i] || '0', 16)
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null
    out[i * 2] = v >> 8
    out[i * 2 + 1] = v & 0xff
  }
  return out
}

function parseV6Cidr(s) {
  const [ip, lenStr] = s.trim().split('/')
  const bits = lenStr === undefined ? 128 : Number(lenStr)
  if (!Number.isFinite(bits) || bits < 0 || bits > 128) return null
  const bytes = parseV6(ip)
  if (!bytes) return null
  return { bytes, bits }
}

function inCidr(ipBytes, { bytes, bits }) {
  const full = bits >> 3
  const rem = bits & 7
  for (let i = 0; i < full; i++) if (ipBytes[i] !== bytes[i]) return false
  if (rem === 0) return true
  const mask = (0xff << (8 - rem)) & 0xff
  return (ipBytes[full] & mask) === (bytes[full] & mask)
}

// Parsed once at module load. Two sources, runtime-first:
//   - Docker: docker/15-runtime-config.sh writes window.__APP_CONFIG__ at
//     container start from the LAN_V6_PREFIXES env. Lets you change the
//     prefix and restart the container — no rebuild needed.
//   - Dev: vite.config.js maps LAN_V6_PREFIXES → VITE_LAN_V6_PREFIXES at
//     dev-server start, which lands in import.meta.env.
// Empty or malformed entries are silently dropped — bad CIDRs just mean
// nothing matches.
const runtimeCsv = (typeof window !== 'undefined' && window.__APP_CONFIG__?.lanV6Prefixes) || ''
const buildCsv = import.meta.env.VITE_LAN_V6_PREFIXES ?? ''
const LAN_V6_PREFIXES = (runtimeCsv || buildCsv)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(parseV6Cidr)
  .filter(Boolean)

export function isPrivate(ip) {
  if (!ip) return true
  if (ip.includes(':')) {
    if (PRIVATE_V6.some((r) => r.test(ip))) return true
    if (LAN_V6_PREFIXES.length > 0) {
      const bytes = parseV6(ip)
      if (bytes && LAN_V6_PREFIXES.some((c) => inCidr(bytes, c))) return true
    }
    return false
  }
  return PRIVATE_V4.some((r) => r.test(ip))
}

export function familyOf(ip) {
  return ip && ip.includes(':') ? 'v6' : 'v4'
}

export function parseAddr(s) {
  if (!s) return { ip: '', port: '' }
  if (s.startsWith('[')) {
    const end = s.indexOf(']')
    return { ip: s.slice(1, end), port: s.slice(end + 2) }
  }
  // For IPv4 "ip:port"; for bare IPv6 (no brackets), keep as-is.
  const colon = s.lastIndexOf(':')
  if (colon === -1 || s.indexOf(':') !== colon) return { ip: s, port: '' }
  return { ip: s.slice(0, colon), port: s.slice(colon + 1) }
}

// Classify a connection as incoming/outgoing based on which side is public.
// Returns { direction, remote: {ip,port}, local: {ip,port} } or null if it's
// LAN-only / has no public side.
//
// Mikrotik conntrack also exposes reply-src-address / reply-dst-address, which
// reveal NAT translation. Port-forwarded inbound rows have:
//   src-address       = remote public origin
//   dst-address       = router WAN (also public — pre-DNAT)
//   reply-src-address = LAN target (private, post-DNAT)
// so without the reply-side hint these would look like transit and the marker
// would end up at the router's WAN location instead of the actual origin.
// Pull port from the address string first ("ip:port" form), then fall back to
// the separate conn[*-port] field. RouterOS REST varies by version: some
// builds inline the port into src-address, others expose src-port as its own
// key (and for protocols like ICMP there's no port at all).
function addrWithPort(conn, addrKey, portKey) {
  const a = parseAddr(conn[addrKey])
  if (!a.port && conn[portKey]) a.port = String(conn[portKey])
  return a
}

export function classify(conn) {
  const src = addrWithPort(conn, 'src-address', 'src-port')
  const dst = addrWithPort(conn, 'dst-address', 'dst-port')
  const rSrc = addrWithPort(conn, 'reply-src-address', 'reply-src-port')
  const srcPriv = isPrivate(src.ip)
  const dstPriv = isPrivate(dst.ip)
  const rSrcPriv = rSrc.ip ? isPrivate(rSrc.ip) : false

  if (srcPriv && !dstPriv) return { direction: 'outgoing', remote: dst, local: src }
  if (!srcPriv && dstPriv) return { direction: 'incoming', remote: src, local: dst }
  // Port-forwarded inbound: both src and dst look public, but reply-src is the
  // private LAN target — remote is the original src.
  if (!srcPriv && !dstPriv && rSrc.ip && rSrcPriv) {
    return { direction: 'incoming', remote: src, local: rSrc }
  }
  if (!srcPriv && !dstPriv) return { direction: 'transit', remote: dst, local: src }
  // Both endpoints private — LAN-to-LAN. Key the group by the initiator (src)
  // so each LAN device that started at least one local flow gets one entry,
  // with the destination going into the host's items as `local`. No public IP
  // means no map marker; the LAN section in the sidebar is the only surface.
  if (srcPriv && dstPriv) return { direction: 'lan', remote: src, local: dst }
  return null
}

export const DIRECTION_COLOR = {
  outgoing: '#4ea1ff', // blue
  incoming: '#ff7a7a', // red
  mixed: '#ffc14e',    // amber, when an IP sees both
  transit: '#a07bff',  // purple
  lan: '#6ad48a',      // green — sidebar-only, no map marker
}

// A coarse identifier for "what state is this flow in" — the unit of the
// State filter in the sidebar. For TCP we expose the conntrack tcp-state
// (`established`, `time-wait`, …); for everything else we bucket by protocol
// (`udp`, `icmp`, …) because conntrack reports no per-flow state there.
// Keys are namespaced as `tcp:<state>` vs bare protocol so the two domains
// never collide (e.g. a hypothetical `udp` tcp-state can't be confused with
// "this is a UDP flow").
export function stateKey(conn) {
  const proto = (conn.protocol ?? '').toLowerCase()
  if (proto === 'tcp') {
    const s = conn['tcp-state']
    return s ? `tcp:${s}` : 'tcp:none'
  }
  return proto || 'other'
}

// Display order for state filters in the sidebar. States not in this list
// (rare protocols, unknown tcp-states) sort alphabetically at the end.
export const STATE_ORDER = [
  'tcp:established',
  'tcp:syn-sent',
  'tcp:syn-received',
  'tcp:time-wait',
  'tcp:close-wait',
  'tcp:fin-wait',
  'tcp:last-ack',
  'tcp:close',
  'tcp:none',
  'udp',
  'icmp',
  'icmpv6',
  'gre',
  'esp',
  'ah',
  'sctp',
  'other',
]

export function stateLabel(key) {
  if (key.startsWith('tcp:')) return `tcp · ${key.slice(4)}`
  return key
}
