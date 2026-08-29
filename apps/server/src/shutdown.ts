/**
 * Clean database shutdown — for the one-shot processes (the seeders,
 * `scripts/*`) and for the long-running server itself.
 *
 * PGlite is an embedded, single-writer engine, so the directory a process
 * leaves behind is only as good as the way that process let go of it. A writer
 * that calls `process.exit()` without closing never checkpoints: the rows are
 * durable in the WAL, but the next process to open the directory has to run
 * recovery — and because PostgreSQL WAL-logs sequence advances in blocks of 32
 * (`SEQ_LOG_VALS`), recovery restarts every bigserial about 32 values ahead of
 * the rows it actually has.
 *
 * Measured in this repo, on the exact hand-off the demo flow uses (seed in one
 * process, exit, serve from another):
 *   `pnpm seed:demo` then reopen  ->  ws_events max(id) 21, sequence 33
 *   same seed, closed cleanly     ->  ws_events max(id) 21, sequence 21
 * And the same measurement on the server, stopped the way an operator stops it:
 *   killed mid-session then reopened -> last event 24, next event id 55
 * Nothing is lost either way — a bigserial can only skip forward, never reissue
 * an id — but the gap reappears on every restart, it is unbounded across a
 * campaign's life, and it is the observation that has repeatedly been mistaken
 * for sequence corruption. One `await` on the way out removes it.
 *
 * `app.close()` does NOT do this: Fastify knows nothing about `db.$client`.
 */
import { closeDb, resetDbSingleton, type Db } from '@safehouse/db';

/** The part of Fastify this module needs — keeps the helpers unit-testable. */
export interface ClosableApp {
  db: Db;
  close: () => Promise<unknown>;
  log?: { info: (msg: string) => void; error: (obj: unknown, msg?: string) => void };
}

/**
 * Flush and close the database handle. Safe to call twice, safe on a handle
 * that never opened a file, and never throws — a process that finished its work
 * must not fail on the way out.
 *
 * `closeDb` is the db package's own lifecycle helper: it checkpoints, closes
 * the driver it recognises, and clears the module-level `getDb()` singleton it
 * owns. `resetDbSingleton()` here is belt-and-braces for the throw path.
 */
export async function closeDatabase(db: Db): Promise<void> {
  try {
    await closeDb(db);
  } catch {
    /* the handle is going away with the process either way */
  }
  resetDbSingleton();
}

/** One in-flight shutdown per app, so a double Ctrl-C stays one close. */
const inFlight = new WeakMap<ClosableApp, Promise<void>>();

/**
 * Stop the HTTP server, then close the database — in that order, so no request
 * is still writing when the checkpoint runs. Idempotent: the second and later
 * calls return the first call's promise, because SIGINT arriving twice (an
 * impatient Ctrl-C) must not start a second close on a closing handle.
 */
export function shutdownServer(app: ClosableApp): Promise<void> {
  const existing = inFlight.get(app);
  if (existing) return existing;
  const run = (async (): Promise<void> => {
    try {
      await app.close();
    } catch (err) {
      app.log?.error(err, 'shutdown: http close failed; closing the database anyway');
    }
    await closeDatabase(app.db);
  })();
  inFlight.set(app, run);
  return run;
}

/**
 * Wire SIGINT/SIGTERM to `shutdownServer`. Without this the server is the one
 * writer in the system that always exits unclean — the seeders were fixed and
 * the process that does 99% of the writing was not.
 *
 * `graceMs` is a backstop, not a policy: if a socket refuses to drain we still
 * exit, because a stuck shutdown is worse than a skipped checkpoint. Returns a
 * disposer so tests (and embedders) can unhook the listeners again.
 */
export function installSignalHandlers(
  app: ClosableApp,
  opts: { graceMs?: number; exit?: (code: number) => void } = {},
): () => void {
  const graceMs = opts.graceMs ?? 5_000;
  const exit = opts.exit ?? ((code: number): void => process.exit(code));
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

  const handler = (signal: NodeJS.Signals): void => {
    app.log?.info(`${signal} — closing the table down cleanly`);
    // Unref'd: a timer that outlives the shutdown must not itself hold the
    // event loop open, or the "backstop" becomes the thing that delays exit.
    const backstop = setTimeout(() => exit(1), graceMs);
    (backstop as { unref?: () => void }).unref?.();
    void shutdownServer(app).then(
      () => {
        clearTimeout(backstop);
        exit(0);
      },
      (err: unknown) => {
        clearTimeout(backstop);
        app.log?.error(err, 'shutdown failed');
        exit(1);
      },
    );
  };

  for (const signal of signals) process.on(signal, handler);
  return () => {
    for (const signal of signals) process.off(signal, handler);
  };
}
