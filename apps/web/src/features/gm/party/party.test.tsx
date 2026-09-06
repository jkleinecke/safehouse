/**
 * The party roster as the GM sees it.
 *
 * There is no DOM in this package (no jsdom, no testing-library), so the real
 * components are rendered to markup and interaction is exercised by driving the
 * same pure transitions the handlers call and re-rendering — the honest half of
 * the loop, on the pattern `books/booksShelf.test.tsx` set.
 *
 * The load-bearing claim is LIVE-1: every assertion below is made with an
 * EMPTY live store — no WebSocket event has ever arrived — because the whole
 * defect class was views that rendered only what the socket happened to deliver
 * while they were mounted.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SheetV1 } from '@safehouse/contracts';
import { SheetV1Schema } from '@safehouse/contracts';
import { deriveCharacter } from '@safehouse/rules';
import { useLiveStore } from '../../../live/store.js';
import PartyRoster from './PartyRoster.js';
import PartyRow from './PartyRow.js';
import { PARTY_HYDRATE, partyDerivedKey, partyKey, postAward, postDamage } from './api.js';
import {
  deviceFor,
  normalizeDerived,
  normalizeMember,
  vitalsFor,
  withDamage,
  type PartyMember,
} from './roster.js';

// ---------------------------------------------------------------------------
// Fixtures — exactly the bodies the server returns
// ---------------------------------------------------------------------------

function sheet(alias: string, metatype: string): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias, metatype },
    attributes: {
      bod: 6, agi: 4, rea: 4, str: 6, wil: 4, log: 2, int: 4, cha: 3,
      edg: { max: 3, current: 2 }, ess: 5, mag: 0, res: 0,
    },
    skills: [{ id: 'perception', rating: 3, attr: 'int' }],
    armor: [{ name: 'Lined coat', rating: 9, worn: true }],
  });
}

/** `GET /api/campaigns/:id/characters` → one `characterDto` per PC. */
const ROSTER_BODY = [
  {
    id: 'char-torque',
    campaignId: 'c1',
    ownerUserId: 'user-torque',
    name: 'Torque',
    status: 'active',
    sheet: sheet('Torque', 'ork'),
    play: { monitors: { physical: 4, stun: 0, overflow: 0 }, edgeBurned: 1 },
    balances: { karma: 14, nuyen: 5200, pending: { karma: 14, nuyen: 5200 } },
    hasChummerBlob: true,
  },
  {
    id: 'char-whisper',
    campaignId: 'c1',
    ownerUserId: null,
    name: 'Whisper',
    status: 'active',
    sheet: sheet('Whisper', 'elf'),
    play: { monitors: { physical: 0, stun: 0, overflow: 0 }, edgeBurned: 0 },
    balances: { karma: 9, nuyen: 800, pending: { karma: 9, nuyen: 800 } },
    hasChummerBlob: false,
  },
];

const DEVICES_BODY = [
  { id: 'dev-torque', role: 'player', userId: 'user-torque', userName: 'Ana', label: "Torque's phone" },
  { id: 'dev-gm', role: 'gm', userId: 'user-gm', userName: 'Demo GM', label: "GM's laptop" },
];

const SCENE_BODY = {
  scene: { id: 'scene-1', name: 'Pier 23 Warehouse' },
  tokens: [
    { id: 'tok-torque', sceneId: 'scene-1', source: 'character', sourceId: 'char-torque', name: 'Torque', x: 3, y: 9 },
  ],
};

/** `GET /api/characters/:id/derived` for Torque, with the scene folded in. */
function derivedBody(member: PartyMember) {
  return {
    characterId: member.id,
    name: member.name,
    derived: deriveCharacter(member.sheet as SheetV1, {
      situational: [
        {
          id: 'env.scene',
          source: { kind: 'scene' },
          target: 'pool.all',
          op: 'add',
          value: -2,
          active: true,
          note: 'environment: light 2 → dark (-2)',
        },
      ],
      wounds: { physical: member.wounds.physical, stun: member.wounds.stun },
    }),
    monitors: {
      physical: { max: 11, filled: member.wounds.physical },
      stun: { max: 10, filled: member.wounds.stun },
      overflow: { max: 6, filled: 0 },
    },
    wounds: member.wounds,
    edge: member.edge,
    situational: [],
    activeSceneId: 'scene-1',
    sustained: [],
    recoil: {},
    ammo: {},
    overrides: [],
  };
}

const noop = () => undefined;

function row(over: Partial<Parameters<typeof PartyRow>[0]> = {}): string {
  const member = over.member ?? normalizeMember(ROSTER_BODY[0]);
  const vitals = over.vitals ?? vitalsFor(member, null);
  return renderToStaticMarkup(
    <MemoryRouter>
      <ul>
        <PartyRow
          campaignId="c1"
          member={member}
          vitals={vitals}
          device={deviceFor(member, DEVICES_BODY, {})}
          token={null}
          sceneName={null}
          onDamage={noop}
          onAward={noop}
          onJumpToToken={noop}
          {...over}
        />
      </ul>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  useLiveStore.getState().reset();
});

