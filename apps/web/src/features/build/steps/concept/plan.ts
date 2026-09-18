/**
 * What picking a concept card does to a build, worked out before it happens
 * (FR3.9, docs/CHARGEN.md §4.4 Step 1).
 *
 * A card is a suggested spend for every later step, and picking one writes
 * that spend over the record. On an empty draft that is the whole point. On a
 * build the player has already worked — a metatype picked, attribute points
 * moved, Karma spent — the same tap would quietly throw that work away, and
 * "nothing is lost by going back" (§4.4) would be a lie on the very first
 * screen. So Step 1 asks first, and the question has to name what changes and
 * say that who the runner is stays.
 *
 * None of that is a second copy of the card rules. The engine's
 * `applyConcept` decides what a card writes and what it keeps; this module
 * runs it and *compares* the record before and after, section by section, so
 * the words on the confirm can never drift from what the tap really does. The
 * two answers it adds are about the player, not about Shadowrun:
 *
 * - **Whose work is it?** A section counts as the player's own when it
 *   differs from what the build's current card alone would have written on a
 *   cleared record (`cardBaseline`). Flicking between untouched cards changes
 *   nothing the player did, so it needs no question; a card over hand-moved
 *   attribute points does.
 * - **Whose metatype is it?** The engine can keep a metatype the player chose
 *   (`ApplyConceptOptions.metatype`). A metatype the previous card suggested
 *   is not the player's choice, so it is dropped before the next card is
 *   applied and that card's own suggestion stands.
 *
 * "Start from nothing" is the blank card, and it means what it says: the
 * spend goes back to `emptyBuild`'s — priorities, points, magic, qualities,
 * skills, gear, lifestyle, Karma and contacts — and the identity stays, with
 * the blank card marked as the concept. That is the engine's one behaviour
 * (`applyConcept` with the blank card is `clearSpend` with the card marked),
 * so the Fixer lane and this step cannot disagree about what the card clears.
 *
 * The card already on the build can be put back as it was (`again`): a
 * player who moved points around and wants the suggestion back gets it through
 * the same plan and the same question, naming what their own changes were.
 *
 * Pure, no JSX, no React. Our own words (DESIGN.md §14).
 */
import type { CharacterBuild, ChargenSettings, MagicAspect, MagicKind, MagicTradition } from '@safehouse/contracts';
import { BLANK_CONCEPT_ID, applyConcept, clearSpend, conceptPreset, metatypeRow, type ConceptPreset } from '@safehouse/rules';
import { priorityLine } from '../../lib.js';

// ---------------------------------------------------------------------------
// Sections of a build's spend
// ---------------------------------------------------------------------------

/** The parts of the record a card or a reset can touch, in walkthrough order. */
export const SPEND_SECTIONS = [
  'priorities',
  'metatype',
  'attributes',
  'magic',
  'qualities',
  'skills',
  'knowledge',
  'gear',
  'lifestyles',
  'karma',
  'contacts',
] as const;
export type SpendSection = (typeof SPEND_SECTIONS)[number];

interface SectionReader {
  /** How the section is named in a sentence. */
  label: string;
  value(build: CharacterBuild): unknown;
  /** Whether the record holds anything here at all. */
  filled(build: CharacterBuild): boolean;
  /** A before-and-after short enough for one line, where one fits. */
  detail?(before: CharacterBuild, after: CharacterBuild): string | null;
}

const anyPositive = (values: Record<string, number>): boolean => Object.values(values).some((n) => n > 0);

/** "Troll", or "none" for a record without one. */
export function metatypeName(id: string | null | undefined): string {
  if (!id) return 'none';
  return metatypeRow(id)?.name ?? id;
}

const MAGIC_WORDS: Readonly<Record<MagicKind, string>> = {
  mundane: 'no magic',
  magician: 'magician',
  aspected: 'aspected magician',
  adept: 'adept',
  mysticAdept: 'mystic adept',
  technomancer: 'technomancer',
};

