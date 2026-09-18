/**
 * The Gear step's pure half (`gear.ts`): what the checklist ticks, what a line
 * says, what an edit changes, where the nuyen came from and what carries, how
 * a lifestyle is priced for this runner, and what a purchase would do before
 * it is made — the cap it refuses with the engine's sentence, the overspend it
 * allows, the Magic it would take, the other step it would break, the GM's
 * part. Builds come from the rules' own concept cards (`conceptBuild`), so the
 * numbers asserted are the engine's; every item, alias and figure typed here
 * is invented (DESIGN.md §14).
 */
import { describe, expect, it } from 'vitest';
import { BuildPurchaseSchema, type BuildPurchaseInput, type CharacterBuild } from '@safehouse/contracts';
import { hitToPurchase } from '../../kit/index.js';
import { SETTINGS, analysisOf, blankBuild, catalogueHit, conceptBuild } from '../../testing.js';
import {
  CHECKLIST_CODES,
  GEAR_SHELVES,
  NUYEN_CODES,
  addLabel,
  approvalsByLine,
  attributeLoss,
  carryWords,
  conceptSuggestions,
  customPurchaseHit,
  draftPurchase,
  draftRefusal,
  gradeOptions,
  groupPurchases,
  groupWords,
  initialDraft,
  issuesForLine,
  karmaConversion,
  lifestyleLines,
  lifestyleSurcharges,
  lifestyleWords,
  lineIndexOf,
  lineWords,
  nuyenSourceWords,
  nuyenSummary,
  priceMissing,
  quoteCandidate,
  quoteDraft,
  refusalFrom,
  runnerChecklist,
  shelfOf,
  shiftWords,
  startingNuyenWords,
  stepWideIssues,
  tierOptions,
  typedNumber,
  withKarmaToNuyen,
  withLifestyle,
  withLifestyleMonths,
  withLifestyleName,
  withLifestyleTier,
  withPurchase,
  withPurchaseChange,
  withoutLifestyle,
  withoutPurchase,
  type QuoteContext,
} from './gear.js';

// Invented purchase lines, in the shapes the rules' fixtures use.
const line = (input: BuildPurchaseInput) => BuildPurchaseSchema.parse(input);
const gear = (name: string, cost: number, extra: Partial<BuildPurchaseInput> = {}) =>
  line({ list: 'gear', kind: 'gear', name, cost, item: { name }, ...extra } as BuildPurchaseInput);
const commlink = () =>
  line({ list: 'gear', kind: 'electronics', name: 'Commlink', cost: 1_000, rating: 3, avail: '4', item: { name: 'Commlink', qty: 1, rating: 3 } } as BuildPurchaseInput);
const augment = (name: string, cost: number, essence: number, extra: Partial<BuildPurchaseInput> = {}) =>
  line({ list: 'augments', kind: 'augmentation', name, cost, essence, item: { name, essence, mods: [] }, ...extra } as BuildPurchaseInput);
const weapon = (name: string, cost: number, avail: string | null = null) =>
  hitToPurchase(
    catalogueHit({ id: `w-${name}`, kind: 'weapon', category: 'HEAVY PISTOLS', name, stats: { ACC: '5', DAMAGE: '8P', AP: '-1', MODE: 'SA' }, avail, cost }),
  );
const armor = (name: string, cost: number) =>
  hitToPurchase(catalogueHit({ id: `a-${name}`, kind: 'armor', name, stats: { 'ARMOR RATING': '9' }, avail: '4', cost }));

const ctxOf = (build: CharacterBuild): QuoteContext => {
  const a = analysisOf(build);
  return { build, settings: SETTINGS, budgets: a.budgets, probe: a.probe };
};

const glassEye = catalogueHit({
  id: 'w-eye',
  kind: 'augmentation',
  category: 'EYEWARE',
  name: 'Glass Eye',
  stats: { ESSENCE: '1.2' },
  avail: '12R',
  cost: 4_000,
});

