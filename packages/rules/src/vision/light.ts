/**
 * Light per square (docs/VISION.md §4.1): which squares a floor's lamps
 * reach, and how bright each one is.
 *
 * Light obeys the geometry sight does. A lamp lights exactly the squares it
 * could see from where it stands — `visibleFrom` from the lamp's own square —
 * so a wall that stops a look stops the light, glass that lets a look through
 * lets the light through, and a lamp standing in a blocking square (a server
 * rack's lights, a street lamp's post) still throws its pool around it, the
 * way a camera set into a wall still sees out of it. Two models of one room
 * would disagree at the worst moment: a runner standing in a pool of light a
 * wall should have kept dark.
 *
 * Rows run the way the scene's Env tab does: 0 full light, 1 partial, 2 dim,
 * 3 total darkness. The scene's ambient row is where every square starts; a
 * light lifts the squares it reaches by its `rows` in its inner half and one
 * row fewer (never less than one) in its outer half. Where lights overlap the
 * brightest wins — two lamps do not make a square brighter than either does.
 *
 * Where the light map is squares, `lightPolygon` is the same light as a
 * shape: the area a lamp reaches, cut by the same walls, for a renderer to
 * paint a pool with a clean edge rather than a staircase of squares.
 *
 * Nothing here runs per frame. A floor's light is recomputed when a lamp, a
 * wall or the ambient row changes, like the sight model it is built on.
 */
import type { Point } from '@safehouse/contracts';
import { ENVIRONMENT_TIER_VALUES } from '../env.js';
import { tileById } from '../tilesets/catalogue.js';
import { propCells, propCoverage } from '../tilesets/footprint.js';
import { levelTiles, migrateTileLayer } from '../tilesets/layers.js';
import { TILE_HEIGHTS, cellKey, parseCellKey, type Tile, type TileLight } from '../tilesets/types.js';
import { inCone } from './cone.js';
import type { SightCell, SightModel } from './los.js';
import { sightModelFor, type SightSceneInput } from './model.js';
import type { VisionMode } from './modes.js';
import { visibleFrom } from './visible.js';

export type { TileLight } from '../tilesets/types.js';

/** 0 full light, 1 partial, 2 dim, 3 total darkness — the scene's own Light scale. */
export type LightRow = 0 | 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Tiles that glow
// ---------------------------------------------------------------------------

/** A ceiling light or a chandelier: lights the room it hangs in. */
const CEILING: TileLight = { radiusM: 5, rows: 2, height: 0.9 };
/** A street lamp or a work light on its tripod: a proper pool, from high up. */
const LAMP: TileLight = { radiusM: 7, rows: 2, height: 0.95 };
/** A pool of light painted on the ground: it already is the light, near the floor. */
const POOL: TileLight = { radiusM: 2.5, rows: 1, height: 0.1 };
/**
 * A sign or a lit window: a spill on the pavement in front of it. A tile
 * stores no side it faces, so one cut into a wall run spills on both sides.
 */
const WALL_GLOW: TileLight = { radiusM: 3, rows: 1, height: 0.6 };
/** A barrel fire, a firepit, a stove, a lantern: warm and low. */
const FLAME: TileLight = { radiusM: 4, rows: 1, height: 0.3 };
/** Everything else that glows — a screen, a terminal, a vending machine, a rack. */
const GLOW: TileLight = { radiusM: 2, rows: 1, height: 0.5 };

const FLAME_PROPS: ReadonlySet<string> = new Set(['fire', 'firepit', 'stove', 'wreck', 'lantern']);

/**
 * The light a tile gives off, or null when it gives off none.
 *
 * A tile is a light when it has an `emissive` colour, and the catalogue
 * already rations those like practicals. How far it reaches is what the tile
 * IS: a ceiling light lights a room, a street lamp a stretch of pavement, a
 * terminal's screen the desk in front of it. The tile's own `light` wins when
 * it has one.
 *
 * The design (`prop`) is asked before the silhouette (`footprint`): a tall
 * paper lantern is a lantern, not a street lamp, whatever post it hangs on.
 */
