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
 * PGlite, the demo campaign, no model, no network.
 *
 *   pnpm --filter @safehouse/web e2e          # guarded: skips with no browser
 *   pnpm --filter @safehouse/web e2e:install  # download chromium once
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.SAFEHOUSE_E2E_PORT ?? 8791);

export default defineConfig({
  testDir: './e2e',
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
