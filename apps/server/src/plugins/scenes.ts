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
 * Principle 4 — hidden tokens, tokens standing in unrevealed fog, and
 * unrevealed fog geometry are filtered in src/services/scenes.ts at the query
 * layer (`tokenConcealed`, `sceneForViewer`), and their events carry `gm`
 * visibility so the hub never serializes them onto player/display sockets.
 * Revealing a hidden token, or the fog it stands in, emits `token.added` (a
 * NEW entity arriving, FR9.7); hiding either emits `token.removed`. And a
 * scene the GM is still staging has no table at all (`sceneOnTable`): every
 * event about what is on it — its tokens, their drags, its fog, its sight,
 * its drawings — goes to the GM alone until it goes live, when every device
 * reads it whole (P6 secrecy sweep, 2026-09-27).
 *
 * Walls (the GM's rule, 2026-09-27): a player's runner never passes a wall
 * or a closed door. A move a player makes, over the socket or by PATCH, is
 * stored only when the rules can walk it from where the token stands
 * (`canWalk`, rules movement/walk.ts), and a drag frame that could not be
 * walked is never relayed. The GM is never asked. See `playerMayWalk`.
 *
 * Sightlines (P6): every committed write that can move the party's sight (a
 * runner's move, a door, a light, paint, a scene PATCH, a fog op, the scene
 * going live) runs the sight pass (`recomputeSight`, services/sight.ts) in
 * its own transaction, after its write: the party's pooled sight is worked
 * out again, kept in the fog, told to the table as `fog.updated` op 'sight'
 * when it changed, and the tokens it uncovers or covers arrive and leave.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import '@fastify/multipart';
