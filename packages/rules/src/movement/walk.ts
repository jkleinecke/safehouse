/**
 * Where a runner can walk: the GM's rule for players' tokens and walls.
 *
 * THE RULE (the GM, 2026-09-27): "Only the GM should be able to move the
 * tokens through walls. During Play, the players should not be able to move
 * their tokens through walls at all." So a player moving a runner they
 * control can never pass a wall or a closed door. They may go AROUND walls,
 * and through open doors, as far as they like: there is no movement budget
 * here, because the GM did not ask for one, and a move that has to go the
 * long way round a building is still a legal move. The GM is never judged by
 * any of this; the server asks only when the mover is not the GM.
 *
 * ## What a wall is
 *
 * The GM said WALLS, and this reads the word the way the GM builds them, not
 * the way the sight model judges bodies (`SightCell.blocksMovement`, which
 * counts every chair and crate as well). Furniture and props never stop a
 * runner here: vaulting a desk or squeezing past a pallet stack is a thing
 * runners do, and the GM rules on it at the table.
 *
 * - A PAINTED square blocks when its structure layer holds a tile with a
 *   wall footprint — walls, windows, fences and railings the building tool
 *   lays, and doors. A painted door blocks while it is shut and is a doorway
 *   once opened (`layers.doors`), exactly as the sight model reads it.
 *   Stairs live in the same layer and never block: the whole point of a
 *   stair is walking onto it.
 * - An ARC wall (a wall at any angle, or a curved one: `layers.arcs`) blocks
 *   every square it passes through (`arcCells`), as a painted wall of its
 *   tile would, except where a door is painted in the square: the door is
 *   the opening in the arc there, and its own state decides.
 * - A TRACED wall (`geometry.walls`) and a CLOSED traced door
 *   (`geometry.doors`) block the CROSSING between two squares rather than a
 *   square: a traced wall is a line along the grid, with floor on both sides
 *   of it. A step from one square to the next is refused when the line
 *   between the two squares' centres meets the wall, ends included. Traced
 *   geometry is the scene's, not a floor's (floors carry tiles and nothing
 *   else), so it stands on every floor, as it does for sight.
 *
 * ## Steps, and no corner cutting
 *
 * A runner steps square by square to any of the eight neighbours. A
 * diagonal step is refused when EITHER of the two squares it slips between
 * is blocked, or when any of the four crossings around the corner is cut by
 * a traced wall, as well as when the diagonal itself is. That is the safe
 * reading and the one the GM's rule needs: a diagonal painted wall is a
 * staircase of squares that touch only at their corners, and a runner must
 * not squeeze between two of them; nor round the end of a traced wall by
 * clipping the corner it ends on. With no movement budget it costs nothing
 * but a second step where a diagonal would have done.
 *
 * ## Which square a token is in
 *
 * A token stands in the square its CENTRE is in (`floor(x)`, `floor(y)`: a
 * token's position is its centre, in grid units), as the sight pass and the
 * shroud place it. A token bigger than one square is judged by that one
 * square, too — the square its centre is in — so a drone two squares wide
 * walks where a runner walks. That keeps the rule the same for every token,
 * and a car that fits through a doorway on the map is the GM's call.
 *
 * A token already standing in a blocked square (the GM put it in a doorway
 * and then shut the door) may step out of it, to either side: what is
 * refused is ENTERING a wall, never leaving one. And a token that stays in
 * its own square is never refused, whatever that square is.
 *
 * ## One floor at a time
 *
 * A walk happens on ONE floor, the one the token stands on: the walls of
 * the catwalk do not stop a runner on the warehouse floor beneath it.
 * Changing floors is not walking. Taking the stairs is the GM's, from the
 * GM's screen, and a player's move never changes a token's floor (the
 * server's `playerMayWalk`).
 *
 * ## Off the map
 *
 * The walk happens on the scene's grid, widened to take in the two squares
 * it runs between, so a token the GM left off the edge of the map can still
 * be walked back onto it. Walls count wherever they stand; off the map
 * there are usually none, so a runner out there walks freely.
 */
