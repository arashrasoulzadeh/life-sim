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

  // --- visitor input: keys / pointer only nudge numbers, never run code ---
  var input = { dir: null, dirAt: 0, taps: [], burst: 0, px: -1, py: -1, down: false, downAt: 0, drag: [] };
  function toCanvas(e) {
    var r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / (r.width || W)) * W, y: ((e.clientY - r.top) / (r.height || H)) * H };
  }
  try {
    window.addEventListener("keydown", function (e) {
      var map = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
      var dd = map[e.key];
      if (dd) {
        input.dir = dd;
        input.dirAt = performance.now();
        e.preventDefault();
      }
      if (e.key === " " || e.key === "Enter") input.burst = 1;
    });
    canvas.addEventListener("pointerdown", function (e) {
      var p = toCanvas(e);
      input.taps.push(p);
      input.burst = 1;
      input.down = true;
      input.downAt = performance.now();
      input.px = p.x;
      input.py = p.y;
      input.drag = [p];
      if (input.taps.length > 12) input.taps.shift();
    });
    canvas.addEventListener("pointermove", function (e) {
      var p = toCanvas(e);
      input.px = p.x;
      input.py = p.y;
      if (input.down) {
        input.drag.push(p);
        if (input.drag.length > 240) input.drag.shift();
      }
    });
    var up = function () { input.down = false; };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", up);
  } catch (e) {}
  function takeDrag() {
    var d = input.drag;
    input.drag = input.down && d.length ? [d[d.length - 1]] : [];
    return d;
  }
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

  KERNEL_FN.paint = function (p) {
    var size = num(p.size, 4, 1, 12);
    var fade = num(p.fade, 0.04, 0.01, 0.2);
    var hue = num(p.hue, 300, 0, 360);
    var rainbow = p.rainbow !== false;
    var h = hue;
    loop(function () {
      ctx.fillStyle = "rgba(5,7,10," + fade + ")";
      ctx.fillRect(0, 0, W, H);
      var d = takeDrag();
      if (input.down && d.length < 2 && input.px >= 0) d = [{ x: input.px, y: input.py }];
      for (var i = 0; i < d.length; i++) {
        h = rainbow ? (h + 2) % 360 : hue;
        ctx.fillStyle = "hsl(" + h + " 85% 62%)";
        ctx.beginPath();
        ctx.arc(d[i].x, d[i].y, size, 0, 6.29);
        ctx.fill();
      }
      if (!input.down && input.px < 0) {
        ctx.fillStyle = "#5f6675";
        ctx.font = "11px ui-monospace, monospace";
        ctx.fillText("drag to paint", 12, 20);
      }
    });
  };

  KERNEL_FN.breakout = function (p) {
    var rows = intn(p.rows, 5, 2, 8);
    var speed = num(p.speed, 1.2, 0.5, 3);
    var padW = intn(p.paddle, 42, 20, 70);
    var hue = num(p.hue, 200, 0, 360);
    var cols = 8;
    var bricks = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) bricks.push({ c: c, r: r, on: true });
    var px = W / 2;
    var ball = { x: W / 2, y: H * 0.6, vx: 2 * speed, vy: -2.4 * speed };
    loop(function () {
      px += ((input.px >= 0 ? input.px : W / 2) - px) * 0.25;
      ball.x += ball.vx;
      ball.y += ball.vy;
      if (ball.x < 4 || ball.x > W - 4) ball.vx *= -1;
      if (ball.y < 4) ball.vy *= -1;
      var bw = W / cols, bh = (H * 0.35) / rows;
      for (var i = 0; i < bricks.length; i++) {
        var b = bricks[i];
        if (!b.on) continue;
        var bx = b.c * bw, by = 20 + b.r * bh;
        if (ball.x > bx && ball.x < bx + bw && ball.y > by && ball.y < by + bh) {
          b.on = false;
          ball.vy *= -1;
        }
      }
      var pyv = H - 16;
      if (ball.y > pyv - 4 && ball.y < pyv + 6 && Math.abs(ball.x - px) < padW / 2 && ball.vy > 0) {
        ball.vy = -Math.abs(ball.vy);
        ball.vx += (ball.x - px) * 0.08;
      }
      if (ball.y > H + 10) { ball.x = W / 2; ball.y = H * 0.6; ball.vx = 2 * speed; ball.vy = -2.4 * speed; }
      if (!bricks.some(function (x) { return x.on; })) for (var k = 0; k < bricks.length; k++) bricks[k].on = true;
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      for (var j = 0; j < bricks.length; j++) {
        if (!bricks[j].on) continue;
        ctx.fillStyle = "hsl(" + (hue + bricks[j].r * 18) + " 65% 58%)";
        ctx.fillRect(bricks[j].c * bw + 1, 20 + bricks[j].r * bh + 1, bw - 2, bh - 2);
      }
      ctx.fillStyle = "hsl(" + hue + " 60% 65%)";
      ctx.fillRect(px - padW / 2, pyv, padW, 4);
      ctx.fillStyle = "hsl(" + (hue + 40) + " 85% 68%)";
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 3.5, 0, 6.29);
      ctx.fill();
    });
  };

  KERNEL_FN.catch = function (p) {
    var rate = num(p.rate, 1, 0.3, 3);
    var speed = num(p.speed, 1, 0.4, 2.5);
    var bw = intn(p.basket, 28, 14, 50);
    var hue = num(p.hue, 40, 0, 360);
    var drops = [];
    var bx = W / 2, score = 0, acc = 0;
    loop(function (dt) {
      bx += ((input.px >= 0 ? input.px : W / 2) - bx) * 0.3;
      acc += dt * rate;
      if (acc > 600) { acc = 0; drops.push({ x: 10 + Math.random() * (W - 20), y: -6, v: (1 + Math.random()) * speed }); }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      var by = H - 12;
      for (var i = drops.length - 1; i >= 0; i--) {
        var d = drops[i];
        d.y += d.v;
        if (d.y > by - 2 && d.y < by + 6 && Math.abs(d.x - bx) < bw / 2) { drops.splice(i, 1); score++; continue; }
        if (d.y > H + 10) { drops.splice(i, 1); score = Math.max(0, score - 1); continue; }
        ctx.fillStyle = "hsl(" + (hue + 180) + " 70% 62%)";
        ctx.beginPath();
        ctx.arc(d.x, d.y, 3, 0, 6.29);
        ctx.fill();
      }
      ctx.strokeStyle = "hsl(" + hue + " 60% 60%)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(bx - bw / 2, by);
      ctx.lineTo(bx - bw / 2 + 4, by + 8);
      ctx.lineTo(bx + bw / 2 - 4, by + 8);
      ctx.lineTo(bx + bw / 2, by);
      ctx.stroke();
      ctx.fillStyle = "#5f6675";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(String(score), 8, 14);
    });
  };

  KERNEL_FN.gravitywell = function (p) {
    var count = intn(p.count, 120, 30, 300);
    var pull = num(p.pull, 1, 0.2, 2.5);
    var hue = num(p.hue, 260, 0, 360);
    var trail = p.trail !== false;
    var ps = [];
    for (var i = 0; i < count; i++) ps.push({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0 });
    loop(function () {
      ctx.fillStyle = trail ? "rgba(5,7,10,0.2)" : "#05070a";
      ctx.fillRect(0, 0, W, H);
      var tx = input.px >= 0 ? input.px : W / 2;
      var ty = input.py >= 0 ? input.py : H / 2;
      for (var j = 0; j < ps.length; j++) {
        var o = ps[j];
        var dx = tx - o.x, dy = ty - o.y, d = Math.max(8, Math.hypot(dx, dy));
        o.vx += (dx / d) * pull * 0.35;
        o.vy += (dy / d) * pull * 0.35;
        o.vx *= 0.96;
        o.vy *= 0.96;
        o.x += o.vx;
        o.y += o.vy;
        if (o.x < 0 || o.x > W) o.vx *= -0.6;
        if (o.y < 0 || o.y > H) o.vy *= -0.6;
        ctx.fillStyle = "hsl(" + (hue + Math.hypot(o.vx, o.vy) * 8) + " 70% 62%)";
        ctx.fillRect(o.x - 1, o.y - 1, 2, 2);
      }
    });
  };

  KERNEL_FN.fractaltree = function (p) {
    var depth = intn(p.depth, 9, 5, 11);
    var ang = num(p.angle, 24, 8, 40) * (Math.PI / 180);
    var sway = num(p.sway, 0.8, 0, 2);
    var hue = num(p.hue, 130, 0, 360);
    var seedv = Math.random();
    var t = 0;
    function branch(x, y, a, len, d) {
      if (d <= 0 || len < 1) return;
      var w = t * 0.02 * sway + Math.sin(seedv * 9 + d) * 0.02 * sway;
      var nx = x + Math.cos(a + w) * len;
      var ny = y + Math.sin(a + w) * len;
      ctx.strokeStyle = "hsl(" + (hue + (depth - d) * 12) + " 55% " + (30 + (depth - d) * 5) + "%)";
      ctx.lineWidth = Math.max(0.5, d * 0.5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      branch(nx, ny, a - ang, len * 0.72, d - 1);
      branch(nx, ny, a + ang, len * 0.72, d - 1);
    }
    loop(function () {
      for (var k = 0; k < takeTaps().length; k++) seedv = Math.random();
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      t += 1;
      branch(W / 2, H - 4, -Math.PI / 2, Math.min(W, H) * 0.22, depth);
    });
  };

  KERNEL_FN.pendulum = function (p) {
    var damp = 1 - num(p.damp, 0.002, 0, 0.02);
    var speed = num(p.speed, 1, 0.3, 2.5);
    var hue = num(p.hue, 300, 0, 360);
    var trail = p.trail !== false;
    var a1 = 2, a2 = 2, v1 = 0, v2 = 0;
    var L = Math.min(W, H) * 0.22, m = 1, g = 0.5 * speed;
    loop(function () {
      ctx.fillStyle = trail ? "rgba(5,7,10,0.06)" : "#05070a";
      ctx.fillRect(0, 0, W, H);
      for (var s = 0; s < 3; s++) {
        var num1 = -g * (2 * m + m) * Math.sin(a1) - m * g * Math.sin(a1 - 2 * a2) - 2 * Math.sin(a1 - a2) * m * (v2 * v2 * L + v1 * v1 * L * Math.cos(a1 - a2));
        var den = L * (2 * m + m - m * Math.cos(2 * a1 - 2 * a2));
        var ac1 = num1 / (den || 1);
        var num2 = 2 * Math.sin(a1 - a2) * (v1 * v1 * L * (2 * m) + g * (2 * m) * Math.cos(a1) + v2 * v2 * L * m * Math.cos(a1 - a2));
        var ac2 = num2 / (L * (2 * m - m * Math.cos(2 * a1 - 2 * a2)) || 1);
        v1 = (v1 + ac1) * damp;
        v2 = (v2 + ac2) * damp;
        a1 += v1 * 0.04;
        a2 += v2 * 0.04;
      }
      var ox = W / 2, oy = H * 0.35;
      var x1 = ox + L * Math.sin(a1), y1 = oy + L * Math.cos(a1);
      var x2 = x1 + L * Math.sin(a2), y2 = y1 + L * Math.cos(a2);
      ctx.strokeStyle = "hsl(" + hue + " 30% 45%)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.fillStyle = "hsl(" + ((hue + performance.now() * 0.02) % 360) + " 80% 65%)";
      ctx.beginPath();
      ctx.arc(x2, y2, 3, 0, 6.29);
      ctx.fill();
    });
  };

  KERNEL_FN.ripple = function (p) {
    var decay = num(p.decay, 0.02, 0.005, 0.05);
    var speed = num(p.speed, 1.6, 0.5, 4);
    var hue = num(p.hue, 190, 0, 360);
    var rings = [];
    loop(function () {
      var taps = takeTaps();
      for (var k = 0; k < taps.length; k++) rings.push({ x: taps[k].x, y: taps[k].y, r: 0, a: 1 });
      if (input.down && input.px >= 0 && rings.length < 40 && Math.random() < 0.3) rings.push({ x: input.px, y: input.py, r: 0, a: 1 });
      if (!rings.length && Math.random() < 0.02) rings.push({ x: Math.random() * W, y: Math.random() * H, r: 0, a: 1 });
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      for (var i = rings.length - 1; i >= 0; i--) {
        var rg = rings[i];
        rg.r += speed;
        rg.a -= decay;
        if (rg.a <= 0) { rings.splice(i, 1); continue; }
        ctx.strokeStyle = "hsl(" + hue + " 70% 60% / " + rg.a.toFixed(2) + ")";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(rg.x, rg.y, rg.r, 0, 6.29);
        ctx.stroke();
      }
    });
  };

  KERNEL_FN.matrix = function (p) {
    var density = num(p.density, 0.7, 0.3, 1);
    var speed = num(p.speed, 1.2, 0.4, 3);
    var glyphs = typeof p.glyph === "string" && p.glyph.length ? p.glyph : "01";
    var hue = num(p.hue, 130, 0, 360);
    var cols = Math.max(8, Math.floor(W / 10));
    var y = [];
    for (var i = 0; i < cols; i++) y.push(Math.random() * -H);
    loop(function () {
      ctx.fillStyle = "rgba(5,7,10,0.15)";
      ctx.fillRect(0, 0, W, H);
      ctx.font = "10px ui-monospace, monospace";
      var step = W / cols;
      for (var j = 0; j < cols; j++) {
        y[j] += (2 + density * 5) * speed;
        if (y[j] > H && Math.random() < 0.06) y[j] = Math.random() * -40;
        var g = glyphs[(Math.random() * glyphs.length) | 0];
        ctx.fillStyle = "hsl(" + hue + " 80% 85%)";
        ctx.fillText(g, j * step, y[j]);
        ctx.fillStyle = "hsl(" + hue + " 70% 45%)";
        ctx.fillText(glyphs[(Math.random() * glyphs.length) | 0], j * step, y[j] - 12);
      }
    });
  };

  KERNEL_FN.plasma = function (p) {
    var scale = num(p.scale, 1.6, 0.5, 4) * 0.04;
    var speed = num(p.speed, 1, 0.2, 3);
    var hue = num(p.hue, 280, 0, 360);
    var t = 0;
    var step = 4;
    loop(function () {
      t += 0.03 * speed;
      for (var y = 0; y < H; y += step) {
        for (var x = 0; x < W; x += step) {
          var v = Math.sin(x * scale + t) + Math.sin(y * scale * 1.3 - t) + Math.sin((x + y) * scale * 0.7 + t * 0.6);
          ctx.fillStyle = "hsl(" + ((hue + v * 60) % 360) + " 65% " + (45 + v * 12) + "%)";
          ctx.fillRect(x, y, step, step);
        }
      }
    });
  };

  KERNEL_FN.metaballs = function (p) {
    var count = intn(p.count, 6, 3, 12);
    var speed = num(p.speed, 1, 0.3, 2.5);
    var hue = num(p.hue, 200, 0, 360);
    var b = [];
    for (var i = 0; i < count; i++) b.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 2 * speed, vy: (Math.random() - 0.5) * 2 * speed, r: 12 + Math.random() * 16 });
    var step = 5;
    loop(function () {
      var d = takeDrag();
      for (var k = 0; k < b.length; k++) {
        var o = b[k];
        o.x += o.vx; o.y += o.vy;
        if (o.x < 0 || o.x > W) o.vx *= -1;
        if (o.y < 0 || o.y > H) o.vy *= -1;
        for (var m = 0; m < d.length; m++) {
          var dx = o.x - d[m].x, dy = o.y - d[m].y, dd = dx * dx + dy * dy;
          if (dd < 3000 && dd > 1) { o.vx += (dx / dd) * 40; o.vy += (dy / dd) * 40; }
        }
        o.vx = Math.max(-4, Math.min(4, o.vx));
        o.vy = Math.max(-4, Math.min(4, o.vy));
      }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      for (var y = 0; y < H; y += step) for (var x = 0; x < W; x += step) {
        var sum = 0;
        for (var i2 = 0; i2 < b.length; i2++) { var ddx = x - b[i2].x, ddy = y - b[i2].y; sum += (b[i2].r * b[i2].r) / (ddx * ddx + ddy * ddy + 1); }
        if (sum > 0.9) { ctx.fillStyle = "hsl(" + (hue + sum * 20) + " 70% " + Math.min(70, 40 + sum * 12) + "%)"; ctx.fillRect(x, y, step, step); }
      }
    });
  };

  KERNEL_FN.sand = function (p) {
    var cell = intn(p.cell, 3, 2, 6);
    var hue = num(p.hue, 40, 0, 360);
    var spread = num(p.spread, 0.6, 0, 1);
    var gw = Math.max(20, Math.floor(W / cell));
    var gh = Math.max(20, Math.floor(H / cell));
    var grid = new Uint8Array(gw * gh);
    loop(function () {
      var d = input.down ? [{ x: input.px, y: input.py }] : takeTaps();
      for (var k = 0; k < d.length; k++) {
        var cx = Math.floor(d[k].x / cell), cy = Math.floor(d[k].y / cell);
        for (var s = -1; s <= 1; s++) { var i = (cy) * gw + (cx + s); if (i >= 0 && i < grid.length) grid[i] = 1 + ((Math.random() * 5) | 0); }
      }
      for (var y = gh - 2; y >= 0; y--) for (var x = 0; x < gw; x++) {
        var idx = y * gw + x;
        if (!grid[idx]) continue;
        var below = idx + gw;
        if (!grid[below]) { grid[below] = grid[idx]; grid[idx] = 0; continue; }
        var dir = Math.random() < 0.5 ? -1 : 1;
        if (Math.random() < spread) {
          var diag = below + dir;
          if (x + dir >= 0 && x + dir < gw && !grid[diag]) { grid[diag] = grid[idx]; grid[idx] = 0; }
        }
      }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      for (var yy = 0; yy < gh; yy++) for (var xx = 0; xx < gw; xx++) {
        var g = grid[yy * gw + xx];
        if (!g) continue;
        ctx.fillStyle = "hsl(" + (hue + g * 6) + " 65% " + (48 + g * 4) + "%)";
        ctx.fillRect(xx * cell, yy * cell, cell, cell);
      }
    });
  };

  KERNEL_FN.lightning = function (p) {
    var rate = num(p.rate, 1, 0.3, 3);
    var forks = intn(p.forks, 3, 1, 6);
    var hue = num(p.hue, 210, 0, 360);
    var acc = 0;
    var bolt = null;
    var targetX = W / 2;
    function makeBolt(tx) {
      var segs = [{ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: 0 }];
      for (var i = 1; i < 18; i++) {
        var prev = segs[i - 1];
        var goal = prev.x + (tx - prev.x) * (i / 18);
        segs.push({ x: goal + (Math.random() - 0.5) * 24, y: (i / 18) * H });
      }
      var branches = [];
      for (var f = 0; f < forks; f++) {
        var start = segs[3 + ((Math.random() * 10) | 0)];
        var br = [start];
        for (var j = 1; j < 6; j++) br.push({ x: br[j - 1].x + (Math.random() - 0.5) * 40, y: br[j - 1].y + 12 });
        branches.push(br);
      }
      return { segs: segs, branches: branches, life: 1 };
    }
    loop(function (dt) {
      for (var k = 0; k < takeTaps().length; k++) targetX = input.taps.length ? input.px : Math.random() * W;
      acc += dt * rate;
      if (acc > 700 || !bolt) { acc = 0; bolt = makeBolt(input.px >= 0 ? input.px : Math.random() * W); }
      bolt.life -= 0.06;
      ctx.fillStyle = "rgba(5,7,10,0.4)";
      ctx.fillRect(0, 0, W, H);
      if (bolt.life <= 0) return;
      ctx.strokeStyle = "hsl(" + hue + " 80% " + (60 + bolt.life * 30) + "% / " + bolt.life.toFixed(2) + ")";
      ctx.lineWidth = 1.5;
      function draw(pts) { ctx.beginPath(); for (var i = 0; i < pts.length; i++) i ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y); ctx.stroke(); }
      draw(bolt.segs);
      for (var b = 0; b < bolt.branches.length; b++) draw(bolt.branches[b]);
    });
  };

  KERNEL_FN.kaleido = function (p) {
    var slices = intn(p.slices, 6, 3, 12);
    var fade = num(p.fade, 0.05, 0.01, 0.15);
    var hue = num(p.hue, 320, 0, 360);
    var h = hue;
    loop(function () {
      ctx.fillStyle = "rgba(5,7,10," + fade + ")";
      ctx.fillRect(0, 0, W, H);
      var d = takeDrag();
      if (input.down && input.px >= 0) d.push({ x: input.px, y: input.py });
      if (!d.length && Math.random() < 0.2) d.push({ x: W / 2 + Math.sin(performance.now() / 500) * W * 0.3, y: H / 2 + Math.cos(performance.now() / 400) * H * 0.3 });
      var cx = W / 2, cy = H / 2;
      for (var m = 0; m < d.length; m++) {
        h = (h + 3) % 360;
        var rx = d[m].x - cx, ry = d[m].y - cy;
        for (var s = 0; s < slices; s++) {
          var a = (s / slices) * 6.2832;
          var ca = Math.cos(a), sa = Math.sin(a);
          ctx.fillStyle = "hsl(" + h + " 80% 62%)";
          ctx.beginPath();
          ctx.arc(cx + rx * ca - ry * sa, cy + rx * sa + ry * ca, 3, 0, 6.29);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx + rx * ca + ry * sa, cy - rx * sa + ry * ca, 3, 0, 6.29);
          ctx.fill();
        }
      }
    });
  };

  KERNEL_FN.swarm = function (p) {
    var count = intn(p.count, 80, 20, 200);
    var speed = num(p.speed, 1.3, 0.4, 3);
    var hue = num(p.hue, 20, 0, 360);
    var b = [];
    for (var i = 0; i < count; i++) b.push({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0 });
    loop(function () {
      ctx.fillStyle = "rgba(5,7,10,0.25)";
      ctx.fillRect(0, 0, W, H);
      var tx = input.px >= 0 ? input.px : W / 2 + Math.sin(performance.now() / 900) * W * 0.3;
      var ty = input.py >= 0 ? input.py : H / 2 + Math.cos(performance.now() / 700) * H * 0.3;
      for (var j = 0; j < b.length; j++) {
        var o = b[j];
        var dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy) || 1;
        o.vx += (dx / d) * 0.3 * speed;
        o.vy += (dy / d) * 0.3 * speed;
        for (var q = j + 1; q < Math.min(b.length, j + 12); q++) {
          var ox = o.x - b[q].x, oy = o.y - b[q].y, od = ox * ox + oy * oy;
          if (od < 200 && od > 1) { o.vx += ox / od * 8; o.vy += oy / od * 8; }
        }
        o.vx *= 0.9; o.vy *= 0.9;
        o.x += o.vx; o.y += o.vy;
        ctx.fillStyle = "hsl(" + (hue + Math.hypot(o.vx, o.vy) * 10) + " 75% 60%)";
        ctx.fillRect(o.x - 1, o.y - 1, 2.5, 2.5);
      }
    });
  };

  KERNEL_FN.constellation = function (p) {
    var count = intn(p.count, 45, 10, 90);
    var reach = intn(p.reach, 22, 10, 40);
    var speed = num(p.speed, 0.7, 0.2, 2);
    var hue = num(p.hue, 210, 0, 360);
    var s = [];
    for (var i = 0; i < count; i++) s.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * speed, vy: (Math.random() - 0.5) * speed });
    var R = (reach / 100) * Math.min(W, H);
    loop(function () {
      for (var k = 0; k < takeTaps().length; k++) if (s.length < 140) s.push({ x: input.px, y: input.py, vx: (Math.random() - 0.5) * speed, vy: (Math.random() - 0.5) * speed });
      ctx.fillStyle = "#04060c";
      ctx.fillRect(0, 0, W, H);
      for (var j = 0; j < s.length; j++) {
        var o = s[j];
        o.x = (o.x + o.vx + W) % W;
        o.y = (o.y + o.vy + H) % H;
        for (var q = j + 1; q < s.length; q++) {
          var dx = o.x - s[q].x, dy = o.y - s[q].y, d = Math.hypot(dx, dy);
          if (d < R) {
            ctx.strokeStyle = "hsl(" + hue + " 60% 60% / " + (1 - d / R).toFixed(2) + ")";
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(o.x, o.y);
            ctx.lineTo(s[q].x, s[q].y);
            ctx.stroke();
          }
        }
        ctx.fillStyle = "hsl(" + hue + " 70% 75%)";
        ctx.fillRect(o.x - 1, o.y - 1, 2, 2);
      }
    });
  };

  KERNEL_FN.bubbles = function (p) {
    var rate = num(p.rate, 1, 0.3, 3);
    var speed = num(p.speed, 1, 0.3, 2.5);
    var hue = num(p.hue, 190, 0, 360);
    var b = [];
    var acc = 0;
    loop(function (dt) {
      acc += dt * rate;
      if (acc > 260) { acc = 0; b.push({ x: 10 + Math.random() * (W - 20), y: H + 10, r: 4 + Math.random() * 12, ph: Math.random() * 6 }); }
      var taps = takeTaps();
      for (var k = 0; k < taps.length; k++) {
        for (var i = b.length - 1; i >= 0; i--) {
          if (Math.hypot(b[i].x - taps[k].x, b[i].y - taps[k].y) < b[i].r + 8) b.splice(i, 1);
        }
      }
      ctx.fillStyle = "rgba(5,7,10,0.35)";
      ctx.fillRect(0, 0, W, H);
      for (var j = b.length - 1; j >= 0; j--) {
        var o = b[j];
        o.y -= (0.6 + o.r * 0.03) * speed;
        o.x += Math.sin(performance.now() / 400 + o.ph) * 0.6;
        if (o.y < -20) { b.splice(j, 1); continue; }
        ctx.strokeStyle = "hsl(" + hue + " 70% 65% / 0.85)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, 6.29);
        ctx.stroke();
      }
    });
  };

  KERNEL_FN.fireflies = function (p) {
    var count = intn(p.count, 50, 15, 120);
    var speed = num(p.speed, 0.8, 0.2, 2);
    var sync = num(p.sync, 0.4, 0, 1);
    var hue = num(p.hue, 70, 0, 360);
    var f = [];
    for (var i = 0; i < count; i++) f.push({ x: Math.random() * W, y: Math.random() * H, ph: Math.random() * 6.28, vx: (Math.random() - 0.5) * speed, vy: (Math.random() - 0.5) * speed });
    loop(function () {
      ctx.fillStyle = "rgba(4,5,9,0.4)";
      ctx.fillRect(0, 0, W, H);
      for (var j = 0; j < f.length; j++) {
        var o = f[j];
        o.x = (o.x + o.vx + W) % W;
        o.y = (o.y + o.vy + H) % H;
        o.ph += 0.06;
        var near = 0, sum = 0;
        for (var q = 0; q < f.length; q++) {
          if (q === j) continue;
          if (Math.hypot(o.x - f[q].x, o.y - f[q].y) < 40) { near++; sum += Math.sin(f[q].ph - o.ph); }
        }
        if (near) o.ph += (sum / near) * 0.1 * sync;
        var b = Math.max(0, Math.sin(o.ph));
        if (b > 0.1) {
          ctx.fillStyle = "hsl(" + hue + " 90% " + (40 + b * 45) + "% / " + b.toFixed(2) + ")";
          ctx.beginPath();
          ctx.arc(o.x, o.y, 1.5 + b * 2, 0, 6.29);
          ctx.fill();
        }
      }
    });
  };

  KERNEL_FN.rope = function (p) {
    var links = intn(p.links, 16, 8, 30);
    var grav = num(p.gravity, 0.4, 0.1, 1);
    var hue = num(p.hue, 30, 0, 360);
    var pts = [];
    var seg = (Math.min(W, H) * 0.7) / links;
    for (var i = 0; i < links; i++) pts.push({ x: W / 2, y: 8 + i * seg, px: W / 2, py: 8 + i * seg });
    loop(function () {
      var anchor = { x: input.px >= 0 ? input.px : W / 2, y: input.py >= 0 && input.down ? input.py : 8 };
      pts[0].x = anchor.x; pts[0].y = anchor.y; pts[0].px = anchor.x; pts[0].py = anchor.y;
      for (var i = 1; i < pts.length; i++) {
        var o = pts[i];
        var vx = (o.x - o.px) * 0.98, vy = (o.y - o.py) * 0.98;
        o.px = o.x; o.py = o.y;
        o.x += vx; o.y += vy + grav;
      }
      for (var it = 0; it < 6; it++) {
        for (var k = 1; k < pts.length; k++) {
          var a = pts[k - 1], c = pts[k];
          var dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 1;
          var diff = (d - seg) / d / 2;
          if (k > 1) { a.x += dx * diff; a.y += dy * diff; }
          c.x -= dx * diff; c.y -= dy * diff;
        }
      }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "hsl(" + hue + " 55% 55%)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (var m = 0; m < pts.length; m++) m ? ctx.lineTo(pts[m].x, pts[m].y) : ctx.moveTo(pts[m].x, pts[m].y);
      ctx.stroke();
      ctx.fillStyle = "hsl(" + (hue + 40) + " 80% 65%)";
      ctx.beginPath();
      ctx.arc(pts[pts.length - 1].x, pts[pts.length - 1].y, 4, 0, 6.29);
      ctx.fill();
    });
  };

  KERNEL_FN.maze = function (p) {
    var cell = intn(p.cell, 10, 6, 20);
    var speed = num(p.speed, 1.3, 0.4, 3);
    var hue = num(p.hue, 160, 0, 360);
    var cols, rows, walls, phase, stack, visited, cur, solver, path;
    function reset() {
      cols = Math.max(5, Math.floor(W / cell));
      rows = Math.max(5, Math.floor(H / cell));
      walls = new Uint8Array(cols * rows).fill(15); // NESW bits
      visited = new Uint8Array(cols * rows);
      stack = [0];
      visited[0] = 1;
      cur = 0;
      phase = "gen";
      solver = null;
      path = [];
    }
    reset();
    function nbrs(c) {
      var cx = c % cols, cy = (c / cols) | 0;
      var o = [];
      if (cy > 0) o.push([c - cols, 1, 4]);
      if (cx < cols - 1) o.push([c + 1, 2, 8]);
      if (cy < rows - 1) o.push([c + cols, 4, 1]);
      if (cx > 0) o.push([c - 1, 8, 2]);
      return o;
    }
    loop(function (dt) {
      var iters = Math.ceil(speed * (dt / 16) * 2);
      for (var it = 0; it < iters; it++) {
        if (phase === "gen") {
          var opts = nbrs(cur).filter(function (o) { return !visited[o[0]]; });
          if (opts.length) {
            var pick = opts[(Math.random() * opts.length) | 0];
            walls[cur] &= ~pick[1];
            walls[pick[0]] &= ~pick[2];
            visited[pick[0]] = 1;
            stack.push(pick[0]);
            cur = pick[0];
          } else if (stack.length) {
            cur = stack.pop();
          } else {
            phase = "solve";
            solver = { at: 0, came: new Int32Array(cols * rows).fill(-1), seen: new Uint8Array(cols * rows), q: [0] };
            solver.seen[0] = 1;
          }
        } else if (phase === "solve") {
          if (!solver.q.length) { reset(); break; }
          var n0 = solver.q.shift();
          if (n0 === cols * rows - 1) {
            var t = n0;
            path = [];
            while (t >= 0) { path.push(t); t = solver.came[t]; }
            phase = "walk";
            solver.i = path.length - 1;
            break;
          }
          var open = nbrs(n0).filter(function (o) { return !(walls[n0] & o[1]) && !solver.seen[o[0]]; });
          for (var k = 0; k < open.length; k++) { solver.seen[open[k][0]] = 1; solver.came[open[k][0]] = n0; solver.q.push(open[k][0]); }
        } else {
          solver.i -= 1;
          if (solver.i < 0) { setTimeout(reset, 400); phase = "done"; break; }
        }
      }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "hsl(" + hue + " 45% 45%)";
      ctx.lineWidth = 1;
      for (var c = 0; c < cols * rows; c++) {
        var cx = (c % cols) * cell, cy = ((c / cols) | 0) * cell;
        if (walls[c] & 1) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + cell, cy); ctx.stroke(); }
        if (walls[c] & 2) { ctx.beginPath(); ctx.moveTo(cx + cell, cy); ctx.lineTo(cx + cell, cy + cell); ctx.stroke(); }
        if (walls[c] & 4) { ctx.beginPath(); ctx.moveTo(cx, cy + cell); ctx.lineTo(cx + cell, cy + cell); ctx.stroke(); }
        if (walls[c] & 8) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + cell); ctx.stroke(); }
      }
      if ((phase === "walk" || phase === "done") && path.length) {
        ctx.strokeStyle = "hsl(" + (hue + 40) + " 80% 62%)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        var upto = phase === "done" ? 0 : Math.max(0, solver.i);
        for (var m = path.length - 1; m >= upto; m--) {
          var pc = path[m];
          var px = (pc % cols) * cell + cell / 2, py = ((pc / cols) | 0) * cell + cell / 2;
          m === path.length - 1 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    });
  };

  KERNEL_FN.whack = function (p) {
    var grid = intn(p.grid, 3, 2, 5);
    var rate = num(p.rate, 1, 0.4, 2.5);
    var upTime = num(p.up, 0.9, 0.4, 2) * 1000;
    var hue = num(p.hue, 130, 0, 360);
    var cells = [];
    for (var i = 0; i < grid * grid; i++) cells.push({ up: false, t: 0 });
    var score = 0, acc = 0;
    loop(function (dt) {
      acc += dt;
      var interval = 1400 / rate;
      if (acc > interval) {
        acc = 0;
        var idle = [];
        for (var k = 0; k < cells.length; k++) if (!cells[k].up) idle.push(k);
        if (idle.length) {
          var pick = idle[(Math.random() * idle.length) | 0];
          cells[pick].up = true;
          cells[pick].t = upTime;
        }
      }
      var cw = W / grid, ch = H / grid;
      var taps = takeTaps();
      for (var ti = 0; ti < taps.length; ti++) {
        var tc = Math.floor(taps[ti].x / cw), tr = Math.floor(taps[ti].y / ch);
        var idx = tr * grid + tc;
        if (cells[idx] && cells[idx].up) { cells[idx].up = false; cells[idx].t = 0; score++; }
      }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      for (var c = 0; c < cells.length; c++) {
        var cx = c % grid, cy = (c / grid) | 0;
        var x = cx * cw, y = cy * ch;
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.strokeRect(x + 2, y + 2, cw - 4, ch - 4);
        if (cells[c].up) {
          cells[c].t -= dt;
          if (cells[c].t <= 0) cells[c].up = false;
          var r = Math.min(cw, ch) * 0.3;
          ctx.fillStyle = "hsl(" + hue + " 65% 58%)";
          ctx.beginPath();
          ctx.arc(x + cw / 2, y + ch / 2, r, 0, 6.29);
          ctx.fill();
        }
      }
      ctx.fillStyle = "#5f6675";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText("score " + score, 8, 14);
    });
  };

  KERNEL_FN.runner = function (p) {
    var speed = num(p.speed, 1.4, 0.6, 3);
    var gap = num(p.gap, 1, 0.6, 2);
    var hue = num(p.hue, 20, 0, 360);
    var groundY, px, py, vy, onGround, obstacles, spawnAcc, score, dead, deadT;
    function reset() {
      groundY = H - 20;
      px = W * 0.22;
      py = groundY;
      vy = 0;
      onGround = true;
      obstacles = [];
      spawnAcc = 0;
      score = 0;
      dead = false;
      deadT = 0;
    }
    reset();
    loop(function (dt) {
      var taps = takeTaps();
      var wantJump = taps.length > 0 || input.burst;
      input.burst = 0;
      if (dead) {
        deadT += dt;
        if (wantJump || deadT > 1200) reset();
      } else {
        if (wantJump && onGround) { vy = -6.6; onGround = false; }
        vy += 0.32 * (dt / 16);
        py += vy * (dt / 16);
        if (py >= groundY) { py = groundY; vy = 0; onGround = true; }
        spawnAcc += dt;
        var interval = 1300 / (speed * gap);
        if (spawnAcc > interval) { spawnAcc = 0; obstacles.push({ x: W + 10, h: 14 + Math.random() * 16 }); }
        for (var i = obstacles.length - 1; i >= 0; i--) {
          obstacles[i].x -= speed * (dt / 16) * 3.2;
          if (obstacles[i].x < -10) { obstacles.splice(i, 1); score++; continue; }
          var ox = obstacles[i].x, oh = obstacles[i].h;
          if (Math.abs(ox - px) < 9 && py > groundY - oh + 6) { dead = true; deadT = 0; }
        }
      }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.moveTo(0, groundY + 8);
      ctx.lineTo(W, groundY + 8);
      ctx.stroke();
      ctx.fillStyle = dead ? "#e06a5c" : "hsl(" + hue + " 70% 60%)";
      ctx.fillRect(px - 6, py - 12, 12, 12);
      ctx.fillStyle = "hsl(" + (hue + 30) + " 55% 45%)";
      for (var j = 0; j < obstacles.length; j++) {
        ctx.fillRect(obstacles[j].x - 4, groundY + 8 - obstacles[j].h, 8, obstacles[j].h);
      }
      ctx.fillStyle = "#5f6675";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(dead ? "score " + score + " — tap to try again" : "score " + score, 8, 14);
    });
  };

  KERNEL_FN.match = function (p) {
    var pairs = intn(p.pairs, 6, 3, 10);
    var hue = num(p.hue, 260, 0, 360);
    var hue2 = num(p.hue2, 40, 0, 360);
    var cols, rows, tiles, flipped, busy, busyT, score;
    function shuffle(arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = (Math.random() * (i + 1)) | 0;
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }
    function reset() {
      var n = pairs * 2;
      cols = Math.ceil(Math.sqrt(n * (W / H)));
      cols = Math.max(2, Math.min(n, cols));
      rows = Math.ceil(n / cols);
      var ids = [];
      for (var i = 0; i < pairs; i++) { ids.push(i); ids.push(i); }
      shuffle(ids);
      tiles = ids.slice(0, cols * rows).map(function (id) { return { id: id, up: false, matched: false }; });
      flipped = [];
      busy = false;
      busyT = 0;
      score = 0;
    }
    reset();
    loop(function (dt) {
      var cw = W / cols, ch = H / rows;
      if (busy) {
        busyT -= dt;
        if (busyT <= 0) {
          busy = false;
          for (var f = 0; f < flipped.length; f++) if (!tiles[flipped[f]].matched) tiles[flipped[f]].up = false;
          flipped = [];
        }
      } else {
        var taps = takeTaps();
        for (var ti = 0; ti < taps.length; ti++) {
          var tc = Math.floor(taps[ti].x / cw), tr = Math.floor(taps[ti].y / ch);
          var idx = tr * cols + tc;
          var tile = tiles[idx];
          if (!tile || tile.up || tile.matched || flipped.length >= 2) continue;
          tile.up = true;
          flipped.push(idx);
          if (flipped.length === 2) {
            if (tiles[flipped[0]].id === tiles[flipped[1]].id) {
              tiles[flipped[0]].matched = true;
              tiles[flipped[1]].matched = true;
              flipped = [];
              score++;
              if (tiles.every(function (t) { return t.matched; })) setTimeout(reset, 700);
            } else {
              busy = true;
              busyT = 650;
            }
          }
        }
      }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      for (var c = 0; c < tiles.length; c++) {
        var cx = c % cols, cy = (c / cols) | 0;
        var x = cx * cw, y = cy * ch;
        var t2 = tiles[c];
        if (t2.matched) ctx.fillStyle = "hsl(" + hue2 + " 55% 30%)";
        else if (t2.up) ctx.fillStyle = "hsl(" + (hue + (t2.id * 37) % 120) + " 65% 55%)";
        else ctx.fillStyle = "#1c2230";
        ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      }
      ctx.fillStyle = "#5f6675";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText("pairs found " + score + "/" + pairs, 8, 14);
    });
  };

  KERNEL_FN.shooter = function (p) {
    var rate = num(p.rate, 1, 0.4, 2.5);
    var speed = num(p.speed, 1, 0.4, 2.5);
    var hue = num(p.hue, 350, 0, 360);
    var targets = [], flashes = [], spawnAcc = 0, score = 0, misses = 0;
    loop(function (dt) {
      spawnAcc += dt;
      var interval = 1100 / rate;
      if (spawnAcc > interval) { spawnAcc = 0; targets.push({ x: 12 + Math.random() * (W - 24), y: -6, v: (0.6 + Math.random() * 0.8) * speed }); }
      var taps = takeTaps();
      for (var ti = 0; ti < taps.length; ti++) {
        var tx = taps[ti].x;
        var best = -1, bestD = 26;
        for (var i = 0; i < targets.length; i++) {
          var d = Math.abs(targets[i].x - tx);
          if (d < bestD) { bestD = d; best = i; }
        }
        flashes.push({ x: tx, t: 140 });
        if (best >= 0) { targets.splice(best, 1); score++; }
      }
      for (var j = targets.length - 1; j >= 0; j--) {
        targets[j].y += targets[j].v * (dt / 16) * 2.4;
        if (targets[j].y > H + 10) { targets.splice(j, 1); misses++; }
      }
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, W, H);
      for (var k = 0; k < targets.length; k++) {
        ctx.fillStyle = "hsl(" + hue + " 70% 58%)";
        ctx.beginPath();
        ctx.arc(targets[k].x, targets[k].y, 6, 0, 6.29);
        ctx.fill();
      }
      for (var m = flashes.length - 1; m >= 0; m--) {
        flashes[m].t -= dt;
        if (flashes[m].t <= 0) { flashes.splice(m, 1); continue; }
        ctx.strokeStyle = "rgba(255,255,255," + (flashes[m].t / 140) + ")";
        ctx.beginPath();
        ctx.moveTo(flashes[m].x, H);
        ctx.lineTo(flashes[m].x, 0);
        ctx.stroke();
      }
      ctx.fillStyle = "#5f6675";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText("hits " + score + "  missed " + misses, 8, 14);
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
  function begin() {
    try {
      if (!spec || !spec.kernel || typeof KERNEL_FN[spec.kernel] !== "function") {
        msg("no game here yet");
      } else {
        KERNEL_FN[spec.kernel](spec.params && typeof spec.params === "object" ? spec.params : {});
      }
    } catch (e) {
      msg("this game wouldn't start", "#e0715c");
    }
  }
  // wait for the frame to have a real size before a kernel bakes its grid in
  var waited = 0;
  function whenSized() {
    fit();
    if ((canvas.clientWidth > 40 && canvas.clientHeight > 40) || waited > 30) {
      begin();
      return;
    }
    waited++;
    msg("…");
    requestAnimationFrame(whenSized);
  }
  whenSized();
})();
