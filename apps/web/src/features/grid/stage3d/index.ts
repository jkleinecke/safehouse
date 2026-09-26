/**
 * The three.js map stage (the move to 3D: P1 for the GM, P2 for the table):
 * the `StageApi` the 2D Pixi stage (`../stage/index.ts`) implements, drawn by
 * the 3D runtime (`lab3d/runtime3d.ts`) and behaving the same from the page's
 * side. It is a lazy chunk, reached only through `stageLoader.ts`'s dynamic
 * import, so three never enters the initial bundle and pixi never enters
 * this one.
 *
 * What stands where:
 *   - the runtime draws the world — painted floors, walls, doors, props and
 *     their lighting — for the floor in view, with the floors below it under
 *     a shade. It builds no figures of its own (`figures: false`); it is
 *     still handed the tokens, so the lights they carry light the rooms —
 *     for anyone but the GM, only those the fog does not cover
 *     (`lightTokens`);
 *   - `Camera3D` is the view, and the pointer's `ViewCamera`: isometric or
 *     top-down as the scene's projection says, orthographic both;
 *   - the same `PointerController` as the 2D map turns the DOM's pointer
 *     events into the same callbacks, through that camera, with a raycast of
 *     the figures (`pickToken`) ahead of its disc test for tokens, and of the
 *     painted doors' leaves (`pickTileDoor`) ahead of its cell test;
 *   - `FigurePool` stands the tokens up as figures that glide to their
 *     squares, with their rings and blob shadows; `TokenBadges` hangs a DOM
 *     plate (portrait, name, bars) over each head. The tokens seen down
 *     through the open squares (`belowTokens`) stand on their own floors
 *     under the shade, with no plate and no ring, never picked;
 *   - the flat overlays — the grid, the GM's walls, doors and zones, the
 *     GM's fog regions, the light-map wash, the AoE, the fog draft, the
 *     ruler and every Build draft — are the 2D map's own draw functions,
 *     handed a `FloorInk` that lays them on the floor in view, each redrawn
 *     only when its key (`../stage/keys.ts`) changes, as the 2D stage
 *     redraws its Graphics;
 *   - `FloorMarks` fades the pings and the pointer trail on the floor;
 *   - `MapPlane` lays the scene's map images under the ground floor.
 *
 * Rendering is on demand: anything that changes what is on screen asks the
 * runtime for a frame, and frames keep coming only while a figure is still
 * moving or turning, or a ping or trail is still fading. A fight where nobody
 * is moving draws nothing: the acting runner's plate breathes on the
 * compositor, and its ring holds still.
 *
 * Every viewer draws on it since P2 (`stageLoader.ts` `ROLES_3D`): the GM,
 * the players' phones and laptops through the same Grid page, and the TV
 * (`tvStage.ts`, role `display`), which gets no `PointerController` at all.
 * What is the GM's alone is drawn for the GM alone, gated on the role as the
 * 2D map gates it: the GM's walls, doors and zones (`drawGeometry`), the fog
 * as a tint (`drawFog`), the light-map wash, and hidden tokens drawn
 * see-through (`syncTokens`).
 *
 * What a viewer may not see is hidden by the cover (`cover.ts`, `masks.ts`):
 * the players' fog and the sightline shroud (a runner's, or the GM's lens),
 * as masks every material samples at the square it stands over — so walls,
 * furniture, figures and overlays are hidden at every height and from every
 * angle — and, for the plates and labels over the canvas, the same masks
 * read on the CPU (`coveredAt`). The fog also reaches what no material
 * draws: the shadow maps (redrawn when it changes), the lights of the tokens
 * under it (not lit), and the storeys below the floor in view, which its lid
 * shuts off where the fog's discard would open a hole. What the 2D map
 * draws above its fog (the templates, the ruler, the drafts, pings and the
 * trail) is drawn above it here too.
 *
 * Not drawn yet, and not hit either (they come in P3/P4): pins, GM notes,
 * security cameras and their cones, the GM's light markers, and the vision
 * modes. Each is a commented no-op below.
 */
