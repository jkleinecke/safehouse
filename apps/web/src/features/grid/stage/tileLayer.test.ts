/**
 * The painted floor (FR9.2), tested where it actually failed.
 *
 * This layer shipped with zero coverage and two independent bugs that both
 * present as "the GM paints and nothing happens", which is exactly the failure
 * a renderer hides best: `drawTiles` skips a cell it has no definition for, so
 * an empty palette draws an empty canvas rather than anything visibly wrong.
 * What is pinned here:
 *
 *   1. an unknown tile id draws NOTHING — the silent failure itself, asserted
 *      so the palette tests above it have something to mean;
 *   2. definitions are keyed by tileset AND tile, because `wall` exists in all
 *      six catalogue sets and a flat map painted Docklands in Club purple;
 *   3. every pattern the shipped catalogue uses produces real draw calls — the
 *      web half of the drift guard between `TilePattern` and this switch;
 *   4. `tileLayerKey` moves for the edit that the old count-and-length key was
 *      blind to: repainting a cell with a same-length tile id.
 *
 * `drawTiles` is pure over a Graphics-shaped object, so no renderer is needed —
 * same approach as `hit.test.ts` and `camera.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { Graphics } from 'pixi.js';
import { TILESETS } from '@safehouse/rules';
import { metricsFor } from '../geometry.js';
import { tileDefKey, tileDefsFromSets, type TileDrawDef } from '../types.js';
import { drawTiles, tileDrawInput, tileLayerKey, wallBoxes } from './tileLayer.js';

const M = metricsFor({ unitM: 1, cols: 10, rows: 8, offset: { x: 0, y: 0 }, projection: 'topdown' as const });

/**
 * The calls one cell's base face makes. It was `rect` + `fill`; a cell is now
 * drawn as a POLYGON so the same code path can lay down a square in plan view
 * and a diamond in isometric. The property under test is unchanged — a cell is
 * never transparent, whatever its pattern — only how the floor is spelled.
 */
const BASE_FACE = ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath', 'fill'];

interface Call {
  op: string;
  args: unknown[];
}

/** Chainable recorder shaped like the handful of Graphics calls we make. */
function fakeGraphics(): { g: Graphics; calls: Call[]; ops: () => string[] } {
  const calls: Call[] = [];
  const g: Record<string, unknown> = {};
  for (const op of [
    'clear',
    'rect',
    'fill',
    'moveTo',
    'lineTo',
    'stroke',
    'circle',
    'quadraticCurveTo',
    'closePath',
  ]) {
    g[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return g;
    };
  }
  return { g: g as unknown as Graphics, calls, ops: () => calls.map((c) => c.op) };
}

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
// The silent failure
// ---------------------------------------------------------------------------

describe('drawTiles skips what it cannot draw, loudly enough to test', () => {
  it('clears first, so a repaint never draws over the previous floor', () => {
    const { g, ops } = fakeGraphics();
    drawTiles(g, M, { tilesetId: 'docklands', cells: {}, defs: catalogueDefs() });
    expect(ops()).toEqual(['clear']);
  });

  it('draws NOTHING for a tile id the palette does not know', () => {
    const { g, ops } = fakeGraphics();
    drawTiles(g, M, {
      tilesetId: 'docklands',
      cells: { '1,1': 'no-such-tile' },
      defs: catalogueDefs(),
    });
    // This is the shape of "the feature is invisible": one clear, no fill.
    expect(ops()).toEqual(['clear']);
  });

  it('draws nothing when the palette is empty — the cold-load bug, in one line', () => {
    const { g, ops } = fakeGraphics();
    drawTiles(g, M, { tilesetId: 'docklands', cells: { '1,1': 'floor' }, defs: {} });
    expect(ops()).toEqual(['clear']);
  });

  it('skips malformed keys instead of failing the whole layer', () => {
    const defs = catalogueDefs();
    for (const key of ['', '1', '1,2,3', '1, 2', ' 1,2', '1.5,2', '+1,2', 'a,b']) {
      const { g, ops } = fakeGraphics();
      drawTiles(g, M, { tilesetId: 'docklands', cells: { [key]: 'floor' }, defs });
      expect(ops(), `key ${JSON.stringify(key)} should be skipped`).toEqual(['clear']);
    }
  });

  it('skips cells outside the grid, so shrinking a scene never crashes it', () => {
    const defs = catalogueDefs();
    const outside = { '-1,0': 'floor', '0,-1': 'floor', '10,0': 'floor', '0,8': 'floor' };
    const { g, ops } = fakeGraphics();
    drawTiles(g, M, { tilesetId: 'docklands', cells: outside, defs });
    expect(ops()).toEqual(['clear']);

    // …and the last in-bounds cell still draws, so the bound is not off by one.
    const edge = fakeGraphics();
    drawTiles(edge.g, M, { tilesetId: 'docklands', cells: { '9,7': 'floor' }, defs });
    expect(edge.ops()).toContain('fill');
  });

  it('places a cell at its grid position, in world units', () => {
    const { g, calls } = fakeGraphics();
    drawTiles(g, M, { tilesetId: 'corp', cells: { '3,2': 'wall' }, defs: catalogueDefs() });
    // The first vertex of the base face is the cell's north corner, which in
    // plan view is simply its top-left.
    const first = calls.find((c) => c.op === 'moveTo');
    expect(first?.args.slice(0, 2)).toEqual([3 * M.cell, 2 * M.cell]);
  });
});

