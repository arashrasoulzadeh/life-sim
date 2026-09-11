import { ROOMS } from "../sim/rooms.js";
import { NEED_IDS } from "../sim/constants.js";
import { moodWord, moodPosture } from "../sim/mood.js";
import { rainIntensity } from "../sim/weather.js";
import { CORRIDOR_Y } from "../sim/agent.js";

export const W = 512;
export const H = 512;
export const PLAYFIELD_H = 448;

const NEED_COLOR = {
  focus: "#e0b45c",
  energy: "#e06a5c",
  social: "#7ad0a0",
  curiosity: "#8fb8e8",
  hunger: "#d98555",
};

const TRAIT_COLOR = {
  diligence: "#e0b45c",
  sociability: "#7ad0a0",
  curiosity: "#8fb8e8",
  restlessness: "#c98bd0",
};

// clickable hit-box for the mute toggle, in canvas pixels
export const MUTE_RECT = { x: 488, y: 451, w: 20, h: 18 };

// The room scene (walls, floor, furniture, objects) is an HTML layer behind the
// canvas — see index.html #room-html and src/sim/worldfiles.js. The canvas only
// paints what needs per-frame motion: the agent, the animated window sky, the
// memory wall, tints, the corridor, and all the UI.
const GRID_COLS = 2;
const GRID_ROWS = 3;

export function render(ctx, w, ui) {
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;

  if (ui.zoom) {
    const view = ui.zoom;
    const inHall = w.agent.transit > 0 && w.agent.room === view;
    if (inHall) {
      drawCorridor(ctx, w);
    } else {
      if (view === "window") drawSky(ctx, w);
      if (view === "bed") drawMemoryWall(ctx, w);
    }
    if (w.pet && w.pet.room === view && !inHall) drawPet(ctx, w);
    if (w.partner && w.partner.room === view && w.partner.transit <= 0 && !inHall) drawAgent(ctx, w, w.partner);
    for (const r of w.extras || []) if (r.room === view && r.transit <= 0 && !inHall) drawAgent(ctx, w, r);
    if (inHall || (w.agent.room === view && w.agent.transit <= 0)) drawAgent(ctx, w);
    if (w.partner && w.partner.transit > 0 && w.partner.room === view) drawAgent(ctx, w, w.partner);
    for (const r of w.extras || []) if (r.transit > 0 && r.room === view) drawAgent(ctx, w, r);
    drawNightTint(ctx, w);
    drawSeasonTint(ctx, w);
    if (w.era.tint) {
      ctx.fillStyle = w.era.tint;
      ctx.fillRect(0, 0, W, PLAYFIELD_H);
    }
    if (!inHall) drawBubble(ctx, w, 256);
  } else {
    drawGridLabels(ctx, w);
    // the animated features that only the canvas can do, rendered into their cell
    inCell(ctx, w, "window", () => drawSky(ctx, w));
    inCell(ctx, w, "bed", () => drawMemoryWall(ctx, w));
    if (w.pet && w.pet.room) inCell(ctx, w, w.pet.room, () => drawPet(ctx, w, 0.5));
    drawGridAgent(ctx, w);
    drawNightTint(ctx, w);
    drawSeasonTint(ctx, w);
    if (w.era.tint) {
      ctx.fillStyle = w.era.tint;
      ctx.fillRect(0, 0, W, PLAYFIELD_H);
    }
    const cx = agentCellCenterX(w);
    if (cx != null) drawBubble(ctx, w, cx);
  }

  drawStrip(ctx, w, ui);
  drawMute(ctx, ui.muted);
  if (ui.debug) drawDebug(ctx, w);
  if (ui.showMemory) drawMemoryOverlay(ctx, w);
  if (ui.showCard) drawSeedCard(ctx, w);
  if (ui.showConversation) drawConversationOverlay(ctx, w);
  if (ui.notice) drawNotice(ctx, ui.notice.text);
}

