import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, applyMorning, applyEvening, stubDialogue, GAME_COST, ROOM_ITEM_CAP } from "../src/sim/dialogue.js";
import { createWorld, tick } from "../src/sim/world.js";
import { OBJECT_IDS_BY_ROOM, OBJECTS } from "../src/sim/marketplace.js";
import { Rng } from "../src/engine/rng.js";

function world() {
  return createWorld("dialogue-test-" + Math.random());
}

// ---------- buildPrompt ----------
test("buildPrompt returns a system+user pair for both phases, and they differ", () => {
  const w = world();
  const morning = buildPrompt(w, "morning", {});
  const evening = buildPrompt(w, "evening", {});
  assert.equal(typeof morning.system, "string");
  assert.equal(typeof morning.user, "string");
  assert.notEqual(morning.system, evening.system);
  assert.ok(morning.system.includes("morning"));
  assert.ok(evening.system.toLowerCase().includes("evening review"));
});

test("buildPrompt's evening system lists the marketplace catalog and JSON schema fields", () => {
  const { system } = buildPrompt(world(), "evening", {});
  assert.ok(system.includes('"buy"'));
  assert.ok(system.includes('"sell"'));
  assert.ok(system.includes('"commissionGame"'));
  assert.ok(system.includes("Coding"), "gated-off coding message should explain why it can't make games yet");
});

test("buildPrompt's evening system lists the actual game kernels once coding is high enough", () => {
  const w = world();
  w.agent.skills.coding = 20;
  const { system } = buildPrompt(w, "evening", {});
  assert.ok(system.includes("Game kernels"));
  assert.ok(system.includes("orbit"));
});

test("buildPrompt's user text carries the current day, weather, mood, and meals-today/yesterday", () => {
  const w = world();
  w.mealsYesterday = 2;
  const { user } = buildPrompt(w, "morning", {});
  assert.ok(user.includes(`day ${w.day}`));
  assert.ok(user.includes("Weather"));
  assert.ok(user.includes("Meals yesterday: 2/3"));
});

test("buildPrompt surfaces a crowding line once a room nears/hits ROOM_ITEM_CAP", () => {
  const w = world();
  w.rooms.kitchen = OBJECT_IDS_BY_ROOM.kitchen.slice(0, ROOM_ITEM_CAP);
  const { user } = buildPrompt(w, "evening", {});
  assert.ok(user.includes("Getting full"));
  assert.ok(user.includes("kitchen"));
});

test("buildPrompt surfaces context extras: notes, vote result, games list", () => {
  const w = world();
  const { user } = buildPrompt(w, "evening", {
    notes: [{ name: "Ann", text: "hello!" }],
    voteResult: { choice: "work", count: 5 },
    gamesList: [{ title: "Test Game", createdDay: 1, plays: 3 }],
  });
  assert.ok(user.includes("Ann"));
  assert.ok(user.includes("hello!"));
  assert.ok(user.includes("Test Game"));
});

// ---------- applyMorning ----------
test("applyMorning clamps line/reply/quote length and applies a look/memory/goal when given", () => {
  const w = world();
  const out = applyMorning(w, {
    line: "x".repeat(500),
    reply: "y".repeat(500),
    quote: "z".repeat(500),
    look: { skin: "#112233" },
    newMemory: { text: "learned something", trait: "curiosity", dir: 1 },
    goal: { metric: "bank", target: w.bank + 500, text: "save up" },
  });
  assert.ok(out.line.length <= 160);
  assert.ok(out.reply.length <= 260);
  assert.ok(out.quote.length <= 150);
  assert.equal(w.agent.look.skin, "#112233");
  assert.ok(out.memory);
  assert.ok(w.goal);
  assert.ok(out.changes.some((c) => c.includes("goal")));
});

test("applyMorning doesn't overwrite an existing unresolved goal", () => {
  const w = world();
  w.goal = { text: "existing", metric: "bank", target: 9999, start: 0, startDay: 1, done: false, failed: false };
  const out = applyMorning(w, { goal: { metric: "games", target: 5, text: "new one" } });
  assert.equal(w.goal.text, "existing");
  assert.equal(out.goal, null);
});

test("applyMorning records a dream when given, names the pet, sets a week style/vote prompt", () => {
  const w = world();
  const out = applyMorning(w, { dream: "a strange one", petName: "Mochi", weekStyle: "a calm week", votePrompt: "should I rest more?" });
  assert.equal(out.dream, "a strange one");
  assert.equal(w.pet.name, "Mochi");
  assert.equal(w.rhythm.weekStyle, "a calm week");
  assert.equal(out.votePrompt, "should I rest more?");
});

