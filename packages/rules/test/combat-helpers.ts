import type { Combatant, CombatantMonitors, RollResult } from '@safehouse/contracts';

/** Deterministic rng for tests (same algorithm family the generator uses). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function monitors(
  overrides: Partial<{ [K in keyof CombatantMonitors]: Partial<CombatantMonitors[K]> }> = {},
): CombatantMonitors {
  return {
    physical: { max: 10, filled: 0, ...overrides.physical },
    stun: { max: 10, filled: 0, ...overrides.stun },
    overflow: { max: 4, filled: 0, ...overrides.overflow },
  };
}

let nextId = 0;

export function combatant(overrides: Partial<Combatant> = {}): Combatant {
  nextId += 1;
  return {
    id: `c${nextId}`,
    encounterId: 'enc1',
    source: 'manual',
    name: `Combatant ${nextId}`,
    initBase: 8,
    initDice: 1,
    initScore: 0,
    initKind: 'physical',
    monitors: monitors(),
    effects: [],
    visibility: 'public',
    actedThisPass: false,
    ...overrides,
  };
}

/** Hand-built RollResult for forcing chain outcomes (GM-override path). */
export function forcedRoll(hits: number, limitedHits = hits): RollResult {
  return { faces: [], hits, ones: 0, glitch: 'none', limitedHits };
}