describe('the shelves and the checklist', () => {
  it('shops weapons, armor, ware, commlinks, identities, vehicles and the rest, identities opened on a word', () => {
    expect(GEAR_SHELVES.map((s) => s.id)).toEqual(['weapons', 'ammo', 'armor', 'ware', 'electronics', 'identity', 'vehicles', 'programs', 'gear']);
    expect(shelfOf('identity')).toMatchObject({ kind: 'gear', query: 'fake' });
    expect(shelfOf('ware').kind).toBe('augmentation');
  });

  it('ticks commlink, SIN and lifestyle off the engine’s warnings, the rest off the lists', () => {
    const build = conceptBuild('muscle');
    const open = runnerChecklist(build, analysisOf(build).issues);
    expect(open.map((r) => [r.key, r.done])).toEqual([
      ['commlink', false],
      ['fakeSin', false],
      ['licences', false],
      ['armor', false],
      ['weapon', false],
      ['ammo', false],
      ['lifestyle', true],
    ]);
    const kitted = {
      ...build,
      purchases: [
        commlink(),
        gear('Fake SIN', 7_500, { rating: 3, avail: '9' }),
        gear('Fake License (firearms)', 600),
        armor('Padded Coat', 900),
        weapon('Rook Pistol', 450),
        gear('Regular rounds', 20, { kind: 'ammo', qty: 3 }),
      ],
    };
    expect(runnerChecklist(kitted, analysisOf(kitted).issues).every((r) => r.done)).toBe(true);
    const homeless = { ...build, lifestyles: [] };
    expect(runnerChecklist(homeless, analysisOf(homeless).issues).find((r) => r.key === 'lifestyle')?.done).toBe(false);
    expect([...CHECKLIST_CODES].sort()).toEqual(['commlink-missing', 'fake-sin-missing', 'lifestyle-missing']);
  });

  it('lists the concept card’s shopping in its own words, each on its shelf', () => {
    const suggestions = conceptSuggestions(conceptBuild('muscle'));
    expect(suggestions?.title).toBe('Chromed-up muscle');
    expect(suggestions?.items).toContainEqual({ hint: 'rifle ammunition', qty: 3, shelf: 'ammo' });
    expect(suggestions?.items).toContainEqual({ hint: 'heavy pistol', qty: 1, shelf: 'weapons' });
    expect(suggestions?.items.find((i) => i.hint === 'fake SIN')?.shelf).toBe('identity');
    expect(conceptSuggestions(blankBuild())).toBeNull();
  });
});

describe('grades', () => {
  it('offers the creation grades first and greys the others with the page', () => {
    const options = gradeOptions();
    expect(options.map((o) => o.grade)).toEqual(['standard', 'alphaware', 'used', 'betaware', 'deltaware']);
    expect(options.find((o) => o.grade === 'alphaware')).toMatchObject({ atCreation: true, refusal: null, detail: 'Essence ×0.8 · price ×1.2 · Availability +2' });
    expect(options.find((o) => o.grade === 'deltaware')?.refusal).toEqual({ reason: 'not at creation', ref: { book: 'SR5', page: 95 } });
  });
});

describe('a purchase line in words', () => {
  it('says unit × quantity, the grade, Essence at the grade, the rating and Availability with the grade', () => {
    const eyes = augment('Glass Eye', 4_000, 0.5, { grade: 'alphaware', qty: 2, avail: '6', rating: 2 });
    expect(lineWords(eyes)).toEqual(['4,800¥ × 2 = 9,600¥', 'alphaware', 'Essence 0.8', 'rating 2', 'Availability 8']);
    expect(lineWords(commlink())).toEqual(['1,000¥', 'rating 3', 'Availability 4']);
  });

  it('groups by list in the sheet’s order with subtotals, keeping each line’s index', () => {
    const purchases = [commlink(), augment('Glass Eye', 4_000, 0.5), weapon('Rook Pistol', 450), augment('Quiet Gland', 2_000, 0.25, { grade: 'used' })];
    const groups = groupPurchases(purchases);
    expect(groups.map((g) => g.list)).toEqual(['weapons', 'augments', 'gear']);
    const ware = groups[1]!;
    expect(ware.lines.map((l) => l.index)).toEqual([1, 3]);
    expect(ware.subtotal).toBe(5_500);
    expect(groupWords(ware)).toBe('2 lines · 5,500¥ · Essence 0.8125');
    expect(groupWords(groups[0]!)).toBe('1 line · 450¥');
  });

  it('files an issue on its line by path, and keeps what the panels say out of the step-wide list', () => {
    expect(lineIndexOf('purchases.3.avail')).toBe(3);
    expect(lineIndexOf('purchases.12')).toBe(12);
    expect(lineIndexOf('purchases')).toBeNull();
    expect(lineIndexOf('lifestyles.0')).toBeNull();
    const build = withPurchase(conceptBuild('muscle'), weapon('Siege Cannon', 9_000, '20F'));
    const issues = analysisOf(build).issues.filter((i) => i.step === 7);
    expect(issuesForLine(issues, 0).map((i) => i.code)).toContain('availability-over');
    const wide = stepWideIssues(issues).map((i) => i.code);
    expect(wide).not.toContain('availability-over');
    expect(wide.some((c) => CHECKLIST_CODES.has(c) || NUYEN_CODES.has(c))).toBe(false);
  });

  it('shows the GM’s part per line, decided or not', () => {
    const build = withPurchase(conceptBuild('muscle'), weapon('Rook Pistol', 450, '4R'));
    const undecided = approvalsByLine(build, SETTINGS).get(0) ?? [];
    expect(undecided).toHaveLength(1);
    expect(undecided[0]).toMatchObject({ decision: null, issue: { message: 'Rook Pistol is Restricted; the GM decides.' } });
    const code = undecided[0]!.issue.code;
    const approved = approvalsByLine({ ...build, approvals: { [code]: 'approved' } }, SETTINGS).get(0);
    expect(approved?.[0]?.decision).toBe('approved');
    expect(approvalsByLine(conceptBuild('muscle'), SETTINGS).size).toBe(0);
  });
});