test("applyMorning resolves a two-minds conflict day via lean/argument", () => {
  const w = world();
  w.psyche = { conflictDay: w.day, lean: "even", leanUntil: w.day, argument: null };
  const out = applyMorning(w, { lean: "push", argument: "let's get things done" });
  assert.equal(w.psyche.lean, "push");
  assert.ok(out.changes.some((c) => c.includes("push")));
});

test("applyMorning accepts writing only when the writing skill is high enough", () => {
  const w = world();
  w.agent.skills.writing = 5; // below WRITING_GATE
  const noWrite = applyMorning(w, { wrote: "x".repeat(60) });
  assert.equal(noWrite.wrote, undefined);
  w.agent.skills.writing = 40;
  const wrote = applyMorning(w, { wrote: "x".repeat(60) });
  assert.ok(wrote.wrote);
});

// ---------- applyEvening: buy/sell ----------
test("applyEvening buys an affordable item into its own room and charges the bank", () => {
  const w = world();
  w.bank = 99999;
  const id = OBJECT_IDS_BY_ROOM.desk.find((x) => !w.rooms.desk.includes(x));
  const before = w.bank;
  const out = applyEvening(w, { buy: [{ object: id }] });
  assert.ok(w.rooms.desk.includes(id));
  assert.equal(w.bank, before - OBJECTS[id].price);
  assert.ok(out.changes.some((c) => c.startsWith("+ bought")));
});

test("applyEvening refuses to buy what's unaffordable, a duplicate, or an unknown id", () => {
  const w = world();
  w.bank = 0;
  const id = OBJECT_IDS_BY_ROOM.desk.find((x) => !w.rooms.desk.includes(x));
  const out = applyEvening(w, { buy: [{ object: id }] });
  assert.equal(w.rooms.desk.includes(id), false);
  assert.ok(out.changes.some((c) => c.includes("can't afford")));

  w.bank = 99999;
  const dup = w.rooms.desk[0];
  const beforeLen = w.rooms.desk.length;
  applyEvening(w, { buy: [{ object: dup }, { object: "not-a-real-id" }] });
  assert.equal(w.rooms.desk.length, beforeLen, "duplicate and bogus ids are silently skipped");
});

test("applyEvening enforces ROOM_ITEM_CAP: refuses a purchase into a full room, sell then buy still works", () => {
  const w = world();
  w.bank = 99999;
  w.rooms.kitchen = OBJECT_IDS_BY_ROOM.kitchen.slice(0, ROOM_ITEM_CAP);
  for (const id of w.rooms.kitchen) w.objDay[`kitchen:${id}`] = 1;
  const extra = OBJECT_IDS_BY_ROOM.kitchen[ROOM_ITEM_CAP];
  const refused = applyEvening(w, { buy: [{ object: extra }] });
  assert.equal(w.rooms.kitchen.length, ROOM_ITEM_CAP);
  assert.ok(refused.changes.some((c) => c.includes("full")));

  const sellId = w.rooms.kitchen[0];
  const out = applyEvening(w, { sell: [{ object: sellId }], buy: [{ object: extra }] });
  assert.equal(w.rooms.kitchen.length, ROOM_ITEM_CAP);
  assert.ok(out.changes.some((c) => c.startsWith("− sold")));
  assert.ok(out.changes.some((c) => c.startsWith("+ bought")));
});

test("applyEvening sells an owned item for half price, refuses to sell a keepsake", () => {
  const w = world();
  const id = w.rooms.desk[0];
  const out = applyEvening(w, { sell: [{ object: id }] });
  assert.equal(w.rooms.desk.includes(id), false);
  assert.equal(out.earned, Math.round(OBJECTS[id].price * 0.5));

  const w2 = world();
  const id2 = w2.rooms.couch[0];
  w2.keepsake = `couch:${id2}`;
  const out2 = applyEvening(w2, { sell: [{ object: id2 }] });
  assert.equal(w2.rooms.couch.includes(id2), true);
  assert.ok(out2.changes.some((c) => c.includes("keepsake")));
});

