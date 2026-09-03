/**
 * Line of sight and cover over the tactical grid (FR9.16).
 *
 * ## Why this lives in the rules package and not the renderer
 *
 * Sight is a RULE, not a picture. It decides whether a shot is possible and
 * what it costs, so the server has to be able to compute it for an authoritative
 * roll, and the GM's canvas has to compute the same answer to draw the overlay.
 * One implementation, no drift — the same reason dice live here.
 *
 * Everything below works in GRID coordinates: cells and unit-square steps. It
 * knows nothing about isometric projection, camera zoom, or pixels. That is
 * deliberate and it is what makes the isometric view a rendering change rather
 * than a rules change — turning the map 30° must not alter who can shoot whom.
 *
 * ## Two kinds of obstacle, because the app has two
 *
 * Drawn walls are line SEGMENTS the GM traced (`geometry.walls`, with doors
 * that open). Painted walls are CELLS from a tileset. Both are real and a scene
 * routinely has both, so the ray is tested against each: segment intersection
 * for the traced ones, a grid walk for the painted ones.
 *
 * ## Cover
 *
 * Height carries it (`TILE_HEIGHTS`). Waist-high things — a bar counter, a
 * collapsed wall, a parked car — are cover: the sightline survives, the shot
 * gets harder. Full-height things end the sightline instead, and something that
 * ends a sightline is not "cover", it is a wall. Glass is the interesting case
 * and the reason `blocksSight` is separate from height: full height, stops the
 * body, stops neither the eye nor the bullet.
 */
import type { Point } from '@safehouse/contracts';

/** How obstructed a sightline is. `full` means there is no sightline at all. */
export type CoverLevel = 'none' | 'partial' | 'full';

/** One traced obstacle, in grid coordinates. */
export interface SightSegment {
  id: string;
  a: Point;
  b: Point;
  /** An open door stops nothing; a closed one stops both. */
  blocksSight: boolean;
}

/**
 * What a single painted cell does to a sightline — and to a body.
 *
 * Movement lives here beside sight because they are genuinely independent and
 * the interesting tiles prove it: glass stops the body and not the eye, a
 * catwalk railing stops the body and not the eye either, an open railing is
 * cover without being an obstacle to a bullet. A model that carried only sight
 * would have to drop glass entirely — and then a corp office's partitions
 * would be walls a runner could stroll through.
 */
export interface SightCell {
  /** Ends the sightline outright. */
  blocksSight: boolean;
  /** Waist-high: the line survives, the shot is harder. */
  givesCover: boolean;
  /** Stops a token entering. Anything standing proud of the floor does. */
  blocksMovement: boolean;
}

export interface SightModel {
  /** `"col,row"` → what that painted cell does. Sparse; absent means open. */
  cells: ReadonlyMap<string, SightCell>;
  /** Traced walls and closed doors. */
  segments: readonly SightSegment[];
}

export interface LosResult {
  /** Is there any sightline at all? */
  clear: boolean;
  cover: CoverLevel;
  /**
   * What obstructed it — a cell key or a segment id. Named so the roll's
   * provenance can say *why* the shot was penalised (Principle 3), rather
   * than presenting a number the GM has to take on faith.
   */
  blockedBy: string | null;
}

const EPSILON = 1e-9;

/** Do segments `p→p2` and `q→q2` properly cross? */
export function segmentsCross(p: Point, p2: Point, q: Point, q2: Point): boolean {
  const r = { x: p2.x - p.x, y: p2.y - p.y };
  const s = { x: q2.x - q.x, y: q2.y - q.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < EPSILON) return false; // parallel or collinear
  const qp = { x: q.x - p.x, y: q.y - p.y };
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;
  return t > EPSILON && t < 1 - EPSILON && u > EPSILON && u < 1 - EPSILON;
}

/**
 * Every cell the segment `from → to` passes through, endpoints INCLUDED.
 *
 * Amanatides–Woo voxel traversal: step to whichever axis boundary is nearer,
 * so the walk visits exactly the cells the ray truly crosses. Not Bresenham —
 * Bresenham draws a *line* and skips cells a ray genuinely passes through the
 * corner of, which for sight means shooting through a wall's corner.
 */
