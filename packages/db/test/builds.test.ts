/**
 * Migration 0006 (FR3.9, docs/CHARGEN.md §8.5): the `builds` table and
 * `characters.build`.
 *
 * Two ways the migration can be wrong without any server test noticing, so
 * both are pinned here. First, the shape: the GM-owned fields are columns and
 * not keys of the JSON, the foreign keys do what the schema file says (a
 * campaign takes its drafts with it; a retired runner leaves its build behind
 * with `character_id` cleared), and the index the build list reads exists.
 * Second, the upgrade: drizzle skips any journal entry whose `when` is not
 * newer than the last applied one, silently — so a database migrated through
 * 0005, holding a real character, is opened by the new code and must come
 * out with the table and a null `build` on the old row.
 *
 * Every name is invented (§14).
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  builds,
  campaigns,
  characters,
  closeDb,
  createPgliteDb,
  ensureMigrations,
  migrationsFolder,
  users,
  type Db,
} from '../src/index.js';

let client: PGlite;
let db: Db;
let campaignId: string;
let userId: string;

const scratch: string[] = [];
const openClients: PGlite[] = [];

beforeAll(async () => {
  client = new PGlite(); // in-memory throwaway
  db = createPgliteDb(client);
  await ensureMigrations(db);
  const person = await db.insert(users).values({ displayName: 'Rook' }).returning();
  userId = person[0]!.id;
  const table = await db.insert(campaigns).values({ name: 'Wet Neon', gmUserId: userId }).returning();
  campaignId = table[0]!.id;
});

afterAll(async () => {
  await client.close();
  for (const c of openClients) {
    try {
      await c.close();
    } catch {
      /* already closed */
    }
  }
  for (const dir of scratch) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows handle stragglers — temp dir, the OS cleans up */
    }
  }
});

async function columns(table: string): Promise<Map<string, { type: string; nullable: boolean; dflt: string | null }>> {
  const res = await client.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    `select column_name, data_type, is_nullable, column_default
       from information_schema.columns where table_schema = 'public' and table_name = $1`,
    [table],
  );
  return new Map(
    res.rows.map((r) => [r.column_name, { type: r.data_type, nullable: r.is_nullable === 'YES', dflt: r.column_default }]),
  );
}

describe('migration 0006: builds', () => {
  it('creates the table with the GM-owned fields as columns', async () => {
    const cols = await columns('builds');
    expect([...cols.keys()].sort()).toEqual(
      [
        'approvals',
        'build',
        'campaign_id',
        'character_id',
        'created_at',
        'id',
        'notes',
        'owner_user_id',
        'returned_step',
        'state',
        'updated_at',
      ].sort(),
    );
    expect(cols.get('build')).toMatchObject({ type: 'jsonb', nullable: false });
    expect(cols.get('owner_user_id')).toMatchObject({ type: 'uuid', nullable: false });
    expect(cols.get('state')?.dflt).toContain('draft');
    expect(cols.get('approvals')?.dflt).toContain('{}');
    expect(cols.get('returned_step')).toMatchObject({ type: 'integer', nullable: true });
    expect(cols.get('character_id')).toMatchObject({ type: 'uuid', nullable: true });

    const chars = await columns('characters');
    expect(chars.get('build')).toMatchObject({ type: 'jsonb', nullable: true });
  });

  it('indexes the build list on (campaign, owner)', async () => {
    const res = await client.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'builds' and indexname = 'builds_campaign_owner_idx'`,
    );
    expect(res.rows[0]?.indexdef).toMatch(/\(campaign_id, owner_user_id\)/);
  });

  it('defaults a new draft and keeps approvals out of the JSON', async () => {
    const row = (
      await db.insert(builds).values({ campaignId, ownerUserId: userId, build: { v: 1 } }).returning()
    )[0]!;
    expect(row.state).toBe('draft');
    expect(row.approvals).toEqual({});
    expect(row.notes).toBeNull();
    expect(row.returnedStep).toBeNull();
    expect(row.characterId).toBeNull();
    expect(row.build).toEqual({ v: 1 });
  });

  it('clears character_id when the character goes, and goes with the campaign', async () => {
    const other = (await db.insert(campaigns).values({ name: 'Short Fuse', gmUserId: userId }).returning())[0]!;
    const runner = (
      await db
        .insert(characters)
        .values({ campaignId: other.id, ownerUserId: userId, name: 'Ember Tick', sheet: {}, build: { v: 1 } })
        .returning()
    )[0]!;
    expect(runner.build).toEqual({ v: 1 });
    const draft = (
      await db
        .insert(builds)
        .values({ campaignId: other.id, ownerUserId: userId, build: { v: 1 }, state: 'approved', characterId: runner.id })
        .returning()
    )[0]!;

    await db.delete(characters).where(eq(characters.id, runner.id));
    const kept = await db.select().from(builds).where(eq(builds.id, draft.id));
    expect(kept[0]?.characterId).toBeNull();
    expect(kept[0]?.state).toBe('approved');

    await db.delete(campaigns).where(eq(campaigns.id, other.id));
    expect(await db.select().from(builds).where(eq(builds.id, draft.id))).toHaveLength(0);
  });

  it('re-applies as a no-op', async () => {
    await ensureMigrations(db);
    const n = await db.select({ n: sql<number>`count(*)::int` }).from(builds);
    expect(n[0]!.n).toBeGreaterThanOrEqual(1);
  });
});

describe('upgrading a database migrated through 0005', () => {
  function migrationsUpTo(throughIdx: number): string {
    const dir = mkdtempSync(join(tmpdir(), 'safehouse-migrations-'));
    scratch.push(dir);
    cpSync(migrationsFolder(), dir, { recursive: true });
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
    journal.entries = journal.entries.filter((e) => e.idx <= throughIdx);
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));
    return dir;
  }

  it('adds the table and a null build to an existing character on first open', async () => {
    const root = mkdtempSync(join(tmpdir(), 'safehouse-db-'));
    scratch.push(root);
    const dir = join(root, 'pglite');
    mkdirSync(dir, { recursive: true });

    // The database as the previous release left it.
    const oldClient = new PGlite(dir);
    openClients.push(oldClient);
    const oldDb = createPgliteDb(oldClient);
    await migratePglite(oldDb, { migrationsFolder: migrationsUpTo(5) });
    const before = await oldClient.query(`select to_regclass('public.builds') as t`);
    expect((before.rows[0] as { t: string | null }).t).toBeNull();
    const gm = await oldClient.query<{ id: string }>(`insert into users (display_name) values ('Vane') returning id`);
    const camp = await oldClient.query<{ id: string }>(
      `insert into campaigns (name, gm_user_id) values ('Old Rain', $1) returning id`,
      [gm.rows[0]!.id],
    );
    await oldClient.query(`insert into characters (campaign_id, name, sheet) values ($1, 'Soot', '{}'::jsonb)`, [
      camp.rows[0]!.id,
    ]);
    await closeDb(oldDb);

    // The new code opening the same directory.
    const nextClient = new PGlite(dir);
    openClients.push(nextClient);
    const nextDb = createPgliteDb(nextClient);
    await ensureMigrations(nextDb);
    const soot = await nextDb.select().from(characters).where(eq(characters.name, 'Soot'));
    expect(soot).toHaveLength(1);
    expect(soot[0]!.build).toBeNull();
    const inserted = await nextDb
      .insert(builds)
      .values({ campaignId: camp.rows[0]!.id, ownerUserId: gm.rows[0]!.id, build: { v: 1 } })
      .returning();
    expect(inserted[0]!.state).toBe('draft');
    await closeDb(nextDb);
  }, 180_000);
});
