/**
 * The GM's markers on the 3D map (P3 of the move to 3D): map pins, security
 * cameras, the GM's lights, GM notes and the zones' names — each drawn where
 * the pointer's hit test (`stage/hit.ts`) looks for it, so a marker is taken
 * exactly where it is seen.
 *
 * ## What lies flat, and what stands
 *
 * Flat, in a `FloorInk` on the floor in view, drawn by the 2D map's own
 * functions (`stage/layers.ts`):
 *   - a switched-on camera's cone (`drawCameraCone`);
 *   - the selected light's reach (`drawLightReach`);
 *   - a GM note's paper (`drawNotes`), with its text lying on it (`DomLabels`,
 *     the note look) — and `hitNote` tests the same box on the same floor.
 *
 * Standing, as marks on the screen hung from a point in the world:
 *   - a pin: its stem and head rise straight up the screen from the point it
 *     marks, by the 2D map's own rise (`pinHeadRise`) in 2D world px — the
 *     `Lift` `hitPin` projects the head with, which the 3D camera turns into
 *     that many sixty-fourths of a square's width up the screen;
 *   - a camera: a small housing at `CAMERA_EYE_LIFT`, its lens along its
 *     facing, with a line down to its mount on the floor, where its cone
 *     starts — `hitCamera` projects the eye at that lift;
 *   - a GM light: its lamp (bulb and rays, or a beam's throw) at the light's
 *     own height (`lightMarkerLift`, as `hitLight` projects it), with a line
 *     down to where it stands;
 *   - the selected one's magenta ring, and an eye or a lamp switched off
 *     struck through, as on the 2D map.
 * Their names are DOM tags beside them (`StandingLabels`); the zones' names
 * are DOM tags on the floor (`DomLabels`), as the fog regions' are.
 *
 * ## How a standing mark is drawn
 *
 * One mesh per kind, one material for all (`standMaterial`). Each vertex is
 * a point in the world — its anchor — pushed across the screen by an offset
 * in 2D world px, the way a sprite is: in the view's own plane, after the
 * camera, `markerScale` world units to the px. `tick` sets that scale before
 * every frame so that one px of offset is exactly the `pxPerUnit / 64`
 * screen px that `Camera3D.project` lifts a point by — which is what puts a
 * pin's head where `hitPin` looks for it, in either camera and at any zoom,
 * for the price of one number a frame. Drawn this way a mark keeps its shape
 * on the screen however the camera looks, as the 2D map's markers do.
 *
 * What lies in the world rather than across the screen — a camera's housing,
 * a beam's throw, the lines down to the floor — is made of vertices that are
 * their own anchors, with no offset, or with an offset across the screen
 * worked out from the camera's axes when it is built. The camera never turns
 * (only a switch between iso and top does), and the camera kind is in the
 * key of every kind of marker built that way.
 *
 * The anchor is also where the cover reads its masks (`cover.ts`): a pin is
 * hidden by the square it stands on, not by whichever square its head hangs
 * over in isometric. The marks are drawn with no depth test, over the world,
 * as the 2D map draws its markers over the painted walls — so nothing the
 * pointer can take is ever out of sight behind a wall — and under the fog, as
 * the 2D map layers them (`applyCover(…, 'fog')`: over the shroud).
 *
 * ## Who sees what
 *
 * What the 2D map shows: pins to everyone who is sent them (a player's scene
 * holds the public ones only); cameras, lights, notes and zone names to the
 * GM alone, whatever the state holds. A player's pin label hides under the
 * fog (`setCover`), as its pin does.
 *
 * ## When
 *
 * Each kind is drawn again only when its key changes — the 2D map's own
 * (`stage/keys.ts`), with the metrics, the floor, the storey and the camera
 * kind — as the 2D stage redraws its Graphics.
 */
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  Vector3,
  type OrthographicCamera,
} from 'three';
import type { Camera as SecurityCamera, Point, Scene } from '@safehouse/contracts';
import { CELL, metricsKey, pinHeadRadius, pinHeadRise, polygonCenter, worldFromGrid, type SceneMetrics } from '../geometry.js';
import type { StageSceneState } from '../types.js';
import { C, parseColor, shade } from '../stage/colors.js';
import { CAMERA_EYE_LIFT, lightMarkerLift } from '../stage/hit.js';
import { cameraKey, lightKey, noteKey, pinKey, selectedOf } from '../stage/keys.js';
import { drawCameraCone, drawLightReach, drawNotes } from '../stage/layers.js';
import type { Lift, ViewCamera } from '../stage/viewCamera.js';
import { applyCover, markPlain } from './cover.js';
import type { FloorInk } from './floorInk.js';
import { DomLabels, TAG_OUTLINE } from './labels.js';

