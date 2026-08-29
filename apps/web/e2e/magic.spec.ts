/**
 * M8 at the table — FR8.3 spirit services and FR8.4 bonded foci, driven from a
 * phone.
 *
 * These were the two largest holes in a module the table uses every session
 * (BUILD_REPORT §6 items 4 and 6): the summoner's services lived in a note and
 * `get_magic_state` had to admit `tracked: false`. Both are real state now, and
 * both make a claim that only a browser can check.
 *
 * **Services.** "Spend a service" is optimistic — the count drops on screen
 * before the server has answered. That is right at a table and wrong in a test
 * that stops there: an optimistic decrement over a failing write looks
 * identical for about a second. So every count here is checked three ways —
 * on the screen, on the server's own read, and on the screen again after a
 * reload that can only have come from the server.
 *
 * **Foci.** FR8.4's whole point is that the toggle is *not cosmetic*: flipping
 * a bonded focus changes a derived pool, and that pool's receipt names the
 * focus (Principle 3). Two numbers and a sentence have to move together, and
 * they are produced by different layers — the modifier pipeline in
 * `@safehouse/rules`, composed server-side by `services/magic-derive.ts`,
 * rendered by `FociRack`. A unit test can pin any one of them; only the running
 * app shows that the mage sees all three agree.
 *
 * The device is Whisper's own phone: the demo campaign's mage owns a bound
 * spirit with services to spend and a bonded power focus feeding spellcasting,
 * seeded through the magic routes precisely so this is possible.
 */
import type { Page } from '@playwright/test';
import { expect, signInWithToken, test } from './fixtures/test';
import type { Api } from './fixtures/api';
import type { World } from './fixtures/world';

test.use({ viewport: { width: 390, height: 844 } });

interface SpiritDto {
  id: string;
  name: string;
  spiritType: string;
  force: number;
  bound: boolean;
  status: string;
  services: number;
  servicesInitial: number;
}
interface FocusDto {
  id: string;
  name: string;
  force: number;
  bonded: boolean;
  active: boolean;
  targets?: string[];
}
interface MagicDto {
  spirits: SpiritDto[];
  foci: FocusDto[];
}
interface PoolDto {
  total: number;
  breakdown: { label: string; value: number }[];
}

/** The campaign's magic state as this device is entitled to see it. */
function magicState(api: Api, world: World): Promise<MagicDto> {
  return api.get<MagicDto>(`/api/campaigns/${world.campaignId}/magic`, world.player.token);
}

/** The mage's pools with the rack folded in — the server's own answer. */
async function spellcastingPool(api: Api, world: World): Promise<PoolDto> {
  const view = await api.get<{ derived: { pools: Record<string, PoolDto> } }>(
    `/api/characters/${world.playerCharacterId}/magic/derived`,
    world.player.token,
  );
  const pool = view.derived.pools['skill.spellcasting'];
  if (!pool) throw new Error('the demo mage has no spellcasting pool to move');
  return pool;
}

async function openMagicTab(page: Page, world: World): Promise<void> {
  await signInWithToken(page, world.player);
  await page.goto(`/c/${world.campaignId}/sheet/${world.playerCharacterId}`);
  await page.getByRole('tab', { name: 'Magic' }).click();
  // The workbench says so out loud while it is reading, so waiting for the
  // rack heading is waiting for real state rather than for zeros (LIVE-1).
  await expect(page.getByText('Reading the tracker…')).toHaveCount(0, { timeout: 20_000 });
}

/** The pool number in the "What the rack moves" strip, read off its own name. */
async function stripPool(page: Page): Promise<number> {
  const label = await page
    .getByRole('button', { name: /^spellcasting pool: \d+\./ })
    .getAttribute('aria-label');
  const m = /pool: (\d+)\./.exec(label ?? '');
  if (!m?.[1]) throw new Error(`no pool in the rack strip: ${label ?? '(none)'}`);
  return Number(m[1]);
}

