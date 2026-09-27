/**
 * The 3D map's runtime: one scene drawn by three.js into a host element.
 *
 * This is the part of the 3D lab that a real map stage can stand on. It owns
 * the WebGL renderer and its Low/Medium/High swap, the materials, the world
 * build, the figures, the lighting with its per-floor lamps, which floors are
 * shown and the shade over the ones below, the iso and top camera framing,
 * and the frame loop. The lab (`labView.ts`) is a thin shell over it that adds
 * the benchmark and the HUD numbers; the 3D map stage (`grid/stage3d/`, P1)
 * will be another.
 *
 * Imperative on purpose, like the 2D stage: the owner pushes option changes in
 * through `update`, and everything per frame happens in here without touching
 * React.
 *
 * Rendering is on demand. A frame is drawn only when something asks for one:
 * an `update` that changed something, the orbit controls moving the camera,
 * the host being resized, a lighting re-pick falling due after the camera
 * moved, or a frame hook (`onBeforeFrame`) saying an animation is still
 * running. An idle view draws nothing, which matters on a TV left on for
 * hours and on a phone's battery. Anything that moves the camera or the scene
 * from outside calls `requestRender`.
 *
 * What lives where:
 *   - the WebGL renderer, the orbit controls and the lighting are bound to one
 *     canvas, and are rebuilt together when the quality crosses the Low line
 *     (antialiasing and the shadow map are fixed for a renderer's life, and
 *     Low turns both off);
 *   - the camera, the world meshes, the figures and the light list belong to
 *     the scene and survive a renderer swap untouched.
 *
 * What an `update` costs depends on what changed, and a scene arriving as a
 * new object is compared by content, not by identity (`sceneChange`). The
 * cheapest path that covers the change is taken:
 *   - a painted door opening or shutting flips that door's leaf in place
 *     (`BuiltWorld.setDoorOpen`), works out again the lights on that door's
 *     floor whose reach takes in the door (the sight of no other floor, and
 *     of nowhere else on it, changed), and draws again only the shadow maps
 *     its leaf can fall in;
 *   - painted tiles or arcs changing on some floors (a brush stroke, an
 *     erase, an arc bent, a stair) build again only the chunks of those
 *     floors that the change reaches (`BuiltWorld.applyTiles`); the lights on
 *     those floors whose reach takes in a square whose sight changed (a
 *     repainted ground or a rug changes none) are worked out again, the
 *     lighting drops the gone meshes and bakes the new ones for the lamps
 *     that reach them (`LabLighting.syncMeshes`), and only the shadow maps
 *     the changed squares fall in are drawn again;
 *   - the world is rebuilt whole (and its lighting made afresh) only when
 *     what all of it is built from changed: the grid's size or scale, a floor
 *     added or removed, the palette's content, or the walls option;
 *   - the lamps alone are refreshed on the same lighting (`setSources`: only
 *     lamps whose area changed are baked again) when the traced walls or
 *     doors or the GM's lights changed — only the lights the changed walls
 *     and doors can reach are worked out again — or a token's carried light
 *     moved, turned or changed, and then only the token lights are;
 *   - anything else in a scene (fog, pins, notes, zones, names) costs
 *     nothing here.
 * Working a light out again reads its floor's sight model, and listing a
 * floor's lights reads the whole floor; both are kept between changes — a
 * floor's model patched at the squares a tile edit or a door changed, given
 * the traced lines afresh when they change, and its lights listed again
 * only when one of them changed — so an edit never reads a whole floor
 * beyond what the world's own planning does.
 * Each door and tile edit logs what it cost at debug level (`[lab3d] edit`),
 * and the frame that shows it (`[lab3d] edit frame`); `info().lastEditMs`
 * keeps the last one's total.
 *
 * Nothing here is shared with the 2D map, and nothing in the 2D map changes
 * because this exists.
 */
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  FrontSide,
  Group,
  Light,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PCFSoftShadowMap,
  Scene as ThreeScene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Intersection,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Point, Scene, TileLayer, Token } from '@safehouse/contracts';
import {
  PROP_SIZE_M,
  lightPolygonsFor,
  lightSourcesFor,
  propCells,
  propStandsOnFootprint,
  sceneLevels,
  sightModelFor,
  type LayeredTiles,
  type LightRow,
  type LightSource,
  type SightCell,
  type SightModel,
  type TileProp,
} from '@safehouse/rules';
import type { TileDrawDef } from '../grid/types.js';
import { applyCover } from '../grid/stage3d/cover.js';
import { STOREY_M, createLabMaterials, storeyUnits, type LabMaterials } from './geometry3d.js';
import { buildFigure, disposeFigure, placeFigure, type FigureCtx } from './figure3d.js';
import { createLighting, type LabLighting, type LabLightSource, type LabQuality, type ShadowScope } from './lighting3d.js';
import { UPPER_SLAB, buildWorld, type BuiltWorld, type WorldPatch } from './world3d.js';

export type { LabQuality, ShadowScope } from './lighting3d.js';

/**
 * Iso is the 2D map's angle as a true orthographic camera; top is the 2D plan
 * view — straight down, north up, no tilting. Both orthographic: a
 * perspective lens was tried and dropped (2026-09-26 — not useful on a map).
 */
export type LabCamera = 'iso' | 'top';
/** What the floors below the one in view do: shaded (as the 2D map shades them), gone, or drawn as they are. */
export type LabBelow = 'dim' | 'hide' | 'show';
/** Walls at full height, or cut down so the rooms can be seen into (the world builder decides how). */
export type LabWalls = 'full' | 'cut';

/** Everything the runtime draws and how. `update` takes any subset of these. */
export interface Runtime3DOptions {
  scene: Scene;
  /**
   * The tokens on the map. Their carried lights light the scene whatever
   * `figures` says; with `figures` on they are also stood up as figures.
   */
  tokens: readonly Token[];
  /**
   * Whether the runtime builds a figure for each token itself (default
   * true, as the lab wants: every change to the tokens builds them all
   * again). A stage that runs its own figure pool passes false and still
   * passes the tokens: then a change to them costs nothing here unless a
   * token carrying a light moved, turned or changed that light, and even
   * then only the token lights are recomputed (`setSources`).
   */
  figures?: boolean;
  defs: Readonly<Record<string, TileDrawDef>>;
  quality: LabQuality;
  /**
   * The ambient light row to light with, already resolved: the owner turns
   * "the scene's own" into the scene's row before it gets here.
   */
  ambient: LightRow;
  walls: LabWalls;
  /**
   * The floor in view. Floors above it are hidden, with their figures and
   * their lights; floors below it are drawn as `below` says.
   */
  floor: number;
  below: LabBelow;
  camera: LabCamera;
}

/** How the runtime is wired to its owner, fixed for its life. */
export interface Runtime3DSetup {
  /**
   * Whether the orbit controls listen on the canvas (drag to turn, wheel to
   * zoom), as the lab wants. Default true. A stage that runs its own pointer
   * passes false: the controls then never touch the DOM and serve only as the
   * camera rig, their `target` being the point the view looks at and turns
   * about.
   */
  orbit?: boolean;
  /**
   * Called once if the browser takes the WebGL context away (a driver reset,
   * too many contexts open) — never for the runtime's own renderer swaps or
   * its dispose. With this set the loss is final: the runtime draws nothing
   * after it, and the owner should dispose it and fall back to something that
   * does not need the GPU context. Without it (the lab) the runtime waits out
   * the loss instead: when the browser gives the context back (a phone tab
   * brought back to the front), it redraws its shadows and carries on.
   */
  onContextLost?: () => void;
}

/** Light counts as the lighting reports them. */
export interface LabLightCounts {
  realtime: number;
  shadowed: number;
  baked: number;
}

/** One drawn frame, as the hooks after it see it. */
export interface FrameInfo {
  /** The frame's timestamp (the `requestAnimationFrame` clock, which is `performance.now()`'s). */
  now: number;
  /**
   * Time since the frame before it, when that frame asked for this one; 0 for
   * the first frame after the runtime sat idle, or after a renderer swap,
   * since that gap was no frame's cost.
   */
  dt: number;
  /** CPU time spent in this frame, from its start through submitting the draw calls, hooks included. */
  cpu: number;
  /** Draw calls and triangles in this frame, every pass included (shadow maps too). */
  drawCalls: number;
  triangles: number;
}

/**
 * Runs at the start of each frame, before the controls and the render, with
 * the frame's timestamp and `FrameInfo.dt`. Return true while something it
 * drives is still moving (a figure walking to its square, a benchmark orbit):
 * the runtime then draws another frame after this one.
 */