import type { Point } from '@safehouse/contracts';
import { tilesetById } from '../tilesets/catalogue.js';
import { resolveTile } from '../tilesets/slots.js';
import { arcCells } from '../tilesets/arcs.js';
import { levelTiles, migrateTileLayer, type LayeredTiles } from '../tilesets/layers.js';
import { isStair, parseCellKey, type Tile } from '../tilesets/types.js';
import { cellsAlong } from '../vision/los.js';

/** The parts of a scene this needs — structural, like `SightSceneInput`. */
export interface WalkSceneInput {
  tiles?: LayeredTiles | undefined;
  /** Floors above the ground one. A walk happens on ONE of them. */
  levels?: readonly { id: string; name: string; tiles?: LayeredTiles | undefined }[] | undefined;
  /** The map's size in squares: the ground a search may cover. */
  grid?: { cols?: number | undefined; rows?: number | undefined } | undefined;
  geometry?:
    | {
        walls?: readonly { id: string; a: Point; b: Point }[] | undefined;
        doors?: readonly { id: string; a: Point; b: Point; open?: boolean | undefined }[] | undefined;
      }
    | undefined;
}

/** One square of the grid. */
export interface WalkSquare {
  col: number;
  row: number;
}

/**
 * The token doing the walking. Read for nothing yet: every token is judged
 * by the square its centre is in, whatever its size (see the header). Here
 * so a caller can pass the token it has, and so the day a big token wants
 * a wider berth is a change to this module and not to every caller.
 */
export interface WalkingToken {
  size?: number | undefined;
}

/**
 * One floor's walls as walking reads them, built once per floor
 * (`walkMapFor`). Keys are numeric (`squareKey`) because a search reads
 * them for every neighbour of every square it visits.
 */
export interface WalkMap {
  /** Squares a body cannot enter: painted walls, closed painted doors, arcs. */
  readonly blocked: ReadonlySet<number>;
  /**
   * Steps a traced wall or a closed traced door cuts, both ways round:
   * `squareKey(col, row) * 8 + direction` (`WALK_DIRECTIONS`).
   */
  readonly cut: ReadonlySet<number>;
}

/**
 * The eight steps, orthogonal first. The index is the `direction` in a
 * `WalkMap.cut` key.
 */
export const WALK_DIRECTIONS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function directionOf(dx: number, dy: number): number {
  return WALK_DIRECTIONS.findIndex(([x, y]) => x === dx && y === dy);
}

/** The same step taken the other way. */
const OPPOSITE: readonly number[] = WALK_DIRECTIONS.map(([dx, dy]) => directionOf(-dx, -dy));

/**
 * How far from the origin a square may be and still be judged. A million
 * squares each way is far past any map; a position beyond it (or not a
 * number at all) is refused rather than searched for.
 */
const SQUARE_LIMIT = 2 ** 20 - 2;
const OFFSET = 2 ** 20;
const STRIDE = 2 ** 21;

/**
 * The most squares one search may cover. The largest grid the fog keeps
 * (1024 × 1024) is a quarter of it; a move that would need more than this
 * — a token dragged a million squares off the map — is refused rather than
 * searched.
 */
const MAX_SEARCH_SQUARES = 2 ** 22;

/** A square as one number: exact for every square within `SQUARE_LIMIT`. */
export function squareKey(col: number, row: number): number {
  return (col + OFFSET) * STRIDE + (row + OFFSET);
}

/** The square a point (a token's centre, in grid units) stands in. */
export function squareOf(p: Point): WalkSquare {
  return { col: Math.floor(p.x), row: Math.floor(p.y) };
}

function judgeable(s: WalkSquare): boolean {
  return (
    Number.isFinite(s.col) &&
    Number.isFinite(s.row) &&
    Math.abs(s.col) <= SQUARE_LIMIT &&
    Math.abs(s.row) <= SQUARE_LIMIT
  );
}

/** A tile with a wall's footprint: a wall, a window, a fence, a door. Never a stair. */
function isWallTile(tile: Tile): boolean {
  return tile.footprint === 'wall' && !isStair(tile);
}

const EPSILON = 1e-9;

