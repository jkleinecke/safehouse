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
  /** Tufts and mottling — turf, weeds, a crown of leaves. */
  'grass',
  /** Packed earth: mottled, cracked, a few stones. */
  'dirt',
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
export const TILE_CATEGORIES = ['ground', 'building', 'interior', 'decoration', 'stairs'] as const;

export type TileCategory = (typeof TILE_CATEGORIES)[number];

/** Which of the scene's three layers a category writes to. */
export const LAYER_FOR_CATEGORY: Readonly<Record<TileCategory, 'ground' | 'structure' | 'object'>> =
  {
    ground: 'ground',
    building: 'structure',
    interior: 'object',
    decoration: 'object',
    // Stairs are building fabric, so they share the structure layer — which
    // correctly means a square cannot hold both a wall and a stairwell.
    // Unlike a wall they do not block: the whole point is walking through.
    stairs: 'structure',
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
export const TILE_FOOTPRINTS = ['fill', 'wall', 'post', 'canopy', 'round', 'stair'] as const;

export type TileFootprint = (typeof TILE_FOOTPRINTS)[number];

/**
 * What an opening in a wall LOOKS like — the design the canvas draws on the
 * wall's face, and the symbol it draws in plan.
 *
 * A door used to be a slab in a different colour. Naming the design here,
 * as data, is what lets a roller door be a roller door and a wheel-hatch a
 * wheel-hatch without the renderer knowing one set from another; and it is
 * what lets the GM read a floor plan the way a floor plan reads, with swing
 * arcs and glazing lines. Adjacent cells of one cut tile draw as one wide
 * opening — a double door, a run of shopfront glass with a mullion per cell.
 *
 * A VALUE, not just a type, for the same reason as `TILE_PATTERNS`: the
 * renderer switches on it with a `never` default, so a design added here
 * without a drawing is a compile error rather than a plain slab.
 */
export const TILE_CUTS = [
  /** A hinged leaf with panels and a handle; two cells make a double door. */
  'door',
  /** A flush corporate leaf with a card reader beside the frame. */
  'maglock',
  /** A heavy leaf with a round window in it. */
  'porthole',
  /** Glass leaf with a push bar. */
  'glassdoor',
  /** A glazed partition, floor to ceiling. */
  'glass',
  /** Glass with a wire mesh in it, on a sill. */
  'wireglass',
  /** A shopfront: a low panel, then a big lit pane. */
  'shopwindow',
  /** Horizontal slats with a housing at the top. */
  'roller',
  /** Slats that reach the ground, closed. */
  'shutter',
  /** A louvred grille. */
  'louvre',
  /** A round hatch with a wheel and dogs. */
  'hatch',
  /** No door at all — a hole with ragged edges. */
  'gap',
  /** A window frame with the shards still in it. */
  'blown',
  /** A counter opening with a shelf and a light behind it. */
  'serving',
  /** A sign box with a neon tube on it. */
  'sign',
  /** Chain-link: diamond mesh you can see through. */
  'mesh',
] as const;

export type TileCut = (typeof TILE_CUTS)[number];

/**
 * What a piece of furniture or a prop LOOKS like — the silhouette the canvas
 * builds for it, in isometric and as the floor-plan symbol in plan.
 *
 * Before this every object was one of four blobs: a box, a post, a squat
 * cylinder or a post with a crown. A desk, a car and a pallet stack were the
 * same box in three browns, and the GM said so. Naming the design here, as
 * data, is what lets a desk have pedestals and a monitor, a car a cabin and
 * wheels, a street lamp a pole with a head that throws its pool on the
 * pavement — without the renderer knowing one set from another. Palettes
 * stay the tile's own; the design only says what shape they are painted on.
 *
 * A VALUE, not just a type, for the same reason as `TILE_CUTS`: the renderer
 * keeps one drawing per member in a record typed by this list, so a design
 * added here without a drawing is a compile error rather than a blob. Sets
 * reuse designs freely — barrens crates and warehouse crates are one design
 * in two palettes — which is how forty-odd drawings dress six worlds.
 */
export const TILE_PROPS = [
  // --- furniture ---------------------------------------------------------
  /** A slab on two pedestals with a monitor on it. */
  'desk',
  /** A seat with a backrest and four legs. */
  'chair',
  /** A long seat with arms and a back; a cushion line down the middle. */
  'sofa',
  /** A rectangular top on four legs. */
  'table',
  /** A round top on a stem. */
  'cocktail',
  /** Two bench seats facing each other across a table. */
  'booth',
  /** A round seat on a leg with a footrest ring. */
  'stool',
  /** A pedestal with an angled console and a lit screen. */
  'terminal',
  /** A tall cabinet with a column of status lights and vents. */
  'server',
  /** A tall cabinet of doors with vent slits and handles. */
  'locker',
  /** A machine with a lit front window and a dispenser slot. */
  'vending',
  /** A bottle upside-down on a stand. */
  'cooler',
  /** A cylinder with a lid. */
  'bin',
  /** A basin with water and a column in the middle. */
  'fountain',
  /** A pot with leaves lumped over it. */
  'plant',
  /** A desk with two turntables and a mixer. */
  'decks',
  /** Two cabinets stacked, cones on the front. */
  'speakers',
  // --- freight and machinery ---------------------------------------------
  /** Three boxes, one on top of two. */
  'crates',
  /** A flat pallet: boards with gaps. */
  'pallet',
  /** A drum with ribs and a lid. */
  'barrel',
  /** A truck with a mast, forks and an overhead guard. */
  'forklift',
  /** A corrugated box with doors on one end. */
  'container',
  /** A drum on its end with flanges — cable, hose. */
  'spool',
  /** A lamp head on a tripod, throwing its pool on the ground. */
  'worklight',
  /** A block with an engine cover, an exhaust and a panel. */
  'generator',
  /** A wide cylinder with a domed top and bands. */
  'tank',
  /** Three standpipes with handwheels, joined by a cross pipe. */
  'valves',
  /** A housing with a motor beside it and a pipe out of the top. */
  'pump',
  /** A box with a round grille and spokes. */
  'fan',
  // --- street ------------------------------------------------------------
  /** A low body with a glazed cabin and wheels. */
  'car',
  /** A cargo box with a cab in front. */
  'van',
  /** A trunk with a jittered crown. */
  'tree',
  /** Low lumps of foliage. */
  'bush',
  /** A square planter with something growing in it. */
  'planter',
  /** A short post with a cap and two side nozzles. */
  'hydrant',
  /** A post with a cap and a reflective band. */
  'bollard',
  /** A tall pole with an arm and a lamp head. */
  'lamppost',
  /** A skip with a lid and small wheels. */
  'dumpster',
  /** A traffic cone with a reflective band. */
  'cone',
  /** Lumpy bags. */
  'trash',
  // --- the barrens -------------------------------------------------------
  /** A drum with flames coming out of it. */
  'fire',
  /** A burnt-out car, crushed and missing a wheel. */
  'wreck',
  /** A stack of tyres. */
  'tyres',
  /** A tarp over a ridge pole, open at one end. */
  'tent',
  /** A mound of rubble. */
  'heap',
  /** A flat mattress with a pillow. */
  'mattress',
  /** An oil lamp standing on a crate. */
  'lantern',
  /** A wire basket on wheels with a handle. */
  'cart',
] as const;

export type TileProp = (typeof TILE_PROPS)[number];

/**
 * Footprints that occupy only part of their cell and therefore need floor
 * drawn underneath them — otherwise every one is a hole in the map.
 */
export const PARTIAL_FOOTPRINTS: readonly TileFootprint[] = [
  'wall',
  'post',
  'canopy',
  'round',
  'stair',
];

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
   * Which way this tile leads, for stairs (FR9.22).
   *
   * Present ONLY on stairs, and it is what makes a painted stairwell a
   * connection rather than a picture of one: `stairTarget` reads it to answer
   * "standing here, which floor can I reach". Absent on everything else,
   * because most of a map does not go anywhere.
   */
  connects?: 'up' | 'down';
  /**
   * The design of an opening in a wall — see `TILE_CUTS`. Only meaningful on
   * a `wall`-footprint tile; a door or a window without one draws as a plain
   * slab, which is exactly the look this exists to replace.
   */
  cut?: TileCut;
  /**
   * The design of a piece of furniture or a prop — see `TILE_PROPS`. Only
   * meaningful on an object-layer tile (interior or decoration); a prop
   * without one draws as the plain solid its `footprint` describes.
   */
  prop?: TileProp;
  /**
   * A colour this tile GIVES OFF rather than reflects: sodium lamps, neon,
   * a barrel fire, the glow off a server rack.
   *
   * This is what separates six sets that were previously the same grey. It is
   * drawn as a bloom that ignores the tile's own shading, so a strip of neon
   * reads at table distance where a 1px accent line at 40% alpha never did.
   */
  emissive?: string;
  /**
   * A colour this surface REFLECTS — wet asphalt under a sign, a dance floor
   * lit from beneath, polished stone under a lobby's downlights.
   *
   * The study describes this as wet-ground reflectance: 8–20% of a surface
   * mirroring the nearest light. It is drawn as a translucent wash over the
   * tile's own top face and nothing more — no pool, no bloom, no light thrown
   * onto the neighbours — which is what keeps it a SURFACE property that a GM
   * may paint a whole floor with. That is the difference from `emissive`,
   * which is a light and is rationed like one (`SET_EMISSIVE_MAX`).
   */
  sheen?: string;
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
  // A stairwell is an opening in the building, not a solid in it.
  if (tile.connects !== undefined) return false;
  return tile.blocksSight ?? (tile.height ?? 0) >= TILE_HEIGHTS.FULL;
}

/** Does this tile stop a body? Anything standing proud of the floor does. */
export function stopsMovement(tile: Tile): boolean {
  // Checked BEFORE height: stairs live in the structure layer beside walls, so
  // without this a stairwell drawn with any height at all would be a stair
  // nobody can walk onto — a picture of a stair.
  if (tile.connects !== undefined) return false;
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

/**
 * Stairs must never block, whatever else the tile says.
 *
 * They live in the structure layer beside walls and doors — they are building
 * fabric, and a square holding both a wall and a stairwell is not a thing —
 * but a stair a runner cannot walk onto is a picture of a stair. This is
 * checked BEFORE height, so a full-height stairwell tile still lets a body
 * through.
 */
export function isStair(tile: Tile): boolean {
  return tile.connects !== undefined;
}
