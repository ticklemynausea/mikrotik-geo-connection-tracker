// No-op for dev. In Docker, this file is overwritten at container start by
// docker/15-runtime-config.sh with the real values from runtime env. In dev
// the classifier falls back to import.meta.env (set by vite.config.js from
// LAN_V6_PREFIXES=…).
window.__APP_CONFIG__ = window.__APP_CONFIG__ || {}
