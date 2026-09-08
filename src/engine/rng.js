// Mulberry32 — small, fast, seedable. A life is reproducible from its seed.
export class Rng {
  constructor(seed) {
    this.s = seed >>> 0;
  }

  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + this.next() * (max - min);
  }

  int(min, maxExclusive) {
    return Math.floor(this.range(min, maxExclusive));
  }

  pick(arr) {
    return arr[this.int(0, arr.length)];
  }

  chance(p) {
    return this.next() < p;
  }
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}
