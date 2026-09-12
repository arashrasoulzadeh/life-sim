import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PEOPLE, makeResident, residentsIncome, stepResident, allPeople, applyPeopleOps, personsFile, hydrateFromFile } from "../src/sim/persons.js";
import { findSpeechMoment, tickSpeechCooldown, buildSpeechPrompt, applySpeech, decaySpeech, speechDayKey, SPEECH_DAILY_CAP, SAY_TTL } from "../src/sim/speech.js";
import { Rng } from "../src/engine/rng.js";
import { createWorld, tick } from "../src/sim/world.js";

// ---------- persons.js ----------
test("makeResident builds a valid resident agent with sane defaults", () => {
  const r = makeResident(new Rng(1), {}, new Set());
  assert.ok(r.name);
  assert.ok(["f", "m", "n"].includes(r.gender));
  assert.equal(r.resident, true);
  assert.equal(r.room, "couch");
  assert.ok(r.income >= 0 && r.income <= 60);
});

test("makeResident respects an explicit name/gender/room/income (name is trimmed and length-capped, not HTML-escaped here — that happens at render time)", () => {
  const r = makeResident(new Rng(1), { name: "  Zed  ", gender: "m", room: "game", income: 999 }, new Set());
  assert.equal(r.name, "Zed");
  assert.equal(r.gender, "m");
  assert.equal(r.room, "game");
  assert.equal(r.income, 60, "income clamped to 60");
});

test("makeResident infers income from the role text when none is given", () => {
  const student = makeResident(new Rng(1), { role: "student" }, new Set());
  assert.ok(student.income >= 4 && student.income <= 12);
  const kid = makeResident(new Rng(1), { role: "the kid next door" }, new Set());
  assert.equal(kid.income, 0);
});

test("residentsIncome sums extras' income, 0 with none", () => {
  assert.equal(residentsIncome({ extras: [{ income: 10 }, { income: 5 }] }), 15);
  assert.equal(residentsIncome({}), 0);
});

test("stepResident decays needs and never throws over many ticks", () => {
  const w = { agent: { room: "desk" }, isNight: false, era: { decayMul: 1, speedMul: 1 } };
  const r = makeResident(new Rng(1), {}, new Set());
  for (let i = 0; i < 500; i++) stepResident(w, r, 0.5, new Rng(i));
  assert.ok(Number.isFinite(r.needs.energy));
});

test("allPeople filters out a missing partner and always leads with the agent", () => {
  const w = { agent: { name: "A" }, partner: null, extras: [{ name: "B" }] };
  assert.deepEqual(allPeople(w).map((p) => p.name), ["A", "B"]);
});

test("applyPeopleOps: add respects MAX_PEOPLE and reports when full", () => {
  const w = { agent: { name: "A" }, partner: { name: "B" }, extras: Array.from({ length: MAX_PEOPLE - 2 }, (_, i) => ({ name: `R${i}` })) };
  const notes = applyPeopleOps(w, [{ op: "add", name: "Overflow" }], new Rng(1));
  assert.equal(notes[0], "the flat is full");
  assert.equal(w.extras.length, MAX_PEOPLE - 2);
});

test("applyPeopleOps: add actually adds a resident when there's room", () => {
  const w = { agent: { name: "A" }, partner: { name: "B" }, extras: [] };
  const notes = applyPeopleOps(w, [{ op: "add", name: "Zed", gender: "m" }], new Rng(1));
  assert.equal(w.extras.length, 1);
  assert.ok(notes[0].includes("Zed"));
});

