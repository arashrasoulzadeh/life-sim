// Browser viewer. The life runs on the server (server.mjs). Subscribes to
// /stream, renders a 2x3 room grid (zoomable), rotates the desk-monitor iframe
// through sites.json, loads the current game (a validated spec, never code),
// reports viewer attention so the life earns coins, and offers read-only panels.

import * as Audio from "./engine/audio.js";
import { render, MUTE_RECT } from "./render/draw.js";
import { rainIntensity } from "./sim/weather.js";

const ROOM_IDS = ["window", "kitchen", "desk", "couch", "bed", "game"];

const $ = (id) => document.getElementById(id);
const canvas = $("screen");
const ctx = canvas.getContext("2d");
const roomsEl = $("rooms");
const tbSeed = $("tb-seed");
const tbTok = $("tb-tok");
const tbQuote = $("tb-quote");
const connDot = $("conn");

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
let convLog = [];

let viewerId = safeLS("simyou_viewer");
if (!viewerId) {
  viewerId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  safeLS("simyou_viewer", viewerId);
}

// ---------- rooms grid ----------
const cells = {};
for (const rid of ROOM_IDS) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.dataset.room = rid;
  const host = document.createElement("div");
  cell.appendChild(host);
  cells[rid] = { cell, host };
  roomsEl.appendChild(cell);
}
let shownRoomsVersion = -1;
let roomOrder = [...ROOM_IDS];

function applyZoomClass() {
  const z = ui.zoom;
  roomsEl.classList.toggle("grid", !z);
  roomsEl.classList.toggle("zoom", !!z);
  for (const rid of ROOM_IDS) cells[rid].cell.classList.toggle("active", rid === z);
  $("zoombtn").hidden = !z;
  $("gamecodebtn").hidden = z !== "game" || !(world && world.latestGameId);
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
      if (doc && cells[rid].host.innerHTML !== doc.html) cells[rid].host.innerHTML = doc.html;
      cells[rid].cell.style.order = roomOrder.indexOf(rid);
    }
    shownRoomsVersion = data.version;
    mountFrames();
  } catch {
    /* ignore */
  }
}

// ---------- iframes: monitor + game ----------
let sites = { rotateSeconds: 45, sites: [] };
let siteIdx = 0;
let siteRotateAt = 0;
let mountedGameId = -1;

fetch("/api/sites")
  .then((r) => r.json())
  .then((s) => {
    if (s && Array.isArray(s.sites)) sites = s;
    mountFrames();
  })
  .catch(() => {});

function mountFrames() {
  const sf = cells.desk.host.querySelector(".site-frame");
  const cap = cells.desk.host.querySelector(".site-cap");
  if (sf) {
    if (sites.sites.length) {
      if (!sf.src) {
        sf.src = sites.sites[siteIdx % sites.sites.length].url;
        siteRotateAt = performance.now() + (sites.rotateSeconds || 45) * 1000;
      }
      if (cap) cap.textContent = sites.sites[siteIdx % sites.sites.length].label || "";
    } else if (cap) {
      cap.textContent = "no sites configured";
    }
  }
  const gf = cells.game.host.querySelector(".game-frame");
  const gid = world?.latestGameId || 0;
  if (gf && gid && mountedGameId !== gid) {
    gf.src = `/games/${gid}`;
    mountedGameId = gid;
  }
}
function rotateSite(now) {
  if (sites.sites.length < 2 || now < siteRotateAt) return;
  siteIdx = (siteIdx + 1) % sites.sites.length;
  const sf = cells.desk.host.querySelector(".site-frame");
  const cap = cells.desk.host.querySelector(".site-cap");
  if (sf) sf.src = sites.sites[siteIdx].url;
  if (cap) cap.textContent = sites.sites[siteIdx].label || "";
  siteRotateAt = now + (sites.rotateSeconds || 45) * 1000;
}

// ---------- attention heartbeat ----------
setInterval(() => {
  if (document.visibilityState !== "visible" || !world || !sites.sites.length) return;
  if (!cells.desk.host.querySelector(".site-frame")) return;
  const site = sites.sites[siteIdx % sites.sites.length];
  fetch("/api/impression", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ site: site.id, seconds: 10, viewer: viewerId }),
  }).catch(() => {});
}, 10000);

