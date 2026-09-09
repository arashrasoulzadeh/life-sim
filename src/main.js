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
const tbTokV = $("tb-tok").querySelector(".v");
const tbLoveV = $("tb-love").querySelector(".v");
const tbQuote = $("tb-quote");
const connDot = $("conn");

let world = null;
let audioReady = false;
let lastFx = 0;
let moodPush = 0;
let prevAgentRoom = null;
let lastTs = performance.now();
const display = { x: 256, y: 300, has: false };
let petDisplay = { room: null, x: 350, y: 330 };
let mateDisplay = { room: null, x: 350, y: 330 };

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

  // glide the cat too
  let pet = world.pet;
  if (pet) {
    if (petDisplay.room !== pet.room) {
      petDisplay = { room: pet.room, x: pet.x, y: pet.y };
    } else {
      const pdx = pet.x - petDisplay.x;
      const pdy = pet.y - petDisplay.y;
      const pd = Math.hypot(pdx, pdy);
      if (pd > 0.5) {
        const s = Math.min(pd, 34 * dt);
        petDisplay.x += (pdx / pd) * s;
        petDisplay.y += (pdy / pd) * s;
      }
    }
    pet = { ...pet, x: petDisplay.x, y: petDisplay.y };
  }

  // glide the spouse
  let partner = world.partner;
  if (partner) {
    const ptx = partner.transit > 0 ? partner.x : partner.tx ?? partner.x;
    const pty = partner.transit > 0 ? partner.y : partner.ty ?? partner.y;
    if (mateDisplay.room !== partner.room) {
      mateDisplay = { room: partner.room, x: ptx, y: pty };
    } else {
      const mdx = ptx - mateDisplay.x;
      const mdy = pty - mateDisplay.y;
      const md = Math.hypot(mdx, mdy);
      if (md > 1) {
        const s = Math.min(md, 60 * dt);
        mateDisplay.x += (mdx / md) * s;
        mateDisplay.y += (mdy / md) * s;
      }
    }
    partner = { ...partner, x: mateDisplay.x, y: mateDisplay.y };
  }

  const w = {
    ...world,
    started: true,
    roomOrder,
    agent: { ...a, x: display.x, y: display.y },
    pet,
    partner,
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
    gbtn.classList.toggle("badge", unread > 0);
  }
  const whoEl = $("tb-who");
  if (whoEl && world.household) {
    const h = world.household;
    whoEl.textContent = `${h.you?.name || "?"} & ${h.spouse?.name || "?"} ${h.surname || ""}`.trim();
  }
  if (tbLoveV) tbLoveV.textContent = `${world.togetherness ?? "—"}%`;
  const dayEl = $("tb-day");
  if (dayEl && world.rhythm) {
    let tag = `${world.rhythm.dowName || ""}`;
    if (world.finances && world.finances.broke) tag += " · BROKE";
    else if (world.rhythm.badDay) tag += " · off day";
    else if (world.rhythm.weekend) tag += " · weekend";
    if (world.psyche) tag += world.psyche.lean === "push" ? " · pushing" : world.psyche.lean === "ease" ? " · easing" : " · of two minds";
    dayEl.textContent = tag;
    dayEl.style.color = world.finances && world.finances.broke ? "#e06a5c" : "";
  }
  if (tbTokV) tbTokV.textContent = String(world.bank);
  tbQuote.textContent = world.quote?.text ? world.quote.text : "a life that runs itself";
  if (ui.notice && performance.now() > ui.notice.until) ui.notice = null;
  render(ctx, w, ui);
}
requestAnimationFrame(frame);

