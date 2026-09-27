/**
 * The GM's fog bar, the parts of it that are rules rather than buttons
 * (the GM, 2026-09-27): the round brush, the size keys, and the one sentence
 * the bar says about what the table sees. Pure, so the pointer, the map's
 * ring and the tests all agree on it without a DOM.
 *
 * ## The round brush
 *
 * The brush paints a circle of squares, `size` squares across (1 to 10):
 * every square whose centre is within `size / 2` of the brush's centre. The
 * centre is where the pointer is, snapped the way a token of that size snaps
 * (`brushAnchor`): an odd size sits on the middle of the square under the
 * pointer, an even one on the grid corner nearest it. Without the snap a
 * circle's squares changed as the pointer wandered inside one square, the
 * ring on the map jittered, and a size-1 brush held over a grid corner
 * painted nothing at all, since no square's centre is within half a square
 * of a corner. Snapped, size 1 is exactly the square under the pointer (the
 * old square brush), 2 is the 2x2 round a corner, 3 the 3x3 block, and from
 * 4 up the corners fall away and the footprint is round.
 *
 * A drag walks the centres between two pointer samples (`cellsBetween` over
 * the anchors, as the tile brush walks squares), so a quick stroke leaves no
 * gaps, and paints each square once.
 */
import type { Point } from '@safehouse/contracts';
import type { BrushMark } from '@safehouse/rules';

/** The brush's size, in squares across: the bar's slider runs from one to the other. */
export const FOG_BRUSH_MIN = 1;
export const FOG_BRUSH_MAX = 10;
/** What the brush starts at: a small room's worth, rather than one square at a time. */
export const FOG_BRUSH_DEFAULT = 3;

/** A size the brush can be: a whole number of squares, from `FOG_BRUSH_MIN` to `FOG_BRUSH_MAX`. */
export function clampBrushSize(n: number): number {
  if (!Number.isFinite(n)) return FOG_BRUSH_DEFAULT;
  return Math.max(FOG_BRUSH_MIN, Math.min(FOG_BRUSH_MAX, Math.round(n)));
}

/**
 * What the brush paints, in the order the bar's list offers it and in the
 * GM's words: revealed (live: the map and everyone on it), revealed as seen
 * before (dimmed, with nobody on it), or fogged again. The three marks the
 * server keeps (`FogBrushLevelSchema`).
 */
export const FOG_BRUSH_MODES: ReadonlyArray<{ paint: BrushMark; label: string; hint: string }> = [
  { paint: 'live', label: 'Reveal', hint: 'the map and everyone on it' },
  { paint: 'explored', label: 'Reveal as seen before', hint: 'dimmed, with nobody on it' },
  { paint: 'hidden', label: 'Fog again', hint: 'hidden, even in an open room' },
];

/** A square, by column and row. */
export interface BrushCell {
  col: number;
  row: number;
}

/**
 * Where the brush's centre goes for pointer `p` (grid units), as a whole
 * number pair: for an odd size the square under the pointer, for an even
 * size the grid corner nearest it (see the top of the file). `brushCentre`
 * turns it back into a point.
 */
export function brushAnchor(p: Point, size: number): BrushCell {
  const odd = clampBrushSize(size) % 2 === 1;
  return odd ? { col: Math.floor(p.x), row: Math.floor(p.y) } : { col: Math.round(p.x), row: Math.round(p.y) };
}

/** The brush's centre, in grid units, for an anchor (`brushAnchor`). */
export function brushCentre(anchor: BrushCell, size: number): Point {
  const odd = clampBrushSize(size) % 2 === 1;
  return odd ? { x: anchor.col + 0.5, y: anchor.row + 0.5 } : { x: anchor.col, y: anchor.row };
}

/** The ring's radius, in squares, for a brush `size` squares across. */
export function brushRadius(size: number): number {
  return clampBrushSize(size) / 2;
}

/**
 * The squares a brush `size` squares across paints with its centre at
 * `centre`: every square whose centre is within the radius (`brushRadius`),
 * row by row. With `bounds`, only squares on the grid: a circle over the
 * map's edge paints the part of it on the map, and the server is never sent
 * a square it would refuse.
 */
export function brushSquares(centre: Point, size: number, bounds?: { cols: number; rows: number }): BrushCell[] {
  const r = brushRadius(size);
  // A hair over the radius, so a centre exactly on the circle is in it
  // whatever the floating point makes of the sum.
  const reach = r * r + 1e-9;
  const out: BrushCell[] = [];
  const r0 = Math.floor(centre.y - r);
  const r1 = Math.ceil(centre.y + r);
  const c0 = Math.floor(centre.x - r);
  const c1 = Math.ceil(centre.x + r);
  for (let row = r0; row <= r1; row += 1) {
    if (bounds && (row < 0 || row >= bounds.rows)) continue;
    for (let col = c0; col <= c1; col += 1) {
      if (bounds && (col < 0 || col >= bounds.cols)) continue;
      const dx = col + 0.5 - centre.x;
      const dy = row + 0.5 - centre.y;
      if (dx * dx + dy * dy <= reach) out.push({ col, row });
    }
  }
  return out;
}

/**
 * What a key does to the brush's size while it is in hand: `]` one square
 * bigger, `[` one smaller, anything else nothing. The keys every paint
 * program taught.
 */
export function brushSizeStep(key: string): -1 | 0 | 1 {
  if (key === ']') return 1;
  if (key === '[') return -1;
  return 0;
}

/** Everything the bar's sentence depends on. */
export interface FogBarState {
  /** The fog is on for the table (`fogOn`, or the party's sight, which fogs a scene too: `sceneFogOn`). */
  fog: boolean;
  /** The party's sightlines are on (`SceneVision.sight`). */
  sight: boolean;
  /** The brush, when it is in hand: what it paints and how big it is. */
  brush: { paint: BrushMark; size: number } | null;
  /** The GM is looking through the players' eyes (the party lens). */
  asPlayers: boolean;
}

/** "a 3-square circle", or "one square" for the smallest brush. */
function brushArea(size: number): string {
  const n = clampBrushSize(size);
  return n === 1 ? 'one square' : `a ${n}-square circle`;
}

/**
 * The one sentence under the bar's buttons: what the table sees now, or,
 * while the brush is in hand, what a drag will do, or, while the GM looks
 * through the players' eyes, that she is. In that order, because each is
 * what the GM is in the middle of.
 */
export function fogBarHint(s: FogBarState): string {
  if (s.asPlayers) return 'You see the map as the players and the TV do; press See as players again to go back.';
  if (s.brush) {
    if (!s.fog) return 'The fog is off, so the table sees the whole map whatever you paint.';
    const what = brushArea(s.brush.size);
    const verb =
      s.brush.paint === 'live'
        ? `reveal ${what}`
        : s.brush.paint === 'explored'
          ? `reveal ${what} as seen before`
          : `fog ${what} again`;
    return `Drag on the map to ${verb}; [ and ] change the size.`;
  }
  if (!s.fog) return 'The players and the TV see the whole map.';
  if (s.sight) return 'The players and the TV see what you reveal and what the runners see; rooms they have left stay dimmed.';
  return 'The players and the TV see only what you reveal.';
}
