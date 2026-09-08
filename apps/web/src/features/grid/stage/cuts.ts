/**
 * Doors and windows, drawn as doors and windows (FR9.2).
 *
 * A door used to be a wall slab in a different brown with a bar across it,
 * and the GM said so. Every cut tile in the catalogue now names a DESIGN —
 * `cut: 'roller'`, `'wireglass'`, `'hatch'` — and this module draws it onto
 * the wall's visible face in isometric and as the architectural symbol in
 * plan: a leaf with its frame and handle, roller slats, wire mesh in the
 * glass, a shop window with its lit interior, louvres, a wheel-hatch, a
 * blown-out frame with the shards still in it, a porthole, a serving hatch
 * with its shelf, a neon tube on a sign box.
 *
 * ## Runs
 *
 * Adjacent cells of the same cut tile are ONE opening. A two-cell roller door
 * is a wide roller door; two street doors are a double door; a run of shop
 * window is one window with a mullion per cell. The caller finds the run and
 * draws the design once, from the run's LAST cell — the nearest one — so no
 * slab of the run is painted over it afterwards, whichever chunk it lives in.
 *
 * ## Coordinates
 *
 * Every design is drawn in face space: `u` runs 0→1 along the whole run and
 * `v` 0→1 from the foot of the wall to its crown. A mapper turns that into
 * screen points — a sheared parallelogram in isometric, the slab's top in
 * plan — so the same design code serves both projections, and a circle on a
 * face is drawn as a polygon through the mapper rather than as an ellipse it
 * would not be.
 */
import type { Graphics } from 'pixi.js';
import type { Point } from '@safehouse/contracts';
import type { TileCut } from '@safehouse/rules';
import { worldFromGrid, type SceneMetrics } from '../geometry.js';
import { C, parseColor, shade } from './colors.js';

/** The tones the wall is drawn with — the same derived palette as its slab. */
export interface CutTones {
  base: number;
  accent: number;
  light: number;
  dark: number;
  ink: number;
}

/** The opening: where it is, which way it runs, how many cells it spans. */
export interface CutRun {
  /** Union of the run's slab rects, in grid units. */
  rect: readonly [number, number, number, number];
  /** Which way the wall runs. */
  axis: 'x' | 'y';
  /** Cells in the run. */
  n: number;
}

/** Glass: a cool tint that reads as glazing on every set's palette. */
const GLASS = 0x9fd4e6;
const GLASS_ALPHA = 0.42;

type Map2 = (u: number, v: number) => Point;

/**
 * The visible long face of the run in isometric.
 *
 * A wall run along x shows its SOUTH face (from the W corner to the S), and
 * one along y shows its EAST face (S to E) — those are the two faces the key
 * light leaves toward the viewer, and the ones `drawBox` draws.
 */
function faceMap(m: SceneMetrics, run: CutRun, rise: number): Map2 {
  const [x0, y0, x1, y1] = run.rect;
  const a = run.axis === 'x' ? worldFromGrid(m, { x: x0, y: y1 }) : worldFromGrid(m, { x: x1, y: y1 });
  const b = run.axis === 'x' ? worldFromGrid(m, { x: x1, y: y1 }) : worldFromGrid(m, { x: x1, y: y0 });
  return (u, v) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - v * rise });
}

/** The slab's top in plan: `u` along the run, `v` across its thickness. */
function topMap(m: SceneMetrics, run: CutRun): Map2 {
  const [x0, y0, x1, y1] = run.rect;
  return run.axis === 'x'
    ? (u, v) => worldFromGrid(m, { x: x0 + (x1 - x0) * u, y: y1 - (y1 - y0) * v })
    : (u, v) => worldFromGrid(m, { x: x1 - (x1 - x0) * v, y: y1 - (y1 - y0) * u });
}

class Face {
  constructor(
    private readonly g: Graphics,
    private readonly P: Map2,
    /** How many `u` units one `v` unit is on screen — keeps circles round. */
    private readonly aspect: number,
  ) {}

