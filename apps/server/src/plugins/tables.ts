/**
 * tables domain plugin — campaign rollable tables (FR2.11, DESIGN.md §12).
 *
 * User-defined weighted tables (run complications, loot, weather, rumor mill);
 * the Opposition Kit's flavor tables (FR10.2) are these same rows. Shipped
 * defaults live with `campaign_id = NULL` and are original writing only (G6).
 *
 *   GET    /api/campaigns/:id/roll-tables   list (campaign + shared defaults)
 *   POST   /api/campaigns/:id/roll-tables   create (GM)
 *   GET    /api/roll-tables/:id             read
 *   PATCH  /api/roll-tables/:id             update (GM)
 *   DELETE /api/roll-tables/:id             delete (GM)
 *   POST   /api/roll-tables/:id/roll        weighted draw → persisted log event
 */
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RollTableEntrySchema, RollTableKindSchema, VisibilitySchema } from '@safehouse/contracts';
import { rollTables, type Db } from '@safehouse/db';
import { canSee } from '../hub.js';
import { assertCampaign, httpError, requireAuth, type AuthContext } from '../services/auth.js';
import { rng } from '../services/dice.js';
import { getRollService } from '../services/rolls.js';

const EntriesSchema = z.array(RollTableEntrySchema).min(1).max(500);

const CreateBody = z.object({
  kind: RollTableKindSchema.default('custom'),
  title: z.string().min(1).max(200),
  entries: EntriesSchema,
  visibility: VisibilitySchema.default('public'),
});

const PatchBody = z.object({
  kind: RollTableKindSchema.optional(),
  title: z.string().min(1).max(200).optional(),
  entries: EntriesSchema.optional(),
  visibility: VisibilitySchema.optional(),
});

const RollBody = z.object({
  /** Override the announcement's visibility (never wider than the table's). */
  visibility: VisibilitySchema.optional(),
  /** Optional note shown with the result ("weather for the warehouse run"). */
  note: z.string().max(200).optional(),
});

type TableRow = typeof rollTables.$inferSelect;

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid input', parsed.error.issues);
  return parsed.data;
}

/** Weighted draw over `entries` (weights > 0). Returns the chosen index. */
export function pickWeighted(
  entries: readonly { weight: number; text: string }[],
  roll: number,
): number {
  const total = entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
  if (total <= 0) return 0;
  let target = Math.min(Math.max(roll, 0), 0.999999999) * total;
  for (let i = 0; i < entries.length; i++) {
    target -= Math.max(0, entries[i]?.weight ?? 0);
    if (target < 0) return i;
  }
  return entries.length - 1;
}

async function loadTable(db: Db, id: string): Promise<TableRow> {
  const row = (await db.select().from(rollTables).where(eq(rollTables.id, id)).limit(1))[0];
  if (!row) throw httpError(404, 'not_found', 'unknown roll table');
  return row;
}

/** A table is reachable from the device's campaign (or is a shared default). */
function assertReadable(auth: AuthContext, row: TableRow): void {
  if (row.campaignId !== null && row.campaignId !== auth.campaignId) {
    throw httpError(404, 'not_found', 'unknown roll table');
  }
  if (!canSee(auth, { visibility: row.visibility, ownerUserId: null })) {
    throw httpError(404, 'not_found', 'unknown roll table');
  }
}

function assertGm(auth: AuthContext, row: TableRow): void {
  if (auth.role !== 'gm') throw httpError(403, 'forbidden', 'only the GM edits roll tables');
  if (row.campaignId === null) {
    throw httpError(403, 'forbidden', 'shipped default tables are read-only');
  }
  if (row.campaignId !== auth.campaignId) throw httpError(404, 'not_found', 'unknown roll table');
}

function toDto(row: TableRow) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    kind: row.kind,
    title: row.title,
    entries: row.entries as { weight: number; text: string }[],
    visibility: row.visibility,
  };
}

