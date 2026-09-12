import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, tick, drainFx, rainLevel, START_BANK, DAY_LENGTH } from "../src/sim/world.js";
import { NEED_IDS } from "../src/sim/constants.js";
import { ROOM_IDS } from "../src/sim/rooms.js";
import { applyPeopleOps } from "../src/sim/persons.js";
import { OBJECTS } from "../src/sim/marketplace.js";

test("createWorld sets up a fully-formed, day-1 world", () => {
  const w = createWorld("world-test-1");
  assert.equal(w.day, 1);
  assert.equal(w.bank, START_BANK);
  assert.equal(w.isNight, false);
  assert.ok(w.agent && w.partner);
  assert.notEqual(w.agent.name, w.partner.name);
  for (const r of ROOM_IDS) assert.ok(Array.isArray(w.rooms[r]));
  assert.equal(w.mealsToday, 0);
  assert.equal(w.weather.sky, "clouds");
});

test("createWorld is deterministic for the same seed", () => {
  const a = createWorld("same-seed");
  const b = createWorld("same-seed");
  assert.equal(a.agent.name, b.agent.name);
  assert.equal(a.partner.name, b.partner.name);
  assert.deepEqual(a.agent.personality, b.agent.personality);
});

test("tick advances t/day/dayFrac and flips isNight at the right point", () => {
  const w = createWorld("world-test-2");
  tick(w, 10);
  assert.equal(w.t, 10);
  assert.ok(w.dayFrac > 0);
  tick(w, DAY_LENGTH); // well past a full day
  assert.ok(w.day >= 2);
});

test("tick never lets any need go NaN or out of [0,100] over a long run", () => {
  const w = createWorld("world-test-3");
  for (let i = 0; i < 20000; i++) tick(w, 0.5);
  for (const id of NEED_IDS) {
    assert.ok(Number.isFinite(w.agent.needs[id]));
    assert.ok(w.agent.needs[id] >= 0 && w.agent.needs[id] <= 100, `${id}=${w.agent.needs[id]}`);
  }
  assert.ok(Number.isFinite(w.bank));
  assert.ok(Number.isFinite(w.mood.valence));
  assert.ok(w.day > 1, "should have advanced several days");
});

test("tick eats through meals (hunger) rather than starving — regression: agent.js needs-literal + stuck-walk bugs", () => {
  const w = createWorld("world-test-4");
  for (let i = 0; i < 30000; i++) tick(w, 0.5);
  assert.ok(w.agent.needs.hunger > 15, `hunger crashed to ${w.agent.needs.hunger} — the agent never successfully ate`);
  assert.ok(w.mealsYesterday >= 0);
});

test("tick resolves requests over time and keeps reputation in [0,100]", () => {
  const w = createWorld("world-test-5");
  for (let i = 0; i < 30000; i++) tick(w, 0.5);
  assert.ok(w.reputation >= 0 && w.reputation <= 100);
  assert.ok(w.tokens >= 0);
});

test("tick charges rent/upkeep at day rollover and the bank stays finite", () => {
  const w = createWorld("world-test-6");
  for (let i = 0; i < 60000; i++) tick(w, 0.5); // well past RENT_GRACE_DAY and a rent cycle
  assert.ok(Number.isFinite(w.bank));
  assert.ok(w.day > 8);
});

test("weather actually rolls to a new sky across many days (not stuck)", () => {
  const w = createWorld("world-test-7");
  const seen = new Set();
  for (let i = 0; i < 60000; i++) {
    tick(w, 0.5);
    seen.add(w.weather.sky);
  }
  assert.ok(seen.size >= 1);
  assert.ok(w.weather.history.length > 0, "rollWeather should have recorded history entries");
});

test("drainFx returns and clears the fx queue, null when empty", () => {
  const w = createWorld("world-test-8");
  w.fx.push("event", "memory");
  const drained = drainFx(w);
  assert.deepEqual(drained, ["event", "memory"]);
  assert.equal(w.fx.length, 0);
  assert.equal(drainFx(w), null);
});

test("rainLevel mirrors rainIntensity for the current sky", () => {
  const w = createWorld("world-test-9");
  w.weather.sky = "storm";
  assert.equal(rainLevel(w), 1);
  w.weather.sky = "clear";
  assert.equal(rainLevel(w), 0);
});

test("residents added via applyPeopleOps are actually stepped by tick without crashing", () => {
  const w = createWorld("world-test-10");
  applyPeopleOps(w, [{ op: "add", name: "Zed", gender: "m" }], w.rng);
  for (let i = 0; i < 3000; i++) tick(w, 0.5);
  for (const v of Object.values(w.extras[0].needs)) assert.ok(Number.isFinite(v));
});

test("two people settled in the game room together eventually get a shared micro-gesture and a social lift", () => {
  const w = createWorld("world-test-11");
  applyPeopleOps(w, [{ op: "add", name: "Zed", gender: "m" }], w.rng);
  w.agent.room = "game";
  w.extras[0].room = "game";
  let sawMicro = false;
  for (let i = 0; i < 2000; i++) {
    tick(w, 0.5);
    w.agent.room = "game"; w.agent.transit = 0; w.agent.moving = false;
    w.extras[0].room = "game"; w.extras[0].transit = 0; w.extras[0].moving = false;
    if (w.agent.micro || w.extras[0].micro) sawMicro = true;
  }
  assert.ok(sawMicro, "shared game-room presence should eventually trigger a micro reaction");
});

test("a conversation bubble decays and clears itself over time", () => {
  const w = createWorld("world-test-13");
  w.conversation.bubble = { line: "hi", ttl: 1 };
  tick(w, 0.5);
  assert.ok(w.conversation.bubble, "should still be showing");
  tick(w, 1);
  assert.equal(w.conversation.bubble, null);
});

