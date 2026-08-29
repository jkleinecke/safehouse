/**
 * GM-side auth, ownership and the /join split (FR1.1/1.2/1.3, DESIGN.md §13).
 *
 * Three things are under test here and each one was a real defect:
 *
 * - **LIVE-3** — `/join/:code` was both an API route and an SPA route, and the
 *   API won, so scanning the QR showed a player raw JSON. The token endpoint is
 *   now `/api/join/:code`; `/join/:code` belongs to the web app and the Vite
 *   proxy must keep its hands off it.
 * - **BUILD_REPORT #2** — a GM could not sign in through the app on any machine
 *   but the one that bootstrapped. `gm-device` and `gm-pair` fix that, and a
 *   role-scoped player invite still must not be able to mint `gm`.
 * - **FR1.2** — ownership transfer, including the part that actually gates the
 *   API: the device rows.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { campaigns, characters, memberships } from '@safehouse/db';
import { buildApp } from '../src/app.js';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;

interface CampaignHandle {
  campaignId: string;
  token: string;
  gmUserId: string;
}

/** Another campaign owned by the bootstrap GM, with its own GM device token. */
async function newCampaign(name: string): Promise<CampaignHandle> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/campaigns',
    headers: { authorization: `Bearer ${boot.gmToken}` },
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { campaignId: string; token: string; user: { id: string } };
  return { campaignId: body.campaignId, token: body.token, gmUserId: body.user.id };
}

