/**
 * @safehouse/server entry point — boots the app built by src/app.ts.
 *
 * Env (all optional — the app must boot with none set, Principle 5 / NG7):
 * PORT (8787), DATA_DIR (./data; PGlite at data/pglite, files at data/files),
 * DATABASE_URL (node-postgres when set, else PGlite), SESSION_SECRET,
 * DISCORD_WEBHOOK_URL, LLM_BASE_URL, LLM_MODEL_PRIMARY, LLM_MODEL_FAST.
 *
 * Binds 0.0.0.0 — the LAN posture (§8/§13): the table's Wi-Fi during
 * sessions, localhost between them; nothing ever faces the internet.
 */
import { buildApp } from './app.js';
import { lanAddress } from './services/auth.js';

const port = Number(process.env.PORT ?? 8787);

const app = await buildApp();

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`safehouse serving the table at http://${lanAddress()}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
