/**
 * Reader layout and zoom arithmetic (§15 "Devices": player views are designed
 * at 390 px).
 *
 * Two jobs, both pure so both are testable without a DOM:
 *
 *  1. **Fit.** A rulebook page is ~612×792 pt. On a 390 px phone it has to
 *     land inside the viewport with no horizontal scroll — the page the ref
 *     chip promised, whole, on the first frame.
 *  2. **Don't melt the phone.** pdf.js renders into a bitmap sized
 *     `css × devicePixelRatio`. A 3× phone pinched to 4× on a full page asks
 *     for ~26 megapixels, which on a three-year-old Android is a blank canvas
 *     and a reload. `planRender` caps the bitmap and lets CSS do the last bit
 *     of scaling: slightly soft beats not rendering at all.
 */

export interface Size {
  width: number;
  height: number;
}

/** The phone width every player view is designed against (§15). */
export const MOBILE_VIEWPORT_WIDTH = 390;

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 6;
/** One tap of the +/− buttons. */
export const ZOOM_STEP = 1.25;

/**
 * Bitmap ceiling. 4 MP is comfortably under the ~16 MP canvas-area limit
 * mobile Safari enforces and well under what a mid-range Android will hand out
 * for a short-lived canvas.
 */
export const MAX_CANVAS_PIXELS = 4_000_000;
/** Below this the page is too soft to read; we would rather clip than blur. */
export const MIN_PIXEL_RATIO = 0.75;

export type FitMode = 'width' | 'page';

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** One press of zoom-in (`+1`) or zoom-out (`-1`). */
export function nextZoom(zoom: number, direction: 1 | -1): number {
  return clampZoom(direction > 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP);
}

/** Live pinch: how far the two fingers have spread since the gesture began. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
  if (!(startDistance > 0) || !(distance > 0)) return clampZoom(startZoom);
  return clampZoom(startZoom * (distance / startDistance));
}

/** Euclidean distance between two touch points. */
export function touchDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Scale (CSS px per PDF point) that makes the page fit. `width` fills the
 * column — the right default for a phone reading one column of rules;
 * `page` fits both axes, for a landscape table spread.
 */
export function fitScale(page: Size, viewport: Size, mode: FitMode = 'width', padding = 0): number {
  const availableW = Math.max(1, viewport.width - padding * 2);
  const availableH = Math.max(1, viewport.height - padding * 2);
  if (!(page.width > 0) || !(page.height > 0)) return 1;
  const byWidth = availableW / page.width;
  if (mode === 'width') return byWidth;
  return Math.min(byWidth, availableH / page.height);
}

export interface RenderPlan {
  /** CSS size of the page element — never wider than the viewport at zoom 1. */
  cssWidth: number;
  cssHeight: number;
  /** Backing bitmap, after the megapixel cap. */
  canvasWidth: number;
  canvasHeight: number;
  /** CSS px per PDF point (fit × zoom). */
  scale: number;
  /** What to hand `page.getViewport({ scale })` — includes the pixel ratio. */
  renderScale: number;
  /** Effective device pixel ratio after capping. */
  pixelRatio: number;
  /** True when the megapixel cap pulled `pixelRatio` below the display's. */
  capped: boolean;
}

export interface PlanOptions {
  fitMode?: FitMode;
  /** Gutter around the page, in CSS px. */
  padding?: number;
}

/**
 * Everything the canvas needs for one page at one zoom level. Callers pass the
 * *unzoomed* page size from `page.getViewport({ scale: 1 })`.
 */
export function planRender(
  page: Size,
  viewport: Size,
  zoom: number,
  devicePixelRatio: number,
  opts: PlanOptions = {},
): RenderPlan {
  const padding = opts.padding ?? 0;
  const z = clampZoom(zoom);
  const scale = fitScale(page, viewport, opts.fitMode ?? 'width', padding) * z;
  const cssWidth = Math.max(1, page.width * scale);
  const cssHeight = Math.max(1, page.height * scale);

  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const budgetRatio = Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight));
  const pixelRatio = Math.max(MIN_PIXEL_RATIO, Math.min(dpr, budgetRatio));

  return {
    cssWidth,
    cssHeight,
    canvasWidth: Math.max(1, Math.floor(cssWidth * pixelRatio)),
    canvasHeight: Math.max(1, Math.floor(cssHeight * pixelRatio)),
    scale,
    renderScale: scale * pixelRatio,
    pixelRatio,
    capped: pixelRatio < dpr,
  };
}
