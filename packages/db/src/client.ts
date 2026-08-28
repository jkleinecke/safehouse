/**
 * Client factory + programmatic migrations.
 *
 * `getDb()` — PGlite at `DATA_DIR/pglite` by default; node-postgres when
 * `DATABASE_URL` is set (BUILD_CONVENTIONS "Ports, env, database").
 * `ensureMigrations(db)` — applies `packages/db/migrations` via drizzle
 * `migrate()`, dispatching on the underlying driver.
 */
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

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
    const dataDir = process.env.DATA_DIR ?? './data';
    singleton = createPgliteDb(new PGlite(`${dataDir.replace(/[\\/]+$/, '')}/pglite`));
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
 */
export async function ensureMigrations(db: Db): Promise<void> {
  const folder = migrationsFolder();
  const client = (db as { $client?: unknown }).$client;
  if (client instanceof PGlite) {
    await migratePglite(db, { migrationsFolder: folder });
  } else {
    await migrateNodePg(db as unknown as NodePgDatabase<typeof schema>, {
      migrationsFolder: folder,
    });
  }
}