/** 2D world px to a square at 1:1: what a marker's px are, and what `Camera3D.project` divides a `Lift`'s px by. */
const PX_PER_SQUARE = CELL;
/** The selected camera's ring, px: the 2D eye's. */
const CAMERA_RING_PX = 13;
/**
 * A camera's housing, in squares: long along its facing, a little wider than
 * tall — about the 2D eye's wedge, which is half a square from mount to tip.
 */
const HOUSING = { length: 0.46, width: 0.24, height: 0.2 } as const;
/** The housing's lens end: the ground colour, so the way it looks reads at a glance. */
const LENS = 0x0d1520;
/** A beam's throw from its lamp along its aim, in squares: the 2D marker's. */
const BEAM_THROW = 0.6;
const TAU = Math.PI * 2;

type V3 = readonly [number, number, number];

/** A colour as the vertices carry it: linear, with its opacity. */
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const tmpColor = new Color();

function rgba(color: number, alpha: number): Rgba {
  tmpColor.setHex(color & 0xffffff, SRGBColorSpace);
  return { r: tmpColor.r, g: tmpColor.g, b: tmpColor.b, a: Math.min(1, Math.max(0, alpha)) };
}

/** Sides for a circle `r` px across: round at the size it is drawn. */
function sidesFor(r: number): number {
  return Math.min(48, Math.max(12, Math.ceil(Math.abs(r) * 1.5)));
}

const dot = (a: V3, v: Vector3): number => a[0] * v.x + a[1] * v.y + a[2] * v.z;

/** The screen as the camera faces it when a kind of marker is built: its right, up and back (toward the viewer), in the world. */
interface ScreenAxes {
  right: Vector3;
  up: Vector3;
  back: Vector3;
}

/**
 * One kind of marker's vertices while it is built (see "How a standing mark
 * is drawn"). Shapes are placed about the current anchor (`at`) in px, x to
 * the right and y UP the screen: the 2D map's sizes are used as they are,
 * its y (which runs down) flipped. Everything is drawn from both sides, so
 * no shape cares which way round its corners come.
 */
class StandBuilder {
  private readonly pos: number[] = [];
  private readonly off: number[] = [];
  private readonly col: number[] = [];
  private ax = 0;
  private ay = 0;
  private az = 0;

  constructor(private readonly axes: ScreenAxes) {}

  /** Hang the shapes that follow from world point (x, y, z). */
  at(x: number, y: number, z: number): this {
    this.ax = x;
    this.ay = y;
    this.az = z;
    return this;
  }

  /** A filled disc about (cx, cy). */
  disc(cx: number, cy: number, r: number, color: number, alpha: number): this {
    const c = rgba(color, alpha);
    const n = sidesFor(r);
    for (let i = 0; i < n; i += 1) {
      const a0 = (i / n) * TAU;
      const a1 = ((i + 1) / n) * TAU;
      this.tri(cx, cy, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, c);
    }
    return this;
  }

  /** A circle's outline about (cx, cy), `w` px wide astride radius `r`, as a 2D stroke is. */
  ring(cx: number, cy: number, r: number, w: number, color: number, alpha: number): this {
    const c = rgba(color, alpha);
    const n = sidesFor(r);
    const r0 = Math.max(0, r - w / 2);
    const r1 = r + w / 2;
    for (let i = 0; i < n; i += 1) {
      const c0 = Math.cos((i / n) * TAU);
      const s0 = Math.sin((i / n) * TAU);
      const c1 = Math.cos(((i + 1) / n) * TAU);
      const s1 = Math.sin(((i + 1) / n) * TAU);
      this.tri(cx + c0 * r0, cy + s0 * r0, cx + c0 * r1, cy + s0 * r1, cx + c1 * r1, cy + s1 * r1, c);
      this.tri(cx + c0 * r0, cy + s0 * r0, cx + c1 * r1, cy + s1 * r1, cx + c1 * r0, cy + s1 * r0, c);
    }
    return this;
  }

