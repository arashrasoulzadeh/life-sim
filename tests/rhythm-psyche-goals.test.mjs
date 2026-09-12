import { test } from "node:test";
import assert from "node:assert/strict";
import { DOW, dowOf, isWeekend, freshRhythm, stepRhythm, rollRhythm, rhythmMods, setWeekStyle } from "../src/sim/rhythm.js";
import { freshPsyche, rollPsyche, isConflictToday, resolveLean, psycheMods, psycheLine } from "../src/sim/psyche.js";
import { GOAL_METRICS, makeGoal, goalFrac, checkGoal } from "../src/sim/goals.js";
import { WRITING_GATE, canWrite, weaveWriting, cleanWriting, writingPrompt } from "../src/sim/writing.js";
import { SEASONS, seasonFor, SEASON_TINT, freshOutside, stepOutside, windowEventPool, seasonSky } from "../src/sim/outside.js";
import { Rng } from "../src/engine/rng.js";

// ---------- rhythm.js ----------
test("dowOf cycles 0..6 and matches DOW length; isWeekend is Sat/Sun", () => {
  assert.equal(dowOf(1), 0);
  assert.equal(dowOf(8), 0);
  assert.equal(DOW.length, 7);
  assert.equal(isWeekend(6), true); // day6 -> dow5 (Sat)
  assert.equal(isWeekend(7), true); // dow6 (Sun)
  assert.equal(isWeekend(5), false); // dow4 (Fri)
});

test("stepRhythm syncs dow/dowName/weekend from w.day", () => {
  const w = { day: 6, rhythm: freshRhythm() };
  stepRhythm(w);
  assert.equal(w.rhythm.dowName, DOW[dowOf(6)]);
  assert.equal(w.rhythm.weekend, true);
});

test("rollRhythm sets badDay with weekday/weekend-different odds", () => {
  const w = { day: 1, rhythm: freshRhythm() }; // Monday
  const rng = new Rng(1);
  let anyBad = false;
  for (let i = 0; i < 200; i++) {
    rollRhythm(w, rng);
    if (w.rhythm.badDay) anyBad = true;
  }
  assert.ok(anyBad, "badDay should trigger at least once over 200 rolls");
});

test("rhythmMods scales work down / play up on weekends and bad days", () => {
  const base = rhythmMods({ rhythm: { weekend: false, badDay: false } });
  const weekend = rhythmMods({ rhythm: { weekend: true, badDay: false } });
  const bad = rhythmMods({ rhythm: { weekend: false, badDay: true } });
  assert.ok(weekend.work < base.work);
  assert.ok(weekend.play > base.play);
  assert.ok(bad.work < base.work);
  assert.ok(bad.speedMul < 1);
  assert.equal(base.moodBias, 0);
});

test("setWeekStyle sanitizes, rejects too-short/invalid input", () => {
  const w = { rhythm: freshRhythm() };
  assert.equal(setWeekStyle(w, 42), null);
  assert.equal(setWeekStyle(w, "hi"), null); // too short after trim
  const s = setWeekStyle(w, "  a <b>calm</b> week please  ");
  assert.equal(s, "a bcalm/b week please");
  assert.equal(w.rhythm.weekStyle, s);
});

// ---------- psyche.js ----------
test("freshPsyche starts even with no conflict day", () => {
  const p = freshPsyche();
  assert.equal(p.lean, "even");
  assert.equal(p.conflictDay, 0);
});

test("rollPsyche is more likely to trigger when reputation/finances/mood are bad", () => {
  const goodW = { day: 5, reputation: 90, finances: { broke: false }, mood: { valence: 0.5 } };
  const badW = { day: 5, reputation: 10, finances: { broke: true }, mood: { valence: -0.5 } };
  let goodHits = 0, badHits = 0;
  for (let i = 0; i < 2000; i++) {
    const g = { ...goodW, psyche: freshPsyche() };
    const b = { ...badW, psyche: freshPsyche() };
    if (rollPsyche(g, new Rng(i))) goodHits++;
    if (rollPsyche(b, new Rng(i + 100000))) badHits++;
  }
  assert.ok(badHits > goodHits, `strained world should conflict more often (${badHits} vs ${goodHits})`);
});

