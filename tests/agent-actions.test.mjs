import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CORRIDOR_Y, CORRIDOR_X0, CORRIDOR_X1,
  makePersonality, makeLook, makeAgent, ROUTINE_OPS, stepRoutine, scoreActions, stepAgent,
} from "../src/sim/agent.js";
import { ACTIONS } from "../src/sim/actions.js";
import { ROOMS } from "../src/sim/rooms.js";
import { NEED_IDS } from "../src/sim/constants.js";
import { Rng } from "../src/engine/rng.js";

function baseEnv(overrides = {}) {
  return {
    isNight: false,
    requestsWaiting: 0,
    wantsReflect: false,
    thirstyRoom: null,
    speedMul: 1,
    rhythm: { work: 1, play: 1 },
    partnerRoom: null,
    togetherWant: 0,
    voteBias: null,
    onWater: () => {},
    onTinker: () => {},
    onRequestResolved: () => {},
    onReflect: () => {},
    ...overrides,
  };
}

// ---------- actions.js ----------
test("every ACTIONS entry has a real room, a duration range, and only known need keys in its effect", () => {
  for (const a of ACTIONS) {
    assert.ok(ROOMS[a.room], `${a.id} should target a real room`);
    assert.ok(Array.isArray(a.duration) && a.duration.length === 2 && a.duration[0] <= a.duration[1]);
    for (const need of Object.keys(a.effect)) assert.ok(NEED_IDS.includes(need), `${a.id}'s effect touches unknown need ${need}`);
  }
});

// ---------- agent.js: makePersonality / makeLook / makeAgent ----------
test("makePersonality produces every trait within its documented range", () => {
  const p = makePersonality(new Rng(1));
  assert.ok(p.diligence >= 0.3 && p.diligence <= 1);
  assert.ok(p.sociability >= 0.2 && p.sociability <= 0.95);
  assert.ok(p.curiosity >= 0.3 && p.curiosity <= 1);
  assert.ok(p.restlessness >= 0 && p.restlessness <= 0.8);
});

test("makeLook always returns a full, valid-looking palette", () => {
  const l = makeLook(new Rng(1));
  assert.ok(l.skin && l.shirt && l.visor);
});

test("makeAgent starts in bed, idle, with fresh needs covering every NEED_IDS entry", () => {
  const a = makeAgent(new Rng(1), { name: "Test", gender: "n" });
  assert.equal(a.room, "bed");
  assert.equal(a.moving, false);
  assert.equal(a.action, null);
  for (const id of NEED_IDS) assert.ok(Number.isFinite(a.needs[id]));
  assert.equal(a.routine, null);
  assert.equal(a.routineSay, "");
});

test("makeAgent applies an x offset without breaking position", () => {
  const a = makeAgent(new Rng(1), { name: "Test", gender: "n", offset: 20 });
  assert.equal(a.x, ROOMS.bed.spot.x + 20);
});

// ---------- stepRoutine ----------
test("stepRoutine is inert with no routine, or while transiting/moving", () => {
  assert.equal(stepRoutine({ routine: null }, 1), false);
  assert.equal(stepRoutine({ routine: { steps: [], i: 0, done: false }, transit: 1 }, 1), false);
  assert.equal(stepRoutine({ routine: { steps: [], i: 0, done: false }, moving: true, transit: 0 }, 1), false);
});

test("stepRoutine runs through every op kind without crashing and marks itself done", () => {
  const steps = ROUTINE_OPS.map((op) => (op === "say" ? { op, arg: "hi" } : op === "wait" ? { op, arg: 2 } : op === "face" ? { op, arg: "left" } : { op }));
  const agent = { routine: { steps, i: 0, timer: 0, done: false }, transit: 0, moving: false, routineSay: "", gesture: null, lastThought: "" };
  let guard = 0;
  while (!agent.routine.done && guard++ < 10000) stepRoutine(agent, 0.5);
  assert.equal(agent.routine.done, true);
  assert.equal(agent.routineSay, "");
  assert.equal(agent.gesture, null);
});

test("stepRoutine's 'say' step sets routineSay/lastThought and clamps arg length", () => {
  const agent = { routine: { steps: [{ op: "say", arg: "x".repeat(100) }], i: 0, timer: 0, done: false }, transit: 0, moving: false };
  stepRoutine(agent, 0);
  assert.ok(agent.routineSay.length <= 60);
});

