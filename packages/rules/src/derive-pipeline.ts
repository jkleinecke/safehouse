import type { Modifier, ModifierSourceKind, ProvenanceEntry } from '@safehouse/contracts';
import { envRowsOf, foldEnvironment, type EnvironmentCompensation } from './env.js';
import { lineRef } from './refs.js';

/**
 * Fixed modifier pipeline phase order (DESIGN.md §7.2):
 * base → augmentation → magic → temporary/status → wounds →
 * scene/range/situational → override.
 *
 * Qualities are innate character traits and apply immediately after base,
 * before augmentation. The base value itself is not a phase — it is the
 * starting point every pipeline run receives.
 */
export const PIPELINE_PHASES: readonly (readonly ModifierSourceKind[])[] = [
  ['quality'],
  ['cyberware'],
  ['power', 'spell'],
  ['status'],
  ['wound'],
  ['scene', 'range', 'situational'],
  ['override'],
];

/** Human label for a modifier's provenance line. */
export function modifierLabel(mod: Modifier): string {
  return mod.note ?? mod.source.ref ?? mod.id;
}

/**
 * The page a modifier's receipt line points at, spread into the line: the
 * modifier's own `bookRef` when it has one, nothing otherwise. Spread rather
 * than assigned so a line without a page carries no `ref: undefined` key and
 * a receipt compared field by field reads exactly as it did before pages.
 */
function lineRefOf(mod: Modifier): Pick<ProvenanceEntry, 'ref'> {
  return mod.bookRef ? { ref: mod.bookRef } : {};
}

export interface PipelineResult {
  value: number;
  breakdown: ProvenanceEntry[];
}

export interface PipelineOptions {
  /** Clamp the final value at 0, recording the clamp in the breakdown. */
  floorZero?: boolean;
  /**
   * The most the augmentation phases may raise the value (SR5 p.94: +4 on
   * any mental or physical attribute, whatever the source or combination of
   * sources). See `AUGMENTATION_SOURCE_KINDS` for what counts.
   */
  augmentationCap?: number;
  /**
   * The character's eyes and gear against the environment table (SR5 p.175):
   * low-light, thermographic, a smartlink for a shot's wind. Used when the
   * scene's line (and a shot's range band) are read as one lookup.
   */
  environment?: EnvironmentCompensation;
}

/**
 * The +4 augmentation bonus cap on a mental or physical attribute (SR5 p.94).
 * It is not a creation-only fence: the book says "at no point", so derive
 * holds it in play as well as the builder's validator at creation.
 */
export const AUGMENTATION_BONUS_CAP = 4;

/**
 * Which phases count toward the augmentation cap: everything between the
 * character's innate rating and the GM's word. Qualities are left out
 * because they are innate — the pipeline treats them as part of the natural
 * rating the cap is measured from (an Exceptional Attribute raises the
 * ceiling, it is not a bonus under it). Overrides are left out because the
 * GM's word beats the engine (Principle 2) — the book's own "unless
 * specifically excepted" is exactly an override. Wound, scene and range
 * modifiers never raise an attribute in practice, but if one did the book's
 * "all sources" would count it too.
 */
export const AUGMENTATION_SOURCE_KINDS: readonly ModifierSourceKind[] = [
  'cyberware',
  'power',
  'spell',
  'status',
  'wound',
  'scene',
  'range',
  'situational',
];

const countsTowardAugmentationCap = (phase: readonly ModifierSourceKind[]): boolean =>
  phase.some((kind) => AUGMENTATION_SOURCE_KINDS.includes(kind));

/**
 * Apply every active modifier whose `target` is in `targets` to `base`,
 * phase by phase in `PIPELINE_PHASES` order.
 *
 * Within a phase the result is order-independent (§17.1 property):
 * - `set` ops apply first; when several compete the highest value wins;
 * - `add` ops are summed;
 * - `cap` ops apply last; the lowest cap wins and only records a line when
 *   it actually clamps.
 *
 * The exception to "adds are summed" is the environment. Every additive
 * modifier that stands for rows of the environment table (`Modifier.env`: the
 * active scene, a shot's range band) is read together as ONE lookup and
 * written as one line, where the first of them would have gone (SR5 p.173:
 * the worst condition counts, two tied go a row worse, and range is one of
 * the conditions). So dim light and a medium-range shot cost −3 between them,
 * not −4, and the character's own eyes (`opts.environment`) are applied to
 * the rows before the worst one is picked.
 *
 * Every contribution is recorded as a **delta**, so the breakdown always
 * sums exactly to the final value (Principle 3). A modifier that knows its
 * page (`bookRef`) hands it to its line as `ref`, which is what lets the roll
 * dialog and the breakdown sheet put a book chip beside each buff and debuff.
 *
 * With `augmentationCap`, the value leaving the augmentation phases may sit
 * no higher than its natural rating (the value entering them) plus the cap
 * plus whatever penalties were added along the way. Penalties are kept out
 * of the headroom on purpose: a runner carrying +6 of chrome who takes a −2
 * ends at +2, not at +4 with the penalty swallowed by the excess. A `set` or
 * `cap` in those phases is absolute and stands as written. The excess comes
 * off in one `engine` line just before the override phase, so an override
 * still has the last word.
 */
