/**
 * The 3D lab's view: one scene, drawn by three.js into a host element, with
 * the numbers a "should the map move to a real 3D engine?" decision needs.
 *
 * Imperative on purpose, like the 2D stage: React owns the panel around it and
 * pushes option changes in through `update`; everything per frame happens in
 * here and never touches React state. The page reads `stats()` twice a second.
 *
 * What lives where:
 *   - the WebGL renderer, its orbit controls and the lighting are bound to
 *     one canvas, and are rebuilt together when the quality crosses the Low
 *     line (antialiasing and the shadow map are fixed for a renderer's life,
 *     and Low turns both off);
 *   - the world meshes, the figures and the light list belong to the scene
 *     and survive a renderer swap untouched.
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
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PCFSoftShadowMap,
  Scene as ThreeScene,
  SRGBColorSpace,
  Spherical,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Scene, Token } from '@safehouse/contracts';
import { lightPolygonsFor, sceneLevels, type LightRow } from '@safehouse/rules';
import type { TileDrawDef } from '../grid/types.js';
import { STOREY_M, createLabMaterials, storeyUnits, type LabMaterials } from './geometry3d.js';
import { buildFigure, disposeFigure, placeFigure, type FigureCtx } from './figure3d.js';
import { createLighting, type LabLighting, type LabLightSource, type LabQuality } from './lighting3d.js';
import { UPPER_SLAB, buildWorld, type BuiltWorld } from './world3d.js';

export type { LabQuality } from './lighting3d.js';

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

/** Everything the view draws and how. `update` takes any subset of these. */
export interface LabViewOptions {
  scene: Scene;
  tokens: readonly Token[];
  defs: Readonly<Record<string, TileDrawDef>>;
  quality: LabQuality;
  /**
   * The ambient light row to light with, already resolved: the page turns
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

/** Light counts as the lighting reports them. */
export interface LabLightCounts {
  realtime: number;
  shadowed: number;
  baked: number;
}

/** A snapshot of how the view is doing, for the page's HUD. */
export interface LabStats {
  /** Frames per second, averaged over the last second. */
  fps: number;
  /** Time between frames over the last second: the mean and the single worst. */
  frameMsAvg: number;
  frameMsWorst: number;
  /**
   * CPU time spent inside the frame callback (controls, light picking and
   * submitting the draw calls), averaged over the last second. Not GPU time:
   * on a vsynced display this is the headroom the frame time cannot show.
   */
  cpuMsAvg: number;
  /** Draw calls and triangles in the last frame, every pass included (shadow maps too). */
  drawCalls: number;
  triangles: number;
  lights: LabLightCounts;
  /** How long the world took to build, and how many triangles it came to. */
  worldBuildMs: number;
  worldTriangles: number;
  /** The pixel ratio the renderer is drawing at, and the canvas size in CSS pixels. */
  pixelRatio: number;
  width: number;
  height: number;
  /** The GPU as WebGL names it (unmasked when the browser allows). */
  gpu: string;
  quality: LabQuality;
  benchmarking: boolean;
}

/** One quality level's benchmark pass. */
export interface BenchResult {
  quality: LabQuality;
  /** Mean frames per second over the measured part of the orbit. */
  fps: number;
  /** The worst 1% of frame times, averaged, as frames per second. */
  low1Fps: number;
  /** Mean time between frames. */
  frameMs: number;
  /** Mean CPU time inside the frame callback. */
  cpuMs: number;
  /** How many frames were measured. */
  frames: number;
  drawCalls: number;
  triangles: number;
  lights: LabLightCounts;
  pixelRatio: number;
}

/** Where a running benchmark is: which pass, and how far through it. */
export interface BenchProgress {
  quality: LabQuality;
  /** 0-based pass index, of `of` passes. */
  index: number;
  of: number;
  /** 0..1 through this pass's orbit. */
  fraction: number;
}

export interface LabView {
  /** Change any options; only what actually changed is rebuilt. */
  update(partial: Partial<LabViewOptions>): void;
  /**
   * Orbit the camera through a full turn at each quality in turn, and
   * measure. The view's own quality and camera are put back afterwards.
   * Resolves with whatever passes finished if the view is disposed midway.
   */
  benchmark(onProgress?: (p: BenchProgress) => void): Promise<BenchResult[]>;
  stats(): LabStats;
  /** Put the camera back on the whole scene, at the current camera's framing. */
  reframe(): void;
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
/** How often the lighting re-picks its real-time lights around the orbit target. */
const LIGHT_PICK_MS = 250;
/** One benchmark orbit, and the warm-up at its start that is not measured (shader compiles, first shadow maps). */
const BENCH_MS = 6000;
const BENCH_WARMUP_MS = 1000;
const BENCH_ORDER: readonly LabQuality[] = ['low', 'medium', 'high'];
/** A gap longer than this was a hidden tab, not a slow frame. */
const STALL_MS = 1000;

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

interface Sample {
  t: number;
  dt: number;
  cpu: number;
}

interface BenchPass {
  quality: LabQuality;
  /** Timestamp of the pass's first frame; null until it has drawn one. */
  start: number | null;
  /** The camera's place around the target when the pass began; the orbit turns its azimuth. */
  from: Spherical;
  dts: number[];
  cpus: number[];
  calls: number;
  tris: number;
  lastProgress: number;
  onProgress: (fraction: number) => void;
  done: (result: BenchResult | null) => void;
}

/**
 * Mount the lab into `host` (which should be positioned and sized; the
 * canvas fills it) and start drawing. Throws if WebGL or a builder fails, so
 * the page can say so.
 */
export function createLabView(host: HTMLElement, initial: LabViewOptions): LabView {
  let opts: LabViewOptions = { ...initial };
  let disposed = false;

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

  const ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  const camera = ortho;
  /** Which way the camera looks: the ortho camera serves both iso and top. */
  let cameraKind: LabCamera = opts.camera;
  /** Half the ortho camera's view height at zoom 1, in world units. */
  let viewHalf = 10;
  let aspect = 1;
  let width = 1;
  let height = 1;

  let world: BuiltWorld | null = null;
  let storey = storeyUnits(opts.scene.grid.unitM);
  /** The tokens as the lab stands them (`standTokens`): every one on a floor the scene has. */
  let tokens: Token[] = [];
  let sources: LabLightSource[] = [];
  let lighting: LabLighting | null = null;

  let renderer = makeRenderer(opts.quality);
  let rendererLow = opts.quality === 'low';
  let gpu = gpuName(renderer);
  let controls = makeControls(new Vector3(opts.scene.grid.cols / 2, 0, opts.scene.grid.rows / 2));

  // Per-frame bookkeeping.
  const samples: Sample[] = [];
  let lastFrame = 0;
  let lastLightPick = -Infinity;
  let lastCalls = 0;
  let lastTris = 0;
  let pass: BenchPass | null = null;
  /** The quality to go back to after a benchmark; the page may change it mid-run. */
  let benchRestore: LabQuality | null = null;

  const tmpOffset = new Vector3();
  const tmpSpherical = new Spherical();

  // --- building ------------------------------------------------------------

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
    host.appendChild(c);
    return r;
  }

