/**
 * One character, one cache entry, one shape.
 *
 * The GM's sheet died on open with `Cannot read properties of undefined
 * (reading 'physical')`. The server was fine. The assistant dock, mounted over
 * every GM screen, read the same `['character', id]` key as the sheet with its
 * own `queryFn`, and that one returned the raw `characterDto` (`play.monitors`)
 * instead of the sheet's `CharacterRecord` (`condition`). TanStack Query keeps
 * one entry per key and refetches it on invalidation with whichever observer
 * set its options LAST. The dock lives in the layout, so its effects run after
 * the sheet's. The first `useSheetLive` invalidation therefore wrote the raw
 * DTO over the sheet's record, and `IdentityStrip` read `condition.physical`.
 *
 * The hooks are the real ones: rendering them captures the options they hand
 * to `useQuery`, and the GM's mount order is replayed on real observers.
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  type QueryObserverOptions,
} from '@tanstack/react-query';
import { SheetV1Schema } from '@safehouse/contracts';
import { useAiContext } from '../gm/fixer/aiContext.js';
import { characterKey, normalizeCharacter, useCharacter, type CharacterRecord } from './api.js';

const seen = vi.hoisted(() => [] as QueryObserverOptions[]);

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  const useQuery = ((options: QueryObserverOptions) => {
    seen.push(options);
    return actual.useQuery(options);
  }) as typeof actual.useQuery;
  return { ...actual, useQuery };
});

/** `GET /api/characters/:id` as the server's `characterDto` answers it. */
const CHARACTER_BODY = {
  id: 'char-1',
  campaignId: 'camp-1',
  ownerUserId: 'user-9',
  name: 'Kestrel Vane',
  sheet: SheetV1Schema.parse({
    v: 1,
    identity: { alias: 'Kestrel Vane', metatype: 'human' },
    attributes: {
      bod: 4, agi: 5, rea: 4, str: 3, wil: 5, log: 3, int: 4, cha: 4,
      edg: { max: 4, current: 2 }, ess: 6, mag: 0, res: 0,
    },
  }),
  play: { monitors: { physical: 3, stun: 1 }, edgeBurned: 1 },
  balances: { karma: 12, nuyen: 4200 },
  sheetVersion: 4,
};

vi.mock('../../api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client.js')>()),
  apiGet: vi.fn(async (path: string) => {
    if (path === '/api/characters/char-1') return CHARACTER_BODY;
    throw new Error(`unexpected GET ${path}`);
  }),
}));

const KEY = JSON.stringify(characterKey('char-1'));

/** Every `['character', 'char-1']` read this element makes on the sheet's path. */
function characterReads(element: ReactElement): QueryObserverOptions[] {
  seen.length = 0;
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/c/camp-1/sheet/char-1']}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
  return seen.filter((o) => JSON.stringify(o.queryKey) === KEY);
}

function SheetRead() {
  useCharacter('char-1');
  return null;
}

function DockRead() {
  useAiContext('camp-1');
  return null;
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("['character', id] — the sheet's record, whoever reads it", () => {
  it('stays a CharacterRecord when the GM dock reads the sheet it floats over', async () => {
    const [sheetRead] = characterReads(<SheetRead />);
    const dockReads = characterReads(<DockRead />);
    // Without this the test would pass on a dock that stopped reading the character at all.
    expect(dockReads, 'the dock no longer reads the character on a sheet path').toHaveLength(1);

    const qc = client();
    // React runs effects child-first: the sheet subscribes, then the layout's dock.
    const sheet = new QueryObserver(qc, sheetRead!);
    const unsubscribeSheet = sheet.subscribe(() => {});
    const dock = new QueryObserver(qc, dockReads[0]!);
    const unsubscribeDock = dock.subscribe(() => {});
    await vi.waitFor(() => expect(sheet.getCurrentResult().isSuccess).toBe(true));

    // What `useSheetLive` does for every backfilled event that names the character.
    await qc.invalidateQueries({ queryKey: characterKey('char-1') });

    const record = sheet.getCurrentResult().data as CharacterRecord | undefined;
    expect(record).toEqual(normalizeCharacter(CHARACTER_BODY));
    expect(record?.condition).toEqual({ physical: 3, stun: 1 });
    unsubscribeSheet();
    unsubscribeDock();
  });

  it('is a CharacterRecord even when a reader other than the sheet filled the cache', async () => {
    // The Grid → Sheet path: the entry is already there when the sheet mounts,
    // so the sheet renders it before its own refetch lands.
    for (const read of characterReads(<DockRead />)) {
      const qc = client();
      await qc.fetchQuery(read as Parameters<QueryClient['fetchQuery']>[0]);
      expect(qc.getQueryData(characterKey('char-1'))).toEqual(normalizeCharacter(CHARACTER_BODY));
    }
  });
});
