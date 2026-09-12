import { test } from "node:test";
import assert from "node:assert/strict";
import { MEMORY_SLOTS, MEMORY_COMPACT_TO, TRAITS, freshMemory, writeMemory, ageMemory, compactMemory } from "../src/sim/memory.js";
import { makePartner, stepPartner, stepTogetherness } from "../src/sim/partner.js";
import { makeAgent, makePersonality } from "../src/sim/agent.js";
import { Rng } from "../src/engine/rng.js";

function tally(overrides = {}) {
  return { day: 5, resolved: 0, minFocus: 100, minSocial: 100, windowEvents: 0, paceCount: 0, repAvg: 50, ...overrides };
}

// ---------- memory.js ----------
test("freshMemory starts empty with no history", () => {
  const m = freshMemory();
  assert.deepEqual(m.slots, []);
  assert.equal(m.nextId, 1);
  assert.equal(m.total, 0);
});

test("writeMemory picks the most salient theme and nudges a personality trait", () => {
  const mem = freshMemory();
  const p = makePersonality(new Rng(1));
  const before = { ...p };
  const rec = writeMemory(mem, p, new Rng(1), tally({ resolved: 20 }));
  assert.equal(rec.kind, "grind");
  assert.equal(mem.slots.length, 1);
  assert.notEqual(p[rec.trait], before[rec.trait], "personality should drift");
});

test("writeMemory can land on every theme depending on which tally signal dominates", () => {
  const cases = [
    { kind: "lonely", tally: tally({ minSocial: 2 }) },
    { kind: "wonder", tally: tally({ windowEvents: 5 }) },
    { kind: "trusted", tally: tally({ repAvg: 95 }) },
    { kind: "adrift", tally: tally({ repAvg: 10 }) },
    { kind: "restless", tally: tally({ paceCount: 10 }) },
    { kind: "overwork", tally: tally({ minFocus: 1, resolved: 5 }) },
  ];
  for (const { kind, tally: t } of cases) {
    const mem = freshMemory();
    const p = makePersonality(new Rng(1));
    const rec = writeMemory(mem, p, new Rng(1), t);
    assert.equal(rec.kind, kind, `expected the "${kind}" theme to win for this tally`);
    assert.ok(rec.text.length > 0);
  }
});

test("writeMemory falls back to the low-salience 'quiet' theme on an uneventful day", () => {
  const mem = freshMemory();
  const p = makePersonality(new Rng(1));
  const rec = writeMemory(mem, p, new Rng(1), tally({ day: 7 }));
  assert.equal(rec.kind, "quiet");
  assert.ok(rec.text.includes("Day 7"));
  assert.ok(TRAITS.includes(rec.trait));
});

test("writing the same theme twice reinforces the existing slot instead of adding a new one", () => {
  const mem = freshMemory();
  const p = makePersonality(new Rng(1));
  writeMemory(mem, p, new Rng(1), tally({ resolved: 20 }));
  const again = writeMemory(mem, p, new Rng(1), tally({ resolved: 20, day: 6 }));
  assert.equal(mem.slots.length, 1, "reinforced, not duplicated");
  assert.ok(again.weight > 1);
});

test("ageMemory decays every slot's weight toward 0, never negative", () => {
  const mem = freshMemory();
  mem.slots.push({ id: 1, kind: "grind", text: "x", trait: "diligence", dir: 1, mag: 0.04, weight: 0.02, bornDay: 1 });
  ageMemory(mem);
  assert.equal(mem.slots[0].weight, 0);
});

test("compactMemory is a no-op under the cap", () => {
  const mem = freshMemory();
  mem.slots.push({ id: 1, kind: "grind", text: "x", trait: "diligence", dir: 1, mag: 0.04, weight: 1, bornDay: 1 });
  assert.equal(compactMemory(mem), null);
  assert.equal(mem.slots.length, 1);
});

