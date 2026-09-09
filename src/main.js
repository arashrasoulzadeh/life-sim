// Browser viewer. The life runs on the server (server.mjs). Subscribes to
// /stream (~5s), walks the agent locally between updates, renders a 2x3 room
// grid you can zoom into and follow, browses the marketplace, inspects objects,
// and reports viewer attention so the life earns coins. The real seed never
// reaches the browser — only an opaque tag.

import * as Audio from "./engine/audio.js";
import { render, MUTE_RECT } from "./render/draw.js";
import { rainIntensity } from "./sim/weather.js";

const ROOM_IDS = ["window", "kitchen", "desk", "couch", "bed", "game"];
const PLAYFIELD_H = 448;

const $ = (id) => document.getElementById(id);
const canvas = $("screen");
const ctx = canvas.getContext("2d");
const roomsEl = $("rooms");
const tbTag = $("tb-tag");
const tbTok = $("tb-tok");
const tbQuote = $("tb-quote");
const connDot = $("conn");

let world = null;
let audioReady = false;
let lastFx = 0;
let moodPush = 0;
let prevAgentRoom = null;
let lastTs = performance.now();
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
  follow: safeLS("simyou_follow") === "1",
};
let convLog = [];
const roomMeta = {}; // rid -> [ {id,label,price,glyph,cat,x,y,day} ]

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
  for (const rid of ROOM_IDS) {
    cells[rid].cell.classList.toggle("active", rid === z);
    cells[rid].cell.classList.toggle("playable", z === "game" && rid === "game");
  }
  $("zoombtn").hidden = !z;
  $("followbtn").hidden = !z;
  $("followbtn").dataset.on = ui.follow ? "1" : "0";
  $("gamecodebtn").hidden = z !== "game" || !(world && world.latestGameId);
}
function setZoom(z) {
  ui.zoom = z || null;
  safeLS("simyou_zoom", ui.zoom || "");
  if (!ui.zoom) {
    ui.follow = false;
    safeLS("simyou_follow", "0");
  }
  applyZoomClass();
}
applyZoomClass();

async function refreshRooms() {
  try {
    const data = await fetch("/api/rooms", { cache: "no-store" }).then((r) => r.json());
    roomOrder = Array.isArray(data.order) && data.order.length === 6 ? data.order : [...ROOM_IDS];
    for (const rid of ROOM_IDS) {
      const doc = data.rooms[rid];
      if (doc) {
        if (cells[rid].host.innerHTML !== doc.html) cells[rid].host.innerHTML = doc.html;
        roomMeta[rid] = doc.meta || [];
      }
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

// ---------- stream ----------
let es = null;
function setConn(state) {
  connDot.dataset.state = state;
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
    // snap the local agent if it teleported (new room, or big gap)
    const a = snap.agent;
    if (!display.has || a.room !== prevAgentRoom || Math.hypot(a.x - display.x, a.y - display.y) > 220) {
      display.x = a.x;
      display.y = a.y;
      display.has = true;
    }
    prevAgentRoom = a.room;
    if (snap.roomsVersion !== shownRoomsVersion) refreshRooms();
    if ((snap.latestGameId || 0) !== mountedGameId) mountFrames();
    if (ui.follow && ui.zoom && snap.agent.room !== ui.zoom) setZoom(snap.agent.room), (ui.follow = true), safeLS("simyou_follow", "1");
    applyZoomClass();
  };
  es.onerror = () => setConn(es && es.readyState === 2 ? "off" : "wait");
}
connect();
addEventListener("online", () => {
  if (!es || es.readyState === 2) connect();
});

// ---------- render loop (walks the agent locally) ----------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastTs) / 1000);
  lastTs = now;
  rotateSite(now);
  if (!world) {
    ctx.clearRect(0, 0, 512, 512);
    return;
  }
  const a = world.agent;
  // glide toward the agent's last known position at roughly its walk speed
  const tx = a.transit > 0 ? a.x : a.tx ?? a.x;
  const ty = a.transit > 0 ? a.y : a.ty ?? a.y;
  const dx = tx - display.x;
  const dy = ty - display.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 1) {
    const step = Math.min(dist, 70 * dt);
    display.x += (dx / dist) * step;
    display.y += (dy / dist) * step;
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
    moodPush -= dt;
    if (moodPush <= 0) {
      Audio.setMood(world.mood.valence);
      moodPush = 1.5;
    }
  }
  tbTag.textContent = world.seedTag || "—";
  const season = world.outside?.season;
  const seasonEl = $("tb-season");
  if (seasonEl) seasonEl.textContent = season ? `${SEASON_GLYPH[season] || ""} ${season}` : "";
  const gbtn = $("guest-btn");
  if (gbtn) {
    const unread = world.notesUnread || 0;
    gbtn.textContent = unread ? `guestbook (${unread})` : "guestbook";
  }
  tbTok.textContent = `◊ ${world.bank} coins`;
  tbQuote.textContent = world.quote?.text ? world.quote.text : "a life that runs itself";
  if (ui.notice && performance.now() > ui.notice.until) ui.notice = null;
  render(ctx, w, ui);
}
requestAnimationFrame(frame);

