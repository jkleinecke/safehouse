/**
 * The three.js map stage (the move to 3D: P1 for the GM, P2 for the table,
 * P3 for Build and Prep, and the only map since P5 retired the 2D one):
 * the page's `StageApi`, drawn by the 3D runtime (`lab3d/runtime3d.ts`). It
 * is a lazy chunk, reached only through `stageLoader.ts`'s dynamic import,
 * so three never enters the initial bundle.
 *
 * What stands where:
 *   - the runtime draws the world — painted floors, walls, doors, props and
 *     their lighting — for the floor in view, with the floors below it under
 *     a shade. It builds no figures of its own; it is still handed the
 *     tokens, so the lights they carry light the rooms — for anyone but the
 *     GM, only those standing on ground the table sees live
 *     (`fogEdge.ts` `lightTokens`);
 *   - `Camera3D` is the view, and the pointer's `ViewCamera`: isometric or
 *     top-down as the scene's projection says, orthographic both;
 *   - the `PointerController` the 2D map had (`stage/pointer.ts`) turns the
 *     DOM's pointer events into the page's callbacks, through that camera,
 *     with a raycast of the figures (`pickToken`) ahead of its disc test for
 *     tokens, and ONE raycast of everything standing on the floor in view —
 *     the world's walls, props, stairs and door leaves, and the GM's traced
 *     walls and doors (`standing`, `picking.ts`) — for the painted door a
 *     press opens (`pickTileDoor`), the traced one (`pickTraced`), and the
 *     square of the painted thing it picks (`pickCell`): so a press on a
 *     wall's upper half is the wall, not the square behind it, and never
 *     takes a door, a wall or a note standing or lying behind what it is on;
 *   - the Build selection stands up (`selection.ts`): a selected wall run,
 *     opening or prop, or a marquee's squares, as a box outline as tall as
 *     what it holds, its handles as discs over the canvas where the pointer's
 *     hit test looks for them, and a drag's or a paste's ghost as
 *     translucent boxes as tall as what is on its way;
 *   - `FigurePool` stands the tokens up as figures that glide to their
 *     squares, with their rings and blob shadows, each lit as the floor
 *     under it (the runtime's baked light, `bakedLightAt`), seen through the
 *     walls that hide it, and lying in its blood when down from physical
 *     damage; `TokenBadges` hangs a DOM plate (portrait, name, bars) over
 *     each head. In the top view the portrait is the figure's own, a disc
 *     lying on its head, and the plate is laid round it. The tokens seen
 *     down through the open squares (`belowTokens`) stand on their own
 *     floors under the shade, with no plate and no ring, never picked;
 *   - the flat overlays — the grid, the GM's walls, doors and zones, the
 *     GM's fog regions, the light-map wash, the AoE, the fog draft, the
 *     ruler and every Build draft but the selection and its ghost — are
 *     drawn by the draw functions the 2D map drew them with (`stage/layers.ts`,
 *     `stage/fx.ts`, `stage/lightLayer.ts`), handed a `FloorInk` that lays
 *     them on the floor in view, each redrawn only when its key
 *     (`../stage/keys.ts`) changes, as the 2D stage redrew its Graphics;
 *   - `FloorMarks` fades the pings and the pointer trail on the floor;
 *   - `MapPlane` lays the scene's map images under the ground floor.
 *
 * Rendering is on demand: anything that changes what is on screen asks the
 * runtime for a frame, and frames keep coming only while a figure is still
 * moving or turning, or a ping or trail is still fading. A fight where nobody
 * is moving draws nothing: the acting runner's plate breathes on the
 * compositor, and its ring holds still.
 *
 * Every viewer draws on it, since it is the only map there is: the GM,
 * the players' phones and laptops through the same Grid page, and the TV
 * (`tvStage.ts`, role `display`), which gets no `PointerController` at all.
 * What is the GM's alone is drawn for the GM alone, gated on the role as the
 * 2D map gated it: the GM's walls, doors and zones (`drawGeometry`), the fog
 * as a tint (`drawFog`), the light-map wash, and hidden tokens drawn
 * see-through (`syncTokens`).
 *
 * What a viewer may not see is hidden by the cover (`cover.ts`, `masks.ts`):
 * the players' fog and the sightline shroud (a runner's, or the GM's lens),
 * as masks every material samples at the square it stands over — so walls,
 * furniture, figures and overlays are hidden at every height and from every
 * angle — and, for the plates and labels over the canvas, the same masks
 * read on the CPU (`coveredAt`). The fog also reaches what no material
 * draws: the lights the tokens on ground that is not live carry (not lit,
 * `fogEdge.ts`), and the storeys below the floor in view, which its lid
 * shuts off where the fog's discard would open a hole. It leaves the shadow
 * maps alone: a hidden room's walls still cast, so its lamps light what
 * they would light with the fog off and no more, and never shine through
 * its walls onto revealed floor (`cover.ts`, Shadows). What the 2D map
 * drew above its fog (the templates, the ruler, the drafts, pings and the
 * trail) is drawn above it here too.
 *
 * The GM's markers (`markers.ts`, P3) are drawn where the pointer's hit
 * tests look for them, and so are given back to the pointer: pins standing
 * up the screen from their point by the hit test's own lift, security
 * cameras hung at `CAMERA_EYE_LIFT` over their cones, the GM's lights at
 * their lamps' height over the selected one's reach, GM notes lying on the
 * floor, and the zones' names. The lights' marks hang over the figures, so a
 * press on one takes the light before the token under it
 * (`lightsOverTokens`). The GM's traced walls and doors stand up as walls a
 * storey tall on every floor on show (`tracedWalls.ts`), taken by a press on
 * their faces (`pickTraced`) as well as on their lines.
 *
 * The vision modes (P4) are the colour matrices the 2D map used
 * (`stage/viewModes.ts`), applied by the cover's patch to every covered
 * material's final colour: the floor's matrix on the world, the map and the
 * floors below, the bodies' on the figures in view, none on the overlays and
 * markers — as the 2D map filtered its layers — and the bodies' on the plates
 * too, by an SVG filter (`setViewMode`).
 */
import { Group, Raycaster, Vector2, Vector3, type Mesh } from 'three';
import type { Point, Scene, Token } from '@safehouse/contracts';
import { TILESETS, WALL_THICKNESS, levelTiles, sceneLevels, type LightMap, type LightRow, type VisionMode } from '@safehouse/rules';
import { LAYERS, allCells, type CellSet } from '../cellSelection.js';
import { metricsFor, metricsKey, type SceneMetrics } from '../geometry.js';
import { handlesOf, objectForSelection } from '../paintedObjects.js';
import type { Stage3DHooks } from '../stageLoader.js';
import {
  tileDefsFromSets,
  type MovementThresholds,
  type StageApi,
  type StageOptions,
  type StageQuality,
  type StageSceneState,
  type StageStop,
  type TileDrawDef,
  type TileRectMode,
} from '../types.js';
import { drawAoe, drawArcDraft, drawBrushRing, drawFogDraft, drawRectDraft, drawRuler, drawSegmentDraft } from '../stage/fx.js';
import { brushAnchor, brushCentre, brushRadius } from '../fogBar.js';
import { C } from '../stage/colors.js';
import { aoeKey, fogDraftKey, fogKey, fogRegionKey, geometryKey, mapImagesKey, paintedSelectionKey } from '../stage/keys.js';
import { drawFog, drawGeometry, drawGrid } from '../stage/layers.js';
import { drawLightMap } from '../stage/lightLayer.js';
import { PointerController, type Cell, type GhostFill, type PointerHost } from '../stage/pointer.js';
import { viewModeLook } from '../stage/viewModes.js';
import { createLabMaterials, type LabMaterials } from '../../lab3d/geometry3d.js';
import { createRuntime3D, type Runtime3D, type Runtime3DOptions, type ShadowScope } from '../../lab3d/runtime3d.js';
import { Camera3D, type Camera3DKind } from './camera3d.js';
import { TokenBadges } from './badges.js';
import { coverScene, setVision } from './cover.js';
import { FigurePool, type FigureState } from './figures.js';
import { FloorInk, type InkCover } from './floorInk.js';
import { DomLabels } from './labels.js';
import { MapPlane } from './mapPlane.js';
import { GmMarkers } from './markers.js';
import { HIDDEN_AT, NOT_LIVE_AT, isHidden, lightTokens } from './fogEdge.js';
import { FloorMarks } from './marks.js';
import { CoverMasks, type FogDetail } from './masks.js';
import { pickStanding, type StandingPick } from './picking.js';
import { SelectionBoxes, SelectionHandles, boxTops, type BoxView } from './selection.js';
import { TracedWalls, type TracedLine } from './tracedWalls.js';

