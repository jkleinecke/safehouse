/**
 * The step kit's sentences about pools and prices (FR3.9, docs/CHARGEN.md
 * §4.4 "numbers chosen earlier are shown wherever they matter later", Step 8
 * "each with the cost quoted before the tap").
 *
 * Every step screen says the same two kinds of thing about the rail's
 * numbers: how much of a pool is left ("12 of 28 skill points left") and
 * what a tap would cost against it ("costs 10 Karma — you have 26"). Nine
 * screens writing those by hand would say them nine ways, and at least one
 * would show an overspend as "-3 left" — a number a first-timer reads as a
 * typo and a screen reader reads as "minus three". So the words live here,
 * pure, and an overspend is always said in words: "3 skill points over".
 *
 * The numbers are the engine's (`budgets().pools`); nothing here computes a
 * pool. No JSX, so the vocabulary is tested once (`words.test.ts`).
 */
import type { BudgetPool, Budgets } from '@safehouse/contracts';
import { POOL_META, formatPoolValue, type RailPoolKey } from '../lib.js';

/** What one unit of each pool is called, singular and plural. Nuyen is its currency sign instead. */
export const POOL_NOUNS: Readonly<Record<RailPoolKey, readonly [string, string]>> = {
  priorityPoints: ['priority point', 'priority points'],
  special: ['special point', 'special points'],
  attributes: ['attribute point', 'attribute points'],
  skills: ['skill point', 'skill points'],
  groups: ['group point', 'group points'],
  knowledge: ['knowledge point', 'knowledge points'],
  positiveQualities: ['Karma of positive qualities', 'Karma of positive qualities'],
  negativeQualities: ['Karma of negative qualities', 'Karma of negative qualities'],
  karma: ['Karma', 'Karma'],
  nuyen: ['', ''],
  contactKarma: ['contact Karma', 'contact Karma'],
  powerPoints: ['power point', 'power points'],
  spells: ['spell, ritual or preparation', 'spells, rituals and preparations'],
  forms: ['complex form', 'complex forms'],
  foci: ['point of bonded Force', 'points of bonded Force'],
};

/** "12 skill points", "1 skill point", "0.5 power points", "12,000¥". */
export function amountOf(key: RailPoolKey, n: number): string {
  const value = formatPoolValue(POOL_META[key].unit, n);
  const [one, many] = POOL_NOUNS[key];
  const noun = n === 1 ? one : many;
  return noun ? `${value} ${noun}` : value;
}

/** A pool read off the budgets, when the build has it. */
export function poolOf(budgets: Budgets, key: RailPoolKey): BudgetPool | undefined {
  return (budgets.pools as Partial<Record<RailPoolKey, BudgetPool>>)[key];
}

/**
 * How much of a pool is left, in words: "12 of 28 skill points left", or —
 * spent past what it holds — "3 skill points over: 31 spent of 28".
 */
export function poolSentence(key: RailPoolKey, pool: BudgetPool): string {
  const f = (n: number) => formatPoolValue(POOL_META[key].unit, n);
  if (pool.remaining < 0) return `${amountOf(key, -pool.remaining)} over: ${f(pool.spent)} spent of ${f(pool.available)}`;
  const [, many] = POOL_NOUNS[key];
  return `${f(pool.remaining)} of ${many ? `${f(pool.available)} ${many}` : f(pool.available)} left`;
}

/** A price quoted against a pool before the tap. */
export interface CostQuoteWords {
  text: string;
  /** The pool holds less than the price (or is already over). */
  short: boolean;
}

/**
 * What a tap costs against a pool, before it is made: "costs 10 Karma — you
 * have 26", "costs 10 Karma — you have 6, 4 short", "costs 5 Karma — you are
 * already 3 over". A negative amount is something the pool gains (a negative
 * quality): "gives 10 Karma — you have 26". With no pool to quote against,
 * only the price.
 */
export function costQuote(amount: number, key: RailPoolKey, pool: BudgetPool | undefined): CostQuoteWords {
  const verb = amount < 0 ? 'gives' : 'costs';
  const price = `${verb} ${amountOf(key, Math.abs(amount))}`;
  if (!pool) return { text: price, short: false };
  const f = (n: number) => formatPoolValue(POOL_META[key].unit, n);
  if (pool.remaining < 0) {
    return { text: `${price} — you are already ${f(-pool.remaining)} over`, short: amount > 0 };
  }
  if (amount > pool.remaining) {
    return { text: `${price} — you have ${f(pool.remaining)}, ${f(amount - pool.remaining)} short`, short: true };
  }
  return { text: `${price} — you have ${f(pool.remaining)}`, short: false };
}
