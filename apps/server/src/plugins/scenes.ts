/**
 * scenes domain plugin — M9 "The Grid" (FR9.1–9.15) + the §13 file route.
 *
 * REST (§12): CRUD /api/scenes/:id, POST /api/scenes/:id/activate, tokens,
 * fog region ops, drawings/AoE templates, the grenade scatter helper,
 * POST /api/attachments (multipart) + GET /files/:id, and the encounter
 * staging hook POST /api/scenes/:id/stage-encounter (FR9.10).
 * WS (§11): `token.drag` → ephemeral `token.dragging` (throttled per token),
 * `token.move` → persisted `token.moved`, `fog.reveal` → persisted `fog.updated`.
 *
 * Principle 4 — hidden tokens and unrevealed fog geometry are filtered in
 * src/services/scenes.ts at the query layer, and their events carry `gm`
 * visibility so the hub never serializes them onto player/display sockets.
 * Revealing a hidden token emits `token.added` (a NEW entity arriving, FR9.7).
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import '@fastify/multipart';
import { z } from 'zod';
import {
  FogRegionSchema,
  GridSchema,
  PointSchema,
  SceneEnvironmentSchema,
  SceneGeometrySchema,
  TokenAuraSchema,
  VisibilitySchema,
  type Visibility,
} from '@safehouse/contracts';
import {
  assertCampaign,
  httpError,
  requireAuth,
  requireRole,
  type AuthContext,
} from '../services/auth.js';
import {
  PerKeyThrottle,
  ScenesService,
  computeScatter,
  normalizeGrid,
  sceneForViewer,
  serializeToken,
  type SceneRow,
  type TokenRow,
} from '../services/scenes.js';

/** ~15 Hz per token for interim drag relay (§11 "throttled"). */
const DRAG_INTERVAL_MS = 66;

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid request body', parsed.error.issues);
  return parsed.data;
}

// --- request bodies ---------------------------------------------------------

const SceneCreateBody = z.object({
  name: z.string().min(1).max(200).default('Untitled scene'),
  grid: GridSchema.partial().optional(),
  environment: SceneEnvironmentSchema.partial().optional(),
  geometry: SceneGeometrySchema.optional(),
  mapAttachmentIds: z.array(z.string()).optional(),
  notes: z.string().max(20_000).optional(),
});

const ScenePatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  state: z.enum(['draft', 'archived']).optional(),
  grid: GridSchema.partial().optional(),
  environment: SceneEnvironmentSchema.partial().optional(),
  geometry: SceneGeometrySchema.optional(),
  mapAttachmentIds: z.array(z.string()).optional(),
  notes: z.string().max(20_000).optional(),
});

const TokenCreateBody = z.object({
  source: z.enum(['character', 'combatant', 'npc_template', 'prop']).default('prop'),
  sourceId: z.string().nullable().optional(),
  name: z.string().min(1).max(120).optional(),
  x: z.number().default(0),
  y: z.number().default(0),
  size: z.number().positive().default(1),
  rotation: z.number().default(0),
  artRef: z.string().nullable().optional(),
  hidden: z.boolean().default(false),
  barsVisibility: z.enum(['gm', 'owner', 'public']).default('owner'),
  aura: TokenAuraSchema.nullable().optional(),
});

const TokenPatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  size: z.number().positive().optional(),
  rotation: z.number().optional(),
  artRef: z.string().nullable().optional(),
  hidden: z.boolean().optional(),
  barsVisibility: z.enum(['gm', 'owner', 'public']).optional(),
  aura: TokenAuraSchema.nullable().optional(),
});

const FogOpBody = z.object({
  op: z.enum(['reveal', 'hide', 'define']).default('reveal'),
  regionId: z.string().optional(),
  region: FogRegionSchema.partial({ id: true }).optional(),
  shape: z.array(PointSchema).min(3).optional(),
  announce: z.boolean().optional(),
});

