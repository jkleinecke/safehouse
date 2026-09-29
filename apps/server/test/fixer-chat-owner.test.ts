/**
 * A Fixer or NPC chat is its starter's (0018): anyone else gets a 404 on
 * list, open, continue and delete. A chat from before owners belongs to the
 * campaign's owner of record, and moves with the campaign.
 *
 * One GM per campaign is the rule today, so the second GM-role user here is a
 * device minted straight into the table.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { aiConversations, devices, npcTemplates, users } from '@safehouse/db';
import { MockLlmServer } from '../src/fixer/mock-llm.js';
import { resetRunsForTests } from '../src/fixer/activity.js';
import { hashToken, mintToken } from '../src/services/auth.js';
import { bootstrapCampaign, joinAs, makeTestApp, wsUrl, WsTestClient, type BootstrapResult, type TestApp } from './core-helpers.js';
import { disableAi, enableAi } from './fixer-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let other: { userId: string; token: string };
const mocks: MockLlmServer[] = [];

beforeAll(async () => {
  t = await makeTestApp('fixer-chat-owner');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  boot = await bootstrapCampaign(t.app, 'Two Chairs');
  const user = (await t.db.insert(users).values({ displayName: 'Nightjar' }).returning())[0]!;
  const token = mintToken();
  await t.db.insert(devices).values({ userId: user.id, campaignId: boot.campaignId, role: 'gm', tokenHash: hashToken(token), label: 'co-GM' });
  other = { userId: user.id, token };
}, 180_000);

afterEach(async () => {
  disableAi();
  resetRunsForTests();
  for (const m of mocks.splice(0)) await m.close();
});

afterAll(async () => {
  await t.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const said = (id: string, text: string) => ({ id, role: 'user', parts: [{ type: 'text', text }] });

async function box(): Promise<void> {
  const mock = await MockLlmServer.start({ responder: () => ({ content: 'Noted.' }) });
  mocks.push(mock);
  enableAi(mock.baseUrl);
}

async function listed(token: string, campaignId = boot.campaignId, query = ''): Promise<string[]> {
  const res = await t.app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}/fixer/conversations${query}`, headers: auth(token) });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { conversations: Array<{ id: string }> }).conversations.map((c) => c.id);
}

const ownerOf = async (id: string) =>
  (await t.db.select({ owner: aiConversations.ownerUserId }).from(aiConversations).where(eq(aiConversations.id, id)))[0]?.owner;

describe('a Fixer chat', () => {
  it('is listed, opened, continued and deleted by its starter alone', async () => {
    await box();
    const chat = (payload: object, token = boot.gmToken) =>
      t.app.inject({ method: 'POST', url: '/api/fixer/chat', headers: auth(token), payload: { campaignId: boot.campaignId, ...payload } });
    const started = await chat({ message: 'Plan the Pike Street job' });
    expect(started.statusCode, started.body).toBe(200);
    const mine = (started.json() as { conversationId: string }).conversationId;
    expect(await ownerOf(mine)).toBe(boot.gmUserId);

    expect(await listed(boot.gmToken)).toContain(mine);
    expect(await listed(other.token)).not.toContain(mine);

    const theirs = [
      await t.app.inject({ method: 'GET', url: `/api/fixer/chat/${mine}`, headers: auth(other.token) }),
      await t.app.inject({ method: 'GET', url: `/api/fixer/conversations/${mine}`, headers: auth(other.token) }),
      await chat({ conversationId: mine, message: 'And the exit?' }, other.token),
      await t.app.inject({
        method: 'POST',
        url: '/api/fixer/chat/stream',
        headers: auth(other.token),
        payload: { campaignId: boot.campaignId, conversationId: mine, message: said('s1', 'And the exit?') },
      }),
      await t.app.inject({ method: 'DELETE', url: `/api/fixer/conversations/${mine}`, headers: auth(other.token) }),
    ];
    for (const res of theirs) {
      expect(res.statusCode, res.body).toBe(404);
      expect(res.body).not.toContain('Pike Street');
    }
    expect(await ownerOf(mine)).toBe(boot.gmUserId);

    expect((await t.app.inject({ method: 'GET', url: `/api/fixer/chat/${mine}`, headers: auth(boot.gmToken) })).statusCode).toBe(200);
    const opened = await t.app.inject({ method: 'GET', url: `/api/fixer/conversations/${mine}`, headers: auth(boot.gmToken) });
    expect(opened.statusCode).toBe(200);
    expect(opened.body).toContain('Pike Street');
    const next = await chat({ conversationId: mine, message: 'And the exit?' });
    expect(next.statusCode, next.body).toBe(200);
    expect((next.json() as { conversationId: string }).conversationId).toBe(mine);
    const gone = await t.app.inject({ method: 'DELETE', url: `/api/fixer/conversations/${mine}`, headers: auth(boot.gmToken) });
    expect(gone.statusCode, gone.body).toBe(200);
  });

  it("belongs to whoever started it, and an NPC's transcript too", async () => {
    await box();
    const npcId = (await t.db.select({ id: npcTemplates.id }).from(npcTemplates).where(eq(npcTemplates.campaignId, boot.campaignId)).limit(1))[0]!.id;
    const converse = (token: string, conversationId?: string) =>
      t.app.inject({
        method: 'POST',
        url: `/api/npcs/${npcId}/converse`,
        headers: auth(token),
        payload: { campaignId: boot.campaignId, message: 'Who sent you?', ...(conversationId ? { conversationId } : {}) },
      });
    const started = await converse(other.token);
    expect(started.statusCode, started.body).toBe(200);
    const theirs = (started.json() as { conversationId: string }).conversationId;
    expect(await ownerOf(theirs)).toBe(other.userId);

    expect(await listed(other.token, boot.campaignId, `?npcRef=${npcId}`)).toEqual([theirs]);
    expect(await listed(boot.gmToken, boot.campaignId, `?npcRef=${npcId}`)).toEqual([]);
    expect((await converse(boot.gmToken, theirs)).statusCode).toBe(404);
    expect((await converse(other.token, theirs)).statusCode).toBe(200);
  });

  it("streams live to its starter's sockets alone", async () => {
    await box();
    const npcId = (await t.db.select({ id: npcTemplates.id }).from(npcTemplates).where(eq(npcTemplates.campaignId, boot.campaignId)).limit(1))[0]!.id;
    const mineSock = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, boot.gmToken));
    const theirSock = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, other.token));
    try {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/npcs/${npcId}/converse`,
        headers: auth(other.token),
        payload: { campaignId: boot.campaignId, message: 'Who sent you?' },
      });
      expect(res.statusCode, res.body).toBe(200);
      await theirSock.next((f) => f.type === 'fixer.done');
      expect(theirSock.frames.some((f) => f.type === 'fixer.delta')).toBe(true);
      // The run's idle notice follows the stream on every GM socket.
      await mineSock.next((f) => f.type === 'ai.activity' && (f.payload as { state?: string }).state === 'idle');
      expect(mineSock.frames.filter((f) => f.type.startsWith('fixer.'))).toEqual([]);
    } finally {
      mineSock.close();
      theirSock.close();
    }
  });
});

describe('a chat from before owners', () => {
  it("is the campaign owner's, and goes with the campaign", async () => {
    const created = await t.app.inject({ method: 'POST', url: '/api/campaigns', headers: auth(boot.gmToken), payload: { name: 'Handover' } });
    const camp = created.json() as { campaignId: string; token: string };
    const heir = await joinAs(t.app, camp.campaignId, camp.token, 'player', 'Heron');
    const insert = async (ownerUserId: string | null, text: string) =>
      (await t.db.insert(aiConversations).values({ campaignId: camp.campaignId, kind: 'fixer', ownerUserId, messages: [said('m', text)] }).returning())[0]!.id;
    const legacy = await insert(null, 'Old notes');
    const kept = await insert(boot.gmUserId, 'My own notes');

    expect(await listed(camp.token, camp.campaignId)).toEqual(expect.arrayContaining([legacy, kept]));

    const moved = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${camp.campaignId}/transfer-ownership`,
      headers: auth(camp.token),
      payload: { toUserId: heir.user.id },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    // The heir's player device is a GM device now.
    expect(await listed(heir.token, camp.campaignId)).toEqual([legacy]);
    expect((await t.app.inject({ method: 'GET', url: `/api/fixer/chat/${legacy}`, headers: auth(heir.token) })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: `/api/fixer/chat/${kept}`, headers: auth(heir.token) })).statusCode).toBe(404);
  });
});
