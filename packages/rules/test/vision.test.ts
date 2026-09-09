/**
 * Line of sight and cover (FR9.16).
 *
 * This decides whether a shot is legal and what it costs, so it is tested the
 * way dice are: against the properties that must hold, not against whatever
 * the implementation happens to return today.
 *
 * The property that matters most is SYMMETRY. If A can see B, B can see A —
 * a table where the ork can shoot the guard but the guard cannot shoot back is
 * not a rules subtlety, it is a bug that decides a firefight. Anything that
 * breaks it (an off-by-one in the cell walk, endpoints treated asymmetrically)
 * shows up here rather than mid-session.
 */
import { describe, expect, it } from 'vitest';
import {
  TILE_HEIGHTS,
  cellsAlong,
  coverCall,
  coverCallModifier,
  coverModifier,
  visibleFrom,
  givesCover,
  lineOfSight,
  segmentsCross,
  segmentTouchAt,
  sightModelFor,
  stopsMovement,
  stopsSight,
  type SightCell,
  type SightModel,
  type Tile,
} from '../src/index.js';

const at = (col: number, row: number) => ({ col, row });

/** A model from a sketch: `#` blocks sight, `o` is waist-high cover. */
function model(rows: string[], segments: SightModel['segments'] = []): SightModel {
  const cells = new Map<string, SightCell>();
  rows.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      // `height` is what the RENDERER reads; sight itself goes on the flags.
      if (ch === '#')
        cells.set(`${col},${row}`, {
          blocksSight: true,
          givesCover: false,
          blocksMovement: true,
          height: 1,
        });
      if (ch === 'o')
        cells.set(`${col},${row}`, {
          blocksSight: false,
          givesCover: true,
          blocksMovement: true,
          height: 0.5,
        });
    });
  });
  return { cells, segments };
}

describe('tile semantics', () => {
  const tile = (over: Partial<Tile>): Tile => ({
    id: 't',
    name: 'T',
    kind: 'feature',
    pattern: 'solid',
    colors: ['#000000', '#ffffff'],
    ...over,
  });

  it('derives sight and movement from height, so art cannot disagree with rules', () => {
    expect(stopsSight(tile({ height: TILE_HEIGHTS.FULL }))).toBe(true);
    expect(stopsSight(tile({ height: TILE_HEIGHTS.WAIST }))).toBe(false);
    expect(stopsSight(tile({}))).toBe(false);
    expect(stopsMovement(tile({ height: TILE_HEIGHTS.WAIST }))).toBe(true);
    expect(stopsMovement(tile({}))).toBe(false);
  });

  it('lets glass be the exception it actually is', () => {
    // Full height, stops the body, stops neither the eye nor the bullet.
    const glass = tile({ height: TILE_HEIGHTS.FULL, blocksSight: false });
    expect(stopsSight(glass)).toBe(false);
    expect(stopsMovement(glass)).toBe(true);
  });

  it('calls only waist-high things cover — a wall is not cover, it is a wall', () => {
    expect(givesCover(tile({ height: TILE_HEIGHTS.WAIST }))).toBe(true);
    expect(givesCover(tile({ height: TILE_HEIGHTS.FULL }))).toBe(false);
    expect(givesCover(tile({}))).toBe(false);
  });
});

describe('cellsAlong', () => {
  it('returns the single cell when start and end share one', () => {
    expect(cellsAlong({ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 })).toEqual([{ col: 0, row: 0 }]);
  });

  it('walks a straight row without gaps', () => {
    const walk = cellsAlong({ x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 });
    expect(walk).toEqual([0, 1, 2, 3, 4].map((col) => ({ col, row: 0 })));
  });

  it('never skips a cell, on any angle', () => {
    // The property, not a fixture: consecutive steps are 4-adjacent, so a ray
    // cannot slip diagonally between two walls that touch at a corner.
    const targets: Array<[number, number]> = [
      [7, 3],
      [3, 7],
      [-5, 4],
      [6, -6],
      [1, 9],
    ];
    for (const [tx, ty] of targets) {
      const walk = cellsAlong({ x: 0.5, y: 0.5 }, { x: tx + 0.5, y: ty + 0.5 });
      for (let i = 1; i < walk.length; i += 1) {
        const step =
          Math.abs(walk[i]!.col - walk[i - 1]!.col) + Math.abs(walk[i]!.row - walk[i - 1]!.row);
        expect(step).toBe(1);
      }
      expect(walk[walk.length - 1]).toEqual({ col: tx, row: ty });
    }
  });
});

