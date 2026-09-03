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
// Before anything reads process.env: fills in the repo-root .env for shell
// starts (compose supplies its own, and already-set variables always win).
import { envFileConflicts, envFileFor, loadEnvFile, redactUrl } from './dotenv.js';

loadEnvFile();

import { buildApp } from './app.js';
import { installSignalHandlers } from './shutdown.js';
import { lanAddress, openTableMode } from './services/auth.js';

const port = Number(process.env.PORT ?? 8787);

const app = await buildApp();

// Ctrl-C is how every session ends, so it is a first-class code path. Without
// this the server exits without checkpointing PGlite and the next boot runs
// recovery, which restarts each bigserial ~32 values past its rows — the id
// gap that keeps getting reported as a broken event log. See src/shutdown.ts.
installSignalHandlers(app);

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`safehouse serving the table at http://${lanAddress()}:${port}`);

  // Where the AI config actually came from. Silence here is how "I changed
  // .env and nothing happened" becomes an hour of guessing: the loader reads
  // two files, prefers the repo root, and never says which one won.
  const llm = process.env['LLM_BASE_URL'];
  if (llm === undefined || llm.trim() === '') {
    app.log.info('LLM_BASE_URL is unset — the Fixer and every AI entry point stay off (NG7)');
  } else {
    const from = envFileFor('LLM_BASE_URL');
    app.log.info(
      `LLM_BASE_URL=${redactUrl(llm.trim())} (from ${from ?? 'the process environment — compose, CI or the shell'})`,
    );
  }
  for (const c of envFileConflicts()) {
    // Key names only — these files hold the session secret and the db password.
    app.log.warn(
      `${c.key} is set in BOTH ${c.winner} and ${c.shadowed} with different values; ` +
        `${c.winner} wins and the other is ignored. Edit the winner, or delete the duplicate.`,
    );
  }
  if (openTableMode()) {
    // Loud on purpose. This is the one setting that removes every credential
    // between the network and the GM console, and the failure mode — running
    // it somewhere less friendly than a living room — is silent otherwise.
    app.log.warn(
      'SAFEHOUSE_OPEN_TABLE is on: anyone who can reach this server may list ' +
        'every campaign and claim its GM. Fine on a home network with friends; ' +
        'never on a machine reachable from the internet.',
    );
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
