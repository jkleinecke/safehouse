/**
 * The Qualities screen rendered to static markup (`Qualities.tsx`), from
 * `StepProps` alone, on invented runners and rows (DESIGN.md §14).
 *
 * Pinned, for the states that matter: an empty step says both lists are
 * empty and optional, with the three pools in words and a way to add from
 * the books or by hand; a partly spent list shows each line's price, page,
 * effect, target picker (labelled), "needs the GM" and its remove button; a
 * list over its cap says so in words beside the pool and in the list's own
 * checks; a refused add keeps its button focusable, refusing, and tied to the
 * validator's sentence; a band's Karma and a rating are asked for; read-only
 * shows the choices with no controls, and the GM's review adds approve and
 * deny; a metatype's born quality offers its buy-off; phone structure is one
 * column that becomes two, headings stay under the frame's h1, lists are
 * lists. The live export mounts over a query client with the picker in place.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BuildQuality, CharacterBuild } from '@safehouse/contracts';
import type { CatalogueHit } from '../../../sheet/catalogue/toSheet.js';
import { CataloguePickerView } from '../../kit/CataloguePicker.js';
import { issuesForStep } from '../../lib.js';
import { BUILD_ID, CAMPAIGN, SETTINGS, analysisOf, blankBuild, catalogueHit, conceptBuild } from '../../testing.js';
import QualitiesStep, { QualitiesView, type QualitiesViewProps } from '../Qualities.js';
import { stepMeta } from '../meta.js';
import { inertActions, type StepProps } from '../types.js';
import { EMPTY_CUSTOM_QUALITY, startPending, type PendingQuality } from './model.js';

const noop = () => undefined;

const q = (over: Partial<BuildQuality> & Pick<BuildQuality, 'name' | 'type' | 'karma'>): BuildQuality => ({ rating: null, mods: [], ...over });

function stepProps(build: CharacterBuild, over: Partial<StepProps> = {}): StepProps {
  const analysis = analysisOf(build);
  return {
    campaignId: CAMPAIGN,
    buildId: BUILD_ID,
    characterId: null,
    isOwner: true,
    meta: stepMeta(5),
    build,
    settings: SETTINGS,
    settingsFromCampaign: true,
    budgets: analysis.budgets,
    issues: issuesForStep(analysis.issues, 5),
    allIssues: analysis.issues,
    status: analysis.steps[4]!,
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

const steadyHands = catalogueHit({ id: 'q-steady', kind: 'quality', category: 'POSITIVE QUALITIES', name: 'Steady Hands', stats: { KARMA: '10', TYPE: 'positive' }, printedPage: 402 });
const exceptional = catalogueHit({ id: 'q-ea', kind: 'quality', name: 'Exceptional Attribute', stats: { KARMA: '14', TYPE: 'positive' }, printedPage: 72 });
const dependents = catalogueHit({ id: 'q-dep', kind: 'quality', name: 'Dependents', stats: { KARMA: '3, 6 or 9', TYPE: 'negative' } });
const ironCalm = catalogueHit({ id: 'q-iron', kind: 'quality', name: 'Iron Calm', stats: { KARMA: '4', PER: 'rating', MAX: '3', TYPE: 'positive' } });

function render(build: CharacterBuild, over: Partial<QualitiesViewProps> = {}, step: Partial<StepProps> = {}): string {
  const base = stepProps(build, step);
  const hits: CatalogueHit[] = [steadyHands, exceptional];
  const props: QualitiesViewProps = {
    ...base,
    pending: null,
    onPendingChange: noop,
    onPendingConfirm: noop,
    onPendingCancel: noop,
    addMode: 'books',
    onAddMode: noop,
    custom: EMPTY_CUSTOM_QUALITY,
    onCustom: noop,
    customTried: false,
    onCustomSubmit: noop,
    onBuyOff: noop,
    note: null,
    picker: (
      <CataloguePickerView
        kind="quality"
        label="qualities"
        query=""
        onQuery={noop}
        hits={hits}
        total={2}
        hasMore={false}
        loading={false}
        loadingMore={false}
        error={null}
        onMore={noop}
        caps={SETTINGS}
        onPick={noop}
        pickLabel="take"
        testId="quality-picker"
      />
    ),
    ...over,
  };
  return renderToStaticMarkup(<QualitiesView {...props} />);
}

/** The markup of one section, by test id, up to the next sibling of the same kind. */
function part(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  if (at === -1) throw new Error(`no ${testId}`);
  return html.slice(at);
}

