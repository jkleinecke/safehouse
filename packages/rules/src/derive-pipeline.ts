import type { Modifier, ModifierSourceKind, ProvenanceEntry } from '@safehouse/contracts';

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

export interface PipelineResult {
  value: number;
  breakdown: ProvenanceEntry[];
}

export interface PipelineOptions {
  /** Clamp the final value at 0, recording the clamp in the breakdown. */
  floorZero?: boolean;
}

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
 * Every contribution is recorded as a **delta**, so the breakdown always
 * sums exactly to the final value (Principle 3).
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

  for (const phase of PIPELINE_PHASES) {
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
      });
    }

    for (const m of phaseMods) {
      if (m.op !== 'add') continue;
      value += m.value;
      breakdown.push({ label: modifierLabel(m), value: m.value, source: m.source.kind });
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
        });
      }
    }
  }

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
