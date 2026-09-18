/**
 * Focus bonding and price by focus type (FR3.9 P5, docs/CHARGEN.md §8.4).
 *
 * `magic/foci.ts` turns a bonded focus into modifiers and deliberately holds
 * no book data; this is the other half the builder needs — what bonding
 * costs in Karma (the Focus Table, SR5 p. 318) and what the item costs and
 * how available it is (SR5 p. 461, a different page from the bonding table).
 * At creation the total Force of bonded foci may not exceed Magic × 2
 * (p. 98); in play the count is capped at Magic and total Force at Magic × 5
 * (p. 318).
 *
 * Every focus is Restricted; its Availability is Force × the per-Force
 * figure, so the creation cap of 12 already stops power and weapon foci at
 * Force 3 and the rest at Force 4.
 *
 * Numbers and page refs only (DESIGN.md §14).
 */
import type { KarmaSpend, Ref } from '@safehouse/contracts';
import { SR5 } from './pages.js';

export const FOCUS_TYPE_IDS = ['enchanting', 'metamagic', 'power', 'qi', 'spell', 'spirit', 'weapon'] as const;
export type FocusType = (typeof FOCUS_TYPE_IDS)[number];

export interface FocusTypeRow {
  id: FocusType;
  /** Bonding Karma = Force × this (p. 318). */
  bondingKarmaPerForce: number;
  /** Price = Force × this nuyen (p. 461). */
  nuyenPerForce: number;
  /** Availability = Force × this, Restricted (p. 461). */
  availabilityPerForce: number;
  ref: Ref;
  priceRef: Ref;
}

const focus = (id: FocusType, bond: number, nuyen: number, avail: number): FocusTypeRow => ({
  id,
  bondingKarmaPerForce: bond,
  nuyenPerForce: nuyen,
  availabilityPerForce: avail,
  ref: SR5(318),
  priceRef: SR5(461),
});

export const FOCUS_TYPES: Readonly<Record<FocusType, FocusTypeRow>> = {
  enchanting: focus('enchanting', 3, 5_000, 3),
  metamagic: focus('metamagic', 3, 9_000, 3),
  power: focus('power', 6, 18_000, 4),
  qi: focus('qi', 2, 3_000, 3),
  spell: focus('spell', 2, 4_000, 3),
  spirit: focus('spirit', 2, 4_000, 3),
  weapon: focus('weapon', 3, 7_000, 4),
};

/** The Karma to bond a focus of this type and Force. */
export function focusBondingKarma(type: FocusType, force: number): number {
  return FOCUS_TYPES[type].bondingKarmaPerForce * force;
}

/**
 * The sub-types the Focus Table prices under a category (pp. 318–320): a
 * sustaining focus bonds as a spell focus, a banishing one as a spirit focus,
 * an alchemical one as an enchanting focus. Ids only.
 */
export const FOCUS_SUBTYPES: Readonly<Record<string, FocusType>> = {
  alchemical: 'enchanting',
  alchemy: 'enchanting',
  disenchanting: 'enchanting',
  centering: 'metamagic',
  'flexible signature': 'metamagic',
  masking: 'metamagic',
  'spell shaping': 'metamagic',
  counterspelling: 'spell',
  'ritual spellcasting': 'spell',
  spellcasting: 'spell',
  sustaining: 'spell',
  banishing: 'spirit',
  binding: 'spirit',
  summoning: 'spirit',
};

/**
 * The focus type a name or type label means, read tolerantly: "power",
 * "Power Focus", "Sustaining Focus (Health)", "qi focus: Improved Reflexes".
 * Lower case, anything from a bracket or colon on dropped, a trailing
 * "focus" dropped; then a category id or a sub-type. Null when neither
 * matches — the caller asks for the type rather than trust a bonding cost.
 */
export function focusTypeOf(text: string | null | undefined): FocusType | null {
  const key = (text ?? '')
    .toLowerCase()
    .replace(/[([{:].*$/, '')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .replace(/\s*\bfoci\b$|\s*\bfocus\b$/, '')
    .trim();
  if (!key) return null;
  if ((FOCUS_TYPE_IDS as readonly string[]).includes(key)) return key as FocusType;
  return FOCUS_SUBTYPES[key] ?? null;
}

/**
 * Every focus type a set of labels reads as — a spend's `focusType` and name,
 * and the name of the gear line it was bought as — once each, dearest bond
 * first (ties in table order). Labels that read as nothing add nothing.
 */
export function focusTypesOf(...labels: readonly (string | null | undefined)[]): FocusType[] {
  const types: FocusType[] = [];
  for (const label of labels) {
    const type = focusTypeOf(label);
    if (type && !types.includes(type)) types.push(type);
  }
  return types.sort(
    (a, b) =>
      FOCUS_TYPES[b].bondingKarmaPerForce - FOCUS_TYPES[a].bondingKarmaPerForce || FOCUS_TYPE_IDS.indexOf(a) - FOCUS_TYPE_IDS.indexOf(b),
  );
}

/**
 * A focus spend's type for pricing: what its `focusType` and its name read
 * as, and where the two disagree the dearer — a "Power Focus" labelled
 * `spell` bonds at the power focus's price, never the spell focus's (the
 * validator also says the two disagree). Null when neither reads.
 */
export function focusSpendType(spend: Pick<Extract<KarmaSpend, { kind: 'focus' }>, 'focusType' | 'name'>): FocusType | null {
  return focusTypesOf(spend.focusType, spend.name)[0] ?? null;
}

/** Bonded-focus ceilings: at creation total Force ≤ Magic × 2; in play count ≤ Magic, Force ≤ Magic × 5. */
export const FOCUS_LIMITS = {
  creationForcePerMagic: 2,
  creationRef: SR5(98),
  playCountPerMagic: 1,
  playForcePerMagic: 5,
  playRef: SR5(318),
} as const;
