/**
 * The multi-selection: what a box takes, and what moving, pasting and
 * deleting it send. The box rule is the GM's own — objects if there are any
 * in it, the floor if there are none.
 */
import { describe, expect, it } from 'vitest';
import type { Scene } from '@safehouse/contracts';
import {
  boxSelect,
  copySet,
  eraseBodies,
  moveBodies,
  moveSelection,
  pasteBodies,
  toggleObject,
} from './cellSelection.js';
import type { PaintBody } from './history.js';
import { pickPainted } from './paintedObjects.js';

function scene(
  ground: Record<string, string>,
  structure: Record<string, string> = {},
  object: Record<string, string> = {},
): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Dock',
    state: 'draft',
    grid: { unitM: 1, cols: 20, rows: 20, offset: { x: 0, y: 0 }, projection: 'topdown' as const },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    vision: { playersSeeOwnSight: false },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    fog: { regions: [], revealed: [], revealedShapes: [] },
    levels: [],
    mapAttachmentIds: [],
    tiles: { tilesetId: 'docklands', ground, structure, object, cells: {} },
  } as unknown as Scene;
}

const floor = (c0: number, r0: number, c1: number, r1: number) => {
  const g: Record<string, string> = {};
  for (let c = c0; c <= c1; c += 1) for (let r = r0; r <= r1; r += 1) g[`${c},${r}`] = 'floor';
  return g;
};

describe('what a box takes', () => {
  it('takes the objects in it and leaves the floor under them', () => {
    const s = scene(floor(0, 0, 5, 5), { '1,1': 'wall' }, { '2,2': 'crates' });
    const sel = boxSelect(s, 0, { col: 0, row: 0 }, { col: 3, row: 3 })!;
    expect(sel.cells.structure).toEqual(['1,1']);
    expect(sel.cells.object).toEqual(['2,2']);
    expect(sel.cells.ground).toEqual([]);
  });

  it('takes the floor when there is nothing standing in it', () => {
    const s = scene(floor(0, 0, 5, 5), { '9,9': 'wall' });
    const sel = boxSelect(s, 0, { col: 1, row: 1 }, { col: 2, row: 2 })!;
    expect(sel.cells.ground.sort()).toEqual(['1,1', '1,2', '2,1', '2,2']);
    expect(sel.cells.structure).toEqual([]);
  });

  it('takes nothing over bare map', () => {
    expect(boxSelect(scene({}), 0, { col: 0, row: 0 }, { col: 3, row: 3 })).toBeNull();
  });

  it('takes only the half of a wall that is inside it', () => {
    const s = scene({}, { '0,0': 'wall', '1,0': 'wall', '2,0': 'wall', '3,0': 'wall' });
    const sel = boxSelect(s, 0, { col: 2, row: 0 }, { col: 5, row: 1 })!;
    expect(sel.cells.structure.sort()).toEqual(['2,0', '3,0']);
  });
});

describe('acting on it', () => {
  it('moves each layer on its own, and never erases where it lands', () => {
    const s = scene({}, { '1,1': 'wall' }, { '2,1': 'crates' });
    const sel = boxSelect(s, 0, { col: 0, row: 0 }, { col: 3, row: 3 })!;
    const bodies = moveBodies(s, sel, 1, 0);
    const structure = bodies.find((b) => b.layer === 'structure')!;
    const object = bodies.find((b) => b.layer === 'object')!;
    expect(structure.paint).toEqual({ '2,1': 'wall' });
    expect(structure.erase).toEqual(['1,1']);
    expect(object.paint).toEqual({ '3,1': 'crates' });
    expect(object.erase).toEqual(['2,1']);
  });

  it('deletes each square from its own layer only', () => {
    const s = scene(floor(0, 0, 3, 3), { '1,1': 'wall' });
    const sel = boxSelect(s, 0, { col: 0, row: 0 }, { col: 3, row: 3 })!;
    const bodies = eraseBodies(s, sel);
    // The wall goes; the floor under it — never selected — stays.
    expect(bodies).toEqual([{ tilesetId: 'docklands', level: 0, layer: 'structure', paint: {}, erase: ['1,1'] }]);
  });

  it('copies relative to the corner and pastes wherever it is placed', () => {
    const s = scene(floor(4, 4, 5, 4));
    const sel = boxSelect(s, 0, { col: 4, row: 4 }, { col: 5, row: 4 })!;
    const clip = copySet(s, sel)!;
    expect(clip.w).toBe(2);
    expect(clip.h).toBe(1);
    const bodies = pasteBodies(clip, { col: 10, row: 2 }, 0, 'docklands');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.paint).toEqual({ '10,2': 'floor', '11,2': 'floor' });
    expect(bodies[0]!.erase).toEqual([]);
  });

  it('toggles a whole object in and out with Shift', () => {
    const s = scene({}, { '1,1': 'wall', '2,1': 'wall' }, { '5,5': 'crates' });
    const wall = pickPainted(s, 0, { col: 1, row: 1 })!;
    const crate = pickPainted(s, 0, { col: 5, row: 5 })!;
    const both = toggleObject(toggleObject(null, wall, 0), crate, 0)!;
    expect(both.cells.structure.sort()).toEqual(['1,1', '2,1']);
    expect(both.cells.object).toEqual(['5,5']);
    const crateOnly = toggleObject(both, wall, 0)!;
    expect(crateOnly.cells.structure).toEqual([]);
    expect(toggleObject(crateOnly, crate, 0)).toBeNull();
  });
});

