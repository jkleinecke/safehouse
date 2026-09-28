/**
 * encounters domain plugin (M4 + FR10.7–10.9): the combat tracker's REST
 * surface and its two WS commands (`encounter.advance`, `damage.apply`).
 *
 * Everything mutating is GM-only (§13 capability matrix). `GET /api/encounters/:id`
 * is role-aware: GMs get the full tracker, players get turn order, their own
 * monitors, and public condition — GM-hidden combatants are dropped server-side
 * (FR4.9 / Principle 4).
 *
 * The acting order is the server's (`turnOrder` in every view and frame): the
 * GM moves rows by PLACE (`POST /api/encounters/:id/order`), holds a Delayed
 * Action (`POST /api/combatants/:id/delay`), and "Next" carries the id of the
 * row the GM saw acting, so a double press cannot skip anyone (SR5 p.159-161).
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
import { bulletsForMode, isMeleeSkill, rangeModifier, recoilLine, resolveRoll } from '@safehouse/rules';
import { assertCampaign, httpError, requireAuth, requireRole } from '../services/auth.js';
import { rng } from '../services/dice.js';
import {
  EncountersService,
  encounterForViewer,
  serializeEncounter,
  withTableVisibility,
  type EncounterRow,
} from '../services/encounters.js';
import { CombatDamageService } from '../services/encounters-damage.js';
import { InitiativeCallService } from '../services/initiative-call.js';
import { copiesFor, openExchanges } from '../services/exchanges-model.js';
import { ScenesService } from '../services/scenes.js';
import { hintForCombatant } from '../services/tactical-hints.js';
import {
  buildRack,
  chainActor,
  environmentCompensation,
  environmentEntries,
  rackEntry,
  sceneEntries,
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
  /** The table rolls initiative with its own dice (FR4.2): stored on the fight. */
  handRolls: z.boolean().optional(),
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
  /**
   * Professional Rating (FR4.6) — the number FR10.9 morale measures pressure
   * against. Accepted on ANY non-PC row, not just grunt groups; without it a
   * hand-added NPC checked morale against PR 0 and broke on the first shot.
   */
  professionalRating: z.number().int().min(0).max(10).optional(),
  grunt: z
    .object({
      size: z.number().int().min(1).max(50),
      /** Legacy spelling of the row's PR; the top-level field wins. */
      professionalRating: z.number().int().min(0).max(10).optional(),
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
  /** Fix a row's PR mid-fight (FR4.8); mirrors onto the grunt group's own. */
  professionalRating: z.number().int().min(0).max(10).optional(),
  /** The row's whole effect list (the tracker's remove chip sends it). */
  effects: z.array(StatusEffectSchema).optional(),
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
  /** The dice total rolled at the table (5d6 at most); the server adds base and wounds. */
  rolled: z.number().int().min(0).max(30).optional(),
});

/** Exactly one: app dice, the table's dice total, or a final score. */
const EnterInitiativeBody = z.union([
  z.object({ app: z.literal(true) }).strict(),
  z.object({ rolled: z.number().int().min(0).max(30) }).strict(),
  z.object({ score: z.number().int() }).strict(),
]);

const NewTurnBody = z.object({
  /**
   * False opens the turn with blank scores for hand rolls (FR4.2), true has
   * the server roll. Left out, the fight's own hand-rolls setting decides.
   */
  roll: z.boolean().optional(),
});

/**
 * Who the GM saw acting when "Next" was pressed (null: nobody). When the
 * order has moved on since, the press does nothing (409 `stale_actor`).
 */
const NextBody = z.object({
  expectedActorId: z.string().nullable().optional(),
});

/** The GM's levers on the order: place only, never a score (SR5 p.159-161). */
const OrderBody = z.union([
  z.object({
    move: z.object({ combatantId: z.string(), toIndex: z.number().int().min(0) }),
  }),
  z.object({ actNow: z.string() }),
  z.object({ sort: z.literal('score') }),
]);

