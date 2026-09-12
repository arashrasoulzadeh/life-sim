import { test } from "node:test";
import assert from "node:assert/strict";
import { OBJECTS, MARKET, OBJECT_IDS_BY_ROOM, DEFAULT_OBJECTS, isSellable, priceOf, sellValue, catOf } from "../src/sim/marketplace.js";
import { ROOM_IDS } from "../src/sim/rooms.js";
import { cleanArt, artToSvg, ART_HELP } from "../src/sim/itemart.js";
import { MAX_PAINTINGS, autoPainting, cleanPaintings, rotatePaintings, setPaintings, paintingsHtml } from "../src/sim/paintings.js";
import { Rng } from "../src/engine/rng.js";

// ---------- marketplace.js ----------
test("every catalog entry has a real, emoji-carrying, positively priced record", () => {
  for (const [id, o] of Object.entries(OBJECTS)) {
    assert.equal(o.id, id);
    assert.ok(o.label && o.label.length > 0);
    assert.ok(o.glyph && o.glyph.length > 0);
    assert.ok(ROOM_IDS.includes(o.room), `${id} has a valid room`);
    assert.ok(o.price >= 15, `${id} price should be at least the 15c floor`);
    assert.ok(o.price % 5 === 0, `${id} price should round to a multiple of 5`);
    assert.ok(o.effect && typeof o.effect === "object");
  }
});

test("ids are unique across the whole catalog", () => {
  const ids = Object.keys(OBJECTS);
  assert.equal(new Set(ids).size, ids.length);
});

test("MARKET groups the same objects by category as OBJECTS holds them", () => {
  const fromMarket = Object.values(MARKET).flat().length;
  assert.equal(fromMarket, Object.keys(OBJECTS).length);
  for (const [cat, items] of Object.entries(MARKET)) {
    for (const o of items) assert.equal(o.cat, cat);
  }
});

test("OBJECT_IDS_BY_ROOM covers every room and only that room's items", () => {
  for (const room of ROOM_IDS) {
    assert.ok(Array.isArray(OBJECT_IDS_BY_ROOM[room]) && OBJECT_IDS_BY_ROOM[room].length > 0);
    for (const id of OBJECT_IDS_BY_ROOM[room]) assert.equal(OBJECTS[id].room, room);
  }
});

test("DEFAULT_OBJECTS gives each room exactly one, cheapest-first, item", () => {
  for (const room of ROOM_IDS) {
    assert.equal(DEFAULT_OBJECTS[room].length, 1);
    const id = DEFAULT_OBJECTS[room][0];
    const cheapest = Math.min(...OBJECT_IDS_BY_ROOM[room].map((x) => OBJECTS[x].price));
    assert.equal(OBJECTS[id].price, cheapest);
  }
});

test("priceOf/sellValue/isSellable/catOf handle both real and unknown ids", () => {
  const id = Object.keys(OBJECTS)[0];
  assert.equal(priceOf(id), OBJECTS[id].price);
  assert.equal(sellValue(id), Math.round(OBJECTS[id].price * 0.5));
  assert.equal(isSellable(id), true);
  assert.equal(catOf(id), OBJECTS[id].cat);
  assert.equal(priceOf("bogus"), 0);
  assert.equal(sellValue("bogus"), 0);
  assert.equal(isSellable("bogus"), false);
  assert.equal(catOf("bogus"), "");
});

// ---------- itemart.js ----------
test("cleanArt rejects non-array/non-wrapper input", () => {
  assert.equal(cleanArt(null), null);
  assert.equal(cleanArt("nope"), null);
  assert.equal(cleanArt(42), null);
  assert.equal(cleanArt([]), null, "empty list with no bg is nothing");
});

