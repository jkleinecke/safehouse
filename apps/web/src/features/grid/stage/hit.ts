/**
 * Pointer hit-testing in world space — pure, no pixi (unit-tested).
 * We hit-test ourselves rather than using pixi's interaction tree: token
 * geometry is already known in grid units, so this is one cheap loop with no
 * display-object event plumbing and no per-frame hit-area rebuilds.
 */
import type { Point, Scene, Token } from '@safehouse/contracts';
import { distToSegment, gridDist, type SceneMetrics } from '../geometry.js';

/** Topmost token whose circle contains `at` (grid units). Later = on top. */
export function hitToken(
  tokens: readonly Token[],
  at: Point,
  opts: { onlyIds?: ReadonlySet<string> } = {},
): Token | null {
  let best: Token | null = null;
  let bestDist = Infinity;
  for (const token of tokens) {
    if (opts.onlyIds && !opts.onlyIds.has(token.id)) continue;
    const radius = Math.max(0.4, token.size / 2);
    const d = gridDist(at, { x: token.x, y: token.y });
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

/** Door whose midpoint knob is within `tolerance` grid units of `at`. */
export function hitDoor(scene: Scene, at: Point, tolerance = 0.6): string | null {
  let best: string | null = null;
  let bestDist = tolerance;
  for (const door of scene.geometry.doors) {
    const d = distToSegment(at, door.a, door.b);
    if (d <= bestDist) {
      bestDist = d;
      best = door.id;
    }
  }
  return best;
}

/** Screen-space distance in grid units — used to size click tolerances. */
export function gridTolerance(m: SceneMetrics, scale: number, screenPx = 10): number {
  const px = m.cell * Math.max(0.05, scale);
  return screenPx / px;
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
