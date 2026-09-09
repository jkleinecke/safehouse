/**
 * What a fixed eye sees (FR9.23): a security camera, a sensor, a turret.
 *
 * A token looks everywhere at once; a camera looks one way, and that is the
 * whole difference. Everything else is the same sightline a token gets —
 * the same walls, the same tiles, the same closed doors — trimmed to the
 * eye's field of view and its reach. A camera that could see through a wall
 * a guard cannot would be a second, worse model of the same room.
 *
 * Bearings are degrees on the plan, clockwise: 0 looks east (+x), 90 looks
 * south (+y). That is the convention screen maths already uses, so the
 * renderer draws a wedge from these numbers without converting them.
 */
import type { Point } from '@safehouse/contracts';
import type { SightModel } from './los.js';
import { visibleFrom, type VisibleCell } from './visible.js';

/** A fixed eye: where it is, which way it looks, how wide, how far. */
export interface ConeEye {
  at: Point;
  /** Degrees, 0 = east, clockwise. */
  facing: number;
  /** Field of view in degrees. 360 is a dome that sees all round. */
  fov: number;
  /** Reach in cells. */
  range: number;
}

/**
 * Signed degrees from `facing` to the bearing of `to` as seen from `from`,
 * in (-180, 180]. Zero is dead ahead; negative is to the left when facing
 * east on the plan.
 */
export function bearingOffset(from: Point, to: Point, facing: number): number {
  const bearing = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  let d = (bearing - facing) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Is `point` inside the eye's field of view? Reach is not checked here. */
export function inCone(eye: ConeEye, point: Point): boolean {
  if (eye.fov >= 360) return true;
  return Math.abs(bearingOffset(eye.at, point, eye.facing)) <= eye.fov / 2 + 1e-9;
}

/**
 * Every cell the eye covers, with the cover a shot into each would get.
 *
 * The eye's own cell is left out: a camera looks out from its bracket, and a
 * cone that lit its own mount would show a wall-mounted camera watching the
 * inside of the wall. The sightline still starts there, so a camera set into
 * a wall cell sees out of it — end cells never block (`lineOfSight`).
 */
export function coneCells(
  eye: ConeEye,
  model: SightModel,
  opts: { cols?: number; rows?: number } = {},
): Map<string, VisibleCell> {
  const origin = { col: Math.floor(eye.at.x), row: Math.floor(eye.at.y) };
  const reach = Math.max(0, eye.range);
  const seen = visibleFrom(origin, model, { range: Math.ceil(reach), ...opts });
  const out = new Map<string, VisibleCell>();
  for (const [key, cell] of seen) {
    if (cell.col === origin.col && cell.row === origin.row) continue;
    const centre = { x: cell.col + 0.5, y: cell.row + 0.5 };
    // Reach is measured from the eye itself, not its cell's centre, so a
    // camera in the corner of its square reaches a little further one way.
    if (Math.hypot(centre.x - eye.at.x, centre.y - eye.at.y) > reach) continue;
    if (!inCone(eye, centre)) continue;
    out.set(key, cell);
  }
  return out;
}
