/**
 * The Gear step screen, rendered to static markup from a hand-built
 * `StepProps` (`../Gear.tsx` and its panels). Pinned for the states that
 * matter:
 *
 * - a fresh build from a concept card: five labelled sections with their h2s
 *   in order, the nuyen pool in words and where it came from, the carry-over
 *   and what would be lost in the engine's words, the checklist saying in
 *   words what is missing with a shelf for each, the card's shopping list, the
 *   shop closed (nothing fetched), nothing bought yet, and a troll's
 *   lifestyle priced double with the page and the starting-nuyen dice;
 * - partly spent: lines grouped by list with unit × quantity, grade, Essence,
 *   Availability, the GM's part and labelled edit/remove;
 * - over: an overspend said in words, a line over the cap marked "must fix";
 * - refused: the Karma stepper at the level's limit, with the engine's
 *   sentence tied to the button;
 * - a line being edited: the quantity stepper warning what one more takes
 *   from Magic, the grade cards refusing alphaware with the cap's sentence;
 * - the add panel: the Magic it would take, said on the button; a cap
 *   refusing the button with the sentence tied; a price the book does not
 *   print asked for;
 * - a shelf open over a seeded catalogue page (the row over the cap greyed),
 *   and the write-in form;
 * - read-only (no controls) and the GM's review (approve / deny per line).
 *
 * Builds are the rules' own concept cards; every item and figure typed here
 * is invented (DESIGN.md §14).
 */
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CharacterBuild } from '@safehouse/contracts';
import { builderCatalogueKey, hitToPurchase } from '../../kit/index.js';
import { issuesForStep } from '../../lib.js';
import { BUILD_ID, CAMPAIGN, SETTINGS, analysisOf, catalogueHit, conceptBuild } from '../../testing.js';
import GearStep, { type GearStepState } from '../Gear.js';
import { stepMeta } from '../meta.js';
import { inertActions, type BuildActions, type StepProps } from '../types.js';
import { AddPanelView, type AddPanelViewProps } from './AddPanel.js';
import { CustomPurchaseView } from './CustomPurchase.js';
import { EMPTY_CUSTOM, initialDraft, quoteDraft, withKarmaToNuyen, withPurchase, type QuoteContext } from './gear.js';

const noop = () => undefined;

function stepProps(build: CharacterBuild, over: Partial<StepProps> = {}): StepProps {
  const analysis = analysisOf(build);
  return {
    campaignId: CAMPAIGN,
    buildId: BUILD_ID,
    characterId: null,
    isOwner: true,
    meta: stepMeta(7),
    build,
    settings: SETTINGS,
    settingsFromCampaign: true,
    budgets: analysis.budgets,
    issues: issuesForStep(analysis.issues, 7),
    allIssues: analysis.issues,
    status: analysis.steps[6]!,
    steps: analysis.steps,
    eligibility: analysis.eligibility,
    preview: analysis.preview,
    ratings: analysis.ratings,
    probe: analysis.probe,
    update: noop,
    goTo: noop,
    readOnly: false,
    reviewMode: false,
    mode: 'guided',
    role: 'player',
    actions: inertActions(),
    ...over,
  };
}

const render = (build: CharacterBuild, over: Partial<StepProps> & GearStepState = {}, wrap?: (node: ReactNode) => ReactNode) => {
  const node = <GearStep {...stepProps(build)} {...over} />;
  return renderToStaticMarkup(<>{wrap ? wrap(node) : node}</>);
};

/** The visible words, tags stripped and entities decoded enough to read. */
const copy = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');

/** The markup of one element with this test id, up to the next of its kind. */
function sectionOf(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  if (at < 0) throw new Error(`no ${testId}`);
  const start = html.lastIndexOf('<', at);
  const end = html.indexOf('</section>', at);
  return html.slice(start, end < 0 ? undefined : end);
}

