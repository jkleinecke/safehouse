/**
 * The magic toolkit's stored shapes and its shelf (M8: FR8.3/FR8.4).
 *
 * Storage: **no new table.** Spirits, foci and reagent counters live under
 * `campaigns.settings.magic`, the same JSONB shelf the library bookmarks
 * (FR11.6) and the pinned timeline use. Everything is validated on the way in
 * *and* on the way out, so a hand-edited settings blob degrades to "no
 * spirits", never to a 500.
 *
 * Split from `services/magic.ts` (spirits) and `services/magic-foci.ts` (foci,
 * reagents, derivation) so nothing in the trio imports its own siblings in a
 * circle — both of those import this, and only this.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  ModifierSchema,
  RefSchema,
  SheetPowerSchema,
  SkillAttrSchema,
  type Role,
  type Visibility,
} from '@safehouse/contracts';
import { campaigns, type Db } from '@safehouse/db';
import type { Hub } from '../hub.js';
import { httpError } from './auth.js';
import { forgetCampaignSettings } from './discord.js';

const NonNegInt = z.number().int().min(0);
const ForceSchema = z.number().int().min(1).max(24);

export const SpiritSkillSchema = z.object({
  id: z.string().min(1).max(60),
  attr: SkillAttrSchema,
  /** Defaults to Force in the engine when absent. */
  rating: z.number().int().min(0).max(24).optional(),
});

export const SpiritRecordSchema = z.object({
  id: z.string().min(1),
  /** The summoner. `null` means a GM-side spirit (opposition) — never sent to players. */
  characterId: z.string().uuid().nullable().default(null),
  name: z.string().min(1).max(120),
  /** The GM's own label for the kind of spirit — the app ships no tables (§14). */
  spiritType: z.string().min(1).max(80),
  force: ForceSchema,
  bound: z.boolean().default(false),
  services: NonNegInt.max(999).default(0),
  servicesInitial: NonNegInt.max(999).default(0),
  /** Per-attribute offsets from Force, typed by the GM off their own book. */
  attributeOffsets: z.record(z.string(), z.number().int().min(-12).max(12)).default({}),
  skills: z.array(SpiritSkillSchema).max(24).default([]),
  initiativeDice: z.number().int().min(0).max(5).default(2),
  edge: z.number().int().min(0).max(24).optional(),
  powers: z.array(SheetPowerSchema).max(24).default([]),
  status: z.enum(['summoned', 'dismissed']).default('summoned'),
  /** Sustained-entry id this spirit is holding for its summoner (FR8.2). */
  sustainingSpellId: z.string().max(120).nullable().default(null),
  /** What the caster's own `exempt` toggle was before the spirit took over. */
  sustainPriorExempt: z.boolean().default(false),
  combatantId: z.string().nullable().default(null),
  encounterId: z.string().nullable().default(null),
  note: z.string().max(500).default(''),
  createdAt: z.string(),
});
export type SpiritRecord = z.infer<typeof SpiritRecordSchema>;

export const FocusRecordSchema = z.object({
  id: z.string().min(1),
  characterId: z.string().uuid(),
  name: z.string().min(1).max(120),
  kind: z.string().max(60).default(''),
  force: NonNegInt.max(12).default(1),
  /** Unbonded foci are inert however switched-on they look (FR8.4). */
  bonded: z.boolean().default(false),
  active: z.boolean().default(false),
  sourceKind: z.enum(['power', 'spell']).default('power'),
  targets: z.array(z.string().min(1).max(80)).max(12).default([]),
  mods: z.array(ModifierSchema).max(12).default([]),
  ref: RefSchema.optional(),
  note: z.string().max(300).default(''),
  createdAt: z.string(),
});
export type FocusRecord = z.infer<typeof FocusRecordSchema>;

export const MagicStateSchema = z.object({
  spirits: z.array(SpiritRecordSchema).default([]),
  foci: z.array(FocusRecordSchema).default([]),
  /** characterId → drams on hand. */
  reagents: z.record(z.string(), NonNegInt.max(99_999)).default({}),
});
export type MagicState = z.infer<typeof MagicStateSchema>;

export const EMPTY_MAGIC: MagicState = { spirits: [], foci: [], reagents: {} };

export const MAX_SPIRITS = 80;
export const MAX_FOCI = 60;

// ---------------------------------------------------------------------------
// The shelf
// ---------------------------------------------------------------------------

