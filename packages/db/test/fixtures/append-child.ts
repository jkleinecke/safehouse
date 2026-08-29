/**
 * A writer process, for the cross-process durability tests.
 *
 * This exists because every other suite in the repo seeds and reads in the SAME
 * process, against either an in-memory PGlite or a throwaway temp directory. A
 * durable directory written by one process and reopened by another — which is
 * exactly what `pnpm seed:demo` followed by `pnpm dev:server` does — was never
 * exercised, so nothing could catch a fault that only appears on reopen.
 *
 * Usage: node --import tsx append-child.ts <pgliteDir> <count> <clean|dirty>
 *
 * `dirty` mimics the demo seeder as it stands: exit without closing PGlite, so
 * the next open runs crash recovery. `clean` goes through `closeDb`.
 * Prints one JSON line on stdout; everything else goes to stderr.
 */
import { PGlite } from '@electric-sql/pglite';
import { appendEvent, campaigns, closeDb, createPgliteDb, ensureMigrations, users } from '../../src/index.js';

const dir = process.argv[2];
const count = Number(process.argv[3] ?? '5');
const mode = process.argv[4] ?? 'dirty';
if (!dir) throw new Error('append-child: missing pglite dir argument');

const client = new PGlite(dir);
const db = createPgliteDb(client);
await ensureMigrations(db);

const [user] = await db
  .insert(users)
  .values({ displayName: 'Cross-process GM', email: `gm-${process.pid}-${Date.now()}@example.test` })
  .returning();
const [campaign] = await db
  .insert(campaigns)
  .values({ name: 'Cross-process campaign', gmUserId: user!.id })
  .returning();

const ids: number[] = [];
for (let i = 0; i < count; i += 1) {
  const row = await appendEvent(db, {
    campaignId: campaign!.id,
    type: 'probe.seeded',
    payload: { i },
  });
  ids.push(row.id);
}

if (mode === 'clean') await closeDb(db);

process.stdout.write(
  `${JSON.stringify({ campaignId: campaign!.id, ids, maxId: Math.max(...ids), mode })}\n`,
);
// Deliberately abrupt, like the seeder: nothing below this line gets to run.
process.exit(0);