describe('segmentsCross', () => {
  it('detects a proper crossing', () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 })).toBe(true);
  });

  it('is false for parallel, non-touching and merely-touching segments', () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
    expect(segmentsCross({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 3, y: 3 }, { x: 4, y: 4 })).toBe(false);
    // Endpoint-on-segment is deliberately not a crossing: a sightline that
    // grazes the very end of a wall should not be stopped by it.
    expect(segmentsCross({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 4 })).toBe(false);
  });
});

describe('lineOfSight', () => {
  it('sees across an empty floor', () => {
    const los = lineOfSight(at(0, 0), at(5, 0), model(['......']));
    expect(los).toEqual({ clear: true, cover: 'none', blockedBy: null });
  });

  it('is blocked by a full-height tile between the two', () => {
    const los = lineOfSight(at(0, 0), at(4, 0), model(['..#..']));
    expect(los.clear).toBe(false);
    expect(los.cover).toBe('full');
    expect(los.blockedBy).toBe('2,0');
  });

  it('grants partial cover for a waist-high tile, without breaking the line', () => {
    const los = lineOfSight(at(0, 0), at(4, 0), model(['..o..']));
    expect(los.clear).toBe(true);
    expect(los.cover).toBe('partial');
    expect(los.blockedBy).toBe('2,0');
  });

  it('counts cover the target is standing behind', () => {
    // Crouching behind your own bar counter is the whole point.
    const los = lineOfSight(at(0, 0), at(3, 0), model(['...o']));
    expect(los.clear).toBe(true);
    expect(los.cover).toBe('partial');
  });

  it('does not let a token be blocked by the cell it occupies', () => {
    // Standing IN a doorway makes you visible, not invisible.
    const los = lineOfSight(at(0, 0), at(3, 0), model(['#..#']));
    expect(los.clear).toBe(true);
  });

  it('sees through glass — full height, no sight blocking', () => {
    // Full height, and still see-through: the two are tracked separately for
    // exactly this case.
    const cells = new Map<string, SightCell>([
      ['2,0', { blocksSight: false, givesCover: false, blocksMovement: true, height: 1 }],
    ]);
    const los = lineOfSight(at(0, 0), at(4, 0), { cells, segments: [] });
    expect(los.clear).toBe(true);
    expect(los.cover).toBe('none');
  });

  it('is blocked by a traced wall segment', () => {
    const wall = { id: 'w1', a: { x: 2, y: -1 }, b: { x: 2, y: 3 }, blocksSight: true };
    const los = lineOfSight(at(0, 0), at(4, 0), model(['.....'], [wall]));
    expect(los.clear).toBe(false);
    expect(los.blockedBy).toBe('w1');
  });

  it('sees through a segment that does not block, which is what an open door is', () => {
    const open = { id: 'd1', a: { x: 2, y: -1 }, b: { x: 2, y: 3 }, blocksSight: false };
    expect(lineOfSight(at(0, 0), at(4, 0), model(['.....'], [open])).clear).toBe(true);
  });

  it('always sees itself', () => {
    expect(lineOfSight(at(2, 2), at(2, 2), model(['...', '...', '..#']))).toEqual({
      clear: true,
      cover: 'none',
      blockedBy: null,
    });
  });

  it('is SYMMETRIC — the guard can shoot back', () => {
    // The property that decides firefights. Asserted over a map with walls,
    // cover and a diagonal, in both directions, for every pair.
    const map = model([
      '..........',
      '..#....o..',
      '..#.......',
      '..#..o....',
      '....#.....',
      '..o....#..',
    ]);
    const pts = [at(0, 0), at(9, 0), at(0, 5), at(9, 5), at(4, 2), at(6, 4), at(1, 3), at(8, 1)];
    for (const a of pts) {
      for (const b of pts) {
        const ab = lineOfSight(a, b, map);
        const ba = lineOfSight(b, a, map);
        expect({ pair: `${a.col},${a.row}->${b.col},${b.row}`, ...ab }).toMatchObject({
          clear: ba.clear,
          cover: ba.cover,
        });
      }
    }
  });

  it('cannot be threaded between two walls meeting at a corner', () => {
    // The classic raycast leak: a diagonal slipping through the seam where two
    // blocking cells touch. `cellsAlong` visits both, so it is stopped.
    const map = model(['.#', '#.']);
    expect(lineOfSight(at(0, 0), at(1, 1), map).clear).toBe(false);
  });
});

