/**
 * The two tables added for FR2.8 (personal macros) and FR12.15 (a usage meter
 * that survives a restart).
 *
 * Both exist because something was being kept in volatile memory that had no
 * business being there — a macro rack in one browser's `localStorage`, a token
 * count in one server process's heap — so the tests that matter are the ones
 * that cross the boundary the old design could not: a second identity reading
 * the first one's rows, and a database that is closed and reopened.
 *
 * The reopen half runs against an ON-DISK PGlite in a temp directory, opened
 * and closed strictly one at a time. PGlite is single-writer: two handles on
 * one directory is not an error, it is a hang.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  aiUsage,
  campaigns,
  closeDb,
  createPgliteDb,
  ensureMigrations,
  userMacros,
  users,
  type Db,
} from '../src/index.js';

let client: PGlite;
let db: Db;
let campaignId: string;
let otherCampaignId: string;
let samId: string;
let noorId: string;

const scratch: string[] = [];

beforeAll(async () => {
  client = new PGlite(); // in-memory throwaway
  db = createPgliteDb(client);
  await ensureMigrations(db);

  const people = await db
    .insert(users)
    .values([{ displayName: 'Sam' }, { displayName: 'Noor' }])
    .returning();
  samId = people[0]!.id;
  noorId = people[1]!.id;
  const tables = await db
    .insert(campaigns)
    .values([
      { name: 'Static on the Line', gmUserId: samId },
      { name: 'Another Table', gmUserId: samId },
    ])
    .returning();
  campaignId = tables[0]!.id;
  otherCampaignId = tables[1]!.id;
});

afterAll(async () => {
  await client.close();
  for (const dir of scratch) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows handle stragglers — temp dir, the OS cleans up */
    }
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `safehouse-${prefix}-`));
  scratch.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// user_macros (FR2.8)
// ---------------------------------------------------------------------------

