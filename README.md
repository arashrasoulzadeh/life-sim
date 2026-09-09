# SimYou

An autonomous life-sim. Nobody plays it — you watch it. An AI assistant lives
alone in a six-room apartment: it works through requests, eats, watches the
world from the window, messages other agents, writes memories, ages, sleeps,
earns coins from the people watching it, and spends them on furniture and on
little games it programs for itself. Endless.

Live: **https://life.meetarash.ir**

## How it works

One **server process** (`server.mjs`) runs the single life continuously and
persists everything to SQLite. Browsers are **pure viewers** — they subscribe to
the `/stream` SSE feed and render what the server sends, so every visitor sees
the same life at the same moment. Nothing pauses when no one is watching, and no
API key ever reaches the browser.

- **`src/sim/`** — the simulation, pure (no DOM): needs, the utility-AI agent,
  infinite memory + personality drift, mood, weather, eras, the economy, and the
  start/end-of-day conversation (`dialogue.js`).
- **`server.mjs`** — the loop (3 in-game min/sec), server-side GapGPT calls at
  dawn/dusk, all SQLite tables, income crediting, the size guard, SSE, static.
  Uses `node:sqlite` — **zero npm packages**.
- **`src/main.js`** — the viewer: a 2×3 room grid you can zoom into, the
  desk-monitor iframe, the game-room iframe, the attention heartbeat.

### The six rooms

Shown as a **2×3 grid**. Click a room to zoom in; **⤢ grid** or **Esc** to zoom
out — works for any room regardless of where the agent is. The AI can reorder the
grid during its evening review.

### The economy

- **Income**: the desk holds a permanent monitor showing a rotating `<iframe>` of
  the sites in `sites.json`. While your tab is open and visible, you earn the
  life coins (`ratePerVisitorDay` per site, capped per viewer per in-game day).
- **Spending**: each evening the AI reviews the whole apartment and its bank and
  may **buy** an object (150–500c), **sell** one (50% back), **commission a game**
  (400c — a self-contained HTML file it writes, played in the game room), or
  reorder the rooms. The monitor can never be sold. Every field is validated in
  `dialogue.js` before it touches the world.
- If GapGPT is unreachable or the bank is empty: `"no money."`, no changes, the
  day continues.

### Memory

Infinite — nothing is ever deleted. A working set of 48 stays in RAM; everything
ever written lives in the `memories` table. Dormant old memories are consolidated
into monthly digests (kept, not lost) plus a rolling life summary. A size guard
keeps the DB under ~900 MB by trimming `llm_calls` / old `conversations` and
vacuuming — it never touches `memories`.

## Run locally

Needs **Node ≥ 22.5** (for the built-in `node:sqlite`). No `npm install`.

```bash
git clone <repo> simyou && cd simyou
cp .env.example .env               # optional: SIMYOU_GAPGPT_KEY, SIMYOU_SEED
cp sites.example.json sites.json   # the sites shown on the desk monitor
npm run dev                        # = node --env-file-if-exists=.env server.mjs
```

Open http://localhost:5173 — the life is already running. `?debug` for the
overlay. DB is `./simyou.db` unless `SIMYOU_DB` is set.

## Deploy

Git-based: push here, `git pull` on the server, systemd + nginx.
See **[deploy/DEPLOY.md](deploy/DEPLOY.md)**.

## Viewer keys (optional — the life needs no input)

`M` memory · `C` conversations · `S` this-life card · `P` / speaker mute ·
`D` debug · click a room to zoom · `Esc` / **⤢ grid** to zoom out

## Inspecting a running life

```bash
sqlite3 simyou.db 'select balance from bank; select ts,kind,amount,note from ledger order by rowid desc limit 15;'
sqlite3 simyou.db 'select txt,trait,weight,archived from memories order by weight desc limit 40;'
sqlite3 simyou.db 'select day,phase,source,line from conversations order by rowid desc limit 20;'
sqlite3 simyou.db 'select id,title,created_day,plays from games;'
```

## Files that never go in git

`.env` (the API key), `config.js` (legacy), `sites.json` (your URLs), `*.db`.
All are in `.gitignore`; commit `*.example.*` instead.
