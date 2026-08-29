/**
 * Client factory + programmatic migrations.
 *
 * `getDb()` — PGlite at `DATA_DIR/pglite` by default; node-postgres when
 * `DATABASE_URL` is set (BUILD_CONVENTIONS "Ports, env, database").
 * `ensureMigrations(db)` — applies `packages/db/migrations` via drizzle
 * `migrate()`, dispatching on the underlying driver.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';
import { ensureSequences, type SequenceRepair } from './sequences.js';
import { wrapDbError } from './errors.js';

/**
 * The Drizzle database handle used across Safehouse. Statically typed as the
 * PGlite flavor (the query API is identical for both drivers); at runtime it
 * may be backed by node-postgres — `ensureMigrations` dispatches on `$client`.
 */
export type Db = PgliteDatabase<typeof schema>;

let singleton: Db | undefined;

/** Directory shipped with the package: `packages/db/migrations`. */
export function migrationsFolder(): string {
  return fileURLToPath(new URL('../migrations', import.meta.url));
}

/** Build a Db from an existing PGlite instance (tests, custom wiring). */
export function createPgliteDb(client: PGlite): Db {
  return drizzlePglite(client, { schema });
}

/** Build a Db from a node-postgres pool/connection string. */
export function createNodePgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString });
  return drizzleNodePg(pool, { schema }) as unknown as Db;
}

/**
 * Process-wide database handle. PGlite at `DATA_DIR/pglite` (default
 * `./data/pglite`), or node-postgres when `DATABASE_URL` is set.
 */
export function getDb(): Db {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL;
  if (url && url.length > 0) {
    singleton = createNodePgDb(url);
  } else {
    const dataDir = (process.env.DATA_DIR ?? './data').replace(/[\\/]+$/, '');
    // PGlite opens the directory but will not create the parent, so on a fresh
    // clone — where `data/` is gitignored and therefore absent — the first
    // `pnpm dev:server` or `pnpm seed:demo` died inside migrate() with ENOENT.
    // One mkdir here is the difference between "checkout, run, play" and a
    // stack trace on someone's first evening with the app.
    try {
      mkdirSync(dataDir, { recursive: true });
    } catch {
      // A read-only or already-present path is PGlite's problem to report,
      // with a better message than anything this catch could add.
    }
    singleton = createPgliteDb(new PGlite(`${dataDir}/pglite`));
  }
  return singleton;
}

/** Drop the cached `getDb()` handle (tests). Does not close the client. */
export function resetDbSingleton(): void {
  singleton = undefined;
}

/**
 * Apply all checked-in migrations (idempotent; drizzle tracks applied
 * migrations in `drizzle.__drizzle_migrations`). Call on server start and in
 * tests against a throwaway PGlite.
 *
 * Finishes by reconciling sequences with their tables (`ensureSequences`). That
 * step is a no-op on a healthy database, and the difference between "this
 * restored copy works" and "every event append fails forever" on one that is
 * not — see `migrations/0001_sequence_guard.sql`. Returns the repairs it made
 * so a caller can log them; an empty array is the normal result.
 */
export async function ensureMigrations(db: Db): Promise<SequenceRepair[]> {
  const folder = migrationsFolder();
  const client = (db as { $client?: unknown }).$client;
  if (client instanceof PGlite) {
    await migratePglite(db, { migrationsFolder: folder });
  } else {
    await migrateNodePg(db as unknown as NodePgDatabase<typeof schema>, {
      migrationsFolder: folder,
    });
  }
  return ensureSequences(db);
}

/**
 * Flush and close the database, and forget the `getDb()` singleton.
 *
 * Call this before a writer process exits. Nothing in Safehouse used to: the
 * demo seeder runs `app.close()` (which closes Fastify, not PGlite) and then
 * `process.exit(0)`, leaving the data directory in a crash-consistent rather
 * than clean state. Committed rows survive that — PostgreSQL's WAL is doing its
 * job — but the next process to open the directory runs crash recovery, and
 * recovery restores each sequence from its WAL-logged lookahead, which sits 32
 * values beyond the last row that was actually written. Measured on a
 * seeded campaign: an unclean exit after 21 events reopens with the sequence at
 * 33, so the next event is id 34 and ids 22-33 never exist. Harmless for
 * replay, which only needs ids to increase, but it is a gap that appears out of
 * nowhere on every restart, and it is the observation that has repeatedly been
 * mistaken for sequence corruption. `CHECKPOINT` before close removes it: the
 * same run closed cleanly reopens at 21 and continues 22, 23, 24.
 *
 * Safe to call more than once, and safe to call when nothing was ever opened.
 */
export async function closeDb(db: Db | undefined = singleton): Promise<void> {
  if (!db) return;
  const wasSingleton = db === singleton;
  try {
    const client = (db as { $client?: unknown }).$client;
    if (client instanceof PGlite) {
      if (!client.closed) {
        // Fold the WAL into the data files so the next open is a clean start.
        await db.execute(sql`checkpoint`);
        await client.close();
      }
    } else {
      const end = (client as { end?: unknown } | undefined)?.end;
      if (typeof end === 'function') await (end as () => Promise<void>).call(client);
    }
  } catch (err) {
    throw wrapDbError('closeDb', err);
  } finally {
    if (wasSingleton) singleton = undefined;
  }
}
