// Pure room -> doc/HTML generation. No DOM, no fetch — shared by the browser
// viewer and the server sim loop. Objects are placed into fixed slots, so the
// ~200-item marketplace needs no hand-positioning.

import { ROOMS } from "./rooms.js";
import { OBJECTS } from "./objects.js";
import { plantGlyph, plantWater } from "./plants.js";
import { wearGlyph, wearPct } from "./wear.js";
import { windowArtCss } from "./windowart.js";
import { artToSvg } from "./itemart.js";
import { paintingsHtml } from "./paintings.js";

// slot coordinates in the 512x448 playfield (floor rows + a wall row)
const SLOTS = [
  { x: 64, y: 300 }, { x: 124, y: 300 }, { x: 184, y: 300 }, { x: 320, y: 300 }, { x: 380, y: 300 }, { x: 444, y: 300 },
  { x: 92, y: 356 }, { x: 168, y: 356 }, { x: 244, y: 356 }, { x: 344, y: 356 }, { x: 420, y: 356 },
  { x: 90, y: 96 }, { x: 150, y: 96 }, { x: 410, y: 96 }, { x: 452, y: 96 },
  { x: 64, y: 410 }, { x: 220, y: 410 }, { x: 400, y: 410 }, { x: 470, y: 356 },
];
export const OBJECT_SLOTS = SLOTS;

// which of the slots above sit up on the wall (y:96) vs on the floor/counter —
// used so wall-mounted items don't end up floating in the middle of the room
const WALL_SLOT_IDX = SLOTS.map((s, i) => (s.y <= 100 ? i : -1)).filter((i) => i >= 0);
const FLOOR_SLOT_IDX = SLOTS.map((s, i) => (s.y > 100 ? i : -1)).filter((i) => i >= 0);

// things that read as hung-on-the-wall rather than sitting/standing on the floor
const WALL_WORDS = /clock|mirror|calendar|frame|curtain|board|sign|shelf|hook|light bar|poster|map|trophy|diploma|certificate/i;

