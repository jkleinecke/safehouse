/**
 * FR2.8 — personal macros follow the **person**, not the handset.
 *
 * BUILD_REPORT §6 put this first for a reason a spec can reproduce: the rack
 * was `localStorage`, so a player who picked up a second phone mid-fight had an
 * empty rack, and the client half of the fix (`features/sheet/macroStore.ts`)
 * sat written and dead because `GET/PUT /api/campaigns/:id/macros` did not
 * exist. Both halves are here now, and the only way to prove they meet is a
 * second browser: a unit test can mock the route, and an API test can call it,
 * but neither can tell you that a *fresh profile with empty storage* renders
 * the rack a different device made.
 *
 * So the shape is deliberately two contexts:
 *
 *   device A saves a macro  →  device B signs in as the SAME user  →  it's there
 *
 * with two counterfactuals that stop it passing for the wrong reason. Device B
 * starts with `localStorage` provably empty, so nothing it shows can be a
 * mirror it already had; and a *different* user on the same server does not see
 * the macro, so "server-backed" has not quietly become "shared with the table".
 *
 * The borrowed device is the GM's, because that is the only second-device path
 * the app has today: `POST /api/campaigns/:id/gm-pair` re-uses the existing GM
 * identity (`services/auth.ts` — "a `gm` invite is a pairing code, not a
 * sign-up"), while a player join code always mints a fresh guest. Macros are
 * keyed by user id either way, so the guarantee under test is the same one; the
 * player's own borrowed-phone story needs a route that does not exist yet, and
 * that gap is worth naming rather than faking.
 */
import type { Page } from '@playwright/test';
import { expect, homeFor, joinWithCode, signInWithToken, test } from './fixtures/test';
import type { Api } from './fixtures/api';

/** Distinctive enough that no other spec's rack or roll can be mistaken for it. */
const MACRO = { name: 'E2E kettle watch', pool: 13, limitKind: 'mental', limitValue: 4 };
const ROLL_LABEL = `Roll ${MACRO.name}, ${MACRO.pool} dice, ${MACRO.limitKind} limit ${MACRO.limitValue}`;

interface ServerMacro {
  id: string;
  name?: string;
  label?: string;
  pool: number;
}

async function serverRack(api: Api, campaignId: string, token: string): Promise<ServerMacro[]> {
  const res = await api.get<{ macros: ServerMacro[] }>(
    `/api/campaigns/${campaignId}/macros`,
    token,
  );
  return res.macros ?? [];
}

const named = (rack: ServerMacro[], name: string): boolean =>
  rack.some((m) => (m.name ?? m.label) === name);

/** Open a character sheet at the Skills tab, where the rack lives. */
async function openRack(page: Page, campaignId: string, characterId: string) {
  await page.goto(`/c/${campaignId}/sheet/${characterId}`);
  await page.getByRole('tab', { name: 'Skills' }).click();
  return page.getByRole('group', { name: 'Personal dice macros' });
}

