/**
 * Where a runner can walk (movement/walk.ts): the GM's rule that a player's
 * token never passes a wall or a closed door, whatever way it is drawn.
 *
 * Pinned against what a player would try at the table: dragging straight
 * through a wall, slipping diagonally between the squares of a wall drawn
 * at an angle, clipping the end of a traced wall, walking through a door the
 * GM has not opened — and against what they must still be able to do: go
 * round, go through an open door, step past the furniture.
 */
import { describe, expect, it } from 'vitest';
import {
  WALK_DIRECTIONS,
  arcCells,
  canWalk,
  walkMapFor,
  walkStep,
  walkToward,
  type ArcLike,
  type LayeredTiles,
  type WalkSceneInput,
} from '../src/index.js';

/** A token's centre in square (`col`, `row`). */
const sq = (col: number, row: number) => ({ x: col + 0.5, y: row + 0.5 });

const dir = (dx: number, dy: number) => WALK_DIRECTIONS.findIndex(([x, y]) => x === dx && y === dy);

/**
 * A floor from a sketch, in the docklands set:
 * `#` wall, `W` window, `D` a shut door, `O` an open door, `S` a stair up,
 * `c` a pallet stack, `k` a shipping container (full-height furniture),
 * `.` bare floor.
 */
function floor(rows: string[], arcs: ArcLike[] = []): LayeredTiles {
  const structure: Record<string, string> = {};
  const object: Record<string, string> = {};
  const doors: Record<string, { open: boolean }> = {};
  rows.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      const key = `${col},${row}`;
      if (ch === '#') structure[key] = 'wall';
      if (ch === 'W') structure[key] = 'window';
      if (ch === 'S') structure[key] = 'stairup';
      if (ch === 'D' || ch === 'O') {
        structure[key] = 'door';
        doors[key] = { open: ch === 'O' };
      }
      if (ch === 'c') object[key] = 'crates';
      if (ch === 'k') object[key] = 'container';
    });
  });
  return { tilesetId: 'docklands', structure, object, doors, ...(arcs.length > 0 ? { arcs } : {}) };
}

function scene(rows: string[], extra: Partial<WalkSceneInput> = {}, arcs: ArcLike[] = []): WalkSceneInput {
  return {
    grid: { cols: rows[0]!.length, rows: rows.length },
    tiles: floor(rows, arcs),
    ...extra,
  };
}

