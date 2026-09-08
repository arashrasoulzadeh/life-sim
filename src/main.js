import { randomSeed } from "./engine/rng.js";
import * as Audio from "./engine/audio.js";
import * as Gap from "./engine/gapgpt.js";
import { render, MUTE_RECT } from "./render/draw.js";
import { createWorld, tick, drainFx, rainLevel, DAY_LENGTH } from "./sim/world.js";
import { buildPrompt, applyDialogue, stubDialogue } from "./sim/dialogue.js";
import { initDocs, loadOrInit, pollRoom, saveChangedRooms } from "./sim/worldfiles.js";

// time mapping: how many in-game minutes pass per real second
const BASE_MIN_PER_SEC = 3;
const FF_MIN_PER_SEC = 15;
const MIN_PER_DAY = 24 * 60;
const rateFor = (m) => (m / MIN_PER_DAY) * DAY_LENGTH;
const BASE_RATE = rateFor(BASE_MIN_PER_SEC);
const FF_MULT = FF_MIN_PER_SEC / BASE_MIN_PER_SEC;

const CFG = window.SIMYOU_CONFIG || {};
Gap.configure({ key: CFG.gapgptKey, base: CFG.gapgptBase, model: CFG.model });
try {
  const k = localStorage.getItem("simyou_gapgpt_key");
  if (k) Gap.configure({ key: k });
} catch {
  /* private mode */
}

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
const roomLayer = document.getElementById("room-html");
const tbSeed = document.getElementById("tb-seed");
const tbTok = document.getElementById("tb-tok");

const params = new URLSearchParams(location.search);
// seed: ?seed=… wins, else config.js `seed`, else random
function resolveSeed() {
  if (params.has("seed")) return Number(params.get("seed")) >>> 0;
  if (CFG.seed !== undefined && CFG.seed !== null && `${CFG.seed}`.trim() !== "") return Number(CFG.seed) >>> 0;
  return randomSeed();
}

let world = createWorld(resolveSeed());
initDocs(world);

const ui = {
  debug: params.has("debug"),
  showMemory: false,
  showCard: false,
  showConversation: false,
  muted: true,
  llm: Gap.hasKey(),
  llmSource: Gap.hasKey() ? "gapgpt" : "offline",
  notice: null,
};

let speed = 1;
let moodPush = 0;
let dialogueBusy = false;
let shownRoom = null;
let shownUpdated = null;

function toggleMute() {
  ui.muted = !ui.muted;
  Audio.setMuted(ui.muted);
}

function flash(text) {
  ui.notice = { text, until: performance.now() + 3500 };
}

function updateTopbar() {
  tbSeed.textContent = `seed ${world.seed}`;
  tbTok.textContent = `◊ ${world.tokens} tokens`;
}

function syncRoomLayer() {
  const show = world.started && world.agent.transit <= 0;
  roomLayer.style.display = show ? "block" : "none";
  if (!show) return;
  const rid = world.agent.room;
  const doc = world.roomDocs[rid];
  if (!doc) return;
  if (rid !== shownRoom || doc.updated !== shownUpdated) {
    roomLayer.innerHTML = doc.html || "";
    shownRoom = rid;
    shownUpdated = doc.updated;
  }
}

async function runDialogue(phase) {
  if (dialogueBusy) return;
  dialogueBusy = true;
  const w = world;
  try {
    let result;
    if (ui.llm && Gap.hasKey()) {
      const { system, user } = buildPrompt(w, phase);
      const resp = await Gap.chatJSON(system, user, { meta: { phase, day: w.day, seed: w.seed } });
      result = applyDialogue(w, resp);
      result.source = "gapgpt";
    } else {
      result = stubDialogue(w, phase, w.rng);
      result.source = "offline";
    }
    w.conversation.log.push({ phase, day: w.day, ...result, at: Date.now() });
    w.conversation.bubble = { phase, day: w.day, ...result, ttl: 22 };
    if (result.source === "gapgpt") Audio.blip("memory");
    saveChangedRooms(w);
  } catch (err) {
    const fb = stubDialogue(world, phase, world.rng);
    world.conversation.log.push({
      phase,
      day: world.day,
      line: `couldn't reach gapgpt (${err.message}) — offline voice`,
      changes: fb.changes,
      source: "error",
      at: Date.now(),
    });
    world.conversation.bubble = { phase, day: world.day, line: fb.line, changes: fb.changes, source: "offline", ttl: 22 };
    saveChangedRooms(world);
  } finally {
    dialogueBusy = false;
  }
}

