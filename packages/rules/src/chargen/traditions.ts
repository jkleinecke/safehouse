/**
 * Magical traditions (FR3.9 P5, docs/CHARGEN.md §8.4): the two the core
 * rulebook defines, as the attribute pair that resists Drain and the spirit
 * type each spell category calls on.
 *
 * Hermetic (SR5 p. 279) and shamanic (p. 280) are the whole core list. Spirit
 * types are ids only (the elements of p. 303–304), and so are the sprite types
 * a technomancer registers (p. 258); what a spirit can do is
 * `magic/spirit.ts` and the GM's page. The sheet stores the chosen drain pair
 * on `awakening.drain`, so a tradition from another book is a pair the GM
 * types in, not a row this table must grow.
 *
 * Numbers and ids only (DESIGN.md §14).
 */
import type { AttributeCode, MagicTradition, Ref } from '@safehouse/contracts';
import { SR5 } from './pages.js';

export const SPIRIT_TYPE_IDS = ['air', 'beasts', 'earth', 'fire', 'man', 'water'] as const;
export type SpiritTypeId = (typeof SPIRIT_TYPE_IDS)[number];

/**
 * The sprite types a technomancer compiles and registers (SR5 p. 258), ids
 * only — the same footing as the spirit types, so a registered sprite is
 * picked from a list rather than typed. What a sprite can do is the page's.
 */
export const SPRITE_TYPE_IDS = ['courier', 'crack', 'data', 'fault', 'machine'] as const;
export type SpriteTypeId = (typeof SPRITE_TYPE_IDS)[number];

export const SPELL_CATEGORY_IDS = ['combat', 'detection', 'health', 'illusion', 'manipulation'] as const;
export type SpellCategoryId = (typeof SPELL_CATEGORY_IDS)[number];

/** Keyed by the contracts' `MagicTradition` (the build's `magic.tradition`). */
export interface TraditionRow {
  id: MagicTradition;
  /** The two attributes of the Drain Resistance Test. */
  drain: readonly [AttributeCode, AttributeCode];
  /** The spirit type each spell category summons. */
  spirits: Readonly<Record<SpellCategoryId, SpiritTypeId>>;
  ref: Ref;
}

export const TRADITIONS: Readonly<Record<MagicTradition, TraditionRow>> = {
  hermetic: {
    id: 'hermetic',
    drain: ['log', 'wil'],
    spirits: { combat: 'fire', detection: 'air', health: 'man', illusion: 'water', manipulation: 'earth' },
    ref: SR5(279),
  },
  shamanic: {
    id: 'shamanic',
    drain: ['cha', 'wil'],
    spirits: { combat: 'beasts', detection: 'water', health: 'earth', illusion: 'air', manipulation: 'man' },
    ref: SR5(280),
  },
};

/** Where the spirit types are listed (Air to Water). */
export const SPIRIT_TYPES_REF: Ref = SR5(303);
export const SPRITE_TYPES_REF: Ref = SR5(258);
