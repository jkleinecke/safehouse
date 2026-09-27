/**
 * The fog's three states per square and floor (P6 sightlines), and the
 * bitsets the party's sight travels in.
 *
 * Two things are pinned here. The bitset layout, because it is a wire format
 * the server writes and every phone and the TV read: a bit that lands one
 * square over is a room revealed next to the one the runners are standing
 * in. And the order the sources combine in (`cellState`), because that is the
 * one rule the server's secrecy and the map's drawing will both follow: a
 * square wrongly live puts a guard on the players' screens, and one wrongly
 * hidden blacks out a room the GM opened.
 *
 * The last block checks the new rule against the old one: a scene with
 * none of the new state must answer exactly as `fogRevealedAt` did, square
 * for square, so no existing scene changes.
 */
import { describe, expect, it } from 'vitest';
import { fogOn, type FogState, type Point } from '@safehouse/contracts';
import {
  cellBitsCount,
  cellBitsFrom,
  cellBitsHas,
  cellBitsResize,
  cellBitsSet,
  cellBitsUnion,
  cellState,
  decodeCellBits,
  emptyCellBits,
  encodeCellBits,
  brushOnFloor,
  brushReader,
  eraseBrush,
  eraseBrushUnder,
  fogCells,
  fogRevealedAt,
  paintBrush,
  regionFashion,
  sameBrush,
  tokenLive,
  type CellBits,
} from '../src/index.js';

/** An axis-aligned box on the grid lines, as the GM's rectangle tool draws one. */
const box = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Every square of a grid that is in the set, as `"col,row"`, for readable failures. */
function squares(bits: CellBits): string[] {
  const out: string[] = [];
  for (let row = 0; row < bits.rows; row += 1) {
    for (let col = 0; col < bits.cols; col += 1) if (cellBitsHas(bits, col, row)) out.push(`${col},${row}`);
  }
  return out;
}

/** A repeatable scatter of squares (a small LCG), so the round trip sees irregular patterns. */
function scatter(cols: number, rows: number, seed: number, density = 0.3): CellBits {
  const bits = emptyCellBits(cols, rows);
  let s = seed >>> 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      if (s / 2 ** 32 < density) cellBitsSet(bits, col, row);
    }
  }
  return bits;
}

/** A fogged scene's fog with nothing revealed: the GM switched it on. */
const fogged = (over: Partial<FogState> = {}): FogState => ({
  regions: [],
  revealed: [],
  revealedShapes: [],
  enabled: true,
  ...over,
});

/** A sight record for a 10 x 8 grid, one entry per floor given. */
function sight(levels: Record<string, { live?: CellBits; explored?: CellBits }>): NonNullable<FogState['sight']> {
  const out: NonNullable<FogState['sight']> = { cols: 10, rows: 8, levels: {} };
  for (const [key, floor] of Object.entries(levels)) {
    out.levels[key] = {
      live: floor.live ? encodeCellBits(floor.live) : '',
      explored: floor.explored ? encodeCellBits(floor.explored) : '',
    };
  }
  return out;
}

