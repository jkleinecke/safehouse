/**
 * Starter archetype library — shared shape and authoring helpers (FR10.1).
 *
 * ORIGINAL CONTENT ONLY (§14/G6). Everything in `archetypes/` is our own
 * writing: gang names, gear names, spell names, tier labels, table-facing
 * descriptions. Nothing here transcribes a published stat block, a published
 * archetype name, or a page citation — gear records deliberately carry no
 * `ref`, because we have not verified a page for any of them.
 *
 * An archetype is *generation ranges*, not a stat block (D10/D13): the engine
 * rolls each body inside these curves, so the GM gets a different NPC every
 * time and every number derives cleanly through `deriveCharacter`.
 */
import type { GenTemplate, GenTier, LoadoutSlot, NumRange, Persona, SheetV1Input } from '@safehouse/contracts';

/**
 * The tier ladder every starter archetype uses. `street` / `blooded` / `pro`
 * are the ids the shipped demo template already uses, so the tier dial in the
 * generate panel and the encounter builder work unchanged; `elite` is the top
 * rung a starting team should be scared of.
 */
export const STARTER_TIER_IDS = ['street', 'blooded', 'pro', 'elite'] as const;
export type StarterTierId = (typeof STARTER_TIER_IDS)[number];

/** An inclusive `[min, max]` sampling span — the terse authoring form of NumRange. */
export type Span = readonly [number, number];

/** Attribute codes an archetype may dial, including the special three. */
export type SpanAttr = 'bod' | 'agi' | 'rea' | 'str' | 'wil' | 'log' | 'int' | 'cha' | 'edg' | 'mag' | 'res';

export type AttrSpread = Readonly<Partial<Record<SpanAttr, Span>>>;
export type SkillSpread = Readonly<Record<string, Span>>;

/** One rung of an archetype's ladder, in authoring form. */
export interface TierSpec {
  id: StarterTierId;
  /** Archetype-specific rung name the GM sees on the dial ("Lobby watch"). */
  label: string;
  attrs: AttrSpread;
  skills: SkillSpread;
  /** Professional Rating span — drives morale (FR10.9) and default Edge. */
  pr: Span;
  metatypes: Readonly<Record<string, number>>;
  loadout: readonly LoadoutSlot[];
  /** Names of spell records carried on the archetype's own statblock. */
  spells?: readonly string[];
  /**
   * Names of 'ware the GM should picture on this rung. NOTE: the generator
   * emits these as zero-Essence named augments with no modifiers — the danger
   * on the high rungs lives in the attribute and skill curves instead.
   * INTEGRATION: when GenTier grows richer augment records, move the mods here.
   */
  augments?: readonly string[];
}

/** A shipped archetype: the template the GM would otherwise have hand-authored. */
export interface StarterArchetype {
  /** Stable kebab-case id — the seeding key, never shown to the GM. */
  id: string;
  /** Template name as it appears in the archetype list. */
  name: string;
  /** One line on what this is FOR at the table. */
  summary: string;
  /**
   * The archetype's own gear records. Loadout slot options resolve against
   * these exactly the way the server's `catalogOf` resolves a GM's template.
   */
  statblock: Partial<SheetV1Input>;
  gen: GenTemplate;
  persona: Partial<Persona>;
}

/** `[min, max]` → the contract's NumRange. */
export const toRange = (s: Span): NumRange => ({ min: s[0], max: s[1] });
const range = toRange;

/** Authoring form → contract form. Keeps the ladders readable as data. */
export function tier(spec: TierSpec): GenTier {
  const attributes: Record<string, NumRange> = {};
  for (const [code, span] of Object.entries(spec.attrs)) {
    if (span) attributes[code] = range(span);
  }
  const skills: Record<string, NumRange> = {};
  for (const [id, span] of Object.entries(spec.skills)) skills[id] = range(span);
  return {
    id: spec.id,
    label: spec.label,
    attributes,
    skills,
    professionalRating: range(spec.pr),
    metatypeWeights: { ...spec.metatypes },
    loadout: spec.loadout.map((s) => ({ ...s, options: [...s.options] })),
    spells: [...(spec.spells ?? [])],
    augments: [...(spec.augments ?? [])],
  };
}

export interface ArchetypeSpec {
  id: string;
  name: string;
  summary: string;
  /** Tags the tactical-hints lookup keys on, most specific first (FR10.10). */
  roleTags: readonly string[];
  statblock: Partial<SheetV1Input>;
  tiers: readonly TierSpec[];
  persona: Partial<Persona>;
}

export function archetype(spec: ArchetypeSpec): StarterArchetype {
  return {
    id: spec.id,
    name: spec.name,
    summary: spec.summary,
    statblock: spec.statblock,
    gen: { roleTags: [...spec.roleTags], tiers: spec.tiers.map(tier) },
    persona: spec.persona,
  };
}