/**
 * Does the step from centre `p` to centre `p2` meet the wall `q → q2`?
 *
 * Both ends of BOTH segments count. The wall's ends, because a wall drawn
 * in two pieces has an end in the middle of it (the joint the sight model
 * treats specially, `segmentTouchAt`), and a step through that joint must
 * be stopped. The step's ends, because a wall drawn through a square's
 * centre would otherwise let a runner step onto it from one side and off it
 * on the other. A step running ALONG a wall (parallel to it) does not cross
 * it, and nor does a wall of no length.
 */
function stepMeetsWall(p: Point, p2: Point, q: Point, q2: Point): boolean {
  const r = { x: p2.x - p.x, y: p2.y - p.y };
  const s = { x: q2.x - q.x, y: q2.y - q.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < EPSILON) return false;
  const qp = { x: q.x - p.x, y: q.y - p.y };
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;
  return t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON;
}

/**
 * Every step a traced wall cuts, into `cut`.
 *
 * A step runs between two square centres and lies inside those two squares,
 * so a wall can only meet steps out of the squares it passes through and
 * their neighbours: those are the only ones tested. A point on a square's
 * edge is floored into ONE of the squares that share the edge, which is why
 * the neighbours are taken as well.
 */
function cutByWall(a: Point, b: Point, cut: Set<number>): void {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return;
  const near = new Set<number>();
  for (const cell of cellsAlong(a, b)) {
    for (let dc = -1; dc <= 1; dc += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        const col = cell.col + dc;
        const row = cell.row + dr;
        if (!judgeable({ col, row })) continue;
        const key = squareKey(col, row);
        if (near.has(key)) continue;
        near.add(key);
        const from = { x: col + 0.5, y: row + 0.5 };
        WALK_DIRECTIONS.forEach(([dx, dy], dir) => {
          if (cut.has(key * 8 + dir)) return;
          if (!judgeable({ col: col + dx, row: row + dy })) return;
          const to = { x: from.x + dx, y: from.y + dy };
          if (!stepMeetsWall(from, to, a, b)) return;
          cut.add(key * 8 + dir);
          cut.add(squareKey(col + dx, row + dy) * 8 + OPPOSITE[dir]!);
        });
      }
    }
  }
}

const NO_TILES = {};
const NO_GEOMETRY = {};
const cache = new WeakMap<object, WeakMap<object, WalkMap>>();

/**
 * The walls of one floor of `scene`, as walking reads them.
 *
 * Built from the floor's tiles and the scene's traced geometry and nothing
 * else, and cached on exactly those two objects: a token moving, the fog
 * changing or the scene being renamed hands the canvas a new scene object
 * around the SAME tiles and geometry, and the map is not built again for
 * every frame of a drag. A door opened or a wall painted arrives as new
 * tiles or new geometry, which is a new map. Scenes are read, never written
 * in place, here as everywhere else they are drawn from.
 *
 * Unknown tilesets and tile ids are skipped rather than guessed at, as the
 * sight model skips them: a scene painted from a set this build does not
 * have loses its walls, rather than becoming one.
 */
export function walkMapFor(scene: WalkSceneInput, level = 0): WalkMap {
  // A floor that is not a number is the ground, rather than no floor at all
  // (which would be a floor with no walls).
  const tiles = levelTiles(scene, Number.isFinite(level) ? level : 0);
  const geometry = scene.geometry;
  const tilesKey: object = tiles ?? NO_TILES;
  const geometryKey: object = geometry ?? NO_GEOMETRY;
  let byGeometry = cache.get(tilesKey);
  const hit = byGeometry?.get(geometryKey);
  if (hit !== undefined) return hit;

  const blocked = new Set<number>();
  if (tiles !== undefined) {
    const set = tilesetById(tiles.tilesetId);
    if (set !== null) {
      const byRef = (ref: string): Tile | undefined => resolveTile(set, ref) ?? undefined;
      // Through the migration, so a scene painted before layers existed is
      // walked exactly as a migrated one is.
      const layers = migrateTileLayer(tiles);
      for (const [key, ref] of Object.entries(layers.structure)) {
        const cell = parseCellKey(key);
        if (cell === null || !judgeable(cell)) continue;
        const tile = byRef(ref);
        if (tile === undefined || !isWallTile(tile)) continue;
        // An OPEN painted door is a doorway (FR9.24): the runner walks
        // through the frame.
        if (tile.kind === 'door' && layers.doors?.[key]?.open === true) continue;
        blocked.add(squareKey(cell.col, cell.row));
      }
      for (const arc of layers.arcs ?? []) {
        const tile = byRef(arc.tile);
        if (tile === undefined || !isWallTile(tile)) continue;
        for (const key of arcCells(arc)) {
          const cell = parseCellKey(key);
          if (cell === null || !judgeable(cell)) continue;
          // A door painted in the arc's square is the opening in it: the
          // door decides, shut or open, above.
          const here = layers.structure[key];
          if (here !== undefined && byRef(here)?.kind === 'door') continue;
          blocked.add(squareKey(cell.col, cell.row));
        }
      }
    }
  }

  const cut = new Set<number>();
  for (const wall of geometry?.walls ?? []) cutByWall(wall.a, wall.b, cut);
  for (const door of geometry?.doors ?? []) {
    // An open door is a hole in the wall: nothing to cross.
    if (door.open === true) continue;
    cutByWall(door.a, door.b, cut);
  }

  const map: WalkMap = { blocked, cut };
  if (byGeometry === undefined) {
    byGeometry = new WeakMap();
    cache.set(tilesKey, byGeometry);
  }
  byGeometry.set(geometryKey, map);
  return map;
}

