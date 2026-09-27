/**
 * The 3D map's camera: the `ViewCamera` the pointer code works through when
 * the map is drawn by three.js.
 *
 * It drives the runtime's one orthographic camera and the orbit controls'
 * `target` (the point the view looks at and turns about), and nothing else
 * moves them: the runtime never attaches the controls to the canvas, so they
 * never listen to the DOM, and their per-frame update is switched off here,
 * so every pan, zoom and turn is exactly the one asked for — no damping, no
 * glide, and no second opinion on the zoom.
 *
 * Two camera kinds, both orthographic, following the map's projection:
 *   - iso: the 2D map's angle as a true isometric camera;
 *   - top: straight down, north up.
 * Neither turns: the GM wants a fixed view that pans and zooms (2026-09-26),
 * so there is no rotate gesture and a saved view keeps only where it looks
 * and how close.
 *
 * Spaces: host px (relative to the host element's rect, what
 * `PointerController` hands over), grid units on the floor, and three.js
 * world units, where x is grid x, z is grid y, y is up in squares, and the
 * floor in view lies at `y = floor * storey`.
 *
 * The view is remembered per scene for the tab, as the 2D map remembered its
 * own, so a reload lands where the GM was looking.
 */
import { Spherical, Vector3 } from 'three';
import type { Point } from '@safehouse/contracts';
import type { LabCamera, Runtime3D } from '../../lab3d/runtime3d.js';
import type { Lift, ViewCamera } from '../stage/viewCamera.js';

/** The two ways the 3D map is looked at: isometric, or a top-down plan. */
export type Camera3DKind = LabCamera;

/** How a `Camera3D` is wired to its page. */
export interface Camera3DOptions {
  /** The scene in view: the key its framing is remembered under. */
  sceneId: string;
  /**
   * The element the runtime draws into and the pointer listens on. Screen
   * points are host px, measured from its top-left corner.
   */
  host: HTMLElement;
}

/**
 * The zoom range, as the ortho camera's `zoom`: 1 is the whole floor in view
 * (`fit`). The same limits as the controls rig's, so the rig's own update —
 * which still runs when the runtime changes floor or rebuilds its renderer —
 * never snaps a zoom back.
 */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 24;
/**
 * The biggest a square gets on screen, in px — the 2D map's biggest (its
 * largest scale times a 64 px square). Without it a small room could be
 * zoomed until one square filled the screen, which shows nothing.
 */
const MAX_SQUARE_PX = 384;
/**
 * How far past the map's edge the view's centre may be panned, as a share of
 * the map's size on each side. The camera sits a fixed distance from the
 * target with its far plane fitted to the map, so a centre panned far off the
 * map would start cutting it off.
 */
const REACH = 0.5;
/** How long the view must sit still before it is written to the tab's storage. */
const SAVE_MS = 250;

/** Where the GM left each scene's 3D view, for the tab (the 2D map kept its own). */
const VIEW_KEY = (sceneId: string) => `safehouse.grid.camera3d.${sceneId}`;

