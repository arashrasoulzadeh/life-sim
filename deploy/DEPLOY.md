# Deploying SimYou to life.meetarash.ir

One always-on Node process runs the single life and persists it to SQLite.
Browsers connect to `/stream` (SSE) and only render. Deploy is **git-based**:
push from your machine, `git pull` on the server, systemd restarts it.

## Requirements

- **Node ≥ 22.5** (uses the built-in `node:sqlite` — no npm packages at all).
  Check: `node -v`. On 22.5–23.3 add `--experimental-sqlite` to `ExecStart`.
- git, nginx, certbot.
- DNS: `life.meetarash.ir` → the server's IP.
- A git remote both machines can reach (GitHub/GitLab/self-hosted).

Secrets never go in git. `.env`, `sites.json`, `*.db` are `.gitignore`d and are
created **once, directly on the server**.

---

## First time

### 1. Push from your machine

```bash
git remote add origin git@github.com:arashrasoulzadeh/life-sim.git
git branch -M main
git push -u origin main
```

### 2. On the server — Node + clone

```bash
node -v   # MUST be >= 22.5 — Node 20 has no node:sqlite at all

# if lower, NodeSource:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
# ...or if that's blocked, the official tarball:
cd /tmp && curl -fLO https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz
sudo tar -xJf node-v22.11.0-linux-x64.tar.xz -C /usr/local --strip-components=1
sudo apt-get remove -y nodejs libnode72 2>/dev/null; hash -r; node -v

cd ~
git clone https://github.com/arashrasoulzadeh/life-sim.git
cd life-sim
```

### 3. On the server — configure (not in git)

```bash
cp .env.example .env
nano .env
```

Set (paths absolute, all under the clone dir so the service can write them):
- `SIMYOU_SEED` — the life to run. **Pick once, never change it.**
- `SIMYOU_DB=/home/ubuntu/life-sim/simyou.db`
- `SIMYOU_SITES=/home/ubuntu/life-sim/sites.json`
- `SIMYOU_GAPGPT_KEY=` — your GapGPT key (blank = offline voice, still works)

```bash
cp sites.example.json sites.json
nano sites.json
```

Put real URLs that **allow iframe embedding** (`X-Frame-Options` not `DENY`, no
restrictive `frame-ancestors`) — your own pages are safest. Viewers watching
these on the desk monitor is how the life earns coins. No `sites.json` → it never
earns and buys nothing.

### 4a. Run it — Docker (recommended for isolation)

```bash
docker compose up -d --build
docker compose logs -f
```

The container runs as a non-root user with a **read-only filesystem**, no
capabilities, and `no-new-privileges`; only `/data` (a named volume, the DB) and
`/tmp` are writable. `.env` and `sites.json` are mounted from the host, never
baked in. nginx (step 5) proxies to `127.0.0.1:5173`.

Update: `git pull && docker compose up -d --build`.

### 4b. Run it — systemd (no Docker)

The shipped unit runs as `ubuntu` from `/home/ubuntu/life-sim` — edit `User` and
the three paths in `deploy/simyou.service` if yours differ.

```bash
sudo cp deploy/simyou.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now simyou
journalctl -u simyou -f
```

The DB (and its `-wal` / `-shm` sidecars) is written next to the code, owned by
the service user.

### 5. nginx + TLS

```bash
sudo cp deploy/life.meetarash.ir.conf /etc/nginx/sites-available/life.meetarash.ir
sudo ln -s ../sites-available/life.meetarash.ir /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d life.meetarash.ir
```

Open https://life.meetarash.ir — the life is already living. Click once for sound.

---

## Updating (every deploy after the first)

```bash
# your machine
git push

# the server
cd /home/ubuntu/life-sim
git pull
sudo systemctl restart simyou
```

State (bank, memories, rooms, day, personality…) is persisted every 5s and on
shutdown, and resumed from SQLite on start — a restart never loses the life.
`.env` and `sites.json` are untracked, so `git pull` leaves them alone.

If a deploy changes `deploy/simyou.service` or the nginx conf, re-copy that file
and `daemon-reload` / `nginx -s reload`.

---

## Operating

| want | do |
|---|---|
| logs | `journalctl -u simyou -f` |
| the money | `sqlite3 /home/ubuntu/life-sim/simyou.db 'select balance from bank; select ts,kind,amount,note from ledger order by rowid desc limit 20;'` |
| the memories (infinite) | `sqlite3 … 'select txt,trait,weight,archived from memories order by weight desc limit 40;'` |
| the games it wrote | `sqlite3 … 'select id,title,created_day,plays,bytes from games;'` |
| every LLM call | `sqlite3 … 'select ts,phase,status,content from llm_calls order by rowid desc limit 20;'` |
| pause the API spend | `SIMYOU_DIALOGUE=off` in `.env`, `systemctl restart simyou` (offline voice takes over) |
| change the sites | edit `/home/ubuntu/life-sim/sites.json`, `systemctl restart simyou` |
| start the life over | `systemctl stop simyou`; `sqlite3 … "delete from state where seed='<seed>'"` (or delete the db); `systemctl start simyou` |

## Cost

At 3 in-game min/sec a day passes every ~8 real minutes → the model is called
~2× per 8 min ≈ 360 calls/day. With `gpt-4o-mini` that's a few cents a day.
Cheaper: raise the pace constant `BASE_RATE` in `server.mjs`, or
`SIMYOU_DIALOGUE=off`.

## Endpoints

`/` viewer (PWA — installable, shell cached offline) · `/stream` SSE ·
`/state` snapshot · `/api/rooms` `/api/bank` `/api/ledger` `/api/daily`
`/api/conversations` `/api/memories` `/api/games` `/api/games/:id`
`/api/quotes` · `/api/sites` · `/api/impression` (viewer attention) ·
`/games/:id` (sandboxed, nonce-CSP, engine inlined — the AI only supplies a
validated `{kernel, params}`, never code)

## Config knobs (12-factor — all via env)

`SIMYOU_SEED` `SIMYOU_PORT` `SIMYOU_DB` `SIMYOU_SITES` `SIMYOU_GAPGPT_KEY`
`SIMYOU_GAPGPT_BASE` `SIMYOU_GAPGPT_MODEL` `SIMYOU_DIALOGUE` `SIMYOU_DB_CAP_MB`
`SIMYOU_BROADCAST_MS`. No config in code; logs go to stdout; state is the DB.
