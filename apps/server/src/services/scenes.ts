/**
 * Scenes service (M9, FR9.1–9.15): scene CRUD + activation, tokens, fog
 * state, drawings/AoE templates with grenade scatter, map attachments on
 * disk under DATA_DIR/files, and the scene→rolls bridge
 * `activeSceneModifiers` (FR9.11).
 *
 * Pure db/domain logic — src/plugins/scenes.ts owns routes, permissions and
 * hub events. Player-side filtering (hidden tokens, unrevealed fog) happens
 * here at the query/serialization layer, never client-side (Principle 4).
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { migrateTileLayer } from '@safehouse/rules';
import {
  GridProjectionSchema,
  GridSchema,
  SceneEnvironmentSchema,
  SceneGeometrySchema,
  FogStateSchema,
  SheetV1Schema,
  TokenAuraSchema,
  type FogRegion,
  type FogState,
  type Grid,
  type Modifier,
  type Point,
  type Scene,
  type SceneEnvironment,
  type SceneGeometry,
  type Token,
  type TokenAura,
  type Visibility,
  TileLayerSchema,
  type TileLayer,
  SceneLevelSchema,
  type SceneLevel,
} from '@safehouse/contracts';
import { environment } from '@safehouse/rules';
import {
  attachments,
  characters,
  combatants,
  drawings,
  encounters,
  latestEventOfType,
  npcTemplates,
  scenes,
  tokens,
  type Db,
} from '@safehouse/db';
import { rollDie } from './dice.js';
import { httpError } from './auth.js';
// Pure row-model helper (no db, no hub): the one place an initiative line is
// derived from a sheet, shared with the encounters domain (FR4.2).
import { deriveFor } from './encounters-model.js';

export type SceneRow = typeof scenes.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;
export type DrawingRow = typeof drawings.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;

// ---------------------------------------------------------------------------
// Normalization + serialization
// ---------------------------------------------------------------------------

/** FR9.1 (Q11 resolved 0.6): default 1 m per square. */
const DEFAULT_GRID = { unitM: 1, cols: 30, rows: 30, offset: { x: 0, y: 0 }, projection: 'topdown' as const };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A stored grid, made safe to render.
 *
 * The fallback is all-or-nothing by design — a grid we cannot parse is not a
 * grid — but that is dangerous the moment the schema grows an ENUM, because
 * one unrecognised string then discards the whole object. Concretely: a scene
 * saved by a build that knows a third projection, reopened by this one, would
 * come back 30×30 at 1 m and the GM's calibration would be gone with no error
 * anywhere. Losing a view preference is a shrug; losing the map's dimensions
 * is an evening.
 *
 * So the one enum is normalised on its own first, and an unrecognised value is
 * dropped rather than allowed to fail the parse. Everything else keeps the
 * strict behaviour: a grid with a string where `cols` should be really is
 * unusable, and the default really is the right answer for it.
 */
export function normalizeGrid(raw: unknown): Grid {
  const merged: Record<string, unknown> = { ...DEFAULT_GRID, ...(isRecord(raw) ? raw : {}) };
  if (!GridProjectionSchema.safeParse(merged['projection']).success) {
    delete merged['projection'];
  }
  const parsed = GridSchema.safeParse(merged);
  return parsed.success ? parsed.data : GridSchema.parse(DEFAULT_GRID);
}

export function normalizeEnvironment(raw: unknown): SceneEnvironment {
  const parsed = SceneEnvironmentSchema.safeParse(isRecord(raw) ? raw : {});
  return parsed.success ? parsed.data : SceneEnvironmentSchema.parse({});
}

export function normalizeGeometry(raw: unknown): SceneGeometry {
  const parsed = SceneGeometrySchema.safeParse(isRecord(raw) ? raw : {});
  return parsed.success ? parsed.data : SceneGeometrySchema.parse({});
}

export function normalizeFog(raw: unknown): FogState {
  const parsed = FogStateSchema.safeParse(isRecord(raw) ? raw : {});
  return parsed.success ? parsed.data : FogStateSchema.parse({});
}

/**
 * The `scenes.geometry` jsonb column also carries `mapAttachmentIds` and
 * `notes`: §9.2 gives them no columns of their own, and the Zod geometry
 * schema strips them back out on read. Should the table ever grow the
 * columns, this is a straight lift — nothing else reads the envelope.
 */
function geometryColumn(
  geometry: SceneGeometry,
  mapAttachmentIds: string[],
  notes?: string,
  tiles?: TileLayer,
  levels?: SceneLevel[],
) {
  // `tiles` rides in the existing geometry JSONB rather than earning a column:
  // it is scene-shaped authoring data like walls and pins, and this keeps the
  // painted floor inside the same atomic write as the geometry drawn over it.
  return {
    ...geometry,
    mapAttachmentIds,
    ...(notes !== undefined ? { notes } : {}),
    ...(tiles !== undefined ? { tiles } : {}),
    ...(levels !== undefined ? { levels } : {}),
  };
}

