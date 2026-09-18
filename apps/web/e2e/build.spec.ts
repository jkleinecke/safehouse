/**
 * A runner built in a browser from the first card to the roster, at a phone's
 * width and a laptop's (FR3.9; docs/CHARGEN.md §5 the P3 and P6 proofs, §8.6
 * "e2e in apps/web/e2e/build.spec.ts on phone and laptop viewports").
 *
 * The unit tests render every step to static markup, which is where each
 * refusal's sentence and each control's label are pinned. What they cannot
 * see is the loop the builder exists for: a player makes real choices on
 * nine screens against the real server, the GM reads the result, sends it
 * back with a note, the player finds the note where it was pinned and fixes
 * it, and approval turns the build into a character with its opening Karma,
 * its nuyen and the starting-nuyen dice on the record. Nor can they see
 * layout: one column on a phone with no sideways scroll, the priority table
 * giving way to column pickers, a refused stepper that answers a press.
 *
 * The walk, the same at both widths:
 *
 * 1. A fresh player device (its own user, so the shared world's player and
 *    roster are untouched) names a runner on the builds list and takes the
 *    chromed-up muscle card — a troll on the muscle priorities, our nearest
 *    card to a street samurai.
 * 2. Priorities: Attributes moves up to A, swapping Resources down to C —
 *    on a laptop in the table, on a phone in the column pickers.
 * 3. Metatype & attributes: Next is shut on the eight points the swap
 *    freed; Agility refuses a second attribute at its natural maximum and
 *    says so when pressed; the eight points go elsewhere. Magic is skipped.
 * 4. Qualities: one written in by hand, which waits on the GM.
 * 5. Skills: a rank moved into a specialisation, a native language, and a
 *    new street knowledge skill taking the free knowledge points.
 * 6. Gear: a Restricted pistol and a coat off the harness book's shelves; a
 *    commlink and a Forbidden fake SIN written in; the low lifestyle the card
 *    kept; Next names the nuyen that will not carry over.
 * 7. Karma: an Edge raise and a knowledge rank bring Karma down to the 7 that
 *    carries; two named contacts spend the contact pool.
 * 8. Finish: a background, the server's check agreeing, submit.
 * 9. The GM sees it waiting on the overview, opens the review and returns it
 *    with a note pinned to Gear. The player finds the note from their home
 *    screen, buys the ammunition it asks for, and submits again.
 * 10. The GM approves the three items the rules leave to them and approves
 *     the build. The runner is on the Party roster, its sheet opens, its
 *     ledger holds +7 Karma, the 5,000¥ carry-over and the starting-nuyen
 *     roll, and that roll is in the table's log and the server's roll record
 *     with dice that add up to the ledger's line.
 *
 * Selectors are roles and accessible names — what a screen reader hears —
 * so a restyle cannot break the walk, and a lost label can. No sleeps: every
 * wait is on text, a state or the server's record. Invented names only
 * (DESIGN.md §14).
 */
import type { Browser, Locator, Page } from '@playwright/test';
import { expect, signInWithToken, test } from './fixtures/test';
import type { Api } from './fixtures/api';
import type { DeviceSession, World } from './fixtures/world';

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1440, height: 900 };

type Device = 'phone' | 'laptop';

interface BuildRow {
  id: string;
  state: string;
  characterId: string | null;
  build: { notes: string | null; returnedStep: number | null };
}

interface LedgerAnswer {
  entries: Array<{ currency: 'karma' | 'nuyen'; delta: number; reason: string; state: string }>;
  balances: { karma: number; nuyen: number };
}

interface RollsAnswer {
  rolls: Array<{
    id: string;
    faces: number[];
    actor?: { characterId?: string };
    request: { meta?: { chargen?: string; sum?: number; multiplier?: number; nuyen?: number; carried?: number } };
  }>;
}

/** The GM's note, and where it is pinned. */
const RETURN_NOTE = 'The Zap Gun has nothing to shoot: buy it some ammunition, then send it back.';

