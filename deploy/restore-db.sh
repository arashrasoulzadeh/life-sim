#!/bin/sh
# Restore a SimYou database into the running Docker setup — safely.
#
#   deploy/restore-db.sh backups/3230-2026-09-09T10-00-00-000Z.db
#   deploy/restore-db.sh ~/life-sim/simyou.db
#
# Never uses `docker compose down -v`. Run from the project directory.
set -e

SRC="$1"
[ -f "$SRC" ] || { echo "usage: $0 <path-to-backup.db>"; exit 1; }

PROJ=$(basename "$(pwd)")
VOL="${PROJ}_simyou-data"
SRC_DIR=$(cd "$(dirname "$SRC")" && pwd)
SRC_NAME=$(basename "$SRC")

echo "restoring $SRC  ->  volume $VOL"
docker compose stop
docker run --rm --user root \
  -v "$VOL":/data \
  -v "$SRC_DIR":/src:ro \
  alpine sh -c "
    cp '/src/$SRC_NAME' /data/simyou.db &&
    rm -f /data/simyou.db-wal /data/simyou.db-shm &&
    chown -R 10001:10001 /data &&
    ls -l /data
  "
docker compose start
docker compose logs -f
