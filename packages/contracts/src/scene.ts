import { z } from 'zod';
import { PointSchema } from './common.js';

/**
 * How the grid is drawn. A pure PRESENTATION choice, per scene.
 *
 * `topdown` is the plan view: one cell, one square. `iso` is a 2:1 isometric
 * projection where standing things extrude upward, so a wall is a solid you
 * can see rather than a slightly different shade of floor — which is the whole
 * reason it exists.
 *
 * Nothing downstream of the renderer knows about this. Cells, tokens, walls,
 * fog and line of sight are all stored and computed in grid coordinates, so
 * switching projection changes what the table SEES and never what is true:
 * the same shot is legal, the same cover applies, the same tokens are where
 * they were. That containment is the design, not an implementation detail —
 * a projection that could change who can shoot whom would be a rules bug
 * wearing a camera's clothes.
 */
export const GridProjectionSchema = z.enum(['topdown', 'iso']).default('topdown');
export type GridProjection = z.infer<typeof GridProjectionSchema>;

/** Square grid config — SR5 measures in meters; default 1 m per square (FR9.1). */
export const GridSchema = z.object({
  unitM: z.number().positive().default(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  offset: PointSchema.default({ x: 0, y: 0 }),
  opacity: z.number().min(0).max(1).optional(),
  projection: GridProjectionSchema,
});
export type Grid = z.infer<typeof GridSchema>;

/**
 * Environment severity level per axis: 0 = clear/full light/no glare/calm,
 * 1..3 = worsening tiers. The rules engine maps levels to the standard
 * −1/−3/−6/−10 modifier tiers (FR9.11, §10.2). Labels are UI concerns.
 */
export const EnvLevelSchema = z.number().int().min(0).max(3);
export type EnvLevel = z.infer<typeof EnvLevelSchema>;

export const SceneEnvironmentSchema = z.object({
  light: EnvLevelSchema.default(0),
  visibility: EnvLevelSchema.default(0),
  glare: EnvLevelSchema.default(0),
  wind: EnvLevelSchema.default(0),
  note: z.string().optional(),
});
export type SceneEnvironment = z.infer<typeof SceneEnvironmentSchema>;

/**
 * How sight is shown at the table (FR9.16).
 *
 * `playersSeeOwnSight`: each player device darkens what their own runner
 * cannot see and draws no token outside that sightline. The GM's call per
 * scene, because it changes the feel of one: illuminating for a careful
 * infiltration, unwanted noise in a brawl in one room. Lives on the scene —
 * not in the GM's browser — so every player device hears it the moment it
 * flips, and still has it after a reload.
 */
export const SceneVisionSchema = z.object({
  playersSeeOwnSight: z.boolean().default(false),
});
export type SceneVision = z.infer<typeof SceneVisionSchema>;

export const WallSchema = z.object({
  id: z.string(),
  a: PointSchema,
  b: PointSchema,
  note: z.string().optional(),
});
export type Wall = z.infer<typeof WallSchema>;

export const DoorSchema = z.object({
  id: z.string(),
  a: PointSchema,
  b: PointSchema,
  open: z.boolean().default(false),
  note: z.string().optional(),
});
export type Door = z.infer<typeof DoorSchema>;

export const ZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  polygon: z.array(PointSchema).min(3),
  color: z.string().optional(),
  note: z.string().optional(),
});
export type Zone = z.infer<typeof ZoneSchema>;

/** Map pin linking to codex pages / handouts (FR9.3). */
export const PinSchema = z.object({
  id: z.string(),
  at: PointSchema,
  label: z.string().optional(),
  wikiPageId: z.string().optional(),
  attachmentId: z.string().optional(),
  visibility: z.enum(['public', 'gm']).default('gm'),
});
export type Pin = z.infer<typeof PinSchema>;

/**
 * A security camera (FR9.23): a fixed eye the GM mounts, and only the GM sees.
 *
 * A camera is the thing a runner most wants to know about and the thing a GM
 * most often forgets they put there. It is a point with a facing and a field
 * of view; the canvas draws the cone of cells it actually covers, cut by the
 * same walls and tiles a token's sightline is cut by, so "does the camera
 * cover the loading-bay door" is a glance and not a ruling.
 *
 * Never sent to a player socket — `sceneForViewer` strips the whole list
 * (Principle 4) — because a camera a player can see on the map is a camera
 * their character has already found. When the decker spots it on the host,
 * the GM tells them; that is a scene, not a payload.
 */
export const CameraSchema = z.object({
  id: z.string(),
  at: PointSchema,
  /** Degrees on the plan: 0 = east (+x), 90 = south (+y), clockwise. */
  facing: z.number().min(0).max(360).default(90),
  /** Field of view in degrees; 360 is a dome. */
  fov: z.number().min(5).max(360).default(90),
  /** How far it sees, in cells. */
  range: z.number().positive().max(200).default(12),
  /** Which floor it is mounted on (FR9.22). */
  level: z.number().int().min(0).default(0),
  /** Switched off — by the decker, by a bullet — draws as a dead eye, no cone. */
  active: z.boolean().default(true),
  label: z.string().max(60).optional(),
  note: z.string().optional(),
});
export type Camera = z.infer<typeof CameraSchema>;

/**
 * Tile painting (FR9.2's "assemble" half): a scene can be BUILT from a tileset
 * instead of, or on top of, an uploaded map image. Tiles are drawn from the
 * catalogue in `@safehouse/rules` — original artwork-free definitions rendered
 * procedurally, so nothing is shipped that we do not own (§14).
 *
 * The layer is SPARSE and keyed `"col,row"`: a 30x20 warehouse with a painted
 * floor is ~600 short strings, which is nothing beside the map images this
 * replaces, and an unpainted cell costs zero. Cells outside the grid are
 * ignored rather than rejected, so shrinking a scene never corrupts its paint.
 */
