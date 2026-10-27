/**
 * Turned furniture (tilesets/footprint.ts): the box a turned prop spans from
 * its anchor, and the squares it stands on inside it.
 */
import { describe, expect, it } from 'vitest';
import { normAngle, objectCoverage, propCells, propCoverage } from '../src/index.js';

describe('turned props', () => {
  it('normalises any angle to a multiple of 45 in 0..315', () => {
    expect(normAngle(undefined)).toBe(0);
    expect(normAngle(360)).toBe(0);
    expect(normAngle(-45)).toBe(315);
    expect(normAngle(100)).toBe(90);
  });

  it('swaps across and down on a quarter turn', () => {
    expect(propCells('desk', 1, 90)).toEqual([1, 2]);
    expect(propCoverage('desk', 4, 4, 1, 270)).toEqual(['4,4', '4,5']);
  });

  it('turned 45°, spans the square that holds it and stands on the squares whose centres it covers', () => {
    // A 2 m bed on a 1 m grid: ceil((2 + 2) / √2) = 3 squares a side, and a
    // diamond inside that reaches the four squares round the middle one.
    expect(propCells('bed', 1, 45)).toEqual([3, 3]);
    expect(propCoverage('bed', 10, 20, 1, 45).sort()).toEqual(['10,21', '11,20', '11,21', '11,22', '12,21']);
    // A thin desk on the diagonal misses every centre but the middle one: it still stands there.
    expect(propCoverage('desk', 0, 0, 1, 45)).toEqual(['1,1']);
  });

  it('leaves a diagonal prop’s bare anchor corner open for the floor, but still picks it there', () => {
    const objects = { '10,20': 'bed' };
    const propOf = () => 'bed' as const;
    const angles = { '10,20': 45 };
    expect(objectCoverage(objects, 1, propOf, true, angles).has('10,20')).toBe(false);
    expect(objectCoverage(objects, 1, propOf, true, angles).get('11,21')).toBe('10,20');
    expect(objectCoverage(objects, 1, propOf, false, angles).get('10,20')).toBe('10,20');
  });
});