async function loadSettings(db: Db, campaignId: string): Promise<Record<string, unknown>> {
  const row = (
    await db
      .select({ settings: campaigns.settings })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1)
  )[0];
  if (!row) throw httpError(404, 'not_found', 'unknown campaign');
  return typeof row.settings === 'object' && row.settings !== null
    ? { ...(row.settings as Record<string, unknown>) }
    : {};
}

/** Read the magic state; a malformed blob reads as empty, never as an error. */
export async function readMagicState(db: Db, campaignId: string): Promise<MagicState> {
  const settings = await loadSettings(db, campaignId);
  const parsed = MagicStateSchema.safeParse(settings['magic'] ?? {});
  return parsed.success ? parsed.data : EMPTY_MAGIC;
}

/** Merge the magic subtree back without touching the rest of `settings`. */
export async function writeMagicState(
  db: Db,
  campaignId: string,
  next: MagicState,
): Promise<MagicState> {
  const settings = await loadSettings(db, campaignId);
  settings['magic'] = next;
  await db.update(campaigns).set({ settings }).where(eq(campaigns.id, campaignId));
  // The roll path caches campaign settings for 15s (services/discord.ts).
  forgetCampaignSettings(campaignId);
  return next;
}

export function newMagicId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Views and events: hidden state filtered SERVER-SIDE (Principle 4)
// ---------------------------------------------------------------------------

/**
 * A GM-side spirit (no summoner) is opposition and never reaches a player
 * socket or a player's GET — dropped here, not hidden in the client.
 */
export function magicStateForViewer(state: MagicState, role: Role): MagicState {
  if (role === 'gm') return state;
  return { ...state, spirits: state.spirits.filter((s) => s.characterId !== null) };
}

export function spiritVisibility(spirit: Pick<SpiritRecord, 'characterId'>): Visibility {
  return spirit.characterId === null ? 'gm' : 'public';
}

/**
 * Write the magic shelf and announce it as `magic.updated` in ONE transaction
 * (§11 is open-ended about the type; §6.2 is not open-ended about the fate).
 *
 * This replaces the old `writeMagicState(db, …)` + `announceMagic(hub, …)`
 * pair, which was the last emit of the LIVE-4 sweep still sequenced by its
 * callers: two statements, so a fault between them left a spirit's service
 * counter (or a focus, or a reagent count) moved in `campaigns.settings.magic`
 * with no frame on the wire, and every open client drawing the old count until
 * someone refetched. `services/magic.ts` and `services/magic-foci.ts` now call
 * only this; the sole survivor of the bare `writeMagicState` is `magic.ts`'s
 * quiet arm (`setSpiritSustaining`, `opts.quiet`), because a write that
 * announces nothing has nothing to be inconsistent with.
 *
 * The `settings` read is hoisted OUT of the block on purpose: PGlite is a
 * single embedded connection, so a query through `db` while the transaction is
 * open waits forever (the deadlock rule on `Hub.atomic`).
 */
export async function commitMagicState(
  db: Db,
  hub: Hub,
  campaignId: string,
  next: MagicState,
  announce: { payload: Record<string, unknown>; visibility?: Visibility },
): Promise<MagicState> {
  const settings = await loadSettings(db, campaignId);
  settings['magic'] = next;
  await hub.atomic(campaignId, async (tx) => {
    await tx.db.update(campaigns).set({ settings }).where(eq(campaigns.id, campaignId));
    await tx.emit({
      type: 'magic.updated',
      payload: announce.payload,
      visibility: announce.visibility ?? 'public',
    });
  });
  // The roll path caches campaign settings for 15s (services/discord.ts).
  forgetCampaignSettings(campaignId);
  return next;
}

// ---------------------------------------------------------------------------
// Small readers shared by both halves
// ---------------------------------------------------------------------------

export function requireSpirit(state: MagicState, spiritId: string): SpiritRecord {
  const spirit = state.spirits.find((s) => s.id === spiritId);
  if (!spirit) throw httpError(404, 'not_found', 'unknown spirit');
  return spirit;
}

export function replaceSpirit(state: MagicState, next: SpiritRecord): MagicState {
  return { ...state, spirits: state.spirits.map((s) => (s.id === next.id ? next : s)) };
}

export function fociFor(state: MagicState, characterId: string): FocusRecord[] {
  return state.foci.filter((f) => f.characterId === characterId);
}

export function reagentsFor(state: MagicState, characterId: string): number {
  return state.reagents[characterId] ?? 0;
}

/** Live spirits a character summoned — the ones that can be holding a spell. */
export function spiritsOf(state: MagicState, characterId: string): SpiritRecord[] {
  return state.spirits.filter((s) => s.characterId === characterId);
}