/** How long an un-terminated remote drag ghost keeps overriding a position (the 2D stage's rule). */
const GHOST_TTL_MS = 4000;
/**
 * How long a figure the GM dropped is held on the square it was dropped on,
 * waiting for its move to come back from the server, before it goes back to
 * where its token still stands. The round trip is a fraction of this. A move
 * that was never sent (a drag given up for a pinch or a long press, a socket
 * that is down) or was refused must not leave the figure, for good, on a
 * square its token is not on.
 */
const DROP_HOLD_MS = 2000;

/**
 * The palette every stage starts with: the shipped catalogue, the same data
 * the server serves, so a painted scene is built at once rather than after a
 * round trip. The served palette is merged over it when it lands.
 */
const CATALOGUE_DEFS: Record<string, TileDrawDef> = tileDefsFromSets(TILESETS);

/**
 * The flat overlays' draw order among the scene's see-through things. The
 * washes, the grid and the GM's geometry lie under the figures' rings,
 * shadows and blood (1–2) and the top view's portrait discs (4); the fog
 * tint, the templates, the drafts and the ruler lie over them, as the 2D map
 * layered them over its tokens.
 */
const ORDER = {
  lightMap: -20,
  grid: -19,
  geometry: -18,
  // The GM's markers' flat parts, over the geometry as the 2D map layered
  // them; the standing marks (`markers.ts`) after the figures' rings, under
  // the fog tint — cameras at `markers`, lights and pins just after.
  cameraCones: -17,
  lightReach: -16,
  notes: -15,
  markers: 5,
  fog: 10,
  aoe: 11,
  fogDraft: 12,
  paintedSel: 13,
  segment: 14,
  rect: 15,
  ghost: 16,
  // The fog brush's ring (the fog bar): over the ghost of the stroke it is painting.
  brush: 16.5,
  ruler: 17,
  fx: 18,
} as const;

/**
 * Which of a viewer's masks hide each flat overlay (`cover.ts`), after the 2D
 * layer it sat in there: the light-map wash lies under the shroud and the
 * fog; the grid, the doors, the cameras' cones, a light's reach and the GM's
 * notes over the shroud and under the fog; the GM's fog
 * tint (which is the fog), the templates, the drafts and the ruler over both,
 * as the 2D map's fx layer lay over its fog. Pings and the trail
 * (`FloorMarks`) are over both as well, and so are the Build selection and
 * its ghost (`selection.ts`), which are no inks: their places in `ORDER` are
 * their draw order alone.
 */
const COVER: Record<Exclude<keyof typeof ORDER, 'fx' | 'markers' | 'paintedSel' | 'ghost'>, InkCover> = {
  lightMap: 'full',
  grid: 'fog',
  geometry: 'fog',
  cameraCones: 'fog',
  lightReach: 'fog',
  notes: 'fog',
  fog: 'none',
  aoe: 'none',
  fogDraft: 'none',
  segment: 'none',
  rect: 'none',
  brush: 'none',
  ruler: 'none',
};

/** How finely a stage at `quality` rasterises the players' fog (`masks.ts` `FOG_DETAIL`). */
function fogDetailFor(quality: StageQuality): FogDetail {
  return quality === 'low' ? 'low' : 'full';
}

/** The scene's metrics with the projection forced to plan: what every flat overlay draws in, whatever the camera. */
function topDownMetrics(scene: Scene): SceneMetrics {
  return { ...metricsFor(scene.grid), projection: 'topdown' };
}

/** The camera kind a scene's projection asks for: iso stays iso, plan is the top-down camera. */
function cameraKindOf(scene: Scene): Camera3DKind {
  return scene.grid.projection === 'iso' ? 'iso' : 'top';
}

/** The scene's own ambient light, as the lighting's row: 0 fully lit … 3 dark. */
function ambientOf(scene: Scene): LightRow {
  const n = scene.environment?.light;
  if (n === undefined || !Number.isFinite(n)) return 0;
  return Math.min(3, Math.max(0, Math.round(n))) as LightRow;
}

/** `level` as a floor the scene has. */
function clampLevel(scene: Scene, level: number): number {
  const top = Math.max(0, sceneLevels(scene).length - 1);
  return Math.min(Math.max(0, Number.isFinite(level) ? Math.floor(level) : 0), top);
}

/**
 * The runtime's options for a first frame of `state`, whose tokens stand
 * under as much fog as `fogAt` says (`lightTokens`).
 */
function runtimeOptions(
  state: StageSceneState,
  defs: Record<string, TileDrawDef>,
  quality: StageQuality,
  fogAt: (token: Token) => number,
): Runtime3DOptions {
  const scene = state.scene;
  return {
    scene,
    tokens: lightTokens(state, fogAt),
    defs,
    quality,
    ambient: ambientOf(scene),
    floor: clampLevel(scene, state.level ?? 0),
    camera: cameraKindOf(scene),
  };
}

/** A number per tiles object seen (`tilesVersion`). */
const tileVersions = new WeakMap<object, number>();
let nextTileVersion = 1;

/**
 * Which version of floor `level`'s tiles `scene` holds: a new number
 * whenever they are a new object, which a paint makes them. The selection's
 * boxes are as tall as what stands on its squares, and a selection can land
 * on its new squares a moment before the paint that fills them does.
 */
function tilesVersion(scene: Scene, level: number): number {
  const tiles = levelTiles(scene, level);
  if (tiles === undefined) return 0;
  let v = tileVersions.get(tiles);
  if (v === undefined) {
    v = nextTileVersion;
    nextTileVersion += 1;
    tileVersions.set(tiles, v);
  }
  return v;
}

/** What a multi-selection's squares hold, layer by layer, as the selection's boxes read heights from (`boxTops`). */
function fillsOfSet(scene: Scene, sel: CellSet): GhostFill[] {
  const tiles = levelTiles(scene, sel.level);
  if (tiles === undefined) return [];
  return LAYERS.map((layer) => {
    const stored = tiles[layer] ?? {};
    const slots: Record<string, string> = {};
    for (const k of sel.cells[layer]) {
      const slot = stored[k];
      if (slot !== undefined) slots[k] = slot;
    }
    return { tilesetId: tiles.tilesetId, slots };
  });
}

/** The 2D map's selection rings and ghost, as boxes: magenta outline over a magenta floor; translucent cyan. */
const SELECTION_STYLE = { color: C.magenta, floorAlpha: 0.12, faceAlpha: 0, lineAlpha: 0.85, hiddenAlpha: 0.3 } as const;
const GHOST_STYLE = { color: C.cyan, floorAlpha: 0.18, faceAlpha: 0.14, lineAlpha: 0.9, hiddenAlpha: 0.35 } as const;
/** The 2D map's selection and ghost stroke, in its world px. */
const BOX_STROKE_PX = 2;

/** A figure held where it was dropped (`DROP_HOLD_MS`): there, until its token leaves `from` or `until` passes (`Date.now()`). */
interface Hold {
  at: Point;
  from: Point;
  until: number;
}

/** The numbers `Stage3D.viewMoved` compares: the camera's two matrices, the view's size, the floor, the metrics' square. */
const VIEW_SIGNATURE_LENGTH = 36;

/**
 * Where traced walls and doors that changed stand (`TracedWalls.update`),
 * for the shadow refresh (`Runtime3D.refreshShadows`): points along each
 * line a square apart, half a storey up on every floor from the ground to
 * `floor` (they stand on each), reaching the line's half-square between
 * points, a wall's thickness and a storey's half round them.
 */
function lineScope(lines: readonly TracedLine[], floor: number, storey: number): ShadowScope {
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (const { a, b } of lines) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let i = 0; i <= n; i += 1) {
      const x = a.x + ((b.x - a.x) * i) / n;
      const z = a.y + ((b.y - a.y) * i) / n;
      for (let level = 0; level <= floor; level += 1) points.push({ x, y: (level + 0.5) * storey, z });
    }
  }
  return { points, radius: Math.hypot(0.5 + WALL_THICKNESS, storey / 2) + 0.05 };
}

class Stage3D implements StageApi, PointerHost {
  readonly callbacks: StageOptions['callbacks'];
  /** The view, and the pointer's `ViewCamera`. */
  readonly camera: Camera3D;
  /** The GM's lights' marks hang at their lamps' height over everything (`markers.ts`): a press on one is the light's, not the figure's under it. */
  readonly lightsOverTokens = true;

