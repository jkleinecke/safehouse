/**
 * G1 with a keyboard — a roll from the sheet with no pointer at all.
 *
 * Found live: every skill row was a click-handler `<div>`. A screen reader saw
 * a column of unlabelled boxes and a keyboard-only user could not roll at all,
 * which is a hard accessibility failure on the app's single most-used control.
 * The rows are real `<button>`s now, each carrying its pool in its accessible
 * name, and the dialog lands focus on the thing you came for.
 *
 * The spec therefore only ever presses keys: Tab to the row, Enter to open,
 * Enter to roll — and then checks the server actually recorded it, because a
 * focus ring that does nothing is not a keyboard path.
 */
import { expect, diceFromButton, poolFromLabel, signInWithToken, test } from './fixtures/test';
import type { PersistedRoll } from './fixtures/api';

const SKILL = 'perception';
const MAX_TABS = 80;

test('a roll can be made from the sheet using only the keyboard', async ({ page, api, world }) => {
  const before = new Set(
    (
      await api.get<{ rolls: PersistedRoll[] }>(
        `/api/campaigns/${world.campaignId}/rolls?limit=50`,
        world.player.token,
      )
    ).rolls.map((r) => r.id),
  );

  await signInWithToken(page, world.player);
  await page.goto(`/c/${world.campaignId}/sheet/${world.playerCharacterId}`);
  await expect(page.getByRole('button', { name: new RegExp(`^Roll ${SKILL},`, 'i') })).toBeVisible();

  // --- Tab until the skill row has focus -----------------------------------
  const wanted = new RegExp(`^Roll ${SKILL},`, 'i');
  let label: string | null = null;
  for (let i = 0; i < MAX_TABS; i += 1) {
    await page.keyboard.press('Tab');
    label = await focusedName(page);
    if (label && wanted.test(label)) break;
    label = null;
  }
  expect(label, `${MAX_TABS} tab stops never reached the ${SKILL} row`).toBeTruthy();

  const sheetPool = poolFromLabel(label);

  // --- Enter opens the dialog, focus lands on the roll button ---------------
  await page.keyboard.press('Enter');
  const rollButton = page.getByRole('button', { name: /^Roll \d+d6$/ });
  await expect(rollButton).toBeVisible();
  await expect(rollButton).toBeFocused();

  const dice = diceFromButton(await rollButton.textContent());
  expect(dice, 'the keyboard path must offer the same dice as the sheet (LIVE-2)').toBe(sheetPool);

  // The reader is told the dice count without a pointer anywhere near it.
  await expect(page.getByRole('status')).toContainText(`${dice} dice`);

  // --- Enter rolls ----------------------------------------------------------
  await page.keyboard.press('Enter');

  const deadline = Date.now() + 15_000;
  let landed: PersistedRoll | undefined;
  while (Date.now() < deadline && !landed) {
    const rolls = (
      await api.get<{ rolls: PersistedRoll[] }>(
        `/api/campaigns/${world.campaignId}/rolls?limit=50`,
        world.player.token,
      )
    ).rolls;
    landed = rolls.find((r) => !before.has(r.id));
    if (!landed) await new Promise((r) => setTimeout(r, 250));
  }
  expect(landed, 'the keyboard roll never reached the server').toBeTruthy();
  expect(landed!.request.pool).toBe(sheetPool);
  expect(landed!.faces.length).toBe(sheetPool);
});

test('every skill row is a real control with a spoken name', async ({ page, world }) => {
  await signInWithToken(page, world.player);
  await page.goto(`/c/${world.campaignId}/sheet/${world.playerCharacterId}`);

  const rows = page.getByRole('button', { name: /^Roll .+, pool \d+/ });
  await expect(rows.first()).toBeVisible();
  expect(await rows.count(), 'the sheet exposed no named roll rows').toBeGreaterThan(1);

  // Every one of them is a <button>, not a div with a click handler.
  const tags = await rows.evaluateAll((els) => els.map((e) => e.tagName));
  expect(new Set(tags)).toEqual(new Set(['BUTTON']));
});

/** The accessible name of whatever currently has focus. */
async function focusedName(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? null;
  });
}
