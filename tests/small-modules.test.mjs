import { test } from "node:test";
import assert from "node:assert/strict";
import { freshMood, updateMood, moodWord, moodPosture } from "../src/sim/mood.js";
import { ERAS, eraFor } from "../src/sim/eras.js";
import { OBJECTS, OBJECT_IDS_BY_ROOM, DEFAULT_OBJECTS, MARKET, isSellable, priceOf, sellValue, catOf } from "../src/sim/objects.js";
import { weaveDream } from "../src/sim/dreams.js";
import { Rng, randomSeed } from "../src/engine/rng.js";
import { makeCouple, spouseWord } from "../src/sim/people.js";
import { SKILLS, freshSkills, tickSkills, bumpSkill, gates } from "../src/sim/skills.js";
import { ROOMS, ROOM_IDS } from "../src/sim/rooms.js";

// ---------- mood.js ----------
test("freshMood starts mid-bright, low strain", () => {
  const m = freshMood();
  assert.equal(m.valence, 0.55);
  assert.equal(m.strain, 0.2);
});

test("updateMood pulls valence toward the average of the four core needs", () => {
  const m = freshMood();
  const needs = { focus: 0, energy: 0, social: 0, curiosity: 0 };
  for (let i = 0; i < 200; i++) updateMood(m, needs, 1);
  assert.ok(m.valence < 0.1, `valence should have decayed toward 0, got ${m.valence}`);
  assert.ok(m.strain > 0.9, `strain should have risen toward 1, got ${m.strain}`);
});

test("moodWord buckets valence into named bands", () => {
  assert.equal(moodWord({ valence: 0.9 }), "bright");
  assert.equal(moodWord({ valence: 0.5 }), "steady");
  assert.equal(moodWord({ valence: 0.35 }), "worn");
  assert.equal(moodWord({ valence: 0.1 }), "low");
});

test("moodPosture is higher valence/lower strain -> more upright", () => {
  const upright = moodPosture({ valence: 1, strain: 0 });
  const slumped = moodPosture({ valence: 0, strain: 1 });
  assert.ok(upright > slumped);
});

// ---------- eras.js ----------
test("eraFor returns the newest era whose fromDay has been reached", () => {
  assert.equal(eraFor(1).id, "new");
  assert.equal(eraFor(6).id, "new");
  assert.equal(eraFor(7).id, "steady");
  assert.equal(eraFor(21).id, "steady");
  assert.equal(eraFor(22).id, "worn");
  assert.equal(eraFor(47).id, "worn");
  assert.equal(eraFor(48).id, "legacy");
  assert.equal(eraFor(10000).id, "legacy");
});

test("ERAS is ordered by fromDay ascending", () => {
  for (let i = 1; i < ERAS.length; i++) assert.ok(ERAS[i].fromDay > ERAS[i - 1].fromDay);
});

// ---------- objects.js / marketplace.js ----------
test("objects.js re-exports a populated marketplace", () => {
  assert.ok(Object.keys(OBJECTS).length > 100, "expect a large catalog");
  assert.ok(Object.keys(MARKET).length > 0);
  for (const roomId of ROOM_IDS) assert.ok(Array.isArray(OBJECT_IDS_BY_ROOM[roomId]), `${roomId} should have a catalog list`);
});

test("every DEFAULT_OBJECTS entry is a real, room-correct id", () => {
  for (const [room, ids] of Object.entries(DEFAULT_OBJECTS)) {
    for (const id of ids) {
      assert.ok(OBJECTS[id], `${id} should exist`);
      assert.equal(OBJECTS[id].room, room, `${id} should default into its own room`);
    }
  }
});

test("priceOf/sellValue/isSellable/catOf agree with the catalog", () => {
  const [id, o] = Object.entries(OBJECTS)[0];
  assert.equal(priceOf(id), o.price);
  assert.equal(sellValue(id), Math.round(o.price * 0.5));
  assert.equal(isSellable(id), o.sellable !== false);
  assert.equal(catOf(id), o.cat);
  assert.equal(priceOf("no-such-id"), 0);
  assert.equal(catOf("no-such-id"), "");
});

// ---------- dreams.js ----------
test("weaveDream returns empty string with no memory slots", () => {
  assert.equal(weaveDream([], new Rng(1)), "");
  assert.equal(weaveDream(null, new Rng(1)), "");
});

test("weaveDream weaves a bounded sentence from memory text", () => {
  const slots = [{ text: "I fixed the lamp." }, { text: "We talked for a while." }];
  const dream = weaveDream(slots, new Rng(7));
  assert.ok(dream.length > 0 && dream.length <= 220);
  assert.ok(dream.includes("fixed the lamp") || dream.includes("talked for a while"));
});

