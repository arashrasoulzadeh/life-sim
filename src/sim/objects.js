// Room objects the end-of-day conversation can buy or sell. Each has a price
// (coins), a tiny passive effect while the agent works in that room, an emoji
// glyph, and a position (in the 512x448 playfield). The catalog is a closed
// whitelist — dialogue can only ever touch ids that appear here.
//
// The desk monitor is NOT in this catalog: it is a permanent fixture (the income
// device) and can never be sold. See roomrender.js.

export const OBJECTS = {
  // --- desk ---
  lamp: { room: "desk", label: "a desk lamp", price: 150, effect: { focus: 0.5 }, glyph: "💡", pos: { x: 212, y: 236 } },
  plant: { room: "desk", label: "a small plant", price: 180, effect: { curiosity: 0.4, focus: 0.15 }, glyph: "🪴", pos: { x: 386, y: 238 } },
  secondScreen: { room: "desk", label: "a second monitor", price: 460, effect: { focus: 0.6, energy: -0.1 }, glyph: "🖥️", pos: { x: 240, y: 232 } },
  mug: { room: "desk", label: "a coffee mug", price: 150, effect: { energy: 0.45 }, glyph: "☕", pos: { x: 292, y: 246 } },

  // --- kitchen ---
  kettle: { room: "kitchen", label: "a kettle", price: 170, effect: { energy: 0.4 }, glyph: "🫖", pos: { x: 206, y: 224 } },
  fruitBowl: { room: "kitchen", label: "a bowl of fruit", price: 200, effect: { energy: 0.5, focus: 0.2 }, glyph: "🍎", pos: { x: 150, y: 230 } },
  radio: { room: "kitchen", label: "a radio", price: 260, effect: { social: 0.5, curiosity: 0.2 }, glyph: "📻", pos: { x: 96, y: 226 } },

  // --- window ---
  telescope: { room: "window", label: "a telescope", price: 420, effect: { curiosity: 0.9 }, glyph: "🔭", pos: { x: 412, y: 270 } },
  windowChair: { room: "window", label: "a chair by the glass", price: 220, effect: { energy: 0.3, curiosity: 0.3 }, glyph: "🪑", pos: { x: 306, y: 300 } },
  windowPlants: { room: "window", label: "a row of plants", price: 240, effect: { curiosity: 0.4, focus: 0.2 }, glyph: "🌿", pos: { x: 196, y: 300 } },

  // --- couch ---
  blanket: { room: "couch", label: "a blanket", price: 160, effect: { energy: 0.45 }, glyph: "🧣", pos: { x: 344, y: 288 } },
  recordPlayer: { room: "couch", label: "a record player", price: 380, effect: { social: 0.5, curiosity: 0.3 }, glyph: "💿", pos: { x: 262, y: 300 } },
  cat: { room: "couch", label: "a cat", price: 300, effect: { social: 0.7, focus: -0.1 }, glyph: "🐈", pos: { x: 302, y: 262 } },

  // --- bed ---
  nightlight: { room: "bed", label: "a nightlight", price: 150, effect: { energy: 0.3, focus: 0.2 }, glyph: "🔦", pos: { x: 360, y: 300 } },
  journal: { room: "bed", label: "a journal", price: 170, effect: { curiosity: 0.3, focus: 0.35 }, glyph: "📓", pos: { x: 330, y: 306 } },
  photos: { room: "bed", label: "photos on the wall", price: 200, effect: { social: 0.45 }, glyph: "🖼️", pos: { x: 232, y: 120 } },

  // --- game room ---
  beanbag: { room: "game", label: "a beanbag", price: 180, effect: { energy: 0.4, focus: 0.2 }, glyph: "🛋️", pos: { x: 150, y: 300 } },
  arcade: { room: "game", label: "an arcade cabinet", price: 480, effect: { curiosity: 0.6, social: 0.3 }, glyph: "🕹️", pos: { x: 390, y: 270 } },
  posters: { room: "game", label: "posters", price: 160, effect: { curiosity: 0.3 }, glyph: "🎮", pos: { x: 250, y: 120 } },
  speaker: { room: "game", label: "a speaker", price: 300, effect: { social: 0.4, energy: 0.2 }, glyph: "🔊", pos: { x: 320, y: 300 } },
};

export const OBJECT_IDS_BY_ROOM = (() => {
  const m = {};
  for (const [id, o] of Object.entries(OBJECTS)) (m[o.room] ??= []).push(id);
  return m;
})();

export const DEFAULT_OBJECTS = {
  desk: [],
  kitchen: ["kettle"],
  window: ["windowChair"],
  couch: ["blanket"],
  bed: ["nightlight"],
  game: [],
};

export function isSellable(id) {
  const o = OBJECTS[id];
  return !!o && o.sellable !== false;
}
export function priceOf(id) {
  return OBJECTS[id]?.price ?? 0;
}
export function sellValue(id) {
  return Math.round(priceOf(id) * 0.5);
}
