/**
 * Migration 0018: a chat's owner. On upgrade an existing chat goes to its
 * campaign's owner of record when that user is the campaign's only GM
 * member; otherwise it stays unowned.
 *
 * Every name is invented (§14).
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { createPgliteDb, ensureMigrations, migrationsFolder } from '../src/index.js';

const scratch: string[] = [];
let client: PGlite | undefined;

afterAll(async () => {
  await client?.close();
  for (const dir of scratch) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows handle stragglers — temp dir, the OS cleans up */
    }
  }
});

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

describe('migration 0018: ai_conversations.owner_user_id', () => {
  it("gives a chat to its campaign's lone GM, and leaves it unowned otherwise", async () => {
    client = new PGlite();
    const db = createPgliteDb(client);
    await migratePglite(db, { migrationsFolder: migrationsUpTo(17) });

    const user = async (name: string) =>
      (await client!.query<{ id: string }>(`insert into users (display_name) values ($1) returning id`, [name])).rows[0]!.id;
    const campaign = async (name: string, gm: string) =>
      (await client!.query<{ id: string }>(`insert into campaigns (name, gm_user_id) values ($1, $2) returning id`, [name, gm])).rows[0]!.id;
    const member = (campaignId: string, userId: string, role: string) =>
      client!.query(`insert into memberships (campaign_id, user_id, role) values ($1, $2, $3)`, [campaignId, userId, role]);
    const chat = async (campaignId: string) =>
      (await client!.query<{ id: string }>(`insert into ai_conversations (campaign_id, kind) values ($1, 'fixer') returning id`, [campaignId])).rows[0]!.id;

    const marrow = await user('Marrow');
    const sable = await user('Sable');
    const wick = await user('Wick');

    const lone = await campaign('Low Tide', marrow);
    await member(lone, marrow, 'gm');
    await member(lone, wick, 'player');
    const loneChat = await chat(lone);

    const shared = await campaign('Dry Dock', sable);
    await member(shared, sable, 'gm');
    await member(shared, marrow, 'gm');
    const sharedChat = await chat(shared);

    await ensureMigrations(db);

    const owners = await client.query<{ id: string; owner_user_id: string | null }>(`select id, owner_user_id from ai_conversations`);
    const ownerOf = (id: string) => owners.rows.find((r) => r.id === id)?.owner_user_id;
    expect(ownerOf(loneChat)).toBe(marrow);
    expect(ownerOf(sharedChat)).toBeNull();
  }, 180_000);
});
