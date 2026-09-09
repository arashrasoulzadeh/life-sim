#!/bin/sh
# Runs as root, hands the data dirs to the app user (a DB migrated in by any
# means is usually root-owned — this is what kept causing "readonly database"),
# then drops privileges and starts the server. Never deletes anything.
set -e

if [ "$(id -u)" = "0" ]; then
  chown -R 10001:10001 /data /backups 2>/dev/null || true
  if command -v su-exec >/dev/null 2>&1; then
    exec su-exec 10001:10001 node /app/server.mjs
  fi
  echo "[entrypoint] su-exec missing — running as root" >&2
fi

exec node /app/server.mjs
