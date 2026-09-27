/**
 * Which doors a runner can reach: the GM's rule for players' hands on doors.
 *
 * THE RULE (the GM, 2026-09-27): "a player can open or close a door only
 * when their runner is standing next to it; the GM can from anywhere." So
 * a player works a door only through a runner of theirs standing beside it,
 * and never from across the map. The GM is never judged by any of this; the
 * server asks only when the caller is not the GM, and the map only offers a
 * player the doors this says their runner can reach.
 *
 * ## Next to a door
 *
 * A runner is next to a door when some part of the door lies within one
 * square of the runner: a square either way, diagonals included (the way a
 * king moves on a chessboard), counted from the middle of the square the
 * runner stands in. As a picture: take the runner's square and grow it by
 * half a square on every side, into a box two squares wide with the runner
 * in its middle. A door that touches that box, its edges included, is
 * within reach (`reachBox`, `reachesDoor`).
 *
 * - A PAINTED door fills a square of its floor. Within reach means the
 *   door's square is the runner's own square or one of the eight around it.
 *   Two squares away, with a square of floor between them, is too far. That
 *   is the GM's rule said in squares, and it is exactly what the box gives.
 * - A TRACED door is a line the GM drew (`geometry.doors`), usually along a
 *   grid line between two squares. Within reach means the line passes within
 *   one square of the runner's middle. For a door one square long drawn
 *   along a grid line, that is the two squares it stands between and the
 *   square either side of each of them, six in all: a runner in a doorway's
 *   mouth, or one step to its side, reaches the handle; a runner a whole
 *   square back from the doorway does not. A door drawn off the grid lines
 *   (over a map image, through the middle of a row of squares) is reached
 *   the same way, from the squares it crosses and the squares round them,
 *   so how neatly the GM drew it does not change who can reach it.
 *
 * ## Floors
 *
 * A painted door is on its own floor, and only a runner standing on that
 * floor reaches it: the door of the flat upstairs is not opened from the
 * street under it. A traced door is the scene's, not a floor's (floors
 * carry tiles and nothing else), so it stands on every floor, as it does
 * for walls (`walkMapFor`) and for sight, and a runner on any floor reaches
 * it by where they stand.
 *
 * ## Which square, and big tokens
 *
 * A runner stands in the square its CENTRE is in (`squareOf`), as the wall
 * rule and the sight pass place it, so a token dropped off-centre reaches
 * from the square it is drawn in. A token bigger than one square reaches
 * from its whole body: the box is its body, snapped into the square its
 * centre is in the way the map snaps it (an odd size on the square's
 * middle, an even one on the square's top-left corner), grown by the same
 * half square. A drone two squares wide reaches a door beside either of its
 * halves, which is where a player would say it is standing.
 */
import type { Point } from '@safehouse/contracts';
import { parseCellKey } from '../tilesets/types.js';
import { squareOf } from './walk.js';

/** The token reaching: where it stands, on which floor, how big. */
export interface ReachingToken {
  x: number;
  y: number;
  /** The floor it stands on; absent is the ground. */
  level?: number | undefined;
  /** Its size in squares; absent is one. */
  size?: number | undefined;
}

/** Where a door is, as reaching reads it. */
export type DoorPlace =
  /** A door painted in square (`col`, `row`) of floor `level`. */
  | { kind: 'painted'; level: number; col: number; row: number }
  /** A traced door, the line from `a` to `b`, on every floor. */
  | { kind: 'traced'; a: Point; b: Point };

/** A box in grid units, edges included. */
export interface ReachBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Slack on every edge of the box, for a traced door drawn a hair outside it
 * by a pointer that snapped to a float. Far too small to reach a square.
 */
const EPSILON = 1e-9;

/**
 * The box within which a door is in `token`'s reach (see the header): its
 * body, as it stands snapped into the square its centre is in, grown by
 * half a square on every side. For a runner of one square that is a box two
 * squares wide centred on the middle of its square. Null for a token that
 * is not anywhere (a position that is not a number).
 */
export function reachBox(token: ReachingToken): ReachBox | null {
  if (!Number.isFinite(token.x) || !Number.isFinite(token.y)) return null;
  const size = token.size !== undefined && Number.isFinite(token.size) ? Math.max(1, Math.round(token.size)) : 1;
  const { col, row } = squareOf(token);
  const offset = size % 2 === 1 ? 0.5 : 0;
  const half = size / 2 + 0.5;
  return { minX: col + offset - half, minY: row + offset - half, maxX: col + offset + half, maxY: row + offset + half };
}

/**
 * Does the line from `a` to `b` touch `box`, edges included? Liang and
 * Barsky's clip: the part of the line inside each pair of the box's sides,
 * narrowed side by side, and the line touches the box when some of it is
 * left. A line of no length is a point, and touches when the point does.
 */
function lineTouchesBox(a: Point, b: Point, box: ReachBox): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let enter = 0;
  let leave = 1;
  // Each side says: the part of the line with `p * t <= q` is on the box's side of it.
  const sides: ReadonlyArray<readonly [p: number, q: number]> = [
    [-dx, a.x - (box.minX - EPSILON)],
    [dx, box.maxX + EPSILON - a.x],
    [-dy, a.y - (box.minY - EPSILON)],
    [dy, box.maxY + EPSILON - a.y],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      // Parallel to this side: all of the line is on the box's side of it, or none.
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > leave) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < leave) leave = t;
    }
  }
  return enter <= leave;
}

/**
 * Is `door` within `token`'s reach (see the header)? A painted door only
 * from its own floor; a traced door from any floor. A door or a token that
 * is not anywhere (a position that is not a number) is never in reach.
 */
export function reachesDoor(token: ReachingToken, door: DoorPlace): boolean {
  const box = reachBox(token);
  if (box === null) return false;
  if (door.kind === 'painted') {
    if ((token.level ?? 0) !== door.level) return false;
    if (!Number.isFinite(door.col) || !Number.isFinite(door.row)) return false;
    // The door's square, [col, col + 1] × [row, row + 1], meets the box.
    return door.col + 1 >= box.minX && door.col <= box.maxX && door.row + 1 >= box.minY && door.row <= box.maxY;
  }
  const { a, b } = door;
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return false;
  return lineTouchesBox(a, b, box);
}

/**
 * Where the door a request names is: a traced door by its id (null when the
 * scene has no door by that id), or a painted one by its `"col,row"` cell
 * and floor (null when the cell is not a cell key). Whether a door is
 * actually painted in that cell is not asked here: the caller that needs to
 * know reads the floor's tiles.
 */
export function doorPlaceOf(
  scene: { geometry?: { doors?: readonly { id: string; a: Point; b: Point }[] | undefined } | undefined },
  ref: { doorId?: string | undefined; cell?: string | undefined; level?: number | undefined },
): DoorPlace | null {
  if (ref.doorId !== undefined) {
    const door = scene.geometry?.doors?.find((d) => d.id === ref.doorId);
    return door ? { kind: 'traced', a: door.a, b: door.b } : null;
  }
  if (ref.cell === undefined) return null;
  const at = parseCellKey(ref.cell);
  return at ? { kind: 'painted', level: ref.level ?? 0, col: at.col, row: at.row } : null;
}
