/**
 * Spirit tracker (M8 / FR8.3) — and the single import point for the magic
 * toolkit's server half.
 *
 * A summoned spirit used to be a line in a note: Force, type, and a services
 * tally the summoner kept on paper. Here it is a tracked thing —
 *
 * - **Force, type, bound/unbound, services remaining**, with a one-tap spend
 *   that floors at zero and logs what it was told to do;
 * - **a combatant**, when it joins a fight: the stat block handed to the
 *   tracker is `spiritSheet(profile)`, a real `SheetV1`, so `addCombatant`
 *   derives initiative, monitors and pools through the ordinary engine and the
 *   row behaves like every other combatant afterwards (no second write path);
 * - **a sustainer**: a spirit holding a spell for its summoner drives the same
 *   `exempt` toggle FR8.2 already uses for foci and quickenings, so there is
 *   exactly one answer to "does this caster eat the −2".
 *
 * No book data (§14): a spirit is a GM-typed `type` label, a Force, and
 * optional per-attribute offsets. With no offsets every attribute is exactly
 * Force. What the engine supplies is the mechanic, never anyone's stat block.
 *
 * Foci, reagents and the derive-with-magic view live in `magic-foci.ts`; the
 * stored shapes and the `campaigns.settings.magic` shelf in `magic-store.ts`.
 * Both are re-exported here, so callers import from `services/magic.js` only.
 */
import { z } from 'zod';
import {
  ATTRIBUTE_CODES,
  SheetPowerSchema,
  type AttributeCode,
  type Combatant,
  type DerivedCharacter,
  type InitKind,
  type Visibility,
} from '@safehouse/contracts';
import {
  deriveSpirit,
  grantServices,
  setServices,
  spendServices,
  spiritSheet,
  type SpiritProfile,
} from '@safehouse/rules';
import type { Db } from '@safehouse/db';
import type { Hub } from '../hub.js';
import { httpError } from './auth.js';
import { requireCharacter, saveCharacter } from './characters.js';
import { applySustainedOp } from './character-play.js';
import { EncountersService } from './encounters.js';
import {
  commitMagicState,
  MAX_SPIRITS,
  newMagicId,
  readMagicState,
  replaceSpirit,
  requireSpirit,
  SpiritRecordSchema,
  SpiritSkillSchema,
  spiritVisibility,
  writeMagicState,
  type SpiritRecord,
} from './magic-store.js';

export * from './magic-store.js';
export * from './magic-foci.js';

// ---------------------------------------------------------------------------
// Spirit → engine profile
// ---------------------------------------------------------------------------

/** A stored spirit as the engine's profile — Force in, derived stats out. */
export function spiritProfileOf(rec: SpiritRecord): SpiritProfile {
  const offsets: Partial<Record<AttributeCode, number>> = {};
  for (const code of ATTRIBUTE_CODES) {
    const value = rec.attributeOffsets[code];
    if (typeof value === 'number') offsets[code] = value;
  }
  return {
    name: rec.name,
    type: rec.spiritType,
    force: rec.force,
    attributeOffsets: offsets,
    skills: rec.skills,
    initiativeDice: rec.initiativeDice,
    ...(rec.edge !== undefined ? { edge: rec.edge } : {}),
    powers: rec.powers,
    ...(rec.note ? { notes: rec.note } : {}),
  };
}

/** Full engine derivation for one spirit — pools, monitors, initiative, receipts. */
export function deriveSpiritRecord(rec: SpiritRecord): DerivedCharacter {
  return deriveSpirit(spiritProfileOf(rec));
}

// ---------------------------------------------------------------------------
// Summon / edit / dismiss
// ---------------------------------------------------------------------------

export interface SummonSpiritInput {
  characterId?: string | null;
  name?: string;
  spiritType: string;
  force: number;
  bound?: boolean;
  services?: number;
  attributeOffsets?: Record<string, number>;
  skills?: Array<z.input<typeof SpiritSkillSchema>>;
  initiativeDice?: number;
  edge?: number;
  powers?: Array<z.input<typeof SheetPowerSchema>>;
  note?: string;
}

export async function summonSpirit(
  db: Db,
  hub: Hub,
  campaignId: string,
  input: SummonSpiritInput,
): Promise<SpiritRecord> {
  const state = await readMagicState(db, campaignId);
  if (state.spirits.length >= MAX_SPIRITS) {
    throw httpError(409, 'too_many_spirits', `a campaign tracks at most ${MAX_SPIRITS} spirits`);
  }
  const services = Math.max(0, Math.trunc(input.services ?? 0));
  const spirit = SpiritRecordSchema.parse({
    id: newMagicId('spirit'),
    characterId: input.characterId ?? null,
    name: input.name?.trim() || `${input.spiritType} spirit (Force ${input.force})`,
    spiritType: input.spiritType,
    force: input.force,
    bound: input.bound ?? false,
    services,
    servicesInitial: services,
    attributeOffsets: input.attributeOffsets ?? {},
    skills: input.skills ?? [],
    initiativeDice: input.initiativeDice ?? 2,
    ...(input.edge !== undefined ? { edge: input.edge } : {}),
    powers: input.powers ?? [],
    note: input.note ?? '',
    createdAt: new Date().toISOString(),
  });
  // The shelf and the frame that draws it, one fate (§6.2): a spirit stored
  // with nobody told is one the GM summons a second time.
  await commitMagicState(
    db,
    hub,
    campaignId,
    { ...state, spirits: [...state.spirits, spirit] },
    { payload: { op: 'spirit.summoned', spirit }, visibility: spiritVisibility(spirit) },
  );
  return spirit;
}

