/**
 * The Fixer's chats as a list the GM keeps (fixer/conversations.ts,
 * fixer/chat/pipe.ts): a turn outlives the browser that asked it, the list
 * pages newest save first, and a deleted chat takes its unused uploads along.
 */
import { existsSync } from 'node:fs';
import { request, type ClientRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { aiConversations, attachments, wikiPages } from '@safehouse/db';
import { MockLlmServer } from '../src/fixer/mock-llm.js';
import { currentRun, resetRunsForTests, withRun } from '../src/fixer/activity.js';
import { ScenesService } from '../src/services/scenes.js';
import { bootstrapCampaign, makeTestApp, type BootstrapResult, type TestApp } from './core-helpers.js';
import { disableAi, enableAi } from './fixer-helpers.js';

// A 1×1 PNG: real bytes, so the store's type sniff lets it in.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let t: TestApp;
let boot: BootstrapResult;
const mocks: MockLlmServer[] = [];

beforeAll(async () => {
  t = await makeTestApp('fixer-conversations');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  boot = await bootstrapCampaign(t.app, 'Long Memory');
}, 180_000);

afterEach(async () => {
  disableAi();
  resetRunsForTests();
  for (const m of mocks.splice(0)) await m.close();
});

afterAll(async () => {
  await t.close();
});

const auth = (token = boot.gmToken) => ({ authorization: `Bearer ${token}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function box(content: string, delayMs: number): Promise<void> {
  const mock = await MockLlmServer.start({ responder: () => ({ content, delayMs }) });
  mocks.push(mock);
  enableAi(mock.baseUrl);
}

async function until(check: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(25);
  }
}

async function newChat(campaignId: string, messages: unknown[] = [], extra: Partial<typeof aiConversations.$inferInsert> = {}) {
  return (await t.db.insert(aiConversations).values({ campaignId, kind: 'fixer', ownerUserId: boot.gmUserId, messages, ...extra }).returning())[0]!.id;
}

const said = (id: string, text: string, role: 'user' | 'assistant' = 'user') => ({ id, role, parts: [{ type: 'text', text }] });

/** A real socket, so the browser can hang up part way. */
function openTurn(body: unknown): { req: ClientRequest; response: Promise<IncomingMessage> } {
  const { port } = t.app.server.address() as AddressInfo;
  const req = request({
    host: '127.0.0.1',
    port,
    method: 'POST',
    path: '/api/fixer/chat/stream',
    headers: { ...auth(), 'content-type': 'application/json' },
  });
  const response = new Promise<IncomingMessage>((resolve, reject) => {
    req.on('response', resolve);
    req.on('error', reject);
  });
  response.catch(() => undefined); // a hung-up browser is the point of one test
  req.end(JSON.stringify(body));
  return { req, response };
}

async function transcript(id: string): Promise<Array<{ role: string; parts: Array<{ type: string; text?: string }> }>> {
  const row = (await t.db.select().from(aiConversations).where(eq(aiConversations.id, id)))[0]!;
  return row.messages as Array<{ role: string; parts: Array<{ type: string; text?: string }> }>;
}

describe('a streaming turn', () => {
  it('runs on and is saved when the browser goes mid-answer, and frees the Fixer', async () => {
    await box('Pike Street, second floor, behind the noodle bar.', 800);
    const chatId = await newChat(boot.campaignId);
    const { req } = openTurn({
      campaignId: boot.campaignId,
      conversationId: chatId,
      message: said('m-gone', 'Where is the safehouse?'),
    });
    req.on('error', () => undefined);
    await until(() => currentRun(boot.campaignId) !== null);
    expect(currentRun(boot.campaignId)?.conversationId).toBe(chatId);
    await sleep(100);
    req.destroy(); // the GM closed the panel before a word came back

    await until(() => currentRun(boot.campaignId) === null);
    const saved = await transcript(chatId);
    expect(saved.map((m) => m.role)).toEqual(['user', 'assistant']);
    const answer = saved[1]!.parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
    expect(answer).toContain('noodle bar');
  });

  it('still stops on the GM cancel', async () => {
    await box('Too late.', 5_000);
    const chatId = await newChat(boot.campaignId);
    const { response } = openTurn({ campaignId: boot.campaignId, conversationId: chatId, message: said('m-cancel', 'Slow one') });
    await until(() => currentRun(boot.campaignId) !== null);
    const started = Date.now();
    const cancel = await t.app.inject({ method: 'POST', url: '/api/fixer/cancel', headers: auth(), payload: { campaignId: boot.campaignId } });
    expect(cancel.json()).toEqual({ cancelled: true });

    const res = await response;
    await new Promise((resolve) => {
      res.resume();
      res.on('end', resolve);
    });
    await until(() => currentRun(boot.campaignId) === null, 4_000);
    expect(Date.now() - started).toBeLessThan(4_000);
    // The question is kept even though the answer was stopped.
    expect((await transcript(chatId))[0]).toMatchObject({ role: 'user' });
  });
});

describe('the chat list', () => {
  it('pages newest save first, filters by kind and NPC, and leaves out empty chats', async () => {
    const created = await t.app.inject({ method: 'POST', url: '/api/campaigns', headers: auth(), payload: { name: 'Listing' } });
    const other = created.json() as { campaignId: string; token: string };
    const npc = '11111111-2222-4333-8444-555555555555';
    const at = (s: number) => new Date(Date.UTC(2026, 8, 1, 12, 0, s));
    const a = await newChat(other.campaignId, [said('a1', 'Plan the Pike job'), said('a2', 'Sure.', 'assistant')], { updatedAt: at(1) });
    const b = await newChat(other.campaignId, [said('b1', 'Who is Kavanagh?')], { updatedAt: at(3) });
    const c = await newChat(other.campaignId, [{ role: 'user', content: 'What do you want?' }], {
      kind: 'npc',
      npcRef: npc,
      updatedAt: at(2),
    });
    await newChat(other.campaignId, [], { updatedAt: at(9) });

    const list = async (query: string) => {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/campaigns/${other.campaignId}/fixer/conversations${query}`,
        headers: auth(other.token),
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as {
        conversations: Array<{ id: string; title: string; messageCount: number; updatedAt: string; running: boolean }>;
        nextCursor: string | null;
      };
    };

    const first = await list('?limit=2');
    expect(first.conversations.map((x) => x.id)).toEqual([b, c]);
    expect(first.conversations[0]).toMatchObject({ title: 'Who is Kavanagh?', messageCount: 1, running: false });
    expect(first.conversations[0]!.updatedAt).toBe(at(3).toISOString());
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await list(`?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.conversations.map((x) => x.id)).toEqual([a]);
    expect(second.conversations[0]).toMatchObject({ title: 'Plan the Pike job', messageCount: 2 });
    expect(second.nextCursor).toBeNull();

    expect((await list('?kind=fixer')).conversations.map((x) => x.id)).toEqual([b, a]);
    expect((await list(`?npcRef=${npc}`)).conversations.map((x) => x.id)).toEqual([c]);

    const bad = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${other.campaignId}/fixer/conversations?cursor=nonsense`,
      headers: auth(other.token),
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('deleting a chat', () => {
  const upload = (campaignId: string, kind: 'handout' | 'map' = 'handout') =>
    new ScenesService(t.db).saveAttachment({ campaignId, kind, visibility: 'gm', mime: 'image/png', file: Readable.from(PNG) });
  const fileOf = (id: string) => ({ type: 'file', mediaType: 'image/png', url: `/files/${id}`, filename: 'x.png' });
  const onDisk = async (id: string) => {
    const svc = new ScenesService(t.db);
    const row = await svc.attachment(id);
    return row !== null && existsSync(svc.attachmentPath(row));
  };

  it('removes the chat and the uploads nothing else uses', async () => {
    const own = await upload(boot.campaignId);
    const shared = await upload(boot.campaignId);
    const map = await upload(boot.campaignId, 'map');
    await t.db.insert(wikiPages).values({ campaignId: boot.campaignId, title: 'Handout', contentMd: `![](/files/${shared.id})` });
    const chatId = await newChat(
      boot.campaignId,
      [{ id: 'u1', role: 'user', parts: [said('x', 'Look at these').parts[0], fileOf(own.id), fileOf(shared.id), fileOf(map.id)] }],
      { memory: { files: { [own.id]: { id: own.id, name: 'x.png', mediaType: 'image/png', kind: 'image' } } } },
    );

    const res = await t.app.inject({ method: 'DELETE', url: `/api/fixer/conversations/${chatId}`, headers: auth() });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ deleted: chatId, files: [own.id] });

    expect(await t.db.select().from(aiConversations).where(eq(aiConversations.id, chatId))).toHaveLength(0);
    expect(await t.db.select().from(attachments).where(eq(attachments.id, own.id))).toHaveLength(0);
    // Linked from a wiki page, or not a chat upload at all: kept.
    expect(await onDisk(shared.id)).toBe(true);
    expect(await onDisk(map.id)).toBe(true);

    const again = await t.app.inject({ method: 'DELETE', url: `/api/fixer/conversations/${chatId}`, headers: auth() });
    expect(again.statusCode).toBe(404);
  });

  it('keeps an upload that was shown to the table, even one hidden again', async () => {
    const shown = await upload(boot.campaignId);
    const rehidden = await upload(boot.campaignId);
    const reveal = (id: string, visibility: 'public' | 'gm') =>
      t.app.inject({ method: 'POST', url: `/api/handouts/${id}/reveal`, headers: auth(), payload: { visibility } });
    expect((await reveal(shown.id, 'public')).statusCode).toBe(200);
    expect((await reveal(rehidden.id, 'public')).statusCode).toBe(200);
    expect((await reveal(rehidden.id, 'gm')).statusCode).toBe(200);
    const chatId = await newChat(boot.campaignId, [
      { id: 'u2', role: 'user', parts: [fileOf(shown.id), fileOf(rehidden.id)] },
    ]);

    const res = await t.app.inject({ method: 'DELETE', url: `/api/fixer/conversations/${chatId}`, headers: auth() });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ deleted: chatId, files: [] });
    expect(await onDisk(shown.id)).toBe(true);
    expect(await onDisk(rehidden.id)).toBe(true);
  });

  it("refuses another campaign's chat", async () => {
    const created = await t.app.inject({ method: 'POST', url: '/api/campaigns', headers: auth(), payload: { name: 'Elsewhere' } });
    const away = created.json() as { campaignId: string };
    const theirs = await newChat(away.campaignId, [said('t1', 'Not yours')]);
    const res = await t.app.inject({ method: 'DELETE', url: `/api/fixer/conversations/${theirs}`, headers: auth() });
    expect(res.statusCode).toBe(404);
    expect(await t.db.select().from(aiConversations).where(eq(aiConversations.id, theirs))).toHaveLength(1);
  });

  it('refuses a chat the Fixer is still answering in', async () => {
    const chatId = await newChat(boot.campaignId, [said('r1', 'Still thinking?')]);
    let release!: () => void;
    const held = withRun(undefined, boot.campaignId, 'chat', 'answering the Fixer chat', async (_signal, run) => {
      run.conversationId = chatId;
      await new Promise<void>((r) => (release = r));
    });
    const listed = await t.app.inject({ method: 'GET', url: `/api/campaigns/${boot.campaignId}/fixer/conversations`, headers: auth() });
    const row = (listed.json() as { conversations: Array<{ id: string; running: boolean }> }).conversations.find((x) => x.id === chatId);
    expect(row?.running).toBe(true);

    const res = await t.app.inject({ method: 'DELETE', url: `/api/fixer/conversations/${chatId}`, headers: auth() });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('conversation_running');
    release();
    await held;
  });
});