describe('sightModelFor', () => {
  it('reads painted walls and cover straight out of the tile layer', () => {
    const m = sightModelFor({
      tiles: { tilesetId: 'docklands', cells: { '1,0': 'wall', '2,0': 'crates', '3,0': 'floor' } },
    });
    // `height` rides along because everything that DRAWS this model needs it —
    // in isometric a square's content occupies its ground diamond plus a band
    // above, and a renderer working from the ground plane alone decapitates
    // every wall it touches.
    expect(m.cells.get('1,0')).toEqual({
      blocksSight: true,
      givesCover: false,
      blocksMovement: true,
      height: 1,
    });
    expect(m.cells.get('2,0')).toEqual({
      blocksSight: false,
      givesCover: true,
      blocksMovement: true,
      height: 0.5,
    });
    // A plain floor earns no entry; the map stays sparse.
    expect(m.cells.has('3,0')).toBe(false);
  });

  it('takes the tallest thing in a square, so furniture cannot shorten a wall', () => {
    const m = sightModelFor({
      tiles: {
        tilesetId: 'docklands',
        cells: {},
        ground: {},
        structure: { '4,0': 'wall' },
        object: { '4,0': 'crates' },
      },
    });
    expect(m.cells.get('4,0')?.height).toBe(1);
  });

  it('treats a corp glass partition as see-through', () => {
    const m = sightModelFor({ tiles: { tilesetId: 'corp', cells: { '1,0': 'glass' } } });
    expect(m.cells.get('1,0')?.blocksSight).toBe(false);
  });

  it('drops an open door from the blockers and keeps a closed one', () => {
    const geometry = {
      walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }],
      doors: [
        { id: 'open', a: { x: 2, y: 0 }, b: { x: 2, y: 1 }, open: true },
        { id: 'shut', a: { x: 3, y: 0 }, b: { x: 3, y: 1 }, open: false },
      ],
    };
    const ids = sightModelFor({ geometry }).segments.map((s) => s.id);
    expect(ids).toEqual(['w1', 'shut']);
  });

  it('degrades to open ground for an unknown tileset rather than an impassable slab', () => {
    const m = sightModelFor({ tiles: { tilesetId: 'atlantis', cells: { '1,0': 'wall' } } });
    expect(m.cells.size).toBe(0);
  });

  it('ignores unknown tile ids and malformed keys', () => {
    const m = sightModelFor({
      tiles: { tilesetId: 'docklands', cells: { banana: 'wall', '1,0': 'lava' } },
    });
    expect(m.cells.size).toBe(0);
  });
});

describe('coverModifier', () => {
  it('says nothing when there is no cover', () => {
    expect(coverModifier('none')).toBeNull();
  });

  it('says nothing for full cover, because there is no shot to modify', () => {
    expect(coverModifier('full')).toBeNull();
  });

  it('gives the DEFENDER the bonus, with provenance naming what they are behind', () => {
    const mod = coverModifier('partial', { because: '4,2' });
    expect(mod).toMatchObject({
      target: 'pool.defense',
      op: 'add',
      active: true,
      source: { kind: 'situational', ref: 'cover' },
    });
    expect(mod!.value).toBeGreaterThan(0);
    expect(mod!.note).toContain('4,2');
  });
});

