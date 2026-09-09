# SimYou — no npm packages, just Node's built-ins (needs 22.5+ for node:sqlite).
FROM node:22-alpine

RUN apk add --no-cache su-exec \
 && addgroup -S -g 10001 simyou && adduser -S -u 10001 -G simyou simyou

WORKDIR /app
COPY . .
RUN mkdir -p /data /backups \
 && chown 10001:10001 /data /backups \
 && chmod +x deploy/entrypoint.sh

ENV SIMYOU_PORT=5173 \
    SIMYOU_DB=/data/simyou.db \
    SIMYOU_SITES=/app/sites.json \
    SIMYOU_BACKUP_DIR=/backups

EXPOSE 5173
# starts as root: entrypoint.sh chowns /data + /backups, then drops to uid 10001
ENTRYPOINT ["./deploy/entrypoint.sh"]
