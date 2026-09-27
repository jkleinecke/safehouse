/**
 * Where a dragged token goes, by who is dragging it: the GM's rule about
 * walls, on the pointer's side of the socket.
 *
 * THE RULE (the GM, 2026-09-27): "Only the GM should be able to move the
 * tokens through walls. During Play, the players should not be able to move
 * their tokens through walls at all." The server refuses a player's drop the
 * runner could not walk (`canWalk`, rules movement/walk.ts), but a drag that
 * drew the runner straight through a wall and then threw it back on the drop
 * would be a poor way to learn the rule. So the drag asks the same rules the
 * server does, while it happens: a player's runner follows the pointer only
 * as far as it could walk (`walkToward`), slides up to the wall and waits
 * there while the pointer wanders about on the other side, and the drop
 * sends the square it is waiting on, which the server accepts. The drag and
 * the drop cannot disagree about where the walls are, because they read the
 * same walls with the same code.
 *
 * The GM is never stopped: a GM's drag goes wherever the pointer does, as it
 * always has, whatever is in the way. Everyone else is walked: a player, and
 * (though neither drags anything today) an observer or the table display.
 *
 * ## Following the pointer round corners
 *
 * Each frame of the drag walks from where the token was drawn on the LAST
 * frame, not from where the drag began. A runner pressed against a wall
 * with the pointer beyond it stays put; bring the pointer round the end of
 * the wall and the runner comes round after it, square by square, the way a
 * runner walks. Walking from the drag's start instead would pin the runner
 * to the first wall on the straight line for the rest of the drag, however
 * far round the building the pointer went.
 *
 * ## On the map
 *
 * A player's runner is walked on the map: the scene's grid, widened only to
 * take in the square the token stood on when the drag began (a runner the GM
 * left off the edge can still be walked back on). The pointer beyond the
 * map's edge pulls the runner to the edge and no further. The server holds
 * a player's move to the same ground (`onWalkGround`, so a crafted drop far
 * off the map is refused before it is searched), and its search for a way
 * round a wall covers the grid and the two ends of the move and nothing
 * else, so a drag that went off the map, round a sealed room outside it and
 * back in would be dropped where the server finds no way, and refused. Kept
 * on the map,
 * every frame's walk runs one legal step at a time inside the ground the
 * server searches, from the square the token stands on — so whatever the
 * drag reaches, the server finds a way to, and accepts.
 *
 * ## What it costs
 *
 * Nearly nothing, which matters on a phone, where a drag is sixty of these a
 * second. The walls of a floor are worked out once (`walkMapFor`, cached in
 * the rules on the floor's tiles object and the scene's traced geometry
 * object): a token moving, the fog changing, the view switching between plan
 * and iso all hand the canvas a new scene around the SAME tiles and geometry,
 * so no frame of a drag builds that map again. A door opened or a wall
 * painted arrives as new tiles or new geometry, and the next frame builds the
 * new map once. What is left per frame is the walk itself: one step per
 * square the pointer moved, each a couple of set lookups. There is no
 * search: nothing here goes looking for a way round, it only walks.
 */
import type { Point, Role } from '@safehouse/contracts';
import {
  squareOf,
  walkBounds,
  walkToward,
  type WalkBounds,
  type WalkSceneInput,
  type WalkSquare,
} from '@safehouse/rules';

/** One frame of a token drag, as `walkDragTarget` needs it. */
export interface DragWalkInput {
  /** Who is dragging. Only the GM passes walls. */
  role: Role;
  /** The scene the drag is on: its grid, its floors' tiles, its traced walls and doors. */
  scene: WalkSceneInput;
  /** The floor the dragged token stands on (a drag never changes it). */
  level: number;
  /** The token's size in squares: where its centre sits in a square it is stopped in. */
  size: number;
  /** Where the token stood when the drag began: where the server walks the drop from. */
  origin: Point;
  /** Where the token is drawn now: `origin`, or where the last frame put it. */
  from: Point;
  /** Where the pointer would put it: the grab offset taken off, and snapped when snapping is on. */
  want: Point;
}

/**
 * Where the dragged token is drawn this frame, and dropped if the pointer
 * lets go now.
 *
 * - The GM: `want`, wherever it is.
 * - Anyone else: `want` when the runner can walk into its square along the
 *   grid line from `from` (`walkToward`) and that square is on the map
 *   (`walkBounds`) — so within a square, and anywhere the way is clear, the
 *   token follows the pointer exactly, snapped or not. Where a wall stops
 *   the walk short, or the pointer is off the map, the token stops in the
 *   last square it reached: at `from` itself when that is still the square
 *   it is in (so a runner shoved at the wall it already stands against does
 *   not twitch), and otherwise in that square as the token's size snaps
 *   (`centreIn`).
 */
export function walkDragTarget(input: DragWalkInput): Point {
  const { role, scene, level, size, origin, from, want } = input;
  if (role === 'gm') return want;
  const goal = squareOf(want);
  const aim = clampSquare(goal, walkBounds(scene, origin));
  const onMap = aim.col === goal.col && aim.row === goal.row;
  const reached = walkToward(scene, level, from, onMap ? want : { x: aim.col + 0.5, y: aim.row + 0.5 });
  if (onMap && reached.col === goal.col && reached.row === goal.row) return want;
  const start = squareOf(from);
  if (reached.col === start.col && reached.row === start.row) return from;
  return centreIn(reached, size);
}

/** A rectangle of squares, both ends included. */
export type SquareBounds = WalkBounds;

/**
 * The ground a player's runner is walked on: the scene's grid, widened to
 * take in the square of `origin` (where the token stood when the drag
 * began). The rules' own (`walkBounds`), because it is the server's too:
 * the server refuses a player's move that ends off this ground
 * (`onWalkGround`), and the rules search the same grid, widened by both
 * ends of the move (`canWalk`), so a drag kept on it is always inside what
 * the server accepts and searches.
 */
export { walkBounds };

/** `square`, moved the least way that puts it inside `b`. */
function clampSquare(square: WalkSquare, b: SquareBounds): WalkSquare {
  return {
    col: Math.min(b.maxCol, Math.max(b.minCol, square.col)),
    row: Math.min(b.maxRow, Math.max(b.minRow, square.row)),
  };
}

/**
 * Where a token of `size` squares stands when it is snapped into `square`:
 * the square's centre for an odd size (a runner, 1), and the square's
 * top-left corner for an even one (a van two squares wide), because an
 * even-sized token snaps its centre to the grid's corners (`snapCenter`) —
 * and the square a corner is floored into, the one the walk judges it by,
 * is the square to its lower right, which is `square`.
 */
export function centreIn(square: WalkSquare, size: number): Point {
  const s = Number.isFinite(size) ? Math.max(1, Math.round(size)) : 1;
  const offset = s % 2 === 1 ? 0.5 : 0;
  return { x: square.col + offset, y: square.row + offset };
}
