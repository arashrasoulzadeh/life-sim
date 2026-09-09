// Pure room -> doc/HTML generation. No DOM, no fetch — shared by the browser
// viewer and the server sim loop. Objects are placed into fixed slots, so the
// ~200-item marketplace needs no hand-positioning.

import { ROOMS } from "./rooms.js";
import { OBJECTS } from "./objects.js";
import { plantGlyph, plantWater } from "./plants.js";

// slot coordinates in the 512x448 playfield (floor rows + a wall row)
const SLOTS = [
  { x: 64, y: 300 }, { x: 124, y: 300 }, { x: 184, y: 300 }, { x: 320, y: 300 }, { x: 380, y: 300 }, { x: 444, y: 300 },
  { x: 92, y: 356 }, { x: 168, y: 356 }, { x: 244, y: 356 }, { x: 344, y: 356 }, { x: 420, y: 356 },
  { x: 90, y: 96 }, { x: 150, y: 96 }, { x: 410, y: 96 }, { x: 452, y: 96 },
  { x: 64, y: 410 }, { x: 220, y: 410 }, { x: 400, y: 410 }, { x: 470, y: 356 },
];
export const OBJECT_SLOTS = SLOTS;

const FURNITURE = {
  desk:
    '<div class="furn" style="left:33%;width:46%;top:55%;height:3.5%;background:#5a4632"></div>' +
    '<div class="furn monitor" style="left:36%;width:28%;top:34%;height:21%;background:#0a0a0a;box-shadow:inset 0 0 0 2px #000">' +
    '<iframe class="ifr site-frame" title="monitor" sandbox="allow-scripts allow-popups allow-forms allow-same-origin allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" loading="lazy"></iframe>' +
    '<span class="frame-cap site-cap"></span></div>',
  kitchen:
    '<div class="furn" style="left:9%;width:39%;top:52%;height:3%;background:#7d7d86"></div>' +
    '<div class="furn" style="left:9%;width:39%;top:55%;height:10%;background:#3a3a40"></div>',
  window: '<div class="furn win" style="left:28%;width:44%;top:14%;height:34%;background:#0c1430"></div>',
  couch:
    '<div class="furn" style="left:53%;width:31%;top:56%;height:13%;background:#463a56;border-radius:6px 6px 0 0"></div>',
  bed:
    '<div class="furn" style="left:34%;width:35%;top:57%;height:12%;background:#4a4038"></div>' +
    '<div class="furn" style="left:35%;width:9%;top:53%;height:4.5%;background:#e8e8ee"></div>',
  game:
    '<div class="furn" style="left:30%;width:40%;top:18%;height:27%;background:#0a0a0a;box-shadow:inset 0 0 0 2px #000">' +
    '<iframe class="ifr game-frame" title="game" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy"></iframe></div>' +
    '<div class="furn" style="left:30%;width:40%;top:45%;height:2.5%;background:#3a4a40"></div>',
};

function esc(s) {
  return String(s).replace(/[<>"&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" })[c]);
}

export function objHtml(id, slot, roomId, plants) {
  const o = OBJECTS[id];
  if (!o) return "";
  const p = SLOTS[slot % SLOTS.length];
  const x = ((p.x / 512) * 100).toFixed(2);
  const y = ((p.y / 448) * 100).toFixed(2);
  const glyph = plantGlyph(plants, roomId, id, o.glyph);
  return `<span class="obj" data-obj="${id}" title="${esc(o.label)}" style="left:${x}%;top:${y}%">${glyph}</span>`;
}

export function roomStyle(roomId, style) {
  const base = ROOMS[roomId];
  const s = (style && style[roomId]) || {};
  return {
    name: typeof s.name === "string" && s.name ? s.name : base.name,
    palette: { ...base.palette, ...(s.palette || {}) },
  };
}

export function roomHtml(roomId, objects, style, plants) {
  const { name, palette: p } = roomStyle(roomId, style);
  return (
    `<div class="room" data-room="${roomId}" style="--wall:${p.wall};--floor:${p.floor};--accent:${p.accent}">` +
    '<div class="wall"></div><div class="floor"></div>' +
    (FURNITURE[roomId] || "") +
    objects.map((id, i) => objHtml(id, i, roomId, plants)).join("") +
    `<span class="room-tag">${esc(name)}</span>` +
    "</div>"
  );
}

export function objectsMeta(roomId, objects, objDay, plants) {
  return objects
    .map((id, i) => {
      const o = OBJECTS[id];
      if (!o) return null;
      const p = SLOTS[i % SLOTS.length];
      return {
        id,
        label: o.label,
        price: o.price,
        glyph: plantGlyph(plants, roomId, id, o.glyph),
        cat: o.cat,
        x: +(p.x / 512).toFixed(4),
        y: +(p.y / 448).toFixed(4),
        day: (objDay && objDay[`${roomId}:${id}`]) || 1,
        water: plantWater(plants, roomId, id),
      };
    })
    .filter(Boolean);
}

export function roomDoc(seed, roomId, objects, style, objDay, plants) {
  const { name, palette } = roomStyle(roomId, style);
  return {
    room: roomId,
    name,
    palette,
    objects: [...objects],
    meta: objectsMeta(roomId, objects, objDay, plants),
    html: roomHtml(roomId, objects, style, plants),
    updated: new Date().toISOString(),
  };
}

export function initDocs(world) {
  world.roomDocs = {};
  for (const rid of Object.keys(world.rooms)) {
    world.roomDocs[rid] = roomDoc(world.seed, rid, world.rooms[rid], world.roomStyle, world.objDay, world.plants);
  }
}
