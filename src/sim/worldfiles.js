// Per-life room files: worlds/<seed>/<room>.json. Each doc carries the room's
// palette, its object list, and a rendered `html` fragment (the HTML room layer
// draws this directly). Writing goes through the dev server's POST /_world sink;
// reads are plain static GETs. Editing a file on disk is picked up by pollRoom.

import { ROOMS } from "./rooms.js";
import { OBJECTS } from "./objects.js";

const FURNITURE = {
  desk:
    '<div class="furn" style="left:35%;width:42%;top:55%;height:3.5%;background:#5a4632"></div>' +
    '<div class="furn" style="left:57%;width:13%;top:44%;height:11%;background:#111;box-shadow:inset 0 0 0 2px #000"></div>',
  kitchen:
    '<div class="furn" style="left:9%;width:39%;top:52%;height:3%;background:#7d7d86"></div>' +
    '<div class="furn" style="left:9%;width:39%;top:55%;height:10%;background:#3a3a40"></div>',
  window:
    '<div class="furn win" style="left:28%;width:44%;top:14%;height:34%;background:#0c1430"></div>',
  couch:
    '<div class="furn" style="left:53%;width:31%;top:56%;height:13%;background:#463a56;border-radius:6px 6px 0 0"></div>',
  bed:
    '<div class="furn" style="left:34%;width:35%;top:57%;height:12%;background:#4a4038"></div>' +
    '<div class="furn" style="left:35%;width:9%;top:53%;height:4.5%;background:#e8e8ee"></div>',
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

export function roomHtml(roomId, objects) {
  const p = ROOMS[roomId].palette;
  return (
    `<div class="room" style="--wall:${p.wall};--floor:${p.floor};--accent:${p.accent}">` +
    '<div class="wall"></div><div class="floor"></div>' +
    (FURNITURE[roomId] || "") +
    objects.map(objHtml).join("") +
    "</div>"
  );
}

export function roomDoc(seed, roomId, objects) {
  return {
    room: roomId,
    name: ROOMS[roomId].name,
    seed: String(seed),
    palette: ROOMS[roomId].palette,
    objects: [...objects],
    html: roomHtml(roomId, objects),
    updated: new Date().toISOString(),
  };
}

export function initDocs(world) {
  world.roomDocs = {};
  for (const rid of Object.keys(world.rooms)) {
    world.roomDocs[rid] = roomDoc(world.seed, rid, world.rooms[rid]);
  }
}

function validObjects(list, rid) {
  return Array.isArray(list) ? list.filter((id) => OBJECTS[id] && OBJECTS[id].room === rid) : null;
}

// GET each room file; adopt it if present, otherwise create it from the defaults.
export async function loadOrInit(world) {
  for (const rid of Object.keys(world.rooms)) {
    let ok = false;
    try {
      const res = await fetch(`/worlds/${world.seed}/${rid}.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const doc = await res.json();
        const objs = validObjects(doc.objects, rid);
        if (objs) world.rooms[rid] = objs;
        world.roomDocs[rid] = doc.html ? doc : roomDoc(world.seed, rid, world.rooms[rid]);
        ok = true;
      }
    } catch {
      /* not served by server.py — stay with the in-memory doc */
    }
    if (!ok) await saveRoom(world, rid);
  }
}

export async function saveRoom(world, rid) {
  const doc = roomDoc(world.seed, rid, world.rooms[rid]);
  world.roomDocs[rid] = doc;
  try {
    await fetch("/_world", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed: String(world.seed), room: rid, doc }),
    });
  } catch {
    /* ignore */
  }
}

// Save any room whose object list has drifted from its saved doc.
export function saveChangedRooms(world) {
  for (const rid of Object.keys(world.rooms)) {
    const doc = world.roomDocs[rid];
    if (!doc || (doc.objects || []).join(",") !== world.rooms[rid].join(",")) saveRoom(world, rid);
  }
}

// Detect an external edit to the current room's file; returns true if it changed.
export async function pollRoom(world, rid) {
  try {
    const res = await fetch(`/worlds/${world.seed}/${rid}.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return false;
    const doc = await res.json();
    const cur = world.roomDocs[rid];
    if (doc.updated && (!cur || doc.updated !== cur.updated)) {
      world.roomDocs[rid] = doc;
      const objs = validObjects(doc.objects, rid);
      if (objs) world.rooms[rid] = objs;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
