import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import {
  appendEvent,
  getDb,
  latestEventOfType,
  resetDbSingleton,
  bookPages,
  books,
  campaigns,
  characters,
  createPgliteDb,
  ensureMigrations,
  eventsSince,
  latestEventId,
  ledgerBalance,
  ledgerEntries,
  nextEventId,
  searchBookPages,
  searchCodex,
  users,
  wikiPages,
  type Db,
} from '../src/index.js';

let client: PGlite;
let db: Db;
let gmId: string;
let campaignId: string;
let otherCampaignId: string;

beforeAll(async () => {
  client = new PGlite(); // in-memory throwaway
  db = createPgliteDb(client);
  await ensureMigrations(db);

  const [gm] = await db
    .insert(users)
    .values({ displayName: 'The GM', email: 'gm@example.test' })
    .returning();
  gmId = gm!.id;
  const inserted = await db
    .insert(campaigns)
    .values([
      { name: 'Neon Rain', gmUserId: gmId },
      { name: 'Second Table', gmUserId: gmId },
    ])
    .returning();
  campaignId = inserted[0]!.id;
  otherCampaignId = inserted[1]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('migrations', () => {
  it('are idempotent', async () => {
    await ensureMigrations(db); // second run must be a no-op
    const res = await client.query<{ count: number }>(
      `select count(*)::int as count from information_schema.tables where table_schema = 'public'`,
    );
    // 28 tables per DESIGN.md §9.2 (incl. matrix_hosts).
    expect(Number(res.rows[0]!.count)).toBeGreaterThanOrEqual(28);
  });
});

describe('book page FTS', () => {
  beforeAll(async () => {
    const [core] = await db
      .insert(books)
      .values({ campaignId, code: 'SR5', title: 'Core Rulebook', pageOffset: 5 })
      .returning();
    const [sidebook] = await db
      .insert(books)
      .values({ campaignId, code: 'RG', title: 'Gun Supplement', pageOffset: 2 })
      .returning();
    await db.insert(bookPages).values([
      {
        bookId: core!.id,
        printedPage: 173,
        text: 'Wireless bonuses require an active PAN. Noise reduces effective device rating.',
      },
      {
        bookId: core!.id,
        printedPage: 426,
        text: 'Heavy pistols use the heavy pistol range brackets printed on the weapon table.',
      },
      {
        bookId: sidebook!.id,
        printedPage: 40,
        text: 'Suppressive fire fills a cone; targets in the cone must defend or drop prone.',
      },
    ]);
  });

  it('finds a seeded phrase, ranked, with printed page and code', async () => {
    const hits = await searchBookPages(db, 'suppressive fire');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ bookCode: 'RG', printedPage: 40 });
    expect(hits[0]!.snippet.toLowerCase()).toContain('suppressive');
    expect(hits[0]!.rank).toBeGreaterThan(0);
  });

  it('filters by bookCode and respects limit', async () => {
    const all = await searchBookPages(db, 'pistol range');
    expect(all.some((h) => h.bookCode === 'SR5')).toBe(true);
    const rgOnly = await searchBookPages(db, 'fire', { bookCode: 'RG', limit: 1 });
    expect(rgOnly.length).toBeLessThanOrEqual(1);
    for (const h of rgOnly) expect(h.bookCode).toBe('RG');
  });

  it('returns nothing for a phrase never seeded', async () => {
    expect(await searchBookPages(db, 'zzzxq unfindable')).toEqual([]);
  });

  it('tsv is generated (cannot be inserted directly, updates with text)', async () => {
    const hitsBefore = await searchBookPages(db, 'chrome flashpoint');
    expect(hitsBefore).toEqual([]);
    const [core] = await db.select().from(books).where(eq(books.code, 'SR5'));
    await db.insert(bookPages).values({
      bookId: core!.id,
      printedPage: 999,
      text: 'The chrome flashpoint sidebar explains cyberware essence rounding.',
    });
    const hits = await searchBookPages(db, 'chrome flashpoint');
    expect(hits.map((h) => h.printedPage)).toContain(999);
  });
});

describe('codex FTS', () => {
  it('finds wiki pages by content', async () => {
    await db.insert(wikiPages).values({
      campaignId,
      title: 'Brighton Tunnel Deal',
      contentMd: 'The Johnson met the crew under the monorail; payment in certified cred.',
      visibility: 'gm',
    });
    const hits = await searchCodex(db, 'monorail johnson');
    expect(hits.length).toBe(1);
    expect(hits[0]!.title).toBe('Brighton Tunnel Deal');
    expect(hits[0]!.rank).toBeGreaterThan(0);
  });
});

