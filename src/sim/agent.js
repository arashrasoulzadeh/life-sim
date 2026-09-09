import { ACTIONS } from "./actions.js";
import { applyEffect, pressure } from "./needs.js";
import { ROOMS } from "./rooms.js";
import { freshSkills } from "./skills.js";

const WALK_SPEED = 46; // px/s
export const CORRIDOR_Y = 316;
export const CORRIDOR_X0 = 40;
export const CORRIDOR_X1 = 472;

export function makePersonality(rng) {
  return {
    diligence: rng.range(0.3, 1),
    sociability: rng.range(0.2, 0.95),
    curiosity: rng.range(0.3, 1),
    restlessness: rng.range(0, 0.8),
  };
}

export function makeLook(rng) {
  const shirts = ["#dfe3ea", "#7ad0a0", "#8fb8e8", "#e0b45c", "#c98bd0", "#e06a5c"];
  return {
    skin: rng.pick(["#f0d9b8", "#e6c9a0", "#d9b48a", "#c99a6f", "#a9764f"]),
    shirt: rng.pick(shirts),
    visor: "#3a4a8a",
  };
}

export function makeAgent(rng) {
  const spot = ROOMS.bed.spot;
  return {
    personality: makePersonality(rng),
    look: makeLook(rng),
    skills: freshSkills(),
    needs: { focus: 70, energy: 80, social: 55, curiosity: 60 },
    room: "bed",
    x: spot.x,
    y: spot.y,
    tx: spot.x,
    ty: spot.y,
    facing: 1,
    moving: false,
    action: null,
    actionLeft: 0,
    transit: 0,
    transitTotal: 1,
    workProgress: 0,
    lastThought: "waking up",
    routine: null, // { steps:[{op,arg}], i, timer, ranDay }
    routineSay: "",
  };
}

// --- playful routines: the AI combines a few of these in-place moves ---
export const ROUTINE_OPS = ["say", "wait", "face", "hop", "wave", "spin", "nod", "sit"];

function clampN(v, lo, hi, d) {
  v = Number(v);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
}

// Returns true while a routine is performing (the utility AI is paused).
export function stepRoutine(agent, dt) {
  const r = agent.routine;
  if (!r || r.done || r.i >= r.steps.length) return false;
  if (agent.transit > 0 || agent.moving) return false;
  r.timer = (r.timer ?? 0) - dt;
  if (r.timer > 0) return true;

  const step = r.steps[r.i++];
  const arg = step.arg;
  switch (step.op) {
    case "say":
      agent.routineSay = String(arg ?? "").slice(0, 60);
      agent.lastThought = agent.routineSay || "…";
      r.timer = 3.2;
      break;
    case "wait":
      r.timer = clampN(arg, 1, 6, 2);
      agent.lastThought = "…";
      break;
    case "face":
      agent.facing = arg === "left" ? -1 : 1;
      r.timer = 0.3;
      break;
    case "hop":
      agent.gesture = "hop";
      agent.lastThought = "*hop*";
      r.timer = 0.7;
      break;
    case "wave":
      agent.gesture = "wave";
      agent.lastThought = "*waves*";
      r.timer = 1.4;
      break;
    case "spin":
      agent.gesture = "spin";
      agent.lastThought = "*spins*";
      r.timer = 1.2;
      break;
    case "nod":
      agent.gesture = "nod";
      agent.lastThought = "*nods*";
      r.timer = 1;
      break;
    case "sit":
      agent.gesture = "sit";
      agent.lastThought = "sits a moment";
      r.timer = 2.4;
      break;
    default:
      r.timer = 0.4;
  }
  if (r.i >= r.steps.length) {
    r.done = true;
    agent.routineSay = "";
    agent.gesture = null;
  }
  return true;
}

function personalityBoost(p, need) {
  switch (need) {
    case "focus":
      return 0.7 + p.diligence * 0.8;
    case "social":
      return 0.5 + p.sociability * 1.1;
    case "curiosity":
      return 0.5 + p.curiosity * 1.1;
    default:
      return 1;
  }
}

// which vote choice each action answers to
const VOTE_ACTION = {
  work: "work",
  rest: "rest",
  sleep: "rest",
  chat: "social",
  gaze: "learn",
  reflect: "learn",
  tinker: "learn",
  water: "tend",
};