describe('updaters', () => {
  const build = { ...conceptBuild('muscle'), purchases: [commlink(), augment('Glass Eye', 4_000, 0.5)] };

  it('adds, changes and removes purchase lines without touching the rest', () => {
    const more = withPurchaseChange(build, 1, { qty: 2.4, grade: 'used', cost: -5 });
    expect(more.purchases[1]).toMatchObject({ qty: 2, grade: 'used', cost: 0 });
    expect(more.purchases[0]).toBe(build.purchases[0]);
    expect(withPurchaseChange(build, 0, { grade: 'alphaware' }).purchases[0]?.grade).toBeNull();
    expect(withPurchaseChange(build, 0, { qty: 0 }).purchases[0]?.qty).toBe(1);
    expect(withPurchaseChange(build, 9, { qty: 2 })).toBe(build);
    expect(withoutPurchase(build, 0).purchases.map((p) => p.name)).toEqual(['Glass Eye']);
    expect(withoutPurchase(build, 5)).toBe(build);
    expect(withPurchase(build, weapon('Rook Pistol', 450)).purchases).toHaveLength(3);
  });

  it('keeps lifestyles named, priced by tier and paid at least a month', () => {
    const two = withLifestyle(build, 'middle');
    expect(two.lifestyles[1]).toEqual({ tier: 'middle', name: 'Middle', months: 1 });
    expect(withLifestyleMonths(two, 1, 0).lifestyles[1]?.months).toBe(1);
    expect(withLifestyleMonths(two, 1, 3).lifestyles[1]?.months).toBe(3);
    expect(withLifestyleTier(two, 1, 'high').lifestyles[1]).toMatchObject({ tier: 'high', name: 'High' });
    const named = withLifestyleName(two, 1, 'Middle (safehouse)');
    expect(withLifestyleTier(named, 1, 'high').lifestyles[1]).toMatchObject({ tier: 'high', name: 'Middle (safehouse)' });
    expect(withLifestyleName(two, 1, '   ').lifestyles[1]?.name).toBe('Middle');
    expect(withoutLifestyle(two, 0).lifestyles.map((l) => l.tier)).toEqual(['middle']);
    expect(withKarmaToNuyen(build, 3.2).karma.toNuyen).toBe(3);
    expect(withKarmaToNuyen(build, -1).karma.toNuyen).toBe(0);
  });
});

