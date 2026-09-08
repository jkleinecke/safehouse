/**
 * Furniture and props draw as furniture and props (FR9.2).
 *
 * Pinned: every design in the catalogue's `TILE_PROPS` builds SOMETHING in
 * both projections — the record type catches a missing design at compile
 * time, not one that draws nothing — and a design keeps to its own cell, so
 * a sofa never paints over the chair next door. The lights: a design used by
 * a light tile hands the light pass a face, and one used by no light gives
 * nothing back, because a glow with no fixture is a floor tile pretending.
 */
import { describe, expect, it } from 'vitest';
import type { Graphics } from 'pixi.js';
import { TILESETS, TILE_PROPS, type TileProp } from '@safehouse/rules';
import { metricsFor } from '../geometry.js';
import { tileDefKey, tileDefsFromSets } from '../types.js';
import { drawProp, propFootprint } from './props.js';
import { drawTiles, tileDrawInput } from './tileLayer.js';

const iso = metricsFor({ unitM: 1, cols: 12, rows: 12, offset: { x: 0, y: 0 }, projection: 'iso' as const });
const plan = metricsFor({ unitM: 1, cols: 12, rows: 12, offset: { x: 0, y: 0 }, projection: 'topdown' as const });

interface Call {
  op: string;
  args: unknown[];
}

function counting(): { g: Graphics; calls: Call[] } {
  const calls: Call[] = [];
  const g: Record<string, unknown> = {};
  for (const op of ['clear', 'rect', 'fill', 'moveTo', 'lineTo', 'stroke', 'circle', 'ellipse', 'closePath']) {
    g[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return g;
    };
  }
  return { g: g as unknown as Graphics, calls };
}

const TONES = { base: 0x74644e, accent: 0x8b7760, light: 0x9c8a70, dark: 0x5f5240, ink: 0x463c2f };
const UNIT_ISO = iso.cell * 0.5;

/** Every point the drawing touched, from moveTo/lineTo/ellipse centres. */
function touched(calls: readonly Call[]): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (const c of calls) {
    if (c.op === 'moveTo' || c.op === 'lineTo' || c.op === 'ellipse') {
      pts.push({ x: c.args[0] as number, y: c.args[1] as number });
    }
  }
  return pts;
}

describe('every prop design draws', () => {
  for (const prop of TILE_PROPS) {
    it(`${prop} builds a silhouette in isometric and a symbol in plan`, () => {
      const a = counting();
      drawProp(a.g, iso, prop, 3, 4, 0.5, UNIT_ISO, TONES, 7, null);
      expect(a.calls.filter((c) => c.op === 'fill').length, `${prop} in iso`).toBeGreaterThan(2);
      const b = counting();
      drawProp(b.g, plan, prop, 3, 4, 0.5, 0, TONES, 7, null);
      expect(b.calls.filter((c) => c.op === 'fill').length, `${prop} in plan`).toBeGreaterThan(0);
    });

    it(`${prop} stays inside its own cell in plan`, () => {
      // Plan has no height to lean into, so every point a design touches
      // must fall within the cell's own diamond-free square, with a small
      // allowance for stroke width. A design that leaks paints the neighbour.
      const c = counting();
      drawProp(c.g, plan, prop, 3, 4, 1, 0, TONES, 7, null);
      const x0 = 3 * plan.cell;
      const y0 = 4 * plan.cell;
      for (const p of touched(c.calls)) {
        expect(p.x, `${prop} x`).toBeGreaterThanOrEqual(x0 - 2);
        expect(p.x, `${prop} x`).toBeLessThanOrEqual(x0 + plan.cell + 2);
        expect(p.y, `${prop} y`).toBeGreaterThanOrEqual(y0 - 2);
        expect(p.y, `${prop} y`).toBeLessThanOrEqual(y0 + plan.cell + 2);
      }
    });

    it(`${prop} declares a footprint inside the cell`, () => {
      const [u0, v0, u1, v1] = propFootprint(prop, 0, 0);
      expect(u0).toBeGreaterThanOrEqual(0);
      expect(v0).toBeGreaterThanOrEqual(0);
      expect(u1).toBeLessThanOrEqual(1);
      expect(v1).toBeLessThanOrEqual(1);
      expect(u1 - u0).toBeGreaterThan(0.1);
      expect(v1 - v0).toBeGreaterThan(0.1);
    });
  }

  it('is deterministic: the same cell draws the same prop every time', () => {
    const a = counting();
    const b = counting();
    drawProp(a.g, iso, 'tree', 5, 5, 1, UNIT_ISO, TONES, 99, null);
    drawProp(b.g, iso, 'tree', 5, 5, 1, UNIT_ISO, TONES, 99, null);
    expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
    // …and a different cell is a different tree.
    const c = counting();
    drawProp(c.g, iso, 'tree', 6, 5, 1, UNIT_ISO, TONES, 100, null);
    expect(JSON.stringify(c.calls)).not.toBe(JSON.stringify(a.calls));
  });
});

describe('lights are fixtures', () => {
  const litDesigns = new Set<TileProp>();
  const darkDesigns = new Set<TileProp>();
  for (const set of TILESETS) {
    for (const t of set.tiles) {
      if (t.prop === undefined) continue;
      (t.emissive !== undefined ? litDesigns : darkDesigns).add(t.prop);
    }
  }

  it('a design the catalogue lights hands the light pass a face', () => {
    expect(litDesigns.size).toBeGreaterThan(4);
    for (const prop of litDesigns) {
      const c = counting();
      const face = drawProp(c.g, iso, prop, 2, 2, 1, UNIT_ISO, TONES, 1, 0xffb347);
      expect(face, `${prop} gives off light but has no fixture`).not.toBeNull();
      expect(face!.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives nothing back when the tile is not a light', () => {
    for (const prop of TILE_PROPS) {
      const c = counting();
      expect(drawProp(c.g, iso, prop, 2, 2, 1, UNIT_ISO, TONES, 1, null), prop).toBeNull();
    }
  });
});

describe('the catalogue draws through its designs', () => {
  const defs = tileDefsFromSets(TILESETS);

  it('carries every prop design into the palette', () => {
    for (const set of TILESETS) {
      for (const t of set.tiles) {
        if (t.prop === undefined) continue;
        expect(defs[tileDefKey(set.id, t.id)]?.prop, `${set.id}/${t.id}`).toBe(t.prop);
      }
    }
  });

  it('draws a designed prop in place of the plain solid, standing and flat', () => {
    // A standing prop (a workstation) and a flat one (a pallet): both must
    // produce a drawing, and the flat one must still get floor beneath it.
    const g = counting();
    drawTiles(
      g.g,
      iso,
      tileDrawInput(
        { tilesetId: 'docklands', cells: {}, ground: {}, structure: {}, object: { '2,2': 'workbench', '4,4': 'pallet' } },
        defs,
      ),
    );
    expect(g.calls.filter((c) => c.op === 'fill').length).toBeGreaterThan(12);
  });
});
