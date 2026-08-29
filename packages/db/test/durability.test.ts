/**
 * Durability of the event log across process boundaries (§11).
 *
 * The gap these close: a campaign seeded by `pnpm seed:demo` (one process,
 * which exits) and then served by `pnpm dev:server` (another process, which
 * reopens the same PGlite directory) must be able to append events forever.
 * Every pre-existing suite seeds and reads inside a single process, so the
 * reopen path — the one real deployments always take — had no coverage at all.
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  campaigns,
  closeDb,
  createPgliteDb,
  DbError,
  ensureMigrations,
  ensureSequences,
  eventsSince,
  latestEventId,
  migrationsFolder,
  users,
  type Db,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = join(here, '..');
const childScript = join(here, 'fixtures', 'append-child.ts');

/** Temp dirs created by a test, torn down afterwards. */
const scratch: string[] = [];
/** PGlite handles a test opened, closed afterwards even if it failed. */
const openClients: PGlite[] = [];

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'safehouse-db-'));
  scratch.push(dir);
  // PGlite opens its directory but will not create the parent.
  mkdirSync(join(dir, 'pglite'), { recursive: true });
  return join(dir, 'pglite');
}

async function open(dir: string): Promise<{ client: PGlite; db: Db }> {
  const client = new PGlite(dir);
  openClients.push(client);
  const db = createPgliteDb(client);
  await ensureMigrations(db);
  return { client, db };
}

interface ChildResult {
  campaignId: string;
  ids: number[];
  maxId: number;
  mode: string;
}

/** Run the writer fixture in a real child process and read back its report. */
function runWriter(dir: string, count: number, mode: 'clean' | 'dirty'): ChildResult {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', childScript, dir, String(count), mode],
    { cwd: packageDir, encoding: 'utf8', timeout: 120_000 },
  );
  if (result.status !== 0) {
    throw new Error(
      `writer child failed (status ${String(result.status)}): ${result.stderr || result.stdout}`,
    );
  }
  const line = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!line) throw new Error(`writer child produced no output: ${result.stderr}`);
  return JSON.parse(line) as ChildResult;
}

async function seedCampaign(db: Db): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ displayName: 'GM', email: `gm-${randomUUID()}@example.test` })
    .returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({ name: 'Durability', gmUserId: user!.id })
    .returning();
  return campaign!.id;
}

async function sequenceState(client: PGlite): Promise<{ lastValue: number; isCalled: boolean }> {
  const res = await client.query<{ last_value: string | number; is_called: boolean }>(
    'select last_value, is_called from public.ws_events_id_seq',
  );
  const row = res.rows[0]!;
  return { lastValue: Number(row.last_value), isCalled: row.is_called };
}