describe('user_macros', () => {
  it('keys a rack on the person, not the device', async () => {
    await db.insert(userMacros).values([
      { campaignId, userId: samId, label: 'Full auto burst', config: { pool: 14 }, sortOrder: 0 },
      { campaignId, userId: samId, label: 'Sneaking', config: { pool: 9 }, sortOrder: 1 },
      { campaignId, userId: noorId, label: 'Assensing', config: { pool: 7 }, sortOrder: 0 },
    ]);
    const sams = await db
      .select()
      .from(userMacros)
      .where(and(eq(userMacros.userId, samId), eq(userMacros.campaignId, campaignId)));
    expect(sams.map((m) => m.label).sort()).toEqual(['Full auto burst', 'Sneaking']);
    // Nothing about a device appears in the key, so a second handset for the
    // same person is the same rack by construction.
    const noors = await db
      .select()
      .from(userMacros)
      .where(and(eq(userMacros.userId, noorId), eq(userMacros.campaignId, campaignId)));
    expect(noors).toHaveLength(1);
  });

  it('refuses a second row for the same (user, campaign, label)', async () => {
    await expect(
      db
        .insert(userMacros)
        .values({ campaignId, userId: samId, label: 'Sneaking', config: { pool: 11 } }),
    ).rejects.toBeDefined();
  });

  it('lets the same label exist for another campaign or another person', async () => {
    await db.insert(userMacros).values([
      { campaignId: otherCampaignId, userId: samId, label: 'Sneaking', config: { pool: 8 } },
      { campaignId, userId: noorId, label: 'Sneaking', config: { pool: 6 } },
    ]);
    const rows = await db.select().from(userMacros).where(eq(userMacros.label, 'Sneaking'));
    expect(rows).toHaveLength(3);
  });

  it('upserts on the label — the idempotent migration path', async () => {
    const before = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(userMacros)
      .where(and(eq(userMacros.userId, samId), eq(userMacros.campaignId, campaignId)));
    // Exactly what a second phone pushing its leftover localStorage rack does.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await db
        .insert(userMacros)
        .values({ campaignId, userId: samId, label: 'Sneaking', config: { pool: 12 } })
        .onConflictDoUpdate({
          target: [userMacros.userId, userMacros.campaignId, userMacros.label],
          set: { config: { pool: 12 }, updatedAt: new Date() },
        });
    }
    const after = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(userMacros)
      .where(and(eq(userMacros.userId, samId), eq(userMacros.campaignId, campaignId)));
    expect(after[0]!.n).toBe(before[0]!.n);
    const row = (
      await db
        .select()
        .from(userMacros)
        .where(
          and(
            eq(userMacros.userId, samId),
            eq(userMacros.campaignId, campaignId),
            eq(userMacros.label, 'Sneaking'),
          ),
        )
    )[0]!;
    expect((row.config as { pool: number }).pool).toBe(12);
  });

  it('goes away with its campaign', async () => {
    const doomedUser = (await db.insert(users).values({ displayName: 'Transient' }).returning())[0]!;
    const doomed = (
      await db.insert(campaigns).values({ name: 'Doomed', gmUserId: doomedUser.id }).returning()
    )[0]!;
    await db
      .insert(userMacros)
      .values({ campaignId: doomed.id, userId: doomedUser.id, label: 'Anything', config: { pool: 3 } });
    await db.delete(campaigns).where(eq(campaigns.id, doomed.id));
    const left = await db.select().from(userMacros).where(eq(userMacros.campaignId, doomed.id));
    expect(left).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ai_usage (FR12.15)
// ---------------------------------------------------------------------------

describe('ai_usage', () => {
  it('aggregates per campaign and per model', async () => {
    await db.insert(aiUsage).values([
      { campaignId, model: 'primary-8b', kind: 'chat', promptTokens: 900, completionTokens: 100, totalTokens: 1000, latencyMs: 800 },
      { campaignId, model: 'primary-8b', kind: 'npc', promptTokens: 400, completionTokens: 100, totalTokens: 500, latencyMs: 400 },
      { campaignId, model: 'fast-3b', kind: 'chat', promptTokens: 90, completionTokens: 10, totalTokens: 100, latencyMs: 60 },
      { campaignId: otherCampaignId, model: 'primary-8b', kind: 'chat', promptTokens: 5, completionTokens: 5, totalTokens: 10, latencyMs: 5 },
    ]);
    const rows = await db
      .select({
        model: aiUsage.model,
        tokens: sql<number>`sum(${aiUsage.totalTokens})::int`,
      })
      .from(aiUsage)
      .where(eq(aiUsage.campaignId, campaignId))
      .groupBy(aiUsage.model);
    const byModel = Object.fromEntries(rows.map((r) => [r.model, r.tokens]));
    expect(byModel['primary-8b']).toBe(1500);
    expect(byModel['fast-3b']).toBe(100);
    // The other table's tokens are not this table's tokens.
    expect(Object.values(byModel).reduce((a, b) => a + b, 0)).toBe(1600);
  });

  it('survives closing and reopening the database', async () => {
    const dir = tempDir('usage-restart');

    // --- process-lifetime 1: write ------------------------------------------
    const first = new PGlite(join(dir, 'pglite'));
    const db1 = createPgliteDb(first);
    await ensureMigrations(db1);
    const user = (await db1.insert(users).values({ displayName: 'Demo GM' }).returning())[0]!;
    const camp = (
      await db1.insert(campaigns).values({ name: 'Restart', gmUserId: user.id }).returning()
    )[0]!;
    await db1.insert(aiUsage).values([
      { campaignId: camp.id, model: 'primary-8b', kind: 'chat', promptTokens: 1200, completionTokens: 300, totalTokens: 1500, latencyMs: 2200 },
      { campaignId: camp.id, model: 'primary-8b', kind: 'chat', promptTokens: 800, completionTokens: 200, totalTokens: 1000, latencyMs: 1800 },
    ]);
    await closeDb(db1); // checkpoint + close, the way a server shutdown does

    // --- process-lifetime 2: read -------------------------------------------
    // This is the whole point of the table. The old meter was a Map on the heap;
    // at this line it would read zero.
    const second = new PGlite(join(dir, 'pglite'));
    const db2 = createPgliteDb(second);
    await ensureMigrations(db2); // a real boot re-runs them; must be a no-op
    const totals = (
      await db2
        .select({
          turns: sql<number>`count(*)::int`,
          tokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}), 0)::int`,
          latency: sql<number>`coalesce(sum(${aiUsage.latencyMs}), 0)::int`,
        })
        .from(aiUsage)
        .where(eq(aiUsage.campaignId, camp.id))
    )[0]!;
    expect(totals.turns).toBe(2);
    expect(totals.tokens).toBe(2500);
    expect(totals.latency).toBe(4000);
    await closeDb(db2);
  }, 120_000);

  it('goes away with its campaign', async () => {
    const owner = (await db.insert(users).values({ displayName: 'Owner' }).returning())[0]!;
    const doomed = (
      await db.insert(campaigns).values({ name: 'Doomed usage', gmUserId: owner.id }).returning()
    )[0]!;
    await db.insert(aiUsage).values({ campaignId: doomed.id, model: 'm', totalTokens: 42 });
    await db.delete(campaigns).where(eq(campaigns.id, doomed.id));
    expect(await db.select().from(aiUsage).where(eq(aiUsage.campaignId, doomed.id))).toHaveLength(0);
  });
});

describe('migration 0002', () => {
  it('is additive — the pre-existing tables are untouched', async () => {
    const res = await client.query<{ count: number }>(
      `select count(*)::int as count from information_schema.tables where table_schema = 'public'`,
    );
    // 28 before (DESIGN.md §9.2), plus user_macros and ai_usage.
    expect(Number(res.rows[0]!.count)).toBeGreaterThanOrEqual(30);
    // `ai_generations.usage` is the draft's own paper trail and stays as it was.
    const cols = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'ai_generations'`,
    );
    expect(cols.rows.map((r) => r.column_name)).toContain('usage');
  });

  it('re-applies as a no-op', async () => {
    const before = await db.select().from(userMacros);
    await ensureMigrations(db);
    expect(await db.select().from(userMacros)).toHaveLength(before.length);
  });
});
