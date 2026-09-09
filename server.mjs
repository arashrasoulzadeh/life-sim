// SimYou production server: runs the one authoritative life in the background,
// persists it to SQLite, and streams state to browser viewers over SSE.
// The browser is a pure viewer — no simulation, no API key.
//
//   node server.mjs
//
// env: SIMYOU_SEED, SIMYOU_PORT, SIMYOU_DB, SIMYOU_GAPGPT_KEY,
//      SIMYOU_GAPGPT_BASE, SIMYOU_GAPGPT_MODEL, SIMYOU_DIALOGUE=on|off

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { createWorld, tick, drainFx, DAY_LENGTH } from "./src/sim/world.js";
import { buildPrompt, applyDialogue, stubDialogue } from "./src/sim/dialogue.js";
import { rainIntensity } from "./src/sim/weather.js";
import { roomDoc, initDocs } from "./src/sim/roomrender.js";
import * as Gap from "./src/engine/gapgpt.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.SIMYOU_PORT || process.env.PORT || 5173);
const SEED = Number(process.env.SIMYOU_SEED || 777) >>> 0;
const DB_PATH = process.env.SIMYOU_DB || join(ROOT, "simyou.db");
const GAP_KEY = process.env.SIMYOU_GAPGPT_KEY || "";
const GAP_BASE = process.env.SIMYOU_GAPGPT_BASE || "https://api.gapgpt.app/v1";
const GAP_MODEL = process.env.SIMYOU_GAPGPT_MODEL || "gpt-4o-mini";
const DIALOGUE_ON = (process.env.SIMYOU_DIALOGUE || "on") !== "off";

// 3 in-game minutes per real second (matches the old client default)
const BASE_RATE = (3 / (24 * 60)) * DAY_LENGTH; // sim-seconds fed to tick() per real second
const FIXED_DT = 1 / 30;
const TICK_MS = 100;
const BROADCAST_MS = 150;
const PERSIST_MS = 5000;

const ROOM_IDS = new Set(["window", "kitchen", "desk", "couch", "bed"]);

