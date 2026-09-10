// Up to three small abstract paintings hung above the couch. A fresh one is
// generated every day (oldest drops off), and the AI can hang its own via the
// evening "paintings" field. Same closed primitive vocabulary as item art.

import { cleanArt, artToSvg } from "./itemart.js";

export const MAX_PAINTINGS = 3;

function rng32(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const COMPOSITIONS = ["fields", "orbs", "strokes", "horizon", "grid"];

// a procedural abstract piece -> array of shapes (0..100 box)
export function autoPainting(rng) {
  const r = rng32((rng.int(0, 1e9) ^ 0x9e3779b9) >>> 0);
  const h1 = Math.floor(r() * 360);
  const h2 = (h1 + 60 + Math.floor(r() * 180)) % 360;
  const bg = `hsl(${h1} 45% ${14 + Math.floor(r() * 10)}%)`;
  const A = `hsl(${h1} 78% ${58 + Math.floor(r() * 14)}%)`;
  const B = `hsl(${h2} 74% ${52 + Math.floor(r() * 14)}%)`;
  const kind = COMPOSITIONS[Math.floor(r() * COMPOSITIONS.length)];
  const s = [{ t: "rect", x: 0, y: 0, w: 100, h: 100, fill: bg }];

  if (kind === "fields") {
    let y = 0;
    while (y < 100) {
      const hgt = 12 + r() * 30;
      s.push({ t: "rect", x: 0, y, w: 100, h: hgt, fill: r() > 0.5 ? A : B });
      y += hgt;
    }
  } else if (kind === "orbs") {
    for (let i = 0; i < 3 + Math.floor(r() * 4); i++) {
      s.push({ t: "circle", x: 15 + r() * 70, y: 15 + r() * 70, rad: 8 + r() * 24, fill: r() > 0.5 ? A : B });
    }
  } else if (kind === "strokes") {
    for (let i = 0; i < 4 + Math.floor(r() * 5); i++) {
      s.push({ t: "line", x1: r() * 100, y1: r() * 100, x2: r() * 100, y2: r() * 100, stroke: r() > 0.5 ? A : B, sw: 3 + r() * 8 });
    }
  } else if (kind === "horizon") {
    s.push({ t: "rect", x: 0, y: 55 + r() * 20, w: 100, h: 100, fill: B });
    s.push({ t: "circle", x: 30 + r() * 40, y: 30 + r() * 20, rad: 6 + r() * 12, fill: A });
  } else {
    const n = 3 + Math.floor(r() * 3);
    const cell = 100 / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (r() > 0.45) s.push({ t: "rect", x: i * cell, y: j * cell, w: cell, h: cell, fill: r() > 0.5 ? A : B });
    }
  }
  return cleanArt(s) || s;
}

// validate an AI-supplied set -> array of { shapes } (max 3), or null
export function cleanPaintings(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const item of raw.slice(0, MAX_PAINTINGS)) {
    const shapes = cleanArt(Array.isArray(item) ? item : item && item.shapes);
    if (shapes) out.push(shapes);
  }
  return out.length ? out : null;
}

// keep the newest MAX_PAINTINGS; add a fresh auto one if today has none
export function rotatePaintings(w, rng) {
  w.couchArt = Array.isArray(w.couchArt) ? w.couchArt : [];
  if (!w.couchArt.some((p) => p.day === w.day)) {
    w.couchArt.push({ shapes: autoPainting(rng), day: w.day });
  }
  if (w.couchArt.length > MAX_PAINTINGS) w.couchArt = w.couchArt.slice(-MAX_PAINTINGS);
}

export function setPaintings(w, sets) {
  const clean = cleanPaintings(sets);
  if (!clean) return 0;
  w.couchArt = clean.map((shapes) => ({ shapes, day: w.day }));
  return clean.length;
}

// HTML for the framed pictures on the couch wall
export function paintingsHtml(list) {
  const arr = Array.isArray(list) ? list.slice(0, MAX_PAINTINGS) : [];
  if (!arr.length) return "";
  const n = arr.length;
  const gap = 3;
  const w = (44 - (n - 1) * gap) / n;
  return arr
    .map((p, i) => {
      const left = 28 + i * (w + gap);
      return `<div class="furn painting" style="left:${left}%;width:${w}%;top:6%;height:22%;background:#0c0c10;box-shadow:0 0 0 2px #1a1a20, 0 3px 8px rgba(0,0,0,0.5);padding:3%;box-sizing:border-box">${artToSvg(p.shapes || p, true)}</div>`;
    })
    .join("");
}
