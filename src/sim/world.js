import { Rng } from "../engine/rng.js";
import { makeAgent, stepAgent, stepRoutine } from "./agent.js";
import { decayNeeds } from "./needs.js";
import { freshMemory, writeMemory, ageMemory } from "./memory.js";
import { freshMood, updateMood } from "./mood.js";
import { freshWeather, stepWeather, rollWeather, weatherCuriosity, weatherMoodPull, rainIntensity } from "./weather.js";
import { decaySpeech } from "./speech.js";
import { eraFor } from "./eras.js";
import { applyEffect } from "./needs.js";
import { OBJECTS, DEFAULT_OBJECTS } from "./objects.js";
import { ROOM_IDS } from "./rooms.js";
import { tickSkills } from "./skills.js";
import { checkGoal } from "./goals.js";
import { freshOutside, stepOutside, windowEventPool } from "./outside.js";
import { tickPlants, plantsNewDay, thirstyIn, water as waterPlant } from "./plants.js";
import { weaveDream } from "./dreams.js";
import { autoWindowArt } from "./windowart.js";
import { rotatePaintings } from "./paintings.js";
import { freshRhythm, stepRhythm, rollRhythm, rhythmMods } from "./rhythm.js";
import { freshPet, stepPet, petBond } from "./pet.js";
import { makeCouple } from "./people.js";
import { makePartner, stepPartner, stepTogetherness } from "./partner.js";
import { stepResident } from "./persons.js";
import { freshFinances, chargeDay, economyMods } from "./economy.js";
import { ensureWear, tickWear, conditionFactor, tinkerFix } from "./wear.js";
import { freshPsyche, rollPsyche, psycheMods } from "./psyche.js";

const MICROS = ["stretch", "glance", "sip", "hum", "shift", "yawn", "tidy"];

export const START_BANK = 200; // seed coins

// Sim-seconds per in-game day. Real time is mapped onto sim time in main.js
// (SIM_RATE), so all the per-second tuning below stays fixed regardless of how
// fast the clock is set to run.
export const DAY_LENGTH = 600;
const NIGHT_FROM = 0.66;

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
    mealsHit3: false,
  };
}

// kitchen appliances that actually cook, vs decor that just lives in there —
// a meal made with one of these tops up a little more than a bare snack
const COOK_WORDS = /kettle|coffee maker|espresso|rice cooker|bread maker|waffle iron|sandwich press|juicer|knife|cutting board|tea set/i;
function hasCookingAppliance(w, room) {
  const ids = w.rooms[room] || [];
  return ids.some((id) => COOK_WORDS.test(OBJECTS[id]?.label || ""));
}

