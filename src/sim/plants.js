// Living objects (plants, terrariums, aquariums…) hold water that drops over
// time. Neglected they wilt, then die. The agent tends them when it's near one.

import { OBJECTS } from "./objects.js";

const LIVING = /plant|succulent|terrarium|aquarium|flower|garden|bonsai|herb/i;
const DRY_PER_DAY = 22; // water units lost per in-game day

export function isLiving(id) {
  const o = OBJECTS[id];
  return !!o && LIVING.test(o.label);
}

export function ensurePlants(w) {
  w.plants = w.plants || {};
  const seen = new Set();
  for (const [room, ids] of Object.entries(w.rooms)) {
    for (const id of ids) {
      if (!isLiving(id)) continue;
      const key = `${room}:${id}`;
      seen.add(key);
      if (!w.plants[key]) w.plants[key] = { water: 80, since: w.day, dryDays: 0 };
    }
  }
  for (const key of Object.keys(w.plants)) if (!seen.has(key)) delete w.plants[key];
}

// dt is real seconds; simDays is dt * BASE_RATE / DAY_LENGTH-worth handled by caller.
export function tickPlants(w, simSeconds, dayLength) {
  ensurePlants(w);
  const drop = (DRY_PER_DAY * simSeconds) / dayLength;
  const dead = [];
  for (const [key, p] of Object.entries(w.plants)) {
    p.water = Math.max(0, p.water - drop);
  }
  return dead;
}

// call on new day: advance dry-streaks, return keys of plants that died
export function plantsNewDay(w) {
  ensurePlants(w);
  const dead = [];
  for (const [key, p] of Object.entries(w.plants)) {
    if (p.water < 8) {
      p.dryDays = (p.dryDays || 0) + 1;
      if (p.dryDays >= 2) dead.push(key);
    } else {
      p.dryDays = 0;
    }
  }
  for (const key of dead) {
    const [room, id] = key.split(":");
    if (w.rooms[room]) w.rooms[room] = w.rooms[room].filter((x) => x !== id);
    delete w.plants[key];
  }
  return dead;
}

// is there a thirsty plant in this room?
export function thirstyIn(w, room) {
  for (const id of w.rooms[room] || []) {
    const p = w.plants && w.plants[`${room}:${id}`];
    if (p && p.water < 45) return id;
  }
  return null;
}

export function water(w, room) {
  let did = null;
  for (const id of w.rooms[room] || []) {
    const p = w.plants && w.plants[`${room}:${id}`];
    if (p && p.water < 95) {
      p.water = 100;
      p.dryDays = 0;
      did = OBJECTS[id] ? OBJECTS[id].label : id;
    }
  }
  return did;
}

// glyph override for a wilting / dying plant
export function plantGlyph(plants, room, id, base) {
  const p = plants && plants[`${room}:${id}`];
  if (!p) return base;
  if (p.water < 12) return "🥀";
  if (p.water < 40) return "🥬";
  return base;
}
export function plantWater(plants, room, id) {
  const p = plants && plants[`${room}:${id}`];
  return p ? Math.round(p.water) : null;
}
