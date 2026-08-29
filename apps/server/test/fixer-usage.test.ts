/**
 * The usage meter across a restart (FR12.15/12.16).
 *
 * `ai_generations.usage` only ever covers turns that produced a DRAFT, and most
 * of what a GM asks the Fixer produces prose, not a draft. So the meter's whole
 * number lived in a per-process `Map` and a server restart set it to zero — the
 * one number whose entire job is to say what the box has been doing was reset
 * by the most ordinary thing an operator does.
 *
 * The tests that matter are therefore the ones that cross a process boundary:
 * write turns, close the database the way a shutdown does, reopen the SAME
 * directory in a fresh app, and read the meter. The old design reads zero at
 * that line. Everything else here is scoping — the number is per campaign, and
 * `ai_generations` is left exactly as it was.
 *
 * PGlite is single-writer, so the two app lifetimes are opened and closed
 * strictly one at a time against one temp DATA_DIR.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getDb, resetDbSingleton, aiGenerations, closeDb, type Db } from '@safehouse/db';
import { buildApp } from '../src/app.js';
import { campaignUsage, persistTurnUsage, usageMeter } from '../src/fixer/usage.js';
import { MockLlmServer } from '../src/fixer/mock-llm.js';
import { bootstrapCampaign, type BootstrapResult } from './core-helpers.js';
import { disableAi, enableAi, seedFixerFixture } from './fixer-helpers.js';

interface Lifetime {
  app: FastifyInstance;
  db: Db;
}

let dataDir: string;
let live: Lifetime | null = null;
let boot: BootstrapResult;
let otherCampaignId: string;
const mocks: MockLlmServer[] = [];

interface UsageBody {
  campaignId: string;
  total: {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMsTotal: number;
    latencyMsAvg: number;
    byModel: Record<string, { calls: number; totalTokens: number }>;
    byKind: Record<string, number>;
    since: string | null;
  };
  session: { calls: number; totalTokens: number };
  drafts: { generations: number; totalTokens: number; pending: number };
  currency: string;
}

/**
 * Open the temp DATA_DIR as a whole new server. Called more than once against
 * the same directory on purpose — that reopen IS the test.
 */
async function bootLifetime(): Promise<Lifetime> {
  process.env.DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;
  resetDbSingleton();
  const db = getDb();
  const app = await buildApp({ db, webDist: false, logger: false });
  return { app, db };
}

async function shutdown(lifetime: Lifetime): Promise<void> {
  await lifetime.app.close();
  // `closeDb` checkpoints before closing, which is what a real shutdown does
  // and what makes the reopen a clean start rather than WAL recovery.
  await closeDb(lifetime.db);
  resetDbSingleton();
}

