import { describe, expect, it } from 'vitest';
import type { Combatant, RollRequest } from '@safehouse/contracts';
import {
  BLITZ_INITIATIVE_DICE,
  blitzInitiative,
  buyHits,
  closeCall,
  d6,
  EDGE_ACTION_LABELS,
  resolveExtendedTest,
  resolveRoll,
  resolveTeamwork,
  rollDice,
  seizeInitiative,
  turnOrder,
  type EdgeActionKind,
} from '../src/index.js';

/** Minimal tracker row — enough for `turnOrder` to sort it. */
function combatant(id: string, initScore: number): Combatant {
  return {
    id,
    encounterId: 'enc',
    source: 'manual',
    name: id,
    initBase: 8,
    initDice: 1,
    initScore,
    initKind: 'physical',
    monitors: {
      physical: { max: 10, filled: 0 },
      stun: { max: 10, filled: 0 },
      overflow: { max: 4, filled: 0 },
    },
    effects: [],
    visibility: 'public',
    actedThisPass: false,
  };
}

/** rng that deals a fixed sequence of faces; throws when over-drawn. */
function seqRng(faces: number[]): () => number {
  let i = 0;
  return () => {
    const f = faces[i];
    if (f === undefined) throw new Error(`seqRng exhausted after ${i} draws`);
    i++;
    return (f - 1) / 6;
  };
}

/** Deterministic seeded rng for statistical sanity (§17.1). */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function req(partial: Partial<RollRequest> & { pool: number }): RollRequest {
  return {
    kind: 'simple',
    breakdown: [],
    visibility: 'public',
    actor: {},
    ...partial,
  };
}

describe('d6 / rollDice', () => {
  it('maps rng output to faces 1..6', () => {
    expect(d6(seqRng([1]))).toBe(1);
    expect(d6(seqRng([6]))).toBe(6);
    expect(rollDice(3, seqRng([2, 4, 6]))).toEqual([2, 4, 6]);
  });

  it('rng edge values stay in bounds', () => {
    expect(d6(() => 0)).toBe(1);
    expect(d6(() => 0.999999999)).toBe(6);
  });
});

describe('resolveRoll basics (FR2.1)', () => {
  it('counts hits on 5-6 and ones', () => {
    const r = resolveRoll(req({ pool: 6 }), seqRng([1, 2, 3, 4, 5, 6]));
    expect(r.faces).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.hits).toBe(2);
    expect(r.ones).toBe(1);
    expect(r.glitch).toBe('none');
    expect(r.limitedHits).toBe(2);
    expect(r.exploded).toBeUndefined();
  });

  it('pool 0 rolls nothing and never glitches', () => {
    const r = resolveRoll(req({ pool: 0 }), seqRng([]));
    expect(r.faces).toEqual([]);
    expect(r.hits).toBe(0);
    expect(r.glitch).toBe('none');
  });

  it('hits never exceed pool without Edge (property spot-check)', () => {
    const rng = mulberry32(99);
    for (let pool = 1; pool <= 20; pool++) {
      const r = resolveRoll(req({ pool }), rng);
      expect(r.hits).toBeLessThanOrEqual(pool);
      expect(r.faces).toHaveLength(pool);
    }
  });
});

describe('glitch boundaries (§17.1: pool 7 needs 4+ ones)', () => {
  it('3 ones on 7 dice is NOT a glitch', () => {
    const r = resolveRoll(req({ pool: 7 }), seqRng([1, 1, 1, 5, 5, 3, 4]));
    expect(r.ones).toBe(3);
    expect(r.glitch).toBe('none');
  });

  it('4 ones on 7 dice IS a glitch', () => {
    const r = resolveRoll(req({ pool: 7 }), seqRng([1, 1, 1, 1, 5, 5, 3]));
    expect(r.ones).toBe(4);
    expect(r.glitch).toBe('glitch');
  });

  it('glitch with zero hits is critical', () => {
    const r = resolveRoll(req({ pool: 7 }), seqRng([1, 1, 1, 1, 2, 3, 4]));
    expect(r.hits).toBe(0);
    expect(r.glitch).toBe('critical');
  });

  it('exactly half ones on an even pool is not a glitch', () => {
    const r = resolveRoll(req({ pool: 4 }), seqRng([1, 1, 5, 6]));
    expect(r.glitch).toBe('none');
  });
});

describe('limit clipping (FR2.2)', () => {
  it('clips limitedHits to the limit, keeps raw hits', () => {
    const r = resolveRoll(
      req({ pool: 8, limit: { kind: 'physical', value: 3 } }),
      seqRng([5, 5, 5, 6, 6, 2, 3, 4]),
    );
    expect(r.hits).toBe(5);
    expect(r.limitedHits).toBe(3);
  });

  it('limitedHits equals hits when under the limit or no limit', () => {
    const under = resolveRoll(
      req({ pool: 4, limit: { kind: 'mental', value: 4 } }),
      seqRng([5, 2, 3, 4]),
    );
    expect(under.limitedHits).toBe(1);
    const none = resolveRoll(req({ pool: 4 }), seqRng([5, 5, 5, 5]));
    expect(none.limitedHits).toBe(4);
  });
});

