// Procedural audio only — no asset files (this machine can't reach a CDN or npm).
// Everything is pitched to one key chosen from the life's seed: a slow three-note
// pad that walks a chord progression, a sparse auto-melody so there's always
// something moving, and event sounds that land on scale degrees instead of fixed
// Hz. A short feedback delay glues the melodic layer together. Mood bends the
// pad between minor and major thirds. Muted until start() from a user gesture.

let ctx = null;
let master = null;
let padGain = null;
let padOsc = []; // 3 persistent oscillators (chord voices)
let padFilter = null;
let rain = null; // { src, filter, gain }
let wet = null; // delay send for melodic layer
let ready = false;

// --- music theory ---
let root = 196; // Hz, set from seed in start()
const PENTA = [0, 3, 5, 7, 10]; // minor pentatonic — can't sound wrong
const NAT_MINOR = [0, 2, 3, 5, 7, 8, 10];
// chord progression as degrees of the natural-minor scale: i – VI – III – VII
const PROGRESSION = [0, 5, 2, 6];

let valence = 0.5;
let harmony = { step: 0, nextAt: 0 };
let melody = { nextAt: 0, lastDegree: 0 };

const A = 1.059463094359; // 2^(1/12)
function hz(semitones) {
  return root * Math.pow(A, semitones);
}
function scaleNote(scale, degree, octave) {
  const n = scale.length;
  let i = ((degree % n) + n) % n;
  const oct = octave + Math.floor(degree / n);
  return hz(scale[i] + 12 * oct);
}
function chordTones(step) {
  const deg = PROGRESSION[step % PROGRESSION.length];
  const third = valence > 0.62 ? 4 : 3; // brighten when the life is going well
  return [
    scaleNote(NAT_MINOR, deg, 0),
    hz(NAT_MINOR[deg % 7] + third + 12 * Math.floor(deg / 7)),
    scaleNote(NAT_MINOR, deg + 4, 0),
  ];
}

export function isReady() {
  return ready;
}

export function start(seed = 0) {
  if (ready) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();

  // key: one of a few roots between G2 and C3, picked from the seed
  root = 98 * Math.pow(A, [0, 3, 5, 7, 10, 12][seed % 6]);

  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2);

  // feedback delay — a send bus for melody + blips only
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.28;
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const wetGain = ctx.createGain();
  wetGain.gain.value = 0.35;
  delay.connect(fb).connect(delay);
  delay.connect(wetGain).connect(master);
  wet = ctx.createGain();
  wet.connect(delay);

  // --- pad: three chord voices through one filter ---
  padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 500;
  padFilter.Q.value = 2;
  padGain = ctx.createGain();
  padGain.gain.value = 0.06;
  padFilter.connect(padGain).connect(master);

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.05;
  lfoGain.gain.value = 0.03;
  lfo.connect(lfoGain).connect(padGain.gain);
  lfo.start();

  const tones = chordTones(0);
  padOsc = tones.map((f, i) => {
    const o = ctx.createOscillator();
    o.type = i === 0 ? "sine" : "triangle";
    o.frequency.value = f;
    o.detune.value = (i - 1) * 4;
    o.connect(padFilter);
    o.start();
    return o;
  });
  harmony.nextAt = ctx.currentTime + 6;
  melody.nextAt = ctx.currentTime + 3;

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

export function setMood(v) {
  if (!ready) return;
  valence = v;
  padFilter.frequency.linearRampToValueAtTime(320 + v * 900, ctx.currentTime + 1.5);
}

export function setRain(x) {
  if (!ready) return;
  rain.gain.gain.linearRampToValueAtTime(0.14 * x, ctx.currentTime + 1.2);
}

// Called every frame from main.js — advances the harmony and drops in melody notes.
export function update() {
  if (!ready) return;
  const now = ctx.currentTime;

  if (now >= harmony.nextAt) {
    harmony.step++;
    const tones = chordTones(harmony.step);
    padOsc.forEach((o, i) => {
      o.frequency.cancelScheduledValues(now);
      o.frequency.linearRampToValueAtTime(tones[i], now + 2.5);
    });
    harmony.nextAt = now + 8 + Math.random() * 8;
  }

  if (now >= melody.nextAt) {
    // step by a small interval from the last note, bias toward chord tones
    const jump = [-2, -1, -1, 1, 1, 2, 3][Math.floor(Math.random() * 7)];
    let degree = melody.lastDegree + jump;
    if (Math.random() < 0.25) degree = [0, 2, 4][Math.floor(Math.random() * 3)]; // land home
    melody.lastDegree = degree;
    if (Math.random() > 0.22) {
      const oct = Math.random() < 0.35 ? 2 : 1;
      voice(scaleNote(PENTA, degree, oct), "sine", 0.045, 0.5 + Math.random() * 0.8, true);
    }
    melody.nextAt = now + 0.9 + Math.random() * 2.6; // loose, human-ish timing
  }
}

function voice(freq, type, gain, dur, send) {
  const t = ctx.currentTime + Math.random() * 0.02;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.006);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  if (send && wet) g.connect(wet);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// Events land on scale degrees, kept recognisable by register + timbre.
export function blip(kind) {
  if (!ready) return;
  switch (kind) {
    case "resolve":
      voice(scaleNote(PENTA, chooseNear(2), 2), "triangle", 0.1, 0.22, true);
      break;
    case "memory":
      voice(scaleNote(PENTA, 0, 1), "sine", 0.08, 0.5, true);
      setTimeout(() => voice(scaleNote(PENTA, 3, 1), "sine", 0.07, 0.7, true), 140);
      break;
    case "event":
      voice(scaleNote(PENTA, chooseNear(4), 3), "sine", 0.06, 0.3, true);
      break;
    case "era":
      voice(hz(-12), "sawtooth", 0.09, 1.1, true);
      voice(hz(-5), "sawtooth", 0.05, 1.1, true);
      break;
    case "day":
      voice(hz(0), "sine", 0.04, 0.4, false);
      break;
  }
}

function chooseNear(center) {
  return center + [-1, 0, 0, 1][Math.floor(Math.random() * 4)];
}