// ---------- stream + connection status ----------
let es = null;
function setConn(state) {
  connDot.dataset.state = state; // ok | wait | off
  connDot.title = state === "ok" ? "connected" : state === "wait" ? "reconnecting…" : "offline";
}
function connect() {
  setConn("wait");
  es = new EventSource("/stream");
  es.onopen = () => setConn("ok");
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
    applyZoomClass();
  };
  es.onerror = () => setConn(es && es.readyState === 2 ? "off" : "wait");
}
connect();
addEventListener("online", () => {
  if (!es || es.readyState === 2) connect();
});

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
    conversation: { ...world.conversation, log: convLog },
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
  tbQuote.textContent = world.quote?.text ? world.quote.text : "a life that runs itself";
  if (ui.notice && performance.now() > ui.notice.until) ui.notice = null;
  render(ctx, w, ui);
}
requestAnimationFrame(frame);

// ---------- panels ----------
const aboutDlg = $("about");
const econDlg = $("econ");
const codeDlg = $("gamecode");

$("about-btn").addEventListener("click", () => aboutDlg.showModal());
$("about-close").addEventListener("click", () => aboutDlg.close());

async function openEcon() {
  econDlg.showModal();
  const body = $("econ-body");
  body.textContent = "loading…";
  try {
    const [daily, ledger] = await Promise.all([
      fetch("/api/daily").then((r) => r.json()),
      fetch("/api/ledger").then((r) => r.json()),
    ]);
    const rows = daily
      .map((d) => `day ${d.day}   + ${Math.round(d.income)}   − ${Math.round(d.expense)}   = ${Math.round(d.income - d.expense) >= 0 ? "+" : ""}${Math.round(d.income - d.expense)}`)
      .join("\n");
    const led = ledger
      .slice(0, 18)
      .map((l) => `${l.ts.slice(5, 16).replace("T", " ")}  ${l.amount > 0 ? "+" : ""}${Math.round(l.amount)}  ${l.note}`)
      .join("\n");
    body.textContent = `BANK ${world ? world.bank : "?"} coins\n\nspend / income per day\n${rows || "  (nothing yet)"}\n\nrecent ledger\n${led || "  (nothing yet)"}`;
  } catch {
    body.textContent = "couldn't load";
  }
}
$("econ-close").addEventListener("click", () => econDlg.close());

async function openGameCode() {
  if (!world?.latestGameId) return;
  codeDlg.showModal();
  const body = $("gamecode-body");
  body.textContent = "loading…";
  try {
    const g = await fetch(`/api/games/${world.latestGameId}`).then((r) => r.json());
    body.textContent =
      `"${g.title}"  ·  day ${g.createdDay}  ·  ${g.plays} plays\n\n` +
      `This game runs the built-in kernel below — the AI only chose the numbers.\n` +
      `No custom code is ever stored or executed.\n\n` +
      g.describe +
      `\n\nraw spec:\n${JSON.stringify(g.spec, null, 2)}`;
  } catch {
    body.textContent = "couldn't load";
  }
}
$("gamecodebtn").addEventListener("click", openGameCode);
$("gamecode-close").addEventListener("click", () => codeDlg.close());

async function loadConvLog() {
  try {
    convLog = await fetch("/api/conversations").then((r) => r.json());
  } catch {
    /* keep old */
  }
}

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
    const rid = roomOrder[row * 2 + col];
    if (rid) setZoom(rid);
  }
});
$("zoombtn").addEventListener("click", () => setZoom(null));

addEventListener("keydown", (e) => {
  if (aboutDlg.open || econDlg.open || codeDlg.open) return;
  if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (e.key === "Escape") return setZoom(null);
  if (k === "m") ui.showMemory = !ui.showMemory;
  else if (k === "c") {
    ui.showConversation = !ui.showConversation;
    if (ui.showConversation) loadConvLog();
  } else if (k === "s") ui.showCard = !ui.showCard;
  else if (k === "d") ui.debug = !ui.debug;
  else if (k === "p") openEcon();
  else if (k === "x") toggleMute();
});

// refresh the open conversation panel occasionally
setInterval(() => {
  if (ui.showConversation) loadConvLog();
}, 8000);

// ---------- PWA ----------
// register only over real HTTPS (skips dev / preview proxies that can't serve /sw.js)
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

function safeLS(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {
    return null;
  }
}
