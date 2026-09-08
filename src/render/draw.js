import { ROOMS } from "../sim/rooms.js";
import { NEED_IDS } from "../sim/constants.js";
import { moodWord, moodPosture } from "../sim/mood.js";
import { rainIntensity } from "../sim/weather.js";

export const W = 512;
export const H = 512;
export const PLAYFIELD_H = 448;

const NEED_COLOR = {
  focus: "#e0b45c",
  energy: "#e06a5c",
  social: "#7ad0a0",
  curiosity: "#8fb8e8",
};

const TRAIT_COLOR = {
  diligence: "#e0b45c",
  sociability: "#7ad0a0",
  curiosity: "#8fb8e8",
  restlessness: "#c98bd0",
};

// clickable hit-box for the mute toggle, in canvas pixels
export const MUTE_RECT = { x: 488, y: 451, w: 20, h: 18 };

export function render(ctx, w, ui) {
  ctx.imageSmoothingEnabled = false;
  drawRoom(ctx, w);
  drawFurniture(ctx, w.agent.room);
  if (w.agent.room === "window") drawSky(ctx, w);
  if (w.agent.room === "bed") drawMemoryWall(ctx, w);
  drawAgent(ctx, w);
  drawNightTint(ctx, w);
  if (w.era.tint) {
    ctx.fillStyle = w.era.tint;
    ctx.fillRect(0, 0, W, PLAYFIELD_H);
  }
  drawStrip(ctx, w);
  drawMute(ctx, ui.muted);
  if (ui.debug) drawDebug(ctx, w);
  if (ui.showMemory) drawMemoryOverlay(ctx, w);
  if (ui.showCard) drawSeedCard(ctx, w);
  if (!w.started) drawTitle(ctx, w);
}

function drawRoom(ctx, w) {
  const room = ROOMS[w.agent.room];
  const light = daylight(w.dayFrac);
  ctx.fillStyle = shade(room.palette.wall, light);
  ctx.fillRect(0, 0, W, PLAYFIELD_H);
  ctx.fillStyle = shade(room.palette.floor, light * 0.9 + 0.1);
  ctx.fillRect(0, room.floor.y, W, PLAYFIELD_H - room.floor.y);
  ctx.fillStyle = shade(room.palette.accent, 0.5);
  ctx.fillRect(0, room.floor.y - 4, W, 4);
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  for (let y = room.floor.y + 6; y < PLAYFIELD_H; y += 8) ctx.fillRect(0, y, W, 2);
}

function drawFurniture(ctx, roomId) {
  const a = ROOMS[roomId].palette.accent;
  switch (roomId) {
    case "desk": {
      ctx.fillStyle = "#5a4632";
      ctx.fillRect(196, 250, 200, 16);
      ctx.fillRect(200, 266, 8, 40);
      ctx.fillRect(384, 266, 8, 40);
      ctx.fillStyle = "#111";
      ctx.fillRect(300, 218, 60, 36);
      ctx.fillStyle = a;
      ctx.fillRect(304, 222, 52, 28);
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(324, 254, 12, 8);
      break;
    }
    case "kitchen": {
      ctx.fillStyle = "#6b6b73";
      ctx.fillRect(60, 236, 190, 18);
      ctx.fillStyle = "#3a3a40";
      ctx.fillRect(60, 254, 190, 44);
      ctx.fillStyle = "#cfcfd6";
      ctx.fillRect(96, 244, 16, 10);
      break;
    }
    case "window": {
      ctx.fillStyle = "#0c1430";
      ctx.fillRect(150, 70, 212, 150);
      break;
    }
    case "couch": {
      ctx.fillStyle = shade(a, 0.7);
      ctx.fillRect(280, 276, 150, 40);
      ctx.fillRect(280, 250, 20, 40);
      ctx.fillRect(410, 250, 20, 40);
      ctx.fillStyle = shade(a, 0.9);
      ctx.fillRect(300, 268, 110, 12);
      break;
    }
    case "bed": {
      ctx.fillStyle = "#4a4038";
      ctx.fillRect(180, 262, 170, 54);
      ctx.fillStyle = shade(a, 1.1);
      ctx.fillRect(180, 262, 170, 20);
      ctx.fillStyle = "#e8e8ee";
      ctx.fillRect(186, 250, 42, 22);
      break;
    }
  }
}

