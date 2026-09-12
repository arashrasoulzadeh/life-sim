import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiving, ensurePlants, tickPlants, plantsNewDay, thirstyIn, water, plantGlyph, plantWater } from "../src/sim/plants.js";
import { ensureWear, tickWear, conditionFactor, isBroken, brokenInRoom, repairCost, repair, tinkerFix, wearGlyph, wearPct } from "../src/sim/wear.js";
import { upkeepPerDay, freshFinances, chargeDay, economyMods, financeLine, RENT, RENT_EVERY, RENT_GRACE_DAY, DAILY_REWARD } from "../src/sim/economy.js";
import { freshPet, ensurePet, stepPet, petBond, namePet, petGlyph, petLabel } from "../src/sim/pet.js";
import { OBJECT_IDS_BY_ROOM, OBJECTS } from "../src/sim/marketplace.js";
import { Rng } from "../src/engine/rng.js";
import { createWorld, tick } from "../src/sim/world.js";

function plantId() {
  return Object.keys(OBJECTS).find((id) => isLiving(id));
}
function applianceId(room) {
  return (OBJECT_IDS_BY_ROOM[room] || []).find((id) => OBJECTS[id].cat === "appliance");
}

// ---------- plants.js ----------
test("isLiving matches plant-ish labels only", () => {
  const pid = plantId();
  assert.ok(pid, "catalog should contain at least one living item");
  assert.equal(isLiving(pid), true);
  assert.equal(isLiving("no-such-id"), false);
});

test("ensurePlants creates entries for living items and prunes removed ones", () => {
  const pid = plantId();
  const room = OBJECTS[pid].room;
  const w = { day: 1, rooms: { [room]: [pid] }, plants: {} };
  ensurePlants(w);
  assert.ok(w.plants[`${room}:${pid}`]);
  w.rooms[room] = [];
  ensurePlants(w);
  assert.equal(w.plants[`${room}:${pid}`], undefined);
});

test("tickPlants dries water proportionally to sim time / day length", () => {
  const pid = plantId();
  const room = OBJECTS[pid].room;
  const w = { day: 1, rooms: { [room]: [pid] }, plants: {} };
  ensurePlants(w);
  const before = w.plants[`${room}:${pid}`].water;
  tickPlants(w, 600, 600); // a full day's worth of seconds
  assert.ok(w.plants[`${room}:${pid}`].water < before);
});

test("plantsNewDay kills a plant after 2 consecutive dry days and removes it from the room", () => {
  const pid = plantId();
  const room = OBJECTS[pid].room;
  const w = { day: 1, rooms: { [room]: [pid] }, plants: { [`${room}:${pid}`]: { water: 2, since: 1, dryDays: 1 } } };
  const dead = plantsNewDay(w);
  assert.deepEqual(dead, [`${room}:${pid}`]);
  assert.equal(w.rooms[room].includes(pid), false);
  assert.equal(w.plants[`${room}:${pid}`], undefined);
});

test("plantsNewDay resets dryDays once watered, survives", () => {
  const pid = plantId();
  const room = OBJECTS[pid].room;
  const w = { day: 1, rooms: { [room]: [pid] }, plants: { [`${room}:${pid}`]: { water: 80, since: 1, dryDays: 1 } } };
  const dead = plantsNewDay(w);
  assert.deepEqual(dead, []);
  assert.equal(w.plants[`${room}:${pid}`].dryDays, 0);
});

test("thirstyIn / water() find and refill a low plant", () => {
  const pid = plantId();
  const room = OBJECTS[pid].room;
  const w = { day: 1, rooms: { [room]: [pid] }, plants: { [`${room}:${pid}`]: { water: 20, dryDays: 0 } } };
  assert.equal(thirstyIn(w, room), pid);
  const label = water(w, room);
  assert.equal(label, OBJECTS[pid].label);
  assert.equal(w.plants[`${room}:${pid}`].water, 100);
  assert.equal(thirstyIn(w, room), null);
});

test("plantGlyph swaps in a wilt glyph below thresholds, else the base glyph", () => {
  const plants = { "kitchen:x": { water: 5 }, "kitchen:y": { water: 30 }, "kitchen:z": { water: 80 } };
  assert.equal(plantGlyph(plants, "kitchen", "x", "🌿"), "🥀");
  assert.equal(plantGlyph(plants, "kitchen", "y", "🌿"), "🥬");
  assert.equal(plantGlyph(plants, "kitchen", "z", "🌿"), "🌿");
  assert.equal(plantGlyph(plants, "kitchen", "none", "🌿"), "🌿");
});

test("plantWater rounds or returns null", () => {
  const plants = { "kitchen:x": { water: 33.6 } };
  assert.equal(plantWater(plants, "kitchen", "x"), 34);
  assert.equal(plantWater(plants, "kitchen", "nope"), null);
});

// ---------- wear.js ----------
test("ensureWear seeds every owned object at 100 and prunes removed ones", () => {
  const w = { rooms: { desk: ["a", "b"] }, wear: {} };
  ensureWear(w);
  assert.equal(w.wear["desk:a"], 100);
  assert.equal(w.wear["desk:b"], 100);
  w.rooms.desk = ["a"];
  ensureWear(w);
  assert.equal(w.wear["desk:b"], undefined);
});

