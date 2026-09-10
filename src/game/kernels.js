// The closed set of games the AI can make. It never writes code — it picks a
// kernel and tweaks numbers/enums, and every value is clamped here before it is
// stored or run. Shared by the server (validation) and the game frame (running).

export const KERNELS = {
  orbit: {
    desc: "dots orbiting a centre, leaving trails",
    params: {
      count: { type: "int", min: 2, max: 14, def: 6 },
      speed: { type: "num", min: 0.2, max: 2.5, def: 1 },
      hue: { type: "int", min: 0, max: 360, def: 200 },
      trail: { type: "bool", def: true },
    },
  },
  bounce: {
    desc: "balls bouncing inside a box",
    params: {
      count: { type: "int", min: 1, max: 10, def: 3 },
      speed: { type: "num", min: 0.3, max: 3, def: 1.2 },
      gravity: { type: "bool", def: false },
      hue: { type: "int", min: 0, max: 360, def: 40 },
    },
  },
  rain: {
    desc: "glyphs falling down the screen",
    params: {
      density: { type: "num", min: 0.15, max: 1, def: 0.5 },
      glyph: { type: "enum", values: ["*", "·", "o", "+", "▪", "/", "|"], def: "/" },
      hue: { type: "int", min: 0, max: 360, def: 190 },
    },
  },
  pulse: {
    desc: "concentric rings pulsing outward",
    params: {
      rate: { type: "num", min: 0.3, max: 2.5, def: 1 },
      rings: { type: "int", min: 2, max: 7, def: 4 },
      hue: { type: "int", min: 0, max: 360, def: 280 },
    },
  },
  life: {
    desc: "Conway's Game of Life from a random seed",
    params: {
      cell: { type: "int", min: 4, max: 14, def: 8 },
      density: { type: "num", min: 0.15, max: 0.6, def: 0.32 },
      hue: { type: "int", min: 0, max: 360, def: 140 },
    },
  },
  snake: {
    desc: "a snake that plays itself",
    params: {
      speed: { type: "num", min: 0.4, max: 3, def: 1.3 },
      grid: { type: "int", min: 10, max: 24, def: 16 },
      hue: { type: "int", min: 0, max: 360, def: 110 },
    },
  },
  starfield: {
    desc: "flying through a field of stars",
    params: {
      count: { type: "int", min: 40, max: 400, def: 160 },
      speed: { type: "num", min: 0.3, max: 4, def: 1.4 },
      hue: { type: "int", min: 0, max: 360, def: 210 },
      warp: { type: "bool", def: true },
    },
  },
  flock: {
    desc: "a flock of boids drifting and turning together",
    params: {
      count: { type: "int", min: 12, max: 120, def: 50 },
      speed: { type: "num", min: 0.4, max: 3, def: 1.2 },
      cohesion: { type: "num", min: 0, max: 2, def: 1 },
      hue: { type: "int", min: 0, max: 360, def: 30 },
    },
  },
  spiro: {
    desc: "a spirograph tracing looping curves",
    params: {
      outer: { type: "int", min: 40, max: 140, def: 96 },
      inner: { type: "int", min: 10, max: 90, def: 41 },
      offset: { type: "num", min: 0.2, max: 1, def: 0.7 },
      speed: { type: "num", min: 0.3, max: 3, def: 1.2 },
      hue: { type: "int", min: 0, max: 360, def: 300 },
    },
  },
  drift: {
    desc: "a lander you nudge down through gates",
    params: {
      gravity: { type: "num", min: 0.2, max: 1.6, def: 0.7 },
      gap: { type: "int", min: 40, max: 120, def: 78 },
      speed: { type: "num", min: 0.5, max: 2.5, def: 1.1 },
      hue: { type: "int", min: 0, max: 360, def: 160 },
    },
  },
  wave: {
    desc: "a field of bars rippling like water",
    params: {
      bars: { type: "int", min: 12, max: 90, def: 40 },
      speed: { type: "num", min: 0.3, max: 3, def: 1.2 },
      amp: { type: "num", min: 0.2, max: 1, def: 0.6 },
      hue: { type: "int", min: 0, max: 360, def: 195 },
    },
  },
  fireworks: {
    desc: "shells launching and bursting",
    params: {
      rate: { type: "num", min: 0.3, max: 3, def: 1 },
      spread: { type: "int", min: 20, max: 90, def: 50 },
      gravity: { type: "num", min: 0.02, max: 0.16, def: 0.06 },
      hue: { type: "int", min: 0, max: 360, def: 20 },
    },
  },
  tunnel: {
    desc: "flying down an endless polygon tunnel",
    params: {
      sides: { type: "int", min: 3, max: 10, def: 6 },
      speed: { type: "num", min: 0.3, max: 3, def: 1.3 },
      twist: { type: "num", min: 0, max: 2, def: 0.6 },
      hue: { type: "int", min: 0, max: 360, def: 260 },
    },
  },
  pong: {
    desc: "two paddles rallying by themselves",
    params: {
      speed: { type: "num", min: 0.4, max: 3, def: 1.2 },
      paddle: { type: "int", min: 20, max: 70, def: 40 },
      hue: { type: "int", min: 0, max: 360, def: 90 },
    },
  },
  paint: {
    desc: "drag to paint glowing trails that slowly fade",
    params: {
      size: { type: "num", min: 1, max: 12, def: 4 },
      fade: { type: "num", min: 0.01, max: 0.2, def: 0.04 },
      hue: { type: "int", min: 0, max: 360, def: 300 },
      rainbow: { type: "bool", def: true },
    },
  },
  breakout: {
    desc: "a paddle (follows your pointer) knocking out a wall of bricks",
    params: {
      rows: { type: "int", min: 2, max: 8, def: 5 },
      speed: { type: "num", min: 0.5, max: 3, def: 1.2 },
      paddle: { type: "int", min: 20, max: 70, def: 42 },
      hue: { type: "int", min: 0, max: 360, def: 200 },
    },
  },
  catch: {
    desc: "move the basket with your pointer to catch falling drops",
    params: {
      rate: { type: "num", min: 0.3, max: 3, def: 1 },
      speed: { type: "num", min: 0.4, max: 2.5, def: 1 },
      basket: { type: "int", min: 14, max: 50, def: 28 },
      hue: { type: "int", min: 0, max: 360, def: 40 },
    },
  },
  gravitywell: {
    desc: "particles fall toward wherever you hold the pointer",
    params: {
      count: { type: "int", min: 30, max: 300, def: 120 },
      pull: { type: "num", min: 0.2, max: 2.5, def: 1 },
      hue: { type: "int", min: 0, max: 360, def: 260 },
      trail: { type: "bool", def: true },
    },
  },
};

