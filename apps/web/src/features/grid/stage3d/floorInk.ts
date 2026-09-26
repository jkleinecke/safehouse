/**
 * The 3D stage's pen: the flat overlays, laid on the floor.
 *
 * Everything that lies flat on the map — the grid, the GM's walls, doors and
 * zones, the fog tint and its outlines, the light-map wash, the ruler, the AoE
 * and every draft — is drawn by a function in `stage/layers.ts`,
 * `stage/lightLayer.ts` or `stage/fx.ts` that is handed an `Ink`. The 2D stage
 * hands it a pixi Graphics. This is the 3D stage's Ink: it records the same
 * calls and turns them into a couple of unlit meshes lying on the floor in
 * view, so the 3D map gets every one of those overlays without a second copy
 * of the drawing code and without pixi in its chunk.
 *
 * ## Coordinates
 *
 * The draw functions are handed TOP-DOWN metrics — the scene's, with the
 * projection forced to 'topdown' — in which grid point g is drawn at
 * (g + offset) × cell world px. FloorInk undoes exactly that, g = px / cell −
 * offset, and lays the result on the 3D world's floor: x = grid x, z = grid y,
 * at the height of the floor in view plus a small lift. A stroke's width is in
 * the same world px, so a width-3 stroke is 3 / cell squares wide.
 *
 * ## What a paint does
 *
 * Pixi's rules, because the drawing code was written against a Graphics:
 *   - `moveTo`/`lineTo` build polylines; `poly`, `rect`, `circle` and
 *     `ellipse` add closed shapes (a circle or ellipse as a polygon of enough
 *     sides to look round at the size it is). `poly(points, false)` fills as a
 *     polygon but strokes open.
 *   - `fill` and `stroke` paint every shape built since the last paint. A
 *     paint straight after the other kind, with nothing built between, paints
 *     the same shapes again: `circle().fill().stroke()` rings the disc.
 *   - `cut` makes the shapes built since the last paint holes in the LAST
 *     shape of the paint before it — the fog's cover rectangle with each
 *     revealed region punched out. Holes accumulate, one `cut` per region.
 *     A cut also reaches the paint chained with that one (fill, then stroke
 *     the same shape), and a stroke outlines its holes as well, as pixi does.
 *
 * ## Batching and order
 *
 * One drawing (everything between two `clear`s) becomes at most two meshes:
 * one triangle mesh holding every fill and every wide stroke in the order they
 * were painted, and one `LineSegments` for the hairlines (a `pixelLine`
 * stroke, or one no more than 1 px wide). Keeping fills and wide strokes in
 * one mesh keeps the 2D map's painter's order inside a layer — a door's knob
 * over its leaf, a note's tack over its edge — because triangles in one draw
 * call blend in the order they are listed. The hairlines draw just after.
 *
 * The meshes are rebuilt once per drawing, never per frame: the calls are
 * recorded, and the buffers are built at the end of the task that drew them
 * (a microtask), which is before the next frame can be drawn. `flush()` builds
 * them at once, for a caller that draws inside a frame hook.
 *
 * Every vertex carries its colour and opacity (a 4-component colour), so one
 * shared unlit, depth-tested, non-depth-writing material serves every
 * FloorInk: walls and figures standing in front of an overlay hide it, and
 * overlays never hide each other or anything else.
 *
 * ## Under the cover, or over it
 *
 * Each ink says which of the players' masks hide it (`cover`, `cover.ts`),
 * after the 2D layer its drawing sits in: the light-map wash lies under the
 * shroud and the fog, the grid and the doors over the shroud and under the
 * fog, and the templates, the ruler and the drafts over both. There is one
 * shared pair of materials per answer.
 *
 * ## The recorder
 *
 * Recording the calls under pixi's rules is `RecordingInk`, which knows
 * nothing about three: this class turns its list into meshes, and the fog
 * mask's `CanvasInk` (`masks.ts`) paints the same list on a canvas.
 */
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  ShapeUtils,
  SRGBColorSpace,
  Vector2,
} from 'three';
import type { SceneMetrics } from '../geometry.js';
import type { Ink, InkFill, InkStroke } from '../stage/ink.js';
import { applyCover, exemptFromCover, type CoverMode } from './cover.js';

