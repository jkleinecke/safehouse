/**
 * Doors and windows draw as doors and windows (FR9.2).
 *
 * Two things are pinned. Every design in the catalogue's `TILE_CUTS` draws
 * SOMETHING in both projections — a design added to the list without a
 * drawing is the plain slab this exists to replace, and the `never` guard
 * only catches it at compile time in the switch, not a case that draws
 * nothing. And a door standing open draws open. The run rule — adjacent
 * cells of one opening draw once, from the last cell — belongs to the plan
 * and is pinned there (`plan/tiles.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { TILE_CUTS } from '@safehouse/rules';
import { metricsFor } from '../../geometry.js';
import type { CutRun } from '../../plan/tiles.js';
import type { ArtPen } from './canvasPen.js';
import { drawCut } from './cutArt.js';

const iso = metricsFor({ unitM: 1, cols: 12, rows: 12, offset: { x: 0, y: 0 }, projection: 'iso' as const });
const plan = metricsFor({ unitM: 1, cols: 12, rows: 12, offset: { x: 0, y: 0 }, projection: 'topdown' as const });

/** A pen that only counts the calls made on it. */
function counting(): { g: ArtPen; ops: number } {
  const state = { ops: 0 };
  const g: Record<string, unknown> = {};
  for (const op of ['clear', 'beginPath', 'fill', 'moveTo', 'lineTo', 'stroke', 'circle', 'ellipse', 'closePath']) {
    g[op] = () => {
      state.ops += 1;
      return g;
    };
  }
  return {
    g: g as unknown as ArtPen,
    get ops() {
      return state.ops;
    },
  };
}

const TONES = { base: 0x74644e, accent: 0x8b7760, light: 0x9c8a70, dark: 0x5f5240, ink: 0x463c2f };
const RUN: CutRun = { rect: [3, 4.333, 5, 4.667], axis: 'x', n: 2 };

describe('an open door draws open (FR9.24)', () => {
  const doors = ['door', 'maglock', 'porthole', 'glassdoor', 'roller', 'shutter', 'hatch'] as const;

  it('every door design draws differently open than shut, in both projections', () => {
    for (const cut of doors) {
      for (const [m, rise] of [[iso, 32], [plan, 0]] as const) {
        const shut = counting();
        drawCut(shut.g, m, cut, RUN, rise, TONES, undefined, [false, false]);
        const open = counting();
        drawCut(open.g, m, cut, RUN, rise, TONES, undefined, [true, true]);
        expect(open.ops, `${cut} ${rise ? 'elevation' : 'plan'}`).toBeGreaterThan(3);
        expect(open.ops, `${cut} ${rise ? 'elevation' : 'plan'} unchanged`).not.toBe(shut.ops);
      }
    }
  });

  it('a double door with one leaf open is neither shut nor open — it is half', () => {
    const shut = counting();
    drawCut(shut.g, iso, 'door', RUN, 32, TONES, undefined, []);
    const half = counting();
    drawCut(half.g, iso, 'door', RUN, 32, TONES, undefined, [true, false]);
    const wide = counting();
    drawCut(wide.g, iso, 'door', RUN, 32, TONES, undefined, [true, true]);
    expect(new Set([shut.ops, half.ops, wide.ops]).size).toBe(3);
  });

  it('a window cannot be open: the flag changes nothing that is not a door', () => {
    const a = counting();
    drawCut(a.g, iso, 'glass', RUN, 32, TONES, undefined, []);
    const b = counting();
    drawCut(b.g, iso, 'glass', RUN, 32, TONES, undefined, [true, true]);
    expect(b.ops).toBe(a.ops);
  });
});

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
});