export function applyPipeline(
  base: number,
  baseBreakdown: readonly ProvenanceEntry[],
  targets: readonly string[],
  mods: readonly Modifier[],
  opts?: PipelineOptions,
): PipelineResult {
  let value = base;
  const breakdown: ProvenanceEntry[] = [...baseBreakdown];
  const targetSet = new Set(targets);
  const relevant = mods.filter((m) => m.active && targetSet.has(m.target));

  const cap = opts?.augmentationCap;
  /** The value entering the first augmentation phase; null until reached. */
  let natural: number | null = null;
  /** Negative `add`s inside the augmentation phases. */
  let penalties = 0;
  let capChecked = false;
  const checkAugmentationCap = (): void => {
    capChecked = true;
    if (cap === undefined || natural === null) return;
    const ceiling = natural + cap + penalties;
    if (value <= ceiling) return;
    breakdown.push({
      label: `augmentation bonus cap (+${cap})`,
      value: ceiling - value,
      source: 'engine',
      ref: lineRef('augmentationCap'),
    });
    value = ceiling;
  };

  for (const phase of PIPELINE_PHASES) {
    const augmentation = countsTowardAugmentationCap(phase);
    if (cap !== undefined && !capChecked) {
      if (augmentation && natural === null) natural = value;
      else if (!augmentation && natural !== null) checkAugmentationCap();
    }

    const phaseMods = relevant.filter((m) => phase.includes(m.source.kind));
    if (phaseMods.length === 0) continue;

    const sets = phaseMods.filter((m) => m.op === 'set');
    if (sets.length > 0) {
      const winner = sets.reduce((a, b) => (b.value > a.value ? b : a));
      const delta = winner.value - value;
      value = winner.value;
      breakdown.push({
        label: `${modifierLabel(winner)} (set ${winner.value})`,
        value: delta,
        source: winner.source.kind,
        ...lineRefOf(winner),
      });
    }

    const envMods = phaseMods.filter((m) => envRowsOf(m) !== undefined);
    let envFolded = false;
    for (const m of phaseMods) {
      if (m.op !== 'add') continue;
      if (envMods.includes(m)) {
        // The scene and the range band: one lookup, one line (see above).
        if (envFolded) continue;
        envFolded = true;
        const line = foldEnvironment(envMods, { compensation: opts?.environment ?? {} });
        if (!line) continue;
        value += line.value;
        if (augmentation && line.value < 0) penalties += line.value;
        breakdown.push(line);
        continue;
      }
      value += m.value;
      if (augmentation && m.value < 0) penalties += m.value;
      breakdown.push({
        label: modifierLabel(m),
        value: m.value,
        source: m.source.kind,
        ...lineRefOf(m),
      });
    }

    const caps = phaseMods.filter((m) => m.op === 'cap');
    if (caps.length > 0) {
      const winner = caps.reduce((a, b) => (b.value < a.value ? b : a));
      if (winner.value < value) {
        const delta = winner.value - value;
        value = winner.value;
        breakdown.push({
          label: `${modifierLabel(winner)} (cap ${winner.value})`,
          value: delta,
          source: winner.source.kind,
          ...lineRefOf(winner),
        });
      }
    }
  }
  // Belt and braces: were the phase list ever to end on an augmentation
  // phase, the cap would still be held.
  if (!capChecked) checkAugmentationCap();

  if (opts?.floorZero && value < 0) {
    breakdown.push({ label: 'floored at 0', value: -value, source: 'engine' });
    value = 0;
  }

  return { value, breakdown };
}

/** Shorthand: a single base provenance entry. */
export function baseEntry(label: string, value: number): ProvenanceEntry {
  return { label, value, source: 'base' };
}