  poly(pts: ReadonlyArray<readonly [number, number]>): Graphics {
    const first = this.P(pts[0]![0], pts[0]![1]);
    this.g.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i += 1) {
      const p = this.P(pts[i]![0], pts[i]![1]);
      this.g.lineTo(p.x, p.y);
    }
    return this.g.closePath();
  }

  rect(u0: number, v0: number, u1: number, v1: number): Graphics {
    return this.poly([
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ]);
  }

  fill(u0: number, v0: number, u1: number, v1: number, color: number, alpha = 1): void {
    this.rect(u0, v0, u1, v1).fill({ color, alpha });
  }

  frame(u0: number, v0: number, u1: number, v1: number, color: number, alpha = 1, width = 1): void {
    this.rect(u0, v0, u1, v1).stroke({ width, color, alpha, ...(width <= 1 ? { pixelLine: true } : {}) });
  }

  line(pts: ReadonlyArray<readonly [number, number]>, color: number, alpha = 1, width = 1): void {
    const first = this.P(pts[0]![0], pts[0]![1]);
    this.g.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i += 1) {
      const p = this.P(pts[i]![0], pts[i]![1]);
      this.g.lineTo(p.x, p.y);
    }
    this.g.stroke({ width, color, alpha, ...(width <= 1 ? { pixelLine: true } : {}) });
  }

  /** A circle of radius `r` in `v` units, centred at (u, v). */
  circle(u: number, v: number, r: number, sides = 18): Graphics {
    const pts: Array<readonly [number, number]> = [];
    for (let i = 0; i < sides; i += 1) {
      const t = (i / sides) * Math.PI * 2;
      pts.push([u + (Math.cos(t) * r) / this.aspect, v + Math.sin(t) * r]);
    }
    return this.poly(pts);
  }

  /** A diagonal highlight across a pane, the way glass catches the key light. */
  gleam(u0: number, v0: number, u1: number, v1: number, color: number): void {
    const w = u1 - u0;
    const h = v1 - v0;
    this.poly([
      [u0 + w * 0.08, v0 + h * 0.62],
      [u0 + w * 0.42, v1 - h * 0.06],
      [u0 + w * 0.55, v1 - h * 0.06],
      [u0 + w * 0.2, v0 + h * 0.62],
    ]).fill({ color, alpha: 0.28 });
  }
}

/** One glazed pane with its frame and gleam, mullioned per cell. */
function glazing(f: Face, u0: number, v0: number, u1: number, v1: number, n: number, tones: CutTones, wire = false): void {
  f.fill(u0, v0, u1, v1, GLASS, GLASS_ALPHA);
  f.gleam(u0, v0, u1, v1, 0xffffff);
  if (wire) {
    for (let k = 1; k < 7 * n; k += 1) {
      const u = u0 + ((u1 - u0) * k) / (7 * n);
      f.line([[u, v0], [u, v1]], tones.ink, 0.3);
    }
    for (let k = 1; k < 6; k += 1) {
      const v = v0 + ((v1 - v0) * k) / 6;
      f.line([[u0, v], [u1, v]], tones.ink, 0.3);
    }
  }
  for (let k = 1; k < n; k += 1) {
    const u = u0 + ((u1 - u0) * k) / n;
    f.line([[u, v0], [u, v1]], tones.dark, 0.9, 2);
  }
  f.frame(u0, v0, u1, v1, tones.ink, 0.8);
  f.line([[u0, v1], [u1, v1]], tones.light, 0.5);
}

/** Horizontal slats — a roller door, a security shutter. */
function slats(f: Face, u0: number, v0: number, u1: number, v1: number, step: number, tones: CutTones): void {
  f.fill(u0, v0, u1, v1, shade(tones.base, 0.92));
  for (let v = v0 + step; v < v1; v += step) {
    f.line([[u0, v], [u1, v]], tones.ink, 0.5);
    f.line([[u0, v + step * 0.35], [u1, v + step * 0.35]], tones.light, 0.22);
  }
  f.frame(u0, v0, u1, v1, tones.ink, 0.8);
}

/** A hinged leaf: frame, two inset panels, a handle on the closing side. */
function leaf(f: Face, u0: number, u1: number, v1: number, tones: CutTones, hingeLeft: boolean): void {
  f.fill(u0, 0, u1, v1, shade(tones.base, 0.9));
  f.frame(u0, 0, u1, v1, tones.ink, 0.85);
  const inset = (u1 - u0) * 0.16;
  f.frame(u0 + inset, v1 * 0.55, u1 - inset, v1 * 0.9, tones.light, 0.45);
  f.frame(u0 + inset, v1 * 0.1, u1 - inset, v1 * 0.45, tones.light, 0.45);
  const hu = hingeLeft ? u1 - inset * 0.9 : u0 + inset * 0.9;
  f.circle(hu, v1 * 0.47, 0.025, 10).fill({ color: tones.light, alpha: 0.95 });
}

