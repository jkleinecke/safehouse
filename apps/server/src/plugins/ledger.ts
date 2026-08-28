/**
 * Karma & nuyen ledgers (FR3.6, DESIGN.md §12).
 *
 * Append-only: an entry's `delta`/`reason` are never edited — only its state
 * moves `pending → approved | rejected`, and a correction is a new entry.
 * **Balances are sums of approved entries**; the sheet has no free-floating
 * karma or nuyen number anywhere (that is the whole point of the ledger).
 *
 * Player-created entries land `pending` and are settled at the table during
 * the end-of-session housekeeping beat (§4); the GM approves or rejects.
 *
 * Routes:
 *   GET  /api/characters/:id/ledger          entries + balances
 *   POST /api/characters/:id/ledger          award/spend/adjustment
 *   GET  /api/campaigns/:id/ledger?state=    GM's settle-up view
 *   POST /api/ledger/:entryId/approve        GM
 *   POST /api/ledger/:entryId/reject         GM
 *
 * Every write emits `ledger.changed` (§11 catalog).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CurrencySchema, LedgerStateSchema, type LedgerEntry } from '@safehouse/contracts';
import { characters, ledgerEntries, ledgerBalance, type Db } from '@safehouse/db';
import type { Hub } from '../hub.js';
import { httpError, requireAuth, requireRole, type AuthContext } from '../services/auth.js';
import { requireCharacter, assertCanView } from '../services/characters.js';

export interface LedgerBalances {
  karma: number;
  nuyen: number;
  /** What the balances become if every pending entry is approved. */
  pending: { karma: number; nuyen: number };
}

function toDto(row: typeof ledgerEntries.$inferSelect): LedgerEntry {
  return {
    id: row.id,
    characterId: row.characterId,
    currency: row.currency,
    delta: row.delta,
    reason: row.reason,
    state: row.state,
    sessionId: row.sessionId,
    runId: row.runId,
    ...(row.createdBy ? { createdBy: row.createdBy } : {}),
    approvedBy: row.approvedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Approved sums plus a projection including pending entries (FR3.6). */
export async function balancesFor(db: Db, characterId: string): Promise<LedgerBalances> {
  const approved = await ledgerBalance(db, characterId);
  const projected = await ledgerBalance(db, characterId, { includePending: true });
  return { karma: approved.karma, nuyen: approved.nuyen, pending: projected };
}

export interface CreateEntryInput {
  characterId: string;
  currency: 'karma' | 'nuyen';
  delta: number;
  reason: string;
  state?: 'pending' | 'approved' | 'rejected';
  sessionId?: string | null;
  runId?: string | null;
  createdBy?: string | null;
}

/**
 * Append one ledger entry and broadcast `ledger.changed`. Exported so the
 * Chummer import can seed opening balances (FR3.1 → FR3.6) without inventing
 * a second write path.
 */
export async function createEntry(
  db: Db,
  hub: Hub,
  campaignId: string,
  input: CreateEntryInput,
): Promise<{ entry: LedgerEntry; balances: LedgerBalances }> {
  const rows = await db
    .insert(ledgerEntries)
    .values({
      characterId: input.characterId,
      currency: input.currency,
      delta: Math.trunc(input.delta),
      reason: input.reason,
      state: input.state ?? 'pending',
      sessionId: input.sessionId ?? null,
      runId: input.runId ?? null,
      createdBy: input.createdBy ?? null,
      approvedBy: input.state === 'approved' ? (input.createdBy ?? null) : null,
    })
    .returning();
  const entry = toDto(rows[0]!);
  const balances = await balancesFor(db, input.characterId);
  await hub.emit(campaignId, {
    type: 'ledger.changed',
    payload: { entry, balances, characterId: input.characterId },
  });
  return { entry, balances };
}

const CreateEntryBody = z.object({
  currency: CurrencySchema,
  delta: z.number().int(),
  reason: z.string().min(1).max(500),
  /** GM may post a pre-approved award; players are always pending. */
  state: LedgerStateSchema.exclude(['rejected']).optional(),
  sessionId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
});

function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw httpError(400, 'bad_request', 'invalid request body', parsed.error.issues);
  }
  return parsed.data;
}

async function loadEntry(db: Db, entryId: string) {
  const rows = await db
    .select({ entry: ledgerEntries, campaignId: characters.campaignId })
    .from(ledgerEntries)
    .innerJoin(characters, eq(ledgerEntries.characterId, characters.id))
    .where(eq(ledgerEntries.id, entryId))
    .limit(1);
  const row = rows[0];
  if (!row) throw httpError(404, 'not_found', 'unknown ledger entry');
  return row;
}

