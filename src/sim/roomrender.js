// Pure room -> doc/HTML generation. No DOM, no fetch — shared by the browser
// viewer and the server sim loop.
//
// The desk monitor and the game-room screen are permanent fixtures rendered as
// <iframe> elements; the viewer sets their `src` (rotating sites.json entries /
// the current AI-authored game). They are never in the object catalog.

import { ROOMS } from "./rooms.js";
import { OBJECTS } from "./objects.js";

const FURNITURE = {
  desk:
    '<div class="furn" style="left:33%;width:46%;top:55%;height:3.5%;background:#5a4632"></div>' +
    '<div class="furn monitor" style="left:36%;width:28%;top:34%;height:21%;background:#0a0a0a;box-shadow:inset 0 0 0 2px #000">' +
    '<iframe class="ifr site-frame" title="monitor" sandbox="allow-scripts allow-popups allow-forms" referrerpolicy="no-referrer" loading="lazy"></iframe>' +
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
    '<div class="furn" style="left:30%;width:40%;top:20%;height:30%;background:#0a0a0a;box-shadow:inset 0 0 0 2px #000">' +
    '<iframe class="ifr game-frame" title="game" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy"></iframe></div>' +
    '<div class="furn" style="left:30%;width:40%;top:50%;height:2.5%;background:#3a4a40"></div>',
};

function esc(s) {
  return String(s).replace(/[<>"&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" })[c]);
}

export function objHtml(id) {
  const o = OBJECTS[id];
  if (!o) return "";
  const x = ((o.pos.x / 512) * 100).toFixed(2);
  const y = ((o.pos.y / 448) * 100).toFixed(2);
  return `<span class="obj" data-obj="${id}" title="${esc(o.label)}" style="left:${x}%;top:${y}%">${o.glyph}</span>`;
}

export function roomStyle(roomId, style) {
  const base = ROOMS[roomId];
  const s = (style && style[roomId]) || {};
  return {
    name: typeof s.name === "string" && s.name ? s.name : base.name,
    palette: { ...base.palette, ...(s.palette || {}) },
  };
}

export function roomHtml(roomId, objects, style) {
  const { name, palette: p } = roomStyle(roomId, style);
  return (
    `<div class="room" data-room="${roomId}" style="--wall:${p.wall};--floor:${p.floor};--accent:${p.accent}">` +
    '<div class="wall"></div><div class="floor"></div>' +
    (FURNITURE[roomId] || "") +
    objects.map(objHtml).join("") +
    `<span class="room-tag">${esc(name)}</span>` +
    "</div>"
  );
}

export function roomDoc(seed, roomId, objects, style) {
  const { name, palette } = roomStyle(roomId, style);
  return {
    room: roomId,
    name,
    seed: String(seed),
    palette,
    objects: [...objects],
    html: roomHtml(roomId, objects, style),
    updated: new Date().toISOString(),
  };
}

export function initDocs(world) {
  world.roomDocs = {};
  for (const rid of Object.keys(world.rooms)) {
    world.roomDocs[rid] = roomDoc(world.seed, rid, world.rooms[rid], world.roomStyle);
  }
}