describe('cell bitsets', () => {
  it('puts square (col, row) at bit row * cols + col, least significant bit first, in standard base64', () => {
    const bits = emptyCellBits(4, 3); // 12 squares, 2 bytes
    cellBitsSet(bits, 0, 0); // bit 0: byte 0, value 1
    cellBitsSet(bits, 1, 2); // bit 9: byte 1, value 2
    expect([...bits.bytes]).toEqual([0x01, 0x02]);
    expect(encodeCellBits(bits)).toBe('AQI=');
    // Three bytes make four characters with no padding; one makes two and `==`.
    const three = emptyCellBits(24, 1);
    for (const col of [0, 8, 16]) cellBitsSet(three, col, 0);
    expect(encodeCellBits(three)).toBe('AQEB');
    const one = emptyCellBits(60, 40);
    cellBitsSet(one, 0, 0);
    expect(encodeCellBits(one)).toBe('AQ==');
  });

  it('round-trips exactly, whatever the grid size and pattern', () => {
    const grids: [number, number][] = [
      [1, 1],
      [7, 3],
      [8, 8],
      [13, 17],
      [60, 40],
      [101, 3],
    ];
    for (const [cols, rows] of grids) {
      for (const seed of [1, 7, 42]) {
        for (const density of [0, 0.05, 0.5, 1]) {
          const bits = scatter(cols, rows, seed, density);
          const back = decodeCellBits(encodeCellBits(bits), cols, rows);
          expect(back.cols).toBe(cols);
          expect(back.rows).toBe(rows);
          expect([...back.bytes]).toEqual([...bits.bytes]);
          expect(squares(back)).toEqual(squares(bits));
        }
      }
    }
  });

  it('writes a floor nobody has seen as the empty string, and leaves unseen squares at the end off', () => {
    expect(encodeCellBits(emptyCellBits(60, 40))).toBe('');
    expect(cellBitsCount(decodeCellBits('', 60, 40))).toBe(0);
    // One square near the start of a big floor is a few characters, not 300 bytes' worth.
    const early = emptyCellBits(60, 40);
    cellBitsSet(early, 5, 1);
    expect(encodeCellBits(early).length).toBeLessThanOrEqual(12);
    expect(squares(decodeCellBits(encodeCellBits(early), 60, 40))).toEqual(['5,1']);
  });

  it('reads a damaged or mismatched string without throwing, and never past the edge of the grid', () => {
    // Every bit set in one byte, read onto a 3-square grid: only the three squares that exist.
    const three = decodeCellBits('/w==', 3, 1);
    expect(cellBitsCount(three)).toBe(3);
    expect([...three.bytes]).toEqual([0b111]);
    // Longer than the grid: cut at the grid.
    const cut = decodeCellBits('////////', 4, 2);
    expect(cellBitsCount(cut)).toBe(8);
    expect(cut.bytes.length).toBe(1);
    // Characters that are not base64 are skipped, not fatal.
    expect(squares(decodeCellBits('A Q I =', 4, 3))).toEqual(['0,0', '1,2']);
    expect(() => decodeCellBits('%%%%', 4, 3)).not.toThrow();
    // A nonsense grid size allocates nothing rather than throwing.
    expect(emptyCellBits(-3, Number.NaN).bytes.length).toBe(0);
  });

  it('ignores squares off the grid, both ways', () => {
    const bits = emptyCellBits(4, 3);
    cellBitsSet(bits, 4, 0); // one column past the edge: would be square (0, 1) if unchecked
    cellBitsSet(bits, -1, 1);
    cellBitsSet(bits, 0, 3);
    cellBitsSet(bits, 1.5, 1);
    expect(cellBitsCount(bits)).toBe(0);
    expect(cellBitsHas(bits, 0, 1)).toBe(false);
    expect(cellBitsHas(bits, 99, 99)).toBe(false);
  });

  it('builds a set from a list of squares, and takes a square out again', () => {
    const bits = cellBitsFrom(5, 5, [
      { col: 1, row: 1 },
      { col: 4, row: 4 },
      { col: 9, row: 9 },
    ]);
    expect(squares(bits)).toEqual(['1,1', '4,4']);
    cellBitsSet(bits, 1, 1, false);
    expect(squares(bits)).toEqual(['4,4']);
  });

  it('folds what is seen into what was seen (union), square by square even across a resize', () => {
    const explored = cellBitsFrom(6, 4, [{ col: 0, row: 0 }, { col: 5, row: 3 }]);
    const live = cellBitsFrom(6, 4, [{ col: 2, row: 1 }, { col: 5, row: 3 }]);
    const merged = cellBitsUnion(explored, live);
    expect(squares(merged)).toEqual(['0,0', '2,1', '5,3']);
    // Neither input changed.
    expect(squares(explored)).toEqual(['0,0', '5,3']);
    // A set written for a narrower grid is read by position, not byte for byte.
    const narrow = cellBitsFrom(4, 4, [{ col: 3, row: 2 }]);
    expect(squares(cellBitsUnion(emptyCellBits(6, 4), narrow))).toEqual(['3,2']);
  });

  it('keeps every square where it is when the grid is resized, dropping those that no longer fit', () => {
    const bits = cellBitsFrom(6, 4, [
      { col: 0, row: 0 },
      { col: 3, row: 2 },
      { col: 5, row: 3 },
    ]);
    expect(squares(cellBitsResize(bits, 8, 5))).toEqual(['0,0', '3,2', '5,3']);
    expect(squares(cellBitsResize(bits, 4, 3))).toEqual(['0,0', '3,2']);
  });
});

