/**
 * Two small round buttons — ↺ and ↻ — beside the selected piece of furniture
 * while building: the R / Shift+R of the keyboard, for a GM with a mouse or a
 * finger. DOM over the canvas like the selection's handles (`selection.ts`),
 * laid out after every frame so they follow the view as it pans and zooms.
 *
 * Unlike everything else in the overlay they take a click — and keep it: a
 * press on one never reaches the map's pointer, so it neither drags nor
 * deselects what it is turning. One press, one turn; nothing asks first.
 */
import type { Point } from '@safehouse/contracts';
import { C } from '../stage/colors.js';

const css = (color: number): string => `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;

/** A button's size on screen, px. */
const BUTTON_PX = 22;
/** The gap between the box's corner and the buttons, px. */
const GAP_PX = 6;

/** Events that stay with the buttons rather than reaching the map under them. */
const KEPT = ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'contextmenu'] as const;

export class RotateButtons {
  private readonly el: HTMLDivElement;
  /** The box's four corners on the floor, grid units; null when nothing is shown. */
  private corners: Point[] | null = null;
  /** Hidden for now (a drag or a paste is under way), whatever is selected. */
  private suppressed = false;
  /** The transform last written, so an unmoved bar is not written again. */
  private laid = '';

  constructor(
    overlay: HTMLElement,
    onRotate: (dir: 1 | -1) => void,
  ) {
    const doc = overlay.ownerDocument;
    const el = doc.createElement('div');
    el.dataset['testid'] = 'prop-rotate';
    el.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'display:flex',
      `gap:4px`,
      'pointer-events:auto',
      'visibility:hidden',
    ].join(';');
    const button = (label: string, title: string, dir: 1 | -1): HTMLButtonElement => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.style.cssText = [
        `width:${BUTTON_PX}px`,
        `height:${BUTTON_PX}px`,
        'padding:0',
        'border-radius:50%',
        'box-sizing:border-box',
        `border:1.5px solid ${css(C.magenta)}`,
        `background:${css(C.panel)}e6`,
        `color:${css(C.ink)}`,
        'font:13px/1 Inter,system-ui,sans-serif',
        'cursor:pointer',
        'display:flex',
        'align-items:center',
        'justify-content:center',
      ].join(';');
      b.addEventListener('click', () => onRotate(dir));
      return b;
    };
    el.append(button('↺', 'Rotate left (Shift+R)', -1), button('↻', 'Rotate right (R)', 1));
    for (const type of KEPT) el.addEventListener(type, (e) => e.stopPropagation());
    overlay.appendChild(el);
    this.el = el;
  }

  /**
   * Show the buttons by the box from `min` to `max` (inclusive squares), or
   * hide them (null).
   */
  set(box: { min: { col: number; row: number }; max: { col: number; row: number } } | null): void {
    this.corners =
      box === null
        ? null
        : [
            { x: box.min.col, y: box.min.row },
            { x: box.max.col + 1, y: box.min.row },
            { x: box.max.col + 1, y: box.max.row + 1 },
            { x: box.min.col, y: box.max.row + 1 },
          ];
    this.laid = '';
  }

  /** Hide them while a drag or a paste is under way; show them again after. */
  setSuppressed(suppressed: boolean): void {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    this.laid = '';
  }

  /**
   * Put the buttons just right of the box's right-most corner on screen, as
   * `project` (grid point on the floor → host px) has the view now.
   */
  layout(project: (grid: Point) => Point): void {
    let at: Point | null = null;
    if (this.corners !== null && !this.suppressed) {
      for (const c of this.corners) {
        const s = project(c);
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
        if (at === null || s.x > at.x) at = s;
      }
    }
    const t = at === null ? 'hidden' : `translate(${(at.x + GAP_PX).toFixed(1)}px,${(at.y - BUTTON_PX / 2).toFixed(1)}px)`;
    if (t === this.laid) return;
    this.laid = t;
    if (at === null) {
      this.el.style.visibility = 'hidden';
      return;
    }
    this.el.style.transform = t;
    this.el.style.visibility = 'visible';
  }

  dispose(): void {
    this.el.remove();
    this.corners = null;
  }
}