/** Can this token still act as the GM of `campaignId`? (mint an invite). */
async function canGm(campaignId: string, token: string): Promise<number> {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/campaigns/${campaignId}/invites`,
    headers: { authorization: `Bearer ${token}` },
    payload: { role: 'player' },
  });
  return res.statusCode;
}

beforeAll(async () => {
  t = await makeTestApp('auth-gm');
  boot = await bootstrapCampaign(t.app);
}, 120_000);

afterAll(async () => {
  await t.close();
});

// ---------------------------------------------------------------------------
// LIVE-3
// ---------------------------------------------------------------------------

describe('LIVE-3: /join is the SPA route, /api/join is the endpoint', () => {
  it('GET /api/join/:code returns the join JSON', async () => {
    const joined = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Sable');
    expect(joined.role).toBe('player');
    expect(joined.token.length).toBeGreaterThanOrEqual(32);
  });

  it('POST /api/join/:code takes the name and label in a body', async () => {
    const invite = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/invites`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { role: 'player' },
    });
    const { code } = invite.json() as { code: string };
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/join/${code}`,
      payload: { name: 'Røkkr', label: 'the loaner phone' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { role: string; user: { displayName: string } };
    expect(body.role).toBe('player');
    expect(body.user.displayName).toBe('Røkkr');
  });

  it('GET /join/:code is NOT an API route any more (no token in the response)', async () => {
    const invite = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/invites`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { role: 'player' },
    });
    const { code } = invite.json() as { code: string };
    const res = await t.app.inject({ method: 'GET', url: `/join/${code}` });
    expect(res.statusCode).toBe(404); // this app has no web build to fall back to
    expect(res.body).not.toContain('token');
    // and the code is still unused — the failed hit did not burn it
    const redeemed = await t.app.inject({ method: 'GET', url: `/api/join/${code}` });
    expect(redeemed.statusCode).toBe(200);
  });

  it('with a web build present, GET /join/:code serves the SPA shell', async () => {
    const dist = mkdtempSync(pathJoin(tmpdir(), 'safehouse-webdist-'));
    writeFileSync(pathJoin(dist, 'index.html'), '<!doctype html><title>Safehouse</title>');
    const app = await buildApp({ db: t.db, webDist: dist, logger: false });
    try {
      const res = await app.inject({ method: 'GET', url: '/join/ABCDEFGH' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Safehouse');
      // …while the API route underneath still answers as an API route.
      const api = await app.inject({ method: 'GET', url: '/api/join/ABCDEFGH' });
      expect(api.statusCode).toBe(404);
      expect((api.json() as { error: { code: string } }).error.code).toBe('invite_not_found');
    } finally {
      await app.close();
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('the QR encodes the SPA route, never the API one', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/join-qr`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
    });
    const body = res.json() as { url: string; code: string };
    expect(body.url.endsWith(`/join/${body.code}`)).toBe(true);
    expect(body.url).not.toContain('/api/join/');
  });

  it('the Vite dev proxy no longer forwards /join', () => {
    const config = readFileSync(new URL('../../web/vite.config.ts', import.meta.url), 'utf8');
    const proxied = [...config.matchAll(/'(\/[a-z]+)':/g)].map((m) => m[1]);
    expect(proxied).toEqual(expect.arrayContaining(['/api', '/files', '/read', '/ws']));
    expect(proxied).not.toContain('/join');
  });
});

// ---------------------------------------------------------------------------
// BUILD_REPORT #2 — GM sign-in
// ---------------------------------------------------------------------------

describe('GM second device (FR1.1)', () => {
  it('mints another GM token for the same GM user', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/gm-device`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { label: "GM's phone" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { token: string; role: string; user: { id: string }; deviceId: string };
    expect(body.role).toBe('gm');
    expect(body.user.id).toBe(boot.gmUserId);
    expect(body.token).not.toBe(boot.gmToken);
    expect(await canGm(boot.campaignId, body.token)).toBe(201);
  });

  it('is GM-only', async () => {
    const player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Nix');
    const denied = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/gm-device`,
      headers: { authorization: `Bearer ${player.token}` },
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
    const anon = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/gm-device`,
      payload: {},
    });
    expect(anon.statusCode).toBe(401);
  });
});

describe('GM pairing code (FR1.1/1.2)', () => {
  it('pairs a fresh browser as the SAME GM user', async () => {
    const pair = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/gm-pair`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: {},
    });
    expect(pair.statusCode).toBe(201);
    const info = pair.json() as {
      code: string;
      role: string;
      url: string;
      dataUrl: string;
      expiresAt: string;
    };
    expect(info.role).toBe('gm');
    expect(info.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(info.url.endsWith(`/join/${info.code}`)).toBe(true);
    expect(info.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    // short-lived by construction
    expect(new Date(info.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(61 * 60_000);

    const joined = await t.app.inject({ method: 'GET', url: `/api/join/${info.code}` });
    expect(joined.statusCode).toBe(200);
    const session = joined.json() as {
      role: string;
      campaignId: string;
      token: string;
      user: { id: string; displayName: string };
    };
    expect(session.role).toBe('gm');
    expect(session.campaignId).toBe(boot.campaignId);
    // The pairing code binds the EXISTING GM identity — no new user (FR1.2:
    // one GM), so owned sheets and gm_owner rolls keep resolving.
    expect(session.user.id).toBe(boot.gmUserId);
    expect(session.user.displayName).toBe('Whistler');
    expect(await canGm(boot.campaignId, session.token)).toBe(201);
  });

  it('burns after one laptop', async () => {
    const pair = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/gm-pair`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { expiresInMinutes: 5 },
    });
    const { code } = pair.json() as { code: string };
    expect((await t.app.inject({ method: 'GET', url: `/api/join/${code}` })).statusCode).toBe(200);
    const second = await t.app.inject({ method: 'GET', url: `/api/join/${code}` });
    expect(second.statusCode).toBe(410);
    expect((second.json() as { error: { code: string } }).error.code).toBe('invite_exhausted');
  });

  it('is GM-only', async () => {
    const player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Tally');
    const denied = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/gm-pair`,
      headers: { authorization: `Bearer ${player.token}` },
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('role-scoped invites can never mint gm (FR1.3)', () => {
  it('POST /api/campaigns/:id/invites rejects role=gm', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/invites`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { role: 'gm' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('bad_request');
  });

  it('join-qr rejects role=gm', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/join-qr?role=gm`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('a redeemed player invite is a player device, whatever it asks for', async () => {
    const invite = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${boot.campaignId}/invites`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { role: 'player' },
    });
    const { code } = invite.json() as { code: string };
    const joined = await t.app.inject({
      method: 'POST',
      url: `/api/join/${code}`,
      payload: { name: 'Chancer', label: 'gm' },
    });
    const body = joined.json() as { role: string; token: string; user: { id: string } };
    expect(body.role).toBe('player');
    expect(body.user.id).not.toBe(boot.gmUserId);
    expect(await canGm(boot.campaignId, body.token)).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// FR1.2 — ownership transfer
// ---------------------------------------------------------------------------

describe('ownership transfer (FR1.2)', () => {
  it('moves the record, the membership roles and the live device tokens', async () => {
    const camp = await newCampaign('The Handover');
    const heir = await joinAs(t.app, camp.campaignId, camp.token, 'player', 'Heir');
    // a pairing code the outgoing GM left lying around
    const stale = (
      await t.app.inject({
        method: 'POST',
        url: `/api/campaigns/${camp.campaignId}/gm-pair`,
        headers: { authorization: `Bearer ${camp.token}` },
        payload: {},
      })
    ).json() as { code: string };

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${camp.campaignId}/transfer-ownership`,
      headers: { authorization: `Bearer ${camp.token}` },
      payload: { toUserId: heir.user.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      campaignId: camp.campaignId,
      gmUserId: heir.user.id,
      previousGmUserId: camp.gmUserId,
    });

    const row = (
      await t.db.select().from(campaigns).where(eq(campaigns.id, camp.campaignId)).limit(1)
    )[0];
    expect(row?.gmUserId).toBe(heir.user.id);

    const roles = await t.db
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.campaignId, camp.campaignId));
    expect(roles.find((r) => r.userId === heir.user.id)?.role).toBe('gm');
    expect(roles.find((r) => r.userId === camp.gmUserId)?.role).toBe('player');

    // the tokens that actually gate the API
    expect(await canGm(camp.campaignId, heir.token)).toBe(201);
    expect(await canGm(camp.campaignId, camp.token)).toBe(403);

    // and the outgoing GM's pairing code is dead without a sweep
    const paired = await t.app.inject({ method: 'GET', url: `/api/join/${stale.code}` });
    expect(paired.statusCode).toBe(403);
    expect((paired.json() as { error: { code: string } }).error.code).toBe('forbidden');
  });

  it('refuses a non-member, a no-op, and a player', async () => {
    const camp = await newCampaign('Held Fast');
    const player = await joinAs(t.app, camp.campaignId, camp.token, 'player', 'Bystander');
    const stranger = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Stranger');

    const outsider = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${camp.campaignId}/transfer-ownership`,
      headers: { authorization: `Bearer ${camp.token}` },
      payload: { toUserId: stranger.user.id },
    });
    expect(outsider.statusCode).toBe(404);

    const self = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${camp.campaignId}/transfer-ownership`,
      headers: { authorization: `Bearer ${camp.token}` },
      payload: { toUserId: camp.gmUserId },
    });
    expect(self.statusCode).toBe(400);

    const asPlayer = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${camp.campaignId}/transfer-ownership`,
      headers: { authorization: `Bearer ${player.token}` },
      payload: { toUserId: player.user.id },
    });
    expect(asPlayer.statusCode).toBe(403);
    // still the original GM
    expect(await canGm(camp.campaignId, camp.token)).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Claiming a sheet for the phone that just scanned in
// ---------------------------------------------------------------------------

describe('claim sheet (PATCH /api/characters/:id/owner)', () => {
  async function makeCharacter(campaignId: string, token: string, name: string): Promise<string> {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/characters',
      headers: { authorization: `Bearer ${token}` },
      payload: { campaignId, name },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { character: { id: string } }).character.id;
  }

  async function ownerOf(id: string): Promise<string | null> {
    const row = (
      await t.db
        .select({ ownerUserId: characters.ownerUserId })
        .from(characters)
        .where(eq(characters.id, id))
        .limit(1)
    )[0];
    return row?.ownerUserId ?? null;
  }

  it('the GM points a sheet at a player, and can un-point it', async () => {
    const camp = await newCampaign('Claim Jumpers');
    const player = await joinAs(t.app, camp.campaignId, camp.token, 'player', 'Rook');
    const characterId = await makeCharacter(camp.campaignId, camp.token, 'Rook');
    expect(await ownerOf(characterId)).toBeNull();

    const claim = await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/${characterId}/owner`,
      headers: { authorization: `Bearer ${camp.token}` },
      payload: { ownerUserId: player.user.id },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toMatchObject({ characterId, ownerUserId: player.user.id });
    expect(await ownerOf(characterId)).toBe(player.user.id);

    const release = await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/${characterId}/owner`,
      headers: { authorization: `Bearer ${camp.token}` },
      payload: { ownerUserId: null },
    });
    expect(release.statusCode).toBe(200);
    expect(await ownerOf(characterId)).toBeNull();
  });

  it('refuses players, strangers and unknown sheets', async () => {
    const camp = await newCampaign('No Claims');
    const player = await joinAs(t.app, camp.campaignId, camp.token, 'player', 'Grip');
    const stranger = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Elsewhere');
    const characterId = await makeCharacter(camp.campaignId, camp.token, 'Grip');

    const asPlayer = await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/${characterId}/owner`,
      headers: { authorization: `Bearer ${player.token}` },
      payload: { ownerUserId: player.user.id },
    });
    expect(asPlayer.statusCode).toBe(403);

    const outsider = await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/${characterId}/owner`,
      headers: { authorization: `Bearer ${camp.token}` },
      payload: { ownerUserId: stranger.user.id },
    });
    expect(outsider.statusCode).toBe(404);
    expect(await ownerOf(characterId)).toBeNull();

    const missing = await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/00000000-0000-4000-8000-000000000000/owner`,
      headers: { authorization: `Bearer ${camp.token}` },
      payload: { ownerUserId: player.user.id },
    });
    expect(missing.statusCode).toBe(404);
  });
});
