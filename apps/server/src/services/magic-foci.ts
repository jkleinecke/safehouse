/**
 * Foci, reagents, and derivation with magic in the pipeline (FR8.4, FR8.2).
 *
 * A bonded focus is not a note on the gear list: it is a **toggled modifier
 * source**. Flipping it changes the derived pool immediately and names itself
 * in that pool's provenance, because it goes through the same
 * `deriveCharacter` pipeline as cyberware, qualities and wounds (§7.2,
 * Principle 3). Two gates, both real — unbonded contributes nothing at all,
 * bonded-but-off contributes nothing right now.
 *
 * Reagents are a dram counter per character whose only interesting property is
 * that it cannot go negative.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  ModifierSchema,
  RefSchema,
  type DerivedCharacter,
  type Modifier,
} from '@safehouse/contracts';
import {
  deriveCharacter,
  restockReagents,
  setReagents,
  spendReagents,
  sustainingReport,
  type SustainingReport,
} from '@safehouse/rules';
import { characters, type Db } from '@safehouse/db';
import type { Hub } from '../hub.js';
import { httpError } from './auth.js';
import { activeSceneModifiers, liveWounds, type CharacterRecord } from './characters.js';
// The one composer of the magic pipeline — shared with `deriveView` and the
// roll path so the three cannot disagree about a pool (FR8.2/FR8.4).
import {
  focusModifiersFor,
  magicModifiersFor,
  magicSituationalFor,
  spiritSustainers,
} from './magic-derive.js';
import {
  commitMagicState,
  fociFor,
  FocusRecordSchema,
  MAX_FOCI,
  newMagicId,
  readMagicState,
  reagentsFor,
  spiritsOf,
  type FocusRecord,
  type MagicState,
  type SpiritRecord,
} from './magic-store.js';

// ---------------------------------------------------------------------------
// Foci (FR8.4)
// ---------------------------------------------------------------------------

export interface FocusInput {
  name: string;
  kind?: string;
  force?: number;
  bonded?: boolean;
  active?: boolean;
  sourceKind?: 'power' | 'spell';
  targets?: string[];
  mods?: Array<z.input<typeof ModifierSchema>>;
  ref?: z.input<typeof RefSchema>;
  note?: string;
}

export async function addFocus(
  db: Db,
  hub: Hub,
  campaignId: string,
  characterId: string,
  input: FocusInput,
): Promise<FocusRecord> {
  const state = await readMagicState(db, campaignId);
  if (state.foci.length >= MAX_FOCI) {
    throw httpError(409, 'too_many_foci', `a campaign tracks at most ${MAX_FOCI} foci`);
  }
  const focus = FocusRecordSchema.parse({
    ...input,
    id: newMagicId('focus'),
    characterId,
    createdAt: new Date().toISOString(),
  });
  // An active bonded focus emits real `Modifier` rows, so the shelf write moves
  // a pool: stored with no frame, the sheet keeps rolling the old number (§6.2).
  await commitMagicState(
    db,
    hub,
    campaignId,
    { ...state, foci: [...state.foci, focus] },
    { payload: { op: 'focus.added', focus, characterId } },
  );
  return focus;
}

export function requireFocus(state: MagicState, focusId: string): FocusRecord {
  const focus = state.foci.find((f) => f.id === focusId);
  if (!focus) throw httpError(404, 'not_found', 'unknown focus');
  return focus;
}

/** Bond / unbond / flip the toggle / hand-edit (Principle 2). */
export async function patchFocus(
  db: Db,
  hub: Hub,
  campaignId: string,
  focusId: string,
  patch: Partial<FocusInput>,
): Promise<FocusRecord> {
  const state = await readMagicState(db, campaignId);
  const current = requireFocus(state, focusId);
  const next = FocusRecordSchema.parse({ ...current, ...patch });
  await commitMagicState(
    db,
    hub,
    campaignId,
    { ...state, foci: state.foci.map((f) => (f.id === focusId ? next : f)) },
    { payload: { op: 'focus.updated', focus: next, characterId: next.characterId } },
  );
  return next;
}

export async function removeFocus(
  db: Db,
  hub: Hub,
  campaignId: string,
  focusId: string,
): Promise<FocusRecord> {
  const state = await readMagicState(db, campaignId);
  const current = requireFocus(state, focusId);
  await commitMagicState(
    db,
    hub,
    campaignId,
    { ...state, foci: state.foci.filter((f) => f.id !== focusId) },
    { payload: { op: 'focus.removed', focusId, characterId: current.characterId } },
  );
  return current;
}

// ---------------------------------------------------------------------------
// Reagents (FR8.4)
// ---------------------------------------------------------------------------

export interface ReagentOpInput {
  op?: 'spend' | 'restock' | 'set';
  amount?: number;
}

export interface ReagentOpResult {
  characterId: string;
  before: number;
  after: number;
  /** What the mage asked for and did not have — the counter floors at zero. */
  shortfall: number;
}

export async function reagentOp(
  db: Db,
  hub: Hub,
  campaignId: string,
  characterId: string,
  input: ReagentOpInput,
): Promise<ReagentOpResult> {
  const state = await readMagicState(db, campaignId);
  const before = reagentsFor(state, characterId);
  const amount = input.amount ?? 1;
  const change =
    input.op === 'restock'
      ? restockReagents(before, amount)
      : input.op === 'set'
        ? setReagents(before, amount)
        : spendReagents(before, amount);
  const result = {
    characterId,
    before: change.before,
    after: change.after,
    shortfall: change.shortfall,
  };
  // Drams are a consumable: a spend that lands with no frame is a counter the
  // mage's own phone still shows at the old total, and spends again (§6.2).
  await commitMagicState(
    db,
    hub,
    campaignId,
    { ...state, reagents: { ...state.reagents, [characterId]: change.after } },
    { payload: { op: `reagents.${input.op ?? 'spend'}`, ...result } },
  );
  return result;
}

