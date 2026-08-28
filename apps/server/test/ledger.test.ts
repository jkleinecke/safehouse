/**
 * Karma & nuyen ledgers (FR3.6): append-only entries, player spends land
 * pending until the GM settles them at the table, balances are sums, and the
 * sheet's karma/nuyen come from here and nowhere else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { wsEvents } from '@safehouse/db';
import {
  makeTestApp,
  bootstrapCampaign,
  joinAs,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let other: JoinResult;
let characterId: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function post(token: string, url: string, payload: unknown) {
  return t.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as never });
}

async function balances(token: string): Promise<{ karma: number; nuyen: number; pending: { karma: number; nuyen: number } }> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/characters/${characterId}/ledger`,
    headers: auth(token),
  });
  return (res.json() as { balances: { karma: number; nuyen: number; pending: { karma: number; nuyen: number } } }).balances;
}

beforeAll(async () => {
  t = await makeTestApp('ledger');
  boot = await bootstrapCampaign(t.app);
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Rivet');
  other = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Nomad');
  const created = await post(boot.gmToken, '/api/characters', {
    campaignId: boot.campaignId,
    name: 'Rivet',
    ownerUserId: player.user.id,
  });
  characterId = (created.json() as { character: { id: string } }).character.id;
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

describe('appending entries', () => {
  it('GM awards land approved and move the balance immediately', async () => {
    const res = await post(boot.gmToken, `/api/characters/${characterId}/ledger`, {
      currency: 'karma',
      delta: 6,
      reason: 'Run payoff: the dockside job',
    });
    expect(res.statusCode).toBe(201);
    const out = res.json() as { entry: { state: string; delta: number }; balances: { karma: number } };
    expect(out.entry).toMatchObject({ state: 'approved', delta: 6 });
    expect(out.balances.karma).toBe(6);

    const nuyen = await post(boot.gmToken, `/api/characters/${characterId}/ledger`, {
      currency: 'nuyen',
      delta: 8000,
      reason: 'Payout',
    });
    expect((nuyen.json() as { balances: { nuyen: number } }).balances.nuyen).toBe(8000);
  });

  it("a player's own spend is pending until the GM approves it", async () => {
    const res = await post(player.token, `/api/characters/${characterId}/ledger`, {
      currency: 'karma',
      delta: -4,
      reason: 'Raise Automatics 6 → 7',
      state: 'approved', // ignored: players never self-approve
    });
    expect(res.statusCode).toBe(201);
    const entry = (res.json() as { entry: { id: string; state: string } }).entry;
    expect(entry.state).toBe('pending');
    // Balances are sums of APPROVED entries only.
    const bal = await balances(player.token);
    expect(bal.karma).toBe(6);
    // …with a projection so the table can see the settle-up result.
    expect(bal.pending.karma).toBe(2);
  });

  it('refuses entries on a character the actor neither owns nor GMs', async () => {
    const res = await post(other.token, `/api/characters/${characterId}/ledger`, {
      currency: 'karma',
      delta: 100,
      reason: 'free money',
    });
    expect(res.statusCode).toBe(403);
  });

  it('validates the body', async () => {
    const res = await post(player.token, `/api/characters/${characterId}/ledger`, {
      currency: 'favours',
      delta: 1,
      reason: 'nope',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('approve / reject (GM, end-of-session housekeeping)', () => {
  it('lists pending entries across the campaign for the GM only', async () => {
    const gm = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/ledger?state=pending`,
      headers: auth(boot.gmToken),
    });
    expect(gm.statusCode).toBe(200);
    const entries = (gm.json() as { entries: Array<{ id: string; characterName: string }> }).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.characterName).toBe('Rivet');

    const asPlayer = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/ledger`,
      headers: auth(player.token),
    });
    expect(asPlayer.statusCode).toBe(403);
  });

  it('approving a pending spend moves the balance', async () => {
    const pending = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${characterId}/ledger?state=pending`,
      headers: auth(player.token),
    });
    const entryId = (pending.json() as { entries: Array<{ id: string }> }).entries[0]!.id;

    const denied = await post(player.token, `/api/ledger/${entryId}/approve`, {});
    expect(denied.statusCode).toBe(403);

    const res = await post(boot.gmToken, `/api/ledger/${entryId}/approve`, {});
    expect(res.statusCode).toBe(200);
    const out = res.json() as { entry: { state: string; approvedBy: string }; balances: { karma: number } };
    expect(out.entry.state).toBe('approved');
    expect(out.entry.approvedBy).toBe(boot.gmUserId);
    expect(out.balances.karma).toBe(2);

    // Append-only: a settled entry never changes state again.
    const again = await post(boot.gmToken, `/api/ledger/${entryId}/approve`, {});
    expect(again.statusCode).toBe(409);
  });

  it('rejecting leaves the balance untouched', async () => {
    const created = await post(player.token, `/api/characters/${characterId}/ledger`, {
      currency: 'nuyen',
      delta: -5000,
      reason: 'New coat',
    });
    const entryId = (created.json() as { entry: { id: string } }).entry.id;
    const res = await post(boot.gmToken, `/api/ledger/${entryId}/reject`, {});
    expect(res.statusCode).toBe(200);
    const out = res.json() as { entry: { state: string }; balances: { nuyen: number } };
    expect(out.entry.state).toBe('rejected');
    expect(out.balances.nuyen).toBe(8000);
  });
});

describe('the sheet reads karma/nuyen from the ledger only (FR3.6)', () => {
  it('reports balances on the character DTO', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${characterId}`,
      headers: auth(player.token),
    });
    const out = res.json() as { balances: { karma: number; nuyen: number }; sheet: Record<string, unknown> };
    expect(out.balances).toMatchObject({ karma: 2, nuyen: 8000 });
    expect(out.sheet['karma']).toBeUndefined();
    expect(out.sheet['nuyen']).toBeUndefined();
  });

  it('keeps the full history, newest first', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/characters/${characterId}/ledger`,
      headers: auth(boot.gmToken),
    });
    const entries = (res.json() as { entries: Array<{ reason: string; state: string }> }).entries;
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.state).sort()).toEqual(['approved', 'approved', 'approved', 'rejected']);
  });

  it('persists a ledger.changed event per write (§11 catalog)', async () => {
    const rows = await t.db.select().from(wsEvents).where(eq(wsEvents.campaignId, boot.campaignId));
    const ledgerEvents = rows.filter((r) => r.type === 'ledger.changed');
    // 4 entries + 1 approve + 1 reject.
    expect(ledgerEvents).toHaveLength(6);
    expect(ledgerEvents.every((r) => r.visibility === 'public')).toBe(true);
  });
});
