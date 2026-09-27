/**
 * The cover's data (P2 of the move to 3D): what the viewer of the 3D map may
 * not see, as the two masks the cover's shader patch reads (`cover.ts`), and
 * the same masks on the CPU for the DOM that stands over the canvas.
 *
 * ## Who is covered by what — the 2D map's rules, read the same way
 *
 *   - The FOG is the players' opaque cover with every revealed region cut out
 *     (`drawFog` with `isGm` false), for every role but the GM: the players'
 *     phones and laptops and the TV (`display`) alike. Ground revealed AS
 *     EXPLORED (P6) is not cut clean: it carries `EXPLORED_ALPHA`, short of
 *     total, so the map is drawn there dimmed, as remembered, not discarded. The GM gets no fog
 *     mask: the GM's fog is the see-through tint `drawFog` draws for the GM,
 *     which the stage lays on the floor as a `FloorInk`, and the GM sees the
 *     map through it.
 *   - The SHROUD is drawn for whoever has one (`StageSceneState.shroud`, with
 *     at least one square in sight): a player's own runner's sightline, or the
 *     GM's "See as" lens. It darkens by the 2D scrim's amounts, kept in
 *     `plan/shroud.ts` — `SHROUD_ALPHA` for a player bound by it, the lighter
 *     `GM_SHROUD_ALPHA` when the state says it is the GM's lens
 *     (`ShroudState.gm`) — and so never hides outright.
 *
 * ## The two masks
 *
 *   - FOG: `drawFog` itself, handed a `CanvasInk` — an `Ink` over a Canvas2D
 *     — and top-down metrics mapped onto a canvas laid over the scene
 *     rectangle and the two-square margin `drawFog` pads its cover with, at
 *     the detail's px a square (`FOG_DETAIL`: fewer at Low, and fewer on a
 *     map too big for its longest side). The fog's shape is therefore
 *     exactly the 2D one. Only the canvas's alpha is kept, one byte a pixel,
 *     and that is both the texture and the CPU copy. The canvas, its scratch
 *     layer, the bytes and the texture are kept from one fog to the next
 *     while the size holds (`FogRasteriser`): a reveal mid-fight on a phone
 *     or the TV repaints and uploads, it does not allocate a map's worth of
 *     canvases again.
 *   - SHROUD: one byte a square, 255 where the viewer can see and 0 where
 *     not, filtered linearly on the GPU (and here) so its edge is soft.
 *
 * Each is rebuilt only when its key moves, as the 2D map redrew them: the fog
 * when its key (`fogKey`) or the metrics change, the shroud when its key
 * (`shroudKey`, `plan/shroud.ts`) or the grid's size does.
 *
 * ## The fog lid
 *
 * Where the fog is total the cover discards, and a discarded square of the
 * floor in view would let a slanted view down to the storey below it. The
 * masks carry the lid that closes it (`lid`, `cover.ts`
 * `createFogLidMaterial`): a sheet over the fog's rectangle, just under the
 * floor in view (`setFloor`), shown while there is a fog to be total and a
 * storey below to hide.
 *
 * ## Failing closed
 *
 * A fog that cannot be rasterised (no canvas to draw on) covers the whole map
 * rather than none of it: a player then sees nothing, not everything.
 */
import type { Point, Scene } from '@safehouse/contracts';
import { Mesh, PlaneGeometry, type DataTexture, type Material } from 'three';
import { metricsKey, type SceneMetrics } from '../geometry.js';
import { GM_SHROUD_ALPHA, SHROUD_ALPHA } from '../plan/shroud.js';
import type { LabelSink } from '../stage/ink.js';
import { fogKey, shroudKey } from '../stage/keys.js';
import { drawFog } from '../stage/layers.js';
import type { ShroudState, StageSceneState } from '../types.js';
import {
  COVER_MARGIN,
  claimCover,
  createFogLidMaterial,
  maskTexture,
  releaseCover,
  setCover,
  type CoverMask,
  type CoverMode,
} from './cover.js';
import { RecordingInk, type InkShape } from './floorInk.js';

