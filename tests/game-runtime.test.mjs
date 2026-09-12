// game.js is a plain inline <script> (not an ES module) that reads a spec
// from a <script id="spec"> tag and drives a <canvas>. There's no import
// surface to unit test directly, so this harness mocks just enough of the
// DOM (a canvas whose 2D context swallows every draw call, pointer/keyboard
// event registration, requestAnimationFrame, ResizeObserver) to eval() the
// real file and run every kernel through real frames + simulated input,
// exactly as the sandboxed iframe would.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { KERNELS, KERNEL_IDS } from "../src/game/kernels.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_SRC = readFileSync(join(__dirname, "../src/game/game.js"), "utf8");

function runKernel(kernel, params, frames = 260) {
  let raf = null;
  const canvasListeners = {};
  const windowListeners = {};
  const timeouts = [];
  let nowMs = 0;

  const canvas = {
    clientWidth: 800,
    clientHeight: 450,
    width: 0,
    height: 0,
    getContext: () => new Proxy({}, { get: (_, p) => (p === "measureText" ? () => ({ width: 10 }) : () => {}), set: () => true }),
    addEventListener: (t, fn) => { (canvasListeners[t] ||= []).push(fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }),
  };

  global.document = {
    getElementById: (id) => {
      if (id === "g") return canvas;
      if (id === "spec") return { textContent: JSON.stringify({ kernel, params }) };
      return null;
    },
  };
  global.window = {
    addEventListener: (t, fn) => { (windowListeners[t] ||= []).push(fn); },
    innerWidth: 800,
    innerHeight: 450,
  };
  global.performance = { now: () => nowMs };
  global.ResizeObserver = class { observe() {} };
  global.requestAnimationFrame = (fn) => { raf = fn; return 1; };
  global.setTimeout = (fn) => { timeouts.push(fn); return 1; };

  eval(GAME_SRC);

  for (let i = 0; i < frames; i++) {
    nowMs += 16;
    if (i % 15 === 0) {
      canvasListeners.pointerdown?.forEach((fn) => fn({ clientX: 40 + ((i * 53) % 720), clientY: 40 + ((i * 31) % 380) }));
    }
    if (i % 15 === 3) canvasListeners.pointermove?.forEach((fn) => fn({ clientX: 100 + ((i * 17) % 600), clientY: 100 }));
    if (i % 15 === 6) canvasListeners.pointerup?.forEach((fn) => fn({}));
    if (i % 40 === 0) windowListeners.keydown?.forEach((fn) => fn({ key: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "][i % 5], preventDefault() {} }));
    if (raf) {
      const fn = raf;
      raf = null;
      fn(nowMs);
    }
  }
  while (timeouts.length) timeouts.shift()();
  for (let i = 0; i < 40; i++) {
    nowMs += 16;
    if (raf) {
      const fn = raf;
      raf = null;
      fn(nowMs);
    }
  }
}

test("every kernel runs 300 frames with simulated pointer/keyboard input and never throws", () => {
  for (const kernel of KERNEL_IDS) {
    const params = Object.fromEntries(Object.entries(KERNELS[kernel].params).map(([k, s]) => [k, s.def]));
    assert.doesNotThrow(() => runKernel(kernel, params), `${kernel} threw with default params`);
  }
});

test("every kernel also survives extreme (min/max) param values", () => {
  for (const kernel of KERNEL_IDS) {
    const lo = Object.fromEntries(Object.entries(KERNELS[kernel].params).map(([k, s]) => [k, s.type === "int" || s.type === "num" ? s.min : s.type === "bool" ? false : s.values[0]]));
    const hi = Object.fromEntries(Object.entries(KERNELS[kernel].params).map(([k, s]) => [k, s.type === "int" || s.type === "num" ? s.max : s.type === "bool" ? true : s.values[s.values.length - 1]]));
    assert.doesNotThrow(() => runKernel(kernel, lo, 120), `${kernel} threw at minimum params`);
    assert.doesNotThrow(() => runKernel(kernel, hi, 120), `${kernel} threw at maximum params`);
  }
});

test("an unknown kernel or a missing spec degrades to a message, not a crash", () => {
  assert.doesNotThrow(() => runKernel("not-a-real-kernel", {}, 30));
  assert.doesNotThrow(() => runKernel(undefined, undefined, 30));
});
