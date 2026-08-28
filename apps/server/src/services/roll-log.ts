/**
 * The roll log's READ side (FR2.6/2.7/2.9, §12): the persisted record shape,
 * cursor pagination, and — the part that matters — visibility filtering done
 * in SQL, so a hidden roll is never fetched onto a socket it may not reach
 * (Principle 4). The write side lives in services/rolls.ts.
 */
import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import type {
  EdgeAction,
  Glitch,
  LimitRef,
  Role,
  RollActor,
  RollKind,
  RollRequest,
  Visibility,
} from '@safehouse/contracts';
import { rolls, type Db } from '@safehouse/db';

/** Who is asking (device-token context, or a hub socket's auth). */
export interface RollViewer {
  userId: string;
  role: Role;
}

/** A persisted roll, as returned by the API and carried on `roll.created`. */
export interface RollRecord {
  id: string;
  campaignId: string;
  sessionId: string | null;
  actor: RollActor;
  kind: RollKind;
  /** The AUTHORITATIVE request: recomputed pool + provenance (FR2.6). */
  request: RollRequest;
  faces: number[];
  hits: number;
  ones: number;
  glitch: Glitch;
  limit: LimitRef | null;
  limitedHits: number;
  edgeAction: EdgeAction | null;
  /** Prior roll this one opposes (FR2.5). */
  opposedLink: string | null;
  /** limitedHits − opposed roll's limitedHits, when linked. */
  netHits?: number;
  visibility: Visibility;
  createdAt: string;
  /** Per-interval detail for `extended`, helper detail for `teamwork`. */
  detail?: Record<string, unknown>;
}

export interface ListRollsOpts {
  sessionId?: string;
  limit?: number;
  /** Opaque cursor from a previous page (`nextCursor`). */
  before?: string;
}

export interface RollPage {
  rolls: RollRecord[];
  nextCursor: string | null;
}

export function toRecord(row: typeof rolls.$inferSelect): RollRecord {
  return {
    id: row.id,
    campaignId: row.campaignId,
    sessionId: row.sessionId,
    actor: (row.actor ?? {}) as RollActor,
    kind: row.kind as RollKind,
    request: row.request as RollRequest,
    faces: row.faces,
    hits: row.hits,
    ones: row.ones,
    glitch: row.glitch,
    limit: (row.limit ?? null) as LimitRef | null,
    limitedHits: row.limitedHits ?? row.hits,
    edgeAction: (row.edgeAction ?? null) as EdgeAction | null,
    opposedLink: row.opposedLink,
    visibility: row.visibility,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Non-GM viewers see public rolls plus their own `gm_owner` ones. The owner is
 * stamped into `request.meta.ownerUserId` at creation precisely so this filter
 * can run in the database instead of in the handler.
 */
export function visibilityCondition(viewer: RollViewer): SQL | undefined {
  if (viewer.role === 'gm') return undefined;
  return or(
    eq(rolls.visibility, 'public'),
    and(
      eq(rolls.visibility, 'gm_owner'),
      sql`${rolls.request}->'meta'->>'ownerUserId' = ${viewer.userId}`,
    ),
  );
}

export function encodeCursor(ts: Date, id: string): string {
  return Buffer.from(`${ts.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined): { ts: Date; id: string } | null {
  if (!raw) return null;
  const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (!iso || !id) return null;
  const ts = new Date(iso);
  return Number.isNaN(ts.getTime()) ? null : { ts, id };
}

/** Paginated campaign roll log, newest first (§12). */
export async function listRolls(
  db: Db,
  campaignId: string,
  viewer: RollViewer,
  opts: ListRollsOpts = {},
): Promise<RollPage> {
  const limit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 50)));
  const conds: SQL[] = [eq(rolls.campaignId, campaignId)];
  if (opts.sessionId) conds.push(eq(rolls.sessionId, opts.sessionId));
  const vis = visibilityCondition(viewer);
  if (vis) conds.push(vis);
  const cursor = decodeCursor(opts.before);
  if (cursor) {
    conds.push(
      or(
        lt(rolls.createdAt, cursor.ts),
        and(eq(rolls.createdAt, cursor.ts), lt(rolls.id, cursor.id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(rolls)
    .where(and(...conds))
    .orderBy(desc(rolls.createdAt), desc(rolls.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rolls: page.map(toRecord),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/** One roll by id, or null when the viewer may not see it. */
export async function getRoll(
  db: Db,
  campaignId: string,
  viewer: RollViewer,
  id: string,
): Promise<RollRecord | null> {
  const conds: SQL[] = [eq(rolls.campaignId, campaignId), eq(rolls.id, id)];
  const vis = visibilityCondition(viewer);
  if (vis) conds.push(vis);
  const row = (await db.select().from(rolls).where(and(...conds)).limit(1))[0];
  return row ? toRecord(row) : null;
}

/** One-line Discord summary of a public roll (FR2.10). */
export function summarize(record: RollRecord): string {
  const meta = (record.request.meta ?? {}) as Record<string, unknown>;
  const label =
    typeof meta['label'] === 'string'
      ? meta['label']
      : typeof meta['poolRef'] === 'string'
        ? meta['poolRef']
        : record.kind;
  const limitNote = record.limit ? ` (limit ${record.limit.value})` : '';
  const glitchNote =
    record.glitch === 'critical'
      ? ' — CRITICAL GLITCH'
      : record.glitch === 'glitch'
        ? ' — glitch'
        : '';
  const net = record.netHits !== undefined ? `, net ${record.netHits}` : '';
  return `🎲 ${label}: ${record.limitedHits} hit${record.limitedHits === 1 ? '' : 's'} on ${record.request.pool} dice${limitNote}${net}${glitchNote}`;
}
