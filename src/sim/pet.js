// A cat. It runs its own tiny utility loop — wander, nap, follow the human,
// sleep at night — with no bearing on the sim's economy. The AI may name it,
// and small moments (a note left, a plant watered) raise its bond.

import { ROOMS, ROOM_IDS } from "./rooms.js";

const PET_SPEED = 30; // px/s — unhurried
const ROAM_ROOMS = ROOM_IDS.filter((r) => r !== "game");

function spotIn(room, rng) {
  const s = ROOMS[room].spot;
  return { x: s.x + rng.range(-40, 40), y: s.y + rng.range(-6, 18) };
}

export function freshPet(rng) {
  const s = spotIn("couch", rng);
  return {
    kind: "cat",
    name: "",
    room: "couch",
    x: s.x,
    y: s.y,
    tx: s.x,
    ty: s.y,
    facing: 1,
    state: "roam", // roam | nap | follow | sleep | play
    timer: rng.range(3, 8),
    bond: 0.3, // 0..1 — grows with shared moments
    namedDay: 0,
  };
}

export function ensurePet(w, rng) {
  if (!w.pet) w.pet = freshPet(rng);
  return w.pet;
}

export function stepPet(w, dt, rng) {
  const p = ensurePet(w, rng);

  // glide toward target
  const dx = p.tx - p.x;
  const dy = p.ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d > 1.2) {
    const step = Math.min(d, PET_SPEED * dt);
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
    p.facing = dx < 0 ? -1 : 1;
    return;
  }

  p.timer -= dt;
  if (p.timer > 0) return;

  const agent = w.agent;
  const roll = rng.next();

  if (w.isNight) {
    p.state = "sleep";
    p.room = rng.chance(0.6) ? "bed" : "couch";
    p.timer = rng.range(24, 46);
  } else if (roll < 0.34 && agent && agent.room !== p.room && agent.transit <= 0) {
    // pad after the human
    p.state = "follow";
    p.room = agent.room;
    p.timer = rng.range(7, 15);
    p.bond = Math.min(1, p.bond + 0.01);
  } else if (roll < 0.58) {
    p.state = "nap";
    p.timer = rng.range(14, 30);
  } else if (roll < 0.7 && agent && agent.room === p.room) {
    p.state = "play";
    p.timer = rng.range(3, 7);
    p.bond = Math.min(1, p.bond + 0.015);
  } else {
    p.state = "roam";
    p.room = rng.pick(ROAM_ROOMS);
    p.timer = rng.range(5, 12);
  }

  const s = spotIn(p.room, rng);
  p.tx = s.x;
  p.ty = s.y;
}

// a shared moment with the human
export function petBond(w, amount = 0.03) {
  if (w.pet) w.pet.bond = Math.min(1, w.pet.bond + amount);
}

export function namePet(w, raw) {
  if (typeof raw !== "string") return null;
  const n = raw.replace(/[<>\n\r]/g, "").trim().slice(0, 16);
  if (n.length < 1 || !w.pet) return null;
  const first = !w.pet.name;
  w.pet.name = n;
  w.pet.namedDay = w.day;
  return first ? n : null; // only announce the first naming
}

export function petGlyph(p) {
  if (!p) return "🐈";
  if (p.state === "sleep" || p.state === "nap") return "😽";
  if (p.state === "play") return "🐈";
  return "🐈";
}

export function petLabel(p) {
  if (!p) return "a cat";
  return p.name ? p.name : "the cat";
}
