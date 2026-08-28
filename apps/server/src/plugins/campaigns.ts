/**
 * campaigns domain plugin — the campaign record itself (DESIGN.md §9.2
 * `campaigns`, §12; FR1.1/1.4/1.5, FR5.7).
 *
 *   GET   /api/campaigns/:id           summary the shell header needs
 *   PATCH /api/campaigns/:id           name / in-game date / settings (GM)
 *   GET   /api/campaigns/:id/devices   joined devices, for revoking (GM, FR1.3)
 *
 * Creation, invites, the join QR and device revocation live in the core auth
 * routes (src/services/auth.ts) because they mint tokens; this plugin owns the
 * rest of the record.
 *
 * Secrecy (Principle 4): `settings` can hold the campaign's Discord webhook,
 * so it is filtered out server-side for non-GM devices — never hidden in the
 * client. The device list is GM-only for the same reason.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { campaigns, devices, scenes, users, type Db } from '@safehouse/db';
import { assertCampaign, httpError, requireAuth, requireRole } from '../services/auth.js';
import { forgetCampaignSettings } from '../services/discord.js';
import { activeSessionId } from '../services/rolls.js';

const PatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  /** Sixth World date, ISO `YYYY-MM-DD` (FR5.7 — the GM advances the clock). */
  ingameDate: z.string().min(4).max(32).nullable().optional(),
  /**
   * Shallow-merged into `campaigns.settings`; an explicit `null` value deletes
   * that key, so the GM can clear the webhook without a replace-the-whole-blob
   * round trip.
   */
  settings: z.record(z.string(), z.unknown()).optional(),
});

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid input', parsed.error.issues);
  return parsed.data;
}

interface CampaignRow {
  id: string;
  name: string;
  gmUserId: string;
  settings: unknown;
  ingameDate: string | null;
  createdAt: Date;
}

async function loadCampaign(db: Db, id: string): Promise<CampaignRow> {
  const row = (await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1))[0];
  if (!row) throw httpError(404, 'not_found', 'unknown campaign');
  return row as CampaignRow;
}

/** The active scene, if the GM has one up (`scenes.state = 'active'`). */
async function activeSceneId(db: Db, campaignId: string): Promise<string | null> {
  const row = (
    await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(and(eq(scenes.campaignId, campaignId), eq(scenes.state, 'active')))
      .limit(1)
  )[0];
  return row?.id ?? null;
}

export default async function campaignsPlugin(app: FastifyInstance): Promise<void> {
  /**
   * The shell's header query: name, clock, what is live. Players get the same
   * shape minus `settings` — house-rule flags are harmless, the webhook is not,
   * and splitting them per key would be a secrecy bug waiting to happen.
   */
  app.get('/api/campaigns/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const row = await loadCampaign(app.db, id);
    const [sceneId, sessionId] = await Promise.all([
      activeSceneId(app.db, id),
      activeSessionId(app.db, id),
    ]);
    return reply.send({
      id: row.id,
      name: row.name,
      ingameDate: row.ingameDate,
      gmUserId: row.gmUserId,
      createdAt: row.createdAt.toISOString(),
      activeSceneId: sceneId,
      activeSessionId: sessionId,
      ...(auth.role === 'gm' ? { settings: (row.settings ?? {}) as Record<string, unknown> } : {}),
    });
  });

  app.patch('/api/campaigns/:id', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const body = parse(PatchBody, req.body);
    const before = await loadCampaign(app.db, id);

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch['name'] = body.name;
    if (body.ingameDate !== undefined) patch['ingameDate'] = body.ingameDate;
    if (body.settings !== undefined) {
      const merged = { ...((before.settings ?? {}) as Record<string, unknown>) };
      for (const [key, value] of Object.entries(body.settings)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      patch['settings'] = merged;
    }
    if (Object.keys(patch).length === 0) throw httpError(400, 'bad_request', 'nothing to update');

    const row = (
      await app.db.update(campaigns).set(patch).where(eq(campaigns.id, id)).returning()
    )[0] as CampaignRow | undefined;
    if (!row) throw httpError(404, 'not_found', 'unknown campaign');

    // The roll path caches settings for 15s; a flag change must bite now.
    if (body.settings !== undefined) forgetCampaignSettings(id);

    // Advancing the clock is table-visible history, not a silent edit (§11).
    if (body.ingameDate !== undefined && body.ingameDate !== before.ingameDate) {
      await app.hub.emit(id, {
        type: 'clock.advanced',
        payload: { campaignId: id, from: before.ingameDate, to: row.ingameDate },
      });
    }

    return reply.send({
      id: row.id,
      name: row.name,
      ingameDate: row.ingameDate,
      gmUserId: row.gmUserId,
      createdAt: row.createdAt.toISOString(),
      settings: (row.settings ?? {}) as Record<string, unknown>,
    });
  });

  /**
   * Every device bound to this campaign, so the GM can spot the phone that
   * walked out of the bar and revoke it (FR1.3 — POST /api/devices/:id/revoke).
   * Token hashes never leave the server.
   */
  app.get('/api/campaigns/:id/devices', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const rows = await app.db
      .select({
        id: devices.id,
        label: devices.label,
        role: devices.role,
        userId: devices.userId,
        userName: users.displayName,
        createdAt: devices.createdAt,
        revokedAt: devices.revokedAt,
      })
      .from(devices)
      .leftJoin(users, eq(users.id, devices.userId))
      .where(eq(devices.campaignId, id));
    return reply.send(
      rows.map((r) => ({
        id: r.id,
        label: r.label,
        role: r.role,
        userId: r.userId,
        userName: r.userName ?? '',
        createdAt: r.createdAt.toISOString(),
        revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      })),
    );
  });
}
