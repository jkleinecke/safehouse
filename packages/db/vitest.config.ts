import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // PGlite boots a WASM postgres per suite; 10s is tight on a cold cache.
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
