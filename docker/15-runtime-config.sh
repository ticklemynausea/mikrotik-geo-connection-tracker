#!/bin/sh
# Write a tiny JS file the SPA loads before its main bundle. This is how we
# get runtime env vars (set when the container starts) to the browser, since
# the classifier and other client-side logic ship as a static bundle. Auth
# is NOT included here — credentials stay server-side and are injected by
# nginx into the /rest/* proxy headers.
#
# Safe under `sh` (busybox), so heredoc + plain interpolation. The values
# we substitute are short CIDR / IP strings — no shell-meta risk in practice.

set -eu

OUT=/usr/share/nginx/html/runtime-config.js

cat > "$OUT" <<EOF
window.__APP_CONFIG__ = {
  lanV6Prefixes: "${LAN_V6_PREFIXES:-}",
};
EOF