describe('cellState: hidden, explored or live', () => {
  const lab = { id: 'lab', name: 'The lab', polygon: box(0, 0, 3, 3) };
  const office = { id: 'office', name: 'Office', polygon: box(5, 0, 8, 3) };
  const vault = { id: 'vault', name: 'Vault', polygon: box(0, 5, 3, 8) };

  it('is live everywhere while the fog is off, whatever is stored', () => {
    const open = { regions: [lab], revealed: [], revealedShapes: [], enabled: false };
    expect(cellState(open, 0, 1, 1)).toBe('live');
    expect(cellState(open, 0, 9, 7)).toBe('live');
    // A stored memory does not fog a scene the GM has switched off.
    const remembered = { ...open, sight: sight({ '0': { explored: cellBitsFrom(10, 8, [{ col: 9, row: 7 }]) } }) };
    expect(cellState(remembered, 0, 9, 7)).toBe('live');
    expect(fogCells(remembered).on).toBe(false);
  });

  it('is hidden everywhere on a fogged scene with nothing revealed and nothing seen', () => {
    const fog = fogged({ regions: [lab, office] });
    for (const [col, row] of [
      [1, 1],
      [6, 1],
      [9, 7],
    ] as const) {
      expect(cellState(fog, 0, col, row)).toBe('hidden');
    }
  });

  it('opens a region the GM revealed live, by the centre of each square, on every floor', () => {
    const fog = fogged({ regions: [lab, office], revealed: ['lab'] });
    expect(cellState(fog, 0, 0, 0)).toBe('live');
    expect(cellState(fog, 0, 2, 2)).toBe('live');
    expect(cellState(fog, 0, 3, 2)).toBe('hidden'); // just outside the box
    expect(cellState(fog, 0, 6, 1)).toBe('hidden'); // the office, not revealed
    // GM reveals have no floor: the lab is open upstairs too.
    expect(cellState(fog, 2, 1, 1)).toBe('live');
  });

  it('opens a freeform shape live, and one of fewer than three points not at all', () => {
    const fog = fogged({ revealedShapes: [box(4, 4, 6, 6), [{ x: 0, y: 0 }, { x: 9, y: 9 }]] });
    expect(cellState(fog, 0, 4, 4)).toBe('live');
    expect(cellState(fog, 0, 5, 5)).toBe('live');
    expect(cellState(fog, 0, 6, 6)).toBe('hidden');
    expect(cellState(fog, 0, 0, 0)).toBe('hidden');
  });

  it('shows a region or shape the GM revealed as explored as explored, not live', () => {
    const fog = fogged({
      regions: [lab, office, vault],
      revealed: ['lab'],
      exploredRegionIds: ['office'],
      exploredShapes: [box(8, 5, 10, 8)],
    });
    expect(cellState(fog, 0, 1, 1)).toBe('live');
    expect(cellState(fog, 0, 6, 1)).toBe('explored');
    expect(cellState(fog, 0, 9, 6)).toBe('explored');
    expect(cellState(fog, 0, 1, 6)).toBe('hidden'); // the vault: in neither list
    expect(cellState(fog, 0, 4, 1)).toBe('hidden'); // between the two rooms
  });

  it('lets live win when a region is somehow in both reveal lists', () => {
    const fog = fogged({ regions: [lab], revealed: ['lab'], exploredRegionIds: ['lab'] });
    expect(cellState(fog, 0, 1, 1)).toBe('live');
  });

  it("reads the party's sight and memory per floor", () => {
    const fog = fogged({
      sight: sight({
        '0': {
          live: cellBitsFrom(10, 8, [{ col: 4, row: 4 }]),
          explored: cellBitsFrom(10, 8, [
            { col: 4, row: 4 },
            { col: 2, row: 6 },
          ]),
        },
        '1': { explored: cellBitsFrom(10, 8, [{ col: 7, row: 7 }]) },
      }),
    });
    expect(cellState(fog, 0, 4, 4)).toBe('live');
    expect(cellState(fog, 0, 2, 6)).toBe('explored');
    expect(cellState(fog, 0, 7, 7)).toBe('hidden'); // seen upstairs, not here
    expect(cellState(fog, 1, 7, 7)).toBe('explored');
    expect(cellState(fog, 1, 4, 4)).toBe('hidden'); // seen downstairs, not here
    expect(cellState(fog, 3, 4, 4)).toBe('hidden'); // a floor with no record at all
    expect(cellState(fog, 0, 12, 2)).toBe('hidden'); // off the recorded grid
  });

  it("makes a square the party is looking at live, even inside an area the GM revealed as explored", () => {
    const fog = fogged({
      regions: [office],
      exploredRegionIds: ['office'],
      sight: sight({ '0': { live: cellBitsFrom(10, 8, [{ col: 6, row: 1 }]) } }),
    });
    expect(cellState(fog, 0, 6, 1)).toBe('live');
    expect(cellState(fog, 0, 7, 1)).toBe('explored');
  });

  it('fogs a scene with sightlines on even when its fog switch is off, once it is told the scene', () => {
    const fog = {
      regions: [],
      revealed: [],
      revealedShapes: [],
      enabled: false,
      sight: sight({ '0': { live: cellBitsFrom(10, 8, [{ col: 1, row: 1 }]) } }),
    };
    // Read without the scene's vision, the switch is all it has: open.
    expect(cellState(fog, 0, 8, 8)).toBe('live');
    // With it, sightlines hide everything the party does not see.
    const vision = { sight: 'on' as const };
    expect(cellState(fog, 0, 8, 7, { vision })).toBe('hidden');
    expect(cellState(fog, 0, 1, 1, { vision })).toBe('live');
    expect(cellState(fog, 0, 1, 1, { vision: { sight: 'off' } })).toBe('live');
    expect(cellState(fog, 0, 8, 7, { vision: { sight: 'off' } })).toBe('live');
  });

  it("takes a player's copy at its word: `active` says whether it is fogged, in both directions", () => {
    const wire = {
      regions: [lab],
      revealed: ['lab'],
      revealedShapes: [],
      exploredRegionIds: [],
      active: true,
    };
    expect(cellState(wire, 0, 1, 1)).toBe('live');
    expect(cellState(wire, 0, 6, 1)).toBe('hidden');
    // Switched off, it is open, even though sightlines are said on (the server
    // answered `active` for the whole scene already).
    const off = { ...wire, active: false };
    expect(cellState(off, 0, 6, 1, { vision: { sight: 'on' } })).toBe('live');
  });
});