/** One shape as it was drawn: flat `[x0, y0, x1, y1, …]` in world px. */
export interface InkShape {
  pts: number[];
  closed: boolean;
}

/**
 * What a paint applies to: the shapes built before it, and the holes cut
 * from its last shape since. A fill and a stroke chained on the same shapes
 * share one, so a cut reaches both.
 */
export interface InkPath {
  shapes: InkShape[];
  holes: InkShape[];
}

/**
 * One paint, as recorded: a fill, or a stroke — `hair` when it is one screen
 * pixel wide (`pixelLine`, or no more than 1 px).
 */
export type InkOp =
  | { kind: 'fill'; path: InkPath; color: number; alpha: number }
  | { kind: 'stroke'; path: InkPath; color: number; alpha: number; width: number; hair: boolean };

/**
 * Which of the viewer's masks hide an ink (`cover.ts`): `full` the shroud and
 * the fog, `fog` the fog alone, `none` neither (drawn over the cover, as the
 * 2D map's fx layer is drawn over its fog).
 */
export type InkCover = CoverMode | 'none';

/** A linear-space colour and its opacity, as the vertex colours carry it. */
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Where a FloorInk draws. */
export interface FloorInkOptions {
  /**
   * The TOP-DOWN metrics the draw functions are handed (the scene's, with
   * `projection: 'topdown'`). Read once per drawing, to turn world px back
   * into grid points.
   */
  metrics: () => SceneMetrics;
  /** World y of the floor in view (`level × storey`). Read on every `flush`. */
  floorY: () => number;
  /**
   * How far above the floor the ink lies, in squares. Default 0.03: over the
   * floor's own decals (a rug is 0.01 up per layer), under anything standing.
   */
  lift?: number;
  /**
   * Draw order among the other overlays: higher draws later, over lower. The
   * hairlines draw at `renderOrder + 0.5`. Default 0.
   */
  renderOrder?: number;
  /**
   * Which masks hide what this ink draws (`InkCover`), as the 2D map layers
   * the same drawing under or over its shroud and fog. Default `full`: hidden
   * by both, the safe answer for anything that is part of the map.
   */
  cover?: InkCover;
}

/** Default lift above the floor, in squares. */
const DEFAULT_LIFT = 0.03;
/** Two points closer than this (squares) are the same point. */
const EPS = 1e-7;
/**
 * How far a mitred corner may reach, in half-widths, before it is cut short.
 * Pixi's own limit is 10; a lower one keeps a hairpin in a ruler from
 * spiking across the map.
 */
const MITER_LIMIT = 4;

/** Sides for a circle of radius `r` world px: a dozen for a door knob, ~80 for a 10-square blast. */
function sidesFor(r: number): number {
  return Math.min(96, Math.max(12, Math.ceil(Math.sqrt(Math.abs(r)) * 3)));
}

/** The materials every FloorInk under the same cover shares, made on first use and kept. */
const shared = new Map<InkCover, { tris: MeshBasicMaterial; lines: LineBasicMaterial }>();

function materials(cover: InkCover): { tris: MeshBasicMaterial; lines: LineBasicMaterial } {
  const known = shared.get(cover);
  if (known !== undefined) return known;
  // Unlit and untone-mapped, so the palette comes out as the 2D map's hex
  // does; depth-tested so what stands in front hides it; not depth-writing,
  // so overlays never hide each other or what is drawn after them; and
  // pulled a hair toward the camera so the floor never shows through.
  const tris = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    toneMapped: false,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  // A flat sheet has no back to draw first.
  tris.forceSinglePass = true;
  tris.name = `floor-ink:${cover}`;
  const lines = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    fog: false,
  });
  lines.name = `floor-ink:${cover}:hairline`;
  for (const m of [tris, lines]) {
    if (cover === 'none') exemptFromCover(m);
    else applyCover(m, cover);
  }
  const made = { tris, lines };
  shared.set(cover, made);
  return made;
}

