// Browser viewer. The life runs on the server (server.mjs); this connects to
// the /stream SSE feed, smooths the agent between updates, and renders. No
// simulation, no API key here. The only inputs are view toggles.

import * as Audio from "./engine/audio.js";
import { render, MUTE_RECT } from "./render/draw.js";
import { rainIntensity } from "./sim/weather.js";

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
const roomLayer = document.getElementById("room-html");
const tbSeed = document.getElementById("tb-seed");
const tbTok = document.getElementById("tb-tok");

let world = null; // latest snapshot
let audioReady = false; // WebAudio needs one user gesture before it can start
let lastFx = 0;
let moodPush = 0;
let shownRoomHtml = null;
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
};

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
  };
  es.onerror = () => {
    /* EventSource retries on its own */
  };
}
connect();

// ---------- render loop ----------
function frame(now) {
  requestAnimationFrame(frame);
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
    started: true, // the life is always live — no title / begin gate
    agent: { ...a, x: display.x, y: display.y },
    roomDocs: world.room ? { [world.agent.room]: world.room } : {},
  };

  if (Audio.isReady()) {
    Audio.setRain(rainIntensity(world.weather.sky));
    Audio.update();
    moodPush -= 1 / 60;
    if (moodPush <= 0) {
      Audio.setMood(world.mood.valence);
      moodPush = 1.5;
    }
  }

  syncRoomLayer(w);
  tbSeed.textContent = `seed ${world.seed}`;
  tbTok.textContent = `◊ ${world.tokens} tokens`;
  if (ui.notice && performance.now() > ui.notice.until) ui.notice = null;

  render(ctx, w, ui);
}
requestAnimationFrame(frame);

function syncRoomLayer(w) {
  const show = w.agent.transit <= 0;
  roomLayer.style.display = show ? "block" : "none";
  if (!show) return;
  const doc = w.roomDocs[w.agent.room];
  const html = doc ? doc.html : "";
  if (html !== shownRoomHtml) {
    roomLayer.innerHTML = html;
    shownRoomHtml = html;
  }
}

// ---------- optional view controls ----------
// The life runs with no input. These only change what the viewer sees, and the
// first click doubles as the gesture that lets sound start (still muted until
// the speaker is toggled on).
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
  } else {
    ensureAudio();
  }
});

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "m") ui.showMemory = !ui.showMemory;
  else if (k === "c") ui.showConversation = !ui.showConversation;
  else if (k === "s") ui.showCard = !ui.showCard;
  else if (k === "d") ui.debug = !ui.debug;
  else if (k === "p") toggleMute();
});
