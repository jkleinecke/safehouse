/**
 * Every AI request can be stopped, and says while it runs (fixer/activity.ts).
 *
 * A mock box that stalls before its first frame stands in for a slow model:
 * the run is announced on the socket, the status route names it, a second
 * request is told what is in the way, and the cancel route ends it — the
 * caller that was waiting gets 499 ai_cancelled, and the idle announcement
 * says so. The same for the NPC voice and the floor builder.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MockLlmServer } from '../src/fixer/mock-llm.js';
import { resetRunsForTests } from '../src/fixer/activity.js';
import {
  bootstrapCampaign,
  makeTestApp,
  wsUrl,
  WsTestClient,
  type BootstrapResult,
  type Frame,
  type TestApp,
} from './core-helpers.js';
import { disableAi, enableAi } from './fixer-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let sceneId = '';
const mocks: MockLlmServer[] = [];
const sockets: WsTestClient[] = [];

beforeAll(async () => {
  t = await makeTestApp('fixer-cancel');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  boot = await bootstrapCampaign(t.app, 'Slow Box');
  const created = await t.app.inject({
    method: 'POST',
    url: `/api/campaigns/${boot.campaignId}/scenes`,
    headers: { authorization: `Bearer ${boot.gmToken}` },
    payload: { name: 'Dock' },
  });
  sceneId = (created.json() as { scene: { id: string } }).scene.id;
}, 180_000);

afterEach(async () => {
  disableAi();
  resetRunsForTests();
  for (const m of mocks.splice(0)) await m.close();
});

afterAll(async () => {
  for (const s of sockets.splice(0)) s.close();
  await t.close();
});

const auth = () => ({ authorization: `Bearer ${boot.gmToken}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function slowBox(delayMs: number, content = 'Too late, chummer.'): Promise<MockLlmServer> {
  // The vision probe (a chat with an image part) must answer at once: the
  // status route runs it, and a stalled probe would hide the run it reports on.
  const mock = await MockLlmServer.start({
    responder: (req) => {
      const probe = req.messages.some((m) => Array.isArray(m.content as unknown));
      return probe ? { content: 'ok' } : { content, delayMs };
    },
  });
  mocks.push(mock);
  enableAi(mock.baseUrl);
  return mock;
}

async function listener(): Promise<WsTestClient> {
  const ws = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, boot.gmToken));
  sockets.push(ws);
  await ws.next((f) => f.type === 'hello');
  return ws;
}

const activity = (f: Frame) => f.type === 'ai.activity';
const payload = (f: Frame) => f.payload as { state: string; kind?: string; label?: string; outcome?: string };

describe('a chat turn', () => {
  it('is announced, named by the status route, and stopped by the cancel route', async () => {
    await slowBox(4_000);
    const ws = await listener();
    const chat = t.app.inject({
      method: 'POST',
      url: '/api/fixer/chat',
      headers: auth(),
      payload: { campaignId: boot.campaignId, message: 'Who runs the docks?' },
    });
    const busy = payload(await ws.next(activity));
    expect(busy).toMatchObject({ state: 'busy', kind: 'chat', label: 'answering the Fixer chat' });

    const status = await t.app.inject({ method: 'GET', url: `/api/fixer/status?campaignId=${boot.campaignId}`, headers: auth() });
    expect((status.json() as { activity: { kind: string } | null }).activity).toMatchObject({ kind: 'chat' });

    // A second request while one is running is told what is in the way.
    const second = await t.app.inject({
      method: 'POST',
      url: '/api/fixer/chat',
      headers: auth(),
      payload: { campaignId: boot.campaignId, message: 'again' },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string; message: string } }).error).toMatchObject({ code: 'ai_busy' });
    expect((second.json() as { error: { message: string } }).error.message).toContain('answering the Fixer chat');

    const cancel = await t.app.inject({ method: 'POST', url: '/api/fixer/cancel', headers: auth(), payload: { campaignId: boot.campaignId } });
    expect(cancel.json()).toEqual({ cancelled: true });
    const res = await chat;
    expect(res.statusCode).toBe(499);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ai_cancelled');

    const idle = payload(await ws.next((f) => activity(f) && payload(f).state === 'idle'));
    expect(idle).toMatchObject({ state: 'idle', kind: 'chat', outcome: 'cancelled' });
    const after = await t.app.inject({ method: 'GET', url: `/api/fixer/status?campaignId=${boot.campaignId}`, headers: auth() });
    expect((after.json() as { activity: unknown }).activity).toBeNull();
  });

  it('finishes normally when nobody cancels, and the idle announcement says done', async () => {
    await slowBox(50, 'Rusted Halo runs the docks.');
    const ws = await listener();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/fixer/chat',
      headers: auth(),
      payload: { campaignId: boot.campaignId, message: 'Who runs the docks?' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const idle = payload(await ws.next((f) => activity(f) && payload(f).state === 'idle'));
    expect(idle).toMatchObject({ state: 'idle', outcome: 'done' });
  });
});

describe('the other lanes', () => {
  it('cancel with nothing running says so', async () => {
    await slowBox(50);
    const res = await t.app.inject({ method: 'POST', url: '/api/fixer/cancel', headers: auth(), payload: { campaignId: boot.campaignId } });
    expect(res.json()).toEqual({ cancelled: false });
  });

  it('stops a floor being drafted, and nothing is painted', async () => {
    await slowBox(4_000);
    const draft = t.app.inject({
      method: 'POST',
      url: '/api/fixer/build-floor',
      headers: auth(),
      payload: { campaignId: boot.campaignId, sceneId, tilesetId: 'docklands', prompt: 'a loading dock with two bays' },
    });
    await sleep(200);
    const status = await t.app.inject({ method: 'GET', url: `/api/fixer/status?campaignId=${boot.campaignId}`, headers: auth() });
    expect((status.json() as { activity: { kind: string; label: string } | null }).activity).toMatchObject({ kind: 'floor' });
    await t.app.inject({ method: 'POST', url: '/api/fixer/cancel', headers: auth(), payload: { campaignId: boot.campaignId } });
    const res = await draft;
    expect(res.statusCode).toBe(499);
    const scene = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: auth() });
    expect((scene.json() as { scene: { tiles?: unknown } }).scene.tiles).toBeUndefined();
  });
});
