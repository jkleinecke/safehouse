/**
 * AI recap drafting (FR12.12) + the spoiler guard on it (FR12.19).
 *
 * The recap is the one piece of AI prose that leaves the laptop (FR6.3 posts it
 * to Discord) and the players' only window into the campaign between sessions,
 * so these tests care about three things in order: that the facts in it come
 * from the log rather than the model, that a GM-only name in it is *flagged*
 * rather than published, and that accepting a draft gets it no closer to the
 * players than the GM's own recap field.
 *
 * Everything runs against the mock inference box over real HTTP + SSE.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { gameSessions, ledgerEntries, rolls, wsEvents } from '@safehouse/db';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';
import { MockLlmServer } from '../src/fixer/mock-llm.js';
import { disableAi, enableAi, seedFixerFixture, type FixerFixture } from './fixer-helpers.js';
import { assembleRecap, recapDigest, recapSessionRow } from '../src/fixer/recap.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let fx: FixerFixture;
let sessionId: string;
const mocks: MockLlmServer[] = [];

async function mock(opts: Parameters<typeof MockLlmServer.start>[0] = {}): Promise<MockLlmServer> {
  const server = await MockLlmServer.start(opts);
  mocks.push(server);
  enableAi(server.baseUrl);
  return server;
}

function gm(url: string, payload?: Record<string, unknown>, method: 'GET' | 'POST' = 'POST') {
  return t.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${boot.gmToken}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

/** The prose half of a `draft_recap` call — original content, no book text. */
const PROSE = {
  title: 'Session recap — the dock job',
  headline: 'The team took a simple courier run and finished it owing three favours.',
  moments: [
    { title: 'The wrong crate', text: 'The manifest was a lie and everyone at the dock knew it.' },
    { title: 'Rooftop, in the rain', text: 'Static held the stairwell alone for a full pass.' },
  ],
  whoDidWhat: [
    { who: 'Static', what: 'took the hits so nobody else had to' },
    { who: 'Kestrel', what: 'talked the dock foreman into looking the other way' },
  ],
  cliffhanger: 'The buyer has not called back, and the crate is still in the van.',
};

beforeAll(async () => {
  t = await makeTestApp('fixer-recap');
  boot = await bootstrapCampaign(t.app, 'Neon Rain');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Kestrel');
  fx = await seedFixerFixture(t.db, boot.campaignId);

  const started = await gm(`/api/campaigns/${boot.campaignId}/sessions/start`, {
    date: '2076-05-19',
  });
  expect(started.statusCode).toBeLessThan(300);
  sessionId = (started.json() as { session: { id: string } }).session.id;

  // --- what the log actually says -----------------------------------------
  const roll = (
    hits: number,
    glitch: 'none' | 'glitch' | 'critical',
    visibility: 'public' | 'gm',
  ) => ({
    campaignId: boot.campaignId,
    sessionId,
    actor: { gm: true },
    kind: 'simple',
    request: { kind: 'simple', pool: 10, breakdown: [], visibility },
    faces: [5, 5, 3, 1],
    hits,
    ones: 1,
    glitch,
    limitedHits: hits,
    visibility,
  });
  await t.db
    .insert(rolls)
    .values([
      roll(6, 'none', 'public'),
      roll(2, 'glitch', 'public'),
      roll(1, 'critical', 'public'),
      // Behind the screen: counted, never quoted.
      roll(11, 'none', 'gm'),
    ]);

  await t.db.insert(ledgerEntries).values({
    characterId: fx.staticId,
    currency: 'karma',
    delta: 5,
    reason: 'held the stairwell',
    state: 'pending',
    sessionId,
  });

  await t.db.insert(wsEvents).values([
    {
      campaignId: boot.campaignId,
      type: 'scene.activated',
      payload: { name: 'Rooftop, Redmond' },
      visibility: 'public',
    },
    {
      campaignId: boot.campaignId,
      type: 'combatant.damaged',
      payload: { name: 'Ganger with the shotgun', condition: 'down', boxes: 4 },
      visibility: 'public',
    },
    {
      campaignId: boot.campaignId,
      type: 'fog.updated',
      payload: { regionNames: ['stairwell'] },
      visibility: 'public',
    },
    {
      // GM-only: it must not reach the facts section.
      campaignId: boot.campaignId,
      type: 'scene.activated',
      payload: { name: 'The safehouse nobody knows about' },
      visibility: 'gm',
    },
  ]);
}, 120_000);

