/**
 * Step 8 rendered to static markup (`steps/Karma.tsx` and its sections) over
 * builds the engine made from concept cards — invented runners only (§14).
 *
 * Pinned: the Karma left is the first and largest thing, with where it came
 * from and the carry-over marked in words when the cap would lose some or the
 * pool is overspent; every spend is listed with its price and an undo; each
 * raise quotes its next rating's price before the tap, and a refused one says
 * why in the engine's words, tied to its button, the button still focusable;
 * Uncouth's doubled price is the one shown; the Awakened and Emerged see
 * spells, forms, power points, spirits, sprites and foci and a mundane does
 * not; contacts carry their own pool, their steppers refuse the eighth point
 * with its sentence; read-only and review render every value and no control;
 * and the page is lists under h2/h3 headings with every field labelled.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuildPurchaseSchema, chargenSettingsForLevel, type CharacterBuild } from '@safehouse/contracts';
import { SPRITE_TYPE_IDS, setMagicKind } from '@safehouse/rules';
import { issuesForStep } from '../../lib.js';
import { BUILD_ID, CAMPAIGN, SETTINGS, analysisOf, blankBuild, conceptBuild } from '../../testing.js';
import KarmaStep from '../Karma.js';
import { stepMeta } from '../meta.js';
import { inertActions, type StepProps } from '../types.js';
import { setInitiateGrade, withContactPatch, withNewContact, withRaise, withSpend } from './logic.js';

const noop = () => undefined;

function propsFor(build: CharacterBuild, over: Partial<StepProps> = {}): StepProps {
  // The engine is run with whatever settings the props carry, so a test that
  // renders a prime table gets a prime table's pools as well as its rules.
  const a = analysisOf(build, over.settings ?? SETTINGS);
  return {
    campaignId: CAMPAIGN,
    buildId: BUILD_ID,
    characterId: null,
    isOwner: true,
    meta: stepMeta(8),
    build,
    settings: SETTINGS,
    settingsFromCampaign: true,
    budgets: a.budgets,
    issues: issuesForStep(a.issues, 8),
    allIssues: a.issues,
    status: a.steps[7]!,
    steps: a.steps,
    eligibility: a.eligibility,
    preview: a.preview,
    ratings: a.ratings,
    probe: a.probe,
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

const render = (build: CharacterBuild, over: Partial<StepProps> = {}) => renderToStaticMarkup(<KarmaStep {...propsFor(build, over)} />);

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** The markup of one section, by its test id. */
function section(html: string, testId: string): string {
  const start = html.indexOf(`data-testid="${testId}"`);
  if (start < 0) throw new Error(`no section ${testId}`);
  const open = html.lastIndexOf('<section', start);
  const close = html.indexOf('</section>', start);
  return html.slice(open, close + '</section>'.length);
}

/** The raise row whose visible name is `name`. */
function raiseRow(html: string, name: string): string {
  const rows = html.split('data-testid="karma-raise"').slice(1);
  const row = rows.find((r) => r.includes(`<div class="text-sm text-ink">${name}</div>`));
  if (!row) throw new Error(`no raise row ${name}`);
  return row.slice(0, row.indexOf('</li>'));
}

const button = (html: string, label: string) => new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html)?.[0] ?? null;

/** A troll bruiser: Body at its maximum, Charisma 1, Automatics 5. */
const bruiser = () => conceptBuild('muscle', 'Slab Harrow');
/** A hermetic street mage: Magic 6, Charisma 3. */
const mage = () => conceptBuild('street-mage', 'Vesper Quill');

