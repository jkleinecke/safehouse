/**
 * The party's sight (P6 sightlines): walls and doors, strict SR5 darkness,
 * the wall-face rule and the pooled, per-floor union the server writes as
 * the fog's live squares.
 *
 * Pinned against what the table would notice: a wall that is only there
 * near the runner, a lit room down the hall that stays black, a dark room a
 * troll should see into and does not, a door that is open on the map and
 * shut to the eyes, a runner upstairs seeing through the walls downstairs.
 */
import { describe, expect, it } from 'vitest';
import {
  ULTRASOUND_RANGE_M,
  cellBitsCount,
  cellBitsHas,
  lightMapFor,
  lineOfSightBetween,
  partySight,
  seesInLight,
  sightFor,
  sightModelFor,
  visibleFrom,
  type LightSource,
  type PartySightScene,
  type SightCell,
  type SightModel,
  type VisionMode,
} from '../src/index.js';

const at = (col: number, row: number) => ({ col, row });

/** A model from a sketch: `#` blocks sight. */
function model(rows: string[], segments: SightModel['segments'] = []): SightModel {
  const cells = new Map<string, SightCell>();
  rows.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch === '#') cells.set(`${col},${row}`, { blocksSight: true, givesCover: false, blocksMovement: true, height: 1 });
    });
  });
  return { cells, segments };
}

const lamp = (x: number, y: number, over: Partial<LightSource> = {}): LightSource => ({
  id: `gm:${x},${y}`,
  kind: 'gm',
  at: { x, y },
  height: 0.8,
  radius: 3,
  rows: 2,
  color: '#ffd9a0',
  ...over,
});

/** A night scene: total darkness until something lights it. */
const DARK = { environment: { light: 3 } };

const NORMAL: VisionMode[] = ['normal'];
const LOWLIGHT: VisionMode[] = ['normal', 'lowlight'];
const THERMO: VisionMode[] = ['normal', 'thermographic'];
const ULTRA: VisionMode[] = ['normal', 'ultrasound'];

/** Every square of a row that is in `seen`, by column. */
const colsSeen = (seen: ReadonlyMap<string, unknown>, row: number, cols: number) =>
  Array.from({ length: cols }, (_, col) => col).filter((col) => seen.has(`${col},${row}`));

