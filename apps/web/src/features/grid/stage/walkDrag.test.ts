/**
 * Where a dragged token goes, by who is dragging it (`walkDragTarget`): the
 * GM's rule (2026-09-27) that only the GM moves tokens through walls, as the
 * drag itself applies it, before the server ever sees the drop.
 *
 * Pinned against what a player does with a runner on a phone: drag it at a
 * wall, through a shut door, between the squares of a wall drawn at an
 * angle, round the end of a wall, off the edge of the map, all over the map
 * in a hurry — and against what must stay exactly as it was: the GM's drag,
 * and a player's drag where nothing is in the way. The one promise under
 * all of it: wherever a player's drag ends, the server (`canWalk`) accepts
 * the drop.
 */
import { describe, expect, it } from 'vitest';
import type { Point } from '@safehouse/contracts';
import { canWalk, squareOf, walkToward, type LayeredTiles, type WalkSceneInput } from '@safehouse/rules';
import { centreIn, walkBounds, walkDragTarget, type DragWalkInput } from './walkDrag.js';

/** A token's centre in square (`col`, `row`). */
const sq = (col: number, row: number): Point => ({ x: col + 0.5, y: row + 0.5 });

/**
 * A floor from a sketch, in the docklands set: `#` wall, `D` a shut door,
 * `O` an open door, `c` a pallet stack (furniture), `.` bare floor.
 */
function floor(rows: string[]): LayeredTiles {
  const structure: Record<string, string> = {};
  const object: Record<string, string> = {};
  const doors: Record<string, { open: boolean }> = {};
  rows.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      const key = `${col},${row}`;
      if (ch === '#') structure[key] = 'wall';
      if (ch === 'D' || ch === 'O') {
        structure[key] = 'door';
        doors[key] = { open: ch === 'O' };
      }
      if (ch === 'c') object[key] = 'crates';
    });
  });
  return { tilesetId: 'docklands', structure, object, doors };
}

function scene(rows: string[], extra: Partial<WalkSceneInput> = {}): WalkSceneInput {
  return { grid: { cols: rows[0]!.length, rows: rows.length }, tiles: floor(rows), ...extra };
}

/** A wall painted down column 5 of a 10 × 5 map, floor either side of it. */
const WALLED = scene([
  '.....#....',
  '.....#....',
  '.....#....',
  '.....#....',
  '.....#....',
]);

/** One frame of a player's drag on `WALLED`, begun where `from` is, unless the input says otherwise. */
function drag(input: Partial<DragWalkInput> & Pick<DragWalkInput, 'from' | 'want'>): Point {
  return walkDragTarget({ role: 'player', scene: WALLED, level: 0, size: 1, origin: input.from, ...input });
}

describe('walkDragTarget: who is stopped', () => {
  it('the GM goes wherever the pointer does, walls or no walls, on the map or off it', () => {
    expect(drag({ role: 'gm', from: sq(1, 2), want: sq(8, 2) })).toEqual(sq(8, 2));
    // Unsnapped too: the GM's point, untouched.
    expect(drag({ role: 'gm', from: sq(1, 2), want: { x: 8.3, y: 2.9 } })).toEqual({ x: 8.3, y: 2.9 });
    expect(drag({ role: 'gm', from: sq(1, 2), want: sq(-4, 12) })).toEqual(sq(-4, 12));
  });

  it("a player's runner slides up to the wall and stops in the last square before it", () => {
    expect(drag({ from: sq(1, 2), want: sq(8, 2) })).toEqual(sq(4, 2));
    // From the other side, the same wall.
    expect(drag({ from: sq(8, 2), want: sq(1, 2) })).toEqual(sq(6, 2));
  });

  it('everyone who is not the GM is walked', () => {
    for (const role of ['player', 'observer', 'display'] as const) {
      expect(drag({ role, from: sq(1, 2), want: sq(8, 2) }), role).toEqual(sq(4, 2));
    }
  });
});