export default async function tablesPlugin(app: FastifyInstance): Promise<void> {
  const svc = getRollService(app.db, app.hub, app.log);

  app.get('/api/campaigns/:id/roll-tables', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const rows = await app.db
      .select()
      .from(rollTables)
      .where(or(eq(rollTables.campaignId, id), isNull(rollTables.campaignId)))
      .orderBy(asc(rollTables.title));
    const visible = rows.filter((row) =>
      canSee(auth, { visibility: row.visibility, ownerUserId: null }),
    );
    return reply.send({ tables: visible.map(toDto) });
  });

  app.post('/api/campaigns/:id/roll-tables', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    if (auth.role !== 'gm') throw httpError(403, 'forbidden', 'only the GM creates roll tables');
    const body = parse(CreateBody, req.body);
    const row = (
      await app.db
        .insert(rollTables)
        .values({
          campaignId: id,
          kind: body.kind,
          title: body.title,
          entries: body.entries,
          visibility: body.visibility,
        })
        .returning()
    )[0];
    if (!row) throw httpError(500, 'internal', 'roll table insert returned no row');
    return reply.status(201).send({ table: toDto(row) });
  });

  app.get('/api/roll-tables/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const row = await loadTable(app.db, (req.params as { id: string }).id);
    assertReadable(auth, row);
    return reply.send({ table: toDto(row) });
  });

  app.patch('/api/roll-tables/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const row = await loadTable(app.db, (req.params as { id: string }).id);
    assertGm(auth, row);
    const body = parse(PatchBody, req.body);
    const updated = (
      await app.db
        .update(rollTables)
        .set({
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.entries !== undefined ? { entries: body.entries } : {}),
          ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
        })
        .where(eq(rollTables.id, row.id))
        .returning()
    )[0];
    if (!updated) throw httpError(404, 'not_found', 'unknown roll table');
    return reply.send({ table: toDto(updated) });
  });

  app.delete('/api/roll-tables/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const row = await loadTable(app.db, (req.params as { id: string }).id);
    assertGm(auth, row);
    await app.db
      .delete(rollTables)
      .where(and(eq(rollTables.id, row.id), eq(rollTables.campaignId, row.campaignId!)));
    return reply.send({ deleted: true, id: row.id });
  });

  // The draw itself: weighted, server-rolled, and it lands in the session log
  // like any other table event (FR2.11 + FR2.9).
  app.post('/api/roll-tables/:id/roll', async (req, reply) => {
    const auth = requireAuth(req);
    const row = await loadTable(app.db, (req.params as { id: string }).id);
    assertReadable(auth, row);
    if (auth.role !== 'gm' && auth.role !== 'player') {
      throw httpError(403, 'forbidden', 'observers may not roll tables');
    }
    if (auth.role !== 'gm' && row.visibility !== 'public') {
      throw httpError(403, 'forbidden', 'only the GM rolls this table');
    }
    const body = parse(RollBody, req.body);
    const entries = row.entries as { weight: number; text: string }[];
    if (!Array.isArray(entries) || entries.length === 0) {
      throw httpError(400, 'empty_table', 'this table has no entries');
    }
    const index = pickWeighted(entries, rng());
    const entry = entries[index]!;
    // Never wider than the table itself: a GM-only table stays GM-only.
    const visibility =
      row.visibility === 'public' ? (body.visibility ?? 'public') : row.visibility;
    const campaignId = row.campaignId ?? auth.campaignId;
    if (!campaignId) throw httpError(403, 'forbidden', 'device is not bound to a campaign');
    const event = await svc.postLog({
      campaignId,
      kind: 'table',
      text: `${row.title}: ${entry.text}`,
      visibility,
      ownerUserId: auth.userId,
      by: { userId: auth.userId, displayName: auth.displayName },
      extra: {
        tableId: row.id,
        title: row.title,
        entryIndex: index,
        entry,
        ...(body.note ? { note: body.note } : {}),
      },
    });
    return reply.status(201).send({ table: { id: row.id, title: row.title }, index, entry, event });
  });
}