  /** A straight stroke from (x0, y0) to (x1, y1), `w` px wide with square ends, as a 2D stroke is. */
  line(x0: number, y0: number, x1: number, y1: number, w: number, color: number, alpha: number): this {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return this;
    const nx = (-dy / len) * (w / 2);
    const ny = (dx / len) * (w / 2);
    const c = rgba(color, alpha);
    this.tri(x0 + nx, y0 + ny, x0 - nx, y0 - ny, x1 - nx, y1 - ny, c);
    this.tri(x0 + nx, y0 + ny, x1 - nx, y1 - ny, x1 + nx, y1 + ny, c);
    return this;
  }

  /**
   * A line between world points `a` and `b`, `w` px wide across the screen:
   * the camera's axes say which way across that is. Nothing when it points
   * straight at the viewer (a line down to the floor, seen from above).
   */
  span(a: V3, b: V3, w: number, color: number, alpha: number): this {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const sx = dot(d, this.axes.right);
    const sy = dot(d, this.axes.up);
    const len = Math.hypot(sx, sy);
    if (len < 1e-6) return this;
    const nx = (-sy / len) * (w / 2);
    const ny = (sx / len) * (w / 2);
    const c = rgba(color, alpha);
    this.vert(a, nx, ny, c);
    this.vert(a, -nx, -ny, c);
    this.vert(b, -nx, -ny, c);
    this.vert(a, nx, ny, c);
    this.vert(b, -nx, -ny, c);
    this.vert(b, nx, ny, c);
    return this;
  }

  /**
   * A flat convex polygon of world points, its corners in order round it,
   * `normal` its outer side: drawn where it stands in the world, and only
   * when that side faces the viewer — so a solid made of these (a camera's
   * housing) shows its near faces alone and needs no depth test.
   */
  face(pts: readonly V3[], normal: V3, color: number, alpha: number): this {
    if (dot(normal, this.axes.back) <= 1e-6) return this;
    const c = rgba(color, alpha);
    const first = pts[0];
    if (first === undefined) return this;
    for (let i = 1; i + 1 < pts.length; i += 1) {
      this.vert(first, 0, 0, c);
      this.vert(pts[i]!, 0, 0, c);
      this.vert(pts[i + 1]!, 0, 0, c);
    }
    return this;
  }

  /** The geometry, or null when nothing was drawn. */
  build(): BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('markerOffset', new Float32BufferAttribute(this.off, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 4));
    return g;
  }

  private vert(p: V3, ox: number, oy: number, c: Rgba): void {
    this.pos.push(p[0], p[1], p[2]);
    this.off.push(ox, oy);
    this.col.push(c.r, c.g, c.b, c.a);
  }

  /** A triangle of offsets about the anchor. */
  private tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: Rgba): void {
    const a: V3 = [this.ax, this.ay, this.az];
    this.vert(a, x0, y0, c);
    this.vert(a, x1, y1, c);
    this.vert(a, x2, y2, c);
  }
}

/**
 * The material every standing mark is drawn with (see the module note):
 * unlit vertex colours with their alpha, no depth test, each vertex its
 * anchor pushed across the view's plane by `markerOffset × markerScale`.
 * `transformed` stays the anchor, so the cover's patch, which runs after
 * this one, reads the masks there.
 */
