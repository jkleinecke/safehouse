/**
 * Grid feature shared types (DESIGN.md M9 P2). Pure TS — no pixi imports here
 * so the main bundle stays lean; the stage subtree is loaded lazily.
 */
import type { Point, Role, Scene, Token } from '@safehouse/contracts';
import type { TilePattern } from '@safehouse/rules';

/** Active pointer tool on the canvas. */
export type GridTool =
  | 'select' // move tokens / toggle doors (GM) / pan
  | 'ruler' // click-drag measurement (FR9.8/9.9)
  | 'aoe' // place AoE circle template (FR9.12)
  | 'pointer' // pointer trail broadcast (FR9.15)
  | 'fogdef' // GM: click vertices to define a named fog region (FR9.14)
  | 'focus' // GM: next click broadcasts "focus here" (FR9.15)
  | 'wall' // GM: drag to draw a wall segment (FR9.2)
  | 'door' // GM: drag to draw a door segment (FR9.2)
  | 'zone' // GM: click vertices to draw a named zone (FR9.2)
  | 'pin' // GM: click to drop a map pin (FR9.3)
  | 'tile' // GM: paint tiles from a tileset (FR9.2 "assemble")
  | 'tile-area' // GM: drag a rectangle, fill it with the chosen ground
  | 'tile-room' // GM: drag a rectangle, floor inside and walls around it
  | 'tile-erase'; // GM: clear painted cells

/** GM drawing tools that author scene geometry rather than play with it. */
export const GEOMETRY_TOOLS: readonly GridTool[] = ['wall', 'door', 'zone', 'pin'];

/**
 * The tools that lay tiles down. Kept as one list because the palette's
 * "which tile" choice must survive switching between them: picking a floor and
 * then picking the room tool is one intention, not two.
 */
export const TILE_TOOLS: readonly GridTool[] = ['tile', 'tile-area', 'tile-room'];

/**
 * How a rectangle drag lays tiles. `area` fills the ground; `room` fills the
 * ground AND stands a wall on every edge cell, which is the single most common
 * thing a GM does when building — draw a room — and used to take a hundred
 * clicks with the brush.
 */
export type TileRectMode = 'area' | 'room';

/**
 * The GM's OWN view of the map, independent of what the table is shown.
 *
 * `scene` follows the scene's saved projection. The other two override it on
 * this device only: a GM lays out rooms in plan, where a rectangle is a
 * rectangle, and flips to isometric to see what the table sees — without the
 * table flipping with them mid-session.
 */
export type ViewProjection = 'scene' | 'topdown' | 'iso';

/**
 * One tile as the canvas draws it (FR9.2).
 *
 * `pattern` is the rules union rather than a bare string on purpose:
 * `stage/tileLayer.ts` switches on it and asserts the default branch is
 * `never`, so a thirteenth pattern added to the catalogue fails the build
 * instead of quietly rendering every cell as flat base colour.
 */
export interface TileDrawDef {
  pattern: TilePattern;
  colors: readonly [string, string];
  /**
   * Extrusion in cells — 0 flat, 0.5 waist-high, 1 full. The same number line
   * of sight reads (`TILE_HEIGHTS` in @safehouse/rules), which is what stops a
   * tile that LOOKS waist-high from behaving like a full wall.
   */
  height?: number;
  /** Colour this tile gives off: neon, sodium light, a barrel fire. */
  emissive?: string;
  /**
   * How much of the cell it occupies. `wall` draws a third-of-a-cell slab that
   * orients itself from its neighbours; anything else fills the square.
   * Purely visual — sight and movement always block the whole cell.
   */
  footprint?: 'fill' | 'wall' | 'post' | 'canopy' | 'round' | 'stair';
  /**
   * Which floor a flight of stairs leads to (FR9.22). Cosmetic HERE — it only
   * decides whether the treads climb or descend across the cell — while
   * `stairTarget` in the rules decides where they actually go.
   */
  connects?: 'up' | 'down';
  /**
   * What the tile IS, for the plan-view treatment: a door gets a bar across
   * its slab, a wall does not. Absent means "draw it as its footprint says".
   */
  kind?: string;
  /**
   * `false` marks glass, grilles and empty frames — things a sightline passes
   * through — so the renderer can draw them lighter than the wall they sit in.
   */
  blocksSight?: boolean;
  /** Reflected light washed over the top face — see `Tile.sheen`. */
  sheen?: string;
  /**
   * The floor to draw UNDER a thin tile, from the same set.
   *
   * Without it every wall would be a hole in the map: a slab covers a third of
   * its cell, and the other two thirds would show the empty grid where a
   * room's edge should be. Attached at flatten time so the renderer does not
   * need to know which tile in a set counts as its floor.
   */
  underlay?: { pattern: TilePattern; colors: readonly [string, string] };
}

