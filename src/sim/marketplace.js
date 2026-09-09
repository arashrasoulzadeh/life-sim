// The marketplace — ~200 things the AI can buy, in four categories. Everything
// here is data only (name, price, room, glyph, tiny effect); positions are
// assigned by slot in roomrender.js, so nothing needs hand-placing.

function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}
const pick = (arr, seed) => arr[hash(seed) % arr.length];

const KW = [
  [/lamp|light/, "💡"], [/clock|timer/, "⏰"], [/mirror/, "🪞"], [/plant|succulent|terrarium/, "🪴"],
  [/chair|stool|seat|bean/, "🪑"], [/speaker|sound|audio/, "🔊"], [/guitar/, "🎸"], [/keyboard synth|synth|piano/, "🎹"],
  [/monitor|screen|display/, "🖥️"], [/keyboard/, "⌨️"], [/mouse|trackball/, "🖱️"], [/book|shelf/, "📚"],
  [/notebook|journal|pad|card/, "📓"], [/pen/, "🖊️"], [/camera/, "📷"], [/\bmic\b|microphone/, "🎙️"], [/headphone|headset/, "🎧"],
  [/kettle|tea/, "🫖"], [/coffee|espresso|frother/, "☕"], [/toaster|bread|waffle|sandwich/, "🍞"], [/blender|juicer|mixer|processor/, "🥤"],
  [/fan/, "🌀"], [/heater/, "🔥"], [/candle/, "🕯️"], [/vase|flower/, "🌸"], [/rug|cushion|blanket|pillow/, "🧶"],
  [/curtain/, "🪟"], [/frame|poster|print|map|art|easel|sketch/, "🖼️"], [/telescope/, "🔭"], [/binocular/, "🔭"],
  [/microscope|chemistry/, "🔬"], [/dart/, "🎯"], [/chess|checker|backgammon|go board/, "♟️"], [/card|poker/, "🃏"],
  [/dice/, "🎲"], [/puzzle|cube|rubik/, "🧩"], [/kite/, "🪁"], [/record|vinyl/, "💿"], [/projector|screen/, "📽️"],
  [/arcade|cabinet|pinball|claw/, "🕹️"], [/console|handheld/, "🎮"], [/controller|gamepad|joystick|stick/, "🎮"],
  [/VR|headset/, "🥽"], [/pool|billiard/, "🎱"], [/ping pong|table tennis/, "🏓"], [/foosball|air hockey/, "🏒"],
  [/aquarium|fish/, "🐠"], [/bird/, "🐦"], [/wind chime/, "🎐"], [/rocket/, "🚀"], [/microwave/, "📦"],
  [/rice cooker|slow cooker|air fryer|grill/, "🍲"], [/scale/, "⚖️"], [/knife/, "🔪"], [/dish|jar|bowl/, "🥣"],
  [/water filter/, "💧"], [/laundry|iron/, "🧺"], [/coat rack|shoe rack/, "🧥"], [/gaming chair|racing seat/, "🪑"],
];
function glyphFor(name, fallback) {
  const n = name.toLowerCase();
  for (const [re, g] of KW) if (re.test(n)) return g;
  return fallback;
}