export type BeforeFrameHook = (now: number, dt: number) => boolean | void;
/** Runs after each frame is drawn, with what it cost. */
export type AfterFrameHook = (frame: FrameInfo) => void;

/** How the runtime is set up now, for a HUD or a report. */
export interface Runtime3DInfo {
  lights: LabLightCounts;
  /** How long the world took to build, and how many triangles it came to (kept up to date as tiles change). */
  worldBuildMs: number;
  worldTriangles: number;
  /**
   * The last painted door or tile edit's whole `update`, in ms: the world's
   * part of it, the lights worked out again, and the lighting brought in
   * line. 0 before the first. The frame that shows it is logged apart
   * (`[lab3d] edit frame`): its uploads and shadow passes are that frame's.
   */
  lastEditMs: number;
  /** How many painted door and tile edits there have been, so an owner can tell whether an `update` made one. */
  edits: number;
  /** The pixel ratio the renderer draws at, and the canvas size in CSS pixels. */
  pixelRatio: number;
  width: number;
  height: number;
  /** The GPU as WebGL names it (unmasked when the browser allows). */
  gpu: string;
  quality: LabQuality;
}

/** A running 3D runtime. Every method is a no-op after `dispose`. */
export interface Runtime3D {
  /** Change any options; only what actually changed is rebuilt, and a frame is drawn if anything did. */
  update(partial: Partial<Runtime3DOptions>): void;
  /** Ask for a frame: call after moving the camera or anything in the scene from outside. Cheap to call often. */
  requestRender(): void;
  /**
   * Draw the shadow maps again, and a frame to show them. Shadows are drawn
   * once where their lamp lands, not per frame: call this after moving,
   * adding or removing from outside anything that casts one. With `near`
   * (where it changed), only the maps that can have changed are drawn again
   * (`LabLighting.refreshShadows`); without it, every one.
   */
  refreshShadows(near?: ShadowScope): void;
  /** Put the camera back on the whole floor in view, at the current camera's framing. */
  reframe(): void;
  /**
   * The painted door whose shut leaf a ray met at `hit` on the floor in
   * view, as the cell of it the ray met (`"col,row"`); null when `hit` is on
   * no leaf (`BuiltWorld.doorOfHit`). So a pointer can take a door by the
   * leaf it sees rather than by the floor square under it — the pointer
   * casting its ray at everything standing there, so that a leaf behind a
   * wall is never what it meets first.
   */
  doorOfHit(hit: Intersection): string | null;
  /**
   * Compile, on this renderer and for this scene's lights, the shaders
   * `object`'s materials will be drawn with, without drawing it: a thing
   * first drawn later (a traced wall, a marker) then costs no compile on the
   * frame that shows it. Resolves when they are ready, or at once where
   * there is nothing to do; never rejects.
   */
  precompile(object: Object3D): Promise<void>;
  /**
   * Let the orbit controls drive the camera, or stop them (a benchmark flying
   * the camera itself). Holds across renderer swaps.
   */
  setOrbitEnabled(on: boolean): void;
  /** Add a hook run before every frame; returns its removal. */
  onBeforeFrame(hook: BeforeFrameHook): () => void;
  /** Add a hook run after every frame; returns its removal. */
  onAfterFrame(hook: AfterFrameHook): () => void;
  info(): Runtime3DInfo;
  /** The options as they stand, after every `update`. */
  readonly options: Readonly<Runtime3DOptions>;
  /** The one camera, orthographic, serving both iso and top. It survives renderer swaps. */
  readonly camera: OrthographicCamera;
  /** The three.js scene graph everything is drawn from. */
  readonly threeScene: ThreeScene;
  /**
   * The canvas being drawn into. It is replaced when the quality crosses the
   * Low line, so listen for input on the host rather than on this.
   */
  readonly canvas: HTMLCanvasElement;
  /** The orbit controls: the camera rig, whose `target` is the point in view. Replaced with the renderer. */
  readonly controls: OrbitControls;
  /** One storey's height in world units (a world unit is one grid square). */
  readonly storey: number;
  /** The floor in view (`options.floor`). */
  readonly floor: number;
  dispose(): void;
}

/** A near-black blue, the app's ground colour, so the canvas edge disappears into the page. */
const BACKGROUND = 0x060a12;
/** The iso camera sits south-east of the map, as the 2D iso map is drawn: x runs down-right, y down-left. */
const ISO_AZIMUTH = Math.PI / 4;
/** True isometric: the angle whose tangent is 1/√2, 35.264°. */
const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);
/**
 * The top view's tilt off straight down, in radians: exactly vertical has no
 * "up" to orient the screen by, so it sits a hair south of the zenith, which
 * keeps north at the top of the screen as the 2D plan does.
 */
const TOP_TILT = 1e-3;
/**
 * How dark the floors below the one in view are, per floor down: a
 * see-through slab of shade laid over each one, as the 2D map lays a
 * quarter-shade over each floor it shows through the open squares. One floor
 * down is clearly "down there"; two floors down is nearly gone.
 */
const BELOW_SHADE = 0.5;
/** How often, at most, the lighting re-picks its real-time lights around the orbit target. */
const LIGHT_PICK_MS = 250;
/**
 * How far (squared, in squares) the orbit target must drift from where the
 * lamps were last picked before a re-pick is worth a frame. The controls'
 * damping never quite stops moving the target, so without this the view would
 * never go idle.
 */
const PICK_DRIFT_SQ = 1e-4;

const NO_LIGHTS: LabLightCounts = { realtime: 0, shadowed: 0, baked: 0 };

function pixelRatioFor(q: LabQuality): number {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  return Math.min(dpr, q === 'low' ? 1 : 2);
}

/** The GPU's name: the unmasked renderer string when the browser offers it, else whatever WebGL says. */
function gpuName(renderer: WebGLRenderer): string {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof name === 'string' && name.length > 0 ? name : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Every floor index a scene has, ground first. */
function floorIndices(scene: Scene): number[] {
  return sceneLevels(scene).map((_, i) => i);
}

// --- what changed in a scene ---------------------------------------------------

/** Two pieces of plain (JSON-shaped) data with the same content, however they were made. */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!sameData(a[i], b[i])) return false;
    return true;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra);
  if (ka.length !== Object.keys(rb).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(rb, k) || !sameData(ra[k], rb[k])) return false;
  }
  return true;
}

/** One floor's painted tiles as the world reads them: everything but the doors' open and locked state. */
function sameTilesButDoors(a: object | undefined, b: object | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (k !== 'doors' && !sameData(ra[k], rb[k])) return false;
  }
  return true;
}

/** The cells of one floor whose painted door stands open. */
function openDoorCells(tiles: object | undefined): Set<string> {
  const doors = (tiles as { doors?: Record<string, { open?: boolean } | undefined> } | undefined)?.doors;
  const out = new Set<string>();
  for (const [cell, d] of Object.entries(doors ?? {})) if (d?.open === true) out.add(cell);
  return out;
}

/** A painted door that opened or shut. */
interface DoorFlip {
  level: number;
  cell: string;
  open: boolean;
}

/** A traced wall or door as the line it stands on, grid units. */
interface Segment {
  a: Point;
  b: Point;
}

/** How a new version of a scene differs from the last, by what the runtime has to do about it. */
interface SceneChange {
  /**
   * What the whole world is built from changed: the grid's size or scale
   * (not its offset, opacity or projection, which the world never reads) or
   * the number of floors. The world is rebuilt.
   */
  world: boolean;
  /**
   * The floors whose painted tiles or arcs changed (anything of them but
   * their doors' open state), each brought up to date in place
   * (`BuiltWorld.applyTiles`); empty when `world`.
   */
  tiles: readonly number[];
  /** Painted doors that opened or shut, on any floor; empty when `world`. */
  doors: readonly DoorFlip[];
  /** What the lamps read besides the tiles changed: traced walls, traced doors (where and whether open), the GM's lights. */
  lights: boolean;
  /** Of that, the traced walls and doors that came, went, moved, opened or shut: where they stood, and where they stand. */
  segments: readonly Segment[];
}

const SAME_SCENE: SceneChange = { world: false, tiles: [], doors: [], lights: false, segments: [] };

/**
 * Where the sight changed since the lights were last worked out, so that a
 * light whose reach takes in none of it is handed on as it was
 * (`relight`): per floor, the squares whose tiles changed (null: the whole
 * floor; a floor not in the map: none), and the traced walls and doors that
 * changed, which stand on every floor.
 */