/**
 * How finely the fog is rasterised: px a square at most, and the canvas's
 * longest side at most — a big map gets fewer px a square rather than a
 * texture a phone cannot hold. A revealed region's edge is soft over about
 * one px. `low` is for Low quality (phones, the TV): a quarter of the
 * pixels to paint, read back and upload at each reveal.
 */
const FOG_DETAIL = {
  full: { pxPerSquare: 12, maxPx: 2048 },
  low: { pxPerSquare: 8, maxPx: 1024 },
} as const;

/** Which of the `FOG_DETAIL` rows a stage rasterises its fog at. */
export type FogDetail = keyof typeof FOG_DETAIL;

/** The margin round the scene rectangle the fog canvas covers, in squares: `drawFog` pads its cover by two squares. */
const FOG_PAD = 2;

/**
 * How far under the floor in view the fog lid lies, in squares: under the
 * floor's own surface and over everything below it (the slab's underside is
 * a quarter of a square down), and close enough to the surface that no ray
 * slips under a revealed square's edge into the storey below.
 */
const LID_DROP = 0.005;

// ---------------------------------------------------------------------------
// CanvasInk
// ---------------------------------------------------------------------------

/** A palette colour and opacity as a canvas style. */
function rgba(color: number, alpha: number): string {
  const c = color & 0xffffff;
  return `rgba(${(c >> 16) & 0xff}, ${(c >> 8) & 0xff}, ${c & 0xff}, ${Math.min(1, Math.max(0, alpha))})`;
}

/** Add one shape to the context's current path, closed when `close`. */
function trace(ctx: CanvasRenderingContext2D, s: InkShape, close: boolean): void {
  const p = s.pts;
  if (p.length < 4) return;
  ctx.moveTo(p[0]!, p[1]!);
  for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
  if (close) ctx.closePath();
}

/**
 * An `Ink` over a Canvas2D. The overlays' calls are recorded under pixi's
 * rules (`RecordingInk`) and painted in one go by `paint`: fills and strokes
 * as a pixi Graphics painted them, and a fill that had holes cut from it painted
 * through a layer of its own, so the holes punch that fill alone (not what
 * was painted before it) and two holes that overlap stay one hole.
 *
 * The overlays draw in world px; world px (x, y) lands on canvas px
 * (x·k + tx, y·k + ty), which `place` may change between drawings. A
 * hairline (`pixelLine`, or 1 px or less) is one canvas px wide. Recording
 * needs no canvas, so whether a drawing shows anything at all (`empty`) is
 * known before one is made. The scratch layer is kept from one paint to the
 * next while the canvas's size holds, until `release`.
 */
export class CanvasInk extends RecordingInk {
  /** The scratch layer a holed fill is painted on, made when first needed. */
  private layer: CanvasRenderingContext2D | null = null;

  constructor(
    private k: number,
    private tx: number,
    private ty: number,
  ) {
    super();
  }

  /** Map world px onto canvas px anew, for the next drawing. */
  place(k: number, tx: number, ty: number): void {
    this.k = k;
    this.tx = tx;
    this.ty = ty;
  }

  /** Nothing recorded that would show: no paint, or only transparent ones. */
  get empty(): boolean {
    return !this.ops.some((op) => op.alpha > 0);
  }