/** Hold a Delayed Action (true, the default), or stop holding it (p.161). */
const DelayBody = z.object({
  delayed: z.boolean().default(true),
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
  visibility: VisibilitySchema.optional(),
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
  const initiative = new InitiativeCallService(service);

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

  /**
   * The runner whose row it is may roll and hand-enter their own initiative
   * (FR4.2 "roll or hand-enter", from their own phone); everyone else's row is
   * the GM's. A row is "theirs" when it is their character's — the one their
   * device is bound to on the roster — and nothing hidden is ever theirs.
   */
  async function ownRowScope(req: FastifyRequest, combatantId: string) {
    const row = await service.getCombatant(combatantId);
    const auth = requireAuth(req);
    const encounter = await service.getEncounter(row.encounterId);
    assertCampaign(auth, encounter.campaignId);
    if (auth.role === 'gm') return { row, encounter, auth };
    const mine = await app.authService.characterOwnedBy(encounter.campaignId, auth.userId);
    if (row.source !== 'character' || row.sourceId === null || row.sourceId !== mine) {
      throw httpError(403, 'forbidden', 'only the GM, or the runner whose row it is, may set initiative');
    }
    return { row, encounter, auth };
  }

  // --- encounters CRUD (FR4.1) -------------------------------------------
  // This domain owns the plain encounter/combatant paths below; the generator
  // domain (FR10.4–10.6) hangs its builder/readout routes off distinct paths
  // (`/api/encounters/build`, `/api/encounters/:id/threat`). Fastify refuses to
  // boot on a duplicate route, so any clash here fails loudly at startup rather
  // than quietly at the table.

  app.get('/api/campaigns/:campaignId/encounters', async (req) => {
    const { campaignId } = req.params as { campaignId: string };
    const auth = requireAuth(req);
    assertCampaign(auth, campaignId);
    const rows = await service.listEncounters(campaignId);
    // A list entry carries no rows, so a player's copy of a manual order
    // names nobody (`[]`: "the GM arranged it"); the ids could be hidden ones.
    const visible = auth.role === 'gm' ? undefined : new Set<string>();
    return { encounters: rows.map((r) => serializeEncounter(r, visible)) };
  });

  app.post('/api/campaigns/:campaignId/encounters', async (req, reply) => {
    const { campaignId } = req.params as { campaignId: string };
    const auth = requireRole(req, 'gm');
    assertCampaign(auth, campaignId);
    const body = parse(CreateEncounterBody, req.body);
    const row = await service.createEncounter({ campaignId, ...body });
    return reply.status(201).send({ encounter: serializeEncounter(row) });
  });

  /**
   * The tracker's hydrate call. Both scopes:
   *   { encounter, state, turn, pass (mirrors of encounter.*), combatants,
   *     activeCombatantId, turnOrder, gmTurn? (player: a hidden row acts), scope, exchanges }
   */
  app.get('/api/encounters/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { encounter, auth } = await scope(req, id, false);
    const list = await service.listCombatants(id);
    const owners = await service.ownersFor(list);
    // The tokens the table has now: a token row is public exactly then (`encounterForViewer`).
    const onTable = await new ScenesService(app.db).tokensOnTable(list.flatMap((c) => (c.tokenId ? [c.tokenId] : [])));
    const view = encounterForViewer(
      encounter,
      list,
      { userId: auth.userId, role: auth.role },
      owners,
      onTable,
      // ERIC (SR5 p.159) off the sheets of rows that tie, so this read draws
      // the same order the frames do.
      await service.ericFor(list),
    );
    const open = await openExchanges(app.db, id);
    const hidden = new Set(withTableVisibility(list, onTable).filter((c) => c.visibility !== 'public').map((c) => c.id));
    return {
      ...view,
      // A player's copies carry only their own side (Principle 3).
      exchanges: auth.role === 'gm' ? open : copiesFor(open, auth.userId, owners, hidden),
      state: view.encounter.state,
      turn: view.encounter.turn,
      pass: view.encounter.pass,
    };
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
    const { effects, ...patch } = parse(PatchCombatantBody, req.body);
    let combatant = Object.keys(patch).length > 0 || !effects ? await service.updateCombatant(id, patch) : null;
    if (effects) combatant = await service.setEffects(id, effects);
    return { combatant };
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
    const body = parse(RollInitiativeBody, req.body);
    const { auth } = await scope(req, id, false);
    if (auth.role !== 'gm') {
      // A player rolls their own row and nothing else (FR4.2).
      if (!body.combatantIds || body.combatantIds.length === 0) {
        throw httpError(403, 'forbidden', 'only the GM rolls initiative for the table');
      }
      for (const combatantId of body.combatantIds) await ownRowScope(req, combatantId);
      // Their own dice, and nothing else: the full roster (hidden rows, NPC
      // sheets, the manual order) is the GM's. The table sees the result in
      // the public `encounter.updated` frame like everyone else (FR4.9).
      const out = await service.rollInitiativeAll(id, { ...body, by: 'player' });
      return { details: out.details };
    }
    return service.rollInitiativeAll(id, body);
  });

  app.post('/api/combatants/:id/initiative', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(SetInitiativeBody, req.body);
    const { auth } = await ownRowScope(req, id);
    // The line itself — base, dice, kind — stays the GM's; a player enters what they rolled.
    if (auth.role !== 'gm' && (body.base !== undefined || body.dice !== undefined || body.kind !== undefined)) {
      throw httpError(403, 'forbidden', 'only the GM changes an initiative line');
    }
    return { combatant: await service.setInitiative(id, { ...body, by: auth.role === 'gm' ? 'gm' : 'player' }) };
  });

  // --- guided initiative: call, recipes, entries, NPCs, start -------------

  /** Call for initiative (fight start or a new Combat Turn): the fight gathers, every row's recipe comes back. */
  app.post('/api/encounters/:id/initiative/call', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    return initiative.call(id);
  });

  /** The recipes: the GM gets every row, a player only their own runner's. */
  app.get('/api/encounters/:id/initiative', async (req) => {
    const { id } = req.params as { id: string };
    const { encounter, auth } = await scope(req, id, false);
    if (auth.role === 'gm') return initiative.view(id);
    const mine = await app.authService.characterOwnedBy(encounter.campaignId, auth.userId);
    return initiative.view(id, (c) => mine !== null && c.source === 'character' && c.sourceId === mine);
  });

  /** One row's score: the GM for anyone, a player for their own row. */
  app.post('/api/combatants/:id/initiative/enter', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(EnterInitiativeBody, req.body);
    const { auth } = await ownRowScope(req, id);
    return initiative.enter(id, body, auth.role === 'gm' ? 'gm' : 'player');
  });

  /** App dice for every NPC row still blank this turn. */
  app.post('/api/encounters/:id/initiative/roll-npcs', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    return initiative.rollNpcs(id);
  });

  /** Start the turn with whatever is blank; those rows join late (p.160). */
  app.post('/api/encounters/:id/initiative/start', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    return service.startTurn(id);
  });

  app.post('/api/encounters/:id/next-actor', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    return service.nextActor(id, parse(NextBody, req.body));
  });

  /**
   * "Next ▸" over REST — the same one-button loop as the `encounter.advance`
   * WS command (mark done → next, or wait on a delay, or end the pass, or a
   * new Combat Turn), for a client without the socket and for tests.
   */
  app.post('/api/encounters/:id/advance', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    return service.advance(id, parse(NextBody, req.body));
  });

  /**
   * Arrange the order: `{ move: { combatantId, toIndex } }`, `{ actNow: id }`
   * or `{ sort: 'score' }`. Place only — no score changes, so nobody gains or
   * loses a pass (the GM's decision of 2026-09-28; SR5 p.159). The arrangement
   * lasts for this Combat Turn.
   */
  app.post('/api/encounters/:id/order', async (req) => {
    const { id } = req.params as { id: string };
    await scope(req, id);
    return service.setOrder(id, parse(OrderBody, req.body));
  });

  /** Hold a Delayed Action, or stop holding it (SR5 p.161). */
  app.post('/api/combatants/:id/delay', async (req) => {
    const { id } = req.params as { id: string };
    await combatantScope(req, id);
    return { combatant: await service.delay(id, parse(DelayBody, req.body).delayed) };
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
    const out = await service.newTurn(id, parse(NewTurnBody, req.body));
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
    // FR10.10: one advisory line, GM-only (this route is), off unless the
    // campaign set `settings.tacticalHints`. It never acts — see
    // services/tactical-hints.ts.
    const hint = await hintForCombatant(app.db, encounter.campaignId, combatant);
    return {
      combatantId: id,
      woundModifier: rack.woundModifier,
      entries: rack.entries,
      sceneModifiers: environmentEntries(await service.sceneModifiers(encounter)),
      ...(hint ? { hint } : {}),
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
    // ONE authority per scene modifier — the same rule `deriveCharacter`
    // applies to `Modifier`s, enforced here for hand-sent provenance entries.
    // The rack pool is already derived WITH the scene's environment, so a
    // client that also sends its environment chip would double the penalty and
    // print the line twice in the persisted receipt. Every other source (GM
    // situational chips, range, cover) stacks as sent.
    const rackHasScene = entry.breakdown.some((e) => e.source === 'scene');
    const extra = (body.extra ?? []).filter((e) => !(rackHasScene && e.source === 'scene'));
    const droppedSceneChips = (body.extra?.length ?? 0) - extra.length;
    const breakdown: ProvenanceEntry[] = [...entry.breakdown, ...extra];
    const pool = Math.max(
      0,
      breakdown.reduce((sum, e) => sum + e.value, 0),
    );
    // The GM's public/behind-screen pick wins; unset, only a visible runner rolls in the open.
    const visibility =
      body.visibility ?? (combatant.source === 'character' && combatant.visibility === 'public' ? 'public' : 'gm');
    const request: RollRequest = RollRequestSchema.parse({
      kind: 'simple',
      pool,
      breakdown,
      ...(entry.limit ? { limit: entry.limit } : {}),
      edge: body.edge ?? null,
      visibility,
      actor: { combatantId: id },
      meta: {
        copilot: entry.key,
        ...(body.edgeDice ? { edgeDice: body.edgeDice } : {}),
        ...(droppedSceneChips > 0 ? { droppedSceneChips } : {}),
      },
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
      actorName: combatant.name,
      meta: { encounterId: encounter.id, rack: entry.key },
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

    // The environment is ONE line per side (SR5 p.173-175): the worst row of
    // the scene's conditions — and, for the shot, its range band — after each
    // side's own eyes, one row worse when two tie. Range used to be added on
    // top of the scene here, so dim light at medium range cost −4, not −3.
    const sceneMods = await service.sceneModifiers(encounter);
    const range =
      body.distanceM !== undefined && weapon.rangeCat
        ? rangeModifier(body.distanceM, weapon.rangeCat, attackerSheet.rangeTables)
        : null;
    // Melee: visibility and light only, no smartlink (p.187).
    const melee = isMeleeSkill(weapon.skillId);
    const attackerComp = environmentCompensation(attackerSheet);
    const attackModifiers: ProvenanceEntry[] = [
      ...(melee
        ? sceneEntries(sceneMods, attackerComp.sight, null, ['visibility', 'light'])
        : sceneEntries(sceneMods, attackerComp.shot, range)),
      ...(body.attackModifiers ?? []),
    ];
    const attackerActor = chainActor(attackerSheet, attacker.monitors, {
      name: attacker.name,
      weaponName: weapon.name,
    });
    // Recoil as the sheet reckons it (SR5 p.175): the shooter's Strength is
    // part of the compensation. No earlier rounds this turn are known here.
    const mode = body.mode ?? weapon.modes[0] ?? null;
    const bullets = body.bullets ?? bulletsForMode(mode);
    const recoil = recoilLine({
      mode,
      bullets,
      recoilComp: weapon.recoilComp ?? 0,
      strength: attackerActor.attributes.str ?? 0,
    });
    if (recoil) attackModifiers.push(recoil);
    const outcome = resolveChain(
      attackerActor,
      chainActor(defenderSheet, defender.monitors, { name: defender.name }),
      weapon,
      rng,
      {
        attackModifiers,
        defenseModifiers: [
          ...sceneEntries(sceneMods, environmentCompensation(defenderSheet).sight),
          ...(body.defenseModifiers ?? []),
        ],
        ...(body.soakModifiers ? { soakModifiers: body.soakModifiers } : {}),
        ...(body.fullDefense !== undefined ? { fullDefense: body.fullDefense } : {}),
        ...(body.dvOverride ? { dvOverride: body.dvOverride } : {}),
        ...(body.apOverride !== undefined ? { apOverride: body.apOverride } : {}),
      },
    );
    // G5/FR2.1: the server threw real dice, so they go on the record NOW — one
    // `rolls` row per pool (attack / defence / soak), all `gm` visibility, all
    // linked by `chainId`. DAMAGE is still nothing until commit (Principle 2).
    const recorded = await service.recordChainRolls({
      campaignId: encounter.campaignId,
      encounterId: id,
      attacker: { id: attacker.id, name: attacker.name },
      defender: { id: defender.id, name: defender.name },
      weaponName: weapon.name,
      outcome,
    });
    return {
      encounterId: id,
      attackerId: attacker.id,
      defenderId: defender.id,
      weapon: weapon.name,
      bullets,
      cards: outcome.cards,
      suggested: outcome.suggested,
      notes: outcome.result.notes,
      /** The persisted dice: `[{ step, rollId }]`, one per pool rolled. */
      chainId: recorded.chainId,
      rolls: recorded.rolls,
      /** No damage is applied until POST …/resolve-chain/commit (Principle 2). */
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
   * `encounter.advance`: the FR4.3 loop (`EncountersService.advance`). `expectedActorId`
   * is who the device saw acting; a stale press gets `stale_actor`, so a double tap marks one row.
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
    const raw = msg['expectedActorId'];
    const expectedActorId = typeof raw === 'string' ? raw : raw === null ? null : undefined;
    try {
      await service.advance(encounterId, { expectedActorId });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code !== 'stale_actor') throw err;
      ctx.reply({
        type: 'error',
        payload: { code: 'stale_actor', message: (err as Error).message },
        ephemeral: true,
      });
    }
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
