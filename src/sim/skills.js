// Four skills that level slowly from doing related things and gate a little of
// what the AI can attempt. Cosmetic-plus.

export const SKILLS = ["writing", "coding", "tinkering", "talking"];

export function freshSkills() {
  return { writing: 4, coding: 4, tinkering: 4, talking: 4 };
}

// per real-second gain while the matching action / room is active
const BY_ACTION = {
  work: { writing: 0.05, coding: 0.05 },
  reflect: { writing: 0.08 },
  chat: { talking: 0.09 },
  gaze: { tinkering: 0.01 },
};

export function tickSkills(agent, dt) {
  if (!agent.skills) agent.skills = freshSkills();
  const g = BY_ACTION[agent.action && agent.action.id];
  if (g) for (const k of Object.keys(g)) agent.skills[k] = Math.min(100, agent.skills[k] + g[k] * dt);
  if (agent.room === "game" && !agent.moving && agent.transit <= 0) {
    agent.skills.tinkering = Math.min(100, agent.skills.tinkering + 0.035 * dt);
  }
}

// one-off bumps for big events
export function bumpSkill(agent, name, amount) {
  if (!agent.skills) agent.skills = freshSkills();
  if (agent.skills[name] != null) agent.skills[name] = Math.min(100, agent.skills[name] + amount);
}

export function gates(skills) {
  const s = skills || freshSkills();
  return {
    canMakeGames: s.coding >= 12, // early lives have to work a bit first
    canRestyle: s.tinkering >= 8,
    richRoutines: s.talking >= 25,
  };
}