/**
 * Lookup key for a tile definition — tileset AND tile, never the tile id alone.
 *
 * Tile ids are only unique WITHIN a set. `wall` exists in all six catalogue
 * sets, `door` in four and `floor` in two, so the flat `defs[tile.id]` map this
 * replaces was last-write-wins in catalogue order: a Docklands warehouse drew
 * its corrugated walls, roller doors and poured concrete in Club purple, three
 * of its seven tiles wrong, on a canvas that looked plausible enough not to
 * question.
 */
export function tileDefKey(tilesetId: string, tileId: string): string {
  return `${tilesetId}/${tileId}`;
}

/** The shape both the shipped catalogue and the served one satisfy. */
export interface TileSetLike {
  id: string;
  tiles: readonly {
    id: string;
    kind: string;
    pattern: TilePattern;
    colors: readonly [string, string];
    height?: number;
    emissive?: string;
    sheen?: string;
    blocksSight?: boolean;
    footprint?: 'fill' | 'wall' | 'post' | 'canopy' | 'round' | 'stair';
    connects?: 'up' | 'down';
  }[];
}

/**
 * Flatten tilesets into the canvas's palette.
 *
 * ONE function, called by both the cold-load seed baked into the stage and the
 * served catalogue from `GET /api/tilesets`, because they have already drifted
 * once: the seed dropped `height` and every wall drew flat until the fetch
 * landed, which on the isometric projection is the whole feature missing. Two
 * copies of this logic is two chances to forget a field.
 *
 * Keyed by `tileDefKey`, not by tile id: `wall` exists in every set, `door` in
 * four and `floor` in two, and a flat map keeps only the last one loaded.
 */
export function tileDefsFromSets(sets: readonly TileSetLike[]): Record<string, TileDrawDef> {
  const defs: Record<string, TileDrawDef> = {};
  for (const set of sets) {
    // What a thin tile stands on. First floor in the set, so a warehouse wall
    // stands on warehouse concrete rather than a hole in the map.
    const floor = set.tiles.find((t) => t.kind === 'floor');
    for (const t of set.tiles) {
      // EVERY partial footprint needs floor beneath it, not just walls: a
      // hydrant is a narrow post and a tree is a trunk, so without an underlay
      // each one would be a hole in the map with the grid showing through.
      const thin =
        t.footprint !== undefined && t.footprint !== 'fill';
      defs[tileDefKey(set.id, t.id)] = {
        pattern: t.pattern,
        colors: t.colors,
        // Spread conditionally: an absent field must stay absent rather than
        // become an explicit `undefined` the renderer has to special-case.
        ...(t.height !== undefined ? { height: t.height } : {}),
        ...(t.emissive !== undefined ? { emissive: t.emissive } : {}),
        ...(t.sheen !== undefined ? { sheen: t.sheen } : {}),
        ...(t.blocksSight !== undefined ? { blocksSight: t.blocksSight } : {}),
        ...(t.footprint !== undefined ? { footprint: t.footprint } : {}),
        ...(t.connects !== undefined ? { connects: t.connects } : {}),
        kind: t.kind,
        ...(thin && floor !== undefined
          ? { underlay: { pattern: floor.pattern, colors: floor.colors } }
          : {}),
      };
    }
  }
  return defs;
}

