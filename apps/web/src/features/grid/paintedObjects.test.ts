/**
 * Painted objects: what a click picks up, and what a drag writes. The rule
 * with teeth is the server's order — paint, THEN erase — so an edit that
 * overlaps where it came from must never list the overlap in `erase`.
 */
import { describe, expect, it } from 'vitest';
import type { Scene } from '@safehouse/contracts';
import { applyEdit, handlesOf, pickPainted } from './paintedObjects.js';

function scene(structure: Record<string, string>, object: Record<string, string> = {}): Scene {
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
    tiles: { tilesetId: 'docklands', ground: {}, structure, object, cells: {} },
  } as unknown as Scene;
}

/** A horizontal wall from col 2 to col 6 on row 5, with a door at col 4. */
const ROOM = scene({ '2,5': 'wall', '3,5': 'wall', '4,5': 'door', '5,5': 'wall', '6,5': 'wall' });

describe('picking up', () => {
  it('reads a wall as its whole straight run, door and all', () => {
    const obj = pickPainted(ROOM, 0, { col: 3, row: 5 })!;
    expect(obj.role).toBe('wall');
    expect(obj.axis).toBe('h');
    expect(obj.cells).toEqual(['2,5', '3,5', '4,5', '5,5', '6,5']);
  });

  it('reads a door as just its door cells', () => {
    const obj = pickPainted(ROOM, 0, { col: 4, row: 5 })!;
    expect(obj.role).toBe('door');
    expect(obj.cells).toEqual(['4,5']);
  });

  it('prefers the furniture standing on a square over the wall behind it', () => {
    const s = scene({ '3,5': 'wall' }, { '3,5': 'crates', '4,5': 'crates' });
    const obj = pickPainted(s, 0, { col: 3, row: 5 })!;
    expect(obj.role).toBe('prop');
    expect(obj.cells.sort()).toEqual(['3,5', '4,5']);
  });

  it('finds nothing on bare floor', () => {
    expect(pickPainted(ROOM, 0, { col: 9, row: 9 })).toBeNull();
  });
});

