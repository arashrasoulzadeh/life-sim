// M5 — mood. A slow exponential average of how well needs are being met, plus a
// faster "strain" reading of the single worst need. Mood colours the idle
// animation, walk speed, and the tone of the thought line — it never decides
// actions itself.

export function freshMood() {
  return { valence: 0.55, strain: 0.2 };
}

export function updateMood(mood, needs, dt) {
  const avg = (needs.focus + needs.energy + needs.social + needs.curiosity) / 400;
  const worst = Math.min(needs.focus, needs.energy, needs.social, needs.curiosity) / 100;

  const slow = 1 - Math.exp(-dt / 45); // ~45s time constant
  const fast = 1 - Math.exp(-dt / 12);
  mood.valence += (avg - mood.valence) * slow;
  mood.strain += (1 - worst - mood.strain) * fast;
}

export function moodWord(mood) {
  if (mood.valence > 0.66) return "bright";
  if (mood.valence > 0.46) return "steady";
  if (mood.valence > 0.3) return "worn";
  return "low";
}

// -1 (slumped) .. +1 (light on its feet)
export function moodPosture(mood) {
  return mood.valence * 2 - 1 - mood.strain * 0.6;
}
