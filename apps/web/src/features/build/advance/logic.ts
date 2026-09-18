/**
 * The Improve panel's arithmetic, kept apart from its screen (FR3.7,
 * docs/CHARGEN.md §8.5 "Advancement").
 *
 * A runner in play improves with Karma the way Step 8 spends it, at the same
 * prices, and through the ledger: the panel sends one `KarmaSpend` to
 * `POST /api/characters/:id/advance`, the server writes a pending Karma entry
 * carrying it, and the GM's approval puts it on the sheet. So everything this
 * file decides is what the player is *about to ask for*, and every answer is
 * the rules engine's — `quoteAdvance` for the label, the price, the training
 * time and every rule against the spend; `advanceCurrentRating` for where a
 * raise starts. Nothing here restates a rule.
 *
 * - **A draft** is what the form holds: the kind of improvement, the thing
 *   picked, the rating asked for, and the typed name, category or
 *   specialisation a new line needs. `draftSpend` turns it into the spend,
 *   `from` read off the sheet as it is now — never remembered — so a sheet
 *   that moves under an open panel re-prices the draft rather than sending a
 *   stale `from`.
 * - **The rating stepper** refuses the way the builder's steppers do: past a
 *   ceiling the engine names (a natural maximum, 12 for a skill) with its
 *   sentence and page, and past the Karma available in words.
 * - **The confirm gate** is the first thing that stops the whole request:
 *   something still to type, the engine's first refusal (stale, already
 *   waiting on the GM, fenced), or a price the Karma cannot pay.
 * - **Karma available** is the ledger's projection — approved plus pending,
 *   what the server checks a request against; a GM's own advance is approved
 *   at once, so it must also fit what is already approved.
 * - **The list** under the form is the character's advance entries, newest
 *   first, each with its price, training time and where the GM has it.
 *
 * No JSX, no React; tested in `logic.test.ts`.
 */
import {
  KNOWLEDGE_CATEGORIES,
  type BuildAttributeId,
  type KarmaSpend,
  type KnowledgeCategory,
  type LedgerEntry,
  type LedgerState,
  type SheetV1,
} from '@safehouse/contracts';
import {
  ACTIVE_SKILL_TABLE,
  BUILD_ATTRIBUTE_NAMES,
  MAGIC_KIND_TABLE,
  SKILL_GROUP_TABLE,
  SPELL_CATEGORY_IDS,
  activeSkillRow,
  advanceCurrentRating,
  groupStanding,
  playMagicKind,
  quoteAdvance,
  trainingPhrase,
  type AdvanceQuote,
  type AdvanceRefusal,
  type AdvanceRefusalCode,
  type SpendTraining,
} from '@safehouse/rules';
import type { Refusal } from '../components/LimitStepper.js';

// ---------------------------------------------------------------------------
// What can be improved
// ---------------------------------------------------------------------------

export const IMPROVE_KINDS = [
  'attribute',
  'skill',
  'group',
  'knowledge',
  'newKnowledge',
  'language',
  'newLanguage',
  'specialization',
  'spell',
  'form',
] as const;
export type ImproveKind = (typeof IMPROVE_KINDS)[number];

export const IMPROVE_KIND_LABELS: Readonly<Record<ImproveKind, string>> = {
  attribute: 'An attribute',
  skill: 'An active skill',
  group: 'A skill group',
  knowledge: 'A knowledge skill',
  newKnowledge: 'A new knowledge skill',
  language: 'A language',
  newLanguage: 'A new language',
  specialization: 'A specialisation',
  spell: 'A new spell, ritual or preparation',
  form: 'A new complex form',
};

export interface ImproveOption {
  value: string;
  label: string;
}

/**
 * The kinds this runner can improve: every runner raises attributes, skills
 * and groups and learns knowledge and languages; a held knowledge skill or
 * bought language adds its raise; spells are for the casting types and
 * complex forms for technomancers (the engine's kind for the sheet,
 * `playMagicKind`, which reads an imported sheet too). Power points are not
 * here: a mystic adept buys them at creation, and in play they come with an
 * adept's Magic or with initiation, never at a Karma price (p. 279).
 */
