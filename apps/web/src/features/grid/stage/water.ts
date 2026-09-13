/**
 * Water drawn as a body of water (FR9.2).
 *
 * A water tile used to be a floor with three wavy lines printed on it, so a
 * harbour painted forty squares wide was forty framed pictures of water, each
 * with its own ripples, sitting flush with the quay beside it — the grid was
 * the most visible thing on the surface. A tile marked `liquid` is drawn here
 * instead, and every square of it is drawn knowing its neighbours:
 *
 *  - **One surface.** The colour of each square is blended with the squares
 *    around it at its corners and edge midpoints, so deep water shelves into
 *    shallows and a harbour tile beside a shallows tile is one gradient, not
 *    a seam.
 *  - **Depth from the shore.** Water darkens with distance from the nearest
 *    land (`dist`), and lightens over sand where a beach runs under it.
 *  - **Ripples in world space.** Crests and troughs are dashes along lines of
 *    constant screen height, placed by the WORLD position rather than the
 *    square, so they run straight across square borders.
 *  - **The land drops to the water.** In isometric the water sits below the
 *    ground, so the land's two faces turned toward the viewer show between
 *    its edge and the waterline — and what they show depends on the land's
 *    `shore`: a coursed quay wall with weed at the waterline, a pier's timber
 *    wall with a waler and pilings, an earth bank with the grass over its lip.
 *    A beach has no wall; it runs under.
 *  - **Foam follows the shoreline**, wrapping round corners, lacier on a
 *    beach, and a floating thing sits `WATER_LEVEL` below the land.
 *
 * ## Why every face is drawn inside the WATER square
 *
 * The drop is geometry, not a picture, and it works out neatly. Seen from the
 * iso camera, a pool sunk `d` cells into the ground shows its surface as its
 * own footprint slid down the screen by `d`, and everything of that slid
 * surface that falls outside the footprint is hidden by the near ground. What
 * fills the footprint above the slid surface is the far wall. Sliding down
 * the screen is exactly a step of `(d, d)` in grid space, so the far wall of a
 * water square is a band `d` wide along its two far edges — drawn in the water
 * square, after the land behind it, with nothing to sort. Plan view has no
 * drop (`heightRise` is zero) and gets the architect's edge symbols instead.
 */
import type { Graphics } from 'pixi.js';
import type { Point } from '@safehouse/contracts';
import type { TileShore } from '@safehouse/rules';
import { heightRise, worldFromGrid, type SceneMetrics } from '../geometry.js';
import type { TileDrawDef } from '../types.js';
import { FACE_FOOT, FACE_SHADE, parseColor, shade } from './colors.js';

/** How far below the land a floating thing sits, in cells. */
export const WATER_LEVEL = 0.2;

/**
 * How far each kind of shore drops to the water, in cells. A quay and a pier
 * are made to stand above the water; an earth bank is barely a step; a beach
 * runs under it and has no wall at all.
 */
export const SHORE_DROP: Readonly<Record<TileShore, number>> = { beach: 0, bank: 0.14, quay: 0.3, pier: 0.3 };

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
const OPEN = 5;

/**
 * How far out from the shore, in cells, the water still shows its shallows.
 * Past this it is the tile's deep colour.
 */
const SHELF = 3.2;