afterEach(async () => {
  for (const client of openClients.splice(0)) {
    if (!client.closed) await client.close();
  }
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('cross-process append (seed in one process, serve in another)', () => {
  it('keeps appending with strictly greater ids after a writer exits uncleanly', async () => {
    const dir = tempDataDir();
    const seeded = runWriter(dir, 6, 'dirty');
    expect(seeded.ids).toHaveLength(6);

    // A second process reopening the directory the seeder left behind.
    const { db } = await open(dir);

    // Everything the seeder wrote is still readable.
    const persisted = await eventsSince(db, seeded.campaignId, 0);
    expect(persisted.map((e) => e.id)).toEqual(seeded.ids);

    // And the log is not frozen: appends continue, monotonically.
    const first = await appendEvent(db, {
      campaignId: seeded.campaignId,
      type: 'roll.created',
      payload: { pool: 6 },
    });
    expect(first.id).toBeGreaterThan(seeded.maxId);

    const second = await appendEvent(db, {
      campaignId: seeded.campaignId,
      type: 'roll.created',
      payload: { pool: 7 },
    });
    expect(second.id).toBeGreaterThan(first.id);

    // The new events are visible to a §11 replay from the seeder's high-water mark.
    const replayed = await eventsSince(db, seeded.campaignId, seeded.maxId);
    expect(replayed.map((e) => e.id)).toEqual([first.id, second.id]);
    expect(await latestEventId(db, seeded.campaignId)).toBe(second.id);
  }, 180_000);

  it('leaves no id gap when the writer closes through closeDb', async () => {
    const dir = tempDataDir();
    const seeded = runWriter(dir, 4, 'clean');

    const { db } = await open(dir);
    const next = await appendEvent(db, {
      campaignId: seeded.campaignId,
      type: 'log.appended',
      payload: {},
    });
    // A CHECKPOINT before close persists the sequence exactly, so the reopened
    // database resumes at the next id instead of skipping PostgreSQL's
    // WAL-logged lookahead.
    expect(next.id).toBe(seeded.maxId + 1);
  }, 180_000);
});

describe('closeDb', () => {
  it('reopens the same directory and appends a strictly greater id', async () => {
    const dir = tempDataDir();
    const first = await open(dir);
    const campaignId = await seedCampaign(first.db);
    const a = await appendEvent(first.db, { campaignId, type: 'a', payload: {} });
    const b = await appendEvent(first.db, { campaignId, type: 'b', payload: {} });
    await closeDb(first.db);
    expect(first.client.closed).toBe(true);

    const second = await open(dir);
    const c = await appendEvent(second.db, { campaignId, type: 'c', payload: {} });
    expect(c.id).toBeGreaterThan(b.id);
    expect(b.id).toBeGreaterThan(a.id);
    expect(await latestEventId(second.db, campaignId)).toBe(c.id);
  }, 180_000);

  it('is safe to call twice and safe with nothing open', async () => {
    const dir = tempDataDir();
    const { db } = await open(dir);
    await closeDb(db);
    await expect(closeDb(db)).resolves.toBeUndefined();
    await expect(closeDb(undefined)).resolves.toBeUndefined();
  }, 180_000);
});

describe('ensureSequences (forward-only repair)', () => {
  it('does nothing to a healthy database', async () => {
    const { client, db } = await open(tempDataDir());
    const campaignId = await seedCampaign(db);
    for (let i = 0; i < 4; i += 1) {
      await appendEvent(db, { campaignId, type: 'tick', payload: { i } });
    }
    const before = await sequenceState(client);
    expect(await ensureSequences(db)).toEqual([]);
    expect(await sequenceState(client)).toEqual(before);
  }, 180_000);

  it('moves a lagging sequence up to the rows and restores appends', async () => {
    const { client, db } = await open(tempDataDir());
    const campaignId = await seedCampaign(db);
    for (let i = 0; i < 5; i += 1) {
      await appendEvent(db, { campaignId, type: 'tick', payload: { i } });
    }
    const maxId = await latestEventId(db, campaignId);

    // The state a restore leaves behind: rows intact, sequence back at the start.
    await client.query("select setval('public.ws_events_id_seq', 1, true)");
    await expect(
      appendEvent(db, { campaignId, type: 'broken', payload: {} }),
    ).rejects.toMatchObject({ code: '23505' });

    const repairs = await ensureSequences(db);
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toMatchObject({
      sequence: 'public.ws_events_id_seq',
      table: 'ws_events',
      column: 'id',
      newValue: maxId,
    });
    expect(repairs[0]!.newValue).toBeGreaterThan(repairs[0]!.previousValue);

    const recovered = await appendEvent(db, { campaignId, type: 'fixed', payload: {} });
    expect(recovered.id).toBe(maxId + 1);
    // Idempotent: a second pass finds nothing left to do.
    expect(await ensureSequences(db)).toEqual([]);
  }, 180_000);

  it('never pulls a sequence backwards, even far ahead of the rows', async () => {
    const { client, db } = await open(tempDataDir());
    const campaignId = await seedCampaign(db);
    for (let i = 0; i < 3; i += 1) {
      await appendEvent(db, { campaignId, type: 'tick', payload: { i } });
    }
    // Crash recovery legitimately leaves the sequence ahead of the rows
    // (PostgreSQL WAL-logs sequence advances 32 values in front). Pulling it
    // back would re-issue ids clients already hold as `last_event_id`.
    await client.query("select setval('public.ws_events_id_seq', 1000, true)");

    expect(await ensureSequences(db)).toEqual([]);
    expect((await sequenceState(client)).lastValue).toBe(1000);

    const next = await appendEvent(db, { campaignId, type: 'after', payload: {} });
    expect(next.id).toBe(1001);
  }, 180_000);

  it('runs as part of ensureMigrations on every open', async () => {
    const dir = tempDataDir();
    const first = await open(dir);
    const campaignId = await seedCampaign(first.db);
    for (let i = 0; i < 5; i += 1) {
      await appendEvent(first.db, { campaignId, type: 'tick', payload: { i } });
    }
    const maxId = await latestEventId(first.db, campaignId);
    await first.client.query("select setval('public.ws_events_id_seq', 1, true)");
    await closeDb(first.db);

    // Reopening is enough to heal it — no operator step, no manual SQL.
    const second = await open(dir);
    const row = await appendEvent(second.db, { campaignId, type: 'healed', payload: {} });
    expect(row.id).toBe(maxId + 1);
  }, 180_000);
});

describe('upgrading a database that predates the sequence guard', () => {
  /**
   * Copy the real migrations folder, keeping only the entries up to `throughIdx`
   * — the state of a database created before this fix existed.
   */
  function migrationsUpTo(throughIdx: number): string {
    const dir = mkdtempSync(join(tmpdir(), 'safehouse-migrations-'));
    scratch.push(dir);
    cpSync(migrationsFolder(), dir, { recursive: true });
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((e) => e.idx <= throughIdx);
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));
    return dir;
  }

  it('applies the guard on first open and heals a sequence broken beforehand', async () => {
    const dir = tempDataDir();

    // A database built by the old code: schema only, no guard function.
    const oldClient = new PGlite(dir);
    openClients.push(oldClient);
    const oldDb = createPgliteDb(oldClient);
    await migratePglite(oldDb, { migrationsFolder: migrationsUpTo(0) });
    const campaignId = await seedCampaign(oldDb);
    for (let i = 0; i < 5; i += 1) {
      await appendEvent(oldDb, { campaignId, type: 'legacy', payload: { i } });
    }
    const maxId = await latestEventId(oldDb, campaignId);
    await expect(
      oldClient.query('select * from safehouse_resync_sequences()'),
    ).rejects.toBeDefined();
    // Leave it in the broken state a restore produces.
    await oldClient.query("select setval('public.ws_events_id_seq', 1, true)");
    await closeDb(oldDb);

    // The upgraded server opening that same directory.
    const { db } = await open(dir);
    const healed = await appendEvent(db, { campaignId, type: 'after.upgrade', payload: {} });
    expect(healed.id).toBe(maxId + 1);
    const all = await eventsSince(db, campaignId, 0);
    expect(all).toHaveLength(6);
  }, 180_000);
});

