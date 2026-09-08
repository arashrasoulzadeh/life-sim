// Builds the start/end-of-day prompt from the live world, and safely applies
// whatever comes back. The model can only touch things through this file:
// toggle whitelisted room objects (max 2) and optionally add one memory.

import { OBJECTS, OBJECT_IDS_BY_ROOM } from "./objects.js";
import { TRAITS, MEMORY_SLOTS } from "./memory.js";

export function buildPrompt(w, phase) {
  const p = w.agent.personality;
  const mems =
    w.memory.slots
      .map((s) => `- ${s.text} (${s.trait}${s.dir > 0 ? "+" : "-"}, strength ${s.weight.toFixed(1)})`)
      .join("\n") || "- (none yet)";
  const rooms = Object.entries(w.rooms)
    .map(([r, list]) => `  ${r}: ${list.map((id) => OBJECTS[id].label).join(", ") || "(bare)"}`)
    .join("\n");
  const catalog = Object.entries(OBJECT_IDS_BY_ROOM)
    .map(([r, ids]) => `  ${r}: ${ids.join(", ")}`)
    .join("\n");
  const t = phase === "morning" ? w.yesterday ?? w.tally : w.tally;

  const system = [
    "You are the inner voice of SIMYOU: an AI assistant living alone in a small apartment of five rooms (window, kitchen, desk, couch, bed).",
    "Twice a day it stops to think and, sometimes, to change its space.",
    "Reply with ONLY a JSON object, no prose, shaped exactly:",
    '{"line": string (<=140 chars, first person, plain), "roomChanges": [{"op":"add"|"remove","room":string,"object":string}], "newMemory": {"text": string (<=80 chars), "trait": string, "dir": 1 or -1} or null}',
    "roomChanges: 0 to 2 items. Only use object ids from this catalog, and only in their listed room:",
    catalog,
    `newMemory.trait must be one of: ${TRAITS.join(", ")}. dir 1 = the day pushed the agent toward that trait, -1 = away.`,
    "Keep changes small and clearly motivated by how the day actually went. Most days need no change at all.",
  ].join("\n");

  const user = [
    `It is the ${phase} of day ${w.day} (${w.era.name}).`,
    `Character: diligence ${p.diligence.toFixed(2)}, sociability ${p.sociability.toFixed(2)}, curiosity ${p.curiosity.toFixed(2)}, restlessness ${p.restlessness.toFixed(2)}.`,
    `Mood ${w.mood.valence.toFixed(2)} (0 low, 1 bright). Reputation ${Math.round(w.reputation)}/100. Tokens ${w.tokens}. Weather: ${w.weather.sky}.`,
    `${phase === "morning" ? "Yesterday" : "Today so far"}: resolved ${t.resolved} requests, lowest focus ${Math.round(t.minFocus)}, lowest social ${Math.round(t.minSocial)}, ${t.windowEvents} things seen out the window.`,
    "Current rooms:",
    rooms,
    "Memories held:",
    mems,
    phase === "morning"
      ? "What are you thinking as the day begins? Does the space need anything to face it?"
      : "Reflect on the day. What did it teach you, and should anything in the apartment change?",
  ].join("\n");

  return { system, user };
}

function clampTrait(v) {
  return v < 0.05 ? 0.05 : v > 1.2 ? 1.2 : v;
}

export function applyDialogue(w, resp) {
  const changes = [];
  if (resp && Array.isArray(resp.roomChanges)) {
    for (const c of resp.roomChanges.slice(0, 2)) {
      if (!c || (c.op !== "add" && c.op !== "remove")) continue;
      const room = String(c.room || "");
      const obj = String(c.object || "");
      const o = OBJECTS[obj];
      if (!w.rooms[room] || !o || o.room !== room) continue;
      const has = w.rooms[room].includes(obj);
      if (c.op === "add" && !has) {
        w.rooms[room].push(obj);
        changes.push(`+ ${o.label} → ${room}`);
      } else if (c.op === "remove" && has) {
        w.rooms[room] = w.rooms[room].filter((x) => x !== obj);
        changes.push(`− ${o.label} ✗ ${room}`);
      }
    }
  }

  const line = resp && typeof resp.line === "string" ? resp.line.slice(0, 160) : "";

  const nm = resp && resp.newMemory;
  if (nm && typeof nm.text === "string" && TRAITS.includes(nm.trait)) {
    const dir = nm.dir === -1 ? -1 : 1;
    const mag = 0.03;
    w.memory.slots.push({
      id: w.memory.nextId++,
      kind: "spoken",
      text: nm.text.slice(0, 80),
      trait: nm.trait,
      dir,
      mag,
      weight: 1.15,
      bornDay: w.day,
    });
    w.agent.personality[nm.trait] = clampTrait(w.agent.personality[nm.trait] + dir * mag);
    while (w.memory.slots.length > MEMORY_SLOTS) {
      let faint = 0;
      for (let i = 1; i < w.memory.slots.length; i++) {
        if (w.memory.slots[i].weight < w.memory.slots[faint].weight) faint = i;
      }
      const dropped = w.memory.slots.splice(faint, 1)[0];
      w.agent.personality[dropped.trait] = clampTrait(
        w.agent.personality[dropped.trait] - dropped.dir * dropped.mag * 0.5,
      );
    }
    w.memory.latestText = `spoke: ${nm.text.slice(0, 60)}`;
  }

  return { line, changes };
}

// Offline fallback so the feature is visible without an API key.
const STUB_LINES = {
  morning: [
    "another day. keep the queue short.",
    "slept alright. the window looked grey.",
    "i should reach out to someone today.",
    "clear head. let's use it.",
  ],
  evening: [
    "that was a lot. the desk is a mess.",
    "quiet day. maybe too quiet.",
    "i keep forgetting to look outside.",
    "did enough. that's enough.",
  ],
};

export function stubDialogue(w, phase, rng) {
  const pool = STUB_LINES[phase] ?? STUB_LINES.morning;
  const line = pool[Math.floor(rng.next() * pool.length)];
  const changes = [];
  if (rng.chance(0.45)) {
    const rooms = Object.keys(OBJECT_IDS_BY_ROOM);
    const room = rooms[Math.floor(rng.next() * rooms.length)];
    const ids = OBJECT_IDS_BY_ROOM[room];
    const obj = ids[Math.floor(rng.next() * ids.length)];
    if (w.rooms[room].includes(obj)) {
      w.rooms[room] = w.rooms[room].filter((x) => x !== obj);
      changes.push(`− ${OBJECTS[obj].label} ✗ ${room}`);
    } else {
      w.rooms[room].push(obj);
      changes.push(`+ ${OBJECTS[obj].label} → ${room}`);
    }
  }
  return { line, changes };
}