  /** Paint what has been recorded onto `ctx`'s canvas, over whatever is on it. */
  paint(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.k, 0, 0, this.k, this.tx, this.ty);
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 10;
    ctx.lineCap = 'butt';
    for (const op of this.ops) {
      if (!(op.alpha > 0)) continue;
      const style = rgba(op.color, op.alpha);
      const { shapes, holes } = op.path;
      if (op.kind === 'fill') {
        shapes.forEach((s, i) => {
          // Pixi's rule: the holes belong to the last shape of the path.
          if (holes.length > 0 && i === shapes.length - 1) {
            this.fillHoled(ctx, s, holes, style);
            return;
          }
          ctx.beginPath();
          trace(ctx, s, true);
          ctx.fillStyle = style;
          ctx.fill();
        });
        continue;
      }
      ctx.beginPath();
      // A stroke outlines the holes too, as pixi's did.
      for (const s of shapes.concat(holes)) trace(ctx, s, s.closed);
      ctx.strokeStyle = style;
      ctx.lineWidth = op.hair ? 1 / this.k : op.width;
      ctx.stroke();
    }
  }

  /** Give back the scratch layer's memory (a phone's browser counts every canvas's). */
  release(): void {
    if (this.layer === null) return;
    this.layer.canvas.width = 0;
    this.layer.canvas.height = 0;
    this.layer = null;
  }

  protected changed(): void {
    // Painted on demand (`paint`), not as it is drawn.
  }

  /** One shape filled with `holes` punched out of it alone, composited onto the canvas. */
  private fillHoled(ctx: CanvasRenderingContext2D, shape: InkShape, holes: readonly InkShape[], style: string): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    let layer = this.layer;
    if (layer === null || layer.canvas.width !== w || layer.canvas.height !== h) {
      const canvas = ctx.canvas.ownerDocument.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      layer = canvas.getContext('2d');
      if (layer === null) {
        // No room for a layer: the fill without its holes covers more, never less.
        ctx.beginPath();
        trace(ctx, shape, true);
        ctx.fillStyle = style;
        ctx.fill();
        return;
      }
      this.layer = layer;
    }
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.globalCompositeOperation = 'source-over';
    layer.clearRect(0, 0, w, h);
    layer.setTransform(this.k, 0, 0, this.k, this.tx, this.ty);
    layer.beginPath();
    trace(layer, shape, true);
    layer.fillStyle = style;
    layer.fill();
    // Each hole on its own, so overlapping holes of either winding are one hole.
    layer.globalCompositeOperation = 'destination-out';
    layer.fillStyle = '#000';
    for (const hole of holes) {
      layer.beginPath();
      trace(layer, hole, true);
      layer.fill();
    }
    layer.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  }
}

/** The fog's labels are the GM's; the players' cover has none. */
const NO_LABELS: LabelSink = { put: () => {}, sweep: () => {} };

// ---------------------------------------------------------------------------
// The masks
// ---------------------------------------------------------------------------

/** One mask: its bytes (row 0 north), laid over a rectangle of the floor in world units, and its texture. */
interface Raster {
  data: Uint8Array;
  /** Its size in texels. */
  w: number;
  h: number;
  /** The rectangle: its north-west corner (world x, z = grid x, y) and size in squares. */
  x0: number;
  z0: number;
  width: number;
  depth: number;
  texture: DataTexture;
  /**
   * The fog rasteriser's own, written again for the next fog of the same
   * size (`FogRasteriser`): its texture is the rasteriser's to free, not the
   * holder's.
   */
  kept?: boolean;
}

/** The whole rectangle covered: what a fog that could not be drawn stands for. */
function coveredRect(x0: number, z0: number, width: number, depth: number): Raster {
  const data = new Uint8Array([255]);
  return { data, w: 1, h: 1, x0, z0, width, depth, texture: maskTexture(data, 1, 1) };
}

/**
 * The players' fog cover, rasterised: `drawFog` drawn onto a canvas over the
 * scene rectangle and its pad, its alpha kept as the mask's bytes. What a
 * phone would otherwise make afresh at every reveal — the canvas, the
 * scratch layer a holed fill is painted on, the bytes, the texture — is kept
 * and written again while the size holds, and given back by `release`.
 */
class FogRasteriser {
  private readonly ink = new CanvasInk(1, 0, 0);
  private ctx: CanvasRenderingContext2D | null = null;
  /** The last raster made from the canvas, reused for the next of its size. */
  private raster: Raster | null = null;