function standMaterial(scale: { value: number }): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
    fog: false,
  });
  m.name = 'gm-marker';
  // One pass in the order drawn, as the 2D map paints: a two-sided see-through
  // material would otherwise draw every back-facing triangle first, and a
  // ring could land under the disc it rings.
  m.forceSinglePass = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.markerScale = scale;
    const body = shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
	mvPosition.xy += markerOffset * markerScale;
	gl_Position = projectionMatrix * mvPosition;`,
    );
    shader.vertexShader = `attribute vec2 markerOffset;\nuniform float markerScale;\n${body}`;
  };
  // Before the cover, which keeps a key of the material's own.
  m.customProgramCacheKey = () => 'safehouse-gm-marker';
  // Over the shroud and under the fog, as the 2D map layers its markers; and
  // in their own colours whatever the eyes, which its vision filters never
  // reach either.
  applyCover(m, 'fog');
  markPlain(m);
  return m;
}

/** Give `mesh` a freshly built geometry (or none), freeing the one it had. */
function swap(mesh: Mesh, geometry: BufferGeometry | null): void {
  mesh.geometry.dispose();
  mesh.geometry = geometry ?? new BufferGeometry();
  mesh.visible = geometry !== null;
}

/** Where the housing's lid turns lens-dark, along it from back (−1) to front (1): so the way it looks reads from straight above too. */
const LENS_BAND = 0.45;

/**
 * A camera's housing: a box `HOUSING` in size about (x, y, z), its long side
 * along `facing` (degrees on the plan, 0 east, 90 south), lens end dark —
 * the front face, and the front of its lid.
 */
function housing(b: StandBuilder, x: number, y: number, z: number, facing: number, color: number, alpha: number): void {
  const f = (facing * Math.PI) / 180;
  const u: V3 = [Math.cos(f), 0, Math.sin(f)];
  const v: V3 = [-Math.sin(f), 0, Math.cos(f)];
  const hl = HOUSING.length / 2;
  const hw = HOUSING.width / 2;
  const hh = HOUSING.height / 2;
  const p = (su: number, sv: number, sh: number): V3 => [
    x + u[0] * hl * su + v[0] * hw * sv,
    y + hh * sh,
    z + u[2] * hl * su + v[2] * hw * sv,
  ];
  const neg = (n: V3): V3 => [-n[0], -n[1], -n[2]];
  b.face([p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1)], u, LENS, alpha);
  b.face([p(-1, -1, -1), p(-1, 1, -1), p(-1, 1, 1), p(-1, -1, 1)], neg(u), shade(color, 0.6), alpha);
  b.face([p(-1, 1, -1), p(1, 1, -1), p(1, 1, 1), p(-1, 1, 1)], v, shade(color, 0.78), alpha);
  b.face([p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1)], neg(v), shade(color, 0.69), alpha);
  b.face([p(-1, -1, 1), p(LENS_BAND, -1, 1), p(LENS_BAND, 1, 1), p(-1, 1, 1)], [0, 1, 0], color, alpha);
  b.face([p(LENS_BAND, -1, 1), p(1, -1, 1), p(1, 1, 1), p(LENS_BAND, 1, 1)], [0, 1, 0], LENS, alpha);
  b.face([p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1)], [0, -1, 0], shade(color, 0.5), alpha);
}

/** The zones' names as the 2D map draws them (`drawPins`): each zone's name, colour and middle. */
function zoneKey(state: StageSceneState): string {
  const zones = state.scene.geometry.zones
    .map((z) => `${z.id}:${z.name}:${z.color ?? ''}:${z.polygon.map((p) => `${p.x},${p.y}`).join(';')}`)
    .join(',');
  return `${state.role === 'gm' ? 'gm' : 'pc'}|${zones}`;
}

const hex = (color: number): string => `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;

/** One name beside a standing marker. */
interface StandingLabel {
  text: string;
  color: number;
  /** The grid point its marker stands on, and how high the mark hangs (the hit test's `Lift`). */
  at: Point;
  lift?: Lift;
  /** Where the name's left edge sits from there, px right and up; it is centred up and down on that point. */
  dx: number;
  dy: number;
}

/** A name's element, and the transform last written on it ('' while hidden). */
interface LabelItem {
  el: HTMLDivElement;
  label: StandingLabel;
  written: string;
}

/**
 * The names beside the standing markers: DOM tags over the canvas in the 2D
 * map's tag look (`labels.ts`), but hung from a point in the air — a pin's
 * head, a camera's eye, a lamp — and set off across the screen as the marks
 * are, growing and shrinking with the zoom as the 2D map's labels do.
 */
class StandingLabels {
  private readonly layer: HTMLDivElement;
  private readonly items = new Map<string, LabelItem>();
  private covered: ((at: Point) => boolean) | null = null;

  constructor(container: HTMLElement) {
    const layer = container.ownerDocument.createElement('div');
    layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    container.appendChild(layer);
    this.layer = layer;
  }

  /** Show exactly these names, by key: new ones made, gone ones removed, the rest said again. */
  set(labels: ReadonlyMap<string, StandingLabel>): void {
    for (const [key, item] of this.items) {
      if (labels.has(key)) continue;
      item.el.remove();
      this.items.delete(key);
    }
    for (const [key, label] of labels) {
      let item = this.items.get(key);
      if (item === undefined) {
        const el = this.layer.ownerDocument.createElement('div');
        el.style.cssText =
          'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;user-select:none;visibility:hidden;' +
          `margin:0;padding:0;font-family:Inter, sans-serif;font-size:12px;line-height:1.25;white-space:pre;text-shadow:${TAG_OUTLINE};`;
        this.layer.appendChild(el);
        item = { el, label, written: '' };
        this.items.set(key, item);
      }
      item.label = label;
      if (item.el.textContent !== label.text) item.el.textContent = label.text;
      item.el.style.color = hex(label.color);
    }
  }