interface Touch {
  cells: ReadonlyMap<number, ReadonlySet<string> | null>;
  segments: readonly Segment[];
}

/**
 * How far past a light's reach, in squares, a change still counts as
 * touching it: the rules stand a piece of furniture on squares its tile is
 * not stored in, and the changed squares are the tiles'.
 */
const TOUCH_MARGIN = 1;

type Stale = (s: LightSource) => boolean;
const ALL_STALE: Stale = () => true;
const NONE_STALE: Stale = () => false;

/** Distance squared from (x, y) to a segment, grid units. */
function segmentDistance2(x: number, y: number, s: Segment): number {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - s.a.x) * dx + (y - s.a.y) * dy) / len2)) : 0;
  const px = s.a.x + dx * t - x;
  const py = s.a.y + dy * t - y;
  return px * px + py * py;
}

/**
 * Which lights on floor `level` a change (`Touch`) may have touched: those
 * whose reach, with `TOUCH_MARGIN`, takes in a changed square or comes
 * within reach of a changed traced wall or door. Every light when nothing is
 * known of the change.
 */
function staleOn(level: number, touch: Touch | null): Stale {
  if (touch === null) return ALL_STALE;
  const cells = touch.cells.get(level);
  if (cells === null) return ALL_STALE;
  const squares: number[] = [];
  for (const key of cells ?? []) {
    const [col, row] = key.split(',').map(Number);
    if (col === undefined || row === undefined || !Number.isFinite(col) || !Number.isFinite(row)) continue;
    squares.push(col, row);
  }
  const segments = touch.segments;
  if (squares.length === 0 && segments.length === 0) return NONE_STALE;
  return (s) => {
    const r = s.radius + TOUCH_MARGIN;
    const r2 = r * r;
    const { x, y } = s.at;
    for (let i = 0; i + 1 < squares.length; i += 2) {
      const col = squares[i]!;
      const row = squares[i + 1]!;
      const dx = Math.max(col - x, 0, x - (col + 1));
      const dy = Math.max(row - y, 0, y - (row + 1));
      if (dx * dx + dy * dy <= r2) return true;
    }
    for (const seg of segments) if (segmentDistance2(x, y, seg) <= r2) return true;
    return false;
  };
}

/** Traced doors as light reads them: where each is, and whether it is open (not its lock or note). */
function sameTracedDoors(a: Scene['geometry']['doors'] | undefined, b: Scene['geometry']['doors'] | undefined): boolean {
  if (a === b) return true;
  const la = a ?? [];
  const lb = b ?? [];
  if (la.length !== lb.length) return false;
  for (let i = 0; i < la.length; i += 1) {
    const d = la[i]!;
    const e = lb[i]!;
    if (d.id !== e.id || (d.open === true) !== (e.open === true) || !sameData(d.a, e.a) || !sameData(d.b, e.b)) return false;
  }
  return true;
}

/**
 * The traced walls and doors that came, went, moved, opened or shut between
 * two versions of a scene's geometry, where they stood and where they stand.
 * Lines with the same id twice cannot be matched: then every one counts.
 */
function changedSegments(ga: Scene['geometry'] | undefined, gb: Scene['geometry'] | undefined): Segment[] {
  const out: Segment[] = [];
  const diff = <T extends { id: string; a: Point; b: Point }>(la: readonly T[], lb: readonly T[], same: (x: T, y: T) => boolean) => {
    const was = new Map(la.map((s) => [s.id, s]));
    if (was.size !== la.length) {
      for (const s of [...la, ...lb]) out.push({ a: s.a, b: s.b });
      return;
    }
    for (const s of lb) {
      const old = was.get(s.id);
      was.delete(s.id);
      if (old !== undefined && same(old, s)) continue;
      out.push({ a: s.a, b: s.b });
      if (old !== undefined) out.push({ a: old.a, b: old.b });
    }
    for (const old of was.values()) out.push({ a: old.a, b: old.b });
  };
  const at = (x: { a: Point; b: Point }, y: { a: Point; b: Point }) => sameData(x.a, y.a) && sameData(x.b, y.b);
  diff(ga?.walls ?? [], gb?.walls ?? [], at);
  diff(ga?.doors ?? [], gb?.doors ?? [], (x, y) => (x.open === true) === (y.open === true) && at(x, y));
  return out;
}

/** The traced walls and shut doors as every floor's sight model holds them (`sightModelFor`'s segments, which read nothing else). */
function tracedSegments(scene: Scene): SightModel['segments'] {
  return sightModelFor({ geometry: scene.geometry }, 0).segments;
}

/** The floors whose GM lights (`geometry.lights`) differ between two versions of a scene's geometry. */
function gmLightFloors(ga: Scene['geometry'] | undefined, gb: Scene['geometry'] | undefined): Set<number> {
  const out = new Set<number>();
  const la: ReadonlyArray<{ level?: number | undefined }> = ga?.lights ?? [];
  const lb: ReadonlyArray<{ level?: number | undefined }> = gb?.lights ?? [];
  if (la === lb) return out;
  const byFloor = (list: ReadonlyArray<{ level?: number | undefined }>) => {
    const floors = new Map<number, unknown[]>();
    for (const l of list) {
      const level = l.level ?? 0;
      const on = floors.get(level);
      if (on === undefined) floors.set(level, [l]);
      else on.push(l);
    }
    return floors;
  };
  const a = byFloor(la);
  const b = byFloor(lb);
  for (const level of new Set([...a.keys(), ...b.keys()])) if (!sameData(a.get(level), b.get(level))) out.add(level);
  return out;
}

/** Two sight entries that say the same, or both absent (open floor). */
function sameSightCell(a: SightCell | undefined, b: SightCell | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.blocksSight === b.blocksSight && a.givesCover === b.givesCover && a.blocksMovement === b.blocksMovement && a.height === b.height
  );
}

/** `propReach`, by metres per square. */
const propReaches = new Map<number, { across: number; down: number }>();

/**
 * How many squares past its anchor, right and down, a piece of furniture can
 * stand on a grid of `unitM` metres a square — the biggest design's
 * footprint less its anchor (`propCells`) — so that every anchor whose
 * furniture can stand on a square lies within that far of it, left and up.
 * What hangs overhead stands on its anchor alone (`propStandsOnFootprint`).
 */
function propReach(unitM: number): { across: number; down: number } {
  let reach = propReaches.get(unitM);
  if (reach === undefined) {
    let across = 0;
    let down = 0;
    for (const prop of Object.keys(PROP_SIZE_M) as TileProp[]) {
      if (!propStandsOnFootprint(prop)) continue;
      const [w, d] = propCells(prop, unitM);
      across = Math.max(across, w - 1);
      down = Math.max(down, d - 1);
    }
    reach = { across, down };
    propReaches.set(unitM, reach);
  }
  return reach;
}

/**
 * The part of a floor's painted tiles on the squares from (`c0`, `r0`) to
 * (`c1`, `r1`), every layer and the doors' state, with all its arcs (an arc
 * is in every square it crosses): what the rules read of the floor for
 * those squares, and for any square whose tiles all lie within them.
 */
function windowOf(tiles: LayeredTiles, c0: number, r0: number, c1: number, r1: number): LayeredTiles {
  const cells: Record<string, string> = {};
  const ground: Record<string, string> = {};
  const structure: Record<string, string> = {};
  const object: Record<string, string> = {};
  const doors: NonNullable<LayeredTiles['doors']> = {};
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const key = `${col},${row}`;
      const c = tiles.cells?.[key];
      if (c !== undefined) cells[key] = c;
      const g = tiles.ground?.[key];
      if (g !== undefined) ground[key] = g;
      const s = tiles.structure?.[key];
      if (s !== undefined) structure[key] = s;
      const o = tiles.object?.[key];
      if (o !== undefined) object[key] = o;
      const d = tiles.doors?.[key];
      if (d !== undefined) doors[key] = d;
    }
  }
  return {
    tilesetId: tiles.tilesetId,
    ...(tiles.cells !== undefined ? { cells } : {}),
    ground,
    structure,
    object,
    ...(tiles.doors !== undefined ? { doors } : {}),
    ...(tiles.arcs !== undefined ? { arcs: tiles.arcs } : {}),
  };
}

