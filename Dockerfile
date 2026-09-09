# SimYou — no npm packages, just Node's built-ins (needs 22.5+ for node:sqlite).
FROM node:22-alpine

# fixed uid/gid so a migrated DB can be chowned to match:
#   docker run --rm --user root -v <vol>:/data node:22-alpine chown -R 10001:10001 /data
RUN addgroup -S -g 10001 simyou && adduser -S -u 10001 -G simyou simyou

WORKDIR /app
COPY --chown=simyou:simyou . .
RUN mkdir -p /data && chown simyou:simyou /data

USER simyou
ENV SIMYOU_PORT=5173 \
    SIMYOU_DB=/data/simyou.db \
    SIMYOU_SITES=/app/sites.json

EXPOSE 5173
CMD ["node", "server.mjs"]
