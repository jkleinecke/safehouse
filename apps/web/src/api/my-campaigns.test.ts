/**
 * The campaign list and the loopback recovery (P1/P3, client half).
 *
 * Two properties matter more than the plumbing and are asserted first: a
 * refusal from `POST /api/gm/recover` is silent — it is the correct answer on
 * every device that is not the machine hosting the server, so it must never
 * throw into React or surface as an error — and one dead token among several
 * must not take the campaign list down with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCampaignsForTokens,
  mergeCampaignCards,
  probeGmRecovery,
  recoverGmSession,
  type CampaignMembership,
} from './my-campaigns.js';
import { listSessions, type Session } from './session.js';

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

/** `Response`-alike: the wrapper only reads ok/status/statusText/text(). */
function reply(status: number, body: unknown): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  };
}

const refusal = reply(403, { error: { code: 'forbidden', message: 'not loopback' } });

function bearerOf(init: unknown): string {
  const headers = (init as { headers?: Record<string, string> } | undefined)?.headers ?? {};
  return (headers['Authorization'] ?? '').replace(/^Bearer /, '');
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new Mem());
  vi.stubGlobal('sessionStorage', new Mem());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function session(role: Session['role'], token: string, campaignId: string): Session {
  return { token, role, campaignId };
}

describe('probeGmRecovery', () => {
  it('lists what the host machine holds, as gm rows, minting nothing', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', (url: string, init: { method?: string }) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`);
      return Promise.resolve(
        reply(200, {
          available: true,
          campaigns: [
            { id: 'camp-a', name: 'Static on the Line', lastPlayedAt: '2076-05-12T00:00:00Z' },
            { id: 'camp-b', name: 'Bad Debts' },
          ],
        }),
      );
    });

    const hosted = await probeGmRecovery();
    expect(seen).toEqual(['GET /api/gm/recover']);
    expect(hosted.map((c) => [c.id, c.role])).toEqual([
      ['camp-a', 'gm'],
      ['camp-b', 'gm'],
    ]);
    expect(hosted[0]?.lastPlayedAt).toBe('2076-05-12T00:00:00Z');
    expect(listSessions()).toEqual([]);
  });

  it('is empty and silent on every device that is not the host', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(refusal));
    await expect(probeGmRecovery()).resolves.toEqual([]);

    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));
    await expect(probeGmRecovery()).resolves.toEqual([]);
  });

  it('ignores rows it cannot use', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(reply(200, { campaigns: [null, 'x', { name: 'no id' }, { id: 'camp-a' }] })),
    );
    const hosted = await probeGmRecovery();
    expect(hosted.map((c) => c.id)).toEqual(['camp-a']);
    expect(hosted[0]?.name).toBe('');
  });
});

describe('recoverGmSession', () => {
  it('hands back the GM device the host machine minted — without storing it', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        reply(200, {
          token: 'gm-tok',
          role: 'gm',
          campaignId: 'camp-a',
          deviceId: 'dev-1',
          user: { id: 'u1', displayName: 'GM' },
        }),
      ),
    );

    const recovered = await recoverGmSession();
    expect(recovered?.token).toBe('gm-tok');
    expect(recovered?.role).toBe('gm');
    expect(recovered?.campaignId).toBe('camp-a');
    // Opening the front door on the host machine must not sign this browser
    // in on its own — the GM picking a table is the consent, and it is also
    // what keeps "start a campaign" honest for a browser that has not picked.
    expect(listSessions()).toEqual([]);
  });

  it('is silent when the server refuses — the normal answer on a player phone', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(refusal));
    await expect(recoverGmSession()).resolves.toBeNull();
    expect(listSessions()).toEqual([]);
  });

  it('is silent when the route does not exist or the box is unreachable', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(reply(404, undefined)));
    await expect(recoverGmSession()).resolves.toBeNull();

    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));
    await expect(recoverGmSession()).resolves.toBeNull();
    expect(listSessions()).toEqual([]);
  });

  it('refuses an answer that is not a gm device', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(reply(200, { token: 't', role: 'player', campaignId: 'c', deviceId: 'd' })),
    );
    await expect(recoverGmSession()).resolves.toBeNull();
    expect(listSessions()).toEqual([]);
  });

  it('names the campaign it wants back when the picker knows which one', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', (_url: string, init: { body?: string }) => {
      bodies.push(init.body ?? '');
      return Promise.resolve(refusal);
    });
    await recoverGmSession('camp-b');
    expect(bodies).toEqual([JSON.stringify({ campaignId: 'camp-b' })]);
  });
});

