# SimYou — no npm packages, just Node's built-ins (needs 22.5+ for node:sqlite).
FROM node:22-alpine

WORKDIR /app
COPY . .

# drop privileges; the container FS is read-only at runtime (see compose),
# the DB lives on a volume at /data
RUN addgroup -S simyou && adduser -S -G simyou simyou && mkdir -p /data && chown simyou:simyou /data
USER simyou

ENV SIMYOU_PORT=5173 \
    SIMYOU_DB=/data/simyou.db \
    SIMYOU_SITES=/app/sites.json

EXPOSE 5173
CMD ["node", "server.mjs"]