  /**
   * The fog cover of `scene`, as `drawFog` draws it in top-down metrics `m`,
   * at `detail`. Null when `drawFog` draws nothing (an unfogged scene). The
   * raster may be the one handed out last time, its bytes and texture
   * written again (`kept`).
   */
  draw(scene: Scene, m: SceneMetrics, detail: FogDetail): Raster | null {
    const { pxPerSquare, maxPx } = FOG_DETAIL[detail];
    // Grid point g lies at canvas px (g − (x0, z0)) × s; the overlays draw it
    // at world px (g + offset) × cell, so world px maps with k = s / cell and
    // a shift of the pad.
    const x0 = -m.offset.x - FOG_PAD;
    const z0 = -m.offset.y - FOG_PAD;
    const across = m.cols + FOG_PAD * 2;
    const down = m.rows + FOG_PAD * 2;
    const s = Math.max(1e-3, Math.min(pxPerSquare, maxPx / Math.max(1, across, down)));
    const w = Math.max(1, Math.ceil(across * s));
    const h = Math.max(1, Math.ceil(down * s));
    const whole = (): Raster => coveredRect(x0, z0, w / s, h / s);

    const ink = this.ink;
    ink.place(s / m.cell, FOG_PAD * s, FOG_PAD * s);
    try {
      drawFog(ink, NO_LABELS, scene, m, false);
    } catch (err) {
      console.warn('[stage3d] the fog could not be drawn; the whole map is covered', err);
      return whole();
    }
    if (ink.empty) return null;
    try {
      const ctx = this.context(w, h);
      if (ctx === null) return whole();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ink.paint(ctx);
      const px = ctx.getImageData(0, 0, w, h).data;
      let r = this.raster;
      if (r === null || r.w !== w || r.h !== h) {
        r?.texture.dispose();
        const data = new Uint8Array(w * h);
        r = { data, w, h, x0, z0, width: w / s, depth: h / s, texture: maskTexture(data, w, h), kept: true };
        this.raster = r;
      } else {
        r.x0 = x0;
        r.z0 = z0;
        r.width = w / s;
        r.depth = h / s;
        r.texture.needsUpdate = true;
      }
      const data = r.data;
      for (let i = 0; i < data.length; i += 1) data[i] = px[i * 4 + 3]!;
      return r;
    } catch (err) {
      console.warn('[stage3d] the fog could not be drawn; the whole map is covered', err);
      return whole();
    }
  }

  /** The canvas to paint on, `w × h`: the kept one, sized anew only when the size changed. */
  private context(w: number, h: number): CanvasRenderingContext2D | null {
    if (typeof document === 'undefined') return null;
    let ctx = this.ctx;
    if (ctx === null) {
      ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      if (ctx === null) return null;
      this.ctx = ctx;
    }
    const canvas = ctx.canvas;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return ctx;
  }

  /** Give back every canvas's memory (a phone's browser counts them all) and the kept texture. */
  release(): void {
    this.ink.release();
    this.ink.clear();
    if (this.ctx !== null) {
      this.ctx.canvas.width = 0;
      this.ctx.canvas.height = 0;
      this.ctx = null;
    }
    this.raster?.texture.dispose();
    this.raster = null;
  }
}

/**
 * The shroud as one byte a square over `cols × rows`, 255 where the viewer
 * can see. Written into `reuse` (and its texture) when it is the same size.
 * Null when there is no viewpoint, which darkens nothing.
 */
function rasterShroud(shroud: ShroudState | null, cols: number, rows: number, reuse: Raster | null): Raster | null {
  if (shroud === null || shroud.visible.size === 0 || !(cols >= 1) || !(rows >= 1)) return null;
  const same = reuse !== null && reuse.w === cols && reuse.h === rows;
  const data = same ? reuse.data.fill(0) : new Uint8Array(cols * rows);
  for (const key of shroud.visible) {
    const comma = key.indexOf(',');
    if (comma < 0) continue;
    const col = Number(key.slice(0, comma));
    const row = Number(key.slice(comma + 1));
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cols || row >= rows) continue;
    data[row * cols + col] = 255;
  }
  if (same) {
    reuse.texture.needsUpdate = true;
    return reuse;
  }
  return { data, w: cols, h: rows, x0: 0, z0: 0, width: cols, depth: rows, texture: maskTexture(data, cols, rows) };
}

/**
 * A mask's value at world (x, z) — 0 … 1, filtered linearly between texel
 * centres and clamped to the edge, as the GPU samples it — or null outside
 * its rectangle and `COVER_MARGIN`, where it covers nothing.
 */
