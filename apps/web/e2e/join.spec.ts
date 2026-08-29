/**
 * LIVE-3 — `/join/:code` is the join SCREEN, not the API.
 *
 * Found by scanning the QR with a phone: `GET /join/:code` was registered both
 * as an API route and as an SPA route, and the Vite dev server proxied `/join`
 * to the API — so a player who scanned the code the GM held up got a wall of
 * raw JSON (their own bearer token among it) instead of the join screen.
 *
 * The split under test: the SPA owns `/join/:code`, the token endpoint is
 * `/api/join/:code`, and the QR payload points at the SPA route.
 */
import { expect, test } from './fixtures/test';

test.describe('LIVE-3 · the QR lands on the join screen', () => {
  test('scanning the code renders the join screen and lands the player in their view', async ({
    page,
    world,
  }) => {
    const response = await page.goto(`/join/${world.codes.player}`);

    // The navigation itself must be a document, not a JSON payload.
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type'] ?? '').toContain('text/html');

    await page.waitForURL(`**/c/${world.campaignId}`);
    await expect(page.getByRole('heading', { name: world.campaignName })).toBeVisible();
  });

  test('the API path still mints a device, and only the API path answers JSON', async ({
    api,
    world,
  }) => {
    const spa = await api.raw(`/join/${world.codes.player}`);
    expect(spa.headers.get('content-type') ?? '').toContain('text/html');

    const json = await api.raw(`/api/join/${world.codes.player}`);
    expect(json.headers.get('content-type') ?? '').toContain('application/json');
    const minted = (await json.json()) as { token?: string; campaignId?: string; role?: string };
    expect(minted.token).toBeTruthy();
    expect(minted.campaignId).toBe(world.campaignId);
    expect(minted.role).toBe('player');
  });

  test('the QR the GM holds up encodes the SPA route', async ({ api, world }) => {
    const qr = await api.get<{ url: string; code: string; role: string }>(
      `/api/campaigns/${world.campaignId}/join-qr?role=player`,
      world.gm.token,
    );
    expect(qr.url).toContain(`/join/${qr.code}`);
    expect(qr.url).not.toContain('/api/join/');

    // And the URL in that QR really does serve the screen.
    const path = new URL(qr.url).pathname;
    const res = await api.raw(path);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
  });

  test('the TV joins as a display device and lands on the kiosk', async ({ page, world }) => {
    await page.goto(`/join/${world.codes.display}`);
    await page.waitForURL(`**/tv/${world.campaignId}`);
    await expect(page.getByText('Display not joined')).toHaveCount(0);
  });

  test('a dead code fails on the join screen instead of leaking a 404 payload', async ({
    page,
  }) => {
    await page.goto('/join/NOSUCHCODE');
    await expect(page.getByText('Join failed')).toBeVisible();
  });

  /**
   * The suite drives the production posture — one origin, the server serving
   * the SPA — but the bug was *first seen* in dev, where Vite proxied `/join`
   * straight to the API. Nothing above would catch that coming back, so the
   * dev proxy table is asserted directly: `/api` must be proxied (that is how
   * the join screen gets its token) and `/join` must not be.
   */
  test('the dev server does not proxy /join to the API', async () => {
    const mod = (await import('../vite.config')) as {
      default: { server?: { proxy?: Record<string, unknown> } };
    };
    const proxy = mod.default.server?.proxy ?? {};
    const keys = Object.keys(proxy);

    expect(keys, 'the dev server must proxy /api or the join screen cannot mint a token').toContain(
      '/api',
    );
    expect(keys, 'Vite is proxying /join again — scanning the QR shows raw JSON (LIVE-3)').not.toContain(
      '/join',
    );
    for (const key of keys) {
      expect(key.startsWith('/join'), `dev proxy rule "${key}" swallows the SPA join route`).toBe(
        false,
      );
    }
  });
});
