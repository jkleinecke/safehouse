import { describe, expect, it } from 'vitest';
import { snappedLineCells } from './lineTool.js';

const keys = (cells: Array<{ col: number; row: number }>) => cells.map((c) => `${c.col},${c.row}`);

describe('snappedLineCells', () => {
  it('is the one square on a press that never moved', () => {
    expect(keys(snappedLineCells({ col: 3, row: 3 }, { col: 3, row: 3 }))).toEqual(['3,3']);
  });

  it('lays a 45° run one square per step on both axes, as long as the farther coordinate', () => {
    // Mostly diagonal (5 across, 4 down): a true diagonal reaching column 7.
    expect(keys(snappedLineCells({ col: 2, row: 2 }, { col: 7, row: 6 }))).toEqual([
      '2,2', '3,3', '4,4', '5,5', '6,6', '7,7',
    ]);
    // Up and to the left.
    expect(keys(snappedLineCells({ col: 5, row: 5 }, { col: 2, row: 2 }))).toEqual(['5,5', '4,4', '3,3', '2,2']);
  });

  it('snaps a shallow drag to a straight run', () => {
    expect(keys(snappedLineCells({ col: 0, row: 0 }, { col: 4, row: 1 }))).toEqual([
      '0,0', '1,0', '2,0', '3,0', '4,0',
    ]);
    expect(keys(snappedLineCells({ col: 4, row: 4 }, { col: 3, row: 1 }))).toEqual(['4,4', '4,3', '4,2', '4,1']);
  });
});
