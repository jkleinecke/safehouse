/**
 * campaigns domain (FR1.4/1.5, FR5.7): the campaign record itself — read,
 * patch, and the device list the GM revokes from.
 *
 * The secrecy assertions matter most here: `settings` can hold the campaign's
 * Discord webhook, and the device list is the map of every phone at the table,
 * so both are GM-only and filtered server-side (Principle 4).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
let player: JoinResult;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  t = await makeTestApp('campaigns');
  boot = await bootstrapCampaign(t.app, 'Ash & Neon');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Kestrel');
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

describe('GET /api/campaigns/:id', () => {
  it('gives the GM the record with settings', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}`,
      headers: auth(boot.gmToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ id: boot.campaignId, name: 'Ash & Neon' });
    expect(body['settings']).toEqual({});
    expect(body['activeSceneId']).toBeNull();
    expect(body['activeSessionId']).toBeNull();
  });

  it('withholds settings from a player (Principle 4)', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}`,
      headers: auth(player.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['name']).toBe('Ash & Neon');
    expect(body).not.toHaveProperty('settings');
  });

  it('refuses a device bound to another campaign', async () => {
    // A second campaign on a non-empty db needs an authenticated creator.
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: auth(boot.gmToken),
      payload: { name: 'Elsewhere' },
    });
    expect(created.statusCode).toBe(201);
    const otherGmToken = (created.json() as { token: string }).token;

    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}`,
      headers: auth(otherGmToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /api/campaigns/:id', () => {
  it('merges settings instead of replacing the blob, and null deletes a key', async () => {
    const first = await t.app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${boot.campaignId}`,
      headers: auth(boot.gmToken),
      payload: { settings: { discordWebhookUrl: 'http://webhook.invalid/x', houseRule: 'gritty' } },
    });
    expect(first.statusCode).toBe(200);

    const second = await t.app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${boot.campaignId}`,
      headers: auth(boot.gmToken),
      payload: { settings: { discordWebhookUrl: null } },
    });
    expect(second.statusCode).toBe(200);
    const settings = (second.json() as { settings: Record<string, unknown> }).settings;
    expect(settings).toEqual({ houseRule: 'gritty' });
  });

  it('advances the in-game clock and announces it as clock.advanced (§11)', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${boot.campaignId}`,
      headers: auth(boot.gmToken),
      payload: { ingameDate: '2076-05-19' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ingameDate: string }).ingameDate).toBe('2076-05-19');

    const log = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/log`,
      headers: auth(boot.gmToken),
    });
    expect(log.statusCode).toBe(200);
    const types = JSON.stringify(log.json());
    expect(types).toContain('clock.advanced');
  });

  it('does not re-announce when the date is unchanged', async () => {
    const before = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/log`,
      headers: auth(boot.gmToken),
    });
    const count = (JSON.stringify(before.json()).match(/clock\.advanced/g) ?? []).length;
    await t.app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${boot.campaignId}`,
      headers: auth(boot.gmToken),
      payload: { ingameDate: '2076-05-19' },
    });
    const after = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/log`,
      headers: auth(boot.gmToken),
    });
    expect((JSON.stringify(after.json()).match(/clock\.advanced/g) ?? []).length).toBe(count);
  });

  it('is GM-only', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${boot.campaignId}`,
      headers: auth(player.token),
      payload: { name: 'Player Rules Now' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an empty patch', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${boot.campaignId}`,
      headers: auth(boot.gmToken),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/campaigns/:id/devices (FR1.3)', () => {
  it("lists this campaign's devices with their users, never token hashes", async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/devices`,
      headers: auth(boot.gmToken),
    });
    expect(res.statusCode).toBe(200);
    const devices = res.json() as Array<Record<string, unknown>>;
    // The GM's own device plus the player's phone.
    expect(devices.length).toBe(2);
    expect(devices.map((d) => d['role']).sort()).toEqual(['gm', 'player']);
    expect(devices.some((d) => d['userName'] === 'Kestrel')).toBe(true);
    for (const device of devices) {
      expect(device).not.toHaveProperty('tokenHash');
      expect(device['revokedAt']).toBeNull();
    }
  });

  it('shows a revoked phone as revoked rather than dropping it', async () => {
    const doomed = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Lost Phone');
    const revoke = await t.app.inject({
      method: 'POST',
      url: `/api/devices/${doomed.deviceId}/revoke`,
      headers: auth(boot.gmToken),
    });
    expect(revoke.statusCode).toBe(200);

    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/devices`,
      headers: auth(boot.gmToken),
    });
    const devices = res.json() as Array<Record<string, unknown>>;
    const row = devices.find((d) => d['id'] === doomed.deviceId);
    expect(row).toBeDefined();
    expect(row?.['revokedAt']).not.toBeNull();
  });

  it('is GM-only — a player cannot enumerate the table', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/devices`,
      headers: auth(player.token),
    });
    expect(res.statusCode).toBe(403);
  });
});