describe('the Karma step', () => {
  it('opens with the Karma left, where it came from, and the carry-over marked when the cap would lose some', () => {
    const html = render(bruiser());
    const all = text(html);
    expect(html.indexOf('data-testid="karma-header"')).toBeLessThan(html.indexOf('data-testid="karma-ledger"'));
    expect(/data-testid="karma-left"[^>]*>([^<]*<[^>]*>)*?25/.test(html)).toBe(true);
    expect(all).toContain('25 Karma left');
    expect(html).toMatch(/data-line="start"/);
    const carry = /<p[^>]*data-testid="karma-carry"[^>]*>/.exec(html)![0];
    expect(carry).toContain('data-over-carry="yes"');
    expect(all).toContain('At most 7 Karma carries into play, so 18 more must be spent before this step is done.');
    expect(all).toContain('SR5 p.98');
    // Nothing spent yet: the ledger says what it is for.
    expect(html).toContain('data-testid="karma-ledger-empty"');
  });

  it('renders a build with nothing chosen yet', () => {
    const html = render(blankBuild('Kestrel Vane'));
    expect(text(html)).toContain('25 Karma left');
    expect(html).toContain('data-testid="karma-attributes"');
    expect(text(section(html, 'karma-skills'))).toContain('No active skills are rated yet.');
    expect(text(section(html, 'karma-specs'))).toContain('A specialisation needs a rated skill to go on.');
  });

  it('lists every spend with its price and an undo, and the carry within the cap reads as done', () => {
    let b = withRaise(bruiser(), { kind: 'skill', id: 'automatics' }, 5); // 12
    b = withRaise(b, { kind: 'skill', id: 'pistols' }, 4); // 10 → 3 left
    const html = render(b);
    const ledger = section(html, 'karma-ledger');
    expect(ledger.match(/data-testid="karma-spend"/g)).toHaveLength(2);
    expect(text(ledger)).toContain('Automatics 5 → 6');
    expect(text(ledger)).toContain('12 Karma');
    expect(button(ledger, 'undo Automatics 5 → 6, giving back 12 Karma')).not.toBeNull();
    expect(ledger).toContain('<ol');
    const carry = /<p[^>]*data-testid="karma-carry"[^>]*>/.exec(html)![0];
    expect(carry).toContain('data-over-carry="no"');
    expect(text(html)).toContain('All 3 carries into play (at most 7 may).');
  });

  it("files the validator's finding under the spend it names", () => {
    const stale = withSpend(bruiser(), { kind: 'skill', id: 'automatics', from: 3, to: 4 });
    const ledger = section(render(stale), 'karma-ledger');
    expect(ledger).toContain('data-issue="karma-spend-stale"');
    expect(text(ledger)).toContain('Automatics is 5 now, not 3; redo this raise.');
  });

  it('quotes the next rating before the tap, and refuses past the cap with the sentence tied to the button', () => {
    const at6 = withRaise(bruiser(), { kind: 'skill', id: 'automatics' }, 5);
    const html = render(at6);
    const open = raiseRow(html, 'Pistols');
    expect(text(open)).toContain('to 5: costs 10 Karma — you have 13');
    expect(button(open, 'increase Pistols')).not.toContain('aria-disabled');
    // The quote is what the + button says it does.
    const quoteId = /aria-describedby="([^"]+)"/.exec(button(open, 'increase Pistols')!)![1]!;
    expect(open).toMatch(new RegExp(`<p id="${quoteId}"[^>]*data-testid="karma-next-price"`));

    const shut = raiseRow(html, 'Automatics');
    const up = button(shut, 'increase Automatics')!;
    expect(up).toContain('aria-disabled="true"');
    expect(up).not.toMatch(/\sdisabled=""/);
    const id = /aria-describedby="([^"]+)"/.exec(up)![1]!;
    expect(shut).toMatch(new RegExp(`<p id="${id}"[^>]*data-refusal="increase"`));
    expect(text(shut)).toContain('Automatics 7 is over the creation maximum of 6.');
    // Unpressed, quietly: a neutral "at the cap" on screen (the ⛔ and SR5 p.88 come with the press), under the whole row.
    expect(shut).toContain('data-voice="quiet"');
    expect(shut).toContain('<span aria-hidden="true">at the cap</span>');
    expect(shut).not.toContain('⛔');
    expect(/data-testid="karma-raise-stepper">(.*?)<\/div><\/div>/.exec(shut)![1]).not.toContain('data-refusal');
    expect(shut).not.toContain('data-testid="karma-next-price"');
    // What this step raised can be taken back from the stepper.
    expect(button(shut, 'decrease Automatics')).not.toContain('aria-disabled');
  });

  it('refuses a second attribute at its maximum, and a price the pool cannot pay, in words', () => {
    const html = render(bruiser());
    expect(text(raiseRow(html, 'Strength'))).toContain('This costs 45 Karma and 25 are left.');
    const mageHtml = render(mage());
    expect(text(raiseRow(mageHtml, 'Willpower'))).toMatch(/Only one attribute may start at its natural maximum/);
    expect(text(raiseRow(mageHtml, 'Intuition'))).toContain('Taking it also leaves: 2 knowledge points still to spend. (step 6)');
  });

  it('shows the doubled price Uncouth sets, from the engine', () => {
    const rude = { ...bruiser(), qualities: [{ name: 'Uncouth', type: 'negative' as const, karma: 14, rating: null, mods: [] }] };
    expect(text(raiseRow(render(bruiser()), 'Intimidation'))).toContain('to 4: costs 8 Karma');
    expect(text(raiseRow(render(rude), 'Intimidation'))).toContain('to 4: costs 16 Karma');
  });

  it('says an overspend in words and refuses every further price', () => {
    const over = withRaise(bruiser(), { kind: 'attribute', id: 'str' }, 8); // 45 of 25
    const html = render(over);
    expect(text(section(html, 'karma-header'))).toContain('Karma overspent');
    expect(/<p[^>]*data-testid="karma-left"[^>]*>/.exec(html)![0]).toContain('data-over="yes"');
    expect(/<p[^>]*data-testid="karma-carry"[^>]*>/.exec(html)![0]).toContain('data-overspent="yes"');
    expect(text(html)).toContain('20 Karma overspent: take something back before this step is done.');
    expect(text(raiseRow(html, 'Pistols'))).toContain('Karma is already 20 over; take something back first.');
  });

  it('keeps magic out of a mundane runner’s way', () => {
    const html = render(bruiser());
    expect(html).toContain('data-testid="karma-magic-none"');
    for (const id of ['karma-spells', 'karma-forms', 'karma-power-points', 'karma-spirits', 'karma-sprites', 'karma-foci']) {
      expect(html).not.toContain(`data-testid="${id}"`);
    }
  });

  it('gives a magician spells, spirits and foci, each priced before the tap', () => {
    const html = render(mage());
    const spells = section(html, 'karma-spells');
    expect(text(spells)).toContain('costs 5 Karma — you have 25');
    expect(/<button[^>]*data-testid="karma-spell-open"[^>]*>/.exec(spells)![0]).toContain('aria-expanded="false"');
    // The list mounts only when opened.
    expect(spells).not.toContain('data-testid="karma-spell-picker"');

    const spirits = section(html, 'karma-spirits');
    expect(text(spirits)).toContain('Force 6');
    expect(text(spirits)).toContain('Charisma 3');
    expect(button(spirits, 'bind an air spirit owing 1 service')).not.toBeNull();
    expect(text(spirits)).toContain('costs 1 Karma — you have 25');

    const foci = section(html, 'karma-foci');
    expect(text(foci)).toContain('No focus is in the gear yet');
    expect(foci).toContain('data-testid="karma-foci-gear"');
    expect(text(foci)).toContain('12 of 12 points of bonded Force left');
    expect(html).not.toContain('data-testid="karma-sprites"');
  });

  it('offers a bought focus to bond at the Focus Table’s price', () => {
    const charm = BuildPurchaseSchema.parse({
      list: 'gear',
      kind: 'gear',
      name: 'Tidecall Charm',
      category: 'power focus',
      rating: 2,
      cost: 36_000,
      item: { name: 'Tidecall Charm', qty: 1 },
    });
    const foci = section(render({ ...mage(), purchases: [charm] }), 'karma-foci');
    expect(foci).toContain('data-testid="karma-focus-candidate"');
    expect(text(foci)).toContain('bought at Force 2');
    expect(button(foci, 'bond Tidecall Charm as a power focus at Force 2')).not.toBeNull();
    expect(text(foci)).toContain('costs 12 Karma — you have 25');
  });

  it('gives a technomancer complex forms and sprites, and a mystic adept power points', () => {
    const techno = render(conceptBuild('technomancer', 'Null Sable'));
    expect(techno).toContain('data-testid="karma-forms"');
    expect(techno).toContain('data-testid="karma-sprites"');
    expect(text(section(techno, 'karma-forms'))).toContain('costs 4 Karma');
    expect(techno).not.toContain('data-testid="karma-spirits"');
    // A sprite's type is picked from the engine's list, like a spirit's, so registering one is a price, not a blank to fill.
    const sprites = section(techno, 'karma-sprites');
    const select = /<select[^>]*data-testid="karma-sprite-type"[^>]*>(.*?)<\/select>/.exec(sprites)![1]!;
    expect([...select.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1])).toEqual([...SPRITE_TYPE_IDS]);
    expect(sprites).not.toContain('Name the sprite type first.');
    expect(sprites).not.toMatch(/<input[^>]*maxLength="80"/i);
    expect(text(sprites)).toContain('costs 1 Karma');

    const adept = render(setMagicKind(mage(), 'mysticAdept'));
    const pp = section(adept, 'karma-power-points');
    expect(button(pp, 'increase Power points bought')).not.toContain('aria-disabled');
    expect(text(pp)).toContain('one more: costs 5 Karma — you have 25');
  });

  it('offers initiation only to a prime table, and only to a runner with something to initiate', () => {
    // Step 1 tells a prime table "Initiation at creation: allowed"; before the
    // spend existed there was no control anywhere that could take it.
    const PRIME = chargenSettingsForLevel('prime');
    const atPrime = (b: CharacterBuild): CharacterBuild => ({ ...b, level: 'prime' });
    expect(render(mage())).not.toContain('data-testid="karma-initiation"');
    const prime = render(atPrime(mage()), { settings: PRIME });
    const init = section(prime, 'karma-initiation');
    expect(text(init)).toContain('Initiation');
    // 10 + grade x 3 = 13 for grade 1, quoted before the tap.
    expect(text(init)).toContain('grade 1: costs 13 Karma');
    expect(button(init, 'increase Initiation grade')).not.toContain('aria-disabled');
    // A technomancer submerges, and the section calls it that.
    const emerged = render(atPrime(conceptBuild('technomancer', 'Null Sable')), { settings: PRIME });
    expect(text(section(emerged, 'karma-initiation'))).toContain('Submersion');
    // A mundane sees nothing to initiate.
    expect(render(atPrime(bruiser()), { settings: PRIME })).not.toContain('data-testid="karma-initiation"');
  });

  it('charges a grade taken, lists it, and lets it be taken back', () => {
    const PRIME = chargenSettingsForLevel('prime');
    const two = setInitiateGrade({ ...mage(), level: 'prime' }, 2);
    expect(two.karma.spends.filter((s) => s.kind === 'initiation').map((s) => (s as { grade: number }).grade)).toEqual([1, 2]);
    const html = render(two, { settings: PRIME });
    expect(text(html)).toContain('Grade 1');
    expect(text(html)).toContain('Grade 2');
    // 13 + 16 = 29 Karma of a prime runner's 35, so grade 3's 19 is refused
    // in the engine's own words rather than quoted as if it were affordable.
    expect(text(section(html, 'karma-initiation'))).toContain('This costs 19 Karma and 6 are left.');
    expect(setInitiateGrade(two, 0).karma.spends.some((s) => s.kind === 'initiation')).toBe(false);
  });

  it('runs contacts on their own pool, and refuses the eighth point on one', () => {
    const b = withContactPatch(withNewContact(mage()), 0, { name: 'Rook', role: 'fixer', connection: 4, loyalty: 3 });
    const html = render(b);
    const contacts = section(html, 'karma-contacts');
    expect(text(contacts)).toContain('2 of 9 contact Karma left');
    expect(contacts).toContain('<h3');
    expect(text(contacts)).toContain('7 contact Karma · at most 7');
    const loyalty = button(contacts, 'increase Loyalty of Rook')!;
    expect(loyalty).toContain('aria-disabled="true"');
    const id = /aria-describedby="([^"]+)"/.exec(loyalty)![1]!;
    expect(contacts).toMatch(new RegExp(`<p id="${id}"`));
    expect(text(contacts)).toContain('Rook costs 8 Karma; 7 is the most at creation.');
    expect(button(contacts, 'remove Rook')).not.toBeNull();
    expect(text(contacts)).toContain('costs 2 contact Karma — you have 2');
  });

  it('read-only renders every value and offers no control', () => {
    let b = withRaise(bruiser(), { kind: 'skill', id: 'automatics' }, 5);
    b = withContactPatch(withNewContact(b), 0, { name: 'Rook', role: 'fixer', connection: 2 });
    for (const over of [{ readOnly: true }, { reviewMode: true }] satisfies Partial<StepProps>[]) {
      const html = render(b, over);
      expect(html).toContain('data-readonly="yes"');
      expect(html).not.toContain('<button type="button" class="btn');
      expect(html).not.toContain('aria-label="increase');
      expect(html).not.toContain('data-testid="karma-undo"');
      expect(html).not.toContain('<input');
      expect(html).not.toContain('<select');
      expect(html).not.toContain('<textarea');
      const all = text(html);
      expect(all).toContain('Automatics 5 → 6');
      expect(all).toContain('fixer · Connection 2 · Loyalty 1');
      expect(all).toContain('13 Karma left');
    }
  });

  it('is lists under h2 and h3 headings, with every field labelled', () => {
    const html = render(withContactPatch(withNewContact(conceptBuild('street-mage')), 0, { name: 'Rook' }));
    expect(html).not.toContain('<h1');
    const headings = [...html.matchAll(/<h([23])/g)].map((m) => Number(m[1]));
    expect(headings[0]).toBe(2);
    // Never an h3 before the first h2, never a jump past h3.
    expect(headings.every((h) => h === 2 || h === 3)).toBe(true);
    for (const m of html.matchAll(/<(input|select|textarea)[^>]*>/g)) {
      const id = /\sid="([^"]+)"/.exec(m[0])?.[1];
      expect(id, m[0]).toBeTruthy();
      expect(html).toContain(`for="${id}"`);
    }
    for (const m of html.matchAll(/<button[^>]*>/g)) {
      const labelled = /aria-label="[^"]+"/.test(m[0]) || /data-testid="karma-(spell|form)-open"/.test(m[0]) || /data-testid="karma-foci-gear"/.test(m[0]) || /class="chip/.test(m[0]);
      expect(labelled, m[0]).toBe(true);
    }
    // One column on a phone: no fixed widths wider than a phone.
    expect(html).not.toMatch(/\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\]/);
    expect(html.match(/data-testid="karma-raise"/g)!.length).toBeGreaterThan(10);
    expect(html).toMatch(/<ul[^>]*aria-label="Attributes"/);
  });
});
