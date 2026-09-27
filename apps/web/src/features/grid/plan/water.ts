/**
 * A floor's water, resolved as bodies of water (FR9.2).
 *
 * A square of water is not a floor with waves printed on it: it is part of a
 * body, and it knows its neighbours. This works out, once per floor, which
 * squares are water, how far each is from the nearest land, and what colour
 * each is:
 *
 *  - **One surface.** The colour of each square is blended with the squares
 *    around it, so deep water shelves into shallows and a harbour tile beside
 *    a shallows tile is one gradient, not a seam.
 *  - **Depth from the shore.** Water darkens with distance from the nearest
 *    land (`dist`), and lightens over sand where a beach runs under it.
 *
 * Pure: nothing here draws. The tile plan carries it (`TilePlan.water`,
 * `plan/tiles.ts`) to the 3D world (`lab3d/world3d.ts`) and to the Build
 * palette's painter, which draws the surface, the ripples, the land's walls
 * and the foam from it (`gm/art/waterArt.ts`).
 */
import type { TileShore } from '@safehouse/rules';
import { parseColor, shade } from '../stage/colors.js';
import type { TileDrawDef } from '../types.js';

/** One square of water, resolved against its surroundings. */
export interface WaterCell {
  col: number;
  row: number;
  def: TileDrawDef;
  /** Squares to the nearest land (8-way), capped at `OPEN`; `OPEN` means none near. */
  dist: number;
  /** The tile's colour where the water is deep, and where it shelves to nothing. */
  deep: number;
  shallow: number;
  /** A beach's sand showing through, when one runs under this square; else null. */
  sand: number | null;
  /** The surface colour at the square's centre — for the things drawn on it. */
  surface: number;
}

/** Everything the water pass needs to know about a floor. */
export interface WaterMap {
  /** Every square of water, by `"col,row"`. */
  water: Map<string, WaterCell>;
  /** What every other painted square stands on, by `"col,row"` — the shore. */
  land: Map<string, TileDrawDef>;
  /**
   * The same two maps by `cellId`. Every square of water asks after its eight
   * neighbours several times over, and building a `"col,row"` string for each
   * of those asks was most of what resolving a harbour cost.
   */
  waterById: Map<number, WaterCell>;
  landById: Map<number, TileDrawDef>;
}

/** A square as one number — cheap to make and to look up, unlike `"col,row"`. */
export function cellId(col: number, row: number): number {
  return (col + 32768) * 65536 + (row + 32768);
}

/** A painted square as the plan sees it. */
export interface WaterEntry {
  col: number;
  row: number;
  def: TileDrawDef;
  /** 0 ground, 1 structure, 2 object. */
  layer: number;
}

/** Distance at which water counts as open: no land close enough to shallow it. */
export const OPEN = 5;

/**
 * How far out from the shore, in cells, the water still shows its shallows.
 * Past this it is the tile's deep colour.
 */
const SHELF = 3.2;

/** How much of the shallows colour water takes at `d` cells from the shore's edge. */
export function shallowness(d: number): number {
  const t = Math.max(0, Math.min(1, 1 - d / SHELF));
  return t;
}

const key = (col: number, row: number) => `${col},${row}`;

const NEIGHBOURS_4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

const NEIGHBOURS_8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** Blend two colours, `t` of the way from `a` to `b`. */
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => {
    const x = (a >> s) & 0xff;
    const y = (b >> s) & 0xff;
    return Math.round(x + (y - x) * t) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The mean of some colours, channel by channel. */
export function average(colors: readonly number[]): number {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of colors) {
    r += (c >> 16) & 0xff;
    g += (c >> 8) & 0xff;
    b += c & 0xff;
  }
  const n = Math.max(1, colors.length);
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}

/** The ground a square would show at a shore: its floor, or the floor a thin tile stands on. */
function groundOf(entry: WaterEntry): TileDrawDef | null {
  const thin = entry.def.footprint !== undefined && entry.def.footprint !== 'fill';
  const standing = (entry.def.height ?? 0) > 0 || entry.def.footprint === 'stair';
  if (entry.layer === 0 && !thin && !standing) return entry.def;
  return entry.def.underlay ? { pattern: entry.def.underlay.pattern, colors: entry.def.underlay.colors } : null;
}

/** The shore a piece of land makes. */
export function shoreOf(def: TileDrawDef): TileShore {
  return def.shore ?? 'bank';
}

/**
 * Resolve a floor's water: which squares are water, how far each is from
 * land, and what colour it is. One pass and a capped flood fill, keyed by
 * number — the 3D world asks for it once per stroke.
 */