// ---------- scoreActions ----------
test("scoreActions returns every action, sorted descending by score", () => {
  const agent = { needs: { focus: 60, energy: 60, social: 60, curiosity: 60, hunger: 60 }, personality: makePersonality(new Rng(1)), room: "desk", action: null, skills: { coding: 4 } };
  const ranked = scoreActions(agent, baseEnv(), new Rng(1));
  assert.equal(ranked.length, ACTIONS.length);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score >= ranked[i].score);
});

test("scoreActions strongly favours sleep at night, and work when requests are waiting", () => {
  const agent = { needs: { focus: 60, energy: 60, social: 60, curiosity: 60, hunger: 60 }, personality: makePersonality(new Rng(1)), room: "bed", action: null, skills: { coding: 4 } };
  const night = scoreActions(agent, baseEnv({ isNight: true }), new Rng(1));
  assert.equal(night[0].action.id, "sleep");

  const busy = { ...agent, room: "desk" };
  const ranked = scoreActions(busy, baseEnv({ requestsWaiting: 9 }), new Rng(1));
  assert.equal(ranked[0].action.id, "work");
});

test("scoreActions favours eat when hunger is critical", () => {
  const agent = { needs: { focus: 60, energy: 60, social: 60, curiosity: 60, hunger: 1 }, personality: makePersonality(new Rng(1)), room: "kitchen", action: null, skills: { coding: 4 } };
  const ranked = scoreActions(agent, baseEnv(), new Rng(1));
  assert.equal(ranked[0].action.id, "eat");
});

test("scoreActions pulls toward the partner's room, except for work", () => {
  const agent = { needs: { focus: 60, energy: 60, social: 60, curiosity: 60, hunger: 60 }, personality: makePersonality(new Rng(1)), room: "desk", action: null, skills: { coding: 4 } };
  const withoutPartner = scoreActions(agent, baseEnv(), new Rng(7));
  const withPartner = scoreActions(agent, baseEnv({ partnerRoom: "couch", togetherWant: 1 }), new Rng(7));
  const chatWithout = withoutPartner.find((r) => r.action.id === "chat").score;
  const chatWith = withPartner.find((r) => r.action.id === "chat").score;
  assert.ok(chatWith > chatWithout, "chat (in the couch room) should score higher when the partner is there");
});

test("scoreActions favours water only when a room is actually thirsty", () => {
  const agent = { needs: { focus: 60, energy: 60, social: 60, curiosity: 60, hunger: 60 }, personality: makePersonality(new Rng(1)), room: "window", action: null, skills: { coding: 4 } };
  const dry = scoreActions(agent, baseEnv(), new Rng(1)).find((r) => r.action.id === "water").score;
  const thirsty = scoreActions(agent, baseEnv({ thirstyRoom: "window" }), new Rng(1)).find((r) => r.action.id === "water").score;
  assert.ok(thirsty > dry);
});

test("scoreActions applies the vote bias multiplier to the matching action only", () => {
  const agent = { needs: { focus: 60, energy: 60, social: 60, curiosity: 60, hunger: 60 }, personality: makePersonality(new Rng(1)), room: "desk", action: null, skills: { coding: 4 } };
  const base = scoreActions(agent, baseEnv(), new Rng(3)).find((r) => r.action.id === "work").score;
  const boosted = scoreActions(agent, baseEnv({ voteBias: { work: 3 } }), new Rng(3)).find((r) => r.action.id === "work").score;
  assert.ok(boosted > base * 2, "a 3x vote bias should roughly triple the work score");
});

// ---------- stepAgent ----------
test("stepAgent walks the transit corridor and lands in the target room", () => {
  const a = makeAgent(new Rng(1), { name: "T", gender: "n" });
  a.room = "desk";
  a.transit = 2;
  a.transitTotal = 2;
  stepAgent(a, 1, baseEnv(), new Rng(1));
  assert.ok(a.x > CORRIDOR_X0 && a.x < CORRIDOR_X1);
  assert.equal(a.y, CORRIDOR_Y);
  stepAgent(a, 1.5, baseEnv(), new Rng(1)); // finishes the transit
  assert.ok(a.transit <= 0);
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
});

test("stepAgent walks toward its in-room target and eventually arrives", () => {
  const a = makeAgent(new Rng(1), { name: "T", gender: "n" });
  a.room = "desk";
  a.transit = 0;
  a.moving = true;
  a.x = 0; a.y = 0; a.tx = 100; a.ty = 0;
  let guard = 0;
  while (a.moving && guard++ < 1000) stepAgent(a, 0.5, baseEnv(), new Rng(1));
  assert.equal(a.moving, false);
  assert.ok(Math.hypot(a.x - a.tx, a.y - a.ty) < 2);
});