test("tickWear decays appliances faster than plain objects", () => {
  const app = applianceId("kitchen");
  const other = (OBJECT_IDS_BY_ROOM.kitchen || []).find((id) => OBJECTS[id].cat !== "appliance");
  const w = { rooms: { kitchen: [app, other] }, wear: {} };
  ensureWear(w);
  tickWear(w, 600, 600);
  assert.ok(w.wear[`kitchen:${app}`] < w.wear[`kitchen:${other}`], "appliance should wear faster");
});

test("conditionFactor is 1 above WORN_AT, 0 below BROKEN_AT, ramps between", () => {
  const w = { wear: { "r:a": 100, "r:b": 10, "r:c": 40 } };
  assert.equal(conditionFactor(w, "r", "a"), 1);
  assert.equal(conditionFactor(w, "r", "b"), 0);
  const mid = conditionFactor(w, "r", "c");
  assert.ok(mid > 0 && mid < 1);
  assert.equal(conditionFactor(w, "r", "missing"), 1, "no wear entry -> treated as fine");
});

test("isBroken flags anything under BROKEN_AT", () => {
  const w = { wear: { "r:a": 10, "r:b": 90 } };
  assert.equal(isBroken(w, "r", "a"), true);
  assert.equal(isBroken(w, "r", "b"), false);
  assert.equal(isBroken(w, "r", "missing"), false);
});

test("brokenInRoom picks the single worst broken item in that room, or null", () => {
  const w = { rooms: { desk: ["a", "b", "c"] }, wear: { "desk:a": 90, "desk:b": 5, "desk:c": 15 } };
  assert.equal(brokenInRoom(w, "desk"), "b");
  const fine = { rooms: { desk: ["a"] }, wear: { "desk:a": 90 } };
  assert.equal(brokenInRoom(fine, "desk"), null);
});

test("repairCost scales with price and how broken it is; repair() resets to 100", () => {
  const id = Object.keys(OBJECTS)[0];
  const room = OBJECTS[id].room;
  const w = { rooms: { [room]: [id] }, wear: { [`${room}:${id}`]: 20 } };
  const cost = repairCost(w, room, id);
  assert.ok(cost >= 5);
  const label = repair(w, room, id);
  assert.equal(label, OBJECTS[id].label);
  assert.equal(w.wear[`${room}:${id}`], 100);
  assert.equal(repair(w, room, "missing"), null);
});

test("tinkerFix nudges the room's most-broken item up, returns null if nothing's broken", () => {
  const w = { rooms: { desk: ["a"] }, wear: { "desk:a": 10 } };
  const label = tinkerFix(w, "desk", 25);
  assert.equal(w.wear["desk:a"], 35);
  assert.ok(label);
  const fine = { rooms: { desk: ["a"] }, wear: { "desk:a": 90 } };
  assert.equal(tinkerFix(fine, "desk"), null);
});

test("wearGlyph/wearPct read a plain wear map without mutating", () => {
  const wear = { "desk:a": 10, "desk:b": 90 };
  assert.equal(wearGlyph(wear, "desk", "a", "X"), "🩹");
  assert.equal(wearGlyph(wear, "desk", "b", "X"), "X");
  assert.equal(wearPct(wear, "desk", "a"), 10);
  assert.equal(wearPct(wear, "desk", "missing"), null);
});

// ---------- economy.js ----------
test("upkeepPerDay grows with appliances, a pet, and extra residents", () => {
  const app = applianceId("kitchen");
  const bare = { rooms: { kitchen: [] }, pet: null, extras: [] };
  const withStuff = { rooms: { kitchen: [app] }, pet: { name: "Tom" }, extras: [{}, {}] };
  assert.ok(upkeepPerDay(withStuff) > upkeepPerDay(bare));
});

test("chargeDay pays the daily reward, charges upkeep, and skips rent before RENT_GRACE_DAY", () => {
  const w = { day: 2, bank: 100, finances: freshFinances(), memory: { slots: [], nextId: 1, total: 0 }, fx: [], extras: [] };
  const lines = chargeDay(w);
  assert.ok(lines.some((l) => l.kind === "reward" && l.amount === DAILY_REWARD));
  assert.ok(lines.some((l) => l.kind === "upkeep" && l.amount < 0));
  assert.equal(lines.some((l) => l.kind === "rent"), false, "too early for rent");
});

test("chargeDay charges rent once due, and records a missed-rent memory when the bank can't cover it", () => {
  const w = { day: RENT_GRACE_DAY, bank: 3, finances: freshFinances(), memory: { slots: [], nextId: 1, total: 0 }, fx: [], extras: [] };
  const lines = chargeDay(w);
  const rentLine = lines.find((l) => l.kind === "rent");
  assert.ok(rentLine);
  assert.equal(rentLine.amount, 0, "couldn't afford it");
  assert.equal(w.finances.missedRent, 1);
  assert.equal(w.memory.slots.length, 1);
});