export function scoreActions(agent, env, rng) {
  const { isNight, requestsWaiting, wantsReflect, thirstyRoom } = env;
  const rhythm = env.rhythm || { work: 1, play: 1 };
  const voteBias = env.voteBias || null;
  const { needs, personality } = agent;
  return ACTIONS.map((action) => {
    let score = action.weight;

    // how much this action relieves current pressure
    let relief = 0;
    for (const need of Object.keys(action.effect)) {
      const delta = action.effect[need];
      if (delta > 0) relief += pressure(needs[need]) * delta * personalityBoost(personality, need);
    }
    score *= 0.15 + relief;

    // context modifiers
    if (action.id === "sleep") score *= isNight ? 3.2 : 0.15;
    if (action.id === "work") {
      // duty scales with queue pressure and the agent's diligence
      score += (0.5 + personality.diligence * 1.5) * Math.min(3.2, 0.4 + requestsWaiting * 0.9);
      if (isNight) score *= 0.5;
    }
    if (action.id === "chat" && isNight) score *= 0.3;
    if (action.id === "reflect") {
      // a quiet-evening habit: only when the day is winding down and calm
      score *= wantsReflect ? 2.4 + personality.curiosity * 1.4 : 0.02;
      if (requestsWaiting >= 3) score *= 0.3;
    }
    if (action.id === "tinker") {
      const coding = (agent.skills && agent.skills.coding) || 4;
      // curious minds poke at the game room; the pull is strongest while still learning
      score *= 0.5 + personality.curiosity * 1.4 + (coding < 12 ? 0.8 : 0.2);
      if (isNight) score *= 0.4;
    }
    if (action.id === "pace") score *= 0.4 + personality.restlessness * 1.6;
    if (action.id === "rest" && needs.energy > 60) score *= 0.4;
    if (action.id === "water") score *= thirstyRoom ? 2.2 + personality.curiosity : 0.01;

    // the week has a shape
    if (action.id === "work") score *= rhythm.work;
    if (["gaze", "chat", "rest", "pace", "tinker"].includes(action.id)) score *= rhythm.play;

    // viewers voted a focus yesterday — a gentle nudge, never a command
    if (voteBias) {
      const key = VOTE_ACTION[action.id];
      if (key && voteBias[key]) score *= voteBias[key];
    }

    // travel cost — cheaper to keep doing what you're near
    if (action.room !== agent.room) score *= 0.8;
    if (agent.action && action.id === agent.action.id) score *= 1.15;

    // a little noise so a life doesn't fall into a hard cycle
    score *= rng.range(0.85, 1.15);

    return { action, score };
  }).sort((a, b) => b.score - a.score);
}

export function stepAgent(agent, dt, env, rng) {
  const { isNight, requestsWaiting, onRequestResolved, onReflect } = env;
  const walkSpeed = WALK_SPEED * (env.speedMul ?? 1);
  // walking the hallway between rooms — visible: the agent crosses a corridor
  if (agent.transit > 0) {
    agent.transit -= dt;
    const p = Math.min(1, Math.max(0, 1 - agent.transit / agent.transitTotal));
    agent.x = CORRIDOR_X0 + p * (CORRIDOR_X1 - CORRIDOR_X0);
    agent.y = CORRIDOR_Y;
    agent.facing = 1;
    agent.moving = true;
    if (agent.transit <= 0) {
      const spot = ROOMS[agent.room].spot;
      agent.x = spot.x < 256 ? spot.x - 60 : spot.x + 60;
      agent.y = spot.y;
      agent.tx = spot.x;
      agent.ty = spot.y;
      agent.moving = true;
    }
    return;
  }

  // in-room walk toward target
  if (agent.moving) {
    const dx = agent.tx - agent.x;
    const dy = agent.ty - agent.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) {
      agent.x = agent.tx;
      agent.y = agent.ty;
      agent.moving = false;
    } else {
      const step = Math.min(dist, walkSpeed * dt);
      agent.x += (dx / dist) * step;
      agent.y += (dy / dist) * step;
      agent.facing = dx < 0 ? -1 : 1;
      return;
    }
  }

  // performing an action
  if (agent.action && agent.actionLeft > 0) {
    applyEffect(agent.needs, agent.action.effect, dt);
    agent.actionLeft -= dt;
    if (agent.action.id === "work") {
      agent.workProgress += dt;
      if (agent.workProgress >= 6 && requestsWaiting > 0) {
        agent.workProgress = 0;
        onRequestResolved();
      }
    }
    if (agent.actionLeft > 0) return;
    if (agent.action.id === "reflect") onReflect();
    if (agent.action.id === "water" && env.onWater) env.onWater(agent.room);
    if (agent.action.id === "tinker" && env.onTinker) env.onTinker(agent.room);
  }

  // decide what to do next
  const ranked = scoreActions(agent, env, rng);
  const chosen = ranked[0].action;
  agent.action = chosen;
  agent.actionLeft = rng.range(chosen.duration[0], chosen.duration[1]);
  agent.workProgress = 0;
  // "water" happens wherever the thirsty plant is
  const targetRoom = chosen.id === "water" && env.thirstyRoom ? env.thirstyRoom : chosen.room;
  agent.lastThought = thoughtFor(agent, chosen, isNight, requestsWaiting);

  if (targetRoom !== agent.room) {
    agent.room = targetRoom;
    agent.room = chosen.room;
    agent.transit = rng.range(2, 3.6);
    agent.transitTotal = agent.transit;
    agent.x = CORRIDOR_X0;
    agent.y = CORRIDOR_Y;
    agent.moving = true;
  } else {
    const spot = ROOMS[agent.room].spot;
    agent.tx = spot.x + rng.range(-6, 6);
    agent.ty = spot.y + rng.range(-4, 4);
    agent.moving = true;
  }
}

function thoughtFor(agent, a, isNight, reqs) {
  const n = agent.needs;
  if (a.id === "sleep") return isNight ? "so tired... bed" : "just a short nap";
  if (a.id === "eat") return n.energy < 25 ? "starving. kitchen, now" : "a snack sounds good";
  if (a.id === "work") return reqs > 0 ? `${reqs} waiting — back to the desk` : "tidying up some notes";
  if (a.id === "gaze") return n.curiosity < 25 ? "need to see something new" : "what's out there today";
  if (a.id === "chat") return n.social < 25 ? "it's been quiet. reaching out" : "wonder how the others are";
  if (a.id === "rest") return "sitting down for a bit";
  if (a.id === "water") return "that plant looks thirsty";
  if (a.id === "tinker") return "let's see what this could do";
  if (a.id === "reflect") return "what was today, really";
  return "stretching my legs";
}
