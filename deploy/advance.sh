#!/bin/sh
# Fast-forward the life N in-game days (default 10) — every dawn/dusk conversation
# fires, so chores, buys, sells, games and memories all happen.
#   deploy/advance.sh 10
set -e
DAYS="${1:-10}"
: "${SIMYOU_ADMIN_TOKEN:?set SIMYOU_ADMIN_TOKEN (same value as in .env)}"
PORT="${SIMYOU_PORT:-5173}"
curl -s -X POST "http://127.0.0.1:${PORT}/api/admin/advance" \
  -H 'content-type: application/json' \
  -d "{\"days\":${DAYS},\"token\":\"${SIMYOU_ADMIN_TOKEN}\"}"
echo
