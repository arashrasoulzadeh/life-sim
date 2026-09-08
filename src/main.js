import { randomSeed } from "./engine/rng.js";
import * as Audio from "./engine/audio.js";
import * as Gap from "./engine/gapgpt.js";
import { render, MUTE_RECT } from "./render/draw.js";
import { createWorld, tick, drainFx, rainLevel, DAY_LENGTH } from "./sim/world.js";
import { buildPrompt, applyDialogue, stubDialogue } from "./sim/dialogue.js";

// time mapping: how many in-game minutes pass per real second
const BASE_MIN_PER_SEC = 20; // default clock
const FF_MIN_PER_SEC = 60; // [F] fast-forward: one in-game hour per second
const MIN_PER_DAY = 24 * 60;
const rateFor = (minPerSec) => (minPerSec / MIN_PER_DAY) * DAY_LENGTH;
const BASE_RATE = rateFor(BASE_MIN_PER_SEC);
const FF_MULT = FF_MIN_PER_SEC / BASE_MIN_PER_SEC;

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d", { alpha: false });

const params = new URLSearchParams(location.search);
const seed = params.has("seed") ? Number(params.get("seed")) >>> 0 : randomSeed();

// optional GapGPT config: window.SIMYOU_CONFIG (config.js) then a localStorage override
const CFG = window.SIMYOU_CONFIG || {};
Gap.configure({ key: CFG.gapgptKey, base: CFG.gapgptBase, model: CFG.model });
try {
  const k = localStorage.getItem("simyou_gapgpt_key");
  if (k) Gap.configure({ key: k });
} catch {
  /* private mode */
}

let world = createWorld(seed);
const ui = {
  debug: params.has("debug"),
  showMemory: false,
  showCard: false,
  showConversation: false,
  muted: true,
  llm: Gap.hasKey(), // start/end-of-day chat uses the API when a key is set, otherwise an offline stub
  llmSource: Gap.hasKey() ? "gapgpt" : "offline",
  notice: null,
};

let speed = 1;
let moodPush = 0;
let dialogueBusy = false;

function toggleMute() {
  ui.muted = !ui.muted;
  Audio.setMuted(ui.muted);
}

function flash(text) {
  ui.notice = { text, until: performance.now() + 3500 };
}

async function runDialogue(phase) {
  if (dialogueBusy) return;
  dialogueBusy = true;
  const w = world;
  try {
    let result;
    if (ui.llm && Gap.hasKey()) {
      const { system, user } = buildPrompt(w, phase);
      const resp = await Gap.chatJSON(system, user);
      result = applyDialogue(w, resp);
      result.source = "gapgpt";
    } else {
      result = stubDialogue(w, phase, w.rng);
      result.source = ui.llm ? "offline" : "offline";
    }
    const entry = { phase, day: w.day, line: result.line, changes: result.changes, source: result.source, at: Date.now() };
    w.conversation.log.push(entry);
    w.conversation.bubble = { ...entry, ttl: 50 };
    if (result.source === "gapgpt") Audio.blip("memory");
  } catch (err) {
    world.conversation.log.push({
      phase,
      day: world.day,
      line: `couldn't reach gapgpt (${err.message}) — using offline voice`,
      changes: [],
      source: "error",
      at: Date.now(),
    });
    const fb = stubDialogue(world, phase, world.rng);
    world.conversation.bubble = { phase, day: world.day, line: fb.line, changes: fb.changes, source: "offline", ttl: 50 };
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
  render(ctx, world, ui);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function begin() {
  if (world.started) return;
  world.started = true;
  Audio.start(world.seed);
  Audio.setMuted(ui.muted);
}

function skipToNextDay() {
  if (!world.started) return;
  const target = world.day + 1;
  let guard = 0;
  while (world.day < target && guard++ < 20000) tick(world, FIXED_DT);
  drainFx(world);
  acc = 0;
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

addEventListener("keydown", (e) => {
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
          : "no API key — using offline voice (set localStorage simyou_gapgpt_key or config.js)"
        : "start/end-of-day chat: off",
    );
  } else if (k === "r") {
    world = createWorld(randomSeed());
    world.started = true;
    history.replaceState(null, "", `?seed=${world.seed}`);
  }
});

console.info(
  `SimYou life seed ${seed} — replay with ?seed=${seed}. GapGPT ${Gap.hasKey() ? "configured (" + Gap.info().model + ")" : "not configured — offline conversations"}.`,
);

// debug hook (harmless): window.SIM.world, window.SIM.say("evening")
window.SIM = {
  get world() {
    return world;
  },
  say: (phase) => runDialogue(phase === "morning" ? "morning" : "evening"),
};
