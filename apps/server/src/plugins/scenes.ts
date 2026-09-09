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
  TILESETS,
  layerOf,
  migrateTileLayer,
  parseCellKey,
  sceneLevels,
  tileById,
  tilesetById,
} from '@safehouse/rules';
import {
  DisplaySetCommandSchema,
  FogRegionSchema,
  GridSchema,
  PointSchema,
  SceneEnvironmentSchema,
  SceneGeometrySchema,
  SceneVisionSchema,
  TileLayerSchema,
  TokenAuraSchema,
  VisibilitySchema,
  type Visibility,
  TILE_LAYERS,
} from '@safehouse/contracts';
import {
  assertCampaign,
  httpError,
  requireAuth,
  requireRole,
  type AuthContext,
} from '../services/auth.js';
import type { EventTx } from '../hub.js';
import { emitFogProximity } from '../fixer/proximity.js';
import {
  PerKeyThrottle,
  ScenesService,
  computeScatter,
  normalizeGrid,
  sceneForViewer,
  serializeScene,
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
  tiles: TileLayerSchema.optional(),
  mapAttachmentIds: z.array(z.string()).optional(),
  notes: z.string().max(20_000).optional(),
});

const ScenePatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  state: z.enum(['draft', 'archived']).optional(),
  grid: GridSchema.partial().optional(),
  environment: SceneEnvironmentSchema.partial().optional(),
  geometry: SceneGeometrySchema.optional(),
  vision: SceneVisionSchema.partial().optional(),
  mapAttachmentIds: z.array(z.string()).optional(),
  notes: z.string().max(20_000).optional(),
});

/**
 * Cell budget for the painted floor. The layer lives inside the
 * `scenes.geometry` JSONB and nothing ever reclaims it — cells outside the
 * grid are deliberately RETAINED so shrinking a scene cannot lose its paint
 * (contracts/src/scene.ts) — so an unbounded record here is an unbounded
 * column. Both caps sit far above any real floor: the layer cap is a fully
 * painted 240x240 scene, roughly 40x the default grid.
 */
const MAX_STROKE_CELLS = 20_000;
const MAX_LAYER_CELLS = 60_000;

/**
 * `"col,row"`, validated against the same parser the renderer uses rather than
 * a second copy of the regex. Zod 4 checks record KEYS, so a malformed cell
 * arrives as a normal `bad_request` with issues instead of needing a
 * hand-rolled loop — and `__proto__` never reaches an `Object.assign`.
 */
const CellKeySchema = z
  .string()
  .max(64)
  .refine((k) => parseCellKey(k) !== null, { message: 'cell key must be "col,row" integers' });

/**
 * A paint stroke (FR9.2): cells the GM just painted or erased, not the whole
 * layer. A drag across a warehouse floor is one request of a few hundred
 * entries rather than one request per cell, and two GMs painting different
 * rooms do not clobber each other the way a whole-layer PUT would.
 */
/**
 * Floors per scene. Generous for a tower block and low enough that a typo in
 * a level index cannot allocate an unbounded array of tile layers.
 */
const MAX_LEVELS = 12;

const TilePaintBody = z.object({
  tilesetId: z.string().min(1).max(64),
  /** `"col,row"` -> tile id. */
  paint: z
    .record(CellKeySchema, z.string().min(1).max(64))
    .refine((p) => Object.keys(p).length <= MAX_STROKE_CELLS, {
      message: `at most ${MAX_STROKE_CELLS} cells per stroke`,
    })
    .default({}),
  /** `"col,row"` keys to clear. */
  erase: z.array(CellKeySchema).max(MAX_STROKE_CELLS).default([]),
  /** Wipe the layer before applying (a "fill floor then paint" reset). */
  clear: z.boolean().default(false),
  /**
   * Which layer `erase` and `clear` act on. Omitted means all three — the
   * eraser as a GM understands it, taking whatever is in the square.
   *
   * PAINTING never uses this. A tile's layer is a property of the tile
   * (`layerOf`), so the catalogue decides where a wall goes and no client can
   * ask for one in the decoration layer.
   */
  layer: z.enum(TILE_LAYERS).optional(),
  /**
   * Which floor to paint, 0 being the ground (FR9.22). Out of range is a 400
   * rather than a clamp: silently painting the wrong storey is the one
   * outcome a GM cannot see happening.
   */
  level: z.number().int().min(0).max(MAX_LEVELS - 1).default(0),
});