/** "no magic", "aspected magician (conjuring), shamanic". */
export function magicWords(magic: { kind: MagicKind; aspect?: MagicAspect | undefined; tradition?: MagicTradition | undefined }): string {
  const kind = MAGIC_WORDS[magic.kind];
  const aspect = magic.kind === 'aspected' && magic.aspect ? ` (${magic.aspect})` : '';
  const tradition = magic.tradition ? `, ${magic.tradition}` : '';
  return `${kind}${aspect}${tradition}`;
}

const SECTIONS: Readonly<Record<SpendSection, SectionReader>> = {
  priorities: {
    label: 'priorities',
    value: (b) => b.priorities,
    filled: (b) => Object.values(b.priorities).some((p) => p !== null),
    detail: (before, after) =>
      Object.values(after.priorities).some((p) => p !== null) ? `${priorityLine(before)} becomes ${priorityLine(after)}` : null,
  },
  metatype: {
    label: 'metatype',
    value: (b) => b.metatype,
    filled: (b) => b.metatype !== null,
    detail: (before, after) => (after.metatype ? `${metatypeName(before.metatype)} becomes ${metatypeName(after.metatype)}` : null),
  },
  attributes: {
    label: 'attribute and special points',
    value: (b) => ({ attributes: b.attributes, special: b.special }),
    filled: (b) => anyPositive(b.attributes) || anyPositive(b.special),
  },
  magic: {
    label: 'magic or resonance, with its free picks and powers',
    value: (b) => ({ magic: b.magic, grants: b.grants, powers: b.powers }),
    filled: (b) =>
      b.magic.kind !== 'mundane' ||
      b.grants.skills.length + b.grants.groups.length + b.grants.spells.length + b.grants.forms.length + b.powers.length > 0,
    detail: (before, after) =>
      before.magic.kind !== after.magic.kind ? `${magicWords(before.magic)} becomes ${magicWords(after.magic)}` : null,
  },
  qualities: {
    label: 'qualities',
    value: (b) => b.qualities,
    filled: (b) => b.qualities.length > 0,
  },
  skills: {
    label: 'active skills and groups',
    value: (b) => ({ active: b.skills.active, groups: b.skills.groups }),
    filled: (b) => b.skills.active.length + b.skills.groups.length > 0,
  },
  knowledge: {
    label: 'knowledge skills and languages',
    value: (b) => ({ knowledge: b.skills.knowledge, languages: b.skills.languages }),
    filled: (b) => b.skills.knowledge.length + b.skills.languages.length > 0,
  },
  gear: {
    label: 'gear, augmentations and Karma turned into nuyen',
    value: (b) => ({ purchases: b.purchases, toNuyen: b.karma.toNuyen }),
    filled: (b) => b.purchases.length > 0 || b.karma.toNuyen > 0,
  },
  lifestyles: {
    label: 'lifestyle',
    value: (b) => b.lifestyles,
    filled: (b) => b.lifestyles.length > 0,
  },
  karma: {
    label: 'Karma spends',
    value: (b) => b.karma.spends,
    filled: (b) => b.karma.spends.length > 0,
  },
  contacts: {
    label: 'contacts',
    value: (b) => b.karma.contacts,
    filled: (b) => b.karma.contacts.length > 0,
  },
};

export function sectionLabel(section: SpendSection): string {
  return SECTIONS[section].label;
}

/** A value written with its object keys sorted, so two equal records compare equal whatever order they were built in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function sameSection(section: SpendSection, a: CharacterBuild, b: CharacterBuild): boolean {
  const reader = SECTIONS[section];
  return canonical(reader.value(a)) === canonical(reader.value(b));
}

// ---------------------------------------------------------------------------
// Cards applied
// ---------------------------------------------------------------------------

/** "Start from nothing": the engine's blank card — the empty spend, the identity kept, the blank card marked as the concept. */
export function startFromNothing(build: CharacterBuild, settings: ChargenSettings): CharacterBuild {
  const blank = conceptPreset(BLANK_CONCEPT_ID);
  return blank ? applyConcept(build, blank, settings) : build;
}