test("cleanArt validates every known primitive type and drops unknown ones", () => {
  const shapes = [
    { t: "rect", x: 1000, y: -1000, w: 20, h: 20, fill: "#fff" }, // x/y should clamp to [-20,120]
    { t: "circle", x: 50, y: 50, rad: 999, fill: "hsl(200 50% 50%)" },
    { t: "ellipse", rx: 10, ry: 10, fill: "#abc" },
    { t: "line", x1: 0, y1: 0, x2: 10, y2: 10, stroke: "#000" },
    { t: "poly", points: [[0, 0], [10, 0], [5, 10]], fill: "#0f0" },
    { t: "path", points: [[0, 0], [10, 10]], stroke: "#111" },
    { t: "curve", x1: 0, y1: 0, x2: 10, y2: 10, cx: 5, cy: 0 },
    { t: "arc", x: 50, y: 50, rad: 20, a0: 0, a1: 90 },
    { t: "pie", x: 50, y: 50, rad: 20 },
    { t: "star", x: 50, y: 50, rad: 30, inner: 12, n: 5 },
    { t: "ring", x: 50, y: 50, rad: 20 },
    { t: "dots", points: [[10, 10], [20, 20]] },
    { t: "grad", x: 0, y: 0, w: 100, h: 100, c0: "#000", c1: "#fff" },
    { t: "not-a-real-type" },
    "not even an object",
  ];
  const out = cleanArt(shapes);
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 13, "13 valid shapes, the bogus type and the string dropped");
  assert.ok(out[0].x <= 120 && out[0].x >= -20, "x clamped into range");
});

test("cleanArt caps at 48 shapes even if more are sent", () => {
  const many = Array.from({ length: 100 }, () => ({ t: "circle", x: 50, y: 50, rad: 5, fill: "#fff" }));
  const out = cleanArt(many);
  assert.equal(out.length, 48);
});

test("cleanArt accepts the wrapper form and preserves mirror/bg, falls back to plain array otherwise", () => {
  const plain = cleanArt([{ t: "circle", x: 50, y: 50, rad: 5, fill: "#fff" }]);
  assert.ok(Array.isArray(plain), "no mirror/bg -> plain array for backwards compat");

  const wrapped = cleanArt({ shapes: [{ t: "circle", x: 50, y: 50, rad: 5, fill: "#fff" }], mirror: true, bg: "#123456" });
  assert.equal(Array.isArray(wrapped), false);
  assert.equal(wrapped.mirror, true);
  assert.equal(wrapped.bg, "#123456");
  assert.equal(wrapped.shapes.length, 1);
});

test("cleanArt rejects bad colours and falls back to the default", () => {
  const out = cleanArt([{ t: "rect", x: 0, y: 0, w: 10, h: 10, fill: "javascript:alert(1)" }]);
  assert.equal(out[0].fill, "#888");
});

test("artToSvg renders an empty string for no shapes/no bg, and a real <svg> otherwise", () => {
  assert.equal(artToSvg([]), "");
  assert.equal(artToSvg(null), "");
  const svg = artToSvg([{ t: "circle", x: 50, y: 50, rad: 10, fill: "#f00" }]);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("<circle"));
});

test("artToSvg mirrors shapes when mirror is set, and includes a gradient <defs> for grad shapes", () => {
  const mirrored = artToSvg({ shapes: [{ t: "rect", x: 0, y: 0, w: 10, h: 10, fill: "#fff" }], mirror: true });
  assert.ok(mirrored.includes('<g transform="translate(100,0) scale(-1,1)">'));

  const withGrad = cleanArt([{ t: "grad", x: 0, y: 0, w: 100, h: 100, c0: "#000", c1: "#fff" }]);
  const svg = artToSvg(withGrad);
  assert.ok(svg.includes("<defs>"));
  assert.ok(svg.includes("linearGradient"));
});