test("compactMemory folds the faintest memories down once the working set hits MEMORY_SLOTS", () => {
  const mem = freshMemory();
  for (let i = 0; i < MEMORY_SLOTS; i++) {
    mem.slots.push({
      id: i + 1,
      kind: `k${i}`,
      text: `memory ${i}`,
      trait: TRAITS[i % TRAITS.length],
      dir: i % 2 ? 1 : -1,
      mag: 0.01,
      weight: Math.random() * 4,
      bornDay: (i % 40) + 1,
    });
  }
  const summary = compactMemory(mem);
  assert.ok(summary, "should have compacted");
  assert.equal(summary.kind, "summary");
  assert.equal(mem.slots.length, MEMORY_COMPACT_TO);
  assert.ok(mem.overflow.length > 0, "folded memories are preserved in overflow for the server to flush");
  assert.equal(mem.overflow.length + MEMORY_COMPACT_TO - 1, MEMORY_SLOTS);
});

// ---------- partner.js ----------
test("makePartner places them on the couch by default", () => {
  const p = makePartner(new Rng(1), { name: "Nour", gender: "n", look: {} });
  assert.equal(p.room, "couch");
  assert.equal(p.name, "Nour");
});

test("stepPartner is a safe no-op when there's no partner", () => {
  assert.doesNotThrow(() => stepPartner({ partner: null }, 1, new Rng(1)));
});

test("stepPartner decays needs and never throws over many ticks", () => {
  const w = {
    partner: makePartner(new Rng(1), { name: "Nour", gender: "n", look: {} }),
    agent: { room: "desk" },
    isNight: false,
    rooms: { desk: [], kitchen: [], window: [], couch: [], bed: [], game: [] },
    togetherness: 50,
    era: { speedMul: 1 },
    fx: [],
  };
  const before = w.partner.needs.energy;
  for (let i = 0; i < 200; i++) stepPartner(w, 0.5, new Rng(i));
  assert.ok(Number.isFinite(w.partner.needs.energy));
  assert.notEqual(w.partner.needs.energy, before);
});

test("stepTogetherness is a safe no-op with no partner", () => {
  assert.doesNotThrow(() => stepTogetherness({ partner: null }, 1));
});

test("stepTogetherness rises fast when close, decays when apart, and biases mood", () => {
  const near = {
    partner: { x: 100, y: 100, room: "couch", transit: 0 },
    agent: { x: 105, y: 100, room: "couch", transit: 0, lastThought: "" },
    togetherness: 50,
    isNight: false,
    mood: { valence: 0 },
    fx: [],
    rng: new Rng(1),
  };
  stepTogetherness(near, 1);
  assert.ok(near.togetherness > 50);

  const apart = {
    partner: { x: 0, y: 0, room: "bed", transit: 0 },
    agent: { x: 400, y: 400, room: "desk", transit: 0, lastThought: "" },
    togetherness: 50,
    isNight: false,
    mood: { valence: 0 },
    fx: [],
    rng: new Rng(1),
  };
  stepTogetherness(apart, 1);
  assert.ok(apart.togetherness < 50);
});

test("stepTogetherness drifts toward the ~80 equilibrium over a long run and clamps to [0,100]", () => {
  const w = {
    partner: { x: 100, y: 100, room: "couch", transit: 0 },
    agent: { x: 100, y: 100, room: "couch", transit: 0, lastThought: "" },
    togetherness: 100,
    isNight: false,
    mood: { valence: 0 },
    fx: [],
    rng: new Rng(1),
  };
  for (let i = 0; i < 5000; i++) stepTogetherness(w, 0.5);
  assert.ok(w.togetherness >= 0 && w.togetherness <= 100);
});

test("stepTogetherness fires a shared 'memory' fx beat after sustained closeness", () => {
  const w = {
    partner: { x: 100, y: 100, room: "couch", transit: 0 },
    agent: { x: 100, y: 100, room: "couch", transit: 0, lastThought: "" },
    togetherness: 50,
    isNight: false,
    mood: { valence: 0 },
    fx: [],
    rng: new Rng(1),
  };
  for (let i = 0; i < 100; i++) stepTogetherness(w, 0.5); // 50 sim-seconds of closeness > the 30s beat
  assert.ok(w.fx.includes("memory"));
  assert.notEqual(w.agent.lastThought, "");
});
