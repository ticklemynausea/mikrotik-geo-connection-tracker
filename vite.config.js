import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

// Map bare env vars (USER/PASS/URL) to the VITE_* names the app reads.
// Usage: USER=admin PASS=hunter2 URL=http://192.168.200.1 yarn start
// PASS is the trigger — the shell pre-sets $USER, so we only honor USER when
// PASS is also present, otherwise the login name would silently leak in.
if (process.env.PASS) {
  process.env.VITE_MIKROTIK_PASSWORD = process.env.PASS
  if (process.env.USER) process.env.VITE_MIKROTIK_USER = process.env.USER
}
if (process.env.URL) process.env.VITE_MIKROTIK_URL = process.env.URL
if (process.env.LAN_V6_PREFIXES) process.env.VITE_LAN_V6_PREFIXES = process.env.LAN_V6_PREFIXES

const routerTarget = (process.env.VITE_MIKROTIK_URL || 'http://192.168.200.1').replace(/\/+$/, '')

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      // mmdb-lib pulls in Node's `net` for net.isIP — shim it in the browser.
      net: fileURLToPath(new URL('./src/lib/net-shim.js', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Browser hits /rest/... on localhost:5173, Vite forwards to the router
      // server-side. Same-origin from the browser's POV → no CORS, no preflight.
      '/rest': {
        target: routerTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
