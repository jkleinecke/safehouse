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
    poolOptions: { forks: { maxForks: 8, minForks: 1 } },
  },
});
