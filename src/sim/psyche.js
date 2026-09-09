// Some mornings the inner voice isn't one voice. A push-half and an ease-half
// argue, one wins, and the day tilts that way — work harder, or go gentler.
// The transcript keeps the argument so viewers can watch it happen.

export function freshPsyche() {
  return { conflictDay: 0, lean: "even", leanUntil: 0, argument: null };
}

// call each new day: maybe today is a two-minds day
export function rollPsyche(w, rng) {
  w.psyche = w.psyche || freshPsyche();
  // more likely when stretched thin or when money/rep is bad
  const strain =
    (w.reputation < 40 ? 0.12 : 0) +
    (w.finances?.broke ? 0.14 : 0) +
    (w.mood?.valence < -0.3 ? 0.1 : 0);
  if (rng.chance(0.12 + strain)) {
    w.psyche.conflictDay = w.day;
    w.psyche.lean = "even"; // decided by the morning dialogue
    w.psyche.leanUntil = w.day; // resolved for today only
    return true;
  }
  return false;
}

export function isConflictToday(w) {
  return (w.psyche?.conflictDay || 0) === w.day;
}

// the morning dialogue resolves the argument
export function resolveLean(w, lean, argument) {
  w.psyche = w.psyche || freshPsyche();
  const v = lean === "push" || lean === "ease" ? lean : "even";
  w.psyche.lean = v;
  w.psyche.leanUntil = w.day;
  if (typeof argument === "string") w.psyche.argument = argument.replace(/[<>]/g, "").slice(0, 240);
  return v;
}

// multipliers for the utility AI, active only on the day it was set
export function psycheMods(w) {
  const p = w.psyche;
  if (!p || p.leanUntil !== w.day || p.lean === "even") return { work: 1, ease: 1 };
  if (p.lean === "push") return { work: 1.35, ease: 0.7 };
  return { work: 0.7, ease: 1.4 }; // ease
}

export function psycheLine(w) {
  if (!isConflictToday(w)) return "";
  const p = w.psyche || {};
  if (p.lean === "push") return "This morning two of you argued; the one that wants to push won.";
  if (p.lean === "ease") return "This morning two of you argued; the one that wants to ease off won.";
  return "You woke up of two minds — one says push, one says rest. Decide which wins today.";
}
