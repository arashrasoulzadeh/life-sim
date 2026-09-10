// Everyone who lives here. people[0] is the AI (world.agent), people[1] the
// spouse (world.partner); after that, up to 8 more residents — lighter agents
// that wander, gravitate toward the others, and can be added / renamed /
// restyled / removed by the AI. The whole roster is mirrored to
// worlds/<seed>/persons.json.

import { makeAgent, stepAgent, stepRoutine } from "./agent.js";
import { decayNeeds } from "./needs.js";

export const MAX_PEOPLE = 10;

const NAMES_F = ["Mara", "Ines", "Sofia", "Nadia", "Lena", "Priya", "Cora", "Yuki", "Ada", "Rosa", "Tavi", "Elif", "June", "Wren", "Nour"];
const NAMES_M = ["Arto", "Sam", "Dario", "Noor", "Kai", "Ravi", "Bo", "Jun", "Idris", "Milo", "Otto", "Reza", "Theo", "Alp", "Cy"];
const NAMES_N = ["Ash", "Robin", "Sky", "Marlo", "Frankie", "Pax", "Lux", "Ari", "Ozzie", "Sol"];
const SKINS = ["#f0d9b8", "#e6c9a0", "#d9b48a", "#c99a6f", "#a9764f", "#8a5a3a"];
const SHIRTS = ["#8fb8e8", "#7ad0a0", "#e0b45c", "#c98bd0", "#e0715c", "#9a8fe8", "#7f9a6a", "#6bb0b8"];
const HAIRS = ["#221c18", "#3a2a1a", "#5a3a22", "#111111", "#7a6a58", "#a0a0a8"];

function pickName(rng, gender, taken) {
  const pool = gender === "f" ? NAMES_F : gender === "m" ? NAMES_M : NAMES_N;
  const free = pool.filter((n) => !taken.has(n));
  return (free.length ? rng.pick(free) : pool[rng.int(0, pool.length)]) || "Guest";
}
function look(rng, gender) {
  return {
    skin: rng.pick(SKINS),
    shirt: rng.pick(SHIRTS),
    hair: rng.pick(HAIRS),
    long: gender === "f" ? rng.chance(0.7) : rng.chance(0.2),
    visor: "#3a4a8a",
  };
}

// a per-day contribution to the household, roughly from what the role sounds like
const INCOME_HINTS = [
  [/lodger|tenant|renter|boarder|room.?mate/i, [12, 22]],
  [/work|job|office|nurse|teach|engineer|clerk|shop|drive|cook|chef|dev|design|code/i, [22, 40]],
  [/student|studies|intern|apprentic/i, [4, 12]],
  [/artist|writer|musician|paint|freelanc/i, [8, 24]],
  [/retire|pension/i, [14, 20]],
  [/kid|child|baby|niece|nephew|cousin/i, [0, 0]],
];
function incomeFor(role, rng) {
  for (const [re, [lo, hi]] of INCOME_HINTS) if (re.test(role || "")) return Math.round(rng.range(lo, hi));
  return Math.round(rng.range(8, 20)); // a housemate who chips in
}

// build one resident agent
export function makeResident(rng, opts = {}, taken = new Set()) {
  const gender = ["f", "m", "n"].includes(opts.gender) ? opts.gender : rng.pick(["f", "m", "n"]);
  const name = String(opts.name || "").trim().slice(0, 16) || pickName(rng, gender, taken);
  const a = makeAgent(rng, { name, gender, look: opts.look || look(rng, gender), offset: rng.range(-50, 50) });
  a.role = String(opts.role || "").replace(/[<>]/g, "").trim().slice(0, 40);
  a.income = Number.isFinite(opts.income) ? Math.max(0, Math.min(60, Math.round(opts.income))) : incomeFor(a.role, rng);
  a.room = opts.room || "couch";
  a.resident = true;
  return a;
}

// total coins/day the residents bring in
export function residentsIncome(w) {
  return (w.extras || []).reduce((s, r) => s + (Number(r.income) || 0), 0);
}

const noop = () => {};

// one light utility step for a resident
export function stepResident(w, r, dt, rng) {
  decayNeeds(r.needs, r.personality, dt, w.isNight, w.era.decayMul || 1);
  if (!w.isNight && stepRoutine(r, dt)) return;
  const anchor = w.agent.room;
  stepAgent(
    r,
    dt,
    {
      isNight: w.isNight,
      requestsWaiting: 0,
      wantsReflect: false,
      thirstyRoom: null,
      speedMul: w.era.speedMul ?? 1,
      rhythm: { work: 0.05, play: 1.15 },
      voteBias: null,
      partnerRoom: anchor,
      togetherWant: 0.35,
      onWater: noop,
      onTinker: noop,
      onRequestResolved: noop,
      onReflect: noop,
    },
    rng,
  );
}

// ---- roster ops (called from dialogue) ----
function nameOf(p) {
  return (p && p.name) || "";
}
function findPerson(w, who) {
  const all = allPeople(w);
  if (typeof who === "number") return all[who] || null;
  const s = String(who || "").toLowerCase().trim();
  return all.find((p) => nameOf(p).toLowerCase() === s) || null;
}

