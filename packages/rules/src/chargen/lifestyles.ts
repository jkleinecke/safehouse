/**
 * Lifestyles at creation (FR3.9 P4, docs/CHARGEN.md §8.4): the monthly cost,
 * the starting-nuyen roll each grants, and the metatype multiplier.
 *
 * Costs and the starting-nuyen formula are the two tables on SR5 p. 95 (the
 * same costs head the Lifestyles section, p. 373). The metatype multiplier
 * is not on either page — it is on the metatype table (p. 66, "+20%",
 * "+100%") and restated at p. 420 — so it lives on the metatype rows and is
 * read from there, never copied: a Run Faster centaur's ×2.5 comes along for
 * free. Hospitalized is priced per day and cannot be owned, so it is not a
 * row.
 *
 * The roll itself is made on the record by the server at approval (G5); this
 * module only turns a dice total into nuyen.
 *
 * Numbers and page refs only (DESIGN.md §14).
 */
import type { LifestyleTier, Ref } from '@safehouse/contracts';
import { metatypeRow } from './metatypes.js';
import { SR5 } from './pages.js';

/** Keyed by the contracts' `LifestyleTier` (the build's lifestyle rows). */
export interface LifestyleRow {
  id: LifestyleTier;
  /** Nuyen per month, before the metatype multiplier ("and up" for Luxury). */
  monthly: number;
  /** Starting nuyen = (this many D6) × multiplier. */
  startingDice: number;
  startingMultiplier: number;
  ref: Ref;
}

const lifestyle = (id: LifestyleTier, monthly: number, dice: number, multiplier: number): LifestyleRow => ({
  id,
  monthly,
  startingDice: dice,
  startingMultiplier: multiplier,
  ref: SR5(95),
});

export const LIFESTYLES: Readonly<Record<LifestyleTier, LifestyleRow>> = {
  street: lifestyle('street', 0, 1, 20),
  squatter: lifestyle('squatter', 500, 2, 40),
  low: lifestyle('low', 2_000, 3, 60),
  middle: lifestyle('middle', 5_000, 4, 100),
  high: lifestyle('high', 10_000, 5, 500),
  luxury: lifestyle('luxury', 100_000, 6, 1_000),
};

/** A lifestyle by id or printed name (`'Middle'`); null for anything else. */
export function lifestyleRow(id: string): LifestyleRow | null {
  return (LIFESTYLES as Readonly<Record<string, LifestyleRow | undefined>>)[id.trim().toLowerCase()] ?? null;
}

/** The lifestyle multiplier for a metatype id (1 for anything the table does not know). */
export function lifestyleMultiplierFor(metatypeId: string | undefined): number {
  return metatypeRow(metatypeId)?.lifestyleMultiplier ?? 1;
}

/** Where the metatype surcharge is stated (the metatype table; restated at p. 420). */
export const LIFESTYLE_METATYPE_REF: Ref = SR5(66);

/** Starting nuyen from a lifestyle and the total of its dice — the carry-over is added by the caller. */
export function startingNuyenFor(id: LifestyleTier, diceTotal: number): number {
  return diceTotal * LIFESTYLES[id].startingMultiplier;
}
