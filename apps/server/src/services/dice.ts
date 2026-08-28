/**
 * Dice service — the server's ONLY entropy source for authoritative rolls
 * (DESIGN.md §10.1, G5). Node `crypto.randomInt` per die; no seeds exposed.
 * The pure engine in @safehouse/rules receives `rng()` and stays deterministic
 * under test seeds; the server passes this CSPRNG-backed one.
 */
import { randomInt } from 'node:crypto';

/** One die, 1–6, CSPRNG-backed. */
export function rollDie(): number {
  return randomInt(1, 7);
}

/** Roll `n` d6 (n < 0 treated as 0). Faces in roll order. */
export function rollDice(n: number): number[] {
  const count = Math.max(0, Math.floor(n));
  const faces: number[] = [];
  for (let i = 0; i < count; i++) faces.push(rollDie());
  return faces;
}

const TWO_POW_24 = 2 ** 24;
const TWO_POW_48 = 2 ** 48;

/**
 * CSPRNG float in [0, 1) for the rules engine (`resolveRoll(req, rng)`).
 * 48 bits of entropy per call (two 24-bit draws — `crypto.randomInt` caps a
 * single range at 2^48 − 1) — uniform to ~1e-14 across 6 faces.
 */
export function rng(): number {
  const hi = randomInt(0, TWO_POW_24);
  const lo = randomInt(0, TWO_POW_24);
  return (hi * TWO_POW_24 + lo) / TWO_POW_48;
}