// ---------- database ----------
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS state (seed TEXT PRIMARY KEY, snapshot TEXT NOT NULL, updated TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memories (
    seed TEXT, id INTEGER, kind TEXT, txt TEXT, trait TEXT, dir INTEGER,
    mag REAL, weight REAL, born_day INTEGER, updated TEXT, PRIMARY KEY (seed, id));
  CREATE TABLE IF NOT EXISTS rooms (
    seed TEXT, room TEXT, objects TEXT, html TEXT, updated TEXT, PRIMARY KEY (seed, room));
  CREATE TABLE IF NOT EXISTS conversations (
    seed TEXT, day INTEGER, phase TEXT, source TEXT, line TEXT, changes TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS llm_calls (
    seed TEXT, ts TEXT, phase TEXT, day INTEGER, status INTEGER,
    request TEXT, content TEXT, parsed TEXT, error TEXT);
`);

const q = {
  saveState: db.prepare(
    `INSERT INTO state (seed, snapshot, updated) VALUES (?, ?, ?)
     ON CONFLICT(seed) DO UPDATE SET snapshot = excluded.snapshot, updated = excluded.updated`,
  ),
  loadState: db.prepare(`SELECT snapshot FROM state WHERE seed = ?`),
  wipeMem: db.prepare(`DELETE FROM memories WHERE seed = ?`),
  insMem: db.prepare(
    `INSERT INTO memories (seed, id, kind, txt, trait, dir, mag, weight, born_day, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  saveRoom: db.prepare(
    `INSERT INTO rooms (seed, room, objects, html, updated) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(seed, room) DO UPDATE SET objects = excluded.objects, html = excluded.html, updated = excluded.updated`,
  ),
  getRoom: db.prepare(`SELECT objects, html, updated FROM rooms WHERE seed = ? AND room = ?`),
  insConv: db.prepare(
    `INSERT INTO conversations (seed, day, phase, source, line, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ),
  listConv: db.prepare(
    `SELECT day, phase, source, line, changes, created_at FROM conversations WHERE seed = ? ORDER BY rowid DESC LIMIT 60`,
  ),
  listMem: db.prepare(`SELECT id, kind, txt, trait, dir, weight, born_day FROM memories WHERE seed = ? ORDER BY weight DESC`),
  insLlm: db.prepare(
    `INSERT INTO llm_calls (seed, ts, phase, day, status, request, content, parsed, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
};

// ---------- world load / restore ----------
function snapshotJSON(w) {
  const { rng, ...rest } = w;
  return JSON.stringify({ ...rest, rngState: rng.s });
}
function restore(seed, json) {
  const snap = JSON.parse(json);
  const w = createWorld(seed);
  for (const k of Object.keys(snap)) {
    if (k === "rngState") continue;
    w[k] = snap[k];
  }
  w.rng.s = (snap.rngState ?? w.rng.s) >>> 0;
  w.started = true;
  if (!w.roomDocs || Object.keys(w.roomDocs).length === 0) initDocs(w);
  return w;
}

let world;
const existing = q.loadState.get(String(SEED));
if (existing) {
  world = restore(SEED, existing.snapshot);
  console.log(`[simyou] resumed seed ${SEED} at day ${world.day}`);
} else {
  world = createWorld(SEED);
  world.started = true;
  initDocs(world);
  console.log(`[simyou] new life, seed ${SEED}`);
}
persistRooms();
persistMemories();

// ---------- gapgpt ----------
Gap.configure({
  key: GAP_KEY,
  base: GAP_BASE,
  model: GAP_MODEL,
  onLog: (rec) => {
    try {
      q.insLlm.run(
        String(SEED),
        new Date().toISOString(),
        rec.meta?.phase ?? null,
        rec.meta?.day ?? null,
        rec.status ?? null,
        JSON.stringify(rec.request ?? null),
        rec.content ?? null,
        rec.parsed ? JSON.stringify(rec.parsed) : null,
        rec.error ?? null,
      );
    } catch (e) {
      console.error("[simyou] llm log failed:", e.message);
    }
  },
});

// ---------- dialogue ----------
let dialogueBusy = false;
async function runDialogue(phase) {
  if (dialogueBusy) return;
  dialogueBusy = true;
  try {
    let result;
    if (DIALOGUE_ON && GAP_KEY) {
      const { system, user } = buildPrompt(world, phase);
      const resp = await Gap.chatJSON(system, user, { meta: { phase, day: world.day, seed: SEED } });
      result = applyDialogue(world, resp);
      result.source = "gapgpt";
    } else {
      result = stubDialogue(world, phase, world.rng);
      result.source = DIALOGUE_ON ? "offline" : "off";
    }
    recordConversation(phase, result);
  } catch (e) {
    const fb = stubDialogue(world, phase, world.rng);
    recordConversation(phase, { line: `gapgpt failed (${e.message}) — offline voice`, changes: fb.changes, source: "error" });
  } finally {
    dialogueBusy = false;
  }
}
function recordConversation(phase, r) {
  const entry = { phase, day: world.day, line: r.line, changes: r.changes || [], source: r.source, at: Date.now() };
  world.conversation.log.push(entry);
  while (world.conversation.log.length > 60) world.conversation.log.shift();
  world.conversation.bubble = { ...entry, ttl: 22 };
  regenRooms();
  persistRooms();
  persistMemories();
  try {
    q.insConv.run(String(SEED), world.day, phase, r.source, r.line || "", JSON.stringify(r.changes || []), new Date().toISOString());
  } catch (e) {
    console.error("[simyou] conversation persist:", e.message);
  }
}

function regenRooms() {
  for (const rid of Object.keys(world.rooms)) {
    const cur = world.roomDocs[rid];
    if (!cur || (cur.objects || []).join(",") !== world.rooms[rid].join(",")) {
      world.roomDocs[rid] = roomDoc(SEED, rid, world.rooms[rid]);
    }
  }
}

// ---------- persistence ----------
function persistState() {
  try {
    q.saveState.run(String(SEED), snapshotJSON(world), new Date().toISOString());
  } catch (e) {
    console.error("[simyou] state persist:", e.message);
  }
}
function persistRooms() {
  try {
    for (const rid of Object.keys(world.roomDocs)) {
      const d = world.roomDocs[rid];
      q.saveRoom.run(String(SEED), rid, JSON.stringify(d.objects), d.html, d.updated);
    }
  } catch (e) {
    console.error("[simyou] rooms persist:", e.message);
  }
}
function persistMemories() {
  try {
    q.wipeMem.run(String(SEED));
    const now = new Date().toISOString();
    for (const m of world.memory.slots) {
      q.insMem.run(String(SEED), m.id, m.kind, m.text, m.trait, m.dir, m.mag, m.weight, m.bornDay, now);
    }
  } catch (e) {
    console.error("[simyou] memories persist:", e.message);
  }
}

// ---------- sim loop ----------
let acc = 0;
let lastTick = Date.now();
let prevDay = world.day;

setInterval(() => {
  const now = Date.now();
  let dtReal = (now - lastTick) / 1000;
  lastTick = now;
  if (dtReal > 3) dtReal = 3;

  acc += dtReal * BASE_RATE;
  let steps = 0;
  while (acc >= FIXED_DT && steps++ < 200) {
    tick(world, FIXED_DT);
    acc -= FIXED_DT;
  }

  if (world.day !== prevDay) {
    prevDay = world.day;
    regenRooms();
    persistRooms();
    persistMemories();
  }

  if (world.dialogueRequest && !dialogueBusy) {
    const phase = world.dialogueRequest;
    world.dialogueRequest = null;
    runDialogue(phase);
  }

  const fx = drainFx(world);
  if (fx) for (const t of fx) fxTail.push({ n: ++fxSeq, t });
  while (fxTail.length > 24) fxTail.shift();
}, TICK_MS);

setInterval(persistState, PERSIST_MS);

// ---------- viewer snapshot + SSE ----------
let fxSeq = 0;
const fxTail = [];
const clients = new Set();

function viewSnapshot() {
  return JSON.stringify({
    seed: world.seed,
    day: world.day,
    dayFrac: world.dayFrac,
    isNight: world.isNight,
    tokens: world.tokens,
    reputation: world.reputation,
    requests: world.requests,
    agent: world.agent,
    mood: world.mood,
    weather: world.weather,
    windowEvent: world.windowEvent,
    era: world.era,
    memory: world.memory,
    conversation: { bubble: world.conversation.bubble, log: world.conversation.log.slice(-10) },
    room: world.roomDocs[world.agent.room] || null,
    gapgpt: !!(DIALOGUE_ON && GAP_KEY),
    fx: fxTail,
  });
}

function broadcast() {
  if (clients.size === 0) return;
  const payload = `data: ${viewSnapshot()}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}
setInterval(broadcast, BROADCAST_MS);

// ---------- http ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const BLOCKED = /(^|\/)(config\.js|config\.local\.js|\.env|server\.mjs|server\.py|.*\.db(-.*)?|llm\.log)$/;

function sendJSON(res, s) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(s);
}

const server = createServer(async (req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }

  if (path === "/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 2000\n\n");
    res.write(`data: ${viewSnapshot()}\n\n`);
    clients.add(res);
    const ka = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        /* closed */
      }
    }, 15000);
    req.on("close", () => {
      clients.delete(res);
      clearInterval(ka);
    });
    return;
  }

  if (path === "/state") return sendJSON(res, viewSnapshot());
  if (path === "/api/conversations") {
    const rows = q.listConv.all(String(SEED)).map((r) => ({ ...r, changes: JSON.parse(r.changes || "[]") }));
    return sendJSON(res, JSON.stringify(rows));
  }
  if (path === "/api/memories") return sendJSON(res, JSON.stringify(q.listMem.all(String(SEED))));

  const rm = path.match(/^\/worlds\/(\d{1,10})\/([a-z]+)\.json$/);
  if (rm && ROOM_IDS.has(rm[2])) {
    const row = q.getRoom.get(rm[1], rm[2]);
    if (!row) {
      res.writeHead(404);
      return res.end();
    }
    return sendJSON(
      res,
      JSON.stringify({ room: rm[2], seed: rm[1], objects: JSON.parse(row.objects), html: row.html, updated: row.updated }),
    );
  }

  // static
  let rel = path === "/" ? "/index.html" : path;
  rel = "/" + normalize(rel).replace(/^(\.\.(\/|\\|$))+/g, "").replace(/^\/+/, "");
  if (BLOCKED.test(rel) || rel.startsWith("/worlds/")) {
    res.writeHead(404);
    return res.end("not found");
  }
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404);
    return res.end("not found");
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[simyou] http://localhost:${PORT}  seed ${SEED}  db ${DB_PATH}  gapgpt ${GAP_KEY ? GAP_MODEL : "off (offline voice)"}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[simyou] ${sig} — persisting`);
    persistState();
    persistMemories();
    persistRooms();
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
}
