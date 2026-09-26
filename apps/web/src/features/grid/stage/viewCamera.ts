/**
 * The camera the pointer code talks to — whichever renderer draws the map.
 *
 * Pure types, no pixi, no three, no DOM. `PointerController` and the hit
 * tests (`hit.ts`) work through this and nothing else, so the same input
 * handling runs over the 2D Pixi stage (`camera.ts`, `Camera`) and the
 * three.js stage, whose cameras are orthographic only: isometric and
 * top-down.
 *
 * Three spaces meet here:
 *   - SCREEN px: host-element pixels, origin at its top-left — what a
 *     pointer event carries once the element's rect is taken off.
 *   - GRID units: where everything on the map lives (tokens, walls, pins).
 *   - A height above the floor in view (`Lift`), for things that stand up
 *     from the point they mark — a figure's chest, a pin's head.
 *
 * Every hit test measures in screen px: it projects what it is testing
 * through `project` and compares the distance to the pointer against a
 * tolerance in screen px. That is the distance the eye judges, in any
 * projection and from any angle.
 */
import type { Point } from '@safehouse/contracts';

/**
 * How far above the floor a point stands, for `ViewCamera.project`.
 *
 * Two measures, because the two renderers draw height differently and the
 * 2D one has to stay exact:
 *   - `storeys` is the renderer-independent height: storeys above the floor
 *     in view, one storey being a full wall's height (a lamp's `height`
 *     field is in the same unit). The 3D camera lifts the point by exactly
 *     this.
 *   - `px` is the 2D stage's own measure: a rise straight up the screen in
 *     2D world px (64 per square at 1:1 zoom), the number its drawing code
 *     uses — `tokenHitLift`, `pinHeadRise`. Zero draws the point on the
 *     floor even where `storeys` says it hangs higher, which is how the 2D
 *     map draws lamp markers and camera eyes.
 *
 * Each renderer reads the measure native to it and falls back to the other:
 * 2D takes `px`, else `heightRise(storeys)` (its squat storey, zero in plan
 * view); 3D takes `storeys`, else `px` as a rise straight up the screen of
 * `px / 64` of a square's screen width (a billboard's offset). No lift, or
 * an empty one, is the floor itself.
 */
export interface Lift {
  storeys?: number;
  px?: number;
}

/**
 * A view onto the map that input can be resolved through: screen → floor,
 * floor (plus a lift) → screen, how big a square is on screen, and the
 * gestures that move the view.
 */
export interface ViewCamera {
  /**
   * The grid point on the floor in view under screen point `screen` (host
   * px), or null when the ray through it misses that floor. A 2D camera
   * never misses; every caller still guards, so a 3D one may.
   */
  pick(screen: Point): Point | null;
  /**
   * The screen point (host px) where grid point `grid`, raised by `lift`
   * above the floor in view, is drawn. The inverse of `pick` at zero lift.
   */
  project(grid: Point, lift?: Lift): Point;
  /**
   * Screen px per grid unit at `at`: the on-screen width of one square
   * there (in isometric, the width of its diamond). Sizes every tolerance
   * that is not a fixed number of screen px — `pxPerUnit / 64` screen px is
   * one 2D world px. Orthographic cameras give the same answer everywhere,
   * so `at` may be left out.
   */
  pxPerUnit(at?: Point): number;
  /** Move the view by a screen-px drag: the map follows the pointer. */
  panBy(dx: number, dy: number): void;
  /** Zoom by `factor`, keeping the floor point under screen `(sx, sy)` where it is. */
  zoomAt(sx: number, sy: number, factor: number): void;
  /** Turn the view about its focus, radians clockwise seen from above. Absent where the view cannot turn (2D). */
  rotateBy?(radians: number): void;
  /**
   * True once the viewer has panned, zoomed or turned the view since it was
   * last fitted. The stage re-fits on a resize only while this is false.
   */
  readonly touched: boolean;
}