afterAll(async () => {
  for (const m of mocks) await m.close();
  disableAi();
  await t.close();
});

afterEach(() => {
  disableAi();
});

// ---------------------------------------------------------------------------
// The deterministic half
// ---------------------------------------------------------------------------

describe('the log owns the facts (D13 applied to prose)', () => {
  it('digests public rolls, casualties, reveals and awards — and counts what it left out', async () => {
    const session = await recapSessionRow(t.db, boot.campaignId, sessionId);
    const digest = await recapDigest(t.db, boot.campaignId, session);

    expect(digest.rolls).toMatchObject({ total: 3, best: 6, glitches: 1, criticals: 1 });
    // The 11-hit roll was GM-only; it is a count, never a number in the body.
    expect(digest.hiddenRolls).toBe(1);
    expect(digest.rolls.best).not.toBe(11);

    expect(digest.down).toContain('Ganger with the shotgun');
    expect(digest.reveals).toContain('stairwell');
    expect(digest.sceneMarkers).toEqual(['Rooftop, Redmond']);
    expect(digest.sceneMarkers).not.toContain('The safehouse nobody knows about');
    expect(digest.events.gmOnly).toBeGreaterThan(0);

    expect(digest.awards).toHaveLength(1);
    expect(digest.awards[0]).toMatchObject({ character: 'Static', currency: 'karma', delta: 5, state: 'pending' });
  });

  it('assembles the model prose and the log facts into one body, pending awards marked as pending', async () => {
    const session = await recapSessionRow(t.db, boot.campaignId, sessionId);
    const digest = await recapDigest(t.db, boot.campaignId, session);
    const md = assembleRecap(PROSE.title, PROSE, digest);

    expect(md).toContain('# Session recap — the dock job');
    expect(md).toContain('The wrong crate');
    expect(md).toContain('3 rolls at the table; best result 6 hits');
    expect(md).toContain('Went down: Ganger with the shotgun');
    expect(md).toContain('+5 karma');
    expect(md).toContain('pending');
    expect(md).toContain('The buyer has not called back');
    expect(md).not.toContain('The safehouse nobody knows about');
  });
});

// ---------------------------------------------------------------------------
// The tool, through the agent loop
// ---------------------------------------------------------------------------