// ---------- panels ----------
const dlgs = { about: $("about"), econ: $("econ"), gamecode: $("gamecode"), shop: $("shop"), objinfo: $("objinfo"), guest: $("guest") };
$("about-btn").addEventListener("click", () => dlgs.about.showModal());
for (const id of Object.keys(dlgs)) {
  if (!dlgs[id]) continue;
  const c = $(`${id}-close`);
  if (c) c.addEventListener("click", () => dlgs[id].close());
  dlgs[id].addEventListener("click", (e) => {
    if (e.target === dlgs[id]) dlgs[id].close();
  });
}

async function openEcon() {
  dlgs.econ.showModal();
  const body = $("econ-body");
  body.textContent = "loading…";
  try {
    const [daily, ledger] = await Promise.all([
      fetch("/api/daily").then((r) => r.json()),
      fetch("/api/ledger").then((r) => r.json()),
    ]);
    const rows = daily
      .map((d) => `day ${d.day}   +${Math.round(d.income)}   −${Math.round(d.expense)}   net ${Math.round(d.income - d.expense)}`)
      .join("\n");
    const led = ledger
      .slice(0, 18)
      .map((l) => `${l.ts.slice(5, 16).replace("T", " ")}  ${l.amount > 0 ? "+" : ""}${Math.round(l.amount)}  ${l.note}`)
      .join("\n");
    body.textContent = `BANK ${world ? world.bank : "?"} coins\n\nspend / income per day\n${rows || "  (nothing yet)"}\n\nledger\n${led || "  (nothing yet)"}`;
  } catch {
    body.textContent = "couldn't load";
  }
}

async function openShop() {
  dlgs.shop.showModal();
  const body = $("shop-body");
  body.textContent = "loading…";
  try {
    const m = await fetch("/api/market").then((r) => r.json());
    body.textContent = Object.entries(m)
      .map(
        ([cat, items]) =>
          `[${cat.toUpperCase()}]  ${items.length} items\n` +
          items.map((o) => `  ${o.glyph} ${o.label.padEnd(22)} ${String(o.price).padStart(4)}c   → ${o.room}`).join("\n"),
      )
      .join("\n\n");
  } catch {
    body.textContent = "couldn't load";
  }
}

async function openGameCode() {
  if (!world?.latestGameId) return;
  dlgs.gamecode.showModal();
  const body = $("gamecode-body");
  body.textContent = "loading…";
  try {
    const g = await fetch(`/api/games/${world.latestGameId}`).then((r) => r.json());
    body.textContent =
      `"${g.title}"  ·  day ${g.createdDay}  ·  ${g.plays} plays\n\n` +
      `This game runs a built-in kernel — the AI only chose the numbers.\n` +
      `No custom code is ever stored or executed. Zoom into the game room to play.\n\n` +
      g.describe +
      `\n\nspec:\n${JSON.stringify(g.spec, null, 2)}`;
  } catch {
    body.textContent = "couldn't load";
  }
}