  private readonly rt: Runtime3D;
  /** The runtime's host and the pointer's element: fills the page's host, holds the canvas and the overlay. */
  private readonly root: HTMLDivElement;
  /** The DOM over the canvas: token plates and labels. Never takes a click. */
  private readonly overlay: HTMLDivElement;
  /** The figures' two sets (`FigurePool`): the floor in view's, and the ones seen below it. */
  private readonly materials: LabMaterials;
  private readonly belowMaterials: LabMaterials;
  private readonly figures: FigurePool;
  private readonly badges: TokenBadges;
  private readonly mapPlane: MapPlane;
  /**
   * The DOM's pointer events turned into the page's callbacks; null on the
   * TV (`display`), which has no controls, so nothing on it listens.
   */
  private readonly pointer: PointerController | null;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly unhook: Array<() => void> = [];

  // The flat overlays, one ink each, as the 2D stage kept one Graphics each.
  private readonly inks: FloorInk[] = [];
  private readonly lightMapInk: FloorInk;
  private readonly gridInk: FloorInk;
  private readonly geoInk: FloorInk;
  private readonly fogInk: FloorInk;
  private readonly fogLabels: DomLabels;
  private readonly aoeInk: FloorInk;
  private readonly fogDraftInk: FloorInk;
  private readonly segmentInk: FloorInk;
  private readonly rectInk: FloorInk;
  private readonly rulerInk: FloorInk;
  /** The fog brush's ring under the pointer (`drawBrush`), and where the pointer last put it. */
  private readonly brushInk: FloorInk;
  private brushAt: Point | null = null;
  private lastBrushKey = '';
  /** The painted selection in Build, standing (`selection.ts`): boxes as tall as what it holds. */
  private readonly selBoxes: SelectionBoxes;
  /** Where a dragged or pasted object will land: translucent boxes as tall as what is on its way. */
  private readonly ghostBoxes: SelectionBoxes;
  /** The selected object's handles, over the canvas where the pointer's hit test looks for them. */
  private readonly handles: SelectionHandles;
  /** Bumped whenever the palette changes: the boxes' heights are read from it. */
  private defsVersion = 0;
  /** The camera's forward direction, for the boxes' edges (`boxView`). */
  private readonly viewDir = new Vector3();
  /**
   * The last `standing` pick, for the rest of the task that asked: one press
   * asks for the same point several times (a door, a wall, a note, a Shift
   * toggle, a group, a body), and a raycast of a whole floor is worth doing
   * once.
   */
  private standingPick: { x: number; y: number; pick: StandingPick | null } | null = null;
  /** Pings and the pointer trail, faded frame by frame while any are on the floor. */
  private readonly marks: FloorMarks;
  /** The GM's markers (`markers.ts`): pins, cameras and their cones, lights and their reach, notes, zone names. */
  private readonly markers: GmMarkers;
  /** The GM's traced walls and doors, standing (`tracedWalls.ts`). */
  private readonly traced: TracedWalls;

  private sceneState: StageSceneState;
  /** The state as the pointer sees it (`state`), made once per state. */
  private pointerState: StageSceneState;
  private pointerStateOf: StageSceneState | null = null;
  /** Top-down metrics of the scene grid: what the overlays draw in and the hit tests measure in. */
  private m: SceneMetrics;
  private level: number;
  private sceneId: string;
  private defs: Record<string, TileDrawDef> = CATALOGUE_DEFS;
  // Seeded with the shipped catalogue: the served palette is the same data,
  // and its arrival must not cost a rebuild of the world.
  private lastDefsSignature = JSON.stringify(CATALOGUE_DEFS);
  private thresholds: MovementThresholds | null = null;
  private drags: Record<string, { x: number; y: number; ts?: number }> = {};
  private localDragId: string | null = null;
  private localDragAt: Point | null = null;
  /** Figures let go by the local drag, held where they were dropped for a moment (`DROP_HOLD_MS`). */
  private readonly holds = new Map<string, Hold>();
  /** Due when the soonest hold runs out: the figure then goes back to its token's square. */
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** The view the floor labels were last laid out through (`viewMoved`); NaN until the first layout. */
  private readonly laidView = new Float64Array(VIEW_SIGNATURE_LENGTH).fill(Number.NaN);
  /** What the runtime was last handed as tokens, by identity. */
  private litTokens: readonly Token[] | null = null;
  private litBelow: StageSceneState['belowTokens'] | null = null;

  private lastMetricsKey = '';
  private lastGeoKey = '';
  private lastFogKey = '';
  private lastAoeKey = '';
  private lastFogDraftKey = '';
  private lastPaintedSelKey = '';
  private lastMapKey = '';
  private lastLightMap: LightMap | null = null;
  private lastLightMapMetrics = '';
  private wasPasting = false;

  /** The root's size in px, for picking and for placing plates. */
  private width = 1;
  private height = 1;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly scratch = new Vector3();
  private destroyed = false;
  /**
   * Set once the stage has stopped for good (`stop`): a change it could not
   * build, or a quality switch the browser refused a new context for. The
   * runtime may be half built after either, so a halted stage draws nothing
   * more (`inert`): it takes no update, no overlay, no figure and no camera
   * move from the page or the pointer — only `destroy` still works. The
   * page's Reload map mounts a fresh stage from the current state.
   */
  private halted = false;

  /**
   * Whether the stage has left off drawing, torn down (`destroy`) or halted
   * (`stop`): every entry point that would draw, or ask the runtime anything,
   * returns at once.
   */
  private get inert(): boolean {
    return this.destroyed || this.halted;
  }