export function mapWater(entries: Iterable<WaterEntry>): WaterMap {
  const ground = new Map<number, TileDrawDef>();
  const fallback = new Map<number, TileDrawDef>();
  const place = new Map<number, readonly [number, number]>();
  for (const e of entries) {
    const g = groundOf(e);
    if (g === null) continue;
    const id = cellId(e.col, e.row);
    place.set(id, [e.col, e.row]);
    if (g === e.def) ground.set(id, g);
    else if (!fallback.has(id)) fallback.set(id, g);
  }
  const waterById = new Map<number, WaterCell>();
  const landById = new Map<number, TileDrawDef>();
  for (const [id, def] of ground) {
    const [col, row] = place.get(id)!;
    if (def.liquid !== undefined) waterById.set(id, { col, row, def, dist: OPEN, deep: 0, shallow: 0, sand: null, surface: 0 });
    else landById.set(id, def);
  }
  for (const [id, def] of fallback) if (!ground.has(id)) landById.set(id, def);
  const strings = (): WaterMap => {
    const water = new Map<string, WaterCell>();
    for (const w of waterById.values()) water.set(key(w.col, w.row), w);
    const land = new Map<string, TileDrawDef>();
    for (const [id, def] of landById) {
      const [col, row] = place.get(id)!;
      land.set(key(col, row), def);
    }
    return { water, land, waterById, landById };
  };
  if (waterById.size === 0) return strings();

  // Distance to land: a flood fill out from the shoreline through water only,
  // eight-way, stopping at OPEN. The map's own edge is not a shore — a harbour
  // that runs off the grid runs on.
  let frontier: WaterCell[] = [];
  for (const w of waterById.values()) {
    if (NEIGHBOURS_8.some(([dc, dr]) => landById.has(cellId(w.col + dc, w.row + dr)))) {
      w.dist = 1;
      frontier.push(w);
    }
  }
  for (let d = 2; d < OPEN && frontier.length > 0; d += 1) {
    const next: WaterCell[] = [];
    for (const f of frontier) {
      for (const [dc, dr] of NEIGHBOURS_8) {
        const w = waterById.get(cellId(f.col + dc, f.row + dr));
        if (w !== undefined && w.dist > d) {
          w.dist = d;
          next.push(w);
        }
      }
    }
    frontier = next;
  }

  // Each square's palette. A reed bed or a marsh is painted in its plants'
  // colours, and its water is whatever water it stands in — the open water
  // beside it, or a dark pond colour of its own when there is none.
  const paletteOf = (def: TileDrawDef) => {
    const base = parseColor(def.colors[0], 0x3e5559);
    const accent = parseColor(def.colors[1], 0x4a6368);
    return {
      deep: shade(base, def.liquid === 'shallow' ? 0.97 : 0.86),
      shallow: shade(mix(base, accent, 0.8), 1.0),
    };
  };
  for (const w of waterById.values()) {
    if (w.def.pattern === 'water') Object.assign(w, paletteOf(w.def));
  }
  for (const w of waterById.values()) {
    if (w.def.pattern === 'water') continue;
    const open: WaterCell[] = [];
    for (const [dc, dr] of NEIGHBOURS_8) {
      const n = waterById.get(cellId(w.col + dc, w.row + dr));
      if (n !== undefined && n.def.pattern === 'water') open.push(n);
    }
    if (open.length > 0) {
      w.deep = average(open.map((n) => n.deep));
      w.shallow = average(open.map((n) => n.shallow));
    } else {
      const own = paletteOf(w.def);
      w.deep = mix(own.deep, 0x34494c, 0.6);
      w.shallow = mix(own.shallow, 0x4a6064, 0.5);
    }
  }
  // A deep tile beside a shallows tile is one body shelving, not two colours
  // meeting: each square's palette is softened toward the water around it,
  // so the change is spread over two squares rather than half of one.
  const own = new Map<number, readonly [number, number]>();
  for (const [id, w] of waterById) own.set(id, [w.deep, w.shallow]);
  for (const w of waterById.values()) {
    const deep: number[] = [w.deep, w.deep];
    const shallow: number[] = [w.shallow, w.shallow];
    for (const [dc, dr] of NEIGHBOURS_8) {
      const n = own.get(cellId(w.col + dc, w.row + dr));
      if (n === undefined) continue;
      deep.push(n[0]);
      shallow.push(n[1]);
    }
    w.deep = average(deep);
    w.shallow = average(shallow);
  }
  for (const w of waterById.values()) {
    // Sand showing through: a beach beside the square tints its shallows.
    for (const [dc, dr] of NEIGHBOURS_4) {
      const l = landById.get(cellId(w.col + dc, w.row + dr));
      if (l !== undefined && shoreOf(l) === 'beach') w.sand = parseColor(l.colors[0], 0x847660);
    }
    w.surface = tint(w.deep, w.shallow, w.sand, shallowness(w.dist - 0.5), w.sand === null ? 0 : sandShowing(w.dist - 0.5));
  }
  return strings();
}

/** How much a beach's sand shows through at `d` cells from its edge. */
export function sandShowing(d: number): number {
  return 0.4 * Math.max(0, Math.min(1, 1 - d / 1.4));
}

/** The water colour from its palette, its shallowness and any sand under it. */
export function tint(deep: number, shallow: number, sand: number | null, shallowT: number, sandT: number): number {
  const c = mix(deep, shallow, shallowT);
  return sand === null || sandT <= 0 ? c : mix(c, mix(sand, shallow, 0.5), sandT);
}

/**
 * What the square's own drawing depends on, as a short string — so the chunk
 * diff notices a square whose shoreline changed three squares away. Empty for
 * a square that neither is water nor touches it.
 */
const SHORE_CODE: Readonly<Record<TileShore, string>> = { beach: 'B', bank: 'k', quay: 'q', pier: 'p' };

export function waterSignature(map: WaterMap, col: number, row: number): string {
  if (map.waterById.size === 0) return '';
  const here = map.waterById.get(cellId(col, row));
  const code = (c: number, r: number) => {
    const w = map.waterById.get(cellId(c, r));
    if (w !== undefined) return `${w.dist}${w.sand === null ? '' : 's'}${w.def.colors[0]}`;
    const l = map.landById.get(cellId(c, r));
    return l === undefined ? '_' : SHORE_CODE[shoreOf(l)];
  };
  const ring = NEIGHBOURS_8.map(([dc, dr]) => code(col + dc, row + dr)).join('');
  if (here !== undefined) return `w${here.dist}${ring}`;
  return /\d/.test(ring) ? `h${ring.replace(/#[0-9a-f]{6}/giu, '')}` : '';
}
