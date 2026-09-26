/**
 * The GM's light-map view (docs/VISION.md §4.1): how dark each square is.
 *
 * A wash, not a lighting render. Every square gets a flat darkening polygon
 * whose strength is its light row — full light none at all, partial a
 * little, dim more, total darkness most — so a GM prepping a scene can see
 * at a glance where the shadows are that a runner could hide in, and where a
 * lamp they meant to leave on is lighting nothing. The same rows the dice
 * read: this is the modifier, drawn.
 *
 * `cellCorners` gives each square's outline in either projection, so the
 * wash lies on the floor in plan and in isometric alike. Walls standing on a
 * square are not swept upward the way the shroud's scrim is: this is a map
 * of the floor's light, read from above, and the tiles stay legible under it.
 */
import type { LightMap } from '@safehouse/rules';
import { cellCorners, type SceneMetrics } from '../geometry.js';
import { C } from './colors.js';
import type { Ink } from './ink.js';

/** How dark each light row draws: 0 full light, 1 partial, 2 dim, 3 total darkness. */
export const LIGHT_ROW_ALPHA: readonly [number, number, number, number] = [0, 0.18, 0.4, 0.65];

/**
 * Draw the wash. A null map draws nothing — the view is off. Squares the map
 * does not list are at the ambient row, so a pitch-black scene is one dark
 * sheet with its lamps cut out of it, and a daylit one draws nothing at all.
 */
export function drawLightMap(g: Ink, m: SceneMetrics, map: LightMap | null): void {
  g.clear();
  if (map === null) return;
  for (let col = 0; col < m.cols; col += 1) {
    for (let row = 0; row < m.rows; row += 1) {
      const alpha = LIGHT_ROW_ALPHA[map.rows.get(`${col},${row}`) ?? map.ambient];
      if (!alpha) continue;
      const [n, e, s, w] = cellCorners(m, col, row);
      g.poly([n.x, n.y, e.x, e.y, s.x, s.y, w.x, w.y]).fill({ color: C.ground, alpha });
    }
  }
}