function rowsOf(html: string): string[] {
  return html.split('data-testid="quality-row"').slice(1);
}

function pendingFor(build: CharacterBuild, p: PendingQuality): string {
  return render(build, { pending: p });
}

describe('an empty step', () => {
  it('says both lists are empty and optional, with the pools in words and both ways to add', () => {
    const html = render(conceptBuild('muscle'));
    expect(html).toContain('data-testid="qualities-positive-empty"');
    expect(html).toContain('None taken. Positive qualities cost Karma; add one below, or leave this empty.');
    expect(html).toContain('None taken. Negative qualities give Karma; add one below, or leave this empty.');
    expect(html).toContain('25 of 25 Karma of positive qualities left');
    expect(html).toContain('25 of 25 Karma of negative qualities left');
    expect(html).toMatch(/data-pool="karma"[^>]*>[^<]*25 of 25 Karma left/);
    expect(html).toContain('data-testid="quality-picker"');
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*data-testid="qualities-add-books"/);
    expect(html).toContain('data-testid="qualities-add-custom"');
    expect(html).not.toContain('data-testid="qualities-loose"');
    expect(html).not.toContain('data-testid="qualities-born"');
  });

  it('keeps headings under the frame’s h1 and lays the lists out one column, two from a tablet up', () => {
    const html = render(conceptBuild('muscle'), {}, {});
    expect(html).not.toMatch(/<h1/);
    expect(html.match(/<h2/g)?.length).toBe(3);
    expect(html).toMatch(/class="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="qualities-lists"/);
    // The cap's page sits beside each list.
    expect(html.match(/data-testid="why-link"/g)?.length).toBe(2);
    expect(html).toContain('SR5 p.71');
  });
});

describe('a partly spent list', () => {
  const build: CharacterBuild = {
    ...conceptBuild('muscle'),
    qualities: [
      q({ name: 'Exceptional Attribute', type: 'positive', karma: 14, target: 'str', ref: { book: 'SR5', page: 72 } }),
      q({ name: 'Grudge Holder', type: 'negative', karma: 5, mods: [{ id: 'm-1', source: { kind: 'quality', ref: 'Grudge Holder' }, target: 'limit.social', op: 'add', value: -1, active: true }] }),
    ],
  };

  it('shows each line with its price, page, effect, labelled target, GM chip and remove', () => {
    const html = render(build);
    expect(html).toContain('11 of 25 Karma of positive qualities left');
    expect(html).toContain('20 of 25 Karma of negative qualities left');
    const [ea, grudge] = rowsOf(html);
    expect(ea).toContain('<h3');
    expect(ea).toContain('costs 14 Karma');
    expect(ea).toContain('SR5 p.72');
    expect(ea).toContain('One attribute you name may go 1 past its natural maximum (never Edge).');
    expect(ea).toMatch(/<select[^>]*aria-label="Which attribute\? — for Exceptional Attribute"/);
    expect(ea).toMatch(/<option value="str" selected="">Strength \(natural maximum \d+, \d+ with this\)<\/option>/);
    expect(ea).toContain('data-testid="quality-approval"');
    expect(ea).toContain('needs the GM · waiting on the GM');
    expect(ea).not.toContain('data-testid="quality-approve"');
    expect(ea).toMatch(/<button[^>]*aria-label="remove Exceptional Attribute"/);
    expect(ea).toContain('Spend the extra point of Strength on the attributes step.');
    expect(ea).toMatch(/aria-label="step 3 — go to Metatype &amp; attributes"/);
    expect(grudge).toContain('gives 5 Karma');
    expect(grudge).toContain('−1 Social limit');
    expect(grudge).toMatch(/aria-label="remove the modifier −1 Social limit from Grudge Holder"/);
    expect(grudge).toContain('enter another modifier');
    expect(grudge).toMatch(/<ul[^>]*aria-label="Modifiers entered for Grudge Holder"/);
  });

  it('asks for the attribute when none is named, with the engine’s sentence on the line', () => {
    const bare: CharacterBuild = { ...build, qualities: [q({ name: 'Exceptional Attribute', type: 'positive', karma: 14 })] };
    const [ea] = rowsOf(render(bare));
    expect(ea).toMatch(/<option value="" selected="">choose…<\/option>/);
    expect(ea).toContain('data-issue="exceptional-attribute-target"');
    expect(ea).toContain('Name the attribute Exceptional Attribute raises (not Edge).');
  });
});

