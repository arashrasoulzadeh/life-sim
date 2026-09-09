// Browser viewer. The life runs on the server (server.mjs). This subscribes to
// /stream, renders a 2x3 grid of the six rooms (or one zoomed room), rotates the
// desk-monitor iframe through sites.json, loads the current AI-authored game in
// the game room, and reports viewer attention so the life earns coins.

import * as Audio from "./engine/audio.js";
import { render, MUTE_RECT } from "./render/draw.js";
import { rainIntensity } from "./sim/weather.js";

const ROOM_IDS = ["window", "kitchen", "desk", "couch", "bed", "game"];

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
const roomsEl = document.getElementById("rooms");
const zoomBtn = document.getElementById("zoombtn");
const tbSeed = document.getElementById("tb-seed");
const tbTok = document.getElementById("tb-tok");

let world = null;
let audioReady = false;
let lastFx = 0;
let moodPush = 0;
const display = { x: 256, y: 300, has: false };

const ui = {
  debug: new URLSearchParams(location.search).has("debug"),
  showMemory: false,
  showCard: false,
  showConversation: false,
  muted: true,
  llm: false,
  llmSource: "offline",
  notice: null,
  zoom: safeLS("simyou_zoom") || null,
};

// viewer id — coarse, only for the per-viewer income cap
let viewerId = safeLS("simyou_viewer");
if (!viewerId) {
  viewerId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  safeLS("simyou_viewer", viewerId);
}

// ---------- rooms grid ----------
const cells = {}; // roomId -> { cell, roomHost }
for (const rid of ROOM_IDS) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.dataset.room = rid;
  const host = document.createElement("div");
  cell.appendChild(host);
  cells[rid] = { cell, roomHost: host };
  roomsEl.appendChild(cell);
}
let shownRoomsVersion = -1;
let roomOrder = [...ROOM_IDS];

function applyZoomClass() {
  const z = ui.zoom;
  roomsEl.classList.toggle("grid", !z);
  roomsEl.classList.toggle("zoom", !!z);
  for (const rid of ROOM_IDS) cells[rid].cell.classList.toggle("active", rid === z);
  zoomBtn.hidden = !z;
}
function setZoom(z) {
  ui.zoom = z || null;
  safeLS("simyou_zoom", ui.zoom || "");
  applyZoomClass();
}
applyZoomClass();

async function refreshRooms() {
  try {
    const r = await fetch("/api/rooms", { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    roomOrder = Array.isArray(data.order) && data.order.length === 6 ? data.order : [...ROOM_IDS];
    for (const rid of ROOM_IDS) {
      const doc = data.rooms[rid];
      if (doc && cells[rid].roomHost.innerHTML !== doc.html) cells[rid].roomHost.innerHTML = doc.html;
      cells[rid].cell.style.order = roomOrder.indexOf(rid);
    }
    shownRoomsVersion = data.version;
    mountFrames();
  } catch {
    /* ignore */
  }
}

// ---------- iframes (monitor + game) ----------
let sites = { rotateSeconds: 45, sites: [] };
let siteIdx = 0;
let siteRotateAt = 0;
let mountedGameId = -1;

fetch("/api/sites")
  .then((r) => r.json())
  .then((s) => {
    sites = s && Array.isArray(s.sites) ? s : sites;
  })
  .catch(() => {});

function mountFrames() {
  const siteFrame = cells.desk.roomHost.querySelector(".site-frame");
  if (siteFrame && sites.sites.length && !siteFrame.src) {
    siteFrame.src = sites.sites[siteIdx % sites.sites.length].url;
    siteRotateAt = performance.now() + (sites.rotateSeconds || 45) * 1000;
  }
  const gameFrame = cells.game.roomHost.querySelector(".game-frame");
  const gid = world?.latestGameId || 0;
  if (gameFrame && gid && mountedGameId !== gid) {
    gameFrame.src = `/games/${gid}`;
    mountedGameId = gid;
  }
}

function rotateSite(now) {
  if (!sites.sites.length || now < siteRotateAt) return;
  siteIdx = (siteIdx + 1) % sites.sites.length;
  const f = cells.desk.roomHost.querySelector(".site-frame");
  if (f) f.src = sites.sites[siteIdx].url;
  siteRotateAt = now + (sites.rotateSeconds || 45) * 1000;
}

// ---------- attention / income heartbeat ----------
setInterval(() => {
  if (document.visibilityState !== "visible" || !world) return;
  if (!cells.desk.roomHost.querySelector(".site-frame")) return;
  const site = sites.sites[siteIdx % (sites.sites.length || 1)];
  if (!site) return;
  fetch("/api/impression", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ site: site.id, seconds: 10, viewer: viewerId }),
  }).catch(() => {});
}, 10000);

