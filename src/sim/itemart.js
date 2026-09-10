// The AI's own drawing of an object it owns. It never sends markup — it sends a
// short list of primitive shapes in a 0..100 box, validated here, and the app
// composes the SVG. Once drawn, the item shows this instead of its emoji.

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const FN_COLOR = /^(hsla?|rgba?)\(\s*[0-9.,%\s/]+\)$/i;
const MAX_SHAPES = 48;

function n(v, d) {
  v = Number(v);
  if (!isFinite(v)) return d;
  return Math.max(-20, Math.min(120, v));
}
function pos(v, d, hi) {
  v = Number(v);
  return isFinite(v) ? Math.max(0.5, Math.min(hi, v)) : d;
}
function col(v, d) {
  if (typeof v !== "string") return d;
  const s = v.trim();
  if (HEX.test(s)) return s.toLowerCase();
  if (FN_COLOR.test(s) && s.length < 40) return s;
  return d;
}
function pts(list, max) {
  return Array.isArray(list) ? list.slice(0, max).map((p) => [n(p && p[0], 50), n(p && p[1], 50)]) : [];
}

function oneShape(s) {
  const t = String(s.t || s.type || "");
  if (t === "rect") return { t, x: n(s.x, 10), y: n(s.y, 10), w: n(s.w, 20), h: n(s.h, 20), r: Math.max(0, Math.min(50, Number(s.r) || 0)), fill: col(s.fill, "#888"), stroke: col(s.stroke, null), sw: n(s.sw, 0) };
  if (t === "circle") return { t, x: n(s.x, 50), y: n(s.y, 50), rad: pos(s.rad ?? s.r, 10, 90), fill: col(s.fill, "#888"), stroke: col(s.stroke, null), sw: n(s.sw, 0) };
  if (t === "ellipse") return { t, x: n(s.x, 50), y: n(s.y, 50), rx: pos(s.rx, 15, 90), ry: pos(s.ry, 10, 90), fill: col(s.fill, "#888"), stroke: col(s.stroke, null), sw: n(s.sw, 0) };
  if (t === "line") return { t, x1: n(s.x1, 10), y1: n(s.y1, 10), x2: n(s.x2, 90), y2: n(s.y2, 90), stroke: col(s.stroke, "#888"), sw: Math.max(0.5, n(s.sw, 2)), cap: s.cap === "butt" || s.cap === "square" ? s.cap : "round" };
  if (t === "poly") { const p = pts(s.points, 24); return p.length >= 3 ? { t, points: p, fill: col(s.fill, "#888"), stroke: col(s.stroke, null), sw: n(s.sw, 0) } : null; }
  if (t === "path" || t === "polyline") { const p = pts(s.points, 64); return p.length >= 2 ? { t: "path", points: p, stroke: col(s.stroke, "#888"), sw: Math.max(0.5, n(s.sw, 2)), fill: col(s.fill, null), closed: s.closed === true } : null; }
  if (t === "curve") return { t, x1: n(s.x1, 10), y1: n(s.y1, 80), cx: n(s.cx, 50), cy: n(s.cy, 10), x2: n(s.x2, 90), y2: n(s.y2, 80), stroke: col(s.stroke, "#888"), sw: Math.max(0.5, n(s.sw, 2)), fill: col(s.fill, null) };
  if (t === "arc") return { t, x: n(s.x, 50), y: n(s.y, 50), rad: pos(s.rad ?? s.r, 12, 90), a0: n(s.a0, 0), a1: n(s.a1, 180), stroke: col(s.stroke, "#888"), sw: Math.max(0.5, n(s.sw, 2)) };
  if (t === "pie") return { t, x: n(s.x, 50), y: n(s.y, 50), rad: pos(s.rad ?? s.r, 20, 90), a0: n(s.a0, 0), a1: n(s.a1, 90), fill: col(s.fill, "#888") };
  if (t === "star") return { t, x: n(s.x, 50), y: n(s.y, 50), rad: pos(s.rad ?? s.r, 20, 90), inner: pos(s.inner, 8, 90), points: Math.max(3, Math.min(14, Math.round(Number(s.n ?? s.points) || 5))), rot: n(s.rot, 0), fill: col(s.fill, "#888"), stroke: col(s.stroke, null), sw: n(s.sw, 0) };
  if (t === "ring") return { t, x: n(s.x, 50), y: n(s.y, 50), rad: pos(s.rad ?? s.r, 20, 90), stroke: col(s.stroke, "#888"), sw: Math.max(0.5, n(s.sw, 3)) };
  if (t === "dots") { const p = pts(s.points, 40); return p.length ? { t, points: p, rad: pos(s.rad ?? s.r, 2, 20), fill: col(s.fill, "#888") } : null; }
  if (t === "grad") return { t, x: n(s.x, 0), y: n(s.y, 0), w: n(s.w, 100), h: n(s.h, 100), c0: col(s.c0 ?? s.from, "#222"), c1: col(s.c1 ?? s.to, "#888"), angle: n(s.angle, 90) };
  return null;
}

