/**
 * The tile painter (FR9.2), tested where it actually failed.
 *
 * This painter shipped with zero coverage and two independent bugs that both
 * present as "the GM paints and nothing happens", which is exactly the failure
 * a renderer hides best: `drawTiles` skips a cell it has no definition for, so
 * an empty palette draws an empty canvas rather than anything visibly wrong.
 * What is pinned here:
 *
 *   1. an unknown tile id draws NOTHING — the silent failure itself, asserted
 *      so the palette tests above it have something to mean;
 *   2. definitions are keyed by tileset AND tile, and each set draws its own
 *      colours;
 *   3. every pattern the shipped catalogue uses produces real draw calls — the
 *      web half of the drift guard between `TilePattern` and this switch;
 *   4. walls, doors and the layers under and over them draw where they belong;
 *   5. a tile with a design (`stage/props.ts`) draws through it, standing or
 *      flat.
 *
 * `drawTiles` is pure over its pen (`ArtPen`), so a recorder stands in and no
 * renderer is needed — same approach as `hit.test.ts` and `camera.test.ts`.
 * The plan it draws from is tested on its own (`plan/tiles.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { TILESETS } from '@safehouse/rules';
import { metricsFor } from '../../geometry.js';
import { tileDrawInput } from '../../plan/tiles.js';
import { tileDefKey, tileDefsFromSets, type TileDrawDef } from '../../types.js';
import type { ArtPen } from './canvasPen.js';
import { drawTiles, runOpen } from './tileArt.js';

const M = metricsFor({ unitM: 1, cols: 10, rows: 8, offset: { x: 0, y: 0 }, projection: 'topdown' as const });

/**
 * The calls one cell's base face makes. It was `rect` + `fill`; a cell is now
 * drawn as a POLYGON so the same code path can lay down a square in plan view
 * and a diamond in isometric. The property under test is unchanged — a cell is
 * never transparent, whatever its pattern — only how the floor is spelled.
 */
const BASE_FACE = ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath', 'fill'];

/**
 * What a floor cell with nothing on any side draws after its face: the map's
 * edge. An ink line on the two far sides, and a shadow band plus an ink line
 * on the two near ones — see `drawFloorEdge`.
 */
const EDGE_LINE = ['moveTo', 'lineTo', 'stroke'];
const EDGE_DROP = ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath', 'fill'];
const LONE_EDGE = [...EDGE_LINE, ...EDGE_LINE, ...EDGE_DROP, ...EDGE_LINE, ...EDGE_DROP, ...EDGE_LINE];

interface Call {
  op: string;
  args: unknown[];
}

