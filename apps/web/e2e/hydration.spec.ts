/**
 * LIVE-1 — every live view must hydrate from REST on mount.
 *
 * Found by driving the real app: seconds after a roll persisted the table log
 * read "The log is empty", and the tracker read "No combatants yet" while the
 * encounter held eight staged combatants and was `state = 'live'`. The SPA was
 * rendering the WebSocket delta feed as if it were the whole truth, so any page
 * load or refresh mid-session showed an empty world.
 *
 * The probe is blunt on purpose: the page's WebSocket is replaced with a stub
 * that never opens, never delivers a message and never closes. Anything that
 * appears on screen therefore came from `GET /api/campaigns/:id/log` and
 * `GET /api/encounters/:id` — the reads the app never used to make. A reload
 * repeats the whole thing, because "refresh mid-session" is how it was found.
 */
import { blockWebSockets, expect, socketAttempts, signInWithToken, test } from './fixtures/test';

test.describe('LIVE-1 · mount-time hydration', () => {
  test('the table backfills the log and the tracker with no socket at all', async ({
    page,
    world,
  }) => {
    await blockWebSockets(page);
    await signInWithToken(page, world.gm);

    await page.goto(`/c/${world.campaignId}/table`);

    const log = page.getByRole('region', { name: 'Session log' });
    const tracker = page.getByRole('region', { name: 'Initiative tracker' });

    // The roll went on the record BEFORE this browser existed (see harness
    // `arrange`), so it can only be here because the page asked for it.
    await expect(log.getByText(world.seededRoll.actorName).first()).toBeVisible();
    await expect(log.getByText(world.seededRoll.label).first()).toBeVisible();
    await expect(log.getByText('The log is empty')).toHaveCount(0);

    await expect(tracker.getByText('No combatants yet')).toHaveCount(0);
    await expect(tracker.getByText('No live encounter')).toHaveCount(0);
    for (const name of world.publicCombatants.slice(0, 3)) {
      await expect(tracker.getByText(name).first()).toBeVisible();
    }

    // The fight is running, and says so: an encounter that reads TURN 0 / PASS
    // 0 for its whole first turn is BUILD_REPORT #6.
    await expect(tracker.getByText(/TURN \d+ · PASS \d+/)).toBeVisible();
    await expect(tracker.getByText('TURN 0')).toHaveCount(0);
    await expect(tracker.getByText('PASS 0')).toHaveCount(0);

    // Proof the test is about the socket-less path rather than a socket that
    // quietly worked: the app really did try to open one, and got nothing.
    expect((await socketAttempts(page)).length).toBeGreaterThan(0);
  });

  test('a refresh mid-session comes back to the same world', async ({ page, world }) => {
    await blockWebSockets(page);
    await signInWithToken(page, world.gm);
    await page.goto(`/c/${world.campaignId}/table`);

    const log = page.getByRole('region', { name: 'Session log' });
    await expect(log.getByText(world.seededRoll.actorName).first()).toBeVisible();

    await page.reload();

    const logAfter = page.getByRole('region', { name: 'Session log' });
    const trackerAfter = page.getByRole('region', { name: 'Initiative tracker' });
    await expect(logAfter.getByText(world.seededRoll.actorName).first()).toBeVisible();
    await expect(logAfter.getByText('The log is empty')).toHaveCount(0);
    await expect(trackerAfter.getByText('No combatants yet')).toHaveCount(0);
    const first = world.publicCombatants[0];
    if (first) await expect(trackerAfter.getByText(first).first()).toBeVisible();
  });

  /**
   * The counterfactual, so the two tests above cannot pass vacuously: cut the
   * REST reads as well and the same screen must go blank. If the roll and the
   * roster still appeared here, they were arriving by some other route and
   * these specs would not be testing hydration at all.
   */
  test('with the REST reads cut too, the screen is honestly empty', async ({ page, world }) => {
    await blockWebSockets(page);
    await signInWithToken(page, world.gm);

    await page.route('**/api/campaigns/*/log*', (route) => route.abort());
    await page.route('**/api/campaigns/*/encounters*', (route) => route.abort());
    await page.route('**/api/encounters/*', (route) => route.abort());

    await page.goto(`/c/${world.campaignId}/table`);
    const log = page.getByRole('region', { name: 'Session log' });
    const tracker = page.getByRole('region', { name: 'Initiative tracker' });

    // Give the app as long as the passing tests get, then insist on nothing.
    await expect(
      log.getByText(/Loading the session log|Could not load the session log|The log is empty/),
    ).toBeVisible();
    await expect(log.getByText(world.seededRoll.actorName)).toHaveCount(0);
    for (const name of world.publicCombatants.slice(0, 3)) {
      await expect(tracker.getByText(name)).toHaveCount(0);
    }
  });

  test("a player's phone hydrates the same way, filtered", async ({ page, world }) => {
    await blockWebSockets(page);
    await signInWithToken(page, world.player);
    await page.goto(`/c/${world.campaignId}/table`);

    const log = page.getByRole('region', { name: 'Session log' });
    await expect(log.getByText(world.publicLogText)).toBeVisible();
    await expect(log.getByText('The log is empty')).toHaveCount(0);

    const tracker = page.getByRole('region', { name: 'Initiative tracker' });
    await expect(tracker.getByText('No combatants yet')).toHaveCount(0);
  });
});
