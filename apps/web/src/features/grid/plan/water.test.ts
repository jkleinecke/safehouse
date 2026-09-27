/**
 * A floor's water is a body of water, not a floor with waves on it (FR9.2).
 *
 * What is pinned here is what made the old water look like forty framed
 * pictures of water: that a square knows its neighbours. Distance from the
 * shore is real, water shelves toward it, a reed bed stands in the water
 * beside it, two tiles of water beside each other are one body — and a stroke
 * three squares from the water still re-signs the water it changed. How the
 * palette's painter draws all this is tested beside it
 * (`gm/art/waterArt.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { TILESETS } from '@safehouse/rules';
import { tileDefKey, tileDefsFromSets, type TileDrawDef } from '../types.js';
import { cellSignatures } from './tiles.js';
import { mapWater, type WaterEntry } from './water.js';

const defs = tileDefsFromSets(TILESETS);
const def = (set: string, id: string): TileDrawDef => {
  const d = defs[tileDefKey(set, id)];
  if (!d) throw new Error(`no ${set}/${id}`);
  return d;
};
const HARBOUR = def('marina', 'harbour');
const SHALLOWS = def('marina', 'shallows');
const QUAY = def('marina', 'quay');
const BEACH = def('marina', 'beach');
const PIERWALL = def('marina', 'pierwall');
const REEDS = def('lake', 'reeds');
const DEEP = def('lake', 'deep');

/** Squares of one tile over a rectangle, as plan entries. */
function area(c0: number, r0: number, c1: number, r1: number, d: TileDrawDef): WaterEntry[] {
  const out: WaterEntry[] = [];
  for (let col = c0; col <= c1; col += 1) for (let row = r0; row <= r1; row += 1) out.push({ col, row, def: d, layer: 0 });
  return out;
}

/** Later entries win a square, as painting over does. */
const floor = (...parts: WaterEntry[][]) => parts.flat();

describe('the water knows where the shore is', () => {
  it('measures distance from the land, square by square, and not from the edge of the map', () => {
    // Quay along row 0, water below it, running off the bottom of the map.
    const map = mapWater(floor(area(0, 1, 5, 7, HARBOUR), area(0, 0, 5, 0, QUAY)));
    expect(map.water.get('2,1')!.dist).toBe(1);
    expect(map.water.get('2,2')!.dist).toBe(2);
    expect(map.water.get('2,3')!.dist).toBe(3);
    // The map's own edge is not a shore: water running off it stays open.
    expect(map.water.get('0,5')!.dist).toBe(map.water.get('3,5')!.dist);
    expect(map.water.get('3,7')!.dist).toBeGreaterThan(3);
  });

  it('shelves: water is lighter by the shore than out in the open', () => {
    const map = mapWater(floor(area(0, 1, 5, 7, HARBOUR), area(0, 0, 5, 0, QUAY)));
    const v = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff);
    expect(v(map.water.get('2,1')!.surface)).toBeGreaterThan(v(map.water.get('2,2')!.surface));
    expect(v(map.water.get('2,2')!.surface)).toBeGreaterThan(v(map.water.get('2,6')!.surface));
  });

  it('stands a reed bed in the water beside it rather than painting green water', () => {
    const map = mapWater(floor(area(0, 0, 6, 6, DEEP), area(3, 3, 3, 3, REEDS)));
    const reed = map.water.get('3,3')!;
    const open = map.water.get('2,3')!;
    // The reeds' own palette is green; the water it stands in is the lake's.
    expect(reed.deep).toBe(open.deep);
  });

  it('blends a deep tile into a shallows tile beside it', () => {
    const map = mapWater(floor(area(0, 0, 3, 6, HARBOUR), area(4, 0, 7, 6, SHALLOWS)));
    const a = map.water.get('3,3')!.deep;
    const b = map.water.get('4,3')!.deep;
    const far = map.water.get('0,3')!.deep;
    // Either side of the join is closer to the other than open harbour is.
    expect(Math.abs((a & 0xff) - (b & 0xff))).toBeLessThan(Math.abs((far & 0xff) - (b & 0xff)));
  });
});

describe('the chunk diff sees water change from a distance', () => {
  it('re-signs a square of water when land is painted three squares away', () => {
    const base = { tilesetId: 'marina', structure: {}, object: {}, defs };
    const water: Record<string, string> = {};
    for (let c = 0; c < 8; c += 1) water[`${c},0`] = 'harbour';
    const before = cellSignatures({ ...base, ground: water });
    const after = cellSignatures({ ...base, ground: { ...water, '0,0': 'quay' } });
    // Square 3 is three squares from the new quay: its colour moved, so its
    // signature must — even though the dirty rule only reaches one square.
    expect(after.get('3,0')).not.toBe(before.get('3,0'));
  });

  it('re-signs the water beside a shore that changes kind', () => {
    const base = { tilesetId: 'marina', structure: {}, object: {}, defs };
    const ground = { '0,0': 'quay', '0,1': 'harbour', '1,1': 'harbour' };
    const quay = cellSignatures({ ...base, ground });
    const beach = cellSignatures({ ...base, ground: { ...ground, '0,0': 'beach' } });
    expect(beach.get('1,1')).not.toBe(quay.get('1,1'));
  });

  it('leaves a dry floor’s signatures exactly as they were', () => {
    const base = { tilesetId: 'marina', structure: {}, object: {}, defs };
    const sig = cellSignatures({ ...base, ground: { '0,0': 'quay', '1,0': 'planking' } });
    expect(sig.get('0,0')).toBe('g=quay;');
  });
});

describe('the catalogue reaches the painter', () => {
  it('carries liquid and shore through the palette', () => {
    expect(HARBOUR.liquid).toBe('deep');
    expect(SHALLOWS.liquid).toBe('shallow');
    expect(QUAY.shore).toBe('quay');
    expect(PIERWALL.shore).toBe('pier');
    expect(BEACH.shore).toBe('beach');
    for (const set of ['marina', 'park', 'lake']) {
      expect(def(set, 'beach').shore, set).toBe('beach');
      expect(def(set, 'pierwall').shore, set).toBe('pier');
    }
  });
});
