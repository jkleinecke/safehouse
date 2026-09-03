/**
 * Loading a campaign back in, session after session (FR1.1/1.2, DESIGN.md §13).
 *
 * The user-facing problem: "the GM hosts the server on their laptop and we play
 * over months — I should not have to remember a token." Three server pieces
 * answer it, and each one is a place a secrecy or privilege guarantee could be
 * lost, so each is pinned here:
 *
 * - `GET /api/campaigns` — the list that makes "open the browser and pick up
 *   where we left off" possible at all. Scoped by `memberships` for the
 *   authenticated user, SERVER-side (Principle 4): a second GM sharing the box
 *   must not see the first one's table, and no branch may return a campaign the
 *   caller is not a member of.
 * - `POST /api/gm/recover` — the only token in the app minted with no secret.
 *   It is safe for exactly one reason: the request provably arrived on the
 *   machine hosting the server, where the caller could read the database off
 *   the disk anyway. Everything therefore rests on `assertLoopbackOrigin`, so
 *   it is tested from three directions — the pure predicate, the route through
 *   a spoofed socket address, and the route with a forwarding header present.
 * - `pnpm gm:token` — the same mint from a shell, for Docker (where a bridge
 *   network makes the host indistinguishable from a LAN client, so the route
 *   correctly refuses) and for a GM on another machine.
 *
 * The escalation question is asked explicitly: a player device must gain
 * nothing from any of this. Note what "no escalation" means for the recovery
 * route — from loopback a player token buys nothing an anonymous request does
 * not already get, because the route ignores `req.auth` entirely and reads the
 * owner from `campaigns.gm_user_id`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { users } from '@safehouse/db';
import {
  assertLoopbackOrigin,
  forwardedHeader,
  isLoopbackAddress,
  openTableMode,
} from '../src/services/auth.js';
import {
  describeTarget,
  mintGmSignIn,
  parseArgs,
  pickCampaign,
  resolveOrigin,
} from '../scripts/gm-token.js';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
/** A second campaign owned by the same GM — proves the list is per-user. */
let second: { campaignId: string; token: string };
let player: JoinResult;
let display: JoinResult;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface CampaignRow {
  id: string;
  name: string;
  role: string;
  createdAt: string;
  lastPlayedAt: string | null;
}