async function settle(
  app: FastifyInstance,
  auth: AuthContext,
  entryId: string,
  next: 'approved' | 'rejected',
): Promise<{ entry: LedgerEntry; balances: LedgerBalances }> {
  const { entry: row, campaignId } = await loadEntry(app.db, entryId);
  if (auth.campaignId !== campaignId) {
    throw httpError(403, 'forbidden', 'device is not bound to this campaign');
  }
  if (row.state !== 'pending') {
    throw httpError(409, 'already_settled', `entry is already ${row.state}`);
  }
  const updated = await app.db
    .update(ledgerEntries)
    .set({ state: next, approvedBy: auth.userId })
    .where(and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.state, 'pending')))
    .returning();
  const entry = toDto(updated[0]!);
  const balances = await balancesFor(app.db, entry.characterId);
  await app.hub.emit(campaignId, {
    type: 'ledger.changed',
    payload: { entry, balances, characterId: entry.characterId, settled: next },
  });
  return { entry, balances };
}

export default async function ledgerPlugin(app: FastifyInstance): Promise<void> {
  // --- read: entries + balances (FR3.6) ----------------------------------
  app.get('/api/characters/:id/ledger', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanView(auth, rec);
    const q = (req.query ?? {}) as Record<string, unknown>;
    const filters = [eq(ledgerEntries.characterId, id)];
    const currency = CurrencySchema.safeParse(q['currency']);
    if (currency.success) filters.push(eq(ledgerEntries.currency, currency.data));
    const state = LedgerStateSchema.safeParse(q['state']);
    if (state.success) filters.push(eq(ledgerEntries.state, state.data));
    const rows = await app.db
      .select()
      .from(ledgerEntries)
      .where(and(...filters))
      .orderBy(desc(ledgerEntries.createdAt));
    return reply.send({
      characterId: id,
      entries: rows.map(toDto),
      balances: await balancesFor(app.db, id),
    });
  });

  // --- append: award / spend / adjustment ---------------------------------
  app.post('/api/characters/:id/ledger', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    assertCanView(auth, rec);
    const isOwner = rec.ownerUserId != null && rec.ownerUserId === auth.userId;
    if (auth.role !== 'gm' && !isOwner) {
      throw httpError(403, 'forbidden', 'only the owner or the GM may post ledger entries');
    }
    const body = parse(CreateEntryBody, req.body);
    // Player-initiated entries are pending until the GM approves (FR3.6).
    const state = auth.role === 'gm' ? (body.state ?? 'approved') : 'pending';
    const created = await createEntry(app.db, app.hub, rec.campaignId, {
      characterId: id,
      currency: body.currency,
      delta: body.delta,
      reason: body.reason,
      state,
      sessionId: body.sessionId ?? null,
      runId: body.runId ?? null,
      createdBy: auth.userId,
    });
    return reply.status(201).send(created);
  });

  // --- GM settle-up view (end-of-session housekeeping, §4) -----------------
  app.get('/api/campaigns/:campaignId/ledger', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { campaignId } = req.params as { campaignId: string };
    if (auth.campaignId !== campaignId) {
      throw httpError(403, 'forbidden', 'device is not bound to this campaign');
    }
    const q = (req.query ?? {}) as Record<string, unknown>;
    const state = LedgerStateSchema.safeParse(q['state']);
    const filters = [eq(characters.campaignId, campaignId)];
    if (state.success) filters.push(eq(ledgerEntries.state, state.data));
    const rows = await app.db
      .select({ entry: ledgerEntries, characterName: characters.name })
      .from(ledgerEntries)
      .innerJoin(characters, eq(ledgerEntries.characterId, characters.id))
      .where(and(...filters))
      .orderBy(desc(ledgerEntries.createdAt));
    return reply.send({
      campaignId,
      entries: rows.map((r) => ({ ...toDto(r.entry), characterName: r.characterName })),
    });
  });

  // --- approve / reject (GM only) -----------------------------------------
  app.post('/api/ledger/:entryId/approve', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { entryId } = req.params as { entryId: string };
    return reply.send(await settle(app, auth, entryId, 'approved'));
  });

  app.post('/api/ledger/:entryId/reject', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { entryId } = req.params as { entryId: string };
    return reply.send(await settle(app, auth, entryId, 'rejected'));
  });
}
