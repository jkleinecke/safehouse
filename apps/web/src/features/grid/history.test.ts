/**
 * Undo and redo for the builder: the store's order and scoping, and the pure
 * inverses. The requests themselves are exercised in the browser walkthrough.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scene } from '@safehouse/contracts';
import {
  describeGeometry,
  describePaint,
  describeScenePatch,
  historyFor,
  restoreBodies,
  snapshotBefore,
  useHistory,
  type HistoryEntry,
} from './history.js';

vi.mock('../../api/client.js', () => ({
  apiPatch: vi.fn(async () => ({})),
  apiPost: vi.fn(async () => ({})),
  queryClient: { invalidateQueries: vi.fn(async () => undefined) },
}));

const h = () => useHistory.getState();
function entry(sceneId: string, label: string, log: string[]): HistoryEntry {
  return {
    sceneId,
    label,
    undo: async () => {
      log.push(`undo ${label}`);
    },
    redo: async () => {
      log.push(`redo ${label}`);
    },
  };
}

beforeEach(() => h().clear());

describe('the history store', () => {
  it('undoes the last thing, redoes it back, and forgets the future on a new edit', async () => {
    const log: string[] = [];
    h().push(entry('s1', 'a', log));
    h().push(entry('s1', 'b', log));
    await h().undo();
    expect(log).toEqual(['undo b']);
    expect(historyFor('s1').undo?.label).toBe('a');
    expect(historyFor('s1').redo?.label).toBe('b');
    await h().redo();
    expect(log).toEqual(['undo b', 'redo b']);
    await h().undo();
    h().push(entry('s1', 'c', log));
    expect(historyFor('s1').redo).toBeNull();
    expect(h().past.map((e) => e.label)).toEqual(['a', 'c']);
  });

  it('offers only the scene on screen its own steps', () => {
    const log: string[] = [];
    h().push(entry('s1', 'a', log));
    h().push(entry('s2', 'b', log));
    expect(historyFor('s1').undo).toBeNull();
    expect(historyFor('s2').undo?.label).toBe('b');
  });

  it('folds a group into one step, undone back to front', async () => {
    const log: string[] = [];
    h().beginGroup('s1', 'draw a room');
    h().push(entry('s1', 'floor', log));
    h().push(entry('s1', 'walls', log));
    h().endGroup();
    expect(h().past.map((e) => e.label)).toEqual(['draw a room']);
    await h().undo();
    expect(log).toEqual(['undo walls', 'undo floor']);
    await h().redo();
    expect(log).toEqual(['undo walls', 'undo floor', 'redo floor', 'redo walls']);
  });

  it('puts a step back when its request fails, so it can be tried again', async () => {
    h().push({ sceneId: 's1', label: 'x', undo: async () => { throw new Error('offline'); }, redo: async () => undefined });
    await h().undo();
    expect(historyFor('s1').undo?.label).toBe('x');
    expect(h().busy).toBe(false);
  });
});

const SCENE = {
  id: 's1',
  tiles: {
    tilesetId: 'docklands',
    cells: {},
    ground: { '1,1': 'floor', '2,1': 'floor', '3,1': 'stain' },
    structure: { '2,1': 'wall' },
    object: { '3,1': 'crates' },
  },
  levels: [],
  geometry: { walls: [], doors: [], zones: [], pins: [] },
} as unknown as Scene;

describe('the inverses', () => {
  it('snapshots what the touched squares held, empty squares included', () => {
    const before = snapshotBefore(SCENE, { tilesetId: 'docklands', paint: { '2,1': 'door', '9,9': 'floor' }, erase: ['3,1'] });
    expect(before).toEqual({
      '2,1': { ground: 'floor', structure: 'wall' },
      '9,9': {},
      '3,1': { ground: 'stain', object: 'crates' },
    });
  });

  it('a clear touches every painted square of the floor', () => {
    const before = snapshotBefore(SCENE, { tilesetId: 'docklands', paint: {}, erase: [], clear: true });
    expect(Object.keys(before).sort()).toEqual(['1,1', '2,1', '3,1']);
    const objectsOnly = snapshotBefore(SCENE, { tilesetId: 'docklands', paint: {}, erase: [], clear: true, layer: 'object' });
    expect(Object.keys(objectsOnly)).toEqual(['3,1']);
  });

  it('restores by erasing, then repainting one layer at a time', () => {
    const bodies = restoreBodies(
      { '2,1': { ground: 'floor', structure: 'wall' }, '9,9': {}, '3,1': { ground: 'stain', object: 'crates' } },
      'docklands',
      0,
    );
    expect(bodies[0]).toEqual({ tilesetId: 'docklands', paint: {}, erase: ['2,1', '9,9', '3,1'], level: 0 });
    expect(bodies[1]?.paint).toEqual({ '2,1': 'floor', '3,1': 'stain' });
    expect(bodies[2]?.paint).toEqual({ '2,1': 'wall' });
    expect(bodies[3]?.paint).toEqual({ '3,1': 'crates' });
    expect(restoreBodies({}, 'docklands', 0)).toEqual([]);
  });

  it('says what a stroke did in the GM’s words', () => {
    expect(describePaint({ tilesetId: 'd', paint: { a: 'x' }, erase: [] })).toBe('paint 1 square');
    expect(describePaint({ tilesetId: 'd', paint: {}, erase: ['a', 'b'] })).toBe('erase 2 squares');
    expect(describePaint({ tilesetId: 'd', paint: {}, erase: [], clear: true })).toBe('clear the floor');
    expect(describePaint({ tilesetId: 'd', paint: {}, erase: [], clear: true, layer: 'object' })).toBe('clear the object layer');
  });

  it('says what a geometry patch did', () => {
    const g = (over: Partial<Scene['geometry']>) => ({ walls: [], doors: [], zones: [], pins: [], ...over }) as Scene['geometry'];
    const w = { id: 'w1', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
    expect(describeGeometry(g({}), g({ walls: [w] }))).toBe('draw a wall');
    expect(describeGeometry(g({ walls: [w] }), g({}))).toBe('delete a wall');
    expect(describeGeometry(g({ walls: [w] }), g({ walls: [{ ...w, b: { x: 2, y: 0 } }] }))).toBe('edit a wall');
    expect(describeGeometry(g({}), g({ pins: [{ id: 'p', at: { x: 1, y: 1 }, visibility: 'gm' }, { id: 'q', at: { x: 2, y: 2 }, visibility: 'gm' }] }))).toBe('draw 2 pins');
    expect(describeGeometry(g({}), g({}))).toBe('edit the map');
    expect(describeScenePatch({ grid: {} })).toBe('calibrate the grid');
  });
});