export function tileLight(
  tile: Pick<Tile, 'emissive' | 'kind' | 'footprint' | 'prop' | 'height' | 'category' | 'light'>,
): TileLight | null {
  if (!tile.emissive) return null;
  if (tile.light !== undefined) return tile.light;
  const prop = tile.prop;
  if (prop === 'pendant' || prop === 'chandelier') return { ...CEILING };
  if (prop === 'lamppost' || prop === 'worklight') return { ...LAMP };
  if (prop !== undefined && FLAME_PROPS.has(prop)) return { ...FLAME };
  // Ground as `categoryOf` reads it: said, or a floor that says nothing.
  const ground = tile.category === 'ground' || (tile.category === undefined && tile.kind === 'floor');
  if (ground) return { ...POOL };
  if (tile.kind === 'wall') return { ...WALL_GLOW };
  if (tile.footprint === 'post' && (tile.height ?? 0) >= TILE_HEIGHTS.FULL) return { ...LAMP };
  if (tile.footprint === 'round') return { ...FLAME };
  return { ...GLOW };
}

// ---------------------------------------------------------------------------
// Every light on a floor
// ---------------------------------------------------------------------------

/**
 * One light on one floor, whatever placed it, in the grid's own units — the
 * shape every renderer and the light map read.
 */
export interface LightSource {
  /**
   * `tile:<col,row>` for a glowing tile, `gm:<id>` for a light the GM placed,
   * `token:<id>` for one a token carries. A square with glowing tiles in more
   * than one layer names the second `tile:<col,row>@<layer>`.
   */
  id: string;
  kind: 'tile' | 'gm' | 'token';
  /** Where it stands, in grid units, on the floor plane. */
  at: Point;
  /** How high it hangs, in storeys. */
  height: number;
  /** How far it reaches, in SQUARES (its metres over the grid's `unitM`). */
  radius: number;
  /** Rows lifted in its inner half. */
  rows: 1 | 2 | 3;
  /** `#rrggbb`. */
  color: string;
  /** A beam's aim: degrees, 0 = east, 90 = south, as cameras (cone.ts). */
  facing?: number;
  /** A beam's spread in degrees; absent (or 360) shines all round. */
  fov?: number;
  /**
   * The squares its own fixture stands in, as `"col,row"` keys, when that
   * is more than the square under `at`: every square of a big prop. None of
   * them shades the light, so a rack's lit shelves do not cast the shadow of
   * the rack. The square under `at` counts, listed or not.
   */
  own?: readonly string[];
}

/** The slice of a token a light reads — structural, so any token shape fits. */
export interface LightTokenLike {
  id: string;
  x: number;
  y: number;
  level?: number;
  rotation?: number;
  light?: {
    radiusM: number;
    rows?: number;
    color?: string;
    fov?: number;
    on?: boolean;
  } | null;
}

/** The parts of a scene light needs: sight's, plus the ambient row and the GM's lights. */
export interface LightSceneInput extends SightSceneInput {
  environment?: { light?: number };
  geometry?: NonNullable<SightSceneInput['geometry']> & {
    lights?: ReadonlyArray<{
      id: string;
      at: Point;
      level?: number;
      radiusM?: number;
      rows?: number;
      color?: string;
      height?: number;
      facing?: number;
      fov?: number;
      on?: boolean;
    }>;
  };
}

