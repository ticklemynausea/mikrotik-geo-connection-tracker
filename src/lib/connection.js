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
  /^fe80:/i,
  /^fc/i,
  /^fd/i,
]

export function isPrivate(ip) {
  if (!ip) return true
  if (ip.includes(':')) return PRIVATE_V6.some((r) => r.test(ip))
  return PRIVATE_V4.some((r) => r.test(ip))
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
  return null // both private — LAN traffic, skip
}

export const DIRECTION_COLOR = {
  outgoing: '#4ea1ff', // blue
  incoming: '#ff7a7a', // red
  mixed: '#ffc14e',    // amber, when an IP sees both
  transit: '#a07bff',  // purple
}
