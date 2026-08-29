/**
 * Session storage rules (FR1.1/1.3) — and specifically the same-origin session
 * collision found by driving the real app: a GM keeps a player view open in a
 * second tab of the same browser, and the join wipes the GM out.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@safehouse/contracts';
import {
  ACTIVE_ROLE_KEY,
  LEGACY_KEY,
  SESSION_PREFIX,
  TAB_ROLE_KEY,
  activateSession,
  dropAllSessions,
  dropSession,
  readActiveRole,
  readSessions,
  readTabRole,
  resolveSession,
  sessionFrom,
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

function sess(role: Role, token = `${role}-token`): Session {
  return { token, role, campaignId: 'camp-1', deviceId: `dev-${role}`, userId: `u-${role}` };
}

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

  it('dropAllSessions clears every slot, the pointer and the pin', () => {
    writeSession(tabA, sess('gm'));
    writeSession(tabB, sess('player'));
    dropAllSessions(tabA);
    expect(readSessions(tabA)).toEqual([]);
    expect(readActiveRole(tabA)).toBeNull();
    expect(readTabRole(tabA)).toBeNull();
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

  it('ignores junk and mismatched slots rather than trusting them', () => {
    local.setItem(LEGACY_KEY, 'not json');
    local.setItem(`${SESSION_PREFIX}player`, JSON.stringify(sess('gm', 'smuggled')));
    local.setItem(ACTIVE_ROLE_KEY, 'wizard');
    expect(readSessions(tabA)).toEqual([]);
    expect(readActiveRole(tabA)).toBeNull();
  });

  it('rejects a session missing a token, role or campaign', () => {
    local.setItem(`${SESSION_PREFIX}gm`, JSON.stringify({ role: 'gm', campaignId: 'c' }));
    expect(readSessions(tabA)).toEqual([]);
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
  it('writes the pin under the documented key', () => {
    writeSession(tabA, sess('display'));
    expect(tabA.tab?.getItem(TAB_ROLE_KEY)).toBe('display');
    expect(local.getItem(ACTIVE_ROLE_KEY)).toBe('display');
  });
});
