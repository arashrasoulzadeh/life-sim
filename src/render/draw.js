import { ROOMS } from "../sim/rooms.js";
import { NEED_IDS } from "../sim/constants.js";

export const W = 512;
export const H = 512;
export const PLAYFIELD_H = 448;

const NEED_COLOR = {
  focus: "#e0b45c",
  energy: "#e06a5c",
  social: "#7ad0a0",
  curiosity: "#8fb8e8",
};

export function render(ctx, w, debug) {
  ctx.imageSmoothingEnabled = false;
  drawRoom(ctx, w.agent.room, w.dayFrac);
  drawFurniture(ctx, w.agent.room);
  drawAgent(ctx, w.agent);
  drawNightTint(ctx, w);
  drawStrip(ctx, w);
  if (debug) drawDebug(ctx, w);
}

function drawRoom(ctx, roomId, dayFrac) {
  const room = ROOMS[roomId];
  const light = daylight(dayFrac);
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
      ctx.fillStyle = a;
      ctx.fillRect(150, 210, 26, 26);
      ctx.fillStyle = "#cfcfd6";
      ctx.fillRect(96, 244, 16, 10);
      break;
    }
    case "window": {
      ctx.fillStyle = "#0c1430";
      ctx.fillRect(150, 70, 212, 150);
      ctx.fillStyle = a;
      ctx.fillRect(156, 76, 200, 138);
      ctx.fillStyle = "#0c1430";
      ctx.fillRect(252, 76, 6, 138);
      ctx.fillRect(156, 140, 200, 6);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      for (let i = 0; i < 7; i++) {
        const bx = 160 + i * 28;
        ctx.fillRect(bx, 150 + (i % 3) * 10, 20, 60);
      }
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

function drawAgent(ctx, agent) {
  if (agent.transit > 0) return;
  const x = Math.round(agent.x);
  const y = Math.round(agent.y);
  const f = agent.facing;

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x - 8, y + 1, 16, 4);
  ctx.fillStyle = "#dfe3ea";
  ctx.fillRect(x - 5, y - 18, 10, 14);
  ctx.fillStyle = "#f0d9b8";
  ctx.fillRect(x - 4, y - 27, 8, 8);
  ctx.fillStyle = "#3a4a8a";
  ctx.fillRect(x - 1 + f * 1, y - 24, 3, 2);

  const bob = agent.moving ? Math.floor(performance.now() / 120) % 2 : 0;
  ctx.fillStyle = "#7a7f8a";
  ctx.fillRect(x - 4, y - 4, 3, 4 + bob);
  ctx.fillRect(x + 1, y - 4, 3, 4 + (1 - bob));

  if (!agent.moving && agent.action) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const p = (Math.sin(performance.now() / 240) + 1) / 2;
    ctx.fillRect(x + f * 8, y - 30 - Math.round(p * 3), 3, 3);
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

  const bx = 12;
  let by = top + 7;
  for (const id of NEED_IDS) {
    drawBar(ctx, bx, by, 150, 6, w.agent.needs[id], NEED_COLOR[id], id);
    by += 9;
  }

  const hh = Math.floor(w.dayFrac * 24);
  const mm = Math.floor((w.dayFrac * 24 * 60) % 60);
  ctx.fillStyle = "#c8ccd4";
  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText(`DAY ${w.day}`, 210, top + 8);
  ctx.fillText(`${pad(hh)}:${pad(mm)} ${w.isNight ? "night" : "day"}`, 210, top + 22);
  ctx.fillText(`tokens ${w.tokens}`, 210, top + 36);

  ctx.fillText("rep", 332, top + 8);
  ctx.fillStyle = repColor(w.reputation);
  ctx.fillRect(356, top + 8, 10, 10);
  ctx.fillStyle = "#c8ccd4";
  ctx.fillText(`${Math.round(w.reputation)}`, 372, top + 8);
  ctx.fillText(`queue ${"|".repeat(w.requests) || "-"}`, 332, top + 22);

  ctx.fillStyle = "#8b93a3";
  ctx.fillText(`> ${w.agent.lastThought}`, 12, top + 46);
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
  ctx.fillRect(0, 0, 160, 66);
  ctx.fillStyle = "#7dff9d";
  ctx.font = "9px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "top";
  const p = w.agent.personality;
  ctx.fillText(`seed ${w.seed}`, 4, 4);
  ctx.fillText(`dil ${p.diligence.toFixed(2)} soc ${p.sociability.toFixed(2)}`, 4, 16);
  ctx.fillText(`cur ${p.curiosity.toFixed(2)} rst ${p.restlessness.toFixed(2)}`, 4, 28);
  ctx.fillText(`room ${w.agent.room}`, 4, 40);
  ctx.fillText(`act ${w.agent.action ? w.agent.action.id : "-"} ${w.agent.actionLeft.toFixed(1)}`, 4, 52);
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
  const r = clampByte(((n >> 16) & 255) * mul);
  const g = clampByte(((n >> 8) & 255) * mul);
  const b = clampByte((n & 255) * mul);
  return `rgb(${r},${g},${b})`;
}
function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}
function repColor(r) {
  if (r >= 66) return "#7ad0a0";
  if (r >= 33) return "#e0b45c";
  return "#e06a5c";
}
