import { randomSeed } from "./engine/rng.js";
import * as Audio from "./engine/audio.js";
import { render, MUTE_RECT } from "./render/draw.js";
import { createWorld, tick, drainFx, rainLevel } from "./sim/world.js";

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d", { alpha: false });

const params = new URLSearchParams(location.search);
const seed = params.has("seed") ? Number(params.get("seed")) >>> 0 : randomSeed();

let world = createWorld(seed);
const ui = { debug: params.has("debug"), showMemory: false, showCard: false, muted: true };

let speed = 1;
let moodPush = 0;

function toggleMute() {
  ui.muted = !ui.muted;
  Audio.setMuted(ui.muted);
}

const FIXED_DT = 1 / 30;
let acc = 0;
let last = performance.now();

function frame(now) {
  let elapsed = (now - last) / 1000;
  last = now;
  if (elapsed > 0.25) elapsed = 0.25;

  if (world.started) {
    acc += elapsed * speed;
    while (acc >= FIXED_DT) {
      tick(world, FIXED_DT);
      acc -= FIXED_DT;
    }
    const fx = drainFx(world);
    if (fx) for (const tag of fx) Audio.blip(tag);
    Audio.setRain(rainLevel(world));
    Audio.update();
    moodPush -= elapsed;
    if (moodPush <= 0) {
      Audio.setMood(world.mood.valence);
      moodPush = 1.5;
    }
  }

  render(ctx, world, ui);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function begin() {
  if (world.started) return;
  world.started = true;
  Audio.start(world.seed);
  Audio.setMuted(ui.muted); // sound is off by default — click the speaker or press P
}

// run the sim forward to the top of the next in-game day (full simulation, no skipped state)
function skipToNextDay() {
  if (!world.started) return;
  const target = world.day + 1;
  let guard = 0;
  while (world.day < target && guard++ < 20000) tick(world, FIXED_DT);
  drainFx(world); // drop the burst of events so it doesn't machine-gun the audio
  acc = 0;
}

canvas.addEventListener("click", (e) => {
  const r = canvas.getBoundingClientRect();
  const cx = ((e.clientX - r.left) / r.width) * canvas.width;
  const cy = ((e.clientY - r.top) / r.height) * canvas.height;
  const m = MUTE_RECT;
  if (cx >= m.x - 4 && cx <= m.x + m.w + 4 && cy >= m.y - 4 && cy <= m.y + m.h + 4) {
    if (!world.started) begin();
    toggleMute();
    return;
  }
  if (!world.started) begin();
});

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (!world.started && (k === " " || k === "enter")) return begin();
  if (k === "f") speed = speed === 1 ? 4 : 1;
  else if (k === "n") skipToNextDay();
  else if (k === "d") ui.debug = !ui.debug;
  else if (k === "m") ui.showMemory = !ui.showMemory;
  else if (k === "s") ui.showCard = !ui.showCard;
  else if (k === "p") toggleMute();
  else if (k === "r") {
    world = createWorld(randomSeed());
    world.started = true;
    history.replaceState(null, "", `?seed=${world.seed}`);
  }
});

console.info(`SimYou life seed ${seed} — replay with ?seed=${seed}`);
