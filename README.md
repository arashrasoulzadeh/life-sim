# SimYou

An ambient, autonomous life-sim in a 512×512 window. You don't play it — you watch it.
An AI assistant wakes, works through requests, eats, watches the world from the window,
messages other agents, and sleeps, all driven by its own utility AI. Endless.

## Run

```bash
npm install
npm run dev
```

Open the printed URL.

- `F` — toggle 4× fast-forward (the only input)
- `D` — debug overlay (personality vector, current action)
- `R` — start a new life with a random seed
- `?seed=12345` — replay a specific life · `?debug` — start with the overlay on

## Status

- [x] **M1** — 512² canvas, 5 rooms with hard cuts, sprite, status strip, day/night light
- [x] **M2** — needs + pressure curves, utility-AI action scoring, legible thought line
- [x] **M3 (partial)** — request stream, tokens, reputation feedback loop
- [ ] **M4** — memory grid + personality drift + forgetting
- [ ] **M5** — mood-driven animation, window weather + rare events
- [ ] **M6** — aging / eras, audio, title screen, shareable seed card

## Layout

- `src/sim/` — the simulation: `needs`, `actions`, `rooms`, `agent` (utility AI), `world` (clock + economy + tick)
- `src/render/draw.ts` — all rendering
- `src/engine/rng.ts` — seeded Mulberry32; a life is reproducible from its seed
- `src/main.ts` — fixed-timestep loop (30 Hz) + input
