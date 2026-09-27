/**
 * The tile plan (FR9.2), tested where it actually failed.
 *
 * What is pinned here is what the 3D world and the palette's painter both
 * read, so a mistake here is a mistake in both:
 *
 *   1. definitions are keyed by tileset AND tile, because `wall` exists in all
 *      six catalogue sets and a flat map painted Docklands in Club purple —
 *      and a set answers slots as well as ids;
 *   2. a thin wall orients itself from its neighbours, by one rule;
 *   3. adjacent cells of one opening are one run, found from its last cell,
 *      and a change anywhere along the run widens to all of it;
 *   4. `tileDrawInput` forwards every layer, and the diff (`cellSignatures`,
 *      `changedCells`) sees every change to one — an open door included.
 *
 * The drawing on top of the plan is tested beside it (`gm/art/*.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { TILESETS } from '@safehouse/rules';
import { metricsFor } from '../geometry.js';
import { tileDefKey, tileDefsFromSets, type TileDrawDef } from '../types.js';
import {
  cellSignatures,
  changedCells,
  cutOf,
  cutRunFor,
  expandCutRuns,
  planTiles,
  tileDrawInput,
  wallBoxes,
  wallDiagonals,
  type TileDrawInput,
} from './tiles.js';

const M = metricsFor({ unitM: 1, cols: 10, rows: 8, offset: { x: 0, y: 0 }, projection: 'topdown' as const });
const iso =metricsFor({ unitM: 1, cols: 12, rows: 12, offset: { x: 0, y: 0 }, projection: 'iso' as const });

/**
 * The palette exactly as production builds it.
 *
 * Calls the real flattener rather than re-deriving it: a hand-rolled copy here
 * silently omitted `height`, `footprint` and the wall underlay, so these tests
 * would have gone on passing against a palette no running client ever sees —
 * which is the same drift that let the cold-load seed ship without heights.
 */
function catalogueDefs(): Record<string, TileDrawDef> {
  return tileDefsFromSets(TILESETS);
}

// ---------------------------------------------------------------------------
// Slots: what a painted square holds, drawn by whichever set the floor names
// ---------------------------------------------------------------------------

describe('the palette answers slots as well as ids', () => {
  const defs = catalogueDefs();

  it('files each tile under its id and its slot, as the same def', () => {
    expect(defs[tileDefKey('docklands', 'ground/1')]).toBe(defs[tileDefKey('docklands', 'floor')]);
    expect(defs[tileDefKey('docklands', 'building/door')]).toBe(defs[tileDefKey('docklands', 'door')]);
    expect(defs[tileDefKey('corp', 'interior/1')]).toBe(defs[tileDefKey('corp', 'desk')]);
  });

  it('draws the same slot as a different tile in another set', () => {
    const dock = defs[tileDefKey('docklands', 'ground/2')];
    const corp = defs[tileDefKey('corp', 'ground/2')];
    expect(dock).toBeDefined();
    expect(corp).toBeDefined();
    expect(dock).not.toBe(corp);
    expect(defs[tileDefKey('corp', 'building/door')]?.kind).toBe('door');
  });

  it('gives every set a def for every slot any set defines, so a switched map has no holes', () => {
    const slots = new Set(
      Object.keys(defs)
        .map((k) => k.split('/').slice(1).join('/'))
        .filter((ref) => ref.includes('/')),
    );
    expect(slots.size).toBeGreaterThan(10);
    for (const set of TILESETS) {
      for (const slot of slots) {
        expect(defs[tileDefKey(set.id, slot)], `${set.id} ${slot}`).toBeDefined();
      }
    }
    // A number the set lacks wraps onto one it has, rather than onto nothing.
    expect(defs[tileDefKey('corp', 'decoration/5')]).toBe(defs[tileDefKey('corp', 'decoration/1')]);
  });
});

// ---------------------------------------------------------------------------
// Painted doors standing open (FR9.24)
// ---------------------------------------------------------------------------

