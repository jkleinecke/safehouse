import { describe, expect, it } from 'vitest';
import {
  MAX_CANVAS_PIXELS,
  MAX_ZOOM,
  MIN_ZOOM,
  MOBILE_VIEWPORT_WIDTH,
  clampZoom,
  fitScale,
  nextZoom,
  pinchZoom,
  planRender,
  touchDistance,
} from './layout.js';

/** A US-Letter rulebook page at scale 1, in PDF points. */
const LETTER = { width: 612, height: 792 };
/** The phone the player views are designed against (§15), minus browser chrome. */
const PHONE = { width: MOBILE_VIEWPORT_WIDTH, height: 720 };
const GUTTER = 8;

describe('fit at 390 px', () => {
  it('fits the page across the phone with room for the gutter', () => {
    const scale = fitScale(LETTER, PHONE, 'width', GUTTER);
    expect(LETTER.width * scale).toBeCloseTo(PHONE.width - GUTTER * 2, 5);
  });

  it('fits both axes in page mode', () => {
    const scale = fitScale(LETTER, PHONE, 'page', GUTTER);
    expect(LETTER.width * scale).toBeLessThanOrEqual(PHONE.width - GUTTER * 2 + 0.001);
    expect(LETTER.height * scale).toBeLessThanOrEqual(PHONE.height - GUTTER * 2 + 0.001);
  });

  it('survives a degenerate page or viewport rather than dividing by zero', () => {
    expect(fitScale({ width: 0, height: 0 }, PHONE)).toBe(1);
    expect(Number.isFinite(fitScale(LETTER, { width: 0, height: 0 }))).toBe(true);
  });
});

describe('planRender on a phone', () => {
  it('renders the whole page inside 390 px with no horizontal overflow', () => {
    const plan = planRender(LETTER, PHONE, 1, 3, { padding: GUTTER });
    expect(plan.cssWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT_WIDTH);
    expect(plan.cssWidth).toBeCloseTo(374, 0);
    expect(plan.cssHeight).toBeGreaterThan(0);
  });

  it('renders crisply at the phone default — the display ratio is not capped', () => {
    const plan = planRender(LETTER, PHONE, 1, 3, { padding: GUTTER });
    expect(plan.pixelRatio).toBe(3);
    expect(plan.capped).toBe(false);
    expect(plan.renderScale).toBeCloseTo(plan.scale * 3, 5);
    expect(plan.canvasWidth).toBe(Math.floor(plan.cssWidth * 3));
  });

  it('caps the bitmap when a pinch would ask a phone for 26 megapixels', () => {
    const plan = planRender(LETTER, PHONE, 4, 3, { padding: GUTTER });
    expect(plan.canvasWidth * plan.canvasHeight).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(plan.capped).toBe(true);
    // CSS still gets the full zoom — the page is the size the reader asked for.
    expect(plan.cssWidth).toBeCloseTo(374 * 4, 0);
  });

  it('never exceeds the bitmap budget at any zoom on any plausible display', () => {
    for (const dpr of [1, 2, 2.625, 3, 4]) {
      for (const zoom of [0.5, 1, 1.5, 2, 3, 4, 6]) {
        const plan = planRender(LETTER, PHONE, zoom, dpr, { padding: GUTTER });
        expect(plan.canvasWidth * plan.canvasHeight).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
        expect(plan.canvasWidth).toBeGreaterThan(0);
        expect(plan.canvasHeight).toBeGreaterThan(0);
      }
    }
  });

  it('treats a missing devicePixelRatio as 1 rather than rendering nothing', () => {
    const plan = planRender(LETTER, PHONE, 1, Number.NaN, { padding: GUTTER });
    expect(plan.pixelRatio).toBe(1);
    expect(plan.canvasWidth).toBeGreaterThan(0);
  });
});

describe('zoom', () => {
  it('clamps to the usable band', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('steps in and out symmetrically', () => {
    expect(nextZoom(1, 1)).toBeCloseTo(1.25, 5);
    expect(nextZoom(nextZoom(1, 1), -1)).toBeCloseTo(1, 5);
  });

  it('turns a pinch into a zoom factor', () => {
    expect(pinchZoom(1, 100, 200)).toBeCloseTo(2, 5);
    expect(pinchZoom(2, 200, 100)).toBeCloseTo(1, 5);
    expect(pinchZoom(1, 100, 100_000)).toBe(MAX_ZOOM);
  });

  it('ignores a degenerate pinch instead of collapsing the page', () => {
    expect(pinchZoom(1.5, 0, 120)).toBeCloseTo(1.5, 5);
    expect(pinchZoom(1.5, 120, 0)).toBeCloseTo(1.5, 5);
  });

  it('measures finger spread', () => {
    expect(touchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