/** A stored row count as 1–3, whatever was stored. */
function toRows(n: number | undefined, fallback: 1 | 2 | 3): 1 | 2 | 3 {
  if (n === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(3, Math.max(1, Math.round(n))) as 1 | 2 | 3;
}

/** Any number as a light row, clamped. */
function toRow(n: number): LightRow {
  if (!Number.isFinite(n)) return 0;
  return Math.min(3, Math.max(0, Math.round(n))) as LightRow;
}

/**
 * Every light on one floor: its glowing tiles, the GM's lights on it and
 * the lights its tokens carry.
 *
 * Tiles are read through the layer migration, as the sight model reads
 * them, so a floor painted before layers existed is lit the same. A piece of
 * furniture bigger than a square shines from the middle of what it covers,
 * and every square it covers is its own (`own`). A light switched off is not
 * a light at all.
 */
export function lightSourcesFor(
  scene: LightSceneInput,
  level: number,
  tokens: readonly LightTokenLike[] = [],
): LightSource[] {
  const unitM = scene.grid?.unitM || 1;
  const out: LightSource[] = [];

  const layer = levelTiles(scene, level);
  if (layer) {
    const layers = migrateTileLayer(layer);
    // A floor holds hundreds of squares and a handful of distinct tiles.
    const known = new Map<string, { tile: Tile; light: TileLight } | null>();
    const lit = (ref: string) => {
      let hit = known.get(ref);
      if (hit === undefined) {
        const tile = tileById(layers.tilesetId, ref);
        const light = tile === null ? null : tileLight(tile);
        hit = tile !== null && light !== null ? { tile, light } : null;
        known.set(ref, hit);
      }
      return hit;
    };
    const named = new Set<string>();
    for (const name of ['ground', 'structure', 'object'] as const) {
      for (const [key, ref] of Object.entries(layers[name])) {
        const cell = parseCellKey(key);
        if (cell === null) continue;
        const hit = lit(ref);
        if (hit === null) continue;
        let at: Point = { x: cell.col + 0.5, y: cell.row + 0.5 };
        let own: string[] | undefined;
        if (name === 'object' && hit.tile.prop !== undefined) {
          const [cw, ch] = propCells(hit.tile.prop, unitM);
          at = { x: cell.col + cw / 2, y: cell.row + ch / 2 };
          // Its middle is a grid line or corner when a side is even, so the
          // square under it is only one of several the fixture fills.
          if (cw > 1 || ch > 1) own = propCoverage(hit.tile.prop, cell.col, cell.row, unitM);
        }
        // A lamp pool painted under a street lamp is two lights in one
        // square; ids stay unique so neither is lost to the other.
        const id = named.has(key) ? `tile:${key}@${name}` : `tile:${key}`;
        named.add(key);
        out.push({
          id,
          kind: 'tile',
          at,
          height: hit.light.height,
          radius: hit.light.radiusM / unitM,
          rows: toRows(hit.light.rows, 1),
          color: hit.tile.emissive ?? '#ffffff',
          ...(own !== undefined ? { own } : {}),
        });
      }
    }
  }

  for (const l of scene.geometry?.lights ?? []) {
    if ((l.level ?? 0) !== level || l.on === false) continue;
    out.push({
      id: `gm:${l.id}`,
      kind: 'gm',
      at: { x: l.at.x, y: l.at.y },
      height: l.height ?? 0.8,
      radius: (l.radiusM ?? 6) / unitM,
      rows: toRows(l.rows, 2),
      color: l.color ?? '#ffd9a0',
      ...(l.facing !== undefined ? { facing: l.facing } : {}),
      ...(l.fov !== undefined ? { fov: l.fov } : {}),
    });
  }

  for (const t of tokens) {
    const light = t.light;
    if (!light || light.on === false || (t.level ?? 0) !== level) continue;
    out.push({
      id: `token:${t.id}`,
      kind: 'token',
      at: { x: t.x, y: t.y },
      // Held at chest height: a flashlight, a lantern on a belt.
      height: 0.6,
      radius: light.radiusM / unitM,
      rows: toRows(light.rows, 1),
      color: light.color ?? '#fff2d6',
      // A beam points where the token faces; a glow has no aim.
      ...(light.fov !== undefined ? { fov: light.fov, facing: t.rotation ?? 0 } : {}),
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// The light map
// ---------------------------------------------------------------------------

/** One floor's light, square by square. */
export interface LightMap {
  level: number;
  /** The row every square starts at: the scene's Env tab Light. */
  ambient: LightRow;
  /** Only the squares lit brighter than `ambient`, keyed `"col,row"`. Sparse. */
  rows: ReadonlyMap<string, LightRow>;
  /** The lights it was computed from. */
  sources: readonly LightSource[];
}

/** Is this light a beam, rather than a lamp shining all round? */
function isBeam(source: LightSource): boolean {
  return source.fov !== undefined && source.fov < 360;
}

/** Every square a light's own fixture stands in: the one under it, and `own`. */
function ownSquares(source: LightSource): Set<string> {
  const out = new Set(source.own ?? []);
  out.add(cellKey(Math.floor(source.at.x), Math.floor(source.at.y)));
  return out;
}

/**
 * `model` with `keys` no longer stopping a look. It is copied only when one
 * of them did, which is only ever a big glowing prop.
 */
function clearOf(model: SightModel, keys: Iterable<string>): SightModel {
  let cells: Map<string, SightCell> | null = null;
  for (const key of keys) {
    const cell = model.cells.get(key);
    if (cell?.blocksSight !== true) continue;
    cells ??= new Map(model.cells);
    cells.set(key, { ...cell, blocksSight: false });
  }
  return cells === null ? model : { ...model, cells };
}

/**
 * How lit every square of a floor is.
 *
 * Each light reaches the squares visible from its own square within its
 * radius, measured from the light itself to each square's centre; a beam
 * reaches only those inside its cone. Where lights overlap the brightest
 * wins. Pass `model` when the sight model is already built, and `sources`
 * to light a floor with a list the caller has already assembled.
 *
 * In full ambient light nothing can be brighter, so a daylit scene costs
 * nothing at all.
 */
export function lightMapFor(
  scene: LightSceneInput,
  level: number,
  opts: {
    tokens?: readonly LightTokenLike[];
    sources?: readonly LightSource[];
    model?: SightModel;
    cols?: number;
    rows?: number;
  } = {},
): LightMap {
  const ambient = toRow(scene.environment?.light ?? 0);
  const sources = opts.sources ?? lightSourcesFor(scene, level, opts.tokens);
  const rows = new Map<string, LightRow>();

  if (ambient > 0 && sources.length > 0) {
    const model = opts.model ?? sightModelFor(scene, level);
    for (const source of sources) {
      const reach = Math.max(0, source.radius);
      const origin = { col: Math.floor(source.at.x), row: Math.floor(source.at.y) };
      // `visibleFrom` measures its range from the square's centre, and a
      // light off-centre (a big prop, a lamp on a grid line) reaches a
      // little further one way: widen the walk by that much so no square in
      // reach goes unvisited.
      const slack = Math.hypot(source.at.x - (origin.col + 0.5), source.at.y - (origin.row + 0.5));
      // `visibleFrom` already lets a lamp out of the square it starts in;
      // the rest of a big fixture is cleared for this one walk.
      const seen = visibleFrom(origin, clearOf(model, source.own ?? []), {
        range: Math.ceil(reach + slack),
        cols: opts.cols,
        rows: opts.rows,
      });
      const eye = isBeam(source)
        ? { at: source.at, facing: source.facing ?? 0, fov: source.fov ?? 360, range: reach }
        : null;
      for (const [key, cell] of seen) {
        const centre = { x: cell.col + 0.5, y: cell.row + 0.5 };
        const d = Math.hypot(centre.x - source.at.x, centre.y - source.at.y);
        if (d > reach) continue;
        // Whoever holds a flashlight stands in its spill, whichever way it
        // points — and a bearing to your own square is no bearing at all.
        const own = cell.col === origin.col && cell.row === origin.row;
        if (eye !== null && !own && !inCone(eye, centre)) continue;
        const raise = d <= reach / 2 ? source.rows : Math.max(1, source.rows - 1);
        const row = Math.max(0, ambient - raise) as LightRow;
        const prev = rows.get(key);
        if (prev === undefined || row < prev) rows.set(key, row);
      }
    }
  }

  return { level, ambient, rows, sources };
}

/** How lit one square is. */
export function lightRowAt(map: LightMap, col: number, row: number): LightRow {
  return map.rows.get(cellKey(col, row)) ?? map.ambient;
}

// ---------------------------------------------------------------------------
// Light as a shape
// ---------------------------------------------------------------------------

/** One edge that stops light, in grid units. */
export interface OccluderSegment {
  a: Point;
  b: Point;
}

/** Shortest distance from `p` to the segment `a→b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const len2 = sx * sx + sy * sy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * sx + (p.y - a.y) * sy) / len2));
  return Math.hypot(a.x + t * sx - p.x, a.y + t * sy - p.y);
}

/**
 * Runs of unit edges along one grid line, merged where they touch: starts
 * `[3, 4, 5, 9]` become `[3, 6]` and `[9, 10]`.
 */
function mergeRuns(starts: number[]): Array<[number, number]> {
  starts.sort((p, q) => p - q);
  const out: Array<[number, number]> = [];
  for (const s of starts) {
    const last = out[out.length - 1];
    if (last !== undefined && s <= last[1]) last[1] = Math.max(last[1], s + 1);
    else out.push([s, s + 1]);
  }
  return out;
}

/**
 * The edges that stop light, as the sight model draws them: the outline of
 * every blocking square where it meets a square that does not block, plus
 * every traced wall and closed door.
 *
 * Collinear edges that touch are merged, so a twenty-square wall is its two
 * long faces rather than forty unit edges — which is what keeps a light's
 * shape cheap to cast. `exempt` squares count as open (a lamp's own square,
 * so it can shine out of its post); `within` keeps only what could shade a
 * light of that radius, and only the faces turned toward it.
 */
export function occluderSegments(
  model: SightModel,
  opts: { exempt?: ReadonlySet<string>; within?: { at: Point; radius: number } } = {},
): OccluderSegment[] {
  const exempt = opts.exempt;
  const blocks = (key: string) =>
    model.cells.get(key)?.blocksSight === true && !(exempt?.has(key) ?? false);

  // Which squares to outline: every blocking one, or those near the light.
  // A light of radius 8 looks at a few hundred squares; a floor may hold
  // thousands, so near a light the box is walked instead of the whole map.
  const cells: Array<{ col: number; row: number }> = [];
  const within = opts.within;
  const box =
    within === undefined
      ? null
      : {
          c0: Math.floor(within.at.x - within.radius) - 1,
          c1: Math.floor(within.at.x + within.radius) + 1,
          r0: Math.floor(within.at.y - within.radius) - 1,
          r1: Math.floor(within.at.y + within.radius) + 1,
        };
  if (box !== null && (box.c1 - box.c0 + 1) * (box.r1 - box.r0 + 1) < model.cells.size) {
    for (let col = box.c0; col <= box.c1; col += 1) {
      for (let row = box.r0; row <= box.r1; row += 1) {
        if (blocks(cellKey(col, row))) cells.push({ col, row });
      }
    }
  } else {
    for (const key of model.cells.keys()) {
      if (!blocks(key)) continue;
      const cell = parseCellKey(key);
      if (cell === null) continue;
      if (box !== null && (cell.col < box.c0 || cell.col > box.c1 || cell.row < box.r0 || cell.row > box.r1)) continue;
      cells.push(cell);
    }
  }

  // Unit edges, filed by the grid line they lie on: horizontal ones by y
  // (holding their x starts), vertical ones by x (holding their y starts).
  const across = new Map<number, number[]>();
  const down = new Map<number, number[]>();
  const file = (lines: Map<number, number[]>, line: number, start: number) => {
    const list = lines.get(line);
    if (list === undefined) lines.set(line, [start]);
    else list.push(start);
  };
  // A face turned away from the light lies behind its own square, so no ray
  // meets it first; leaving those out halves what every ray is cast
  // against. A light on a square's very edge keeps all four of that
  // square's faces: the near ones pass through it and stop nothing, and the
  // far ones are what hold the light in.
  const at = within?.at;
  for (const { col, row } of cells) {
    const all = at === undefined || (at.x >= col && at.x <= col + 1 && at.y >= row && at.y <= row + 1);
    if (!blocks(cellKey(col, row - 1)) && (all || at.y < row)) file(across, row, col);
    if (!blocks(cellKey(col, row + 1)) && (all || at.y > row + 1)) file(across, row + 1, col);
    if (!blocks(cellKey(col - 1, row)) && (all || at.x < col)) file(down, col, row);
    if (!blocks(cellKey(col + 1, row)) && (all || at.x > col + 1)) file(down, col + 1, row);
  }

  const out: OccluderSegment[] = [];
  for (const [y, starts] of across) {
    for (const [x0, x1] of mergeRuns(starts)) out.push({ a: { x: x0, y }, b: { x: x1, y } });
  }
  for (const [x, starts] of down) {
    for (const [y0, y1] of mergeRuns(starts)) out.push({ a: { x, y: y0 }, b: { x, y: y1 } });
  }
  for (const seg of model.segments) {
    if (!seg.blocksSight) continue;
    out.push({ a: { x: seg.a.x, y: seg.a.y }, b: { x: seg.b.x, y: seg.b.y } });
  }

  if (within === undefined) return out;
  return out.filter((s) => distanceToSegment(within.at, s.a, s.b) <= within.radius);
}

/** Nudge either side of a corner, so a ray grazing it sees past it. */
const GRAZE = 1e-4;
const TAU = Math.PI * 2;

/** Where two segments properly cross, or null. */
function crossing(p: OccluderSegment, q: OccluderSegment): Point | null {
  const rx = p.b.x - p.a.x;
  const ry = p.b.y - p.a.y;
  const sx = q.b.x - q.a.x;
  const sy = q.b.y - q.a.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const qpx = q.a.x - p.a.x;
  const qpy = q.a.y - p.a.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { x: p.a.x + t * rx, y: p.a.y + t * ry };
}

/**
 * The area a light reaches, as a simple polygon in grid units: a circle of
 * its radius with every occluder's shadow cut out of it. A beam is the
 * wedge of that circle it points into, with the light itself as a corner.
 *
 * Classic angular sweep: a ray at every angle where the answer can change —
 * each occluder's ends and a hair either side of them, where occluders cross,
 * where they meet the circle, and round the circle itself at `sides` steps —
 * each stopping at the nearest thing it hits, joined in angle order. Pass
 * the occluders with the light's own squares exempt (`lightPolygonsFor`
 * does), or a lamp in a blocking square is shut in by its own post.
 */
export function lightPolygon(
  source: LightSource,
  segments: readonly OccluderSegment[],
  opts: { sides?: number } = {},
): Point[] {
  const r = source.radius;
  if (!(r > 0)) return [];
  const o = source.at;
  const sides = Math.max(8, Math.floor(opts.sides ?? 48));
  const beam = isBeam(source);
  const span = beam ? ((source.fov ?? 360) * Math.PI) / 180 : TAU;
  const start = beam ? ((source.facing ?? 0) * Math.PI) / 180 - span / 2 : 0;

  // Only what reaches into the circle can shade it.
  const near = segments.filter((s) => distanceToSegment(o, s.a, s.b) < r);

  const angles: number[] = [];
  for (let k = 0; k < sides; k += 1) angles.push((k * TAU) / sides);
  const aimAt = (a: number) => angles.push(a - GRAZE, a, a + GRAZE);
  const corner = (p: Point) => {
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-18 || d2 > r * r) return;
    aimAt(Math.atan2(dy, dx));
  };
  for (const s of near) {
    corner(s.a);
    corner(s.b);
    // Where it crosses the rim — a wall running clean through the pool has
    // no end inside it, and without these the rim would cut the corner.
    const sx = s.b.x - s.a.x;
    const sy = s.b.y - s.a.y;
    const fx = s.a.x - o.x;
    const fy = s.a.y - o.y;
    const A = sx * sx + sy * sy;
    const B = 2 * (fx * sx + fy * sy);
    const C = fx * fx + fy * fy - r * r;
    const disc = B * B - 4 * A * C;
    if (A > 0 && disc >= 0) {
      const root = Math.sqrt(disc);
      for (const u of [(-B - root) / (2 * A), (-B + root) / (2 * A)]) {
        if (u >= 0 && u <= 1) aimAt(Math.atan2(fy + u * sy, fx + u * sx));
      }
    }
  }
  for (let i = 0; i < near.length; i += 1) {
    for (let j = i + 1; j < near.length; j += 1) {
      const p = crossing(near[i]!, near[j]!);
      if (p !== null) corner(p);
    }
  }

  // Every angle as an offset into the sweep, 0 at its start; a beam keeps
  // only those inside its spread, and both of its edges.
  const offsets: number[] = [];
  for (const a of angles) {
    const off = (((a - start) % TAU) + TAU) % TAU;
    if (!beam || off <= span) offsets.push(off);
  }
  if (beam) offsets.push(0, span);
  offsets.sort((p, q) => p - q);

  const cast = (angle: number): Point => {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let best = r;
    for (const s of near) {
      const sx = s.b.x - s.a.x;
      const sy = s.b.y - s.a.y;
      const denom = dx * sy - dy * sx;
      if (Math.abs(denom) < 1e-12) continue;
      const qx = s.a.x - o.x;
      const qy = s.a.y - o.y;
      const t = (qx * sy - qy * sx) / denom;
      const u = (qx * dy - qy * dx) / denom;
      if (t > 1e-9 && t < best && u >= -1e-9 && u <= 1 + 1e-9) best = t;
    }
    return { x: o.x + dx * best, y: o.y + dy * best };
  };

  const points: Point[] = beam ? [{ x: o.x, y: o.y }] : [];
  let lastOff = -Infinity;
  for (const off of offsets) {
    if (off - lastOff < 1e-9) continue;
    lastOff = off;
    points.push(cast(start + off));
  }
  return simplify(points);
}

/**
 * Drop points that sit on a straight line between their neighbours — the
 * many rays that land along one long wall — and repeats. The ring is closed,
 * so the first and last points are neighbours too.
 */
function simplify(points: Point[]): Point[] {
  if (points.length < 4) return points;
  const out: Point[] = [];
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const p = points[i]!;
    const prev = out[out.length - 1] ?? points[n - 1]!;
    const next = points[(i + 1) % n]!;
    if (Math.abs(p.x - prev.x) < 1e-9 && Math.abs(p.y - prev.y) < 1e-9) continue;
    const ax = p.x - prev.x;
    const ay = p.y - prev.y;
    const bx = next.x - p.x;
    const by = next.y - p.y;
    const cross = ax * by - ay * bx;
    const scale = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (scale > 0 && Math.abs(cross) <= 1e-9 * scale && ax * bx + ay * by > 0) continue;
    out.push(p);
  }
  return out.length >= 3 ? out : points;
}

/**
 * Every light on a floor with the shape it lights — what a renderer paints
 * the pools from. Each light's own squares are exempt from its shadows, so a
 * street lamp's post does not swallow its own light, nor a rack its shelves'.
 */
export function lightPolygonsFor(
  scene: LightSceneInput,
  level: number,
  opts: { tokens?: readonly LightTokenLike[]; sources?: readonly LightSource[]; model?: SightModel } = {},
): Array<{ source: LightSource; points: Point[] }> {
  const sources = opts.sources ?? lightSourcesFor(scene, level, opts.tokens);
  if (sources.length === 0) return [];
  const model = opts.model ?? sightModelFor(scene, level);
  return sources.map((source) => {
    const segments = occluderSegments(model, {
      exempt: ownSquares(source),
      within: { at: source.at, radius: source.radius },
    });
    return { source, points: lightPolygon(source, segments) };
  });
}

// ---------------------------------------------------------------------------
// Eyes against the dark
// ---------------------------------------------------------------------------

/**
 * The light row a pair of eyes actually suffers (docs/VISION.md §3):
 * low-light counts partial and dim light as full, though total darkness
 * still applies; thermographic shifts one row up; ultrasound ignores light
 * altogether (its 50 m reach is the caller's to enforce). Given several
 * modes, the best of them. Astral perception is not a light enhancement and
 * changes nothing here.
 */
export function compensatedLight(row: LightRow, modes: readonly VisionMode[]): LightRow {
  let best = row;
  for (const mode of modes) {
    let r: LightRow = row;
    if (mode === 'lowlight') r = row === 3 ? 3 : 0;
    else if (mode === 'thermographic') r = Math.max(0, row - 1) as LightRow;
    else if (mode === 'ultrasound') r = 0;
    if (r < best) best = r;
  }
  return best;
}

/** The dice-pool modifier a light row costs: 0, −1, −3, −6 (§10.2 ladder). */
export function lightModifierValue(row: LightRow): number {
  return ENVIRONMENT_TIER_VALUES[row] ?? 0;
}
