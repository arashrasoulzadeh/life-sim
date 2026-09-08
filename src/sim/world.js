import { Rng } from "../engine/rng.js";
import { makeAgent, stepAgent } from "./agent.js";
import { decayNeeds } from "./needs.js";

export const DAY_LENGTH = 600; // real seconds per in-game day
const NIGHT_FROM = 0.66; // fraction of the day when night begins

export function createWorld(seed) {
  const rng = new Rng(seed);
  return {
    rng,
    seed,
    agent: makeAgent(rng),
    t: 0,
    day: 1,
    dayFrac: 0,
    isNight: false,
    requests: 0,
    tokens: 0,
    reputation: 50,
    nextRequestIn: rng.range(8, 20),
    ticks: 0,
  };
}

export function tick(w, dt) {
  w.ticks++;
  w.t += dt;

  const prevDay = w.day;
  w.day = 1 + Math.floor(w.t / DAY_LENGTH);
  w.dayFrac = (w.t % DAY_LENGTH) / DAY_LENGTH;
  w.isNight = w.dayFrac >= NIGHT_FROM || w.dayFrac < 0.04;

  // requests arrive on their own; a poor reputation slows the stream
  w.nextRequestIn -= dt;
  if (w.nextRequestIn <= 0) {
    const load = 0.5 + w.reputation / 100; // busier when well-regarded
    w.nextRequestIn = w.rng.range(10, 26) / load;
    if (!w.isNight || w.rng.chance(0.3)) w.requests = Math.min(9, w.requests + 1);
  }

  // a backed-up queue erodes reputation; a light queue slowly restores it
  if (w.requests >= 5) w.reputation = clamp100(w.reputation - 0.22 * dt);
  else if (w.requests <= 1) w.reputation = clamp100(w.reputation + 0.35 * dt);

  decayNeeds(w.agent.needs, w.agent.personality, dt, w.isNight);

  stepAgent(w.agent, dt, w.isNight, w.requests, w.rng, () => {
    w.requests = Math.max(0, w.requests - 1);
    w.tokens += 3 + Math.round(w.rng.range(0, 4));
    w.reputation = clamp100(w.reputation + 1.5);
  });

  if (w.day !== prevDay) onNewDay(w);
}

function onNewDay(_w) {
  // reserved for milestone 4 (memory writing) and eras
}

function clamp100(v) {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}
