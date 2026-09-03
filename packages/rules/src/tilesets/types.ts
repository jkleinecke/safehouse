/**
 * Tilesets for building a scene's floor from parts (FR9.2, the "assemble"
 * half) instead of uploading a map image.
 *
 * DEFINITIONS, NOT ARTWORK. Each tile carries a small palette and a pattern
 * name that the client renders procedurally. Nothing is shipped that we do not
 * own (§14), the whole catalogue is a few kilobytes of JSON rather than an
 * image pack, and a tile stays crisp at any zoom because it is drawn, not
 * scaled.
 *
 * Tiles also carry MEANING, not just looks: `blocksMovement` and `blocksSight`
 * let a painted wall behave like a drawn one, so the ruler (FR9.8) and any
 * future vision work (FR9.16) read the painted floor rather than needing the
 * GM to trace geometry over their own tiles a second time.
 */

/**
 * How the client draws a tile. Deliberately a small closed set — and a VALUE,
 * not just a type, because the renderer lives in another package.
 *
 * The catalogue here and the procedural painter in `apps/web` are two halves of
 * one contract with no compile-time link between them: a pattern added here
 * that the painter does not handle falls through to a flat base colour, which
 * looks like a colour choice rather than a bug. Shipping the list as data lets
 * each side assert against the same array — the catalogue's patterns are all
 * members (tested here), and the painter handles every member (tested there) —
 * so the drift is caught by a red test on whichever side forgot.
 *
 * `TilePattern` is derived FROM the array so the two cannot disagree.
 */
export const TILE_PATTERNS = [
  'solid',
  'planks',
  'concrete',
  'grating',
  'tile',
  'carpet',
  'gravel',
  'water',
  'brick',
  'panel',
  'rubble',
  'hatch',
] as const;

export type TilePattern = (typeof TILE_PATTERNS)[number];

/** Palette grouping. Same value-first treatment, same reason. */
export const TILE_KINDS = ['floor', 'wall', 'door', 'feature'] as const;

export type TileKind = (typeof TILE_KINDS)[number];

/**
 * Which TOOL offers this tile, and by implication which layer it lands on.
 *
 * The four map onto three layers: Interior and Decoration both place things
 * standing on the ground, so they share it. Keeping them as separate tools
 * anyway is the point — "a chair" and "a fire hydrant" are the same kind of
 * object to the renderer and completely different questions to a GM building
 * a scene.
 */
export const TILE_CATEGORIES = ['ground', 'building', 'interior', 'decoration'] as const;

export type TileCategory = (typeof TILE_CATEGORIES)[number];

/** Which of the scene's three layers a category writes to. */
export const LAYER_FOR_CATEGORY: Readonly<Record<TileCategory, 'ground' | 'structure' | 'object'>> =
  {
    ground: 'ground',
    building: 'structure',
    interior: 'object',
    decoration: 'object',
  };

/**
 * Where a tile belongs, as data the placement scorer reads.
 *
 * This is what makes one click land the RIGHT tile. Without it the GM picks
 * from a grid of forty names every time; with it, clicking grass gives a tree
 * and clicking asphalt gives a drain, because the tile itself knows which it
 * wants to stand on.
 */
export interface TilePlacement {
  /**
   * Wants a wall at its back — a bench, a desk, a terminal. Scored, not
   * required: a desk in the middle of a room is a choice, not an error.
   */
  againstWall?: boolean;
  /**
   * Only legal INSIDE an existing wall. Windows and doors are holes in a
   * building, not free-standing objects, and offering one on open floor is
   * how a GM ends up with a door frame in the middle of a car park.
   */
  inWall?: boolean;
  /**
   * Ground tile ids this sits on. A tree wants soil, a hydrant wants
   * pavement, an oil stain wants road. Empty means "anywhere".
   */
  on?: readonly string[];
}

/**
 * How tall a tile stands, in grid cells. The single most load-bearing number
 * on a tile, because it pays twice.
 *
 * VISUALLY it is the isometric extrusion: `FLOOR` is a flat diamond, `WAIST`
 * comes up far enough to read as something you crouch behind, `FULL` is a
 * solid the eye cannot cross. A wall that *looks* waist-high and *behaves*
 * like a full wall is the single most confusing thing a tactical map can do,
 * and height is what stops the art and the rules from disagreeing.
 *
 * MECHANICALLY it is the cover model: waist-high grants cover but sight passes
 * over it, full height stops sight outright unless the tile says otherwise
 * (`blocksSight: false` — glass, a chain-link fence, a mesh screen).
 */
export const TILE_HEIGHTS = { FLOOR: 0, WAIST: 0.5, FULL: 1 } as const;

export type TileHeight = (typeof TILE_HEIGHTS)[keyof typeof TILE_HEIGHTS];

/**
 * How much of its cell a tile actually occupies.
 *
 * `fill` is the whole square — floors, and chunky things like a pallet stack
 * or a parked car, which genuinely take up their cell.
 *
 * `wall` is a THIN slab. A wall that fills its cell makes every room read as a
 * ring of fat blocks with the interior shrunk to match, which is both ugly and
 * misleading about how much floor a room has. Real walls are thin, so a wall
 * tile draws as a slab a third of a cell thick, sitting on floor that shows
 * around it, and ORIENTS ITSELF from its neighbours: a horizontal run draws a
 * continuous horizontal wall, corners turn, T-junctions and crosses join. The
 * GM paints cells and gets architecture without saying which way anything
 * faces.
 *
 * MECHANICALLY both are identical — a wall cell blocks the whole cell for
 * sight and movement whatever fraction of it is painted. That is deliberate:
 * the leftover slivers are not somewhere a runner stands, and cell-based
 * blocking is what keeps line of sight cheap and the ruler honest.
 */