describe('Edge semantics (FR2.3)', () => {
  it('push_pre adds Edge dice, explodes sixes recursively, ignores limit', () => {
    const r = resolveRoll(
      req({
        pool: 2,
        edge: 'push_pre',
        limit: { kind: 'physical', value: 2 },
        meta: { edgeDice: 2 },
      }),
      seqRng([6, 5, 6, 2, 6, 4, 1]),
    );
    expect(r.faces).toEqual([6, 5, 6, 2]); // pool + edge dice
    expect(r.exploded).toEqual([6, 4, 1]); // 2 seed sixes, one exploded six chains
    expect(r.hits).toBe(4); // 6,5,6 + exploded 6
    expect(r.limitedHits).toBe(4); // limit ignored
  });

  it('push_post appends Edge dice and explodes only those', () => {
    const r = resolveRoll(
      req({
        pool: 2,
        edge: 'push_post',
        limit: { kind: 'accuracy', value: 1 },
        meta: { edgeDice: 2 },
      }),
      seqRng([6, 1, 5, 6, 3]),
    );
    // base [6,1] does not explode; edge [5,6] does (one chain die: 3)
    expect(r.faces).toEqual([6, 1, 5, 6]);
    expect(r.exploded).toEqual([3]);
    expect(r.hits).toBe(3);
    expect(r.limitedHits).toBe(3); // push the limit ignores the limit
  });

  it('second_chance rerolls each non-hit once; limit still applies', () => {
    const r = resolveRoll(
      req({ pool: 4, edge: 'second_chance', limit: { kind: 'social', value: 2 } }),
      seqRng([5, 1, 2, 6, 4, 5]),
    );
    expect(r.faces).toEqual([5, 4, 5, 6]); // 1 and 2 rerolled into 4 and 5
    expect(r.hits).toBe(3);
    expect(r.limitedHits).toBe(2);
    expect(r.exploded).toBeUndefined();
  });

  it('exploded dice count toward the glitch denominator', () => {
    // 4 dice + 1 explosion = 5 rolled; 3 ones > floor(5/2) => glitch
    const r = resolveRoll(
      req({ pool: 4, edge: 'push_pre', meta: { edgeDice: 0 } }),
      seqRng([6, 1, 1, 1, 1]),
    );
    expect(r.ones).toBe(3 + 1);
    expect(r.glitch).toBe('glitch');
  });
});

describe('buyHits (FR2.4)', () => {
  it('trades 4 dice for 1 hit, rounded down', () => {
    expect(buyHits(0)).toBe(0);
    expect(buyHits(3)).toBe(0);
    expect(buyHits(4)).toBe(1);
    expect(buyHits(7)).toBe(1);
    expect(buyHits(8)).toBe(2);
    expect(buyHits(-4)).toBe(0);
  });
});

describe('extended tests (FR2.5)', () => {
  it('shrinks the pool by 1 per interval and stops at the threshold', () => {
    const r = resolveExtendedTest({ pool: 3, threshold: 4 }, seqRng([5, 5, 1, 5, 3, 5]));
    expect(r.rolls.map((x) => x.faces.length)).toEqual([3, 2, 1]);
    expect(r.totalHits).toBe(4);
    expect(r.success).toBe(true);
    expect(r.intervalsUsed).toBe(3);
  });

  it('fails when the pool runs out first', () => {
    const r = resolveExtendedTest({ pool: 2, threshold: 5 }, seqRng([1, 2, 3]));
    expect(r.success).toBe(false);
    expect(r.totalHits).toBe(0);
    expect(r.intervalsUsed).toBe(2);
  });

  it('applies a per-interval limit', () => {
    const r = resolveExtendedTest(
      { pool: 3, threshold: 10, limit: { kind: 'mental', value: 1 } },
      seqRng([5, 5, 6, 6, 6, 4]),
    );
    // 3 hits + 2 hits + 0, each interval clipped to 1
    expect(r.totalHits).toBe(2);
    expect(r.success).toBe(false);
  });
});

describe('teamwork tests (FR2.5)', () => {
  it('helper hits add dice; helpers with a hit raise the limit', () => {
    const r = resolveTeamwork(
      req({ pool: 4, kind: 'teamwork', limit: { kind: 'physical', value: 5 } }),
      [3, 2],
      seqRng([5, 6, 1, 2, 3, 5, 5, 5, 5, 5, 2]),
    );
    expect(r.helpers[0]?.hits).toBe(2);
    expect(r.helpers[1]?.hits).toBe(0);
    expect(r.bonusDice).toBe(2);
    expect(r.limitBonus).toBe(1);
    expect(r.leader.faces).toHaveLength(6); // 4 + 2 bonus dice
    expect(r.leader.hits).toBe(5);
    expect(r.leader.limitedHits).toBe(5); // limit raised 5 -> 6, hits under it
  });
});