/** How much of the shallows colour water takes at `d` cells from the shore's edge. */
function shallowness(d: number): number {
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

function average(colors: readonly number[]): number {
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
 * number — the stage asks for it once per stroke.
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
function sandShowing(d: number): number {
  return 0.4 * Math.max(0, Math.min(1, 1 - d / 1.4));
}

/** The water colour from its palette, its shallowness and any sand under it. */
function tint(deep: number, shallow: number, sand: number | null, shallowT: number, sandT: number): number {
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

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

type UV = readonly [number, number];

/** A deterministic 0..1 from integers, for things placed in world space. */
function hash(a: number, b: number, salt: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The sideways wobble of a shoreline, a function of where along it you are — so it joins across squares. */
function wobble(along: number, line: number): number {
  return 0.011 * Math.sin(along * 9.1 + line * 1.7) + 0.005 * Math.sin(along * 21.7 + line * 0.6);
}

interface Pen {
  g: Graphics;
  m: SceneMetrics;
  col: number;
  row: number;
}

function at(p: Pen, u: number, v: number): Point {
  return worldFromGrid(p.m, { x: p.col + u, y: p.row + v });
}

function fillUV(p: Pen, pts: readonly UV[], color: number, alpha = 1): void {
  const a = at(p, pts[0]![0], pts[0]![1]);
  p.g.moveTo(a.x, a.y);
  for (let i = 1; i < pts.length; i += 1) {
    const q = at(p, pts[i]![0], pts[i]![1]);
    p.g.lineTo(q.x, q.y);
  }
  p.g.closePath().fill({ color, alpha });
}

function strokeUV(p: Pen, pts: readonly UV[], color: number, alpha: number, width = 1): void {
  if (pts.length < 2) return;
  const a = at(p, pts[0]![0], pts[0]![1]);
  p.g.moveTo(a.x, a.y);
  for (let i = 1; i < pts.length; i += 1) {
    const q = at(p, pts[i]![0], pts[i]![1]);
    p.g.lineTo(q.x, q.y);
  }
  p.g.stroke({ width, color, alpha, ...(width <= 1 ? { pixelLine: true } : {}) });
}

type SideName = 'n' | 'e' | 's' | 'w';
type Side = { kind: 'water' } | { kind: 'void' } | { kind: 'land'; def: TileDrawDef; shore: TileShore };

function sideAt(map: WaterMap, col: number, row: number): Side {
  if (map.waterById.has(cellId(col, row))) return { kind: 'water' };
  const def = map.landById.get(cellId(col, row));
  return def === undefined ? { kind: 'void' } : { kind: 'land', def, shore: shoreOf(def) };
}

/** True in isometric, where the land stands above the water. */
function sunk(m: SceneMetrics): boolean {
  return heightRise(m, 1) > 0;
}

/** How far a floating thing sits below the land, in grid units along the screen-down diagonal. */
export function waterSink(m: SceneMetrics): number {
  return sunk(m) ? WATER_LEVEL : 0;
}

/**
 * One square of water: the surface, its ripples, the land's walls dropping
 * to it, and the foam along the shore.
 */
export function drawWaterCell(g: Graphics, m: SceneMetrics, col: number, row: number, map: WaterMap): void {
  const here = map.waterById.get(cellId(col, row));
  if (here === undefined) return;
  const p: Pen = { g, m, col, row };
  const iso = sunk(m);
  const accent = here.def.pattern === 'water' ? parseColor(here.def.colors[1], 0x4a6368) : here.shallow;

  const sides = {
    n: sideAt(map, col, row - 1),
    e: sideAt(map, col + 1, row),
    s: sideAt(map, col, row + 1),
    w: sideAt(map, col - 1, row),
  };
  const nw = sideAt(map, col - 1, row - 1);
  const ne = sideAt(map, col + 1, row - 1);
  const sw = sideAt(map, col - 1, row + 1);
  const se = sideAt(map, col + 1, row + 1);

  drawSurface(p, map, here);
  if (here.def.pattern !== 'reeds') drawRipples(p, here, accent, iso);

  // A wall is land that stands above the water: everything but a beach.
  const drop = (s: Side) => (iso && s.kind === 'land' ? SHORE_DROP[s.shore] : 0);
  if (iso) drawFarWalls(p, here, sides.n, sides.w, nw, farWalls(map, m, col, row));

  // Foam insets: past the far walls, just inside the near lip.
  const isLand = (s: Side) => s.kind === 'land';
  const inset = (s: Side, far: boolean) => (s.kind === 'land' ? (far ? drop(s) : 0) + (s.shore === 'beach' ? 0.03 : 0.05) : 0);
  const ins = { n: inset(sides.n, true), w: inset(sides.w, true), e: inset(sides.e, false), s: inset(sides.s, false) };
  const foam = shade(accent, 1.55);

  for (const name of ['n', 'e', 's', 'w'] as const) {
    const side = sides[name];
    if (side.kind !== 'land') continue;
    const beach = side.shore === 'beach';
    if (!iso || name === 'e' || name === 's') drawEdgeSymbol(p, name, side, here, iso);
    const [a0, a1] =
      name === 'n' || name === 's'
        ? [isLand(sides.w) ? ins.w : 0, isLand(sides.e) ? 1 - ins.e : 1]
        : [isLand(sides.n) ? ins.n : 0, isLand(sides.s) ? 1 - ins.s : 1];
    foamLine(p, name, ins[name], a0, a1, foam, beach ? 0.6 : 0.5, beach ? 2 : 1);
    // The lace behind the break: broken, fainter, further out — and a third
    // line on a beach, where the swash runs a long way.
    foamLace(p, name, ins[name] + (beach ? 0.1 : 0.08), a0, a1, foam, beach ? 0.34 : 0.26, 1);
    if (beach) foamLace(p, name, ins[name] + 0.22, a0, a1, foam, 0.16, 2);
  }

  // Land that touches only a corner still pushes foam round it.
  const corners = [
    { s: nw, cu: 0, cv: 0, open: !isLand(sides.n) && !isLand(sides.w) },
    { s: ne, cu: 1, cv: 0, open: !isLand(sides.n) && !isLand(sides.e) },
    { s: sw, cu: 0, cv: 1, open: !isLand(sides.s) && !isLand(sides.w) },
    { s: se, cu: 1, cv: 1, open: !isLand(sides.s) && !isLand(sides.e) },
  ] as const;
  for (const c of corners) {
    if (c.s.kind !== 'land' || !c.open) continue;
    const ix = (c.cu === 0 ? drop(c.s) : 0) + 0.05;
    const iy = (c.cv === 0 ? drop(c.s) : 0) + 0.05;
    const arc: UV[] = [];
    for (let i = 0; i <= 4; i += 1) {
      const t = (i / 4) * (Math.PI / 2);
      const du = Math.cos(t) * ix;
      const dv = Math.sin(t) * iy;
      arc.push([c.cu === 0 ? du : 1 - du, c.cv === 0 ? dv : 1 - dv]);
    }
    strokeUV(p, arc, foam, 0.45);
  }

  if (here.def.pattern === 'reeds') drawReedBed(p, here);
}

/**
 * The surface: a continuous field, sampled across the square in a grid of quads.
 *
 * The field is distance from the shore, known exactly at the square's centre
 * and estimated at its corners and edge midpoints from the squares that meet
 * there, with each point's palette the blend of the water around it. Nine
 * small quads in the colours of their own centres step by about a value
 * point, so a shelf reads as a gradient where one flat colour per square read
 * as a chequerboard. Open water — nothing changing across the square — is one
 * fill.
 */
function drawSurface(p: Pen, map: WaterMap, here: WaterCell): void {
  const { col, row } = p;
  /** The field at a grid point from the squares that touch it. */
  const control = (cells: ReadonlyArray<readonly [number, number]>, centre: boolean): number => {
    let dsum = 0;
    let dn = 0;
    const deep: number[] = [];
    const shallow: number[] = [];
    const sand: number[] = [];
    let sandNear = false;
    for (const [c, r] of cells) {
      const w = map.waterById.get(cellId(c, r));
      if (w !== undefined) {
        dsum += w.dist;
        dn += 1;
        deep.push(w.deep);
        shallow.push(w.shallow);
        if (w.sand !== null) sand.push(w.sand);
      } else if (map.landById.has(cellId(c, r))) {
        dn += 1;
        const l = map.landById.get(cellId(c, r))!;
        if (shoreOf(l) === 'beach') {
          sandNear = true;
          sand.push(parseColor(l.colors[0], 0x847660));
        }
      }
    }
    const d = centre ? here.dist - 0.5 : dn === 0 ? OPEN : Math.max(0, dsum / dn - 0.5);
    const s = sand.length > 0 ? average(sand) : null;
    const sandT = s === null ? 0 : sandShowing(sandNear ? Math.min(d, 0.2) : d);
    return tint(average(deep), average(shallow), s, shallowness(d), sandT);
  };
  const c = (dc: number, dr: number) => [col + dc, row + dr] as const;
  // Rows of the 3×3 control grid: v = 0, 0.5, 1; columns u = 0, 0.5, 1.
  const grid = [
    [control([c(-1, -1), c(0, -1), c(-1, 0), c(0, 0)], false), control([c(0, -1), c(0, 0)], false), control([c(0, -1), c(1, -1), c(0, 0), c(1, 0)], false)],
    [control([c(-1, 0), c(0, 0)], false), here.surface, control([c(0, 0), c(1, 0)], false)],
    [control([c(-1, 0), c(0, 0), c(-1, 1), c(0, 1)], false), control([c(0, 0), c(0, 1)], false), control([c(0, 0), c(1, 0), c(0, 1), c(1, 1)], false)],
  ];
  // Oversize toward other water by a hair, so two squares of one body overlap
  // rather than leave an antialiased seam of the void between them; square
  // where the water ends at anything else, which must keep a clean edge.
  const e = 0.012;
  const wet = (dc: number, dr: number) => map.waterById.has(cellId(col + dc, row + dr));
  const [eu0, ev0, eu1, ev1] = [wet(-1, 0) ? e : 0, wet(0, -1) ? e : 0, wet(1, 0) ? e : 0, wet(0, 1) ? e : 0];
  fillUV(p, [[-eu0, -ev0], [1 + eu1, -ev0], [1 + eu1, 1 + ev1], [-eu0, 1 + ev1]], here.surface);
  // How far the colour moves across the square decides how finely it is cut:
  // nothing moving is one fill; a shelf is cut so each step stays near a
  // value point, where three a side read as bands parallel to the shore.
  const channels = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
  const centre = channels(here.surface);
  let spread = 0;
  for (const row of grid) for (const x of row) channels(x).forEach((v, i) => (spread = Math.max(spread, Math.abs(v - centre[i]!))));
  if (spread <= 1) return;
  const sample = (u: number, v: number): number => {
    const i = u < 0.5 ? 0 : 1;
    const j = v < 0.5 ? 0 : 1;
    const lu = (u - i * 0.5) / 0.5;
    const lv = (v - j * 0.5) / 0.5;
    const top = mix(grid[j]![i]!, grid[j]![i + 1]!, lu);
    const bottom = mix(grid[j + 1]![i]!, grid[j + 1]![i + 1]!, lu);
    return mix(top, bottom, lv);
  };
  // The quads overlap the same way, inside the square and out.
  const N = Math.max(2, Math.min(4, Math.ceil(spread / 1.5)));
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const u0 = i / N - (i === 0 ? eu0 : e);
      const v0 = j / N - (j === 0 ? ev0 : e);
      const u1 = (i + 1) / N + (i === N - 1 ? eu1 : e);
      const v1 = (j + 1) / N + (j === N - 1 ? ev1 : e);
      fillUV(p, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], sample((i + 0.5) / N, (j + 0.5) / N));
    }
  }
}

/**
 * A reed bed standing in the water: clumps of stalks rising off the surface,
 * dark at their feet, a seed head on some. In plan, a clump is the tuft seen
 * from above.
 */
function drawReedBed(p: Pen, here: WaterCell): void {
  const base = parseColor(here.def.colors[0], 0x5a6748);
  const accent = parseColor(here.def.colors[1], 0x667551);
  const iso = sunk(p.m);
  const clumps = 4;
  for (let i = 0; i < clumps; i += 1) {
    const cu = 0.18 + hash(p.col * 7 + i, p.row, 81) * 0.64;
    const cv = 0.18 + hash(p.col, p.row * 7 + i, 83) * 0.64;
    const foot = at(p, cu, cv);
    const { cell } = p.m;
    p.g.ellipse(foot.x, foot.y + (iso ? WATER_LEVEL * heightRise(p.m, 1) : 0), cell * 0.1, cell * (iso ? 0.05 : 0.1)).fill({ color: shade(base, 0.62), alpha: 0.55 });
    const stalks = 7;
    for (let k = 0; k < stalks; k += 1) {
      const spread = (hash(i, k, p.col * 31 + p.row) - 0.5) * 0.16;
      const tall = 0.28 + hash(k, i, p.row * 17 + p.col) * 0.3;
      const colour = k % 3 === 0 ? shade(accent, 1.18) : k % 3 === 1 ? accent : shade(base, 0.9);
      const a = at(p, cu + spread * 0.4, cv + spread * 0.3);
      const sinkPx = iso ? WATER_LEVEL * heightRise(p.m, 1) : 0;
      if (iso) {
        const rise = heightRise(p.m, tall);
        const lean = spread * cell * 0.9;
        p.g.moveTo(a.x, a.y + sinkPx).lineTo(a.x + lean, a.y + sinkPx - rise).stroke({ width: 1, color: colour, alpha: 0.9, pixelLine: true });
        if (k % 3 === 0) p.g.ellipse(a.x + lean, a.y + sinkPx - rise, 1.2, 2.4).fill({ color: shade(base, 0.55), alpha: 0.95 });
      } else {
        const ang = hash(k, i, 91) * Math.PI * 2;
        const len = cell * (0.05 + tall * 0.12);
        p.g.moveTo(a.x, a.y).lineTo(a.x + Math.cos(ang) * len, a.y + Math.sin(ang) * len).stroke({ width: 1, color: colour, alpha: 0.85, pixelLine: true });
      }
    }
  }
}

/**
 * Ripples: a lit crest and a darker trough, as dashes along lines of constant
 * screen height, placed by world position so they cross square borders
 * unbroken. None in the first square off the shore, where the foam is; more,
 * and brighter, further out.
 */
function drawRipples(p: Pen, here: WaterCell, accent: number, iso: boolean): void {
  const strength = [0, 0, 0.12, 0.2, 0.24, 0.28][Math.min(here.dist, OPEN)] ?? 0.28;
  if (strength === 0) return;
  const crest = shade(accent, 1.32);
  const trough = shade(parseColor(here.def.colors[0], 0x3e5559), 0.72);
  const { col, row } = p;
  // Line family: s = x + y in isometric (a screen-horizontal line), s = y in
  // plan; `w` runs along the line. Both 16px apart on screen.
  const spacing = iso ? 0.5 : 0.25;
  const s0 = iso ? col + row : row;
  const span = iso ? 2 : 1;
  const period = iso ? 1.15 : 0.6;
  const amp = spacing * 0.045;
  for (let k = Math.ceil(s0 / spacing - 0.5); (k + 0.5) * spacing < s0 + span; k += 1) {
    const c = (k + 0.5) * spacing;
    if (c <= s0) continue;
    const lo = iso ? Math.max(2 * col - c, c - 2 * row - 2) : col;
    const hi = iso ? Math.min(2 * col + 2 - c, c - 2 * row) : col + 1;
    if (hi - lo < 0.02) continue;
    const phase = hash(k, 7, 3) * period;
    for (let j = Math.floor((lo + phase) / period); j * period - phase < hi; j += 1) {
      const h = hash(k, j, 11);
      if (h < 0.5) continue;
      const start = j * period - phase + hash(k, j, 13) * period * 0.45;
      const len = period * (0.22 + hash(k, j, 17) * 0.38);
      const a = Math.max(start, lo);
      const b = Math.min(start + len, hi);
      if (b - a < 0.03) continue;
      const pts = (offset: number): UV[] => {
        const out: UV[] = [];
        for (let i = 0; i <= 3; i += 1) {
          const t = a + ((b - a) * i) / 3;
          const sv = c + offset + amp * Math.sin(t * 5.3 + k * 1.9);
          const gx = iso ? (sv + t) / 2 : t;
          const gy = iso ? (sv - t) / 2 : sv;
          out.push([gx - col, gy - row]);
        }
        return out;
      };
      strokeUV(p, pts(0), crest, strength);
      if (h > 0.7) strokeUV(p, pts(spacing * 0.16), trough, strength * 0.8);
      // Now and then the key light catches a crest.
      if (h > 0.93) {
        const mid = pts(0).slice(1, 3);
        strokeUV(p, mid, shade(accent, 1.6), Math.min(0.5, strength * 2), 2);
      }
    }
  }
}

/**
 * The walls of the land behind the water, in isometric: a band along each far
 * edge whose neighbour stands above the water, plus the corner of a block
 * that only touches this square diagonally. See the module comment for why
 * the bands are exactly these shapes.
 */
/**
 * How deep a wall each far side of a square of water shows — the north side,
 * the west side, and the corner of a block standing off the diagonal — zero
 * where the side shows none: water, the map's edge, a beach, or plan view.
 */
export function farWalls(map: WaterMap, m: SceneMetrics, col: number, row: number): { n: number; w: number; nw: number } {
  const depth = (s: Side) => (sunk(m) && s.kind === 'land' ? SHORE_DROP[s.shore] : 0);
  return { n: depth(sideAt(map, col, row - 1)), w: depth(sideAt(map, col - 1, row)), nw: depth(sideAt(map, col - 1, row - 1)) };
}

function drawFarWalls(p: Pen, here: WaterCell, n: Side, w: Side, nw: Side, depths: { n: number; w: number; nw: number }): void {
  const { n: dn, w: dw, nw: dnw } = depths;
  // A band runs square to square along a straight shore; where the block
  // behind the corner carries it on and the other side is open, it runs to
  // the corner instead of stopping at the diagonal.
  if (n.kind === 'land' && dn > 0) {
    const ext = dnw > 0 && dw === 0 ? 0 : dn;
    wallFace(p, here, n, 'n', dn, ext);
  }
  if (w.kind === 'land' && dw > 0) {
    const ext = dnw > 0 && dn === 0 ? 0 : dw;
    wallFace(p, here, w, 'w', dw, ext);
  }
  if (nw.kind === 'land' && dnw > 0 && dn === 0 && dw === 0) {
    // The corner of a block standing off the diagonal: its two faces meet in a
    // vertical edge straight down from this square's back corner.
    const base = parseColor(nw.def.colors[0], 0x6b5d4d);
    fillUV(p, [[0, 0], [0, dnw], [dnw, dnw]], shade(base, FACE_SHADE.left * 0.9));
    fillUV(p, [[0, 0], [dnw, 0], [dnw, dnw]], shade(base, FACE_SHADE.right * 0.9));
  }
}

/**
 * One far wall. `along` runs the length of the edge, `k` down the wall from
 * the land's edge (0) to the waterline (`d`); a point on the wall is the edge
 * point slid `(k, k)`. `ext` is where the band's inner end meets the corner:
 * `d` for the diagonal cut where another wall turns, 0 to run square to the
 * corner.
 */
function wallFace(p: Pen, here: WaterCell, side: Extract<Side, { kind: 'land' }>, name: 'n' | 'w', d: number, ext: number): void {
  const base = parseColor(side.def.colors[0], 0x6b5d4d);
  const accent = parseColor(side.def.colors[1], 0x7a6a57);
  // Below the ground and out of the key light: a notch darker than a wall above it.
  const lit = (name === 'n' ? FACE_SHADE.left : FACE_SHADE.right) * 0.84;
  /** A point on the wall: `along` the edge, `k` down it. */
  const pt = (along: number, k: number): UV => (name === 'n' ? [along + k, k] : [k, along + k]);
  /** The band between depths k0 and k1, clipped to the square. */
  const band = (k0: number, k1: number): UV[] => {
    const e0 = ext === 0 ? 0 : k0;
    const e1 = ext === 0 ? 0 : k1;
    return name === 'n'
      ? [[e0, k0], [1, k0], [1, k1], [e1, k1]]
      : [[k0, e0], [k0, 1], [k1, 1], [k1, e1]];
  };
  const alongStart = (k: number) => (ext === 0 ? -k : 0);

  const shore = side.shore;
  const material = shore === 'bank' ? mix(base, 0x4a3b2c, 0.45) : base;
  // Lit at the top, darker toward the water, like every standing face.
  fillUV(p, band(0, d * 0.5), shade(material, lit));
  fillUV(p, band(d * 0.5, d), shade(material, lit * (FACE_FOOT + (1 - FACE_FOOT) * 0.35)));
  const water = here.surface;

  if (shore === 'quay') {
    const ink = shade(base, 0.55);
    strokeUV(p, [pt(alongStart(d * 0.5), d * 0.5), pt(1, d * 0.5)], ink, 0.45);
    for (const [k0, k1, offset] of [[0, d * 0.5, 1 / 6], [d * 0.5, d, 0]] as const) {
      for (let a = offset; a < 1; a += 1 / 3) {
        if (a <= 0.001) continue;
        strokeUV(p, [pt(a, k0), pt(a, k1)], ink, 0.35);
      }
    }
    // Weed and wet at the waterline.
    fillUV(p, band(d * 0.78, d), mix(shade(base, 0.5), 0x3f5a3a, 0.35), 0.75);
    // The coping catches the light.
    strokeUV(p, [pt(alongStart(0), 0), pt(1, 0)], shade(base, 1.3), 0.55);
  } else if (shore === 'pier') {
    const ink = shade(base, 0.5);
    // Vertical boards.
    for (let a = 0.125; a < 1; a += 0.125) strokeUV(p, [pt(a, d * 0.1), pt(a, d)], ink, 0.3);
    // The waler: a horizontal beam across the boards.
    fillUV(p, band(d * 0.18, d * 0.36), shade(accent, lit * 1.02));
    strokeUV(p, [pt(alongStart(d * 0.36), d * 0.36), pt(1, d * 0.36)], ink, 0.5);
    // Slime at the waterline.
    fillUV(p, band(d * 0.8, d), mix(shade(base, 0.45), 0x34463a, 0.4), 0.8);
    // Pilings: round posts standing proud of the wall, every half square in
    // WORLD position so a pier's posts keep their rhythm along its length.
    const origin = name === 'n' ? p.col : p.row;
    for (let i = Math.ceil(origin * 2 - 0.25); (i + 0.25) / 2 < origin + 1; i += 1) {
      const a = (i + 0.25) / 2 - origin;
      if (a < 0.04 || a > 0.96) continue;
      const r = 0.04;
      const post: UV[] = [pt(a - r, -0.04), pt(a + r, -0.04), pt(a + r, d + 0.06), pt(a - r, d + 0.06)];
      fillUV(p, post, shade(base, 0.62));
      strokeUV(p, [pt(a - r * 0.4, -0.03), pt(a - r * 0.4, d + 0.04)], shade(accent, 1.15), 0.35);
      // Its cap on the deck edge, and a ring of disturbed water at its foot.
      fillUV(p, [pt(a - r, -0.04), pt(a + r, -0.04), pt(a + r, -0.02), pt(a - r, -0.02)], shade(accent, 1.2));
      strokeUV(p, [pt(a - r * 1.8, d + 0.07), pt(a, d + 0.1), pt(a + r * 1.8, d + 0.07)], shade(parseColor(here.def.colors[1], 0x4a6368), 1.5), 0.35);
    }
    strokeUV(p, [pt(alongStart(0), 0), pt(1, 0)], shade(accent, 1.25), 0.5);
  } else {
    // An earth bank: a stone or two in the cut, a root, and the turf's edge
    // hanging over the lip in ragged tongues — irregular in length and spacing,
    // so it reads as grass and never as a row of pales.
    const along = name === 'n' ? p.col : p.row;
    for (let i = 0; i < 2; i += 1) {
      const a = 0.15 + hash(along * 3 + i, name === 'n' ? p.row : p.col, 5) * 0.7;
      const k = d * (0.45 + hash(along, i, 9) * 0.35);
      const r = 0.022 + hash(i, along, 7) * 0.015;
      fillUV(p, [pt(a - r, k - r * 0.5), pt(a + r, k - r * 0.6), pt(a + r * 1.1, k + r * 0.5), pt(a - r * 0.9, k + r * 0.6)], shade(base, 0.95), 0.85);
    }
    const rootA = 0.2 + hash(along, 3, 11) * 0.6;
    strokeUV(p, [pt(rootA, d * 0.25), pt(rootA + 0.05, d * 0.45), pt(rootA + 0.03, d * 0.7)], shade(material, 0.62), 0.5);
    const turf = parseColor(side.def.colors[0], 0x5b6a42);
    // The turf's own thickness first: a dark band under the lip.
    fillUV(p, band(0, d * 0.22), shade(turf, 0.62));
    // Then tongues of grass over the edge, spaced by world position.
    const TONGUES = 5;
    for (let i = 0; i < TONGUES; i += 1) {
      const a = (i + 0.2 + hash(along * 13 + i, 1, 21) * 0.6) / TONGUES;
      const w = 0.035 + hash(along * 13 + i, 2, 23) * 0.05;
      const drop = d * (0.25 + hash(along * 13 + i, 3, 25) * 0.4);
      if (a - w < 0.01 || a + w > 0.99) continue;
      fillUV(p, [pt(a - w, 0), pt(a + w, 0), pt(a + w * 0.2, drop)], shade(turf, 0.92 + hash(i, along, 27) * 0.12));
    }
  }
  // The wall's reflection: a darker band on the water just below it.
  const k0 = d;
  const k1 = d + 0.07;
  fillUV(p, band(k0, k1), shade(water, 0.78), 0.55);
}

/**
 * The symbol where the land meets the water on its near side (isometric) or
 * on any side (plan): in isometric a lit lip and the dark line under it; in
 * plan the architect's edge — a wall's double line, a pier's posts, a bank's
 * hand-drawn line.
 */
function drawEdgeSymbol(p: Pen, name: SideName, side: Extract<Side, { kind: 'land' }>, here: WaterCell, iso: boolean): void {
  if (side.shore === 'beach') return;
  const base = parseColor(side.def.colors[0], 0x6b5d4d);
  const line = (inset: number, a0 = 0, a1 = 1): UV[] => {
    switch (name) {
      case 'n':
        return [[a0, inset], [a1, inset]];
      case 's':
        return [[a0, 1 - inset], [a1, 1 - inset]];
      case 'w':
        return [[inset, a0], [inset, a1]];
      case 'e':
        return [[1 - inset, a0], [1 - inset, a1]];
    }
  };
  if (iso) {
    strokeUV(p, line(0.004), shade(base, 1.3), 0.5);
    strokeUV(p, line(0.025), shade(here.surface, 0.62), 0.45);
    return;
  }
  const ink = shade(base, 0.45);
  if (side.shore === 'quay') {
    strokeUV(p, line(0), ink, 0.75, 2);
    strokeUV(p, line(0.06), ink, 0.4);
  } else if (side.shore === 'pier') {
    strokeUV(p, line(0), ink, 0.7, 2);
    const origin = name === 'n' || name === 's' ? p.col : p.row;
    for (let i = Math.ceil(origin * 2 - 0.25); (i + 0.25) / 2 < origin + 1; i += 1) {
      const a = (i + 0.25) / 2 - origin;
      if (a < 0.04 || a > 0.96) continue;
      const [u, v] = line(0.045, a, a)[0]!;
      const c = at(p, u, v);
      p.g.circle(c.x, c.y, Math.max(1.2, p.m.cell * 0.035)).fill({ color: shade(base, 0.6) });
    }
  } else {
    const pts: UV[] = [];
    for (let i = 0; i <= 6; i += 1) {
      const a = i / 6;
      const along = (name === 'n' || name === 's' ? p.col : p.row) + a;
      const [u, v] = line(0.012 + wobble(along, 3) * 0.6, a, a)[0]!;
      pts.push([u, v]);
    }
    strokeUV(p, pts, ink, 0.45);
  }
}

/** Points along an edge at `inset` from it, wobbling with the world, from `a0` to `a1` along. */
function shoreline(p: Pen, name: SideName, inset: number, a0: number, a1: number, line: number, steps = 6): UV[] {
  const pts: UV[] = [];
  const alongOrigin = name === 'n' || name === 's' ? p.col : p.row;
  const lineIndex = name === 'n' ? p.row : name === 's' ? p.row + 1 : name === 'w' ? p.col : p.col + 1;
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const off = inset + wobble(alongOrigin + a, lineIndex * 3 + line);
    pts.push(
      name === 'n' ? [a, off] : name === 's' ? [a, 1 - off] : name === 'w' ? [off, a] : [1 - off, a],
    );
  }
  return pts;
}

