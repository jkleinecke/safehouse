/**
 * A player finds an item in the books and puts it on their sheet.
 *
 * The GM's rule: how the runner came by it is worked out at the table; the
 * app keeps the inventory and provides the stats, and the stats come from
 * the books the GM seeded — never from anything shipped (§14). So the claims:
 *
 *  1. **The catalogue exists because the seeder read it.** The shared world's
 *     manufactured book (`fixtures/pdf.ts`) carries a gear table and a spell
 *     on its first printed page; `seed:books` compiled them; the summary route
 *     says so, and the search finds a pistol by part of its name.
 *  2. **A player can add it from the sheet**, from the Combat tab, and the
 *     weapon lands with the stats the table printed — accuracy, damage, AP,
 *     mode, ammo — and its page as the ref. Checked against the server's own
 *     sheet, because a row on screen is not an inventory.
 *  3. **The price is a proposal, not a charge.** Adding it with the spend
 *     ticked puts a pending nuyen entry on the ledger for the GM to approve
 *     (FR3.6) — the ledger says what was bought without deciding whether it was.
 *  4. **Removing is one tap**, and the server no longer holds it.
 */
import { expect, signInWithToken, test } from './fixtures/test';

interface SheetDto {
  weapons: Array<{ name: string; acc?: number; dv?: string; ap: number; modes: string[]; ammo?: { cap: number }; ref?: { book: string; page: number } }>;
  armor: Array<{ name: string; rating: number }>;
  spells: Array<{ name: string; drain?: string }>;
}
interface LedgerEntry {
  currency: string;
  delta: number;
  reason: string;
  state: string;
}

