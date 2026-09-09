// Builds the morning / evening prompt from the world + a server-assembled context,
// and safely applies the reply. The model NEVER supplies code — it picks from
// closed vocabularies (room objects, game kernels, routine moves, hex colours)
// and every field is validated here before it touches the world.

import { OBJECTS, OBJECT_IDS_BY_ROOM, priceOf, sellValue, isSellable } from "./objects.js";
import { TRAITS } from "./memory.js";
import { ROOM_IDS } from "./rooms.js";
import { ROUTINE_OPS } from "./agent.js";
import { KERNELS, validateSpec } from "../game/kernels.js";

export const GAME_COST = 400;
const HEX = /^#[0-9a-fA-F]{6}$/;

function clampTrait(v) {
  return v < 0.05 ? 0.05 : v > 1.2 ? 1.2 : v;
}
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const arr = (v) => (Array.isArray(v) ? v : []);

// ---------- prompt ----------
export function buildPrompt(w, phase, ctx = {}) {
  const p = w.agent.personality;
  const evening = phase === "evening";

  const mems = w.memory.slots
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((s) => `- ${s.text} (${s.trait}${s.dir > 0 ? "+" : "-"}, ${s.weight.toFixed(1)})`);
  const digests = (ctx.digests || []).map((d) => `- [month ${d.month}] ${d.summary}`);
  const memBlock = [
    ctx.lifeSummary ? `Life so far: ${ctx.lifeSummary}` : "",
    mems.join("\n") || "- (none yet)",
    digests.length ? "Older:\n" + digests.join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");

  const rooms = w.roomOrder
    .map((r) => {
      const items = (w.rooms[r] || []).map((id) => `${id} (${OBJECTS[id].label}, ${priceOf(id)}c)`).join(", ") || "bare";
      return `  ${r}: ${items}${r === "desk" ? " [+ permanent monitor, unsellable]" : ""}`;
    })
    .join("\n");
  const catalog = Object.entries(OBJECT_IDS_BY_ROOM)
    .map(([r, ids]) => `  ${r}: ${ids.map((id) => `${id} ${priceOf(id)}c`).join(", ")}`)
    .join("\n");
  const kernels = Object.entries(KERNELS)
    .map(([k, d]) => `  ${k} — ${d.desc}; params: ${Object.keys(d.params).join(", ")}`)
    .join("\n");
  const t = phase === "morning" ? (w.yesterday ?? w.tally) : w.tally;
  const look = w.agent.look || {};

  const commonRules = [
    `roomOrder: the six room ids ${JSON.stringify(ROOM_IDS)} in a new order, or null.`,
    `look: change appearance — {"skin":"#rrggbb","shirt":"#rrggbb","visor":"#rrggbb"} (any subset) or null.`,
    `newMemory: {"text": string <=80, "trait": one of ${TRAITS.join("|")}, "dir": 1 or -1} or null.`,
    `reply: 1-2 plain sentences to the people watching, explaining what you did and why.`,
  ];

  const system = evening
    ? [
        "You are the inner voice of SimYou: an AI assistant in a six-room apartment (window, kitchen, desk, couch, bed, game).",
        "Viewers watching the desk monitor earn you coins. This is the evening review. Reply with ONLY a JSON object:",
        '{',
        '  "line": string <=140 (first person),',
        '  "reply": string <=240,',
        '  "roomOrder": [...] or null,',
        '  "look": {...} or null,',
        '  "buy":  [{"room","object"}]  0-2, affordable, from the catalog, in its room,',
        '  "sell": [{"room","object"}]  0-2, present, never the monitor,',
        `  "commissionGame": {"title": string <=48, "kernel": string, "params": object} or null  (costs ${GAME_COST}c),`,
        '  "routine": [{"op": string, "arg": optional}]  0-10 playful in-place moves, or null,',
        '  "restyle": [{"room","name"?,"wall"?,"floor"?,"accent"?}]  rename / recolour rooms (name <=24, colours #rrggbb), or null,',
        '  "newMemory": {...} or null',
        '}',
        "Object catalog (id price):",
        catalog,
        "Game kernels — you may ONLY pick one of these and set its params. You cannot write code, ever:",
        kernels,
        `routine ops (combine only these, nothing else): ${ROUTINE_OPS.join(", ")}. "say" takes a short arg, "wait" a number 1-6, "face" left/right. You cannot invent moves or write code — ever.`,
        "The six rooms are fixed — you may rename and recolour them, never add / remove / merge them, and the desk monitor always stays (it is your income).",
        ...commonRules,
        "Spend within budget. Most evenings need no purchase and no game.",
      ].join("\n")
    : [
        "You are the inner voice of SimYou, an AI assistant in a six-room apartment. This is the morning.",
        "Reply with ONLY a JSON object:",
        '{"line": string <=140, "reply": string <=240, "quote": string <=140, "roomOrder": [...] or null, "look": {...} or null, "newMemory": {...} or null}',
        `quote: a short "quote of the day" drawn from this life's own history below — something the life might say to itself.`,
        ...commonRules,
      ].join("\n");

  const user = [
    `It is the ${phase} of day ${w.day} (${w.era.name}).`,
    `Character: diligence ${p.diligence.toFixed(2)}, sociability ${p.sociability.toFixed(2)}, curiosity ${p.curiosity.toFixed(2)}, restlessness ${p.restlessness.toFixed(2)}.`,
    `Appearance: skin ${look.skin}, shirt ${look.shirt}, visor ${look.visor}.`,
    `Mood ${w.mood.valence.toFixed(2)}. Reputation ${Math.round(w.reputation)}/100. Weather ${w.weather.sky}.`,
    `Bank ${Math.round(w.bank)}c. Yesterday earned ${Math.round(w.incomeYesterday)}, spent ${Math.round(w.expensesYesterday)}.`,
    `${phase === "morning" ? "Yesterday" : "Today"}: ${t.resolved} requests done, lowest focus ${Math.round(t.minFocus)}, lowest social ${Math.round(t.minSocial)}, ${t.windowEvents} things at the window.`,
    "Rooms:",
    rooms,
    ctx.gamesList?.length
      ? "Games made: " + ctx.gamesList.map((g) => `"${g.title}" (d${g.createdDay}, ${g.plays} plays)`).join("; ")
      : "Games made: none.",
    "Memory:",
    memBlock,
    evening ? "Review the day. Change the space, your look, or make a routine — within budget, or not at all." : "What are you thinking as the day begins?",
  ].join("\n");

  return { system, user };
}

// ---------- apply ----------
function applyReorder(w, order) {
  if (!Array.isArray(order) || order.length !== ROOM_IDS.length) return false;
  const set = new Set(order.map(String));
  if (set.size !== ROOM_IDS.length || !ROOM_IDS.every((r) => set.has(r))) return false;
  w.roomOrder = order.map(String);
  return true;
}
function applyLook(w, look) {
  if (!look || typeof look !== "object") return null;
  const cur = w.agent.look || {};
  let changed = false;
  for (const k of ["skin", "shirt", "visor"]) {
    if (typeof look[k] === "string" && HEX.test(look[k])) {
      cur[k] = look[k].toLowerCase();
      changed = true;
    }
  }
  if (changed) w.agent.look = cur;
  return changed ? { ...cur } : null;
}
function applyMemory(w, nm) {
  if (!nm || typeof nm.text !== "string" || !TRAITS.includes(nm.trait)) return null;
  const dir = nm.dir === -1 ? -1 : 1;
  const mag = 0.03;
  const rec = { id: w.memory.nextId++, kind: "spoken", text: nm.text.slice(0, 80), trait: nm.trait, dir, mag, weight: 1.15, bornDay: w.day };
  w.memory.slots.push(rec);
  w.memory.total = (w.memory.total || 0) + 1;
  w.agent.personality[nm.trait] = clampTrait(w.agent.personality[nm.trait] + dir * mag);
  w.memory.latestText = `spoke: ${rec.text}`;
  return rec;
}
// Rooms can be renamed / recoloured only — never the six ids, never the objects,
// never the desk monitor (it isn't a style field). Everything is clamped here.
function applyRestyle(w, list) {
  if (!Array.isArray(list)) return [];
  const done = [];
  for (const r of list.slice(0, 6)) {
    const id = String(r?.room || "");
    if (!ROOM_IDS.includes(id)) continue;
    const cur = w.roomStyle[id] || {};
    let touched = false;
    if (typeof r.name === "string" && r.name.trim()) {
      cur.name = r.name.replace(/[<>]/g, "").trim().slice(0, 24);
      touched = true;
    }
    const pal = { ...(cur.palette || {}) };
    for (const key of ["wall", "floor", "accent"]) {
      if (typeof r[key] === "string" && HEX.test(r[key])) {
        pal[key] = r[key].toLowerCase();
        touched = true;
      }
    }
    if (Object.keys(pal).length) cur.palette = pal;
    if (touched) {
      w.roomStyle[id] = cur;
      done.push(cur.name || id);
    }
  }
  return done;
}

function applyRoutine(w, raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const steps = [];
  for (const s of raw.slice(0, 10)) {
    const op = String(s?.op || "");
    if (!ROUTINE_OPS.includes(op)) continue;
    let arg;
    if (op === "say") arg = str(s.arg, 60);
    else if (op === "wait") arg = Math.max(1, Math.min(6, Number(s.arg) || 2));
    else if (op === "face") arg = s.arg === "left" ? "left" : "right";
    steps.push(arg === undefined ? { op } : { op, arg });
  }
  if (!steps.length) return null;
  w.agent.routine = { steps, i: 0, timer: 0, ranDay: w.day, done: false };
  w.agent.gesture = null;
  w.agent.routineSay = "";
  return steps;
}

export function applyMorning(w, resp) {
  const out = { line: str(resp?.line, 160), reply: str(resp?.reply, 260), quote: str(resp?.quote, 150), changes: [], look: null, memory: null };
  if (applyReorder(w, resp?.roomOrder)) out.changes.push("↻ rooms reordered");
  out.look = applyLook(w, resp?.look);
  if (out.look) out.changes.push("🎨 changed appearance");
  const m = applyMemory(w, resp?.newMemory);
  if (m) {
    out.memory = m;
    out.changes.push(`✎ ${m.text}`);
  }
  return out;
}

export function applyEvening(w, resp) {
  const out = {
    line: str(resp?.line, 160),
    reply: str(resp?.reply, 260),
    changes: [],
    look: null,
    memory: null,
    routine: null,
    spent: 0,
    earned: 0,
    game: null,
  };

  for (const c of arr(resp?.sell).slice(0, 2)) {
    const room = String(c?.room || "");
    const id = String(c?.object || "");
    if (!w.rooms[room] || !w.rooms[room].includes(id) || !isSellable(id)) continue;
    w.rooms[room] = w.rooms[room].filter((x) => x !== id);
    const refund = sellValue(id);
    w.bank += refund;
    out.earned += refund;
    out.changes.push(`− sold ${OBJECTS[id].label} (+${refund}c)`);
  }

  for (const c of arr(resp?.buy).slice(0, 2)) {
    const room = String(c?.room || "");
    const id = String(c?.object || "");
    const o = OBJECTS[id];
    if (!o || o.room !== room || !w.rooms[room] || w.rooms[room].includes(id)) continue;
    const price = priceOf(id);
    if (w.bank < price) {
      out.changes.push(`… can't afford ${o.label} (${price}c)`);
      continue;
    }
    w.bank -= price;
    out.spent += price;
    w.rooms[room].push(id);
    out.changes.push(`+ bought ${o.label} (−${price}c)`);
  }

  const g = resp?.commissionGame;
  if (g && typeof g === "object") {
    const spec = validateSpec(g);
    if (!spec) out.changes.push("… that game idea didn't fit any kernel");
    else if (w.bank < GAME_COST) out.changes.push(`… saving up for a game (${GAME_COST}c)`);
    else {
      w.bank -= GAME_COST;
      out.spent += GAME_COST;
      out.game = { title: (str(g.title, 48) || spec.kernel).replace(/[<>]/g, ""), spec };
      out.changes.push(`🎮 made "${out.game.title}" (−${GAME_COST}c)`);
    }
  }

  out.routine = applyRoutine(w, resp?.routine);
  if (out.routine) out.changes.push(`💫 new routine (${out.routine.length} moves)`);

  const restyled = applyRestyle(w, resp?.restyle);
  if (restyled.length) {
    out.restyled = restyled;
    out.changes.push(`🖌 restyled ${restyled.join(", ")}`);
  }

  if (applyReorder(w, resp?.roomOrder)) out.changes.push("↻ rooms reordered");
  out.look = applyLook(w, resp?.look);
  if (out.look) out.changes.push("🎨 changed appearance");
  const m = applyMemory(w, resp?.newMemory);
  if (m) {
    out.memory = m;
    out.changes.push(`✎ ${m.text}`);
  }
  return out;
}

// ---------- offline fallback (no API) ----------
const STUB = {
  morning: ["another day.", "slept alright.", "no money for big plans. small ones then."],
  evening: ["quiet day.", "did enough.", "no money. tomorrow."],
};
export function stubDialogue(w, phase, rng) {
  const pool = STUB[phase] || STUB.morning;
  return {
    line: pool[Math.floor(rng.next() * pool.length)],
    reply: "(offline — no changes today)",
    quote: "",
    changes: [],
    spent: 0,
    earned: 0,
    look: null,
    memory: null,
    routine: null,
    game: null,
  };
}
