/**
 * Personal macros (FR2.8) — the point of the exercise is that they follow the
 * PLAYER, not the handset, and that a server without the route yet loses
 * nobody's macros.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchMacros,
  hasSynced,
  macroKey,
  macroRollConfig,
  MACRO_LIMIT,
  mergeMacros,
  needsPush,
  newMacroId,
  normalizeMacros,
  readLocalMacros,
  saveMacros,
  withMacro,
  withoutMacro,
  writeLocalMacros,
  type DiceMacro,
  type StorageLike,
} from './macroStore.js';

function macro(id: string, name = id, pool = 8): DiceMacro {
  return { id, name, pool };
}

function fakeStore(seed: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalisation', () => {
  it('accepts both the envelope and a bare array', () => {
    expect(normalizeMacros({ macros: [macro('a')] })).toHaveLength(1);
    expect(normalizeMacros([macro('a')])).toHaveLength(1);
    expect(normalizeMacros(null)).toEqual([]);
    expect(normalizeMacros('nonsense')).toEqual([]);
  });

  it('drops malformed entries and duplicate ids', () => {
    const out = normalizeMacros([
      macro('a'),
      { id: 'b' },
      { name: 'no id', pool: 3 },
      macro('a', 'again'),
      null,
    ]);
    expect(out.map((m) => m.id)).toEqual(['a']);
  });

  it('caps the list so a phone can still render it', () => {
    const many = Array.from({ length: MACRO_LIMIT + 10 }, (_, i) => macro(`m${i}`));
    expect(normalizeMacros(many)).toHaveLength(MACRO_LIMIT);
  });

  it('keeps a limit when one is set', () => {
    const withLimit = normalizeMacros([
      { id: 'a', name: 'Sneak', pool: 11, limitKind: 'physical', limitValue: 5 },
    ]);
    expect(withLimit[0]).toMatchObject({ limitKind: 'physical', limitValue: 5 });
  });
});

describe('merging a second device into the account', () => {
  it('keeps the server list and adopts device-only macros', () => {
    const remote = [macro('server-1'), macro('shared')];
    const local = [macro('shared', 'stale local copy'), macro('phone-only')];
    const merged = mergeMacros(remote, local);
    expect(merged.map((m) => m.id)).toEqual(['server-1', 'shared', 'phone-only']);
    // The server's copy of a shared id wins.
    expect(merged[1]?.name).toBe('shared');
  });

  it('knows when the device is holding something the server has not seen', () => {
    expect(needsPush([macro('a')], [macro('a')])).toBe(false);
    expect(needsPush([macro('a')], [macro('a'), macro('b')])).toBe(true);
  });
});

describe('list edits', () => {
  it('adds newest-first, replaces by id, and caps', () => {
    const list = [macro('a'), macro('b')];
    expect(withMacro(list, macro('c')).map((m) => m.id)).toEqual(['c', 'a', 'b']);
    expect(withMacro(list, macro('b', 'renamed')).map((m) => m.id)).toEqual(['b', 'a']);
    const full = Array.from({ length: MACRO_LIMIT }, (_, i) => macro(`m${i}`));
    expect(withMacro(full, macro('new'))).toHaveLength(MACRO_LIMIT);
  });

  it('removes by id', () => {
    expect(withoutMacro([macro('a'), macro('b')], 'a').map((m) => m.id)).toEqual(['b']);
  });

  it('mints distinct ids', () => {
    expect(newMacroId(1, () => 0.1)).not.toBe(newMacroId(2, () => 0.1));
  });
});

describe('the local mirror', () => {
  it('scopes storage by user so two players on one laptop do not mix', () => {
    expect(macroKey('camp', 'user-a')).not.toBe(macroKey('camp', 'user-b'));
    expect(macroKey('camp', undefined)).toContain('device');
  });

  it('round-trips through storage', () => {
    const store = fakeStore();
    writeLocalMacros('camp', 'u1', [macro('a')], store);
    expect(readLocalMacros('camp', 'u1', store).map((m) => m.id)).toEqual(['a']);
    // Another user's slot is untouched.
    expect(readLocalMacros('camp', 'u2', store)).toEqual([]);
  });

  it('survives corrupt or absent storage', () => {
    expect(readLocalMacros('camp', 'u1', null)).toEqual([]);
    expect(readLocalMacros('camp', 'u1', fakeStore({ [macroKey('camp', 'u1')]: '{oops' }))).toEqual(
      [],
    );
    // The "already migrated" flag has to be safe against a blocked store too,
    // or a private-mode tab would throw on first read instead of syncing.
    expect(hasSynced('camp', 'u1', null)).toBe(false);
  });
});

describe('server-backed sync', () => {
  function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const spy = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)));
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('reads the account list and folds this device into it', async () => {
    const store = fakeStore();
    vi.stubGlobal('localStorage', store);
    writeLocalMacros('camp', undefined, [macro('phone-only')], store);

    const calls: { url: string; method: string }[] = [];
    stubFetch((url, init) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      return init?.method === 'PUT'
        ? json({ macros: [macro('server-1'), macro('phone-only')] })
        : json({ macros: [macro('server-1')] });
    });

    const snapshot = await fetchMacros('camp', undefined);
    expect(snapshot.hasRemote).toBe(true);
    expect(snapshot.macros.map((m) => m.id)).toEqual(['server-1', 'phone-only']);
    // The device's unsynced macro was pushed up exactly once.
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    // …and the mirror now holds the union.
    expect(readLocalMacros('camp', undefined, store).map((m) => m.id)).toEqual([
      'server-1',
      'phone-only',
    ]);
  });

  it('does not resurrect a macro deleted on the player’s other phone', async () => {
    const store = fakeStore();
    vi.stubGlobal('localStorage', store);

    // First sync: the device's local macro is adopted into the account.
    let remote = [macro('a'), macro('b')];
    const calls: string[] = [];
    stubFetch((_url, init) => {
      calls.push(init?.method ?? 'GET');
      if (init?.method === 'PUT') return json({ macros: remote });
      return json({ macros: remote });
    });
    writeLocalMacros('camp', 'u1', [macro('a'), macro('b')], store);
    const first = await fetchMacros('camp', 'u1');
    expect(first.macros.map((m) => m.id)).toEqual(['a', 'b']);

    // Meanwhile the player deletes 'b' on their other handset.
    remote = [macro('a')];
    const second = await fetchMacros('camp', 'u1');

    expect(second.macros.map((m) => m.id)).toEqual(['a']);
    // …and nothing was pushed back up to undo it.
    expect(calls.filter((m) => m === 'PUT')).toHaveLength(0);
    expect(readLocalMacros('camp', 'u1', store).map((m) => m.id)).toEqual(['a']);
  });

  it('degrades to the local mirror when the route is not there yet', async () => {
    const store = fakeStore();
    vi.stubGlobal('localStorage', store);
    writeLocalMacros('camp', 'u1', [macro('local')], store);
    stubFetch(() => json({ error: { code: 'not_found', message: 'no' } }, 404));

    const snapshot = await fetchMacros('camp', 'u1');
    expect(snapshot).toMatchObject({ hasRemote: false });
    expect(snapshot.degraded).toBeUndefined();
    expect(snapshot.macros.map((m) => m.id)).toEqual(['local']);
  });

  it('marks a real failure as degraded rather than "not built"', async () => {
    vi.stubGlobal('localStorage', fakeStore());
    stubFetch(() => json({ error: { code: 'boom', message: 'nope' } }, 500));
    const snapshot = await fetchMacros('camp', 'u1');
    expect(snapshot).toMatchObject({ hasRemote: false, degraded: true });
  });

  it('writes locally before the network, so a failed PUT loses nothing', async () => {
    const store = fakeStore();
    vi.stubGlobal('localStorage', store);
    stubFetch(() => json({ error: { code: 'offline', message: 'no' } }, 500));

    const snapshot = await saveMacros('camp', 'u1', [macro('a')]);
    expect(snapshot.hasRemote).toBe(false);
    expect(snapshot.macros.map((m) => m.id)).toEqual(['a']);
    expect(readLocalMacros('camp', 'u1', store).map((m) => m.id)).toEqual(['a']);
  });
});

describe('macros as free-form rolls', () => {
  it('builds a roll config with no pool reference (FR2.8)', () => {
    const config = macroRollConfig({
      id: 'm1',
      name: 'Composure',
      pool: 8,
      limitKind: 'social',
      limitValue: 5,
    });
    expect(config).toMatchObject({
      title: 'Composure',
      baseTotal: 8,
      limit: { kind: 'social', value: 5 },
    });
    // No poolRef: there is no sheet pool to check a free-form roll against.
    expect(config.meta['poolRef']).toBeUndefined();
    expect(config.baseBreakdown.reduce((n, e) => n + e.value, 0)).toBe(8);
  });
});
