/**
 * What one pair of eyes can see (FR9.16).
 *
 * `lineOfSight` answers "can A see B". This answers "what can A see at all",
 * which is the question a GM actually asks — and the one a player needs
 * answered before they commit to a move.
 *
 * ## Why this is a shroud and not a secret
 *
 * The visible SET is computed per viewer, but the map is still sent whole, the
 * same way an uploaded map image always has been. That is a deliberate line
 * and worth stating: fog and vision are a PRESENTATION boundary for terrain
 * and a SECRECY boundary for everything else. Hidden tokens, GM pins and
 * unrevealed fog regions are stripped server-side before a player socket ever
 * sees them (`sceneForViewer`); the floor plan is not.
 *
 * Making terrain secret would mean streaming the map cell by cell as players
 * explore, which changes what a scene IS — and buys little at a table where
 * everyone is looking at the same TV anyway.
 *
 * ## Cost
 *
 * One ray per cell in range, each walking at most `range` cells: a 30×20 room
 * at range 20 is a few thousand cheap integer steps. Deliberately not shadow-
 * casting — that is faster and much harder to reason about, and this runs once
 * per token move, not once per frame.
 */
import { lineOfSight, type CoverLevel, type SightModel } from './los.js';

export interface VisibilityOptions {
  /**
   * How far the eye reaches, in cells. Sight is not infinite in a sprawl at
   * night, and an unbounded radius on a large scene is work nobody sees.
   */
  range?: number;
  /** Stay inside the grid; cells outside it are not worth testing. */
  cols?: number;
  rows?: number;
}

export interface VisibleCell {
  col: number;
  row: number;
  /** How obstructed the sightline was — the cover a shot INTO this cell gets. */
  cover: CoverLevel;
}

/** Default sight radius in cells. Generous enough for a warehouse. */
export const DEFAULT_SIGHT_RANGE = 24;

/** `"col,row"` for a visible cell. */
export function visibleKey(col: number, row: number): string {
  return `${col},${row}`;
}

/**
 * Every cell visible from `from`, with the cover a shot into each would grant.
 *
 * The viewer's own cell is always included: a token can see where it is
 * standing even when it is standing in a doorway or behind a counter.
 *
 * Returns a Map so the caller gets both halves in one pass — the renderer
 * needs the keys to draw a shroud, and the GM's cover suggestion needs the
 * level for whichever cell the target is in. Computing them separately would
 * walk every ray twice.
 */
export function visibleFrom(
  from: { col: number; row: number },
  model: SightModel,
  opts: VisibilityOptions = {},
): Map<string, VisibleCell> {
  const range = Math.max(0, opts.range ?? DEFAULT_SIGHT_RANGE);
  const out = new Map<string, VisibleCell>();
  out.set(visibleKey(from.col, from.row), { col: from.col, row: from.row, cover: 'none' });

  const minCol = opts.cols === undefined ? from.col - range : Math.max(0, from.col - range);
  const maxCol =
    opts.cols === undefined ? from.col + range : Math.min(opts.cols - 1, from.col + range);
  const minRow = opts.rows === undefined ? from.row - range : Math.max(0, from.row - range);
  const maxRow =
    opts.rows === undefined ? from.row + range : Math.min(opts.rows - 1, from.row + range);

  for (let col = minCol; col <= maxCol; col += 1) {
    for (let row = minRow; row <= maxRow; row += 1) {
      if (col === from.col && row === from.row) continue;
      // Euclidean, so vision is a circle rather than the square that a
      // Chebyshev radius would give — a token does not see 24 cells diagonally
      // and 24 orthogonally by the same reach.
      if (Math.hypot(col - from.col, row - from.row) > range) continue;
      const los = lineOfSight(from, { col, row }, model);
      if (!los.clear) continue;
      out.set(visibleKey(col, row), { col, row, cover: los.cover });
    }
  }
  return out;
}