/** A new player device of its own: an invite redeemed over REST, so no other spec's player gains a character. */
async function freshPlayer(api: Api, world: World, name: string): Promise<DeviceSession> {
  const invite = await api.post<{ code: string }>(`/api/campaigns/${world.campaignId}/invites`, { role: 'player' }, world.gm.token);
  const joined = await api.get<{ token: string }>(`/api/join/${invite.code}?name=${encodeURIComponent(name)}&label=E2E%20builder`);
  return { token: joined.token, role: 'player', campaignId: world.campaignId };
}

/** Neither the page nor the app's scrolling main may scroll sideways. */
async function noSidewaysScroll(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main');
    const doc = document.documentElement;
    return {
      main: main ? Math.max(0, main.scrollWidth - main.clientWidth) : 0,
      doc: Math.max(0, doc.scrollWidth - doc.clientWidth),
    };
  });
  expect(overflow, `no sideways scroll on ${where}`).toEqual({ main: 0, doc: 0 });
}

/** The step on screen: the frame is a region named by its heading while the build is editable. */
function stepFrame(page: Page, title: string): Locator {
  return page.getByRole('main').getByRole('region', { name: title, exact: true });
}

async function onStep(page: Page, title: string): Promise<Locator> {
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible({ timeout: 15_000 });
  return stepFrame(page, title);
}

/** Press Next, which must be open, and land on the step titled `to`. */
async function next(page: Page, to: string): Promise<Locator> {
  const button = page.getByRole('button', { name: 'next →' });
  await expect(button).toBeEnabled();
  await button.click();
  return onStep(page, to);
}

/** Press Next on Gear, answer the carry-over question it asks, and land on Karma. */
async function nextPastLostNuyen(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'next →' }).click();
  const question = page.getByRole('group', { name: /^Only a little nuyen carries into play/ });
  await expect(question).toContainText('over the 5,000¥ carry-over will be lost');
  await question.getByRole('button', { name: 'I meant to — next' }).click();
  return onStep(page, 'Karma & contacts');
}

/** Press + on a stepper `times` times. */
async function raise(scope: Locator, name: string, times = 1): Promise<void> {
  const plus = scope.getByRole('button', { name: `increase ${name}`, exact: true });
  for (let i = 0; i < times; i++) await plus.click();
}

/** Write a purchase in on the Gear step's "write one in" shelf and add it through its dialog. */
async function writeIn(
  page: Page,
  gear: Locator,
  item: { name: string; kind: string; price: string; avail: string; rating?: string; qty?: number },
): Promise<void> {
  const buy = gear.getByRole('region', { name: 'Buy' });
  // The shelf buttons toggle, and the form stays open after a line is added: open it only if it is shut.
  const shelf = buy.getByRole('button', { name: 'write one in', exact: true });
  if ((await shelf.getAttribute('aria-pressed')) !== 'true') await shelf.click();
  const form = buy.getByRole('form', { name: 'Write in a purchase' });
  await form.getByRole('textbox', { name: 'Name', exact: true }).fill(item.name);
  await form.getByRole('combobox', { name: 'Kind' }).selectOption({ label: item.kind });
  await form.getByRole('textbox', { name: 'Price each, in nuyen' }).fill(item.price);
  await form.getByRole('textbox', { name: 'Availability' }).fill(item.avail);
  if (item.rating) await form.getByRole('textbox', { name: 'Rating' }).fill(item.rating);
  await form.getByRole('button', { name: `continue with ${item.name}` }).click();
  const dialog = page.getByRole('dialog', { name: `Buy ${item.name}` });
  for (let q = 1; q < (item.qty ?? 1); q++) await raise(dialog, `Quantity of ${item.name}`);
  await dialog.getByRole('button', { name: new RegExp(`^add ${item.name} for `) }).click();
  await expect(dialog).toBeHidden();
}

