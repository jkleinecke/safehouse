/**
 * FR1.1/1.2 — a GM signs in through the app.
 *
 * BUILD_REPORT gap #2: `join-qr` refuses `role=gm` by construction, so a GM
 * whose laptop was not the one that ran the bootstrap had no path in at all.
 * The documented workaround was to open devtools and hand-write
 * `localStorage['safehouse.session']`. This spec exists to keep that
 * workaround dead: every step below is a click or a keystroke in the UI, in a
 * browser profile that starts with empty storage.
 *
 * The flow it walks is the real one: the GM console mints a single-use pairing
 * code, and a second machine redeems it on the front door.
 */
import { expect, homeFor, signInWithToken, test } from './fixtures/test';

test.describe('GM sign-in', () => {
  test('a fresh profile pairs a GM machine with a code minted in the console', async ({
    browser,
    page,
    world,
  }) => {
    // --- the console that is already signed in mints the code --------------
    await signInWithToken(page, world.gm);
    await page.goto(`/c/${world.campaignId}/gm`);
    await page.getByRole('button', { name: /pairing code/i }).click();
    await expect(page.getByText('Pairing code — single use')).toBeVisible();

    const shown = await page.locator('body').innerText();
    const code = /\/join\/([A-Z0-9]{4,})/.exec(shown)?.[1];
    expect(code, 'the pairing panel showed no join URL to read a code out of').toBeTruthy();

    // --- a second machine, empty storage, types it on the front door -------
    const fresh = await browser.newContext();
    const laptop = await fresh.newPage();
    try {
      await laptop.goto('/');
      expect(
        await laptop.evaluate(() => Object.keys(window.localStorage).length),
        'the fresh profile was supposed to start empty',
      ).toBe(0);

      await laptop.getByRole('tab', { name: 'Pair this device' }).click();
      await laptop.getByRole('textbox', { name: /join or pairing code/i }).fill(code!);
      await laptop.getByRole('button', { name: 'pair this device' }).click();

      await laptop.waitForURL(`**${homeFor(world.gm)}`);
      await expect(laptop.getByRole('heading', { name: world.campaignName })).toBeVisible();

      // It is a GM device: the console's own controls are there. (The header's
      // QR button carries the name as an aria-label; the console body repeats
      // the words as text, so match the label rather than the role name.)
      await expect(laptop.getByLabel('Show join QR', { exact: true })).toBeVisible();

      // And it kept the session across a reload, with nothing typed twice.
      await laptop.reload();
      await expect(laptop).toHaveURL(new RegExp(`/c/${world.campaignId}`));
    } finally {
      await fresh.close();
    }
  });

  test('the front door offers all three sign-in paths and is honest about a taken server', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('tab', { name: 'Pair this device' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Start a campaign' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Paste a token' })).toBeVisible();

    // This server already has a table, so bootstrap must fail in plain words
    // rather than 401-ing into a blank screen.
    await page.getByRole('tab', { name: 'Start a campaign' }).click();
    await page.getByRole('textbox', { name: /campaign name/i }).fill('A second table');
    await page.getByRole('button', { name: 'start a new campaign' }).click();
    await expect(page.getByRole('alert')).toContainText(/already has a campaign/i);
  });

  test('a nonsense code is rejected before it reaches the server', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pair this device' }).click();
    await page.getByRole('textbox', { name: /join or pairing code/i }).fill('!!');
    await page.getByRole('button', { name: 'pair this device' }).click();
    await expect(page.getByRole('alert')).toContainText(/does not look like a join code/i);
  });
});
