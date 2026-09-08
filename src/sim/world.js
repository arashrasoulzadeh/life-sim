import { Rng } from "../engine/rng.js";
import { makeAgent, stepAgent } from "./agent.js";
import { decayNeeds } from "./needs.js";
import { freshMemory, writeMemory, ageMemory } from "./memory.js";
import { freshMood, updateMood } from "./mood.js";
import { freshWeather, stepWeather, weatherCuriosity, rainIntensity } from "./weather.js";
import { eraFor } from "./eras.js";

// Sim-seconds per in-game day. Real time is mapped onto sim time in main.js
// (SIM_RATE), so all the per-second tuning below stays fixed regardless of how
// fast the clock is set to run.
export const DAY_LENGTH = 600;
const NIGHT_FROM = 0.66;

const WINDOW_EVENTS = [
  "a bird on the ledge",
  "someone walking a dog",
  "a plane, very high",
  "a kite",
  "two people arguing",
  "a cat crossing the wall",
];

function freshTally(day) {
  return {
    day,
    resolved: 0,
    minFocus: 100,
    minSocial: 100,
    windowEvents: 0,
    paceCount: 0,
    repSum: 0,
    repSamples: 0,
    repAvg: 50,
  };
}

export function createWorld(seed) {
  const rng = new Rng(seed);
  return {
    rng,
    seed,
    started: false,
    agent: makeAgent(rng),
    memory: freshMemory(),
    mood: freshMood(),
    weather: freshWeather(rng),
    era: eraFor(1),
    t: 0,
    day: 1,
    dayFrac: 0,
    isNight: false,
    requests: 0,
    tokens: 0,
    reputation: 50,
    nextRequestIn: rng.range(8, 20),
    nextWindowEventIn: rng.range(40, 120),
    windowEvent: null,
    tally: freshTally(1),
    fx: [], // event tags drained by the audio layer
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

  const prevEra = w.era;
  w.era = eraFor(w.day);
  if (w.era !== prevEra) w.fx.push("era");

  if (stepWeather(w, dt, w.rng)) {
    /* sky changed — no sound, it's ambient */
  }

  // requests arrive on their own; a poor reputation slows the stream
  w.nextRequestIn -= dt;
  if (w.nextRequestIn <= 0) {
    const load = 0.5 + w.reputation / 100;
    w.nextRequestIn = w.rng.range(10, 26) / load;
    if (!w.isNight || w.rng.chance(0.3)) w.requests = Math.min(9, w.requests + 1);
  }

  // rare things pass by the window
  w.nextWindowEventIn -= dt;
  if (w.windowEvent) {
    w.windowEvent.ttl -= dt;
    if (w.windowEvent.ttl <= 0) w.windowEvent = null;
  }
  if (w.nextWindowEventIn <= 0) {
    w.nextWindowEventIn = w.rng.range(80, 220);
    w.windowEvent = { label: w.rng.pick(WINDOW_EVENTS), ttl: w.rng.range(14, 26) };
    w.tally.windowEvents++;
    w.fx.push("event");
    if (w.agent.room === "window") w.agent.needs.curiosity = Math.min(100, w.agent.needs.curiosity + 18);
  }

  // a backed-up queue erodes reputation; a light queue slowly restores it
  if (w.requests >= 5) w.reputation = clamp100(w.reputation - 0.22 * dt);
  else if (w.requests <= 1) w.reputation = clamp100(w.reputation + 0.35 * dt);

  decayNeeds(w.agent.needs, w.agent.personality, dt, w.isNight, w.era.decayMul);

  // weather pulls on curiosity while the agent is actually at the window
  if (w.agent.room === "window") {
    w.agent.needs.curiosity = clamp100(w.agent.needs.curiosity + weatherCuriosity(w.weather.sky) * dt);
  }

  const wantsReflect =
    w.dayFrac >= 0.42 && w.dayFrac < 0.72 && w.memory.lastWrittenDay < w.day && w.requests <= 3;

  stepAgent(
    w.agent,
    dt,
    {
      isNight: w.isNight,
      requestsWaiting: w.requests,
      wantsReflect,
      speedMul: w.era.speedMul,
      onRequestResolved: () => {
        w.requests = Math.max(0, w.requests - 1);
        w.tokens += 3 + Math.round(w.rng.range(0, 4));
        w.reputation = clamp100(w.reputation + 1.5);
        w.tally.resolved++;
        w.fx.push("resolve");
      },
      onReflect: () => {
        w.tally.repAvg = w.tally.repSamples ? w.tally.repSum / w.tally.repSamples : w.reputation;
        writeMemory(w.memory, w.agent.personality, w.rng, w.tally);
        w.fx.push("memory");
      },
    },
    w.rng,
  );

  updateMood(w.mood, w.agent.needs, dt);

  // daily tallies
  w.tally.minFocus = Math.min(w.tally.minFocus, w.agent.needs.focus);
  w.tally.minSocial = Math.min(w.tally.minSocial, w.agent.needs.social);
  w.tally.repSum += w.reputation;
  w.tally.repSamples++;

  if (w.day !== prevDay) onNewDay(w);
}

export function drainFx(w) {
  if (w.fx.length === 0) return null;
  const out = w.fx;
  w.fx = [];
  return out;
}

export function rainLevel(w) {
  return rainIntensity(w.weather.sky);
}

function onNewDay(w) {
  ageMemory(w.memory, w.agent.personality);
  w.tally = freshTally(w.day);
  w.fx.push("day");
}

function clamp100(v) {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}
