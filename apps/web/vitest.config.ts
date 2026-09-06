import { defineConfig } from 'vitest/config';

// Standalone vitest config so the root-installed vitest does not need to load
// vite.config.ts (and its vite-version-specific plugins) to run tests.
export default defineConfig({
  test: {
    include: [
      'test/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      // Harness plumbing only. `e2e/*.spec.ts` are the browser suites and stay
      // out of here — this pattern deliberately takes `.test.ts` under
      // `e2e/fixtures` and nothing else, so the parts of the harness that can
      // be checked without a browser are checked with everything else.
      'e2e/fixtures/**/*.test.ts',
    ],
    passWithNoTests: true,
  },
});