// ---------- stream ----------
function connect() {
  const es = new EventSource("/stream");
  es.onmessage = (e) => {
    let snap;
    try {
      snap = JSON.parse(e.data);
    } catch {
      return;
    }
    world = snap;
    ui.llm = !!snap.gapgpt;
    ui.llmSource = snap.gapgpt ? "gapgpt" : "offline";
    if (Array.isArray(snap.fx)) {
      for (const f of snap.fx) {
        if (f.n > lastFx) {
          lastFx = f.n;
          if (audioReady) Audio.blip(f.t);
        }
      }
    }
    if (snap.roomsVersion !== shownRoomsVersion) refreshRooms();
    if ((snap.latestGameId || 0) !== mountedGameId) mountFrames();
  };
  es.onerror = () => {};
}
connect();

// ---------- render loop ----------
function frame(now) {
  requestAnimationFrame(frame);
  rotateSite(now);
  if (!world) {
    ctx.clearRect(0, 0, 512, 512);
    return;
  }

  const a = world.agent;
  if (!display.has) {
    display.x = a.x;
    display.y = a.y;
    display.has = true;
  } else if (a.transit > 0) {
    display.x = a.x;
    display.y = a.y;
  } else {
    display.x += (a.x - display.x) * 0.25;
    display.y += (a.y - display.y) * 0.25;
  }

  const w = {
    ...world,
    started: true,
    roomOrder,
    agent: { ...a, x: display.x, y: display.y },
  };

  if (audioReady && Audio.isReady()) {
    Audio.setRain(rainIntensity(world.weather.sky));
    Audio.update();
    moodPush -= 1 / 60;
    if (moodPush <= 0) {
      Audio.setMood(world.mood.valence);
      moodPush = 1.5;
    }
  }

  tbSeed.textContent = `seed ${world.seed}`;
  tbTok.textContent = `◊ ${world.bank} coins`;
  if (ui.notice && performance.now() > ui.notice.until) ui.notice = null;

  render(ctx, w, ui);
}
requestAnimationFrame(frame);

// ---------- input ----------
function ensureAudio() {
  if (audioReady) return;
  audioReady = true;
  Audio.start(world ? world.seed : 0);
  Audio.setMuted(ui.muted);
}
function toggleMute() {
  ensureAudio();
  ui.muted = !ui.muted;
  Audio.setMuted(ui.muted);
}

canvas.addEventListener("click", (e) => {
  const r = canvas.getBoundingClientRect();
  const cx = ((e.clientX - r.left) / r.width) * canvas.width;
  const cy = ((e.clientY - r.top) / r.height) * canvas.height;
  const m = MUTE_RECT;
  if (cx >= m.x - 4 && cx <= m.x + m.w + 4 && cy >= m.y - 4 && cy <= m.y + m.h + 4) {
    toggleMute();
    return;
  }
  ensureAudio();
  if (!ui.zoom && cy < 448) {
    const col = cx < 256 ? 0 : 1;
    const row = Math.min(2, Math.floor(cy / (448 / 3)));
    const idx = row * 2 + col;
    if (roomOrder[idx]) setZoom(roomOrder[idx]);
  }
});

zoomBtn.addEventListener("click", () => setZoom(null));

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (e.key === "Escape") return setZoom(null);
  if (k === "m") ui.showMemory = !ui.showMemory;
  else if (k === "c") ui.showConversation = !ui.showConversation;
  else if (k === "s") ui.showCard = !ui.showCard;
  else if (k === "d") ui.debug = !ui.debug;
  else if (k === "p") toggleMute();
});

function safeLS(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {
    return null;
  }
}