describe('canWalk: painted walls', () => {
  const room = [
    '..........',
    '.####.###.',
    '.#......#.',
    '.#......#.',
    '.########.',
    '..........',
  ];

  it('refuses a step straight into a wall and accepts one beside it', () => {
    const s = scene(room);
    expect(canWalk(s, 0, sq(1, 0), sq(1, 1))).toBe(false);
    expect(canWalk(s, 0, sq(0, 0), sq(0, 1))).toBe(true);
  });

  it('goes round through the gap in the wall, however far that is', () => {
    const s = scene(room);
    // From outside the bottom wall to the middle of the room: straight up is
    // a wall, the way in is the gap in the top wall.
    expect(canWalk(s, 0, sq(4, 5), sq(4, 3))).toBe(true);
    // Sealed: the gap bricked up, and nothing gets in.
    const sealed = scene(room.map((l, i) => (i === 1 ? '.########.' : l)));
    expect(canWalk(sealed, 0, sq(4, 5), sq(4, 3))).toBe(false);
    expect(canWalk(sealed, 0, sq(4, 3), sq(4, 5))).toBe(false);
    // …and inside it the runner still walks about.
    expect(canWalk(sealed, 0, sq(2, 2), sq(7, 3))).toBe(true);
  });

  it('never ends a move in a wall square, even an adjacent one', () => {
    const s = scene(room);
    expect(canWalk(s, 0, sq(2, 2), sq(1, 2))).toBe(false);
  });

  it('a window is a wall to a body, a stair is not', () => {
    const s = scene([
      '.....',
      'WWSWW',
      '.....',
    ]);
    expect(canWalk(s, 0, sq(0, 0), sq(0, 2))).toBe(true); // via the stair
    expect(canWalk(s, 0, sq(2, 0), sq(2, 1))).toBe(true); // onto it
    const noStair = scene(['.....', 'WWWWW', '.....']);
    expect(canWalk(noStair, 0, sq(0, 0), sq(0, 2))).toBe(false);
  });

  it('furniture does not stop a runner: the GM said walls', () => {
    const s = scene([
      '.....',
      'ckkkc',
      '.....',
    ]);
    expect(canWalk(s, 0, sq(2, 0), sq(2, 2))).toBe(true);
    expect(canWalk(s, 0, sq(2, 0), sq(2, 1))).toBe(true);
  });

  it('reads a scene painted before layers existed exactly as a layered one', () => {
    const legacy: WalkSceneInput = {
      grid: { cols: 3, rows: 3 },
      tiles: { tilesetId: 'docklands', cells: { '0,1': 'wall', '1,1': 'wall', '2,1': 'wall' } },
    };
    expect(canWalk(legacy, 0, sq(1, 0), sq(1, 2))).toBe(false);
  });

  it('skips a set this build does not know rather than walling the map', () => {
    const unknown: WalkSceneInput = {
      grid: { cols: 3, rows: 3 },
      tiles: { tilesetId: 'no-such-set', structure: { '0,1': 'wall', '1,1': 'wall', '2,1': 'wall' } },
    };
    expect(canWalk(unknown, 0, sq(1, 0), sq(1, 2))).toBe(true);
  });
});

describe('canWalk: painted doors', () => {
  const hall = [
    '.....',
    '##D##',
    '.....',
  ];

  it('a shut door is a wall, an open one a doorway', () => {
    expect(canWalk(scene(hall), 0, sq(2, 0), sq(2, 2))).toBe(false);
    expect(canWalk(scene(hall), 0, sq(2, 0), sq(2, 1))).toBe(false);
    const open = scene(hall.map((l) => l.replace('D', 'O')));
    expect(canWalk(open, 0, sq(2, 0), sq(2, 2))).toBe(true);
    expect(canWalk(open, 0, sq(0, 0), sq(4, 2))).toBe(true);
  });

  it('a runner the GM left standing in a doorway may step out of it', () => {
    expect(canWalk(scene(hall), 0, sq(2, 1), sq(2, 2))).toBe(true);
    // Staying put is never refused, whatever the square.
    expect(canWalk(scene(hall), 0, sq(2, 1), { x: 2.9, y: 1.1 })).toBe(true);
  });
});

describe('canWalk: no corner cutting', () => {
  // A wall drawn at an angle: squares that touch only at their corners.
  const slant = [
    '...#',
    '..#.',
    '.#..',
    '#...',
  ];

  it('cannot slip diagonally between two squares of a slanted painted wall', () => {
    const s = scene(slant);
    expect(canWalk(s, 0, sq(1, 1), sq(2, 2))).toBe(false);
    expect(canWalk(s, 0, sq(0, 0), sq(3, 3))).toBe(false);
    expect(walkStep(walkMapFor(s), 1, 1, dir(1, 1))).toBe(false);
    // Along the wall, on its own side, is fine.
    expect(canWalk(s, 0, sq(0, 2), sq(2, 0))).toBe(true);
  });

  it('refuses a diagonal past one blocked neighbour, and walks round it instead', () => {
    const s = scene([
      '.#.',
      '...',
    ]);
    expect(walkStep(walkMapFor(s), 0, 0, dir(1, 1))).toBe(false);
    expect(canWalk(s, 0, sq(0, 0), sq(1, 1))).toBe(true); // down, then across
  });
});