/** Overlays are never what a click lands on: the stage picks the floor itself. */
function noRaycast(): void {}

const tmpColor = new Color();

function rgbaOf(color: number, alpha: number): Rgba {
  tmpColor.setHex(color & 0xffffff, SRGBColorSpace);
  return { r: tmpColor.r, g: tmpColor.g, b: tmpColor.b, a: Math.min(1, Math.max(0, alpha)) };
}

/** One mesh's worth of vertices: positions on the floor sheet, colours with alpha. */
class Buf {
  readonly pos: number[] = [];
  readonly col: number[] = [];

  constructor(private readonly y: number) {}

  vert(x: number, z: number, c: Rgba): void {
    this.pos.push(x, this.y, z);
    this.col.push(c.r, c.g, c.b, c.a);
  }

  tri(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, c: Rgba): void {
    this.vert(ax, az, c);
    this.vert(bx, bz, c);
    this.vert(cx, cz, c);
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 4));
    return g;
  }
}

/**
 * A shape's points as grid (x, z), flat, with repeated points dropped — and,
 * when `closing`, a last point that only repeats the first.
 */
function toGrid(s: InkShape, k: number, ox: number, oz: number, closing: boolean): number[] {
  const out: number[] = [];
  const p = s.pts;
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = p[i]! * k - ox;
    const z = p[i + 1]! * k - oz;
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2]! - x) < EPS && Math.abs(out[n - 1]! - z) < EPS) continue;
    out.push(x, z);
  }
  const n = out.length;
  if (closing && n >= 4 && Math.abs(out[0]! - out[n - 2]!) < EPS && Math.abs(out[1]! - out[n - 1]!) < EPS) {
    out.length = n - 2;
  }
  return out;
}

/** Is the quad a→b→c→d convex (either winding)? */
function convexQuad(p: readonly number[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = i * 2;
    const b = ((i + 1) % 4) * 2;
    const c = ((i + 2) % 4) * 2;
    const cross = (p[b]! - p[a]!) * (p[c + 1]! - p[b + 1]!) - (p[b + 1]! - p[a + 1]!) * (p[c]! - p[b]!);
    if (Math.abs(cross) < EPS * EPS) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function fan(buf: Buf, p: readonly number[], c: Rgba): void {
  const n = p.length / 2;
  for (let i = 1; i + 1 < n; i += 1) {
    buf.tri(p[0]!, p[1]!, p[i * 2]!, p[i * 2 + 1]!, p[i * 2 + 2]!, p[i * 2 + 3]!, c);
  }
}

function vectors(p: readonly number[]): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i + 1 < p.length; i += 2) out.push(new Vector2(p[i]!, p[i + 1]!));
  return out;
}

/**
 * Fill one polygon (any winding, convex or not) with its holes punched out.
 * Triangles and quads without holes are fanned; everything else goes through
 * three's earcut, as pixi's own fills do.
 */
function fillShape(buf: Buf, p: number[], holes: number[][], c: Rgba): void {
  const n = p.length / 2;
  if (n < 3) return;
  if (holes.length === 0 && (n === 3 || (n === 4 && convexQuad(p)))) {
    fan(buf, p, c);
    return;
  }
  const contour = vectors(p);
  const hs = holes.map(vectors);
  let faces: number[][];
  try {
    faces = ShapeUtils.triangulateShape(contour, hs);
  } catch {
    faces = [];
  }
  if (faces.length === 0) {
    // A polygon earcut could make nothing of (self-crossing, degenerate):
    // a fan at least covers it, and is only wrong where it was already.
    if (holes.length === 0) fan(buf, p, c);
    return;
  }
  const all = hs.length === 0 ? contour : contour.concat(...hs);
  for (const f of faces) {
    const a = all[f[0]!];
    const b = all[f[1]!];
    const d = all[f[2]!];
    if (a === undefined || b === undefined || d === undefined) continue;
    buf.tri(a.x, a.y, b.x, b.y, d.x, d.y, c);
  }
}

