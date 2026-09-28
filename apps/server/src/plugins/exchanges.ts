/**
 * Attack exchanges the GM drives: opened by hand for table dice, applied,
 * cancelled, undone. Defenses and soaks arrive through /api/cards/settle.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ExchangeApplyRequestSchema, ExchangeOpenRequestSchema } from '@safehouse/contracts';
import { assertCampaign, httpError, requireAuth, requireRole } from '../services/auth.js';
import { EncountersService } from '../services/encounters.js';
import { CombatDamageService } from '../services/encounters-damage.js';
import { ExchangesService } from '../services/exchanges.js';
import { loadActor } from '../services/roll-cards-load.js';

function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid request', parsed.error.issues);
  return parsed.data;
}

const IdParams = z.object({ id: z.string().min(1) });

export default async function exchangesPlugin(app: FastifyInstance): Promise<void> {
  const encounters = new EncountersService(app.db, app.hub);
  const service = new ExchangesService({
    db: app.db,
    hub: app.hub,
    encounters,
    damage: new CombatDamageService(encounters),
  });

  async function gmScope(req: FastifyRequest): Promise<string> {
    const { id } = parse(IdParams, req.params);
    const auth = requireRole(req, 'gm');
    assertCampaign(auth, (await service.load(id)).campaignId);
    return id;
  }

  /** "Ari shot the bouncer: 4 hits, 8P, AP −1" — any target on the tracker. */
  app.post('/api/exchanges', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const body = parse(ExchangeOpenRequestSchema, req.body);
    const target = await loadActor(app.db, body.target);
    assertCampaign(auth, target.campaignId);
    const attacker = body.attacker ? await loadActor(app.db, body.attacker) : null;
    if (attacker && attacker.campaignId !== target.campaignId) throw httpError(404, 'not_found', 'unknown attacker');
    return reply.status(201).send({ exchange: await service.openByHand(body, target, attacker) });
  });

  /** A player gets their own side only, and nothing of an exchange their runner is not in. */
  app.get('/api/exchanges/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const auth = requireAuth(req);
    const { x, campaignId } = await service.load(id);
    assertCampaign(auth, campaignId);
    const copy = await service.copyFor({ userId: auth.userId, role: auth.role }, x);
    if (!copy) throw httpError(404, 'not_found', 'unknown exchange');
    return { exchange: copy };
  });

  app.post('/api/exchanges/:id/apply', async (req) => {
    const id = await gmScope(req);
    return { exchange: await service.apply(id, parse(ExchangeApplyRequestSchema, req.body)) };
  });

  app.post('/api/exchanges/:id/cancel', async (req) => {
    return { exchange: await service.cancel(await gmScope(req)) };
  });

  app.post('/api/exchanges/:id/undo', async (req) => {
    return { exchange: await service.undo(await gmScope(req)) };
  });
}
