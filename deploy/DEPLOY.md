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

### 2. On the server — clone

```bash
sudo useradd --system --home /opt/simyou --shell /usr/sbin/nologin simyou
sudo mkdir -p /opt/simyou
sudo chown simyou:simyou /opt/simyou
sudo -u simyou git clone git@github.com:arashrasoulzadeh/life-sim.git /opt/simyou
```

(For a read-only public repo, `https://github.com/arashrasoulzadeh/life-sim.git`
works without an SSH key.)

### 3. On the server — configure (not in git)

```bash
cd /opt/simyou
sudo -u simyou cp .env.example .env
sudo -u simyou nano .env
```

Set:
- `SIMYOU_SEED` — the life to run. **Pick once, never change it.**
- `SIMYOU_DB=/var/lib/simyou/simyou.db`
- `SIMYOU_SITES=/opt/simyou/sites.json`
- `SIMYOU_GAPGPT_KEY=` — your GapGPT key (blank = offline voice, still works)

```bash
sudo -u simyou cp sites.example.json sites.json
sudo -u simyou nano sites.json
```

Put real URLs that **allow iframe embedding** (`X-Frame-Options` not `DENY`, no
restrictive `frame-ancestors`) — your own pages are safest. Viewers watching
these on the desk monitor is how the life earns coins. No `sites.json` → it never
earns and buys nothing.

### 4. systemd

```bash
sudo cp /opt/simyou/deploy/simyou.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now simyou
journalctl -u simyou -f
```

`StateDirectory=simyou` in the unit creates `/var/lib/simyou` (mode 0750, owned
by the service user) for the DB.

### 5. nginx + TLS

```bash
sudo cp /opt/simyou/deploy/life.meetarash.ir.conf /etc/nginx/sites-available/life.meetarash.ir
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
cd /opt/simyou
sudo -u simyou git pull
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
| the money | `sqlite3 /var/lib/simyou/simyou.db 'select balance from bank; select ts,kind,amount,note from ledger order by rowid desc limit 20;'` |
| the memories (infinite) | `sqlite3 … 'select txt,trait,weight,archived from memories order by weight desc limit 40;'` |
| the games it wrote | `sqlite3 … 'select id,title,created_day,plays,bytes from games;'` |
| every LLM call | `sqlite3 … 'select ts,phase,status,content from llm_calls order by rowid desc limit 20;'` |
| pause the API spend | `SIMYOU_DIALOGUE=off` in `.env`, `systemctl restart simyou` (offline voice takes over) |
| change the sites | edit `/opt/simyou/sites.json`, `systemctl restart simyou` |
| start the life over | `systemctl stop simyou`; `sqlite3 … "delete from state where seed='<seed>'"` (or delete the db); `systemctl start simyou` |

## Cost

At 3 in-game min/sec a day passes every ~8 real minutes → the model is called
~2× per 8 min ≈ 360 calls/day. With `gpt-4o-mini` that's a few cents a day.
Cheaper: raise the pace constant `BASE_RATE` in `server.mjs`, or
`SIMYOU_DIALOGUE=off`.

## Endpoints

`/` viewer · `/stream` SSE · `/state` snapshot · `/api/rooms` `/api/bank`
`/api/ledger` `/api/conversations` `/api/memories` `/api/games` · `/api/sites`
`/api/impression` (viewer attention) · `/games/:id` (sandboxed game HTML)
