# Deploying SimYou to life.meetarash.ir

One always-on Node process runs the single life and persists it to SQLite.
Browsers connect to `/stream` (Server-Sent Events) and only render.

## Requirements

- **Node ≥ 22.5** (uses the built-in `node:sqlite` — no npm packages at all).
  Check: `node -v`. On 22.5–23.3 add `--experimental-sqlite` to `ExecStart`.
- nginx + certbot for TLS.
- DNS: `life.meetarash.ir` → the server's IP.

## 1. Put the code on the server

```bash
sudo useradd --system --home /opt/simyou --shell /usr/sbin/nologin simyou
sudo mkdir -p /opt/simyou
sudo rsync -a --exclude node_modules --exclude '.git' ./ /opt/simyou/   # or git clone
sudo chown -R simyou:simyou /opt/simyou
```

## 2. Configure

```bash
sudo -u simyou cp /opt/simyou/.env.example /opt/simyou/.env
sudo -u simyou nano /opt/simyou/.env
```

Set `SIMYOU_SEED` to the life you want (pick once, never change it),
`SIMYOU_DB=/var/lib/simyou/simyou.db`, and paste your GapGPT key into
`SIMYOU_GAPGPT_KEY` (leave blank for the offline voice).

## 3. systemd

```bash
sudo cp /opt/simyou/deploy/simyou.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now simyou
sudo systemctl status simyou
journalctl -u simyou -f
```

The life now runs 24/7. `systemctl restart simyou` is safe — state is
persisted every 5s and on shutdown, and resumed from the DB on start.

## 4. nginx + TLS

```bash
sudo cp /opt/simyou/deploy/life.meetarash.ir.conf /etc/nginx/sites-available/life.meetarash.ir
sudo ln -s ../sites-available/life.meetarash.ir /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d life.meetarash.ir
```

Open https://life.meetarash.ir — the life is already living; click once to
enable sound.

## Operating

| want | do |
|---|---|
| watch the logs | `journalctl -u simyou -f` |
| inspect the life | `sqlite3 /var/lib/simyou/simyou.db 'select * from conversations order by rowid desc limit 20;'` |
| the memories | `sqlite3 /var/lib/simyou/simyou.db 'select txt,trait,dir,weight from memories order by weight desc;'` |
| every LLM call | `sqlite3 /var/lib/simyou/simyou.db 'select ts,phase,status,content from llm_calls order by rowid desc limit 20;'` |
| pause the API spend | set `SIMYOU_DIALOGUE=off` in `.env`, `systemctl restart simyou` (offline voice takes over) |
| start the life over | stop the service, `delete from state where seed='<seed>'` (or `rm` the db), start again |

## Cost

At 3 in-game min/sec a day passes every ~8 real minutes, so the model is
called ~2× per 8 min ≈ 360 calls/day. With `gpt-4o-mini` that's a few cents
a day. To cut it, raise the seconds-per-tick by lowering the pace constant in
`server.mjs` (`BASE_RATE`), or run `SIMYOU_DIALOGUE=off`.

## Endpoints

- `/` — the viewer
- `/stream` — SSE state feed (~7/s)
- `/state` — one-shot JSON snapshot
- `/api/conversations`, `/api/memories` — read-only history
- `/worlds/<seed>/<room>.json` — a room's current contents
