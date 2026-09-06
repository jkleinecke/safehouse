/**
 * Headless-browser E2E for Safehouse.
 *
 * These specs exist because the API-level playthrough — 94 green assertions —
 * missed three defects that a browser found in ten minutes: the SPA never
 * backfilled state on mount (LIVE-1), the active scene's environment modifier
 * was applied twice (LIVE-2), and `/join/:code` served raw JSON instead of the
 * join screen (LIVE-3). Every one of them lives between the server and the
 * rendered page, which is the seam only a real browser can test.
 *
 * The run boots the REAL stack against a throwaway `DATA_DIR` (see
 * `e2e/fixtures/harness.ts`): the built server, the built SPA on one origin,
 * PGlite, the demo campaign and one manufactured book in the library, no model,
 * no network.
 *
 * **No model is a deliberate property of the shared world**, not an oversight:
 * NG7 says the table plays with the Fixer off, and every spec here is written
 * against that posture. The one feature that needs an inference box —
 * `recap.spec.ts` — boots its own stack on the next port with its own
 * `DATA_DIR` and a mock model in-process (`e2e/fixtures/ai-stack.ts`), rather
 * than turning the Fixer on underneath everything else. PGlite's rule is one
 * process per data directory; two directories are fine.
 *
 *   pnpm --filter @safehouse/web e2e          # guarded: skips with no browser
 *   pnpm --filter @safehouse/web e2e -- reader.spec.ts
 *   pnpm --filter @safehouse/web e2e:install  # download chromium once
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.SAFEHOUSE_E2E_PORT ?? 8791);

export default defineConfig({
  testDir: './e2e',
  /**
   * Browser suites are `*.spec.ts` — and ONLY those.
   *
   * Playwright's default `testMatch` also takes `*.test.ts`, which is what the
   * rest of the repo names its vitest files. The moment a unit test for the
   * harness itself landed in `e2e/fixtures`, Playwright picked it up, loaded
   * vitest inside a Playwright worker, and the whole run died on "Vitest
   * failed to access its internal state" — a message that says nothing about
   * the actual mistake.
   */
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/fixtures/global-setup.ts',
  // One server, one campaign, one worker: the specs share a live table, and a
  // fight advancing under a parallel spec is a flake, not a finding.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
