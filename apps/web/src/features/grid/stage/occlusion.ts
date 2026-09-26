/**
 * What stands in front of a figure on the isometric map.
 *
 * The tile layer draws every wall and piece of furniture once, under the
 * tokens. A figure standing behind a wall must still disappear behind it, so
 * each figure is masked by the standing cells in front of it: drawn into a
 * graphics here, used as an inverse mask on the figure and as a plain mask
 * on its see-through copy (`TokenView.ghost`).
 *
 * "In front" is the painter's order the tile layer already uses: a cell
 * whose depth (`col + row` of its nearest corner) is greater than the
 * figure's square is drawn after it. Only the cells near enough to overlap
 * the figure on screen are taken — a few either side, a few deep — so a
 * figure costs the handful of cells round it, whatever the size of the map.
 */
import type { Graphics } from 'pixi.js';
import type { SceneMetrics } from '../geometry.js';
import { closeLights, cutOf, drawStandingCell, openLights, type TilePlan } from './tileLayer.js';

/**
 * Draw the standing cells in front of a figure at `at` (grid units) into
 * `g`. True when there were any — the see-through copy is only worth
 * showing then.
 */
export function drawOccluders(g: Graphics, m: SceneMetrics, plan: TilePlan, at: { x: number; y: number }, size: number): boolean {
  g.clear();
  const d0 = Math.floor(at.x) + Math.floor(at.y);
  // Across the screen, a cell spans col − row from `col − (row + 1)` to
  // `(col + 1) − row`; the figure is a little either side of its own.
  const across = at.x - at.y;
  const half = 0.6 * Math.sqrt(Math.max(1, size));
  // A full-height wall hides a figure from about two squares in front;
  // tall furniture and big tokens reach further.
  const reach = 5 + Math.ceil(size);
  let any = false;
  // A glowing cell queues its light for the lights pass; a mask has none.
  openLights();
  for (const cell of plan.standing) {
    const c1 = cell.col + (cell.span?.[0] ?? 1) - 1;
    const r1 = cell.row + (cell.span?.[1] ?? 1) - 1;
    const depth = c1 + r1;
    if (depth <= d0 || depth > d0 + reach) continue;
    if (c1 + 1 - cell.row < across - half || cell.col - (r1 + 1) > across + half) continue;
    // Glazing is seen through; so is the figure behind it.
    if (cell.seg === undefined && cutOf(cell.def) === 'glass') continue;
    drawStandingCell(g, m, cell, plan);
    any = true;
  }
  closeLights();
  return any;
}
