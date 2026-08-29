/**
 * magic domain plugin (M8: FR8.3 spirit tracker, FR8.4 foci and reagents).
 *
 * Routes:
 *   GET    /api/campaigns/:campaignId/magic                          the whole tracker
 *   POST   /api/campaigns/:campaignId/magic/spirits                  summon
 *   PATCH  /api/campaigns/:campaignId/magic/spirits/:spiritId        hand-edit / bind
 *   POST   /api/campaigns/:campaignId/magic/spirits/:spiritId/services   spend / grant / set
 *   POST   /api/campaigns/:campaignId/magic/spirits/:spiritId/dismiss
 *   POST   /api/campaigns/:campaignId/magic/spirits/:spiritId/sustain    FR8.2 exemption
 *   POST   /api/campaigns/:campaignId/magic/spirits/:spiritId/join       joins an encounter
 *   GET    /api/campaigns/:campaignId/magic/spirits/:spiritId/derived    Force-derived stats
 *   GET    /api/characters/:id/foci                                  a character's rack
 *   POST   /api/characters/:id/foci                                  bond a new focus
 *   PATCH  /api/characters/:id/foci/:focusId                         toggle / edit
 *   DELETE /api/characters/:id/foci/:focusId
 *   POST   /api/characters/:id/reagents                              spend / restock / set
 *   GET    /api/characters/:id/magic/derived                         pools WITH foci folded in
 *
 * Access (§13): every campaign member may read. Writes are the GM's, or the
 * owner's for their own character's spirits, foci and reagents. GM-side
 * spirits (no summoner) are filtered out of player reads server-side, never
 * hidden in the client (Principle 4).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { InitKindSchema, ModifierSchema, RefSchema, SkillAttrSchema, VisibilitySchema } from '@safehouse/contracts';
import { assertCampaign, httpError, requireAuth, type AuthContext } from '../services/auth.js';
import {
  assertCanEdit,
  assertCanView,
  requireCharacter,
  type CharacterRecord,
} from '../services/characters.js';
import {
  addFocus,
  deriveSpiritRecord,
  deriveWithMagic,
  dismissSpirit,
  fociFor,
  getMagicTracker,
  magicStateForViewer,
  patchFocus,
  patchSpirit,
  reagentOp,
  reagentsFor,
  readMagicState,
  removeFocus,
  requireFocus,
  requireSpirit,
  setSpiritSustaining,
  spiritJoinsEncounter,
  spiritServiceOp,
  summonSpirit,
  type SpiritRecord,
} from '../services/magic.js';

function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw httpError(400, 'bad_request', 'invalid request body', parsed.error.issues);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

const AttributeOffsets = z.record(z.string(), z.number().int().min(-12).max(12));
const SkillsBody = z
  .array(
    z.object({
      id: z.string().min(1).max(60),
      attr: SkillAttrSchema,
      rating: z.number().int().min(0).max(24).optional(),
    }),
  )
  .max(24);
const PowersBody = z
  .array(
    z.object({
      name: z.string().min(1).max(120),
      rating: z.number().int().optional(),
      mods: z.array(ModifierSchema).max(12).default([]),
      note: z.string().max(300).optional(),
    }),
  )
  .max(24);

const SummonBody = z.object({
  characterId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(120).optional(),
  spiritType: z.string().min(1).max(80),
  force: z.number().int().min(1).max(24),
  bound: z.boolean().optional(),
  services: z.number().int().min(0).max(999).optional(),
  attributeOffsets: AttributeOffsets.optional(),
  skills: SkillsBody.optional(),
  initiativeDice: z.number().int().min(0).max(5).optional(),
  edge: z.number().int().min(0).max(24).optional(),
  powers: PowersBody.optional(),
  note: z.string().max(500).optional(),
});

const SpiritPatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  spiritType: z.string().min(1).max(80).optional(),
  force: z.number().int().min(1).max(24).optional(),
  bound: z.boolean().optional(),
  attributeOffsets: AttributeOffsets.optional(),
  skills: SkillsBody.optional(),
  initiativeDice: z.number().int().min(0).max(5).optional(),
  edge: z.number().int().min(0).max(24).optional(),
  powers: PowersBody.optional(),
  note: z.string().max(500).optional(),
  status: z.enum(['summoned', 'dismissed']).optional(),
});

const ServiceBody = z.object({
  op: z.enum(['spend', 'grant', 'set']).default('spend'),
  count: z.number().int().min(0).max(999).default(1),
  reason: z.string().max(300).optional(),
});

const SustainBody = z.object({ sustainedId: z.string().min(1).max(120).nullable() });

const JoinBody = z.object({
  encounterId: z.string().uuid(),
  initKind: InitKindSchema.optional(),
  visibility: VisibilitySchema.optional(),
  tokenId: z.string().uuid().nullable().optional(),
});

const FocusBody = z.object({
  name: z.string().min(1).max(120),
  kind: z.string().max(60).optional(),
  force: z.number().int().min(0).max(12).optional(),
  bonded: z.boolean().optional(),
  active: z.boolean().optional(),
  sourceKind: z.enum(['power', 'spell']).optional(),
  targets: z.array(z.string().min(1).max(80)).max(12).optional(),
  mods: z.array(ModifierSchema).max(12).optional(),
  ref: RefSchema.optional(),
  note: z.string().max(300).optional(),
});
const FocusPatchBody = FocusBody.partial();

const ReagentBody = z.object({
  op: z.enum(['spend', 'restock', 'set']).default('spend'),
  amount: z.number().int().min(0).max(99_999).default(1),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default async function magicPlugin(app: FastifyInstance): Promise<void> {
  function campaignScope(req: FastifyRequest): { auth: AuthContext; campaignId: string } {
    const auth = requireAuth(req);
    const { campaignId } = req.params as { campaignId: string };
    assertCampaign(auth, campaignId);
    return { auth, campaignId };
  }

  /** A character route: load the character and check the viewer may see it. */
  async function characterScope(
    req: FastifyRequest,
    mutate: boolean,
  ): Promise<{ auth: AuthContext; rec: CharacterRecord }> {
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const rec = await requireCharacter(app.db, id);
    if (mutate) assertCanEdit(auth, rec);
    else assertCanView(auth, rec);
    return { auth, rec };
  }

  /**
   * A player may drive a spirit only when it is their own character's. A
   * GM-side spirit (no summoner) is the GM's alone.
   */
  async function assertSpiritControl(auth: AuthContext, spirit: SpiritRecord): Promise<void> {
    if (auth.role === 'gm') return;
    if (!spirit.characterId) throw httpError(404, 'not_found', 'unknown spirit');
    const owner = await requireCharacter(app.db, spirit.characterId);
    assertCanEdit(auth, owner);
  }

  async function loadSpirit(req: FastifyRequest, mutate: boolean) {
    const { auth, campaignId } = campaignScope(req);
    const { spiritId } = req.params as { spiritId: string };
    const state = await readMagicState(app.db, campaignId);
    const spirit = requireSpirit(state, spiritId);
    if (spirit.characterId === null && auth.role !== 'gm') {
      // Never confirm a GM-side spirit exists (Principle 4).
      throw httpError(404, 'not_found', 'unknown spirit');
    }
    if (mutate) await assertSpiritControl(auth, spirit);
    return { auth, campaignId, spirit };
  }

  // --- the whole tracker --------------------------------------------------
  app.get('/api/campaigns/:campaignId/magic', async (req, reply) => {
    const { auth, campaignId } = campaignScope(req);
    const state = magicStateForViewer(await readMagicState(app.db, campaignId), auth.role);
    return reply.send({
      campaignId,
      spirits: state.spirits,
      foci: state.foci,
      reagents: state.reagents,
      scope: auth.role === 'gm' ? 'gm' : 'player',
    });
  });

  /** The Fixer-shaped read, also useful to the GM screen. */
  app.get('/api/campaigns/:campaignId/magic/tracker', async (req, reply) => {
    const { auth, campaignId } = campaignScope(req);
    if (auth.role !== 'gm') throw httpError(403, 'forbidden', 'requires role: gm');
    return reply.send(await getMagicTracker(app.db, campaignId));
  });

  // --- spirits (FR8.3) ----------------------------------------------------
  app.post('/api/campaigns/:campaignId/magic/spirits', async (req, reply) => {
    const { auth, campaignId } = campaignScope(req);
    const body = parse(SummonBody, req.body);
    if (body.characterId) {
      const owner = await requireCharacter(app.db, body.characterId);
      assertCanEdit(auth, owner);
    } else if (auth.role !== 'gm') {
      throw httpError(403, 'forbidden', 'a player summons for one of their own characters');
    }
    const spirit = await summonSpirit(app.db, app.hub, campaignId, body);
    return reply.status(201).send({ spirit, derived: deriveSpiritRecord(spirit) });
  });

  app.patch('/api/campaigns/:campaignId/magic/spirits/:spiritId', async (req, reply) => {
    const { campaignId, spirit } = await loadSpirit(req, true);
    const next = await patchSpirit(app.db, app.hub, campaignId, spirit.id, parse(SpiritPatchBody, req.body));
    return reply.send({ spirit: next, derived: deriveSpiritRecord(next) });
  });

  app.get('/api/campaigns/:campaignId/magic/spirits/:spiritId/derived', async (req, reply) => {
    const { spirit } = await loadSpirit(req, false);
    return reply.send({ spirit, derived: deriveSpiritRecord(spirit) });
  });

  /** One tap: spend a service. Floors at zero, reports the shortfall. */
  app.post('/api/campaigns/:campaignId/magic/spirits/:spiritId/services', async (req, reply) => {
    const { campaignId, spirit } = await loadSpirit(req, true);
    return reply.send(await spiritServiceOp(app.db, app.hub, campaignId, spirit.id, parse(ServiceBody, req.body)));
  });

  app.post('/api/campaigns/:campaignId/magic/spirits/:spiritId/dismiss', async (req, reply) => {
    const { campaignId, spirit } = await loadSpirit(req, true);
    return reply.send({ spirit: await dismissSpirit(app.db, app.hub, campaignId, spirit.id) });
  });

  /** A spirit takes over a sustained spell — the caster stops eating the −2 (FR8.2). */
  app.post('/api/campaigns/:campaignId/magic/spirits/:spiritId/sustain', async (req, reply) => {
    const { campaignId, spirit } = await loadSpirit(req, true);
    const body = parse(SustainBody, req.body);
    const next = await setSpiritSustaining(app.db, app.hub, campaignId, spirit.id, body.sustainedId);
    const owner = next.characterId ? await requireCharacter(app.db, next.characterId) : null;
    return reply.send({
      spirit: next,
      ...(owner ? { derived: await deriveWithMagic(app.db, owner) } : {}),
    });
  });

  /** The spirit joins the fight as a combatant, Force-derived (FR8.3 → M4). */
  app.post('/api/campaigns/:campaignId/magic/spirits/:spiritId/join', async (req, reply) => {
    const { auth, campaignId, spirit } = await loadSpirit(req, true);
    if (auth.role !== 'gm') throw httpError(403, 'forbidden', 'the GM puts figures on the tracker');
    const out = await spiritJoinsEncounter(app.db, app.hub, campaignId, spirit.id, parse(JoinBody, req.body));
    return reply.status(201).send(out);
  });

  // --- foci (FR8.4) -------------------------------------------------------
  app.get('/api/characters/:id/foci', async (req, reply) => {
    const { rec } = await characterScope(req, false);
    const state = await readMagicState(app.db, rec.campaignId);
    return reply.send({
      characterId: rec.id,
      foci: fociFor(state, rec.id),
      reagents: reagentsFor(state, rec.id),
    });
  });

  app.post('/api/characters/:id/foci', async (req, reply) => {
    const { rec } = await characterScope(req, true);
    const focus = await addFocus(app.db, app.hub, rec.campaignId, rec.id, parse(FocusBody, req.body));
    return reply.status(201).send({ focus, derived: await deriveWithMagic(app.db, rec) });
  });

  app.patch('/api/characters/:id/foci/:focusId', async (req, reply) => {
    const { rec } = await characterScope(req, true);
    const { focusId } = req.params as { focusId: string };
    const state = await readMagicState(app.db, rec.campaignId);
    const current = requireFocus(state, focusId);
    if (current.characterId !== rec.id) throw httpError(404, 'not_found', 'unknown focus');
    const focus = await patchFocus(app.db, app.hub, rec.campaignId, focusId, parse(FocusPatchBody, req.body));
    return reply.send({ focus, derived: await deriveWithMagic(app.db, rec) });
  });

  app.delete('/api/characters/:id/foci/:focusId', async (req, reply) => {
    const { rec } = await characterScope(req, true);
    const { focusId } = req.params as { focusId: string };
    const state = await readMagicState(app.db, rec.campaignId);
    const current = requireFocus(state, focusId);
    if (current.characterId !== rec.id) throw httpError(404, 'not_found', 'unknown focus');
    await removeFocus(app.db, app.hub, rec.campaignId, focusId);
    return reply.send({ removed: focusId, derived: await deriveWithMagic(app.db, rec) });
  });

  // --- reagents (FR8.4) ---------------------------------------------------
  app.post('/api/characters/:id/reagents', async (req, reply) => {
    const { rec } = await characterScope(req, true);
    return reply.send(await reagentOp(app.db, app.hub, rec.campaignId, rec.id, parse(ReagentBody, req.body)));
  });

  // --- the pools a mage actually plays with -------------------------------
  app.get('/api/characters/:id/magic/derived', async (req, reply) => {
    const { rec } = await characterScope(req, false);
    return reply.send(await deriveWithMagic(app.db, rec));
  });
}
