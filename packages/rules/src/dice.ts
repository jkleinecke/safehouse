import type { Glitch, LimitRef, RollRequest, RollResult } from '@safehouse/contracts';

/**
 * Dice resolution (FR2.1–2.5, §10.2). Pure — the caller supplies the RNG:
 * `rng` returns a float in [0, 1) (the server passes a CSPRNG-backed one,
 * tests pass a seeded generator).
 */

/** One die: 1–6. */
export function d6(rng: () => number): number {
  const face = Math.floor(rng() * 6) + 1;
  return Math.min(6, Math.max(1, face));
}

/** Roll `n` dice. */
export function rollDice(n: number, rng: () => number): number[] {
  const faces: number[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) faces.push(d6(rng));
  return faces;
}

/** Buying hits: 4 dice → 1 hit, rounded down (FR2.4). */
export function buyHits(pool: number): number {
  return Math.floor(Math.max(0, pool) / 4);
}

const isHit = (f: number): boolean => f >= 5;

function countHits(faces: readonly number[]): number {
  return faces.filter(isHit).length;
}

function countOnes(faces: readonly number[]): number {
  return faces.filter((f) => f === 1).length;
}

/**
 * Rule of Six: every 6 in `seed` rolls one extra die; new sixes keep
 * exploding recursively. Returns the extra faces only.
 */
function explodeSixes(seed: readonly number[], rng: () => number): number[] {
  const extra: number[] = [];
  let pending = seed.filter((f) => f === 6).length;
  while (pending > 0) {
    pending--;
    const face = d6(rng);
    extra.push(face);
    if (face === 6) pending++;
  }
  return extra;
}

function glitchFor(ones: number, diceRolled: number, hits: number): Glitch {
  if (diceRolled > 0 && ones > Math.floor(diceRolled / 2)) {
    return hits === 0 ? 'critical' : 'glitch';
  }
  return 'none';
}

/**
 * Resolve a roll per FR2.1–2.3 / §10.2:
 * - hits on 5–6; glitch when ones > ⌊dice rolled/2⌋; critical glitch when a
 *   glitch lands zero hits (exploded dice count as dice rolled);
 * - `limitedHits` = min(hits, limit) — except Push the Limit (either timing),
 *   which ignores the limit entirely;
 * - Edge (`req.meta.edgeDice` carries the Edge dice to add — the server sets
 *   it from the actor's current Edge):
 *   - `push_pre`: +Edge dice up front, Rule of Six on the whole pool;
 *   - `push_post`: Edge dice added after the fact, Rule of Six on the added
 *     dice (their explosions included);
 *   - `second_chance`: every non-hit rerolled once (faces show the final
 *     state), limit still applies.
 */
export function resolveRoll(req: RollRequest, rng: () => number): RollResult {
  const edge = req.edge ?? null;
  const pool = Math.max(0, Math.floor(req.pool));
  const metaEdge = req.meta?.['edgeDice'];
  const edgeDice = typeof metaEdge === 'number' ? Math.max(0, Math.floor(metaEdge)) : 0;

  let faces: number[];
  let exploded: number[] = [];

  if (edge === 'push_pre') {
    faces = rollDice(pool + edgeDice, rng);
    exploded = explodeSixes(faces, rng);
  } else if (edge === 'push_post') {
    faces = rollDice(pool, rng);
    const extra = rollDice(edgeDice, rng);
    exploded = explodeSixes(extra, rng);
    faces = [...faces, ...extra];
  } else if (edge === 'second_chance') {
    faces = rollDice(pool, rng).map((f) => (isHit(f) ? f : d6(rng)));
  } else {
    faces = rollDice(pool, rng);
  }

  const all = [...faces, ...exploded];
  const hits = countHits(all);
  const ones = countOnes(all);
  const glitch = glitchFor(ones, all.length, hits);

  const ignoresLimit = edge === 'push_pre' || edge === 'push_post';
  const limitedHits =
    req.limit && !ignoresLimit ? Math.min(hits, Math.max(0, req.limit.value)) : hits;

  return {
    faces,
    hits,
    ones,
    glitch,
    limitedHits,
    ...(exploded.length > 0 ? { exploded } : {}),
  };
}

export interface ExtendedTestResult {
  /** Each interval's roll, in order; pool shrinks by 1 per interval (FR2.5). */
  rolls: RollResult[];
  /** Cumulative limited hits across intervals. */
  totalHits: number;
  /** Reached the threshold before the pool ran out. */
  success: boolean;
  /** Intervals actually rolled. */
  intervalsUsed: number;
}

/**
 * Extended test (FR2.5): roll, accumulate hits, pool −1 per interval; stop at
 * the threshold or when the pool is exhausted. A per-roll limit applies to
 * each interval's hits when supplied.
 */
export function resolveExtendedTest(
  opts: { pool: number; threshold: number; limit?: LimitRef },
  rng: () => number,
): ExtendedTestResult {
  const rolls: RollResult[] = [];
  let totalHits = 0;
  let pool = Math.max(0, Math.floor(opts.pool));
  while (pool > 0 && totalHits < opts.threshold) {
    const req: RollRequest = {
      kind: 'extended',
      pool,
      breakdown: [],
      visibility: 'public',
      actor: {},
      ...(opts.limit ? { limit: opts.limit } : {}),
    };
    const roll = resolveRoll(req, rng);
    rolls.push(roll);
    totalHits += roll.limitedHits;
    pool--;
  }
  return {
    rolls,
    totalHits,
    success: totalHits >= opts.threshold,
    intervalsUsed: rolls.length,
  };
}

export interface TeamworkResult {
  /** Each helper's roll, in the order given. */
  helpers: RollResult[];
  /** Extra dice for the leader: Σ helper hits. */
  bonusDice: number;
  /** Leader limit bonus: +1 per helper with at least one hit. */
  limitBonus: number;
  /** The leader's roll with bonus dice and raised limit applied. */
  leader: RollResult;
}

/**
 * Teamwork test (FR2.5): each helper rolls their own pool; every helper hit
 * adds one die to the leader's pool, and each helper who scored at least one
 * hit raises the leader's limit by 1 (when the roll carries a limit).
 */
export function resolveTeamwork(
  leaderReq: RollRequest,
  helperPools: readonly number[],
  rng: () => number,
): TeamworkResult {
  const helpers = helperPools.map((pool) =>
    resolveRoll(
      { kind: 'simple', pool: Math.max(0, Math.floor(pool)), breakdown: [], visibility: leaderReq.visibility, actor: {} },
      rng,
    ),
  );
  const bonusDice = helpers.reduce((sum, h) => sum + h.hits, 0);
  const limitBonus = helpers.filter((h) => h.hits > 0).length;
  const boosted: RollRequest = {
    ...leaderReq,
    pool: leaderReq.pool + bonusDice,
    ...(leaderReq.limit
      ? { limit: { ...leaderReq.limit, value: leaderReq.limit.value + limitBonus } }
      : {}),
  };
  const leader = resolveRoll(boosted, rng);
  return { helpers, bonusDice, limitBonus, leader };
}
