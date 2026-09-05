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
    pool: 'forks',
    /**
     * `minForks` matches `maxForks` on purpose.
     *
     * With a floor of 1, tinypool tears down idle workers WHILE the run is
     * still going — and the slowest suite here takes half a minute, so there
     * is a long tail during which most workers are idle and being destroyed.
     * A message queued to a fork that is on its way out rejects with
     * ERR_IPC_CHANNEL_CLOSED, which vitest reports as an unhandled rejection
     * and turns into exit 1 with every single test green above it. A suite
     * that passes and reports failure is worse than one that fails honestly.
     *
     * Keeping the pool at full size for the whole run costs idle memory and
     * removes the race.
     */
    poolOptions: { forks: { maxForks: 8, minForks: 8 } },
  },
});