describe('draft_recap through the Fixer (FR12.12)', () => {
  let recapDraftId = '';

  beforeEach(() => {
    // Every case re-arms its own mock; the previous one is closed at the end.
  });

  it('offers draft_recap in the catalog', async () => {
    await mock();
    const res = await gm('/api/fixer/tools', undefined, 'GET');
    expect(res.statusCode).toBe(200);
    const names = (res.json() as { tools: Array<{ name: string; kind: string }> }).tools;
    const recap = names.find((tool) => tool.name === 'draft_recap');
    expect(recap).toBeDefined();
    expect(recap?.kind).toBe('draft');
  });

  it('lands as a draft, never as a published recap', async () => {
    const server = await mock({
      responder: (req) =>
        req.messages.some((m) => m.role === 'tool')
          ? { content: 'Recap drafted. Nothing has gone out.' }
          : { toolCalls: [{ name: 'draft_recap', arguments: { sessionId, ...PROSE } }] },
    });

    const res = await gm('/api/fixer/chat', { message: 'write up tonight, please' });
    expect(res.statusCode).toBe(200);
    expect(server.requests.length).toBeGreaterThanOrEqual(2);

    const drafts = await gm(`/api/campaigns/${boot.campaignId}/generations?kind=recap`, undefined, 'GET');
    const list = (drafts.json() as { generations: Array<Record<string, unknown>> }).generations;
    expect(list).toHaveLength(1);
    const draft = list[0]!;
    recapDraftId = draft['id'] as string;
    expect(draft['status']).toBe('draft');
    const output = draft['output'] as Record<string, unknown>;
    expect(output['sessionId']).toBe(sessionId);
    expect(output['playerFacing']).toBe(true);
    expect(String(output['recapMd'])).toContain('best result 6 hits');

    // Principle 8: the session's own recap field is untouched until accept.
    const before = (
      await t.db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1)
    )[0]!;
    expect(before.recapMd).toBe('');
  });

  it('accepting writes the session recap draft — and publishing stays a separate GM action', async () => {
    expect(recapDraftId).not.toBe('');
    const accepted = await gm(`/api/generations/${recapDraftId}/accept`);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ applied: { table: 'game_sessions', id: sessionId } });

    const row = (
      await t.db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1)
    )[0]!;
    expect(row.recapMd).toContain('The wrong crate');
    // Accepting is not publishing: the state machine still says the GM has to
    // press publish, and with no webhook nothing leaves the laptop anyway.
    expect(row.state).not.toBe('published');
  });

  it('is GM-only — a player cannot reach the draft queue that holds it', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/generations`,
      headers: { authorization: `Bearer ${player.token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('the spoiler guard fires on a GM-only fact (FR12.19)', () => {
  it('flags the hidden token the prose named, and says so in the tool result', async () => {
    const server = await mock({
      responder: (req) =>
        req.messages.some((m) => m.role === 'tool')
          ? { content: 'Flagged; your call.' }
          : {
              toolCalls: [
                {
                  name: 'draft_recap',
                  arguments: {
                    sessionId,
                    ...PROSE,
                    cliffhanger: `Nobody has mentioned the ${fx.hiddenTokenName} yet.`,
                  },
                },
              ],
            },
    });

    const res = await gm('/api/fixer/chat', { message: 'recap it' });
    expect(res.statusCode).toBe(200);

    const toolResult = server
      .toolResults()
      .map((m) => JSON.parse(m.content ?? '{}') as Record<string, unknown>)
      .find((r) => r['appliesTo'] === 'game_sessions.recap_md');
    expect(toolResult).toBeDefined();
    const flags = toolResult!['spoilerFlags'] as Array<{ name: string; why: string }>;
    expect(flags.map((f) => f.name)).toContain(fx.hiddenTokenName);
    expect(String(toolResult!['note'])).toMatch(/reveal or cut/i);

    // The draft still exists — the guard warns, it does not silently rewrite.
    const drafts = await gm(`/api/campaigns/${boot.campaignId}/generations?kind=recap`, undefined, 'GET');
    const list = (drafts.json() as { generations: Array<Record<string, unknown>> }).generations;
    const flagged = list.find(
      (d) => ((d['output'] as Record<string, unknown>)['spoilerFlags'] as unknown[]).length > 0,
    );
    expect(flagged).toBeDefined();
    expect(String((flagged!['output'] as Record<string, unknown>)['recapMd'])).toContain(
      fx.hiddenTokenName,
    );
  });

  it('also catches a GM-only codex title', async () => {
    await mock({
      responder: (req) =>
        req.messages.some((m) => m.role === 'tool')
          ? { content: 'done' }
          : {
              toolCalls: [
                {
                  name: 'draft_recap',
                  arguments: {
                    sessionId,
                    ...PROSE,
                    headline: 'Mister Kavanagh paid up, eventually.',
                  },
                },
              ],
            },
    });
    const res = await gm('/api/fixer/chat', { message: 'recap it again' });
    expect(res.statusCode).toBe(200);

    const drafts = await gm(`/api/campaigns/${boot.campaignId}/generations?kind=recap`, undefined, 'GET');
    const list = (drafts.json() as { generations: Array<Record<string, unknown>> }).generations;
    const named = list.find((d) =>
      ((d['output'] as Record<string, unknown>)['spoilerFlags'] as Array<{ name: string }>).some(
        (f) => f.name === 'Mister Kavanagh',
      ),
    );
    expect(named).toBeDefined();
  });
});
