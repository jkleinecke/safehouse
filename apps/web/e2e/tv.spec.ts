/**
 * FR9.19–9.21 — the table TV shows the active scene's map and the initiative
 * ribbon, filtered exactly like a player's socket.
 *
 * This is the Roll20 exit criterion for P2 (BUILD_REPORT gap #1): combat
 * cannot run "on our map, on the big screen" until a `display`-filtered stage
 * lands on `/tv`. It is also the screen nobody will walk over and fix, so the
 * spec insists it hydrates by itself — the TV is loaded cold, with the fight
 * and the scene already in the database and no event arriving to announce them.
 */
import { blockWebSockets, expect, joinWithCode, test } from './fixtures/test';

test.describe('the table display', () => {
  test('renders the active scene, its map stage, and the initiative ribbon', async ({
    page,
    world,
  }) => {
    await joinWithCode(page, world.codes.display);
    await expect(page).toHaveURL(new RegExp(`/tv/${world.campaignId}$`));

    // The scene the GM activated, by name, in the kiosk header.
    await expect(page.getByText(world.sceneName)).toBeVisible();

    // The map itself: the Pixi stage mounts a canvas into the kiosk.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('MAP RENDERER UNAVAILABLE')).toHaveCount(0);

    // The ribbon, with a turn/pass that is not the 0/0 of an unstarted fight.
    const ribbon = page.getByRole('region', { name: 'Initiative order' });
    await expect(ribbon).toBeVisible();
    await expect(ribbon.getByText(/TURN \d+ · PASS \d+/)).toBeVisible();
    await expect(ribbon.getByText('TURN 0')).toHaveCount(0);
    const first = world.publicCombatants[0];
    if (first) await expect(ribbon.getByText(first).first()).toBeVisible();
  });

  test('a TV rebooted mid-firefight comes back to the scene on its own', async ({
    page,
    world,
  }) => {
    await joinWithCode(page, world.codes.display);
    await expect(page.getByText(world.sceneName)).toBeVisible();

    // Cold reload with the socket dead: everything below has to come from REST.
    await blockWebSockets(page);
    await page.reload();

    await expect(page.getByText(world.sceneName)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Initiative order' })).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });
  });

  test('the kiosk holds no GM-only state', async ({ page, world }) => {
    await joinWithCode(page, world.codes.display);
    await expect(page.getByText(world.sceneName)).toBeVisible();

    const html = await page.content();
    expect(html, 'a GM-only log line reached the TV').not.toContain(world.gmOnlyLogText);
    for (const hidden of world.hiddenTokenNames) {
      expect(html, `hidden token "${hidden}" reached the TV`).not.toContain(hidden);
    }
  });
});