describe('canWalk: traced walls and doors', () => {
  // A 6×4 room of traced walls on the grid lines, its door in the top wall.
  const walls = [
    { id: 'w.left', a: { x: 1, y: 1 }, b: { x: 1, y: 4 } },
    { id: 'w.right', a: { x: 5, y: 1 }, b: { x: 5, y: 4 } },
    { id: 'w.bottom', a: { x: 1, y: 4 }, b: { x: 5, y: 4 } },
    { id: 'w.top1', a: { x: 1, y: 1 }, b: { x: 3, y: 1 } },
    { id: 'w.top2', a: { x: 4, y: 1 }, b: { x: 5, y: 1 } },
  ];
  const door = (open: boolean) => ({ id: 'd.top', a: { x: 3, y: 1 }, b: { x: 4, y: 1 }, open });
  const traced = (open: boolean, extra: object[] = []): WalkSceneInput => ({
    grid: { cols: 7, rows: 6 },
    geometry: { walls: [...walls, ...(extra as typeof walls)], doors: [door(open)] },
  });

  it('a traced wall cuts the crossing, not the squares either side of it', () => {
    const s = traced(false);
    expect(canWalk(s, 0, sq(0, 2), sq(1, 2))).toBe(false); // through the left wall
    expect(canWalk(s, 0, sq(1, 2), sq(2, 2))).toBe(true); // inside, beside it
    expect(canWalk(s, 0, sq(0, 2), sq(0, 5))).toBe(true); // outside, along it
  });

  it('a closed traced door keeps a runner out; opening it lets them in', () => {
    expect(canWalk(traced(false), 0, sq(3, 0), sq(3, 2))).toBe(false);
    expect(canWalk(traced(false), 0, sq(6, 5), sq(2, 3))).toBe(false);
    expect(canWalk(traced(true), 0, sq(3, 0), sq(3, 2))).toBe(true);
    expect(canWalk(traced(true), 0, sq(6, 5), sq(2, 3))).toBe(true);
  });

  it('cannot clip the corner where a traced wall ends', () => {
    // A lone wall down the grid line x = 3, from the top edge to y = 2.
    const s: WalkSceneInput = {
      grid: { cols: 6, rows: 4 },
      geometry: { walls: [{ id: 'w', a: { x: 3, y: 0 }, b: { x: 3, y: 2 } }], doors: [] },
    };
    const map = walkMapFor(s);
    // From (2,1) to (3,2) is a diagonal through the wall's end.
    expect(walkStep(map, 2, 1, dir(1, 1))).toBe(false);
    // …but round the end is two honest steps.
    expect(canWalk(s, 0, sq(2, 1), sq(3, 2))).toBe(true);
    // Straight across the wall is refused; the long way round its end is not.
    expect(walkStep(map, 2, 0, dir(1, 0))).toBe(false);
    expect(canWalk(s, 0, sq(2, 0), sq(3, 0))).toBe(true);
  });

  it('a wall drawn in two pieces has no gap at the joint', () => {
    const s: WalkSceneInput = {
      grid: { cols: 4, rows: 4 },
      geometry: {
        walls: [
          { id: 'a', a: { x: 0, y: 2 }, b: { x: 2, y: 2 } },
          { id: 'b', a: { x: 2, y: 2 }, b: { x: 4, y: 2 } },
        ],
        doors: [],
      },
    };
    expect(canWalk(s, 0, sq(1, 1), sq(2, 2))).toBe(false);
    expect(canWalk(s, 0, sq(2, 1), sq(1, 2))).toBe(false);
    expect(canWalk(s, 0, sq(0, 0), sq(3, 3))).toBe(false);
  });

  it('a traced wall at an angle cannot be squeezed past either', () => {
    // Corner to corner across a 4×4 map, the diagonal x + y = 4.
    const s: WalkSceneInput = {
      grid: { cols: 4, rows: 4 },
      geometry: { walls: [{ id: 'd', a: { x: 0, y: 4 }, b: { x: 4, y: 0 } }], doors: [] },
    };
    expect(canWalk(s, 0, sq(0, 0), sq(3, 3))).toBe(false);
    expect(canWalk(s, 0, sq(1, 1), sq(2, 2))).toBe(false);
    expect(canWalk(s, 0, sq(0, 0), sq(2, 0))).toBe(true);
  });
});