describe('appendEvent error surfacing', () => {
  it('carries the real SQLSTATE and constraint for a unique violation', async () => {
    const { client, db } = await open(tempDataDir());
    const campaignId = await seedCampaign(db);
    await appendEvent(db, { campaignId, type: 'tick', payload: {} });
    await appendEvent(db, { campaignId, type: 'tick', payload: {} });
    await client.query("select setval('public.ws_events_id_seq', 1, true)");

    const err = await appendEvent(db, { campaignId, type: 'tick', payload: {} }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(DbError);
    const dbErr = err as DbError;
    expect(dbErr.code).toBe('23505');
    expect(dbErr.constraint).toBe('ws_events_pkey');
    expect(dbErr.detail).toContain('already exists');
    expect(dbErr.operation).toBe('appendEvent');
    expect(dbErr.context).toMatchObject({ campaignId, type: 'tick' });
    // The message names the fault instead of dumping the statement.
    expect(dbErr.message).toContain('duplicate key value violates unique constraint');
    expect(dbErr.message).not.toMatch(/^Failed query:/);
    // drizzle's original is still reachable for a full stack.
    expect(dbErr.cause).toBeDefined();
  }, 180_000);

  it('carries the real SQLSTATE and constraint for a foreign-key violation', async () => {
    const { db } = await open(tempDataDir());

    const err = await appendEvent(db, {
      campaignId: '00000000-0000-0000-0000-000000000000',
      type: 'roll.created',
      payload: {},
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(DbError);
    const dbErr = err as DbError;
    expect(dbErr.code).toBe('23503');
    expect(dbErr.constraint).toBe('ws_events_campaign_id_campaigns_id_fk');
    expect(dbErr.message).toContain('violates foreign key constraint');
  }, 180_000);

  it('does not half-succeed: a rejected append stores nothing', async () => {
    const { client, db } = await open(tempDataDir());
    const campaignId = await seedCampaign(db);
    await appendEvent(db, { campaignId, type: 'tick', payload: {} });
    await appendEvent(db, { campaignId, type: 'tick', payload: {} });
    const before = await eventsSince(db, campaignId, 0);

    await client.query("select setval('public.ws_events_id_seq', 1, true)");
    await expect(appendEvent(db, { campaignId, type: 'lost', payload: {} })).rejects.toBeInstanceOf(
      DbError,
    );

    const after = await eventsSince(db, campaignId, 0);
    expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id));
    expect(after.some((e) => e.type === 'lost')).toBe(false);
  }, 180_000);
});
