/**
 * Which doors a runner can reach (movement/reach.ts): the GM's rule that a
 * player opens or shuts a door only with their runner standing next to it.
 *
 * Pinned square by square, because "next to" is the whole rule: a painted
 * door from its own square and the eight round it, never two away; a traced
 * door along a grid line from the six squares at its mouth, never from a
 * square back; one drawn off the grid lines from either side of it; a
 * painted door only from its own floor, a traced one from any. And the map's
 * edge as a player's move meets it (`walkBounds`, `onWalkGround`).
 */
import { describe, expect, it } from 'vitest';
import { doorPlaceOf, onWalkGround, reachBox, reachesDoor, walkBounds, type DoorPlace } from '../src/index.js';

/** A runner's centre in square (`col`, `row`), on floor `level`. */
const at = (col: number, row: number, level = 0) => ({ x: col + 0.5, y: row + 0.5, level });

/** Every square of a `cols` × `rows` patch from which `door` is in reach, as "col,row". */
function reachedFrom(door: DoorPlace, cols = 12, rows = 12, level = 0): string[] {
  const out: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) if (reachesDoor(at(col, row, level), door)) out.push(`${col},${row}`);
  }
  return out;
}

describe('reachBox', () => {
  it('is the runner’s square grown by half a square each way', () => {
    expect(reachBox(at(3, 2))).toEqual({ minX: 2.5, minY: 1.5, maxX: 4.5, maxY: 3.5 });
    // Dropped off-centre, it reaches from the square it is drawn in.
    expect(reachBox({ x: 3.9, y: 2.1 })).toEqual(reachBox(at(3, 2)));
  });

  it('is a big token’s whole body grown the same way', () => {
    // Two squares wide, its centre on the corner at (6, 6): body 5..7.
    expect(reachBox({ x: 6, y: 6, size: 2 })).toEqual({ minX: 4.5, minY: 4.5, maxX: 7.5, maxY: 7.5 });
    // Three squares wide, on the middle of (6, 6): body 5..8.
    expect(reachBox({ x: 6.5, y: 6.5, size: 3 })).toEqual({ minX: 4.5, minY: 4.5, maxX: 8.5, maxY: 8.5 });
    // Smaller than a square is still a square.
    expect(reachBox({ x: 6.5, y: 6.5, size: 0.5 })).toEqual(reachBox(at(6, 6)));
  });

  it('is nowhere for a position that is not a number', () => {
    expect(reachBox({ x: Number.NaN, y: 1 })).toBeNull();
    expect(reachBox({ x: 1, y: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe('a painted door', () => {
  const door: DoorPlace = { kind: 'painted', level: 0, col: 5, row: 4 };

  it('is reached from its own square and the eight round it, and from nowhere else', () => {
    expect(reachedFrom(door)).toEqual(['4,3', '5,3', '6,3', '4,4', '5,4', '6,4', '4,5', '5,5', '6,5']);
  });

  it('is out of reach with one square of floor between', () => {
    expect(reachesDoor(at(3, 4), door)).toBe(false);
    expect(reachesDoor(at(5, 2), door)).toBe(false);
    expect(reachesDoor(at(7, 6), door)).toBe(false);
  });

  it('is reached only from its own floor', () => {
    const upstairs: DoorPlace = { ...door, level: 1 };
    expect(reachesDoor(at(4, 4), upstairs)).toBe(false);
    expect(reachesDoor(at(4, 4, 1), upstairs)).toBe(true);
    // A token with no floor said stands on the ground.
    expect(reachesDoor({ x: 4.5, y: 4.5 }, door)).toBe(true);
  });

  it('is reached by a big token from beside either half of it', () => {
    // A drone two squares wide over (1..2, 3..4): (3,4) is beside its right half.
    expect(reachesDoor({ x: 2, y: 4, size: 2 }, { kind: 'painted', level: 0, col: 3, row: 4 })).toBe(true);
    expect(reachesDoor({ x: 2, y: 4, size: 2 }, { kind: 'painted', level: 0, col: 4, row: 4 })).toBe(false);
    // …which the same drone, judged as one square, would not have been.
    expect(reachesDoor({ x: 1.5, y: 3.5 }, { kind: 'painted', level: 0, col: 3, row: 4 })).toBe(false);
  });
});

describe('a traced door', () => {
  // One square long, along the grid line y = 4 between x = 5 and x = 6: the
  // doorway between squares (5,3) above it and (5,4) below it.
  const door: DoorPlace = { kind: 'traced', a: { x: 5, y: 4 }, b: { x: 6, y: 4 } };

  it('drawn along a grid line, is reached from the six squares at its mouth', () => {
    expect(reachedFrom(door)).toEqual(['4,3', '5,3', '6,3', '4,4', '5,4', '6,4']);
  });

  it('is out of reach from a square back, or two along', () => {
    expect(reachesDoor(at(5, 2), door)).toBe(false);
    expect(reachesDoor(at(5, 5), door)).toBe(false);
    expect(reachesDoor(at(3, 3), door)).toBe(false);
    expect(reachesDoor(at(7, 4), door)).toBe(false);
  });

  it('down a grid line, the same way turned on its side', () => {
    const upright: DoorPlace = { kind: 'traced', a: { x: 6, y: 1 }, b: { x: 6, y: 2 } };
    expect(reachedFrom(upright)).toEqual(['5,0', '6,0', '5,1', '6,1', '5,2', '6,2']);
  });

  it('drawn off the grid lines, is reached from either side of it', () => {
    // Across the lower part of row 3, over a map image: the middle of (5,3)
    // is a fifth of a square above it, the middle of (5,4) four fifths below.
    const drawn: DoorPlace = { kind: 'traced', a: { x: 5, y: 3.7 }, b: { x: 6, y: 3.7 } };
    expect(reachesDoor(at(5, 3), drawn)).toBe(true);
    expect(reachesDoor(at(5, 4), drawn)).toBe(true);
    // The next square out on either side is more than a square from it.
    expect(reachesDoor(at(5, 2), drawn)).toBe(false);
    expect(reachesDoor(at(5, 5), drawn)).toBe(false);
  });

  it('drawn long or slanted, is reached anywhere along it', () => {
    const long: DoorPlace = { kind: 'traced', a: { x: 0, y: 8 }, b: { x: 10, y: 8 } };
    expect(reachesDoor(at(9, 7), long)).toBe(true);
    expect(reachesDoor(at(9, 6), long)).toBe(false);
    const slanted: DoorPlace = { kind: 'traced', a: { x: 2, y: 2 }, b: { x: 6, y: 6 } };
    expect(reachesDoor(at(5, 3), slanted)).toBe(true);
    expect(reachesDoor(at(6, 2), slanted)).toBe(false);
  });

  it('stands on every floor', () => {
    expect(reachesDoor(at(5, 3, 2), door)).toBe(true);
  });

  it('of no length is a point, and a door or runner that is not anywhere is never reached', () => {
    const point: DoorPlace = { kind: 'traced', a: { x: 5, y: 4 }, b: { x: 5, y: 4 } };
    expect(reachesDoor(at(4, 3), point)).toBe(true);
    expect(reachesDoor(at(3, 3), point)).toBe(false);
    expect(reachesDoor(at(5, 3), { kind: 'traced', a: { x: Number.NaN, y: 4 }, b: { x: 6, y: 4 } })).toBe(false);
    expect(reachesDoor({ x: Number.NaN, y: 3.5 }, door)).toBe(false);
  });
});

describe('doorPlaceOf', () => {
  const scene = { geometry: { doors: [{ id: 'd.front', a: { x: 5, y: 4 }, b: { x: 6, y: 4 } }] } };

  it('finds a traced door by id, and a painted one by cell and floor', () => {
    expect(doorPlaceOf(scene, { doorId: 'd.front' })).toEqual({ kind: 'traced', a: { x: 5, y: 4 }, b: { x: 6, y: 4 } });
    expect(doorPlaceOf(scene, { cell: '3,4', level: 1 })).toEqual({ kind: 'painted', level: 1, col: 3, row: 4 });
    expect(doorPlaceOf(scene, { cell: '3,4' })).toEqual({ kind: 'painted', level: 0, col: 3, row: 4 });
  });

  it('is null for a door that is not there, or a cell that is not a cell', () => {
    expect(doorPlaceOf(scene, { doorId: 'd.nowhere' })).toBeNull();
    expect(doorPlaceOf({}, { doorId: 'd.front' })).toBeNull();
    expect(doorPlaceOf(scene, { cell: 'three,four' })).toBeNull();
    expect(doorPlaceOf(scene, {})).toBeNull();
  });
});

describe('the ground a player walks on', () => {
  const scene = { grid: { cols: 10, rows: 5 } };

  it('is the grid, widened only to take in where the runner stands', () => {
    expect(walkBounds(scene, at(2, 2))).toEqual({ minCol: 0, minRow: 0, maxCol: 9, maxRow: 4 });
    expect(walkBounds(scene, at(-3, 7))).toEqual({ minCol: -3, minRow: 0, maxCol: 9, maxRow: 7 });
    // A start that is not a number widens nothing.
    expect(walkBounds(scene, { x: Number.NaN, y: 1 })).toEqual({ minCol: 0, minRow: 0, maxCol: 9, maxRow: 4 });
  });

  it('takes a move anywhere on the map, and back onto it from where the GM left a runner', () => {
    expect(onWalkGround(scene, at(2, 2), at(9, 4))).toBe(true);
    expect(onWalkGround(scene, at(2, 2), at(0, 0))).toBe(true);
    expect(onWalkGround(scene, at(-3, 2), at(-2, 2))).toBe(true);
    expect(onWalkGround(scene, at(-3, 2), at(4, 2))).toBe(true);
  });

  it('refuses a move off the map, however near or far', () => {
    expect(onWalkGround(scene, at(2, 2), at(10, 2))).toBe(false);
    expect(onWalkGround(scene, at(2, 2), at(2, -1))).toBe(false);
    expect(onWalkGround(scene, at(2, 2), { x: 1_000_000.5, y: 2.5 })).toBe(false);
    expect(onWalkGround(scene, at(2, 2), { x: Number.NaN, y: 2.5 })).toBe(false);
    // A runner the GM left off the edge walks back on, not further out.
    expect(onWalkGround(scene, at(-3, 2), at(-4, 2))).toBe(false);
  });
});
