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
 *
 * `sight`: SIGHTLINES, the scene's dynamic lighting (P6, Roll20's). With it
 * `'on'`, the table sees what the party's runners see, and no more: every
 * runner's eyes are pooled, walls and closed doors stop them, darkness stops
 * them unless their vision modes see through it (strict SR5), and what they
 * see is LIVE on every phone and the TV at once. What they have seen and no
 * longer see stays as EXPLORED memory, the map drawn dimmed with nobody on
 * it. Everything else is hidden, whether or not the GM's fog switch is on
 * (`sceneFogOn`). The server works the sight out and keeps it in the fog
 * (`FogState.sight`); nothing is computed on a phone.
 *
 * There is no per-phone version of this and no confirm step (the GM,
 * 2026-09-27): sight is pooled, and it unmasks the map automatically. The
 * older `playersSeeOwnSight` switch above is a separate thing and stays as it
 * is: it only dims a player's screen outside their own runner's sightline.
 *
 * Optional rather than defaulted, and absent reads as `'off'`: every scene
 * saved before sightlines existed, and every fixture that spells a scene's
 * vision as `{ playersSeeOwnSight }`, is then already a scene without them,
 * and still parses to exactly what it did (`sightlinesOn`).
 */
export const SceneVisionSchema = z.object({
  playersSeeOwnSight: z.boolean().default(false),
  sight: z.enum(['off', 'on']).optional(),
});
export type SceneVision = z.infer<typeof SceneVisionSchema>;

/** Whether a scene's sightlines are on (`SceneVision.sight`); absent is off. */
export function sightlinesOn(vision: Partial<Pick<SceneVision, 'sight'>> | undefined): boolean {
  return vision?.sight === 'on';
}

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
  /**
   * A locked door stays shut to players (FR9.24): they may open and close any
   * door that is not, from their own screen, without asking; the GM locks and
   * unlocks. Players are not told which doors are locked — they find out the
   * way a runner does, by trying the handle.
   */
  locked: z.boolean().default(false),
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

/** `#rrggbb` — a light's colour. */
export const LightColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * A light the GM placed (docs/VISION.md §4.1): a work lamp the tiles do not
 * have, a flare, a drone's spotlight, a room's overheads as one fixture.
 * Tiles that glow are lights already (`tileLight` in rules); these are the
 * rest. Every renderer and the light map read the same fields.
 *
 * Not secret: a light is something the runners can see, so players receive
 * the list (the effect is on their screen whether or not the fixture is).
 */
export const SceneLightSchema = z.object({
  id: z.string(),
  /** Where the lamp stands, in grid units (cell centres at .5). */
  at: PointSchema,
  /** Which floor it is on (FR9.22). */
  level: z.number().int().min(0).default(0),
  /** How far it reaches, in metres; the grid's `unitM` turns it into squares. */
  radiusM: z.number().positive().max(200).default(6),
  /**
   * How many light rows it lifts at its core (§4.1): 1 a soft glow, 2 a
   * proper lamp, 3 a floodlight. Its outer half lifts one row fewer (never
   * less than one).
   */
  rows: z.number().int().min(1).max(3).default(2),
  color: LightColorSchema.default('#ffd9a0'),
  /** How high the lamp hangs, in storeys: 0 on the floor, ~0.9 at the ceiling. Renderers read it for shadow length. */
  height: z.number().min(0).max(3).default(0.8),
  /** A spotlight's aim, cameras' convention: degrees, 0 = east, 90 = south. Absent: all round. */
  facing: z.number().min(0).max(360).optional(),
  /** A spotlight's spread in degrees; absent or 360 is all round. */
  fov: z.number().min(5).max(360).optional(),
  /** Switched off — the decker killed the power — it lights nothing. */
  on: z.boolean().default(true),
  label: z.string().max(60).optional(),
});
export type SceneLight = z.infer<typeof SceneLightSchema>;