/** Compare two versions of a scene (`SceneChange`). */
function sceneChange(a: Scene, b: Scene): SceneChange {
  const ga = a.geometry;
  const gb = b.geometry;
  const lights =
    ga !== gb &&
    !(sameData(ga?.walls, gb?.walls) && sameTracedDoors(ga?.doors, gb?.doors) && sameData(ga?.lights, gb?.lights));
  const segments = lights ? changedSegments(ga, gb) : [];

  const la = sceneLevels(a);
  const lb = sceneLevels(b);
  const world =
    a.grid.cols !== b.grid.cols || a.grid.rows !== b.grid.rows || a.grid.unitM !== b.grid.unitM || la.length !== lb.length;
  if (world) return { world, tiles: [], doors: [], lights, segments };

  const tiles: number[] = [];
  const doors: DoorFlip[] = [];
  lb.forEach((l, level) => {
    const before = la[level]?.tiles as { doors?: unknown } | undefined;
    const after = l.tiles as { doors?: unknown } | undefined;
    if (!sameTilesButDoors(before, after)) tiles.push(level);
    if (before?.doors === after?.doors) return;
    const was = openDoorCells(before);
    const now = openDoorCells(after);
    for (const cell of now) if (!was.has(cell)) doors.push({ level, cell, open: true });
    for (const cell of was) if (!now.has(cell)) doors.push({ level, cell, open: false });
  });
  return { world, tiles, doors, lights, segments };
}

/**
 * Everything the token-carried lights depend on, as one string: each token
 * whose light is on, the floor it is on, where it stands (and faces, for a
 * beam), and the light itself. Token lists with the same key light the
 * scene the same; a token without a light never changes it.
 */
function tokenLightKey(list: readonly Token[]): string {
  const parts: string[] = [];
  for (const t of list) {
    const l = t.light;
    if (!l || l.on === false) continue;
    const beam = l.fov !== undefined;
    parts.push(
      [t.id, t.level ?? 0, t.x, t.y, l.radiusM, l.rows ?? '', l.color ?? '', beam ? l.fov : '', beam ? (t.rotation ?? 0) : ''].join('|'),
    );
  }
  return parts.sort().join('\n');
}

/**
 * Mount the runtime into `host` (which should be positioned and sized; the
 * canvas fills it) and draw the first frame. Throws if WebGL or a builder
 * fails, so the owner can say so or fall back.
 */
