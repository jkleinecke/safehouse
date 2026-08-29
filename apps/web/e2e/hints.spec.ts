/**
 * FR10.10 — a tactical hint on the acting NPC's turn: optional, off by
 * default, GM-only, and never a control.
 *
 * The FR's three adjectives are each a different failure, and the third is the
 * one that needs a browser. "GM-only" here is Principle 4, not CSS: the line
 * names what the opposition is about to do, so a player device must never
 * *receive* it. `services/tactical-hints.ts` withholds it server-side and the
 * quick-roll route it rides on is GM-scoped — but "the payload is filtered" and
 * "the phone in the player's hand does not contain the sentence" are different
 * claims, and only the second is the one that matters at a table where someone
 * can lean over and look.
 *
 * So the spec reads the whole of a player's document and demands the sentence
 * is absent from it, having first proved the GM is looking at exactly that
 * sentence on the same fight, on the same server, one moment earlier.
 *
 * The hint text is never hard-coded. It is read back from the server's own
 * answer and then looked for on screen, so a rewrite of the copy in
 * `ROLE_HINTS` moves the spec with it instead of breaking it — what is pinned
 * is that the GM sees what the server sent and the player sees none of it.
 *
 * The acting row is arranged, not hoped for: `fixtures/harness.ts` builds the
 * fight from the generator (the only path that records which archetype a
 * combatant came from, which is where the role tag lives) and pins that row's
 * initiative to the top. FR10.10 puts a hint on the acting NPC and nowhere
 * else, so a spec that let the dice choose the actor would be a coin toss.
 */
import type { Page } from '@playwright/test';
import { expect, joinWithCode, signInWithToken, test } from './fixtures/test';
import type { Api } from './fixtures/api';
import type { World } from './fixtures/world';

interface QuickRolls {
  hint?: { roleTag: string; text: string; why: string; advisoryOnly: boolean };
}

/** The line the server would put on that row right now, if any. */
async function serverHint(api: Api, world: World): Promise<QuickRolls['hint']> {
  const res = await api.get<QuickRolls>(
    `/api/combatants/${world.hint.combatantId}/quick-rolls`,
    world.gm.token,
  );
  return res.hint;
}

/** The hint, once the campaign flag has propagated past the rack's cache. */
async function waitForHint(api: Api, world: World): Promise<NonNullable<QuickRolls['hint']>> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const hint = await serverHint(api, world);
    if (hint) return hint;
    if (Date.now() > deadline) {
      throw new Error('the server never offered a hint for the acting NPC');
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function setHints(api: Api, world: World, enabled: boolean): Promise<void> {
  await api.patch(
    `/api/campaigns/${world.campaignId}`,
    { settings: { tacticalHints: enabled } },
    world.gm.token,
  );
}

async function openTracker(page: Page, world: World) {
  await page.goto(`/c/${world.campaignId}/table`);
  const tracker = page.getByRole('region', { name: 'Initiative tracker' });
  await expect(tracker.getByText('No combatants yet')).toHaveCount(0);
  return tracker;
}

test.describe('FR10.10 · tactical hints', () => {
  test.afterEach(async ({ api, world }) => {
    // Off is the FR's default and the state every other spec inherits.
    await setHints(api, world, false).catch(() => undefined);
  });

  test('off by default: the GM sees the toggle, and no advice until it is flipped', async ({
    page,
    api,
    world,
  }) => {
    await setHints(api, world, false);
    expect(
      await serverHint(api, world),
      'the server offered a hint with the campaign flag off',
    ).toBeUndefined();

    await signInWithToken(page, world.gm);
    const tracker = await openTracker(page, world);

    const toggle = tracker.getByRole('button', { name: /^hints (on|off)$/ });
    await expect(toggle, 'the GM has no way to turn hints on').toBeVisible();
    await expect(toggle).toHaveText('hints off');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(tracker.getByRole('note')).toHaveCount(0);

    // --- flip it, and the acting NPC's row gets one line -------------------
    await toggle.click();
    await expect(toggle).toHaveText('hints on');

    const hint = await waitForHint(api, world);
    expect(hint.advisoryOnly, 'the payload does not declare itself advisory').toBe(true);
    expect(hint.roleTag, 'the hint came from no role tag').toBeTruthy();

    const note = tracker.getByRole('note');
    await expect(note, 'the acting NPC got no hint on screen').toHaveCount(1);
    await expect(note).toContainText(hint.text);
    await expect(note).toContainText(hint.roleTag);

    // It is prose in a note, not a button. FR10.10's "never automation" is a
    // statement about the DOM as much as about the server: a tappable hint is
    // one tap from the opposition acting.
    await expect(note.getByRole('button')).toHaveCount(0);
    await expect(note.getByRole('link')).toHaveCount(0);
    await expect(note).toHaveAttribute('aria-label', /suggestion/i);
    await expect(note).toHaveAttribute('aria-label', /takes no action/i);
  });

  test("with hints on, a player's device does not contain the line at all", async ({
    browser,
    page,
    api,
    world,
  }) => {
    await setHints(api, world, true);
    const hint = await waitForHint(api, world);

    // --- the GM is looking at it right now ---------------------------------
    await signInWithToken(page, world.gm);
    const tracker = await openTracker(page, world);
    await expect(tracker.getByRole('note')).toContainText(hint.text);

    // --- and the phone at the other end of the table -----------------------
    const theirs = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await theirs.newPage();
    try {
      await joinWithCode(phone, world.codes.player);
      await phone.goto(`/c/${world.campaignId}/table`);
      await phone.getByRole('button', { name: 'Tracker' }).click();

      // Positive control: the player's tracker is populated, so the negatives
      // below are about filtering rather than about an empty screen.
      const theirTracker = phone.getByRole('region', { name: 'Initiative tracker' });
      await expect(theirTracker.getByText('No combatants yet')).toHaveCount(0);
      const first = world.publicCombatants[0];
      if (first) await expect(theirTracker.getByText(first).first()).toBeVisible();

      const html = await phone.content();
      expect(html, "the tactical hint reached a player's DOM").not.toContain(hint.text);
      expect(html, "the GM-only NPC's name reached a player's DOM").not.toContain(world.hint.name);
      await expect(
        theirTracker.getByRole('note'),
        'a player device rendered a hint note',
      ).toHaveCount(0);
    } finally {
      await theirs.close();
    }

    // The payload behind that screen was already filtered — the phone was
    // never sent the line and then told not to draw it.
    const asPlayer = await api.request<unknown>(
      'GET',
      `/api/combatants/${world.hint.combatantId}/quick-rolls`,
      { token: world.player.token, allowStatus: [401, 403, 404] },
    );
    expect(
      JSON.stringify(asPlayer),
      "the copilot rack answered a player's device with a hint",
    ).not.toContain(hint.text);
  });
});