export function improveKinds(sheet: SheetV1): ImproveOption[] {
  const kind = playMagicKind(sheet);
  return IMPROVE_KINDS.filter((k) => {
    switch (k) {
      case 'knowledge':
        return sheet.knowledge.length > 0;
      case 'language':
        return sheet.languages.some((l) => !l.native);
      case 'spell':
        return kind === 'magician' || kind === 'mysticAdept' || kind === 'aspected';
      case 'form':
        return kind === 'technomancer';
      default:
        return true;
    }
  }).map((k) => ({ value: k, label: IMPROVE_KIND_LABELS[k] }));
}

const CORE_ATTRIBUTES: readonly BuildAttributeId[] = ['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha', 'edg'];
const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

/** A skill as a target value: its id, and the weapon or vehicle a specific skill names. */
export function skillTargetValue(id: string, target?: string | null): string {
  return `${id}|${target?.trim() ?? ''}`;
}

function splitOnce(value: string): [string, string] {
  const at = value.indexOf('|');
  return at < 0 ? [value, ''] : [value.slice(0, at), value.slice(at + 1)];
}

/**
 * What a kind picks from: the attributes this runner has (Magic for the
 * Awakened, Resonance for technomancers); every active skill, the held ones
 * first with their rating; every group with where its skills stand; the held
 * knowledge skills and bought languages; the skills, knowledge skills and
 * languages a specialisation can go on. Kinds that add a new line by name
 * pick from nothing.
 */
export function improveTargets(sheet: SheetV1, kind: ImproveKind): ImproveOption[] {
  switch (kind) {
    case 'attribute': {
      const magic = MAGIC_KIND_TABLE[playMagicKind(sheet)].attribute;
      const ids: BuildAttributeId[] = [...CORE_ATTRIBUTES, ...(magic ? [magic] : [])];
      return ids.map((id) => {
        // The engine's own reading of "where this attribute is": Edge by its
        // maximum, Magic and Resonance after Essence loss (p.278).
        const rating = advanceCurrentRating(sheet, { kind: 'attribute', id, from: 0, to: 1 }) ?? 0;
        return { value: id, label: `${BUILD_ATTRIBUTE_NAMES[id].name} ${rating}` };
      });
    }
    case 'skill': {
      const held = sheet.skills
        .map((s) => {
          const row = activeSkillRow(s.id);
          const name = row?.name ?? s.id;
          return { value: skillTargetValue(row?.id ?? s.id, s.target), label: `${s.target ? `${name}: ${s.target}` : name} ${s.rating}` };
        })
        .sort(byName);
      const heldIds = new Set(sheet.skills.map((s) => activeSkillRow(s.id)?.id ?? s.id));
      const fresh = ACTIVE_SKILL_TABLE.filter((row) => row.specific || !heldIds.has(row.id))
        .map((row) => ({ value: skillTargetValue(row.id), label: `${row.name} (new)` }))
        .sort(byName);
      return [...held, ...fresh];
    }
    case 'group':
      return SKILL_GROUP_TABLE.map((row) => {
        const standing = groupStanding(sheet, row.id);
        const at = !standing ? '' : standing.specialised ? ' (a skill is specialised)' : standing.level === null ? ' (skills differ)' : ` ${standing.level}`;
        return { value: row.id, label: `${row.name}${at}` };
      });
    case 'knowledge':
      return sheet.knowledge.map((k) => ({ value: k.name, label: `${k.name} ${k.rating}` })).sort(byName);
    case 'language':
      return sheet.languages
        .filter((l) => !l.native)
        .map((l) => ({ value: l.name, label: `${l.name} ${l.rating}` }))
        .sort(byName);
    case 'specialization': {
      const skills = sheet.skills
        .filter((s) => s.rating > 0)
        .map((s) => ({ value: `active|${activeSkillRow(s.id)?.id ?? s.id}`, label: activeSkillRow(s.id)?.name ?? s.id }));
      const unique = skills.filter((s, i) => skills.findIndex((o) => o.value === s.value) === i).sort(byName);
      const knowledge = sheet.knowledge
        .filter((k) => k.rating > 0)
        .map((k) => ({ value: `knowledge|${k.name}`, label: `${k.name} (knowledge)` }))
        .sort(byName);
      const languages = sheet.languages
        .filter((l) => l.native || l.rating > 0)
        .map((l) => ({ value: `language|${l.name}`, label: `${l.name} (language)` }))
        .sort(byName);
      return [...unique, ...knowledge, ...languages];
    }
    default:
      return [];
  }
}