// ---------- applyEvening: commissionGame / repair / restyle / windowArt / drawings / paintings / keepsake ----------
test("applyEvening commissions a game only when coding is high enough, and it's free", () => {
  const w = world();
  w.agent.skills.coding = 5; // below the canMakeGames gate
  const blocked = applyEvening(w, { commissionGame: { title: "T", kernel: "orbit", params: {} } });
  assert.equal(blocked.game, null);
  assert.ok(blocked.changes.some((c) => c.includes("not skilled")));

  w.agent.skills.coding = 20;
  const before = w.bank;
  const out = applyEvening(w, { commissionGame: { title: "T", kernel: "orbit", params: { count: 4 } } });
  assert.ok(out.game);
  assert.equal(out.game.spec.kernel, "orbit");
  assert.equal(w.bank, before - GAME_COST);
});

test("applyEvening rejects a commissioned game that doesn't fit any real kernel", () => {
  const w = world();
  w.agent.skills.coding = 20;
  const out = applyEvening(w, { commissionGame: { title: "T", kernel: "not-a-real-kernel" } });
  assert.equal(out.game, null);
  assert.ok(out.changes.some((c) => c.includes("didn't fit")));
});

test("applyEvening refuses every purchase when genuinely broke, regardless of room/price", () => {
  const w = world();
  w.finances.broke = true;
  w.finances.brokeSince = w.day;
  w.bank = 5; // buyAllowed requires >= 40 while broke
  const id = OBJECT_IDS_BY_ROOM.desk.find((x) => !w.rooms.desk.includes(x));
  const out = applyEvening(w, { buy: [{ object: id }] });
  assert.equal(w.rooms.desk.includes(id), false);
  assert.ok(out.changes.some((c) => c.includes("too broke")));
});

test("applyEvening repairs a worn item for a cost, refuses if unaffordable", () => {
  const w = world();
  const id = w.rooms.desk[0];
  w.wear = { [`desk:${id}`]: 20 };
  w.bank = 0;
  const poor = applyEvening(w, { repair: [{ object: id }] });
  assert.equal(w.wear[`desk:${id}`], 20);
  assert.ok(poor.changes.some((c) => c.includes("can't afford")));

  w.bank = 99999;
  const out = applyEvening(w, { repair: [{ object: id }] });
  assert.equal(w.wear[`desk:${id}`], 100);
  assert.ok(out.changes.some((c) => c.startsWith("🔧")));
});

test("applyEvening restyles a room's name/palette/pattern within the closed vocabularies", () => {
  const w = world();
  const out = applyEvening(w, {
    restyle: [{ room: "kitchen", name: "<b>Nook</b>", wall: "#112233", pattern: "stripes", floorPattern: "tiles", sign: "hi" }],
  });
  assert.equal(w.roomStyle.kitchen.name, "bNook/b");
  assert.equal(w.roomStyle.kitchen.palette.wall, "#112233");
  assert.equal(w.roomStyle.kitchen.pattern, "stripes");
  assert.ok(out.changes.some((c) => c.includes("restyled")));

  // never allowed to touch the fixed room set
  const noop = applyEvening(w, { restyle: [{ room: "not-a-room", name: "hack" }] });
  assert.equal(noop.restyled, undefined);
});

test("applyEvening restyle also handles furn colour, clamped light, and object nicknames", () => {
  const w = world();
  const ownedId = w.rooms.kitchen[0];
  const out = applyEvening(w, {
    restyle: [{
      room: "kitchen",
      furn: "#ABCDEF",
      light: { warmth: 99, level: -5 },
      nickname: { [ownedId]: "  <b>Old Reliable</b>  ", "not-owned": "ignored" },
    }],
  });
  assert.equal(w.roomStyle.kitchen.furn, "#abcdef");
  assert.equal(w.roomStyle.kitchen.light.warmth, 1);
  assert.equal(w.roomStyle.kitchen.light.level, 0.55);
  assert.equal(w.roomStyle.kitchen.names[ownedId], "bOld Reliable/b");
  assert.equal(w.roomStyle.kitchen.names["not-owned"], undefined, "nickname only applies to an object that actually lives in that room");
  assert.ok(out.changes.some((c) => c.includes("restyled")));
});

test("applyEvening hangs generative window art from the closed style vocabulary only", () => {
  const w = world();
  const out = applyEvening(w, { windowArt: { style: "aurora", hue: 40, hue2: 200, density: 0.5 } });
  assert.equal(w.windowArt.style, "aurora");
  assert.ok(out.changes.some((c) => c.includes("aurora")));
  const rejected = applyEvening(w, { windowArt: { style: "not-a-style" } });
  assert.equal(w.windowArt.style, "aurora", "invalid style should not overwrite");
});