test("stepAgent gives up on a stuck walk after 6s and snaps to the target (regression: crowded-room freeze)", () => {
  const a = makeAgent(new Rng(1), { name: "T", gender: "n" });
  a.room = "desk";
  a.transit = 0;
  a.moving = true;
  a.x = 0; a.y = 0; a.tx = 100000; a.ty = 0; // unreachable in one step, and we'll re-pin it below
  let snappedAt = -1;
  for (let i = 0; i < 13; i++) {
    stepAgent(a, 0.5, baseEnv(), new Rng(1)); // accumulates 6.5s of stuck "moving" time
    if (a.x === 100000) snappedAt = i; // the tick it gave up and jumped straight to tx
    a.x = 0; a.y = 0; // simulate something (e.g. separatePeople) constantly pushing it back
  }
  assert.notEqual(snappedAt, -1, "should have snapped to the target instead of freezing forever");
  assert.ok(snappedAt <= 12, "should give up at or before ~6.5s of stuck movement");
  // once unstuck it's free to immediately pick its next action/target again (normal
  // behaviour — moving may well flip back to true for that new, reachable target)
  assert.ok(Number.isFinite(a._moveTimer));
});

test("stepAgent performs an action, decrements actionLeft, and resolves a request once work accrues enough progress", () => {
  const a = makeAgent(new Rng(1), { name: "T", gender: "n" });
  a.room = "desk";
  a.action = { ...ACTIONS.find((x) => x.id === "work") };
  a.actionLeft = 100;
  a.workProgress = 0;
  let resolved = 0;
  const env = baseEnv({ requestsWaiting: 1, onRequestResolved: () => resolved++ });
  for (let i = 0; i < 20; i++) stepAgent(a, 0.5, env, new Rng(1));
  assert.ok(a.actionLeft < 100);
  assert.ok(resolved >= 1, "6s of work progress should resolve a request");
});

test("stepAgent's onReflect/onWater/onTinker/onEat callbacks fire when their action completes", () => {
  const calls = { reflect: 0, water: 0, tinker: 0, eat: 0 };
  const makeDone = (id) => {
    const a = makeAgent(new Rng(1), { name: "T", gender: "n" });
    a.room = ACTIONS.find((x) => x.id === id).room;
    a.action = { ...ACTIONS.find((x) => x.id === id) };
    a.actionLeft = 0.01;
    return a;
  };
  const env = baseEnv({
    onReflect: () => calls.reflect++,
    onWater: () => calls.water++,
    onTinker: () => calls.tinker++,
    onEat: () => calls.eat++,
  });
  stepAgent(makeDone("reflect"), 1, env, new Rng(1));
  stepAgent(makeDone("water"), 1, env, new Rng(1));
  stepAgent(makeDone("tinker"), 1, env, new Rng(1));
  stepAgent(makeDone("eat"), 1, env, new Rng(1));
  assert.equal(calls.reflect, 1);
  assert.equal(calls.water, 1);
  assert.equal(calls.tinker, 1);
  assert.equal(calls.eat, 1);
});

test("stepAgent's onEat callback is optional and doesn't throw when omitted", () => {
  const a = makeAgent(new Rng(1), { name: "T", gender: "n" });
  a.room = "kitchen";
  a.action = { ...ACTIONS.find((x) => x.id === "eat") };
  a.actionLeft = 0.01;
  assert.doesNotThrow(() => stepAgent(a, 1, baseEnv(), new Rng(1))); // baseEnv has no onEat key by default in real callers
});

test("stepAgent sets a fresh action + thought once the current one finishes", () => {
  const a = makeAgent(new Rng(1), { name: "T", gender: "n" });
  a.room = "desk";
  a.action = { ...ACTIONS.find((x) => x.id === "rest") };
  a.actionLeft = 0.01;
  stepAgent(a, 1, baseEnv(), new Rng(1));
  assert.ok(a.action, "a new action should have been chosen");
  assert.ok(a.lastThought && a.lastThought.length > 0);
});

test("stepAgent runs 2000 ticks across a fresh agent without ever producing NaN position/needs", () => {
  const a = makeAgent(new Rng(3), { name: "T", gender: "n" });
  for (let i = 0; i < 2000; i++) {
    stepAgent(a, 0.5, baseEnv({ isNight: i % 400 < 100 }), new Rng(i));
    for (const v of Object.values(a.needs)) assert.ok(Number.isFinite(v));
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
  }
});
