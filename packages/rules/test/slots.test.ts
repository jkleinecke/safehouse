/**
 * Slots (`slots.ts`): one vocabulary every set speaks, so a set switch is a
 * render decision. The assignment is derived from catalogue order, which
 * makes that order part of the data contract — the pinned maps below fail
 * the moment a tile is inserted anywhere but the end of its category.
 */
import { describe, expect, it } from 'vitest';
import {
  TILESETS,
  migrateTileLayer,
  pickTile,
  resolveTile,
  slotOf,
  slotUniverse,
  slotsOf,
  tileById,
  tileBySlot,
  tilesetById,
  toSlot,
} from '../src/index.js';

const dock = tilesetById('docklands')!;
const corp = tilesetById('corp')!;
const sprawl = tilesetById('sprawl')!;

describe('slotsOf', () => {
  it('pins the docklands assignment', () => {
    expect(Object.fromEntries(slotsOf(dock))).toEqual({
      stairup: 'stairs/up',
      stairdown: 'stairs/down',
      floor: 'ground/1',
      stain: 'ground/2',
      grate: 'ground/3',
      lamp: 'ground/4',
      catwalk: 'ground/5',
      wall: 'building/wall',
      window: 'building/window',
      door: 'building/door',
      chainlink: 'building/4',
      crates: 'interior/1',
      rail: 'interior/2',
      shelving: 'interior/3',
      container: 'interior/4',
      forklift: 'interior/5',
      workbench: 'interior/6',
      lockers: 'interior/7',
      spool: 'interior/8',
      pillar: 'interior/9',
      barrel: 'decoration/1',
      puddle: 'decoration/2',
      worklight: 'decoration/3',
      pallet: 'decoration/4',
    });
  });

  it('pins the corporate assignment, where the see-through door is an extra', () => {
    const s = Object.fromEntries(slotsOf(corp));
    expect(s['wall']).toBe('building/wall');
    expect(s['glass']).toBe('building/window');
    expect(s['door']).toBe('building/door');
    expect(s['glassdoor']).toBe('building/4');
    expect(s['carpet']).toBe('ground/1');
    expect(s['desk']).toBe('interior/1');
    expect(s['plant']).toBe('decoration/1');
  });

  it('gives every set the three building roles, both stairs, and contiguous numbering', () => {
    for (const set of TILESETS) {
      const slots = [...slotsOf(set).values()];
      expect(new Set(slots).size, set.id).toBe(slots.length);
      for (const role of ['building/wall', 'building/window', 'building/door', 'stairs/up', 'stairs/down']) {
        expect(slots, `${set.id} ${role}`).toContain(role);
      }
      for (const cat of ['ground', 'interior', 'decoration']) {
        const nums = slots.filter((s) => s.startsWith(`${cat}/`)).map((s) => Number(s.split('/')[1])).sort((a, b) => a - b);
        expect(nums, `${set.id} ${cat}`).toEqual(nums.map((_, i) => i + 1));
      }
    }
  });
});

describe('tileBySlot and resolveTile', () => {
  it('answers a slot with the set’s own tile, and a missing number with the nearest', () => {
    expect(tileBySlot(dock, 'ground/2')?.id).toBe('stain');
    expect(tileBySlot(corp, 'ground/2')?.id).toBe('lobby');
    // Corp has three decorations; the docklands' fourth wraps onto its first.
    expect(tileBySlot(corp, 'decoration/4')?.id).toBe('plant');
    // Sprawl has seven grounds; a fifth ground on a three-ground set wraps.
    expect(tileBySlot(tilesetById('club')!, 'ground/5')?.id).toBe('bar');
    expect(tileBySlot(dock, 'stairs/down')?.id).toBe('stairdown');
    expect(tileBySlot(dock, 'nonsense')).toBeNull();
    expect(tileBySlot(dock, 'kitchen/1')).toBeNull();
  });

  it('resolves an id or a slot, and turns either into a slot', () => {
    expect(resolveTile(dock, 'wall')?.id).toBe('wall');
    expect(resolveTile(dock, 'building/wall')?.id).toBe('wall');
    expect(resolveTile(sprawl, 'building/window')?.id).toBe('window');
    expect(resolveTile(dock, 'no-such')).toBeNull();
    expect(toSlot(dock, 'door')).toBe('building/door');
    expect(toSlot(dock, 'building/door')).toBe('building/door');
    expect(slotOf(dock, 'crates')).toBe('interior/1');
    expect(tileById('docklands', 'interior/1')?.id).toBe('crates');
    expect(tileById('corp', 'interior/1')?.id).toBe('desk');
  });

  it('every slot in the universe renders as something in every set', () => {
    for (const slot of slotUniverse(TILESETS)) {
      for (const set of TILESETS) expect(tileBySlot(set, slot), `${set.id} ${slot}`).not.toBeNull();
    }
  });
});

describe('the same square in another set', () => {
  it('a floor painted in docklands reads as the corporate set’s same slots, doors and all', () => {
    const layers = migrateTileLayer({
      tilesetId: 'docklands',
      ground: { '1,1': 'floor', '2,1': 'stain' },
      structure: { '2,1': 'door', '3,1': 'window' },
      object: { '1,1': 'crates' },
      doors: { '2,1': { open: false, locked: true } },
    });
    expect(layers.ground).toEqual({ '1,1': 'ground/1', '2,1': 'ground/2' });
    expect(layers.structure).toEqual({ '2,1': 'building/door', '3,1': 'building/window' });
    expect(layers.object).toEqual({ '1,1': 'interior/1' });
    expect(layers.doors).toEqual({ '2,1': { open: false, locked: true } });
    // The same layers under the corporate set: nothing to convert.
    expect(tileById('corp', layers.structure['2,1']!)?.kind).toBe('door');
    expect(tileById('corp', layers.ground['2,1']!)?.id).toBe('lobby');
    expect(tileById('corp', layers.object['1,1']!)?.id).toBe('desk');
  });

  it('placement reads a slot as the set’s own tile, so a second pass still advances', () => {
    const first = pickTile('ground', { tileset: dock, here: {}, wallAdjacent: false, col: 1, row: 1 })!;
    const second = pickTile('ground', { tileset: dock, here: { ground: 'ground/1' }, wallAdjacent: false, col: 1, row: 1 })!;
    expect(first.tileId).toBe('floor');
    expect(second.tileId).toBe('stain');
    const building = pickTile('building', { tileset: dock, here: { structure: 'building/wall' }, wallAdjacent: false, col: 1, row: 1 })!;
    expect(building.tileId).toBe('window');
  });
});