  /** Hide every name whose marker stands where `covered` says the viewer may not see (a player's fog); null hides none. */
  setCover(covered: ((at: Point) => boolean) | null): void {
    this.covered = covered;
  }

  /** Place every name through `project` (grid point and lift → host px), `scale` screen px to the px. */
  layout(project: (at: Point, lift?: Lift) => Point, scale: number): void {
    for (const item of this.items.values()) {
      const { label } = item;
      const base = project(label.at, label.lift);
      const x = base.x + label.dx * scale;
      const y = base.y - label.dy * scale;
      const shown = Number.isFinite(x) && Number.isFinite(y) && this.covered?.(label.at) !== true;
      const transform = shown ? `translate(${x}px, ${y}px) scale(${scale}) translate(0, -50%)` : '';
      if (transform === item.written) continue;
      if (shown) {
        item.el.style.transform = transform;
        if (item.written === '') item.el.style.visibility = 'visible';
      } else {
        item.el.style.visibility = 'hidden';
      }
      item.written = transform;
    }
  }

  dispose(): void {
    for (const item of this.items.values()) item.el.remove();
    this.items.clear();
    this.layer.remove();
  }
}

/** What the markers are drawn through: the stage's view of the map. */
export interface MarkerView {
  /** The TOP-DOWN metrics every overlay draws in (the scene's, projection forced to plan). */
  metrics(): SceneMetrics;
  /** World y of the floor in view. */
  floorY(): number;
  /** One storey's height, in world units (squares). */
  storey(): number;
  /** The pointer's camera: where the hit tests look for each marker. */
  camera: ViewCamera;
  /** The three.js camera it drives: which way the screen faces, and how far it is zoomed. */
  three: OrthographicCamera;
  /** The view's height, in host px. */
  height(): number;
  /** Which camera is in use (iso or top): a switch turns the screen, and what is laid across it is laid again. */
  kind(): string;
}

/** The floor inks the flat parts are drawn in, made by the stage at their place in its draw order and flushed by it on a floor change. */
export interface MarkerInks {
  /** The cameras' cones. */
  cones: FloorInk;
  /** The selected light's reach. */
  reach: FloorInk;
  /** The GM notes' paper. */
  notes: FloorInk;
}

/**
 * The GM's markers on one 3D stage (see the module note). Add `group` to the
 * scene; call `update` with every stage state, `tick` before every frame,
 * and `layout` after every frame.
 */
export class GmMarkers {
  /** Holds the standing marks. Add it to the scene. */
  readonly group = new Group();

  /** World units in the view's plane per px of a mark's offset (`tick`). */
  private readonly scale = { value: 1 / PX_PER_SQUARE };
  private readonly material: MeshBasicMaterial;
  private readonly pins: Mesh;
  private readonly cameras: Mesh;
  private readonly lights: Mesh;
  /** Under the plates and the fog's names: the 2D map draws its markers' labels under its tokens. */
  private readonly holder: HTMLDivElement;
  private readonly pinLabels: StandingLabels;
  private readonly cameraLabels: StandingLabels;
  private readonly lightLabels: StandingLabels;
  private readonly zoneLabels: DomLabels;
  private readonly noteLabels: DomLabels;
  /** A name was put or its cover changed since the last layout: lay them out at the next, moved or not. */
  private labelsDue = false;
  /** What hides a pin's name (`setCover`). */
  private covered: ((at: Point) => boolean) | null = null;
  private lastPinKey = '';
  private lastZoneKey = '';
  private lastCameraKey = '';
  private lastLightKey = '';
  private lastNoteKey = '';
  private disposed = false;