/** The categories a new formula is filed under: the five spell categories, a ritual, a preparation. */
export const FORMULA_CATEGORIES: readonly ImproveOption[] = [
  ...SPELL_CATEGORY_IDS.map((id) => ({ value: id, label: `${id[0]!.toUpperCase()}${id.slice(1)} spell` })),
  { value: 'ritual', label: 'Ritual' },
  { value: 'preparation', label: 'Preparation' },
];

export const KNOWLEDGE_CATEGORY_OPTIONS: readonly ImproveOption[] = KNOWLEDGE_CATEGORIES.map((id) => ({
  value: id,
  label: `${id[0]!.toUpperCase()}${id.slice(1)}`,
}));

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

export interface ImproveDraft {
  kind: ImproveKind;
  /** The picked attribute id, `skillId|target`, group id, name, or `list|id` for a specialisation. */
  target: string;
  /** The rating asked for (rated kinds). */
  to: number;
  /** A new line's name — or a specific skill's weapon or vehicle. */
  name: string;
  /** A new knowledge skill's category, or a new formula's. */
  category: string;
  /** The specialisation's words. */
  spec: string;
}

/** Whether a kind raises a rating (and so shows the rating stepper). */
export function isRated(kind: ImproveKind): boolean {
  return ['attribute', 'skill', 'group', 'knowledge', 'newKnowledge', 'language', 'newLanguage'].includes(kind);
}

/** The picked skill's table row when it is a new specific skill that still needs its weapon or vehicle. */
export function needsSkillTarget(sheet: SheetV1, draft: ImproveDraft): boolean {
  if (draft.kind !== 'skill') return false;
  const [id, target] = splitOnce(draft.target);
  return !target && !!activeSkillRow(id)?.specific && !sheet.skills.some((s) => (activeSkillRow(s.id)?.id ?? s.id) === id && !s.target);
}

/**
 * The rating a draft raises from, off the sheet as it is now: 0 for a new
 * line, null for a kind with no rating and for a group whose skills are not
 * level (the engine refuses that one with its reason).
 */
export function draftCurrent(sheet: SheetV1, draft: ImproveDraft): number | null {
  if (draft.kind === 'newKnowledge' || draft.kind === 'newLanguage') return 0;
  const spend = draftSpend(sheet, { ...draft, to: 1 }, { ignoreBlanks: true });
  return spend ? advanceCurrentRating(sheet, spend) : null;
}

/** A fresh draft for a kind: its first target, one rating up. */
export function draftFor(sheet: SheetV1, kind: ImproveKind, target?: string): ImproveDraft {
  const pick = target ?? improveTargets(sheet, kind)[0]?.value ?? '';
  const base: ImproveDraft = {
    kind,
    target: pick,
    to: 1,
    name: '',
    category: kind === 'newKnowledge' ? 'street' : kind === 'spell' ? 'combat' : '',
    spec: '',
  };
  const current = draftCurrent(sheet, base);
  return { ...base, to: (current ?? 0) + 1 };
}

/** The draft with its rating lifted to one past the sheet's, if the sheet has moved past it. */
export function settleDraft(sheet: SheetV1, draft: ImproveDraft): ImproveDraft {
  const current = draftCurrent(sheet, draft);
  return current !== null && draft.to <= current ? { ...draft, to: current + 1 } : draft;
}

/**
 * The spend a draft asks for, `from` read off the sheet; null while
 * something is still to be typed (a new line's name, a specialisation, a
 * specific skill's weapon). `ignoreBlanks` builds it anyway, for reading the
 * current rating before anything is typed.
 */