const FIXED_DT = 1 / 30;
let acc = 0;
let last = performance.now();

function frame(now) {
  let elapsed = (now - last) / 1000;
  last = now;
  if (elapsed > 0.25) elapsed = 0.25;

  if (world.started) {
    acc += elapsed * BASE_RATE * speed;
    if (acc > 2) acc = 2;
    while (acc >= FIXED_DT) {
      tick(world, FIXED_DT);
      acc -= FIXED_DT;
    }

    if (world.dialogueRequest) {
      const phase = world.dialogueRequest;
      world.dialogueRequest = null;
      runDialogue(phase);
    }

    const fx = drainFx(world);
    if (fx) for (const tag of fx) Audio.blip(tag);
    Audio.setRain(rainLevel(world));
    Audio.update();
    moodPush -= elapsed;
    if (moodPush <= 0) {
      Audio.setMood(world.mood.valence);
      moodPush = 1.5;
    }
  }

  if (ui.notice && performance.now() > ui.notice.until) ui.notice = null;
  syncRoomLayer();
  updateTopbar();
  render(ctx, world, ui);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// pick up hand-edits to the current room's file
setInterval(() => {
  if (world.started) pollRoom(world, world.agent.room);
}, 3000);

function begin() {
  if (world.started) return;
  world.started = true;
  Audio.start(world.seed);
  Audio.setMuted(ui.muted);
  loadOrInit(world);
}

function skipToNextDay() {
  if (!world.started) return;
  const target = world.day + 1;
  let guard = 0;
  while (world.day < target && guard++ < 20000) tick(world, FIXED_DT);
  drainFx(world);
  acc = 0;
}

function newLife(seed) {
  world = createWorld(seed);
  initDocs(world);
  world.started = true;
  shownRoom = null;
  history.replaceState(null, "", `?seed=${world.seed}`);
  loadOrInit(world);
}

canvas.addEventListener("click", (e) => {
  const r = canvas.getBoundingClientRect();
  const cx = ((e.clientX - r.left) / r.width) * canvas.width;
  const cy = ((e.clientY - r.top) / r.height) * canvas.height;
  const m = MUTE_RECT;
  if (cx >= m.x - 4 && cx <= m.x + m.w + 4 && cy >= m.y - 4 && cy <= m.y + m.h + 4) {
    if (!world.started) begin();
    toggleMute();
    return;
  }
  if (!world.started) begin();
});

document.getElementById("tb-seedbtn").addEventListener("click", () => {
  const v = prompt("seed number (blank = random):", String(world.seed));
  if (v === null) return;
  const s = v.trim() === "" ? randomSeed() : Number(v) >>> 0;
  newLife(s);
});

addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (!world.started && (k === " " || k === "enter")) return begin();
  if (k === "f") speed = speed === 1 ? FF_MULT : 1;
  else if (k === "n") skipToNextDay();
  else if (k === "d") ui.debug = !ui.debug;
  else if (k === "m") ui.showMemory = !ui.showMemory;
  else if (k === "s") ui.showCard = !ui.showCard;
  else if (k === "c") ui.showConversation = !ui.showConversation;
  else if (k === "p") toggleMute();
  else if (k === "l") {
    ui.llm = !ui.llm;
    ui.llmSource = ui.llm && Gap.hasKey() ? "gapgpt" : "offline";
    flash(
      ui.llm
        ? Gap.hasKey()
          ? "start/end-of-day chat: GapGPT"
          : "no API key — offline voice (set localStorage simyou_gapgpt_key or config.js)"
        : "start/end-of-day chat: off",
    );
  } else if (k === "r") newLife(randomSeed());
});

console.info(
  `SimYou life seed ${world.seed} — replay with ?seed=${world.seed}. GapGPT ${Gap.hasKey() ? "configured (" + Gap.info().model + ")" : "offline"}.`,
);

window.SIM = {
  get world() {
    return world;
  },
  say: (phase) => runDialogue(phase === "morning" ? "morning" : "evening"),
};
