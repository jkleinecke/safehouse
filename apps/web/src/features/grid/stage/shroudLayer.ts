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
import { cellCorners, cellDepth, type SceneMetrics } from '../geometry.js';
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
    const corners = cellCorners(m, cell.col, cell.row);
    g.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i += 1) g.lineTo(corners[i]!.x, corners[i]!.y);
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
