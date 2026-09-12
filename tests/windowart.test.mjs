import { test } from "node:test";
import assert from "node:assert/strict";
import { ART_STYLES, cleanWindowArt, windowArtCss, windowArtLabel, autoWindowArt } from "../src/sim/windowart.js";
import { Rng } from "../src/engine/rng.js";

test("cleanWindowArt rejects non-objects and unknown styles", () => {
  assert.equal(cleanWindowArt(null), null);
  assert.equal(cleanWindowArt("bands"), null);
  assert.equal(cleanWindowArt({ style: "not-a-style" }), null);
});

test("cleanWindowArt clamps hue/hue2/density and defaults hue2 relative to hue", () => {
  const a = cleanWindowArt({ style: "bands", hue: 9999, hue2: -50, density: 5 });
  assert.equal(a.style, "bands");
  assert.equal(a.hue, 360);
  assert.equal(a.hue2, 0);
  assert.equal(a.density, 1);

  const b = cleanWindowArt({ style: "rings" });
  assert.equal(b.hue, 210);
  assert.equal(b.hue2, (210 + 60) % 360);
  assert.equal(b.density, 0.6);
});

test("every ART_STYLES entry produces a real CSS background from windowArtCss", () => {
  for (const style of ART_STYLES) {
    const art = { style, hue: 120, hue2: 300, density: 0.6 };
    const css = windowArtCss(art);
    assert.equal(typeof css, "string");
    assert.ok(css.length > 10, `${style} should produce a non-trivial background`);
  }
});

test("windowArtCss returns a plain fallback colour with no art, and for an unknown style", () => {
  assert.equal(windowArtCss(null), "#0c1430");
  const css = windowArtCss({ style: "not-real", hue: 1, hue2: 2, density: 0.5 });
  assert.ok(css.startsWith("hsl("));
});

test("windowArtCss is deterministic for the same art (styles that use an internal seeded rng)", () => {
  const art = { style: "scatter", hue: 50, hue2: 200, density: 0.7 };
  assert.equal(windowArtCss(art), windowArtCss(art));
});

test("windowArtLabel names the style + hue, or 'clear glass' when unset", () => {
  assert.equal(windowArtLabel(null), "clear glass");
  assert.equal(windowArtLabel({ style: "aurora", hue: 88 }), "aurora in 88°");
});

test("autoWindowArt always returns a valid, renderable style + numbers", () => {
  for (let i = 0; i < 30; i++) {
    const art = autoWindowArt(new Rng(i));
    assert.ok(ART_STYLES.includes(art.style));
    assert.ok(art.hue >= 0 && art.hue < 360);
    assert.ok(art.hue2 >= 0 && art.hue2 < 360);
    assert.ok(art.density >= 0.35 && art.density <= 0.9);
    assert.doesNotThrow(() => windowArtCss(art));
  }
});
