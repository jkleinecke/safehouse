/**
 * The Fixer's agent loop (M12: FR12.1–12.6, 12.13, 12.17–12.18).
 *
 * Every test runs against the mock inference box (src/fixer/mock-llm.ts) over
 * real HTTP + SSE, so the client's streaming and tool-call reassembly are
 * exercised, not stubbed. Covered here: clean disable with no LLM_BASE_URL,
 * the GM-only guard, a full tool round-trip ("who's hurt worst?"), the live
 * situation snapshot, gm-visibility streaming at the socket, and NPC voice.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { encounters, gameSessions } from '@safehouse/db';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  wsUrl,
  WsTestClient,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';
import { MockLlmServer, type MockChatRequest } from '../src/fixer/mock-llm.js';
import { disableAi, enableAi, seedFixerFixture, type FixerFixture } from './fixer-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let fx: FixerFixture;
const mocks: MockLlmServer[] = [];
const sockets: WsTestClient[] = [];

async function mock(opts: Parameters<typeof MockLlmServer.start>[0] = {}): Promise<MockLlmServer> {
  const server = await MockLlmServer.start(opts);
  mocks.push(server);
  enableAi(server.baseUrl);
  return server;
}

function gm(payload: Record<string, unknown>, url = '/api/fixer/chat') {
  return t.app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${boot.gmToken}` },
    payload,
  });
}

/** Last tool result the loop fed back to the model, parsed. */
function lastToolResult(req: MockChatRequest): Record<string, unknown> | null {
  const message = [...req.messages].reverse().find((m) => m.role === 'tool');
  if (!message?.content) return null;
  return JSON.parse(message.content) as Record<string, unknown>;
}

beforeAll(async () => {
  t = await makeTestApp('fixer-agent');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  boot = await bootstrapCampaign(t.app, 'Neon Rain');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Kestrel');
  fx = await seedFixerFixture(t.db, boot.campaignId);
}, 120_000);

afterAll(async () => {
  for (const s of sockets) s.close();
  for (const m of mocks) await m.close();
  disableAi();
  await t.close();
});

afterEach(() => {
  disableAi();
});

