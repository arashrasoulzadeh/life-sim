import { randomSeed } from "./engine/rng.js";
import * as Audio from "./engine/audio.js";
import { render } from "./render/draw.js";
import { createWorld, tick, drainFx, rainLevel } from "./sim/world.js";

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d", { alpha: false });

const params = new URLSearchParams(location.search);
const seed = params.has("seed") ? Number(params.get("seed")) >>> 0 : randomSeed();

let world = createWorld(seed);
const ui = { debug: params.has("debug"), showMemory: false, showCard: false };

let speed = 1;
let muted = false;
let moodPush = 0;

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
  Audio.start();
}

canvas.addEventListener("click", () => {
  if (!world.started) begin();
});

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (!world.started && (k === " " || k === "enter")) return begin();
  if (k === "f") speed = speed === 1 ? 4 : 1;
  else if (k === "d") ui.debug = !ui.debug;
  else if (k === "m") ui.showMemory = !ui.showMemory;
  else if (k === "s") ui.showCard = !ui.showCard;
  else if (k === "p") {
    muted = !muted;
    Audio.setMuted(muted);
  } else if (k === "r") {
    world = createWorld(randomSeed());
    world.started = true;
    history.replaceState(null, "", `?seed=${world.seed}`);
  }
});

console.info(`SimYou life seed ${seed} — replay with ?seed=${seed}`);