export function draftSpend(sheet: SheetV1, draft: ImproveDraft, options: { ignoreBlanks?: boolean } = {}): KarmaSpend | null {
  const name = draft.name.trim();
  const blank = (text: string): boolean => !options.ignoreBlanks && text.trim() === '';
  const from = (spend: KarmaSpend): number => advanceCurrentRating(sheet, spend) ?? 0;
  switch (draft.kind) {
    case 'attribute': {
      if (!(draft.target in BUILD_ATTRIBUTE_NAMES)) return null;
      const id = draft.target as BuildAttributeId;
      const probe: KarmaSpend = { kind: 'attribute', id, from: 0, to: draft.to };
      return { ...probe, from: from(probe) };
    }
    case 'skill': {
      const [id, held] = splitOnce(draft.target);
      if (!id) return null;
      const target = held || (needsSkillTarget(sheet, draft) ? name : '');
      if (needsSkillTarget(sheet, draft) && blank(name)) return null;
      const probe: KarmaSpend = { kind: 'skill', id, from: 0, to: draft.to, ...(target ? { target } : {}) };
      return { ...probe, from: from(probe) };
    }
    case 'group': {
      if (!draft.target) return null;
      const standing = groupStanding(sheet, draft.target);
      const level = standing ? (standing.level ?? standing.members[0]?.rating ?? 0) : 0;
      return { kind: 'group', id: draft.target, from: level, to: draft.to };
    }
    case 'knowledge': {
      if (!draft.target) return null;
      const probe: KarmaSpend = { kind: 'knowledge', name: draft.target, from: 0, to: draft.to };
      return { ...probe, from: from(probe) };
    }
    case 'newKnowledge': {
      if (blank(name)) return null;
      const category = (KNOWLEDGE_CATEGORIES as readonly string[]).includes(draft.category) ? (draft.category as KnowledgeCategory) : undefined;
      const probe: KarmaSpend = { kind: 'knowledge', name: name || '—', from: 0, to: draft.to, ...(category ? { category } : {}) };
      return { ...probe, from: from(probe) };
    }
    case 'language': {
      if (!draft.target) return null;
      const probe: KarmaSpend = { kind: 'language', name: draft.target, from: 0, to: draft.to };
      return { ...probe, from: from(probe) };
    }
    case 'newLanguage': {
      if (blank(name)) return null;
      const probe: KarmaSpend = { kind: 'language', name: name || '—', from: 0, to: draft.to };
      return { ...probe, from: from(probe) };
    }
    case 'specialization': {
      const [list, id] = splitOnce(draft.target);
      if (!id || blank(draft.spec)) return null;
      if (list !== 'active' && list !== 'knowledge' && list !== 'language') return null;
      return { kind: 'specialization', list, id, spec: draft.spec.trim() || '—' };
    }
    case 'spell':
      if (blank(name)) return null;
      return { kind: 'spell', name: name || '—', ...(draft.category ? { category: draft.category } : {}) };
    case 'form':
      if (blank(name)) return null;
      return { kind: 'form', name: name || '—' };
  }
}

/** What is still to be typed before a draft is a spend, in words. */
export function missingWords(sheet: SheetV1, draft: ImproveDraft): string {
  switch (draft.kind) {
    case 'skill':
      return needsSkillTarget(sheet, draft) ? 'Name the weapon or vehicle this skill is for.' : 'Pick a skill.';
    case 'newKnowledge':
      return 'Name the knowledge skill.';
    case 'newLanguage':
      return 'Name the language.';
    case 'specialization':
      return draft.target ? 'Say what the specialisation is.' : 'Pick a skill to specialise.';
    case 'spell':
      return 'Name the spell, ritual or preparation.';
    case 'form':
      return 'Name the complex form.';
    default:
      return 'Pick what to improve.';
  }
}

// ---------------------------------------------------------------------------
// Karma, the stepper, the confirm gate
// ---------------------------------------------------------------------------

export interface KarmaStanding {
  approved: number;
  /** The sum of pending Karma entries (spends are negative). */
  pending: number;
  /** What a request of this role may spend. */
  available: number;
}

/**
 * The character's Karma as the advance route checks it: approved plus
 * pending for a request that waits on the GM; for the GM's own advance,
 * approved at once, the lower of that and what is already approved.
 */
export function karmaStanding(entries: readonly LedgerEntry[], role: 'gm' | 'player'): KarmaStanding {
  let approved = 0;
  let pending = 0;
  for (const e of entries) {
    if (e.currency !== 'karma') continue;
    if (e.state === 'approved') approved += e.delta;
    else if (e.state === 'pending') pending += e.delta;
  }
  const projected = approved + pending;
  return { approved, pending, available: role === 'gm' ? Math.min(approved, projected) : projected };
}

/** The spends already waiting on the GM — the engine refuses asking for one again. */
export function pendingSpends(entries: readonly LedgerEntry[]): KarmaSpend[] {
  return entries.flatMap((e) => (e.state === 'pending' && e.advance ? [e.advance.spend] : []));
}

/** The rules that are ceilings: what the stepper stops at, rather than what the confirm button refuses. */
const CEILINGS: ReadonlySet<AdvanceRefusalCode> = new Set<AdvanceRefusalCode>([
  'advance-attribute-max',
  'advance-skill-max',
  'advance-group-max',
  'advance-knowledge-max',
]);