describe('nuyen', () => {
  it('takes the pool apart into Resources and converted Karma, and says what carries', () => {
    const build = withKarmaToNuyen(conceptBuild('muscle'), 2);
    const a = analysisOf(build);
    const s = nuyenSummary(build, SETTINGS, a.budgets);
    expect(s).toMatchObject({ resourcesLevel: 'A', fromResources: 450_000, fromKarma: 4_000, carryCap: 5_000, carried: 5_000 });
    expect(nuyenSourceWords(s, 2)).toBe('Resources A gives 450,000¥, and 2 Karma converted gives 4,000¥.');
    expect(carryWords(s)).toBe(`Up to 5,000¥ carries into play; the other ${(s.pool.remaining - 5_000).toLocaleString('en-US')}¥ is lost.`);
    expect(carryWords({ ...s, carried: 3_200, lost: 0 })).toBe('All 3,200¥ left carries into play (up to 5,000¥ may).');
    expect(nuyenSourceWords(nuyenSummary(blankBuild(), SETTINGS, analysisOf(blankBuild()).budgets), 0)).toBe('No Resources priority is chosen yet.');
  });

  it('converts Karma up to the level’s limit, refused past it in the engine’s words', () => {
    const build = withKarmaToNuyen(conceptBuild('muscle'), 10);
    const conversion = karmaConversion(build, SETTINGS);
    expect(conversion).toMatchObject({ value: 10, max: 10, perKarma: 2_000, ref: { book: 'SR5', page: 94 } });
    const refusal = refusalFrom(analysisOf(build).probe((b) => withKarmaToNuyen(b, 11)));
    expect(refusal?.reason).toBe('11 Karma converted; experienced allows 10.');
    expect(refusalFrom(analysisOf(build).probe((b) => withKarmaToNuyen(b, 9)))).toBeNull();
  });
});

describe('lifestyles', () => {
  it('prices every lifestyle for this runner, and names the surcharge with its page', () => {
    const troll = conceptBuild('muscle');
    const multiplier = analysisOf(troll).budgets.preview?.lifestyleMultiplier ?? 1;
    expect(multiplier).toBe(2);
    const [low] = lifestyleLines(withLifestyleMonths(troll, 0, 3), multiplier, 1);
    expect(low).toMatchObject({ listed: 2_000, monthly: 4_000, total: 12_000 });
    expect(lifestyleWords(low!)).toBe('4,000¥ a month × 3 = 12,000¥');
    expect(lifestyleSurcharges(multiplier, 1)).toEqual([{ text: 'This metatype pays +100% on every lifestyle.', ref: { book: 'SR5', page: 66 } }]);
    expect(lifestyleSurcharges(1, 1.2).map((s) => s.text)).toEqual(['Dependents add +20%.']);
    expect(lifestyleSurcharges(1, 1)).toEqual([]);
    expect(tierOptions(multiplier, 1).find((o) => o.tier === 'middle')).toEqual({ tier: 'middle', label: 'Middle', monthly: 10_000, dice: '4D6 × 100¥' });
  });

  it('states the starting-nuyen dice the dearest lifestyle sets', () => {
    const build = withLifestyle(conceptBuild('muscle'), 'high');
    expect(startingNuyenWords(build, analysisOf(build).budgets)?.text).toContain('5D6 × 500¥ is rolled for starting nuyen (the High lifestyle sets the dice)');
    const none = { ...build, lifestyles: [] };
    expect(startingNuyenWords(none, analysisOf(none).budgets)).toBeNull();
  });
});