/** The card the record names as its concept, when it names one the engine knows. */
export function chosenConcept(build: Pick<CharacterBuild, 'identity'>): ConceptPreset | null {
  return conceptPreset(build.identity.concept);
}

/**
 * What the build's current card alone would have written on a cleared record
 * — the line between the card's suggestion and the player's own work. With no
 * card (or the blank one) that is the cleared record itself.
 */
export function cardBaseline(build: CharacterBuild, settings: ChargenSettings): CharacterBuild {
  const cleared = clearSpend(build);
  const current = chosenConcept(build);
  return current?.spend ? applyConcept(cleared, current, settings) : cleared;
}

/** The metatype the player picked themselves, or null when the record's metatype is the card's suggestion (or unset). */
export function ownMetatype(build: CharacterBuild, settings: ChargenSettings): string | null {
  if (build.metatype === null) return null;
  return build.metatype === cardBaseline(build, settings).metatype ? null : build.metatype;
}

/**
 * The card on the build, as a pure updater's body: the blank card clears the
 * spend; any other card goes through `applyConcept`, keeping a metatype the
 * player picked and dropping one a previous card suggested. An unknown id
 * changes nothing.
 */
export function applyCard(build: CharacterBuild, id: string, settings: ChargenSettings): CharacterBuild {
  const preset = conceptPreset(id);
  if (!preset) return build;
  if (!preset.spend) return applyConcept(build, preset, settings);
  const mine = ownMetatype(build, settings);
  return applyConcept({ ...build, metatype: mine }, preset, settings, mine ? { metatype: mine } : {});
}

/** The sections of the record that are the player's own work rather than the current card's suggestion. */
export function ownSections(build: CharacterBuild, settings: ChargenSettings): SpendSection[] {
  const baseline = cardBaseline(build, settings);
  return SPEND_SECTIONS.filter((s) => SECTIONS[s].filled(build) && !sameSection(s, build, baseline));
}

// ---------------------------------------------------------------------------
// The plan a tap would carry out
// ---------------------------------------------------------------------------

export interface SectionChange {
  section: SpendSection;
  label: string;
  /** `cleared` when the card leaves the section empty, `replaced` when it writes its own. */
  effect: 'cleared' | 'replaced';
  /** "C/B/E/A/D becomes D/C/E/B/A" where a before-and-after fits on a line. */
  detail: string | null;
  /** The player's own work, not the current card's suggestion. */
  own: boolean;
}

export interface ConceptPlan {
  preset: ConceptPreset;
  /** The record after the tap. */
  next: CharacterBuild;
  /** Sections that hold something now and would change, in walkthrough order. */
  changes: SectionChange[];
  /** Sections that hold something now and would stay exactly as they are. */
  kept: SpendSection[];
  /** Ask first: the tap would change something the player did themselves. */
  confirm: boolean;
  /** The card is the one already on the build: this puts its suggestion back. */
  again: boolean;
}

/** What picking card `id` would do to this build; null for an id the engine does not know. */
export function conceptPlan(build: CharacterBuild, id: string, settings: ChargenSettings): ConceptPlan | null {
  const preset = conceptPreset(id);
  if (!preset) return null;
  const next = applyCard(build, id, settings);
  const baseline = cardBaseline(build, settings);
  const changes: SectionChange[] = [];
  const kept: SpendSection[] = [];
  for (const section of SPEND_SECTIONS) {
    const reader = SECTIONS[section];
    if (!reader.filled(build)) continue;
    if (sameSection(section, build, next)) {
      kept.push(section);
      continue;
    }
    changes.push({
      section,
      label: reader.label,
      effect: reader.filled(next) ? 'replaced' : 'cleared',
      detail: reader.detail?.(build, next) ?? null,
      own: !sameSection(section, build, baseline),
    });
  }
  const again = chosenConcept(build)?.id === preset.id;
  return { preset, next, changes, kept, confirm: changes.some((c) => c.own), again };
}