/** In-progress wall/door rubber band, reported by the stage while dragging. */
export interface SegmentDraft {
  kind: 'wall' | 'door';
  a: Point;
  b: Point;
}

/** Live ruler measurement, reported by the stage to the DOM readout. */
export interface RulerState {
  /** Grid-unit coordinates. */
  from: Point;
  to: Point;
  /** Distance in meters (grid distance × unitM). */
  meters: number;
  /** Token the measurement started on (movement thresholds come from it). */
  fromTokenId: string | null;
}

/** Walk/run thresholds in meters for the measuring token (engine-derived). */
export interface MovementThresholds {
  walkM: number;
  runM: number;
}

/** AoE circle template (FR9.12). Position in grid units, radius in meters. */
export interface AoeTemplate {
  center: Point;
  radiusM: number;
}

/** Grenade scatter render state (FR9.12) — cosmetic, client-rolled. */
export interface ScatterResult {
  /** Where the template was aimed (grid units). */
  from: Point;
  /** Where it landed after scatter (grid units). */
  to: Point;
  meters: number;
  /** Human line, e.g. "2d6 → 7 − 3 net hits = 4 m NE". */
  summary: string;
}

/**
 * In-progress polygon definition (grid units). Shared by the fog-region tool
 * (FR9.14) and the zone tool (FR9.2) — only one is ever active, and the stage
 * draws the same rubber-band polygon for both.
 */
export interface FogDraft {
  points: Point[];
}

/** Condition/status decorations for a token, projected from the encounter. */
export interface TokenBars {
  physical?: { filled: number; max: number };
  stun?: { filled: number; max: number };
  /** Number of active status effects → pips (FR9.6/FR4.7). */
  effectCount: number;
}

/**
 * What the sightline shroud should darken (FR9.16).
 *
 * Computed in React, not in the stage. The set depends on the scene, the
 * tokens and which character this device owns — a graph that lives in hooks —
 * so deriving it inside the pixi chunk would drag all of that in for nothing.
 * The stage's job is to draw the answer.
 */
export interface ShroudState {
  /** `"col,row"` of every cell the viewer can see. */
  visible: ReadonlySet<string>;
  /** A GM previewing a viewpoint gets a lighter scrim than a player bound by it. */
  gm: boolean;
  /**
   * `"col,row"` → how tall that square stands, in cells. Sparse; absent is flat.
   *
   * The scrim is a screen-space wash, and in isometric a square's content is
   * not its ground diamond: a wall extends upward from it by half a cell per
   * cell of height. Without this the scrim darkened the FLOOR of a hidden
   * square and left the wall standing on it at full brightness — bright caps
   * hovering over darkened ground, with the shroud line cutting each wall
   * across the middle.
   */
  heights?: ReadonlyMap<string, number> | undefined;
}

/** Everything the pixi stage needs to (re)draw a frame of scene state. */
export interface StageSceneState {
  scene: Scene;
  tokens: Token[];
  role: Role;
  /** Token ids this client may drag (own tokens; GM: all) — FR9.5. */
  draggableIds: ReadonlySet<string>;
  /** tokenId → bars/pips projection (FR9.6). */
  bars: ReadonlyMap<string, TokenBars>;
  /** Token with the acting-combatant glow (FR9.10). */
  actingTokenId: string | null;
  selectedTokenId: string | null;
  tool: GridTool;
  /** Grid snap on drop (FR9.5, toggleable; hold Shift for a one-off bypass). */
  snapEnabled: boolean;
  aoe: AoeTemplate | null;
  scatter: ScatterResult | null;
  fogDraft: FogDraft | null;
  /** Pin currently open in the GM's pin editor — drawn ringed (FR9.3). */
  selectedPinId?: string | null;
  /**
   * Cells outside the viewer's sightline, or null for "no viewpoint" — which
   * draws nothing at all. An unselected token must never black out the table.
   */
  shroud?: ShroudState | null;
  /**
   * Which floor to draw (FR9.22). Absent means the ground, which is the only
   * floor a flat scene has.
   */
  level?: number;
}