const CATS = {
  appliance: {
    rooms: ["kitchen", "kitchen", "kitchen", "bed"],
    glyphs: ["🔌", "🍳", "🧺"],
    base: 100,
    effect: (r) => ({ energy: 0.3 + (r % 3) * 0.1, focus: 0.1 }),
    items: [
      "kettle", "toaster", "blender", "microwave", "coffee maker", "air fryer", "rice cooker",
      "slow cooker", "electric grill", "hand mixer", "food processor", "juicer", "espresso machine",
      "milk frother", "bread maker", "waffle iron", "sandwich press", "kitchen scale", "spice rack",
      "knife block", "dish rack", "fruit bowl", "cutting board", "mixing bowls", "storage jars",
      "tea set", "water filter", "stand fan", "space heater", "humidifier", "dehumidifier",
      "air purifier", "floor lamp", "table lamp", "wall clock", "alarm clock", "tall mirror",
      "area rug", "floor cushion", "throw blanket", "linen curtains", "ceramic vase", "scented candle",
      "reed diffuser", "picture frame", "coat rack", "shoe rack", "laundry basket", "side table",
      "bookend pair",
    ],
  },
  work: {
    rooms: ["desk", "desk", "window"],
    glyphs: ["🖥️", "⌨️", "🖱️", "💡", "📓", "🖊️", "📚", "🗂️", "🎧", "📷", "🪴", "🗓️", "📐", "🧭"],
    base: 130,
    effect: () => ({ focus: 0.35, energy: -0.05 }),
    items: [
      "second monitor", "mechanical keyboard", "trackball mouse", "task lamp", "monitor arm",
      "laptop stand", "notebook", "fountain pen", "pen holder", "desk organizer", "bookshelf",
      "filing cabinet", "document tray", "cork board", "whiteboard", "desk calendar", "wall calendar",
      "stapler", "hole punch", "label maker", "cable tray", "surge protector", "USB hub", "webcam",
      "ring light", "condenser mic", "pop filter", "headphone stand", "closed-back headphones",
      "footrest", "anti-fatigue mat", "seat cushion", "lumbar pillow", "desk plant", "succulent",
      "small desk fan", "hourglass", "world map", "framed print", "monitor riser", "wrist rest",
      "sticky notes", "index cards", "desk mat", "paperweight", "letter opener", "in-tray",
      "out-tray", "pencil cup", "reading light",
    ],
  },
  fun: {
    rooms: ["couch", "couch", "window", "game"],
    glyphs: ["💿", "🔊", "🎸", "🎹", "🎯", "🖼️", "💡", "🫧", "🛋️", "🔭", "🪁", "🎨", "🔬", "🎲"],
    base: 90,
    effect: (r) => (r % 2 ? { social: 0.4, curiosity: 0.2 } : { curiosity: 0.4, focus: 0.1 }),
    items: [
      "record player", "vinyl crate", "bluetooth speaker", "bookshelf speaker", "acoustic guitar",
      "electric guitar", "keyboard synth", "hand drum", "kalimba", "harmonica", "dartboard",
      "chess set", "checkers set", "backgammon board", "go board", "playing cards", "poker chips",
      "dice tower", "jigsaw puzzle", "rubik's cube", "fidget kit", "yo-yo", "juggling balls",
      "kendama", "slinky", "lava lamp", "neon sign", "string lights", "disco ball", "projector",
      "movie screen", "beanbag", "floor hammock", "rocking chair", "nook lamp", "telescope",
      "binoculars", "star projector", "terrarium", "aquarium", "bird feeder", "wind chime", "kite",
      "paper plane kit", "model rocket", "microscope", "art easel", "sketch pad", "instant camera",
      "chess clock",
    ],
  },
  games: {
    rooms: ["game"],
    glyphs: ["🕹️", "🎰", "🎡", "🏒", "⚽", "🎱", "🏓", "🎮", "👾", "🥽", "🎲", "♟️", "🃏", "🖲️"],
    base: 180,
    effect: () => ({ curiosity: 0.4, social: 0.3, focus: -0.05 }),
    items: [
      "arcade cabinet", "cocktail arcade table", "pinball machine", "claw machine", "air hockey table",
      "foosball table", "pool table", "ping pong table", "shuffleboard", "skee-ball lane",
      "basketball arcade", "racing cabinet", "light-gun cabinet", "rhythm dance pad", "fight stick",
      "retro console", "handheld console", "mini console", "modded handheld", "VR headset",
      "racing seat", "flight yoke", "arcade joystick", "wireless gamepad", "pro controller",
      "controller stand", "headset hook", "game shelf", "cartridge rack", "disc tower", "capture card",
      "stream deck", "gaming chair", "gaming desk", "RGB light bar", "144hz monitor", "ultrawide monitor",
      "mouse bungee", "cooling fan", "figure shelf", "poster set", "tabletop RPG box", "dice set",
      "miniatures case", "card binder", "playmat", "dice tray", "beanbag (xl)", "score board",
      "trophy shelf",
    ],
  },
};

function slug(name, i) {
  return "m" + i + name.replace(/[^a-z0-9]+/gi, "");
}

export const MARKET = {}; // cat -> [ { id, name, cat, room, price, glyph, effect } ]
export const OBJECTS = {};

let i = 0;
for (const [cat, def] of Object.entries(CATS)) {
  MARKET[cat] = [];
  for (const name of def.items) {
    const id = slug(name, i++);
    const rIdx = hash(id + "r") % def.rooms.length;
    const room = def.rooms[rIdx];
    const price = Math.round((def.base + (hash(id + "p") % 460)) / 10) * 10;
    const o = {
      id,
      label: name,
      cat,
      room,
      price,
      glyph: glyphFor(name, pick(def.glyphs, id + "g")),
      effect: def.effect(rIdx),
      sellable: true,
    };
    OBJECTS[id] = o;
    MARKET[cat].push(o);
  }
}

export const OBJECT_IDS_BY_ROOM = (() => {
  const m = {};
  for (const o of Object.values(OBJECTS)) (m[o.room] ??= []).push(o.id);
  return m;
})();

// a small starter set already in the apartment on day 1 — one cheapish item
// per room, chosen deterministically
export const DEFAULT_OBJECTS = Object.fromEntries(
  ["window", "kitchen", "desk", "couch", "bed", "game"].map((room) => {
    const ids = (OBJECT_IDS_BY_ROOM[room] || []).slice().sort((a, b) => OBJECTS[a].price - OBJECTS[b].price);
    return [room, ids.slice(0, 1)];
  }),
);

export function isSellable(id) {
  return !!OBJECTS[id] && OBJECTS[id].sellable !== false;
}
export function priceOf(id) {
  return OBJECTS[id]?.price ?? 0;
}
export function sellValue(id) {
  return Math.round(priceOf(id) * 0.5);
}
export function catOf(id) {
  return OBJECTS[id]?.cat ?? "";
}
