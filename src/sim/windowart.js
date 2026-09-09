// Generative art the AI hangs in the window. It never writes markup — it picks
// a style and a few numbers from a closed vocabulary, and this builds the layers.

export const ART_STYLES = ["bands", "rings", "scatter", "hills", "panes", "aurora"];

export function cleanWindowArt(raw) {
  if (!raw || typeof raw !== "object") return null;
  const style = ART_STYLES.includes(raw.style) ? raw.style : null;
  if (!style) return null;
  const hue = clampInt(raw.hue, 0, 360, 210);
  const hue2 = clampInt(raw.hue2, 0, 360, (hue + 60) % 360);
  const density = clampNum(raw.density, 0.2, 1, 0.6);
  return { style, hue, hue2, density };
}

function clampInt(v, lo, hi, d) {
  v = Math.round(Number(v));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
}
function clampNum(v, lo, hi, d) {
  v = Number(v);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
}

// deterministic tiny prng so a given art always looks the same
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// returns a CSS `background` value (layered) for the window pane
export function windowArtCss(art) {
  if (!art) return "#0c1430";
  const a = `hsl(${art.hue} 60% 55%)`;
  const b = `hsl(${art.hue2} 60% 45%)`;
  const dk = `hsl(${art.hue} 45% 14%)`;
  switch (art.style) {
    case "bands":
      return `linear-gradient(${b} 0 22%, ${a} 22% 40%, hsl(${art.hue2} 50% 30%) 40% 60%, ${dk} 60% 100%)`;
    case "rings":
      return `radial-gradient(circle at 50% 60%, ${a} 0 8%, ${dk} 8% 16%, ${b} 16% 24%, ${dk} 24% 34%, ${a} 34% 44%, ${dk} 44% 100%)`;
    case "scatter": {
      const r = rng(art.hue * 7 + art.hue2);
      const dots = Array.from({ length: Math.round(6 + art.density * 14) }, () => {
        const x = (r() * 100).toFixed(1);
        const y = (r() * 100).toFixed(1);
        const s = (2 + r() * 4).toFixed(1);
        return `radial-gradient(circle at ${x}% ${y}%, ${r() > 0.5 ? a : b} 0 ${s}px, transparent ${s}px)`;
      });
      return [...dots, dk].join(", ");
    }
    case "hills":
      return `radial-gradient(120% 60% at 20% 100%, ${b} 0 40%, transparent 41%), radial-gradient(120% 55% at 80% 100%, ${a} 0 38%, transparent 39%), linear-gradient(${dk}, hsl(${art.hue2} 45% 22%))`;
    case "panes": {
      const c = Math.max(3, Math.round(2 + art.density * 4));
      return `conic-gradient(${a} 0 25%, ${b} 0 50%, ${dk} 0 75%, hsl(${art.hue2} 40% 30%) 0) 0 0 / ${(100 / c).toFixed(1)}% ${(100 / c).toFixed(1)}%`;
    }
    case "aurora":
      return `linear-gradient(115deg, ${dk} 0 20%, ${a} 35%, ${dk} 50%, ${b} 65%, ${dk} 80% 100%)`;
    default:
      return dk;
  }
}

export function windowArtLabel(art) {
  return art ? `${art.style} in ${art.hue}°` : "clear glass";
}