test("applyEvening records drawings only for owned objects, validated through cleanArt", () => {
  const w = world();
  const owned = w.rooms.desk[0];
  const out = applyEvening(w, {
    drawings: {
      [owned]: [{ t: "circle", x: 50, y: 50, rad: 10, fill: "#fff" }],
      "not-owned": [{ t: "circle", x: 50, y: 50, rad: 10, fill: "#fff" }],
    },
  });
  assert.ok(w.itemArt[owned]);
  assert.equal(w.itemArt["not-owned"], undefined);
  assert.ok(out.changes.some((c) => c.includes("drew")));
});

test("applyEvening hangs paintings above the couch via setPaintings", () => {
  const w = world();
  const out = applyEvening(w, { paintings: [[{ t: "circle", x: 50, y: 50, rad: 5, fill: "#fff" }]] });
  assert.equal(w.couchArt.length, 1);
  assert.ok(out.changes.some((c) => c.includes("painting")));
});

test("applyEvening also records a newMemory (the same closed vocabulary as applyMorning)", () => {
  const w = world();
  const before = { ...w.agent.personality };
  const out = applyEvening(w, { newMemory: { text: "had a good day", trait: "sociability", dir: 1 } });
  assert.ok(out.memory);
  assert.equal(out.memory.text, "had a good day");
  assert.notEqual(w.agent.personality.sociability, before.sociability);
  assert.ok(out.changes.some((c) => c.startsWith("✎")));
});

test("applyEvening sets and clears a keepsake for an owned item", () => {
  const w = world();
  const id = w.rooms.desk[0];
  applyEvening(w, { keepsake: id });
  assert.equal(w.keepsake, `desk:${id}`);
  applyEvening(w, { keepsake: "" });
  assert.equal(w.keepsake, null);
});

test("applyEvening applies people ops (add/rename/etc.) and flags peopleChanged", () => {
  const w = world();
  const out = applyEvening(w, { people: [{ op: "add", name: "Zed", gender: "m" }] });
  assert.equal(w.extras.length, 1);
  assert.equal(out.peopleChanged, true);
});

test("applyEvening reorders rooms only with a full, valid permutation", () => {
  const w = world();
  const shuffled = [...w.roomOrder].reverse();
  const out = applyEvening(w, { roomOrder: shuffled });
  assert.deepEqual(w.roomOrder, shuffled);
  assert.ok(out.changes.some((c) => c.includes("reorder")));

  const before = [...w.roomOrder];
  applyEvening(w, { roomOrder: ["desk", "window"] }); // too short
  assert.deepEqual(w.roomOrder, before);
});

test("applyEvening sets a routine from the closed ROUTINE_OPS vocabulary only", () => {
  const w = world();
  const out = applyEvening(w, { routine: [{ op: "wave" }, { op: "say", arg: "hi" }, { op: "not-a-real-op" }] });
  assert.equal(w.agent.routine.steps.length, 2, "the bogus op should be dropped");
  assert.ok(out.changes.some((c) => c.includes("routine")));
});

// ---------- stubDialogue (offline fallback) ----------
test("stubDialogue never touches money/look/routine and always returns a pickable line", () => {
  const w = world();
  const out = stubDialogue(w, "morning", new Rng(1));
  assert.equal(typeof out.line, "string");
  assert.ok(out.line.length > 0);
  assert.equal(out.spent, 0);
  assert.equal(out.earned, 0);
  assert.equal(out.look, null);
  const eve = stubDialogue(w, "evening", new Rng(1));
  assert.ok(eve.line.length > 0);
});

// ---------- a light end-to-end sanity check ----------
test("a world that ticks into the evening, then applies a full evening response, stays consistent", () => {
  const w = world();
  for (let i = 0; i < 1300; i++) tick(w, 0.5); // into the evening window
  w.bank = 9999;
  const id = OBJECT_IDS_BY_ROOM.couch.find((x) => !w.rooms.couch.includes(x));
  const out = applyEvening(w, { line: "ok", reply: "did some things", buy: [{ object: id }] });
  assert.ok(w.rooms.couch.includes(id));
  assert.ok(Number.isFinite(w.bank));
  assert.equal(typeof out.reply, "string");
});