const TokenCreateBody = z.object({
  source: z.enum(['character', 'combatant', 'npc_template', 'prop']).default('prop'),
  sourceId: z.string().nullable().optional(),
  name: z.string().min(1).max(120).optional(),
  x: z.number().default(0),
  y: z.number().default(0),
  level: z.number().int().min(0).max(MAX_LEVELS - 1).default(0),
  size: z.number().positive().default(1),
  rotation: z.number().default(0),
  // A uuid because `tokens.art_ref` is one: a free-form string reached the
  // database and came back a 500 where the caller deserves a 400.
  artRef: z.string().uuid().nullable().optional(),
  hidden: z.boolean().default(false),
  barsVisibility: z.enum(['gm', 'owner', 'public']).default('owner'),
  aura: TokenAuraSchema.nullable().optional(),
});

const TokenPatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  /** Which floor the token stands on (FR9.22) — how a runner takes the stairs. */
  level: z.number().int().min(0).max(MAX_LEVELS - 1).optional(),
  size: z.number().positive().optional(),
  rotation: z.number().optional(),
  // A uuid because `tokens.art_ref` is one: a free-form string reached the
  // database and came back a 500 where the caller deserves a 400.
  artRef: z.string().uuid().nullable().optional(),
  hidden: z.boolean().optional(),
  barsVisibility: z.enum(['gm', 'owner', 'public']).optional(),
  aura: TokenAuraSchema.nullable().optional(),
});

