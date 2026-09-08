// M5 — weather. A slowly drifting sky state, visible through the window and felt
// as a small pull on the agent's curiosity. Separate from the rare one-off
// "something passed the window" events.

export const SKIES = ["clear", "clouds", "rain", "storm", "gold"];

const NEXT = {
  clear: ["clear", "clouds", "clouds", "gold"],
  clouds: ["clear", "clouds", "rain", "rain"],
  rain: ["clouds", "rain", "storm"],
  storm: ["rain", "clouds"],
  gold: ["clear", "clouds"],
};

export function freshWeather(rng) {
  return { sky: "clouds", flash: 0, changeIn: rng.range(40, 90) };
}

export function stepWeather(w, dt, rng) {
  const weather = w.weather;
  weather.changeIn -= dt;
  if (weather.flash > 0) weather.flash -= dt;

  if (weather.sky === "storm" && rng.chance(dt * 0.35)) weather.flash = 0.16;

  if (weather.changeIn <= 0) {
    weather.sky = rng.pick(NEXT[weather.sky]);
    weather.changeIn = rng.range(45, 120);
    return true; // changed
  }
  return false;
}

// small continuous nudge to curiosity while the agent is at the window
export function weatherCuriosity(sky) {
  if (sky === "storm") return 1.6;
  if (sky === "rain") return 0.8;
  if (sky === "gold") return 1.1;
  return 0;
}

export function rainIntensity(sky) {
  if (sky === "storm") return 1;
  if (sky === "rain") return 0.55;
  return 0;
}