describe('statistical sanity (§17.1, seeded rng)', () => {
  it('hit rate is ~1/3 over 10k dice (±2%)', () => {
    const r = resolveRoll(req({ pool: 10_000 }), mulberry32(1234));
    const rate = r.hits / 10_000;
    expect(rate).toBeGreaterThan(1 / 3 - 0.02);
    expect(rate).toBeLessThan(1 / 3 + 0.02);
  });

  it('Rule of Six pushes expected hits per original die to ~0.4', () => {
    const r = resolveRoll(
      req({ pool: 10_000, edge: 'push_pre', meta: { edgeDice: 0 } }),
      mulberry32(5678),
    );
    const rate = r.hits / 10_000; // E = (1/3)/(1 - 1/6) = 0.4
    expect(rate).toBeGreaterThan(0.4 - 0.02);
    expect(rate).toBeLessThan(0.4 + 0.02);
  });
});

// ---------------------------------------------------------------------------
// Edge actions that are not extra dice (FR2.3, FR4.4)
// ---------------------------------------------------------------------------

describe('Seize the Initiative (FR2.3/FR4.4)', () => {
  it('lifts the actor strictly above every other score in the pass', () => {
    const out = seizeInitiative(9, [21, 14, 3]);
    expect(out.from).toBe(9);
    expect(out.beat).toBe(21);
    expect(out.to).toBe(22);
    expect(out.changed).toBe(true);
    // …and the tracker's own ordering agrees the seizer now leads.
    const order = turnOrder([
      combatant('seizer', out.to),
      combatant('lead', 21),
      combatant('mid', 14),
    ]);
    expect(order.map((c) => c.id)).toEqual(['seizer', 'lead', 'mid']);
  });

  it('leaves a leader where they are (Edge still buys the guarantee)', () => {
    const out = seizeInitiative(30, [21, 14]);
    expect(out.to).toBe(30);
    expect(out.changed).toBe(false);
  });

  it('puts a spent actor back into the pass when nobody else is up', () => {
    const out = seizeInitiative(0, []);
    expect(out.to).toBe(1); // turnOrder drops scores <= 0
    expect(out.beat).toBeNull();
  });
});

describe('Blitz (FR2.3/FR4.4)', () => {
  it('rolls the maximum five initiative dice whatever the actor normally has', () => {
    const out = blitzInitiative({ base: 8, dice: 1 }, seqRng([6, 6, 6, 6, 6]));
    expect(out.dice).toBe(BLITZ_INITIATIVE_DICE);
    expect(out.rolls).toEqual([6, 6, 6, 6, 6]);
    expect(out.addedDice).toBe(4);
    expect(out.score).toBe(38);
  });

  it('still pays the wound modifier, and never buys dice it already has', () => {
    const out = blitzInitiative(
      { base: 10, dice: 5, woundModifier: -3 },
      seqRng([1, 1, 1, 1, 1]),
    );
    expect(out.addedDice).toBe(0);
    expect(out.score).toBe(12); // 10 + 5 - 3
  });
});

describe('Close Call (FR2.3)', () => {
  it('negates a critical glitch without touching the dice (G5)', () => {
    const rolled = resolveRoll(req({ pool: 4 }), seqRng([1, 1, 1, 1]));
    expect(rolled.glitch).toBe('critical');
    const out = closeCall(rolled);
    expect(out.applied).toBe(true);
    expect(out.negated).toBe('critical');
    expect(out.result.glitch).toBe('none');
    expect(out.result.faces).toEqual(rolled.faces);
    expect(out.result.hits).toBe(rolled.hits);
    // The input is untouched — the stored record is what it always was.
    expect(rolled.glitch).toBe('critical');
  });

  it('negates an ordinary glitch too', () => {
    const out = closeCall({ faces: [1, 1, 1, 5], hits: 1, ones: 3, glitch: 'glitch', limitedHits: 1 });
    expect(out.negated).toBe('glitch');
    expect(out.result.glitch).toBe('none');
  });

  it('buys nothing when the roll did not glitch', () => {
    const clean = { faces: [5, 5], hits: 2, ones: 0, glitch: 'none' as const, limitedHits: 2 };
    const out = closeCall(clean);
    expect(out.applied).toBe(false);
    expect(out.negated).toBe('none');
    expect(out.result).toBe(clean);
  });
});

describe('Edge action labels (FR2.3)', () => {
  it('names every action the engine knows', () => {
    const kinds: EdgeActionKind[] = [
      'push_pre',
      'push_post',
      'second_chance',
      'seize_initiative',
      'blitz',
      'close_call',
    ];
    for (const kind of kinds) expect(EDGE_ACTION_LABELS[kind].length).toBeGreaterThan(0);
  });
});