  function makeControls(target: Vector3): OrbitControls {
    const c = new OrbitControls(camera, renderer.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    // Pan across the floor, the way a map is dragged, not across the screen.
    c.screenSpacePanning = false;
    c.maxPolarAngle = Math.PI / 2 - 0.02;
    c.minZoom = 0.25;
    c.maxZoom = 24;
    c.minDistance = 2;
    c.maxDistance = sceneBox().radius * 8;
    if (cameraKind === 'top') {
      // A plan: pan and zoom, never tilt or turn — north stays up.
      c.enableRotate = false;
      c.minPolarAngle = TOP_TILT;
      c.maxPolarAngle = TOP_TILT;
    }
    c.target.copy(target);
    c.update();
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
   * The page's tokens, each on a floor the scene has. One left on a floor
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

  function rebuildFigures(): void {
    for (const child of [...figures.children]) disposeFigure(child as Group);
    const ctx: FigureCtx = { unitM: opts.scene.grid.unitM > 0 ? opts.scene.grid.unitM : 1, storey };
    for (const token of tokens) {
      // One token the figure builder cannot make sense of costs that figure, not the lab.
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

  /** Every light on every floor, with the area each reaches, lifted to its lamp's height. */
  function collectSources(): LabLightSource[] {
    const out: LabLightSource[] = [];
    for (const level of floorIndices(opts.scene)) {
      for (const { source, points } of lightPolygonsFor(opts.scene, level, { tokens })) {
        out.push({ level, y: (level + source.height) * storey, source, polygon: points });
      }
    }
    return out;
  }

  /**
   * The lighting for what is on show. Lights on hidden floors are left out
   * rather than left on: a hidden slab casts no shadow, so a lamp upstairs
   * would otherwise pour straight down into the room below.
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
      sources: sources.filter((s) => s.level <= opts.floor && (opts.below !== 'hide' || s.level === opts.floor)),
      ambientRow: opts.ambient,
      storey,
    });
    lighting.setQuality(opts.quality);
    lighting.update(controls.target);
    lastLightPick = -Infinity;
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

  /**
   * A new canvas for a quality on the other side of the Low line. Everything
   * bound to the old one goes with it: controls and lighting (its shadow maps
   * are that renderer's). The camera and its target carry over.
   */
  function swapRenderer(q: LabQuality): void {
    const target = controls.target.clone();
    renderer.setAnimationLoop(null);
    controls.dispose();
    lighting?.dispose();
    lighting = null;
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();

    renderer = makeRenderer(q);
    rendererLow = q === 'low';
    gpu = gpuName(renderer);
    controls = makeControls(target);
    rebuildLighting();
    applySize();
    lastFrame = 0;
    renderer.setAnimationLoop(frame);
  }

  /**
   * Bring the renderer and lighting in line with `opts.quality`.
   * True when that meant a new renderer, which rebuilt the lighting too.
   */
  function applyQuality(): boolean {
    const q = opts.quality;
    if ((q === 'low') !== rendererLow) {
      swapRenderer(q);
      return true;
    }
    lighting?.setQuality(q);
    applySize();
    return false;
  }

  function setQuality(q: LabQuality): void {
    if (q === opts.quality) return;
    opts = { ...opts, quality: q };
    applyQuality();
  }

  // --- camera --------------------------------------------------------------

  function applyProjection(): void {
    ortho.left = -viewHalf * aspect;
    ortho.right = viewHalf * aspect;
    ortho.top = viewHalf;
    ortho.bottom = -viewHalf;
    ortho.updateProjectionMatrix();
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
    ortho.position.copy(center).addScaledVector(dir, dist);
    ortho.zoom = 1;
    ortho.near = 0.1;
    ortho.far = dist + radius * 4;
    ortho.lookAt(center);
    ortho.updateMatrixWorld();
    // The target sits on the view axis, so each corner's camera-space x and
    // y is how far off centre it lands on screen.
    let mx = 0;
    let my = 0;
    for (const c of corners) {
      const v = c.clone().applyMatrix4(ortho.matrixWorldInverse);
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
    const target = controls.target.clone();
    controls.dispose();
    controls = makeControls(target);
    frameCamera();
  }

  // --- the frame -----------------------------------------------------------

  function frame(now: number): void {
    const dt = lastFrame > 0 ? now - lastFrame : 0;
    lastFrame = now;
    const t0 = performance.now();

    const p = pass;
    let elapsed = 0;
    if (p) {
      if (p.start === null) {
        p.start = now;
        p.from.setFromVector3(tmpOffset.copy(camera.position).sub(controls.target));
      }
      elapsed = now - p.start;
      const turn = (Math.PI * 2 * Math.min(elapsed, BENCH_MS)) / BENCH_MS;
      tmpSpherical.set(p.from.radius, p.from.phi, p.from.theta + turn);
      camera.position.setFromSpherical(tmpSpherical).add(controls.target);
      camera.lookAt(controls.target);
    } else {
      controls.update();
    }

    if (lighting && now - lastLightPick >= LIGHT_PICK_MS) {
      lighting.update(controls.target);
      lastLightPick = now;
    }

    renderer.info.reset();
    renderer.render(scene3, camera);
    lastCalls = renderer.info.render.calls;
    lastTris = renderer.info.render.triangles;
    const cpu = performance.now() - t0;

    if (dt > 0 && dt < STALL_MS) {
      samples.push({ t: now, dt, cpu });
      while (samples.length > 0 && samples[0]!.t < now - 1000) samples.shift();
    }

    if (p) {
      if (elapsed >= BENCH_WARMUP_MS && dt > 0 && dt < STALL_MS) {
        p.dts.push(dt);
        p.cpus.push(cpu);
        p.calls += lastCalls;
        p.tris += lastTris;
      }
      if (now - p.lastProgress >= 200) {
        p.lastProgress = now;
        p.onProgress(Math.min(1, elapsed / BENCH_MS));
      }
      if (elapsed >= BENCH_MS) {
        pass = null;
        p.done(summarize(p));
      }
    }
  }

  function summarize(p: BenchPass): BenchResult {
    const n = p.dts.length;
    const lights = lighting?.stats() ?? NO_LIGHTS;
    const base = { quality: p.quality, lights, pixelRatio: renderer.getPixelRatio() };
    if (n === 0) return { ...base, fps: 0, low1Fps: 0, frameMs: 0, cpuMs: 0, frames: 0, drawCalls: 0, triangles: 0 };
    const mean = p.dts.reduce((a, b) => a + b, 0) / n;
    const worst = [...p.dts].sort((a, b) => b - a);
    const k = Math.max(1, Math.floor(n / 100));
    const worstMean = worst.slice(0, k).reduce((a, b) => a + b, 0) / k;
    return {
      ...base,
      fps: 1000 / mean,
      low1Fps: 1000 / worstMean,
      frameMs: mean,
      cpuMs: p.cpus.reduce((a, b) => a + b, 0) / n,
      frames: n,
      drawCalls: Math.round(p.calls / n),
      triangles: Math.round(p.tris / n),
    };
  }

  function runPass(q: LabQuality, onProgress: (fraction: number) => void): Promise<BenchResult | null> {
    return new Promise((resolve) => {
      pass = {
        quality: q,
        start: null,
        from: new Spherical(),
        dts: [],
        cpus: [],
        calls: 0,
        tris: 0,
        lastProgress: 0,
        onProgress,
        done: resolve,
      };
    });
  }

  // --- first build ---------------------------------------------------------

  try {
    rebuildWorld();
    tokens = standTokens();
    rebuildFigures();
    sources = collectSources();
    applyFloorVisibility();
    rebuildLighting();
    applySize();
    frameCamera();
  } catch (err) {
    teardown();
    throw err;
  }

  const observer = new ResizeObserver(() => {
    if (!disposed) applySize();
  });
  observer.observe(host);
  renderer.setAnimationLoop(frame);

  function teardown(): void {
    renderer.setAnimationLoop(null);
    controls.dispose();
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
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  // --- the handle ----------------------------------------------------------

  return {
    update(partial) {
      if (disposed) return;
      const prev = opts;
      const next: LabViewOptions = { ...opts, ...partial };
      // Mid-benchmark the quality belongs to the benchmark; remember the
      // page's choice and apply it when the run hands the view back.
      if (benchRestore !== null) {
        benchRestore = next.quality;
        next.quality = prev.quality;
      }
      opts = next;

      const sceneChanged = next.scene !== prev.scene || next.defs !== prev.defs;
      const tokensChanged = next.tokens !== prev.tokens;
      const wallsChanged = next.walls !== prev.walls;
      const floorsChanged = next.floor !== prev.floor || next.below !== prev.below;
      const anyShape = sceneChanged || tokensChanged || wallsChanged || floorsChanged;
      let lit = false;

      // The world first (it sets the storey height), then what stands in it
      // and the lights, which are measured in storeys. A new world drops the
      // lighting (its bake lives on the old world's meshes), and what is
      // shown is settled before the lighting is made again, since the
      // lighting picks its real-time lamps from the top floor on show.
      if (sceneChanged || wallsChanged) rebuildWorld();
      if (sceneChanged || tokensChanged) {
        tokens = standTokens();
        rebuildFigures();
        sources = collectSources();
      }
      if (anyShape) applyFloorVisibility();
      if (next.quality !== prev.quality) lit = applyQuality();
      if (!lit && anyShape) {
        rebuildLighting();
        lit = true;
      }
      if (!lit && next.ambient !== prev.ambient) lighting?.setAmbient(next.ambient);
      if (next.camera !== prev.camera) switchCamera(next.camera);
      else if (sceneChanged && next.scene.id !== prev.scene.id) frameCamera();
      else if (next.floor !== prev.floor) followFloor(prev.floor, next.floor);
    },

    async benchmark(onProgress) {
      if (disposed || pass !== null || benchRestore !== null) return [];
      benchRestore = opts.quality;
      const savedPos = camera.position.clone();
      const savedTarget = controls.target.clone();
      const savedZoom = camera.zoom;
      const savedCamera = camera;
      controls.enabled = false;
      const results: BenchResult[] = [];
      try {
        for (let i = 0; i < BENCH_ORDER.length; i += 1) {
          const q = BENCH_ORDER[i]!;
          setQuality(q);
          controls.enabled = false;
          const r = await runPass(q, (fraction) => onProgress?.({ quality: q, index: i, of: BENCH_ORDER.length, fraction }));
          if (r === null || disposed) break;
          results.push(r);
        }
      } finally {
        const back = benchRestore ?? opts.quality;
        benchRestore = null;
        pass = null;
        if (!disposed) {
          setQuality(back);
          if (camera === savedCamera) {
            camera.position.copy(savedPos);
            camera.zoom = savedZoom;
            camera.updateProjectionMatrix();
            controls.target.copy(savedTarget);
          }
          controls.enabled = true;
          controls.update();
        }
      }
      return results;
    },

    stats() {
      let sum = 0;
      let worst = 0;
      let cpu = 0;
      for (const s of samples) {
        sum += s.dt;
        cpu += s.cpu;
        if (s.dt > worst) worst = s.dt;
      }
      const n = samples.length;
      const mean = n > 0 ? sum / n : 0;
      return {
        fps: mean > 0 ? 1000 / mean : 0,
        frameMsAvg: mean,
        frameMsWorst: worst,
        cpuMsAvg: n > 0 ? cpu / n : 0,
        drawCalls: lastCalls,
        triangles: lastTris,
        lights: lighting?.stats() ?? NO_LIGHTS,
        worldBuildMs: world?.stats.buildMs ?? 0,
        worldTriangles: world?.stats.triangles ?? 0,
        pixelRatio: renderer.getPixelRatio(),
        width,
        height,
        gpu,
        quality: opts.quality,
        benchmarking: pass !== null || benchRestore !== null,
      };
    },

    reframe() {
      if (disposed || pass !== null) return;
      frameCamera();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      const p = pass;
      pass = null;
      p?.done(null);
      teardown();
    },
  };
}