/**
 * May a body step from square (`col`, `row`) to its neighbour in `dir`?
 *
 * The square stepped FROM is not asked about: leaving a wall one is
 * standing in is allowed (see the header). A diagonal needs both squares it
 * passes between open, and all four crossings round its corner, as well as
 * itself, uncut.
 */
export function walkStep(map: WalkMap, col: number, row: number, dir: number): boolean {
  const step = WALK_DIRECTIONS[dir];
  if (step === undefined) return false;
  const [dx, dy] = step;
  const blocked = (c: number, r: number) => map.blocked.has(squareKey(c, r));
  const cut = (c: number, r: number, d: number) => map.cut.size > 0 && map.cut.has(squareKey(c, r) * 8 + d);
  if (blocked(col + dx, row + dy)) return false;
  if (cut(col, row, dir)) return false;
  if (dx === 0 || dy === 0) return true;
  if (blocked(col + dx, row) || blocked(col, row + dy)) return false;
  const across = directionOf(dx, 0);
  const down = directionOf(0, dy);
  return !(
    cut(col, row, across) ||
    cut(col, row, down) ||
    cut(col + dx, row, down) ||
    cut(col, row + dy, across)
  );
}

/**
 * Walk from `start` toward `goal` along the grid line between their centres
 * and stop before the first step a wall refuses.
 *
 * The line is walked square by square, one axis at a time, deciding which
 * edge it crosses next in whole numbers (so the same two squares always
 * walk the same way). Where the line passes EXACTLY through a corner it
 * steps diagonally, and when a wall refuses the diagonal it tries the two
 * ways round the corner, across first, each of them two legal steps: the
 * drag slides along the wall rather than sticking on its corner.
 */
function walkLine(map: WalkMap, start: WalkSquare, goal: WalkSquare): WalkSquare {
  const dx = goal.col - start.col;
  const dy = goal.row - start.row;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const across = directionOf(sx, 0);
  const down = directionOf(0, sy);
  const diagonal = directionOf(sx, sy);
  let col = start.col;
  let row = start.row;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    // Which edge the line crosses next: the one at (ix + ½)/nx along it, or
    // the one at (iy + ½)/ny, compared without dividing.
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      if (walkStep(map, col, row, diagonal)) {
        // Straight through the corner.
      } else if (walkStep(map, col, row, across) && walkStep(map, col + sx, row, down)) {
        // Round it, across first.
      } else if (walkStep(map, col, row, down) && walkStep(map, col, row + sy, across)) {
        // Round it, down first.
      } else {
        break;
      }
      col += sx;
      row += sy;
      ix += 1;
      iy += 1;
    } else if (decision < 0) {
      if (!walkStep(map, col, row, across)) break;
      col += sx;
      ix += 1;
    } else {
      if (!walkStep(map, col, row, down)) break;
      row += sy;
      iy += 1;
    }
  }
  return { col, row };
}

