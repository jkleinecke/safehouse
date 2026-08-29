/**
 * LOG-1 — a roll made at the table reaches the table's log, and survives F5.
 *
 * The hydration spec (LIVE-1) proves the log BACKFILLS what was already on the
 * record. This one proves the other half, which nothing checked: that a write
 * made from this browser, right now, lands on the log at all.
 *
 * They are separate failures because they are separate writes. `POST /api/rolls`
 * commits a row to `rolls` and then appends a `roll.created` event to
 * `ws_events`; only the second one is the log. When the append is the thing
 * that is broken, the record fills up normally — `GET /api/campaigns/:id/rolls`
 * lists every roll with the right pool and the right faces — while the shared
 * log sits frozen on whatever the seeder wrote. On a seeded campaign that is
 * the whole of FR2.9 dead, and every API-level check still passes, because
 * they all read the record.
 *
 * So the shape here is deliberately end to end and deliberately doubled:
 *
 *   roll from the composer  →  it renders in the log  →  RELOAD  →  still there
 *
 * The reload is the load-bearing half. A roll that only ever appears live could
 * be a socket frame the page never persisted; one that is still on screen after
 * a fresh mount can only have come back out of `GET /api/campaigns/:id/log`,
 * which means the append really happened. Append and hydration are checked
 * together because at the table they are one thing: "is it in the log?"
 *
 * The campaign is the SEEDED one (the fixture's world is `seed:demo`, written
 * by a process that has since exited), which is the posture the failure needs —
 * a directory that arrived carrying events rather than one this run created.
 */
import { expect, signInWithToken, test } from './fixtures/test';
import type { Api, PersistedRoll } from './fixtures/api';

/** Distinctive: nothing the seed or the other specs roll comes near it. */
const POOL = 23;
const TALK = 'LOG-1: the crane brakes let go somewhere north of the freight door.';

test.describe('LOG-1 · a write made at the table reaches the table log', () => {
  test('a roll from the composer renders its pool and hits, and is still there after a reload', async ({
    page,
    api,
    world,
  }) => {
    const before = await rollIds(api, world.campaignId, world.gm.token);

    await signInWithToken(page, world.gm);
    await page.goto(`/c/${world.campaignId}/table`);

    const roller = page.getByRole('region', { name: 'Dice roller' });
    const log = page.getByRole('region', { name: 'Session log' });
    await expect(roller).toBeVisible();

    // Rolling is what a GM does: type a pool, press the button. The dice are
    // the server's (G5) — the browser only ever asks.
    await roller.getByRole('spinbutton', { name: 'Pool' }).fill(String(POOL));
    await roller.getByRole('button', { name: `Roll ${POOL}d6` }).click();

    // What the server actually recorded, so the screen is checked against the
    // record rather than against itself.
    const roll = await waitForNewRoll(api, world.campaignId, world.gm.token, before);
    expect(roll.request.pool, 'the server rolled a different pool than the composer asked for').toBe(POOL);

    // The event that IS the log. This is the write that used to 500 while the
    // roll above committed anyway — the half-commit.
    const logged = await waitForLogEvent(api, world.campaignId, world.gm.token, roll.id);
    expect(
      logged,
      'the roll is on the record but no roll.created event ever reached the log',
    ).toBeTruthy();

    // …and now the same thing, on screen.
    const card = log.locator('article').filter({ hasText: `pool ${POOL} — provenance` });
    await expect(card, 'the roll never rendered in the log feed').toHaveCount(1);
    await expect(card.getByText(hitsText(roll)), 'the card shows a different hit count than the server recorded').toHaveCount(1);
    await expect(log.getByText('The log is empty')).toHaveCount(0);

    // The reload: everything on screen after this came back over REST.
    await page.reload();

    const logAfter = page.getByRole('region', { name: 'Session log' });
    const cardAfter = logAfter.locator('article').filter({ hasText: `pool ${POOL} — provenance` });
    await expect(
      cardAfter,
      'the roll was live-only — it did not survive a refresh, so it never reached the log',
    ).toHaveCount(1);
    await expect(cardAfter.getByText(hitsText(roll))).toHaveCount(1);

    // Open the receipt and prove the provenance came back with it (FR2.6) —
    // a backfilled roll has to be the same receipt, not a summary of one.
    await cardAfter.getByText(`pool ${POOL} — provenance`).click();
    await expect(cardAfter).toContainText(`+${POOL}`);
  });

  test('table talk typed into the log appends, and survives a reload too', async ({
    page,
    api,
    world,
  }) => {
    await signInWithToken(page, world.gm);
    await page.goto(`/c/${world.campaignId}/table`);

    const log = page.getByRole('region', { name: 'Session log' });
    await log.getByPlaceholder('Table talk…').fill(TALK);
    await log.getByRole('button', { name: 'Send' }).click();

    await expect(log.getByText(TALK)).toBeVisible();

    await page.reload();
    const logAfter = page.getByRole('region', { name: 'Session log' });
    await expect(
      logAfter.getByText(TALK),
      'table talk was live-only — the append never landed in ws_events',
    ).toBeVisible();

    // The server's own answer, so a cached page cannot fake this.
    const events = await api.get<{ events: { type: string; payload: Record<string, unknown> }[] }>(
      `/api/campaigns/${world.campaignId}/log?limit=200`,
      world.gm.token,
    );
    expect(events.events.some((e) => JSON.stringify(e.payload).includes('north of the freight door'))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------

/**
 * The card's hits line, anchored to the element that holds it alone.
 *
 * A loose substring match would be met by the dice faces above it — they
 * render as bare digits and run straight into the count in `textContent`
 * ("…4243" + "5 hits"), so "5 hits" is satisfied by a card showing 35.
 */
function hitsText(roll: PersistedRoll): RegExp {
  return new RegExp(`^${roll.hits} ${roll.hits === 1 ? 'hit' : 'hits'}$`);
}

async function rollIds(api: Api, campaignId: string, token: string): Promise<Set<string>> {
  const page = await api.get<{ rolls: PersistedRoll[] }>(
    `/api/campaigns/${campaignId}/rolls?limit=50`,
    token,
  );
  return new Set(page.rolls.map((r) => r.id));
}

async function waitForNewRoll(
  api: Api,
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

async function waitForLogEvent(
  api: Api,
  campaignId: string,
  token: string,
  rollId: string,
): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = await api.get<{ events: { type: string; payload: Record<string, unknown> }[] }>(
      `/api/campaigns/${campaignId}/log?limit=200`,
      token,
    );
    if (page.events.some((e) => e.type === 'roll.created' && e.payload['id'] === rollId)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
