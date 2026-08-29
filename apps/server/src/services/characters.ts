/**
 * Character service (M3): the shared load/save/derive layer behind
 * `plugins/characters.ts` and the Fixer's `get_character` tool (FR12.17).
 *
 * Two pieces of state live on a character row:
 *
 * - the **sheet** (`SheetV1`, DESIGN.md §9.3) — every accepted mutation
 *   snapshots into `character_revisions` (FR3.8);
 * - the **live-play state** (FR3.4) — filled monitor boxes, per-weapon
 *   progressive recoil, sustained spells, burned Edge. It is stored under the
 *   `play` key of the same JSONB column (the schema is owned by @safehouse/db
 *   and has no column for it) and is deliberately NOT snapshotted: revisions
 *   are about the character, not about this turn's bruises.
 *
 * Derivation always runs through `@safehouse/rules.deriveCharacter` so the
 * server's numbers are the numbers the table sees, with provenance
 * (Principle 3). Live wounds come from the character's own monitors or, when
 * the character is in a running encounter, from that combatant row.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  SceneEnvironmentSchema,
  SheetV1Schema,
  type CombatantMonitors,
  type DerivedCharacter,
  type Modifier,
  type SheetV1,
} from '@safehouse/contracts';
import { deriveCharacter, environment } from '@safehouse/rules';
import {
  characterRevisions,
  characters,
  combatants,
  encounters,
  scenes,
  type Db,
} from '@safehouse/db';
import { z } from 'zod';
import { httpError, type AuthContext } from './auth.js';
// Leaf module (it reaches @safehouse/rules and magic-store, never back here),
// so folding the magic pipeline in below closes no import cycle.
import { magicSituationalFor, sustainedModifiersFor } from './magic-derive.js';

// ---------------------------------------------------------------------------
// Live-play state (FR3.4)
// ---------------------------------------------------------------------------

const NonNegInt = z.number().int().min(0);

export const SustainedSpellSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Sustained by a focus or quickening — no −2 (FR8.2). */
  exempt: z.boolean().default(false),
});
export type SustainedSpell = z.infer<typeof SustainedSpellSchema>;

/** Filled boxes per monitor; sizes come from derivation. */
export const PlayMonitorsSchema = z.object({
  physical: NonNegInt.default(0),
  stun: NonNegInt.default(0),
  overflow: NonNegInt.default(0),
});

export const PlayStateSchema = z.object({
  monitors: PlayMonitorsSchema.default({ physical: 0, stun: 0, overflow: 0 }),
  /** Progressive recoil counter per weapon name (FR3.4). */
  recoil: z.record(z.string(), NonNegInt).default({}),
  sustained: z.array(SustainedSpellSchema).default([]),
  /** Edge burned permanently — the loud action (FR2.3). */
  edgeBurned: NonNegInt.default(0),
});
export type PlayState = z.infer<typeof PlayStateSchema>;