// Accepts an array of shapes, or { shapes:[...], mirror?:bool, bg?:colour }.
// -> normalised { shapes, mirror, bg } (mirror is applied at render), or null.
export function cleanArt(raw) {
  let list = raw;
  let mirror = false;
  let bg = null;
  if (raw && !Array.isArray(raw) && typeof raw === "object") {
    list = raw.shapes;
    mirror = raw.mirror === true;
    bg = col(raw.bg, null);
  }
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const s of list.slice(0, MAX_SHAPES)) {
    if (!s || typeof s !== "object") continue;
    const shp = oneShape(s);
    if (shp) out.push(shp);
  }
  if (!out.length && !bg) return null;
  // stay backwards-compatible: a plain shapes array when no extras
  return mirror || bg ? { shapes: out, mirror, bg } : out;
}

function esc(s) {
  return String(s).replace(/[<>"&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" })[c]);
}

function starPoints(x, y, R, r, n, rotDeg) {
  const rot = (rotDeg * Math.PI) / 180 - Math.PI / 2;
  const p = [];
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 ? r : R;
    const a = rot + (i * Math.PI) / n;
    p.push([(x + Math.cos(a) * rad).toFixed(2), (y + Math.sin(a) * rad).toFixed(2)]);
  }
  return p.map((q) => q.join(",")).join(" ");
}
function arcPath(x, y, rad, a0, a1) {
  const r0 = (a0 * Math.PI) / 180, r1 = (a1 * Math.PI) / 180;
  const x0 = (x + rad * Math.cos(r0)).toFixed(2), y0 = (y + rad * Math.sin(r0)).toFixed(2);
  const x1 = (x + rad * Math.cos(r1)).toFixed(2), y1 = (y + rad * Math.sin(r1)).toFixed(2);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return { x0, y0, x1, y1, large };
}

