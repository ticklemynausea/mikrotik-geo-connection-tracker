const env = import.meta.env

export const config = {
  // The router URL is consumed by the Vite proxy (vite.config.js), not the app:
  // the browser fetches relative /rest/... and Vite forwards server-side.
  user: env.VITE_MIKROTIK_USER ?? '',
  password: env.VITE_MIKROTIK_PASSWORD ?? '',
  pollIntervalMs: Number(env.VITE_POLL_INTERVAL_MS ?? 3000),
  geoipUrl: env.VITE_GEOIP_DB_URL ?? '/geoip/GeoLite2-City.mmdb',
}

export function authHeader() {
  return 'Basic ' + btoa(`${config.user}:${config.password}`)
}