/**
 * A GM note on the map (FR9.25): a box of text pinned to a point, for the GM
 * alone — how to run the room, what the guard says, where the loot is. Never
 * sent to a player socket (`sceneForViewer`). A pin is a marker with a label
 * that can be shown to the table; a note is prose that never will be.
 */
export const NoteSchema = z.object({
  id: z.string(),
  at: PointSchema,
  text: z.string().max(2000),
  /** Width of the box in cells; the text wraps inside it. */
  width: z.number().min(1).max(20).default(4),
  color: z.string().optional(),
});
export type Note = z.infer<typeof NoteSchema>;

/**
 * A layer of tokens the GM shows or hides as one (FR9.26): the ambush party,
 * the second wave, the crowd that is only there if the players go in loud.
 * Membership lives here rather than on the token so a layer is one thing to
 * edit and one thing to switch. Nothing to do with floors (FR9.22): a layer
 * cuts across the whole scene, whatever storey each token stands on.
 *
 * A hidden layer's tokens are stripped from player payloads exactly as a
 * hidden token is (Principle 4); showing the layer arrives on their screens
 * as those tokens appearing.
 */
export const SceneLayerSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  hidden: z.boolean().default(false),
  tokenIds: z.array(z.string()).default([]),
});
export type SceneLayer = z.infer<typeof SceneLayerSchema>;

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

/**
 * The state of a door PAINTED as a tile (FR9.24). A traced door carries its
 * own `open`; a painted one is a cell holding a door tile, and this is where
 * that cell's open/locked lives — keyed by cell, beside the tiles, so it
 * travels with the floor it belongs to.
 */
export const TileDoorStateSchema = z.object({
  open: z.boolean().default(false),
  locked: z.boolean().default(false),
});
export type TileDoorState = z.infer<typeof TileDoorStateSchema>;

/**
 * A wall that is not made of squares: a straight run at any angle, or a
 * curve, from `a` to `b` in grid units (squares from the top-left corner).
 * `bulge` is the curve's sagitta — how far the middle of the wall stands off
 * the straight line from `a` to `b`, in squares, to the LEFT of a→b as the
 * grid is drawn (y down); negative bulges right, 0 is straight.
 *
 * Painted walls are cells and can only run along the grid or at 45°; the
 * ballroom's bowed south wall and a tower's octagon are not either. An arc is
 * drawn as a wall in the floor's own tileset (`tile`, a wall slot or id) and
 * stops sight and gives cover in every square it passes through, exactly as
 * a painted wall in that square would. A door or window painted in a square
 * the arc crosses opens it there.
 */
export const ArcWallSchema = z.object({
  id: z.string().min(1).max(64),
  a: PointSchema,
  b: PointSchema,
  bulge: z.number().min(-500).max(500).default(0),
  tile: z.string().min(1).max(64),
});
export type ArcWall = z.infer<typeof ArcWallSchema>;

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
  /** Open/locked state of painted doors, keyed by cell. Absent means all shut and unlocked. */
  doors: z.record(z.string(), TileDoorStateSchema).optional(),
  /** Walls at any angle and curved walls (`ArcWallSchema`). */
  arcs: z.array(ArcWallSchema).max(500).optional(),
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
  /**
   * GM notes on the map (FR9.25) — optional for the same reason cameras are.
   *
   * `gmNotes`, not `notes`: the server keeps a scene's geometry in one JSONB
   * envelope beside the scene's free-text `notes` string, and a key shared
   * between the two made the whole geometry fail to parse — and an empty
   * geometry is what the next write then saved.
   */
  gmNotes: z.array(NoteSchema).optional(),
  /** Lights the GM placed (`SceneLightSchema`) — optional like cameras; read it as `geometry.lights ?? []`. */
  lights: z.array(SceneLightSchema).optional(),
});
export type SceneGeometry = z.infer<typeof SceneGeometrySchema>;

/** A named fog region for staged reveals ("east wing", "the lab") — FR9.14. */
export const FogRegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  polygon: z.array(PointSchema).min(3),
});
export type FogRegion = z.infer<typeof FogRegionSchema>;