const DrawingBody = z.object({
  kind: z.enum(['sketch', 'template']).default('sketch'),
  geometry: z.record(z.string(), z.unknown()).default({}),
  expiresInSec: z.number().int().positive().max(86_400).optional(),
});

const ScatterBody = z.object({
  x: z.number(),
  y: z.number(),
  netHits: z.number().int().min(0).default(0),
  /** Editable per launcher type (FR9.12); default 2d6 metres. */
  scatterDice: z.number().int().min(1).max(10).default(2),
  directionDie: z.number().int().min(1).max(6).optional(),
  distanceDice: z.array(z.number().int().min(1).max(6)).optional(),
  /** When set, the deviated impact lands as a `template` drawing. */
  placeTemplate: z.boolean().default(false),
  radiusM: z.number().positive().max(500).optional(),
});

const StageEncounterBody = z.object({
  name: z.string().min(1).max(200).optional(),
  encounterId: z.string().optional(),
});

export default async function scenesPlugin(app: FastifyInstance): Promise<void> {
  const svc = new ScenesService(app.db);
  const dragThrottle = new PerKeyThrottle(DRAG_INTERVAL_MS);

  /** Visibility scope for a token's events: hidden ⇒ GM sockets only (FR9.7). */
  const tokenVis = (hidden: boolean): Visibility => (hidden ? 'gm' : 'public');

  /** Load a scene, check campaign binding, and report whether the caller is GM. */
  async function openScene(
    req: FastifyRequest,
    sceneId: string,
    opts: { gmOnly?: boolean } = {},
  ): Promise<{ scene: SceneRow; auth: AuthContext; gm: boolean }> {
    const auth = opts.gmOnly ? requireRole(req, 'gm') : requireAuth(req);
    const scene = await svc.sceneRow(sceneId);
    assertCampaign(auth, scene.campaignId);
    const gm = auth.role === 'gm';
    // FR9.1: the GM stages scenes privately — non-GM devices only ever see the
    // active one (404, not 403: no existence oracle for staged scenes).
    if (!gm && scene.state !== 'active') throw httpError(404, 'not_found', 'unknown scene');
    return { scene, auth, gm };
  }

  // --- scenes ---------------------------------------------------------------

  app.get('/api/campaigns/:id/scenes', async (req) => {
    const { id: campaignId } = req.params as { id: string };
    const auth = requireAuth(req);
    assertCampaign(auth, campaignId);
    const gm = auth.role === 'gm';
    const scenes = await svc.listScenes(campaignId, { activeOnly: !gm });
    return { scenes: scenes.map((s) => sceneForViewer(s, gm)) };
  });

  app.post('/api/campaigns/:id/scenes', async (req, reply) => {
    const { id: campaignId } = req.params as { id: string };
    const auth = requireRole(req, 'gm');
    assertCampaign(auth, campaignId);
    const body = parseBody(SceneCreateBody, req.body);
    const scene = await svc.createScene(campaignId, {
      ...body,
      grid: body.grid as Record<string, unknown> | undefined,
      environment: body.environment as Record<string, unknown> | undefined,
    });
    await app.hub.emit(campaignId, { type: 'scene.updated', payload: { sceneId: scene.id, changed: ['created'] } });
    return reply.status(201).send({ scene });
  });

  /**
   * Role-filtered composed payload (scene + tokens + live drawings). Hidden
   * tokens and unrevealed fog regions are removed server-side before this ever
   * serializes (Principle 4).
   */
  app.get('/api/scenes/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { scene, gm } = await openScene(req, id);
    return svc.composedScene(scene, gm);
  });

  app.patch('/api/scenes/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const body = parseBody(ScenePatchBody, req.body);
    const { scene: updated, changed } = await svc.updateScene(scene, {
      ...body,
      grid: body.grid as Record<string, unknown> | undefined,
      environment: body.environment as Record<string, unknown> | undefined,
    });
    // Public delta signal only — the payload never carries GM-layer geometry;
    // clients re-GET the scene and receive their own role-filtered view.
    await app.hub.emit(scene.campaignId, {
      type: 'scene.updated',
      payload: { sceneId: id, changed, environment: updated.environment },
    });
    return { scene: updated };
  });

  app.delete('/api/scenes/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    await svc.deleteScene(id);
    await app.hub.emit(scene.campaignId, {
      type: 'scene.updated',
      payload: { sceneId: id, changed: ['deleted'], deleted: true },
    });
    return { ok: true };
  });

  /** FR9.1: exactly one active scene per campaign; the table follows it. */
  app.post('/api/scenes/:id/activate', async (req) => {
    const { id } = req.params as { id: string };
    const auth = requireRole(req, 'gm');
    const row = await svc.sceneRow(id);
    assertCampaign(auth, row.campaignId);
    const scene = await svc.activateScene(row);
    await app.hub.emit(row.campaignId, {
      type: 'scene.activated',
      payload: { sceneId: scene.id, name: scene.name },
    });
    return { scene };
  });

  // --- tokens (FR9.4–9.7) ---------------------------------------------------

  app.post('/api/scenes/:id/tokens', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const body = parseBody(TokenCreateBody, req.body);
    const token = await svc.createToken(scene, body);
    await app.hub.emit(scene.campaignId, {
      type: 'token.added',
      payload: { token },
      visibility: tokenVis(token.hidden),
    });
    return reply.status(201).send({ token });
  });

  app.patch('/api/tokens/:id', async (req) => {
    const { id } = req.params as { id: string };
    const auth = requireAuth(req);
    const { token: before, scene } = await svc.tokenWithScene(id);
    assertCampaign(auth, scene.campaignId);
    const body = parseBody(TokenPatchBody, req.body);
    const positional = body.x !== undefined || body.y !== undefined || body.rotation !== undefined;
    const nonPositional = Object.keys(body).some((k) => k !== 'x' && k !== 'y' && k !== 'rotation');
    if (auth.role !== 'gm') {
      // FR9.5: players may only reposition their own character's token.
      if (nonPositional) throw httpError(403, 'forbidden', 'only the GM may edit token properties');
      if (!(await svc.canControlToken(auth, before))) {
        throw httpError(403, 'forbidden', 'you do not control this token');
      }
    }
    const after = await svc.patchToken(id, body);
    await emitTokenChange(scene, before, after, { positional, nonPositional });
    return { token: serializeToken(after) };
  });

  app.delete('/api/tokens/:id', async (req) => {
    const { id } = req.params as { id: string };
    const auth = requireRole(req, 'gm');
    const { token, scene } = await svc.tokenWithScene(id);
    assertCampaign(auth, scene.campaignId);
    await svc.deleteToken(id);
    await app.hub.emit(scene.campaignId, {
      type: 'token.removed',
      payload: { tokenId: id, sceneId: scene.id },
      visibility: tokenVis(token.hidden),
    });
    return { ok: true };
  });

  /**
   * Emit the right event(s) for a token mutation. Reveal (hidden → visible)
   * surfaces as `token.added` for players: a NEW entity arriving, never a
   * position that was quietly on their wire all along (FR9.7).
   */
  async function emitTokenChange(
    scene: SceneRow,
    before: TokenRow,
    after: TokenRow,
    kind: { positional: boolean; nonPositional: boolean },
  ): Promise<void> {
    const dto = serializeToken(after);
    if (before.hidden && !after.hidden) {
      await app.hub.emit(scene.campaignId, { type: 'token.added', payload: { token: dto } });
      return;
    }
    if (!before.hidden && after.hidden) {
      await app.hub.emit(scene.campaignId, {
        type: 'token.removed',
        payload: { tokenId: after.id, sceneId: scene.id },
      });
      await app.hub.emit(scene.campaignId, {
        type: 'token.updated',
        payload: { token: dto },
        visibility: 'gm',
      });
      return;
    }
    const visibility = tokenVis(after.hidden);
    if (kind.positional) {
      await app.hub.emit(scene.campaignId, {
        type: 'token.moved',
        payload: { tokenId: after.id, sceneId: scene.id, x: after.x, y: after.y, rotation: after.rotation },
        visibility,
      });
    }
    if (kind.nonPositional) {
      await app.hub.emit(scene.campaignId, {
        type: 'token.updated',
        payload: { token: dto },
        visibility,
      });
    }
  }

  // --- fog (FR9.13/9.14) ----------------------------------------------------

  app.post('/api/scenes/:id/fog', async (req) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const body = parseBody(FogOpBody, req.body);
    return applyFog(scene, body);
  });

  /**
   * Fog events keep the payload player-safe: a *reveal* may carry the region
   * polygon (players now see it), `define`/unrevealed geometry stays GM-only,
   * and `hide` carries an id with no geometry at all.
   */
  async function applyFog(
    scene: SceneRow,
    body: z.output<typeof FogOpBody>,
  ): Promise<{ fog: unknown }> {
    const { fog, region } = await svc.applyFogOp(scene, {
      op: body.op,
      ...(body.regionId ? { regionId: body.regionId } : {}),
      ...(body.region ? { region: { ...body.region, id: body.region.id ?? undefined } } : {}),
      ...(body.shape ? { shape: body.shape } : {}),
    });
    const isDefine = body.op === 'define';
    await app.hub.emit(scene.campaignId, {
      type: 'fog.updated',
      payload: {
        sceneId: scene.id,
        op: body.op,
        ...(body.regionId ? { regionId: body.regionId } : {}),
        ...(!isDefine && region ? { region } : {}),
        ...(!isDefine && body.shape ? { shape: body.shape } : {}),
      },
      visibility: isDefine ? 'gm' : 'public',
    });
    if (body.announce && body.op === 'reveal' && region) {
      await app.hub.emit(scene.campaignId, {
        type: 'log.posted',
        payload: { kind: 'scene', sceneId: scene.id, text: `Revealed: ${region.name}` },
      });
    }
    return { fog };
  }

  // --- drawings, AoE templates, scatter (FR9.12/9.15) -----------------------

  app.post('/api/scenes/:id/drawings', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { scene, auth } = await openScene(req, id);
    if (auth.role !== 'gm' && auth.role !== 'player') {
      throw httpError(403, 'forbidden', 'requires role: gm | player');
    }
    const body = parseBody(DrawingBody, req.body);
    const drawing = await svc.createDrawing(scene.id, { ...body, createdBy: auth.userId });
    await app.hub.emit(scene.campaignId, { type: 'drawing.added', payload: { drawing } });
    return reply.status(201).send({ drawing });
  });

  app.patch('/api/drawings/:id', async (req) => {
    const { id } = req.params as { id: string };
    const auth = requireRole(req, 'gm');
    const row = await svc.drawingRow(id);
    const scene = await svc.sceneRow(row.sceneId);
    assertCampaign(auth, scene.campaignId);
    const geometry = parseBody(z.record(z.string(), z.unknown()), req.body);
    const drawing = await svc.updateDrawing(id, geometry);
    await app.hub.emit(scene.campaignId, { type: 'drawing.added', payload: { drawing } });
    return { drawing };
  });

  app.delete('/api/drawings/:id', async (req) => {
    const { id } = req.params as { id: string };
    const auth = requireRole(req, 'gm');
    const row = await svc.drawingRow(id);
    const scene = await svc.sceneRow(row.sceneId);
    assertCampaign(auth, scene.campaignId);
    await svc.deleteDrawing(id);
    await app.hub.emit(scene.campaignId, {
      type: 'drawing.cleared',
      payload: { sceneId: scene.id, drawingIds: [id] },
    });
    return { ok: true };
  });

  app.delete('/api/scenes/:id/drawings', async (req) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const drawingIds = await svc.clearDrawings(scene.id);
    await app.hub.emit(scene.campaignId, {
      type: 'drawing.cleared',
      payload: { sceneId: scene.id, drawingIds },
    });
    return { drawingIds };
  });

  /** Grenade scatter helper: direction d6 + Nd6 metres − net hits (FR9.12). */
  app.post('/api/scenes/:id/scatter', async (req) => {
    const { id } = req.params as { id: string };
    const { scene, auth } = await openScene(req, id);
    if (auth.role !== 'gm' && auth.role !== 'player') {
      throw httpError(403, 'forbidden', 'requires role: gm | player');
    }
    const body = parseBody(ScatterBody, req.body);
    const grid = normalizeGrid(scene.grid);
    const scatter = computeScatter({
      x: body.x,
      y: body.y,
      netHits: body.netHits,
      scatterDice: body.scatterDice,
      gridUnitM: grid.unitM,
      ...(body.directionDie !== undefined ? { directionDie: body.directionDie } : {}),
      ...(body.distanceDice !== undefined ? { distanceDice: body.distanceDice } : {}),
    });
    if (!body.placeTemplate) return { scatter };
    const drawing = await svc.createDrawing(scene.id, {
      kind: 'template',
      geometry: {
        shape: 'circle',
        center: scatter.to,
        radiusM: body.radiusM ?? 5,
        origin: scatter.from,
        scatter,
      },
      createdBy: auth.userId,
    });
    await app.hub.emit(scene.campaignId, { type: 'drawing.added', payload: { drawing } });
    return { scatter, drawing };
  });

  // --- encounter staging hook (FR9.10) --------------------------------------

  /**
   * Turn the scene's character/NPC tokens into combatants. Coordination with
   * the encounters domain is via db rows only; the emitted `encounter.updated`
   * lets that plugin's clients refetch.
   */
  app.post('/api/scenes/:id/stage-encounter', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const body = parseBody(StageEncounterBody, req.body);
    const staged = await svc.stageEncounter(scene, body);
    await app.hub.emit(scene.campaignId, {
      type: 'encounter.updated',
      payload: {
        encounterId: staged.encounterId,
        sceneId: scene.id,
        staged: staged.combatantIds.length,
        created: staged.createdEncounter,
      },
    });
    return reply.status(201).send(staged);
  });

  // --- attachments + the file route (FR9.2, §13) ----------------------------

  const UploadQuery = z.object({
    campaign: z.string().optional(),
    kind: z.enum(['map', 'token', 'handout', 'portrait', 'asset', 'audio']).default('map'),
    visibility: VisibilitySchema.default('gm'),
  });

  app.post('/api/attachments', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const q = parseBody(UploadQuery, req.query);
    const campaignId = q.campaign ?? auth.campaignId;
    if (campaignId) assertCampaign(auth, campaignId);
    const part = await req.file();
    if (!part) throw httpError(400, 'bad_request', 'expected a multipart file part');
    const fields = part.fields as Record<string, { value?: unknown } | undefined>;
    const field = (name: string): string | undefined => {
      const v = fields[name]?.value;
      return typeof v === 'string' ? v : undefined;
    };
    const kind = UploadQuery.shape.kind.safeParse(field('kind') ?? q.kind);
    const visibility = VisibilitySchema.safeParse(field('visibility') ?? q.visibility);
    const row = await svc.saveAttachment({
      campaignId: campaignId ?? null,
      kind: kind.success ? kind.data : 'map',
      visibility: visibility.success ? visibility.data : 'gm',
      mime: part.mimetype,
      file: part.file,
    });
    return reply.status(201).send({
      attachment: {
        id: row.id,
        campaignId: row.campaignId,
        kind: row.kind,
        mime: row.mime,
        size: row.size,
        visibility: row.visibility,
        url: `/files/${row.id}`,
      },
    });
  });

  /**
   * §13: auth + visibility checked on every read. A GM-only map 404s for a
   * player — same answer as a nonexistent id, so the route is not an oracle
   * for what the GM has staged.
   */
  app.get('/files/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const auth = requireAuth(req);
    const notFound = () => httpError(404, 'not_found', 'unknown file');
    const row = await svc.attachment(id).catch(() => null);
    if (!row) throw notFound();
    if (!svc.canSeeAttachment(auth, row)) throw notFound();
    const path = svc.attachmentPath(row);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw notFound();
    return reply
      .header('content-length', String(info.size))
      .header('cache-control', 'private, max-age=300')
      .type(row.mime)
      .send(createReadStream(path));
  });

  // --- WS commands (§11) ----------------------------------------------------

  const DragCmd = z.object({ tokenId: z.string(), x: z.number(), y: z.number() });
  const MoveCmd = z.object({
    tokenId: z.string(),
    x: z.number(),
    y: z.number(),
    rotation: z.number().optional(),
  });
  const FogCmd = z.object({ sceneId: z.string() }).extend(FogOpBody.shape);

  /** Interim drag positions: relayed, throttled per token, NEVER persisted. */
  app.hub.onCommand('token.drag', async (msg, ctx) => {
    const parsed = DragCmd.safeParse(msg);
    if (!parsed.success) return ctx.reply({ type: 'error', payload: { code: 'bad_request', message: 'invalid token.drag' }, ephemeral: true });
    const { token, scene } = await svc.tokenWithScene(parsed.data.tokenId);
    if (scene.campaignId !== ctx.campaignId) return;
    if (!(await svc.canControlToken(ctx.auth, token))) return;
    if (!dragThrottle.allow(token.id)) return;
    app.hub.emitEphemeral(ctx.campaignId, {
      type: 'token.dragging',
      payload: { tokenId: token.id, sceneId: scene.id, x: parsed.data.x, y: parsed.data.y, by: ctx.auth.userId },
      visibility: tokenVis(token.hidden),
    });
  });

  /** Drag end: the server-authoritative final position, persisted (FR9.5). */
  app.hub.onCommand('token.move', async (msg, ctx) => {
    const parsed = MoveCmd.safeParse(msg);
    if (!parsed.success) return ctx.reply({ type: 'error', payload: { code: 'bad_request', message: 'invalid token.move' }, ephemeral: true });
    const { token, scene } = await svc.tokenWithScene(parsed.data.tokenId);
    if (scene.campaignId !== ctx.campaignId) return;
    if (!(await svc.canControlToken(ctx.auth, token))) {
      return ctx.reply({ type: 'error', payload: { code: 'forbidden', message: 'you do not control this token' }, ephemeral: true });
    }
    dragThrottle.clear(token.id);
    const after = await svc.patchToken(token.id, {
      x: parsed.data.x,
      y: parsed.data.y,
      ...(parsed.data.rotation !== undefined ? { rotation: parsed.data.rotation } : {}),
    });
    await emitTokenChange(scene, token, after, { positional: true, nonPositional: false });
  });

  app.hub.onCommand('fog.reveal', async (msg, ctx) => {
    if (ctx.auth.role !== 'gm') {
      return ctx.reply({ type: 'error', payload: { code: 'forbidden', message: 'fog is GM-only' }, ephemeral: true });
    }
    const parsed = FogCmd.safeParse(msg);
    if (!parsed.success) return ctx.reply({ type: 'error', payload: { code: 'bad_request', message: 'invalid fog.reveal' }, ephemeral: true });
    const scene = await svc.sceneRow(parsed.data.sceneId);
    if (scene.campaignId !== ctx.campaignId) return;
    await applyFog(scene, parsed.data);
  });
}
