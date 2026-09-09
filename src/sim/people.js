// The household: a married couple, one woman and one man, who share the flat,
// the bank, the cat and the day. Names + looks are drawn once from the seed.

const WOMEN = ["Mara", "Ines", "Sofia", "Nadia", "Lena", "Priya", "Cora", "Yuki", "Ada", "Rosa", "Tavi", "Elif"];
const MEN = ["Arto", "Sam", "Dario", "Noor", "Kai", "Ravi", "Bo", "Jun", "Idris", "Milo", "Esteban", "Otto"];
const SURNAMES = ["Alvez", "Okafor", "Bergman", "Haddad", "Sato", "Rao", "Nyman", "Costa", "Farr", "Ilves", "Reyes", "Bhatt"];

const SKINS = ["#f0d9b8", "#e6c9a0", "#d9b48a", "#c99a6f", "#a9764f", "#8a5a3a"];
const SHIRTS_W = ["#d98bb0", "#7ad0a0", "#e0b45c", "#9a8fe8", "#e0715c"];
const SHIRTS_M = ["#8fb8e8", "#7f9a6a", "#c98b5c", "#6bb0b8", "#b06b6b"];
const HAIR = ["#221c18", "#3a2a1a", "#5a3a22", "#111", "#7a6a58", "#a0a0a8"];

function look(rng, gender) {
  return {
    skin: rng.pick(SKINS),
    shirt: gender === "f" ? rng.pick(SHIRTS_W) : rng.pick(SHIRTS_M),
    hair: rng.pick(HAIR),
    long: gender === "f" ? rng.chance(0.75) : rng.chance(0.15), // longer hair
    visor: "#3a4a8a",
  };
}

// returns { woman:{name,gender,look}, man:{name,gender,look}, surname, primary:"woman"|"man" }
export function makeCouple(rng) {
  const surname = rng.pick(SURNAMES);
  const woman = { name: rng.pick(WOMEN), gender: "f", look: look(rng, "f") };
  const man = { name: rng.pick(MEN), gender: "m", look: look(rng, "m") };
  // one of them is the AI assistant whose voice the dialogue speaks; the other
  // keeps house alongside. Coin flip, fixed by the seed.
  const primary = rng.chance(0.5) ? "woman" : "man";
  return { woman, man, surname, primary };
}

export function spouseWord(gender) {
  return gender === "f" ? "wife" : gender === "m" ? "husband" : "spouse";
}
