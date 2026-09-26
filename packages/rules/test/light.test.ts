/**
 * Light per square (docs/VISION.md §4.1). Light obeys the geometry sight
 * does, so it is pinned the same way: against what a GM would notice
 * breaking — a lamp lighting the far side of a wall, glass going dark.
 */
import { describe, expect, it } from 'vitest';
import {
  lightMapFor,
  lightPolygonsFor,
  lightRowAt,
  occluderSegments,
  type LightSource,
  type SightCell,
  type SightModel,
} from '../src/index.js';

/** A model from a sketch: `#` blocks sight, `g` is glass — full height, see-through. */
function model(rows: string[]): SightModel {
  const cells = new Map<string, SightCell>();
  rows.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch === '#') cells.set(`${col},${row}`, { blocksSight: true, givesCover: false, blocksMovement: true, height: 1 });
      if (ch === 'g') cells.set(`${col},${row}`, { blocksSight: false, givesCover: false, blocksMovement: true, height: 1 });
    });
  });
  return { cells, segments: [] };
}

const lamp = (x: number, y: number, over: Partial<LightSource> = {}): LightSource => ({
  id: `gm:${x},${y}`,
  kind: 'gm',
  at: { x, y },
  height: 0.8,
  radius: 6,
  rows: 2,
  color: '#ffd9a0',
  ...over,
});

/** A night scene: total darkness until something lights it. */
const DARK = { environment: { light: 3 } };

describe('light map', () => {
  it('stops at a wall', () => {
    const room = model(['.....#.....', '.....#.....', '.....#.....']);
    const map = lightMapFor(DARK, 0, { model: room, sources: [lamp(2.5, 1.5)] });
    // Beside the lamp: its inner half lifts two rows.
    expect(lightRowAt(map, 3, 1)).toBe(1);
    // Behind the wall, well inside its reach: still dark.
    expect(lightRowAt(map, 7, 1)).toBe(3);
  });

  it('passes through glass', () => {
    const room = model(['.....g.....', '.....g.....', '.....g.....']);
    const map = lightMapFor(DARK, 0, { model: room, sources: [lamp(2.5, 1.5)] });
    // Five squares off, in the outer half: one row fewer.
    expect(lightRowAt(map, 7, 1)).toBe(2);
  });

  it('lets a lamp in a blocking square light around it', () => {
    // A street lamp's post, a lit server rack: the light is IN the solid.
    const room = model(['.....', '..#..', '.....']);
    const map = lightMapFor(DARK, 0, { model: room, sources: [lamp(2.5, 1.5)] });
    for (const [col, row] of [[0, 1], [4, 1], [2, 0], [2, 2], [2, 1]] as const) {
      expect(lightRowAt(map, col, row)).toBeLessThan(3);
    }
  });

  it('starts at the ambient row, and the brightest light wins', () => {
    const map = lightMapFor({ environment: { light: 2 } }, 0, {
      model: model([]),
      sources: [lamp(0.5, 0.5, { radius: 4, rows: 1 }), lamp(3.5, 0.5, { radius: 4, rows: 2 })],
    });
    // Both reach (2,0); the stronger, nearer one decides it.
    expect(lightRowAt(map, 2, 0)).toBe(0);
    // Out of every light's reach: the scene's own row, and not stored.
    expect(lightRowAt(map, 20, 0)).toBe(2);
    expect(map.rows.has('20,0')).toBe(false);
  });
});

describe('light polygon', () => {
  it('does not cross a wall', () => {
    const wall = model(Array.from({ length: 15 }, () => '.....#......'));
    // Fifteen squares of wall are its two long faces and two ends.
    expect(occluderSegments(wall)).toHaveLength(4);
    const [lit] = lightPolygonsFor({}, 0, { model: wall, sources: [lamp(2.5, 7.5)] });
    const xs = (lit?.points ?? []).map((p) => p.x);
    expect(xs.length).toBeGreaterThan(3);
    // It reaches the wall's face, and not one hair past it.
    expect(Math.max(...xs)).toBeCloseTo(5, 6);
  });
});