describe('canWalk: arc walls', () => {
  it('a curved wall across the map blocks every square it passes through', () => {
    // Bulging up the grid: the curve's top is y = 2, its ends y = 5.
    const arc: ArcLike = { id: 'arc', a: { x: 0, y: 5 }, b: { x: 10, y: 5 }, bulge: 3, tile: 'wall' };
    const s = scene(Array.from({ length: 8 }, () => '..........'), {}, [arc]);
    const map = walkMapFor(s);
    for (const key of arcCells(arc)) {
      const [col, row] = key.split(',').map(Number) as [number, number];
      if (col < 10) expect(canWalk(s, 0, sq(5, 0), sq(col, row))).toBe(false);
    }
    expect(map.blocked.size).toBeGreaterThan(10);
    // Above the curve to below it: sealed off.
    expect(canWalk(s, 0, sq(5, 0), sq(5, 7))).toBe(false);
    expect(canWalk(s, 0, sq(0, 0), sq(0, 7))).toBe(false);
    // Either side of it, a runner walks.
    expect(canWalk(s, 0, sq(0, 0), sq(9, 0))).toBe(true);
    expect(canWalk(s, 0, sq(0, 7), sq(9, 7))).toBe(true);
  });

  it('a wall at an angle, painted as an arc, has no diagonal gaps', () => {
    const arc: ArcLike = { id: 'slant', a: { x: 0, y: 6 }, b: { x: 6, y: 0 }, bulge: 0, tile: 'wall' };
    const s = scene(Array.from({ length: 6 }, () => '......'), {}, [arc]);
    expect(canWalk(s, 0, sq(0, 0), sq(5, 5))).toBe(false);
    expect(canWalk(s, 0, sq(1, 1), sq(3, 3))).toBe(false);
  });

  it('a door painted where an arc runs is the opening in it', () => {
    const arc: ArcLike = { id: 'line', a: { x: 0, y: 3.5 }, b: { x: 8, y: 3.5 }, bulge: 0, tile: 'wall' };
    const shut = scene(['........', '........', '........', '....D...', '........', '........'], {}, [arc]);
    const open = scene(['........', '........', '........', '....O...', '........', '........'], {}, [arc]);
    expect(canWalk(shut, 0, sq(4, 0), sq(4, 5))).toBe(false);
    expect(canWalk(open, 0, sq(4, 0), sq(4, 5))).toBe(true);
    // The arc still stands either side of the door.
    expect(canWalk(open, 0, sq(3, 2), sq(3, 3))).toBe(false);
  });
});

describe('canWalk: floors, the map edge and nonsense', () => {
  it('reads the walls of the floor the runner is on', () => {
    const s: WalkSceneInput = {
      grid: { cols: 3, rows: 3 },
      tiles: floor(['...', '...', '...']),
      levels: [{ id: 'up', name: 'Catwalk', tiles: floor(['...', '###', '...']) }],
    };
    expect(canWalk(s, 0, sq(1, 0), sq(1, 2))).toBe(true);
    expect(canWalk(s, 1, sq(1, 0), sq(1, 2))).toBe(false);
  });

  it('walks a token the GM left off the edge back onto the map', () => {
    const s = scene(['...', '...']);
    expect(canWalk(s, 0, sq(-3, 1), sq(1, 1))).toBe(true);
  });

  it('refuses a position that is not a number, or absurdly far away', () => {
    const s = scene(['...']);
    expect(canWalk(s, 0, sq(0, 0), { x: Number.NaN, y: 0 })).toBe(false);
    expect(canWalk(s, 0, sq(0, 0), { x: 1e12, y: 0.5 })).toBe(false);
  });

  it('builds a floor once, and again when a door opens', () => {
    const tiles = floor(['.D.']);
    const geometry = { walls: [], doors: [] };
    const a = walkMapFor({ tiles, geometry }, 0);
    // A new scene object round the same floor (a token moved): the same map.
    expect(walkMapFor({ tiles, geometry, grid: { cols: 3, rows: 1 } }, 0)).toBe(a);
    const opened = { ...tiles, doors: { '1,0': { open: true } } };
    const b = walkMapFor({ tiles: opened, geometry }, 0);
    expect(b).not.toBe(a);
    expect(a.blocked.size).toBe(1);
    expect(b.blocked.size).toBe(0);
  });
});