describe('a list over its cap', () => {
  it('says the overspend in words beside the pool and in the list’s own checks', () => {
    const over: CharacterBuild = {
      ...conceptBuild('muscle'),
      qualities: [q({ name: 'Old Favour', type: 'positive', karma: 20 }), q({ name: 'Night Owl', type: 'positive', karma: 9 })],
    };
    const html = render(over);
    expect(html).toMatch(/data-pool="positiveQualities" data-over="yes"/);
    expect(html).toContain('4 Karma of positive qualities over: 29 spent of 25');
    const loose = part(html, 'qualities-loose');
    expect(loose).toContain('Checks on the lists');
    expect(loose).toContain('Positive qualities cost 29 Karma; the cap is 25.');
  });
});

describe('adding', () => {
  it('refuses Exceptional Attribute beside Lucky: the button stays focusable and names the validator’s sentence', () => {
    const build: CharacterBuild = { ...conceptBuild('muscle'), qualities: [q({ name: 'Lucky', type: 'positive', karma: 12 })] };
    const html = pendingFor(build, startPending(exceptional, { target: 'agi' }));
    const panel = part(html, 'quality-pending');
    expect(panel).toContain('data-can-add="no"');
    expect(panel).toContain('Adding Exceptional Attribute');
    expect(panel).toContain('The GM decides whether this runner may take it.');
    const button = /<button[^>]*data-testid="quality-pending-add"[^>]*>/.exec(panel)?.[0] ?? '';
    expect(button).toContain('aria-disabled="true"');
    expect(button).not.toContain(' disabled=""');
    expect(button).toContain('aria-label="add Exceptional Attribute to the positive qualities"');
    const reasonId = /id="([^"]+)"[^>]*data-testid="quality-pending-refusal"/.exec(panel)?.[1];
    expect(reasonId).toBeTruthy();
    expect(button).toMatch(new RegExp(`aria-describedby="[^"]*${reasonId!.replace(/[:]/g, '\\$&')}`));
    expect(part(panel, 'quality-pending-refusal')).toContain('Take Lucky or Exceptional Attribute, not both.');
    expect(panel).toMatch(/<select[^>]*data-testid="quality-pending-target"/);
    expect(panel).toContain('costs 14 Karma — you have 13');
  });

  it('asks a band for its Karma and a rated quality for its rating, with the price quoted', () => {
    const oldDebt = catalogueHit({ id: 'q-debt', kind: 'quality', name: 'Old Debt', stats: { KARMA: '3-9', TYPE: 'negative' } });
    const band = part(pendingFor(conceptBuild('muscle'), startPending(oldDebt)), 'quality-pending');
    expect(band).toContain('data-testid="quality-pending-band"');
    expect(band).toContain('aria-label="increase Karma for Old Debt"');
    expect(band).toContain('3 to 9 Karma, as the table agrees');
    expect(band).toContain('gives 3 Karma — you have 25');
    expect(band).toContain('data-can-add="yes"');

    const rated = part(pendingFor(conceptBuild('muscle'), startPending(ironCalm, { rating: 3 })), 'quality-pending');
    expect(rated).toContain('data-testid="quality-pending-rating"');
    expect(rated).toContain('rating 1 to 3');
    expect(rated).toContain('costs 12 Karma — you have 25');
    expect(rated).toContain('Rating of Iron Calm is at its limit of 3.');
  });

  it('asks a hand-written quality for its name, Karma, side and page, saying what is missing after a try', () => {
    const html = render(conceptBuild('muscle'), { addMode: 'custom', custom: { ...EMPTY_CUSTOM_QUALITY, name: 'Old Debt' }, customTried: true });
    const form = part(html, 'quality-custom');
    expect(html).not.toContain('data-testid="quality-picker"');
    expect(form).toMatch(/<span class="mono-label block">Name<\/span><input/);
    expect(form).toContain('role="radiogroup"');
    expect(form).toContain('aria-label="Positive or negative"');
    expect(form).toContain('Karma is a whole number, 0 or more.');
    expect(form).toMatch(/<button type="submit"[^>]*aria-describedby="[^"]+"[^>]*>add Old Debt<\/button>/);
  });

  it('says what taking it would flag on another step, with the way there, and still lets it be taken', () => {
    const incompetent = catalogueHit({ id: 'q-inc', kind: 'quality', name: 'Incompetent', stats: { KARMA: '5', TYPE: 'negative' } });
    const panel = part(pendingFor(conceptBuild('street-mage'), startPending(incompetent, { target: 'conjuring' })), 'quality-pending');
    expect(panel).toContain('data-can-add="yes"');
    const breaks = part(panel, 'quality-pending-breaks');
    expect(breaks).toContain('Taking it would also flag this elsewhere:');
    expect(breaks).toMatch(/aria-label="step 6 — go to Skills"/);
    expect(panel).toMatch(/<option value="conjuring" selected="">Conjuring<\/option>/);
  });

  it('says what landed in a status region', () => {
    const html = render(conceptBuild('muscle'), { note: 'Added Steady Hands to the positive qualities.' });
    expect(html).toMatch(/role="status"[^>]*>.*Added Steady Hands to the positive qualities\./);
  });
});