import { Raycaster, Vector2, Vector3 } from 'three';
import type { Point, Scene, Token } from '@safehouse/contracts';
import { TILESETS, sceneLevels, type LightMap, type LightRow, type VisionMode } from '@safehouse/rules';
import { allCells } from '../cellSelection.js';
import { metricsFor, metricsKey, worldFromGrid, type SceneMetrics } from '../geometry.js';
import { handlesOf, objectForSelection } from '../paintedObjects.js';
import type { Stage3DHooks } from '../stageLoader.js';
import {
  tileDefsFromSets,
  type MovementThresholds,
  type StageApi,
  type StageOptions,
  type StageQuality,
  type StageSceneState,
  type TileDrawDef,
  type TileRectMode,
} from '../types.js';
import {
  drawAoe,
  drawArcDraft,
  drawFogDraft,
  drawPaintedGhost,
  drawPaintedSelection,
  drawRectDraft,
  drawRuler,
  drawSegmentDraft,
} from '../stage/fx.js';
import { aoeKey, fogDraftKey, fogKey, geometryKey, mapImagesKey, paintedSelectionKey } from '../stage/keys.js';
import { drawFog, drawGeometry, drawGrid } from '../stage/layers.js';
import { drawLightMap } from '../stage/lightLayer.js';
import { PointerController, type Cell, type PointerHost } from '../stage/pointer.js';
import { createLabMaterials, type LabMaterials } from '../../lab3d/geometry3d.js';
import { createRuntime3D, type Runtime3D, type Runtime3DOptions } from '../../lab3d/runtime3d.js';
import { Camera3D, type Camera3DKind } from './camera3d.js';
import { TokenBadges } from './badges.js';
import { coverScene } from './cover.js';
import { FigurePool, type FigureState } from './figures.js';
import { FloorInk, type InkCover } from './floorInk.js';
import { DomLabels } from './labels.js';
import { MapPlane } from './mapPlane.js';
import { FloorMarks } from './marks.js';
import { CoverMasks, type FogDetail } from './masks.js';

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
 * washes, the grid and the GM's geometry lie under the figures' rings and
 * shadows (1–2); the fog tint, the templates, the drafts and the ruler lie
 * over them, as the 2D map layers them over its tokens.
 */
const ORDER = {
  lightMap: -20,
  grid: -19,
  geometry: -18,
  fog: 10,
  aoe: 11,
  fogDraft: 12,
  paintedSel: 13,
  segment: 14,
  rect: 15,
  ghost: 16,
  ruler: 17,
  fx: 18,
} as const;

/**
 * Which of a viewer's masks hide each flat overlay (`cover.ts`), after the 2D
 * layer it sits in there: the light-map wash lies under the shroud and the
 * fog; the grid and the doors over the shroud and under the fog; the GM's fog
 * tint (which is the fog), the templates, the drafts and the ruler over both,
 * as the 2D map's fx layer lies over its fog. Pings and the trail
 * (`FloorMarks`) are over both as well.
 */
const COVER: Record<Exclude<keyof typeof ORDER, 'fx'>, InkCover> = {
  lightMap: 'full',
  grid: 'fog',
  geometry: 'fog',
  fog: 'none',
  aoe: 'none',
  fogDraft: 'none',
  paintedSel: 'none',
  segment: 'none',
  rect: 'none',
  ghost: 'none',
  ruler: 'none',
};

/** A covered figure's plate or label hides from a player from this much cover up (`CoverMasks.coveredAt`). */
const HIDDEN_AT = 0.5;

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
 * Whether `token` is hidden from the table, by its own flag or by a hidden
 * layer: the GM's alone (the server never sends one to anyone else).
 */
function isHidden(token: Token, state: StageSceneState): boolean {
  return Boolean(token.hidden) || (state.hiddenLayerTokenIds?.has(token.id) ?? false);
}

/**
 * The tokens whose carried lights the runtime lights the scene with: the
 * ones on this floor and the ones seen below it (their lights shine up
 * through the open squares). Figures are the stage's own, so this list only
 * lights.
 *
 * Everyone but the GM gets only the lights of tokens they could see. A
 * hidden token's light is the GM's alone, as the token is. And a token the
 * players' fog covers carries its light nowhere for them — baked on Low, a
 * real lamp on Medium and High, it would light the revealed rooms round it
 * and say where the guard with the flashlight stands and which way he
 * faces, which the 2D map (whose light-map wash is the GM's alone) never
 * does — except the viewer's own runner, fog or not. `fogged` says whether
 * the fog covers a token (`CoverMasks.coveredAt`).
 */
function lightTokens(state: StageSceneState, fogged: (token: Token) => boolean): readonly Token[] {
  const below = state.belowTokens ?? [];
  const all = below.length === 0 ? state.tokens : [...state.tokens, ...below.map((b) => b.token)];
  if (state.role === 'gm') return all;
  const lit = (t: Token): boolean =>
    !isHidden(t, state) && (state.draggableIds.has(t.id) || !(t.light && t.light.on !== false) || !fogged(t));
  return all.every(lit) ? all : all.filter(lit);
}

