/**
 * Guided roll cards: the actions an actor can take, and a card built for one
 * (services/roll-cards.ts). No dice here.
 *
 * The GM may use any actor; a player only their own runner, and never learns
 * more of a target than its name.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AttackKindSchema,
  CardActorKindSchema,
  CardRequestSchema,
  type CardActorRef,
} from '@safehouse/contracts';
import { assertCampaign, httpError, requireAuth } from '../services/auth.js';
import { buildCard, listActions, type CardTarget } from '../services/roll-cards.js';
import { loadActor, type LoadedActor } from '../services/roll-cards-load.js';
import { ScenesService } from '../services/scenes.js';

function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid request', parsed.error.issues);
  return parsed.data;
}

const ActorParams = z.object({ kind: CardActorKindSchema, id: z.string().min(1) });
const ActionsQuery = z.object({ against: AttackKindSchema.optional() });

export default async function rollCardsPlugin(app: FastifyInstance): Promise<void> {
  async function actorFor(req: FastifyRequest, ref: CardActorRef) {
    const auth = requireAuth(req);
    const loaded = await loadActor(app.db, ref);
    assertCampaign(auth, loaded.campaignId);
    if (auth.role !== 'gm') {
      const mine = await app.authService.characterOwnedBy(loaded.campaignId, auth.userId);
      if (!mine || loaded.characterId !== mine) {
        throw httpError(403, 'forbidden', 'a player builds cards for their own runner only');
      }
    }
    return { gm: auth.role === 'gm', loaded };
  }

  /** What the table can see of a target; a hidden one does not exist for a player. */
  async function onTable(ref: CardActorRef, t: LoadedActor): Promise<boolean> {
    if (t.hidden) return false;
    if (ref.kind !== 'token') return true;
    return (await new ScenesService(app.db).tokensOnTable([ref.id])).has(ref.id);
  }

  /** `?against=ranged` orders the defenses for that attack; nothing is left out. */
  app.get('/api/actors/:kind/:id/actions', async (req) => {
    const params = parse(ActorParams, req.params);
    const { against } = parse(ActionsQuery, req.query);
    const { gm, loaded } = await actorFor(req, params);
    return listActions(loaded.body, { gm, scene: loaded.scene, ...(against ? { against } : {}) });
  });

  app.post('/api/cards/preview', async (req) => {
    const body = parse(CardRequestSchema, req.body);
    const { gm, loaded } = await actorFor(req, body.actor);
    let target: CardTarget | null = null;
    if (body.target) {
      const t = await loadActor(app.db, body.target);
      if (t.campaignId !== loaded.campaignId || (!gm && !(await onTable(body.target, t)))) {
        throw httpError(404, 'not_found', 'unknown target');
      }
      target = {
        actor: t.body.actor,
        ...(t.body.token ? { token: t.body.token } : {}),
        ...(t.body.prone ? { prone: true } : {}),
      };
    }
    // exchangeId: read here once exchanges are stored; buildCard already takes one.
    return { card: buildCard({ body: loaded.body, req: body, gm, scene: loaded.scene, target }) };
  });
}
