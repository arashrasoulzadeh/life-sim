// The one and only game runtime. It reads a validated { kernel, params } from
// the <script type="application/json" id="spec"> block and animates it. No code
// ever comes from the model — only the numbers in `params`, already clamped by
// kernels.js on the server.

const el = document.getElementById("spec");
let spec = null;
try {
  spec = JSON.parse(el.textContent);
} catch {
  /* leave null */
}
const canvas = document.getElementById("g");
const ctx = canvas.getContext("2d");

let W = 0;
let H = 0;
function resize() {
  W = canvas.width = canvas.clientWidth || 320;
  H = canvas.height = canvas.clientHeight || 240;
}
addEventListener("resize", resize);
resize();

// --- visitor input (only reaches here when the game room is zoomed, via
// pointer-events:auto on the frame). Kernels read `input`; keys/clicks never
// run code, they just nudge numbers. ---
const input = { dir: null, dirAt: 0, taps: [], burst: 0 };
addEventListener("keydown", (e) => {
  const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }[e.key];
  if (d) {
    input.dir = d;
    input.dirAt = performance.now();
    e.preventDefault();
  }
});
canvas.addEventListener("pointerdown", (e) => {
  const r = canvas.getBoundingClientRect();
  input.taps.push({ x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H });
  input.burst = 1;
  if (input.taps.length > 12) input.taps.shift();
});
const takeTaps = () => {
  const t = input.taps;
  input.taps = [];
  return t;
};

const KERNEL_FN = {};

KERNEL_FN.orbit = (p) => {
  const bodies = Array.from({ length: p.count }, (_, i) => ({
    r: 0.15 + (0.7 * (i + 1)) / p.count,
    a: Math.random() * 6.28,
    s: (0.4 + Math.random()) * p.speed * 0.02 * (i % 2 ? 1 : -1),
  }));
  loop(() => {
    ctx.fillStyle = p.trail ? "rgba(5,7,10,0.12)" : "#05070a";
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    const rad = Math.min(W, H) * 0.45;
    for (const b of bodies) {
      b.a += b.s;
      const x = cx + Math.cos(b.a) * rad * b.r;
      const y = cy + Math.sin(b.a) * rad * b.r;
      ctx.fillStyle = `hsl(${p.hue + b.r * 60} 70% 60%)`;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 6.29);
      ctx.fill();
    }
  });
};

KERNEL_FN.bounce = (p) => {
  const balls = Array.from({ length: p.count }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    vx: (Math.random() - 0.5) * 4 * p.speed,
    vy: (Math.random() - 0.5) * 4 * p.speed,
  }));
  loop(() => {
    for (const t of takeTaps()) {
      if (balls.length < 40) balls.push({ x: t.x, y: t.y, vx: (Math.random() - 0.5) * 6 * p.speed, vy: (Math.random() - 0.5) * 6 * p.speed });
    }
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, W, H);
    for (const b of balls) {
      if (p.gravity) b.vy += 0.12 * p.speed;
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < 6 || b.x > W - 6) (b.vx *= -1), (b.x = Math.max(6, Math.min(W - 6, b.x)));
      if (b.y < 6 || b.y > H - 6) (b.vy *= p.gravity ? -0.86 : -1), (b.y = Math.max(6, Math.min(H - 6, b.y)));
      ctx.fillStyle = `hsl(${p.hue} 75% 62%)`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 6, 0, 6.29);
      ctx.fill();
    }
  });
};

KERNEL_FN.rain = (p) => {
  const cols = () => Math.max(8, Math.floor(W / 14));
  let drops = Array.from({ length: cols() }, () => Math.random() * -H);
  loop(() => {
    ctx.fillStyle = "rgba(5,7,10,0.25)";
    ctx.fillRect(0, 0, W, H);
    ctx.font = "13px ui-monospace, monospace";
    const step = W / drops.length;
    for (let i = 0; i < drops.length; i++) {
      drops[i] += 2 + p.density * 6;
      if (drops[i] > H && Math.random() < p.density * 0.1) drops[i] = -20;
      ctx.fillStyle = `hsl(${p.hue} 70% ${45 + Math.random() * 25}%)`;
      ctx.fillText(p.glyph, i * step + step / 2, drops[i]);
    }
  });
};

