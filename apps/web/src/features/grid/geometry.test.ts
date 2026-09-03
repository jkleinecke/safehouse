import { describe, expect, it } from 'vitest';
import type { Grid } from '@safehouse/contracts';
import {
  CELL,
  cellCorners,
  cellDepth,
  distToSegment,
  gridFromWorld,
  heightRise,
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

const grid: Grid = { unitM: 1, cols: 20, rows: 10, offset: { x: 0, y: 0 }, projection: 'topdown' as const };

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
    expect(metricsKey(metricsFor({ ...grid, offset: { x: 0.5, y: 0 }, projection: 'topdown' as const }))).not.toBe(a);
    expect(metricsKey(metricsFor(grid))).toBe(a);
  });
});

describe('coordinate transforms', () => {
  it('round-trips grid ↔ world through the offset', () => {
    const m = metricsFor({ ...grid, offset: { x: 0.25, y: -0.5 }, projection: 'topdown' as const });
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

// ---------------------------------------------------------------------------
// Isometric projection
// ---------------------------------------------------------------------------

/**
 * The projection exists because a painted wall in plan view could only ever be
 * a slightly different shade of floor — the GM could not see their own walls.
 * Isometric extrudes standing things so they have a silhouette.
 *
 * The property that has to hold is the ROUND TRIP. Every pointer interaction —
 * painting, dragging a token, measuring, placing a pin — goes screen → world →
 * grid, and the canvas goes grid → world. If those two disagree by even a
 * fraction of a cell the GM paints one cell and a different one lights up,
 * which is indistinguishable from the tool being broken.
 */
describe('isometric projection', () => {
  const iso = metricsFor({
    unitM: 1,
    cols: 20,
    rows: 14,
    offset: { x: 0, y: 0 },
    projection: 'iso' as const,
  });
  const flat = metricsFor({
    unitM: 1,
    cols: 20,
    rows: 14,
    offset: { x: 0, y: 0 },
    projection: 'topdown' as const,
  });

  it('round-trips grid → world → grid exactly', () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 19, y: 13 },
      { x: 7.5, y: 3.25 },
      { x: 12.75, y: 9.5 },
      { x: -2, y: 4 },
    ]) {
      const back = gridFromWorld(iso, worldFromGrid(iso, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it('round-trips through a non-zero grid offset too', () => {
    const shifted = metricsFor({
      unitM: 1,
      cols: 10,
      rows: 10,
      offset: { x: 1.5, y: -2.25 },
      projection: 'iso' as const,
    });
    for (const p of [
      { x: 0, y: 0 },
      { x: 4, y: 6 },
      { x: 9.5, y: 2.5 },
    ]) {
      const back = gridFromWorld(shifted, worldFromGrid(shifted, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it('leaves plan view exactly as it was', () => {
    // The projection is opt-in per scene; an existing scene must not move.
    expect(worldFromGrid(flat, { x: 3, y: 2 })).toEqual({ x: 3 * flat.cell, y: 2 * flat.cell });
    expect(gridFromWorld(flat, { x: 192, y: 128 })).toEqual({ x: 3, y: 2 });
    expect(sceneWorldSize(flat)).toEqual({ width: 20 * flat.cell, height: 14 * flat.cell });
  });

  it('keeps the whole map at non-negative x', () => {
    // In isometric the leftmost point is the BOTTOM-left cell, so without the
    // origin shift half the map would sit outside the world box and the
    // camera's fit-to-scene would frame empty space.
    let minX = Infinity;
    for (let col = 0; col <= iso.cols; col += 1) {
      for (let row = 0; row <= iso.rows; row += 1) {
        minX = Math.min(minX, worldFromGrid(iso, { x: col, y: row }).x);
      }
    }
    expect(minX).toBeGreaterThanOrEqual(0);
  });

  it('makes a cell a diamond twice as wide as it is tall', () => {
    const [n, e, s, w] = cellCorners(iso, 4, 4);
    expect(Math.abs(e.x - w.x)).toBeCloseTo(iso.cell, 6);
    expect(Math.abs(s.y - n.y)).toBeCloseTo(iso.cell / 2, 6);
    // …and a plain square in plan view, so every layer can use one helper.
    const [fn, fe, fs2, fw] = cellCorners(flat, 4, 4);
    expect(fn).toEqual({ x: 4 * flat.cell, y: 4 * flat.cell });
    expect(fe.x - fw.x).toBe(flat.cell);
    expect(fs2.y - fn.y).toBe(flat.cell);
  });

  it('gives height a rise in isometric and none in plan view', () => {
    // Plan view has no "up" to draw toward — which is precisely why a painted
    // wall was previously indistinguishable from a darker floor.
    expect(heightRise(iso, 1)).toBeGreaterThan(0);
    expect(heightRise(iso, 0.5)).toBeCloseTo(heightRise(iso, 1) / 2, 6);
    expect(heightRise(iso, 0)).toBe(0);
    expect(heightRise(flat, 1)).toBe(0);
  });

  it('orders cells back to front, so a near wall covers a far floor', () => {
    // The sort IS the occlusion; there is no z-buffer.
    expect(cellDepth(0, 0)).toBeLessThan(cellDepth(1, 0));
    expect(cellDepth(0, 0)).toBeLessThan(cellDepth(0, 1));
    expect(cellDepth(3, 1)).toBe(cellDepth(1, 3));
    expect(cellDepth(5, 5)).toBeGreaterThan(cellDepth(9, 0) - 1);
  });

  it('changes the metrics key, so switching projection forces a redraw', () => {
    expect(metricsKey(iso)).not.toBe(metricsKey(flat));
  });
});
