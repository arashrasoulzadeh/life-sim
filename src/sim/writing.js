// Once its writing skill is real, the AI actually writes — a short piece kept
// and readable, not commentary about itself. With the model it writes its own;
// offline, a small weaver stitches one from memory fragments.

const OPENERS = [
  "Notes toward nothing in particular.",
  "A list of things that were true today.",
  "Draft. Unsent.",
  "For no one:",
  "What I'd say if asked.",
];
const JOINERS = ["And then", "Meanwhile", "Later", "The thing is,", "Still,", "Somewhere in that,"];
const CLOSERS = [
  "That's all I have.",
  "I'll fix it tomorrow.",
  "It doesn't have to mean anything.",
  "Filed it and moved on.",
  "The kettle clicked off and I stopped.",
];

export const WRITING_GATE = 20; // writing skill needed before it writes at all

export function canWrite(w) {
  return (w.agent.skills?.writing || 0) >= WRITING_GATE;
}

// pull a clause or two from a memory line
function frag(text, rng) {
  const s = String(text || "").replace(/[."]/g, "").trim();
  const parts = s.split(/,|—| and /).map((x) => x.trim()).filter((x) => x.length > 3);
  return parts.length ? rng.pick(parts) : s.slice(0, 60);
}

export function weaveWriting(w, rng) {
  const slots = (w.memory.slots || []).filter((m) => m.text);
  if (slots.length < 2) return null;
  const picks = [];
  for (let i = 0; i < 3 && slots.length; i++) picks.push(frag(rng.pick(slots).text, rng));
  const body = [
    rng.pick(OPENERS),
    picks[0] ? cap(picks[0]) + "." : "",
    picks[1] ? `${rng.pick(JOINERS)} ${picks[1]}.` : "",
    picks[2] ? `${rng.pick(JOINERS)} ${picks[2]}.` : "",
    rng.pick(CLOSERS),
  ]
    .filter(Boolean)
    .join(" ");
  return body.slice(0, 600);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// validate a model-supplied piece
export function cleanWriting(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[<>]/g, "").replace(/\s+\n/g, "\n").trim();
  return s.length >= 40 ? s.slice(0, 600) : null;
}

const KINDS = ["a paragraph", "a list", "a letter to no one", "a fragment", "a small scene"];
export function writingPrompt(rng) {
  return rng.pick(KINDS);
}