describe('sightFor: walls', () => {
  it('sees every square of a long wall it grazes, and nothing behind it', () => {
    // The probe that found it: a runner near one end of a 21-square wall
    // sees all the floor in front of it, but a centre ray to most of the
    // wall's own squares clips the wall square before it.
    const hall = model([
      '.....................',
      '.....................',
      '.....................',
      '#####################',
      '#####################',
      '.....................',
    ]);
    const bare = visibleFrom(at(2, 0), hall, { range: 40, cols: 21, rows: 6 });
    expect(colsSeen(bare, 3, 21).length).toBeLessThan(21);

    const seen = sightFor(at(2, 0), hall, null, NORMAL, { cols: 21, rows: 6 });
    expect(colsSeen(seen, 2, 21)).toHaveLength(21);
    // The whole face of the wall: the wall-face rule.
    expect(colsSeen(seen, 3, 21)).toHaveLength(21);
    // It never chains: the wall's second course is behind its first, and the
    // far side is behind both.
    expect(colsSeen(seen, 4, 21)).toEqual([]);
    expect(colsSeen(seen, 5, 21)).toEqual([]);
  });

  it('remembers a whole room, corners included, and nothing outside it', () => {
    const block = model([
      '.........',
      '.#######.',
      '.#.....#.',
      '.#.....#.',
      '.#######.',
      '.........',
    ]);
    const seen = sightFor(at(4, 2), block, null, NORMAL, { cols: 9, rows: 6 });
    for (const [col, row] of [[1, 1], [7, 1], [1, 4], [7, 4], [4, 1], [4, 4], [1, 3], [7, 2]] as const) {
      expect(seen.has(`${col},${row}`), `${col},${row}`).toBe(true);
    }
    for (const [col, row] of [[0, 0], [8, 5], [0, 2], [4, 0], [4, 5], [8, 3]] as const) {
      expect(seen.has(`${col},${row}`), `${col},${row}`).toBe(false);
    }
    // The room's floor and its ring of wall, exactly.
    expect(seen.size).toBe(7 * 4);
  });

  it('stops at a traced wall and at a closed traced door, and passes an open one', () => {
    const doorway = (open: boolean) =>
      model([], [
        { id: 'w.n', a: { x: 5, y: 0 }, b: { x: 5, y: 4 }, blocksSight: true },
        { id: 'd', a: { x: 5, y: 4 }, b: { x: 5, y: 5 }, blocksSight: !open },
        { id: 'w.s', a: { x: 5, y: 5 }, b: { x: 5, y: 9 }, blocksSight: true },
      ]);
    const shut = sightFor(at(2, 4), doorway(false), null, NORMAL, { cols: 10, rows: 9 });
    expect(shut.has('4,4')).toBe(true);
    expect(shut.has('6,4')).toBe(false);
    expect(shut.has('9,4')).toBe(false);
    const open = sightFor(at(2, 4), doorway(true), null, NORMAL, { cols: 10, rows: 9 });
    expect(open.has('6,4')).toBe(true);
    expect(open.has('9,4')).toBe(true);
    // Only through the door: well up the far side is still behind the wall.
    expect(open.has('6,0')).toBe(false);
  });

  it('does not lend a wall face across a traced wall', () => {
    // A painted rack at (5,0) on the far side of a partition traced along
    // x = 5: the floor at (4,0) is seen, the rack beside it is not.
    const partition = model(['.....#....'], [{ id: 'w', a: { x: 5, y: 0 }, b: { x: 5, y: 1 }, blocksSight: true }]);
    const seen = sightFor(at(1, 0), partition, null, NORMAL, { cols: 10, rows: 1 });
    expect(seen.has('4,0')).toBe(true);
    expect(seen.has('5,0')).toBe(false);
    // Without the partition, the rack's face is seen and the ray stops at it.
    const open = sightFor(at(1, 0), model(['.....#....']), null, NORMAL, { cols: 10, rows: 1 });
    expect(open.has('5,0')).toBe(true);
    expect(open.has('6,0')).toBe(false);
  });

  it('does not lend a block on the far side of a 45-degree wall as if it were a room corner', () => {
    // The reviewer's case: a wall drawn at 45 degrees (col + row = 7, its
    // squares touching corner to corner) with a crate at (6,2) behind it.
    // From the floor square (5,1), both side neighbours are wall and the
    // diagonal one is the crate: the same 3x3 as a room's corner, which is
    // why the crate used to be lent to the table from behind the wall.
    const diagonal = model([
      '.......#..',
      '......#...',
      '.....##...',
      '....#.....',
      '...#......',
      '..#.......',
      '.#........',
      '#.........',
    ]);
    const seen = sightFor(at(2, 2), diagonal, null, NORMAL, { cols: 10, rows: 8 });
    // The wall's own face is seen, square by square...
    for (const [col, row] of [[6, 1], [5, 2], [4, 3], [3, 4]] as const) {
      expect(seen.has(`${col},${row}`), `${col},${row}`).toBe(true);
    }
    // ...and the crate behind it is not.
    expect(seen.has('6,2')).toBe(false);
    // Nothing on the far side at all.
    for (const [key] of seen) {
      const [col, row] = key.split(',').map(Number) as [number, number];
      expect(col + row, key).toBeLessThanOrEqual(7);
    }
  });

  it('still lends the corner of a room whose walls are thick', () => {
    // Two courses of wall all round: the inner corner square is where the
    // inner walls meet and runs on both ways, so it is remembered; the outer
    // course, behind it, never is.
    const bunker = model([
      '########',
      '########',
      '##....##',
      '##....##',
      '########',
      '########',
    ]);
    const seen = sightFor(at(3, 2), bunker, null, NORMAL, { cols: 8, rows: 6 });
    for (const [col, row] of [[1, 1], [6, 1], [1, 4], [6, 4]] as const) {
      expect(seen.has(`${col},${row}`), `${col},${row}`).toBe(true);
    }
    for (const [col, row] of [[0, 0], [7, 0], [0, 5], [7, 5], [0, 2], [3, 0], [3, 5]] as const) {
      expect(seen.has(`${col},${row}`), `${col},${row}`).toBe(false);
    }
  });
});

