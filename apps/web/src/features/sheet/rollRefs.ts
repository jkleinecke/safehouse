/**
 * What a roll can be read up on (FR11.2 meets FR3.4): the references behind
 * the dialog's config — the skill, the attributes in the pool, the test, the
 * limit — as `rules/refs.ts` names them. Pure, so the chain roll-row → config
 * → refs is testable without a DOM.
 */
import { rollRefs, type RuleRef } from '@safehouse/rules';
import type { RollConfig } from './rollDialogState.js';

export type { RuleRef } from '@safehouse/rules';

/** The pages behind each step of a resolved exchange (attack · defence · soak). */
export const CHAIN_STEP_REFS: Readonly<Record<'attack' | 'defense' | 'soak', RuleRef[]>> = {
  attack: rollRefs({ poolRef: 'weapon.' }),
  defense: rollRefs({ poolRef: 'defense' }),
  soak: rollRefs({ poolRef: 'soak' }),
};

/** A bare pool is still a Success Test; with Edge on it, Edge too. */
export function freeRollRefs(edge: boolean): RuleRef[] {
  return rollRefs(edge ? { attributes: ['edge'] } : {});
}

/** Skills whose weapons are swung, not fired. */
const MELEE_SKILLS = new Set(['blades', 'clubs', 'unarmed-combat', 'exotic-melee', 'exotic-melee-weapon']);

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function refsForRoll(config: RollConfig | null | undefined): RuleRef[] {
  if (!config) return [];
  const meta = config.meta ?? {};
  const poolRef = str(meta['poolRef']) ?? str(meta['poolKey']);
  const skillId = str(meta['skill']) ?? str(meta['skillId']);
  const attributes = config.baseBreakdown
    .filter((e) => e.source === 'attribute' || e.source === 'attr')
    .map((e) => e.label);
  const drain = meta['drainFor'] !== undefined;
  return rollRefs({
    ...(poolRef !== undefined ? { poolRef } : {}),
    ...(skillId !== undefined ? { skillId } : {}),
    attributes,
    ...(config.limit ? { limitKind: config.limit.kind } : {}),
    ...(config.kind !== undefined ? { kind: config.kind } : {}),
    drain,
    ...(skillId !== undefined ? { melee: MELEE_SKILLS.has(skillId) } : {}),
  });
}