/** Buy a row off one of the Gear step's shelves. */
async function buyFromShelf(page: Page, gear: Locator, shelfName: string, item: string): Promise<void> {
  const buy = gear.getByRole('region', { name: 'Buy' });
  await buy.getByRole('button', { name: shelfName, exact: true }).click();
  await buy.getByRole('button', { name: `buy ${item}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Buy ${item}` });
  await dialog.getByRole('button', { name: new RegExp(`^add ${item} for `) }).click();
  await expect(dialog).toBeHidden();
}

/** One line of the "what most runners need" checklist, ticked (its ✓ is aria-hidden, so the words are matched past it). */
function ticked(gear: Locator, line: string): Locator {
  return gear
    .getByRole('region', { name: 'What most runners need' })
    .getByRole('listitem')
    .filter({ hasText: new RegExp(`^\\W*${line}\\s*got it$`) });
}

/** The server's state for the build, polled until it is `state`. */
async function serverState(api: Api, buildId: string, token: string, state: string, message: string): Promise<BuildRow> {
  let row: BuildRow | null = null;
  await expect
    .poll(async () => (row = await api.get<BuildRow>(`/api/builds/${buildId}`, token)).state, { message, timeout: 20_000 })
    .toBe(state);
  return row!;
}

// ---------------------------------------------------------------------------
// The player's first pass: nine steps and a submit
// ---------------------------------------------------------------------------

