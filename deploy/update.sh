#!/bin/sh
# Safe production update. NEVER runs `docker compose down -v`.
set -e
cd "$(dirname "$0")/.."
git pull
if [ -f docker-compose.yml ] && command -v docker >/dev/null; then
  docker compose up -d --build          # keeps the volume, keeps the DB
  docker compose logs --tail=20 -f
else
  sudo systemctl restart simyou
  journalctl -u simyou -f
fi
