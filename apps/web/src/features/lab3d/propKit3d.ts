/**
 * The 3D map's furniture: every prop design in `stage/props.ts`, built as
 * geometry instead of painted.
 *
 * The eighty designs are written against `PropKit` — boxes, cylinders,
 * polygons and strokes placed in CELL SPACE (`u`, `v` across the cell, `z`
 * up in storeys). `PropKit3D` is that kit with its drawing calls pointed at a
 * `MeshBuilder`: a box becomes a real six-faced box, a cylinder a closed
 * prism, a thick stroke a beam, a thin one a hairline, and a polygon a
 * polygon — all through the one placement transform the 2D kit uses, so a
 * desk is the same size on the same squares in both views.
 *
 * ## What it cannot change
 *
 * The designs were drawn for one camera. Most of their helpers paint only the
 * faces that turn toward the isometric viewer (south, east and up), pre-shade
 * colours for a key light, lay soft things (leaves, sacks, statues) on a plane
 * square to the screen, and outline silhouettes in ink. None of that is fixed
 * here: the kit builds exactly what the design asks for, which is the honest
 * measure of how far the 2D art carries into 3D.
 *
 * ## Two small cheats, both stated
 *
 * - `at()` still returns a 2D point — helpers do screen maths with it (which
 *   faces are visible, how round a wheel is) — but in a projection whose
 *   height-to-width ratio is the world's, not the squat 2D map's. Without
 *   that, every circle a design stands on a face (wheels, pipes, logs, bales)
 *   would come out three times taller than wide on a true-scale storey.
 * - A few helpers stroke and fill through `k.g` directly with points from
 *   `at()`. The Graphics the kit is handed records those paths and the kit
 *   maps each 2D point back to the 3D point it came from, so a chandelier's
 *   arms and a well's rope survive rather than vanishing.
 */
import type { Graphics } from 'pixi.js';
import type { Point } from '@safehouse/contracts';
import type { TileProp } from '@safehouse/rules';
import { CELL, heightRise, ISO_HALF_H, ISO_HALF_W, type SceneMetrics } from '../grid/geometry.js';
import { parseColor, shade } from '../grid/stage/colors.js';
import { DESIGNS, GLASS, PropKit, propPlacement, type PropPlacement, type PropTones } from '../grid/stage/props.js';
import type { TileDrawDef } from '../grid/types.js';
import { polygonNormal, type MeshBuilder, type V3 } from './geometry3d.js';

/** A point in cell space: across, down, up (storeys). */
type P3 = readonly [number, number, number];
type Kind = 'solid' | 'glass' | 'glow';

/** Where a prop is being built: the grid it stands on and the floor under it. */
export interface PropBuildCtx {
  unitM: number;
  /** Squares per storey (`storeyUnits(unitM)`). */
  storey: number;
  /** World y of the floor it stands on. */
  baseY: number;
}

export interface BuildPropOptions {
  /** Storeys below the floor the whole design stands: a boat afloat in sunk water. */
  sink?: number;
  /**
   * Keep the one-pixel strokes (seams, ink silhouettes, lit crown edges).
   * Default on; off shows what the props look like as bare solids.
   */
  hairlines?: boolean;
}

/** Below this opacity a fill is shading — a shadow, a scuff, a light pool — which real lighting replaces, so it is dropped. Glass is kept at any opacity. */
const TINT_ALPHA = 0.25;
/** Below this opacity a fill is see-through: the glass material. */
const GLASS_ALPHA = 0.6;
/** A stroke this wide (screen px on the 2D map) or wider is a part — a leg, a pole — and becomes a beam. */
const BEAM_WIDTH = 2;
/** Screen px of stroke width per square of beam half-thickness: a 5.8 px lamppost is a 4.5 cm radius on a 1 m grid. */
const PX_PER_SQUARE = 128;
/** Sides of a flat disc. */
const DISC_SIDES = 16;
/**
 * Decals — a panel on a face, a seam, a lid on a box — are drawn after the
 * solid they sit on, often on the same plane. The 2D map lets the later one
 * win; a depth buffer flickers between them. So every decal is nudged toward
 * the isometric viewer (east, up, south) by a couple of millimetres, a hair
 * more for each later one, which keeps the painter's order from the view the
 * designs were drawn for.
 */
const LAYER_M = 0.002;
const LAYER_STEP_M = 0.00003;
const LAYER_MAX = 400;
/** Screen length of one square's edge on the 2:1 isometric map, per px of cell. */
const ISO_EDGE = Math.hypot(ISO_HALF_W, ISO_HALF_H);

