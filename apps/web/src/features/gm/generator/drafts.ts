/**
 * Archetype draft helpers (FR10.1) — pure, no React, no I/O.
 *
 * The editor used to be reachable only through "+ new archetype", which meant
 * every archetype after the first was hand-typed from zero even when the GM
 * only wanted the same template one notch meaner. These helpers give the
 * editor its two other entry points: `draftFor` (edit what is installed) and
 * `duplicateDraft` (fork it, keep the original), which is what "installed
 * copies are fully editable" has to mean in practice.
 */
import { ATTRIBUTE_CODES, type GenTier, type NpcTemplate } from '@safehouse/contracts';
import type { NpcTemplateDraft } from './api.js';

/** A tier with every attribute present, so the range editor opens populated. */
export function defaultTier(id: string, label: string): GenTier {
  const attributes: Record<string, { min: number; max: number }> = {};
  for (const code of ATTRIBUTE_CODES) attributes[code] = { min: 2, max: 4 };
  return {
    id,
    label,
    attributes,
    skills: {},
    professionalRating: { min: 1, max: 2 },
    metatypeWeights: { human: 3, ork: 1, elf: 1, dwarf: 1, troll: 1 },
    loadout: [],
    spells: [],
    augments: [],
  };
}

export function blankDraft(): NpcTemplateDraft {
  return {
    name: 'New archetype',
    gen: { roleTags: [], tiers: [defaultTier('street', 'Street')] },
  };
}

/** A template can arrive with no `gen` at all (promoted statblocks do). */
function genOf(tpl: Pick<NpcTemplate, 'gen'>): NonNullable<NpcTemplate['gen']> {
  const gen = tpl.gen;
  if (!gen || gen.tiers.length === 0) {
    return { roleTags: gen?.roleTags ?? [], tiers: [defaultTier('street', 'Street')] };
  }
  return gen;
}

/** Open an existing archetype for editing in place (keeps its id → PATCH). */
export function draftFor(tpl: NpcTemplate): NpcTemplateDraft {
  return { ...tpl, gen: genOf(tpl) };
}

/**
 * Fork an archetype into a new, unsaved one.
 *
 * The id is dropped on purpose: `useSaveTemplate` POSTs when there is no id
 * and PATCHes when there is, so keeping it would silently overwrite the
 * archetype the GM meant to keep. The gen block is deep-copied for the same
 * reason — a shared tier array would let edits to the fork mutate the cached
 * original the picker is still rendering.
 */
export function duplicateDraft(
  tpl: NpcTemplate,
  existing: readonly { name: string }[] = [],
): NpcTemplateDraft {
  const { id: _id, ...rest } = tpl;
  const gen = genOf(tpl);
  return {
    ...rest,
    name: copyName(tpl.name, existing),
    gen: {
      roleTags: [...(gen.roleTags ?? [])],
      tiers: gen.tiers.map((t) => structuredClone(t)),
    },
  };
}

/**
 * "Ripper crew" → "Ripper crew (copy)" → "Ripper crew (copy 2)" …
 *
 * Duplicating twice without renaming is the normal way a GM builds a tier
 * ladder of variants; two rows with the identical name in the picker is the
 * failure that makes them stop trusting it.
 */
export function copyName(name: string, existing: readonly { name: string }[]): string {
  const taken = new Set(existing.map((t) => t.name.trim().toLowerCase()));
  const base = `${name} (copy`;
  let candidate = `${base})`;
  for (let n = 2; taken.has(candidate.trim().toLowerCase()); n += 1) {
    candidate = `${base} ${n})`;
  }
  return candidate;
}