  /**
   * `overlay` is the stage's DOM layer over the canvas; `renderOrder` is the
   * marks' place among the scene's see-through things: cameras at it, lights
   * just after, pins after those, as the 2D map layers them.
   */
  constructor(
    overlay: HTMLElement,
    private readonly view: MarkerView,
    private readonly inks: MarkerInks,
    renderOrder: number,
  ) {
    this.group.name = 'gm-markers';
    this.material = standMaterial(this.scale);
    const layer = (order: number): Mesh => {
      const mesh = new Mesh(new BufferGeometry(), this.material);
      mesh.renderOrder = order;
      // The anchors are all the bounds know of; a mark reaches past them.
      mesh.frustumCulled = false;
      // The pointer takes markers by the hit tests, never by a ray.
      mesh.raycast = () => {};
      mesh.visible = false;
      this.group.add(mesh);
      return mesh;
    };
    this.cameras = layer(renderOrder);
    this.lights = layer(renderOrder + 0.1);
    this.pins = layer(renderOrder + 0.2);

    const holder = overlay.ownerDocument.createElement('div');
    holder.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    overlay.insertBefore(holder, overlay.firstChild);
    this.holder = holder;
    const metrics = () => this.view.metrics();
    this.zoneLabels = new DomLabels(holder, metrics);
    this.noteLabels = new DomLabels(holder, metrics);
    this.cameraLabels = new StandingLabels(holder);
    this.lightLabels = new StandingLabels(holder);
    this.pinLabels = new StandingLabels(holder);
  }

  /** Draw again whatever of the markers `state` changed (each kind on its own key). */
  update(state: StageSceneState): void {
    if (this.disposed) return;
    const m = this.view.metrics();
    const mk = metricsKey(m);
    const floorY = this.view.floorY();
    const storey = this.view.storey();
    // Where the marks hang, and which way the screen faces.
    const frame = `${mk}|${floorY}|${storey}|${this.view.kind()}`;

    const pk = `${pinKey(state)}|${frame}`;
    if (pk !== this.lastPinKey) {
      this.lastPinKey = pk;
      this.drawPins(state.scene, m, floorY, selectedOf(state, 'pin'));
    }

    const zk = `${zoneKey(state)}|${mk}`;
    if (zk !== this.lastZoneKey) {
      this.lastZoneKey = zk;
      this.drawZones(state, m);
    }

    const ck = `${cameraKey(state)}|${frame}`;
    if (ck !== this.lastCameraKey) {
      this.lastCameraKey = ck;
      this.drawCameras(state, m, floorY, storey);
    }

    const lk = `${lightKey(state)}|${frame}`;
    if (lk !== this.lastLightKey) {
      this.lastLightKey = lk;
      this.drawLights(state, m, floorY, storey);
    }

    // The paper lies in its ink, which the stage moves to a new floor.
    const nk = `${noteKey(state)}|${mk}`;
    if (nk !== this.lastNoteKey) {
      this.lastNoteKey = nk;
      drawNotes(this.inks.notes, this.noteLabels, state.scene, m, selectedOf(state, 'note'), state.role === 'gm');
    }
  }

  /**
   * Hide a pin's name where `covered` says the viewer may not see its pin (a
   * player's fog; the mark itself is under the cover); null, the GM's, hides
   * none. Laid out again at the next frame when it changed; when the fog
   * under it changes, the stage lays everything out again anyway.
   */
  setCover(covered: ((at: Point) => boolean) | null): void {
    if (this.disposed || covered === this.covered) return;
    this.covered = covered;
    this.pinLabels.setCover(covered);
    this.labelsDue = true;
  }

  /**
   * Before each frame: one px of a mark's offset is `pxPerUnit / 64` screen
   * px, as `Camera3D.project` lifts a point, whatever the zoom and whichever
   * camera (the module note). One number, the same every frame the view only
   * pans or zooms. Never asks for a frame of its own.
   */
  tick(): boolean {
    if (this.disposed) return false;
    const cam = this.view.three;
    // Screen px per world unit across the view's plane (the frustum keeps
    // the view's aspect, so across and up are the same).
    const k = (cam.zoom * this.view.height()) / Math.max(1e-9, cam.top - cam.bottom);
    const s = this.view.camera.pxPerUnit() / (PX_PER_SQUARE * k);
    if (Number.isFinite(s) && s > 0) this.scale.value = s;
    return false;
  }

  /**
   * After each frame: the zones' and the notes' names follow the floor when
   * the view `moved`, and the markers' names follow their marks — then, or
   * when any was put since.
   */
  layout(moved: boolean): void {
    if (this.disposed) return;
    const camera = this.view.camera;
    if (moved) {
      const floor = (grid: Point): Point => camera.project(grid);
      this.zoneLabels.layout(floor, true);
      this.noteLabels.layout(floor, true);
    }
    if (!moved && !this.labelsDue) return;
    this.labelsDue = false;
    const project = (at: Point, lift?: Lift): Point => camera.project(at, lift);
    const scale = camera.pxPerUnit() / PX_PER_SQUARE;
    this.cameraLabels.layout(project, scale);
    this.lightLabels.layout(project, scale);
    this.pinLabels.layout(project, scale);
  }

