/**
 * Guided roll cards: an actor's actions, a card for one, and settling it.
 * The GM may act for anyone; a player only for their own runner, and learns
 * no more of a target than its name.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AttackKindSchema,
  CardActorKindSchema,
  CardRequestSchema,
  CardSettleRequestSchema,
  type CardActorRef,
  type CardRequest,
  type DeclaredBy,
  type Exchange,
} from '@safehouse/contracts';
import { combatAction } from '@safehouse/rules';
import { assertCampaign, httpError, requireAuth } from '../services/auth.js';
import { EncountersService } from '../services/encounters.js';
import { CombatDamageService } from '../services/encounters-damage.js';
import { ExchangesService } from '../services/exchanges.js';
import { buildCard, listActions, type CardTarget } from '../services/roll-cards.js';
import { loadActor, type LoadedActor } from '../services/roll-cards-load.js';
import { settleCard } from '../services/roll-cards-settle.js';
import { getRollService } from '../services/rolls.js';
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
    return { gm: auth.role === 'gm', loaded, viewer: { userId: auth.userId, role: auth.role } };
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

  async function targetFor(ref: CardActorRef | undefined, loaded: LoadedActor, gm: boolean) {
    if (!ref) return null;
    const t = await loadActor(app.db, ref);
    if (t.campaignId !== loaded.campaignId || (!gm && !(await onTable(ref, t)))) {
      throw httpError(404, 'not_found', 'unknown target');
    }
    const target: CardTarget = {
      actor: t.body.actor,
      ...(t.body.token ? { token: t.body.token } : {}),
      ...(t.body.prone ? { prone: true } : {}),
    };
    return { target, loaded: t };
  }

  const encounters = new EncountersService(app.db, app.hub);
  const exchanges = new ExchangesService({
    db: app.db,
    hub: app.hub,
    encounters,
    damage: new CombatDamageService(encounters),
  });

  /** A player reaches only an exchange their runner is in, and answers only one aimed at it. */
  async function exchangeFor(body: CardRequest, loaded: LoadedActor, gm: boolean): Promise<Exchange | null> {
    if (!body.exchangeId) return null;
    const { x, campaignId } = await exchanges.load(body.exchangeId);
    if (campaignId !== loaded.campaignId) throw httpError(404, 'not_found', 'unknown exchange');
    if (gm) return x;
    const mine = loaded.row?.combatantId;
    const target = mine !== undefined && x.target.combatantId === mine;
    if (!target && !(mine !== undefined && x.attacker?.combatantId === mine)) {
      throw httpError(404, 'not_found', 'unknown exchange');
    }
    const answers = combatAction(body.actionId)?.exchange;
    if (!target && (answers === 'defends' || answers === 'soaks')) {
      throw httpError(403, 'forbidden', 'a player answers only an attack on their own runner');
    }
    return x;
  }

  app.post('/api/cards/preview', async (req) => {
    const body = parse(CardRequestSchema, req.body);
    const { gm, loaded } = await actorFor(req, body.actor);
    const t = await targetFor(body.target, loaded, gm);
    const exchange = await exchangeFor(body, loaded, gm);
    return {
      card: buildCard({ body: loaded.body, req: body, gm, scene: loaded.scene, target: t?.target ?? null, exchange }),
    };
  });

  const deps = {
    db: app.db,
    hub: app.hub,
    rolls: getRollService(app.db, app.hub, app.log),
    encounters,
    exchanges,
  };

  /** The GM may settle for anyone, with any dice; `forActorBy` is theirs alone to set. */
  app.post('/api/cards/settle', async (req, reply) => {
    const body = parse(CardSettleRequestSchema, req.body);
    const { gm, loaded, viewer } = await actorFor(req, body.actor);
    const t = await targetFor(body.target, loaded, gm);
    const exchange = await exchangeFor(body, loaded, gm);
    const by: DeclaredBy = gm
      ? (body.forActorBy ?? { role: 'gm', name: 'GM' })
      : { role: 'player', name: loaded.body.actor.name };
    const card = buildCard({
      body: loaded.body,
      req: { ...body, stage: 'dice' },
      gm,
      scene: loaded.scene,
      target: t?.target ?? null,
      exchange,
      by,
    });
    const out = await settleCard(deps, { viewer, loaded, req: body, card, by, target: t?.loaded ?? null, exchange });
    if (out.exchange && !gm) {
      const copy = await exchanges.copyFor(viewer, out.exchange);
      if (copy) out.exchange = copy;
      else delete out.exchange;
    }
    return reply.status(201).send(out);
  });
}
