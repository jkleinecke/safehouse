/**
 * sessions domain plugin (M6 — FR6.1–6.3, DESIGN.md §12).
 *
 * A session is the campaign's unit of play: date, attendance, GM prep notes,
 * shared recap, and the log slice (`ws_events` + `rolls.session_id`). Starting
 * one flips the campaign into live mode; ending one opens the housekeeping
 * beat (pending ledger entries, surfaced read-only — approval lives in the
 * ledger plugin) and the recap flow, whose published form is the players' only
 * between-session window into the campaign (FR6.3).
 *
 *   GET   /api/campaigns/:id/sessions          list
 *   POST  /api/campaigns/:id/sessions          create a planned session (GM)
 *   GET   /api/campaigns/:id/live              live-mode state + presence
 *   POST  /api/campaigns/:id/sessions/start    start (create or resume) — live mode on
 *   GET   /api/sessions/:id                    read (prep notes GM-only)
 *   PATCH /api/sessions/:id                    date / attendance / prep / recap draft (GM)
 *   POST  /api/sessions/:id/end                end — live mode off
 *   GET   /api/sessions/:id/housekeeping       end-of-session summary (GM)
 *   POST  /api/sessions/:id/publish-recap      publish → Discord webhook (GM)
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { campaigns, characters, gameSessions, ledgerEntries, rolls, type Db } from '@safehouse/db';
import { assertCampaign, httpError, requireAuth, type AuthContext } from '../services/auth.js';
import {
  activeSessionId,
  discordWebhookUrl,
  forgetCampaignSettings,
  getRollService,
  postDiscord,
} from '../services/rolls.js';

const CreateBody = z.object({
  /** Real-world date, `YYYY-MM-DD`. */
  date: z.string().min(4).max(32).optional(),
  attendance: z.array(z.string()).max(24).optional(),
  prepNotesMd: z.string().max(100_000).optional(),
});

const PatchBody = CreateBody.extend({
  recapMd: z.string().max(100_000).optional(),
});

const StartBody = z.object({
  sessionId: z.string().optional(),
  date: z.string().min(4).max(32).optional(),
  attendance: z.array(z.string()).max(24).optional(),
});

const PublishBody = z.object({
  recapMd: z.string().max(100_000).optional(),
  /** Include auto-collected headline events (public rolls only). */
  headlines: z.boolean().default(true),
});

type SessionRow = typeof gameSessions.$inferSelect;

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid input', parsed.error.issues);
  return parsed.data;
}

async function loadSession(db: Db, id: string): Promise<SessionRow> {
  const row = (await db.select().from(gameSessions).where(eq(gameSessions.id, id)).limit(1))[0];
  if (!row) throw httpError(404, 'not_found', 'unknown session');
  return row;
}

function assertGmOf(auth: AuthContext, row: SessionRow): void {
  if (auth.role !== 'gm') throw httpError(403, 'forbidden', 'GM only');
  assertCampaign(auth, row.campaignId);
}

/** Prep notes are GM-only (FR6.1); everything else is table-visible. */
function toDto(row: SessionRow, auth: AuthContext) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    date: row.date,
    attendance: row.attendance,
    recapMd: row.recapMd,
    state: row.state,
    ...(auth.role === 'gm' ? { prepNotesMd: row.prepNotesMd } : {}),
  };
}

