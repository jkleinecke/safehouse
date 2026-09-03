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
import { metricsFor } from '../geometry.js';
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
