/**
 * `closeDatabase` — the flush every one-shot process owes the next one
 * (src/shutdown.ts).
 *
 * PGlite is single-writer and embedded: a seeder that exits without closing
 * hands the server an unrecovered directory. `app.close()` will not do it —
 * Fastify has never heard of `db.$client` — so the seeders call this, and
 * these tests pin that the helper really closes, really releases the
 * directory, and never throws on the way out of a process that has already
 * done its job.
 *
 * The cross-process proof that the seeders actually call it lives in
 * `seed-durability.test.ts`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  appendEvent,
  campaigns,
  ensureMigrations,
  getDb,
  resetDbSingleton,
  users,
  type Db,
} from '@safehouse/db';
import {
  closeDatabase,
  installSignalHandlers,
  shutdownServer,
  type ClosableApp,
} from '../src/shutdown.js';
import { main as seedBooksMain } from '../scripts/seed-books.js';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'safehouse-shutdown-'));
  process.env.DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;
  resetDbSingleton();
});

afterAll(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* temp dir; the OS cleans up */
  }
});

async function isClosed(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return false;
  } catch {
    return true;
  }
}

it('closes the handle and releases the directory', async () => {
  const db = getDb();
  await ensureMigrations(db);
  expect(await isClosed(db)).toBe(false);

  await closeDatabase(db);
  expect(await isClosed(db)).toBe(true);

  // Released, not just closed: the next process must be able to open it. (A
  // PGlite directory still held by a live opener does not error on the second
  // opener — it hangs, which is worse.)
  const reopened = getDb();
  expect(reopened).not.toBe(db);
  await ensureMigrations(reopened);
  expect(await isClosed(reopened)).toBe(false);
  await closeDatabase(reopened);
}, 120_000);

it('is safe to call twice', async () => {
  const db = getDb();
  await ensureMigrations(db);
  await closeDatabase(db);
  await expect(closeDatabase(db)).resolves.toBeUndefined();
}, 120_000);

it('seed:books closes the database even when it indexes nothing', async () => {
  const booksDir = mkdtempSync(join(tmpdir(), 'safehouse-books-'));
  // Enough for the "any PDFs here?" check to pass; `--only` filters it out
  // before anything tries to parse it, so we land on the failure return —
  // the path that used to exit with the directory still open.
  writeFileSync(join(booksDir, 'dummy.pdf'), '');
  const seedDir = mkdtempSync(join(tmpdir(), 'safehouse-booksdata-'));

  resetDbSingleton();
  process.env.DATA_DIR = seedDir;
  const db = getDb();

  const argv = process.argv;
  process.argv = [argv[0]!, 'seed-books.ts', '--dir', booksDir, '--only', 'NOPE', '--data-dir', seedDir];
  try {
    await expect(seedBooksMain()).resolves.toBe(1);
  } finally {
    process.argv = argv;
  }
  expect(await isClosed(db)).toBe(true);

  for (const dir of [booksDir, seedDir]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp dirs */
    }
  }
}, 120_000);

// ---------------------------------------------------------------------------
// `shutdownServer` / `installSignalHandlers` — the same courtesy, owed by the
// process that does nearly all the writing.
//
// The seeders were taught to checkpoint before `process.exit`; the server was
// not, so every Ctrl-C left the directory to be WAL-recovered by the next boot.
// Measured against a seeded campaign before this landed: last event id 24,
// server killed, next event id 55 — a 31-value hole, once per restart, for the
// life of the campaign. Nothing is lost (a bigserial only skips forward) but it
// is unbounded, and it is precisely the artefact that keeps being reported as a
// corrupt event log.
// ---------------------------------------------------------------------------

/** A campaign with `count` events, in whatever database `db` points at. */
async function seedEvents(db: Db, count: number): Promise<string> {
  const [user] = await db.insert(users).values({ displayName: 'shutdown gm' }).returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({ name: 'shutdown probe', gmUserId: user!.id })
    .returning();
  for (let i = 0; i < count; i += 1) {
    await appendEvent(db, { campaignId: campaign!.id, type: 'tick', payload: { i } });
  }
  return campaign!.id;
}

interface SeqState {
  maxId: number | null;
  lastValue: number;
}

async function eventSequenceState(db: Db): Promise<SeqState> {
  const result = await db.execute<{ max_id: string | null; last_value: string }>(
    sql`select (select max(id)::text from ws_events) as max_id,
               s.last_value::text as last_value
        from ws_events_id_seq s`,
  );
  const rows = Array.isArray(result)
    ? (result as { max_id: string | null; last_value: string }[])
    : ((result as { rows: { max_id: string | null; last_value: string }[] }).rows ?? []);
  const row = rows[0]!;
  return {
    maxId: row.max_id === null ? null : Number(row.max_id),
    lastValue: Number(row.last_value),
  };
}

const scratchDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows keeps PGlite handles around briefly; it is a temp dir */
    }
  }
});

it('shutdownServer stops HTTP before it touches the database', async () => {
  const order: string[] = [];
  const dir = tempDir('safehouse-shutdown-order-');
  resetDbSingleton();
  process.env.DATA_DIR = dir;
  const db = getDb();
  await ensureMigrations(db);

  const app: ClosableApp = {
    db,
    close: async () => {
      order.push('http');
    },
  };
  await shutdownServer(app);
  order.push((await isClosed(db)) ? 'db' : 'db-still-open');

  // A request still in flight during the checkpoint is the one way to get a
  // half-written event, so the HTTP side goes down first — always.
  expect(order).toEqual(['http', 'db']);
}, 120_000);

it('shutdownServer closes the database even when Fastify fails to close', async () => {
  const dir = tempDir('safehouse-shutdown-throw-');
  resetDbSingleton();
  process.env.DATA_DIR = dir;
  const db = getDb();
  await ensureMigrations(db);
  const logged: unknown[] = [];

  const app: ClosableApp = {
    db,
    close: async () => {
      throw new Error('a socket refused to drain');
    },
    log: { info: () => undefined, error: (obj) => void logged.push(obj) },
  };

  // A stuck listener must not cost the table its checkpoint.
  await expect(shutdownServer(app)).resolves.toBeUndefined();
  expect(await isClosed(db)).toBe(true);
  expect(logged).toHaveLength(1);
}, 120_000);

it('shutdownServer is idempotent — an impatient double Ctrl-C is still one close', async () => {
  const dir = tempDir('safehouse-shutdown-twice-');
  resetDbSingleton();
  process.env.DATA_DIR = dir;
  const db = getDb();
  await ensureMigrations(db);

  let closes = 0;
  const app: ClosableApp = {
    db,
    close: async () => {
      closes += 1;
    },
  };

  const [a, b] = [shutdownServer(app), shutdownServer(app)];
  await Promise.all([a, b]);
  await shutdownServer(app);
  expect(closes).toBe(1);
}, 120_000);

it('a server closed through shutdownServer leaves no sequence gap for the next boot', async () => {
  const dir = tempDir('safehouse-shutdown-seq-');
  resetDbSingleton();
  process.env.DATA_DIR = dir;
  const db = getDb();
  await ensureMigrations(db);
  const campaignId = await seedEvents(db, 21);
  const before = await eventSequenceState(db);
  expect(before.maxId).toBe(21);

  await shutdownServer({ db, close: async () => undefined });

  // Second boot, same directory — the hand-off `pnpm dev:server` makes to its
  // own next run. A dirty exit reopens here with last_value ~33 against 21
  // rows; a checkpointed one reopens exactly level.
  resetDbSingleton();
  process.env.DATA_DIR = dir;
  const reopened = getDb();
  await ensureMigrations(reopened);
  const after = await eventSequenceState(reopened);
  expect(after.maxId).toBe(before.maxId);
  expect(after.lastValue).toBe(after.maxId);

  // And the log simply carries on, with no hole in the replay cursor.
  const next = await appendEvent(reopened, { campaignId, type: 'after-restart', payload: {} });
  expect(next.id).toBe(22);
  await closeDatabase(reopened);
}, 180_000);

it('installSignalHandlers hooks SIGINT and SIGTERM, and unhooks on dispose', async () => {
  const dir = tempDir('safehouse-shutdown-signals-');
  resetDbSingleton();
  process.env.DATA_DIR = dir;
  const db = getDb();
  await ensureMigrations(db);

  const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
  let httpClosed = 0;
  const exits: number[] = [];
  const app: ClosableApp = {
    db,
    close: async () => {
      httpClosed += 1;
    },
    log: { info: () => undefined, error: () => undefined },
  };

  const dispose = installSignalHandlers(app, { exit: (code) => void exits.push(code) });
  expect(process.listenerCount('SIGINT')).toBe(before.int + 1);
  expect(process.listenerCount('SIGTERM')).toBe(before.term + 1);

  // Invoke the listener directly rather than emitting the signal: emitting
  // would also fire vitest's own handler and take the runner down with it.
  const handler = process.listeners('SIGINT').at(-1) as (s: NodeJS.Signals) => void;
  handler('SIGINT');
  await shutdownServer(app);
  // The handler's own `.then(exit)` is a queued continuation of that same
  // promise; give it a turn before asserting on the exit code.
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(httpClosed).toBe(1);
  expect(await isClosed(db)).toBe(true);
  expect(exits).toEqual([0]);

  dispose();
  expect(process.listenerCount('SIGINT')).toBe(before.int);
  expect(process.listenerCount('SIGTERM')).toBe(before.term);
}, 120_000);