describe('read-only and review', () => {
  const build: CharacterBuild = {
    ...conceptBuild('muscle'),
    state: 'submitted',
    qualities: [q({ name: 'Exceptional Attribute', type: 'positive', karma: 14, target: 'str' }), q({ name: 'Grudge Holder', type: 'negative', karma: 5 })],
  };

  it('shows the choices with no controls to change them', () => {
    const html = render(build, {}, { readOnly: true });
    expect(html).not.toContain('data-testid="qualities-add"');
    expect(html).not.toContain('data-testid="quality-remove"');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<form');
    const [ea] = rowsOf(html);
    expect(ea).toMatch(/Which attribute<\/span><span class="text-ink">Strength<\/span>/);
    expect(html).toContain('needs the GM · waiting on the GM');
  });

  it('gives the GM approve and deny beside the chip, and shows a decision once made', () => {
    const html = render(build, {}, { readOnly: true, reviewMode: true, role: 'gm' });
    const [ea] = rowsOf(html);
    expect(ea).toMatch(/<button[^>]*aria-label="approve Exceptional Attribute"[^>]*data-testid="quality-approve"/);
    expect(ea).toMatch(/<button[^>]*aria-label="deny Exceptional Attribute"/);

    const analysis = analysisOf(build);
    const code = analysis.issues.find((i) => i.code.startsWith('approval-quality-exceptional'))!.code;
    const decided = render({ ...build, approvals: { [code]: 'approved' } }, {}, { readOnly: true, reviewMode: true, role: 'gm' });
    expect(rowsOf(decided)[0]).toContain('data-decision="approved"');
    expect(rowsOf(decided)[0]).toContain('needs the GM · the GM approved it');
    expect(rowsOf(decided)[0]).toMatch(/aria-label="approve Exceptional Attribute" aria-disabled="true"|aria-disabled="true"[^>]*aria-label="approve Exceptional Attribute"/);
  });
});

describe('on a phone', () => {
  it('keeps every field and button a thumb’s target, and every control named', () => {
    const build: CharacterBuild = { ...conceptBuild('muscle'), qualities: [q({ name: 'Aptitude', type: 'positive', karma: 14 })] };
    const html = render(build, { pending: startPending(steadyHands) });
    for (const tag of html.match(/<(select|input)[^>]*>/g) ?? []) {
      if (tag.includes('type="search"')) continue; // the kit's picker search, a full-width field of its own
      expect(tag, tag).toContain('pointer-coarse:min-h-10');
    }
    // Buttons are the app's .btn (40 px on touch) or a chip grown to it.
    for (const tag of html.match(/<button[^>]*>/g) ?? []) {
      expect(tag, tag).toMatch(/class="(?:[^"]*\s)?(btn|chip)(?:\s[^"]*)?"/);
    }
    // Every button says what it does: its own words, or a label.
    for (const m of html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)) {
      const words = m[2]!.replace(/<[^>]+>/g, '').trim();
      expect(words || /aria-label="[^"]+"/.test(m[1]!), m[0]).toBeTruthy();
    }
    // Every field sits inside a label with visible words, or carries a name.
    for (const m of html.matchAll(/<(select|input)([^>]*)>/g)) {
      const at = html.lastIndexOf('<label', m.index);
      const closed = html.lastIndexOf('</label>', m.index);
      expect(at > closed || /aria-label="[^"]+"/.test(m[2]!), m[0]).toBe(true);
    }
    expect(html).toMatch(/<select[^>]*aria-label="Which active skill\? — for Aptitude"/);
  });
});