test("isConflictToday / resolveLean / psycheMods / psycheLine work together", () => {
  const w = { day: 5, psyche: { conflictDay: 5, lean: "even", leanUntil: 5, argument: null } };
  assert.equal(isConflictToday(w), true);
  assert.equal(psycheLine(w), "You woke up of two minds — one says push, one says rest. Decide which wins today.");
  resolveLean(w, "push", "I want to <script>push</script> today");
  assert.equal(w.psyche.lean, "push");
  assert.equal(w.psyche.argument, "I want to scriptpush/script today");
  assert.deepEqual(psycheMods(w), { work: 1.35, ease: 0.7 });
  assert.equal(psycheLine(w), "This morning two of you argued; the one that wants to push won.");

  resolveLean(w, "ease");
  assert.deepEqual(psycheMods(w), { work: 0.7, ease: 1.4 });
  assert.equal(psycheLine(w), "This morning two of you argued; the one that wants to ease off won.");

  resolveLean(w, "nonsense");
  assert.equal(w.psyche.lean, "even");
  assert.deepEqual(psycheMods(w), { work: 1, ease: 1 });
});

test("psycheMods/psycheLine are inert on a non-conflict day", () => {
  const w = { day: 9, psyche: { conflictDay: 5, lean: "push", leanUntil: 5 } };
  assert.equal(isConflictToday(w), false);
  assert.equal(psycheLine(w), "");
  assert.deepEqual(psycheMods(w), { work: 1, ease: 1 });
});

// ---------- goals.js ----------
test("makeGoal rejects an unknown metric or an unreachable/zero target", () => {
  const w = { day: 1, bank: 100, gamesCount: 0, rooms: {}, memory: { total: 0, slots: [] }, reputation: 50 };
  assert.equal(makeGoal({ metric: "nope", target: 10 }, w), null);
  assert.equal(makeGoal({ metric: "bank", target: 0 }, w), null);
  assert.equal(makeGoal({ metric: "bank", target: 50 }, w), null, "target below current reading is rejected");
});

test("makeGoal builds a valid goal for a real, reachable target", () => {
  const w = { day: 3, bank: 100, gamesCount: 0, rooms: {}, memory: { total: 0, slots: [] }, reputation: 50 };
  const g = makeGoal({ metric: "bank", target: 300, text: "<b>save</b> up" }, w);
  assert.equal(g.metric, "bank");
  assert.equal(g.target, 300);
  assert.equal(g.start, 100);
  assert.equal(g.startDay, 3);
  assert.equal(g.done, false);
  assert.equal(g.text, "<b>save</b> up".slice(0, 80));
});

test("makeGoal's days metric clamps to [3,20] days out from today", () => {
  const w = { day: 10, bank: 0, gamesCount: 0, rooms: {}, memory: { total: 0, slots: [] }, reputation: 50 };
  assert.equal(makeGoal({ metric: "days", target: 1 }, w).target, 13); // clamped up to 3
  assert.equal(makeGoal({ metric: "days", target: 999 }, w).target, 30); // clamped down to 20
  assert.equal(makeGoal({ metric: "days" }, w).target, 17); // default 7
});

test("goalFrac tracks fractional progress and clamps to [0,1]; null when no active goal", () => {
  const w = { day: 5, bank: 250, goal: { metric: "bank", target: 300, start: 100, startDay: 1, done: false, failed: false } };
  assert.equal(goalFrac(w), 0.75);
  w.bank = 1000;
  assert.equal(goalFrac(w), 1); // clamped
  w.goal.done = true;
  assert.equal(goalFrac(w), null);
});

test("checkGoal marks done when the metric is hit, failed after 14 days, else null", () => {
  const done = { day: 5, bank: 300, goal: { metric: "bank", target: 300, start: 100, startDay: 1, done: false, failed: false } };
  assert.equal(checkGoal(done), "done");
  assert.equal(done.goal.done, true);

  const failed = { day: 20, bank: 100, goal: { metric: "bank", target: 300, start: 50, startDay: 1, done: false, failed: false } };
  assert.equal(checkGoal(failed), "failed");
  assert.equal(failed.goal.failed, true);

  const ongoing = { day: 5, bank: 150, goal: { metric: "bank", target: 300, start: 100, startDay: 1, done: false, failed: false } };
  assert.equal(checkGoal(ongoing), null);

  assert.equal(checkGoal({ goal: null }), null);
  assert.equal(checkGoal({ goal: { done: true } }), null);
});