describe('before the tap', () => {
  it('reads a picked row at its grade: price, Essence, Availability, and the GM’s part', () => {
    const ctx = ctxOf(conceptBuild('muscle'));
    const draft = initialDraft(glassEye);
    expect(draft).toEqual({ qty: 1, rating: null, grade: 'standard', price: null });
    const quote = quoteDraft(glassEye, draft, ctx);
    expect(quote).toMatchObject({ cost: 4_000, essence: 1.2, availability: 'Availability 12R', error: null, priceMissing: false });
    expect(quote.quote?.refusal).toBeNull();
    expect(quote.quote?.loss).toBeNull();
    expect(quote.notes.map((n) => [n.severity, n.message])).toEqual([['approval', 'Glass Eye is Restricted; the GM decides.']]);
    expect(addLabel('Glass Eye', quote)).toBe('add Glass Eye for 4,000¥');
  });

  it('refuses a grade that breaks the cap, with the engine’s sentence and page', () => {
    const ctx = ctxOf(conceptBuild('muscle'));
    const alpha = quoteDraft(glassEye, { ...initialDraft(glassEye), grade: 'alphaware' }, ctx);
    expect(alpha.quote?.refusal).toEqual({ reason: 'Glass Eye is Availability 14; the cap is 12.', ref: { book: 'SR5', page: 94 } });
    expect(draftRefusal(glassEye, { ...initialDraft(glassEye), grade: 'used' }, ctx)).toBeNull();
    const delta = draftRefusal(glassEye, { ...initialDraft(glassEye), grade: 'deltaware' }, ctx);
    expect(delta?.reason).toMatch(/deltaware is not available at creation|Availability 20/);
  });

  it('allows an overspend of nuyen, and says it on the price', () => {
    const poor = conceptBuild('street-mage');
    const ctx = ctxOf(poor);
    const pricey = catalogueHit({ id: 'g-1', kind: 'gear', name: 'Invented Van Keys', cost: 90_000, avail: '4' });
    const quote = quoteDraft(pricey, initialDraft(pricey), ctx);
    expect(quote.quote?.refusal).toBeNull();
    expect(quote.quote?.change.nuyen.after).toBeLessThan(0);
  });

  it('warns before Essence takes Magic, in numbers, and the add button says it', () => {
    const ctx = ctxOf(conceptBuild('street-mage'));
    const quote = quoteDraft(glassEye, initialDraft(glassEye), ctx);
    expect(quote.quote?.loss).toMatchObject({ attribute: 'Magic', before: 6, after: 4, ref: { book: 'SR5', page: 95 } });
    expect(quote.quote?.loss?.text).toBe('This takes Magic from 6 to 4: every point of Essence lost, or part of one, costs a point of Magic.');
    expect(addLabel('Glass Eye', quote)).toBe('add Glass Eye for 4,000¥, and lose 2 Magic');
    expect(shiftWords(quote.quote!.change)).toEqual(['Essence 6 → 4.8', 'Magic 6 → 4']);
    expect(shiftWords(quoteDraft(glassEye, initialDraft(glassEye), ctxOf(conceptBuild('muscle'))).quote!.change)).toEqual(['Essence 6 → 4.8']);
    expect(attributeLoss({ nuyen: { before: 1, after: 0 }, essence: { before: 6, after: 6 }, magic: { before: 6, after: 6 }, resonance: null })).toBeNull();
  });

  it('names what an implant breaks on another step instead of refusing it', () => {
    const adept = conceptBuild('adept');
    const powered: CharacterBuild = { ...adept, powers: [{ name: 'Invented Reflex Trick', cost: 6, levels: 1, mods: [] }] };
    const ctx = ctxOf(powered);
    const quote = quoteCandidate(withPurchase(powered, augment('Glass Eye', 4_000, 1.2)), 'adept-eye', ctx);
    expect(quote.refusal).toBeNull();
    expect(quote.consequences.map((i) => [i.code, i.step])).toContainEqual(['power-points-over', 4]);
    expect(quote.loss?.after).toBe(4);
  });

  it('asks for a price only when the row prints none this can read', () => {
    const unpriced = catalogueHit({ id: 'g-2', kind: 'gear', name: 'Invented Favour', cost: null, costText: 'Varies' });
    expect(priceMissing(unpriced, initialDraft(unpriced))).toBe(true);
    expect(priceMissing(unpriced, { rating: null, price: 250 })).toBe(false);
    expect(priceMissing(glassEye, initialDraft(glassEye))).toBe(false);
    expect(draftPurchase(catalogueHit({ name: '' }), initialDraft(catalogueHit())).error).toMatch(/write it in by hand/);
  });
});

describe('writing a purchase in', () => {
  it('turns the fields into a row the add panel can quote, bioware told from cyberware', () => {
    const base = { kind: 'augmentation' as const, name: '', price: '2,500¥', avail: '6', essence: '0.3', ware: 'bioware' as const, rating: '' };
    expect(customPurchaseHit(base)).toBeNull();
    const hit = customPurchaseHit({ ...base, name: '  Invented Gill Pouch ' })!;
    expect(hit).toMatchObject({ id: 'custom', name: 'Invented Gill Pouch', category: 'BIOWARE', cost: 2_500, avail: '6', stats: { ESSENCE: '0.3' } });
    const { purchase } = draftPurchase(hit, initialDraft(hit));
    expect(purchase).toMatchObject({ list: 'augments', cost: 2_500, essence: 0.3, grade: 'standard' });
    expect(purchase?.catalogueId).toBeUndefined();
    const plain = customPurchaseHit({ ...base, kind: 'gear', name: 'Invented Lockpick', essence: '9', rating: '2' })!;
    expect(plain.stats).toEqual({ RATING: '2' });
    expect(typedNumber(' 1,200 ')).toBe(1_200);
    expect(typedNumber('abc')).toBeNull();
    expect(typedNumber('')).toBeNull();
  });
});