function foamLine(p: Pen, name: SideName, inset: number, a0: number, a1: number, color: number, alpha: number, width: number): void {
  if (a1 - a0 < 0.02) return;
  strokeUV(p, shoreline(p, name, inset, a0, a1, 0), color, alpha, width);
}

/** A broken line of foam: dashes placed by world position along the shore. */
function foamLace(p: Pen, name: SideName, inset: number, a0: number, a1: number, color: number, alpha: number, line: number): void {
  const origin = name === 'n' || name === 's' ? p.col : p.row;
  const period = 0.34;
  for (let j = Math.floor((origin + a0) / period); j * period < origin + a1; j += 1) {
    if (hash(j, line, name.charCodeAt(0)) < 0.45) continue;
    const start = j * period + hash(j, line, 41) * period * 0.3 - origin;
    const len = period * (0.3 + hash(j, line, 43) * 0.45);
    const lo = Math.max(a0, start);
    const hi = Math.min(a1, start + len);
    if (hi - lo < 0.03) continue;
    strokeUV(p, shoreline(p, name, inset, lo, hi, line, 2), color, alpha);
  }
}

/**
 * The land's side of the shore, on the land's own top face: a beach's wet
 * sand and swash line, a pier's capping beam, a quay's coping, a bank's damp
 * rim. Drawn for any painted ground that has water beside it.
 */