// ---------- panels ----------
const dlgs = { about: $("about"), econ: $("econ"), gamecode: $("gamecode"), shop: $("shop"), objinfo: $("objinfo"), guest: $("guest"), vote: $("vote"), journal: $("journal"), memories: $("memories") };
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
  const cond =
    meta.condition == null
      ? ""
      : `\ncondition  ${meta.condition}%${meta.condition < 22 ? " — BROKEN" : meta.condition < 55 ? " — worn" : ""}`;
  const wtr = meta.water == null ? "" : `\nwater      ${meta.water}%`;
  body.textContent =
    `${meta.glyph}  ${meta.label}\n\n` +
    `category   ${meta.cat}\n` +
    `bought for ${meta.price} coins\n` +
    `in ${roomName} since day ${meta.day}` +
    cond +
    wtr +
    "\n" +
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
async function openJournal() {
  dlgs.journal.showModal();
  const body = $("journal-body");
  body.textContent = "loading…";
  try {
    const j = await fetch("/api/journal").then((r) => r.json());
    const goals = (j.goals || [])
      .map((g) => `  ${g.outcome === "done" ? "✓" : g.outcome === "failed" ? "✗" : "·"} ${g.txt}`)
      .join("\n");
    const sk = j.skills || {};
    body.textContent = [
      `day ${j.day} · ${j.season}${j.week ? `\nthe week: "${j.week}"` : ""}`,
      j.pet && j.pet.name ? `the cat: ${j.pet.name} (bond ${Math.round((j.pet.bond || 0) * 100)}%)` : "",
      `skills — writing ${Math.round(sk.writing || 0)} · coding ${Math.round(sk.coding || 0)} · tinkering ${Math.round(sk.tinkering || 0)} · talking ${Math.round(sk.talking || 0)}`,
      `games made: ${j.gamesMade || 0}${(sk.coding || 0) < 10 ? "  (needs coding 10 to start)" : ""}`,
      j.money ? `money — ${j.money}` : "",
      "",
      (j.writings || []).length ? "THINGS IT WROTE\n" + j.writings.map((x) => `  — day ${x.day} —\n${x.txt.split("\n").map((l) => "  " + l).join("\n")}`).join("\n\n") + "\n" : "",
      j.lifeSummary ? `LIFE SO FAR\n${j.lifeSummary}` : "",
      "",
      "GOALS\n" + (goals || "  (none yet)"),
      "",
      "WHAT STUCK\n" + (j.memories || []).map((m) => `  · ${m}`).join("\n"),
      "",
      "DREAMS\n" + (j.dreams || []).map((d) => `  d${d.day}: ${d.txt}`).join("\n"),
      "",
      "LINES IT KEPT\n" + (j.quotes || []).map((q) => `  “${q.txt}”`).join("\n"),
    ].filter((s) => s !== "").join("\n");
  } catch {
    body.textContent = "couldn't load";
  }
}