function shapeSvg(s, defs) {
  const st = s.stroke ? ` stroke="${esc(s.stroke)}" stroke-width="${s.sw || 1}"` : "";
  switch (s.t) {
    case "rect": return `<rect x="${s.x}" y="${s.y}" width="${Math.max(0, s.w)}" height="${Math.max(0, s.h)}" rx="${s.r || 0}" fill="${esc(s.fill)}"${st}/>`;
    case "circle": return `<circle cx="${s.x}" cy="${s.y}" r="${s.rad}" fill="${esc(s.fill)}"${st}/>`;
    case "ellipse": return `<ellipse cx="${s.x}" cy="${s.y}" rx="${s.rx}" ry="${s.ry}" fill="${esc(s.fill)}"${st}/>`;
    case "line": return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${esc(s.stroke)}" stroke-width="${s.sw}" stroke-linecap="${s.cap}"/>`;
    case "poly": return `<polygon points="${s.points.map((p) => p.join(",")).join(" ")}" fill="${esc(s.fill)}"${st}/>`;
    case "path": return `<${s.closed ? "polygon" : "polyline"} points="${s.points.map((p) => p.join(",")).join(" ")}" fill="${s.fill ? esc(s.fill) : "none"}" stroke="${esc(s.stroke)}" stroke-width="${s.sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "curve": return `<path d="M ${s.x1} ${s.y1} Q ${s.cx} ${s.cy} ${s.x2} ${s.y2}" fill="${s.fill ? esc(s.fill) : "none"}" stroke="${esc(s.stroke)}" stroke-width="${s.sw}" stroke-linecap="round"/>`;
    case "arc": { const a = arcPath(s.x, s.y, s.rad, s.a0, s.a1); return `<path d="M ${a.x0} ${a.y0} A ${s.rad} ${s.rad} 0 ${a.large} 1 ${a.x1} ${a.y1}" fill="none" stroke="${esc(s.stroke)}" stroke-width="${s.sw}" stroke-linecap="round"/>`; }
    case "pie": { const a = arcPath(s.x, s.y, s.rad, s.a0, s.a1); return `<path d="M ${s.x} ${s.y} L ${a.x0} ${a.y0} A ${s.rad} ${s.rad} 0 ${a.large} 1 ${a.x1} ${a.y1} Z" fill="${esc(s.fill)}"/>`; }
    case "star": return `<polygon points="${starPoints(s.x, s.y, s.rad, s.inner, s.points, s.rot)}" fill="${esc(s.fill)}"${st}/>`;
    case "ring": return `<circle cx="${s.x}" cy="${s.y}" r="${s.rad}" fill="none" stroke="${esc(s.stroke)}" stroke-width="${s.sw}"/>`;
    case "dots": return s.points.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${s.rad}" fill="${esc(s.fill)}"/>`).join("");
    case "grad": {
      const id = "g" + defs.length;
      const rad = (s.angle * Math.PI) / 180;
      const x2 = (50 + Math.cos(rad) * 50).toFixed(1), y2 = (50 + Math.sin(rad) * 50).toFixed(1);
      const x1 = (50 - Math.cos(rad) * 50).toFixed(1), y1 = (50 - Math.sin(rad) * 50).toFixed(1);
      defs.push(`<linearGradient id="${id}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%"><stop offset="0" stop-color="${esc(s.c0)}"/><stop offset="1" stop-color="${esc(s.c1)}"/></linearGradient>`);
      return `<rect x="${s.x}" y="${s.y}" width="${Math.max(0, s.w)}" height="${Math.max(0, s.h)}" fill="url(#${id})"/>`;
    }
    default: return "";
  }
}

// -> inline <svg> string, or "" if no art. `stretch` fills the box.
export function artToSvg(art, stretch) {
  const shapes = Array.isArray(art) ? art : (art && art.shapes) || [];
  const mirror = !Array.isArray(art) && art && art.mirror;
  const bg = !Array.isArray(art) && art && art.bg;
  if (!shapes.length && !bg) return "";
  const par = stretch ? "none" : "xMidYMid meet";
  const defs = [];
  let body = shapes.map((s) => shapeSvg(s, defs)).join("");
  if (mirror) body += `<g transform="translate(100,0) scale(-1,1)">${shapes.map((s) => shapeSvg(s, defs)).join("")}</g>`;
  const bgRect = bg ? `<rect x="0" y="0" width="100" height="100" fill="${esc(bg)}"/>` : "";
  const d = defs.length ? `<defs>${defs.join("")}</defs>` : "";
  return `<svg class="obj-art" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="${par}">${d}${bgRect}${body}</svg>`;
}

export const ART_HELP =
  "shapes (0-100 box, y down). Wrap as [shapes] or {shapes:[...],mirror?:true,bg?:colour}. " +
  "types: rect{x,y,w,h,r?,fill} circle{x,y,rad,fill} ellipse{x,y,rx,ry,fill} line{x1,y1,x2,y2,stroke,sw} " +
  "poly{points,fill} path{points,stroke,sw,closed?,fill?} curve{x1,y1,cx,cy,x2,y2,stroke,sw} " +
  "arc{x,y,rad,a0,a1,stroke,sw} pie{x,y,rad,a0,a1,fill} star{x,y,rad,inner,n,rot?,fill} ring{x,y,rad,stroke,sw} " +
  "dots{points,rad,fill} grad{x,y,w,h,c0,c1,angle}. colour = #hex or hsl(h s% l%). up to 48 shapes.";