describe('walkToward: the drag stops at the wall', () => {
  const s = scene([
    '........',
    '...#....',
    '........',
  ]);

  it('stops in the last square before the wall', () => {
    expect(walkToward(s, 0, sq(0, 1), sq(7, 1))).toEqual({ col: 2, row: 1 });
    expect(walkToward(s, 0, sq(7, 1), sq(0, 1))).toEqual({ col: 4, row: 1 });
  });

  it('reaches the target when nothing is in the way', () => {
    expect(walkToward(s, 0, sq(0, 0), sq(7, 0))).toEqual({ col: 7, row: 0 });
    expect(walkToward(s, 0, sq(0, 2), sq(7, 2))).toEqual({ col: 7, row: 2 });
    expect(walkToward(s, 0, sq(2, 2), sq(2, 2))).toEqual({ col: 2, row: 2 });
  });

  it('stops short of a wall square on its diagonal', () => {
    // From (2,0) to (4,2) runs straight through the wall square (3,1).
    expect(walkToward(s, 0, sq(2, 0), sq(4, 2))).toEqual({ col: 2, row: 0 });
  });

  it('slides round the corner of a wall rather than cutting it', () => {
    // The diagonal from (0,0) to (1,1) would clip the wall square (1,0): the
    // drag goes down and across instead, and carries on to the target.
    const corner = scene(['.#.', '...', '...']);
    expect(walkToward(corner, 0, sq(0, 0), sq(2, 2))).toEqual({ col: 2, row: 2 });
  });

  it('does not slip between the squares of a slanted wall', () => {
    const slant = scene(['...#', '..#.', '.#..', '#...']);
    expect(walkToward(slant, 0, sq(0, 0), sq(3, 3))).toEqual({ col: 1, row: 1 });
  });

  it('stops at a traced wall and a shut traced door', () => {
    const traced: WalkSceneInput = {
      grid: { cols: 8, rows: 3 },
      geometry: {
        walls: [{ id: 'w', a: { x: 4, y: 0 }, b: { x: 4, y: 1 } }],
        doors: [{ id: 'd', a: { x: 4, y: 1 }, b: { x: 4, y: 3 }, open: false }],
      },
    };
    expect(walkToward(traced, 0, sq(0, 0), sq(7, 0))).toEqual({ col: 3, row: 0 });
    expect(walkToward(traced, 0, sq(0, 2), sq(7, 2))).toEqual({ col: 3, row: 2 });
  });

  it('only ever lands where canWalk agrees the runner can go', () => {
    const maze = scene(
      [
        '..........',
        '.###.###..',
        '.#.D...#..',
        '.#.#####..',
        '...#......',
        '.#...##.#.',
      ],
      { geometry: { walls: [{ id: 'w', a: { x: 6, y: 4 }, b: { x: 10, y: 4 } }], doors: [] } },
    );
    for (let fc = 0; fc < 10; fc += 3) {
      for (let fr = 0; fr < 6; fr += 2) {
        for (let tc = 0; tc < 10; tc += 1) {
          for (let tr = 0; tr < 6; tr += 1) {
            const to = walkToward(maze, 0, sq(fc, fr), sq(tc, tr));
            expect(canWalk(maze, 0, sq(fc, fr), sq(to.col, to.row))).toBe(true);
          }
        }
      }
    }
  });
});