/**
 * What the GM can do to a scene's fog (FR9.13/9.14), over REST and over the
 * socket alike.
 *
 * - `define` draws a named region (a REVEAL WINDOW: ground the GM may later
 *   open to the table), `remove` takes one off the scene.
 * - `reveal` opens a named region or paints a freeform shape open, in one of
 *   the two fashions `FogRevealAsSchema` names (live, the default, or as
 *   explored); `hide` closes one region again, whichever way it was
 *   revealed, or (with no region named) every reveal of both fashions at
 *   once.
 * - `enable` and `disable` are the scene's fog switch (`FogState.enabled`).
 *   Turning fog off keeps every region and every reveal, so a GM can prepare
 *   a scene's fog while the table still sees the whole map, and turning it
 *   back on picks up exactly where it was left.
 * - `forget` wipes the party's memory of the map (`FogSight` explored): of one
 *   floor when the op names a `level`, of every floor when it does not. It is
 *   the GM's alone, and the only way a square ever leaves the memory: the
 *   sight pass only ever adds to it. What the runners can see RIGHT NOW is
 *   remembered again at once (sightlines unmask automatically), so forgetting
 *   takes away the rooms they have left, never the one they stand in.
 */
export const FogOpSchema = z.enum(['reveal', 'hide', 'define', 'remove', 'enable', 'disable', 'forget']);
export type FogOp = z.infer<typeof FogOpSchema>;

/**
 * The two fashions a GM reveals ground in (P6; the GM, 2026-09-27), the
 * `as` of a `reveal`:
 *
 * - `live`: the table sees the map there in full, and everyone standing on
 *   it, moving. The only fashion there was before explored reveals, so a
 *   reveal that does not say is live.
 * - `explored`: the table sees the map there DIMMED, as remembered, with its
 *   doors and public pins, but nobody on it: no token, no token's light, no
 *   move. "You have been here before": the ground the runners walked through
 *   last session, or the floor plan the fixer sold them.
 *
 * A region is in one fashion at a time. Revealing it in the other moves it
 * across (`revealed` and `exploredRegionIds` on `FogState`), so a room the
 * party has left can be dropped from live to remembered with one tap, and
 * the guards in it leave the table's screens as it goes.
 */
export const FogRevealAsSchema = z.enum(['live', 'explored']);
export type FogRevealAs = z.infer<typeof FogRevealAsSchema>;

/**
 * A set of squares on one floor, as a base64 bitset: square (col, row) is bit
 * `row * cols + col`, counting from the least significant bit of the first
 * byte, with the grid's `cols` and `rows` said beside it (`FogSightSchema`).
 * Trailing zero bytes may be left off, so a floor nobody has seen is `''`.
 * The rules package reads and writes these (`encodeCellBits`,
 * `decodeCellBits` in @safehouse/rules).
 *
 * A bitset rather than a list of `"col,row"` keys because this crosses the
 * wire after every committed move: a 60x40 map is 300 bytes as bits, and a
 * phone decodes it without parsing a thing.
 */
export const CellBitsSchema = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);

/**
 * What the party's eyes have done to one floor (sightlines, P6).
 *
 * - `live`: the squares some runner on this floor can see RIGHT NOW. A cache
 *   the server's sight pass rewrites after every committed change (a move, a
 *   door, a light), stored so a plain read can decide which tokens a player
 *   may be sent without working sight out again. Only that pass writes it,
 *   and only while the scene's sightlines are on; it is emptied when they go
 *   off.
 * - `explored`: every square the party has EVER seen here, the table's
 *   memory of the floor. The sight pass ORs `live` into it and never takes a
 *   square out; only the GM forgets.
 */
export const FogSightLevelSchema = z.object({
  live: CellBitsSchema.default(''),
  explored: CellBitsSchema.default(''),
});
export type FogSightLevel = z.infer<typeof FogSightLevelSchema>;