export function cellsAlong(from: Point, to: Point): Array<{ col: number; row: number }> {
  let col = Math.floor(from.x);
  let row = Math.floor(from.y);
  const lastCol = Math.floor(to.x);
  const lastRow = Math.floor(to.y);

  const out = [{ col, row }];
  if (col === lastCol && row === lastRow) return out;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  // Distance along the ray (in t, 0..1) to the next boundary on each axis.
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
  let tMaxX =
    stepX === 0 ? Infinity : ((stepX > 0 ? col + 1 - from.x : from.x - col) || 0) / Math.abs(dx);
  let tMaxY =
    stepY === 0 ? Infinity : ((stepY > 0 ? row + 1 - from.y : from.y - row) || 0) / Math.abs(dy);

  // Bounded by the Manhattan distance plus slack: every iteration advances one
  // axis by one cell, so it cannot outrun the target. The guard is here so a
  // NaN coordinate degrades to a short walk instead of hanging the canvas.
  const guard = Math.abs(lastCol - col) + Math.abs(lastRow - row) + 2;
  for (let i = 0; i < guard; i += 1) {
    if (tMaxX < tMaxY) {
      col += stepX;
      tMaxX += tDeltaX;
    } else {
      row += stepY;
      tMaxY += tDeltaY;
    }
    out.push({ col, row });
    if (col === lastCol && row === lastRow) break;
  }
  return out;
}

/** The centre of a cell, which is what a sightline actually runs between. */
export function cellCentre(col: number, row: number): Point {
  return { x: col + 0.5, y: row + 0.5 };
}

/**
 * Can the occupant of `from` see the occupant of `to`, and how covered are they?
 *
 * Both arguments are cell coordinates (integers). The ray runs centre to
 * centre. The two END cells are exempt from blocking — you are not hidden from
 * yourself by the crate you are standing behind, and a target standing *in* a
 * doorway is visible rather than invisible. A waist-high obstacle in either end
 * cell still counts as COVER, which is exactly what crouching behind the bar
 * should do.
 */
export function lineOfSight(
  from: { col: number; row: number },
  to: { col: number; row: number },
  model: SightModel,
): LosResult {
  if (from.col === to.col && from.row === to.row) {
    return { clear: true, cover: 'none', blockedBy: null };
  }

  // Sight is symmetric, so it is computed on a canonical ordering of the two
  // cells rather than in call order.
  //
  // Without this it is NOT symmetric, and the reason is subtle enough that a
  // property test is the only thing that finds it: the grid walk breaks ties
  // (`tMaxX < tMaxY`) toward one axis, and reversing the ray reverses which
  // side of the tie each step falls on. A ray that clips the corner of a wall
  // then passes one way and not the other. At the table that is the ork
  // shooting a guard who cannot shoot back — a bug that decides a firefight,
  // arriving as "the GM must have made a call I didn't follow".
  const swap = to.col < from.col || (to.col === from.col && to.row < from.row);
  const src = swap ? to : from;
  const dst = swap ? from : to;

  const a = cellCentre(src.col, src.row);
  const b = cellCentre(dst.col, dst.row);

  // Traced walls first: they are the GM's explicit statement about the map.
  for (const seg of model.segments) {
    if (!seg.blocksSight) continue;
    if (segmentsCross(a, b, seg.a, seg.b)) {
      return { clear: false, cover: 'full', blockedBy: seg.id };
    }
  }

  let cover: CoverLevel = 'none';
  let coverBy: string | null = null;

  for (const cell of cellsAlong(a, b)) {
    const key = `${cell.col},${cell.row}`;
    const info = model.cells.get(key);
    if (info === undefined) continue;

    const isEnd =
      (cell.col === src.col && cell.row === src.row) ||
      (cell.col === dst.col && cell.row === dst.row);

    if (info.blocksSight && !isEnd) {
      return { clear: false, cover: 'full', blockedBy: key };
    }
    // Cover counts even at the ends — crouching behind your own counter works.
    if (info.givesCover && cover === 'none') {
      cover = 'partial';
      coverBy = key;
    }
  }

  return { clear: true, cover, blockedBy: coverBy };
}
