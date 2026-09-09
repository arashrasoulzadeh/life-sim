# SimYou

An ambient, autonomous life-sim in a 512×512 window. Nobody plays it — you watch it.
An AI assistant wakes, works through requests, eats, watches the world from the
window, messages other agents, writes memories, ages, and sleeps — all driven by
its own utility AI. Endless.

## Architecture

One **server process** runs the single life continuously and persists it to
SQLite. Browsers are **pure viewers** — they connect to the `/stream` SSE feed
and render whatever the server sends, so every visitor sees the same life at the
same moment. No API key ever reaches the browser, and nothing pauses when no one
is watching.

- **`src/sim/`** — the simulation, pure (no DOM):
  - `needs`, `actions`, `rooms` — data + curves
  - `agent` — the utility AI (scores every action each decision, moves, thinks)
  - `memory` — themes, salience, reinforcement, forgetting, drift into personality
  - `mood`, `weather`, `eras` — the ambient systems
  - `dialogue` — the start/end-of-day conversation prompt + safe apply
  - `roomrender` — room → HTML fragment
  - `world` — clock, economy, wiring, `tick()`
- **`server.mjs`** — runs the loop (3 in-game min/sec), calls GapGPT server-side
  at dawn/dusk, writes the `state` / `memories` / `rooms` / `conversations` /
  `llm_calls` tables (`node:sqlite`, zero npm packages), serves the viewer + SSE.
- **`src/main.js`** — the viewer: SSE in, smooth the agent, `render()`.
- **`src/render/draw.js`** — canvas layer: agent, animated window sky, memory
  wall, day/night + era tints, corridor, UI. The room scene (walls, floor,
  furniture, emoji objects) is an HTML layer behind the canvas.
- **`src/engine/rng.js`** — seeded Mulberry32; a life is reproducible from its seed.
- **`src/engine/audio.js`** — procedural WebAudio, pitched to the seed's key.

## Run locally

Needs **Node ≥ 22.5** (for the built-in `node:sqlite`). No `npm install`.

```bash
cp .env.example .env          # optional: SIMYOU_GAPGPT_KEY, SIMYOU_SEED, …
npm run dev                   # = node server.mjs
```

Open http://localhost:5173 — the life is already running. `?debug` shows the
overlay. The DB is `simyou.db` in the project dir unless `SIMYOU_DB` is set.

## Deploy

[`deploy/DEPLOY.md`](deploy/DEPLOY.md) — systemd unit + nginx config for running
it at a domain with TLS. State is persisted every 5s and on shutdown, and
resumed from the DB on start, so `systemctl restart` is safe.

## Start / end-of-day conversation

Twice a day the agent stops to talk. The prompt carries its personality, all its
memories, every room's contents, and the day's tally. The reply is one line of
inner voice, up to two whitelisted room add/removes, and optionally one new
memory. Every field is validated in `src/sim/dialogue.js` before it touches the
world. Without `SIMYOU_GAPGPT_KEY` an offline stub voice stands in — it still
talks and still rearranges rooms.

## Viewer keys (optional — the life needs no input)

- `M` — what this life remembers (memory grid + personality drift)
- `C` — start/end-of-day conversation log
- `S` — this-life card (seed, era, character, top memories)
- `P` / speaker icon — sound (off by default)
- `D` — debug overlay

## Inspecting a running life

```bash
sqlite3 simyou.db 'select txt,trait,dir,weight from memories order by weight desc;'
sqlite3 simyou.db 'select day,phase,source,line from conversations order by rowid desc limit 20;'
sqlite3 simyou.db 'select ts,phase,status,content from llm_calls order by rowid desc limit 20;'
```
