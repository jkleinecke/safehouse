/**
 * encounters domain plugin (M4 + FR10.7–10.9): the combat tracker's REST
 * surface and its two WS commands (`encounter.advance`, `damage.apply`).
 *
 * Everything mutating is GM-only (§13 capability matrix). `GET /api/encounters/:id`
 * is role-aware: GMs get the full tracker, players get turn order, their own
 * monitors, and public condition — GM-hidden combatants are dropped server-side
 * (FR4.9 / Principle 4).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CombatantMonitorsSchema,
  CombatantSourceSchema,
  EdgeStateSchema,
  GruntStateSchema,
  InitKindSchema,
  ProvenanceEntrySchema,
  RollRequestSchema,
  SheetV1Schema,
  StatusEffectSchema,
  VisibilitySchema,
  type Combatant,
  type ProvenanceEntry,
  type RollRequest,
  type SheetWeapon,
} from '@safehouse/contracts';
import { rangeModifier, resolveRoll } from '@safehouse/rules';
import { assertCampaign, httpError, requireAuth, requireRole } from '../services/auth.js';
import { rng } from '../services/dice.js';
import {
  EncountersService,
  encounterForViewer,
  serializeEncounter,
  type EncounterRow,
} from '../services/encounters.js';
import { CombatDamageService } from '../services/encounters-damage.js';
import {
  buildRack,
  bulletsForMode,
  chainActor,
  environmentEntries,
  rackEntry,
  recoilEntry,
  resolveChain,
} from '../services/encounters-copilot.js';

function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw httpError(400, 'bad_request', 'invalid request body', parsed.error.issues);
  }
  return parsed.data;
}

const CreateEncounterBody = z.object({
  name: z.string().min(1).max(200),
  sceneId: z.string().nullable().optional(),
  state: z.enum(['prep', 'live', 'done']).optional(),
});

const PatchEncounterBody = z.object({
  name: z.string().min(1).max(200).optional(),
  sceneId: z.string().nullable().optional(),
  state: z.enum(['prep', 'live', 'done']).optional(),
  turn: z.number().int().min(0).optional(),
  pass: z.number().int().min(0).optional(),
});

const AddCombatantBody = z.object({
  source: CombatantSourceSchema.optional(),
  sourceId: z.string().nullable().optional(),
  name: z.string().min(1).max(200).optional(),
  initBase: z.number().int().optional(),
  initDice: z.number().int().min(0).max(5).optional(),
  initScore: z.number().int().optional(),
  initKind: InitKindSchema.optional(),
  monitors: CombatantMonitorsSchema.optional(),
  visibility: VisibilitySchema.optional(),
  tokenId: z.string().nullable().optional(),
  edge: EdgeStateSchema.optional(),
  grunt: z
    .object({
      size: z.number().int().min(1).max(50),
      professionalRating: z.number().int().min(0).max(10),
      groupEdge: z.number().int().min(0).optional(),
      labelPrefix: z.string().optional(),
    })
    .optional(),
  leader: z.boolean().optional(),
  sheet: SheetV1Schema.optional(),
});

const PatchCombatantBody = z.object({
  name: z.string().min(1).max(200).optional(),
  initBase: z.number().int().optional(),
  initDice: z.number().int().min(0).max(5).optional(),
  initScore: z.number().int().optional(),
  initKind: InitKindSchema.optional(),
  monitors: CombatantMonitorsSchema.optional(),
  visibility: VisibilitySchema.optional(),
  actedThisPass: z.boolean().optional(),
  tokenId: z.string().nullable().optional(),
  edge: EdgeStateSchema.optional(),
  grunt: GruntStateSchema.optional(),
  leader: z.boolean().optional(),
});

const RollInitiativeBody = z.object({
  combatantIds: z.array(z.string()).optional(),
  kinds: z.record(z.string(), InitKindSchema).optional(),
});

const SetInitiativeBody = z.object({
  score: z.number().int().optional(),
  base: z.number().int().optional(),
  dice: z.number().int().min(0).max(5).optional(),
  kind: InitKindSchema.optional(),
});

const InterruptBody = z.object({
  actionId: z.string().optional(),
  cost: z.number().int().optional(),
  name: z.string().optional(),
});

const DamageBody = z.object({
  targetId: z.string(),
  boxes: z.number().int(),
  track: z.enum(['physical', 'stun']).default('physical'),
  memberIndex: z.number().int().min(0).optional(),
  note: z.string().max(500).optional(),
  painTolerance: z.number().int().min(0).optional(),
});

const FromRollBody = z.object({
  targetId: z.string(),
  baseDv: z.number().int().min(0),
  netHits: z.number().int(),
  soakHits: z.number().int().min(0).optional(),
  damageType: z.enum(['P', 'S']).optional(),
  note: z.string().max(500).optional(),
});

const UndoBody = z.object({ combatantId: z.string() });

const QuickRollQuery = z.object({
  mode: z.string().optional(),
  bullets: z.number().int().min(1).max(20).optional(),
});

const QuickRollBody = QuickRollQuery.extend({
  key: z.string().min(1),
  edge: z.enum(['push_pre', 'push_post', 'second_chance']).nullable().optional(),
  edgeDice: z.number().int().min(0).optional(),
  extra: z.array(ProvenanceEntrySchema).optional(),
});

const ChainBody = z.object({
  attackerId: z.string(),
  defenderId: z.string(),
  weaponId: z.string().optional(),
  weaponName: z.string().optional(),
  fullDefense: z.boolean().optional(),
  mode: z.string().optional(),
  bullets: z.number().int().min(1).max(20).optional(),
  distanceM: z.number().min(0).optional(),
  attackModifiers: z.array(ProvenanceEntrySchema).optional(),
  defenseModifiers: z.array(ProvenanceEntrySchema).optional(),
  soakModifiers: z.array(ProvenanceEntrySchema).optional(),
  dvOverride: z.object({ value: z.number().int().min(0), type: z.enum(['P', 'S']) }).optional(),
  apOverride: z.number().int().optional(),
});

const CommitBody = z.object({
  defenderId: z.string(),
  boxes: z.number().int().min(0),
  track: z.enum(['physical', 'stun']).default('physical'),
  memberIndex: z.number().int().min(0).optional(),
  note: z.string().max(500).optional(),
});

export default async function encountersPlugin(app: FastifyInstance): Promise<void> {
  const service = new EncountersService(app.db, app.hub);
  const damage = new CombatDamageService(service);

  /** Load an encounter and check the caller's device is bound to its campaign. */
  async function scope(
    req: FastifyRequest,
    encounterId: string,
    gmOnly = true,
  ): Promise<{ encounter: EncounterRow; auth: ReturnType<typeof requireAuth> }> {
    const auth = gmOnly ? requireRole(req, 'gm') : requireAuth(req);
    const encounter = await service.getEncounter(encounterId);
    assertCampaign(auth, encounter.campaignId);
    return { encounter, auth };
  }

  /** Same, addressed by combatant id. */
  async function combatantScope(req: FastifyRequest, combatantId: string) {
    const row = await service.getCombatant(combatantId);
    const { encounter, auth } = await scope(req, row.encounterId);
    return { row, encounter, auth };
  }

  // --- encounters CRUD (FR4.1) -------------------------------------------
  // INTEGRATION: this domain owns the plain encounter/combatant paths below.
  // The generator domain (FR10.4–10.6) should hang its builder/readout/stage
  // routes off distinct paths (e.g. `/api/encounters/build`,
  // `/api/encounters/:id/threat`, `/api/encounters/:id/stage`) — Fastify
  // refuses to boot on a duplicate route, so a clash is a hard failure.

  app.get('/api/campaigns/:campaignId/encounters', async (req) => {
    const { campaignId } = req.params as { campaignId: string };
    const auth = requireAuth(req);
    assertCampaign(auth, campaignId);
    const rows = await service.listEncounters(campaignId);
    return { encounters: rows.map((r) => serializeEncounter(r)) };
  });

  app.post('/api/campaigns/:campaignId/encounters', async (req, reply) => {
    const { campaignId } = req.params as { campaignId: string };
    const auth = requireRole(req, 'gm');
    assertCampaign(auth, campaignId);
    const body = parse(CreateEncounterBody, req.body);
    const row = await service.createEncounter({ campaignId, ...body });
    return reply.status(201).send({ encounter: serializeEncounter(row) });
  });

  app.get('/api/encounters/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { encounter, auth } = await scope(req, id, false);
    const list = await service.listCombatants(id);
    const owners = await service.ownersFor(list);
    return encounterForViewer(encounter, list, { userId: auth.userId, role: auth.role }, owners);
  });

  app.patch('/api/encounters/:id', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    const row = await service.updateEncounter(id, parse(PatchEncounterBody, req.body));
    return { encounter: serializeEncounter(row) };
  });

  app.delete('/api/encounters/:id', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    await service.deleteEncounter(id);
    return { ok: true };
  });

  // --- combatants (FR4.1 / FR4.6 / FR4.8) --------------------------------

  app.post('/api/encounters/:id/combatants', async (req, reply) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    const combatant = await service.addCombatant(id, parse(AddCombatantBody, req.body));
    return reply.status(201).send({ combatant });
  });

  app.patch('/api/combatants/:id', async (req) => {
    const { id } = req.params as { id: string };
    await combatantScope(req, id);
    return { combatant: await service.updateCombatant(id, parse(PatchCombatantBody, req.body)) };
  });

  app.delete('/api/combatants/:id', async (req) => {
    const { id } = req.params as { id: string };
    await combatantScope(req, id);
    await service.removeCombatant(id);
    return { ok: true };
  });

  // --- initiative + turn engine (FR4.2–4.4) ------------------------------

  app.post('/api/encounters/:id/roll-initiative', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    return service.rollInitiativeAll(id, parse(RollInitiativeBody, req.body));
  });

  app.post('/api/combatants/:id/initiative', async (req) => {
    const { id } = req.params as { id: string };
    await combatantScope(req, id);
    return { combatant: await service.setInitiative(id, parse(SetInitiativeBody, req.body)) };
  });

  app.post('/api/encounters/:id/next-actor', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    return service.nextActor(id);
  });

  app.post('/api/encounters/:id/end-pass', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    const out = await service.endPass(id);
    return { encounter: serializeEncounter(out.encounter), combatants: out.combatants, anyActive: out.anyActive };
  });

  app.post('/api/encounters/:id/new-turn', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    const out = await service.newTurn(id);
    return { encounter: serializeEncounter(out.encounter), combatants: out.combatants };
  });

  app.post('/api/combatants/:id/interrupt', async (req) => {
    const { id } = req.params as { id: string };
    await combatantScope(req, id);
    return service.interrupt(id, parse(InterruptBody, req.body));
  });

  // --- damage (FR4.5 / FR4.6) --------------------------------------------

  app.post('/api/encounters/:id/damage', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    const body = parse(DamageBody, req.body);
    return damage.applyDamage({ encounterId: id, ...body });
  });

  app.post('/api/encounters/:id/damage/from-roll', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    return damage.damageFromRoll({ encounterId: id, ...parse(FromRollBody, req.body) });
  });

  app.post('/api/encounters/:id/damage/undo', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    const { combatantId } = parse(UndoBody, req.body);
    return { combatant: await damage.undoDamage(combatantId) };
  });

  // --- status effects (FR4.7) --------------------------------------------

  app.post('/api/combatants/:id/effects', async (req, reply) => {
    const { id } = req.params as { id: string };
    await combatantScope(req, id);
    const effect = parse(StatusEffectSchema, req.body);
    return reply.status(201).send({ combatant: await service.attachEffect(id, effect) });
  });

  app.delete('/api/combatants/:id/effects/:effectId', async (req) => {
    const { id, effectId } = req.params as { id: string; effectId: string };
    await combatantScope(req, id);
    return { combatant: await service.detachEffect(id, effectId) };
  });

  // --- copilot: quick-roll rack (FR10.7) ---------------------------------

  /** Rack for one combatant, scene modifiers + wound state already folded in. */
  async function rackFor(
    encounter: EncounterRow,
    combatant: Combatant,
    opts: { mode?: string; bullets?: number } = {},
  ) {
    const sheet = await service.sheetFor(combatant);
    if (!sheet) {
      throw httpError(409, 'conflict', 'combatant has no sheet — quick rolls need one (FR10.7)');
    }
    const situational = await service.sceneModifiers(encounter);
    const modes: Record<string, string> = {};
    const bullets: Record<string, number> = {};
    for (const weapon of sheet.weapons) {
      if (opts.mode) modes[weapon.name] = opts.mode;
      if (opts.bullets !== undefined) bullets[weapon.name] = opts.bullets;
    }
    return {
      sheet,
      situational,
      rack: buildRack(sheet, { monitors: combatant.monitors, situational, modes, bullets }),
    };
  }

  app.get('/api/combatants/:id/quick-rolls', async (req) => {
    const { id } = req.params as { id: string };
    const { row, encounter } = await combatantScope(req, id);
    const combatant = await service.combatantIn(row.encounterId, id);
    const query = parse(QuickRollQuery, req.query);
    const { rack } = await rackFor(encounter, combatant, query);
    return {
      combatantId: id,
      woundModifier: rack.woundModifier,
      entries: rack.entries,
      sceneModifiers: environmentEntries(await service.sceneModifiers(encounter)),
    };
  });

  app.post('/api/combatants/:id/quick-roll', async (req) => {
    const { id } = req.params as { id: string };
    const { row, encounter } = await combatantScope(req, id);
    const combatant = await service.combatantIn(row.encounterId, id);
    const body = parse(QuickRollBody, req.body);
    const { rack } = await rackFor(encounter, combatant, body);
    const entry = rackEntry(rack, body.key);
    if (!entry) throw httpError(404, 'not_found', `no quick-roll '${body.key}' on this combatant`);
    const breakdown: ProvenanceEntry[] = [...entry.breakdown, ...(body.extra ?? [])];
    const pool = Math.max(
      0,
      breakdown.reduce((sum, e) => sum + e.value, 0),
    );
    const visibility = combatant.visibility === 'public' ? 'public' : 'gm';
    const request: RollRequest = RollRequestSchema.parse({
      kind: 'simple',
      pool,
      breakdown,
      ...(entry.limit ? { limit: entry.limit } : {}),
      edge: body.edge ?? null,
      visibility,
      actor: { combatantId: id },
      meta: { copilot: entry.key, ...(body.edgeDice ? { edgeDice: body.edgeDice } : {}) },
    });
    const result = resolveRoll(request, rng);
    const { rollId } = await service.recordRoll({
      campaignId: encounter.campaignId,
      combatantId: id,
      kind: entry.kind,
      request: request as unknown as Record<string, unknown>,
      result,
      limit: entry.limit ?? null,
      visibility,
      label: `${combatant.name} — ${entry.label}`,
    });
    return { rollId, entry, request, result };
  });

  // --- copilot: resolved attack chain (FR10.8) ---------------------------

  app.post('/api/encounters/:id/resolve-chain', async (req) => {
    const { id } = req.params as { id: string };
    const { encounter } = await scope(req, id);
    const body = parse(ChainBody, req.body);
    const list = await service.listCombatants(id);
    const attacker = list.find((c) => c.id === body.attackerId);
    const defender = list.find((c) => c.id === body.defenderId);
    if (!attacker || !defender) {
      throw httpError(400, 'bad_request', 'attackerId and defenderId must be in this encounter');
    }
    const attackerSheet = await service.sheetFor(attacker);
    const defenderSheet = await service.sheetFor(defender);
    if (!attackerSheet || !defenderSheet) {
      throw httpError(409, 'conflict', 'both sides need a sheet to resolve a chain (FR10.8)');
    }
    const wanted = body.weaponName ?? body.weaponId;
    const weapon: SheetWeapon | undefined = wanted
      ? attackerSheet.weapons.find((w) => w.name === wanted)
      : attackerSheet.weapons[0];
    if (!weapon) throw httpError(400, 'bad_request', 'attacker has no such weapon');

    const env = environmentEntries(await service.sceneModifiers(encounter));
    const attackModifiers: ProvenanceEntry[] = [...env, ...(body.attackModifiers ?? [])];
    const bullets = body.bullets ?? bulletsForMode(body.mode ?? weapon.modes[0]);
    const recoil = recoilEntry(bullets, weapon.recoilComp ?? 0);
    if (recoil) attackModifiers.push(recoil);
    if (body.distanceM !== undefined && weapon.rangeCat) {
      const range = rangeModifier(body.distanceM, weapon.rangeCat, attackerSheet.rangeTables);
      if (range) {
        attackModifiers.push({
          label: range.note ?? 'range',
          value: range.value,
          source: 'range',
        });
      }
    }
    const outcome = resolveChain(
      chainActor(attackerSheet, attacker.monitors, {
        name: attacker.name,
        weaponName: weapon.name,
      }),
      chainActor(defenderSheet, defender.monitors, { name: defender.name }),
      weapon,
      rng,
      {
        attackModifiers,
        defenseModifiers: [...env, ...(body.defenseModifiers ?? [])],
        ...(body.soakModifiers ? { soakModifiers: body.soakModifiers } : {}),
        ...(body.fullDefense !== undefined ? { fullDefense: body.fullDefense } : {}),
        ...(body.dvOverride ? { dvOverride: body.dvOverride } : {}),
        ...(body.apOverride !== undefined ? { apOverride: body.apOverride } : {}),
      },
    );
    return {
      encounterId: id,
      attackerId: attacker.id,
      defenderId: defender.id,
      weapon: weapon.name,
      bullets,
      cards: outcome.cards,
      suggested: outcome.suggested,
      notes: outcome.result.notes,
      /** Nothing is persisted until POST …/resolve-chain/commit (Principle 2). */
      committed: false,
    };
  });

  app.post('/api/encounters/:id/resolve-chain/commit', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    const body = parse(CommitBody, req.body);
    const outcome = await damage.applyDamage({
      encounterId: id,
      targetId: body.defenderId,
      boxes: body.boxes,
      track: body.track,
      ...(body.memberIndex !== undefined ? { memberIndex: body.memberIndex } : {}),
      note: body.note ?? 'resolved attack chain (FR10.8)',
    });
    return { ...outcome, committed: true };
  });

  // --- WS commands (§11) --------------------------------------------------

  /**
   * `encounter.advance`: the one-button FR4.3 loop — mark the acting combatant
   * done; when the pass is spent, drop every score by 10; when nobody is left
   * above 0, start a new turn (everyone re-rolls).
   */
  app.hub.onCommand('encounter.advance', async (msg, ctx) => {
    if (ctx.auth.role !== 'gm') {
      ctx.reply({ type: 'error', payload: { code: 'forbidden', message: 'GM only' }, ephemeral: true });
      return;
    }
    const encounterId = typeof msg['encounterId'] === 'string' ? msg['encounterId'] : null;
    if (!encounterId) {
      ctx.reply({ type: 'error', payload: { code: 'bad_request', message: 'encounterId required' }, ephemeral: true });
      return;
    }
    const encounter = await service.getEncounter(encounterId);
    if (encounter.campaignId !== ctx.campaignId) return;
    const { active } = await service.nextActor(encounterId);
    if (active) return;
    const pass = await service.endPass(encounterId);
    if (!pass.anyActive) await service.newTurn(encounterId);
  });

  /** `damage.apply`: boxes onto a monitor from the tracker (FR4.5). */
  app.hub.onCommand('damage.apply', async (msg, ctx) => {
    if (ctx.auth.role !== 'gm') {
      ctx.reply({ type: 'error', payload: { code: 'forbidden', message: 'GM only' }, ephemeral: true });
      return;
    }
    const combatantId = typeof msg['combatantId'] === 'string' ? msg['combatantId'] : null;
    const boxes = typeof msg['boxes'] === 'number' ? Math.trunc(msg['boxes']) : null;
    if (!combatantId || boxes === null) {
      ctx.reply({ type: 'error', payload: { code: 'bad_request', message: 'combatantId and boxes required' }, ephemeral: true });
      return;
    }
    const row = await service.getCombatant(combatantId);
    const encounter = await service.getEncounter(row.encounterId);
    if (encounter.campaignId !== ctx.campaignId) return;
    const track = msg['monitor'] === 'stun' ? 'stun' : 'physical';
    if (boxes < 0) {
      await damage.undoDamage(combatantId);
      return;
    }
    await damage.applyDamage({
      encounterId: encounter.id,
      targetId: combatantId,
      boxes,
      track,
      ...(typeof msg['note'] === 'string' ? { note: msg['note'] } : {}),
    });
  });
}
