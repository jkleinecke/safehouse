/**
 * Re-skinning a floor in another set (`restyle.ts`): every square keeps what
 * it IS and takes the new set's version. Property-tested against the shipped
 * catalogue rather than pinned to ids, so an art revision does not fail a
 * test about the mapping.
 */
import { describe, expect, it } from 'vitest';
import { TILESETS, categoryOf, layerOf, restyleLayers, restyleTile, tilesetById } from '../src/index.js';

const dock = tilesetById('docklands')!;
const sprawl = tilesetById('sprawl')!;
const byId = (set: typeof dock, id: string) => set.tiles.find((t) => t.id === id)!;

describe('restyleTile', () => {
  it('keeps an id the new set has, and keeps the category otherwise', () => {
    expect(restyleTile(dock, sprawl, 'wall', { wallAdjacent: false, col: 0, row: 0 })?.id).toBe('wall');
    for (const t of dock.tiles) {
      const out = restyleTile(dock, sprawl, t.id, { wallAdjacent: false, col: 1, row: 1 });
      if (out) expect(categoryOf(out), `${t.id} → ${out.id}`).toBe(categoryOf(t));
    }
  });

  it('maps an opening to an opening and a solid wall to a solid wall', () => {
    const openings = dock.tiles.filter((t) => categoryOf(t) === 'building' && t.placement?.inWall === true);
    for (const o of openings) {
      const out = restyleTile(dock, sprawl, o.id, { wallAdjacent: false, col: 0, row: 0 });
      if (out) expect(out.placement?.inWall, `${o.id} → ${out.id}`).toBe(true);
    }
  });

  it('gives a prop the thing that fits the new ground', () => {
    const props = dock.tiles.filter((t) => categoryOf(t) === 'decoration');
    const ground = sprawl.tiles.find((t) => categoryOf(t) === 'ground')!.id;
    for (const p of props) {
      const out = restyleTile(dock, sprawl, p.id, { ground, wallAdjacent: false, col: 2, row: 3 });
      if (out) {
        const on = out.placement?.on;
        expect(on === undefined || on.length === 0 || on.includes(ground), `${p.id} → ${out.id}`).toBe(true);
      }
    }
  });
});

describe('restyleLayers', () => {
  it('redraws every layer, keeping walls and floors square for square', () => {
    const floorId = dock.tiles.find((t) => categoryOf(t) === 'ground')!.id;
    const layers = {
      ground: { '0,0': floorId, '1,0': floorId, '2,0': floorId },
      structure: { '0,0': 'wall', '1,0': 'door', '2,0': 'wall' },
      object: { '1,1': dock.tiles.find((t) => categoryOf(t) === 'interior')!.id },
    };
    const out = restyleLayers(dock, sprawl, layers);
    expect(Object.keys(out.ground)).toEqual(['0,0', '1,0', '2,0']);
    expect(Object.keys(out.structure)).toEqual(['0,0', '1,0', '2,0']);
    expect(byId(sprawl, out.structure['1,0']!).kind).toBe('door');
    for (const id of Object.values(out.ground)) expect(layerOf(byId(sprawl, id))).toBe('ground');
    for (const id of Object.values(out.structure)) expect(layerOf(byId(sprawl, id))).toBe('structure');
    for (const id of Object.values(out.object)) expect(layerOf(byId(sprawl, id))).toBe('object');
    expect(out.dropped).toBe(0);
  });

  it('round-trips a set onto itself unchanged', () => {
    for (const set of TILESETS) {
      const ground: Record<string, string> = {};
      const structure: Record<string, string> = {};
      const object: Record<string, string> = {};
      set.tiles.forEach((t, i) => {
        const key = `${i},0`;
        const layer = layerOf(t);
        if (layer === 'ground') ground[key] = t.id;
        else if (layer === 'structure') structure[key] = t.id;
        else object[key] = t.id;
      });
      const out = restyleLayers(set, set, { ground, structure, object });
      expect(out.ground, set.id).toEqual(ground);
      expect(out.structure, set.id).toEqual(structure);
      expect(out.object, set.id).toEqual(object);
      expect(out.dropped).toBe(0);
    }
  });
});
