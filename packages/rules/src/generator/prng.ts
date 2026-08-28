/**
 * Deterministic PRNG for seeded NPC generation (FR10.2, D13).
 * mulberry32: tiny, fast, good-enough distribution for sampling GM ranges.
 * NEVER used for authoritative dice — those go through the server CSPRNG.
 */

export type Seed = number | string;

/** mulberry32 — 32-bit state, returns floats in [0, 1). */
export function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalize a numeric/string seed to a uint32 (FNV-1a for strings). */
export function hashSeed(seed: Seed): number {
  if (typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff) {
    return seed >>> 0;
  }
  // Strings, negatives, floats, and >32-bit ints fold through FNV-1a.
  return fnv1a(String(seed), 0x811c9dc5);
}

function fnv1a(text: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Derive an independent substream seed from a master seed + label.
 * Substreams keep aspects (name / stats / loadout) independent so field-level
 * locks and rerolls never cascade into each other (FR10.2 "lock fields").
 */
export function combineSeed(seed: number, label: string): number {
  return fnv1a(label, seed ^ 0x9e3779b9);
}

/** Convenience: a mulberry32 stream for one aspect of a generation. */
export function subRng(seed: number, label: string): () => number {
  return mulberry32(combineSeed(seed, label));
}

/** Inclusive integer in [min, max] (order-corrected). */
export function randInt(rng: () => number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Uniform pick from a non-empty array. */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error('generator.pick: empty table');
  const idx = Math.floor(rng() * items.length);
  return items[Math.min(idx, items.length - 1)] as T;
}

/** Weighted pick from a record of non-negative weights; undefined if all zero/empty. */
export function weightedPick(
  rng: () => number,
  weights: Record<string, number>,
): string | undefined {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return undefined;
  let roll = rng() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll < 0) return key;
  }
  return entries[entries.length - 1]?.[0];
}

/** Deterministic Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(rng: () => number, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}