export interface SpiritPatch {
  name?: string;
  spiritType?: string;
  force?: number;
  bound?: boolean;
  attributeOffsets?: Record<string, number>;
  skills?: Array<z.input<typeof SpiritSkillSchema>>;
  initiativeDice?: number;
  edge?: number;
  powers?: Array<z.input<typeof SheetPowerSchema>>;
  note?: string;
  status?: 'summoned' | 'dismissed';
}

/**
 * Hand-edit anything about a spirit (Principle 2 — the GM always wins).
 *
 * Setting `status: 'dismissed'` here goes through {@link dismissSpirit}, so a
 * spirit can never end up dismissed while the caster's sheet still believes it
 * is holding a spell up.
 */
export async function patchSpirit(
  db: Db,
  hub: Hub,
  campaignId: string,
  spiritId: string,
  patch: SpiritPatch,
): Promise<SpiritRecord> {
  const state = await readMagicState(db, campaignId);
  const current = requireSpirit(state, spiritId);
  if (patch.status === 'dismissed' && current.status !== 'dismissed') {
    const { status: _dropped, ...rest } = patch;
    if (Object.keys(rest).length > 0) {
      await patchSpirit(db, hub, campaignId, spiritId, rest);
    }
    return dismissSpirit(db, hub, campaignId, spiritId);
  }
  const next = SpiritRecordSchema.parse({ ...current, ...patch });
  await commitMagicState(db, hub, campaignId, replaceSpirit(state, next), {
    payload: { op: 'spirit.updated', spirit: next },
    visibility: spiritVisibility(next),
  });
  return next;
}

// ---------------------------------------------------------------------------
// Services (the one-tap countdown)
// ---------------------------------------------------------------------------

export interface ServiceOpInput {
  op?: 'spend' | 'grant' | 'set';
  count?: number;
  reason?: string;
}

export interface ServiceOpResult {
  spirit: SpiritRecord;
  spent: number;
  /** Asked-for minus spent: the summoner wanted more than the spirit owed. */
  shortfall: number;
  remaining: number;
  exhausted: boolean;
}

/**
 * One-tap "spend a service" (FR8.3). The counter floors at zero — asking for
 * more than remain is reported as a shortfall, never borrowed — and every
 * change is announced so the log carries what the spirit was told to do.
 */
export async function spiritServiceOp(
  db: Db,
  hub: Hub,
  campaignId: string,
  spiritId: string,
  input: ServiceOpInput,
): Promise<ServiceOpResult> {
  const state = await readMagicState(db, campaignId);
  const current = requireSpirit(state, spiritId);
  const before = { remaining: current.services, initial: current.servicesInitial };
  const op = input.op ?? 'spend';
  const count = input.count ?? 1;
  const change =
    op === 'grant'
      ? grantServices(before, count)
      : op === 'set'
        ? setServices(before, count)
        : spendServices(before, count);
  const next = SpiritRecordSchema.parse({
    ...current,
    services: change.after.remaining,
    servicesInitial: change.after.initial,
  });
  // A service is a spent resource: the counter and the announcement go
  // together or the table argues about how many are left (§6.2).
  await commitMagicState(db, hub, campaignId, replaceSpirit(state, next), {
    payload: {
      op: `spirit.service.${op}`,
      spirit: next,
      spent: change.spent,
      shortfall: change.shortfall,
      remaining: change.after.remaining,
      reason: input.reason ?? '',
    },
    visibility: spiritVisibility(next),
  });
  return {
    spirit: next,
    spent: change.spent,
    shortfall: change.shortfall,
    remaining: change.after.remaining,
    exhausted: change.exhausted,
  };
}

/**
 * Dismiss a spirit: it releases anything it was sustaining (the caster picks
 * the −2 back up) and stops being live. The combatant row it drove is left
 * alone — removing a row mid-fight is the encounter service's call, not ours.
 */
export async function dismissSpirit(
  db: Db,
  hub: Hub,
  campaignId: string,
  spiritId: string,
): Promise<SpiritRecord> {
  const released = await setSpiritSustaining(db, hub, campaignId, spiritId, null, { quiet: true });
  const state = await readMagicState(db, campaignId);
  const current = state.spirits.find((s) => s.id === released.id) ?? released;
  const next = SpiritRecordSchema.parse({
    ...current,
    status: 'dismissed',
    sustainingSpellId: null,
  });
  await commitMagicState(db, hub, campaignId, replaceSpirit(state, next), {
    payload: { op: 'spirit.dismissed', spirit: next },
    visibility: spiritVisibility(next),
  });
  return next;
}