// deterministic per-object placement: wall-ish items claim wall slots, then
// everything is packed into the room's slot rows in a stable order (by id, so
// a given object always lands in the same spot instead of jumping around
// whenever the room's item list is edited elsewhere)
function assignSlots(objects) {
  const order = objects
    .map((id, i) => ({ id, i }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const wallQueue = [...WALL_SLOT_IDX];
  const floorQueue = [...FLOOR_SLOT_IDX];
  const out = new Array(objects.length);
  for (const { id, i } of order) {
    const wallLike = WALL_WORDS.test(OBJECTS[id]?.label || id);
    let idx;
    if (wallLike && wallQueue.length) idx = wallQueue.shift();
    else if (floorQueue.length) idx = floorQueue.shift();
    else if (wallQueue.length) idx = wallQueue.shift();
    else idx = i % SLOTS.length; // every slot taken — wrap, still stable per id
    out[i] = SLOTS[idx];
  }
  return out;
}

// `f` is the room's furniture colour (AI-settable via restyle.furn, default per
// room). The big surfaces read `var(--furn)`; screens / linens keep their own.
const FURNITURE = {
  desk:
    '<div class="furn" style="left:19%;width:62%;top:52%;height:5%;background:var(--furn)"></div>' +
    '<div class="furn" style="left:23%;width:5%;top:57%;height:14%;background:var(--furn);filter:brightness(0.8)"></div>' +
    '<div class="furn" style="left:72%;width:5%;top:57%;height:14%;background:var(--furn);filter:brightness(0.8)"></div>' +
    '<div class="furn monitor" style="left:29%;width:42%;top:22%;height:30%;background:#0a0a0a;box-shadow:inset 0 0 0 2px #000">' +
    '<iframe class="ifr site-frame" title="monitor" sandbox="allow-scripts allow-popups allow-forms allow-same-origin allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" loading="lazy"></iframe>' +
    '<span class="frame-cap site-cap"></span></div>',
  kitchen:
    '<div class="furn" style="left:9%;width:39%;top:52%;height:3%;background:#7d7d86"></div>' +
    '<div class="furn" style="left:9%;width:39%;top:55%;height:10%;background:var(--furn)"></div>',
  window: '<div class="furn win" style="left:28%;width:44%;top:14%;height:34%;background:#0c1430"></div>', // background swapped in by winFurn()
  couch:
    '<div class="furn" style="left:53%;width:31%;top:56%;height:13%;background:var(--furn);border-radius:6px 6px 0 0"></div>',
  bed:
    '<div class="furn" style="left:34%;width:35%;top:57%;height:12%;background:var(--furn)"></div>' +
    '<div class="furn" style="left:35%;width:9%;top:53%;height:4.5%;background:#e8e8ee"></div>',
  game:
    '<div class="furn game-tv" style="left:30%;width:40%;top:18%;height:27%;background:#0a0a0a;box-shadow:inset 0 0 0 2px #000">' +
    '<iframe class="ifr game-frame" title="game" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe></div>' +
    '<div class="furn game-stand" style="left:30%;width:40%;top:45%;height:2.5%;background:var(--furn)"></div>',
};
const FURN_DEFAULT = { desk: "#5a4632", kitchen: "#3a3a40", window: "#243046", couch: "#463a56", bed: "#4a4038", game: "#3a4a40" };

function esc(s) {
  return String(s).replace(/[<>"&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" })[c]);
}

export function objHtml(id, point, roomId, plants, wear, names, art) {
  const o = OBJECTS[id];
  if (!o) return "";
  const p = point || SLOTS[0];
  const x = ((p.x / 512) * 100).toFixed(2);
  const y = ((p.y / 448) * 100).toFixed(2);
  const nick = names && typeof names[id] === "string" ? names[id] : "";
  const drawn = art && art[id] ? artToSvg(art[id]) : "";
  const inner = drawn || wearGlyph(wear, roomId, id, plantGlyph(plants, roomId, id, o.glyph));
  return `<span class="obj${drawn ? " obj-drawn" : ""}" data-obj="${id}" title="${esc(nick ? `${nick} — ${o.label}` : o.label)}" style="left:${x}%;top:${y}%">${inner}</span>`;
}

export const WALL_PATTERNS = ["plain", "stripes", "dots", "grid", "checker", "diagonal"];
export const FLOOR_PATTERNS = ["plain", "planks", "tiles", "rug", "herringbone"];

function num(v, lo, hi, d) {
  v = Number(v);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
}

export function roomStyle(roomId, style) {
  const base = ROOMS[roomId];
  const s = (style && style[roomId]) || {};
  const light = s.light && typeof s.light === "object"
    ? { warmth: num(s.light.warmth, 0, 1, 0.5), level: num(s.light.level, 0.55, 1.35, 1) }
    : null;
  return {
    name: typeof s.name === "string" && s.name ? s.name : base.name,
    palette: { ...base.palette, ...(s.palette || {}) },
    pattern: WALL_PATTERNS.includes(s.pattern) ? s.pattern : "plain",
    floor: FLOOR_PATTERNS.includes(s.floorPattern) ? s.floorPattern : "plain",
    light,
    sign: typeof s.sign === "string" && s.sign.trim() ? s.sign.replace(/[<>]/g, "").trim().slice(0, 40) : "",
    names: s.names && typeof s.names === "object" ? s.names : {},
    furn: /^#[0-9a-fA-F]{6}$/.test(s.furn || "") ? s.furn.toLowerCase() : FURN_DEFAULT[roomId] || "#463a56",
  };
}

function lightLayer(light) {
  if (!light) return "";
  const warm = `hsl(${Math.round(30 + light.warmth * 20)} 60% 60%)`;
  const cool = `hsl(${Math.round(210 - light.warmth * 30)} 45% 40%)`;
  const tint = light.warmth > 0.5 ? warm : cool;
  const op = Math.abs(light.warmth - 0.5) * 0.5;
  const dim = light.level < 1 ? `,rgba(3,4,8,${((1 - light.level) * 0.8).toFixed(2)})` : "";
  const glow = light.level > 1 ? `,rgba(255,240,210,${((light.level - 1) * 0.35).toFixed(2)})` : "";
  return `<div class="light" style="background:linear-gradient(${hexA(tint, op)}${dim}${glow})"></div>`;
}
function hexA(c, a) {
  return `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`;
}

function winFurn(art) {
  const bg = windowArtCss(art).replace(/"/g, "'");
  return `<div class="furn win" style="left:28%;width:44%;top:14%;height:34%;background:${bg}"></div>`;
}

export function roomHtml(roomId, objects, style, plants, wear, windowArt, art, couchArt) {
  const st = roomStyle(roomId, style);
  const p = st.palette;
  const points = assignSlots(objects);
  return (
    `<div class="room" data-room="${roomId}" style="--wall:${p.wall};--floor:${p.floor};--accent:${p.accent};--furn:${st.furn}">` +
    `<div class="wall" data-pattern="${st.pattern}"></div><div class="floor" data-pattern="${st.floor}"></div>` +
    lightLayer(st.light) +
    (roomId === "window" ? winFurn(windowArt) : FURNITURE[roomId] || "") +
    (roomId === "couch" ? paintingsHtml(couchArt) : "") +
    objects.map((id, i) => objHtml(id, points[i], roomId, plants, wear, st.names, art)).join("") +
    (st.sign ? `<span class="room-sign">${esc(st.sign)}</span>` : "") +
    `<span class="room-tag">${esc(st.name)}</span>` +
    "</div>"
  );
}

export function objectsMeta(roomId, objects, objDay, plants, wear, names, keepsake, art) {
  const points = assignSlots(objects);
  return objects
    .map((id, i) => {
      const o = OBJECTS[id];
      if (!o) return null;
      const p = points[i];
      return {
        id,
        label: o.label,
        nick: names && typeof names[id] === "string" ? names[id] : "",
        keepsake: keepsake === `${roomId}:${id}`,
        price: o.price,
        glyph: wearGlyph(wear, roomId, id, plantGlyph(plants, roomId, id, o.glyph)),
        cat: o.cat,
        x: +(p.x / 512).toFixed(4),
        y: +(p.y / 448).toFixed(4),
        day: (objDay && objDay[`${roomId}:${id}`]) || 1,
        water: plantWater(plants, roomId, id),
        condition: wearPct(wear, roomId, id),
        drawn: !!(art && art[id]),
      };
    })
    .filter(Boolean);
}

export function roomDoc(seed, roomId, objects, style, objDay, plants, wear, windowArt, keepsake, art, couchArt) {
  const st = roomStyle(roomId, style);
  return {
    room: roomId,
    name: st.name,
    palette: st.palette,
    pattern: st.pattern,
    floor: st.floor,
    sign: st.sign,
    furn: st.furn,
    light: st.light,
    names: st.names,
    objects: [...objects],
    meta: objectsMeta(roomId, objects, objDay, plants, wear, st.names, keepsake, art),
    html: roomHtml(roomId, objects, style, plants, wear, windowArt, art, couchArt),
    updated: new Date().toISOString(),
  };
}

export function initDocs(world) {
  world.roomDocs = {};
  for (const rid of Object.keys(world.rooms)) {
    world.roomDocs[rid] = roomDoc(world.seed, rid, world.rooms[rid], world.roomStyle, world.objDay, world.plants, world.wear, world.windowArt, world.keepsake, world.itemArt, world.couchArt);
  }
}