KERNEL_FN.pulse = (p) => {
  let t = 0;
  loop(() => {
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, W, H);
    t += 0.02 * p.rate;
    const cx = W / 2;
    const cy = H / 2;
    const max = Math.min(W, H) * 0.5;
    for (let i = 0; i < p.rings; i++) {
      const r = ((t + i / p.rings) % 1) * max;
      ctx.strokeStyle = `hsl(${p.hue + i * 12} 70% 60% / ${1 - r / max})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 6.29);
      ctx.stroke();
    }
  });
};

KERNEL_FN.life = (p) => {
  let gw = Math.max(8, Math.floor(W / p.cell));
  let gh = Math.max(8, Math.floor(H / p.cell));
  let grid = new Uint8Array(gw * gh).map(() => (Math.random() < p.density ? 1 : 0));
  let acc = 0;
  loop((dt) => {
    acc += dt;
    if (acc > 90) {
      acc = 0;
      const n = new Uint8Array(gw * gh);
      for (let y = 0; y < gh; y++)
        for (let x = 0; x < gw; x++) {
          let c = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = (x + dx + gw) % gw;
              const ny = (y + dy + gh) % gh;
              c += grid[ny * gw + nx];
            }
          const a = grid[y * gw + x];
          n[y * gw + x] = a ? (c === 2 || c === 3 ? 1 : 0) : c === 3 ? 1 : 0;
        }
      grid = n;
    }
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = `hsl(${p.hue} 65% 58%)`;
    const cw = W / gw;
    const ch = H / gh;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) if (grid[y * gw + x]) ctx.fillRect(x * cw, y * ch, cw - 1, ch - 1);
  });
};

KERNEL_FN.snake = (p) => {
  const g = p.grid;
  let snake = [{ x: (g / 2) | 0, y: (g / 2) | 0 }];
  let dir = { x: 1, y: 0 };
  let food = { x: (Math.random() * g) | 0, y: (Math.random() * g) | 0 };
  let acc = 0;
  const stepMs = 220 / p.speed;
  loop((dt) => {
    acc += dt;
    if (acc >= stepMs) {
      acc = 0;
      const head = snake[0];
      const manual = input.dir && performance.now() - input.dirAt < 4000;
      if (manual && !(input.dir[0] === -dir.x && input.dir[1] === -dir.y)) {
        dir = { x: input.dir[0], y: input.dir[1] };
      } else {
        // greedy auto-pilot toward food, avoiding self
        const opts = [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: -1 },
        ].filter((d) => !(d.x === -dir.x && d.y === -dir.y));
        opts.sort(
          (a, b) =>
            Math.hypot(head.x + a.x - food.x, head.y + a.y - food.y) -
            Math.hypot(head.x + b.x - food.x, head.y + b.y - food.y),
        );
        dir =
          opts.find((d) => {
            const nx = (head.x + d.x + g) % g;
            const ny = (head.y + d.y + g) % g;
            return !snake.some((s) => s.x === nx && s.y === ny);
          }) || dir;
      }
      const nx = (head.x + dir.x + g) % g;
      const ny = (head.y + dir.y + g) % g;
      snake.unshift({ x: nx, y: ny });
      if (nx === food.x && ny === food.y) food = { x: (Math.random() * g) | 0, y: (Math.random() * g) | 0 };
      else snake.pop();
    }
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, W, H);
    const c = Math.min(W, H) / g;
    ctx.fillStyle = `hsl(${p.hue + 40} 80% 60%)`;
    ctx.fillRect(food.x * c, food.y * c, c - 1, c - 1);
    ctx.fillStyle = `hsl(${p.hue} 70% 58%)`;
    for (const s of snake) ctx.fillRect(s.x * c, s.y * c, c - 1, c - 1);
  });
};

function loop(fn) {
  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(60, now - last);
    last = now;
    fn(dt);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// --- start ---
if (!spec || !KERNEL_FN[spec.kernel]) {
  ctx.fillStyle = "#0e1116";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#5f6675";
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText("no game yet", 12, 22);
} else {
  KERNEL_FN[spec.kernel](spec.params);
}