describe('sightFor: painted doors', () => {
  // A wall down column 5 with a door in it at (5,4), painted from a tileset.
  const dock = (open: boolean) =>
    sightModelFor({
      tiles: {
        tilesetId: 'docklands',
        structure: {
          '5,0': 'wall', '5,1': 'wall', '5,2': 'wall', '5,3': 'wall',
          '5,4': 'door',
          '5,5': 'wall', '5,6': 'wall', '5,7': 'wall', '5,8': 'wall',
        },
        ...(open ? { doors: { '5,4': { open: true } } } : {}),
      },
    });

  it('shut, it is the wall it is set in, and is remembered as a door', () => {
    const seen = sightFor(at(2, 4), dock(false), null, NORMAL, { cols: 10, rows: 9 });
    expect(seen.has('8,4')).toBe(false);
    expect(seen.has('6,4')).toBe(false);
    // The door square itself is a wall face the runner is looking at.
    expect(seen.has('5,4')).toBe(true);
  });

  it('open, the room beyond is seen through it', () => {
    const seen = sightFor(at(2, 4), dock(true), null, NORMAL, { cols: 10, rows: 9 });
    expect(seen.has('5,4')).toBe(true);
    expect(seen.has('6,4')).toBe(true);
    expect(seen.has('9,4')).toBe(true);
    // Beyond the frame, off the line of the doorway, the wall still hides it.
    expect(seen.has('6,0')).toBe(false);
  });

  it('a runner standing in the shut door sees that square alone, never both rooms', () => {
    // A ray out of the viewer's own square passes whatever is in it, so a
    // runner dropped on a closed door used to see the room on each side,
    // and the table was shown (and sent the guards of) the room the door is
    // shut on.
    const inDoor = sightFor(at(5, 4), dock(false), null, NORMAL, { cols: 10, rows: 9 });
    expect([...inDoor.keys()]).toEqual(['5,4']);
    // Opened, the door is a doorway, and standing in it shows both rooms.
    const inDoorway = sightFor(at(5, 4), dock(true), null, NORMAL, { cols: 10, rows: 9 });
    expect(inDoorway.has('2,4')).toBe(true);
    expect(inDoorway.has('8,4')).toBe(true);
  });

  it('a runner standing in a wall square sees that square alone', () => {
    const seen = sightFor(at(5, 1), dock(false), null, NORMAL, { cols: 10, rows: 9 });
    expect([...seen.keys()]).toEqual(['5,1']);
  });
});