describe('sight reads all three layers', () => {
  it('sees a wall in the structure layer', () => {
    const m = sightModelFor({
      tiles: { tilesetId: 'sprawl', structure: { '1,0': 'wall' } },
    });
    expect(m.cells.get('1,0')?.blocksSight).toBe(true);
  });

  it('merges layers hardest-wins in a shared cell', () => {
    // A chair standing against a wall must not open a hole in it. The square
    // is as blocked as the most blocking thing in it, whichever layer that
    // thing happens to live on.
    const m = sightModelFor({
      tiles: {
        tilesetId: 'corp',
        ground: { '2,2': 'carpet' },
        structure: { '2,2': 'wall' },
        object: { '2,2': 'chair' },
      },
    });
    expect(m.cells.get('2,2')).toMatchObject({ blocksSight: true, blocksMovement: true });
  });

  it('treats a see-through window as cover-free and sight-free', () => {
    const m = sightModelFor({ tiles: { tilesetId: 'sprawl', structure: { '1,0': 'window' } } });
    expect(m.cells.get('1,0')?.blocksSight).toBe(false);
    expect(m.cells.get('1,0')?.blocksMovement).toBe(true);
  });

  it('sees a legacy flat scene exactly as a migrated one', () => {
    // Sight must not depend on when the map happened to be drawn.
    const legacy = sightModelFor({ tiles: { tilesetId: 'sprawl', cells: { '1,0': 'wall' } } });
    const layered = sightModelFor({ tiles: { tilesetId: 'sprawl', structure: { '1,0': 'wall' } } });
    expect(legacy.cells.get('1,0')).toEqual(layered.cells.get('1,0'));
  });
});

// ---------------------------------------------------------------------------
// What one pair of eyes can see
// ---------------------------------------------------------------------------

describe('visibleFrom', () => {
  it('always includes the viewer’s own cell', () => {
    // Even standing in a doorway, or behind the counter you are crouched at.
    const v = visibleFrom(at(2, 2), model(['...', '...', '..#']), { range: 4 });
    expect(v.has('2,2')).toBe(true);
  });

  it('sees an open room and not the far side of a wall', () => {
    const map = model([
      '.....',
      '.....',
      '##.##',
      '.....',
    ]);
    const v = visibleFrom(at(2, 0), map, { range: 8, cols: 5, rows: 4 });
    expect(v.has('0,0')).toBe(true);
    expect(v.has('4,1')).toBe(true);
    // Straight through the gap is fine…
    expect(v.has('2,3')).toBe(true);
    // …but the cells behind the solid stretches are not.
    expect(v.has('0,3')).toBe(false);
    expect(v.has('4,3')).toBe(false);
  });

  it('reports the cover a shot into each cell would earn', () => {
    const v = visibleFrom(at(0, 0), model(['..o..']), { range: 8, cols: 5, rows: 1 });
    // Beyond the waist-high counter, still visible, but covered.
    expect(v.get('4,0')?.cover).toBe('partial');
    // Short of it, nothing in the way.
    expect(v.get('1,0')?.cover).toBe('none');
  });

  it('is a circle, not a square', () => {
    // A Chebyshev radius would reach as far diagonally as orthogonally, which
    // gives a token a square of vision and looks wrong the moment a GM checks.
    const v = visibleFrom(at(10, 10), model([]), { range: 5 });
    expect(v.has('15,10')).toBe(true);
    expect(v.has('14,14')).toBe(false);
  });

  it('stays inside the grid when told its bounds', () => {
    const v = visibleFrom(at(0, 0), model([]), { range: 6, cols: 3, rows: 3 });
    for (const { col, row } of v.values()) {
      expect(col).toBeGreaterThanOrEqual(0);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(3);
      expect(row).toBeLessThan(3);
    }
  });

  it('agrees with lineOfSight for every cell it reports', () => {
    // The two must never disagree: the shroud a player sees and the ruling on
    // a shot are the same question asked twice.
    const map = model(['.....', '..#..', '..o..', '.....']);
    const from = at(0, 0);
    const v = visibleFrom(from, map, { range: 8, cols: 5, rows: 4 });
    for (let col = 0; col < 5; col += 1) {
      for (let row = 0; row < 4; row += 1) {
        const los = lineOfSight(from, { col, row }, map);
        expect(v.has(`${col},${row}`), `${col},${row}`).toBe(los.clear);
        if (los.clear && !(col === from.col && row === from.row)) {
          expect(v.get(`${col},${row}`)?.cover).toBe(los.cover);
        }
      }
    }
  });

  it('sees nothing beyond a zero range but itself', () => {
    const v = visibleFrom(at(1, 1), model([]), { range: 0 });
    expect([...v.keys()]).toEqual(['1,1']);
  });
});

