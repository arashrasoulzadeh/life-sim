// M6 — eras. A life ages. Each era shifts how fast needs slip, how briskly the
// agent moves, and the overall colour cast, so a long-running life visibly
// differs from a fresh one even when nothing dramatic is happening.

export const ERAS = [
  { id: "new", fromDay: 1, name: "newly booted", decayMul: 0.82, speedMul: 1.18, tint: null },
  { id: "steady", fromDay: 7, name: "steady", decayMul: 1.0, speedMul: 1.0, tint: null },
  { id: "worn", fromDay: 22, name: "long-running", decayMul: 1.12, speedMul: 0.92, tint: "rgba(216,198,143,0.06)" },
  { id: "legacy", fromDay: 48, name: "legacy build", decayMul: 1.24, speedMul: 0.84, tint: "rgba(201,167,122,0.1)" },
];

export function eraFor(day) {
  let era = ERAS[0];
  for (const e of ERAS) if (day >= e.fromDay) era = e;
  return era;
}
