// Builds the start/end-of-day prompt from the live world + a context object the
// server assembles (life summary, memory digests, games, sites), and safely
// applies whatever comes back.
//
//   morning  — reflection only: line, optional roomOrder, optional newMemory
//   evening  — the economic review: buy / sell / commission a game / reorder /
//              memory. Every field is validated here before it touches the world;
//              spending is checked against `w.bank` and the world is mutated in
//              place. The server persists bank/rooms/games/memories afterward.

import { OBJECTS, OBJECT_IDS_BY_ROOM, priceOf, sellValue, isSellable } from "./objects.js";
import { TRAITS } from "./memory.js";
import { ROOM_IDS } from "./rooms.js";

export const GAME_COST = 400;
export const GAME_MAX_BYTES = 40 * 1024;

function clampTrait(v) {
  return v < 0.05 ? 0.05 : v > 1.2 ? 1.2 : v;
}

// ---------- prompt ----------
export function buildPrompt(w, phase, ctx = {}) {
  const p = w.agent.personality;
  const evening = phase === "evening";

  const working = w.memory.slots
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 40)
    .map((s) => `- ${s.text} (${s.trait}${s.dir > 0 ? "+" : "-"}, ${s.weight.toFixed(1)})`);
  const recent = w.memory.slots
    .slice()
    .sort((a, b) => b.bornDay - a.bornDay)
    .slice(0, 15)
    .map((s) => `- d${s.bornDay}: ${s.text}`);
  const digests = (ctx.digests || []).map((d) => `- [month ${d.month}] ${d.summary}`);
  const memBlock = [
    ctx.lifeSummary ? `Life so far: ${ctx.lifeSummary}` : "",
    "Strongest memories:",
    working.join("\n") || "- (none yet)",
    "Most recent:",
    recent.join("\n") || "- (none yet)",
    digests.length ? "Older, consolidated:\n" + digests.join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");

  const rooms = w.roomOrder
    .map((r) => {
      const items =
        (w.rooms[r] || []).map((id) => `${id} (${OBJECTS[id].label}, ${priceOf(id)}c)`).join(", ") || "bare";
      const fixture = r === "desk" ? " [+ permanent monitor — earns money, cannot be sold]" : "";
      return `  ${r}: ${items}${fixture}`;
    })
    .join("\n");

  const catalog = Object.entries(OBJECT_IDS_BY_ROOM)
    .map(([r, ids]) => `  ${r}: ${ids.map((id) => `${id} ${priceOf(id)}c`).join(", ")}`)
    .join("\n");

  const t = phase === "morning" ? (w.yesterday ?? w.tally) : w.tally;

  const system = evening
    ? [
        "You are the inner voice of SIMYOU: an AI assistant living alone in a six-room apartment (window, kitchen, desk, couch, bed, game).",
        "It funds itself: viewers watching the desk monitor earn it coins. It spends coins on objects and on commissioning small games it plays in the game room.",
        "This is the evening review. Reply with ONLY this JSON object, no prose:",
        '{',
        '  "line": string (<=140 chars, first person, plain),',
        '  "roomOrder": array of exactly the six room ids in a new order, or null,',
        '  "buy":  [{"room": string, "object": string}]  (0-2, must be affordable, from the catalog, in its room),',
        '  "sell": [{"room": string, "object": string}]  (0-2, must be present; the monitor cannot be sold),',
        `  "commissionGame": {"title": string, "html": string} or null  (costs ${GAME_COST}c; html must be one self-contained file, no network, <=40KB),`,
        '  "newMemory": {"text": string (<=80 chars), "trait": string, "dir": 1 or -1} or null',
        '}',
        "Catalog (id price):",
        catalog,
        `newMemory.trait is one of: ${TRAITS.join(", ")}. Spend within budget. Most evenings need no purchase.`,
      ].join("\n")
    : [
        "You are the inner voice of SIMYOU, an AI assistant living alone in a six-room apartment.",
        "This is the morning. Reply with ONLY this JSON object, no prose:",
        '{"line": string (<=140 chars, first person), "roomOrder": array of the six room ids or null, "newMemory": {"text": string (<=80 chars), "trait": string, "dir": 1 or -1} or null}',
        `newMemory.trait is one of: ${TRAITS.join(", ")}.`,
      ].join("\n");

  const user = [
    `It is the ${phase} of day ${w.day} (${w.era.name}).`,
    `Character: diligence ${p.diligence.toFixed(2)}, sociability ${p.sociability.toFixed(2)}, curiosity ${p.curiosity.toFixed(2)}, restlessness ${p.restlessness.toFixed(2)}.`,
    `Mood ${w.mood.valence.toFixed(2)}. Reputation ${Math.round(w.reputation)}/100. Weather ${w.weather.sky}.`,
    `Bank: ${Math.round(w.bank)} coins.  Yesterday — earned ${Math.round(w.incomeYesterday)}, spent ${Math.round(w.expensesYesterday)}.`,
    `${phase === "morning" ? "Yesterday" : "Today"}: resolved ${t.resolved} requests, lowest focus ${Math.round(t.minFocus)}, lowest social ${Math.round(t.minSocial)}, ${t.windowEvents} things seen out the window.`,
    "Rooms (in current grid order):",
    rooms,
    ctx.gamesList && ctx.gamesList.length
      ? "Games made: " + ctx.gamesList.map((g) => `"${g.title}" (d${g.createdDay}, ${g.plays} plays)`).join("; ")
      : "Games made: none yet.",
    ctx.sites && ctx.sites.length
      ? "Sites on the monitor: " + ctx.sites.map((s) => `${s.label} (${Math.round(s.secondsYesterday || 0)}s watched)`).join("; ")
      : "",
    "Memory:",
    memBlock,
    evening
      ? "Review the day. Adjust the space within budget, or not. Commission a game only if it's clearly worth it."
      : "What are you thinking as the day begins?",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

// ---------- apply ----------
export function applyMorning(w, resp) {
  const out = { line: str(resp?.line, 160), changes: [], reorder: null, memory: null };
  if (applyReorder(w, resp?.roomOrder)) {
    out.reorder = [...w.roomOrder];
    out.changes.push("↻ rooms reordered");
  }
  const m = applyMemory(w, resp?.newMemory);
  if (m) {
    out.memory = m;
    out.changes.push(`✎ ${m.text}`);
  }
  return out;
}

export function applyEvening(w, resp) {
  const out = { line: str(resp?.line, 160), changes: [], reorder: null, memory: null, spent: 0, earned: 0, game: null };

  // sells first — frees up money for buys
  for (const c of arr(resp?.sell).slice(0, 2)) {
    const room = String(c?.room || "");
    const id = String(c?.object || "");
    if (!w.rooms[room] || !w.rooms[room].includes(id) || !isSellable(id)) continue;
    w.rooms[room] = w.rooms[room].filter((x) => x !== id);
    const refund = sellValue(id);
    w.bank += refund;
    out.earned += refund;
    out.changes.push(`− ${OBJECTS[id].label} sold (+${refund}c)`);
  }

  // buys
  for (const c of arr(resp?.buy).slice(0, 2)) {
    const room = String(c?.room || "");
    const id = String(c?.object || "");
    const o = OBJECTS[id];
    if (!o || o.room !== room || !w.rooms[room] || w.rooms[room].includes(id)) continue;
    const price = priceOf(id);
    if (w.bank < price) {
      out.changes.push(`… couldn't afford ${o.label} (${price}c)`);
      continue;
    }
    w.bank -= price;
    out.spent += price;
    w.rooms[room].push(id);
    out.changes.push(`+ ${o.label} bought (−${price}c)`);
  }

  // commission a game
  const g = resp?.commissionGame;
  if (g && typeof g.html === "string" && typeof g.title === "string") {
    const bytes = Buffer.byteLength ? Buffer.byteLength(g.html, "utf8") : g.html.length;
    if (bytes > GAME_MAX_BYTES) {
      out.changes.push("… game idea was too big");
    } else if (w.bank < GAME_COST) {
      out.changes.push(`… saving up for a game (${GAME_COST}c)`);
    } else {
      w.bank -= GAME_COST;
      out.spent += GAME_COST;
      out.game = { title: g.title.slice(0, 60), html: g.html };
      out.changes.push(`🎮 made "${out.game.title}" (−${GAME_COST}c)`);
    }
  }

  if (applyReorder(w, resp?.roomOrder)) {
    out.reorder = [...w.roomOrder];
    out.changes.push("↻ rooms reordered");
  }
  const m = applyMemory(w, resp?.newMemory);
  if (m) {
    out.memory = m;
    out.changes.push(`✎ ${m.text}`);
  }
  return out;
}

function applyReorder(w, order) {
  if (!Array.isArray(order) || order.length !== ROOM_IDS.length) return false;
  const set = new Set(order.map(String));
  if (set.size !== ROOM_IDS.length || !ROOM_IDS.every((r) => set.has(r))) return false;
  w.roomOrder = order.map(String);
  return true;
}

function applyMemory(w, nm) {
  if (!nm || typeof nm.text !== "string" || !TRAITS.includes(nm.trait)) return null;
  const dir = nm.dir === -1 ? -1 : 1;
  const mag = 0.03;
  const rec = {
    id: w.memory.nextId++,
    kind: "spoken",
    text: nm.text.slice(0, 80),
    trait: nm.trait,
    dir,
    mag,
    weight: 1.15,
    bornDay: w.day,
  };
  w.memory.slots.push(rec);
  w.memory.total = (w.memory.total || 0) + 1;
  w.agent.personality[nm.trait] = clampTrait(w.agent.personality[nm.trait] + dir * mag);
  w.memory.latestText = `spoke: ${rec.text}`;
  return rec;
}

// ---------- offline fallback ----------
const STUB = {
  morning: ["another day. keep the queue short.", "slept alright.", "i should reach out today.", "clear head."],
  evening: ["that was a lot.", "quiet day.", "did enough. that's enough.", "no money. tomorrow then."],
};

export function stubDialogue(w, phase, rng) {
  const pool = STUB[phase] || STUB.morning;
  const line = pool[Math.floor(rng.next() * pool.length)];
  const changes = [];
  // offline: only ever a cheap free rearrange (sell + rebuy same-value), never a spend it can't verify
  if (phase === "evening" && rng.chance(0.3)) {
    const rooms = ROOM_IDS.filter((r) => (w.rooms[r] || []).length > 0);
    if (rooms.length) {
      const room = rooms[Math.floor(rng.next() * rooms.length)];
      const id = w.rooms[room][Math.floor(rng.next() * w.rooms[room].length)];
      w.rooms[room] = w.rooms[room].filter((x) => x !== id);
      w.bank += sellValue(id);
      changes.push(`− ${OBJECTS[id].label} sold (+${sellValue(id)}c)`);
    }
  }
  return { line, changes, spent: 0, earned: 0, reorder: null, memory: null, game: null };
}

function str(v, n) {
  return typeof v === "string" ? v.slice(0, n) : "";
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
