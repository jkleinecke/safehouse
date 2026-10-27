/**
 * The Line tool (Build): a press-drag lays a straight run of squares, and
 * the release paints the brush's tile on every one of them as one stroke.
 *
 * A freehand diagonal with the brush wobbles into a staircase; a run SNAPPED
 * to the eight directions does not. At 45° it is exactly one square per step
 * on both axes, so the squares touch only at their corners and the renderer
 * draws them as one straight diagonal wall (`plan/tiles.ts` `wallDiagonals`).
 * Shift lets the angle go free (Bresenham, `cellsBetween` in `pointer.ts`).
 */

/** A grid square, as integer column/row. */
export interface LineCell {
  col: number;
  row: number;
}

/**
 * The squares of a run from `from` toward `to`, snapped to the nearest of
 * the eight directions (0°, 45°, 90°, …), INCLUDING both ends. Its length is
 * the larger of the two distances, laid along that direction: a drag that is
 * mostly across and a little down is a straight run across, and one that is
 * near enough diagonal reaches as far as the pointer's farther coordinate.
 */
export function snappedLineCells(from: LineCell, to: LineCell): LineCell[] {
  const dx = to.col - from.col;
  const dy = to.row - from.row;
  if (dx === 0 && dy === 0) return [{ col: from.col, row: from.row }];
  // The nearest of the eight directions, as a step of -1, 0 or 1 on each axis.
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const angle = (octant * Math.PI) / 4;
  const sx = Math.round(Math.cos(angle));
  const sy = Math.round(Math.sin(angle));
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  const out: LineCell[] = [];
  for (let i = 0; i <= n; i += 1) out.push({ col: from.col + sx * i, row: from.row + sy * i });
  return out;
}