/**
 * Stroke a polyline as a flat quad strip `hw` squares either side of it, with
 * mitred corners (cut short past `MITER_LIMIT`) and butt ends — pixi's
 * defaults. Adjacent quads share their corner vertices, so a translucent
 * stroke does not darken where it turns.
 */
function strokeShape(buf: Buf, p: number[], closedIn: boolean, hw: number, c: Rgba): void {
  const n = p.length / 2;
  if (n < 2 || hw <= 0) return;
  const closed = closedIn && n >= 3;
  const ox: number[] = new Array<number>(n).fill(0);
  const oz: number[] = new Array<number>(n).fill(0);
  // The left-hand unit normal of the segment from point i to point j.
  const normal = (i: number, j: number): [number, number] => {
    const dx = p[j * 2]! - p[i * 2]!;
    const dz = p[j * 2 + 1]! - p[i * 2 + 1]!;
    const len = Math.hypot(dx, dz) || 1;
    return [-dz / len, dx / len];
  };
  for (let i = 0; i < n; i += 1) {
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    const [ax, az] = hasPrev ? normal((i - 1 + n) % n, i) : [0, 0];
    const [bx, bz] = hasNext ? normal(i, (i + 1) % n) : [0, 0];
    if (!hasPrev) {
      ox[i] = bx * hw;
      oz[i] = bz * hw;
      continue;
    }
    if (!hasNext) {
      ox[i] = ax * hw;
      oz[i] = az * hw;
      continue;
    }
    let mx = ax + bx;
    let mz = az + bz;
    const len = Math.hypot(mx, mz);
    if (len < 1e-6) {
      // The line doubles straight back: square it off.
      ox[i] = bx * hw;
      oz[i] = bz * hw;
      continue;
    }
    mx /= len;
    mz /= len;
    const cos = mx * bx + mz * bz;
    const reach = hw / Math.max(cos, 1 / MITER_LIMIT);
    ox[i] = mx * reach;
    oz[i] = mz * reach;
  }
  const segments = closed ? n : n - 1;
  for (let s = 0; s < segments; s += 1) {
    const i = s;
    const j = (s + 1) % n;
    const x0 = p[i * 2]!;
    const z0 = p[i * 2 + 1]!;
    const x1 = p[j * 2]!;
    const z1 = p[j * 2 + 1]!;
    const lx0 = x0 + ox[i]!;
    const lz0 = z0 + oz[i]!;
    const rx0 = x0 - ox[i]!;
    const rz0 = z0 - oz[i]!;
    const lx1 = x1 + ox[j]!;
    const lz1 = z1 + oz[j]!;
    const rx1 = x1 - ox[j]!;
    const rz1 = z1 - oz[j]!;
    buf.tri(lx0, lz0, lx1, lz1, rx1, rz1, c);
    buf.tri(lx0, lz0, rx1, rz1, rx0, rz0, c);
  }
}

/** Stroke a polyline one screen pixel wide: its segments as line pairs. */
function hairline(buf: Buf, p: number[], closed: boolean, c: Rgba): void {
  const n = p.length / 2;
  if (n < 2) return;
  for (let i = 0; i + 1 < n; i += 1) {
    buf.vert(p[i * 2]!, p[i * 2 + 1]!, c);
    buf.vert(p[i * 2 + 2]!, p[i * 2 + 3]!, c);
  }
  if (closed && n >= 3) {
    buf.vert(p[(n - 1) * 2]!, p[(n - 1) * 2 + 1]!, c);
    buf.vert(p[0]!, p[1]!, c);
  }
}

/**
 * The recording half of an `Ink`: every call an overlay makes, kept as the
 * list of paints (`ops`) since the last `clear`, with pixi's rules applied
 * (see "What a paint does" above). Knows nothing of what the list becomes: a
 * subclass hears of every change through `changed`, and of a `clear` through
 * `cleared` just before.
 */
