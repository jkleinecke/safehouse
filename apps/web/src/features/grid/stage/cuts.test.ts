/**
 * Doors and windows draw as doors and windows (FR9.2).
 *
 * Two things are pinned. Every design in the catalogue's `TILE_CUTS` draws
 * SOMETHING in both projections — a design added to the list without a
 * drawing is the plain slab this exists to replace, and the `never` guard
 * only catches it at compile time in the switch, not a case that draws
 * nothing. And the run rule: adjacent cells of one opening draw once, from
 * the last cell, and a change anywhere along the run dirties all of it.
 */
import { describe, expect, it } from 'vitest';
import type { Graphics } from 'pixi.js';
import { TILESETS, TILE_CUTS } from '@safehouse/rules';
import { metricsFor } from '../geometry.js';
import { tileDefKey, tileDefsFromSets } from '../types.js';
import { drawCut, type CutRun } from './cuts.js';
import { cutOf, cutRunFor, expandCutRuns, planTiles, type TileDrawInput } from './tileLayer.js';

const iso = metricsFor({ unitM: 1, cols: 12, rows: 12, offset: { x: 0, y: 0 }, projection: 'iso' as const });
const plan = metricsFor({ unitM: 1, cols: 12, rows: 12, offset: { x: 0, y: 0 }, projection: 'topdown' as const });

function counting(): { g: Graphics; ops: number } {
  const state = { ops: 0 };
  const g: Record<string, unknown> = {};
  for (const op of ['clear', 'rect', 'fill', 'moveTo', 'lineTo', 'stroke', 'circle', 'ellipse', 'closePath']) {
    g[op] = () => {
      state.ops += 1;
      return g;
    };
  }
  return {
    g: g as unknown as Graphics,
    get ops() {
      return state.ops;
    },
  };
}

const TONES = { base: 0x74644e, accent: 0x8b7760, light: 0x9c8a70, dark: 0x5f5240, ink: 0x463c2f };
const RUN: CutRun = { rect: [3, 4.333, 5, 4.667], axis: 'x', n: 2 };

describe('every cut design draws', () => {
  for (const cut of TILE_CUTS) {
    it(`${cut} draws an elevation and a plan symbol`, () => {
      const a = counting();
      drawCut(a.g, iso, cut, RUN, 32, TONES, cut === 'sign' ? '#fa25ac' : undefined);
      expect(a.ops, `${cut} elevation`).toBeGreaterThan(3);
      const b = counting();
      drawCut(b.g, plan, cut, RUN, 0, TONES, undefined);
      expect(b.ops, `${cut} symbol`).toBeGreaterThan(3);
    });
  }

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
