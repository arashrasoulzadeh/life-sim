// M4 — memory + personality drift + forgetting.
// The agent writes short memories from what actually happened that day. Each one
// permanently nudges a personality trait; recurring themes reinforce an existing
// memory instead of adding a new slot; the grid is small, so old faint memories
// are overwritten and their nudge partly relaxes back. This is what makes a life
// on day 40 diverge from the same life on day 4.

// Working-set size held in RAM / the state snapshot. Memory itself is infinite —
// everything ever written lives in the SQLite `memories` table (server.mjs).
// When `slots` overflows, the faintest is dropped from the working set but its
// personality nudge is permanent and the row is kept in the DB.
export const MEMORY_SLOTS = 48;
export const TRAITS = ["diligence", "sociability", "curiosity", "restlessness"];

const TRAIT_MIN = 0.05;
const TRAIT_MAX = 1.2;

export function freshMemory() {
  return {
    slots: [], // working set — { id, kind, text, trait, dir, mag, weight, bornDay }
    overflow: [], // dropped from the working set this tick; server flushes to SQLite
    nextId: 1,
    lastWrittenDay: 0,
    latestText: "",
    total: 0, // lifetime count (for the viewer)
  };
}

// Themes. `salience(d)` returns how strongly today evoked this theme (0 = not at
// all). The strongest theme becomes the memory — but a theme already written and
// still strong gets steep diminishing returns, so the grid fills with variety
// rather than the same lesson every night.
const THEMES = [
  {
    kind: "grind",
    salience: (d) => (d.resolved >= 12 ? Math.min(1, (d.resolved - 8) / 16) : 0),
    build: (d) => ({
      text: `Day ${d.day}: ${d.resolved} requests, all cleared.`,
      trait: "diligence",
      dir: 1,
      mag: 0.04,
    }),
  },
  {
    kind: "overwork",
    salience: (d) => (d.minFocus <= 8 && d.resolved >= 3 ? 1 - d.minFocus / 8 : 0),
    build: () => ({
      text: "Rushed while I couldn't think straight. Mistakes.",
      trait: "diligence",
      dir: -1,
      mag: 0.05,
    }),
  },
  {
    kind: "lonely",
    salience: (d) => (d.minSocial <= 12 ? 1 - d.minSocial / 12 : 0),
    build: () => ({
      text: "Nobody messaged back today.",
      trait: "sociability",
      dir: 1,
      mag: 0.045,
    }),
  },
  {
    kind: "wonder",
    salience: (d) => Math.min(1, d.windowEvents * 0.6),
    build: () => ({
      text: "Something moved on the horizon. Kept watching.",
      trait: "curiosity",
      dir: 1,
      mag: 0.05,
    }),
  },
  {
    kind: "trusted",
    salience: (d) => (d.repAvg >= 72 ? Math.min(1, (d.repAvg - 68) / 25) : 0),
    build: () => ({
      text: "People seem to trust me lately.",
      trait: "diligence",
      dir: 1,
      mag: 0.025,
    }),
  },
  {
    kind: "adrift",
    salience: (d) => (d.repAvg <= 34 ? Math.min(1, (36 - d.repAvg) / 24) : 0),
    build: () => ({
      text: "Fell behind. The queue kept growing.",
      trait: "diligence",
      dir: 1,
      mag: 0.03,
    }),
  },
  {
    kind: "restless",
    salience: (d) => Math.min(1, d.paceCount / 6),
    build: () => ({
      text: "Couldn't sit still. Paced the room all day.",
      trait: "restlessness",
      dir: -1,
      mag: 0.035,
    }),
  },
  {
    kind: "quiet",
    salience: () => 0.12,
    build: (d) => ({
      text: `Day ${d.day}: an ordinary day. Nothing to report.`,
      trait: TRAITS[d.day % TRAITS.length],
      dir: d.day % 2 ? 1 : -1,
      mag: 0.012,
    }),
  },
];

function chooseTheme(mem, day, rng) {
  let best = THEMES[THEMES.length - 1];
  let bestScore = -1;
  for (const theme of THEMES) {
    let score = theme.salience(day);
    if (score <= 0) continue;
    const existing = mem.slots.find((s) => s.kind === theme.kind);
    if (existing) score *= 0.4 / (1 + existing.weight); // don't relearn the same lesson nightly
    score *= rng.range(0.8, 1.2);
    if (score > bestScore) {
      bestScore = score;
      best = theme;
    }
  }
  return best;
}

function applyDrift(personality, trait, delta) {
  personality[trait] = clampTrait(personality[trait] + delta);
}

function clampTrait(v) {
  return v < TRAIT_MIN ? TRAIT_MIN : v > TRAIT_MAX ? TRAIT_MAX : v;
}

// Called when the agent finishes a `reflect` action. `day` tallies come from the world.
export function writeMemory(mem, personality, rng, day) {
  const theme = chooseTheme(mem, day, rng);
  const seed = theme.build(day);

  const existing = mem.slots.find((s) => s.kind === theme.kind);
  if (existing) {
    // reinforcement — the lesson lands harder, no new slot
    existing.weight = Math.min(4, existing.weight + 0.7);
    existing.text = seed.text;
    applyDrift(personality, seed.trait, seed.dir * seed.mag * 0.5);
    mem.latestText = `still true: ${seed.text}`;
    mem.lastWrittenDay = day.day;
    return existing;
  }

  const record = {
    id: mem.nextId++,
    kind: theme.kind,
    text: seed.text,
    trait: seed.trait,
    dir: seed.dir,
    mag: seed.mag,
    weight: 1,
    bornDay: day.day,
  };
  applyDrift(personality, record.trait, record.dir * record.mag);

  mem.slots.push(record);
  mem.overflow = mem.overflow || [];
  while (mem.slots.length > MEMORY_SLOTS) {
    // drop the faintest from the working set — the nudge stays, the DB keeps the row
    let faint = 0;
    for (let i = 1; i < mem.slots.length; i++) {
      if (mem.slots[i].weight < mem.slots[faint].weight) faint = i;
    }
    mem.overflow.push(mem.slots.splice(faint, 1)[0]);
  }

  mem.latestText = `wrote: ${seed.text}`;
  mem.lastWrittenDay = day.day;
  return record;
}

// Called once per in-game day. Memories fade toward dormant but are never
// deleted — the server consolidates dormant rows into digests.
export function ageMemory(mem) {
  for (const s of mem.slots) s.weight = Math.max(0, s.weight - 0.045);
  mem.overflow = mem.overflow || [];
  while (mem.slots.length > MEMORY_SLOTS) {
    let faint = 0;
    for (let i = 1; i < mem.slots.length; i++) {
      if (mem.slots[i].weight < mem.slots[faint].weight) faint = i;
    }
    mem.overflow.push(mem.slots.splice(faint, 1)[0]);
  }
}