/** The runtime's options for a first frame of `state`, whose tokens the fog covers as `fogged` says. */
function runtimeOptions(
  state: StageSceneState,
  defs: Record<string, TileDrawDef>,
  quality: StageQuality,
  fogged: (token: Token) => boolean,
): Runtime3DOptions {
  const scene = state.scene;
  return {
    scene,
    tokens: lightTokens(state, fogged),
    figures: false,
    defs,
    quality,
    ambient: ambientOf(scene),
    walls: 'full',
    floor: clampLevel(scene, state.level ?? 0),
    below: 'dim',
    camera: cameraKindOf(scene),
  };
}

/** A figure held where it was dropped (`DROP_HOLD_MS`): there, until its token leaves `from` or `until` passes (`Date.now()`). */
interface Hold {
  at: Point;
  from: Point;
  until: number;
}

/** The numbers `Stage3D.viewMoved` compares: the camera's two matrices, the view's size, the floor, the metrics' square. */
const VIEW_SIGNATURE_LENGTH = 36;

class Stage3D implements StageApi, PointerHost {
  readonly renderer = '3d' as const;
  readonly callbacks: StageOptions['callbacks'];
  /** The view, and the pointer's `ViewCamera`. */
  readonly camera: Camera3D;

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

  // The flat overlays, one ink each, as the 2D stage keeps one Graphics each.
  private readonly inks: FloorInk[] = [];
  private readonly lightMapInk: FloorInk;
  private readonly gridInk: FloorInk;
  private readonly geoInk: FloorInk;
  private readonly fogInk: FloorInk;
  private readonly fogLabels: DomLabels;
  private readonly aoeInk: FloorInk;
  private readonly fogDraftInk: FloorInk;
  private readonly paintedSelInk: FloorInk;
  private readonly segmentInk: FloorInk;
  private readonly rectInk: FloorInk;
  private readonly ghostInk: FloorInk;
  private readonly rulerInk: FloorInk;
  /** Pings and the pointer trail, faded frame by frame while any are on the floor. */
  private readonly marks: FloorMarks;

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
    // shroud, as the 2D map draws its tokens; the ones seen below it under
    // both, as the 2D map draws its floors below under its shroud.
    this.materials = createLabMaterials('fog');
    this.belowMaterials = createLabMaterials('full');
    this.figures = new FigurePool(this.materials, { unitM: scene.grid.unitM, storey: rt.storey }, this.belowMaterials);
    this.figures.setLevel(this.level);
    rt.threeScene.add(this.figures.group);
    this.badges = new TokenBadges(overlay, (id) => this.opts.urlFor(id));

    this.mapPlane = new MapPlane({ onChange: () => this.rt.requestRender() });
    rt.threeScene.add(this.mapPlane.group);

    this.lightMapInk = this.ink('lightMap');
    this.gridInk = this.ink('grid');
    this.geoInk = this.ink('geometry');
    this.fogInk = this.ink('fog');
    this.aoeInk = this.ink('aoe');
    this.fogDraftInk = this.ink('fogDraft');
    this.paintedSelInk = this.ink('paintedSel');
    this.segmentInk = this.ink('segment');
    this.rectInk = this.ink('rect');
    this.ghostInk = this.ink('ghost');
    this.rulerInk = this.ink('ruler');
    this.marks = new FloorMarks({
      cell: () => this.m.cell,
      floorY: () => this.rt.floor * this.rt.storey,
      renderOrder: ORDER.fx,
    });
    rt.threeScene.add(this.marks.group);
    this.fogLabels = new DomLabels(overlay, () => this.m);

