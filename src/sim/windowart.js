// Generative art the AI hangs in the window. It never writes markup — it picks
// a style and a few numbers from a closed vocabulary, and this builds the layers.

export const ART_STYLES = ["bands", "rings", "scatter", "hills", "panes", "aurora", "waves", "city", "forest", "nebula", "sunburst", "stainedglass", "tide", "dunes"];

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
  const hexA = (h, o) => h.replace(")", ` / ${o})`);
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
    case "waves": {
      const layers = [];
      const rows = Math.max(3, Math.round(3 + art.density * 5));
      for (let i = 0; i < rows; i++) {
        const yy = 40 + (i / rows) * 60;
        const c = i % 2 ? a : b;
        layers.push(`radial-gradient(140% 40% at ${(i * 37) % 100}% ${yy}%, ${c} 0 30%, transparent 32%)`);
      }
      layers.push(`linear-gradient(${dk}, hsl(${art.hue2} 45% 20%))`);
      return layers.join(", ");
    }
    case "city": {
      const r = rng(art.hue * 3 + art.hue2 + 9);
      const cols = Math.max(5, Math.round(6 + art.density * 8));
      const w = (100 / cols).toFixed(2);
      const towers = [];
      for (let i = 0; i < cols; i++) {
        const hgt = (30 + r() * 55).toFixed(1);
        towers.push(`linear-gradient(to top, ${r() > 0.5 ? a : b} 0 ${hgt}%, transparent ${hgt}%) ${(i * (100 / cols)).toFixed(2)}% 100% / ${w}% 100% no-repeat`);
      }
      towers.push(`linear-gradient(hsl(${art.hue} 40% 18%), ${dk})`);
      return towers.join(", ");
    }
    case "forest": {
      const r = rng(art.hue2 + 21);
      const trees = [];
      const n = Math.max(4, Math.round(5 + art.density * 8));
      for (let i = 0; i < n; i++) {
        const x = (r() * 100).toFixed(1);
        const sz = (10 + r() * 16).toFixed(1);
        trees.push(`radial-gradient(${sz}% ${(+sz * 1.6).toFixed(1)}% at ${x}% ${(70 + r() * 25).toFixed(1)}%, hsl(${art.hue} 45% ${(22 + r() * 18) | 0}%) 0 60%, transparent 62%)`);
      }
      trees.push(`linear-gradient(hsl(${art.hue2} 40% 22%) 0 55%, hsl(${art.hue} 35% 14%) 55% 100%)`);
      return trees.join(", ");
    }
    case "nebula": {
      const r = rng(art.hue + art.hue2 * 2 + 5);
      const clouds = [];
      for (let i = 0; i < 5; i++) {
        clouds.push(`radial-gradient(${(30 + r() * 40).toFixed(0)}% ${(25 + r() * 35).toFixed(0)}% at ${(r() * 100).toFixed(0)}% ${(r() * 100).toFixed(0)}%, ${r() > 0.5 ? a : b} 0 20%, transparent 60%)`);
      }
      for (let i = 0; i < Math.round(8 + art.density * 20); i++) {
        clouds.push(`radial-gradient(circle at ${(r() * 100).toFixed(1)}% ${(r() * 100).toFixed(1)}%, #fff 0 0.6px, transparent 1px)`);
      }
      clouds.push("#04060c");
      return clouds.join(", ");
    }
    case "stainedglass": {
      const r = rng(art.hue * 5 + art.hue2 + 3);
      const cells = [];
      const n = Math.max(6, Math.round(6 + art.density * 12));
      for (let i = 0; i < n; i++) {
        const x = (r() * 100).toFixed(1);
        const y = (r() * 100).toFixed(1);
        const rad = (14 + r() * 22).toFixed(1);
        const hh = Math.round((r() > 0.5 ? art.hue : art.hue2) + (r() - 0.5) * 40);
        cells.push(`radial-gradient(circle at ${x}% ${y}%, hsl(${hh} 65% 50%) 0 ${rad}%, transparent ${(+rad + 2).toFixed(1)}%)`);
      }
      cells.push(`hsl(${art.hue} 20% 8%)`);
      return cells.join(", ");
    }
    case "tide": {
      const layers = [];
      const rows = Math.max(3, Math.round(3 + art.density * 6));
      for (let i = 0; i < rows; i++) {
        const yy = 100 - (i / rows) * 100;
        const c = i % 2 ? a : b;
        layers.push(`radial-gradient(160% 30% at 50% ${yy}%, ${hexA(c, 0.5)} 0 40%, transparent 42%)`);
      }
      layers.push(`linear-gradient(hsl(${art.hue2} 40% 22%), ${dk})`);
      return layers.join(", ");
    }
    case "dunes": {
      return `radial-gradient(120% 40% at 30% 100%, ${b} 0 45%, transparent 47%),
              radial-gradient(120% 38% at 75% 100%, ${a} 0 42%, transparent 44%),
              radial-gradient(90% 30% at 50% 100%, hsl(${art.hue} 55% 40%) 0 40%, transparent 42%),
              linear-gradient(hsl(${art.hue} 70% 62%) 0 30%, hsl(${art.hue2} 45% 30%))`;
    }
    case "sunburst": {
      const stops = [];
      const rays = Math.max(8, Math.round(8 + art.density * 16));
      for (let i = 0; i < rays; i++) {
        const from = ((i / rays) * 360).toFixed(1);
        const to = (((i + 0.5) / rays) * 360).toFixed(1);
        stops.push(`${i % 2 ? a : dk} ${from}deg ${to}deg`);
      }
      return `radial-gradient(circle at 50% 46%, hsl(${art.hue} 80% 60%) 0 6%, transparent 8%), conic-gradient(from 0deg at 50% 46%, ${stops.join(", ")})`;
    }
    default:
      return dk;
  }
}

export function windowArtLabel(art) {
  return art ? `${art.style} in ${art.hue}°` : "clear glass";
}

// a fresh procedural composition — used to rotate the window on its own when
// the AI hasn't chosen one lately
export function autoWindowArt(rng) {
  const h = rng.int(0, 360);
  return {
    style: rng.pick(ART_STYLES),
    hue: h,
    hue2: (h + rng.int(40, 200)) % 360,
    density: Math.round((0.35 + rng.next() * 0.55) * 100) / 100,
  };
}