  /**
   * `cover` is this stage's cover (`cover.ts`, `masks.ts`: what this viewer
   * may not see), made and brought in line with `opts.state` before the
   * runtime, so its first frame — and its first bake, which lights with the
   * tokens the fog does not cover — is already covered. The stage owns it
   * from here.
   */
  constructor(
    private readonly opts: StageOptions,
    rt: Runtime3D,
    root: HTMLDivElement,
    private readonly hooks: Stage3DHooks,
    /** What this viewer may not see: the fog and shroud masks every material samples, and the fog lid. */
    private readonly cover: CoverMasks,
  ) {
    this.rt = rt;
    this.root = root;
    this.callbacks = opts.callbacks;
    this.sceneState = opts.state;
    this.pointerState = opts.state;
    const scene = opts.state.scene;
    this.m = topDownMetrics(scene);
    this.level = rt.floor;
    this.sceneId = scene.id;
    // What the runtime was made with (`runtimeOptions`).
    this.litTokens = opts.state.tokens;
    this.litBelow = opts.state.belowTokens;
    this.measure();

    // After the canvas, positioned, so it paints over it — and over the new
    // canvas the runtime appends when the quality crosses the Low line.
    const overlay = root.ownerDocument.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1;';
    root.appendChild(overlay);
    this.overlay = overlay;

    this.camera = new Camera3D(rt, { sceneId: scene.id, host: root });

    // Closes, under the floor in view, what the fog's discard opens.
    rt.threeScene.add(this.cover.lid);
    this.cover.setFloor(this.level, this.level * rt.storey);
    // The figures' own sets: the floor in view's under the fog and over the
    // shroud, as the 2D map drew its tokens; the ones seen below it under
    // both, as the 2D map drew its floors below under its shroud.
    this.materials = createLabMaterials('fog');
    this.belowMaterials = createLabMaterials('full');
    this.figures = new FigurePool(this.materials, { unitM: scene.grid.unitM, storey: rt.storey }, this.belowMaterials, {
      urlFor: (id) => this.opts.urlFor(id),
      // Each figure lit as the floor it stands on: the baked lamps there.
      light: {
        at: (level, x, z, out) => this.rt.bakedLightAt(level, x, z, out),
        version: () => this.rt.lightVersion,
      },
      // A portrait that lands after the stage halted asks for no frame.
      onChange: () => this.frame(),
    });
    this.figures.setLevel(this.level);
    rt.threeScene.add(this.figures.group);
    this.badges = new TokenBadges(overlay, (id) => this.opts.urlFor(id));

    this.mapPlane = new MapPlane({ onChange: () => this.frame() });
    rt.threeScene.add(this.mapPlane.group);

    this.lightMapInk = this.ink('lightMap');
    this.gridInk = this.ink('grid');
    this.geoInk = this.ink('geometry');
    this.fogInk = this.ink('fog');
    this.aoeInk = this.ink('aoe');
    this.fogDraftInk = this.ink('fogDraft');
    this.segmentInk = this.ink('segment');
    this.rectInk = this.ink('rect');
    this.rulerInk = this.ink('ruler');
    this.brushInk = this.ink('brush');
    const floorY = () => this.rt.floor * this.rt.storey;
    this.selBoxes = new SelectionBoxes({ floorY, renderOrder: ORDER.paintedSel, style: SELECTION_STYLE });
    this.ghostBoxes = new SelectionBoxes({ floorY, renderOrder: ORDER.ghost, style: GHOST_STYLE });
    rt.threeScene.add(this.selBoxes.group, this.ghostBoxes.group);
    this.handles = new SelectionHandles(overlay);
    this.marks = new FloorMarks({
      cell: () => this.m.cell,
      floorY: () => this.rt.floor * this.rt.storey,
      renderOrder: ORDER.fx,
    });
    rt.threeScene.add(this.marks.group);
    this.fogLabels = new DomLabels(overlay, () => this.m);
    this.markers = new GmMarkers(
      overlay,
      {
        metrics: () => this.m,
        floorY: () => this.rt.floor * this.rt.storey,
        storey: () => this.rt.storey,
        camera: this.camera,
        three: rt.camera,
        height: () => this.height,
        kind: () => this.camera.kind,
      },
      { cones: this.ink('cameraCones'), reach: this.ink('lightReach'), notes: this.ink('notes') },
      ORDER.markers,
    );
    rt.threeScene.add(this.markers.group);
    this.traced = new TracedWalls();
    rt.threeScene.add(this.traced.group);
    // The standing marks' size on the screen follows the camera: one number,
    // set before every frame (`GmMarkers.tick`).
    this.unhook.push(rt.onBeforeFrame(() => this.markers.tick()));

    // Figures glide and turn, and pings fade, frame by frame: each hook
    // says whether it needs another.
    this.unhook.push(
      rt.onBeforeFrame((_now, dt) => this.figures.tick(dt)),
      rt.onBeforeFrame((now) => this.marks.tick(now)),
      // Everything DOM follows the frame just drawn: the view or a figure
      // may have moved.
      rt.onAfterFrame(() => this.layoutOverlay()),
      // The lamps picked again round a camera that moved, mid-frame: the
      // figures are lit for them before that frame is drawn
      // (`FigurePool.relightIfStale`).
      rt.onBeforeRender(() => this.figures.relightIfStale()),
    );

    // The pointer listens on the root, not the canvas: the canvas is
    // replaced when the quality crosses the Low line. The TV is a kiosk
    // (FR9.19): its callbacks are no-ops and its host takes no pointer, and
    // on top of that it gets no listener at all.
    this.pointer = opts.state.role === 'display' ? null : new PointerController(root, this);

    this.resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (this.inert) return;
            // The camera refits an untouched view itself (`Camera3D`); the
            // pointer only has to measure its element again.
            this.measure();
            this.pointer?.invalidateRect();
            this.rt.requestRender();
          });
    this.resizeObserver?.observe(root);

    this.update(opts.state);
    this.warmShaders();
  }

  /**
   * Have the shaders of what may first be drawn mid-session compiled now —
   * the traced walls' lit material, the GM's marks', the selection's and
   * the ghost's — so the first wall the GM traces, or the first marker or
   * box drawn, does not stall the frame that shows it while its shader is
   * compiled (a good part of a second for a lit one, on the laptop, the TV
   * and every phone alike). Samples of each, never added to the scene,
   * freed once compiled. What is on screen from the first frame is compiled
   * with it anyway.
   */
  private warmShaders(): void {
    const samples = new Group();
    samples.add(
      ...this.traced.sample().all,
      this.markers.sample(),
      ...this.selBoxes.sample(),
      ...this.ghostBoxes.sample(),
      ...this.figures.sample(),
    );
    void this.rt.precompile(samples).then(() => {
      samples.traverse((o) => (o as Mesh).geometry?.dispose());
      samples.clear();
    });
  }

  /** The floor ink for overlay `layer`, in the scene: at its draw order (`ORDER`), under its cover (`COVER`). */
  private ink(layer: keyof typeof COVER): FloorInk {
    const ink = new FloorInk({
      metrics: () => this.m,
      floorY: () => this.rt.floor * this.rt.storey,
      renderOrder: ORDER[layer],
      cover: COVER[layer],
    });
    this.rt.threeScene.add(ink.group);
    this.inks.push(ink);
    return ink;
  }

  private measure(): void {
    this.width = Math.max(1, this.root.clientWidth);
    this.height = Math.max(1, this.root.clientHeight);
  }

  /** Ask the runtime for a frame, unless the stage has left off drawing (`inert`). */
  private frame(): void {
    if (!this.inert) this.rt.requestRender();
  }

  /**
   * Make a change that goes through the runtime (`rt.update`, or a camera
   * switch, which is one). The runtime rebuilds its world from whatever the
   * GM painted, and a builder that cannot make sense of it throws; out of
   * here that throw would reach the page's effect and take the whole Grid
   * down mid-session. Instead the stage stops (`stop('build-failed')`) and
   * the page puts its panel up. The runtime may be half built after a throw,
   * so a halted stage takes no more runtime changes at all (`inert`). False
   * when the stage has stopped: the caller draws nothing more.
   */
  private attempt(change: () => void): boolean {
    if (this.halted) return false;
    try {
      change();
      return true;
    } catch (err) {
      console.error('[stage3d] the 3D map could not take a change; it has stopped', err);
      this.stop('build-failed');
      return false;
    }
  }

  /**
   * Stop for good and tell the page why (`Stage3DHooks.onStopped`). Once
   * only: the first reason is the one the page shows. The stage stays
   * mounted, halted and drawing nothing (`inert`), until the page destroys
   * it. Its input and its frame hooks go now: a gesture already under way
   * (a pan, held by pointer capture under the page's panel) moves the camera
   * no further, a frame the runtime draws on its own (a resize) moves no
   * figure and lays out no plate, and no held figure is sent home.
   */
  stop(reason: StageStop): void {
    if (this.halted) return;
    this.halted = true;
    this.pointer?.destroy();
    for (const off of this.unhook.splice(0)) off();
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.hooks.onStopped(reason);
  }

  /**
   * The runtime lost its GPU context. That does not halt the stage: changes
   * keep landing CPU-side while the runtime waits for the context to come
   * back (`contextRestored`). A halted stage has already told the page why
   * it stopped, and that stands.
   */
  contextLost(): void {
    if (!this.halted) this.hooks.onStopped('context-lost');
  }

  /**
   * The runtime has a working GPU context again, either the lost one given
   * back or a new canvas from a quality switch. The page takes its panel
   * down, unless the stage has halted since, which a restore does not undo.
   */
  contextRestored(): void {
    if (!this.halted) this.hooks.onResumed();
  }

  // -- PointerHost -----------------------------------------------------------

  metrics(): SceneMetrics {
    return this.m;
  }

  /**
   * The state as the pointer resolves clicks against it: the page's, less
   * what is not drawn, since a click must not land on something the viewer
   * cannot see — an invisible marker next to a runner would take the click
   * meant for the runner.
   *
   * The GM's markers are drawn where their hit tests look for them
   * (`markers.ts`) and are all there to take, but for the security cameras
   * of other floors: only the floor in view's are drawn, as on the 2D map.
   *
   * And a player's pointer never lands on a token the fog covers
   * (`CoverMasks.coveredAt`), on ground that is not LIVE (`NOT_LIVE_AT`:
   * hidden, or shown only dimmed as remembered) — it is not drawn, or drawn
   * only as a shade, and selecting it would say who stands there — unless
   * it is one they may move: their own runner still comes when called, fog
   * or not, as on the 2D map.
   */
  state(): StageSceneState {
    const s = this.sceneState;
    if (this.pointerStateOf !== s) {
      this.pointerStateOf = s;
      const level = s.level ?? 0;
      const cameras = s.scene.geometry.cameras ?? [];
      const onFloor = (c: { level?: number }): boolean => (c.level ?? 0) === level;
      const scene = cameras.every(onFloor)
        ? s.scene
        : { ...s.scene, geometry: { ...s.scene.geometry, cameras: cameras.filter(onFloor) } };
      const tokens =
        s.role === 'gm'
          ? s.tokens
          : s.tokens.filter((t) => s.draggableIds.has(t.id) || this.cover.coveredAt(t, 'fog') < NOT_LIVE_AT);
      this.pointerState = scene === s.scene && tokens === s.tokens ? s : { ...s, tokens, scene };
    }
    return this.pointerState;
  }

  /**
   * The token under host point `screen`: its plate's portrait, which is
   * drawn over everything, else a raycast of the figures on show — of those
   * the pointer may take (`state`), so a figure the fog covers from a player
   * does not catch a press meant for one standing behind it.
   */
  pickToken(screen: Point): string | null {
    if (this.inert) return null;
    const plate = this.badges.pick(screen);
    if (plate !== null) return plate;
    this.aim(screen);
    const { tokens } = this.state();
    if (tokens === this.sceneState.tokens) return this.figures.pick(this.raycaster);
    const takeable = new Set(tokens.map((t) => t.id));
    return this.figures.pick(this.raycaster, (id) => takeable.has(id));
  }

  /**
   * The first thing standing under host point `screen` on the floor in view
   * — a painted wall, a prop, stairs, a door's leaf or lintel, a traced wall
   * or door — from one raycast of all of them as drawn (`picking.ts`); null
   * where the floor shows first. A player's ray passes through what their
   * fog hides (nothing is drawn there), as their pointer passes over the
   * tokens it hides (`state`).
   */
  private standing(screen: Point): StandingPick | null {
    if (this.inert) return null;
    const known = this.standingPick;
    if (known !== null && known.x === screen.x && known.y === screen.y) return known.pick;
    this.aim(screen);
    const pick = pickStanding(this.rt.threeScene, this.rt.floor, this.raycaster, {
      floorY: this.rt.floor * this.rt.storey,
      hidden: this.sceneState.role === 'gm' ? undefined : this.fogHides,
      extra: this.traced.targets(),
    });
    // Good for the rest of this task — the press that asked — and no longer:
    // the next press may come after the view or the world has moved.
    if (this.standingPick === null) {
      queueMicrotask(() => {
        this.standingPick = null;
      });
    }
    this.standingPick = { x: screen.x, y: screen.y, pick };
    return pick;
  }

  /**
   * The painted door whose shut leaf is the first thing standing under host
   * point `screen` (its `"col,row"` cell): in iso a leaf stands over the
   * squares behind its own. Not a leaf behind a wall, a prop or a traced
   * wall in front of it, nor one under a player's fog.
   */
  pickTileDoor(screen: Point): string | null {
    const pick = this.standing(screen);
    return pick === null || pick.extra ? null : this.rt.doorOfHit(pick.hit);
  }

  /**
   * The GM's traced wall or door that is the first thing standing under host
   * point `screen` (`TracedWalls.pieceAt`): a press on a wall's face or a
   * door's leaf takes it, where the floor point under it is the square
   * behind — but not through a painted wall or a prop standing in front.
   */
  pickTraced(screen: Point): { kind: 'wall' | 'door'; id: string } | null {
    const pick = this.standing(screen);
    return pick !== null && pick.extra ? this.traced.pieceAt(pick.hit.point) : null;
  }

  /**
   * The square of the first thing standing under host point `screen` on the
   * floor in view — a wall's upper half, a tall prop, stairs, a door's
   * lintel, or a traced wall (`pickTraced` says when it is one) — and null
   * where the floor shows, and the pointer takes the floor's square.
   */
  pickCell(screen: Point): Cell | null {
    return this.standing(screen)?.cell ?? null;
  }

  /**
   * Whether a player's fog hides what stands at world point (x, z): nothing
   * is drawn there. Remembered ground is drawn, dimmed, so a wall or a door
   * standing on it is hit like one on live ground (`HIDDEN_AT`).
   */
  private readonly fogHides = (x: number, z: number): boolean => this.cover.coveredAt({ x, y: z }, 'fog') >= HIDDEN_AT;

  /**
   * The view the selection's boxes are drawn for: which way the camera looks
   * (it never turns, so an edge is laid across it once), and the 2D stroke's
   * width in squares.
   */
  private boxView(): BoxView {
    this.rt.camera.updateMatrixWorld();
    this.rt.camera.getWorldDirection(this.viewDir);
    return { dir: this.viewDir, width: BOX_STROKE_PX / Math.max(1e-6, this.m.cell) };
  }

  /** Point the raycaster through host point `screen`, from the camera as it now stands. */
  private aim(screen: Point): void {
    this.ndc.set((screen.x / this.width) * 2 - 1, 1 - (screen.y / this.height) * 2);
    this.rt.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.rt.camera);
  }

  /**
   * The pointer drags a token: its figure is put at `grid` at once and held
   * there, as the 2D map placed its view with no lerp. Let go (null), the
   * figure is held where it was dropped until its token moves (the move came
   * back), so it does not glide back and forth across the round trip — but
   * only for `DROP_HOLD_MS`: a drag given up with no move sent, or a move
   * that never comes back, sends it back to its token's square.
   */
  localDrag(tokenId: string | null, grid: Point | null): void {
    if (this.inert) return;
    const was = this.localDragId;
    const wasAt = this.localDragAt;
    this.localDragId = tokenId;
    this.localDragAt = grid ? { x: grid.x, y: grid.y } : null;
    if (was !== null && wasAt !== null && was !== tokenId) {
      const token = this.sceneState.tokens.find((t) => t.id === was);
      if (token) this.holds.set(was, { at: wasAt, from: { x: token.x, y: token.y }, until: Date.now() + DROP_HOLD_MS });
      this.applyTargets();
    }
    if (!tokenId || !grid) return;
    this.holds.delete(tokenId);
    this.figures.setTarget(tokenId, grid);
    this.figures.jump(tokenId, grid);
    this.rt.requestRender();
  }

  echoPing(grid: Point): void {
    if (!this.inert && this.marks.ping(grid)) this.rt.requestRender();
  }

  echoTrail(grid: Point): void {
    if (!this.inert && this.marks.trail(grid)) this.rt.requestRender();
  }

  drawRuler(from: Point, to: Point, meters: number): void {
    if (this.inert) return;
    drawRuler(this.rulerInk, this.m, from, to, meters, this.thresholds);
    this.rt.requestRender();
  }

  clearRuler(): void {
    this.wipe(this.rulerInk);
  }

  drawSegment(kind: 'wall' | 'door', from: Point, to: Point): void {
    if (this.inert) return;
    drawSegmentDraft(this.segmentInk, this.m, kind, from, to);
    this.rt.requestRender();
  }

  clearSegment(): void {
    this.wipe(this.segmentInk);
  }

  drawArc(a: Point, b: Point, bulge: number): void {
    if (this.inert) return;
    drawArcDraft(this.segmentInk, this.m, a, b, bulge);
    this.rt.requestRender();
  }

  clearArc(): void {
    this.wipe(this.segmentInk);
  }

  drawRect(mode: TileRectMode, from: Cell, to: Cell): void {
    if (this.inert) return;
    drawRectDraft(this.rectInk, this.m, mode, from, to);
    this.rt.requestRender();
  }

  clearRect(): void {
    this.wipe(this.rectInk);
  }

  /**
   * The GM's fog brush ringed under the pointer, at `at` (grid units), or
   * taken away (null). Kept, so a size or a paint changed from the bar or
   * with `[` and `]` redraws the ring where the pointer rests, without
   * waiting for it to move (`update` asks again).
   */
  drawBrush(at: Point | null): void {
    if (this.inert) return;
    this.brushAt = at === null ? null : { x: at.x, y: at.y };
    this.paintBrush();
  }

  /**
   * The ring as the state and the pointer have it now: while the brush is
   * in the GM's hand and the pointer is on the floor, a circle as big as
   * the one a press paints, centred where the stroke will centre it
   * (`fogBar.ts`: snapped as the brush snaps) and coloured by what it
   * paints; otherwise nothing. Drawn again only when one of those changed,
   * so a hover inside one square costs nothing.
   */
  private paintBrush(): void {
    if (this.inert) return;
    const s = this.sceneState;
    const brush = s.role === 'gm' && s.tool === 'fogbrush' ? (s.fogBrush ?? { size: 1, paint: 'live' as const }) : null;
    const at = this.brushAt;
    if (brush === null || at === null) {
      if (this.lastBrushKey !== '') {
        this.lastBrushKey = '';
        this.wipe(this.brushInk);
      }
      return;
    }
    const centre = brushCentre(brushAnchor(at, brush.size), brush.size);
    const key = `${centre.x},${centre.y}|${brush.size}|${brush.paint}|${this.lastMetricsKey}`;
    if (key === this.lastBrushKey) return;
    this.lastBrushKey = key;
    drawBrushRing(this.brushInk, this.m, centre, brushRadius(brush.size), brush.paint);
    this.rt.requestRender();
  }

  /**
   * Where a dragged or pasted object will land, as translucent boxes as tall
   * as what `fill` says will stand on each square (`boxTops`); flat, as the
   * 2D map drew it, where nothing says.
   */
  drawPaintedGhost(cells: readonly string[] | null, fill?: readonly GhostFill[]): void {
    if (this.inert) return;
    // A paste's ghost is drawn again on every move of the pointer, most of
    // them inside the same square: a frame only when it moved.
    const changed =
      cells === null
        ? this.ghostBoxes.clear()
        : this.ghostBoxes.draw(boxTops(cells, fill ?? [], this.defs, this.rt.storey), this.boxView());
    if (changed) this.rt.requestRender();
  }

  /** Clear one overlay and show that it is gone. */
  private wipe(ink: FloorInk): void {
    if (this.inert) return;
    ink.clear();
    this.rt.requestRender();
  }

  // -- StageApi --------------------------------------------------------------

  /**
   * Served palette wins; the shipped catalogue fills anything it omits.
   * Compared by content: the palette is fetched again after every paint, and
   * the same palette arriving as a new object must not rebuild the world.
   */
  setTileDefs(defs: Record<string, TileDrawDef>): void {
    if (this.inert) return;
    const signature = JSON.stringify(defs);
    if (signature === this.lastDefsSignature) return;
    this.lastDefsSignature = signature;
    this.defs = { ...CATALOGUE_DEFS, ...defs };
    this.defsVersion += 1;
    const merged = this.defs;
    this.attempt(() => this.rt.update({ defs: merged }));
  }

  /**
   * Restyle the map for a pair of eyes, with the colour matrices the 2D
   * map used (`stage/viewModes.ts`), where the 2D map put them: the floor's
   * on the world, the map, the floors below and the figures seen down on
   * them; the bodies' on the figures in view and on their plates; nothing
   * on the overlays and the GM's markers (`cover.ts` `markPlain`), on what
   * is drawn over the fog (templates, ruler, pings), or on the markers'
   * labels. Uniforms only (`cover.ts` `setVision`), and a CSS filter on the
   * plates' layer (`TokenBadges.setLook`): no shader is compiled again, so
   * a switch costs one frame. Always written, never skipped as unchanged:
   * the uniforms are shared, and a stage that has just claimed the cover
   * starts from plain eyes.
   */
  setViewMode(mode: VisionMode): void {
    if (this.inert) return;
    this.markFigures();
    const look = viewModeLook(mode);
    setVision(this.cover, look);
    this.badges.setLook(look?.bodies ?? null);
    this.rt.requestRender();
  }

  /**
   * What draws the figures on the floor in view takes the bodies' colours
   * in a vision mode (`FigurePool.markInView`); the figures seen below keep
   * the floor's, as the 2D map's floors below did. Uniform flags only; run
   * after every update, as figures come and change.
   */
  private markFigures(): void {
    this.figures.markInView();
  }

  /** The GPU quality on this device, live: Low swaps the renderer, Medium ↔ High retiers the lighting. */
  setQuality(quality: StageQuality): void {
    if (this.inert || quality === this.rt.options.quality) return;
    // Crossing the Low line makes a new WebGL context, which a browser at its
    // context limit refuses.
    // The runtime switches a frame or two later, behind its own notice, and
    // tells the stage when it has (`qualityApplied`).
    this.attempt(() => this.rt.update({ quality }));
  }

  /**
   * The runtime's quality switch has taken hold (`onQualityApplied`): a new
   * renderer or lighting tier means new materials, which the fog cover and
   * the figures' vision looks dress on the next update — so run one now; and
   * the fog is rasterised more coarsely at Low (`masks.ts`).
   */
  qualityApplied(quality: StageQuality): void {
    if (this.inert) return;
    this.cover.setDetail(fogDetailFor(quality));
    this.update(this.sceneState);
  }

  update(next: StageSceneState): void {
    // A stage that has been torn down draws nothing: the page's update effect
    // can fire once more with the old stage while the host is remounted. Nor
    // does a halted one, not even the parts that leave the runtime alone (the
    // cover, the figures, the plates, the traced walls): its runtime may be
    // half built, and the Reload map's fresh stage starts from this state.
    if (this.inert) return;
    // An edit is timed whole here (`[stage3d] edit`, below): the runtime's
    // part of it and everything the stage then draws again.
    const started = performance.now();
    const edits = this.rt.info().edits;
    this.sceneState = next;
    const scene = next.scene;
    const m = topDownMetrics(scene);
    this.m = m;
    const isGm = next.role === 'gm';

    // -- the cover: the players' fog and the sightline shroud ----------------
    // Rebuilt on the fog's and the shroud's keys, as the 2D map redrew them;
    // first, because what follows reads it: the token lights a player is lit
    // with, the pointer's tokens, the plates and labels.
    const covered = this.cover.update(next, m);

    // -- the world, its lights, and the view ---------------------------------
    const level = clampLevel(scene, next.level ?? 0);
    const kind = cameraKindOf(scene);
    const sceneSwitched = scene.id !== this.sceneId;
    const partial: Partial<Runtime3DOptions> = {};
    if (scene !== this.rt.options.scene) partial.scene = scene;
    if (level !== this.rt.options.floor) partial.floor = level;
    const ambient = ambientOf(scene);
    if (ambient !== this.rt.options.ambient) partial.ambient = ambient;
    // A token that came out of the fog, or went into it, lights the scene or
    // stops: the list is worked out again when the fog changes too. The
    // runtime relights only if the lights it makes changed.
    if (covered.fog || next.tokens !== this.litTokens || next.belowTokens !== this.litBelow) {
      this.litTokens = next.tokens;
      this.litBelow = next.belowTokens;
      partial.tokens = lightTokens(next, this.fogAt);
    }
    // A new scene is framed afresh by the runtime; its camera kind goes in
    // with it, so it is framed once, through the right camera.
    if (sceneSwitched && kind !== this.camera.kind) partial.camera = kind;
    if (Object.keys(partial).length > 0 && !this.attempt(() => this.rt.update(partial))) return;
    if (sceneSwitched) {
      this.sceneId = scene.id;
      this.camera.setScene(scene.id);
    } else if (kind !== this.camera.kind) {
      // Plan ↔ iso on the same scene: the camera reframes itself.
      if (!this.attempt(() => this.camera.setKind(kind))) return;
    }
    // A new scale rebuilds the figures at their new size (a no-op otherwise).
    this.figures.setContext({ unitM: scene.grid.unitM, storey: this.rt.storey });
    // Straight down, a token is its portrait disc, and its plate is laid round it.
    const topView = this.camera.kind === 'top';
    this.figures.setTopView(topView);
    this.badges.setTopView(topView);
    const floorChanged = level !== this.level;
    if (floorChanged) {
      this.level = level;
      this.figures.setLevel(level);
    }
    // The fog lid lies under the floor in view, at its height as now built.
    this.cover.setFloor(level, level * this.rt.storey);
    // The fog has no say in the shadow maps: a wall under it casts all the
    // same, so a hidden room's walls keep its lamp's light in (`cover.ts`,
    // Shadows). So a runner's step, which moves the fog on every phone,
    // draws no shadow map again at Medium or High; a carried light that
    // came or went with it draws its own (`lighting3d.ts` `setSources`).

    // -- the flat overlays, each redrawn only when its key changes -----------
    const mk = metricsKey(m);
    if (mk !== this.lastMetricsKey) {
      this.lastMetricsKey = mk;
      drawGrid(this.gridInk, m);
      // Everything drawn in the metrics is drawn again in the new ones.
      this.lastGeoKey = '';
      this.lastFogKey = '';
      this.lastAoeKey = '';
      this.lastFogDraftKey = '';
      this.lastPaintedSelKey = '';
      this.lastMapKey = '';
    }

    const mapKey = `${mapImagesKey(next)}|${mk}`;
    if (mapKey !== this.lastMapKey) {
      this.lastMapKey = mapKey;
      this.mapPlane.update(scene, (id) => this.opts.urlFor(id));
    }

    // The GM's walls, doors and zones, and the selection among them.
    const gk = geometryKey(next);
    if (gk !== this.lastGeoKey) {
      this.lastGeoKey = gk;
      drawGeometry(this.geoInk, scene, m, isGm, next.selection ?? null);
    }

    // The fog regions as the GM sees them: a tint with the revealed regions
    // cut out, outlined and named — or, on a floor the party has seen
    // (sightlines, P6), the tint square by square in the state each square
    // is in for the table, so the key carries the party's sight on the floor
    // in view as well (`fogKey`). Everyone else's fog is the opaque cover,
    // and that is the cover's fog mask (below), which hides what stands under
    // it at every height — not a sheet on the floor, which the walls would
    // stand up through. (So a player's key leaves the sight out: a runner's
    // step has nothing to redraw here for them, only the mask to stamp.)
    const fk = isGm ? fogKey(next) : fogRegionKey(next);
    if (fk !== this.lastFogKey) {
      this.lastFogKey = fk;
      if (isGm) drawFog(this.fogInk, this.fogLabels, scene, m, true, next.level ?? 0);
      else {
        this.fogInk.clear();
        this.fogLabels.sweep();
      }
    }

    // -- what the cover hides over the canvas ---------------------------------
    // A player's labels hide under the fog as the fog covered them in 2D; the
    // GM's hide nowhere.
    this.fogLabels.setCover(isGm ? null : this.labelCovered);
    if (covered.fog || covered.shroud) {
      // Lay the labels out again on the next frame, whether or not the view moves.
      this.laidView.fill(Number.NaN);
      this.pointerStateOf = null;
    }

    // The light-map wash: the hook hands over the same object until something
    // that moves light moves, so identity is the key. The GM's alone: the
    // page computes none for anyone else (as for the 2D map), and a player's
    // phone or the TV would not draw one it was handed.
    const lightMap = isGm ? (next.lightMap ?? null) : null;
    if (lightMap !== this.lastLightMap || mk !== this.lastLightMapMetrics) {
      this.lastLightMap = lightMap;
      this.lastLightMapMetrics = mk;
      drawLightMap(this.lightMapInk, m, lightMap);
    }

    const ak = aoeKey(next);
    if (ak !== this.lastAoeKey) {
      this.lastAoeKey = ak;
      drawAoe(this.aoeInk, m, next.aoe, next.scatter);
    }

    const dk = fogDraftKey(next);
    if (dk !== this.lastFogDraftKey) {
      this.lastFogDraftKey = dk;
      drawFogDraft(this.fogDraftInk, m, next.fogDraft);
    }

    // The fog brush's ring: put down with the brush, resized or recoloured
    // where the pointer rests when the bar changes it (`paintBrush`).
    this.paintBrush();

    // A paste that was waiting and no longer is takes its ghost with it.
    const pasting = Boolean(next.pasting);
    if (this.wasPasting && !pasting) this.ghostBoxes.clear();
    this.wasPasting = pasting;

    // The painted object selected in Build, or a multi-selection: a box on
    // its squares as tall as what stands there, and the object's handles
    // (the 2D stage's rule: a multi-selection has none). Drawn again when
    // the selection, the floor's tiles, the palette or the camera changes.
    const psel =
      next.selection?.kind === 'painted' && next.paintEdit ? objectForSelection(scene, level, next.selection.id) : null;
    const multiSet = next.paintEdit && next.cellSelection && next.cellSelection.level === level ? next.cellSelection : null;
    const multi = multiSet ? allCells(multiSet) : null;
    const pselKey = paintedSelectionKey(level, multi, psel ? (psel.covers ?? psel.cells) : null, m);
    const selKey =
      pselKey === '' ? '' : `${pselKey}|${kind}|${this.rt.storey}|${this.defsVersion}|${tilesVersion(scene, level)}`;
    if (selKey !== this.lastPaintedSelKey) {
      this.lastPaintedSelKey = selKey;
      if (multiSet && multi) {
        this.selBoxes.draw(boxTops(multi, fillsOfSet(scene, multiSet), this.defs, this.rt.storey), this.boxView());
        this.handles.set([]);
      } else if (psel) {
        const fill: GhostFill[] = [{ tilesetId: psel.tilesetId, slots: psel.slots }];
        this.selBoxes.draw(boxTops(psel.covers ?? psel.cells, fill, this.defs, this.rt.storey), this.boxView());
        this.handles.set(handlesOf(psel).map((h) => h.at));
      } else {
        this.selBoxes.clear();
        this.handles.set([]);
      }
    }

    // The GM's markers — pins and the zones' names, security cameras and
    // their cones, the GM's lights and the selected one's reach, GM notes —
    // each drawn again only when its key changes (`markers.ts`). A player's
    // pin names hide under their fog, as their pins do.
    this.markers.update(next);
    this.markers.setCover(isGm ? null : this.labelCovered);

    // The traced walls and doors, standing on the floor in view and the ones
    // below it. Those that moved, came or went cast their shadows anew: the
    // maps are drawn once, not per frame — only the ones the changed lines
    // fall in (a selection changes none) — and Low has none.
    const moved = this.traced.update(scene, this.rt.floor, this.rt.storey, next.selection ?? null);
    if (moved !== null && this.rt.options.quality !== 'low') {
      this.rt.refreshShadows(moved === 'all' ? undefined : lineScope(moved, this.rt.floor, this.rt.storey));
    }

    // A new floor in view: every overlay that did not redraw above is laid on
    // the new floor's height.
    if (floorChanged) {
      for (const ink of this.inks) ink.flush();
      this.selBoxes.place();
      this.ghostBoxes.place();
    }

    this.syncTokens(next);
    // Everything the scene now holds wears the cover before it is drawn: a
    // material made without it is covered here (and named, in a dev build).
    coverScene(this.rt.threeScene);
    // And every figure in view made or changed takes the bodies' colours (`setViewMode`).
    this.markFigures();
    this.rt.requestRender();
    const info = this.rt.info();
    if (info.edits !== edits) {
      console.debug(
        `[stage3d] edit: ${(performance.now() - started).toFixed(1)} ms in all, ` +
          `${info.lastEditMs.toFixed(1)} ms of it the runtime's (its frame is logged apart)`,
      );
    }
  }

  /**
   * The tokens as figures and plates: the floor in view's own, and the ones
   * seen down through its open squares (`belowTokens`), each on its own floor
   * inside the shade the runtime lays over the floors below — drawn only, as
   * the 2D map drew them: no plate, no ring, no drag, never picked.
   *
   * Hidden tokens (by their flag or their layer) are the GM's alone, and the
   * GM sees them see-through. No other viewer is ever sent one — that is the
   * server's line (Principle 4), and the 2D map relied on it; this stage
   * also does not draw one for them should it arrive anyway.
   */
  private syncTokens(next: StageSceneState): void {
    const scene = next.scene;
    const isGm = next.role === 'gm';
    const states: FigureState[] = [];
    for (const token of next.tokens) {
      const ghosted = isHidden(token, next);
      if (ghosted && !isGm) continue;
      states.push({
        token,
        bars: next.bars.get(token.id) ?? null,
        selected: next.selectedTokenId === token.id,
        acting: next.actingTokenId === token.id,
        ghosted,
        // Each on the floor it stands on. The Grid and the TV hand over the
        // floor in view's tokens only (and the ones below it apart), so that
        // is this floor; one on another floor all the same stays off screen
        // rather than standing on this one.
        level: clampLevel(scene, token.level ?? 0),
      });
    }
    const below: FigureState[] = [];
    for (const { token, depth } of next.belowTokens ?? []) {
      const ghosted = isHidden(token, next);
      if (ghosted && !isGm) continue;
      below.push({
        token,
        // The page projects the bars of the tokens seen below too
        // (`composeStageState`), where the viewer may see them: a full
        // monitor lays one down there as on its own floor.
        bars: next.bars.get(token.id) ?? null,
        selected: false,
        acting: false,
        ghosted,
        level: Math.max(0, this.level - Math.max(1, Math.floor(depth))),
      });
    }
    this.figures.sync(states, below);
    // Plates for the floor in view's own; a figure seen below carries none.
    this.badges.sync(states);
    if (this.localDragId !== null && !next.tokens.some((t) => t.id === this.localDragId)) {
      this.localDragId = null;
      this.localDragAt = null;
    }
    this.applyTargets();
  }

  /**
   * Where each figure is headed: the pointer's point for the one being
   * dragged here, the drop point for one just let go (`holds`, until its
   * token gets there or the hold runs out), a fresh remote drag ghost for one
   * being dragged elsewhere (smooth motion for watchers), and otherwise its
   * token's own square.
   */
  private applyTargets(): void {
    const now = Date.now();
    const present = this.holds.size > 0 ? new Set<string>() : null;
    for (const token of this.sceneState.tokens) {
      present?.add(token.id);
      if (token.id === this.localDragId) {
        if (this.localDragAt) {
          this.figures.setTarget(token.id, this.localDragAt);
          this.figures.jump(token.id, this.localDragAt);
        }
        continue;
      }
      const hold = this.holds.get(token.id);
      if (hold !== undefined) {
        // Still where it stood when it was let go, and not for too long:
        // the move is on its way, so the figure waits on the drop point.
        if (now < hold.until && token.x === hold.from.x && token.y === hold.from.y) {
          this.figures.setTarget(token.id, hold.at);
          continue;
        }
        this.holds.delete(token.id);
      }
      const ghost = this.drags[token.id];
      // A relay that stopped mid-drag (a dropped socket) must not hold the
      // token off its real position for ever.
      const fresh = ghost !== undefined && (ghost.ts === undefined || now - ghost.ts < GHOST_TTL_MS);
      this.figures.setTarget(token.id, fresh ? { x: ghost.x, y: ghost.y } : null);
    }
    if (present !== null) for (const id of this.holds.keys()) if (!present.has(id)) this.holds.delete(id);
    this.scheduleHoldExpiry();
    this.rt.requestRender();
  }

  /** Book `applyTargets` for when the soonest hold runs out, so a figure never waits on its drop point past it. */
  private scheduleHoldExpiry(): void {
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    if (this.holds.size === 0 || this.inert) return;
    let due = Infinity;
    for (const hold of this.holds.values()) due = Math.min(due, hold.until);
    this.holdTimer = setTimeout(
      () => {
        this.holdTimer = null;
        if (!this.inert) this.applyTargets();
      },
      Math.max(0, due - Date.now()) + 1,
    );
  }

  setDrags(drags: Record<string, { x: number; y: number; ts?: number }>): void {
    if (this.inert) return;
    this.drags = drags;
    this.applyTargets();
  }

  /**
   * A drop the server refused (`StageApi.releaseDrop`): the hold on the
   * drop point goes, and the figure heads back to its token's own square at
   * once, as a move that came back would have sent it on — no move is
   * coming, and two seconds of the runner standing where it is not would
   * read as the move having worked.
   */
  releaseDrop(tokenId: string): void {
    if (this.inert) return;
    if (!this.holds.delete(tokenId)) return;
    this.applyTargets();
  }

  flashPing(x: number, y: number): void {
    this.echoPing({ x, y });
  }

  trail(x: number, y: number): void {
    this.echoTrail({ x, y });
  }

  setRulerThresholds(t: MovementThresholds | null): void {
    this.thresholds = t;
  }

  centerOn(x: number, y: number): void {
    if (this.inert) return;
    this.camera.centerOn(x, y);
  }

  zoomBy(factor: number): void {
    if (this.inert) return;
    this.camera.zoomBy(factor);
  }

  fitScene(): void {
    if (this.inert) return;
    this.camera.fit();
  }

  // -- frames ----------------------------------------------------------------

  /**
   * Put the plates over the figures' heads and the labels on the floor, as
   * the frame just drawn has them. The plates follow the figures, so they are
   * looked at after every frame (each is moved only if it moved); the labels
   * lie on the floor and move only with the view, so they are laid out again
   * only when it moved (a label drawn meanwhile is placed as it arrives).
   *
   * A player sees no plate over a figure the fog covers (`plateAt`), as the
   * 2D fog covered its badges: the figure is not drawn, and its plate would
   * say who stands there.
   */
  private layoutOverlay(): void {
    if (this.inert) return;
    const at = this.sceneState.role === 'gm' ? (id: string) => this.figures.positionOf(id) : this.plateAt;
    this.badges.layout(this.projectWorld, at);
    // The handles sit where the pointer's hit test projects them: on the floor.
    this.handles.layout((grid) => this.camera.project(grid));
    const moved = this.viewMoved();
    if (moved) this.fogLabels.layout((grid) => this.camera.project(grid), true);
    // The markers' names: the zones' and notes' with the floor, the rest with their marks.
    this.markers.layout(moved);
  }

  /** Where a player's plate for a token hangs, or null — no plate — while its figure's square is not live (`NOT_LIVE_AT`). */
  private readonly plateAt = (tokenId: string): Vector3 | null => {
    const head = this.figures.positionOf(tokenId);
    if (head === null) return null;
    return this.cover.coveredAt({ x: head.x, y: head.z }, 'fog') >= NOT_LIVE_AT ? null : head;
  };

  /**
   * Whether a player's label anchored at grid point `at` is under the fog
   * (`DomLabels.setCover`): only where the map itself is hidden. A pin on
   * remembered ground is drawn there, dimmed, and keeps its name.
   */
  private readonly labelCovered = (at: Point): boolean => this.cover.coveredAt(at, 'fog') >= HIDDEN_AT;

  /**
   * How much fog, alone, covers the square `token` stands on (0 live … 1
   * hidden): read at the not-live threshold for its carried light
   * (`lightTokens`), which on ground that is not live lights nothing for a
   * player or the TV.
   */
  private readonly fogAt = (token: Token): number => this.cover.coveredAt(token, 'fog');

  /**
   * Whether the view differs from the one the floor labels were last laid
   * out through — the camera's place, turn and zoom, the view's size, the
   * floor in view, the metrics' square — remembering this one for next time.
   */
  private viewMoved(): boolean {
    const cam = this.rt.camera;
    cam.updateMatrixWorld();
    const seen = this.laidView;
    const world = cam.matrixWorld.elements;
    const lens = cam.projectionMatrix.elements;
    const now = [...world, ...lens, this.width, this.height, this.rt.floor, this.m.cell];
    let moved = false;
    for (let i = 0; i < VIEW_SIGNATURE_LENGTH; i += 1) {
      const v = now[i] ?? 0;
      if (seen[i] === v) continue;
      seen[i] = v;
      moved = true;
    }
    return moved;
  }

  /** A world point (three.js units) to host px, through the camera as last drawn. */
  private readonly projectWorld = (world: Vector3): { x: number; y: number } => {
    const v = this.scratch.copy(world).project(this.rt.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  };

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pointer?.destroy();
    this.resizeObserver?.disconnect();
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.holds.clear();
    for (const off of this.unhook) off();
    this.camera.dispose();
    this.figures.dispose();
    this.badges.dispose();
    this.fogLabels.dispose();
    this.marks.dispose();
    this.markers.dispose();
    this.traced.dispose();
    for (const ink of this.inks) ink.dispose();
    this.selBoxes.dispose();
    this.ghostBoxes.dispose();
    this.handles.dispose();
    this.mapPlane.dispose();
    this.materials.dispose();
    this.belowMaterials.dispose();
    // Nothing covered any more, unless a newer stage has taken the cover over;
    // the fog lid goes with it.
    this.cover.dispose();
    try {
      this.rt.dispose();
    } catch {
      // A runtime whose GPU context is already gone may not tear down cleanly; it is gone either way.
    }
    this.overlay.remove();
    this.root.remove();
  }
}

