/**
 * Furniture and props, drawn as what they are (FR9.2).
 *
 * An object used to be one of four blobs — a box, a post, a squat cylinder,
 * a post with a crown — and a desk, a car and a pallet stack were the same box
 * in three browns. Every object tile in the catalogue now names a DESIGN
 * (`prop: 'desk'`, `'car'`, `'lamppost'` — `TILE_PROPS`), and this module
 * builds it: a slab on pedestals with a monitor, a low body with a glazed
 * cabin and wheels, a pole with an arm and a head that throws its pool on the
 * pavement. Eighty designs dress sixteen worlds because the palette stays the
 * tile's own; the design only says what shape it is painted on.
 *
 * ## One drawing, two projections
 *
 * Each design is built from small solids placed in CELL SPACE: `u` and `v`
 * run 0→1 across the cell, `z` is height in cells. The kit projects every
 * point through the scene's own projection, so in isometric a solid gets its
 * two lit faces and its top, and in plan the same call draws only the top —
 * which is the floor-plan symbol for free. A chair from above is a seat and a
 * back; a car is a body and a cabin; a tree is a crown with a trunk dot. No
 * second drawing per design, and the two views cannot disagree.
 *
 * ## Order is occlusion
 *
 * There is no depth buffer: a part drawn later covers a part drawn earlier.
 * Every design draws back to front and bottom to top — the pedestals before
 * the desktop, the trunk before the crown — which is the same painter's rule
 * the cell sort uses, applied inside one cell.
 */
import type { Graphics } from 'pixi.js';
import type { Point } from '@safehouse/contracts';
import type { TileProp } from '@safehouse/rules';
import { groundRadius, worldFromGrid, type SceneMetrics } from '../geometry.js';
import { C, FACE_FOOT, FACE_SHADE, shade } from './colors.js';

/** The tones the prop is drawn with — the same derived palette as any tile. */
export interface PropTones {
  base: number;
  accent: number;
  light: number;
  dark: number;
  ink: number;
}

/** A point in cell space: across, down, up. */
type P3 = readonly [u: number, v: number, z: number];

/** Glass: the cool tint every set's glazing shares (see `cuts.ts`). */
export const GLASS = 0x9fd4e6;
/** Leaves, for the things that grow in pots and planters whatever set they are in. */
export const FOLIAGE = 0x6f8657;

interface BoxOpts {
  /** Draw the ink silhouette (default on). */
  ink?: boolean;
  /** Draw the lit crown edge (default on). */
  crown?: boolean;
  alpha?: number;
}

interface CylOpts {
  sides?: number;
  /** Per-vertex radius jitter, 0..1 of the radius — a crown, a bag, a mound. */
  jitter?: number;
  salt?: number;
  alpha?: number;
  ink?: boolean;
}

/**
 * The drawing kit for one cell. `unit` is the screen height of one cell of
 * `z` — zero in plan, which is what switches every solid to its top face.
 */
export class PropKit {
  readonly plan: boolean;

  constructor(
    readonly g: Graphics,
    private readonly m: SceneMetrics,
    private readonly col: number,
    private readonly row: number,
    readonly unit: number,
    readonly t: PropTones,
    private readonly seed: number,
    /** Cells below the floor the whole design stands: a boat floating in sunk water. */
    private readonly sink = 0,
  ) {
    this.plan = unit <= 0;
  }

  /** Cell space to world pixels. */
  at(p: P3): Point {
    const w = worldFromGrid(this.m, { x: this.col + p[0], y: this.row + p[1] });
    return { x: w.x, y: w.y - (p[2] - this.sink) * this.unit };
  }

  /** Deterministic 0..1 per (cell, salt), so a prop never flickers between draws. */
  rnd(salt: number): number {
    let h = (this.seed ^ (salt * 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  private trace(pts: readonly P3[], close = true): Graphics {
    const a = this.at(pts[0]!);
    this.g.moveTo(a.x, a.y);
    for (let i = 1; i < pts.length; i += 1) {
      const p = this.at(pts[i]!);
      this.g.lineTo(p.x, p.y);
    }
    return close ? this.g.closePath() : this.g;
  }

  /** A filled polygon through cell-space points, optionally inked. */
  poly(pts: readonly P3[], color: number, alpha = 1, ink = false): void {
    this.trace(pts).fill({ color, alpha });
    if (ink) this.trace(pts).stroke({ width: 1, color: this.t.ink, alpha: 0.5, pixelLine: true });
  }

  /** A polyline. In plan the heights fall away and a leg becomes a dot. */
  line(pts: readonly P3[], color: number, width = 1, alpha = 1): void {
    this.trace(pts, false).stroke({
      width,
      color,
      alpha,
      ...(width <= 1 ? { pixelLine: true } : {}),
    });
  }

  /** One vertical face between two ground points, shaded like every wall. */
  private face(a: readonly [number, number], b: readonly [number, number], z0: number, z1: number, color: number, lit: number, alpha: number): void {
    const bands = (z1 - z0) * this.unit > 14 ? 3 : 1;
    for (let i = 0; i < bands; i += 1) {
      const lo = z0 + ((z1 - z0) * i) / bands;
      const hi = z0 + ((z1 - z0) * (i + 1)) / bands;
      const k = lit * (FACE_FOOT + (1 - FACE_FOOT) * ((i + 0.5) / bands));
      this.poly([[a[0], a[1], lo], [b[0], b[1], lo], [b[0], b[1], hi], [a[0], a[1], hi]], shade(color, k), alpha);
    }
  }

  /**
   * A box over the rect `[u0,v0]..[u1,v1]`, from `z0` up to `z1`. Returns the
   * top face in world points, for a glow or for stacking.
   */
  box(u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, color: number, opts: BoxOpts = {}): Point[] {
    const alpha = opts.alpha ?? 1;
    const top: P3[] = [[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]];
    if (!this.plan && z1 > z0) {
      // The two faces turned toward the viewer: W→S and S→E, as `drawBox`.
      this.face([u0, v1], [u1, v1], z0, z1, color, FACE_SHADE.left, alpha);
      this.face([u1, v1], [u1, v0], z0, z1, color, FACE_SHADE.right, alpha);
    }
    this.poly(top, this.plan || z1 <= z0 ? color : shade(color, FACE_SHADE.top), alpha);
    if (opts.ink !== false) {
      if (this.plan || z1 <= z0) {
        this.trace(top).stroke({ width: 1, color: this.t.ink, alpha: 0.5, pixelLine: true });
      } else {
        this.trace([[u0, v0, z1], [u1, v0, z1], [u1, v0, z0], [u1, v1, z0], [u0, v1, z0], [u0, v1, z1]]).stroke({
          width: 1,
          color: this.t.ink,
          alpha: 0.5,
          pixelLine: true,
        });
      }
    }
    if (opts.crown !== false && !this.plan && z1 > z0) {
      this.trace(top).stroke({ width: 1, color: shade(color, 1.35), alpha: 0.42, pixelLine: true });
    }
    return top.map((p) => this.at(p));
  }

  /** The ring of a horizontal circle, in cell space. */
  private circle(cu: number, cv: number, r: number, z: number, sides: number, jitter = 0, salt = 0): P3[] {
    const pts: P3[] = [];
    for (let i = 0; i < sides; i += 1) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      const rr = r * (1 - jitter * this.rnd(100 + salt * 31 + i));
      pts.push([cu + Math.cos(a) * rr, cv + Math.sin(a) * rr, z]);
    }
    return pts;
  }

  /** A cylinder (a prism, near enough) from `z0` to `z1`. Returns its top. */
  cyl(cu: number, cv: number, r: number, z0: number, z1: number, color: number, opts: CylOpts = {}): Point[] {
    const sides = opts.sides ?? 8;
    const alpha = opts.alpha ?? 1;
    const ring = this.circle(cu, cv, r, z0, sides, opts.jitter ?? 0, opts.salt ?? 0);
    if (!this.plan && z1 > z0) {
      // Side faces painted back to front by their own depth, two shades so
      // the curve reads as a curve.
      const faces = ring.map((p, i) => {
        const q = ring[(i + 1) % sides]!;
        return {
          depth: p[0] + p[1] + q[0] + q[1],
          a: [p[0], p[1]] as const,
          b: [q[0], q[1]] as const,
          lit: i % 2 === 0 ? FACE_SHADE.left : FACE_SHADE.right,
        };
      });
      faces.sort((a, b) => a.depth - b.depth);
      for (const f of faces) this.face(f.a, f.b, z0, z1, color, f.lit, alpha);
    }
    const top = ring.map((p): P3 => [p[0], p[1], z1]);
    this.poly(top, this.plan || z1 <= z0 ? color : shade(color, FACE_SHADE.top), alpha, opts.ink ?? true);
    if (!this.plan && z1 > z0) {
      this.trace(top).stroke({ width: 1, color: shade(color, 1.35), alpha: 0.42, pixelLine: true });
    }
    return top.map((p) => this.at(p));
  }

  /** A flat disc at height `z`: a lid, a seat, a puddle of light. */
  disc(cu: number, cv: number, r: number, z: number, color: number, alpha = 1, ink = false): void {
    const c = this.at([cu, cv, z]);
    const { rx, ry } = groundRadius(this.m, r);
    const e = this.g.ellipse(c.x, c.y, rx, ry).fill({ color, alpha });
    if (ink) e.stroke({ width: 1, color: this.t.ink, alpha: 0.45, pixelLine: true });
  }

  /** The visible (near) half of a band around a cylinder. Nothing in plan. */
  band(cu: number, cv: number, r: number, z: number, color: number, alpha = 0.6, width = 1): void {
    if (this.plan) return;
    const pts: P3[] = [];
    for (let i = 0; i <= 8; i += 1) {
      const a = -Math.PI / 4 + (i / 8) * Math.PI;
      pts.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, z]);
    }
    this.line(pts, color, width, alpha);
  }

  /**
   * A circle standing on a vertical face — a wheel, a speaker cone, a fan
   * grille. `along: 'u'` is the south face (the one running W→S), `'v'` the
   * east face. Invisible in plan, where a vertical face has no area.
   */
  faceCircle(u: number, v: number, z: number, r: number, along: 'u' | 'v', color: number, alpha = 1, ink = false): void {
    if (this.plan) return;
    const a0 = this.at([0, 0, 0]);
    const a1 = along === 'u' ? this.at([1, 0, 0]) : this.at([0, 1, 0]);
    const runPx = Math.hypot(a1.x - a0.x, a1.y - a0.y) || 1;
    const k = this.unit / runPx;
    const pts: P3[] = [];
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      const d = Math.cos(a) * r * k;
      pts.push(along === 'u' ? [u + d, v, z + Math.sin(a) * r] : [u, v + d, z + Math.sin(a) * r]);
    }
    this.poly(pts, color, alpha, ink);
  }

  /** A rectangle on the south face (`along: 'u'`) or the east face (`'v'`). */
  facePanel(along: 'u' | 'v', at: number, a0: number, z0: number, a1: number, z1: number, color: number, alpha = 1, ink = false): void {
    if (this.plan) return;
    const pts: P3[] =
      along === 'u'
        ? [[a0, at, z0], [a1, at, z0], [a1, at, z1], [a0, at, z1]]
        : [[at, a0, z0], [at, a1, z0], [at, a1, z1], [at, a0, z1]];
    this.poly(pts, color, alpha, ink);
  }

  /** A circle on the ground, in world points — where a light's pool goes. */
  pool(cu: number, cv: number, r: number): Point[] {
    return this.circle(cu, cv, r, 0, 12).map((p) => this.at(p));
  }

  /** Cell-space points as world points, drawing nothing — a face to hand to the light pass. */
  pts(list: readonly P3[]): Point[] {
    return list.map((p) => this.at(p));
  }
}

/**
 * One design. `h` is the tile's height in cells (0 for a flat prop), `glow`
 * its light colour if it has one. Returns the face a light pass should treat
 * as the fixture, or null when the prop gives off nothing.
 */
export type Draw = (k: PropKit, h: number, glow: number | null) => Point[] | null;

/** Where each design stands in its cell — its shadow, its ambient ring. */
const FOOTPRINTS: Readonly<Record<TileProp, readonly [number, number, number, number]>> = {
  desk: [0.08, 0.2, 0.92, 0.8],
  chair: [0.25, 0.28, 0.75, 0.75],
  sofa: [0.05, 0.25, 0.95, 0.85],
  table: [0.1, 0.15, 0.9, 0.85],
  cocktail: [0.18, 0.18, 0.82, 0.82],
  booth: [0.05, 0.05, 0.95, 0.95],
  stool: [0.3, 0.3, 0.7, 0.7],
  terminal: [0.25, 0.3, 0.75, 0.7],
  server: [0.15, 0.1, 0.85, 0.9],
  locker: [0.1, 0.15, 0.9, 0.85],
  vending: [0.1, 0.15, 0.9, 0.85],
  cooler: [0.35, 0.35, 0.65, 0.65],
  bin: [0.28, 0.28, 0.72, 0.72],
  fountain: [0.08, 0.08, 0.92, 0.92],
  plant: [0.2, 0.2, 0.8, 0.8],
  decks: [0.05, 0.25, 0.95, 0.8],
  speakers: [0.2, 0.2, 0.8, 0.8],
  column: [0.24, 0.24, 0.76, 0.76],
  crates: [0.05, 0.1, 0.95, 0.9],
  pallet: [0.06, 0.1, 0.94, 0.9],
  barrel: [0.2, 0.2, 0.8, 0.8],
  forklift: [0.15, 0.05, 0.85, 0.8],
  container: [0.05, 0.15, 0.95, 0.85],
  spool: [0.1, 0.1, 0.9, 0.9],
  worklight: [0.3, 0.2, 0.7, 0.75],
  generator: [0.1, 0.2, 0.9, 0.8],
  tank: [0.1, 0.1, 0.9, 0.9],
  valves: [0.2, 0.4, 0.8, 0.6],
  pump: [0.15, 0.25, 0.88, 0.75],
  fan: [0.2, 0.35, 0.8, 0.65],
  car: [0.05, 0.25, 0.95, 0.75],
  van: [0.05, 0.22, 0.95, 0.78],
  tree: [0.08, 0.08, 0.92, 0.92],
  bush: [0.15, 0.15, 0.85, 0.85],
  planter: [0.15, 0.15, 0.85, 0.85],
  hydrant: [0.36, 0.36, 0.64, 0.64],
  bollard: [0.4, 0.4, 0.6, 0.6],
  lamppost: [0.42, 0.42, 0.58, 0.58],
  dumpster: [0.08, 0.2, 0.92, 0.8],
  cone: [0.34, 0.34, 0.66, 0.66],
  trash: [0.12, 0.2, 0.85, 0.85],
  fire: [0.24, 0.24, 0.76, 0.76],
  wreck: [0.05, 0.28, 0.95, 0.72],
  tyres: [0.18, 0.18, 0.82, 0.82],
  tent: [0.1, 0.1, 0.9, 0.9],
  heap: [0.08, 0.08, 0.92, 0.92],
  mattress: [0.1, 0.15, 0.9, 0.85],
  lantern: [0.3, 0.3, 0.7, 0.7],
  cart: [0.18, 0.28, 0.82, 0.82],
  bed: [0.08, 0.05, 0.92, 0.95],
  counter: [0.05, 0.3, 0.95, 0.85],
  stove: [0.12, 0.2, 0.88, 0.85],
  fridge: [0.2, 0.2, 0.8, 0.85],
  sink: [0.12, 0.25, 0.88, 0.85],
  bookshelf: [0.05, 0.6, 0.95, 0.9],
  tv: [0.15, 0.35, 0.85, 0.7],
  umbrella: [0.1, 0.1, 0.9, 0.9],
  grill: [0.25, 0.25, 0.75, 0.75],
  bar: [0.05, 0.3, 0.95, 0.85],
  menu: [0.3, 0.4, 0.7, 0.7],
  chandelier: [0.2, 0.2, 0.8, 0.8],
  statue: [0.25, 0.25, 0.75, 0.75],
  hedge: [0.05, 0.25, 0.95, 0.75],
  bench: [0.08, 0.35, 0.92, 0.7],
  picnic: [0.08, 0.15, 0.92, 0.85],
  signpost: [0.4, 0.4, 0.6, 0.6],
  swing: [0.08, 0.3, 0.92, 0.7],
  flag: [0.4, 0.4, 0.6, 0.6],
  bike: [0.15, 0.35, 0.85, 0.65],
  rocks: [0.1, 0.15, 0.9, 0.85],
  firepit: [0.15, 0.15, 0.85, 0.85],
  boat: [0.1, 0.05, 0.9, 0.95],
  canoe: [0.2, 0.05, 0.8, 0.95],
  buoy: [0.3, 0.3, 0.7, 0.7],
  cleat: [0.3, 0.35, 0.7, 0.65],
  haybale: [0.15, 0.2, 0.85, 0.8],
  tractor: [0.1, 0.1, 0.9, 0.9],
  well: [0.15, 0.15, 0.85, 0.85],
  trough: [0.1, 0.3, 0.9, 0.7],
  logs: [0.1, 0.25, 0.9, 0.8],
};

/** Four legs from the corners of a slab to the ground. */
export function legs(k: PropKit, u0: number, v0: number, u1: number, v1: number, z: number, color: number): void {
  const inset = 0.04;
  for (const [u, v] of [
    [u0 + inset, v0 + inset],
    [u1 - inset, v0 + inset],
    [u1 - inset, v1 - inset],
    [u0 + inset, v1 - inset],
  ] as const) {
    k.line([[u, v, 0], [u, v, z]], color, 2, 0.9);
  }
}

/** Four wheels seen on the south face, at the ends of a body. */
export function wheels(k: PropKit, v: number, z: number, r: number, u0: number, u1: number): void {
  k.faceCircle(u0, v, z, r, 'u', k.t.ink, 0.95);
  k.faceCircle(u1, v, z, r, 'u', k.t.ink, 0.95);
  k.faceCircle(u0, v, z, r * 0.45, 'u', k.t.light, 0.7);
  k.faceCircle(u1, v, z, r * 0.45, 'u', k.t.light, 0.7);
}

/** A drum: ribs and a lid. Shared by barrels, kegs and the fire. */
export function drum(k: PropKit, h: number, color: number): Point[] {
  const top = k.cyl(0.5, 0.5, 0.3, 0, h * 0.95, color, { sides: 10 });
  k.band(0.5, 0.5, 0.3, h * 0.3, k.t.light, 0.5);
  k.band(0.5, 0.5, 0.3, h * 0.65, k.t.light, 0.5);
  k.band(0.5, 0.5, 0.3, h * 0.12, k.t.ink, 0.5);
  k.disc(0.5, 0.5, 0.24, h * 0.95, shade(color, 1.1), 1, true);
  return top;
}

/** A cabinet: locker doors or a machine body. */
export function cabinet(k: PropKit, h: number, color: number): Point[] {
  return k.box(0.1, 0.15, 0.9, 0.85, 0, h, color);
}

function officeTop(k: PropKit, color: number, f: number): number {
  return shade(color, (k.plan ? 1 : 0.875) * f);
}

function officeCap(c: number): number {
  const m = Math.max((c >> 16) & 255, (c >> 8) & 255, c & 255);
  return m > 190 ? shade(c, 190 / m) : c;
}

function officeRect(u0: number, v0: number, u1: number, v1: number, z: number): [number, number, number][] {
  return [[u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z]];
}

function officeHull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = p.length - 1; i >= 0; i -= 1) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function officeOutline(k: PropKit, pts: [number, number, number][], alpha = 0.5): void {
  const w = officeHull(pts.map((p) => k.at(p)));
  if (w.length < 2) return;
  k.g.moveTo(w[0]!.x, w[0]!.y);
  for (let i = 1; i < w.length; i += 1) k.g.lineTo(w[i]!.x, w[i]!.y);
  k.g.closePath().stroke({ width: 1, color: k.t.ink, alpha, pixelLine: true });
}

/** A box turned `rot` radians about its centre: visible faces, top, ink hull, crown. Returns the top ring. */
function officeSlab(k: PropKit, cu: number, cv: number, hu: number, hv: number, rot: number, z0: number, z1: number, color: number, crown = true): [number, number, number][] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const ring: [number, number][] = ([[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]] as const).map(([du, dv]) => [cu + du * c - dv * s, cv + du * s + dv * c]);
  const top = ring.map(([u, v]): [number, number, number] => [u, v, z1]);
  if (!k.plan && z1 > z0) {
    const faces: { d: number; a: [number, number]; b: [number, number]; lit: number }[] = [];
    for (let i = 0; i < 4; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % 4]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nu = (b[1] - a[1]) / len;
      const nv = -(b[0] - a[0]) / len;
      if (nu + nv <= 1e-6) continue;
      const lit = 0.688 + 0.094 * Math.min(1, Math.max(0, (nv - nu + 1) / 2));
      faces.push({ d: a[0] + a[1] + b[0] + b[1], a, b, lit });
    }
    faces.sort((x, y) => x.d - y.d);
    const bands = (z1 - z0) * k.unit > 14 ? 3 : 1;
    for (const f of faces) {
      for (let i = 0; i < bands; i += 1) {
        const lo = z0 + ((z1 - z0) * i) / bands;
        const hi = z0 + ((z1 - z0) * (i + 1)) / bands;
        k.poly([[f.a[0], f.a[1], lo], [f.b[0], f.b[1], lo], [f.b[0], f.b[1], hi], [f.a[0], f.a[1], hi]], shade(color, f.lit * (0.74 + 0.26 * ((i + 0.5) / bands))));
      }
    }
  }
  k.poly(top, k.plan ? color : shade(color, 0.875));
  officeOutline(k, k.plan ? top : [...top, ...ring.map(([u, v]): [number, number, number] => [u, v, z0])]);
  if (crown && !k.plan) k.line([...top, top[0]!], shade(color, 1.35), 1, 0.42);
  return top;
}

/** A flat monitor at the back of a desk, screen facing south. Returns the screen quad. */
function officeMonitor(k: PropKit, cu: number, v: number, w: number, zt: number, h: number, glow: number | null, salt: number): [number, number, number][] {
  const t = k.t;
  const z0 = zt + h * 0.1;
  const z1 = zt + h * 0.38;
  const body = shade(t.ink, 1.32);
  k.poly(officeRect(cu - 0.055, v - 0.045, cu + 0.055, v + 0.03, zt + 0.002), shade(t.ink, k.plan ? 1 : 0.9), 1);
  if (!k.plan) k.line([[cu, v - 0.02, zt], [cu, v - 0.02, z0]], shade(t.ink, 0.8), 2, 1);
  k.box(cu - w / 2, v - 0.035, cu + w / 2, v, z0, z1, body, { crown: false });
  const a = cu - w / 2 + 0.016;
  const b = cu + w / 2 - 0.016;
  const lo = z0 + h * 0.03;
  const hi = z1 - h * 0.025;
  const scr: [number, number, number][] = [[a, v + 0.001, lo], [b, v + 0.001, lo], [b, v + 0.001, hi], [a, v + 0.001, hi]];
  if (!k.plan) {
    k.poly(scr, glow ?? shade(t.ink, 0.62), glow ? 0.92 : 1);
    if (glow === null) {
      const s = 0.2 + k.rnd(salt) * 0.3;
      const wd = b - a;
      k.poly([[a + wd * s, v + 0.002, lo], [a + wd * (s + 0.16), v + 0.002, lo], [a + wd * (s + 0.34), v + 0.002, hi], [a + wd * (s + 0.18), v + 0.002, hi]], GLASS, 0.16);
    } else {
      for (let i = 0; i < 2; i += 1) {
        const z = lo + (hi - lo) * (0.35 + i * 0.3);
        k.line([[a + 0.02, v + 0.002, z], [a + 0.02 + (b - a - 0.04) * (0.4 + k.rnd(salt + i) * 0.5), v + 0.002, z]], shade(glow, 0.55), 1, 0.6);
      }
    }
  }
  return scr;
}

function officeCounterCase(k: PropKit, h: number, glow: number | null): { x: number; y: number }[] | null {
  // Waist-height vending: a counter with a lit glass case and a machine beside it (the espresso bar, the pastry case).
  const t = k.t;
  const zc = h * 0.56;
  k.box(0.12, 0.17, 0.88, 0.83, 0, h * 0.06, t.ink, { crown: false });
  k.box(0.1, 0.15, 0.9, 0.85, h * 0.06, h * 0.5, t.base);
  if (!k.plan) {
    // Two doors under the counter, a steel kick and a lit trim under the top.
    k.line([[0.5, 0.852, h * 0.08], [0.5, 0.852, h * 0.46]], t.ink, 1, 0.55);
    for (const u of [0.46, 0.54]) k.line([[u, 0.853, h * 0.26], [u, 0.853, h * 0.36]], officeCap(shade(t.light, 1.1)), 1, 0.8);
    k.facePanel('u', 0.852, 0.1, h * 0.06, 0.9, h * 0.11, shade(t.ink, 1.2), 0.8);
    k.facePanel('v', 0.902, 0.15, h * 0.06, 0.85, h * 0.11, shade(t.ink, 1.2), 0.8);
  }
  k.box(0.08, 0.13, 0.92, 0.87, h * 0.5, zc, shade(t.base, 1.12));
  // The case: a steel sill, a lit back, trays of goods under a sloped glass front and a lid.
  const u0 = 0.12;
  const u1 = 0.6;
  const zs = zc + h * 0.1;
  const zt = zc + h * 0.46;
  const slope: [number, number, number][] = [[u0, 0.86, zs], [u1, 0.86, zs], [u1, 0.42, zt], [u0, 0.42, zt]];
  if (!k.plan) {
    k.box(u0, 0.3, u1, 0.86, zc, zs, shade(t.ink, 1.25), { crown: false });
    k.poly(officeRect(u0, 0.34, u1, 0.86, zs + 0.001), glow ? shade(glow, 0.5) : shade(t.ink, 0.8), 1);
    k.box(u0, 0.28, u1, 0.34, zs, zt, shade(t.base, 0.9), { crown: false, ink: false });
    if (glow !== null) k.facePanel('u', 0.341, u0, zs, u1, zt, glow, 0.45);
    const goods = [shade(t.accent, 1.05), 0x9a7048, 0x8c5a3c, officeCap(shade(t.light, 1.12)), 0x7d6a45, 0x94574a];
    for (let r = 0; r < 3; r += 1) {
      const v = 0.46 + r * 0.14;
      const lift = h * (r === 0 ? 0.1 : 0.05);
      for (let i = 0; i < 3; i += 1) {
        const s = 120 + r * 3 + i;
        if (k.rnd(s) < 0.2) continue;
        const u = u0 + 0.085 + i * 0.155 + (k.rnd(s + 20) - 0.5) * 0.03;
        const col = goods[Math.floor(k.rnd(s + 40) * goods.length)]!;
        const rr = r === 0 ? 0.05 : 0.042;
        k.disc(u, v, rr, zs + 0.002, shade(col, 0.62), 1);
        k.disc(u, v, rr, zs + lift, col, 1);
      }
    }
    // The glass: the sloped front, a sheen across it, the framed east end.
    k.poly(slope, GLASS, glow ? 0.1 : 0.18);
    k.poly([[0.2, 0.86, zs], [0.3, 0.86, zs], [0.4, 0.42, zt], [0.3, 0.42, zt]], GLASS, 0.22);
    k.line([[u0, 0.862, zs], [u1, 0.862, zs]], officeCap(shade(t.light, 1.2)), 1, 0.7);
    k.poly([[u1, 0.86, zc], [u1, 0.28, zc], [u1, 0.28, zt], [u1, 0.42, zt], [u1, 0.86, zs]], shade(t.base, 0.66), 1, true);
    k.poly([[u1 + 0.001, 0.8, zs], [u1 + 0.001, 0.34, zs], [u1 + 0.001, 0.34, zt - h * 0.04], [u1 + 0.001, 0.45, zt - h * 0.04]], shade(t.ink, 0.8), 1);
    k.poly([[u1 + 0.002, 0.8, zs], [u1 + 0.002, 0.34, zs], [u1 + 0.002, 0.34, zt - h * 0.04], [u1 + 0.002, 0.45, zt - h * 0.04]], glow ?? GLASS, glow ? 0.35 : 0.22);
  } else {
    k.poly(officeRect(u0, 0.42, u1, 0.86, zs), glow ? shade(glow, 0.8) : GLASS, glow ? 0.55 : 0.35);
    k.line([[u0, 0.64, zs], [u1, 0.64, zs]], GLASS, 1, 0.8);
    k.line([[u0, 0.86, zs], [u1, 0.86, zs]], t.ink, 1, 0.6);
  }
  k.box(u0, 0.28, u1, 0.42, zt, zt + h * 0.035, shade(t.base, 1.05));
  // The lamp strip under the lid's front edge: the fixture, so the goods stay visible below it.
  const strip: [number, number, number][] = [[u0 + 0.02, 0.425, zt - h * 0.005], [u1 - 0.02, 0.425, zt - h * 0.005], [u1 - 0.02, 0.48, zt - h * 0.05], [u0 + 0.02, 0.48, zt - h * 0.05]];
  if (!k.plan) k.poly(strip, glow ?? shade(t.ink, 1.5), glow ? 0.9 : 0.6);
  // The machine: a dark steel body, its readout, a spout over the drip tray.
  const mz = zc + h * 0.46;
  k.box(0.65, 0.28, 0.88, 0.6, zc, mz, shade(t.ink, 1.4));
  if (!k.plan) {
    k.facePanel('u', 0.601, 0.68, zc + h * 0.33, 0.85, zc + h * 0.4, glow ?? shade(t.ink, 0.7), glow ? 0.9 : 1);
    k.facePanel('u', 0.601, 0.71, zc + h * 0.17, 0.82, zc + h * 0.24, shade(t.ink, 0.8), 1);
    for (const u of [0.745, 0.785]) k.line([[u, 0.602, zc + h * 0.17], [u, 0.602, zc + h * 0.12]], shade(t.ink, 0.7), 1, 0.9);
    k.line([[0.881, 0.5, mz - h * 0.08], [0.9, 0.56, zc + h * 0.14]], shade(t.light, 1.1), 1, 0.7);
  }
  k.box(0.67, 0.6, 0.86, 0.7, zc, zc + h * 0.035, t.ink, { crown: false });
  if (k.rnd(33) < 0.6) {
    const cup = officeCap(shade(t.light, 1.15));
    if (!k.plan) k.facePanel('u', 0.66, 0.745, zc + h * 0.035, 0.785, zc + h * 0.1, cup, 1);
    else k.disc(0.765, 0.65, 0.025, zc, cup, 1);
  }
  // Cups warming on the machine's roof.
  const cups = Math.floor(k.rnd(34) * 3.4);
  for (let i = 0; i < cups; i += 1) k.disc(0.7 + i * 0.055, 0.38 + (i % 2) * 0.05, 0.022, mz + 0.002, officeCap(shade(t.light, 1.1 - i * 0.05)), 1, true);
  if (glow === null) return null;
  return k.plan ? k.pts(officeRect(u0 + 0.02, 0.42, u1 - 0.02, 0.5, zt)) : k.pts(strip);
}

function officeDashes(k: PropKit, segs: [number, number, number][][], color: number, alpha: number): void {
  // Several short strokes in one draw call: keys, vent slits, text lines.
  for (const [a, b] of segs) {
    const p = k.at(a!);
    const q = k.at(b!);
    k.g.moveTo(p.x, p.y).lineTo(q.x, q.y);
  }
  if (segs.length) k.g.stroke({ width: 1, color, alpha, pixelLine: true });
}

function loungeCap(c: number, max = 0.74): number {
  const m = Math.max((c >> 16) & 255, (c >> 8) & 255, c & 255) / 255;
  return m > max ? shade(c, max / m) : c;
}

function loungeFace(c: number, along: 'u' | 'v', pos: number): number {
  return shade(c, (along === 'u' ? 0.782 : 0.688) * (0.74 + 0.26 * pos));
}

function loungeGlass(k: PropKit, u: number, v: number, z: number, tall: number, drink: number | null): void {
  if (k.plan) {
    k.disc(u, v, 0.03, z, GLASS, 0.55);
    if (drink !== null) k.disc(u, v, 0.018, z, drink, 0.9);
    return;
  }
  k.line([[u, v, z], [u, v, z + tall]], GLASS, 3, 0.45);
  if (drink !== null) k.line([[u, v, z], [u, v, z + tall * 0.6]], drink, 2.2, 0.95);
  k.disc(u, v, 0.02, z + tall, GLASS, 0.6);
}

function loungeBottle(k: PropKit, u: number, v: number, z: number, tall: number, color: number, alpha: number): void {
  if (k.plan) {
    k.disc(u, v, 0.028, z, color, alpha);
    return;
  }
  k.line([[u, v, z], [u, v, z + tall]], color, 3.2, alpha);
  k.line([[u, v, z + tall], [u, v, z + tall + tall * 0.45]], color, 1.4, alpha);
}

function loungeMug(k: PropKit, u: number, v: number, z: number, h: number): void {
  const t = k.t;
  const ceramic = loungeCap(shade(t.light, 1.15));
  if (!k.plan) k.line([[u, v, z], [u, v, z + h * 0.08]], ceramic, 3.5, 1);
  k.disc(u, v, 0.028, z + h * 0.08, k.plan ? ceramic : shade(t.ink, 0.7), 1);
}

/** Keep an environment surface at or under V 75% (TILE_ART rule 7). */
function homeCap(c: number): number {
  const m = Math.max((c >> 16) & 255, (c >> 8) & 255, c & 255);
  return m > 191 ? shade(c, 191 / m) : c;
}

/** Blend two colours, `t` of the way from `a` to `b`. */
function homeMix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A flat rectangle lying on the plane `z`. */
function homeFlat(k: PropKit, u0: number, v0: number, u1: number, v1: number, z: number, color: number, alpha = 1, ink = false): void {
  k.poly([[u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z]], color, alpha, ink);
}

/** Vertical joints on the south face at `v`, as one serpentine stroke. */
function homeJointsU(k: PropKit, v: number, us: readonly number[], z0: number, z1: number, color: number, alpha: number): void {
  if (k.plan || us.length === 0) return;
  const pts: Array<[number, number, number]> = [];
  us.forEach((u, i) => {
    const up = i % 2 === 0;
    pts.push([u, v, up ? z0 : z1], [u, v, up ? z1 : z0]);
  });
  k.line(pts, color, 1, alpha);
}

/**
 * A tapered round solid — a pot, a bin, a saucepan — drawing only the faces
 * that turn toward the viewer, shaded by the angle they face. `sides` even.
 */
function homeTaper(k: PropKit, cu: number, cv: number, r0: number, r1: number, z0: number, z1: number, color: number, sides = 10, bands = 1): void {
  const step = (Math.PI * 2) / sides;
  const ring = (r: number, z: number): Array<[number, number, number]> => {
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < sides; i += 1) {
      const a = -Math.PI / 4 + i * step;
      out.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, z]);
    }
    return out;
  };
  const lo = ring(r0, z0);
  const hi = ring(r1, z1);
  if (!k.plan && z1 > z0) {
    const faces: Array<{ i: number; am: number; vis: number }> = [];
    for (let i = 0; i < sides; i += 1) {
      const am = -Math.PI / 4 + (i + 0.5) * step;
      const vis = Math.cos(am - Math.PI / 4);
      if (vis > -0.35) faces.push({ i, am, vis });
    }
    faces.sort((a, b) => a.vis - b.vis);
    const at = (p: readonly [number, number, number], q: readonly [number, number, number], s: number): [number, number, number] => [
      p[0] + (q[0] - p[0]) * s,
      p[1] + (q[1] - p[1]) * s,
      p[2] + (q[2] - p[2]) * s,
    ];
    for (const f of faces) {
      const j = (f.i + 1) % sides;
      const a0 = lo[f.i]!;
      const a1 = hi[f.i]!;
      const b0 = lo[j]!;
      const b1 = hi[j]!;
      const lit = 0.735 + 0.06 * Math.sin(f.am - Math.PI / 4);
      for (let b = 0; b < bands; b += 1) {
        const s0 = b / bands;
        const s1 = (b + 1) / bands;
        k.poly([at(a0, a1, s0), at(b0, b1, s0), at(b0, b1, s1), at(a0, a1, s1)], shade(color, lit * (0.74 + (0.26 * (b + 0.5)) / bands)));
      }
    }
    const half = sides / 2;
    const sil: Array<readonly [number, number, number]> = [hi[half]!, lo[half]!];
    for (let i = half - 1; i >= 0; i -= 1) sil.push(lo[i]!);
    sil.push(hi[0]!);
    k.line(sil, k.t.ink, 1, 0.5);
  }
  k.poly(hi, k.plan ? color : shade(color, 0.875), 1, true);
  if (!k.plan) k.line([...hi, hi[0]!], shade(color, 1.35), 1, 0.42);
}

/** One bay of a shelf: spines stood along it, maybe a lying stack or an ornament. */
function homeBooks(k: PropKit, at: number, a0: number, a1: number, z0: number, z1: number, salt: number): void {
  const t = k.t;
  const tones = [
    shade(t.light, 0.8),
    shade(t.accent, 0.8),
    shade(t.base, 0.9),
    homeCap(shade(t.light, 0.98)),
    shade(t.dark, 0.85),
  ];
  const stack = k.rnd(salt + 1) < 0.35;
  const fill = 0.6 + k.rnd(salt + 2) * 0.4;
  const end = a0 + (a1 - a0) * fill - (stack ? 0.13 : 0);
  const zh = z1 - z0;
  let u = a0;
  let i = 0;
  while (u < end - 0.02 && i < 7) {
    const w = 0.038 + k.rnd(salt * 7 + i * 13 + 3) * 0.032;
    const top = z0 + zh * (0.6 + k.rnd(salt * 11 + i * 17 + 5) * 0.38);
    const tone = tones[Math.floor(k.rnd(salt * 5 + i * 19 + 7) * tones.length)]!;
    k.facePanel('u', at, u, z0, Math.min(u + w, end), top, tone);
    u += w + 0.005;
    i += 1;
  }
  if (!stack && u < a1 - 0.08 && k.rnd(salt + 3) < 0.6) {
    // The last book leans into the gap.
    const lh = zh * 0.7;
    k.poly([[u + 0.005, at, z0], [u + 0.045, at, z0], [u + 0.1, at, z0 + lh * 0.8], [u + 0.06, at, z0 + lh * 0.86]], tones[3]!);
  } else if (stack) {
    const n = 2 + Math.floor(k.rnd(salt + 4) * 2);
    for (let s = 0; s < n; s += 1) {
      const j = k.rnd(salt * 3 + s) * 0.02;
      k.facePanel('u', at, a1 - 0.125 + j, z0 + s * zh * 0.2, a1 - 0.012 - j, z0 + (s + 0.85) * zh * 0.2, tones[(s + salt) % tones.length]!);
    }
  }
}

/**
 * One leaf or frond, queued for a back-to-front sort: a spine that arches
 * (rising `up`, ending `tipDz` above its base) with edges either side.
 * `shape` 0 is a blade, 1 an obovate fig leaf broad toward the tip, 2 a palm
 * frond whose edge combs in and out as leaflets. Two-tone leaves are creased
 * down the midrib: the half turned to the key light is the leaf's own tone.
 */
function homeLeaf(k: PropKit, out: Array<{ d: number; draw: () => void }>, cu: number, cv: number, z: number, ang: number, len: number, wid: number, up: number, tipDz: number, color: number, shape: number, twoTone: boolean, ink: boolean): void {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const n = shape === 2 ? 10 : 5;
  const spine: Array<[number, number, number]> = [];
  const left: Array<[number, number, number]> = [];
  const right: Array<[number, number, number]> = [];
  for (let i = 0; i <= n; i += 1) {
    const s = i / n;
    const zz = z + 2 * up * s - (2 * up - tipDz) * s * s;
    const pu = cu + dx * len * s;
    const pv = cv + dy * len * s;
    spine.push([pu, pv, zz]);
    if (i === 0 || i === n) continue;
    const w = shape === 1 ? wid * Math.sin(Math.PI * Math.pow(s, 1.4)) : shape === 2 ? wid * Math.sin(Math.PI * s) * (i % 2 === 1 ? 1 : 0.3) : wid * Math.sin(Math.PI * s);
    left.push([pu - dy * w, pv + dx * w, zz]);
    right.push([pu + dy * w, pv - dx * w, zz]);
  }
  const tip = spine[n]!;
  const outline = [spine[0]!, ...left, tip, ...[...right].reverse()];
  const half = dx + dy > 0 ? left : right;
  const mid = spine[Math.floor(n / 2)]!;
  out.push({
    d: mid[0] + mid[1] + mid[2],
    draw: () => {
      k.poly(outline, twoTone ? shade(color, 0.84) : color, 1, ink);
      if (twoTone) k.poly([spine[0]!, ...half, tip, ...spine.slice(1, n).reverse()], color);
    },
  });
}

/**
 * A box turned `ang` radians about its centre — a carton left askew, a book
 * dropped on a bed. Only the faces turned toward the viewer are drawn.
 */
function homeSlab(k: PropKit, cu: number, cv: number, hw: number, hd: number, ang: number, z0: number, z1: number, color: number): void {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const corner = (a: number, b: number, z: number): [number, number, number] => [cu + a * hw * c - b * hd * s, cv + a * hw * s + b * hd * c, z];
  const ring: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  if (!k.plan) {
    ring.forEach(([a, b], i) => {
      const [a2, b2] = ring[(i + 1) % 4]!;
      const p = corner(a, b, z0);
      const q = corner(a2, b2, z0);
      const nx = q[1] - p[1];
      const ny = -(q[0] - p[0]);
      if (nx + ny <= 0) return;
      const lit = ny > nx ? 0.782 : 0.688;
      k.poly([p, q, corner(a2, b2, z1), corner(a, b, z1)], shade(color, lit * 0.9));
    });
  }
  k.poly(ring.map(([a, b]) => corner(a, b, z1)), k.plan ? color : shade(color, 0.875), 1, true);
}

/** Several polylines in one stroke — vines, cords — so a tangle costs one draw call, not one per strand. */
function homeStrands(k: PropKit, paths: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>>, color: number, width: number, alpha: number): void {
  let any = false;
  for (const path of paths) {
    if (path.length < 2) continue;
    const a = k.at(path[0]!);
    k.g.moveTo(a.x, a.y);
    for (let i = 1; i < path.length; i += 1) {
      const p = k.at(path[i]!);
      k.g.lineTo(p.x, p.y);
    }
    any = true;
  }
  if (any) k.g.stroke({ width, color, alpha });
}

/** The four ground corners of a (turned) rect, in the ring order `yardPrism` wants: NW, NE, SE, SW when unturned. */
function yardRect(cu: number, cv: number, hu: number, hv: number, rot = 0): [number, number][] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const corners: [number, number][] = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]];
  return corners.map(([a, b]) => [cu + a * c - b * s, cv + a * s + b * c]);
}

/** A ring of ground points round a centre, vertices on the diagonals so the silhouette corners land on vertices. */
function yardRing(k: PropKit, cu: number, cv: number, r: number, sides: number, jitter = 0, salt = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = -Math.PI / 4 + (i / sides) * Math.PI * 2;
    const rr = r * (1 - jitter * k.rnd(salt + i));
    out.push([cu + Math.cos(a) * rr, cv + Math.sin(a) * rr]);
  }
  return out;
}

/** The key-light multiplier of a vertical face on the ring edge a→b, or 0 when it faces away. */
function yardLit(a: readonly [number, number], b: readonly [number, number]): number {
  const nu = b[1] - a[1];
  const nv = a[0] - b[0];
  const len = Math.hypot(nu, nv) || 1;
  // South (0,1) lands on the wall's left shade 0.782, east (1,0) on its right shade 0.688.
  return (nu + nv) / len > 1e-6 ? 0.735 + (0.047 * (nv - nu)) / len : 0;
}

/**
 * A vertical prism over a convex ring: only the faces turned to the viewer,
 * each shaded by its own normal (so a turned crate or a drum shades as one),
 * then the top, then `deco` (face and top detail), then the ink silhouette and
 * the lit crown over everything. In plan: the top, inked, and `deco`.
 */
function yardPrism(k: PropKit, ring: readonly (readonly [number, number])[], z0: number, z1: number, color: number, opts: { bands?: number; top?: boolean; ink?: boolean; crown?: boolean } = {}, deco?: () => void): void {
  const n = ring.length;
  const top = ring.map(([u, v]): [number, number, number] => [u, v, z1]);
  if (k.plan || z1 <= z0) {
    if (opts.top !== false) k.poly(top, color, 1, opts.ink !== false);
    deco?.();
    return;
  }
  const bands = opts.bands ?? ((z1 - z0) * k.unit > 14 ? 2 : 1);
  const lits = ring.map((p, i) => yardLit(p, ring[(i + 1) % n]!));
  let start = -1;
  for (let i = 0; i < n; i += 1) {
    const lit = lits[i]!;
    if (lit === 0) continue;
    if (lits[(i + n - 1) % n] === 0) start = i;
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    for (let j = 0; j < bands; j += 1) {
      const lo = z0 + ((z1 - z0) * j) / bands;
      const hi = z0 + ((z1 - z0) * (j + 1)) / bands;
      k.poly([[a[0], a[1], lo], [b[0], b[1], lo], [b[0], b[1], hi], [a[0], a[1], hi]], shade(color, lit * (0.74 + (0.26 * (j + 0.5)) / bands)));
    }
  }
  if (opts.top !== false) k.poly(top, shade(color, 0.875));
  deco?.();
  if (opts.ink !== false && start >= 0) {
    const edge: [number, number, number][] = [[ring[start]![0], ring[start]![1], z1], [ring[start]![0], ring[start]![1], z0]];
    let i = start;
    while (lits[i] !== 0) {
      i = (i + 1) % n;
      edge.push([ring[i]![0], ring[i]![1], z0]);
    }
    edge.push([ring[i]![0], ring[i]![1], z1]);
    while (i !== start) {
      i = (i + 1) % n;
      edge.push([ring[i]![0], ring[i]![1], z1]);
    }
    k.line(edge, k.t.ink, 1, 0.5);
  }
  if (opts.crown !== false && opts.top !== false) k.line([...top, top[0]!], shade(color, 1.35), 1, 0.42);
}

/** A point on the ring edge i→i+1, fraction s along it, at height z. */
function yardOn(ring: readonly (readonly [number, number])[], i: number, s: number, z: number): [number, number, number] {
  const a = ring[i % ring.length]!;
  const b = ring[(i + 1) % ring.length]!;
  return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, z];
}

/** A rectangle standing on ring edge i, between fractions s0..s1 and heights z0..z1. Nothing in plan. */
function yardPanel(k: PropKit, ring: readonly (readonly [number, number])[], i: number, s0: number, s1: number, z0: number, z1: number, color: number, alpha = 1): void {
  if (k.plan) return;
  k.poly([yardOn(ring, i, s0, z0), yardOn(ring, i, s1, z0), yardOn(ring, i, s1, z1), yardOn(ring, i, s0, z1)], color, alpha);
}

/** A point on the top of a rect ring (from `yardRect`): a across its u side, b across its v side. */
function yardTop(ring: readonly (readonly [number, number])[], a: number, b: number, z: number): [number, number, number] {
  const c0 = ring[0]!;
  const c1 = ring[1]!;
  const c3 = ring[3]!;
  return [c0[0] + (c1[0] - c0[0]) * a + (c3[0] - c0[0]) * b, c0[1] + (c1[1] - c0[1]) * a + (c3[1] - c0[1]) * b, z];
}

/** One crate: a batten frame with the boards recessed inside it, a brace across each side, a planked lid. */
function yardCrate(k: PropKit, cu: number, cv: number, hu: number, hv: number, rot: number, z0: number, z1: number, color: number, salt: number, lid: 'shut' | 'strap' | 'open'): void {
  const t = k.t;
  const ring = yardRect(cu, cv, hu, hv, rot);
  const zb = Math.min(0.022, (z1 - z0) * 0.16);
  yardPrism(k, ring, z0, z1, color, {}, () => {
    if (!k.plan) {
      for (const i of [1, 2]) {
        const a = ring[i]!;
        const b = ring[(i + 1) % 4]!;
        const m = 0.032 / Math.hypot(b[0] - a[0], b[1] - a[1]);
        yardPanel(k, ring, i, m, 1 - m, z0 + zb, z1 - zb, C.ground, 0.17);
        const zm = z0 + (z1 - z0) * 0.5;
        k.line([yardOn(ring, i, m, zm), yardOn(ring, i, 1 - m, zm)], C.ground, 1, 0.16);
        if (i === 2 && z1 - z0 > 0.14 && k.rnd(salt * 29 + 1) < 0.45) {
          const s0 = 0.18 + k.rnd(salt * 31) * 0.3;
          yardPanel(k, ring, 2, s0, s0 + 0.3, z0 + (z1 - z0) * 0.58, z0 + (z1 - z0) * 0.82, t.light, 0.24);
        }
        const up = k.rnd(salt * 13 + i) < 0.5;
        k.line([yardOn(ring, i, m, up ? z0 + zb : z1 - zb), yardOn(ring, i, 1 - m, up ? z1 - zb : z0 + zb)], shade(color, yardLit(a, b) * 0.87), 2, 1);
      }
    }
    const ma = 0.03 / (2 * hu);
    const mb = 0.03 / (2 * hv);
    if (lid === 'open') {
      k.poly([yardTop(ring, ma, mb, z1), yardTop(ring, 1 - ma, mb, z1), yardTop(ring, 1 - ma, 1 - mb, z1), yardTop(ring, ma, 1 - mb, z1)], C.ground, 0.62);
      return;
    }
    k.poly([yardTop(ring, ma, mb, z1), yardTop(ring, 1 - ma, mb, z1), yardTop(ring, 1 - ma, 1 - mb, z1), yardTop(ring, ma, 1 - mb, z1)], C.ground, 0.1);
    const long = hu >= hv;
    for (const f of [1 / 3, 2 / 3]) {
      k.line(long ? [yardTop(ring, ma, f, z1), yardTop(ring, 1 - ma, f, z1)] : [yardTop(ring, f, mb, z1), yardTop(ring, f, 1 - mb, z1)], t.ink, 1, 0.38);
    }
    if (lid === 'strap') {
      const s = 0.3 + k.rnd(salt * 17) * 0.4;
      const path: [number, number, number][] = long
        ? [yardTop(ring, s, 0, z1), yardTop(ring, s, 1, z1), yardOn(ring, 2, 1 - s, z0 + (z1 - z0) * 0.02)]
        : [yardTop(ring, 0, s, z1), yardTop(ring, 1, s, z1), yardOn(ring, 1, s, z0 + (z1 - z0) * 0.02)];
      k.line(k.plan ? path.slice(0, 2) : path, t.dark, 2, 0.9);
    }
  });
  if (lid === 'open') {
    // The lid knocked askew across the open box, and the packing showing under it.
    k.poly([yardTop(ring, 0.2, 0.25, z1), yardTop(ring, 0.55, 0.15, z1), yardTop(ring, 0.7, 0.5, z1), yardTop(ring, 0.35, 0.75, z1), yardTop(ring, 0.15, 0.55, z1)], t.light, 0.35);
    const lr = rot + 0.35 + k.rnd(salt * 19) * 0.25;
    yardPrism(k, yardRect(cu + hu * 0.35, cv - hv * 0.12, hu * 0.92, hv * 0.9, lr), z1, z1 + 0.02, shade(color, 1.04), {}, () => {
      const lring = yardRect(cu + hu * 0.35, cv - hv * 0.12, hu * 0.92, hv * 0.9, lr);
      for (const f of [1 / 3, 2 / 3]) k.line([yardTop(lring, 0.04, f, z1 + 0.02), yardTop(lring, 0.96, f, z1 + 0.02)], t.ink, 1, 0.38);
    });
  }
}

/** A cylinder lying along u — a gas bottle: the upper-front half in three strips, the east end cap, its outline. */
function yardBottle(k: PropKit, u0: number, u1: number, v: number, z: number, r: number, color: number): void {
  if (k.plan) {
    k.poly([[u0, v - r, z], [u1, v - r, z], [u1, v + r, z], [u0, v + r, z]], color, 1, true);
    return;
  }
  const at = (u: number, a: number): [number, number, number] => [u, v + Math.cos(a) * r, z + Math.sin(a) * r];
  const d = Math.PI / 180;
  const strips: [number, number, number][] = [[-45, 15, 0.68], [15, 70, 0.8], [70, 135, 0.9]];
  for (const [a0, a1, f] of strips) k.poly([at(u0, a0 * d), at(u1, a0 * d), at(u1, a1 * d), at(u0, a1 * d)], shade(color, f));
  const cap: [number, number, number][] = [];
  for (let i = 0; i < 12; i += 1) cap.push(at(u1, (i / 12) * Math.PI * 2));
  k.poly(cap, shade(color, 0.72));
  const outline: [number, number, number][] = [at(u0, 135 * d), at(u1, 135 * d)];
  for (let a = 180; a <= 315; a += 30) outline.push(at(u1, a * d));
  outline.push(at(u1, 315 * d), at(u0, 315 * d));
  for (let a = 0; a <= 135; a += 30) outline.push(at(u0, a * d));
  outline.push(at(u0, 135 * d));
  k.line(outline, k.t.ink, 1, 0.55);
  k.line([at(u0 + (u1 - u0) * 0.1, 135 * d), at(u1 - 0.01, 135 * d)], shade(color, 1.35), 1, 0.45);
}

/** The key light's lambert on a face with outward normal (nu, nv, nz): FACE_SHADE at the three axes. */
function plantLit(nu: number, nv: number, nz: number): number {
  return 0.502 + 0.502 * Math.max(0, 0.371 * nu + 0.558 * nv + 0.743 * nz);
}

/** A horizontal ring of `n` points, the first at angle `a0`. */
function plantRing(cu: number, cv: number, r: number, z: number, n: number, a0 = -Math.PI / 4): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    const a = a0 + (i / n) * Math.PI * 2;
    pts.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, z]);
  }
  return pts;
}

/** A horizontal arc from angle `a0` to `a1`, `steps` segments. */
function plantArc(cu: number, cv: number, r: number, z: number, a0: number, a1: number, steps: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, z]);
  }
  return pts;
}

/**
 * A turned solid — drum, frustum or dome ring — from radius r0 at z0 to r1 at
 * z1. Only the near half is drawn, each facet lit by its own normal, so a
 * curve reads as a curve for half the fills of a sorted prism.
 */
function plantTurn(k: PropKit, cu: number, cv: number, r0: number, r1: number, z0: number, z1: number, color: number, o: { n?: number; cap?: boolean; ink?: boolean; under?: boolean; foot?: boolean; crown?: boolean } = {}): void {
  const n = o.n ?? 12;
  const q = -Math.PI / 4;
  const tapered = r0 > r1 + 1e-6;
  if (k.plan) {
    if (tapered) k.poly(plantRing(cu, cv, r0, z0, n, q), shade(color, 0.86), 1, o.ink ?? true);
    if (o.cap ?? true) k.poly(plantRing(cu, cv, r1, z1, n, q), color, 1, !tapered && (o.ink ?? true));
    return;
  }
  const tilt = Math.atan2(r0 - r1, z1 - z0);
  const ch = Math.cos(tilt);
  const sz = Math.sin(tilt);
  if (o.under) k.poly(plantRing(cu, cv, r0, z0, n, q), shade(color, Math.max(0.7, plantLit(-0.707 * ch, -0.707 * ch, sz))), 1);
  const step = (Math.PI * 2) / n;
  for (let i = 0; i < n / 2; i += 1) {
    const a = q + i * step;
    const b = a + step;
    const m = a + step / 2;
    k.poly(
      [
        [cu + Math.cos(a) * r0, cv + Math.sin(a) * r0, z0],
        [cu + Math.cos(b) * r0, cv + Math.sin(b) * r0, z0],
        [cu + Math.cos(b) * r1, cv + Math.sin(b) * r1, z1],
        [cu + Math.cos(a) * r1, cv + Math.sin(a) * r1, z1],
      ],
      shade(color, plantLit(Math.cos(m) * ch, Math.sin(m) * ch, sz)),
    );
  }
  if (o.foot) {
    const lo = plantArc(cu, cv, r0, z0, q + Math.PI, q, n / 2);
    for (const [f, al] of [[2 / 3, 0.09], [1 / 3, 0.12]] as const) {
      k.poly([...lo, ...plantArc(cu, cv, r0 + (r1 - r0) * f, z0 + (z1 - z0) * f, q, q + Math.PI, n / 2)], shade(color, 0.2), al);
    }
  }
  if (o.cap ?? true) k.poly(plantRing(cu, cv, r1, z1, n, q), shade(color, 0.875), 1);
  if (o.ink ?? true) {
    const flat = tilt > 0.95;
    const path = [...plantArc(cu, cv, r0, z0, q + Math.PI, q, n / 2), ...plantArc(cu, cv, flat ? r0 : r1, flat ? z0 : z1, q, q - Math.PI, n / 2)];
    path.push(path[0]!);
    k.line(path, k.t.ink, 1, 0.5);
  }
  if (o.crown) k.line(plantArc(cu, cv, r1, z1, q + Math.PI, q, n / 2), shade(color, 1.3), 1, 0.4);
}

/** A short drum as two rings: the side shows as the crescent between them. */
function plantSlab(k: PropKit, cu: number, cv: number, r: number, z0: number, z1: number, color: number, n = 12, a0 = -Math.PI / 4): void {
  if (!k.plan) k.poly(plantRing(cu, cv, r, z0, n, a0), shade(color, 0.72), 1, true);
  k.poly(plantRing(cu, cv, r, z1, n, a0), k.plan ? color : shade(color, 0.875), 1, true);
}

/**
 * A horizontal pipe along `axis` from a0 to a1, centred on the other ground
 * axis at `c` and height `z`. The near end (east for 'u', south for 'v') is capped.
 */
function plantPipe(k: PropKit, axis: 'u' | 'v', a0: number, a1: number, c: number, z: number, r: number, rz: number, color: number, o: { facets?: number; cap?: number | null; ink?: boolean } = {}): void {
  const P = (a: number, th: number): [number, number, number] =>
    axis === 'u' ? [a, c + Math.cos(th) * r, z + Math.sin(th) * rz] : [c + Math.cos(th) * r, a, z + Math.sin(th) * rz];
  if (k.plan) {
    k.poly([P(a0, 0), P(a1, 0), P(a1, Math.PI), P(a0, Math.PI)], o.cap ?? color, 1, true);
    return;
  }
  const facets = o.facets ?? 4;
  const span = Math.PI / facets;
  for (let i = 0; i < facets; i += 1) {
    const t0 = -Math.PI / 4 + i * span;
    const m = t0 + span / 2;
    const f = axis === 'u' ? plantLit(0, Math.cos(m), Math.sin(m)) : plantLit(Math.cos(m), 0, Math.sin(m));
    k.poly([P(a0, t0), P(a1, t0), P(a1, t0 + span), P(a0, t0 + span)], shade(color, f));
  }
  if (o.cap !== null) {
    const cap: [number, number, number][] = [];
    for (let i = 0; i < 8; i += 1) cap.push(P(a1, -Math.PI / 4 + (i * Math.PI) / 4));
    k.poly(cap, shade(o.cap ?? color, axis === 'u' ? 0.688 : 0.782), 1, o.ink ?? true);
  }
  if (o.ink ?? true) k.line([P(a1, (3 * Math.PI) / 4), P(a0, (3 * Math.PI) / 4), P(a0, -Math.PI / 4), P(a1, -Math.PI / 4)], k.t.ink, 1, 0.5);
}

/** Cell units along a face per cell of height, so a circle on the face reads round. */
function plantFaceK(k: PropKit, along: 'u' | 'v'): number {
  if (k.plan) return 1;
  const a = k.at([0, 0, 0]);
  const b = along === 'u' ? k.at([1, 0, 0]) : k.at([0, 1, 0]);
  return k.unit / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
}

/** A ring standing on the south ('u') or east ('v') plane through `at`. */
function plantFaceRing(k: PropKit, along: 'u' | 'v', at: number, ca: number, cz: number, r: number, n: number, phase = 0, kk = plantFaceK(k, along)): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    const a = phase + (i / n) * Math.PI * 2;
    const d = Math.cos(a) * r * kk;
    pts.push(along === 'u' ? [ca + d, at, cz + Math.sin(a) * r] : [at, ca + d, cz + Math.sin(a) * r]);
  }
  return pts;
}

/** A point on (or standing off) a vertical cylinder: angle `a`, tangential offset `s`. */
function plantShell(cu: number, cv: number, r: number, a: number, s: number, z: number): [number, number, number] {
  return [cu + Math.cos(a) * r - Math.sin(a) * s, cv + Math.sin(a) * r + Math.cos(a) * s, z];
}

function streetLit(nu: number, nv: number, nz: number): number {
  // The renderer's key light as a lambert over a face normal: top 0.875,
  // south 0.782, east 0.688, standing faces taken at their mid-band foot shade.
  const len = Math.hypot(nu, nv, nz) || 1;
  const l = Math.max(0, (nu * 0.37 + nv * 0.558 + nz * 0.743) / len);
  return (0.502 + 0.502 * l) * (0.87 + 0.13 * Math.abs(nz / len));
}

function streetArc(k: PropKit, u: number, v: number, z: number, r: number, along: 'u' | 'v', a0: number, a1: number, n: number): Array<[number, number, number]> {
  // Points of a circle standing on the south ('u') or east ('v') face, as faceCircle builds it.
  const o = k.at([0, 0, 0]);
  const e = along === 'u' ? k.at([1, 0, 0]) : k.at([0, 1, 0]);
  const kk = k.unit / (Math.hypot(e.x - o.x, e.y - o.y) || 1);
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    const d = Math.cos(a) * r * kk;
    pts.push(along === 'u' ? [u + d, v, z + Math.sin(a) * r] : [u, v + d, z + Math.sin(a) * r]);
  }
  return pts;
}

function streetWheel(k: PropKit, u: number, v: number, r: number, arch: number | null): void {
  // A wheel on the south face: the dark arch it sits in, tyre, rim, hub.
  if (k.plan) return;
  const t = k.t;
  if (arch !== null) k.poly(streetArc(k, u, v - 0.002, r, r * 1.24, 'u', 0, Math.PI, 8), arch);
  k.faceCircle(u, v, r, r, 'u', t.ink, 1);
  k.faceCircle(u, v, r, r * 0.6, 'u', shade(t.light, 0.92), 0.85);
  k.faceCircle(u, v, r, r * 0.24, 'u', t.dark, 1);
}

function streetMirror(prof: ReadonlyArray<readonly [number, number]>, flip: boolean): Array<[number, number]> {
  // A hull profile turned end for end, still wound rear-top, over the top, nose, bottom.
  const n = prof.length;
  if (!flip) return prof.map(([u, z]): [number, number] => [u, z]);
  const top = prof.slice(0, n - 2).map(([u, z]): [number, number] => [1 - u, z]).reverse();
  return [...top, [1 - prof[n - 1]![0], prof[n - 1]![1]], [1 - prof[n - 2]![0], prof[n - 2]![1]]];
}

function streetHull(k: PropKit, prof: ReadonlyArray<readonly [number, number]>, v0: number, v1: number, color: number): void {
  // A body extruded across v from a side profile: rear-top first, over the top
  // to the nose, down it, and back along the bottom. Draws the strips that face
  // the viewer back to front, then the south profile, then crown and ink.
  const t = k.t;
  const n = prof.length;
  for (let i = 0; i < n - 1; i += 1) {
    const [ua, za] = prof[i]!;
    const [ub, zb] = prof[i + 1]!;
    const nu = -(zb - za);
    const nz = ub - ua;
    if (nu + 0.816 * nz <= 0.001) continue;
    if (k.plan && nz <= 0.001) continue;
    k.poly([[ua, v0, za], [ub, v0, zb], [ub, v1, zb], [ua, v1, za]], k.plan ? color : shade(color, streetLit(nu, 0, nz)));
  }
  if (!k.plan) {
    k.poly(prof.map(([u, z]): [number, number, number] => [u, v1, z]), shade(color, 0.68));
    k.line(prof.slice(0, n - 2).map(([u, z]): [number, number, number] => [u, v1, z]), shade(color, 1.35), 1, 0.42);
  }
  const sil: Array<[number, number, number]> = prof.slice(0, n - 1).map(([u, z]): [number, number, number] => [u, v0, z]);
  sil.push([prof[n - 2]![0], v1, prof[n - 2]![1]], [prof[n - 1]![0], v1, prof[n - 1]![1]], [prof[0]![0], v1, prof[0]![1]], [prof[0]![0], v0, prof[0]![1]]);
  k.line(sil, t.ink, 1, 0.5);
}

function streetOBox(k: PropKit, cu: number, cv: number, hw: number, hd: number, ang: number, z0: number, z1: number, color: number): void {
  // A box turned in the cell: the faces that look toward the viewer, a lid, ink and crown.
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const corner = (x: number, y: number): [number, number] => [cu + x * c - y * s, cv + x * s + y * c];
  const q = [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
  if (!k.plan) {
    const faces: Array<{ a: [number, number]; b: [number, number]; nu: number; nv: number; d: number }> = [];
    for (let i = 0; i < 4; i += 1) {
      const a = q[i]!;
      const b = q[(i + 1) % 4]!;
      const nu = b[1] - a[1];
      const nv = -(b[0] - a[0]);
      if (nu + nv <= 0) continue;
      faces.push({ a, b, nu, nv, d: a[0] + a[1] + b[0] + b[1] });
    }
    faces.sort((x, y) => x.d - y.d);
    for (const f of faces) {
      k.poly([[f.a[0], f.a[1], z0], [f.b[0], f.b[1], z0], [f.b[0], f.b[1], z1], [f.a[0], f.a[1], z1]], shade(color, streetLit(f.nu, f.nv, 0)));
    }
  }
  const top = q.map(([u, v]): [number, number, number] => [u, v, z1]);
  k.poly(top, k.plan ? color : shade(color, 0.875), 1, true);
  if (!k.plan) k.line([...top, top[0]!], shade(color, 1.35), 1, 0.42);
}

function streetSack(k: PropKit, cu: number, cv: number, r: number, zt: number, z0: number, color: number, salt: number): void {
  // A tied refuse sack, soft, so drawn on the plane that faces the viewer: a
  // bottom-heavy body with a shadowed rim, the lit belly, a crease pulled from
  // the tie, a plastic sheen, and the twisted neck with its floppy ends. `r` is
  // half its width in screen cells-of-height, so width and height share a unit.
  const t = k.t;
  const lean = (k.rnd(salt * 7 + 3) - 0.5) * 0.6 * r;
  if (k.plan) {
    k.disc(cu, cv, r * 0.5, 0, shade(color, 0.8), 1, true);
    k.disc(cu - r * 0.1, cv - r * 0.1, r * 0.3, 0, color, 1);
    k.disc(cu + lean * 0.5, cv - lean * 0.5, r * 0.1, 0, shade(color, 0.55), 1);
    return;
  }
  const P = (x: number, z: number): [number, number, number] => [cu + x * 0.5, cv - x * 0.5, z0 + Math.max(0, z)];
  const W = [0.8, 1.0, 1.02, 0.86, 0.46, 0.17];
  const Z = [0, 0.2, 0.42, 0.66, 0.83, 0.91];
  const zc = zt * 0.45;
  const shape = (s: number, ox: number, oz: number): Array<[number, number, number]> => {
    const pts: Array<[number, number, number]> = [];
    for (let n = 0; n < 12; n += 1) {
      const i = n < 6 ? n : 11 - n;
      const j = 1 + (k.rnd(salt * 13 + n) - 0.5) * 0.22;
      const x = (n < 6 ? 1 : -1) * W[i]! * r * j + lean * Z[i]! * Z[i]!;
      pts.push(P(ox + x * s, oz + zc + (Z[i]! * zt - zc) * s));
    }
    return pts;
  };
  k.poly(shape(1, 0, 0), shade(color, 0.62), 1, true);
  k.poly(shape(0.8, -r * 0.1, zt * 0.04), shade(color, 0.84));
  const nx = lean * 0.83;
  k.line([P(nx + r * 0.04, zt * 0.82), P(r * 0.24, zt * 0.56), P(r * 0.14, zt * 0.3)], shade(color, 0.48), 1, 0.55);
  k.line([P(-r * 0.74, zt * 0.3), P(-r * 0.64, zt * 0.52), P(-r * 0.38, zt * 0.68)], shade(t.light, 1.1), 1.5, 0.55);
  k.poly([P(nx - r * 0.12, zt * 0.88), P(nx - r * 0.44, zt * 0.9), P(nx - r * 0.5, zt * 1.0), P(nx - r * 0.08, zt * 0.99), P(nx + r * 0.1, zt * 1.12), P(nx + r * 0.38, zt * 1.06), P(nx + r * 0.14, zt * 0.88)], shade(color, 0.72), 1, true);
}

/** A horizontal ring of `n` points, starting at angle `rot`. */
function squatRing(cu: number, cv: number, r: number, z: number, n: number, rot: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, z]);
  }
  return out;
}

/** A lumpy horizontal ring — a mound's contour, a scorch, a pile of coals. Same salt, same lumps. */
function squatBlob(k: PropKit, cu: number, cv: number, ru: number, rv: number, z: number, n: number, jit: number, salt: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + salt * 0.7;
    const j = 1 - jit * k.rnd(salt * 53 + i * 11 + 7);
    out.push([cu + Math.cos(a) * ru * j, cv + Math.sin(a) * rv * j, z]);
  }
  return out;
}

/** Points along an arc of a horizontal circle. */
function squatArc(cu: number, cv: number, r: number, z: number, a0: number, a1: number, steps: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, z]);
  }
  return out;
}

/** A point on the surface of an upright cylinder. */
function squatOn(cu: number, cv: number, r: number, a: number, z: number): [number, number, number] {
  return [cu + Math.cos(a) * r, cv + Math.sin(a) * r, z];
}

/** Blend two colours. */
function squatMix(a: number, b: number, f: number): number {
  const ch = (s: number): number => Math.round(((a >> s) & 0xff) * (1 - f) + ((b >> s) & 0xff) * f);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * A solid between two rings of matching points: a prism, a frustum, a mound.
 * Only the faces turned to the viewer are painted, each lit by where it faces
 * (the key light's left/right split, leaning to the top shade as the face
 * lies back), then the top and one ink silhouette. flags: 1 no top, 2 crown,
 * 4 no ink, 8 darken the foot.
 */
function squatPrism(k: PropKit, lo: Array<[number, number, number]>, hi: Array<[number, number, number]>, color: number, flags: number): void {
  const n = lo.length;
  let cu = 0;
  let cv = 0;
  let hu0 = 0;
  let hv0 = 0;
  for (let i = 0; i < n; i += 1) {
    cu += lo[i]![0] / n;
    cv += lo[i]![1] / n;
    hu0 += hi[i]![0] / n;
    hv0 += hi[i]![1] / n;
  }
  if (k.plan) {
    let rl = 0;
    let rh = 0;
    for (let i = 0; i < n; i += 1) {
      rl += Math.hypot(lo[i]![0] - cu, lo[i]![1] - cv) / n;
      rh += Math.hypot(hi[i]![0] - hu0, hi[i]![1] - hv0) / n;
    }
    if (rl > rh + 0.015) {
      k.poly(lo, shade(color, 0.9), 1, (flags & 4) === 0);
      if ((flags & 1) === 0) k.poly(hi, color, 1, false);
    } else {
      k.poly(hi, color, 1, (flags & 4) === 0);
    }
    return;
  }
  const vis: boolean[] = [];
  const faces: Array<{ i: number; d: number; lit: number }> = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const p = lo[i]!;
    const q = lo[j]!;
    const mu = (p[0] + q[0]) / 2;
    const mv = (p[1] + q[1]) / 2;
    let nu = q[1] - p[1];
    let nv = p[0] - q[0];
    if (nu * (mu - cu) + nv * (mv - cv) < 0) {
      nu = -nu;
      nv = -nv;
    }
    const on = nu + nv > 1e-9;
    vis.push(on);
    if (!on) continue;
    const len = Math.hypot(nu, nv) || 1;
    const hu = (hi[i]![0] + hi[j]![0]) / 2;
    const hv = (hi[i]![1] + hi[j]![1]) / 2;
    const out = ((hu - mu) * nu + (hv - mv) * nv) / len;
    const rise = Math.abs((hi[i]![2] + hi[j]![2] - p[2] - q[2]) / 2) + 1e-6;
    const tilt = Math.min(0.85, Math.abs(out) / (Math.abs(out) + rise));
    const side = 0.735 + 0.066 * Math.sin(Math.atan2(nv, nu) - Math.PI / 4);
    const lit = out < 0 ? side + (0.875 - side) * tilt : side - (side - 0.5) * tilt;
    faces.push({ i, d: mu + mv, lit });
  }
  faces.sort((a, b) => a.d - b.d);
  for (const f of faces) {
    const j = (f.i + 1) % n;
    k.poly([lo[f.i]!, lo[j]!, hi[j]!, hi[f.i]!], shade(color, f.lit * 0.9));
  }
  let s = -1;
  for (let i = 0; i < n; i += 1) {
    if (vis[i] && !vis[(i + n - 1) % n]) {
      s = i;
      break;
    }
  }
  const front: Array<[number, number, number]> = [];
  let e1 = 0;
  if (s >= 0) {
    let e = s;
    while (vis[(e + 1) % n] && (e + 1) % n !== s) e = (e + 1) % n;
    e1 = (e + 1) % n;
    for (let i = s; ; i = (i + 1) % n) {
      front.push(lo[i]!);
      if (i === e1) break;
    }
    if ((flags & 8) !== 0) {
      const mid = front.map((p, idx): [number, number, number] => {
        const src = hi[(s + idx) % n]!;
        return [p[0] + (src[0] - p[0]) * 0.4, p[1] + (src[1] - p[1]) * 0.4, p[2] + (src[2] - p[2]) * 0.4];
      });
      k.poly([...front, ...mid.reverse()], k.t.ink, 0.24);
    }
  }
  if ((flags & 1) === 0) k.poly(hi, shade(color, 0.875));
  if ((flags & 4) === 0 && s >= 0) {
    const back: Array<[number, number, number]> = [];
    for (let i = e1; ; i = (i + 1) % n) {
      back.push(hi[i]!);
      if (i === s) break;
    }
    k.line([...back, ...front, hi[e1]!], k.t.ink, 1, 0.5);
  }
  if ((flags & 2) !== 0) k.line([...hi, hi[0]!], shade(color, 1.35), 1, 0.42);
}

/** A round solid on the cell: a drum, a tyre, a lamp foot. Returns its top ring. */
function squatSolid(k: PropKit, cu: number, cv: number, r0: number, r1: number, z0: number, z1: number, color: number, n: number, flags: number): Array<[number, number, number]> {
  const lo = squatRing(cu, cv, r0, z0, n, Math.PI / n);
  const hi = squatRing(cu, cv, r1, z1, n, Math.PI / n);
  squatPrism(k, lo, hi, color, flags);
  return hi;
}

/** The mouth of something hollow: the dark inside, and the far inner wall catching the light. */
function squatHole(k: PropKit, cu: number, cv: number, r: number, z: number, depth: number, dark: number, wall: number): void {
  k.poly(squatRing(cu, cv, r, z, 14, 0), dark);
  if (k.plan) return;
  const rim = squatArc(cu, cv, r, z, Math.PI * 0.75, Math.PI * 1.75, 8);
  const low: Array<[number, number, number]> = [];
  for (let i = 8; i >= 0; i -= 1) {
    const a = Math.PI * 0.75 + (Math.PI * i) / 8;
    low.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, z - depth * Math.sin((Math.PI * i) / 8)]);
  }
  k.poly([...rim, ...low], wall);
}

/** A slatted wooden crate: frame battens, a diagonal brace, plank gaps on the lid. */
function squatCrate(k: PropKit, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, wood: number, salt: number): void {
  k.box(u0, v0, u1, v1, z0, z1, wood);
  if (!k.plan) {
    const south = shade(wood, 0.6);
    const east = shade(wood, 0.53);
    k.facePanel('u', v1 + 0.001, u0, z0, u0 + 0.045, z1, south);
    k.facePanel('u', v1 + 0.001, u1 - 0.045, z0, u1, z1, south);
    k.facePanel('v', u1 + 0.001, v0, z0, v0 + 0.045, z1, east);
    const up = k.rnd(salt * 7 + 1) < 0.5;
    k.line([[u0 + 0.045, v1 + 0.002, up ? z0 + 0.01 : z1 - 0.01], [u1 - 0.045, v1 + 0.002, up ? z1 - 0.01 : z0 + 0.01]], south, 2, 0.95);
    k.line([[u1 + 0.002, v0 + 0.045, (z0 + z1) / 2], [u1 + 0.002, v1, (z0 + z1) / 2]], shade(wood, 0.42), 1, 0.6);
    if (k.rnd(salt * 7 + 2) < 0.6) {
      k.facePanel('v', u1 + 0.002, v0 + 0.12, z0 + (z1 - z0) * 0.25, v1 - 0.1, z0 + (z1 - z0) * 0.42, shade(wood, 0.8), 0.55);
    }
  }
  for (const f of [0.36, 0.66]) {
    const v = v0 + (v1 - v0) * f;
    k.line([[u0 + 0.01, v, z1 + 0.001], [u1 - 0.01, v, z1 + 0.001]], shade(wood, 0.62), 1, 0.55);
  }
}

/**
 * A broken block lying on a slope: a tilted top, and the two edges turned to
 * the viewer showing its thickness. `fall` is the downhill direction, `drop`
 * how far the top tips that way.
 */
function squatChunk(k: PropKit, u: number, v: number, z: number, a: number, b: number, rot: number, fall: number, drop: number, th: number, color: number): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const fu = Math.cos(fall);
  const fv = Math.sin(fall);
  const top: Array<[number, number, number]> = [[-a, -b], [a, -b], [a, b], [-a, b]].map(([x, y]): [number, number, number] => {
    const du = x! * c - y! * s;
    const dv = x! * s + y! * c;
    return [u + du, v + dv, z - (drop * (du * fu + dv * fv)) / Math.max(a, b)];
  });
  if (!k.plan) {
    for (let i = 0; i < 4; i += 1) {
      const p = top[i]!;
      const q = top[(i + 1) % 4]!;
      const mu = (p[0] + q[0]) / 2 - u;
      const mv = (p[1] + q[1]) / 2 - v;
      if (mu + mv <= 0) continue;
      k.poly([p, q, [q[0], q[1], q[2] - th], [p[0], p[1], p[2] - th]], shade(color, mv > mu ? 0.7 : 0.6));
    }
  }
  k.poly(top, k.plan ? color : shade(color, 0.96), 1, true);
}

function greenMix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function greenPuff(k: PropKit, u: number, v: number, z: number, r: number, color: number, salt: number, ink = false, alpha = 1): void {
  // A lobe of foliage: a round clump that reads as a ball in isometric (a
  // screen circle) and as a disc from above.
  const n = 12;
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + salt * 0.7;
    const rr = r * (1 - 0.14 * k.rnd(300 + salt * 13 + i));
    if (k.plan) pts.push([u + Math.cos(a) * rr, v + Math.sin(a) * rr, z]);
    else pts.push([u + Math.cos(a) * rr * 0.707, v - Math.cos(a) * rr * 0.707, z + Math.sin(a) * rr * 1.414]);
  }
  k.poly(pts, color, alpha, ink);
}

function greenLobe(k: PropKit, u: number, v: number, z: number, r: number, color: number, salt: number, ink: boolean, cap: number | null): void {
  // A clump and, in isometric, its lit cap: the key light catches the upper
  // left of every clump, which is what makes a crown a mass of clumps rather
  // than a pile of discs.
  greenPuff(k, u, v, z, r, color, salt, ink);
  if (cap === null || k.plan) return;
  const d = r * 0.24;
  greenPuff(k, u - d * 0.707, v + d * 0.707, z + d * 1.414, r * 0.58, cap, salt + 5);
}

function greenRing(k: PropKit, cu: number, cv: number, n: number, rad: number, z: number, r: number, color: number, rot: number, salt: number, ink: boolean, cap: number | null = null): void {
  // A ring of lobes, painted back to front.
  const list: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const a = rot + (i / n) * Math.PI * 2;
    list.push([cu + Math.cos(a) * rad, cv + Math.sin(a) * rad, i]);
  }
  list.sort((p, q) => p[0] + p[1] - (q[0] + q[1]));
  for (const [u, v, i] of list) greenLobe(k, u, v, z, r * (0.9 + 0.2 * k.rnd(salt + i)), color, salt + i * 3, ink, cap);
}

function greenOval(k: PropKit, cu: number, cv: number, ru: number, rv: number, z: number, color: number, alpha: number): void {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    pts.push([cu + Math.cos(a) * ru, cv + Math.sin(a) * rv, z]);
  }
  k.poly(pts, color, alpha);
}

function greenScallop(k: PropKit, salt: number, n: number): Array<[number, number]> {
  // A clipped edge as a run of lobes across the cell: [position 0..1, swell
  // 0..1]. Both ends swell to nothing, so a run of cells meets without a step.
  const out: Array<[number, number]> = [];
  let a = 0;
  for (let j = 0; j < n; j += 1) {
    const b = j === n - 1 ? 1 : (j + 1 + (k.rnd(salt + j) - 0.5) * 0.6) / n;
    const amp = 0.5 + 0.5 * k.rnd(salt + 20 + j);
    for (let q = 0; q < 4; q += 1) out.push([a + ((b - a) * q) / 4, amp * Math.sin((q / 4) * Math.PI)]);
    a = b;
  }
  out.push([1, 0]);
  return out;
}

function greenDrum(k: PropKit, cu: number, cv: number, r0: number, r1: number, z0: number, z1: number, color: number, sides: number, top: number | null, ink: boolean): void {
  // A round solid (or a frustum) with only its near faces painted, shaded
  // across the curve, an ink silhouette and a lit crown on the near rim.
  const ang = (i: number) => (i / sides) * Math.PI * 2 + Math.PI / sides;
  const ring = (r: number, z: number, a: number): [number, number, number] => [cu + Math.cos(a) * r, cv + Math.sin(a) * r, z];
  if (!k.plan && z1 > z0) {
    for (let i = 0; i < sides; i += 1) {
      const am = (ang(i) + ang(i + 1)) / 2;
      const nu = Math.cos(am);
      const nv = Math.sin(am);
      if (nu + nv <= 0.01) continue;
      const tt = Math.max(0, Math.min(1, (nv - nu) / 2 + 0.5));
      k.poly([ring(r0, z0, ang(i)), ring(r0, z0, ang(i + 1)), ring(r1, z1, ang(i + 1)), ring(r1, z1, ang(i))], shade(color, 0.62 + 0.2 * tt));
    }
  }
  if (top !== null) {
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i < sides; i += 1) pts.push(ring(r1, z1, ang(i)));
    k.poly(pts, k.plan ? top : shade(top, 0.875), 1, ink);
  }
  if (!k.plan && z1 > z0) {
    const front: Array<[number, number, number]> = [ring(r1, z1, Math.PI * 0.75)];
    for (let i = 0; i <= 4; i += 1) front.push(ring(r0, z0, Math.PI * 0.75 - (i / 4) * Math.PI));
    front.push(ring(r1, z1, -Math.PI * 0.25));
    if (ink) k.line(front, k.t.ink, 1, 0.5);
    if (top !== null) {
      const crown: Array<[number, number, number]> = [];
      for (let i = 0; i <= 6; i += 1) crown.push(ring(r1, z1, Math.PI * 0.75 - (i / 6) * Math.PI));
      k.line(crown, shade(top, 1.35), 1, 0.42);
    }
  }
}

function greenSheet(k: PropKit, rTop: number, zTop: number, rFoot: number, zFoot: number, color: number, alpha: number): void {
  // Water sheeting off a bowl's near rim, streaked where it runs thickest.
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= 6; i += 1) {
    const a = Math.PI * 0.75 - (i / 6) * Math.PI;
    pts.push([0.5 + Math.cos(a) * rTop, 0.5 + Math.sin(a) * rTop, zTop]);
  }
  for (let i = 6; i >= 0; i -= 1) {
    const a = Math.PI * 0.75 - (i / 6) * Math.PI;
    pts.push([0.5 + Math.cos(a) * rFoot, 0.5 + Math.sin(a) * rFoot, zFoot]);
  }
  k.poly(pts, color, alpha);
  for (const a of [0.55, 0.25, -0.05]) {
    const c = Math.cos(a * Math.PI);
    const s = Math.sin(a * Math.PI);
    k.line([[0.5 + c * rTop, 0.5 + s * rTop, zTop - 0.01], [0.5 + c * rFoot, 0.5 + s * rFoot, zFoot + 0.02]], color, 1, alpha * 2);
  }
}

function greenBill(k: PropKit, cu: number, cv: number, pts: ReadonlyArray<readonly [number, number]>, color: number, alpha = 1, ink = false): void {
  // A shape standing square to the viewer: `a` runs across the screen (one
  // unit is half a cell's width), `z` up. Isometric only.
  k.poly(pts.map(([a, z]): [number, number, number] => [cu + a * 0.5, cv - a * 0.5, z]), color, alpha, ink);
}

function greenBillLine(k: PropKit, cu: number, cv: number, pts: ReadonlyArray<readonly [number, number]>, color: number, width: number, alpha = 1): void {
  k.line(pts.map(([a, z]): [number, number, number] => [cu + a * 0.5, cv - a * 0.5, z]), color, width, alpha);
}

function civicMix(a: number, b: number, f: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function civicArea(k: PropKit, pts: readonly (readonly [number, number, number])[]): number {
  const w = k.pts(pts);
  let a = 0;
  for (let i = 0; i < w.length; i += 1) {
    const p = w[i]!;
    const q = w[(i + 1) % w.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function civicLit(k: PropKit, pts: readonly (readonly [number, number, number])[], flip: boolean): number {
  // Newell normal, lit by the same key light FACE_SHADE is derived from.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const s = flip ? -1 : 1;
  const len = Math.hypot(nx, ny, nz) || 1;
  const d = (s * (nx * 0.371 + ny * 0.557 + nz * 0.743)) / len;
  const f = 0.502 + 0.502 * Math.max(0, d);
  return k.plan ? f / 0.875 : f;
}

function civicFacet(k: PropKit, pts: readonly (readonly [number, number, number])[], color: number, alpha = 1, twoSided = false): boolean {
  const a = civicArea(k, pts);
  if (Math.abs(a) < 0.3 || (a < 0 && !twoSided)) return false;
  k.poly(pts, shade(color, civicLit(k, pts, a < 0)), alpha);
  return true;
}

function civicSegs(k: PropKit, segs: readonly (readonly (readonly [number, number, number])[])[], color: number, width: number, alpha: number): void {
  let any = false;
  for (const s of segs) {
    if (s.length < 2) continue;
    const w = k.pts(s);
    let len = 0;
    for (let i = 1; i < w.length; i += 1) len += Math.hypot(w[i]!.x - w[i - 1]!.x, w[i]!.y - w[i - 1]!.y);
    if (len < 0.6) continue;
    k.g.moveTo(w[0]!.x, w[0]!.y);
    for (let i = 1; i < w.length; i += 1) k.g.lineTo(w[i]!.x, w[i]!.y);
    any = true;
  }
  if (any) k.g.stroke({ width, color, alpha, ...(width <= 1 ? { pixelLine: true } : {}) });
}

function civicPolys(k: PropKit, list: readonly (readonly (readonly [number, number, number])[])[], color: number, alpha: number): void {
  // Several small shapes of one tone, one fill.
  let any = false;
  for (const pts of list) {
    if (pts.length < 3) continue;
    const w = k.pts(pts);
    k.g.moveTo(w[0]!.x, w[0]!.y);
    for (let i = 1; i < w.length; i += 1) k.g.lineTo(w[i]!.x, w[i]!.y);
    k.g.closePath();
    any = true;
  }
  if (any) k.g.fill({ color, alpha });
}

function civicDrum(k: PropKit, cu: number, cv: number, r: number, z0: number, z1: number, color: number): void {
  // A short round solid for three calls: its near side, its top, its ink.
  type P = readonly [number, number, number];
  if (!k.plan && z1 > z0) {
    const side: P[] = [];
    for (let i = 0; i <= 10; i += 1) {
      const a = -Math.PI / 4 + (i / 10) * Math.PI;
      side.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, z0]);
    }
    for (let i = 10; i >= 0; i -= 1) {
      const a = -Math.PI / 4 + (i / 10) * Math.PI;
      side.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, z1]);
    }
    k.poly(side, shade(color, 0.72));
  }
  k.disc(cu, cv, r, z1, k.plan ? color : shade(color, 0.9), 1, true);
}

function civicHull(k: PropKit, pts: readonly (readonly [number, number, number])[]): { x: number; y: number }[] {
  const w = k.pts(pts).map((p) => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  if (w.length < 3) return w;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of w) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = w.length - 1; i >= 0; i -= 1) {
    const p = w[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function civicOutline(k: PropKit, pts: readonly (readonly [number, number, number])[], alpha: number, fill: number | null = null, fillAlpha = 1): void {
  const hull = civicHull(k, pts);
  if (hull.length < 3) return;
  const trace = () => {
    k.g.moveTo(hull[0]!.x, hull[0]!.y);
    for (let i = 1; i < hull.length; i += 1) k.g.lineTo(hull[i]!.x, hull[i]!.y);
    k.g.closePath();
  };
  if (fill !== null) {
    trace();
    k.g.fill({ color: fill, alpha: fillAlpha });
  }
  if (alpha > 0) {
    trace();
    k.g.stroke({ width: 1, color: k.t.ink, alpha, pixelLine: true });
  }
}

function civicBoulder(k: PropKit, cu: number, cv: number, r: number, H: number, sides: number, color: number, salt: number): (readonly [number, number, number])[] {
  type P = readonly [number, number, number];
  const r0: P[] = [];
  const r1: P[] = [];
  const r2: P[] = [];
  const rot = k.rnd(salt * 7 + 1) * Math.PI * 2;
  const ou = (k.rnd(salt * 7 + 2) - 0.5) * r * 0.35;
  const ov = (k.rnd(salt * 7 + 3) - 0.5) * r * 0.35;
  for (let i = 0; i < sides; i += 1) {
    const a = rot + (i / sides) * Math.PI * 2 + (k.rnd(salt * 13 + i) - 0.5) * (Math.PI / sides) * 0.7;
    const j = 0.82 + k.rnd(salt * 17 + i) * 0.18;
    const c = Math.cos(a);
    const s = Math.sin(a);
    r0.push([cu + c * r * j * 0.88, cv + s * r * j * 0.88, 0]);
    r1.push([cu + c * r * j, cv + s * r * j, H * (0.36 + k.rnd(salt * 19 + i) * 0.16)]);
    const j2 = 0.42 + k.rnd(salt * 23 + i) * 0.2;
    r2.push([cu + ou + c * r * j2, cv + ov + s * r * j2, H * (0.88 + k.rnd(salt * 29 + i) * 0.12)]);
  }
  const small = k.plan && r < 0.1;
  if (small) {
    k.poly(r1, shade(color, 0.86));
  } else {
    for (let i = 0; i < sides; i += 1) {
      const n = (i + 1) % sides;
      civicFacet(k, [r0[i]!, r0[n]!, r1[n]!, r1[i]!], shade(color, 0.9));
    }
    for (let i = 0; i < sides; i += 1) {
      const n = (i + 1) % sides;
      civicFacet(k, [r1[i]!, r1[n]!, r2[n]!, r2[i]!], color);
    }
  }
  civicFacet(k, r2, shade(color, 1.04));
  if (!k.plan) k.line([...r2, r2[0]!], shade(color, 1.35), 1, 0.3);
  if (!small) civicOutline(k, k.plan ? r1 : [...r0, ...r1, ...r2], 0.5);
  return r2;
}

function civicStonePts(k: PropKit, cu: number, cv: number, r: number, H: number, salt: number): { base: (readonly [number, number, number])[]; cap: (readonly [number, number, number])[] } {
  type P = readonly [number, number, number];
  const base: P[] = [];
  const cap: P[] = [];
  const rot = k.rnd(salt * 3 + 5) * Math.PI;
  for (let i = 0; i < 6; i += 1) {
    const a = rot + (i / 6) * Math.PI * 2;
    const j = 0.75 + k.rnd(salt * 11 + i) * 0.25;
    base.push([cu + Math.cos(a) * r * j, cv + Math.sin(a) * r * j, 0]);
    cap.push([cu + Math.cos(a) * r * j * 0.68, cv + Math.sin(a) * r * j * 0.68 - 0.004, H * (0.82 + k.rnd(salt * 13 + i) * 0.18)]);
  }
  return { base, cap };
}

function civicStone(k: PropKit, cu: number, cv: number, r: number, H: number, color: number, salt: number, ink: boolean): void {
  const { base, cap } = civicStonePts(k, cu, cv, r, H, salt);
  civicOutline(k, [...base, ...cap], ink && !k.plan ? 0.5 : 0, shade(color, k.plan ? 0.8 : 0.66));
  k.poly(cap, shade(color, k.plan ? 1 : 0.9));
}

/** A colour lit by the level key light for a face with this normal (top .875, south .782, east .688). */
function waterLit(color: number, nu: number, nv: number, nz: number): number {
  const len = Math.hypot(nu, nv, nz) || 1;
  const d = (nu * 0.371 + nv * 0.558 + nz * 0.743) / len;
  return shade(color, 0.502 + 0.502 * Math.max(0, d));
}

/** Screen length of one cell along u over one cell of z: what makes a standing circle round. */
function waterAspect(k: PropKit): number {
  if (k.plan) return 1;
  const a = k.at([0, 0, 0]);
  const b = k.at([1, 0, 0]);
  return Math.hypot(b.x - a.x, b.y - a.y) / k.unit;
}

/** One planar face, drawn only if it turns toward the viewer (up, in plan), lit by its normal. */
function waterFace(k: PropKit, pts: Array<[number, number, number]>, inside: [number, number, number], color: number, alpha: number): boolean {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
    cx += a[0];
    cy += a[1];
    cz += a[2];
  }
  const n = pts.length;
  if ((cx / n - inside[0]) * nx + (cy / n - inside[1]) * ny + (cz / n - inside[2]) * nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  if (k.plan ? nz / len <= 0.02 : (nx + ny + nz) / len <= 0.02) return false;
  k.poly(pts, k.plan ? color : waterLit(color, nx, ny, nz), alpha);
  return true;
}

/** A convex solid: the faces turned to the viewer, then one ink line round its silhouette. */
function waterSolid(k: PropKit, faces: Array<{ p: Array<[number, number, number]>; c: number }>, inside: [number, number, number], ink: boolean): void {
  const key = (q: [number, number, number]) => `${Math.round(q[0] * 2000)},${Math.round(q[1] * 2000)},${Math.round(q[2] * 2000)}`;
  const edges = new Map<string, { a: [number, number, number]; b: [number, number, number]; n: number; vis: number }>();
  for (const f of faces) {
    const vis = waterFace(k, f.p, inside, f.c, 1);
    for (let i = 0; i < f.p.length; i += 1) {
      const a = f.p[i]!;
      const b = f.p[(i + 1) % f.p.length]!;
      const ka = key(a);
      const kb = key(b);
      if (ka === kb) continue;
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = edges.get(id) ?? { a, b, n: 0, vis: 0 };
      e.n += 1;
      if (vis) e.vis += 1;
      edges.set(id, e);
    }
  }
  if (!ink) return;
  const segs: Array<[[number, number, number], [number, number, number]]> = [];
  for (const e of edges.values()) if (e.vis === 1) segs.push([e.a, e.b]);
  const used = segs.map(() => false);
  for (let s = 0; s < segs.length; s += 1) {
    if (used[s]) continue;
    used[s] = true;
    const path: Array<[number, number, number]> = [segs[s]![0], segs[s]![1]];
    for (let grown = true; grown; ) {
      grown = false;
      const end = key(path[path.length - 1]!);
      for (let j = 0; j < segs.length; j += 1) {
        if (used[j]) continue;
        if (key(segs[j]![0]) === end) path.push(segs[j]![1]);
        else if (key(segs[j]![1]) === end) path.push(segs[j]![0]);
        else continue;
        used[j] = true;
        grown = true;
        break;
      }
    }
    k.line(path, k.t.ink, 1, 0.55);
  }
}

/** A solid of revolution from rings [radius, z, colour of the band above]; the last colour is the top. Convex only. */
function waterLathe(k: PropKit, cu: number, cv: number, prof: Array<[number, number, number]>, sides: number): Array<[number, number, number]> {
  const rings = prof.map(([r, z]) => {
    const ring: Array<[number, number, number]> = [];
    for (let i = 0; i < sides; i += 1) {
      const a = ((i + 0.5) / sides) * Math.PI * 2;
      ring.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, z]);
    }
    return ring;
  });
  const top = rings[rings.length - 1]!;
  if (k.plan) {
    let wide = 0;
    for (let j = 1; j < prof.length; j += 1) if (prof[j]![0] > prof[wide]![0]) wide = j;
    k.poly(rings[wide]!, prof[wide]![2], 1, true);
    if (wide !== rings.length - 1) k.poly(top, prof[prof.length - 1]![2], 1);
    return top;
  }
  const faces: Array<{ p: Array<[number, number, number]>; c: number }> = [];
  for (let j = 0; j + 1 < rings.length; j += 1) {
    for (let i = 0; i < sides; i += 1) {
      const i2 = (i + 1) % sides;
      faces.push({ p: [rings[j]![i]!, rings[j]![i2]!, rings[j + 1]![i2]!, rings[j + 1]![i]!], c: prof[j]![2] });
    }
  }
  faces.push({ p: top, c: prof[prof.length - 1]![2] });
  faces.push({ p: [...rings[0]!].reverse(), c: prof[0]![2] });
  const zs = prof.map((p) => p[1]);
  waterSolid(k, faces, [cu, cv, (Math.min(...zs) + Math.max(...zs)) / 2], true);
  return top;
}

/** A round bar lying along an axis (a log, a bale, a tyre). Returns the near end cap ring. */
function waterRoll(k: PropKit, axis: 'u' | 'v', c: number, zc: number, r: number, a0: number, a1: number, color: number, cap: number, sides: number, stripe: number): Array<[number, number, number]> {
  const asp = waterAspect(k);
  const at = (th: number, a: number): [number, number, number] => {
    const x = c + Math.cos(th) * r;
    const z = zc + Math.sin(th) * r * asp;
    return axis === 'v' ? [x, a, z] : [a, x, z];
  };
  const ring0: Array<[number, number, number]> = [];
  const ring1: Array<[number, number, number]> = [];
  for (let i = 0; i < sides; i += 1) {
    const th = ((i + 0.5) / sides) * Math.PI * 2;
    ring0.push(at(th, a0));
    ring1.push(at(th, a1));
  }
  if (k.plan) {
    const z = zc + r;
    const rect: Array<[number, number, number]> =
      axis === 'v' ? [[c - r, a0, z], [c + r, a0, z], [c + r, a1, z], [c - r, a1, z]] : [[a0, c - r, z], [a1, c - r, z], [a1, c + r, z], [a0, c + r, z]];
    k.poly(rect, color, 1, true);
    return ring1;
  }
  const faces: Array<{ p: Array<[number, number, number]>; c: number }> = [];
  for (let i = 0; i < sides; i += 1) {
    const i2 = (i + 1) % sides;
    faces.push({ p: [ring0[i]!, ring0[i2]!, ring1[i2]!, ring1[i]!], c: i % 2 === 1 ? shade(color, stripe) : color });
  }
  faces.push({ p: ring1, c: cap });
  faces.push({ p: [...ring0].reverse(), c: cap });
  waterSolid(k, faces, axis === 'v' ? [c, (a0 + a1) / 2, zc] : [(a0 + a1) / 2, c, zc], true);
  return ring1;
}

/** An arc (or a spiral when r1 differs) standing on the plane `axis = at`, from angle th0 to th1. Nothing in plan. */
function waterRing(k: PropKit, axis: 'u' | 'v', c: number, zc: number, r0: number, r1: number, at: number, th0: number, th1: number, color: number, alpha: number, width: number): void {
  if (k.plan) return;
  const asp = waterAspect(k);
  const n = Math.max(8, Math.round((14 * Math.abs(th1 - th0)) / (Math.PI * 2)));
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= n; i += 1) {
    const f = i / n;
    const th = th0 + (th1 - th0) * f;
    const r = r0 + (r1 - r0) * f;
    const x = c + Math.cos(th) * r;
    const z = zc + Math.sin(th) * r * asp;
    pts.push(axis === 'v' ? [x, at, z] : [at, x, z]);
  }
  k.line(pts, color, width, alpha);
}

/** Points round a horizontal circle from a0 to a1 (a full turn closes without repeating). */
function waterCircle(cu: number, cv: number, r: number, z: number, n: number, a0: number, a1: number): Array<[number, number, number]> {
  const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < (full ? n : n + 1); i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, z]);
  }
  return out;
}

/** The outline of a set of cell-space points as seen on screen: their convex hull, as cell-space points. */
function waterHull(k: PropKit, pts: Array<[number, number, number]>): Array<[number, number, number]> {
  const s = pts.map((p) => ({ p, q: k.at(p) }));
  s.sort((a, b) => a.q.x - b.q.x || a.q.y - b.q.y);
  const cross = (o: { q: { x: number; y: number } }, a: { q: { x: number; y: number } }, b: { q: { x: number; y: number } }) => (a.q.x - o.q.x) * (b.q.y - o.q.y) - (a.q.y - o.q.y) * (b.q.x - o.q.x);
  const lower: typeof s = [];
  const upper: typeof s = [];
  for (const e of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, e) <= 0) lower.pop();
    lower.push(e);
  }
  for (let i = s.length - 1; i >= 0; i -= 1) {
    const e = s[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, e) <= 0) upper.pop();
    upper.push(e);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper].map((e) => e.p);
}

/** The faces of a solid between two matching rings of points, sides then top and bottom. */
function waterPrism(lo: Array<[number, number, number]>, hi: Array<[number, number, number]>, c: number, top: number): Array<{ p: Array<[number, number, number]>; c: number }> {
  const faces: Array<{ p: Array<[number, number, number]>; c: number }> = [];
  for (let i = 0; i < lo.length; i += 1) {
    const j = (i + 1) % lo.length;
    faces.push({ p: [lo[i]!, lo[j]!, hi[j]!, hi[i]!], c });
  }
  faces.push({ p: hi, c: top });
  faces.push({ p: [...lo].reverse(), c });
  return faces;
}

/** The run of a closed ground outline whose edges face the viewer (south or east). */
function waterNear(loop: Array<[number, number, number]>, cu: number, cv: number): Array<[number, number, number]> {
  const n = loop.length;
  const vis = loop.map((a, i) => {
    const b = loop[(i + 1) % n]!;
    let nu = b[1] - a[1];
    let nv = -(b[0] - a[0]);
    if (((a[0] + b[0]) / 2 - cu) * nu + ((a[1] + b[1]) / 2 - cv) * nv < 0) {
      nu = -nu;
      nv = -nv;
    }
    return nu + nv > 1e-6;
  });
  let start = vis.findIndex((v, i) => v && !vis[(i - 1 + n) % n]);
  if (start < 0) start = 0;
  const out: Array<[number, number, number]> = [loop[start]!];
  for (let j = 0; j < n && vis[(start + j) % n]; j += 1) out.push(loop[(start + j + 1) % n]!);
  return out;
}

/** Exported so a draft design can be rendered over the live one (tooling), never mutated by the app. */
export const DESIGNS: Readonly<Record<TileProp, Draw>> = {
  desk: (k, h, glow) => {
    const t = k.t;
    const zt = h * 0.74;
    const zu = zt - Math.max(0.03, h * 0.08);
    const ped = shade(t.base, 0.9);
    if (!k.plan) {
      // The knee well: a modesty panel at the back, two pedestals either side.
      k.box(0.33, 0.25, 0.67, 0.29, h * 0.16, zu, shade(t.base, 0.72), { crown: false });
      k.box(0.1, 0.23, 0.33, 0.78, 0, zu, ped, { crown: false });
      k.box(0.67, 0.23, 0.9, 0.78, 0, zu, ped, { crown: false });
      // Drawer fronts: three on the left, a deep file drawer and a shallow one on the right.
      const pedestals: [number, number, number[]][] = [[0.1, 0.33, [0.36, 0.68]], [0.67, 0.9, [0.58]]];
      for (const [u0, u1, cuts] of pedestals) {
        for (const c of cuts) k.line([[u0 + 0.012, 0.781, zu * c], [u1 - 0.012, 0.781, zu * c]], t.ink, 1, 0.55);
        const rows = [0, ...cuts, 1];
        const uc = (u0 + u1) / 2;
        for (let i = 0; i < rows.length - 1; i += 1) {
          const zm = zu * (rows[i]! * 0.3 + rows[i + 1]! * 0.7);
          k.line([[uc - 0.035, 0.782, zm], [uc + 0.035, 0.782, zm]], t.light, 1, 0.9);
        }
        k.facePanel('u', 0.783, u0, zu - h * 0.035, u1, zu, t.ink, 0.3);
      }
    }
    k.box(0.08, 0.2, 0.92, 0.8, zu, zt, t.base);
    const z = zt + 0.002;
    // Flat things first: a blotter, papers, keyboard, mouse.
    const layout = k.rnd(1);
    const dual = layout > 0.62;
    const mc = dual ? 0.5 : 0.5 + (k.rnd(2) - 0.5) * 0.18;
    k.poly(officeRect(mc - 0.2, 0.5, mc + 0.2, 0.76, z), officeTop(k, t.base, 0.9), 1);
    const left = dual ? k.rnd(2) < 0.5 : mc > 0.5;
    const pu = left ? 0.2 : 0.8;
    const pr = (k.rnd(3) - 0.5) * 0.7;
    // Beside the keyboard: loose paper most days, a datapad, or a closed folder.
    const spread = k.rnd(18);
    const sheets = spread < 0.6 ? 1 + Math.floor(k.rnd(4) * 2.2) : 0;
    if (spread >= 0.6) {
      const c = Math.cos(pr);
      const s = Math.sin(pr);
      const at = (du: number, dv: number, lift: number): [number, number, number] => [pu + du * c - dv * s, 0.6 + du * s + dv * c, z + lift];
      const pad = spread < 0.85;
      const w = pad ? 0.06 : 0.08;
      const d = pad ? 0.085 : 0.11;
      k.poly([at(-w, -d, 0.004), at(w, -d, 0.004), at(w, d, 0.004), at(-w, d, 0.004)], pad ? shade(t.ink, 0.85) : shade(t.accent, 0.8), 1, !pad);
      if (pad) k.poly([at(-w + 0.012, -d + 0.014, 0.006), at(w - 0.012, -d + 0.014, 0.006), at(w - 0.012, d - 0.022, 0.006), at(-w + 0.012, d - 0.022, 0.006)], GLASS, 0.18);
      else k.line([at(-w + 0.01, -d, 0.006), at(-w + 0.01, d, 0.006)], officeCap(shade(t.light, 1.2)), 1, 0.6);
    }
    for (let i = 0; i < sheets; i += 1) {
      const a = pr + (k.rnd(5 + i) - 0.5) * 0.5;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const cu = pu + (k.rnd(8 + i) - 0.5) * 0.06;
      const cv = 0.6 + (k.rnd(11 + i) - 0.5) * 0.08;
      const pts = ([[-0.075, -0.1], [0.075, -0.1], [0.075, 0.1], [-0.075, 0.1]] as const).map(([du, dv]): [number, number, number] => [cu + du * c - dv * s, cv + du * s + dv * c, z + 0.002 * (i + 1)]);
      k.poly(pts, officeCap(officeTop(k, t.light, 1.14 - i * 0.05)), 1);
    }
    k.poly(officeRect(mc - 0.13, 0.57, mc + 0.13, 0.66, z + 0.004), t.ink, 0.92);
    k.line([[mc - 0.11, 0.615, z + 0.005], [mc + 0.11, 0.615, z + 0.005]], t.dark, 1, 0.55);
    k.disc(mc + (left ? -0.19 : 0.19), 0.62, 0.022, z + 0.004, t.ink, 0.95);
    // Standing things, back to front: monitors, a lamp, a mug.
    let screen: [number, number, number][];
    if (dual) {
      officeMonitor(k, 0.31, 0.33, 0.3, zt, h, glow, 20);
      screen = officeMonitor(k, 0.67, 0.35, 0.3, zt, h, glow, 30);
    } else {
      screen = officeMonitor(k, mc, 0.34, 0.38, zt, h, glow, 20);
    }
    const corner = dual ? 1 : k.rnd(6);
    if (corner < 0.45) {
      // A task lamp: weighted foot, a two-part arm, a shade with its rim catching the light.
      const lu = left ? 0.17 : 0.83;
      const dir = left ? 1 : -1;
      const hu = lu + dir * 0.08;
      const hz = zt + h * 0.34;
      k.disc(lu, 0.3, 0.045, z, t.ink, 1, true);
      if (!k.plan) {
        k.line([[lu, 0.3, z], [lu - dir * 0.01, 0.31, zt + h * 0.42], [hu, 0.39, hz + h * 0.04]], shade(t.ink, 1.6), 2, 1);
        k.poly([[hu - 0.028, 0.385, hz + h * 0.05], [hu + 0.028, 0.385, hz + h * 0.05], [hu + 0.055, 0.43, hz - h * 0.05], [hu - 0.055, 0.43, hz - h * 0.05]], shade(t.accent, 0.85), 1, true);
        k.line([[hu - 0.05, 0.432, hz - h * 0.05], [hu + 0.05, 0.432, hz - h * 0.05]], officeCap(shade(t.light, 1.25)), 1, 0.8);
      } else {
        k.poly([[hu - 0.045, 0.37, zt], [hu + 0.045, 0.37, zt], [hu + 0.055, 0.45, zt], [hu - 0.055, 0.45, zt]], shade(t.accent, 0.85), 1, true);
      }
    } else if (corner < 0.8) {
      // Binders on end at the back corner, spines to the room.
      const bu = left ? 0.1 : 0.78;
      const n = 2 + Math.floor(k.rnd(16) * 2);
      const w = 0.12 / n;
      const spines = [0x4f6a7a, 0x7a5046, 0x6a6a4a, shade(t.accent, 0.9)];
      k.box(bu, 0.24, bu + 0.12, 0.36, zt, zt + h * 0.3, shade(t.ink, 1.25), { crown: false });
      for (let i = 0; i < n; i += 1) {
        k.poly(officeRect(bu + i * w + 0.004, 0.25, bu + (i + 1) * w - 0.004, 0.35, zt + h * 0.3 + 0.001), spines[Math.floor(k.rnd(17 + i) * spines.length)]!, 1);
        k.facePanel('u', 0.361, bu + i * w + 0.004, zt + h * 0.02, bu + (i + 1) * w - 0.004, zt + h * 0.29, shade(spines[Math.floor(k.rnd(17 + i) * spines.length)]!, 0.8), 1);
      }
      officeDashes(k, k.plan ? [] : Array.from({ length: n }, (_, i): [number, number, number][] => [[bu + (i + 0.5) * w, 0.362, zt + h * 0.2], [bu + (i + 0.5) * w, 0.362, zt + h * 0.24]]), officeCap(shade(t.light, 1.2)), 0.8);
    }
    if (k.rnd(7) < 0.65) {
      const mu = left ? 0.86 : 0.14;
      const mv = 0.52 + k.rnd(9) * 0.18;
      const cup = officeCap(shade(t.light, 1.12));
      if (!k.plan) k.line([[mu, mv, z], [mu, mv, z + h * 0.1]], shade(cup, 0.8), 3, 1);
      k.disc(mu, mv, 0.024, z + h * 0.1, cup, 1);
      k.disc(mu, mv, 0.014, z + h * 0.1 + 0.001, shade(t.ink, 0.7), 1);
    }
    if (glow === null) return null;
    return k.plan ? k.pts(officeRect(screen[0]![0], screen[0]![1] - 0.04, screen[1]![0], screen[0]![1], zt)) : k.pts(screen);
  },
  chair: (k, h) => {
    const t = k.t;
    // Most chairs sit square-ish; now and then one has been pushed back and turned.
    const rot = (k.rnd(3) - 0.5) * (k.rnd(8) < 0.2 ? 1.2 : 0.4);
    const cu = 0.5 + (k.rnd(4) - 0.5) * 0.04;
    const cv = 0.52 + (k.rnd(5) - 0.5) * 0.04;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const at = (du: number, dv: number): [number, number] => [cu + du * c - dv * s, cv + du * s + dv * c];
    const hu = 0.17;
    const hv = 0.16;
    const zs = h * 0.36;
    const zf = h * 0.44;
    const zt = h * 0.56;
    const zk = h * 1.2;
    const lu = hu - 0.035;
    const lv = hv - 0.035;
    const p = (du: number, dv: number, z: number): [number, number, number] => {
      const [u, v] = at(du, dv);
      return [u, v, z];
    };
    const frame = shade(t.dark, 0.9);
    if (!k.plan) {
      // Back legs run on up as the back posts; front legs stop under the rail.
      const leg = shade(t.dark, 0.78);
      for (const du of [-1, 1]) k.line([p(du * lu, -lv, 0), p(du * lu, -lv, h * 0.72)], leg, 2, 1);
      // Stretchers: along the east side and across the front, low down.
      k.line([p(lu, -lv, h * 0.13), p(lu, lv, h * 0.13)], t.ink, 1, 0.75);
      for (const du of [-1, 1]) k.line([p(du * lu, lv, 0), p(du * lu, lv, zs)], leg, 2, 1);
      k.line([p(-lu, lv, h * 0.16), p(lu, lv, h * 0.16)], t.ink, 1, 0.75);
    }
    // The seat: a dark rail with the cushion sitting proud of it.
    officeSlab(k, cu, cv, hu, hv, rot, zs, zf, frame, false);
    const [su, sv] = at(0, 0.005);
    officeSlab(k, su, sv, hu - 0.018, hv - 0.022, rot, zf, zt, t.base);
    // The seat's dished middle and the piping along its front edge.
    k.poly([p(-hu + 0.06, -hv + 0.06, zt + 0.002), p(hu - 0.06, -hv + 0.06, zt + 0.002), p(hu - 0.055, hv - 0.06, zt + 0.002), p(-hu + 0.055, hv - 0.06, zt + 0.002)], officeTop(k, t.base, 1.07), 1);
    if (!k.plan) k.line([p(-hu + 0.03, hv - 0.02, zt), p(hu - 0.03, hv - 0.02, zt)], officeCap(shade(t.base, 1.3)), 1, 0.5);
    // Now and then something left on the seat: a folded paper, a datapad.
    if (k.rnd(12) < 0.14) {
      const o = (k.rnd(13) - 0.5) * 0.08;
      const pad = k.rnd(14) >= 0.5;
      k.poly([p(o - 0.06, -0.02, zt + 0.004), p(o + 0.05, -0.04, zt + 0.004), p(o + 0.07, 0.06, zt + 0.004), p(o - 0.04, 0.08, zt + 0.004)], pad ? shade(t.ink, 1.3) : officeCap(shade(t.light, 1.15)), 1, pad);
      // A datapad shows its glass, so it reads as a thing left on the seat and not a hole in it.
      if (pad) k.poly([p(o - 0.042, -0.01, zt + 0.005), p(o + 0.038, -0.024, zt + 0.005), p(o + 0.052, 0.048, zt + 0.005), p(o - 0.027, 0.063, zt + 0.005)], GLASS, 0.24);
    }
    // The back: a frame with an upholstered panel standing on the posts.
    const bd = -(hv - 0.025);
    const [bu, bv] = at(0, bd);
    // In plan the back is the chair's whole symbol, so it goes down in ink and a hair deeper than the frame.
    officeSlab(k, bu, bv, hu, k.plan ? 0.036 : 0.028, rot, h * 0.7, zk, k.plan ? shade(t.ink, 1.05) : frame);
    if (!k.plan) {
      const f = bd + 0.03;
      k.poly([p(-hu + 0.03, f, h * 0.76), p(hu - 0.03, f, h * 0.76), p(hu - 0.03, f, zk - h * 0.05), p(-hu + 0.03, f, zk - h * 0.05)], shade(t.base, 0.95), 1);
      k.line([p(-hu + 0.03, f + 0.001, zk - h * 0.06), p(hu - 0.03, f + 0.001, zk - h * 0.06)], officeCap(shade(t.base, 1.3)), 1, 0.55);
      k.line([p(-hu + 0.04, f + 0.001, h * 0.93), p(hu - 0.04, f + 0.001, h * 0.93)], shade(t.base, 0.8), 1, 0.6);
    } else {
      k.line([p(-hu + 0.03, bd + 0.012, zk), p(hu - 0.03, bd + 0.012, zk)], officeCap(shade(t.base, 1.25)), 1, 0.6);
    }
    // Now and then a jacket left over the back.
    if (k.rnd(9) < 0.2) {
      const jc = [0x4a4541, 0x5e4b3b, 0x4a5043][Math.floor(k.rnd(10) * 3)]!;
      const o = (k.rnd(11) - 0.5) * 0.05;
      const f = bd + 0.034;
      k.poly([p(o - 0.12, f, zk + 0.005), p(o + 0.1, f, zk + 0.005), p(o + 0.11, f, h * 0.84), p(o + 0.075, f, h * 0.64), p(o + 0.05, f, h * 0.8), p(o - 0.06, f, h * 0.78), p(o - 0.1, f, h * 0.62), p(o - 0.13, f, h * 0.82)], jc, 1, true);
      k.poly([p(o - 0.12, bd - 0.034, zk + 0.006), p(o + 0.1, bd - 0.034, zk + 0.006), p(o + 0.1, f, zk + 0.006), p(o - 0.12, f, zk + 0.006)], shade(jc, 1.18), 1);
      if (!k.plan) k.line([p(o - 0.02, f + 0.001, zk), p(o - 0.01, f + 0.001, h * 0.8)], shade(jc, 0.7), 1, 0.8);
    }
    return null;
  },
  sofa: (k, h) => {
    const t = k.t;
    const frame = shade(t.base, 0.8);
    const arm = shade(t.base, 0.94);
    const z0 = h * 0.12;
    const deck = h * 0.3;
    const backZ = h * 0.98;
    const armZ = h * 0.64;
    const n = k.rnd(1) < 0.5 ? 2 : 3;
    const a0 = 0.19;
    const w = 0.62 / n;
    if (!k.plan) {
      for (const [u, v] of [[0.1, 0.82], [0.9, 0.82], [0.9, 0.3]] as const) k.line([[u, v, 0], [u, v, z0]], t.ink, 2.5, 1);
    }
    // The frame of the back, then the near-west arm, padded on top.
    k.box(0.06, 0.25, 0.94, 0.38, z0, backZ, frame);
    k.box(0.06, 0.38, 0.19, 0.85, z0, armZ, arm);
    if (!k.plan) {
      k.poly([[0.075, 0.4, armZ], [0.175, 0.4, armZ], [0.175, 0.835, armZ], [0.075, 0.835, armZ]], shade(arm, 0.95), 1);
      k.facePanel('u', 0.851, 0.08, z0 + h * 0.06, 0.17, armZ - h * 0.06, loungeFace(shade(arm, 1.08), 'u', 0.6), 1);
      k.box(0.19, 0.38, 0.81, 0.83, z0, deck, frame, { crown: false });
    }
    // Back cushions leaning on the frame: a slanted face, darker where it meets the seat.
    for (let i = 0; i < n; i += 1) {
      const u0 = a0 + i * w + 0.006;
      const u1 = a0 + (i + 1) * w - 0.006;
      const top = h * (0.9 - k.rnd(10 + i) * 0.07);
      if (k.plan) {
        k.poly([[u0, 0.38, 0], [u1, 0.38, 0], [u1, 0.48, 0], [u0, 0.48, 0]], shade(t.base, 0.9), 1, true);
        continue;
      }
      const mid = (deck + top) / 2;
      k.poly([[u0, 0.56, deck], [u1, 0.56, deck], [u1, 0.51, mid], [u0, 0.51, mid]], shade(t.base, 0.74), 1);
      k.poly([[u0, 0.51, mid], [u1, 0.51, mid], [u1, 0.45, top], [u0, 0.45, top]], shade(t.base, 0.85), 1);
      k.poly([[u0, 0.38, top], [u1, 0.38, top], [u1, 0.45, top], [u0, 0.45, top]], shade(t.base, 0.95), 1);
      if (i === n - 1) k.poly([[u1, 0.38, top], [u1, 0.45, top], [u1, 0.56, deck], [u1, 0.38, deck]], shade(t.base, 0.66), 1);
      k.line([[u0, 0.56, deck], [u0, 0.45, top], [u0, 0.38, top], [u1, 0.38, top], [u1, 0.45, top], [u1, 0.56, deck]], t.ink, 1, 0.5);
      k.line([[u0 + 0.01, 0.45, top], [u1 - 0.01, 0.45, top]], shade(t.base, 1.3), 1, 0.45);
    }
    // Seat cushions, each sagged its own amount, plump in the middle.
    for (let i = 0; i < n; i += 1) {
      const u0 = a0 + i * w + 0.004;
      const u1 = a0 + (i + 1) * w - 0.004;
      const sit = h * (0.5 - k.rnd(20 + i) * 0.05);
      k.box(u0, 0.5, u1, 0.85, deck, sit, t.base);
      if (!k.plan) k.poly([[u0 + 0.03, 0.55, sit], [u1 - 0.03, 0.55, sit], [u1 - 0.03, 0.8, sit], [u0 + 0.03, 0.8, sit]], shade(t.base, 0.93), 1);
    }
    // A scatter cushion propped in one corner, puffed at the edges.
    const pillow = k.rnd(6);
    if (pillow < 0.7) {
      const pu = pillow < 0.35 ? 0.2 : 0.61;
      const spin = (k.rnd(7) - 0.5) * 0.7;
      const sit = h * 0.48;
      const at = (s: number, r: number): [number, number, number] => {
        const ss = 0.5 + (s - 0.5) * Math.cos(spin) - (r - 0.5) * Math.sin(spin);
        const rr = 0.5 + (s - 0.5) * Math.sin(spin) + (r - 0.5) * Math.cos(spin);
        return [pu + ss * 0.16, 0.63 - rr * 0.08, sit + rr * h * 0.34];
      };
      k.poly([at(0, 0), at(0.5, 0.08), at(1, 0), at(0.92, 0.5), at(1, 1), at(0.5, 0.92), at(0, 1), at(0.08, 0.5)], shade(t.light, 0.74), 1, true);
      if (!k.plan) k.poly([at(0.1, 0.55), at(0.5, 0.45), at(0.9, 0.55), at(0.96, 0.96), at(0.5, 0.9), at(0.04, 0.96)], shade(t.light, 0.9), 1);
    }
    k.box(0.81, 0.38, 0.94, 0.85, z0, armZ, arm);
    if (!k.plan) {
      k.poly([[0.825, 0.4, armZ], [0.925, 0.4, armZ], [0.925, 0.835, armZ], [0.825, 0.835, armZ]], shade(arm, 0.95), 1);
      k.facePanel('u', 0.851, 0.83, z0 + h * 0.06, 0.92, armZ - h * 0.06, loungeFace(shade(arm, 1.08), 'u', 0.6), 1);
      k.facePanel('v', 0.941, 0.42, z0 + h * 0.07, 0.81, armZ - h * 0.08, loungeFace(shade(arm, 1.06), 'v', 0.6), 1);
    }
    // A striped throw over the near arm, sometimes, hanging down its side.
    if (k.rnd(5) < 0.4) {
      const tv = 0.46 + k.rnd(4) * 0.18;
      const cloth = shade(t.light, 0.86);
      const z = armZ + 0.004;
      k.poly([[0.8, tv, z], [0.945, tv, z], [0.945, tv + 0.17, z], [0.8, tv + 0.17, z]], cloth, 1, true);
      if (!k.plan) {
        const side = loungeFace(cloth, 'v', 0.6);
        k.poly([[0.946, tv, armZ], [0.946, tv + 0.17, armZ], [0.946, tv + 0.19, h * 0.16], [0.946, tv + 0.09, h * 0.24], [0.946, tv - 0.01, h * 0.2]], side, 1, true);
      }
      for (const d of [0.04, 0.13]) k.line([[0.8, tv + d, z], [0.945, tv + d, z], [0.947, tv + d + 0.01, h * 0.22]], shade(cloth, 0.8), 1.5, 0.9);
    }
    return null;
  },
  table: (k, h) => {
    const t = k.t;
    const slab = h * 0.84;
    const topZ = h * 0.95;
    const apron = h * 0.7;
    const legC = shade(t.base, 0.74);
    const cloth = k.rnd(11) < 0.25;
    if (!k.plan) {
      k.line([[0.155, 0.205, 0], [0.155, 0.205, slab]], legC, 3, 1);
      k.box(0.16, 0.21, 0.84, 0.79, apron, slab, shade(t.base, 0.7), { crown: false });
      for (const [u, v] of [[0.13, 0.77], [0.82, 0.18], [0.82, 0.77]] as const) {
        k.box(u, v, u + 0.05, v + 0.05, 0, slab, legC, { crown: false, ink: false });
      }
    }
    k.box(0.1, 0.15, 0.9, 0.85, slab, topZ, t.base);
    const z = topZ + 0.002;
    const paper = loungeCap(shade(t.light, 1.2));
    if (cloth) {
      // A cloth over it, falling a hand's depth past the edge.
      const linen = loungeCap(shade(t.light, 1.12), 0.66);
      const drop = slab - h * 0.2;
      if (!k.plan) {
        const lo = drop - h * 0.08;
        const hem: Array<[number, number, number]> = [[0.08, 0.872, drop - h * 0.03], [0.3, 0.872, drop + h * 0.03], [0.7, 0.872, drop + h * 0.03], [0.922, 0.872, lo], [0.922, 0.6, drop + h * 0.03], [0.922, 0.3, drop + h * 0.03], [0.922, 0.13, drop - h * 0.03]];
        k.poly([[0.08, 0.872, topZ], [0.922, 0.872, topZ], hem[3]!, hem[2]!, hem[1]!, hem[0]!], loungeFace(linen, 'u', 0.7), 1);
        k.poly([[0.922, 0.872, topZ], [0.922, 0.13, topZ], hem[6]!, hem[5]!, hem[4]!, hem[3]!], loungeFace(linen, 'v', 0.7), 1);
        for (const u of [0.3, 0.7]) k.line([[u, 0.873, drop + h * 0.03], [u, 0.873, topZ - h * 0.03]], shade(linen, 0.64), 1, 0.55);
        k.line([[0.9225, 0.3, drop + h * 0.03], [0.9225, 0.3, topZ - h * 0.03]], shade(linen, 0.56), 1, 0.55);
        k.line(hem, t.ink, 1, 0.5);
      }
      k.poly([[0.08, 0.13, z], [0.922, 0.13, z], [0.922, 0.872, z], [0.08, 0.872, z]], k.plan ? linen : shade(linen, 0.9), 1);
    } else {
      k.poly([[0.14, 0.19, topZ], [0.86, 0.19, topZ], [0.86, 0.81, topZ], [0.14, 0.81, topZ]], shade(t.base, 1.05), 0.55);
    }
    const layout = Math.floor(k.rnd(1) * 5);
    if (layout === 0) {
      // Two places laid, knife and fork, a glass each and a bottle between.
      const metal = loungeCap(shade(t.light, 1.1));
      for (const u of [0.28, 0.72]) {
        k.disc(u, 0.52, 0.1, z, paper, 0.95, true);
        k.disc(u, 0.52, 0.06, z, shade(paper, 0.88), 1);
        k.line([[u - 0.135, 0.45, z], [u - 0.135, 0.6, z]], metal, 1, 0.8);
        k.line([[u + 0.135, 0.45, z], [u + 0.135, 0.6, z]], metal, 1, 0.8);
      }
      const wine = k.rnd(12) < 0.5 ? null : 0x7a3f3a;
      loungeGlass(k, 0.38, 0.33, z, h * 0.14, wine);
      loungeBottle(k, 0.5, 0.36, z, h * 0.18, shade(t.accent, 0.7), 1);
      loungeGlass(k, 0.62, 0.33, z, h * 0.14, wine);
    } else if (layout === 1) {
      // Papers and a pen, a dark tablet, a mug.
      const r = k.rnd(2) * 0.06;
      k.poly([[0.2, 0.33 + r, z], [0.42, 0.26 + r, z], [0.48, 0.5 + r, z], [0.26, 0.57 + r, z]], shade(paper, 0.86), 1);
      k.poly([[0.28, 0.32 + r, z + 0.004], [0.5, 0.34 + r, z + 0.004], [0.48, 0.6 + r, z + 0.004], [0.26, 0.58 + r, z + 0.004]], paper, 1);
      k.line([[0.31, 0.42 + r, z + 0.006], [0.44, 0.52 + r, z + 0.006]], t.ink, 1.5, 0.8);
      k.poly([[0.6, 0.24, z], [0.8, 0.26, z], [0.79, 0.42, z], [0.59, 0.4, z]], t.ink, 1);
      k.poly([[0.615, 0.26, z + 0.003], [0.785, 0.277, z + 0.003], [0.776, 0.405, z + 0.003], [0.605, 0.39, z + 0.003]], GLASS, 0.16);
      loungeMug(k, 0.7, 0.62, z, h);
    } else if (layout === 2) {
      // A runner down its length (or none, on a cloth) and a bowl of fruit.
      if (!cloth) {
        k.poly([[0.1, 0.42, z], [0.9, 0.42, z], [0.9, 0.58, z], [0.1, 0.58, z]], shade(t.accent, 0.7), 0.9);
        if (!k.plan) k.facePanel('v', 0.901, 0.42, slab - h * 0.12, 0.58, topZ, loungeFace(shade(t.accent, 0.7), 'v', 0.6), 0.95);
      }
      k.disc(0.52, 0.5, 0.1, z, shade(t.dark, 0.9), 1, true);
      k.disc(0.52, 0.5, 0.075, z + 0.01, shade(t.dark, 0.7), 1);
      for (const [fu, fv, c] of [[0.49, 0.47, 0x8a4a3a], [0.555, 0.485, 0x9a8a3a], [0.51, 0.535, FOLIAGE]] as const) k.disc(fu, fv, 0.035, z + h * 0.05, c, 1);
    } else if (layout === 3) {
      // A water bottle and two glasses.
      loungeGlass(k, 0.34, 0.6, z, h * 0.12, null);
      loungeBottle(k, 0.5, 0.44, z, h * 0.16, GLASS, 0.6);
      loungeGlass(k, 0.64, 0.36, z, h * 0.12, null);
      loungeMug(k, 0.72, 0.64, z, h);
    } else {
      // Two notepads with pens either side of a conference puck.
      for (const [u, v] of [[0.2, 0.28], [0.62, 0.56]] as const) {
        k.poly([[u, v, z], [u + 0.15, v, z], [u + 0.15, v + 0.2, z], [u, v + 0.2, z]], paper, 0.95, true);
        k.line([[u + 0.03, v + 0.07, z], [u + 0.12, v + 0.07, z]], shade(paper, 0.8), 1, 0.8);
        k.line([[u + 0.19, v + 0.02, z], [u + 0.2, v + 0.17, z]], t.ink, 1.5, 0.9);
      }
      k.disc(0.47, 0.54, 0.07, z, t.ink, 1);
      k.disc(0.47, 0.54, 0.025, z, shade(t.light, 0.9), 0.8);
    }
    return null;
  },
  cocktail: (k, h) => {
    const t = k.t;
    const rim = h * 0.88;
    const topZ = h * 0.96;
    if (!k.plan) {
      k.disc(0.5, 0.5, 0.18, 0, t.ink, 1, true);
      k.disc(0.5, 0.49, 0.145, h * 0.03, t.dark, 1);
      k.band(0.5, 0.49, 0.145, h * 0.03, shade(t.dark, 1.45), 0.5);
      k.disc(0.5, 0.49, 0.055, h * 0.05, shade(t.ink, 1.2), 1);
      k.line([[0.5, 0.5, h * 0.05], [0.5, 0.5, rim]], shade(t.ink, 0.9), 4, 1);
      k.line([[0.485, 0.515, h * 0.07], [0.485, 0.515, rim - h * 0.05]], shade(t.dark, 1.2), 1, 0.45);
      k.disc(0.5, 0.5, 0.11, rim - h * 0.02, t.ink, 1);
    }
    k.cyl(0.5, 0.5, 0.32, rim, topZ, t.base, { sides: 16 });
    k.disc(0.5, 0.5, 0.27, topZ + 0.002, shade(t.base, 1.06), 0.6);
    if (!k.plan) k.band(0.5, 0.5, 0.32, rim + h * 0.02, shade(t.base, 0.6), 0.5);
    const z = topZ + 0.004;
    const paper = loungeCap(shade(t.light, 1.2));
    // What sits in the middle: a tea-light, an ashtray, a bud vase or a folded card.
    const piece = k.rnd(1);
    if (piece < 0.35) {
      k.disc(0.5, 0.5, 0.05, z, shade(t.ink, 1.1), 0.9);
      if (!k.plan) k.line([[0.5, 0.5, z], [0.5, 0.5, z + h * 0.06]], GLASS, 3.5, 0.35);
      k.disc(0.5, 0.5, 0.035, z + (k.plan ? 0 : h * 0.07), loungeCap(shade(t.light, 1.15)), 1);
    } else if (piece < 0.55) {
      k.disc(0.5, 0.5, 0.07, z, shade(t.ink, 1.25), 0.95, true);
      k.disc(0.5, 0.5, 0.04, z, t.ink, 1);
      k.line([[0.49, 0.5, z + 0.004], [0.57, 0.47, z + 0.004]], paper, 1.5, 0.9);
    } else if (piece < 0.8) {
      k.disc(0.5, 0.5, 0.03, z, GLASS, 0.5);
      if (!k.plan) {
        k.line([[0.5, 0.5, z], [0.5, 0.5, z + h * 0.1]], GLASS, 3, 0.45);
        k.line([[0.5, 0.5, z + h * 0.08], [0.51, 0.49, z + h * 0.24]], FOLIAGE, 1.5, 1);
      }
      k.disc(0.51, 0.49, 0.04, z + (k.plan ? 0 : h * 0.24), loungeCap(shade(t.accent, 1.25)), 1);
    } else {
      k.poly([[0.44, 0.5, z + h * 0.17], [0.56, 0.5, z + h * 0.17], [0.56, 0.54, z], [0.44, 0.54, z]], paper, 1, true);
      if (!k.plan) {
        k.poly([[0.56, 0.5, z + h * 0.17], [0.56, 0.54, z], [0.56, 0.46, z]], shade(paper, 0.66), 1);
        k.line([[0.465, 0.52, z + h * 0.09], [0.535, 0.52, z + h * 0.09]], shade(paper, 0.72), 1, 0.9);
      }
    }
    // One to three drinks, each on a coaster.
    const count = 1 + Math.floor(k.rnd(2) * 3);
    const spin = k.rnd(3) * Math.PI * 2;
    const glasses: Array<[number, number, number]> = [];
    for (let i = 0; i < count; i += 1) {
      const a = spin + (i * Math.PI * 2) / 3;
      glasses.push([0.5 + Math.cos(a) * 0.19, 0.5 + Math.sin(a) * 0.19, i]);
    }
    glasses.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
    const drinks = [null, 0x8a6a3a, 0x7a3f3a, 0x9a8a4a];
    for (const [u, v] of glasses) k.disc(u, v, 0.05, z, paper, 0.85);
    for (const [u, v, i] of glasses) loungeGlass(k, u, v, z, h * 0.14, drinks[Math.floor(k.rnd(40 + i) * 4)]!);
    return null;
  },
  booth: (k, h) => {
    const t = k.t;
    const shell = shade(t.base, 0.78);
    const trim = shade(t.light, 0.82);
    const seat = h * 0.46;
    const backZ = h * 0.98;
    // --- the far bench, facing the viewer
    if (!k.plan) k.box(0.05, 0.05, 0.95, 0.16, 0, backZ, shell);
    k.box(0.04, 0.04, 0.96, 0.17, h * 0.9, h * 1.02, trim);
    k.box(0.08, 0.17, 0.92, 0.23, seat - h * 0.04, h * 0.9, t.base);
    if (!k.plan) {
      for (let i = 1; i < 6; i += 1) {
        const u = 0.08 + i * 0.14;
        k.line([[u, 0.231, seat], [u, 0.231, h * 0.88]], t.ink, 1, 0.4);
      }
      k.box(0.06, 0.17, 0.94, 0.36, 0, h * 0.32, shade(t.base, 0.7), { crown: false });
    }
    k.box(0.06, 0.2, 0.94, 0.38, h * 0.32, seat, t.base);
    // A bag left on the far seat, sometimes, where the table does not hide it.
    if (k.rnd(8) < 0.4) {
      const bag = shade(t.light, 0.66);
      const bu = 0.79 + k.rnd(9) * 0.05;
      const top = seat + h * 0.14;
      k.box(bu, 0.25, bu + 0.1, 0.31, seat, top, bag);
      if (!k.plan) k.line([[bu + 0.02, 0.28, top], [bu + 0.035, 0.28, top + h * 0.09], [bu + 0.065, 0.28, top + h * 0.09], [bu + 0.08, 0.28, top]], shade(bag, 0.7), 1.5, 1);
    }
    if (!k.plan) {
      k.poly([[0.953, 0.05, 0], [0.953, 0.38, 0], [0.953, 0.38, seat], [0.953, 0.17, seat], [0.953, 0.17, h * 1.02], [0.953, 0.04, h * 1.02]], loungeFace(trim, 'v', 0.8), 1, true);
    }
    // --- the table between them, and what is on it
    k.box(0.2, 0.41, 0.8, 0.59, h * 0.68, h * 0.76, loungeCap(shade(t.light, 1.1)));
    const z = h * 0.762;
    loungeGlass(k, 0.3 + k.rnd(1) * 0.1, 0.46, z, h * 0.12, k.rnd(7) < 0.5 ? null : 0x8a6a3a);
    const piece = k.rnd(3);
    if (piece < 0.4) {
      // A little shaded table lamp.
      k.disc(0.5, 0.5, 0.04, z, t.ink, 0.9);
      if (!k.plan) k.line([[0.5, 0.5, z], [0.5, 0.5, z + h * 0.14]], t.ink, 1.5, 1);
      k.disc(0.5, 0.5, 0.055, z + (k.plan ? 0 : h * 0.14), shade(t.accent, 0.9), 1, true);
    } else if (piece < 0.7) {
      // The menu, open.
      k.poly([[0.42, 0.44, z], [0.56, 0.44, z], [0.56, 0.54, z], [0.42, 0.54, z]], loungeCap(shade(t.light, 1.25)), 0.9);
      k.line([[0.49, 0.44, z + 0.004], [0.49, 0.54, z + 0.004]], t.ink, 1, 0.5);
    } else {
      // Salt, pepper and a napkin box.
      k.box(0.46, 0.45, 0.55, 0.51, z, z + h * 0.08, shade(t.light, 0.9));
      if (!k.plan) {
        k.line([[0.42, 0.53, z], [0.42, 0.53, z + h * 0.06]], loungeCap(shade(t.light, 1.3)), 2.5, 1);
        k.line([[0.58, 0.53, z], [0.58, 0.53, z + h * 0.06]], t.ink, 2.5, 1);
      }
    }
    loungeGlass(k, 0.62 + k.rnd(2) * 0.1, 0.49, z, h * 0.12, null);
    // --- the near bench, its back to the viewer
    // The near seat is wholly behind its own back in isometric: it is only drawn for the plan symbol.
    if (k.plan) k.poly([[0.06, 0.62, seat], [0.94, 0.62, seat], [0.94, 0.8, seat], [0.06, 0.8, seat]], t.base, 1, true);
    if (!k.plan) {
      k.box(0.05, 0.83, 0.95, 0.95, 0, backZ, shell);
      k.facePanel('u', 0.951, 0.05, 0, 0.95, h * 0.07, t.ink, 0.7);
      for (const u of [0.08, 0.37, 0.66]) k.facePanel('u', 0.951, u, h * 0.16, u + 0.26, h * 0.82, loungeFace(shade(shell, 1.07), 'u', 0.55), 1, true);
    }
    k.box(0.04, 0.82, 0.96, 0.96, h * 0.9, h * 1.02, trim);
    if (!k.plan) {
      k.poly([[0.953, 0.62, 0], [0.953, 0.95, 0], [0.953, 0.95, h * 1.02], [0.953, 0.82, h * 1.02], [0.953, 0.82, seat], [0.953, 0.62, seat]], loungeFace(trim, 'v', 0.8), 1, true);
    }
    return null;
  },
  stool: (k, h) => {
    const t = k.t;
    const seatZ = h * (0.8 + k.rnd(2) * 0.04);
    const ringZ = h * 0.3;
    const metal = shade(t.dark, 0.8);
    const chrome = shade(t.light, 0.85);
    const r = 0.14;
    const low = k.rnd(4) < 0.35;
    const mid = Math.PI * 1.25 + (k.rnd(5) - 0.5) * Math.PI * 0.4;
    const backA = [mid - Math.PI * 0.3, mid + Math.PI * 0.3];
    const backZ = seatZ + h * 0.44;
    if (!k.plan) {
      k.disc(0.5, 0.5, 0.17, 0, t.ink, 1, true);
      k.disc(0.5, 0.49, 0.13, h * 0.025, shade(t.dark, 1.1), 1);
      k.band(0.5, 0.49, 0.13, h * 0.025, shade(t.dark, 1.5), 0.45);
      const back: Array<[number, number, number]> = [];
      for (let i = 0; i <= 6; i += 1) {
        const a = (3 * Math.PI) / 4 + (i / 6) * Math.PI;
        back.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, ringZ]);
      }
      k.line(back, shade(chrome, 0.8), 1.5, 0.8);
      k.line([[0.5, 0.5, h * 0.03], [0.5, 0.5, seatZ]], metal, 3.5, 1);
      k.line([[0.488, 0.505, h * 0.05], [0.488, 0.505, seatZ - h * 0.04]], chrome, 1, 0.4);
      k.line([[0.5, 0.5, ringZ], [0.5 + r * 0.7, 0.5 + r * 0.7, ringZ]], metal, 1, 1);
      k.band(0.5, 0.5, r, ringZ, chrome, 0.9, 1.5);
      k.disc(0.5, 0.5, 0.09, seatZ - h * 0.01, t.ink, 1);
    }
    k.cyl(0.5, 0.5, 0.2, seatZ, seatZ + h * 0.14, t.base, { sides: 16 });
    if (!k.plan) k.band(0.5, 0.5, 0.2, seatZ + h * 0.035, shade(t.base, 0.55), 0.8, 1.5);
    k.disc(0.49, 0.49, 0.14, seatZ + h * 0.142, shade(t.base, 1.08), 0.8);
    k.disc(0.49, 0.49, 0.025, seatZ + h * 0.143, shade(t.base, 0.78), 0.9);
    // A low back on some: two struts off the far rim and a curved pad on them.
    if (low) {
      const pad: Array<[number, number, number]> = [];
      for (let i = 0; i <= 6; i += 1) {
        const a = backA[0]! + (i / 6) * (backA[1]! - backA[0]!);
        pad.push([0.5 + Math.cos(a) * 0.19, 0.5 + Math.sin(a) * 0.19, backZ]);
      }
      if (!k.plan) {
        for (const a of backA) {
          const b = a + (a === backA[0] ? 0.12 : -0.12);
          const p: [number, number] = [0.5 + Math.cos(b) * 0.17, 0.5 + Math.sin(b) * 0.17];
          k.line([[p[0], p[1], seatZ + h * 0.13], [p[0], p[1], backZ - h * 0.1]], metal, 2, 1);
        }
        const low2 = pad.map(([u, v]): [number, number, number] => [u, v, backZ - h * 0.17]).reverse();
        k.poly([...pad, ...low2], loungeFace(t.base, 'u', 0.9), 1, true);
        k.line(pad, shade(t.base, 1.25), 1, 0.55);
      } else {
        k.line(pad, shade(t.base, 0.7), 3, 1);
      }
    }
    return null;
  },
  terminal: (k, h, glow) => {
    const t = k.t;
    // A foot plate, a chamfered step, then the column.
    k.box(0.27, 0.33, 0.73, 0.69, 0, h * 0.035, shade(t.ink, 1.15), { crown: false });
    k.box(0.33, 0.39, 0.67, 0.64, h * 0.035, h * 0.09, t.dark);
    const zc = h * 0.78;
    k.box(0.39, 0.43, 0.61, 0.6, h * 0.09, zc, t.base);
    if (!k.plan) {
      // The service door with its lock, a grille at the foot, a recessed seam on the east side.
      k.facePanel('u', 0.601, 0.415, h * 0.3, 0.585, h * 0.68, shade(t.base, 0.62), 0.5, true);
      k.facePanel('u', 0.602, 0.55, h * 0.47, 0.565, h * 0.53, t.light, 0.75);
      officeDashes(k, [0, 1, 2].map((i): [[number, number, number], [number, number, number]] => [[0.44, 0.602, h * (0.14 + i * 0.045)], [0.56, 0.602, h * (0.14 + i * 0.045)]]), t.ink, 0.6);
      k.facePanel('v', 0.611, 0.47, h * 0.09, 0.51, zc, t.dark, 0.9);
    }
    const u0 = 0.26;
    const u1 = 0.74;
    const v0 = 0.3;
    const v1 = 0.7;
    const zf = h * 0.92;
    const zk = h * 1.14;
    const zAt = (v: number) => zk + ((zf - zk) * (v - v0)) / (v1 - v0);
    const slope = (a: number, b: number, c: number, d: number, lift = 0.002): [number, number, number][] => [[a, c, zAt(c) + lift], [b, c, zAt(c) + lift], [b, d, zAt(d) + lift], [a, d, zAt(d) + lift]];
    if (!k.plan) {
      k.poly([[u0, v1, zc], [u1, v1, zc], [u1, v1, zf], [u0, v1, zf]], shade(t.base, 0.782 * 0.92));
      k.poly([[u1, v1, zc], [u1, v0, zc], [u1, v0, zk], [u1, v1, zf]], shade(t.base, 0.688 * 0.92));
      // A shadow line under the head where it overhangs the column.
      k.line([[0.39, 0.6, zc - h * 0.01], [0.61, 0.6, zc - h * 0.01], [0.61, 0.43, zc - h * 0.01]], t.ink, 1, 0.45);
    }
    k.poly(slope(u0, u1, v0, v1, 0), officeTop(k, t.base, 1.04));
    if (k.plan) k.line([[u0, v0, zk], [u1, v0, zk], [u1, v1, zf], [u0, v1, zf], [u0, v0, zk]], t.ink, 1, 0.5);
    else {
      k.line([[u0, v0, zk], [u1, v0, zk], [u1, v0, zc], [u1, v1, zc], [u0, v1, zc], [u0, v1, zf], [u0, v0, zk]], t.ink, 1, 0.5);
      k.line([[u0, v1, zf], [u0, v0, zk], [u1, v0, zk], [u1, v1, zf], [u0, v1, zf]], shade(t.base, 1.35), 1, 0.42);
    }
    // The screen in its bezel on the slope, a keypad in front of it.
    k.poly(slope(0.3, 0.7, 0.36, 0.58), shade(t.ink, 0.95), 1);
    const scr = slope(0.32, 0.68, 0.38, 0.56, 0.004);
    k.poly(scr, glow ?? shade(t.ink, 0.5), glow ? 0.92 : 1);
    if (glow !== null) {
      k.poly(slope(0.34, 0.66, 0.395, 0.425, 0.006), shade(glow, 0.7), 0.8);
      officeDashes(k, [0, 1, 2].map((i): [[number, number, number], [number, number, number]] => {
        const v = 0.45 + i * 0.035;
        return [[0.35, v, zAt(v) + 0.006], [0.35 + 0.28 * (0.3 + k.rnd(12 + i) * 0.7), v, zAt(v) + 0.006]];
      }), shade(glow, 0.5), 0.7);
    } else {
      k.poly([[0.42, 0.38, zAt(0.38) + 0.006], [0.5, 0.38, zAt(0.38) + 0.006], [0.44, 0.56, zAt(0.56) + 0.006], [0.36, 0.56, zAt(0.56) + 0.006]], GLASS, 0.14);
    }
    k.poly(slope(0.34, 0.66, 0.605, 0.68), t.ink, 0.85);
    officeDashes(k, [0.625, 0.655].flatMap((v) => [0, 1, 2, 3, 4].map((i): [[number, number, number], [number, number, number]] => [[0.365 + i * 0.058, v, zAt(v) + 0.006], [0.395 + i * 0.058, v, zAt(v) + 0.006]])), t.light, 0.5);
    // A hood over the top of the screen against the glare.
    k.box(0.27, 0.3, 0.73, 0.35, zAt(0.35), zk + h * 0.06, shade(t.base, 0.92));
    if (!k.plan) {
      // The printer slot and port on the head's front, a card reader on its east side.
      k.facePanel('u', 0.701, 0.56, zc + (zf - zc) * 0.3, 0.68, zc + (zf - zc) * 0.55, t.ink, 0.9);
      k.line([[0.36, 0.702, zc + (zf - zc) * 0.45], [0.5, 0.702, zc + (zf - zc) * 0.45]], shade(t.ink, 0.7), 1, 0.9);
      if (k.rnd(15) < 0.35) k.poly([[0.4, 0.703, zc + (zf - zc) * 0.45], [0.47, 0.703, zc + (zf - zc) * 0.45], [0.465, 0.71, zc - h * 0.12], [0.44, 0.715, zc - h * 0.16], [0.405, 0.71, zc - h * 0.1]], officeCap(shade(t.light, 1.15)), 1);
      k.box(0.74, 0.46, 0.77, 0.58, zc + h * 0.02, zc + h * 0.13, shade(t.ink, 1.25), { crown: false });
      k.line([[0.755, 0.48, zc + h * 0.131], [0.755, 0.56, zc + h * 0.131]], t.ink, 1, 0.9);
      k.facePanel('v', 0.771, 0.5, zc + h * 0.07, 0.53, zc + h * 0.1, glow ?? t.light, glow ? 1 : 0.6);
    }
    if (k.rnd(13) < 0.3) k.poly([[0.6, 0.52, zAt(0.52) + 0.008], [0.69, 0.51, zAt(0.51) + 0.008], [0.7, 0.58, zAt(0.58) + 0.008], [0.61, 0.59, zAt(0.59) + 0.008]], officeCap(shade(t.light, 1.15)), 1);
    if (!k.plan && k.rnd(14) < 0.35) {
      k.line([[u1, 0.62, zc + 0.01], [0.765, 0.64, h * 0.45], [0.76, 0.67, 0.01], [0.71, 0.69, 0]], t.ink, 1, 0.8);
    }
    return glow ? k.pts(scr) : null;
  },
  server: (k, h, glow) => {
    const t = k.t;
    k.box(0.17, 0.12, 0.83, 0.88, 0, h * 0.04, t.ink, { crown: false });
    k.box(0.15, 0.1, 0.85, 0.9, h * 0.04, h * 0.95, t.base);
    const led = glow ?? t.light;
    if (!k.plan) {
      // The door: smoked glass over a stack of units, each with its status light.
      const zlo = h * 0.08;
      const zhi = h * 0.9;
      k.facePanel('u', 0.901, 0.19, zlo, 0.81, zhi, shade(t.ink, 0.62), 1, true);
      let z = zlo + h * 0.02;
      let i = 0;
      while (z < zhi - h * 0.05) {
        const r = k.rnd(40 + i);
        const size = r < 0.4 ? 0.06 : r < 0.8 ? 0.1 : 0.17;
        const top = Math.min(z + size * h, zhi - h * 0.02);
        if (k.rnd(60 + i) > 0.12) {
          k.facePanel('u', 0.902, 0.21, z, 0.79, top, shade(t.base, 0.66), 1);
          if (size > 0.07) k.line([[0.22, 0.903, top - h * 0.006], [0.78, 0.903, top - h * 0.006]], t.light, 1, 0.3);
          const zm = (z + top) / 2;
          k.facePanel('u', 0.903, 0.735, zm - h * 0.012, 0.765, zm + h * 0.012, led, glow ? 1 : 0.7);
          if (k.rnd(80 + i) < 0.45) k.facePanel('u', 0.903, 0.69, zm - h * 0.012, 0.715, zm + h * 0.012, glow ? shade(glow, 0.8) : t.dark, 1);
        }
        z = top + h * 0.018;
        i += 1;
      }
      if (k.rnd(90) < 0.4) {
        const zc = zlo + h * (0.3 + k.rnd(91) * 0.35);
        const cols = [0x4f7394, 0x94784f, 0x5f7f4f];
        // Patch leads run port to port between units: long, uneven droops that cross, so they read as cable and not as letters.
        for (let j = 0; j < 4; j += 1) {
          const u = 0.25 + j * 0.1 + k.rnd(92 + j) * 0.03;
          const w = 0.12 + k.rnd(96 + j) * 0.12;
          const sag = h * (0.04 + k.rnd(99 + j) * 0.06);
          const z1 = zc + h * (k.rnd(103 + j) - 0.5) * 0.12;
          const pts: [number, number, number][] = [];
          for (let q = 0; q <= 4; q += 1) {
            const f = q / 4;
            pts.push([Math.min(0.79, u + w * f), 0.904, zc + (z1 - zc) * f - sag * Math.sin(Math.PI * f)]);
          }
          k.line(pts, cols[j % 3]!, 1, 0.85);
        }
      }
      k.poly([[0.3, 0.905, zlo], [0.42, 0.905, zlo], [0.6, 0.905, zhi], [0.48, 0.905, zhi]], GLASS, 0.07);
      k.line([[0.825, 0.905, h * 0.42], [0.825, 0.905, h * 0.6]], t.light, 2, 0.9);
      // East side: a seam, a louvre block, a rating plate.
      k.line([[0.851, 0.5, h * 0.05], [0.851, 0.5, h * 0.94]], t.ink, 1, 0.3);
      for (let j = 0; j < 5; j += 1) k.line([[0.852, 0.18, h * (0.66 + j * 0.045)], [0.852, 0.42, h * (0.66 + j * 0.045)]], t.ink, 1, 0.45);
      k.facePanel('v', 0.852, 0.62, h * 0.72, 0.78, h * 0.8, t.light, 0.45);
    }
    k.box(0.14, 0.09, 0.86, 0.91, h * 0.95, h, shade(t.base, 1.05));
    // Two exhaust fans in the roof: grille, hub, and the blades as one set of strokes.
    for (const u of [0.34, 0.66]) {
      k.disc(u, 0.55, 0.13, h * 1.002, shade(t.ink, 1.1), 0.75, true);
      k.disc(u, 0.55, 0.04, h * 1.004, shade(t.base, 1.1), 1);
    }
    officeDashes(k, [0.34, 0.66].flatMap((u) => [0, 1, 2, 3].map((i): [number, number, number][] => {
      const a = (i * Math.PI) / 4 + k.rnd(u < 0.5 ? 93 : 94) * 0.8;
      return [[u - Math.cos(a) * 0.115, 0.55 - Math.sin(a) * 0.115, h * 1.003], [u + Math.cos(a) * 0.115, 0.55 + Math.sin(a) * 0.115, h * 1.003]];
    })), shade(t.base, 0.95), 0.7);
    // A cable tray across the back of the roof, with the bundle lying in it.
    k.box(0.2, 0.12, 0.8, 0.21, h, h + 0.03, shade(t.ink, 1.1), { crown: false });
    k.line([[0.22, 0.155, h + 0.031], [0.78, 0.155, h + 0.031]], 0x4f7394, 1, 0.8);
    k.line([[0.22, 0.18, h + 0.031], [0.78, 0.18, h + 0.031]], shade(t.ink, 0.7), 2, 0.9);
    k.line([[0.16, 0.885, h * 1.004], [0.84, 0.885, h * 1.004]], led, 1, k.plan ? 0.9 : 0.5);
    if (glow === null) return null;
    return k.plan ? k.pts(officeRect(0.2, 0.84, 0.8, 0.9, h)) : k.pts([[0.72, 0.906, h * 0.12], [0.78, 0.906, h * 0.12], [0.78, 0.906, h * 0.86], [0.72, 0.906, h * 0.86]]);
  },
  locker: (k, h) => {
    const t = k.t;
    const tall = h >= 0.75;
    k.box(0.11, 0.16, 0.89, 0.84, 0, h * 0.05, t.ink, { crown: false });
    k.box(0.1, 0.15, 0.9, 0.85, h * 0.05, h * 0.94, t.base);
    const w = 0.8 / 3;
    if (tall) {
      const open = k.rnd(20) < 0.3 ? Math.floor(k.rnd(21) * 3) : -1;
      const lock = k.rnd(22) < 0.35 ? Math.floor(k.rnd(23) * 3) : -1;
      if (!k.plan) {
        for (const u of [0.1 + w, 0.1 + 2 * w]) k.line([[u, 0.852, h * 0.06], [u, 0.852, h * 0.93]], t.ink, 1, 0.7);
        for (let d = 0; d < 3; d += 1) {
          const u0 = 0.1 + d * w;
          const u1 = u0 + w;
          const uc = (u0 + u1) / 2;
          if (d === open) {
            k.facePanel('u', 0.852, u0 + 0.012, h * 0.07, u1 - 0.012, h * 0.93, shade(t.ink, 0.5), 1);
            k.facePanel('u', 0.853, u0 + 0.012, h * 0.76, u1 - 0.012, h * 0.78, t.dark, 1);
            const jc = [0x4a4541, 0x5e4b3b, 0x4a5043][Math.floor(k.rnd(24) * 3)]!;
            k.poly([[uc - 0.06, 0.853, h * 0.72], [uc + 0.06, 0.853, h * 0.72], [uc + 0.08, 0.853, h * 0.34], [uc - 0.07, 0.853, h * 0.32]], jc, 1);
            continue;
          }
          k.facePanel('u', 0.852, u0 + 0.025, h * 0.09, u1 - 0.025, h * 0.91, t.light, 0.05 + k.rnd(40 + d) * 0.1);
          for (const zv of [0.8, 0.835, 0.87, 0.14, 0.175]) k.line([[u0 + 0.055, 0.853, h * zv], [u1 - 0.055, 0.853, h * zv]], t.ink, 1, 0.75);
          k.facePanel('u', 0.853, uc - 0.035, h * 0.7, uc + 0.035, h * 0.74, t.light, 0.6);
          k.line([[u1 - 0.045, 0.853, h * 0.46], [u1 - 0.045, 0.853, h * 0.55]], t.light, 1, 0.8);
          if (d === lock) k.facePanel('u', 0.854, u1 - 0.06, h * 0.36, u1 - 0.03, h * 0.41, shade(t.ink, 0.7), 1);
          // A sticker or a scuff here and there: somebody's locker.
          const wear = k.rnd(44 + d);
          if (wear < 0.14) {
            const zs = h * (0.22 + k.rnd(48 + d) * 0.4);
            k.facePanel('u', 0.854, u0 + 0.05, zs, u0 + 0.1, zs + h * 0.05, [0x8a5a4a, 0x4f6a7a, 0x857747][Math.floor(k.rnd(52 + d) * 3)]!, 0.9);
          } else if (wear < 0.3) {
            const zs = h * (0.15 + k.rnd(48 + d) * 0.3);
            k.poly([[u0 + 0.04, 0.854, zs], [u0 + 0.12, 0.854, zs + h * 0.04], [u0 + 0.11, 0.854, zs + h * 0.07], [u0 + 0.05, 0.854, zs + h * 0.05]], t.ink, 0.14);
          }
        }
        k.line([[0.901, 0.5, h * 0.06], [0.901, 0.5, h * 0.93]], t.ink, 1, 0.3);
        if (k.rnd(29) < 0.3) {
          const nv = 0.24 + k.rnd(30) * 0.4;
          const nz = h * (0.5 + k.rnd(31) * 0.2);
          k.poly([[0.902, nv, nz], [0.902, nv + 0.12, nz + 0.01], [0.902, nv + 0.12, nz + h * 0.17], [0.902, nv, nz + h * 0.16]], officeCap(shade(t.light, 1.05)), 0.85);
        }
        if (open >= 0) {
          const u0 = 0.1 + open * w;
          const th = 0.5;
          const ue = u0 + w * Math.cos(th);
          const ve = 0.85 + w * Math.sin(th);
          const lp = (s: number, z: number): [number, number, number] => [u0 + (ue - u0) * s, 0.85 + (ve - 0.85) * s, z];
          k.poly([lp(0, h * 0.07), lp(1, h * 0.07), lp(1, h * 0.93), lp(0, h * 0.93)], shade(t.base, 0.8), 1, true);
          for (const zv of [0.8, 0.835, 0.87, 0.14, 0.175]) k.line([lp(0.2, h * zv), lp(0.8, h * zv)], t.ink, 1, 0.75);
          k.line([lp(0.86, h * 0.46), lp(0.86, h * 0.55)], t.light, 1, 0.8);
        }
      } else {
        for (const u of [0.1 + w, 0.1 + 2 * w]) k.line([[u, 0.15, h], [u, 0.85, h]], t.ink, 1, 0.6);
      }
      k.box(0.09, 0.14, 0.91, 0.86, h * 0.94, h, shade(t.base, 1.05));
      k.poly(officeRect(0.14, 0.19, 0.86, 0.81, h + 0.001), officeTop(k, t.base, 0.99), 1);
      if (k.plan) {
        for (const u of [0.1 + w, 0.1 + 2 * w]) k.line([[u, 0.15, h], [u, 0.85, h]], t.ink, 1, 0.5);
        k.line([[0.1, 0.855, h], [0.9, 0.855, h]], t.ink, 2, 0.7);
        if (open >= 0) {
          const u0 = 0.1 + open * w;
          k.line([[u0, 0.86, h], [u0 + w * Math.cos(0.5), 0.86 + w * Math.sin(0.5), h]], t.ink, 2, 0.8);
          k.line([[u0 + w * Math.cos(0.5), 0.86 + w * Math.sin(0.5), h], [u0 + w * 0.97, 0.86 + w * 0.2, h], [u0 + w, 0.86, h]], t.ink, 1, 0.45);
        }
      }
      // On top: nothing, a carton (sometimes two), or a kit bag slung up there.
      const clutter = k.rnd(25);
      if (clutter < 0.46) {
        const bu = 0.3 + k.rnd(26) * 0.35;
        const bv = 0.4 + k.rnd(27) * 0.2;
        const rot = (k.rnd(28) - 0.5) * 0.5;
        const mid = (top: [number, number, number][], z: number, a: number, b: number, c: number, d: number): [number, number, number][] => [[(top[a]![0] + top[b]![0]) / 2, (top[a]![1] + top[b]![1]) / 2, z], [(top[c]![0] + top[d]![0]) / 2, (top[c]![1] + top[d]![1]) / 2, z]];
        if (clutter < 0.3) {
          const box = 0x7a6750;
          const top = officeSlab(k, bu, bv, 0.13, 0.1, rot, h, h + 0.13, box);
          k.line(mid(top, h + 0.132, 0, 3, 1, 2), shade(box, 1.25), 2, 0.7);
          if (clutter < 0.1) {
            const top2 = officeSlab(k, bu + 0.02, bv - 0.015, 0.095, 0.075, rot + 0.35, h + 0.13, h + 0.22, shade(box, 1.1));
            k.line(mid(top2, h + 0.222, 0, 3, 1, 2), shade(box, 1.35), 1, 0.7);
          }
        } else {
          // A kit bag: a duffel lying along its length, soft-topped, its zip along the crown and the straps flopped over.
          const bag = [0x5d6450, 0x6b5a45, 0x505a68][Math.floor(k.rnd(35) * 3)]!;
          const c = Math.cos(rot);
          const sn = Math.sin(rot);
          const P = (du: number, dv: number, z: number): [number, number, number] => [bu + du * c - dv * sn, bv + du * sn + dv * c, z];
          officeSlab(k, bu, bv, 0.17, 0.075, rot, h, h + 0.06, shade(bag, 0.9), false);
          officeSlab(k, bu, bv, 0.16, 0.05, rot, h + 0.06, h + 0.1, bag);
          k.line([P(-0.13, 0, h + 0.101), P(0.13, 0, h + 0.101)], shade(bag, 1.4), 1, 0.6);
          k.line([P(-0.05, 0.06, h + 0.07), P(-0.035, 0.01, h + 0.135), P(0.035, 0.01, h + 0.135), P(0.05, 0.06, h + 0.07)], shade(bag, 0.7), 2, 0.9);
        }
      }
    } else {
      // Waist height: a bank of drawers.
      const pull = k.rnd(20) < 0.35 ? Math.floor(k.rnd(21) * 9) : -1;
      const rows = 3;
      const zb = h * 0.07;
      const zh = h * 0.92;
      const dz = (zh - zb) / rows;
      if (!k.plan) {
        for (let r = 1; r < rows; r += 1) k.line([[0.105, 0.852, zb + r * dz], [0.895, 0.852, zb + r * dz]], t.ink, 1, 0.6);
        for (const u of [0.1 + w, 0.1 + 2 * w]) k.line([[u, 0.852, h * 0.06], [u, 0.852, zh]], t.ink, 1, 0.6);
        for (let d = 0; d < 9; d += 1) {
          const col = d % 3;
          const row = Math.floor(d / 3);
          const uc = 0.1 + (col + 0.5) * w;
          const z = zb + (row + 0.62) * dz;
          if (d === pull) {
            k.facePanel('u', 0.853, uc - w / 2 + 0.008, zb + row * dz + 0.003, uc + w / 2 - 0.008, zb + (row + 1) * dz - 0.003, shade(t.ink, 0.5), 1);
            continue;
          }
          k.facePanel('u', 0.853, uc - 0.03, z + dz * 0.12, uc + 0.03, z + dz * 0.26, t.light, 0.6);
          k.line([[uc - 0.04, 0.853, z - dz * 0.1], [uc + 0.04, 0.853, z - dz * 0.1]], t.light, 1, 0.9);
        }
        k.line([[0.901, 0.5, h * 0.06], [0.901, 0.5, h * 0.93]], t.ink, 1, 0.3);
      }
      k.box(0.09, 0.14, 0.91, 0.86, h * 0.94, h, shade(t.base, 1.05));
      if (k.plan) for (const u of [0.1 + w, 0.1 + 2 * w]) k.line([[u, 0.15, h], [u, 0.85, h]], t.ink, 1, 0.5);
      if (pull >= 0) {
        const col = pull % 3;
        const row = Math.floor(pull / 3);
        const u0 = 0.1 + col * w + 0.012;
        const u1 = u0 + w - 0.024;
        const z0 = zb + row * dz + 0.004;
        const z1 = zb + (row + 1) * dz - 0.004;
        k.box(u0, 0.85, u1, 0.97, z0, z1, shade(t.base, 0.98), { crown: false });
        k.poly(officeRect(u0 + 0.015, 0.855, u1 - 0.015, 0.96, z1 + 0.001), shade(t.ink, 0.7), 1);
        for (const v of [0.88, 0.92]) k.line([[u0 + 0.02, v, z1 + 0.002], [u1 - 0.02, v, z1 + 0.002]], officeCap(shade(t.light, 1.1)), 1, 0.8);
      }
      // On top: loose paper, or a document tray with files in it.
      const top = k.rnd(25);
      if (top < 0.4) {
        const pu = 0.2 + k.rnd(26) * 0.5;
        k.poly(officeRect(pu, 0.35, pu + 0.16, 0.58, h + 0.02), officeCap(officeTop(k, t.light, 1.14)), 1, true);
      } else if (top < 0.65) {
        const pu = 0.18 + k.rnd(26) * 0.45;
        k.box(pu, 0.3, pu + 0.2, 0.58, h * 1.0, h * 1.0 + 0.05, shade(t.ink, 1.2), { crown: false });
        k.poly(officeRect(pu + 0.02, 0.33, pu + 0.18, 0.55, h + 0.035), officeCap(officeTop(k, t.light, 1.1)), 1);
        k.line([[pu + 0.02, 0.5, h + 0.051], [pu + 0.18, 0.5, h + 0.051]], shade(t.ink, 1.2), 2, 1);
      }
    }
    return null;
  },
  vending: (k, h, glow) => {
    const t = k.t;
    const tall = h >= 0.75;
    if (!tall) return officeCounterCase(k, h, glow);
    k.box(0.12, 0.17, 0.88, 0.83, 0, h * 0.04, t.ink, { crown: false });
    k.box(0.1, 0.15, 0.9, 0.85, h * 0.04, h, t.base);
    const v = 0.851;
    const wz0 = h * 0.34;
    const wz1 = h * 0.82;
    if (!k.plan) {
      // The window: frame, lit or dark back, shelves of stock, glass.
      k.facePanel('u', v, 0.14, wz0 - h * 0.012, 0.63, wz1 + h * 0.012, t.ink, 1);
      k.facePanel('u', v + 0.001, 0.15, wz0, 0.62, wz1, shade(t.ink, 0.55), 1);
      if (glow !== null) k.facePanel('u', v + 0.001, 0.15, wz0, 0.62, wz1, glow, 0.42);
      const shelves = tall ? 4 : 2;
      const stock = [t.accent, t.light, shade(t.base, 1.15), 0x94574a, 0x4f6f8f, 0x6a7f4c];
      const dz = (wz1 - wz0) / shelves;
      for (let s = 0; s < shelves; s += 1) {
        const z0 = wz0 + s * dz;
        k.line([[0.15, v + 0.002, z0 + dz * 0.1], [0.62, v + 0.002, z0 + dz * 0.1]], t.dark, 1, 0.9);
        for (let i = 0; i < 5; i += 1) {
          if (k.rnd(100 + s * 7 + i) < 0.22) continue;
          const u = 0.175 + i * 0.09;
          const col = stock[Math.floor(k.rnd(200 + s * 7 + i) * stock.length)]!;
          k.facePanel('u', v + 0.003, u, z0 + dz * 0.14, u + 0.055, z0 + dz * (0.6 + k.rnd(300 + s + i) * 0.22), officeCap(col), 0.95);
        }
      }
      k.poly([[0.26, v + 0.004, wz0], [0.34, v + 0.004, wz0], [0.46, v + 0.004, wz1], [0.38, v + 0.004, wz1]], GLASS, 0.14);
      // The lamp strip across the top of the window, lit only when the machine is.
      if (glow !== null) k.facePanel('u', v + 0.004, 0.16, wz1 - h * 0.05, 0.61, wz1 - h * 0.01, glow, 0.9);
      if (k.rnd(32) < 0.12) {
        k.poly([[0.3, v + 0.005, wz0 + (wz1 - wz0) * 0.45], [0.48, v + 0.005, wz0 + (wz1 - wz0) * 0.5], [0.47, v + 0.005, wz0 + (wz1 - wz0) * 0.72], [0.29, v + 0.005, wz0 + (wz1 - wz0) * 0.67]], officeCap(shade(t.light, 1.2)), 1);
      }
      // The control column: a readout, a keypad, a card slot.
      k.facePanel('u', v, 0.67, h * 0.72, 0.85, h * 0.8, glow ?? shade(t.ink, 0.6), glow ? 0.9 : 1, true);
      k.facePanel('u', v, 0.69, h * 0.5, 0.83, h * 0.67, shade(t.ink, 0.85), 1);
      for (const zr of [0.545, 0.585, 0.625]) k.line([[0.71, v + 0.001, h * zr], [0.81, v + 0.001, h * zr]], t.light, 1, 0.55);
      k.facePanel('u', v, 0.72, h * 0.42, 0.8, h * 0.45, t.ink, 1);
      // The dispenser: a dark bay with its flap.
      k.facePanel('u', v, 0.16, h * 0.1, 0.6, h * 0.25, shade(t.ink, 0.6), 1, true);
      k.facePanel('u', v + 0.001, 0.17, h * 0.1, 0.59, h * 0.17, shade(t.base, 0.62), 1);
      k.line([[0.16, v + 0.002, h * 0.26], [0.6, v + 0.002, h * 0.26]], t.light, 1, 0.5);
      // East side: a hinge seam at the front, a vent at the foot.
      k.line([[0.901, 0.8, h * 0.05], [0.901, 0.8, h * 0.98]], t.ink, 1, 0.45);
      k.facePanel('v', 0.901, 0.24, h * 0.32, 0.72, h * 0.9, shade(t.ink, 1.1), 0.35);
      k.poly([[0.901, 0.24, h * 0.52], [0.901, 0.72, h * 0.78], [0.901, 0.72, h * 0.88], [0.901, 0.24, h * 0.62]], t.light, 0.3);
      for (let j = 0; j < 3; j += 1) k.line([[0.901, 0.3, h * (0.09 + j * 0.04)], [0.901, 0.55, h * (0.09 + j * 0.04)]], t.ink, 1, 0.45);
    }
    // The header box stands proud of the front, its logo lit when the machine is.
    k.box(0.1, 0.85, 0.9, 0.885, h * 0.85, h, shade(t.accent, 0.72));
    k.facePanel('u', 0.886, 0.2 + k.rnd(30) * 0.2, h * 0.895, 0.5 + k.rnd(31) * 0.2, h * 0.94, glow ? shade(glow, 0.9) : t.light, glow ? 0.7 : 0.55);
    // The roof: a service lid inset from the edge, a vent grille along the back.
    k.poly(officeRect(0.15, 0.2, 0.85, 0.78, h + 0.001), officeTop(k, t.base, 1.05), 1);
    k.line([[0.15, 0.78, h + 0.002], [0.85, 0.78, h + 0.002], [0.85, 0.2, h + 0.002]], t.ink, 1, 0.3);
    officeDashes(k, [0, 1, 2, 3, 4, 5].map((i): [number, number, number][] => [[0.27 + i * 0.09, 0.26, h + 0.003], [0.27 + i * 0.09, 0.38, h + 0.003]]), t.ink, 0.45);
    if (k.plan) {
      k.poly(officeRect(0.14, 0.76, 0.63, 0.84, h), t.ink, 0.55);
      k.poly(officeRect(0.68, 0.76, 0.86, 0.84, h), t.dark, 0.9);
      k.line([[0.12, 0.84, h], [0.88, 0.84, h]], glow ?? t.light, 2, 0.8);
    }
    if (glow === null) return null;
    // The light falls from the window onto the floor in front of it: a pool at the foot, not a haze over the roof.
    return k.plan ? k.pts(officeRect(0.15, 0.8, 0.62, 0.85, h)) : k.pool(0.38, 0.93, 0.14);
  },
  cooler: (k, h) => {
    const t = k.t;
    k.box(0.36, 0.36, 0.64, 0.64, 0, h * 0.8, t.base);
    if (!k.plan) {
      k.facePanel('u', 0.641, 0.36, 0, 0.64, h * 0.05, t.ink, 0.45);
      k.facePanel('u', 0.641, 0.415, h * 0.36, 0.585, h * 0.64, shade(t.ink, 0.8), 1);
      k.facePanel('u', 0.642, 0.405, h * 0.36, 0.595, h * 0.4, t.light, 0.9);
      k.facePanel('u', 0.642, 0.44, h * 0.55, 0.475, h * 0.6, 0x4f7aa0, 1);
      k.facePanel('u', 0.642, 0.525, h * 0.55, 0.56, h * 0.6, 0xa0584f, 1);
      officeDashes(k, [0, 1, 2].map((i): [number, number, number][] => [[0.44, 0.642, h * (0.12 + i * 0.05)], [0.56, 0.642, h * (0.12 + i * 0.05)]]), t.ink, 0.5);
      k.facePanel('v', 0.641, 0.43, h * 0.28, 0.5, h * 0.72, officeCap(shade(t.light, 1.1)), 0.95, true);
      // A paper cup left under the taps now and then; the power lead down the back corner.
      if (k.rnd(41) < 0.4) k.facePanel('u', 0.646, 0.48 + (k.rnd(42) - 0.5) * 0.06, h * 0.4, 0.515 + (k.rnd(42) - 0.5) * 0.06, h * 0.47, officeCap(shade(t.light, 1.2)), 1, true);
      if (k.rnd(43) < 0.5) k.line([[0.641, 0.4, h * 0.3], [0.655, 0.43, h * 0.12], [0.65, 0.5, 0.004]], shade(t.ink, 0.8), 1, 0.8);
    }
    k.box(0.41, 0.41, 0.59, 0.59, h * 0.8, h * 0.86, shade(t.base, 1.08), { crown: false });
    const zb = h * 0.9;
    const zt = h * 1.42;
    k.cyl(0.5, 0.5, 0.045, h * 0.86, zb, shade(GLASS, 0.8), { sides: 6, ink: false, alpha: 0.8 });
    k.cyl(0.5, 0.5, 0.13, zb, zt, GLASS, { sides: 8, alpha: 0.5 });
    if (!k.plan) {
      const level = zb + (zt - zb) * (0.2 + k.rnd(40) * 0.75);
      const arc = (z: number): [number, number, number][] => {
        const pts: [number, number, number][] = [];
        for (let i = 0; i <= 8; i += 1) {
          const a = -Math.PI / 4 + (i / 8) * Math.PI;
          pts.push([0.5 + Math.cos(a) * 0.13, 0.5 + Math.sin(a) * 0.13, z]);
        }
        return pts;
      };
      k.poly([...arc(zb), ...arc(level).reverse()], shade(GLASS, 0.62), 0.45);
      k.band(0.5, 0.5, 0.13, level, shade(GLASS, 1.1), 0.7);
      k.band(0.5, 0.5, 0.13, zb + (zt - zb) * 0.33, shade(GLASS, 0.75), 0.4);
      k.band(0.5, 0.5, 0.13, zb + (zt - zb) * 0.66, shade(GLASS, 0.75), 0.4);
      k.line([[0.43, 0.6, zb + 0.02], [0.43, 0.6, zt - 0.02]], GLASS, 1, 0.85);
    }
    k.disc(0.5, 0.5, 0.09, zt + 0.001, shade(GLASS, 1.08), 0.7, true);
    k.disc(0.46, 0.46, 0.03, zt + 0.002, GLASS, 0.85);
    if (k.plan) k.disc(0.66, 0.465, 0.03, 0, officeCap(shade(t.light, 1.1)), 1, true);
    return null;
  },
  bin: (k, h) => {
    const t = k.t;
    const body = t.base;
    const kind = k.rnd(1);
    const zt = h * 0.84;
    const lip = homeCap(shade(t.light, 1.06));
    const rAt = (z: number) => 0.185 + (0.21 - 0.185) * (z / zt);
    const P = (a: number, z: number, dr = 0): [number, number, number] => [0.5 + Math.cos(a) * (rAt(z) + dr), 0.5 + Math.sin(a) * (rAt(z) + dr), z];
    homeTaper(k, 0.5, 0.5, 0.185, 0.21, 0, zt, body, 12, h >= 0.9 ? 3 : 2);
    if (!k.plan) {
      // A dark foot, a pressed hoop, and a sheen down the lit side.
      k.band(0.5, 0.5, 0.186, h * 0.03, t.ink, 0.6, 2);
      k.band(0.5, 0.5, rAt(h * 0.22) + 0.002, h * 0.22, homeCap(shade(body, 1.08)), 0.45, 1);
      k.line([P(2.05, h * 0.1, 0.002), P(2.05, zt - h * 0.14, 0.002)], homeCap(shade(body, 1.28)), 2, 0.3);
    }
    if (kind < 0.36) {
      // Open: a bag folded over the rim with its hem hanging in points, or slots round the top.
      const liner = k.rnd(4) < 0.55;
      const bag = k.rnd(5) < 0.5 ? shade(t.ink, 0.95) : homeCap(shade(t.light, 0.92));
      if (!k.plan) {
        if (liner) {
          const top: Array<[number, number, number]> = [];
          const hem: Array<[number, number, number]> = [];
          for (let i = 0; i <= 8; i += 1) {
            const a = -Math.PI / 4 + (i / 8) * Math.PI;
            top.push(P(a, zt, 0.008));
            hem.push(P(a, zt - h * (i % 2 === 0 ? 0.1 + k.rnd(70 + i) * 0.04 : 0.2), 0.005));
          }
          k.poly([...top, ...hem.reverse()], bag, 1, true);
        } else {
          const slots: Array<[number, number, number]> = [];
          for (let i = 0; i < 6; i += 1) {
            const a = -Math.PI / 4 + (i + 0.75) * (Math.PI / 6.5);
            const lo = P(a, zt - h * 0.34, 0.002);
            const hi = P(a, zt - h * 0.14, 0.002);
            if (i % 2 === 0) slots.push(lo, hi);
            else slots.push(hi, lo);
          }
          k.line(slots, shade(t.ink, 0.7), 2, 0.6);
          k.band(0.5, 0.5, rAt(zt) + 0.003, zt - h * 0.06, shade(t.ink, 0.75), 0.8, 2);
        }
      }
      k.disc(0.5, 0.5, 0.224, zt, liner ? shade(bag, 0.9) : shade(lip, 0.875), 1, true);
      k.disc(0.5, 0.5, 0.176, zt + 0.003, shade(t.ink, 0.5), 1);
      // Rubbish: a crumpled sheet, and sometimes a cup lying on it.
      const cu = 0.44 + k.rnd(3) * 0.1;
      const cv = 0.44 + k.rnd(6) * 0.1;
      const zr = zt + 0.004;
      const paper = homeCap(shade(t.light, 1.2));
      k.poly([[cu - 0.08, cv - 0.02, zr], [cu - 0.02, cv - 0.08, zr + 0.03], [cu + 0.07, cv - 0.05, zr], [cu + 0.06, cv + 0.05, zr + 0.02], [cu - 0.03, cv + 0.07, zr]], shade(paper, 0.875), 1, true);
      k.line([[cu - 0.05, cv - 0.01, zr + 0.02], [cu + 0.01, cv + 0.02, zr + 0.03], [cu + 0.04, cv - 0.03, zr + 0.02]], shade(paper, 0.6), 1, 0.6);
      if (k.rnd(2) < 0.5) {
        k.box(0.52, 0.5, 0.64, 0.56, zr, zr + 0.05, shade(t.accent, 1.05), { crown: false });
        k.facePanel('v', 0.641, 0.5, zr, 0.56, zr + 0.05, shade(t.ink, 0.7));
      }
    } else if (kind < 0.68) {
      // Pedal bin: a hinge block behind, a steel lid with a pressed centre, a pedal at the foot.
      k.box(0.44, 0.25, 0.56, 0.3, zt - h * 0.1, zt + h * 0.12, shade(t.ink, 0.95), { crown: false });
      homeTaper(k, 0.5, 0.5, 0.218, 0.212, zt, zt + h * 0.08, lip, 12, 1);
      k.disc(0.5, 0.5, 0.13, zt + h * 0.081, homeCap(shade(lip, 1.02)), 1, true);
      if (!k.plan) {
        k.box(0.43, 0.66, 0.57, 0.72, h * 0.03, h * 0.1, shade(lip, 0.95), { crown: false });
        k.facePanel('u', 0.721, 0.45, h * 0.045, 0.55, h * 0.085, shade(t.ink, 0.8), 0.6);
      }
    } else {
      // Push-flap: a domed top with the flap facing the room.
      const zd = zt + h * 0.2;
      k.band(0.5, 0.5, rAt(zt) + 0.004, zt - h * 0.01, shade(t.ink, 0.8), 0.7, 2);
      homeTaper(k, 0.5, 0.5, 0.215, 0.14, zt, zd, shade(body, 1.12), 12, 1);
      if (!k.plan) {
        const r = (z: number) => 0.215 + (0.14 - 0.215) * ((z - zt) / (zd - zt));
        const Q = (a: number, z: number): [number, number, number] => [0.5 + Math.cos(a) * r(z), 0.5 + Math.sin(a) * r(z), z];
        const za = zt + h * 0.03;
        const zb = zt + h * 0.16;
        k.poly([Q(1.05, za), Q(0.15, za), Q(0.15, zb), Q(1.05, zb)], shade(t.ink, 0.55), 1, true);
        k.poly([Q(0.95, zb - h * 0.02), Q(0.25, zb - h * 0.02), Q(0.25, zb - h * 0.045), Q(0.95, zb - h * 0.045)], homeCap(shade(body, 1.3)), 0.7);
      }
      k.disc(0.5, 0.5, 0.07, zd + 0.002, homeCap(shade(lip, 0.9)), 1);
    }
    return null;
  },
  fountain: (k, h, glow) => {
    const t = k.t;
    const zw = h * 0.42;
    const zl = h * 0.5;
    const stone = shade(t.base, 1.04);
    const pool = shade(GLASS, 0.5);
    const water = glow === null ? pool : greenMix(pool, glow, 0.3);
    const tiers = k.rnd(8) < 0.5 ? 2 : 1;
    const polar = (r: number, a: number, z: number): [number, number, number] => [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, z];
    if (!k.plan) {
      greenDrum(k, 0.5, 0.5, 0.42, 0.42, 0, h * 0.08, t.dark, 12, null, true);
      greenDrum(k, 0.5, 0.5, 0.39, 0.39, h * 0.08, h * 0.42, stone, 12, null, true);
      // Dressed blocks: a course line round the wall, joints staggered above and below it.
      k.band(0.5, 0.5, 0.392, h * 0.25, shade(stone, 0.66), 0.5);
      for (let i = -1; i <= 3; i += 1) {
        const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
        const lo = i % 2 !== 0;
        k.line([polar(0.392, a, lo ? h * 0.09 : h * 0.25), polar(0.392, a, lo ? h * 0.25 : h * 0.41)], shade(stone, 0.66), 1, 0.45);
      }
    }
    // The coping, jointed into stones, the inner wall in shadow, the water inside.
    greenDrum(k, 0.5, 0.5, 0.43, 0.43, h * 0.42, zl, shade(stone, 1.1), 12, shade(stone, 1.12), true);
    for (let i = 0; i < 12; i += 2) {
      const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
      k.line([polar(0.35, a, zl), polar(0.43, a, zl)], shade(stone, 0.78), 1, 0.6);
    }
    const inner: Array<[number, number, number]> = [];
    const surface: Array<[number, number, number]> = [];
    const level = (a: number) => zw + (zl - zw) * Math.max(0, Math.min(1, (Math.cos(a) + Math.sin(a)) / 2.8 + 0.5));
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      inner.push(polar(0.35, a, zl));
      surface.push(polar(0.35, a, level(a)));
    }
    k.poly(inner, shade(stone, 0.55));
    k.poly(surface, water);
    if (!k.plan) {
      // A dark wet line where the water laps the back wall.
      const lap: Array<[number, number, number]> = [];
      for (let i = 0; i <= 8; i += 1) {
        const a = Math.PI * 0.75 + (i / 8) * Math.PI;
        lap.push(polar(0.35, a, level(a) + 0.012));
      }
      k.line(lap, greenMix(shade(stone, 0.4), FOLIAGE, 0.35), 1.5, 0.7);
    }
    const ripple = glow ?? GLASS;
    const ph = k.rnd(3);
    for (const r of [0.27 + ph * 0.03, 0.315]) {
      const ring: Array<[number, number, number]> = [];
      for (let i = 0; i <= 10; i += 1) ring.push(polar(r, -Math.PI * 0.15 + (i / 10) * Math.PI * 1.1, zw + 0.002));
      k.line(ring, ripple, 1, glow === null ? 0.35 : 0.55);
    }
    if (glow !== null) k.disc(0.5, 0.5, 0.2, zw + 0.003, glow, 0.3);
    // The column on its foot, a knop half way, the bowl, water sheeting off the rim.
    if (!k.plan) {
      greenDrum(k, 0.5, 0.5, 0.12, 0.1, zw, zw + h * 0.07, shade(stone, 0.9), 8, shade(stone, 0.95), true);
      greenDrum(k, 0.5, 0.5, 0.075, 0.055, zw + h * 0.07, h * 0.9, stone, 8, null, true);
      k.band(0.5, 0.5, 0.072, h * 0.66, shade(stone, 0.55), 0.6, 2);
      k.band(0.5, 0.5, 0.074, h * 0.68, shade(stone, 1.35), 0.5);
    }
    greenDrum(k, 0.5, 0.5, 0.06, 0.19, h * 0.84, h * 1.0, shade(stone, 0.95), 10, shade(stone, 1.1), true);
    k.disc(0.5, 0.5, 0.14, h * 1.002, glow === null ? pool : greenMix(pool, glow, 0.4), 1);
    if (!k.plan) {
      greenSheet(k, 0.19, h * 1.0, 0.23, zw, GLASS, 0.22);
      k.band(0.5, 0.5, 0.235, zw + 0.004, GLASS, 0.5, 1.5);
    }
    let zTop = h * 1.0;
    if (tiers === 2) {
      // A second, smaller bowl on a slender stem.
      if (!k.plan) greenDrum(k, 0.5, 0.5, 0.04, 0.03, h * 1.0, h * 1.16, stone, 6, null, true);
      greenDrum(k, 0.5, 0.5, 0.03, 0.1, h * 1.12, h * 1.22, shade(stone, 0.95), 8, shade(stone, 1.1), true);
      k.disc(0.5, 0.5, 0.07, h * 1.222, glow === null ? pool : greenMix(pool, glow, 0.4), 1);
      if (!k.plan) greenSheet(k, 0.1, h * 1.22, 0.125, h * 1.004, GLASS, 0.2);
      zTop = h * 1.22;
    }
    if (!k.plan) {
      // The jet: a spout at the crown and its spray.
      const jet = h * (0.14 + k.rnd(7) * 0.14);
      k.line([[0.5, 0.5, zTop], [0.5, 0.5, zTop + jet]], GLASS, 2, 0.6);
      k.disc(0.5, 0.5, 0.04, zTop + jet, glow ?? GLASS, 0.6);
    }
    // The lit water is the fixture, at the water's own level (a ground-level pool
    // registered its bright core on the basin wall below the surface): the near
    // crescent between column and coping, so the core lands on open water and
    // leaves the column and bowls their silhouette.
    if (glow === null) return null;
    const lens: Array<[number, number, number]> = [];
    for (let i = 0; i <= 6; i += 1) lens.push(polar(0.33, -Math.PI * 0.25 + (i / 6) * Math.PI, zw));
    for (let i = 6; i >= 0; i -= 1) lens.push(polar(0.15, -Math.PI * 0.25 + (i / 6) * Math.PI, zw));
    return k.pts(lens);
  },
  plant: (k, h) => {
    const t = k.t;
    const tall = h >= 0.9;
    const potH = tall ? 0.34 : 0.24;
    const r1 = tall ? 0.19 : 0.17;
    const potC = shade(t.dark, 1.02);
    const rimC = homeCap(shade(potC, 1.42));
    const soil = shade(t.ink, 0.55);
    if (k.rnd(4) < 0.35) {
      // A square planter with a lipped rim.
      const e = r1 * 0.88;
      k.box(0.5 - e, 0.5 - e, 0.5 + e, 0.5 + e, 0, potH - 0.035, potC);
      k.box(0.5 - e - 0.016, 0.5 - e - 0.016, 0.5 + e + 0.016, 0.5 + e + 0.016, potH - 0.035, potH, rimC);
      homeFlat(k, 0.5 - e + 0.012, 0.5 - e + 0.012, 0.5 + e - 0.012, 0.5 + e - 0.012, potH + 0.001, soil);
    } else {
      // A tapered pot on its saucer.
      if (!k.plan) k.disc(0.5, 0.5, r1 * 0.72 + 0.035, 0.002, shade(potC, 0.8), 1, true);
      homeTaper(k, 0.5, 0.5, r1 * 0.72, r1, 0, potH, potC, 10, 1);
      k.band(0.5, 0.5, r1, potH - 0.025, rimC, 0.6, 2);
      k.disc(0.5, 0.5, r1 - 0.026, potH + 0.002, soil, 1);
    }
    const leafC = homeMix(FOLIAGE, t.base, 0.3);
    const dead = homeMix(leafC, 0x8a7b52, 0.65);
    const deadOne = k.rnd(9) < 0.4 ? Math.floor(k.rnd(10) * 10) : -1;
    const tone = (i: number, ang: number, lift: number) => homeCap(shade(i === deadOne ? dead : leafC, (0.92 + 0.1 * Math.sin(ang - Math.PI / 4)) * lift * (0.96 + k.rnd(200 + i) * 0.08)));
    const leaves: Array<{ d: number; draw: () => void }> = [];
    const rot = k.rnd(2) * Math.PI * 2;
    const iso = !k.plan;
    if (!tall) {
      // A rosette: a dark heart, outer blades arching over the rim, inner ones standing up.
      k.disc(0.5, 0.5, 0.1, potH + 0.03, shade(leafC, 0.55), 1);
      const n = 11 + Math.floor(k.rnd(1) * 4);
      for (let i = 0; i < n; i += 1) {
        const outer = i % 2 === 0 || i < 4;
        const ang = rot + i * 2.4 + (k.rnd(40 + i) - 0.5) * 0.3;
        const len = outer ? 0.25 + k.rnd(60 + i) * 0.07 : 0.15 + k.rnd(60 + i) * 0.07;
        const droop = i === deadOne ? -0.2 : outer ? -0.02 : 0.24;
        homeLeaf(k, leaves, 0.5, 0.5, potH + 0.03, ang, len, outer ? 0.066 : 0.055, outer ? 0.16 : 0.26, droop, tone(i, ang, outer ? 0.9 : 1.08), 0, iso && outer, false);
      }
    } else if (k.rnd(3) < 0.5) {
      // A fiddle-leaf fig: a leaning trunk, broad leaves spiralling up it.
      if (iso) k.line([[0.5, 0.5, potH], [0.52, 0.51, 0.62], [0.5, 0.49, 0.98]], shade(t.ink, 1.05), 2, 0.95);
      const n = 17;
      for (let i = 0; i < n; i += 1) {
        const s = i / (n - 1);
        const z = 0.44 + s * 0.52;
        const ang = rot + i * 2.4 + (k.rnd(40 + i) - 0.5) * 0.4;
        const len = 0.15 + (1 - s) * 0.08 + k.rnd(60 + i) * 0.03;
        homeLeaf(k, leaves, 0.515 - s * 0.02, 0.505, z, ang, len, 0.085, 0.05, 0.02 + s * 0.09, tone(i, ang, 0.9 + s * 0.16), 1, iso, iso && s < 0.4);
      }
    } else {
      // A palm: three canes, fronds arching out and down from each.
      const crowns: Array<[number, number, number]> = [[0.47, 0.47, 0.96], [0.55, 0.52, 0.8], [0.49, 0.56, 0.64]];
      if (iso) k.line([[0.5, 0.5, potH], [0.47, 0.47, 0.96], [0.5, 0.5, potH], [0.55, 0.52, 0.8], [0.5, 0.5, potH], [0.49, 0.56, 0.64]], shade(t.ink, 1.1), 2, 0.95);
      for (let i = 0; i < 13; i += 1) {
        const c = crowns[i % 3]!;
        const ang = rot + i * 2.4 + (k.rnd(40 + i) - 0.5) * 0.3;
        const len = (i % 3 === 2 ? 0.24 : 0.3) + k.rnd(60 + i) * 0.06;
        homeLeaf(k, leaves, c[0], c[1], c[2], ang, len, 0.08, 0.1, -0.22, tone(i, ang, i % 3 === 0 ? 1.06 : 0.94), 2, iso, iso && i % 3 === 2);
      }
    }
    leaves.sort((a, b) => a.d - b.d);
    for (const l of leaves) l.draw();
    return null;
  },
  decks: (k, h) => {
    const t = k.t;
    const shell = shade(t.base, 0.82);
    const deskZ = h * 0.8;
    const topZ = h * 0.87;
    const gear = h * 0.95;
    k.box(0.06, 0.3, 0.94, 0.8, 0, deskZ, shell);
    if (!k.plan) {
      k.facePanel('u', 0.801, 0.06, 0, 0.94, h * 0.07, t.ink, 0.75);
      for (const [u0, u1] of [[0.1, 0.46], [0.54, 0.9]] as const) {
        k.facePanel('u', 0.801, u0, h * 0.15, u1, h * 0.62, loungeFace(shell, 'u', 0.3), 1, true);
      }
      k.facePanel('u', 0.802, 0.475, h * 0.34, 0.525, h * 0.44, t.light, 0.6);
      k.line([[0.08, 0.801, h * 0.7], [0.92, 0.801, h * 0.7]], t.light, 1, 0.5);
      const su = 0.14 + k.rnd(11) * 0.2;
      k.facePanel('u', 0.802, su, h * 0.3, su + 0.09, h * 0.46, loungeCap(shade(t.accent, 1.2)), 0.85);
      for (let i = 0; i < 3; i += 1) k.facePanel('v', 0.941, 0.4 + i * 0.1, h * 0.25, 0.46 + i * 0.1, h * 0.6, t.ink, 0.55);
    }
    k.box(0.04, 0.27, 0.96, 0.82, deskZ, topZ, t.dark);
    // At the back: a laptop on a riser, its lid to us, or a crate of records with the sleeves standing in it.
    const back = k.rnd(1);
    if (back >= 0.45 && back < 0.8) {
      const cu = 0.38 + (k.rnd(8) - 0.5) * 0.12;
      const zc = topZ + h * 0.16;
      k.box(cu, 0.28, cu + 0.2, 0.37, topZ, zc, shade(t.accent, 0.72));
      k.facePanel('u', 0.31, cu + 0.02, zc, cu + 0.17, zc + h * 0.12, loungeCap(shade(t.light, 0.95)), 1, true);
      k.facePanel('u', 0.34, cu + 0.035, zc, cu + 0.185, zc + h * 0.08, loungeCap(shade(t.accent, 1.25)), 1, true);
    }
    if (back < 0.45) {
      const lu = 0.4 + (k.rnd(8) - 0.5) * 0.1;
      k.poly([[lu, 0.28, topZ + h * 0.06], [lu + 0.2, 0.28, topZ + h * 0.06], [lu + 0.2, 0.36, topZ + h * 0.06], [lu, 0.36, topZ + h * 0.06]], t.ink, 1);
      if (!k.plan) {
        k.poly([[lu + 0.005, 0.3, topZ + h * 0.36], [lu + 0.195, 0.3, topZ + h * 0.36], [lu + 0.195, 0.345, topZ + h * 0.07], [lu + 0.005, 0.345, topZ + h * 0.07]], shade(t.ink, 1.15), 1, true);
        k.disc(lu + 0.1, 0.325, 0.018, topZ + h * 0.22, t.light, 0.6);
      }
    }
    const label = shade(t.accent, 1.1);
    for (const [u0, u1, s] of [[0.09, 0.41, 0], [0.59, 0.91, 1]] as const) {
      k.box(u0, 0.37, u1, 0.77, topZ, gear, shade(t.base, 1.04));
      const cu = (u0 + u1) / 2 - 0.02;
      const cv = 0.57;
      const z = gear + 0.002;
      k.disc(cu, cv, 0.13, z, t.ink, 1);
      if (!k.plan) k.disc(cu, cv, 0.09, z, shade(t.ink, 1.3), 0.5);
      k.disc(cu, cv, 0.035, z, label, 1);
      const parked = k.rnd(2 + s) < 0.4;
      k.line([[u1 - 0.04, 0.42, z], parked ? [u1 - 0.04, 0.7, z] : [cu + 0.05, cv - 0.02, z]], t.light, 1.5, 0.95);
      k.disc(u1 - 0.04, 0.42, 0.022, z, t.light, 1);
      k.disc(u0 + 0.035, 0.735, 0.018, z, shade(t.light, 0.8), 1);
      if (!k.plan) k.line([[u1 - 0.025, 0.58, z], [u1 - 0.025, 0.74, z]], t.ink, 1.5, 0.9);
      if (s === 0) {
        k.box(0.43, 0.39, 0.57, 0.76, topZ, gear + h * 0.02, t.ink);
        const mz = gear + h * 0.022;
        if (!k.plan) {
          for (const u of [0.46, 0.5, 0.54]) k.line([[u, 0.57, mz], [u, 0.7, mz]], shade(t.ink, 1.6), 1, 0.8);
          for (const u of [0.46, 0.5, 0.54]) k.disc(u, 0.57 + k.rnd(7 + u * 10) * 0.12, 0.012, mz, t.light, 1);
          for (const u of [0.46, 0.54]) k.disc(u, 0.45, 0.014, mz, shade(t.light, 0.85), 1);
        } else {
          k.line([[0.46, 0.45, mz], [0.54, 0.45, mz]], t.light, 1, 0.7);
        }
      }
    }
    // Headphones dropped on the front lip, sometimes.
    if (k.rnd(9) < 0.5 && !k.plan) {
      const hu = 0.3 + k.rnd(10) * 0.35;
      k.line([[hu, 0.8, topZ], [hu + 0.03, 0.78, topZ + h * 0.07], [hu + 0.09, 0.79, topZ]], t.light, 1.5, 0.8);
      k.disc(hu, 0.8, 0.025, topZ + 0.004, t.ink, 1);
      k.disc(hu + 0.09, 0.795, 0.025, topZ + 0.004, t.ink, 1);
    }
    return null;
  },
  speakers: (k, h, glow) => {
    const t = k.t;
    const lo = h * 0.5;
    const cap = glow ?? t.light;
    const shift = (k.rnd(2) - 0.5) * 0.05;
    const corner = shade(t.light, 0.95);
    // Floor cable out of the back.
    if (!k.plan) k.line([[0.8, 0.35, 0.002], [0.9, 0.3, 0.002], [0.92, 0.15, 0.002]], t.ink, 1.5, 0.9);
    k.box(0.2, 0.2, 0.8, 0.8, 0, lo - h * 0.01, t.base);
    if (!k.plan) {
      k.facePanel('u', 0.801, 0.24, h * 0.04, 0.76, lo - h * 0.05, shade(t.ink, 0.8), 1);
      if (k.rnd(1) < 0.5) {
        const r = h * 0.18;
        k.faceCircle(0.5, 0.802, h * 0.25, r, 'u', t.dark, 1);
        k.faceCircle(0.5, 0.803, h * 0.25, r * 0.8, 'u', shade(t.ink, 0.6), 1);
        k.faceCircle(0.5, 0.804, h * 0.25, r * 0.3, 'u', cap, glow ? 0.95 : 0.8);
      } else {
        for (const u of [0.36, 0.64]) {
          const r = h * 0.11;
          k.faceCircle(u, 0.802, h * 0.27, r, 'u', t.dark, 1);
          k.faceCircle(u, 0.803, h * 0.27, r * 0.78, 'u', shade(t.ink, 0.6), 1);
          k.faceCircle(u, 0.804, h * 0.27, r * 0.3, 'u', cap, glow ? 0.95 : 0.8);
        }
      }
      k.facePanel('u', 0.803, 0.27, h * 0.06, 0.4, h * 0.1, shade(t.ink, 0.5), 1);
      k.facePanel('u', 0.803, 0.6, h * 0.06, 0.73, h * 0.1, shade(t.ink, 0.5), 1);
      for (const u of [0.2, 0.74]) k.facePanel('u', 0.802, u, lo - h * 0.07, u + 0.06, lo - h * 0.01, corner, 0.9);
      k.facePanel('v', 0.801, 0.42, h * 0.3, 0.58, h * 0.36, t.ink, 0.9);
    }
    const u0 = 0.23 + shift;
    const u1 = 0.77 + shift;
    k.box(u0, 0.23, u1, 0.77, lo, h * 0.98, t.base);
    if (!k.plan) {
      k.facePanel('u', 0.771, u0 + 0.04, lo + h * 0.03, u1 - 0.04, h * 0.94, shade(t.ink, 0.8), 1);
      const cu = (u0 + u1) / 2;
      const r = h * 0.13;
      k.faceCircle(cu, 0.772, h * 0.65, r, 'u', t.dark, 1);
      k.faceCircle(cu, 0.773, h * 0.65, r * 0.78, 'u', shade(t.ink, 0.6), 1);
      k.faceCircle(cu, 0.774, h * 0.65, r * 0.3, 'u', cap, glow ? 0.95 : 0.8);
      k.facePanel('u', 0.772, cu - 0.14, h * 0.82, cu + 0.14, h * 0.92, t.dark, 1);
      k.facePanel('u', 0.773, cu - 0.05, h * 0.845, cu + 0.05, h * 0.895, shade(t.ink, 0.5), 1);
      k.facePanel('u', 0.773, u0 + 0.06, h * 0.53, u0 + 0.13, h * 0.555, shade(t.light, 0.85), 0.8);
      for (const u of [u0, u1 - 0.06]) k.facePanel('u', 0.772, u, h * 0.92, u + 0.06, h * 0.98, corner, 0.9);
      k.facePanel('v', u1 + 0.001, 0.42, h * 0.8, 0.58, h * 0.86, t.ink, 0.9);
      k.facePanel('v', u1 + 0.001, 0.3, h * 0.58, 0.34, h * 0.62, cap, glow ? 1 : 0.7);
    }
    k.poly([[u0 + 0.08, 0.45, h * 0.982], [u1 - 0.1, 0.45, h * 0.982], [u1 - 0.1, 0.52, h * 0.982], [u0 + 0.08, 0.52, h * 0.982]], shade(t.light, 0.9), 0.5);
    return glow ? k.pool(0.5, 0.7, 0.32) : null;
  },
  column: (k, h) => {
    const t = k.t;
    const zp = h * 0.045;
    const zq = h * 0.085;
    const zn = h * 0.87;
    const ze = h * 0.905;
    if (!k.plan) {
      // Plinth and a moulded step.
      k.box(0.24, 0.24, 0.76, 0.76, 0, zp, shade(t.base, 0.84));
      k.box(0.27, 0.27, 0.73, 0.73, zp, zq, shade(t.base, 0.97));
      if (k.rnd(5) < 0.45) k.poly([[0.7, 0.76, zp], [0.76, 0.76, zp], [0.76, 0.76, zp * 0.3]], shade(t.base, 0.45), 0.4);
      // Shaft with a lit chamfer down the near corner.
      k.box(0.3, 0.3, 0.7, 0.7, zq, zn, t.base);
      const bands = (zn - zq) * k.unit > 14 ? 3 : 1;
      for (let i = 0; i < bands; i += 1) {
        const lo = zq + ((zn - zq) * i) / bands;
        const hi = zq + ((zn - zq) * (i + 1)) / bands;
        const f = plantLit(0.707, 0.707, 0) * (0.74 + 0.26 * ((i + 0.5) / bands));
        k.poly([[0.652, 0.7, lo], [0.7, 0.652, lo], [0.7, 0.652, hi], [0.652, 0.7, hi]], shade(t.base, f), 1);
      }
      // A recessed panel on each near face: shadow under the lip, light on the sill.
      const pz0 = h * 0.2;
      const pz1 = h * 0.76;
      k.facePanel('u', 0.7, 0.36, pz0, 0.6, pz1, shade(t.base, 0.3), 0.1);
      k.line([[0.36, 0.7, pz1], [0.6, 0.7, pz1], [0.6, 0.7, pz0]], shade(t.base, 0.45), 1, 0.4);
      k.line([[0.36, 0.7, pz1], [0.36, 0.7, pz0], [0.6, 0.7, pz0]], shade(t.base, 1.3), 1, 0.3);
      k.facePanel('v', 0.7, 0.36, pz0, 0.6, pz1, shade(t.base, 0.3), 0.1);
      k.line([[0.7, 0.36, pz1], [0.7, 0.6, pz1], [0.7, 0.6, pz0]], shade(t.base, 0.45), 1, 0.4);
      k.line([[0.7, 0.36, pz1], [0.7, 0.36, pz0], [0.7, 0.6, pz0]], shade(t.base, 1.3), 1, 0.3);
      // Scuffs where feet and trolleys meet the shaft.
      const sc = zq + h * (0.05 + k.rnd(6) * 0.05);
      k.poly([[0.3, 0.7, zq], [0.7, 0.7, zq], [0.7, 0.3, zq], [0.7, 0.3, sc * 0.8], [0.7, 0.62, sc], [0.52, 0.7, sc * 1.1], [0.3, 0.7, sc * 0.7]], shade(t.base, 0.35), 0.1);
      // The shadow the capital throws on the shaft, a necking groove, a faint weather streak.
      const gz = zn - h * 0.04;
      k.poly([[0.3, 0.7, zn - h * 0.075], [0.7, 0.7, zn - h * 0.075], [0.7, 0.3, zn - h * 0.075], [0.7, 0.3, zn], [0.7, 0.7, zn], [0.3, 0.7, zn]], shade(t.base, 0.3), 0.16);
      k.line([[0.3, 0.7, gz], [0.7, 0.7, gz], [0.7, 0.3, gz]], shade(t.base, 0.5), 1, 0.35);
      const su = 0.36 + k.rnd(3) * 0.28;
      k.poly([[su, 0.701, zn], [su + 0.04, 0.701, zn], [su + 0.025, 0.701, zn - h * (0.25 + k.rnd(4) * 0.3)], [su + 0.01, 0.701, zn - h * 0.2]], shade(t.base, 0.4), 0.1);
      k.box(0.275, 0.275, 0.725, 0.725, zn, ze, shade(t.base, 1.03));
    }
    // Abacus: the cap is what reads from above.
    k.box(0.23, 0.23, 0.77, 0.77, ze, h, shade(t.base, 1.08));
    k.line([[0.27, 0.27, h], [0.73, 0.27, h], [0.73, 0.73, h], [0.27, 0.73, h], [0.27, 0.27, h]], shade(t.base, k.plan ? 0.8 : 1.25), 1, 0.4);
    if (k.plan) {
      k.line([[0.3, 0.3, h], [0.7, 0.7, h]], t.ink, 1, 0.4);
      k.line([[0.7, 0.3, h], [0.3, 0.7, h]], t.ink, 1, 0.4);
    }
    return null;
  },
  crates: (k, h) => {
    const base = k.t.base;
    const tone = (i: number) => shade(base, 0.93 + k.rnd(10 + i) * 0.13);
    const jig = (i: number) => (k.rnd(20 + i) - 0.5) * 0.06;
    const turn = (k.rnd(3) - 0.5) * 0.5;
    const lo = h * 0.5;
    const top = k.rnd(4);
    const lid = top < 0.25 ? 'open' : top < 0.6 ? 'strap' : 'shut';
    const pick = Math.floor(k.rnd(1) * 3);
    // Half the stacks are laid out mirrored across the diagonal (u and v swapped, remapped into the
    // footprint's narrower v span), so three layouts make six and a row of stacks is not a stamp.
    const swap = k.rnd(6) < 0.5;
    const crate = (cu: number, cv: number, hu: number, hv: number, rot: number, z0: number, z1: number, color: number, salt: number, lid: 'shut' | 'strap' | 'open') =>
      swap
        ? yardCrate(k, 0.05 + (cv - 0.1) * 1.125, 0.1 + (cu - 0.05) * 0.889, hv, hu * 0.889, -rot, z0, z1, color, salt, lid)
        : yardCrate(k, cu, cv, hu, hv, rot, z0, z1, color, salt, lid);
    if (pick === 0) {
      // Two side by side and one across the join.
      crate(0.275, 0.58, 0.205, 0.27, jig(0), 0, lo, tone(0), 1, 'shut');
      crate(0.725, 0.5, 0.205, 0.27, jig(1), 0, lo, tone(1), 2, 'shut');
      crate(0.5, 0.54, 0.19, 0.18, turn, lo, h, tone(2), 3, lid);
    } else if (pick === 1) {
      // A pair at the back with one on top, and a low box pulled out in front.
      crate(0.29, 0.31, 0.2, 0.19, jig(0), 0, lo, tone(0), 1, 'shut');
      crate(0.72, 0.31, 0.2, 0.19, jig(1), 0, lo, tone(1), 2, 'shut');
      crate(0.5, 0.31, 0.19, 0.16, turn, lo, h, tone(2), 3, lid);
      crate(0.5, 0.72, 0.2, 0.15, jig(2), 0, lo * 0.72, tone(3), 4, k.rnd(5) < 0.5 ? 'strap' : 'shut');
    } else {
      // One big crate with a small one turned on top, and a small one at its foot.
      crate(0.4, 0.37, 0.28, 0.24, jig(0), 0, lo * 1.1, tone(0), 1, 'shut');
      crate(0.39, 0.37, 0.16, 0.15, turn * 1.4, lo * 1.1, h, tone(1), 2, lid);
      crate(0.77, 0.76, 0.15, 0.13, jig(2), 0, lo * 0.75, tone(2), 3, 'shut');
    }
    return null;
  },
  pallet: (k) => {
    const t = k.t;
    const turned = k.rnd(2) < 0.5;
    const rot = (k.rnd(1) - 0.5) * 0.08 + (turned ? Math.PI / 2 : 0);
    const A = turned ? 0.38 : 0.41;
    const B = 0.36;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const at = (a: number, b: number): [number, number] => [0.5 + a * cr - b * sr, 0.5 + a * sr + b * cr];
    const slab = (a: number, b: number, ha: number, hb: number, z0: number, z1: number, color: number, o: { ink?: boolean; crown?: boolean; top?: boolean }) => {
      const [u, v] = at(a, b);
      yardPrism(k, yardRect(u, v, ha, hb, rot), z0, z1, color, o);
    };
    const byDepth = <T extends { a: number; b: number }>(list: T[]) =>
      list.sort((p, q) => at(p.a, p.b)[0] + at(p.a, p.b)[1] - (at(q.a, q.b)[0] + at(q.a, q.b)[1]));
    if (!k.plan) {
      // The dark under the deck, so the gaps between the blocks read as a gap.
      const c = [at(-A + 0.03, -B + 0.03), at(A - 0.03, -B + 0.03), at(A - 0.03, B - 0.03), at(-A + 0.03, B - 0.03)];
      k.poly(c.map(([u, v]): [number, number, number] => [u, v, 0.004]), C.ground, 0.5);
      const blocks: { a: number; b: number }[] = [];
      for (const a of [-A + 0.05, 0, A - 0.05]) for (const b of [-B + 0.06, 0, B - 0.06]) blocks.push({ a, b });
      for (const p of byDepth(blocks)) slab(p.a, p.b, 0.05, 0.06, 0, 0.068, shade(t.dark, 0.92), { ink: false, crown: false, top: false });
    }
    const cross = byDepth([-A + 0.05, 0, A - 0.05].map((a) => ({ a, b: 0 })));
    for (const p of cross) slab(p.a, 0, 0.05, B, 0.068, 0.09, t.dark, { crown: false });
    // Five deck boards, the outer two wider; one may be gone, one may be a newer board.
    const widths = [0.075, 0.05, 0.05, 0.05, 0.075];
    const gap = (2 * B - widths.reduce((s, w) => s + 2 * w, 0)) / 4;
    const missing = k.rnd(6) < 0.25 ? 1 + Math.floor(k.rnd(7) * 3) : -1;
    const fresh = k.rnd(8) < 0.45 ? Math.floor(k.rnd(9) * 5) : -1;
    const boards: { a: number; b: number; w: number; i: number }[] = [];
    let b = -B;
    widths.forEach((w, i) => {
      boards.push({ a: 0, b: b + w, w, i });
      b += 2 * w + gap;
    });
    for (const p of byDepth(boards)) {
      if (p.i === missing) continue;
      const color = p.i === fresh ? shade(t.base, 1.12) : shade(t.base, 0.96 + k.rnd(30 + p.i) * 0.08);
      slab(p.a, p.b, A, p.w, 0.09, 0.115, color, {});
      const gb = p.b + (k.rnd(40 + p.i) - 0.5) * p.w;
      const [g0u, g0v] = at(-A + 0.04 + k.rnd(50 + p.i) * 0.2, gb);
      const [g1u, g1v] = at(A - 0.04 - k.rnd(60 + p.i) * 0.25, gb);
      k.line([[g0u, g0v, 0.116], [g1u, g1v, 0.116]], t.light, 1, 0.22);
    }
    if (k.rnd(14) < 0.4) {
      const sa = (k.rnd(15) - 0.5) * A * 1.2;
      const [p0u, p0v] = at(sa, -B - 0.004);
      const [p1u, p1v] = at(sa + 0.03, B * 0.2);
      const [p2u, p2v] = at(sa + 0.05, B + 0.012);
      const [p3u, p3v] = at(sa + 0.09, B + 0.03);
      k.line(k.plan ? [[p0u, p0v, 0.118], [p2u, p2v, 0.118]] : [[p0u, p0v, 0.118], [p1u, p1v, 0.119], [p2u, p2v, 0.118], [p3u, p3v, 0.006]], shade(t.ink, 1.35), 1.5, 0.8);
    }
    if (k.rnd(11) < 0.5) {
      const [su, sv] = at((k.rnd(12) - 0.5) * A, (k.rnd(13) - 0.5) * B);
      k.poly(yardRing(k, su, sv, 0.09, 8, 0.45, 70).map(([u, v]): [number, number, number] => [u, v, 0.117]), C.ground, 0.16);
    }
    return null;
  },
  barrel: (k, h) => {
    const t = k.t;
    const c = shade(t.base, 0.95 + k.rnd(1) * 0.1);
    const cu = 0.5 + (k.rnd(2) - 0.5) * 0.04;
    const cv = 0.5 + (k.rnd(3) - 0.5) * 0.04;
    const r = 0.245;
    const zt = h * 0.97;
    const open = k.rnd(9) < 0.2;
    const pt = (j: number, z: number, rr = r): [number, number, number] => {
      const a = -Math.PI / 4 + (j * Math.PI) / 8;
      return [cu + Math.cos(a) * rr, cv + Math.sin(a) * rr, z];
    };
    const strip = (z0: number, z1: number, color: number, alpha: number) => {
      const lo: [number, number, number][] = [];
      const hi: [number, number, number][] = [];
      for (let j = 0; j <= 8; j += 1) {
        lo.push(pt(j, z0, r * 1.004));
        hi.unshift(pt(j, z1, r * 1.004));
      }
      k.poly([...lo, ...hi], color, alpha);
    };
    yardPrism(k, yardRing(k, cu, cv, r, 16), 0, zt, c, { bands: 2 }, () => {
      if (!k.plan) {
        // A painted band, a label between the hoops, a weld seam, a dent, grime run down from the chime.
        const painted = k.rnd(11) < 0.4;
        if (painted) strip(zt * 0.72, zt * 0.9, k.rnd(12) < 0.5 ? t.light : t.dark, 0.3);
        if (k.rnd(5) < 0.55) {
          const j0 = 2 + Math.floor(k.rnd(6) * 3);
          const zl = zt * 0.4;
          const zh = zt * 0.6;
          k.poly([pt(j0, zl), pt(j0 + 1, zl), pt(j0 + 2, zl), pt(j0 + 3, zl), pt(j0 + 3, zh), pt(j0 + 2, zh), pt(j0 + 1, zh), pt(j0, zh)], t.light, 0.32);
          const m = pt(j0 + 1.5, (zl + zh) / 2, r * 1.004);
          const dz = (zh - zl) * 0.32;
          const a = -Math.PI / 4 + ((j0 + 1.5) * Math.PI) / 8;
          const tu = -Math.sin(a) * 0.026;
          const tv = Math.cos(a) * 0.026;
          k.poly([[m[0], m[1], m[2] + dz], [m[0] + tu, m[1] + tv, m[2]], [m[0], m[1], m[2] - dz], [m[0] - tu, m[1] - tv, m[2]]], t.dark, 0.6);
        }
        k.line([pt(2.6, zt * 0.06, r * 1.003), pt(2.6, zt * 0.94, r * 1.003)], shade(c, 1.3), 2, 0.22);
        const js = 1 + Math.floor(k.rnd(4) * 6);
        k.line([pt(js, zt * 0.03, r * 1.003), pt(js, zt * 0.97, r * 1.003)], C.ground, 1, 0.14);
        if (k.rnd(13) < 0.3) {
          const jd = 1.5 + k.rnd(14) * 5;
          k.poly([pt(jd, zt * 0.12, r * 1.005), pt(jd + 0.9, zt * 0.2, r * 1.005), pt(jd + 0.6, zt * 0.3, r * 1.005), pt(jd - 0.2, zt * 0.24, r * 1.005)], C.ground, 0.2);
        }
        const streaks = Math.floor(k.rnd(7) * 3);
        for (let i = 0; i < streaks; i += 1) {
          const j = 0.5 + k.rnd(8 + i) * 7;
          k.line([pt(j, zt * 0.97, r * 1.006), pt(j, zt * (0.55 + k.rnd(20 + i) * 0.3), r * 1.006)], shade(t.dark, 0.8), 1, 0.32);
        }
        // Two rolling hoops: a lit ridge over its own shadow; the foot chime.
        for (const f of [0.34, 0.66]) {
          k.band(cu, cv, r * 1.004, zt * f - 0.012, C.ground, 0.32, 1);
          k.band(cu, cv, r * 1.014, zt * f, shade(c, 1.2), 0.5, 1.5);
        }
        k.band(cu, cv, r * 1.004, 0.012, C.ground, 0.4, 1.5);
      }
      if (open) {
        // No lid: the rim, the dark inside wall, whatever is in it standing lower down with a sheen.
        k.disc(cu, cv, r * 0.9, zt, C.ground, 0.75);
        k.disc(cu + 0.016, cv + 0.016, r * 0.68, zt, shade(t.dark, 0.62), 1);
        k.disc(cu + 0.03, cv + 0.005, r * 0.3, zt, t.light, 0.16);
        return;
      }
      // The lid inside the chime: a pressed ring, the big bung with its cap, the small vent.
      k.disc(cu, cv, r * 0.88, zt, shade(c, 0.74));
      k.disc(cu - 0.008, cv - 0.008, r * 0.62, zt, shade(c, 0.82), 0.8);
      const a = k.rnd(10) * Math.PI * 2;
      k.disc(cu + Math.cos(a) * r * 0.55, cv + Math.sin(a) * r * 0.55, 0.046, zt, t.dark, 1, true);
      k.disc(cu + Math.cos(a) * r * 0.55, cv + Math.sin(a) * r * 0.55, 0.02, zt, shade(c, 1.22), 0.6);
      k.disc(cu - Math.cos(a) * r * 0.5, cv - Math.sin(a) * r * 0.5, 0.028, zt, t.dark, 1);
    });
    return null;
  },
  forklift: (k, h) => {
    const t = k.t;
    const steel = shade(t.ink, 0.92);
    const raised = k.rnd(1) < 0.35;
    const load = !raised && k.rnd(4) < 0.45;
    const fz = raised ? h * 0.36 : 0.006;
    const gz = h * 1.3;
    // Counterweight at the back, its gas bottle strapped across the top.
    const cw: [number, number][] = [[0.28, 0.06], [0.72, 0.06], [0.78, 0.12], [0.78, 0.25], [0.22, 0.25], [0.22, 0.12]];
    yardPrism(k, cw, h * 0.06, h * 0.84, t.dark, { bands: 1 }, () => {
      k.facePanel('v', 0.781, 0.14, h * 0.5, 0.23, h * 0.58, 0x8a3d2f, 0.9);
    });
    if (k.rnd(2) < 0.65) {
      yardBottle(k, 0.3, 0.7, 0.15, h * 0.84 + 0.05, 0.05, shade(t.light, 0.95));
      if (!k.plan) for (const u of [0.38, 0.62]) k.line([[u, 0.195, h * 0.84], [u, 0.2, h * 0.84 + 0.05], [u, 0.15, h * 0.84 + 0.1]], steel, 1, 0.9);
    }
    // Rear guard posts, then the body with its step and pinstripe, and the two wheels.
    if (!k.plan) for (const u of [0.24, 0.76]) k.line([[u, 0.23, h * 0.84], [u, 0.23, gz]], steel, 2, 0.95);
    yardPrism(k, yardRect(0.5, 0.405, 0.28, 0.155), h * 0.14, h * 0.56, t.base, { bands: 1 }, () => {
      k.facePanel('v', 0.781, 0.35, h * 0.2, 0.43, h * 0.28, C.ground, 0.4);
      k.facePanel('v', 0.781, 0.25, h * 0.44, 0.56, h * 0.49, t.light, 0.22);
    });
    for (const [v, r] of [[0.29, h * 0.16], [0.49, h * 0.22]] as const) {
      k.faceCircle(0.795, v, r, r, 'v', t.ink, 0.97);
      k.faceCircle(0.797, v, r, r * 0.55, 'v', shade(t.light, 0.85), 0.75);
      k.faceCircle(0.798, v, r, r * 0.22, 'v', steel, 1);
    }
    // Seat and backrest, the dash with the steering column and wheel.
    if (!k.plan) {
      yardPrism(k, yardRect(0.5, 0.28, 0.1, 0.022), h * 0.56, h * 1.02, t.ink, { crown: false });
      yardPrism(k, yardRect(0.5, 0.35, 0.1, 0.055), h * 0.56, h * 0.7, shade(t.ink, 1.25), {});
    }
    yardPrism(k, yardRect(0.5, 0.505, 0.25, 0.05), h * 0.56, h * 0.76, shade(t.base, 0.88), {});
    if (!k.plan) k.line([[0.5, 0.48, h * 0.76], [0.5, 0.43, h * 0.96]], steel, 2, 0.95);
    const wheel: [number, number, number][] = [];
    for (let i = 0; i <= 10; i += 1) wheel.push([0.5 + Math.cos((i / 10) * Math.PI * 2) * 0.06, 0.43 + Math.sin((i / 10) * Math.PI * 2) * 0.06, h * 0.97]);
    k.line(wheel, steel, 2, 0.95);
    // Front posts and the overhead guard: a frame with bars, a beacon on the back corner.
    if (!k.plan) for (const u of [0.24, 0.76]) k.line([[u, 0.54, h * 0.56], [u, 0.52, gz]], steel, 2, 0.95);
    k.line([[0.37, 0.23, gz], [0.37, 0.52, gz], [0.5, 0.52, gz], [0.5, 0.23, gz], [0.63, 0.23, gz], [0.63, 0.52, gz]], steel, k.plan ? 1 : 1.5, 0.95);
    k.line([[0.24, 0.23, gz], [0.76, 0.23, gz], [0.76, 0.52, gz], [0.24, 0.52, gz], [0.24, 0.23, gz]], steel, 2, 1);
    if (!k.plan) k.line([[0.24, 0.52, gz + 0.006], [0.76, 0.52, gz + 0.006], [0.76, 0.23, gz + 0.006]], shade(t.base, 1.15), 1, 0.5);
    // The beacon sits on the guard's back corner post, not in the open gap between its bars.
    if (k.rnd(3) < 0.7) yardPrism(k, yardRing(k, 0.255, 0.24, 0.028, 8), gz, gz + 0.045, 0x94703a, { crown: false, ink: !k.plan });
    // The mast in front: two rails, the lift ram and chains, a crosshead.
    for (const u of [0.31, 0.69]) yardPrism(k, yardRect(u, 0.585, 0.02, 0.02), 0.006, h * 1.46, steel, { bands: 1, crown: false });
    if (!k.plan) k.line([[0.5, 0.59, h * 0.12], [0.5, 0.59, h * 1.1]], shade(t.light, 0.8), 2, 0.55);
    yardPrism(k, yardRect(0.5, 0.585, 0.21, 0.022), h * 1.38, h * 1.46, steel, {});
    // Carriage, load guard and the two forks, lowered or up.
    yardPrism(k, yardRect(0.5, 0.627, 0.22, 0.014), fz, fz + h * 0.26, steel, { ink: !k.plan, crown: false });
    if (!k.plan) k.line([[0.29, 0.625, fz + h * 0.26], [0.29, 0.625, fz + h * 0.5], [0.71, 0.625, fz + h * 0.5], [0.71, 0.625, fz + h * 0.26]], steel, 1.5, 0.9);
    if (load) {
      // A pallet on the forks, and sometimes the crate still on it.
      yardPrism(k, yardRect(0.5, 0.72, 0.2, 0.078), fz, fz + 0.075, 0x8a6f48, {}, () => {
        for (const u of [0.35, 0.58]) k.facePanel('u', 0.799, u, fz + 0.015, u + 0.07, fz + 0.05, C.ground, 0.7);
        k.facePanel('v', 0.701, 0.66, fz + 0.015, 0.78, fz + 0.05, C.ground, 0.45);
        for (const v of [0.69, 0.75]) k.line([[0.3, v, fz + 0.075], [0.7, v, fz + 0.075]], C.ground, 1, 0.35);
      });
      if (k.rnd(5) < 0.6) yardCrate(k, 0.5, 0.72, 0.15, 0.07, (k.rnd(6) - 0.5) * 0.12, fz + 0.075, fz + 0.075 + h * 0.42, 0x9b7a4d, 9, 'strap');
    } else {
      for (const u of [0.39, 0.61]) {
        yardPrism(k, yardRect(u, 0.72, 0.024, 0.08), fz, fz + 0.022, steel, { crown: false });
        yardPrism(k, yardRect(u, 0.648, 0.024, 0.008), fz + 0.022, fz + h * 0.24, steel, { ink: false, crown: false });
      }
    }
    return null;
  },
  container: (k, h) => {
    const t = k.t;
    const c = shade(t.base, 0.95 + k.rnd(1) * 0.1);
    const rust = 0x7a4a2e;
    yardPrism(k, yardRect(0.5, 0.5, 0.45, 0.35), 0, h, c, { bands: 3 }, () => {
      // Long side: corrugation between the top and bottom rails, corner posts, fork pockets.
      for (let i = 0; i < 9; i += 1) {
        const u = 0.115 + i * 0.09;
        k.facePanel('u', 0.851, u, h * 0.07, u + 0.036, h * 0.9, C.ground, 0.15);
      }
      k.facePanel('u', 0.851, 0.05, 0, 0.085, h, shade(c, 1.4), 0.16);
      k.facePanel('u', 0.851, 0.915, 0, 0.95, h, shade(c, 1.4), 0.16);
      if (!k.plan) {
        k.line([[0.085, 0.851, h * 0.9], [0.915, 0.851, h * 0.9]], C.ground, 1, 0.4);
        k.line([[0.085, 0.851, h * 0.07], [0.915, 0.851, h * 0.07]], shade(c, 1.35), 1, 0.3);
      }
      for (const u of [0.3, 0.6]) k.facePanel('u', 0.852, u, h * 0.012, u + 0.1, h * 0.058, C.ground, 0.5);
      for (const u of [0.05, 0.915]) k.facePanel('u', 0.852, u, h * 0.93, u + 0.035, h, C.ground, 0.35);
      k.facePanel('v', 0.951, 0.15, h * 0.93, 0.185, h, C.ground, 0.35);
      // Doors on the end: gasket, the split, four locking bars and their handles, the plate and the stencil.
      k.facePanel('v', 0.951, 0.815, 0, 0.85, h, shade(c, 1.4), 0.16);
      if (!k.plan) {
        k.line([[0.951, 0.19, h * 0.07], [0.951, 0.19, h * 0.9], [0.951, 0.81, h * 0.9], [0.951, 0.81, h * 0.07], [0.951, 0.19, h * 0.07]], t.ink, 1, 0.45);
        k.line([[0.951, 0.5, h * 0.07], [0.951, 0.5, h * 0.9]], t.ink, 1, 0.6);
        for (const v of [0.27, 0.42, 0.58, 0.73]) k.line([[0.952, v, h * 0.05], [0.952, v, h * 0.92]], shade(c, 1.3), 2, 0.55);
        k.line([[0.953, 0.42, h * 0.42], [0.953, 0.47, h * 0.39]], t.ink, 2, 0.7);
        k.line([[0.953, 0.58, h * 0.42], [0.953, 0.53, h * 0.39]], t.ink, 2, 0.7);
        const sv = k.rnd(2) < 0.5 ? 0.6 : 0.24;
        k.line([[0.952, sv, h * 0.8], [0.952, sv + 0.14, h * 0.8]], t.light, 1, 0.55);
        k.line([[0.952, sv, h * 0.75], [0.952, sv + 0.09, h * 0.75]], t.light, 1, 0.45);
      }
      k.facePanel('v', 0.952, 0.3, h * 0.55, 0.37, h * 0.63, t.light, 0.35);
      for (const u of [0.05, 0.915]) k.facePanel('u', 0.852, u, 0, u + 0.035, h * 0.07, C.ground, 0.35);
      if (!k.plan && k.rnd(19) < 0.65) {
        const mu = 0.14 + k.rnd(20) * 0.42;
        k.facePanel('u', 0.852, mu, h * 0.62, mu + 0.24, h * 0.82, t.light, 0.1);
        k.line([[mu + 0.025, 0.853, h * 0.75], [mu + 0.2, 0.853, h * 0.75]], t.light, 2, 0.32);
        k.line([[mu + 0.025, 0.853, h * 0.68], [mu + 0.13, 0.853, h * 0.68]], t.light, 1, 0.3);
      }
      // Weather: rust run down from the top rail, a scab at the foot.
      if (!k.plan) {
        const n = Math.floor(k.rnd(3) * 4);
        for (let i = 0; i < n; i += 1) {
          const u = 0.12 + k.rnd(4 + i) * 0.76;
          k.line([[u, 0.852, h * 0.89], [u + 0.004, 0.852, h * (0.45 + k.rnd(9 + i) * 0.35)]], rust, 1, 0.4);
        }
        if (k.rnd(14) < 0.5) {
          const u = 0.15 + k.rnd(15) * 0.6;
          k.poly([[u, 0.852, h * 0.07], [u + 0.12, 0.852, h * 0.07], [u + 0.09, 0.852, h * 0.16], [u + 0.03, 0.852, h * 0.19]], rust, 0.35);
        }
      }
      // Roof: shallow ribs and the four castings, which is also the plan symbol. The ribs are one
      // serpentine stroke whose turns lie on the roof's own edge, so they read as corrugation, not a meander.
      k.line(
        [0.14, 0.23, 0.32, 0.41, 0.5, 0.59, 0.68, 0.77, 0.86].flatMap((u, i): [number, number, number][] =>
          i % 2 === 0 ? [[u, 0.151, h], [u, 0.849, h]] : [[u, 0.849, h], [u, 0.151, h]],
        ),
        C.ground,
        1,
        0.14,
      );
      for (const [u, v] of [[0.05, 0.15], [0.9, 0.15], [0.9, 0.8], [0.05, 0.8]] as const) {
        k.poly([[u, v, h], [u + 0.05, v, h], [u + 0.05, v + 0.05, h], [u, v + 0.05, h]], C.ground, 0.4);
      }
      if (k.rnd(16) < 0.5) k.poly(yardRing(k, 0.25 + k.rnd(17) * 0.5, 0.35 + k.rnd(18) * 0.3, 0.1, 8, 0.4, 90).map(([u, v]): [number, number, number] => [u, v, h]), C.ground, 0.1);
      if (k.plan) k.line([[0.95, 0.19, h], [0.95, 0.81, h]], t.light, 2, 0.6);
    });
    return null;
  },
  spool: (k, h) => {
    const t = k.t;
    const R = 0.385;
    const fz = Math.min(0.05, h * 0.1);
    const cable = shade(t.ink, 0.95);
    const full = k.rnd(1);
    const rc = 0.2 + full * 0.12;
    if (!k.plan) {
      yardPrism(k, yardRing(k, 0.5, 0.5, R * 0.97, 16), 0, fz, t.dark, {});
      yardPrism(k, yardRing(k, 0.5, 0.5, rc, 16), fz, h - fz, rc < 0.24 ? shade(t.base, 0.9) : cable, { top: false, crown: false }, () => undefined);
      const wraps = rc < 0.24 ? 1 : 4;
      for (let i = 1; i <= wraps; i += 1) {
        const z = fz + ((h - 2 * fz) * i) / (wraps + 1);
        k.band(0.5, 0.5, rc, z, rc < 0.24 ? C.ground : shade(t.base, 0.85), 0.35, 1);
      }
    }
    yardPrism(k, yardRing(k, 0.5, 0.5, R, 16), h - fz, h, shade(t.dark, 1.04), {}, () => {
      // The flange: boards, the arbor hub and its bolts.
      const d = 0.13;
      const w = Math.sqrt(R * R - d * d) - 0.02;
      for (const s of [-1, 1]) k.line([[0.5 - w, 0.5 + s * d, h], [0.5 + w, 0.5 + s * d, h]], t.ink, 1, 0.32);
      k.disc(0.5, 0.5, 0.095, h, shade(t.dark, 0.8), 1, true);
      k.disc(0.5, 0.5, 0.045, h, C.ground, 0.85);
      if (k.rnd(5) < 0.5) {
        const sa = k.rnd(6) * Math.PI * 2;
        const arc: [number, number, number][] = [];
        for (let i = 0; i <= 4; i += 1) arc.push([0.5 + Math.cos(sa + i * 0.2) * 0.29, 0.5 + Math.sin(sa + i * 0.2) * 0.29, h]);
        k.line(arc, t.light, 2, 0.22);
      }
      const a0 = k.rnd(2) * Math.PI;
      for (let i = 0; i < 4; i += 1) {
        const a = a0 + (i * Math.PI) / 2;
        k.disc(0.5 + Math.cos(a) * 0.19, 0.5 + Math.sin(a) * 0.19, 0.02, h, t.light, 0.75);
      }
    });
    // The loose end, over the flange edge and away across the floor.
    if (rc >= 0.24) {
      // It comes off the near flange anywhere from south to east and runs away round either side,
      // so neighbouring reels do not all trail the same plug to the same spot.
      const a = Math.PI * (0.08 + k.rnd(3) * 0.34);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const e = a + (k.rnd(8) < 0.5 ? 0.55 : -0.55);
      const eu = 0.5 + Math.cos(e) * 0.4;
      const ev = 0.5 + Math.sin(e) * 0.4;
      const tail: [number, number, number][] = k.plan
        ? [[0.5 + ca * R, 0.5 + sa * R, 0], [0.5 + ca * 0.44, 0.5 + sa * 0.44, 0], [eu, ev, 0]]
        : [[0.5 + ca * R, 0.5 + sa * R, h - fz * 0.5], [0.5 + ca * (R + 0.03), 0.5 + sa * (R + 0.03), h * 0.6], [0.5 + ca * 0.44, 0.5 + sa * 0.44, 0.01], [eu, ev, 0.01]];
      k.line(tail, cable, 2.5, 1);
      if (!k.plan) k.line(tail.slice(1), shade(t.base, 0.9), 1, 0.3);
      const pu = Math.min(0.87, Math.max(0.13, eu));
      const pv = Math.min(0.86, Math.max(0.13, ev));
      const pz = k.plan ? 0 : 0.03;
      k.poly([[pu - 0.022, pv - 0.025, 0], [pu + 0.028, pv - 0.005, 0], [pu + 0.023, pv + 0.035, pz], [pu - 0.027, pv + 0.015, pz]], t.dark, 1, true);
    }
    return null;
  },
  worklight: (k, h, glow) => {
    const t = k.t;
    const hu = 0.5;
    const hv = 0.5;
    const zc = h * 0.4;
    const spin = (k.rnd(7) - 0.5) * 0.6;
    const legInk = shade(t.ink, 0.9);
    const feet = [0, 1, 2]
      .map((i): [number, number] => {
        const a = -Math.PI / 2 + spin + (i * 2 * Math.PI) / 3;
        return [hu + Math.cos(a) * 0.185, hv + Math.sin(a) * 0.23];
      })
      .sort((p, q) => p[0] + p[1] - (q[0] + q[1]));
    const leg = (f: [number, number]) => {
      k.line([[hu, hv, zc], [f[0], f[1], 0.012]], legInk, 2, 1);
      if (!k.plan) k.line([[hu + 0.008, hv - 0.004, zc], [f[0] + 0.008, f[1] - 0.004, 0.02]], t.light, 1, 0.35);
      k.disc(f[0], f[1], 0.03, 0, t.ink, 1);
    };
    // Cable down the mast and away to a junction box on the floor.
    const bu = feet[2]![0] > 0.5 ? 0.36 : 0.64;
    k.line([[hu, hv, h * 0.12], [hu + (bu - hu) * 0.2, 0.6, 0.004], [bu, 0.68, 0.004]], t.ink, 1.5, 0.9);
    yardPrism(k, yardRect(bu, 0.7, 0.045, 0.03), 0, 0.05, t.dark, { crown: false }, () => {
      if (!k.plan) k.facePanel('u', 0.731, bu - 0.02, 0.015, bu + 0.02, 0.035, t.light, 0.35);
    });
    // The back legs, then the mast and its braces and collar, then the front leg.
    leg(feet[0]!);
    leg(feet[1]!);
    if (!k.plan) {
      const mid = (f: [number, number]): [number, number, number] => [(hu + f[0]) / 2, (hv + f[1]) / 2, zc / 2];
      k.line([mid(feet[0]!), [hu, hv, h * 0.14], mid(feet[1]!), [hu, hv, h * 0.14], mid(feet[2]!)], legInk, 1, 0.85);
      k.line([[hu, hv, h * 0.04], [hu, hv, h * 0.74]], shade(t.ink, 1.15), 3, 1);
      k.line([[hu + 0.006, hv - 0.006, h * 0.06], [hu + 0.006, hv - 0.006, h * 0.72]], t.light, 1, 0.3);
    }
    yardPrism(k, yardRing(k, hu, hv, 0.034, 8), zc - h * 0.05, zc + h * 0.03, t.dark, { crown: false });
    leg(feet[2]!);
    if (k.rnd(1) < 0.5) {
      const [su, sv] = feet[k.rnd(2) < 0.5 ? 1 : 2]!;
      yardPrism(k, yardRing(k, su, sv - 0.015, 0.055, 8, 0.3, 20), 0, 0.055, shade(t.base, 0.95), { crown: false }, () => {
        if (!k.plan) k.band(su, sv - 0.015, 0.05, 0.03, C.ground, 0.25, 1);
      });
    }
    if (!k.plan) {
      yardPrism(k, yardRing(k, hu, hv, 0.026, 6), h * 0.7, h * 0.76, t.dark, { crown: false });
      k.line([[hu + 0.02, hv, h * 0.73], [hu + 0.06, hv, h * 0.73]], t.ink, 2, 1);
      k.line([[hu, hv, h * 0.76], [hu, hv, h * 1.08]], shade(t.light, 0.92), 2, 1);
    }
    // A T-bar with one or two heads, each in its yoke and turned its own way.
    const twin = k.rnd(3) < 0.6;
    const heads = twin ? [0.375, 0.625] : [0.5];
    const bz = h * 1.08;
    k.line([[twin ? 0.27 : 0.33, hv, bz], [twin ? 0.73 : 0.67, hv, bz]], t.ink, 2.5, 1);
    // A lone head is the bigger lamp, so a single-head stand still reads as a light at table zoom.
    const hw = twin ? 0.105 : 0.15;
    const hd = twin ? 0.05 : 0.06;
    const hz = twin ? 0.27 : 0.36;
    const lens = glow ?? shade(t.dark, 0.85);
    heads.forEach((u, i) => {
      const yaw = (k.rnd(4 + i) - 0.5) * 0.45;
      const ring = yardRect(u, hv - 0.005, hw, hd, yaw);
      const z0 = bz + h * 0.03;
      const z1 = bz + h * hz;
      if (!k.plan) {
        const ya = yardOn(ring, 3, 0.5, 0);
        k.line([[ya[0] - 0.012, ya[1], z0 + (z1 - z0) * 0.5], [ya[0] - 0.012, ya[1], bz]], t.ink, 2, 0.95);
      }
      yardPrism(k, ring, z0, z1, t.dark, {}, () => {
        yardPanel(k, ring, 2, 0.08, 0.92, z0 + h * 0.025, z1 - h * 0.025, shade(t.ink, 0.9), 1);
        yardPanel(k, ring, 2, 0.14, 0.86, z0 + h * 0.05, z1 - h * 0.05, lens, glow ? 1 : 0.95);
        if (glow) yardPanel(k, ring, 2, 0.3, 0.7, z0 + h * 0.09, z1 - h * 0.09, shade(glow, 1.15), 0.9);
        else yardPanel(k, ring, 2, 0.14, 0.86, z0 + h * 0.05, z1 - h * 0.05, GLASS, 0.2);
        if (!k.plan) {
          const zm = (z0 + z1) / 2;
          k.line([yardOn(ring, 2, 0.14, zm), yardOn(ring, 2, 0.86, zm)], t.ink, 1, 0.5);
          k.line([yardOn(ring, 1, 0.1, z1 - h * 0.02), yardOn(ring, 1, 0.9, z1 - h * 0.02)], shade(t.dark, 1.3), 1, 0.4);
        }
        k.line([yardTop(ring, 0.2, 0.25, z1), yardTop(ring, 0.2, 0.8, z1), yardTop(ring, 0.4, 0.8, z1), yardTop(ring, 0.4, 0.25, z1), yardTop(ring, 0.6, 0.25, z1), yardTop(ring, 0.6, 0.8, z1), yardTop(ring, 0.8, 0.8, z1), yardTop(ring, 0.8, 0.25, z1)], t.ink, 1, 0.45);
      });
      if (!k.plan) {
        const yb = yardOn(ring, 1, 0.5, 0);
        k.line([[yb[0] + 0.012, yb[1], bz], [yb[0] + 0.012, yb[1], z0 + (z1 - z0) * 0.5]], t.ink, 2, 0.95);
        k.disc(yb[0] + 0.014, yb[1], 0.014, z0 + (z1 - z0) * 0.5, t.light, 0.6);
      }
    });
    return glow ? k.pool(0.5, 0.8, 0.44) : null;
  },
  generator: (k, h, glow) => {
    const t = k.t;
    const east = k.rnd(1) < 0.5;
    const steel = shade(t.ink, 1.12);
    const z0 = h * 0.1;
    const z1 = h * 0.78;
    // An oil weep out from under the skid.
    if (k.rnd(5) < 0.45) {
      const su = 0.25 + k.rnd(6) * 0.5;
      k.poly(yardRing(k, su, 0.8, 0.09, 8, 0.45, 60).map(([u, v]): [number, number, number] => [u, v, 0.003]), C.ground, 0.16);
    }
    // The skid: a steel base frame with its fork pockets.
    yardPrism(k, yardRect(0.5, 0.5, 0.4, 0.29), 0, z0, shade(t.dark, 0.82), { crown: false }, () => {
      for (const u of [0.25, 0.65]) k.facePanel('u', 0.791, u, h * 0.022, u + 0.1, h * 0.075, C.ground, 0.65);
    });
    // The canopy: an intake louvre, a service door, the control panel; the radiator and its fan on the end.
    const ring = yardRect(0.5, 0.5, 0.37, 0.26);
    yardPrism(k, ring, z0, z1, t.base, { bands: 2 }, () => {
      if (!k.plan) {
        k.facePanel('u', 0.761, 0.17, h * 0.24, 0.39, h * 0.66, C.ground, 0.34, true);
        const slats: [number, number, number][] = [];
        for (let i = 0; i < 5; i += 1) {
          const z = h * (0.28 + i * 0.08);
          slats.push(...((i % 2 === 0 ? [[0.175, 0.762, z], [0.385, 0.762, z]] : [[0.385, 0.762, z], [0.175, 0.762, z]]) as [number, number, number][]));
        }
        k.line(slats, shade(t.base, 1.22), 1, 0.5);
        k.line([[0.42, 0.761, z0 + h * 0.03], [0.42, 0.761, z1 - h * 0.05], [0.63, 0.761, z1 - h * 0.05], [0.63, 0.761, z0 + h * 0.03]], C.ground, 1, 0.42);
        // A flush latch, not a knob: a door with a light knob under a chimney is a shed.
        k.line([[0.585, 0.762, h * 0.47], [0.612, 0.762, h * 0.47]], t.ink, 2, 0.75);
        k.line([[0.13, 0.761, z0 + h * 0.05], [0.87, 0.761, z0 + h * 0.05], [0.87, 0.3, z0 + h * 0.05]], C.ground, 1, 0.28);
      }
      k.facePanel('u', 0.762, 0.66, h * 0.34, 0.845, h * 0.7, shade(t.dark, 0.78), 1, true);
      k.facePanel('u', 0.763, 0.68, h * 0.5, 0.775, h * 0.65, glow ?? shade(t.dark, 0.55), glow ? 0.95 : 1);
      if (!glow) k.facePanel('u', 0.764, 0.68, h * 0.5, 0.775, h * 0.65, GLASS, 0.22);
      k.facePanel('u', 0.763, 0.795, h * 0.58, 0.825, h * 0.64, glow ?? t.light, glow ? 1 : 0.55);
      k.facePanel('u', 0.763, 0.795, h * 0.4, 0.825, h * 0.5, 0x8a3d2f, 1);
      k.facePanel('u', 0.763, 0.69, h * 0.39, 0.765, h * 0.44, t.light, 0.3);
      // Radiator end: a recess, the fan behind it, the grille bars over.
      k.facePanel('v', 0.871, 0.29, h * 0.2, 0.71, h * 0.7, C.ground, 0.3);
      // A round guard reads as a machine at any zoom; six bars over it read as plank siding.
      k.faceCircle(0.872, 0.5, h * 0.45, h * 0.215, 'v', shade(t.base, 1.12), 1);
      k.faceCircle(0.873, 0.5, h * 0.45, h * 0.185, 'v', shade(t.dark, 0.6), 1);
      k.faceCircle(0.874, 0.5, h * 0.45, h * 0.055, 'v', steel, 1);
      if (!k.plan) {
        const g = 0.185 * h * 0.894;
        k.line([[0.875, 0.5 - g, h * 0.45], [0.875, 0.5 + g, h * 0.45], [0.875, 0.5, h * 0.45], [0.875, 0.5, h * 0.635], [0.875, 0.5, h * 0.265]], shade(t.base, 1.2), 1, 0.45);
      }
      // Roof: an access hatch, and a vent grille at the end away from the stack.
      const vu = east ? 0.18 : 0.62;
      k.poly([[vu, 0.55, z1], [vu + 0.2, 0.55, z1], [vu + 0.2, 0.7, z1], [vu, 0.7, z1]], C.ground, 0.3);
      k.line([[vu + 0.03, 0.59, z1], [vu + 0.17, 0.59, z1], [vu + 0.17, 0.625, z1], [vu + 0.03, 0.625, z1], [vu + 0.03, 0.66, z1], [vu + 0.17, 0.66, z1]], shade(t.base, 1.15), 1, 0.45);
      k.line([[0.2, 0.29, z1], [0.8, 0.29, z1], [0.8, 0.48, z1], [0.2, 0.48, z1], [0.2, 0.29, z1]], C.ground, 1, 0.2);
    });
    // The silencer lying on the roof in its brackets, its stack up out of one end with a rain cap, soot round it.
    const sx = east ? 0.72 : 0.28;
    const s0 = east ? 0.38 : 0.28;
    const s1 = east ? 0.72 : 0.62;
    const stack = () => {
      // A short stack: at twice the silencer's height it read as a cabin chimney.
      yardPrism(k, yardRing(k, sx, 0.38, 0.032, 8), z1, h * 1.2, shade(t.dark, 0.78), { bands: 1, crown: false }, () => {
        if (!k.plan) k.band(sx, 0.38, 0.033, h * 1.1, C.ground, 0.45, 2);
      });
      if (!k.plan) k.poly([[sx - 0.04, 0.34, h * 1.2], [sx + 0.04, 0.34, h * 1.2], [sx + 0.045, 0.43, h * 1.26], [sx - 0.035, 0.43, h * 1.26]], shade(t.dark, 0.9), 1, true);
    };
    k.disc(sx, 0.38, 0.075, z1, C.ground, 0.22);
    if (!east) stack();
    if (!k.plan) for (const u of [s0 + 0.08, s1 - 0.08]) k.line([[u, 0.34, z1], [u, 0.38, z1 + 0.075], [u, 0.42, z1]], steel, 2, 0.9);
    yardBottle(k, s0, s1, 0.38, z1 + 0.065, 0.06, shade(t.dark, 1.12));
    if (east) stack();
    // A lifting eye and the fuel filler, then the lead out to the floor.
    k.line([[0.5, 0.58, z1], [0.49, 0.58, z1 + 0.035], [0.51, 0.58, z1 + 0.035], [0.52, 0.58, z1]], t.ink, 1.5, 0.9);
    k.disc(east ? 0.2 : 0.8, 0.7, 0.03, z1, t.dark, 1, true);
    if (!k.plan) k.line([[0.73, 0.763, h * 0.3], [0.74, 0.78, h * 0.16], [0.75, 0.79, 0.006], [0.84, 0.795, 0.006], [0.89, 0.77, 0.006]], t.ink, 2, 0.9);
    return glow ? k.pool(0.74, 0.84, 0.3) : null;
  },
  tank: (k, h) => {
    const t = k.t;
    const steel = t.base;
    const R = 0.35;
    const zb = h * 0.06;
    const zs = h * 0.72;
    const zd1 = zs + h * 0.075;
    const zd2 = zd1 + h * 0.05;
    // The ladder and the outlet take opposite sides of the near face, per tank.
    const east = k.rnd(1) < 0.5;
    const lad = east ? 0.25 + k.rnd(2) * 0.3 : 1.05 + k.rnd(2) * 0.3;
    const out = east ? 1.2 + k.rnd(3) * 0.25 : 0.2 + k.rnd(3) * 0.25;
    const half = Math.PI * 0.75;
    // Concrete ring pad.
    plantSlab(k, 0.5, 0.5, 0.4, 0, zb, shade(t.light, 0.9), 16);
    plantTurn(k, 0.5, 0.5, R, R, zb, zs, steel, { n: 16, cap: false, under: true, foot: true });
    if (!k.plan) {
      // Two lap seams round the shell, a vertical weld, a drip streak.
      for (const f of [0.36, 0.68]) {
        const z = zb + (zs - zb) * f;
        k.line(plantArc(0.5, 0.5, R + 0.002, z, half, -Math.PI / 4, 8), shade(steel, 0.66), 1, 0.45);
        k.line(plantArc(0.5, 0.5, R + 0.002, z - h * 0.018, half, -Math.PI / 4, 8), shade(steel, 1.22), 1, 0.2);
      }
      const weld = lad + (east ? 0.95 : -0.95);
      k.line([plantShell(0.5, 0.5, R + 0.002, weld, 0, zb), plantShell(0.5, 0.5, R + 0.002, weld, 0, zs)], shade(steel, 0.68), 1, 0.35);
      const st = out + (k.rnd(4) - 0.5) * 0.4;
      k.poly(
        [
          plantShell(0.5, 0.5, R + 0.003, st, -0.016, zs),
          plantShell(0.5, 0.5, R + 0.003, st, 0.016, zs),
          plantShell(0.5, 0.5, R + 0.003, st, 0.004, zs - h * (0.3 + k.rnd(5) * 0.2)),
          plantShell(0.5, 0.5, R + 0.003, st, -0.006, zs - h * 0.22),
        ],
        shade(steel, 0.35),
        0.16,
      );
      // Stencilled plate and a dial gauge.
      const pl = (lad + out) / 2;
      const pz = zb + (zs - zb) * 0.5;
      k.poly(
        [
          plantShell(0.5, 0.5, R + 0.004, pl, 0.07, pz),
          plantShell(0.5, 0.5, R + 0.004, pl, -0.07, pz),
          plantShell(0.5, 0.5, R + 0.004, pl, -0.07, pz + h * 0.12),
          plantShell(0.5, 0.5, R + 0.004, pl, 0.07, pz + h * 0.12),
        ],
        shade(t.light, 1.08),
        0.4,
      );
      k.line([plantShell(0.5, 0.5, R + 0.005, pl, 0.045, pz + h * 0.06), plantShell(0.5, 0.5, R + 0.005, pl, -0.045, pz + h * 0.06)], shade(steel, 0.45), 1, 0.5);
    }
    // Dome in two courses, a manway and a gooseneck vent on top.
    plantTurn(k, 0.5, 0.5, R, 0.27, zs, zd1, steel, { n: 16, cap: false, under: true, ink: false });
    plantTurn(k, 0.5, 0.5, 0.27, 0.14, zd1, zd2, steel, { n: 16, under: true, ink: !k.plan });
    if (!k.plan) k.line(plantArc(0.5, 0.5, R, zs, half, -Math.PI / 4, 8), shade(steel, 1.3), 1.5, 0.45);
    plantSlab(k, 0.43, 0.45, 0.07, zd2 - h * 0.01, zd2 + h * 0.03, shade(steel, 1.05), 10);
    k.line([[0.39, 0.45, zd2 + h * 0.035], [0.47, 0.45, zd2 + h * 0.035]], shade(steel, 0.5), 1, 0.7);
    // The gooseneck turns across the screen (+u, -v), so its hook never folds back over its own riser into a ring.
    const neck: [number, number, number][] = [[0.585, 0.415, zd2 - h * 0.02], [0.585, 0.415, zd2 + h * 0.09], [0.6, 0.4, zd2 + h * 0.125], [0.63, 0.37, zd2 + h * 0.125], [0.645, 0.355, zd2 + h * 0.065]];
    k.line(neck, shade(steel, 0.42), k.plan ? 2.4 : 3.4);
    if (!k.plan) k.line(neck.slice(0, 3), shade(steel, 1.15), 1.2, 0.8);
    // Ladder: both rails and the hoop over the lip as one line, the rungs as a
    // serpentine up the rails, over the ladder's own shadow on the shell.
    const rail = R + 0.03;
    const L = (s: number, z: number, r = rail): [number, number, number] => plantShell(0.5, 0.5, r, lad, s, z);
    const ztop = zs + h * 0.1;
    if (k.plan) {
      k.line([L(-0.035, h), L(0.035, h)], shade(steel, 0.5), 2);
    } else {
      const z0 = zb + (zs - zb) * 0.04;
      k.line([L(-0.03, z0 - 0.03, R + 0.004), L(-0.03, zs - 0.03, R + 0.004)], shade(steel, 0.3), 1, 0.4);
      k.line([L(0.03, z0 - 0.03, R + 0.004), L(0.03, zs - 0.03, R + 0.004)], shade(steel, 0.3), 1, 0.4);
      const ink = shade(t.light, 1.02);
      k.line([L(-0.03, z0), L(-0.03, ztop), L(-0.03, ztop, R - 0.03), L(0.03, ztop, R - 0.03), L(0.03, ztop), L(0.03, z0)], ink, 1, 0.95);
      const rungs: [number, number, number][] = [];
      for (let i = 0; i < 7; i += 1) {
        const z = zb + (zs - zb) * (0.12 + 0.14 * i);
        const s = i % 2 === 0 ? -0.03 : 0.03;
        rungs.push(L(s, z), L(-s, z));
      }
      k.line(rungs, ink, 1, 0.75);
      // A guard rail round the roof where the ladder lands.
      const zr0 = zs + h * 0.02;
      const zr1 = zs + h * 0.13;
      const rr = R - 0.035;
      const g0 = lad - (east ? 0.15 : 0.7);
      const g1 = lad + (east ? 0.7 : 0.15);
      k.line([[...plantShell(0.5, 0.5, rr, g0, 0, zr0)], ...plantArc(0.5, 0.5, rr, zr1, g0, g1, 6), [...plantShell(0.5, 0.5, rr, g1, 0, zr0)]], shade(t.light, 0.9), 1, 0.85);
      k.line([plantShell(0.5, 0.5, rr, (g0 + g1) / 2, 0, zr0), plantShell(0.5, 0.5, rr, (g0 + g1) / 2, 0, zr1)], shade(t.light, 0.9), 1, 0.85);
    }
    // Outlet: a short nozzle, a flange, and an elbow down into the pad through a gate valve.
    const oc = Math.cos(out);
    const os = Math.sin(out);
    const zo = zb + (zs - zb) * 0.24;
    const at = (r: number, z: number): [number, number, number] => [0.5 + oc * r, 0.5 + os * r, z];
    const elbow = [at(R - 0.02, zo), at(0.392, zo), at(0.392, zb)];
    if (k.plan) {
      k.line(elbow, shade(steel, 0.6), 3.2);
    } else {
      // An outlined pipe: a dark round under a lit core.
      k.line(elbow, shade(steel, 0.45), 3.6);
      k.line(elbow, shade(steel, 1.05), 1.6);
      const fl: [number, number, number][] = [];
      for (let i = 0; i < 8; i += 1) {
        const p = (i / 8) * Math.PI * 2;
        fl.push([0.5 + oc * 0.37 - os * Math.cos(p) * 0.04, 0.5 + os * 0.37 + oc * Math.cos(p) * 0.04, zo + Math.sin(p) * 0.04]);
      }
      k.poly(fl, shade(steel, 1.1), 1, true);
      plantSlab(k, 0.5 + oc * 0.392, 0.5 + os * 0.392, 0.03, zb, zb + h * 0.02, shade(steel, 0.9), 6);
      if (k.rnd(6) < 0.55) {
        // A sight glass beside the plate.
        const sa = (lad + out) / 2 + (east ? 0.28 : -0.28);
        k.line([plantShell(0.5, 0.5, R + 0.006, sa, 0, zb + (zs - zb) * 0.15), plantShell(0.5, 0.5, R + 0.006, sa, 0, zs - (zs - zb) * 0.12)], shade(steel, 0.6), 2.6);
        k.line([plantShell(0.5, 0.5, R + 0.008, sa, 0, zb + (zs - zb) * 0.18), plantShell(0.5, 0.5, R + 0.008, sa, 0, zb + (zs - zb) * (0.4 + k.rnd(7) * 0.4))], GLASS, 1, 0.55);
      }
    }
    return null;
  },
  valves: (k, h) => {
    const t = k.t;
    const cu = t.base;
    const iron = shade(t.dark, 0.62);
    const zh = h * 0.3;
    // Steel plinth, a supply rising from the floor at the west end, the header.
    k.box(0.2, 0.42, 0.8, 0.58, 0, h * 0.06, shade(t.dark, 0.8));
    k.poly([[0.22, 0.435, h * 0.06], [0.78, 0.435, h * 0.06], [0.78, 0.565, h * 0.06], [0.22, 0.565, h * 0.06]], shade(t.dark, 0.5), 0.9);
    if (!k.plan) {
      k.line([[0.24, 0.5, h * 0.06], [0.24, 0.5, zh]], shade(cu, 0.62), 3.4);
      k.line([[0.232, 0.506, h * 0.06], [0.232, 0.506, zh]], shade(cu, 1.18), 1, 0.6);
    }
    if (!k.plan) {
      // Two saddle supports carry the header off the tray.
      for (const u of [0.41, 0.59]) k.line([[u - 0.025, 0.5, h * 0.06], [u, 0.5, zh - 0.03], [u + 0.025, 0.5, h * 0.06]], shade(t.dark, 0.55), 2);
    }
    plantPipe(k, 'u', 0.24, 0.79, 0.5, zh, 0.042, 0.042, cu);
    if (!k.plan) {
      k.poly(plantFaceRing(k, 'v', 0.795, 0.5, zh, 0.062, 10), shade(cu, 0.84), 1, true);
      // A bleed cock under the blind flange.
      k.line([[0.8, 0.5, zh - 0.05], [0.8, 0.5, zh - 0.09], [0.83, 0.5, zh - 0.09]], shade(t.dark, 0.5), 1.6);
      // A painted service band on the header and its flow arrow.
      const bu = 0.572;
      const B = (u: number, th: number): [number, number, number] => [u, 0.5 + Math.cos(th) * 0.044, zh + Math.sin(th) * 0.044];
      k.poly([B(bu, -Math.PI / 4), B(bu + 0.036, -Math.PI / 4), B(bu + 0.036, (3 * Math.PI) / 4), B(bu, (3 * Math.PI) / 4)], shade(t.light, 1.04), 0.9);
      k.line([[bu + 0.046, 0.544, zh + 0.014], [bu + 0.07, 0.544, zh], [bu + 0.046, 0.544, zh - 0.014]], shade(t.light, 1.04), 1, 0.8);
    }
    const gauge = Math.floor(k.rnd(9) * 3);
    [0.32, 0.5, 0.68].forEach((u, i) => {
      const ball = k.rnd(40 + i) < 0.3;
      const lift = k.rnd(10 + i);
      const zv0 = h * 0.46;
      const zv1 = h * (ball ? 0.56 : 0.62);
      // Neighbours stand at different heights, so three wheels never merge into one plate.
      const zw = h * ((i === 1 ? 0.92 : 0.76) + lift * 0.1);
      if (!k.plan) {
        // Riser: a dark round with its lit side toward the key light, a flange at the tee.
        k.line([[u, 0.5, zh], [u, 0.5, zv0]], shade(cu, 0.7), 3.6);
        k.line([[u - 0.012, 0.506, zh], [u - 0.012, 0.506, zv0]], shade(cu, 1.18), 1, 0.7);
        plantSlab(k, u, 0.5, 0.052, zh + 0.03, zh + 0.05, shade(cu, 0.95), 8);
      }
      // Valve body and bonnet (in plan a handwheel covers it entirely, so only a lever valve shows its body).
      if (!k.plan || ball) plantTurn(k, u, 0.5, 0.066, 0.058, zv0, zv1, shade(cu, 0.8), { n: 8 });
      if (!k.plan && i === gauge) {
        k.poly(plantFaceRing(k, 'u', 0.56, u, (zh + zv0) / 2 + 0.01, 0.03, 10), shade(t.light, 1.12), 1, true);
        k.line([[u, 0.561, (zh + zv0) / 2 + 0.01], [u + 0.018, 0.561, (zh + zv0) / 2 + 0.022]], iron, 1, 0.9);
      }
      if (ball) {
        // A quarter-turn valve: its lever along the pipe when open, across it when shut.
        const open = k.rnd(50 + i) < 0.6;
        const zl = zv1 + h * 0.06;
        if (!k.plan) k.line([[u, 0.5, zv1], [u, 0.5, zl]], iron, 2.2);
        const tip: [number, number, number] = open ? [u + 0.085, 0.5, zl] : [u, 0.59, zl - h * 0.02];
        k.line([[u, 0.5, zl], tip], iron, 3.2);
        k.line([[u, 0.5, zl + 0.007], [tip[0], tip[1], tip[2] + 0.007]], shade(t.light, 1.05), 1.2, 0.9);
        return;
      }
      // Gate valve: rising stem, iron handwheel lit on its near arc, two spokes, a bright hub.
      if (!k.plan) k.line([[u, 0.5, zv1], [u, 0.5, zw]], iron, 2);
      const r = i === 1 ? 0.095 : 0.075;
      const ring = plantRing(u, 0.5, r, zw, 12);
      // The wheel's dark well, so the lit rim and spokes read as a wheel and not a plate.
      k.disc(u, 0.5, r * 0.97, zw, shade(t.dark, 0.4), 0.92);
      const lit = shade(t.light, 1.02);
      k.line([...ring, ring[0]!], lit, 1);
      const sp = k.rnd(20 + i) * Math.PI;
      k.line([[u + Math.cos(sp) * r, 0.5 + Math.sin(sp) * r, zw], [u - Math.cos(sp) * r, 0.5 - Math.sin(sp) * r, zw]], lit, 1, 0.7);
      k.line([[u - Math.sin(sp) * r, 0.5 + Math.cos(sp) * r, zw], [u + Math.sin(sp) * r, 0.5 - Math.cos(sp) * r, zw]], lit, 1, 0.7);
      k.disc(u, 0.5, 0.016, zw + 0.003, shade(t.light, 1.15), 1);
      if (!k.plan && k.rnd(30 + i) < 0.3) {
        // A lockout tag on its wire.
        k.line([[u + 0.025, 0.565, zw], [u + 0.03, 0.59, zw - h * 0.07]], iron, 1, 0.8);
        k.facePanel('u', 0.59, u + 0.01, zw - h * 0.17, u + 0.055, zw - h * 0.07, shade(t.light, 1.12), 0.95, true);
      }
    });
    return null;
  },
  pump: (k, h) => {
    const t = k.t;
    const s = h * 2;
    // Per unit: the motor's paint, where its terminal box sits, and a gauge or an isolating handwheel on the discharge.
    const body = shade(t.base, 0.92 + k.rnd(3) * 0.16);
    const tb = 0.25 + k.rnd(4) * 0.1;
    const wheel = k.rnd(5) < 0.45;
    const cast = shade(t.accent, 0.92);
    // Concrete pad, steel skid.
    k.box(0.15, 0.25, 0.88, 0.75, 0, 0.05 * s, shade(t.light, 0.88), { crown: false });
    k.box(0.18, 0.32, 0.85, 0.7, 0.05 * s, 0.1 * s, shade(t.dark, 0.7));
    // Motor: a finned drum lying west–east, terminal box on top, conduit to the wall.
    const rz = 0.135 * s;
    const zc = 0.1 * s + rz;
    plantPipe(k, 'u', 0.2, 0.5, 0.51, zc, 0.135, rz, body);
    if (!k.plan) {
      for (const th of [-0.25, 0.2, 0.62]) {
        k.line([[0.23, 0.51 + Math.cos(th) * 0.137, zc + Math.sin(th) * rz], [0.49, 0.51 + Math.cos(th) * 0.137, zc + Math.sin(th) * rz]], shade(body, 0.6), 1, 0.5);
      }
      k.poly(plantFaceRing(k, 'v', 0.501, 0.51, zc, 0.045, 8), shade(body, 0.55), 1);
      k.poly(
        [
          [0.26, 0.51 + Math.cos(0.02) * 0.138, zc + Math.sin(0.02) * rz],
          [0.34, 0.51 + Math.cos(0.02) * 0.138, zc + Math.sin(0.02) * rz],
          [0.34, 0.51 + Math.cos(0.4) * 0.138, zc + Math.sin(0.4) * rz],
          [0.26, 0.51 + Math.cos(0.4) * 0.138, zc + Math.sin(0.4) * rz],
        ],
        shade(t.light, 1.1),
        0.55,
      );
      k.line([[tb + 0.06, 0.43, zc + rz * 0.9], [tb + 0.06, 0.33, zc + rz * 0.9], [tb + 0.06, 0.3, 0.1 * s]], shade(t.dark, 0.55), 1.5);
    }
    k.box(tb, 0.44, tb + 0.12, 0.56, zc + rz * 0.82, zc + rz * 0.82 + 0.07 * s, shade(body, 0.9));
    // Coupling guard.
    k.box(0.5, 0.43, 0.59, 0.59, 0.1 * s, zc + 0.05 * s, shade(t.light, 1.05));
    if (!k.plan) k.line([[0.51, 0.591, 0.13 * s], [0.545, 0.591, zc + 0.03 * s], [0.58, 0.591, 0.13 * s]], shade(t.dark, 0.6), 1, 0.4);
    // Volute casing, its bolt circle, the suction nozzle and flange out of the east end.
    const zv = 0.1 * s + 0.16 * s;
    plantPipe(k, 'u', 0.59, 0.72, 0.5, zv, 0.165, 0.16 * s, cast);
    if (!k.plan) k.line([...plantFaceRing(k, 'v', 0.722, 0.5, zv, 0.12, 12), plantFaceRing(k, 'v', 0.722, 0.5, zv, 0.12, 12)[0]!], shade(cast, 0.5), 1, 0.4);
    plantPipe(k, 'u', 0.72, 0.84, 0.5, zv, 0.055, 0.055 * s, shade(body, 0.85));
    if (!k.plan) {
      k.poly(plantFaceRing(k, 'v', 0.845, 0.5, zv, 0.085, 10), shade(body, 0.95), 1, true);
      k.poly(plantFaceRing(k, 'v', 0.846, 0.5, zv, 0.04, 8), shade(body, 0.45), 1);
    }
    // Discharge: up out of the top, a flange, a gauge, and an elbow back to the wall.
    const zd = 0.88 * s * 0.5 + 0.44 * h;
    plantTurn(k, 0.655, 0.5, 0.048, 0.048, zv + 0.1 * s, zd, shade(body, 0.85), { n: 8, cap: false });
    plantSlab(k, 0.655, 0.5, 0.072, zv + 0.2 * s, zv + 0.23 * s, shade(body, 0.95), 10);
    if (!k.plan && wheel) {
      const wz = zv + 0.31 * s;
      const ring = plantFaceRing(k, 'v', 0.75, 0.5, wz, 0.055, 10);
      k.line([[0.7, 0.5, wz], [0.75, 0.5, wz]], shade(t.dark, 0.5), 2);
      k.line([...ring, ring[0]!], shade(t.light, 1.02), 1.5);
      k.line([ring[0]!, ring[5]!, [0.75, 0.5, wz], [0.75, 0.5, wz + 0.055], [0.75, 0.5, wz - 0.055]], shade(t.light, 1.02), 1, 0.7);
    } else if (!k.plan && k.rnd(1) < 0.7) {
      const gz = zv + 0.32 * s;
      k.line([[0.655, 0.55, gz], [0.655, 0.58, gz]], shade(t.dark, 0.6), 1.5);
      k.poly(plantFaceRing(k, 'u', 0.585, 0.655, gz, 0.032, 10), shade(t.light, 1.12), 1, true);
      k.line([[0.655, 0.586, gz], [0.67, 0.586, gz + 0.016]], shade(t.dark, 0.5), 1, 0.9);
    }
    plantPipe(k, 'v', 0.28, 0.52, 0.655, zd, 0.05, 0.05 * s, shade(body, 0.85));
    if (!k.plan && k.rnd(2) < 0.6) k.disc(0.74, 0.66, 0.05, 0.1 * s + 0.002, shade(t.dark, 0.35), 0.4);
    return null;
  },
  fan: (k, h) => {
    const t = k.t;
    const z0 = h * 0.08;
    const z1 = h * 0.95;
    const V = 0.641;
    const twin = k.rnd(7) < 0.4;
    // Two skids, the housing, a seam where the top panel meets the body.
    k.box(0.23, 0.35, 0.3, 0.65, 0, z0, shade(t.dark, 0.7), { crown: false });
    k.box(0.7, 0.35, 0.77, 0.65, 0, z0, shade(t.dark, 0.7), { crown: false });
    k.box(0.2, 0.36, 0.8, 0.64, z0, z1, t.base);
    const cz = (z0 + z1) / 2;
    const r = twin ? Math.min(0.118, (z1 - z0) * 0.28) : Math.min(0.2, (z1 - z0) * 0.36);
    const centres = twin ? [0.35, 0.65] : [0.47];
    // Slots in the top panel, and a bolted service cover.
    if (!k.plan) for (const v of [0.43, 0.5, 0.57]) k.line([[0.26, v, z1], [twin ? 0.74 : 0.6, v, z1]], shade(t.base, 0.72), 1, 0.45);
    if (!twin) k.poly([[0.64, 0.4, z1], [0.76, 0.4, z1], [0.76, 0.6, z1], [0.64, 0.6, z1]], shade(t.base, 1.06), 1, true);
    if (!k.plan) {
      k.line([[0.2, V + 0.001, z1 - h * 0.06], [0.8, V + 0.001, z1 - h * 0.06], [0.801, 0.36, z1 - h * 0.06]], shade(t.base, 0.6), 1, 0.35);
      const kk = plantFaceK(k, 'u');
      centres.forEach((cu, n) => {
        const pt = (rr: number, a: number): [number, number, number] => [cu + Math.cos(a) * rr * kk, V, cz + Math.sin(a) * rr];
        // Square bezel, rolled lip, dark throat, five pitched blades, hub.
        const b = r * 1.3;
        k.poly([[cu - b * kk, V, cz - b], [cu + b * kk, V, cz - b], [cu + b * kk, V, cz + b], [cu - b * kk, V, cz + b]], shade(t.base, 0.86), 1, true);
        k.line([[cu - b * kk, V, cz - b], [cu - b * kk, V, cz + b], [cu + b * kk, V, cz + b]], shade(t.base, 1.3), 1, 0.4);
        k.poly(plantFaceRing(k, 'u', V, cu, cz, r * 1.12, 16, 0, kk), shade(t.base, 1.12), 1, true);
        k.poly(plantFaceRing(k, 'u', V, cu, cz, r, 16, 0, kk), shade(t.base, 0.32), 1);
        const rot = k.rnd(5 + n) * Math.PI * 2;
        for (let i = 0; i < 5; i += 1) {
          const a = rot + (i / 5) * Math.PI * 2;
          k.poly([pt(r * 0.22, a - 0.25), pt(r * 0.92, a - 0.12), pt(r * 0.92, a + 0.5), pt(r * 0.22, a + 0.3)], shade(t.base, i % 2 === 0 ? 0.78 : 0.64), 1);
        }
        k.poly(plantFaceRing(k, 'u', V, cu, cz, r * 0.24, 8, 0, kk), shade(t.base, 0.95), 1, true);
        // Guard: two rings and a cross of wires.
        for (const rr of twin ? [0.95] : [0.55, 0.95]) {
          const ring = plantFaceRing(k, 'u', V, cu, cz, r * rr, 16, 0, kk);
          k.line([...ring, ring[0]!], shade(t.light, 1.08), 1, 0.5);
        }
        k.line([pt(r, 0), pt(r, Math.PI)], shade(t.light, 1.08), 1, 0.5);
        k.line([pt(r, Math.PI / 2), pt(r, -Math.PI / 2)], shade(t.light, 1.08), 1, 0.5);
        // Grime licked down under the throat.
        k.poly([[cu - r * 0.6 * kk, V, cz - r * 1.3], [cu + r * 0.6 * kk, V, cz - r * 1.3], [cu + r * 0.75 * kk, V, z0], [cu - r * 0.75 * kk, V, z0]], shade(t.base, 0.3), 0.12);
      });
      // Rating plate, louvres down the east side.
      if (!twin) k.facePanel('u', V, 0.7, z1 - h * 0.22, 0.77, z1 - h * 0.12, shade(t.light, 1.1), 0.5);
      for (let i = 0; i < 3; i += 1) {
        const z = z1 - h * (0.18 + i * 0.1);
        k.line([[0.801, 0.4, z], [0.801, 0.52, z]], shade(t.base, 0.45), 1, 0.55);
        k.line([[0.801, 0.4, z - h * 0.02], [0.801, 0.52, z - h * 0.02]], shade(t.base, 1.25), 1, 0.3);
      }
    }
    // Junction box and its conduit on the east side.
    const jz = h * (0.22 + k.rnd(6) * 0.15);
    k.box(0.8, 0.54, 0.85, 0.62, jz, jz + h * 0.2, shade(t.base, 0.85));
    if (!k.plan) k.line([[0.825, 0.58, jz], [0.825, 0.58, z0 + 0.01], [0.8, 0.6, z0]], shade(t.dark, 0.55), 1.5);
    if (k.plan) {
      // A fan on a floor plan: the grille edge and a crossed ring per fan.
      k.line([[0.22, 0.64, z1], [0.78, 0.64, z1]], shade(t.light, 1.1), 2, 0.9);
      for (const cu of centres) {
        const rr = twin ? 0.08 : 0.11;
        const ring = plantRing(cu, 0.5, rr, z1, 12);
        k.line([...ring, ring[0]!], t.ink, 1, 0.6);
        k.line([[cu - rr * 0.7, 0.5 - rr * 0.7, z1], [cu + rr * 0.7, 0.5 + rr * 0.7, z1]], t.ink, 1, 0.5);
        k.line([[cu + rr * 0.7, 0.5 - rr * 0.7, z1], [cu - rr * 0.7, 0.5 + rr * 0.7, z1]], t.ink, 1, 0.5);
      }
    }
    return null;
  },
  car: (k, h) => {
    const t = k.t;
    const H = h;
    // Parked either way round, so a row of them is not a stamp: nose or boot to the viewer.
    const flip = k.rnd(9) < 0.45;
    const M = (u: number): number => (flip ? 1 - u : u);
    const body = shade(t.base, 0.9 + k.rnd(1) * 0.18);
    const v0 = 0.27;
    const v1 = 0.73;
    const zb = 0.11 * H;
    const wr = 0.19 * H;
    const trim = shade(t.ink, 0.9);
    const red = 0x7a3228;
    const amber = 0x957040;
    // Far wheels, only their feet show under the sill; the west bumper behind the body.
    if (!k.plan) {
      k.faceCircle(0.24, v0 + 0.03, wr, wr, 'u', t.ink, 1);
      k.faceCircle(0.76, v0 + 0.03, wr, wr, 'u', t.ink, 1);
    }
    k.box(0.035, v0 + 0.01, 0.075, v1 + 0.005, zb, 0.21 * H, trim, { crown: false, ink: false });
    if (k.rnd(5) < 0.5 && !k.plan) k.line([[M(0.86), v0 + 0.04, 0.4 * H], [M(0.9), v0 + 0.04, 0.95 * H]], t.ink, 1, 0.8);
    // The shell: boot, deck, a bonnet falling to the nose.
    streetHull(k, streetMirror([[0.06, 0.42 * H], [0.3, 0.47 * H], [0.72, 0.47 * H], [0.94, 0.38 * H], [0.94, zb], [0.06, zb]], flip), v0, v1, body);
    const seam = shade(body, 0.45);
    // The shut line on the far end of the deck goes down before the cabin hides part of it.
    const shutW = flip ? 0.255 : 0.29;
    const shutE = flip ? 0.71 : 0.755;
    const zW = (flip ? 0.456 : 0.468) * H;
    const zE = (flip ? 0.468 : 0.456) * H;
    k.line([[shutW, 0.3, zW], [shutW, 0.7, zW]], shade(body, 0.62), 1, 0.45);
    if (!k.plan) {
      // Sill, door shuts and handles, fuel flap, a lamp at either end of the flank.
      k.poly([[0.06, v1, zb], [0.94, v1, zb], [0.94, v1, 0.19 * H], [0.06, v1, 0.19 * H]], shade(body, 0.53));
      if (k.rnd(4) < 0.3) k.facePanel('u', v1, M(0.53), 0.2 * H, M(0.68), 0.44 * H, shade(t.accent, 0.6));
      k.line([[M(0.35), v1, 0.2 * H], [M(0.35), v1, 0.44 * H], [M(0.68), v1, 0.44 * H], [M(0.68), v1, 0.2 * H]], seam, 1, 0.7);
      k.line([[M(0.525), v1, 0.2 * H], [M(0.525), v1, 0.44 * H]], seam, 1, 0.7);
      k.line([[M(0.45), v1, 0.39 * H], [M(0.49), v1, 0.39 * H]], t.light, 1, 0.7);
      k.line([[M(0.62), v1, 0.39 * H], [M(0.66), v1, 0.39 * H]], t.light, 1, 0.7);
      k.faceCircle(M(0.19), v1, 0.33 * H, 0.028, 'u', seam, 0.8);
      if (k.rnd(6) < 0.3) k.line([[M(0.39), v1, 0.29 * H], [M(0.5), v1, 0.33 * H], [M(0.63), v1, 0.3 * H]], t.light, 1, 0.3);
      k.facePanel('u', v1, M(0.065), 0.3 * H, M(0.1), 0.41 * H, red);
      k.facePanel('u', v1, M(0.895), 0.28 * H, M(0.935), 0.34 * H, amber);
      if (!flip) {
        // The nose: grille between the headlamps.
        k.facePanel('v', 0.94, v0 + 0.14, 0.2 * H, v1 - 0.14, 0.33 * H, t.ink, 0.85);
        k.facePanel('v', 0.94, v0 + 0.03, 0.26 * H, v0 + 0.12, 0.35 * H, t.light);
        k.facePanel('v', 0.94, v1 - 0.12, 0.26 * H, v1 - 0.03, 0.35 * H, t.light);
      } else {
        // The boot: its lid shut and the tail lamp clusters.
        k.line([[0.94, v0 + 0.05, 0.37 * H], [0.94, v1 - 0.05, 0.37 * H]], seam, 1, 0.7);
        k.facePanel('v', 0.94, v0 + 0.03, 0.24 * H, v0 + 0.14, 0.33 * H, red);
        k.facePanel('v', 0.94, v1 - 0.14, 0.24 * H, v1 - 0.03, 0.33 * H, red);
      }
    }
    k.box(0.925, v0 - 0.005, 0.965, v1 + 0.01, zb, 0.2 * H, trim, { crown: false, ink: false });
    k.facePanel('v', 0.966, 0.45, 0.125 * H, 0.55, 0.185 * H, t.light, 0.85);
    streetWheel(k, 0.24, v1 + 0.004, wr, shade(t.ink, 0.7));
    streetWheel(k, 0.76, v1 + 0.004, wr, shade(t.ink, 0.7));
    // Glasshouse: pillars in body colour, tinted glass, the east slope catching the sky.
    const zc = 0.47 * H;
    const zr = 0.84 * H;
    const ef = flip ? 0.67 : 0.73;
    const er = flip ? 0.6 : 0.64;
    const wf = flip ? 0.27 : 0.33;
    const wrf = flip ? 0.36 : 0.4;
    const pil = M(0.525);
    if (k.plan) {
      k.poly([[wf, 0.3, 0], [wrf, 0.32, 0], [wrf, 0.68, 0], [wf, 0.7, 0]], shade(GLASS, 0.42));
    } else {
      k.poly([[wf, 0.7, zc], [ef, 0.7, zc], [er, 0.68, zr], [wrf, 0.68, zr]], shade(body, 0.68));
      k.poly([[wf + 0.04, 0.699, zc + 0.04 * H], [pil - 0.015, 0.699, zc + 0.04 * H], [pil - 0.015, 0.683, zr - 0.04 * H], [wrf + 0.025, 0.683, zr - 0.04 * H]], shade(GLASS, 0.4));
      k.poly([[pil + 0.015, 0.699, zc + 0.04 * H], [ef - 0.04, 0.699, zc + 0.04 * H], [er - 0.015, 0.683, zr - 0.04 * H], [pil + 0.015, 0.683, zr - 0.04 * H]], shade(GLASS, 0.4));
    }
    k.poly([[ef, 0.7, zc], [ef, 0.3, zc], [er, 0.32, zr], [er, 0.68, zr]], shade(body, 0.76));
    k.poly([[ef - 0.01, 0.67, zc + 0.03 * H], [ef - 0.01, 0.33, zc + 0.03 * H], [er + 0.01, 0.345, zr - 0.03 * H], [er + 0.01, 0.655, zr - 0.03 * H]], shade(GLASS, 0.56));
    if (!k.plan) {
      k.line([[ef - 0.014, 0.58, zc + 0.05 * H], [er + 0.02, 0.44, zr - 0.05 * H]], GLASS, 1.5, 0.3);
      if (!flip) k.line([[ef - 0.012, 0.36, zc + 0.045 * H], [ef - 0.026, 0.52, zc + 0.1 * H]], t.ink, 1, 0.6);
      else k.line([[er + 0.008, 0.43, zr - 0.035 * H], [er + 0.008, 0.57, zr - 0.035 * H]], red, 1.5, 0.9);
    }
    if (!flip && k.rnd(3) < 0.3) k.poly([[0.716, 0.64, zc + 0.045 * H], [0.716, 0.6, zc + 0.045 * H], [0.708, 0.603, zc + 0.1 * H], [0.708, 0.643, zc + 0.1 * H]], t.light, 0.75);
    k.poly([[wrf, 0.32, zr], [er, 0.32, zr], [er, 0.68, zr], [wrf, 0.68, zr]], k.plan ? body : shade(body, 0.875));
    k.line([[shutE, 0.3, zE], [shutE, 0.7, zE]], shade(body, 0.62), 1, 0.45);
    if (!k.plan) {
      k.line([[wrf, 0.68, zr], [er, 0.68, zr], [er, 0.32, zr]], shade(body, 1.35), 1, 0.42);
      k.line([[wf, 0.7, zc], [wrf, 0.68, zr], [wrf, 0.32, zr], [er, 0.32, zr], [ef, 0.3, zc]], t.ink, 1, 0.5);
    } else {
      k.line([[wrf, 0.32, 0], [er, 0.32, 0], [er, 0.68, 0], [wrf, 0.68, 0], [wrf, 0.32, 0]], t.ink, 1, 0.5);
      // Lamps give the plan symbol its nose and tail.
      k.poly([[M(0.9), v0 + 0.03, 0], [M(0.935), v0 + 0.03, 0], [M(0.935), v0 + 0.12, 0], [M(0.9), v0 + 0.12, 0]], t.light);
      k.poly([[M(0.9), v1 - 0.12, 0], [M(0.935), v1 - 0.12, 0], [M(0.935), v1 - 0.03, 0], [M(0.9), v1 - 0.03, 0]], t.light);
      k.poly([[M(0.065), v0 + 0.02, 0], [M(0.09), v0 + 0.02, 0], [M(0.09), v0 + 0.1, 0], [M(0.065), v0 + 0.1, 0]], red);
      k.poly([[M(0.065), v1 - 0.1, 0], [M(0.09), v1 - 0.1, 0], [M(0.09), v1 - 0.02, 0], [M(0.065), v1 - 0.02, 0]], red);
    }
    // Roof: a rack, a sunroof, a cab sign, or bare.
    const roof = k.rnd(2);
    if (roof < 0.28) {
      k.line([[M(0.45), 0.34, zr + 0.03 * H], [M(0.45), 0.66, zr + 0.03 * H]], t.ink, 1.5, 0.9);
      k.line([[M(0.59), 0.34, zr + 0.03 * H], [M(0.59), 0.66, zr + 0.03 * H]], t.ink, 1.5, 0.9);
    } else if (roof < 0.48) {
      k.poly([[M(0.46), 0.4, zr + 0.002], [M(0.58), 0.4, zr + 0.002], [M(0.58), 0.6, zr + 0.002], [M(0.46), 0.6, zr + 0.002]], shade(GLASS, 0.34));
    } else if (roof < 0.58) {
      k.box(Math.min(M(0.49), M(0.55)), 0.42, Math.max(M(0.49), M(0.55)), 0.58, zr, zr + 0.06 * H, t.light, { crown: false });
    }
    // Wing mirrors at the foot of the front pillars (the far one only shows from above).
    const mu0 = Math.min(M(0.67), M(0.7));
    const mu1 = Math.max(M(0.67), M(0.7));
    if (k.plan) k.box(mu0, v0 - 0.035, mu1, v0, 0.46 * H, 0.53 * H, t.dark, { crown: false, ink: false });
    k.box(mu0, v1, mu1, v1 + 0.035, 0.46 * H, 0.53 * H, t.dark, { crown: false, ink: false });
    return null;
  },
  van: (k, h) => {
    const t = k.t;
    const H = h;
    // Parked either way round; nearly half are open-bed trucks with a load on. The design cannot tell
    // the sprawl delivery van from the countryside pickup, and at one in four the pickup was a box van
    // three times out of four; a delivery truck with an open bed is still a delivery truck.
    const flip = k.rnd(9) < 0.4;
    const M = (u: number): number => (flip ? 1 - u : u);
    const bed = k.rnd(8) < 0.45;
    const v0 = 0.24;
    const v1 = 0.76;
    const zb = 0.12 * H;
    const wr = 0.2 * H;
    const boxc = t.base;
    const cab = shade(t.accent, 0.96 + k.rnd(1) * 0.1);
    const trim = shade(t.ink, 0.9);
    const red = 0x7a3228;
    const amber = 0x957040;
    const bu0 = flip ? 0.4 : 0.05;
    const bu1 = flip ? 0.95 : 0.6;
    if (!k.plan) {
      k.faceCircle(0.2, v0 + 0.04, wr, wr, 'u', t.ink, 1);
      k.faceCircle(0.8, v0 + 0.04, wr, wr, 'u', t.ink, 1);
    }
    const back = (): void => {
      if (bed) {
        // An open bed: far and back walls, the floor, the load, then the near walls over it.
        const zr = 0.46 * H;
        const zf = zb + 0.07 * H;
        const w = 0.028;
        k.box(bu0, v0, bu1, v0 + w, zb, zr, boxc, { crown: false });
        k.box(bu0, v0 + w, bu0 + w, v1 - w, zb, zr, boxc, { crown: false });
        k.poly([[bu0 + w, v0 + w, zf], [bu1 - w, v0 + w, zf], [bu1 - w, v1 - w, zf], [bu0 + w, v1 - w, zf]], shade(boxc, 0.55));
        const a = bu0 + w;
        const b = bu1 - w;
        if (k.rnd(3) < 0.55) {
          // A tarp roped over whatever it is.
          streetHull(k, [[a + 0.02, zf + 0.12 * H], [a + 0.08, zf + 0.34 * H], [b - 0.1, zf + 0.36 * H], [b - 0.02, zf + 0.14 * H], [b - 0.02, zf], [a + 0.02, zf]], v0 + w + 0.02, v1 - w - 0.02, shade(t.dark, 1.05));
          if (!k.plan) {
            for (const u of [a + 0.15, b - 0.17]) k.line([[u, v0 + w + 0.02, zf + 0.35 * H], [u, v1 - w - 0.02, zf + 0.35 * H], [u, v1 - w - 0.02, zf + 0.08 * H]], t.ink, 1, 0.6);
          }
        } else {
          const crate = shade(t.light, 0.9);
          k.box(a + 0.03, v0 + 0.05, a + 0.24, v0 + 0.27, zf, zf + 0.3 * H, crate);
          k.box(b - 0.24, v0 + 0.22, b - 0.03, v1 - 0.06, zf, zf + 0.42 * H, shade(crate, 0.88));
          if (!k.plan) k.line([[b - 0.24, v1 - 0.06, zf + 0.21 * H], [b - 0.03, v1 - 0.06, zf + 0.21 * H], [b - 0.03, v0 + 0.22, zf + 0.21 * H]], shade(crate, 0.6), 1, 0.5);
        }
        k.box(bu1 - w, v0 + w, bu1, v1 - w, zb, zr, boxc, { crown: false });
        k.box(bu0, v1 - w, bu1, v1, zb, zr, boxc, { crown: false });
        if (!k.plan) {
          k.facePanel('u', v1, bu0 + 0.02, 0.24 * H, bu1 - 0.02, 0.3 * H, t.dark, 0.8);
          k.facePanel('u', v1, M(0.055), 0.34 * H, M(0.085), 0.44 * H, red);
          if (flip) {
            k.line([[0.95, 0.44, 0.38 * H], [0.95, 0.56, 0.38 * H]], t.light, 1.5, 0.7);
            k.facePanel('v', 0.95, v0 + 0.03, 0.3 * H, v0 + 0.09, 0.42 * H, red);
            k.facePanel('v', 0.95, v1 - 0.09, 0.3 * H, v1 - 0.03, 0.42 * H, red);
          }
        }
      } else {
        // The cargo box.
        k.box(bu0, v0, bu1, v1, zb, H, boxc);
        if (!k.plan) {
          const livery = k.rnd(2);
          if (livery < 0.4) {
            k.facePanel('u', v1, M(0.09), 0.52 * H, M(0.56), 0.72 * H, t.accent, 0.95);
            k.faceCircle(M(0.2), v1, 0.62 * H, 0.075 * H, 'u', t.light, 0.85);
            k.line([[M(0.28), v1, 0.64 * H], [M(0.5), v1, 0.64 * H]], t.light, 1, 0.55);
          } else if (livery < 0.75) {
            const zig: Array<[number, number, number]> = [];
            for (let i = 0; i < 5; i += 1) {
              const u = M(0.14 + i * 0.1);
              zig.push(i % 2 === 0 ? [u, v1, zb + 0.04 * H] : [u, v1, H * 0.95], i % 2 === 0 ? [u, v1, H * 0.95] : [u, v1, zb + 0.04 * H]);
            }
            k.line(zig, shade(boxc, 0.55), 1, 0.4);
          } else {
            k.line([[M(0.22), v1, H * 0.98], [M(0.22), v1, H * 0.66]], shade(boxc, 0.5), 1, 0.45);
            k.line([[M(0.41), v1, H * 0.98], [M(0.42), v1, H * 0.74]], shade(boxc, 0.5), 1, 0.35);
          }
          k.facePanel('u', v1, M(0.06), 0.3 * H, M(0.59), 0.36 * H, t.dark, 0.8);
          k.line([[M(0.075), v1, zb], [M(0.075), v1, H * 0.98]], shade(boxc, 0.5), 1, 0.55);
          k.facePanel('u', v1, M(0.055), 0.18 * H, M(0.085), 0.3 * H, red);
          if (flip) {
            // Rear doors: the split, two bar handles, lamp clusters.
            k.line([[0.95, 0.5, zb + 0.02 * H], [0.95, 0.5, 0.97 * H]], shade(boxc, 0.45), 1, 0.75);
            k.line([[0.95, 0.465, 0.48 * H], [0.95, 0.465, 0.64 * H]], t.light, 1.5, 0.7);
            k.line([[0.95, 0.535, 0.48 * H], [0.95, 0.535, 0.64 * H]], t.light, 1.5, 0.7);
            k.facePanel('v', 0.95, v0 + 0.03, 0.2 * H, v0 + 0.09, 0.38 * H, red);
            k.facePanel('v', 0.95, v1 - 0.09, 0.2 * H, v1 - 0.03, 0.38 * H, red);
          } else {
            k.facePanel('v', 0.6, v0 + 0.05, 0.9 * H, v0 + 0.09, 0.95 * H, amber);
            k.facePanel('v', 0.6, v1 - 0.09, 0.9 * H, v1 - 0.05, 0.95 * H, amber);
          }
        }
        // Roof ribs, a vent, sometimes a ladder up the back corner.
        if (!k.plan) {
          const ribs: Array<[number, number, number]> = [];
          for (let i = 1; i < 5; i += 1) {
            const u = bu0 + ((bu1 - bu0) * i) / 5;
            ribs.push(...(i % 2 ? [[u, v0 + 0.02, H], [u, v1 - 0.02, H]] : [[u, v1 - 0.02, H], [u, v0 + 0.02, H]]) as Array<[number, number, number]>);
          }
          k.line(ribs, shade(boxc, 0.7), 1, 0.3);
        }
        k.box(Math.min(M(0.28), M(0.38)), 0.44, Math.max(M(0.28), M(0.38)), 0.56, H, H + 0.05 * H, shade(boxc, 1.08), { crown: false });
        if (k.rnd(3) < 0.4 && !k.plan) {
          k.line([[M(0.1), v1 + 0.01, zb + 0.1 * H], [M(0.1), v1 + 0.01, H], [M(0.1), v1 - 0.03, H + 0.03 * H]], t.dark, 1.5, 0.9);
        }
      }
      if (flip) {
        k.box(0.945, v0 + 0.01, 0.975, v1 - 0.01, zb, 0.22 * H, trim, { crown: false, ink: false });
        k.facePanel('v', 0.976, 0.45, 0.13 * H, 0.55, 0.2 * H, t.light, 0.85);
      }
      streetWheel(k, M(0.2), v1 + 0.004, wr, shade(t.ink, 0.7));
    };
    const front = (): void => {
      // The cab: roof, windscreen, short bonnet, nose.
      if (!flip) {
        k.box(0.945, 0.25, 0.975, 0.75, zb, 0.22 * H, trim, { crown: false, ink: false });
        k.facePanel('v', 0.976, 0.45, 0.13 * H, 0.55, 0.2 * H, t.light, 0.85);
      }
      const cv0 = 0.26;
      const cv1 = 0.74;
      streetHull(k, streetMirror([[0.6, 0.86 * H], [0.73, 0.86 * H], [0.84, 0.52 * H], [0.95, 0.46 * H], [0.95, zb], [0.6, zb]], flip), cv0, cv1, cab);
      if (!flip || k.plan) k.poly([[M(0.83), cv1 - 0.025, 0.55 * H], [M(0.83), cv0 + 0.025, 0.55 * H], [M(0.738), cv0 + 0.03, 0.83 * H], [M(0.738), cv1 - 0.03, 0.83 * H]], shade(GLASS, 0.56));
      if (!k.plan) {
        if (!flip) k.line([[0.826, 0.62, 0.58 * H], [0.75, 0.45, 0.8 * H]], GLASS, 1.5, 0.3);
        k.poly([[M(0.625), cv1, 0.56 * H], [M(0.8), cv1, 0.56 * H], [M(0.722), cv1, 0.82 * H], [M(0.625), cv1, 0.82 * H]], shade(GLASS, 0.4));
        k.poly([[M(0.6), cv1, zb], [M(0.95), cv1, zb], [M(0.95), cv1, 0.2 * H], [M(0.6), cv1, 0.2 * H]], shade(cab, 0.5));
        k.line([[M(0.62), cv1, 0.2 * H], [M(0.62), cv1, 0.84 * H]], shade(cab, 0.45), 1, 0.7);
        k.line([[M(0.83), cv1, 0.2 * H], [M(0.83), cv1, 0.52 * H]], shade(cab, 0.45), 1, 0.7);
        k.line([[M(0.66), cv1, 0.48 * H], [M(0.7), cv1, 0.48 * H]], t.light, 1, 0.7);
        k.facePanel('u', cv1, M(0.9), 0.3 * H, M(0.94), 0.36 * H, amber);
        if (!flip) {
          k.facePanel('v', 0.95, 0.4, 0.22 * H, 0.6, 0.4 * H, t.ink, 0.85);
          k.line([[0.95, 0.41, 0.31 * H], [0.95, 0.59, 0.31 * H]], t.dark, 1, 0.6);
          k.facePanel('v', 0.95, 0.29, 0.28 * H, 0.37, 0.38 * H, t.light);
          k.facePanel('v', 0.95, 0.63, 0.28 * H, 0.71, 0.38 * H, t.light);
        }
      } else {
        k.poly([[M(0.91), 0.28, 0], [M(0.945), 0.28, 0], [M(0.945), 0.37, 0], [M(0.91), 0.37, 0]], t.light);
        k.poly([[M(0.91), 0.63, 0], [M(0.945), 0.63, 0], [M(0.945), 0.72, 0], [M(0.91), 0.72, 0]], t.light);
      }
      streetWheel(k, M(0.8), cv1 + 0.004, wr, shade(t.ink, 0.7));
      k.box(Math.min(M(0.79), M(0.82)), cv1, Math.max(M(0.79), M(0.82)), cv1 + 0.04, 0.54 * H, 0.66 * H, t.dark, { crown: false, ink: false });
    };
    if (flip) {
      front();
      back();
    } else {
      back();
      front();
    }
    return null;
  },
  tree: (k, h) => {
    const t = k.t;
    const leaf = t.base;
    const s = 0.9 + k.rnd(1) * 0.14;
    const cu = 0.5 + (k.rnd(2) - 0.5) * 0.04;
    const cv = 0.5 + (k.rnd(3) - 0.5) * 0.04;
    const rot = k.rnd(4) * Math.PI * 2;
    // Some crowns grow tall and narrow on a longer bole, some round and low.
    const tall = k.rnd(6) < 0.4;
    const w = tall ? 0.84 : 1;
    const lift = tall ? h * 0.1 : 0;
    const zc = h * (0.84 + k.rnd(5) * 0.08) + lift;
    const bark = greenMix(0x5b4a3a, t.dark, 0.25);
    if (!k.plan) {
      // Bare earth round the foot, roots running into it, a few fallen leaves.
      k.disc(0.5, 0.5, 0.16, 0, shade(bark, 0.5), 0.3);
      for (const [du, dv] of [[0.12, 0.03], [0.02, 0.12], [0.1, -0.07], [-0.07, 0.09]] as const) {
        k.line([[0.5, 0.5, h * 0.05], [0.5 + du * 0.5, 0.5 + dv * 0.5, 0.012], [0.5 + du, 0.5 + dv, 0]], shade(bark, 0.82), 2, 0.85);
      }
      for (let i = 0; i < 3; i += 1) {
        const a = Math.PI * 0.25 + (k.rnd(90 + i) - 0.5) * 2.4;
        const d = 0.2 + k.rnd(95 + i) * 0.18;
        k.disc(0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, 0.016, 0, shade(leaf, 0.75 + i * 0.12), 0.85);
      }
      // A tapering bole: furrowed bark, a lit edge where the key light rakes it.
      const r0 = 0.065;
      const r1 = 0.04;
      const zt = zc - 0.05;
      k.poly([[0.5 - r0, 0.5 + r0, 0], [0.5 + r0, 0.5 + r0, 0], [0.5 + r1, 0.5 + r1, zt], [0.5 - r1, 0.5 + r1, zt]], bark);
      k.poly([[0.5 + r0, 0.5 + r0, 0], [0.5 + r0, 0.5 - r0, 0], [0.5 + r1, 0.5 - r1, zt], [0.5 + r1, 0.5 + r1, zt]], shade(bark, 0.72));
      k.line([[0.5 - r0 * 0.3, 0.5 + r0, h * 0.03], [0.5 - r1 * 0.1, 0.5 + (r0 + r1) / 2, zt * 0.5], [0.5 - r1 * 0.4, 0.5 + r1, zt * 0.9]], shade(bark, 0.66), 1, 0.8);
      k.line([[0.5 + r0 * 0.55, 0.5 + r0, h * 0.02], [0.5 + r1 * 0.6, 0.5 + r1, zt * 0.8]], shade(bark, 0.7), 1, 0.6);
      k.line([[0.5 - r0 + 0.01, 0.5 + r0, 0.02], [0.5 - r1 + 0.008, 0.5 + r1, zt]], shade(bark, 1.32), 1, 0.45);
      k.line([[0.5 - r1, 0.5 + r1, zt], [0.5 - r0, 0.5 + r0, 0], [0.5 + r0, 0.5 + r0, 0], [0.5 + r0, 0.5 - r0, 0], [0.5 + r1, 0.5 - r1, zt]], t.ink, 1, 0.55);
      // The fork: two limbs up into the crown.
      k.line([[0.5, 0.5, zt * 0.55], [cu - 0.1 * w, cv + 0.08 * w, zc - 0.03]], bark, 2, 0.95);
      k.line([[0.5, 0.5, zt * 0.6], [cu + 0.09 * w, cv - 0.1 * w, zc]], shade(bark, 0.8), 2, 0.95);
      k.line([[0.5, 0.5 + 0.02, zt * 0.7], [cu + 0.02, cv + 0.15 * w, zc - 0.08], [cu + 0.05, cv + 0.2 * w, zc - 0.05]], shade(bark, 0.9), 1.5, 0.9);
    }
    // The crown: three rings of clumps, dark underneath and lit on top.
    greenRing(k, cu, cv, 6, 0.27 * s * w, zc - 0.1, 0.17 * s, shade(leaf, 0.62), rot, 10, true, shade(leaf, 0.78));
    greenRing(k, cu, cv, 5, 0.16 * s * w, zc + 0.06 + lift * 0.3, 0.16 * s, shade(leaf, 0.8), rot + 0.6, 30, !k.plan, shade(leaf, 0.95));
    greenRing(k, cu, cv, 3, 0.08 * s * w, zc + 0.19 + lift * 0.6, 0.13 * s, shade(leaf, 0.96), rot + 1.2, 50, false, shade(leaf, 1.1));
    for (let i = 0; i < 2; i += 1) {
      greenPuff(k, cu - 0.07 + i * 0.06, cv - 0.02 + (k.rnd(60 + i) - 0.5) * 0.06, zc + 0.28 + lift * 0.8, 0.065 * s, shade(leaf, 1.16), 60 + i);
    }
    for (let i = 0; i < 2; i += 1) {
      k.disc(cu + (k.rnd(70 + i) - 0.6) * 0.26, cv + (k.rnd(80 + i) - 0.6) * 0.26, 0.022, zc + 0.22 + lift, shade(t.light, 1.18), 0.55);
    }
    return null;
  },
  bush: (k, h) => {
    const t = k.t;
    const leaf = t.base;
    const s = 0.9 + k.rnd(1) * 0.12;
    const cu = 0.5 + (k.rnd(2) - 0.5) * 0.04;
    const cv = 0.5 + (k.rnd(3) - 0.5) * 0.04;
    const rot = k.rnd(4) * Math.PI * 2;
    // Leafy with bare canes, in flower, wiry scrub, or in berry.
    const kind = Math.floor(k.rnd(5) * 4);
    const twig = greenMix(0x5b4a3a, t.dark, 0.3);
    if (!k.plan) {
      // Dead leaves dropped round the near side of the foot.
      for (let i = 0; i < 3; i += 1) {
        const a = Math.PI * 0.25 + (k.rnd(40 + i) - 0.5) * 2.2;
        const d = 0.27 + k.rnd(45 + i) * 0.06;
        k.disc(cu + Math.cos(a) * d, cv + Math.sin(a) * d, 0.016, 0, shade(i === 1 ? twig : leaf, 0.8 + i * 0.1), 0.85);
      }
      // Bare canes standing out of the back of the mound.
      k.line([[cu - 0.05, cv - 0.02, h * 0.4], [cu - 0.14, cv - 0.09, h * 0.8], [cu - 0.2, cv - 0.14, h * 1.05]], twig, 1, 0.9);
      if (kind === 0) k.line([[cu + 0.02, cv - 0.06, h * 0.4], [cu + 0.12, cv - 0.22, h * 0.95]], twig, 1, 0.9);
    }
    greenRing(k, cu, cv, 5, 0.17 * s, h * 0.36, 0.12 * s, shade(leaf, 0.62), rot, 10, true, shade(leaf, 0.76));
    greenRing(k, cu, cv, 4, 0.1 * s, h * 0.62, 0.115 * s, shade(leaf, 0.84), rot + 0.7, 30, !k.plan, shade(leaf, 0.98));
    greenRing(k, cu, cv, 2, 0.05 * s, h * 0.86, 0.09 * s, leaf, rot + 1.4, 50, false, shade(leaf, 1.12));
    greenPuff(k, cu - 0.04, cv + 0.01, h * 0.98, 0.05 * s, shade(leaf, 1.16), 70);
    if (kind === 1) {
      // In flower: pale blossom dotted over the dome.
      for (let i = 0; i < 7; i += 1) {
        const a = rot + i * 2.4;
        const d = 0.04 + k.rnd(80 + i) * 0.15;
        k.disc(cu + Math.cos(a) * d, cv + Math.sin(a) * d, 0.02, h * (1.0 - 12 * d * d), shade(t.light, i % 3 === 0 ? 1.3 : 1.16), 0.9);
      }
    } else if (kind === 2) {
      // Scrub: wiry stems breaking the outline, a leaf at each tip.
      for (let i = 0; i < 5; i += 1) {
        const a = rot + 0.4 + i * 1.257;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const z = h * (0.7 + k.rnd(90 + i) * 0.35);
        k.line([[cu + c * 0.16, cv + sn * 0.16, h * 0.45], [cu + c * 0.3, cv + sn * 0.3, z]], twig, 1, 0.95);
        k.disc(cu + c * 0.3, cv + sn * 0.3, 0.025, z, shade(leaf, 0.9), 1);
      }
    } else if (kind === 3) {
      // In berry: clusters of fruit, a glint on the ripest of each.
      const berry = 0x8c3c46;
      for (let c = 0; c < 3; c += 1) {
        const a = rot + 0.3 + c * 2.1;
        const d = 0.08 + k.rnd(80 + c) * 0.1;
        const bu = cu + Math.cos(a) * d;
        const bv = cv + Math.sin(a) * d;
        const bz = h * (0.95 - 10 * d * d);
        for (let i = 0; i < 3; i += 1) {
          const e = c * 2 + i * 2.1;
          k.disc(bu + Math.cos(e) * 0.025, bv + Math.sin(e) * 0.025, 0.02, bz - i * 0.01, i === 0 ? berry : shade(berry, 0.78), 1);
        }
        if (!k.plan) k.disc(bu + Math.cos(c * 2) * 0.025 - 0.005, bv + Math.sin(c * 2) * 0.025 + 0.005, 0.008, bz + 0.012, shade(t.light, 1.2), 0.85);
      }
    }
    return null;
  },
  planter: (k, h) => {
    const t = k.t;
    const zb = h * 0.62;
    const zr = h * 0.74;
    const zs = h * 0.64;
    const soil = greenMix(0x4a3c30, t.dark, 0.3);
    if (!k.plan) {
      // A shadow gap where the box sits on its recessed plinth.
      k.facePanel('u', 0.82, 0.18, 0, 0.82, 0.04, t.ink, 0.9);
      k.facePanel('v', 0.82, 0.18, 0, 0.82, 0.04, shade(t.ink, 0.85), 0.9);
      k.box(0.15, 0.15, 0.85, 0.85, 0.04, zb, t.base, { crown: false });
      // Panel joints on both faces, the lit near arris, the shadow under the lip.
      for (const a of [0.383, 0.617]) {
        k.line([[a, 0.85, 0.04], [a, 0.85, zb]], t.dark, 1, 0.55);
        k.line([[0.85, a, 0.04], [0.85, a, zb]], t.dark, 1, 0.45);
      }
      k.line([[0.85, 0.85, 0.05], [0.85, 0.85, zb - h * 0.04]], shade(t.base, 1.28), 1, 0.4);
      k.facePanel('u', 0.851, 0.15, zb - h * 0.05, 0.85, zb, t.ink, 0.16);
      // A drip stain from the soil, and moss creeping up from the foot on some.
      const d = 0.2 + k.rnd(9) * 0.5;
      k.facePanel('u', 0.851, d, h * 0.15, d + 0.07, zb, t.ink, 0.14);
      if (k.rnd(8) < 0.5) {
        const m = 0.17 + k.rnd(10) * 0.4;
        k.poly([[m, 0.852, 0.04], [m + 0.26, 0.852, 0.04], [m + 0.19, 0.852, 0.04 + h * 0.07], [m + 0.06, 0.852, 0.04 + h * 0.12]], shade(FOLIAGE, 0.62), 0.45);
      }
    }
    // The lip, mitred at the corners, the shadowed opening, the soil inside.
    k.box(0.13, 0.13, 0.87, 0.87, zb, zr, shade(t.base, 1.1));
    for (const [u0, v0, du, dv] of [[0.13, 0.13, 1, 1], [0.87, 0.13, -1, 1], [0.87, 0.87, -1, -1], [0.13, 0.87, 1, -1]] as const) {
      k.line([[u0, v0, zr], [u0 + du * 0.07, v0 + dv * 0.07, zr]], shade(t.base, 0.8), 1, 0.6);
    }
    k.poly([[0.2, 0.2, zr], [0.8, 0.2, zr], [0.8, 0.8, zr], [0.2, 0.8, zr]], shade(t.base, 0.55));
    k.poly([[0.2, 0.2, zs], [0.8, 0.2, zr], [0.8, 0.8, zr], [0.2, 0.8, zr]], soil);
    if (!k.plan) {
      // Bark chips on the soil where the planting leaves it bare.
      for (let i = 0; i < 3; i += 1) {
        k.disc(0.26 + k.rnd(11 + i) * 0.48, 0.68 + k.rnd(14 + i) * 0.08, 0.014, zr, shade(soil, 1.5), 0.7);
      }
    }
    // A clipped shrub, grasses, bedding flowers, or a topiary ball on a stem.
    const kind = Math.floor(k.rnd(5) * 4);
    const rot = k.rnd(4) * Math.PI * 2;
    if (kind === 0) {
      greenRing(k, 0.5, 0.5, 5, 0.15, zs + 0.1, 0.12, shade(FOLIAGE, 0.66), rot, 10, true, shade(FOLIAGE, 0.8));
      greenRing(k, 0.5, 0.5, 3, 0.08, zs + 0.23, 0.11, shade(FOLIAGE, 0.86), rot + 0.8, 30, !k.plan, shade(FOLIAGE, 1.0));
      greenPuff(k, 0.47, 0.5, zs + 0.35, 0.075, shade(FOLIAGE, 1.1), 40);
      // One clump grown out over the near lip, still joined to the shrub.
      greenLobe(k, 0.6, 0.72, zr + 0.04, 0.09, shade(FOLIAGE, 0.78), 50, true, shade(FOLIAGE, 0.9));
    } else if (kind === 1) {
      // A tussock, blades fanning out of it, seed heads nodding at the tips.
      greenPuff(k, 0.5, 0.5, zs + 0.05, 0.12, shade(FOLIAGE, 0.62), 10, true);
      const blades: Array<[number, number, number, number]> = [];
      for (let i = 0; i < 10; i += 1) {
        const a = rot + i * 0.628;
        const l = 0.17 + k.rnd(20 + i) * 0.1;
        blades.push([Math.cos(a) * l, Math.sin(a) * l, h * (0.42 + k.rnd(30 + i) * 0.3), i]);
      }
      blades.sort((p, q) => p[0] + p[1] - (q[0] + q[1]));
      for (const [du, dv, hz, i] of blades) {
        k.line([[0.5 + du * 0.15, 0.5 + dv * 0.15, zs + 0.03], [0.5 + du * 0.6, 0.5 + dv * 0.6, zs + hz * 0.7], [0.5 + du, 0.5 + dv, zs + hz]], shade(FOLIAGE, [0.8, 1.0, 1.16][i % 3]!), 1.5, 0.95);
        if (i % 4 === 1) k.disc(0.5 + du, 0.5 + dv, 0.022, zs + hz, 0x9c8f64, 0.95);
      }
    } else if (kind === 2) {
      // Bedding flowers over a low mound of leaves.
      greenRing(k, 0.5, 0.5, 5, 0.14, zs + 0.07, 0.1, shade(FOLIAGE, 0.66), rot, 10, true, shade(FOLIAGE, 0.8));
      greenRing(k, 0.5, 0.5, 3, 0.06, zs + 0.16, 0.09, shade(FOLIAGE, 0.9), rot + 0.6, 30, false);
      const bloom = k.rnd(6) < 0.5 ? 0xb89660 : 0xa87468;
      for (let i = 0; i < 7; i += 1) {
        const a = rot + i * 2.4;
        const d = 0.03 + k.rnd(40 + i) * 0.17;
        k.disc(0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, 0.026, zs + 0.24 - d * 0.8, i % 3 === 0 ? shade(bloom, 1.1) : bloom, 0.95);
      }
    } else {
      // Ground cover round a clean stem, a clipped ball on top.
      greenRing(k, 0.5, 0.5, 6, 0.18, zs + 0.03, 0.08, shade(FOLIAGE, 0.6), rot, 10, !k.plan, shade(FOLIAGE, 0.72));
      if (!k.plan) k.line([[0.5, 0.5, zs + 0.02], [0.5, 0.5, zs + 0.3]], greenMix(0x5b4a3a, t.dark, 0.3), 2, 1);
      greenLobe(k, 0.5, 0.5, zs + 0.4, 0.15, shade(FOLIAGE, 0.8), 20, true, shade(FOLIAGE, 0.96));
      greenPuff(k, 0.46, 0.53, zs + 0.47, 0.055, shade(FOLIAGE, 1.12), 25);
    }
    return null;
  },
  hydrant: (k, h) => {
    const t = k.t;
    const red = t.base;
    const nut = 0x9a958b;
    const alongU = k.rnd(1) < 0.5;
    const zn = h * 0.5;
    const side: 'u' | 'v' = alongU ? 'u' : 'v';
    const front: 'u' | 'v' = alongU ? 'v' : 'u';
    // Flange on its bolt ring.
    plantSlab(k, 0.5, 0.5, 0.125, 0, h * 0.07, shade(red, 0.78), 10);
    if (k.plan) {
      // The floor-plan symbol: the three outlets as capped stubs under the bonnet, the bonnet over them, the nut.
      // (Drawn in plan order: a nozzle at waist height must not paint over the bonnet above it.)
      plantPipe(k, side, 0.335, 0.665, 0.5, zn, 0.034, 0.034, red);
      for (const a of [0.335, 0.62]) plantPipe(k, side, a, a + 0.045, 0.5, zn, 0.048, 0.048, nut);
      plantPipe(k, front, 0.5, 0.645, 0.5, zn, 0.05, 0.05, red);
      plantPipe(k, front, 0.595, 0.645, 0.5, zn, 0.064, 0.064, nut);
      const cls = k.rnd(8);
      plantSlab(k, 0.5, 0.5, 0.1, h * 0.68, h * 0.72, red, 10);
      plantTurn(k, 0.5, 0.5, 0.09, 0.042, h * 0.72, h * 0.82, cls < 0.5 ? shade(red, 1.04) : cls < 0.78 ? nut : 0xa88c52, { n: 10 });
      plantSlab(k, 0.5, 0.5, 0.028, h * 0.82, h * 0.88, nut, 5, k.rnd(4));
      return null;
    }
    k.line(plantArc(0.5, 0.5, 0.105, h * 0.072, Math.PI * 0.75, -Math.PI / 4, 6), shade(red, 0.45), 1, 0.5);
    // The far side nozzle, before the barrel covers its root.
    plantPipe(k, side, 0.335, 0.385, 0.5, zn, 0.046, 0.046, nut, { facets: 2 });
    plantPipe(k, side, 0.385, 0.5, 0.5, zn, 0.034, 0.034, red, { facets: 2, cap: null });
    // Barrel, the nozzle section, the bonnet and its operating nut.
    plantTurn(k, 0.5, 0.5, 0.082, 0.076, h * 0.07, h * 0.68, red, { n: 10, cap: false, foot: true });
    plantTurn(k, 0.5, 0.5, 0.094, 0.094, h * 0.4, h * 0.6, shade(red, 1.04), { n: 10, cap: false });
    if (!k.plan && k.rnd(2) < 0.6) {
      const a = 0.3 + k.rnd(3) * 1.0;
      k.poly([plantShell(0.5, 0.5, 0.085, a, -0.02, h * 0.3), plantShell(0.5, 0.5, 0.085, a, 0.02, h * 0.33), plantShell(0.5, 0.5, 0.083, a, 0.012, h * 0.1), plantShell(0.5, 0.5, 0.083, a, -0.012, h * 0.12)], shade(red, 0.45), 0.3);
    }
    plantSlab(k, 0.5, 0.5, 0.1, h * 0.68, h * 0.72, red, 10);
    // The bonnet is painted to the main's flow class: red, galvanised, or ochre.
    const cls = k.rnd(8);
    const bonnet = cls < 0.5 ? shade(red, 1.04) : cls < 0.78 ? nut : 0xa88c52;
    plantTurn(k, 0.5, 0.5, 0.09, 0.042, h * 0.72, h * 0.82, bonnet, { n: 10, crown: true });
    plantSlab(k, 0.5, 0.5, 0.028, h * 0.82, h * 0.88, nut, 5, k.rnd(4));
    // The near side nozzle and the big pumper connection, capped, one on a chain.
    plantPipe(k, side, 0.5, 0.6, 0.5, zn, 0.034, 0.034, red, { facets: 2, cap: null });
    plantPipe(k, side, 0.6, 0.655, 0.5, zn, 0.046, 0.046, nut, { facets: 2 });
    plantPipe(k, front, 0.5, 0.59, 0.5, zn - 0.02, 0.05, 0.05, red, { facets: 2, cap: null });
    const open = k.rnd(5) < 0.15;
    plantPipe(k, front, 0.59, 0.645, 0.5, zn - 0.02, 0.062, 0.062, nut, { facets: 2 });
    if (!k.plan) {
      if (open) k.poly(plantFaceRing(k, front === 'u' ? 'v' : 'u', 0.646, 0.5, zn - 0.02, 0.03, 8), shade(red, 0.25), 1);
      const c = front === 'v' ? [0.44, 0.645] : [0.645, 0.56];
      k.line([[c[0]!, c[1]!, zn - 0.05], [front === 'v' ? 0.46 : 0.6, front === 'v' ? 0.6 : 0.56, zn - 0.1], [front === 'v' ? 0.44 : 0.59, front === 'v' ? 0.58 : 0.57, h * 0.43]], shade(t.dark, 0.45), 1, 0.7);
    }
    return null;
  },
  bollard: (k, h) => {
    const t = k.t;
    const H = h;
    const body = shade(t.base, 0.94 + k.rnd(1) * 0.12);
    // Base plate with its bolts, a steel post, reflective tape, a lipped cap and its dome.
    k.cyl(0.5, 0.5, 0.095, 0, 0.04 * H, t.dark, { sides: 8 });
    if (!k.plan) {
      for (const [u, v] of [[0.43, 0.54], [0.54, 0.57], [0.57, 0.46]] as const) k.disc(u, v, 0.012, 0.045 * H, shade(t.dark, 1.3), 1);
    }
    k.cyl(0.5, 0.5, 0.066, 0.04 * H, 0.8 * H, body, { sides: 8 });
    if (!k.plan) {
      // Tape wrapped round the near half, lit on its south side.
      const tape = shade(t.light, 1.15);
      const strip = (z0: number, z1: number): void => {
        const half = (a0: number, a1: number): Array<[number, number, number]> => {
          const pts: Array<[number, number, number]> = [];
          for (let i = 0; i <= 3; i += 1) {
            const a = a0 + ((a1 - a0) * i) / 3;
            pts.push([0.5 + Math.cos(a) * 0.067, 0.5 + Math.sin(a) * 0.067, z0]);
          }
          for (let i = 3; i >= 0; i -= 1) {
            const a = a0 + ((a1 - a0) * i) / 3;
            pts.push([0.5 + Math.cos(a) * 0.067, 0.5 + Math.sin(a) * 0.067, z1]);
          }
          return pts;
        };
        k.poly(half(-Math.PI / 4, Math.PI / 4), shade(tape, 0.8));
        k.poly(half(Math.PI / 4, (3 * Math.PI) / 4), tape);
      };
      strip(0.54 * H, 0.64 * H);
      if (k.rnd(2) < 0.6) strip(0.42 * H, 0.47 * H);
      k.band(0.5, 0.5, 0.068, 0.1 * H, t.ink, 0.4, 1.5);
      if (k.rnd(3) < 0.5) k.line([[0.545, 0.55, 0.78 * H], [0.546, 0.55, 0.3 * H]], shade(body, 0.6), 1, 0.4);
    }
    k.cyl(0.5, 0.5, 0.075, 0.8 * H, 0.855 * H, shade(body, 0.84), { sides: 8 });
    k.disc(0.5, 0.5, 0.058, 0.87 * H, shade(body, 1.1), 1, true);
    k.disc(0.49, 0.5, 0.03, 0.885 * H, shade(body, 1.25), 1);
    return null;
  },
  lamppost: (k, h, glow) => {
    const t = k.t;
    const H = h;
    const pole = t.dark;
    const extra = k.rnd(1);
    // Plinth, a tapered pole with a collar, a swan-neck arm, the lantern head.
    k.cyl(0.5, 0.5, 0.08, 0, 0.12 * H, shade(pole, 0.92), { sides: 8 });
    k.cyl(0.5, 0.5, 0.058, 0.12 * H, 0.2 * H, pole, { sides: 8 });
    // The pole stands in its own pool, which the light pass paints over it as over the floor, so
    // only its own contrast with the floor survives: a mid-tone core inside a near-solid ink edge
    // holds on dark asphalt and on a pale lobby floor alike. (No banner variant: this design is
    // also the condo floor lamp, the terrace lamp, the path lamp and the dock lamp.)
    const shaft = shade(pole, 0.95);
    if (k.plan) {
      k.disc(0.5, 0.5, 0.03, 0, shade(pole, 1.15), 1, true);
    } else {
      k.line([[0.5, 0.5, 0.2 * H], [0.5, 0.5, 0.95 * H]], t.ink, 5.8, 0.92);
      k.line([[0.5, 0.5, 0.95 * H], [0.5, 0.5, 1.72 * H]], t.ink, 4.8, 0.92);
      k.line([[0.5, 0.5, 0.2 * H], [0.5, 0.5, 0.95 * H]], shaft, 3.6, 1);
      k.line([[0.5, 0.5, 0.95 * H], [0.5, 0.5, 1.72 * H]], shaft, 2.7, 1);
      k.line([[0.489, 0.511, 0.22 * H], [0.489, 0.511, 0.93 * H]], shade(pole, 1.3), 1, 0.55);
      k.line([[0.492, 0.508, 0.97 * H], [0.492, 0.508, 1.7 * H]], shade(pole, 1.3), 1, 0.5);
      k.facePanel('u', 0.558, 0.47, 0.03 * H, 0.53, 0.1 * H, t.ink, 0.6);
    }
    k.cyl(0.5, 0.5, 0.045, 0.93 * H, 0.99 * H, shade(pole, 1.12), { sides: 6 });
    if (extra < 0.4) {
      k.box(0.47, 0.53, 0.53, 0.575, 0.52 * H, 0.68 * H, shade(pole, 1.12), { crown: false });
    }
    // Arm and brace.
    k.line([[0.5, 0.5, 1.66 * H], [0.6, 0.5, 1.74 * H], [0.72, 0.5, 1.74 * H], [0.8, 0.5, 1.7 * H]], t.ink, 4, 0.5);
    k.line([[0.5, 0.5, 1.66 * H], [0.6, 0.5, 1.74 * H], [0.72, 0.5, 1.74 * H], [0.8, 0.5, 1.7 * H]], shaft, 2.5, 1);
    if (!k.plan) k.line([[0.5, 0.5, 1.46 * H], [0.56, 0.5, 1.6 * H], [0.66, 0.5, 1.72 * H]], t.ink, 1.5, 0.95);
    k.cyl(0.5, 0.5, 0.03, 1.72 * H, 1.78 * H, shade(pole, 1.12), { sides: 6 });
    // The lamp: a deep diffuser bowl under a hooded housing, its near faces the fixture you see
    // from the iso camera, with a hot core when lit (the underside never faces the camera).
    const lens = glow ?? shade(GLASS, 0.55);
    k.box(0.73, 0.44, 0.89, 0.56, 1.43 * H, 1.56 * H, lens, { crown: false, ink: !k.plan });
    if (glow !== null && !k.plan) {
      k.facePanel('u', 0.561, 0.75, 1.46 * H, 0.87, 1.53 * H, shade(glow, 1.2), 0.95);
    }
    k.box(0.69, 0.41, 0.93, 0.59, 1.56 * H, 1.63 * H, pole);
    k.box(0.72, 0.44, 0.9, 0.56, 1.63 * H, 1.68 * H, shade(pole, 1.1), { crown: false });
    return glow ? k.pool(0.8, 0.5, 0.42) : null;
  },
  dumpster: (k, h) => {
    const t = k.t;
    const zb = h * 0.16;
    const zt = h * 0.72;
    const zr = h * 0.8;
    const lid = shade(t.base, 0.5);
    const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
    // Bottom and top of the flared body.
    const B = [0.13, 0.25, 0.87, 0.75] as const;
    const T = [0.09, 0.21, 0.91, 0.79] as const;
    const S = (s: number, f: number): [number, number, number] => [lerp(lerp(B[0], B[2], s), lerp(T[0], T[2], s), f), lerp(B[3], T[3], f), lerp(zb, zt, f)];
    const E = (s: number, f: number): [number, number, number] => [lerp(B[2], T[2], f), lerp(lerp(B[1], B[3], s), lerp(T[1], T[3], s), f), lerp(zb, zt, f)];
    if (!k.plan) {
      // Casters.
      for (const [u, v] of [[0.84, 0.3], [0.18, 0.72], [0.82, 0.72]] as const) {
        k.line([[u, v, zb], [u, v, 0.06]], shade(t.dark, 0.5), 2);
        k.faceCircle(u, v + 0.02, 0.045, 0.045, 'u', shade(t.ink, 0.6), 1);
        k.faceCircle(u, v + 0.021, 0.045, 0.016, 'u', t.light, 0.8);
      }
      const tilt = Math.atan2(0.04, zt - zb);
      k.poly([S(0, 0), S(1, 0), S(1, 1), S(0, 1)], shade(t.base, plantLit(0, Math.cos(tilt), -Math.sin(tilt))));
      k.poly([E(1, 0), E(0, 0), E(0, 1), E(1, 1)], shade(t.base, plantLit(Math.cos(tilt), 0, -Math.sin(tilt))));
      k.poly([S(0, 0), S(1, 0), E(0, 0), E(0, 0.35), S(1, 0.35), S(0, 0.35)], shade(t.base, 0.2), 0.14);
      // Stiffener ribs, a fork pocket down the side, a stencil plate.
      for (const s of [0.28, 0.72]) {
        k.line([S(s, 0.04), S(s, 1)], shade(t.base, 1.25), 1, 0.45);
        k.line([S(s + 0.018, 0.04), S(s + 0.018, 1)], shade(t.base, 0.5), 1, 0.45);
      }
      k.poly([E(0.06, 0.34), E(0.06, 0.58), E(0.94, 0.58), E(0.94, 0.34)], shade(t.base, 0.3), 0.35);
      k.line([E(0.06, 0.6), E(0.94, 0.6)], shade(t.base, 1.25), 1, 0.45);
      k.poly([S(0.4, 0.45), S(0.6, 0.45), S(0.6, 0.78), S(0.4, 0.78)], shade(t.light, 1.1), 0.3);
      // Rust weeping from the rim; now and then a tag.
      for (let i = 0; i < 2; i += 1) {
        const s = 0.08 + k.rnd(50 + i) * 0.84;
        k.poly([S(s, 1), S(s + 0.03, 1), S(s + 0.02, 0.35 + k.rnd(60 + i) * 0.3), S(s + 0.012, 0.3)], 0x74502f, 0.32);
      }
      if (k.rnd(7) < 0.5) {
        const s0 = k.rnd(8) < 0.5 ? 0.06 : 0.76;
        k.line([S(s0, 0.3), S(s0 + 0.04, 0.72), S(s0 + 0.07, 0.4), S(s0 + 0.12, 0.66), S(s0 + 0.15, 0.36), S(s0 + 0.19, 0.55)], shade(t.light, 1.12), 1.4, 0.5);
      }
      // Lifting pegs at the ends of the east side.
      for (const s of [0.16, 0.84]) {
        const [pu, pv, pz] = E(s, 0.8);
        k.box(pu - 0.01, pv - 0.024, pu + 0.04, pv + 0.024, pz - 0.035, pz + 0.01, shade(t.dark, 0.85), { crown: false });
      }
      k.line([S(0, 1), S(0, 0), S(1, 0), E(0, 0), E(0, 1)], t.ink, 1, 0.5);
    }
    // Rim.
    k.box(0.07, 0.19, 0.93, 0.81, zt, zr, shade(t.base, 1.06));
    // Two lids, each shut, propped on a bag, or thrown back.
    const zh = zr + h * 0.1;
    for (let i = 0; i < 2; i += 1) {
      const u0 = i === 0 ? 0.075 : 0.5;
      const u1 = i === 0 ? 0.5 : 0.925;
      const state = k.rnd(40 + i);
      if (state < 0.3) {
        k.poly([[u0 + 0.015, 0.205, zr], [u1 - 0.015, 0.205, zr], [u1 - 0.015, 0.795, zr], [u0 + 0.015, 0.795, zr]], shade(t.base, 0.28), 1);
        if (!k.plan) k.poly([[u0 + 0.015, 0.205, zr], [u1 - 0.015, 0.205, zr], [u1 - 0.015, 0.3, zr], [u0 + 0.015, 0.3, zr]], shade(t.base, 0.5), 1);
        const bag = (bu: number, bv: number, r: number, c: number, salt: number) => {
          const ring = plantRing(bu, bv, r, zr - 0.005, 7, k.rnd(salt));
          k.poly(ring.map(([pu, pv, pz], j): [number, number, number] => [bu + (pu - bu) * (0.75 + k.rnd(salt + j) * 0.25), bv + (pv - bv) * (0.75 + k.rnd(salt + j + 9) * 0.25), pz]), c, 1, true);
          if (!k.plan) k.disc(bu + r * 0.25, bv + r * 0.25, r * 0.35, zr, shade(c, 1.35), 0.5);
        };
        bag(lerp(u0, u1, 0.35), 0.5, 0.13, shade(t.ink, 0.55), 70 + i * 20);
        bag(lerp(u0, u1, 0.68), 0.64, 0.1, k.rnd(80 + i) < 0.5 ? 0x7d786c : shade(t.dark, 0.55), 90 + i * 20);
        k.box(u0, 0.14, u1, 0.19, zr - h * 0.02, zr + h * 0.16, lid);
      } else {
        const zf = state < 0.82 ? zr + h * 0.02 : zr + h * 0.09;
        if (!k.plan && zf > zr + h * 0.05) {
          k.poly([[u0 + 0.02, 0.81, zr], [u1 - 0.02, 0.81, zr], [u1 - 0.02, 0.82, zf - h * 0.03], [u0 + 0.02, 0.82, zf - h * 0.03]], shade(t.base, 0.18), 1);
          k.disc(lerp(u0, u1, 0.5), 0.78, 0.08, zr + h * 0.02, shade(t.ink, 0.6), 1);
        }
        if (!k.plan) {
          k.poly([[u0, 0.82, zf], [u1, 0.82, zf], [u1, 0.82, zf - h * 0.03], [u0, 0.82, zf - h * 0.03]], shade(lid, 0.78), 1);
          k.poly([[u1, 0.19, zh], [u1, 0.82, zf], [u1, 0.82, zf - h * 0.03], [u1, 0.19, zh - h * 0.03]], shade(lid, 0.69), 1);
        }
        const ny = zh - zf;
        const len = Math.hypot(ny, 0.63);
        k.poly([[u0, 0.19, zh], [u1, 0.19, zh], [u1, 0.82, zf], [u0, 0.82, zf]], k.plan ? lid : shade(lid, plantLit(0, ny / len, 0.63 / len)), 1, true);
        const w = u1 - u0;
        k.line(
          [
            [u0 + w * 0.25, 0.2, zh], [u0 + w * 0.25, 0.81, zf], [u0 + w * 0.5, 0.81, zf], [u0 + w * 0.5, 0.2, zh], [u0 + w * 0.75, 0.2, zh], [u0 + w * 0.75, 0.81, zf],
          ],
          shade(lid, 1.4),
          1,
          0.28,
        );
        // The handle along the front lip.
        if (!k.plan) k.line([[u0 + w * 0.3, 0.835, zf - h * 0.015], [u0 + w * 0.7, 0.835, zf - h * 0.015]], shade(t.base, 1.2), 1.6, 0.85);
      }
    }
    return null;
  },
  cone: (k, h) => {
    const t = k.t;
    const rubber = shade(t.base, 0.4);
    const reflect = 0xb6b0a4;
    const rot = (k.rnd(1) - 0.5) * 0.7;
    const zb = h * 0.07;
    const zt = h * 0.9;
    const r0 = 0.112;
    const r1 = 0.024;
    const rAt = (z: number) => r0 + (r1 - r0) * ((z - zb) / (zt - zb));
    const b0 = zb + (zt - zb) * 0.44;
    const b1 = zb + (zt - zb) * 0.66;
    const stacked = k.rnd(2) < 0.22;
    plantSlab(k, 0.5, 0.5, 0.155, 0, zb, rubber, 8, Math.PI / 8 + rot);
    if (k.plan) {
      k.disc(0.5, 0.5, r0, zb, t.base, 1, true);
      k.disc(0.5, 0.5, rAt(b0), zb, reflect, 1);
      k.disc(0.5, 0.5, rAt(b1), zb, t.base, 1);
      k.disc(0.5, 0.5, 0.02, zb, shade(t.base, 0.3), 1);
      return null;
    }
    // The key light catches the near lip of the rubber base.
    k.line(plantArc(0.5, 0.5, 0.15, zb, Math.PI * 0.62, -Math.PI * 0.12, 5), shade(rubber, 1.9), 1, 0.45);
    let z = zb;
    if (stacked) {
      const zs = zb + h * 0.1;
      plantTurn(k, 0.5, 0.5, r0, rAt(zs), zb, zs, t.base, { n: 10, cap: false });
      plantSlab(k, 0.5, 0.5, 0.15, zs, zs + zb * 0.8, rubber, 8, Math.PI / 8 - rot * 0.6);
      z = zs + zb * 0.8;
    }
    plantTurn(k, 0.5, 0.5, rAt(z) + (stacked ? 0.004 : 0), r1, z, zt, t.base, { n: 10, cap: false, foot: true });
    plantTurn(k, 0.5, 0.5, rAt(b0) + 0.003, rAt(b1) + 0.003, b0, b1, reflect, { n: 10, cap: false, ink: false });
    if (k.rnd(3) < 0.5) {
      const c0 = zb + (zt - zb) * 0.2;
      const c1 = zb + (zt - zb) * 0.3;
      plantTurn(k, 0.5, 0.5, rAt(c0) + 0.003, rAt(c1) + 0.003, c0, c1, shade(reflect, 0.94), { n: 10, cap: false, ink: false });
    }
    k.disc(0.5, 0.5, 0.016, zt, shade(t.base, 0.3), 1);
    const sa = 0.2 + k.rnd(4) * 1.2;
    k.line(
      [
        [0.5 + Math.cos(sa) * (rAt(b0) + 0.004), 0.5 + Math.sin(sa) * (rAt(b0) + 0.004), b0 + (b1 - b0) * 0.2],
        [0.5 + Math.cos(sa + 0.35) * (rAt(b1) + 0.004), 0.5 + Math.sin(sa + 0.35) * (rAt(b1) + 0.004), b0 + (b1 - b0) * 0.8],
      ],
      shade(reflect, 0.55),
      1,
      0.45,
    );
    return null;
  },
  trash: (k, h) => {
    const t = k.t;
    const H = h;
    const layout = k.rnd(1);
    // Bags dealt from four plastics so no two neighbours match: black, the set's own, pale, accent.
    const tones = [shade(t.ink, 0.82), shade(t.base, 1.02), shade(t.light, 1.12), shade(t.accent, 0.92)];
    const deal = Math.floor(k.rnd(9) * 4);
    const bag = (i: number): number => tones[(i + deal) % 4]!;
    k.disc(0.5, 0.6, 0.27, 0, t.ink, 0.22);
    const card = shade(t.accent, 1.12);
    const flap = (u0: number, v0: number, u1: number, v1: number, z: number, lean: number): void => {
      // An open box flap standing off the lid's south-west edge.
      if (k.plan) return;
      k.poly([[u0, v0, z], [u1, v1, z], [u1 - lean * 0.3, v1 + lean, z + 0.1 * H], [u0 - lean * 0.3, v0 + lean, z + 0.1 * H]], shade(card, 0.95), 1, true);
    };
    // Litter first: a flattened sheet of card.
    k.poly([[0.14, 0.72, 0.004], [0.3, 0.68, 0.004], [0.35, 0.79, 0.004], [0.19, 0.83, 0.004]], shade(card, 0.85), 0.8, true);
    if (layout < 0.5) {
      streetOBox(k, 0.3, 0.32, 0.13, 0.1, 0.35, 0, 0.34 * H, card);
      if (!k.plan) k.line([[0.25, 0.25, 0.34 * H], [0.35, 0.39, 0.34 * H]], shade(card, 0.62), 1.5, 0.75);
      flap(0.18, 0.37, 0.28, 0.41, 0.34 * H, 0.05);
      streetSack(k, 0.64, 0.36, 0.26, 0.66 * H, 0, bag(0), 1);
      streetSack(k, 0.3, 0.6, 0.22, 0.52 * H, 0, bag(1), 2);
      streetSack(k, 0.54, 0.56, 0.24, 0.6 * H, 0, bag(2), 3);
      streetSack(k, 0.7, 0.7, 0.17, 0.4 * H, 0, bag(3), 4);
    } else {
      streetSack(k, 0.36, 0.34, 0.24, 0.62 * H, 0, bag(0), 5);
      streetSack(k, 0.3, 0.6, 0.2, 0.46 * H, 0, bag(1), 6);
      streetOBox(k, 0.66, 0.38, 0.12, 0.1, -0.45, 0, 0.3 * H, card);
      if (!k.plan) k.line([[0.6, 0.44, 0.3 * H], [0.73, 0.33, 0.3 * H]], shade(card, 0.62), 1.5, 0.75);
      streetSack(k, 0.52, 0.64, 0.27, 0.64 * H, 0, bag(2), 7);
      streetSack(k, 0.34, 0.44, 0.14, 0.3 * H, 0.52 * H, bag(3), 8);
      if (k.rnd(4) < 0.6) {
        // A takeaway box dropped at the front.
        streetOBox(k, 0.7, 0.76, 0.08, 0.075, 0.3, 0, 0.05, shade(t.light, 0.95));
        if (!k.plan) k.line([[0.63, 0.73, 0.05], [0.72, 0.84, 0.05]], shade(t.light, 0.62), 1, 0.6);
      }
    }
    // A bottle rolled loose.
    if (!k.plan && k.rnd(5) < 0.7) {
      k.line([[0.74, 0.8, 0.02], [0.82, 0.76, 0.02]], 0x4f6a4a, 2.4, 1);
      k.line([[0.82, 0.76, 0.02], [0.85, 0.745, 0.02]], 0x4f6a4a, 1.2, 1);
    }
    return null;
  },
  fire: (k, h, glow) => {
    const t = k.t;
    const R = 0.25;
    const zt = h * 0.9;
    const steel = t.base;
    const pale = 0xfff1b0;
    const lo = squatRing(0.5, 0.5, R, 0, 12, Math.PI / 12);
    const hi = squatRing(0.5, 0.5, R, zt, 12, Math.PI / 12);
    squatPrism(k, lo, hi, steel, 1 | 8);
    if (!k.plan) {
      // A dent, rust run down from the rim, two rolling hoops.
      const da = 0.2 + k.rnd(1) * 1.4;
      k.poly([squatOn(0.5, 0.5, R + 0.002, da - 0.2, h * 0.44), squatOn(0.5, 0.5, R + 0.002, da, h * 0.36), squatOn(0.5, 0.5, R + 0.002, da + 0.22, h * 0.46), squatOn(0.5, 0.5, R + 0.002, da + 0.02, h * 0.54)], shade(steel, 0.62), 0.45);
      for (let i = 0; i < 3; i += 1) {
        const a = -0.35 + i * 0.95 + k.rnd(10 + i) * 0.4;
        const len = h * (0.16 + k.rnd(20 + i) * 0.28);
        k.line([squatOn(0.5, 0.5, R + 0.003, a, zt - 0.01), squatOn(0.5, 0.5, R + 0.003, a + 0.03, zt - len)], shade(steel, 0.66), 1.5, 0.6);
      }
      for (const z of [h * 0.3, h * 0.62]) {
        k.band(0.5, 0.5, R + 0.004, z, shade(steel, 0.55), 0.7, 1);
        k.band(0.5, 0.5, R + 0.004, z + 0.016, shade(steel, 1.2), 0.5, 1);
      }
      // The welded seam, soot blown back over the rim.
      k.line([squatOn(0.5, 0.5, R + 0.003, 1.95, 0.02), squatOn(0.5, 0.5, R + 0.003, 1.95, zt - 0.02)], shade(steel, 0.68), 1, 0.6);
      k.band(0.5, 0.5, R + 0.004, zt - 0.025, t.ink, 0.28, 4);
      // Draught slots cut round the foot, lit from inside when it burns.
      const hole = glow ?? shade(t.ink, 0.55);
      const nh = 3 + (k.rnd(7) < 0.5 ? 1 : 0);
      for (let i = 0; i < nh; i += 1) {
        const a = -0.3 + (i * 2.6) / (nh - 1);
        const z = h * 0.16;
        k.poly([squatOn(0.5, 0.5, R + 0.003, a - 0.13, z - 0.022), squatOn(0.5, 0.5, R + 0.003, a + 0.13, z - 0.022), squatOn(0.5, 0.5, R + 0.003, a + 0.12, z + 0.026), squatOn(0.5, 0.5, R + 0.003, a - 0.12, z + 0.026)], hole, 0.95);
      }
      k.poly(hi, shade(steel, 0.95));
    }
    const wall = glow === null ? shade(steel, 0.45) : squatMix(shade(t.ink, 0.6), glow, 0.4);
    squatHole(k, 0.5, 0.5, R * 0.84, zt, 0.1, shade(t.ink, 0.45), wall);
    if (!k.plan) k.line([...hi, hi[0]!], shade(steel, 1.35), 1, 0.45);
    if (glow !== null) {
      k.poly(squatBlob(k, 0.5, 0.5, 0.15, 0.15, zt - 0.03, 9, 0.25, 4), shade(glow, 0.7), 0.95);
      k.poly(squatBlob(k, 0.5, 0.5, 0.08, 0.08, zt - 0.028, 7, 0.3, 5), squatMix(glow, pale, 0.45), 0.95);
    } else {
      k.poly(squatBlob(k, 0.5, 0.5, 0.15, 0.15, zt - 0.03, 9, 0.25, 4), 0x57544f, 0.95);
    }
    // Scrap wood poking out over the rim.
    for (let i = 0; i < 3; i += 1) {
      const a = k.rnd(30 + i) * Math.PI * 2;
      const b = a + Math.PI + (k.rnd(40 + i) - 0.5);
      k.line([[0.5 + Math.cos(a) * 0.1, 0.5 + Math.sin(a) * 0.1, zt - 0.03], [0.5 + Math.cos(b) * 0.2, 0.5 + Math.sin(b) * 0.2, zt + 0.05 + k.rnd(50 + i) * h * 0.14]], shade(t.ink, 0.55), 2, 0.95);
    }
    // Sometimes a grate of rebar across the rim with a can warming on it.
    if (k.rnd(3) < 0.45) {
      for (const v of [0.43, 0.57]) k.line([[0.27, v, zt + 0.01], [0.73, v, zt + 0.01]], shade(t.ink, 0.8), 1.5, 0.95);
      squatSolid(k, 0.42, 0.44, 0.05, 0.05, zt + 0.012, zt + 0.08, shade(t.light, 0.9), 8, 2);
    }
    if (glow !== null && !k.plan) {
      for (const i of [0, 2, 1]) {
        const x = (i - 1) * 0.07 + (k.rnd(80 + i) - 0.5) * 0.02;
        const e = i === 1 ? 0.02 : -0.02;
        const bu = 0.5 + x + e;
        const bv = 0.5 - x + e;
        const fh = h * (0.42 + k.rnd(90 + i) * 0.3) * (i === 1 ? 1.2 : 0.8);
        const w = 0.05;
        const lean = (k.rnd(100 + i) - 0.5) * 0.05;
        const P = (dx: number, z: number): [number, number, number] => [bu + dx, bv - dx, z];
        const z0 = zt - 0.02;
        k.poly([P(-w, z0), P(w, z0), P(w * 0.8 + lean * 0.3, z0 + fh * 0.45), P(lean, z0 + fh), P(-w * 0.75 + lean * 0.5, z0 + fh * 0.55)], glow, 0.85);
        k.poly([P(-w * 0.5, z0), P(w * 0.5, z0), P(w * 0.35 + lean * 0.3, z0 + fh * 0.4), P(lean * 0.6, z0 + fh * 0.68), P(-w * 0.3, z0 + fh * 0.3)], squatMix(glow, pale, 0.6), 0.95);
      }
      for (let i = 0; i < 2; i += 1) {
        k.disc(0.45 + k.rnd(120 + i) * 0.12, 0.45 + k.rnd(130 + i) * 0.1, 0.018, zt + h * (0.75 + k.rnd(140 + i) * 0.4), squatMix(glow, pale, 0.5), 0.9);
      }
    }
    if (glow !== null && k.plan) {
      k.poly(squatBlob(k, 0.5, 0.5, 0.13, 0.13, zt, 10, 0.55, 6), glow, 0.9);
      k.disc(0.5, 0.5, 0.05, zt, squatMix(glow, pale, 0.6), 0.95);
    }
    return glow !== null ? k.pts(hi) : null;
  },
  wreck: (k, h, glow) => {
    const t = k.t;
    const body = t.base;
    const burnt = glow !== null;
    const frontGone = k.rnd(1) < 0.5;
    const hoodUp = k.rnd(2) < 0.45;
    const drop = h * 0.08;
    const sag = (u: number): number => -drop * (frontGone ? (u - 0.05) / 0.9 : (0.95 - u) / 0.9);
    const pt = (u: number, v: number, z: number): [number, number, number] => [u, v, z + sag(u)];
    const v0 = 0.29;
    const v1 = 0.71;
    const zb = h * 0.1;
    const zm = h * 0.4;
    const zB = h * 0.5;
    const zr = h * 0.86;
    const crush = h * 0.09;
    const K = 0.894;
    const roofZ = (u: number): number => zr - crush * Math.max(0, Math.min(1, (u - 0.37) / 0.23));
    if (burnt) k.poly(squatBlob(k, 0.5, 0.5, 0.44, 0.23, 0, 10, 0.25, 3), t.ink, 0.35);
    // Body: a rub strip at the sill line, a shoulder above it, one end on the ground.
    squatPrism(k, [pt(0.05, v0, zb), pt(0.95, v0, zb), pt(0.95, v1, zb), pt(0.05, v1, zb)], [pt(0.05, v0, zm), pt(0.95, v0, zm), pt(0.95, v1, zm), pt(0.05, v1, zm)], body, 0);
    const sv0 = v0 + 0.015;
    const sv1 = v1 - 0.015;
    squatPrism(k, [pt(0.07, sv0, zm), pt(0.93, sv0, zm), pt(0.93, sv1, zm), pt(0.07, sv1, zm)], [pt(0.07, sv0, zB), pt(0.93, sv0, zB), pt(0.93, sv1, zB), pt(0.07, sv1, zB)], shade(body, 1.04), 2);
    if (!k.plan) {
      const arch = (ua: number, r: number): Array<[number, number, number]> => {
        const out: Array<[number, number, number]> = [];
        for (let i = 0; i <= 8; i += 1) {
          const a = (i / 8) * Math.PI;
          out.push(pt(ua + Math.cos(a) * r * K, v1 + 0.002, zb + Math.sin(a) * r));
        }
        return out;
      };
      // Soot (or rust) climbing out of the wheel wells, then the wells themselves.
      for (const ua of [0.22, 0.78]) {
        k.poly([pt(ua - 0.11, v1 + 0.002, zb + 0.06), pt(ua + 0.12, v1 + 0.002, zb + 0.06), pt(ua + 0.05, v1 + 0.002, zm - 0.005), pt(ua - 0.04, v1 + 0.002, zm - 0.01)], burnt ? t.ink : shade(t.accent, 0.62), burnt ? 0.35 : 0.4);
        k.poly(arch(ua, h * 0.22), shade(t.ink, 0.5));
      }
      const kept = frontGone ? 0.22 : 0.78;
      const gone = frontGone ? 0.78 : 0.22;
      k.faceCircle(kept, v1 + 0.004, h * 0.12 + sag(kept), h * 0.12, 'u', shade(t.ink, burnt ? 0.6 : 0.5));
      k.faceCircle(kept, v1 + 0.005, h * 0.12 + sag(kept), h * 0.07, 'u', shade(t.light, 0.78));
      k.faceCircle(kept, v1 + 0.006, h * 0.12 + sag(kept), h * 0.025, 'u', t.ink);
      k.faceCircle(gone, v1 + 0.004, h * 0.07 + sag(gone), h * 0.05, 'u', shade(t.dark, 0.75));
      for (const u of [0.44, 0.62]) {
        k.line([pt(u, v1 + 0.002, zb + 0.015), pt(u, v1 + 0.002, zm), pt(u, sv1 + 0.002, zm), pt(u, sv1 + 0.002, zB - 0.005)], shade(body, 0.5), 1, 0.6);
        k.line([pt(u + 0.035, sv1 + 0.003, zB - 0.03), pt(u + 0.075, sv1 + 0.003, zB - 0.03)], shade(t.ink, 0.7), 1.5, 0.8);
      }
      // The nose: bumper, empty headlamp sockets, grille.
      const s = sag(0.95);
      k.facePanel('v', 0.952, v0 + 0.03, zb + 0.01 + s, v1 - 0.03, zb + 0.045 + s, shade(t.ink, 0.7));
      k.facePanel('v', 0.953, v0 + 0.045, zm - 0.06 + s, v0 + 0.1, zm - 0.02 + s, shade(t.ink, 0.45));
      k.facePanel('v', 0.953, v1 - 0.1, zm - 0.06 + s, v1 - 0.045, zm - 0.02 + s, shade(t.ink, 0.45));
      k.facePanel('v', 0.953, v0 + 0.14, zm - 0.065 + s, v1 - 0.14, zm - 0.015 + s, shade(t.ink, 0.62));
    }
    // Hood: shut and buckled, or sprung with the engine bay open.
    if (hoodUp) {
      k.poly([pt(0.7, sv0 + 0.01, zB + 0.002), pt(0.92, sv0 + 0.01, zB + 0.002), pt(0.92, sv1 - 0.01, zB + 0.002), pt(0.7, sv1 - 0.01, zB + 0.002)], shade(t.ink, 0.5));
      if (burnt) k.poly(squatBlob(k, 0.82, 0.5, 0.07, 0.12, zB + 0.004 + sag(0.82), 7, 0.35, 8), glow, 0.75);
      k.poly([pt(0.7, sv0 + 0.005, zB + 0.004), pt(0.7, sv1 - 0.005, zB + 0.004), pt(0.9, sv1 - 0.015, zB + h * 0.22), pt(0.9, sv0 + 0.015, zB + h * 0.22)], shade(body, 0.95), 1, true);
    } else {
      k.line([pt(0.7, sv0 + 0.01, zB + 0.002), pt(0.7, sv1 - 0.01, zB + 0.002)], shade(body, 0.6), 1, 0.6);
      k.line([pt(0.77, sv0 + 0.04, zB + 0.002), pt(0.81, 0.45, zB + 0.002), pt(0.78, 0.55, zB + 0.002), pt(0.83, sv1 - 0.04, zB + 0.002)], shade(body, 0.7), 1, 0.5);
    }
    k.line([pt(0.27, sv0 + 0.01, zB + 0.002), pt(0.27, sv1 - 0.01, zB + 0.002)], shade(body, 0.6), 1, 0.6);
    // Cabin: the glass gone, the roof stove in toward the front.
    const cb = (s: number, q: number): [number, number, number] => {
      const ul = 0.3 + s * 0.38;
      const uh = 0.37 + s * 0.23;
      const u = ul + (uh - ul) * q;
      return pt(u, 0.69 + (0.655 - 0.69) * q, zB + (roofZ(uh) - zB) * q);
    };
    const ce = (s: number, q: number): [number, number, number] => {
      const vl = 0.31 + s * 0.38;
      const vh = 0.345 + s * 0.31;
      return pt(0.68 + (0.6 - 0.68) * q, vl + (vh - vl) * q, zB + (roofZ(0.6) - zB) * q);
    };
    const hole = shade(t.ink, 0.42);
    if (k.plan) {
      k.poly([pt(0.3, 0.31, zB), pt(0.68, 0.31, zB), pt(0.68, 0.69, zB), pt(0.3, 0.69, zB)], hole, 0.9);
    } else {
      k.poly([cb(0, 0), cb(1, 0), cb(1, 1), cb(0, 1)], shade(body, 0.76));
      k.poly([ce(0, 0), ce(1, 0), ce(1, 1), ce(0, 1)], shade(body, 0.68));
      k.poly([cb(0.05, 0.14), cb(0.46, 0.14), cb(0.46, 0.84), cb(0.09, 0.84)], hole);
      k.poly([cb(0.54, 0.14), cb(0.95, 0.14), cb(0.9, 0.84), cb(0.54, 0.84)], hole);
      k.poly([ce(0.08, 0.12), ce(0.92, 0.12), ce(0.9, 0.86), ce(0.1, 0.86)], hole);
      if (burnt) {
        k.poly([cb(0.05, 0.14), cb(0.46, 0.14), cb(0.46, 0.4), cb(0.06, 0.4)], glow, 0.6);
        k.poly([cb(0.54, 0.14), cb(0.95, 0.14), cb(0.94, 0.36), cb(0.54, 0.36)], glow, 0.45);
      } else if (k.rnd(4) < 0.6) {
        k.poly([ce(0.08, 0.12), ce(0.4, 0.12), ce(0.1, 0.55)], GLASS, 0.35);
      }
      k.line([cb(0, 0), cb(0, 1)], t.ink, 1, 0.5);
      k.line([ce(0, 0), ce(0, 1)], t.ink, 1, 0.5);
    }
    k.poly([pt(0.37, 0.345, roofZ(0.37)), pt(0.6, 0.345, roofZ(0.6)), pt(0.6, 0.655, roofZ(0.6)), pt(0.37, 0.655, roofZ(0.37))], shade(body, 0.86), 1, true);
    k.line([pt(0.45, 0.36, roofZ(0.45) + 0.002), pt(0.51, 0.5, roofZ(0.51) + 0.002), pt(0.47, 0.64, roofZ(0.47) + 0.002)], shade(t.ink, 0.8), 1, 0.55);
    k.poly(squatBlob(k, 0.47, 0.5, 0.07, 0.1, roofZ(0.47) + 0.003 + sag(0.47), 7, 0.35, 9), burnt ? t.ink : shade(t.accent, 0.7), burnt ? 0.3 : 0.4);
    if (!burnt) {
      for (let i = 0; i < 4; i += 1) {
        const u = 0.1 + i * 0.24 + k.rnd(110 + i) * 0.08;
        const v = v1 + 0.004;
        const tall = h * (0.08 + k.rnd(120 + i) * 0.1);
        k.line([[u - 0.03, v, 0], [u - 0.018, v, tall * 0.8], [u - 0.006, v, 0.004], [u + 0.006, v, tall], [u + 0.018, v, 0.004], [u + 0.032, v, tall * 0.7]], FOLIAGE, 1, 0.9);
      }
    }
    return burnt ? k.pts([cb(0.05, 0.14), cb(0.95, 0.14), cb(0.9, 0.84), cb(0.09, 0.84)]) : null;
  },
  tyres: (k, h) => {
    const t = k.t;
    const rubber = t.base;
    const variant = k.rnd(3);
    const lone = variant >= 0.75;
    const R = lone ? 0.25 : 0.21;
    const cu = lone ? 0.5 : 0.41;
    const cv = lone ? 0.5 : 0.41;
    const n = Math.max(2, Math.min(5, Math.round((h * 0.92) / 0.13) - (k.rnd(4) < 0.5 ? 1 : 0)));
    const th = (h * 0.92) / n;
    const tread = (tu: number, tv: number, r: number, z0: number, zh: number): void => {
      const pts: Array<[number, number, number]> = [];
      for (let i = 0; i <= 14; i += 1) pts.push(squatOn(tu, tv, r + 0.003, -0.6 + i * 0.2, z0 + zh * (i % 2 === 0 ? 0.3 : 0.64)));
      k.line(pts, shade(rubber, 0.7), 1, 0.7);
    };
    // A loose tyre lying flat beside the stack goes down first: it is behind nothing.
    let tu = cu;
    let tv = cv;
    for (let i = 0; i < n; i += 1) {
      tu = cu + (k.rnd(10 + i) - 0.5) * 0.04;
      tv = cv + (k.rnd(20 + i) - 0.5) * 0.04;
      const z0 = i * th;
      const rot = k.rnd(30 + i);
      squatPrism(k, squatRing(tu, tv, R, z0, 12, rot), squatRing(tu, tv, R, z0 + th, 12, rot), shade(rubber, 0.94 + k.rnd(40 + i) * 0.12), i === n - 1 ? 2 : 0);
      if (!k.plan) {
        k.band(tu, tv, R + 0.002, z0 + th * 0.8, shade(rubber, 1.35), 0.4, 1);
        tread(tu, tv, R, z0, th);
      }
    }
    squatHole(k, tu, tv, R * 0.5, n * th, th * 0.9, shade(t.ink, 0.45), shade(rubber, 0.62));
    // Rainwater standing in the top tyre, or a weed come up through it.
    const fill = k.rnd(60);
    if (fill < 0.4) {
      k.disc(tu + 0.012, tv + 0.012, R * 0.34, n * th, squatMix(GLASS, t.ink, 0.6), 0.9);
      k.line([[tu - 0.01, tv + 0.03, n * th], [tu + 0.04, tv - 0.01, n * th]], GLASS, 1, 0.5);
    } else if (fill < 0.65 && !k.plan) {
      const zt = n * th;
      k.line([[tu - 0.03, tv + 0.02, zt - 0.02], [tu - 0.06, tv + 0.03, zt + h * 0.2], [tu - 0.01, tv, zt - 0.02], [tu + 0.01, tv - 0.01, zt + h * 0.3], [tu + 0.02, tv + 0.01, zt - 0.02], [tu + 0.07, tv - 0.02, zt + h * 0.17]], FOLIAGE, 1.5, 0.95);
    }
    if (variant < 0.4) {
      // One stood on its tread in front of the stack.
      if (k.plan) {
        k.poly([[0.53, 0.69, 0], [0.79, 0.69, 0], [0.79, 0.75, 0], [0.53, 0.75, 0]], rubber, 1, true);
        k.line([[0.53, 0.72, 0], [0.79, 0.72, 0]], shade(rubber, 0.7), 1, 0.7);
      } else {
        const r = 0.15;
        k.faceCircle(0.655, 0.69, r, r, 'u', shade(rubber, 0.55));
        k.faceCircle(0.66, 0.745, r, r, 'u', rubber, 1, true);
        k.faceCircle(0.66, 0.747, r, r * 0.78, 'u', shade(rubber, 1.12), 0.5);
        k.faceCircle(0.66, 0.748, r, r * 0.46, 'u', shade(t.ink, 0.45));
        if (k.rnd(61) < 0.5) {
          // Still on its steel wheel: the rim, the hub, the lug bolts' ring.
          k.faceCircle(0.66, 0.749, r, r * 0.44, 'u', shade(t.light, 0.8), 1, true);
          k.faceCircle(0.66, 0.75, r, r * 0.3, 'u', shade(t.light, 0.62));
          k.faceCircle(0.66, 0.751, r, r * 0.12, 'u', shade(t.light, 0.95));
        } else {
          k.faceCircle(0.657, 0.748, r + 0.01, r * 0.4, 'u', shade(rubber, 0.62), 0.9);
        }
      }
    } else if (!lone) {
      const lz = th * 0.9;
      const rot = k.rnd(50);
      squatPrism(k, squatRing(0.67, 0.67, 0.15, 0, 12, rot), squatRing(0.67, 0.67, 0.15, lz, 12, rot), rubber, 2);
      if (!k.plan) tread(0.67, 0.67, 0.15, 0, lz);
      squatHole(k, 0.67, 0.67, 0.075, lz, lz * 0.9, shade(t.ink, 0.45), shade(rubber, 0.62));
      if (k.rnd(62) < 0.5) {
        k.disc(0.67, 0.67, 0.07, lz * 0.5, shade(t.light, 0.72), 1, true);
        k.disc(0.67, 0.67, 0.026, lz * 0.55, shade(t.light, 0.95), 1);
      }
    }
    return null;
  },
  tent: (k, h) => {
    const t = k.t;
    const tarp = t.base;
    const u0 = 0.13;
    const u1 = 0.82;
    const v0 = 0.18;
    const vr = 0.5;
    const v1 = 0.8;
    const zh = 0.012;
    const zr = h * 1.2;
    const sag = h * (0.05 + k.rnd(1) * 0.06);
    const bow = h * 0.08;
    const ridgeZ = (u: number): number => zr - sag * Math.sin(((u - u0) / (u1 - u0)) * Math.PI);
    // A point on the near slope: s along the ridge, q from hem (0) to ridge (1).
    // The hem is pegged at the thirds and rides up between; the cloth bows in at mid-slope.
    const S = (s: number, q: number): [number, number, number] => {
      const u = u0 + s * (u1 - u0);
      const lift = 0.05 * Math.abs(Math.sin(s * Math.PI * 3)) * (1 - q) * (1 - q);
      return [u, v1 + (vr - v1) * q - lift * 0.4, zh + lift + (ridgeZ(u) - zh) * q - bow * Math.sin(q * Math.PI)];
    };
    const hem: Array<[number, number, number]> = [0, 1, 2, 3, 4, 5, 6].map((i) => S(i / 6, 0));
    const pegs = [0, 1 / 3, 2 / 3, 1];
    if (!k.plan) {
      // Through the open end: the underside of the far slope, the dark back, a bedroll.
      k.poly([[u1, v0, zh], [u1, vr, zr], [u1, v1, zh], [u1, v1, 0], [u1, v0, 0]], shade(tarp, 0.46));
      k.poly([[u1, v0 + 0.1, 0], [u1, vr, zr * 0.7], [u1, v1 - 0.12, 0]], shade(t.ink, 0.5), 0.92);
      if (k.rnd(2) < 0.6) {
        k.poly([[u1 - 0.01, vr + 0.01, 0], [u1 - 0.01, v1 - 0.06, 0], [u1 - 0.01, v1 - 0.07, h * 0.1], [u1 - 0.01, vr + 0.03, h * 0.12]], shade(t.accent, 0.78));
        k.line([[u1 - 0.009, vr + 0.08, 0.005], [u1 - 0.009, vr + 0.09, h * 0.11]], shade(t.accent, 0.55), 1, 0.8);
      }
      k.line([[u1, vr, 0], [u1, vr, zr + h * 0.1]], t.dark, 2, 0.95);
      if (k.rnd(3) < 0.45) k.poly([[u1, v1, zh], [u1, vr, zr], [u1, vr + 0.05, 0.02], [u1, v1 - 0.04, 0]], shade(tarp, 0.62));
    }
    // Something left by the door: a cook pot or a jerrycan.
    const kit = k.rnd(9);
    if (kit < 0.4) {
      squatSolid(k, 0.87, 0.3, 0.03, 0.026, 0, 0.045, shade(t.ink, 0.9), 8, 2);
      if (!k.plan) k.line([squatOn(0.87, 0.3, 0.03, 2.4, 0.045), [0.87, 0.3, 0.075], squatOn(0.87, 0.3, 0.03, -0.8, 0.045)], t.ink, 1, 0.8);
    } else if (kit < 0.7) {
      k.box(0.85, 0.22, 0.895, 0.31, 0, 0.08, shade(t.accent, 0.9));
    }
    // The dark under the hem where it rides up between the pegs.
    if (!k.plan) k.poly([[u0, v1, 0], [u1, v1, 0], ...[...hem].reverse()], shade(t.ink, 0.55), 0.9);
    // The near slope in three sewn panels, each bowed: a lit lower half and a steeper upper half.
    if (k.plan) {
      k.poly([[u0, v0, 0], [u1, v0, 0], [u1, vr, 0], [u0, vr, 0]], shade(tarp, 0.8), 1, true);
    }
    for (let p = 0; p < 3; p += 1) {
      const a = p / 3;
      const b = (p + 1) / 3;
      const m = (a + b) / 2;
      const tone = p === 1 ? 1.03 : p === 2 ? 0.97 : 1;
      if (k.plan) {
        k.poly([S(a, 0), S(m, 0), S(b, 0), S(b, 1), S(a, 1)], shade(tarp, tone));
      } else {
        k.poly([S(a, 0), S(m, 0), S(b, 0), S(b, 0.5), S(a, 0.5)], shade(tarp, 0.9 * tone));
        k.poly([S(a, 0.5), S(b, 0.5), S(b, 1), S(a, 1)], shade(tarp, 0.79 * tone));
      }
    }
    if (!k.plan) {
      k.poly([S(0, 0), S(1, 0), S(1, 0.22), S(0, 0.22)], t.ink, 0.1);
      // Tension folds pulled up from the middle pegs: short, soft, gone by mid-slope.
      for (const p of [1 / 3, 2 / 3]) k.line([S(p - 0.06, 0.3), S(p, 0.03), S(p + 0.06, 0.3)], shade(tarp, 0.72), 1, 0.4);
    }
    // A patch sewn over a tear, sometimes two: a near tone with a stitched top edge, not a window.
    for (let i = 0; i < (k.rnd(4) < 0.4 ? 2 : 1); i += 1) {
      const ps = 0.08 + k.rnd(5 + i * 10) * 0.7;
      const pq = 0.12 + k.rnd(6 + i * 10) * 0.45;
      const patch = [S(ps, pq), S(ps + 0.11, pq + 0.04), S(ps + 0.09, pq + 0.24), S(ps - 0.015, pq + 0.18)];
      k.poly(patch, shade(squatMix(tarp, i === 0 ? t.accent : t.light, 0.4), k.plan ? 1 : 0.86));
      if (!k.plan) k.line([patch[3]!, patch[2]!], shade(tarp, 1.12), 1, 0.35);
    }
    // Seams, the hem's lit edge, the ridge.
    for (const s of [1 / 3, 2 / 3]) k.line([S(s, 0), S(s, 0.5), S(s, 1)], shade(tarp, 0.64), 1, 0.45);
    k.line(hem, shade(tarp, 1.25), 1, 0.55);
    k.line([S(0, 1), S(0.5, 1), S(1, 1)], k.plan ? shade(t.ink, 0.8) : shade(tarp, 1.32), 1, k.plan ? 0.8 : 0.65);
    if (!k.plan) {
      if (k.rnd(3) >= 0.45) k.line([S(0.985, 0.06), S(0.985, 0.5), S(0.985, 0.94)], shade(tarp, 1.05), 3, 0.95);
      k.line([[u0, vr, ridgeZ(u0)], [u0, vr, ridgeZ(u0) + h * 0.1]], t.dark, 2, 0.95);
    }
    // Guy line off the door pole; the hem held down with stones or pegs.
    k.line([[u1, vr, zr + h * 0.07], [0.9, vr, 0]], t.ink, 1, 0.75);
    const stones = k.rnd(8) < 0.55;
    for (const p of pegs) {
      const e = S(p, 0);
      if (stones) {
        k.disc(e[0] + 0.012, e[1] + 0.03, 0.028 + k.rnd(20 + Math.round(p * 3)) * 0.012, 0.012, shade(t.dark, 0.85), 1, !k.plan);
      } else if (!k.plan) {
        k.line([[e[0], e[1] + 0.035, 0.03], [e[0], e[1] + 0.035, 0], [e[0], e[1], e[2]]], shade(t.light, 0.8), 1.5, 0.95);
      }
    }
    if (!k.plan) k.line([[0.9, vr, 0], [0.9, vr, 0.035]], shade(t.light, 0.85), 2, 0.95);
    return null;
  },
  heap: (k, h) => {
    const t = k.t;
    const pu = 0.48 + (k.rnd(1) - 0.5) * 0.06;
    const pv = 0.47 + (k.rnd(2) - 0.5) * 0.06;
    const zm = h * 0.38;
    const zt = h * 0.9;
    const slabLeft = k.rnd(5) < 0.5;
    // The mound's height at a fraction d of the way from its crown to its foot.
    const surf = (d: number): number => (d >= 0.69 ? (zm * (1 - Math.min(1, d))) / 0.31 : d >= 0.27 ? zm + ((zt - zm) * (0.69 - d)) / 0.42 : zt);
    // Grit kicked out round the foot.
    if (!k.plan) {
      for (let i = 0; i < 4; i += 1) {
        const a = -0.9 + i * 0.95 + k.rnd(10 + i) * 0.5;
        const d = 0.36 + k.rnd(20 + i) * 0.04;
        k.disc(0.5 + Math.cos(a) * d, 0.52 + Math.sin(a) * d, 0.014 + k.rnd(30 + i) * 0.012, 0.004, i % 2 === 0 ? shade(t.dark, 0.8) : shade(t.light, 0.95), 0.95);
      }
    }
    // The spill: a wide dark skirt of broken stuff, then the core of the pile.
    squatPrism(k, squatBlob(k, 0.5, 0.52, 0.4, 0.37, 0, 10, 0.18, 1), squatBlob(k, pu, pv + 0.02, 0.28, 0.26, zm, 10, 0.2, 1), shade(t.dark, 0.9), 8);
    // A beam run out of the back of the pile.
    const b0: [number, number, number] = [pu + 0.06, pv - 0.05, h * 0.62];
    const b1: [number, number, number] = [0.84, 0.16, 0.02];
    const w = 0.024;
    k.poly([[b0[0] - w, b0[1] - w, b0[2]], [b1[0] - w, b1[1] - w, b1[2]], [b1[0] + w, b1[1] + w, b1[2]], [b0[0] + w, b0[1] + w, b0[2]]], shade(t.dark, 0.8), 1, true);
    if (!k.plan) k.poly([[b0[0] + w, b0[1] + w, b0[2]], [b1[0] + w, b1[1] + w, b1[2]], [b1[0] + w, b1[1] + w, b1[2] - 0.03], [b0[0] + w, b0[1] + w, b0[2] - 0.03]], shade(t.dark, 0.55));
    // No lit crown ring on the flat top: with the rebar over it the pile read as a pot with a handle.
    squatPrism(k, squatBlob(k, pu, pv, 0.27, 0.25, zm - 0.02, 9, 0.22, 2), squatBlob(k, pu + 0.02, pv - 0.01, 0.11, 0.1, zt, 9, 0.3, 2), t.base, 0);
    // Rubble on the slopes: slabs of concrete, brick, the odd dark lump, each lying the way the slope falls.
    const n = 6 + (k.rnd(6) < 0.5 ? 1 : 0);
    const chunks: Array<{ u: number; v: number; d: number; a: number; i: number }> = [];
    for (let i = 0; i < n; i += 1) {
      const a = Math.PI / 4 - 1.45 + (2.9 * (i + 0.2 + k.rnd(40 + i) * 0.6)) / n;
      const d = i === 2 ? 0.08 : 0.34 + k.rnd(50 + i) * 0.46;
      chunks.push({ u: pu + Math.cos(a) * d * 0.39, v: pv + Math.sin(a) * d * 0.36, d, a, i });
    }
    chunks.sort((p, q) => p.u + p.v - (q.u + q.v));
    for (const ch of chunks) {
      const r = k.rnd(60 + ch.i);
      const color = r < 0.45 ? shade(t.light, 1.02) : r < 0.8 ? shade(t.accent, 0.95) : shade(t.dark, 0.9);
      const sz = 0.035 + k.rnd(70 + ch.i) * 0.035;
      const th = 0.022 + sz * 0.3;
      const slope = ch.d >= 0.69 ? 0.7 : ch.d >= 0.27 ? 0.55 : 0.1;
      squatChunk(k, ch.u, ch.v, surf(ch.d) + th * 0.5, sz, sz * (0.55 + k.rnd(80 + ch.i) * 0.3), k.rnd(90 + ch.i) * Math.PI, ch.a, sz * slope, th, color);
    }
    // Rebar out of the upper slopes, splayed outward and bent over: never an arch across the crown.
    const bar = shade(t.ink, 0.72);
    if (!k.plan) k.line([[pu - 0.05, pv + 0.01, zt - 0.05], [pu - 0.1, pv + 0.03, zt + h * 0.13], [pu - 0.15, pv + 0.02, zt + h * 0.12]], bar, 1, 0.95);
    if (!k.plan) k.line([[pu + 0.08, pv + 0.05, zt - 0.1], [pu + 0.15, pv + 0.1, zt + h * 0.03]], bar, 1, 0.9);
    // A broken slab leant on the pile: a jagged top where it snapped, a crack, rebar out of the break.
    const q0: [number, number, number] = slabLeft ? [0.16, 0.66, 0.01] : [0.64, 0.85, 0.01];
    const q1: [number, number, number] = slabLeft ? [0.4, 0.85, 0.01] : [0.85, 0.64, 0.01];
    const q2: [number, number, number] = slabLeft ? [0.47, 0.72, h * 0.32] : [0.72, 0.5, h * 0.28];
    const qj: [number, number, number] = slabLeft ? [0.36, 0.63, h * 0.22] : [0.62, 0.6, h * 0.2];
    const q3: [number, number, number] = slabLeft ? [0.26, 0.54, h * 0.28] : [0.52, 0.7, h * 0.32];
    if (!k.plan) {
      const edge = slabLeft ? q1 : q0;
      const edgeTop = slabLeft ? q2 : q3;
      k.poly([edge, edgeTop, [edgeTop[0] + 0.018, edgeTop[1] + 0.018, edgeTop[2] - 0.035], [edge[0] + 0.018, edge[1] + 0.018, 0]], shade(t.light, 0.56));
    }
    k.poly([q0, q1, q2, qj, q3], shade(squatMix(t.light, t.base, 0.35), 0.9), 1, true);
    const mid = (a: [number, number, number], b: [number, number, number], f: number): [number, number, number] => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    k.line([mid(q0, q1, 0.6), mid(mid(q0, q1, 0.5), qj, 0.5), qj], shade(t.light, 0.6), 1, 0.75);
    if (!k.plan) {
      for (const [a, b] of [[q3, qj], [qj, q2]] as const) {
        const r = mid(a, b, 0.5);
        k.line([r, [r[0] - 0.012, r[1] - 0.02, r[2] + h * 0.09], [r[0] - 0.03, r[1] - 0.018, r[2] + h * 0.11]], bar, 1, 0.9);
      }
    }
    // Two blocks tumbled out to the front.
    const front: Array<[number, number]> = slabLeft ? [[0.62, 0.79], [0.8, 0.6]] : [[0.2, 0.62], [0.36, 0.8]];
    front.forEach(([bu, bv], i) => {
      squatChunk(k, bu, bv, 0.035, 0.045, 0.03, k.rnd(100 + i) * Math.PI, 0, 0, 0.035, i === 0 ? shade(t.accent, 0.95) : shade(t.light, 0.95));
    });
    return null;
  },
  mattress: (k) => {
    const t = k.t;
    const rot = (k.rnd(1) - 0.5) * 0.2;
    const cu = 0.5 + (k.rnd(2) - 0.5) * 0.02;
    const cv = 0.49 + (k.rnd(3) - 0.5) * 0.02;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const L = (a: number, b: number, z: number): [number, number, number] => [cu + a * c - b * s, cv + a * s + b * c, z];
    const HU = 0.36;
    const HV = 0.27;
    const Z = 0.075;
    // A few things kept on the floor beside the bed: a bottle on its side, a paperback, a candle stub in a tin.
    const kit = k.rnd(13);
    if (kit < 0.3) {
      const bu = 0.34 + k.rnd(14) * 0.18;
      const bw = 0.815;
      k.line([[bu - 0.07, bw, 0.018], [bu + 0.03, bw, 0.018]], 0x4d5e46, 4, 1);
      k.line([[bu + 0.03, bw, 0.018], [bu + 0.07, bw, 0.018]], 0x4d5e46, 2, 1);
      k.line([[bu - 0.06, bw - 0.005, 0.026], [bu + 0.02, bw - 0.005, 0.026]], GLASS, 1, 0.45);
    } else if (kit < 0.55) {
      const bu = 0.32 + k.rnd(14) * 0.3;
      const bw = 0.815;
      k.box(bu - 0.05, bw - 0.025, bu + 0.03, bw + 0.025, 0, 0.014, shade(t.accent, 1.1));
      k.line([[bu - 0.012, bw - 0.025, 0.015], [bu - 0.012, bw + 0.025, 0.015]], shade(t.accent, 0.8), 1, 0.7);
    } else if (kit < 0.75) {
      const bu = 0.19;
      const bw = 0.815;
      squatSolid(k, bu, bw, 0.026, 0.026, 0, 0.02, shade(t.light, 0.9), 8, 2);
      k.disc(bu, bw, 0.014, 0.021, shade(t.light, 1.25), 1);
      if (!k.plan) k.line([[bu, bw, 0.021], [bu, bw, 0.045]], shade(t.ink, 0.8), 1, 0.9);
    }
    squatPrism(k, [L(-HU, -HV, 0), L(HU, -HV, 0), L(HU, HV, 0), L(-HU, HV, 0)], [L(-HU, -HV, Z), L(HU, -HV, Z), L(HU, HV, Z), L(-HU, HV, Z)], t.base, 2);
    // Ticking stripes down the side, quilting on the top, the piping round the edge, a stain.
    if (!k.plan) {
      for (const a of [-0.24, -0.08, 0.08, 0.24]) k.line([L(a, HV + 0.001, 0.012), L(a, HV + 0.001, Z - 0.012)], shade(t.base, 0.66), 1, 0.4);
    }
    const seam = shade(t.base, 0.76);
    for (const b of [-0.1, 0.1]) k.line([L(-0.14, b, Z + 0.001), L(HU - 0.03, b, Z + 0.001)], seam, 1, 0.45);
    for (const a of [0.03, 0.2]) k.line([L(a, -HV + 0.03, Z + 0.001), L(a, HV - 0.03, Z + 0.001)], seam, 1, 0.45);
    k.line([L(-HU + 0.02, -HV + 0.02, Z + 0.001), L(HU - 0.02, -HV + 0.02, Z + 0.001), L(HU - 0.02, HV - 0.02, Z + 0.001), L(-HU + 0.02, HV - 0.02, Z + 0.001), L(-HU + 0.02, -HV + 0.02, Z + 0.001)], seam, 1, 0.35);
    if (k.rnd(4) < 0.65) {
      const [su, sv] = L(0.02 + k.rnd(5) * 0.22, (k.rnd(6) - 0.5) * 0.3, 0);
      k.poly(squatBlob(k, su, sv, 0.08, 0.06, Z + 0.002, 8, 0.35, 7), shade(t.dark, 0.85), 0.35);
    }
    // A corner torn open, the foam showing.
    if (k.rnd(15) < 0.5) {
      const tear = [L(HU - 0.005, HV - 0.12, Z + 0.001), L(HU - 0.005, HV - 0.005, Z + 0.001), L(HU - 0.1, HV - 0.005, Z + 0.001), L(HU - 0.06, HV - 0.05, Z + 0.001)];
      k.poly(tear, shade(t.light, 1.12));
      k.line(tear, shade(t.base, 0.62), 1, 0.7);
    }
    // The pillow, soft-cornered, with the dent where a head was.
    const pb = (k.rnd(7) - 0.5) * 0.06;
    const pillow = (inset: number, z: number): Array<[number, number, number]> => {
      const A = 0.085 - inset;
      const B = 0.18 - inset;
      const ch = 0.03;
      return [L(-0.25 - A + ch, pb - B, z), L(-0.25 + A - ch, pb - B, z), L(-0.25 + A, pb - B + ch, z), L(-0.25 + A, pb + B - ch, z), L(-0.25 + A - ch, pb + B, z), L(-0.25 - A + ch, pb + B, z), L(-0.25 - A, pb + B - ch, z), L(-0.25 - A, pb - B + ch, z)];
    };
    squatPrism(k, pillow(0, Z), pillow(0.012, Z + 0.045), t.light, 2);
    const [du, dv] = L(-0.24, pb + 0.02, 0);
    k.poly(squatBlob(k, du, dv, 0.045, 0.08, Z + 0.046, 7, 0.2, 11), shade(t.light, 0.8), 0.45);
    // A blanket: spread over the foot and hanging off the near side, or balled up.
    const blanket = shade(t.accent, 0.62);
    const bv = k.rnd(8);
    if (bv < 0.5) {
      const a0 = -0.08 + k.rnd(9) * 0.14;
      const a1 = HU + 0.012;
      const zt = Z + 0.012;
      if (!k.plan) {
        k.poly([L(a1, -HV, zt), L(a1, HV + 0.02, zt), L(a1 + 0.008, HV + 0.02, 0.006), L(a1 + 0.008, -HV, 0.006)], shade(blanket, 0.69));
        k.poly([L(a0, HV + 0.02, zt), L(a1, HV + 0.02, zt), L(a1, HV + 0.03, 0.006), L(a0 + 0.03, HV + 0.03, 0.006)], shade(blanket, 0.78));
        for (const a of [a0 + 0.08, a0 + 0.18, a0 + 0.28]) k.line([L(a, HV + 0.021, zt - 0.004), L(a + 0.01, HV + 0.03, 0.01)], shade(blanket, 0.55), 1, 0.6);
      }
      k.poly([L(a0, -HV - 0.004, zt), L(a1, -HV, zt), L(a1, HV + 0.02, zt), L(a0 + 0.02, HV + 0.02, zt), L(a0 - 0.03, 0.02, zt)], k.plan ? blanket : shade(blanket, 0.875), 1, true);
      k.poly([L(a0, -HV - 0.004, zt + 0.001), L(a0 + 0.06, -HV, zt + 0.001), L(a0 + 0.05, 0.02, zt + 0.001), L(a0 + 0.08, HV + 0.02, zt + 0.001), L(a0 + 0.02, HV + 0.02, zt + 0.001), L(a0 - 0.03, 0.02, zt + 0.001)], shade(blanket, 1.28));
      // Two stripes woven across the blanket, and its creases.
      for (const a of [a1 - 0.09, a1 - 0.06]) k.line([L(a, -HV + 0.005, zt + 0.001), L(a, HV + 0.015, zt + 0.001)], shade(blanket, 1.18), 1, 0.55);
      k.line([L(a0 + 0.12, -0.18, zt + 0.001), L(a0 + 0.22, -0.02, zt + 0.001), L(a0 + 0.3, 0.06, zt + 0.001)], shade(blanket, 1.3), 1, 0.5);
      k.line([L(a0 + 0.1, 0.12, zt + 0.001), L(a0 + 0.24, 0.2, zt + 0.001)], shade(blanket, 1.3), 1, 0.5);
    } else if (bv < 0.82) {
      const [bu, bw] = L(0.22, (k.rnd(10) - 0.5) * 0.12, 0);
      squatPrism(k, squatBlob(k, bu, bw, 0.13, 0.19, Z, 9, 0.3, 12), squatBlob(k, bu + 0.01, bw, 0.08, 0.12, Z + 0.07, 9, 0.35, 12), blanket, 0);
      k.line([[bu - 0.04, bw - 0.06, Z + 0.071], [bu + 0.02, bw + 0.02, Z + 0.071], [bu - 0.01, bw + 0.08, Z + 0.071]], shade(blanket, 1.3), 1, 0.5);
    }
    return null;
  },
  lantern: (k, h, glow) => {
    const t = k.t;
    let top: number;
    let lo = 0.31;
    let hi = 0.69;
    if (h > 0.75) {
      squatCrate(k, 0.3, 0.3, 0.7, 0.7, 0, h * 0.28, t.base, 1);
      squatCrate(k, 0.34, 0.33, 0.67, 0.66, h * 0.28, h * 0.5, shade(t.base, 1.08), 2);
      top = h * 0.5;
      lo = 0.34;
      hi = 0.67;
    } else {
      squatCrate(k, 0.31, 0.31, 0.69, 0.69, 0, h * 0.46, t.base, 1);
      top = h * 0.46;
    }
    const mid = (lo + hi) / 2;
    const lu = mid + 0.01 + (k.rnd(3) - 0.5) * 0.05;
    const lv = mid + 0.01 + (k.rnd(4) - 0.5) * 0.05;
    const lh = Math.min(0.4, h * 0.68);
    const R = 0.078;
    const metal = shade(t.ink, 0.85);
    const tin = k.rnd(5) < 0.5;
    if (tin) squatSolid(k, lo + 0.065, lo + 0.075, 0.033, 0.033, top, top + 0.05, shade(t.light, 0.95), 7, 2);
    // A hurricane lamp: the fuel fount in the set's accent on a pressed base ring.
    squatSolid(k, lu, lv, R, R, top, top + lh * 0.05, metal, 10, 4);
    squatSolid(k, lu, lv, R * 0.96, R * 0.8, top + lh * 0.05, top + lh * 0.22, shade(t.accent, 0.92), 10, 2);
    const g0 = top + lh * 0.25;
    const g1 = top + lh * 0.68;
    const gm = (g0 + g1) / 2;
    const glass = glow ?? squatMix(GLASS, t.ink, 0.5);
    // The globe, bellied, over the burner collar.
    squatSolid(k, lu, lv, R * 0.5, R * 0.5, top + lh * 0.22, g0, metal, 8, 1 | 4);
    squatSolid(k, lu, lv, R * 0.58, R * 0.8, g0, gm, glass, 10, 1 | 4);
    squatSolid(k, lu, lv, R * 0.8, R * 0.5, gm, g1, glass, 10, 4);
    if (!k.plan) {
      if (glow !== null) {
        k.poly([[lu - 0.02, lv + 0.02, g0 + 0.01], [lu + 0.02, lv - 0.02, g0 + 0.01], [lu + 0.012, lv - 0.012, g0 + lh * 0.14], [lu, lv, g0 + lh * 0.3], [lu - 0.012, lv + 0.012, g0 + lh * 0.14]], squatMix(glow, 0xfff1b0, 0.75), 1);
      } else {
        k.line([[lu, lv, g0], [lu, lv, g0 + 0.035]], t.ink, 2, 0.9);
      }
      // Soot up the inside of the chimney glass, a glint down its lit side, the wire guard.
      k.band(lu, lv, R * 0.62, g1 - lh * 0.05, shade(t.ink, 0.6), 0.45, 2);
      k.line([squatOn(lu, lv, R * 0.62, 2.1, g0 + lh * 0.06), squatOn(lu, lv, R * 0.82, 2.0, gm), squatOn(lu, lv, R * 0.56, 2.1, g1 - lh * 0.08)], GLASS, 1, glow !== null ? 0.4 : 0.65);
      for (const a of [0.15, 0.85, 1.55]) k.line([squatOn(lu, lv, R * 0.6, a, g0), squatOn(lu, lv, R * 0.84, a, gm), squatOn(lu, lv, R * 0.52, a, g1)], metal, 1, 0.85);
      k.band(lu, lv, R * 0.84, gm, metal, 0.85, 1);
      // The two air tubes up the sides, from fount to cap.
      for (const a of [Math.PI * 0.75, -Math.PI * 0.25]) {
        k.line([squatOn(lu, lv, R * 1.02, a, top + lh * 0.18), squatOn(lu, lv, R * 1.02, a, g1 + lh * 0.02), squatOn(lu, lv, R * 0.7, a, g1 + lh * 0.08)], metal, 1.5, 0.95);
      }
      squatSolid(k, lu, lv, R * 0.78, R * 0.34, g1, g1 + lh * 0.13, metal, 10, 2);
      squatSolid(k, lu, lv, R * 0.26, R * 0.26, g1 + lh * 0.13, g1 + lh * 0.19, metal, 6, 4);
      k.faceCircle(lu + 0.03, lv + R * 0.9, top + lh * 0.14, 0.018, 'u', shade(t.light, 0.8));
    } else {
      k.disc(lu, lv, R * 0.36, g1, metal, 1, true);
    }
    const bail: Array<[number, number, number]> = [];
    const ct = g1 + lh * 0.12;
    if (k.plan) {
      // From above the bail lies folded along one side of the globe: a C, not a slash through a ring.
      for (let i = 0; i <= 6; i += 1) bail.push(squatOn(lu, lv, R * 1.12, Math.PI * 0.6 + (i / 6) * Math.PI * 0.8, ct));
    } else {
      for (let i = 0; i <= 8; i += 1) {
        const d = -0.07 + (0.14 * i) / 8;
        bail.push([lu + d, lv - d, ct + 0.1 * Math.sqrt(Math.max(0, 1 - (d / 0.07) ** 2))]);
      }
    }
    k.line(bail, t.ink, 1, 0.9);
    if (!tin) k.box(lo + 0.04, hi - 0.09, lo + 0.12, hi - 0.035, top, top + 0.025, shade(t.accent, 1.05));
    if (glow === null) return null;
    // The lit globe is the fixture: its standing face in isometric, its round top in plan (a vertical face has no area there).
    return k.plan ? k.pool(lu, lv, R * 0.8) : k.pts([[lu - 0.05, lv + 0.05, g0], [lu + 0.05, lv - 0.05, g0], [lu + 0.05, lv - 0.05, g1], [lu - 0.05, lv + 0.05, g1]]);
  },
  cart: (k, h) => {
    const t = k.t;
    const H = h;
    const wire = t.light;
    const zb = 0.4 * H;
    const zt = 0.88 * H;
    // Basket: wide at the handle, tucked in at the nose.
    const tu0 = 0.22;
    const tu1 = 0.8;
    const tv0 = 0.32;
    const tv1 = 0.78;
    const bu0 = 0.26;
    const bu1 = 0.66;
    const bv0 = 0.36;
    const bv1 = 0.74;
    const cr = 0.07 * H;
    const contents = k.rnd(1);
    if (k.plan) {
      k.poly([[tu0, tv0, 0], [tu1, tv0, 0], [tu1, tv1, 0], [tu0, tv1, 0]], shade(t.base, 0.7), 0.55, true);
      const grid: Array<[number, number, number]> = [];
      for (let i = 1; i < 6; i += 1) {
        const u = tu0 + ((tu1 - tu0) * i) / 6;
        grid.push(i % 2 ? [u, tv0, 0] : [u, tv1, 0], i % 2 ? [u, tv1, 0] : [u, tv0, 0]);
      }
      k.line(grid, wire, 1, 0.4);
      k.line([[tu0 + 0.01, 0.45, 0], [tu1 - 0.01, 0.45, 0], [tu1 - 0.01, 0.62, 0], [tu0 + 0.01, 0.62, 0]], wire, 1, 0.35);
    } else {
      // Casters and the frame they carry.
      for (const [u, v] of [[0.28, 0.36], [0.7, 0.36]] as const) k.faceCircle(u, v, cr, cr, 'u', t.ink, 1);
      k.line([[0.28, 0.36, cr], [bu0, bv0, zb], [bu1, bv0, zb], [0.7, 0.36, cr]], t.dark, 1.5, 0.95);
      k.poly([[0.28, 0.37, 0.17 * H], [0.7, 0.37, 0.17 * H], [0.7, 0.73, 0.17 * H], [0.28, 0.73, 0.17 * H]], t.dark, 0.7);
      // The far wire walls and floor, seen through the near ones.
      k.poly([[bu0, bv0, zb], [bu1, bv0, zb], [bu1, bv1, zb], [bu0, bv1, zb]], shade(t.base, 0.55), 0.5);
      k.poly([[bu0, bv0, zb], [bu1, bv0, zb], [tu1, tv0, zt], [tu0, tv0, zt]], shade(t.base, 0.6), 0.28);
      k.poly([[bu0, bv0, zb], [bu0, bv1, zb], [tu0, tv1, zt], [tu0, tv0, zt]], shade(t.base, 0.6), 0.28);
    }
    // Handle at the back.
    k.line([[tu0, tv0 + 0.01, zt], [0.16, tv0, zt + 0.14 * H], [0.16, tv1, zt + 0.14 * H], [tu0, tv1 - 0.01, zt]], wire, 1.5, 0.95);
    k.line([[0.16, 0.4, zt + 0.14 * H], [0.16, 0.7, zt + 0.14 * H]], t.accent, 3, 1);
    // Everything somebody owns, heaped above the rim.
    const roll = (u0: number, u1: number, z0: number, color: number): void => {
      // A bedroll lying across the basket, tied twice.
      k.box(u0, 0.38, u1, 0.72, z0, z0 + (u1 - u0) * 0.9, color);
      if (!k.plan) {
        const zz = z0 + (u1 - u0) * 0.9;
        k.line([[u0 + 0.03, 0.72, z0], [u0 + 0.03, 0.72, zz], [u0 + 0.03, 0.38, zz]], t.ink, 1.5, 0.6);
        k.line([[u1 - 0.03, 0.72, z0], [u1 - 0.03, 0.72, zz], [u1 - 0.03, 0.38, zz]], t.ink, 1.5, 0.6);
      }
    };
    if (contents < 0.34) {
      k.line([[0.3, 0.42, zb + 0.1 * H], [0.24, 0.36, zt + 0.55 * H]], t.ink, 1.5, 0.9);
      streetSack(k, 0.4, 0.52, 0.26, 0.52 * H, zt - 0.1 * H, shade(t.base, 1.12), 11);
      roll(0.56, 0.72, zt - 0.02 * H, shade(t.accent, 0.92));
    } else if (contents < 0.67) {
      k.box(0.3, 0.38, 0.48, 0.6, zb, zt + 0.08 * H, shade(t.light, 0.92));
      if (!k.plan) k.line([[0.3, 0.6, zt + 0.08 * H], [0.48, 0.6, zt + 0.08 * H]], shade(t.light, 0.6), 1.5, 0.6);
      streetSack(k, 0.6, 0.5, 0.24, 0.5 * H, zt - 0.06 * H, shade(t.dark, 1.12), 12);
      streetSack(k, 0.44, 0.64, 0.18, 0.36 * H, zt - 0.04 * H, shade(t.base, 1.14), 13);
    } else {
      roll(0.28, 0.42, zt - 0.02 * H, shade(t.base, 1.12));
      streetSack(k, 0.58, 0.54, 0.3, 0.5 * H, zt - 0.08 * H, shade(t.accent, 0.95), 14);
      k.line([[0.66, 0.4, zt - 0.05 * H], [0.76, 0.3, zt + 0.35 * H]], t.ink, 1.5, 0.9);
    }
    if (!k.plan) {
      // Near wire walls: a skin, then one zigzag stroke for the uprights and one for the rungs.
      k.poly([[bu0, bv1, zb], [bu1, bv1, zb], [tu1, tv1, zt], [tu0, tv1, zt]], shade(t.base, 0.68), 0.3);
      k.poly([[bu1, bv1, zb], [bu1, bv0, zb], [tu1, tv0, zt], [tu1, tv1, zt]], shade(t.base, 0.6), 0.3);
      const ups: Array<[number, number, number]> = [];
      for (let i = 0; i <= 6; i += 1) {
        const f = i / 6;
        const lo: [number, number, number] = [bu0 + (bu1 - bu0) * f, bv1, zb];
        const hi: [number, number, number] = [tu0 + (tu1 - tu0) * f, tv1, zt];
        ups.push(...(i % 2 === 0 ? [lo, hi] : [hi, lo]));
      }
      k.line(ups, wire, 1, 0.5);
      const rungs: Array<[number, number, number]> = [];
      for (let i = 1; i <= 2; i += 1) {
        const f = i / 3;
        const a: [number, number, number] = [bu0 + (tu0 - bu0) * f, bv1 + (tv1 - bv1) * f, zb + (zt - zb) * f];
        const b: [number, number, number] = [bu1 + (tu1 - bu1) * f, bv1 + (tv1 - bv1) * f, zb + (zt - zb) * f];
        const c: [number, number, number] = [bu1 + (tu1 - bu1) * f, bv0 + (tv0 - bv0) * f, zb + (zt - zb) * f];
        rungs.push(...(i % 2 ? [a, b, c] : [c, b, a]));
      }
      k.line(rungs, wire, 1, 0.45);
      const nose: Array<[number, number, number]> = [];
      for (let i = 1; i < 4; i += 1) {
        const f = i / 4;
        const lo: [number, number, number] = [bu1, bv1 + (bv0 - bv1) * f, zb];
        const hi: [number, number, number] = [tu1, tv1 + (tv0 - tv1) * f, zt];
        nose.push(...(i % 2 ? [lo, hi] : [hi, lo]));
      }
      k.line(nose, wire, 1, 0.45);
      k.line([[bu0, bv1, zb], [bu1, bv1, zb], [bu1, bv0, zb]], t.dark, 1.5, 0.95);
      k.line([[tu1, tv0, zt], [bu1, bv0, zb]], wire, 1, 0.8);
      k.line([[tu0, tv1, zt], [bu0, bv1, zb]], wire, 1, 0.8);
      k.line([[bu1, bv1, zb], [tu1, tv1, zt]], wire, 1.5, 0.9);
      // Near casters.
      k.line([[0.28, 0.74, cr], [bu0, bv1, zb]], t.dark, 1.5, 0.95);
      k.line([[0.7, 0.74, cr], [bu1, bv1, zb]], t.dark, 1.5, 0.95);
      for (const u of [0.28, 0.7]) {
        k.faceCircle(u, 0.74, cr, cr, 'u', t.ink, 1);
        k.faceCircle(u, 0.742, cr, cr * 0.35, 'u', t.light, 0.8);
      }
      if (k.rnd(5) < 0.45) {
        // A carrier bag hung off the near rim by its handles.
        const bv = tv1 + 0.012;
        const bagc = shade(t.light, 0.95);
        k.poly([[0.33, bv, zt - 0.02 * H], [0.45, bv, zt - 0.02 * H], [0.47, bv, zt - 0.3 * H], [0.44, bv, zt - 0.36 * H], [0.33, bv, zt - 0.35 * H], [0.31, bv, zt - 0.26 * H]], bagc, 0.95, true);
        k.line([[0.35, bv, zt - 0.02 * H], [0.37, bv, zt + 0.06 * H], [0.41, bv, zt + 0.06 * H], [0.43, bv, zt - 0.02 * H]], bagc, 1, 0.9);
      }
    }
    // The rim, inked.
    const rim: Array<[number, number, number]> = [[tu0, tv0, zt], [tu1, tv0, zt], [tu1, tv1, zt], [tu0, tv1, zt], [tu0, tv0, zt]];
    k.line(rim, t.ink, 3, 0.45);
    k.line(rim, wire, 1.5, 0.9);
    return null;
  },

  // --- home ---------------------------------------------------------------
  bed: (k, h) => {
    const t = k.t;
    const frame = shade(t.ink, 1.02);
    const sheet = homeCap(shade(t.light, 1.18));
    const pillow = homeCap(shade(t.light, 1.32));
    const duvet = shade(t.accent, 0.8);
    const head = k.rnd(1);
    const iron = head >= 0.68;
    const rail = shade(t.ink, 0.9);
    const knob = homeCap(shade(t.light, 1.05));
    // An iron bedstead: posts with knobs, a top rail, bars between the rails.
    const bedstead = (v: number, z0: number, z1: number, zm: number) => {
      k.line([[0.1, v, z0], [0.1, v, z1], [0.9, v, z1], [0.9, v, z0]], rail, 2, 1);
      if (k.plan) return;
      const bars: Array<[number, number, number]> = [[0.1, v, zm], [0.9, v, zm]];
      for (let i = 0; i < 7; i += 1) {
        const u = 0.9 - (i + 1) * 0.1;
        bars.push([u, v, i % 2 === 0 ? zm : z1], [u, v, i % 2 === 0 ? z1 : zm]);
      }
      k.line(bars, rail, 1, 0.9);
      k.disc(0.1, v, 0.024, z1 + 0.02, knob, 1, true);
      k.disc(0.9, v, 0.024, z1 + 0.02, knob, 1, true);
    };
    // A recessed plinth, then the rail the mattress sits in.
    if (!k.plan) k.box(0.11, 0.08, 0.89, 0.92, 0, h * 0.12, shade(t.ink, 0.8), { crown: false });
    k.box(0.08, 0.05, 0.92, 0.95, h * 0.12, h * 0.3, frame);
    if (iron) {
      bedstead(0.075, h * 0.12, h * 1.12, h * 0.62);
    } else {
      // Headboard: slatted or buttoned into a panel, under a cap.
      if (!k.plan) {
        k.box(0.08, 0.05, 0.92, 0.11, h * 0.3, h, shade(t.base, 0.8));
        if (head < 0.34) homeJointsU(k, 0.111, [0.22, 0.36, 0.5, 0.64, 0.78], h * 0.58, h * 0.96, t.ink, 0.5);
        else {
          k.facePanel('u', 0.111, 0.14, h * 0.5, 0.86, h * 0.93, shade(t.base, 0.66), 1, true);
          k.line([[0.26, 0.112, h * 0.64], [0.26, 0.112, h * 0.8], [0.5, 0.112, h * 0.8], [0.5, 0.112, h * 0.64], [0.74, 0.112, h * 0.64], [0.74, 0.112, h * 0.8]], homeCap(shade(t.base, 1.0)), 1, 0.35);
        }
      }
      k.box(0.07, 0.04, 0.93, 0.12, h, h * 1.08, shade(t.base, 0.86));
    }
    // Mattress, with its piped seam.
    k.box(0.1, 0.11, 0.9, 0.93, h * 0.3, h * 0.5, sheet);
    if (!k.plan) k.line([[0.1, 0.931, h * 0.41], [0.9, 0.931, h * 0.41], [0.901, 0.11, h * 0.41]], shade(sheet, 0.55), 1, 0.5);
    // One pillow or two, never quite square to each other.
    const pv = 0.14 + k.rnd(3) * 0.02;
    const pillows: Array<[number, number, number]> =
      k.rnd(2) < 0.65 ? [[0.13 + k.rnd(4) * 0.03, 0.48, 0], [0.52, 0.87 - k.rnd(5) * 0.03, 0.015]] : [[0.18, 0.82, 0.01]];
    for (const [u0, u1, dv] of pillows) {
      // A plump pillow: a short body, and a top that bows out between pinched corners.
      const v0 = pv + dv;
      const v1 = v0 + 0.17;
      const um = (u0 + u1) / 2;
      const vm = (v0 + v1) / 2;
      const b = 0.018;
      k.box(u0 + 0.01, v0 + 0.01, u1 - 0.01, v1 - 0.01, h * 0.5, h * 0.6, shade(pillow, 0.92), { crown: false, ink: false });
      k.poly([[u0, v0, h * 0.62], [um, v0 - b, h * 0.64], [u1, v0, h * 0.62], [u1 + b, vm, h * 0.64], [u1, v1, h * 0.62], [um, v1 + b, h * 0.64], [u0, v1, h * 0.62], [u0 - b, vm, h * 0.64]], shade(pillow, 0.875), 1, true);
      homeFlat(k, u0 + 0.05, v0 + 0.035, um + 0.02, vm, h * 0.645, homeCap(shade(pillow, 0.97)), 0.7);
    }
    // The duvet drapes over both visible sides; its top edge folded back.
    const vd = 0.4 + k.rnd(6) * 0.12;
    const style = k.rnd(7);
    k.box(0.085, vd, 0.915, 0.945, h * 0.36, h * 0.57, duvet);
    for (const q of [0.3, 0.46]) {
      if (vd + q < 0.93) k.line([[0.085, vd + q, h * 0.571], [0.915, vd + q, h * 0.571], [0.915, vd + q, h * 0.37]], shade(duvet, 0.62), 1, 0.6);
    }
    const fold = homeCap(shade(t.light, 1.06));
    k.box(0.085, vd, style >= 0.45 && style < 0.8 ? 0.62 : 0.915, vd + 0.08, h * 0.57, h * 0.61, fold, { crown: false });
    if (style < 0.45) {
      // A folded throw across the foot.
      const tv = 0.76 + k.rnd(8) * 0.05;
      k.box(0.08, tv, 0.92, tv + 0.12, h * 0.4, h * 0.63, shade(t.ink, 1.12));
      k.line([[0.08, tv + 0.03, h * 0.632], [0.92, tv + 0.03, h * 0.632], [0.921, tv + 0.03, h * 0.41]], homeCap(shade(t.light, 0.95)), 1, 0.55);
    } else if (style < 0.8) {
      // Unmade: the duvet's corner thrown back over itself, the sheet under it.
      const z = h * 0.572;
      const a = vd + 0.08;
      k.poly([[0.62, a, z], [0.915, a, z], [0.915, a + 0.31, z]], shade(sheet, 0.875));
      k.poly([[0.62, a, h * 0.59], [0.915, a + 0.31, h * 0.59], [0.605, a + 0.295, h * 0.59]], shade(fold, 0.875), 1, true);
    }
    if (k.rnd(11) < 0.3) {
      // A book left open, face down, on the covers.
      const bu = 0.17 + k.rnd(12) * 0.2;
      const bv = vd + 0.14 + k.rnd(13) * 0.08;
      const z = h * 0.575;
      k.poly([[bu, bv, z], [bu + 0.1, bv - 0.025, z + 0.02], [bu + 0.2, bv, z], [bu + 0.2, bv + 0.12, z], [bu + 0.1, bv + 0.095, z + 0.02], [bu, bv + 0.12, z]], shade(t.accent, 1.05), 1, true);
      k.line([[bu + 0.1, bv - 0.025, z + 0.021], [bu + 0.1, bv + 0.095, z + 0.021]], homeCap(shade(t.light, 1.2)), 1, 0.6);
    }
    if (iron) bedstead(0.952, h * 0.12, h * 0.8, h * 0.5);
    return null;
  },
  counter: (k, h) => {
    const t = k.t;
    const body = shade(t.base, 0.92);
    const top = homeCap(shade(t.light, 1.1));
    const zc = h * 0.86;
    const zw = h * 0.94;
    if (!k.plan) {
      k.box(0.07, 0.33, 0.93, 0.82, 0, h * 0.1, shade(t.ink, 0.85), { crown: false });
      k.box(0.05, 0.32, 0.95, 0.84, h * 0.1, zc, body);
      // Three bays of fronts: doors, and at most one stack of drawers.
      const drawers = Math.floor(k.rnd(1) * 4);
      const front = shade(body, 0.8);
      const handle = homeCap(shade(t.light, 1.0));
      const bays: Array<[number, number]> = [[0.06, 0.35], [0.355, 0.645], [0.65, 0.94]];
      bays.forEach(([a0, a1], i) => {
        if (i === drawers) {
          for (let j = 0; j < 3; j += 1) {
            const z0 = h * (0.14 + j * 0.23);
            const z1 = z0 + h * 0.21;
            k.facePanel('u', 0.841, a0 + 0.012, z0, a1 - 0.012, z1, front, 1, true);
            k.facePanel('u', 0.842, (a0 + a1) / 2 - 0.05, z1 - h * 0.08, (a0 + a1) / 2 + 0.05, z1 - h * 0.05, handle);
          }
        } else {
          k.facePanel('u', 0.841, a0 + 0.012, h * 0.14, a1 - 0.012, h * 0.82, front, 1, true);
          const hu = i === 0 ? a1 - 0.05 : a0 + 0.028;
          k.facePanel('u', 0.842, hu, h * 0.58, hu + 0.024, h * 0.76, handle);
        }
      });
    }
    // Worktop, overhanging the fronts, and a tiled splashback against the wall.
    k.box(0.03, 0.3, 0.97, 0.86, zc, zw, top);
    const sb = shade(t.accent, 0.96);
    const zs = h * 1.42;
    k.box(0.05, 0.3, 0.95, 0.335, zw, zs, sb);
    // Grout is lighter than the tile, so the joints that run along the edges read as its bead.
    const grout = homeCap(shade(sb, 1.0));
    homeJointsU(k, 0.336, [0.2, 0.35, 0.5, 0.65, 0.8], zw, zs, grout, 0.45);
    if (!k.plan) k.line([[0.05, 0.336, (zw + zs) / 2], [0.95, 0.336, (zw + zs) / 2]], grout, 1, 0.45);
    // Left of the worktop: a board and knife, canisters, or a kettle.
    const left = k.rnd(2);
    if (left < 0.35) {
      k.box(0.12, 0.5, 0.42, 0.76, zw, zw + 0.025, shade(t.light, 0.92), { crown: false });
      k.line([[0.2, 0.57, zw + 0.03], [0.31, 0.6, zw + 0.03]], homeCap(shade(t.light, 1.3)), 1, 0.9);
      k.line([[0.31, 0.6, zw + 0.03], [0.38, 0.62, zw + 0.03]], shade(t.ink, 0.8), 2, 0.95);
    } else if (left < 0.65) {
      for (let i = 0; i < 3; i += 1) {
        const u = 0.12 + i * 0.1;
        const c = i === 1 ? t.accent : homeCap(shade(t.light, 1.05));
        k.box(u, 0.38, u + 0.075, 0.455, zw, zw + h * (0.26 - i * 0.05), c, { crown: false });
      }
    } else if (left < 0.9) {
      const kc = homeCap(shade(t.light, 1.15));
      homeTaper(k, 0.27, 0.52, 0.08, 0.06, zw, zw + h * 0.28, kc, 8);
      k.line([[0.2, 0.58, zw + h * 0.12], [0.13, 0.64, zw + h * 0.2]], kc, 2, 0.9);
      k.line([[0.32, 0.47, zw + h * 0.28], [0.35, 0.44, zw + h * 0.36], [0.36, 0.42, zw + h * 0.2]], t.ink, 1, 0.8);
    }
    // Right: a microwave against the splashback, or a mug and a bowl.
    const right = k.rnd(3);
    if (right < 0.4) {
      const m = shade(t.ink, 1.12);
      const zm = zw + h * 0.44;
      k.box(0.56, 0.36, 0.92, 0.64, zw, zm, m);
      if (!k.plan) {
        k.facePanel('u', 0.641, 0.59, zw + h * 0.07, 0.8, zm - h * 0.07, shade(t.ink, 0.55), 1, true);
        k.line([[0.62, 0.642, zm - h * 0.12], [0.67, 0.642, zw + h * 0.14]], GLASS, 1, 0.25);
        k.facePanel('u', 0.641, 0.83, zw + h * 0.1, 0.89, zm - h * 0.1, shade(t.light, 0.75));
      }
    } else if (right < 0.75) {
      homeTaper(k, 0.66, 0.6, 0.035, 0.038, zw, zw + h * 0.16, homeCap(shade(t.accent, 1.15)), 6);
      k.disc(0.66, 0.6, 0.026, zw + h * 0.161, shade(t.ink, 0.7), 1);
      k.disc(0.8, 0.48, 0.08, zw + h * 0.05, homeCap(shade(t.light, 1.2)), 1, true);
      k.disc(0.8, 0.48, 0.055, zw + h * 0.052, shade(t.dark, 0.9), 1);
    }
    return null;
  },
  stove: (k, h, glow) => {
    const t = k.t;
    const body = t.base;
    const zb = h * 0.86;
    const zt = h * 0.92;
    if (!k.plan) {
      k.box(0.14, 0.22, 0.86, 0.82, 0, h * 0.07, shade(t.ink, 0.85), { crown: false });
      k.box(0.12, 0.2, 0.88, 0.84, h * 0.07, zb, body);
      // Control fascia: four knobs and a timer.
      k.facePanel('u', 0.841, 0.12, h * 0.7, 0.88, zb, shade(t.dark, 0.72));
      for (const u of [0.19, 0.29, 0.71, 0.81]) k.faceCircle(u, 0.842, h * 0.78, 0.028, 'u', homeCap(shade(t.light, 1.0)), 1);
      k.facePanel('u', 0.842, 0.43, h * 0.74, 0.57, h * 0.82, glow ?? shade(t.ink, 0.6));
      // Oven door: a panel, its window, the bar across it.
      k.facePanel('u', 0.841, 0.16, h * 0.12, 0.84, h * 0.66, shade(body, 0.84), 1, true);
      k.facePanel('u', 0.842, 0.24, h * 0.22, 0.76, h * 0.5, glow ?? shade(t.ink, 0.7), glow !== null ? 0.9 : 1);
      if (glow === null) k.line([[0.3, 0.843, h * 0.47], [0.38, 0.843, h * 0.25]], GLASS, 1, 0.22);
      k.facePanel('u', 0.843, 0.22, h * 0.56, 0.78, h * 0.61, homeCap(shade(t.light, 1.05)));
    }
    // Hob, backguard, enamel, then the rings.
    k.box(0.11, 0.19, 0.89, 0.85, zb, zt, shade(body, 1.06));
    k.box(0.11, 0.19, 0.89, 0.25, zt, h * 1.24, shade(body, 0.9));
    if (!k.plan) k.facePanel('u', 0.251, 0.4, zt + h * 0.08, 0.6, zt + h * 0.22, shade(t.ink, 0.6), 1, true);
    homeFlat(k, 0.15, 0.27, 0.85, 0.81, zt + 0.002, shade(t.ink, 0.8));
    const burners: Array<[number, number, number]> = [[0.33, 0.43, 0.115], [0.67, 0.43, 0.085], [0.33, 0.66, 0.085], [0.67, 0.66, 0.115]];
    const grate = shade(t.light, 0.8);
    for (const [u, v, r] of burners) {
      k.disc(u, v, r, zt, shade(t.dark, 1.05), 1);
      k.disc(u, v, r * 0.62, zt, glow ?? shade(t.ink, 0.62), 1);
      if (!k.plan) k.disc(u, v, r * 0.26, zt, shade(t.dark, 0.9), 1);
      const z = zt + 0.012;
      k.line([[u - r * 1.08, v, z], [u + r * 1.08, v, z], [u, v, z], [u, v - r * 1.08, z], [u, v + r * 1.08, z]], grate, 1, 0.55);
    }
    // Whatever is cooking.
    const pan = k.rnd(1);
    const steel = homeCap(shade(t.light, 1.1));
    if (pan < 0.4) {
      homeTaper(k, 0.67, 0.43, 0.075, 0.082, zt, zt + h * 0.24, steel, 8);
      k.disc(0.67, 0.43, 0.064, zt + h * 0.241, shade(t.ink, 0.8), 1);
      k.line([[0.75, 0.4, zt + h * 0.2], [0.93, 0.33, zt + h * 0.22]], shade(t.ink, 0.9), 2, 0.95);
    } else if (pan < 0.7) {
      k.disc(0.67, 0.66, 0.125, zt + 0.02, shade(t.ink, 0.95), 1, true);
      k.band(0.67, 0.66, 0.125, zt + 0.02, steel, 0.6, 1);
      k.disc(0.67, 0.66, 0.09, zt + 0.022, shade(t.dark, 0.75), 1);
      k.line([[0.59, 0.76, zt + 0.025], [0.49, 0.94, zt + 0.05]], shade(t.ink, 0.8), 2, 0.95);
    }
    return glow ? k.pool(0.5, 0.55, 0.32) : null;
  },
  fridge: (k, h) => {
    const t = k.t;
    const body = homeCap(shade(t.base, 1.08));
    const door = homeCap(shade(body, 1.06));
    const B = 0.815;
    const S = 0.85;
    const F = S + 0.002;
    const zp = h * 0.075;
    const bar = homeCap(shade(t.light, 1.2));
    const barShadow = shade(t.ink, 0.8);
    if (!k.plan) {
      // A recessed plinth under the doors, its kick grille facing the room.
      k.box(0.22, 0.22, 0.78, 0.8, 0, zp, shade(t.ink, 0.72), { crown: false });
      k.facePanel('u', 0.801, 0.27, zp * 0.2, 0.73, zp * 0.85, shade(t.ink, 0.45));
    }
    k.box(0.2, 0.2, 0.8, B, zp, h, body);
    // The condenser grille along the back of the top.
    homeFlat(k, 0.24, 0.23, 0.76, 0.3, h + 0.001, shade(body, 0.84));
    k.line([[0.28, 0.25, h + 0.002], [0.72, 0.25, h + 0.002], [0.72, 0.28, h + 0.002], [0.28, 0.28, h + 0.002]], shade(body, 0.72), 1, 0.5);
    // Doors are slabs proud of the carcass: their edge shows down the side and a gap shows between them.
    const slab = (u0: number, u1: number, z0: number, z1: number) => k.box(u0, B, u1, S, z0, z1, k.plan ? shade(door, 0.8) : door);
    const handleV = (u: number, z0: number, z1: number) => {
      k.facePanel('u', F, u + 0.016, z0 - 0.022, u + 0.04, z1 - 0.022, barShadow, 0.6);
      k.facePanel('u', F + 0.001, u, z0, u + 0.024, z1, bar);
    };
    const handleH = (u0: number, u1: number, z: number) => {
      k.facePanel('u', F, u0 + 0.015, z - 0.05, u1 + 0.015, z - 0.018, barShadow, 0.6);
      k.facePanel('u', F + 0.001, u0, z - 0.03, u1, z, bar);
    };
    // Paper held on by magnets: a list, a photo, a child's drawing.
    const notes = (u0: number, u1: number, z0: number, z1: number, salt: number) => {
      const n = Math.floor(k.rnd(salt) * 4);
      for (let i = 0; i < n; i += 1) {
        const w = 0.07 + k.rnd(salt + 10 + i) * 0.04;
        const u = u0 + k.rnd(salt + 20 + i) * (u1 - u0 - w);
        const z = z0 + k.rnd(salt + 30 + i) * (z1 - z0 - h * 0.12);
        const tilt = (k.rnd(salt + 40 + i) - 0.5) * 0.05;
        const c = i === 1 ? shade(t.accent, 1.0) : homeCap(shade(t.light, 1.14));
        k.poly([[u, F, z], [u + w, F, z + tilt], [u + w, F, z + tilt + h * 0.12], [u, F, z + h * 0.12]], c, 0.9);
        if (i === 0) k.facePanel('u', F + 0.001, u + w / 2 - 0.012, z + h * 0.1, u + w / 2 + 0.012, z + h * 0.13, shade(t.accent, 0.8));
      }
    };
    const kind = k.rnd(1);
    if (kind < 0.4) {
      // Freezer over fridge, handles meeting at the gap.
      slab(0.2, 0.8, zp + 0.004, h * 0.625);
      slab(0.2, 0.8, h * 0.645, h * 0.99);
      handleV(0.715, h * 0.69, h * 0.86);
      handleV(0.715, h * 0.36, h * 0.58);
      notes(0.26, 0.66, h * 0.22, h * 0.58, 50);
    } else if (kind < 0.7) {
      // Fridge over a freezer drawer; a dispenser or a screen in the door.
      slab(0.2, 0.8, zp + 0.004, h * 0.33);
      slab(0.2, 0.8, h * 0.35, h * 0.99);
      handleH(0.3, 0.7, h * 0.3);
      handleV(0.715, h * 0.46, h * 0.84);
      if (k.rnd(2) < 0.5) {
        k.facePanel('u', F, 0.29, h * 0.5, 0.49, h * 0.76, shade(t.ink, 0.6), 1, true);
        k.facePanel('u', F + 0.001, 0.32, h * 0.52, 0.46, h * 0.55, homeCap(shade(t.light, 0.9)));
        k.facePanel('u', F + 0.001, 0.375, h * 0.62, 0.405, h * 0.74, shade(t.ink, 0.9));
      } else {
        // A smart panel: portrait, tablet-sized, a status bar across its top — not a landscape window, which read as an oven.
        k.facePanel('u', F, 0.3, h * 0.5, 0.45, h * 0.8, shade(t.ink, 0.55), 1, true);
        k.facePanel('u', F + 0.001, 0.315, h * 0.74, 0.435, h * 0.77, homeCap(shade(t.light, 0.85)), 0.7);
        k.poly([[0.32, F + 0.001, h * 0.53], [0.35, F + 0.001, h * 0.53], [0.42, F + 0.001, h * 0.72], [0.39, F + 0.001, h * 0.72]], GLASS, 0.16);
      }
    } else {
      // Side by side: freezer left with its dispenser, fridge right.
      slab(0.2, 0.494, zp + 0.004, h * 0.99);
      slab(0.506, 0.8, zp + 0.004, h * 0.99);
      handleV(0.445, h * 0.4, h * 0.82);
      handleV(0.53, h * 0.4, h * 0.82);
      if (k.rnd(2) < 0.6) {
        k.facePanel('u', F, 0.25, h * 0.52, 0.4, h * 0.74, shade(t.ink, 0.6), 1, true);
        k.facePanel('u', F + 0.001, 0.27, h * 0.54, 0.38, h * 0.565, homeCap(shade(t.light, 0.9)));
      }
      notes(0.58, 0.76, h * 0.2, h * 0.7, 60);
    }
    // What lives on top of a fridge.
    const onTop = k.rnd(9);
    if (onTop < 0.3) {
      // Cartons shoved up out of the way, never square to the fridge or each other.
      const a = (k.rnd(14) - 0.5) * 0.9;
      homeSlab(k, 0.42 + k.rnd(11) * 0.08, 0.42, 0.16, 0.12, a, h, h + 0.07, shade(t.dark, 1.05));
      homeSlab(k, 0.45, 0.4 + k.rnd(15) * 0.06, 0.1, 0.07, a + 0.5 + k.rnd(16) * 0.6, h + 0.07, h + 0.19, shade(t.accent, 0.95));
    } else if (onTop < 0.52) {
      // A fruit bowl, heaped.
      const bu = 0.44 + k.rnd(17) * 0.12;
      homeTaper(k, bu, 0.45, 0.09, 0.14, h, h + 0.06, homeCap(shade(t.light, 1.05)), 8, 1);
      k.disc(bu, 0.45, 0.115, h + 0.061, shade(t.ink, 0.7), 1);
      const fruit = [shade(t.accent, 1.1), homeMix(FOLIAGE, t.accent, 0.4), homeCap(shade(t.accent, 1.3))];
      [[-0.04, -0.03], [0.04, -0.01], [-0.01, 0.04]].forEach(([du, dv], i) => k.disc(bu + du!, 0.45 + dv!, 0.058, h + 0.11 + i * 0.015, fruit[i]!, 1, true));
    } else if (onTop < 0.68) {
      // Bottles against the wall.
      const n = 2 + Math.floor(k.rnd(12) * 2);
      for (let i = 0; i < n; i += 1) {
        const u = 0.28 + i * 0.075;
        const tall = h + 0.12 + k.rnd(13 + i) * 0.06;
        // A stout body and a short neck, so they read as bottles and not as pipes out of the top.
        const glass = i === 1 ? shade(t.accent, 0.8) : i === 2 ? shade(GLASS, 0.62) : shade(t.ink, 1.05);
        k.line([[u, 0.28, h], [u, 0.28, tall - 0.02]], glass, 4.5, 1);
        k.line([[u, 0.28, tall - 0.02], [u, 0.28, tall + 0.04]], glass, 2, 1);
        k.disc(u, 0.28, 0.012, tall + 0.04, homeCap(shade(t.light, 0.95)), 1);
      }
    }
    return null;
  },
  sink: (k, h) => {
    const t = k.t;
    const body = shade(t.base, 0.92);
    const top = homeCap(shade(t.light, 1.04));
    const steel = homeCap(shade(t.light, 1.24));
    const zc = h * 0.86;
    const zw = h * 0.93;
    if (!k.plan) {
      k.box(0.14, 0.27, 0.86, 0.81, 0, h * 0.1, shade(t.ink, 0.85), { crown: false });
      k.box(0.12, 0.26, 0.88, 0.83, h * 0.1, zc, body);
      // Two doors under the bowl, a towel over one handle sometimes.
      const front = shade(body, 0.8);
      const handle = homeCap(shade(t.light, 1.0));
      k.facePanel('u', 0.831, 0.135, h * 0.14, 0.494, h * 0.8, front, 1, true);
      k.facePanel('u', 0.831, 0.506, h * 0.14, 0.865, h * 0.8, front, 1, true);
      k.facePanel('u', 0.832, 0.45, h * 0.56, 0.474, h * 0.74, handle);
      k.facePanel('u', 0.832, 0.526, h * 0.56, 0.55, h * 0.74, handle);
      if (k.rnd(4) < 0.4) {
        k.facePanel('u', 0.834, 0.6, h * 0.34, 0.74, h * 0.78, shade(t.accent, 0.9), 1, true);
        k.facePanel('u', 0.835, 0.6, h * 0.42, 0.74, h * 0.47, homeCap(shade(t.light, 0.95)), 0.8);
      }
    }
    k.box(0.1, 0.24, 0.9, 0.86, zc, zw, top);
    const sb = shade(t.accent, 0.96);
    const zs = h * 1.24;
    k.box(0.12, 0.24, 0.88, 0.28, zw, zs, sb);
    homeJointsU(k, 0.281, [0.27, 0.42, 0.58, 0.73], zw, zs, homeCap(shade(sb, 1.0)), 0.45);
    // A bottle of soap in the corner.
    if (k.rnd(5) < 0.5) k.box(0.8, 0.29, 0.85, 0.325, zw, zw + h * 0.22, shade(t.accent, 1.1), { crown: false });
    // The steel inset: one bowl and a ribbed drainer, or two bowls.
    const dbl = k.rnd(1) < 0.45;
    const zi = zw + 0.002;
    homeFlat(k, 0.14, 0.33, 0.86, 0.82, zi, shade(steel, 0.875), 1, true);
    const bowls: Array<[number, number]> = dbl ? [[0.17, 0.485], [0.515, 0.83]] : [[0.17, 0.56]];
    const bv0 = 0.37;
    const bv1 = 0.78;
    const d = 0.035;
    for (const [u0, u1] of bowls) {
      homeFlat(k, u0, bv0, u1, bv1, zi, shade(t.ink, 0.85));
      k.poly([[u0, bv0, zi], [u1, bv0, zi], [u1 - d, bv0 + d, zi], [u0 + d, bv0 + d, zi], [u0 + d, bv1 - d, zi], [u0, bv1, zi]], shade(steel, 0.62));
      k.disc((u0 + u1) / 2 + 0.02, bv1 - 0.1, 0.024, zi, shade(steel, 0.75), 1);
    }
    const extra = k.rnd(3);
    if (!dbl) {
      const ribs: Array<[number, number, number]> = [];
      for (let i = 0; i < 5; i += 1) {
        const u = 0.625 + i * 0.048;
        ribs.push([u, i % 2 === 0 ? 0.4 : 0.76, zi], [u, i % 2 === 0 ? 0.76 : 0.4, zi]);
      }
      k.line(ribs, shade(steel, 0.62), 1, 0.7);
      if (extra < 0.5) {
        k.disc(0.73, 0.6, 0.095, zi + 0.01, homeCap(shade(t.light, 1.2)), 1, true);
        k.disc(0.73, 0.6, 0.06, zi + 0.011, shade(t.light, 0.95), 1);
      }
    } else if (extra < 0.5) {
      k.disc(0.66, 0.6, 0.11, zi + 0.01, homeCap(shade(t.light, 1.2)), 1, true);
      k.band(0.66, 0.6, 0.11, zi + 0.02, shade(t.light, 0.8), 0.8, 1);
      k.disc(0.66, 0.6, 0.11, zi + 0.03, homeCap(shade(t.light, 1.2)), 1, true);
    }
    if (extra >= 0.75) homeFlat(k, bowls[0]![0] + d, bv0 + d, bowls[0]![1], bv1, zi + 0.001, GLASS, 0.22);
    // The tap: a gooseneck spout and a valve each side.
    const tu = dbl ? 0.5 : 0.365;
    k.disc(tu, 0.3, 0.03, zw, shade(steel, 0.7), 1, true);
    k.disc(tu - 0.075, 0.3, 0.022, zw + h * 0.08, steel, 1, true);
    k.disc(tu + 0.075, 0.3, 0.022, zw + h * 0.08, steel, 1, true);
    k.line([[tu, 0.3, zw], [tu, 0.3, zw + h * 0.3], [tu, 0.325, zw + h * 0.38], [tu, 0.37, zw + h * 0.4], [tu, 0.4, zw + h * 0.33]], shade(steel, 0.92), 2, 0.95);
    return null;
  },
  bookshelf: (k, h) => {
    const t = k.t;
    const wood = shade(t.base, 0.86);
    const F = 0.9;
    if (!k.plan) {
      k.box(0.06, 0.61, 0.94, 0.89, 0, h * 0.05, shade(t.ink, 0.8), { crown: false });
      k.box(0.05, 0.6, 0.95, F, h * 0.05, h * 0.96, wood);
      const z0 = h * 0.08;
      const z1 = h * 0.93;
      const rows = 4;
      const rowH = (z1 - z0) / rows;
      k.facePanel('u', F + 0.001, 0.085, z0, 0.915, z1, shade(t.ink, 0.62));
      k.facePanel('u', F + 0.002, 0.488, z0, 0.512, z1, shade(wood, 0.82));
      const edge = shade(wood, 0.92);
      for (let r = 0; r < rows; r += 1) {
        const zb = z0 + r * rowH;
        if (r > 0) k.facePanel('u', F + 0.004, 0.085, zb - 0.014, 0.915, zb + 0.006, edge);
        homeBooks(k, F + 0.003, 0.092, 0.484, zb + 0.006, zb + rowH - 0.016, 40 + r * 10);
        homeBooks(k, F + 0.003, 0.516, 0.908, zb + 0.006, zb + rowH - 0.016, 45 + r * 10);
      }
    }
    // Crown moulding, and what lives on top of a bookcase.
    k.box(0.04, 0.59, 0.96, 0.91, h * 0.96, h, shade(wood, 1.1));
    const onTop = k.rnd(1);
    const at = 0.1 + k.rnd(2) * 0.5;
    if (onTop < 0.22) {
      // A storage box under its lid.
      k.box(at + 0.01, 0.65, at + 0.27, 0.85, h, h + 0.13, shade(t.accent, 0.88));
      k.box(at, 0.64, at + 0.28, 0.86, h + 0.13, h + 0.16, shade(t.accent, 1.0), { ink: false });
    } else if (onTop < 0.42) {
      // Books lying in a stack, no two square.
      const tones = [shade(t.dark, 0.95), shade(t.light, 0.85), shade(t.accent, 0.85)];
      for (let i = 0; i < 3; i += 1) {
        const j = (k.rnd(20 + i) - 0.5) * 0.04;
        k.box(at + j + i * 0.01, 0.66 + i * 0.012, at + j + 0.26 - i * 0.02, 0.84 - i * 0.012, h + i * 0.04, h + (i + 1) * 0.04, tones[i]!, { crown: i === 2 });
      }
    } else if (onTop < 0.62) {
      // A pot with a trailing plant: a lumpy crown of leaves, a clump over the front lip, strands of leaves down the books.
      const pu = at + 0.1;
      const leaf = homeMix(FOLIAGE, t.base, 0.3);
      const lit = homeCap(shade(leaf, 1.22));
      const deep = shade(leaf, 0.78);
      k.box(pu - 0.06, 0.68, pu + 0.06, 0.8, h, h + 0.1, shade(t.dark, 1.1), { crown: false });
      const lump = (cu: number, cv: number, r: number, z: number, salt: number): Array<[number, number, number]> =>
        Array.from({ length: 9 }, (_, i): [number, number, number] => {
          const a = (i / 9) * Math.PI * 2;
          const rr = r * (i % 2 === 0 ? 1 : 0.72 + k.rnd(salt + i) * 0.2);
          return [cu + Math.cos(a) * rr, cv + Math.sin(a) * rr, z];
        });
      k.poly(lump(pu + 0.01, 0.755, 0.1, h + 0.12, 900), deep, 1, true);
      k.poly(lump(pu - 0.012, 0.735, 0.062, h + 0.14, 910), lit, 1);
      if (!k.plan) {
        // Vines of different lengths hang from the crown over the front edge, leaves alternating down each.
        const F2 = 0.915;
        const vines: Array<Array<[number, number]>> = [
          [[pu - 0.05, h * 0.99], [pu - 0.07, h * 0.9], [pu - 0.055, h * 0.8]],
          [[pu + 0.02, h * 1.0], [pu + 0.045, h * 0.86], [pu + 0.02, h * 0.72], [pu + 0.04, h * 0.56]],
          [[pu + 0.1, h * 0.99], [pu + 0.125, h * 0.88], [pu + 0.11, h * 0.74]],
        ];
        homeStrands(k, vines.map((vine) => vine.map(([u, z]): [number, number, number] => [u, F2, z])), shade(leaf, 0.6), 1.5, 0.95);
        vines.flat().forEach(([u, z], i) => {
          const sd = i % 2 === 0 ? 1 : -1;
          k.poly([[u, F2 + 0.001, z + h * 0.012], [u + 0.048 * sd, F2 + 0.001, z + h * 0.04], [u + 0.064 * sd, F2 + 0.001, z - h * 0.02], [u + 0.014 * sd, F2 + 0.001, z - h * 0.034]], i % 3 === 1 ? deep : lit, 1);
        });
      }
    } else if (onTop < 0.8) {
      // A tray with a box on it.
      k.box(at + 0.02, 0.65, at + 0.3, 0.85, h, h + 0.04, homeCap(shade(t.light, 1.05)));
      k.box(at + 0.05, 0.67, at + 0.27, 0.83, h + 0.04, h + 0.075, shade(t.accent, 0.85));
    }
    if (k.plan) k.line([[0.07, 0.87, 0], [0.5, 0.87, 0], [0.5, 0.62, 0], [0.5, 0.87, 0], [0.93, 0.87, 0]], t.ink, 1, 0.55);
    return null;
  },
  tv: (k, h, glow) => {
    const t = k.t;
    const cab = shade(t.base, 0.9);
    const zc = h * 0.36;
    if (!k.plan) for (const [u, v] of [[0.19, 0.44], [0.81, 0.44], [0.19, 0.67], [0.81, 0.67]] as const) k.line([[u, v, 0], [u, v, h * 0.06]], t.ink, 2, 0.9);
    k.box(0.15, 0.4, 0.85, 0.7, h * 0.06, zc, cab);
    if (!k.plan) {
      k.facePanel('u', 0.701, 0.42, h * 0.09, 0.58, zc - h * 0.04, shade(t.ink, 0.65), 1);
      k.facePanel('u', 0.702, 0.44, h * 0.11, 0.56, h * 0.17, shade(t.ink, 1.2), 1);
      k.facePanel('u', 0.703, 0.525, h * 0.135, 0.54, h * 0.15, glow ?? t.light, glow ? 1 : 0.6);
      for (const u of [0.415, 0.585]) k.line([[u, 0.702, h * 0.08], [u, 0.702, zc - h * 0.02]], t.ink, 1, 0.55);
      k.line([[0.37, 0.702, h * 0.24], [0.37, 0.702, h * 0.3]], t.light, 1, 0.9);
      k.line([[0.63, 0.702, h * 0.24], [0.63, 0.702, h * 0.3]], t.light, 1, 0.9);
      // Door panels either side, a vent grille on the east end.
      k.facePanel('u', 0.702, 0.18, h * 0.1, 0.39, zc - h * 0.045, t.light, 0.08, true);
      k.facePanel('u', 0.702, 0.61, h * 0.1, 0.82, zc - h * 0.045, t.light, 0.08, true);
      officeDashes(k, [0, 1, 2].map((i): [number, number, number][] => [[0.851, 0.47 + i * 0.03, h * 0.13], [0.851, 0.47 + i * 0.03, h * 0.28]]), t.ink, 0.55);
    }
    // Clutter on the console: a remote, sometimes a stack of chips or a little plant.
    const ra = (k.rnd(50) - 0.5) * 1.2;
    const ru = 0.24 + k.rnd(51) * 0.1;
    const rv = 0.62;
    const rc = Math.cos(ra);
    const rs = Math.sin(ra);
    k.poly(([[-0.05, -0.016], [0.05, -0.016], [0.05, 0.016], [-0.05, 0.016]] as const).map(([du, dv]): [number, number, number] => [ru + du * rc - dv * rs, rv + du * rs + dv * rc, zc + 0.003]), t.ink, 0.95);
    const extra = k.rnd(52);
    if (extra < 0.35) {
      officeSlab(k, 0.76, 0.6, 0.05, 0.05, 0.3, zc, zc + h * 0.1, 0x5f7560);
      k.cyl(0.76, 0.6, 0.06, zc + h * 0.1, zc + h * 0.26, FOLIAGE, { sides: 6, jitter: 0.35, salt: 3, ink: false });
    } else if (extra < 0.65) {
      k.box(0.7, 0.56, 0.8, 0.66, zc, zc + h * 0.06, officeCap(shade(t.light, 1.05)));
    }
    // The stand and the screen.
    k.box(0.4, 0.5, 0.6, 0.58, zc, zc + h * 0.03, shade(t.ink, 1.1), { crown: false });
    if (!k.plan) {
      k.line([[0.5, 0.54, zc + h * 0.03], [0.5, 0.54, h * 0.52]], shade(t.ink, 1.1), 3, 1);
      k.line([[0.56, 0.515, h * 0.5], [0.585, 0.51, h * 0.43], [0.62, 0.5, zc + 0.002]], shade(t.ink, 0.85), 1, 0.9);
    }
    const z0 = h * 0.48;
    const z1 = h * 1.1;
    k.box(0.14, 0.52, 0.86, 0.56, z0, z1, shade(t.ink, 1.15), { crown: false });
    if (!k.plan) k.line([[0.14, 0.56, z1], [0.86, 0.56, z1], [0.86, 0.52, z1]], shade(t.ink, 1.9), 1, 0.55);
    const scr: [number, number, number][] = [[0.165, 0.561, z0 + h * 0.035], [0.835, 0.561, z0 + h * 0.035], [0.835, 0.561, z1 - h * 0.03], [0.165, 0.561, z1 - h * 0.03]];
    if (!k.plan) {
      k.poly(scr, glow ?? shade(t.ink, 0.5), glow ? 0.92 : 1);
      const s0 = z0 + h * 0.035;
      const s1 = z1 - h * 0.03;
      if (glow !== null) {
        const pic = k.rnd(53);
        const dim = shade(glow, 0.55);
        if (pic < 0.25) {
          // A menu: a row of tiles and a highlighted one.
          const pick = Math.floor(k.rnd(55) * 4);
          for (let i = 0; i < 4; i += 1) k.facePanel('u', 0.562, 0.2 + i * 0.16, s0 + (s1 - s0) * 0.3, 0.32 + i * 0.16, s0 + (s1 - s0) * 0.62, i === pick ? shade(glow, 1.2) : dim, i === pick ? 0.7 : 0.5);
          k.facePanel('u', 0.562, 0.2, s0 + (s1 - s0) * 0.74, 0.5, s0 + (s1 - s0) * 0.84, dim, 0.5);
        } else if (pic < 0.6) {
          // News: a figure at the desk and a ticker along the bottom.
          const fu = 0.3 + k.rnd(54) * 0.35;
          k.poly([[fu - 0.08, 0.562, s0 + (s1 - s0) * 0.18], [fu + 0.08, 0.562, s0 + (s1 - s0) * 0.18], [fu + 0.06, 0.562, s0 + (s1 - s0) * 0.5], [fu + 0.025, 0.562, s0 + (s1 - s0) * 0.58], [fu + 0.025, 0.562, s0 + (s1 - s0) * 0.78], [fu - 0.025, 0.562, s0 + (s1 - s0) * 0.78], [fu - 0.025, 0.562, s0 + (s1 - s0) * 0.58], [fu - 0.06, 0.562, s0 + (s1 - s0) * 0.5]], dim, 0.55);
          k.facePanel('u', 0.562, 0.165, s0, 0.835, s0 + (s1 - s0) * 0.16, dim, 0.5);
        } else {
          // A skyline under a lighter sky.
          const pts: [number, number, number][] = [[0.165, 0.562, s0]];
          let u = 0.165;
          let i = 0;
          while (u < 0.835) {
            const hgt = s0 + (s1 - s0) * (0.25 + k.rnd(60 + i) * 0.4);
            const nu = Math.min(0.835, u + 0.05 + k.rnd(70 + i) * 0.07);
            pts.push([u, 0.562, hgt], [nu, 0.562, hgt]);
            u = nu;
            i += 1;
          }
          pts.push([0.835, 0.562, s0]);
          k.poly(pts, dim, 0.55);
        }
      } else {
        k.poly([[0.3, 0.562, s0], [0.42, 0.562, s0], [0.6, 0.562, s1], [0.48, 0.562, s1]], GLASS, 0.14);
      }
    }
    // A soundbar under the screen.
    k.box(0.3, 0.62, 0.7, 0.66, zc, zc + h * 0.05, shade(t.ink, 1.05), { crown: false });
    if (!k.plan) k.line([[0.32, 0.661, zc + h * 0.025], [0.68, 0.661, zc + h * 0.025]], t.dark, 1, 0.6);
    if (glow === null) return null;
    return k.plan ? k.pts(officeRect(0.14, 0.52, 0.86, 0.58, z1)) : k.pts(scr);
  },

  // --- eating and drinking -------------------------------------------------
  umbrella: (k, h) => {
    type P = readonly [number, number, number];
    const t = k.t;
    const metal = civicMix(t.ink, 0x6f6d69, 0.5);
    const canvas = shade(t.accent, 1.02);
    // Neighbouring umbrellas differ at a glance: plain, striped in a muted cream (V <= 75, about 11 points
    // over the canvas), or striped a shade down; and some have their canopy cranked over.
    const scheme = k.rnd(2);
    const alt = scheme < 0.35 ? canvas : scheme < 0.75 ? civicMix(t.light, 0xbfb5a0, 0.55) : shade(t.base, 0.8);
    const n = 8;
    const rot = k.rnd(1) < 0.5 ? 0 : Math.PI / n;
    const R = 0.4;
    const zr = h * 1.42;
    const za = h * 1.64;
    const tilted = k.rnd(5) < 0.3;
    const tDir = k.rnd(6) * Math.PI * 2;
    const tAmt = tilted ? h * 0.3 : 0;
    const au = 0.5 + (k.rnd(3) - 0.5) * 0.02 - Math.cos(tDir) * tAmt * 0.1;
    const av = 0.5 + (k.rnd(4) - 0.5) * 0.02 - Math.sin(tDir) * tAmt * 0.1;
    if (!k.plan) {
      // A weighted round base with a sleeve, the pole, the tilt crank.
      civicDrum(k, 0.5, 0.5, 0.135, 0, h * 0.045, shade(metal, 0.85));
      civicSegs(k, [0, 1, 2].map((i): P[] => { const a = -0.3 + i * 1.1; return [[0.5 + Math.cos(a) * 0.085, 0.5 + Math.sin(a) * 0.085, h * 0.046], [0.5 + Math.cos(a) * 0.112, 0.5 + Math.sin(a) * 0.112, h * 0.046]]; }), shade(metal, 1.15), 2, 0.5);
      civicDrum(k, 0.5, 0.5, 0.04, h * 0.045, h * 0.17, metal);
      k.line([[0.5, 0.5, h * 0.17], [au, av, zr]], shade(metal, 0.85), 3, 1);
      k.line([[0.49, 0.51, h * 0.19], [au - 0.01, av + 0.01, zr - h * 0.06]], shade(metal, 1.5), 1, 0.45);
      k.line([[0.5, 0.5, h * 0.92], [0.5, 0.5, h * 1.02]], shade(metal, 0.7), 5, 1);
      k.line([[0.5, 0.5, h * 0.97], [0.58, 0.5, h * 0.95], [0.58, 0.5, h * 0.88]], shade(metal, 0.75), 1, 0.9);
    }
    const rim: P[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = rot + (i / n) * Math.PI * 2;
      rim.push([0.5 + Math.cos(a) * R, 0.5 + Math.sin(a) * R, zr + Math.cos(a - tDir) * R * tAmt]);
    }
    const apex: P = [au, av, za];
    const tris = rim.map((p, i): P[] => [apex, p, rim[(i + 1) % n]!]);
    if (tris.some((tr) => civicArea(k, tr) <= 0.3)) k.poly(rim, shade(canvas, 0.4));
    tris.forEach((tr, i) => civicFacet(k, tr, i % 2 === 0 ? canvas : alt));
    civicSegs(k, rim.map((p) => [apex, p]), shade(canvas, 0.6), 1, 0.35);
    // The valance: scalloped, only the panels turned toward the viewer.
    const drop = h * 0.07;
    const hem: P[] = [];
    const lit: Array<[P, P]> = [];
    for (let i = 0; i < n; i += 1) {
      const p = rim[i]!;
      const q = rim[(i + 1) % n]!;
      const m: P = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2 - drop * 1.8];
      const panel: P[] = [[p[0], p[1], p[2] - drop], m, [q[0], q[1], q[2] - drop], q, p];
      if (civicFacet(k, panel, i % 2 === 0 ? canvas : alt)) lit.push([p, q]);
      hem.push(m);
    }
    if (!k.plan) {
      civicSegs(k, lit, shade(canvas, 1.35), 1, 0.4);
      // The scalloped hem stitched darker, and the rib ends capped where they meet the rim.
      civicSegs(k, lit.map(([p, q]): P[] => [[p[0], p[1], p[2] - drop], [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2 - drop * 1.8], [q[0], q[1], q[2] - drop]]), shade(canvas, 0.62), 1, 0.7);
      civicSegs(k, rim.filter((p) => p[0] + p[1] > 0.9).map((p): P[] => [[p[0], p[1], p[2] + h * 0.01], [p[0], p[1], p[2] - drop * 0.45]]), shade(metal, 1.05), 2, 0.85);
    }
    // The wind vent: a second small cone over a dark gap.
    const vr = 0.13;
    const zv0 = za - h * 0.02;
    const zv1 = za + h * 0.08;
    const vent: P[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = rot + ((i + 0.5) / n) * Math.PI * 2;
      vent.push([au + Math.cos(a) * vr, av + Math.sin(a) * vr, zv0]);
    }
    if (!k.plan) civicSegs(k, [[...vent.filter((p) => p[0] + p[1] >= au + av - vr * 0.8)].sort((a, b) => (a[0] - a[1]) - (b[0] - b[1]))], shade(canvas, 0.35), 2, 0.9);
    const vtop: P = [au, av, zv1];
    vent.forEach((p, i) => civicFacet(k, [vtop, p, vent[(i + 1) % n]!], i % 2 === 0 ? alt : canvas));
    if (!k.plan) k.line([[au, av, zv1], [au, av, zv1 + h * 0.05]], shade(metal, 1.1), 3, 1);
    k.disc(au, av, 0.02, zv1 + h * 0.06, shade(metal, 1.5), 1);
    civicOutline(k, k.plan ? rim : [...rim, ...hem, vtop], 0.5);
    return null;
  },
  grill: (k, h) => {
    const t = k.t;
    const enamel = shade(t.base, 0.85);
    const zr = h * 0.72;
    const zb = h * 0.5;
    const legTop = h * 0.52;
    const lidOpen = k.rnd(1) < 0.55;
    const foot = (a: number): [number, number, number] => [0.5 + Math.cos(a) * 0.22, 0.5 + Math.sin(a) * 0.22, 0];
    const hip = (a: number): [number, number, number] => [0.5 + Math.cos(a) * 0.11, 0.5 + Math.sin(a) * 0.11, legTop];
    const along = (a: number, f: number): [number, number, number] => {
      const p = foot(a);
      const q = hip(a);
      return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
    };
    const legA = [(210 * Math.PI) / 180, (330 * Math.PI) / 180, Math.PI / 2];
    // Back legs, their wheels, the ash pan braced between all three.
    for (const a of [legA[0]!, legA[1]!]) k.line([foot(a), hip(a)], t.ink, 2, 0.95);
    if (!k.plan) {
      for (const a of [legA[0]!, legA[1]!]) {
        const f = foot(a);
        k.faceCircle(f[0], f[1], 0.035, 0.035, 'v', shade(t.ink, 0.7));
        k.faceCircle(f[0] + 0.002, f[1], 0.035, 0.012, 'v', shade(t.light, 0.9));
      }
      k.line([along(legA[0]!, 0.38), along(legA[1]!, 0.38), along(legA[2]!, 0.38), along(legA[0]!, 0.38)], shade(t.ink, 0.8), 1, 0.8);
      k.poly(squatRing(0.5, 0.5, 0.075, legTop * 0.38, 10, 0), shade(t.dark, 0.8), 1, true);
    }
    k.line([[0.5 - 0.235, 0.5, zr - 0.035], [0.5 - 0.29, 0.5, zr - 0.035]], shade(t.ink, 0.8), 2.5, 0.95);
    // The kettle: a rounded bowl in two bands.
    const b0 = squatRing(0.5, 0.5, 0.1, zb, 12, 0.1);
    const b1 = squatRing(0.5, 0.5, 0.2, zb + (zr - zb) * 0.55, 12, 0.1);
    const b2 = squatRing(0.5, 0.5, 0.235, zr, 12, 0.1);
    if (!k.plan) squatPrism(k, b0, b1, enamel, 1);
    squatPrism(k, b1, b2, enamel, 1);
    k.line([foot(legA[2]!), hip(legA[2]!)], t.ink, 2, 0.95);
    k.line([[0.5 + 0.235, 0.5, zr - 0.035], [0.5 + 0.29, 0.5, zr - 0.035]], shade(t.ink, 0.8), 2.5, 0.95);
    if (!k.plan && !lidOpen && k.rnd(3) < 0.8) {
      // Tongs hung off the side handle.
      k.line([[0.775, 0.49, zr - 0.03], [0.77, 0.47, zr - 0.2], [0.79, 0.49, zr - 0.2]], shade(t.light, 0.85), 1, 0.9);
      k.line([[0.785, 0.51, zr - 0.03], [0.8, 0.52, zr - 0.19]], shade(t.light, 0.7), 1, 0.9);
    }
    if (lidOpen) {
      squatHole(k, 0.5, 0.5, 0.225, zr, 0.07, shade(t.ink, 0.5), shade(enamel, 0.5));
      for (let i = 0; i < 5; i += 1) {
        const a = k.rnd(10 + i) * Math.PI * 2;
        const d = k.rnd(20 + i) * 0.12;
        k.disc(0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, 0.028 + k.rnd(30 + i) * 0.012, zr - 0.04, i % 2 === 0 ? shade(t.ink, 0.72) : shade(t.light, 0.72), 1);
      }
      const grate = shade(t.light, 1.08);
      k.line([...squatRing(0.5, 0.5, 0.2, zr - 0.012, 14, 0), [0.7, 0.5, zr - 0.012]], grate, 1, 0.7);
      for (let i = -2; i <= 2; i += 1) {
        const du = i * 0.075;
        const dv = Math.sqrt(0.2 * 0.2 - du * du);
        k.line([[0.5 + du, 0.5 - dv, zr - 0.012], [0.5 + du, 0.5 + dv, zr - 0.012]], grate, 1, 0.75);
      }
      if (k.rnd(2) < 0.5) {
        for (const [u, v] of [[0.42, 0.44], [0.53, 0.5]] as const) k.line([[u, v, zr - 0.008], [u + 0.08, v + 0.05, zr - 0.008]], 0x6b4630, 2.5, 1);
      }
      // The lid hung on the side of the bowl.
      if (k.plan) {
        k.poly([[0.735, 0.37, 0], [0.775, 0.37, 0], [0.775, 0.63, 0], [0.735, 0.63, 0]], enamel, 1, true);
      } else {
        k.faceCircle(0.755, 0.5, zr - 0.1, 0.15, 'v', shade(enamel, 0.72), 1, true);
        k.faceCircle(0.757, 0.47, zr - 0.07, 0.07, 'v', shade(enamel, 0.95), 0.5);
        k.facePanel('v', 0.758, 0.47, zr - 0.13, 0.53, zr - 0.1, shade(t.ink, 0.7));
      }
    } else {
      const d1 = squatRing(0.5, 0.5, 0.19, zr + 0.06, 12, 0.1);
      const d2 = squatRing(0.5, 0.5, 0.085, zr + 0.095, 12, 0.1);
      squatPrism(k, b2, d1, enamel, 1);
      squatPrism(k, d1, d2, shade(enamel, 1.04), 2);
      k.band(0.5, 0.5, 0.236, zr + 0.004, shade(t.ink, 0.7), 0.8, 1);
      k.disc(0.44, 0.47, 0.03, zr + 0.078, shade(t.light, 0.9), 0.85);
      k.line([[0.5, 0.5 - 0.06, zr + 0.095], [0.5, 0.5 - 0.06, zr + 0.13], [0.5, 0.5 + 0.06, zr + 0.13], [0.5, 0.5 + 0.06, zr + 0.095]], shade(t.ink, 0.8), 2, 0.95);
    }
    return null;
  },
  bar: (k, h) => {
    const t = k.t;
    const kick = h * 0.09;
    const slab = h * 0.9;
    const topZ = h * 1.0;
    const ledge = h * 1.1;
    const front = shade(t.base, 0.86);
    const metal = shade(t.light, 0.95);
    // The back ledge the bottles stand on.
    k.box(0.06, 0.3, 0.94, 0.4, 0, ledge, shade(t.base, 0.7));
    const tints = [GLASS, 0x8a6a3a, 0x4f6b47, shade(t.accent, 1.05)];
    let u = 0.1 + k.rnd(1) * 0.06;
    let i = 0;
    while (u < 0.9) {
      if (k.rnd(30 + i) > 0.18) {
        const c = tints[Math.floor(k.rnd(50 + i) * tints.length)]!;
        loungeBottle(k, u, 0.35, ledge, h * (0.14 + k.rnd(70 + i) * 0.1), c, c === GLASS ? 0.6 : 1);
      }
      u += 0.09 + k.rnd(90 + i) * 0.05;
      i += 1;
    }
    if (!k.plan) {
      k.box(0.08, 0.42, 0.92, 0.78, 0, kick, t.ink, { crown: false, ink: false });
      k.box(0.06, 0.4, 0.94, 0.8, kick, slab, front);
      for (let p = 0; p < 3; p += 1) {
        const pu = 0.1 + p * 0.28;
        k.facePanel('u', 0.801, pu, h * 0.2, pu + 0.24, h * 0.78, loungeFace(front, 'u', 0.35), 1);
        k.line([[pu, 0.801, h * 0.78], [pu + 0.24, 0.801, h * 0.78]], t.ink, 1, 0.4);
      }
      for (const pu of [0.12, 0.5, 0.88]) k.line([[pu, 0.84, 0], [pu, 0.84, h * 0.2]], t.dark, 1.5, 1);
    }
    k.line([[0.03, 0.84, h * 0.2], [0.97, 0.84, h * 0.2]], metal, 2, 0.9);
    k.box(0.02, 0.38, 0.98, 0.84, slab, topZ, t.base);
    const z = topZ + 0.002;
    if (!k.plan) {
      k.line([[0.15, 0.5, z], [0.4, 0.58, z], [0.7, 0.52, z]], t.light, 1, 0.2);
    }
    const kit = k.rnd(3);
    if (kit < 0.3) {
      // A rack of clean glasses turned down to drain.
      const ru = 0.3 + k.rnd(8) * 0.3;
      k.poly([[ru, 0.46, z], [ru + 0.26, 0.46, z], [ru + 0.26, 0.64, z], [ru, 0.64, z]], t.dark, 0.85, true);
      for (let row = 0; row < 2; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          k.disc(ru + 0.05 + col * 0.08, 0.51 + row * 0.08, 0.028, z + 0.01, GLASS, 0.45);
        }
      }
    } else if (kit < 0.5) {
      // A till.
      k.box(0.66, 0.46, 0.84, 0.6, topZ, topZ + h * 0.1, t.ink);
      k.poly([[0.68, 0.46, topZ + h * 0.1], [0.82, 0.46, topZ + h * 0.1], [0.82, 0.5, topZ + h * 0.2], [0.68, 0.5, topZ + h * 0.2]], shade(t.light, 0.8), 1, true);
    } else if (kit < 0.75) {
      // A beer tower over its drip tray, three dark handles up.
      const tu = 0.36 + k.rnd(8) * 0.28;
      const tz = topZ + h * 0.2;
      k.poly([[tu - 0.13, 0.58, z], [tu + 0.13, 0.58, z], [tu + 0.13, 0.7, z], [tu - 0.13, 0.7, z]], t.ink, 0.85, true);
      if (!k.plan) {
        k.line([[tu, 0.63, z], [tu, 0.63, tz]], metal, 3.5, 1);
        k.line([[tu - 0.1, 0.63, tz], [tu + 0.1, 0.63, tz]], metal, 3, 1);
        for (const [du, c] of [[-0.08, loungeCap(shade(t.accent, 1.2))], [0, 0x8a6a3a], [0.08, shade(t.light, 0.8)]] as const) {
          k.line([[tu + du, 0.63, tz - h * 0.01], [tu + du, 0.655, tz - h * 0.02], [tu + du, 0.665, tz - h * 0.07]], metal, 1.5, 1);
          k.line([[tu + du, 0.63, tz], [tu + du, 0.63, tz + h * 0.16]], t.ink, 2.2, 1);
          k.disc(tu + du, 0.63, 0.018, tz + h * 0.16, c, 1);
        }
      } else {
        k.line([[tu - 0.1, 0.63, 0], [tu + 0.1, 0.63, 0]], metal, 3, 1);
      }
    } else {
      // A bar mat, ribbed.
      k.poly([[0.2, 0.56, z], [0.6, 0.56, z], [0.6, 0.66, z], [0.2, 0.66, z]], t.dark, 0.75);
      if (!k.plan) for (const mv of [0.59, 0.63]) k.line([[0.22, mv, z], [0.58, mv, z]], t.ink, 1, 0.3);
    }
    const glasses = Math.floor(k.rnd(4) * 3);
    for (let g = 0; g < glasses; g += 1) loungeGlass(k, 0.22 + g * 0.2 + k.rnd(5 + g) * 0.06, 0.72, z, h * 0.12, k.rnd(60 + g) < 0.5 ? null : 0x8a6a3a);
    return null;
  },
  menu: (k, h) => {
    type P = readonly [number, number, number];
    const t = k.t;
    const wood = t.base;
    const slate = civicMix(t.ink, 0x292c2a, 0.5);
    const chalk = shade(t.light, 1.3);
    const u0 = 0.31;
    const u1 = 0.69;
    const vf = 0.69;
    const vt = 0.56;
    const vb = 0.41;
    const zt = h * 0.92;
    const F = (u: number, s: number): P => [u, vf + (vt - vf) * s, zt * s];
    const B = (u: number, s: number): P => [u, vb + (vt - 0.03 - vb) * s, zt * s];
    // The back leaf, mostly hidden: its top and its legs.
    civicFacet(k, [B(u0, 0), B(u1, 0), B(u1, 1), B(u0, 1)], shade(wood, 0.78), 1, true);
    if (!k.plan) {
      // The dark inside of the A, seen through its open east side, and the spreader chain.
      k.poly([[u1 - 0.01, vb + 0.02, 0], [u1 - 0.01, vf - 0.02, 0], [u1 - 0.01, vt - 0.015, zt * 0.97]], shade(t.ink, 0.62), 0.9);
      k.line([[u1 - 0.01, vb + 0.06, zt * 0.36], [u1 - 0.01, vf - 0.05, zt * 0.34]], shade(t.light, 1.1), 1, 0.55);
    }
    // The front leaf: a frame with legs cut out of its foot.
    const lg = 0.05;
    const sn = 0.1;
    civicFacet(k, [F(u0, 0), F(u0 + lg, 0), F(u0 + lg, sn), F(u1 - lg, sn), F(u1 - lg, 0), F(u1, 0), F(u1, 1), F(u0, 1)], wood, 1, true);
    if (!k.plan) k.poly([F(u1, 0), F(u1, 1), [u1, vt - 0.025, zt], [u1, vf - 0.03, 0]], shade(wood, 0.6));
    const pu0 = u0 + 0.035;
    const pu1 = u1 - 0.035;
    const s0 = 0.18;
    const s1 = 0.9;
    civicFacet(k, [F(pu0, s0), F(pu1, s0), F(pu1, s1), F(pu0, s1)], slate, 1, true);
    // Chalk: a drawn border, a header, the day's lines with prices.
    const hw = 0.06 + k.rnd(11) * 0.06;
    civicSegs(k, [[F(0.5 - hw, 0.8), F(0.5 + hw, 0.8)]], shade(t.accent, 1.55), 2, 0.6);
    if (!k.plan) {
      const b = 0.016;
      civicSegs(k, [[F(pu0 + b, s0 + 0.035), F(pu1 - b, s0 + 0.035), F(pu1 - b, s1 - 0.035), F(pu0 + b, s1 - 0.035), F(pu0 + b, s0 + 0.035)]], chalk, 1, 0.28);
      const rows = 3 + Math.floor(k.rnd(12) * 3);
      const special = Math.floor(k.rnd(15) * rows);
      const lines: P[][] = [];
      const picked: P[][] = [];
      for (let r = 0; r < rows; r += 1) {
        const s = 0.68 - r * (0.42 / rows);
        const len = 0.08 + k.rnd(20 + r) * 0.12;
        (r === special ? picked : lines).push([F(pu0 + 0.03, s), F(pu0 + 0.03 + len, s)]);
        lines.push([F(pu1 - 0.07, s), F(pu1 - 0.035, s)]);
      }
      civicSegs(k, lines, chalk, 1, 0.5);
      // Today's special in coloured chalk, underlined.
      const sp = 0.68 - special * (0.42 / rows);
      picked.push([F(pu0 + 0.03, sp - 0.035), F(pu0 + 0.17, sp - 0.04)]);
      civicSegs(k, picked, shade(t.accent, 1.6), 1, 0.75);
      // The frame's lit bevel down the hinge-side stile.
      k.line([F(u0 + 0.008, 0.06), F(u0 + 0.008, 0.985), F(u1 - 0.02, 0.985)], shade(wood, 1.3), 1, 0.4);
      if (k.rnd(13) < 0.5) {
        // A chalk cup with steam, bottom right.
        const cu = pu1 - 0.07;
        civicSegs(k, [[F(cu - 0.025, 0.3), F(cu - 0.02, 0.24), F(cu + 0.02, 0.24), F(cu + 0.025, 0.3)], [F(cu, 0.33), F(cu + 0.01, 0.37)]], shade(t.accent, 1.55), 1, 0.55);
      }
      // The ledge with a stick of chalk, the lit top edge, two hinges.
      k.line([F(pu0, s0 - 0.03), F(pu1, s0 - 0.03)], shade(wood, 1.3), 2, 0.85);
      k.line([F(0.4 + k.rnd(14) * 0.15, s0 - 0.01), F(0.44 + k.rnd(14) * 0.15, s0 - 0.01)], chalk, 2, 0.7);
      k.line([F(u0, 1), F(u1, 1)], shade(wood, 1.45), 1, 0.55);
      civicSegs(k, [[F(u0 + 0.04, 1), F(u0 + 0.09, 1)], [F(u1 - 0.09, 1), F(u1 - 0.04, 1)]], shade(t.light, 0.9), 2, 0.9);
    }
    // In plan, the hinge where the two leaves meet is the symbol's spine.
    if (k.plan) civicSegs(k, [[[u0 + 0.01, vt - 0.015, zt], [u1 - 0.01, vt - 0.015, zt]]], shade(wood, 1.4), 2, 0.9);
    civicOutline(k, [F(u0, 0), F(u1, 0), F(u1, 1), F(u0, 1), B(u0, 0), B(u1, 0), B(u0, 1)], 0.5);
    return null;
  },
  chandelier: (k, h, glow) => {
    type P = readonly [number, number, number];
    const t = k.t;
    const brass = civicMix(t.accent, 0x9c8656, 0.45);
    const n = k.rnd(1) < 0.5 ? 6 : 8;
    const rot = k.rnd(2) * ((Math.PI * 2) / n);
    const zc = h * 1.4;
    const bulb = glow ?? shade(t.light, 1.12);
    const crystal = glow === null ? shade(t.light, 1.2) : civicMix(glow, t.light, 0.5);
    const tiered = k.rnd(3) > 0.55;
    if (!k.plan) k.line([[0.5, 0.5, h * 1.98], [0.5, 0.5, zc + h * 0.22]], shade(t.ink, 0.9), 1, 0.85);
    if (glow !== null) k.disc(0.5, 0.5, 0.3, zc + h * 0.1, glow, 0.1);
    const ring = (R: number, z: number, count: number, turn: number) =>
      Array.from({ length: count }, (_, i) => {
        const a = turn + (i / count) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        return {
          hub: [0.5 + c * 0.05, 0.5 + s * 0.05, z + h * 0.02] as P,
          mid: [0.5 + c * R * 0.55, 0.5 + s * R * 0.55, z - h * 0.07] as P,
          tip: [0.5 + c * R, 0.5 + s * R, z + h * 0.03] as P,
          depth: c + s,
        };
      });
    type Arm = ReturnType<typeof ring>[number];
    const main = ring(0.27, zc, n, rot);
    const upper = tiered ? ring(0.15, zc + h * 0.14, n / 2, rot + Math.PI / n) : [];
    const arms = (list: Arm[], tone: number, drops: boolean) => {
      if (list.length === 0) return;
      if (drops && !k.plan) for (const a of list) k.disc(a.tip[0], a.tip[1], 0.012, a.tip[2] - h * 0.07, crystal, 0.8);
      // A dark under-stroke gives the thin brass arms a silhouette over a pale floor.
      if (!k.plan) civicSegs(k, list.map((a) => [a.hub, a.mid, a.tip]), shade(t.ink, 0.8), 4.5, 0.62);
      civicSegs(k, list.map((a) => [a.hub, a.mid, a.tip]), shade(brass, tone), 2, 1);
      if (!k.plan) {
        for (const a of list) k.disc(a.tip[0], a.tip[1], 0.034, a.tip[2], shade(brass, tone * 1.2), 1);
        civicSegs(k, list.map((a) => [a.tip, [a.tip[0], a.tip[1], a.tip[2] + h * 0.1]]), shade(t.light, 1.05), 2, 0.95);
      }
      // Lit, the flames are the brightest thing in the room and carry the fixture (the old ring of lights was
      // this big); unlit they are just candle ends.
      for (const a of list) k.disc(a.tip[0], a.tip[1], glow !== null ? 0.042 : k.plan ? 0.034 : 0.026, a.tip[2] + h * 0.13, bulb, 0.95);
    };
    // The crystal swag hangs between the arm tips; back half first.
    const swag = (front: boolean): P[] => {
      const pts: P[] = [];
      const start = front ? -Math.PI / 4 : (Math.PI * 3) / 4;
      for (let i = 0; i <= n * 2; i += 1) {
        const a = start + (i / (n * 2)) * Math.PI;
        const dip = Math.sin(((a - rot) * n) / 2);
        pts.push([0.5 + Math.cos(a) * 0.255, 0.5 + Math.sin(a) * 0.255, zc - h * 0.085 * dip * dip]);
      }
      return pts;
    };
    civicSegs(k, [swag(false)], crystal, 1, 0.5);
    arms(main.filter((a) => a.depth < 0), 0.8, true);
    arms(upper.filter((a) => a.depth < 0), 0.85, false);
    if (!k.plan) {
      k.line([[0.5, 0.5, zc - h * 0.02], [0.5, 0.5, zc - h * 0.16]], shade(brass, 0.8), 2, 1);
      k.disc(0.5, 0.5, 0.02, zc - h * 0.18, crystal, 0.9);
    }
    k.disc(0.5, 0.5, 0.06, zc + h * 0.03, shade(brass, 1.15), 1, true);
    if (!k.plan) {
      k.line([[0.5, 0.5, zc + h * 0.24], [0.5, 0.5, zc + h * 0.06]], shade(brass, 0.85), 3, 1);
      k.line([[0.5, 0.5, zc + h * 0.13], [0.5, 0.5, zc + h * 0.04]], shade(brass, 0.95), 6, 1);
      k.line([[0.492, 0.508, zc + h * 0.12], [0.492, 0.508, zc + h * 0.05]], shade(brass, 1.45), 1, 0.6);
    }
    arms(upper.filter((a) => a.depth >= 0), 1.05, false);
    arms(main.filter((a) => a.depth >= 0), 1.05, true);
    civicSegs(k, [swag(true)], crystal, 1, 0.6);
    return glow ? k.pool(0.5, 0.5, 0.45) : null;
  },

  // --- outside -------------------------------------------------------------
  statue: (k, h) => {
    const t = k.t;
    const stone = shade(t.base, 1.08);
    const stain = 0x5a7a70;
    const lit = shade(t.base, 0.62);
    const dim = shade(t.base, 0.46);
    // A stepped plinth: base, a second step, die with its plaque, cornice.
    k.box(0.25, 0.25, 0.75, 0.75, 0, h * 0.07, shade(stone, 0.85));
    k.box(0.27, 0.27, 0.73, 0.73, h * 0.07, h * 0.11, shade(stone, 0.95));
    if (!k.plan) {
      k.box(0.29, 0.29, 0.71, 0.71, h * 0.11, h * 0.4, stone, { crown: false });
      k.facePanel('u', 0.711, 0.38, h * 0.15, 0.62, h * 0.31, shade(t.base, 0.62), 1, true);
      k.facePanel('u', 0.712, 0.41, h * 0.25, 0.59, h * 0.265, shade(t.base, 0.95), 0.7);
      k.facePanel('u', 0.712, 0.43, h * 0.2, 0.57, h * 0.215, shade(t.base, 0.95), 0.6);
      // Verdigris run off the bronze has streaked the stone under the cornice.
      for (const [u0, len] of [[0.33, 0.14], [0.66, 0.2]] as const) {
        k.poly([[u0 - 0.016, 0.711, h * 0.4], [u0 + 0.02, 0.711, h * 0.4], [u0 + 0.004, 0.711, h * (0.4 - len)]], stain, 0.4);
      }
      k.poly([[0.711, 0.4, h * 0.4], [0.711, 0.44, h * 0.4], [0.711, 0.425, h * 0.23]], stain, 0.35);
      // The cornice throws a shadow line on the die.
      k.line([[0.29, 0.711, h * 0.375], [0.711, 0.711, h * 0.375], [0.711, 0.29, h * 0.375]], shade(stone, 0.66), 1, 0.6);
    }
    k.box(0.27, 0.27, 0.73, 0.73, h * 0.4, h * 0.46, shade(stone, 1.06));
    // The figure, in dark bronze on its own base plate; the pose varies.
    const z0 = h * 0.48;
    if (!k.plan) k.box(0.39, 0.39, 0.61, 0.61, h * 0.46, z0, dim, { crown: false });
    const F = (z: number) => z0 + z * h;
    const m = k.rnd(1) < 0.5 ? 1 : -1;
    const pose = Math.floor(k.rnd(2) * 3);
    const hat = k.rnd(3) < 0.4;
    if (k.plan) {
      const sh: Array<[number, number, number]> = [];
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2;
        const x = Math.cos(a) * 0.15;
        const y = Math.sin(a) * 0.07;
        sh.push([0.5 + (x + y) * 0.707, 0.5 + (-x + y) * 0.707, F(0.8)]);
      }
      k.poly(sh, lit, 1, true);
      k.disc(0.5, 0.5, hat ? 0.07 : 0.05, F(0.9), hat ? dim : shade(t.base, 0.75), 1, true);
      if (pose === 0) k.line([[0.5 + 0.06 * m, 0.5 - 0.06 * m, F(0.8)], [0.5 + 0.15 * m, 0.5 - 0.13 * m, F(1)]], lit, 3, 1);
      if (pose === 1) k.disc(0.5 + 0.11 * m, 0.5 - 0.11 * m, 0.025, F(1.1), dim, 1);
      return null;
    }
    const cu = 0.5;
    const cv = 0.5;
    if (pose === 2) {
      // A cloak hanging behind.
      greenBill(k, cu, cv, [[-0.17 * m, F(0.02)], [0.17 * m, F(0.02)], [0.15 * m, F(0.78)], [-0.15 * m, F(0.78)]], shade(dim, 0.9), 1, true);
    }
    const body: Array<[number, number]> = [[-0.13, F(0)], [0.13, F(0)], [0.1, F(0.42)], [0.15, F(0.74)], [0.12, F(0.8)], [-0.12, F(0.8)], [-0.15, F(0.74)], [-0.1, F(0.42)]];
    greenBill(k, cu, cv, body.map(([a, z]) => [a * m, z] as const), dim, 1, true);
    greenBill(k, cu, cv, [[-0.13 * m, F(0)], [0, F(0)], [0, F(0.8)], [-0.12 * m, F(0.8)], [-0.15 * m, F(0.74)], [-0.1 * m, F(0.42)]], lit);
    greenBill(k, cu, cv, [[-0.025, F(0)], [0.025, F(0)], [0, F(0.22)]], shade(dim, 0.7));
    greenBillLine(k, cu, cv, [[-0.13 * m, F(0.02)], [-0.1 * m, F(0.42)], [-0.15 * m, F(0.74)], [-0.12 * m, F(0.8)]], shade(t.base, 0.9), 1, 0.6);
    // A fold down the shadowed side, the belt, and the open collar of the coat.
    greenBillLine(k, cu, cv, [[0.05 * m, F(0.04)], [0.045 * m, F(0.3)], [0.07 * m, F(0.42)]], shade(dim, 0.7), 1, 0.7);
    greenBillLine(k, cu, cv, [[-0.1, F(0.44)], [0.1, F(0.44)]], shade(dim, 0.7), 1.5, 0.9);
    greenBill(k, cu, cv, [[-0.05, F(0.8)], [0.05, F(0.8)], [0, F(0.66)]], shade(lit, 1.3));
    // Head, and a hat on some.
    greenPuff(k, cu, cv, F(0.9), 0.05, dim, 3);
    greenPuff(k, cu - 0.012 * m, cv + 0.012 * m, F(0.915), 0.034, lit, 4);
    if (hat) {
      greenBill(k, cu, cv, [[-0.045, F(0.9)], [0.045, F(0.9)], [0.04, F(1.02)], [-0.04, F(1.02)]], dim);
      greenBill(k, cu, cv, [[-0.09, F(0.935)], [0.09, F(0.935)], [0.07, F(0.96)], [-0.07, F(0.96)]], dim, 1, true);
    }
    // Arms by pose: an orator's arm raised, a staff planted, or both at the sides.
    if (pose === 0) {
      greenBillLine(k, cu, cv, [[0.13 * m, F(0.76)], [0.23 * m, F(0.9)], [0.27 * m, F(1.08)]], dim, 3, 1);
      greenPuff(k, cu + 0.275 * m * 0.5, cv - 0.275 * m * 0.5, F(1.1), 0.022, lit, 5);
      greenBillLine(k, cu, cv, [[-0.13 * m, F(0.74)], [-0.16 * m, F(0.46)]], lit, 2.5, 1);
    } else if (pose === 1) {
      greenBillLine(k, cu, cv, [[0.2 * m, F(-0.02)], [0.2 * m, F(1.12)]], shade(dim, 0.8), 2, 1);
      greenPuff(k, cu + 0.2 * m * 0.5, cv - 0.2 * m * 0.5, F(1.14), 0.02, lit, 6);
      greenBillLine(k, cu, cv, [[0.13 * m, F(0.74)], [0.19 * m, F(0.58)]], dim, 2.5, 1);
      greenBillLine(k, cu, cv, [[-0.13 * m, F(0.74)], [-0.16 * m, F(0.46)]], lit, 2.5, 1);
    } else {
      greenBillLine(k, cu, cv, [[0.13 * m, F(0.74)], [0.15 * m, F(0.46)]], dim, 2.5, 1);
      greenBillLine(k, cu, cv, [[-0.13 * m, F(0.74)], [-0.15 * m, F(0.46)]], lit, 2.5, 1);
      // A book held at the side.
      greenBill(k, cu, cv, [[-0.2 * m, F(0.38)], [-0.12 * m, F(0.4)], [-0.12 * m, F(0.52)], [-0.2 * m, F(0.5)]], shade(lit, 1.2), 1, true);
    }
    if (k.rnd(6) < 0.22) {
      // A pigeon on the cornice, as there always is.
      const pu = 0.64 + (k.rnd(7) - 0.5) * 0.1;
      // Body, tail and head; no ink ring round the body, which read as a bolt head.
      k.line([[pu + 0.02, 0.66, h * 0.46 + 0.03], [pu + 0.055, 0.66, h * 0.46 + 0.045]], 0x5e5d59, 2, 1);
      greenPuff(k, pu, 0.66, h * 0.46 + 0.03, 0.03, 0x6e6d68, 8, false);
      greenPuff(k, pu - 0.024, 0.66, h * 0.46 + 0.06, 0.017, 0x5e5d59, 9);
    }
    if (k.rnd(4) < 0.3) {
      // Someone has left a wreath leaning on the die's east face, clear of the
      // plaque: a thick ring of leaves lit on its upper side, two ribbon tails.
      const wv = 0.5 + (k.rnd(5) - 0.5) * 0.1;
      const r = h * 0.085;
      const wz = h * 0.11 + r;
      const ring: Array<[number, number, number]> = [];
      for (let i = 0; i <= 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        ring.push([0.72, wv + Math.cos(a) * r * 0.894, wz + Math.sin(a) * r]);
      }
      k.line(ring, shade(FOLIAGE, 0.55), 3.5, 1);
      k.line(ring.slice(0, 6), shade(FOLIAGE, 0.85), 1.5, 0.8);
      k.line([[0.722, wv + 0.02, wz - r * 0.95], [0.722, wv + 0.035, wz - r * 1.8]], 0x7a4040, 2, 1);
      k.line([[0.722, wv - 0.01, wz - r * 0.95], [0.722, wv - 0.03, wz - r * 1.7]], 0x6a3838, 2, 1);
    }
    return null;
  },
  hedge: (k, h) => {
    const t = k.t;
    const leaf = t.base;
    const z0 = h * 0.1;
    const top = h * 0.8;
    const hz = top - z0;
    const back = greenScallop(k, 100, 5);
    const front = greenScallop(k, 200, 6);
    const hang = greenScallop(k, 300, 7);
    if (!k.plan) {
      // The hollow under the clipped mass.
      k.facePanel('u', 0.72, 0.0, 0, 1.0, z0, shade(t.ink, 0.7));
      k.facePanel('v', 0.98, 0.28, 0, 0.72, z0, shade(t.ink, 0.6));
    }
    k.box(0, 0.25, 1, 0.75, z0, top, leaf, { crown: false, ink: false });
    if (!k.plan) {
      // Shadow pooling up the foot of the face, in lobes.
      const foot: Array<[number, number, number]> = [[1, 0.752, z0], [0, 0.752, z0]];
      for (const [u, f] of hang) foot.push([u, 0.752, z0 + hz * (0.14 + 0.16 * f)]);
      k.poly(foot, shade(leaf, 0.4), 0.55);
      // Leaf masses swelling out of the face, hollows between them.
      for (let n = 0; n < 7; n += 1) {
        const i = n < 3 ? n * 2 + 1 : (n - 3) * 2;
        const u = 0.07 + i * 0.143 + (k.rnd(30 + i) - 0.5) * 0.07;
        const lit = i % 2 === 0;
        const z = z0 + hz * (lit ? 0.48 + k.rnd(40 + i) * 0.14 : 0.28 + k.rnd(40 + i) * 0.14);
        k.faceCircle(u, 0.752, z, hz * (lit ? 0.19 : 0.13) * (0.8 + k.rnd(50 + i) * 0.4), 'u', lit ? shade(leaf, 0.84) : shade(leaf, 0.46), lit ? 0.75 : 0.55);
      }
      for (let i = 0; i < 4; i += 1) {
        k.faceCircle(0.14 + i * 0.24 + (k.rnd(55 + i) - 0.5) * 0.1, 0.753, z0 + hz * (0.62 + k.rnd(57 + i) * 0.12), hz * 0.08, 'u', shade(leaf, 0.98), 0.6);
      }
      // Clippings and dead leaves on the ground along the foot.
      for (let i = 0; i < 3; i += 1) {
        k.disc(0.1 + i * 0.33 + k.rnd(62 + i) * 0.15, 0.775 + k.rnd(65 + i) * 0.03, 0.016, 0, shade(i === 1 ? greenMix(leaf, 0x6e5a42, 0.6) : leaf, 0.85), 0.85);
      }
      // The rounded top edge lolling over the face, and over the end.
      const lip: Array<[number, number, number]> = [];
      for (const [u, f] of front) lip.push([1 - u, 0.752 + f * 0.025, top]);
      for (const [u, f] of hang) lip.push([u, 0.752, top - hz * (0.12 + 0.2 * f)]);
      k.poly(lip, shade(leaf, 0.84));
      const end: Array<[number, number, number]> = [[1.001, 0.25, top], [1.001, 0.75, top]];
      for (let i = 0; i <= 4; i += 1) end.push([1.001, 0.75 - i * 0.125, top - hz * (0.14 + 0.14 * Math.abs(Math.sin(i * 1.3 + 0.4)))]);
      k.poly(end, shade(leaf, 0.72));
      k.faceCircle(1.002, 0.35 + k.rnd(60) * 0.3, z0 + hz * 0.45, hz * 0.16, 'v', shade(leaf, 0.76), 0.7);
    }
    // The clipped top: a lumpy back edge against the sky, a scalloped front.
    const lid: Array<[number, number, number]> = [];
    for (const [u, f] of back) lid.push([u, 0.25 - f * 0.03, top + f * h * 0.12]);
    for (const [u, f] of front) lid.push([1 - u, 0.75 + f * 0.025, top]);
    k.poly(lid, k.plan ? leaf : shade(leaf, 0.875));
    k.line(lid.slice(0, back.length), t.ink, 1, 0.5);
    k.line(lid.slice(back.length), t.ink, 1, 0.5);
    // Crevices in shadow, then the clumps catching the light over them.
    for (let i = 0; i < 3 && !k.plan; i += 1) {
      greenPuff(k, 0.2 + i * 0.3 + (k.rnd(98 + i) - 0.5) * 0.1, 0.5 + (k.rnd(101 + i) - 0.5) * 0.2, top + 0.002, 0.05, shade(leaf, 0.74), 98 + i);
    }
    for (let i = 0; i < 6; i += 1) {
      // Kept a radius inside the cell ends: the end clumps could reach past the cell in plan.
      const r = 0.055 + k.rnd(92 + i) * 0.03;
      const u = Math.max(r, Math.min(1 - r, 0.08 + i * 0.168 + (k.rnd(80 + i) - 0.5) * 0.08));
      const v = 0.37 + k.rnd(86 + i) * 0.24;
      greenPuff(k, u, v, top + 0.004, r, k.plan ? shade(leaf, 1.12) : leaf, 80 + i);
    }
    if (!k.plan) k.line([[0, 0.75, z0], [1, 0.75, z0], [1, 0.25, z0], [1, 0.25, top]], t.ink, 1, 0.5);
    if (k.rnd(7) < 0.45) {
      // It wants a trim: whippy shoots standing proud of the clipped top.
      for (let i = 0; i < 2; i += 1) {
        const u = 0.15 + i * 0.4 + k.rnd(71 + i) * 0.25;
        const v = 0.36 + k.rnd(73 + i) * 0.2;
        const lean = (k.rnd(76 + i) - 0.5) * 0.1;
        k.line([[u, v, top], [u + lean, v - lean, top + h * 0.2], [u + lean * 2.2, v - lean * 1.6, top + h * 0.34]], shade(leaf, 0.9), 1, 1);
        k.line([[u + lean, v - lean, top + h * 0.2], [u + lean + 0.04, v - lean - 0.015, top + h * 0.29]], shade(leaf, 1.12), 1, 1);
      }
    }
    if (k.rnd(11) < 0.25) {
      // In flower: pale blossom sprinkled over the top and the upper face.
      for (let i = 0; i < 7; i += 1) {
        const u = 0.06 + i * 0.14 + (k.rnd(110 + i) - 0.5) * 0.08;
        const onTop = i % 3 !== 2;
        if (onTop) k.disc(u, 0.32 + k.rnd(117 + i) * 0.38, 0.018, top + 0.006, shade(t.light, 1.25), 0.9);
        else k.faceCircle(u, 0.754, z0 + hz * (0.55 + k.rnd(117 + i) * 0.25), hz * 0.05, 'u', shade(t.light, 1.1), 0.9);
      }
    }
    if (!k.plan && k.rnd(8) < 0.3) {
      // A dead patch where something has leaned into it.
      const u = 0.2 + k.rnd(9) * 0.6;
      k.faceCircle(u, 0.753, z0 + hz * 0.45, hz * 0.22, 'u', shade(greenMix(leaf, 0x6e5a42, 0.55), 0.62), 0.9);
      k.line([[u - 0.04, 0.754, z0 + hz * 0.3], [u + 0.01, 0.754, z0 + hz * 0.55], [u + 0.05, 0.754, z0 + hz * 0.62]], greenMix(0x4a3c30, t.dark, 0.3), 1, 0.8);
    }
    return null;
  },
  bench: (k, h) => {
    const t = k.t;
    const zs = h * 0.46;
    const iron = shade(t.ink, 0.7);
    const wood = t.base;
    if (!k.plan) {
      // Cast end frames: legs and the rising back support, a lit edge on the near one.
      for (const u of [0.12, 0.88]) {
        k.line([[u, 0.67, 0], [u, 0.64, zs - 0.02], [u, 0.39, zs - 0.02], [u, 0.41, 0]], iron, 2, 1);
        k.line([[u, 0.39, zs - 0.02], [u, 0.35, h * 0.98]], iron, 2, 1);
      }
      k.line([[0.88, 0.672, 0.01], [0.88, 0.645, zs - 0.03]], shade(t.light, 0.9), 1, 0.45);
      // A centre leg, and a centre strap behind the back boards.
      k.line([[0.5, 0.65, 0], [0.5, 0.63, zs - 0.03]], iron, 2, 1);
      k.line([[0.5, 0.39, zs - 0.03], [0.5, 0.36, h * 0.9]], iron, 2, 1);
    }
    // Two back boards leaning back, then three seat slats.
    for (let i = 0; i < 2; i += 1) {
      const zb0 = h * (0.58 + i * 0.2);
      const zb1 = zb0 + h * 0.14;
      const vb = 0.382 - i * 0.012;
      const vt = vb - 0.01;
      const col = shade(wood, 0.97 + k.rnd(10 + i) * 0.06);
      k.poly([[0.07, vb, zb0], [0.93, vb, zb0], [0.93, vt, zb1], [0.07, vt, zb1]], shade(col, 0.8));
      k.poly([[0.07, vt, zb1], [0.93, vt, zb1], [0.93, vt - 0.03, zb1], [0.07, vt - 0.03, zb1]], shade(col, 1.0));
      if (!k.plan) {
        k.poly([[0.93, vt, zb1], [0.93, vb, zb0], [0.93, vb - 0.03, zb0], [0.93, vt - 0.03, zb1]], shade(col, 0.66));
        k.line([[0.07, vb, zb0], [0.93, vb, zb0], [0.93, vb - 0.03, zb0]], t.ink, 1, 0.5);
      }
    }
    if (!k.plan && k.rnd(3) < 0.5) {
      // A dedication plaque on the top board.
      k.facePanel('u', 0.37, 0.44, h * 0.82, 0.56, h * 0.9, shade(t.light, 1.1), 0.9);
    }
    for (let i = 0; i < 3; i += 1) {
      const v0 = 0.4 + i * 0.09;
      k.box(0.07, v0, 0.93, v0 + 0.07, zs - 0.035, zs, shade(wood, 0.96 + k.rnd(20 + i) * 0.08), { crown: i === 2 });
    }
    // Where people sit, the slats are worn pale.
    k.poly([[0.3, 0.41, zs + 0.002], [0.7, 0.41, zs + 0.002], [0.7, 0.65, zs + 0.002], [0.3, 0.65, zs + 0.002]], shade(wood, 1.3), 0.12);
    // Armrests over the seat ends, the near one catching the light.
    for (const u of [0.12, 0.88]) {
      k.line([[u, 0.37, h * 0.74], [u, 0.6, h * 0.76], [u, 0.66, zs]], iron, 2, 1);
    }
    if (!k.plan) k.line([[0.88, 0.38, h * 0.755], [0.88, 0.6, h * 0.775]], shade(t.light, 0.9), 1, 0.35);
    // Sometimes a folded newspaper or a paper cup left on the seat.
    const left = k.rnd(4);
    if (left < 0.2) {
      k.poly([[0.28, 0.46, zs + 0.004], [0.44, 0.44, zs + 0.004], [0.46, 0.58, zs + 0.004], [0.3, 0.6, zs + 0.004]], 0xa8a292, 0.95, true);
      k.line([[0.3, 0.5, zs + 0.006], [0.43, 0.49, zs + 0.006]], 0x6f6a60, 1, 0.6);
    } else if (left < 0.35) {
      k.cyl(0.66, 0.54, 0.03, zs, zs + h * 0.14, 0xa8a292, { sides: 6 });
    }
    return null;
  },
  picnic: (k, h) => {
    type P = readonly [number, number, number];
    const t = k.t;
    const frame = shade(t.base, 0.82);
    const zc0 = h * 0.31;
    const zc1 = h * 0.37;
    const zb0 = h * 0.37;
    const zb1 = h * 0.45;
    const zt0 = h * 0.7;
    const zt1 = h * 0.79;
    const legs = [0.2, 0.8];
    const bench = (v0: number, v1: number) => {
      k.box(0.07, v0, 0.93, v1, zb0, zb1, t.base);
      const vm = (v0 + v1) / 2;
      civicSegs(k, [[[0.08, vm, zb1], [0.92, vm, zb1]], [[0.93, vm, zb0], [0.93, vm, zb1]]], shade(t.base, 0.62), 1, 0.55);
    };
    if (!k.plan) for (const u of legs) k.facePanel('v', u + 0.02, 0.15, zc0, 0.85, zc1, shade(frame, 0.7));
    bench(0.16, 0.31);
    if (!k.plan) {
      // The A-frames: two boards each, crossing under the top.
      for (const u of legs) {
        const ue = u + 0.02;
        k.poly([[ue, 0.19, 0], [ue, 0.25, 0], [ue, 0.53, zt0], [ue, 0.47, zt0]], shade(frame, 0.72), 1, true);
        k.poly([[ue, 0.75, 0], [ue, 0.81, 0], [ue, 0.53, zt0], [ue, 0.47, zt0]], shade(frame, 0.78), 1, true);
      }
      civicSegs(k, [[[0.22, 0.5, zc1], [0.42, 0.5, zt0]], [[0.78, 0.5, zc1], [0.58, 0.5, zt0]]], shade(frame, 0.65), 2, 0.9);
    }
    // The top: three boards on the frame, each its own tone.
    k.box(0.07, 0.35, 0.93, 0.65, zt0, zt1, t.base);
    const boards = [0.35, 0.45, 0.55, 0.65];
    for (let i = 0; i < 3; i += 1) {
      const f = 0.96 + k.rnd(30 + i) * 0.08;
      k.poly([[0.075, boards[i]! + 0.006, zt1], [0.925, boards[i]! + 0.006, zt1], [0.925, boards[i + 1]! - 0.006, zt1], [0.075, boards[i + 1]! - 0.006, zt1]], shade(t.base, (k.plan ? 1 : 0.875) * f), 1);
    }
    civicSegs(k, [[[0.08, 0.45, zt1], [0.92, 0.45, zt1]], [[0.08, 0.55, zt1], [0.92, 0.55, zt1]], [[0.93, 0.45, zt0], [0.93, 0.45, zt1]], [[0.93, 0.55, zt0], [0.93, 0.55, zt1]]], shade(t.base, 0.6), 1, 0.6);
    // Whatever the last people left behind.
    const paper = civicMix(t.light, 0xb4a88f, 0.55);
    const left = k.rnd(8);
    const iu = 0.22 + k.rnd(9) * 0.5;
    if (left > 0.3 && left <= 0.6) {
      k.box(iu, 0.43, iu + 0.08, 0.52, zt1, zt1 + h * 0.14, paper);
      k.poly([[iu + 0.012, 0.44, zt1 + h * 0.14], [iu + 0.068, 0.44, zt1 + h * 0.14], [iu + 0.068, 0.51, zt1 + h * 0.14], [iu + 0.012, 0.51, zt1 + h * 0.14]], shade(paper, 0.7), 1);
      if (!k.plan) k.line([[iu + 0.16, 0.56, zt1], [iu + 0.16, 0.56, zt1 + h * 0.1]], shade(paper, 0.95), 4, 1);
      k.disc(iu + 0.16, 0.56, 0.02, zt1 + h * 0.1, shade(t.ink, 0.8), 1, true);
    } else if (left > 0.6 && left <= 0.85) {
      k.disc(iu, 0.4, 0.05, zt1 + 0.003, paper, 1, true);
      k.disc(iu + 0.3, 0.6, 0.05, zt1 + 0.003, paper, 1, true);
      if (!k.plan) k.line([[iu + 0.15, 0.5, zt1], [iu + 0.15, 0.5, zt1 + h * 0.2]], civicMix(GLASS, t.ink, 0.55), 3, 0.9);
    } else if (left > 0.85) {
      k.poly([[iu, 0.39, zt1 + 0.004], [iu + 0.2, 0.37, zt1 + 0.004], [iu + 0.22, 0.52, zt1 + 0.004], [iu + 0.02, 0.54, zt1 + 0.004]], paper, 1, true);
      civicSegs(k, [[[iu + 0.1, 0.38, zt1 + 0.005], [iu + 0.12, 0.53, zt1 + 0.005]]], shade(paper, 0.75), 1, 0.6);
    } else if (left > 0.08) {
      // A gingham cloth laid for a meal: over the top, hanging off the near edge.
      const cloth = k.rnd(10) < 0.6 ? 0x864a40 : 0x4f6274;
      const cu0 = 0.16 + k.rnd(11) * 0.06;
      const cu1 = cu0 + 0.6;
      const zc = zt1 + 0.004;
      if (!k.plan) k.poly([[cu0, 0.665, zc], [cu1, 0.665, zc], [cu1 + 0.01, 0.67, zt1 - h * 0.12], [cu0 + 0.03, 0.67, zt1 - h * 0.1], [cu0 - 0.01, 0.67, zt1 - h * 0.13]], shade(cloth, 0.72));
      k.poly([[cu0, 0.33, zc], [cu1, 0.33, zc], [cu1, 0.665, zc], [cu0, 0.665, zc]], k.plan ? cloth : shade(cloth, 0.9), 1, true);
      const checks: (readonly [number, number, number])[][] = [];
      for (let i = 1; i < 6; i += 1) checks.push([[cu0 + i * 0.1, 0.335, zc], [cu0 + i * 0.1, 0.66, zc]]);
      for (const v of [0.41, 0.5, 0.58]) checks.push([[cu0 + 0.005, v, zc], [cu1 - 0.005, v, zc]]);
      if (!k.plan) for (let i = 1; i < 6; i += 1) checks.push([[cu0 + i * 0.1, 0.67, zc], [cu0 + i * 0.1, 0.67, zt1 - h * 0.1]]);
      civicSegs(k, checks, shade(cloth, 1.3), k.plan ? 1 : 2, 0.28);
    }
    bench(0.69, 0.84);
    return null;
  },
  signpost: (k, h) => {
    const t = k.t;
    const H = h;
    const tall = h >= 0.75;
    const zp = 1.62 * H;
    const post = t.base;
    const board = shade(t.accent, 1.1);
    const flip1 = k.rnd(1) < 0.5;
    const flip2 = k.rnd(2) < 0.5;
    const third = tall && k.rnd(3) < 0.35;
    const T = 0.03;
    const letters = shade(board, 0.42);
    // A finger board: lit top, the south face with its arrow point and a lit
    // edge, two words of lettering, and a strap round the post that holds it.
    const alongU = (z0: number, z1: number, dir: 1 | -1, salt: number): void => {
      const len = 0.36 + k.rnd(salt) * 0.05;
      const a = dir > 0 ? 0.535 : 0.465;
      const tip = 0.5 + dir * len;
      const sh = 0.5 + dir * (len - 0.06);
      const zm = (z0 + z1) / 2;
      const v0 = 0.5 - T;
      const v1 = 0.5 + T;
      if (k.plan) {
        k.poly([[a, v0, z1], [sh, v0, z1], [tip, 0.5, z1], [sh, v1, z1], [a, v1, z1]], board, 1, true);
        return;
      }
      k.poly([[a, v0, z1], [sh, v0, z1], [tip, v0, zm], [tip, v1, zm], [sh, v1, z1], [a, v1, z1]], shade(board, 0.875));
      k.poly([[a, v1, z0], [sh, v1, z0], [tip, v1, zm], [sh, v1, z1], [a, v1, z1]], shade(board, 0.7), 1, true);
      k.line([[a, v1, z1], [sh, v1, z1], [tip, v1, zm]], shade(board, 1.3), 1, 0.5);
      const w1 = 0.1 + k.rnd(salt + 1) * 0.05;
      const s0 = a + dir * 0.045;
      k.line([[s0, v1, zm], [s0 + dir * w1, v1, zm]], letters, 1.5, 0.6);
      k.line([[s0 + dir * (w1 + 0.03), v1, zm], [sh - dir * 0.05, v1, zm]], letters, 1.5, 0.6);
    };
    const alongV = (z0: number, z1: number, dir: 1 | -1, salt: number): void => {
      const len = 0.36 + k.rnd(salt) * 0.05;
      const a = dir > 0 ? 0.535 : 0.465;
      const tip = 0.5 + dir * len;
      const sh = 0.5 + dir * (len - 0.06);
      const zm = (z0 + z1) / 2;
      const u0 = 0.5 - T;
      const u1 = 0.5 + T;
      if (k.plan) {
        k.poly([[u0, a, z1], [u0, sh, z1], [0.5, tip, z1], [u1, sh, z1], [u1, a, z1]], shade(board, 0.9), 1, true);
        return;
      }
      k.poly([[u0, a, z1], [u0, sh, z1], [u0, tip, zm], [u1, tip, zm], [u1, sh, z1], [u1, a, z1]], shade(board, 0.8));
      k.poly([[u1, a, z0], [u1, sh, z0], [u1, tip, zm], [u1, sh, z1], [u1, a, z1]], shade(board, 0.6), 1, true);
      k.line([[u1, a, z1], [u1, sh, z1], [u1, tip, zm]], shade(board, 1.2), 1, 0.45);
      const w1 = 0.1 + k.rnd(salt + 1) * 0.05;
      const s0 = a + dir * 0.045;
      k.line([[u1, s0, zm], [u1, s0 + dir * w1, zm]], shade(board, 0.38), 1.5, 0.6);
      k.line([[u1, s0 + dir * (w1 + 0.03), zm], [u1, sh - dir * 0.05, zm]], shade(board, 0.38), 1.5, 0.6);
    };
    const strap = (z: number): void => {
      if (!k.plan) k.line([[0.463, 0.537, z], [0.537, 0.537, z], [0.537, 0.463, z]], t.dark, 2, 0.9);
    };
    const b1: [number, number] = tall ? [1.3 * H, 1.44 * H] : [1.3 * H, 1.5 * H];
    const b2: [number, number] = tall ? [1.08 * H, 1.22 * H] : [1.06 * H, 1.24 * H];
    const b3: [number, number] = [0.88 * H, 1.0 * H];
    // Boards that point away from the viewer go up before the post.
    if (flip1) alongU(b1[0], b1[1], -1, 30);
    if (tall && flip2) alongV(b2[0], b2[1], -1, 40);
    if (third && !flip1) alongU(b3[0], b3[1], -1, 50);
    k.box(0.43, 0.43, 0.57, 0.57, 0, 0.07 * H, shade(t.dark, 1.15), { crown: false });
    k.box(0.465, 0.465, 0.535, 0.535, 0.07 * H, zp, post);
    if (!k.plan) {
      // Grain down both faces, the pyramid cap, sometimes moss on it and a waymark.
      k.line([[0.49, 0.535, 0.12 * H], [0.492, 0.535, zp - 0.06 * H]], shade(post, 0.6), 1, 0.35);
      k.line([[0.535, 0.508, 0.2 * H], [0.535, 0.505, zp - 0.12 * H]], shade(post, 0.6), 1, 0.3);
      k.poly([[0.455, 0.545, zp], [0.545, 0.545, zp], [0.5, 0.5, zp + 0.07 * H]], shade(t.dark, 0.78), 1, true);
      k.poly([[0.545, 0.545, zp], [0.545, 0.455, zp], [0.5, 0.5, zp + 0.07 * H]], shade(t.dark, 0.66), 1, true);
      if (k.rnd(5) < 0.35) k.poly([[0.47, 0.545, zp], [0.53, 0.545, zp], [0.5, 0.52, zp + 0.035 * H]], FOLIAGE, 0.85);
      if (tall && k.rnd(6) < 0.5) {
        k.facePanel('u', 0.536, 0.472, 0.72 * H, 0.528, 0.84 * H, shade(t.light, 1.05), 1, true);
        k.line([[0.486, 0.536, 0.75 * H], [0.5, 0.536, 0.81 * H], [0.514, 0.536, 0.75 * H]], shade(t.accent, 0.62), 1.5, 0.9);
      }
    } else {
      k.line([[0.465, 0.465, 0], [0.535, 0.535, 0]], t.dark, 1, 0.6);
    }
    strap((b1[0] + b1[1]) / 2);
    if (!flip1) alongU(b1[0], b1[1], 1, 30);
    if (tall) {
      strap((b2[0] + b2[1]) / 2);
      if (!flip2) alongV(b2[0], b2[1], 1, 40);
    }
    if (third) {
      strap((b3[0] + b3[1]) / 2);
      if (flip1) alongU(b3[0], b3[1], 1, 50);
    }
    if (!tall && !k.plan) {
      // A life ring hung on the post: red and off-white quarters.
      const zc = 0.62 * H;
      const rr = 0.15;
      const ring = streetArc(k, 0.5, 0.55, zc, rr, 'u', 0, Math.PI * 2, 18);
      k.line(ring, t.ink, 6, 0.55);
      k.line(ring, t.base, 4.2, 1);
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        k.line(streetArc(k, 0.5, 0.551, zc, rr, 'u', a - 0.32, a + 0.32, 4), 0xb4ab9c, 4.2, 1);
      }
      k.line([[0.5, 0.55, zc + rr + 0.01], [0.5, 0.55, zc + rr + 0.06]], t.ink, 1.5, 0.9);
    } else if (!tall) {
      k.poly([[0.38, 0.54, 0], [0.62, 0.54, 0], [0.62, 0.58, 0], [0.38, 0.58, 0]], t.base, 1, true);
    }
    if (tall && k.rnd(4) < 0.6) {
      // A tuft of grass at the foot.
      const blades: Array<[number, number, number]> = [];
      for (let i = 0; i < 5; i += 1) {
        const u = 0.38 + i * 0.03;
        blades.push([u, 0.6 - i * 0.01, 0], [u + (i - 2) * 0.012, 0.61 - i * 0.01, (0.07 + k.rnd(20 + i) * 0.06) * H]);
      }
      if (k.plan) k.disc(0.44, 0.58, 0.05, 0, FOLIAGE, 0.9);
      else k.line(blades, FOLIAGE, 1.2, 0.95);
    }
    return null;
  },
  swing: (k, h) => {
    const t = k.t;
    const zt = h * 1.5;
    const wood = t.base;
    const pole = t.dark;
    const chain = shade(t.ink, 0.9);
    const sway = [(k.rnd(1) - 0.5) * 0.16, (k.rnd(2) - 0.5) * 0.08];
    const sling = [k.rnd(5) < 0.45, k.rnd(6) < 0.45];
    const thrown = k.rnd(7) < 0.2 ? (k.rnd(8) < 0.5 ? 0 : 1) : -1;
    // Worn earth under each seat, scuffed long the way it swings; a puddle in one.
    for (let i = 0; i < 2; i += 1) {
      greenOval(k, 0.33 + i * 0.34, 0.5 + sway[i]! * 0.4, 0.1, 0.17, 0, t.ink, 0.26);
      greenOval(k, 0.33 + i * 0.34, 0.5 + sway[i]! * 0.4, 0.05, 0.1, 0, t.ink, 0.22);
    }
    if (k.rnd(9) < 0.3) k.disc(k.rnd(10) < 0.5 ? 0.33 : 0.67, 0.53, 0.05, 0, shade(GLASS, 0.42), 0.45);
    // Feet set in concrete pads.
    for (const u of [0.1, 0.9]) {
      for (const v of [0.32, 0.68]) {
        k.disc(u, v, 0.045, 0, shade(t.light, 0.72), 0.9);
        k.disc(u, v, 0.026, 0, shade(t.ink, 0.7), 1);
      }
    }
    const frame = (u: number) => {
      for (const v of [0.32, 0.68]) {
        k.line([[u, v, 0], [u, 0.5, zt]], pole, 3, 1);
        if (!k.plan) k.line([[u, v, 0.02], [u, 0.5, zt - 0.02]], shade(wood, 1.05), 1, 0.7);
      }
      if (!k.plan) {
        k.line([[u, 0.39, h * 0.6], [u, 0.61, h * 0.6]], pole, 2, 1);
        // The steel bracket clamping the legs to the beam.
        k.poly([[u + 0.006, 0.445, zt - h * 0.17], [u + 0.006, 0.555, zt - h * 0.17], [u + 0.006, 0.545, zt], [u + 0.006, 0.455, zt]], shade(t.ink, 0.85), 1);
      }
    };
    frame(0.1);
    k.box(0.06, 0.47, 0.94, 0.53, zt - 0.07, zt, wood);
    for (let i = 0; i < 2; i += 1) {
      const u = 0.33 + i * 0.34;
      const up = thrown === i;
      const dv = up ? 0 : sway[i]!;
      const zs = up ? zt - h * 0.5 : h * 0.42 + dv * dv * 2;
      if (!k.plan) {
        for (const du of [-0.065, 0.065]) {
          k.line([[u + du, 0.5, zt - 0.07], [u + du, 0.5 + dv, zs]], chain, 1, 0.9);
          // Wound over the beam out of reach: the chain wraps it.
          if (up) k.line([[u + du - 0.015, 0.47, zt - 0.08], [u + du + 0.015, 0.535, zt + 0.012]], chain, 1.5, 0.95);
        }
      }
      if (sling[i]) {
        // A rubber strap seat sagging between the chains.
        const topPts: Array<[number, number, number]> = [];
        const edge: Array<[number, number, number]> = [];
        for (let q = 0; q <= 4; q += 1) {
          const x = -0.085 + q * 0.0425;
          const z = zs - 0.035 * (1 - (x / 0.085) ** 2);
          topPts.push([u + x, 0.5 + dv - 0.03, z]);
          edge.push([u + x, 0.5 + dv + 0.03, z]);
        }
        const lower = edge.map(([a, b, c]): [number, number, number] => [a, b, c - 0.025]).reverse();
        k.poly([...topPts, ...[...edge].reverse()], shade(t.ink, 1.15));
        if (!k.plan) k.poly([...edge, ...lower], shade(t.ink, 0.75));
      } else {
        k.box(u - 0.085, 0.465 + dv, u + 0.085, 0.535 + dv, zs - 0.03, zs, shade(wood, 0.62));
      }
    }
    frame(0.9);
    return null;
  },
  flag: (k, h) => {
    type P = readonly [number, number, number];
    const t = k.t;
    // The tile's colours are the cloth's; pole and plinth only lean toward them, so a red flag does not stand on a pink pole.
    const concrete = civicMix(t.dark, 0x76736d, 0.78);
    const steel = civicMix(t.light, 0xa3a5a6, 0.9);
    const cloth = shade(t.accent, 1.05);
    const top = h * 2.05;
    // A two-step plinth with a plaque on its face.
    k.box(0.4, 0.4, 0.6, 0.6, 0, h * 0.07, shade(concrete, 0.92));
    k.box(0.435, 0.435, 0.565, 0.565, h * 0.07, h * 0.15, concrete);
    k.facePanel('u', 0.601, 0.45, h * 0.015, 0.55, h * 0.055, shade(concrete, 1.18), 0.9);
    if (!k.plan) {
      k.line([[0.5, 0.5, h * 0.15], [0.5, 0.5, h * 1.1]], shade(steel, 0.78), 3, 1);
      k.line([[0.5, 0.5, h * 1.1], [0.5, 0.5, top]], shade(steel, 0.78), 2, 1);
      k.line([[0.49, 0.51, h * 0.2], [0.492, 0.508, top - h * 0.02]], shade(steel, 1.25), 1, 0.55);
      k.line([[0.5, 0.5, h * 0.15], [0.5, 0.5, h * 0.25]], shade(steel, 0.62), 5, 1);
      // Halyard down to its cleat.
      k.line([[0.52, 0.49, top - h * 0.02], [0.52, 0.49, h * 0.58]], civicMix(t.light, 0xa9a69c, 0.75), 1, 0.45);
      k.line([[0.515, 0.49, h * 0.6], [0.53, 0.49, h * 0.54]], shade(steel, 0.6), 2, 1);
    } else {
      k.disc(0.5, 0.5, 0.025, top, shade(steel, 0.9), 1, true);
    }
    // The flag: eight strips on a wave that grows toward the fly.
    const N = 8;
    const L = 0.36 + k.rnd(8) * 0.06;
    const fh = h * 0.5;
    const phase = k.rnd(5) * Math.PI * 2;
    const amp = 0.04 + k.rnd(6) * 0.03;
    const swallow = k.rnd(9) < 0.3;
    const cols: P[][] = [];
    for (let i = 0; i <= N; i += 1) {
      const f = i / N;
      const u = 0.515 + L * f;
      const v = 0.5 + Math.sin(phase + f * 5.2) * amp * Math.sqrt(f);
      const zTop = top - h * 0.05 - h * 0.09 * f * f;
      cols.push([[u, v, zTop - fh + h * 0.03 * f], [u, v, zTop]]);
    }
    const emblem = Math.floor(k.rnd(7) * 4);
    const at = (i: number, s: number): P => {
      const c = cols[i]!;
      return [c[0]![0], c[0]![1], c[0]![2] + (c[1]![2] - c[0]![2]) * s];
    };
    const atf = (x: number, s: number): P => {
      const i = Math.max(0, Math.min(N - 1, Math.floor(x)));
      const f = x - i;
      const p = at(i, s);
      const q = at(i + 1, s);
      return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
    };
    // A shape across the cloth from column x0 to x1, rows s0..s1, as one polygon.
    const patch = (x0: number, x1: number, s0: number, s1: number): P[] => {
      const out: P[] = [];
      const steps = Math.max(1, Math.ceil(x1 - x0));
      for (let j = 0; j <= steps; j += 1) out.push(atf(x0 + ((x1 - x0) * j) / steps, s0));
      for (let j = steps; j >= 0; j -= 1) out.push(atf(x0 + ((x1 - x0) * j) / steps, s1));
      return out;
    };
    if (k.plan) {
      // From above a flag is its ribbon of cloth.
      const left: P[] = [];
      const right: P[] = [];
      for (let i = 0; i <= N; i += 1) {
        const c = cols[i]![0]!;
        left.push([c[0], c[1] - 0.028, 0]);
        right.unshift([c[0], c[1] + 0.028, 0]);
      }
      k.poly([...left, ...right], cloth, 1, true);
      civicSegs(k, [cols.map((c) => [c[0]![0], c[0]![1], 0] as P)], shade(cloth, emblem === 0 ? 1.2 : 0.8), 1, 0.7);
    } else {
      // Each strip is shaded by its own normal but painted a little past its
      // fly edge, so the next strip covers the join and no seam shows: cloth, not slats.
      const notch = atf(N - 0.9, 0.5);
      for (let i = 0; i < N; i += 1) {
        const quad: P[] = [at(i, 0), at(i + 1, 0), at(i + 1, 1), at(i, 1)];
        const a = civicArea(k, quad);
        const tone = shade(cloth, civicLit(k, quad, a < 0) * (Math.abs(a) < 0.3 ? 0.8 : 1));
        const x1 = Math.min(N, i + 1.4);
        const paint: P[] = i === N - 1 && swallow ? [at(i, 0), at(N, 0), notch, at(N, 1), at(i, 1)] : [at(i, 0), atf(x1, 0), atf(x1, 1), at(i, 1)];
        k.poly(paint, tone);
      }
      // The device, laid over the folds so they still show through it.
      const end = swallow ? N - 1.2 : N;
      if (emblem === 0) civicPolys(k, [patch(0, end, 0.36, 0.64)], t.light, 0.32);
      if (emblem === 1) civicPolys(k, [patch(0, N * 0.42, 0.5, 1)], t.ink, 0.38);
      if (emblem === 2) {
        const disc: P[] = [];
        for (let j = 0; j < 10; j += 1) {
          const a = (j / 10) * Math.PI * 2;
          disc.push(atf(N * 0.42 + Math.cos(a) * 1.05, 0.5 + Math.sin(a) * 0.24));
        }
        civicPolys(k, [disc], t.light, 0.36);
      }
      if (emblem === 3) {
        civicPolys(k, [patch(0, N / 3, 0, 1)], t.ink, 0.34);
        civicPolys(k, [patch((N * 2) / 3, end, 0, 1)], t.light, 0.22);
      }
      const bottom = cols.map((c) => c[0]!).reverse();
      const edge: P[] = swallow ? [...cols.map((c) => c[1]!), notch, ...bottom] : [...cols.map((c) => c[1]!), ...bottom];
      k.line([...edge, edge[0]!], t.ink, 1, 0.5);
      k.line(cols.map((c) => c[1]!), shade(cloth, 1.4), 1, 0.35);
      // The hoist: a doubled hem against the pole with its two clips.
      civicSegs(k, [[at(0, 0.02), at(0, 0.98)]], shade(cloth, 0.7), 2, 0.9);
      civicSegs(k, [0.94, 0.08].map((s): P[] => [[0.507, 0.5, at(0, s)[2] + h * 0.03], [0.507, 0.5, at(0, s)[2] - h * 0.025]]), shade(steel, 0.7), 2, 1);
      k.line([[0.5, 0.5, top], [0.5, 0.5, top + h * 0.04]], shade(steel, 0.9), 4, 1);
      k.disc(0.5, 0.5, 0.022, top + h * 0.06, civicMix(t.accent, 0xa89868, 0.6), 1, true);
    }
    return null;
  },
  bike: (k, h) => {
    const t = k.t;
    const r = Math.min(0.27 * h, 0.16);
    const paint = k.rnd(6);
    const frame = paint < 0.45 ? shade(t.accent, 1.12) : paint < 0.75 ? shade(t.light, 0.96) : shade(t.base, 1.28);
    const rh = 0.29;
    const fh = 0.71;
    const R: [number, number, number] = [rh, 0.5, r];
    const F: [number, number, number] = [fh, 0.5, r];
    const B: [number, number, number] = [0.47, 0.5, r * 0.85];
    const S: [number, number, number] = [0.42, 0.5, r * 2.15];
    const Ht: [number, number, number] = [0.655, 0.5, r * 2.2];
    const Hb: [number, number, number] = [0.665, 0.5, r * 1.8];
    const carry = k.rnd(1);
    // Some are locked to a hoop stand, leaning on it rather than on the kickstand.
    const stand = k.rnd(7) < 0.4;
    const hz = r * 2.2;
    if (k.plan) {
      if (stand) k.line([[0.42, 0.62, 0], [0.68, 0.62, 0]], shade(t.light, 0.72), 2.5, 1);
      const kk = 0.894;
      for (const u of [rh, fh]) k.poly([[u - r * kk, 0.465, 0], [u + r * kk, 0.465, 0], [u + r * kk, 0.535, 0], [u - r * kk, 0.535, 0]], shade(t.light, 0.62), 1, true);
      k.line([R, B, Ht, F], frame, 2, 1);
      k.line([[0.63, 0.38, 0], [0.63, 0.62, 0]], t.ink, 2, 1);
      k.poly([[0.39, 0.47, 0], [0.45, 0.47, 0], [0.45, 0.53, 0], [0.39, 0.53, 0]], t.ink);
      if (carry < 0.65) k.box(0.16, 0.39, 0.4, 0.61, r * 2, r * 2 + 0.2, shade(t.base, 1.1));
      else if (carry < 0.85) k.poly([[0.7, 0.42, 0], [0.84, 0.42, 0], [0.84, 0.58, 0], [0.7, 0.58, 0]], t.dark, 0.9, true);
      return null;
    }
    // Handlebar's far grip, then the wheels, then the frame over them.
    k.line([[0.635, 0.39, r * 2.55], [0.635, 0.5, r * 2.55]], t.ink, 2, 1);
    for (const u of [rh, fh]) {
      k.line(streetArc(k, u, 0.5, r, r * 0.93, 'u', 0, Math.PI * 2, 16), t.ink, 2.8, 1);
      k.line(streetArc(k, u, 0.5, r, r * 0.7, 'u', 0, Math.PI * 2, 12), shade(t.light, 0.9), 1, 0.45);
      const sp = streetArc(k, u, 0.5, r, r * 0.68, 'u', 0.35 + u * 3, 0.35 + u * 3 + Math.PI * 2, 6);
      k.line([sp[0]!, sp[3]!, sp[1]!, sp[4]!, sp[2]!, sp[5]!], shade(t.light, 0.9), 1, 0.28);
      k.faceCircle(u, 0.5, r, r * 0.16, 'u', t.light, 0.9);
    }
    // Mudguards over both wheels, a reflector on the tail of the rear one.
    const guard = shade(frame, 0.78);
    const rear = streetArc(k, rh, 0.5, r, r * 1.12, 'u', Math.PI * 0.3, Math.PI * 1.02, 6);
    k.line(rear, guard, 1.8, 1);
    k.line(streetArc(k, fh, 0.5, r, r * 1.12, 'u', Math.PI * 0.08, Math.PI * 0.7, 5), guard, 1.8, 1);
    k.disc(rear[6]![0], 0.5, 0.016, rear[6]![2], 0x7a3228, 1);
    // Chain run and chainring.
    k.line([[0.47, 0.5, r * 1.1], [rh, 0.5, r * 1.1], [rh, 0.5, r * 0.9], [0.47, 0.5, r * 0.6]], t.ink, 1, 0.7);
    k.faceCircle(0.47, 0.505, r * 0.85, r * 0.27, 'u', t.dark, 1, true);
    const tubes: Array<Array<[number, number, number]>> = [
      [R, B, Hb, F],
      [R, S, Ht, Hb],
      [B, [0.415, 0.5, r * 2.35]],
    ];
    for (const p of tubes) k.line(p, t.ink, 3.6, 0.6);
    for (const p of tubes) k.line(p, frame, 2, 1);
    // Crank and pedal; the kickstand when nothing else holds it up.
    k.line([[0.44, 0.56, r * 0.45], [0.47, 0.52, r * 0.85], [0.5, 0.47, r * 1.2]], t.ink, 1.5, 0.95);
    if (!stand) k.line([[0.47, 0.51, r * 0.85], [0.43, 0.58, 0]], t.ink, 1, 0.9);
    // A lamp on the head tube.
    k.box(0.675, 0.478, 0.705, 0.522, r * 1.9, r * 2.08, shade(t.light, 1.05), { crown: false, ink: false });
    if (carry < 0.65) {
      // A delivery box on the rear rack: lid line, a label, the latch.
      const bx = shade(t.base, 1.1);
      k.line([[0.2, 0.5, r * 2], [0.42, 0.5, r * 2.05], [rh, 0.5, r]], t.ink, 1.5, 0.9);
      k.box(0.16, 0.39, 0.4, 0.61, r * 2, r * 2 + 0.2, bx);
      k.facePanel('u', 0.61, 0.19, r * 2 + 0.05, 0.37, r * 2 + 0.12, t.light, 0.8);
      k.facePanel('u', 0.611, 0.21, r * 2 + 0.07, 0.25, r * 2 + 0.1, shade(t.accent, 0.8), 1);
      k.line([[0.16, 0.61, r * 2 + 0.16], [0.4, 0.61, r * 2 + 0.16], [0.4, 0.39, r * 2 + 0.16]], shade(bx, 0.6), 1, 0.6);
      k.facePanel('v', 0.401, 0.48, r * 2 + 0.12, 0.52, r * 2 + 0.16, t.ink, 0.8);
    } else if (carry < 0.85) {
      // A wire basket on the bars.
      k.box(0.7, 0.42, 0.84, 0.58, r * 1.9, r * 2.5, t.dark, { alpha: 0.7, crown: false });
      k.line([[0.7, 0.58, r * 2.2], [0.84, 0.58, r * 2.2], [0.84, 0.42, r * 2.2]], t.light, 1, 0.5);
      k.line([[0.74, 0.58, r * 1.9], [0.74, 0.58, r * 2.5], [0.79, 0.58, r * 2.5], [0.79, 0.58, r * 1.9]], t.light, 1, 0.35);
    } else {
      // Just the bare rack.
      k.line([[0.17, 0.5, r * 2], [0.42, 0.5, r * 2.05], [rh, 0.5, r]], t.ink, 1.5, 0.9);
    }
    // Saddle, stem and the near grip.
    k.box(0.38, 0.475, 0.46, 0.525, r * 2.35, r * 2.35 + 0.035, t.ink, { crown: false, ink: false });
    k.line([Ht, [0.635, 0.5, r * 2.55]], frame, 2, 1);
    k.line([[0.635, 0.5, r * 2.55], [0.635, 0.61, r * 2.55]], t.ink, 2, 1);
    if (stand) {
      // The hoop it is locked to, on the near side.
      const hoop: Array<[number, number, number]> = [[0.42, 0.62, 0], [0.42, 0.62, hz - 0.05], [0.45, 0.62, hz], [0.65, 0.62, hz], [0.68, 0.62, hz - 0.05], [0.68, 0.62, 0]];
      k.line(hoop, t.ink, 3, 0.55);
      k.line(hoop, shade(t.light, 0.72), 1.6, 1);
      k.line([[0.44, 0.58, hz * 0.55], [0.47, 0.5, r * 0.9]], t.ink, 1.5, 0.85);
    }
    return null;
  },
  rocks: (k, h) => {
    const t = k.t;
    const lay = Math.floor(k.rnd(1) * 3);
    const stones: { u: number; v: number; r: number; H: number; sides: number; tone: number; salt: number }[] = [];
    const bu = 0.4 + k.rnd(2) * 0.1;
    const bv = 0.44 + k.rnd(3) * 0.1;
    stones.push({ u: bu, v: bv, r: 0.25, H: h * (0.78 + k.rnd(4) * 0.2), sides: 7, tone: 1, salt: 1 });
    const spots = [
      [[0.74, 0.34], [0.7, 0.72], [0.22, 0.74]],
      [[0.74, 0.7], [0.24, 0.72], [0.76, 0.3]],
      [[0.24, 0.26], [0.75, 0.66], [0.58, 0.76]],
    ][lay]!;
    stones.push({ u: spots[0]![0]!, v: spots[0]![1]!, r: 0.14, H: h * (0.42 + k.rnd(5) * 0.12), sides: 6, tone: 0.92 + k.rnd(6) * 0.1, salt: 2 });
    stones.push({ u: spots[1]![0]!, v: spots[1]![1]!, r: 0.085, H: h * 0.24, sides: 5, tone: 1.04, salt: 3 });
    if (k.rnd(7) < 0.5) stones.push({ u: spots[2]![0]!, v: spots[2]![1]!, r: 0.07, H: h * 0.18, sides: 5, tone: 0.95, salt: 4 });
    stones.sort((a, b) => a.u + a.v - (b.u + b.v));
    for (const s of stones) {
      const cap = civicBoulder(k, s.u, s.v, s.r, s.H, s.sides, shade(t.base, s.tone), s.salt);
      if (s.salt === 1) {
        // Moss or lichen on the big one's crown, and a crack down its face.
        const mu = cap.reduce((a, p) => a + p[0], 0) / cap.length - 0.03;
        const mv = cap.reduce((a, p) => a + p[1], 0) / cap.length - 0.03;
        const moss = cap.slice(0, 4).map((p): readonly [number, number, number] => [mu + (p[0] - mu) * 0.8, mv + (p[1] - mv) * 0.8, p[2] + 0.002]);
        k.poly(moss, k.rnd(8) < 0.6 ? FOLIAGE : shade(t.light, 1.1), 0.4);
        if (!k.plan) {
          const i = cap.reduce((best, p, j) => (p[0] + p[1] > cap[best]![0] + cap[best]![1] ? j : best), 0);
          const p = cap[i]!;
          k.line([[mu + 0.02, mv + 0.04, p[2]], [p[0], p[1], p[2]], [p[0] + 0.03, p[1] + 0.04, p[2] * 0.55]], shade(t.base, 0.55), 1, 0.5);
          if (k.rnd(9) < 0.6) {
            // Grass the mower never reaches, in the angle where the stone meets the ground.
            const blades: (readonly [number, number, number])[][] = [];
            for (let i = 0; i < 4; i += 1) {
              const a = (0.05 + k.rnd(90 + i) * 0.6) * Math.PI;
              const gu = s.u + Math.cos(a) * s.r * 0.92;
              const gv = s.v + Math.sin(a) * s.r * 0.92;
              const tall = h * (0.1 + k.rnd(95 + i) * 0.08);
              blades.push([[gu - 0.025, gv + 0.01, tall * 0.8], [gu, gv, 0], [gu + 0.004, gv - 0.004, tall], [gu, gv, 0], [gu + 0.03, gv - 0.01, tall * 0.7]]);
            }
            civicSegs(k, blades, shade(FOLIAGE, 0.9), 1, 0.85);
          }
        }
      }
    }
    if (!k.plan) {
      for (let i = 0; i < 3; i += 1) {
        const a = k.rnd(40 + i) * Math.PI * 2;
        k.disc(0.5 + Math.cos(a) * 0.33, 0.5 + Math.sin(a) * 0.3, 0.018, 0.004, shade(t.base, 0.8 + k.rnd(50 + i) * 0.3), 1, true);
      }
    }
    return null;
  },
  firepit: (k, h, glow) => {
    type P = readonly [number, number, number];
    const t = k.t;
    const wood = civicMix(t.dark, 0x5a4432, 0.6);
    const char = shade(t.ink, 0.6);
    const n = k.plan ? 9 : 9 + (k.rnd(1) < 0.5 ? 1 : 0);
    const R = 0.255;
    // Soot on the ground, the ash bed.
    k.disc(0.5, 0.5, 0.33, 0, shade(t.ink, 0.7), 0.3);
    k.disc(0.5, 0.5, 0.2, 0.002, civicMix(t.ink, 0x3e3c3a, 0.5), 1);
    if (!k.plan || glow === null) k.disc(0.47 + k.rnd(2) * 0.06, 0.5, 0.11, 0.004, civicMix(t.base, 0x8d8983, 0.5), glow === null ? 0.55 : 0.3);
    const stones = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + (k.rnd(10 + i) - 0.5) * 0.3;
      return { u: 0.5 + Math.cos(a) * R, v: 0.5 + Math.sin(a) * R, r: 0.06 + k.rnd(20 + i) * 0.02, H: h * (0.14 + k.rnd(30 + i) * 0.1), tone: 0.86 + k.rnd(40 + i) * 0.26, salt: i };
    }).sort((a, b) => a.u + a.v - (b.u + b.v));
    const stone = (s: (typeof stones)[number]) => civicStone(k, s.u, s.v, s.r, s.H, shade(t.base, s.tone), s.salt, true);
    if (k.plan) {
      // From above the ring is one symbol: every stone in two tones, four fills.
      for (const pale of [false, true]) {
        const group = stones.filter((s) => s.tone > 0.99 === pale).map((s) => civicStonePts(k, s.u, s.v, s.r, s.H, s.salt));
        civicPolys(k, group.map((g) => g.base), shade(t.base, pale ? 0.86 : 0.74), 1);
        civicPolys(k, group.map((g) => g.cap), shade(t.base, pale ? 1.08 : 0.94), 1);
      }
    } else {
      for (const s of stones) if (s.u + s.v < 1) stone(s);
    }
    // What the fire is for: nothing, a pot on a tripod, or a grate for the cans.
    const kit = Math.floor(k.rnd(5) * 3);
    const iron = civicMix(t.ink, 0x5d5a57, 0.45);
    const tri: P = [0.5, 0.5, h * 1.2];
    const feet = kit !== 1 ? [] : [0, 1, 2].map((j) => {
      const a = k.rnd(6) * 2 + (j * Math.PI * 2) / 3;
      return { p: [0.5 + Math.cos(a) * 0.335, 0.5 + Math.sin(a) * 0.335, 0] as P, depth: Math.cos(a) + Math.sin(a) };
    });
    civicSegs(k, feet.filter((f) => f.depth < 0.3).map((f) => [f.p, tri]), iron, 2, 1);
    const pot = () => {
      if (kit !== 1) return;
      if (!k.plan) k.line([tri, [0.5, 0.5, h * 0.66]], shade(iron, 1.3), 1, 0.9);
      civicDrum(k, 0.5, 0.5, 0.07, h * 0.42, h * 0.6, iron);
      k.disc(0.5, 0.5, 0.052, h * 0.6, shade(t.ink, 0.5), 1);
      if (!k.plan) k.line([[0.43, 0.5, h * 0.6], [0.47, 0.5, h * 0.67], [0.53, 0.5, h * 0.67], [0.57, 0.5, h * 0.6]], shade(iron, 1.4), 1, 0.8);
    };
    const teepee = k.rnd(3) < 0.55;
    const apex: P = [0.5, 0.5, h * 0.4];
    const sticks = Array.from({ length: 4 }, (_, i) => {
      const a = (i / 4) * Math.PI * 2 + k.rnd(4) * 1.5;
      return { foot: [0.5 + Math.cos(a) * 0.14, 0.5 + Math.sin(a) * 0.14, 0] as P, depth: Math.cos(a) + Math.sin(a) };
    });
    const logTone = glow === null ? char : wood;
    const drawSticks = (front: boolean) => {
      const list = sticks.filter((s) => s.depth >= 0 === front);
      civicSegs(k, list.map((s) => [s.foot, apex]), logTone, 3, 1);
      if (!k.plan) civicSegs(k, list.map((s) => [[s.foot[0], s.foot[1], 0.01], [apex[0], apex[1], apex[2] * 0.6]]), glow ?? char, 1, glow ? 0.6 : 0.8);
    };
    if (teepee) {
      drawSticks(false);
    } else {
      // Two logs burned down across each other.
      const logs: P[][] = [[[0.34, 0.4, h * 0.05], [0.66, 0.58, h * 0.05]], [[0.36, 0.62, h * 0.12], [0.64, 0.38, h * 0.12]]];
      for (const l of logs) {
        civicSegs(k, [l], logTone, 5, 1);
        if (!k.plan) civicSegs(k, [[[l[0]![0], l[0]![1], l[0]![2] + h * 0.03], [l[1]![0], l[1]![1], l[1]![2] + h * 0.03]]], glow === null ? shade(char, 1.4) : shade(wood, 1.35), 1, 0.7);
      }
      if (!k.plan) k.faceCircle(0.66, 0.58, h * 0.05, 0.022, 'v', glow === null ? char : shade(wood, 1.5), 1);
    }
    if (glow !== null) {
      k.disc(0.5, 0.5, 0.14, 0.006, glow, 0.5);
      k.disc(0.5, 0.5, 0.07, 0.008, shade(glow, 1.2), 0.9);
      if (!k.plan) {
        for (let i = 0; i < 3; i += 1) k.disc(0.4 + k.rnd(60 + i) * 0.2, 0.42 + k.rnd(70 + i) * 0.16, 0.012, 0.01, shade(glow, 1.3), 0.9);
        // Flames: three tongues facing the viewer, the tallest in the middle.
        const lean = (k.rnd(80) - 0.5) * 0.05;
        const flame = (w: number, H: number, color: number, alpha: number, salt: number) => {
          const pts: [number, number][] = [[-w, 0]];
          const m = 3;
          for (let j = 0; j < m; j += 1) {
            const x = -w + ((2 * j + 1) * w) / m;
            const tall = (j === 1 ? 1 : 0.62) * H * (0.8 + k.rnd(salt + j) * 0.3);
            if (j > 0) pts.push([x - w / m, H * 0.34]);
            else pts.push([x - w / m * 0.6, H * 0.3]);
            pts.push([x + lean * (tall / H), tall]);
          }
          pts.push([w * 0.8, H * 0.3], [w, 0], [0, -0.02 * h]);
          k.poly(pts.map(([d, z]): P => [0.5 + d * 0.7071, 0.5 - d * 0.7071, Math.max(0.01, z + 0.02 * h)]), color, alpha);
        };
        const tall = kit === 1 ? 0.8 : 1;
        flame(0.15, h * 0.85 * tall, civicMix(glow, 0x8a2a10, 0.4), 0.9, 90);
        flame(0.1, h * 0.62 * tall, glow, 0.95, 95);
        pot();
        flame(0.055, h * 0.36, civicMix(glow, 0xfff0c8, 0.65), 1, 99);
        for (let i = 0; i < 3; i += 1) k.disc(0.5 + (k.rnd(100 + i) - 0.5) * 0.2, 0.5 + (k.rnd(110 + i) - 0.5) * 0.1, 0.01, h * (0.85 + k.rnd(120 + i) * 0.4), shade(glow, 1.25), 0.85);
      } else {
        pot();
      }
    } else {
      if (!k.plan) for (let i = 0; i < 3; i += 1) k.disc(0.42 + k.rnd(60 + i) * 0.16, 0.44 + k.rnd(70 + i) * 0.12, 0.014, 0.01, char, 0.7);
      pot();
    }
    if (kit === 2) {
      // A grate of rebar laid across the ring, resting on the stones.
      const zg = h * 0.27;
      const bars: P[][] = [];
      for (let i = 0; i < 5; i += 1) bars.push([[0.35 + i * 0.075, 0.36, zg], [0.35 + i * 0.075, 0.64, zg]]);
      civicSegs(k, [[[0.33, 0.35, zg], [0.67, 0.35, zg], [0.67, 0.65, zg], [0.33, 0.65, zg], [0.33, 0.35, zg]]], shade(t.ink, 0.7), k.plan ? 1 : 3, 0.9);
      civicSegs(k, bars, glow === null || k.plan ? iron : civicMix(iron, glow, 0.35), k.plan ? 1 : 2, 0.95);
    }
    if (teepee) drawSticks(true);
    if (!k.plan) for (const s of stones) if (s.u + s.v >= 1) stone(s);
    civicSegs(k, feet.filter((f) => f.depth >= 0.3).map((f) => [f.p, tri]), shade(iron, 1.15), 2, 1);
    // The fixture is the ember bed, not the whole ring: the light pass brightens
    // the face it is handed, and a ring-sized face washed the stones and flames out.
    return glow ? k.pool(0.5, 0.5, 0.2) : null;
  },

  // --- water ---------------------------------------------------------------
  boat: (k, h) => {
    const t = k.t;
    const bowSouth = k.rnd(11) < 0.5;
    const V = (s: number) => (bowSouth ? 0.06 + s * 0.88 : 0.94 - s * 0.88);
    const P = (s: number, x: number, z: number): [number, number, number] => [0.5 + x * 0.34, V(s), z];
    const deck = (s: number) => h * (0.4 + 0.14 * s * s);
    const hullC = shade(t.light, 1.02);
    const bootC = shade(t.dark, 0.78);
    const deckC = shade(t.light, 1.1);
    const cabinC = shade(t.base, 1.04);
    const roofC = shade(t.light, 1.12);
    const darkC = shade(t.ink, 0.8);
    const sheer: Array<[number, number]> = [[0, 0.88], [0.42, 1], [0.66, 0.9], [0.86, 0.5], [1, 0], [0.86, -0.5], [0.66, -0.9], [0.42, -1], [0, -0.88]];
    const keel: Array<[number, number]> = [[0.05, 0.7], [0.42, 0.8], [0.64, 0.68], [0.82, 0.32], [0.93, 0], [0.82, -0.32], [0.64, -0.68], [0.42, -0.8], [0.05, -0.7]];
    const top = sheer.map(([s, x]) => P(s, x, deck(s)));
    const bot = keel.map(([s, x]) => P(s, x, 0));
    const mid = top.map((p, i): [number, number, number] => [bot[i]![0] + (p[0] - bot[i]![0]) * 0.4, bot[i]![1] + (p[1] - bot[i]![1]) * 0.4, p[2] * 0.4]);
    const halfAt = (s: number) => {
      for (let i = 0; i < 4; i += 1) {
        const [s0, x0] = sheer[i]!;
        const [s1, x1] = sheer[i + 1]!;
        if (s <= s1) return x0 + ((x1 - x0) * (s - s0)) / (s1 - s0);
      }
      return 0;
    };

    // The ripple the hull sits in, on the water.
    const wake = keel.map(([s, x]) => P(s * 1.02 - 0.01, x * 1.16, 0));
    k.line([...wake, wake[0]!], shade(t.light, 1.1), 1, 0.2);

    const outboard = () => {
      // Outboard on the transom: leg into the water, cowl above the deck, a lit stripe.
      const vt = V(0);
      const vb = V(-0.05);
      const va = Math.min(vt, vb);
      const vz = Math.max(vt, vb);
      const zt = deck(0) + h * 0.15;
      k.line([[0.5, (va + vz) / 2, deck(0)], [0.5, (va + vz) / 2, h * 0.01]], darkC, 3, 0.95);
      k.box(0.455, va, 0.545, vz, deck(0) - h * 0.05, zt, shade(t.ink, 0.92));
      k.line([[0.455, vz, zt - h * 0.04], [0.545, vz, zt - h * 0.04], [0.545, va, zt - h * 0.04]], shade(t.light, 1.05), 1, 0.6);
    };
    if (bowSouth) outboard();

    // Hull: light topsides over a dark boot, flared out from the waterline to the sheer.
    const faces: Array<{ p: Array<[number, number, number]>; c: number }> = [];
    for (let i = 0; i < top.length; i += 1) {
      const j = (i + 1) % top.length;
      faces.push({ p: [top[i]!, top[j]!, mid[j]!, mid[i]!], c: hullC });
      faces.push({ p: [mid[i]!, mid[j]!, bot[j]!, bot[i]!], c: bootC });
    }
    faces.push({ p: top, c: deckC });
    faces.push({ p: [...bot].reverse(), c: bootC });
    waterSolid(k, faces, P(0.5, 0, deck(0.5) * 0.5), true);
    if (!k.plan) {
      const rail = waterNear(top.map((p): [number, number, number] => [p[0], p[1], p[2] - h * 0.045]), 0.5, 0.5);
      k.line(rail, darkC, 2, 0.75);
    }
    k.line([...top, top[0]!], shade(deckC, 1.2), 1, 0.35);

    // Pulpit rail round the foredeck.
    const pulpit = ([[0.7, -0.62], [0.84, -0.44], [0.95, -0.14], [0.97, 0], [0.95, 0.14], [0.84, 0.44], [0.7, 0.62]] as const).map(([s, x]) => P(s, x, deck(s) + h * 0.08));
    if (!k.plan) k.line(pulpit, t.ink, 2, 0.35);
    k.line(pulpit, shade(t.light, 1.08), 1, 0.85);
    // Cockpit well at the stern and a hatch on the foredeck.
    const cock: Array<[number, number, number]> = [P(0.05, -0.7, deck(0.05)), P(0.05, 0.7, deck(0.05)), P(0.38, 0.8, deck(0.38)), P(0.38, -0.8, deck(0.38))];
    k.poly(cock, shade(t.dark, 0.8), 1, true);
    k.line([P(0.07, -0.62, deck(0.07)), P(0.07, 0.62, deck(0.07))], shade(t.base, 0.9), 2, 0.8);
    k.poly([P(0.8, -0.22, deck(0.8)), P(0.8, 0.22, deck(0.8)), P(0.87, 0.2, deck(0.87)), P(0.87, -0.2, deck(0.87))], shade(deckC, 0.84), 1, true);

    const cooler = () => {
      if (k.rnd(12) < 0.45) return;
      const s = 0.2;
      const va = Math.min(V(s - 0.05), V(s + 0.05));
      const vb = Math.max(V(s - 0.05), V(s + 0.05));
      k.box(0.36, va, 0.5, vb, deck(s), deck(s) + h * 0.1, shade(t.light, 1.08), { crown: false });
    };
    if (bowSouth) cooler();

    // Cabin: raked windscreen toward the bow, hardtop, glazed sides.
    const sA = 0.39;
    const sF = 0.74;
    const sR = 0.63;
    const xw = 0.6;
    const zA = deck(sA) - 0.004;
    const zF = deck(sF) - 0.004;
    const zt = deck(sA) + h * 0.4;
    const cab: Array<{ p: Array<[number, number, number]>; c: number }> = [
      { p: [P(sA, xw, zA), P(sF, xw, zF), P(sR, xw, zt), P(sA, xw, zt)], c: cabinC },
      { p: [P(sA, -xw, zA), P(sF, -xw, zF), P(sR, -xw, zt), P(sA, -xw, zt)], c: cabinC },
      { p: [P(sA, -xw, zA), P(sA, xw, zA), P(sA, xw, zt), P(sA, -xw, zt)], c: cabinC },
      { p: [P(sF, -xw, zF), P(sF, xw, zF), P(sR, xw, zt), P(sR, -xw, zt)], c: cabinC },
      { p: [P(sA, -xw, zt), P(sA, xw, zt), P(sR, xw, zt), P(sR, -xw, zt)], c: roofC },
      { p: [P(sA, -xw, zA), P(sF, -xw, zF), P(sF, xw, zF), P(sA, xw, zA)], c: cabinC },
    ];
    waterSolid(k, cab, P((sA + sF) / 2, 0, (zA + zt) / 2), true);
    const front = (z: number) => sF + ((sR - sF) * (z - zA)) / (zt - zA);
    const zl = zA + (zt - zA) * 0.42;
    const zu = zt - (zt - zA) * 0.16;
    const xe = xw + 0.004;
    if (!k.plan) {
      // Side glazing in two panes.
      k.poly([P(sA + 0.04, xe, zl), P(front(zl) - 0.035, xe, zl), P(front(zu) - 0.035, xe, zu), P(sA + 0.04, xe, zu)], shade(t.ink, 0.62), 0.95);
      k.poly([P(sA + 0.04, xe, zl), P(front(zl) - 0.035, xe, zl), P(front(zu) - 0.035, xe, zu), P(sA + 0.04, xe, zu)], GLASS, 0.3);
      const sm = (sA + front(zl)) / 2;
      k.line([P(sm, xe, zl), P(sm, xe, zu)], cabinC, 1, 0.9);
      if (bowSouth) {
        // Windscreen, raked, with its centre mullion.
        const f0 = 0.16;
        const f1 = 0.86;
        const S = (f: number) => sF + (sR - sF) * f;
        const Z = (f: number) => zF + (zt - zF) * f;
        k.poly([P(S(f0), -0.5, Z(f0)), P(S(f0), 0.5, Z(f0)), P(S(f1), 0.5, Z(f1)), P(S(f1), -0.5, Z(f1))], shade(t.ink, 0.62), 0.95);
        k.poly([P(S(f0), -0.5, Z(f0)), P(S(f0), 0.5, Z(f0)), P(S(f1), 0.5, Z(f1)), P(S(f1), -0.5, Z(f1))], GLASS, 0.34);
        k.line([P(S(f0), 0, Z(f0)), P(S(f1), 0, Z(f1))], cabinC, 1, 0.9);
      } else {
        // Companionway door in the aft bulkhead.
        k.poly([P(sA - 0.004, -0.22, zA + h * 0.01), P(sA - 0.004, 0.22, zA + h * 0.01), P(sA - 0.004, 0.22, zu), P(sA - 0.004, -0.22, zu)], shade(t.ink, 0.72), 0.95);
        k.poly([P(sA - 0.004, -0.14, zl + h * 0.04), P(sA - 0.004, 0.14, zl + h * 0.04), P(sA - 0.004, 0.14, zu - h * 0.03), P(sA - 0.004, -0.14, zu - h * 0.03)], GLASS, 0.3);
      }
    }
    if (k.plan) {
      // The raked windscreen is what says which end is the bow from above.
      k.poly([P(sF, -xw, zF), P(sF, xw, zF), P(sR, xw, zt), P(sR, -xw, zt)], 0x4d5f66, 1);
    }
    if (k.rnd(15) < 0.7) {
      // A lifebuoy stowed on the hardtop.
      const lb = P(sA + 0.12, -0.3, zt);
      k.disc(lb[0], lb[1], 0.048, zt + 0.003, 0xa85c3c, 1, !k.plan);
      k.disc(lb[0], lb[1], 0.022, zt + 0.004, shade(roofC, 0.8), 1);
    }
    // Mast with a nav light; a radome on some.
    const ms = sA + 0.07;
    k.line([P(ms, 0, zt), P(ms, 0, zt + h * 0.34)], darkC, 1, 0.95);
    k.line([P(ms, -0.28, zt + h * 0.22), P(ms, 0.28, zt + h * 0.22)], darkC, 1, 0.9);
    if (k.rnd(13) < 0.55) {
      const rs = sA + 0.16;
      waterLathe(k, 0.5 + 0.3 * 0.34, V(rs), [[0.04, zt, roofC], [0.04, zt + h * 0.05, roofC]], 6);
    }

    if (!bowSouth) {
      cooler();
      outboard();
    }
    // Fenders over the near side, on their lanyards.
    if (!k.plan) {
      const count = 2 + Math.floor(k.rnd(14) * 2);
      for (let i = 0; i < count; i += 1) {
        const s = 0.22 + i * 0.22;
        const u = 0.5 + halfAt(s) * 0.34 + 0.018;
        const v = V(s);
        const z0 = h * 0.08;
        const z1 = h * 0.26;
        k.line([[u - 0.01, v, deck(s)], [u, v, z1]], darkC, 1, 0.7);
        k.poly([[u, v - 0.02, z0 + 0.02], [u, v, z0], [u, v + 0.02, z0 + 0.02], [u, v + 0.02, z1 - 0.02], [u, v, z1], [u, v - 0.02, z1 - 0.02]], shade(t.ink, 0.9), 1, true);
      }
    }
    return null;
  },
  canoe: (k, h) => {
    const t = k.t;
    const W = 0.25;
    const P = (s: number, x: number, z: number): [number, number, number] => [0.5 + x * W, 0.07 + s * 0.86, z];
    const sheer = (s: number) => h * (0.27 + 0.2 * (2 * s - 1) * (2 * s - 1));
    const half: Array<[number, number]> = [[0, 0], [0.08, 0.44], [0.22, 0.82], [0.5, 1], [0.78, 0.82], [0.92, 0.44], [1, 0], [0.92, -0.44], [0.78, -0.82], [0.5, -1], [0.22, -0.82], [0.08, -0.44]];
    const hullC = t.base;
    const inC = shade(t.dark, 0.7);
    const floorC = shade(t.dark, 0.9);
    const wood = shade(t.light, 1.06);
    const gun = half.map(([s, x]) => P(s, x, sheer(s)));
    const bot = half.map(([s, x]) => P(0.1 + s * 0.8, x * 0.62, 0));
    const halfAt = (s: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, s))) ** 0.7;

    if (k.plan) {
      k.poly(gun, hullC, 1, true);
      k.poly(half.map(([s, x]) => P(0.06 + s * 0.88, x * 0.8, sheer(s))), inC, 1);
    } else {
      // The open hull: the far inside wall in shade, the floor with its ribs.
      k.poly(gun, inC, 1);
      const floor = half.map(([s, x]) => P(0.16 + s * 0.68, x * 0.66, h * 0.05));
      k.poly(floor, floorC, 1);
      for (const s of [0.3, 0.5, 0.7]) k.line([P(s, -halfAt(s) * 0.68, h * 0.05), P(s, halfAt(s) * 0.66, h * 0.05)], shade(t.ink, 0.9), 1, 0.45);
      if (k.rnd(41) < 0.5) {
        // Rainwater in the bilge.
        k.poly([P(0.36, -0.3, h * 0.052), P(0.5, -0.4, h * 0.052), P(0.64, -0.26, h * 0.052), P(0.5, 0.1, h * 0.052)], GLASS, 0.2);
      }
      // The near outside of the hull, over the floor's edge.
      const faces: Array<{ p: Array<[number, number, number]>; c: number }> = [];
      const wl = gun.map((g, i): [number, number, number] => [bot[i]![0] + (g[0] - bot[i]![0]) * 0.3, bot[i]![1] + (g[1] - bot[i]![1]) * 0.3, g[2] * 0.3]);
      for (let i = 0; i < gun.length; i += 1) {
        const j = (i + 1) % gun.length;
        faces.push({ p: [gun[i]!, gun[j]!, wl[j]!, wl[i]!], c: hullC });
        faces.push({ p: [wl[i]!, wl[j]!, bot[j]!, bot[i]!], c: shade(t.dark, 0.72) });
      }
      faces.push({ p: [...bot].reverse(), c: shade(t.dark, 0.72) });
      waterSolid(k, faces, P(0.5, 0, sheer(0.5) * 0.4), true);
      // Strakes: the planking lines along the near side, and the keel band.
      for (const f of [0.64]) {
        const strake = waterNear(half.map(([s, x]): [number, number, number] => {
          const g = P(s, x, sheer(s));
          const b = P(0.1 + s * 0.8, x * 0.62, 0);
          return [b[0] + (g[0] - b[0]) * f, b[1] + (g[1] - b[1]) * f, g[2] * f];
        }), 0.5, 0.5);
        k.line(strake, shade(hullC, 0.8), 1, 0.55);
      }
    }
    // Gunwale rails and the little end decks.
    k.line([...gun, gun[0]!], shade(t.ink, 0.9), 1, 0.6);
    k.line([...gun, gun[0]!], wood, k.plan ? 1 : 1.5, 0.9);
    for (const [s, d] of [[0, 1], [1, -1]] as const) {
      k.poly([P(s, 0, sheer(s)), P(s + d * 0.1, 0.52, sheer(s + d * 0.1)), P(s + d * 0.1, -0.52, sheer(s + d * 0.1))], shade(wood, 0.94), 1, true);
    }
    // Thwarts, and a third seat on some.
    const seats = k.rnd(42) < 0.4 ? [0.3, 0.5, 0.7] : [0.34, 0.66];
    for (const s of seats) {
      const w = halfAt(s) * 0.9;
      const z = sheer(s) - h * 0.02;
      k.box(0.5 - w * W, P(s, 0, 0)[1] - 0.022, 0.5 + w * W, P(s, 0, 0)[1] + 0.022, z - h * 0.05, z, shade(wood, 0.96), { crown: false, ink: false });
    }
    // A paddle laid along the boat, and a bag stowed on some.
    const flip = k.rnd(43) < 0.5 ? 1 : -1;
    const za = sheer(0.5) + h * 0.005;
    const s0 = 0.18 + k.rnd(44) * 0.08;
    const s1 = 0.8 - k.rnd(45) * 0.06;
    k.line([P(s0, -0.35 * flip, za), P(s1, 0.25 * flip, za)], shade(wood, 1.05), k.plan ? 1 : 1.5, 0.95);
    const bs = s1 - 0.02;
    k.poly([P(bs - 0.13, 0.12 * flip, za), P(bs - 0.1, 0.4 * flip, za), P(bs + 0.02, 0.44 * flip, za), P(bs + 0.02, 0.14 * flip, za)], shade(wood, 1.02), 1, true);
    if (k.rnd(46) < 0.55) {
      const bs2 = seats.length === 3 ? 0.6 : 0.5;
      waterLathe(k, 0.5 - 0.35 * W * flip, P(bs2, 0, 0)[1], [[0.07, h * 0.06, shade(t.ink, 1.05)], [0.075, h * 0.2, shade(t.ink, 1.1)], [0.04, h * 0.27, shade(t.ink, 1.15)]], 7);
    }
    return null;
  },
  buoy: (k, h, glow) => {
    const t = k.t;
    const R = 0.18;
    const bodyC = t.base;
    const bandC = shade(t.light, 1.12);
    const darkC = shade(t.ink, 0.8);
    const zd = h * 0.42;
    if (!k.plan) {
      // Rings where the float sits in the water.
      k.line(waterCircle(0.5, 0.5, R * 1.3, 0, 12, -Math.PI * 0.35, Math.PI * 0.85), shade(t.light, 1.15), 1, 0.3);
      k.line(waterCircle(0.5, 0.5, R * 1.62, 0, 10, -Math.PI * 0.1, Math.PI * 0.6), shade(t.light, 1.15), 1, 0.16);
    }
    // The float: a dark boot at the waterline, a can with a reflective band, a coned shoulder.
    waterLathe(k, 0.5, 0.5, [
      [R * 0.84, 0, shade(t.ink, 0.72)],
      [R, h * 0.07, bodyC],
      [R, h * 0.17, bandC],
      [R, h * 0.25, bodyC],
      [R * 0.96, h * 0.35, bodyC],
      [R * 0.6, zd, shade(t.dark, 0.95)],
    ], 10);
    if (!k.plan) {
      // Rust run down from the shoulder, across the band.
      for (const [a, z0] of [[0.12, 0.12], [0.44, 0.19]] as const) {
        const c = Math.cos(a * Math.PI) * (R + 0.003);
        const s = Math.sin(a * Math.PI) * (R + 0.003);
        k.line([[0.5 + c, 0.5 + s, h * 0.33], [0.5 + c, 0.5 + s, h * z0]], shade(bodyC, 0.74), 1, 0.55);
      }
    }
    if (glow !== null) {
      // A tripod tower to the lantern platform.
      const zt = h * 1.02;
      const foot = (a: number): [number, number, number] => [0.5 + Math.cos(a) * 0.09, 0.5 + Math.sin(a) * 0.09, zd - 0.004];
      const head = (a: number): [number, number, number] => [0.5 + Math.cos(a) * 0.03, 0.5 + Math.sin(a) * 0.03, zt];
      const legAt = [1.25 * Math.PI, 1.917 * Math.PI, 0.583 * Math.PI];
      k.line([foot(legAt[0]!), head(legAt[0]!)], darkC, 1.5, 0.95);
      if (!k.plan) {
        const zm = (zd + zt) / 2;
        const brace = legAt.map((a): [number, number, number] => [0.5 + Math.cos(a) * 0.06, 0.5 + Math.sin(a) * 0.06, zm]);
        k.line([...brace, brace[0]!], darkC, 1, 0.7);
      }
      for (const a of legAt.slice(1)) k.line([foot(a), head(a)], darkC, 1.5, 0.95);
      waterLathe(k, 0.5, 0.5, [[0.05, zt, darkC], [0.05, zt + h * 0.035, shade(t.dark, 1.05)]], 8);
      const zl = zt + h * 0.035;
      const zh = zl + h * 0.1;
      // The lens, lit, then its hood.
      k.poly([...waterCircle(0.5, 0.5, 0.027, zl, 6, -Math.PI / 4, (Math.PI * 3) / 4), ...waterCircle(0.5, 0.5, 0.027, zh, 6, (Math.PI * 3) / 4, (Math.PI * 7) / 4)], glow, 1);
      if (!k.plan) waterLathe(k, 0.5, 0.5, [[0.031, zh, darkC], [0.012, zh + h * 0.045, darkC]], 6);
      return k.pool(0.5, 0.5, 0.3);
    }
    // A mooring buoy: a spar with a can topmark, a shackle eye and the pickup line trailing on the water.
    const ROPE = 0x9c8a62;
    const ang = (0.02 + k.rnd(31) * 0.46) * Math.PI;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const px = -sa;
    const py = ca;
    const bend = (k.rnd(32) - 0.5) * 0.08;
    const line: Array<[number, number, number]> = [
      [0.5 + ca * 0.07, 0.5 + sa * 0.07, zd + 0.004],
      [0.5 + ca * (R * 0.98), 0.5 + sa * (R * 0.98), h * 0.3],
      [0.5 + ca * (R * 1.22), 0.5 + sa * (R * 1.22), 0.002],
      [0.5 + ca * 0.27 + px * bend, 0.5 + sa * 0.27 + py * bend, 0.002],
      [0.5 + ca * 0.33 + px * bend * 0.4, 0.5 + sa * 0.33 + py * bend * 0.4, 0.002],
    ];
    k.line([[0.5, 0.5, zd], [0.5, 0.5, h * 0.8]], darkC, 2.5, 1);
    waterLathe(k, 0.5, 0.5, [[0.042, h * 0.8, bodyC], [0.042, h * 0.94, shade(t.dark, 1.02)]], 8);
    waterRing(k, 'u', 0.5 + sa * 0.07, zd + 0.024, 0.02, 0.02, 0.5 + ca * 0.07, 0, Math.PI * 2, darkC, 0.9, 1.5);
    k.line(line, shade(ROPE, 0.5), 2.4, 0.7);
    k.line(line, shade(ROPE, 0.82), 1.2, 1);
    const end = line[line.length - 1]!;
    k.disc(end[0], end[1], 0.026, 0.004, shade(t.light, 1.1), 1, true);
    return null;
  },
  cleat: (k, h) => {
    const t = k.t;
    const alongU = k.rnd(81) < 0.6;
    // The cast body is drawn a third over life size (the base still inside the footprint), so the
    // horned silhouette, not the rope on it, is what reads at table zoom; the coil keeps world size.
    const SC = 1.3;
    const M0 = (s: number, w: number, z: number): [number, number, number] => (alongU ? [0.5 + s, 0.5 + w, z] : [0.5 + w, 0.5 + s, z]);
    const M = (s: number, w: number, z: number): [number, number, number] => M0(s * SC, w * SC, z);
    const q = Math.min(1, h * 2);
    const zp = 0.03 * q;
    const zn = 0.11 * q;
    const zt = 0.2 * q;
    // Dark cast steel: 20+ value points under the planking, lit only on its tops.
    const metal = shade(t.dark, 0.64);
    const ROPE = 0x9c8a62;
    const ropeDark = shade(ROPE, 0.45);
    const ropeC = shade(ROPE, 0.92);
    const oct = (hs: number, hw: number, ch: number, z: number): Array<[number, number, number]> =>
      [[-hs + ch, -hw], [hs - ch, -hw], [hs, -hw + ch], [hs, hw - ch], [hs - ch, hw], [-hs + ch, hw], [-hs, hw - ch], [-hs, -hw + ch]].map(([s, w]) => M(s!, w!, z));
    // Base plate, bevelled, bolted down at both ends.
    waterSolid(k, waterPrism(oct(0.14, 0.068, 0.035, 0), oct(0.13, 0.06, 0.03, zp), shade(t.base, 0.9), shade(t.base, 0.96)), M(0, 0, zp / 2), true);
    for (const s of [-0.105, 0.105]) {
      const b = M(s, 0, zp);
      k.disc(b[0], b[1], 0.016, zp + 0.001, shade(t.ink, 0.85), 1);
    }
    // The waist, then the two horns rising to their tips.
    if (!k.plan) waterSolid(k, waterPrism(oct(0.075, 0.045, 0.02, zp), oct(0.045, 0.03, 0.012, zn), metal, metal), M(0, 0, (zp + zn) / 2), true);
    const topAt = (s: number) => zt + (0.014 * q * Math.abs(s)) / 0.19;
    for (const dir of [-1, 1]) {
      const sec = (s: number, hw: number, z0: number, z1: number): Array<[number, number, number]> => [M(s, -hw, z0), M(s, hw, z0), M(s, hw, z1), M(s, -hw, z1)];
      const A = sec(0, 0.036, zn, zt);
      const B = sec(dir * 0.19, 0.018, zt - 0.04 * q, zt + 0.014 * q);
      const faces: Array<{ p: Array<[number, number, number]>; c: number }> = [];
      for (let i = 0; i < 4; i += 1) faces.push({ p: [A[i]!, A[(i + 1) % 4]!, B[(i + 1) % 4]!, B[i]!], c: metal });
      faces.push({ p: A, c: metal });
      faces.push({ p: B, c: metal });
      waterSolid(k, faces, M(dir * 0.08, 0, (zn + zt) / 2), true);
    }
    k.line([M(-0.175, -0.008, topAt(0.175) + 0.001), M(0, -0.008, zt + 0.001), M(0.175, -0.008, topAt(0.175) + 0.001)], shade(t.light, 1.2), 1, 0.7);
    // Rope: made fast in a figure of eight, the tail flaked down in a coil — or a line just dropped over a horn.
    // A secondary accent: thinner and a shade down from the steel's lit edge, so it never outdraws the cleat.
    const wrapped = k.rnd(82) < 0.7;
    const coilS = (k.rnd(83) - 0.5) * 0.12;
    const coil: Array<[number, number, number]> = [];
    const a0 = k.rnd(84) * Math.PI * 2;
    for (let i = 0; i <= 22; i += 1) {
      const f = i / 22;
      const a = a0 + f * Math.PI * 2 * 1.75;
      const r = 0.052 - f * 0.03;
      coil.push(M0(coilS + Math.cos(a) * r, 0.125 + Math.sin(a) * r, 0.003));
    }
    if (wrapped) {
      for (const d of [1, -1]) {
        const path = [M(-0.125 * d, 0.056, zn - 0.01 * q), M(-0.125 * d, 0.04, topAt(0.125) + 0.01 * q), M(0.125 * d, -0.04, topAt(0.125) + 0.01 * q)];
        k.line(path, ropeDark, 1.9, 0.75);
        k.line(path, ropeC, 1.1, 1);
      }
      const lead = [M(-0.125, 0.056, zn - 0.01 * q), M0(-0.17, 0.09, 0.02 * q), ...coil];
      k.line(lead, ropeDark, 1.8, 0.6);
      k.line(lead, ropeC, 1, 1);
    } else {
      const lead = [M(0.15, -0.03, topAt(0.15) + 0.01 * q), M(0.15, 0.045, topAt(0.15) + 0.008 * q), M(0.15, 0.06, zn - 0.01 * q), M0(0.18, 0.1, 0.015 * q), ...coil];
      k.line(lead, ropeDark, 1.8, 0.6);
      k.line(lead, ropeC, 1, 1);
    }
    return null;
  },

  // --- country -------------------------------------------------------------
  haybale: (k, h) => {
    const t = k.t;
    const alongU = k.rnd(71) < 0.55;
    const ax: 'u' | 'v' = alongU ? 'u' : 'v';
    const W = (a: number, x: number, z: number): [number, number, number] => (alongU ? [a, x, z] : [x, a, z]);
    const asp = waterAspect(k);
    const r = Math.min(0.27, 0.1 + h * 0.34);
    const a0 = alongU ? 0.16 : 0.21;
    const a1 = alongU ? 0.84 : 0.79;
    const rz = r * asp;
    const zc = rz * 0.97;
    const age = 0.93 + k.rnd(72) * 0.1;
    const straw = shade(t.base, age);
    const lightC = shade(t.light, 1.08);
    const twine = shade(t.dark, 0.84);
    const bands = k.rnd(73) < 0.4 ? 4 : 3;
    // Loose straw spilled round the foot of the bale.
    const spill: Array<[number, number, number]> = [];
    for (let i = 0; i < 9; i += 1) {
      const f = i / 8;
      spill.push(W(a0 + 0.06 + (a1 + 0.03 - a0) * f, 0.5 + r * (0.98 + (i % 2 === 0 ? 0.2 : 0.06) * (0.5 + k.rnd(76 + i))), 0.002));
    }
    spill.push(W(a1 + 0.07, 0.5 - r * 0.2, 0.002), W(a1 - 0.02, 0.5 - r * 0.4, 0.002), W(a0 + 0.1, 0.5 + r * 0.6, 0.002));
    k.poly(spill, lightC, 0.22);
    if (k.plan) {
      waterRoll(k, ax, 0.5, zc, r, a0, a1, straw, straw, 16, 1);
      // The curve of the roll: shaded flanks, a lit crown.
      k.poly([W(a0, 0.5 - r, 0), W(a1, 0.5 - r, 0), W(a1, 0.5 - r * 0.45, 0), W(a0, 0.5 - r * 0.45, 0)], shade(t.ink, 0.9), 0.3);
      k.poly([W(a0, 0.5 + r * 0.6, 0), W(a1, 0.5 + r * 0.6, 0), W(a1, 0.5 + r, 0), W(a0, 0.5 + r, 0)], shade(t.ink, 0.9), 0.18);
      k.poly([W(a0, 0.5 - r * 0.2, 0), W(a1, 0.5 - r * 0.2, 0), W(a1, 0.5 + r * 0.15, 0), W(a0, 0.5 + r * 0.15, 0)], lightC, 0.35);
      for (let i = 0; i < bands; i += 1) {
        const a = a0 + ((a1 - a0) * (i + 0.5)) / bands;
        k.line([W(a, 0.5 - r * 0.97, 0), W(a + 0.012, 0.5, 0), W(a, 0.5 + r * 0.97, 0)], twine, 1, 0.6);
      }
      // Straw fraying off both rolled ends.
      for (const [e, d] of [[a0, -1], [a1, 1]] as const) {
        const fr: Array<[number, number, number]> = [];
        for (let i = 0; i <= 8; i += 1) fr.push(W(e + d * (i % 2 === 0 ? 0.004 : 0.022), 0.5 - r * 0.9 + (r * 1.8 * i) / 8, 0));
        k.line(fr, lightC, 1, 0.55);
      }
    } else {
      waterRoll(k, ax, 0.5, zc, r, a0, a1, straw, shade(t.base, age * 0.9), 16, 0.95);
      // Twine bands round the roll.
      for (let i = 0; i < bands; i += 1) {
        const a = a0 + ((a1 - a0) * (i + 0.5)) / bands;
        waterRing(k, ax, 0.5, zc, r * 1.01, r * 1.01, a, -Math.PI * 0.22, Math.PI * 0.72, twine, 0.7, 1);
      }
      // The rolled end: a spiral of layers round a hollow core, straw fraying off its rim.
      const ph = k.rnd(74) * Math.PI * 2;
      // Tier 2: the layers are a material pattern on the shaded end, kept near its tone, not a pale target.
      waterRing(k, ax, 0.5, zc, r * 0.1, r * 0.86, a1 + 0.003, ph, ph + Math.PI * 5, shade(t.base, 0.98), 0.5, 1);
      if (alongU) k.faceCircle(a1 + 0.004, 0.5, zc, rz * 0.1, 'v', shade(t.ink, 0.85), 0.8);
      else k.faceCircle(0.5, a1 + 0.004, zc, rz * 0.1, 'u', shade(t.ink, 0.85), 0.8);
      const fray: Array<[number, number, number]> = [];
      for (let i = 0; i <= 12; i += 1) {
        const th = Math.PI * (0.15 + (1.05 * i) / 12);
        const rr = r * (i % 2 === 0 ? 0.97 : 1.07);
        fray.push(W(a1 + 0.004, 0.5 + Math.cos(th) * rr, zc + Math.sin(th) * rr * asp));
      }
      k.line(fray, lightC, 1, 0.5);
    }
    if (k.rnd(75) < 0.22) {
      // A pitchfork left stuck in the top: a pale turned-ash handle in an ink edge, a steel socket where it
      // goes in. (A lone dark line out of a banded roll read as a branch out of a log.)
      const top = zc + rz;
      const handle = [W(a0 + 0.3, 0.47, top - 0.02), W(a0 + 0.14, 0.62, top + 0.26)];
      k.line(handle, shade(t.ink, 0.8), 2.8, 0.85);
      k.line(handle, 0x9a8766, 1.4, 1);
      k.line([W(a0 + 0.3, 0.47, top - 0.02), W(a0 + 0.285, 0.484, top + 0.005)], 0x8d9092, 2, 1);
    }
    return null;
  },
  tractor: (k, h) => {
    const t = k.t;
    const east = k.rnd(51) < 0.5;
    const cabbed = k.rnd(52) < 0.65;
    const U = (s: number) => (east ? 0.12 + 0.76 * s : 0.88 - 0.76 * s);
    const asp = waterAspect(k);
    const lift = 0.8 + 0.4 * h;
    const paint = t.base;
    const tyreC = shade(t.ink, 0.6);
    const wallC = shade(t.ink, 0.74);
    const rimC = shade(t.light, 1.1);
    const metal = shade(t.ink, 0.78);
    const roofC = shade(t.light, 1.05);
    const rr = 0.16;
    const rf = 0.095;
    const sRear = 0.2;
    const sFront = 0.83;
    const wheel = (s: number, va: number, vb: number, r: number, near: boolean) => {
      const u = U(s);
      const zc = r * asp;
      waterRoll(k, 'v', u, zc, r, va, vb, tyreC, wallC, near ? 14 : 10, 0.78);
      if (k.plan || !near) return;
      k.faceCircle(u, vb + 0.002, zc, zc * 0.6, 'u', rimC);
      waterRing(k, 'v', u, zc, r * 0.38, r * 0.38, vb + 0.003, 0, Math.PI * 2, shade(rimC, 0.72), 0.8, 1);
      k.faceCircle(u, vb + 0.004, zc, zc * 0.17, 'u', shade(t.ink, 0.9));
    };
    const fender = (s: number, va: number, vb: number, r: number) => {
      const u = U(s);
      const zc = r * asp;
      const Rf = r * 1.15;
      if (k.plan) {
        k.poly([[u - Rf * 0.55, va, zc + Rf], [u + Rf * 0.55, va, zc + Rf], [u + Rf * 0.55, vb, zc + Rf], [u - Rf * 0.55, vb, zc + Rf]], paint, 1, true);
        return;
      }
      const arc: Array<[number, number]> = [];
      for (let i = 0; i <= 6; i += 1) {
        const th = Math.PI * (0.1 + (0.8 * i) / 6);
        arc.push([Math.cos(th) * Rf, zc + Math.sin(th) * Rf * asp]);
      }
      for (let i = 0; i < 6; i += 1) {
        const a = arc[i]!;
        const b = arc[i + 1]!;
        waterFace(k, [[u + a[0], va, a[1]], [u + b[0], va, b[1]], [u + b[0], vb, b[1]], [u + a[0], vb, a[1]]], [u, (va + vb) / 2, zc], paint, 1);
      }
      const lip: Array<[number, number, number]> = [...arc.map(([x, z]): [number, number, number] => [u + x, vb, z]), ...[...arc].reverse().map(([x, z]): [number, number, number] => [u + x * 0.86, vb, zc + (z - zc) * 0.86])];
      waterFace(k, lip, [u, va, zc], shade(paint, 0.96), 1);
      k.line(arc.map(([x, z]): [number, number, number] => [u + x, va, z]), t.ink, 1, 0.5);
      k.line(lip, t.ink, 1, 0.5);
    };
    const hood = () => {
      const s0 = 0.4;
      const s1 = 0.99;
      const drop = (s: number) => (0.02 * (s - s0)) / (s1 - s0);
      const sec: Array<[number, number]> = [[-0.12, 0.19], [0.12, 0.19], [0.12, 0.29], [0.075, 0.335], [-0.075, 0.335], [-0.12, 0.29]];
      const A = sec.map(([x, z]): [number, number, number] => [U(s0), 0.5 + x, z]);
      const B = sec.map(([x, z]): [number, number, number] => [U(s1), 0.5 + x, z > 0.2 ? z - drop(s1) : z]);
      waterSolid(k, waterPrism(A, B, paint, paint), [U((s0 + s1) / 2), 0.5, 0.26], true);
      if (!k.plan) {
        // Side decal stripe and the louvred vent.
        k.line([[U(0.43), 0.621, 0.27], [U(0.97), 0.621, 0.27 - drop(0.97)]], shade(t.light, 1.1), 1, 0.55);
        k.poly([[U(0.78), 0.621, 0.21], [U(0.93), 0.621, 0.21], [U(0.93), 0.621, 0.25 - drop(0.93)], [U(0.78), 0.621, 0.25 - drop(0.78)]], shade(paint, 0.68), 0.9);
        if (east) {
          // Grille and headlamps on the nose.
          const un = U(s1) + 0.003;
          k.poly([[un, 0.425, 0.2], [un, 0.575, 0.2], [un, 0.56, 0.262], [un, 0.44, 0.262]], shade(t.ink, 0.7), 1);
          k.line([[un, 0.435, 0.222], [un, 0.565, 0.222]], shade(paint, 0.9), 1, 0.6);
          k.line([[un, 0.44, 0.242], [un, 0.56, 0.242]], shade(paint, 0.9), 1, 0.6);
          k.poly([[un, 0.385, 0.252], [un, 0.415, 0.252], [un, 0.415, 0.268], [un, 0.385, 0.268]], shade(t.light, 1.15), 1);
          k.poly([[un, 0.585, 0.252], [un, 0.615, 0.252], [un, 0.615, 0.268], [un, 0.585, 0.268]], shade(t.light, 1.15), 1);
        }
      }
      // Exhaust stack with its heat guard and rain flap; an air precleaner on some.
      const us = U(0.6);
      const zs = 0.36 + 0.55 * h;
      if (k.rnd(53) < 0.6) {
        const ui = U(0.72);
        k.line([[ui, 0.44, 0.33], [ui, 0.44, 0.43]], shade(t.dark, 0.9), 3, 1);
        k.disc(ui, 0.44, 0.022, 0.435, shade(t.light, 0.95), 1, true);
      }
      if (k.plan) {
        k.disc(us, 0.555, 0.018, zs, metal, 1);
      } else {
        k.line([[us, 0.555, 0.33], [us, 0.555, zs]], metal, 2.5, 1);
        k.line([[us, 0.555, 0.39], [us, 0.555, 0.5]], shade(t.dark, 1.02), 3.5, 1);
        k.line([[us, 0.555, zs], [us + (east ? -0.03 : 0.03), 0.555, zs + 0.02]], metal, 2, 1);
      }
      if (east && k.rnd(54) < 0.5) k.box(U(0.985), 0.42, U(1.03), 0.58, 0.1, 0.2, metal, { crown: false });
    };
    const cab = () => {
      const u0 = Math.min(U(0.04), U(0.4));
      const u1 = Math.max(U(0.04), U(0.4));
      const v0 = 0.335;
      const v1 = 0.665;
      const zg = 0.33;
      const zr = 0.6 * lift;
      if (!k.plan) k.box(u0, v0, u1, v1, 0.2, zg, paint, { crown: false });
      const uFront = east ? u1 : u0;
      const uRear = east ? u0 : u1;
      if (cabbed) {
        if (!k.plan) {
          const dark = shade(t.ink, 0.58);
          k.facePanel('u', v1, u0, zg, u1, zr, dark);
          k.facePanel('v', u1, v0, zg, v1, zr, dark);
          // Seat back and wheel seen through the side glass.
          const us0 = U(0.09);
          const us1 = U(0.17);
          k.facePanel('u', v1 - 0.001, Math.min(us0, us1), zg, Math.max(us0, us1), zg + 0.13, shade(t.ink, 0.95));
          k.line([[U(0.33), v1 - 0.001, zg + 0.07], [U(0.27), v1 - 0.001, zg + 0.11]], shade(t.ink, 1.05), 1.5, 1);
          k.facePanel('u', v1 + 0.001, u0, zg, u1, zr, GLASS, 0.26);
          k.facePanel('v', u1 + 0.001, v0, zg, v1, zr, GLASS, 0.3);
          k.poly([[u0 + 0.03, v1 + 0.002, zr - 0.02], [u0 + 0.09, v1 + 0.002, zr - 0.02], [u0 + 0.05, v1 + 0.002, zg + 0.03], [u0 + 0.01, v1 + 0.002, zg + 0.03]], GLASS, 0.22);
          const pillar = shade(paint, 0.92);
          k.line([[u0, v1 + 0.002, zg], [u0, v1 + 0.002, zr], [u1, v1 + 0.002, zr], [u1, v1 + 0.002, zg]], pillar, 1.5, 1);
          k.line([[u1 + 0.002, v0, zg], [u1 + 0.002, v0, zr]], pillar, 1.5, 1);
          k.line([[(u0 + u1) / 2 + (east ? 0.03 : -0.03), v1 + 0.002, zg], [(u0 + u1) / 2 + (east ? 0.03 : -0.03), v1 + 0.002, zr]], pillar, 1, 0.9);
        }
      } else {
        // Open station: a two-post roll bar, the seat and the wheel under a canopy.
        const ub = U(0.06);
        if (!k.plan) {
          k.line([[ub, v0 + 0.03, zg], [ub, v0 + 0.03, zr]], shade(t.dark, 0.9), 2, 1);
          k.box(Math.min(U(0.1), U(0.2)), 0.44, Math.max(U(0.1), U(0.2)), 0.56, zg, zg + 0.05, shade(t.ink, 0.95), { crown: false });
          k.line([[U(0.11), 0.5, zg + 0.05], [U(0.1), 0.5, zg + 0.16]], shade(t.ink, 0.95), 4, 1);
          k.line([[U(0.36), 0.5, zg], [U(0.3), 0.5, zg + 0.14]], metal, 1.5, 1);
          k.line([...waterCircle(U(0.3), 0.5, 0.04, zg + 0.14, 8, 0, Math.PI * 2), [U(0.3) + 0.04, 0.5, zg + 0.14]], metal, 1.5, 1);
          k.line([[ub, v1 - 0.03, zg], [ub, v1 - 0.03, zr]], shade(t.dark, 0.9), 2, 1);
        }
      }
      k.box(u0 - 0.02, v0 - 0.02, u1 + 0.02, v1 + 0.02, zr, zr + 0.045, roofC);
      // Beacon on the rear corner of the roof.
      const ubk = uRear + (east ? 0.05 : -0.05);
      if (k.plan) k.disc(ubk, v1 - 0.05, 0.02, zr + 0.05, shade(t.ink, 0.9), 1);
      else {
        k.line([[ubk, v1 - 0.05, zr + 0.045], [ubk, v1 - 0.05, zr + 0.07]], shade(t.ink, 0.9), 3, 1);
        k.line([[ubk, v1 - 0.05, zr + 0.066], [ubk, v1 - 0.05, zr + 0.076]], 0x9a7a44, 2, 1);
      }
      return uFront;
    };

    // Far wheels, the axle and sump, then the body back to front as the eye meets it, then the near wheels.
    const far: Array<[number, () => void]> = [
      [U(sRear), () => wheel(sRear, 0.15, 0.28, rr, false)],
      [U(sFront), () => wheel(sFront, 0.27, 0.34, rf, false)],
    ];
    far.sort((a, b) => a[0] - b[0]);
    for (const [, f] of far) f();
    if (k.plan) fender(sRear, 0.13, 0.3, rr);
    if (!k.plan) {
      k.line([[U(sFront), 0.32, rf * asp], [U(sFront), 0.68, rf * asp]], metal, 2.5, 1);
      k.box(Math.min(U(0.3), U(0.95)), 0.43, Math.max(U(0.3), U(0.95)), 0.57, 0.06, 0.19, metal, { crown: false });
    }
    let uFront = 0;
    if (east) {
      uFront = cab();
      hood();
    } else {
      hood();
      uFront = cab();
    }
    if (!east) {
      // Three-point linkage at the back.
      k.line([[U(0.1), 0.42, 0.16], [U(-0.06), 0.4, 0.1]], metal, 2, 1);
      k.line([[U(0.1), 0.58, 0.16], [U(-0.06), 0.6, 0.1]], metal, 2, 1);
      k.line([[U(0.04), 0.5, 0.3], [U(-0.05), 0.5, 0.2]], metal, 2, 1);
    }
    if (!k.plan && cabbed) {
      const zr = 0.6 * lift;
      k.line([[uFront, 0.667, zr - 0.07], [uFront, 0.725, zr - 0.09]], metal, 1, 1);
      k.line([[uFront, 0.725, zr - 0.07], [uFront, 0.725, zr - 0.14]], metal, 2.5, 1);
    }
    const near: Array<[number, () => void]> = [
      [U(sRear), () => {
        wheel(sRear, 0.72, 0.85, rr, true);
        fender(sRear, 0.7, 0.87, rr);
      }],
      [U(sFront), () => wheel(sFront, 0.66, 0.73, rf, true)],
    ];
    near.sort((a, b) => a[0] - b[0]);
    for (const [, f] of near) f();
    return null;
  },
  well: (k, h) => {
    type P = readonly [number, number, number];
    const t = k.t;
    const wood = civicMix(t.dark, 0x6b5440, 0.55);
    const roof = civicMix(t.dark, 0x584638, 0.5);
    const iron = civicMix(t.ink, 0x8a8a86, 0.45);
    const R = 0.3;
    const zw = h * 0.6;
    const zc = h * 0.7;
    const sides = 14;
    const ring = (r: number, z: number, from = 0, to = sides): P[] => {
      const out: P[] = [];
      for (let i = from; i <= to; i += 1) {
        const a = (i / sides) * Math.PI * 2;
        out.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, z]);
      }
      return out;
    };
    if (!k.plan) {
      // The wall: faceted so it turns, laid in courses of dressed stone.
      const lo = ring(R, 0);
      const hi = ring(R * 0.98, zw);
      for (let i = 0; i < sides; i += 1) civicFacet(k, [lo[i]!, lo[i + 1]!, hi[i + 1]!, hi[i]!], t.base);
      const courses: P[][] = [];
      for (const f of [1 / 3, 2 / 3]) {
        const row: P[] = [];
        for (let i = -2; i <= 6; i += 1) {
          const a = (i / sides) * Math.PI * 2 - 0.1;
          row.push([0.5 + Math.cos(a) * R * 0.995, 0.5 + Math.sin(a) * R * 0.995, zw * f]);
        }
        courses.push(row);
      }
      for (let i = -2; i <= 6; i += 1) {
        for (let band = 0; band < 3; band += 1) {
          const a = ((i + 0.3 + (band % 2) * 0.5) / sides) * Math.PI * 2;
          if (Math.cos(a) + Math.sin(a) < 0.15) continue;
          const c = Math.cos(a) * R;
          const s = Math.sin(a) * R;
          courses.push([[0.5 + c, 0.5 + s, zw * (band / 3) + 0.004], [0.5 + c, 0.5 + s, zw * ((band + 1) / 3) - 0.004]]);
        }
      }
      civicSegs(k, courses, shade(t.base, 0.6), 1, 0.45);
      // A few paler blocks, so it was built stone by stone.
      const blocks: P[][] = [];
      for (let i = 0; i < 3; i += 1) {
        const a0 = (-0.15 + k.rnd(30 + i) * 0.75) * Math.PI;
        const a1 = a0 + (Math.PI * 2) / sides;
        const band = Math.floor(k.rnd(40 + i) * 3);
        const z0 = (zw * band) / 3 + 0.006;
        const z1 = (zw * (band + 1)) / 3 - 0.006;
        const rr = R * 0.995;
        blocks.push([[0.5 + Math.cos(a0) * rr, 0.5 + Math.sin(a0) * rr, z0], [0.5 + Math.cos(a1) * rr, 0.5 + Math.sin(a1) * rr, z0], [0.5 + Math.cos(a1) * rr, 0.5 + Math.sin(a1) * rr, z1], [0.5 + Math.cos(a0) * rr, 0.5 + Math.sin(a0) * rr, z1]]);
      }
      civicPolys(k, blocks, t.light, 0.16);
      if (k.rnd(5) < 0.65) {
        const tufts: P[][] = [];
        for (let i = 0; i < 5; i += 1) {
          const a = (k.rnd(6 + i) * 1.1 - 0.2) * Math.PI;
          const c = 0.5 + Math.cos(a) * (R + 0.015);
          const s = 0.5 + Math.sin(a) * (R + 0.015);
          tufts.push([[c - 0.02, s, h * 0.07], [c, s, 0], [c + 0.004, s, h * 0.12], [c, s, 0], [c + 0.025, s - 0.005, h * 0.08]]);
        }
        civicSegs(k, tufts, FOLIAGE, 1, 0.8);
      }
    }
    // Coping stones, then the dark water with the sky in it.
    const cr = 0.33;
    if (!k.plan) k.poly([...ring(cr, zc, -2, 6), ...ring(cr, zw, -2, 6).reverse()], shade(t.accent, 0.74));
    k.poly(ring(cr, zc, 0, sides - 1), shade(t.accent, k.plan ? 1.08 : 0.95));
    if (!k.plan) {
      k.line(ring(cr, zc, -2, 6), shade(t.accent, 1.35), 1, 0.45);
      civicSegs(k, [0, 3, 6, 9, 12].map((i) => { const a = ((i + k.rnd(7)) / sides) * Math.PI * 2; return [[0.5 + Math.cos(a) * 0.22, 0.5 + Math.sin(a) * 0.22, zc], [0.5 + Math.cos(a) * cr, 0.5 + Math.sin(a) * cr, zc]] as P[]; }), shade(t.accent, 0.6), 1, 0.4);
    }
    const hole = 0.215;
    k.disc(0.5, 0.5, hole, zc, civicMix(t.ink, 0x1c2224, 0.6), 1, true);
    if (!k.plan) {
      const inner: P[] = [];
      for (let i = 0; i <= 8; i += 1) {
        const a = Math.PI * 0.75 + (i / 8) * Math.PI;
        inner.push([0.5 + Math.cos(a) * hole, 0.5 + Math.sin(a) * hole, zc]);
      }
      for (let i = 8; i >= 0; i -= 1) {
        const a = Math.PI * 0.75 + (i / 8) * Math.PI;
        inner.push([0.5 + Math.cos(a) * hole, 0.5 + Math.sin(a) * hole, zc - h * 0.3 * Math.sin((i / 8) * Math.PI)]);
      }
      k.poly(inner, shade(t.base, 0.5), 1);
    }
    k.disc(0.54, 0.57, 0.075, zc, civicMix(GLASS, t.ink, 0.5), 0.35);
    // A steep gable on two posts, open at the ends, ridge along the windlass.
    const u0 = 0.13;
    const u1 = 0.87;
    const v0 = 0.23;
    const v1 = 0.77;
    const ze = h * 1.5;
    const zr = h * 2.15;
    const th = h * 0.055;
    const za = h * 1.1;
    const bucketUp = k.rnd(9) < 0.5;
    if (k.plan) {
      // Overhead, the roof is dashed like any plan's overhead line; posts, axle and bucket below it.
      for (const u of [0.22, 0.78]) k.poly([[u - 0.028, 0.472, 0], [u + 0.028, 0.472, 0], [u + 0.028, 0.528, 0], [u - 0.028, 0.528, 0]], wood, 1, true);
      civicSegs(k, [[[0.22, 0.5, 0], [0.86, 0.5, 0]]], shade(wood, 0.85), 2, 1);
      if (bucketUp) k.disc(0.5, 0.5, 0.045, 0, shade(wood, 0.6), 1, true);
      else k.disc(0.66, 0.74, 0.045, 0, shade(wood, 0.6), 1, true);
      const dash: P[][] = [];
      const run = (a: P, b: P) => {
        for (let i = 0; i < 6; i += 1) {
          const f0 = i / 6 + 0.02;
          const f1 = (i + 0.55) / 6;
          dash.push([[a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0, 0], [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1, 0]]);
        }
      };
      run([u0, v0, 0], [u1, v0, 0]);
      run([u1, v0, 0], [u1, v1, 0]);
      run([u1, v1, 0], [u0, v1, 0]);
      run([u0, v1, 0], [u0, v0, 0]);
      run([u0, 0.5, 0], [u1, 0.5, 0]);
      civicSegs(k, dash, shade(roof, 0.75), 1, 0.8);
      return null;
    }
    // Seen through the open east gable: the roof's shadowed underside.
    k.poly([[u1, v0 + 0.02, ze - th], [u1, v1 - 0.02, ze - th], [u1, 0.5, zr - th * 1.6]], shade(roof, 0.42));
    const post = (u: number) => {
      const s = 0.026;
      k.facePanel('u', 0.5 + s, u - s, zc, u + s, zr - th, shade(wood, 0.8));
      k.facePanel('v', u + s, 0.5 - s, zc, 0.5 + s, zr - th, shade(wood, 0.66));
      k.line([[u + s, 0.5 + s, zc], [u + s, 0.5 + s, zr - th]], shade(wood, 1.3), 1, 0.35);
      k.line([[u - s, 0.5 + s, zc], [u - s, 0.5 + s, zr - th], [u + s, 0.5 + s, zr - th], [u + s, 0.5 - s, zr - th]], t.ink, 1, 0.4);
    };
    post(0.22);
    // The windlass: an axle wound with rope.
    civicSegs(k, [[[0.24, 0.5, za], [0.8, 0.5, za]]], shade(wood, 0.62), 4, 1);
    civicSegs(k, [[[0.24, 0.5, za + h * 0.012], [0.8, 0.5, za + h * 0.012]]], shade(wood, 1.05), 2, 1);
    civicSegs(k, [0.4, 0.44, 0.48, 0.52, 0.56].map((u): P[] => [[u, 0.5, za + h * 0.035], [u + 0.012, 0.5, za - h * 0.035]]), shade(t.light, 1.05), 2, 0.8);
    const bucket = (u: number, v: number, z: number) => {
      civicDrum(k, u, v, 0.05, z, z + h * 0.14, wood);
      k.band(u, v, 0.05, z + h * 0.1, iron, 0.9, 1);
      k.disc(u, v, 0.038, z + h * 0.14, shade(wood, 0.4), 1);
      k.line([[u - 0.05, v, z + h * 0.13], [u - 0.025, v, z + h * 0.22], [u + 0.025, v, z + h * 0.22], [u + 0.05, v, z + h * 0.13]], iron, 1, 0.85);
    };
    if (bucketUp) {
      k.line([[0.5, 0.5, za], [0.5, 0.5, h * 0.82]], shade(t.light, 1.1), 1, 0.75);
      bucket(0.5, 0.5, h * 0.6);
    } else {
      k.line([[0.52, 0.5, za], [0.56, 0.52, zc + h * 0.08], [0.62, 0.62, zc + 0.004], [0.64, 0.72, zc + 0.004]], shade(t.light, 1.1), 1, 0.7);
    }
    post(0.78);
    // The crank, worn bright where the hand goes.
    k.line([[0.8, 0.5, za], [0.85, 0.5, za], [0.85, 0.57, za - h * 0.12]], iron, 2, 1);
    k.line([[0.85, 0.57, za - h * 0.12], [0.9, 0.57, za - h * 0.12]], shade(wood, 1.05), 3, 1);
    if (!bucketUp) bucket(0.66, 0.74, zc);
    // Tie beam across the gable, then the south slope and its shingles.
    k.line([[u1 - 0.01, v0 + 0.04, ze - th], [u1 - 0.01, v1 - 0.04, ze - th]], shade(wood, 0.9), 2, 1);
    const S = (u: number, f: number): P => [u, v1 + (0.5 - v1) * f, ze + (zr - ze) * f];
    civicFacet(k, [S(u1, 0), S(u1, 1), S(u0, 1), S(u0, 0)], roof, 1, true);
    const shingles: P[][] = [];
    const rowsN = 4;
    for (let r = 1; r < rowsN; r += 1) shingles.push([S(u0 + 0.01, r / rowsN), S(u1 - 0.01, r / rowsN)]);
    for (let r = 0; r < rowsN; r += 1) {
      for (let j = 0; j < 6; j += 1) {
        const u = u0 + 0.07 + j * 0.125 + (r % 2) * 0.06;
        if (u > u1 - 0.03) continue;
        shingles.push([S(u, r / rowsN + 0.01), S(u, (r + 1) / rowsN - 0.01)]);
      }
    }
    civicSegs(k, shingles, shade(roof, 0.62), 1, 0.5);
    if (k.rnd(10) < 0.45) {
      civicPolys(k, [[S(u0 + 0.04, 0.02), S(u0 + 0.3, 0.02), S(u0 + 0.22, 0.3), S(u0 + 0.05, 0.24)]], FOLIAGE, 0.38);
    } else {
      // A slipped shingle: the dark batten behind it shows.
      const su = u0 + 0.2 + k.rnd(11) * 0.35;
      civicPolys(k, [[S(su, 0.27), S(su + 0.07, 0.29), S(su + 0.08, 0.44), S(su + 0.01, 0.42)]], shade(roof, 0.5), 0.7);
    }
    // Barge boards on the open gable, a fascia along the eave, the ridge cap.
    k.poly([[u1, v0, ze], [u1, 0.5, zr], [u1, 0.5, zr - th], [u1, v0, ze - th]], shade(wood, 0.78));
    k.poly([[u1, v1, ze], [u1, 0.5, zr], [u1, 0.5, zr - th], [u1, v1, ze - th]], shade(wood, 0.7));
    k.facePanel('u', v1, u0, ze - th, u1, ze, shade(wood, 0.72));
    k.line([[u0, v1, ze], [u1, v1, ze], [u1, 0.5, zr]], shade(roof, 1.35), 1, 0.45);
    k.line([[u0 - 0.005, 0.5, zr + h * 0.01], [u1 + 0.005, 0.5, zr + h * 0.01]], shade(roof, 1.25), 3, 1);
    civicOutline(k, [[u0, v1, ze - th], [u1, v1, ze - th], [u1, v0, ze - th], [u1, v0, ze], [u0, 0.5, zr], [u1, 0.5, zr], [u0, v1, ze]], 0.55);
    return null;
  },
  trough: (k, h) => {
    const t = k.t;
    const zb = h * 0.34;
    const zr = h * 0.76;
    const zw = zr - h * (0.06 + k.rnd(61) * 0.1);
    const wallC = t.base;
    const legC = shade(t.dark, 0.8);
    const WATER = 0x44616a;
    // Dark rubber with a green cast (S 19%, V 31%).
    const HOSE = 0x415046;
    // A long pressed-steel trough, wider at the rim than the floor, corners rolled.
    const ring = (u0: number, v0: number, u1: number, v1: number, c: number, z: number): Array<[number, number, number]> => [
      [u0 + c, v0, z], [u1 - c, v0, z], [u1, v0 + c, z], [u1, v1 - c, z], [u1 - c, v1, z], [u0 + c, v1, z], [u0, v1 - c, z], [u0, v0 + c, z],
    ];
    const rim = ring(0.1, 0.35, 0.9, 0.65, 0.03, zr);
    const bot = ring(0.13, 0.405, 0.87, 0.595, 0.02, zb);
    const at = (f: number, z: number, inset: number) => ring(0.1 + 0.03 * f + inset, 0.35 + 0.055 * f + inset, 0.9 - 0.03 * f - inset, 0.65 - 0.055 * f - inset, 0.03 - 0.01 * f, z);
    const hosed = k.rnd(62) < 0.5;
    // Where the hose runs over the rim the ground is wet.
    if (hosed) {
      const pud: Array<[number, number, number]> = [];
      const pu = 0.86;
      for (let i = 0; i < 9; i += 1) {
        const a = (i / 9) * Math.PI * 2;
        const j = 0.75 + k.rnd(64 + i) * 0.4;
        pud.push([pu + Math.cos(a) * 0.1 * j, 0.6 + Math.sin(a) * 0.07 * j, 0]);
      }
      k.poly(pud, shade(t.ink, 0.55), 0.3);
    }
    // The far legs, and a bucket turned over under the trough on some.
    if (!k.plan) {
      for (const u of [0.18, 0.82]) k.line([[u, 0.43, zb], [u - 0.012, 0.335, 0]], legC, 2.5, 1);
      if (k.rnd(65) < 0.4) waterLathe(k, 0.42 + k.rnd(66) * 0.16, 0.5, [[0.055, 0, shade(t.light, 1.02)], [0.042, h * 0.2, shade(t.light, 1.06)]], 8);
    }
    // Inside: the far wall standing over the water, the water with a sky streak and a leaf on it.
    if (k.plan) k.poly(rim, wallC, 1, true);
    k.poly(at(0, zr, 0.012), shade(t.dark, 0.66), 1);
    const f = (zr - zw) / (zr - zb);
    const water = at(f, zw, 0.012);
    k.poly(water, WATER, 0.95);
    const vw0 = 0.35 + 0.055 * f + 0.02;
    const vw1 = 0.65 - 0.055 * f - 0.02;
    const gu = 0.3 + k.rnd(67) * 0.3;
    k.poly([[gu, vw0, zw], [gu + 0.07, vw0, zw], [gu + 0.16, vw1, zw], [gu + 0.09, vw1, zw]], GLASS, 0.2);
    if (!k.plan) k.line([...water, water[0]!], shade(WATER, 1.45), 1, 0.4);
    if (k.rnd(68) < 0.55) {
      const lu = 0.2 + k.rnd(69) * 0.6;
      const lv = 0.47 + k.rnd(70) * 0.06;
      k.poly([[lu - 0.024, lv, zw], [lu, lv - 0.013, zw], [lu + 0.026, lv + 0.003, zw], [lu, lv + 0.014, zw]], shade(FOLIAGE, 0.95), 0.9);
    }
    if (!k.plan) {
      // The outer walls, pressed stiffener ribs down the long side, a rolled lip.
      const faces: Array<{ p: Array<[number, number, number]>; c: number }> = [];
      for (let i = 0; i < rim.length; i += 1) {
        const j = (i + 1) % rim.length;
        faces.push({ p: [rim[i]!, rim[j]!, bot[j]!, bot[i]!], c: wallC });
      }
      faces.push({ p: [...bot].reverse(), c: wallC });
      waterSolid(k, faces, [0.5, 0.5, (zb + zr) / 2], true);
      for (const u of [0.3, 0.5, 0.7]) {
        k.line([[u + 0.006, 0.597, zb + 0.02], [u + 0.006, 0.652, zr - 0.03]], shade(wallC, 0.82), 1, 0.4);
        k.line([[u, 0.597, zb + 0.02], [u, 0.652, zr - 0.03]], shade(wallC, 1.14), 1, 0.4);
      }
      k.line([[0.9, 0.38, zr - 0.035], [0.9, 0.62, zr - 0.035]], shade(wallC, 0.8), 1, 0.45);
      k.faceCircle(0.883, 0.5, zb + 0.04, 0.018, 'v', shade(t.ink, 0.8), 0.9);
    }
    const lip = ring(0.105, 0.355, 0.895, 0.645, 0.026, zr + 0.002);
    k.line([...lip, lip[0]!], shade(t.light, 1.12), 1.5, 0.8);
    if (!k.plan) {
      // Near legs, splayed, tied by a stretcher.
      for (const u of [0.18, 0.82]) k.line([[u, 0.57, zb], [u - 0.012, 0.665, 0]], legC, 2.5, 1);
      k.line([[0.175, 0.625, h * 0.13], [0.815, 0.625, h * 0.13]], legC, 1.5, 1);
    }
    // A hose over the end, running off across the ground. (Hung down the long front wall, a dark hose
    // read as a strap buckled round the trough, so it only ever comes over the end.)
    if (hosed) {
      const hose: Array<[number, number, number]> = [[0.84, 0.52, zw + 0.01], [0.89, 0.53, zr + 0.02], [0.925, 0.545, zr - 0.03], [0.945, 0.56, h * 0.3], [0.95, 0.58, 0.004], [0.935, 0.7, 0.004], [0.88, 0.78, 0.004], [0.8, 0.8, 0.004], [0.74, 0.85, 0.004]];
      k.line(hose, HOSE, 2.2, 1);
      k.line(hose.slice(0, 4), shade(HOSE, 1.45), 1, 0.5);
    }
    return null;
  },
  logs: (k, h) => {
    const t = k.t;
    const asp = waterAspect(k);
    const barkC = shade(t.dark, 0.9);
    const endC = shade(t.light, 1.14);
    const heartC = shade(t.light, 0.97);
    const ridgeC = shade(t.base, 1.12);
    const r = Math.min(0.072, 0.03 + h * 0.084);
    const rz = r * asp;
    const va = 0.31;
    const vb = 0.75;
    const stakes = k.rnd(91) < 0.55;
    const axe = k.rnd(92) < 0.4;
    const gap = k.rnd(93) < 0.3 ? Math.floor(k.rnd(94) * 3) : -1;
    const lift = stakes ? 0 : 0.03;
    const pitch = 2 * r * 1.03;
    const logs: Array<{ u: number; z: number; row: number; exposed: boolean; salt: number }> = [];
    for (const [row, n] of [[0, 5], [1, 4], [2, 3]] as const) {
      for (let i = 0; i < n; i += 1) {
        if (row === 2 && i === gap) continue;
        logs.push({ u: 0.5 + (i - (n - 1) / 2) * pitch, z: lift + rz * (1 + 1.71 * row), row, exposed: row === 2 || i === n - 1, salt: 200 + row * 10 + i * 7 });
      }
    }
    const topZ = lift + rz * (2 + 1.71 * 2);
    const stake = (u: number, v: number, lean: number) => {
      if (k.plan) k.disc(u + lean, v, 0.016, topZ, shade(t.ink, 0.9), 1);
      else k.line([[u, v, 0], [u + lean, v, topZ - 0.02]], shade(t.ink, 0.9), 2.5, 1);
    };
    if (stakes) {
      stake(0.105, 0.36, -0.015);
      stake(0.105, 0.7, -0.015);
    } else {
      for (const v of [0.36, 0.7]) k.box(0.1, v - 0.022, 0.9, v + 0.022, 0, lift, shade(t.ink, 0.9), { crown: false });
    }
    if (k.plan) {
      // From above: the rows below as bands, the top logs whole, their sawn ends catching the eye.
      for (const row of [0, 1]) {
        const us = logs.filter((L) => L.row === row).map((L) => L.u);
        k.poly([[Math.min(...us) - r, va, 0], [Math.max(...us) + r, va, 0], [Math.max(...us) + r, vb, 0], [Math.min(...us) - r, vb, 0]], shade(barkC, 0.9 + row * 0.1), 1, true);
      }
    }
    for (const L of logs) {
      const rr = r * (0.92 + k.rnd(L.salt) * 0.1);
      const rrz = rr * asp;
      const b = vb + (k.rnd(L.salt + 1) - 0.5) * 0.04;
      const a = va + k.rnd(L.salt + 2) * 0.03;
      if (k.plan) {
        if (L.row < 2) continue;
        k.poly([[L.u - rr, a, 0], [L.u + rr, a, 0], [L.u + rr, b, 0], [L.u - rr, b, 0]], shade(barkC, 1.12), 1, true);
        k.line([[L.u + rr * 0.35, a + 0.03, 0], [L.u + rr * 0.35, b - 0.04, 0]], ridgeC, 1, 0.6);
        k.disc(L.u, b - rr * 0.45, rr * 0.62, 0, endC, 1);
        continue;
      }
      const ring = (v: number): Array<[number, number, number]> => waterCircle(0, 0, 1, 0, 12, 0, Math.PI * 2).map(([x, y]): [number, number, number] => [L.u + x * rr, v, L.z + y * rrz]);
      k.poly(waterHull(k, [...ring(a), ...ring(b)]), barkC, 1, true);
      if (L.exposed) k.line([[L.u + rr * 0.45, a + 0.02, L.z + rrz * 0.88], [L.u + rr * 0.45, b - 0.01, L.z + rrz * 0.88]], ridgeC, 1, 0.6);
      k.faceCircle(L.u, b + 0.001, L.z, rrz * 0.84, 'u', endC);
      k.faceCircle(L.u - rr * 0.06, b + 0.002, L.z + rrz * 0.05, rrz * 0.42, 'u', heartC);
      if (k.rnd(L.salt + 3) < 0.28) {
        const ang = k.rnd(L.salt + 4) * Math.PI * 2;
        k.line([[L.u, b + 0.003, L.z], [L.u + Math.cos(ang) * rr * 0.8, b + 0.003, L.z + Math.sin(ang) * rrz * 0.8]], barkC, 1, 0.7);
      }
    }
    if (stakes) {
      stake(0.895, 0.36, 0.015);
      stake(0.895, 0.7, 0.015);
    }
    if (axe) {
      // An axe left bitten into a log on top.
      const top = logs.filter((L) => L.row === 2);
      const L = top[Math.floor(k.rnd(95) * top.length)]!;
      const zt = L.z + rz;
      const hv = 0.6;
      const grip: Array<[number, number, number]> = [[L.u + 0.005, hv, zt + 0.03], [L.u + 0.09, hv - 0.1, zt + 0.25]];
      k.line(grip, shade(t.ink, 0.6), 3, 0.9);
      k.line(grip, 0xa88f68, 1.8, 1);
      k.poly([[L.u - 0.045, hv, zt - 0.01], [L.u + 0.05, hv, zt - 0.01], [L.u + 0.03, hv, zt + 0.05], [L.u - 0.015, hv, zt + 0.05]], 0x565854, 1, true);
      k.line([[L.u - 0.045, hv + 0.001, zt - 0.005], [L.u + 0.05, hv + 0.001, zt - 0.005]], 0xa3a59c, 1, 0.8);
    }
    return null;
  },
};

/** The rect a design's shadow falls from, in GRID units. */
export function propFootprint(prop: TileProp, col: number, row: number): [number, number, number, number] {
  const [u0, v0, u1, v1] = FOOTPRINTS[prop];
  return [col + u0, row + v0, col + u1, row + v1];
}

/**
 * Draw one prop in its cell.
 *
 * `unit` is the screen height of one cell of `z` (`heightRise(m, 1)`), zero in
 * plan view. `height` is the tile's own height in cells. Returns the face a
 * light pass should treat as the fixture when the tile is a light, so the
 * caller can hand it to the unlit pass the way every other tile does.
 */
export function drawProp(
  g: Graphics,
  m: SceneMetrics,
  prop: TileProp,
  col: number,
  row: number,
  height: number,
  unit: number,
  tones: PropTones,
  seed: number,
  glow: number | null,
  /** Cells below the floor it stands at — `WATER_LEVEL` for a thing afloat. */
  sink = 0,
): Point[] | null {
  const k = new PropKit(g, m, col, row, unit, tones, seed, sink);
  // A flat prop still needs a little height to build with; a standing one
  // builds to its own.
  return DESIGNS[prop](k, height > 0 ? height : 0.5, glow);
}