export function drawShoreTop(g: Graphics, m: SceneMetrics, col: number, row: number, map: WaterMap): void {
  if (map.waterById.size === 0) return;
  const def = map.landById.get(cellId(col, row));
  if (def === undefined) return;
  const wet = {
    n: map.waterById.has(cellId(col, row - 1)),
    e: map.waterById.has(cellId(col + 1, row)),
    s: map.waterById.has(cellId(col, row + 1)),
    w: map.waterById.has(cellId(col - 1, row)),
  };
  if (!wet.n && !wet.e && !wet.s && !wet.w) return;
  const p: Pen = { g, m, col, row };
  const base = parseColor(def.colors[0], 0x6b5d4d);
  const accent = parseColor(def.colors[1], 0x7a6a57);
  const shore = shoreOf(def);

  /** A band along an edge between two insets. */
  const band = (name: SideName, i0: number, i1: number): UV[] => {
    switch (name) {
      case 'n':
        return [[0, i0], [1, i0], [1, i1], [0, i1]];
      case 's':
        return [[0, 1 - i0], [1, 1 - i0], [1, 1 - i1], [0, 1 - i1]];
      case 'w':
        return [[i0, 0], [i0, 1], [i1, 1], [i1, 0]];
      case 'e':
        return [[1 - i0, 0], [1 - i0, 1], [1 - i1, 1], [1 - i1, 0]];
    }
  };

  for (const name of ['n', 'e', 's', 'w'] as const) {
    if (!wet[name]) continue;
    if (shore === 'beach') {
      const damp = shade(base, 0.7);
      fillUV(p, band(name, 0, 0.1), damp, 0.34);
      fillUV(p, band(name, 0.1, 0.22), damp, 0.2);
      fillUV(p, band(name, 0.22, 0.32), damp, 0.09);
      // The swash line: where the last wave reached, with the wrack it left.
      const swash = shoreline(p, name, 0.34, 0, 1, 5);
      strokeUV(p, swash, shade(accent, 1.16), 0.42);
      for (let i = 0; i < 3; i += 1) {
        const pt = swash[1 + ((i * 2 + (Math.floor(hash(col, row, 70 + i) * 2))) % 5)]!;
        const c = at(p, pt[0], pt[1]);
        p.g.ellipse(c.x, c.y, Math.max(0.8, m.cell * 0.018), Math.max(0.6, m.cell * 0.01)).fill({ color: shade(base, 0.55), alpha: 0.7 });
      }
    } else if (shore === 'pier') {
      // The capping beam along the deck edge, bolted.
      fillUV(p, band(name, 0, 0.1), shade(accent, 1.06), 0.95);
      strokeUV(p, band(name, 0.1, 0.1).slice(0, 2), shade(base, 0.55), 0.55);
      for (let a = 0.125; a < 1; a += 0.25) {
        const [u, v] = name === 'n' ? [a, 0.05] : name === 's' ? [a, 0.95] : name === 'w' ? [0.05, a] : [0.95, a];
        const c = at(p, u, v);
        p.g.circle(c.x, c.y, Math.max(0.7, m.cell * 0.012)).fill({ color: shade(base, 0.5), alpha: 0.8 });
      }
    } else if (shore === 'quay') {
      // Coping stones, a shade paler than the quay, jointed.
      fillUV(p, band(name, 0, 0.09), shade(base, 1.1), 0.9);
      strokeUV(p, band(name, 0.09, 0.09).slice(0, 2), shade(base, 0.62), 0.45);
      for (let a = 1 / 3; a < 1; a += 1 / 3) {
        const seg: UV[] = name === 'n' || name === 's'
          ? [[a, name === 'n' ? 0 : 1], [a, name === 'n' ? 0.09 : 0.91]]
          : [[name === 'w' ? 0 : 1, a], [name === 'w' ? 0.09 : 0.91, a]];
        strokeUV(p, seg, shade(base, 0.62), 0.4);
      }
    } else {
      fillUV(p, band(name, 0, 0.08), shade(base, 0.72), 0.35);
    }
  }
}
