/**
 * LIVE-2 — one authority for the active scene's environment modifier.
 *
 * Found at the table: the sheet showed Perception 5, the roll dialog offered
 * "Roll 4d6", and the persisted receipt carried
 * `environment: light 1 → light (-1) -1` TWICE. The server's derived pool
 * already folds the scene in (FR9.11); the client was re-sending it as a
 * removable situational chip on top.
 *
 * So this spec walks the three places the same number appears and demands they
 * agree — sheet chip, dialog dice count, persisted `request.pool` — and then
 * reads the receipt to prove the scene line is in it exactly once.
 *
 * The demo scene is deliberately dim (`light: 1`), so the modifier under test
 * is really there; the spec asserts that first, otherwise it would pass
 * vacuously on a bright map.
 */
import { expect, poolFromLabel, diceFromButton, signInWithToken, test } from './fixtures/test';
import type { PersistedRoll } from './fixtures/api';

const SKILL = 'perception';

test.describe('LIVE-2 · pool parity', () => {
  test('sheet pool = dialog dice = persisted pool, and the scene lands once', async ({
    page,
    api,
    world,
  }) => {
    expect(
      world.sceneLight,
      'the demo scene must be dim, or there is no environment modifier to double-apply',
    ).toBeGreaterThan(0);

    // What the server itself derives — the number the sheet is meant to show.
    const derived = await api.get<{
      derived: { pools: Record<string, { total: number; breakdown: { source?: string }[] }> };
    }>(`/api/characters/${world.playerCharacterId}/derived`, world.player.token);
    const serverPool = derived.derived.pools[`skill.${SKILL}`];
    expect(serverPool, `${world.playerAlias} has no ${SKILL} pool`).toBeTruthy();
    expect(
      serverPool!.breakdown.filter((b) => b.source === 'scene').length,
      'the derived pool should already carry the scene, exactly once',
    ).toBe(1);

    const before = await listRollIds(api, world.campaignId, world.player.token);

    await signInWithToken(page, world.player);
    await page.goto(`/c/${world.campaignId}/sheet/${world.playerCharacterId}`);

    // 1 — the sheet
    const row = page.getByRole('button', { name: new RegExp(`^Roll ${SKILL},`, 'i') });
    await expect(row).toBeVisible();
    const sheetPool = poolFromLabel(await row.getAttribute('aria-label'));
    expect(sheetPool).toBe(serverPool!.total);

    // 2 — the dialog
    await row.click();
    const rollButton = page.getByRole('button', { name: /^Roll \d+d6$/ });
    await expect(rollButton).toBeVisible();
    const dialogDice = diceFromButton(await rollButton.textContent());
    expect(
      dialogDice,
      'the roll dialog offered a different number of dice than the sheet shows (LIVE-2)',
    ).toBe(sheetPool);

    // The scene is shown as CONTEXT, exactly once, and never as a chip: the
    // removable chip is precisely what applied the penalty a second time.
    const applied = page.getByText('Already in this pool');
    await expect(applied).toBeVisible();
    const appliedLines = applied.locator('xpath=following-sibling::ul[1]/li');
    await expect(appliedLines).toHaveCount(1);
    await expect(appliedLines.first()).toContainText(/light|visibility|glare|wind/i);

    const chipGroup = page.getByRole('group', { name: 'Situational modifiers' });
    if ((await chipGroup.count()) > 0) {
      await expect(
        chipGroup.getByRole('button', { name: /light|environment|visibility|glare|wind/i }),
        'the scene is being offered as a situational chip again (LIVE-2)',
      ).toHaveCount(0);
    }

    // 3 — the record
    await rollButton.click();
    const roll = await waitForNewRoll(api, world.campaignId, world.player.token, before);

    expect(roll.request.pool, 'the persisted pool disagreed with the dialog').toBe(sheetPool);
    expect(roll.faces.length, 'the server rolled a different number of dice').toBe(sheetPool);

    const sceneLines = roll.request.breakdown.filter((b) => b.source === 'scene');
    expect(
      sceneLines.length,
      `the receipt names the scene ${sceneLines.length} times: ${sceneLines
        .map((l) => `${l.label} ${l.value}`)
        .join(' | ')}`,
    ).toBe(1);

    // No line of the receipt is a duplicate of another — the shape the live
    // bug took ("environment: light 1 → light (-1) -1" printed twice).
    const seen = roll.request.breakdown.map((b) => `${b.label}=${b.value}`);
    expect(new Set(seen).size, `duplicated receipt lines: ${seen.join(' | ')}`).toBe(seen.length);
  });

  test('a situational bump still reaches the server, so parity is not just inertia', async ({
    page,
    api,
    world,
  }) => {
    const before = await listRollIds(api, world.campaignId, world.player.token);

    await signInWithToken(page, world.player);
    await page.goto(`/c/${world.campaignId}/sheet/${world.playerCharacterId}`);

    const row = page.getByRole('button', { name: new RegExp(`^Roll ${SKILL},`, 'i') });
    const sheetPool = poolFromLabel(await row.getAttribute('aria-label'));
    await row.click();

    await page.getByRole('button', { name: 'increase situational modifier' }).click();
    const rollButton = page.getByRole('button', { name: /^Roll \d+d6$/ });
    expect(diceFromButton(await rollButton.textContent())).toBe(sheetPool + 1);

    await rollButton.click();
    const roll = await waitForNewRoll(api, world.campaignId, world.player.token, before);
    expect(roll.request.pool).toBe(sheetPool + 1);
    expect(roll.request.breakdown.filter((b) => b.source === 'scene').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------

async function listRollIds(
  api: { get<T>(p: string, t?: string): Promise<T> },
  campaignId: string,
  token: string,
): Promise<Set<string>> {
  const page = await api.get<{ rolls: PersistedRoll[] }>(
    `/api/campaigns/${campaignId}/rolls?limit=50`,
    token,
  );
  return new Set(page.rolls.map((r) => r.id));
}

async function waitForNewRoll(
  api: { get<T>(p: string, t?: string): Promise<T> },
  campaignId: string,
  token: string,
  before: Set<string>,
): Promise<PersistedRoll> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = await api.get<{ rolls: PersistedRoll[] }>(
      `/api/campaigns/${campaignId}/rolls?limit=50`,
      token,
    );
    const fresh = page.rolls.find((r) => !before.has(r.id));
    if (fresh) return fresh;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no new roll reached the server within 15 s');
}
