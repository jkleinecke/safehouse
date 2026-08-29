/**
 * Runs (M5 — FR5.5). Registered by the codex plugin; the calendar half of the
 * domain lives in `codex-calendar.ts`.
 *
 *   GET    /api/campaigns/:id/runs   list (players: finished runs only)
 *   POST   /api/campaigns/:id/runs   create (GM)
 *   GET    /api/runs/:id             one run
 *   PATCH  /api/runs/:id             edit (GM)
 *   POST   /api/runs/:id/award       karma/nuyen → ledgers (GM)
 *
 * Awards land as **pending** ledger entries (FR3.6/FR5.5): the GM confirms
 * them in the ledger's settle-up view, so a mistyped payout is one rejection
 * away from gone and the balance never moves behind anyone's back.
 *
 * Secrecy (Principle 4): a player's run list carries title/state/recap and
 * nothing else — objectives, opposition and the Johnson link are cut here,
 * server-side, not hidden by the client.
 *
 * Storage shape: DESIGN.md §9.2 gives `runs` only `payout`/`awards` JSONB and
 * no date column, so FR5.5's brief (hook, objectives, opposition) and the
 * run's in-game date ride inside `runs.payout`. That is an envelope, not a
 * hiding place — the player-facing cut above still happens server-side.
 */
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { characters, runs, type Db } from '@safehouse/db';
import { assertCampaign, httpError, requireAuth, requireRole } from '../services/auth.js';
import { loadPage } from '../services/codex-store.js';
import { createEntry } from './ledger.js';

type RunRow = typeof runs.$inferSelect;

const ObjectiveBody = z.object({
  id: z.string().max(60).optional(),
  text: z.string().min(1).max(500),
  state: z.enum(['open', 'done', 'failed']).default('open'),
});

const OppositionBody = z.object({
  encounterId: z.string().uuid().optional(),
  label: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
});

const PayoutBody = z.object({
  nuyen: z.number().int().optional(),
  karma: z.number().int().optional(),
  notes: z.string().max(2000).optional(),
});

const RunBody = z.object({
  title: z.string().min(1).max(300),
  state: z.enum(['prep', 'active', 'done', 'failed']).default('prep'),
  johnsonPageId: z.string().uuid().nullable().optional(),
  hook: z.string().max(4000).optional(),
  objectives: z.array(ObjectiveBody).max(50).optional(),
  opposition: z.array(OppositionBody).max(50).optional(),
  payout: PayoutBody.optional(),
  recapMd: z.string().max(100_000).optional(),
  /** Sixth World date the job happens on (FR5.7). */
  ingameDate: z.string().min(4).max(32).nullable().optional(),
});

/**
 * Spelled out rather than `RunBody.partial()`: zod keeps a field's `.default()`
 * inside `.optional()`, so a partial() PATCH would reset every omitted field
 * (a recap edit would knock the run's state back to `prep`).
 */
const RunPatchBody = z.object({
  title: z.string().min(1).max(300).optional(),
  state: z.enum(['prep', 'active', 'done', 'failed']).optional(),
  johnsonPageId: z.string().uuid().nullable().optional(),
  hook: z.string().max(4000).optional(),
  objectives: z.array(ObjectiveBody).max(50).optional(),
  opposition: z.array(OppositionBody).max(50).optional(),
  payout: PayoutBody.optional(),
  recapMd: z.string().max(100_000).optional(),
  ingameDate: z.string().min(4).max(32).nullable().optional(),
});