/**
 * Build and mount the 3D stage into `opts.host`. `hooks.onStopped` is how
 * the page hears the map has stopped drawing (a lost GPU context, a later
 * change that could not be built, a refused quality switch), and
 * `hooks.onResumed` that a lost context came back. Rejects if WebGL or the
 * first build fails; the loader passes that on and the page shows it.
 */
export async function createStage(opts: StageOptions, hooks: Stage3DHooks): Promise<StageApi> {
  const doc = opts.host.ownerDocument;
  const root = doc.createElement('div');
  root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;';
  opts.host.appendChild(root);
  let rt: Runtime3D | null = null;
  // The cover first: the runtime's first frame and first bake are drawn
  // under it, and lit only by the tokens the fog does not cover.
  const cover = new CoverMasks(fogDetailFor(hooks.quality));
  try {
    cover.update(opts.state, topDownMetrics(opts.state.scene));
    const fogAt = (token: Token): number => cover.coveredAt(token, 'fog');
    // The quality this device starts at for this role (the TV's is Low),
    // resolved by the loader.
    // The stage is made after the runtime; the quality callbacks reach it late.
    let stage: Stage3D | null = null;
    rt = createRuntime3D(root, runtimeOptions(opts.state, CATALOGUE_DEFS, hooks.quality, fogAt), {
      // The runtime's context events arrive after this function has returned,
      // so the stage is there to take them.
      onContextLost: () => stage?.contextLost(),
      onContextRestored: () => stage?.contextRestored(),
      onQualityApplied: (q) => stage?.qualityApplied(q),
      // Crossing the Low line makes a new WebGL context, which a browser at
      // its limit refuses, and the old one is already gone: there is no
      // canvas left, so the stage stops until the page reloads it.
      onQualityFailed: () => stage?.stop('quality-failed'),
    });
    stage = new Stage3D(opts, rt, root, hooks, cover);
    return stage;
  } catch (err) {
    try {
      rt?.dispose();
    } catch {
      // Already failing; the error below is the one worth reporting.
    }
    cover.dispose();
    root.remove();
    throw err;
  }
}