/** Can this token still act as the GM of `campaignId`? (mint an invite). */
async function canGm(campaignId: string, token: string): Promise<number> {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/campaigns/${campaignId}/invites`,
    headers: auth(token),
    payload: { role: 'player' },
  });
  return res.statusCode;
}

async function userCount(): Promise<number> {
  const rows = await t.db.select({ n: sql<number>`count(*)::int` }).from(users);
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  t = await makeTestApp('auth-recovery');
  boot = await bootstrapCampaign(t.app, 'Neon Rain');

  const res = await t.app.inject({
    method: 'POST',
    url: '/api/campaigns',
    headers: auth(boot.gmToken),
    payload: { name: 'Bug City' },
  });
  expect(res.statusCode).toBe(201);
  const created = res.json() as { campaignId: string; token: string };
  second = { campaignId: created.campaignId, token: created.token };

  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Sam');
  display = await joinAs(t.app, boot.campaignId, boot.gmToken, 'display', 'Table TV');

  // One event on Neon Rain, so `lastPlayedAt` has something to report.
  const patched = await t.app.inject({
    method: 'PATCH',
    url: `/api/campaigns/${boot.campaignId}`,
    headers: auth(boot.gmToken),
    payload: { ingameDate: '2081-03-04' },
  });
  expect(patched.statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await t.close();
});

// ---------------------------------------------------------------------------
// P1 — GET /api/campaigns
// ---------------------------------------------------------------------------

describe('GET /api/campaigns', () => {
  it('lists both campaigns the GM owns, newest first, with when each was played', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/campaigns',
      headers: auth(boot.gmToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { campaigns: CampaignRow[] }).campaigns;
    expect(rows.map((r) => r.name)).toEqual(['Bug City', 'Neon Rain']);
    expect(rows.every((r) => r.role === 'gm')).toBe(true);
    expect(rows.every((r) => typeof r.createdAt === 'string')).toBe(true);

    const neonRain = rows.find((r) => r.id === boot.campaignId)!;
    expect(neonRain.lastPlayedAt).toEqual(expect.any(String));
    // Bug City has never been played — that is null, not a missing field.
    expect(rows.find((r) => r.id === second.campaignId)!.lastPlayedAt).toBeNull();
  });

  it("does not show a player the GM's other campaign", async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/campaigns',
      headers: auth(player.token),
    });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { campaigns: CampaignRow[] }).campaigns;
    expect(rows.map((r) => r.id)).toEqual([boot.campaignId]);
    expect(rows[0]!.role).toBe('player');
    expect(rows.some((r) => r.id === second.campaignId)).toBe(false);
  });

  it('reports the kiosk as observer — the membership role, not the device role', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/campaigns',
      headers: auth(display.token),
    });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { campaigns: CampaignRow[] }).campaigns;
    expect(rows.map((r) => r.id)).toEqual([boot.campaignId]);
    // §13: a display device has an observer membership and zero capabilities.
    expect(rows[0]!.role).toBe('observer');
  });

  it('is 401 without a token', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/campaigns' });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('is 401 for a revoked device, and leaks nothing on the way out', async () => {
    const doomed = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Lost phone');
    const revoked = await t.app.inject({
      method: 'POST',
      url: `/api/devices/${doomed.deviceId}/revoke`,
      headers: auth(doomed.token),
    });
    expect(revoked.statusCode).toBe(200);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/campaigns',
      headers: auth(doomed.token),
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('Neon Rain');
  });
});

// ---------------------------------------------------------------------------
// P3 — the loopback predicate, which IS the security decision
// ---------------------------------------------------------------------------

describe('isLoopbackAddress', () => {
  it('accepts every spelling of "this machine"', () => {
    for (const addr of [
      '127.0.0.1',
      '127.0.0.53',
      '127.94.0.1',
      '::1',
      '0:0:0:0:0:0:0:1',
      '::ffff:127.0.0.1',
      '::1%lo0',
      '[::1]',
      '  127.0.0.1  ',
    ]) {
      expect(isLoopbackAddress(addr), addr).toBe(true);
    }
  });

  it('rejects everything else, including the addresses that look close', () => {
    for (const addr of [
      '192.168.1.20',
      '10.0.0.1',
      '172.17.0.1', // the docker bridge gateway — the host, but not loopback
      '0.0.0.0',
      '::',
      '::ffff:192.168.1.20',
      '128.0.0.1',
      '127.0.0.1.evil.com',
      '1270.0.0.1',
      '999.0.0.1',
      'localhost',
      '',
      null,
      undefined,
    ]) {
      expect(isLoopbackAddress(addr), String(addr)).toBe(false);
    }
  });
});

describe('forwardedHeader', () => {
  it('names any header that says the real client is somewhere else', () => {
    expect(forwardedHeader({ 'x-forwarded-for': '203.0.113.9' })).toBe('x-forwarded-for');
    expect(forwardedHeader({ 'x-real-ip': '203.0.113.9' })).toBe('x-real-ip');
    expect(forwardedHeader({ forwarded: 'for=203.0.113.9' })).toBe('forwarded');
    // A TLS terminator that sets only this still hides the whole LAN behind it.
    expect(forwardedHeader({ 'x-forwarded-proto': 'https' })).toBe('x-forwarded-proto');
  });

  it('passes an ordinary request through', () => {
    expect(forwardedHeader({ host: 'localhost:8787', accept: '*/*' })).toBeNull();
  });
});

describe('assertLoopbackOrigin', () => {
  const fake = (over: Record<string, unknown>): FastifyRequest =>
    ({ headers: {}, socket: { remoteAddress: '127.0.0.1' }, ...over }) as unknown as FastifyRequest;

  it('permits a plain loopback request', () => {
    expect(() => assertLoopbackOrigin(fake({}))).not.toThrow();
  });

  it('refuses when trustProxy is on, even from loopback', () => {
    // Fastify only defines `ips` when trustProxy is enabled — and with it on,
    // every LAN client behind the proxy would present as loopback.
    expect(() => assertLoopbackOrigin(fake({ ips: ['127.0.0.1'] }))).toThrow(/GM recovery/);
  });

  it('refuses a spoofed loopback socket address it cannot see', () => {
    expect(() => assertLoopbackOrigin(fake({ socket: { remoteAddress: '192.168.1.20' } }))).toThrow(
      /GM recovery/,
    );
  });

  // The socket answers "did this come from this machine", not "did the person
  // at this machine ask for it". A browser can be made to ask on somebody
  // else's behalf over a perfectly genuine loopback socket, and only the two
  // headers it writes itself tell the two apart.
  describe('the browser cases the socket cannot see', () => {
    it('refuses a DNS-rebound page: real loopback socket, somebody else\'s Host', () => {
      // `evil.example` re-resolves to 127.0.0.1 after its page has loaded, so
      // the fetch is SAME-ORIGIN with the attacker's script and it reads the
      // token out of the reply. Everything but `Host` looks local.
      expect(() =>
        assertLoopbackOrigin(fake({ headers: { host: 'evil.example:8787' } })),
      ).toThrow(/GM recovery/);
    });

    it('refuses a cross-origin POST from a page this machine did not serve', () => {
      // No Content-Type, no preflight, straight to the handler — the reply is
      // unreadable without CORS but the device row would be minted anyway.
      expect(() =>
        assertLoopbackOrigin(
          fake({ headers: { host: 'localhost:8787', origin: 'http://evil.example' } }),
        ),
      ).toThrow(/GM recovery/);
      // A sandboxed iframe or a cross-origin redirect: the browser saying it
      // will not vouch for where the page came from.
      expect(() =>
        assertLoopbackOrigin(fake({ headers: { host: 'localhost:8787', origin: 'null' } })),
      ).toThrow(/GM recovery/);
    });

    it('refuses the box\'s own LAN name, which is how everyone else reaches it', () => {
      for (const headers of [
        { host: '192.168.1.20:8787' },
        { host: 'gm-laptop.local' },
        { host: 'localhost:8787', origin: 'http://192.168.1.20:5173' },
        { host: 'localhost@evil.example' }, // authority we cannot parse
        { host: '127.0.0.1.evil.example' },
      ]) {
        expect(() => assertLoopbackOrigin(fake({ headers })), JSON.stringify(headers)).toThrow(
          /GM recovery/,
        );
      }
    });

    it('still permits every honest local client', () => {
      for (const headers of [
        {}, // curl/undici in the container send a Host; a bare probe may not
        { host: 'localhost:8787' },
        { host: '127.0.0.1:8787' },
        { host: '[::1]:8787' },
        { host: 'localhost:8787', origin: 'http://localhost:8787' },
        { host: 'localhost:5173', origin: 'http://localhost:5173' }, // vite dev
        { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787' },
      ]) {
        expect(() => assertLoopbackOrigin(fake({ headers })), JSON.stringify(headers)).not.toThrow();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// P3 — POST /api/gm/recover
// ---------------------------------------------------------------------------

describe('POST /api/gm/recover', () => {
  it('mints a working GM token bound to the existing owner, creating no user', async () => {
    const before = await userCount();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/gm/recover',
      payload: { campaignId: boot.campaignId },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      campaignId: string;
      role: string;
      token: string;
      deviceId: string;
      user: { id: string; displayName: string };
    };
    expect(body.campaignId).toBe(boot.campaignId);
    expect(body.role).toBe('gm');
    // The identity comes from campaigns.gm_user_id — no new GM is invented.
    expect(body.user.id).toBe(boot.gmUserId);
    expect(await userCount()).toBe(before);
    // And the token is a real GM token, not a shape that merely says 'gm'.
    expect(await canGm(boot.campaignId, body.token)).toBe(201);
  });

  it('picks the only campaign when the caller cannot name one', async () => {
    // The whole point: a GM who has lost everything cannot look up a uuid.
    // With one campaign there is nothing to ask; with two there is.
    const res = await t.app.inject({ method: 'POST', url: '/api/gm/recover', payload: {} });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; details: Array<{ id: string }> } };
    expect(body.error.code).toBe('campaign_required');
    expect(body.error.details.map((d) => d.id).sort()).toEqual(
      [boot.campaignId, second.campaignId].sort(),
    );

    const one = await t.app.inject({ method: 'POST', url: '/api/gm/recover', payload: { campaignId: second.campaignId } });
    expect(one.statusCode).toBe(201);
    expect((one.json() as { user: { id: string } }).user.id).toBe(boot.gmUserId);
  });

  it('404s an unknown campaign rather than creating one', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/gm/recover',
      payload: { campaignId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('is REFUSED from a non-loopback socket address', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/gm/recover',
      remoteAddress: '192.168.1.20',
      payload: { campaignId: boot.campaignId },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('forbidden');
    expect(res.body).not.toContain(boot.campaignId);
    expect(res.body).not.toContain('token');
  });

  it('is REFUSED when x-forwarded-for is present even though the socket is loopback', async () => {
    // A reverse proxy makes every LAN client arrive from 127.0.0.1. Fail closed.
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/gm/recover',
      headers: { 'x-forwarded-for': '203.0.113.9' },
      payload: { campaignId: boot.campaignId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('token');
  });

  it('trusts the socket, not req.ip: a spoofed header from the LAN buys nothing', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/gm/recover',
      remoteAddress: '192.168.1.20',
      headers: { 'x-forwarded-for': '127.0.0.1' },
      payload: { campaignId: boot.campaignId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a player device off-host, and grants it nothing extra on-host', async () => {
    const offHost = await t.app.inject({
      method: 'POST',
      url: '/api/gm/recover',
      remoteAddress: '192.168.1.20',
      headers: auth(player.token),
      payload: { campaignId: boot.campaignId },
    });
    expect(offHost.statusCode).toBe(403);

    // From the host it succeeds — but identically to an anonymous call: the
    // route never reads req.auth, so the player token changed nothing.
    const onHost = await t.app.inject({
      method: 'POST',
      url: '/api/gm/recover',
      headers: auth(player.token),
      payload: { campaignId: boot.campaignId },
    });
    expect(onHost.statusCode).toBe(201);
    expect((onHost.json() as { user: { id: string } }).user.id).toBe(boot.gmUserId);
    expect((onHost.json() as { user: { id: string } }).user.id).not.toBe(player.user.id);

    // And the player's OWN token is still a player token afterwards.
    expect(await canGm(boot.campaignId, player.token)).toBe(403);
  });

  it('refuses off-host identically whether or not this server has campaigns', async () => {
    const populated = await t.app.inject({
      method: 'POST',
      url: '/api/gm/recover',
      remoteAddress: '203.0.113.9',
      payload: {},
    });
    const empty = await makeTestApp('auth-recovery-empty');
    try {
      const bare = await empty.app.inject({
        method: 'POST',
        url: '/api/gm/recover',
        remoteAddress: '203.0.113.9',
        payload: {},
      });
      // Byte-identical: an off-host caller cannot use this as an oracle for
      // whether the box holds a campaign at all.
      expect(bare.statusCode).toBe(populated.statusCode);
      expect(bare.body).toBe(populated.body);
    } finally {
      await empty.close();
    }
  }, 120_000);
});

describe('GET /api/gm/recover', () => {
  it('lists the campaigns and their owners to the host, and nobody else', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/gm/recover' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      available: boolean;
      campaigns: Array<{ id: string; name: string; gm: { id: string; displayName: string } }>;
    };
    expect(body.available).toBe(true);
    expect(body.campaigns.map((c) => c.id).sort()).toEqual(
      [boot.campaignId, second.campaignId].sort(),
    );
    expect(body.campaigns[0]!.gm.id).toBe(boot.gmUserId);

    const lan = await t.app.inject({
      method: 'GET',
      url: '/api/gm/recover',
      remoteAddress: '192.168.1.20',
    });
    expect(lan.statusCode).toBe(403);
    expect(lan.body).not.toContain('Neon Rain');
  });
});

// ---------------------------------------------------------------------------
// P4 — the admin CLI
// ---------------------------------------------------------------------------

describe('gm:token CLI', () => {
  it('mints a token that authorises a GM-only route, plus a redeemable join code', async () => {
    const result = await mintGmSignIn(t.db, parseArgs(['--campaign', 'Neon Rain']));
    expect(result.campaignId).toBe(boot.campaignId);
    expect(result.token).toEqual(expect.any(String));
    expect(await canGm(boot.campaignId, result.token!)).toBe(201);

    // The printed URL is the SPA join route (LIVE-3), and the code behind it
    // redeems onto the SAME GM identity rather than minting a new user.
    expect(result.lines.join('\n')).toContain(`/join/${result.code}`);
    const redeemed = await t.app.inject({ method: 'GET', url: `/api/join/${result.code}` });
    expect(redeemed.statusCode).toBe(200);
    const joined = redeemed.json() as { role: string; campaignId: string; user: { id: string } };
    expect(joined.role).toBe('gm');
    expect(joined.campaignId).toBe(boot.campaignId);
    expect(joined.user.id).toBe(boot.gmUserId);
  });

  it('--pair-only mints no long-lived token', async () => {
    const result = await mintGmSignIn(t.db, parseArgs(['-c', boot.campaignId, '--pair-only']));
    expect(result.token).toBeUndefined();
    expect(result.code).toEqual(expect.any(String));
  });

  it('builds the join URL against --origin, then WEB_ORIGIN', () => {
    expect(resolveOrigin(parseArgs(['--origin', 'http://192.168.1.20:8787/']), {})).toBe(
      'http://192.168.1.20:8787',
    );
    expect(resolveOrigin(parseArgs([]), { WEB_ORIGIN: 'http://box.local:5173' })).toBe(
      'http://box.local:5173',
    );
  });

  it('refuses to guess between campaigns, and matches an id or a name', () => {
    const all = [
      { id: 'a1', name: 'Neon Rain', gm: { id: 'u1', displayName: 'Whistler' }, createdAt: '', lastPlayedAt: null },
      { id: 'b2', name: 'Neon Nights', gm: { id: 'u1', displayName: 'Whistler' }, createdAt: '', lastPlayedAt: null },
    ];
    expect(() => pickCampaign(all, undefined)).toThrow(/--campaign/);
    expect(() => pickCampaign(all, 'Neon')).toThrow(/matches 2 campaigns/);
    expect(() => pickCampaign([], undefined)).toThrow(/no campaigns/);
    expect(pickCampaign(all, 'rain').id).toBe('a1');
    expect(pickCampaign(all, 'b2').id).toBe('b2');
  });

  it('names the database it is about to write to, without printing the password', () => {
    expect(describeTarget({ DATABASE_URL: 'postgres://safehouse:hunter2@postgres:5432/safehouse' })).toBe(
      'postgres postgres://safehouse:***@postgres:5432/safehouse',
    );
    expect(describeTarget({ DATA_DIR: '/data/' })).toBe('pglite /data/pglite');
  });

  it('rejects an unknown flag rather than doing something surprising', () => {
    expect(() => parseArgs(['--'])).toThrow(/unknown flag/);
    expect(() => parseArgs(['--minutes', '0'])).toThrow(/--minutes/);
  });
});

// ---------------------------------------------------------------------------
// The invariant all of the above must leave standing
// ---------------------------------------------------------------------------

describe('after every recovery path', () => {
  it('a player device still cannot reach GM-only routes', async () => {
    expect(await canGm(boot.campaignId, player.token)).toBe(403);
    expect(await canGm(second.campaignId, player.token)).toBe(403);
    const devices = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/devices`,
      headers: auth(player.token),
    });
    expect(devices.statusCode).toBe(403);
    const settings = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}`,
      headers: auth(player.token),
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).not.toHaveProperty('settings');
  });

  it('a kiosk device still cannot reach GM-only routes', async () => {
    expect(await canGm(boot.campaignId, display.token)).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// The open-table switch — SAFEHOUSE_OPEN_TABLE
// ---------------------------------------------------------------------------

/**
 * "It's a game with friends — let anyone claim GM."
 *
 * A deliberate, temporary posture for a private table: the software stops
 * adjudicating who the GM is, because the humans around the laptop already
 * know. What is pinned here is that it is a SWITCH and not a demolition — the
 * loopback gate is bypassed whole, never weakened, so turning the flag off
 * restores every guarantee the rest of this file asserts. That is the property
 * that makes "add real auth later" a one-line change instead of an excavation.
 *
 * The tests set the variable and restore it in `finally`, because a leaked
 * environment here would silently disarm every other suite in the process.
 */
describe('SAFEHOUSE_OPEN_TABLE', () => {
  const KEY = 'SAFEHOUSE_OPEN_TABLE';

  /** Run `fn` with the switch set to `value` (undefined = unset). */
  async function withOpenTable<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
    const prev = process.env[KEY];
    if (value === undefined) delete process.env[KEY];
    else process.env[KEY] = value;
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env[KEY];
      else process.env[KEY] = prev;
    }
  }

  const lan = { remoteAddress: '192.168.1.20' };

  it('is off unless explicitly turned on', async () => {
    for (const value of [undefined, '', '0', 'false', 'no', 'off', ' ', 'maybe']) {
      await withOpenTable(value, () => {
        expect(openTableMode()).toBe(false);
      });
    }
  });

  it('accepts the spellings a human would actually write', async () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
      await withOpenTable(value, () => {
        expect(openTableMode()).toBe(true);
      });
    }
  });

  it('bypasses the whole gate rather than weakening any part of it', async () => {
    const cases: Array<Partial<Record<string, unknown>>> = [
      { socket: lan },
      { socket: lan, headers: { 'x-forwarded-for': '10.0.0.9' } },
      { headers: { host: 'evil.example:8787' } },
      { headers: { origin: 'http://evil.example:8787' } },
      { ips: ['10.0.0.9'] },
    ];
    await withOpenTable('1', () => {
      for (const over of cases) {
        const req = {
          headers: {},
          socket: { remoteAddress: '127.0.0.1' },
          ...over,
        } as unknown as FastifyRequest;
        expect(() => assertLoopbackOrigin(req)).not.toThrow();
      }
    });
  });

  it('refuses all of those again the moment it is switched off', async () => {
    // No cached read, no module-load capture: the flag is a live question.
    await withOpenTable(undefined, () => {
      const req = { headers: {}, socket: lan } as unknown as FastifyRequest;
      expect(() => assertLoopbackOrigin(req)).toThrow(/machine hosting the server/);
    });
  });

  it('lists every campaign with the name of the GM who started it, off-host', async () => {
    const res = await withOpenTable('1', () =>
      t.app.inject({ method: 'GET', url: '/api/gm/recover', ...lan }),
    );
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      campaigns: Array<{ id: string; name: string; gm: { displayName: string } }>;
    };
    // Both tables on this box, not just the ones this caller belongs to —
    // that IS the feature: you pick the campaign by whose game it is.
    const names = body.campaigns.map((c) => c.name);
    expect(names).toContain('Neon Rain');
    expect(names).toContain('Bug City');
    for (const c of body.campaigns) {
      expect(typeof c.gm.displayName).toBe('string');
      expect(c.gm.displayName.length).toBeGreaterThan(0);
    }
  });

  it('lets an off-host stranger claim the GM chair of any campaign', async () => {
    const before = await userCount();
    const res = await withOpenTable('1', () =>
      t.app.inject({
        method: 'POST',
        url: '/api/gm/recover',
        payload: { campaignId: second.campaignId },
        ...lan,
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = res.json() as { token: string; role: string; user: { id: string } };
    expect(body.role).toBe('gm');
    // Still the campaign's owner of record, and still no user invented: the
    // switch opens the door, it does not change who is behind it.
    expect(body.user.id).toBe(boot.gmUserId);
    expect(await userCount()).toBe(before);
    expect(await canGm(second.campaignId, body.token)).toBe(201);
  });

  it('lets a player device claim GM — the point of the mode, not a leak in it', async () => {
    // With the switch OFF this is the escalation the rest of the file forbids.
    const off = await t.app.inject({
      method: 'POST',
      url: '/api/gm/recover',
      headers: auth(player.token),
      payload: { campaignId: boot.campaignId },
      ...lan,
    });
    expect(off.statusCode).toBe(403);

    const on = await withOpenTable('1', () =>
      t.app.inject({
        method: 'POST',
        url: '/api/gm/recover',
        headers: auth(player.token),
        payload: { campaignId: boot.campaignId },
        ...lan,
      }),
    );
    expect(on.statusCode).toBe(201);
    const body = on.json() as { token: string };
    expect(await canGm(boot.campaignId, body.token)).toBe(201);
  });

  it('leaves every other role guard exactly where it was', async () => {
    // The switch is scoped to the recovery gate. A player token is still a
    // player token everywhere else, which is what keeps the mode reversible.
    await withOpenTable('1', async () => {
      expect(await canGm(boot.campaignId, player.token)).toBe(403);
      const devices = await t.app.inject({
        method: 'GET',
        url: `/api/campaigns/${boot.campaignId}/devices`,
        headers: auth(player.token),
      });
      expect(devices.statusCode).toBe(403);
      const invite = await t.app.inject({
        method: 'POST',
        url: `/api/campaigns/${boot.campaignId}/invites`,
        headers: auth(boot.gmToken),
        payload: { role: 'gm' },
      });
      expect(invite.statusCode).toBe(400);
    });
  });
});
