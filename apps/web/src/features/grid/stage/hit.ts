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
 */
import type { Point, Scene, Token } from '@safehouse/contracts';
import {
  distToSegment,
  pinHeadRise,
  tokenRadiusPx,
  worldFromGrid,
  worldGap,
  type SceneMetrics,
} from '../geometry.js';

/** Never make a token harder to hit than a fingertip, however small it draws. */
const MIN_TOKEN_HIT_PX = 12;

/** Topmost token whose drawn disc contains `at` (grid units). Later = on top. */
export function hitToken(
  m: SceneMetrics,
  tokens: readonly Token[],
  at: Point,
  opts: { onlyIds?: ReadonlySet<string> } = {},
): Token | null {
  let best: Token | null = null;
  let bestDist = Infinity;
  for (const token of tokens) {
    if (opts.onlyIds && !opts.onlyIds.has(token.id)) continue;
    // The disc the renderer actually draws — not a second guess at its size.
    const radius = Math.max(MIN_TOKEN_HIT_PX, tokenRadiusPx(m, token.size));
    const d = worldGap(m, at, { x: token.x, y: token.y });
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

/** Door whose midpoint knob is within `tolerancePx` world px of `at`. */
export function hitDoor(m: SceneMetrics, scene: Scene, at: Point, tolerancePx = 24): string | null {
  let best: string | null = null;
  let bestDist = tolerancePx;
  const p = worldFromGrid(m, at);
  for (const door of scene.geometry.doors) {
    const d = distToSegment(p, worldFromGrid(m, door.a), worldFromGrid(m, door.b));
    if (d <= bestDist) {
      bestDist = d;
      best = door.id;
    }
  }
  return best;
}

/**
 * Pin whose HEAD is within `tolerancePx` world px of `at` (FR9.3).
 *
 * The head, not the anchor. A pin draws as a stem rising from the point it
 * marks with the head on top, and the head is the part that looks clickable —
 * so testing the anchor meant the GM clicked the thing they could see and the
 * Pins panel stayed shut, while the live target was a bare dot underneath it.
 */
export function hitPin(m: SceneMetrics, scene: Scene, at: Point, tolerancePx = 24): string | null {
  let best: string | null = null;
  let bestDist = tolerancePx;
  const p = worldFromGrid(m, at);
  const rise = pinHeadRise(m);
  // Later pins draw on top, so a tie goes to the last one placed.
  for (const pin of scene.geometry.pins) {
    const foot = worldFromGrid(m, pin.at);
    // The WHOLE pin — stem included — because the stem is drawn and a GM who
    // clicks it plainly means that pin. Testing the head alone would have
    // swapped one unreachable target for another.
    const d = distToSegment(p, foot, { x: foot.x, y: foot.y - rise });
    if (d <= bestDist) {
      bestDist = d;
      best = pin.id;
    }
  }
  return best;
}

/** Wall whose segment is within `tolerancePx` world px of `at` (GM editing). */
export function hitWall(m: SceneMetrics, scene: Scene, at: Point, tolerancePx = 16): string | null {
  let best: string | null = null;
  let bestDist = tolerancePx;
  const p = worldFromGrid(m, at);
  for (const wall of scene.geometry.walls) {
    const d = distToSegment(p, worldFromGrid(m, wall.a), worldFromGrid(m, wall.b));
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
