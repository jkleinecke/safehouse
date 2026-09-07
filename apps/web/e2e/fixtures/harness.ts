/**
 * Boot the REAL stack for the E2E run: a throwaway `DATA_DIR`, the demo
 * campaign seeded through the app's own HTTP surface, and the built Fastify
 * server serving the built SPA on one origin — exactly the production posture
 * (`docker compose up`), which is also the only posture in which `/join/:code`
 * has to resolve to the join SCREEN rather than the API's JSON (LIVE-3).
 *
 * Nothing is mocked. The dice are the server's CSPRNG, the database is PGlite,
 * and the only thing missing is a model (`LLM_BASE_URL` stays unset, NG7) —
 * which is a property the specs rely on, not an omission. `recap.spec.ts` boots
 * a second, AI-enabled stack of its own rather than switching the Fixer on
 * underneath everything else (`fixtures/ai-stack.ts`).
 *
 * Two seeders run against the directory before the server opens it, each in its
 * own process and each closing cleanly on the way out: `seed:demo` for the
 * campaign, then `seed:books` for one manufactured book (`fixtures/pdf.ts`).
 * PGlite is single-writer, so the order is not a preference.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Api } from './api';
import { BOOK_PAGES, arrange } from './arrange';
import { buildTestPdf } from './pdf';
import type { World } from './world';

export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const WEB_ROOT = join(REPO_ROOT, 'apps', 'web');
const WEB_DIST = join(WEB_ROOT, 'dist');
const SERVER_ROOT = join(REPO_ROOT, 'apps', 'server');
export const SERVER_DIST = join(REPO_ROOT, 'apps', 'server', 'dist', 'index.js');
const SEED_DEMO = join(REPO_ROOT, 'apps', 'server', 'seed', 'demo.ts');
const SEED_BOOKS = join(REPO_ROOT, 'apps', 'server', 'scripts', 'seed-books.ts');

/**
 * Where vite actually is. pnpm does NOT hoist to the workspace root, so the
 * old hard-coded `<root>/node_modules/vite/bin/vite.js` resolved to nothing on
 * a normal install and every rebuild died with MODULE_NOT_FOUND — which, since
 * the rebuild only fires when `dist` is stale, meant the suite failed exactly
 * when someone had just changed the app.
 */
function viteBin(): string {
  const candidates = [
    join(WEB_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
    join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `e2e: cannot find vite to rebuild the SPA (looked in ${candidates.join(', ')}). ` +
        'Run `pnpm build` first, or set SAFEHOUSE_E2E_NO_BUILD=1.',
    );
  }
  return found;
}

export interface Booted {
  world: World;
  stop: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Build freshness — an E2E run against a stale bundle proves nothing
// ---------------------------------------------------------------------------

async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      const stat = statSync(join(entry.parentPath, entry.name));
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    } catch {
      // A file that vanished between the listing and the stat is not a reason
      // to skip the build — treat the tree as fresh-enough and move on.
    }
  }
  return newest;
}

