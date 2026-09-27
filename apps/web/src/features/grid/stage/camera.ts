/**
 * A flat pan/zoom camera over the plan or isometric world of `geometry.ts` —
 * pure maths, no three, no DOM (unit-tested).
 *
 * Screen = world * scale + pan. `Camera` is a `ViewCamera` (`viewCamera.ts`):
 * `pick` and `project` are the grid ↔ world transform of `geometry.ts`
 * composed with this screen ↔ world one, in plan view or isometric, as the
 * metrics say.
 *
 * No renderer builds one. The map is drawn by the 3D stage, whose camera is
 * `Camera3D` (`stage3d/camera3d.ts`). This one is the projector the pointer
 * and hit tests run against (`hit.test.ts`, `pointer.test.ts`): at scale 1
 * with no pan its screen px ARE world px, so a test can work out by hand
 * where a token or a wall lands on screen. `camera.test.ts` pins its own
 * maths.
 *
 * `wheelZoomFactor`, at the bottom, is live: `pointer.ts` turns every wheel
 * notch and trackpad pinch into a zoom with it, whichever camera it drives.
 */
import type { Point } from '@safehouse/contracts';
import { CELL, gridFromWorld, heightRise, worldFromGrid, type SceneMetrics } from '../geometry.js';
import type { Lift, ViewCamera } from './viewCamera.js';

export const MIN_SCALE = 0.08;
export const MAX_SCALE = 6;

export interface Viewport {
  width: number;
  height: number;
}

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * What a camera made without a scene maps through: plan view, 64 px squares,
 * no offset — world px are grid units × 64. Only the pure pan/zoom maths
 * runs without a real scene; a test that picks or projects passes its own
 * metrics.
 */
const PLAN: SceneMetrics = {
  cell: CELL,
  cols: 1,
  rows: 1,
  unitM: 1,
  offset: { x: 0, y: 0 },
  opacity: 0,
  projection: 'topdown',
};

/**
 * A `Lift` as this flat camera reads it, in world px straight up the screen:
 * its own `px` when it has one, else its storeys at the flat projections'
 * squat storey height (`heightRise`, zero in plan view), else nothing.
 */
export function liftPx(m: SceneMetrics, lift: Lift | undefined): number {
  if (!lift) return 0;
  return lift.px ?? heightRise(m, lift.storeys ?? 0);
}

export class Camera implements ViewCamera {
  x = 0;
  y = 0;
  scale = 1;
  /** Set whenever x/y/scale changed; whoever draws through the camera clears it. */
  dirty = true;
  /**
   * True once the view has been panned, zoomed or focused since the last
   * `fit`: a fit is the resting state, a viewer's framing is not. It is the
   * rule the 3D camera keeps as `moved` (`stage3d/camera3d.ts`), re-fitting
   * on a resize only while nobody has framed the scene.
   */
  touched = false;

  /**
   * @param metricsOf the scene's metrics as they are NOW — read on every
   * `pick`/`project`, so a recalibration or a flip to isometric needs no
   * call here. Left out, a plain plan grid (`PLAN`).
   */
  constructor(private readonly metricsOf: () => SceneMetrics = () => PLAN) {}

  /** Screen px → grid units on the floor. This camera's world is one plane, so this never misses. */
  pick(screen: Point): Point {
    return gridFromWorld(this.metricsOf(), this.toWorld(screen.x, screen.y));
  }

  /** Grid units, raised by `lift` as this camera reads it (`liftPx`) → screen px. */
  project(grid: Point, lift?: Lift): Point {
    const m = this.metricsOf();
    const w = worldFromGrid(m, grid);
    return this.toScreen(w.x, w.y - liftPx(m, lift));
  }

  /** Screen px per grid unit: a square is `cell` world px across in both projections. */
  pxPerUnit(): number {
    return this.scale * this.metricsOf().cell;
  }

  /** Screen px → world px. */
  toWorld(sx: number, sy: number): Point {
    return { x: (sx - this.x) / this.scale, y: (sy - this.y) / this.scale };
  }

  /** World px → screen px. */
  toScreen(wx: number, wy: number): Point {
    return { x: wx * this.scale + this.x, y: wy * this.scale + this.y };
  }

  panBy(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.x += dx;
    this.y += dy;
    this.dirty = true;
    this.touched = true;
  }

  /** Zoom keeping the world point under `(sx, sy)` pinned to that screen px. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = clampScale(this.scale * factor);
    if (next === this.scale) return;
    const ratio = next / this.scale;
    this.x = sx - (sx - this.x) * ratio;
    this.y = sy - (sy - this.y) * ratio;
    this.scale = next;
    this.dirty = true;
    this.touched = true;
  }

  /** Put a world point at the centre of the viewport (focus here / open). */
  centerOn(wx: number, wy: number, view: Viewport): void {
    this.x = view.width / 2 - wx * this.scale;
    this.y = view.height / 2 - wy * this.scale;
    this.dirty = true;
    this.touched = true;
  }

  /** Fit a world-space rect into the viewport with a small margin. */
  fit(width: number, height: number, view: Viewport, margin = 24): void {
    if (width <= 0 || height <= 0 || view.width <= 0 || view.height <= 0) return;
    const s = clampScale(
      Math.min((view.width - margin * 2) / width, (view.height - margin * 2) / height),
    );
    this.scale = s;
    this.centerOn(width / 2, height / 2, view);
    // A fit is the resting state, not a viewer's framing.
    this.touched = false;
  }

  set(x: number, y: number, scale: number): void {
    this.x = x;
    this.y = y;
    this.scale = clampScale(scale);
    this.dirty = true;
    this.touched = true;
  }
}

/**
 * Wheel delta → zoom factor. Line/page deltaModes are normalised so a trackpad
 * pinch (pixels) and a mouse notch (lines) feel comparable.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const clamped = Math.max(-240, Math.min(240, px));
  return Math.exp(-clamped * 0.0016);
}
