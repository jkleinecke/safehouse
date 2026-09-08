#!/usr/bin/env node
/**
 * `pnpm docker:up` / `pnpm docker:status` — the latest checkout, running in
 * Docker, and a straight answer to "which build is this?".
 *
 * What used to go wrong, in order of how often:
 *
 *   · `docker compose up -d` without `--build` restarts LAST week's image and
 *     says nothing, so the change being tested is not in the container at all;
 *   · the compose file lived in `infra/`, so Compose read `infra/.env` while
 *     the README said `--env-file .env`, and two files drifted;
 *   · the stack refuses to start without two secrets — rightly — but the first
 *     run had to fail once to say so.
 *
 * So: one `.env` at the repo root (created from `.env.example` on first run,
 * the two secrets generated), the image always rebuilt and stamped with the
 * commit it came from, and at the end the version the RUNNING server reports
 * printed next to the version of the checkout — the same, or not, in one line.
 *
 * Plain Node and nothing else: this has to work before `pnpm install` has had
 * any reason to run.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENV = resolve(ROOT, '.env');
const EXAMPLE = resolve(ROOT, '.env.example');
const RETIRED_ENV = resolve(ROOT, 'infra', '.env');
/** The stack will not start without these; a first run should not have to learn that. */
const REQUIRED_SECRETS = ['SESSION_SECRET', 'POSTGRES_PASSWORD'];
/** `name:` in compose.yaml — what the volumes are prefixed with. */
const PROJECT = 'safehouse';
/** What the project was called while the compose file lived in infra/. */
const LEGACY_PROJECT = 'infra';
const HEALTH_TIMEOUT_MS = 120_000;

const say = (line) => console.log(`[safehouse] ${line}`);
const warn = (line) => console.warn(`[safehouse] ! ${line}`);

/** Run and stream; a non-zero exit ends the script with the same code. */
function run(cmd, args, { env, capture = false } = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    env: env ?? process.env,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (res.error) {
    if (res.error.code === 'ENOENT') {
      warn(`\`${cmd}\` is not installed or not on PATH.`);
      process.exit(127);
    }
    throw res.error;
  }
  if (res.status !== 0) {
    if (capture && res.stderr) process.stderr.write(res.stderr);
    process.exit(res.status ?? 1);
  }
  return capture ? res.stdout : '';
}

/** Like `run`, but a failure is an answer (null), not the end of the script. */
function tryRun(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  return res.status === 0 ? res.stdout : null;
}