test("artToSvg renders every primitive type through shapeSvg without throwing, each producing real markup", () => {
  const shapes = cleanArt([
    { t: "rect", x: 0, y: 0, w: 10, h: 10, fill: "#fff", stroke: "#000", sw: 1 },
    { t: "circle", x: 50, y: 50, rad: 10, fill: "#fff" },
    { t: "ellipse", x: 50, y: 50, rx: 10, ry: 5, fill: "#fff" },
    { t: "line", x1: 0, y1: 0, x2: 10, y2: 10, stroke: "#000" },
    { t: "poly", points: [[0, 0], [10, 0], [5, 10]], fill: "#0f0" },
    { t: "path", points: [[0, 0], [10, 10]], stroke: "#111" },
    { t: "curve", x1: 0, y1: 0, x2: 10, y2: 10, cx: 5, cy: 0, stroke: "#000" },
    { t: "arc", x: 50, y: 50, rad: 20, a0: 0, a1: 270 }, // >180deg exercises the large-arc-flag branch
    { t: "pie", x: 50, y: 50, rad: 20, a0: 0, a1: 90, fill: "#fff" },
    { t: "star", x: 50, y: 50, rad: 30, inner: 12, n: 5, fill: "#fff" },
    { t: "ring", x: 50, y: 50, rad: 20, stroke: "#000" },
    { t: "dots", points: [[10, 10], [20, 20]], fill: "#fff" },
  ]);
  const svg = artToSvg(shapes);
  assert.ok(svg.startsWith("<svg"));
  for (const tag of ["<rect", "<circle", "<ellipse", "<line", "<polygon", "<polyline", "<path"]) {
    assert.ok(svg.includes(tag), `expected ${tag} in the rendered SVG`);
  }
});

test("artToSvg escapes fill/stroke colours safely (no raw quote breakout)", () => {
  // color validator already blocks anything but hex/hsl/rgb, so this exercises
  // the escaping path defensively even though col() would normally reject it
  const svg = artToSvg([{ t: "circle", x: 50, y: 50, rad: 10, fill: "#f00", stroke: "#000", sw: 2 }]);
  assert.ok(!svg.includes("<script"));
});

test("ART_HELP documents the shape vocabulary", () => {
  assert.ok(ART_HELP.includes("rect"));
  assert.ok(ART_HELP.includes("48 shapes"));
});

// ---------- paintings.js ----------
test("autoPainting always returns a non-empty, valid shape list", () => {
  for (let i = 0; i < 20; i++) {
    const art = autoPainting(new Rng(i));
    assert.ok(Array.isArray(art) && art.length > 0);
  }
});

test("cleanPaintings validates each entry and caps at MAX_PAINTINGS", () => {
  assert.equal(cleanPaintings("nope"), null);
  assert.equal(cleanPaintings([]), null);
  const raw = Array.from({ length: 6 }, () => [{ t: "circle", x: 50, y: 50, rad: 5, fill: "#fff" }]);
  const out = cleanPaintings(raw);
  assert.equal(out.length, MAX_PAINTINGS);
});

test("rotatePaintings adds one fresh painting per new day and keeps only the newest MAX_PAINTINGS", () => {
  const w = { day: 1, couchArt: [] };
  const rng = new Rng(1);
  for (let d = 1; d <= 6; d++) {
    w.day = d;
    rotatePaintings(w, rng);
  }
  assert.equal(w.couchArt.length, MAX_PAINTINGS);
  assert.equal(w.couchArt[w.couchArt.length - 1].day, 6);
});

test("rotatePaintings doesn't add a second painting on the same day", () => {
  const w = { day: 3, couchArt: [] };
  rotatePaintings(w, new Rng(1));
  rotatePaintings(w, new Rng(2));
  assert.equal(w.couchArt.length, 1);
});

test("setPaintings replaces the couch art from a valid AI-supplied set, rejects an invalid one", () => {
  const w = { day: 9, couchArt: [{ shapes: [], day: 1 }] };
  const n = setPaintings(w, [[{ t: "circle", x: 50, y: 50, rad: 5, fill: "#fff" }]]);
  assert.equal(n, 1);
  assert.equal(w.couchArt[0].day, 9);
  const n2 = setPaintings(w, "not an array");
  assert.equal(n2, 0);
});

test("paintingsHtml renders nothing for an empty list, a framed div per painting otherwise", () => {
  assert.equal(paintingsHtml([]), "");
  assert.equal(paintingsHtml(null), "");
  const html = paintingsHtml([{ shapes: [{ t: "circle", x: 50, y: 50, rad: 5, fill: "#fff" }], day: 1 }]);
  assert.ok(html.includes("painting"));
  assert.ok(html.includes("<svg"));
});