/** Merge keys into `campaigns.settings` without clobbering the rest (FR1.5). */
async function mergeSettings(db: Db, campaignId: string, patch: Record<string, unknown>): Promise<void> {
  await db
    .update(campaigns)
    .set({
      settings: sql`coalesce(${campaigns.settings}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
    })
    .where(eq(campaigns.id, campaignId));
  forgetCampaignSettings(campaignId);
}

export default async function sessionsPlugin(app: FastifyInstance): Promise<void> {
  const svc = getRollService(app.db, app.hub, app.log);

  app.get('/api/campaigns/:id/sessions', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const rows = await app.db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.campaignId, id))
      .orderBy(desc(gameSessions.date), desc(gameSessions.id));
    return reply.send({ sessions: rows.map((row) => toDto(row, auth)) });
  });

  app.post('/api/campaigns/:id/sessions', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    if (auth.role !== 'gm') throw httpError(403, 'forbidden', 'only the GM creates sessions');
    const body = parse(CreateBody, req.body);
    const row = (
      await app.db
        .insert(gameSessions)
        .values({
          campaignId: id,
          date: body.date ?? new Date().toISOString().slice(0, 10),
          attendance: body.attendance ?? [],
          prepNotesMd: body.prepNotesMd ?? '',
          state: 'planned',
        })
        .returning()
    )[0];
    if (!row) throw httpError(500, 'internal', 'session insert returned no row');
    return reply.status(201).send({ session: toDto(row, auth) });
  });

  // Live mode + presence at a glance (FR6.2).
  app.get('/api/campaigns/:id/live', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const sessionId = await activeSessionId(app.db, id);
    return reply.send({ live: sessionId !== null, sessionId, connected: app.hub.roomSize(id) });
  });

  // "Start session": live mode on, log recording, presence (FR6.2).
  app.post('/api/campaigns/:id/sessions/start', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    if (auth.role !== 'gm') throw httpError(403, 'forbidden', 'only the GM starts a session');
    const body = parse(StartBody, req.body);
    const running = await activeSessionId(app.db, id);
    if (running && running !== body.sessionId) {
      throw httpError(409, 'session_live', 'a session is already live', { sessionId: running });
    }
    let row: SessionRow | undefined;
    if (body.sessionId) {
      row = await loadSession(app.db, body.sessionId);
      if (row.campaignId !== id) throw httpError(404, 'not_found', 'unknown session');
      row = (
        await app.db
          .update(gameSessions)
          .set({
            state: 'live',
            ...(body.date ? { date: body.date } : {}),
            ...(body.attendance ? { attendance: body.attendance } : {}),
          })
          .where(eq(gameSessions.id, row.id))
          .returning()
      )[0];
    } else {
      row = (
        await app.db
          .insert(gameSessions)
          .values({
            campaignId: id,
            date: body.date ?? new Date().toISOString().slice(0, 10),
            attendance: body.attendance ?? [],
            state: 'live',
          })
          .returning()
      )[0];
    }
    if (!row) throw httpError(500, 'internal', 'session start returned no row');
    await mergeSettings(app.db, id, { live: true, liveSessionId: row.id });
    await svc.postLog({
      campaignId: id,
      kind: 'session',
      text: `Session started (${row.date ?? 'today'})`,
      by: { userId: auth.userId, displayName: auth.displayName },
      extra: { sessionId: row.id, marker: 'session.started' },
    });
    return reply.status(201).send({ session: toDto(row, auth), live: true });
  });

  app.get('/api/sessions/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const row = await loadSession(app.db, (req.params as { id: string }).id);
    assertCampaign(auth, row.campaignId);
    return reply.send({ session: toDto(row, auth) });
  });

  // Prep notes and the recap DRAFT (published separately, FR6.3).
  app.patch('/api/sessions/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const row = await loadSession(app.db, (req.params as { id: string }).id);
    assertGmOf(auth, row);
    const body = parse(PatchBody, req.body);
    const updated = (
      await app.db
        .update(gameSessions)
        .set({
          ...(body.date !== undefined ? { date: body.date } : {}),
          ...(body.attendance !== undefined ? { attendance: body.attendance } : {}),
          ...(body.prepNotesMd !== undefined ? { prepNotesMd: body.prepNotesMd } : {}),
          ...(body.recapMd !== undefined ? { recapMd: body.recapMd } : {}),
        })
        .where(eq(gameSessions.id, row.id))
        .returning()
    )[0];
    if (!updated) throw httpError(404, 'not_found', 'unknown session');
    return reply.send({ session: toDto(updated, auth) });
  });

  // "End session": live mode off, log closed, housekeeping prompted (FR6.2).
  app.post('/api/sessions/:id/end', async (req, reply) => {
    const auth = requireAuth(req);
    const row = await loadSession(app.db, (req.params as { id: string }).id);
    assertGmOf(auth, row);
    const updated = (
      await app.db
        .update(gameSessions)
        .set({ state: 'done' })
        .where(eq(gameSessions.id, row.id))
        .returning()
    )[0];
    await mergeSettings(app.db, row.campaignId, { live: false, liveSessionId: null });
    await svc.postLog({
      campaignId: row.campaignId,
      kind: 'session',
      text: `Session ended (${row.date ?? 'today'})`,
      by: { userId: auth.userId, displayName: auth.displayName },
      extra: { sessionId: row.id, marker: 'session.ended' },
    });
    const summary = await housekeeping(app.db, row);
    return reply.send({ session: toDto(updated ?? row, auth), live: false, housekeeping: summary });
  });

  // The end-of-session beat, read-only: pending ledger entries proposed at the
  // table (FR3.6) plus the session's headline numbers. Approval is the ledger
  // plugin's route (POST /api/ledger/:entryId/approve) — never this one.
  app.get('/api/sessions/:id/housekeeping', async (req, reply) => {
    const auth = requireAuth(req);
    const row = await loadSession(app.db, (req.params as { id: string }).id);
    assertGmOf(auth, row);
    return reply.send({ housekeeping: await housekeeping(app.db, row) });
  });

  // Publish the recap (FR6.3): explicit GM action, public log entry, and one
  // fire-and-forget Discord post — the system's only outbound traffic (§13).
  app.post('/api/sessions/:id/publish-recap', async (req, reply) => {
    const auth = requireAuth(req);
    const row = await loadSession(app.db, (req.params as { id: string }).id);
    assertGmOf(auth, row);
    const body = parse(PublishBody, req.body);
    let session = row;
    if (body.recapMd !== undefined) {
      session =
        (
          await app.db
            .update(gameSessions)
            .set({ recapMd: body.recapMd })
            .where(eq(gameSessions.id, row.id))
            .returning()
        )[0] ?? row;
    }
    const recap = session.recapMd.trim();
    if (recap.length === 0) throw httpError(400, 'empty_recap', 'write a recap before publishing');
    const headlines = body.headlines ? await headlineLines(app.db, session) : [];
    await svc.postLog({
      campaignId: session.campaignId,
      kind: 'recap',
      text: recap,
      by: { userId: auth.userId, displayName: auth.displayName },
      extra: { sessionId: session.id, headlines, marker: 'recap.published' },
    });
    const url = await discordWebhookUrl(app.db, session.campaignId);
    if (url) postDiscord(url, recapPost(session.date, recap, headlines), app.log);
    return reply.send({
      published: true,
      sessionId: session.id,
      headlines,
      discord: url ? 'queued' : 'skipped',
    });
  });
}

// ---------------------------------------------------------------------------
// Housekeeping + recap helpers
// ---------------------------------------------------------------------------

interface Housekeeping {
  sessionId: string;
  attendance: string[];
  pendingLedger: {
    id: string;
    characterId: string;
    characterName: string;
    currency: 'karma' | 'nuyen';
    delta: number;
    reason: string;
    createdAt: string;
  }[];
  rolls: { total: number; glitches: number; criticals: number };
  recapDraft: boolean;
}

/** Read-only summary for the table's closing beat (FR3.6 / FR6.2). */
async function housekeeping(db: Db, session: SessionRow): Promise<Housekeeping> {
  const campaignCharacters = await db
    .select({ id: characters.id, name: characters.name })
    .from(characters)
    .where(eq(characters.campaignId, session.campaignId));
  const names = new Map(campaignCharacters.map((c) => [c.id, c.name]));
  const pending =
    campaignCharacters.length > 0
      ? await db
          .select()
          .from(ledgerEntries)
          .where(
            and(
              eq(ledgerEntries.state, 'pending'),
              inArray(
                ledgerEntries.characterId,
                campaignCharacters.map((c) => c.id),
              ),
            ),
          )
          .orderBy(desc(ledgerEntries.createdAt))
      : [];
  const sessionRolls = await db
    .select({ glitch: rolls.glitch })
    .from(rolls)
    .where(eq(rolls.sessionId, session.id));
  return {
    sessionId: session.id,
    attendance: session.attendance,
    pendingLedger: pending.map((e) => ({
      id: e.id,
      characterId: e.characterId,
      characterName: names.get(e.characterId) ?? 'unknown',
      currency: e.currency,
      delta: e.delta,
      reason: e.reason,
      createdAt: e.createdAt.toISOString(),
    })),
    rolls: {
      total: sessionRolls.length,
      glitches: sessionRolls.filter((r) => r.glitch === 'glitch').length,
      criticals: sessionRolls.filter((r) => r.glitch === 'critical').length,
    },
    recapDraft: session.recapMd.trim().length > 0,
  };
}

/**
 * Headline events for the published recap (FR6.3) — PUBLIC rolls only, so a
 * behind-the-screen roll can never leak into an outbound post (FR12.19).
 */
async function headlineLines(db: Db, session: SessionRow): Promise<string[]> {
  const rows = await db
    .select({
      hits: rolls.limitedHits,
      glitch: rolls.glitch,
      kind: rolls.kind,
      createdAt: rolls.createdAt,
    })
    .from(rolls)
    .where(and(eq(rolls.sessionId, session.id), eq(rolls.visibility, 'public')))
    .orderBy(desc(rolls.createdAt))
    .limit(200);
  const lines: string[] = [];
  const criticals = rows.filter((r) => r.glitch === 'critical').length;
  const glitches = rows.filter((r) => r.glitch === 'glitch').length;
  const best = rows.reduce((m, r) => Math.max(m, r.hits ?? 0), 0);
  if (rows.length > 0) lines.push(`${rows.length} rolls at the table`);
  if (best > 0) lines.push(`best result: ${best} hits`);
  if (glitches > 0) lines.push(`${glitches} glitch${glitches === 1 ? '' : 'es'}`);
  if (criticals > 0) lines.push(`${criticals} critical glitch${criticals === 1 ? '' : 'es'}`);
  return lines;
}

/** The published recap as Discord sees it — the players' between-session window. */
function recapPost(date: string | null, recap: string, headlines: string[]): string {
  return [
    `**Session recap${date ? ` — ${date}` : ''}**`,
    '',
    recap,
    ...(headlines.length > 0 ? ['', ...headlines.map((h) => `• ${h}`)] : []),
  ].join('\n');
}