function cellRect(i) {
  const cw = W / GRID_COLS;
  const ch = PLAYFIELD_H / GRID_ROWS;
  return { x: (i % GRID_COLS) * cw, y: Math.floor(i / GRID_COLS) * ch, w: cw, h: ch };
}
function cellRectFor(w, roomId) {
  const i = (w.roomOrder || []).indexOf(roomId);
  return i < 0 ? null : cellRect(i);
}
// run a full-playfield draw fn scaled + clipped into a room's grid cell
function inCell(ctx, w, roomId, fn) {
  const r = cellRectFor(w, roomId);
  if (!r) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.translate(r.x, r.y);
  ctx.scale(r.w / W, r.h / PLAYFIELD_H);
  fn();
  ctx.restore();
}
function agentCellIndex(w) {
  const order = w.roomOrder || [];
  return order.indexOf(w.agent.room);
}
function agentCellCenterX(w) {
  const i = agentCellIndex(w);
  if (i < 0) return null;
  const r = cellRect(i);
  return r.x + r.w / 2;
}

function drawGridAgent(ctx, w) {
  gridPerson(ctx, w, w.agent, true);
  if (w.partner) gridPerson(ctx, w, w.partner, false);
  for (const r of w.extras || []) gridPerson(ctx, w, r, false);
}

function gridPerson(ctx, w, agent, highlight) {
  const idx = (w.roomOrder || []).indexOf(agent.room);
  if (idx < 0) return;
  const r = cellRect(idx);
  if (highlight) {
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  }
  const ax = r.x + (agent.x / W) * r.w;
  const ay = r.y + (agent.y / PLAYFIELD_H) * r.h;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.scale(0.5, 0.5);
  if (agent.transit > 0) ctx.globalAlpha = 0.55;
  const look = agent.look || {};
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(-8, 1, 16, 4);
  ctx.fillStyle = look.shirt || "#dfe3ea";
  ctx.fillRect(-5, -18, 10, 14);
  ctx.fillStyle = look.skin || "#f0d9b8";
  ctx.fillRect(-4, -27, 8, 8);
  ctx.fillStyle = look.hair || "#221c18";
  ctx.fillRect(-4, -28, 8, 3);
  if (look.long) {
    ctx.fillRect(-5, -28, 2, 8);
    ctx.fillRect(3, -28, 2, 8);
  }
  ctx.fillStyle = "#7a7f8a";
  ctx.fillRect(-4, -4, 3, 5);
  ctx.fillRect(1, -4, 3, 5);
  ctx.restore();
}

function drawGridLabels(ctx, w) {
  // faint cell dividers so the 2x3 grid reads even before the HTML paints
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  for (let c = 1; c < GRID_COLS; c++) {
    ctx.beginPath();
    ctx.moveTo((W / GRID_COLS) * c, 0);
    ctx.lineTo((W / GRID_COLS) * c, PLAYFIELD_H);
    ctx.stroke();
  }
  for (let ro = 1; ro < GRID_ROWS; ro++) {
    ctx.beginPath();
    ctx.moveTo(0, (PLAYFIELD_H / GRID_ROWS) * ro);
    ctx.lineTo(W, (PLAYFIELD_H / GRID_ROWS) * ro);
    ctx.stroke();
  }
  void w;
}

function drawNotice(ctx, text) {
  ctx.font = "9px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const w = ctx.measureText(text).width + 20;
  ctx.fillStyle = "rgba(8,10,14,0.92)";
  ctx.fillRect(W / 2 - w / 2, 8, w, 18);
  ctx.strokeStyle = "#3d4452";
  ctx.strokeRect(W / 2 - w / 2, 8, w, 18);
  ctx.fillStyle = "#c8ccd4";
  ctx.fillText(text, W / 2, 13);
  ctx.textAlign = "left";
}

