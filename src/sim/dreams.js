// If the morning conversation doesn't narrate a dream, weave one from recent
// memories — a small surreal recombination.

const OPENERS = ["I dreamt", "In the dream", "Half-asleep I was sure", "I woke thinking"];
const PLACES = ["the kitchen", "the window", "the desk", "the couch", "the hallway", "the game room", "a room I don't have"];
const TURNS = ["and it was fine", "and no one else was there", "but the light was wrong", "and it kept repeating", "and then it was raining indoors", "and I couldn't leave"];

export function weaveDream(slots, rng) {
  if (!slots || !slots.length) return "";
  const frag = (s) => s.text.toLowerCase().replace(/[.!?]$/, "").slice(0, 60);
  const a = frag(rng.pick(slots));
  const b = slots.length > 1 ? frag(rng.pick(slots)) : a;
  return `${rng.pick(OPENERS)} ${a}, in ${rng.pick(PLACES)}, ${rng.pick(TURNS)}. Somewhere in it, ${b}.`.slice(0, 220);
}
