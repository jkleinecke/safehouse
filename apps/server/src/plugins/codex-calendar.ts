/**
 * The in-game calendar (M5 — FR5.7). Registered by the codex plugin.
 *
 *   GET    /api/campaigns/:id/calendar            merged in-game timeline
 *   POST   /api/campaigns/:id/calendar            pin an event (GM)
 *   PATCH  /api/campaigns/:id/calendar/:eventId   (GM)
 *   DELETE /api/campaigns/:id/calendar/:eventId   (GM)
 *
 * The calendar is a merge, not a table: GM-pinned timeline events, sessions,
 * dated runs, and lifestyle rent due-dates derived from the character sheets
 * (FR5.7). Every source is filtered for the caller server-side — a player sees
 * shared beats and their OWN rent, never the GM's plans or another runner's
 * bills (Principle 4).
 *
 * Storage shape: there is no `timeline_events` table in DESIGN.md §9.2, so
 * pinned events live under `campaigns.settings.timeline`. A dedicated table
 * would be a straight lift of `TimelineEvent[]`; `fixer/state-codex.ts` reads
 * the same key for the tool catalog.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { VisibilitySchema, type Visibility } from '@safehouse/contracts';
import { campaigns, characters, gameSessions, runs, type Db } from '@safehouse/db';
import { assertCampaign, httpError, requireAuth, requireRole } from '../services/auth.js';
import { canView, type Viewer } from '../services/codex.js';
import { readBrief } from './codex-runs.js';

const EventBody = z.object({
  /** In-game date, `YYYY-MM-DD` (Sixth World). */
  date: z.string().min(4).max(32),
  title: z.string().min(1).max(300),
  body: z.string().max(4000).optional(),
  kind: z.string().max(40).default('event'),
  visibility: VisibilitySchema.default('gm'),
  audience: z.array(z.string().uuid()).max(24).optional(),
  pageId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
});

/** Spelled out, not `EventBody.partial()`: zod keeps `.default()`s inside
 * `.optional()`, so a partial() PATCH would reset every omitted field. */
const EventPatchBody = z.object({
  date: z.string().min(4).max(32).optional(),
  title: z.string().min(1).max(300).optional(),
  body: z.string().max(4000).optional(),
  kind: z.string().max(40).optional(),
  visibility: VisibilitySchema.optional(),
  audience: z.array(z.string().uuid()).max(24).optional(),
  pageId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
});

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid input', parsed.error.issues);
  return parsed.data;
}

function viewerOf(auth: { role: string; userId: string; campaignId: string | null }): Viewer {
  return { role: auth.role, userId: auth.userId, campaignId: auth.campaignId };
}

// ---------------------------------------------------------------------------
// Timeline (campaigns.settings.timeline)
// ---------------------------------------------------------------------------

export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  body?: string;
  kind: string;
  visibility: Visibility;
  audience?: string[];
  pageId?: string;
  runId?: string;
}

function readTimeline(settings: unknown): TimelineEvent[] {
  const rec = (typeof settings === 'object' && settings !== null ? settings : {}) as Record<string, unknown>;
  const raw = rec['timeline'];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => {
    if (typeof e !== 'object' || e === null) return [];
    const r = e as Record<string, unknown>;
    if (typeof r['id'] !== 'string' || typeof r['date'] !== 'string' || typeof r['title'] !== 'string') {
      return [];
    }
    const visibility = r['visibility'];
    return [
      {
        id: r['id'],
        date: r['date'],
        title: r['title'],
        ...(typeof r['body'] === 'string' ? { body: r['body'] } : {}),
        kind: typeof r['kind'] === 'string' ? r['kind'] : 'event',
        visibility:
          visibility === 'public' || visibility === 'gm' || visibility === 'gm_owner'
            ? visibility
            : ('gm' as Visibility),
        ...(Array.isArray(r['audience'])
          ? { audience: r['audience'].filter((a): a is string => typeof a === 'string') }
          : {}),
        ...(typeof r['pageId'] === 'string' ? { pageId: r['pageId'] } : {}),
        ...(typeof r['runId'] === 'string' ? { runId: r['runId'] } : {}),
      },
    ];
  });
}

async function writeTimeline(db: Db, campaignId: string, events: TimelineEvent[]): Promise<void> {
  const row = (await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1))[0];
  if (!row) throw httpError(404, 'not_found', 'unknown campaign');
  const settings = { ...((row.settings ?? {}) as Record<string, unknown>), timeline: events };
  await db.update(campaigns).set({ settings }).where(eq(campaigns.id, campaignId));
}

export interface CalendarEntry {
  id: string;
  kind: string;
  date: string;
  /** Sessions are stamped with their real-world date; everything else in-game. */
  dateKind: 'ingame' | 'real';
  title: string;
  body?: string;
  visibility: Visibility;
  links?: Record<string, string>;
  amount?: number;
}

