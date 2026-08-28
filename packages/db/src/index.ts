/**
 * @safehouse/db — Drizzle schema, migrations, db client, FTS helpers
 * (DESIGN.md §9.2; BUILD_CONVENTIONS "Ports, env, database").
 */
export * as schema from './schema.js';
export * from './schema.js';
export {
  getDb,
  ensureMigrations,
  createPgliteDb,
  createNodePgDb,
  migrationsFolder,
  resetDbSingleton,
  type Db,
} from './client.js';
export {
  searchBookPages,
  searchCodex,
  type BookPageHit,
  type CodexHit,
  type SearchBookPagesOpts,
} from './fts.js';
export {
  appendEvent,
  latestEventId,
  nextEventId,
  eventsSince,
  pruneEventsBefore,
  recentEvents,
  type AppendEventInput,
  type WsEventRow,
} from './events.js';
export { ledgerBalance, type LedgerBalance } from './ledger.js';
