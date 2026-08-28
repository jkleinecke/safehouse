/**
 * The one outbound path in the whole system (§13): the Discord webhook.
 * Recap publishing (FR6.3) and optional public-roll mirroring (FR2.10) both
 * post fire-and-forget against a throwaway local HTTP server — never awaited,
 * never able to fail a request.
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { campaigns } from '@safehouse/db';
import { forgetCampaignSettings } from '../src/services/rolls.js';
import {
  bootstrapCampaign,
  makeTestApp,
  type BootstrapResult,
  type TestApp,
} from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let hook: Server;
let sessionId: string;
const received: string[] = [];
const previousEnv = process.env.DISCORD_WEBHOOK_URL;

/** Wait until a captured post matches, or fail — the post is asynchronous. */
async function waitForPost(match: (body: string) => boolean, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = received.find(match);
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(`no matching webhook post; got ${JSON.stringify(received)}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  hook = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => hook.listen(0, '127.0.0.1', resolve));
  const port = (hook.address() as AddressInfo).port;
  process.env.DISCORD_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;

  t = await makeTestApp('discord');
  boot = await bootstrapCampaign(t.app, 'Webhook Table');
  const started = await t.app.inject({
    method: 'POST',
    url: `/api/campaigns/${boot.campaignId}/sessions/start`,
    headers: { authorization: `Bearer ${boot.gmToken}` },
    payload: { date: '2076-06-01' },
  });
  sessionId = (started.json() as { session: { id: string } }).session.id;
}, 120_000);

afterAll(async () => {
  if (previousEnv === undefined) delete process.env.DISCORD_WEBHOOK_URL;
  else process.env.DISCORD_WEBHOOK_URL = previousEnv;
  await t.close();
  await new Promise<void>((resolve) => hook.close(() => resolve()));
});

describe('recap publishing (FR6.3)', () => {
  it('queues the recap to the webhook without blocking the response', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/publish-recap`,
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { recapMd: 'They made rent, barely, and the drone is still missing.' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { discord: string }).discord).toBe('queued');
    const body = await waitForPost((b) => b.includes('still missing'));
    expect(body).toContain('Session recap');
    expect(body).toContain('2076-06-01');
  });
});

describe('public roll mirroring (FR2.10)', () => {
  it('mirrors only when the campaign opts in, and only public rolls', async () => {
    // Opt out by default: a public roll posts nothing.
    await t.app.inject({
      method: 'POST',
      url: '/api/rolls',
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { pool: 5, actor: { gm: true }, meta: { label: 'Silent roll' } },
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(received.some((b) => b.includes('Silent roll'))).toBe(false);

    await t.db
      .update(campaigns)
      .set({ settings: sql`coalesce(${campaigns.settings}, '{}'::jsonb) || '{"mirrorRollsToDiscord":true}'::jsonb` })
      .where(eq(campaigns.id, boot.campaignId));
    forgetCampaignSettings(boot.campaignId);

    await t.app.inject({
      method: 'POST',
      url: '/api/rolls',
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { pool: 6, actor: { gm: true }, meta: { label: 'Kicking the door' } },
    });
    const mirrored = await waitForPost((b) => b.includes('Kicking the door'));
    expect(mirrored).toContain('dice');

    // A behind-the-screen roll never leaves the machine (Principle 4).
    await t.app.inject({
      method: 'POST',
      url: '/api/rolls',
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { pool: 6, visibility: 'gm', actor: { gm: true }, meta: { label: 'Ambush check' } },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(received.some((b) => b.includes('Ambush check'))).toBe(false);
  });
});
