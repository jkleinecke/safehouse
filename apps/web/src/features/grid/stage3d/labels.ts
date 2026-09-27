/**
 * The 3D stage's labels: DOM elements over the canvas — the `LabelSink` the
 * flat overlays put their text through (`stage/ink.ts`), as `FloorInk` is the
 * Ink they draw with.
 *
 * A WebGL canvas holds no text, and the 2D stage's pooled pixi `Text` would
 * pull pixi into the 3D chunk, so each label is an absolutely positioned
 * element in a layer of its own over the canvas, pooled by key the same way
 * (`LabelPool`), and never in the way of a click (`pointer-events: none`).
 *
 * A label arrives in the TOP-DOWN world px the overlays draw with, and is
 * kept as the grid point that is (g = px / cell − offset, as `FloorInk` does).
 * `layout` places every label through the camera — the stage calls it after
 * any frame in which the view moved — and a label put between layouts is
 * placed at once with the last camera it was given. A label whose anchor the
 * viewer may not see (`setCover`: a player's fog) is hidden, as the fog
 * covers the 2D map's labels under it.
 *
 * The two looks match the 2D map's (`stage/textLabels.ts`):
 *   - a `tag` (a zone's or fog region's name) is 12px Inter outlined in the
 *     ground colour, upright on the screen, and grows and shrinks with the
 *     zoom the way a world-space label on the 2D map does;
 *   - a `note` is a GM note's dark 12px text on 15px lines, wrapped at the
 *     note's width, and lies ON the floor with the paper `FloorInk` draws
 *     under it — skewed with the floor in isometric, turned with it when the
 *     view turns — so the text stays inside its box at every zoom and angle.
 */
import type { Point } from '@safehouse/contracts';
import type { SceneMetrics } from '../geometry.js';
import { C } from '../stage/colors.js';
import { LabelPool, type InkLabel, type LabelLook } from '../stage/ink.js';
import { NOTE_FONT_PX, NOTE_LINE_PX } from '../stage/notes.js';

/** Maps a grid point on the floor in view to host px — `ViewCamera.project` at zero lift. */
export type FloorProjector = (grid: Point) => Point;

/** Where a label goes, kept between layouts. */
interface Placed {
  at: Point;
  look: LabelLook;
  anchorX: number;
  anchorY: number;
}

/**
 * The floor's projection for one layout: the linear part, per world px (the
 * px the overlays draw in), and how much an upright label is scaled.
 */
interface Frame {
  a: number;
  b: number;
  c: number;
  d: number;
  tagScale: number;
}

