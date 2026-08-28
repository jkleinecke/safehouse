import { defineConfig } from 'vitest/config';

// Standalone vitest config so the root-installed vitest does not need to load
// vite.config.ts (and its vite-version-specific plugins) to run tests.
export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});
