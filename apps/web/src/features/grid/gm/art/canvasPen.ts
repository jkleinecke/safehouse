/**
 * The pen the Build palette's tile pictures are painted with, and a Canvas2D
 * one to paint them on — no pixi.
 *
 * The palette shows each tile as the 2D painter draws it (`drawTiles`, with
 * its door and window designs, its water and its furniture), and that painter
 * was written against a pixi v8 `Graphics`. Rather than teach a hundred
 * drawing functions a new API, they draw through `ArtPen`: exactly the part
 * of a Graphics they call, with the signatures a Graphics has, so the
 * pictures come out as they did when pixi drew them. `CanvasPen` is that pen
 * over a `CanvasRenderingContext2D`, and copies pixi's behaviour wherever the
 * painter leans on it.
 *
 * ## Pixi's rules, as the painter uses them
 *
 * Read from pixi 8's own source (`GraphicsContext`, `ShapePath`,
 * `buildContextBatches`, `buildLine`, `buildPixelLine`,
 * `convertFillInputToFillStyle`):
 *
 *   - **Paths.** `moveTo` starts a sub-path, `lineTo` extends it (a point
 *     equal to the one before is dropped), `closePath` closes it and ends it.
 *     `ellipse` and `circle` add a whole closed shape. A sub-path of one point
 *     is no shape at all. An unclosed sub-path still fills (as its polygon);
 *     it strokes as an open line.
 *   - **Paints.** `fill` and `stroke` paint everything built since the last
 *     paint, then start afresh from the last point the path went through.
 *   - **Fill, then stroke the same shape.** A paint with nothing built since
 *     the last paint, when that paint was of the OTHER kind, paints the last
 *     paint's shapes again. The painter depends on it: an inked disc is an
 *     ellipse filled, then stroked, with nothing between. The rule is general,
 *     so it also re-paints in the odd case where the painter did not mean it
 *     to (a clipped pattern line with nothing left on the kept side strokes
 *     the fill before it) — as pixi did, so the pictures match.
 *   - **Each shape on its own.** Pixi triangulates and blends every shape of
 *     a paint separately, so two sub-paths of one translucent fill that
 *     overlap are darker where they overlap, and no sub-path is a hole in
 *     another. So is every shape here: one `fill()` or `stroke()` per shape.
 *   - **Styles** are laid over pixi's defaults, not over the last style: an
 *     omitted `alpha` is 1, an omitted `pixelLine` is false. Colours are
 *     0xRRGGBB. Strokes are centred on the path (alignment 0.5) with butt
 *     caps, mitred joins and a miter limit of 10 — which are the canvas's own
 *     defaults too, set anyway so nothing else that used the context leaks in.
 *   - **`pixelLine`** is drawn as GL lines, one pixel of whatever it is drawn
 *     into wide however the drawing is scaled; here, one canvas pixel under
 *     the context's current transform. Any other stroke is `width` world px.
 *   - **An ellipse or circle with a radius of zero or less** draws nothing.
 *     (A canvas would throw on a negative radius.)
 *   - **`beginPath`** throws away what was built but leaves pixi's count of
 *     "built since the last paint" alone; **`clear`** throws away everything,
 *     the last paint included — here, the canvas's pixels too.
 *
 * ## What is not copied
 *
 * The rules above are the path bookkeeping, and they held exactly when pixi
 * was removed: every catalogue set's palette sheet, drawn once into a pixi
 * 8.20.1 GraphicsContext and once through this pen, painted the same shapes
 * in the same order, colours, opacities and widths. What differs is how the
 * shapes become pixels, and all of it is a fraction of a pixel along an edge:
 *
 *   - pixi multisampled the palette's render, and a canvas covers edges
 *     analytically. So two opaque shapes that share an edge off the pixel
 *     grid can let a faint line of whatever is under them show through,
 *     where multisampling left none.
 *   - pixi drew an ellipse as a polygon (a few dozen sides at these sizes);
 *     a canvas draws the curve.
 *   - pixi built a thick stroke as a strip of triangles, so a translucent
 *     line that doubled back over itself was darker where it overlapped. A
 *     canvas covers it once. In the palette that is a couple of pixels of
 *     the generator's lifting eye, which folds flat in plan.
 *   - pixi's extract read the render back premultiplied and saved it as if
 *     it were not, so a translucent pixel came out darker than it was drawn.
 *     Every swatch shows a square drawn over its set's opaque floor, so none
 *     of those pixels was ever shown.
 */
import type { InkStroke } from '../../stage/ink.js';
import type { PropPen } from '../../stage/props.js';

/**
 * A fill as the painter gives one: a 0xRRGGBB colour and its opacity. The
 * opacity may be left out, meaning opaque — pixi's default, and the painter
 * leaves it out for every solid face.
 */
export interface ArtFill {
  color: number;
  alpha?: number;
}

/**
 * What the palette's 2D painter draws with: the props' pen (`PropPen`, whose
 * designs it draws furniture with) plus what the tile, door, window and
 * water drawing use beyond it — `circle`, `beginPath`, `clear`, and a fill
 * that may leave its alpha out. The contract is pixi's (above). A pixi
 * `Graphics` satisfies this type, so nothing that drew into one needs to
 * change to draw into a `CanvasPen`.
 */