async function usage(app: FastifyInstance, token: string, campaignId: string): Promise<UsageBody> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/campaigns/${campaignId}/fixer/usage`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as UsageBody;
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'safehouse-usage-'));
}, 120_000);

afterAll(async () => {
  if (live) await shutdown(live);
  for (const m of mocks) await m.close();
  disableAi();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* Windows handle stragglers — temp dir, the OS cleans up */
  }
});

afterEach(() => {
  disableAi();
});

describe('the meter survives a restart', () => {
  it('records real chat turns through the route', async () => {
    live = await bootLifetime();
    boot = await bootstrapCampaign(live.app, 'Neon Rain');
    await seedFixerFixture(live.db, boot.campaignId);

    const server = await MockLlmServer.start({
      turns: [
        {
          content: 'Static is the one to worry about.',
          usage: { promptTokens: 900, completionTokens: 100 },
          delayMs: 5,
        },
        {
          content: 'Kestrel can still take a hit.',
          usage: { promptTokens: 400, completionTokens: 100 },
          delayMs: 5,
        },
      ],
    });
    mocks.push(server);
    enableAi(server.baseUrl);

    for (const message of ["who's hurt worst?", 'and Kestrel?']) {
      const res = await live.app.inject({
        method: 'POST',
        url: '/api/fixer/chat',
        headers: { authorization: `Bearer ${boot.gmToken}` },
        payload: { message },
      });
      expect(res.statusCode, res.body).toBe(200);
    }

    const before = await usage(live.app, boot.gmToken, boot.campaignId);
    expect(before.total.calls).toBe(2);
    expect(before.total.totalTokens).toBe(1500);
    expect(before.total.byKind['chat']).toBe(1500);
    expect(before.total.since).not.toBeNull();
    // The live half is still there and still per-process.
    expect(before.session.calls).toBe(2);
  }, 120_000);

  it('reads the same number back from a fresh server on the same directory', async () => {
    // The restart. Everything on the heap — the `usageMeter` Map included — is
    // gone at this line; only the directory survives.
    await shutdown(live!);
    live = null;
    usageMeter.reset(); // the new process's meter starts empty, as a real one would
    live = await bootLifetime();

    const after = await usage(live.app, boot.gmToken, boot.campaignId);
    expect(after.total.calls).toBe(2);
    expect(after.total.totalTokens).toBe(1500);
    expect(after.total.promptTokens).toBe(1300);
    expect(after.total.completionTokens).toBe(200);
    expect(after.total.latencyMsTotal).toBeGreaterThan(0);
    expect(after.total.latencyMsAvg).toBeGreaterThan(0);
    // …and the process-scoped half is honestly zero, which is the distinction
    // the two numbers exist to draw.
    expect(after.session.calls).toBe(0);
    expect(after.session.totalTokens).toBe(0);
  }, 120_000);

  it('keeps the number per campaign', async () => {
    const second = await live!.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { name: 'Second Table' },
    });
    expect(second.statusCode).toBe(201);
    const created = second.json() as { campaignId: string; token: string };
    otherCampaignId = created.campaignId;

    const theirs = await usage(live!.app, created.token, otherCampaignId);
    expect(theirs.total.calls).toBe(0);
    expect(theirs.total.totalTokens).toBe(0);
    expect(theirs.total.since).toBeNull();
    // The first table is untouched by the second existing.
    expect((await usage(live!.app, boot.gmToken, boot.campaignId)).total.calls).toBe(2);
  }, 120_000);

  it('splits by model and by kind', async () => {
    await persistTurnUsage(live!.db, {
      campaignId: boot.campaignId,
      model: 'fast-3b',
      usage: { promptTokens: 90, completionTokens: 10, totalTokens: 100 },
      latencyMs: 60,
      kind: 'npc',
    });
    const totals = await campaignUsage(live!.db, boot.campaignId);
    expect(totals.calls).toBe(3);
    expect(totals.totalTokens).toBe(1600);
    expect(totals.byModel['fast-3b']).toMatchObject({ calls: 1, totalTokens: 100 });
    expect(totals.byModel['mock-primary']).toMatchObject({ calls: 2, totalTokens: 1500 });
    expect(totals.byKind).toEqual({ chat: 1500, npc: 100 });
  }, 120_000);

  it('leaves ai_generations alone — drafts keep their own paper trail', async () => {
    const rows = await live!.db.select().from(aiGenerations);
    expect(rows).toHaveLength(0);
    const body = await usage(live!.app, boot.gmToken, boot.campaignId);
    expect(body.drafts).toMatchObject({ generations: 0, pending: 0, totalTokens: 0 });
    expect(body.currency).toBe('tokens+latency');
  }, 120_000);
});

describe('persistTurnUsage is bookkeeping, never a failure path', () => {
  it('returns false instead of throwing when the row cannot land', async () => {
    // A campaign id with no row: the FK rejects it. The GM already has their
    // answer at this point, so this must not become a 500.
    const landed = await persistTurnUsage(live!.db, {
      campaignId: '00000000-0000-4000-8000-000000000000',
      model: 'primary',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      latencyMs: 5,
    });
    expect(landed).toBe(false);
  }, 120_000);

  it('clamps nonsense counters rather than writing them', async () => {
    const camp = boot.campaignId;
    const landed = await persistTurnUsage(live!.db, {
      campaignId: camp,
      model: '',
      usage: {
        promptTokens: -5,
        completionTokens: Number.NaN,
        totalTokens: Number.POSITIVE_INFINITY,
      },
      latencyMs: -1,
      kind: 'tool',
    });
    expect(landed).toBe(true);
    const totals = await campaignUsage(live!.db, camp);
    // The bad row contributes zeroes under `unknown`, not a poisoned total.
    expect(totals.byModel['unknown']).toMatchObject({ calls: 1, totalTokens: 0 });
    expect(totals.byKind['tool']).toBe(0);
  }, 120_000);
});