/**
 * `post` is a narrow column in the middle of the cell — a fire hydrant, a
 * bollard, a valve stack. `canopy` is a post carrying a wide crown, which is
 * what makes a tree read as a tree rather than a green box. `round` is a
 * squat cylinder: a barrel, a fountain basin, a planter.
 *
 * These exist because a catalogue where everything is a cuboid tells the GM
 * nothing at a glance. Colour alone does not separate a hydrant from a
 * refuse pile at table zoom; a silhouette does. They are still DRAWN, not
 * blitted, so the catalogue is still kilobytes and still ours (§14).
 */
export const TILE_FOOTPRINTS = ['fill', 'wall', 'post', 'canopy', 'round'] as const;

export type TileFootprint = (typeof TILE_FOOTPRINTS)[number];

/**
 * Footprints that occupy only part of their cell and therefore need floor
 * drawn underneath them — otherwise every one is a hole in the map.
 */
export const PARTIAL_FOOTPRINTS: readonly TileFootprint[] = ['wall', 'post', 'canopy', 'round'];

/**
 * Wall slab thickness, as a fraction of a cell. A third reads as a wall at
 * table zoom without the two remaining slivers of floor looking like a
 * mistake; thinner starts to disappear under the grid lines.
 */
export const WALL_THICKNESS = 1 / 3;

export interface Tile {
  id: string;
  name: string;
  /** Grouping for the palette UI. */
  kind: TileKind;
  pattern: TilePattern;
  /** Base fill, then the accent the pattern draws with. */
  colors: readonly [base: string, accent: string];
  /**
   * Extrusion height in cells (see `TILE_HEIGHTS`). Absent means flat.
   * Drives both the isometric silhouette and the sight/cover model.
   */
  height?: TileHeight;
  /**
   * How much of the cell it occupies (see `TILE_FOOTPRINTS`). Absent is
   * `fill`. Purely visual — blocking is always the whole cell.
   */
  footprint?: TileFootprint;
  /** Which tool offers it, and so which layer it lands on. */
  category?: TileCategory;
  /** Where it belongs, for single-click placement. */
  placement?: TilePlacement;
  /**
   * A colour this tile GIVES OFF rather than reflects: sodium lamps, neon,
   * a barrel fire, the glow off a server rack.
   *
   * This is what separates six sets that were previously the same grey. It is
   * drawn as a bloom that ignores the tile's own shading, so a strip of neon
   * reads at table distance where a 1px accent line at 40% alpha never did.
   */
  emissive?: string;
  /** A wall stops a token; a floor does not. Doors block until opened. */
  blocksMovement?: boolean;
  /**
   * Sight blocking, tracked separately from height because they genuinely
   * differ: a railing is waist-high and stops neither, glass is full-height
   * and stops only the body. Default follows height — `FULL` blocks, anything
   * lower does not — so this only needs setting for the exceptions.
   */
  blocksSight?: boolean;
  /** One line for the GM, shown on hover in the palette. */
  hint?: string;
}

/** Does this tile stop a sightline? Height decides unless the tile overrides. */
export function stopsSight(tile: Tile): boolean {
  return tile.blocksSight ?? (tile.height ?? 0) >= TILE_HEIGHTS.FULL;
}

/** Does this tile stop a body? Anything standing proud of the floor does. */
export function stopsMovement(tile: Tile): boolean {
  return tile.blocksMovement ?? (tile.height ?? 0) > TILE_HEIGHTS.FLOOR;
}

/**
 * Does this tile grant cover without stopping sight — something to crouch
 * behind? Waist-high by definition: a full wall is not cover, it is a wall.
 */
export function givesCover(tile: Tile): boolean {
  return (tile.height ?? 0) === TILE_HEIGHTS.WAIST;
}

export interface Tileset {
  id: string;
  name: string;
  /** What this set is for, in the GM's terms. */
  blurb: string;
  tiles: readonly Tile[];
}

/** `"col,row"` — the sparse key used by `TileLayer.cells`. */
export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Inverse of `cellKey`; returns null for anything malformed. */
export function parseCellKey(key: string): { col: number; row: number } | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  if (m === null) return null;
  return { col: Number(m[1]), row: Number(m[2]) };
}

/**
 * Which tool a tile belongs to.
 *
 * Explicit when the tile says so; otherwise inferred from `kind` so the whole
 * catalogue did not have to be annotated at once, and so a set authored
 * elsewhere still sorts into the four tools sensibly. `feature` is the lossy
 * one — a workstation and a fire hydrant are both features and belong to
 * different tools — so features default to `decoration` and anything that is
 * really furniture states `category: 'interior'`.
 */
export function categoryOf(tile: Tile): TileCategory {
  if (tile.category !== undefined) return tile.category;
  switch (tile.kind) {
    case 'floor':
      return 'ground';
    case 'wall':
    case 'door':
      return 'building';
    default:
      return 'decoration';
  }
}

/** Which layer a tile is painted into. */
export function layerOf(tile: Tile): 'ground' | 'structure' | 'object' {
  return LAYER_FOR_CATEGORY[categoryOf(tile)];
}