export const EMPTY_PLAY: PlayState = PlayStateSchema.parse({});

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface CharacterRecord {
  id: string;
  campaignId: string;
  ownerUserId: string | null;
  name: string;
  status: string;
  sheet: SheetV1;
  play: PlayState;
  sheetVersion: number;
  hasChummerBlob: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Split a stored sheet JSONB into the validated sheet + live-play state. */
export function splitStoredSheet(raw: unknown): { sheet: SheetV1; play: PlayState } {
  const record = (raw ?? {}) as Record<string, unknown>;
  const parsed = SheetV1Schema.safeParse(record);
  if (!parsed.success) {
    throw httpError(500, 'sheet_invalid', 'stored sheet failed validation', parsed.error.issues);
  }
  const play = PlayStateSchema.safeParse(record['play'] ?? {});
  return { sheet: parsed.data, play: play.success ? play.data : EMPTY_PLAY };
}

function toRecord(row: typeof characters.$inferSelect): CharacterRecord {
  const { sheet, play } = splitStoredSheet(row.sheet);
  return {
    id: row.id,
    campaignId: row.campaignId,
    ownerUserId: row.ownerUserId,
    name: row.name,
    status: row.status,
    sheet,
    play,
    sheetVersion: row.sheetVersion,
    hasChummerBlob: row.chummerBlob != null && row.chummerBlob.length > 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadCharacter(db: Db, id: string): Promise<CharacterRecord | null> {
  const rows = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  const row = rows[0];
  return row ? toRecord(row) : null;
}

/** Load or 404. */
export async function requireCharacter(db: Db, id: string): Promise<CharacterRecord> {
  const rec = await loadCharacter(db, id);
  if (!rec) throw httpError(404, 'not_found', 'unknown character');
  return rec;
}

export async function listCharacters(db: Db, campaignId: string): Promise<CharacterRecord[]> {
  const rows = await db.select().from(characters).where(eq(characters.campaignId, campaignId));
  return rows.map(toRecord);
}

/** Persist sheet + play state as one JSONB write (`play` rides along). */
export async function saveCharacter(
  db: Db,
  id: string,
  patch: { sheet: SheetV1; play: PlayState; name?: string; status?: string },
): Promise<void> {
  await db
    .update(characters)
    .set({
      sheet: { ...patch.sheet, play: patch.play },
      updatedAt: new Date(),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    })
    .where(eq(characters.id, id));
}

// ---------------------------------------------------------------------------
// Revisions (FR3.8)
// ---------------------------------------------------------------------------

export interface RevisionSummary {
  seq: number;
  cause: string;
  createdBy: string | null;
  createdAt: string;
}

/** Snapshot the sheet (never the play state) as the next revision. */
export async function recordRevision(
  db: Db,
  input: { characterId: string; sheet: SheetV1; cause: string; createdBy?: string | null },
): Promise<number> {
  const rows = await db
    .select({ maxSeq: sql<number>`coalesce(max(${characterRevisions.seq}), 0)::int` })
    .from(characterRevisions)
    .where(eq(characterRevisions.characterId, input.characterId));
  const seq = (rows[0]?.maxSeq ?? 0) + 1;
  await db.insert(characterRevisions).values({
    characterId: input.characterId,
    seq,
    sheet: input.sheet,
    cause: input.cause,
    createdBy: input.createdBy ?? null,
  });
  return seq;
}

export async function listRevisions(db: Db, characterId: string): Promise<RevisionSummary[]> {
  const rows = await db
    .select({
      seq: characterRevisions.seq,
      cause: characterRevisions.cause,
      createdBy: characterRevisions.createdBy,
      createdAt: characterRevisions.createdAt,
    })
    .from(characterRevisions)
    .where(eq(characterRevisions.characterId, characterId))
    .orderBy(characterRevisions.seq);
  return rows.map((r) => ({
    seq: r.seq,
    cause: r.cause,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getRevisionSheet(
  db: Db,
  characterId: string,
  seq: number,
): Promise<SheetV1 | null> {
  const rows = await db
    .select({ sheet: characterRevisions.sheet })
    .from(characterRevisions)
    .where(and(eq(characterRevisions.characterId, characterId), eq(characterRevisions.seq, seq)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const parsed = SheetV1Schema.safeParse(row.sheet);
  if (!parsed.success) {
    throw httpError(500, 'revision_invalid', `revision ${seq} failed validation`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Access (§13 capability matrix)
// ---------------------------------------------------------------------------

/** Members of the campaign may read a character; the device must be bound to it. */
export function assertCanView(auth: AuthContext, rec: CharacterRecord): void {
  if (auth.campaignId !== rec.campaignId) {
    throw httpError(403, 'forbidden', 'device is not bound to this campaign');
  }
}

/** Owner or GM may mutate (FR3.5: overrides are owner-or-GM, flagged). */
export function assertCanEdit(auth: AuthContext, rec: CharacterRecord): void {
  assertCanView(auth, rec);
  const isOwner = rec.ownerUserId != null && rec.ownerUserId === auth.userId;
  if (auth.role !== 'gm' && !isOwner) {
    throw httpError(403, 'forbidden', 'only the owner or the GM may change this character');
  }
}

// ---------------------------------------------------------------------------
// Derivation with live state (FR3.3/FR3.4/FR9.11)
// ---------------------------------------------------------------------------

/**
 * −2 dice per sustained spell, focus/quickening exempt (FR8.2, §10.2).
 *
 * The composition itself lives in `magic-derive.ts` so the magic tab, the roll
 * path and this one cannot drift apart; this stays as the `PlayState`-shaped
 * front door its existing callers use.
 */
export function sustainedModifiers(play: PlayState): Modifier[] {
  return sustainedModifiersFor(play.sustained);
}

/** The campaign's active scene, if any — its environment feeds every pool. */
export async function activeSceneModifiers(
  db: Db,
  campaignId: string,
): Promise<{ sceneId: string | null; sceneName: string | null; mods: Modifier[] }> {
  const rows = await db
    .select({ id: scenes.id, name: scenes.name, environment: scenes.environment })
    .from(scenes)
    .where(and(eq(scenes.campaignId, campaignId), eq(scenes.state, 'active')))
    .limit(1);
  const row = rows[0];
  if (!row) return { sceneId: null, sceneName: null, mods: [] };
  const env = SceneEnvironmentSchema.safeParse(row.environment ?? {});
  return {
    sceneId: row.id,
    sceneName: row.name,
    mods: env.success ? environment(env.data) : [],
  };
}

export interface LiveWounds {
  physical: number;
  stun: number;
  overflow: number;
  source: 'character' | 'combatant';
  combatantId: string | null;
  encounterId: string | null;
}

/**
 * Current filled boxes: the live combatant row when this character is in a
 * running encounter (the tracker is authoritative mid-fight), else the
 * character's own play state.
 */
export async function liveWounds(db: Db, rec: CharacterRecord): Promise<LiveWounds> {
  const rows = await db
    .select({ id: combatants.id, encounterId: combatants.encounterId, monitors: combatants.monitors })
    .from(combatants)
    .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
    .where(
      and(
        eq(encounters.campaignId, rec.campaignId),
        eq(encounters.state, 'live'),
        eq(combatants.sourceId, rec.id),
      ),
    )
    .limit(1);
  const row = rows[0];
  const monitors = row?.monitors as
    | { physical?: { filled?: number }; stun?: { filled?: number }; overflow?: { filled?: number } }
    | undefined;
  if (row && monitors && typeof monitors === 'object') {
    return {
      physical: Math.max(0, Math.trunc(monitors.physical?.filled ?? 0)),
      stun: Math.max(0, Math.trunc(monitors.stun?.filled ?? 0)),
      overflow: Math.max(0, Math.trunc(monitors.overflow?.filled ?? 0)),
      source: 'combatant',
      combatantId: row.id,
      encounterId: row.encounterId,
    };
  }
  return {
    physical: rec.play.monitors.physical,
    stun: rec.play.monitors.stun,
    overflow: rec.play.monitors.overflow,
    source: 'character',
    combatantId: null,
    encounterId: null,
  };
}

export interface DerivedView {
  characterId: string;
  name: string;
  derived: DerivedCharacter;
  /** Sizes from derivation + live filled boxes (what the widgets render). */
  monitors: CombatantMonitors;
  wounds: { physical: number; stun: number; overflow: number };
  woundSource: 'character' | 'combatant';
  encounterId: string | null;
  combatantId: string | null;
  edge: { max: number; current: number; burned: number };
  /**
   * Scene environment + sustaining + live foci — the modifiers actually
   * applied, in the order the pipeline saw them (Principle 3).
   */
  situational: Modifier[];
  activeSceneId: string | null;
  sustained: SustainedSpell[];
  recoil: Record<string, number>;
  ammo: Record<string, { cap: number; current: number }>;
  /** Flagged manual overrides in effect (FR3.5). */
  overrides: Modifier[];
}

/**
 * GET /api/characters/:id/derived — the whole live-play picture (FR3.3/3.4).
 *
 * The magic half (sustaining with spirit exemptions resolved, plus every
 * bonded-and-active focus) comes from the same composer the Magic tab and the
 * roll path use, so flipping a focus moves this pool too and names itself in
 * the provenance (FR8.4).
 */
export async function deriveView(db: Db, rec: CharacterRecord): Promise<DerivedView> {
  const [scene, magic] = await Promise.all([
    activeSceneModifiers(db, rec.campaignId),
    magicSituationalFor(db, rec.campaignId, rec.id, rec.play.sustained),
  ]);
  const situational = [...scene.mods, ...magic];
  const wounds = await liveWounds(db, rec);
  const derived = deriveCharacter(rec.sheet, {
    situational,
    wounds: { physical: wounds.physical, stun: wounds.stun },
  });
  const ammo: Record<string, { cap: number; current: number }> = {};
  for (const weapon of rec.sheet.weapons) {
    if (weapon.ammo) ammo[weapon.name] = { cap: weapon.ammo.cap, current: weapon.ammo.current };
  }
  return {
    characterId: rec.id,
    name: rec.name,
    derived,
    monitors: {
      physical: { max: derived.monitors.physical.value, filled: wounds.physical },
      stun: { max: derived.monitors.stun.value, filled: wounds.stun },
      overflow: { max: derived.monitors.overflow.value, filled: wounds.overflow },
    },
    wounds: { physical: wounds.physical, stun: wounds.stun, overflow: wounds.overflow },
    woundSource: wounds.source,
    encounterId: wounds.encounterId,
    combatantId: wounds.combatantId,
    edge: {
      max: rec.sheet.attributes.edg.max,
      current: rec.sheet.attributes.edg.current,
      burned: rec.play.edgeBurned,
    },
    situational,
    activeSceneId: scene.sceneId,
    sustained: rec.play.sustained,
    recoil: rec.play.recoil,
    ammo,
    overrides: rec.sheet.overrides.filter((m) => m.source.kind === 'override'),
  };
}

/** The character DTO returned by CRUD routes (balances come from the ledger). */
export function characterDto(
  rec: CharacterRecord,
  balances: { karma: number; nuyen: number },
): Record<string, unknown> {
  return {
    id: rec.id,
    campaignId: rec.campaignId,
    ownerUserId: rec.ownerUserId,
    name: rec.name,
    status: rec.status,
    sheetVersion: rec.sheetVersion,
    sheet: rec.sheet,
    play: rec.play,
    /** FR3.6: karma/nuyen are ledger sums — never free-floating sheet numbers. */
    balances,
    hasChummerBlob: rec.hasChummerBlob,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
