/**
 * Migration 0007 (FR3.7, docs/CHARGEN.md §8.5 "Advancement"): the ledger
 * entry's `payload`, the change an approved Karma spend applies to a sheet.
 *
 * Pinned the same two ways as 0006 (`builds.test.ts`): the shape — a
 * nullable jsonb that an ordinary entry leaves null and an advance fills —
 * and the upgrade, because drizzle silently skips a journal entry whose
 * `when` is not newer than the last one applied: a database migrated through
 * 0006, holding a real entry, must come out with the column and that entry
 * untouched.
 *
 * Every name is invented (§14).
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  campaigns,
  characters,
  closeDb,
  createPgliteDb,
  ensureMigrations,
  ledgerEntries,
  migrationsFolder,
  users,
  type Db,
} from '../src/index.js';

let client: PGlite;
let db: Db;
let characterId: string;
const scratch: string[] = [];
const openClients: PGlite[] = [];

beforeAll(async () => {
  client = new PGlite();
  db = createPgliteDb(client);
  await ensureMigrations(db);
  const gm = (await db.insert(users).values({ displayName: 'Marrow' }).returning())[0]!;
  const table = (await db.insert(campaigns).values({ name: 'Low Tide', gmUserId: gm.id }).returning())[0]!;
  characterId = (await db.insert(characters).values({ campaignId: table.id, name: 'Wick', sheet: {} }).returning())[0]!.id;
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

describe('migration 0007: ledger payload', () => {
  it('adds a nullable jsonb column', async () => {
    const res = await client.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'ledger_entries' and column_name = 'payload'`,
    );
    expect(res.rows[0]).toEqual({ data_type: 'jsonb', is_nullable: 'YES' });
  });

  it('leaves an ordinary entry null and keeps an advance whole', async () => {
    const plain = (await db.insert(ledgerEntries).values({ characterId, currency: 'karma', delta: 5, reason: 'Run pay' }).returning())[0]!;
    expect(plain.payload).toBeNull();
    const advance = { kind: 'advance', spend: { kind: 'attribute', id: 'agi', from: 4, to: 5 }, cost: 25, label: 'Raise Agility 4 → 5' };
    const row = (
      await db.insert(ledgerEntries).values({ characterId, currency: 'karma', delta: -25, reason: 'Raise Agility 4 → 5 · 25 Karma', payload: advance }).returning()
    )[0]!;
    const read = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, row.id));
    expect(read[0]?.payload).toEqual(advance);
  });
});

describe('upgrading a database migrated through 0006', () => {
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

  it('adds the column and keeps an existing entry as it was', async () => {
    const root = mkdtempSync(join(tmpdir(), 'safehouse-db-'));
    scratch.push(root);
    const dir = join(root, 'pglite');
    mkdirSync(dir, { recursive: true });

    const oldClient = new PGlite(dir);
    openClients.push(oldClient);
    const oldDb = createPgliteDb(oldClient);
    await migratePglite(oldDb, { migrationsFolder: migrationsUpTo(6) });
    const gm = await oldClient.query<{ id: string }>(`insert into users (display_name) values ('Sable') returning id`);
    const camp = await oldClient.query<{ id: string }>(`insert into campaigns (name, gm_user_id) values ('Dry Dock', $1) returning id`, [
      gm.rows[0]!.id,
    ]);
    const chr = await oldClient.query<{ id: string }>(`insert into characters (campaign_id, name, sheet) values ($1, 'Rust', '{}'::jsonb) returning id`, [
      camp.rows[0]!.id,
    ]);
    await oldClient.query(`insert into ledger_entries (character_id, currency, delta, reason, state) values ($1, 'karma', 7, 'Carried', 'approved')`, [
      chr.rows[0]!.id,
    ]);
    await closeDb(oldDb);

    const nextClient = new PGlite(dir);
    openClients.push(nextClient);
    const nextDb = createPgliteDb(nextClient);
    await ensureMigrations(nextDb);
    const rows = await nextDb.select().from(ledgerEntries).where(eq(ledgerEntries.characterId, chr.rows[0]!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: 7, reason: 'Carried', state: 'approved', payload: null });
    await closeDb(nextDb);
  }, 180_000);
});