// Invented rows.
const glassEye = catalogueHit({ id: 'w-eye', kind: 'augmentation', category: 'EYEWARE', name: 'Glass Eye', stats: { ESSENCE: '1.2' }, avail: '12R', cost: 4_000 });
const rookPistol = catalogueHit({
  id: 'w-rook',
  kind: 'weapon',
  category: 'HEAVY PISTOLS',
  name: 'Rook Pistol',
  stats: { ACC: '5', DAMAGE: '8P', AP: '-1', MODE: 'SA' },
  avail: '4R',
  cost: 450,
});
const siegeCannon = catalogueHit({ id: 'w-siege', kind: 'weapon', category: 'CANNONS', name: 'Siege Cannon', stats: { ACC: '4', DAMAGE: '18P', AP: '-8', MODE: 'SS' }, avail: '20F', cost: 90_000 });

const ctxOf = (build: CharacterBuild): QuoteContext => {
  const a = analysisOf(build);
  return { build, settings: SETTINGS, budgets: a.budgets, probe: a.probe };
};

describe('the Gear step, fresh from a concept card', () => {
  const build = conceptBuild('muscle');
  const html = render(build);
  const text = copy(html);

  it('lays out five labelled sections, h2s in order under the frame’s h1', () => {
    const headings = [...html.matchAll(/<h([1-6])[^>]*>([^<]*)<\/h\1>/g)].map((m) => `h${m[1]} ${m[2]}`);
    expect(headings.filter((h) => h.startsWith('h2'))).toEqual(['h2 Nuyen', 'h2 What most runners need', 'h2 Buy', 'h2 Bought', 'h2 Lifestyles']);
    expect(headings.some((h) => h.startsWith('h1'))).toBe(false);
    for (const m of html.matchAll(/<section aria-labelledby="([^"]+)"/g)) expect(html).toContain(`id="${m[1]}"`);
    expect(html.match(/<section /g)).toHaveLength(5);
  });

  it('says the nuyen pool in words, where it came from, and what carries and what is lost', () => {
    expect(text).toContain('446,000¥ of 450,000¥ left');
    expect(text).toContain('Resources A gives 450,000¥.');
    expect(text).toContain('Up to 5,000¥ carries into play; the other 441,000¥ is lost.');
    expect(sectionOf(html, 'gear-nuyen')).toContain('data-issue="nuyen-carry-lost"');
    expect(text).toContain('441,000¥ over the 5,000¥ carry-over will be lost.');
    expect(text).toContain('Each point of Karma buys 2,000¥, up to 10 at this level.');
    expect(text).toContain('costs 1 Karma — you have 25');
  });

  it('lists what most runners need in words, a shelf for each gap, and the card’s shopping', () => {
    const checklist = sectionOf(html, 'gear-checklist');
    expect(checklist).toMatch(/data-check="commlink" data-done="no"/);
    expect(checklist).toMatch(/data-check="lifestyle" data-done="yes"/);
    expect(copy(checklist)).toContain('a fake SIN not yet');
    expect(copy(checklist)).toContain('a lifestyle got it');
    expect(checklist).toContain('aria-label="browse commlinks &amp; decks for a commlink"');
    expect(copy(checklist)).toContain('1 of 7');
    expect(copy(checklist)).toContain('The Chromed-up muscle card suggests');
    expect(copy(checklist)).toContain('rifle ammunition × 3');
  });

  it('keeps the shop closed until a shelf is chosen, so nothing is fetched', () => {
    const shop = sectionOf(html, 'gear-shop');
    expect(shop).toContain('aria-label="Shelves"');
    expect(shop.match(/aria-pressed="false"/g)).toHaveLength(10);
    expect(shop).not.toContain('gear-picker');
    expect(html).toContain('data-testid="gear-purchases-empty"');
  });

  it('prices a troll’s lifestyle double, with the page and the starting-nuyen dice', () => {
    const lifestyles = sectionOf(html, 'gear-lifestyles');
    expect(lifestyles).toContain('id="gear-lifestyles"');
    expect(copy(lifestyles)).toContain('This metatype pays +100% on every lifestyle.');
    expect(copy(lifestyles)).toContain('4,000¥ a month (listed at 2,000¥)');
    expect(copy(lifestyles)).toContain('3D6 × 60¥ is rolled for starting nuyen');
    expect(lifestyles).toContain('aria-label="add a Middle lifestyle, 10,000¥ a month, starting nuyen 4D6 × 100¥"');
    expect(lifestyles).toContain('aria-label="increase Months of Low"');
    expect(lifestyles).toContain('aria-label="remove the Low lifestyle"');
  });
});

