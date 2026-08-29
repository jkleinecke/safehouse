/**
 * The magic half of the modifier pipeline, in one place every read path can
 * reach (FR8.2/FR8.4, §7.2).
 *
 * Before this module existed there were two answers to "what is Ash's pool?":
 * `services/characters.ts#deriveView` composed the scene plus sustaining and
 * knew nothing about foci, while `services/magic-foci.ts#deriveWithMagic`
 * composed the scene plus sustaining plus foci — so `GET …/derived` and
 * `GET …/magic/derived` could disagree about the same number while a focus was
 * switched on, and a roll launched from the sheet used the answer without the
 * focus in it.
 *
 * The composition lives here rather than in `characters.ts` for one structural
 * reason: `magic-foci.ts` already imports `characters.ts` (for wounds and the
 * scene), so putting it there would close an import cycle. `magic-store.ts`
 * imports nothing from `characters.ts`, which makes this module a leaf that
 * `characters.ts`, `rolls.ts` and `magic-foci.ts` can all depend on.
 *
 * Everything is a pure composition of `@safehouse/rules` over stored state, so
 * every modifier it emits carries its own `source`/`note` and shows up in the
 * pool's provenance (Principle 3).
 */
import type { Modifier } from '@safehouse/contracts';
import { focusModifiers, sustainingReport, type BondedFocus } from '@safehouse/rules';
import type { Db } from '@safehouse/db';
import {
  fociFor,
  readMagicState,
  spiritsOf,
  type FocusRecord,
  type MagicState,
  type SpiritRecord,
} from './magic-store.js';

/** A sustained spell as the play state stores it (`characters.ts#PlayState`). */
export interface SustainedLike {
  id: string;
  name: string;
  exempt: boolean;
}

/** −2 dice per sustained spell, focus/quickening/spirit exempt (FR8.2, §10.2). */
export function sustainedModifiersFor(sustained: readonly SustainedLike[]): Modifier[] {
  return sustained
    .filter((s) => !s.exempt)
    .map((s) => ({
      id: `sustain.${s.id}`,
      source: { kind: 'spell' as const, ref: s.name },
      target: 'pool.all',
      op: 'add' as const,
      value: -2,
      active: true,
      note: `sustaining ${s.name} (−2)`,
    }));
}

/** Stored focus row → the shape `@safehouse/rules` derives modifiers from. */
export function asBondedFocus(rec: FocusRecord): BondedFocus {
  return {
    id: rec.id,
    name: rec.name,
    kind: rec.kind,
    force: rec.force,
    bonded: rec.bonded,
    active: rec.active,
    sourceKind: rec.sourceKind,
    targets: rec.targets,
    mods: rec.mods,
    ...(rec.ref ? { ref: rec.ref } : {}),
    ...(rec.note ? { note: rec.note } : {}),
  };
}

/** Live (bonded AND active) foci as pipeline modifiers — the FR8.4 toggle. */
export function focusModifiersFor(state: MagicState, characterId: string): Modifier[] {
  return focusModifiers(fociFor(state, characterId).map(asBondedFocus));
}

/** Spirits in the shape `sustainingReport` wants (a dismissed spirit holds nothing). */
export function spiritSustainers(spirits: readonly SpiritRecord[]) {
  return spirits.map((s) => ({
    id: s.id,
    name: s.name,
    sustainingSpellId: s.sustainingSpellId,
    active: s.status === 'summoned',
  }));
}

/**
 * Sustaining (with spirit exemptions resolved) plus every live focus, for one
 * character, from an already-read state. Callers that hold a `MagicState`
 * — the magic tab's own derive path — use this; everyone else uses the `db`
 * form below.
 */
export function magicModifiersFor(
  state: MagicState,
  characterId: string,
  sustained: readonly SustainedLike[],
): Modifier[] {
  const live = spiritsOf(state, characterId).filter((s) => s.status === 'summoned');
  const report = sustainingReport(sustained, spiritSustainers(live));
  const resolved = report.lines.map((l) => ({ id: l.id, name: l.name, exempt: l.exempt }));
  return [...sustainedModifiersFor(resolved), ...focusModifiersFor(state, characterId)];
}

/** One read of the campaign's magic state, composed for this character. */
export async function magicSituationalFor(
  db: Db,
  campaignId: string,
  characterId: string,
  sustained: readonly SustainedLike[],
): Promise<Modifier[]> {
  return magicModifiersFor(await readMagicState(db, campaignId), characterId, sustained);
}
