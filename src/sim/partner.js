// The spouse. Runs the same utility loop as the primary but without the job
// (no requests to resolve) and with a stronger pull toward the other's room.
// Shares the bank, the cat, the home. No separate LLM voice — the primary's
// dialogue speaks for the household ("we").

import { makeAgent, stepAgent, stepRoutine } from "./agent.js";
import { decayNeeds } from "./needs.js";
import { water as waterPlant, thirstyIn } from "./plants.js";

export function makePartner(rng, person) {
  const a = makeAgent(rng, { name: person.name, gender: person.gender, look: person.look, offset: 34 });
  a.room = "couch";
  return a;
}

const noop = () => {};

export function stepPartner(w, dt, rng) {
  const p = w.partner;
  if (!p) return;

  decayNeeds(p.needs, p.personality, dt, w.isNight, w.era.decayMul || 1);

  // a small idle routine can still play out
  if (!w.isNight && stepRoutine(p, dt)) return;

  let thirstyRoom = null;
  if (!w.isNight) {
    for (const r of Object.keys(w.rooms)) if (thirstyIn(w, r)) { thirstyRoom = r; break; }
  }

  // how much it wants company right now — low togetherness pulls harder
  const togetherWant = Math.max(0, (55 - (w.togetherness ?? 50)) / 40);

  stepAgent(
    p,
    dt,
    {
      isNight: w.isNight,
      requestsWaiting: 0,
      wantsReflect: false,
      thirstyRoom,
      speedMul: w.era.speedMul ?? 1,
      rhythm: { work: 0.15, play: 1.25 }, // not the one with the job
      voteBias: null,
      partnerRoom: w.agent.room,
      togetherWant,
      onWater: (room) => {
        if (waterPlant(w, room)) w.fx.push("event");
      },
      onTinker: noop,
      onRequestResolved: noop,
      onReflect: noop,
    },
    rng,
  );
}

// call each tick after both have moved: track how close they are
export function stepTogetherness(w, dt) {
  if (!w.partner) return;
  const a = w.agent;
  const b = w.partner;
  const settled = a.transit <= 0 && b.transit <= 0;
  const same = settled && a.room === b.room;
  const near = same && Math.hypot(a.x - b.x, a.y - b.y) < 95;

  // being close builds warmth fast; drifting apart costs it slowly. Nights at
  // home together always add a little, and it drifts toward a settled ~78.
  let rate = near ? 4 : same ? 2 : -0.9;
  if (w.isNight) rate = Math.max(rate, 0.6);
  let tg = w.togetherness ?? 50;
  tg += rate * dt;
  tg += (80 - tg) * 0.02 * dt; // married-couple equilibrium — it breathes around here
  w.togetherness = Math.max(0, Math.min(100, tg));

  // being together lifts the household mood; drifting apart for long dims it
  const bias = near ? 0.03 : w.togetherness < 25 ? -0.02 : 0;
  if (bias) w.mood.valence = Math.max(-1, Math.min(1, w.mood.valence + bias * dt));

  // a shared beat now and then when they're close
  if (near && !w._togetherFxAt) w._togetherFxAt = 0;
  if (near) {
    w._togetherFxAt += dt;
    if (w._togetherFxAt > 30) {
      w._togetherFxAt = 0;
      w.fx.push("memory");
      a.lastThought = pick(w.rng, TOGETHER_LINES);
    }
  } else {
    w._togetherFxAt = 0;
  }
}

const TOGETHER_LINES = [
  "nice, just being in the same room",
  "we don't have to talk",
  "coffee's still warm",
  "caught them humming",
  "this is the good part of the day",
];
function pick(rng, arr) {
  return arr[Math.floor((rng ? rng.next() : Math.random()) * arr.length)];
}