export abstract class RecordingInk implements Ink {
  /** The paints since the last `clear`, in order. */
  protected ops: InkOp[] = [];
  /** Shapes built since the last paint. */
  private shapes: InkShape[] = [];
  /** The polyline `moveTo`/`lineTo` are extending, not yet in `shapes`. */
  private current: InkShape | null = null;
  /** Anything built since the last paint — pixi's "tick", which decides whether a paint reuses the last one's shapes. */
  private fresh = false;
  /** Where the pen is: a `lineTo` with no `moveTo` before it starts here, as on a Graphics. */
  private penX = 0;
  private penY = 0;

  /** The recording changed: a paint, a cut or a clear. */
  protected abstract changed(): void;

  /** The recording is about to be told it changed because it was cleared. */
  protected cleared(): void {}

  /** Drop everything recorded, telling nobody. */
  protected forget(): void {
    this.ops = [];
    this.shapes = [];
    this.current = null;
    this.fresh = false;
  }

  clear(): this {
    this.forget();
    this.cleared();
    this.changed();
    return this;
  }

  moveTo(x: number, y: number): this {
    this.endCurrent();
    this.current = { pts: [x, y], closed: false };
    this.pen(x, y);
    return this;
  }

  lineTo(x: number, y: number): this {
    if (this.current === null) this.current = { pts: [this.penX, this.penY], closed: false };
    this.current.pts.push(x, y);
    this.pen(x, y);
    return this;
  }

  poly(points: number[], close?: boolean): this {
    this.addShape(points.slice(), close !== false);
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this {
    this.addShape([x, y, x + w, y, x + w, y + h, x, y + h], true);
    return this;
  }

  circle(x: number, y: number, radius: number): this {
    return this.ellipse(x, y, radius, radius);
  }

  ellipse(x: number, y: number, radiusX: number, radiusY: number): this {
    const rx = Math.abs(radiusX);
    const ry = Math.abs(radiusY);
    const sides = sidesFor(Math.max(rx, ry));
    const pts: number[] = [];
    for (let i = 0; i < sides; i += 1) {
      const a = (i / sides) * Math.PI * 2;
      pts.push(x + Math.cos(a) * rx, y + Math.sin(a) * ry);
    }
    this.addShape(pts, true);
    return this;
  }

  fill(style: InkFill): this {
    const path = this.pathFor('stroke');
    this.ops.push({ kind: 'fill', path, color: style.color, alpha: style.alpha });
    this.changed();
    return this;
  }

  stroke(style: InkStroke): this {
    const path = this.pathFor('fill');
    const hair = style.pixelLine === true || style.width <= 1;
    this.ops.push({ kind: 'stroke', path, color: style.color, alpha: style.alpha, width: style.width, hair });
    this.changed();
    return this;
  }

  cut(): this {
    const holes = this.takeShapes();
    const last = this.ops[this.ops.length - 1];
    if (holes.length === 0 || last === undefined) return this;
    last.path.holes.push(...holes);
    this.changed();
    return this;
  }

  private pen(x: number, y: number): void {
    this.penX = x;
    this.penY = y;
    this.fresh = true;
  }

  private endCurrent(): void {
    if (this.current !== null && this.current.pts.length >= 4) this.shapes.push(this.current);
    this.current = null;
  }

  private addShape(pts: number[], closed: boolean): void {
    this.endCurrent();
    if (pts.length >= 4) this.shapes.push({ pts, closed });
    const n = pts.length;
    if (n >= 2) this.pen(pts[n - 2]!, pts[n - 1]!);
    else this.fresh = true;
  }

  /** The shapes built since the last paint, taken: the next ones start afresh. */
  private takeShapes(): InkShape[] {
    this.endCurrent();
    const taken = this.shapes;
    this.shapes = [];
    return taken;
  }

  /**
   * What a paint paints: the last paint's shapes again when it was of the
   * `other` kind and nothing has been built since (fill, then stroke the same
   * shape), else the shapes built since.
   */
  private pathFor(other: InkOp['kind']): InkPath {
    const last = this.ops[this.ops.length - 1];
    const reuse = !this.fresh && last !== undefined && last.kind === other;
    this.fresh = false;
    if (reuse) return last.path;
    return { shapes: this.takeShapes(), holes: [] };
  }
}

/**
 * An `Ink` that draws on the 3D floor. One per overlay layer, like the 2D
 * stage's one Graphics per layer: add `group` to the three.js scene, hand the
 * FloorInk to the layer's draw function whenever its key changes, and it
 * shows what was drawn from the next frame on.
 */
export class FloorInk extends RecordingInk {
  /** Holds this ink's meshes; sits at the floor's height. Add it to the scene. */
  readonly group = new Group();

