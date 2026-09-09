// The world past the window: seasons on a 20-day cycle, a recurring neighbour,
// and season-flavoured events. Weather (weather.js) biases toward the season.

export const SEASONS = ["spring", "summer", "autumn", "winter"];
const SEASON_LEN = 20;

export function seasonFor(day) {
  return SEASONS[Math.floor((day - 1) / SEASON_LEN) % 4];
}

export const SEASON_TINT = {
  spring: "rgba(150,205,130,0.06)",
  summer: "rgba(240,205,120,0.06)",
  autumn: "rgba(220,150,90,0.09)",
  winter: "rgba(150,180,225,0.11)",
};

const NEIGHBOURS = [
  "the man with the greyhound",
  "the kid on the third floor",
  "the woman who waters her balcony",
  "the courier who always waves",
  "the old couple by the corner shop",
  "the busker who sets up on Fridays",
];

const EVENTS = {
  spring: ["blossom on the wind", "a robin working on a nest", "the first warm rain", "kids chalking the pavement", "a window box in full flower"],
  summer: ["heat shimmer off the road", "a sprinkler ticking across the street", "a thunderhead stacking up", "someone's radio drifting up", "swifts screaming past the glass"],
  autumn: ["leaves scraping the kerb", "fog that won't lift", "the streetlights on at four", "a kite tangled in a plane tree", "someone raking, endlessly"],
  winter: ["frost feathering the glass", "a thin snow flurry", "breath-clouds on the pavement", "the shortest afternoon", "a gritter grinding past"],
};

export function freshOutside(rng) {
  return { season: "spring", neighbour: rng.pick(NEIGHBOURS), neighbourSeenDay: 0, lastEvent: "" };
}

export function stepOutside(w, rng) {
  const s = seasonFor(w.day);
  if (w.outside.season !== s) {
    w.outside.season = s;
    w.outside.neighbour = rng.pick(NEIGHBOURS); // people move
    w.fx.push("event");
  }
}

export function windowEventPool(w, rng) {
  const pool = EVENTS[w.outside.season] || EVENTS.spring;
  // ~1 in 5 window events feature the neighbour
  if (rng.chance(0.2)) {
    w.outside.neighbourSeenDay = w.day;
    return `${w.outside.neighbour}, out there again`;
  }
  return rng.pick(pool);
}

// bias the synthetic sky toward the season (weather.js can call this)
export function seasonSky(season, rng) {
  const by = {
    spring: ["clear", "clouds", "rain"],
    summer: ["clear", "clear", "gold", "storm"],
    autumn: ["clouds", "clouds", "rain", "clear"],
    winter: ["clouds", "clouds", "clear", "storm"],
  };
  return rng.pick(by[season] || by.spring);
}