/**
 * What a tap on card `id` does now: `apply` it at once (nothing of the
 * player's would change), `ask` first, or nothing (an unknown id, or a
 * build that may not be edited).
 */
export function pickCard(
  build: CharacterBuild,
  id: string,
  settings: ChargenSettings,
  editable = true,
): 'apply' | 'ask' | 'none' {
  if (!editable) return 'none';
  const plan = conceptPlan(build, id, settings);
  if (!plan) return 'none';
  return plan.confirm ? 'ask' : 'apply';
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** "a", "a and b", "a, b and c". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const capitalise = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The identity a card never touches, as the confirm names it. */
export const KEPT_IDENTITY_WORDS = 'Who the runner is — alias, real name, age, sex and background — stays as it is';

/** One changed section as a line: "Priorities: C/B/E/A/D becomes D/C/E/B/A", "Karma spends: cleared". */
export function changeLine(change: SectionChange): string {
  const what = change.detail ?? (change.effect === 'cleared' ? 'cleared' : "replaced with the card's suggestion");
  return `${capitalise(change.label)}: ${what}`;
}

/** "Who the runner is … stays as it is. So do qualities and contacts." */
export function keptSentence(plan: Pick<ConceptPlan, 'kept'>): string {
  if (plan.kept.length === 0) return `${KEPT_IDENTITY_WORDS}.`;
  const kept = listWords(plan.kept.map(sectionLabel));
  return `${KEPT_IDENTITY_WORDS}. So ${plan.kept.length === 1 ? 'does' : 'do'} ${kept}.`;
}

/** The changes that undo something the player did themselves — what "put the card back" would lose. */
export function ownChanges(plan: Pick<ConceptPlan, 'changes'>): SectionChange[] {
  return plan.changes.filter((c) => c.own);
}

/** The confirm's question. */
export function planTitle(plan: Pick<ConceptPlan, 'preset' | 'again'>): string {
  if (!plan.preset.spend) return 'Start from nothing?';
  return plan.again ? `Put “${plan.preset.title}” back as it was?` : `Use “${plan.preset.title}”?`;
}

/** The button that goes ahead. */
export function planGoLabel(plan: Pick<ConceptPlan, 'preset' | 'again'>): string {
  if (!plan.preset.spend) return 'clear and start over';
  return plan.again ? 'put the card back' : 'use this card';
}

// ---------------------------------------------------------------------------
// What a card fills in
// ---------------------------------------------------------------------------

export interface CardFills {
  /** "C/B/E/A/D" in the table's column order; null on the blank card. */
  priorities: string | null;
  /** The same, spoken: "metatype C, attributes B, magic E, skills A, resources D". */
  prioritiesSpoken: string | null;
  /** "Elf suggested", "any metatype". */
  metatype: string;
  /** "no magic", "magician, hermetic". */
  magic: string;
  /** The card's line as it is seen: "C/B/E/A/D · Elf suggested · no magic". */
  seen: string;
  /** The same line as it is heard, with the columns named. */
  heard: string;
}

/** What the blank card does, seen and heard alike. */
export const BLANK_CARD_FILLS = 'clears every later step; who the runner is stays';

/** What a card writes into the later steps, read off the preset. */
export function cardFills(preset: ConceptPreset): CardFills {
  const p = preset.priorities;
  const priorities = p ? priorityLine({ priorities: p }) : null;
  const prioritiesSpoken = p
    ? `metatype ${p.metatype}, attributes ${p.attributes}, magic ${p.magic}, skills ${p.skills}, resources ${p.resources}`
    : null;
  const metatype = preset.metatype ? `${metatypeName(preset.metatype)} suggested` : 'any metatype';
  const magic = magicWords(preset.magic);
  return {
    priorities,
    prioritiesSpoken,
    metatype,
    magic,
    seen: priorities ? `${priorities} · ${metatype} · ${magic}` : BLANK_CARD_FILLS,
    heard: prioritiesSpoken ? `Fills in priorities ${prioritiesSpoken}; ${metatype}; ${magic}.` : `${capitalise(BLANK_CARD_FILLS)}.`,
  };
}