import { z } from 'zod';
import {
  TILESETS,
  canWalk,
  layerOf,
  migrateTileLayer,
  parseCellKey,
  sceneLevels,
  tileById,
  tilesetById,
  toSlot,
} from '@safehouse/rules';
import {
  DisplaySetCommandSchema,
  FogBrushStrokeSchema,
  FogOpSchema,
  FogRevealAsSchema,
  FogRegionSchema,
  GridSchema,
  PointSchema,
  SceneEnvironmentSchema,
  SceneGeometrySchema,
  SceneLayerSchema,
  SceneVisionSchema,
  ArcWallSchema,
  TileLayerSchema,
  TokenAuraSchema,
  TokenPoseSchema,
  SceneFileSchema,
  TokenLightSchema,
  TokenLookSchema,
  VisibilitySchema,
  sceneFogOn,
  type Scene,
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
import { checkSceneFileHeader, exportScene, importScene, unpackFiles } from '../services/scene-transfer.js';
import { emitFogProximity } from '../fixer/proximity.js';
import { applyDoorOp, doorRefusal, tileDoorState, withTileDoor, withTracedDoor } from '../services/doors.js';
import { affectsSight, recomputeSight } from '../services/sight.js';
import { runFogOp } from '../services/fogOps.js';
import {
  PerKeyThrottle,
  ScenesService,
  computeScatter,
  normalizeGrid,
  sceneEventVisibility,
  sceneForViewer,
  sceneOnTable,
  serializeScene,
  serializeToken,
  tokenConcealed,
  tokenEventVisibility,
  type ConcealableToken,
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

/**
 * `schema` for a PATCH: every key optional, and NONE of them defaulted.
 *
 * zod 4 fills in a missing key's default even under `.partial()`, and the
 * service merges a patch over what is stored. So a patch built with
 * `.partial()` said more than the GM did: `{grid: {cols: 40}}` arrived as
 * `{cols: 40, unitM: 1, offset: {x: 0, y: 0}, projection: 'topdown'}`, and
 * widening the map put it back to 1 m squares, uncalibrated, top-down; and
 * `{environment: {light: 3}}` arrived with `visibility`, `glare` and `wind`
 * all 0, so darkening a scene cleared its smoke. Each key's own bounds are
 * kept, only the default is taken off, so a patch says exactly the keys it
 * was sent. Output is a plain record: the service merges it and validates the
 * result whole (`normalizeGrid`, `normalizeEnvironment`).
 */
function patchOf<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  const shape: Record<string, z.ZodOptional<z.ZodType>> = {};
  for (const [key, field] of Object.entries(schema.shape) as [string, z.ZodType][]) {
    const bare = field instanceof z.ZodDefault ? (field.removeDefault() as z.ZodType) : field;
    shape[key] = bare.optional();
  }
  return z.object(shape);
}

const ScenePatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  state: z.enum(['draft', 'archived']).optional(),
  grid: patchOf(GridSchema).optional(),
  environment: patchOf(SceneEnvironmentSchema).optional(),
  geometry: SceneGeometrySchema.optional(),
  /**
   * Only the settings the GM changed, each WITHOUT its default. zod fills a
   * missing key's default even under `.partial()`, and the service merges the
   * patch over what is stored, so a patch saying only `sight` would also have
   * said `playersSeeOwnSight: false`: switching sightlines on would have
   * switched the dimming off.
   */
  vision: z
    .object({ playersSeeOwnSight: z.boolean().optional(), sight: SceneVisionSchema.shape.sight })
    .optional(),
  /** Token layers (FR9.26): the whole list, GM only. */
  tokenLayers: SceneLayerSchema.array().optional(),
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

/** One door, one act (FR9.24). Traced doors by id, painted ones by cell and floor. */
const DoorOpBody = z.object({
  doorId: z.string().optional(),
  cell: CellKeySchema.optional(),
  level: z.number().int().min(0).max(MAX_LEVELS - 1).default(0),
  op: z.enum(['open', 'close', 'lock', 'unlock']),
});

/** A floor's walls at any angle and curved walls, whole list at once (FR9.2). */
const ArcsBody = z.object({
  level: z.number().int().min(0).max(MAX_LEVELS - 1).default(0),
  /** The set the floor is drawn in, for a floor that has no tiles yet. */
  tilesetId: z.string().min(1).max(64).optional(),
  arcs: z.array(ArcWallSchema).max(500),
});

const TilesetSwitchBody = z.object({
  tilesetId: z.string().min(1).max(64),
  /** One floor only; absent means every floor. */
  level: z.number().int().min(0).optional(),
});

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
  pose: TokenPoseSchema.optional(),
  look: TokenLookSchema.nullable().optional(),
  light: TokenLightSchema.nullable().optional(),
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
  /** Standing, crouched or prone — a player may set their own runner's. */
  pose: TokenPoseSchema.optional(),
  /** The figure's look — a player may dress their own runner; null resets it. */
  look: TokenLookSchema.nullable().optional(),
  /** The light it carries — a player may switch their own runner's flashlight; null takes it away. */
  light: TokenLightSchema.nullable().optional(),
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

/** A fog op (`FogOpSchema`): the REST body, and the socket's `fog.reveal` command less its `sceneId`. */
const FogOpBody = z.object({
  op: FogOpSchema.default('reveal'),
  regionId: z.string().optional(),
  region: FogRegionSchema.partial({ id: true }).optional(),
  shape: z.array(PointSchema).min(3).optional(),
  /** For `reveal`: live (the default, as every reveal was before) or as explored (`FogRevealAsSchema`). */
  as: FogRevealAsSchema.optional(),
  /** For `forget`: the one floor whose memory goes; absent is every floor. For `brush`: the floor painted; absent is the ground. */
  level: z.number().int().min(0).max(MAX_LEVELS - 1).optional(),
  /** For `brush`: the squares painted, by what each is painted with (`FogBrushStrokeSchema`). */
  brush: FogBrushStrokeSchema.optional(),
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

  /**
   * Visibility scope for a token's events: concealed ⇒ GM sockets only
   * (FR9.7, Principle 4). Hidden by its own flag, by the layer it is on
   * (FR9.26), or standing on fogged ground that is not LIVE (FR9.13, P6:
   * unrevealed, or revealed only as explored): the scene says which, so
   * every emit reads it from the row it has in hand (`tokenConcealed`).
   * And every token of a STAGED scene is the GM's alone, however it stands
   * (`sceneOnTable`): the table has no staged scene to put it on.
   */
  const tokenVis = (token: ConcealableToken, scene: SceneRow): Visibility =>
    tokenEventVisibility(token, serializeScene(scene));

  /**
   * The scene as it stands inside the caller's transaction, read `FOR
   * UPDATE`, as the fog ops and the sight pass read it. Two kinds of caller
   * need it: a token event judged against the scene (`tokenVis`,
   * `emitTokenChange`), and a route that writes the scene back from what it
   * read (a door, paint, arcs, floors, the set).
   *
   * The lock is the point. Postgres reads committed rows, so a plain read
   * made while another transaction is still in flight gets the scene as it
   * was BEFORE that transaction: a runner stepping away from the vault
   * (whose sight pass is about to send `token.removed` for the guard in it),
   * the GM hiding the room, hiding a token layer, switching the sightlines
   * on.
   * - A guard moved, renamed or placed in that room in the same moment was
   *   judged against the old fog, so his new square, his name or the whole
   *   of him went out as a public event (persisted, in the log, folded
   *   straight onto the TV) right after the table had been told he was
   *   gone, and nothing ever took him off again.
   * - A door opened in the same moment (a PLAYER's write) waited for the
   *   GM's change to commit and then wrote the scene back as it had read
   *   it: the layer shown again, the sightlines off again, and every token
   *   they had withheld on the next read of every phone and the TV.
   * A pass, a fog op or a scene write holds this row locked until it
   * commits, so a locked read waits for it and is handed what it wrote; and
   * a caller holding the lock makes the next pass wait in turn, and read the
   * tokens where they now stand. PGlite runs one transaction at a time, so
   * the tests cannot interleave two; the race is the production database's
   * (DATABASE_URL, the docker stack).
   */
  const lockedScene = (tx: EventTx, sceneId: string): Promise<SceneRow> =>
    svc.withDb(tx.db).sceneRow(sceneId, { lock: true });

  /**
   * THE GM'S RULE (2026-09-27): "Only the GM should be able to move the
   * tokens through walls. During Play, the players should not be able to
   * move their tokens through walls at all."
   *
   * So a move a PLAYER makes — a drop over the socket, a PATCH of `x`/`y`,
   * a drag frame on its way to the table — must be one a runner could walk
   * from where the token stands to where it is going, on the floor it is on:
   * round the walls, through open doors, as far as it likes, but never
   * through a wall or a shut door (`canWalk`: painted walls, windows and
   * doors, arcs, traced walls and doors; furniture never stops anyone). Only
   * the mover's role decides: the GM is never asked, and a player is always
   * asked, whether or not the scene has sightlines or fog on.
   *
   * A player cannot change floors at all: `level` is not one of the keys a
   * player may PATCH, and `token.move` carries no floor. Taking the stairs
   * is the GM's, from the GM's screen (`useStairs`), and stays so; a player
   * move is judged on the floor the token already stands on.
   *
   * `here` is the scene as the caller read it: locked, inside the move's own
   * transaction, for a move that is stored, so a door shut a moment ago is
   * shut to it; as read for the frame, for a drag frame that is only relayed.
   * And `token` is where the runner stands: for a move that is stored, read
   * locked inside that same transaction too (`playerMoveJudged`).
   */
  function playerMayWalk(here: Scene, token: TokenRow, to: { x: number; y: number }): boolean {
    return canWalk(here, token.level, { x: token.x, y: token.y }, to, { size: token.size });
  }

  /**
   * `playerMayWalk` for a player's move about to be STORED, inside its own
   * transaction: judged from where the token stands now and against the
   * walls as they stand now, both read locked, the token first and then the
   * scene (the order every token write takes them in: `tokenRow`).
   *
   * Not from the row the request read before its transaction opened. That
   * row can be a move out of date: the GM drops the runner into the cell (or
   * sends them upstairs) while the player is still dragging, and the
   * player's drop, judged from the square the runner was in BEFORE the GM's
   * move, walked it straight back out through the cell's wall — or onto a
   * square of the new floor judged by the old floor's walls. And taking the
   * scene's lock before the token's, as a GM's move of the same token takes
   * them the other way round, was two transactions each waiting on the
   * other. A missing axis (`to.x` or `to.y`) stays where the token stands.
   * Answers the token as it stands, and whether the move may be stored.
   */
  async function playerMoveJudged(
    tx: EventTx,
    sceneId: string,
    tokenId: string,
    to: { x?: number | undefined; y?: number | undefined },
  ): Promise<{ stood: TokenRow; walkable: boolean }> {
    const stood = await svc.withDb(tx.db).tokenRow(tokenId, { lock: true });
    const here = serializeScene(await lockedScene(tx, sceneId));
    return { stood, walkable: playerMayWalk(here, stood, { x: to.x ?? stood.x, y: to.y ?? stood.y }) };
  }

  /** What a player is told when a wall is in the way. */
  const BLOCKED = { code: 'blocked', message: "Your runner can't go through walls" } as const;

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
   * A scene as a file (`SceneFile`): the map, its tokens, and the images it
   * draws on, packed into one download. GM only — it carries everything the
   * GM sees, hidden tokens and notes included.
   */
  app.get('/api/scenes/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const file = await exportScene(app.db, scene.id);
    const safe = scene.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'scene';
    return reply
      .header('content-disposition', `attachment; filename="${safe}.safehouse-scene.json"`)
      .send(file);
  });

  /**
   * A scene file, rebuilt as a new draft scene of this campaign. Its files
   * are unpacked first (outside the transaction — bytes on disk); the scene
   * and its tokens are one atomic step after.
   */
  app.post(
    '/api/campaigns/:id/scenes/import',
    // A scene file carries its map images: a battlemap scan or two in base64.
    { bodyLimit: 200 * 1024 * 1024 },
    async (req, reply) => {
      const { id: campaignId } = req.params as { id: string };
      const auth = requireRole(req, 'gm');
      assertCampaign(auth, campaignId);
      checkSceneFileHeader(req.body);
      const file = parseBody(SceneFileSchema, req.body);
      const fileIds = await unpackFiles(app.db, campaignId, file);
      const scene = await app.hub.atomic(campaignId, async (tx) => {
        const created = await importScene(tx.db, campaignId, file, fileIds);
        await tx.emit({ type: 'scene.updated', payload: { sceneId: created.id, changed: ['created'] } });
        return created;
      });
      return reply.status(201).send({ scene });
    },
  );

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
      const txSvc = svc.withDb(tx.db);
      // Merged over the scene as it stands inside this transaction, as the
      // tile routes do, not the row read before it opened: the scene before
      // the patch is also what the token diff below starts from.
      const fresh = await txSvc.sceneRow(id, { lock: true });
      const before = serializeScene(fresh);
      const written = await txSvc.updateScene(fresh, {
        ...body,
        grid: body.grid as Record<string, unknown> | undefined,
        environment: body.environment as Record<string, unknown> | undefined,
      });
      // Public delta signal only — the payload never carries GM-layer geometry;
      // clients re-GET the scene and receive their own role-filtered view.
      // The environment rides along for the TV to fold, but only for the
      // table's own scene: a staged scene's light, smoke and the GM's note on
      // it ("the warehouse is burning") are the GM's until it goes live.
      await tx.emit({
        type: 'scene.updated',
        payload: {
          sceneId: id,
          changed: written.changed,
          ...(sceneOnTable(written.scene) ? { environment: written.scene.environment } : {}),
        },
      });
      // Then the party's sight, which a PATCH can move every way there is:
      // walls and the GM's lights (geometry), the ambient light
      // (environment), the grid, the token layers (a runner on a hidden layer
      // is not an eye), and the sightlines switch itself (vision).
      //
      // The pass also runs the one token diff for the whole patch, from the
      // scene before it (`before`). A layer shown or hidden is tokens
      // arriving on or leaving the table (FR9.26), and whether each is on a
      // player's wire is the whole answer (`tokenConcealed`), not the layer
      // alone: a guard whose layer is shown while he stands in unrevealed fog
      // is still not the table's to see. Sightlines switched on fog a scene
      // whatever its fog switch says (`sceneFogOn`), so the guards outside
      // what the party sees leave the table with it and come back when they
      // go off. The dimming switch (`playersSeeOwnSight`) changes nobody's
      // answer, so flipping it sends nothing.
      //
      // When that switch moves whether the scene is fogged at all, the table
      // is told in the sight event's `active` even if the sight itself did
      // not change (no runner on the map yet): a TV folding fog events learns
      // it there, as it learns the GM's fog switch.
      const pass = await recomputeSight(tx, id, {
        before,
        announce: sceneFogOn(before) !== sceneFogOn(written.scene),
      });
      return { ...written.scene, fog: pass.fog };
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
   * Draw the scene in another set (FR9.2). A render decision: every floor's
   * `tilesetId` changes and nothing else does — the squares hold slots that
   * mean the same thing in every set, so the doors keep their locks, the
   * stairs still lead where they led, and switching back is exact. A floor
   * with nothing painted is left alone; the palette's choice lives on the
   * client until the first stroke.
   */
  app.post('/api/scenes/:id/tileset', async (req) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const body = parseBody(TilesetSwitchBody, req.body);
    if (tilesetById(body.tilesetId) === null) {
      throw httpError(400, 'unknown_tileset', `no such tileset: ${body.tilesetId}`);
    }
    const updated = await app.hub.atomic(scene.campaignId, async (tx) => {
      const txSvc = svc.withDb(tx.db);
      // Locked (`lockedScene`): merged over a row read without the lock, the
      // write below would put back a layer, a switch or a stroke that another
      // write was committing in the same moment.
      const fresh = await lockedScene(tx, id);
      const scene0 = serializeScene(fresh);
      const redraw = (tiles: NonNullable<typeof scene0.tiles>) => ({
        ...migrateTileLayer(tiles),
        tilesetId: body.tilesetId,
        cells: {},
      });
      // Every floor, or the one named — undo puts floors back one at a time.
      const only = body.level;
      const patch: Record<string, unknown> = {};
      if (only === undefined || only === 0) {
        // An unpainted ground floor still remembers the choice: an empty layer
        // in the new set, so the palette, the floor builder and the next
        // reload all agree on what this scene is drawn in. It used to be a
        // no-op, and a scene switched to the lake before anything was painted
        // came back as the docklands.
        patch['tiles'] = scene0.tiles
          ? redraw(scene0.tiles)
          : { tilesetId: body.tilesetId, cells: {}, ground: {}, structure: {}, object: {} };
      }
      if ((scene0.levels ?? []).length > 0 && (only === undefined || only > 0)) {
        patch['levels'] = (scene0.levels ?? []).map((l, i) =>
          l.tiles && (only === undefined || only === i + 1) ? { ...l, tiles: redraw(l.tiles) } : l,
        );
      }
      if (Object.keys(patch).length === 0) return scene0;
      const written = await txSvc.updateScene(fresh, patch);
      await tx.emit({ type: 'scene.updated', payload: { sceneId: id, changed: written.changed } });
      // A slot means the same thing in every set, so the walls stand where
      // they stood; but a set's lamps and glowing windows are its own, and
      // the dark moves with them.
      const pass = await recomputeSight(tx, id);
      return { ...written.scene, fog: pass.fog };
    });
    return { scene: updated };
  });

  /**
   * A door, opened or shut or locked (FR9.24).
   *
   * The one scene write a PLAYER may make: their own screen, their own hand
   * on the handle, no asking. A locked door refuses them by name — "that
   * door is locked" is what the runner learns and what the table should
   * hear — and the lock itself is the GM's. Traced doors by id; painted ones
   * by floor and cell. Both land as a `scene.updated`, so every device
   * re-reads the scene and a sightline through an open door is a sightline.
   */
  app.post('/api/scenes/:id/doors', async (req) => {
    const { id } = req.params as { id: string };
    const { scene, gm } = await openScene(req, id);
    const body = parseBody(DoorOpBody, req.body);
    const result = await app.hub.atomic(scene.campaignId, async (tx) => {
      // The door, and the rest of the scene written back around it, read
      // inside this transaction and locked (`lockedScene`), never from the
      // row `openScene` read before it opened. `updateScene` writes every
      // part of the geometry envelope from the row it is handed (the walls,
      // the pins, the token layers, the sightlines switch), so a door opened
      // from that earlier row put back whatever the GM had changed in
      // between: a layer she had just hidden shown again, the sightlines she
      // had just switched on off again, and the tokens they withheld on the
      // table at its next read. A player's hand on a handle, undoing the GM.
      const fresh = await lockedScene(tx, id);
      if (!gm && !sceneOnTable(fresh)) throw httpError(404, 'not_found', 'unknown scene');
      const current = serializeScene(fresh);
      if (body.doorId !== undefined) {
        const door = current.geometry.doors.find((d) => d.id === body.doorId);
        if (!door) throw httpError(404, 'not_found', 'no such door');
        const refusal = doorRefusal(gm, door, body.op);
        if (refusal) throw httpError(403, refusal.code, refusal.message);
        const state = applyDoorOp(door, body.op);
        await tx.emit({ type: 'scene.updated', payload: { sceneId: id, changed: ['geometry'] } });
        await svc.withDb(tx.db).updateScene(fresh, { geometry: withTracedDoor(current.geometry, door.id, state) });
        // A door is the commonest thing that moves the party's sight: opened,
        // the room beyond is seen, and whoever stands in it arrives on the
        // table with the same commit; shut, they leave it.
        await recomputeSight(tx, id);
        return { door: { id: door.id, ...state } };
      }
      if (body.cell === undefined) throw httpError(400, 'bad_request', 'name a door: doorId, or cell (and level)');
      const ref = { level: body.level, cell: body.cell };
      const found = tileDoorState(current, ref);
      if (found === null) throw httpError(404, 'not_found', 'no door painted in that cell');
      const refusal = doorRefusal(gm, found, body.op);
      if (refusal) throw httpError(403, refusal.code, refusal.message);
      const state = applyDoorOp(found, body.op);
      const write = withTileDoor(current, ref, state);
      if (write === null) throw httpError(404, 'not_found', 'no door painted in that cell');
      await tx.emit({ type: 'scene.updated', payload: { sceneId: id, changed: ['tiles'] } });
      await svc.withDb(tx.db).updateScene(fresh, write);
      await recomputeSight(tx, id);
      return { door: { cell: body.cell, level: body.level, ...state } };
    });
    return result;
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
      // The table's first look at the scene is the party's sight as it
      // stands now. Every committed change keeps it current, but a scene can
      // come to this without one: imported (its live squares are not carried
      // in, `importScene`), or staged while a runner's sheet changed. On a
      // scene without sightlines this writes and sends nothing.
      const pass = await recomputeSight(tx, activated.id);
      return { ...activated, fog: pass.fog };
    });
    return { scene };
  });

  // --- tokens (FR9.4–9.7) ---------------------------------------------------

  app.post('/api/scenes/:id/tokens', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const body = parseBody(TokenCreateBody, req.body);
    const token = await app.hub.atomic(scene.campaignId, async (tx) => {
      const txSvc = svc.withDb(tx.db);
      const created = await txSvc.createToken(scene, body);
      await tx.emit({
        type: 'token.added',
        payload: { token: created },
        // Judged against the fog as it stands now, inside the transaction,
        // so a guard placed in a room the GM hid a moment ago stays the GM's.
        // Read LOCKED (`lockedScene`): a sight pass or a fog op still in
        // flight is waited for, not read around.
        visibility: tokenVis(created, await lockedScene(tx, scene.id)),
      });
      // A runner placed is a pair of eyes on the table, and a token carrying
      // a light lights the dark for them. Anyone else changes no one's sight.
      if (affectsSight(created)) await recomputeSight(tx, scene.id);
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
      // FR9.5: players may only reposition their own character's token —
      // and crouch it, or lie it down, which is where their runner is too.
      // And switch its flashlight on or off: whether the runner is showing a
      // light in a dark corridor is the runner's call, not the GM's.
      const playerKeys = new Set(['x', 'y', 'rotation', 'pose', 'look', 'light']);
      if (Object.keys(body).some((k) => !playerKeys.has(k))) {
        throw httpError(403, 'forbidden', 'only the GM may edit token properties');
      }
      if (!(await svc.canControlToken(auth, before))) {
        throw httpError(403, 'forbidden', 'you do not control this token');
      }
      // The switch and nothing else: what the runner carries and how far it
      // throws is the GM's to say, so every other field stays as the GM
      // left it, and a player can neither hand out a light nor take one away.
      if (body.light !== undefined) {
        const held = serializeToken(before).light;
        if (held === null || body.light === null) {
          throw httpError(403, 'forbidden', 'only the GM may give or take away a light');
        }
        body.light = { ...held, on: body.light.on };
      }
    }
    // The permission reads above are all hoisted out of the block; only the
    // row write and the event(s) describing it are inside it.
    // What in a token moves the party's sight: where it stands and on which
    // floor, whether it is on the table at all, the light it carries, and
    // which way it faces (a beam points where its token does). A rename, a
    // pose or a new look moves nothing, and skips the pass; so does any
    // change to a token that is neither a runner nor a light (`affectsSight`).
    const sightKeys = ['x', 'y', 'level', 'hidden', 'light', 'rotation'] as const;
    const movesSight = sightKeys.some((k) => body[k] !== undefined);
    const after = await app.hub.atomic(scene.campaignId, async (tx) => {
      // A player's move must be one their runner could walk (`playerMayWalk`),
      // judged from where the token stands and against the scene as it
      // stands, both inside this transaction (`playerMoveJudged`).
      if (auth.role !== 'gm' && (body.x !== undefined || body.y !== undefined)) {
        const { walkable } = await playerMoveJudged(tx, scene.id, id, body);
        if (!walkable) throw httpError(403, BLOCKED.code, BLOCKED.message);
      }
      const written = await svc.withDb(tx.db).patchToken(id, body);
      await emitTokenChange(tx, scene, before, written, { positional, nonPositional });
      // After the token's own event, so a guard the move walks into sight
      // arrives after the move that showed him, and the sight event carries
      // where the party is looking now.
      if (movesSight && (affectsSight(before) || affectsSight(written))) await recomputeSight(tx, scene.id);
      // A runner's look is the runner's: it goes onto the character and onto
      // every token of theirs, in this scene and every other. Each of those
      // is told to whoever may see THAT token where it stands
      // (`tokenEventVisibilities`): the table for one on the table, the GM
      // alone for one on a hidden layer or on a scene still being staged. It
      // used to be the token's own `hidden` flag alone, and a runner the GM
      // had placed in next week's scene went out to every phone and the TV,
      // with the scene it stands in.
      if (body.look !== undefined && written.source === 'character' && written.sourceId) {
        const txSvc = svc.withDb(tx.db);
        const others = (await txSvc.setCharacterLook(written.sourceId, body.look)).filter((t) => t.id !== written.id);
        const heard = await txSvc.tokenEventVisibilities(others);
        for (const t of others) {
          await tx.emit({ type: 'token.updated', payload: { token: serializeToken(t) }, visibility: heard(t) });
        }
      }
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
      const txSvc = svc.withDb(tx.db);
      await txSvc.deleteToken(id);
      await tx.emit({
        type: 'token.removed',
        payload: { tokenId: id, sceneId: scene.id },
        // Judged against the scene as it stands inside this transaction, as
        // the create and the move are, not the row read before it opened;
        // locked, as theirs is (`lockedScene`).
        visibility: tokenVis(token, await lockedScene(tx, scene.id)),
      });
      // A runner taken off the map takes their eyes with them; a lamp-post
      // token its light.
      if (affectsSight(token)) await recomputeSight(tx, scene.id);
    });
    return { ok: true };
  });

  /**
   * Emit the right event(s) for a token mutation. Reveal (concealed → on the
   * table) surfaces as `token.added` for players: a NEW entity arriving, never
   * a position that was quietly on their wire all along (FR9.7).
   *
   * "Concealed" is the whole answer (`tokenConcealed`): hidden by its flag or
   * its layer, or standing on fogged ground that is not LIVE (unrevealed, or
   * revealed only as explored). So a guard the GM walks out of the fog into
   * a room revealed live arrives exactly as an unhidden one does, and one
   * walked back into the fog, or into a remembered room, leaves exactly as a
   * hidden one does — a public `token.removed`, then the GM's own copy of
   * where he went.
   * A token concealed both before and after (flipping `hidden` on one that
   * stands in fog, moving a guard around inside it) is a GM-only edit. So is
   * every edit to a token on a STAGED scene (`sceneOnTable`): nothing on it
   * is on the table, before or after, so nothing arrives or leaves, and the
   * GM builds the ambush without a phone in the room hearing a step of it.
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
    // The scene as it stands inside this transaction, not the row the caller
    // read before opening it. A fog op that committed in between (the GM
    // hiding the room this guard is being dropped into) must decide who hears
    // the move: judged against the older fog, the drop went out as a public
    // `token.moved`, a position in a room the table had just lost. And read
    // LOCKED (`lockedScene`), so "in between" includes a fog op or a sight
    // pass that has not committed yet.
    const current = serializeScene(await lockedScene(tx, scene.id));
    const table = sceneOnTable(current);
    const was = !table || tokenConcealed(before, current);
    const now = !table || tokenConcealed(after, current);
    if (was && !now) {
      await tx.emit({ type: 'token.added', payload: { token: dto } });
      return;
    }
    if (!was && now) {
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
    const visibility: Visibility = now ? 'gm' : 'public';
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

  // Tokens arriving on the table and leaving it because the SCENE changed
  // around them (a layer, a fog op, the party's sight) are the sight pass's
  // concealment diff: `emitConcealmentChanges` in services/sight.ts, run by
  // `recomputeSight` after every write that can move that edge.

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
      // Locked (`lockedScene`): merged over a row read without the lock, the
      // write below would put back a layer, a switch or a stroke that another
      // write was committing in the same moment.
      const fresh = await lockedScene(tx, id);
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
      // Layers hold SLOTS (rules/tilesets/slots.ts), which mean the same thing
      // in every set, so a stroke under another set keeps every square and
      // only changes which set the floor is drawn in. Only `clear` starts
      // the floor over.
      const keep = !body.clear && existing !== undefined;
      // Read through the migration, so a scene painted before layers or
      // slots existed upgrades itself the first time the GM touches it.
      const layers = keep
        ? { ...migrateTileLayer(existing), tilesetId: body.tilesetId }
        : { tilesetId: body.tilesetId, ground: {}, structure: {}, object: {} };

      if (body.clear && body.layer !== undefined && keep) {
        // Clearing ONE layer: everything else stands. Wiping the furniture out
        // of a room should not take the room with it.
        layers[body.layer] = {};
      }

      // Where a tile goes is the tile's business (`layerOf`), never the
      // client's: that is what stops a wall being painted into the layer that
      // line of sight does not read.
      for (const [key, ref] of Object.entries(body.paint)) {
        const tile = tileById(body.tilesetId, ref)!;
        // Stored as the slot, so the square reads the same in any set.
        layers[layerOf(tile)][key] = toSlot(tilesetById(body.tilesetId)!, tile.id) ?? tile.id;
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
      // Paint is the walls, the doors and the lamps: a wall painted between a
      // runner and a room takes the room out of their sight, a lamp painted
      // lights it.
      const pass = await recomputeSight(tx, id);
      return { ...written.scene, fog: pass.fog };
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
   * A floor's walls at any angle and curved walls, replaced whole (FR9.2).
   *
   * Whole-list, like the floors: an arc is added, bent, moved or deleted by
   * sending the floor's list as it should now be, which is also exactly what
   * undo sends back. Every arc's tile must be a wall in the floor's set.
   */
  app.put('/api/scenes/:id/arcs', async (req) => {
    const { id } = req.params as { id: string };
    const { scene } = await openScene(req, id, { gmOnly: true });
    const body = parseBody(ArcsBody, req.body);
    const updated = await app.hub.atomic(scene.campaignId, async (tx) => {
      const txSvc = svc.withDb(tx.db);
      // Locked (`lockedScene`): merged over a row read without the lock, the
      // write below would put back a layer, a switch or a stroke that another
      // write was committing in the same moment.
      const fresh = await lockedScene(tx, id);
      const scene0 = serializeScene(fresh);
      const floors = sceneLevels(scene0);
      if (body.level >= floors.length) {
        throw httpError(400, 'unknown_level', `this scene has ${floors.length} level(s); no level ${body.level}`);
      }
      const existing = floors[body.level]?.tiles;
      const tilesetId = existing?.tilesetId ?? body.tilesetId;
      if (tilesetId === undefined || tilesetById(tilesetId) === null) {
        throw httpError(400, 'unknown_tileset', 'say which tileset this floor is drawn in');
      }
      for (const arc of body.arcs) {
        const tile = tileById(tilesetId, arc.tile);
        if (tile === null || layerOf(tile) !== 'structure') {
          throw httpError(400, 'unknown_tile', `an arc is built of a wall in the floor's set, not "${arc.tile}"`);
        }
      }
      const base = existing
        ? migrateTileLayer(existing)
        : { tilesetId, ground: {}, structure: {}, object: {} };
      const tiles = { ...base, cells: {}, arcs: body.arcs };
      const patch =
        body.level === 0
          ? { tiles }
          : {
              levels: (scene0.levels ?? []).map((l, i) => (i === body.level - 1 ? { ...l, tiles } : l)),
            };
      const written = await txSvc.updateScene(fresh, patch);
      await tx.emit({ type: 'scene.updated', payload: { sceneId: id, changed: written.changed } });
      // An arc is a wall, and stops sight in every square it passes through.
      const pass = await recomputeSight(tx, id);
      return { ...written.scene, fog: pass.fog };
    });
    return { scene: updated };
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
      // Locked (`lockedScene`): merged over a row read without the lock, the
      // write below would put back a layer, a switch or a stroke that another
      // write was committing in the same moment.
      const fresh = await lockedScene(tx, id);
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
      // A floor taken away takes its walls and lamps with it, and a runner
      // still standing on it now sees an empty storey.
      const pass = await recomputeSight(tx, id);
      return { ...written.scene, fog: pass.fog };
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
   * A fog op, from the Fog panel, the Prep brush or the socket: applied and
   * told in one transaction (`runFogOp`, services/fogOps.ts, which a Fixer
   * draft the GM accepts goes through too). The events it sends are
   * player-safe by construction — a reveal may carry the region it opens, a
   * `define` stays the GM's, `hide` and `remove` carry an id and no geometry
   * — and the tokens the op uncovers or covers arrive and leave in the same
   * commit; the rules are written out there.
   */
  async function applyFog(
    scene: SceneRow,
    body: z.output<typeof FogOpBody>,
  ): Promise<{ fog: unknown }> {
    return app.hub.atomic(scene.campaignId, (tx) =>
      runFogOp(tx, scene.id, {
        op: body.op,
        ...(body.regionId ? { regionId: body.regionId } : {}),
        ...(body.region ? { region: { ...body.region, id: body.region.id ?? undefined } } : {}),
        ...(body.shape ? { shape: body.shape } : {}),
        ...(body.as ? { as: body.as } : {}),
        ...(body.level !== undefined ? { level: body.level } : {}),
        ...(body.brush ? { brush: body.brush } : {}),
        ...(body.announce ? { announce: true } : {}),
      }),
    );
  }

  // --- drawings, AoE templates, scatter (FR9.12/9.15) -----------------------
  //
  // A drawing or a template on the ACTIVE scene is public wherever it lies,
  // fog or no fog (P6, decided 2026-09-27). It is somebody's deliberate mark
  // for the table: a player's sketch is on ground they can see, and a
  // template the GM drops is the GM saying "the grenade lands here" out
  // loud. A template dropped on a guard in the dark does show where he is,
  // and that is the GM's call to make, as it is at a real table; the server
  // does not second-guess it. Pings, pointers and "focus here" (hub.ts) are
  // the same kind of act and stay public too.
  //
  // On a STAGED scene there is no table (`sceneOnTable`), so a mark there is
  // the GM's alone (`sceneEventVisibility`): the GM sketching next week's
  // ambush is not drawing it on every phone's socket. The table gets the
  // scene's drawings in the read it makes when the scene goes live.

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
      await tx.emit({ type: 'drawing.added', payload: { drawing: created }, visibility: sceneEventVisibility(scene) });
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
      await tx.emit({ type: 'drawing.added', payload: { drawing: updated }, visibility: sceneEventVisibility(scene) });
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
        visibility: sceneEventVisibility(scene),
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
        visibility: sceneEventVisibility(scene),
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
      await tx.emit({ type: 'drawing.added', payload: { drawing: created }, visibility: sceneEventVisibility(scene) });
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
          // A public frame, so the count is of the combatants the table may
          // see (`shown`). It used to be every one staged, and the difference
          // between that and the roster a player is sent was a head-count of
          // the guards hidden, or standing in the fog, that the GM is holding
          // back. The GM has the whole list in the response.
          staged: out.shown,
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
    // A drag frame is the table's only when the token is on the table where
    // it stands AND where the frame puts it. The first keeps a guard the
    // players have not been sent from surfacing as a frame for an id they do
    // not know; the second keeps the GM dragging a visible guard INTO the fog
    // from drawing his path through it on every player's socket. The drop
    // (`token.move`) then settles which side of the edge he ended up on.
    // And on a staged scene no frame is the table's at all (`sceneOnTable`).
    const current = serializeScene(scene);
    // A player's frame the runner could not walk to from where the token
    // stands (`playerMayWalk`) is not relayed: every other screen would draw
    // the runner through the wall on its way to a drop the server refuses.
    // The client's own drag stops at the wall (`walkToward`), so this only
    // ever drops frames from a client that does not; the drag's start is
    // where the token is stored, because nothing is stored until the drop.
    if (ctx.auth.role !== 'gm' && !playerMayWalk(current, token, parsed.data)) return;
    const concealed =
      !sceneOnTable(current) ||
      tokenConcealed(token, current) ||
      tokenConcealed({ ...token, x: parsed.data.x, y: parsed.data.y }, current);
    app.hub.emitEphemeral(ctx.campaignId, {
      type: 'token.dragging',
      payload: { tokenId: token.id, sceneId: scene.id, x: parsed.data.x, y: parsed.data.y, by: ctx.auth.userId },
      visibility: concealed ? 'gm' : 'public',
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
    // Null once the move is stored; the token as it stands when a wall
    // refused the move.
    const refused = await app.hub.atomic(ctx.campaignId, async (tx): Promise<TokenRow | null> => {
      // A player's drop must be one their runner could walk (`playerMayWalk`),
      // judged from where the token stands and against the scene as it
      // stands, both inside this transaction (`playerMoveJudged`): a door
      // shut while the drag was in the air is shut to the drop, and a GM's
      // move of the runner that landed meanwhile is where it is judged from.
      if (ctx.auth.role !== 'gm') {
        const { stood, walkable } = await playerMoveJudged(tx, scene.id, token.id, parsed.data);
        if (!walkable) return stood;
      }
      const after = await svc.withDb(tx.db).patchToken(token.id, {
        x: parsed.data.x,
        y: parsed.data.y,
        ...(parsed.data.rotation !== undefined ? { rotation: parsed.data.rotation } : {}),
      });
      await emitTokenChange(tx, scene, token, after, { positional: true, nonPositional: false });
      // The drop, not the drag: the party's sight is worked out again once,
      // here, in the same commit as the move. A runner stepping round a
      // corner shows the table the corridor (a public `fog.updated`, op
      // 'sight') and whoever stands in it (`token.added`) with the move that
      // did it; a guard walked with a flashlight moves the light he casts.
      // A guard with no light moves nobody's sight (`affectsSight`).
      if (affectsSight(token) || affectsSight(after)) await recomputeSight(tx, scene.id);
      return null;
    });
    if (refused !== null) {
      // Refused: the token stays where it is, and the player is told why.
      ctx.reply({ type: 'error', payload: { ...BLOCKED }, ephemeral: true });
      // The drag's frames put a ghost of the runner on every other screen,
      // and only a `token.moved` takes it away. No move is coming, so one
      // last frame sends the ghost home to the square the token never left
      // (where it stands now, read in the refusal), told to whoever the
      // frames went to.
      const current = serializeScene(scene);
      const concealed = !sceneOnTable(current) || tokenConcealed(refused, current);
      app.hub.emitEphemeral(ctx.campaignId, {
        type: 'token.dragging',
        payload: { tokenId: token.id, sceneId: scene.id, x: refused.x, y: refused.y, by: ctx.auth.userId },
        visibility: concealed ? 'gm' : 'public',
      });
      return;
    }
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
