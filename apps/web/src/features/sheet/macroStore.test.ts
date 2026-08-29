/**
 * Personal macros (FR2.8) — the point of the exercise is that they follow the
 * PLAYER, not the handset, and that a server without the route yet loses
 * nobody's macros.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchMacros,
  hasSynced,
  localOnly,
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

  /**
   * Everything that reaches the server passes through here, so anything the
   * column cannot hold is a permanent 400 mid-migration — one bad macro
   * wedging every good one behind it.
   */
  it('bounds a macro to what the server will accept rather than dropping it', () => {
    const out = normalizeMacros([
      { id: 'a', name: '  Composure  ', pool: 900, limitKind: 'social', limitValue: 400 },
      { id: 'b', name: 'x'.repeat(300), pool: 8 },
      { id: 'c', name: '   ', pool: 8 },
      { id: 'd', name: 'Sneak', pool: -3 },
    ]);
    expect(out[0]).toMatchObject({ name: 'Composure', pool: 100, limitValue: 100 });
    expect(out[1]?.name).toHaveLength(120);
    // A nameless macro is an unpressable button and an unkeyable row.
    expect(out.map((m) => m.id)).toEqual(['a', 'b', 'd']);
    expect(out[2]?.pool).toBe(0);
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

  /**
   * The ids do not match across devices — each handset minted its own before
   * the route existed — so the label is the only thing that can dedupe a
   * migration, and it is exactly what the server keys the table on.
   */
  it('treats a same-named macro as already known even under a different id', () => {
    const remote = [macro('srv-1', 'Composure', 8)];
    const local = [macro('phone-9', ' composure ', 8), macro('phone-10', 'Sneak', 11)];
    expect(localOnly(remote, local).map((m) => m.name)).toEqual(['Sneak']);
    expect(mergeMacros(remote, local).map((m) => m.name)).toEqual(['Composure', 'Sneak']);
    expect(needsPush(remote, [local[0]!])).toBe(false);
  });

  it('does not duplicate a label that appears twice on the same device', () => {
    const local = [macro('p1', 'Composure'), macro('p2', 'COMPOSURE')];
    expect(localOnly([], local).map((m) => m.id)).toEqual(['p1']);
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

  /**
   * A tiny stand-in for `user_macros`: keyed on the label, exactly like the
   * server's unique index, so a repeated POST updates a row instead of adding
   * a button. Ids are minted here because the server mints them there — that
   * mismatch with the device's `m…` ids is the whole reason the migration has
   * to dedupe on the label.
   */
  function fakeRack(seed: DiceMacro[] = []) {
    const rows = new Map<string, DiceMacro>();
    let n = 0;
    const put = (m: DiceMacro) => {
      const key = m.name.trim().toLowerCase();
      const existing = rows.get(key);
      rows.set(key, { ...m, id: existing?.id ?? `srv-${++n}` });
    };
    seed.forEach(put);
    const calls: { method: string; body: unknown }[] = [];
    return {
      calls,
      list: () => [...rows.values()],
      drop: (name: string) => rows.delete(name.trim().toLowerCase()),
      handler(_url: string, init?: RequestInit) {
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, body });
        if (method === 'POST') {
          put(body as DiceMacro);
          return json({ macro: rows.get(String((body as DiceMacro).name).trim().toLowerCase()) });
        }
        if (method === 'PUT') {
          rows.clear();
          n = 0;
          ((body as { macros: DiceMacro[] }).macros ?? []).forEach(put);
        }
        return json({ macros: [...rows.values()] });
      },
    };
  }

  it('reads the account list and folds this device into it', async () => {
    const store = fakeStore();
    vi.stubGlobal('localStorage', store);
    writeLocalMacros('camp', undefined, [macro('local-1', 'phone-only')], store);

    const rack = fakeRack([macro('ignored', 'server-1')]);
    stubFetch(rack.handler);

    const snapshot = await fetchMacros('camp', undefined);
    expect(snapshot.hasRemote).toBe(true);
    expect(snapshot.macros.map((m) => m.name)).toEqual(['server-1', 'phone-only']);
    // The device's unsynced macro was POSTed exactly once — POST, not PUT, so
    // a stale device can never delete what the player made elsewhere.
    expect(rack.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(rack.calls.some((c) => c.method === 'PUT')).toBe(false);
    // The mirror holds the SERVER's list, ids included: mirroring the locally
    // merged list is what made a second handset show its macros twice.
    expect(readLocalMacros('camp', undefined, store).map((m) => m.id)).toEqual(['srv-1', 'srv-2']);
  });

  /**
   * FR2.8's actual promise. Two devices, one account: the second sees the
   * first's rack, contributes its own leftovers, and nobody ends up with a
   * doubled button.
   */
  it('follows the player onto a borrowed phone, and migrates exactly once', async () => {
    const rack = fakeRack();
    stubFetch(rack.handler);

    // Phone A: an old device-local rack, migrated on first load after upgrade.
    const phoneA = fakeStore();
    vi.stubGlobal('localStorage', phoneA);
    writeLocalMacros('camp', 'u1', [macro('a1', 'Composure', 8)], phoneA);
    const first = await fetchMacros('camp', 'u1');
    expect(first.macros.map((m) => m.name)).toEqual(['Composure']);

    // Phone B: same player, empty storage, its own leftover rack.
    const phoneB = fakeStore();
    vi.stubGlobal('localStorage', phoneB);
    writeLocalMacros('camp', 'u1', [macro('b1', 'Sneak', 11)], phoneB);
    const borrowed = await fetchMacros('camp', 'u1');

    // The borrowed phone shows what the player built on the first one…
    expect(borrowed.macros.map((m) => m.name)).toEqual(['Composure', 'Sneak']);
    // …with the server's ids, so both handsets now agree on identity.
    expect(borrowed.macros.every((m) => m.id.startsWith('srv-'))).toBe(true);

    // Load it again: the migration does not replay, and nothing doubles.
    const posts = rack.calls.filter((c) => c.method === 'POST').length;
    const again = await fetchMacros('camp', 'u1');
    expect(again.macros.map((m) => m.name)).toEqual(['Composure', 'Sneak']);
    expect(rack.calls.filter((c) => c.method === 'POST')).toHaveLength(posts);

    // And back on phone A: the rack it never saw is simply there.
    vi.stubGlobal('localStorage', phoneA);
    const backOnA = await fetchMacros('camp', 'u1');
    expect(backOnA.macros.map((m) => m.name)).toEqual(['Composure', 'Sneak']);
  });

  it('retries the migration on the next load, without doubling anything', async () => {
    const store = fakeStore();
    vi.stubGlobal('localStorage', store);
    writeLocalMacros('camp', 'u1', [macro('a1', 'Composure', 8)], store);

    const rack = fakeRack();
    let failPost = true;
    stubFetch((url, init) => {
      if (failPost && (init?.method ?? 'GET') === 'POST') {
        return json({ error: { code: 'offline', message: 'no' } }, 503);
      }
      return rack.handler(url, init);
    });

    const failed = await fetchMacros('camp', 'u1');
    // The push did not land, but the macro is still on the rack and the state
    // says so rather than pretending.
    expect(failed).toMatchObject({ hasRemote: true, degraded: true });
    expect(failed.macros.map((m) => m.name)).toEqual(['Composure']);
    expect(hasSynced('camp', 'u1', store)).toBe(false);

    failPost = false;
    const retried = await fetchMacros('camp', 'u1');
    expect(retried.degraded).toBeUndefined();
    expect(retried.macros.map((m) => m.name)).toEqual(['Composure']);
    expect(rack.list()).toHaveLength(1);
  });

  /**
   * A macro the server will never accept must not hold the migration hostage:
   * every retry would re-send it, fail, and abandon the well-formed macros
   * queued behind it. A 5xx is the opposite case and does deserve the retry.
   */
  it('steps over a macro the server rejects, but retries one it could not reach', async () => {
    const store = fakeStore();
    vi.stubGlobal('localStorage', store);
    writeLocalMacros('camp', 'u1', [macro('a1', 'Bad'), macro('a2', 'Good')], store);

    const rack = fakeRack();
    stubFetch((url, init) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as { name?: string }) : undefined;
      if ((init?.method ?? 'GET') === 'POST' && body?.name === 'Bad') {
        return json({ error: { code: 'bad_request', message: 'nope' } }, 400);
      }
      return rack.handler(url, init);
    });

    const snapshot = await fetchMacros('camp', 'u1');
    expect(snapshot.macros.map((m) => m.name)).toEqual(['Good']);
    // The migration completed — a permanently unacceptable macro is not a
    // reason to keep replaying the whole push forever.
    expect(snapshot.degraded).toBeUndefined();
    expect(hasSynced('camp', 'u1', store)).toBe(true);
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
    // The route exists, so the rack is not "device only" — the edit simply has
    // not landed. Two different sentences, two different states.
    expect(snapshot).toMatchObject({ hasRemote: true, degraded: true });
    expect(snapshot.macros.map((m) => m.id)).toEqual(['a']);
    expect(readLocalMacros('camp', 'u1', store).map((m) => m.id)).toEqual(['a']);
  });

  it('calls a server with no macro route "device only", not "failed"', async () => {
    vi.stubGlobal('localStorage', fakeStore());
    stubFetch(() => json({ error: { code: 'not_found', message: 'no' } }, 404));
    const snapshot = await saveMacros('camp', 'u1', [macro('a')]);
    expect(snapshot.hasRemote).toBe(false);
    expect(snapshot.degraded).toBeUndefined();
  });

  it('adopts the server ids a PUT hands back, so the next delete addresses a real row', async () => {
    const store = fakeStore();
    vi.stubGlobal('localStorage', store);
    const rack = fakeRack();
    stubFetch(rack.handler);

    const saved = await saveMacros('camp', 'u1', [macro('local-1', 'Composure', 8)]);
    expect(saved.macros.map((m) => m.id)).toEqual(['srv-1']);
    expect(readLocalMacros('camp', 'u1', store).map((m) => m.id)).toEqual(['srv-1']);
    // A write is a sync: the next read must not resurrect what was deleted.
    expect(hasSynced('camp', 'u1', store)).toBe(true);

    const emptied = await saveMacros('camp', 'u1', []);
    expect(emptied.macros).toEqual([]);
    expect((await fetchMacros('camp', 'u1')).macros).toEqual([]);
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
