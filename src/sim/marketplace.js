// The marketplace — things the AI can buy, in four categories. Every item has a
// real emoji that actually depicts it; anything with no honest icon was dropped
// or swapped for a near equivalent that has one. Data only (name, price, room,
// glyph, tiny effect); positions are assigned by slot in roomrender.js.

function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

// [name, glyph] — the glyph must genuinely depict the thing
const CATS = {
  appliance: {
    rooms: ["kitchen", "kitchen", "kitchen", "bed"],
    base: 100,
    effect: (r) => ({ energy: 0.3 + (r % 3) * 0.1, focus: 0.1 }),
    items: [
      ["kettle", "🫖"], ["coffee maker", "☕"], ["espresso machine", "☕"], ["rice cooker", "🍚"],
      ["bread maker", "🍞"], ["waffle iron", "🧇"], ["sandwich press", "🥪"], ["juicer", "🧃"],
      ["kitchen scale", "⚖️"], ["spice rack", "🧂"], ["knife block", "🔪"], ["cutting board", "🔪"],
      ["dish rack", "🍽️"], ["fruit bowl", "🍎"], ["mixing bowls", "🥣"], ["storage jars", "🫙"],
      ["tea set", "🍵"], ["water filter", "🚰"], ["floor lamp", "💡"], ["table lamp", "💡"],
      ["wall clock", "🕐"], ["alarm clock", "⏰"], ["tall mirror", "🪞"], ["linen curtains", "🪟"],
      ["ceramic vase", "🏺"], ["scented candle", "🕯️"], ["picture frame", "🖼️"], ["coat rack", "🧥"],
      ["shoe rack", "👟"], ["laundry basket", "🧺"], ["bookend pair", "📚"],
    ],
  },
  work: {
    rooms: ["desk", "desk", "window"],
    base: 130,
    effect: () => ({ focus: 0.35, energy: -0.05 }),
    items: [
      ["second monitor", "🖥️"], ["mechanical keyboard", "⌨️"], ["trackball mouse", "🖱️"], ["task lamp", "💡"],
      ["laptop stand", "💻"], ["notebook", "📓"], ["fountain pen", "🖋️"], ["pen holder", "🖊️"],
      ["desk organizer", "🗂️"], ["bookshelf", "📚"], ["filing cabinet", "🗄️"], ["document tray", "🗃️"],
      ["cork board", "📌"], ["desk calendar", "📅"], ["wall calendar", "🗓️"], ["label maker", "🏷️"],
      ["surge protector", "🔌"], ["webcam", "📷"], ["ring light", "💡"], ["condenser mic", "🎙️"],
      ["headphone stand", "🎧"], ["closed-back headphones", "🎧"], ["footrest", "🦶"], ["desk plant", "🪴"],
      ["succulent", "🌵"], ["hourglass", "⏳"], ["world map", "🗺️"], ["framed print", "🖼️"],
      ["sticky notes", "📝"], ["index cards", "🗂️"], ["letter opener", "✉️"], ["in-tray", "📥"],
      ["out-tray", "📤"], ["pencil cup", "✏️"], ["reading light", "💡"],
    ],
  },
  fun: {
    rooms: ["couch", "couch", "window", "game"],
    base: 90,
    effect: (r) => (r % 2 ? { social: 0.4, curiosity: 0.2 } : { curiosity: 0.4, focus: 0.1 }),
    items: [
      ["record player", "📀"], ["vinyl crate", "💿"], ["bluetooth speaker", "🔊"], ["bookshelf speaker", "🔊"],
      ["acoustic guitar", "🎸"], ["electric guitar", "🎸"], ["keyboard synth", "🎹"], ["hand drum", "🥁"],
      ["dartboard", "🎯"], ["chess set", "♟️"], ["playing cards", "🃏"], ["dice tower", "🎲"],
      ["jigsaw puzzle", "🧩"], ["rubik's cube", "🧩"], ["yo-yo", "🪀"], ["juggling balls", "🤹"],
      ["disco ball", "🪩"], ["projector", "📽️"], ["movie screen", "🎬"], ["rocking chair", "🪑"],
      ["telescope", "🔭"], ["terrarium", "🪴"], ["aquarium", "🐠"], ["bird feeder", "🐦"],
      ["wind chime", "🎐"], ["kite", "🪁"], ["paper planes", "✈️"], ["model rocket", "🚀"],
      ["microscope", "🔬"], ["art easel", "🎨"], ["sketchbook", "📓"], ["instant camera", "📷"],
      ["chess clock", "⏱️"],
    ],
  },
  games: {
    rooms: ["game"],
    base: 180,
    effect: () => ({ curiosity: 0.4, social: 0.3, focus: -0.05 }),
    items: [
      ["arcade cabinet", "🕹️"], ["cocktail arcade table", "🕹️"], ["fight stick", "🕹️"], ["arcade joystick", "🕹️"],
      ["air hockey table", "🏒"], ["foosball table", "⚽"], ["pool table", "🎱"], ["ping pong table", "🏓"],
      ["basketball arcade", "🏀"], ["racing cabinet", "🏎️"], ["racing seat", "🏎️"], ["flight yoke", "✈️"],
      ["retro console", "🎮"], ["handheld console", "🎮"], ["mini console", "🎮"], ["modded handheld", "🎮"],
      ["wireless gamepad", "🎮"], ["pro controller", "🎮"], ["VR headset", "🥽"], ["headset hook", "🎧"],
      ["game shelf", "📚"], ["disc tower", "💿"], ["gaming chair", "🪑"], ["RGB light bar", "💡"],
      ["144hz monitor", "🖥️"], ["ultrawide monitor", "🖥️"], ["mouse bungee", "🖱️"], ["figure shelf", "🧸"],
      ["poster set", "🖼️"], ["tabletop RPG box", "🎲"], ["dice set", "🎲"], ["dice tray", "🎲"],
      ["card binder", "🃏"], ["score board", "🔢"], ["trophy shelf", "🏆"],
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
  for (const [name, glyph] of def.items) {
    const id = slug(name, i++);
    const rIdx = hash(id + "r") % def.rooms.length;
    const room = def.rooms[rIdx];
    // half price — keep it a round multiple of 5, min 15
    const raw = (def.base + (hash(id + "p") % 460)) / 2;
    const price = Math.max(15, Math.round(raw / 5) * 5);
    const o = { id, label: name, cat, room, price, glyph, effect: def.effect(rIdx), sellable: true };
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
