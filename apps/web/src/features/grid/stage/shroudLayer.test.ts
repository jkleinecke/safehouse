/**
 * The sightline shroud (FR9.16).
 *
 * Two properties matter more than what it looks like.
 *
 * An EMPTY visible set must draw nothing. "No viewpoint chosen" is the default
 * for a GM, and if that blacked out the table the tool would be unusable the
 * moment it was switched on.
 *
 * And the redraw key must move when the SHAPE changes, not just the size. A
 * token stepping sideways behind a pillar reveals one cell and hides another —
 * identical count, completely different picture — and that is precisely the
 * move a player makes when checking an angle.
 */
import { describe, expect, it } from 'vitest';
import type { Graphics } from 'pixi.js';
import { TILE_HEIGHTS } from '@safehouse/rules';
import { cellCorners, heightRise, metricsFor } from '../geometry.js';
import { drawShroud, shroudKey } from './shroudLayer.js';

const M = metricsFor({
  unitM: 1,
  cols: 4,
  rows: 3,
  offset: { x: 0, y: 0 },
  projection: 'topdown' as const,
});

function fake(): { g: Graphics; ops: string[] } {
  const ops: string[] = [];
  const g: Record<string, unknown> = {};
  for (const op of ['clear', 'moveTo', 'lineTo', 'closePath', 'fill']) {
    g[op] = (...args: unknown[]) => {
      void args;
      ops.push(op);
      return g;
    };
  }
  return { g: g as unknown as Graphics, ops };
}

const fills = (ops: readonly string[]): number => ops.filter((o) => o === 'fill').length;
const setOf = (...keys: string[]) => new Set(keys);

describe('drawShroud', () => {
  it('draws nothing at all when no viewpoint is chosen', () => {
    // The GM's default. Blacking out the table here would make the feature
    // unusable the instant it was enabled.
    const a = fake();
    drawShroud(a.g, M, null);
    expect(a.ops).toEqual(['clear']);

    const b = fake();
    drawShroud(b.g, M, { visible: setOf(), gm: true });
    expect(b.ops).toEqual(['clear']);
  });

  it('scrims every cell the viewer cannot see, and no others', () => {
    const f = fake();
    // 4x3 = 12 cells; three visible leaves nine to darken.
    drawShroud(f.g, M, { visible: setOf('0,0', '1,0', '2,0'), gm: false });
    expect(fills(f.ops)).toBe(9);
  });

  it('draws nothing when everything is visible', () => {
    const all = new Set<string>();
    for (let c = 0; c < M.cols; c += 1) {
      for (let r = 0; r < M.rows; r += 1) all.add(`${c},${r}`);
    }
    const f = fake();
    drawShroud(f.g, M, { visible: all, gm: false });
    expect(fills(f.ops)).toBe(0);
  });

  it('clears before drawing, so a moved token leaves no stale scrim', () => {
    const f = fake();
    drawShroud(f.g, M, { visible: setOf('0,0'), gm: false });
    expect(f.ops[0]).toBe('clear');
  });

  it('ignores visible cells outside the grid rather than miscounting', () => {
    // A shrunken scene can leave a stale key in the set; it must not change
    // how many in-bounds cells get scrimmed.
    const f = fake();
    drawShroud(f.g, M, { visible: setOf('0,0', '99,99'), gm: false });
    expect(fills(f.ops)).toBe(11);
  });
});

describe('shroudKey', () => {
  it('is stable for the same set, whatever order it iterates', () => {
    const a = shroudKey({ visible: setOf('1,1', '2,2', '3,0'), gm: false });
    const b = shroudKey({ visible: setOf('3,0', '1,1', '2,2'), gm: false });
    expect(a).toBe(b);
  });

  it('MOVES when the shape changes but the count does not', () => {
    // The bug this exists to prevent: sidestep behind a pillar, one cell in,
    // one cell out, canvas never redraws, player reads a stale sightline.
    const before = shroudKey({ visible: setOf('1,1', '2,2'), gm: false });
    const after = shroudKey({ visible: setOf('1,1', '3,3'), gm: false });
    expect(after).not.toBe(before);
  });

  it('distinguishes a GM lens from a player limit', () => {
    // Different scrim opacity, so the same set must redraw when the role
    // changes — otherwise a GM opening a player view keeps the light wash.
    const s = setOf('1,1');
    expect(shroudKey({ visible: s, gm: true })).not.toBe(shroudKey({ visible: s, gm: false }));
  });

  it('treats no viewpoint and an empty set as the same nothing', () => {
    expect(shroudKey(null)).toBe(shroudKey({ visible: setOf(), gm: false }));
  });
});