async function playerBuilds(page: Page, world: World, device: Device, alias: string): Promise<string> {
  // The player's home offers the builder; the builds list takes a street name.
  await page.goto(`/c/${world.campaignId}`);
  await page.getByRole('link', { name: 'start a new runner' }).click();
  await page.getByRole('textbox', { name: "New runner's street name" }).fill(alias);
  await noSidewaysScroll(page, 'the builds list');
  await page.getByRole('button', { name: 'start a new runner' }).click();
  await page.waitForURL(/\/build\/[0-9a-f-]{36}$/);
  const buildId = /\/build\/([0-9a-f-]{36})$/.exec(page.url())![1]!;

  // 1 — Concept: the alias came with the name; the muscle card fills every later step.
  const concept = await onStep(page, 'Concept');
  await expect(concept.getByRole('textbox', { name: 'Alias (needed)' })).toHaveValue(alias);
  const card = concept.getByRole('radiogroup', { name: 'Concept card' }).getByRole('radio', { name: 'Chromed-up muscle' });
  await card.click();
  await expect(card).toBeChecked();
  await expect(concept.getByRole('status').filter({ hasText: 'Chromed-up muscle' })).toHaveText(
    'Every later step holds the “Chromed-up muscle” suggestion; change any of it there.',
  );
  await noSidewaysScroll(page, 'step 1');
  const priorities = await next(page, 'Priorities');

  // 2 — Priorities: Attributes up to A, which sends Resources down to C.
  if (device === 'laptop') {
    await expect(priorities.getByRole('grid')).toBeVisible();
    await priorities.getByRole('button', { name: 'Attributes at A: 24 attribute points' }).click();
    await expect(priorities.getByRole('button', { name: 'Attributes at A: 24 attribute points' })).toHaveAttribute('aria-pressed', 'true');
    await expect(priorities.getByRole('button', { name: 'Resources at C: 140,000¥' })).toHaveAttribute('aria-pressed', 'true');
  } else {
    await expect(priorities.getByRole('grid')).toBeHidden();
    const attributes = priorities.getByRole('radiogroup', { name: 'Attributes' });
    await attributes.getByRole('radio', { name: /^A.?24 attribute points$/ }).click();
    await expect(attributes.getByRole('radio', { name: /^A.?24 attribute points$/ })).toBeChecked();
    await expect(priorities.getByRole('radiogroup', { name: 'Resources' }).getByRole('radio', { name: /^C.?140,000¥$/ })).toBeChecked();
  }
  await noSidewaysScroll(page, 'step 2');
  const metatype = await next(page, 'Metatype & attributes');

  // 3 — Metatype & attributes: the troll the card chose, and eight points the swap freed.
  await expect(metatype.getByRole('radiogroup', { name: 'Metatypes' }).getByRole('radio', { name: /^Troll/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'next →' })).toBeDisabled();
  await expect(metatype.getByText('Next opens when this is done: 8 attribute points still to spend.')).toBeVisible();
  const attributes = metatype.getByRole('list', { name: 'The eight attributes' });
  // Body already sits at its natural maximum, so a second attribute there is refused before the fact…
  const agility = attributes.getByRole('button', { name: 'increase Agility points', exact: true });
  await expect(agility).toBeDisabled();
  await expect(agility).toHaveAccessibleDescription(/Only one attribute may start at its natural maximum/);
  // …and aria-disabled, not disabled: a real press reaches it and is answered with the sentence.
  await agility.click({ force: true });
  await expect(attributes.getByRole('paragraph').filter({ hasText: 'Only one attribute may start at its natural maximum: Body, Agility are.' })).toContainText('⛔');
  await expect(attributes.getByRole('group', { name: 'Agility points' }).getByRole('status')).toHaveText('3');
  await noSidewaysScroll(page, 'step 3 with a refusal said');
  await raise(attributes, 'Reaction points');
  await raise(attributes, 'Strength points');
  await raise(attributes, 'Willpower points', 2);
  await raise(attributes, 'Logic points');
  await raise(attributes, 'Intuition points');
  await raise(attributes, 'Charisma points', 2);
  await expect(metatype.getByText('0 of 24 attribute points left')).toBeVisible();
  // A mundane skips Magic: Next goes straight to Qualities, and the strip says why.
  const qualities = await next(page, 'Qualities');
  await expect(page.getByRole('navigation', { name: 'Build steps' }).getByRole('button', { name: /^Magic — Step 4, Magic or Resonance: skipped/ })).toBeVisible();

  // 5 — Qualities: one written in by hand, which the GM will decide.
  const add = qualities.getByRole('region', { name: 'Add a quality' });
  // The harness book lists no qualities, so the step may already have opened this form; choosing it settles that.
  const own = add.getByRole('button', { name: 'write your own' });
  await own.click();
  await expect(own).toHaveAttribute('aria-pressed', 'true');
  await add.getByRole('textbox', { name: 'Name', exact: true }).fill('Doorframe Shoulders');
  await add.getByRole('textbox', { name: 'Karma', exact: true }).fill('5');
  await add.getByRole('button', { name: 'add Doorframe Shoulders' }).click();
  const positive = qualities.getByRole('region', { name: 'Positive qualities' });
  await expect(positive.getByRole('heading', { name: 'Doorframe Shoulders' })).toBeVisible();
  await expect(positive).toContainText('needs the GM');
  await expect(positive.getByText('20 of 25 Karma of positive qualities left')).toBeVisible();
  await noSidewaysScroll(page, 'step 5');
  const skills = await next(page, 'Skills');

  // 6 — Skills: a rank of Intimidation becomes a Pistols specialisation; a language and a knowledge skill.
  const active = skills.getByRole('region', { name: 'Active skills' });
  await active.getByRole('button', { name: 'decrease Intimidation', exact: true }).click();
  await expect(active.getByRole('group', { name: 'Intimidation', exact: true }).getByRole('status')).toHaveText('2');
  await active.getByRole('button', { name: '+ specialisation for Pistols' }).click();
  await active.getByRole('textbox', { name: 'Specialisation for Pistols' }).fill('Revolvers');
  await expect(active.getByText('0 of 22 skill points left')).toBeVisible();
  const knowledge = skills.getByRole('region', { name: 'Knowledge & languages' });
  await knowledge.getByRole('button', { name: '+ native language' }).click();
  await knowledge.getByRole('textbox', { name: 'Name of language 1' }).fill('English');
  await knowledge.getByRole('button', { name: '+ street knowledge' }).click();
  await knowledge.getByRole('textbox', { name: 'Name of street knowledge skill 2' }).fill('Dockside fences');
  await raise(knowledge, 'Knowledge points on Dockside fences', 3);
  await raise(knowledge, 'Knowledge points on Gang turf lines');
  await expect(knowledge.getByText('0 of 10 knowledge points left')).toBeVisible();
  await noSidewaysScroll(page, 'step 6');
  const gear = await next(page, 'Gear');

  // 7 — Gear: off the shelves, written in, and a lifestyle the card kept.
  await buyFromShelf(page, gear, 'weapons', 'Zap Gun');
  await buyFromShelf(page, gear, 'armor', 'Crate Coat');
  await writeIn(page, gear, { name: 'Pocket commlink', kind: 'commlinks & decks', price: '1000', avail: '2', rating: '3' });
  await writeIn(page, gear, { name: 'Fake SIN', kind: 'gear', price: '10000', avail: '8F', rating: '4' });
  const bought = gear.getByRole('region', { name: 'Bought' });
  await expect(bought.getByRole('list', { name: 'Weapons' })).toContainText('Zap Gun is Restricted; the GM decides.');
  await expect(bought.getByRole('list', { name: 'Gear, electronics & the rest' })).toContainText('Fake SIN is Forbidden; the GM decides.');
  for (const line of ['a commlink', 'a fake SIN', 'armor', 'a weapon', 'a lifestyle']) {
    await expect(ticked(gear, line), `the checklist ticks ${line}`).toBeVisible();
  }
  await expect(gear.getByRole('list', { name: 'Lifestyles kept' }).getByRole('textbox', { name: 'Name of lifestyle 1' })).toHaveValue('Low');
  await noSidewaysScroll(page, 'step 7');
  const karma = await nextPastLostNuyen(page);

  // 8 — Karma: Edge 1 → 2 (10) and a knowledge rank (3) leave the 7 that carries; two contacts.
  await raise(karma.getByRole('region', { name: 'Attributes' }), 'Edge');
  await raise(karma.getByRole('region', { name: 'Knowledge and languages' }), 'Close protection');
  const left = karma.getByRole('region', { name: 'Karma left' });
  await expect(left.getByText('7 Karma left', { exact: true })).toBeVisible();
  await expect(left.getByText('All 7 carries into play (at most 7 may).')).toBeVisible();
  const contacts = karma.getByRole('region', { name: 'Contacts' });
  const contact = (name: string) => contacts.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await contacts.getByRole('button', { name: 'add a contact at Connection 1 and Loyalty 1' }).click();
  await contact('Contact 1').getByRole('textbox', { name: 'name', exact: true }).fill('Ledger Wren');
  await contact('Ledger Wren').getByRole('textbox', { name: 'role', exact: true }).fill('fixer');
  await raise(contacts, 'Connection of Ledger Wren', 2);
  await raise(contacts, 'Loyalty of Ledger Wren');
  await contacts.getByRole('button', { name: 'add a contact at Connection 1 and Loyalty 1' }).click();
  await contact('Contact 2').getByRole('textbox', { name: 'name', exact: true }).fill('Cinder Vole');
  await contact('Cinder Vole').getByRole('textbox', { name: 'role', exact: true }).fill('fence');
  await raise(contacts, 'Connection of Cinder Vole');
  await raise(contacts, 'Loyalty of Cinder Vole');
  await expect(contacts.getByText('0 of 9 contact Karma left')).toBeVisible();
  await noSidewaysScroll(page, 'step 8');
  const finish = await next(page, 'Finish');

  // 9 — Finish: the checklist, a background, the server's agreement, submit.
  await expect(finish.getByRole('region', { name: 'Creation checklist' })).toContainText('9 of 9 done');
  await finish.getByRole('textbox', { name: 'Background' }).fill('Kept the doors of a dockside club until it burned; now keeps them for whoever pays.');
  await expect(page.getByRole('button', { name: 'next →' })).toHaveCount(0);
  await noSidewaysScroll(page, 'step 9');
  // The strip followed the walk: the current step's tab is on screen, not off the right edge.
  const finishTab = page.getByRole('navigation', { name: 'Build steps' }).getByRole('button', { name: /^Finish — Step 9, Finish: current step/ });
  await expect
    .poll(async () => {
      const box = await finishTab.boundingBox();
      const width = page.viewportSize()?.width ?? 0;
      return box !== null && box.x >= 0 && box.x + box.width <= width + 1;
    }, { message: 'the current step’s tab is in view' })
    .toBe(true);
  await expect(finish.getByRole('region', { name: "The server's check" }).getByRole('status')).toContainText(
    'The server agrees with this page: nothing to fix, 3 items for the GM.',
    { timeout: 20_000 },
  );
  await finish.getByRole('region', { name: 'Send it to the GM' }).getByRole('button', { name: 'submit for approval' }).click();
  await expect(page.getByRole('region', { name: 'Waiting for the GM' })).toBeVisible({ timeout: 15_000 });
  return buildId;
}