function drawSky(ctx, w) {
  const x = 156;
  const y = 76;
  const ww = 200;
  const hh = 138;
  const sky = w.weather.sky;
  const t = performance.now() / 1000;

  const skyColor = {
    clear: "#8fd0e8",
    clouds: "#7f93a6",
    rain: "#5a6472",
    storm: "#3d4450",
    gold: "#e8b06a",
  }[sky];
  ctx.fillStyle = shade(skyColor, daylight(w.dayFrac) * 0.7 + 0.3);
  ctx.fillRect(x, y, ww, hh);

  // skyline
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  for (let i = 0; i < 7; i++) ctx.fillRect(x + 4 + i * 28, y + 60 + (i % 3) * 10, 20, hh - 60);

  if (sky === "clouds" || sky === "rain" || sky === "storm") {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    for (let i = 0; i < 3; i++) {
      const cx = x + ((t * (6 + i * 3) + i * 80) % (ww + 60)) - 30;
      ctx.fillRect(cx, y + 12 + i * 16, 46, 10);
    }
  }
  const rain = rainIntensity(sky);
  if (rain > 0) {
    ctx.strokeStyle = "rgba(180,200,220,0.5)";
    ctx.lineWidth = 1;
    const drops = Math.floor(40 * rain);
    for (let i = 0; i < drops; i++) {
      const rx = x + ((i * 53 + t * 400 * rain) % ww);
      const ry = y + ((i * 71 + t * 600 * rain) % hh);
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 2, ry + 7);
      ctx.stroke();
    }
  }
  if (w.weather.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${w.weather.flash * 3})`;
    ctx.fillRect(x, y, ww, hh);
  }

  // frame
  ctx.fillStyle = "#0c1430";
  ctx.fillRect(x + 96, y, 6, hh);
  ctx.fillRect(x, y + 64, ww, 6);

  if (w.windowEvent) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(150, 224, 212, 15);
    ctx.fillStyle = "#8fd0e8";
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "top";
    ctx.fillText(`— ${w.windowEvent.label} —`, 158, 227);
  }
}

function drawMemoryWall(ctx, w) {
  const slots = w.memory.slots;
  const cols = 4;
  const cell = 26;
  const gap = 8;
  const gw = cols * cell + (cols - 1) * gap;
  const x0 = (W - gw) / 2;
  const y0 = 70;
  ctx.fillStyle = "#c8ccd4";
  ctx.font = "9px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText(`MEMORY  ${slots.length}/12`, x0, y0 - 14);
  for (let i = 0; i < 12; i++) {
    const cx = x0 + (i % cols) * (cell + gap);
    const cy = y0 + Math.floor(i / cols) * (cell + gap);
    const s = slots[i];
    if (!s) {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(cx, cy, cell, cell);
      continue;
    }
    ctx.globalAlpha = Math.max(0.12, Math.min(1, s.weight / 2.5));
    ctx.fillStyle = TRAIT_COLOR[s.trait] ?? "#888";
    ctx.fillRect(cx, cy, cell, cell);
    ctx.globalAlpha = 1;
    ctx.fillStyle = s.dir > 0 ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.45)";
    ctx.fillRect(cx + 2, cy + 2, cell - 4, 3);
  }
  if (w.memory.latestText) {
    ctx.fillStyle = "#9aa3b3";
    ctx.fillText(clip(w.memory.latestText, 58), x0, y0 + 3 * (cell + gap) + 2);
  }
}

function drawAgent(ctx, w) {
  const agent = w.agent;
  if (agent.transit > 0) return;
  const x = Math.round(agent.x);
  const base = Math.round(agent.y);
  const f = agent.facing;
  const posture = moodPosture(w.mood); // -1 slumped .. +1 light
  const now = performance.now();

  // idle breathing / slump
  const idle = !agent.moving;
  const breathe = idle ? Math.sin(now / (posture > 0 ? 500 : 900)) * (0.6 + posture * 0.5) : 0;
  const slump = idle && posture < 0 ? -posture * 2 : 0;
  const y = base + slump - Math.max(0, breathe);

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x - 8, base + 1, 16, 4);

  const bodyH = 14 - slump * 0.5;
  ctx.fillStyle = "#dfe3ea";
  ctx.fillRect(x - 5, y - 4 - bodyH, 10, bodyH);
  ctx.fillStyle = "#f0d9b8";
  ctx.fillRect(x - 4, y - 4 - bodyH - 8, 8, 8);
  ctx.fillStyle = "#3a4a8a";
  ctx.fillRect(x - 1 + f, y - 4 - bodyH - 5, 3, 2);

  const bob = agent.moving ? Math.floor(now / 120) % 2 : 0;
  ctx.fillStyle = "#7a7f8a";
  ctx.fillRect(x - 4, y - 4, 3, 4 + bob);
  ctx.fillRect(x + 1, y - 4, 3, 4 + (1 - bob));

  if (idle && agent.action) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const p = (Math.sin(now / 240) + 1) / 2;
    ctx.fillRect(x + f * 8, y - 12 - bodyH - Math.round(p * 3), 3, 3);
  }
}

function drawNightTint(ctx, w) {
  const light = daylight(w.dayFrac);
  if (light >= 0.98) return;
  ctx.fillStyle = `rgba(10,14,40,${(1 - light) * 0.5})`;
  ctx.fillRect(0, 0, W, PLAYFIELD_H);
}

function drawStrip(ctx, w) {
  const top = PLAYFIELD_H;
  ctx.fillStyle = "#0e1116";
  ctx.fillRect(0, top, W, H - top);
  ctx.fillStyle = "#1c2230";
  ctx.fillRect(0, top, W, 2);

  let by = top + 7;
  for (const id of NEED_IDS) {
    drawBar(ctx, 12, by, 150, 6, w.agent.needs[id], NEED_COLOR[id], id);
    by += 9;
  }

  const hh = Math.floor(w.dayFrac * 24);
  const mm = Math.floor((w.dayFrac * 24 * 60) % 60);
  ctx.fillStyle = "#c8ccd4";
  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText(`DAY ${w.day}`, 210, top + 8);
  ctx.fillText(`${pad(hh)}:${pad(mm)} ${w.isNight ? "night" : "day"}`, 210, top + 22);
  ctx.fillText(`${w.era.name}`, 210, top + 36);

  ctx.fillText("rep", 332, top + 8);
  ctx.fillStyle = repColor(w.reputation);
  ctx.fillRect(356, top + 8, 10, 10);
  ctx.fillStyle = "#c8ccd4";
  ctx.fillText(`${Math.round(w.reputation)}`, 372, top + 8);
  ctx.fillText(`queue ${"|".repeat(w.requests) || "-"}`, 332, top + 22);
  ctx.fillStyle = "#5f6675";
  ctx.font = "8px ui-monospace, Menlo, monospace";
  ctx.fillText(`${w.weather.sky} · mood ${moodWord(w.mood)}`, 332, top + 38);

  ctx.fillStyle = "#8b93a3";
  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.fillText(`> ${w.agent.lastThought}`, 12, top + 46);
}

function drawMute(ctx, muted) {
  const r = MUTE_RECT;
  ctx.fillStyle = muted ? "#e06a5c" : "#7f8a9c";
  // speaker body
  ctx.fillRect(r.x, r.y + 5, 4, 8);
  ctx.beginPath();
  ctx.moveTo(r.x + 4, r.y + 9);
  ctx.lineTo(r.x + 10, r.y + 3);
  ctx.lineTo(r.x + 10, r.y + 15);
  ctx.closePath();
  ctx.fill();
  if (muted) {
    ctx.strokeStyle = "#e06a5c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r.x + 12, r.y + 4);
    ctx.lineTo(r.x + 19, r.y + 14);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "#7f8a9c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(r.x + 11, r.y + 9, 4, -0.9, 0.9);
    ctx.stroke();
  }
}

function drawBar(ctx, x, y, wdt, hgt, val, color, label) {
  ctx.fillStyle = "#20242e";
  ctx.fillRect(x, y, wdt, hgt);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.round((val / 100) * wdt), hgt);
  ctx.fillStyle = "#0e1116";
  ctx.font = "8px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText(label.slice(0, 3).toUpperCase(), x + 3, y);
}

function drawDebug(ctx, w) {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, 168, 66);
  ctx.fillStyle = "#7dff9d";
  ctx.font = "9px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "top";
  const p = w.agent.personality;
  ctx.fillText(`seed ${w.seed}  era ${w.era.id}`, 4, 4);
  ctx.fillText(`dil ${p.diligence.toFixed(2)} soc ${p.sociability.toFixed(2)}`, 4, 16);
  ctx.fillText(`cur ${p.curiosity.toFixed(2)} rst ${p.restlessness.toFixed(2)}`, 4, 28);
  ctx.fillText(`mood v${w.mood.valence.toFixed(2)} s${w.mood.strain.toFixed(2)}`, 4, 40);
  ctx.fillText(`${w.agent.room} / ${w.agent.action ? w.agent.action.id : "-"}`, 4, 52);
}

function drawMemoryOverlay(ctx, w) {
  panel(ctx);
  ctx.fillStyle = "#c8ccd4";
  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText(`WHAT THIS LIFE REMEMBERS  ·  day ${w.day}`, 40, 40);
  const p = w.agent.personality;
  ctx.fillStyle = "#8b93a3";
  ctx.font = "9px ui-monospace, Menlo, monospace";
  ctx.fillText(
    `now: dil ${p.diligence.toFixed(2)}  soc ${p.sociability.toFixed(2)}  cur ${p.curiosity.toFixed(2)}  rst ${p.restlessness.toFixed(2)}`,
    40,
    58,
  );
  let y = 80;
  if (w.memory.slots.length === 0) {
    ctx.fillStyle = "#5f6675";
    ctx.fillText("nothing yet — it hasn't sat down to reflect", 40, y);
  }
  for (const s of [...w.memory.slots].sort((a, b) => b.weight - a.weight)) {
    ctx.fillStyle = TRAIT_COLOR[s.trait] ?? "#888";
    ctx.fillRect(40, y + 1, 8, 8);
    ctx.fillStyle = "#c3c8d2";
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.fillText(clip(s.text, 62), 54, y);
    ctx.fillStyle = "#6b7280";
    ctx.font = "8px ui-monospace, Menlo, monospace";
    ctx.fillText(`d${s.bornDay}  ${s.trait}${s.dir > 0 ? "+" : "-"}  strength ${s.weight.toFixed(1)}`, 54, y + 12);
    y += 26;
  }
  ctx.fillStyle = "#5f6675";
  ctx.font = "9px ui-monospace, Menlo, monospace";
  ctx.fillText("[M] close", 40, PLAYFIELD_H - 40);
}

function drawSeedCard(ctx, w) {
  panel(ctx);
  const p = w.agent.personality;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#e0e4ec";
  ctx.font = "13px ui-monospace, Menlo, monospace";
  ctx.fillText("SIMYOU — this life", 40, 44);
  ctx.fillStyle = "#8b93a3";
  ctx.font = "10px ui-monospace, Menlo, monospace";
  const lines = [
    `seed        ${w.seed}`,
    `age         day ${w.day}  ·  ${w.era.name}`,
    `tokens      ${w.tokens}`,
    `reputation  ${Math.round(w.reputation)}`,
    ``,
    `character   diligence   ${bar10(p.diligence)}`,
    `            sociability ${bar10(p.sociability)}`,
    `            curiosity   ${bar10(p.curiosity)}`,
    `            restless    ${bar10(p.restlessness)}`,
    ``,
    `remembers   ${w.memory.slots.length} / 12 memories`,
  ];
  let y = 72;
  for (const l of lines) {
    ctx.fillText(l, 40, y);
    y += 15;
  }
  const top = [...w.memory.slots].sort((a, b) => b.weight - a.weight).slice(0, 3);
  ctx.fillStyle = "#c3c8d2";
  for (const s of top) {
    ctx.fillText(`· ${clip(s.text, 56)}`, 40, y);
    y += 14;
  }
  ctx.fillStyle = "#5f6675";
  ctx.font = "9px ui-monospace, Menlo, monospace";
  ctx.fillText("replay: ?seed=" + w.seed + "   ·   [S] close", 40, PLAYFIELD_H - 40);
}

function drawTitle(ctx, w) {
  ctx.fillStyle = "rgba(6,8,12,0.86)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e6e9f0";
  ctx.font = "34px ui-monospace, Menlo, monospace";
  ctx.fillText("SIMYOU", W / 2, H / 2 - 60);
  ctx.fillStyle = "#8b93a3";
  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.fillText("a life that runs itself", W / 2, H / 2 - 30);
  ctx.fillText(`seed ${w.seed}`, W / 2, H / 2 + 6);
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 500);
  ctx.fillStyle = `rgba(230,233,240,${0.35 + pulse * 0.5})`;
  ctx.font = "12px ui-monospace, Menlo, monospace";
  ctx.fillText("click to begin", W / 2, H / 2 + 44);
  ctx.fillStyle = "#5f6675";
  ctx.font = "9px ui-monospace, Menlo, monospace";
  ctx.fillText("sound is off — press P or click the speaker", W / 2, H / 2 + 68);
  ctx.textAlign = "left";
}

// --- helpers ---
function panel(ctx) {
  ctx.fillStyle = "rgba(6,8,12,0.92)";
  ctx.fillRect(24, 24, W - 48, PLAYFIELD_H - 48);
  ctx.strokeStyle = "#242b38";
  ctx.strokeRect(24, 24, W - 48, PLAYFIELD_H - 48);
}
function bar10(v) {
  const n = Math.round(Math.max(0, Math.min(1, v)) * 10);
  return "#".repeat(n) + "-".repeat(10 - n);
}
function daylight(frac) {
  if (frac < 0.04 || frac >= 0.66) {
    const nightPhase = frac < 0.04 ? 0.5 + frac * 5 : (frac - 0.66) / 0.34;
    return 0.52 + 0.12 * Math.cos(nightPhase * Math.PI);
  }
  if (frac < 0.12) return 0.5 + ((frac - 0.04) / 0.08) * 0.5;
  if (frac > 0.58) return 1 - ((frac - 0.58) / 0.08) * 0.5;
  return 1;
}
function shade(hex, mul) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${clampByte(((n >> 16) & 255) * mul)},${clampByte(((n >> 8) & 255) * mul)},${clampByte((n & 255) * mul)})`;
}
function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}
function repColor(r) {
  return r >= 66 ? "#7ad0a0" : r >= 33 ? "#e0b45c" : "#e06a5c";
}
function clip(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