test.describe('the catalogue', () => {
  test('is read out of the seeded book, and a search finds a pistol', async ({ api, world }) => {
    const summary = await api.get<{ total: number; books: Array<{ code: string; items: number; byKind: Record<string, number> }> }>(
      '/api/catalogue/summary',
      world.player.token,
    );
    const core = summary.books.find((b) => b.code === 'SR5');
    expect(core, 'the manufactured SR5 stand-in is on the shelf').toBeTruthy();
    expect(core!.items, 'the seeder read the table and the spell').toBeGreaterThanOrEqual(4);
    expect(core!.byKind['weapon']).toBe(2);
    expect(core!.byKind['spell']).toBe(1);

    const found = await api.get<{ hits: Array<{ name: string; kind: string; stats: Record<string, string>; cost: number | null; ref: { book: string; page: number } }> }>(
      '/api/catalogue/search?q=zap',
      world.player.token,
    );
    expect(found.hits[0]).toMatchObject({ name: 'Zap Gun', kind: 'weapon', cost: 725, ref: { book: 'SR5', page: 1 } });
    expect(found.hits[0]!.stats['DAMAGE']).toBe('8P');
  });

  test('a player adds a weapon from the Combat tab, proposes the spend, and can remove it again', async ({ page, api, world }) => {
    const sheetUrl = `/api/characters/${world.playerCharacterId}`;
    const before = (await api.get<{ sheet: SheetDto }>(sheetUrl, world.player.token)).sheet;
    expect(before.weapons.some((w) => w.name === 'Zap Gun'), 'the demo runner does not already own it').toBe(false);
    const ledgerBefore = (await api.get<{ entries: LedgerEntry[] }>(`${sheetUrl}/ledger`, world.player.token)).entries.length;

    await signInWithToken(page, world.player);
    await page.goto(`/c/${world.campaignId}/sheet/${world.playerCharacterId}`);
    await page.getByRole('tab', { name: 'Combat' }).click();
    await page.getByTestId('add-weapon-open').click();
    await expect(page.getByTestId('add-weapon-dialog')).toBeVisible();
    await page.getByLabel('Search the books for weapons').fill('zap');
    const hit = page.getByTestId('add-weapon-hit').first();
    await expect(hit).toContainText('Zap Gun', { timeout: 10_000 });
    await expect(hit).toContainText('acc 5 (7)');
    await expect(hit).toContainText('725¥');
    await expect(page.getByTestId('add-weapon-spend')).toBeChecked();
    await page.getByRole('button', { name: 'Add Zap Gun to the sheet' }).click();
    await expect(page.getByTestId('add-weapon-note')).toContainText('725¥ proposed on the ledger');

    // --- what the server actually holds ------------------------------------
    await expect
      .poll(async () => (await api.get<{ sheet: SheetDto }>(sheetUrl, world.player.token)).sheet.weapons.find((w) => w.name === 'Zap Gun') ?? null, {
        message: 'the weapon must reach the sheet on the server',
      })
      .toMatchObject({ acc: 5, dv: '8P', ap: -1, modes: ['SA'], ammo: { cap: 15 }, ref: { book: 'SR5', page: 1 } });
    await expect
      .poll(async () => (await api.get<{ entries: LedgerEntry[] }>(`${sheetUrl}/ledger`, world.player.token)).entries, {
        message: 'the spend must be on the ledger, pending',
      })
      .toEqual(expect.arrayContaining([expect.objectContaining({ currency: 'nuyen', delta: -725, state: 'pending', reason: expect.stringContaining('Zap Gun') })]));
    expect((await api.get<{ entries: LedgerEntry[] }>(`${sheetUrl}/ledger`, world.player.token)).entries.length).toBe(ledgerBefore + 1);

    // --- and the sheet shows it, with an attack button per mode --------------
    await page.keyboard.press('Escape');
    await expect(page.getByText('Zap Gun', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Zap Gun — SA/ }).or(page.getByRole('button', { name: /Zap Gun/ }).first())).toBeVisible();

    // --- one tap removes it ---------------------------------------------------
    await page.getByRole('button', { name: 'remove Zap Gun' }).click();
    await expect
      .poll(async () => (await api.get<{ sheet: SheetDto }>(sheetUrl, world.player.token)).sheet.weapons.some((w) => w.name === 'Zap Gun'), {
        message: 'removing must reach the server',
      })
      .toBe(false);
  });

  test('a spell lands on the Magic tab with its drain code', async ({ page, api, world }) => {
    const sheetUrl = `/api/characters/${world.playerCharacterId}`;
    await signInWithToken(page, world.player);
    await page.goto(`/c/${world.campaignId}/sheet/${world.playerCharacterId}`);
    await page.getByRole('tab', { name: 'Magic' }).click();
    await page.getByTestId('add-spell-open').click();
    await page.getByLabel('Search the books for spells').fill('stone');
    await expect(page.getByTestId('add-spell-hit').first()).toContainText('Stone Fist', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Add Stone Fist to the sheet' }).click();
    await expect
      .poll(async () => (await api.get<{ sheet: SheetDto }>(sheetUrl, world.player.token)).sheet.spells.find((s) => s.name === 'Stone Fist') ?? null)
      .toMatchObject({ drain: 'F-3' });
    // Tidy: the shared world is everyone's.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'remove Stone Fist' }).click();
    await expect.poll(async () => (await api.get<{ sheet: SheetDto }>(sheetUrl, world.player.token)).sheet.spells.some((s) => s.name === 'Stone Fist')).toBe(false);
  });
});

