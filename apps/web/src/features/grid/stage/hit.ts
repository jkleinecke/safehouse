/**
 * Pointer hit-testing — pure, no pixi (unit-tested).
 *
 * We hit-test ourselves rather than using pixi's interaction tree: token
 * geometry is already known, so this is one cheap loop with no display-object
 * event plumbing and no per-frame hit-area rebuilds.
 *
 * ## Why this works in WORLD pixels
 *
 * It used to work in grid units, which is the same thing as screen distance
 * only in plan view. In isometric one grid unit is 32 px across and 16 px
 * down, so a grid-space circle is a 2:1 ellipse on screen: a size-1 token drew
 * as a 60 px disc and accepted clicks in a 45×23 px sliver of it. The GM
 * clicked the top of a runner they could plainly see and got a deselect.
 *
 * So every test here converts to world px through `worldFromGrid` and compares
 * against the SAME measurement the drawing code uses — `tokenRadiusPx`,
 * `pinHeadRise` — rather than a parallel number that has to be kept in step by
 * hand. Tolerances arrive in world px too (`worldTolerance`), so a click has
 * the same physical slop wherever it lands and whichever way the map is drawn.
 *
 * ## …measured on the SCREEN, through the view's camera
 *
 * World px are a 2D notion: screen px with the 2D camera's scale divided out.
 * A 3D view has no such plane, so every test here now projects through the
 * `ViewCamera` (`viewCamera.ts`) and measures in screen px. Nothing changes
 * in 2D: its projection is world px × scale + pan, a uniform scaling, so the
 * same world-px sizes (`tokenRadiusPx`, `pinHeadRise`, `noteFrame`, and every
 * world-px floor) are multiplied by `worldPxScale` — which IS the 2D camera
 * scale — and every comparison comes out as it did.
 *
 * `at` is still the GRID point the pointer picked: projected back at floor
 * height it is where the pointer is, in any view.
 */
import type { Point, Scene, Token } from '@safehouse/contracts';
import { sceneLevels, tileById } from '@safehouse/rules';
import {
  distToSegment,
  pinHeadRise,
  tokenHitLift,
  tokenRadiusPx,
  type SceneMetrics,
} from '../geometry.js';
import { inNoteFrame, noteFrame } from './notes.js';
import type { Lift, ViewCamera } from './viewCamera.js';

/**
 * Never make a token harder to hit than a fingertip, however small it draws.
 * World px (times `worldPxScale` on the screen), so this is the floor at 1:1;
 * callers pass a screen-derived slop (`screenHitSlop`) that scales it up as
 * the camera zooms out.
 */
const MIN_TOKEN_HIT_PX = 12;

/**
 * The hit radius a pointer needs, in world px, from what it is: a mouse
 * lands within a few screen pixels of what it means, a finger is a smear
 * about 22 px across. Converted through the camera scale, so a zoomed-out
 * map — the phone's default — does not shrink the target under the finger.
 * The hit tests take it in screen px: `screenHitSlop`.
 */
export function touchHitSlop(scale: number, pointerType: string | undefined): number {
  const screenPx = pointerType === 'touch' ? 22 : 12;
  return Math.max(MIN_TOKEN_HIT_PX, worldTolerance(scale, screenPx));
}

/**
 * Screen px per 2D world px at `at`: exactly the camera scale in 2D (a square
 * is `m.cell` world px); in 3D, a sixty-fourth of a square's screen width.
 * Multiplies every world-px size and floor into the screen px the tests
 * measure in.
 */
export function worldPxScale(view: ViewCamera, m: SceneMetrics, at?: Point): number {
  return view.pxPerUnit(at) / m.cell;
}

/**
 * `touchHitSlop` in screen px, for `hitToken`'s `minHitPx`: a finger's 22 px
 * or a mouse's 12, never under the 12 world px floor.
 */
export function screenHitSlop(
  view: ViewCamera,
  m: SceneMetrics,
  pointerType: string | undefined,
  at?: Point,
): number {
  const k = worldPxScale(view, m, at);
  return touchHitSlop(k, pointerType) * k;
}

/**
 * A click tolerance of `screenPx` screen px, never less than `screenPx` world
 * px — so a zoomed-in target's slop grows with it. In screen px; in 2D the
 * old `Math.max(N, worldTolerance(scale, N))` times the scale.
 */
export function screenTolerance(view: ViewCamera, m: SceneMetrics, screenPx: number, at?: Point): number {
  const k = worldPxScale(view, m, at);
  return Math.max(screenPx, worldTolerance(k, screenPx)) * k;
}

/** Chest height of a size-1 figure, in storeys, as the 3D map draws one to true scale. */
const TOKEN_CHEST_STOREYS = (0.75 * 1.8) / 3;