describe('sightFor: darkness is strict SR5', () => {
  // A lamp-lit room on the left, a pitch-black one on the right, joined by
  // an open doorway at (7,2).
  const rooms = model([
    '.......#.......',
    '.......#.......',
    '...............',
    '.......#.......',
    '.......#.......',
  ]);
  const lit = lightMapFor(DARK, 0, { model: rooms, sources: [lamp(2.5, 2.5)], cols: 15, rows: 5 });
  const look = (modes: VisionMode[]) => sightFor(at(1, 2), rooms, lit, modes, { cols: 15, rows: 5 });

  it('sees the lamp-lit squares with any eyes', () => {
    for (const modes of [NORMAL, LOWLIGHT, THERMO]) {
      const seen = look(modes);
      expect(seen.has('3,2')).toBe(true);
      expect(seen.has('2,0')).toBe(true);
    }
  });

  it('shows the dark room to thermographic eyes, and not to normal or low-light ones', () => {
    const normal = look(NORMAL);
    const lowlight = look(LOWLIGHT);
    const thermo = look(THERMO);
    // Straight through the doorway, into the dark.
    expect(normal.has('10,2')).toBe(false);
    expect(lowlight.has('10,2')).toBe(false);
    expect(thermo.has('10,2')).toBe(true);
    expect(thermo.has('14,2')).toBe(true);
    // The unlit corner of the lamp's own room, too.
    expect(normal.has('6,0')).toBe(false);
    expect(thermo.has('6,0')).toBe(true);
    // Total darkness still applies to low-light: it reveals exactly what
    // normal eyes do (it helps the dice, not the map).
    expect([...lowlight.keys()].sort()).toEqual([...normal.keys()].sort());
    // A thermographic runner sees everything a ray reaches.
    expect(thermo.size).toBeGreaterThan(normal.size);
  });

  it('does not see a wall lit only from its far side', () => {
    // A pitch-black corridor (row 1) and a lamp-lit office (rows 3-5), one
    // painted wall between them (row 2). The lamp lights the office side of
    // that wall; the corridor side is as dark as the corridor. A runner in
    // the corridor sees nothing of it: the office's light is on the far side.
    const floor = model(['##########', '..........', '##########', '..........', '..........', '..........']);
    const office = lightMapFor(DARK, 0, { model: floor, sources: [lamp(5.5, 4.5, { radius: 4 })], cols: 10, rows: 6 });
    const corridor = sightFor(at(5, 1), floor, office, NORMAL, { cols: 10, rows: 6 });
    expect([...corridor.keys()]).toEqual(['5,1']);
    // A runner in the office sees that wall's face, lit on the office side.
    const inside = sightFor(at(5, 4), floor, office, NORMAL, { cols: 10, rows: 6 });
    expect(inside.has('5,2')).toBe(true);
    expect(inside.has('5,1')).toBe(false);
  });

  it('does not map the walls of a dark corridor for a runner standing in it', () => {
    const corridor = model(['#####', '.....', '#####']);
    const dark = lightMapFor(DARK, 0, { model: corridor, sources: [], cols: 5, rows: 3 });
    const seen = sightFor(at(2, 1), corridor, dark, NORMAL, { cols: 5, rows: 3 });
    // A runner knows where they stand, and no more.
    expect([...seen.keys()]).toEqual(['2,1']);
    // With the lights on, the same runner sees the corridor and its walls.
    expect(sightFor(at(2, 1), corridor, null, NORMAL, { cols: 5, rows: 3 }).size).toBe(15);
  });

  it('sees a lit room at the far end of a long dark hall, however far', () => {
    // Sixty squares of hall with one lamp near the far end: no range cap
    // hides the lit room, and the dark middle stays dark.
    const hall = model(['#'.repeat(60), '.'.repeat(60), '#'.repeat(60)]);
    const far = lightMapFor(DARK, 0, { model: hall, sources: [lamp(55.5, 1.5)], cols: 60, rows: 3 });
    for (const modes of [NORMAL, LOWLIGHT, THERMO]) {
      const seen = sightFor(at(1, 1), hall, far, modes, { cols: 60, rows: 3 });
      expect(seen.has('55,1'), modes.join('+')).toBe(true);
      expect(seen.has('57,1'), modes.join('+')).toBe(true);
      // The lamp's stretch of wall, by the wall-face rule.
      expect(seen.has('55,0'), modes.join('+')).toBe(true);
    }
    expect(sightFor(at(1, 1), hall, far, NORMAL, { cols: 60, rows: 3 }).has('30,1')).toBe(false);
    expect(sightFor(at(1, 1), hall, far, THERMO, { cols: 60, rows: 3 }).has('30,1')).toBe(true);

    // Dim light is not darkness: normal eyes see the whole hall.
    const dim = lightMapFor({ environment: { light: 2 } }, 0, { model: hall, sources: [], cols: 60, rows: 3 });
    expect(colsSeen(sightFor(at(1, 1), hall, dim, NORMAL, { cols: 60, rows: 3 }), 1, 60)).toHaveLength(60);
  });

  it('caps sight only when asked, in metres', () => {
    const open = model([]);
    const seen = sightFor(at(0, 0), open, null, NORMAL, { cols: 20, rows: 1, unitM: 2, rangeM: 10 });
    expect(seen.has('5,0')).toBe(true);
    expect(seen.has('6,0')).toBe(false);
  });
});