const hex = (color: number): string => `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;

const GROUND = hex(C.ground);
/**
 * The 2D tag's 3px ground-coloured stroke, as an outline of text shadows:
 * `-webkit-text-stroke` draws over the glyph (it would thin the letters), and
 * a stroke painted under the fill is not supported everywhere. The markers'
 * labels (`markers.ts`) wear it too.
 */
export const TAG_OUTLINE = [
  [-1.5, 0],
  [1.5, 0],
  [0, -1.5],
  [0, 1.5],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]
  .map(([x, y]) => `${x}px ${y}px 0 ${GROUND}`)
  .join(', ');

/** The largest stretch the 2×2 map [a c; b d] gives any direction: the zoom along the floor where it is not foreshortened. */
function largestStretch(a: number, b: number, c: number, d: number): number {
  const s = a * a + b * b + c * c + d * d;
  const det = a * d - b * c;
  return Math.sqrt((s + Math.sqrt(Math.max(0, s * s - 4 * det * det))) / 2);
}

/**
 * A `LabelSink` of DOM elements over the 3D canvas. One per overlay layer,
 * like the 2D stage's one pool per layer; several can share a container.
 */
export class DomLabels extends LabelPool<HTMLElement> {
  /** This sink's own layer in the container: full-size, click-through, hidden when `layout` says so. */
  readonly layer: HTMLDivElement;

  private readonly placed = new Map<HTMLElement, Placed>();
  /** The transform `place` last wrote on each label ('' while hidden), so a label that has not moved costs no style write. */
  private readonly written = new Map<HTMLElement, string>();
  private project: FloorProjector | null = null;
  private frame: Frame | null = null;
  private visible = true;
  /** Whether the viewer may not see a label's anchor (`setCover`); null hides none. */
  private covered: ((at: Point) => boolean) | null = null;

  /**
   * `container` is the stage's overlay element over the canvas (positioned,
   * the canvas's size, in the host px `project` returns). `metrics` are the
   * TOP-DOWN metrics the overlays draw with, to turn their px into grid points.
   */
  constructor(
    container: HTMLElement,
    private readonly metrics: () => SceneMetrics,
  ) {
    super();
    const layer = container.ownerDocument.createElement('div');
    layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    container.appendChild(layer);
    this.layer = layer;
  }

  /**
   * Place every label through `project`, the floor-in-view projection of the
   * camera as it now stands, or hide them all when `visible` is false. Call
   * it after a frame in which the view moved, and after a resize; a label
   * whose place came out the same is not written again.
   */
  layout(project: FloorProjector, visible: boolean): void {
    this.project = project;
    this.visible = visible;
    const display = visible ? '' : 'none';
    if (this.layer.style.display !== display) this.layer.style.display = display;
    if (!visible) return;
    this.frame = this.frameFor(project);
    for (const [el, at] of this.placed) this.place(el, at);
  }

  /**
   * Hide every label whose anchor (a grid point) `covered` says the viewer may
   * not see — under a player's fog, as the 2D map's labels under its fog are
   * — or none, with null. Takes effect at the next `layout`, which the caller
   * asks for when the answer may have changed.
   */
  setCover(covered: ((at: Point) => boolean) | null): void {
    this.covered = covered;
  }

  /** Remove every label and the layer. The sink puts nothing after this. */
  dispose(): void {
    for (const el of this.pool.values()) el.remove();
    this.pool.clear();
    this.placed.clear();
    this.written.clear();
    this.layer.remove();
    this.project = null;
  }

  protected create(label: InkLabel): HTMLElement {
    const el = this.layer.ownerDocument.createElement('div');
    el.style.cssText =
      'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;user-select:none;' +
      'visibility:hidden;font-family:Inter, sans-serif;margin:0;padding:0;';
    this.style(el, label.look);
    this.layer.appendChild(el);
    return el;
  }

  protected show(el: HTMLElement, label: InkLabel): void {
    if (el.dataset.look !== label.look) this.style(el, label.look);
    if (el.textContent !== label.text) el.textContent = label.text;
    el.style.color = hex(label.color);
    if (label.look === 'note') el.style.width = `${label.wrap ?? 120}px`;
    const m = this.metrics();
    const placed: Placed = {
      at: { x: label.x / m.cell - m.offset.x, y: label.y / m.cell - m.offset.y },
      look: label.look,
      anchorX: label.anchorX,
      anchorY: label.anchorY,
    };
    this.placed.set(el, placed);
    if (this.project !== null && this.visible) {
      this.frame ??= this.frameFor(this.project);
      this.place(el, placed);
    }
  }

  protected drop(el: HTMLElement): void {
    this.placed.delete(el);
    this.written.delete(el);
    el.remove();
  }

  /** The look's own type settings, on first sight and if a key ever changes look. */
  private style(el: HTMLElement, look: LabelLook): void {
    el.dataset.look = look;
    const s = el.style;
    if (look === 'note') {
      s.fontSize = `${NOTE_FONT_PX}px`;
      s.lineHeight = `${NOTE_LINE_PX}px`;
      s.whiteSpace = 'pre-wrap';
      s.overflowWrap = 'anywhere';
      s.textShadow = 'none';
    } else {
      s.fontSize = '12px';
      s.lineHeight = '1.25';
      s.whiteSpace = 'pre';
      s.overflowWrap = 'normal';
      s.width = '';
      s.textShadow = TAG_OUTLINE;
    }
  }

  /**
   * The floor's projection, read off three projected points. The cameras are
   * orthographic, so it is affine and one reading serves every label.
   */
  private frameFor(project: FloorProjector): Frame | null {
    const cell = this.metrics().cell;
    const o = project({ x: 0, y: 0 });
    const ex = project({ x: 1, y: 0 });
    const ez = project({ x: 0, y: 1 });
    const a = (ex.x - o.x) / cell;
    const b = (ex.y - o.y) / cell;
    const c = (ez.x - o.x) / cell;
    const d = (ez.y - o.y) / cell;
    if (![a, b, c, d].every(Number.isFinite)) return null;
    return { a, b, c, d, tagScale: largestStretch(a, b, c, d) };
  }

  private place(el: HTMLElement, p: Placed): void {
    const project = this.project;
    const f = this.frame;
    if (project === null || f === null) return;
    const s = project(p.at);
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || this.covered?.(p.at) === true) {
      if (this.written.get(el) !== '') el.style.visibility = 'hidden';
      this.written.set(el, '');
      return;
    }
    const anchor = `translate(${-p.anchorX * 100}%, ${-p.anchorY * 100}%)`;
    const transform =
      p.look === 'note'
        ? `matrix(${f.a}, ${f.b}, ${f.c}, ${f.d}, ${s.x}, ${s.y}) ${anchor}`
        : `translate(${s.x}px, ${s.y}px) scale(${f.tagScale}) ${anchor}`;
    const was = this.written.get(el);
    if (was === transform) return;
    el.style.transform = transform;
    if (was === undefined || was === '') el.style.visibility = 'visible';
    this.written.set(el, transform);
  }
}