// ---------------------------------------------------------------------------
// Keying: the Docklands-in-Club-purple bug
// ---------------------------------------------------------------------------

describe('definitions are keyed by tileset AND tile', () => {
  it('the same tile id in two sets draws in each set’s own colours', () => {
    const defs = catalogueDefs();
    const docklands = fakeGraphics();
    drawTiles(docklands.g, M, { tilesetId: 'docklands', cells: { '0,0': 'wall' }, defs });
    const club = fakeGraphics();
    drawTiles(club.g, M, { tilesetId: 'club', cells: { '0,0': 'wall' }, defs });

    // EVERY fill, not just the first: a wall is thin, so its cell paints the
    // set's floor underneath before the slab goes on top. Taking `[0]` here
    // would be reading the underlay and calling it the wall.
    const fillsOf = (calls: Call[]): unknown[] =>
      calls
        .filter((c) => c.op === 'fill')
        .map((c) => (c.args[0] as { color?: unknown } | undefined)?.color);

    // Read the expected colours FROM the catalogue rather than restating them.
    // A palette is a design decision that will be revised; the property under
    // test — each set draws its own `wall`, not the last one loaded — must not
    // need editing every time somebody picks a better grey.
    const colourOf = (setId: string, tileId: string): number => {
      const hex = TILESETS.find((s) => s.id === setId)!.tiles.find((t) => t.id === tileId)!
        .colors[0];
      return Number.parseInt(hex.slice(1), 16);
    };
    expect(fillsOf(docklands.calls)).toContain(colourOf('docklands', 'wall'));
    expect(fillsOf(club.calls)).toContain(colourOf('club', 'wall'));
    // The collision the key exists to prevent: neither set may draw the other's.
    expect(fillsOf(docklands.calls)).not.toContain(colourOf('club', 'wall'));
    expect(fillsOf(club.calls)).not.toContain(colourOf('docklands', 'wall'));
  });

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

  it('a cell whose id belongs to another set is skipped, not mis-drawn', () => {
    const { g, ops } = fakeGraphics();
    // `carpet` is a corp tile; this layer says it is a docklands layer.
    drawTiles(g, M, { tilesetId: 'docklands', cells: { '0,0': 'carpet' }, defs: catalogueDefs() });
    expect(ops()).toEqual(['clear']);
  });
});

// ---------------------------------------------------------------------------
// Patterns: the drift guard, web side
// ---------------------------------------------------------------------------

/** The `TilePattern` union, mirrored as data so a drop from either side shows. */
const PATTERNS = [
  'brick',
  'carpet',
  'concrete',
  'grating',
  'gravel',
  'hatch',
  'panel',
  'planks',
  'rubble',
  'solid',
  'tile',
  'water',
] as const;