/** A scene's view as it is remembered: which camera, what it looks at, from which side, how close. */
interface SavedView {
  kind: Camera3DKind;
  /** The point in view, in grid units. */
  target: Point;
  /** The camera's bearing about the target, radians (three's `Spherical.theta`). */
  azimuth: number;
  zoom: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function readView(sceneId: string): SavedView | null {
  if (!sceneId) return null;
  try {
    const v = JSON.parse(globalThis.sessionStorage?.getItem(VIEW_KEY(sceneId)) ?? 'null') as {
      kind?: unknown;
      target?: { x?: unknown; y?: unknown } | null;
      azimuth?: unknown;
      zoom?: unknown;
    } | null;
    if (v?.kind !== 'iso' && v?.kind !== 'top') return null;
    const x = v.target?.x;
    const y = v.target?.y;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (typeof v.azimuth !== 'number' || !Number.isFinite(v.azimuth)) return null;
    if (typeof v.zoom !== 'number' || !Number.isFinite(v.zoom) || v.zoom <= 0) return null;
    return { kind: v.kind, target: { x, y }, azimuth: v.azimuth, zoom: v.zoom };
  } catch {
    return null;
  }
}

function writeView(sceneId: string, view: SavedView): void {
  try {
    globalThis.sessionStorage?.setItem(VIEW_KEY(sceneId), JSON.stringify(view));
  } catch {
    /* storage blocked */
  }
}

function dropView(sceneId: string): void {
  try {
    globalThis.sessionStorage?.removeItem(VIEW_KEY(sceneId));
  } catch {
    /* storage blocked */
  }
}

/**
 * The 3D map's view, and the pointer's `ViewCamera` onto it.
 *
 * Every move asks the runtime for a frame; an idle view draws nothing. Every
 * method is a no-op after `dispose`.
 */
export class Camera3D implements ViewCamera {
  private readonly rt: Runtime3D;
  private readonly host: HTMLElement;
  private sceneId: string;
  private disposed = false;
  private moved = false;
  /** The host's size in px, kept by the resize observer (read on every pick and project). */
  private width = 1;
  private height = 1;
  /** The host was resized while the view was untouched: fit again before the next frame. */
  private refitDue = false;
  private readonly observer: ResizeObserver | null;
  private readonly offFrame: () => void;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The view as the viewer last left it, waiting to be written. Taken at the
   * move, not when the write falls due: by then the runtime may have framed
   * another scene (a scene switch reframes before `setScene` writes the old
   * scene's view out), and that framing is not the old scene's.
   */
  private pending: SavedView | null = null;

  // Scratch, so a pointer move allocates nothing but the points it returns.
  private readonly rayFrom = new Vector3();
  private readonly rayDir = new Vector3();
  private readonly hitA = new Vector3();
  private readonly hitB = new Vector3();
  private readonly proj = new Vector3();
  private readonly axisX = new Vector3();
  private readonly axisY = new Vector3();
  private readonly offset = new Vector3();
  private readonly sph = new Spherical();

  /**
   * Take over `runtime`'s camera for the scene `opts.sceneId`, drawn into
   * `opts.host`. The runtime has already framed the whole floor; if this tab
   * has looked at this scene through the same kind of camera before, the view
   * goes back to where it was left.
   */
  constructor(runtime: Runtime3D, opts: Camera3DOptions) {
    this.rt = runtime;
    this.host = opts.host;
    this.sceneId = opts.sceneId;
    // The controls are a rig here, not an input: this camera is the only
    // thing that moves the view, so their per-frame update has nothing to do.
    runtime.setOrbitEnabled(false);
    this.measure();

    // A resize before the viewer has framed the map fits it again (a phone's
    // layout settling after mount, a panel opening beside the canvas). The
    // fit waits for the frame: the runtime resizes its own projection from
    // its own observer, and the fit must measure the new one.
    this.observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (this.disposed) return;
            this.measure();
            if (!this.moved) {
              this.refitDue = true;
              this.rt.requestRender();
            }
          });
    this.observer?.observe(this.host);
    this.offFrame = runtime.onBeforeFrame(() => {
      if (this.refitDue) {
        this.refitDue = false;
        if (!this.moved) this.fit();
      }
      return false;
    });

    this.restore();
  }

  /** True once the viewer has panned, zoomed, turned or centred the view since it was last fitted. */
  get touched(): boolean {
    return this.moved;
  }

  /** Which camera is in use — the runtime's `camera` option. */
  get kind(): Camera3DKind {
    return this.rt.options.camera;
  }

  // -- ViewCamera --------------------------------------------------------------

  /**
   * The grid point on the floor in view under host point `screen`. The ray
   * from an orthographic camera meets the floor's plane everywhere on screen
   * — beyond the map's edge too — so this is null only for a ray lying in
   * that plane, which neither camera kind ever casts.
   */
  pick(screen: Point): Point | null {
    const hit = this.floorAt(screen.x, screen.y, this.hitA);
    return hit ? { x: hit.x, y: hit.z } : null;
  }

  /**
   * The host point where grid point `grid` is drawn, raised by `lift`: by
   * `lift.storeys` storeys above the floor in view when it says, else by
   * `lift.px` 2D world px straight up the screen — `px / 64` of a square's
   * on-screen size, a billboard's offset — else not at all.
   */
  project(grid: Point, lift?: Lift): Point {
    const storeys = lift?.storeys;
    const v = this.proj.set(grid.x, this.floorY() + (storeys ?? 0) * this.rt.storey, grid.y);
    this.sync();
    v.project(this.rt.camera);
    const x = ((v.x + 1) / 2) * this.width;
    let y = ((1 - v.y) / 2) * this.height;
    if (storeys === undefined && lift?.px) y -= (lift.px / 64) * this.pxPerUnit();
    return { x, y };
  }

