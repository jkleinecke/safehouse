/**
 * A fixed eye's cone (FR9.23): the same sightline a token gets, trimmed to a
 * facing and a field of view. Pinned the way line of sight is — against the
 * properties a GM would notice breaking at the table.
 */
import { describe, expect, it } from 'vitest';
import { bearingOffset, coneCells, inCone, type SightCell, type SightModel } from '../src/index.js';

/** A model from a sketch: `#` blocks sight. */
function model(rows: string[]): SightModel {
  const cells = new Map<string, SightCell>();
  rows.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch === '#') {
        cells.set(`${col},${row}`, { blocksSight: true, givesCover: false, blocksMovement: true, height: 1 });
      }
    });
  });
  return { cells, segments: [] };
}

const OPEN = model(Array.from({ length: 12 }, () => '............'));
const eye = (over: Partial<Parameters<typeof coneCells>[0]> = {}) => ({
  at: { x: 5.5, y: 5.5 },
  facing: 0,
  fov: 90,
  range: 6,
  ...over,
});

describe('bearingOffset', () => {
  it('is zero dead ahead and signed either side', () => {
    const from = { x: 0, y: 0 };
    expect(bearingOffset(from, { x: 3, y: 0 }, 0)).toBeCloseTo(0);
    expect(bearingOffset(from, { x: 0, y: 3 }, 0)).toBeCloseTo(90);
    expect(bearingOffset(from, { x: 0, y: -3 }, 0)).toBeCloseTo(-90);
    expect(bearingOffset(from, { x: -3, y: 0 }, 0)).toBeCloseTo(180);
  });

  it('wraps: a facing of 350 looking at bearing 10 is 20 degrees off, not 340', () => {
    expect(bearingOffset({ x: 0, y: 0 }, { x: Math.cos(Math.PI / 18), y: Math.sin(Math.PI / 18) }, 350)).toBeCloseTo(20);
  });
});

describe('inCone', () => {
  it('takes a 90-degree cone facing east as the quarter ahead', () => {
    const e = eye();
    expect(inCone(e, { x: 9.5, y: 5.5 })).toBe(true);
    expect(inCone(e, { x: 9.5, y: 8.5 })).toBe(true); // 36° off, inside 45°
    expect(inCone(e, { x: 5.5, y: 9.5 })).toBe(false); // straight south, 90° off
    expect(inCone(e, { x: 1.5, y: 5.5 })).toBe(false); // behind it
  });

  it('a dome sees every way', () => {
    expect(inCone(eye({ fov: 360 }), { x: 1.5, y: 5.5 })).toBe(true);
  });
});

describe('coneCells', () => {
  it('covers cells ahead and not behind, and never its own mount', () => {
    const cells = coneCells(eye(), OPEN, { cols: 12, rows: 12 });
    expect(cells.has('9,5')).toBe(true);
    expect(cells.has('1,5')).toBe(false);
    expect(cells.has('5,9')).toBe(false);
    expect(cells.has('5,5')).toBe(false);
  });

  it('stops at its reach, measured from the eye', () => {
    const cells = coneCells(eye({ range: 3 }), OPEN, { cols: 12, rows: 12 });
    expect(cells.has('8,5')).toBe(true); // 3 cells out
    expect(cells.has('9,5')).toBe(false); // 4 cells out
  });

  it('is cut by a wall the way a token’s sightline is', () => {
    const walled = model([
      '............',
      '............',
      '............',
      '............',
      '........#...',
      '........#...',
      '........#...',
      '............',
      '............',
      '............',
      '............',
      '............',
    ]);
    const cells = coneCells(eye(), walled, { cols: 12, rows: 12 });
    expect(cells.has('7,5')).toBe(true); // this side of the wall
    // The wall's own cell is seen — its face is what the camera looks at —
    // exactly as a token sees a wall; everything behind it is not.
    expect(cells.has('8,5')).toBe(true);
    expect(cells.has('9,5')).toBe(false);
    expect(cells.has('10,5')).toBe(false);
  });

  it('a camera set INTO a wall cell still sees out of it', () => {
    // End cells never block a sightline, so a wall-mounted camera works.
    const walled = model([
      '............',
      '............',
      '............',
      '............',
      '............',
      '#####.......',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
    ]);
    const cells = coneCells(eye({ at: { x: 2.5, y: 5.5 }, facing: 90, fov: 120, range: 5 }), walled, { cols: 12, rows: 12 });
    expect(cells.has('2,8')).toBe(true);
    expect(cells.has('2,3')).toBe(false); // behind it, and the other side of the wall
  });

  it('stays inside the grid', () => {
    const cells = coneCells(eye({ at: { x: 0.5, y: 0.5 }, facing: 180, fov: 360, range: 4 }), OPEN, { cols: 12, rows: 12 });
    for (const c of cells.values()) {
      expect(c.col).toBeGreaterThanOrEqual(0);
      expect(c.row).toBeGreaterThanOrEqual(0);
    }
  });
});