const SceneLevelsBody = z.object({
  /**
   * Floors ABOVE the ground one, in display order. At most `MAX_LEVELS - 1`
   * because the ground floor is `scene.tiles` and is always present.
   */
  levels: z
    .array(z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(60) }))
    .max(MAX_LEVELS - 1)
    .default([]),
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
    const scene = await app.hub.atomic(campaignId, async (tx) => {
      const created = await svc.withDb(tx.db).createScene(campaignId, {
        ...body,
        grid: body.grid as Record<string, unknown> | undefined,
        environment: body.environment as Record<string, unknown> | undefined,
      });
      await tx.emit({ type: 'scene.updated', payload: { sceneId: created.id, changed: ['created'] } });
      return created;
    });
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
    const updated = await app.hub.atomic(scene.campaignId, async (tx) => {
      const written = await svc.withDb(tx.db).updateScene(scene, {
        ...body,
        grid: body.grid as Record<string, unknown> | undefined,
        environment: body.environment as Record<string, unknown> | undefined,
      });
      // Public delta signal only — the payload never carries GM-layer geometry;
      // clients re-GET the scene and receive their own role-filtered view.
      await tx.emit({
        type: 'scene.updated',
        payload: { sceneId: id, changed: written.changed, environment: written.scene.environment },
      });
      return written.scene;
    });
    return { scene: updated };
  });

  app.delete('/api/scenes/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    await app.hub.atomic(scene.campaignId, async (tx) => {
      await svc.withDb(tx.db).deleteScene(id);
      await tx.emit({
        type: 'scene.updated',
        payload: { sceneId: id, changed: ['deleted'], deleted: true },
      });
    });
    return { ok: true };
  });

  /**
   * FR9.1: exactly one active scene per campaign; the table follows it.
   *
   * Demotion, promotion and `scene.activated` are one transaction — a
   * promotion that committed without its event leaves every player device
   * looking at the scene the GM just closed, with no way to notice.
   */
  app.post('/api/scenes/:id/activate', async (req) => {
    const { id } = req.params as { id: string };
    const auth = requireRole(req, 'gm');
    const row = await svc.sceneRow(id);
    assertCampaign(auth, row.campaignId);
    const scene = await app.hub.atomic(row.campaignId, async (tx) => {
      const activated = await svc.withDb(tx.db).activateScene(row);
      await tx.emit({
        type: 'scene.activated',
        payload: { sceneId: activated.id, name: activated.name },
      });
      return activated;
    });
    return { scene };
  });

  // --- tokens (FR9.4–9.7) ---------------------------------------------------

  app.post('/api/scenes/:id/tokens', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const body = parseBody(TokenCreateBody, req.body);
    const token = await app.hub.atomic(scene.campaignId, async (tx) => {
      const created = await svc.withDb(tx.db).createToken(scene, body);
      await tx.emit({
        type: 'token.added',
        payload: { token: created },
        visibility: tokenVis(created.hidden),
      });
      return created;
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
    // The permission reads above are all hoisted out of the block; only the
    // row write and the event(s) describing it are inside it.
    const after = await app.hub.atomic(scene.campaignId, async (tx) => {
      const written = await svc.withDb(tx.db).patchToken(id, body);
      await emitTokenChange(tx, scene, before, written, { positional, nonPositional });
      return written;
    });
    return { token: serializeToken(after) };
  });

  app.delete('/api/tokens/:id', async (req) => {
    const { id } = req.params as { id: string };
    const auth = requireRole(req, 'gm');
    const { token, scene } = await svc.tokenWithScene(id);
    assertCampaign(auth, scene.campaignId);
    await app.hub.atomic(scene.campaignId, async (tx) => {
      await svc.withDb(tx.db).deleteToken(id);
      await tx.emit({
        type: 'token.removed',
        payload: { tokenId: id, sceneId: scene.id },
        visibility: tokenVis(token.hidden),
      });
    });
    return { ok: true };
  });

  /**
   * Emit the right event(s) for a token mutation. Reveal (hidden → visible)
   * surfaces as `token.added` for players: a NEW entity arriving, never a
   * position that was quietly on their wire all along (FR9.7).
   *
   * Takes the caller's transaction, so a token whose row moved is a token the
   * table was told about — and a hide that rolls back never leaks the
   * `token.removed` that would have made a player's screen disagree with the
   * GM's. Emits only; the row write is the caller's.
   */
  async function emitTokenChange(
    tx: EventTx,
    scene: SceneRow,
    before: TokenRow,
    after: TokenRow,
    kind: { positional: boolean; nonPositional: boolean },
  ): Promise<void> {
    const dto = serializeToken(after);
    if (before.hidden && !after.hidden) {
      await tx.emit({ type: 'token.added', payload: { token: dto } });
      return;
    }
    if (!before.hidden && after.hidden) {
      await tx.emit({
        type: 'token.removed',
        payload: { tokenId: after.id, sceneId: scene.id },
      });
      await tx.emit({
        type: 'token.updated',
        payload: { token: dto },
        visibility: 'gm',
      });
      return;
    }
    const visibility = tokenVis(after.hidden);
    if (kind.positional) {
      await tx.emit({
        type: 'token.moved',
        payload: { tokenId: after.id, sceneId: scene.id, x: after.x, y: after.y, rotation: after.rotation },
        visibility,
      });
    }
    if (kind.nonPositional) {
      await tx.emit({
        type: 'token.updated',
        payload: { token: dto },
        visibility,
      });
    }
  }

  // --- fog (FR9.13/9.14) ----------------------------------------------------

  /** The built-in tilesets a GM can build a floor from (FR9.2). */
  app.get('/api/tilesets', async (req) => {
    requireAuth(req);
    return { tilesets: TILESETS };
  });

  /**
   * Paint or erase tiles. GM-only like the rest of scene authoring; players
   * receive the result by re-GETting the scene, same as geometry.
   *
   * The catalogue checks run BEFORE the transaction (they touch no database,
   * and `atomic`'s deadlock rule says hoist what you can); the merge runs
   * INSIDE it, against a row re-read through `tx.db`. That second point is
   * load-bearing: `updateScene` re-derives every field it is not handed from
   * the row it is given, so merging against the snapshot `openScene` took
   * would let a paint stroke silently roll back a wall drawn or a fog region
   * revealed a moment earlier — and would let two strokes in flight lose one
   * another. Two strokes in flight is not a contrived race: the client
   * flushes its paint buffer on any pause mid-drag.
   */
  app.post('/api/scenes/:id/tiles', async (req) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const body = parseBody(TilePaintBody, req.body);
    if (tilesetById(body.tilesetId) === null) {
      throw httpError(400, 'unknown_tileset', `no such tileset: ${body.tilesetId}`);
    }
    // Reject the whole stroke, not the cell: a half-applied stroke is paint
    // the GM watched themselves lay down and will not find again.
    for (const tileId of new Set(Object.values(body.paint))) {
      if (tileById(body.tilesetId, tileId) === null) {
        throw httpError(400, 'unknown_tile', `no such tile: ${body.tilesetId}/${tileId}`);
      }
    }

    const updated = await app.hub.atomic(scene.campaignId, async (tx) => {
      const txSvc = svc.withDb(tx.db);
      const fresh = await txSvc.sceneRow(id);
      // The tile layer rides inside the geometry JSONB, so read it back
      // through the serializer rather than off the row.
      const scene0 = serializeScene(fresh);
      // Which FLOOR this stroke lands on. A level the scene does not have yet
      // is a 400, not an auto-create: a client off by one should not silently
      // build a storey the GM never asked for.
      const floors = sceneLevels(scene0);
      if (body.level >= floors.length) {
        throw httpError(
          400,
          'unknown_level',
          `this scene has ${floors.length} level(s); no level ${body.level}`,
        );
      }
      const existing = floors[body.level]?.tiles;
      // A layer carries exactly one tileset id, so a stroke from a different
      // set cannot be merged into it — painting with a new set REPLACES the
      // floor. Destructive and deliberate; the palette warns before it.
      const keep = !body.clear && existing && existing.tilesetId === body.tilesetId;
      // Read through the migration, so a scene painted before layers existed
      // upgrades itself the first time the GM touches it.
      const layers = keep
        ? migrateTileLayer(existing)
        : { tilesetId: body.tilesetId, ground: {}, structure: {}, object: {} };

      if (body.clear && body.layer !== undefined && keep) {
        // Clearing ONE layer: everything else stands. Wiping the furniture out
        // of a room should not take the room with it.
        layers[body.layer] = {};
      }

      // Where a tile goes is the tile's business (`layerOf`), never the
      // client's: that is what stops a wall being painted into the layer that
      // line of sight does not read.
      for (const [key, tileId] of Object.entries(body.paint)) {
        const tile = tileById(body.tilesetId, tileId)!;
        layers[layerOf(tile)][key] = tileId;
      }

      // No layer named means the eraser as a GM understands it: take whatever
      // is in the square.
      const eraseFrom = body.layer !== undefined ? [body.layer] : [...TILE_LAYERS];
      for (const key of body.erase) {
        for (const name of eraseFrom) delete layers[name][key];
      }

      const painted =
        Object.keys(layers.ground).length +
        Object.keys(layers.structure).length +
        Object.keys(layers.object).length;
      if (painted > MAX_LAYER_CELLS) {
        throw httpError(400, 'tile_layer_full', `a scene holds at most ${MAX_LAYER_CELLS} painted cells`);
      }

      // `cells` is written empty on purpose: the legacy field drains as soon
      // as a scene is touched, so the migration is self-retiring.
      const tiles = { ...layers, cells: {} };
      // Level 0 lives in `scene.tiles`; anything above it in `scene.levels`.
      // The split is what keeps every one-floor scene exactly as it was.
      const patch =
        body.level === 0
          ? { tiles }
          : {
              levels: (scene0.levels ?? []).map((l, i) =>
                i === body.level - 1 ? { ...l, tiles } : l,
              ),
            };
      const written = await txSvc.updateScene(fresh, patch);
      await tx.emit({
        type: 'scene.updated',
        payload: { sceneId: id, changed: written.changed, tilesPainted: painted },
      });
      return written.scene;
    });
    // The count for the floor that was actually painted. Reading
    // `updated.tiles` reported the GROUND floor's total for every stroke, so
    // painting a catwalk of 16 cells answered with the warehouse's 108 —
    // a number the GM has no way to reconcile with what they just did.
    // Across all three layers, because `cells` is the drained legacy field.
    const t = sceneLevels(updated)[body.level]?.tiles;
    return {
      scene: updated,
      painted: t
        ? Object.keys(t.ground ?? {}).length +
          Object.keys(t.structure ?? {}).length +
          Object.keys(t.object ?? {}).length
        : 0,
    };
  });

  /**
   * Add, rename or remove a floor (FR9.22).
   *
   * Whole-list replacement rather than per-level verbs: the GM is editing a
   * short ordered list, and "delete the middle storey" is not expressible as a
   * patch without inventing ids for positions. The ground floor is NOT in this
   * list — it is `scene.tiles` — so it can never be deleted, which is right:
   * a building with no ground floor is not a building.
   */
  app.put('/api/scenes/:id/levels', async (req) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const body = parseBody(SceneLevelsBody, req.body);

    const updated = await app.hub.atomic(scene.campaignId, async (tx) => {
      const txSvc = svc.withDb(tx.db);
      const fresh = await txSvc.sceneRow(id);
      const current = serializeScene(fresh);
      // Keep the tiles already painted on a floor the GM is only renaming.
      // Sending a level without tiles must not wipe the storey.
      const byId = new Map((current.levels ?? []).map((l) => [l.id, l]));
      const levels = body.levels.map((l) => {
        const existing = byId.get(l.id);
        return existing?.tiles === undefined ? l : { ...l, tiles: existing.tiles };
      });
      const written = await txSvc.updateScene(fresh, { levels });
      await tx.emit({
        type: 'scene.updated',
        payload: { sceneId: id, changed: written.changed, levels: levels.length + 1 },
      });
      return written.scene;
    });
    return { scene: updated };
  });

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
   *
   * The `scenes.fog` write and its event commit together (`Hub.atomic`). Fog
   * is the sharpest case of the half-commit in the whole app: a reveal that
   * stored without emitting leaves players still fogged out of a room the
   * server now considers open, and a `hide` that stored without emitting is
   * worse — the client keeps drawing geometry the server has taken back, which
   * is a Principle 4 leak the GM cannot see from their own screen.
   */
  async function applyFog(
    scene: SceneRow,
    body: z.output<typeof FogOpBody>,
  ): Promise<{ fog: unknown }> {
    return app.hub.atomic(scene.campaignId, async (tx) => {
      const { fog, region } = await svc.withDb(tx.db).applyFogOp(scene, {
        op: body.op,
        ...(body.regionId ? { regionId: body.regionId } : {}),
        ...(body.region ? { region: { ...body.region, id: body.region.id ?? undefined } } : {}),
        ...(body.shape ? { shape: body.shape } : {}),
      });
      const isDefine = body.op === 'define';
      await tx.emit({
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
        await tx.emit({
          type: 'log.posted',
          payload: { kind: 'scene', sceneId: scene.id, text: `Revealed: ${region.name}` },
        });
      }
      return { fog };
    });
  }

  // --- drawings, AoE templates, scatter (FR9.12/9.15) -----------------------

  app.post('/api/scenes/:id/drawings', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { scene, auth } = await openScene(req, id);
    if (auth.role !== 'gm' && auth.role !== 'player') {
      throw httpError(403, 'forbidden', 'requires role: gm | player');
    }
    const body = parseBody(DrawingBody, req.body);
    const drawing = await app.hub.atomic(scene.campaignId, async (tx) => {
      const created = await svc
        .withDb(tx.db)
        .createDrawing(scene.id, { ...body, createdBy: auth.userId });
      await tx.emit({ type: 'drawing.added', payload: { drawing: created } });
      return created;
    });
    return reply.status(201).send({ drawing });
  });

  app.patch('/api/drawings/:id', async (req) => {
    const { id } = req.params as { id: string };
    const auth = requireRole(req, 'gm');
    const row = await svc.drawingRow(id);
    const scene = await svc.sceneRow(row.sceneId);
    assertCampaign(auth, scene.campaignId);
    const geometry = parseBody(z.record(z.string(), z.unknown()), req.body);
    const drawing = await app.hub.atomic(scene.campaignId, async (tx) => {
      const updated = await svc.withDb(tx.db).updateDrawing(id, geometry);
      await tx.emit({ type: 'drawing.added', payload: { drawing: updated } });
      return updated;
    });
    return { drawing };
  });

  app.delete('/api/drawings/:id', async (req) => {
    const { id } = req.params as { id: string };
    const auth = requireRole(req, 'gm');
    const row = await svc.drawingRow(id);
    const scene = await svc.sceneRow(row.sceneId);
    assertCampaign(auth, scene.campaignId);
    await app.hub.atomic(scene.campaignId, async (tx) => {
      await svc.withDb(tx.db).deleteDrawing(id);
      await tx.emit({
        type: 'drawing.cleared',
        payload: { sceneId: scene.id, drawingIds: [id] },
      });
    });
    return { ok: true };
  });

  app.delete('/api/scenes/:id/drawings', async (req) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const drawingIds = await app.hub.atomic(scene.campaignId, async (tx) => {
      const cleared = await svc.withDb(tx.db).clearDrawings(scene.id);
      await tx.emit({
        type: 'drawing.cleared',
        payload: { sceneId: scene.id, drawingIds: cleared },
      });
      return cleared;
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
    // The dice are already thrown (server-authoritative, G5) — only the
    // template row and its event are transactional.
    const drawing = await app.hub.atomic(scene.campaignId, async (tx) => {
      const created = await svc.withDb(tx.db).createDrawing(scene.id, {
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
      await tx.emit({ type: 'drawing.added', payload: { drawing: created } });
      return created;
    });
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
    // One transaction for the whole staging: the encounter row, every
    // combatant derived from a token, and the announcement. A partial stage —
    // three of five runners on the tracker, no event — is a fight the GM has
    // to notice is wrong before it starts.
    const staged = await app.hub.atomic(scene.campaignId, async (tx) => {
      const out = await svc.withDb(tx.db).stageEncounter(scene, body);
      await tx.emit({
        type: 'encounter.updated',
        payload: {
          encounterId: out.encounterId,
          sceneId: scene.id,
          staged: out.combatantIds.length,
          created: out.createdEncounter,
        },
      });
      return out;
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
      // The store now takes uploads from players, not just the GM. `nosniff`
      // stops a browser second-guessing the content type we send and deciding
      // for itself that a file is markup — the cheap half of the defence whose
      // expensive half (a re-encode) we do not have.
      .header('x-content-type-options', 'nosniff')
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
    // Position and `token.moved` commit together: the server is authoritative
    // for where a token IS (FR9.5), so a stored move nobody was told about
    // leaves every other screen — including the TV — drawing it in the old
    // square until someone reloads.
    await app.hub.atomic(ctx.campaignId, async (tx) => {
      const after = await svc.withDb(tx.db).patchToken(token.id, {
        x: parsed.data.x,
        y: parsed.data.y,
        ...(parsed.data.rotation !== undefined ? { rotation: parsed.data.rotation } : {}),
      });
      await emitTokenChange(tx, scene, token, after, { positional: true, nonPositional: false });
    });
    // "They're at the lab door, reveal?" (FR12.8). On the COMMIT only, never on
    // drag frames — a nudge per interim position would be a strobe. GM-only and
    // ephemeral inside `emitFogProximity`, and wrapped because a suggestion
    // failing must never turn a legal move into an error.
    //
    // Outside the transaction on purpose, and it has nothing to compensate: it
    // stores nothing and its frame is ephemeral, so the worst case is one
    // missing prompt. It also reads the scene, which inside the open block
    // would deadlock (the rule on `Hub.atomic`) — hence after, not within.
    try {
      await emitFogProximity(app.db, app.hub, ctx.campaignId, { sceneId: scene.id });
    } catch (err) {
      app.log.debug({ err }, 'fog proximity prompt failed after token.move');
    }
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

  /**
   * GM steering of the table display (FR9.21): blank the TV between scenes, or
   * hide the initiative ribbon during pure roleplay.
   *
   * Persisted, not ephemeral, and public: the TV is a `display` device, and a
   * kiosk that reboots (or joins late) has to come back in the state the GM
   * left it in — which it can only do by replaying the last `display.updated`.
   * The payload carries the FULL state, not the patch, so the newest event is
   * always the whole answer.
   *
   * `hub.emit`, deliberately, and NOT `hub.atomic`: there is no domain row
   * here. The event IS the state — `displayState` reads it back with
   * `latestEventOfType` — so this is a single write with nothing to be
   * inconsistent with, and wrapping it would buy a transaction for one insert.
   * AUDITED EXEMPTION (§6.2, the LIVE-4 sweep): with `magic.updated` folded
   * into `commitMagicState`, this is now the ONLY emit in the server left
   * outside a transaction on purpose — not one that was missed. Should a
   * `display_state` row ever appear, this becomes an `atomic` block that day.
   * `test/core-atomicity-domains.test.ts` pins the exemption from the other
   * side: it asserts the whole `src/` tree has no other bare `hub.emit`.
   */
  app.hub.onCommand('display.set', async (msg, ctx) => {
    if (ctx.auth.role !== 'gm') {
      return ctx.reply({ type: 'error', payload: { code: 'forbidden', message: 'the table display is GM-only' }, ephemeral: true });
    }
    const parsed = DisplaySetCommandSchema.safeParse({ ...msg, cmd: 'display.set' });
    if (!parsed.success) {
      return ctx.reply({ type: 'error', payload: { code: 'bad_request', message: 'invalid display.set' }, ephemeral: true });
    }
    const current = await svc.displayState(ctx.campaignId);
    const next = {
      blank: parsed.data.blank ?? current.blank,
      ribbon: parsed.data.ribbon ?? current.ribbon,
    };
    await app.hub.emit(ctx.campaignId, {
      type: 'display.updated',
      payload: next,
      visibility: 'public',
    });
  });
}
