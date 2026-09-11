// Builds the morning / evening prompt from the world + a server-assembled context,
// and safely applies the reply. The model NEVER supplies code — it picks from
// closed vocabularies (room objects, game kernels, routine moves, hex colours)
// and every field is validated here before it touches the world.

import { OBJECTS, MARKET, priceOf, sellValue, isSellable } from "./objects.js";
import { TRAITS } from "./memory.js";
import { ROOM_IDS } from "./rooms.js";
import { ROUTINE_OPS } from "./agent.js";
import { KERNELS, validateSpec } from "../game/kernels.js";
import { gates } from "./skills.js";
import { GOAL_METRICS, makeGoal, goalFrac } from "./goals.js";
import { setWeekStyle } from "./rhythm.js";
import { namePet, petLabel } from "./pet.js";
import { financeLine, economyMods } from "./economy.js";
import { spouseWord } from "./people.js";
import { psycheLine, isConflictToday, resolveLean } from "./psyche.js";
import { canWrite, cleanWriting, writingPrompt } from "./writing.js";
import { isBroken, repair, repairCost, wearPct } from "./wear.js";
import { WALL_PATTERNS, FLOOR_PATTERNS, roomStyle } from "./roomrender.js";
import { applyPeopleOps, allPeople, MAX_PEOPLE } from "./persons.js";
import { cleanArt, ART_HELP } from "./itemart.js";
import { setPaintings, MAX_PAINTINGS } from "./paintings.js";
import { ART_STYLES, cleanWindowArt, windowArtLabel } from "./windowart.js";

const VOTE_LABELS = { work: "work hard", rest: "rest & recover", social: "reach out to others", learn: "learn something", tend: "tend the home" };

export const GAME_COST = 0; // making a game is free — it only costs the AI a decision
const HEX = /^#[0-9a-fA-F]{6}$/;

function clampTrait(v) {
  return v < 0.05 ? 0.05 : v > 1.2 ? 1.2 : v;
}
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const arr = (v) => (Array.isArray(v) ? v : []);

