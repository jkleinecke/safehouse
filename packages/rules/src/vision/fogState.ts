/**
 * The fog's three states, square by square and floor by floor (P6
 * sightlines; FR9.13/9.14).
 *
 * With the fog on, every square of every floor is one of:
 *
 * - LIVE: the table sees the map there and everyone standing on it, moving.
 *   The GM revealed the ground live (a revealed region or a revealed shape),
 *   or a runner can see it right now (the party's `live` sight).
 * - EXPLORED: the table sees the map there DIMMED, as remembered, with its
 *   doors and public pins, but nobody standing on it: no token, no token's
 *   light, no move. The GM revealed the ground as explored, or the party has
 *   seen it before (the party's `explored` memory).
 * - HIDDEN: everything else. Nothing of the map, nobody on it.
 *
 * With the fog off, every square is live; that is an open scene, which is
 * what every scene is until the GM fogs it or turns its sightlines on
 * (`sceneFogOn` in @safehouse/contracts).
 *
 * This module is the one place that combines the sources into a state, so
 * the server (which tokens a player may be sent), the map (what to draw
 * dimmed, what not at all) and the TV give the same answer for the same
 * square. It is pure and reads only what a fog copy carries, so it answers
 * the same on the GM's full copy and on a player's filtered one: a player's
 * copy has only the regions the table may know about, and exactly those are
 * the ones that can make a square live or explored.
 *
 * The GM's reveals are polygons on the grid and cover the same ground on
 * every floor, as fog regions always have (`fog.ts`); a square is inside one
 * when its CENTRE is. The party's sight is per floor, because a runner on
 * the ground floor has not seen the roof, and it is kept as one bitset per
 * floor (`CellBits`), base64 on the wire (`encodeCellBits`,
 * `decodeCellBits`), because it is sent after every committed move and a
 * phone should decode it without parsing anything.
 *
 * Where the sight comes from (the rules of darkness and vision modes, the
 * walls, the pooling over runners) is not this module's business: the
 * server's sight pass writes the bitsets, and this only reads them.
 */
import { sceneFogOn, type FogState, type Point, type SceneVision } from '@safehouse/contracts';
import { pointInPolygon } from './fog.js';

// ---------------------------------------------------------------------------
// Bitsets: a set of squares on one floor
// ---------------------------------------------------------------------------

/**
 * A set of squares on a `cols` x `rows` grid, one bit each: square
 * (col, row) is bit `row * cols + col`, counted from the least significant
 * bit of the first byte. This is the layout `CellBitsSchema` describes for
 * the wire, so encoding is only base64 of `bytes`.
 *
 * `bytes` is exactly long enough for the grid. A square outside the grid is
 * never in the set, and setting one does nothing, so a caller walking a
 * sightline off the edge of the map cannot corrupt the next row.
 */
export interface CellBits {
  readonly cols: number;
  readonly rows: number;
  readonly bytes: Uint8Array;
}