// ---------- rng.js ----------
test("Rng is deterministic for a given seed", () => {
  const a = new Rng(42);
  const b = new Rng(42);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test("Rng.range/int/pick/chance stay within bounds", () => {
  const r = new Rng(9);
  for (let i = 0; i < 500; i++) {
    const v = r.range(5, 10);
    assert.ok(v >= 5 && v < 10);
    const n = r.int(0, 5);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 5);
  }
  const arr = ["a", "b", "c"];
  for (let i = 0; i < 50; i++) assert.ok(arr.includes(r.pick(arr)));
  let trues = 0;
  for (let i = 0; i < 2000; i++) if (r.chance(0.3)) trues++;
  assert.ok(trues > 400 && trues < 800, `chance(0.3) over 2000 draws should land near 600, got ${trues}`);
});

test("randomSeed returns a uint32", () => {
  const s = randomSeed();
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
});

// ---------- people.js ----------
test("makeCouple produces a woman, a man, a surname and a primary pick", () => {
  const c = makeCouple(new Rng(3));
  assert.ok(c.woman.name && c.man.name && c.surname);
  assert.equal(c.woman.gender, "f");
  assert.equal(c.man.gender, "m");
  assert.ok(["woman", "man"].includes(c.primary));
  assert.ok(c.woman.look.skin && c.man.look.skin);
});

test("spouseWord maps gender to a relationship word", () => {
  assert.equal(spouseWord("f"), "wife");
  assert.equal(spouseWord("m"), "husband");
  assert.equal(spouseWord("n"), "spouse");
  assert.equal(spouseWord(undefined), "spouse");
});

// ---------- skills.js ----------
test("freshSkills starts everyone at the same baseline", () => {
  const s = freshSkills();
  for (const k of SKILLS) assert.equal(s[k], 4);
});

test("tickSkills grows the skill tied to the current action", () => {
  const agent = { skills: freshSkills(), action: { id: "work" }, room: "desk", moving: false, transit: 0 };
  tickSkills(agent, 10);
  assert.ok(agent.skills.writing > 4);
  assert.ok(agent.skills.coding > 4);
  assert.equal(agent.skills.talking, 4, "talking isn't grown by work");
});

test("tickSkills also grows tinkering/coding for idle time in the game room", () => {
  const agent = { skills: freshSkills(), action: null, room: "game", moving: false, transit: 0 };
  tickSkills(agent, 10);
  assert.ok(agent.skills.tinkering > 4);
  assert.ok(agent.skills.coding > 4);
});

test("tickSkills never exceeds 100 and lazily creates skills if missing", () => {
  const agent = { action: { id: "work" }, room: "desk", moving: false, transit: 0 };
  tickSkills(agent, 1);
  assert.ok(agent.skills, "skills object created on demand");
  agent.skills.writing = 99.99;
  tickSkills(agent, 1000);
  assert.ok(agent.skills.writing <= 100);
});

test("bumpSkill adds a one-off amount, clamped, only for real skills", () => {
  const agent = { skills: freshSkills() };
  bumpSkill(agent, "coding", 10);
  assert.equal(agent.skills.coding, 14);
  bumpSkill(agent, "coding", 1000);
  assert.equal(agent.skills.coding, 100);
  bumpSkill(agent, "not-a-skill", 10); // should not throw or add a bogus key
  assert.equal(agent.skills["not-a-skill"], undefined);
});

test("gates thresholds canMakeGames/canRestyle/richRoutines correctly", () => {
  assert.deepEqual(gates({ coding: 9, tinkering: 7, talking: 24 }), {
    canMakeGames: false,
    canRestyle: false,
    richRoutines: false,
  });
  assert.deepEqual(gates({ coding: 10, tinkering: 8, talking: 25 }), {
    canMakeGames: true,
    canRestyle: true,
    richRoutines: true,
  });
  assert.equal(gates(undefined).canMakeGames, false, "falls back to freshSkills when none given");
});

// ---------- rooms.js ----------
test("ROOM_IDS matches the keys of ROOMS exactly", () => {
  assert.deepEqual([...ROOM_IDS].sort(), Object.keys(ROOMS).sort());
});

test("every room has a spot, a floor rect and a full palette", () => {
  for (const id of ROOM_IDS) {
    const r = ROOMS[id];
    assert.equal(r.id, id);
    assert.ok(Number.isFinite(r.spot.x) && Number.isFinite(r.spot.y));
    assert.ok(r.palette.wall && r.palette.floor && r.palette.accent);
  }
});