/** Rent falls due when a lifestyle's `paidThrough` runs out (FR5.7). */
function lifestyleEntries(
  rows: Array<{ id: string; name: string; ownerUserId: string | null; sheet: unknown }>,
): Array<{ entry: CalendarEntry; audience: string[] }> {
  const out: Array<{ entry: CalendarEntry; audience: string[] }> = [];
  for (const row of rows) {
    const sheet = (typeof row.sheet === 'object' && row.sheet !== null ? row.sheet : {}) as Record<string, unknown>;
    const lifestyles = Array.isArray(sheet['lifestyles']) ? sheet['lifestyles'] : [];
    for (const raw of lifestyles) {
      if (typeof raw !== 'object' || raw === null) continue;
      const l = raw as Record<string, unknown>;
      const due = typeof l['paidThrough'] === 'string' ? l['paidThrough'] : null;
      const name = typeof l['name'] === 'string' ? l['name'] : 'Lifestyle';
      if (!due) continue;
      out.push({
        entry: {
          id: `lifestyle:${row.id}:${name}`,
          kind: 'lifestyle',
          date: due,
          dateKind: 'ingame',
          title: `${row.name}: ${name} rent due`,
          visibility: 'gm_owner',
          links: { characterId: row.id },
          ...(typeof l['costPerMonth'] === 'number' ? { amount: l['costPerMonth'] } : {}),
        },
        audience: row.ownerUserId ? [row.ownerUserId] : [],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export default async function registerCalendarRoutes(app: FastifyInstance): Promise<void> {
  // --- in-game calendar (FR5.7) -------------------------------------------
  app.get('/api/campaigns/:id/calendar', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const viewer = viewerOf(auth);
    const q = (req.query ?? {}) as Record<string, unknown>;
    const from = typeof q['from'] === 'string' ? q['from'] : null;
    const to = typeof q['to'] === 'string' ? q['to'] : null;

    const campaign = (
      await app.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
    )[0];
    if (!campaign) throw httpError(404, 'not_found', 'unknown campaign');

    const entries: CalendarEntry[] = [];

    for (const ev of readTimeline(campaign.settings)) {
      if (!canView(viewer, ev.visibility, ev.audience ?? [])) continue;
      entries.push({
        id: ev.id,
        kind: ev.kind,
        date: ev.date,
        dateKind: 'ingame',
        title: ev.title,
        ...(ev.body ? { body: ev.body } : {}),
        visibility: ev.visibility,
        ...(ev.pageId || ev.runId
          ? {
              links: {
                ...(ev.pageId ? { pageId: ev.pageId } : {}),
                ...(ev.runId ? { runId: ev.runId } : {}),
              },
            }
          : {}),
      });
    }

    const sessionRows = await app.db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.campaignId, id));
    for (const s of sessionRows) {
      if (!s.date) continue;
      entries.push({
        id: `session:${s.id}`,
        kind: 'session',
        date: s.date,
        dateKind: 'real',
        title: `Session ${s.date}`,
        visibility: 'public',
        links: { sessionId: s.id },
      });
    }

    const runRows = await app.db.select().from(runs).where(eq(runs.campaignId, id));
    for (const r of runRows) {
      const brief = readBrief(r.payout);
      if (!brief.ingameDate) continue;
      const visibility: Visibility = r.state === 'done' ? 'public' : 'gm';
      if (!canView(viewer, visibility)) continue;
      entries.push({
        id: `run:${r.id}`,
        kind: 'run',
        date: brief.ingameDate,
        dateKind: 'ingame',
        title: r.title,
        visibility,
        links: { runId: r.id },
      });
    }

    const charRows = await app.db
      .select({
        id: characters.id,
        name: characters.name,
        ownerUserId: characters.ownerUserId,
        sheet: characters.sheet,
      })
      .from(characters)
      .where(eq(characters.campaignId, id));
    for (const { entry, audience } of lifestyleEntries(charRows)) {
      if (!canView(viewer, entry.visibility, audience)) continue;
      entries.push(entry);
    }

    const filtered = entries
      .filter((e) => (from ? e.date >= from : true) && (to ? e.date <= to : true))
      .sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date.localeCompare(b.date)));

    return reply.send({ campaignId: id, ingameDate: campaign.ingameDate, entries: filtered });
  });

  app.post('/api/campaigns/:id/calendar', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const body = parse(EventBody, req.body);
    const campaign = (
      await app.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
    )[0];
    if (!campaign) throw httpError(404, 'not_found', 'unknown campaign');
    const event: TimelineEvent = {
      id: randomUUID(),
      date: body.date,
      title: body.title,
      ...(body.body ? { body: body.body } : {}),
      kind: body.kind,
      visibility: body.visibility,
      ...(body.audience && body.audience.length > 0 ? { audience: body.audience } : {}),
      ...(body.pageId ? { pageId: body.pageId } : {}),
      ...(body.runId ? { runId: body.runId } : {}),
    };
    await writeTimeline(app.db, id, [...readTimeline(campaign.settings), event]);
    return reply.status(201).send({ event });
  });

  app.patch('/api/campaigns/:id/calendar/:eventId', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id, eventId } = req.params as { id: string; eventId: string };
    assertCampaign(auth, id);
    const body = parse(EventPatchBody, req.body);
    const campaign = (
      await app.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
    )[0];
    if (!campaign) throw httpError(404, 'not_found', 'unknown campaign');
    const events = readTimeline(campaign.settings);
    const found = events.find((e) => e.id === eventId);
    if (!found) throw httpError(404, 'not_found', 'unknown calendar event');
    const next: TimelineEvent = {
      ...found,
      ...(body.date !== undefined ? { date: body.date } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
      ...(body.audience !== undefined ? { audience: body.audience } : {}),
      ...(body.pageId !== undefined ? { pageId: body.pageId } : {}),
      ...(body.runId !== undefined ? { runId: body.runId } : {}),
    };
    await writeTimeline(app.db, id, events.map((e) => (e.id === eventId ? next : e)));
    return reply.send({ event: next });
  });

  app.delete('/api/campaigns/:id/calendar/:eventId', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id, eventId } = req.params as { id: string; eventId: string };
    assertCampaign(auth, id);
    const campaign = (
      await app.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
    )[0];
    if (!campaign) throw httpError(404, 'not_found', 'unknown campaign');
    const events = readTimeline(campaign.settings);
    if (!events.some((e) => e.id === eventId)) {
      throw httpError(404, 'not_found', 'unknown calendar event');
    }
    await writeTimeline(app.db, id, events.filter((e) => e.id !== eventId));
    return reply.send({ deleted: eventId });
  });
}