describe('the Gear step, partly spent and over', () => {
  it('groups lines with their figures, the GM’s part, and labelled edit and remove', () => {
    let build = conceptBuild('muscle');
    build = withPurchase(build, hitToPurchase(rookPistol, { qty: 2 }));
    build = withPurchase(build, hitToPurchase(catalogueHit({ ...glassEye, avail: '6' }), { grade: 'alphaware' }));
    const html = render(build);
    const bought = sectionOf(html, 'gear-purchases');
    expect(bought.match(/data-testid="gear-group"/g)).toHaveLength(2);
    expect(bought).toMatch(/data-list="weapons"[\s\S]*data-list="augments"/);
    expect(copy(bought)).toContain('450¥ × 2 = 900¥ · Availability 4R');
    expect(copy(bought)).toContain('4,800¥ · alphaware · Essence 0.96 · Availability 8');
    expect(copy(bought)).toContain('needs the GM Rook Pistol is Restricted; the GM decides.');
    expect(copy(bought)).toContain('Essence 5.04');
    expect(bought).toContain('aria-label="edit Rook Pistol"');
    expect(bought).toContain('aria-label="remove Glass Eye"');
    expect(bought).not.toContain('>approve<');
  });

  it('says an overspend in words, and marks a line over the cap as must fix', () => {
    const build = withPurchase(conceptBuild('street-mage'), hitToPurchase(siegeCannon));
    const html = render(build);
    const nuyen = copy(sectionOf(html, 'gear-nuyen'));
    expect(nuyen).toContain('84,500¥ over: 90,500¥ spent of 6,000¥');
    expect(nuyen).toContain('must fix: 84,500¥ overspent.');
    const line = copy(sectionOf(html, 'gear-purchases'));
    expect(line).toContain('must fix: Siege Cannon is Availability 20; the cap is 12.');
  });

  it('refuses the Karma stepper at the level’s limit with the engine’s sentence tied to the button', () => {
    const html = render(withKarmaToNuyen(conceptBuild('muscle'), 10));
    const stepper = sectionOf(html, 'gear-karma-conversion');
    const reason = /<p id="([^"]+)"[^>]*data-refusal="increase"[^>]*>([\s\S]*?)<\/p>/.exec(stepper);
    expect(reason).not.toBeNull();
    expect(copy(reason![2]!)).toContain('11 Karma converted; experienced allows 10.');
    expect(stepper).toMatch(new RegExp(`aria-label="increase Karma converted to nuyen" aria-disabled="true" aria-describedby="${reason![1]}"`));
  });

  it('edits one line: one more takes Magic, and alphaware refuses with the cap', () => {
    const build = withPurchase(conceptBuild('street-mage'), hitToPurchase(glassEye));
    const html = render(build, { initialEditing: 0 });
    const editor = html.slice(html.indexOf('data-testid="gear-line-editor"'));
    expect(copy(editor)).toContain('One more takes Magic from 4 to 3.');
    // The warning is what the quantity's + button is described by.
    const plus = /<button[^>]*aria-label="increase Quantity of Glass Eye"[^>]*>/.exec(editor)![0];
    const lossId = /aria-describedby="([^"]+)"/.exec(plus)![1]!;
    expect(editor).toMatch(new RegExp(`<p id="${lossId}"[^>]*data-testid="gear-line-loss"`));
    expect(editor).toContain('aria-label="Grade of Glass Eye"');
    expect(editor).toMatch(/data-refusal="alphaware"[^>]*>[\s\S]*?Glass Eye is Availability 14; the cap is 12\./);
    expect(editor).toMatch(/data-refusal="deltaware"[^>]*>[\s\S]*?not at creation/);
    expect(editor).toContain('Price each, in nuyen, before grade');
  });
});