describe('coverCall — the system suggests, the GM decides', () => {
  it('lets the map stand when the GM has not spoken', () => {
    const call = coverCall('partial');
    expect(call.effective).toBe('partial');
    expect(call.overridden).toBe(false);
    expect(call.why).not.toContain('GM');
  });

  it('honours an override and says so', () => {
    const call = coverCall('none', 'partial');
    expect(call.effective).toBe('partial');
    expect(call.overridden).toBe(true);
    expect(call.why).toContain('GM');
    expect(call.why).toContain('no cover'); // what the map had said
  });

  it('does not count agreeing with the map as an override', () => {
    // A GM confirming the suggestion should not clutter the breakdown.
    expect(coverCall('partial', 'partial').overridden).toBe(false);
  });

  it('can take cover AWAY, which is the case a GM needs most', () => {
    // "You blew the crate apart last pass — no cover."
    const call = coverCall('partial', 'none');
    expect(call.effective).toBe('none');
    expect(call.overridden).toBe(true);
    expect(coverCallModifier(call)).toBeNull();
  });

  it('flags an overridden modifier as an override, not as arithmetic', () => {
    const mod = coverCallModifier(coverCall('none', 'partial'));
    expect(mod?.source.kind).toBe('override');
    expect(mod?.note).toContain('GM');
    // …and an un-overridden one stays a plain situational modifier.
    expect(coverCallModifier(coverCall('partial'))?.source.kind).toBe('situational');
  });
});

describe('walls drawn in pieces are one wall', () => {
  // The dock wall of the demo: a wall to the door frame, the door, the wall
  // after it. Each piece ends where the next begins.
  const dock = (doorOpen: boolean) =>
    model([], [
      { id: 'w.upper', a: { x: 8, y: 0 }, b: { x: 8, y: 8 }, blocksSight: true },
      { id: 'd.freight', a: { x: 8, y: 8 }, b: { x: 8, y: 11 }, blocksSight: !doorOpen },
      { id: 'w.lower', a: { x: 8, y: 11 }, b: { x: 8, y: 20 }, blocksSight: true },
    ]);

  it('cannot be threaded through the joint between two pieces', () => {
    // From (3,9) the ray to (9,7) crosses x=8 at exactly y=8 — the seam
    // between the upper wall and the closed door. It used to pass.
    expect(lineOfSight(at(3, 9), at(9, 7), dock(false)).clear).toBe(false);
    expect(lineOfSight(at(3, 9), at(9, 11), dock(false)).clear).toBe(false);
    expect(lineOfSight(at(3, 9), at(15, 5), dock(false)).clear).toBe(false);
    // …and symmetrically from the other side.
    expect(lineOfSight(at(9, 7), at(3, 9), dock(false)).clear).toBe(false);
  });

  it('passes through the door once it is open — but not through its frame', () => {
    // Straight through the opening.
    expect(lineOfSight(at(3, 9), at(12, 9), dock(true)).clear).toBe(true);
    // The seam at y=8 is now the tip of the upper wall alone, and the open
    // door stops nothing: grazing one wall's end is still not being stopped.
    expect(lineOfSight(at(3, 9), at(9, 7), dock(true)).clear).toBe(true);
  });

  it('still lets a sightline graze the free end of a lone wall', () => {
    const lone = model([], [{ id: 'w', a: { x: 8, y: 0 }, b: { x: 8, y: 8 }, blocksSight: true }]);
    expect(lineOfSight(at(3, 9), at(9, 7), lone).clear).toBe(true);
    expect(segmentTouchAt({ x: 3.5, y: 9.5 }, { x: 9.5, y: 7.5 }, { x: 8, y: 0 }, { x: 8, y: 8 })).toBeCloseTo(0.75);
    expect(segmentTouchAt({ x: 3.5, y: 9.5 }, { x: 9.5, y: 7.5 }, { x: 8, y: 0 }, { x: 8, y: 7 })).toBeNaN();
  });
});
