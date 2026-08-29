/**
 * Runs and the in-game calendar (M5 — FR5.5, FR5.7).
 *
 * Runs: the brief (Johnson page, hook, objectives, opposition encounters) is
 * GM-only server-side; awards post to the ledgers as PENDING entries so the
 * GM settles them in the housekeeping beat (FR3.6).
 *
 * Calendar: pinned timeline events, sessions, dated runs, and lifestyle rent
 * derived from the sheets — each filtered for the caller.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
let otherCharacterId: string;
let johnsonPageId: string;
let runId: string;
let eventId: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function post(token: string, url: string, payload: unknown) {
  return t.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as never });
}

async function patch(token: string, url: string, payload: unknown) {
  return t.app.inject({ method: 'PATCH', url, headers: auth(token), payload: payload as never });
}

async function get(token: string, url: string) {
  return t.app.inject({ method: 'GET', url, headers: auth(token) });
}

interface CalendarEntry {
  id: string;
  kind: string;
  date: string;
  title: string;
  visibility: string;
  links?: Record<string, string>;
  amount?: number;
}

async function calendar(token: string, query = ''): Promise<CalendarEntry[]> {
  const res = await get(token, `/api/campaigns/${boot.campaignId}/calendar${query}`);
  expect(res.statusCode).toBe(200);
  return (res.json() as { entries: CalendarEntry[] }).entries;
}

beforeAll(async () => {
  t = await makeTestApp('codex-runs');
  boot = await bootstrapCampaign(t.app);
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Rivet');
  other = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Nomad');

  const rivet = await post(boot.gmToken, '/api/characters', {
    campaignId: boot.campaignId,
    name: 'Rivet',
    ownerUserId: player.user.id,
  });
  characterId = (rivet.json() as { character: { id: string } }).character.id;
  const nomad = await post(boot.gmToken, '/api/characters', {
    campaignId: boot.campaignId,
    name: 'Nomad',
    ownerUserId: other.user.id,
  });
  otherCharacterId = (nomad.json() as { character: { id: string } }).character.id;

  const page = await post(boot.gmToken, `/api/campaigns/${boot.campaignId}/wiki`, {
    kind: 'npc',
    title: 'Mr. Sable',
    visibility: 'gm',
    contentMd: 'Meets in the back of a noodle bar. Pays in certified credsticks.',
  });
  johnsonPageId = (page.json() as { page: { id: string } }).page.id;
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

describe('runs CRUD (FR5.5)', () => {
  it('creates a run with brief, opposition links and payout', async () => {
    const res = await post(boot.gmToken, `/api/campaigns/${boot.campaignId}/runs`, {
      title: 'The Dockside Job',
      state: 'prep',
      johnsonPageId,
      hook: 'A container that was never on the manifest.',
      objectives: [
        { text: 'Lift the container', state: 'open' },
        { text: 'Leave no trace', state: 'open' },
      ],
      opposition: [{ label: 'Dock security patrol' }],
      payout: { nuyen: 12_000, karma: 6, notes: 'Half up front.' },
      ingameDate: '2076-05-14',
    });
    expect(res.statusCode).toBe(201);
    const run = (res.json() as { run: Record<string, unknown> }).run;
    runId = run['id'] as string;
    expect(run['payout']).toMatchObject({ nuyen: 12_000, karma: 6 });
    expect((run['objectives'] as unknown[])).toHaveLength(2);
    expect(run['ingameDate']).toBe('2076-05-14');
  });

  it('rejects a Johnson page from another campaign', async () => {
    const res = await post(boot.gmToken, `/api/campaigns/${boot.campaignId}/runs`, {
      title: 'Bad link',
      johnsonPageId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });

  it('a run in prep is invisible to players', async () => {
    const one = await get(player.token, `/api/runs/${runId}`);
    expect(one.statusCode).toBe(404);
    const list = await get(player.token, `/api/campaigns/${boot.campaignId}/runs`);
    expect((list.json() as { runs: unknown[] }).runs).toHaveLength(0);
  });

  it('patches state, objectives and the recap', async () => {
    const res = await patch(boot.gmToken, `/api/runs/${runId}`, {
      state: 'done',
      objectives: [
        { text: 'Lift the container', state: 'done' },
        { text: 'Leave no trace', state: 'failed' },
      ],
      recapMd: 'The container held a person. Nobody has slept since.',
    });
    expect(res.statusCode).toBe(200);
    const run = (res.json() as { run: Record<string, unknown> }).run;
    expect(run['state']).toBe('done');
    expect(run['hook']).toBe('A container that was never on the manifest.');
    expect((run['objectives'] as Array<{ state: string }>)[1]?.state).toBe('failed');
  });

  it("a finished run reaches players as title + recap only — never the brief", async () => {
    const res = await get(player.token, `/api/runs/${runId}`);
    expect(res.statusCode).toBe(200);
    const run = (res.json() as { run: Record<string, unknown> }).run;
    expect(run).toEqual({
      id: runId,
      title: 'The Dockside Job',
      state: 'done',
      recapMd: 'The container held a person. Nobody has slept since.',
    });
    const body = JSON.stringify(run);
    expect(body).not.toContain('Dock security patrol');
    expect(body).not.toContain(johnsonPageId);
  });

  it('a partial edit leaves every untouched field alone', async () => {
    const res = await patch(boot.gmToken, `/api/runs/${runId}`, { payout: { notes: 'Paid in full.' } });
    expect(res.statusCode).toBe(200);
    const run = (res.json() as { run: Record<string, unknown> }).run;
    expect(run['state']).toBe('done');
    expect(run['payout']).toMatchObject({ nuyen: 12_000, karma: 6, notes: 'Paid in full.' });
    expect((run['objectives'] as unknown[])).toHaveLength(2);
    expect(run['ingameDate']).toBe('2076-05-14');
    expect(run['recapMd']).toBe('The container held a person. Nobody has slept since.');
  });

  it('a player may not create or edit runs', async () => {
    expect((await post(player.token, `/api/campaigns/${boot.campaignId}/runs`, { title: 'X' })).statusCode).toBe(403);
    expect((await patch(player.token, `/api/runs/${runId}`, { title: 'X' })).statusCode).toBe(403);
  });
});

describe('POST /api/runs/:id/award (FR5.5 → FR3.6)', () => {
  it('posts karma and nuyen to the ledgers as PENDING entries', async () => {
    const res = await post(boot.gmToken, `/api/runs/${runId}/award`, {
      reason: 'Dockside payoff',
      entries: [
        { characterId, karma: 6, nuyen: 6000 },
        { characterId: otherCharacterId, karma: 5 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const out = res.json() as { run: { awards: { karma: number; nuyen: number } }; entries: Array<{ state: string }> };
    expect(out.entries).toHaveLength(3);
    expect(out.entries.every((e) => e.state === 'pending')).toBe(true);
    expect(out.run.awards).toMatchObject({ karma: 11, nuyen: 6000 });

    const ledger = await get(player.token, `/api/characters/${characterId}/ledger`);
    const body = ledger.json() as {
      entries: Array<{ state: string; delta: number; currency: string; runId: string | null; reason: string }>;
      balances: { karma: number; pending: { karma: number; nuyen: number } };
    };
    const karma = body.entries.find((e) => e.currency === 'karma');
    expect(karma).toMatchObject({ state: 'pending', delta: 6, runId, reason: 'Dockside payoff' });
    // Nothing moves until the GM approves: approved balance still zero.
    expect(body.balances.karma).toBe(0);
    expect(body.balances.pending).toMatchObject({ karma: 6, nuyen: 6000 });
  });

  it('rejects an empty award and a character from outside the campaign', async () => {
    const empty = await post(boot.gmToken, `/api/runs/${runId}/award`, {
      entries: [{ characterId, karma: 0 }],
    });
    expect(empty.statusCode).toBe(400);
    const foreign = await post(boot.gmToken, `/api/runs/${runId}/award`, {
      entries: [{ characterId: '00000000-0000-4000-8000-000000000000', karma: 3 }],
    });
    expect(foreign.statusCode).toBe(404);
    const asPlayer = await post(player.token, `/api/runs/${runId}/award`, {
      entries: [{ characterId, karma: 99 }],
    });
    expect(asPlayer.statusCode).toBe(403);
  });
});

describe('in-game calendar (FR5.7)', () => {
  it('pins a timeline event to an in-game date', async () => {
    const res = await post(boot.gmToken, `/api/campaigns/${boot.campaignId}/calendar`, {
      date: '2076-05-20',
      title: 'The Cartel calls in a marker',
      body: 'They know who lifted the container.',
      visibility: 'gm',
    });
    expect(res.statusCode).toBe(201);
    eventId = (res.json() as { event: { id: string } }).event.id;

    const shared = await post(boot.gmToken, `/api/campaigns/${boot.campaignId}/calendar`, {
      date: '2076-05-12',
      title: 'Team moves into the Ravenholt flat',
      visibility: 'public',
    });
    expect(shared.statusCode).toBe(201);
  });

  it('merges events, sessions, dated runs and lifestyle rent', async () => {
    await patch(boot.gmToken, `/api/characters/${characterId}`, {
      cause: 'lifestyle',
      sheet: { lifestyles: [{ name: 'Low', costPerMonth: 2000, paidThrough: '2076-06-01' }] },
    });
    await patch(boot.gmToken, `/api/characters/${otherCharacterId}`, {
      cause: 'lifestyle',
      sheet: { lifestyles: [{ name: 'Squatter', costPerMonth: 500, paidThrough: '2076-06-03' }] },
    });
    await post(boot.gmToken, `/api/campaigns/${boot.campaignId}/sessions`, { date: '2026-03-07' });

    const gm = await calendar(boot.gmToken);
    const kinds = gm.map((e) => e.kind);
    expect(kinds).toContain('event');
    expect(kinds).toContain('session');
    expect(kinds).toContain('run');
    expect(kinds).toContain('lifestyle');
    // Sorted by date; the run's in-game date carries through.
    expect(gm.map((e) => e.date)).toEqual([...gm.map((e) => e.date)].sort());
    expect(gm.find((e) => e.kind === 'run')).toMatchObject({ date: '2076-05-14', links: { runId } });
    const rent = gm.filter((e) => e.kind === 'lifestyle');
    expect(rent).toHaveLength(2);
    expect(rent.find((e) => e.date === '2076-06-01')).toMatchObject({ amount: 2000 });
  });

  it("a player sees shared beats and only their OWN rent — never the GM's", async () => {
    const mine = await calendar(player.token);
    const titles = mine.map((e) => e.title);
    expect(titles).toContain('Team moves into the Ravenholt flat');
    expect(titles).not.toContain('The Cartel calls in a marker');
    expect(JSON.stringify(mine)).not.toContain('know who lifted');
    const rent = mine.filter((e) => e.kind === 'lifestyle');
    expect(rent).toHaveLength(1);
    expect(rent[0]).toMatchObject({ date: '2076-06-01', links: { characterId } });
  });

  it('filters by date window', async () => {
    const window = await calendar(boot.gmToken, '?from=2076-05-15&to=2076-05-31');
    expect(window.map((e) => e.title)).toEqual(['The Cartel calls in a marker']);
  });

  it('patches and deletes a pinned event (GM only)', async () => {
    const denied = await patch(player.token, `/api/campaigns/${boot.campaignId}/calendar/${eventId}`, {
      title: 'nope',
    });
    expect(denied.statusCode).toBe(403);

    const moved = await patch(boot.gmToken, `/api/campaigns/${boot.campaignId}/calendar/${eventId}`, {
      date: '2076-05-22',
      visibility: 'public',
    });
    expect(moved.statusCode).toBe(200);
    expect((await calendar(player.token)).some((e) => e.date === '2076-05-22')).toBe(true);

    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/campaigns/${boot.campaignId}/calendar/${eventId}`,
      headers: auth(boot.gmToken),
    });
    expect(del.statusCode).toBe(200);
    expect((await calendar(boot.gmToken)).some((e) => e.id === eventId)).toBe(false);
    const missing = await t.app.inject({
      method: 'DELETE',
      url: `/api/campaigns/${boot.campaignId}/calendar/${eventId}`,
      headers: auth(boot.gmToken),
    });
    expect(missing.statusCode).toBe(404);
  });
});