describe('dragging', () => {
  it('slides a wall on its normal only, and never erases where it lands', () => {
    const wall = pickPainted(ROOM, 0, { col: 3, row: 5 })!;
    // Dragged down one and sideways three: only the down counts.
    const r = applyEdit(ROOM, 0, wall, { kind: 'slide' }, { col: 3, row: 5 }, { col: 6, row: 6 });
    expect(Object.keys(r.delta.paint).sort()).toEqual(['2,6', '3,6', '4,6', '5,6', '6,6']);
    expect(r.delta.paint['4,6']).toBe('door');
    expect(r.delta.erase.sort()).toEqual(['2,5', '3,5', '4,5', '5,5', '6,5']);
  });

  it('keeps the overlap out of erase when a prop moves one square', () => {
    const s = scene({}, { '3,3': 'crates', '4,3': 'crates' });
    const prop = pickPainted(s, 0, { col: 3, row: 3 })!;
    const r = applyEdit(s, 0, prop, { kind: 'move' }, { col: 3, row: 3 }, { col: 4, row: 3 });
    expect(Object.keys(r.delta.paint).sort()).toEqual(['4,3', '5,3']);
    // 4,3 is painted — the server paints first, so erasing it too would
    // take the crate back out of the square it just moved into.
    expect(r.delta.erase).toEqual(['3,3']);
  });

  it('stretches a wall from its end with the wall, not the door in it', () => {
    const wall = pickPainted(ROOM, 0, { col: 3, row: 5 })!;
    const r = applyEdit(ROOM, 0, wall, { kind: 'stretch', handle: 'end' }, { col: 7, row: 5 }, { col: 9, row: 5 });
    expect(r.delta.paint['7,5']).toBe('wall');
    expect(r.delta.paint['8,5']).toBe('wall');
    expect(r.delta.erase).toEqual([]);
  });

  it('gives a narrowed door its square back to the wall', () => {
    const s = scene({ '2,5': 'wall', '3,5': 'door', '4,5': 'door', '5,5': 'wall' });
    const door = pickPainted(s, 0, { col: 3, row: 5 })!;
    expect(door.cells).toEqual(['3,5', '4,5']);
    const r = applyEdit(s, 0, door, { kind: 'stretch', handle: 'end' }, { col: 5, row: 5 }, { col: 4, row: 5 });
    expect(r.delta.paint['4,5']).toBe('wall');
    expect(r.delta.erase).toEqual([]);
  });

  it('resizes a prop from its corner, and never below one square', () => {
    const s = scene({}, { '3,3': 'crates' });
    const prop = pickPainted(s, 0, { col: 3, row: 3 })!;
    const grow = applyEdit(s, 0, prop, { kind: 'resize' }, { col: 4, row: 4 }, { col: 5, row: 5 });
    expect(Object.keys(grow.delta.paint).sort()).toEqual(['3,3', '3,4', '4,3', '4,4']);
    const shrink = applyEdit(s, 0, prop, { kind: 'resize' }, { col: 4, row: 4 }, { col: 1, row: 1 });
    expect(Object.keys(shrink.delta.paint)).toEqual(['3,3']);
    expect(shrink.noop).toBe(true);
  });

  it('puts a run’s handles on its outer ends and a prop’s on its corner', () => {
    const wall = pickPainted(ROOM, 0, { col: 3, row: 5 })!;
    expect(handlesOf(wall).map((h) => h.at)).toEqual([
      { x: 2, y: 5.5 },
      { x: 7, y: 5.5 },
    ]);
    const s = scene({}, { '3,3': 'crates' });
    expect(handlesOf(pickPainted(s, 0, { col: 3, row: 3 })!).map((h) => h.at)).toEqual([{ x: 4, y: 4 }]);
  });

  describe('the walls it meets go with it', () => {
    /** A box: cols 0..4, rows 0..4, walls all round. */
    const box = () => {
      const st: Record<string, string> = {};
      for (let i = 0; i <= 4; i += 1) {
        st[`${i},0`] = 'wall';
        st[`${i},4`] = 'wall';
        st[`0,${i}`] = 'wall';
        st[`4,${i}`] = 'wall';
      }
      return scene(st);
    };

    it('grows the north and south walls when the east wall slides out', () => {
      const s = box();
      const east = pickPainted(s, 0, { col: 4, row: 2 })!;
      expect(east.axis).toBe('v');
      const r = applyEdit(s, 0, east, { kind: 'slide' }, { col: 4, row: 2 }, { col: 6, row: 2 });
      // The east wall itself, now at col 6.
      for (let row = 0; row <= 4; row += 1) expect(r.delta.paint[`6,${row}`]).toBe('wall');
      // North and south run on to meet it — including the old corners.
      for (const c of [4, 5]) {
        expect(r.delta.paint[`${c},0`]).toBe('wall');
        expect(r.delta.paint[`${c},4`]).toBe('wall');
      }
      // Only the old east wall's middle goes; its corners stayed as wall.
      expect(r.delta.erase.sort()).toEqual(['4,1', '4,2', '4,3']);
    });

    it('cuts the north and south walls back when it slides in', () => {
      const s = box();
      const east = pickPainted(s, 0, { col: 4, row: 2 })!;
      const r = applyEdit(s, 0, east, { kind: 'slide' }, { col: 4, row: 2 }, { col: 2, row: 2 });
      for (let row = 0; row <= 4; row += 1) expect(r.delta.paint[`2,${row}`]).toBe('wall');
      // The stubs that would poke past the new corner are gone.
      expect(r.delta.erase).toContain('3,0');
      expect(r.delta.erase).toContain('3,4');
      expect(r.delta.erase).not.toContain('2,0');
    });
  });
});
