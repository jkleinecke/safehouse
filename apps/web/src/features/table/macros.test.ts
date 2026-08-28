import { beforeEach, describe, expect, it } from 'vitest';
import { addMacro, loadMacros, MACRO_LIMIT, removeMacro, saveMacros } from './macros.js';

/** Minimal in-memory Storage — macros are device-local, never server state. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

let store: Storage;

beforeEach(() => {
  store = memoryStorage();
});

describe('macros', () => {
  it('round-trips through storage', () => {
    saveMacros('c1', [{ id: 'm1', name: 'Perception', pool: 9 }], store);
    expect(loadMacros('c1', store)).toEqual([{ id: 'm1', name: 'Perception', pool: 9 }]);
  });

  it('keeps campaigns apart', () => {
    saveMacros('c1', [{ id: 'm1', name: 'Perception', pool: 9 }], store);
    expect(loadMacros('c2', store)).toEqual([]);
  });

  it('adds newest-first with a generated id', () => {
    addMacro('c1', { name: 'Sneak', pool: 11 }, store);
    const list = addMacro('c1', { name: 'Shoot', pool: 14, limitKind: 'accuracy', limitValue: 5 }, store);
    expect(list.map((m) => m.name)).toEqual(['Shoot', 'Sneak']);
    expect(list[0]?.id).toBeTruthy();
    expect(list[0]?.limitValue).toBe(5);
  });

  it('removes by id', () => {
    const list = addMacro('c1', { name: 'Sneak', pool: 11 }, store);
    const id = list[0]?.id ?? '';
    expect(removeMacro('c1', id, store)).toEqual([]);
    expect(loadMacros('c1', store)).toEqual([]);
  });

  it('caps the list so a long campaign cannot grow it forever', () => {
    for (let i = 0; i < MACRO_LIMIT + 6; i += 1) {
      addMacro('c1', { name: `M${i}`, pool: i }, store);
    }
    expect(loadMacros('c1', store)).toHaveLength(MACRO_LIMIT);
  });

  it('survives garbage and missing storage', () => {
    store.setItem('safehouse.macros.c1', 'not json');
    expect(loadMacros('c1', store)).toEqual([]);
    store.setItem('safehouse.macros.c1', JSON.stringify([{ nope: true }, { id: 'a', name: 'b', pool: 3 }]));
    expect(loadMacros('c1', store)).toEqual([{ id: 'a', name: 'b', pool: 3 }]);
  });
});