/** Full (GM-grade) API shape for a scene row. */
export function serializeScene(row: SceneRow): Scene {
  const geoRaw = isRecord(row.geometry) ? row.geometry : {};
  const rawIds = geoRaw['mapAttachmentIds'];
  const mapAttachmentIds = Array.isArray(rawIds)
    ? rawIds.filter((s): s is string => typeof s === 'string')
    : [];
  const notes = typeof geoRaw['notes'] === 'string' ? geoRaw['notes'] : undefined;
  const tilesParsed = TileLayerSchema.safeParse(geoRaw['tiles']);
  // Migrate on the way OUT, so the wire format is always layered and no client
  // has to know that scenes were ever flat. A pre-layers scene therefore looks
  // identical to a migrated one from the moment it is read — which is what
  // lets line of sight, the renderer and the palette each assume layers
  // without any of them carrying a compatibility branch.
  const tiles = tilesParsed.success
    ? { ...migrateTileLayer(tilesParsed.data), cells: {} }
    : undefined;
  // Floors above the ground one. Each level's tiles go through the SAME
  // migration as `tiles`, so a storey painted before layers existed reads
  // identically to one painted after: neither sight nor the renderer should
  // care which floor it is looking at, or when that floor was drawn.
  const levels = (Array.isArray(geoRaw['levels']) ? geoRaw['levels'] : []).flatMap(
    (raw): SceneLevel[] => {
      const parsed = SceneLevelSchema.safeParse(raw);
      if (!parsed.success) return [];
      const lvl = parsed.data;
      return [
        lvl.tiles === undefined
          ? lvl
          : { ...lvl, tiles: { ...migrateTileLayer(lvl.tiles), cells: {} } },
      ];
    },
  );
  return {
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    state: row.state,
    levels,
    grid: normalizeGrid(row.grid),
    environment: normalizeEnvironment(row.environment),
    geometry: normalizeGeometry(geoRaw),
    fog: normalizeFog(row.fog),
    mapAttachmentIds,
    ...(tiles !== undefined ? { tiles } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(row.audioRef ? { audioRef: row.audioRef } : {}),
  };
}

/**
 * Strip GM-layer data for player/observer/display viewers (Principle 4):
 * GM notes, GM-layer geometry (walls/doors/zones, non-public pins), and every
 * unrevealed fog region — players get only revealed geometry (FR9.13).
 *
 * `tiles` and `mapAttachmentIds` deliberately pass through UNFILTERED, and the
 * distinction is worth stating because it looks like an oversight and is not.
 * A painted tile layer is the MAP, not the GM's annotation of it — the same
 * role an uploaded map image plays, which has always shipped whole and been
 * occluded by fog in the client. Filtering one and not the other would be
 * incoherent, and filtering both means occluding a raster image server-side,
 * per viewer, which is a different feature.
 *
 * The cost is real and accepted: a player who opens devtools can read the
 * layout of a room the GM has not revealed, including cells whose tile ids are
 * `wall` and `door`. Fog is a *presentation* boundary for the map and a
 * *secrecy* boundary for everything else. If that ever needs to change, it
 * changes for map images at the same time, or not at all.
 */
export function sceneForViewer(scene: Scene, gm: boolean): Scene {
  if (gm) return scene;
  const revealed = new Set(scene.fog.revealed);
  const filtered: Scene = {
    ...scene,
    geometry: {
      walls: [],
      doors: [],
      zones: [],
      pins: scene.geometry.pins.filter((p) => p.visibility === 'public'),
    },
    fog: {
      regions: scene.fog.regions.filter((r) => revealed.has(r.id)),
      revealed: scene.fog.revealed,
      revealedShapes: scene.fog.revealedShapes,
    },
  };
  delete (filtered as { notes?: string }).notes;
  return filtered;
}

/**
 * A serialized token as the API emits it. `TokenSchema` leaves `sourceId` /
 * `artRef` / `aura` optional; the server always writes them (null when empty)
 * so consumers get a total shape without narrowing `undefined` away.
 */
export type TokenDto = Token & {
  sourceId: string | null;
  artRef: string | null;
  aura: TokenAura | null;
};

export function serializeToken(row: TokenRow): TokenDto {
  const bars = row.barsVisibility;
  const auraParsed = TokenAuraSchema.nullable().safeParse(row.aura ?? null);
  return {
    id: row.id,
    sceneId: row.sceneId,
    source: row.source,
    sourceId: row.sourceId,
    name: row.name,
    x: row.x,
    y: row.y,
    level: row.level ?? 0,
    size: row.size,
    rotation: row.rotation,
    artRef: row.artRef,
    hidden: row.hidden,
    barsVisibility: bars === 'gm' || bars === 'owner' || bars === 'public' ? bars : 'owner',
    aura: auraParsed.success ? auraParsed.data : null,
  };
}

export interface DrawingDto {
  id: string;
  sceneId: string;
  kind: 'sketch' | 'template';
  geometry: Record<string, unknown>;
  createdBy: string | null;
  expiresAt: string | null;
}

export function serializeDrawing(row: DrawingRow): DrawingDto {
  return {
    id: row.id,
    sceneId: row.sceneId,
    kind: row.kind,
    geometry: isRecord(row.geometry) ? row.geometry : {},
    createdBy: row.createdBy,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Grenade scatter (FR9.12) — original generic formula, params editable
// ---------------------------------------------------------------------------

export interface ScatterParams {
  /** Intended impact point, grid units. */
  x: number;
  y: number;
  /** Net hits on the throw/launch reduce scatter distance (min 0). */
  netHits?: number;
  /** Number of distance d6 (editable per launcher type; default 2). */
  scatterDice?: number;
  /** Meters per grid unit for the target scene (default 1). */
  gridUnitM?: number;
  /** Override the direction die (1–6) — editable/replayable. */
  directionDie?: number;
  /** Override the rolled distance dice — editable/replayable. */
  distanceDice?: number[];
}

export interface ScatterResult {
  directionDie: number;
  /** 0° = grid north (−y), clockwise in 60° sectors per direction pip. */
  angleDeg: number;
  distanceDice: number[];
  rawDistanceM: number;
  netHits: number;
  /** max(0, sum(dice) − netHits) meters. */
  distanceM: number;
  from: Point;
  to: Point;
}

/** Direction d6 + Nd6 meters minus net hits → deviated impact point. */
export function computeScatter(p: ScatterParams, die: () => number = rollDie): ScatterResult {
  const directionDie = p.directionDie ?? die();
  const count = Math.max(1, Math.floor(p.scatterDice ?? 2));
  const distanceDice = p.distanceDice ?? Array.from({ length: count }, () => die());
  const rawDistanceM = distanceDice.reduce((a, b) => a + b, 0);
  const netHits = Math.max(0, p.netHits ?? 0);
  const distanceM = Math.max(0, rawDistanceM - netHits);
  const angleDeg = ((directionDie - 1) % 6) * 60;
  const rad = (angleDeg * Math.PI) / 180;
  const units = distanceM / (p.gridUnitM ?? 1);
  const to: Point = {
    x: p.x + Math.sin(rad) * units,
    y: p.y - Math.cos(rad) * units,
  };
  return { directionDie, angleDeg, distanceDice, rawDistanceM, netHits, distanceM, from: { x: p.x, y: p.y }, to };
}

// ---------------------------------------------------------------------------
// Per-key throttle (token.dragging relay, §11 "throttled")
// ---------------------------------------------------------------------------

export class PerKeyThrottle {
  private readonly last = new Map<string, number>();
  constructor(
    private readonly ms: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when `key` may fire now (leading edge; false inside the window). */
  allow(key: string): boolean {
    const t = this.now();
    const prev = this.last.get(key);
    if (prev !== undefined && t - prev < this.ms) return false;
    this.last.set(key, t);
    return true;
  }

  clear(key: string): void {
    this.last.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Attachments on disk (FR9.2 upload; §13 uploads)
// ---------------------------------------------------------------------------

/** Allow-listed upload mime types → stored extension (§13). */
export const ALLOWED_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
};

/**
 * The first bytes of each format we accept, so a declared mime has to be true.
 *
 * The client names the mime and the client can lie, which mattered little when
 * only the GM could upload and matters more now that a player can. This is not
 * a sanitiser — it does not make a malformed PNG safe — it only stops a file
 * being stored and later SERVED under a content type its bytes do not support,
 * which is the trick that turns a file store into an XSS surface.
 *
 * WebP is RIFF: bytes 0-3 `RIFF`, then a four-byte size, then `WEBP` at 8.
 */
const MIME_SIGNATURES: Record<string, ReadonlyArray<{ at: number; bytes: readonly number[] }>> = {
  'image/png': [{ at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  'image/jpeg': [{ at: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/gif': [{ at: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  'image/webp': [
    { at: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
};

/** How many leading bytes any signature needs. */
const SNIFF_BYTES = 12;

/** Do these leading bytes match what `mime` claims to be? */
export function bytesMatchMime(mime: string, head: Buffer): boolean {
  const sigs = MIME_SIGNATURES[mime];
  // A type we have no signature for (pdf, audio) is not checked here — those
  // stay GM-only, and inventing a half-check would read as more safety than
  // it is.
  if (!sigs) return true;
  if (head.length < SNIFF_BYTES) return false;
  return sigs.every((sig) => sig.bytes.every((b, i) => head[sig.at + i] === b));
}

/**
 * A pass-through that fails the stream if the leading bytes contradict `mime`.
 *
 * Streaming rather than buffering because the file may be large and we do not
 * want it in memory; failing the transform aborts `pipeline`, so the partial
 * file is never completed and the route answers 415 instead of storing it.
 */
function sniffMime(mime: string): Transform {
  let head = Buffer.alloc(0);
  let decided = false;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (!decided) {
        head = Buffer.concat([head, chunk]);
        if (head.length >= SNIFF_BYTES) {
          decided = true;
          if (!bytesMatchMime(mime, head)) {
            done(
              httpError(
                415,
                'unsupported_media_type',
                `the file's contents are not ${mime}`,
              ),
            );
            return;
          }
        }
      }
      done(null, chunk);
    },
    flush(done) {
      // A file shorter than any signature never got checked above. Anything
      // that small is not an image we can use, so it is rejected rather than
      // waved through on a technicality.
      if (!decided && !bytesMatchMime(mime, head)) {
        done(httpError(415, 'unsupported_media_type', `the file's contents are not ${mime}`));
        return;
      }
      done();
    },
  });
}

export function filesDir(): string {
  return join(process.env.DATA_DIR ?? './data', 'files');
}

// ---------------------------------------------------------------------------
// Scene → roll modifiers (FR9.11): consumed by the rolls service
// ---------------------------------------------------------------------------

/**
 * Environmental modifiers of the campaign's ACTIVE scene, for injection into
 * roll pools (FR9.11 — provenance carries the scene note).
 *
 * This is the ONLY authority for the scene's contribution to a pool (LIVE-2):
 * `services/rolls.ts` calls it during its recompute, and a client that also
 * sent the scene as a situational chip has that chip dropped rather than
 * summed, so a dim-light −1 can never land in a receipt twice.
 */
export async function activeSceneModifiers(db: Db, campaignId: string): Promise<Modifier[]> {
  const rows = await db
    .select()
    .from(scenes)
    .where(and(eq(scenes.campaignId, campaignId), eq(scenes.state, 'active')))
    .limit(1);
  const row = rows[0];
  if (!row) return [];
  return environment(normalizeEnvironment(row.environment));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface SceneWriteInput {
  name?: string;
  grid?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  geometry?: SceneGeometry;
  tiles?: TileLayer;
  /** Floors above the ground one (FR9.22). Replaces the list wholesale. */
  levels?: SceneLevel[];
  fog?: FogState;
  mapAttachmentIds?: string[];
  notes?: string;
  state?: 'draft' | 'archived';
}

export interface TokenCreateInput {
  source: 'character' | 'combatant' | 'npc_template' | 'prop';
  sourceId?: string | null;
  name?: string;
  x?: number;
  y?: number;
  /** Which floor it stands on (FR9.22); 0 is the ground. */
  level?: number;
  size?: number;
  rotation?: number;
  artRef?: string | null;
  hidden?: boolean;
  barsVisibility?: 'gm' | 'owner' | 'public';
  aura?: { radiusM: number; color?: string; label?: string } | null;
}

export interface FogOpInput {
  op: 'reveal' | 'hide' | 'define';
  regionId?: string;
  region?: { id?: string; name: string; polygon: Point[] };
  shape?: Point[];
}

interface StatShape {
  attributes?: { bod?: number; wil?: number; rea?: number; int?: number };
}

function monitorsFrom(stats: StatShape | null | undefined) {
  const bod = stats?.attributes?.bod ?? 3;
  const wil = stats?.attributes?.wil ?? 3;
  return {
    physical: { max: 8 + Math.ceil(bod / 2), filled: 0 },
    stun: { max: 8 + Math.ceil(wil / 2), filled: 0 },
    overflow: { max: Math.max(1, bod), filled: 0 },
  };
}

export class ScenesService {
  constructor(private readonly db: Db) {}

  /**
   * The same service bound to a transaction handle — `svc.withDb(tx.db)`
   * inside a `Hub.atomic` block.
   *
   * Every method here reads and writes through one `Db`, so re-binding is all
   * it takes to put a whole scene operation (fog state + its event, a token
   * insert + `token.added`, staging a dozen combatants + `encounter.updated`)
   * inside one transaction. It also satisfies the deadlock rule structurally:
   * a transaction-bound copy has no route back to the outer handle, so no
   * query inside the block can accidentally take it.
   */
  withDb(db: Db): ScenesService {
    return new ScenesService(db);
  }

  // --- scenes --------------------------------------------------------------

  async sceneRow(sceneId: string): Promise<SceneRow> {
    const rows = await this.db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1);
    const row = rows[0];
    if (!row) throw httpError(404, 'not_found', 'unknown scene');
    return row;
  }

  async listScenes(campaignId: string, opts: { activeOnly: boolean }): Promise<Scene[]> {
    const where = opts.activeOnly
      ? and(eq(scenes.campaignId, campaignId), eq(scenes.state, 'active'))
      : eq(scenes.campaignId, campaignId);
    const rows = await this.db.select().from(scenes).where(where);
    return rows.map(serializeScene);
  }

  async createScene(campaignId: string, input: SceneWriteInput): Promise<Scene> {
    const grid = normalizeGrid(input.grid);
    const env = normalizeEnvironment(input.environment);
    const geometry = normalizeGeometry(input.geometry);
    const fog = normalizeFog(input.fog);
    const row = (
      await this.db
        .insert(scenes)
        .values({
          campaignId,
          name: input.name ?? 'Untitled scene',
          state: 'draft',
          grid,
          environment: env,
          geometry: geometryColumn(geometry, input.mapAttachmentIds ?? [], input.notes, input.tiles),
          fog,
        })
        .returning()
    )[0]!;
    return serializeScene(row);
  }

  /** Patch a scene; grid/environment merge, geometry/fog replace whole. */
  async updateScene(row: SceneRow, patch: SceneWriteInput): Promise<{ scene: Scene; changed: string[] }> {
    const current = serializeScene(row);
    const changed = Object.keys(patch);
    const grid = patch.grid !== undefined ? normalizeGrid({ ...current.grid, ...patch.grid }) : current.grid;
    const env =
      patch.environment !== undefined
        ? normalizeEnvironment({ ...current.environment, ...patch.environment })
        : current.environment;
    const geometry = patch.geometry !== undefined ? normalizeGeometry(patch.geometry) : current.geometry;
    const fog = patch.fog !== undefined ? normalizeFog(patch.fog) : current.fog;
    const mapAttachmentIds = patch.mapAttachmentIds ?? current.mapAttachmentIds;
    const notes = patch.notes !== undefined ? patch.notes : current.notes;
    const tiles = patch.tiles !== undefined ? patch.tiles : current.tiles;
    // Whole-list replacement, like geometry: a level patch carries every floor
    // it wants to keep. Merging by index would make "delete the top storey"
    // impossible to express.
    const levels = patch.levels !== undefined ? patch.levels : current.levels;
    const updated = (
      await this.db
        .update(scenes)
        .set({
          name: patch.name ?? row.name,
          state: patch.state ?? row.state,
          grid,
          environment: env,
          geometry: geometryColumn(geometry, mapAttachmentIds, notes, tiles, levels),
          fog,
        })
        .where(eq(scenes.id, row.id))
        .returning()
    )[0]!;
    return { scene: serializeScene(updated), changed };
  }

  async deleteScene(sceneId: string): Promise<void> {
    await this.db.delete(scenes).where(eq(scenes.id, sceneId));
  }

  /** One active scene per campaign (FR9.1): demote others, promote this one. */
  async activateScene(row: SceneRow): Promise<Scene> {
    await this.db
      .update(scenes)
      .set({ state: 'draft' })
      .where(and(eq(scenes.campaignId, row.campaignId), eq(scenes.state, 'active')));
    const updated = (
      await this.db.update(scenes).set({ state: 'active' }).where(eq(scenes.id, row.id)).returning()
    )[0]!;
    return serializeScene(updated);
  }

  /**
   * Role-filtered composed payload: scene + tokens + live drawings. Hidden
   * tokens and unrevealed fog geometry are excluded for non-GM viewers HERE,
   * at the query layer (Principle 4, FR9.7/9.13).
   */
  async composedScene(
    row: SceneRow,
    gm: boolean,
  ): Promise<{ scene: Scene; tokens: TokenDto[]; drawings: DrawingDto[] }> {
    const tokenRows = await this.db.select().from(tokens).where(eq(tokens.sceneId, row.id));
    const drawingRows = await this.db.select().from(drawings).where(eq(drawings.sceneId, row.id));
    const now = Date.now();
    const visibleTokens = tokenRows.filter((t) => gm || !t.hidden).map(serializeToken);
    const liveDrawings = drawingRows
      .filter((d) => !d.expiresAt || d.expiresAt.getTime() > now)
      .map(serializeDrawing);
    return { scene: sceneForViewer(serializeScene(row), gm), tokens: visibleTokens, drawings: liveDrawings };
  }

  // --- tokens --------------------------------------------------------------

  async tokenWithScene(tokenId: string): Promise<{ token: TokenRow; scene: SceneRow }> {
    const rows = await this.db
      .select({ token: tokens, scene: scenes })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(eq(tokens.id, tokenId))
      .limit(1);
    const row = rows[0];
    if (!row) throw httpError(404, 'not_found', 'unknown token');
    return row;
  }

  /** Create a token; name/art default from the character / NPC template (FR9.4). */
  async createToken(scene: SceneRow, input: TokenCreateInput): Promise<TokenDto> {
    let name = input.name;
    let artRef = input.artRef ?? null;
    if (input.source === 'character' && input.sourceId) {
      const c = (
        await this.db.select().from(characters).where(eq(characters.id, input.sourceId)).limit(1)
      )[0];
      if (!c) throw httpError(404, 'not_found', 'unknown character');
      name ??= c.name;
      if (!artRef) {
        const sheet = c.sheet as { identity?: { portraitId?: string | null } } | null;
        artRef = sheet?.identity?.portraitId ?? null;
      }
    } else if (input.source === 'npc_template' && input.sourceId) {
      const t = (
        await this.db.select().from(npcTemplates).where(eq(npcTemplates.id, input.sourceId)).limit(1)
      )[0];
      if (!t) throw httpError(404, 'not_found', 'unknown NPC template');
      name ??= t.name;
    }
    const row = (
      await this.db
        .insert(tokens)
        .values({
          sceneId: scene.id,
          source: input.source,
          sourceId: input.sourceId ?? null,
          name: name ?? 'Prop',
          x: input.x ?? 0,
          y: input.y ?? 0,
          // Which storey it lands on (FR9.22). Dropping this put every token
          // on the ground floor, so a GM placing a guard while looking at the
          // catwalk got one who was standing in the warehouse below — and,
          // since the canvas draws one floor at a time, invisible.
          level: input.level ?? 0,
          size: input.size ?? 1,
          rotation: input.rotation ?? 0,
          artRef,
          hidden: input.hidden ?? false,
          barsVisibility: input.barsVisibility ?? 'owner',
          aura: input.aura ?? null,
        })
        .returning()
    )[0]!;
    return serializeToken(row);
  }

  async patchToken(tokenId: string, patch: Partial<TokenCreateInput>): Promise<TokenRow> {
    const set: Record<string, unknown> = {};
    // `level` belongs in this list: the route already accepts it, and leaving
    // it out meant a token sent upstairs was written back unchanged — the
    // request succeeded, the response looked right, and the runner never moved.
    for (const key of ['name', 'x', 'y', 'level', 'size', 'rotation', 'artRef', 'hidden', 'barsVisibility', 'aura'] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    const row = (
      await this.db.update(tokens).set(set).where(eq(tokens.id, tokenId)).returning()
    )[0];
    if (!row) throw httpError(404, 'not_found', 'unknown token');
    return row;
  }

  /**
   * Repoint every token that stands for this character at a new portrait.
   *
   * `createToken` copies a character's `portraitId` into `artRef` ONCE, at
   * placement. Without this, a player who uploads a portrait mid-session sees
   * nothing change — not on a refresh, not ever — because the tokens already
   * on the map carry the old snapshot.
   *
   * A token whose art the GM has deliberately overridden is LEFT ALONE. That is
   * what `from` is for: only tokens still pointing at the previous portrait (or
   * at nothing) follow the character. A runner the GM disguised with a
   * different picture keeps the disguise, which is the whole reason per-token
   * art exists alongside the character's own.
   *
   * Returns the rows it changed so the caller can emit one event per token.
   */
  async retargetCharacterArt(
    characterId: string,
    from: string | null,
    to: string | null,
  ): Promise<TokenRow[]> {
    const mine = await this.db
      .select()
      .from(tokens)
      .where(and(eq(tokens.source, 'character'), eq(tokens.sourceId, characterId)));
    const changed: TokenRow[] = [];
    for (const row of mine) {
      const follows = row.artRef === null || row.artRef === from;
      if (!follows || row.artRef === to) continue;
      const written = (
        await this.db.update(tokens).set({ artRef: to }).where(eq(tokens.id, row.id)).returning()
      )[0];
      if (written) changed.push(written);
    }
    return changed;
  }

  async deleteToken(tokenId: string): Promise<void> {
    await this.db.delete(tokens).where(eq(tokens.id, tokenId));
  }

  /** FR9.5: GM moves anything; a player only their own character's token. */
  async canControlToken(auth: { role: string; userId: string }, token: TokenRow): Promise<boolean> {
    if (auth.role === 'gm') return true;
    if (auth.role !== 'player') return false;
    if (token.source !== 'character' || !token.sourceId) return false;
    const rows = await this.db
      .select({ owner: characters.ownerUserId })
      .from(characters)
      .where(eq(characters.id, token.sourceId))
      .limit(1);
    return rows[0]?.owner === auth.userId;
  }

  // --- fog (FR9.13/9.14) ---------------------------------------------------

  async applyFogOp(scene: SceneRow, op: FogOpInput): Promise<{ fog: FogState; region?: FogRegion }> {
    const fog = normalizeFog(scene.fog);
    let region: FogRegion | undefined;
    if (op.op === 'define') {
      if (!op.region) throw httpError(400, 'bad_request', "op 'define' requires a region");
      region = { id: op.region.id ?? randomUUID(), name: op.region.name, polygon: op.region.polygon };
      fog.regions = [...fog.regions.filter((r) => r.id !== region!.id), region];
    } else if (op.op === 'reveal') {
      if (!op.regionId && !op.shape) {
        throw httpError(400, 'bad_request', "op 'reveal' needs a regionId or a shape");
      }
      if (op.regionId) {
        region = fog.regions.find((r) => r.id === op.regionId);
        if (!region) throw httpError(404, 'region_not_found', 'unknown fog region');
        if (!fog.revealed.includes(op.regionId)) fog.revealed = [...fog.revealed, op.regionId];
      }
      if (op.shape) fog.revealedShapes = [...fog.revealedShapes, op.shape];
    } else {
      // hide: one named region, or (no regionId) reset everything
      if (op.regionId) {
        fog.revealed = fog.revealed.filter((id) => id !== op.regionId);
      } else {
        fog.revealed = [];
        fog.revealedShapes = [];
      }
    }
    await this.db.update(scenes).set({ fog }).where(eq(scenes.id, scene.id));
    return region ? { fog, region } : { fog };
  }

  // --- drawings / AoE templates (FR9.12, FR9.15) ---------------------------

  async createDrawing(
    sceneId: string,
    input: { kind: 'sketch' | 'template'; geometry: Record<string, unknown>; createdBy: string; expiresInSec?: number },
  ): Promise<DrawingDto> {
    const row = (
      await this.db
        .insert(drawings)
        .values({
          sceneId,
          kind: input.kind,
          geometry: input.geometry,
          createdBy: input.createdBy,
          expiresAt: input.expiresInSec ? new Date(Date.now() + input.expiresInSec * 1000) : null,
        })
        .returning()
    )[0]!;
    return serializeDrawing(row);
  }

  async drawingRow(id: string): Promise<DrawingRow> {
    const rows = await this.db.select().from(drawings).where(eq(drawings.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw httpError(404, 'not_found', 'unknown drawing');
    return row;
  }

  /** Edit template params (radius, position — FR9.12 "editable"). */
  async updateDrawing(id: string, geometry: Record<string, unknown>): Promise<DrawingDto> {
    const row = (
      await this.db.update(drawings).set({ geometry }).where(eq(drawings.id, id)).returning()
    )[0];
    if (!row) throw httpError(404, 'not_found', 'unknown drawing');
    return serializeDrawing(row);
  }

  async deleteDrawing(id: string): Promise<void> {
    await this.db.delete(drawings).where(eq(drawings.id, id));
  }

  async clearDrawings(sceneId: string): Promise<string[]> {
    const rows = await this.db.delete(drawings).where(eq(drawings.sceneId, sceneId)).returning();
    return rows.map((r) => r.id);
  }

  // --- attachments (FR9.2; §13 uploads) ------------------------------------

  async saveAttachment(opts: {
    campaignId: string | null;
    kind: 'map' | 'token' | 'handout' | 'portrait' | 'asset' | 'audio';
    visibility: Visibility;
    mime: string;
    file: NodeJS.ReadableStream;
  }): Promise<AttachmentRow> {
    const ext = ALLOWED_MIME[opts.mime];
    if (!ext) throw httpError(415, 'unsupported_media_type', `mime '${opts.mime}' is not allowed`);
    const dir = filesDir();
    await mkdir(dir, { recursive: true });
    const fileName = `${randomUUID()}${ext}`;
    const dest = join(dir, fileName);
    // §13 asks for a sharp re-encode + metadata strip. `sharp` is a native
    // dependency and outside the budget, so the byte stream is stored verbatim.
    //
    // That trade used to rest on "uploads are GM-only on a LAN", and portraits
    // took it away: a player uploading their own token art is a second, less
    // trusted writer into the same store. The allowlist alone is not much of a
    // gate when the client picks the mime, so the bytes now have to AGREE with
    // it — see `sniffMime`. A declared PNG whose first eight bytes are not a
    // PNG signature is rejected and never lands on disk.
    await pipeline(opts.file, sniffMime(opts.mime), createWriteStream(dest));
    const size = (await stat(dest)).size;
    return (
      await this.db
        .insert(attachments)
        .values({
          campaignId: opts.campaignId,
          kind: opts.kind,
          path: fileName,
          mime: opts.mime,
          size,
          visibility: opts.visibility,
        })
        .returning()
    )[0]!;
  }

  async attachment(id: string): Promise<AttachmentRow | null> {
    const rows = await this.db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    return rows[0] ?? null;
  }

  attachmentPath(row: AttachmentRow): string {
    return join(filesDir(), row.path);
  }

  /**
   * §13: files served behind auth + visibility — a GM-only map must 404 for
   * players (no existence oracle). `gm_owner` degrades to gm-only: the
   * attachments table has no owner column (INTEGRATION).
   */
  canSeeAttachment(
    auth: { role: string; campaignId: string | null },
    row: AttachmentRow,
  ): boolean {
    if (row.campaignId && auth.campaignId !== row.campaignId) return false;
    if (auth.role === 'gm') return true;
    return row.visibility === 'public';
  }

  // --- encounter staging (FR9.10) ------------------------------------------

  /**
   * Create combatants from the scene's character/NPC tokens (props skipped;
   * hidden tokens become gm-visibility combatants). Coordination with the
   * encounters domain is via db rows only.
   */
  async stageEncounter(
    scene: SceneRow,
    opts: { name?: string; encounterId?: string },
  ): Promise<{ encounterId: string; createdEncounter: boolean; combatantIds: string[] }> {
    const tokenRows = await this.db.select().from(tokens).where(eq(tokens.sceneId, scene.id));
    let stageable = tokenRows.filter((t) => t.source === 'character' || t.source === 'npc_template');

    let encounterId = opts.encounterId;
    let createdEncounter = false;
    if (encounterId) {
      const enc = (
        await this.db.select().from(encounters).where(eq(encounters.id, encounterId)).limit(1)
      )[0];
      if (!enc || enc.campaignId !== scene.campaignId) {
        throw httpError(404, 'not_found', 'unknown encounter');
      }
      if (!enc.sceneId) {
        await this.db.update(encounters).set({ sceneId: scene.id }).where(eq(encounters.id, encounterId));
      }
      const existing = await this.db
        .select({ tokenId: combatants.tokenId })
        .from(combatants)
        .where(eq(combatants.encounterId, encounterId));
      const linked = new Set(existing.map((e) => e.tokenId).filter((id): id is string => id != null));
      stageable = stageable.filter((t) => !linked.has(t.id));
    } else {
      const enc = (
        await this.db
          .insert(encounters)
          .values({ campaignId: scene.campaignId, sceneId: scene.id, name: opts.name ?? scene.name, state: 'prep' })
          .returning()
      )[0]!;
      encounterId = enc.id;
      createdEncounter = true;
    }

    // Stats for character tokens (monitor sizes + initiative line).
    const charIds = stageable
      .filter((t) => t.source === 'character' && t.sourceId)
      .map((t) => t.sourceId!) ;
    const charRows = charIds.length
      ? await this.db.select().from(characters).where(inArray(characters.id, charIds))
      : [];
    const sheetById = new Map(charRows.map((c) => [c.id, c.sheet]));

    const combatantIds: string[] = [];
    for (const t of stageable) {
      const raw = t.sourceId ? sheetById.get(t.sourceId) : undefined;
      // FR9.10/FR4.2: derive the initiative line through the ENGINE, exactly as
      // `EncountersService.addCombatant` does — REA + INT + 1d6 is only the
      // unaugmented case, and reading the sheet raw silently dropped wired
      // reflexes, adept powers and every other `initiative.*` modifier (staged
      // PCs all came out at a flat REA+INT with a single die).
      const parsed = raw !== undefined && raw !== null ? SheetV1Schema.safeParse(raw) : null;
      const derived = parsed?.success ? deriveFor(parsed.data, 'physical') : null;
      const stats = (raw ?? undefined) as StatShape | undefined;
      const initBase = derived
        ? derived.base
        : (stats?.attributes?.rea ?? 0) + (stats?.attributes?.int ?? 0);
      const row = (
        await this.db
          .insert(combatants)
          .values({
            encounterId,
            tokenId: t.id,
            source: t.source === 'character' ? 'character' : 'npc_template',
            sourceId: t.sourceId,
            name: t.name,
            initBase,
            initKind: 'physical',
            monitors: derived ? derived.monitors : monitorsFrom(stats),
            visibility: t.hidden ? 'gm' : 'public',
            // `initDice` rides in the copilot JSONB (no column of its own); a
            // missing value would default to 1 die and lose the augmentation.
            copilot: { initDice: derived ? derived.dice : 1 },
          })
          .returning()
      )[0]!;
      combatantIds.push(row.id);
    }
    return { encounterId, createdEncounter, combatantIds };
  }

  async activeSceneModifiers(campaignId: string): Promise<Modifier[]> {
    return activeSceneModifiers(this.db, campaignId);
  }

  /**
   * Current table-display steering (FR9.21). There is no `display` table: the
   * newest `display.updated` event carries the whole state, so this reads it
   * back. Anything unset falls to the defaults a fresh TV boots with.
   */
  async displayState(campaignId: string): Promise<DisplayState> {
    const row = await latestEventOfType(this.db, campaignId, 'display.updated');
    return readDisplayState(row?.payload);
  }
}

/** GM steering of the table display (FR9.21). */
export interface DisplayState {
  /** Blank the big screen entirely (a between-scenes curtain). */
  blank: boolean;
  /** Show the initiative ribbon. Off during pure roleplay. */
  ribbon: boolean;
}

export const DEFAULT_DISPLAY_STATE: DisplayState = { blank: false, ribbon: true };

/**
 * Read a `display.updated` payload tolerantly. `ribbon` defaults to ON and
 * `blank` to OFF, so a malformed or absent event leaves the table looking at
 * the game rather than at a black screen.
 */
export function readDisplayState(payload: unknown): DisplayState {
  if (!isRecord(payload)) return DEFAULT_DISPLAY_STATE;
  return { blank: payload['blank'] === true, ribbon: payload['ribbon'] !== false };
}
