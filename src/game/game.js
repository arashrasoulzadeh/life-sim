// The one and only game runtime. It reads a validated { kernel, params } from
// the <script type="application/json" id="spec"> block and animates it. No code
// ever comes from the model — only the numbers in `params`, already clamped by
// kernels.js on the server. Everything here is defensive: a bad spec, a missing
// canvas, a zero-size frame or a throwing kernel all degrade to a message, never
// a blank screen or an uncaught error.

(function () {
  "use strict";

  var canvas = document.getElementById("g");
  if (!canvas || typeof canvas.getContext !== "function") return;
  var ctx = null;
  try {
    ctx = canvas.getContext("2d");
  } catch (e) {
    /* ignore */
  }
  if (!ctx) return;

  var W = 320;
  var H = 240;
  var repaint = null; // set for static states so a resize doesn't wipe them
  function fit() {
    var w = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || window.innerWidth || 320;
    var h = canvas.clientHeight || (canvas.parentElement && canvas.parentElement.clientHeight) || window.innerHeight || 240;
    var nw = Math.max(80, Math.min(4096, Math.round(w)));
    var nh = Math.max(60, Math.min(4096, Math.round(h)));
    if (nw === W && nh === H && canvas.width === W) return;
    W = canvas.width = nw;
    H = canvas.height = nh;
    if (repaint) try { repaint(); } catch (e) {}
  }
  fit();
  try {
    window.addEventListener("resize", fit);
  } catch (e) {}
  try {
    if (typeof ResizeObserver === "function") new ResizeObserver(fit).observe(canvas);
  } catch (e) {}

  function msg(text, color) {
    repaint = function () {
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#0e1116";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = color || "#5f6675";
        ctx.font = "13px ui-monospace, monospace";
        ctx.textBaseline = "middle";
        ctx.fillText(String(text), Math.max(10, W / 2 - ctx.measureText(String(text)).width / 2), H / 2);
      } catch (e) {}
    };
    repaint();
  }

  // numeric guard — never let a bad param produce NaN / Infinity / a huge array
  function num(v, def, lo, hi) {
    v = Number(v);
    if (!isFinite(v)) v = def;
    if (lo != null && v < lo) v = lo;
    if (hi != null && v > hi) v = hi;
    return v;
  }
  function intn(v, def, lo, hi) {
    return Math.round(num(v, def, lo, hi));
  }

  var spec = null;
  try {
    var el = document.getElementById("spec");
    if (el) spec = JSON.parse(el.textContent || "null");
  } catch (e) {
    spec = null;
  }

  // --- visitor input: keys / taps only nudge numbers, never run code ---
  var input = { dir: null, dirAt: 0, taps: [], burst: 0 };
  try {
    window.addEventListener("keydown", function (e) {
      var map = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
      var dd = map[e.key];
      if (dd) {
        input.dir = dd;
        input.dirAt = performance.now();
        e.preventDefault();
      }
    });
    canvas.addEventListener("pointerdown", function (e) {
      var r = canvas.getBoundingClientRect();
      var rw = r.width || W;
      var rh = r.height || H;
      input.taps.push({ x: ((e.clientX - r.left) / rw) * W, y: ((e.clientY - r.top) / rh) * H });
      input.burst = 1;
      if (input.taps.length > 12) input.taps.shift();
    });
  } catch (e) {}
  function takeTaps() {
    var t = input.taps;
    input.taps = [];
    return t;
  }

  var KERNEL_FN = {};

  KERNEL_FN.orbit = function (p) {
    var count = intn(p.count, 6, 2, 14);
    var speed = num(p.speed, 1, 0.2, 2.5);
    var hue = num(p.hue, 200, 0, 360);
    var trail = p.trail !== false;
    var bodies = [];
    for (var i = 0; i < count; i++) {
      bodies.push({ r: 0.15 + (0.7 * (i + 1)) / count, a: Math.random() * 6.28, s: (0.4 + Math.random()) * speed * 0.02 * (i % 2 ? 1 : -1) });
    }
    loop(function () {
      ctx.fillStyle = trail ? "rgba(5,7,10,0.12)" : "#05070a";
      ctx.fillRect(0, 0, W, H);
      var cx = W / 2, cy = H / 2, rad = Math.min(W, H) * 0.45;
      for (var j = 0; j < bodies.length; j++) {
        var b = bodies[j];
        b.a += b.s;
        var x = cx + Math.cos(b.a) * rad * b.r;
        var y = cy + Math.sin(b.a) * rad * b.r;
        ctx.fillStyle = "hsl(" + (hue + b.r * 60) + " 70% 60%)";
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 6.29);
        ctx.fill();
      }
    });
  };

  KERNEL_FN.bounce = function (p) {
    var count = intn(p.count, 3, 1, 10);
    var speed = num(p.speed, 1.2, 0.3, 3);
    var hue = num(p.hue, 40, 0, 360);
    var gravity = p.gravity === true;
    var balls = [];
    for (var i = 0; i < count; i++) balls.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 4 * speed, vy: (Math.random() - 0.5) * 4 * speed });
    loop(function () {
      var taps = takeTaps();
      for (var k = 0; k < taps.length; k++) if (balls.length < 40) balls.push({ x: taps[k].x, y: taps[k].y, vx: (Math.random() - 0.5) * 6 * speed, vy: (Math.random() - 0.5) * 6 * speed });
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      for (var j = 0; j < balls.length; j++) {
        var b = balls[j];
        if (gravity) b.vy += 0.12 * speed;
        b.x += b.vx;
        b.y += b.vy;
        if (b.x < 6 || b.x > W - 6) { b.vx *= -1; b.x = Math.max(6, Math.min(W - 6, b.x)); }
        if (b.y < 6 || b.y > H - 6) { b.vy *= gravity ? -0.86 : -1; b.y = Math.max(6, Math.min(H - 6, b.y)); }
        ctx.fillStyle = "hsl(" + hue + " 75% 62%)";
        ctx.beginPath();
        ctx.arc(b.x, b.y, 6, 0, 6.29);
        ctx.fill();
      }
    });
  };

  KERNEL_FN.rain = function (p) {
    var density = num(p.density, 0.5, 0.15, 1);
    var hue = num(p.hue, 190, 0, 360);
    var glyph = typeof p.glyph === "string" && p.glyph.length ? p.glyph[0] : "/";
    var n = Math.max(8, Math.floor(W / 14));
    var drops = [];
    for (var i = 0; i < n; i++) drops.push(Math.random() * -H);
    loop(function () {
      ctx.fillStyle = "rgba(5,7,10,0.25)";
      ctx.fillRect(0, 0, W, H);
      ctx.font = "13px ui-monospace, monospace";
      var step = W / drops.length;
      for (var j = 0; j < drops.length; j++) {
        drops[j] += 2 + density * 6;
        if (drops[j] > H && Math.random() < density * 0.1) drops[j] = -20;
        ctx.fillStyle = "hsl(" + hue + " 70% " + (45 + Math.random() * 25) + "%)";
        ctx.fillText(glyph, j * step + step / 2, drops[j]);
      }
    });
  };

  KERNEL_FN.pulse = function (p) {
    var rate = num(p.rate, 1, 0.3, 2.5);
    var rings = intn(p.rings, 4, 2, 7);
    var hue = num(p.hue, 280, 0, 360);
    var t = 0;
    loop(function () {
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      t += 0.02 * rate;
      var cx = W / 2, cy = H / 2, max = Math.min(W, H) * 0.5;
      for (var i = 0; i < rings; i++) {
        var r = ((t + i / rings) % 1) * max;
        ctx.strokeStyle = "hsl(" + (hue + i * 12) + " 70% 60% / " + (1 - r / max) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 6.29);
        ctx.stroke();
      }
    });
  };

  KERNEL_FN.life = function (p) {
    var cell = intn(p.cell, 8, 4, 14);
    var density = num(p.density, 0.32, 0.15, 0.6);
    var hue = num(p.hue, 140, 0, 360);
    var gw = Math.max(8, Math.floor(W / cell));
    var gh = Math.max(8, Math.floor(H / cell));
    var grid = new Uint8Array(gw * gh);
    for (var q = 0; q < grid.length; q++) grid[q] = Math.random() < density ? 1 : 0;
    var acc = 0;
    loop(function (dt) {
      acc += dt;
      if (acc > 90) {
        acc = 0;
        var nx = new Uint8Array(gw * gh);
        for (var y = 0; y < gh; y++)
          for (var x = 0; x < gw; x++) {
            var c = 0;
            for (var dy = -1; dy <= 1; dy++)
              for (var dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                c += grid[((y + dy + gh) % gh) * gw + ((x + dx + gw) % gw)];
              }
            var al = grid[y * gw + x];
            nx[y * gw + x] = al ? (c === 2 || c === 3 ? 1 : 0) : c === 3 ? 1 : 0;
          }
        grid = nx;
      }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "hsl(" + hue + " 65% 58%)";
      var cw = W / gw, ch = H / gh;
      for (var yy = 0; yy < gh; yy++) for (var xx = 0; xx < gw; xx++) if (grid[yy * gw + xx]) ctx.fillRect(xx * cw, yy * ch, cw - 1, ch - 1);
    });
  };

  KERNEL_FN.snake = function (p) {
    var g = intn(p.grid, 16, 10, 24);
    var speed = num(p.speed, 1.3, 0.4, 3);
    var hue = num(p.hue, 110, 0, 360);
    var snake = [{ x: (g / 2) | 0, y: (g / 2) | 0 }];
    var dir = { x: 1, y: 0 };
    var food = { x: (Math.random() * g) | 0, y: (Math.random() * g) | 0 };
    var acc = 0;
    var stepMs = 220 / speed;
    loop(function (dt) {
      acc += dt;
      if (acc >= stepMs) {
        acc = 0;
        var head = snake[0];
        var manual = input.dir && performance.now() - input.dirAt < 4000;
        if (manual && !(input.dir[0] === -dir.x && input.dir[1] === -dir.y)) {
          dir = { x: input.dir[0], y: input.dir[1] };
        } else {
          var opts = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].filter(function (d) {
            return !(d.x === -dir.x && d.y === -dir.y);
          });
          opts.sort(function (a, b) {
            return Math.hypot(head.x + a.x - food.x, head.y + a.y - food.y) - Math.hypot(head.x + b.x - food.x, head.y + b.y - food.y);
          });
          dir =
            opts.find(function (d) {
              var nnx = (head.x + d.x + g) % g;
              var nny = (head.y + d.y + g) % g;
              return !snake.some(function (s) {
                return s.x === nnx && s.y === nny;
              });
            }) || dir;
        }
        var hx = (head.x + dir.x + g) % g;
        var hy = (head.y + dir.y + g) % g;
        snake.unshift({ x: hx, y: hy });
        if (hx === food.x && hy === food.y) food = { x: (Math.random() * g) | 0, y: (Math.random() * g) | 0 };
        else snake.pop();
      }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      var c = Math.min(W, H) / g;
      ctx.fillStyle = "hsl(" + (hue + 40) + " 80% 60%)";
      ctx.fillRect(food.x * c, food.y * c, c - 1, c - 1);
      ctx.fillStyle = "hsl(" + hue + " 70% 58%)";
      for (var i = 0; i < snake.length; i++) ctx.fillRect(snake[i].x * c, snake[i].y * c, c - 1, c - 1);
    });
  };

  KERNEL_FN.starfield = function (p) {
    var count = intn(p.count, 160, 40, 400);
    var speed = num(p.speed, 1.4, 0.3, 4);
    var hue = num(p.hue, 210, 0, 360);
    var warp = p.warp !== false;
    var stars = [];
    for (var i = 0; i < count; i++) stars.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() });
    loop(function () {
      ctx.fillStyle = warp ? "rgba(5,7,10,0.35)" : "#05070a";
      ctx.fillRect(0, 0, W, H);
      var cx = W / 2, cy = H / 2;
      for (var j = 0; j < stars.length; j++) {
        var s = stars[j];
        s.z -= 0.006 * speed;
        if (s.z <= 0.02) { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; }
        var k = 1 / s.z;
        var x = cx + s.x * k * cx * 0.9;
        var y = cy + s.y * k * cy * 0.9;
        if (x < 0 || x > W || y < 0 || y > H) continue;
        var r = Math.max(0.4, (1 - s.z) * 2.4);
        ctx.fillStyle = "hsl(" + (hue + (1 - s.z) * 40) + " 60% " + (55 + (1 - s.z) * 30) + "%)";
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
  };

  KERNEL_FN.flock = function (p) {
    var count = intn(p.count, 50, 12, 120);
    var speed = num(p.speed, 1.2, 0.4, 3);
    var cohesion = num(p.cohesion, 1, 0, 2);
    var hue = num(p.hue, 30, 0, 360);
    var b = [];
    for (var i = 0; i < count; i++) b.push({ x: Math.random() * W, y: Math.random() * H, a: Math.random() * 6.28 });
    loop(function () {
      ctx.fillStyle = "rgba(5,7,10,0.3)";
      ctx.fillRect(0, 0, W, H);
      var taps = takeTaps();
      for (var tt = 0; tt < taps.length; tt++) for (var oi = 0; oi < b.length; oi++) b[oi].a = Math.atan2(b[oi].y - taps[tt].y, b[oi].x - taps[tt].x);
      var mx = 0, my = 0;
      for (var m = 0; m < b.length; m++) { mx += b[m].x; my += b[m].y; }
      mx /= b.length; my /= b.length;
      for (var j = 0; j < b.length; j++) {
        var o = b[j];
        var ax = 0, ay = 0, nn = 0;
        for (var q = 0; q < b.length; q++) {
          var dx = b[q].x - o.x, dy = b[q].y - o.y, dd = dx * dx + dy * dy;
          if (dd > 0 && dd < 2000) { ax -= (dx / dd) * 20; ay -= (dy / dd) * 20; nn++; }
        }
        var toC = Math.atan2(my - o.y, mx - o.x);
        o.a += Math.sin(toC - o.a) * 0.03 * cohesion + (nn ? Math.sin(Math.atan2(ay, ax) - o.a) * 0.05 : 0);
        o.x = (o.x + Math.cos(o.a) * 1.6 * speed + W) % W;
        o.y = (o.y + Math.sin(o.a) * 1.6 * speed + H) % H;
        ctx.fillStyle = "hsl(" + hue + " 75% 62%)";
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate(o.a);
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(-3, 2);
        ctx.lineTo(-3, -2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
  };

  KERNEL_FN.spiro = function (p) {
    var R = intn(p.outer, 96, 40, 140);
    var r = intn(p.inner, 41, 10, 90);
    if (r >= R) r = Math.max(10, R - 10);
    var d = r * num(p.offset, 0.7, 0.2, 1);
    var speed = num(p.speed, 1.2, 0.3, 3);
    var hue = num(p.hue, 300, 0, 360);
    // one closed figure needs t to run through this many turns
    function gcd(a, b) { return b ? gcd(b, a % b) : a; }
    var turns = Math.max(1, Math.min(60, r / gcd(R - r, r)));
    var STEPS = Math.max(240, Math.round(turns * 90));
    var phase = 0;
    loop(function () {
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      var cx = W / 2, cy = H / 2, sc = (Math.min(W, H) * 0.46) / (R - r + d);
      phase += 0.01 * speed;
      ctx.beginPath();
      for (var i = 0; i <= STEPS; i++) {
        var a = (i / STEPS) * turns * 6.2832;
        var bx = (R - r) * Math.cos(a) + d * Math.cos(((R - r) / r) * a);
        var by = (R - r) * Math.sin(a) - d * Math.sin(((R - r) / r) * a);
        var ca = Math.cos(phase), sa = Math.sin(phase);
        var px = cx + (bx * ca - by * sa) * sc;
        var py = cy + (bx * sa + by * ca) * sc;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.strokeStyle = "hsl(" + (((hue + phase * 30) % 360) + 360) % 360 + " 70% 62%)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    });
  };

  KERNEL_FN.drift = function (p) {
    var gravity = num(p.gravity, 0.7, 0.2, 1.6);
    var gap = intn(p.gap, 78, 40, 120);
    var speed = num(p.speed, 1.1, 0.5, 2.5);
    var hue = num(p.hue, 160, 0, 360);
    var y = H / 2, vy = 0, x = W * 0.28;
    var gates = [];
    var dist = 0;
    function spawn(gx) {
      gates.push({ x: gx, cy: 30 + Math.random() * Math.max(1, H - 60) });
    }
    spawn(W);
    spawn(W * 1.5);
    loop(function (dt) {
      var push = input.dir && performance.now() - input.dirAt < 400;
      vy += gravity * 0.05 * (dt / 16);
      if (push || input.burst) { vy -= 0.22; input.burst = 0; }
      var taps = takeTaps();
      for (var k = 0; k < taps.length; k++) vy -= 0.6;
      y += vy;
      if (y < 8) { y = 8; vy = 0; }
      if (y > H - 8) { y = H - 8; vy = 0; }
      var spd = 1.6 * speed * (dt / 16);
      dist += spd;
      for (var g = 0; g < gates.length; g++) gates[g].x -= spd;
      if (gates[0] && gates[0].x < -20) { gates.shift(); spawn(gates[gates.length - 1].x + W * 0.55); }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      for (var j = 0; j < gates.length; j++) {
        ctx.strokeStyle = "hsl(" + hue + " 60% 55%)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(gates[j].x, 0);
        ctx.lineTo(gates[j].x, gates[j].cy - gap / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gates[j].x, gates[j].cy + gap / 2);
        ctx.lineTo(gates[j].x, H);
        ctx.stroke();
      }
      ctx.fillStyle = "hsl(" + (hue + 40) + " 80% 65%)";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 6.29);
      ctx.fill();
      ctx.fillStyle = "#5f6675";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(String(Math.floor(dist / 100)), 8, 16);
    });
  };

  KERNEL_FN.wave = function (p) {
    var bars = intn(p.bars, 40, 12, 90);
    var speed = num(p.speed, 1.2, 0.3, 3);
    var amp = num(p.amp, 0.6, 0.2, 1);
    var hue = num(p.hue, 195, 0, 360);
    var t = 0;
    loop(function () {
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      t += 0.03 * speed;
      var bw = W / bars;
      for (var i = 0; i < bars; i++) {
        var ph = i * 0.35;
        var v = (Math.sin(t + ph) + Math.sin(t * 0.6 + ph * 1.7)) * 0.5;
        var h = (0.5 + v * 0.5 * amp) * H;
        ctx.fillStyle = "hsl(" + (hue + i * 1.5) + " 70% " + (45 + v * 20) + "%)";
        ctx.fillRect(i * bw, H - h, bw - 1, h);
      }
    });
  };

  KERNEL_FN.fireworks = function (p) {
    var rate = num(p.rate, 1, 0.3, 3);
    var spread = intn(p.spread, 50, 20, 90);
    var gravity = num(p.gravity, 0.06, 0.02, 0.16);
    var hue = num(p.hue, 20, 0, 360);
    var shells = [];
    var sparks = [];
    var acc = 0;
    loop(function (dt) {
      acc += dt * rate;
      if (acc > 700) {
        acc = 0;
        shells.push({ x: Math.random() * W, y: H, vy: -(4 + Math.random() * 3), tgt: H * (0.15 + Math.random() * 0.3), hue: hue + Math.random() * 60 });
      }
      ctx.fillStyle = "rgba(5,7,10,0.28)";
      ctx.fillRect(0, 0, W, H);
      for (var i = shells.length - 1; i >= 0; i--) {
        var s = shells[i];
        s.y += s.vy;
        ctx.fillStyle = "hsl(" + s.hue + " 80% 70%)";
        ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
        if (s.y <= s.tgt) {
          shells.splice(i, 1);
          var n = spread;
          for (var k = 0; k < n; k++) {
            var a = (k / n) * 6.2832;
            var sp = 1 + Math.random() * 2;
            sparks.push({ x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue: s.hue });
          }
        }
      }
      for (var j = sparks.length - 1; j >= 0; j--) {
        var q = sparks[j];
        q.vy += gravity;
        q.x += q.vx;
        q.y += q.vy;
        q.life -= 0.012;
        if (q.life <= 0) { sparks.splice(j, 1); continue; }
        ctx.fillStyle = "hsl(" + q.hue + " 85% " + (40 + q.life * 40) + "%)";
        ctx.fillRect(q.x, q.y, 2, 2);
      }
    });
  };

  KERNEL_FN.tunnel = function (p) {
    var sides = intn(p.sides, 6, 3, 10);
    var speed = num(p.speed, 1.3, 0.3, 3);
    var twist = num(p.twist, 0.6, 0, 2);
    var hue = num(p.hue, 260, 0, 360);
    var z = 0;
    loop(function () {
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      z += 0.04 * speed;
      var cx = W / 2, cy = H / 2, maxR = Math.hypot(cx, cy);
      for (var ring = 8; ring >= 1; ring--) {
        var f = ((ring + z) % 8) / 8;
        var r = f * maxR;
        var rot = z * twist + ring * 0.4;
        ctx.strokeStyle = "hsl(" + (hue + ring * 10) + " 65% " + (20 + (1 - f) * 55) + "%)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var i = 0; i <= sides; i++) {
          var a = rot + (i / sides) * 6.2832;
          var x = cx + Math.cos(a) * r;
          var y = cy + Math.sin(a) * r;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    });
  };

  KERNEL_FN.pong = function (p) {
    var speed = num(p.speed, 1.2, 0.4, 3);
    var pad = intn(p.paddle, 40, 20, 70);
    var hue = num(p.hue, 90, 0, 360);
    var ball = { x: W / 2, y: H / 2, vx: 2.2 * speed, vy: 1.4 * speed };
    var l = H / 2, r = H / 2;
    loop(function () {
      ball.x += ball.vx;
      ball.y += ball.vy;
      if (ball.y < 4 || ball.y > H - 4) ball.vy *= -1;
      // paddles track the ball lazily
      l += (ball.y - l) * 0.08 * speed;
      r += (ball.y - r) * 0.08 * speed;
      if (ball.x < 16 && Math.abs(ball.y - l) < pad / 2) { ball.vx = Math.abs(ball.vx); ball.vy += (ball.y - l) * 0.05; }
      if (ball.x > W - 16 && Math.abs(ball.y - r) < pad / 2) { ball.vx = -Math.abs(ball.vx); ball.vy += (ball.y - r) * 0.05; }
      if (ball.x < -20 || ball.x > W + 20) { ball.x = W / 2; ball.y = H / 2; ball.vx = (Math.random() > 0.5 ? 1 : -1) * 2.2 * speed; ball.vy = (Math.random() - 0.5) * 3; }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "hsl(" + hue + " 60% 60%)";
      ctx.fillRect(8, l - pad / 2, 4, pad);
      ctx.fillRect(W - 12, r - pad / 2, 4, pad);
      ctx.fillStyle = "hsl(" + (hue + 40) + " 80% 65%)";
      ctx.fillRect(ball.x - 2, ball.y - 2, 4, 4);
    });
  };

  var running = false;
  function loop(fn) {
    if (running) return; // one kernel at a time
    running = true;
    repaint = null; // the loop repaints itself every frame
    var last = performance.now();
    var stopped = false;
    function tick(now) {
      if (stopped) return;
      var dt = Math.min(60, now - last);
      last = now;
      try {
        fn(dt);
      } catch (e) {
        stopped = true;
        msg("this game hit a snag", "#e0715c");
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // --- start ---
  try {
    if (!spec || !spec.kernel || typeof KERNEL_FN[spec.kernel] !== "function") {
      msg("no game here yet");
    } else {
      KERNEL_FN[spec.kernel](spec.params && typeof spec.params === "object" ? spec.params : {});
    }
  } catch (e) {
    msg("this game wouldn't start", "#e0715c");
  }
})();
