// The AI's own drawing of an object it owns. It never sends markup — it sends a
// short list of primitive shapes in a 0..100 box, validated here, and the app
// composes the SVG. Once drawn, the item shows this instead of its emoji.

const HEX = /^#[0-9a-fA-F]{3,8}$/;
// hsl()/hsla()/rgb()/rgba() with only digits, %, spaces, commas, dots, slash
const FN_COLOR = /^(hsla?|rgba?)\(\s*[0-9.,%\s/]+\)$/i;
const MAX_SHAPES = 24;

function n(v, d) {
  v = Number(v);
  if (!isFinite(v)) return d;
  return Math.max(-20, Math.min(120, v));
}
function col(v, d) {
  if (typeof v !== "string") return d;
  const s = v.trim();
  if (HEX.test(s)) return s.toLowerCase();
  if (FN_COLOR.test(s) && s.length < 40) return s;
  return d;
}

// -> [{t, ...}] clamped, or null
export function cleanArt(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const s of raw.slice(0, MAX_SHAPES)) {
    if (!s || typeof s !== "object") continue;
    const t = String(s.t || s.type || "");
    if (t === "rect") {
      out.push({ t, x: n(s.x, 10), y: n(s.y, 10), w: n(s.w, 20), h: n(s.h, 20), r: Math.max(0, Math.min(50, Number(s.r) || 0)), fill: col(s.fill, "#888"), stroke: col(s.stroke, null), sw: n(s.sw, 0) });
    } else if (t === "circle") {
      out.push({ t, x: n(s.x, 50), y: n(s.y, 50), rad: Math.max(0.5, Math.min(80, Number(s.rad ?? s.r) || 10)), fill: col(s.fill, "#888"), stroke: col(s.stroke, null), sw: n(s.sw, 0) });
    } else if (t === "ellipse") {
      out.push({ t, x: n(s.x, 50), y: n(s.y, 50), rx: Math.max(0.5, Math.min(80, Number(s.rx) || 15)), ry: Math.max(0.5, Math.min(80, Number(s.ry) || 10)), fill: col(s.fill, "#888"), stroke: col(s.stroke, null), sw: n(s.sw, 0) });
    } else if (t === "line") {
      out.push({ t, x1: n(s.x1, 10), y1: n(s.y1, 10), x2: n(s.x2, 90), y2: n(s.y2, 90), stroke: col(s.stroke, "#888"), sw: Math.max(0.5, n(s.sw, 2)) });
    } else if (t === "poly") {
      const pts = Array.isArray(s.points) ? s.points.slice(0, 16).map((p) => [n(p[0], 50), n(p[1], 50)]) : [];
      if (pts.length >= 3) out.push({ t, points: pts, fill: col(s.fill, "#888"), stroke: col(s.stroke, null), sw: n(s.sw, 0) });
    } else if (t === "path" || t === "polyline") {
      const pts = Array.isArray(s.points) ? s.points.slice(0, 40).map((p) => [n(p[0], 50), n(p[1], 50)]) : [];
      if (pts.length >= 2) out.push({ t: "path", points: pts, stroke: col(s.stroke, "#888"), sw: Math.max(0.5, n(s.sw, 2)), fill: col(s.fill, null) });
    } else if (t === "arc") {
      out.push({ t, x: n(s.x, 50), y: n(s.y, 50), rad: Math.max(0.5, Math.min(80, Number(s.rad ?? s.r) || 12)), a0: n(s.a0, 0), a1: n(s.a1, 180), stroke: col(s.stroke, "#888"), sw: Math.max(0.5, n(s.sw, 2)) });
    }
  }
  return out.length ? out : null;
}

function esc(s) {
  return String(s).replace(/[<>"&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" })[c]);
}

// -> inline <svg> string, or "" if no art. `stretch` fills the box (for framed
// paintings); default keeps aspect (for objects).
export function artToSvg(shapes, stretch) {
  if (!Array.isArray(shapes) || !shapes.length) return "";
  const par = stretch ? "none" : "xMidYMid meet";
  const parts = [];
  for (const s of shapes) {
    const st = s.stroke ? ` stroke="${esc(s.stroke)}" stroke-width="${s.sw || 1}"` : "";
    if (s.t === "rect") parts.push(`<rect x="${s.x}" y="${s.y}" width="${Math.max(0, s.w)}" height="${Math.max(0, s.h)}" rx="${s.r || 0}" fill="${esc(s.fill)}"${st}/>`);
    else if (s.t === "circle") parts.push(`<circle cx="${s.x}" cy="${s.y}" r="${s.rad}" fill="${esc(s.fill)}"${st}/>`);
    else if (s.t === "ellipse") parts.push(`<ellipse cx="${s.x}" cy="${s.y}" rx="${s.rx}" ry="${s.ry}" fill="${esc(s.fill)}"${st}/>`);
    else if (s.t === "line") parts.push(`<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${esc(s.stroke)}" stroke-width="${s.sw}" stroke-linecap="round"/>`);
    else if (s.t === "poly") parts.push(`<polygon points="${s.points.map((p) => p.join(",")).join(" ")}" fill="${esc(s.fill)}"${st}/>`);
    else if (s.t === "path") parts.push(`<polyline points="${s.points.map((p) => p.join(",")).join(" ")}" fill="${s.fill ? esc(s.fill) : "none"}" stroke="${esc(s.stroke)}" stroke-width="${s.sw}" stroke-linecap="round" stroke-linejoin="round"/>`);
    else if (s.t === "arc") {
      const r0 = (s.a0 * Math.PI) / 180, r1 = (s.a1 * Math.PI) / 180;
      const x0 = (s.x + s.rad * Math.cos(r0)).toFixed(2), y0 = (s.y + s.rad * Math.sin(r0)).toFixed(2);
      const x1 = (s.x + s.rad * Math.cos(r1)).toFixed(2), y1 = (s.y + s.rad * Math.sin(r1)).toFixed(2);
      const large = Math.abs(s.a1 - s.a0) > 180 ? 1 : 0;
      parts.push(`<path d="M ${x0} ${y0} A ${s.rad} ${s.rad} 0 ${large} 1 ${x1} ${y1}" fill="none" stroke="${esc(s.stroke)}" stroke-width="${s.sw}" stroke-linecap="round"/>`);
    }
  }
  return `<svg class="obj-art" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="${par}">${parts.join("")}</svg>`;
}

export const ART_HELP =
  'shapes (0-100 box, y down): rect{x,y,w,h,r?,fill} / circle{x,y,rad,fill} / ellipse{x,y,rx,ry,fill} / line{x1,y1,x2,y2,stroke,sw} / poly{points:[[x,y]..],fill} / path{points:[[x,y]..],stroke,sw} / arc{x,y,rad,a0,a1,stroke,sw}. fill/stroke = #hex or hsl(h s% l%). Max 24 shapes, simple and recognisable.';