function drawCorridor(ctx, w) {
  const light = daylight(w.dayFrac) * 0.75 + 0.1;
  ctx.fillStyle = shade("#161a22", light);
  ctx.fillRect(0, 0, W, PLAYFIELD_H);
  ctx.fillStyle = shade("#242a36", light);
  ctx.fillRect(0, CORRIDOR_Y + 8, W, PLAYFIELD_H - CORRIDOR_Y - 8);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(0, CORRIDOR_Y + 6, W, 3);

  const order = ["window", "kitchen", "desk", "couch", "bed"];
  order.forEach((rid, i) => {
    const x = 26 + i * 94;
    ctx.fillStyle = "#0d1017";
    ctx.fillRect(x, CORRIDOR_Y - 66, 52, 72);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = ROOMS[rid].palette.accent;
    ctx.fillRect(x + 4, CORRIDOR_Y - 62, 44, 64);
    ctx.globalAlpha = 1;
    ctx.fillStyle = rid === w.agent.room ? "#c8ccd4" : "#3d4452";
    ctx.font = "7px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "top";
    ctx.fillText(rid, x + 4, CORRIDOR_Y - 78);
  });

  // pooled ceiling light
  ctx.fillStyle = "rgba(255,240,205,0.05)";
  ctx.beginPath();
  ctx.moveTo(W / 2 - 40, 0);
  ctx.lineTo(W / 2 + 40, 0);
  ctx.lineTo(W / 2 + 130, CORRIDOR_Y);
  ctx.lineTo(W / 2 - 130, CORRIDOR_Y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#5f6675";
  ctx.font = "9px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText(`— the hallway → ${w.agent.room} —`, 12, PLAYFIELD_H - 22);
}

function drawBubble(ctx, w, anchorX = 256) {
  const b = w.conversation && w.conversation.bubble;
  if (!b) return;
  const lines = wrapText(b.line || "", 32).slice(0, 3);
  const bw = 244;
  const bh = 20 + lines.length * 12 + (b.changes && b.changes.length ? Math.min(4, b.changes.length) * 10 + 4 : 0);
  const bx = Math.max(8, Math.min(W - bw - 8, Math.round(anchorX) - bw / 2));
  const by = 54;
  ctx.fillStyle = "rgba(8,10,14,0.94)";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = b.source === "gapgpt" ? "#7ad0a0" : "#3d4452";
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = "rgba(8,10,14,0.94)";
  const tx = Math.max(bx + 10, Math.min(bx + bw - 16, Math.round(anchorX) - 3));
  ctx.fillRect(tx, by + bh, 6, 6);

  ctx.fillStyle = "#5f6675";
  ctx.font = "7px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText(`${b.phase} · day ${b.day} · ${b.source}`, bx + 8, by + 5);
  ctx.fillStyle = "#d3d7df";
  ctx.font = "10px ui-monospace, Menlo, monospace";
  lines.forEach((l, i) => ctx.fillText(l, bx + 8, by + 16 + i * 12));
  let yy = by + 16 + lines.length * 12 + 2;
  ctx.font = "8px ui-monospace, Menlo, monospace";
  for (const c of (b.changes || []).slice(0, 4)) {
    ctx.fillStyle = c[0] === "+" || c[0] === "🎮" ? "#7ad0a0" : c[0] === "−" ? "#e0b45c" : "#8b93a3";
    ctx.fillText(c, bx + 8, yy);
    yy += 10;
  }
}

function drawConversationOverlay(ctx, w) {
  panel(ctx);
  ctx.fillStyle = "#c8ccd4";
  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText("START & END OF DAY", 40, 40);
  const log = (w.conversation && w.conversation.log) || [];
  if (log.length === 0) {
    ctx.fillStyle = "#5f6675";
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.fillText("no conversations yet", 40, 60);
  }
  let y = 62;
  for (const e of log.slice(0, 6)) {
    if (y > PLAYFIELD_H - 70) break;
    ctx.fillStyle = e.source === "gapgpt" ? "#7ad0a0" : e.source === "error" ? "#e06a5c" : "#8b93a3";
    ctx.font = "8px ui-monospace, Menlo, monospace";
    ctx.fillText(`day ${e.day} · ${e.phase} · ${e.source}`, 40, y);
    ctx.fillStyle = "#d3d7df";
    ctx.font = "10px ui-monospace, Menlo, monospace";
    for (const l of wrapText(e.line || "", 62).slice(0, 2)) {
      y += 12;
      ctx.fillText(l, 40, y);
    }
    if (e.reply) {
      ctx.fillStyle = "#8b93a3";
      ctx.font = "9px ui-monospace, Menlo, monospace";
      for (const l of wrapText(e.reply, 70).slice(0, 3)) {
        y += 11;
        ctx.fillText("“" + l + "”", 46, y);
      }
    }
    for (const c of (e.changes || []).slice(0, 4)) {
      y += 10;
      ctx.fillStyle = c[0] === "−" ? "#e0b45c" : "#7ad0a0";
      ctx.font = "8px ui-monospace, Menlo, monospace";
      ctx.fillText("   " + c, 40, y);
    }
    y += 16;
  }
  ctx.fillStyle = "#5f6675";
  ctx.font = "9px ui-monospace, Menlo, monospace";
  ctx.fillText("[C] close", 40, PLAYFIELD_H - 40);
}

function wrapText(s, n) {
  const words = String(s).split(/\s+/);
  const out = [];
  let line = "";
  for (const wd of words) {
    if ((line + " " + wd).trim().length > n) {
      if (line) out.push(line);
      line = wd;
    } else {
      line = (line + " " + wd).trim();
    }
  }
  if (line) out.push(line);
  return out;
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
  ctx.fillText(`MEMORY  ${w.memory.held ?? slots.length} held`, x0, y0 - 14);
  const shown = [...slots].sort((a, b) => b.weight - a.weight).slice(0, 11);
  for (let i = 0; i < 11; i++) {
    const cx = x0 + (i % cols) * (cell + gap);
    const cy = y0 + Math.floor(i / cols) * (cell + gap);
    const s = shown[i];
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

function drawAgent(ctx, w, agent = w.agent) {
  const look = agent.look || {};
  const x = Math.round(agent.x);
  const base = Math.round(agent.y);
  let f = agent.facing;
  const posture = moodPosture(w.mood);
  const now = performance.now();

  const idle = !agent.moving;
  const g = agent.gesture;
  let breathe = idle ? Math.sin(now / (posture > 0 ? 500 : 900)) * (0.6 + posture * 0.5) : 0;
  let slump = idle && posture < 0 ? -posture * 2 : 0;
  let squash = 0;
  if (g === "hop") breathe = -Math.abs(Math.sin(now / 90)) * 6;
  else if (g === "sit") slump = 6;
  else if (g === "nod") breathe = Math.sin(now / 130) * 2;
  else if (g === "spin") f = Math.sin(now / 120) > 0 ? 1 : -1;
  else if (g === "wave") squash = 0;
  const y = base + slump - Math.max(0, breathe);

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x - 8, base + 1, 16, 4);

  const bodyH = 14 - slump * 0.4 - squash;
  ctx.fillStyle = look.shirt || "#dfe3ea";
  ctx.fillRect(x - 5, y - 4 - bodyH, 10, bodyH);
  ctx.fillStyle = look.skin || "#f0d9b8";
  ctx.fillRect(x - 4, y - 4 - bodyH - 8, 8, 8);
  // hair
  ctx.fillStyle = look.hair || "#221c18";
  ctx.fillRect(x - 4, y - 4 - bodyH - 9, 8, 3);
  if (look.long) {
    ctx.fillRect(x - 5, y - 4 - bodyH - 9, 2, 9);
    ctx.fillRect(x + 3, y - 4 - bodyH - 9, 2, 9);
  }
  ctx.fillStyle = look.visor || "#3a4a8a";
  ctx.fillRect(x - 1 + f, y - 4 - bodyH - 5, 3, 2);

  const bob = agent.moving ? Math.floor(now / 120) % 2 : 0;
  ctx.fillStyle = "#7a7f8a";
  ctx.fillRect(x - 4, y - 4, 3, 4 + bob);
  ctx.fillRect(x + 1, y - 4, 3, 4 + (1 - bob));

  if (g === "wave") {
    ctx.fillStyle = look.skin || "#f0d9b8";
    const wy = y - 4 - bodyH + Math.sin(now / 80) * 3;
    ctx.fillRect(x + f * 5, wy - 4, 3, 6);
  }

  if (idle && (agent.action || g)) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const p = (Math.sin(now / 240) + 1) / 2;
    ctx.fillRect(x + f * 8, y - 12 - bodyH - Math.round(p * 3), 3, 3);
  }

  if (agent.routineSay) {
    const t = agent.routineSay.slice(0, 40);
    ctx.font = "9px ui-monospace, Menlo, monospace";
    const bw = ctx.measureText(t).width + 12;
    const bx = Math.max(6, Math.min(W - bw - 6, x - bw / 2));
    const by = y - 4 - bodyH - 24;
    ctx.fillStyle = "rgba(8,10,14,0.92)";
    ctx.fillRect(bx, by, bw, 14);
    ctx.fillStyle = "#d3d7df";
    ctx.textBaseline = "top";
    ctx.fillText(t, bx + 6, by + 3);
  }

  // idle micro-behaviour: a small emote above the head
  const micro = agent.micro;
  if (micro && !agent.moving) {
    const glyph = MICRO_GLYPH[micro.kind] || "·";
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(220,225,235,0.9)";
    const wob = Math.sin(now / 160) * 1.5;
    ctx.fillText(glyph, x - 4, y - 4 - bodyH - 14 + wob);
  }
}

const MICRO_GLYPH = { stretch: "↑", glance: "👀", sip: "☕", hum: "♪", shift: "≈", yawn: "~", tidy: "✦", cheer: "🙌", point: "👉", laugh: "😄" };

function drawPet(ctx, w, scaleHint = 1) {
  const p = w.pet;
  if (!p) return;
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  const now = performance.now();
  const sleeping = p.state === "sleep" || p.state === "nap";
  const bob = sleeping ? 0 : Math.abs(Math.sin(now / 300)) * 1.5;

  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(x - 6, y + 1, 12, 3);

  // little body
  ctx.fillStyle = "#5b5560";
  const bl = 12, bh = sleeping ? 4 : 6;
  ctx.fillRect(x - bl / 2, y - bh - bob, bl, bh);
  // head
  const hx = p.facing < 0 ? x - bl / 2 - 3 : x + bl / 2 - 3;
  ctx.fillRect(hx, y - bh - 4 - bob, 6, 5);
  // ears
  ctx.fillRect(hx, y - bh - 7 - bob, 2, 3);
  ctx.fillRect(hx + 4, y - bh - 7 - bob, 2, 3);
  // tail
  ctx.fillStyle = "#4a454f";
  const tx = p.facing < 0 ? x + bl / 2 : x - bl / 2 - 3;
  ctx.fillRect(tx, y - bh - 2 - bob, 3, 2);

  if (sleeping) {
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillStyle = "rgba(200,205,215,0.7)";
    ctx.fillText("z", x + 6, y - bh - 6 + Math.sin(now / 500) * 2);
  } else if (p.state === "play") {
    ctx.fillStyle = "rgba(230,180,90,0.9)";
    ctx.fillRect(x + p.facing * 8, y - bh - 2, 2, 2);
  }
  if (p.name && scaleHint === 1) {
    ctx.font = "8px ui-monospace, Menlo, monospace";
    ctx.fillStyle = "rgba(200,205,215,0.6)";
    ctx.textAlign = "center";
    ctx.fillText(p.name, x, y - bh - 12 - bob);
    ctx.textAlign = "left";
  }
}

function drawNightTint(ctx, w) {
  const light = daylight(w.dayFrac);
  if (light >= 0.98) return;
  ctx.fillStyle = `rgba(10,14,40,${(1 - light) * 0.5})`;
  ctx.fillRect(0, 0, W, PLAYFIELD_H);
}

function drawStrip(ctx, w, ui) {
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
  ctx.fillStyle = "#e0b45c";
  ctx.fillText(`◊ ${w.bank ?? 0}`, 210, top + 36);
  ctx.fillStyle = "#c8ccd4";

  ctx.fillText("rep", 332, top + 8);
  ctx.fillStyle = repColor(w.reputation);
  ctx.fillRect(356, top + 8, 10, 10);
  ctx.fillStyle = "#c8ccd4";
  ctx.fillText(`${Math.round(w.reputation)}`, 372, top + 8);
  ctx.fillText(`queue ${"|".repeat(w.requests) || "-"}`, 332, top + 22);
  ctx.fillStyle = "#5f6675";
  ctx.font = "8px ui-monospace, Menlo, monospace";
  const llm = ui && ui.llm ? (ui.llmSource === "gapgpt" ? " · ◆gapgpt" : " · ◇talk") : "";
  ctx.fillText(`${w.weather.sky} · mood ${moodWord(w.mood)}${llm}`, 332, top + 38);

  if (w.goal && !w.goal.done && !w.goal.failed) {
    const frac = Math.max(0, Math.min(1, w.goal.frac || 0));
    ctx.fillStyle = "#7f8a9c";
    ctx.font = "8px ui-monospace, Menlo, monospace";
    ctx.fillText(`◎ ${String(w.goal.text || "").slice(0, 40)}`, 210, top + 48);
    ctx.fillStyle = "#20242e";
    ctx.fillRect(210, top + 58, 150, 4);
    ctx.fillStyle = "#6bb58a";
    ctx.fillRect(210, top + 58, 150 * frac, 4);
  }

  ctx.fillStyle = "#8b93a3";
  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.fillText(`> ${w.agent.lastThought}`, 12, top + 46);
}

const SEASON_TINT = {
  spring: "rgba(150,205,130,0.05)",
  summer: "rgba(255,210,120,0.06)",
  autumn: "rgba(210,130,70,0.07)",
  winter: "rgba(150,180,225,0.07)",
};
function drawSeasonTint(ctx, w) {
  const t = SEASON_TINT[w.outside && w.outside.season];
  if (!t) return;
  ctx.fillStyle = t;
  ctx.fillRect(0, 0, W, PLAYFIELD_H);
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
  ctx.fillText(`tag ${w.seedTag}  era ${w.era.id}`, 4, 4);
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
  for (const s of [...w.memory.slots].sort((a, b) => b.weight - a.weight).slice(0, 11)) {
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
    `tag         ${w.seedTag}`,
    `age         day ${w.day}  ·  ${w.era.name}`,
    `tokens      ${w.tokens}`,
    `reputation  ${Math.round(w.reputation)}`,
    ``,
    `character   diligence   ${bar10(p.diligence)}`,
    `            sociability ${bar10(p.sociability)}`,
    `            curiosity   ${bar10(p.curiosity)}`,
    `            restless    ${bar10(p.restlessness)}`,
    ``,
    `remembers   ${w.memoryTotal || w.memory.slots.length} memories (${w.memory.held ?? w.memory.slots.length} held)`,
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
  ctx.fillText("tag " + w.seedTag + "   ·   [S] close", 40, PLAYFIELD_H - 40);
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
  ctx.fillText(`${w.seedTag}`, W / 2, H / 2 + 6);
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