describe('Ctrl+Shift', () => {
  it('takes the floor as well as what stands on it', () => {
    const s = scene(floor(0, 0, 3, 3), { '1,1': 'wall' });
    const sel = boxSelect(s, 0, { col: 0, row: 0 }, { col: 3, row: 3 }, true)!;
    expect(sel.cells.structure).toEqual(['1,1']);
    expect(sel.cells.ground).toHaveLength(16);
  });
});

describe('a selection of walls stretches, like one wall does', () => {
  /** Apply a move's structure body to a copy of the layer, the way the server would. */
  const apply = (structure: Record<string, string>, bodies: PaintBody[]) => {
    const out = { ...structure };
    for (const b of bodies.filter((x) => x.layer === 'structure')) {
      Object.assign(out, b.paint);
      for (const k of b.erase) delete out[k];
    }
    return Object.keys(out).sort();
  };
  /** A box of walls, cols c0..c1, rows r0..r1. */
  const walls = (c0: number, r0: number, c1: number, r1: number) => {
    const st: Record<string, string> = {};
    for (let c = c0; c <= c1; c += 1) {
      st[`${c},${r0}`] = 'wall';
      st[`${c},${r1}`] = 'wall';
    }
    for (let r = r0; r <= r1; r += 1) {
      st[`${c0},${r}`] = 'wall';
      st[`${c1},${r}`] = 'wall';
    }
    return st;
  };

  it('grows the room in both directions when its north-east corner is dragged out', () => {
    // A room at cols 2..6, rows 4..8; select its north and east walls.
    const st = walls(2, 4, 6, 8);
    const s = scene({}, st);
    const north = pickPainted(s, 0, { col: 4, row: 4 })!;
    const east = pickPainted(s, 0, { col: 6, row: 6 })!;
    const sel = toggleObject(toggleObject(null, north, 0), east, 0)!;
    // Up two, right two.
    const move = moveSelection(s, sel, 2, -2);
    // The same room, two squares wider and two taller: cols 2..8, rows 2..8.
    expect(apply(st, move.bodies)).toEqual(Object.keys(walls(2, 2, 8, 8)).sort());
  });

  it('slides parallel walls on their normal only, however the pointer wanders', () => {
    const st = walls(2, 4, 6, 8);
    const s = scene({}, st);
    const east = pickPainted(s, 0, { col: 6, row: 6 })!;
    const sel = toggleObject(null, east, 0)!;
    // Right two and down three: only the right counts for a vertical wall.
    const move = moveSelection(s, sel, 2, 3);
    expect(apply(st, move.bodies)).toEqual(Object.keys(walls(2, 4, 8, 8)).sort());
  });

  it('keeps hold of the moved walls, grown corners included', () => {
    const st = walls(2, 4, 6, 8);
    const s = scene({}, st);
    const east = pickPainted(s, 0, { col: 6, row: 6 })!;
    const move = moveSelection(s, toggleObject(null, east, 0)!, 2, 0);
    expect(move.sel.cells.structure.sort()).toEqual(['8,4', '8,5', '8,6', '8,7', '8,8']);
  });
});