/**
 * The most squares a side the party's sight is kept for: a sight record says
 * how big a grid its bitsets were written for, and whatever reads one
 * allocates that many bits (`decodeCellBits`). Unbounded, a scene file
 * crafted to say `cols: 1e9, rows: 1e9` made the first read of it try for
 * about 10^17 bytes, and every read of that scene after it threw. 1024 is
 * far past any map a table plays (the painted-floor budget is a 240x240
 * scene), and a bitset that big is still only 128 KB. The server's sight
 * pass keeps sight for the first 1024 squares each way of a grid bigger than
 * that; ground past it is never seen.
 */
export const FOG_SIGHT_MAX_SIDE = 1024;

/**
 * The party's sight and memory, per floor (`FogSightLevelSchema`), keyed by
 * the floor's index as a decimal string (`"0"` is the ground, as
 * `Token.level` counts), at most two digits: a scene has a dozen floors at
 * most, and a key per floor is a bitset per floor, so a record with a
 * million made-up floors in it is refused rather than decoded. `cols` and
 * `rows` are the grid the bitsets were written for (at most
 * `FOG_SIGHT_MAX_SIDE` each), so a scene resized since is read square by
 * square and never shifted: a bit past the edge of the grid is simply not
 * there.
 */
export const FogSightSchema = z.object({
  cols: z.number().int().positive().max(FOG_SIGHT_MAX_SIDE),
  rows: z.number().int().positive().max(FOG_SIGHT_MAX_SIDE),
  levels: z.record(z.string().regex(/^(0|[1-9][0-9]?)$/), FogSightLevelSchema).default({}),
});
export type FogSight = z.infer<typeof FogSightSchema>;

/**
 * Server-authoritative fog state per scene (FR9.13).
 *
 * Every square of every floor is in one of THREE states (`cellState` in
 * @safehouse/rules works it out; P6):
 * - LIVE: the table sees the map there, and everyone standing on it, moving.
 *   The fog is off, or the GM revealed the ground live (`revealed`,
 *   `revealedShapes`), or a runner can see it (`sight` live).
 * - EXPLORED: the map is shown dimmed, as remembered, with nobody on it. The
 *   GM revealed it as explored (`exploredRegionIds`, `exploredShapes`), or
 *   the party has seen it before (`sight` explored).
 * - HIDDEN: everything else, while the fog is on.
 *
 * The GM's reveals (both fashions) cover the same ground on every floor, as
 * the regions always have; only the party's sight is per floor, because a
 * runner on the ground floor has not seen the roof.
 */
export const FogStateSchema = z.object({
  regions: z.array(FogRegionSchema).default([]),
  /** Ids of named regions revealed LIVE. */
  revealed: z.array(z.string()).default([]),
  /** Freeform polygons revealed LIVE, from brush/polygon painting. */
  revealedShapes: z.array(z.array(PointSchema)).default([]),
  /**
   * Ids of named regions the GM revealed AS EXPLORED: ground the table is
   * shown as remembered (the map dimmed, its doors and public pins) with
   * nobody on it, no token, no token's light and no moves. The other fashion
   * of reveal is `revealed`, which opens a region live. A region is meant to
   * be in one list or neither; should both ever name it, live wins.
   *
   * Optional, like `enabled`: every scene saved before explored reveals
   * existed has none, and every fixture spells a fog as the three lists
   * above. Read it as `exploredRegionIds ?? []`.
   */
  exploredRegionIds: z.array(z.string()).optional(),
  /** Freeform polygons revealed AS EXPLORED, as `revealedShapes` are live. Read it as `exploredShapes ?? []`. */
  exploredShapes: z.array(z.array(PointSchema)).optional(),
  /**
   * The party's sight and memory, per floor (`FogSightSchema`): written by
   * the server's sight pass on a scene with sightlines on (`SceneVision.sight`)
   * and read by everyone, the same pooled copy on every phone and the TV.
   * Absent on a scene whose party has never looked, which is every scene
   * without sightlines.
   */
  sight: FogSightSchema.optional(),
  /**
   * The GM's fog switch for this scene, and the one fog field that is STORED
   * as a decision rather than derived: true fogs the scene (the whole map is
   * covered except what is revealed), false leaves it open (the table sees
   * the whole map, and any regions and reveals are kept for later).
   *
   * Optional, because every scene saved before the switch existed has no
   * word on it, and those scenes must behave exactly as they always have:
   * absent means "fogged once there is anything to reveal", the old rule
   * (`fogOn`). The switch is set only when the GM flips it (the `enable` and
   * `disable` ops); nothing else writes it.
   */
  enabled: z.boolean().optional(),
  /**
   * Whether the scene is fogged at all, as `sceneFogOn` answers it for the
   * stored scene: the fog switch (`fogOn`), or the scene's sightlines. Set
   * on a non-GM viewer's copy only (`sceneForViewer`), which
   * carries only the REVEALED regions and never the switch — so a scene
   * fogged with nothing revealed yet, or reset, would otherwise arrive as
   * `regions: []` and read as a scene with no fog, the whole map open. Never
   * stored: the GM's copy says it with `enabled` and `regions` themselves.
   * Absent reads as "not said", and the rest of the state decides (`fogOn`).
   */
  active: z.boolean().optional(),
});
export type FogState = z.infer<typeof FogStateSchema>;

