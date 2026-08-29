/**
 * Reagent counters (FR8.4) — drams on hand, per character.
 *
 * The whole point of this half is the invariant in the last line of every
 * function: **a reagent count never goes negative.** A mage who tries to spend
 * more than they have gets told what they were short by; the counter stops at
 * zero rather than quietly borrowing.
 */

export interface ReagentChange {
  before: number;
  after: number;
  /** Drams actually moved (positive = spent, negative = added back). */
  applied: number;
  /** Requested minus applied on a spend — what the mage did not have. */
  shortfall: number;
}

/** Enough headroom for any table; keeps a fat-fingered paste from wrapping. */
export const MAX_REAGENTS = 99_999;

const nn = (n: number): number =>
  Math.min(MAX_REAGENTS, Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0)));

export function normalizeReagents(value: unknown): number {
  return typeof value === 'number' ? nn(value) : 0;
}

/** Spend drams. Floors at zero — the counter is never negative. */
export function spendReagents(before: number, amount: number): ReagentChange {
  const start = nn(before);
  const wanted = nn(amount);
  const applied = Math.min(wanted, start);
  return { before: start, after: start - applied, applied, shortfall: wanted - applied };
}

/** Restock drams, capped so a typo cannot break the counter. */
export function restockReagents(before: number, amount: number): ReagentChange {
  const start = nn(before);
  const added = nn(amount);
  const after = nn(start + added);
  return { before: start, after, applied: start - after, shortfall: 0 };
}

/** Set the count outright (Principle 2). Still floors at zero. */
export function setReagents(before: number, amount: number): ReagentChange {
  const start = nn(before);
  const after = nn(amount);
  return { before: start, after, applied: start - after, shortfall: 0 };
}
