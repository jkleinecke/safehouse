/**
 * ws_events repo helpers (§11 — persisted events are the source of sync).
 * The id is a global bigserial; because the server is the single writer,
 * ids are monotonic within each campaign, which is all replay needs.
 */
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { Visibility } from '@safehouse/contracts';
import type { Db } from './client.js';
import { DbError, wrapDbError } from './errors.js';
import { wsEvents } from './schema.js';

export type WsEventRow = typeof wsEvents.$inferSelect;

export interface AppendEventInput {
  campaignId: string;
  /** Event type per the DESIGN.md §11 catalog (`roll.created`, `token.moved`, …). */
  type: string;
  payload: unknown;
  visibility?: Visibility;
  ownerUserId?: string | null;
}

/**
 * Append one persisted event; returns the stored row (with its event id).
 *
 * All or nothing: this is a single `INSERT … RETURNING`, so it either commits a
 * row and hands back its id, or commits nothing and throws. There is no path
 * that stores an event and reports failure, or reports success without an id.
 *
 * Failures throw a `DbError` carrying PostgreSQL's own diagnosis — SQLSTATE,
 * violated constraint, DETAIL — rather than drizzle's `Failed query: <sql>`,
 * which is identical for every possible cause and has cost real debugging time.
 */
export async function appendEvent(db: Db, input: AppendEventInput): Promise<WsEventRow> {
  let rows: WsEventRow[];
  try {
    rows = await db
      .insert(wsEvents)
      .values({
        campaignId: input.campaignId,
        type: input.type,
        payload: input.payload,
        visibility: input.visibility ?? 'public',
        ownerUserId: input.ownerUserId ?? null,
      })
      .returning();
  } catch (err) {
    throw wrapDbError('appendEvent', err, {
      campaignId: input.campaignId,
      type: input.type,
    });
  }
  const row = rows[0];
  if (!row) {
    throw new DbError('appendEvent failed: insert returned no row', 'appendEvent', {}, {
      campaignId: input.campaignId,
      type: input.type,
    });
  }
  return row;
}

/** Highest event id seen for a campaign (0 when it has no events). */
export async function latestEventId(db: Db, campaignId: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number | null>`max(${wsEvents.id})::bigint` })
    .from(wsEvents)
    .where(eq(wsEvents.campaignId, campaignId));
  const max = rows[0]?.max;
  return max == null ? 0 : Number(max);
}

/**
 * Advisory next id for a campaign (latest + 1). The actual id is assigned by
 * the global bigserial on insert — use `appendEvent`'s return value as truth.
 */
export async function nextEventId(db: Db, campaignId: string): Promise<number> {
  return (await latestEventId(db, campaignId)) + 1;
}

/** Replay: events for a campaign with id > sinceId, in id order. */
export async function eventsSince(
  db: Db,
  campaignId: string,
  sinceId: number,
  limit = 500,
): Promise<WsEventRow[]> {
  return db
    .select()
    .from(wsEvents)
    .where(and(eq(wsEvents.campaignId, campaignId), gt(wsEvents.id, sinceId)))
    .orderBy(asc(wsEvents.id))
    .limit(limit);
}

/** Prune old events (retention ~30 days, §9.2). Returns deleted row count. */
export async function pruneEventsBefore(db: Db, campaignId: string, cutoff: Date): Promise<number> {
  const rows = await db
    .delete(wsEvents)
    .where(and(eq(wsEvents.campaignId, campaignId), sql`${wsEvents.createdAt} < ${cutoff}`))
    .returning({ id: wsEvents.id });
  return rows.length;
}

/**
 * The newest event of one type, or undefined.
 *
 * Some state is only ever stored as its event — the GM's table-display
 * steering (`display.updated`, FR9.21) has no table of its own, and the newest
 * event carrying the full state IS the state. This is the read that lets a
 * kiosk which rebooted mid-session come back the way the GM left it.
 */
export async function latestEventOfType(
  db: Db,
  campaignId: string,
  type: string,
): Promise<WsEventRow | undefined> {
  const rows = await db
    .select()
    .from(wsEvents)
    .where(and(eq(wsEvents.campaignId, campaignId), eq(wsEvents.type, type)))
    .orderBy(desc(wsEvents.id))
    .limit(1);
  return rows[0];
}

/** Most recent events first (log views). */
export async function recentEvents(db: Db, campaignId: string, limit = 100): Promise<WsEventRow[]> {
  return db
    .select()
    .from(wsEvents)
    .where(eq(wsEvents.campaignId, campaignId))
    .orderBy(desc(wsEvents.id))
    .limit(limit);
}