describe('fetchCampaignsForTokens', () => {
  it('asks once per token and merges the answers by campaign id', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (_url: string, init: unknown) => {
      const token = bearerOf(init);
      asked.push(token);
      return Promise.resolve(
        reply(200, {
          campaigns:
            token === 'gm-tok'
              ? [{ id: 'camp-a', name: 'Static on the Line', role: 'gm' }]
              : [
                  { id: 'camp-a', name: 'Static on the Line', role: 'player' },
                  { id: 'camp-b', name: 'Bad Debts', role: 'player' },
                ],
        }),
      );
    });

    const rows = await fetchCampaignsForTokens(['gm-tok', 'p-tok', 'gm-tok']);
    expect(asked.sort()).toEqual(['gm-tok', 'p-tok']);
    expect(rows.map((r) => r.id).sort()).toEqual(['camp-a', 'camp-b']);
  });

  it('drops a token the server rejects instead of failing the whole list', async () => {
    vi.stubGlobal('fetch', (_url: string, init: unknown) =>
      Promise.resolve(
        bearerOf(init) === 'dead'
          ? reply(401, { error: { code: 'unauthorized', message: 'nope' } })
          : reply(200, { campaigns: [{ id: 'camp-a', name: 'Static', role: 'gm' }] }),
      ),
    );

    const rows = await fetchCampaignsForTokens(['dead', 'good']);
    expect(rows.map((r) => r.id)).toEqual(['camp-a']);
  });

  it('ignores rows that are not memberships and caps how many tokens it asks', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      return Promise.resolve(
        reply(200, { campaigns: [null, { id: 'x' }, { id: 'camp-a', name: 'Static', role: 'gm' }] }),
      );
    });

    const rows = await fetchCampaignsForTokens(['a', 'b', 'c', 'd', 'e', 'f'], 3);
    expect(calls).toBe(3);
    expect(rows.map((r) => r.id)).toEqual(['camp-a']);
  });
});

describe('mergeCampaignCards', () => {
  const listed: CampaignMembership[] = [
    { id: 'camp-a', name: 'Static on the Line', role: 'gm', lastPlayedAt: '2076-05-12T00:00:00Z' },
    { id: 'camp-b', name: 'Bad Debts', role: 'gm', lastPlayedAt: '2076-06-01T00:00:00Z' },
    { id: 'camp-c', name: 'Ashes', role: 'player' },
  ];

  it('leads with the campaigns this browser can actually open', () => {
    const cards = mergeCampaignCards([session('gm', 'gm-a', 'camp-a')], listed);
    expect(cards[0]?.campaignId).toBe('camp-a');
    expect(cards[0]?.session?.token).toBe('gm-a');
    expect(cards.slice(1).every((c) => c.session === undefined)).toBe(true);
  });

  it('still offers the campaigns whose device is on the other laptop', () => {
    const cards = mergeCampaignCards([session('gm', 'gm-a', 'camp-a')], listed);
    // Newest table first among the ones we hold no token for.
    expect(cards.slice(1).map((c) => c.campaignId)).toEqual(['camp-b', 'camp-c']);
  });

  it('lists a campaign held as two roles twice — two devices, two destinations', () => {
    const cards = mergeCampaignCards(
      [session('gm', 'gm-a', 'camp-a'), session('player', 'p-a', 'camp-a')],
      listed,
    );
    expect(cards.filter((c) => c.campaignId === 'camp-a').map((c) => c.role)).toEqual([
      'gm',
      'player',
    ]);
  });

  it('works with no server answer at all — a stored session is enough to get back in', () => {
    const cards = mergeCampaignCards(
      [{ ...session('gm', 'gm-a', 'camp-a'), campaignName: 'Static on the Line' }],
      [],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.name).toBe('Static on the Line');
    expect(cards[0]?.session?.token).toBe('gm-a');
  });

  it('prefers the name the server just gave over the one we cached', () => {
    const cards = mergeCampaignCards(
      [{ ...session('gm', 'gm-a', 'camp-a'), campaignName: 'Old Name' }],
      [{ id: 'camp-a', name: 'Static on the Line', role: 'gm' }],
    );
    expect(cards[0]?.name).toBe('Static on the Line');
  });

  it('still offers a GM recovery for a table this browser only holds as a player', () => {
    const cards = mergeCampaignCards(
      [session('player', 'p-a', 'camp-a')],
      [{ id: 'camp-a', name: 'Static on the Line', role: 'gm' }],
    );
    expect(cards.map((c) => [c.role, c.session === undefined])).toEqual([
      ['player', false],
      ['gm', true],
    ]);
  });

  it('does not repeat a row two sources both named', () => {
    const row: CampaignMembership = { id: 'camp-b', name: 'Bad Debts', role: 'gm' };
    expect(mergeCampaignCards([], [row, { ...row }])).toHaveLength(1);
  });

  it('has nothing to show when there is nothing stored and nothing listed', () => {
    expect(mergeCampaignCards([], [])).toEqual([]);
  });
});