/**
 * Whether a scene's fog is ON: is the map covered, apart from what has been
 * revealed? The one answer every part of the app asks for — the server when
 * it decides what a player may be sent, the map when it decides whether to
 * draw the cover, the TV when it folds fog events — so it lives here, beside
 * the state it reads, and nobody re-derives it with a rule of their own.
 *
 * In order:
 * - `active`, when it is said. It is on a non-GM copy (the server's own
 *   answer to this question, worked out from state that copy does not carry)
 *   and on the TV's folded copy (the latest fog event's word). Either way it
 *   is the answer, in BOTH directions: a copy that says `active: false` is an
 *   open scene even if it still carries revealed regions, which is exactly
 *   what a scene the GM has switched off looks like on a player's wire.
 * - `enabled`, the GM's switch, when it has ever been flipped.
 * - Otherwise the rule every scene had before the switch existed: fogged as
 *   soon as there is a region or a revealed shape, open until then. A shape
 *   revealed as explored counts as much as one revealed live: it is a
 *   reveal, and a reveal only means anything on a fogged scene.
 */
export function fogOn(
  fog: Pick<FogState, 'regions' | 'revealedShapes'> & Partial<Pick<FogState, 'enabled' | 'active' | 'exploredShapes'>>,
): boolean {
  if (fog.active !== undefined) return fog.active;
  if (fog.enabled !== undefined) return fog.enabled;
  return fog.regions.length > 0 || fog.revealedShapes.length > 0 || (fog.exploredShapes?.length ?? 0) > 0;
}

/**
 * Whether a SCENE is fogged: its fog switch (`fogOn`), or its sightlines
 * (`sightlinesOn`), because sightlines on means everything the party cannot
 * see and has not seen is hidden, whatever the switch says (the GM,
 * 2026-09-27). This is the answer the server puts on a non-GM copy as
 * `active`, so on a copy that carries `active` it is `active`, in both
 * directions, exactly as `fogOn` reads it.
 *
 * On a scene without sightlines, which is every scene saved before them,
 * this is `fogOn` and nothing else.
 */
export function sceneFogOn(scene: {
  fog: Parameters<typeof fogOn>[0];
  vision?: Partial<Pick<SceneVision, 'sight'>> | undefined;
}): boolean {
  if (scene.fog.active !== undefined) return scene.fog.active;
  return sightlinesOn(scene.vision) || fogOn(scene.fog);
}

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
  /** Token layers (FR9.26). Optional: most scenes have none. */
  tokenLayers: z.array(SceneLayerSchema).optional(),
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