/** An engine refusal as the stepper's and the button's `Refusal`. */
export function refusalOf(r: AdvanceRefusal, hint?: string): Refusal {
  return { reason: r.message, ref: r.ref, ...(hint ? { hint } : {}) };
}

/**
 * Why the rating (or power-point) stepper will not go one further: a ceiling
 * the engine names for the next value, or a next value the Karma available
 * cannot pay. Null while it may.
 */
export function stepperRefusal(sheet: SheetV1, draft: ImproveDraft, available: number): Refusal | null {
  const next: ImproveDraft = { ...draft, to: draft.to + 1 };
  const spend = draftSpend(sheet, next, { ignoreBlanks: true });
  if (!spend) return null;
  const quote = quoteAdvance(sheet, spend);
  const ceiling = quote.refusals.find((r) => CEILINGS.has(r.code));
  const at = draft.to;
  if (ceiling) return refusalOf(ceiling, `at ${at}`);
  if (quote.cost > available) {
    return { reason: `${quote.label} would cost ${quote.cost} Karma; ${Math.max(0, available)} is available.`, hint: "can't afford more" };
  }
  return null;
}

export interface ImproveCheck {
  spend: KarmaSpend | null;
  /** The engine's quote, once the draft is a spend. */
  quote: AdvanceQuote | null;
  /** What stops the request, first thing first; null when it may be sent. */
  refusal: Refusal | null;
}

/** The whole request, gated: something to type, the engine's first refusal, then the price. */
export function improveCheck(
  sheet: SheetV1,
  draft: ImproveDraft,
  context: { pending: readonly KarmaSpend[]; available: number },
): ImproveCheck {
  const spend = draftSpend(sheet, draft);
  if (!spend) return { spend: null, quote: null, refusal: { reason: missingWords(sheet, draft) } };
  const quote = quoteAdvance(sheet, spend, { pending: context.pending });
  const first = quote.refusals[0];
  if (first) return { spend, quote, refusal: refusalOf(first) };
  if (quote.cost > context.available) {
    return {
      spend,
      quote,
      refusal: { reason: `This costs ${quote.cost} Karma; ${Math.max(0, context.available)} is available.` },
    };
  }
  return { spend, quote, refusal: null };
}

/**
 * The training time beside the price, in words: "Trains for 6 weeks.", and
 * "No training time." for Edge and for what the table does not time (p.107).
 * Shown, never enforced — the panel says so once, at the top.
 */
export function trainingWords(training: SpendTraining): string {
  const phrase = trainingPhrase(training);
  return phrase === 'no training time' ? 'No training time.' : `Trains for ${phrase}.`;
}

/** The confirm button's words: a player asks the GM, the GM improves at once. */
export function confirmWords(quote: AdvanceQuote | null, role: 'gm' | 'player'): string {
  const price = quote ? ` · ${quote.cost} Karma` : '';
  return role === 'gm' ? `Improve now${price}` : `Ask the GM${price}`;
}

/** What the panel says once the server has the request. */
export function doneWords(label: string, role: 'gm' | 'player', revision?: number): string {
  if (role === 'gm') return revision !== undefined ? `${label} is on the sheet (revision ${revision}).` : `${label} is waiting on the ledger.`;
  return `Sent to the GM: ${label}. It goes on the sheet when it is approved.`;
}

// ---------------------------------------------------------------------------
// The list of advances
// ---------------------------------------------------------------------------

export interface AdvanceRow {
  id: string;
  label: string;
  cost: number;
  training: string;
  state: LedgerState;
  /** The day it was asked for, "2076-05-12"; null when the entry has no timestamp. */
  day: string | null;
}

export const ADVANCE_STATE_WORDS: Readonly<Record<LedgerState, string>> = {
  pending: 'waiting on the GM',
  approved: 'on the sheet',
  rejected: 'turned down',
};

/** A character's advance entries, newest first, as the panel lists them. */
export function advanceRows(entries: readonly LedgerEntry[]): AdvanceRow[] {
  return entries
    .flatMap((e) =>
      e.advance
        ? [
            {
              id: e.id,
              label: e.advance.label,
              cost: e.advance.cost,
              training: trainingPhrase(e.advance.trainingTime),
              state: e.state,
              day: e.createdAt ? e.createdAt.slice(0, 10) : null,
              at: e.createdAt ?? '',
            },
          ]
        : [],
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ at: _at, ...row }) => row);
}
