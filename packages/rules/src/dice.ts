import type { Glitch, LimitRef, RollRequest, RollResult } from '@safehouse/contracts';

/** Every Edge action the engine knows (FR2.3) — dice-side and tracker-side. */
export type EdgeActionKind =
  | 'push_pre'
  | 'push_post'
  | 'second_chance'
  | 'seize_initiative'
  | 'blitz'
  | 'close_call';

/** Table-facing names, so a log line reads the same everywhere (FR2.3). */
export const EDGE_ACTION_LABELS: Record<EdgeActionKind, string> = {
  push_pre: 'Push the Limit',
  push_post: 'Push the Limit (after the roll)',
  second_chance: 'Second Chance',
  seize_initiative: 'Seize the Initiative',
  blitz: 'Blitz',
  close_call: 'Close Call',
};

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

// ---------------------------------------------------------------------------
// Edge actions that are not extra dice (FR2.3, FR4.4)
// ---------------------------------------------------------------------------

/**
 * Seize the Initiative (FR2.3/FR4.4): spend Edge to act first in the current
 * pass, whatever the roll said.
 *
 * The tracker orders by Initiative Score (`turnOrder`), so "first" is expressed
 * as a score strictly above everyone else still in the pass — one number the
 * whole table can see, rather than a hidden priority flag the ordering would
 * have to special-case. `otherScores` is every OTHER combatant's current score.
 */
export interface SeizeInitiativeOutcome {
  /** Score before the spend. */
  from: number;
  /** Score after: strictly above every other score in the pass. */
  to: number;
  /** The score that had to be beaten, or null when nobody else is up. */
  beat: number | null;
  /** False when the actor already led — the Edge still buys the guarantee. */
  changed: boolean;
}

export function seizeInitiative(
  actorScore: number,
  otherScores: readonly number[],
): SeizeInitiativeOutcome {
  const from = Math.floor(actorScore);
  const beat = otherScores.length > 0 ? Math.max(...otherScores.map((s) => Math.floor(s))) : null;
  // At least 1, so the actor is in `turnOrder` at all (it drops scores ≤ 0).
  const to = Math.max(from, (beat ?? 0) + 1, 1);
  return { from, to, beat, changed: to !== from };
}

/** SR5 ceiling on initiative dice — Blitz buys straight to it (FR2.3/§10.2). */
export const BLITZ_INITIATIVE_DICE = 5;

export interface BlitzOutcome {
  base: number;
  /** Always BLITZ_INITIATIVE_DICE. */
  dice: number;
  /** Dice bought over the actor's normal allowance (0 when already at 5d6). */
  addedDice: number;
  rolls: number[];
  woundModifier: number;
  score: number;
}

/**
 * Blitz (FR2.3/FR4.4): spend Edge to roll the maximum initiative dice — 5d6 —
 * instead of the actor's usual allowance. Same arithmetic as a normal
 * initiative roll (`base + Σd6 + wound modifier`), only the dice count is
 * forced, so the tracker can drop the score straight into the pass.
 */
export function blitzInitiative(
  input: { base: number; dice?: number; woundModifier?: number },
  rng: () => number,
): BlitzOutcome {
  const base = Math.floor(input.base);
  const normal = Math.max(0, Math.floor(input.dice ?? 1));
  const woundModifier = Math.floor(input.woundModifier ?? 0);
  const rolls = rollDice(BLITZ_INITIATIVE_DICE, rng);
  const score = base + rolls.reduce((sum, r) => sum + r, 0) + woundModifier;
  return {
    base,
    dice: BLITZ_INITIATIVE_DICE,
    addedDice: Math.max(0, BLITZ_INITIATIVE_DICE - normal),
    rolls,
    woundModifier,
    score,
  };
}

export interface CloseCallOutcome {
  /** The roll as it stands after the spend — the glitch cleared. */
  result: RollResult;
  /** What was negated; 'none' when there was nothing to negate. */
  negated: Glitch;
  /** True when Edge actually bought something. */
  applied: boolean;
}

/**
 * Close Call (FR2.3): spend Edge AFTER the fact to negate a glitch or critical
 * glitch. The faces are untouched — Edge buys off the consequence, not the
 * dice (G5: the rolled record is immutable; callers persist this as a new,
 * linked event rather than editing the roll).
 */
export function closeCall(result: RollResult): CloseCallOutcome {
  if (result.glitch === 'none') return { result, negated: 'none', applied: false };
  return { result: { ...result, glitch: 'none' }, negated: result.glitch, applied: true };
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