export function allPeople(w) {
  return [w.agent, w.partner, ...(w.extras || [])].filter(Boolean);
}

export function applyPeopleOps(w, ops, rng) {
  if (!Array.isArray(ops)) return [];
  w.extras = w.extras || [];
  const notes = [];
  for (const op of ops.slice(0, 6)) {
    const kind = String(op?.op || "");
    if (kind === "add") {
      if (allPeople(w).length >= MAX_PEOPLE) {
        notes.push("the flat is full");
        continue;
      }
      const taken = new Set(allPeople(w).map((p) => nameOf(p)));
      const r = makeResident(rng, op, taken);
      w.extras.push(r);
      notes.push(`＋ ${r.name} moved in${r.role ? ` (${r.role})` : ""}${r.income ? ` · +${r.income}c/day` : ""}`);
    } else if (kind === "rename") {
      const p = findPerson(w, op.who);
      const nm = String(op.name || "").replace(/[<>\n]/g, "").trim().slice(0, 16);
      if (p && nm) {
        const old = p.name;
        p.name = nm;
        notes.push(`✎ ${old} → ${nm}`);
      }
    } else if (kind === "restyle") {
      const p = findPerson(w, op.who);
      if (p && op.look && typeof op.look === "object") {
        p.look = p.look || {};
        for (const k of ["skin", "shirt", "hair", "visor"]) {
          if (typeof op.look[k] === "string" && /^#[0-9a-fA-F]{6}$/.test(op.look[k])) p.look[k] = op.look[k].toLowerCase();
        }
        if (typeof op.look.long === "boolean") p.look.long = op.look.long;
        notes.push(`🎨 ${p.name} changed their look`);
      }
    } else if (kind === "role") {
      const p = findPerson(w, op.who);
      if (p) {
        p.role = String(op.role || "").replace(/[<>]/g, "").trim().slice(0, 40);
        if (Number.isFinite(op.income)) p.income = Math.max(0, Math.min(60, Math.round(op.income)));
        notes.push(`${p.name}: ${p.role || "—"}${p.income != null ? ` (+${p.income}c/day)` : ""}`);
      }
    } else if (kind === "income") {
      const p = findPerson(w, op.who);
      if (p && Number.isFinite(op.amount)) {
        p.income = Math.max(0, Math.min(60, Math.round(op.amount)));
        notes.push(`${p.name} now brings +${p.income}c/day`);
      }
    } else if (kind === "remove") {
      const p = findPerson(w, op.who);
      const i = (w.extras || []).indexOf(p);
      if (i >= 0) {
        w.extras.splice(i, 1);
        notes.push(`− ${p.name} moved out`);
      }
    }
  }
  return notes;
}

// ---- persons.json shape ----
export function personsFile(w) {
  const one = (p, slot) => ({
    slot,
    name: p.name || "",
    gender: p.gender || "n",
    role: p.role || (slot === "you" ? "the assistant" : slot === "spouse" ? "spouse" : ""),
    income: slot === "resident" ? Number(p.income) || 0 : undefined,
    look: p.look || {},
    personality: p.personality || {},
  });
  return {
    seed: w.seed,
    updated: new Date().toISOString(),
    people: [one(w.agent, "you"), ...(w.partner ? [one(w.partner, "spouse")] : []), ...(w.extras || []).map((p) => one(p, "resident"))],
  };
}

// hydrate names / looks / roles / personality from a persons.json (positions
// and needs still come from the snapshot). Returns the extras array.
export function hydrateFromFile(w, data, rng) {
  if (!data || !Array.isArray(data.people)) return;
  const rows = data.people;
  const applyOne = (p, row) => {
    if (!p || !row) return;
    if (row.name) p.name = String(row.name).slice(0, 16);
    if (row.gender) p.gender = row.gender;
    if (row.role) p.role = String(row.role).slice(0, 40);
    if (Number.isFinite(row.income)) p.income = Math.max(0, Math.min(60, Math.round(row.income)));
    if (row.look && typeof row.look === "object") p.look = { ...p.look, ...row.look };
    if (row.personality && typeof row.personality === "object") p.personality = { ...p.personality, ...row.personality };
  };
  applyOne(w.agent, rows.find((r) => r.slot === "you"));
  if (w.partner) applyOne(w.partner, rows.find((r) => r.slot === "spouse"));
  const residents = rows.filter((r) => r.slot === "resident").slice(0, MAX_PEOPLE - 2);
  const taken = new Set([w.agent, w.partner].filter(Boolean).map((p) => p.name));
  w.extras = (w.extras && w.extras.length ? w.extras : []).slice(0, residents.length);
  residents.forEach((row, i) => {
    if (w.extras[i]) applyOne(w.extras[i], row);
    else w.extras.push(makeResident(rng, row, taken));
    taken.add(w.extras[i].name);
  });
}