describe('the scrim covers what was drawn, not the square it stands on', () => {
  // The defect this fixes: the scrim darkened a hidden square's FLOOR and left
  // the wall standing on it at full brightness — bright caps hovering over
  // darkened ground, with the shroud line cutting each wall across the middle.
  const iso = metricsFor({
    unitM: 1,
    cols: 4,
    rows: 3,
    offset: { x: 0, y: 0 },
    projection: 'iso' as const,
  });

  /** A fake that keeps the vertices, since the shape is the whole point here. */
  function tracing(): { g: Graphics; paths: Array<Array<{ x: number; y: number }>> } {
    const paths: Array<Array<{ x: number; y: number }>> = [];
    let current: Array<{ x: number; y: number }> = [];
    const g: Record<string, unknown> = {
      clear: () => g,
      moveTo: (x: number, y: number) => {
        current = [{ x, y }];
        return g;
      },
      lineTo: (x: number, y: number) => {
        current.push({ x, y });
        return g;
      },
      closePath: () => {
        paths.push(current);
        return g;
      },
      fill: () => g,
    };
    return { g: g as unknown as Graphics, paths };
  }

  /** Every square hidden except one, so exactly one scrim is drawn. */
  const onlyHidden = (col: number, row: number) => {
    const visible = new Set<string>();
    for (let c = 0; c < iso.cols; c += 1) {
      for (let r = 0; r < iso.rows; r += 1) {
        if (c !== col || r !== row) visible.add(`${c},${r}`);
      }
    }
    return visible;
  };

  it('draws a flat square as its diamond', () => {
    const f = tracing();
    drawShroud(f.g, iso, { visible: onlyHidden(1, 1), gm: false });
    expect(f.paths).toHaveLength(1);
    expect(f.paths[0]).toHaveLength(4);
  });

  it('draws a square with something standing in it as a swept hexagon', () => {
    const f = tracing();
    drawShroud(f.g, iso, {
      visible: onlyHidden(1, 1),
      gm: false,
      heights: new Map([['1,1', TILE_HEIGHTS.FULL]]),
    });
    expect(f.paths).toHaveLength(1);
    // Four ground corners minus the two the extrusion hides, plus three of the
    // top — the silhouette `drawBox` actually produces.
    expect(f.paths[0]).toHaveLength(6);
  });

  it('reaches exactly as high as the renderer lifts the tile', () => {
    // The invariant that matters: the scrim's ceiling is the SAME number the
    // tile layer extrudes by, so it can never fall short of the wall it covers.
    const f = tracing();
    drawShroud(f.g, iso, {
      visible: onlyHidden(2, 1),
      gm: false,
      heights: new Map([['2,1', TILE_HEIGHTS.FULL]]),
    });
    const top = Math.min(...f.paths[0]!.map((p) => p.y));
    const ground = Math.min(...cellCorners(iso, 2, 1).map((p) => p.y));
    expect(top).toBeCloseTo(ground - heightRise(iso, TILE_HEIGHTS.FULL), 6);
  });

  it('rises further for a full wall than for waist-high cover', () => {
    const reach = (h: number) => {
      const f = tracing();
      drawShroud(f.g, iso, {
        visible: onlyHidden(2, 1),
        gm: false,
        heights: new Map([['2,1', h]]),
      });
      return Math.min(...f.paths[0]!.map((p) => p.y));
    };
    expect(reach(TILE_HEIGHTS.FULL)).toBeLessThan(reach(TILE_HEIGHTS.WAIST));
    expect(reach(TILE_HEIGHTS.WAIST)).toBeLessThan(reach(TILE_HEIGHTS.FLOOR));
  });

  it('ignores height in plan view, where there is no up to draw toward', () => {
    const f = tracing();
    drawShroud(f.g, M, {
      visible: setOf('0,0', '1,0', '2,0'),
      gm: false,
      heights: new Map([['0,1', TILE_HEIGHTS.FULL]]),
    });
    for (const path of f.paths) expect(path).toHaveLength(4);
  });

  it('redraws when a crate becomes a wall, though nothing became visible', () => {
    // The silhouette changed and the visible set did not, so a key hashing
    // only the set would have frozen the scrim at the old shape.
    const visible = setOf('0,0');
    const short = shroudKey({ visible, gm: false, heights: new Map([['1,1', 0.5]]) });
    const tall = shroudKey({ visible, gm: false, heights: new Map([['1,1', 1]]) });
    expect(tall).not.toBe(short);
    // And an unchanged scene still keys identically, so nothing redraws for free.
    expect(shroudKey({ visible, gm: false, heights: new Map([['1,1', 1]]) })).toBe(tall);
  });
});
