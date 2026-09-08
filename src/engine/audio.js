// Procedural audio only — no asset files (this machine can't reach a CDN or npm).
// A soft two-oscillator pad that drifts with mood, a noise bed for rain, and
// short enveloped blips for events. Everything starts muted until start() is
// called from a user gesture (browser autoplay policy).

let ctx = null;
let master = null;
let pad = null; // { oscA, oscB, filter, gain, lfo }
let rain = null; // { src, filter, gain }
let ready = false;

export function isReady() {
  return ready;
}

export function start() {
  if (ready) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.0;
  master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2);

  // --- pad ---
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  oscA.type = "sine";
  oscB.type = "triangle";
  oscA.frequency.value = 110;
  oscB.frequency.value = 110 * 1.5;
  oscB.detune.value = 6;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 500;
  filter.Q.value = 3;
  const gain = ctx.createGain();
  gain.gain.value = 0.08;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.06;
  lfoGain.gain.value = 0.04;
  lfo.connect(lfoGain).connect(gain.gain);
  oscA.connect(filter);
  oscB.connect(filter);
  filter.connect(gain).connect(master);
  oscA.start();
  oscB.start();
  lfo.start();
  pad = { oscA, oscB, filter, gain, lfo };

  // --- rain bed ---
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const rf = ctx.createBiquadFilter();
  rf.type = "bandpass";
  rf.frequency.value = 1200;
  rf.Q.value = 0.5;
  const rg = ctx.createGain();
  rg.gain.value = 0;
  src.connect(rf).connect(rg).connect(master);
  src.start();
  rain = { src, filter: rf, gain: rg };

  ready = true;
}

export function setMuted(m) {
  if (!ready) return;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.linearRampToValueAtTime(m ? 0 : 0.5, ctx.currentTime + 0.4);
}

// valence 0..1 opens the pad filter and lifts its pitch a little
export function setMood(valence) {
  if (!ready) return;
  const t = ctx.currentTime;
  pad.filter.frequency.linearRampToValueAtTime(320 + valence * 900, t + 1.5);
  pad.oscA.frequency.linearRampToValueAtTime(98 + valence * 30, t + 1.5);
  pad.oscB.frequency.linearRampToValueAtTime((98 + valence * 30) * 1.5, t + 1.5);
}

export function setRain(x) {
  if (!ready) return;
  rain.gain.gain.linearRampToValueAtTime(0.14 * x, ctx.currentTime + 1.2);
}

const BLIP = {
  resolve: { f: 660, type: "sine", dur: 0.12, g: 0.12 },
  memory: { f: 420, type: "triangle", dur: 0.5, g: 0.1 },
  event: { f: 880, type: "sine", dur: 0.18, g: 0.09 },
  era: { f: 160, type: "sawtooth", dur: 0.9, g: 0.09 },
  day: { f: 300, type: "sine", dur: 0.25, g: 0.05 },
};

export function blip(kind) {
  if (!ready) return;
  const spec = BLIP[kind];
  if (!spec) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = spec.type;
  o.frequency.setValueAtTime(spec.f, t);
  if (kind === "memory" || kind === "era") o.frequency.exponentialRampToValueAtTime(spec.f * 1.5, t + spec.dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(spec.g, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + spec.dur + 0.05);
}
