import type { Glitch, LimitRef, ProvenanceEntry, RollResult } from '@safehouse/contracts';

// INTEGRATION: `resolveRoll` in src/dice.ts is the app-wide roller (Edge,
// Rule of Six, buy-hits). It was still a skeleton when the combat module was
// built, so combat keeps this minimal pure pool roller. Server code that wants
// authoritative dice can pre-roll through the dice service and hand results to
// `resolveAttackChain` via `opts.rolls` — the chain then never touches `rng`.

/**
 * Roll `pool` d6 with the standard SR5 read (§10.2): hits on 5–6,
 * glitch when ones > ⌊dice/2⌋, critical glitch when that happens with 0 hits.
 * `rng` returns a float in [0, 1).
 */
export function rollCombatPool(pool: number, rng: () => number, limit?: LimitRef): RollResult {
  const dice = Math.max(0, Math.floor(pool));
  const faces: number[] = [];
  for (let i = 0; i < dice; i += 1) {
    faces.push(1 + Math.floor(rng() * 6));
  }
  const hits = faces.filter((f) => f >= 5).length;
  const ones = faces.filter((f) => f === 1).length;
  const glitched = dice > 0 && ones > Math.floor(dice / 2);
  const glitch: Glitch = glitched ? (hits === 0 ? 'critical' : 'glitch') : 'none';
  const limitedHits = limit ? Math.min(hits, Math.max(0, limit.value)) : hits;
  return { faces, hits, ones, glitch, limitedHits };
}

/** Sum a provenance breakdown into a rollable pool (clamped at 0 dice). */
export function poolTotal(breakdown: ProvenanceEntry[]): number {
  return Math.max(
    0,
    breakdown.reduce((sum, entry) => sum + entry.value, 0),
  );
}