const lines = (text) => (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// ---------------------------------------------------------------- the .env

function ensureEnv() {
  if (!existsSync(ENV)) {
    copyFileSync(EXAMPLE, ENV);
    say('created .env from .env.example — every value in it has a working default');
  }
  let text = readFileSync(ENV, 'utf8');
  const generated = [];
  for (const key of REQUIRED_SECRETS) {
    const secret = randomBytes(32).toString('hex');
    const blank = new RegExp(`^${key}=\\s*$`, 'm');
    const present = new RegExp(`^${key}=`, 'm');
    if (blank.test(text)) {
      text = text.replace(blank, `${key}=${secret}`);
      generated.push(key);
    } else if (!present.test(text)) {
      text += `${text.endsWith('\n') ? '' : '\n'}${key}=${secret}\n`;
      generated.push(key);
    }
  }
  if (generated.length > 0) {
    writeFileSync(ENV, text, 'utf8');
    say(`generated ${generated.join(' and ')} in .env (any long random string does; these were blank)`);
  }
  if (existsSync(RETIRED_ENV)) {
    warn(
      'infra/.env is not read by anything any more — .env at the repo root is the only configuration ' +
        'file, and compose reads it by itself. Move anything you still need into it, then delete infra/.env.',
    );
  }
  // Relative paths in .env are taken from the repo root now (compose.yaml
  // lives there). An old `../books` used to mean the checkout's books/ folder
  // and now points outside it — a silent empty shelf on the next seed.
  const books = /^BOOKS_DIR=\s*(\S+)\s*$/m.exec(text)?.[1];
  if (books && !/^([A-Za-z]:)?[\\/]/.test(books) && !existsSync(resolve(ROOT, books))) {
    warn(
      `BOOKS_DIR=${books} does not exist relative to the repo root (where relative paths are taken from now); ` +
        '`pnpm docker:seed` would mount an empty folder. The checkout’s own books/ is `./books`.',
    );
  }
}

/** PORT from .env, so the report points at the right address. */
function port() {
  const m = /^PORT=\s*(\d+)\s*$/m.exec(readFileSync(ENV, 'utf8'));
  return m ? Number(m[1]) : 8787;
}

// ---------------------------------------------------------------- versions

/** Short HEAD, `-dirty` when the tree has uncommitted changes; `dev` without git. */
function checkoutVersion() {
  const sha = tryRun('git', ['rev-parse', '--short=7', 'HEAD']);
  if (sha === null) return 'dev';
  const changed = tryRun('git', ['status', '--porcelain', '--untracked-files=no']);
  return lines(changed).length > 0 ? `${sha.trim()}-dirty` : sha.trim();
}

async function health(p) {
  try {
    const res = await fetch(`http://localhost:${p}/healthz`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function waitHealthy(p) {
  const until = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < until) {
    const h = await health(p);
    if (h) return h;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return null;
}

function ago(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** The one line this whole script exists for. */
function report(h, p) {
  const local = checkoutVersion();
  if (!h) {
    warn(`the server did not answer http://localhost:${p}/healthz — \`pnpm docker:logs\` says why`);
    process.exit(1);
  }
  const built = h.builtAt ? `built ${ago(h.builtAt)}` : 'no build time stamped';
  say(`running build ${h.version} (${built}) at http://localhost:${p}`);
  if (h.version === local) {
    say(`that is this checkout — HEAD is ${local}`);
  } else if (local.endsWith('-dirty') && h.version === local.slice(0, -'-dirty'.length)) {
    say(`this checkout has uncommitted changes the image does not: \`pnpm docker:up\` again to include them`);
  } else {
    warn(`this checkout is at ${local}; the container is running ${h.version} — \`pnpm docker:up\` rebuilds it`);
  }
  say('which AI: chosen in the app at GM console ▸ Fixer ▸ Which AI (the LLM_* lines in .env are only the starting default)');
}

// ---------------------------------------------------------------- the old stack

/**
 * The compose file used to live in `infra/`, so Compose named the project after
 * that folder and its volumes `infra_pgdata` / `infra_files`. The file now
 * pins `name: safehouse`, which would leave those volumes — the seeded books,
 * the campaign — orphaned and the new stack empty. Copy them across the first
 * time, once, and leave the originals for the GM to delete when satisfied.
 */
function adoptLegacyVolumes() {
  const vols = lines(tryRun('docker', ['volume', 'ls', '--format', '{{.Name}}']));
  const pending = ['pgdata', 'files'].filter(
    (v) => vols.includes(`${LEGACY_PROJECT}_${v}`) && !vols.includes(`${PROJECT}_${v}`),
  );
  if (pending.length === 0) return;

  say(`adopting the data of the old \`${LEGACY_PROJECT}\` stack (the compose file used to live in infra/)`);
  const filter = `label=com.docker.compose.project=${LEGACY_PROJECT}`;
  // Its containers must be stopped before their volumes are copied, and gone
  // before the new ones claim the same ports.
  const running = lines(tryRun('docker', ['ps', '-q', '--filter', filter]));
  if (running.length > 0) run('docker', ['stop', ...running], { capture: true });
  for (const v of pending) {
    // Labelled the way Compose labels its own, or every later `up` warns that
    // the volume "was not created by Docker Compose".
    run('docker', [
      'volume', 'create',
      '--label', `com.docker.compose.project=${PROJECT}`,
      '--label', `com.docker.compose.volume=${v}`,
      `${PROJECT}_${v}`,
    ], { capture: true });
    // The postgres image is already on the machine and has `cp`; nothing new
    // to pull. `-a` keeps ownership, which the database directory depends on.
    run('docker', [
      'run', '--rm', '--entrypoint', 'sh',
      '-v', `${LEGACY_PROJECT}_${v}:/from:ro`,
      '-v', `${PROJECT}_${v}:/to`,
      'postgres:16-alpine', '-c', 'cp -a /from/. /to/',
    ]);
    say(`  ${LEGACY_PROJECT}_${v} → ${PROJECT}_${v}  (the original is untouched: \`docker volume rm ${LEGACY_PROJECT}_${v}\` once you are happy)`);
  }
  const all = lines(tryRun('docker', ['ps', '-aq', '--filter', filter]));
  if (all.length > 0) run('docker', ['rm', '-f', ...all], { capture: true });
}

// ---------------------------------------------------------------- commands

async function up(args) {
  ensureEnv();
  adoptLegacyVolumes();

  // `--profile x` is a global compose flag and goes before `up`; anything
  // else (a service name, `--no-deps`) goes after it.
  const globals = [];
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--profile' && i + 1 < args.length) {
      globals.push('--profile', args[i + 1]);
      i += 1;
    } else if (args[i].startsWith('--profile=')) {
      globals.push(args[i]);
    } else {
      rest.push(args[i]);
    }
  }

  const version = checkoutVersion();
  const builtAt = new Date().toISOString();
  say(`building ${version} …`);
  run('docker', ['compose', ...globals, 'up', '-d', '--build', '--remove-orphans', ...rest], {
    env: { ...process.env, SAFEHOUSE_VERSION: version, SAFEHOUSE_BUILT_AT: builtAt },
  });

  const p = port();
  say('waiting for /healthz …');
  report(await waitHealthy(p), p);
}

async function status() {
  if (!existsSync(ENV)) {
    warn('no .env yet — `pnpm docker:up` creates it');
    process.exit(1);
  }
  const p = port();
  const h = await health(p);
  if (!h) {
    warn(`nothing is answering at http://localhost:${p} — \`pnpm docker:up\` starts the latest build`);
    process.exit(1);
  }
  report(h, p);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'up') await up(args);
else if (command === 'status') await status();
else {
  console.error('usage: node scripts/docker.mjs up [--profile llm] [service…] | status');
  process.exit(2);
}
