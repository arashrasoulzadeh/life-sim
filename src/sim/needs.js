import { NEED_IDS } from "./constants.js";

export function freshNeeds() {
  return { focus: 70, energy: 80, social: 55, curiosity: 60 };
}

// Baseline decay per real-second, before personality and phase modifiers.
const BASE_DECAY = {
  focus: 0.62,
  energy: 0.5,
  social: 0.42,
  curiosity: 0.6,
};

export function decayNeeds(needs, p, dt, isNight) {
  for (const id of NEED_IDS) {
    let rate = BASE_DECAY[id] * (1 + p.restlessness * 0.5);
    if (isNight && id === "energy") rate *= 1.7; // tiredness compounds at night
    if (isNight && id === "social") rate *= 0.4; // nobody expects you at 3am
    needs[id] = clamp(needs[id] - rate * dt);
  }
}

export function applyEffect(needs, effect, dt) {
  for (const id of NEED_IDS) {
    const e = effect[id];
    if (e) needs[id] = clamp(needs[id] + e * dt);
  }
}

// Pressure: comfortable while high, rising urgency below ~45, near-panic below 15.
export function pressure(value) {
  const v = value / 100;
  if (v >= 0.45) return 0.15 * (1 - v);
  if (v >= 0.15) return 0.4 + (0.45 - v) * 2.2;
  return 1.1 + (0.15 - v) * 6;
}

export function clamp(v, lo = 0, hi = 100) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lowestNeed(needs) {
  let best = "focus";
  for (const id of NEED_IDS) if (needs[id] < needs[best]) best = id;
  return { id: best, value: needs[best] };
}
