# SimYou

An ambient, autonomous life-sim in a 512×512 window. You don't play it — you watch it.
An AI assistant wakes, works through requests, eats, watches the world from the window,
messages other agents, and sleeps, all driven by its own utility AI. Endless.

## Run

No dependencies, no build step (the npm registry is unreachable on this
network, and the sim is small enough not to need one). Just serve the folder:

```bash
npm run dev
```

That runs `python3 -m http.server 5173`. Open http://localhost:5173
(add `?debug` for the overlay, `?seed=12345` to replay a life).

The only inputs — it's a life that runs itself:

- click / `space` — begin
- `F` — toggle 4× fast-forward
- `N` — jump to the top of the next in-game day
- `M` — what this life remembers (memory grid + personality drift)
- `S` — this-life card (seed, era, character, top memories) — screenshot to share
- `P` / speaker icon — sound (off by default; procedural, pitched to the seed's key)
- `D` — debug overlay
- `R` — start a new random life
- `?seed=12345` — replay a specific life · `?debug` — start with the overlay on

## Status — all six milestones done

- [x] **M1** — 512² canvas, 5 rooms with hard cuts, sprite, status strip, day/night light
- [x] **M2** — needs + pressure curves, utility-AI action scoring, legible thought line
- [x] **M3** — request stream, tokens, reputation feedback loop
- [x] **M4** — daily reflection → memory grid → permanent personality drift → forgetting
- [x] **M5** — mood (slow need-average) drives posture / walk speed / thought tone;
  drifting weather (clear→clouds→rain→storm→gold) seen through the window;
  rare one-off window events
- [x] **M6** — aging eras (decay rate, walk speed, colour cast shift over a long life),
  procedural audio (pad that tracks mood, rain bed, event blips), title screen,
  shareable seed card card

## Layout

- `src/sim/` — the simulation:
  - `needs`, `actions`, `rooms` — data + curves
  - `agent` — the utility AI (scores every action each decision, moves, thinks)
  - `memory` — themes, salience, reinforcement, forgetting, drift into personality
  - `mood`, `weather`, `eras` — the M5/M6 ambient systems
  - `world` — clock, economy, weather/era wiring, per-day tallies, `tick()`
- `src/render/draw.js` — all rendering (rooms, agent, overlays, title, card)
- `src/engine/rng.js` — seeded Mulberry32; a life is reproducible from its seed
- `src/engine/audio.js` — procedural WebAudio (no asset files)
- `src/main.js` — fixed-timestep loop (30 Hz), title gate, input, fx→audio
