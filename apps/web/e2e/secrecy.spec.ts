/**
 * Principle 4 / G3 / FR9.7 — hidden state is filtered SERVER-SIDE, so it is
 * not in the player's DOM at all.
 *
 * "Not rendered" is not the guarantee. The guarantee is that a player's browser
 * never *receives* the hidden sniper's name or the GM-only log line, so no
 * amount of devtools, view-source or a broken CSS rule can surface it. The
 * cheapest honest way to test that from outside is to read the whole document
 * a player's device holds and demand the secrets are absent from it — on the
 * table screen, on the map, and in the raw REST payloads behind both.
 *
 * The player here joins by scanning, exactly as at the table; the phone
 * viewport is the device the FR is written for (Principle 7).
 */
import { expect, joinWithCode, test } from './fixtures/test';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('secrecy · a player device never holds GM state', () => {
  test('the table screen carries the public log but not the GM-only line', async ({
    page,
    world,
  }) => {
    await joinWithCode(page, world.codes.player);
    await page.goto(`/c/${world.campaignId}/table`);

    // Positive control: the log really is rendering, so the negatives below
    // are about filtering rather than about an empty page.
    await expect(page.getByText(world.publicLogText)).toBeVisible();

    const html = await page.content();
    expect(html, 'a GM-only log line reached a player DOM').not.toContain(world.gmOnlyLogText);
    for (const hidden of world.hiddenTokenNames) {
      expect(html, `hidden token "${hidden}" reached a player DOM`).not.toContain(hidden);
    }
  });

  test('the tracker shows public combatants and no hidden ones', async ({ page, world }) => {
    await joinWithCode(page, world.codes.player);
    await page.goto(`/c/${world.campaignId}/table`);

    // The phone shows one pane at a time; the tracker is behind its chip.
    await page.getByRole('button', { name: 'Tracker' }).click();
    const tracker = page.getByRole('region', { name: 'Initiative tracker' });
    await expect(tracker.getByText('No combatants yet')).toHaveCount(0);

    const html = await page.content();
    for (const hidden of world.hiddenTokenNames) {
      expect(html, `hidden combatant "${hidden}" reached a player DOM`).not.toContain(hidden);
    }
  });

  test('the grid never holds a hidden token', async ({ page, world }) => {
    await joinWithCode(page, world.codes.player);
    await page.goto(`/c/${world.campaignId}/grid`);
    await page.waitForLoadState('networkidle');

    const html = await page.content();
    expect(html.length, 'the grid rendered nothing at all — the check would be vacuous').toBeGreaterThan(
      500,
    );
    for (const hidden of world.hiddenTokenNames) {
      expect(html, `hidden token "${hidden}" reached a player's grid`).not.toContain(hidden);
    }
  });

  test('the payloads behind those screens are already filtered', async ({ api, world }) => {
    // Same reads the SPA makes, with a player's own token.
    const log = await api.get<{ events: { payload: unknown }[] }>(
      `/api/campaigns/${world.campaignId}/log?limit=200`,
      world.player.token,
    );
    const logText = JSON.stringify(log.events);
    expect(logText).toContain(world.publicLogText);
    expect(logText, 'the GM-only line crossed the wire to a player').not.toContain(
      world.gmOnlyLogText,
    );

    const scene = await api.get<{ tokens: { name: string; x?: number; y?: number }[] }>(
      `/api/scenes/${world.sceneId}`,
      world.player.token,
    );
    const sceneText = JSON.stringify(scene.tokens);
    for (const hidden of world.hiddenTokenNames) {
      expect(sceneText, `hidden token "${hidden}" crossed the wire to a player`).not.toContain(
        hidden,
      );
    }

    const encounter = await api.get<{ combatants: { name: string }[] }>(
      `/api/encounters/${world.encounterId}`,
      world.player.token,
    );
    const encText = JSON.stringify(encounter.combatants);
    for (const hidden of world.hiddenTokenNames) {
      expect(encText, `hidden combatant "${hidden}" crossed the wire to a player`).not.toContain(
        hidden,
      );
    }
  });
});