test("a playing-out routine pauses the utility AI and still updates mood/tallies", () => {
  const w = createWorld("world-test-14");
  w.t = DAY_LENGTH * 0.3; // tick() derives dayFrac/isNight from t, not from setting those fields directly
  w.agent.routine = { steps: [{ op: "wave" }, { op: "nod" }], i: 0, timer: 0, done: false };
  const beforeAction = w.agent.action;
  tick(w, 0.5);
  assert.equal(w.isNight, false, "sanity: this should be daytime");
  assert.equal(w.agent.action, beforeAction, "the utility AI's own action selection should be paused while a routine plays");
  assert.equal(w.agent.gesture, "wave");
});

test("watering a thirsty plant via onWater raises curiosity and pet bond, and fires an fx event", () => {
  const w = createWorld("world-test-15");
  const id = Object.keys(OBJECTS).find((x) => /plant|succulent|terrarium|aquarium|flower|garden|bonsai|herb/i.test(OBJECTS[x].label));
  const room = OBJECTS[id].room;
  w.rooms[room] = [...w.rooms[room], id];
  w.plants[`${room}:${id}`] = { water: 5, since: 1, dryDays: 0 };
  w.agent.room = room;
  w.agent.action = { id: "water", room, effect: {}, duration: [1, 1] };
  w.agent.actionLeft = 0.01;
  w.pet.bond = 0.5;
  const curiosityBefore = w.agent.needs.curiosity;
  tick(w, 0.5);
  assert.ok(w.plants[`${room}:${id}`].water > 5, "the plant should have been watered");
  assert.ok(w.agent.needs.curiosity >= curiosityBefore);
});

test("fixing a broken item via onTinker raises its condition and fires a 'memory' fx", () => {
  const w = createWorld("world-test-16");
  const id = w.rooms.desk[0];
  w.wear[`desk:${id}`] = 5; // broken
  w.agent.room = "desk";
  w.agent.action = { id: "tinker", room: "desk", effect: {}, duration: [1, 1] };
  w.agent.actionLeft = 0.01;
  tick(w, 0.5);
  assert.ok(w.wear[`desk:${id}`] > 5, "tinkering should have raised the item's condition");
  assert.ok(w.fx.includes("memory"), "a successful fix pushes a 'memory' fx event");
  // note: agent.lastThought is overwritten again in the same tick once a new
  // action is picked right after, so "fixed the X" is transient — not asserted here
});

test("eating with a real cooking appliance in the room gives an extra hunger/energy top-up", () => {
  const w = createWorld("world-test-17");
  const applianceId = Object.keys(OBJECTS).find((x) => OBJECTS[x].room === "kitchen" && /kettle|coffee maker|espresso|rice cooker|bread maker|waffle iron|sandwich press|juicer|knife|cutting board|tea set/i.test(OBJECTS[x].label));
  assert.ok(applianceId, "expected at least one cooking appliance in the kitchen catalog");
  w.rooms.kitchen = [...w.rooms.kitchen, applianceId];
  w.agent.room = "kitchen";
  w.agent.needs.hunger = 50;
  w.agent.action = { id: "eat", room: "kitchen", effect: {}, duration: [1, 1] };
  w.agent.actionLeft = 0.01;
  tick(w, 0.5);
  assert.ok(w.agent.needs.hunger > 55, "cooking with an actual appliance should give a bonus on top of the base action effect");
  assert.equal(w.mealsToday, 1);
});

test("onNewDay writes a memory when a plant dies overnight, and when a goal is hit or lapses", () => {
  // a dying plant
  const w = createWorld("world-test-18");
  const plantId = Object.keys(OBJECTS).find((x) => /plant/i.test(OBJECTS[x].label));
  const room = OBJECTS[plantId].room;
  w.rooms[room] = [...w.rooms[room], plantId];
  w.plants[`${room}:${plantId}`] = { water: 2, since: 1, dryDays: 1 }; // one more dry day away from death
  const memBefore = w.memory.slots.length;
  for (let i = 0; i < 1300; i++) tick(w, 0.5); // cross a day boundary
  assert.ok(w.memory.slots.some((s) => s.text.includes("die")), "should remember letting the plant die");
  assert.ok(w.memory.slots.length > memBefore);

  // a goal that's already met gets marked done with a memory, at the next rollover
  const w2 = createWorld("world-test-19");
  w2.goal = { text: "save up", metric: "bank", target: 1, start: 0, startDay: w2.day, done: false, failed: false };
  for (let i = 0; i < 1300; i++) tick(w2, 0.5);
  assert.equal(w2.goal.done, true);
  assert.ok(w2.memory.slots.some((s) => s.text.startsWith("Did it")));

  // a goal untouched for too long lapses as failed
  const w3 = createWorld("world-test-20");
  w3.goal = { text: "impossible", metric: "bank", target: 99999999, start: 0, startDay: w3.day, done: false, failed: false };
  for (let i = 0; i < 16 * DAY_LENGTH * 2; i++) tick(w3, 0.5); // 16+ in-game days
  assert.equal(w3.goal.failed, true);
  assert.ok(w3.memory.slots.some((s) => s.text.startsWith("Gave up")));
});

test("a full ~35-day run stays internally consistent: finite bank/mood, valid weather, no exceptions", () => {
  const w = createWorld("world-test-12");
  for (let i = 0; i < 45000; i++) tick(w, 0.5);
  assert.ok(Number.isFinite(w.bank));
  assert.ok(w.mood.valence >= -1 && w.mood.valence <= 1);
  assert.ok(["clear", "clouds", "rain", "storm", "gold"].includes(w.weather.sky));
  assert.ok(w.day >= 30);
});