describe('sightFor: ultrasound', () => {
  it('perceives in the dark within 50 m and no further, in metres on any grid', () => {
    const open = model([]);
    const dark = lightMapFor(DARK, 0, { model: open, sources: [], cols: 80, rows: 1 });
    expect(ULTRASOUND_RANGE_M).toBe(50);

    const oneMetre = sightFor(at(0, 0), open, dark, ULTRA, { cols: 80, rows: 1, unitM: 1 });
    expect(oneMetre.has('50,0')).toBe(true);
    expect(oneMetre.has('51,0')).toBe(false);

    const twoMetre = sightFor(at(0, 0), open, dark, ULTRA, { cols: 80, rows: 1, unitM: 2 });
    expect(twoMetre.has('25,0')).toBe(true);
    expect(twoMetre.has('26,0')).toBe(false);

    // Without it, the same runner sees only where they stand.
    expect(sightFor(at(0, 0), open, dark, NORMAL, { cols: 80, rows: 1 }).size).toBe(1);
  });

  it('still sees a lit square past 50 m with the eyes it also has', () => {
    const open = model([]);
    const lit = lightMapFor(DARK, 0, { model: open, sources: [lamp(70.5, 0.5, { radius: 2 })], cols: 80, rows: 1 });
    const seen = sightFor(at(0, 0), open, lit, ULTRA, { cols: 80, rows: 1 });
    expect(seen.has('70,0')).toBe(true);
    expect(seen.has('60,0')).toBe(false);
  });

  it('is the one-square rule seesInLight answers', () => {
    expect(seesInLight(3, 10, NORMAL)).toBe(false);
    expect(seesInLight(3, 10, LOWLIGHT)).toBe(false);
    expect(seesInLight(2, 10, NORMAL)).toBe(true);
    expect(seesInLight(3, 10, THERMO)).toBe(true);
    expect(seesInLight(3, 50, ULTRA)).toBe(true);
    expect(seesInLight(3, 50.5, ULTRA)).toBe(false);
    // Ultrasound alone is no light: past its reach a lit square is seen as
    // any eye sees it, a dark one not at all.
    expect(seesInLight(0, 500, ['ultrasound'])).toBe(true);
    expect(seesInLight(3, 500, ['ultrasound'])).toBe(false);
  });
});

