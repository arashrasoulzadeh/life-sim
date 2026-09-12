import { test } from "node:test";
import assert from "node:assert/strict";
import { objHtml, WALL_PATTERNS, FLOOR_PATTERNS, roomStyle, roomHtml, objectsMeta, roomDoc, initDocs } from "../src/sim/roomrender.js";
import { ROOMS, ROOM_IDS } from "../src/sim/rooms.js";
import { OBJECT_IDS_BY_ROOM, OBJECTS } from "../src/sim/marketplace.js";

// each room's big furniture piece(s), in px on the 512x448 playfield — mirrors
// the private FURNITURE_RECT table in roomrender.js so this test can verify
// nothing bought ever renders on top of it
const FURNITURE_RECT = {
  desk: [
    [97, 233, 318, 23],
    [118, 255, 26, 63],
    [369, 255, 26, 63],
    [148, 99, 216, 134],
  ],
  kitchen: [[46, 233, 200, 58]],
  window: [[143, 63, 226, 153]],
  couch: [[271, 251, 160, 59]],
  bed: [
    [174, 255, 180, 54],
    [179, 237, 46, 20],
  ],
  game: [[154, 81, 205, 132]],
};

test("roomStyle falls back to the room's base name/palette/furn with no overrides", () => {
  const st = roomStyle("kitchen", {});
  assert.equal(st.name, ROOMS.kitchen.name);
  assert.deepEqual(st.palette, ROOMS.kitchen.palette);
  assert.equal(st.pattern, "plain");
  assert.equal(st.floor, "plain");
  assert.equal(st.light, null);
});

test("roomStyle applies validated overrides and clamps light values", () => {
  const style = {
    kitchen: {
      name: "the good kitchen",
      palette: { wall: "#123456" },
      pattern: "stripes",
      floorPattern: "tiles",
      furn: "#abcdef",
      sign: "<b>hi</b>",
      light: { warmth: 5, level: -3 },
      names: { x: "nickname" },
    },
  };
  const st = roomStyle("kitchen", style);
  assert.equal(st.name, "the good kitchen");
  assert.equal(st.palette.wall, "#123456");
  assert.equal(st.pattern, "stripes");
  assert.equal(st.floor, "tiles");
  assert.equal(st.furn, "#abcdef");
  assert.equal(st.sign, "bhi/b");
  assert.equal(st.light.warmth, 1); // clamped
  assert.equal(st.light.level, 0.55); // clamped
  assert.deepEqual(st.names, { x: "nickname" });
});

test("roomStyle rejects an unknown pattern/floorPattern and falls back to plain", () => {
  const st = roomStyle("bed", { bed: { pattern: "not-real", floorPattern: "not-real" } });
  assert.equal(st.pattern, "plain");
  assert.equal(st.floor, "plain");
});

test("objHtml escapes the label/nickname and renders a positioned span", () => {
  const id = Object.keys(OBJECTS)[0];
  const html = objHtml(id, { x: 100, y: 200 }, OBJECTS[id].room, {}, {}, { [id]: "<b>nick</b>" }, {});
  assert.ok(html.includes(`data-obj="${id}"`));
  assert.ok(html.includes("left:19.53%")); // 100/512
  assert.ok(!html.includes("<b>nick</b>"), "nickname should be escaped, not raw HTML");
  assert.equal(objHtml("no-such-id", { x: 0, y: 0 }, "kitchen", {}, {}, {}, {}), "");
});

test("objHtml renders drawn art instead of the emoji glyph when present", () => {
  const id = Object.keys(OBJECTS)[0];
  const art = { [id]: [{ t: "circle", x: 50, y: 50, rad: 10, fill: "#fff" }] };
  const html = objHtml(id, { x: 0, y: 0 }, OBJECTS[id].room, {}, {}, {}, art);
  assert.ok(html.includes("obj-drawn"));
  assert.ok(html.includes("<svg"));
});

test("roomHtml includes the wall/floor pattern, the room tag, and every object", () => {
  const ids = (OBJECT_IDS_BY_ROOM.kitchen || []).slice(0, 3);
  const html = roomHtml("kitchen", ids, {}, {}, {}, null, {}, []);
  assert.ok(html.includes('data-room="kitchen"'));
  assert.ok(html.includes("room-tag"));
  for (const id of ids) assert.ok(html.includes(`data-obj="${id}"`));
});

test("roomHtml renders the window's generative art background, and paintings only on the couch", () => {
  const winHtml = roomHtml("window", [], {}, {}, {}, { style: "bands", hue: 10, hue2: 90, density: 0.5 }, {}, []);
  assert.ok(winHtml.includes("furn win"));
  const couchHtml = roomHtml("couch", [], {}, {}, {}, null, {}, [{ shapes: [{ t: "circle", x: 50, y: 50, rad: 5, fill: "#fff" }], day: 1 }]);
  assert.ok(couchHtml.includes("painting"));
  const deskHtml = roomHtml("desk", [], {}, {}, {}, null, {}, []);
  assert.ok(!deskHtml.includes("painting"));
});