test("applyPeopleOps: rename/restyle/role/income/remove all work by name or index", () => {
  const w = { agent: { name: "A" }, partner: { name: "B" }, extras: [{ name: "Zed", role: "", income: 10, look: {} }] };
  applyPeopleOps(w, [{ op: "rename", who: "Zed", name: "Zephyr" }], new Rng(1));
  assert.equal(w.extras[0].name, "Zephyr");

  applyPeopleOps(w, [{ op: "restyle", who: 2, look: { skin: "#abcdef", long: true } }], new Rng(1));
  assert.equal(w.extras[0].look.skin, "#abcdef");
  assert.equal(w.extras[0].look.long, true);

  applyPeopleOps(w, [{ op: "role", who: "Zephyr", role: "artist", income: 20 }], new Rng(1));
  assert.equal(w.extras[0].role, "artist");
  assert.equal(w.extras[0].income, 20);

  applyPeopleOps(w, [{ op: "income", who: "Zephyr", amount: 55 }], new Rng(1));
  assert.equal(w.extras[0].income, 55);

  const notes = applyPeopleOps(w, [{ op: "remove", who: "Zephyr" }], new Rng(1));
  assert.equal(w.extras.length, 0);
  assert.ok(notes[0].includes("moved out"));
});

test("applyPeopleOps ignores ops for an unknown person and caps at 6 ops per call", () => {
  const w = { agent: { name: "A" }, partner: { name: "B" }, extras: [] };
  const notes = applyPeopleOps(w, [{ op: "rename", who: "nobody", name: "X" }], new Rng(1));
  assert.equal(notes.length, 0);
  const many = Array.from({ length: 10 }, () => ({ op: "add", gender: "n" }));
  applyPeopleOps(w, many, new Rng(1));
  assert.equal(w.extras.length, 6);
});

test("applyPeopleOps returns [] for non-array input", () => {
  assert.deepEqual(applyPeopleOps({ extras: [] }, "nope", new Rng(1)), []);
});

test("personsFile serializes you/spouse/residents with the right slots", () => {
  const w = { seed: "s1", agent: { name: "A", gender: "n" }, partner: { name: "B", gender: "f" }, extras: [{ name: "C", gender: "m", income: 12 }] };
  const file = personsFile(w);
  assert.equal(file.seed, "s1");
  assert.equal(file.people[0].slot, "you");
  assert.equal(file.people[1].slot, "spouse");
  assert.equal(file.people[2].slot, "resident");
  assert.equal(file.people[2].income, 12);
});

test("hydrateFromFile applies names/roles/income/look/personality from a persons.json shape", () => {
  const w = { agent: { name: "old-you", personality: {} }, partner: { name: "old-spouse", personality: {} }, extras: [] };
  const data = {
    people: [
      { slot: "you", name: "NewYou", role: "the assistant" },
      { slot: "spouse", name: "NewSpouse" },
      { slot: "resident", name: "Res1", income: 15, look: { skin: "#111111" } },
    ],
  };
  hydrateFromFile(w, data, new Rng(1));
  assert.equal(w.agent.name, "NewYou");
  assert.equal(w.partner.name, "NewSpouse");
  assert.equal(w.extras.length, 1);
  assert.equal(w.extras[0].name, "Res1");
  assert.equal(w.extras[0].income, 15);
  assert.equal(w.extras[0].look.skin, "#111111");
});

test("hydrateFromFile is a no-op with malformed data", () => {
  const w = { agent: { name: "keep" }, extras: [] };
  hydrateFromFile(w, null, new Rng(1));
  hydrateFromFile(w, { people: "nope" }, new Rng(1));
  assert.equal(w.agent.name, "keep");
});