test.describe('M8 · the mage at the table', () => {
  test('spending a spirit service drops the count, on screen and on the record', async ({
    page,
    api,
    world,
  }) => {
    const before = (await magicState(api, world)).spirits.find((s) => s.status === 'summoned');
    expect(before, 'the demo campaign has no summoned spirit to spend from').toBeTruthy();
    const spirit = before!;
    expect(spirit.services, 'the seeded spirit owes no services — nothing to spend').toBeGreaterThan(
      0,
    );

    await openMagicTab(page, world);

    // The chip is the count, and it carries the same thing in words for
    // anyone reading it aloud.
    //
    // Matched on the attribute rather than on the accessible NAME on purpose:
    // the label sits on a bare `<span>` (`SpiritList.tsx`), which is role
    // `generic`, and ARIA does not let a generic element take a name — so a
    // screen reader announces "2 slash 2" and nothing else today. Asserting
    // `toHaveAccessibleName` here would fail for a reason that has nothing to
    // do with FR8.3, so the intent is pinned where it actually lives and the
    // gap is reported rather than papered over.
    const chip = page.locator(`[aria-label^="${spirit.name},"]`);
    await expect(page.getByText(`${spirit.services}/${spirit.servicesInitial}`)).toBeVisible();
    await expect(chip).toHaveAttribute(
      'aria-label',
      new RegExp(`${spirit.services} of ${spirit.servicesInitial} services left`),
    );

    await page
      .getByRole('button', { name: `Spend a service from ${spirit.name}, ${spirit.services} left` })
      .click();

    const after = spirit.services - 1;
    await expect(
      page.getByText(`${after}/${spirit.servicesInitial}`),
      'the count on screen did not drop',
    ).toBeVisible();

    // The server agrees — the decrement is optimistic on screen, so without
    // this the test would pass over a write that failed.
    await expect
      .poll(async () => (await magicState(api, world)).spirits.find((s) => s.id === spirit.id)?.services, {
        timeout: 15_000,
        message: 'the spend never reached the server',
      })
      .toBe(after);

    // …and it survives a reload, which is the difference between state and a
    // hopeful render.
    await page.reload();
    await page.getByRole('tab', { name: 'Magic' }).click();
    await expect(page.getByText(`${after}/${spirit.servicesInitial}`)).toBeVisible();

    // Put the summoner back where the run found her.
    await api.post(
      `/api/campaigns/${world.campaignId}/magic/spirits/${spirit.id}/services`,
      { op: 'set', count: spirit.services },
      world.gm.token,
    );
  });

  test('toggling a bonded focus moves a pool AND its provenance', async ({ page, api, world }) => {
    const rack = await magicState(api, world);
    const focus = rack.foci.find((f) => f.bonded && f.active && (f.targets ?? []).length > 0);
    expect(focus, 'the demo mage has no live bonded focus to flip').toBeTruthy();
    const kettle = focus!;

    const withFocus = await spellcastingPool(api, world);
    expect(
      withFocus.breakdown.some((e) => e.label.includes(kettle.name)),
      "the server's own receipt does not name the focus (Principle 3)",
    ).toBe(true);

    await openMagicTab(page, world);
    expect(await stripPool(page), 'the rack strip disagrees with the server').toBe(withFocus.total);

    // The receipt, as the mage reads it: tap the number, see the focus in it.
    await page.getByRole('button', { name: /^spellcasting pool: \d+\./ }).click();
    const sheet = page.getByRole('dialog', { name: 'spellcasting pool' });
    await expect(sheet.getByText(new RegExp(kettle.name))).toBeVisible();
    await expect(sheet.getByText(`+${kettle.force}`).first()).toBeVisible();
    await page.keyboard.press('Escape');

    // --- flip it off -------------------------------------------------------
    await page
      .getByRole('button', {
        name: `${kettle.name} Force ${kettle.force}, active on spellcasting — activate to switch off`,
      })
      .click();

    const dimmed = withFocus.total - kettle.force;
    await expect
      .poll(() => stripPool(page), {
        timeout: 15_000,
        message: 'the pool did not move when the focus was switched off — the toggle is cosmetic',
      })
      .toBe(dimmed);
    await expect(page.getByText(/Foci — \d+ bonded, 0 burning/)).toBeVisible();

    // The receipt lost the line, not just the two dice. A pool that dropped
    // while still claiming the focus contributed would be the worse bug.
    await page.getByRole('button', { name: /^spellcasting pool: \d+\./ }).click();
    const after = page.getByRole('dialog', { name: 'spellcasting pool' });
    await expect(after.getByText(new RegExp(kettle.name))).toHaveCount(0);
    await page.keyboard.press('Escape');

    // And the server derived the same number from the same rack.
    await expect
      .poll(async () => (await spellcastingPool(api, world)).total, { timeout: 15_000 })
      .toBe(dimmed);

    // --- and back on, because the next spec inherits this table ------------
    await page
      .getByRole('button', {
        name: `${kettle.name} Force ${kettle.force}, inactive on spellcasting — activate to switch on`,
      })
      .click();
    await expect.poll(() => stripPool(page), { timeout: 15_000 }).toBe(withFocus.total);
    await expect
      .poll(async () => (await spellcastingPool(api, world)).total, { timeout: 15_000 })
      .toBe(withFocus.total);
  });
});
