import { describe, expect, it } from 'vitest';
import type { Grid } from '@safehouse/contracts';
import {
  CELL,
  distToSegment,
  gridFromWorld,
  metersBetween,
  metricsFor,
  metricsKey,
  pointInPolygon,
  polygonCenter,
  rectPolygon,
  rollScatter,
  rulerSegments,
  sceneWorldSize,
  snapCenter,
  worldFromGrid,
} from './geometry.js';

const grid: Grid = { unitM: 1, cols: 20, rows: 10, offset: { x: 0, y: 0 } };

describe('metrics', () => {
  it('defaults grid opacity and clamps it', () => {
    expect(metricsFor(grid).opacity).toBe(0.35);
    expect(metricsFor({ ...grid, opacity: 2 }).opacity).toBe(1);
    expect(metricsFor({ ...grid, opacity: 0 }).opacity).toBe(0);
  });

  it('falls back to 1 m per square when unitM is nonsense', () => {
    expect(metricsFor({ ...grid, unitM: 0 }).unitM).toBe(1);
  });

  it('sizes the scene rect from cols/rows', () => {
    expect(sceneWorldSize(metricsFor(grid))).toEqual({ width: 20 * CELL, height: 10 * CELL });
  });

  it('changes its key when calibration changes', () => {
    const a = metricsKey(metricsFor(grid));
    expect(metricsKey(metricsFor({ ...grid, offset: { x: 0.5, y: 0 } }))).not.toBe(a);
    expect(metricsKey(metricsFor(grid))).toBe(a);
  });
});

describe('coordinate transforms', () => {
  it('round-trips grid ↔ world through the offset', () => {
    const m = metricsFor({ ...grid, offset: { x: 0.25, y: -0.5 } });
    const p = { x: 3.5, y: 7.25 };
    const back = gridFromWorld(m, worldFromGrid(m, p));
    expect(back.x).toBeCloseTo(p.x, 10);
    expect(back.y).toBeCloseTo(p.y, 10);
  });
});

describe('snapCenter', () => {
  it('centres odd-sized tokens on cell centres', () => {
    expect(snapCenter({ x: 3.2, y: 4.9 }, 1)).toEqual({ x: 3.5, y: 4.5 });
    expect(snapCenter({ x: 3.2, y: 4.9 }, 3)).toEqual({ x: 3.5, y: 4.5 });
  });

  it('centres even-sized tokens on grid intersections', () => {
    expect(snapCenter({ x: 3.4, y: 4.6 }, 2)).toEqual({ x: 3, y: 5 });
  });
});

describe('metersBetween', () => {
  it('scales grid distance by metres per square', () => {
    expect(metersBetween(metricsFor(grid), { x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(metersBetween(metricsFor({ ...grid, unitM: 2 }), { x: 0, y: 0 }, { x: 3, y: 4 })).toBe(10);
  });
});

describe('rulerSegments', () => {
  it('is one walk segment inside the walk threshold', () => {
    const segs = rulerSegments({ x: 0, y: 0 }, { x: 4, y: 0 }, 4, 10, 20);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.band).toBe('walk');
  });

  it('splits walk / run / sprint at the thresholds', () => {
    const segs = rulerSegments({ x: 0, y: 0 }, { x: 30, y: 0 }, 30, 10, 20);
    expect(segs.map((s) => s.band)).toEqual(['walk', 'run', 'sprint']);
    expect(segs[0]?.to.x).toBeCloseTo(10, 6);
    expect(segs[1]?.to.x).toBeCloseTo(20, 6);
    expect(segs[2]?.to.x).toBeCloseTo(30, 6);
  });

  it('collapses to walk with no thresholds', () => {
    const segs = rulerSegments({ x: 0, y: 0 }, { x: 9, y: 0 }, 9, 0, 0);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.band).toBe('walk');
  });
});

describe('pointInPolygon / polygonCenter', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];

  it('detects inside and outside', () => {
    expect(pointInPolygon({ x: 2, y: 2 }, square)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 2 }, square)).toBe(false);
  });

  it('averages the vertices for a label anchor', () => {
    expect(polygonCenter(square)).toEqual({ x: 2, y: 2 });
  });
});

describe('rectPolygon', () => {
  it('normalises two opposite corners into a clockwise box', () => {
    expect(rectPolygon({ x: 4, y: 6 }, { x: 1, y: 2 })).toEqual([
      { x: 1, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 6 },
      { x: 1, y: 6 },
    ]);
  });

  it('produces a polygon that contains its own middle', () => {
    const poly = rectPolygon({ x: 0, y: 0 }, { x: 10, y: 4 });
    expect(pointInPolygon({ x: 5, y: 2 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 11, y: 2 }, poly)).toBe(false);
  });
});

describe('rollScatter', () => {
  const seeded = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length] ?? 0;
  };

  it('lands on target when net hits cover the scatter roll', () => {
    // two d6 both roll 1 (rng 0 → face 1), direction die irrelevant.
    const out = rollScatter({ from: { x: 5, y: 5 }, dice: 2, netHits: 9, unitM: 1, rng: seeded([0]) });
    expect(out.meters).toBe(0);
    expect(out.to).toEqual({ x: 5, y: 5 });
    expect(out.summary).toContain('on target');
  });

  it('reduces scatter metres by net hits and never goes negative', () => {
    const out = rollScatter({
      from: { x: 0, y: 0 },
      dice: 2,
      netHits: 3,
      unitM: 1,
      rng: seeded([0.99, 0.99, 0]),
    });
    expect(out.rolls).toEqual([6, 6]);
    expect(out.meters).toBe(9);
    expect(out.directionLabel).toBe('N');
    expect(out.to.y).toBeCloseTo(-9, 6);
  });

  it('converts metres to grid units with the scene scale', () => {
    const out = rollScatter({
      from: { x: 0, y: 0 },
      dice: 1,
      netHits: 0,
      unitM: 2,
      rng: seeded([0.99, 0]),
    });
    expect(out.meters).toBe(6);
    expect(out.to.y).toBeCloseTo(-3, 6); // 6 m ÷ 2 m per square
  });
});

describe('distToSegment', () => {
  it('measures perpendicular distance and clamps to the ends', () => {
    expect(distToSegment({ x: 2, y: 1 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(1);
    expect(distToSegment({ x: -3, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(3);
  });
});
