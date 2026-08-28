/**
 * Shared readers for the Fixer's live-state layer (FR12.17): jsonb parsing
 * helpers, the "is a session live?" question the situation snapshot hangs on
 * (FR12.18), and the campaign overview.
 *
 * Split out of state.ts to keep both files small; `./state.js` re-exports
 * everything here, so callers only ever import from there.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { SheetV1 } from '@safehouse/contracts';
import { CombatantMonitorsSchema, SheetV1Schema, StatusEffectSchema } from '@safehouse/contracts';
import {
  campaigns,
  characters,
  encounters,
  gameSessions,
  npcTemplates,
  scenes,
  type Db,
} from '@safehouse/db';
import { httpError } from '../services/auth.js';

export interface Wounds {
  physical: number;
  stun: number;
}

export const NO_WOUNDS: Wounds = { physical: 0, stun: 0 };

export function woundsOf(raw: unknown): Wounds {
  const parsed = CombatantMonitorsSchema.safeParse(raw);
  if (!parsed.success) return { ...NO_WOUNDS };
  return { physical: parsed.data.physical.filled, stun: parsed.data.stun.filled };
}

export function monitorsOf(raw: unknown): {
  physical: { max: number; filled: number };
  stun: { max: number; filled: number };
  overflow: { max: number; filled: number };
} | null {
  const parsed = CombatantMonitorsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function effectNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const parsed = StatusEffectSchema.safeParse(entry);
    if (parsed.success) out.push(parsed.data.name);
  }
  return out;
}

export function sheetOf(raw: unknown): SheetV1 | null {
  const parsed = SheetV1Schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Liveness + campaign overview
// ---------------------------------------------------------------------------

export async function liveSessionRow(db: Db, campaignId: string) {
  return (
    await db
      .select()
      .from(gameSessions)
      .where(and(eq(gameSessions.campaignId, campaignId), eq(gameSessions.state, 'live')))
      .limit(1)
  )[0];
}

export async function liveEncounterRow(db: Db, campaignId: string) {
  return (
    await db
      .select()
      .from(encounters)
      .where(and(eq(encounters.campaignId, campaignId), eq(encounters.state, 'live')))
      .orderBy(desc(encounters.createdAt))
      .limit(1)
  )[0];
}

export async function activeSceneRow(db: Db, campaignId: string) {
  return (
    await db
      .select()
      .from(scenes)
      .where(and(eq(scenes.campaignId, campaignId), eq(scenes.state, 'active')))
      .orderBy(desc(scenes.createdAt))
      .limit(1)
  )[0];
}

/** A session is "live" when the GM has one running, or a fight is on the table. */
export async function isSessionLive(db: Db, campaignId: string): Promise<boolean> {
  const [session, encounter] = await Promise.all([
    liveSessionRow(db, campaignId),
    liveEncounterRow(db, campaignId),
  ]);
  return session !== undefined || encounter !== undefined;
}

export interface CampaignState {
  id: string;
  name: string;
  ingameDate: string | null;
  settings: unknown;
  characters: number;
  npcTemplates: number;
  liveSession: { id: string; date: string | null } | null;
  liveEncounter: { id: string; name: string; turn: number; pass: number } | null;
  activeScene: { id: string; name: string } | null;
}

export async function getCampaignState(db: Db, campaignId: string): Promise<CampaignState> {
  const row = (await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1))[0];
  if (!row) throw httpError(404, 'not_found', 'unknown campaign');
  const [chars, npcs, session, encounter, scene] = await Promise.all([
    db.select({ id: characters.id }).from(characters).where(eq(characters.campaignId, campaignId)),
    db
      .select({ id: npcTemplates.id })
      .from(npcTemplates)
      .where(eq(npcTemplates.campaignId, campaignId)),
    liveSessionRow(db, campaignId),
    liveEncounterRow(db, campaignId),
    activeSceneRow(db, campaignId),
  ]);
  return {
    id: row.id,
    name: row.name,
    ingameDate: row.ingameDate,
    settings: row.settings,
    characters: chars.length,
    npcTemplates: npcs.length,
    liveSession: session ? { id: session.id, date: session.date } : null,
    liveEncounter: encounter
      ? { id: encounter.id, name: encounter.name, turn: encounter.turn, pass: encounter.pass }
      : null,
    activeScene: scene ? { id: scene.id, name: scene.name } : null,
  };
}
