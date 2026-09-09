// SimYou production server: runs the one authoritative life in the background,
// persists it to SQLite (state + memories + rooms + conversations + llm_calls +
// bank + ledger + games + impressions + digests), and streams state to browser
// viewers over SSE. The browser is a pure viewer — no simulation, no API key.
//
//   node server.mjs
//
// env: SIMYOU_SEED SIMYOU_PORT SIMYOU_DB SIMYOU_SITES SIMYOU_GAPGPT_KEY
//      SIMYOU_GAPGPT_BASE SIMYOU_GAPGPT_MODEL SIMYOU_DIALOGUE=on|off

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { createWorld, tick, drainFx, DAY_LENGTH, START_BANK } from "./src/sim/world.js";
import { buildPrompt, applyMorning, applyEvening, stubDialogue } from "./src/sim/dialogue.js";
import { rainIntensity } from "./src/sim/weather.js";
import { roomDoc, initDocs } from "./src/sim/roomrender.js";
import { goalFrac } from "./src/sim/goals.js";
import { ROOM_IDS } from "./src/sim/rooms.js";
import { describeSpec } from "./src/game/kernels.js";
import { MARKET } from "./src/sim/marketplace.js";
import * as Gap from "./src/engine/gapgpt.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.SIMYOU_PORT || process.env.PORT || 5173);
const SEED = Number(process.env.SIMYOU_SEED || 777) >>> 0;
const DB_PATH = process.env.SIMYOU_DB || join(ROOT, "simyou.db");
const SITES_PATH = process.env.SIMYOU_SITES || join(ROOT, "sites.json");
const GAP_KEY = process.env.SIMYOU_GAPGPT_KEY || "";
const GAP_BASE = process.env.SIMYOU_GAPGPT_BASE || "https://api.gapgpt.app/v1";
const GAP_MODEL = process.env.SIMYOU_GAPGPT_MODEL || "gpt-4o-mini";
const DIALOGUE_ON = (process.env.SIMYOU_DIALOGUE || "on") !== "off";
const ADMIN_TOKEN = process.env.SIMYOU_ADMIN_TOKEN || "";

const BASE_RATE = (3 / (24 * 60)) * DAY_LENGTH; // sim-seconds per real second (3 in-game min/sec)
const REAL_SECS_PER_DAY = DAY_LENGTH / BASE_RATE; // ~480
const FIXED_DT = 1 / 30;
const TICK_MS = 100;
const BROADCAST_MS = Number(process.env.SIMYOU_BROADCAST_MS || 5000); // SSE cadence — the client walks the agent between updates
const PERSIST_MS = 5000;

const DB_CAP_MB = Number(process.env.SIMYOU_DB_CAP_MB || 900);
const DB_SOFT_CAP = DB_CAP_MB * 1024 * 1024;
// retention scales with the cap: a bigger budget keeps more llm_calls / history
const LLM_KEEP = Math.max(500, Math.round(DB_CAP_MB * 3));
const CONV_KEEP_DAYS = Math.max(60, Math.round(DB_CAP_MB / 4));
const LLM_BLOB_CAP = 8 * 1024;
const MAX_GAMES = 10;
const VIEWER_DAY_SECONDS_CAP = REAL_SECS_PER_DAY; // one in-game day of credited watching per viewer

// ---------- sites.json ----------
let SITES = { rotateSeconds: 45, sites: [] };
try {
  if (existsSync(SITES_PATH)) SITES = JSON.parse(readFileSync(SITES_PATH, "utf8"));
} catch (e) {
  console.error("[simyou] sites.json:", e.message);
}
const siteById = new Map(SITES.sites.map((s) => [s.id, s]));

// tiny keep-it-kind filter for the guestbook
const BAD_WORDS = /\b(f+u+c+k|s+h+i+t|b+i+t+c+h|c+u+n+t|n+i+g+g|f+a+g|retard|rape|kys)\b/i;

// the real seed never leaves the server — viewers get a stable opaque tag
const SEED_TAG = createHash("sha256").update("simyou:" + SEED).digest("hex").slice(0, 10);

// the game engine, inlined per-response with a nonce so the game frame needs
// only sandbox="allow-scripts" — no same-origin, no external fetch, ever
const GAME_JS = readFileSync(join(ROOT, "src/game/game.js"), "utf8");

// ---------- database ----------
let db;
try {
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
} catch (e) {
  if (/readonly|unable to open|SQLITE_CANTOPEN/i.test(String(e.message))) {
    console.error(
      `\n[simyou] cannot write ${DB_PATH}\n` +
        `The data directory is owned by the wrong user (a migrated DB is usually root-owned).\n` +
        `Fix it once:\n` +
        `  docker compose down\n` +
        `  docker run --rm --user root -v "$(basename "$PWD")_simyou-data":/data alpine chown -R 10001:10001 /data\n` +
        `  docker compose up -d\n`,
    );
  }
  throw e;
}
db.exec(`
  PRAGMA auto_vacuum = INCREMENTAL;
  CREATE TABLE IF NOT EXISTS state (seed TEXT PRIMARY KEY, snapshot TEXT NOT NULL, updated TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memories (
    seed TEXT, id INTEGER, kind TEXT, txt TEXT, trait TEXT, dir INTEGER,
    mag REAL, weight REAL, born_day INTEGER, archived INTEGER DEFAULT 0, updated TEXT,
    PRIMARY KEY (seed, id));
  CREATE TABLE IF NOT EXISTS memory_digest (seed TEXT, month INTEGER, summary TEXT, cnt INTEGER, created_at TEXT, PRIMARY KEY (seed, month));
  CREATE TABLE IF NOT EXISTS life_summary (seed TEXT PRIMARY KEY, txt TEXT, updated_day INTEGER);
  CREATE TABLE IF NOT EXISTS rooms (seed TEXT, room TEXT, objects TEXT, html TEXT, updated TEXT, PRIMARY KEY (seed, room));
  CREATE TABLE IF NOT EXISTS conversations (seed TEXT, day INTEGER, phase TEXT, source TEXT, line TEXT, reply TEXT, changes TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS llm_calls (seed TEXT, ts TEXT, phase TEXT, day INTEGER, status INTEGER, request TEXT, content TEXT, parsed TEXT, error TEXT);
  CREATE TABLE IF NOT EXISTS bank (seed TEXT PRIMARY KEY, balance REAL, updated TEXT);
  CREATE TABLE IF NOT EXISTS ledger (seed TEXT, ts TEXT, kind TEXT, amount REAL, note TEXT);
  CREATE TABLE IF NOT EXISTS daily (seed TEXT, day INTEGER, income REAL DEFAULT 0, expense REAL DEFAULT 0, PRIMARY KEY (seed, day));
  CREATE TABLE IF NOT EXISTS games (seed TEXT, id INTEGER, title TEXT, spec TEXT, created_day INTEGER, plays INTEGER DEFAULT 0, PRIMARY KEY (seed, id));
  CREATE TABLE IF NOT EXISTS quotes (seed TEXT, day INTEGER, txt TEXT, PRIMARY KEY (seed, day));
  CREATE TABLE IF NOT EXISTS dreams (seed TEXT, day INTEGER, txt TEXT, PRIMARY KEY (seed, day));
  CREATE TABLE IF NOT EXISTS goals (seed TEXT, start_day INTEGER, txt TEXT, metric TEXT, target INTEGER, outcome TEXT, end_day INTEGER, PRIMARY KEY (seed, start_day));
  CREATE TABLE IF NOT EXISTS notes (seed TEXT, ts TEXT, viewer TEXT, name TEXT, txt TEXT, read INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS impressions (seed TEXT, day INTEGER, viewer TEXT, site TEXT, seconds REAL, credited REAL, PRIMARY KEY (seed, day, viewer, site));
  CREATE TABLE IF NOT EXISTS votes (seed TEXT, day INTEGER, viewer TEXT, choice TEXT, ts TEXT, PRIMARY KEY (seed, day, viewer));
`);
// migrate older DBs missing the reply column
try { db.exec(`ALTER TABLE conversations ADD COLUMN reply TEXT`); } catch { /* already there */ }

