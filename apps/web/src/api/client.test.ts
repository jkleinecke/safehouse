/**
 * What the fetch wrapper does with a 401.
 *
 * `getSession()` reads storage and nothing else, so a revoked token still
 * "resolves": the app used to render the whole GM console over a dead device
 * while every call 401'd in silence, and the only way out was a header menu
 * item nobody knew to open. The wrapper is where the server's answer is
 * actually seen, so it is where the dead token is retired — the exact token,
 * never the role and never another campaign's session, because a GM running
 * two tables must not lose the good one to the bad one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SESSION_EXPIRED_EVENT, api, type SessionExpiredDetail } from './client.js';
import { listSessions, saveSession, type Session } from './session.js';

class Mem {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function reply(status: number, body: unknown): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  };
}

const unauthorized = () =>
  Promise.resolve(reply(401, { error: { code: 'unauthorized', message: 'authentication required' } }));

function sess(role: Session['role'], token: string, campaignId: string): Session {
  return { token, role, campaignId };
}

let announced: SessionExpiredDetail[];

beforeEach(() => {
  vi.stubGlobal('localStorage', new Mem());
  vi.stubGlobal('sessionStorage', new Mem());
  announced = [];
  // Node has no `globalThis.dispatchEvent`; the wrapper checks for one and
  // stays quiet without it, so the test supplies the browser's half.
  vi.stubGlobal('dispatchEvent', (event: Event) => {
    const detail = (event as CustomEvent<SessionExpiredDetail>).detail;
    if (event.type === SESSION_EXPIRED_EVENT && detail) announced.push(detail);
    return true;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a 401 retires the token that earned it', () => {
  it('clears that session and says so once', async () => {
    saveSession(sess('gm', 'gm-a', 'camp-a'));
    vi.stubGlobal('fetch', unauthorized);

    await expect(api('/api/campaigns/camp-a')).rejects.toBeInstanceOf(ApiError);

    expect(listSessions()).toEqual([]);
    expect(announced).toEqual([{ token: 'gm-a', path: '/api/campaigns/camp-a' }]);
  });

  it('leaves the GM other table signed in', async () => {
    saveSession(sess('gm', 'gm-a', 'camp-a'));
    saveSession(sess('gm', 'gm-b', 'camp-b'));
    // The failing request carries the OTHER table's token, not the current one.
    vi.stubGlobal('fetch', unauthorized);

    await expect(
      api('/api/campaigns/camp-a', {
        anonymous: true,
        headers: { Authorization: 'Bearer gm-a' },
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(listSessions().map((s) => s.token)).toEqual(['gm-b']);
  });

  it('leaves everything alone for a 403 — a role guard is not a dead token', async () => {
    saveSession(sess('player', 'p-a', 'camp-a'));
    vi.stubGlobal('fetch', () =>
      Promise.resolve(reply(403, { error: { code: 'forbidden', message: 'requires role: gm' } })),
    );

    await expect(api('/api/campaigns/camp-a/gm-pair', { method: 'POST' })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(listSessions().map((s) => s.token)).toEqual(['p-a']);
    expect(announced).toEqual([]);
  });

  it('keeps quiet for the calls that expect a 401', async () => {
    saveSession(sess('gm', 'gm-a', 'camp-a'));
    vi.stubGlobal('fetch', unauthorized);

    // Proving a pasted token, and the loopback recovery probe: a refusal there
    // is about the request, not about anything this browser has stored.
    await expect(
      api('/api/campaigns/camp-a', {
        anonymous: true,
        keepSessionOn401: true,
        headers: { Authorization: 'Bearer gm-a' },
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(listSessions().map((s) => s.token)).toEqual(['gm-a']);
    expect(announced).toEqual([]);
  });

  it('has nothing to retire when no token was sent', async () => {
    vi.stubGlobal('fetch', unauthorized);
    await expect(api('/api/join/ABCD2345', { anonymous: true })).rejects.toBeInstanceOf(ApiError);
    expect(announced).toEqual([]);
  });

  it('does not throw when there is no event target to tell', async () => {
    saveSession(sess('gm', 'gm-a', 'camp-a'));
    vi.stubGlobal('dispatchEvent', undefined);
    vi.stubGlobal('fetch', unauthorized);

    await expect(api('/api/campaigns/camp-a')).rejects.toBeInstanceOf(ApiError);
    expect(listSessions()).toEqual([]);
  });
});
