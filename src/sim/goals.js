// A multi-day goal the AI sets for itself at dawn. The server checks progress
// each day; hitting it or letting it lapse both leave a memory.

export const GOAL_METRICS = {
  bank: { label: "save up", read: (w) => Math.round(w.bank) },
  games: { label: "make games", read: (w) => w.gamesCount || 0 },
  objects: { label: "furnish the place", read: (w) => Object.values(w.rooms).reduce((n, a) => n + a.length, 0) },
  memories: { label: "learn things", read: (w) => w.memory.total || w.memory.slots.length },
  reputation: { label: "be trusted", read: (w) => Math.round(w.reputation) },
  days: { label: "just keep going", read: (w) => w.day },
};

export function makeGoal(raw, w) {
  const metric = String(raw && raw.metric);
  const m = GOAL_METRICS[metric];
  if (!m) return null;
  let target = Math.round(Number(raw.target) || 0);
  if (metric === "days") {
    target = w.day + Math.max(3, Math.min(20, target || 7));
  } else if (!target || target <= m.read(w)) {
    return null;
  }
  return {
    text: String((raw && raw.text) || m.label).slice(0, 80),
    metric,
    target,
    start: m.read(w),
    startDay: w.day,
    done: false,
    failed: false,
  };
}

export function goalFrac(w) {
  const g = w.goal;
  if (!g || g.done || g.failed) return null;
  const cur = GOAL_METRICS[g.metric].read(w);
  const denom = g.metric === "days" ? g.target - g.startDay : g.target - g.start;
  const num = g.metric === "days" ? w.day - g.startDay : cur - g.start;
  return Math.max(0, Math.min(1, denom > 0 ? num / denom : 0));
}

// "done" | "failed" | null — call once per in-game day
export function checkGoal(w) {
  const g = w.goal;
  if (!g || g.done || g.failed) return null;
  const cur = GOAL_METRICS[g.metric].read(w);
  const hit = g.metric === "days" ? w.day >= g.target : cur >= g.target;
  if (hit) {
    g.done = true;
    return "done";
  }
  if (w.day - g.startDay > 14) {
    g.failed = true;
    return "failed";
  }
  return null;
}