test.describe('FR2.8 · a macro rack that follows the person', () => {
  test.afterEach(async ({ api, world }) => {
    // The rack is campaign-wide state for this user; leave the world as found
    // so a later spec's screenshot is not decorated with our test button.
    await api
      .request('PUT', `/api/campaigns/${world.campaignId}/macros`, {
        token: world.gm.token,
        body: { macros: [] },
      })
      .catch(() => undefined);
  });

  test('a macro saved on one device is in the rack on a freshly paired one', async ({
    browser,
    page,
    api,
    world,
  }) => {
    // --- device A: build the macro the way a player does ---------------------
    await signInWithToken(page, world.gm);
    const rack = await openRack(page, world.campaignId, world.playerCharacterId);

    await expect(rack.getByRole('button', { name: 'Add a dice macro' })).toBeVisible();
    await rack.getByRole('button', { name: 'Add a dice macro' }).click();
    await page.getByRole('textbox', { name: 'Macro name' }).fill(MACRO.name);
    await page.getByRole('textbox', { name: 'Dice pool' }).fill(String(MACRO.pool));
    await page.getByRole('button', { name: MACRO.limitKind, exact: true }).click();
    await page.getByRole('textbox', { name: 'Limit value' }).fill(String(MACRO.limitValue));
    await page.getByRole('button', { name: 'Save macro' }).click();

    await expect(rack.getByRole('button', { name: ROLL_LABEL })).toBeVisible();

    // It reached the server, not just this tab's cache. Until it does, the
    // rack is honest about it — "this device only" is the degraded state the
    // store falls back to, and its absence is the claim being made here.
    await expect
      .poll(() => serverRack(api, world.campaignId, world.gm.token).then((r) => named(r, MACRO.name)), {
        timeout: 15_000,
        message: 'the macro never reached GET /api/campaigns/:id/macros',
      })
      .toBe(true);
    await expect(page.getByText('this device only')).toHaveCount(0);

    // --- device B: a borrowed handset, empty profile --------------------------
    const pairing = await api.post<{ code: string }>(
      `/api/campaigns/${world.campaignId}/gm-pair`,
      {},
      world.gm.token,
    );

    const borrowed = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await borrowed.newPage();
    try {
      await phone.goto('/');
      expect(
        await phone.evaluate(() => Object.keys(window.localStorage).length),
        'the borrowed handset was supposed to start with nothing stored',
      ).toBe(0);

      await joinWithCode(phone, pairing.code);
      await phone.waitForURL(`**${homeFor(world.gm)}`);

      const borrowedRack = await openRack(phone, world.campaignId, world.playerCharacterId);
      await expect(
        borrowedRack.getByRole('button', { name: ROLL_LABEL }),
        'the second device came up with an empty rack — macros are still per-handset',
      ).toBeVisible();
      await expect(borrowedRack.getByText('No macros yet')).toHaveCount(0);

      // Same rack on the other screen that offers one: the table roller reads
      // the same store as the sheet, which is the other half of the fix.
      await phone.goto(`/c/${world.campaignId}/table`);
      const roller = phone.getByRole('region', { name: 'Dice roller' });
      await expect(
        roller.getByRole('button', { name: `${MACRO.name} · ${MACRO.pool}d6 [${MACRO.limitValue}]` }),
      ).toBeVisible();
    } finally {
      await borrowed.close();
    }
  });

  test('another person on the same server does not get the macro', async ({
    browser,
    api,
    page,
    world,
  }) => {
    // Seed the GM's rack over REST — this test is about who can see it, not
    // about the editor, which the test above already drives.
    await api.post(
      `/api/campaigns/${world.campaignId}/macros`,
      { name: MACRO.name, pool: MACRO.pool },
      world.gm.token,
    );
    expect(named(await serverRack(api, world.campaignId, world.gm.token), MACRO.name)).toBe(true);

    // The route takes identity from the token and has no `:userId` in the
    // path, so this is the whole of the check — a player asking for "macros"
    // gets their own, and there is no request shape that asks for someone
    // else's.
    expect(
      named(await serverRack(api, world.campaignId, world.player.token), MACRO.name),
      "a player's rack contained the GM's macro",
    ).toBe(false);

    const theirs = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await theirs.newPage();
    try {
      await joinWithCode(phone, world.codes.player);
      await phone.goto(`/c/${world.campaignId}/table`);
      const roller = phone.getByRole('region', { name: 'Dice roller' });
      await expect(roller).toBeVisible();
      expect(
        await phone.content(),
        "another player's browser was handed the GM's macro",
      ).not.toContain(MACRO.name);
    } finally {
      await theirs.close();
    }

    // And the GM's own page still has it, so the negative above is about
    // scoping rather than about the macro having quietly vanished.
    await signInWithToken(page, world.gm);
    const rack = await openRack(page, world.campaignId, world.playerCharacterId);
    await expect(rack.getByRole('button', { name: `Roll ${MACRO.name}, ${MACRO.pool} dice` })).toBeVisible();
  });
});
