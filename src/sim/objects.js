// Room objects the start/end-of-day conversation can add or remove. Each has a
// tiny passive effect while the agent works in that room, an emoji glyph, and a
// position (in the 512×448 playfield space) for the HTML room layer. The catalog
// is a closed whitelist — dialogue can only ever toggle ids that appear here.

export const OBJECTS = {
  // --- desk ---
  lamp: { room: "desk", label: "a desk lamp", effect: { focus: 0.5 }, glyph: "💡", pos: { x: 212, y: 236 } },
  plant: { room: "desk", label: "a small plant", effect: { curiosity: 0.4, focus: 0.15 }, glyph: "🪴", pos: { x: 386, y: 238 } },
  secondScreen: { room: "desk", label: "a second monitor", effect: { focus: 0.6, energy: -0.1 }, glyph: "🖥️", pos: { x: 250, y: 232 } },
  mug: { room: "desk", label: "a coffee mug", effect: { energy: 0.45 }, glyph: "☕", pos: { x: 288, y: 246 } },

  // --- kitchen ---
  kettle: { room: "kitchen", label: "a kettle", effect: { energy: 0.4 }, glyph: "🫖", pos: { x: 206, y: 224 } },
  fruitBowl: { room: "kitchen", label: "a bowl of fruit", effect: { energy: 0.5, focus: 0.2 }, glyph: "🍎", pos: { x: 150, y: 230 } },
  radio: { room: "kitchen", label: "a radio", effect: { social: 0.5, curiosity: 0.2 }, glyph: "📻", pos: { x: 96, y: 226 } },

  // --- window ---
  telescope: { room: "window", label: "a telescope", effect: { curiosity: 0.9 }, glyph: "🔭", pos: { x: 412, y: 270 } },
  windowChair: { room: "window", label: "a chair by the glass", effect: { energy: 0.3, curiosity: 0.3 }, glyph: "🪑", pos: { x: 306, y: 300 } },
  windowPlants: { room: "window", label: "a row of plants", effect: { curiosity: 0.4, focus: 0.2 }, glyph: "🌿", pos: { x: 196, y: 300 } },

  // --- couch ---
  blanket: { room: "couch", label: "a blanket", effect: { energy: 0.45 }, glyph: "🧣", pos: { x: 344, y: 288 } },
  recordPlayer: { room: "couch", label: "a record player", effect: { social: 0.5, curiosity: 0.3 }, glyph: "💿", pos: { x: 262, y: 300 } },
  cat: { room: "couch", label: "a cat", effect: { social: 0.7, focus: -0.1 }, glyph: "🐈", pos: { x: 302, y: 262 } },

  // --- bed ---
  nightlight: { room: "bed", label: "a nightlight", effect: { energy: 0.3, focus: 0.2 }, glyph: "🔦", pos: { x: 360, y: 300 } },
  journal: { room: "bed", label: "a journal", effect: { curiosity: 0.3, focus: 0.35 }, glyph: "📓", pos: { x: 330, y: 306 } },
  photos: { room: "bed", label: "photos on the wall", effect: { social: 0.45 }, glyph: "🖼️", pos: { x: 232, y: 120 } },
};

export const OBJECT_IDS_BY_ROOM = (() => {
  const m = {};
  for (const [id, o] of Object.entries(OBJECTS)) (m[o.room] ??= []).push(id);
  return m;
})();

export const DEFAULT_OBJECTS = {
  desk: ["lamp"],
  kitchen: ["kettle"],
  window: ["windowChair"],
  couch: ["blanket"],
  bed: ["nightlight"],
};