// nudge a spec's numbers a little (the AI fiddling with its game)
export function nudgeSpec(spec, rng) {
  const def = KERNELS[spec && spec.kernel];
  if (!def) return spec;
  const params = { ...(spec.params || {}) };
  for (const [k, s] of Object.entries(def.params)) {
    if (s.type === "int" || s.type === "num") {
      const span = s.max - s.min;
      let v = Number(params[k] != null ? params[k] : s.def) + rng.range(-0.2, 0.2) * span;
      v = Math.max(s.min, Math.min(s.max, v));
      params[k] = s.type === "int" ? Math.round(v) : Math.round(v * 100) / 100;
    } else if (s.type === "bool" && rng.chance(0.25)) {
      params[k] = !params[k];
    } else if (s.type === "enum" && rng.chance(0.3)) {
      params[k] = rng.pick(s.values);
    }
  }
  return { kernel: spec.kernel, params };
}

// a fresh, fully-random valid spec
export function randomSpec(rng) {
  const kernel = rng.pick(KERNEL_IDS);
  const params = {};
  for (const [k, s] of Object.entries(KERNELS[kernel].params)) {
    if (s.type === "int") params[k] = rng.int(s.min, s.max + 1);
    else if (s.type === "num") params[k] = Math.round(rng.range(s.min, s.max) * 100) / 100;
    else if (s.type === "bool") params[k] = rng.chance(0.5);
    else if (s.type === "enum") params[k] = rng.pick(s.values);
  }
  return { kernel, params };
}

export const KERNEL_IDS = Object.keys(KERNELS);

const clampInt = (v, lo, hi, d) => {
  v = Math.round(Number(v));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
};
const clampNum = (v, lo, hi, d) => {
  v = Number(v);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
};

// Returns a clean { kernel, params } or null. Anything unexpected is dropped.
export function validateSpec(raw) {
  const kernel = String(raw?.kernel || "");
  const def = KERNELS[kernel];
  if (!def) return null;
  const params = {};
  for (const [k, s] of Object.entries(def.params)) {
    const v = raw?.params?.[k];
    if (s.type === "int") params[k] = clampInt(v, s.min, s.max, s.def);
    else if (s.type === "num") params[k] = Math.round(clampNum(v, s.min, s.max, s.def) * 100) / 100;
    else if (s.type === "bool") params[k] = typeof v === "boolean" ? v : s.def;
    else if (s.type === "enum") params[k] = s.values.includes(v) ? v : s.def;
  }
  return { kernel, params };
}

export function describeSpec(spec) {
  const d = KERNELS[spec.kernel];
  if (!d) return "unknown";
  const parts = Object.entries(spec.params).map(([k, v]) => `${k} ${v}`);
  return `${spec.kernel} — ${d.desc}\n  ${parts.join(", ")}`;
}