/** Where `tsc` actually is, on the same rules as `viteBin`. */
export function tscBin(): string {
  const candidates = [
    join(SERVER_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
    join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error(
      `e2e: cannot find tsc to rebuild the server (looked in ${candidates.join(', ')}). ` +
        'Run pnpm build first, or set SAFEHOUSE_E2E_NO_BUILD=1.',
    );
  }
  return found;
}

/**
 * Compile the server before the specs drive it.
 *
 * This used to check only that `apps/server/dist` EXISTED. So a change under
 * `apps/server/src` ran against whatever was last compiled, and the specs
 * reported on code that was no longer in the tree — worse than a plain
 * failure, because a fix that landed looks like it did nothing and a
 * regression that landed looks like it is not there. It cost a full debugging
 * round against a bug that was already fixed.
 *
 * Run unconditionally, with no staleness check of our own. `tsc -b` already
 * has one, and a better one: it compares CONTENT, where a comparison of file
 * times can be fooled in both directions — a touched file rebuilds for
 * nothing, and a restored file skips a rebuild it needed. Up to date, it
 * costs about a fifth of a second, which is not worth being clever about. The
 * SPA below still needs the mtime check, because vite has no such thing.
 */
async function ensureServerBuild(log: (s: string) => void): Promise<void> {
  if (process.env.SAFEHOUSE_E2E_NO_BUILD === '1') {
    if (!existsSync(SERVER_DIST)) {
      throw new Error(
        `e2e: ${SERVER_DIST} is missing and SAFEHOUSE_E2E_NO_BUILD=1 forbids building it.`,
      );
    }
    return;
  }

  log('e2e: checking the server build…');
  await run(process.execPath, [tscBin(), '-b'], { cwd: SERVER_ROOT });
  if (!existsSync(SERVER_DIST)) {
    throw new Error(`e2e: the server build produced no ${SERVER_DIST}.`);
  }
}

/** Everything the specs need compiled: the server, then the SPA. */
export async function ensureBuilds(log: (s: string) => void): Promise<void> {
  await ensureServerBuild(log);
  if (process.env.SAFEHOUSE_E2E_NO_BUILD === '1') {
    if (!existsSync(join(WEB_DIST, 'index.html'))) {
      throw new Error('e2e: apps/web/dist is missing and SAFEHOUSE_E2E_NO_BUILD=1 forbids building it.');
    }
    return;
  }

  const built = existsSync(join(WEB_DIST, 'index.html'))
    ? statSync(join(WEB_DIST, 'index.html')).mtimeMs
    : 0;
  const source = await newestMtime(join(WEB_ROOT, 'src'));
  if (built > source) {
    log('e2e: apps/web/dist is current, skipping the SPA build');
    return;
  }

  log('e2e: building the SPA (apps/web/dist is stale)…');
  // Vendor pdf.js first, exactly as `pnpm --filter @safehouse/web build` does:
  // the reader loads it from `/pdfjs/` as a same-origin static asset, and a
  // dist without it silently degrades to the browser's own viewer — which is
  // the one thing `reader.spec.ts` exists to prove we no longer depend on.
  await run(process.execPath, [join(WEB_ROOT, 'scripts', 'vendor-pdfjs.mjs')], { cwd: WEB_ROOT });
  await run(process.execPath, [viteBin(), 'build'], { cwd: WEB_ROOT });
}

// ---------------------------------------------------------------------------
// Child processes
// ---------------------------------------------------------------------------

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? REPO_ROOT,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    // `close`, not `exit`: exit fires when the process is gone but its stdio
    // may still be draining, and the very next thing we do is open the same
    // PGlite directory the child just held. PGlite is single-writer, so the
    // handoff has to be complete rather than merely imminent.
    child.on('close', (code) =>
      code === 0
        ? resolvePromise(out)
        : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${out}\n${err}`)),
    );
  });
}

/**
 * Env every child gets: no model, no webhook, no external database (NG7).
 *
 * The deletes run BEFORE `extra` is folded in, so a caller that deliberately
 * wants one of them back — `recap.spec.ts` points its own stack at a mock
 * inference box — can pass it and have it survive. Passing nothing keeps the
 * default posture: the app under test has no model and no outbound anything.
 */
export function childEnv(dataDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATA_DIR: dataDir,
    LOG_LEVEL: 'warn',
    // PINNED, not deleted. The server reads `.env` / `infra/.env` on a shell
    // start and that loader is non-overriding, so DELETING this would let the
    // developer's own file decide the security posture of the test world — the
    // gm-signin spec started passing or failing depending on a gitignored file
    // nobody thought they were editing. An explicit '0' is what closes the
    // door; a spec that wants the open table can pass '1' through `extra`.
    SAFEHOUSE_OPEN_TABLE: '0',
  };
  delete env.DATABASE_URL;
  delete env.LLM_BASE_URL;
  delete env.DISCORD_WEBHOOK_URL;
  // The seeded PDFs are 300 MB of book; nothing here needs them.
  delete env.SAFEHOUSE_BOOKS_DIR;
  return { ...env, ...extra };
}

/**
 * `seed:demo` runs BEFORE the server, in its own process: PGlite locks its
 * directory, so the seed and the server can never hold it at the same time.
 * Only two things are read back out of its output — the campaign id and the
 * GM's token; everything else the specs need is fetched over REST afterwards,
 * so a change to the seed's pretty-printing cannot break the suite.
 */
export async function seedDemo(dataDir: string): Promise<{ campaignId: string; gmToken: string }> {
  const stdout = await run(process.execPath, ['--import', 'tsx', SEED_DEMO], {
    env: childEnv(dataDir),
  });
  const campaignId = /^campaign\s+(\S+)/m.exec(stdout)?.[1];
  const gmToken = /^\s+gm\s+.*\s(\S+)\s*$/m.exec(stdout)?.[1];
  if (!campaignId || !gmToken) {
    throw new Error(`e2e: could not read the campaign id / GM token out of seed:demo\n${stdout}`);
  }
  return { campaignId, gmToken };
}

/**
 * Put one book in the library, through the REAL seeding path (FR11.7).
 *
 * The PDF is manufactured (`fixtures/pdf.ts`) — the table's actual seventeen
 * books are copyrighted and 300 MB, and the harness unsets
 * `SAFEHOUSE_BOOKS_DIR` for exactly that reason. What is NOT manufactured is
 * the route in: `seed:books` runs as its own process against the same
 * `DATA_DIR` the demo seed just left, guesses the code and offset from the
 * filename the way it does for the GM's own folder, copies the file into the
 * store and indexes a couple of pages. So the reader spec opens a book that was
 * registered the way every real book is.
 *
 * Filename choice is load-bearing: it is the one the seeder recognises as the
 * core rulebook, which is what yields code `SR5` and the measured `+5` offset —
 * the pair the whole printed↔PDF story in FR11.1/11.3 rests on. The *title* is
 * overwritten later (`arrange`) so nothing in a trace can mistake this stand-in
 * for the book itself.
 *
 * Returns where the file landed so the spec can compare bytes-on-the-wire to
 * bytes-on-disk.
 */
async function seedBook(
  dataDir: string,
  opts: { pages: number },
): Promise<{ code: string; pages: number; bytes: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'safehouse-e2e-book-'));
  const file = join(dir, 'Shadowrun Fifth Edition Core Rulebook.pdf');
  const pdf = buildTestPdf({ pages: opts.pages });
  writeFileSync(file, pdf);
  try {
    await run(
      process.execPath,
      [
        '--import',
        'tsx',
        SEED_BOOKS,
        '--dir',
        dir,
        '--only',
        'SR5',
        '--data-dir',
        dataDir,
        // Text extraction is FR12.14's business, not the reader's; two pages is
        // enough to prove the seeder ran and keeps a 440-page file cheap.
        '--max-pages',
        '2',
      ],
      { env: childEnv(dataDir) },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { code: 'SR5', pages: opts.pages, bytes: pdf.byteLength };
}

/**
 * Is something listening on this port right now?
 *
 * A connect attempt, not a bind attempt. Binding to test would race with the
 * server we are about to start: we would have to release the port again, and
 * the gap between releasing it and the real bind is exactly the window this is
 * meant to close.
 */
export function portInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const done = (answer: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(answer);
    };
    socket.once('connect', () => done(true));
    // ECONNREFUSED — nobody home, which is what we are waiting for.
    socket.once('error', () => done(false));
    // A port that neither accepts nor refuses is filtered, not served.
    socket.setTimeout(1_000, () => done(false));
  });
}

/**
 * Wait until nothing holds `port`, and say so clearly if something will not
 * let go.
 *
 * The whole e2e stack binds ONE fixed port, so two runs in quick succession
 * overlap: the previous Playwright process has returned, but its server child
 * is still shutting down — PGlite takes a moment to close its directory — and
 * the new run spawns straight into it. On Windows that surfaced as a bare
 * `0xC0000409` with no message anywhere, which is the least diagnosable
 * failure a harness can produce.
 *
 * Returns how long it waited, so the caller can stay quiet in the normal case
 * and speak up when it was not.
 */
export async function waitForFreePort(port: number, timeoutMs = 20_000): Promise<number> {
  const started = Date.now();
  for (;;) {
    if (!(await portInUse(port))) return Date.now() - started;
    if (Date.now() - started >= timeoutMs) {
      throw new Error(
        [
          `e2e: :${port} is still held after ${Math.round(timeoutMs / 1000)}s.`,
          '     Something is already listening there — most likely a server from a',
          '     previous run that has not exited yet. Close it, or point this run at',
          '     another port with SAFEHOUSE_E2E_PORT.',
        ].join('\n'),
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function startServer(
  dataDir: string,
  port: number,
  logPath: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<ChildProcess> {
  const child = spawn(process.execPath, [SERVER_DIST], {
    cwd: REPO_ROOT,
    env: childEnv(dataDir, { PORT: String(port), ...extraEnv }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const capture = (d: Buffer) => {
    log += d.toString();
    writeFileSync(logPath, log);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  let exited = false;
  child.on('exit', () => (exited = true));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`e2e: server exited before it was healthy\n${log}`);
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return child;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error(`e2e: server never answered ${base}/healthz\n${log}`);
}

// ---------------------------------------------------------------------------
// Entry point used by global setup
// ---------------------------------------------------------------------------

export async function boot(port: number, log: (s: string) => void): Promise<Booted> {
  await ensureBuilds(log);

  const dataDir = mkdtempSync(join(tmpdir(), 'safehouse-e2e-'));
  const serverLog = join(dataDir, 'server.log');
  log(`e2e: seeding the demo campaign into ${dataDir}`);
  const { campaignId, gmToken } = await seedDemo(dataDir);

  // Same directory, next process, still before the server opens it: PGlite is
  // single-writer and each seeder closes cleanly on the way out (LIVE-4).
  log('e2e: seeding one manufactured book into the library');
  const book = await seedBook(dataDir, { pages: BOOK_PAGES });

  // Nothing may be on that port before we spawn onto it. Quiet unless it
  // actually had to wait, which is the case worth knowing about.
  const waited = await waitForFreePort(port);
  if (waited > 250) log(`e2e: waited ${(waited / 1000).toFixed(1)}s for :${port} to clear`);

  log(`e2e: booting the built server on :${port}`);
  const server = await startServer(dataDir, port, serverLog);

  const api = new Api(`http://127.0.0.1:${port}`);
  let world: World;
  try {
    world = await arrange(api, campaignId, gmToken, book);
  } catch (err) {
    server.kill();
    throw err;
  }
  log(
    `e2e: world ready — campaign ${world.campaignId}, ${world.stagedCombatants} combatants staged, ` +
      `roll ${world.seededRoll.id} (pool ${world.seededRoll.pool}) on the record, ` +
      `${world.book.code} p.${world.book.printedPage} = pdf ${world.book.pdfPage} ` +
      `(${(world.book.bytes / 1_048_576).toFixed(1)} MB)`,
  );

  return {
    world,
    stop: async () => {
      server.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* the OS gets the temp dir */
      }
    },
  };
}
