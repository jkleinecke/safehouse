/**
 * The chat's floor drawing (fixer/chat/floor-draft.ts): what an edit tells
 * the panel to paint, and the picture the model checks its work against.
 */
import { describe, expect, it } from 'vitest';
import { tilesetById } from '@safehouse/rules';
import { compileFloorPlan } from '../src/fixer/floor-plan.js';
import { diffFloor, floorPicture } from '../src/fixer/chat/floor-draft.js';

const dock = tilesetById('docklands')!;
const GRID = { cols: 12, rows: 8 };
const empty = { ground: {}, structure: {}, object: {} };

describe('diffFloor', () => {
  it('paints everything on the first edit', () => {
    const d = diffFloor(null, { ground: { '0,0': 'ground/1' }, structure: { '1,1': 'building/wall' }, object: {} }, undefined);
    expect(d.ground.paint).toEqual({ '0,0': 'ground/1' });
    expect(d.structure.paint).toEqual({ '1,1': 'building/wall' });
    expect(d.ground.erase).toEqual([]);
  });

  it('sends only what changed when the map holds the last edit', () => {
    const before = { ...empty, structure: { '1,1': 'building/wall', '2,1': 'building/wall' } };
    const after = { ...empty, structure: { '1,1': 'building/wall', '3,1': 'building/wall' } };
    const d = diffFloor(before, after, { structure: before.structure });
    expect(d.structure.paint).toEqual({ '3,1': 'building/wall' });
    expect(d.structure.erase).toEqual(['2,1']);
  });

  it('paints again what the map lost — the GM undid it — but not what the GM painted over', () => {
    const before = { ...empty, object: { '2,2': 'interior/1', '3,3': 'interior/2' } };
    const d = diffFloor(before, before, { object: { '3,3': 'interior/9' } });
    expect(d.object.paint).toEqual({ '2,2': 'interior/1' });
    expect(d.object.erase).toEqual([]);
  });

  it('leaves a square the GM repainted when the drawing drops it', () => {
    const before = { ...empty, object: { '2,2': 'interior/1', '4,4': 'interior/1' } };
    const d = diffFloor(before, empty, { object: { '2,2': 'interior/7', '4,4': 'interior/1' } });
    expect(d.object.erase).toEqual(['4,4']);
  });
});

describe('floorPicture', () => {
  it('draws rooms, walls and doors on a numbered grid, with a legend', () => {
    const floor = compileFloorPlan(
      {
        title: 'Shed',
        rooms: [{ name: 'shed', kind: 'room', x: 1, y: 1, w: 5, h: 4 }],
        openings: [{ room: 'shed', wall: 's', offset: 2 }],
      },
      GRID,
      dock,
      { draft: true },
    );
    const pic = floorPicture(floor, GRID, dock);
    const rows = pic.split('\n');
    expect(rows[3]).toBe('0 ............');
    expect(rows[4]).toBe('1 .#####......');
    expect(rows[5]).toBe('2 .#AAA#......');
    expect(rows[7]).toBe('4 .##D##......');
    expect(pic).toContain('A = shed (room) 5x4 at 1,1; floor x 2..4, y 2..3');
  });

  it('draws a started floor with no rooms, and adds no furniture of its own', () => {
    const floor = compileFloorPlan({ title: 'Lot', rooms: [] }, GRID, dock, { draft: true });
    expect(floor.warnings).toEqual([]);
    expect(Object.keys(floor.layers.object)).toHaveLength(0);
    expect(floorPicture(floor, GRID, dock)).toContain('No rooms yet.');
  });
});