/** Callbacks the stage raises back into React land. */
export interface StageCallbacks {
  /** Final drop position (grid units) → WS `token.move` (FR9.5). */
  onTokenMove(tokenId: string, x: number, y: number): void;
  /** Interim drag position, already throttled ~12Hz → WS `token.drag`. */
  onTokenDrag(tokenId: string, x: number, y: number): void;
  onSelectToken(tokenId: string | null): void;
  /** Double-tap flash (FR9.15) — grid units. */
  onPing(x: number, y: number): void;
  /** Pointer-trail sample, throttled — grid units. */
  onPointer(x: number, y: number): void;
  /** Ruler changed (null = measurement ended). */
  onRuler(ruler: RulerState | null): void;
  /** GM clicked a door with the select tool. */
  onDoorToggle(doorId: string): void;
  /** AoE tool click (grid units). */
  onAoePlace(x: number, y: number): void;
  /** fogdef/zone tool click — append a polygon vertex (grid units). */
  onFogVertex(x: number, y: number): void;
  /** focus tool click — broadcast "focus here" (grid units). */
  onFocus(x: number, y: number): void;

  // -- GM geometry authoring (FR9.2/9.3). Optional so other stages (the TV
  // kiosk) can implement the play-side callbacks alone.

  /** wall/door drag finished — endpoints in grid units, already snapped. */
  onSegmentDraw?(kind: 'wall' | 'door', a: Point, b: Point): void;
  /** pin tool click — drop a pin at grid coords (FR9.3). */
  onPinPlace?(x: number, y: number): void;
  /** One cell of a tile paint stroke (FR9.2); `erase` clears instead. */
  onTilePaint?(col: number, row: number, erase: boolean): void;
  /**
   * A rectangle drag finished (FR9.2). Cell bounds, inclusive, already
   * normalised so `c0 <= c1` and `r0 <= r1`; the mode says whether the GM
   * wanted a floor or a room.
   */
  onTileRect?(c0: number, r0: number, c1: number, r1: number, mode: TileRectMode): void;
  /**
   * The paint stroke ended (button up, gesture abandoned). Without this the
   * coalescer was a trailing debounce over painting ACTIVITY, not a per-stroke
   * flush: a deliberate stroke with pauses became N full-layer writes, and the
   * last cell of every stroke sat unsent for 140ms after the GM let go.
   */
  onTileStrokeEnd?(): void;
  /** select-tool click on an existing pin — open it in the editor. */
  onPinSelect?(pinId: string): void;
}

/** Imperative API of the lazily-loaded pixi stage. */
export interface StageApi {
  update(state: StageSceneState): void;
  /**
   * Tile definitions for the painted floor (FR9.2), keyed by `tileDefKey` —
   * tileset AND tile, because tile ids collide across sets. Supplied from the
   * served catalogue so the canvas draws what the server accepted; the stage
   * seeds itself from the shipped catalogue first, so a stage that never gets
   * this call (the TV) still draws a floor rather than a blank screen.
   */
  setTileDefs(defs: Record<string, TileDrawDef>): void;
  /** Interim remote drag ghosts: tokenId → grid position (+ relay timestamp). */
  setDrags(drags: Record<string, { x: number; y: number; ts?: number }>): void;
  /** Flash a ping at grid coords (remote or local echo). */
  flashPing(x: number, y: number): void;
  /** Add a pointer-trail sample at grid coords. */
  trail(x: number, y: number): void;
  /** Movement thresholds for the token currently measured from. */
  setRulerThresholds(t: MovementThresholds | null): void;
  /** Clear the on-canvas measurement line. */
  clearRuler(): void;
  /** Recenter the camera on grid coords ("focus here", scene open). */
  centerOn(x: number, y: number): void;
  /** Zoom about the viewport centre (HUD buttons). */
  zoomBy(factor: number): void;
  /** Frame the whole scene. */
  fitScene(): void;
  destroy(): void;
}

/** Options for the lazily-imported stage factory. */
export interface StageOptions {
  host: HTMLElement;
  state: StageSceneState;
  callbacks: StageCallbacks;
  /** attachment id → URL (map images, token art). */
  urlFor(attachmentId: string): string;
}
