// M5 — weather. The sky turns over once per in-game day (rolled at dawn,
// alongside the rest of the daily rollover) and leans toward the mood the
// day before ended on — a good run nudges toward clear/gold, a bad one
// toward rain/storm. Separate from the rare one-off "something passed the
// window" events. Storm flashes still tick continuously for the visual.

export const SKIES = ["clear", "clouds", "rain", "storm", "gold"];

const NEXT = {
  clear: ["clear", "clouds", "clouds", "gold"],
  clouds: ["clear", "clouds", "rain", "rain"],
  rain: ["clouds", "rain", "storm"],
  storm: ["rain", "clouds"],
  gold: ["clear", "clouds"],
};

export function freshWeather(rng) {
  return { sky: "clouds", flash: 0, day: 0, history: [] };
}

// per-tick upkeep: only the storm flash animates continuously now
export function stepWeather(w, dt, rng) {
  const weather = w.weather;
  if (weather.flash > 0) weather.flash -= dt;
  if (weather.sky === "storm" && rng.chance(dt * 0.35)) weather.flash = 0.16;
  return false;
}

// once per game day — pick tomorrow's sky, leaning on how the mood has been
export function rollWeather(w, rng) {
  const weather = w.weather;
  const valence = w.mood?.valence ?? 0;
  let options = NEXT[weather.sky] || NEXT.clouds;
  if (valence > 0.3) options = options.concat(["clear", "gold", "gold"]);
  else if (valence < -0.3) options = options.concat(["rain", "storm"]);
  weather.sky = rng.pick(options);
  weather.day = w.day;
  weather.history = [...(weather.history || []), { day: w.day, sky: weather.sky, valence: +valence.toFixed(2) }].slice(-20);
  return true;
}

// small continuous nudge to curiosity while the agent is at the window
export function weatherCuriosity(sky) {
  if (sky === "storm") return 1.6;
  if (sky === "rain") return 0.8;
  if (sky === "gold") return 1.1;
  return 0;
}

// a gentler, always-on pull on mood from the sky itself — a storm wears on
// everyone a little, a golden sky lifts things, independent of the window
export function weatherMoodPull(sky) {
  if (sky === "storm") return -0.012;
  if (sky === "rain") return -0.006;
  if (sky === "gold") return 0.013;
  if (sky === "clear") return 0.004;
  return 0;
}

export function rainIntensity(sky) {
  if (sky === "storm") return 1;
  if (sky === "rain") return 0.55;
  return 0;
}