describe('the add panel', () => {
  const view = (over: Partial<AddPanelViewProps> & Pick<AddPanelViewProps, 'hit' | 'quote' | 'draft'>) =>
    renderToStaticMarkup(
      <AddPanelView
        budgets={analysisOf(conceptBuild('street-mage')).budgets}
        onDraft={noop}
        onAdd={noop}
        onCancel={noop}
        qtyRefusal={null}
        ratingRefusal={null}
        gradeRefusals={{}}
        {...over}
      />,
    );

  it('says the Magic an implant would take, and the button says it too', () => {
    const ctx = ctxOf(conceptBuild('street-mage'));
    const draft = initialDraft(glassEye);
    const html = view({ hit: glassEye, draft, quote: quoteDraft(glassEye, draft, ctx) });
    const loss = /<p id="([^"]+)"[^>]*data-testid="gear-add-loss"/.exec(html);
    expect(loss).not.toBeNull();
    expect(copy(html)).toContain('This takes Magic from 6 to 4');
    expect(copy(html)).toContain('add Glass Eye for 4,000¥, and lose 2 Magic');
    expect(html).toMatch(new RegExp(`aria-describedby="[^"]*${loss![1]}[^"]*" data-testid="gear-add-confirm" data-refused="no"`));
    expect(copy(html)).toContain('costs 4,000¥ — you have 5,500¥');
    expect(copy(html)).toContain('on the rail: Essence 6 → 4.8 · Magic 6 → 4');
    expect(copy(html)).toContain('needs the GM: Glass Eye is Restricted; the GM decides.');
    expect(html).toContain('aria-label="Grade of Glass Eye"');
    expect(html).toContain('aria-label="increase Quantity of Glass Eye"');
  });

  it('refuses a draft over the cap, focusable, with the sentence tied to the button', () => {
    const ctx = ctxOf(conceptBuild('muscle'));
    const draft = { ...initialDraft(glassEye), grade: 'alphaware' as const };
    const html = view({ hit: glassEye, draft, quote: quoteDraft(glassEye, draft, ctx) });
    const refusal = /<p id="([^"]+)"[^>]*data-testid="gear-add-refusal"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    expect(copy(refusal![2]!)).toContain('Glass Eye is Availability 14; the cap is 12.');
    expect(html).toMatch(new RegExp(`aria-disabled="true" aria-describedby="[^"]*${refusal![1]}[^"]*" data-testid="gear-add-confirm" data-refused="yes"`));
  });

  it('asks for a price the books do not print', () => {
    const ctx = ctxOf(conceptBuild('muscle'));
    const favour = catalogueHit({ id: 'g-favour', kind: 'gear', name: 'Invented Favour', cost: null, costText: 'Varies' });
    const draft = initialDraft(favour);
    const html = view({ hit: favour, draft, quote: quoteDraft(favour, draft, ctx) });
    expect(html).toContain('data-testid="gear-add-price"');
    expect(copy(html)).toContain('type what it costs each');
    expect(html).toContain('data-refused="yes"');
    expect(html).not.toContain('aria-label="Grade of');
  });
});

