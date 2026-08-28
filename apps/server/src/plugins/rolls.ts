/**
 * rolls domain plugin (M2 — DESIGN.md §10.1, §12, FR2.1–2.9).
 *
 * WS: `roll.request` — the live-play path; every frame is validated, the pool
 * is recomputed server-side, and the result comes back to the table as a
 * visibility-filtered `roll.created` event (never as a direct reply, so one
 * code path serves sender and spectators alike).
 *
 * REST:
 *   POST /api/rolls                      roll (same service as the WS command)
 *   POST /api/rolls/buy-hits             4 dice : 1 hit, no dice (FR2.4)
 *   GET  /api/rolls/:id                  one roll, visibility-checked
 *   GET  /api/campaigns/:id/rolls        paginated roll log (?session=&limit=&before=)
 *   POST /api/campaigns/:id/log          table talk / scene marker (FR2.9)
 *   GET  /api/campaigns/:id/log          interleaved log slice, server-filtered
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { VisibilitySchema } from '@safehouse/contracts';
import { recentEvents } from '@safehouse/db';
import { canSee } from '../hub.js';
import { assertCampaign, httpError, requireAuth } from '../services/auth.js';
import { getRollService, type RollViewer } from '../services/rolls.js';

const LogPostBody = z.object({
  /** 'talk' (table talk), 'marker' (scene framing), or a caller-defined tag. */
  kind: z.string().min(1).max(32).default('talk'),
  text: z.string().min(1).max(4000),
  visibility: VisibilitySchema.default('public'),
});

const ListQuery = z.object({
  session: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().optional(),
});

/** The campaign this device is bound to (§13 — one campaign per token). */
function campaignOf(req: FastifyRequest): { campaignId: string; viewer: RollViewer } {
  const auth = requireAuth(req);
  if (!auth.campaignId) throw httpError(403, 'forbidden', 'device is not bound to a campaign');
  return { campaignId: auth.campaignId, viewer: { userId: auth.userId, role: auth.role } };
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid input', parsed.error.issues);
  return parsed.data;
}

export default async function rollsPlugin(app: FastifyInstance): Promise<void> {
  const svc = getRollService(app.db, app.hub, app.log);

  // --- WS: roll.request (§10.1) -------------------------------------------
  app.hub.onCommand('roll.request', async (msg, ctx) => {
    try {
      const roll = await svc.performRoll({
        campaignId: ctx.campaignId,
        viewer: { userId: ctx.auth.userId, role: ctx.auth.role },
        input: msg,
      });
      // The roll itself reaches everyone entitled to it via `roll.created`;
      // the ack just closes the sender's optimistic-UI loop.
      ctx.reply({ type: 'roll.ack', payload: { rollId: roll.id }, ephemeral: true });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      ctx.reply({
        type: 'error',
        payload: { code: e.code ?? 'roll_failed', message: e.message ?? 'roll failed' },
        ephemeral: true,
      });
    }
  });

  // --- REST ----------------------------------------------------------------
  app.post('/api/rolls', async (req, reply) => {
    const { campaignId, viewer } = campaignOf(req);
    const roll = await svc.performRoll({ campaignId, viewer, input: req.body });
    return reply.status(201).send({ roll });
  });

  app.post('/api/rolls/buy-hits', async (req, reply) => {
    const { campaignId, viewer } = campaignOf(req);
    const roll = await svc.buyHits({ campaignId, viewer, input: req.body });
    return reply.status(201).send({ roll });
  });

  app.get('/api/rolls/:id', async (req, reply) => {
    const { campaignId, viewer } = campaignOf(req);
    const { id } = req.params as { id: string };
    const roll = await svc.getRoll(campaignId, viewer, id);
    if (!roll) throw httpError(404, 'not_found', 'unknown roll');
    return reply.send({ roll });
  });

  app.get('/api/campaigns/:id/rolls', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const q = parse(ListQuery, req.query);
    const page = await svc.listRolls(
      id,
      { userId: auth.userId, role: auth.role },
      {
        ...(q.session ? { sessionId: q.session } : {}),
        ...(q.limit !== undefined ? { limit: q.limit } : {}),
        ...(q.before ? { before: q.before } : {}),
      },
    );
    return reply.send(page);
  });

  // Table talk and scene markers — the log's non-dice half (FR2.9).
  app.post('/api/campaigns/:id/log', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    if (auth.role !== 'gm' && auth.role !== 'player') {
      throw httpError(403, 'forbidden', 'observers may not post to the log');
    }
    const body = parse(LogPostBody, req.body);
    if (body.visibility === 'gm' && auth.role !== 'gm') {
      throw httpError(403, 'forbidden', 'only the GM posts GM-only log lines');
    }
    const posted = await svc.postLog({
      campaignId: id,
      kind: body.kind,
      text: body.text,
      visibility: body.visibility,
      ownerUserId: auth.userId,
      by: { userId: auth.userId, displayName: auth.displayName },
    });
    return reply.status(201).send({ event: posted });
  });

  // The interleaved session log (rolls, damage, ledger, markers) — filtered
  // server-side before it ever hits the wire (Principle 4).
  app.get('/api/campaigns/:id/log', async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertCampaign(auth, id);
    const q = (req.query ?? {}) as Record<string, unknown>;
    const limit = Math.min(500, Math.max(1, Number(q['limit'] ?? 100) || 100));
    const wanted =
      typeof q['types'] === 'string' && q['types'].length > 0
        ? new Set(q['types'].split(',').map((s) => s.trim()))
        : null;
    const rows = await recentEvents(app.db, id, limit);
    const events = rows
      .filter((row) => canSee(auth, { visibility: row.visibility, ownerUserId: row.ownerUserId }))
      .filter((row) => !wanted || wanted.has(row.type))
      .map((row) => ({
        id: row.id,
        type: row.type,
        payload: row.payload,
        visibility: row.visibility,
        ...(row.ownerUserId ? { ownerUserId: row.ownerUserId } : {}),
        ts: row.createdAt.toISOString(),
      }));
    return reply.send({ events });
  });
}