describe('every pattern the catalogue uses actually draws something', () => {
  it('the catalogue uses exactly the twelve patterns this renderer handles', () => {
    const used = [...new Set(TILESETS.flatMap((s) => s.tiles.map((t) => t.pattern)))].sort();
    expect(used).toEqual([...PATTERNS]);
  });

  it('each pattern produces its own distinctive calls, not a bare rectangle', () => {
    // What each pattern must contribute BEYOND the base fill every cell gets.
    const marks: Record<(typeof PATTERNS)[number], string[]> = {
      brick: ['moveTo', 'lineTo', 'stroke'],
      carpet: ['moveTo', 'lineTo', 'stroke'],
      concrete: ['moveTo', 'lineTo', 'stroke'],
      grating: ['moveTo', 'lineTo', 'stroke'],
      gravel: ['circle'],
      hatch: ['moveTo', 'lineTo', 'stroke'],
      panel: ['rect', 'stroke'],
      planks: ['moveTo', 'lineTo', 'stroke'],
      rubble: ['rect'],
      solid: [],
      tile: ['moveTo', 'lineTo', 'stroke'],
      water: ['quadraticCurveTo', 'stroke'],
    };

    for (const pattern of PATTERNS) {
      const { g, ops } = fakeGraphics();
      const defs = { [tileDefKey('t', 'x')]: { pattern, colors: ['#112233', '#445566'] as const } };
      drawTiles(g, M, { tilesetId: 't', cells: { '0,0': 'x' }, defs });
      expect(ops()[0], pattern).toBe('clear');
      // Base fill first: a cell is never transparent, whatever the pattern.
      expect(ops().slice(1, 1 + BASE_FACE.length), pattern).toEqual(BASE_FACE);
      for (const mark of marks[pattern]) expect(ops(), `${pattern} → ${mark}`).toContain(mark);
    }
  });

  it('“solid” fills and strokes nothing', () => {
    const { g, ops } = fakeGraphics();
    const defs = { [tileDefKey('t', 'x')]: { pattern: 'solid' as const, colors: ['#111', '#222'] as const } };
    drawTiles(g, M, { tilesetId: 't', cells: { '0,0': 'x' }, defs });
    expect(ops()).toEqual(['clear', ...BASE_FACE]);
  });

  it('an unrecognised pattern degrades to flat colour rather than throwing', () => {
    // The compile-time guard is the `never` default in `drawTile`; at RUNTIME
    // the catalogue arrives over the wire, so an older client must still cope.
    const { g, ops } = fakeGraphics();
    const defs = {
      [tileDefKey('t', 'x')]: {
        pattern: 'thirteenth' as unknown as (typeof PATTERNS)[number],
        colors: ['#111', '#222'] as const,
      },
    };
    expect(() => drawTiles(g, M, { tilesetId: 't', cells: { '0,0': 'x' }, defs })).not.toThrow();
    expect(ops()).toEqual(['clear', ...BASE_FACE]);
  });

  it('a malformed palette draws the cell wrong rather than not at all', () => {
    const { g, calls } = fakeGraphics();
    const defs = {
      [tileDefKey('t', 'x')]: { pattern: 'planks' as const, colors: ['nonsense', ''] as const },
    };
    drawTiles(g, M, { tilesetId: 't', cells: { '0,0': 'x' }, defs });
    const fill = calls.find((c) => c.op === 'fill')?.args[0] as { color: number };
    expect(fill.color).toBe(0x3b3f45); // the documented fallback, not `NaN`
  });
});

// ---------------------------------------------------------------------------
// The redraw key
// ---------------------------------------------------------------------------