// ---------- backups (host-side, so they survive `docker compose down -v`) ----------
const BACKUP_DIR = process.env.SIMYOU_BACKUP_DIR || "";
const BACKUP_EVERY_MS = Math.max(5, Number(process.env.SIMYOU_BACKUP_MIN || 30)) * 60000;
const BACKUP_KEEP = Math.max(3, Number(process.env.SIMYOU_BACKUP_KEEP || 16));

function backup(reason = "timer") {
  if (!BACKUP_DIR) return;
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(BACKUP_DIR, `${SEED}-${stamp}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const mine = readdirSync(BACKUP_DIR)
      .filter((n) => n.startsWith(SEED + "-") && n.endsWith(".db"))
      .sort();
    for (const old of mine.slice(0, -BACKUP_KEEP)) {
      try {
        unlinkSync(join(BACKUP_DIR, old));
      } catch {
        /* ignore */
      }
    }
    console.log(`[simyou] backup (${reason}) -> ${file}  (keeping ${Math.min(mine.length, BACKUP_KEEP)})`);
  } catch (e) {
    console.error("[simyou] backup failed:", e.message);
  }
}
if (BACKUP_DIR) {
  setTimeout(() => backup("startup"), 20000);
  setInterval(() => backup("timer"), BACKUP_EVERY_MS);
}

const Q = {
  loadState: db.prepare(`SELECT snapshot FROM state WHERE seed=?`),
  saveState: db.prepare(
    `INSERT INTO state (seed,snapshot,updated) VALUES (?,?,?) ON CONFLICT(seed) DO UPDATE SET snapshot=excluded.snapshot, updated=excluded.updated`,
  ),
  memUpsert: db.prepare(
    `INSERT INTO memories (seed,id,kind,txt,trait,dir,mag,weight,born_day,archived,updated)
     VALUES (?,?,?,?,?,?,?,?,?,0,?)
     ON CONFLICT(seed,id) DO UPDATE SET weight=excluded.weight, txt=excluded.txt, updated=excluded.updated`,
  ),
  memDormant: db.prepare(
    `SELECT id,txt,trait,born_day FROM memories WHERE seed=? AND archived=0 AND weight<0.15 AND (?-born_day)>30`,
  ),
  memArchive: db.prepare(`UPDATE memories SET archived=1 WHERE seed=? AND id=?`),
  memTopActive: db.prepare(`SELECT txt FROM memories WHERE seed=? AND archived=0 ORDER BY weight DESC LIMIT 12`),
  memCount: db.prepare(`SELECT COUNT(*) c FROM memories WHERE seed=?`),
  digestUpsert: db.prepare(
    `INSERT INTO memory_digest (seed,month,summary,cnt,created_at) VALUES (?,?,?,?,?)
     ON CONFLICT(seed,month) DO UPDATE SET summary=excluded.summary, cnt=excluded.cnt`,
  ),
  digestRecent: db.prepare(`SELECT month,summary FROM memory_digest WHERE seed=? ORDER BY month DESC LIMIT 3`),
  lifeGet: db.prepare(`SELECT txt,updated_day FROM life_summary WHERE seed=?`),
  lifeSet: db.prepare(
    `INSERT INTO life_summary (seed,txt,updated_day) VALUES (?,?,?) ON CONFLICT(seed) DO UPDATE SET txt=excluded.txt, updated_day=excluded.updated_day`,
  ),
  roomSave: db.prepare(
    `INSERT INTO rooms (seed,room,objects,html,updated) VALUES (?,?,?,?,?) ON CONFLICT(seed,room) DO UPDATE SET objects=excluded.objects, html=excluded.html, updated=excluded.updated`,
  ),
  convIns: db.prepare(`INSERT INTO conversations (seed,day,phase,source,line,reply,changes,created_at) VALUES (?,?,?,?,?,?,?,?)`),
  convList: db.prepare(`SELECT day,phase,source,line,reply,changes,created_at FROM conversations WHERE seed=? ORDER BY rowid DESC LIMIT 60`),
  llmIns: db.prepare(`INSERT INTO llm_calls (seed,ts,phase,day,status,request,content,parsed,error) VALUES (?,?,?,?,?,?,?,?,?)`),
  llmTrim: db.prepare(`DELETE FROM llm_calls WHERE seed=? AND rowid NOT IN (SELECT rowid FROM llm_calls WHERE seed=? ORDER BY rowid DESC LIMIT ${LLM_KEEP})`),
  convTrim: db.prepare(`DELETE FROM conversations WHERE seed=? AND day < ?`),
  bankGet: db.prepare(`SELECT balance FROM bank WHERE seed=?`),
  bankSet: db.prepare(`INSERT INTO bank (seed,balance,updated) VALUES (?,?,?) ON CONFLICT(seed) DO UPDATE SET balance=excluded.balance, updated=excluded.updated`),
  ledgerIns: db.prepare(`INSERT INTO ledger (seed,ts,kind,amount,note) VALUES (?,?,?,?,?)`),
  ledgerTail: db.prepare(`SELECT ts,kind,amount,note FROM ledger WHERE seed=? ORDER BY rowid DESC LIMIT 40`),
  dailyAdd: db.prepare(
    `INSERT INTO daily (seed,day,income,expense) VALUES (?,?,?,?) ON CONFLICT(seed,day) DO UPDATE SET income=income+excluded.income, expense=expense+excluded.expense`,
  ),
  dailyList: db.prepare(`SELECT day,income,expense FROM daily WHERE seed=? ORDER BY day DESC LIMIT 30`),
  quoteSet: db.prepare(`INSERT INTO quotes (seed,day,txt) VALUES (?,?,?) ON CONFLICT(seed,day) DO UPDATE SET txt=excluded.txt`),
  quoteList: db.prepare(`SELECT day,txt FROM quotes WHERE seed=? ORDER BY day DESC LIMIT 30`),
  dreamSet: db.prepare(`INSERT INTO dreams (seed,day,txt) VALUES (?,?,?) ON CONFLICT(seed,day) DO UPDATE SET txt=excluded.txt`),
  dreamList: db.prepare(`SELECT day,txt FROM dreams WHERE seed=? ORDER BY day DESC LIMIT 30`),
  goalIns: db.prepare(`INSERT INTO goals (seed,start_day,txt,metric,target,outcome,end_day) VALUES (?,?,?,?,?,NULL,NULL) ON CONFLICT(seed,start_day) DO NOTHING`),
  goalEnd: db.prepare(`UPDATE goals SET outcome=?, end_day=? WHERE seed=? AND start_day=? AND outcome IS NULL`),
  goalList: db.prepare(`SELECT start_day,txt,metric,target,outcome,end_day FROM goals WHERE seed=? ORDER BY start_day DESC LIMIT 20`),
  noteIns: db.prepare(`INSERT INTO notes (seed,ts,viewer,name,txt,read) VALUES (?,?,?,?,?,0)`),
  noteRecent: db.prepare(`SELECT ts,name,txt FROM notes WHERE seed=? ORDER BY rowid DESC LIMIT 40`),
  noteUnread: db.prepare(`SELECT ts,name,txt,rowid FROM notes WHERE seed=? AND read=0 ORDER BY rowid ASC LIMIT 8`),
  noteMarkRead: db.prepare(`UPDATE notes SET read=1 WHERE seed=? AND rowid<=?`),
  noteUnreadCount: db.prepare(`SELECT COUNT(*) c FROM notes WHERE seed=? AND read=0`),
  noteViewerRecent: db.prepare(`SELECT COUNT(*) c FROM notes WHERE seed=? AND viewer=? AND ts > ?`),
  noteTrim: db.prepare(`DELETE FROM notes WHERE seed=? AND rowid NOT IN (SELECT rowid FROM notes WHERE seed=? ORDER BY rowid DESC LIMIT 500)`),
  gameIns: db.prepare(`INSERT INTO games (seed,id,title,spec,created_day,plays) VALUES (?,?,?,?,?,0)`),
  gamePlays: db.prepare(`UPDATE games SET plays=plays+1 WHERE seed=? AND id=?`),
  gameList: db.prepare(`SELECT id,title,created_day,plays FROM games WHERE seed=? ORDER BY id DESC`),
  gameSpec: db.prepare(`SELECT title,spec,created_day,plays FROM games WHERE seed=? AND id=?`),
  gamePrune: db.prepare(`DELETE FROM games WHERE seed=? AND id NOT IN (SELECT id FROM games WHERE seed=? ORDER BY id DESC LIMIT ${MAX_GAMES})`),
  imprGet: db.prepare(`SELECT seconds,credited FROM impressions WHERE seed=? AND day=? AND viewer=? AND site=?`),
  imprDaySum: db.prepare(`SELECT COALESCE(SUM(credited),0) s FROM impressions WHERE seed=? AND day=? AND viewer=?`),
  imprUpsert: db.prepare(
    `INSERT INTO impressions (seed,day,viewer,site,seconds,credited) VALUES (?,?,?,?,?,?)
     ON CONFLICT(seed,day,viewer,site) DO UPDATE SET seconds=seconds+excluded.seconds, credited=credited+excluded.credited`,
  ),
  imprSiteYesterday: db.prepare(`SELECT COALESCE(SUM(seconds),0) s FROM impressions WHERE seed=? AND day=? AND site=?`),
  voteCast: db.prepare(
    `INSERT INTO votes (seed,day,viewer,choice,ts) VALUES (?,?,?,?,?)
     ON CONFLICT(seed,day,viewer) DO UPDATE SET choice=excluded.choice, ts=excluded.ts`,
  ),
  voteTally: db.prepare(`SELECT choice, COUNT(*) c FROM votes WHERE seed=? AND day=? GROUP BY choice`),
  voteMine: db.prepare(`SELECT choice FROM votes WHERE seed=? AND day=? AND viewer=?`),
  voteTrim: db.prepare(`DELETE FROM votes WHERE seed=? AND day < ?`),
};

const VOTE_CHOICES = ["work", "rest", "social", "learn", "tend"];
const VOTE_LABEL = { work: "work hard", rest: "rest & recover", social: "reach out", learn: "learn something", tend: "tend the home" };

function tallyFor(day) {
  const rows = Q.voteTally.all(String(SEED), day);
  const tally = {};
  let total = 0;
  for (const r of rows) {
    if (!VOTE_CHOICES.includes(r.choice)) continue;
    tally[r.choice] = r.c;
    total += r.c;
  }
  return { tally, total };
}

// gentle multipliers from a day's vote — winner gets a small lift, nobody is forced
function biasFrom(day) {
  const { tally, total } = tallyFor(day);
  if (!total) return null;
  const ranked = VOTE_CHOICES.slice().sort((a, b) => (tally[b] || 0) - (tally[a] || 0));
  const bias = { work: 0.95, rest: 0.95, social: 0.95, learn: 0.95, tend: 0.95 };
  if (tally[ranked[0]]) bias[ranked[0]] = 1.35;
  if (tally[ranked[1]]) bias[ranked[1]] = 1.12;
  return bias;
}

function winnerOf(day) {
  const { tally, total } = tallyFor(day);
  if (!total) return null;
  let best = null;
  for (const c of VOTE_CHOICES) if (tally[c] && (!best || tally[c] > tally[best])) best = c;
  return best ? { choice: best, count: tally[best] } : null;
}

// set today's ballot + apply yesterday's result as a bias
function openBallot(prompt) {
  world.voteBias = biasFrom(world.day - 1);
  const { tally, total } = tallyFor(world.day);
  world.vote = {
    day: world.day,
    prompt: (prompt || world.vote?.prompt || "What should today be about?").slice(0, 80),
    tally,
    total,
  };
}

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
  for (const r of ROOM_IDS) if (!w.rooms[r]) w.rooms[r] = [];
  if (!Array.isArray(w.roomOrder) || w.roomOrder.length !== ROOM_IDS.length) w.roomOrder = [...ROOM_IDS];
  if (!w.roomStyle || typeof w.roomStyle !== "object") w.roomStyle = {};
  if (!w.agent.skills) w.agent.skills = { writing: 4, coding: 4, tinkering: 4, talking: 4 };
  if (!w.outside) w.outside = { season: "spring", neighbour: "the courier who always waves", neighbourSeenDay: 0 };
  if (!w.plants) w.plants = {};
  if (!w.rhythm || typeof w.rhythm !== "object") w.rhythm = { dow: 0, dowName: "Mon", weekend: false, badDay: false, weekStyle: "" };
  if (!w.pet || typeof w.pet !== "object") w.pet = createWorld(seed).pet;
  if (!("goal" in w)) w.goal = null;
  if (!("dream" in w)) w.dream = null;
  if (!("vote" in w)) w.vote = null;
  if (!("voteBias" in w)) w.voteBias = null;
  if (!w.objDay || typeof w.objDay !== "object") {
    w.objDay = {};
    for (const r of ROOM_IDS) for (const id of w.rooms[r] || []) w.objDay[`${r}:${id}`] = w.day;
  }
  if (!w.agent.look) w.agent.look = { skin: "#f0d9b8", shirt: "#dfe3ea", visor: "#3a4a8a" };
  if (!w.memory.overflow) w.memory.overflow = [];
  if (!w.roomDocs || Object.keys(w.roomDocs).length < ROOM_IDS.length) initDocs(w);
  return w;
}

let world;
const existing = Q.loadState.get(String(SEED));
if (existing) {
  world = restore(SEED, existing.snapshot);
  console.log(`[simyou] resumed seed ${SEED} at day ${world.day}`);
} else {
  world = createWorld(SEED);
  world.started = true;
  initDocs(world);
  console.log(`[simyou] new life, seed ${SEED}`);
}

// bank: DB is a mirror; the snapshot's value wins on resume, else seed money
const bankRow = Q.bankGet.get(String(SEED));
world.bank = typeof world.bank === "number" ? world.bank : bankRow ? bankRow.balance : START_BANK;
world.roomsVersion = world.roomsVersion || 1;
world.latestGameId = world.latestGameId || 0;

persistRooms();
persistMemories();
persistBank("init", 0, "resume");
openBallot(); // viewers can vote from the moment the server is up

// ---------- gapgpt ----------
Gap.configure({
  key: GAP_KEY,
  base: GAP_BASE,
  model: GAP_MODEL,
  onLog: (rec) => {
    try {
      const cap = (s) => (typeof s === "string" && s.length > LLM_BLOB_CAP ? s.slice(0, LLM_BLOB_CAP) + "…" : s);
      Q.llmIns.run(
        String(SEED),
        new Date().toISOString(),
        rec.meta?.phase ?? null,
        rec.meta?.day ?? null,
        rec.status ?? null,
        cap(JSON.stringify(rec.request ?? null)),
        cap(rec.content ?? null),
        cap(rec.parsed ? JSON.stringify(rec.parsed) : null),
        rec.error ?? null,
      );
    } catch (e) {
      console.error("[simyou] llm log:", e.message);
    }
  },
});

// ---------- dialogue ----------
let dialogueBusy = false;
async function runDialogue(phase) {
  if (dialogueBusy) return;
  dialogueBusy = true;
  try {
    const ctx = buildCtx();
    let result;
    if (DIALOGUE_ON && GAP_KEY) {
      const { system, user } = buildPrompt(world, phase, ctx);
      const resp = await Gap.chatJSON(system, user, { meta: { phase, day: world.day, seed: SEED } });
      result = phase === "evening" ? applyEvening(world, resp) : applyMorning(world, resp);
      result.source = "gapgpt";
    } else {
      result = stubDialogue(world, phase, world.rng);
      result.source = DIALOGUE_ON ? "offline" : "off";
    }
    finishDialogue(phase, result);
  } catch (e) {
    // never stop the day — offline fallback, "no money" style line
    const fb = stubDialogue(world, phase, world.rng);
    finishDialogue(phase, { ...fb, source: "error", line: fb.line || "no money." });
    console.error("[simyou] dialogue:", e.message);
  } finally {
    dialogueBusy = false;
  }
}

function finishDialogue(phase, r) {
  if (r.spent) {
    world.expensesToday += r.spent;
    ledger("spend", -r.spent, `${phase} purchases`);
    try { Q.dailyAdd.run(String(SEED), world.day, 0, r.spent); } catch { /* ignore */ }
  }
  if (r.earned) {
    world.incomeToday += r.earned;
    ledger("sale", r.earned, `${phase} sales`);
    try { Q.dailyAdd.run(String(SEED), world.day, r.earned, 0); } catch { /* ignore */ }
  }
  if (r.game) commitGame(r.game);
  if (phase === "morning" && r.quote && r.quote.length > 3) setQuote(r.quote);
  if (r.dream) {
    try { Q.dreamSet.run(String(SEED), world.day, String(r.dream).slice(0, 220)); } catch { /* ignore */ }
  }
  if (r.goal) {
    try { Q.goalIns.run(String(SEED), r.goal.startDay, r.goal.text, r.goal.metric, r.goal.target); } catch { /* ignore */ }
  }
  if (phase === "morning") openBallot(r.votePrompt);
  // the AI has seen the guestbook — mark those notes read
  if (world._noteHighWater) {
    try { Q.noteMarkRead.run(String(SEED), world._noteHighWater); } catch { /* ignore */ }
    world._noteHighWater = 0;
  }

  const entry = { phase, day: world.day, line: r.line || "", reply: r.reply || "", changes: r.changes || [], source: r.source, at: Date.now() };
  world.conversation.log.push(entry);
  while (world.conversation.log.length > 40) world.conversation.log.shift();
  world.conversation.bubble = { ...entry, ttl: 22 };

  regenRooms(true);
  persistRooms();
  persistMemories();
  persistBank();
  try {
    Q.convIns.run(String(SEED), world.day, phase, r.source, entry.line, entry.reply, JSON.stringify(entry.changes), new Date().toISOString());
  } catch (e) {
    console.error("[simyou] conv persist:", e.message);
  }
}

function setQuote(txt) {
  const q = String(txt).slice(0, 150);
  world.quote = { text: q, day: world.day };
  try { Q.quoteSet.run(String(SEED), world.day, q); } catch { /* ignore */ }
}

function buildCtx() {
  const digests = Q.digestRecent.all(String(SEED)).map((d) => ({ month: d.month, summary: d.summary }));
  const life = Q.lifeGet.get(String(SEED));
  const sites = SITES.sites.map((s) => ({
    id: s.id,
    label: s.label || s.id,
    ratePerVisitorDay: s.ratePerVisitorDay || 60,
    secondsYesterday: Q.imprSiteYesterday.get(String(SEED), world.day - 1, s.id)?.s || 0,
  }));
  const gamesList = Q.gameList.all(String(SEED)).map((g) => ({ title: g.title, createdDay: g.created_day, plays: g.plays }));
  const unread = Q.noteUnread.all(String(SEED));
  world._noteHighWater = unread.length ? unread[unread.length - 1].rowid : 0;
  const notes = unread.map((n) => ({ name: n.name, text: n.txt }));
  const voteResult = winnerOf(world.day - 1);
  return { digests, lifeSummary: life?.txt || "", sites, gamesList, notes, voteResult };
}

// ---------- games (spec only — never code) ----------
function commitGame(g) {
  const id = ++world.latestGameId;
  try {
    Q.gameIns.run(String(SEED), id, g.title, JSON.stringify(g.spec), world.day);
    Q.gamePrune.run(String(SEED), String(SEED));
    world.gamesCount = Q.gameList.all(String(SEED)).length;
    world.fx.push("memory");
  } catch (e) {
    console.error("[simyou] game persist:", e.message);
  }
}

// ---------- rooms ----------
function regenRooms(force) {
  let bumped = !!force;
  for (const rid of ROOM_IDS) {
    const cur = world.roomDocs[rid];
    if (force || !cur || (cur.objects || []).join(",") !== (world.rooms[rid] || []).join(",")) {
      world.roomDocs[rid] = roomDoc(SEED, rid, world.rooms[rid] || [], world.roomStyle, world.objDay, world.plants);
      bumped = true;
    }
  }
  if (bumped) world.roomsVersion++;
}

// ---------- bank / ledger ----------
function ledger(kind, amount, note) {
  try {
    Q.ledgerIns.run(String(SEED), new Date().toISOString(), kind, Math.round(amount * 100) / 100, note || "");
  } catch (e) {
    console.error("[simyou] ledger:", e.message);
  }
}
function persistBank() {
  try {
    Q.bankSet.run(String(SEED), Math.round(world.bank * 100) / 100, new Date().toISOString());
  } catch (e) {
    console.error("[simyou] bank persist:", e.message);
  }
}

// ---------- persistence ----------
function persistState() {
  try {
    Q.saveState.run(String(SEED), snapshotJSON(world), new Date().toISOString());
  } catch (e) {
    console.error("[simyou] state persist:", e.message);
  }
}
function persistRooms() {
  try {
    for (const rid of ROOM_IDS) {
      const d = world.roomDocs[rid];
      if (d) Q.roomSave.run(String(SEED), rid, JSON.stringify(d.objects), d.html, d.updated);
    }
  } catch (e) {
    console.error("[simyou] rooms persist:", e.message);
  }
}
function persistMemories() {
  try {
    const now = new Date().toISOString();
    for (const m of world.memory.slots) {
      Q.memUpsert.run(String(SEED), m.id, m.kind, m.text, m.trait, m.dir, m.mag, m.weight, m.bornDay, now);
    }
    for (const m of world.memory.overflow || []) {
      Q.memUpsert.run(String(SEED), m.id, m.kind, m.text, m.trait, m.dir, m.mag, m.weight, m.bornDay, now);
    }
    world.memory.overflow = [];
    world.memory.total = Q.memCount.get(String(SEED))?.c ?? world.memory.total;
  } catch (e) {
    console.error("[simyou] memories persist:", e.message);
  }
}

// ---------- daily maintenance ----------
function onNewDayServer() {
  persistMemories();

  // record a resolved goal + last night's dream
  if (world.goal && (world.goal.done || world.goal.failed)) {
    try {
      Q.goalIns.run(String(SEED), world.goal.startDay, world.goal.text, world.goal.metric, world.goal.target);
      Q.goalEnd.run(world.goal.done ? "done" : "failed", world.day, String(SEED), world.goal.startDay);
    } catch {
      /* ignore */
    }
  }
  if (world.dream && world.dream.day === world.day) {
    try { Q.dreamSet.run(String(SEED), world.day, world.dream.text); } catch { /* ignore */ }
  }

  // consolidate dormant, old memories into a monthly digest (kept, not deleted)
  try {
    const rows = Q.memDormant.all(String(SEED), world.day);
    const byMonth = new Map();
    for (const r of rows) {
      const mo = Math.floor(r.born_day / 30);
      if (!byMonth.has(mo)) byMonth.set(mo, []);
      byMonth.get(mo).push(r);
    }
    for (const [mo, list] of byMonth) {
      const traits = {};
      for (const r of list) traits[r.trait] = (traits[r.trait] || 0) + 1;
      const topTrait = Object.entries(traits).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      const notable = list.slice(0, 3).map((r) => r.txt).join(" / ");
      const summary = `mostly ${topTrait}. ${notable}`.slice(0, 300);
      Q.digestUpsert.run(String(SEED), mo, summary, list.length, new Date().toISOString());
      for (const r of list) Q.memArchive.run(String(SEED), r.id);
    }
  } catch (e) {
    console.error("[simyou] consolidate:", e.message);
  }
  // life summary every 10 in-game days (template — no API cost)
  const life = Q.lifeGet.get(String(SEED));
  if (!life || world.day - (life.updated_day || 0) >= 10) {
    try {
      const top = Q.memTopActive.all(String(SEED)).map((r) => r.txt);
      const dg = Q.digestRecent.all(String(SEED)).map((r) => r.summary);
      const p = world.agent.personality;
      const txt =
        `Day ${world.day}, ${world.era.name}. ` +
        `Leaning ${dominant(p)}. Bank ${Math.round(world.bank)}c, ${world.gamesCount || 0} games made. ` +
        (top.length ? `Holds onto: ${top.slice(0, 4).join("; ")}. ` : "") +
        (dg.length ? `Earlier: ${dg[0]}.` : "");
      Q.lifeSet.run(String(SEED), txt.slice(0, 1200), world.day);
    } catch (e) {
      console.error("[simyou] life summary:", e.message);
    }
  }

  // roll yesterday's totals into the daily table (income beats also land there live)
  try {
    Q.dailyAdd.run(String(SEED), world.day - 1, 0, 0); // ensure the row exists
  } catch { /* ignore */ }

  // if the morning conversation didn't give a quote, make one from history
  if (!world.quote || world.quote.day < world.day) {
    const top = Q.memTopActive.all(String(SEED)).map((r) => r.txt);
    if (top.length) setQuote(`"${top[Math.floor(Math.random() * Math.min(3, top.length))]}"`);
  }
}
function dominant(p) {
  return Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
}

let guardTicks = 0;
function sizeGuard() {
  try {
    const pageCount = db.prepare("PRAGMA page_count").get();
    const pageSize = db.prepare("PRAGMA page_size").get();
    const bytes = (pageCount.page_count || 0) * (pageSize.page_size || 0);
    if (bytes > DB_SOFT_CAP) {
      console.log(`[simyou] db ${(bytes / 1e6) | 0}MB > cap — trimming`);
      Q.llmTrim.run(String(SEED), String(SEED));
      Q.convTrim.run(String(SEED), world.day - CONV_KEEP_DAYS);
      Q.gamePrune.run(String(SEED), String(SEED));
      Q.voteTrim.run(String(SEED), world.day - 14);
      db.exec("PRAGMA incremental_vacuum; VACUUM;");
    } else {
      db.exec("PRAGMA incremental_vacuum(200);");
    }
  } catch (e) {
    console.error("[simyou] size guard:", e.message);
  }
}

// ---------- sim loop ----------
let acc = 0;
let lastTick = Date.now();
let prevDay = world.day;
let paused = false; // set while an admin fast-forward runs

// after ticking, run the daily rollover + dialogue side-effects (shared with advance)
function postTick() {
  if (world.day !== prevDay) {
    prevDay = world.day;
    regenRooms(true);
    persistRooms();
    onNewDayServer();
  }
}

// advance the whole life by `n` in-game days as fast as possible — every dawn /
// dusk conversation still fires (buys, sells, games, routines, memory).
async function advanceDays(n) {
  paused = true;
  const target = world.day + n;
  let guard = 0;
  try {
    while (world.day < target && guard++ < n * 40000) {
      tick(world, FIXED_DT);
      postTick();
      if (world.dialogueRequest && !dialogueBusy) {
        const phase = world.dialogueRequest;
        world.dialogueRequest = null;
        await runDialogue(phase);
      }
      if (guard % 4000 === 0) await new Promise((r) => setImmediate(r));
    }
    drainFx(world);
    persistState();
    persistBank();
    persistMemories();
    persistRooms();
    backup("advance");
  } finally {
    lastTick = Date.now();
    acc = 0;
    paused = false;
  }
}

setInterval(() => {
  if (paused) {
    lastTick = Date.now();
    return;
  }
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

  // agent playing a game
  if (world.agent.room === "game" && world.latestGameId && world.agent.transit <= 0 && !world.agent.moving) {
    world._playAcc = (world._playAcc || 0) + dtReal;
    if (world._playAcc > 8) {
      world._playAcc = 0;
      try {
        Q.gamePlays.run(String(SEED), world.latestGameId);
      } catch {
        /* ignore */
      }
    }
  }

  postTick();

  if (world.dialogueRequest && !dialogueBusy) {
    const phase = world.dialogueRequest;
    world.dialogueRequest = null;
    runDialogue(phase);
  }

  const fx = drainFx(world);
  if (fx) for (const t of fx) fxTail.push({ n: ++fxSeq, t });
  while (fxTail.length > 24) fxTail.shift();

  if (++guardTicks % 3000 === 0) sizeGuard();
}, TICK_MS);

setInterval(() => {
  persistState();
  persistBank();
}, PERSIST_MS);

// ---------- viewer snapshot + SSE ----------
let fxSeq = 0;
const fxTail = [];
const clients = new Set();

function viewSnapshot() {
  return JSON.stringify({
    seedTag: SEED_TAG,
    day: world.day,
    dayFrac: world.dayFrac,
    isNight: world.isNight,
    tokens: world.tokens,
    reputation: world.reputation,
    requests: world.requests,
    bank: Math.round(world.bank),
    incomeYesterday: Math.round(world.incomeYesterday || 0),
    expensesYesterday: Math.round(world.expensesYesterday || 0),
    incomeToday: Math.round(world.incomeToday || 0),
    roomOrder: world.roomOrder,
    roomsVersion: world.roomsVersion,
    memoryTotal: world.memory.total || world.memory.slots.length,
    gamesCount: world.gamesCount || 0,
    latestGameId: world.latestGameId || 0,
    quote: world.quote || null,
    dream: world.dream && world.dream.day >= world.day - 1 ? world.dream : null,
    goal: world.goal
      ? { text: world.goal.text, metric: world.goal.metric, target: world.goal.target, done: !!world.goal.done, failed: !!world.goal.failed, frac: goalFrac(world) }
      : null,
    outside: { season: world.outside?.season || "spring", neighbour: world.outside?.neighbour || "" },
    plants: world.plants || {},
    rhythm: world.rhythm || null,
    pet: world.pet ? { kind: world.pet.kind, name: world.pet.name, room: world.pet.room, x: world.pet.x, y: world.pet.y, facing: world.pet.facing, state: world.pet.state, bond: world.pet.bond } : null,
    vote: (() => {
      const t = tallyFor(world.day);
      return { day: world.day, prompt: world.vote?.prompt || "What should today be about?", choices: VOTE_CHOICES, labels: VOTE_LABEL, tally: t.tally, total: t.total, bias: world.voteBias || null };
    })(),
    notesUnread: Q.noteUnreadCount.get(String(SEED))?.c || 0,
    agent: world.agent,
    mood: world.mood,
    weather: world.weather,
    windowEvent: world.windowEvent,
    era: world.era,
    memory: { slots: world.memory.slots, latestText: world.memory.latestText },
    conversation: { bubble: world.conversation.bubble }, // full log via /api/conversations
    gapgpt: !!(DIALOGUE_ON && GAP_KEY),
    fx: fxTail,
  });
}
function broadcast() {
  if (!clients.size) return;
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
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const BLOCKED = /(^|\/)(config\.js|config\.local\.js|sites\.json|\.env|server\.mjs|.*\.db(-.*)?|llm\.log)$/;

function sendJSON(res, s) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(s);
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
      if (b.length > 65536) req.destroy();
    });
    req.on("end", () => resolve(b));
    req.on("error", () => resolve(""));
  });
}
function viewerHash(req, id) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  return createHash("sha1").update(ip + "|" + String(id || "")).digest("hex").slice(0, 16);
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

  if (path === "/api/sites") {
    return sendJSON(
      res,
      JSON.stringify({
        rotateSeconds: SITES.rotateSeconds || 45,
        sites: SITES.sites.map((s) => ({ id: s.id, label: s.label || s.id, url: s.url })),
      }),
    );
  }

  if (path === "/api/rooms") {
    const out = {};
    for (const rid of ROOM_IDS) {
      const d = world.roomDocs[rid];
      if (d) out[rid] = { objects: d.objects, meta: d.meta || [], html: d.html, updated: d.updated };
    }
    return sendJSON(res, JSON.stringify({ version: world.roomsVersion, order: world.roomOrder, rooms: out }));
  }

  if (path === "/api/market") {
    const out = {};
    for (const [cat, items] of Object.entries(MARKET)) {
      out[cat] = items.map((o) => ({ id: o.id, label: o.label, room: o.room, price: o.price, glyph: o.glyph }));
    }
    return sendJSON(res, JSON.stringify(out));
  }

  if (path === "/api/bank") {
    return sendJSON(
      res,
      JSON.stringify({
        balance: Math.round(world.bank),
        incomeToday: Math.round(world.incomeToday || 0),
        incomeYesterday: Math.round(world.incomeYesterday || 0),
        expensesYesterday: Math.round(world.expensesYesterday || 0),
      }),
    );
  }
  if (path === "/api/ledger") return sendJSON(res, JSON.stringify(Q.ledgerTail.all(String(SEED))));
  if (path === "/api/daily") return sendJSON(res, JSON.stringify(Q.dailyList.all(String(SEED))));
  if (path === "/api/quotes") return sendJSON(res, JSON.stringify(Q.quoteList.all(String(SEED))));
  if (path === "/api/dreams") return sendJSON(res, JSON.stringify(Q.dreamList.all(String(SEED))));
  if (path === "/api/goals") return sendJSON(res, JSON.stringify(Q.goalList.all(String(SEED))));
  if (path === "/api/notes") return sendJSON(res, JSON.stringify(Q.noteRecent.all(String(SEED))));

  if (path === "/api/note" && req.method === "POST") {
    const body = safeParse(await readBody(req), {});
    const viewer = viewerHash(req, body.viewer);
    let name = String(body.name || "someone").replace(/[<>\n\r]/g, "").trim().slice(0, 24) || "someone";
    let text = String(body.text || "").replace(/[<>\n\r]+/g, " ").trim().slice(0, 180);
    if (text.length < 2) {
      res.writeHead(400);
      return res.end("say something");
    }
    if (BAD_WORDS.test(text) || BAD_WORDS.test(name)) {
      res.writeHead(422);
      return res.end("keep it kind");
    }
    const since = new Date(Date.now() - 8 * 60000).toISOString();
    if ((Q.noteViewerRecent.get(String(SEED), viewer, since)?.c || 0) >= 1) {
      res.writeHead(429);
      return res.end("one note every few minutes");
    }
    Q.noteIns.run(String(SEED), new Date().toISOString(), viewer, name, text);
    Q.noteTrim.run(String(SEED), String(SEED));
    world.fx.push("event");
    world.agent.lastThought = "someone left a note…";
    return sendJSON(res, JSON.stringify({ ok: true }));
  }
  if (path === "/api/vote") {
    const viewer = viewerHash(req, null);
    if (req.method === "POST") {
      const body = safeParse(await readBody(req), {});
      const choice = String(body.choice || "");
      if (!VOTE_CHOICES.includes(choice)) {
        res.writeHead(400);
        return res.end("unknown choice");
      }
      try {
        Q.voteCast.run(String(SEED), world.day, viewer, choice, new Date().toISOString());
      } catch {
        /* ignore */
      }
      world.fx.push("event");
    }
    const t = tallyFor(world.day);
    const mine = Q.voteMine.get(String(SEED), world.day, viewer)?.choice || null;
    return sendJSON(res, JSON.stringify({
      day: world.day,
      prompt: world.vote?.prompt || "What should today be about?",
      choices: VOTE_CHOICES,
      labels: VOTE_LABEL,
      tally: t.tally,
      total: t.total,
      mine,
      yesterday: winnerOf(world.day - 1),
    }));
  }

  if (path === "/api/journal") {
    const life = Q.lifeGet.get(String(SEED));
    return sendJSON(res, JSON.stringify({
      day: world.day,
      season: world.outside?.season || "spring",
      week: world.rhythm?.weekStyle || "",
      pet: world.pet ? { name: world.pet.name, bond: world.pet.bond } : null,
      lifeSummary: life?.txt || "",
      digests: Q.digestRecent.all(String(SEED)).map((d) => ({ month: d.month, summary: d.summary })),
      memories: Q.memTopActive.all(String(SEED)).map((m) => m.txt),
      goals: Q.goalList.all(String(SEED)),
      dreams: Q.dreamList.all(String(SEED)).slice(0, 12),
      quotes: Q.quoteList.all(String(SEED)).slice(0, 12),
    }));
  }

  if (path === "/api/conversations") {
    return sendJSON(
      res,
      JSON.stringify(Q.convList.all(String(SEED)).map((r) => ({ ...r, changes: safeParse(r.changes, []) }))),
    );
  }
  if (path === "/api/memories") {
    return sendJSON(
      res,
      JSON.stringify(
        db.prepare(`SELECT id,kind,txt,trait,dir,weight,born_day,archived FROM memories WHERE seed=? ORDER BY weight DESC LIMIT 200`).all(String(SEED)),
      ),
    );
  }
  if (path === "/api/games") return sendJSON(res, JSON.stringify(Q.gameList.all(String(SEED)).map((g) => ({ id: g.id, title: g.title, createdDay: g.created_day, plays: g.plays }))));

  const gapi = path.match(/^\/api\/games\/(\d{1,9})$/);
  if (gapi) {
    const row = Q.gameSpec.get(String(SEED), Number(gapi[1]));
    if (!row) {
      res.writeHead(404);
      return res.end();
    }
    const spec = safeParse(row.spec, null);
    return sendJSON(
      res,
      JSON.stringify({
        id: Number(gapi[1]),
        title: row.title,
        createdDay: row.created_day,
        plays: row.plays,
        spec,
        describe: spec ? describeSpec(spec) : "unknown",
      }),
    );
  }

  const gm = path.match(/^\/games\/(\d{1,9})$/);
  if (gm) {
    const row = Q.gameSpec.get(String(SEED), Number(gm[1]));
    if (!row) {
      res.writeHead(404);
      return res.end();
    }
    const specJson = String(row.spec || "null").replace(/</g, "\\u003c");
    const nonce = randomBytes(12).toString("base64");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${(row.title || "game").replace(/[<>&]/g, "")}</title>
<style>html,body{margin:0;height:100%;background:#05070a;overflow:hidden}#g{display:block;width:100vw;height:100vh}</style>
</head><body><canvas id="g"></canvas>
<script type="application/json" id="spec">${specJson}</script>
<script nonce="${nonce}">${GAME_JS}</script>
</body></html>`;
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:`,
    });
    return res.end(html);
  }

  // ---- admin (gated by SIMYOU_ADMIN_TOKEN) ----
  if (path.startsWith("/api/admin/") && req.method === "POST") {
    const body = safeParse(await readBody(req), {});
    const tok = body.token || new URL(req.url, "http://x").searchParams.get("token");
    if (!ADMIN_TOKEN || tok !== ADMIN_TOKEN) {
      res.writeHead(403);
      return res.end("forbidden (set SIMYOU_ADMIN_TOKEN and pass ?token=)");
    }
    if (path === "/api/admin/advance") {
      if (paused) {
        res.writeHead(409);
        return res.end("already advancing");
      }
      const days = Math.max(1, Math.min(60, Math.round(Number(body.days) || 1)));
      const from = world.day;
      const t0 = Date.now();
      await advanceDays(days);
      return sendJSON(
        res,
        JSON.stringify({ ok: true, from, to: world.day, bank: Math.round(world.bank), games: world.gamesCount || 0, ms: Date.now() - t0 }),
      );
    }
    if (path === "/api/admin/say") {
      const phase = body.phase === "morning" ? "morning" : "evening";
      if (!dialogueBusy) await runDialogue(phase);
      return sendJSON(res, JSON.stringify({ ok: true, phase, bank: Math.round(world.bank) }));
    }
    if (path === "/api/admin/backup") {
      backup("manual");
      return sendJSON(res, JSON.stringify({ ok: true, dir: process.env.SIMYOU_BACKUP_DIR || null }));
    }
    res.writeHead(404);
    return res.end();
  }

  if (path === "/api/impression" && req.method === "POST") {
    const body = safeParse(await readBody(req), {});
    const site = siteById.get(String(body.site || ""));
    const seconds = Math.max(0, Math.min(30, Number(body.seconds) || 0));
    if (!site || seconds <= 0) {
      res.writeHead(204);
      return res.end();
    }
    const viewer = viewerHash(req, body.viewer);
    const daySum = Q.imprDaySum.get(String(SEED), world.day, viewer)?.s || 0;
    const room = Math.max(0, VIEWER_DAY_SECONDS_CAP - daySum);
    const toCredit = Math.min(seconds, room);
    const coins = (site.ratePerVisitorDay || 60) * (toCredit / REAL_SECS_PER_DAY);
    Q.imprUpsert.run(String(SEED), world.day, viewer, site.id, seconds, toCredit);
    if (coins > 0) {
      world.bank += coins;
      world.incomeToday += coins;
      try { Q.dailyAdd.run(String(SEED), world.day, coins, 0); } catch { /* ignore */ }
      if (Math.random() < 0.04) ledger("view", coins, `${site.id} +${coins.toFixed(1)}`); // sample, not every beat
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, bank: Math.round(world.bank) }));
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
    const buf = await readFile(file);
    const ext = extname(file);
    // App code and markup must never be served stale — no-store defeats every
    // cache layer (browser, nginx, CDN). Static art can revalidate cheaply.
    const volatile = ext === ".html" || ext === ".js" || ext === ".css" || ext === ".webmanifest";
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": volatile ? "no-store, must-revalidate" : "no-cache",
    });
    res.end(buf);
  } catch {
    res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(
    `[simyou] http://localhost:${PORT}  seed ${SEED}  db ${DB_PATH}  sites ${SITES.sites.length}  gapgpt ${GAP_KEY ? GAP_MODEL : "off"}`,
  );
});

function safeParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[simyou] ${sig} — persisting`);
    persistState();
    persistBank();
    persistMemories();
    persistRooms();
    backup("shutdown");
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
}