async function renderVote(data) {
  $("vote-prompt").textContent = data.prompt || "";
  const opts = $("vote-opts");
  opts.innerHTML = "";
  const total = data.total || 0;
  for (const c of data.choices) {
    const n = data.tally[c] || 0;
    const pct = total ? Math.round((n / total) * 100) : 0;
    const b = document.createElement("button");
    b.style.cssText =
      "text-align:left;background:" +
      (data.mine === c ? "#1f3a2c" : "#1a1f28") +
      ";border:1px solid " +
      (data.mine === c ? "#3d6b52" : "#2a2f3a") +
      ";color:#dfe4ee;border-radius:6px;padding:7px 10px;cursor:pointer;font:inherit";
    b.textContent = `${data.labels[c] || c}  —  ${n} (${pct}%)`;
    b.addEventListener("click", async () => {
      $("vote-msg").textContent = "…";
      try {
        const r = await fetch("/api/vote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ choice: c }),
        }).then((x) => x.json());
        $("vote-msg").textContent = "counted — thanks";
        renderVote(r);
      } catch {
        $("vote-msg").textContent = "couldn't vote";
      }
    });
    opts.appendChild(b);
  }
  if (data.yesterday) {
    const y = document.createElement("div");
    y.style.cssText = "color:#7f8a9c;font-size:12px;margin-top:4px";
    y.textContent = `yesterday: ${data.labels[data.yesterday.choice] || data.yesterday.choice} won (${data.yesterday.count})`;
    opts.appendChild(y);
  }
}
async function openVote() {
  dlgs.vote.showModal();
  $("vote-msg").textContent = "";
  try {
    renderVote(await fetch("/api/vote").then((r) => r.json()));
  } catch {
    $("vote-prompt").textContent = "couldn't load the vote";
  }
}
const TRAIT_TINT = { diligence: "#e0b45c", sociability: "#7ad0a0", curiosity: "#8fb8e8", restlessness: "#c98bd0" };
function memRow(m) {
  const text = m.text || m.txt || "";
  const trait = m.trait || "";
  const dir = m.dir > 0 ? "+" : "−";
  const born = m.bornDay ?? m.born_day ?? "?";
  const weight = typeof m.weight === "number" ? m.weight.toFixed(1) : "?";
  const row = document.createElement("div");
  row.style.cssText =
    "border-left:3px solid " + (TRAIT_TINT[trait] || "#555") + ";padding:4px 8px;background:#12161d;border-radius:4px;cursor:pointer";
  const line = document.createElement("div");
  line.style.cssText = "color:#dfe4ee;font-size:12px";
  line.textContent = text;
  const detail = document.createElement("div");
  detail.style.cssText = "color:#8f98a8;font-size:11px;margin-top:3px";
  detail.hidden = true;
  detail.textContent = `${m.kind || "?"} · ${trait}${dir} · weight ${weight} · born day ${born}${m.archived ? " · archived" : ""}${m.summarised ? ` · folds ${m.summarised}` : ""}`;
  row.append(line, detail);
  row.addEventListener("click", () => (detail.hidden = !detail.hidden));
  return row;
}
function fillMemList(list, arr) {
  list.innerHTML = "";
  for (const m of arr) list.appendChild(memRow(m));
}
function openMemories() {
  dlgs.memories.showModal();
  const list = $("mem-list");
  $("mem-msg").textContent = "";
  const slots = (world && world.memory && world.memory.slots) || [];
  const top = [...slots].sort((a, b) => b.weight - a.weight).slice(0, 11);
  fillMemList(list, top);
  $("mem-count").textContent = `${world?.memoryTotal ?? slots.length} memories ever · showing the ${top.length} strongest held now`;
  $("mem-all").hidden = false;
}
$("mem-all")?.addEventListener("click", async () => {
  $("mem-msg").textContent = "loading…";
  try {
    const all = await fetch("/api/memories").then((r) => r.json());
    fillMemList($("mem-list"), all);
    $("mem-count").textContent = `${all.length} memories, strongest first · click one to expand`;
    $("mem-msg").textContent = "";
    $("mem-all").hidden = true;
  } catch {
    $("mem-msg").textContent = "couldn't load";
  }
});
$("mem-btn")?.addEventListener("click", openMemories);
$("journal-btn")?.addEventListener("click", openJournal);
$("vote-btn")?.addEventListener("click", openVote);
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
  if (k === "m") openMemories();
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

// ---------- fresh-build guard: wipe every local cache when the server ships a new build ----------
(async () => {
  try {
    const { build } = await fetch("/api/version", { cache: "no-store" }).then((r) => r.json());
    if (!build) return;
    let seen = null;
    try {
      seen = localStorage.getItem("simyou_build");
    } catch {
      /* ignore */
    }
    if (seen === build) return;

    if (seen !== null) {
      // a genuinely new build — clear it all and reload once
      try {
        if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
      } catch {
        /* ignore */
      }
      try {
        if (navigator.serviceWorker) {
          for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
        }
      } catch {
        /* ignore */
      }
      try {
        const keep = localStorage.getItem("simyou_follow");
        localStorage.clear();
        if (keep != null) localStorage.setItem("simyou_follow", keep);
      } catch {
        /* ignore */
      }
      try {
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
      try {
        localStorage.setItem("simyou_build", build);
      } catch {
        /* ignore */
      }
      location.reload();
      return;
    }
    try {
      localStorage.setItem("simyou_build", build);
    } catch {
      /* ignore */
    }
  } catch {
    /* offline / no endpoint — carry on */
  }
})();

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