describe("the GM's brush: squares painted live, as seen before, or fogged again", () => {
  const lab = { id: 'lab', name: 'The lab', polygon: box(0, 0, 3, 3) };

  it('paints marks per floor, one mark a square, and takes them off again with clear', () => {
    let brush = paintBrush(undefined, 10, 8, 0, { live: ['1,1', '2,1'], explored: ['5,5'], hidden: ['7,7'] });
    brush = paintBrush(brush, 10, 8, 2, { hidden: ['4,4'] });
    const ground = brushReader(brush, 0);
    expect(ground(1, 1)).toBe('live');
    expect(ground(2, 1)).toBe('live');
    expect(ground(5, 5)).toBe('explored');
    expect(ground(7, 7)).toBe('hidden');
    expect(ground(4, 4)).toBeNull(); // painted upstairs, not here
    expect(brushReader(brush, 2)(4, 4)).toBe('hidden');
    expect(brushOnFloor(brush, 1)).toBe(false);

    // A square repainted takes the new mark and loses the old one.
    brush = paintBrush(brush, 10, 8, 0, { hidden: ['1,1'] });
    expect(brushReader(brush, 0)(1, 1)).toBe('hidden');
    expect(brush?.levels['0']?.live).toBe(encodeCellBits(cellBitsFrom(10, 8, [{ col: 2, row: 1 }])));

    // Off the grid, or not a square at all: nothing.
    expect(sameBrush(paintBrush(brush, 10, 8, 0, { live: ['40,40', 'x', '-1,2'] }), brush)).toBe(true);

    // Cleared square by square, the floors go, and then the whole record.
    brush = paintBrush(brush, 10, 8, 2, { clear: ['4,4'] });
    expect(Object.keys(brush?.levels ?? {})).toEqual(['0']);
    brush = paintBrush(brush, 10, 8, 0, { clear: ['1,1', '2,1', '5,5', '7,7'] });
    expect(brush).toBeUndefined();
  });

  it('keeps a mark where it is when the scene has been resized since', () => {
    const before = paintBrush(undefined, 10, 8, 0, { explored: ['3,4', '9,7'] });
    const after = paintBrush(before, 6, 6, 0, { live: ['0,0'] });
    expect(after?.cols).toBe(6);
    const read = brushReader(after, 0);
    expect(read(3, 4)).toBe('explored');
    expect(read(0, 0)).toBe('live');
    expect(read(9, 7)).toBeNull(); // no longer on the grid
  });

  it('beats the regions and shapes and the memory, never what a runner sees now', () => {
    const brush = paintBrush(undefined, 10, 8, 0, {
      hidden: ['1,1', '6,6'],
      explored: ['2,2'],
      live: ['8,1'],
    });
    const fog = fogged({
      regions: [lab],
      revealed: ['lab'],
      brush,
      sight: sight({
        '0': {
          live: cellBitsFrom(10, 8, [{ col: 6, row: 6 }]),
          explored: cellBitsFrom(10, 8, [
            { col: 6, row: 6 },
            { col: 1, row: 1 },
          ]),
        },
      }),
    });
    expect(cellState(fog, 0, 0, 0)).toBe('live'); // the lab, unpainted
    expect(cellState(fog, 0, 1, 1)).toBe('hidden'); // fogged again inside the lab, over the memory too
    expect(cellState(fog, 0, 2, 2)).toBe('explored'); // dimmed inside the live lab
    expect(cellState(fog, 0, 8, 1)).toBe('live'); // painted open on fogged ground
    expect(cellState(fog, 0, 6, 6)).toBe('live'); // a runner is looking at it: the mark waits
    // The same squares upstairs are unpainted: the lab is open there as everywhere.
    expect(cellState(fog, 1, 1, 1)).toBe('live');
    expect(cellState(fog, 1, 8, 1)).toBe('hidden');
    // A guard standing on each: only live ground puts him on the table.
    expect(tokenLive(fog, { x: 1.5, y: 1.5 })).toBe(false);
    expect(tokenLive(fog, { x: 2.5, y: 2.5 })).toBe(false);
    expect(tokenLive(fog, { x: 8.5, y: 1.5 })).toBe(true);
    // With the fog off, a mark changes nothing.
    expect(cellState({ ...fog, enabled: false }, 0, 1, 1)).toBe('live');
  });

  it('takes marks off where it is told: under a region, or the hidden ones a runner sees again', () => {
    const brush = paintBrush(paintBrush(undefined, 10, 8, 0, { hidden: ['1,1', '6,6'], live: ['2,2', '8,1'] }), 10, 8, 1, {
      explored: ['1,2'],
    });
    const underLab = eraseBrushUnder(brush, lab.polygon);
    expect(brushReader(underLab, 0)(1, 1)).toBeNull();
    expect(brushReader(underLab, 0)(2, 2)).toBeNull();
    expect(brushReader(underLab, 1)(1, 2)).toBeNull(); // every floor: the region has none
    expect(brushReader(underLab, 0)(6, 6)).toBe('hidden');
    expect(brushReader(underLab, 0)(8, 1)).toBe('live');
    // Nothing under the area: the very same record back.
    expect(eraseBrushUnder(brush, box(4, 4, 5, 5))).toBe(brush);

    // A runner sees (6,6) and (2,2) on the ground: only the hidden mark goes.
    const seen = eraseBrush(brush, (level, col, row) => level === 0 && ((col === 6 && row === 6) || (col === 2 && row === 2)), ['hidden']);
    expect(brushReader(seen, 0)(6, 6)).toBeNull();
    expect(brushReader(seen, 0)(2, 2)).toBe('live');
    expect(brushReader(seen, 0)(1, 1)).toBe('hidden');
  });

  it("names a region's fashion off the GM's lists, live first", () => {
    const fog = fogged({ regions: [lab], revealed: ['lab'], exploredRegionIds: ['lab', 'office'] });
    expect(regionFashion(fog, 'lab')).toBe('live');
    expect(regionFashion(fog, 'office')).toBe('explored');
    expect(regionFashion(fog, 'vault')).toBe('hidden');
  });
});

