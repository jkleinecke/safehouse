/**
 * Furniture and props, drawn as what they are (FR9.2).
 *
 * An object used to be one of four blobs — a box, a post, a squat cylinder,
 * a post with a crown — and a desk, a car and a pallet stack were the same box
 * in three browns. Every object tile in the catalogue now names a DESIGN
 * (`prop: 'desk'`, `'car'`, `'lamppost'` — `TILE_PROPS`), and this module
 * builds it: a slab on pedestals with a monitor, a low body with a glazed
 * cabin and wheels, a pole with an arm and a head that throws its pool on the
 * pavement. Forty-odd designs dress six worlds because the palette stays the
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
const GLASS = 0x9fd4e6;
/** Leaves, for the things that grow in pots and planters whatever set they are in. */
const FOLIAGE = 0x6f8657;

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
  ) {
    this.plan = unit <= 0;
  }

  /** Cell space to world pixels. */
  at(p: P3): Point {
    const w = worldFromGrid(this.m, { x: this.col + p[0], y: this.row + p[1] });
    return { x: w.x, y: w.y - p[2] * this.unit };
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
type Draw = (k: PropKit, h: number, glow: number | null) => Point[] | null;

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
};

/** Four legs from the corners of a slab to the ground. */
function legs(k: PropKit, u0: number, v0: number, u1: number, v1: number, z: number, color: number): void {
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
function wheels(k: PropKit, v: number, z: number, r: number, u0: number, u1: number): void {
  k.faceCircle(u0, v, z, r, 'u', k.t.ink, 0.95);
  k.faceCircle(u1, v, z, r, 'u', k.t.ink, 0.95);
  k.faceCircle(u0, v, z, r * 0.45, 'u', k.t.light, 0.7);
  k.faceCircle(u1, v, z, r * 0.45, 'u', k.t.light, 0.7);
}

/** A drum: ribs and a lid. Shared by barrels, kegs and the fire. */
function drum(k: PropKit, h: number, color: number): Point[] {
  const top = k.cyl(0.5, 0.5, 0.3, 0, h * 0.95, color, { sides: 10 });
  k.band(0.5, 0.5, 0.3, h * 0.3, k.t.light, 0.5);
  k.band(0.5, 0.5, 0.3, h * 0.65, k.t.light, 0.5);
  k.band(0.5, 0.5, 0.3, h * 0.12, k.t.ink, 0.5);
  k.disc(0.5, 0.5, 0.24, h * 0.95, shade(color, 1.1), 1, true);
  return top;
}

/** A cabinet: locker doors or a machine body. */
function cabinet(k: PropKit, h: number, color: number): Point[] {
  return k.box(0.1, 0.15, 0.9, 0.85, 0, h, color);
}

const DESIGNS: Readonly<Record<TileProp, Draw>> = {
  desk: (k, h, glow) => {
    const t = k.t;
    k.box(0.1, 0.25, 0.3, 0.75, 0, h * 0.55, t.dark, { crown: false });
    k.box(0.7, 0.25, 0.9, 0.75, 0, h * 0.55, t.dark, { crown: false });
    k.box(0.08, 0.2, 0.92, 0.8, h * 0.55, h * 0.62, t.base);
    // Keyboard on the top, monitor at the back, its screen facing south.
    k.poly([[0.36, 0.56, h * 0.625], [0.64, 0.56, h * 0.625], [0.64, 0.7, h * 0.625], [0.36, 0.7, h * 0.625]], t.accent, 0.9);
    k.box(0.35, 0.3, 0.65, 0.36, h * 0.62, h * 0.98, t.ink, { crown: false });
    k.facePanel('u', 0.36, 0.37, h * 0.67, 0.63, h * 0.95, glow ?? GLASS, glow ? 0.9 : 0.5);
    return glow ? k.pts([[0.37, 0.36, h * 0.67], [0.63, 0.36, h * 0.67], [0.63, 0.36, h * 0.95], [0.37, 0.36, h * 0.95]]) : null;
  },
  chair: (k, h) => {
    const t = k.t;
    legs(k, 0.28, 0.32, 0.72, 0.72, h * 0.45, t.ink);
    k.box(0.25, 0.3, 0.75, 0.75, h * 0.45, h * 0.55, t.base);
    k.box(0.25, 0.28, 0.75, 0.36, h * 0.55, h * 1.0, shade(t.base, 0.9));
    return null;
  },
  sofa: (k, h) => {
    const t = k.t;
    k.box(0.05, 0.25, 0.95, 0.38, 0, h * 0.9, shade(t.base, 0.88));
    k.box(0.05, 0.3, 0.95, 0.85, 0, h * 0.5, t.base);
    k.line([[0.5, 0.38, h * 0.505], [0.5, 0.85, h * 0.505]], t.ink, 1, 0.6);
    k.box(0.05, 0.25, 0.15, 0.85, h * 0.5, h * 0.7, shade(t.base, 0.94));
    k.box(0.85, 0.25, 0.95, 0.85, h * 0.5, h * 0.7, shade(t.base, 0.94));
    return null;
  },
  table: (k, h) => {
    legs(k, 0.14, 0.2, 0.86, 0.8, h * 0.85, k.t.dark);
    k.box(0.1, 0.15, 0.9, 0.85, h * 0.85, h * 0.95, k.t.base);
    return null;
  },
  cocktail: (k, h) => {
    const t = k.t;
    k.disc(0.5, 0.5, 0.2, 0, t.dark, 1, true);
    k.cyl(0.5, 0.5, 0.05, 0, h * 0.9, t.dark, { sides: 6, ink: false });
    k.cyl(0.5, 0.5, 0.32, h * 0.9, h * 0.98, t.base, { sides: 12 });
    return null;
  },
  booth: (k, h) => {
    const t = k.t;
    k.box(0.05, 0.1, 0.95, 0.3, 0, h * 0.5, t.base);
    k.box(0.05, 0.05, 0.95, 0.14, h * 0.5, h * 0.95, shade(t.base, 0.88));
    k.cyl(0.5, 0.52, 0.06, 0, h * 0.7, t.dark, { sides: 6, ink: false });
    k.box(0.2, 0.42, 0.8, 0.62, h * 0.7, h * 0.78, t.accent);
    k.box(0.05, 0.72, 0.95, 0.92, 0, h * 0.5, t.base);
    k.box(0.05, 0.86, 0.95, 0.95, h * 0.5, h * 0.95, shade(t.base, 0.88));
    return null;
  },
  stool: (k, h) => {
    const t = k.t;
    k.cyl(0.5, 0.5, 0.05, 0, h * 0.85, t.dark, { sides: 6, ink: false });
    k.band(0.5, 0.5, 0.17, h * 0.3, t.light, 0.7, 2);
    k.cyl(0.5, 0.5, 0.2, h * 0.85, h * 0.97, t.base, { sides: 10 });
    k.disc(0.5, 0.5, 0.12, h * 0.975, shade(t.base, 1.18), 0.8);
    return null;
  },
  terminal: (k, h, glow) => {
    const t = k.t;
    k.box(0.32, 0.35, 0.68, 0.65, 0, h * 0.7, t.dark, { crown: false });
    k.box(0.25, 0.3, 0.75, 0.7, h * 0.7, h * 0.8, t.base);
    k.box(0.28, 0.3, 0.72, 0.37, h * 0.8, h * 1.15, t.ink, { crown: false });
    k.facePanel('u', 0.37, 0.3, h * 0.84, 0.7, h * 1.12, glow ?? GLASS, glow ? 0.9 : 0.5);
    return glow ? k.pool(0.5, 0.5, 0.3) : null;
  },
  server: (k, h, glow) => {
    const t = k.t;
    cabinet(k, h, t.base);
    // Vent slits down the door, and a column of status lights beside them.
    for (let i = 1; i < 7; i += 1) {
      k.facePanel('u', 0.85, 0.2, h * (i / 8) - 0.012, 0.6, h * (i / 8) + 0.012, t.ink, 0.6);
    }
    const led = glow ?? t.light;
    for (let i = 1; i < 6; i += 1) {
      k.facePanel('u', 0.851, 0.7, h * (i / 7) - 0.015, 0.78, h * (i / 7) + 0.015, led, 0.95);
    }
    k.line([[0.15, 0.85, h * 0.5], [0.85, 0.85, h * 0.5]], t.ink, 1, 0.4);
    return glow ? k.pool(0.5, 0.75, 0.32) : null;
  },
  locker: (k, h) => {
    const t = k.t;
    cabinet(k, h, t.base);
    for (const u of [0.37, 0.63]) k.line([[u, 0.85, 0], [u, 0.85, h]], t.ink, 1, 0.7);
    for (const u of [0.15, 0.42, 0.68]) {
      for (let i = 0; i < 3; i += 1) {
        k.facePanel('u', 0.851, u + 0.04, h * (0.78 + i * 0.05), u + 0.18, h * (0.79 + i * 0.05), t.ink, 0.6);
      }
      k.facePanel('u', 0.852, u + 0.16, h * 0.45, u + 0.2, h * 0.52, t.light, 0.9);
    }
    // In plan, the doors are the lines a floor plan draws on a run of lockers.
    if (k.plan) for (const u of [0.37, 0.63]) k.line([[u, 0.15, 0], [u, 0.85, 0]], t.ink, 1, 0.6);
    return null;
  },
  vending: (k, h, glow) => {
    const t = k.t;
    cabinet(k, h, t.base);
    const lit = glow ?? t.light;
    k.facePanel('u', 0.851, 0.18, h * 0.45, 0.72, h * 0.92, lit, glow ? 0.55 : 0.35, true);
    k.facePanel('u', 0.852, 0.24, h * 0.5, 0.66, h * 0.88, GLASS, 0.3);
    for (let i = 0; i < 3; i += 1) {
      k.facePanel('u', 0.853, 0.22, h * (0.55 + i * 0.12), 0.68, h * (0.56 + i * 0.12), t.ink, 0.5);
    }
    k.facePanel('u', 0.851, 0.2, h * 0.14, 0.7, h * 0.28, t.ink, 0.8);
    k.facePanel('u', 0.851, 0.76, h * 0.6, 0.84, h * 0.86, t.dark, 0.9);
    if (k.plan) k.line([[0.1, 0.85, 0], [0.9, 0.85, 0]], lit, 3, 0.8);
    return glow ? k.pool(0.5, 0.85, 0.36) : null;
  },
  cooler: (k, h) => {
    const t = k.t;
    k.box(0.35, 0.35, 0.65, 0.65, 0, h * 0.7, t.base);
    k.facePanel('u', 0.651, 0.42, h * 0.3, 0.58, h * 0.36, t.ink, 0.7);
    k.cyl(0.5, 0.5, 0.14, h * 0.7, h * 1.15, GLASS, { sides: 8, alpha: 0.85 });
    k.disc(0.5, 0.5, 0.06, h * 1.15, 0xffffff, 0.5);
    return null;
  },
  bin: (k, h) => {
    const t = k.t;
    k.cyl(0.5, 0.5, 0.22, 0, h * 0.85, t.base, { sides: 8 });
    k.disc(0.5, 0.5, 0.24, h * 0.85, shade(t.base, 1.1), 1, true);
    k.disc(0.5, 0.5, 0.1, h * 0.86, C.ground, 0.85);
    return null;
  },
  fountain: (k, h, glow) => {
    const t = k.t;
    k.cyl(0.5, 0.5, 0.42, 0, h * 0.45, t.base, { sides: 12 });
    k.disc(0.5, 0.5, 0.36, h * 0.45, glow ?? GLASS, 0.75);
    k.cyl(0.5, 0.5, 0.08, h * 0.45, h * 1.0, t.light, { sides: 6, ink: false });
    k.disc(0.5, 0.5, 0.16, h * 1.0, glow ?? GLASS, 0.6);
    k.disc(0.5, 0.5, 0.05, h * 1.02, 0xffffff, 0.5);
    return glow ? k.pool(0.5, 0.5, 0.36) : null;
  },
  plant: (k, h) => {
    const t = k.t;
    k.cyl(0.5, 0.5, 0.2, 0, h * 0.5, t.dark, { sides: 8 });
    k.cyl(0.5, 0.5, 0.3, h * 0.5, h * 1.15, t.base, { sides: 7, jitter: 0.35, salt: 1 });
    k.cyl(0.42, 0.45, 0.18, h * 0.9, h * 1.35, shade(t.base, 1.12), { sides: 6, jitter: 0.3, salt: 2, ink: false });
    return null;
  },
  decks: (k, h) => {
    const t = k.t;
    k.box(0.05, 0.25, 0.95, 0.8, 0, h * 0.9, t.base);
    for (const u of [0.3, 0.7]) {
      k.disc(u, 0.52, 0.14, h * 0.9, t.ink, 1);
      k.disc(u, 0.52, 0.05, h * 0.905, t.light, 0.9);
    }
    k.box(0.44, 0.4, 0.56, 0.66, h * 0.9, h * 0.95, t.dark, { crown: false });
    for (let i = 0; i < 3; i += 1) k.line([[0.47, 0.44 + i * 0.08, h * 0.955], [0.53, 0.44 + i * 0.08, h * 0.955]], t.light, 1, 0.8);
    return null;
  },
  speakers: (k, h, glow) => {
    const t = k.t;
    k.box(0.2, 0.2, 0.8, 0.8, 0, h * 0.5, t.base);
    k.box(0.22, 0.22, 0.78, 0.78, h * 0.5, h, t.base);
    k.faceCircle(0.5, 0.8, h * 0.25, 0.17, 'u', t.ink, 0.95);
    k.faceCircle(0.5, 0.8, h * 0.25, 0.07, 'u', t.light, 0.8);
    k.faceCircle(0.5, 0.78, h * 0.78, 0.13, 'u', t.ink, 0.95);
    k.faceCircle(0.5, 0.78, h * 0.78, 0.05, 'u', glow ?? t.light, 0.9);
    return glow ? k.pool(0.5, 0.7, 0.32) : null;
  },
  crates: (k, h) => {
    const t = k.t;
    k.box(0.05, 0.3, 0.55, 0.9, 0, h * 0.5, t.base);
    k.box(0.5, 0.1, 0.95, 0.6, 0, h * 0.55, shade(t.base, 0.94));
    k.box(0.2, 0.25, 0.7, 0.75, h * 0.5, h, shade(t.base, 1.06));
    // Plank lines across the top box and a strap on the front.
    for (const v of [0.42, 0.58]) k.line([[0.2, v, h * 1.002], [0.7, v, h * 1.002]], t.ink, 1, 0.45);
    k.facePanel('u', 0.751, 0.24, h * 0.72, 0.66, h * 0.76, t.dark, 0.6);
    return null;
  },
  pallet: (k) => {
    const t = k.t;
    k.box(0.06, 0.1, 0.94, 0.9, 0, 0.06, t.base);
    for (let i = 1; i < 6; i += 1) {
      const u = 0.06 + (0.88 * i) / 6;
      k.line([[u, 0.1, 0.061], [u, 0.9, 0.061]], t.ink, 1, 0.55);
    }
    k.facePanel('u', 0.9, 0.06, 0.02, 0.94, 0.04, t.ink, 0.5);
    return null;
  },
  barrel: (k, h) => {
    drum(k, h, k.t.base);
    return null;
  },
  forklift: (k, h) => {
    const t = k.t;
    // Forks and mast at the north end, body behind, guard over the seat.
    k.box(0.38, 0.0, 0.44, 0.14, 0, 0.03, t.light, { crown: false });
    k.box(0.56, 0.0, 0.62, 0.14, 0, 0.03, t.light, { crown: false });
    k.box(0.34, 0.12, 0.66, 0.18, 0, h * 1.5, t.dark, { crown: false });
    k.box(0.15, 0.3, 0.85, 0.8, h * 0.12, h * 0.5, t.base);
    k.box(0.3, 0.55, 0.7, 0.72, h * 0.5, h * 0.7, t.dark, { crown: false });
    wheels(k, 0.8, h * 0.15, 0.1, 0.28, 0.72);
    for (const [u, v] of [[0.2, 0.34], [0.8, 0.34], [0.2, 0.76], [0.8, 0.76]] as const) {
      k.line([[u, v, h * 0.5], [u, v, h * 1.3]], t.ink, 2, 0.9);
    }
    k.poly([[0.16, 0.3, h * 1.3], [0.84, 0.3, h * 1.3], [0.84, 0.8, h * 1.3], [0.16, 0.8, h * 1.3]], t.dark, 0.85, true);
    return null;
  },
  container: (k, h) => {
    const t = k.t;
    k.box(0.05, 0.15, 0.95, 0.85, 0, h, t.base);
    for (let i = 1; i < 11; i += 1) k.line([[0.05 + i * 0.09, 0.85, 0], [0.05 + i * 0.09, 0.85, h]], t.ink, 1, 0.3);
    for (const v of [0.4, 0.6]) k.line([[0.95, v, 0], [0.95, v, h]], t.ink, 1, 0.5);
    k.facePanel('v', 0.951, 0.3, h * 0.35, 0.33, h * 0.65, t.light, 0.9);
    k.facePanel('v', 0.951, 0.67, h * 0.35, 0.7, h * 0.65, t.light, 0.9);
    if (k.plan) for (let i = 1; i < 11; i += 1) k.line([[0.05 + i * 0.09, 0.15, 0], [0.05 + i * 0.09, 0.85, 0]], t.ink, 1, 0.25);
    return null;
  },
  spool: (k, h) => {
    const t = k.t;
    k.cyl(0.5, 0.5, 0.4, 0, h * 0.1, t.dark, { sides: 12 });
    k.cyl(0.5, 0.5, 0.22, h * 0.1, h * 0.8, t.base, { sides: 10 });
    k.band(0.5, 0.5, 0.22, h * 0.35, t.ink, 0.5);
    k.band(0.5, 0.5, 0.22, h * 0.55, t.ink, 0.5);
    k.cyl(0.5, 0.5, 0.4, h * 0.8, h * 0.9, t.dark, { sides: 12 });
    k.disc(0.5, 0.5, 0.08, h * 0.9, C.ground, 0.8);
    return null;
  },
  worklight: (k, h, glow) => {
    const t = k.t;
    for (const [u, v] of [[0.3, 0.72], [0.7, 0.72], [0.5, 0.22]] as const) {
      k.line([[0.5, 0.5, h * 1.0], [u, v, 0]], t.ink, 2, 0.9);
    }
    k.box(0.32, 0.4, 0.68, 0.55, h * 0.95, h * 1.25, t.dark, { crown: false });
    k.facePanel('u', 0.551, 0.34, h * 0.98, 0.66, h * 1.22, glow ?? t.light, 0.95);
    return glow ? k.pool(0.5, 0.55, 0.42) : null;
  },
  generator: (k, h, glow) => {
    const t = k.t;
    k.box(0.1, 0.2, 0.9, 0.8, 0, h * 0.7, t.base);
    k.box(0.15, 0.25, 0.55, 0.75, h * 0.7, h * 0.95, t.dark);
    k.cyl(0.72, 0.4, 0.05, h * 0.7, h * 1.3, t.ink, { sides: 6, ink: false });
    for (let i = 0; i < 4; i += 1) k.facePanel('v', 0.901, 0.28 + i * 0.12, h * 0.25, 0.34 + i * 0.12, h * 0.55, t.ink, 0.5);
    const panel = glow ?? t.light;
    k.facePanel('u', 0.801, 0.62, h * 0.35, 0.84, h * 0.6, t.ink, 0.9);
    k.facePanel('u', 0.802, 0.65, h * 0.42, 0.7, h * 0.52, panel, 0.95);
    k.facePanel('u', 0.802, 0.74, h * 0.42, 0.79, h * 0.52, panel, 0.95);
    return glow ? k.pool(0.8, 0.8, 0.3) : null;
  },
  tank: (k, h) => {
    const t = k.t;
    k.cyl(0.5, 0.5, 0.4, 0, h * 0.85, t.base, { sides: 12 });
    k.band(0.5, 0.5, 0.4, h * 0.28, t.light, 0.5);
    k.band(0.5, 0.5, 0.4, h * 0.56, t.light, 0.5);
    k.cyl(0.5, 0.5, 0.3, h * 0.85, h * 0.97, shade(t.base, 1.05), { sides: 12 });
    k.disc(0.5, 0.5, 0.07, h * 0.97, t.dark, 1, true);
    return null;
  },
  valves: (k, h) => {
    const t = k.t;
    for (const u of [0.3, 0.5, 0.7]) k.cyl(u, 0.5, 0.06, 0, h * 0.9, t.dark, { sides: 6, ink: false });
    k.box(0.2, 0.46, 0.8, 0.54, h * 0.5, h * 0.58, t.dark, { crown: false });
    for (const u of [0.3, 0.5, 0.7]) {
      k.disc(u, 0.5, 0.12, h * 0.92, t.base, 0.95, true);
      k.disc(u, 0.5, 0.04, h * 0.93, t.light, 0.9);
    }
    return null;
  },
  pump: (k, h) => {
    const t = k.t;
    k.box(0.15, 0.25, 0.85, 0.75, 0, h * 0.3, t.dark);
    k.cyl(0.4, 0.5, 0.22, h * 0.3, h * 0.8, t.base, { sides: 10 });
    k.box(0.62, 0.38, 0.88, 0.62, h * 0.3, h * 0.7, shade(t.base, 0.9));
    k.cyl(0.4, 0.5, 0.06, h * 0.8, h * 1.0, t.ink, { sides: 6, ink: false });
    k.line([[0.4, 0.5, h * 1.0], [0.4, 0.1, h * 1.0]], t.ink, 3, 0.9);
    return null;
  },
  fan: (k, h) => {
    const t = k.t;
    k.box(0.2, 0.35, 0.8, 0.65, 0, h * 0.95, t.base);
    k.faceCircle(0.5, 0.651, h * 0.5, 0.26, 'u', t.ink, 0.85);
    k.faceCircle(0.5, 0.652, h * 0.5, 0.22, 'u', t.dark, 1);
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI;
      k.line([[0.5 - Math.cos(a) * 0.2, 0.653, h * (0.5 - Math.sin(a) * 0.2)], [0.5 + Math.cos(a) * 0.2, 0.653, h * (0.5 + Math.sin(a) * 0.2)]], t.light, 1, 0.8);
    }
    k.faceCircle(0.5, 0.654, h * 0.5, 0.05, 'u', t.light, 0.95);
    if (k.plan) k.disc(0.5, 0.5, 0.2, 0, t.dark, 0.8, true);
    return null;
  },
  car: (k, h) => {
    const t = k.t;
    k.box(0.05, 0.25, 0.95, 0.75, h * 0.15, h * 0.55, t.base);
    k.box(0.28, 0.3, 0.72, 0.7, h * 0.55, h * 0.95, shade(t.base, 0.9));
    k.facePanel('u', 0.701, 0.31, h * 0.6, 0.69, h * 0.9, GLASS, 0.6);
    k.facePanel('v', 0.721, 0.33, h * 0.6, 0.67, h * 0.9, GLASS, 0.6);
    k.facePanel('v', 0.951, 0.28, h * 0.32, 0.36, h * 0.45, t.light, 0.95);
    k.facePanel('v', 0.951, 0.64, h * 0.32, 0.72, h * 0.45, t.light, 0.95);
    wheels(k, 0.75, h * 0.16, 0.12, 0.22, 0.78);
    if (k.plan) k.line([[0.28, 0.3, 0], [0.72, 0.3, 0], [0.72, 0.7, 0], [0.28, 0.7, 0]], GLASS, 2, 0.7);
    return null;
  },
  van: (k, h) => {
    const t = k.t;
    k.box(0.05, 0.22, 0.6, 0.78, h * 0.15, h * 1.0, t.base);
    k.box(0.6, 0.25, 0.95, 0.75, h * 0.15, h * 0.75, shade(t.base, 0.95));
    k.facePanel('v', 0.951, 0.28, h * 0.45, 0.72, h * 0.72, GLASS, 0.6);
    k.facePanel('u', 0.751, 0.62, h * 0.45, 0.93, h * 0.72, GLASS, 0.5);
    k.facePanel('v', 0.952, 0.27, h * 0.25, 0.35, h * 0.36, t.light, 0.95);
    k.facePanel('v', 0.952, 0.65, h * 0.25, 0.73, h * 0.36, t.light, 0.95);
    k.line([[0.6, 0.78, h * 0.15], [0.6, 0.78, h * 1.0]], t.ink, 1, 0.6);
    wheels(k, 0.78, h * 0.16, 0.13, 0.2, 0.78);
    return null;
  },
  tree: (k, h) => {
    const t = k.t;
    k.cyl(0.5, 0.5, 0.09, 0, h * 0.55, shade(t.base, 0.6), { sides: 6, ink: false });
    k.cyl(0.5, 0.5, 0.42, h * 0.45, h * 1.1, t.base, { sides: 8, jitter: 0.35, salt: 1 });
    k.cyl(0.4, 0.4, 0.22, h * 0.95, h * 1.3, shade(t.base, 1.14), { sides: 7, jitter: 0.3, salt: 2, ink: false });
    for (let i = 0; i < 4; i += 1) {
      k.disc(0.3 + k.rnd(7 + i) * 0.4, 0.3 + k.rnd(11 + i) * 0.4, 0.05, h * 1.12, t.light, 0.6);
    }
    return null;
  },
  bush: (k, h) => {
    const t = k.t;
    k.cyl(0.5, 0.5, 0.34, 0, h * 0.8, t.base, { sides: 7, jitter: 0.35, salt: 1 });
    k.cyl(0.62, 0.58, 0.16, h * 0.4, h * 0.85, shade(t.base, 0.92), { sides: 6, jitter: 0.3, salt: 3, ink: false });
    k.cyl(0.42, 0.44, 0.2, h * 0.5, h * 1.05, shade(t.base, 1.12), { sides: 6, jitter: 0.3, salt: 2, ink: false });
    return null;
  },
  planter: (k, h) => {
    const t = k.t;
    k.box(0.15, 0.15, 0.85, 0.85, 0, h * 0.7, t.base);
    k.poly([[0.2, 0.2, h * 0.705], [0.8, 0.2, h * 0.705], [0.8, 0.8, h * 0.705], [0.2, 0.8, h * 0.705]], t.dark, 1);
    k.cyl(0.5, 0.5, 0.24, h * 0.7, h * 1.15, FOLIAGE, { sides: 7, jitter: 0.35, salt: 1 });
    k.cyl(0.44, 0.44, 0.13, h * 1.0, h * 1.3, shade(FOLIAGE, 1.12), { sides: 6, jitter: 0.3, salt: 2, ink: false });
    return null;
  },
  hydrant: (k, h) => {
    const t = k.t;
    k.cyl(0.5, 0.5, 0.1, 0, h * 0.7, t.base, { sides: 6 });
    k.box(0.32, 0.46, 0.5, 0.54, h * 0.4, h * 0.5, t.dark, { crown: false });
    k.box(0.5, 0.46, 0.68, 0.54, h * 0.4, h * 0.5, t.dark, { crown: false });
    k.cyl(0.5, 0.5, 0.12, h * 0.7, h * 0.85, shade(t.base, 1.1), { sides: 6 });
    k.disc(0.5, 0.5, 0.06, h * 0.9, shade(t.base, 1.2), 1, true);
    return null;
  },
  bollard: (k, h) => {
    const t = k.t;
    k.cyl(0.5, 0.5, 0.1, 0, h * 0.9, t.base, { sides: 8 });
    k.band(0.5, 0.5, 0.1, h * 0.6, t.light, 0.9, 2);
    k.disc(0.5, 0.5, 0.11, h * 0.9, shade(t.base, 1.2), 1, true);
    return null;
  },
  lamppost: (k, h, glow) => {
    const t = k.t;
    k.disc(0.5, 0.5, 0.12, 0, t.dark, 1, true);
    k.cyl(0.5, 0.5, 0.045, 0, h * 1.7, t.dark, { sides: 6, ink: false });
    k.box(0.5, 0.47, 0.85, 0.53, h * 1.6, h * 1.66, t.dark, { crown: false, ink: false });
    k.box(0.7, 0.4, 0.9, 0.6, h * 1.5, h * 1.62, t.ink, { crown: false });
    k.poly([[0.72, 0.42, h * 1.5], [0.88, 0.42, h * 1.5], [0.88, 0.58, h * 1.5], [0.72, 0.58, h * 1.5]], glow ?? t.light, 0.95);
    return glow ? k.pool(0.8, 0.5, 0.42) : null;
  },
  dumpster: (k, h) => {
    const t = k.t;
    wheels(k, 0.8, h * 0.06, 0.06, 0.2, 0.8);
    k.box(0.08, 0.2, 0.92, 0.8, h * 0.1, h * 0.85, t.base);
    for (const u of [0.3, 0.5, 0.7]) k.line([[u, 0.8, h * 0.1], [u, 0.8, h * 0.85]], t.ink, 1, 0.35);
    k.box(0.06, 0.18, 0.94, 0.82, h * 0.85, h * 0.98, shade(t.base, 0.9));
    k.line([[0.5, 0.18, h * 0.985], [0.5, 0.82, h * 0.985]], t.ink, 1, 0.6);
    return null;
  },
  cone: (k, h) => {
    const t = k.t;
    k.box(0.34, 0.34, 0.66, 0.66, 0, h * 0.05, t.dark, { crown: false });
    k.cyl(0.5, 0.5, 0.13, h * 0.05, h * 0.35, t.base, { sides: 8, ink: false });
    k.cyl(0.5, 0.5, 0.09, h * 0.35, h * 0.62, shade(t.base, 1.35), { sides: 8, ink: false });
    k.cyl(0.5, 0.5, 0.05, h * 0.62, h * 0.95, t.base, { sides: 8, ink: false });
    return null;
  },
  trash: (k, h) => {
    const t = k.t;
    k.cyl(0.35, 0.55, 0.22, 0, h * 0.5, t.base, { sides: 7, jitter: 0.4, salt: 1 });
    k.cyl(0.62, 0.4, 0.2, 0, h * 0.6, shade(t.base, 0.9), { sides: 7, jitter: 0.4, salt: 2 });
    k.cyl(0.55, 0.68, 0.16, 0, h * 0.45, shade(t.base, 1.05), { sides: 6, jitter: 0.4, salt: 3 });
    return null;
  },
  fire: (k, h, glow) => {
    const t = k.t;
    const top = drum(k, h, t.base);
    const flame = glow ?? t.light;
    // Two tongues of flame above the rim, hot and a wider soft one.
    k.poly([[0.32, 0.5, h * 0.9], [0.68, 0.5, h * 0.9], [0.6, 0.5, h * 1.25], [0.5, 0.5, h * 1.55], [0.42, 0.5, h * 1.2]], flame, 0.55);
    k.poly([[0.4, 0.5, h * 0.92], [0.6, 0.5, h * 0.92], [0.55, 0.5, h * 1.15], [0.49, 0.5, h * 1.35], [0.44, 0.5, h * 1.12]], 0xfff1b0, 0.75);
    if (k.plan) k.disc(0.5, 0.5, 0.14, 0, flame, 0.9);
    return glow ? top : null;
  },
  wreck: (k, h, glow) => {
    const t = k.t;
    k.box(0.05, 0.28, 0.95, 0.72, h * 0.12, h * 0.5, t.base);
    k.box(0.3, 0.32, 0.7, 0.68, h * 0.5, h * 0.72, shade(t.base, 0.8));
    k.faceCircle(0.22, 0.72, h * 0.14, 0.11, 'u', t.ink, 0.95);
    k.poly([[0.55, 0.35, h * 0.505], [0.9, 0.3, h * 0.505], [0.92, 0.6, h * 0.505], [0.6, 0.66, h * 0.505]], C.ground, 0.5);
    const embers: P3[] = [[0.62, 0.42, h * 0.51], [0.82, 0.4, h * 0.51], [0.8, 0.56, h * 0.51], [0.64, 0.58, h * 0.51]];
    if (glow !== null) k.poly(embers, glow, 0.7);
    return glow ? k.pts(embers) : null;
  },
  tyres: (k, h) => {
    const t = k.t;
    k.cyl(0.5, 0.5, 0.3, 0, h * 0.3, t.dark, { sides: 10 });
    k.cyl(0.52, 0.48, 0.3, h * 0.3, h * 0.6, shade(t.base, 0.95), { sides: 10 });
    k.cyl(0.48, 0.52, 0.3, h * 0.6, h * 0.9, t.dark, { sides: 10 });
    k.disc(0.48, 0.52, 0.14, h * 0.9, C.ground, 0.9);
    return null;
  },
  tent: (k, h) => {
    const t = k.t;
    const ridge = h * 1.3;
    k.poly([[0.1, 0.1, 0], [0.9, 0.1, 0], [0.9, 0.5, ridge], [0.1, 0.5, ridge]], shade(t.base, 0.85), 1, true);
    k.poly([[0.1, 0.5, ridge], [0.9, 0.5, ridge], [0.9, 0.9, 0], [0.1, 0.9, 0]], t.base, 1, true);
    k.poly([[0.9, 0.1, 0], [0.9, 0.5, ridge], [0.9, 0.9, 0]], shade(t.base, 0.7), 1, true);
    k.poly([[0.9, 0.3, 0], [0.9, 0.5, ridge * 0.7], [0.9, 0.7, 0]], C.ground, 0.85);
    k.line([[0.1, 0.5, ridge], [0.9, 0.5, ridge]], t.light, 1, 0.7);
    for (const u of [0.1, 0.9]) k.line([[u, 0.5, 0], [u, 0.5, ridge]], t.ink, 2, 0.8);
    return null;
  },
  heap: (k, h) => {
    const t = k.t;
    k.cyl(0.5, 0.5, 0.42, 0, h * 0.5, t.base, { sides: 8, jitter: 0.35, salt: 1 });
    k.cyl(0.4, 0.42, 0.28, h * 0.4, h * 0.85, shade(t.base, 0.94), { sides: 7, jitter: 0.4, salt: 2 });
    k.cyl(0.62, 0.6, 0.2, h * 0.3, h * 0.65, shade(t.base, 1.06), { sides: 6, jitter: 0.4, salt: 3 });
    for (let i = 0; i < 5; i += 1) {
      k.disc(0.2 + k.rnd(20 + i) * 0.6, 0.2 + k.rnd(30 + i) * 0.6, 0.03, h * 0.86, t.ink, 0.6);
    }
    return null;
  },
  mattress: (k) => {
    const t = k.t;
    k.box(0.1, 0.15, 0.9, 0.85, 0, 0.06, t.base);
    k.box(0.12, 0.17, 0.35, 0.83, 0.06, 0.1, shade(t.base, 1.1));
    k.poly([[0.5, 0.35, 0.062], [0.75, 0.3, 0.062], [0.8, 0.6, 0.062], [0.55, 0.7, 0.062]], t.ink, 0.25);
    return null;
  },
  lantern: (k, h, glow) => {
    const t = k.t;
    k.box(0.3, 0.3, 0.7, 0.7, 0, h * 0.5, t.dark);
    k.cyl(0.5, 0.5, 0.08, h * 0.5, h * 0.56, t.ink, { sides: 6, ink: false });
    k.cyl(0.5, 0.5, 0.07, h * 0.56, h * 0.8, glow ?? t.light, { sides: 6, alpha: 0.95, ink: false });
    k.disc(0.5, 0.5, 0.09, h * 0.82, t.ink, 1);
    k.line([[0.42, 0.5, h * 0.82], [0.5, 0.5, h * 0.98], [0.58, 0.5, h * 0.82]], t.ink, 1, 0.9);
    return glow ? k.pool(0.5, 0.5, 0.3) : null;
  },
  cart: (k, h) => {
    const t = k.t;
    wheels(k, 0.82, h * 0.08, 0.06, 0.26, 0.74);
    for (const [u, v] of [[0.22, 0.32], [0.78, 0.32], [0.22, 0.8], [0.78, 0.8]] as const) {
      k.line([[u, v, 0], [u, v, h * 0.35]], t.ink, 1, 0.9);
    }
    k.box(0.2, 0.3, 0.8, 0.8, h * 0.35, h * 0.85, t.base, { alpha: 0.75 });
    for (let i = 1; i < 6; i += 1) k.line([[0.2 + i * 0.1, 0.8, h * 0.35], [0.2 + i * 0.1, 0.8, h * 0.85]], t.ink, 1, 0.45);
    for (let i = 1; i < 4; i += 1) k.line([[0.2, 0.8, h * (0.35 + i * 0.125)], [0.8, 0.8, h * (0.35 + i * 0.125)]], t.ink, 1, 0.45);
    k.box(0.18, 0.28, 0.82, 0.33, h * 0.85, h * 0.9, t.dark, { crown: false });
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
): Point[] | null {
  const k = new PropKit(g, m, col, row, unit, tones, seed);
  // A flat prop still needs a little height to build with; a standing one
  // builds to its own.
  return DESIGNS[prop](k, height > 0 ? height : 0.5, glow);
}