const AwardBody = z.object({
  reason: z.string().max(300).optional(),
  entries: z
    .array(
      z.object({
        characterId: z.string().uuid(),
        karma: z.number().int().optional(),
        nuyen: z.number().int().optional(),
        reason: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(24),
});

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid input', parsed.error.issues);
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface RunBrief {
  nuyen?: number;
  karma?: number;
  notes?: string;
  hook?: string;
  ingameDate?: string | null;
  objectives: Array<{ id: string; text: string; state: string }>;
  opposition: Array<{ encounterId?: string; label?: string; note?: string }>;
}

/** The run brief stored in `runs.payout` (see INTEGRATION). */
export function readBrief(raw: unknown): RunBrief {
  const rec = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const objectives = Array.isArray(rec['objectives'])
    ? rec['objectives'].flatMap((o) => {
        if (typeof o !== 'object' || o === null) return [];
        const r = o as Record<string, unknown>;
        const text = typeof r['text'] === 'string' ? r['text'] : null;
        if (!text) return [];
        return [
          {
            id: typeof r['id'] === 'string' ? r['id'] : randomUUID(),
            text,
            state: typeof r['state'] === 'string' ? r['state'] : 'open',
          },
        ];
      })
    : [];
  const opposition = Array.isArray(rec['opposition'])
    ? rec['opposition'].flatMap((o) => {
        if (typeof o !== 'object' || o === null) return [];
        const r = o as Record<string, unknown>;
        const out: { encounterId?: string; label?: string; note?: string } = {};
        if (typeof r['encounterId'] === 'string') out.encounterId = r['encounterId'];
        if (typeof r['label'] === 'string') out.label = r['label'];
        if (typeof r['note'] === 'string') out.note = r['note'];
        return Object.keys(out).length > 0 ? [out] : [];
      })
    : [];
  return {
    ...(typeof rec['nuyen'] === 'number' ? { nuyen: rec['nuyen'] } : {}),
    ...(typeof rec['karma'] === 'number' ? { karma: rec['karma'] } : {}),
    ...(typeof rec['notes'] === 'string' ? { notes: rec['notes'] } : {}),
    ...(typeof rec['hook'] === 'string' ? { hook: rec['hook'] } : {}),
    ingameDate: typeof rec['ingameDate'] === 'string' ? rec['ingameDate'] : null,
    objectives,
    opposition,
  };
}

interface AwardRecord {
  at: string;
  by: string | null;
  reason: string;
  entries: Array<{ characterId: string; currency: 'karma' | 'nuyen'; delta: number; entryId: string }>;
}

function readAwards(raw: unknown): { karma: number; nuyen: number; history: AwardRecord[] } {
  const rec = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const history = Array.isArray(rec['history']) ? (rec['history'] as AwardRecord[]) : [];
  return {
    karma: typeof rec['karma'] === 'number' ? rec['karma'] : 0,
    nuyen: typeof rec['nuyen'] === 'number' ? rec['nuyen'] : 0,
    history,
  };
}

/** Full DTO — GM only. Players get `playerRunDto`. */
function runDto(row: RunRow): Record<string, unknown> {
  const brief = readBrief(row.payout);
  const awards = readAwards(row.awards);
  return {
    id: row.id,
    campaignId: row.campaignId,
    title: row.title,
    state: row.state,
    johnsonPageId: row.johnsonPageId,
    hook: brief.hook ?? '',
    objectives: brief.objectives,
    opposition: brief.opposition,
    payout: {
      ...(brief.nuyen !== undefined ? { nuyen: brief.nuyen } : {}),
      ...(brief.karma !== undefined ? { karma: brief.karma } : {}),
      ...(brief.notes !== undefined ? { notes: brief.notes } : {}),
    },
    awards,
    recapMd: row.recapMd,
    ingameDate: brief.ingameDate ?? null,
  };
}

/**
 * What a player may see of a run: the fact it happened and the after-action
 * recap. The brief (objectives, opposition, the Johnson's page) never leaves
 * the server for a non-GM device.
 */
function playerRunDto(row: RunRow): Record<string, unknown> {
  return { id: row.id, title: row.title, state: row.state, recapMd: row.recapMd };
}

function briefBlob(existing: RunBrief, body: z.output<typeof RunPatchBody>): RunBrief {
  const next: RunBrief = { ...existing };
  if (body.hook !== undefined) next.hook = body.hook;
  if (body.ingameDate !== undefined) next.ingameDate = body.ingameDate;
  if (body.objectives !== undefined) {
    next.objectives = body.objectives.map((o) => ({
      id: o.id ?? randomUUID(),
      text: o.text,
      state: o.state,
    }));
  }
  if (body.opposition !== undefined) next.opposition = body.opposition;
  if (body.payout !== undefined) {
    if (body.payout.nuyen !== undefined) next.nuyen = body.payout.nuyen;
    if (body.payout.karma !== undefined) next.karma = body.payout.karma;
    if (body.payout.notes !== undefined) next.notes = body.payout.notes;
  }
  return next;
}

async function requireRun(db: Db, id: string): Promise<RunRow> {
  const row = (await db.select().from(runs).where(eq(runs.id, id)).limit(1))[0];
  if (!row) throw httpError(404, 'not_found', 'unknown run');
  return row;
}


// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export default async function registerRunRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/campaigns/:id/runs', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const rows = await app.db.select().from(runs).where(eq(runs.campaignId, id)).orderBy(asc(runs.title));
    if (auth.role === 'gm') return reply.send({ campaignId: id, runs: rows.map(runDto) });
    return reply.send({
      campaignId: id,
      runs: rows.filter((r) => r.state === 'done').map(playerRunDto),
    });
  });

  app.post('/api/campaigns/:id/runs', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const body = parse(RunBody, req.body);
    if (body.johnsonPageId) {
      const page = await loadPage(app.db, body.johnsonPageId);
      if (!page || page.campaignId !== id) throw httpError(404, 'not_found', 'unknown Johnson page');
    }
    const brief = briefBlob(readBrief({}), body);
    const row = (
      await app.db
        .insert(runs)
        .values({
          campaignId: id,
          title: body.title,
          state: body.state,
          johnsonPageId: body.johnsonPageId ?? null,
          payout: brief as unknown as Record<string, unknown>,
          awards: { karma: 0, nuyen: 0, history: [] },
          recapMd: body.recapMd ?? '',
        })
        .returning()
    )[0]!;
    return reply.status(201).send({ run: runDto(row) });
  });

  app.get('/api/runs/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const row = await requireRun(app.db, id);
    assertCampaign(auth, row.campaignId);
    if (auth.role !== 'gm') {
      if (row.state !== 'done') throw httpError(404, 'not_found', 'unknown run');
      return reply.send({ run: playerRunDto(row) });
    }
    return reply.send({ run: runDto(row) });
  });

  app.patch('/api/runs/:id', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    const body = parse(RunPatchBody, req.body);
    const before = await requireRun(app.db, id);
    assertCampaign(auth, before.campaignId);
    if (body.johnsonPageId) {
      const page = await loadPage(app.db, body.johnsonPageId);
      if (!page || page.campaignId !== before.campaignId) {
        throw httpError(404, 'not_found', 'unknown Johnson page');
      }
    }
    const brief = briefBlob(readBrief(before.payout), body);
    const patch: Record<string, unknown> = { payout: brief };
    if (body.title !== undefined) patch['title'] = body.title;
    if (body.state !== undefined) patch['state'] = body.state;
    if (body.johnsonPageId !== undefined) patch['johnsonPageId'] = body.johnsonPageId;
    if (body.recapMd !== undefined) patch['recapMd'] = body.recapMd;
    const row = (await app.db.update(runs).set(patch).where(eq(runs.id, id)).returning())[0]!;
    return reply.send({ run: runDto(row) });
  });

  /**
   * Post the run's karma/nuyen awards to the characters' ledgers as PENDING
   * entries (FR5.5 → FR3.6). Each entry carries `runId`, so the settle-up view
   * groups them under the job that earned them.
   */
  app.post('/api/runs/:id/award', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    const body = parse(AwardBody, req.body);
    const run = await requireRun(app.db, id);
    assertCampaign(auth, run.campaignId);

    const ids = body.entries.map((e) => e.characterId);
    const chars = await app.db
      .select({ id: characters.id, campaignId: characters.campaignId, name: characters.name })
      .from(characters)
      .where(eq(characters.campaignId, run.campaignId));
    const known = new Map(chars.map((c) => [c.id, c]));
    for (const cid of ids) {
      if (!known.has(cid)) throw httpError(404, 'not_found', `character ${cid} is not in this campaign`);
    }

    const record: AwardRecord = {
      at: new Date().toISOString(),
      by: auth.userId,
      reason: body.reason ?? `Run: ${run.title}`,
      entries: [],
    };
    const created: unknown[] = [];
    for (const item of body.entries) {
      for (const currency of ['karma', 'nuyen'] as const) {
        const delta = item[currency];
        if (delta === undefined || delta === 0) continue;
        const { entry } = await createEntry(app.db, app.hub, run.campaignId, {
          characterId: item.characterId,
          currency,
          delta,
          reason: item.reason ?? record.reason,
          state: 'pending',
          runId: run.id,
          createdBy: auth.userId,
        });
        record.entries.push({ characterId: item.characterId, currency, delta, entryId: entry.id });
        created.push(entry);
      }
    }
    if (record.entries.length === 0) {
      throw httpError(400, 'bad_request', 'award needs at least one non-zero karma or nuyen value');
    }

    const awards = readAwards(run.awards);
    awards.karma += record.entries.reduce((n, e) => (e.currency === 'karma' ? n + e.delta : n), 0);
    awards.nuyen += record.entries.reduce((n, e) => (e.currency === 'nuyen' ? n + e.delta : n), 0);
    awards.history = [...awards.history, record];
    const row = (
      await app.db.update(runs).set({ awards }).where(eq(runs.id, id)).returning()
    )[0]!;

    return reply.status(201).send({ run: runDto(row), entries: created, state: 'pending' });
  });

}