function sample(r: Raster, x: number, z: number): number | null {
  const lx = x - r.x0;
  const lz = z - r.z0;
  if (!(lx >= -COVER_MARGIN && lz >= -COVER_MARGIN && lx <= r.width + COVER_MARGIN && lz <= r.depth + COVER_MARGIN)) return null;
  const u = Math.min(1, Math.max(0, lx / r.width)) * r.w - 0.5;
  const v = Math.min(1, Math.max(0, lz / r.depth)) * r.h - 0.5;
  const fu = u - Math.floor(u);
  const fv = v - Math.floor(v);
  const col = (i: number) => Math.min(r.w - 1, Math.max(0, i));
  const row = (j: number) => Math.min(r.h - 1, Math.max(0, j));
  const i0 = col(Math.floor(u));
  const i1 = col(Math.floor(u) + 1);
  const j0 = row(Math.floor(v));
  const j1 = row(Math.floor(v) + 1);
  const at = (i: number, j: number): number => (r.data[j * r.w + i] ?? 0) / 255;
  const top = at(i0, j0) + (at(i1, j0) - at(i0, j0)) * fu;
  const bottom = at(i0, j1) + (at(i1, j1) - at(i0, j1)) * fu;
  return top + (bottom - top) * fv;
}

function maskOf(r: Raster | null, amount: number): CoverMask | null {
  return r === null || !(amount > 0) ? null : { map: r.texture, x0: r.x0, z0: r.z0, width: r.width, depth: r.depth, amount };
}

/** What an update changed: the fog (which also hides lights and shadows), the shroud, either, or neither. */
export interface CoverChange {
  fog: boolean;
  shroud: boolean;
}

/**
 * One stage's cover: its two masks, kept in line with the stage's state by
 * `update`, shown on every covered material while this owns the cover
 * (made the owner when made), and asked about square by square by
 * `coveredAt`; and the fog lid (`lid`), which the stage adds to its scene.
 */
export class CoverMasks {
  /**
   * The fog lid (`cover.ts` `createFogLidMaterial`): a sheet over the fog's
   * rectangle, just under the floor in view (`setFloor`), shown while a fog
   * is shown and there is a storey under that floor. The stage adds it to
   * its scene; its geometry and material are freed with the masks.
   */
  readonly lid: Mesh;
  private readonly rasteriser = new FogRasteriser();
  private detail: FogDetail;
  private fog: Raster | null = null;
  private fogAmount = 0;
  private shroud: Raster | null = null;
  private shroudAmount = 0;
  private lastFogKey: string | null = null;
  private lastShroudKey: string | null = null;
  /** Whether the floor in view has a storey under it for the lid to hide. */
  private storeyBelow = false;
  private disposed = false;

