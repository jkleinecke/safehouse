/**
 * Session storage rules (FR1.1/1.3) — two collisions, one store.
 *
 * The first was found by driving the real app: a GM keeps a player view open
 * in a second tab of the same browser, and the join wipes the GM out. The
 * second is the same shape one axis over: a GM running two tables holds two
 * `gm` tokens, and with one slot per role the second table evicted the first,
 * so "load back into the campaign I made last month" was impossible.
 *
 * Both fixes are asserted here, together, because the second must not undo the
 * first: the tab pin still wins, the per-role slot is still there for the code
 * that reads it with one `getItem`, the legacy blob still migrates, and a
 * storage backend that throws still degrades instead of exploding.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@safehouse/contracts';
import {
  ACTIVE_CAMPAIGN_KEY,
  ACTIVE_ROLE_KEY,
  LEGACY_KEY,
  ROSTER_KEY,
  ROSTER_LIMIT,
  SESSION_PREFIX,
  TAB_CAMPAIGN_KEY,
  TAB_ROLE_KEY,
  activateSession,
  dropAllSessions,
  dropSession,
  dropSessionForToken,
  noteCampaignNames,
  readActiveRole,
  readSessions,
  readTabCampaign,
  readTabRole,
  resolveSession,
  sessionFrom,
  sessionKey,
  writeSession,
  type Session,
  type SessionStores,
  type StorageLike,
} from './session.js';

class Mem implements StorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  get size(): number {
    return this.map.size;
  }
}

class Blocked implements StorageLike {
  getItem(): string | null {
    throw new Error('storage disabled');
  }
  setItem(): void {
    throw new Error('storage disabled');
  }
  removeItem(): void {
    throw new Error('storage disabled');
  }
}

function sess(role: Role, token = `${role}-token`, campaignId = 'camp-1'): Session {
  return { token, role, campaignId, deviceId: `dev-${role}`, userId: `u-${role}` };
}

const tokensOf = (sessions: Session[]) => sessions.map((s) => s.token).sort();

let local: Mem;
let tabA: SessionStores;
let tabB: SessionStores;

beforeEach(() => {
  local = new Mem();
  tabA = { local, tab: new Mem() };
  tabB = { local, tab: new Mem() };
});

describe('same-origin session collision (two tabs, one browser)', () => {
  it('a player join in a second tab does not log the GM out of the first', () => {
    writeSession(tabA, sess('gm'));
    expect(resolveSession(tabA)?.role).toBe('gm');

    // Second tab of the SAME browser scans a player join link.
    writeSession(tabB, sess('player'));

    expect(resolveSession(tabB)?.role).toBe('player');
    expect(resolveSession(tabA)?.role).toBe('gm');
    expect(resolveSession(tabA)?.token).toBe('gm-token');
  });

  it('keeps both tokens on disk so neither role has to re-pair', () => {
    writeSession(tabA, sess('gm'));
    writeSession(tabB, sess('player'));
    expect(readSessions(tabA).map((s) => s.role)).toEqual(['gm', 'player']);
    expect(local.getItem(`${SESSION_PREFIX}gm`)).toBeTruthy();
    expect(local.getItem(`${SESSION_PREFIX}player`)).toBeTruthy();
  });

  it('pins a tab on first resolution, so a later join elsewhere cannot move it', () => {
    writeSession(tabA, sess('gm'));
    // A fresh tab (e.g. the GM opened /c/:id in a new window) resolves + pins.
    const tabC: SessionStores = { local, tab: new Mem() };
    expect(resolveSession(tabC)?.role).toBe('gm');
    expect(readTabRole(tabC)).toBe('gm');

    writeSession(tabB, sess('player'));
    expect(resolveSession(tabC)?.role).toBe('gm');
  });

  it('without sessionStorage it falls back to the last-active role but keeps both slots', () => {
    const noTabA: SessionStores = { local, tab: null };
    const noTabB: SessionStores = { local, tab: null };
    writeSession(noTabA, sess('gm'));
    writeSession(noTabB, sess('player'));

    // Degraded: both tabs read the newest role...
    expect(resolveSession(noTabA)?.role).toBe('player');
    // ...but the GM token is still there, one switch away (never data loss).
    expect(readSessions(noTabA).map((s) => s.role)).toEqual(['gm', 'player']);
    expect(activateSession(noTabA, 'gm')?.token).toBe('gm-token');
  });

  it('survives a storage backend that throws on every call', () => {
    const hostile: SessionStores = { local: new Blocked(), tab: new Blocked() };
    expect(() => writeSession(hostile, sess('gm'))).not.toThrow();
    expect(resolveSession(hostile)).toBeNull();
    expect(readSessions(hostile)).toEqual([]);
    expect(() => activateSession(hostile, 'gm', 'camp-1')).not.toThrow();
    expect(() => dropSession(hostile)).not.toThrow();
    expect(() => dropSessionForToken(hostile, 'gm-token')).not.toThrow();
    expect(() => dropAllSessions(hostile)).not.toThrow();
    expect(() => noteCampaignNames(hostile, new Map([['camp-1', 'Static']]))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The campaign axis — several tables, one browser, session after session
// ---------------------------------------------------------------------------

describe('several campaigns coexist', () => {
  it('a second table does not evict the first: both gm tokens survive', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    writeSession(tabA, sess('gm', 'gm-b', 'camp-b'));

    // Newest first within a role, so "that role's session" still means the
    // one in the chair.
    expect(readSessions(tabA).map((s) => s.campaignId)).toEqual(['camp-b', 'camp-a']);
    expect(resolveSession(tabA)?.token).toBe('gm-b');
    expect(tokensOf(readSessions(tabA))).toEqual(['gm-a', 'gm-b']);
  });

  it('switching between them preserves both', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    writeSession(tabA, sess('gm', 'gm-b', 'camp-b'));

    expect(activateSession(tabA, 'gm', 'camp-a')?.token).toBe('gm-a');
    expect(resolveSession(tabA)?.token).toBe('gm-a');
    expect(tokensOf(readSessions(tabA))).toEqual(['gm-a', 'gm-b']);

    expect(activateSession(tabA, 'gm', 'camp-b')?.token).toBe('gm-b');
    expect(resolveSession(tabA)?.token).toBe('gm-b');
    expect(tokensOf(readSessions(tabA))).toEqual(['gm-a', 'gm-b']);
  });

  it('a second table joined in another tab does not move a pinned gm tab', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    expect(resolveSession(tabA)?.campaignId).toBe('camp-a');

    writeSession(tabB, sess('gm', 'gm-b', 'camp-b'));

    expect(resolveSession(tabB)?.token).toBe('gm-b');
    expect(resolveSession(tabA)?.token).toBe('gm-a');
  });

  it('holds the same campaign as gm and player at once — two devices, two rows', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    writeSession(tabB, sess('player', 'p-a', 'camp-a'));
    expect(readSessions(tabA).map(sessionKey)).toEqual(['gm:camp-a', 'player:camp-a']);
    expect(resolveSession(tabA)?.token).toBe('gm-a');
    expect(resolveSession(tabB)?.token).toBe('p-a');
  });

  it('a tab pinned by the previous build (role, no campaign) still resolves', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    writeSession(tabA, sess('gm', 'gm-b', 'camp-b'));

    const oldTab: SessionStores = { local, tab: new Mem() };
    oldTab.tab?.setItem(TAB_ROLE_KEY, 'gm'); // no campaign half — the old format

    expect(resolveSession(oldTab)?.token).toBe('gm-b');
    // …and resolving completes the pin, so it is a full pin from here on.
    expect(readTabCampaign(oldTab)).toBe('camp-b');
  });

  it('keeps the tab in the same role when its pinned campaign is signed out', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    writeSession(tabB, sess('gm', 'gm-b', 'camp-b'));
    expect(resolveSession(tabA)?.token).toBe('gm-a');

    dropSession(tabB, 'gm', 'camp-a'); // signed out from the other tab

    expect(resolveSession(tabA)?.token).toBe('gm-b');
    expect(readTabRole(tabA)).toBe('gm');
  });

  it('caps the roster rather than growing until the browser refuses to write', () => {
    for (let i = 0; i < ROSTER_LIMIT + 4; i += 1) {
      writeSession(tabA, sess('gm', `t-${i}`, `camp-${i}`));
    }
    const stored = readSessions(tabA);
    expect(stored).toHaveLength(ROSTER_LIMIT);
    expect(stored[0]?.token).toBe(`t-${ROSTER_LIMIT + 3}`);
    expect(stored.some((s) => s.token === 't-0')).toBe(false);
  });
});

describe('sign-out is campaign-scoped', () => {
  it('signing this device out leaves the GM other table alone', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    writeSession(tabB, sess('gm', 'gm-b', 'camp-b'));

    dropSession(tabB); // tab B is looking at camp-b

    expect(readSessions(tabB).map((s) => s.campaignId)).toEqual(['camp-a']);
    expect(resolveSession(tabA)?.token).toBe('gm-a');
  });

  it('an explicit role with no campaign still signs that role out everywhere', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    writeSession(tabA, sess('gm', 'gm-b', 'camp-b'));
    writeSession(tabB, sess('player', 'p-a', 'camp-a'));

    dropSession(tabB, 'gm');

    expect(tokensOf(readSessions(tabB))).toEqual(['p-a']);
    expect(local.getItem(`${SESSION_PREFIX}gm`)).toBeNull();
  });

  it('a 401 retires only the token that earned it', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    writeSession(tabA, sess('gm', 'gm-b', 'camp-b'));
    writeSession(tabB, sess('player', 'p-a', 'camp-a'));

    dropSessionForToken(tabA, 'gm-a');

    expect(tokensOf(readSessions(tabA))).toEqual(['gm-b', 'p-a']);
    // The role slot follows the survivor rather than pointing at a dead token.
    expect(JSON.parse(local.getItem(`${SESSION_PREFIX}gm`) ?? 'null')?.token).toBe('gm-b');
  });

  it('ignores a token nothing is stored under', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    dropSessionForToken(tabA, 'never-minted');
    expect(tokensOf(readSessions(tabA))).toEqual(['gm-a']);
  });
});

describe('switching devices', () => {
  it('activateSession moves this tab only', () => {
    writeSession(tabA, sess('gm'));
    writeSession(tabB, sess('player'));

    expect(activateSession(tabA, 'player')?.role).toBe('player');
    expect(resolveSession(tabA)?.role).toBe('player');
    expect(resolveSession(tabB)?.role).toBe('player');

    expect(activateSession(tabA, 'gm')?.role).toBe('gm');
    expect(resolveSession(tabA)?.role).toBe('gm');
  });

  it('returns null for a role with no stored session', () => {
    writeSession(tabA, sess('gm'));
    expect(activateSession(tabA, 'observer')).toBeNull();
    expect(activateSession(tabA, 'gm', 'camp-nope')).toBeNull();
    expect(resolveSession(tabA)?.role).toBe('gm');
  });

  it('re-resolves when the pinned role is signed out elsewhere', () => {
    writeSession(tabA, sess('gm'));
    writeSession(tabB, sess('player'));
    dropSession(tabB, 'gm'); // the GM signs the console out from another tab
    expect(resolveSession(tabA)?.role).toBe('player');
  });
});

describe('sign-out', () => {
  it('drops one role and leaves the others alone', () => {
    writeSession(tabA, sess('gm'));
    writeSession(tabB, sess('player'));
    dropSession(tabB); // tab B is the player tab
    expect(readSessions(tabA).map((s) => s.role)).toEqual(['gm']);
    expect(resolveSession(tabA)?.role).toBe('gm');
  });

  it('dropAllSessions clears every slot, the roster, the pointer and the pin', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    writeSession(tabA, sess('gm', 'gm-b', 'camp-b'));
    writeSession(tabB, sess('player'));
    dropAllSessions(tabA);
    expect(readSessions(tabA)).toEqual([]);
    expect(readActiveRole(tabA)).toBeNull();
    expect(readTabRole(tabA)).toBeNull();
    expect(local.getItem(ROSTER_KEY)).toBeNull();
    expect(local.getItem(ACTIVE_CAMPAIGN_KEY)).toBeNull();
    expect(tabA.tab?.getItem(TAB_CAMPAIGN_KEY)).toBeNull();
  });
});

describe('legacy single-key sessions', () => {
  it('reads the hand-written safehouse.session blob the old docs told GMs to set', () => {
    local.setItem(LEGACY_KEY, JSON.stringify(sess('gm', 'hand-written')));
    expect(resolveSession(tabA)?.token).toBe('hand-written');
  });

  it('retires the legacy blob once that role signs in properly', () => {
    local.setItem(LEGACY_KEY, JSON.stringify(sess('gm', 'hand-written')));
    writeSession(tabA, sess('gm', 'minted'));
    expect(local.getItem(LEGACY_KEY)).toBeNull();
    expect(resolveSession(tabA)?.token).toBe('minted');
  });

  it('does not let a legacy blob shadow another role', () => {
    local.setItem(LEGACY_KEY, JSON.stringify(sess('gm', 'hand-written')));
    writeSession(tabB, sess('player'));
    expect(resolveSession(tabB)?.role).toBe('player');
    expect(readSessions(tabB).map((s) => s.role)).toEqual(['gm', 'player']);
  });

  it('migrates the legacy blob into the roster instead of losing it to a new table', () => {
    local.setItem(LEGACY_KEY, JSON.stringify(sess('gm', 'hand-written', 'camp-old')));
    writeSession(tabA, sess('gm', 'gm-new', 'camp-new'));
    expect(local.getItem(LEGACY_KEY)).toBeNull();
    expect(tokensOf(readSessions(tabA))).toEqual(['gm-new', 'hand-written']);
    expect(activateSession(tabA, 'gm', 'camp-old')?.token).toBe('hand-written');
  });

  it('still reads a browser that only ever had the per-role slot', () => {
    local.setItem(`${SESSION_PREFIX}gm`, JSON.stringify(sess('gm', 'only-slot', 'camp-a')));
    expect(resolveSession(tabA)?.token).toBe('only-slot');
  });

  it('ignores junk and mismatched slots rather than trusting them', () => {
    local.setItem(LEGACY_KEY, 'not json');
    local.setItem(ROSTER_KEY, 'not json either');
    local.setItem(`${SESSION_PREFIX}player`, JSON.stringify(sess('gm', 'smuggled')));
    local.setItem(ACTIVE_ROLE_KEY, 'wizard');
    expect(readSessions(tabA)).toEqual([]);
    expect(readActiveRole(tabA)).toBeNull();
  });

  it('drops roster entries that are not sessions but keeps the ones that are', () => {
    local.setItem(
      ROSTER_KEY,
      JSON.stringify([null, 'nope', { role: 'gm' }, sess('gm', 'kept', 'camp-a')]),
    );
    expect(tokensOf(readSessions(tabA))).toEqual(['kept']);
  });

  it('rejects a session missing a token, role or campaign', () => {
    local.setItem(`${SESSION_PREFIX}gm`, JSON.stringify({ role: 'gm', campaignId: 'c' }));
    expect(readSessions(tabA)).toEqual([]);
  });
});

describe('the per-role slot stays the one-getItem mirror', () => {
  it('follows whichever campaign that role is currently in', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    writeSession(tabA, sess('gm', 'gm-b', 'camp-b'));
    expect(JSON.parse(local.getItem(`${SESSION_PREFIX}gm`) ?? 'null')?.token).toBe('gm-b');

    activateSession(tabA, 'gm', 'camp-a');
    expect(JSON.parse(local.getItem(`${SESSION_PREFIX}gm`) ?? 'null')?.token).toBe('gm-a');
  });
});

describe('campaign names', () => {
  it('labels stored sessions once the server has named the campaign', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    writeSession(tabB, sess('player', 'p-b', 'camp-b'));

    noteCampaignNames(tabA, new Map([['camp-a', 'Static on the Line']]));

    const stored = readSessions(tabA);
    expect(stored.find((s) => s.campaignId === 'camp-a')?.campaignName).toBe('Static on the Line');
    expect(stored.find((s) => s.campaignId === 'camp-b')?.campaignName).toBeUndefined();
    // A label is never allowed to cost a token.
    expect(tokensOf(stored)).toEqual(['gm-a', 'p-b']);
  });

  it('is a no-op when there is nothing new to say', () => {
    writeSession(tabA, sess('gm', 'gm-a', 'camp-a'));
    const before = local.getItem(ROSTER_KEY);
    noteCampaignNames(tabA, new Map());
    noteCampaignNames(tabA, new Map([['camp-zzz', 'Someone else']]));
    expect(local.getItem(ROSTER_KEY)).toBe(before);
  });
});

describe('sessionFrom', () => {
  it('normalises a join response, dropping absent optionals', () => {
    expect(
      sessionFrom({
        token: 't',
        role: 'player',
        campaignId: 'c1',
        deviceId: 'd1',
        user: { id: 'u1', displayName: 'Static' },
      }),
    ).toEqual({
      token: 't',
      role: 'player',
      campaignId: 'c1',
      deviceId: 'd1',
      userId: 'u1',
      displayName: 'Static',
    });
    expect(sessionFrom({ token: 't', role: 'gm', campaignId: 'c1', deviceId: 'd1' })).toEqual({
      token: 't',
      role: 'gm',
      campaignId: 'c1',
      deviceId: 'd1',
    });
  });
});

describe('tab pin bookkeeping', () => {
  it('writes both halves of the pin under the documented keys', () => {
    writeSession(tabA, sess('display', 'tv', 'camp-a'));
    expect(tabA.tab?.getItem(TAB_ROLE_KEY)).toBe('display');
    expect(tabA.tab?.getItem(TAB_CAMPAIGN_KEY)).toBe('camp-a');
    expect(local.getItem(ACTIVE_ROLE_KEY)).toBe('display');
    expect(local.getItem(ACTIVE_CAMPAIGN_KEY)).toBe('camp-a');
  });

  it('names a session by the pair, so two gm tables never share a key', () => {
    expect(sessionKey(sess('gm', 'a', 'camp-a'))).not.toBe(sessionKey(sess('gm', 'b', 'camp-b')));
    expect(sessionKey({ role: 'gm', campaignId: 'camp-a' })).toBe('gm:camp-a');
  });
});