  private readonly metrics: () => SceneMetrics;
  private readonly floorY: () => number;
  private readonly lift: number;
  private readonly renderOrder: number;
  private readonly cover: InkCover;

  private dirty = false;
  private scheduled = false;
  private disposed = false;
  private tris: Mesh<BufferGeometry, MeshBasicMaterial> | null = null;
  private lines: LineSegments<BufferGeometry, LineBasicMaterial> | null = null;

  constructor(options: FloorInkOptions) {
    super();
    this.metrics = options.metrics;
    this.floorY = options.floorY;
    this.lift = options.lift ?? DEFAULT_LIFT;
    this.renderOrder = options.renderOrder ?? 0;
    this.cover = options.cover ?? 'full';
    this.group.name = 'floor-ink';
  }

  /**
   * Build the meshes for what has been drawn since they were last built, and
   * move the drawing to the floor `floorY` now names. Runs by itself at the
   * end of the task that drew; call it directly when drawing inside a frame
   * hook, or after the floor in view changed under an unchanged drawing.
   */
  flush(): void {
    if (this.disposed) return;
    this.group.position.y = this.floorY();
    if (!this.dirty) return;
    this.dirty = false;
    this.dropMeshes();
    if (this.ops.length === 0) return;

    const m = this.metrics();
    const k = 1 / m.cell;
    const ox = m.offset.x;
    const oz = m.offset.y;
    const tri = new Buf(this.lift);
    const hair = new Buf(this.lift);

    for (const op of this.ops) {
      if (!(op.alpha > 0)) continue;
      const c = rgbaOf(op.color, op.alpha);
      const { shapes, holes } = op.path;
      if (op.kind === 'fill') {
        const cutOut = holes.map((h) => toGrid(h, k, ox, oz, true)).filter((h) => h.length >= 6);
        shapes.forEach((s, i) => {
          // Pixi's rule: the holes belong to the last shape of the path.
          fillShape(tri, toGrid(s, k, ox, oz, true), i === shapes.length - 1 ? cutOut : [], c);
        });
        continue;
      }
      const hw = (op.width * k) / 2;
      for (const s of shapes.concat(holes)) {
        const pts = toGrid(s, k, ox, oz, s.closed);
        if (op.hair) hairline(hair, pts, s.closed, c);
        else strokeShape(tri, pts, s.closed, hw, c);
      }
    }

    const mats = materials(this.cover);
    if (!tri.empty) {
      const mesh = new Mesh(tri.geometry(), mats.tris);
      mesh.renderOrder = this.renderOrder;
      mesh.raycast = noRaycast;
      this.group.add(mesh);
      this.tris = mesh;
    }
    if (!hair.empty) {
      const lines = new LineSegments(hair.geometry(), mats.lines);
      lines.renderOrder = this.renderOrder + 0.5;
      lines.raycast = noRaycast;
      this.group.add(lines);
      this.lines = lines;
    }
  }

  /** Free the meshes and take the group out of the scene. The ink draws nothing after this. */
  dispose(): void {
    this.disposed = true;
    this.forget();
    this.dropMeshes();
    this.group.removeFromParent();
  }

  protected override cleared(): void {
    this.dropMeshes();
  }

  protected changed(): void {
    this.markDirty();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.flush();
    });
  }

  private dropMeshes(): void {
    for (const o of [this.tris, this.lines]) {
      if (o === null) continue;
      o.geometry.dispose();
      o.removeFromParent();
    }
    this.tris = null;
    this.lines = null;
    this.group.clear();
  }
}

/** The type-level promise: a FloorInk is an Ink, so every flat overlay's draw function takes one. */
type AssertInk<T extends Ink> = T;
export type FloorInkAsInk = AssertInk<FloorInk>;