// ---------------------------------------------------------------------------
// Derivation with magic folded in
// ---------------------------------------------------------------------------

/**
 * The magic-side modifiers for a character: sustaining (with spirit
 * exemptions already applied) plus every live focus.
 *
 * The composition itself moved to `magic-derive.ts` when `deriveView` and the
 * roll path adopted it, so `GET /api/characters/:id/derived`,
 * `GET …/magic/derived` and a roll launched from the sheet are now three views
 * of one list rather than three answers.
 */
export function magicModifiersFromState(state: MagicState, rec: CharacterRecord): Modifier[] {
  return magicModifiersFor(state, rec.id, rec.play.sustained);
}

export async function magicSituationalModifiers(
  db: Db,
  rec: CharacterRecord,
): Promise<Modifier[]> {
  return magicSituationalFor(db, rec.campaignId, rec.id, rec.play.sustained);
}

export interface MagicDerivedView {
  characterId: string;
  name: string;
  derived: DerivedCharacter;
  /** Every modifier actually applied on top of the sheet (Principle 3). */
  situational: Modifier[];
  /** The focus half of that list, called out for the toggle rack. */
  focusModifiers: Modifier[];
  foci: FocusRecord[];
  spirits: SpiritRecord[];
  sustaining: SustainingReport;
  reagents: number;
  activeSceneId: string | null;
}

/** The character's live numbers with bonded foci and spirit-sustaining folded in. */
export async function deriveWithMagic(db: Db, rec: CharacterRecord): Promise<MagicDerivedView> {
  const [scene, state, wounds] = await Promise.all([
    activeSceneModifiers(db, rec.campaignId),
    readMagicState(db, rec.campaignId),
    liveWounds(db, rec),
  ]);
  const spirits = spiritsOf(state, rec.id);
  const report = sustainingReport(
    rec.play.sustained,
    spiritSustainers(spirits.filter((s) => s.status === 'summoned')),
  );
  const situational = [...scene.mods, ...magicModifiersFromState(state, rec)];
  const derived = deriveCharacter(rec.sheet, {
    situational,
    wounds: { physical: wounds.physical, stun: wounds.stun },
  });
  return {
    characterId: rec.id,
    name: rec.name,
    derived,
    situational,
    focusModifiers: focusModifiersFor(state, rec.id),
    foci: fociFor(state, rec.id),
    spirits,
    sustaining: report,
    reagents: reagentsFor(state, rec.id),
    activeSceneId: scene.sceneId,
  };
}

// ---------------------------------------------------------------------------
// The Fixer's read surface (FR12.17 `get_magic_state`)
// ---------------------------------------------------------------------------

export interface MagicTracker {
  spirits: Array<{
    id: string;
    name: string;
    spiritType: string;
    force: number;
    bound: boolean;
    services: number;
    servicesInitial: number;
    status: 'summoned' | 'dismissed';
    characterId: string | null;
    characterName: string | null;
    sustainingSpellId: string | null;
    combatantId: string | null;
    encounterId: string | null;
  }>;
  foci: Array<{
    id: string;
    characterId: string;
    characterName: string | null;
    name: string;
    kind: string;
    force: number;
    bonded: boolean;
    active: boolean;
    sourceKind: 'power' | 'spell';
  }>;
  reagents: Array<{ characterId: string; characterName: string | null; drams: number }>;
}

/**
 * Spirits, foci and reagents as tracked facts — the source behind the Fixer's
 * `get_magic_state` (`src/fixer/state-play.ts`), which no longer has to answer
 * "spirits are not tracked" now that they are.
 */
export async function getMagicTracker(db: Db, campaignId: string): Promise<MagicTracker> {
  const [state, rows] = await Promise.all([
    readMagicState(db, campaignId),
    db
      .select({ id: characters.id, name: characters.name })
      .from(characters)
      .where(eq(characters.campaignId, campaignId)),
  ]);
  const nameOf = new Map(rows.map((r) => [r.id, r.name]));
  return {
    spirits: state.spirits.map((s) => ({
      id: s.id,
      name: s.name,
      spiritType: s.spiritType,
      force: s.force,
      bound: s.bound,
      services: s.services,
      servicesInitial: s.servicesInitial,
      status: s.status,
      characterId: s.characterId,
      characterName: s.characterId ? (nameOf.get(s.characterId) ?? null) : null,
      sustainingSpellId: s.sustainingSpellId,
      combatantId: s.combatantId,
      encounterId: s.encounterId,
    })),
    foci: state.foci.map((f) => ({
      id: f.id,
      characterId: f.characterId,
      characterName: nameOf.get(f.characterId) ?? null,
      name: f.name,
      kind: f.kind,
      force: f.force,
      bonded: f.bonded,
      active: f.active,
      sourceKind: f.sourceKind,
    })),
    reagents: Object.entries(state.reagents).map(([characterId, drams]) => ({
      characterId,
      characterName: nameOf.get(characterId) ?? null,
      drams,
    })),
  };
}
