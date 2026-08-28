import { describe, expect, it } from 'vitest';
import { Camera, MAX_SCALE, MIN_SCALE, clampScale, wheelZoomFactor } from './camera.js';

describe('Camera', () => {
  it('round-trips screen ↔ world', () => {
    const cam = new Camera();
    cam.set(120, -40, 1.75);
    const world = cam.toWorld(300, 210);
    const back = cam.toScreen(world.x, world.y);
    expect(back.x).toBeCloseTo(300, 10);
    expect(back.y).toBeCloseTo(210, 10);
  });

  it('pins the world point under the cursor while zooming', () => {
    const cam = new Camera();
    cam.set(0, 0, 1);
    const before = cam.toWorld(400, 300);
    cam.zoomAt(400, 300, 2.5);
    const after = cam.toWorld(400, 300);
    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
    expect(cam.scale).toBeCloseTo(2.5, 8);
  });

  it('clamps zoom to the allowed range', () => {
    const cam = new Camera();
    cam.zoomAt(0, 0, 1000);
    expect(cam.scale).toBe(MAX_SCALE);
    cam.zoomAt(0, 0, 0.00001);
    expect(cam.scale).toBe(MIN_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
  });

  it('centres a world point in the viewport', () => {
    const cam = new Camera();
    cam.set(0, 0, 2);
    cam.centerOn(100, 50, { width: 800, height: 600 });
    const screen = cam.toScreen(100, 50);
    expect(screen.x).toBeCloseTo(400, 8);
    expect(screen.y).toBeCloseTo(300, 8);
  });

  it('fits a scene rect inside the viewport with a margin', () => {
    const cam = new Camera();
    cam.fit(1000, 500, { width: 800, height: 600 }, 20);
    expect(cam.scale).toBeCloseTo((800 - 40) / 1000, 8);
    const centre = cam.toScreen(500, 250);
    expect(centre.x).toBeCloseTo(400, 6);
    expect(centre.y).toBeCloseTo(300, 6);
  });

  it('ignores a degenerate fit', () => {
    const cam = new Camera();
    cam.set(5, 6, 1);
    cam.fit(0, 0, { width: 800, height: 600 });
    expect(cam.scale).toBe(1);
    expect(cam.x).toBe(5);
  });

  it('marks itself dirty only on real changes', () => {
    const cam = new Camera();
    cam.dirty = false;
    cam.panBy(0, 0);
    expect(cam.dirty).toBe(false);
    cam.panBy(1, 0);
    expect(cam.dirty).toBe(true);
  });
});

describe('wheelZoomFactor', () => {
  it('zooms in on negative delta and out on positive', () => {
    expect(wheelZoomFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0)).toBeLessThan(1);
    expect(wheelZoomFactor(0, 0)).toBe(1);
  });

  it('normalises line and page delta modes to a comparable step', () => {
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(wheelZoomFactor(-48, 0), 10);
    expect(wheelZoomFactor(1, 2)).toBeCloseTo(wheelZoomFactor(400, 0), 10);
  });

  it('caps a runaway trackpad flick', () => {
    expect(wheelZoomFactor(-100000, 0)).toBeCloseTo(wheelZoomFactor(-240, 0), 10);
  });
});