describe('walkDragTarget: where the way is clear, nothing changes', () => {
  it('the token is exactly where the pointer put it, snapped or not', () => {
    expect(drag({ from: sq(1, 2), want: sq(4, 4) })).toEqual(sq(4, 4));
    expect(drag({ from: sq(1, 2), want: { x: 3.2, y: 0.7 } })).toEqual({ x: 3.2, y: 0.7 });
  });

  it('furniture never stops a runner', () => {
    const yard = scene(['..cc......', '..cc......']);
    expect(drag({ scene: yard, from: sq(0, 0), want: sq(8, 1) })).toEqual(sq(8, 1));
  });

  it('a runner pressed against a wall it already stands by does not twitch', () => {
    // Off the square's centre, where the GM left it: it stays exactly there.
    const at = { x: 4.3, y: 2.8 };
    expect(drag({ from: at, want: sq(8, 2) })).toBe(at);
  });
});

describe('walkDragTarget: doors and traced walls', () => {
  it('a shut painted door stops the runner and an open one lets it through', () => {
    const shut = scene(['.....#....', '.....D....', '.....#....']);
    const open = scene(['.....#....', '.....O....', '.....#....']);
    expect(drag({ scene: shut, from: sq(1, 1), want: sq(8, 1) })).toEqual(sq(4, 1));
    expect(drag({ scene: open, from: sq(1, 1), want: sq(8, 1) })).toEqual(sq(8, 1));
  });

  it('a traced wall stops the crossing, and so does a traced door until it is opened', () => {
    const line = { a: { x: 5, y: 0 }, b: { x: 5, y: 5 } };
    const bare = ['..........', '..........', '..........', '..........', '..........'];
    const walled = scene(bare, { geometry: { walls: [{ id: 'w', ...line }], doors: [] } });
    const shut = scene(bare, { geometry: { walls: [], doors: [{ id: 'd', ...line, open: false }] } });
    const open = scene(bare, { geometry: { walls: [], doors: [{ id: 'd', ...line, open: true }] } });
    expect(drag({ scene: walled, from: sq(1, 2), want: sq(8, 2) })).toEqual(sq(4, 2));
    expect(drag({ scene: shut, from: sq(1, 2), want: sq(8, 2) })).toEqual(sq(4, 2));
    expect(drag({ scene: open, from: sq(1, 2), want: sq(8, 2) })).toEqual(sq(8, 2));
  });

  it('no slipping between the squares of a wall drawn at an angle', () => {
    // A diagonal wall is a staircase of squares that touch at their corners.
    const angled = scene(['......', '...#..', '..#...', '.#....', '......']);
    // From just above the wall's middle to just below it, corner to corner.
    expect(drag({ scene: angled, from: sq(2, 1), want: sq(3, 2) })).toEqual(sq(2, 1));
    expect(drag({ scene: angled, from: sq(2, 1), want: sq(5, 4) })).toEqual(sq(2, 1));
  });
});

describe('walkDragTarget: the edge of the map', () => {
  it("the pointer off the map pulls a player's runner to the edge and no further", () => {
    expect(drag({ from: sq(1, 2), want: sq(-3, 2) })).toEqual(sq(0, 2));
    expect(drag({ from: sq(2, 1), want: sq(2, 9) })).toEqual(sq(2, 4));
    // Off the map beyond the wall: to the wall, as on the map.
    expect(drag({ from: sq(1, 2), want: sq(14, 2) })).toEqual(sq(4, 2));
  });

  it('a runner the GM left off the map can be walked back on, and back where it stood', () => {
    const outside = sq(-3, 2);
    expect(drag({ origin: outside, from: outside, want: sq(2, 2) })).toEqual(sq(2, 2));
    expect(drag({ origin: outside, from: sq(2, 2), want: sq(-3, 2) })).toEqual(sq(-3, 2));
    // …but no further out than that.
    expect(drag({ origin: outside, from: outside, want: sq(-6, 2) })).toBe(outside);
    expect(walkBounds(WALLED, outside)).toEqual({ minCol: -3, minRow: 0, maxCol: 9, maxRow: 4 });
  });
});