function openObj(meta, room) {
  const body = $("objinfo-body");
  const roomName = (roomMeta[room] && cells[room]) ? cells[room].host.querySelector(".room-tag")?.textContent || room : room;
  body.textContent =
    `${meta.glyph}  ${meta.label}\n\n` +
    `category   ${meta.cat}\n` +
    `bought for ${meta.price} coins\n` +
    `in ${roomName} since day ${meta.day}\n` +
    (world ? `(day ${world.day} now — ${world.day - meta.day} days ago)` : "");
  dlgs.objinfo.showModal();
}
const SEASON_GLYPH = { spring: "🌱", summer: "☀️", autumn: "🍂", winter: "❄️" };
async function openGuest() {
  dlgs.guest.showModal();
  const body = $("guest-body");
  body.textContent = "loading…";
  try {
    const notes = await fetch("/api/notes").then((r) => r.json());
    body.textContent = notes.length
      ? notes.map((n) => `${(n.name || "someone").padEnd(16)} ${n.txt}`).join("\n")
      : "  (no notes yet — be the first)";
  } catch {
    body.textContent = "couldn't load";
  }
}
$("guest-btn")?.addEventListener("click", openGuest);
$("guest-send")?.addEventListener("click", async () => {
  const text = $("guest-text").value.trim();
  const name = $("guest-name").value.trim();
  const msg = $("guest-msg");
  if (text.length < 2) { msg.textContent = "say something first"; return; }
  msg.textContent = "sending…";
  try {
    const r = await fetch("/api/note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, name }),
    });
    if (r.ok) {
      $("guest-text").value = "";
      msg.textContent = "left on the desk. it'll be read at the next morning.";
      openGuest();
    } else {
      msg.textContent = await r.text();
    }
  } catch {
    msg.textContent = "couldn't send";
  }
});
$("shop-btn").addEventListener("click", openShop);
$("gamecodebtn").addEventListener("click", openGameCode);
$("followbtn").addEventListener("click", () => {
  ui.follow = !ui.follow;
  safeLS("simyou_follow", ui.follow ? "1" : "0");
  if (ui.follow && world) setZoom(world.agent.room), (ui.follow = true), safeLS("simyou_follow", "1");
  applyZoomClass();
});

async function loadConvLog() {
  try {
    convLog = await fetch("/api/conversations").then((r) => r.json());
  } catch {
    /* keep old */
  }
}

// ---------- input ----------
function seedNum(tag) {
  let x = 0;
  for (const c of String(tag || "")) x = (x * 131 + c.charCodeAt(0)) >>> 0;
  return x;
}
function ensureAudio() {
  if (audioReady) return;
  audioReady = true;
  Audio.start(seedNum(world && world.seedTag));
  Audio.setMuted(ui.muted);
}
function toggleMute() {
  ensureAudio();
  ui.muted = !ui.muted;
  Audio.setMuted(ui.muted);
}

function hitObject(room, px, py) {
  const list = roomMeta[room] || [];
  let best = null;
  let bestD = 40; // generous — grid emojis are tiny
  for (const o of list) {
    const d = Math.hypot(o.x * 512 - px, o.y * PLAYFIELD_H - py);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
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
  if (cy >= PLAYFIELD_H) return;

  if (ui.zoom) {
    const o = hitObject(ui.zoom, cx, cy);
    if (o) openObj(o, ui.zoom);
    return;
  }
  // grid: which cell, then object-in-cell or zoom
  const col = cx < 256 ? 0 : 1;
  const row = Math.min(2, Math.floor(cy / (PLAYFIELD_H / 3)));
  const rid = roomOrder[row * 2 + col];
  if (!rid) return;
  const lx = ((cx - col * 256) / 256) * 512;
  const ly = ((cy - row * (PLAYFIELD_H / 3)) / (PLAYFIELD_H / 3)) * PLAYFIELD_H;
  const o = hitObject(rid, lx, ly);
  if (o) openObj(o, rid);
  else setZoom(rid);
});
$("zoombtn").addEventListener("click", () => setZoom(null));

addEventListener("keydown", (e) => {
  if (Object.values(dlgs).some((d) => d.open)) return;
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
  else if (k === "f") {
    ui.follow = !ui.follow;
    if (ui.follow && world) setZoom(world.agent.room), (ui.follow = true);
    safeLS("simyou_follow", ui.follow ? "1" : "0");
    applyZoomClass();
  }
});

setInterval(() => {
  if (ui.showConversation) loadConvLog();
}, 8000);

// ---------- PWA ----------
if ("serviceWorker" in navigator && location.protocol === "https:") {
  let reloadedForSW = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedForSW) return;
    reloadedForSW = true;
    location.reload(); // a new worker took over — get the fresh shell
  });
  addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      reg.update();
      setInterval(() => reg.update(), 60 * 60 * 1000); // re-check hourly
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) nw.postMessage("skip-waiting");
        });
      });
    } catch {
      /* no SW — fine */
    }
  });
}

function safeLS(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {
    return null;
  }
}
