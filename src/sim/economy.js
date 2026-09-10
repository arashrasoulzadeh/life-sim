// Money is not just a pile that grows. Rent falls due every week, appliances
// draw power, the cat eats. When the bank runs dry the life changes shape:
// it works harder, it can't buy, it may have to sell things it likes.

import { OBJECTS } from "./objects.js";
import { residentsIncome } from "./persons.js";

export const RENT = 55; // charged every RENT_EVERY days
export const RENT_EVERY = 7;
export const RENT_GRACE_DAY = 8; // no rent before this — a new life finds its feet
export const DAILY_REWARD = 50; // a stipend paid every morning
const BASE_UPKEEP = 2.5; // heat / water / the basics, per day
const APPLIANCE_DRAW = 1.2; // per owned appliance, per day
const CAT_FOOD = 2; // per day, if there's a cat

function ownedAppliances(w) {
  let n = 0;
  for (const ids of Object.values(w.rooms || {})) {
    for (const id of ids) if (OBJECTS[id]?.cat === "appliance") n++;
  }
  return n;
}

// the daily running cost (not counting rent)
export function upkeepPerDay(w) {
  return BASE_UPKEEP + APPLIANCE_DRAW * ownedAppliances(w) + (w.pet ? CAT_FOOD : 0) + 1.6 * (w.extras || []).length;
}

export function freshFinances() {
  return { broke: false, brokeSince: 0, lastRentDay: 0, missedRent: 0 };
}

// called once per new day, before dialogue. Returns a list of ledger lines
// { kind, amount, note } for the server to record.
export function chargeDay(w) {
  w.finances = w.finances || freshFinances();
  const lines = [];

  w.bank += DAILY_REWARD;
  lines.push({ kind: "reward", amount: DAILY_REWARD, note: "daily reward" });

  const housemates = residentsIncome(w);
  if (housemates > 0) {
    w.bank += housemates;
    lines.push({ kind: "housemates", amount: housemates, note: `housemates (${(w.extras || []).filter((r) => r.income > 0).length})` });
  }

  const up = Math.round(upkeepPerDay(w) * 100) / 100;
  w.bank -= up;
  lines.push({ kind: "upkeep", amount: -up, note: "daily upkeep" });

  if (w.day >= RENT_GRACE_DAY && w.day - (w.finances.lastRentDay || 0) >= RENT_EVERY) {
    w.finances.lastRentDay = w.day;
    if (w.bank >= RENT) {
      w.bank -= RENT;
      lines.push({ kind: "rent", amount: -RENT, note: "rent" });
      w.finances.missedRent = 0;
    } else {
      w.finances.missedRent = (w.finances.missedRent || 0) + 1;
      lines.push({ kind: "rent", amount: 0, note: `rent missed (${w.finances.missedRent})` });
      w.memory.slots.push({
        id: w.memory.nextId++, kind: "spoken",
        text: w.finances.missedRent > 1 ? "Rent's overdue again. This is bad." : "Couldn't make rent this week.",
        trait: "diligence", dir: -1, mag: 0.03, weight: 1.2, bornDay: w.day,
      });
      w.memory.total = (w.memory.total || 0) + 1;
    }
  }

  const wasBroke = w.finances.broke;
  w.finances.broke = w.bank < 10;
  if (w.finances.broke && !wasBroke) {
    w.finances.brokeSince = w.day;
    w.fx.push("event");
  } else if (!w.finances.broke) {
    w.finances.brokeSince = 0;
  }

  return lines;
}

// multipliers the utility AI uses when money is tight. Buying is only hard-
// blocked when genuinely broke; otherwise the evening buy loop's own
// affordability check (bank >= price) is the gate.
export function economyMods(w) {
  const f = w.finances || freshFinances();
  if (!f.broke) return { work: 1, buyAllowed: true, mood: 0 };
  const days = Math.max(1, w.day - (f.brokeSince || w.day));
  return {
    work: 1.3 + Math.min(0.7, days * 0.06),
    buyAllowed: (w.bank || 0) >= 40, // still allow a modest buy if there's a cushion
    mood: -0.02 - Math.min(0.03, days * 0.004),
  };
}

export function financeLine(w) {
  const f = w.finances || freshFinances();
  const up = Math.round(upkeepPerDay(w));
  const dueIn = RENT_EVERY - (w.day - (f.lastRentDay || 0));
  const hm = residentsIncome(w);
  const parts = [`upkeep ~${up}c/day`, `rent ${RENT}c in ${Math.max(0, dueIn)}d`];
  if (hm) parts.push(`housemates +${hm}c/day`);
  if (f.broke) parts.push("BROKE — no spending");
  if (f.missedRent) parts.push(`${f.missedRent} rent missed`);
  return parts.join(" · ");
}