export interface ArtPen extends PropPen {
  /** A circle about (x, y), as a whole closed shape. */
  circle(x: number, y: number, radius: number): this;
  /** Fill what was built since the last paint; `alpha` defaults to 1. */
  fill(style: ArtFill): this;
  /**
   * Throw away what was built since the last paint, without painting it — a
   * pattern clipped away to nothing hands its fill an empty path this way.
   */
  beginPath(): this;
  /** Forget everything drawn so far. */
  clear(): this;
}

/** One shape a paint covers: a polygon (closed, or an open line) or an ellipse. */
type Shape =
  | { kind: 'poly'; pts: number[]; closed: boolean }
  | { kind: 'ellipse'; x: number; y: number; rx: number; ry: number };

/**
 * An `ArtPen` that paints onto a Canvas2D as it is drawn, under pixi's rules
 * (module comment). Draw in world px; the context's transform, set by the
 * caller before drawing, says where world px land on the canvas. The pen
 * owns the context's paint state (colours, alpha, line style) while it draws.
 */
export class CanvasPen implements ArtPen {
  /** Shapes built since the last paint, in the order they were built. */
  private shapes: Shape[] = [];
  /** The sub-path `moveTo`/`lineTo` are extending, as flat x, y pairs; not yet in `shapes`. */
  private open: number[] | null = null;
  /** Anything built since the last paint — pixi's "tick". */
  private built = false;
  /** The last paint and the shapes it painted, for the fill-then-stroke rule. */
  private last: { op: 'fill' | 'stroke'; shapes: Shape[] } | null = null;
  /** The last point a path went through: where a path picks up after a paint, as on a Graphics. */
  private penX = 0;
  private penY = 0;

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  moveTo(x: number, y: number): this {
    this.built = true;
    this.endOpen(false);
    this.open = [x, y];
    this.penX = x;
    this.penY = y;
    return this;
  }

  lineTo(x: number, y: number): this {
    this.built = true;
    if (this.open === null) this.open = [this.penX, this.penY];
    const n = this.open.length;
    if (this.open[n - 2] !== x || this.open[n - 1] !== y) this.open.push(x, y);
    this.penX = x;
    this.penY = y;
    return this;
  }

  closePath(): this {
    this.built = true;
    this.endOpen(true);
    return this;
  }

  ellipse(x: number, y: number, rx: number, ry: number): this {
    this.built = true;
    this.endOpen(false);
    this.shapes.push({ kind: 'ellipse', x, y, rx, ry });
    return this;
  }

  circle(x: number, y: number, radius: number): this {
    return this.ellipse(x, y, radius, radius);
  }

  beginPath(): this {
    this.shapes = [];
    this.open = null;
    return this;
  }

  clear(): this {
    this.shapes = [];
    this.open = null;
    this.last = null;
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    return this;
  }

  fill(style: ArtFill): this {
    const shapes = this.take('fill');
    const alpha = style.alpha ?? 1;
    if (!(alpha > 0) || shapes.length === 0) return this;
    const { ctx } = this;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = css(style.color);
    for (const s of shapes) {
      if (!drawable(s)) continue;
      ctx.beginPath();
      trace(ctx, s, false);
      ctx.fill();
    }
    return this;
  }

  stroke(style: InkStroke): this {
    const shapes = this.take('stroke');
    const width = style.pixelLine === true ? onePixel(this.ctx) : style.width;
    if (!(style.alpha > 0) || !(width > 0) || shapes.length === 0) return this;
    const { ctx } = this;
    ctx.globalAlpha = Math.min(1, style.alpha);
    ctx.strokeStyle = css(style.color);
    ctx.lineWidth = width;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 10;
    for (const s of shapes) {
      if (!drawable(s)) continue;
      ctx.beginPath();
      trace(ctx, s, true);
      ctx.stroke();
    }
    return this;
  }

  /** End the open sub-path, keeping it as a shape if it has a second point. */
  private endOpen(closed: boolean): void {
    if (this.open !== null && this.open.length >= 4) this.shapes.push({ kind: 'poly', pts: this.open, closed });
    this.open = null;
  }

  /**
   * What a paint of kind `op` covers, taken: the last paint's shapes again
   * when it was of the other kind and nothing has been built since, else
   * everything built since (the open sub-path as an open line). Either way
   * the path starts afresh at the pen, as pixi's does after every paint.
   */
  private take(op: 'fill' | 'stroke'): Shape[] {
    const last = this.last;
    let shapes: Shape[];
    if (!this.built && last !== null && last.op !== op) {
      shapes = last.shapes;
    } else {
      this.endOpen(false);
      shapes = this.shapes;
    }
    this.last = { op, shapes };
    this.shapes = [];
    this.open = [this.penX, this.penY];
    this.built = false;
    return shapes;
  }
}

/** A shape that paints anything: pixi drops an ellipse with no size. */
function drawable(s: Shape): boolean {
  return s.kind === 'poly' || (s.rx > 0 && s.ry > 0);
}

/** Put one shape on the context's path. A stroked shape closes if it is closed; a fill closes itself. */
function trace(ctx: CanvasRenderingContext2D, s: Shape, stroking: boolean): void {
  if (s.kind === 'ellipse') {
    ctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
    ctx.closePath();
    return;
  }
  const { pts } = s;
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  if (stroking && s.closed) ctx.closePath();
}

/** One canvas pixel, in the world px the context's transform is drawing in. */
function onePixel(ctx: CanvasRenderingContext2D): number {
  const t = ctx.getTransform();
  const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c));
  return scale > 0 ? 1 / scale : 1;
}

/** 0xRRGGBB as a CSS colour. */
function css(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}
