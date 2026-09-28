/**
 * The fight is the map: placed tokens join the scene's fight, deleted ones leave,
 * and rows follow their tokens on and off the table. All in the caller's transaction.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Visibility } from '@safehouse/contracts';
import { combatants, encounters, type Db } from '@safehouse/db';
import type { EventTx } from '../hub.js';
import { emitFightFrames, tableVisibility } from './encounters.js';
import { fightsOnMap, ScenesService, type SceneRow } from './scenes.js';

type EncounterRow = typeof encounters.$inferSelect;

const OPEN: Array<EncounterRow['state']> = ['prep', 'live'];

/** The scene's fight: its live one, else its newest prep. */
export async function sceneFight(db: Db, sceneId: string): Promise<EncounterRow | undefined> {
  const rows = await db
    .select()
    .from(encounters)
    .where(and(eq(encounters.sceneId, sceneId), inArray(encounters.state, OPEN)))
    .orderBy(desc(encounters.createdAt));
  return rows.find((r) => r.state === 'live') ?? rows[0];
}

/** The join line: mid-turn it says what the roll loses (p.160). */
export function joinText(name: string, fight: string, passesGone?: number): string {
  if (passesGone === undefined) return `${name} joins ${fight}`;
  if (passesGone === 0) return `${name} joins ${fight} mid-turn: roll Initiative (p.160)`;
  const passes = passesGone === 1 ? '1 pass' : `${passesGone} passes`;
  return `${name} joins ${fight} mid-turn: roll Initiative, −${10 * passesGone} for ${passes} gone (p.160)`;
}

/** A fighting token placed or flagged joins the scene's fight; the log line takes the token's visibility. */
export async function joinFight(
  tx: EventTx,
  scene: SceneRow,
  token: { id: string; source: string; combatant?: boolean | undefined },
  visibility: Visibility,
): Promise<void> {
  if (!fightsOnMap(token)) return;
  const fight = await sceneFight(tx.db, scene.id);
  if (!fight) return;
  const out = await new ScenesService(tx.db).stageEncounter(scene, { encounterId: fight.id, tokenIds: [token.id] });
  if (out.combatantIds.length === 0 && out.linkedIds.length === 0) return;
  await emitFightFrames(tx, fight, 'combatant.joined');
  for (const j of out.joined) {
    await tx.emit({
      type: 'log.posted',
      payload: {
        kind: 'fight',
        encounterId: fight.id,
        combatantId: j.combatantId,
        tokenId: j.tokenId,
        text: joinText(j.name, fight.name, j.passesGone),
      },
      // A prep fight's name is the GM's.
      visibility: fight.state === 'live' ? visibility : 'gm',
    });
  }
}

/**
 * A deleted token's rows: in a live fight the row stays, tokenless, damage and exchanges kept;
 * in a prep fight it goes. Call before the token row goes.
 */
export async function leaveFight(tx: EventTx, tokenId: string, visibility: Visibility): Promise<void> {
  const rows = await tx.db
    .select({ row: combatants, fight: encounters })
    .from(combatants)
    .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
    .where(and(eq(combatants.tokenId, tokenId), inArray(encounters.state, OPEN)));
  if (rows.length === 0) return;
  const kept = rows.filter((r) => r.fight.state === 'live');
  const gone = rows.filter((r) => r.fight.state !== 'live');
  // Seen as the table sees it now, so the row neither appears nor vanishes with its token.
  const onTable = await new ScenesService(tx.db).tokensOnTable([tokenId]);
  for (const { row } of kept) {
    await tx.db
      .update(combatants)
      .set({
        tokenId: null,
        visibility: tableVisibility(row, onTable),
        copilot: sql`${combatants.copilot} || '{"tokenRemoved":true}'::jsonb`,
      })
      .where(eq(combatants.id, row.id));
  }
  if (gone.length > 0) await tx.db.delete(combatants).where(inArray(combatants.id, gone.map((r) => r.row.id)));
  const fights = new Map(rows.map((r) => [r.fight.id, r.fight]));
  for (const fight of fights.values()) {
    await emitFightFrames(tx, fight, fight.state === 'live' ? 'combatant.unlinked' : 'combatant.removed');
  }
  for (const { row, fight } of rows) {
    const live = fight.state === 'live';
    await tx.emit({
      type: 'log.posted',
      payload: {
        kind: 'fight',
        encounterId: fight.id,
        combatantId: row.id,
        text: live ? `${row.name}: token removed, still in ${fight.name}` : `${row.name} leaves ${fight.name}: token removed`,
      },
      visibility: live ? visibility : 'gm',
    });
  }
}

/** Re-send the frames of open fights with rows on these tokens. */
export async function refreshFights(tx: EventTx, tokenIds: readonly string[]): Promise<void> {
  if (tokenIds.length === 0) return;
  const rows = await tx.db
    .select({ fight: encounters })
    .from(combatants)
    .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
    .where(and(inArray(combatants.tokenId, [...tokenIds]), inArray(encounters.state, OPEN)));
  const fights = new Map(rows.map((r) => [r.fight.id, r.fight]));
  for (const fight of fights.values()) await emitFightFrames(tx, fight, 'token.table');
}

/** Every open fight in the campaign: a scene going live moves every token on or off the table. */
export async function refreshCampaignFights(tx: EventTx, campaignId: string): Promise<void> {
  const fights = await tx.db
    .select()
    .from(encounters)
    .where(and(eq(encounters.campaignId, campaignId), inArray(encounters.state, OPEN)));
  for (const fight of fights) await emitFightFrames(tx, fight, 'token.table');
}
