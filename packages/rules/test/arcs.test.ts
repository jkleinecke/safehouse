/**
 * Walls at any angle and curved walls (tilesets/arcs.ts): where an arc runs,
 * which squares it stands in, and that a sightline cannot pass it.
 */
import { describe, expect, it } from 'vitest';
import { arcCells, arcPoints, bulgeThrough, distanceToArc, lineOfSight, sightModelFor } from '../src/index.js';

const arc = (bulge: number) => ({ id: 'a1', a: { x: 0, y: 5 }, b: { x: 10, y: 5 }, bulge, tile: 'building/wall' });

describe('arc geometry', () => {
  it('runs straight when it has no bulge', () => {
    const pts = arcPoints(arc(0), 1);
    expect(pts[0]).toEqual({ x: 0, y: 5 });
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 5 });
    expect(pts.every((p) => Math.abs(p.y - 5) < 1e-9)).toBe(true);
  });

  it('bulges to the left of a→b by exactly its bulge, through both ends', () => {
    // a→b runs right; left of it, with y down, is up the grid.
    const pts = arcPoints(arc(3), 0.1);
    expect(pts[0]!.x).toBeCloseTo(0);
    expect(pts[pts.length - 1]!.x).toBeCloseTo(10);
    const top = Math.min(...pts.map((p) => p.y));
    expect(top).toBeCloseTo(2, 1);
    // …and to the right when negative.
    expect(Math.max(...arcPoints(arc(-3), 0.1).map((p) => p.y))).toBeCloseTo(8, 1);
  });

  it('reads the bulge back from a point, as the tool does', () => {
    expect(bulgeThrough({ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 2 })).toBeCloseTo(3);
    expect(bulgeThrough({ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 8 })).toBeCloseTo(-3);
  });

  it('lists every square it crosses, joined edge or corner to the next', () => {
    const cells = arcCells(arc(3)).map((k) => k.split(',').map(Number) as [number, number]);
    for (let i = 1; i < cells.length; i += 1) {
      const [c0, r0] = cells[i - 1]!;
      const [c1, r1] = cells[i]!;
      expect(Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0))).toBe(1);
    }
    expect(distanceToArc(arc(3), { x: 5, y: 2 })).toBeLessThan(0.1);
  });
});

describe('an arc wall blocks sight', () => {
  it('stops a sightline across it, and not one alongside it', () => {
    const scene = {
      tiles: { tilesetId: 'docklands', cells: {}, ground: {}, structure: {}, object: {}, arcs: [arc(3)] },
    };
    const model = sightModelFor(scene);
    // From above the curve to below it: blocked.
    expect(lineOfSight({ col: 5, row: 0 }, { col: 5, row: 7 }, model).clear).toBe(false);
    // Along the bottom, under the curve: clear.
    expect(lineOfSight({ col: 1, row: 7 }, { col: 9, row: 7 }, model).clear).toBe(true);
  });
});
