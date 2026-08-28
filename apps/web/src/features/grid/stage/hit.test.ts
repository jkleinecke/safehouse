import { describe, expect, it } from 'vitest';
import type { Scene, Token } from '@safehouse/contracts';
import { metricsFor } from '../geometry.js';
import { gridTolerance, hitDoor, hitToken, isDoubleTap } from './hit.js';

function token(id: string, x: number, y: number, size = 1): Token {
  return {
    id,
    sceneId: 'sc1',
    source: 'character',
    sourceId: null,
    name: id,
    x,
    y,
    size,
    rotation: 0,
    hidden: false,
    barsVisibility: 'owner',
  };
}

describe('hitToken', () => {
  const tokens = [token('a', 2.5, 2.5), token('b', 10.5, 4.5, 3)];

  it('hits inside the token circle and misses outside', () => {
    expect(hitToken(tokens, { x: 2.6, y: 2.4 })?.id).toBe('a');
    expect(hitToken(tokens, { x: 5, y: 5 })).toBeNull();
  });

  it('scales the hit radius with token size', () => {
    expect(hitToken(tokens, { x: 11.8, y: 4.5 })?.id).toBe('b');
    expect(hitToken(tokens, { x: 12.6, y: 4.5 })).toBeNull();
  });

  it('respects an id allow-list', () => {
    expect(hitToken(tokens, { x: 2.5, y: 2.5 }, { onlyIds: new Set(['b']) })).toBeNull();
    expect(hitToken(tokens, { x: 2.5, y: 2.5 }, { onlyIds: new Set(['a']) })?.id).toBe('a');
  });

  it('prefers the last token when circles overlap', () => {
    const stacked = [token('under', 3, 3), token('over', 3, 3)];
    expect(hitToken(stacked, { x: 3, y: 3 })?.id).toBe('over');
  });
});

describe('hitDoor', () => {
  const scene = {
    geometry: {
      walls: [],
      zones: [],
      pins: [],
      doors: [
        { id: 'd1', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, open: false },
        { id: 'd2', a: { x: 0, y: 9 }, b: { x: 4, y: 9 }, open: true },
      ],
    },
  } as unknown as Scene;

  it('finds a door within tolerance', () => {
    expect(hitDoor(scene, { x: 2, y: 0.3 })).toBe('d1');
    expect(hitDoor(scene, { x: 2, y: 8.8 })).toBe('d2');
  });

  it('misses when nothing is near', () => {
    expect(hitDoor(scene, { x: 2, y: 4 })).toBeNull();
  });
});

describe('gridTolerance', () => {
  it('shrinks in grid units as the camera zooms in', () => {
    const m = metricsFor({ unitM: 1, cols: 10, rows: 10, offset: { x: 0, y: 0 } });
    const wide = gridTolerance(m, 0.5, 10);
    const close = gridTolerance(m, 2, 10);
    expect(close).toBeLessThan(wide);
    expect(close).toBeCloseTo(10 / (m.cell * 2), 10);
  });
});

describe('isDoubleTap', () => {
  it('needs a previous tap', () => {
    expect(isDoubleTap(null, { x: 0, y: 0, t: 10 })).toBe(false);
  });

  it('accepts a quick nearby second tap', () => {
    expect(isDoubleTap({ x: 100, y: 100, t: 0 }, { x: 105, y: 98, t: 200 })).toBe(true);
  });

  it('rejects a slow or distant second tap', () => {
    expect(isDoubleTap({ x: 100, y: 100, t: 0 }, { x: 100, y: 100, t: 900 })).toBe(false);
    expect(isDoubleTap({ x: 100, y: 100, t: 0 }, { x: 160, y: 100, t: 100 })).toBe(false);
  });
});