  /**
   * A mark in the marks' material, never shown: for the stage to have its
   * shader compiled before the first marker of a session needs it
   * (`Runtime3D.precompile`). The caller frees its geometry.
   */
  sample(): Mesh {
    const b = new StandBuilder(this.axes());
    b.at(0, 0, 0).disc(0, 0, 4, C.warn, 1);
    return new Mesh(b.build() ?? new BufferGeometry(), this.material);
  }

  /** Free the marks and their names. The flat parts' inks are the stage's to dispose. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of [this.pins, this.cameras, this.lights]) mesh.geometry.dispose();
    this.material.dispose();
    this.group.clear();
    this.group.removeFromParent();
    this.pinLabels.dispose();
    this.cameraLabels.dispose();
    this.lightLabels.dispose();
    this.zoneLabels.dispose();
    this.noteLabels.dispose();
    this.holder.remove();
  }

  // -- the kinds ---------------------------------------------------------------

  /** The screen's axes in the world as the camera now stands, for what is laid across it. */
  private axes(): ScreenAxes {
    const cam = this.view.three;
    cam.updateMatrixWorld();
    return {
      right: new Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize(),
      up: new Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize(),
      back: new Vector3().setFromMatrixColumn(cam.matrixWorld, 2).normalize(),
    };
  }

  /**
   * Map pins (FR9.3), as `drawPins` draws them — a stem up from the point,
   * the head at `pinHeadRise` (hollow for the GM's private ones), the
   * selected one ringed, the name beside the head — standing on the floor
   * in view, for whoever was sent them.
   */
  private drawPins(scene: Scene, m: SceneMetrics, floorY: number, selected: string | null): void {
    const b = new StandBuilder(this.axes());
    const labels = new Map<string, StandingLabel>();
    const r = pinHeadRadius(m);
    const rise = pinHeadRise(m);
    for (const pin of scene.geometry.pins) {
      const isPublic = pin.visibility === 'public';
      const color = isPublic ? C.warn : C.cyan;
      b.at(pin.at.x, floorY, pin.at.y);
      b.line(0, 0, 0, r * 1.9, 2, color, 0.9);
      b.disc(0, rise, r, isPublic ? color : C.ground, isPublic ? 0.95 : 0.9);
      b.ring(0, rise, r, 2, color, 1);
      b.disc(0, 0, 2, color, 1);
      if (pin.id === selected) b.ring(0, rise, r * 1.9, 2, C.magenta, 0.95);
      if (pin.label) labels.set(pin.id, { text: pin.label, color, at: pin.at, dx: r * 1.6, dy: rise });
    }
    swap(this.pins, b.build());
    this.pinLabels.set(labels);
    this.labelsDue = true;
  }

  /** The zones' names, the GM's map labels (FR9.2), on the floor at each zone's middle, as `drawPins` puts them. */
  private drawZones(state: StageSceneState, m: SceneMetrics): void {
    if (state.role === 'gm') {
      for (const zone of state.scene.geometry.zones) {
        const at = worldFromGrid(m, polygonCenter(zone.polygon));
        this.zoneLabels.put(`zone:${zone.id}`, {
          look: 'tag',
          text: zone.name,
          x: at.x,
          y: at.y,
          anchorX: 0.5,
          anchorY: 0.5,
          color: parseColor(zone.color, C.cyanDim),
        });
      }
    }
    this.zoneLabels.sweep();
  }

