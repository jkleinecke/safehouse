/**
 * The shroud: everything one pair of eyes cannot see (FR9.16).
 *
 * ## What it is and is not
 *
 * A DARKENING, not a deletion. The cells are still drawn underneath — this
 * lays a scrim over the ones outside the viewer's sightline, so a player can
 * tell at a glance which squares they can actually act on, and a GM can put a
 * token's point of view on screen while planning.
 *
 * That is the same line the map has always drawn: fog and vision are a
 * presentation boundary for TERRAIN and a secrecy boundary for everything
 * else. Hidden tokens, GM pins and unrevealed fog regions never reach a player
 * socket at all (`sceneForViewer`); the floor plan does. Making terrain secret
 * would mean streaming the map as players explore it, which is a different
 * product, and buys nothing at a table all looking at one TV.
 *
 * ## Why it draws the hidden cells rather than clipping the visible ones
 *
 * Painting a scrim over ~200 hidden cells is one pass of flat polygons. The
 * alternative — a stencil or a mask of the visible region — needs a render
 * texture, breaks the "one Graphics per static layer" discipline the stage is
 * built on, and costs more than it saves at this scale.
 */
import type { Graphics } from 'pixi.js';
import type { Point } from '@safehouse/contracts';
import { cellCorners, cellDepth, heightRise, type SceneMetrics } from '../geometry.js';
import { C } from './colors.js';

/** How dark the scrim is. Enough to read as "not yours", not enough to hide. */
const SHROUD_ALPHA = 0.62;

/** A softer wash for the GM, who is being shown a viewpoint, not limited to it. */
const GM_SHROUD_ALPHA = 0.34;

export interface ShroudInput {
  /** `"col,row"` of every cell the viewer CAN see. */
  visible: ReadonlySet<string>;
  /**
   * The GM is previewing somebody else's eyes and still needs to run the rest
   * of the map, so their scrim is lighter — it informs rather than restricts.
   */
  gm: boolean;
  /** `"col,row"` → how tall that square stands, in cells. Absent is flat. */
  heights?: ReadonlyMap<string, number> | undefined;
}

/**
 * The screen outline of one square's content, ground plane included.
 *
 * A flat square is its diamond. A square with something standing in it is that
 * diamond swept upward — a hexagon, because the extrusion hides the two back
 * edges of the bottom and the two front edges of the top. Walking the ground
 * corners [N, E, S, W] as W-S-E and then the top corners back as E'-N'-W'
 * traces exactly the silhouette `drawBox` produces, which is the point: the
 * scrim has to cover what the tile layer drew, not what the grid says is there.
 */
function cellSilhouette(m: SceneMetrics, col: number, row: number, height: number): Point[] {
  const [n, e, s, w] = cellCorners(m, col, row);
  const rise = heightRise(m, height);
  if (rise <= 0) return [n, e, s, w];
  const up = (p: Point): Point => ({ x: p.x, y: p.y - rise });
  return [w, s, e, up(e), up(n), up(w)];
}

/**
 * Draw the scrim. An empty `visible` set means "no viewpoint chosen" and draws
 * NOTHING — an unselected token must not black out the whole table.
 */
export function drawShroud(
  g: Graphics,
  m: SceneMetrics,
  input: ShroudInput | null,
): void {
  g.clear();
  if (input === null || input.visible.size === 0) return;

  const alpha = input.gm ? GM_SHROUD_ALPHA : SHROUD_ALPHA;

  // Back to front, like every other layer, so the scrim over a near cell sits
  // on top of the one behind it and the seams do not double up.
  const hidden: Array<{ col: number; row: number }> = [];
  for (let col = 0; col < m.cols; col += 1) {
    for (let row = 0; row < m.rows; row += 1) {
      if (input.visible.has(`${col},${row}`)) continue;
      hidden.push({ col, row });
    }
  }
  hidden.sort((a, b) => cellDepth(a.col, a.row) - cellDepth(b.col, b.row));

  for (const cell of hidden) {
    const height = input.heights?.get(`${cell.col},${cell.row}`) ?? 0;
    const outline = cellSilhouette(m, cell.col, cell.row, height);
    g.moveTo(outline[0]!.x, outline[0]!.y);
    for (let i = 1; i < outline.length; i += 1) g.lineTo(outline[i]!.x, outline[i]!.y);
    g.closePath().fill({ color: C.ground, alpha });
  }
}

/**
 * Redraw key for the shroud.
 *
 * Content-hashed on the visible SET, not on its size: a token stepping
 * sideways behind a pillar can reveal one cell and hide another, leaving the
 * count identical while the shape changes completely — which is exactly the
 * move a player makes when checking an angle.
 */
export function shroudKey(input: ShroudInput | null): string {
  if (input === null || input.visible.size === 0) return 'none';
  let acc = 0;
  // Heights fold into the same accumulator: repainting a waist-high crate as a
  // full wall changes the silhouette the scrim has to cover while leaving the
  // visible set — and so the old key — completely unmoved.
  for (const [key, h] of input.heights ?? []) {
    acc = (acc + Math.round(h * 1000) + key.length) >>> 0;
  }
  for (const key of input.visible) {
    // FNV-1a per key, summed — order-independent, so a re-derived set that
    // iterates differently does not force a pointless redraw.
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i += 1) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    acc = (acc + (h >>> 0)) >>> 0;
  }
  return `${input.gm ? 'gm' : 'pc'}|${input.visible.size}|${acc.toString(16)}`;
}