/** The same derived palette `tileLayer.ts` hands every prop. */
function tonesOf(base: number, accent: number): PropTones {
  return {
    base,
    accent,
    light: shade(accent, 1.12),
    dark: shade(base, 0.84),
    ink: shade(base, 0.62),
  };
}

/** The same per-cell seed `tileLayer.ts` uses (FNV-1a of "col,row"), so a prop varies the same way in both views. */
function cellSeed(col: number, row: number): number {
  const s = `${col},${row}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The light colour a tile's design is handed, or null when it gives off none (as `drawPropTile` parses it). */
export function glowColorOf(def: TileDrawDef): number | null {
  if (def.emissive === undefined) return null;
  return parseColor(def.emissive, parseColor(def.colors[1], 0x5a6068));
}

/**
 * Is `c` the glow colour, or the glow colour brightened or barely dimmed
 * (`shade(glow, f)` with f ≥ 0.85)? Designs paint a lamp's hot core and a
 * lit logo that way; those are part of the fixture, not the housing.
 */
function glowish(c: number, glow: number | null): boolean {
  if (glow === null) return false;
  if (c === glow) return true;
  let f = -1;
  for (const s of [16, 8, 0]) {
    const gc = (glow >> s) & 255;
    const cc = (c >> s) & 255;
    if (gc < 16) {
      if (cc > 32) return false;
      continue;
    }
    // A channel a brightening shade() clamped says nothing about the ratio.
    if (cc === 255) continue;
    const r = cc / gc;
    if (f < 0) f = r;
    else if (Math.abs(r - f) > 0.05) return false;
  }
  return f >= 0.85;
}

/** Does this polygon lie (near enough) in one plane? A hull traced round a silhouette does not. */
function isPlanar(pts: readonly V3[]): boolean {
  const n = polygonNormal(pts);
  if (n[0] === 0 && n[1] === 0 && n[2] === 0) return true;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p[0] / pts.length;
    cy += p[1] / pts.length;
    cz += p[2] / pts.length;
  }
  let size = 0;
  for (const p of pts) size = Math.max(size, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
  const tol = 1e-4 + size * 0.02;
  for (const p of pts) {
    if (Math.abs((p[0] - cx) * n[0] + (p[1] - cy) * n[1] + (p[2] - cz) * n[2]) > tol) return false;
  }
  return true;
}

interface SubPath {
  pts: Point[];
  closed: boolean;
}

interface PaintStyle {
  color: number;
  alpha: number;
  width: number;
}

function styleOf(style: unknown, alpha: unknown): PaintStyle {
  if (typeof style === 'number') return { color: style, alpha: typeof alpha === 'number' ? alpha : 1, width: 1 };
  const s = (style ?? {}) as { color?: unknown; alpha?: unknown; width?: unknown };
  return {
    color: typeof s.color === 'number' ? s.color : 0,
    alpha: typeof s.alpha === 'number' ? s.alpha : typeof alpha === 'number' ? alpha : 1,
    width: typeof s.width === 'number' ? s.width : 1,
  };
}

/**
 * The Graphics a 3D kit is handed. The kit's own drawing never touches it,
 * but a few design helpers stroke and fill through `k.g` with points from
 * `k.at()`; this records those paths (moveTo / lineTo / closePath, then fill
 * or stroke — reusing the last path when a stroke follows a fill with nothing
 * drawn between, as Pixi does) and hands them to the kit. Every other method
 * is a no-op that returns the recorder.
 */
class PathRecorder {
  readonly graphics: Graphics;
  private kit: PropKit3D | null = null;
  private subs: SubPath[] = [];
  private cur: SubPath | null = null;
  private last: SubPath[] = [];
  private fresh = false;

  constructor() {
    const calls: Record<string, (a: unknown, b: unknown) => void> = {
      moveTo: (x, y) => this.moveTo(Number(x), Number(y)),
      lineTo: (x, y) => this.lineTo(Number(x), Number(y)),
      closePath: () => this.closePath(),
      fill: (style, alpha) => this.paint('fill', styleOf(style, alpha)),
      stroke: (style) => this.paint('stroke', styleOf(style, undefined)),
    };
    const proxy: object = new Proxy(
      {},
      {
        get: (_target, key) => {
          // Not a thenable, not a primitive: only string-named methods exist.
          if (typeof key !== 'string' || key === 'then') return undefined;
          const call = calls[key];
          return (a?: unknown, b?: unknown) => {
            if (call) call(a, b);
            else this.fresh = true;
            return proxy;
          };
        },
      },
    );
    this.graphics = proxy as Graphics;
  }

  bind(kit: PropKit3D): void {
    this.kit = kit;
  }

  private moveTo(x: number, y: number): void {
    if (this.cur && this.cur.pts.length > 0) this.subs.push(this.cur);
    this.cur = { pts: [{ x, y }], closed: false };
    this.fresh = true;
  }

  private lineTo(x: number, y: number): void {
    if (!this.cur) this.cur = { pts: [], closed: false };
    this.cur.pts.push({ x, y });
    this.fresh = true;
  }

  private closePath(): void {
    if (this.cur && this.cur.pts.length > 0) {
      this.cur.closed = true;
      this.subs.push(this.cur);
    }
    this.cur = null;
    this.fresh = true;
  }

  private paint(kind: 'fill' | 'stroke', style: PaintStyle): void {
    if (this.cur && this.cur.pts.length > 0) this.subs.push(this.cur);
    this.cur = null;
    let paths = this.subs;
    this.subs = [];
    if (paths.length === 0 && !this.fresh) paths = this.last;
    this.last = paths;
    this.fresh = false;
    for (const p of paths) this.kit?.recorded(kind, p, style);
  }
}

interface Beam {
  pts: V3[];
  r: number;
  color: number;
  kind: Kind;
}

/**
 * `PropKit` building into a `MeshBuilder`. Every drawing call is overridden;
 * `at()` keeps its job of handing helpers a 2D point (see the module notes on
 * its projection) and remembers which 3D point each came from.
 */
class PropKit3D extends PropKit {
  private readonly b: MeshBuilder;
  private readonly storey: number;
  private readonly baseY: number;
  private readonly unitM: number;
  private readonly glow: number | null;
  private readonly hairlines: boolean;
  /** Screen px per square across the ground in `at()`'s projection. */
  private readonly flat: number;
  /** The world point behind every 2D point `at()` has handed out: x → y → point. */
  private readonly seen = new Map<number, Map<number, V3>>();
  /** Thick strokes, held until the design is done so an ink under-stroke and its colour merge into one beam. */
  private readonly beams = new Map<string, Beam>();
  private layer = 0;

  constructor(
    b: MeshBuilder,
    rec: PathRecorder,
    m: SceneMetrics,
    col: number,
    row: number,
    tones: PropTones,
    seed: number,
    place: PropPlacement,
    ctx: PropBuildCtx,
    glow: number | null,
    sink: number,
    hairlines: boolean,
  ) {
    super(rec.graphics, m, col, row, heightRise(m, 1), tones, seed, sink, place);
    this.b = b;
    this.storey = ctx.storey;
    this.baseY = ctx.baseY;
    this.unitM = m.unitM;
    this.glow = glow;
    this.hairlines = hairlines;
    // A circle a design stands on a face is `r` storeys tall and `r * unit / run`
    // cells across, `run` being one cell's screen length (`faceCircle`, and the
    // helpers that copy it). Choosing the run so that is `r * up * storey / su`
    // makes it round in the world, which is what 3D needs.
    this.flat = this.unit / (Math.max(1e-6, place.up) * Math.max(1e-6, ctx.storey) * ISO_EDGE);
    rec.bind(this);
  }

  /** Cell space to world units — the transform `at()` applies, in 3D. */
  world(p: P3): V3 {
    const { anchor, centre, su, sv, up } = this.place;
    return [
      this.col + centre[0] + (p[0] - anchor[0]) * su,
      this.baseY + (p[2] * up - this.sink) * this.storey,
      this.row + centre[1] + (p[1] - anchor[1]) * sv,
    ];
  }

  override at(p: P3): Point {
    const w = this.world(p);
    const pt = {
      x: (w[0] - w[2]) * this.flat * ISO_HALF_W,
      y: (w[0] + w[2]) * this.flat * ISO_HALF_H - ((w[1] - this.baseY) / this.storey) * this.unit,
    };
    let col = this.seen.get(pt.x);
    if (!col) {
      col = new Map();
      this.seen.set(pt.x, col);
    }
    col.set(pt.y, w);
    return pt;
  }

  override poly(pts: readonly P3[], color: number, alpha = 1, _ink = false): void {
    this.emitPoly(pts.map((p) => this.world(p)), color, alpha);
  }

  override line(pts: readonly P3[], color: number, width = 1, alpha = 1): void {
    this.emitLine(pts.map((p) => this.world(p)), color, width, alpha, true);
  }

  override box(u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, color: number, opts: { alpha?: number; ink?: boolean; crown?: boolean } = {}): Point[] {
    const alpha = opts.alpha ?? 1;
    const top: P3[] = [[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]];
    if (z1 > z0) {
      const kind = this.kindOf(color, alpha);
      if (kind) {
        const a = this.world([u0, v0, z0]);
        const c = this.world([u1, v1, z1]);
        this.b.box(
          Math.min(a[0], c[0]),
          Math.min(a[1], c[1]),
          Math.min(a[2], c[2]),
          Math.max(a[0], c[0]),
          Math.max(a[1], c[1]),
          Math.max(a[2], c[2]),
          color,
          // A box that floats (a lamp head, a shelf) shows its underside to a low camera.
          { kind, bottom: z0 > 0 },
        );
      }
    } else {
      this.emitPoly(top.map((p) => this.world(p)), color, alpha);
    }
    return this.pts(top);
  }

  override cyl(cu: number, cv: number, r: number, z0: number, z1: number, color: number, opts: { sides?: number; jitter?: number; salt?: number; alpha?: number; ink?: boolean } = {}): Point[] {
    const sides = opts.sides ?? 8;
    const ring = this.circle(cu, cv, r, z0, sides, opts.jitter ?? 0, opts.salt ?? 0);
    const alpha = opts.alpha ?? 1;
    if (z1 > z0) {
      const kind = this.kindOf(color, alpha);
      if (kind) {
        const floor = ring.map((p): [number, number] => {
          const w = this.world(p);
          return [w[0], w[2]];
        });
        const y0 = this.world([cu, cv, z0])[1];
        const y1 = this.world([cu, cv, z1])[1];
        this.b.extrude(floor, y0, y1, color, { kind });
        if (z0 > 0) this.b.polygon(floor.map(([x, z]): V3 => [x, y0, z]), color, kind);
      }
    } else {
      this.emitPoly(ring.map((p) => this.world([p[0], p[1], z1])), color, alpha);
    }
    return this.pts(ring.map((p): P3 => [p[0], p[1], z1]));
  }

  override disc(cu: number, cv: number, r: number, z: number, color: number, alpha = 1, _ink = false): void {
    const c = this.world([cu, cv, z]);
    const R = (r * (this.place.su + this.place.sv)) / 2;
    const pts: V3[] = [];
    for (let i = 0; i < DISC_SIDES; i += 1) {
      const a = (i / DISC_SIDES) * Math.PI * 2;
      pts.push([c[0] + Math.cos(a) * R, c[1], c[2] + Math.sin(a) * R]);
    }
    this.emitPoly(pts, color, alpha);
  }

  /**
   * The whole ring as a hairline, not the near half, whatever width the
   * design asked for (a band is trim, not a part); a hair outside the drum so
   * it neither sinks into it nor flickers on it.
   */
  override band(cu: number, cv: number, r: number, z: number, color: number, alpha = 0.6, _width = 1): void {
    const pts: V3[] = [];
    for (let i = 0; i <= DISC_SIDES; i += 1) {
      const a = (i / DISC_SIDES) * Math.PI * 2;
      pts.push(this.world([cu + Math.cos(a) * r * 1.03, cv + Math.sin(a) * r * 1.03, z]));
    }
    this.emitLine(pts, color, 1, alpha, false);
  }

  // faceCircle and facePanel are the base kit's: they build their points in
  // cell space and hand them to `poly`, and faceCircle's roundness comes from
  // `at()`, which is already the world's.

  /** A path a helper filled or stroked through `k.g`, in the 2D points `at()` gave it. */
  recorded(kind: 'fill' | 'stroke', path: SubPath, style: PaintStyle): void {
    const pts: V3[] = [];
    for (const p of path.pts) {
      const w = this.seen.get(p.x)?.get(p.y);
      // A point that did not come from at() has no 3D behind it: skip the path.
      if (!w) return;
      pts.push(w);
    }
    if (kind === 'fill') {
      this.emitPoly(pts, style.color, style.alpha);
      return;
    }
    // A closed one-pixel ink loop is a silhouette hull, which only means anything from the 2D camera.
    if (path.closed && style.width <= 1 && style.color === this.t.ink) return;
    const first = pts[0];
    this.emitLine(path.closed && first ? [...pts, first] : pts, style.color, style.width, style.alpha, true);
  }

  /** Emit the thick strokes, merged: the same path stroked twice is one beam, the later colour at the wider width. */
  flushBeams(): void {
    for (const beam of this.beams.values()) this.b.beam(beam.pts, beam.r, beam.color, beam.kind);
    this.beams.clear();
  }

  /** Which material a fill of this colour and opacity goes to, or null for a tint that real lighting replaces. */
  private kindOf(color: number, alpha: number): Kind | null {
    if (alpha < TINT_ALPHA && color !== GLASS) return null;
    if (glowish(color, this.glow)) return 'glow';
    return alpha < GLASS_ALPHA ? 'glass' : 'solid';
  }

  /** The next decal's points, nudged toward the isometric viewer (see LAYER_M). */
  private nudge(pts: readonly V3[]): V3[] {
    // Metres to squares, split evenly over the three axes.
    const d = (LAYER_M + Math.min(this.layer, LAYER_MAX) * LAYER_STEP_M) / (this.unitM * Math.sqrt(3));
    this.layer += 1;
    return pts.map((p): V3 => [p[0] + d, p[1] + d, p[2] + d]);
  }

  private emitPoly(world: readonly V3[], color: number, alpha: number): void {
    if (world.length < 3) return;
    const kind = this.kindOf(color, alpha);
    if (!kind) return;
    const pts = this.nudge(world);
    if (pts.length <= 4 || isPlanar(pts)) {
      this.b.polygon(pts, color, kind);
      return;
    }
    // Not flat: a hull traced round a silhouette (a stone, a log pile). A fan
    // from its centre makes a closed lump of it rather than a torn sheet.
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of pts) {
      cx += p[0] / pts.length;
      cy += p[1] / pts.length;
      cz += p[2] / pts.length;
    }
    const c: V3 = [cx, cy, cz];
    for (let i = 0; i < pts.length; i += 1) this.b.polygon([c, pts[i]!, pts[(i + 1) % pts.length]!], color, kind);
  }

  private emitLine(world: readonly V3[], color: number, width: number, alpha: number, nudge: boolean): void {
    if (world.length < 2) return;
    if (alpha < TINT_ALPHA && color !== GLASS) return;
    if (width >= BEAM_WIDTH) {
      const kind: Kind = glowish(color, this.glow) ? 'glow' : alpha < GLASS_ALPHA ? 'glass' : 'solid';
      const r = width / PX_PER_SQUARE;
      const key = world.map((p) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`).join(';');
      const prev = this.beams.get(key);
      if (prev) {
        prev.color = color;
        prev.kind = kind;
        prev.r = Math.max(prev.r, r);
      } else {
        this.beams.set(key, { pts: [...world], r, color, kind });
      }
      return;
    }
    if (!this.hairlines) return;
    this.b.line(nudge ? this.nudge(world) : world, color);
  }
}