    // Figures glide and turn, and pings fade, frame by frame: each hook
    // says whether it needs another.
    this.unhook.push(
      rt.onBeforeFrame((_now, dt) => this.figures.tick(dt)),
      rt.onBeforeFrame((now) => this.marks.tick(now)),
      // Everything DOM follows the frame just drawn: the view or a figure
      // may have moved.
      rt.onAfterFrame(() => this.layoutOverlay()),
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
            if (this.destroyed) return;
            // The camera refits an untouched view itself (`Camera3D`); the
            // pointer only has to measure its element again.
            this.measure();
            this.pointer?.invalidateRect();
            this.rt.requestRender();
          });
    this.resizeObserver?.observe(root);

    this.update(opts.state);
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

  /**
   * Make a change that goes through the runtime (`rt.update`, or a camera
   * switch, which is one). The runtime rebuilds its world from whatever the
   * GM painted, and a builder that cannot make sense of it throws; out of
   * here that throw would reach the page's effect and take the whole Grid
   * down mid-session. Instead the map is handed to the classic stage, as a
   * lost GPU context is (`hooks.onLost`, which destroys this stage). False
   * when that happened: the caller draws nothing more.
   */
  private attempt(change: () => void): boolean {
    try {
      change();
      return true;
    } catch (err) {
      console.error('[stage3d] the 3D map could not take a change; the classic map takes over', err);
      this.hooks.onLost('the 3D world could not be built');
      return false;
    }
  }

  // -- PointerHost -----------------------------------------------------------

  metrics(): SceneMetrics {
    return this.m;
  }

  /**
   * The state as the pointer resolves clicks against it: the page's, with
   * the pins, notes, security cameras and light markers taken out of the
   * scene. The 3D map does not draw those yet (P3), and a click must not land
   * on something the GM cannot see — an invisible pin next to a runner would
   * take the click meant for the runner. Placing them with their tools still
   * works; selecting them goes through the GM panel until they are drawn.
   *
   * For the same reason a player's pointer never lands on a token the fog
   * covers (`CoverMasks.coveredAt`) — it is not drawn, and selecting it
   * would say who stands there — unless it is one they may move: their own
   * runner still comes when called, fog or not, as on the 2D map.
   */
  state(): StageSceneState {
    const s = this.sceneState;
    if (this.pointerStateOf !== s) {
      this.pointerStateOf = s;
      const geometry = { ...s.scene.geometry, pins: [], cameras: [], lights: [], gmNotes: [] };
      const tokens =
        s.role === 'gm'
          ? s.tokens
          : s.tokens.filter((t) => s.draggableIds.has(t.id) || this.cover.coveredAt(t, 'fog') < HIDDEN_AT);
      this.pointerState = { ...s, tokens, scene: { ...s.scene, geometry } };
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
    if (this.destroyed) return null;
    const plate = this.badges.pick(screen);
    if (plate !== null) return plate;
    this.aim(screen);
    const { tokens } = this.state();
    if (tokens === this.sceneState.tokens) return this.figures.pick(this.raycaster);
    const takeable = new Set(tokens.map((t) => t.id));
    return this.figures.pick(this.raycaster, (id) => takeable.has(id));
  }

  /**
   * The painted door whose shut leaf is under host point `screen` on the
   * floor in view (its `"col,row"` cell), from a raycast of the leaves as
   * drawn: in iso a leaf stands over the squares behind its own.
   */
  pickTileDoor(screen: Point): string | null {
    if (this.destroyed) return null;
    this.aim(screen);
    return this.rt.pickDoor(this.raycaster);
  }

  /** Point the raycaster through host point `screen`, from the camera as it now stands. */
  private aim(screen: Point): void {
    this.ndc.set((screen.x / this.width) * 2 - 1, 1 - (screen.y / this.height) * 2);
    this.rt.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.rt.camera);
  }

  /**
   * The pointer drags a token: its figure is put at `grid` at once and held
   * there, as the 2D map places its view with no lerp. Let go (null), the
   * figure is held where it was dropped until its token moves (the move came
   * back), so it does not glide back and forth across the round trip — but
   * only for `DROP_HOLD_MS`: a drag given up with no move sent, or a move
   * that never comes back, sends it back to its token's square.
   */
  localDrag(tokenId: string | null, grid: Point | null): void {
    if (this.destroyed) return;
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
    if (!this.destroyed && this.marks.ping(grid)) this.rt.requestRender();
  }

  echoTrail(grid: Point): void {
    if (!this.destroyed && this.marks.trail(grid)) this.rt.requestRender();
  }

  drawRuler(from: Point, to: Point, meters: number): void {
    if (this.destroyed) return;
    drawRuler(this.rulerInk, this.m, from, to, meters, this.thresholds);
    this.rt.requestRender();
  }

  clearRuler(): void {
    this.wipe(this.rulerInk);
  }

  drawSegment(kind: 'wall' | 'door', from: Point, to: Point): void {
    if (this.destroyed) return;
    drawSegmentDraft(this.segmentInk, this.m, kind, from, to);
    this.rt.requestRender();
  }

  clearSegment(): void {
    this.wipe(this.segmentInk);
  }

  drawArc(a: Point, b: Point, bulge: number): void {
    if (this.destroyed) return;
    drawArcDraft(this.segmentInk, this.m, a, b, bulge);
    this.rt.requestRender();
  }

  clearArc(): void {
    this.wipe(this.segmentInk);
  }

  drawRect(mode: TileRectMode, from: Cell, to: Cell): void {
    if (this.destroyed) return;
    drawRectDraft(this.rectInk, this.m, mode, from, to);
    this.rt.requestRender();
  }

  clearRect(): void {
    this.wipe(this.rectInk);
  }

  drawPaintedGhost(cells: readonly string[] | null): void {
    if (this.destroyed) return;
    if (cells === null) this.ghostInk.clear();
    else drawPaintedGhost(this.ghostInk, this.m, cells);
    this.rt.requestRender();
  }

  /** Clear one overlay and show that it is gone. */
  private wipe(ink: FloorInk): void {
    if (this.destroyed) return;
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
    if (this.destroyed) return;
    const signature = JSON.stringify(defs);
    if (signature === this.lastDefsSignature) return;
    this.lastDefsSignature = signature;
    this.defs = { ...CATALOGUE_DEFS, ...defs };
    const merged = this.defs;
    this.attempt(() => this.rt.update({ defs: merged }));
  }

  /** Not yet (P4): the 3D map draws every pair of eyes as normal. */
  setViewMode(_mode: VisionMode): void {
    // No-op until the vision modes are a material pass over the 3D scene.
  }

  /** The GPU quality on this device, live: Low swaps the renderer, Medium ↔ High retiers the lighting. */
  setQuality(quality: StageQuality): void {
    if (this.destroyed || quality === this.rt.options.quality) return;
    // Crossing the Low line makes a new WebGL context, which a browser at its
    // context limit refuses.
    if (!this.attempt(() => this.rt.update({ quality }))) return;
    // The fog is rasterised more coarsely at Low (`masks.ts`).
    if (this.cover.setDetail(fogDetailFor(quality))) this.update(this.sceneState);
  }

  update(next: StageSceneState): void {
    // A stage that has been torn down draws nothing: the page's update effect
    // can fire once more with the old stage while the host is remounted.
    if (this.destroyed) return;
    this.sceneState = next;
    const scene = next.scene;
    const m = topDownMetrics(scene);
    this.m = m;
    const isGm = next.role === 'gm';

    // -- the cover: the players' fog and the sightline shroud ----------------
    // Rebuilt on the fog's and the shroud's keys, as the 2D map redraws them;
    // first, because what follows reads it: the token lights a player is lit
    // with, the shadow maps, the pointer's tokens, the plates and labels.
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
      partial.tokens = lightTokens(next, this.fogged);
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
    const floorChanged = level !== this.level;
    if (floorChanged) {
      this.level = level;
      this.figures.setLevel(level);
    }
    // The fog lid lies under the floor in view, at its height as now built.
    this.cover.setFloor(level, level * this.rt.storey);
    // The shadow maps are drawn once, not per frame: a caster the fog now
    // hides, or no longer hides, casts again only when they are redrawn
    // (`cover.ts` `coverShadows`). Low has none to redraw.
    if (covered.fog && this.rt.options.quality !== 'low') this.rt.refreshShadows();

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
    // cut out, outlined and named. Everyone else's fog is the opaque cover,
    // and that is the cover's fog mask (below), which hides what stands under
    // it at every height — not a sheet on the floor, which the walls would
    // stand up through.
    const fk = fogKey(next);
    if (fk !== this.lastFogKey) {
      this.lastFogKey = fk;
      if (isGm) drawFog(this.fogInk, this.fogLabels, scene, m, true);
      else {
        this.fogInk.clear();
        this.fogLabels.sweep();
      }
    }

    // -- what the cover hides over the canvas ---------------------------------
    // A player's labels hide under the fog as the fog covers them in 2D; the
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

    // A paste that was waiting and no longer is takes its ghost with it.
    const pasting = Boolean(next.pasting);
    if (this.wasPasting && !pasting) this.ghostInk.clear();
    this.wasPasting = pasting;

    // The painted object selected in Build, or a multi-selection: rings on
    // its cells, and the object's handles (the 2D stage's rule).
    const psel =
      next.selection?.kind === 'painted' && next.paintEdit ? objectForSelection(scene, level, next.selection.id) : null;
    const multi =
      next.paintEdit && next.cellSelection && next.cellSelection.level === level ? allCells(next.cellSelection) : null;
    const pselKey = paintedSelectionKey(level, multi, psel ? (psel.covers ?? psel.cells) : null, m);
    if (pselKey !== this.lastPaintedSelKey) {
      this.lastPaintedSelKey = pselKey;
      if (multi) drawPaintedSelection(this.paintedSelInk, m, multi, []);
      else if (psel)
        drawPaintedSelection(
          this.paintedSelInk,
          m,
          psel.covers ?? psel.cells,
          handlesOf(psel).map((h) => worldFromGrid(m, h.at)),
        );
      else this.paintedSelInk.clear();
    }

    // Not drawn in 3D yet — each a no-op until its phase: pins and zone names
    // (`drawPins`), GM notes (`drawNotes`), security cameras and their cones
    // (`drawCameras`), the GM's light markers (`drawLights`): P3, as DOM
    // markers and floor inks.

    // A new floor in view: every overlay that did not redraw above is laid on
    // the new floor's height.
    if (floorChanged) for (const ink of this.inks) ink.flush();

    this.syncTokens(next);
    // Everything the scene now holds wears the cover before it is drawn: a
    // material made without it is covered here (and named, in a dev build).
    coverScene(this.rt.threeScene);
    this.rt.requestRender();
  }

  /**
   * The tokens as figures and plates: the floor in view's own, and the ones
   * seen down through its open squares (`belowTokens`), each on its own floor
   * inside the shade the runtime lays over the floors below — drawn only, as
   * the 2D map draws them: no plate, no ring, no drag, never picked.
   *
   * Hidden tokens (by their flag or their layer) are the GM's alone, and the
   * GM sees them see-through. No other viewer is ever sent one — that is the
   * server's line (Principle 4), and the 2D map relies on it; this stage
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
    if (this.holds.size === 0 || this.destroyed) return;
    let due = Infinity;
    for (const hold of this.holds.values()) due = Math.min(due, hold.until);
    this.holdTimer = setTimeout(
      () => {
        this.holdTimer = null;
        if (!this.destroyed) this.applyTargets();
      },
      Math.max(0, due - Date.now()) + 1,
    );
  }

  setDrags(drags: Record<string, { x: number; y: number; ts?: number }>): void {
    if (this.destroyed) return;
    this.drags = drags;
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
    if (this.destroyed) return;
    this.camera.centerOn(x, y);
  }

  zoomBy(factor: number): void {
    if (this.destroyed) return;
    this.camera.zoomBy(factor);
  }

  fitScene(): void {
    if (this.destroyed) return;
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
   * 2D fog covers its badges: the figure is not drawn, and its plate would
   * say who stands there.
   */
  private layoutOverlay(): void {
    if (this.destroyed) return;
    const at = this.sceneState.role === 'gm' ? (id: string) => this.figures.positionOf(id) : this.plateAt;
    this.badges.layout(this.projectWorld, at);
    if (this.viewMoved()) this.fogLabels.layout((grid) => this.camera.project(grid), true);
  }

  /** Where a player's plate for a token hangs, or null — no plate — while the fog covers its figure's square. */
  private readonly plateAt = (tokenId: string): Vector3 | null => {
    const head = this.figures.positionOf(tokenId);
    if (head === null) return null;
    return this.cover.coveredAt({ x: head.x, y: head.z }, 'fog') >= HIDDEN_AT ? null : head;
  };

  /** Whether a player's label anchored at grid point `at` is under the fog (`DomLabels.setCover`). */
  private readonly labelCovered = (at: Point): boolean => this.cover.coveredAt(at, 'fog') >= HIDDEN_AT;

  /** Whether the fog covers where `token` stands, for a player: its light then lights nothing (`lightTokens`). */
  private readonly fogged = (token: Token): boolean => this.cover.coveredAt(token, 'fog') >= HIDDEN_AT;

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
    for (const ink of this.inks) ink.dispose();
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
 * Build and mount the 3D stage into `opts.host`. `hooks.onLost` is how the
 * loader hears the GPU context has gone for good, or a later change could not
 * be built, so it can put the classic map in its place. Rejects if WebGL or
 * the first build fails, which the loader answers with the classic map.
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
    const fogged = (token: Token): boolean => cover.coveredAt(token, 'fog') >= HIDDEN_AT;
    // The quality this device starts at for this role (the TV's is Low),
    // resolved by the loader.
    rt = createRuntime3D(root, runtimeOptions(opts.state, CATALOGUE_DEFS, hooks.quality, fogged), {
      orbit: false,
      onContextLost: () => hooks.onLost('context lost'),
    });
    return new Stage3D(opts, rt, root, hooks, cover);
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