describe('ledger', () => {
  it('appends entries and balances are sums of approved deltas', async () => {
    const [ch] = await db
      .insert(characters)
      .values({ campaignId, ownerUserId: gmId, name: 'Static', sheet: { v: 1 } })
      .returning();
    const characterId = ch!.id;
    await db.insert(ledgerEntries).values([
      { characterId, currency: 'nuyen', delta: 5000, reason: 'run payout', state: 'approved' },
      { characterId, currency: 'nuyen', delta: -1200, reason: 'ammo', state: 'approved' },
      { characterId, currency: 'nuyen', delta: -800, reason: 'pending spend', state: 'pending' },
      { characterId, currency: 'karma', delta: 6, reason: 'session award', state: 'approved' },
      { characterId, currency: 'karma', delta: -20, reason: 'rejected buy', state: 'rejected' },
    ]);
    expect(await ledgerBalance(db, characterId)).toEqual({ karma: 6, nuyen: 3800 });
    expect(await ledgerBalance(db, characterId, { includePending: true })).toEqual({
      karma: 6,
      nuyen: 3000,
    });
  });
});

describe('ws_events', () => {
  it('ids are monotonic per campaign and replay returns the gap in order', async () => {
    const a1 = await appendEvent(db, { campaignId, type: 'scene.activated', payload: { sceneId: 's1' } });
    const b1 = await appendEvent(db, {
      campaignId: otherCampaignId,
      type: 'roll.created',
      payload: { hits: 3 },
      visibility: 'gm',
    });
    const a2 = await appendEvent(db, { campaignId, type: 'token.moved', payload: { x: 1, y: 2 } });
    const a3 = await appendEvent(db, { campaignId, type: 'fog.updated', payload: { ops: [] } });

    expect(a2.id).toBeGreaterThan(a1.id);
    expect(a3.id).toBeGreaterThan(a2.id);
    expect(b1.campaignId).toBe(otherCampaignId);

    expect(await latestEventId(db, campaignId)).toBe(a3.id);
    expect(await nextEventId(db, campaignId)).toBe(a3.id + 1);

    const gap = await eventsSince(db, campaignId, a1.id);
    expect(gap.map((e) => e.id)).toEqual([a2.id, a3.id]);
    expect(gap.map((e) => e.type)).toEqual(['token.moved', 'fog.updated']);
    // Other campaign's events never leak into replay.
    expect(gap.every((e) => e.campaignId === campaignId)).toBe(true);

    const fresh = await eventsSince(db, otherCampaignId, 0);
    expect(fresh.map((e) => e.id)).toEqual([b1.id]);
    expect(fresh[0]!.visibility).toBe('gm');
  });
});

describe('latestEventOfType', () => {
  /**
   * Some state has no table: the GM's table-display steering (FR9.21) lives
   * only as `display.updated` events, so the newest one IS the state and a
   * kiosk that reboots mid-session reads it back through this.
   */
  it('returns the newest event of a type, scoped to its campaign', async () => {
    await appendEvent(db, { campaignId, type: 'display.updated', payload: { blank: false, ribbon: true } });
    const newest = await appendEvent(db, {
      campaignId,
      type: 'display.updated',
      payload: { blank: true, ribbon: false },
    });
    await appendEvent(db, {
      campaignId: otherCampaignId,
      type: 'display.updated',
      payload: { blank: false, ribbon: true },
    });

    const found = await latestEventOfType(db, campaignId, 'display.updated');
    expect(found?.id).toBe(newest.id);
    expect(found?.payload).toEqual({ blank: true, ribbon: false });
    // Another table's screen is none of this campaign's business.
    const other = await latestEventOfType(db, otherCampaignId, 'display.updated');
    expect(other?.payload).toEqual({ blank: false, ribbon: true });
  });

  it('is undefined when the type has never been emitted', async () => {
    expect(await latestEventOfType(db, campaignId, 'os.changed')).toBeUndefined();
  });
});

describe('getDb on a fresh clone', () => {
  /**
   * `data/` is gitignored, so it is absent after a checkout. PGlite opens the
   * directory but will not create the parent — this used to fail inside
   * migrate() with ENOENT on someone's first `pnpm dev:server`.
   */
  it('creates DATA_DIR rather than dying inside migrate()', async () => {
    const dir = join(tmpdir(), `safehouse-fresh-${randomUUID()}`, 'nested');
    const prevData = process.env.DATA_DIR;
    const prevUrl = process.env.DATABASE_URL;
    process.env.DATA_DIR = dir;
    delete process.env.DATABASE_URL;
    resetDbSingleton();
    try {
      expect(existsSync(dir)).toBe(false);
      const fresh = getDb();
      await ensureMigrations(fresh);
      expect(existsSync(dir)).toBe(true);
      await ((fresh as unknown as { $client: PGlite }).$client).close();
    } finally {
      resetDbSingleton();
      if (prevData === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prevData;
      if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