describe('partySight', () => {
  // Ground floor: a wall down column 6. The floor above: open.
  const building = (over: Partial<PartySightScene> = {}): PartySightScene => ({
    grid: { cols: 12, rows: 5, unitM: 1 },
    environment: { light: 0 },
    tiles: {
      tilesetId: 'docklands',
      structure: { '6,0': 'wall', '6,1': 'wall', '6,2': 'wall', '6,3': 'wall', '6,4': 'wall' },
    },
    levels: [{ id: 'roof', name: 'Roof', tiles: { tilesetId: 'docklands', structure: {} } }],
    ...over,
  });

  it('keeps each floor to what the runners on it see', () => {
    const party = [
      { id: 'ari', x: 1.5, y: 2.5, level: 0 },
      { id: 'bex', x: 10.5, y: 2.5, level: 1 },
    ];
    const sight = partySight(building(), party, {});
    expect(sight.cols).toBe(12);
    expect(sight.rows).toBe(5);
    expect([...sight.levels.keys()].sort()).toEqual([0, 1]);

    const ground = sight.levels.get(0)!;
    expect(cellBitsHas(ground, 3, 2)).toBe(true);
    expect(cellBitsHas(ground, 6, 2)).toBe(true); // the wall's face
    expect(cellBitsHas(ground, 9, 2)).toBe(false); // behind it
    // Bex standing upstairs over (10,2) shows nothing of the ground floor.
    expect(cellBitsHas(ground, 10, 2)).toBe(false);

    // Upstairs there is no wall: the whole floor.
    const roof = sight.levels.get(1)!;
    expect(cellBitsHas(roof, 1, 2)).toBe(true);
    expect(cellBitsCount(roof)).toBe(12 * 5);
  });

  it('pools the party: a troll’s eyes show the table what the human beside him cannot see', () => {
    const dark = building({ environment: { light: 3 } });
    const party = [
      { id: 'human', x: 1.5, y: 2.5 },
      { id: 'troll', x: 2.5, y: 2.5 },
    ];
    const alone = partySight(dark, [party[0]!], { human: NORMAL });
    expect(cellBitsCount(alone.levels.get(0)!)).toBe(1);
    const both = partySight(dark, party, new Map([['human', NORMAL], ['troll', THERMO]]));
    const ground = both.levels.get(0)!;
    expect(cellBitsHas(ground, 0, 0)).toBe(true);
    expect(cellBitsHas(ground, 5, 4)).toBe(true);
    expect(cellBitsHas(ground, 6, 2)).toBe(true);
    expect(cellBitsHas(ground, 8, 2)).toBe(false);
  });

  it('lights each floor with its own lamps only', () => {
    // A GM light on the roof, straight above the runner on the ground.
    const scene = building({
      environment: { light: 3 },
      geometry: { lights: [{ id: 'flood', at: { x: 2.5, y: 2.5 }, level: 1, radiusM: 3, rows: 2 }] },
    });
    const below = partySight(scene, [{ id: 'ari', x: 1.5, y: 2.5, level: 0 }], {});
    expect(cellBitsCount(below.levels.get(0)!)).toBe(1);
    const above = partySight(scene, [{ id: 'ari', x: 1.5, y: 2.5, level: 1 }], {});
    expect(cellBitsHas(above.levels.get(1)!, 3, 2)).toBe(true);
  });

  it('counts the lights the caller says shine: a guard’s flashlight lights his corridor for the party', () => {
    const scene = building({ environment: { light: 3 } });
    const party = [{ id: 'ari', x: 0.5, y: 2.5 }];
    const guard = { id: 'guard', x: 4.5, y: 2.5, light: { radiusM: 2, rows: 2 } };
    const unlit = partySight(scene, party, {});
    expect(cellBitsHas(unlit.levels.get(0)!, 4, 2)).toBe(false);
    const lit = partySight(scene, party, {}, { lightTokens: [...party, guard] });
    expect(cellBitsHas(lit.levels.get(0)!, 4, 2)).toBe(true);
    // The guard is a light here, not an eye: nothing past his light is seen.
    expect(cellBitsHas(lit.levels.get(0)!, 0, 0)).toBe(false);
  });

  it('has no floor for a party that is not there, and skips a level it cannot key', () => {
    expect(partySight(building(), [], {}).levels.size).toBe(0);
    const odd = partySight(building(), [{ id: 'x', x: 1.5, y: 1.5, level: -1 }, { id: 'y', x: 1.5, y: 1.5, level: 0.5 }], {});
    expect(odd.levels.size).toBe(0);
  });
});

describe('lineOfSightBetween', () => {
  // A wall down column 6 on the ground floor; the catwalk above is open.
  const warehouse = {
    tiles: {
      tilesetId: 'docklands',
      structure: { '6,0': 'wall', '6,1': 'wall', '6,2': 'wall', '6,3': 'wall', '6,4': 'wall' },
    },
    levels: [{ id: 'catwalk', name: 'Catwalk', tiles: { tilesetId: 'docklands', structure: {} } }],
  };

  it('reads the floor the two tokens stand on, not the ground floor', () => {
    const below = lineOfSightBetween(warehouse, { x: 2.5, y: 2.5 }, { x: 10.5, y: 2.5, level: 0 });
    expect(below?.clear).toBe(false);
    expect(below?.blockedBy).toBe('6,2');
    // The same two squares on the catwalk: nothing between them up there.
    const above = lineOfSightBetween(warehouse, { x: 2.5, y: 2.5, level: 1 }, { x: 10.5, y: 2.5, level: 1 });
    expect(above?.clear).toBe(true);
  });

  it('has no reading for two tokens on different floors', () => {
    expect(lineOfSightBetween(warehouse, { x: 2.5, y: 2.5, level: 1 }, { x: 3.5, y: 2.5 })).toBeNull();
  });
});
