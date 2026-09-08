import { randomSeed } from "./engine/rng.js";
import { render } from "./render/draw.js";
import { createWorld, tick } from "./sim/world.js";

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d", { alpha: false });

const params = new URLSearchParams(location.search);
const seed = params.has("seed") ? Number(params.get("seed")) >>> 0 : randomSeed();

let world = createWorld(seed);
let speed = 1;
let debug = params.has("debug");

const FIXED_DT = 1 / 30;
let acc = 0;
let last = performance.now();

function frame(now) {
  let elapsed = (now - last) / 1000;
  last = now;
  if (elapsed > 0.25) elapsed = 0.25; // don't fast-forward through a tab switch
  acc += elapsed * speed;
  while (acc >= FIXED_DT) {
    tick(world, FIXED_DT);
    acc -= FIXED_DT;
  }
  render(ctx, world, debug);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "f") speed = speed === 1 ? 4 : 1;
  else if (k === "d") debug = !debug;
  else if (k === "r") world = createWorld(randomSeed());
});

console.info(`SimYou life seed ${seed} — replay with ?seed=${seed}`);