/** A grid side as a whole, non-negative number of squares. */
function gridSide(n: number | undefined): number {
  return n !== undefined && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * Is there any path of legal steps from `start` to `goal` over the squares
 * of `bounds`? A breadth-first search, over flat arrays because it visits
 * every square it can reach when the answer is no.
 */
function reachable(
  map: WalkMap,
  start: WalkSquare,
  goal: WalkSquare,
  bounds: { minCol: number; minRow: number; maxCol: number; maxRow: number },
): boolean {
  const width = bounds.maxCol - bounds.minCol + 1;
  const height = bounds.maxRow - bounds.minRow + 1;
  if (width <= 0 || height <= 0 || width * height > MAX_SEARCH_SQUARES) return false;
  const size = width * height;
  const index = (col: number, row: number) => (row - bounds.minRow) * width + (col - bounds.minCol);
  const seen = new Uint8Array(size);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  const first = index(start.col, start.row);
  const target = index(goal.col, goal.row);
  seen[first] = 1;
  queue[tail++] = first;
  while (head < tail) {
    const at = queue[head++]!;
    const col = bounds.minCol + (at % width);
    const row = bounds.minRow + Math.floor(at / width);
    for (let dir = 0; dir < WALK_DIRECTIONS.length; dir += 1) {
      const [dx, dy] = WALK_DIRECTIONS[dir]!;
      const nc = col + dx;
      const nr = row + dy;
      if (nc < bounds.minCol || nc > bounds.maxCol || nr < bounds.minRow || nr > bounds.maxRow) continue;
      const next = index(nc, nr);
      if (seen[next] === 1) continue;
      if (!walkStep(map, col, row, dir)) continue;
      if (next === target) return true;
      seen[next] = 1;
      queue[tail++] = next;
    }
  }
  return false;
}

/**
 * May a runner walk from `from` to `to` on floor `level` without passing a
 * wall or a closed door? Both are points in grid units — a token's centre —
 * and each is judged by the square it is in (see the header).
 *
 * Any route counts, however long: round the building, through the open door
 * at the back. The straight line is tried first because it is nearly always
 * the answer and costs a handful of steps; only a move that has to go round
 * something searches.
 *
 * Staying in the same square is always allowed. A point that is not a
 * number, or absurdly far off the map, is refused rather than judged.
 */
export function canWalk(
  scene: WalkSceneInput,
  level: number,
  from: Point,
  to: Point,
  token?: WalkingToken,
): boolean {
  void token; // judged by its centre's square, whatever its size (header)
  const start = squareOf(from);
  const goal = squareOf(to);
  if (!judgeable(start) || !judgeable(goal)) return false;
  if (start.col === goal.col && start.row === goal.row) return true;
  const map = walkMapFor(scene, level);
  if (map.blocked.has(squareKey(goal.col, goal.row))) return false;
  const straight = walkLine(map, start, goal);
  if (straight.col === goal.col && straight.row === goal.row) return true;
  // The map, widened to take in both ends (a token off the edge of it).
  const cols = gridSide(scene.grid?.cols);
  const rows = gridSide(scene.grid?.rows);
  const bounds = {
    minCol: Math.min(0, start.col, goal.col),
    minRow: Math.min(0, start.row, goal.row),
    maxCol: Math.max(cols - 1, start.col, goal.col),
    maxRow: Math.max(rows - 1, start.row, goal.row),
  };
  return reachable(map, start, goal, bounds);
}

/**
 * The square a drag reaches heading from `from` toward `target` on floor
 * `level`: it follows the grid line between the two squares step by step
 * and stops in the last square before the first step a wall refuses. Both
 * points are in grid units, each judged by the square it is in.
 *
 * For the client's drag: a player's runner stops at the wall, instead of
 * being drawn through it and then refused on the drop. Every square this
 * returns is one `canWalk` allows from `from`, so the drop it leads to is
 * one the server accepts.
 */
export function walkToward(scene: WalkSceneInput, level: number, from: Point, target: Point): WalkSquare {
  const start = squareOf(from);
  const goal = squareOf(target);
  if (!judgeable(start) || !judgeable(goal)) return start;
  if (start.col === goal.col && start.row === goal.row) return start;
  return walkLine(walkMapFor(scene, level), start, goal);
}