  /**
   * Security cameras (FR9.23), the GM's alone, on the floor in view: each
   * switched-on one's cone on the floor, and the camera itself hung at
   * `CAMERA_EYE_LIFT` over its mount — its housing turned along its facing,
   * a line down to the floor, struck through when it is off, ringed when
   * selected, its name beside it.
   */
  private drawCameras(state: StageSceneState, m: SceneMetrics, floorY: number, storey: number): void {
    const ink = this.inks.cones;
    ink.clear();
    const b = new StandBuilder(this.axes());
    const labels = new Map<string, StandingLabel>();
    if (state.role === 'gm') {
      const level = state.level ?? 0;
      const selected = selectedOf(state, 'camera');
      const eyeY = floorY + (CAMERA_EYE_LIFT.storeys ?? 0) * storey;
      for (const cam of state.scene.geometry.cameras ?? []) {
        if ((cam.level ?? 0) !== level) continue;
        const color = cam.active ? C.warn : C.faint;
        const cone = cam.active ? state.cameraCones?.find((c) => c.id === cam.id) : undefined;
        if (cone) drawCameraCone(ink, m, cam, cone);
        this.standCamera(b, cam, floorY, eyeY, color, cam.id === selected);
        labels.set(`cam:${cam.id}`, {
          text: cam.label ?? cam.id,
          color,
          at: cam.at,
          lift: CAMERA_EYE_LIFT,
          dx: CAMERA_RING_PX + 3,
          dy: 12,
        });
      }
    }
    swap(this.cameras, b.build());
    this.cameraLabels.set(labels);
    this.labelsDue = true;
  }

  private standCamera(b: StandBuilder, cam: SecurityCamera, floorY: number, eyeY: number, color: number, selected: boolean): void {
    const { x, y: z } = cam.at;
    // Down to its mount, where its cone starts: which square it hangs over.
    b.span([x, floorY, z], [x, eyeY, z], 1.5, color, 0.5);
    housing(b, x, eyeY, z, cam.facing, color, cam.active ? 1 : 0.6);
    b.at(x, eyeY, z);
    // A dead eye: struck through, so "off" reads without a label.
    if (!cam.active) b.line(-7, 7, 7, -7, 2, C.danger, 0.9);
    if (selected) b.ring(0, 0, CAMERA_RING_PX, 2, C.magenta, 0.95);
  }

  /**
   * The GM's lights (docs/VISION.md §4.1), the GM's alone, on the floor in
   * view, as `drawLights` draws them but hung at each lamp's own height: the
   * bulb in the light's colour, rays round it while it is on (a short throw
   * along the aim for a beam), struck through when it is off, and a line
   * down to where it stands. The selected one is ringed, and its reach is
   * laid out on the floor.
   */
  private drawLights(state: StageSceneState, m: SceneMetrics, floorY: number, storey: number): void {
    const ink = this.inks.reach;
    ink.clear();
    const b = new StandBuilder(this.axes());
    const labels = new Map<string, StandingLabel>();
    if (state.role === 'gm') {
      const level = state.level ?? 0;
      const selected = selectedOf(state, 'light');
      const r = Math.max(5, m.cell * 0.09);
      for (const light of state.scene.geometry.lights ?? []) {
        if ((light.level ?? 0) !== level) continue;
        const on = light.on !== false;
        const color = parseColor(light.color, C.warn);
        const spot = light.fov !== undefined && light.fov < 360;
        const lift = lightMarkerLift(light);
        const y = floorY + (lift.storeys ?? 0) * storey;
        const { x, y: z } = light.at;
        const isSelected = light.id === selected;
        if (isSelected) drawLightReach(ink, m, light, state.scene.grid.unitM);

        b.span([x, floorY, z], [x, y, z], 1, color, on ? 0.35 : 0.2);
        b.at(x, y, z);
        if (isSelected) b.ring(0, 0, r * 2.4, 2, C.magenta, 0.95);
        if (on && spot) {
          const f = ((light.facing ?? 0) * Math.PI) / 180;
          b.span([x, y, z], [x + Math.cos(f) * BEAM_THROW, y, z + Math.sin(f) * BEAM_THROW], 2, color, 0.9);
        } else if (on) {
          for (let k = 0; k < 8; k += 1) {
            const a = (k * Math.PI) / 4;
            b.line(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35, Math.cos(a) * r * 1.9, Math.sin(a) * r * 1.9, 1.5, color, 0.85);
          }
        }
        b.disc(0, 0, r, color, on ? 0.95 : 0.35);
        b.ring(0, 0, r, 1.5, C.ground, 0.9);
        // Switched off: struck through, so "off" reads without a label.
        if (!on) b.line(-r * 1.3, r * 1.3, r * 1.3, -r * 1.3, 2, C.danger, 0.9);

        if (light.label) {
          labels.set(`light:${light.id}`, { text: light.label, color: on ? color : C.faint, at: light.at, lift, dx: r * 2, dy: r * 1.5 });
        }
      }
    }
    swap(this.lights, b.build());
    this.lightLabels.set(labels);
    this.labelsDue = true;
  }
}
