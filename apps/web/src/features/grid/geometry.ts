/**
 * Pure grid math (no pixi, no DOM) — unit-tested with vitest.
 *
 * World model: 1 grid square = CELL world pixels. Token/geometry positions are
 * in GRID UNITS; `Grid.offset` shifts the grid origin relative to the map
 * image. The map image is stretched to cover cols×rows squares (calibration =
 * tuning cols/rows/offset until the drawn grid matches the image's own grid).
 *
 * The server stores exactly that — `Grid { cols, rows, offset, unitM }` in
 * `scenes.grid` — and no px-per-square figure, so this mapping is the whole
 * calibration and there is nothing on the other side to disagree with it.
 */
import type { Grid, Point } from '@safehouse/contracts';

/** World pixels per grid square. */
export const CELL = 64;

export interface SceneMetrics {
  cell: number;
  cols: number;
  rows: number;
  unitM: number;
  offset: Point;
  /** Grid-line opacity from the scene config (FR9.1). */
  opacity: number;
}

export function metricsFor(grid: Grid): SceneMetrics {
  return {
    cell: CELL,
    cols: grid.cols,
    rows: grid.rows,
    unitM: grid.unitM > 0 ? grid.unitM : 1,
    offset: grid.offset ?? { x: 0, y: 0 },
    opacity: typeof grid.opacity === 'number' ? Math.max(0, Math.min(1, grid.opacity)) : 0.35,
  };
}

/** Stable identity for the metrics — cheap "did calibration change?" check. */
export function metricsKey(m: SceneMetrics): string {
  return `${m.cols}x${m.rows}@${m.unitM}:${m.offset.x},${m.offset.y}:${m.opacity}`;
}

/** Grid units → world px (top-left of the scene is world 0,0). */
export function worldFromGrid(m: SceneMetrics, p: Point): Point {
  return { x: (p.x + m.offset.x) * m.cell, y: (p.y + m.offset.y) * m.cell };
}

/** World px → grid units. */
export function gridFromWorld(m: SceneMetrics, w: Point): Point {
  return { x: w.x / m.cell - m.offset.x, y: w.y / m.cell - m.offset.y };
}

/** Scene pixel size (the stretched map / fog cover rectangle). */
export function sceneWorldSize(m: SceneMetrics): { width: number; height: number } {
  return { width: m.cols * m.cell, height: m.rows * m.cell };
}

/**
 * Snap a token CENTER to the grid (FR9.5). Odd-sized tokens (1×1, 3×3…)
 * center on cell centers (k + 0.5); even sizes center on grid intersections.
 */
export function snapCenter(p: Point, size: number): Point {
  const s = Math.max(1, Math.round(size));
  const parityOffset = s % 2 === 1 ? 0.5 : 0;
  return {
    x: Math.round(p.x - parityOffset) + parityOffset,
    y: Math.round(p.y - parityOffset) + parityOffset,
  };
}

/** Euclidean distance between grid points, in grid units. */
export function gridDist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Snap a VERTEX to the nearest grid intersection (FR9.2 authoring). Walls and
 * doors run along cell edges, not through cell centres — this is deliberately
 * not `snapCenter`.
 */