/**
 * Where a click on a token is measured from: its chest. In 2D the exact
 * `tokenHitLift` (zero in plan view); in 3D three quarters up a 1.8 m figure
 * in 3 m storeys, growing with the token's size as the 2D figure does.
 */
export function tokenChestLift(m: SceneMetrics, size: number): Lift {
  const grow = Math.sqrt(Math.max(0.5, size));
  return { storeys: TOKEN_CHEST_STOREYS * grow, px: tokenHitLift(m, size) };
}

/**
 * A security camera's eye: drawn flat on its mount point on the 2D map, and
 * just under the ceiling in 3D — 0.9 storeys, where a lamp's `height` puts a
 * ceiling fixture.
 */
export const CAMERA_EYE_LIFT: Lift = { storeys: 0.9, px: 0 };

/** A GM light's marker: flat on the floor in 2D, at the lamp's own `height` in 3D. */
export function lightMarkerLift(light: { height?: number }): Lift {
  return { storeys: light.height ?? 0.8, px: 0 };
}

/**
 * Topmost token whose drawn disc contains `at` (grid units), measured on the
 * screen through `view`. `minHitPx` is in screen px (`screenHitSlop`). Later
 * = on top.
 */
export function hitToken(
  view: ViewCamera,
  m: SceneMetrics,
  tokens: readonly Token[],
  at: Point,
  opts: { onlyIds?: ReadonlySet<string>; minHitPx?: number } = {},
): Token | null {
  let best: Token | null = null;
  let bestDist = Infinity;
  const k = worldPxScale(view, m, at);
  const floor = Math.max(MIN_TOKEN_HIT_PX * k, opts.minHitPx ?? 0);
  const p = view.project(at);
  for (const token of tokens) {
    if (opts.onlyIds && !opts.onlyIds.has(token.id)) continue;
    // The disc the renderer actually draws — not a second guess at its size —
    // or the pointer's own slop, whichever is the more forgiving.
    const radius = Math.max(floor, tokenRadiusPx(m, token.size) * k);
    // On the isometric map the figure stands up from its square: measure
    // from its chest (zero lift in plan, where this is the old disc test).
    const q = view.project({ x: token.x, y: token.y }, tokenChestLift(m, token.size));
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d > radius) continue;
    // Prefer the smaller/closer token when they overlap; ties go to the later
    // token (drawn on top).
    if (d <= bestDist) {
      bestDist = d;
      best = token;
    }
  }
  return best;
}

/**
 * Door whose line is within `tolerancePx` SCREEN px of `at` (default: 24
 * world px, `worldPxScale`).
 */
export function hitDoor(
  view: ViewCamera,
  m: SceneMetrics,
  scene: Scene,
  at: Point,
  tolerancePx?: number,
): string | null {
  let best: string | null = null;
  let bestDist = tolerancePx ?? 24 * worldPxScale(view, m, at);
  const p = view.project(at);
  for (const door of scene.geometry.doors) {
    const d = distToSegment(p, view.project(door.a), view.project(door.b));
    if (d <= bestDist) {
      bestDist = d;
      best = door.id;
    }
  }
  return best;
}

/**
 * Pin whose HEAD is within `tolerancePx` SCREEN px of `at` (FR9.3; default:
 * 24 world px, `worldPxScale`).
 *
 * The head, not the anchor. A pin draws as a stem rising from the point it
 * marks with the head on top, and the head is the part that looks clickable —
 * so testing the anchor meant the GM clicked the thing they could see and the
 * Pins panel stayed shut, while the live target was a bare dot underneath it.
 */
export function hitPin(
  view: ViewCamera,
  m: SceneMetrics,
  scene: Scene,
  at: Point,
  tolerancePx?: number,
): string | null {
  let best: string | null = null;
  let bestDist = tolerancePx ?? 24 * worldPxScale(view, m, at);
  const p = view.project(at);
  // The head stands a fixed rise up the screen from the anchor: exact world
  // px in 2D, a billboard's offset in 3D (`Lift`).
  const head: Lift = { px: pinHeadRise(m) };
  // Later pins draw on top, so a tie goes to the last one placed.
  for (const pin of scene.geometry.pins) {
    const foot = view.project(pin.at);
    // The WHOLE pin — stem included — because the stem is drawn and a GM who
    // clicks it plainly means that pin. Testing the head alone would have
    // swapped one unreachable target for another.
    const d = distToSegment(p, foot, view.project(pin.at, head));
    if (d <= bestDist) {
      bestDist = d;
      best = pin.id;
    }
  }
  return best;
}

/**
 * GM note whose box contains `at` (FR9.25), the box measured on the screen:
 * `noteFrame`'s world-px box, hung from the note's projected anchor and
 * scaled by `worldPxScale`. Later notes draw on top, so the last hit wins.
 */
