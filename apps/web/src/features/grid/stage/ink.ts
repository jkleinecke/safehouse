/**
 * The pen the flat overlays draw with, and the labels they hang beside it —
 * pure, no renderer.
 *
 * Everything on the map that lies flat on the floor — the grid, the GM's
 * walls, zones and doors, the fog, camera cones, light reach, the light-map
 * wash, the AoE, the ruler and every draft — is drawn by a function that is
 * handed something to draw INTO. Until P5 the 2D stage handed them a pixi
 * `Graphics`, and the interface below is exactly the part of its API those
 * functions used, so the drawing code written for pixi carried over to the
 * 3D map unchanged. The 3D map hands them a `FloorInk`
 * (`stage3d/floorInk.ts`), which lays them on the floor as meshes, and the
 * players' fog mask a Canvas2D ink (`stage3d/masks.ts`).
 *
 * Text is the one thing a Graphics could not hold, so the labels those
 * functions used to make as pixi `Text` go through a `LabelSink` instead. The
 * 3D map's sinks are DOM (`stage3d/labels.ts`).
 */

/** A fill as the overlays give one: a 0xRRGGBB colour and its opacity. */
export interface InkFill {
  color: number;
  alpha: number;
}

/** A stroke as the overlays give one. */
export interface InkStroke {
  /** Line width, in the world px the shape was drawn in. */
  width: number;
  /** 0xRRGGBB. */
  color: number;
  alpha: number;
  /**
   * One device pixel wide whatever the zoom — pixi's `pixelLine`. The grid
   * uses it so a zoomed-out map is not a mesh of solid lines. A stand-in
   * that cannot draw one draws its thinnest line instead.
   */
  pixelLine?: boolean;
}

/**
 * The Graphics-shaped pen: what the overlay drawing code calls, and nothing
 * else. The contract is pixi's, because the 2D stage drew into a Graphics,
 * and the inks keep its rules:
 *
 *   - a path is built with `moveTo`/`lineTo`, or a closed shape is added
 *     with `poly`, `rect`, `circle` or `ellipse`;
 *   - `fill` and `stroke` paint the shapes built since the last paint, and
 *     can be chained (fill, then stroke the same shape);
 *   - `cut` punches the last shape out of what was filled before it — the
 *     fog uses it to open revealed regions in its cover;
 *   - `clear` throws everything away, and every draw function starts with it.
 *
 * Coordinates are world px in the metrics the caller drew with. Every method
 * returns the pen, so calls chain the way they do on a Graphics.
 */
export interface Ink {
  /** Forget everything drawn so far. */
  clear(): this;
  /** Start a new sub-path at (x, y). */
  moveTo(x: number, y: number): this;
  /** Extend the current path with a straight line to (x, y). */
  lineTo(x: number, y: number): this;
  /**
   * A polygon from flat `[x0, y0, x1, y1, …]` points. Its stroke closes back
   * to the first point unless `close` is `false`, pixi's rule.
   */
  poly(points: number[], close?: boolean): this;
  /** An axis-aligned rectangle, top-left at (x, y). */
  rect(x: number, y: number, w: number, h: number): this;
  /** A circle about (x, y). */
  circle(x: number, y: number, radius: number): this;
  /** An axis-aligned ellipse about (x, y) — a floor circle in isometric. */
  ellipse(x: number, y: number, radiusX: number, radiusY: number): this;
  /** Fill the shapes built since the last paint. */
  fill(style: InkFill): this;
  /** Stroke the path or shapes built since the last paint. */
  stroke(style: InkStroke): this;
  /** Punch the last shape out of what was filled before it. */
  cut(): this;
}

/** How a label is set. */
export type LabelLook =
  /** A one-line map label: 12px, outlined in the ground colour so it reads over anything. */
  | 'tag'
  /** A GM note's text: dark, 12px on 15px lines, wrapped at `wrap`, on the note's paper. */
  | 'note';

/** One label, as an overlay asks for it. */
export interface InkLabel {
  look: LabelLook;
  text: string;
  /** Where its anchor goes, in the same world px as the ink it sits beside. */
  x: number;
  y: number;
  /**
   * Which point of the label sits at (x, y), as fractions of its box: 0 its
   * left or top edge, 0.5 its middle, 1 its right or bottom edge.
   */
  anchorX: number;
  anchorY: number;
  /** Text colour, 0xRRGGBB. */
  color: number;
  /** For a note: the width, in world px, its text wraps at. */
  wrap?: number;
}

/**
 * Where an overlay puts its labels — one sink per overlay layer, used the way
 * a draw function uses its Ink. It puts every label it wants this time, each
 * under a key that stays the same from draw to draw, then calls `sweep`,
 * which takes away every label not put since the last sweep. A draw that puts
 * nothing and sweeps clears the layer's labels.
 */
export interface LabelSink {
  /** Show `label` under `key`: the one already there is updated, not replaced. */
  put(key: string, label: InkLabel): void;
  /** Drop every label that was not put since the previous sweep. */
  sweep(): void;
}

/**
 * The bookkeeping every `LabelSink` needs, whatever its labels are made of:
 * one item per key, made on first sight, updated on every put, and dropped
 * by the sweep after the draw that stopped putting it. A sink supplies how an
 * item is made, shown and dropped.
 *
 * `pool` can be handed in, so a stage that owns the map (and destroys what is
 * in it on teardown) keeps owning it.
 */
export abstract class LabelPool<T> implements LabelSink {
  private readonly seen = new Set<string>();

  constructor(protected readonly pool: Map<string, T> = new Map<string, T>()) {}

  put(key: string, label: InkLabel): void {
    let item = this.pool.get(key);
    if (item === undefined) {
      item = this.create(label);
      this.pool.set(key, item);
    }
    this.show(item, label);
    this.seen.add(key);
  }

  sweep(): void {
    for (const [key, item] of this.pool) {
      if (this.seen.has(key)) continue;
      this.drop(item);
      this.pool.delete(key);
    }
    this.seen.clear();
  }

  /** A new item for a key seen for the first time; `show` follows at once. */
  protected abstract create(label: InkLabel): T;
  /** Make `item` say and sit where `label` says. */
  protected abstract show(item: T, label: InkLabel): void;
  /** Take `item` away for good. */
  protected abstract drop(item: T): void;
}