// ---------------------------------------------------------------------------
// The GM: find it waiting, review it
// ---------------------------------------------------------------------------

/** From the GM overview's builds card to the review of this runner. */
async function gmOpensWaiting(gm: Page, world: World, alias: string): Promise<Locator> {
  await gm.goto(`/c/${world.campaignId}/gm`);
  await expect(gm.getByText(/\d+ builds? (is|are) waiting for your review\./)).toBeVisible({ timeout: 15_000 });
  await noSidewaysScroll(gm, 'the GM overview');
  await gm.getByRole('link', { name: /^review \d+$/ }).click();
  await expect(gm.getByRole('group', { name: 'Which builds to show' }).getByRole('button', { name: /^waiting for review/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const row = gm.getByRole('main').getByRole('listitem').filter({ has: gm.getByRole('link', { name: alias, exact: true }) });
  await expect(row).toContainText('waiting for the GM');
  await row.getByRole('link', { name: 'review', exact: true }).click();
  const review = gm.getByRole('tabpanel', { name: 'Finish' });
  await expect(review.getByRole('heading', { level: 1, name: 'Finish' })).toBeVisible({ timeout: 15_000 });
  await expect(review.getByRole('region', { name: "The server's check" }).getByRole('status')).toContainText(
    'The server agrees with this page: nothing to fix, 3 items for the GM.',
    { timeout: 20_000 },
  );
  await noSidewaysScroll(gm, 'the GM review');
  return review;
}

// ---------------------------------------------------------------------------
// The player again: the note where it was pinned, the fix, submit again
// ---------------------------------------------------------------------------

async function playerFixes(page: Page, world: World, alias: string): Promise<void> {
  // From home, as a returning player would: the build says it came back.
  await page.goto(`/c/${world.campaignId}`);
  const item = page.getByRole('main').getByRole('listitem').filter({ has: page.getByRole('link', { name: alias, exact: true }) });
  await expect(item).toContainText('returned with a note', { timeout: 15_000 });
  await item.getByRole('link', { name: alias, exact: true }).click();

  // Submitted from Finish, it reopens there, pointing at the step the note is on.
  const finish = await onStep(page, 'Finish');
  const steps = page.getByRole('navigation', { name: 'Build steps' });
  await expect(steps.getByRole('button', { name: /^Gear — Step 7, Gear: .*the GM left a note here$/ })).toBeVisible();
  const pointer = finish.getByRole('note').filter({ hasText: 'The GM returned this build with a note on step 7, Gear.' });
  await pointer.getByRole('button', { name: 'read it' }).click();

  const gear = await onStep(page, 'Gear');
  await expect(gear.getByRole('note', { name: "The GM's note" })).toContainText(RETURN_NOTE);
  await noSidewaysScroll(page, 'step 7 with the GM’s note');

  // The books list no ammunition, so it is written in.
  const buy = gear.getByRole('region', { name: 'Buy' });
  await buy.getByRole('button', { name: 'ammunition', exact: true }).click();
  await expect(buy.getByRole('status')).toContainText("This campaign's books list no ammunition.");
  await writeIn(page, gear, { name: 'Heavy pistol rounds', kind: 'ammunition', price: '100', avail: '2', qty: 2 });
  await expect(ticked(gear, 'ammunition'), 'the checklist ticks ammunition').toBeVisible();

  await nextPastLostNuyen(page);
  const again = await next(page, 'Finish');
  await expect(again.getByRole('region', { name: "The server's check" }).getByRole('status')).toContainText(
    'The server agrees with this page: nothing to fix, 3 items for the GM.',
    { timeout: 20_000 },
  );
  await again.getByRole('region', { name: 'Send it to the GM' }).getByRole('button', { name: 'submit again' }).click();
  await expect(page.getByRole('region', { name: 'Waiting for the GM' })).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// The whole loop
// ---------------------------------------------------------------------------

async function walk(page: Page, api: Api, world: World, browser: Browser, device: Device): Promise<void> {
  // A retry (or --repeat-each) plays in the same world as the attempt before it, whose runner may
  // already be waiting or on the roster: a second name keeps every lookup by name unambiguous.
  const attempt = test.info().retry + test.info().repeatEachIndex;
  const alias = `${device === 'phone' ? 'Slabjaw' : 'Brickwall'}${attempt > 0 ? ` ${attempt + 1}` : ''}`;
  const player = await freshPlayer(api, world, `${alias} player`);
  await signInWithToken(page, player);

  const buildId = await playerBuilds(page, world, device, alias);
  await serverState(api, buildId, player.token, 'submitted', 'the submit reaches the server');

  // The GM, on their own device at the same size.
  const gmContext = await browser.newContext({
    viewport: device === 'phone' ? PHONE : LAPTOP,
    ...(device === 'phone' ? { hasTouch: true, isMobile: true } : {}),
  });
  const gm = await gmContext.newPage();
  try {
    await signInWithToken(gm, world.gm);

    // Returned with a note pinned to Gear.
    const review = await gmOpensWaiting(gm, world, alias);
    await expect(review.getByRole('region', { name: 'Needs your decision' })).toContainText('0 approved · 0 denied · 3 open');
    const back = review.getByRole('region', { name: 'Return with notes' });
    await back.getByRole('textbox', { name: 'Note for the player' }).fill(RETURN_NOTE);
    await back.getByRole('combobox', { name: 'Pin it to' }).selectOption({ label: 'Step 7 · Gear' });
    await back.getByRole('button', { name: 'return with notes' }).click();
    const returned = await serverState(api, buildId, world.gm.token, 'returned', 'the return reaches the server');
    expect(returned.build).toMatchObject({ notes: RETURN_NOTE, returnedStep: 7 });

    await playerFixes(page, world, alias);
    await serverState(api, buildId, player.token, 'submitted', 'the second submit reaches the server');

    // Decided and approved.
    const second = await gmOpensWaiting(gm, world, alias);
    const decisions = second.getByRole('region', { name: 'Needs your decision' });
    const items = await decisions.getByRole('group', { name: /^Your decision: / }).all();
    expect(items, 'the hand-written quality, the Restricted gun and the Forbidden SIN').toHaveLength(3);
    for (const decision of items) {
      await decision.getByRole('button', { name: 'approve', exact: true }).click();
      await expect(decision.getByRole('button', { name: 'approve', exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(decisions).toContainText('3 approved · 0 denied · 0 open');
    const approve = second.getByRole('region', { name: 'Approve' });
    await approve.getByRole('button', { name: 'approve', exact: true }).click();
    await approve.getByRole('button', { name: 'approve now' }).click();
    await expect(second.getByRole('region', { name: 'Approved' }).getByRole('link', { name: 'open the character sheet' })).toBeVisible({
      timeout: 20_000,
    });
    const approved = await serverState(api, buildId, world.gm.token, 'approved', 'approval reaches the server');
    const characterId = approved.characterId;
    expect(characterId, 'approval names the character it made').toBeTruthy();

    // On the roster, and its sheet opens from there.
    await gm.goto(`/c/${world.campaignId}/gm/party`);
    await expect(gm.getByRole('heading', { level: 1, name: 'Party' })).toBeVisible();
    await noSidewaysScroll(gm, 'the Party roster');
    await gm.getByRole('main').getByRole('link', { name: alias, exact: true }).click();
    await gm.waitForURL(`**/sheet/${characterId}`);
    await expect(gm.getByRole('heading', { level: 2, name: alias, exact: true })).toBeVisible({ timeout: 15_000 });

    // The server's record first: the starting-nuyen dice, and the three opening lines they explain.
    const rolls = await api.get<RollsAnswer>(`/api/campaigns/${world.campaignId}/rolls?limit=50`, world.gm.token);
    const roll = rolls.rolls.find((r) => r.actor?.characterId === characterId && r.request.meta?.chargen === 'startingNuyen');
    expect(roll, 'the starting-nuyen roll is on the record').toBeTruthy();
    const sum = roll!.faces.reduce((a, b) => a + b, 0);
    expect(roll!.faces, 'a low lifestyle rolls 3D6').toHaveLength(3);
    expect(roll!.request.meta).toMatchObject({ sum, multiplier: 60, nuyen: sum * 60, carried: 5000 });
    const ledger = await api.get<LedgerAnswer>(`/api/characters/${characterId}/ledger`, world.gm.token);
    expect(ledger.balances).toEqual(expect.objectContaining({ karma: 7, nuyen: 5000 + sum * 60 }));

    // The sheet's ledger says the same.
    await gm.getByRole('tab', { name: 'Ledger' }).click();
    const history = gm.getByRole('main').getByRole('listitem');
    await expect(history.filter({ hasText: 'Built: 7 Karma carried into play' })).toContainText('+7 karma');
    await expect(history.filter({ hasText: 'Built: 5,000¥ left over from creation' })).toContainText('+5,000¥');
    await expect(history.filter({ hasText: `Built: starting nuyen, 3D6 (${sum}) × 60` })).toContainText(`+${(sum * 60).toLocaleString('en-US')}¥`);
    await noSidewaysScroll(gm, 'the new sheet’s ledger');

    // And the dice are in the table's log, where every roll is.
    await gm.goto(`/c/${world.campaignId}/table`);
    const logged = gm
      .getByRole('region', { name: 'Session log' })
      .getByRole('article')
      .filter({ hasText: alias })
      .filter({ hasText: 'Starting nuyen: 3D6 × 60' });
    await expect(logged).toContainText(`${sum} × 60 = ${(sum * 60).toLocaleString('en-US')}¥`, { timeout: 15_000 });
  } finally {
    await gmContext.close();
  }
}

test.describe('the builder at a laptop’s width', () => {
  test.use({ viewport: LAPTOP, actionTimeout: 15_000 });

  test('a player builds a runner, the GM returns it with a note, and approves the fix onto the roster', async ({ page, api, world, browser }) => {
    test.setTimeout(240_000);
    await walk(page, api, world, browser, 'laptop');
  });
});

test.describe('the builder at a phone’s width', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true, actionTimeout: 15_000 });

  test('the same runner by thumb: built, returned, fixed and approved', async ({ page, api, world, browser }) => {
    test.setTimeout(240_000);
    await walk(page, api, world, browser, 'phone');
  });
});