describe('tokenLive: does a token stand on live ground', () => {
  const lab = { id: 'lab', name: 'The lab', polygon: box(0, 0, 3, 3) };

  it('answers for a one-square token by the square its centre is in', () => {
    const fog = fogged({ regions: [lab], revealed: ['lab'] });
    expect(tokenLive(fog, { x: 1.5, y: 1.5 })).toBe(true);
    expect(tokenLive(fog, { x: 2.5, y: 2.5 })).toBe(true);
    expect(tokenLive(fog, { x: 3.5, y: 2.5 })).toBe(false);
  });

  it('is not live on explored ground or on another floor', () => {
    const fog = fogged({
      regions: [lab],
      exploredRegionIds: ['lab'],
      sight: sight({ '1': { live: cellBitsFrom(10, 8, [{ col: 6, row: 6 }]) } }),
    });
    expect(tokenLive(fog, { x: 1.5, y: 1.5 })).toBe(false); // remembered, nobody shown
    expect(tokenLive(fog, { x: 6.5, y: 6.5, level: 1 })).toBe(true);
    expect(tokenLive(fog, { x: 6.5, y: 6.5, level: 0 })).toBe(false);
    expect(tokenLive(fog, { x: 6.5, y: 6.5 })).toBe(false); // no level is the ground
  });

  it('counts a big token as seen when any square it stands on is seen, and no square beyond it', () => {
    // A 2 x 2 van centred on the grid corner (4, 4) covers squares 3..4 by 3..4.
    const at = (col: number, row: number) =>
      fogged({ sight: sight({ '0': { live: cellBitsFrom(10, 8, [{ col, row }]) } }) });
    const van = { x: 4, y: 4, size: 2 };
    expect(tokenLive(at(3, 3), van)).toBe(true);
    expect(tokenLive(at(4, 4), van)).toBe(true);
    expect(tokenLive(at(3, 4), van)).toBe(true);
    expect(tokenLive(at(5, 4), van)).toBe(false);
    expect(tokenLive(at(2, 3), van)).toBe(false);
    // A one-square token's edges lie on grid lines: it does not reach the square next door.
    expect(tokenLive(at(5, 4), { x: 4.5, y: 4.5 })).toBe(false);
  });

  it('is always live with the fog off, and survives an absurd size', () => {
    expect(tokenLive({ regions: [], revealed: [], revealedShapes: [] }, { x: 1.5, y: 1.5 })).toBe(true);
    const start = Date.now();
    expect(tokenLive(fogged(), { x: 1.5, y: 1.5, size: 1e9 })).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('scenes without the new state answer exactly as before', () => {
  // A fog shaped the way every scene before sightlines is: regions, some
  // revealed, a painted shape, and no explored reveals, no sight, no switch.
  const legacy: FogState = {
    regions: [
      { id: 'a', name: 'A', polygon: box(0, 0, 4, 4) },
      { id: 'b', name: 'B', polygon: [{ x: 6, y: 0 }, { x: 10, y: 2 }, { x: 7, y: 6 }] },
      { id: 'c', name: 'C', polygon: box(2, 5, 9, 8) },
    ],
    revealed: ['b', 'c'],
    revealedShapes: [[{ x: 0, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 8 }]],
  };

  it('gives live exactly where the fog was revealed, and hidden everywhere else', () => {
    const cells = fogCells(legacy);
    expect(cells.on).toBe(fogOn(legacy));
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 11; col += 1) {
        const centre = { x: col + 0.5, y: row + 0.5 };
        expect(cells.state(0, col, row)).toBe(fogRevealedAt(legacy, centre) ? 'live' : 'hidden');
        // A one-square token standing there is shown exactly when it was before.
        expect(cells.tokenLive({ x: centre.x, y: centre.y })).toBe(fogRevealedAt(legacy, centre));
      }
    }
  });

  it('is open everywhere for a scene with no fog at all', () => {
    const none = { regions: [], revealed: [], revealedShapes: [] };
    expect(fogCells(none).on).toBe(false);
    expect(cellState(none, 0, 3, 3)).toBe('live');
  });
});