/**
 * Draw one opening's design.
 *
 * `rise` is the wall's screen height; zero means plan view, where the design
 * is the architectural symbol on the slab's top instead of the elevation.
 */
export function drawCut(
  g: Graphics,
  m: SceneMetrics,
  cut: TileCut,
  run: CutRun,
  rise: number,
  tones: CutTones,
  emissive: string | undefined,
): void {
  if (rise > 0) drawElevation(g, m, cut, run, rise, tones, emissive);
  else drawSymbol(g, m, cut, run, tones, emissive);
}

function drawElevation(
  g: Graphics,
  m: SceneMetrics,
  cut: TileCut,
  run: CutRun,
  rise: number,
  tones: CutTones,
  emissive: string | undefined,
): void {
  const P = faceMap(m, run, rise);
  const a = P(0, 0);
  const b = P(1, 0);
  const runPx = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const f = new Face(g, P, runPx / rise);
  const n = run.n;
  const glow = emissive === undefined ? tones.light : parseColor(emissive, tones.light);
  // How wide one cell is in `u`, for things that come one per cell.
  const cell = 1 / n;

  switch (cut) {
    case 'door': {
      // One leaf per cell, hinged at the outer ends, so two cells are a
      // double door that meets in the middle.
      const pad = cell * 0.14;
      for (let i = 0; i < n; i += 1) {
        const u0 = i * cell + (i === 0 ? pad : 0.006);
        const u1 = (i + 1) * cell - (i === n - 1 ? pad : 0.006);
        leaf(f, u0, u1, 0.9, tones, i < n / 2);
      }
      f.line([[cell * 0.14, 0.9], [1 - cell * 0.14, 0.9]], tones.ink, 0.9, 2);
      break;
    }
    case 'maglock': {
      const pad = cell * 0.1;
      f.fill(pad, 0, 1 - pad, 0.92, shade(tones.base, 0.94));
      f.frame(pad, 0, 1 - pad, 0.92, tones.ink, 0.85);
      for (let i = 1; i < n; i += 1) f.line([[i * cell, 0], [i * cell, 0.92]], tones.ink, 0.7);
      // A thin sight strip, and the reader with its LED beside the frame.
      f.fill(pad + cell * 0.32, 0.55, pad + cell * 0.44, 0.8, GLASS, GLASS_ALPHA);
      f.fill(1 - pad + 0.012, 0.42, 1 - pad + 0.05, 0.55, tones.dark, 1);
      f.circle(1 - pad + 0.031, 0.5, 0.018, 8).fill({ color: C.ok, alpha: 0.95 });
      break;
    }
    case 'porthole': {
      const pad = cell * 0.14;
      for (let i = 0; i < n; i += 1) {
        const u0 = i * cell + (i === 0 ? pad : 0.006);
        const u1 = (i + 1) * cell - (i === n - 1 ? pad : 0.006);
        f.fill(u0, 0, u1, 0.9, shade(tones.base, 0.88));
        f.frame(u0, 0, u1, 0.9, tones.ink, 0.85);
        const cu = (u0 + u1) / 2;
        f.circle(cu, 0.62, 0.12).fill({ color: GLASS, alpha: GLASS_ALPHA });
        f.circle(cu, 0.62, 0.12).stroke({ width: 2, color: tones.light, alpha: 0.8 });
        f.circle(i < n / 2 ? u1 - (u1 - u0) * 0.15 : u0 + (u1 - u0) * 0.15, 0.45, 0.025, 10).fill({
          color: tones.light,
          alpha: 0.95,
        });
      }
      break;
    }
    case 'glassdoor': {
      const pad = cell * 0.08;
      glazing(f, pad, 0.02, 1 - pad, 0.92, n, tones);
      // The push bar, and a leaf line per cell.
      f.line([[pad + 0.03, 0.5], [1 - pad - 0.03, 0.5]], tones.light, 0.95, 3);
      for (let i = 1; i < n; i += 1) f.line([[i * cell, 0.02], [i * cell, 0.92]], tones.ink, 0.8, 2);
      break;
    }
    case 'glass': {
      glazing(f, 0.03, 0.02, 0.97, 0.96, n, tones);
      break;
    }
    case 'wireglass': {
      f.line([[0.08, 0.3], [0.92, 0.3]], tones.light, 0.7, 2);
      glazing(f, 0.1, 0.32, 0.9, 0.86, n, tones, true);
      break;
    }
    case 'shopwindow': {
      // Lower panel, then the big pane with the shop's light behind it.
      f.fill(0.04, 0, 0.96, 0.24, shade(tones.base, 0.85));
      f.frame(0.04, 0, 0.96, 0.24, tones.ink, 0.7);
      f.fill(0.06, 0.26, 0.94, 0.9, glow, 0.3);
      glazing(f, 0.06, 0.26, 0.94, 0.9, n, tones);
      break;
    }
    case 'roller': {
      slats(f, 0.05, 0, 0.95, 0.86, 0.1, tones);
      f.fill(0.03, 0.86, 0.97, 1, tones.dark);
      f.line([[0.03, 0.86], [0.97, 0.86]], tones.light, 0.5);
      break;
    }
    case 'shutter': {
      slats(f, 0.02, 0, 0.98, 0.94, 0.075, tones);
      f.fill(0.02, 0, 0.98, 0.06, tones.ink, 0.8);
      break;
    }
    case 'louvre': {
      const v0 = 0.36;
      const v1 = 0.82;
      f.fill(0.14, v0, 0.86, v1, tones.ink, 0.85);
      for (let v = v0 + 0.06; v < v1; v += 0.075) {
        f.line([[0.16, v], [0.84, v - 0.03]], tones.light, 0.65, 2);
      }
      f.frame(0.14, v0, 0.86, v1, tones.light, 0.6);
      break;
    }
    case 'hatch': {
      // One wheel-hatch per cell: a wide one would be a bulkhead, not a door.
      for (let i = 0; i < n; i += 1) {
        const cu = (i + 0.5) * cell;
        f.circle(cu, 0.46, 0.34).fill({ color: shade(tones.base, 0.9) });
        f.circle(cu, 0.46, 0.34).stroke({ width: 3, color: tones.ink, alpha: 0.85 });
        f.circle(cu, 0.46, 0.3).stroke({ width: 1, color: tones.light, alpha: 0.5, pixelLine: true });
        f.circle(cu, 0.46, 0.13).stroke({ width: 3, color: tones.light, alpha: 0.9 });
        for (let k = 0; k < 4; k += 1) {
          const t = (k / 4) * Math.PI;
          const du = (Math.cos(t) * 0.13) / (runPx / rise);
          const dv = Math.sin(t) * 0.13;
          f.line([[cu - du, 0.46 - dv], [cu + du, 0.46 + dv]], tones.light, 0.9, 2);
        }
        for (let k = 0; k < 6; k += 1) {
          const t = (k / 6) * Math.PI * 2;
          f.circle(cu + (Math.cos(t) * 0.3) / (runPx / rise), 0.46 + Math.sin(t) * 0.3, 0.02, 8).fill({
            color: tones.light,
            alpha: 0.9,
          });
        }
      }
      break;
    }
    case 'gap': {
      // A hole, with the wall's own colour ragged around it.
      const pad = cell * 0.2;
      f.fill(pad, 0, 1 - pad, 0.88, C.ground, 0.88);
      f.line(
        [
          [pad, 0.88],
          [pad + 0.02, 0.8],
          [pad - 0.01, 0.7],
          [pad + 0.015, 0.55],
          [pad, 0.4],
        ],
        tones.dark,
        0.9,
        2,
      );
      f.line(
        [
          [1 - pad, 0.88],
          [1 - pad - 0.02, 0.76],
          [1 - pad + 0.01, 0.62],
          [1 - pad - 0.015, 0.5],
          [1 - pad, 0.35],
        ],
        tones.dark,
        0.9,
        2,
      );
      break;
    }
    case 'blown': {
      f.fill(0.14, 0.3, 0.86, 0.82, C.ground, 0.88);
      f.frame(0.14, 0.3, 0.86, 0.82, tones.dark, 0.9);
      // Shards still in the frame.
      const shard = (pts: ReadonlyArray<readonly [number, number]>) =>
        f.poly(pts).fill({ color: GLASS, alpha: 0.55 });
      shard([[0.14, 0.82], [0.3, 0.82], [0.16, 0.66]]);
      shard([[0.86, 0.82], [0.72, 0.82], [0.85, 0.7]]);
      shard([[0.14, 0.3], [0.14, 0.44], [0.24, 0.31]]);
      shard([[0.86, 0.3], [0.86, 0.5], [0.76, 0.32]]);
      shard([[0.5, 0.82], [0.58, 0.82], [0.53, 0.72]]);
      break;
    }
    case 'serving': {
      f.fill(0.08, 0.36, 0.92, 0.78, C.ground, 0.75);
      f.fill(0.08, 0.36, 0.92, 0.78, glow, 0.28);
      f.frame(0.08, 0.36, 0.92, 0.78, tones.ink, 0.8);
      // The shelf, and a bottle or two on it.
      f.line([[0.04, 0.36], [0.96, 0.36]], tones.light, 0.95, 3);
      f.fill(0.3, 0.37, 0.34, 0.5, tones.light, 0.6);
      f.fill(0.62, 0.37, 0.65, 0.52, tones.light, 0.6);
      break;
    }
    case 'sign': {
      f.fill(0.08, 0.5, 0.92, 0.88, 0x141a22, 0.92);
      f.frame(0.08, 0.5, 0.92, 0.88, tones.ink, 0.9);
      // The tube: a wave across the box, drawn twice — a soft wide pass and a
      // hot thin one — which is how a tube reads at any distance.
      const wave: Array<readonly [number, number]> = [];
      for (let k = 0; k <= 12; k += 1) {
        const u = 0.15 + (0.7 * k) / 12;
        wave.push([u, 0.69 + Math.sin((k / 12) * Math.PI * 3) * 0.09]);
      }
      f.line(wave, glow, 0.35, 5);
      f.line(wave, glow, 1, 2);
      break;
    }
    case 'mesh': {
      f.fill(0.02, 0, 0.98, 0.96, C.ground, 0.25);
      for (let k = -8; k < 8 * n + 8; k += 1) {
        const u = k / (8 * n);
        f.line([[u, 0], [u + 0.12, 0.96]], tones.accent, 0.5);
        f.line([[u + 0.12, 0], [u, 0.96]], tones.accent, 0.5);
      }
      f.frame(0.02, 0, 0.98, 0.96, tones.light, 0.6);
      f.line([[0.02, 0.96], [0.98, 0.96]], tones.light, 0.9, 2);
      break;
    }
    default: {
      const unhandled: never = cut;
      void unhandled;
    }
  }
}