test("chargeDay pays rent when affordable and flips broke on/off with an fx event", () => {
  const w = { day: RENT_GRACE_DAY, bank: 200, finances: freshFinances(), memory: { slots: [], nextId: 1, total: 0 }, fx: [], extras: [] };
  chargeDay(w);
  assert.equal(w.finances.broke, false);

  // bank low enough that even after the +DAILY_REWARD it stays under the broke threshold
  const goingBroke = { day: 2, bank: -45, finances: freshFinances(), memory: { slots: [], nextId: 1, total: 0 }, fx: [], extras: [] };
  chargeDay(goingBroke);
  assert.equal(goingBroke.finances.broke, true);
  assert.equal(goingBroke.fx.includes("event"), true);
});

test("economyMods only bites when broke, and eases buying with a cushion", () => {
  const fine = economyMods({ finances: { broke: false } });
  assert.deepEqual(fine, { work: 1, buyAllowed: true, mood: 0 });
  const broke = economyMods({ day: 10, bank: 50, finances: { broke: true, brokeSince: 5 } });
  assert.ok(broke.work > 1);
  assert.equal(broke.buyAllowed, true, "cushion over 40 still allows a modest buy");
  const brokeAndTight = economyMods({ day: 10, bank: 10, finances: { broke: true, brokeSince: 5 } });
  assert.equal(brokeAndTight.buyAllowed, false);
});

test("financeLine reports upkeep, rent countdown, housemates and broke state", () => {
  const w = { day: 3, rooms: {}, pet: null, extras: [{ income: 10 }], finances: { broke: true, lastRentDay: 0, missedRent: 2 } };
  const line = financeLine(w);
  assert.ok(line.includes("upkeep"));
  assert.ok(line.includes(`rent ${RENT}c`));
  assert.ok(line.includes("housemates"));
  assert.ok(line.includes("BROKE"));
  assert.ok(line.includes("2 rent missed"));
});

// ---------- pet.js ----------
test("freshPet starts on the couch with a name-less state", () => {
  const p = freshPet(new Rng(1));
  assert.equal(p.room, "couch");
  assert.equal(p.name, "");
  assert.equal(p.state, "roam");
});

test("ensurePet lazily creates one if missing, otherwise reuses it", () => {
  const w = {};
  const p1 = ensurePet(w, new Rng(1));
  assert.equal(w.pet, p1);
  const p2 = ensurePet(w, new Rng(2));
  assert.equal(p2, p1);
});

test("stepPet glides toward its target then eventually picks a new state without crashing", () => {
  const w = { pet: freshPet(new Rng(1)), agent: { room: "desk", transit: 0 }, isNight: false };
  for (let i = 0; i < 2000; i++) stepPet(w, 0.5, new Rng(i));
  assert.ok(["roam", "nap", "follow", "play", "sleep"].includes(w.pet.state));
  assert.ok(Number.isFinite(w.pet.x) && Number.isFinite(w.pet.y));
});

test("stepPet sleeps at night, in bed or on the couch", () => {
  const w = { pet: freshPet(new Rng(1)), agent: { room: "desk", transit: 0 }, isNight: true };
  w.pet.timer = 0;
  w.pet.x = w.pet.tx;
  w.pet.y = w.pet.ty; // force the decision branch
  stepPet(w, 0.001, new Rng(5));
  assert.equal(w.pet.state, "sleep");
  assert.ok(["bed", "couch"].includes(w.pet.room));
});

test("petBond raises bond, clamped at 1; no-op with no pet", () => {
  const w = { pet: { bond: 0.98 } };
  petBond(w, 0.5);
  assert.equal(w.pet.bond, 1);
  assert.doesNotThrow(() => petBond({}, 0.1));
});

test("namePet sanitizes, only announces the first time it's named", () => {
  const w = { day: 5, pet: freshPet(new Rng(1)) };
  assert.equal(namePet(w, 42), null);
  const first = namePet(w, "  <b>Mochi</b>  ");
  assert.equal(first, "bMochi/b");
  assert.equal(w.pet.name, "bMochi/b");
  assert.equal(w.pet.namedDay, 5);
  const second = namePet(w, "Biscuit");
  assert.equal(second, null, "renaming isn't announced");
  assert.equal(w.pet.name, "Biscuit");
});

test("petGlyph/petLabel degrade gracefully with no pet", () => {
  assert.equal(petGlyph(null), "🐈");
  assert.equal(petLabel(null), "a cat");
  assert.equal(petLabel({ name: "" }), "the cat");
  assert.equal(petLabel({ name: "Mochi" }), "Mochi");
  assert.equal(petGlyph({ state: "nap" }), "😽");
});

// ---------- a light integration sanity check across all four together ----------
test("a full tick() run exercises plants/wear/economy/pet without throwing or producing NaN", () => {
  const w = createWorld("integration-plants-wear-econ-pet");
  for (let i = 0; i < 5000; i++) tick(w, 0.5);
  assert.ok(Number.isFinite(w.bank));
  assert.ok(Number.isFinite(w.pet.x));
  for (const v of Object.values(w.wear)) assert.ok(Number.isFinite(v));
});
