// A week has a shape. Weekdays lean toward work; weekends toward rest and play.
// Some days are just bad. The AI can describe how it wants its week to feel
// (weekStyle) — flavour that shows up in the journal and nudges nothing unsafe.

export const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function dowOf(day) {
  return ((day - 1) % 7 + 7) % 7;
}
export function isWeekend(day) {
  return dowOf(day) >= 5;
}

export function freshRhythm() {
  return { dow: 0, dowName: "Mon", weekend: false, badDay: false, weekStyle: "" };
}

// cheap per-tick sync (no randomness)
export function stepRhythm(w) {
  w.rhythm = w.rhythm || freshRhythm();
  const d = dowOf(w.day);
  w.rhythm.dow = d;
  w.rhythm.dowName = DOW[d];
  w.rhythm.weekend = d >= 5;
}

// once per new day — rolls whether today is a bad day
export function rollRhythm(w, rng) {
  w.rhythm = w.rhythm || freshRhythm();
  stepRhythm(w);
  w.rhythm.badDay = rng.chance(w.rhythm.weekend ? 0.07 : 0.15);
}

// multipliers the utility AI and mood use
export function rhythmMods(w) {
  const r = w.rhythm || freshRhythm();
  return {
    work: (r.weekend ? 0.55 : 1) * (r.badDay ? 0.7 : 1),
    play: (r.weekend ? 1.5 : 1) * (r.badDay ? 1.2 : 1),
    speedMul: r.badDay ? 0.82 : 1,
    moodBias: r.badDay ? -0.02 : r.weekend ? 0.008 : 0,
  };
}

export function setWeekStyle(w, raw) {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[<>]/g, "").trim().slice(0, 80);
  if (s.length < 3) return null;
  w.rhythm = w.rhythm || freshRhythm();
  w.rhythm.weekStyle = s;
  return s;
}