describe('a painted door standing open', () => {
  const defs = catalogueDefs();
  const structure = { '3,3': 'wall', '3,4': 'door', '3,5': 'door', '3,6': 'wall' };

  it('rides from the scene into the draw input, and into the plan', () => {
    const tiles = { tilesetId: 'docklands', cells: {}, ground: {}, structure, object: {}, doors: { '3,4': { open: true, locked: false } } };
    const input = tileDrawInput(tiles as never, defs);
    expect(input.doors).toEqual({ '3,4': { open: true, locked: false } });
    const plan = planTiles(M, input);
    expect([...plan.openDoors]).toEqual(['3,4']);
    expect(planTiles(M, { tilesetId: 'docklands', structure, defs }).openDoors.size).toBe(0);
  });

  it('is a change in its cell, so opening it redraws the run', () => {
    const shut = cellSignatures({ tilesetId: 'docklands', structure, defs });
    const open = cellSignatures({ tilesetId: 'docklands', structure, doors: { '3,4': { open: true, locked: false } }, defs });
    expect(open.get('3,4')).not.toBe(shut.get('3,4'));
    expect(open.get('3,5')).toBe(shut.get('3,5'));
    // A door state for a cell with no tile in it is not a phantom cell.
    expect(cellSignatures({ tilesetId: 'docklands', structure, doors: { '9,9': { open: true, locked: false } }, defs }).has('9,9')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Keying: the Docklands-in-Club-purple bug
// ---------------------------------------------------------------------------

describe('definitions are keyed by tileset AND tile', () => {
  it('names the collisions a flat id map used to swallow', () => {
    const owners = new Map<string, string[]>();
    for (const set of TILESETS) {
      for (const t of set.tiles) owners.set(t.id, [...(owners.get(t.id) ?? []), set.id]);
    }
    // Documented fact, not an accident: these are why `tileDefKey` exists.
    expect(owners.get('wall')).toHaveLength(6);
    expect(owners.get('door')).toHaveLength(4);
    expect(owners.get('floor')).toEqual(['docklands', 'club']);
  });
});

// ---------------------------------------------------------------------------
// Thin walls
// ---------------------------------------------------------------------------

/**
 * A wall that fills its cell makes every room read as a ring of fat blocks
 * with the interior shrunk to match. Real walls are thin, so a wall tile draws
 * a third-of-a-cell slab that ORIENTS ITSELF from its neighbours — the GM
 * paints cells and gets architecture without saying which way anything faces.
 *
 * The rule is deliberately one rule: a centre post, plus a stub toward each
 * neighbouring wall. Every configuration falls out of it, which is why none of
 * them is enumerated in the renderer and all of them are asserted here.
 */
describe('thin walls orient themselves from their neighbours', () => {
  const none = { n: false, e: false, s: false, w: false };
  /** Total grid area covered, to compare shapes without pinning coordinates. */
  const area = (boxes: Array<[number, number, number, number]>): number =>
    boxes.reduce((sum, [x0, y0, x1, y1]) => sum + (x1 - x0) * (y1 - y0), 0);

  it('is a lone post when nothing adjoins it', () => {
    const boxes = wallBoxes(none);
    expect(boxes).toHaveLength(1);
    // A third of a cell each way — a pillar, which is what a lone wall cell is.
    expect(area(boxes)).toBeCloseTo((1 / 3) * (1 / 3), 9);
  });

  it('spans the cell for a straight run, in either axis', () => {
    const horizontal = wallBoxes({ ...none, e: true, w: true });
    const vertical = wallBoxes({ ...none, n: true, s: true });
    // A third of the cell's area: full length, a third of the width.
    expect(area(horizontal)).toBeCloseTo(1 / 3, 9);
    expect(area(vertical)).toBeCloseTo(1 / 3, 9);
    // …and they are genuinely different shapes, not the same box twice.
    expect(horizontal).not.toEqual(vertical);
  });

  it('turns a corner without a gap at the join', () => {
    const corner = wallBoxes({ ...none, n: true, e: true });
    // Centre + two stubs, and the centre is what closes the inside of the bend.
    expect(corner).toHaveLength(3);
    expect(area(corner)).toBeCloseTo((1 / 3) * (1 / 3) * 3, 9);
  });

  it('makes a T and a crossing from the same rule', () => {
    expect(wallBoxes({ n: true, e: true, s: true, w: false })).toHaveLength(4);
    expect(wallBoxes({ n: true, e: true, s: true, w: true })).toHaveLength(5);
    // Walls touching only at a corner join along the diagonal: one band from
    // the middle to that corner, and none where a neighbour beside already
    // turns the wall there.
    expect(wallDiagonals({ ...none, ne: true })).toHaveLength(1);
    expect(wallDiagonals({ ...none, ne: true, n: true })).toHaveLength(0);
    expect(wallDiagonals({ ...none, ne: true, sw: true })).toHaveLength(2);
    // Walls side by side close up: the corner facing a square of wall fills,
    // so two rows read as one thick wall, and a cell walled all round is solid.
    expect(wallBoxes({ n: true, e: true, s: false, w: false, ne: true })).toContainEqual([expect.any(Number), 0, 1, expect.any(Number)]);
    expect(wallBoxes({ n: true, e: true, s: false, w: false, ne: false })).toHaveLength(3);
    expect(wallBoxes({ n: true, e: true, s: true, w: true, ne: true, nw: true, se: true, sw: true })).toHaveLength(9);
  });

  it('never leaves the cell it belongs to', () => {
    // A slab spilling into the neighbouring cell would draw over a floor tile
    // that is not its own, and in isometric that reads as a rendering fault.
    for (const joins of [none, { n: true, e: true, s: true, w: true }, { ...none, w: true }]) {
      for (const [x0, y0, x1, y1] of wallBoxes(joins)) {
        expect(x0).toBeGreaterThanOrEqual(0);
        expect(y0).toBeGreaterThanOrEqual(0);
        expect(x1).toBeLessThanOrEqual(1);
        expect(y1).toBeLessThanOrEqual(1);
        expect(x1).toBeGreaterThan(x0);
        expect(y1).toBeGreaterThan(y0);
      }
    }
  });

  it('draws floor under a thin wall, so a wall is never a hole in the map', () => {
    // The slab covers a third of its cell; without an underlay the other two
    // thirds would show empty grid exactly where a room's edge should be.
    const defs = catalogueDefs();
    const withUnderlay = defs[tileDefKey('docklands', 'wall')];
    expect(withUnderlay?.footprint).toBe('wall');
    expect(withUnderlay?.underlay).toBeDefined();
    // A floor tile needs none of this.
    expect(defs[tileDefKey('docklands', 'floor')]?.underlay).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Openings: every design named, and a run drawn once
// ---------------------------------------------------------------------------

describe('every opening in the catalogue has a design', () => {
  it('every door and see-through wall in the catalogue names a design', () => {
    for (const set of TILESETS) {
      for (const t of set.tiles) {
        // Openings are full-height building fabric. A railing or a velvet
        // rope is see-through because it is low, and is not a window.
        if (t.footprint !== 'wall' || (t.height ?? 0) < 1) continue;
        if (t.kind === 'door' || t.blocksSight === false) {
          expect(t.cut, `${set.id}/${t.id}`).toBeDefined();
        }
      }
    }
  });
});

describe('a run of one opening is one opening', () => {
  const defs = tileDefsFromSets(TILESETS);
  const input = (structure: Record<string, string>): TileDrawInput => ({
    tilesetId: 'docklands',
    structure,
    defs,
  });

  it('is drawn once, from the last cell, across the whole run', () => {
    // A wall along row 4 with a two-cell roller door in it.
    const p = planTiles(iso, input({ '2,4': 'wall', '3,4': 'door', '4,4': 'door', '5,4': 'wall' }));
    const door = defs[tileDefKey('docklands', 'door')]!;
    const first = cutRunFor(p, { col: 3, row: 4, id: 'door', def: door });
    const last = cutRunFor(p, { col: 4, row: 4, id: 'door', def: door });
    expect(first).toBeNull();
    expect(last).not.toBeNull();
    expect(last!.n).toBe(2);
    expect(last!.axis).toBe('x');
    expect(last!.rect[0]).toBe(3);
    expect(last!.rect[2]).toBe(5);
  });

  it('runs along y when the wall does', () => {
    const p = planTiles(iso, input({ '4,2': 'wall', '4,3': 'window', '4,4': 'window', '4,5': 'wall' }));
    const window = defs[tileDefKey('docklands', 'window')]!;
    const run = cutRunFor(p, { col: 4, row: 4, id: 'window', def: window });
    expect(run?.axis).toBe('y');
    expect(run?.n).toBe(2);
    expect(cutRunFor(p, { col: 4, row: 3, id: 'window', def: window })).toBeNull();
  });

  it('does not merge different openings, or a door with the wall around it', () => {
    const p = planTiles(iso, input({ '2,4': 'wall', '3,4': 'door', '4,4': 'window', '5,4': 'wall' }));
    const door = defs[tileDefKey('docklands', 'door')]!;
    expect(cutRunFor(p, { col: 3, row: 4, id: 'door', def: door })?.n).toBe(1);
  });

  it('a plain wall has no design, and a door without one gets the plain leaf', () => {
    expect(cutOf(defs[tileDefKey('docklands', 'wall')]!)).toBeNull();
    expect(cutOf({ pattern: 'solid', colors: ['#111', '#222'], footprint: 'wall', kind: 'door' })).toBe('door');
    expect(cutOf({ pattern: 'solid', colors: ['#111', '#222'], footprint: 'wall', height: 1, blocksSight: false })).toBe('glass');
    // …but a low see-through wall — a railing, a rope — is not glazing.
    expect(cutOf({ pattern: 'solid', colors: ['#111', '#222'], footprint: 'wall', height: 0.5, blocksSight: false })).toBeNull();
  });

  it('a change anywhere on a run dirties the whole run, before and after', () => {
    const before = input({ '3,4': 'door', '4,4': 'door', '5,4': 'door' });
    const after = input({ '3,4': 'door', '4,4': 'wall', '5,4': 'door' });
    const widened = expandCutRuns(['4,4'], [before, after]);
    expect(widened.has('3,4')).toBe(true);
    expect(widened.has('5,4')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/**
 * `tileDrawInput` is the join between "the server stores three layers" and
 * "the renderer draws three layers".
 *
 * It exists because both of those were true and correct while the stage
 * between them forwarded only `cells` — which drains to empty once a scene is
 * saved — so a fully painted street rendered as a blank canvas. Neither side's
 * tests could catch it, because neither side was wrong. This is the test that
 * would have.
 */
describe('tileDrawInput forwards every layer to the renderer', () => {
  const tiles = {
    tilesetId: 'sprawl',
    cells: { '9,9': 'road' },
    ground: { '0,0': 'road' },
    structure: { '1,0': 'wall' },
    object: { '2,0': 'tree' },
  };

  it('carries all four maps through', () => {
    const input = tileDrawInput(tiles, catalogueDefs());
    expect(input.tilesetId).toBe('sprawl');
    expect(input.ground).toEqual(tiles.ground);
    expect(input.structure).toEqual(tiles.structure);
    expect(input.object).toEqual(tiles.object);
    expect(input.cells).toEqual(tiles.cells);
  });
});

// ---------------------------------------------------------------------------
// The diff: which squares a change touches
// ---------------------------------------------------------------------------

describe('cellSignatures', () => {
  it('folds every layer into one string per square', () => {
    const sigs = cellSignatures({
      tilesetId: 't',
      ground: { '1,1': 'floor' },
      structure: { '1,1': 'wall' },
      object: { '2,2': 'chair' },
      defs: {},
    });
    expect(sigs.get('1,1')).toContain('g=floor');
    expect(sigs.get('1,1')).toContain('s=wall');
    expect(sigs.get('2,2')).toBe('o=chair;');
    expect(sigs.size).toBe(2);
  });
});

describe('changedCells', () => {
  const sig = (m: Record<string, string>) => new Map(Object.entries(m));

  it('sees a repaint, an addition and an erasure', () => {
    const prev = sig({ '1,1': 'g=floor;', '2,2': 'g=floor;', '3,3': 'g=floor;' });
    const next = sig({ '1,1': 'g=stain;', '2,2': 'g=floor;', '4,4': 'g=floor;' });
    expect(changedCells(prev, next).sort()).toEqual(['1,1', '3,3', '4,4']);
  });

  it('sees nothing when nothing moved, whatever the order', () => {
    const prev = sig({ '1,1': 'g=floor;', '2,2': 'g=floor;' });
    const next = sig({ '2,2': 'g=floor;', '1,1': 'g=floor;' });
    expect(changedCells(prev, next)).toEqual([]);
  });
});