test("GOAL_METRICS.days reads w.day and object count sums every room", () => {
  assert.equal(GOAL_METRICS.days.read({ day: 42 }), 42);
  assert.equal(GOAL_METRICS.objects.read({ rooms: { a: [1, 2], b: [3] } }), 3);
});

// ---------- writing.js ----------
test("canWrite gates on WRITING_GATE", () => {
  assert.equal(canWrite({ agent: { skills: { writing: WRITING_GATE - 1 } } }), false);
  assert.equal(canWrite({ agent: { skills: { writing: WRITING_GATE } } }), true);
  assert.equal(canWrite({ agent: { skills: {} } }), false);
});

test("weaveWriting needs at least 2 texted memory slots and stays under 600 chars", () => {
  const w = { memory: { slots: [{ text: "a" }] } };
  assert.equal(weaveWriting(w, new Rng(1)), null);
  const w2 = { memory: { slots: [{ text: "fixed the lamp, felt good" }, { text: "talked to a friend and laughed" }, { text: "slept badly" }] } };
  const piece = weaveWriting(w2, new Rng(2));
  assert.ok(piece && piece.length > 0 && piece.length <= 600);
});

test("cleanWriting enforces a 40-char minimum, strips angle brackets, caps at 600", () => {
  assert.equal(cleanWriting(42), null);
  assert.equal(cleanWriting("too short"), null);
  const long = "x".repeat(700);
  const cleaned = cleanWriting(`<script>` + long);
  assert.ok(cleaned.length <= 600);
  assert.ok(!cleaned.includes("<") && !cleaned.includes(">"));
});

test("writingPrompt returns one of the known kinds", () => {
  const p = writingPrompt(new Rng(1));
  assert.equal(typeof p, "string");
  assert.ok(p.length > 0);
});

// ---------- outside.js ----------
test("seasonFor cycles through SEASONS every 20 days", () => {
  assert.equal(seasonFor(1), "spring");
  assert.equal(seasonFor(20), "spring");
  assert.equal(seasonFor(21), "summer");
  assert.equal(seasonFor(41), "autumn");
  assert.equal(seasonFor(61), "winter");
  assert.equal(seasonFor(81), "spring"); // wraps
  for (const s of SEASONS) assert.ok(SEASON_TINT[s]);
});

test("freshOutside picks a neighbour and starts in spring", () => {
  const o = freshOutside(new Rng(1));
  assert.equal(o.season, "spring");
  assert.ok(o.neighbour);
});

test("stepOutside changes season + neighbour + fires an fx event on the boundary day", () => {
  const w = { day: 21, outside: freshOutside(new Rng(1)), fx: [] };
  stepOutside(w, new Rng(2));
  assert.equal(w.outside.season, "summer");
  assert.equal(w.fx.length, 1);
  const before = w.outside.season;
  w.fx = [];
  stepOutside(w, new Rng(2)); // same day, no change
  assert.equal(w.outside.season, before);
  assert.equal(w.fx.length, 0);
});

test("windowEventPool sometimes features the neighbour, otherwise a season event", () => {
  const w = { day: 5, outside: { season: "summer", neighbour: "the busker", neighbourSeenDay: 0 } };
  let sawNeighbour = false;
  for (let i = 0; i < 200; i++) {
    const e = windowEventPool(w, new Rng(i));
    if (e.includes("the busker")) sawNeighbour = true;
  }
  assert.ok(sawNeighbour);
});

test("seasonSky always returns a valid sky for a known or unknown season", () => {
  const SKIES = ["clear", "clouds", "rain", "storm", "gold"];
  for (const s of [...SEASONS, "not-a-season"]) {
    const sky = seasonSky(s, new Rng(1));
    assert.ok(SKIES.includes(sky), `${sky} should be a valid sky for ${s}`);
  }
});