const warned = new Set<TileProp>();

/**
 * Build one tile's prop design into `b`, standing on the floor at
 * `ctx.baseY`, at its real size over the squares it covers from its anchor
 * cell (`col`, `row`) — the same placement, tones, seed and glow colour the
 * 2D map draws it with. No-op for a tile without a design. A design that
 * throws is skipped (and reported once), not allowed to sink the whole floor.
 */
export function buildProp(b: MeshBuilder, def: TileDrawDef, col: number, row: number, ctx: PropBuildCtx, opts: BuildPropOptions = {}): void {
  const prop = def.prop;
  if (prop === undefined) return;
  const unitM = ctx.unitM > 0 ? ctx.unitM : 1;
  const base = parseColor(def.colors[0], 0x3b3f45);
  const accent = parseColor(def.colors[1], 0x5a6068);
  const glow = def.emissive === undefined ? null : parseColor(def.emissive, accent);
  const m: SceneMetrics = { cell: CELL, cols: 1, rows: 1, unitM, offset: { x: 0, y: 0 }, opacity: 0, projection: 'iso' };
  const rec = new PathRecorder();
  const k = new PropKit3D(
    b,
    rec,
    m,
    col,
    row,
    tonesOf(base, accent),
    cellSeed(col, row),
    propPlacement(prop, unitM),
    { ...ctx, unitM },
    glow,
    opts.sink ?? 0,
    opts.hairlines ?? true,
  );
  try {
    // A flat prop still needs a little height to build with, as in 2D.
    DESIGNS[prop](k, def.height !== undefined && def.height > 0 ? def.height : 0.5, glow);
  } catch (err) {
    if (!warned.has(prop)) {
      warned.add(prop);
      console.warn(`lab3d: the ${prop} design failed to build`, err);
    }
  }
  k.flushBeams();
}