describe('born with', () => {
  it('shows the quality a metatype is born with, what the metatype costs, and offers the buy-off', () => {
    const pixie: CharacterBuild = { ...blankBuild(), metatype: 'pixie', priorities: { ...blankBuild().priorities, metatype: 'A' } };
    const html = render(pixie);
    const born = part(html, 'qualities-born');
    expect(born).toContain('Born with');
    expect(born).toContain('Uneducated');
    expect(born).toContain('held from birth · gives no Karma');
    expect(born).toMatch(/<button[^>]*aria-label="buy off Uneducated"/);
    expect(born).toMatch(/The pixie metatype costs \d+ Karma at priority A\./);

    const bought = render({ ...pixie, qualities: [q({ name: 'Uneducated', type: 'positive', karma: 10 })] });
    expect(part(bought, 'qualities-born')).toContain('data-bought-off="yes"');
    expect(rowsOf(bought)[0]).toContain('buys off a born quality');
    expect(rowsOf(bought)[0]).toContain('costs 10 Karma to buy off');
  });
});

describe('the live screen', () => {
  it('mounts from StepProps over a query client, with the quality picker in place', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <QualitiesStep {...stepProps(conceptBuild('muscle'))} />
      </QueryClientProvider>,
    );
    expect(html).toContain('data-testid="qualities-step"');
    expect(html).toContain('data-testid="quality-picker"');
    expect(html).toContain('aria-label="Search qualities"');
  });
});

describe('list prices and hand-written qualities', () => {
  it('offers a list price as cards of its amounts, never a stepper through the numbers between', () => {
    const panel = part(pendingFor(conceptBuild('muscle'), startPending(dependents)), 'quality-pending');
    const choices = part(panel, 'quality-pending-choices');
    expect(choices).toMatch(/role="radiogroup" aria-label="Karma for Dependents"/);
    for (const k of [3, 6, 9]) expect(choices).toContain(`data-choice="${k}"`);
    expect(choices).toMatch(/data-choice="3"[^]*?aria-checked="true"/);
    expect(panel).not.toContain('data-testid="quality-pending-band"');
    expect(panel).not.toContain('aria-label="increase Karma for Dependents"');
  });

  it('marks a quality written in by hand as waiting on the GM, and says so on the form', () => {
    const build: CharacterBuild = { ...conceptBuild('muscle'), qualities: [q({ name: 'Neon Hunch', type: 'positive', karma: 7 })] };
    const [row] = rowsOf(render(build));
    expect(row).toContain('needs the GM · waiting on the GM');
    const form = render(conceptBuild('muscle'), { addMode: 'custom' });
    expect(part(form, 'quality-custom-gm')).toContain('A quality written here waits on the GM');
    expect(form).toContain('placeholder="e.g. 5"');
  });

  it('hands over "write your own" when the books list no qualities', () => {
    const html = renderToStaticMarkup(
      <CataloguePickerView
        kind="quality"
        label="qualities"
        query=""
        onQuery={noop}
        hits={[]}
        total={0}
        hasMore={false}
        loading={false}
        loadingMore={false}
        error={null}
        onMore={noop}
        caps={SETTINGS}
        onPick={noop}
        emptyAction={<button type="button" className="btn">write your own</button>}
        testId="quality-picker"
      />,
    );
    expect(html).toContain("This campaign&#x27;s books list no qualities.");
    expect(part(html, 'quality-picker-empty-action')).toContain('write your own');
  });
});