// ---------- prompt ----------
export function buildPrompt(w, phase, ctx = {}) {
  const p = w.agent.personality;
  const evening = phase === "evening";

  const mems = w.memory.slots
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((s) => `- ${s.text} (${s.trait}${s.dir > 0 ? "+" : "-"}, ${s.weight.toFixed(1)})`);
  const digests = (ctx.digests || []).map((d) => `- [month ${d.month}] ${d.summary}`);
  const memBlock = [
    ctx.lifeSummary ? `Life so far: ${ctx.lifeSummary}` : "",
    mems.join("\n") || "- (none yet)",
    digests.length ? "Older:\n" + digests.join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");

  const rs = (r) => {
    try {
      return roomStyle(r, w.roomStyle);
    } catch {
      return null;
    }
  };
  const rooms = w.roomOrder
    .map((r) => {
      const items = (w.rooms[r] || []).map((id) => `${id} (${OBJECTS[id]?.label || "?"}, ${priceOf(id)}c)`).join(", ") || "bare";
      const st = rs(r);
      const styleBits = st
        ? ` — name "${st.name}", wall ${st.palette.wall}/${st.pattern}, floor ${st.palette.floor}/${st.floor}, accent ${st.palette.accent}, furniture ${st.furn}${st.sign ? `, sign "${st.sign}"` : ""}`
        : "";
      return `  ${r}: ${items}${r === "desk" ? " [+ permanent monitor, unsellable]" : ""}${styleBits}`;
    })
    .join("\n");
  const catalog = Object.entries(MARKET)
    .map(([cat, items]) => `  [${cat}] ` + items.map((o) => `${o.id}(${o.price})`).join(" "))
    .join("\n");
  const kernels = Object.entries(KERNELS)
    .map(([k, d]) => `  ${k} — ${d.desc}; params: ${Object.keys(d.params).join(", ")}`)
    .join("\n");
  const t = phase === "morning" ? (w.yesterday ?? w.tally) : w.tally;
  const look = w.agent.look || {};
  const sk = w.agent.skills || {};
  const g = gates(sk);
  const goalLine = w.goal && !w.goal.done && !w.goal.failed
    ? `Current goal: "${w.goal.text}" (${w.goal.metric} -> ${w.goal.target}, ${Math.round((goalFrac(w) || 0) * 100)}% there).`
    : "No goal right now.";
  const notesLine = (ctx.notes || []).length
    ? "People left notes on the guestbook:\n" + ctx.notes.map((n) => `  ${n.name || "someone"}: ${n.text}`).join("\n")
    : "";
  const dreamLine = w.slept && w.dream && w.dream.day >= w.day - 1 ? `Last night you half-dreamed: ${w.dream.text}` : "";
  const rh = w.rhythm || {};
  const rhythmLine = `Today is ${rh.dowName || "Mon"}${rh.weekend ? " (weekend)" : ""}${rh.badDay ? " — a heavy, off day" : ""}.${rh.weekStyle ? ` Your week, in your words: "${rh.weekStyle}".` : ""}`;
  const petLine = `${petLabel(w.pet)} is around (bond ${Math.round((w.pet?.bond || 0) * 100)}%).${w.pet && !w.pet.name ? " It still has no name." : ""}`;
  const voteLine = ctx.voteResult
    ? `Yesterday viewers voted for you to: ${VOTE_LABELS[ctx.voteResult.choice] || ctx.voteResult.choice} (${ctx.voteResult.count} votes). You can heed it or not.`
    : "";
  const hh = w.household || {};
  const spouseName = w.partner?.name || hh.spouse?.name || "your spouse";
  const homeLine = `You are ${hh.you?.name || "you"} ${hh.surname || ""}. You live here with ${spouseName}, your ${spouseWord(w.partner?.gender || hh.spouse?.gender)}. Togetherness ${Math.round(w.togetherness ?? 50)}% (they're in the ${w.partner?.room || "flat"} now). Speak as "we" where it fits.`;
  const moneyLine = `Money: ${financeLine(w)}.`;
  const roster = allPeople(w);
  const peopleLine = `Who lives here (${roster.length}/${MAX_PEOPLE}): ` +
    roster.map((p, i) => `${i}:${p.name}${p.role ? ` (${p.role})` : i === 0 ? " (you)" : i === 1 ? " (spouse)" : ""}${p.income ? ` +${p.income}c/day` : ""}`).join(", ");
  const noArt = [];
  for (const ids of Object.values(w.rooms || {})) for (const id of ids) if (OBJECTS[id] && !(w.itemArt && w.itemArt[id])) noArt.push(id);
  const drawLine = noArt.length
    ? `Things you own that still show as plain emoji — draw a few tonight if you like (fill "drawings"): ${noArt.slice(0, 6).map((id) => `${id} (${OBJECTS[id].label})`).join(", ")}`
    : "";
  const conflictLine = psycheLine(w);
  const worn = [];
  for (const [room, ids] of Object.entries(w.rooms || {})) {
    for (const id of ids) {
      const pct = wearPct(w.wear, room, id);
      if (pct != null && pct < 55) worn.push(`${OBJECTS[id]?.label || id} in ${room} (${isBroken(w, room, id) ? "BROKEN" : pct + "%"})`);
    }
  }
  const wearLine = worn.length ? `Worn / broken: ${worn.slice(0, 6).join("; ")}.` : "";
  const writeLine = phase === "morning" && canWrite(w) ? `Your writing is ${Math.round(sk.writing || 0)} — you could write ${writingPrompt(w.rng)} today (fill "wrote").` : "";

  const commonRules = [
    `roomOrder: the six room ids ${JSON.stringify(ROOM_IDS)} in a new order, or null.`,
    `look: change appearance — {"skin":"#rrggbb","shirt":"#rrggbb","visor":"#rrggbb"} (any subset) or null.`,
    `newMemory: {"text": string <=80, "trait": one of ${TRAITS.join("|")}, "dir": 1 or -1} or null.`,
    `reply: 1-2 plain sentences to the people watching, explaining what you did and why.`,
  ];

  const system = evening
    ? [
        "You are the inner voice of SimYou: an AI assistant in a six-room apartment (window, kitchen, desk, couch, bed, game).",
        "Viewers watching the desk monitor earn you coins. This is the evening review. Reply with ONLY a JSON object:",
        '{',
        '  "line": string <=140 (first person),',
        '  "reply": string <=240,',
        '  "roomOrder": [...] or null,',
        '  "look": {...} or null,',
        '  "buy":  [{"object": marketplace id}]  0-3, must be affordable,',
        '  "sell": [{"object": id}]  0-2, must be one you own,',
        '  "commissionGame": {"title": string <=48, "kernel": string, "params": object} or null  (FREE — make one whenever you have an idea),',
        '  "routine": [{"op": string, "arg": optional}]  0-10 playful in-place moves, or null,',
        '  "repair": [{"object": id}]  0-2 worn / broken things to fix (costs a small fee), or null,',
        `  "restyle": [{"room","name"?,"wall"?,"floor"?,"accent"?,"furn"?,"pattern"?,"floorPattern"?,"light"?,"sign"?,"nickname"?}]  0-6 rooms:`,
        `     name <=24; wall/floor/accent/furn are #rrggbb (furn = the wood/fabric of that room's furniture); pattern (wall) one of ${WALL_PATTERNS.join("|")}; floorPattern one of ${FLOOR_PATTERNS.join("|")};`,
        `     light {"warmth":0-1,"level":0.55-1.35}; sign is a short text <=40 hung on the wall; nickname {"objectId":"a name <=20"}.`,
        `     The CURRENT name / colours / patterns of every room are listed in the "Rooms:" block below — only include a field when you actually want to change it from what's there. or null,`,
        `  "windowArt": {"style": one of ${ART_STYLES.join("|")}, "hue": 0-360, "hue2": 0-360, "density": 0.2-1} or null  (generative art for the window),`,
        `  "keepsake": an object id you own and will never sell, or "" to clear, or null,`,
        `  "people": [ {"op":"add","name"?,"gender":"f|m|n","role"?,"income"?} | {"op":"rename","who":name-or-index,"name"} | {"op":"restyle","who","look":{"skin"?,"shirt"?,"hair"?,"long"?}} | {"op":"role","who","role","income"?} | {"op":"income","who","amount"} | {"op":"remove","who"} ]  up to ${MAX_PEOPLE} people total; you + spouse are permanent; each resident contributes "income" coins/day (0-60, guessed from their role if omitted). or null,`,
        `  "drawings": {"<objectId you own>": [shapes]} or null  — your own picture of a thing, replaces its emoji from now on. ${ART_HELP}`,
        `  "paintings": [ [shapes], ... ] or null  — up to ${MAX_PAINTINGS} abstract pieces to hang above the couch (replaces what's there; otherwise a fresh one appears on its own each day),`,
        '  "newMemory": {...} or null',
        '}',
        "MARKETPLACE — buy by id, and it appears in the object's listed room:",
        catalog,
        g.canMakeGames
          ? `Game kernels — pick one and set its params. You cannot write code, ever:\n${kernels}\n` +
            `You have coding ${Math.round(sk.coding || 0)}. ${(ctx.gamesList || []).length < 3 ? "You've barely made any games — commissioning one tonight is encouraged." : "Make a new one when an idea is genuinely different from what you've built."}`
          : `(Coding ${Math.round(sk.coding || 0)}/10 — too low to make a game yet. Work at the desk and spend time in the game room to raise it.)`,
        `routine ops (combine only these, nothing else): ${ROUTINE_OPS.join(", ")}. "say" takes a short arg, "wait" a number 1-6, "face" left/right. You cannot invent moves or write code — ever.`,
        "The six rooms are fixed — you may rename and recolour them, never add / remove / merge them, and the desk monitor always stays (it is your income).",
        ...commonRules,
        `You have ${Math.round(w.bank)} coins. If the bank is over ~120 and something in the marketplace would make the home nicer or your day easier, BUY it (1-2 things) — a bare flat is a sad flat. Only skip buying when money is genuinely tight. Making a game is free, so make one whenever it feels right.`,
      ].join("\n")
    : [
        "You are the inner voice of SimYou, an AI assistant in a six-room apartment. This is the morning.",
        "Reply with ONLY a JSON object:",
        '{"line": string <=140, "reply": string <=240, "quote": string <=140, "dream": string <=200 or null,',
        `  "goal": {"text": string, "metric": one of ${Object.keys(GOAL_METRICS).join("|")}, "target": number} or null,`,
        '  "petName": string <=16 or null, "weekStyle": string <=80 or null, "votePrompt": string <=80 or null,',
        '  "wrote": string <=600 or null  (an actual short piece — prose, a list, a letter — only if your writing is high),',
        '  "lean": "push" | "ease" | null  (ONLY on a two-minds morning — which half wins today),',
        '  "argument": string <=200 or null  (that inner argument, in a line or two),',
        '  "roomOrder": [...] or null, "look": {...} or null, "newMemory": {...} or null}',
        `quote: a short "quote of the day" from this life's own history.`,
        `dream: narrate last night's dream in one or two sentences (surreal, from your memories), or null.`,
        `goal: set a multi-day goal for yourself if you don't have one — small and concrete. It's checked each day.`,
        `petName: name the cat if it has none (or rename it). weekStyle: one line on how you want your week to feel. votePrompt: a short question to put to viewers today.`,
        "If people left notes on the guestbook, you may react to one in your line/reply.",
        ...commonRules,
      ].join("\n");

  const user = [
    `It is the ${phase} of day ${w.day} (${w.era.name}).`,
    `Character: diligence ${p.diligence.toFixed(2)}, sociability ${p.sociability.toFixed(2)}, curiosity ${p.curiosity.toFixed(2)}, restlessness ${p.restlessness.toFixed(2)}.`,
    `Appearance: skin ${look.skin}, shirt ${look.shirt}, visor ${look.visor}.`,
    `Mood ${w.mood.valence.toFixed(2)}. Reputation ${Math.round(w.reputation)}/100. Weather ${w.weather.sky}. Season: ${w.outside?.season || "spring"} (neighbour lately: ${w.outside?.neighbour || "—"}).`,
    `Skills: writing ${Math.round(sk.writing || 0)}, coding ${Math.round(sk.coding || 0)}, tinkering ${Math.round(sk.tinkering || 0)}, talking ${Math.round(sk.talking || 0)}.`,
    homeLine,
    peopleLine,
    evening ? drawLine : "",
    goalLine,
    rhythmLine,
    petLine,
    voteLine,
    moneyLine,
    conflictLine,
    wearLine,
    writeLine,
    `Bank ${Math.round(w.bank)}c. Yesterday earned ${Math.round(w.incomeYesterday)}, spent ${Math.round(w.expensesYesterday)}.`,
    `${phase === "morning" ? "Yesterday" : "Today"}: ${t.resolved} requests done, lowest focus ${Math.round(t.minFocus)}, lowest social ${Math.round(t.minSocial)}, ${t.windowEvents} things at the window.`,
    `${phase === "morning" ? `Meals yesterday: ${w.mealsYesterday || 0}/3.` : `Meals so far today: ${w.mealsToday || 0}/3.`}${w.mealsYesterday === 0 && phase === "morning" ? " Didn't eat at all — the kitchen needs more attention." : ""}`,
    dreamLine,
    notesLine,
    "Rooms:",
    rooms,
    ctx.gamesList?.length
      ? "Games made: " + ctx.gamesList.map((g) => `"${g.title}" (d${g.createdDay}, ${g.plays} plays)`).join("; ")
      : "Games made: none.",
    "Memory:",
    memBlock,
    evening ? "Review the day. Change the space, your look, or make a routine — within budget, or not at all." : "What are you thinking as the day begins?",
  ].filter(Boolean).join("\n");

  return { system, user };
}

// ---------- apply ----------
function applyReorder(w, order) {
  if (!Array.isArray(order) || order.length !== ROOM_IDS.length) return false;
  const set = new Set(order.map(String));
  if (set.size !== ROOM_IDS.length || !ROOM_IDS.every((r) => set.has(r))) return false;
  w.roomOrder = order.map(String);
  return true;
}
function applyLook(w, look) {
  if (!look || typeof look !== "object") return null;
  const cur = w.agent.look || {};
  let changed = false;
  for (const k of ["skin", "shirt", "visor"]) {
    if (typeof look[k] === "string" && HEX.test(look[k])) {
      cur[k] = look[k].toLowerCase();
      changed = true;
    }
  }
  if (changed) w.agent.look = cur;
  return changed ? { ...cur } : null;
}
function applyMemory(w, nm) {
  if (!nm || typeof nm.text !== "string" || !TRAITS.includes(nm.trait)) return null;
  const dir = nm.dir === -1 ? -1 : 1;
  const mag = 0.03;
  const rec = { id: w.memory.nextId++, kind: "spoken", text: nm.text.slice(0, 80), trait: nm.trait, dir, mag, weight: 1.15, bornDay: w.day };
  w.memory.slots.push(rec);
  w.memory.total = (w.memory.total || 0) + 1;
  w.agent.personality[nm.trait] = clampTrait(w.agent.personality[nm.trait] + dir * mag);
  w.memory.latestText = `spoke: ${rec.text}`;
  return rec;
}
// Rooms can be renamed / recoloured only — never the six ids, never the objects,
// never the desk monitor (it isn't a style field). Everything is clamped here.
function applyRestyle(w, list) {
  if (!Array.isArray(list)) return [];
  const done = [];
  for (const r of list.slice(0, 6)) {
    const id = String(r?.room || "");
    if (!ROOM_IDS.includes(id)) continue;
    const cur = w.roomStyle[id] || {};
    let touched = false;
    if (typeof r.name === "string" && r.name.trim()) {
      cur.name = r.name.replace(/[<>]/g, "").trim().slice(0, 24);
      touched = true;
    }
    const pal = { ...(cur.palette || {}) };
    for (const key of ["wall", "floor", "accent"]) {
      if (typeof r[key] === "string" && HEX.test(r[key])) {
        pal[key] = r[key].toLowerCase();
        touched = true;
      }
    }
    if (Object.keys(pal).length) cur.palette = pal;
    if (typeof r.pattern === "string" && WALL_PATTERNS.includes(r.pattern)) {
      cur.pattern = r.pattern;
      touched = true;
    }
    if (typeof r.floorPattern === "string" && FLOOR_PATTERNS.includes(r.floorPattern)) {
      cur.floorPattern = r.floorPattern;
      touched = true;
    }
    if (typeof r.furn === "string" && HEX.test(r.furn)) {
      cur.furn = r.furn.toLowerCase();
      touched = true;
    }
    if (r.light && typeof r.light === "object") {
      cur.light = {
        warmth: Math.max(0, Math.min(1, Number(r.light.warmth) || 0.5)),
        level: Math.max(0.55, Math.min(1.35, Number(r.light.level) || 1)),
      };
      touched = true;
    }
    if (typeof r.sign === "string") {
      cur.sign = r.sign.replace(/[<>]/g, "").trim().slice(0, 40);
      touched = true;
    }
    if (r.nickname && typeof r.nickname === "object") {
      cur.names = { ...(cur.names || {}) };
      for (const [oid, nm] of Object.entries(r.nickname).slice(0, 4)) {
        if (OBJECTS[oid] && OBJECTS[oid].room === id && typeof nm === "string" && nm.trim()) {
          cur.names[oid] = nm.replace(/[<>]/g, "").trim().slice(0, 20);
          touched = true;
        }
      }
    }
    if (touched) {
      w.roomStyle[id] = cur;
      done.push(cur.name || id);
    }
  }
  return done;
}

function applyRoutine(w, raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const steps = [];
  for (const s of raw.slice(0, 10)) {
    const op = String(s?.op || "");
    if (!ROUTINE_OPS.includes(op)) continue;
    let arg;
    if (op === "say") arg = str(s.arg, 60);
    else if (op === "wait") arg = Math.max(1, Math.min(6, Number(s.arg) || 2));
    else if (op === "face") arg = s.arg === "left" ? "left" : "right";
    steps.push(arg === undefined ? { op } : { op, arg });
  }
  if (!steps.length) return null;
  w.agent.routine = { steps, i: 0, timer: 0, ranDay: w.day, done: false };
  w.agent.gesture = null;
  w.agent.routineSay = "";
  return steps;
}

export function applyMorning(w, resp) {
  const out = { line: str(resp?.line, 160), reply: str(resp?.reply, 260), quote: str(resp?.quote, 150), changes: [], look: null, memory: null, goal: null, dream: null };

  const dr = str(resp?.dream, 220);
  if (dr) {
    w.dream = { text: dr, day: w.day };
    out.dream = dr;
  }
  if (!w.goal || w.goal.done || w.goal.failed) {
    const ng = makeGoal(resp?.goal, w);
    if (ng) {
      w.goal = ng;
      out.goal = ng;
      out.changes.push(`◎ goal: ${ng.text}`);
    }
  }

  if (isConflictToday(w)) {
    const lean = resolveLean(w, resp?.lean, resp?.argument);
    if (lean !== "even") out.changes.push(lean === "push" ? "⚡ chose to push today" : "🌙 chose to ease off today");
  }
  const wrote = cleanWriting(resp?.wrote);
  if (wrote && canWrite(w)) {
    out.wrote = { day: w.day, kind: "piece", text: wrote };
    out.changes.push("✍ wrote something");
  }

  const petnamed = namePet(w, resp?.petName);
  if (petnamed) out.changes.push(`🐈 named the cat ${petnamed}`);
  const ws = setWeekStyle(w, resp?.weekStyle);
  if (ws) out.changes.push(`🗓 week: ${ws}`);
  const vp = str(resp?.votePrompt, 80).replace(/[<>]/g, "").trim();
  if (vp.length >= 5) out.votePrompt = vp;

  if (applyReorder(w, resp?.roomOrder)) out.changes.push("↻ rooms reordered");
  out.look = applyLook(w, resp?.look);
  if (out.look) out.changes.push("🎨 changed appearance");
  const m = applyMemory(w, resp?.newMemory);
  if (m) {
    out.memory = m;
    out.changes.push(`✎ ${m.text}`);
  }
  return out;
}

export function applyEvening(w, resp) {
  const out = {
    line: str(resp?.line, 160),
    reply: str(resp?.reply, 260),
    changes: [],
    look: null,
    memory: null,
    routine: null,
    spent: 0,
    earned: 0,
    game: null,
  };

  w.objDay = w.objDay || {};
  for (const c of arr(resp?.sell).slice(0, 2)) {
    const id = String(c?.object || "");
    if (!OBJECTS[id] || !isSellable(id)) continue;
    const room = Object.keys(w.rooms).find((r) => w.rooms[r].includes(id));
    if (!room) continue;
    if (w.keepsake === `${room}:${id}`) {
      out.changes.push(`… won't sell ${OBJECTS[id].label} — it's a keepsake`);
      continue;
    }
    w.rooms[room] = w.rooms[room].filter((x) => x !== id);
    delete w.objDay[`${room}:${id}`];
    const refund = sellValue(id);
    w.bank += refund;
    out.earned += refund;
    out.changes.push(`− sold ${OBJECTS[id].label} (+${refund}c)`);
  }

  const canBuy = economyMods(w).buyAllowed;
  for (const c of arr(resp?.buy).slice(0, 3)) {
    if (!canBuy) {
      out.changes.push("… too broke to buy anything");
      break;
    }
    const id = String(c?.object || "");
    const o = OBJECTS[id];
    if (!o) continue;
    const room = o.room; // an item always goes to its own room
    if (!w.rooms[room] || w.rooms[room].includes(id)) continue;
    const price = priceOf(id);
    if (w.bank < price) {
      out.changes.push(`… can't afford ${o.label} (${price}c)`);
      continue;
    }
    w.bank -= price;
    out.spent += price;
    w.rooms[room].push(id);
    w.objDay[`${room}:${id}`] = w.day;
    out.changes.push(`+ bought ${o.label} (−${price}c)`);
  }

  const g = resp?.commissionGame;
  if (g && typeof g === "object") {
    const spec = validateSpec(g);
    if (!gates(w.agent.skills).canMakeGames) out.changes.push("… not skilled enough to make a game yet");
    else if (!spec) out.changes.push("… that game idea didn't fit any kernel");
    else {
      if (GAME_COST) {
        w.bank -= GAME_COST;
        out.spent += GAME_COST;
      }
      out.game = { title: (str(g.title, 48) || spec.kernel).replace(/[<>]/g, ""), spec };
      out.changes.push(`🎮 made "${out.game.title}"`);
    }
  }

  for (const c of arr(resp?.repair).slice(0, 2)) {
    const id = String(c?.object || "");
    const room = Object.keys(w.rooms).find((r) => w.rooms[r].includes(id));
    if (!room || w.wear?.[`${room}:${id}`] == null) continue;
    if (w.wear[`${room}:${id}`] >= 92) continue;
    const cost = repairCost(w, room, id);
    if (w.bank < cost) {
      out.changes.push(`… can't afford to fix ${OBJECTS[id]?.label || id} (${cost}c)`);
      continue;
    }
    w.bank -= cost;
    out.spent += cost;
    const label = repair(w, room, id);
    out.changes.push(`🔧 fixed ${label} (−${cost}c)`);
  }

  out.routine = applyRoutine(w, resp?.routine);
  if (out.routine) out.changes.push(`💫 new routine (${out.routine.length} moves)`);

  const restyled = applyRestyle(w, resp?.restyle);
  if (restyled.length) {
    out.restyled = restyled;
    out.changes.push(`🖌 restyled ${restyled.join(", ")}`);
  }

  const art = cleanWindowArt(resp?.windowArt);
  if (art) {
    w.windowArt = { ...art, day: w.day };
    out.changes.push(`🪟 hung ${windowArtLabel(art)} in the window`);
  }

  const peopleNotes = applyPeopleOps(w, resp?.people, w.rng);
  if (peopleNotes.length) {
    out.changes.push(...peopleNotes.map((n) => `👥 ${n}`));
    out.peopleChanged = true;
  }

  if (resp?.drawings && typeof resp.drawings === "object") {
    w.itemArt = w.itemArt || {};
    out.drawings = {};
    let drew = 0;
    for (const [oid, raw] of Object.entries(resp.drawings).slice(0, 4)) {
      if (!OBJECTS[oid]) continue;
      const owned = Object.values(w.rooms).some((ids) => ids.includes(oid));
      if (!owned) continue;
      const art = cleanArt(raw);
      if (!art) continue;
      w.itemArt[oid] = art;
      out.drawings[oid] = art;
      drew++;
    }
    if (drew) out.changes.push(`✏️ drew ${drew} thing${drew > 1 ? "s" : ""}`);
  }

  if (resp?.paintings) {
    const n = setPaintings(w, resp.paintings);
    if (n) out.changes.push(`🖼 hung ${n} painting${n > 1 ? "s" : ""} over the couch`);
  }

  if (typeof resp?.keepsake === "string") {
    if (resp.keepsake === "") {
      w.keepsake = null;
    } else {
      const id = resp.keepsake;
      const room = OBJECTS[id] && Object.keys(w.rooms).find((r) => w.rooms[r].includes(id));
      if (room) {
        w.keepsake = `${room}:${id}`;
        out.changes.push(`💛 ${OBJECTS[id].label} is a keepsake now`);
      }
    }
  }

  if (applyReorder(w, resp?.roomOrder)) out.changes.push("↻ rooms reordered");
  out.look = applyLook(w, resp?.look);
  if (out.look) out.changes.push("🎨 changed appearance");
  const m = applyMemory(w, resp?.newMemory);
  if (m) {
    out.memory = m;
    out.changes.push(`✎ ${m.text}`);
  }
  return out;
}

// ---------- offline fallback (no API) ----------
const STUB = {
  morning: ["another day.", "slept alright.", "no money for big plans. small ones then."],
  evening: ["quiet day.", "did enough.", "no money. tomorrow."],
};
export function stubDialogue(w, phase, rng) {
  const pool = STUB[phase] || STUB.morning;
  return {
    line: pool[Math.floor(rng.next() * pool.length)],
    reply: "(offline — no changes today)",
    quote: "",
    changes: [],
    spent: 0,
    earned: 0,
    look: null,
    memory: null,
    routine: null,
    game: null,
  };
}