/** A grid size made safe to allocate: whole, and never negative. */
function gridSide(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** An empty set of squares on a `cols` x `rows` grid. */
export function emptyCellBits(cols: number, rows: number): CellBits {
  const c = gridSide(cols);
  const r = gridSide(rows);
  return { cols: c, rows: r, bytes: new Uint8Array(Math.ceil((c * r) / 8)) };
}

/** The bit index of a square, or -1 for one that is not on the grid. */
function bitIndex(bits: CellBits, col: number, row: number): number {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return -1;
  if (col < 0 || row < 0 || col >= bits.cols || row >= bits.rows) return -1;
  return row * bits.cols + col;
}

/** Whether square (col, row) is in the set; a square off the grid never is. */
export function cellBitsHas(bits: CellBits, col: number, row: number): boolean {
  const i = bitIndex(bits, col, row);
  if (i < 0) return false;
  return (((bits.bytes[i >> 3] ?? 0) >> (i & 7)) & 1) === 1;
}

/** Put square (col, row) in the set (or take it out, `on` false). Off the grid, nothing happens. */
export function cellBitsSet(bits: CellBits, col: number, row: number, on = true): void {
  const i = bitIndex(bits, col, row);
  if (i < 0) return;
  const byte = i >> 3;
  const mask = 1 << (i & 7);
  const was = bits.bytes[byte] ?? 0;
  bits.bytes[byte] = on ? was | mask : was & ~mask;
}

/**
 * A set holding exactly `cells`, on a `cols` x `rows` grid. Cells off the
 * grid are dropped. The shape the sight pass has to hand: `visibleFrom`'s
 * values, or any list of squares.
 */
export function cellBitsFrom(
  cols: number,
  rows: number,
  cells: Iterable<{ col: number; row: number }>,
): CellBits {
  const bits = emptyCellBits(cols, rows);
  for (const { col, row } of cells) cellBitsSet(bits, col, row);
  return bits;
}

/** How many squares are in the set. */
export function cellBitsCount(bits: CellBits): number {
  let n = 0;
  for (const byte of bits.bytes) {
    let b = byte;
    while (b !== 0) {
      b &= b - 1;
      n += 1;
    }
  }
  return n;
}

/**
 * The same squares on a grid of another size, kept by position: square
 * (3, 4) is still square (3, 4), and squares that no longer fit are dropped.
 * What a floor's memory must go through when the GM resizes the scene,
 * because the bit index of a square depends on how many columns there are
 * and a plain copy of the bytes would shear every row sideways.
 */
export function cellBitsResize(bits: CellBits, cols: number, rows: number): CellBits {
  const out = emptyCellBits(cols, rows);
  if (out.cols === bits.cols && out.rows === bits.rows) {
    out.bytes.set(bits.bytes);
    return out;
  }
  const keepCols = Math.min(out.cols, bits.cols);
  const keepRows = Math.min(out.rows, bits.rows);
  for (let row = 0; row < keepRows; row += 1) {
    for (let col = 0; col < keepCols; col += 1) {
      if (cellBitsHas(bits, col, row)) cellBitsSet(out, col, row);
    }
  }
  return out;
}

/**
 * Every square in `a` or in `b`, on `a`'s grid: how the sight pass folds
 * what the party sees now (`live`) into what it has seen (`explored`). A new
 * set; neither argument changes. If `b` was written for a different grid it
 * is read by position (`cellBitsResize`), never byte for byte.
 */
export function cellBitsUnion(a: CellBits, b: CellBits): CellBits {
  const out = emptyCellBits(a.cols, a.rows);
  out.bytes.set(a.bytes);
  const other = b.cols === a.cols && b.rows === a.rows ? b : cellBitsResize(b, a.cols, a.rows);
  for (let i = 0; i < out.bytes.length; i += 1) out.bytes[i] = (out.bytes[i] ?? 0) | (other.bytes[i] ?? 0);
  return out;
}

// Base64, written out rather than borrowed: the rules package runs in node
// and in the browser alike and assumes neither `Buffer` nor `btoa`. It is the
// standard alphabet with `=` padding, so `atob` reads what this writes.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUE: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64.length; i += 1) table[B64.charCodeAt(i)] = i;
  return table;
})();

/**
 * A set as base64 (`CellBitsSchema`), for the fog's `sight` record.
 *
 * Trailing zero bytes are left off: the squares nobody has seen cost nothing,
 * and a floor nobody has seen at all is `''`. `decodeCellBits` reads the
 * missing bytes back as zeros, so the round trip is exact.
 */
export function encodeCellBits(bits: CellBits): string {
  const bytes = bits.bytes;
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  const out: string[] = [];
  for (let i = 0; i < end; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((i + 1 < end ? (bytes[i + 1] ?? 0) : 0) << 8) | (i + 2 < end ? (bytes[i + 2] ?? 0) : 0);
    out.push(
      B64.charAt((n >> 18) & 63),
      B64.charAt((n >> 12) & 63),
      i + 1 < end ? B64.charAt((n >> 6) & 63) : '=',
      i + 2 < end ? B64.charAt(n & 63) : '=',
    );
  }
  return out.join('');
}

/**
 * A base64 set (`encodeCellBits`) back on a `cols` x `rows` grid.
 *
 * Total, never throwing, because it runs on whatever a stored scene or a
 * socket hands it: a string shorter than the grid reads the rest as unseen
 * (which is how `encodeCellBits` writes an unseen tail), a longer one is
 * cut at the grid, bits past the last square are dropped, and a character
 * that is not base64 is skipped. The worst a damaged string can do is lose
 * squares, never add them off the edge of the map.
 */