describe('REST alone populates the roster (LIVE-1)', () => {
  it('starts from an empty live store — nothing below comes off the socket', () => {
    expect(useLiveStore.getState().events).toHaveLength(0);
    expect(useLiveStore.getState().presence).toEqual({});
  });

  it('never serves a stale cache to a console that just reloaded', () => {
    expect(PARTY_HYDRATE).toEqual({
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnReconnect: 'always',
    });
  });

  it('renders a complete row from the list body and nothing else', () => {
    const html = row();
    expect(html).toContain('Torque');
    expect(html).toContain('ork');
    // The GM never needs a UUID: the row IS the link to the sheet.
    expect(html).toContain('href="/c/c1/sheet/char-torque"');
    expect(html).toContain('open sheet');
    // Filled boxes come from `play`, not the sheet (FR3.4).
    expect(html).toContain('physical condition monitor, 4 of 11 boxes filled');
    expect(html).toContain('stun condition monitor, 0 of 10 boxes filled');
    // Ledger sums, never sheet numbers (FR3.6).
    expect(html).toContain('14');
    expect(html).toContain('5,200¥');
    // Edge, burned points included (FR2.3).
    expect(html).toContain('2/3 (1 burned)');
    // Who is holding this sheet, read from the device list alone.
    expect(html).toContain('data-device-state="paired"');
    expect(html).toContain('Torque&#x27;s phone · paired');
  });

  it('labels a locally-derived row rather than passing it off as the server’s', () => {
    const member = normalizeMember(ROSTER_BODY[0]);
    const local = vitalsFor(member, null);
    expect(local.authoritative).toBe(false);
    expect(row({ member, vitals: local })).toContain('est');

    // The server's answer has the dark warehouse in it; the browser's does not,
    // which is exactly what the `est` badge was warning about.
    const authoritative = vitalsFor(member, normalizeDerived(derivedBody(member)));
    expect(local.pools.defense).toBe(7); // REA 4 + INT 4 − 1 wound
    expect(authoritative.pools.defense).toBe(5); // …− 2 scene environment
    const html = row({ member, vitals: authoritative });
    expect(html).not.toContain('>est<');
    expect(html).toContain('>5</span>');
  });

  it('says so when a sheet nobody holds cannot reach a phone', () => {
    const orphan = normalizeMember(ROSTER_BODY[1]);
    const html = row({
      member: orphan,
      vitals: vitalsFor(orphan, null),
      device: deviceFor(orphan, DEVICES_BODY, {}),
      onAssignOwner: noop,
      owners: [{ userId: 'user-torque', label: 'Ana' }],
    });
    expect(html).toContain('data-device-state="unclaimed"');
    expect(html).toMatch(/no Sheet tab at all/);
    expect(html).toContain('Assign Whisper to a device');
    expect(html).toContain('— unclaimed —');
  });

  it('offers the map jump only when that PC actually has a token', () => {
    const member = normalizeMember(ROSTER_BODY[0]);
    expect(row({ member, token: null })).toContain('no token');
    const withToken = row({
      member,
      token: SCENE_BODY.tokens[0]!,
      sceneName: 'Pier 23 Warehouse',
    });
    expect(withToken).toContain('find on map');
    expect(withToken).toContain('Pier 23 Warehouse');
  });
});

describe('a damage apply moves the monitor and the wound modifier on screen', () => {
  it('re-renders with the deeper track and the penalty it implies', () => {
    const member = normalizeMember(ROSTER_BODY[1]); // clean track
    const before = vitalsFor(member, null);
    expect(row({ member, vitals: before })).toContain(
      'physical condition monitor, 0 of 11 boxes filled',
    );

    // Drive the same transition the +3 button drives.
    const hurt = withDamage(member, before, { monitor: 'physical', boxes: 3, op: 'damage' });
    const after = vitalsFor(hurt, null);
    const html = row({ member: hurt, vitals: after });
    expect(html).toContain('physical condition monitor, 3 of 11 boxes filled');
    expect(html).toContain('-1');
    // The row offers the control that produced it, on the row itself.
    expect(html).toContain('Apply 3 physical damage to Whisper');
    expect(html).toContain('Heal 1 physical to Whisper');
  });

  it('posts the live-play route, not a sheet edit', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await postDamage('char-whisper', { monitor: 'physical', boxes: 3, op: 'damage' });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls[0]?.url).toBe('/api/characters/char-whisper/damage');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      monitor: 'physical',
      boxes: 3,
      op: 'damage',
    });
  });
});