  /**
   * Screen px per grid unit: the on-screen length of a square's side. In the
   * view as framed that is its length along x (both sides are the same length
   * there, in either camera); once the iso view is turned the two sides
   * foreshorten differently, so this is the root-mean-square of the two,
   * which stays what it was at any bearing — a token's hit circle does not
   * grow or shrink as the view turns. The same everywhere on screen, so it
   * takes no point.
   */
  pxPerUnit(): number {
    const cam = this.rt.camera;
    this.sync();
    const kx = (this.width * cam.zoom) / (cam.right - cam.left || 1);
    const ky = (this.height * cam.zoom) / (cam.top - cam.bottom || 1);
    // The camera's right and up, in world units: how a world vector lands on screen.
    const r = this.axisX.setFromMatrixColumn(cam.matrixWorld, 0);
    const u = this.axisY.setFromMatrixColumn(cam.matrixWorld, 1);
    const alongX = (r.x * kx) ** 2 + (u.x * ky) ** 2;
    const alongZ = (r.z * kx) ** 2 + (u.z * ky) ** 2;
    return Math.sqrt((alongX + alongZ) / 2);
  }

  /**
   * Move the view by a drag of `(dx, dy)` host px, the map following the
   * pointer exactly: the floor point that was under a screen point is under
   * that point plus the drag afterwards, at any angle and zoom.
   */
  panBy(dx: number, dy: number): void {
    if (this.disposed || (dx === 0 && dy === 0)) return;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const was = this.floorAt(cx, cy, this.hitA);
    const now = this.floorAt(cx + dx, cy + dy, this.hitB);
    if (!was || !now) return;
    this.shift(was.x - now.x, was.z - now.z);
    this.changed();
  }

  /** Zoom by `factor`, keeping the floor point under host point `(sx, sy)` where it is on screen. */
  zoomAt(sx: number, sy: number, factor: number): void {
    if (this.disposed || !(factor > 0) || !Number.isFinite(factor)) return;
    const cam = this.rt.camera;
    const next = this.clampZoom(cam.zoom * factor);
    if (next === cam.zoom) return;
    const was = this.floorAt(sx, sy, this.hitA);
    cam.zoom = next;
    cam.updateProjectionMatrix();
    const now = this.floorAt(sx, sy, this.hitB);
    if (was && now) this.shift(was.x - now.x, was.z - now.z);
    this.changed();
  }

  // -- the page's camera commands ---------------------------------------------

  /**
   * Look through the other kind of camera. A change frames the whole floor
   * afresh, at that camera's own angle: a view framed through one says
   * nothing useful about the other.
   */
  setKind(kind: Camera3DKind): void {
    if (this.disposed || kind === this.kind) return;
    this.rt.update({ camera: kind });
    this.settled();
  }

  /** Put grid point `(x, y)` on the floor in view at the centre of the screen. */
  centerOn(x: number, y: number): void {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const target = this.rt.controls.target;
    this.shift(x - target.x, y - target.z);
    this.changed();
  }

  /** Zoom by `factor` about the middle of the screen (the HUD's zoom buttons). */
  zoomBy(factor: number): void {
    this.zoomAt(this.width / 2, this.height / 2, factor);
  }

  /**
   * The whole floor in view, from the camera's own starting angle — an iso
   * view that was turned turns back, so this is also the way home. Clears
   * `touched`, and forgets the scene's remembered view: the next reload
   * shows what this shows.
   */
  fit(): void {
    if (this.disposed) return;
    this.rt.reframe();
    this.settled();
  }

  /**
   * The scene in view changed. Call it after the runtime has been given the
   * new scene (its `update` frames a new scene's floor): the old scene's view
   * is written out, and the new one's is brought back if the tab has one for
   * this camera kind, else the fitted framing stands.
   */
  setScene(sceneId: string): void {
    if (this.disposed || sceneId === this.sceneId) return;
    this.flushSave();
    this.sceneId = sceneId;
    this.moved = false;
    this.refitDue = false;
    this.restore();
  }

  /** Let go: the view is written out, and the observer and frame hook removed. Leaves the runtime running. */
  dispose(): void {
    if (this.disposed) return;
    this.flushSave();
    this.disposed = true;
    this.observer?.disconnect();
    this.offFrame();
  }

  // -- internals ---------------------------------------------------------------

  /** The height of the floor in view, in world units. */
  private floorY(): number {
    return this.rt.floor * this.rt.storey;
  }

  private measure(): void {
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
  }

  /**
   * Bring the camera's world matrices up to date. The runtime moves the
   * camera too (a floor change, a reframe) and leaves the matrices for the
   * next render to settle, so every pick and project settles them first.
   */
  private sync(): void {
    this.rt.camera.updateMatrixWorld();
  }