export function hitNote(view: ViewCamera, m: SceneMetrics, scene: Scene, at: Point): string | null {
  const p = view.project(at);
  const k = worldPxScale(view, m, at);
  let best: string | null = null;
  for (const note of scene.geometry.gmNotes ?? []) {
    const f = noteFrame(m, note);
    const anchor = view.project(note.at);
    if (inNoteFrame({ ...f, x: anchor.x, y: anchor.y, w: f.w * k, h: f.h * k }, p)) best = note.id;
  }
  return best;
}

/**
 * The painted door under `at` on floor `level`, as its cell key (FR9.24), or
 * null when that cell holds no door tile. A painted door is the whole cell,
 * so the cell is the target — there is no knob to miss.
 */
export function hitTileDoor(scene: Scene, at: Point, level: number): string | null {
  const floor = sceneLevels(scene)[level];
  if (!floor?.tiles) return null;
  const key = `${Math.floor(at.x)},${Math.floor(at.y)}`;
  const id = floor.tiles.structure?.[key];
  if (id === undefined) return null;
  const tile = tileById(floor.tiles.tilesetId, id);
  return tile !== null && tile.kind === 'door' ? key : null;
}

/**
 * Wall whose segment is within `tolerancePx` SCREEN px of `at` (GM editing;
 * default: 16 world px, `worldPxScale`).
 */
export function hitWall(
  view: ViewCamera,
  m: SceneMetrics,
  scene: Scene,
  at: Point,
  tolerancePx?: number,
): string | null {
  let best: string | null = null;
  let bestDist = tolerancePx ?? 16 * worldPxScale(view, m, at);
  const p = view.project(at);
  for (const wall of scene.geometry.walls) {
    const d = distToSegment(p, view.project(wall.a), view.project(wall.b));
    if (d <= bestDist) {
      bestDist = d;
      best = wall.id;
    }
  }
  return best;
}

/**
 * A screen-pixel click slop expressed in world px.
 *
 * No projection term: world px ARE screen px once the camera scale is divided
 * out, which is the whole reason the hit tests moved into that space. The old
 * version divided by `m.cell` to reach grid units and was therefore 1.4× to
 * 2.8× too tight in isometric, depending on which way the user was aiming.
 */
export function worldTolerance(scale: number, screenPx = 10): number {
  return screenPx / Math.max(0.05, scale);
}

/**
 * Double-tap detection (FR9.15 ping). Pure so the thresholds are testable:
 * a second press within `withinMs` and `withinPx` of the first counts.
 */
export interface TapRecord {
  x: number;
  y: number;
  t: number;
}

export function isDoubleTap(
  prev: TapRecord | null,
  next: TapRecord,
  withinMs = 320,
  withinPx = 24,
): boolean {
  if (!prev) return false;
  if (next.t - prev.t > withinMs) return false;
  return Math.hypot(next.x - prev.x, next.y - prev.y) <= withinPx;
}

/**
 * Camera whose eye is within `tolerancePx` SCREEN px of `at` (GM editing,
 * FR9.23; default: 20 world px, `worldPxScale`).
 */
export function hitCamera(
  view: ViewCamera,
  m: SceneMetrics,
  scene: Scene,
  at: Point,
  tolerancePx?: number,
): string | null {
  let best: string | null = null;
  let bestDist = tolerancePx ?? 20 * worldPxScale(view, m, at);
  const p = view.project(at);
  // Later cameras draw on top, so a tie goes to the last one mounted.
  for (const cam of scene.geometry.cameras ?? []) {
    const eye = view.project(cam.at, CAMERA_EYE_LIFT);
    const d = Math.hypot(p.x - eye.x, p.y - eye.y);
    if (d <= bestDist) {
      bestDist = d;
      best = cam.id;
    }
  }
  return best;
}

/**
 * GM light whose marker is within `tolerancePx` SCREEN px of `at`, on floor
 * `level` only — the markers of other floors are not drawn, so they are not
 * there to click (VISION.md §4.1). Default tolerance: 20 world px
 * (`worldPxScale`).
 */
export function hitLight(
  view: ViewCamera,
  m: SceneMetrics,
  scene: Scene,
  at: Point,
  level: number,
  tolerancePx?: number,
): string | null {
  let best: string | null = null;
  let bestDist = tolerancePx ?? 20 * worldPxScale(view, m, at);
  const p = view.project(at);
  // Later lights draw on top, so a tie goes to the last one placed.
  for (const light of scene.geometry.lights ?? []) {
    if ((light.level ?? 0) !== level) continue;
    const q = view.project(light.at, lightMarkerLift(light));
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d <= bestDist) {
      bestDist = d;
      best = light.id;
    }
  }
  return best;
}