export function createRuntime3D(host: HTMLElement, initial: Runtime3DOptions, setup: Runtime3DSetup = {}): Runtime3D {
  let opts: Runtime3DOptions = { ...initial };
  let disposed = false;
  let contextLost = false;
  const orbit = setup.orbit ?? true;
  let orbitEnabled = true;

  const scene3 = new ThreeScene();
  scene3.background = new Color(BACKGROUND);
  const materials: LabMaterials = createLabMaterials();

  const figures = new Group();
  figures.name = 'lab-figures';
  scene3.add(figures);
  /** The shade over the floors below the one in view (`applyFloorVisibility`). */
  const shades = new Group();
  shades.name = 'lab-below-shade';
  scene3.add(shades);
  const shadeMaterial = new MeshBasicMaterial({
    color: BACKGROUND,
    transparent: true,
    opacity: BELOW_SHADE,
    depthWrite: false,
    side: FrontSide,
  });
  // Over the floors below, under a viewer's fog and shroud like them.
  applyCover(shadeMaterial, 'full');

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  /** Which way the camera looks: the ortho camera serves both iso and top. */
  let cameraKind: LabCamera = opts.camera;
  /** Half the ortho camera's view height at zoom 1, in world units. */
  let viewHalf = 10;
  let aspect = 1;
  let width = 1;
  let height = 1;

  let world: BuiltWorld | null = null;
  let storey = storeyUnits(opts.scene.grid.unitM);
  /** The tokens as the runtime stands them (`standTokens`): every one on a floor the scene has. */
  let tokens: Token[] = [];
  /** `tokenLightKey` of `tokens`: what the token lights were last computed from. */
  let tokenLights = '';
  /** Per floor, the scene's own lights (tiles and the GM's) and the tokens' (`collectFixedOn`, `collectTokenLightsOn`). */
  const fixedByLevel = new Map<number, LabLightSource[]>();
  const tokenByLevel = new Map<number, LabLightSource[]>();
  /** Every light on every floor: every floor's fixed lights, then every floor's token lights. */
  let sources: LabLightSource[] = [];
  /**
   * Each floor's sight model, which is what cuts a light's area: made whole
   * with a new world, and otherwise kept — patched where a floor's tiles or
   * doors change (`patchFloor`), its traced lines put in afresh when those
   * change.
   */
  const sightModels = new Map<number, SightModel>();
  /**
   * Each floor's own lights as the rules list them (`lightSourcesFor`: its
   * glowing tiles and the GM's lamps on it), kept until a light among them
   * comes, goes or changes (`patchFloor`, `gmLightFloors`): listing them
   * reads the whole floor.
   */
  const ownSources = new Map<number, LightSource[]>();
  let lighting: LabLighting | null = null;
  /** `Runtime3DInfo.lastEditMs` and `edits`. */
  let lastEditMs = 0;
  let edits = 0;
  /** An edit was made since the last frame: that frame's cost is logged with it. */
  let editFrame = false;
  /** How many lights `relight` worked out again since this was last zeroed (for the edit log). */
  let workedOut = 0;

  // The frame loop's state. `raf` is the pending frame, 0 when none is.
  const beforeHooks = new Set<BeforeFrameHook>();
  const afterHooks = new Set<AfterFrameHook>();
  let raf = 0;
  let lastFrame = 0;
  let lastLightPick = -Infinity;
  /** Where the orbit target was when the lamps were last picked. */
  const pickedAt = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  /** A frame booked for when a throttled lamp re-pick falls due. */
  let pickTimer: ReturnType<typeof setTimeout> | null = null;

  let renderer = makeRenderer(opts.quality);
  let rendererLow = opts.quality === 'low';
  let gpu = gpuName(renderer);
  let controls = makeControls(new Vector3(opts.scene.grid.cols / 2, 0, opts.scene.grid.rows / 2));

  // --- building ------------------------------------------------------------

  function onContextLost(): void {
    if (disposed || contextLost) return;
    contextLost = true;
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    // The wait for the context is no frame's cost.
    lastFrame = 0;
    setup.onContextLost?.();
  }

  /**
   * The browser gave the context back. three has already set its GPU state up
   * again (its own handler ran first, and asked for this by cancelling the
   * loss); the shadow maps are drawn only when asked, so they are asked for
   * again, and a frame is drawn. An owner told of the loss has taken it as
   * final, so nothing resumes for it.
   */
  function onContextRestored(): void {
    if (disposed || !contextLost || setup.onContextLost) return;
    contextLost = false;
    scene3.traverse((o) => {
      if (o instanceof Light && o.shadow) o.shadow.needsUpdate = true;
    });
    requestRender();
  }

  function makeRenderer(q: LabQuality): WebGLRenderer {
    const r = new WebGLRenderer({ antialias: q !== 'low', powerPreference: 'high-performance' });
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.shadowMap.enabled = q !== 'low';
    r.shadowMap.type = PCFSoftShadowMap;
    // Reset by hand at the start of each frame, so the counts cover every
    // render call in it (the shadow maps as well) rather than the last.
    r.info.autoReset = false;
    r.setPixelRatio(pixelRatioFor(q));
    const c = r.domElement;
    c.style.display = 'block';
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.touchAction = 'none';
    c.addEventListener('webglcontextlost', onContextLost);
    c.addEventListener('webglcontextrestored', onContextRestored);
    host.appendChild(c);
    return r;
  }

  /** Let a renderer go: its context is dropped on purpose, so that is not reported as a loss. */
  function dropRenderer(r: WebGLRenderer): void {
    r.domElement.removeEventListener('webglcontextlost', onContextLost);
    r.domElement.removeEventListener('webglcontextrestored', onContextRestored);
    r.dispose();
    r.forceContextLoss();
    r.domElement.remove();
  }

  /**
   * Let a set of controls go. Controls made without an element (`orbit:
   * false`) are left undisposed: three's `dispose` is `disconnect`, which
   * reads the element unguarded and throws on null, and there is nothing
   * connected to undo. That throw used to escape from a camera switch, a
   * renderer swap and the teardown, leaving the renderer's context alive.
   */
  function dropControls(c: OrbitControls): void {
    c.removeEventListener('change', requestRender);
    if (c.domElement !== null) c.dispose();
  }

  function makeControls(target: Vector3): OrbitControls {
    const c = new OrbitControls(camera, orbit ? renderer.domElement : null);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    // Pan across the floor, the way a map is dragged, not across the screen.
    c.screenSpacePanning = false;
    c.maxPolarAngle = Math.PI / 2 - 0.02;
    c.minZoom = 0.25;
    c.maxZoom = 24;
    c.minDistance = 2;
    c.maxDistance = sceneBox().radius * 8;
    // Pan and zoom only, never tilt or turn: the GM wants a fixed view
    // (2026-09-26). The benchmark's orbit moves the camera itself.
    c.enableRotate = false;
    if (cameraKind === 'top') {
      c.minPolarAngle = TOP_TILT;
      c.maxPolarAngle = TOP_TILT;
    }
    c.enabled = orbitEnabled;
    c.target.copy(target);
    c.update();
    // Every camera move the controls make (a drag, the wheel, damping
    // settling) asks for the frame that shows it.
    c.addEventListener('change', requestRender);
    return c;
  }

  function rebuildWorld(): void {
    lighting?.dispose();
    lighting = null;
    if (world) {
      world.dispose();
      world.group.removeFromParent();
      world = null;
    }
    world = buildWorld(opts.scene, opts.defs, materials, {
      storeyM: STOREY_M,
      walls: opts.walls,
      levels: floorIndices(opts.scene),
    });
    storey = world.storey;
    scene3.add(world.group);
  }

  /**
   * The owner's tokens, each on a floor the scene has. One left on a floor
   * the GM has since removed stands on the top floor, as `levelTiles` clamps
   * it, rather than floating over the roof with its light on no floor at
   * all. Figures and token lights both read this list, so they agree.
   */
  function standTokens(): Token[] {
    const top = floorIndices(opts.scene).length - 1;
    return opts.tokens.map((t) => {
      const level = t.level ?? 0;
      const on = Math.min(Math.max(0, Number.isFinite(level) ? Math.floor(level) : 0), top);
      return on === level ? t : { ...t, level: on };
    });
  }

  /** Every token as a figure, or none when the owner runs its own (`figures: false`). */
  function rebuildFigures(): void {
    for (const child of [...figures.children]) disposeFigure(child as Group);
    if (opts.figures === false) return;
    const ctx: FigureCtx = { unitM: opts.scene.grid.unitM > 0 ? opts.scene.grid.unitM : 1, storey };
    for (const token of tokens) {
      // One token the figure builder cannot make sense of costs that figure, not the view.
      try {
        const g = buildFigure(token, materials, ctx);
        placeFigure(g, token, ctx);
        g.userData.level = token.level ?? 0;
        figures.add(g);
      } catch (err) {
        console.warn(`[lab3d] token ${token.id} could not be built as a figure`, err);
      }
    }
  }

  /** Floor `level`'s sight model, made when first asked for and kept (`sightModels`). */
  function sightModelOf(level: number): SightModel {
    let model = sightModels.get(level);
    if (model === undefined) {
      model = sightModelFor(opts.scene, level);
      sightModels.set(level, model);
    }
    return model;
  }

  /** Floor `level`'s own lights, listed when first asked for and kept (`ownSources`). */
  function ownSourcesOf(level: number): LightSource[] {
    let list = ownSources.get(level);
    if (list === undefined) {
      list = lightSourcesFor(opts.scene, level);
      ownSources.set(level, list);
    }
    return list;
  }

  /**
   * Floor `level`'s tiles changed from `before` to `after` at `squares`
   * (`WorldPatch.cells`, and the cells of the painted doors that opened or
   * shut): bring what is kept of the floor's light in line — its sight model,
   * patched at those squares rather than made again, and its own lights,
   * dropped only when a light among those squares came, went or changed —
   * and say which of the squares now stop or cover a sightline differently
   * (empty: none, and the model stands as it was) and whether the lights
   * changed. Null when the change cannot be taken square by square — the
   * floor's tileset or its arcs changed, or the change spreads over half the
   * floor — and then the floor's model and lights are dropped, to be made
   * again whole.
   *
   * A square's sight comes from the tiles round it alone: its own layers and
   * door, the arcs through it, and the furniture standing on it, anchored at
   * most `propReach` squares left and up of it. So the rules' model of a
   * window of the floor (`windowOf`) reaching that far past the squares,
   * before and after, says exactly what those squares were and are; the
   * floor's lights among them are compared from the same windows.
   */
  function patchFloor(
    level: number,
    before: LayeredTiles | undefined,
    after: LayeredTiles | undefined,
    squares: ReadonlySet<string>,
  ): { sight: Set<string>; lights: boolean } | null {
    const drop = (): null => {
      sightModels.delete(level);
      ownSources.delete(level);
      return null;
    };
    if (before === undefined || after === undefined || before.tilesetId !== after.tilesetId || !sameData(before.arcs, after.arcs)) {
      return drop();
    }
    let c0 = Infinity;
    let r0 = Infinity;
    let c1 = -Infinity;
    let r1 = -Infinity;
    for (const key of squares) {
      const [col, row] = key.split(',').map(Number);
      if (col === undefined || row === undefined || !Number.isFinite(col) || !Number.isFinite(row)) continue;
      c0 = Math.min(c0, col);
      r0 = Math.min(r0, row);
      c1 = Math.max(c1, col);
      r1 = Math.max(r1, row);
    }
    if (c0 > c1) return { sight: new Set(), lights: false };
    const grid = { unitM: opts.scene.grid.unitM };
    const reach = propReach(grid.unitM);
    c0 -= reach.across;
    r0 -= reach.down;
    if ((c1 - c0 + 1) * (r1 - r0 + 1) * 2 > opts.scene.grid.cols * opts.scene.grid.rows) return drop();

    const was = windowOf(before, c0, r0, c1, r1);
    const now = windowOf(after, c0, r0, c1, r1);
    const seenBefore = sightModelFor({ tiles: was, grid }, 0).cells;
    const seenAfter = sightModelFor({ tiles: now, grid }, 0).cells;
    const sight = new Set<string>();
    for (const key of squares) if (!sameSightCell(seenBefore.get(key), seenAfter.get(key))) sight.add(key);
    const model = sightModels.get(level);
    if (model !== undefined && sight.size > 0) {
      const cells = new Map(model.cells);
      for (const key of squares) {
        const cell = seenAfter.get(key);
        if (cell === undefined) cells.delete(key);
        else cells.set(key, cell);
      }
      sightModels.set(level, { cells, segments: model.segments });
    }
    const lights = !sameData(lightSourcesFor({ tiles: was, grid }, 0), lightSourcesFor({ tiles: now, grid }, 0));
    if (lights) ownSources.delete(level);
    return { sight, lights };
  }

  /** Lights as the lighting takes them: the area each reaches, and lifted to its lamp's height. */
  function lift(level: number, lit: ReturnType<typeof lightPolygonsFor>, out: LabLightSource[]): void {
    for (const { source, points } of lit) out.push({ level, y: (level + source.height) * storey, source, polygon: points });
  }

  /**
   * `sources`' lights on floor `level`, as the lighting takes them. A light
   * whose source is the same as in `prev` and which `stale` says the change
   * cannot have touched is handed on as it was — the same object, so the
   * lighting keeps its lamp and bake without a look; the rest are worked out
   * again (`lightPolygonsFor`), in one call against the floor's sight model.
   */
  function relight(
    level: number,
    list: readonly LightSource[],
    prev: readonly LabLightSource[] | undefined,
    stale: Stale,
  ): LabLightSource[] {
    if (list.length === 0) return [];
    const was = new Map<string, LabLightSource>();
    for (const l of prev ?? []) was.set(l.source.id, l);
    const kept: Array<LabLightSource | null> = [];
    const again: LightSource[] = [];
    for (const s of list) {
      const old = was.get(s.id);
      if (old !== undefined && !stale(s) && sameData(old.source, s)) {
        kept.push(old);
      } else {
        kept.push(null);
        again.push(s);
      }
    }
    if (again.length === 0) return kept as LabLightSource[];
    workedOut += again.length;
    const fresh: LabLightSource[] = [];
    lift(level, lightPolygonsFor(opts.scene, level, { sources: again, model: sightModelOf(level) }), fresh);
    let k = 0;
    return kept.map((l) => l ?? fresh[k++]!);
  }

  /** The scene's own lights on floor `level` — its glowing tiles and the GM's lamps — without the tokens'. */
  function collectFixedOn(level: number, stale: Stale): LabLightSource[] {
    return relight(level, ownSourcesOf(level), fixedByLevel.get(level), stale);
  }

  /**
   * The lights the tokens carry on floor `level`. Their sources are read
   * from the tokens alone (a scene with nothing but its grid, for the
   * metres), so the scene's own lights are not recomputed with them.
   */
  function collectTokenLightsOn(level: number, stale: Stale): LabLightSource[] {
    if (tokenLights === '') return [];
    return relight(level, lightSourcesFor({ grid: opts.scene.grid }, level, tokens), tokenByLevel.get(level), stale);
  }

  /**
   * Work the lights out again, and say whether anything was. `fixed` is
   * where the scene's own lights changed: on every floor (true — a new
   * world, or the traced walls, traced doors or the GM's lamps, which stand
   * on every floor), on these floors only (painted tiles changed or a
   * painted door opened or shut there, and the sight of no other floor
   * changed), or nowhere (false). `carried` is whether the tokens' lights
   * changed: they are then worked out on every floor, and otherwise only on
   * the floors whose sight did.
   *
   * `touch` says where the sight changed (`Touch`): on a floor it names, a
   * light whose reach takes in none of it and whose source is unchanged is
   * kept as it was. Null when nothing is known of it (a new world): every
   * floor's sight model and own lights are made again, and every light on
   * every floor worked out again. Otherwise the caller has already brought
   * the kept models and light lists in line with the change (`patchFloor`).
   * A floor not asked about keeps its lights as they were — the same
   * objects, so the lighting keeps their lamps too.
   */
  function collectSources(fixed: boolean | ReadonlySet<number>, carried: boolean, touch: Touch | null = null): boolean {
    const all = floorIndices(opts.scene);
    let redo: number[];
    if (fixed === true) {
      if (touch === null) {
        sightModels.clear();
        ownSources.clear();
        fixedByLevel.clear();
        tokenByLevel.clear();
      }
      redo = all;
    } else if (fixed === false) {
      redo = [];
    } else {
      redo = all.filter((level) => fixed.has(level));
    }
    const sightChanged = new Set(redo);
    for (const level of redo) fixedByLevel.set(level, collectFixedOn(level, staleOn(level, touch)));
    // Where the sight did not change, a token light is kept whenever its source is.
    const relit = carried ? all : redo;
    for (const level of relit) {
      tokenByLevel.set(level, collectTokenLightsOn(level, sightChanged.has(level) ? staleOn(level, touch) : NONE_STALE));
    }
    if (redo.length === 0 && relit.length === 0) return false;
    sources = [...all.flatMap((level) => fixedByLevel.get(level) ?? []), ...all.flatMap((level) => tokenByLevel.get(level) ?? [])];
    return true;
  }

  /**
   * Where the painted doors that just flipped stand, for the shadow
   * refresh: the middle of every square of each leaf a flipped cell belongs
   * to, half a storey up, and how far a leaf reaches from there.
   */
  function doorScope(flips: readonly DoorFlip[]): ShadowScope {
    const points: Array<{ x: number; y: number; z: number }> = [];
    for (const flip of flips) {
      const lv = world?.levels.find((l) => l.level === flip.level);
      const cells = new Set<string>([flip.cell]);
      for (const d of lv?.doors ?? []) if (d.cells.includes(flip.cell)) for (const c of d.cells) cells.add(c);
      for (const cell of cells) {
        const [col, row] = cell.split(',').map(Number);
        if (col === undefined || row === undefined || !Number.isFinite(col) || !Number.isFinite(row)) continue;
        points.push({ x: col + 0.5, y: (lv?.y ?? flip.level * storey) + storey / 2, z: row + 0.5 });
      }
    }
    // A leaf stands inside its square, from the floor up to under a storey.
    return { points, radius: Math.hypot(Math.SQRT1_2, storey / 2) + 0.05 };
  }

  /**
   * Where painted tiles that changed stand, for the shadow refresh: the
   * middle of every square a patch changed (`WorldPatch.cells`), half a
   * storey up, reaching over the squares round it — whose builds read it
   * (world3d's `reachOf`) — and up past a storey (a tree's crown). Not the
   * chunks the patch built again: a chunk's other squares were built the
   * same, and cast the same shadows. Undefined when a patch built its floor
   * whole: its meshes then say where (`LabLighting.syncMeshes`).
   */
  function patchScope(list: readonly WorldPatch[]): ShadowScope | undefined {
    const points: Array<{ x: number; y: number; z: number }> = [];
    for (const p of list) {
      if (p.cells === null) return undefined;
      const y = (world?.levels.find((l) => l.level === p.level)?.y ?? p.level * storey) + storey / 2;
      for (const key of p.cells) {
        const [col, row] = key.split(',').map(Number);
        if (col === undefined || row === undefined || !Number.isFinite(col) || !Number.isFinite(row)) continue;
        points.push({ x: col + 0.5, y, z: row + 0.5 });
      }
    }
    return { points, radius: Math.hypot(1.5 * Math.SQRT2, storey * 0.6) + 0.05 };
  }

  /**
   * The lights on show. Lights on hidden floors are left out rather than
   * left on: a hidden slab casts no shadow, so a lamp upstairs would
   * otherwise pour straight down into the room below.
   */
  function shownSources(): LabLightSource[] {
    return sources.filter((s) => floorShown(s.level));
  }

  /**
   * The lighting for what is on show, made afresh at the quality and around
   * the point in view, so it is built once (`createLighting`).
   *
   * Call it after `applyFloorVisibility`: the lighting picks its real-time
   * lamps from the highest floor it finds visible, as soon as it is made.
   */
  function rebuildLighting(): void {
    lighting?.dispose();
    lighting = null;
    if (!world) return;
    lighting = createLighting({
      scene: scene3,
      renderer,
      world,
      sources: shownSources(),
      ambientRow: opts.ambient,
      storey,
      quality: opts.quality,
      focus: controls.target,
    });
    pickedAt.copy(controls.target);
    lastLightPick = performance.now();
  }

  /** Is floor `level` drawn, with the floor in view and what is below it as they are? */
  function floorShown(level: number): boolean {
    if (level > opts.floor) return false;
    return level === opts.floor || opts.below !== 'hide';
  }

  /**
   * Floors above the one in view go; floors below stay, under a shade per
   * floor down (`BELOW_SHADE`), so the floor in view is plainly the one lit
   * and everything seen through its open squares is plainly beneath it.
   *
   * The shade is a see-through box over the map's footprint from the ground
   * to just under each upper floor's slab: its lid darkens what is seen down
   * through the open squares, its sides what is seen of the lower storeys
   * from outside the building. The boxes nest, so two floors down is shaded
   * twice.
   */
  function applyFloorVisibility(): void {
    if (world) {
      for (const lv of world.levels) {
        const show = floorShown(lv.level);
        for (const b of lv.built) for (const o of b.all) o.visible = show;
      }
    }
    for (const f of figures.children) {
      const level = typeof f.userData.level === 'number' ? f.userData.level : 0;
      f.visible = floorShown(level);
    }
    for (const child of [...shades.children]) {
      (child as Mesh).geometry.dispose();
      child.removeFromParent();
    }
    if (opts.below !== 'dim') return;
    const cols = opts.scene.grid.cols;
    const rows = opts.scene.grid.rows;
    for (let level = 1; level <= opts.floor; level += 1) {
      // Between the tops of the walls below (which stop UPPER_SLAB + 0.04
      // short: world3d's TOP_TRIM) and the underside of this floor's slab,
      // so every wall below is shaded to its top and the slab never is.
      const top = level * storey - UPPER_SLAB - 0.02;
      const box = new Mesh(new BoxGeometry(cols + 0.2, top, rows + 0.2), shadeMaterial);
      box.position.set(cols / 2, top / 2, rows / 2);
      // After the world's glass, so the shade lies over it too.
      box.renderOrder = 3;
      shades.add(box);
    }
  }

  /**
   * The meshes a world patch put in, shown or hidden with their floor
   * (`applyFloorVisibility`, for the floors that did not change).
   */
  function showPatched(patches: readonly WorldPatch[]): void {
    for (const p of patches) {
      const show = floorShown(p.level);
      for (const b of p.added) for (const o of b.all) o.visible = show;
    }
  }

  /**
   * Keep the orbit centred on the floor in view: when the floor changes, the
   * target (and the camera with it) rises or drops by the difference, so the
   * view keeps its angle and zoom and simply looks at the new floor.
   */
  function followFloor(from: number, to: number): void {
    const dy = (to - from) * storey;
    if (dy === 0) return;
    controls.target.y += dy;
    camera.position.y += dy;
    controls.update();
  }

  /** New orbit controls for the camera, turning about `target`; the old ones go. */
  function replaceControls(target: Vector3): void {
    dropControls(controls);
    controls = makeControls(target);
  }

  /**
   * A new canvas for a quality on the other side of the Low line. Everything
   * bound to the old one goes with it: controls and lighting (its shadow maps
   * are that renderer's). The camera and its target carry over.
   */
  function swapRenderer(q: LabQuality): void {
    const target = controls.target.clone();
    dropControls(controls);
    lighting?.dispose();
    lighting = null;
    dropRenderer(renderer);

    renderer = makeRenderer(q);
    // A new canvas has a context of its own, so a loss the runtime was
    // waiting out is over (a final one, reported to the owner, is not).
    if (!setup.onContextLost) contextLost = false;
    rendererLow = q === 'low';
    gpu = gpuName(renderer);
    controls = makeControls(target);
    rebuildLighting();
    applySize();
    // The first frame on a new renderer compiles its shaders: not a frame time.
    lastFrame = 0;
  }

  // --- camera --------------------------------------------------------------

  function applyProjection(): void {
    camera.left = -viewHalf * aspect;
    camera.right = viewHalf * aspect;
    camera.top = viewHalf;
    camera.bottom = -viewHalf;
    camera.updateProjectionMatrix();
  }

  function applySize(): void {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    aspect = width / height;
    renderer.setPixelRatio(pixelRatioFor(opts.quality));
    renderer.setSize(width, height, false);
    applyProjection();
  }

  /**
   * The extent worth framing: the map's footprint, from the ground to the top
   * of the floor in view, centred on that floor so the orbit turns about it.
   */
  function sceneBox(): { center: Vector3; corners: Vector3[]; radius: number } {
    const cols = opts.scene.grid.cols;
    const rows = opts.scene.grid.rows;
    const floorY = opts.floor * storey;
    const top = (opts.floor + 1) * storey;
    const corners: Vector3[] = [];
    for (const x of [0, cols]) for (const y of [0, top]) for (const z of [0, rows]) corners.push(new Vector3(x, y, z));
    return { center: new Vector3(cols / 2, floorY, rows / 2), corners, radius: 0.5 * Math.hypot(cols, rows, top) };
  }

  /** Look at the whole floor in view from the camera's own angle, filling the view. */
  function frameCamera(): void {
    const { center, corners, radius } = sceneBox();
    const dir =
      cameraKind === 'top'
        ? new Vector3(0, Math.cos(TOP_TILT), Math.sin(TOP_TILT))
        : new Vector3(
            Math.cos(ISO_ELEVATION) * Math.cos(ISO_AZIMUTH),
            Math.sin(ISO_ELEVATION),
            Math.cos(ISO_ELEVATION) * Math.sin(ISO_AZIMUTH),
          );
    const dist = radius * 4;
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.zoom = 1;
    camera.near = 0.1;
    camera.far = dist + radius * 4;
    camera.lookAt(center);
    camera.updateMatrixWorld();
    // The target sits on the view axis, so each corner's camera-space x and
    // y is how far off centre it lands on screen.
    let mx = 0;
    let my = 0;
    for (const c of corners) {
      const v = c.clone().applyMatrix4(camera.matrixWorldInverse);
      mx = Math.max(mx, Math.abs(v.x));
      my = Math.max(my, Math.abs(v.y));
    }
    viewHalf = Math.max(my, mx / aspect, 1) * 1.06;
    controls.maxDistance = Math.max(radius * 8, camera.position.distanceTo(center) * 1.5);
    controls.target.copy(center);
    applyProjection();
    controls.update();
  }

  function switchCamera(kind: LabCamera): void {
    if (kind === cameraKind) return;
    cameraKind = kind;
    replaceControls(controls.target.clone());
    frameCamera();
  }

  // --- the frame -----------------------------------------------------------

  function requestRender(): void {
    if (disposed || contextLost || raf !== 0) return;
    raf = requestAnimationFrame(frame);
  }

  /**
   * Re-pick the real-time lamps if the orbit target has drifted since the
   * last pick. At most every `LIGHT_PICK_MS`: a pick that is not yet due
   * books a frame for when it is, so the view never settles with the lamps
   * picked for where the camera was a moment ago.
   */
  function repickLamps(now: number): void {
    if (!lighting || pickedAt.distanceToSquared(controls.target) <= PICK_DRIFT_SQ) return;
    const wait = LIGHT_PICK_MS - (now - lastLightPick);
    if (wait <= 0) {
      lighting.update(controls.target);
      pickedAt.copy(controls.target);
      lastLightPick = now;
    } else if (pickTimer === null) {
      pickTimer = setTimeout(() => {
        pickTimer = null;
        requestRender();
      }, wait);
    }
  }

  function frame(now: number): void {
    raf = 0;
    if (disposed || contextLost) return;
    const dt = lastFrame > 0 ? now - lastFrame : 0;
    lastFrame = now;
    const t0 = performance.now();

    let more = false;
    for (const hook of beforeHooks) if (hook(now, dt) === true) more = true;
    // Damping keeps the camera gliding after a drag: `update` moves it and
    // asks for the next frame (its change event) until it settles.
    if (orbitEnabled) controls.update();
    repickLamps(now);

    renderer.info.reset();
    renderer.render(scene3, camera);
    const info: FrameInfo = {
      now,
      dt,
      cpu: performance.now() - t0,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
    if (editFrame) {
      // What an edit costs past its `update`: this frame uploads the new
      // meshes and their bake, and draws again the shadow maps they fall in.
      editFrame = false;
      console.debug(`[lab3d] edit frame: ${info.cpu.toFixed(1)} ms of CPU, ${info.drawCalls} draw calls`);
    }
    for (const hook of afterHooks) hook(info);

    if (more) requestRender();
    // Nothing asked for another frame: the view goes idle, and the gap until
    // the next one is not a frame time.
    if (raf === 0) lastFrame = 0;
  }

  // --- first build ---------------------------------------------------------

  try {
    rebuildWorld();
    tokens = standTokens();
    tokenLights = tokenLightKey(tokens);
    rebuildFigures();
    collectSources(true, true);
    applyFloorVisibility();
    rebuildLighting();
    applySize();
    frameCamera();
  } catch (err) {
    teardown();
    throw err;
  }

  const observer = new ResizeObserver(() => {
    if (disposed) return;
    applySize();
    requestRender();
  });
  observer.observe(host);
  requestRender();

  function teardown(): void {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    if (pickTimer !== null) clearTimeout(pickTimer);
    pickTimer = null;
    beforeHooks.clear();
    afterHooks.clear();
    dropControls(controls);
    lighting?.dispose();
    lighting = null;
    for (const child of [...figures.children]) disposeFigure(child as Group);
    if (world) {
      world.dispose();
      world.group.removeFromParent();
      world = null;
    }
    for (const child of [...shades.children]) (child as Mesh).geometry.dispose();
    shadeMaterial.dispose();
    materials.dispose();
    dropRenderer(renderer);
  }

  // --- the handle ----------------------------------------------------------

  return {
    update(partial) {
      if (disposed) return;
      const started = performance.now();
      const prev = opts;
      const next: Runtime3DOptions = { ...opts, ...partial };
      opts = next;

      // What changed, by what it costs (the header lists it).
      const change = next.scene === prev.scene ? SAME_SCENE : sceneChange(prev.scene, next.scene);
      const defsChanged = next.defs !== prev.defs && !sameData(next.defs, prev.defs);
      const wallsChanged = next.walls !== prev.walls;
      const tokensChanged = next.tokens !== prev.tokens;
      const floorsChanged = next.floor !== prev.floor || next.below !== prev.below;
      const figuresOn = next.figures !== false;
      const figuresToggled = figuresOn !== (prev.figures !== false);
      const qualityChanged = next.quality !== prev.quality;
      const ambientChanged = next.ambient !== prev.ambient;
      const cameraChanged = next.camera !== prev.camera;
      const sceneSwapped = next.scene.id !== prev.scene.id;

      // The world first (it sets the storey height), then what stands in it
      // and the lights, which are measured in storeys. Painted tiles that
      // changed on some floors build again only the chunks they reach, and a
      // door that only opened or shut is flipped where it stands; anything
      // else the whole world is built from builds it again, which drops the
      // lighting (its bake lives on the old world's meshes). So does another
      // scene arriving: all of it would be built again, chunk by chunk.
      let rebuilt = false;
      let doorsFlipped = false;
      const patches: WorldPatch[] = [];
      const edited = change.tiles.length > 0 || change.doors.length > 0;
      if (change.world || defsChanged || wallsChanged || (sceneSwapped && change.tiles.length > 0) || (edited && world === null)) {
        rebuildWorld();
        rebuilt = true;
      } else if (edited && world !== null) {
        const w = world;
        const floors = sceneLevels(next.scene);
        for (const level of change.tiles) {
          const patch = w.applyTiles(level, floors[level]?.tiles as TileLayer | undefined, next.defs);
          if (patch === null) {
            rebuilt = true;
            break;
          }
          patches.push(patch);
        }
        // On a floor just patched, a door already shows as it stands, and
        // this changes nothing there; its lights and shadows are still due.
        if (!rebuilt && change.doors.length > 0) {
          if (change.doors.every((d) => w.setDoorOpen(d.level, d.cell, d.open))) doorsFlipped = true;
          else rebuilt = true;
        }
        if (rebuilt) {
          patches.length = 0;
          doorsFlipped = false;
          rebuildWorld();
        }
      }
      const worldDone = performance.now();
      workedOut = 0;

      let tokenLightsChanged = false;
      if (rebuilt || tokensChanged) {
        tokens = standTokens();
        const key = tokenLightKey(tokens);
        tokenLightsChanged = key !== tokenLights;
        tokenLights = key;
      }
      const figuresRebuilt = figuresToggled || (figuresOn && (rebuilt || tokensChanged));
      if (figuresRebuilt) rebuildFigures();
      // Painted tiles and doors change the sight of their own floor only, and
      // only at the squares that changed; the traced walls and doors and the
      // GM's lights stand on every floor. What is kept of each floor's light
      // is brought in line first — its sight model patched at the squares
      // (`patchFloor`) or given the traced lines afresh, its own lights
      // listed again only where one of them changed — so that only the
      // lights whose sight or source changed are worked out again. A repaint
      // of the ground, a rug, a decal changes no sight and no light: nothing
      // is. A new world knows nothing of what changed, and works every light
      // out again.
      let fixedChanged: boolean | ReadonlySet<number> = rebuilt || change.lights;
      let touch: Touch | null = null;
      if (!rebuilt) {
        const around = new Map<number, Set<string> | null>();
        for (const p of patches) around.set(p.level, p.cells === null ? null : new Set(p.cells));
        if (doorsFlipped) {
          for (const d of change.doors) {
            const on = around.get(d.level);
            if (on === undefined) around.set(d.level, new Set([d.cell]));
            else on?.add(d.cell);
          }
        }
        const cells = new Map<number, Set<string> | null>();
        const redo = new Set<number>();
        const was = sceneLevels(prev.scene);
        const now = sceneLevels(next.scene);
        for (const [level, squares] of around) {
          const done = squares === null ? null : patchFloor(level, was[level]?.tiles, now[level]?.tiles, squares);
          if (done === null) {
            sightModels.delete(level);
            ownSources.delete(level);
            cells.set(level, null);
            redo.add(level);
            continue;
          }
          if (done.sight.size > 0) cells.set(level, done.sight);
          if (done.sight.size > 0 || done.lights) redo.add(level);
        }
        if (change.lights) {
          // The traced lines are every floor's (and nothing else of its
          // model is); the GM's lamps are listed again on their floors only.
          const segments = tracedSegments(next.scene);
          for (const [level, model] of sightModels) sightModels.set(level, { cells: model.cells, segments });
          for (const level of gmLightFloors(prev.scene.geometry, next.scene.geometry)) ownSources.delete(level);
        } else {
          fixedChanged = redo.size > 0 ? redo : false;
        }
        touch = { cells, segments: change.segments };
      }
      const lightsChanged = collectSources(fixedChanged, tokenLightsChanged, touch);
      const lightsDone = performance.now();

      // What is shown is settled before the lighting hears of any of it:
      // the lighting picks its real-time lamps from the top floor on show.
      if (rebuilt || figuresRebuilt || floorsChanged) applyFloorVisibility();
      else if (patches.length > 0) showPatched(patches);

      // The lighting: made afresh with a new world or a new renderer (the
      // quality crossing the Low line), and otherwise changed in place.
      let relit = false;
      if (qualityChanged && (next.quality === 'low') !== rendererLow) {
        swapRenderer(next.quality);
        relit = true;
      } else if (rebuilt) {
        rebuildLighting();
        if (qualityChanged) applySize();
        relit = true;
      } else if (lighting !== null) {
        if (qualityChanged) {
          lighting.setQuality(next.quality);
          applySize();
        }
        // Meshes the world swapped are dropped and baked by the lighting as
        // it takes the lamps on; it draws again the shadows the changed
        // squares fall in.
        if (patches.length > 0) lighting.syncMeshes(shownSources(), patchScope(patches));
        else if (lightsChanged || floorsChanged) lighting.setSources(shownSources());
        // Shadows are drawn once, so anything that casts one and moved,
        // came or went (a figure, a floor, a door leaf) asks for them again —
        // a door leaf only for the lamps whose light reaches it.
        if (figuresRebuilt || floorsChanged) lighting.refreshShadows();
        else if (doorsFlipped) lighting.refreshShadows(doorScope(change.doors));
      }
      if (!relit && ambientChanged) lighting?.setAmbient(next.ambient);

      if (patches.length > 0 || doorsFlipped) {
        const done = performance.now();
        lastEditMs = done - started;
        edits += 1;
        editFrame = true;
        const parts = patches.map((p) => `floor ${p.level}: ${p.rebuilt.length} chunk(s) built again in ${p.ms.toFixed(1)} ms`);
        if (doorsFlipped) parts.push(`${change.doors.length} door(s) flipped`);
        console.debug(
          `[lab3d] edit: ${parts.join(', ')}; world ${(worldDone - started).toFixed(1)} ms, ` +
            `lights ${(lightsDone - worldDone).toFixed(1)} ms (${workedOut} worked out again), ` +
            `lighting ${(done - lightsDone).toFixed(1)} ms; ${lastEditMs.toFixed(1)} ms in all`,
        );
      }

      if (cameraChanged) switchCamera(next.camera);
      else if (sceneSwapped) frameCamera();
      else if (next.floor !== prev.floor) followFloor(prev.floor, next.floor);

      if (
        rebuilt ||
        patches.length > 0 ||
        doorsFlipped ||
        lightsChanged ||
        figuresRebuilt ||
        floorsChanged ||
        qualityChanged ||
        ambientChanged ||
        cameraChanged ||
        sceneSwapped
      ) {
        requestRender();
      }
    },

    requestRender,

    refreshShadows(near) {
      if (disposed) return;
      lighting?.refreshShadows(near);
      requestRender();
    },

    reframe() {
      if (disposed) return;
      frameCamera();
      requestRender();
    },

    doorOfHit(hit) {
      if (disposed || world === null) return null;
      return world.doorOfHit(opts.floor, hit);
    },

    precompile(object) {
      if (disposed || contextLost) return Promise.resolve();
      try {
        // Against the scene's own lights, so the programs are the ones its frames will ask for.
        return renderer.compileAsync(object, camera, scene3).then(
          () => undefined,
          () => undefined,
        );
      } catch (err) {
        console.warn('[lab3d] shaders could not be compiled ahead', err);
        return Promise.resolve();
      }
    },

    setOrbitEnabled(on) {
      orbitEnabled = on;
      if (!disposed) controls.enabled = on;
    },

    onBeforeFrame(hook) {
      beforeHooks.add(hook);
      return () => {
        beforeHooks.delete(hook);
      };
    },

    onAfterFrame(hook) {
      afterHooks.add(hook);
      return () => {
        afterHooks.delete(hook);
      };
    },

    info() {
      return {
        lights: lighting?.stats() ?? NO_LIGHTS,
        worldBuildMs: world?.stats.buildMs ?? 0,
        worldTriangles: world?.stats.triangles ?? 0,
        lastEditMs,
        edits,
        pixelRatio: renderer.getPixelRatio(),
        width,
        height,
        gpu,
        quality: opts.quality,
      };
    },

    get options() {
      return opts;
    },
    camera,
    threeScene: scene3,
    get canvas() {
      return renderer.domElement;
    },
    get controls() {
      return controls;
    },
    get storey() {
      return storey;
    },
    get floor() {
      return opts.floor;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      teardown();
    },
  };
}
