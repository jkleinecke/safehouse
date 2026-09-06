import { defineConfig } from 'vitest/config';

/**
 * Every server suite boots its own throwaway PGlite (temp DATA_DIR) in
 * `beforeAll` and runs drizzle migrations against it. With ~20 suites in
 * flight the WASM boot + migration easily exceeds vitest's 10s default
 * hook timeout on a cold cache, so the timeouts are raised and the worker
 * pool is capped to keep disk/CPU contention bounded.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
    teardownTimeout: 30_000,
    /**
     * THREADS, not forks — and this is the second attempt at the same bug.
     *
     * The suite kept exiting 1 with every test green above it, on an unhandled
     * `ERR_IPC_CHANNEL_CLOSED` out of tinypool's `ProcessWorker.send`: the pool
     * writing to a forked child whose IPC channel had already gone. A suite
     * that passes and reports failure is worse than one that fails honestly,
     * because it teaches you to ignore the exit code.
     *
     * The first fix pinned the fork pool at full size, reasoning that tinypool
     * was retiring idle workers during the long tail of the slowest suite. It
     * ran clean three times and then failed again, so that was a coincidence
     * rather than a cause.
     *
     * Worker threads remove the mechanism instead of dodging it: they
     * communicate over a MessagePort, so there is no child IPC channel to
     * close and that error cannot be raised at all. Every suite still boots
     * its own throwaway PGlite against its own temp DATA_DIR, which is what
     * made forks look necessary; nothing here shares process state.
     */
    pool: 'threads',
    poolOptions: { threads: { maxThreads: 8, minThreads: 1 } },
  },
});