export function decodeCellBits(encoded: string, cols: number, rows: number): CellBits {
  const bits = emptyCellBits(cols, rows);
  const out = bits.bytes;
  let acc = 0;
  let held = 0;
  let o = 0;
  for (let i = 0; i < encoded.length && o < out.length; i += 1) {
    const code = encoded.charCodeAt(i);
    if (code === 61 /* '=' */) break;
    const v = code < 128 ? (B64_VALUE[code] ?? -1) : -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    held += 6;
    if (held >= 8) {
      held -= 8;
      out[o] = (acc >> held) & 0xff;
      o += 1;
    }
    acc &= (1 << held) - 1;
  }
  const total = bits.cols * bits.rows;
  const spare = total % 8;
  if (spare !== 0 && out.length > 0) out[out.length - 1] = (out[out.length - 1] ?? 0) & ((1 << spare) - 1);
  return bits;
}

// ---------------------------------------------------------------------------
// The three states
// ---------------------------------------------------------------------------

/** What the table is shown of one square (see the top of this file). */
export type CellState = 'hidden' | 'explored' | 'live';

/**
 * A fog these functions can read: the stored state, the GM's copy, or a
 * player's or the TV's filtered one (which says `active`, and carries only
 * the regions the table may know about).
 */
export type FogCellsInput = Pick<FogState, 'regions' | 'revealed' | 'revealedShapes'> &
  Partial<Pick<FogState, 'enabled' | 'active' | 'exploredRegionIds' | 'exploredShapes' | 'sight'>>;

export interface FogCellsOptions {
  /**
   * The scene's vision settings, when the caller has the scene. Sightlines
   * on fog a scene whatever its fog switch says (`sceneFogOn`), and only the
   * scene says whether they are on. A player's copy does not need it (its
   * `active` already says so), but the GM's copy and the stored state do.
   */
  vision?: Partial<Pick<SceneVision, 'sight'>> | undefined;
}

/** Where a token stands, as far as the fog cares. */
export interface FogToken {
  /** Its centre, in grid units: the middle of the square (or squares) it stands on. */
  x: number;
  y: number;
  /** The floor it is on (`Token.level`); absent is the ground. */
  level?: number | undefined;
  /** How many squares across it is (`Token.size`); absent is one. */
  size?: number | undefined;
}

/** One fog, read: ask it about squares and tokens as often as you like. */
export interface FogCells {
  /** Whether the scene is fogged at all. When it is not, every square is live. */
  readonly on: boolean;
  /** The state of square (col, row) on floor `level`. */
  state(level: number, col: number, row: number): CellState;
  /** Whether any square the token stands on is live (`tokenLive`). */
  tokenLive(token: FogToken): boolean;
}

