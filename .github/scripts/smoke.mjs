/**
 * CI smoke test: boot the BUILT server against a throwaway DATA_DIR, wait for
 * /healthz, run the end-to-end playthrough (bootstrap → join → live socket →
 * authoritative roll → persisted log → SPA fallback), then shut it down.
 *
 * No Docker and no DATABASE_URL: the server falls back to embedded PGlite, so
 * this proves the "boots with nothing configured" posture (NG7) on every push.
 *
 *   node .github/scripts/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const serverEntry = join(repoRoot, 'apps', 'server', 'dist', 'index.js');
const playthrough = join(repoRoot, 'apps', 'server', 'scripts', 'playthrough.ts');
const PORT = process.env.SMOKE_PORT ?? '8799';
const BASE = `http://127.0.0.1:${PORT}`;

if (!existsSync(serverEntry)) {
  console.error(`smoke: ${serverEntry} is missing — run \`pnpm -r build\` first`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), 'safehouse-smoke-'));
const env = { ...process.env, PORT, DATA_DIR: dataDir, LOG_LEVEL: 'warn' };
delete env.DATABASE_URL; // embedded PGlite, deliberately
delete env.LLM_BASE_URL; // the Fixer must stay cleanly off (NG7)

const server = spawn(process.execPath, [serverEntry], {
  cwd: repoRoot,
  env,
  stdio: ['ignore', 'inherit', 'inherit'],
});

let exited = false;
server.on('exit', (code, signal) => {
  exited = true;
  if (code !== 0 && code !== null) console.error(`smoke: server exited early (code ${code} ${signal ?? ''})`);
});

function cleanup() {
  if (!exited) server.kill('SIGTERM');
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* temp dir; the OS gets it */
  }
}

async function waitForHealth(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error('server process exited before it became healthy');
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server never answered ${BASE}/healthz`);
}

function runPlaythrough() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', playthrough],
      { cwd: repoRoot, env: { ...env, SAFEHOUSE_URL: BASE }, stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`playthrough exited ${code}`)),
    );
  });
}

try {
  await waitForHealth();
  console.log(`smoke: server healthy on ${BASE}`);
  await runPlaythrough();
  console.log('smoke: passed');
  cleanup();
  process.exit(0);
} catch (err) {
  console.error(`smoke: FAILED — ${err.message}`);
  cleanup();
  process.exit(1);
}
