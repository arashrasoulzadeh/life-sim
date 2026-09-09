// Things wear out. Every object holds a condition 0..100 that drifts down over
// time — faster for appliances and anything with moving parts. A worn object
// gives less of its comfort; a broken one gives nothing until it's fixed or
// replaced. The AI repairs from the evening review.

import { OBJECTS } from "./objects.js";

const DECAY_PER_DAY = 1.1; // baseline condition lost per in-game day
const APPLIANCE_MULT = 2.0;
const BROKEN_AT = 22;
const WORN_AT = 55;

function decayRate(id) {
  const o = OBJECTS[id];
  if (!o) return DECAY_PER_DAY;
  return DECAY_PER_DAY * (o.cat === "appliance" ? APPLIANCE_MULT : o.cat === "games" ? 1.4 : 1);
}

export function ensureWear(w) {
  w.wear = w.wear || {};
  const seen = new Set();
  for (const [room, ids] of Object.entries(w.rooms || {})) {
    for (const id of ids) {
      const key = `${room}:${id}`;
      seen.add(key);
      if (w.wear[key] == null) w.wear[key] = 100;
    }
  }
  for (const k of Object.keys(w.wear)) if (!seen.has(k)) delete w.wear[k];
}

export function tickWear(w, simSeconds, dayLength) {
  ensureWear(w);
  for (const key of Object.keys(w.wear)) {
    const id = key.split(":")[1];
    w.wear[key] = Math.max(0, w.wear[key] - (decayRate(id) * simSeconds) / dayLength);
  }
}

// how much of an object's effect still lands, given its condition
export function conditionFactor(w, room, id) {
  const c = w.wear?.[`${room}:${id}`];
  if (c == null) return 1;
  if (c < BROKEN_AT) return 0;
  if (c < WORN_AT) return 0.35 + (0.65 * (c - BROKEN_AT)) / (WORN_AT - BROKEN_AT);
  return 1;
}

export function isBroken(w, room, id) {
  const c = w.wear?.[`${room}:${id}`];
  return c != null && c < BROKEN_AT;
}

// the most-broken thing in a room the agent is standing in (for a "fix it" beat)
export function brokenInRoom(w, room) {
  let worst = null;
  let worstC = BROKEN_AT;
  for (const id of w.rooms?.[room] || []) {
    const c = w.wear?.[`${room}:${id}`];
    if (c != null && c < worstC) {
      worst = id;
      worstC = c;
    }
  }
  return worst;
}

// cost to repair now — cheaper than replacing, scales with how bad it is
export function repairCost(w, room, id) {
  const o = OBJECTS[id];
  if (!o) return 0;
  const c = w.wear?.[`${room}:${id}`] ?? 100;
  return Math.max(5, Math.round(o.price * 0.18 * (1 + (100 - c) / 100)));
}

export function repair(w, room, id) {
  const key = `${room}:${id}`;
  if (w.wear?.[key] == null) return null;
  w.wear[key] = 100;
  return OBJECTS[id]?.label || id;
}

// hands-on fix while the agent is in the room (small, automatic)
export function tinkerFix(w, room, amount = 30) {
  const id = brokenInRoom(w, room);
  if (!id) return null;
  w.wear[`${room}:${id}`] = Math.min(100, (w.wear[`${room}:${id}`] || 0) + amount);
  return OBJECTS[id]?.label || id;
}

// map-based (for the pure room renderer): pass the w.wear object directly
export function wearGlyph(wearMap, room, id, base) {
  const c = wearMap && wearMap[`${room}:${id}`];
  return c != null && c < BROKEN_AT ? "🩹" : base;
}
export function wearPct(wearMap, room, id) {
  const c = wearMap && wearMap[`${room}:${id}`];
  return c == null ? null : Math.round(c);
}