/** A polygon with its bounding box, so most squares are turned away without the full test. */
interface Area {
  polygon: readonly Point[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function area(polygon: readonly Point[]): Area {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { polygon, minX, minY, maxX, maxY };
}

function inAny(areas: readonly Area[], p: Point): boolean {
  for (const a of areas) {
    if (p.x < a.minX || p.x > a.maxX || p.y < a.minY || p.y > a.maxY) continue;
    if (pointInPolygon(p, a.polygon)) return true;
  }
  return false;
}

/**
 * The biggest token footprint looked at, in squares per side. A token is
 * sized by the GM, but a typo of a size must not turn one read into a
 * million squares; 64 metres is well past any vehicle on a map.
 */
const MAX_FOOTPRINT = 64;

/**
 * The first and last square a token of `size` centred at `centre` covers
 * along one axis. The small allowance keeps a token whose edge lies exactly
 * on a grid line (every snapped token) from claiming the square beyond it.
 */
function footprint(centre: number, size: number): [number, number] {
  const half = Math.min(size, MAX_FOOTPRINT) / 2;
  const first = Math.floor(centre - half + 1e-6);
  const last = Math.max(first, Math.ceil(centre + half - 1e-6) - 1);
  return [first, last];
}

/** A floor number that can key the sight record, or null for one that cannot. */
function floorKey(level: number): string | null {
  return Number.isInteger(level) && level >= 0 ? String(level) : null;
}

/**
 * Read a fog once, then ask it about any number of squares and tokens: the
 * polygons are sorted into live and explored and the party's bitsets are
 * decoded (lazily, per floor, once) up front, so a caller walking a whole
 * grid or a whole scene's tokens pays for that only once. `cellState` and
 * `tokenLive` below are the one-question versions.
 *
 * In order, for a square:
 * 1. The fog is off (`sceneFogOn`): live, whatever else is stored.
 * 2. The party sees it (`sight` live on that floor), or its centre is in a
 *    region or shape the GM revealed live: live.
 * 3. The party has seen it (`sight` explored on that floor), or its centre
 *    is in a region or shape the GM revealed as explored: explored.
 * 4. Otherwise: hidden.
 *
 * Live beats explored, so a region somehow in both reveal lists is live, and
 * a square the party is looking at is live whatever the GM revealed it as.
 */
export function fogCells(fog: FogCellsInput, options: FogCellsOptions = {}): FogCells {
  const on = sceneFogOn({ fog, vision: options.vision });

  const liveIds = new Set(fog.revealed);
  const exploredIds = new Set(fog.exploredRegionIds ?? []);
  const liveAreas: Area[] = [];
  const exploredAreas: Area[] = [];
  for (const region of fog.regions) {
    if (region.polygon.length < 3) continue;
    if (liveIds.has(region.id)) liveAreas.push(area(region.polygon));
    else if (exploredIds.has(region.id)) exploredAreas.push(area(region.polygon));
  }
  for (const shape of fog.revealedShapes) if (shape.length >= 3) liveAreas.push(area(shape));
  for (const shape of fog.exploredShapes ?? []) if (shape.length >= 3) exploredAreas.push(area(shape));

  const sight = fog.sight;
  const floors = new Map<string, { live: CellBits; explored: CellBits } | null>();
  const floorBits = (level: number): { live: CellBits; explored: CellBits } | null => {
    const key = floorKey(level);
    if (key === null || sight === undefined) return null;
    let bits = floors.get(key);
    if (bits === undefined) {
      const stored = sight.levels[key];
      bits = stored
        ? {
            live: decodeCellBits(stored.live, sight.cols, sight.rows),
            explored: decodeCellBits(stored.explored, sight.cols, sight.rows),
          }
        : null;
      floors.set(key, bits);
    }
    return bits;
  };

  const state = (level: number, col: number, row: number): CellState => {
    if (!on) return 'live';
    const bits = floorBits(level);
    if (bits && cellBitsHas(bits.live, col, row)) return 'live';
    const centre = { x: col + 0.5, y: row + 0.5 };
    if (inAny(liveAreas, centre)) return 'live';
    if (bits && cellBitsHas(bits.explored, col, row)) return 'explored';
    if (inAny(exploredAreas, centre)) return 'explored';
    return 'hidden';
  };

  const tokenLiveAt = (token: FogToken): boolean => {
    if (!on) return true;
    const level = token.level ?? 0;
    const size = token.size !== undefined && token.size > 0 ? token.size : 1;
    const [c0, c1] = footprint(token.x, size);
    const [r0, r1] = footprint(token.y, size);
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        if (state(level, col, row) === 'live') return true;
      }
    }
    return false;
  };

  return { on, state, tokenLive: tokenLiveAt };
}

/**
 * The state of one square (col, row) on floor `level`: `'hidden'`,
 * `'explored'` or `'live'` (`fogCells` has the order). For more than a few
 * squares, read the fog once with `fogCells` and ask that.
 */
export function cellState(
  fog: FogCellsInput,
  level: number,
  col: number,
  row: number,
  options: FogCellsOptions = {},
): CellState {
  return fogCells(fog, options).state(level, col, row);
}

/**
 * Whether a token stands on LIVE ground: any square it covers, on its own
 * floor, is live. A token is shown to the table, moving, only there; on
 * explored or hidden ground it is withheld (the server's policy, which also
 * keeps every runner on the table's screens wherever they stand; this says
 * only what the ground is).
 *
 * The squares it covers are `size` across, centred on its `x`/`y`, which the
 * map keeps at the middle of the square (or squares) it stands on. For a
 * token one square across, which is almost every token, that is the one
 * square its centre is in, and the answer is the one a point test at its
 * centre gives. A bigger one (a van, a dragon) counts as seen when any part
 * of it is, as it would be at a real table.
 */
export function tokenLive(fog: FogCellsInput, token: FogToken, options: FogCellsOptions = {}): boolean {
  return fogCells(fog, options).tokenLive(token);
}