test.describe('creating items', () => {
  test('the GM writes a weapon onto a player\'s sheet, and acquires armor for them from the books', async ({ page, api, world }) => {
    const sheetUrl = `/api/characters/${world.playerCharacterId}`;
    await signInWithToken(page, world.gm);
    await page.goto(`/c/${world.campaignId}/sheet/${world.playerCharacterId}`);
    await page.getByRole('tab', { name: 'Combat' }).click();

    // --- write your own ---------------------------------------------------
    await page.getByTestId('add-weapon-open').click();
    await page.getByTestId('add-weapon-custom-open').click();
    const form = page.getByTestId('add-weapon-custom');
    await form.getByLabel('Item name').fill('Dockside Slugthrower');
    await form.getByLabel('Table').fill('heavy pistols');
    await form.getByLabel('Accuracy', { exact: true }).fill('4');
    await form.getByLabel('Damage', { exact: true }).fill('7P');
    await form.getByLabel('AP', { exact: true }).fill('-1');
    await form.getByLabel('Modes', { exact: true }).fill('SA / BF');
    await form.getByLabel('Ammo', { exact: true }).fill('12 (c)');
    await form.getByLabel('Cost in nuyen').fill('300');
    await page.getByTestId('add-weapon-custom-add').click();
    await expect(page.getByTestId('add-weapon-note')).toContainText('added Dockside Slugthrower');
    await expect(page.getByTestId('add-weapon-note')).toContainText('recorded on the ledger');
    await expect
      .poll(async () => (await api.get<{ sheet: SheetDto }>(sheetUrl, world.gm.token)).sheet.weapons.find((w) => w.name === 'Dockside Slugthrower') ?? null, {
        message: 'the GM\'s weapon must reach the player\'s sheet',
      })
      .toMatchObject({ acc: 4, dv: '7P', ap: -1, modes: ['SA', 'BF'], ammo: { cap: 12 } });
    // The GM's spend is recorded, not proposed.
    await expect
      .poll(async () => (await api.get<{ entries: LedgerEntry[] }>(`${sheetUrl}/ledger`, world.gm.token)).entries.find((e) => e.reason.includes('Dockside Slugthrower')) ?? null)
      .toMatchObject({ currency: 'nuyen', delta: -300, state: 'approved' });

    // --- and from the books, as the GM ---------------------------------------
    await page.keyboard.press('Escape');
    await page.getByTestId('add-armor-open').click();
    await page.getByLabel('Search the books for armor').fill('crate');
    await expect(page.getByTestId('add-armor-hit').first()).toContainText('Crate Coat', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Add Crate Coat to the sheet' }).click();
    await expect
      .poll(async () => (await api.get<{ sheet: SheetDto }>(sheetUrl, world.gm.token)).sheet.armor.find((a) => a.name === 'Crate Coat') ?? null)
      .toMatchObject({ rating: 9 });

    // --- tidy: the shared world is everyone's --------------------------------
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'remove Dockside Slugthrower' }).click();
    await page.getByRole('button', { name: 'remove Crate Coat' }).click();
    await expect.poll(async () => (await api.get<{ sheet: SheetDto }>(sheetUrl, world.gm.token)).sheet.weapons.some((w) => w.name === 'Dockside Slugthrower')).toBe(false);
    await expect.poll(async () => (await api.get<{ sheet: SheetDto }>(sheetUrl, world.gm.token)).sheet.armor.some((a) => a.name === 'Crate Coat')).toBe(false);
  });

  test('a player writes their own gear, with a page of their own choosing', async ({ page, api, world }) => {
    const sheetUrl = `/api/characters/${world.playerCharacterId}`;
    await signInWithToken(page, world.player);
    await page.goto(`/c/${world.campaignId}/sheet/${world.playerCharacterId}`);
    await page.getByRole('tab', { name: 'Gear' }).click();
    await page.getByTestId('add-gear-open').click();
    await page.getByTestId('add-gear-custom-open').click();
    const form = page.getByTestId('add-gear-custom');
    await form.getByLabel('Item name').fill('Lockpick set');
    await form.getByLabel('Rating', { exact: true }).fill('4');
    await form.getByLabel('Book code').fill('SR5');
    await form.getByLabel('Printed page').fill('449');
    await page.getByTestId('add-gear-custom-add').click();
    await expect(page.getByTestId('add-gear-note')).toContainText('added Lockpick set');
    await expect
      .poll(async () => (await api.get<{ sheet: { gear: Array<{ name: string; qty: number; rating?: number; ref?: { book: string; page: number } }> } }>(sheetUrl, world.player.token)).sheet.gear.find((g) => g.name === 'Lockpick set') ?? null)
      .toMatchObject({ qty: 1, rating: 4, ref: { book: 'SR5', page: 449 } });
    await page.keyboard.press('Escape');
    await expect(page.getByText('Lockpick set', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'remove Lockpick set' }).click();
    await expect.poll(async () => (await api.get<{ sheet: { gear: Array<{ name: string }> } }>(sheetUrl, world.player.token)).sheet.gear.some((g) => g.name === 'Lockpick set')).toBe(false);
  });
});
