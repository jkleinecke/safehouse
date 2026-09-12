/**
 * "Check the box" (FR12.13): before a GM saves a local base URL, the server
 * tries to reach it and lists the model ids it serves. Reachable-and-listing,
 * reachable-but-empty, and unreachable are three different answers, and a
 * loopback address from inside a container gets the one hint that fixes it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockLlmServer } from '../src/fixer/mock-llm.js';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type JoinResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let mock: MockLlmServer;

beforeAll(async () => {
  t = await makeTestApp('ai-models');
  boot = await bootstrapCampaign(t.app, 'Local Box');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  mock = await MockLlmServer.start();
}, 180_000);

afterAll(async () => {
  await mock.close();
  await t.close();
});

function probe(baseUrl: string, token = boot.gmToken) {
  return t.app.inject({
    method: 'GET',
    url: `/api/campaigns/${boot.campaignId}/ai/models?baseUrl=${encodeURIComponent(baseUrl)}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /api/campaigns/:id/ai/models', () => {
  it('reaches a box and lists what it serves', async () => {
    const res = await probe(`${mock.baseUrl}/v1`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ reachable: true, models: ['mock-primary', 'mock-fast'], hint: null });
  });

  it('says when nothing answers, in words that name the URL', async () => {
    const res = await probe('http://127.0.0.1:9/v1');
    expect(res.statusCode).toBe(200);
    const out = res.json() as { reachable: boolean; models: string[]; note: string | null };
    expect(out.reachable).toBe(false);
    expect(out.models).toEqual([]);
    expect(out.note).toContain('127.0.0.1:9');
  });

  it('refuses a base URL that is not a URL, and a player', async () => {
    expect((await probe('box.lan:8080')).statusCode).toBe(400);
    expect((await probe(`${mock.baseUrl}/v1`, player.token)).statusCode).toBe(403);
  });

  it('tells a container that 127.0.0.1 is itself', async () => {
    // A stamped version is how the server knows it is an image (version.ts).
    const before = process.env.SAFEHOUSE_VERSION;
    process.env.SAFEHOUSE_VERSION = 'test-image';
    try {
      const res = await probe('http://127.0.0.1:9/v1');
      const out = res.json() as { reachable: boolean; hint: string | null };
      expect(out.reachable).toBe(false);
      expect(out.hint).toContain('host.docker.internal:9/v1');
    } finally {
      if (before === undefined) delete process.env.SAFEHOUSE_VERSION;
      else process.env.SAFEHOUSE_VERSION = before;
    }
  });
});