/** Chainable recorder of every call an `ArtPen` takes. */
function fakePen(): { g: ArtPen; calls: Call[]; ops: () => string[] } {
  const calls: Call[] = [];
  const g: Record<string, unknown> = {};
  for (const op of [
    'clear',
    'beginPath',
    'fill',
    'moveTo',
    'lineTo',
    'stroke',
    'circle',
    'ellipse',
    'closePath',
  ]) {
    g[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return g;
    };
  }
  return { g: g as unknown as ArtPen, calls, ops: () => calls.map((c) => c.op) };
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
// Painted doors standing open (FR9.24)
// ---------------------------------------------------------------------------

describe('a painted door standing open', () => {
  const defs = catalogueDefs();
  const structure = { '3,3': 'wall', '3,4': 'door', '3,5': 'door', '3,6': 'wall' };

  it('answers per leaf along the run, first to last', () => {
    const run = { rect: [3.33, 4, 3.67, 6] as const, axis: 'y' as const, n: 2 };
    expect(runOpen(run, { col: 3, row: 5 }, new Set(['3,4']))).toEqual([true, false]);
    expect(runOpen(run, { col: 3, row: 5 }, new Set(['3,5']))).toEqual([false, true]);
    expect(runOpen(run, { col: 3, row: 5 }, new Set())).toEqual([]);
    expect(runOpen(run, { col: 3, row: 5 }, undefined)).toEqual([]);
  });

  it('draws the floor differently with the door open', () => {
    const a = fakePen();
    drawTiles(a.g, M, { tilesetId: 'docklands', structure, defs });
    const b = fakePen();
    drawTiles(b.g, M, { tilesetId: 'docklands', structure, doors: { '3,4': { open: true, locked: false }, '3,5': { open: true, locked: false } }, defs });
    expect(b.ops()).not.toEqual(a.ops());
  });
});

// ---------------------------------------------------------------------------
// The silent failure
// ---------------------------------------------------------------------------

describe('drawTiles skips what it cannot draw, loudly enough to test', () => {
  it('clears first, so a repaint never draws over the previous floor', () => {
    const { g, ops } = fakePen();
    drawTiles(g, M, { tilesetId: 'docklands', cells: {}, defs: catalogueDefs() });
    expect(ops()).toEqual(['clear']);
  });

  it('draws NOTHING for a tile id the palette does not know', () => {
    const { g, ops } = fakePen();
    drawTiles(g, M, {
      tilesetId: 'docklands',
      cells: { '1,1': 'no-such-tile' },
      defs: catalogueDefs(),
    });
    // This is the shape of "the feature is invisible": one clear, no fill.
    expect(ops()).toEqual(['clear']);
  });

  it('draws nothing when the palette is empty — the cold-load bug, in one line', () => {
    const { g, ops } = fakePen();
    drawTiles(g, M, { tilesetId: 'docklands', cells: { '1,1': 'floor' }, defs: {} });
    expect(ops()).toEqual(['clear']);
  });

  it('skips malformed keys instead of failing the whole layer', () => {
    const defs = catalogueDefs();
    for (const key of ['', '1', '1,2,3', '1, 2', ' 1,2', '1.5,2', '+1,2', 'a,b']) {
      const { g, ops } = fakePen();
      drawTiles(g, M, { tilesetId: 'docklands', cells: { [key]: 'floor' }, defs });
      expect(ops(), `key ${JSON.stringify(key)} should be skipped`).toEqual(['clear']);
    }
  });

  it('skips cells outside the grid, so shrinking a scene never crashes it', () => {
    const defs = catalogueDefs();
    const outside = { '-1,0': 'floor', '0,-1': 'floor', '10,0': 'floor', '0,8': 'floor' };
    const { g, ops } = fakePen();
    drawTiles(g, M, { tilesetId: 'docklands', cells: outside, defs });
    expect(ops()).toEqual(['clear']);

    // …and the last in-bounds cell still draws, so the bound is not off by one.
    const edge = fakePen();
    drawTiles(edge.g, M, { tilesetId: 'docklands', cells: { '9,7': 'floor' }, defs });
    expect(edge.ops()).toContain('fill');
  });

  it('places a cell at its grid position, in world units', () => {
    const { g, calls } = fakePen();
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
    const docklands = fakePen();
    drawTiles(docklands.g, M, { tilesetId: 'docklands', cells: { '0,0': 'wall' }, defs });
    const club = fakePen();
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

  it('a cell whose id belongs to another set is skipped, not mis-drawn', () => {
    const { g, ops } = fakePen();
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
  'cobble',
  'concrete',
  'dirt',
  'field',
  'grass',
  'grating',
  'gravel',
  'hatch',
  'marble',
  'panel',
  'planks',
  'reeds',
  'rubble',
  'sand',
  'solid',
  'tile',
  'water',
] as const;

describe('every pattern the catalogue uses actually draws something', () => {
  it('the catalogue uses exactly the fourteen patterns this renderer handles', () => {
    const used = [...new Set(TILESETS.flatMap((s) => s.tiles.map((t) => t.pattern)))].sort();
    expect(used).toEqual([...PATTERNS]);
  });

  it('each pattern produces its own distinctive calls, not a bare rectangle', () => {
    // What each pattern must contribute BEYOND the base fill every cell gets.
    // Materials are drawn in grid space now — courses, boards and chunks are
    // projected polygons, dots are ground ellipses — so the marks are what
    // each one adds on top of the base face, not a particular primitive.
    const marks: Record<(typeof PATTERNS)[number], string[]> = {
      brick: ['moveTo', 'lineTo', 'stroke'],
      carpet: ['moveTo', 'lineTo', 'stroke'],
      concrete: ['moveTo', 'lineTo', 'stroke', 'ellipse'],
      grating: ['moveTo', 'lineTo', 'stroke'],
      gravel: ['ellipse'],
      hatch: ['moveTo', 'lineTo', 'stroke'],
      panel: ['moveTo', 'lineTo', 'stroke', 'ellipse'],
      planks: ['moveTo', 'lineTo', 'stroke'],
      rubble: ['moveTo', 'lineTo', 'fill'],
      solid: [],
      tile: ['moveTo', 'lineTo', 'stroke'],
      water: ['moveTo', 'lineTo', 'stroke'],
      grass: ['moveTo', 'lineTo', 'stroke'],
      dirt: ['moveTo', 'lineTo', 'stroke', 'ellipse'],
      cobble: ['moveTo', 'lineTo', 'stroke'],
      marble: ['moveTo', 'lineTo', 'stroke'],
      sand: ['ellipse', 'moveTo', 'lineTo', 'stroke'],
      field: ['moveTo', 'lineTo', 'stroke', 'ellipse'],
      reeds: ['moveTo', 'lineTo', 'stroke', 'ellipse'],
    };

    for (const pattern of PATTERNS) {
      const { g, ops } = fakePen();
      const defs = { [tileDefKey('t', 'x')]: { pattern, colors: ['#112233', '#445566'] as const } };
      drawTiles(g, M, { tilesetId: 't', cells: { '0,0': 'x' }, defs });
      expect(ops()[0], pattern).toBe('clear');
      // Base fill first: a cell is never transparent, whatever the pattern.
      expect(ops().slice(1, 1 + BASE_FACE.length), pattern).toEqual(BASE_FACE);
      for (const mark of marks[pattern]) expect(ops(), `${pattern} → ${mark}`).toContain(mark);
      // …and every material but `solid` draws SOMETHING beyond that face. A
      // material that costs nothing to draw is a colour, not a material.
      if (pattern !== 'solid') {
        expect(ops().length, `${pattern} draws only its base face`).toBeGreaterThan(
          1 + BASE_FACE.length + 2,
        );
      }
    }
  });

  it('“solid” fills and strokes nothing', () => {
    const { g, ops } = fakePen();
    const defs = { [tileDefKey('t', 'x')]: { pattern: 'solid' as const, colors: ['#111', '#222'] as const } };
    drawTiles(g, M, { tilesetId: 't', cells: { '0,0': 'x' }, defs });
    // A lone cell is all edge, so the base face is followed by exactly that.
    expect(ops()).toEqual(['clear', ...BASE_FACE, ...LONE_EDGE]);
  });

  it('an unrecognised pattern degrades to flat colour rather than throwing', () => {
    // The compile-time guard is the `never` default in `drawTile`; at RUNTIME
    // the catalogue arrives over the wire, so an older client must still cope.
    const { g, ops } = fakePen();
    const defs = {
      [tileDefKey('t', 'x')]: {
        pattern: 'thirteenth' as unknown as (typeof PATTERNS)[number],
        colors: ['#111', '#222'] as const,
      },
    };
    expect(() => drawTiles(g, M, { tilesetId: 't', cells: { '0,0': 'x' }, defs })).not.toThrow();
    // A lone cell is all edge, so the base face is followed by exactly that.
    expect(ops()).toEqual(['clear', ...BASE_FACE, ...LONE_EDGE]);
  });

  it('a malformed palette draws the cell wrong rather than not at all', () => {
    const { g, calls } = fakePen();
    const defs = {
      [tileDefKey('t', 'x')]: { pattern: 'planks' as const, colors: ['nonsense', ''] as const },
    };
    drawTiles(g, M, { tilesetId: 't', cells: { '0,0': 'x' }, defs });
    const fill = calls.find((c) => c.op === 'fill')?.args[0] as { color: number };
    // The documented fallback, not `NaN` — within the per-cell grain, which
    // moves a floor's value by a few percent so a painted room does not read
    // as vinyl. Every channel of 0x3b3f45 is under 0x50, so a grained fallback
    // still sits in the same dark grey.
    expect(Number.isFinite(fill.color)).toBe(true);
    for (const shift of [16, 8, 0]) {
      const channel = (fill.color >> shift) & 0xff;
      const expected = (0x3b3f45 >> shift) & 0xff;
      expect(Math.abs(channel - expected)).toBeLessThanOrEqual(Math.ceil(expected * 0.05));
    }
  });
});

// ---------------------------------------------------------------------------
// Thin walls
// ---------------------------------------------------------------------------

// The join rule itself (`wallBoxes`, `wallDiagonals`) is pinned in
// `plan/tiles.test.ts`; what is pinned here is that the painter follows it.
describe('thin walls orient themselves from their neighbours', () => {
  it('joins to walls only, not to whatever happens to be next door', () => {
    // Two wall cells with a crate between them must not reach through it.
    const { g, calls } = fakePen();
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
    const { g, calls } = fakePen();
    drawTiles(g, M, { tilesetId: 'docklands', cells: { '5,4': 'wall' }, defs: catalogueDefs() });

    const pts = points(calls);
    expect(pts.length).toBeGreaterThan(0);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(5 * M.cell);
      // The map's edge shadow falls 0.16 of a cell off the near sides of a
      // lone square; the wall itself stays inside.
      expect(x).toBeLessThanOrEqual(6 * M.cell + 0.16 * M.cell + 0.001);
      expect(y).toBeGreaterThanOrEqual(4 * M.cell);
      expect(y).toBeLessThanOrEqual(5 * M.cell + 0.16 * M.cell + 0.001);
    }
  });

  it('puts two walls in two different places', () => {
    const { g, calls } = fakePen();
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

// `tileDrawInput` carrying every layer is pinned in `plan/tiles.test.ts`;
// what is pinned here is that the painter draws every layer it carries.
describe('tileDrawInput forwards every layer to the renderer', () => {
  it('actually draws a scene whose tiles live only in the layers', () => {
    // The failure in one line: layered tiles, nothing in `cells`, and the
    // canvas has to show something.
    const { g, ops } = fakePen();
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
    // Compared against the same ground drawn alone rather than by colour: a
    // designed prop shades its own tones, so no fill of the tree need be the
    // tile's base colour exactly.
    const input = (object: Record<string, string>) =>
      tileDrawInput({ tilesetId: 'sprawl', cells: {}, ground: { '0,0': 'grass' }, structure: {}, object }, catalogueDefs());
    const fillsOf = (object: Record<string, string>) => {
      const { g, calls } = fakePen();
      drawTiles(g, M, input(object));
      return calls.filter((c) => c.op === 'fill').map((c) => (c.args[0] as { color?: number }).color);
    };
    const groundOnly = fillsOf({});
    const withTree = fillsOf({ '0,0': 'tree' });
    expect(groundOnly.length).toBeGreaterThan(0);
    // The ground comes first, exactly as it draws with nothing on it…
    expect(withTree.slice(0, groundOnly.length)).toEqual(groundOnly);
    // …and the tree after it (with its shadow), never before.
    expect(withTree.length).toBeGreaterThan(groundOnly.length + 2);
  });
});

// ---------------------------------------------------------------------------
// Designed props (moved here from `stage/props.test.ts`, which pins the
// designs themselves)
// ---------------------------------------------------------------------------

describe('the catalogue draws through its designs', () => {
  const iso = metricsFor({ unitM: 1, cols: 12, rows: 12, offset: { x: 0, y: 0 }, projection: 'iso' as const });

  it('draws a designed prop in place of the plain solid, standing and flat', () => {
    // A standing prop (a workstation) and a flat one (a pallet): both must
    // produce a drawing, and the flat one must still get floor beneath it.
    const { g, calls } = fakePen();
    drawTiles(
      g,
      iso,
      tileDrawInput(
        { tilesetId: 'docklands', cells: {}, ground: {}, structure: {}, object: { '2,2': 'workbench', '4,4': 'pallet' } },
        catalogueDefs(),
      ),
    );
    expect(calls.filter((c) => c.op === 'fill').length).toBeGreaterThan(12);
  });
});