describe('an award creates a ledger entry (FR3.6)', () => {
  it('posts an append-only entry with a reason, never a new balance', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await postAward('char-torque', {
        currency: 'karma',
        delta: 5,
        reason: 'session 12 — got everyone out',
      });
      await postAward('char-torque', { currency: 'nuyen', delta: -1500, reason: 'street doc' });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls.map((c) => c.url)).toEqual([
      '/api/characters/char-torque/ledger',
      '/api/characters/char-torque/ledger',
    ]);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      currency: 'karma',
      delta: 5,
      reason: 'session 12 — got everyone out',
    });
    // A deduction is the same append with a negative delta.
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({ delta: -1500 });
    // Nothing anywhere PUTs a balance.
    expect(calls.every((c) => c.init.method === 'POST')).toBe(true);
  });

  it('renders the award controls beside the balance they move', () => {
    const html = row();
    expect(html).toContain('Award karma to Torque');
    expect(html).toContain('Deduct karma from Torque');
    expect(html).toContain('reason (goes in the ledger)');
  });
});

// ---------------------------------------------------------------------------
// The whole panel
// ---------------------------------------------------------------------------

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

function renderRoster(roster: unknown[] | undefined, opts: { derived?: boolean } = {}): string {
  const store = fakeStorage();
  store.setItem('safehouse.session.gm', JSON.stringify({ token: 't', role: 'gm', campaignId: 'c1' }));
  const prevLocal = Reflect.get(globalThis, 'localStorage');
  const prevTab = Reflect.get(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: fakeStorage(), configurable: true });
  try {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (roster) qc.setQueryData(partyKey('c1'), roster);
    qc.setQueryData(['campaign', 'c1'], { id: 'c1', name: 'Demo', activeSceneId: 'scene-1' });
    qc.setQueryData(['campaign', 'c1', 'devices'], DEVICES_BODY);
    qc.setQueryData(['scene', 'scene-1'], SCENE_BODY);
    if (opts.derived) {
      for (const raw of roster ?? []) {
        const member = normalizeMember(raw);
        qc.setQueryData(partyDerivedKey(member.id), normalizeDerived(derivedBody(member)));
      }
    }
    const tree: ReactNode = (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/c/c1/gm/party']}>
          <Routes>
            <Route
              path="/c/:campaignId/gm/party"
              element={<PartyRoster campaignId="c1" />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    return renderToStaticMarkup(tree);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: prevLocal, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: prevTab, configurable: true });
  }
}

describe('PartyRoster', () => {
  it('lists every PC from the REST body with no socket traffic at all', () => {
    const html = renderRoster(ROSTER_BODY);
    expect(useLiveStore.getState().events).toHaveLength(0);
    expect(html).toContain('data-character-id="char-torque"');
    expect(html).toContain('data-character-id="char-whisper"');
    expect(html).toContain('2 runners');
    expect(html).toContain('23 karma');
    expect(html).toContain('6,000¥');
    expect(html).toContain('1 wounded');
    expect(html).toContain('1 unclaimed');
    // The scene the table is on, named, because the map jump is on these rows.
    expect(html).toContain('Pier 23 Warehouse');
    expect(html).toContain('find on map');
  });

  it('prefers the server’s derived numbers when they have landed', () => {
    expect(renderRoster(ROSTER_BODY)).toContain('est');
    expect(renderRoster(ROSTER_BODY, { derived: true })).not.toContain('>est<');
  });

  it('offers the import path when the campaign has no characters yet', () => {
    const html = renderRoster([]);
    expect(html).toContain('data-testid="party-empty"');
    expect(html).toMatch(/no characters in this campaign yet/i);
    // Not a dead end: the control that fixes it is right there (FR3.1).
    expect(html).toContain('data-testid="add-character"');
    expect(html).toContain('import .chum5');
    expect(html).toContain('new blank sheet');
    expect(html).toContain('.chum5');
    expect(html).not.toContain('data-character-id=');
  });

  it('says "loading" rather than "nobody here" before the roster answers', () => {
    const html = renderRoster(undefined);
    expect(html).toContain('loading party');
    expect(html).not.toContain('data-testid="party-empty"');
  });
});

describe('token portraits on the roster (FR9.4)', () => {
  it('offers the GM a token image for every runner, right where they are looking', () => {
    // The GM's answer to "your token is a letter in a circle" should not be
    // "open their sheet" — the roster is where they are already standing.
    const html = renderRoster(ROSTER_BODY);
    expect(html).toContain('data-testid="portrait-set"');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp,image/gif"');
  });

  it('shows the picture once a runner has one', () => {
    const withFace = ROSTER_BODY.map((c, i) =>
      i === 0
        ? {
            ...c,
            sheet: { ...(c.sheet as object), identity: { ...(c.sheet as { identity: object }).identity, portraitId: 'att-7' } },
          }
        : c,
    );
    const html = renderRoster(withFace);
    expect(html).toContain('/files/att-7');
    // Every row carries the SAME single control whether or not it has a face,
    // so the names stay in a column.
    expect((html.match(/data-testid="portrait-set"/g) ?? []).length).toBe(ROSTER_BODY.length);
  });

  it('keeps the row renderable with no portrait control at all', () => {
    // `portrait` is optional on purpose: the row is presentational and every
    // other test in this file renders it with no query client.
    expect(row()).toContain('data-testid="party-row"');
  });
});