// ---------- speech.js ----------
test("speechDayKey returns today's date in YYYY-MM-DD form", () => {
  assert.match(speechDayKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test("findSpeechMoment returns null at night or with fewer than 2 settled people sharing a room", () => {
  const nightW = { isNight: true, agent: { room: "couch", transit: 0, moving: false }, partner: { room: "couch", transit: 0, moving: false } };
  assert.equal(findSpeechMoment(nightW), null);

  const aloneW = { isNight: false, agent: { room: "couch", transit: 0, moving: false }, partner: { room: "bed", transit: 0, moving: false } };
  assert.equal(findSpeechMoment(aloneW), null);
});

test("findSpeechMoment finds a settled pair, preferring the game room, and skips movers/routiners", () => {
  const w = {
    isNight: false,
    agent: { name: "A", room: "game", transit: 0, moving: false, routine: null },
    partner: { name: "B", room: "game", transit: 0, moving: false, routine: null },
    extras: [{ name: "C", room: "couch", transit: 5, moving: false, routine: null }],
  };
  const m = findSpeechMoment(w);
  assert.equal(m.room, "game");
  assert.equal(m.interactive, true);
  assert.ok([m.a.name, m.b.name].includes("A") && [m.a.name, m.b.name].includes("B"));
});

test("findSpeechMoment avoids repeating the exact same pair when a third person is available", () => {
  const w = {
    isNight: false,
    _speechPick: 0,
    _lastSpeechPair: { a: "A", b: "B" },
    agent: { name: "A", room: "couch", transit: 0, moving: false, routine: null },
    partner: { name: "B", room: "couch", transit: 0, moving: false, routine: null },
    extras: [{ name: "C", room: "couch", transit: 0, moving: false, routine: null }],
  };
  const m = findSpeechMoment(w);
  assert.equal(m.a.name, "A");
  assert.notEqual(m.b.name, "B", "should pick C instead of repeating A/B");
});

test("tickSpeechCooldown counts down and only fires once the cooldown lapses", () => {
  const w = {};
  const rng = new Rng(1);
  let fires = 0;
  for (let i = 0; i < 400; i++) if (tickSpeechCooldown(w, 1, rng)) fires++;
  assert.ok(fires >= 1 && fires <= 10, `expected a handful of fires over 400s, got ${fires}`);
});

test("buildSpeechPrompt mentions both names and adapts to the game-room / plain-room framing", () => {
  const w = { weather: { sky: "rain" }, isNight: false };
  const a = { name: "Mara", role: "" , needs: { social: 20 } };
  const b = { name: "Sam", role: "lodger" };
  const game = buildSpeechPrompt(w, a, b, "game", true);
  assert.ok(game.system.includes("game room"));
  assert.ok(game.user.includes("Mara"));
  assert.ok(game.user.includes("Sam (lodger)"));
  assert.ok(game.user.includes("a little lonely"));

  const plain = buildSpeechPrompt(w, a, b, "kitchen", false);
  assert.ok(plain.system.includes("in the kitchen"));
});

test("applySpeech applies the line to whichever of a/b the model picked, sanitized and capped", () => {
  const a = { name: "A", room: "couch" };
  const b = { name: "B", room: "couch" };
  const said = applySpeech({}, a, b, { line: "  <b>hi there</b>  ".repeat(10), from: "b" });
  assert.equal(said.speaker, "B");
  assert.equal(b.routineSay, said.line);
  assert.ok(said.line.length <= 90);
  assert.ok(!said.line.includes("<"));
  assert.equal(b._sayTtl, SAY_TTL);
});

test("applySpeech returns null for an empty/missing line and touches nobody", () => {
  const a = { name: "A", room: "couch" };
  const b = { name: "B", room: "couch" };
  assert.equal(applySpeech({}, a, b, {}), null);
  assert.equal(applySpeech({}, a, b, { line: "   " }), null);
  assert.equal(a.routineSay, undefined);
});

test("decaySpeech clears routineSay once the ttl expires, leaves it while still active", () => {
  const p = { routineSay: "hi", _sayTtl: 1 };
  decaySpeech([p, null], 0.5);
  assert.equal(p.routineSay, "hi");
  decaySpeech([p], 0.6);
  assert.equal(p.routineSay, "");
});

test("SPEECH_DAILY_CAP is a small, sane positive number", () => {
  assert.ok(SPEECH_DAILY_CAP > 0 && SPEECH_DAILY_CAP <= 50);
});

// ---------- a light integration check ----------
test("a world with added residents runs many ticks without crashing or producing NaN needs", () => {
  const w = createWorld("persons-integration-1");
  applyPeopleOps(w, [{ op: "add", name: "Zed", gender: "m" }, { op: "add", name: "Mo", gender: "n" }], w.rng);
  for (let i = 0; i < 3000; i++) tick(w, 0.5);
  for (const p of allPeople(w)) {
    for (const v of Object.values(p.needs)) assert.ok(Number.isFinite(v));
  }
});
