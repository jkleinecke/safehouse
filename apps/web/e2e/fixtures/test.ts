/**
 * The shared Playwright fixture: the arranged world, a REST client for
 * asserting against the server's own record, and the sign-in paths a real
 * device uses.
 *
 * Both sign-in helpers drive the UI. Nothing here writes `localStorage` by
 * hand — that workaround is exactly the gap the GM sign-in spec exists to
 * prove closed, and a helper that cheated would hide it from every other spec
 * too.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { Api } from './api';
import { readWorld, type DeviceSession, type World } from './world';

export { expect };

export interface Fixtures {
  world: World;
  api: Api;
}

export const test = base.extend<Fixtures>({
  world: async ({}, use) => {
    await use(readWorld());
  },
  api: async ({ world }, use) => {
    await use(new Api(world.baseUrl));
  },
});

/** Where a device of this role belongs after signing in (`signin.ts`). */
export function homeFor(session: DeviceSession): string {
  if (session.role === 'display') return `/tv/${session.campaignId}`;
  if (session.role === 'gm') return `/c/${session.campaignId}/gm`;
  return `/c/${session.campaignId}`;
}

/**
 * Sign in with a device token through the landing screen's "Paste a token"
 * tab — the in-app escape hatch for a token printed by `seed:demo`
 * (BUILD_REPORT gap #2). The token is verified against the server before the
 * browser stores anything.
 */
export async function signInWithToken(page: Page, session: DeviceSession): Promise<void> {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Paste a token' }).click();
  await page
    .locator('#signin-panel-token textarea')
    .fill(JSON.stringify({ token: session.token, role: session.role, campaignId: session.campaignId }));
  await page.getByRole('button', { name: 'use this token' }).click();
  await page.waitForURL(`**${homeFor(session)}`);
}

/**
 * Redeem a join code the way a scanned QR does: navigate to the SPA route
 * `/join/:code` and let it mint the device (LIVE-3 — this path used to hand a
 * player the API's raw JSON).
 */
export async function joinWithCode(page: Page, code: string): Promise<void> {
  await page.goto(`/join/${code}`);
  await page.waitForURL((url) => !url.pathname.startsWith('/join/'), { timeout: 20_000 });
}

/**
 * Make the WebSocket unusable for this page, so anything that renders can only
 * have come from REST.
 *
 * This is the LIVE-1 probe: the app used to render *only* the events it
 * received while mounted, so with no socket the table log said "the log is
 * empty" seconds after a real roll persisted. The stub stays in CONNECTING for
 * ever — no open, no message, no close — and records the URLs the app tried,
 * so a spec can prove the app really did try and really did get nothing.
 */
export async function blockWebSockets(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const attempts: string[] = [];
    (window as unknown as { __e2eSocketAttempts: string[] }).__e2eSocketAttempts = attempts;
    class DeadSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      readyState = 0;
      url: string;
      onopen: unknown = null;
      onmessage: unknown = null;
      onclose: unknown = null;
      onerror: unknown = null;
      constructor(url: string) {
        this.url = String(url);
        attempts.push(this.url);
      }
      send(): void {}
      close(): void {
        this.readyState = 3;
      }
      addEventListener(): void {}
      removeEventListener(): void {}
      dispatchEvent(): boolean {
        return false;
      }
    }
    (window as unknown as { WebSocket: unknown }).WebSocket = DeadSocket;
  });
}

/** How many sockets this page tried to open (0 unless `blockWebSockets` ran). */
export function socketAttempts(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __e2eSocketAttempts?: string[] }).__e2eSocketAttempts ?? [],
  );
}

/** The number inside an accessible name like "Roll perception, pool 5, …". */
export function poolFromLabel(label: string | null): number {
  const m = /pool (\d+)/.exec(label ?? '');
  if (!m?.[1]) throw new Error(`no pool in accessible name: ${label ?? '(none)'}`);
  return Number(m[1]);
}

/** The dice count inside the roll button's "Roll 5d6". */
export function diceFromButton(label: string | null): number {
  const m = /Roll (\d+)d6/.exec(label ?? '');
  if (!m?.[1]) throw new Error(`no dice count in roll button: ${label ?? '(none)'}`);
  return Number(m[1]);
}