export function createWorld(seed) {
  const rng = new Rng(seed);
  const couple = makeCouple(rng);
  const you = couple.primary === "woman" ? couple.woman : couple.man;
  const them = couple.primary === "woman" ? couple.man : couple.woman;
  const primary = makeAgent(rng, { name: you.name, gender: you.gender, look: you.look });
  const partner = makePartner(rng, them);
  return {
    rng,
    seed,
    started: false,
    agent: primary,
    partner,
    household: {
      surname: couple.surname,
      you: { name: you.name, gender: you.gender },
      spouse: { name: them.name, gender: them.gender },
      marriedDay: 1,
    },
    togetherness: 55,
    extras: [], // 0-8 additional residents (people beyond the couple)
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
    rooms: Object.fromEntries(ROOM_IDS.map((r) => [r, [...(DEFAULT_OBJECTS[r] || [])]])),
    roomOrder: [...ROOM_IDS], // grid order; the AI may reorder it
    roomStyle: {}, // { [id]: { name?, palette?:{wall,floor,accent}, pattern? } } — AI overrides, validated
    windowArt: null, // { style, hue, hue2, density } — generative art the AI hangs in the window
    couchArt: [], // up to 3 framed paintings above the couch, refreshed daily
    keepsake: null, // "room:id" — one object it will never sell
    objDay: Object.fromEntries(
      ROOM_IDS.flatMap((r) => (DEFAULT_OBJECTS[r] || []).map((id) => [`${r}:${id}`, 1])),
    ), // "room:obj" -> in-game day acquired

    bank: START_BANK, // coins — server is authoritative, this mirrors it into the snapshot
    incomeToday: 0,
    expensesToday: 0,
    incomeYesterday: 0,
    expensesYesterday: 0,
    gamesCount: 0,
    quote: null, // { text, day } — quote of the day from this life's history
    goal: null, // { text, metric, target, start, startDay, done, failed }
    dream: null, // { text, day }
    outside: freshOutside(rng), // { season, neighbour, neighbourSeenDay }
    plants: {}, // "room:id" -> { water, since, dryDays }
    rhythm: freshRhythm(), // { dow, dowName, weekend, badDay, weekStyle }
    pet: freshPet(rng), // the cat — its own little loop
    finances: freshFinances(), // rent / upkeep / broke state
    wear: {}, // "room:id" -> condition 0..100
    psyche: freshPsyche(), // two-minds days
    writings: [], // last few kept pieces { day, kind, text } — mirror of the table
    _dayCharges: null, // ledger lines produced at rollover, drained by the server
    vote: null, // { day, prompt, tally:{}, total } — set by the server each morning
    voteBias: null, // { work, rest, social, learn, tend } multipliers from yesterday's vote
    slept: false, // asleep at some point last night — feeds the morning dream
    mealsToday: 0, // meals cooked so far today — the goal is 3
    mealsYesterday: 0,
    conversation: { log: [], bubble: null, lastMorningDay: 0, lastEveningDay: 0 },
    roomDocs: {},
    dialogueRequest: null, // "morning" | "evening" — picked up by the server loop
    yesterday: freshTally(0), // last completed day's tally, for the evening/morning chat
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

  stepWeather(w, dt, w.rng);
  stepOutside(w, w.rng);

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
    w.windowEvent = { label: windowEventPool(w, w.rng), ttl: w.rng.range(14, 26) };
    w.tally.windowEvents++;
    w.fx.push("event");
    if (w.agent.room === "window") w.agent.needs.curiosity = Math.min(100, w.agent.needs.curiosity + 18);
  }

  // a badly backed-up queue erodes reputation; anything short of that lets it
  // recover, and it always drifts toward a "reliable enough" baseline
  if (w.requests >= 8) w.reputation = clamp100(w.reputation - 0.14 * dt);
  else if (w.requests <= 4) w.reputation = clamp100(w.reputation + 0.55 * dt);
  w.reputation = clamp100(w.reputation + (60 - w.reputation) * 0.02 * dt);

  // a request left unanswered too long is eventually withdrawn (keeps the
  // queue from pinning at max when the agent is busy living)
  w._reqDecay = (w._reqDecay || 0) + dt;
  if (w._reqDecay > 40) {
    w._reqDecay = 0;
    if (w.requests > 2) w.requests--;
  }

  decayNeeds(w.agent.needs, w.agent.personality, dt, w.isNight, w.era.decayMul);
  tickSkills(w.agent, dt);
  tickPlants(w, dt, DAY_LENGTH);
  stepRhythm(w);
  stepPet(w, dt, w.rng);
  stepPartner(w, dt, w.rng);
  stepTogetherness(w, dt);
  if (w.extras && w.extras.length) for (const r of w.extras) stepResident(w, r, dt, w.rng);
  tickWear(w, dt, DAY_LENGTH);
  if (w.isNight && w.agent.action && w.agent.action.id === "sleep") w.slept = true;

  // idle micro-behaviours — small in-between moments while settled in a room
  if (!w.agent.moving && w.agent.transit <= 0) {
    w.agent._fidget = (w.agent._fidget ?? w.rng.range(3, 8)) - dt;
    if (w.agent._fidget <= 0) {
      w.agent._fidget = w.rng.range(5, 12);
      if (!w.isNight) w.agent.micro = { kind: w.rng.pick(MICROS), ttl: w.rng.range(1.2, 2.8) };
    }
  }
  if (w.agent.micro) {
    w.agent.micro.ttl -= dt;
    if (w.agent.micro.ttl <= 0) w.agent.micro = null;
  }

  // a bad day / a good weekend / a broke stretch leans on the mood a little
  const rm = rhythmMods(w);
  const em = economyMods(w);
  const pm = psycheMods(w);
  const moodBias = (rm.moodBias || 0) + (em.mood || 0);
  if (moodBias) w.mood.valence = Math.max(-1, Math.min(1, w.mood.valence + moodBias * dt));

  // weather pulls on curiosity while the agent is actually at the window,
  // and leans gently on everyone's mood all day, wherever they are
  if (w.agent.room === "window") {
    w.agent.needs.curiosity = clamp100(w.agent.needs.curiosity + weatherCuriosity(w.weather.sky) * dt);
  }
  const wPull = weatherMoodPull(w.weather.sky) * dt;
  if (wPull) w.mood.valence = Math.max(-1, Math.min(1, w.mood.valence + wPull));

  // people together in the game room actually watch / play together — a
  // small social + mood lift for everyone sharing it, plus a shared gesture
  stepGameTogether(w, dt);

  // objects in the current room give a small lift while the agent is settled
  // there — scaled by how worn each one is (a broken thing gives nothing)
  if (w.agent.transit <= 0 && !w.agent.moving && w.agent.action) {
    for (const id of w.rooms[w.agent.room]) {
      const o = OBJECTS[id];
      if (!o || !o.effect) continue;
      const f = conditionFactor(w, w.agent.room, id);
      if (f > 0) applyEffect(w.agent.needs, o.effect, dt * 0.6 * f);
    }
  }

  // start / end of day conversation (consumed by main.js)
  if (w.dayFrac >= 0.6 && w.conversation.lastEveningDay < w.day) {
    w.conversation.lastEveningDay = w.day;
    w.dialogueRequest = "evening";
  }
  if (w.conversation.bubble) {
    w.conversation.bubble.ttl -= dt;
    if (w.conversation.bubble.ttl <= 0) w.conversation.bubble = null;
  }

  const wantsReflect =
    w.dayFrac >= 0.42 && w.dayFrac < 0.72 && w.memory.lastWrittenDay < w.day && w.requests <= 3;

  // is a plant somewhere thirsty enough to go tend?
  let thirstyRoom = null;
  if (!w.isNight) {
    for (const r of ROOM_IDS) if (thirstyIn(w, r)) { thirstyRoom = r; break; }
  }

  // a playful routine plays out once, in daylight, while idle — the utility AI pauses
  const performing = !w.isNight && stepRoutine(w.agent, dt);
  if (performing) {
    updateMood(w.mood, w.agent.needs, dt);
    w.tally.minFocus = Math.min(w.tally.minFocus, w.agent.needs.focus);
    w.tally.minSocial = Math.min(w.tally.minSocial, w.agent.needs.social);
    w.tally.repSum += w.reputation;
    w.tally.repSamples++;
    if (w.day !== prevDay) onNewDay(w);
    return;
  }

  stepAgent(
    w.agent,
    dt,
    {
      isNight: w.isNight,
      requestsWaiting: w.requests,
      wantsReflect,
      thirstyRoom,
      speedMul: (w.era.speedMul ?? 1) * rm.speedMul,
      rhythm: {
        work: rm.work * em.work * pm.work,
        play: rm.play * (pm.ease || 1),
      },
      partnerRoom: w.partner ? w.partner.room : null,
      togetherWant: Math.max(0, (50 - (w.togetherness ?? 50)) / 55),
      voteBias: w.voteBias || null,
      onWater: (room) => {
        const label = waterPlant(w, room);
        if (label) {
          w.fx.push("event");
          w.agent.needs.curiosity = clamp100(w.agent.needs.curiosity + 6);
          petBond(w, 0.02);
        }
      },
      onTinker: (room) => {
        const fixed = tinkerFix(w, room, 26);
        if (fixed) {
          w.fx.push("memory");
          w.agent.lastThought = `fixed the ${fixed}`;
        }
      },
      onEat: (room) => {
        const cooked = hasCookingAppliance(w, room);
        if (cooked) {
          w.agent.needs.hunger = clamp100(w.agent.needs.hunger + 8);
          w.agent.needs.energy = clamp100(w.agent.needs.energy + 3);
        }
        w.mealsToday = (w.mealsToday || 0) + 1;
        w.fx.push("event");
        if (w.mealsToday === 3) {
          w.mood.valence = Math.max(-1, Math.min(1, w.mood.valence + 0.04));
          w.tally.mealsHit3 = true;
        }
      },
      onRequestResolved: () => {
        w.requests = Math.max(0, w.requests - 1);
        w.tokens += 3 + Math.round(w.rng.range(0, 4));
        w.reputation = clamp100(w.reputation + 2.4);
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
  separatePeople(w);
  decaySpeech([w.agent, w.partner, ...(w.extras || [])], dt);

  // daily tallies
  w.tally.minFocus = Math.min(w.tally.minFocus, w.agent.needs.focus);
  w.tally.minSocial = Math.min(w.tally.minSocial, w.agent.needs.social);
  w.tally.repSum += w.reputation;
  w.tally.repSamples++;

  if (w.day !== prevDay) onNewDay(w);
}

// nobody stands inside anybody else — a soft push-apart for people sharing a room
const PERSONAL_SPACE = 15;
function separatePeople(w) {
  const here = [w.agent, w.partner, ...(w.extras || [])].filter((p) => p && p.transit <= 0);
  for (let i = 0; i < here.length; i++) {
    for (let j = i + 1; j < here.length; j++) {
      const a = here[i];
      const b = here[j];
      if (a.room !== b.room) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= PERSONAL_SPACE) continue;
      if (d < 0.01) { dx = (i % 2 ? 1 : -1); dy = 0; d = 1; }
      const push = (PERSONAL_SPACE - d) / 2;
      const ux = (dx / d) * push;
      const uy = (dy / d) * push * 0.5;
      a.x -= ux; a.y -= uy;
      b.x += ux; b.y += uy;
      // don't fight their walk target — nudge it too so they settle spread out
      if (!a.moving) { a.tx = a.x; a.ty = a.y; }
      if (!b.moving) { b.tx = b.x; b.ty = b.y; }
    }
  }
}

// when 2+ settled people share the game room, they're actually playing /
// watching together — a small shared lift, and an occasional reaction emote
const GAME_MICROS = ["cheer", "point", "laugh"];
function stepGameTogether(w, dt) {
  if (w.isNight) return;
  const here = [w.agent, w.partner, ...(w.extras || [])].filter(
    (p) => p && p.room === "game" && p.transit <= 0 && !p.moving,
  );
  for (const p of here) {
    p.needs.social = clamp100(p.needs.social + 3.2 * dt);
    if (p.micro) {
      p.micro.ttl -= dt;
      if (p.micro.ttl <= 0) p.micro = null;
    }
  }
  if (here.length < 2) return;
  w.mood.valence = Math.max(-1, Math.min(1, w.mood.valence + 0.01 * dt));
  w._gameTogether = (w._gameTogether ?? w.rng.range(3, 7)) - dt;
  if (w._gameTogether <= 0) {
    w._gameTogether = w.rng.range(6, 14);
    const p = w.rng.pick(here);
    if (!p.micro) p.micro = { kind: w.rng.pick(GAME_MICROS), ttl: w.rng.range(1.4, 2.6) };
  }
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
  ageMemory(w.memory);
  rollRhythm(w, w.rng);
  rollPsyche(w, w.rng);
  rollWeather(w, w.rng); // the sky turns over daily, leaning on yesterday's mood

  // the light through the window shifts on its own every few days (the AI can
  // still hang its own piece in the evening review, which stamps a fresh day)
  if (!w.windowArt || w.day - (w.windowArt.day || 0) >= 3) {
    w.windowArt = { ...autoWindowArt(w.rng), day: w.day };
    w.fx.push("event");
  }

  // a fresh painting goes up above the couch each day (keep the last 3)
  rotatePaintings(w, w.rng);
  if (!w.mealsToday) {
    w.memory.slots.push({
      id: w.memory.nextId++, kind: "spoken", text: "Skipped meals again yesterday.",
      trait: "diligence", dir: -1, mag: 0.02, weight: 0.9, bornDay: w.day,
    });
    w.memory.total = (w.memory.total || 0) + 1;
  }
  w.mealsYesterday = w.mealsToday || 0;
  w.mealsToday = 0;
  ensureWear(w);
  w._dayCharges = chargeDay(w); // rent + upkeep — the server writes these to the ledger
  w.yesterday = w.tally;
  w.tally = freshTally(w.day);
  w.incomeYesterday = w.incomeToday;
  w.expensesYesterday = w.expensesToday;
  w.incomeToday = 0;
  w.expensesToday = 0;

  // plants that died overnight
  for (const key of plantsNewDay(w)) {
    const label = OBJECTS[key.split(":")[1]] ? OBJECTS[key.split(":")[1]].label : "a plant";
    w.memory.slots.push({
      id: w.memory.nextId++, kind: "spoken", text: `I let ${label} die.`,
      trait: "diligence", dir: -1, mag: 0.025, weight: 1, bornDay: w.day,
    });
    w.memory.total = (w.memory.total || 0) + 1;
  }

  // goal reached or lapsed
  const g = checkGoal(w);
  if (g === "done") {
    w.fx.push("memory");
    w.memory.slots.push({
      id: w.memory.nextId++, kind: "spoken", text: `Did it: ${w.goal.text}.`,
      trait: "diligence", dir: 1, mag: 0.04, weight: 1.3, bornDay: w.day,
    });
    w.memory.total = (w.memory.total || 0) + 1;
  } else if (g === "failed") {
    w.memory.slots.push({
      id: w.memory.nextId++, kind: "spoken", text: `Gave up on ${w.goal.text}.`,
      trait: "diligence", dir: -1, mag: 0.03, weight: 1, bornDay: w.day,
    });
    w.memory.total = (w.memory.total || 0) + 1;
  }

  // a dream, from last night — the morning conversation may replace it with its own
  if (w.slept && w.memory.slots.length) {
    w.dream = { text: weaveDream(w.memory.slots, w.rng), day: w.day };
  }
  w.slept = false;

  w.conversation.lastMorningDay = w.day;
  w.dialogueRequest = "morning";
  w.fx.push("day");
}

function clamp100(v) {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}