/**
 * The three things that can occupy one square at the same time.
 *
 * A single tile per cell cannot express a scene: a tree stands ON grass, an
 * oil stain lies ON asphalt, a chair sits ON a floor, a window is set INTO a
 * wall. Painting any of those over a one-tile cell would erase what it is
 * standing on, so the layer a tile belongs to is part of what the tile IS.
 *
 * Three, not four, even though the palette offers four tools: Interior and
 * Decorations both place things that stand on the ground, so they share the
 * `object` layer. That is a real constraint and the right one — a square holds
 * a chair or a potted plant, not both.
 */
export const TILE_LAYERS = ['ground', 'structure', 'object'] as const;
export type TileLayerName = (typeof TILE_LAYERS)[number];

/** `"col,row"` -> tile id within the layer's tileset. */
const CellMap = z.record(z.string(), z.string()).default({});

export const TileLayerSchema = z.object({
  /** Catalogue id the cell ids belong to (e.g. `docklands`). */
  tilesetId: z.string().min(1),
  /**
   * The original single-layer form, kept so scenes painted before layers
   * existed still open. READ AND MIGRATED, never written: the server sorts
   * these ids into the layer each tile belongs to on the way out
   * (`migrateTileLayer`), so a scene upgrades itself the first time it is
   * saved and this field drains to empty on its own.
   */
  cells: CellMap,
  /** Floors, roads, grass — what the square is made of. */
  ground: CellMap,
  /** Walls, windows, doors — the building. */
  structure: CellMap,
  /** Furniture and props standing on the ground. */
  object: CellMap,
});
export type TileLayer = z.infer<typeof TileLayerSchema>;

/**
 * One floor of a scene (FR9.22).
 *
 * A warehouse has a catwalk; an office block has six storeys and a stairwell.
 * Modelling those as separate scenes almost works and then does not: the party
 * splits, half of them are upstairs, and the GM needs both floors on one map
 * with tokens that can walk between them.
 *
 * Levels carry TILES and nothing else. Fog, geometry, tokens and the grid stay
 * scene-wide, because a building has one footprint and one set of dimensions —
 * a floor that could be a different size from the one below it would be a
 * different building. Tokens say which level they are ON (`Token.level`),
 * which is what lets one scene hold a firefight on two storeys.
 */
export const SceneLevelSchema = z.object({
  id: z.string().min(1),
  /** What the GM calls it: "Ground", "Catwalk", "Sub-basement". */
  name: z.string().min(1).max(60),
  tiles: TileLayerSchema.optional(),
});
export type SceneLevel = z.infer<typeof SceneLevelSchema>;

export const SceneGeometrySchema = z.object({
  walls: z.array(WallSchema).default([]),
  doors: z.array(DoorSchema).default([]),
  zones: z.array(ZoneSchema).default([]),
  pins: z.array(PinSchema).default([]),
  /**
   * Optional rather than defaulted, deliberately: every scene ever saved and
   * every fixture ever written spells geometry as the four lists above, and a
   * required fifth would make each of them a type error for a feature most
   * scenes never use. Read it as `geometry.cameras ?? []`.
   */
  cameras: z.array(CameraSchema).optional(),
});
export type SceneGeometry = z.infer<typeof SceneGeometrySchema>;

/** A named fog region for staged reveals ("east wing", "the lab") — FR9.14. */
export const FogRegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  polygon: z.array(PointSchema).min(3),
});
export type FogRegion = z.infer<typeof FogRegionSchema>;

/** Server-authoritative fog state per scene (FR9.13). */
export const FogStateSchema = z.object({
  regions: z.array(FogRegionSchema).default([]),
  /** Ids of revealed named regions. */
  revealed: z.array(z.string()).default([]),
  /** Freeform revealed polygons from brush/polygon painting. */
  revealedShapes: z.array(z.array(PointSchema)).default([]),
});
export type FogState = z.infer<typeof FogStateSchema>;

export const SceneStateSchema = z.enum(['draft', 'active', 'archived']);
export type SceneState = z.infer<typeof SceneStateSchema>;

/** A scene entity (DESIGN.md §9.2 `scenes`). */
export const SceneSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  name: z.string().min(1),
  state: SceneStateSchema.default('draft'),
  grid: GridSchema,
  environment: SceneEnvironmentSchema.default({ light: 0, visibility: 0, glare: 0, wind: 0 }),
  vision: SceneVisionSchema.default({ playersSeeOwnSight: false }),
  geometry: SceneGeometrySchema.default({ walls: [], doors: [], zones: [], pins: [] }),
  /**
   * Painted tiles for the GROUND floor.
   *
   * Kept as the level-0 slot rather than folded into `levels` so every scene
   * ever painted still opens, and so the overwhelmingly common case — one
   * floor — costs nothing extra to store or reason about. `sceneLevels()`
   * presents both as one list.
   */
  tiles: TileLayerSchema.optional(),
  /**
   * Floors ABOVE and below the ground one, in display order (FR9.22).
   *
   * Empty for a flat scene, which is most of them. Levels carry tiles only:
   * fog, geometry and the grid stay scene-wide, because a building has one
   * footprint, and a storey that could be a different size from the one below
   * would be a different building.
   */
  levels: z.array(SceneLevelSchema).default([]),
  fog: FogStateSchema.default({ regions: [], revealed: [], revealedShapes: [] }),
  /** Background map image attachment ids, draw order first→last. */
  mapAttachmentIds: z.array(z.string()).default([]),
  notes: z.string().optional(),
  audioRef: z.string().optional(),
});
export type Scene = z.infer<typeof SceneSchema>;
export type SceneInput = z.input<typeof SceneSchema>;
