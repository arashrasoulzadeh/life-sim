import { test } from "node:test";
import assert from "node:assert/strict";
import { NEED_IDS } from "../src/sim/constants.js";
import { freshNeeds, decayNeeds, applyEffect, pressure, clamp, lowestNeed } from "../src/sim/needs.js";
import { makeAgent, makePersonality } from "../src/sim/agent.js";
import { Rng } from "../src/engine/rng.js";

test("freshNeeds covers every NEED_IDS entry with a finite value", () => {
  const n = freshNeeds();
  for (const id of NEED_IDS) {
    assert.ok(Number.isFinite(n[id]), `${id} should be a finite number`);
    assert.ok(n[id] >= 0 && n[id] <= 100);
  }
});

test("makeAgent's needs also cover every NEED_IDS entry (regression: it used to hand-duplicate the literal)", () => {
  const rng = new Rng(1);
  const a = makeAgent(rng, {});
  for (const id of NEED_IDS) {
    assert.ok(Number.isFinite(a.needs[id]), `${id} should be finite on a fresh agent`);
  }
});

test("decayNeeds reduces every need over time and never produces NaN", () => {
  const rng = new Rng(2);
  const p = makePersonality(rng);
  const n = freshNeeds();
  for (let i = 0; i < 1000; i++) decayNeeds(n, p, 0.5, false, 1);
  for (const id of NEED_IDS) {
    assert.ok(Number.isFinite(n[id]), `${id} must stay finite after heavy decay`);
    assert.ok(n[id] >= 0 && n[id] <= 100, `${id}=${n[id]} must stay clamped`);
  }
});

test("applyEffect only touches known need ids and clamps to [0,100]", () => {
  const n = { focus: 98, energy: 98, social: 98, curiosity: 98, hunger: 2 };
  applyEffect(n, { focus: 10, hunger: 10, madeUpKey: 999 }, 1);
  assert.equal(n.focus, 100, "clamped at 100");
  assert.equal(n.hunger, 12);
  assert.equal(n.madeUpKey, undefined, "unknown keys are not injected onto needs");
});

test("pressure rises as a need falls, and is highest near 0", () => {
  assert.ok(pressure(90) < pressure(50));
  assert.ok(pressure(50) < pressure(10));
  assert.ok(pressure(0) > pressure(10));
});

test("clamp bounds values to [0,100] by default", () => {
  assert.equal(clamp(-5), 0);
  assert.equal(clamp(150), 100);
  assert.equal(clamp(50), 50);
});

test("lowestNeed finds the actual minimum among NEED_IDS", () => {
  const n = { focus: 80, energy: 80, social: 5, curiosity: 80, hunger: 80 };
  assert.equal(lowestNeed(n).id, "social");
});
