/**
 * Sessions (FR6.1–6.3): live mode, the session-scoped roll log, the read-only
 * end-of-session housekeeping summary, and recap publishing (Discord is
 * fire-and-forget and absent in tests — the app plays fine offline, NG7).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { SheetV1Schema } from '@safehouse/contracts';
import { campaigns, characters, ledgerEntries, recentEvents } from '@safehouse/db';
import { getRollService } from '../src/services/rolls.js';
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
let characterId: string;
let sessionId: string;

const SHEET = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Kite' },
  attributes: {
    bod: 3,
    agi: 4,
    rea: 4,
    str: 3,
    wil: 4,
    log: 4,
    int: 4,
    cha: 3,
    edg: { max: 3, current: 3 },
    ess: 6,
  },
  skills: [{ id: 'sneaking', rating: 4, attr: 'agi' }],
});

async function req(
  method: 'POST' | 'GET' | 'PATCH',
  url: string,
  token: string,
  payload?: Record<string, unknown>,
) {
  return t.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

beforeAll(async () => {
  t = await makeTestApp('sessions');
  boot = await bootstrapCampaign(t.app, 'Friday Night');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Kite');
  getRollService(t.db, t.app.hub).setRng(() => 0.9); // every die a 6
  const row = (
    await t.db
      .insert(characters)
      .values({
        campaignId: boot.campaignId,
        ownerUserId: player.user.id,
        name: 'Kite',
        sheet: SHEET,
      })
      .returning()
  )[0]!;
  characterId = row.id;
}, 120_000);

afterAll(async () => {
  await t.close();
});

describe('start / end (FR6.2)', () => {
  it('starts a session, flips live mode, and marks the log', async () => {
    const res = await req('POST', `/api/campaigns/${boot.campaignId}/sessions/start`, boot.gmToken, {
      date: '2076-05-12',
      attendance: [boot.gmUserId, player.user.id],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { session: { id: string; state: string; date: string }; live: boolean };
    sessionId = body.session.id;
    expect(body.live).toBe(true);
    expect(body.session.state).toBe('live');

    const live = await req('GET', `/api/campaigns/${boot.campaignId}/live`, player.token);
    expect(live.json()).toMatchObject({ live: true, sessionId });

    const campaign = (
      await t.db.select().from(campaigns).where(eq(campaigns.id, boot.campaignId)).limit(1)
    )[0]!;
    expect(campaign.settings).toMatchObject({ live: true, liveSessionId: sessionId });

    const events = await recentEvents(t.db, boot.campaignId, 10);
    const marker = events.find(
      (e) => e.type === 'log.posted' && (e.payload as { marker?: string }).marker === 'session.started',
    );
    expect(marker).toBeTruthy();
  });

  it('refuses a second live session', async () => {
    const res = await req('POST', `/api/campaigns/${boot.campaignId}/sessions/start`, boot.gmToken, {});
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('session_live');
  });

  it('refuses a player starting one', async () => {
    const res = await req('POST', `/api/campaigns/${boot.campaignId}/sessions/start`, player.token, {});
    expect(res.statusCode).toBe(403);
  });

  it('stamps rolls made during the session', async () => {
    const roll = await req('POST', '/api/rolls', player.token, {
      pool: 1,
      actor: { characterId },
      meta: { poolRef: 'skill.sneaking' },
    });
    expect(roll.statusCode).toBe(201);
    const created = (roll.json() as { roll: { id: string; sessionId: string } }).roll;
    expect(created.sessionId).toBe(sessionId);
    const scoped = await req(
      'GET',
      `/api/campaigns/${boot.campaignId}/rolls?session=${sessionId}`,
      boot.gmToken,
    );
    expect((scoped.json() as { rolls: { id: string }[] }).rolls.map((r) => r.id)).toContain(created.id);
  });
});

describe('housekeeping (FR3.6 / FR6.2)', () => {
  it('summarises pending ledger entries read-only', async () => {
    await t.db.insert(ledgerEntries).values({
      characterId,
      currency: 'nuyen',
      delta: -4500,
      reason: 'Replacement commlink',
      state: 'pending',
      sessionId,
      createdBy: player.user.id,
    });
    const res = await req('GET', `/api/sessions/${sessionId}/housekeeping`, boot.gmToken);
    expect(res.statusCode).toBe(200);
    const hk = (res.json() as { housekeeping: {
      pendingLedger: { reason: string; characterName: string; delta: number }[];
      rolls: { total: number };
      attendance: string[];
    } }).housekeeping;
    expect(hk.pendingLedger).toHaveLength(1);
    expect(hk.pendingLedger[0]).toMatchObject({
      reason: 'Replacement commlink',
      characterName: 'Kite',
      delta: -4500,
    });
    expect(hk.rolls.total).toBeGreaterThan(0);
    expect(hk.attendance).toContain(player.user.id);
  });

  it('is GM-only', async () => {
    const res = await req('GET', `/api/sessions/${sessionId}/housekeeping`, player.token);
    expect(res.statusCode).toBe(403);
  });
});

describe('recap (FR6.3)', () => {
  it('keeps a draft, then publishes it to the log', async () => {
    const empty = await req('POST', `/api/sessions/${sessionId}/publish-recap`, boot.gmToken, {});
    expect(empty.statusCode).toBe(400);

    const draft = await req('PATCH', `/api/sessions/${sessionId}`, boot.gmToken, {
      recapMd: 'The crew walked out of the dock with the case and one very annoyed rigger.',
      prepNotesMd: 'GM only: the rigger works for the Johnson.',
    });
    expect(draft.statusCode).toBe(200);

    // Prep notes never reach a player device (Principle 4).
    const asPlayer = await req('GET', `/api/sessions/${sessionId}`, player.token);
    expect(asPlayer.json()).not.toHaveProperty('session.prepNotesMd');
    expect((asPlayer.json() as { session: Record<string, unknown> }).session['prepNotesMd']).toBeUndefined();

    const published = await req('POST', `/api/sessions/${sessionId}/publish-recap`, boot.gmToken, {});
    expect(published.statusCode).toBe(200);
    const body = published.json() as { published: boolean; discord: string; headlines: string[] };
    expect(body.published).toBe(true);
    expect(body.discord).toBe('skipped'); // no DISCORD_WEBHOOK_URL in tests
    expect(body.headlines.length).toBeGreaterThan(0);

    const events = await recentEvents(t.db, boot.campaignId, 10);
    const recap = events.find(
      (e) => e.type === 'log.posted' && (e.payload as { kind?: string }).kind === 'recap',
    );
    expect(recap?.visibility).toBe('public');
    expect((recap?.payload as { text: string }).text).toContain('very annoyed rigger');
  });

  it('ends the session and hands back the housekeeping summary', async () => {
    const res = await req('POST', `/api/sessions/${sessionId}/end`, boot.gmToken, {});
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      live: boolean;
      session: { state: string };
      housekeeping: { pendingLedger: unknown[] };
    };
    expect(body.live).toBe(false);
    expect(body.session.state).toBe('done');
    expect(body.housekeeping.pendingLedger).toHaveLength(1);

    const live = await req('GET', `/api/campaigns/${boot.campaignId}/live`, boot.gmToken);
    expect(live.json()).toMatchObject({ live: false, sessionId: null });

    // Post-session rolls are no longer stamped with it.
    const roll = await req('POST', '/api/rolls', player.token, { pool: 2, actor: {} });
    expect((roll.json() as { roll: { sessionId: string | null } }).roll.sessionId).toBeNull();
  });

  it('lists sessions for the table', async () => {
    const res = await req('GET', `/api/campaigns/${boot.campaignId}/sessions`, player.token);
    const sessions = (res.json() as { sessions: { id: string; state: string }[] }).sessions;
    expect(sessions.map((s) => s.id)).toContain(sessionId);
    expect(sessions.every((s) => !('prepNotesMd' in s))).toBe(true);
  });
});
