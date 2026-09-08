import { ACTIONS } from "./actions.js";
import { applyEffect, pressure } from "./needs.js";
import { ROOMS } from "./rooms.js";

const WALK_SPEED = 46; // px/s

export function makePersonality(rng) {
  return {
    diligence: rng.range(0.3, 1),
    sociability: rng.range(0.2, 0.95),
    curiosity: rng.range(0.3, 1),
    restlessness: rng.range(0, 0.8),
  };
}

export function makeAgent(rng) {
  const spot = ROOMS.bed.spot;
  return {
    personality: makePersonality(rng),
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
    workProgress: 0,
    lastThought: "waking up",
  };
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

export function scoreActions(agent, isNight, requestsWaiting, rng) {
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
    if (action.id === "pace") score *= 0.4 + personality.restlessness * 1.6;
    if (action.id === "rest" && needs.energy > 60) score *= 0.4;

    // travel cost — cheaper to keep doing what you're near
    if (action.room !== agent.room) score *= 0.8;
    if (agent.action && action.id === agent.action.id) score *= 1.15;

    // a little noise so a life doesn't fall into a hard cycle
    score *= rng.range(0.85, 1.15);

    return { action, score };
  }).sort((a, b) => b.score - a.score);
}

export function stepAgent(agent, dt, isNight, requestsWaiting, rng, onRequestResolved) {
  // walking between rooms: a brief off-screen abstraction (agent doing hallway things)
  if (agent.transit > 0) {
    agent.transit -= dt;
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
      const step = Math.min(dist, WALK_SPEED * dt);
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
  }

  // decide what to do next
  const ranked = scoreActions(agent, isNight, requestsWaiting, rng);
  const chosen = ranked[0].action;
  agent.action = chosen;
  agent.actionLeft = rng.range(chosen.duration[0], chosen.duration[1]);
  agent.workProgress = 0;
  agent.lastThought = thoughtFor(agent, chosen, isNight, requestsWaiting);

  if (chosen.room !== agent.room) {
    agent.room = chosen.room;
    agent.transit = rng.range(1.1, 2.2);
    agent.moving = false;
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
  return "stretching my legs";
}