// ---------------------------------------------------------------------------
// A spirit sustaining for its summoner (FR8.2 × FR8.3)
// ---------------------------------------------------------------------------

/**
 * Hand a sustained spell to a spirit, or take it back.
 *
 * This drives the SAME `exempt` toggle the focus/quickening case uses, so
 * every pool that already understood FR8.2 understands this for free. Taking
 * the spell back restores whatever the toggle was before the spirit picked it
 * up — a spell that was already focus-exempt stays exempt.
 */
export async function setSpiritSustaining(
  db: Db,
  hub: Hub,
  campaignId: string,
  spiritId: string,
  sustainedId: string | null,
  opts?: { quiet?: boolean },
): Promise<SpiritRecord> {
  const state = await readMagicState(db, campaignId);
  const current = requireSpirit(state, spiritId);
  if (sustainedId !== null && current.status === 'dismissed') {
    throw httpError(409, 'spirit_dismissed', 'a dismissed spirit cannot sustain a spell');
  }
  if (!current.characterId) {
    if (sustainedId === null) return current;
    throw httpError(400, 'bad_request', 'only a spirit with a summoner can sustain for them');
  }
  const rec = await requireCharacter(db, current.characterId);

  let priorExempt = false;
  let play = rec.play;
  // Release the old assignment first, restoring the caster's own toggle.
  if (current.sustainingSpellId && play.sustained.some((s) => s.id === current.sustainingSpellId)) {
    play = applySustainedOp(play, {
      op: 'toggle',
      id: current.sustainingSpellId,
      exempt: current.sustainPriorExempt,
    });
  }
  if (sustainedId !== null) {
    const target = play.sustained.find((s) => s.id === sustainedId);
    if (!target) throw httpError(404, 'not_found', 'the caster is not sustaining that spell');
    priorExempt = target.exempt;
    play = applySustainedOp(play, { op: 'toggle', id: sustainedId, exempt: true });
  }
  await saveCharacter(db, rec.id, { sheet: rec.sheet, play });

  const next = SpiritRecordSchema.parse({
    ...current,
    sustainingSpellId: sustainedId,
    sustainPriorExempt: priorExempt,
  });
  // The quiet arm keeps the bare write: `dismissSpirit` calls it to release the
  // spell and then announces the dismissal itself, and a write that announces
  // nothing has nothing to be inconsistent with (§6.2).
  const shelf = replaceSpirit(state, next);
  if (opts?.quiet) {
    await writeMagicState(db, campaignId, shelf);
  } else {
    await commitMagicState(db, hub, campaignId, shelf, {
      payload: {
        op: 'spirit.sustaining',
        spirit: next,
        characterId: rec.id,
        sustained: play.sustained,
      },
      visibility: spiritVisibility(next),
    });
  }
  return next;
}

// ---------------------------------------------------------------------------
// A spirit as a combatant (FR8.3 → M4)
// ---------------------------------------------------------------------------

export interface SpiritJoinInput {
  encounterId: string;
  initKind?: InitKind;
  visibility?: Visibility;
  tokenId?: string | null;
}

/**
 * Put a spirit in the fight through the encounters service's own
 * `addCombatant` — the stat block is a real `SheetV1`, so its initiative,
 * monitors and pools are derived by the ordinary engine path and carry the
 * same provenance as everything else on the tracker.
 */
export async function spiritJoinsEncounter(
  db: Db,
  hub: Hub,
  campaignId: string,
  spiritId: string,
  input: SpiritJoinInput,
): Promise<{ spirit: SpiritRecord; combatant: Combatant }> {
  const state = await readMagicState(db, campaignId);
  const current = requireSpirit(state, spiritId);
  if (current.status === 'dismissed') {
    throw httpError(409, 'spirit_dismissed', 'a dismissed spirit cannot join an encounter');
  }
  const encounters = new EncountersService(db, hub);
  const encounter = await encounters.getEncounter(input.encounterId);
  if (encounter.campaignId !== campaignId) {
    throw httpError(400, 'bad_request', 'that encounter belongs to another campaign');
  }
  const combatant = await encounters.addCombatant(input.encounterId, {
    source: 'manual',
    name: current.name,
    sheet: spiritSheet(spiritProfileOf(current)),
    initKind: input.initKind ?? 'physical',
    visibility: input.visibility ?? spiritVisibility(current),
    tokenId: input.tokenId ?? null,
  });
  // Re-read: addCombatant wrote rows of its own, and the shelf is read-modify-write.
  const after = await readMagicState(db, campaignId);
  const next = SpiritRecordSchema.parse({
    ...requireSpirit(after, spiritId),
    combatantId: combatant.id,
    encounterId: input.encounterId,
  });
  await commitMagicState(db, hub, campaignId, replaceSpirit(after, next), {
    payload: {
      op: 'spirit.joined',
      spirit: next,
      combatantId: combatant.id,
      encounterId: input.encounterId,
    },
    visibility: spiritVisibility(next),
  });
  return { spirit: next, combatant };
}