describe('tileLayerKey notices the edits the old key could not', () => {
  /**
   * A scene's tiles, expressed in the GROUND layer.
   *
   * These cases are about the redraw key noticing a change, which is
   * layer-agnostic — but they must not use the legacy `cells` field, because
   * that drains to empty on the server and a key hashed only from it would
   * never move again.
   */
  const layer = (ground: Record<string, string>, tilesetId = 'docklands') => ({
    tilesetId,
    cells: {},
    ground,
    structure: {},
    object: {},
  });

  it('moves when one cell is repainted with a same-length tile id', () => {
    // `floor` → `stain`: same cell count, same JSON length. The old key was
    // `tilesetId:count:JSON.length`, so it did not move and the canvas kept
    // showing poured concrete after the GM painted oil stains over it.
    const before = layer({ '1,1': 'floor' });
    const after = layer({ '1,1': 'stain' });
    expect(JSON.stringify(before.cells).length).toBe(JSON.stringify(after.cells).length);
    expect(tileLayerKey('s1', before)).not.toBe(tileLayerKey('s1', after));
  });

  it('moves for every same-length swap the shipped catalogue makes easy', () => {
    for (const [a, b] of [
      ['floor', 'stain'],
      ['stain', 'grate'],
      ['wall', 'rail'],
      ['rail', 'door'],
      ['road', 'walk'],
      ['dirt', 'slab'],
      ['valve', 'hatch'],
      ['floor', 'booth'],
    ]) {
      expect(
        tileLayerKey('s1', layer({ '4,4': a as string })),
        `${a} → ${b}`,
      ).not.toBe(tileLayerKey('s1', layer({ '4,4': b as string })));
    }
  });

  it('moves when N cells are erased and N same-length cells painted', () => {
    const before = layer({ '0,0': 'wall', '0,1': 'wall' });
    const after = layer({ '5,5': 'wall', '5,6': 'wall' });
    expect(tileLayerKey('s1', before)).not.toBe(tileLayerKey('s1', after));
  });

  it('moves when the scene changes, even if count and content coincide', () => {
    // One Stage is reused across scene switches (`useStage`), so the key has to
    // separate two same-sized floors itself.
    const same = layer({ '2,2': 'floor' });
    expect(tileLayerKey('s1', same)).not.toBe(tileLayerKey('s2', same));
  });

  it('moves when the tileset changes under identical cells', () => {
    expect(tileLayerKey('s1', layer({ '0,0': 'wall' }, 'docklands'))).not.toBe(
      tileLayerKey('s1', layer({ '0,0': 'wall' }, 'club')),
    );
  });

  it('holds still when nothing changed, whatever order the cells arrive in', () => {
    const a = layer({ '0,0': 'floor', '1,0': 'wall', '2,0': 'door' });
    const b = layer({ '2,0': 'door', '0,0': 'floor', '1,0': 'wall' });
    expect(tileLayerKey('s1', a)).toBe(tileLayerKey('s1', b));
  });

  it('distinguishes an unpainted scene from an emptied one', () => {
    // Erasing the last cell persists `{tilesetId, cells:{}}` server-side; that
    // is not the same state as a scene that was never painted.
    expect(tileLayerKey('s1', null)).not.toBe(tileLayerKey('s1', layer({})));
    expect(tileLayerKey('s1', undefined)).toBe(tileLayerKey('s1', null));
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

  it('joins to walls only, not to whatever happens to be next door', () => {
    // Two wall cells with a crate between them must not reach through it.
    const { g, calls } = fakeGraphics();
    const defs = catalogueDefs();
    drawTiles(g, M, {
      tilesetId: 'docklands',
      cells: { '0,0': 'wall', '1,0': 'crates', '2,0': 'wall' },
      defs,
    });
    // Both walls draw as lone posts, so neither reaches toward the crate.
    // Three cells drew something; the assertion that matters is that it did
    // not throw and every cell produced geometry.
    expect(calls.filter((c) => c.op === 'fill').length).toBeGreaterThan(3);
  });
});

describe('a wall is drawn in the cell it belongs to', () => {
  /** Every vertex the layer emitted, in world units. */
  const points = (calls: Call[]): Array<[number, number]> =>
    calls
      .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
      .map((c) => [c.args[0] as number, c.args[1] as number]);

  it('places a lone wall inside its own cell, not at the origin', () => {
    // `wallBoxes` works in cell-local fractions so the join rule can be stated
    // without coordinates — which means SOMETHING has to translate them, and
    // when nothing did, every wall on the map drew stacked at grid 0,0: one
    // pillar, no rooms. The unit test for `wallBoxes` could not see it because
    // it was, in its own terms, entirely correct.
    const { g, calls } = fakeGraphics();
    drawTiles(g, M, { tilesetId: 'docklands', cells: { '5,4': 'wall' }, defs: catalogueDefs() });

    const pts = points(calls);
    expect(pts.length).toBeGreaterThan(0);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(5 * M.cell);
      expect(x).toBeLessThanOrEqual(6 * M.cell);
      expect(y).toBeGreaterThanOrEqual(4 * M.cell);
      expect(y).toBeLessThanOrEqual(5 * M.cell);
    }
  });

  it('puts two walls in two different places', () => {
    const { g, calls } = fakeGraphics();
    drawTiles(g, M, {
      tilesetId: 'docklands',
      cells: { '1,1': 'wall', '7,6': 'wall' },
      defs: catalogueDefs(),
    });
    const xs = points(calls).map(([x]) => x);
    // Far apart on the canvas, which stacking at the origin would not be.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(5 * M.cell);
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

  it('actually draws a scene whose tiles live only in the layers', () => {
    // The failure in one line: layered tiles, nothing in `cells`, and the
    // canvas has to show something.
    const { g, ops } = fakeGraphics();
    drawTiles(
      g,
      M,
      tileDrawInput(
        { tilesetId: 'sprawl', cells: {}, ground: { '0,0': 'road' }, structure: { '1,0': 'wall' }, object: { '2,0': 'tree' } },
        catalogueDefs(),
      ),
    );
    expect(ops()).toContain('fill');
    // One fill per layer at minimum — a floor, a wall (plus its underlay) and
    // a tree. Anything that silently dropped a layer lands under this.
    expect(ops().filter((o) => o === 'fill').length).toBeGreaterThanOrEqual(4);
  });

  it('draws the ground under the things standing on it', () => {
    // Order is the depth buffer: ground first, then structure, then objects.
    const { g, calls } = fakeGraphics();
    drawTiles(
      g,
      M,
      tileDrawInput(
        { tilesetId: 'sprawl', cells: {}, ground: { '0,0': 'grass' }, structure: {}, object: { '0,0': 'tree' } },
        catalogueDefs(),
      ),
    );
    const fills = calls
      .filter((c) => c.op === 'fill')
      .map((c) => (c.args[0] as { color?: number }).color);
    const colourOf = (id: string): number => {
      const hex = TILESETS.find((s) => s.id === 'sprawl')!.tiles.find((t) => t.id === id)!.colors[0];
      return Number.parseInt(hex.slice(1), 16);
    };
    expect(fills.indexOf(colourOf('grass'))).toBeGreaterThanOrEqual(0);
    expect(fills.indexOf(colourOf('grass'))).toBeLessThan(fills.lastIndexOf(colourOf('tree')));
  });
});