  /**
   * Where the ray through host point `(sx, sy)` meets the floor in view,
   * written into `out` (world units); null when it runs parallel to the floor.
   */
  private floorAt(sx: number, sy: number, out: Vector3): Vector3 | null {
    const cam = this.rt.camera;
    this.sync();
    const nx = (sx / this.width) * 2 - 1;
    const ny = 1 - (sy / this.height) * 2;
    // An orthographic ray: it starts on the near plane under the point and
    // runs along the view axis.
    const from = this.rayFrom.set(nx, ny, -1).unproject(cam);
    const dir = this.rayDir.set(0, 0, -1).transformDirection(cam.matrixWorld);
    if (Math.abs(dir.y) < 1e-9) return null;
    const t = (this.floorY() - from.y) / dir.y;
    return out.copy(from).addScaledVector(dir, t);
  }

  /**
   * Slide the target and the camera together across the floor by `(dx, dz)`
   * world units, keeping the target within `REACH` of the map.
   */
  private shift(dx: number, dz: number): void {
    const cam = this.rt.camera;
    const target = this.rt.controls.target;
    const { cols, rows } = this.rt.options.scene.grid;
    const w = Math.max(1, cols);
    const h = Math.max(1, rows);
    const x = clamp(target.x + dx, -w * REACH, w * (1 + REACH));
    const z = clamp(target.z + dz, -h * REACH, h * (1 + REACH));
    const mx = x - target.x;
    const mz = z - target.z;
    if (mx === 0 && mz === 0) return;
    target.x = x;
    target.z = z;
    cam.position.x += mx;
    cam.position.z += mz;
    cam.updateMatrixWorld();
  }

  /** The camera's bearing about the target, radians (three's `Spherical.theta`: 0 is due south of it). */
  private azimuth(): number {
    const cam = this.rt.camera;
    return this.sph.setFromVector3(this.offset.copy(cam.position).sub(this.rt.controls.target)).theta;
  }

  /**
   * `zoom` held inside the range, and short of a square wider than
   * `MAX_SQUARE_PX` — unless the view is already past that (the window grew),
   * when it may still zoom out but not further in.
   */
  private clampZoom(zoom: number): number {
    const cam = this.rt.camera;
    const rig = this.rt.controls;
    const lo = Math.max(ZOOM_MIN, rig.minZoom);
    let hi = Math.min(ZOOM_MAX, rig.maxZoom);
    const square = this.pxPerUnit();
    if (square > 0) hi = Math.min(hi, Math.max(cam.zoom, (cam.zoom * MAX_SQUARE_PX) / square));
    return clamp(zoom, lo, Math.max(lo, hi));
  }

  /** The viewer moved the view: draw it, mark it touched, and remember it. */
  private changed(): void {
    this.moved = true;
    this.refitDue = false;
    this.rt.requestRender();
    this.scheduleSave();
  }

  /** The view is a fresh framing, not the viewer's: untouched, and nothing to remember. */
  private settled(): void {
    this.moved = false;
    this.refitDue = false;
    this.pending = null;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.sceneId) dropView(this.sceneId);
  }

  /**
   * The scene's remembered view, if the tab has one taken through the camera
   * kind in use; otherwise the runtime's framing stands, untouched. The
   * camera's elevation and distance are the runtime's own for the kind, so
   * only the target, the bearing (iso only) and the zoom come back.
   */
  private restore(): void {
    const saved = readView(this.sceneId);
    if (!saved || saved.kind !== this.kind) return;
    const cam = this.rt.camera;
    const target = this.rt.controls.target;
    this.shift(saved.target.x - target.x, saved.target.y - target.z);
    cam.zoom = clamp(saved.zoom, ZOOM_MIN, ZOOM_MAX);
    cam.updateProjectionMatrix();
    this.moved = true;
    this.rt.requestRender();
  }

  /**
   * Write the view once it has been still a moment: a pan is sixty moves a
   * second, and the tab only needs to know where it ended.
   */
  private scheduleSave(): void {
    if (!this.sceneId) return;
    const target = this.rt.controls.target;
    this.pending = {
      kind: this.kind,
      target: { x: target.x, y: target.z },
      azimuth: this.azimuth(),
      zoom: this.rt.camera.zoom,
    };
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushSave();
    }, SAVE_MS);
  }

  /** Write a pending view now, under the scene it was taken in. */
  private flushSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const view = this.pending;
    this.pending = null;
    if (view === null || !this.sceneId) return;
    writeView(this.sceneId, view);
  }
}