test("objectsMeta returns null-filtered, percent-positioned metadata matching the room's objects", () => {
  const ids = (OBJECT_IDS_BY_ROOM.desk || []).slice(0, 5);
  const meta = objectsMeta("desk", ids, {}, {}, {}, {}, null, {});
  assert.equal(meta.length, ids.length);
  for (const m of meta) {
    assert.ok(m.x >= 0 && m.x <= 1);
    assert.ok(m.y >= 0 && m.y <= 1);
    assert.equal(typeof m.label, "string");
  }
  const withBogus = objectsMeta("desk", [...ids, "bogus-id"], {}, {}, {}, {}, null, {});
  assert.equal(withBogus.length, ids.length, "unknown ids are filtered out");
});

test("objectsMeta reports the keepsake flag and drawn flag correctly", () => {
  const id = (OBJECT_IDS_BY_ROOM.desk || [])[0];
  const meta = objectsMeta("desk", [id], {}, {}, {}, {}, `desk:${id}`, { [id]: [{ t: "circle", x: 1, y: 1, rad: 1, fill: "#000" }] });
  assert.equal(meta[0].keepsake, true);
  assert.equal(meta[0].drawn, true);
});

test("roomDoc bundles style/objects/meta/html together with a timestamp", () => {
  const ids = (OBJECT_IDS_BY_ROOM.bed || []).slice(0, 2);
  const doc = roomDoc("seed1", "bed", ids, {}, {}, {}, {}, null, null, {}, []);
  assert.equal(doc.room, "bed");
  assert.deepEqual(doc.objects, ids);
  assert.equal(doc.meta.length, ids.length);
  assert.ok(doc.html.includes('data-room="bed"'));
  assert.ok(doc.updated);
});

test("initDocs builds a roomDocs entry for every room", () => {
  const world = { seed: "s", rooms: Object.fromEntries(ROOM_IDS.map((r) => [r, []])), roomStyle: {}, objDay: {}, plants: {}, wear: {}, windowArt: null, keepsake: null, itemArt: {}, couchArt: [] };
  initDocs(world);
  for (const r of ROOM_IDS) assert.ok(world.roomDocs[r], `${r} should have a doc`);
});

// ---------- the two properties this module exists to guarantee ----------
test("no two objects in the same room ever share a placement slot, even at a room's full catalog size", () => {
  for (const room of ROOM_IDS) {
    const ids = OBJECT_IDS_BY_ROOM[room];
    const meta = objectsMeta(room, ids, {}, {}, {}, {}, null, {});
    const seen = new Set();
    for (const m of meta) {
      const key = `${m.x},${m.y}`;
      assert.ok(!seen.has(key), `${room}: ${m.label} collided with another item at ${key}`);
      seen.add(key);
    }
    assert.equal(seen.size, ids.length, `${room}: every one of its ${ids.length} catalog items got a unique slot`);
  }
});

test("no object placement ever falls inside that room's furniture rect, even at full catalog size", () => {
  for (const [room, rects] of Object.entries(FURNITURE_RECT)) {
    const ids = OBJECT_IDS_BY_ROOM[room];
    const meta = objectsMeta(room, ids, {}, {}, {}, {}, null, {});
    for (const m of meta) {
      const x = m.x * 512, y = m.y * 448;
      for (const [rx, ry, rw, rh] of rects) {
        const inside = x > rx - 4 && x < rx + rw + 4 && y > ry - 4 && y < ry + rh + 4;
        assert.ok(!inside, `${room}: ${m.label} at (${x.toFixed(0)},${y.toFixed(0)}) overlaps furniture rect [${rx},${ry},${rw},${rh}]`);
      }
    }
  }
});

test("placement is stable for a fixed set of ids (buying/selling elsewhere doesn't reshuffle it)", () => {
  const ids = (OBJECT_IDS_BY_ROOM.game || []).slice(0, 10);
  const meta1 = objectsMeta("game", ids, {}, {}, {}, {}, null, {});
  const meta2 = objectsMeta("game", ids, {}, {}, {}, {}, null, {});
  assert.deepEqual(meta1.map((m) => [m.x, m.y]), meta2.map((m) => [m.x, m.y]));
});

test("WALL_PATTERNS and FLOOR_PATTERNS are non-empty closed vocabularies", () => {
  assert.ok(WALL_PATTERNS.length > 0);
  assert.ok(FLOOR_PATTERNS.length > 0);
  assert.ok(WALL_PATTERNS.includes("plain"));
  assert.ok(FLOOR_PATTERNS.includes("plain"));
});
