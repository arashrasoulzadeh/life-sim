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
};

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
