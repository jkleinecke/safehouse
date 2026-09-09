/**
 * Server-core auth coverage (FR1.1–1.4, DESIGN.md §12/§13): bootstrap,
 * invites + QR join, role guards, device revocation, error envelope.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { httpError } from '../src/services/auth.js';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;

beforeAll(async () => {
  t = await makeTestApp('core-auth');
  boot = await bootstrapCampaign(t.app);
}, 120_000);

afterAll(async () => {
  await t.close();
});

describe('healthz', () => {
  it('responds ok without auth', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });
});

describe('bootstrap (FR1.1)', () => {
  it('first campaign minted a GM device token', () => {
    expect(boot.campaignId).toMatch(/[0-9a-f-]{36}/);
    expect(boot.gmToken.length).toBeGreaterThanOrEqual(32);
  });

  it('the GM token resolves on authed routes', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/invites`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { role: 'player' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { code: string; role: string; expiresAt: string | null };
    expect(body.role).toBe('player');
    expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(body.expiresAt).not.toBeNull();
  });

  it('a second campaign requires auth (bootstrap is one-shot)', async () => {
    const anon = await t.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'Second Sprawl' },
    });
    expect(anon.statusCode).toBe(401);
    expect((anon.json() as { error: { code: string } }).error.code).toBe('unauthorized');

    const authed = await t.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { name: 'Second Sprawl' },
    });
    expect(authed.statusCode).toBe(201);
    expect((authed.json() as { user: { id: string } }).user.id).toBe(boot.gmUserId);
  });

  it('rejects an invalid body with the §12 error envelope', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/campaigns', payload: {} });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string; details?: unknown } };
    expect(body.error.code).toBe('bad_request');
    expect(body.error.details).toBeDefined();
  });
});

describe('the error handler and deliberate 5xx envelopes', () => {
  /**
   * A 5xx code used to be flattened to `internal` unconditionally, which is
   * right for an exception out of a driver (its `code` must never become API
   * surface) and wrong for a 503 somebody chose — the web app switches on
   * `ai_disabled` vs `ai_unreachable` to say "the Fixer is off" rather than
   * "the box is down".
   */
  it('keeps the code of an httpError, and flattens anything else', async () => {
    // A second app on the same db: routes can only be added before the first
    // inject readies an instance, and `t.app` has been serving all suite.
    const probe = await buildApp({ db: t.db, webDist: false, logger: false });
    probe.get('/test/deliberate-503', async () => {
      throw httpError(503, 'ai_disabled', 'the Fixer is switched off');
    });
    probe.get('/test/unexpected', async () => {
      const err = new Error('column "nope" does not exist') as Error & { code: string };
      err.code = '42703';
      throw err;
    });
    try {
      const deliberate = await probe.inject({ method: 'GET', url: '/test/deliberate-503' });
      expect(deliberate.statusCode).toBe(503);
      expect((deliberate.json() as { error: { code: string } }).error.code).toBe('ai_disabled');

      const unexpected = await probe.inject({ method: 'GET', url: '/test/unexpected' });
      expect(unexpected.statusCode).toBe(500);
      // The driver's own code is not leaked as an API code.
      expect((unexpected.json() as { error: { code: string } }).error.code).toBe('internal');
    } finally {
      await probe.close();
    }
  }, 120_000);
});

describe('join flow (FR1.1/1.3)', () => {
  it('GET /api/join/:code mints a device + long-lived token as JSON', async () => {
    const joined = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Sam');
    expect(joined.role).toBe('player');
    expect(joined.campaignId).toBe(boot.campaignId);
    expect(joined.token.length).toBeGreaterThanOrEqual(32);
    expect(joined.user.displayName).toBe('Sam');
  });

  it('display invites mint observer-grade kiosk devices (§13)', async () => {
    const joined = await joinAs(t.app, boot.campaignId, boot.gmToken, 'display', 'Table TV');
    expect(joined.role).toBe('display');
  });

  it('unknown code → 404 invite_not_found envelope', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/join/ZZZZZZZZ' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('invite_not_found');
  });

  it('use-capped invites exhaust (410)', async () => {
    const inviteRes = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/invites`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { role: 'player', maxUses: 1 },
    });
    const { code } = inviteRes.json() as { code: string };
    const first = await t.app.inject({ method: 'GET', url: `/api/join/${code}` });
    expect(first.statusCode).toBe(200);
    const second = await t.app.inject({ method: 'GET', url: `/api/join/${code}` });
    expect(second.statusCode).toBe(410);
    expect((second.json() as { error: { code: string } }).error.code).toBe('invite_exhausted');
  });
});

describe('role guard (FR1.4, §13 capability matrix)', () => {
  it('players cannot mint invites (403) and anonymous cannot (401)', async () => {
    const player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
    const asPlayer = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/invites`,
      headers: { authorization: `Bearer ${player.token}` },
      payload: { role: 'player' },
    });
    expect(asPlayer.statusCode).toBe(403);
    expect((asPlayer.json() as { error: { code: string } }).error.code).toBe('forbidden');

    const anon = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/invites`,
      payload: { role: 'player' },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('a GM device bound to campaign A cannot act on campaign B', async () => {
    const other = await t.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { name: 'Other Table' },
    });
    const otherId = (other.json() as { campaignId: string }).campaignId;
    // boot.gmToken is bound to boot.campaignId, not otherId.
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${otherId}/invites`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { role: 'player' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('join QR (FR1.1)', () => {
  it('returns { url, code, dataUrl } against the LAN address — GM only', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/join-qr`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { url: string; code: string; dataUrl: string };
    expect(body.url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/join\//);
    expect(body.url.endsWith(`/join/${body.code}`)).toBe(true);
    expect(body.dataUrl.startsWith('data:image/png;base64,')).toBe(true);

    const player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Nova');
    const denied = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/join-qr`,
      headers: { authorization: `Bearer ${player.token}` },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('device revoke (FR1.3)', () => {
  it('GM revokes a player device; its token stops resolving', async () => {
    const player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Ghost');
    const revoke = await t.app.inject({
      method: 'POST',
      url: `/api/devices/${player.deviceId}/revoke`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json()).toMatchObject({ revoked: true, deviceId: player.deviceId });

    const after = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/invites`,
      headers: { authorization: `Bearer ${player.token}` },
      payload: { role: 'player' },
    });
    expect(after.statusCode).toBe(401); // token no longer resolves at all
  });

  it('a player cannot revoke someone else’s device', async () => {
    const a = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Alpha');
    const b = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Bravo');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/devices/${a.deviceId}/revoke`,
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a player can revoke their own device', async () => {
    const me = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'SelfServe');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/devices/${me.deviceId}/revoke`,
      headers: { authorization: `Bearer ${me.token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/me (FR1.1 / FR9.16)', () => {
  it('tells a device who it is, and which runner it plays', async () => {
    const joined = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Quill');
    const res = await t.app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${joined.token}` } });
    expect(res.statusCode).toBe(200);
    const me = res.json() as { user: { id: string; displayName: string }; role: string; campaignId: string; characterId: string | null };
    expect(me.user.id).toBe(joined.user.id);
    expect(me.user.displayName).toBe('Quill');
    expect(me.role).toBe('player');
    expect(me.campaignId).toBe(boot.campaignId);
    // No sheet yet, so no runner — and never a guess.
    expect(me.characterId).toBeNull();
  });

  it('refuses an unpaired browser', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });
});