export function snapVertex(p: Point, enabled = true): Point {
  if (!enabled) return { x: p.x, y: p.y };
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Shorter than this (grid units) a wall/door drag was a click, not a segment. */
export const MIN_SEGMENT = 0.25;

export function isDegenerateSegment(a: Point, b: Point): boolean {
  return gridDist(a, b) < MIN_SEGMENT;
}

/** Ruler distance in meters (FR9.8): grid distance × meters-per-square. */
export function metersBetween(m: SceneMetrics, a: Point, b: Point): number {
  return gridDist(a, b) * m.unitM;
}

/** Ray-crossing point-in-polygon (fog regions, zones). */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    const crosses =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Axis-aligned rectangle from two opposite corners, as a 4-point polygon —
 * the two-click shortcut for boxy fog regions (FR9.14).
 */
export function rectPolygon(a: Point, b: Point): Point[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Centroid of a polygon's vertices (label anchor for named regions). */
export function polygonCenter(poly: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(1, poly.length);
  return { x: x / n, y: y / n };
}

// ---------------------------------------------------------------------------
// Ruler coloring (FR9.8): green ≤ walk, amber ≤ run, red beyond.
// ---------------------------------------------------------------------------

export type PaceBand = 'walk' | 'run' | 'sprint';

export interface RulerSegment {
  from: Point;
  to: Point;
  band: PaceBand;
}

/**
 * Split the ruler line into colored segments at the walk/run thresholds
 * (meters). Thresholds of 0/undefined collapse to a single 'walk' segment.
 */
export function rulerSegments(
  from: Point,
  to: Point,
  meters: number,
  walkM: number,
  runM: number,
): RulerSegment[] {
  if (meters <= 0) return [{ from, to, band: 'walk' }];
  const lerp = (t: number): Point => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  });
  const cuts: Array<{ end: number; band: PaceBand }> = [];
  const w = walkM > 0 ? Math.min(1, walkM / meters) : 1;
  const r = runM > walkM ? Math.min(1, runM / meters) : w;
  if (w > 0) cuts.push({ end: w, band: 'walk' });
  if (r > w) cuts.push({ end: r, band: 'run' });
  if (r < 1) cuts.push({ end: 1, band: 'sprint' });
  if (cuts.length === 0) cuts.push({ end: 1, band: 'walk' });

  const segments: RulerSegment[] = [];
  let start = 0;
  for (const cut of cuts) {
    segments.push({ from: lerp(start), to: lerp(cut.end), band: cut.band });
    start = cut.end;
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Grenade scatter (FR9.12). ORIGINAL implementation — direction die picks one
// of six compass spokes, distance dice minus net hits, floor 0. Table-argued,
// GM-editable by rerolling; cosmetic and client-side (never authoritative).
// ---------------------------------------------------------------------------

const SCATTER_SPOKES = ['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const;

export interface ScatterInput {
  /** Aim point, grid units. */
  from: Point;
  /** Number of distance d6 (2 thrown, 3 launched — user-editable). */
  dice: number;
  /** Net hits on the attack reduce scatter meters. */
  netHits: number;
  unitM: number;
  /** RNG in [0,1) — injectable for tests. */
  rng?: () => number;
}

export interface ScatterOutcome {
  to: Point;
  meters: number;
  directionLabel: string;
  rolls: number[];
  summary: string;
}

export function rollScatter(input: ScatterInput): ScatterOutcome {
  const rng = input.rng ?? Math.random;
  const d6 = () => 1 + Math.floor(rng() * 6);
  const rolls: number[] = [];
  const diceCount = Math.max(1, Math.floor(input.dice));
  for (let i = 0; i < diceCount; i += 1) rolls.push(d6());
  const rolled = rolls.reduce((a, b) => a + b, 0);
  const meters = Math.max(0, rolled - Math.max(0, Math.floor(input.netHits)));

  const spokeIndex = d6() - 1;
  const label = SCATTER_SPOKES[spokeIndex] ?? 'N';
  // Spoke 0 = north (−y), clockwise every 60°.
  const angle = -Math.PI / 2 + spokeIndex * (Math.PI / 3);
  const gridUnits = meters / (input.unitM > 0 ? input.unitM : 1);
  const to: Point = {
    x: input.from.x + Math.cos(angle) * gridUnits,
    y: input.from.y + Math.sin(angle) * gridUnits,
  };
  const summary =
    meters === 0
      ? `on target (${diceCount}d6 = ${rolled} − ${input.netHits} net hits)`
      : `${meters} m ${label} (${diceCount}d6 = ${rolled} − ${input.netHits} net hits)`;
  return { to, meters, directionLabel: label, rolls, summary };
}

/** Nearest point on segment ab to p — door hit-testing. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}