describe('walkDragTarget: a whole drag', () => {
  // A wall down column 4, rows 1–3, open at both ends.
  const pillar = scene(['..........', '....#.....', '....#.....', '....#.....', '..........']);

  it('follows the pointer round the end of a wall, frame by frame', () => {
    const start = sq(2, 2);
    const frames = [sq(7, 2), sq(3, 4), sq(7, 4), sq(7, 2)];
    let at = start;
    const drawn: Point[] = [];
    for (const want of frames) {
      at = drag({ scene: pillar, origin: start, from: at, want });
      drawn.push(at);
    }
    // Stopped at the wall, round its end, along the far side, and back up.
    expect(drawn).toEqual([sq(3, 2), sq(3, 4), sq(7, 4), sq(7, 2)]);
    // Where the drop lands is one the server walks from where the token stood…
    expect(canWalk(pillar, 0, start, at)).toBe(true);
    // …and one the drag would never have reached walking from its start alone.
    expect(walkToward(pillar, 0, start, sq(7, 2))).toEqual({ col: 3, row: 2 });
  });

  it('a drag that wanders all over the map, and off it, never ends where the server would refuse it', () => {
    // The corner at the bottom right is sealed from the rest by walls and a
    // traced wall along the top of it: reachable only round the outside of
    // the map, which a player's runner may not use (and the server would
    // not find).
    const maze = scene(
      [
        '....#.......',
        '.##.#.####..',
        '.#..D....#..',
        '.#.###.#.#..',
        '.#...#.#....',
        '.####O.####.',
        '......#.....',
        '.....#......',
      ],
      { geometry: { walls: [{ id: 'w', a: { x: 9, y: 6 }, b: { x: 12, y: 6 } }], doors: [] } },
    );
    // A fixed pseudo-random pointer (xorshift32), so the test is the same
    // every run: mostly small moves near the runner, now and then a fling
    // anywhere, the map's surroundings included.
    let seed = 0x2545f491;
    const next = (): number => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed / 4294967296;
    };
    const start = sq(0, 0);
    let at = start;
    const visited = new Set<string>();
    for (let frame = 0; frame < 600; frame += 1) {
      const want =
        next() < 0.3
          ? { x: next() * 20 - 4, y: next() * 16 - 4 }
          : { x: at.x + (next() - 0.5) * 4, y: at.y + (next() - 0.5) * 4 };
      at = drag({ scene: maze, origin: start, from: at, want });
      expect(canWalk(maze, 0, start, at), `frame ${frame}: ${at.x},${at.y}`).toBe(true);
      const { col, row } = squareOf(at);
      visited.add(`${col},${row}`);
    }
    // It really did get about, rather than sitting in its corner…
    expect(visited.size).toBeGreaterThan(15);
    // …and never into the sealed corner, nor off the map.
    for (const key of visited) {
      const [col, row] = key.split(',').map(Number) as [number, number];
      expect(col >= 0 && col < 12 && row >= 0 && row < 8, key).toBe(true);
      expect(row >= 6 && col >= 7, key).toBe(false);
    }
  });

  it('is judged on the floor the token stands on', () => {
    const building: WalkSceneInput = {
      grid: { cols: 10, rows: 2 },
      tiles: floor(['..........', '..........']),
      levels: [{ id: 'l1', name: 'Catwalk', tiles: floor(['.....#....', '.....#....']) }],
    };
    expect(drag({ scene: building, level: 0, from: sq(1, 0), want: sq(8, 0) })).toEqual(sq(8, 0));
    expect(drag({ scene: building, level: 1, from: sq(1, 0), want: sq(8, 0) })).toEqual(sq(4, 0));
  });
});

describe('centreIn: where a token stopped short stands', () => {
  it('a runner on the square centre, a van on the corner the walk judges it by', () => {
    expect(centreIn({ col: 4, row: 2 }, 1)).toEqual({ x: 4.5, y: 2.5 });
    expect(centreIn({ col: 4, row: 2 }, 3)).toEqual({ x: 4.5, y: 2.5 });
    expect(centreIn({ col: 4, row: 2 }, 2)).toEqual({ x: 4, y: 2 });
    // Whatever size, the point is in the square it was stopped in.
    for (const size of [0.5, 1, 2, 3, 4, Number.NaN]) {
      expect(squareOf(centreIn({ col: 4, row: 2 }, size)), String(size)).toEqual({ col: 4, row: 2 });
    }
  });

  it('a big token stopped at a wall sits on the grid as it would snap', () => {
    // A van (2 squares) snapped to the corner at (2, 2), dragged at the wall.
    expect(drag({ size: 2, from: { x: 2, y: 2 }, want: { x: 8, y: 2 } })).toEqual({ x: 4, y: 2 });
  });
});
