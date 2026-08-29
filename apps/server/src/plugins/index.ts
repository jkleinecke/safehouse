/**
 * Domain plugin registry (BUILD_CONVENTIONS "Server architecture"): one
 * fastify plugin per domain, all registered here, ONCE, by server-core.
 *
 * Feature agents: fill your own `src/plugins/<domain>.ts` stub ONLY — this
 * file already imports and registers every domain and never needs edits.
 */
import type { FastifyInstance } from 'fastify';
import authPlugin from './auth.js';
import campaignsPlugin from './campaigns.js';
import charactersPlugin from './characters.js';
import rollsPlugin from './rolls.js';
import tablesPlugin from './tables.js';
import scenesPlugin from './scenes.js';
import encountersPlugin from './encounters.js';
import generatorPlugin from './generator.js';
import booksPlugin from './books.js';
import fixerPlugin from './fixer.js';
import ledgerPlugin from './ledger.js';
import sessionsPlugin from './sessions.js';
import codexPlugin from './codex.js';
import contactsPlugin from './contacts.js';

const domainPlugins = [
  authPlugin,
  campaignsPlugin,
  charactersPlugin,
  rollsPlugin,
  tablesPlugin,
  scenesPlugin,
  encountersPlugin,
  generatorPlugin,
  booksPlugin,
  fixerPlugin,
  ledgerPlugin,
  sessionsPlugin,
  codexPlugin,
  contactsPlugin,
] as const;

/** Register every domain plugin (called once from buildApp). */
export async function registerPlugins(app: FastifyInstance): Promise<void> {
  for (const plugin of domainPlugins) {
    await app.register(plugin);
  }
}

export default registerPlugins;
