/**
 * Fog of war as geometry (FR9.13/9.14): which ground a scene's fog has opened.
 *
 * Pure grid-space maths, like the rest of this folder. A fog region and a
 * revealed shape are polygons on the grid, in grid units, and a token stands
 * at a point in the same units — the centre of the square (or squares) it
 * occupies, where the map snaps it. So "is this token out in the open?" is a
 * point-in-polygon question, and the server asks it before it lets a token
 * onto a player's wire.
 *
 * Only the geometry lives here. Whether the fog is ON at all (`fogOn`) is a
 * property of the stored state and lives beside it in @safehouse/contracts,
 * and which tokens are withheld from whom is the server's policy
 * (`tokenConcealed` in apps/server/src/services/scenes.ts).
 *
 * Fog has no floors. A region is drawn once for the whole scene and covers
 * the same ground on every storey, exactly as the map's cover does, so
 * nothing here takes a level.
 */
import type { FogState, Point } from '@safehouse/contracts';

/**
 * Ray casting: is `p` inside `polygon`?
 *
 * A point exactly on an edge may come out either way, which does not matter
 * to any caller: the proximity nudge measures a distance of 0 there anyway,
 * and a token's centre sits half a square in from the grid lines a region is
 * drawn on. Fewer than three points enclose nothing and answer false.
 */
export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const straddles = a.y > p.y !== b.y > p.y;
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Whether the fog has opened the ground at `p`: inside a named region that
 * is revealed, or inside a freeform shape the GM painted open.
 *
 * This says nothing about whether the fog is on. A caller that wants "is `p`
 * hidden from the table" asks `fogOn` first; on a scene with its fog off,
 * every point is open whatever this answers.
 */
export function fogRevealedAt(fog: Pick<FogState, 'regions' | 'revealed' | 'revealedShapes'>, p: Point): boolean {
  if (fog.revealed.length > 0) {
    const revealed = new Set(fog.revealed);
    for (const region of fog.regions) {
      if (revealed.has(region.id) && pointInPolygon(p, region.polygon)) return true;
    }
  }
  for (const shape of fog.revealedShapes) {
    if (shape.length >= 3 && pointInPolygon(p, shape)) return true;
  }
  return false;
}