/** The plan-view symbol: what a floor plan draws for this opening. */
function drawSymbol(
  g: Graphics,
  m: SceneMetrics,
  cut: TileCut,
  run: CutRun,
  tones: CutTones,
  emissive: string | undefined,
): void {
  const P = topMap(m, run);
  const a = P(0, 0.5);
  const b = P(1, 0.5);
  const runPx = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const c0 = P(0, 0);
  const c1 = P(0, 1);
  const thickPx = Math.hypot(c1.x - c0.x, c1.y - c0.y) || 1;
  const f = new Face(g, P, runPx / thickPx);
  const n = run.n;
  const glow = emissive === undefined ? tones.light : parseColor(emissive, tones.light);

  /** A quarter-circle swing arc from a hinge at `u`, out across the floor. */
  const swing = (hingeU: number, toU: number) => {
    const [x0, y0, x1, y1] = run.rect;
    const len = run.axis === 'x' ? (x1 - x0) * Math.abs(toU - hingeU) : (y1 - y0) * Math.abs(toU - hingeU);
    const hinge =
      run.axis === 'x'
        ? { x: x0 + (x1 - x0) * hingeU, y: y1 }
        : { x: x1, y: y1 - (y1 - y0) * hingeU };
    const dir = toU > hingeU ? 1 : -1;
    const pts: Point[] = [];
    for (let k = 0; k <= 10; k += 1) {
      const t = (k / 10) * (Math.PI / 2);
      const along = Math.cos(t) * len * dir;
      const out = Math.sin(t) * len;
      pts.push(
        worldFromGrid(
          m,
          run.axis === 'x' ? { x: hinge.x + along, y: hinge.y + out } : { x: hinge.x + out, y: hinge.y - along },
        ),
      );
    }
    const h = worldFromGrid(m, hinge);
    g.moveTo(h.x, h.y);
    for (const p of pts) g.lineTo(p.x, p.y);
    g.stroke({ width: 1, color: tones.ink, alpha: 0.6, pixelLine: true });
    const end = pts[pts.length - 1]!;
    g.moveTo(h.x, h.y).lineTo(end.x, end.y).stroke({ width: 2, color: tones.light, alpha: 0.9 });
  };

  switch (cut) {
    case 'door':
    case 'porthole':
      f.fill(0, 0.2, 1, 0.8, shade(tones.base, 1.1));
      for (let i = 0; i < n; i += 1) swing(i < n / 2 ? i / n : (i + 1) / n, i < n / 2 ? (i + 1) / n : i / n);
      break;
    case 'maglock':
      f.fill(0, 0.2, 1, 0.8, shade(tones.base, 1.1));
      swing(0, 1);
      f.circle(1.02, 0.5, 0.15, 8).fill({ color: C.ok, alpha: 0.9 });
      break;
    case 'glassdoor':
      f.fill(0, 0.3, 1, 0.7, GLASS, 0.6);
      swing(0, 1);
      break;
    case 'glass':
    case 'wireglass':
    case 'shopwindow':
      f.fill(0, 0.25, 1, 0.75, GLASS, 0.55);
      f.line([[0, 0.5], [1, 0.5]], 0xffffff, 0.7);
      f.line([[0, 0.25], [1, 0.25]], tones.ink, 0.6);
      f.line([[0, 0.75], [1, 0.75]], tones.ink, 0.6);
      for (let i = 1; i < n; i += 1) f.line([[i / n, 0.2], [i / n, 0.8]], tones.dark, 0.9, 2);
      if (cut === 'shopwindow') f.fill(0, 0.25, 1, 0.75, glow, 0.25);
      break;
    case 'roller':
    case 'shutter':
      f.fill(0, 0.15, 1, 0.85, shade(tones.base, 1.08));
      for (let k = 1; k < 8 * n; k += 1) f.line([[k / (8 * n), 0.15], [k / (8 * n), 0.85]], tones.ink, 0.6);
      break;
    case 'louvre':
      f.fill(0, 0.3, 1, 0.7, tones.ink, 0.7);
      for (let k = 0; k <= 6 * n; k += 1) f.line([[k / (6 * n), 0.3], [k / (6 * n), 0.7]], tones.light, 0.7);
      break;
    case 'hatch':
      for (let i = 0; i < n; i += 1) {
        f.circle((i + 0.5) / n, 0.5, 0.42).fill({ color: shade(tones.base, 1.05) });
        f.circle((i + 0.5) / n, 0.5, 0.42).stroke({ width: 2, color: tones.ink, alpha: 0.9 });
        f.circle((i + 0.5) / n, 0.5, 0.16).stroke({ width: 2, color: tones.light, alpha: 0.9 });
      }
      break;
    case 'gap':
    case 'blown':
      f.fill(0, 0, 1, 1, C.ground, 0.7);
      for (let k = 0; k < 6 * n; k += 2) {
        f.line([[k / (6 * n), 0.15], [(k + 1) / (6 * n), 0.15]], tones.light, 0.8);
        f.line([[k / (6 * n), 0.85], [(k + 1) / (6 * n), 0.85]], tones.light, 0.8);
      }
      break;
    case 'serving':
      f.fill(0, 0.3, 1, 0.7, C.ground, 0.6);
      f.fill(0, 0.3, 1, 0.7, glow, 0.3);
      f.line([[0, 0.7], [1, 0.7]], tones.light, 0.95, 2);
      break;
    case 'sign':
      f.fill(0.1, 0.1, 0.9, 0.9, 0x141a22, 0.9);
      f.line([[0.2, 0.5], [0.8, 0.5]], glow, 0.4, 4);
      f.line([[0.2, 0.5], [0.8, 0.5]], glow, 1, 2);
      break;
    case 'mesh':
      f.fill(0, 0.35, 1, 0.65, C.ground, 0.3);
      for (let k = 0; k <= 6 * n; k += 1) f.line([[k / (6 * n), 0.35], [k / (6 * n), 0.65]], tones.accent, 0.7);
      f.line([[0, 0.5], [1, 0.5]], tones.accent, 0.9, 2);
      break;
    default: {
      const unhandled: never = cut;
      void unhandled;
    }
  }
}