describe('the shop, open', () => {
  it('browses a shelf of the campaign’s books, the row over the cap greyed with its number', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(builderCatalogueKey({ campaignId: CAMPAIGN, kind: 'weapon', q: '' }), {
      pages: [{ query: '', hits: [rookPistol, siegeCannon], total: 2, offset: 0, limit: 25, hasMore: false }],
      pageParams: [0],
    });
    const html = render(conceptBuild('muscle'), { initialShop: 'weapons' }, (node) => <QueryClientProvider client={qc}>{node}</QueryClientProvider>);
    const shop = sectionOf(html, 'gear-shop');
    expect(shop).toMatch(/aria-pressed="true"[^>]*data-shelf="weapons"/);
    expect(copy(shop)).toContain('Showing 2 of 2 weapons');
    expect(shop).toMatch(/data-over="yes"[\s\S]*Availability 20 is over this campaign&#x27;s cap of 12\./);
    expect(shop).toContain('aria-label="buy Rook Pistol"');
    expect(copy(shop)).toContain('Rows marked R or F are Restricted or Forbidden');
  });

  it('writes one in through a labelled form that continues to the add panel', () => {
    const html = render(conceptBuild('muscle'), { initialShop: 'custom' });
    expect(html).toContain('data-testid="gear-custom"');
    const form = renderToStaticMarkup(
      <CustomPurchaseView value={{ ...EMPTY_CUSTOM, kind: 'augmentation', name: 'Invented Gill Pouch' }} onChange={noop} onContinue={noop} />,
    );
    expect(form).toContain('aria-label="Write in a purchase"');
    expect(copy(form)).toContain('continue with Invented Gill Pouch');
    expect(form).toContain('data-testid="gear-custom-essence"');
    expect(form).toContain('Cyberware or bioware');
    const empty = renderToStaticMarkup(<CustomPurchaseView value={EMPTY_CUSTOM} onChange={noop} onContinue={noop} />);
    expect(empty).toMatch(/aria-disabled="true"[^>]*data-testid="gear-custom-continue"/);
    expect(empty).not.toContain('gear-custom-essence');
  });
});

describe('read-only and review', () => {
  const build = withPurchase(conceptBuild('muscle'), hitToPurchase(rookPistol));

  it('shows what was bought and offers nothing', () => {
    const html = render(build, { readOnly: true });
    expect(html).not.toContain('data-testid="gear-shop"');
    expect(html).not.toContain('aria-label="edit Rook Pistol"');
    expect(html).not.toContain('gear-lifestyle-add');
    expect(html).not.toContain('aria-label="increase Karma converted to nuyen"');
    expect(html).not.toContain('data-testid="gear-checklist-browse"');
    expect(copy(html)).toContain('Rook Pistol');
    expect(copy(html)).toContain('Low · Low · 1 month');
  });

  it('lets the GM decide a Restricted line beside it', () => {
    const actions: BuildActions = { ...inertActions() };
    const html = render(build, { readOnly: true, reviewMode: true, role: 'gm', actions });
    // The player's coaching is not the GM's: no checklist, no card shopping list in review.
    expect(html).not.toContain('What most runners need');
    expect(html).not.toContain('data-testid="gear-suggestions"');
    expect(render(build, { readOnly: true })).toContain('What most runners need');
    expect(html).toContain('aria-label="approve: Rook Pistol is Restricted; the GM decides."');
    expect(html).toContain('aria-label="deny: Rook Pistol is Restricted; the GM decides."');
    const code = analysisOf(build).issues.find((i) => i.severity === 'approval' && i.path === 'purchases.0')!.code;
    const decided = render({ ...build, approvals: { [code]: 'approved' } }, { readOnly: true, reviewMode: true, role: 'gm', actions });
    expect(copy(decided)).toContain('the GM said yes');
    expect(decided).not.toContain('aria-label="approve:');
    expect(decided).toContain('aria-label="deny: Rook Pistol is Restricted; the GM decides."');
    const denied = copy(render({ ...build, approvals: { [code]: 'denied' } }, { readOnly: true }));
    expect(denied).toContain('the GM said no Rook Pistol is Restricted; the GM decides.');
    expect(denied).not.toContain('The GM said no.');
  });

  it('says what the step needs when no lifestyle is kept', () => {
    const html = render({ ...conceptBuild('muscle'), lifestyles: [] });
    const lifestyles = sectionOf(html, 'gear-lifestyles');
    expect(copy(lifestyles)).toContain('worth a look: Pick a lifestyle.');
    expect(copy(lifestyles)).toContain('Pick one');
    expect(lifestyles).not.toContain('data-testid="gear-starting-nuyen"');
  });
});
