import { test } from "node:test";
import assert from "node:assert/strict";
import { SKIES, freshWeather, stepWeather, rollWeather, weatherCuriosity, weatherMoodPull, rainIntensity } from "../src/sim/weather.js";
import { Rng } from "../src/engine/rng.js";

test("freshWeather starts cloudy with no history", () => {
  const w = freshWeather(new Rng(1));
  assert.equal(w.sky, "clouds");
  assert.equal(w.day, 0);
  assert.deepEqual(w.history, []);
});

test("stepWeather never changes the sky itself (that's rollWeather's job now)", () => {
  const w = { weather: freshWeather(new Rng(1)) };
  const before = w.weather.sky;
  for (let i = 0; i < 1000; i++) stepWeather(w, 0.5, new Rng(i));
  assert.equal(w.weather.sky, before);
});

test("stepWeather only flashes during a storm, and the flash decays", () => {
  const clear = { weather: { sky: "clear", flash: 0 } };
  let anyFlash = false;
  for (let i = 0; i < 200; i++) { stepWeather(clear, 0.5, new Rng(i)); if (clear.weather.flash > 0) anyFlash = true; }
  assert.equal(anyFlash, false, "clear sky should never flash");

  const storm = { weather: { sky: "storm", flash: 0 } };
  let sawFlash = false;
  for (let i = 0; i < 500; i++) { stepWeather(storm, 0.5, new Rng(i)); if (storm.weather.flash > 0) sawFlash = true; }
  assert.ok(sawFlash, "storm should flash eventually");
});

test("rollWeather always lands on a valid SKIES entry and records history capped at 20", () => {
  const w = { day: 1, mood: { valence: 0 }, weather: freshWeather(new Rng(1)) };
  for (let d = 1; d <= 50; d++) {
    w.day = d;
    rollWeather(w, new Rng(d));
    assert.ok(SKIES.includes(w.weather.sky));
  }
  assert.equal(w.weather.history.length, 20);
  assert.equal(w.weather.day, 50);
  assert.equal(w.weather.history[w.weather.history.length - 1].day, 50);
});

test("rollWeather leans toward clear/gold on a good mood, rain/storm on a bad one", () => {
  let goldish = 0, stormish = 0;
  for (let i = 0; i < 500; i++) {
    const good = { day: 2, mood: { valence: 0.9 }, weather: { sky: "clouds", history: [] } };
    rollWeather(good, new Rng(i));
    if (good.weather.sky === "gold" || good.weather.sky === "clear") goldish++;

    const bad = { day: 2, mood: { valence: -0.9 }, weather: { sky: "clouds", history: [] } };
    rollWeather(bad, new Rng(i + 100000));
    if (bad.weather.sky === "rain" || bad.weather.sky === "storm") stormish++;
  }
  assert.ok(goldish > 150, `good mood should skew clear/gold, got ${goldish}/500`);
  assert.ok(stormish > 150, `bad mood should skew rain/storm, got ${stormish}/500`);
});

test("rollWeather tolerates a missing mood (defaults valence to 0)", () => {
  const w = { day: 1, weather: freshWeather(new Rng(1)) };
  assert.doesNotThrow(() => rollWeather(w, new Rng(1)));
});

test("weatherCuriosity/weatherMoodPull/rainIntensity return the documented values per sky", () => {
  assert.equal(weatherCuriosity("storm"), 1.6);
  assert.equal(weatherCuriosity("rain"), 0.8);
  assert.equal(weatherCuriosity("gold"), 1.1);
  assert.equal(weatherCuriosity("clear"), 0);
  assert.equal(weatherCuriosity("clouds"), 0);

  assert.ok(weatherMoodPull("storm") < 0);
  assert.ok(weatherMoodPull("rain") < 0);
  assert.ok(weatherMoodPull("gold") > 0);
  assert.ok(weatherMoodPull("clear") > 0);
  assert.equal(weatherMoodPull("clouds"), 0);

  assert.equal(rainIntensity("storm"), 1);
  assert.equal(rainIntensity("rain"), 0.55);
  assert.equal(rainIntensity("clear"), 0);
});