  /** `detail` is how finely the fog is rasterised (`FOG_DETAIL`): `low` at Low quality. */
  constructor(detail: FogDetail = 'full') {
    this.detail = detail;
    claimCover(this);
    this.lid = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), createFogLidMaterial());
    this.lid.name = 'cover-fog-lid';
    this.lid.visible = false;
    this.lid.castShadow = false;
    this.lid.receiveShadow = false;
    // Never what a click lands on.
    this.lid.raycast = () => {};
  }

  /**
   * Rasterise the fog at `detail` from the next `update` on (a quality change
   * on the live stage). True when that is a change, and the caller should
   * update.
   */
  setDetail(detail: FogDetail): boolean {
    if (detail === this.detail || this.disposed) return false;
    this.detail = detail;
    this.lastFogKey = null;
    return true;
  }

  /** Floor `level` is in view, its surface at world height `y`: the lid lies just under it, and only over a storey. */
  setFloor(level: number, y: number): void {
    if (this.disposed) return;
    this.storeyBelow = level > 0;
    this.lid.position.y = y - LID_DROP;
    this.placeLid();
  }

  /**
   * Bring the masks in line with `state`, drawn in `m` — the stage's TOP-DOWN
   * metrics, the ones every flat overlay draws in. Says what changed: on any
   * change the caller asks for a frame and lays the labels out again; on a
   * fog change it also works out again what the fog hides beyond the
   * materials — the lights the tokens under it carry, the shadow maps.
   */
  update(state: StageSceneState, m: SceneMetrics): CoverChange {
    const change: CoverChange = { fog: false, shroud: false };
    if (this.disposed) return change;
    const gone: DataTexture[] = [];

    // The GM sees the map through the fog: no fog mask at all.
    const isGm = state.role === 'gm';
    const fk = isGm ? 'gm' : `${fogKey(state)}|${metricsKey(m)}|${this.detail}`;
    if (fk !== this.lastFogKey) {
      this.lastFogKey = fk;
      const was = this.fog;
      this.fog = isGm ? null : this.rasteriser.draw(state.scene, m, this.detail);
      if (was !== null && was !== this.fog && was.kept !== true) gone.push(was.texture);
      // No fog to show: the rasteriser's canvases are not kept for one.
      if (this.fog === null) this.rasteriser.release();
      this.fogAmount = this.fog === null ? 0 : 1;
      change.fog = true;
    }

    // Whoever has a sightline to be shown: the player's runner, or the GM's lens.
    const shroud = state.shroud ?? null;
    const sk = `${shroudKey(shroud)}|${m.cols}x${m.rows}`;
    if (sk !== this.lastShroudKey) {
      this.lastShroudKey = sk;
      const was = this.shroud;
      this.shroud = rasterShroud(shroud, m.cols, m.rows, was);
      if (was !== null && was !== this.shroud) gone.push(was.texture);
      this.shroudAmount = this.shroud === null || shroud === null ? 0 : shroud.gm ? GM_SHROUD_ALPHA : SHROUD_ALPHA;
      change.shroud = true;
    }

    if (change.fog || change.shroud) setCover(this, maskOf(this.fog, this.fogAmount), maskOf(this.shroud, this.shroudAmount));
    if (change.fog) this.placeLid();
    for (const t of gone) t.dispose();
    return change;
  }

  /** Lay the lid over the fog's rectangle and its margin, or take it away when it has nothing to hide. */
  private placeLid(): void {
    const fog = this.fog;
    const on = fog !== null && this.fogAmount > 0 && this.storeyBelow;
    this.lid.visible = on;
    if (!on) return;
    const width = fog.width + COVER_MARGIN * 2;
    const depth = fog.depth + COVER_MARGIN * 2;
    this.lid.scale.set(width, 1, depth);
    this.lid.position.x = fog.x0 - COVER_MARGIN + width / 2;
    this.lid.position.z = fog.z0 - COVER_MARGIN + depth / 2;
  }

  /**
   * How covered grid point `at` is, 0 clear … 1 hidden, from the same bytes
   * and by the same sum the shader uses: the fog, and — for `full`, the
   * default — the shroud's darkening. The fog alone reads 0 on live ground,
   * `EXPLORED_ALPHA` on ground shown as remembered, and 1 under the whole
   * cover; a player's plates hide from the first threshold the stage reads
   * it at (not live), and labels only from the second (hidden).
   */
  coveredAt(at: Point, mode: CoverMode = 'full'): number {
    let k = 0;
    if (this.fog !== null && this.fogAmount > 0) k = (sample(this.fog, at.x, at.y) ?? 0) * this.fogAmount;
    if (mode === 'full' && this.shroud !== null && this.shroudAmount > 0) {
      const seen = sample(this.shroud, at.x, at.y);
      if (seen !== null) k = Math.max(k, (1 - seen) * this.shroudAmount);
    }
    return k;
  }

  /** Let go of the cover (nothing is covered any more, if this still owned it) and free the textures, the canvases and the lid. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    releaseCover(this);
    if (this.fog?.kept !== true) this.fog?.texture.dispose();
    this.rasteriser.release();
    this.shroud?.texture.dispose();
    this.fog = null;
    this.shroud = null;
    this.lid.removeFromParent();
    this.lid.geometry.dispose();
    (this.lid.material as Material).dispose();
  }
}
