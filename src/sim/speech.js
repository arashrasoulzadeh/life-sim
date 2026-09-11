// Ambient speech between the people living here — short lines exchanged when
// two of them are actually settled together in the same room (not the
// scripted morning/evening review). Every line is written by the AI: nothing
// here invents its own text. Because each line costs a model call, it's rate
// limited by the REAL calendar day (not the in-game day, which can turn over
// many times while the sim runs fast) — at most SPEECH_DAILY_CAP lines total,
// across the whole household, per real day.

export const SPEECH_DAILY_CAP = 10;
const COOLDOWN_MIN = 45; // sim-seconds between attempts, whether or not one lands
const COOLDOWN_MAX = 110;
export const SAY_TTL = 6.5; // seconds a spoken line stays on screen

export function speechDayKey() {
  return new Date().toISOString().slice(0, 10); // UTC real calendar date
}

function nameOf(p) {
  return (p && p.name) || "someone";
}

// find a pair of settled, co-located people who could plausibly talk right
// now — prefers the game room (something to react to together) over a plain
// shared room, and never picks the same pair back-to-back
export function findSpeechMoment(w) {
  if (w.isNight) return null;
  const people = [w.agent, w.partner, ...(w.extras || [])].filter(
    (p) => p && p.transit <= 0 && !p.moving && !p.routine,
  );
  const byRoom = {};
  for (const p of people) (byRoom[p.room] = byRoom[p.room] || []).push(p);
  const rooms = Object.entries(byRoom).filter(([, g]) => g.length >= 2);
  if (!rooms.length) return null;
  rooms.sort(([ra], [rb]) => (ra === "game") - (rb === "game")).reverse();
  const [room, group] = rooms[0];
  let a = group[w._speechPick % group.length] || group[0];
  let b = group.find((p) => p !== a) || group[1];
  const lastPair = w._lastSpeechPair;
  if (lastPair && lastPair.a === nameOf(a) && lastPair.b === nameOf(b) && group.length > 2) {
    b = group.find((p) => p !== a && nameOf(p) !== lastPair.b) || b;
  }
  return { room, a, b, interactive: room === "game" };
}

// advances the per-tick cooldown; returns true once it's time to try again
export function tickSpeechCooldown(w, dt, rng) {
  w._speechCooldown = (w._speechCooldown ?? rng.range(COOLDOWN_MIN, COOLDOWN_MAX)) - dt;
  if (w._speechCooldown > 0) return false;
  w._speechCooldown = rng.range(COOLDOWN_MIN, COOLDOWN_MAX);
  w._speechPick = (w._speechPick ?? 0) + 1;
  return true;
}

const ROOM_WORD = { window: "by the window", kitchen: "in the kitchen", desk: "at the desk", couch: "on the couch", bed: "in the bedroom", game: "in the game room" };

// tiny prompt for a single exchanged line — kept as small as possible since
// this can fire several times a day
export function buildSpeechPrompt(w, a, b, room, interactive) {
  const roomWord = ROOM_WORD[room] || "in the flat";
  const system = [
    "Two housemates in a small apartment are briefly speaking to each other.",
    "Reply with ONLY a JSON object: {\"line\": string <=90, \"from\": \"a\" or \"b\"}.",
    "line: one short, natural, in-character spoken sentence — not a narration, not a summary.",
    interactive
      ? "They are together in the game room, reacting to whatever's on screen right now."
      : `They are simply ${roomWord} together for a moment.`,
  ].join("\n");
  const user = [
    `a = ${nameOf(a)}${a.role ? ` (${a.role})` : ""}, mood ${(a.needs?.social ?? 50) < 40 ? "a little lonely" : "fine"}.`,
    `b = ${nameOf(b)}${b.role ? ` (${b.role})` : ""}.`,
    `Weather outside: ${w.weather?.sky || "clouds"}. Time of day: ${w.isNight ? "night" : "day"}.`,
    "Pick whichever of them would speak first and give one short line from them.",
  ].join("\n");
  return { system, user };
}

export function applySpeech(w, a, b, resp) {
  const line = String(resp?.line || "").replace(/[<>]/g, "").trim().slice(0, 90);
  if (!line) return null;
  const speaker = resp?.from === "b" ? b : a;
  speaker.routineSay = line;
  speaker.lastThought = line;
  speaker._sayTtl = SAY_TTL;
  w._lastSpeechPair = { a: nameOf(a), b: nameOf(b) };
  return { speaker: nameOf(speaker), line, room: speaker.room };
}

// clears a spoken line once its ttl runs out — called every tick for anyone
// who might currently be showing one
export function decaySpeech(people, dt) {
  for (const p of people) {
    if (p && p._sayTtl > 0) {
      p._sayTtl -= dt;
      if (p._sayTtl <= 0 && p.routineSay) p.routineSay = "";
    }
  }
}