describe('clean disable with no inference box (NG7 / Principle 5)', () => {
  it('reports the Fixer as off', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/fixer/status',
      headers: { authorization: `Bearer ${boot.gmToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enabled: false, models: null });
  });

  it('answers 503 ai_disabled on chat and converse', async () => {
    const chat = await gm({ message: 'who is hurt worst?' });
    expect(chat.statusCode).toBe(503);
    expect((chat.json() as { error: { code: string } }).error.code).toBe('ai_disabled');

    const converse = await gm({ message: 'evening, chummer' }, `/api/npcs/${fx.templateId}/converse`);
    expect(converse.statusCode).toBe(503);
    expect((converse.json() as { error: { code: string } }).error.code).toBe('ai_disabled');
  });

  it('still serves the draft queue and the usage meter with the model gone', async () => {
    const drafts = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/generations`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
    });
    expect(drafts.statusCode).toBe(200);
    const usage = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/fixer/usage`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
    });
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({ currency: 'tokens+latency' });
  });
});

describe('GM-only (§13: only the GM ever talks to the Fixer)', () => {
  it('refuses a player device even when the box is up', async () => {
    await mock({ turns: [{ content: 'should never be reached' }] });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/fixer/chat',
      headers: { authorization: `Bearer ${player.token}` },
      payload: { message: 'what does the GM know?' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('tool loop (FR12.17)', () => {
  it('runs get_encounter for "who is hurt worst" and answers from the live result', async () => {
    const server = await mock({
      responder: (req) => {
        const result = lastToolResult(req);
        if (!result) {
          return { toolCalls: [{ name: 'get_encounter', arguments: {} }] };
        }
        const order = result['order'] as Array<{ name: string; damageTaken: number }>;
        const worst = [...order].sort((a, b) => b.damageTaken - a.damageTaken)[0]!;
        return {
          content: `${worst.name} is hurt worst — ${worst.damageTaken} boxes filled across both monitors.`,
        };
      },
    });

    const res = await gm({ message: "who's hurt worst right now?" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      text: string;
      rounds: number;
      tools: Array<{ name: string; ok: boolean }>;
      usage: { totalTokens: number; latencyMs: number };
      conversationId: string;
    };

    expect(body.rounds).toBe(2);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]).toMatchObject({ name: 'get_encounter', ok: true });
    expect(body.text).toContain('Static'); // 7 physical + 1 stun beats everyone else
    expect(body.usage.totalTokens).toBeGreaterThan(0);
    expect(body.conversationId).toMatch(/[0-9a-f-]{36}/);

    // The model was offered the catalog, and the tool result really came from the db.
    const first = server.requests[0]!;
    expect(first.tools?.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining(['get_encounter', 'get_character', 'search_books', 'generate_npc']),
    );
    const toolResult = lastToolResult(server.lastRequest()!);
    expect(toolResult).toMatchObject({ turn: 2, pass: 1, state: 'live' });
  });

  it('keeps the conversation so a follow-up sees the earlier turns', async () => {
    await mock({ turns: [{ content: 'First answer.' }, { content: 'Second answer.' }] });
    const first = await gm({ message: 'remember this: the safehouse is on Pike.' });
    const conversationId = (first.json() as { conversationId: string }).conversationId;
    const second = await gm({ message: 'where is the safehouse?', conversationId });
    expect(second.statusCode).toBe(200);

    const res = await t.app.inject({
      method: 'GET',
      url: `/api/fixer/conversations/${conversationId}`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
    });
    const conversation = res.json() as { messages: Array<{ role: string; content: string | null }> };
    expect(conversation.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(conversation.messages[0]?.content).toContain('Pike');
  });

  it('reports a bad tool call back to the model instead of failing the turn', async () => {
    await mock({
      responder: (req) => {
        const result = lastToolResult(req);
        if (!result) {
          return { toolCalls: [{ name: 'get_character', arguments: { characterId: 'nope' } }] };
        }
        return { content: `tool said: ${JSON.stringify(result)}` };
      },
    });
    const res = await gm({ message: 'read a character that does not exist' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tools: Array<{ ok: boolean; error?: string }>; text: string };
    expect(body.tools[0]?.ok).toBe(false);
    expect(body.text).toContain('error');
  });
});

describe('situation snapshot (FR12.18)', () => {
  it('prefixes scene, encounter and party lines while a session is live', async () => {
    const server = await mock({ turns: [{ content: 'Understood.' }] });
    const res = await gm({ message: 'status?' });
    expect((res.json() as { snapshotApplied: boolean }).snapshotApplied).toBe(true);

    const systems = server.requests[0]!.messages.filter((m) => m.role === 'system');
    // One on the wire, always: the prompt and the snapshot are folded together
    // because some local chat templates accept exactly one. What matters is
    // that the snapshot REACHED the model, not which envelope carried it.
    expect(systems).toHaveLength(1);
    const snapshot = systems[0]?.content ?? '';
    expect(snapshot).toContain('SITUATION SNAPSHOT');
    expect(snapshot).toContain('Rooftop, Redmond');
    expect(snapshot).toContain('turn 2, pass 1');
    expect(snapshot).toContain('Kestrel'); // up next: Static already acted this pass
    expect(snapshot).toMatch(/Static P7\/10 S1\/10 Edge 2\/4/);
  });

  it('counts a running game session as live even with no fight on the table', async () => {
    await t.db.update(encounters).set({ state: 'prep' }).where(eq(encounters.id, fx.encounterId));
    const session = (
      await t.db
        .insert(gameSessions)
        .values({ campaignId: boot.campaignId, state: 'live' })
        .returning()
    )[0]!;
    const server = await mock({ turns: [{ content: 'Between fights.' }] });
    const res = await gm({ message: 'where are we?' });
    expect((res.json() as { snapshotApplied: boolean }).snapshotApplied).toBe(true);
    const snapshot = server.requests[0]!.messages.filter((m) => m.role === 'system')[0]?.content ?? '';
    expect(snapshot).toContain('Encounter: none running.');
    expect(snapshot).toContain('Party: Static');

    await t.db.delete(gameSessions).where(eq(gameSessions.id, session.id));
    await t.db.update(encounters).set({ state: 'live' }).where(eq(encounters.id, fx.encounterId));
  });

  it('sends no snapshot when nothing is live', async () => {
    await t.db.update(encounters).set({ state: 'prep' }).where(eq(encounters.id, fx.encounterId));
    const server = await mock({ turns: [{ content: 'Prep mode.' }] });
    const res = await gm({ message: 'anything running?' });
    expect((res.json() as { snapshotApplied: boolean }).snapshotApplied).toBe(false);
    const systems = server.requests[0]!.messages.filter((m) => m.role === 'system');
    expect(systems).toHaveLength(1);
    expect(systems[0]?.content ?? '').not.toContain('SITUATION SNAPSHOT');
    await t.db.update(encounters).set({ state: 'live' }).where(eq(encounters.id, fx.encounterId));
  });
});

describe('streaming to the GM panel (§11, Principle 4)', () => {
  it('streams fixer.delta/fixer.done to the GM socket and nothing to players', async () => {
    await mock({ turns: [{ content: 'The ganger breaks for the stairwell if he drops two more boxes.' }] });
    const gmSocket = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, boot.gmToken));
    const playerSocket = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, player.token));
    sockets.push(gmSocket, playerSocket);

    const res = await gm({ message: 'will the ganger run?' });
    expect(res.statusCode).toBe(200);

    const done = await gmSocket.next((f) => f.type === 'fixer.done');
    expect(done.ephemeral).toBe(true);
    expect(gmSocket.has((f) => f.type === 'fixer.delta')).toBe(true);
    const deltas = gmSocket.frames
      .filter((f) => f.type === 'fixer.delta')
      .map((f) => (f.payload as { text: string }).text)
      .join('');
    expect(deltas).toContain('stairwell');
    expect(playerSocket.has((f) => f.type.startsWith('fixer.'))).toBe(false);
  });

  it('brackets every tool call with a start and an end frame', async () => {
    // The panel's chip is the only sign the GM has that the model is still
    // grinding through the library. One frame per call left every chip reading
    // "done" the instant it appeared, which is the opposite of the point.
    await mock({
      responder: (req) =>
        lastToolResult(req)
          ? { content: 'Nobody is down yet.' }
          : { toolCalls: [{ name: 'get_encounter', arguments: {} }] },
    });
    const gmSocket = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, boot.gmToken));
    sockets.push(gmSocket);

    const res = await gm({ message: 'anyone down?' });
    expect(res.statusCode).toBe(200);
    await gmSocket.next((f) => f.type === 'fixer.done');

    const toolFrames = gmSocket.frames
      .filter((f) => f.type === 'fixer.tool')
      .map((f) => f.payload as { name: string; status: string; detail?: string });
    expect(toolFrames.map((f) => f.status)).toEqual(['start', 'end']);
    expect(toolFrames.every((f) => f.name === 'get_encounter')).toBe(true);
    expect(toolFrames[1]!.detail).toMatch(/ms$/);
  });
});

describe('in-character NPC mode (FR12.5–12.6)', () => {
  it('builds a persona + knowledge-boundary prompt and saves the transcript', async () => {
    const server = await mock({ turns: [{ content: 'Two hundred, and I never saw your face.' }] });
    const npc = await t.app.inject({
      method: 'POST',
      url: `/api/npcs/${fx.templateId}/converse`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { message: 'What do you want for the keycard?' },
    });
    expect(npc.statusCode).toBe(200);
    const body = npc.json() as { line: string; conversationId: string };
    expect(body.line).toContain('Two hundred');

    const system = server.lastRequest()!.messages[0]!.content ?? '';
    expect(system).toContain('Street enforcer');
    expect(system).toContain('KNOWLEDGE BOUNDARY');
    expect(system).toContain('SECRETS');
    // The NPC gets no tools: what they know is what the boundary says.
    expect(server.lastRequest()!.tools ?? []).toHaveLength(0);

    const list = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${boot.campaignId}/fixer/conversations`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
    });
    const conversations = (list.json() as { conversations: Array<{ id: string; kind: string; npcRef: string | null }> })
      .conversations;
    const saved = conversations.find((c) => c.id === body.conversationId);
    expect(saved).toMatchObject({ kind: 'npc', npcRef: fx.templateId });
  });
});
