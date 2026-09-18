/**
 * Step 4 — Magic or Resonance, rendered to static markup from `StepProps`
 * alone (`../Magic.tsx` and its sections), over invented runners made the
 * app's way. No book names, no book text (§14).
 *
 * Pinned, for the states that matter: a build with no Magic priority and a
 * mundane on row E each get one line and a way to step 2, and no kind
 * picker; a caster part way through sees the kind chosen, the grants as
 * lists with their counts in words, a waiver tied to what it gives up, the
 * spell picker, the tradition with its Drain pair in numbers and the mentor
 * spirit's note about step 5; a kind the row does not offer is a focusable
 * card refusing with the validator's sentence; an overfilled grant says so in
 * words with the finding under it; the aspected magician is told the aspect
 * is for good; the mystic adept's shortcut quotes its price and refuses past
 * Magic; a staged power the pool cannot pay refuses before it lands; a
 * technomancer sees the living persona; picks an earlier kind left behind
 * stay reachable; read-only shows the choices and offers no control; and the
 * headings stay h2 and h3 under the frame's h1, every button typed and named.
 */
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CharacterBuild } from '@safehouse/contracts';
import { setMagicKind, setPowerPointsBought, setPriority } from '@safehouse/rules';
import { issuesForStep } from '../../lib.js';
import { BUILD_ID, CAMPAIGN, SETTINGS, analysisOf, blankBuild, catalogueHit, conceptBuild } from '../../testing.js';
import MagicStep from '../Magic.js';
import { stepMeta } from '../meta.js';
import { inertActions, type StepProps } from '../types.js';
import { addFormula, addPower } from './model.js';
import { PowersSection, stagePower } from './PowerSections.js';

const noop = () => undefined;

function stepProps(build: CharacterBuild, over: Partial<StepProps> = {}): StepProps {
  const analysis = analysisOf(build);
  return {
    campaignId: CAMPAIGN,
    buildId: BUILD_ID,
    characterId: null,
    isOwner: true,
    meta: stepMeta(4),
    build,
    settings: SETTINGS,
    settingsFromCampaign: true,
    budgets: analysis.budgets,
    issues: issuesForStep(analysis.issues, 4),
    allIssues: analysis.issues,
    status: analysis.steps[3]!,
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

function html(node: ReactElement): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const screen = (build: CharacterBuild, over: Partial<StepProps> = {}): string => html(<MagicStep {...stepProps(build, over)} />);

/** The street mage's card as a mystic adept: every grant but the spells filled. */
const mystic = (): CharacterBuild => setMagicKind(conceptBuild('street-mage'), 'mysticAdept');

/** Visible words, tags stripped. */
const words = (markup: string): string => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/**
 * Glyph lines that can strand their glyph: a line whose first child is a
 * decorative ⛔ ⚠ ! ✕ ? – glyph, laid out as a wrapping flex row or with a
 * glyph that may shrink (inline text, not flex, keeps a glyph on the first
 * line with the words). On a narrow column the sentence then wraps onto a
 * flex line of its own and leaves the glyph alone on the line above it.
 */
function strandedGlyphs(markup: string): string[] {
  return [...markup.matchAll(/<(?:p|li)\b[^>]*class="([^"]*)"[^>]*>\s*<span aria-hidden="true"(?: class="([^"]*)")?>([^<]*)<\/span>/g)]
    .filter((m) => /[⛔⚠!✕?–]/.test(m[3] ?? '') && /\bflex\b/.test(m[1] ?? '') && (/\bflex-wrap\b/.test(m[1] ?? '') || !/\bshrink-0\b/.test(m[2] ?? '')))
    .map((m) => m[0]);
}

/** Every line on the step, the kit's refusal lines (`ChoiceCards`, `LimitStepper`) included now they keep their glyphs too. */
const strandedStepGlyphs = strandedGlyphs;

/** The markup of the card for one choice value. */
function card(markup: string, value: string): string {
  const start = markup.indexOf(`data-choice="${value}"`);
  if (start === -1) throw new Error(`no card ${value}`);
  const end = markup.indexOf('data-choice=', start + 12);
  return markup.slice(start, end === -1 ? undefined : end);
}

function section(markup: string, testId: string): string {
  const start = markup.indexOf(`data-testid="${testId}"`);
  if (start === -1) throw new Error(`no ${testId}`);
  const end = markup.indexOf('</section>', start);
  return markup.slice(start, end);
}

describe('before there is anything to choose', () => {
  it('a build with no Magic priority gets one line and a way to step 2', () => {
    const out = screen(blankBuild());
    expect(out).toContain('data-testid="magic-no-priority"');
    expect(words(out)).toContain('The Magic or Resonance priority is not chosen yet');
    expect(out).toMatch(/<button type="button"[^>]*data-step="2"[^>]*>choose it in step 2<\/button>/);
    expect(out).not.toContain('role="radiogroup"');
  });

  it('a mundane on row E gets one line saying so, and no kind picker', () => {
    const out = screen(conceptBuild('muscle'));
    expect(out).toContain('data-testid="magic-mundane"');
    expect(words(out)).toContain('Magic priority E buys no magic and no Resonance, so this runner is mundane');
    expect(out).toContain('change priorities in step 2');
    expect(out).not.toContain('data-testid="magic-kind"');
    // The frame already says the step is skipped; the box says why, once.
    expect(words(out)).not.toContain('nothing to choose here');
  });

  it('a mundane on row E with grants an earlier kind left lists them, their findings and a way to remove them', () => {
    // The street mage's card taken, Mundane chosen on this step, then Magic moved to E on step 2.
    const b = setPriority(setMagicKind(conceptBuild('street-mage'), 'mundane'), 'magic', 'E');
    const out = screen(b);
    expect(out).toContain('data-testid="magic-mundane"');
    expect(out).toContain('data-stage="mundane-leftovers"');
    expect(words(out)).toContain('Picks from an earlier choice are still on the record');
    expect(out).toContain('data-issue="grant-skills-over"');
    expect(out).toContain('data-testid="grant-skills-clear"');
    expect(out).toContain('aria-label="remove granted skill Spellcasting"');
    // No kind picker: at row E every kind but Mundane is shut.
    expect(out).not.toContain('role="radiogroup"');
  });

  it('a mundane on row E with powers left lists them with a way to remove them', () => {
    let b = addPower(setPriority(conceptBuild('adept'), 'magic', 'E'), { name: 'Invented Stride', cost: 1, levels: 1, mods: [] });
    b = setMagicKind(b, 'mundane');
    const out = screen({ ...b, grants: { skills: [], groups: [], spells: [], forms: [] } });
    expect(out).toContain('data-stage="mundane-leftovers"');
    expect(out).toContain('data-issue="powers-not-adept"');
    expect(out).toContain('data-testid="magic-powers-clear"');
  });
});

describe('a magician part way through', () => {
  const out = screen(conceptBuild('street-mage'));

  it('shows the kind chosen among every kind, each with what the row gives it', () => {
    expect(out).toContain('role="radiogroup" aria-label="Kind of magic or Resonance"');
    expect(card(out, 'magician')).toContain('aria-checked="true"');
    expect(words(card(out, 'magician'))).toContain('Magic 6');
    expect(words(out)).toContain('Magic priority A offers magician, mystic adept or technomancer.');
    for (const kind of ['magician', 'mysticAdept', 'technomancer', 'adept', 'aspected', 'mundane']) expect(out).toContain(`data-choice="${kind}"`);
  });

  it('lays out the grants as lists with counts in words, and a waiver tied to what it gives up', () => {
    const skills = out.slice(out.indexOf('data-testid="grant-skills"'), out.indexOf('data-testid="grant-spells"'));
    expect(words(skills)).toContain('2 magical skills at rating 5');
    expect(words(skills)).toContain('all 2 picked');
    expect(skills).toContain('aria-label="Granted skills"');
    expect(skills).toContain('aria-label="remove granted skill Spellcasting"');
    expect(skills).toContain('data-settled="yes"');

    const spells = out.slice(out.indexOf('data-testid="grant-spells"'));
    expect(spells).toContain('data-settled="no"');
    expect(words(spells)).toContain('10 spells, rituals or preparations');
    expect(words(spells)).toContain('0 of 10 picked, 10 to go');
    expect(words(spells)).toContain('Magic 6 lets this runner know up to 12 of each at creation');
    const waive = /<button[^>]*aria-describedby="([^"]+)"[^>]*data-testid="grant-spells-waive"[^>]*>waive the rest<\/button>/.exec(spells);
    expect(waive).not.toBeNull();
    expect(spells).toContain(`id="${waive![1]}"`);
    expect(words(spells)).toContain('Gives up the 10 still open');
    expect(spells).toContain('data-testid="spell-picker"');
    expect(spells).toContain('aria-label="Search spells and rituals"');
    expect(spells).toContain('<legend class="mono-label">Learn picks as</legend>');
    expect(words(out)).toContain('Pick 10 more free spells.');
  });

  it('offers the tradition with its Drain pair in this runner’s numbers, and the mentor spirit with its note', () => {
    const tradition = section(out, 'magic-tradition-section');
    expect(card(tradition, 'hermetic')).toContain('aria-checked="true"');
    expect(words(tradition)).toMatch(/Resists Drain with Logic \d \+ Willpower \d = \d+\./);
    expect(words(tradition)).toMatch(/Charisma \d \+ Willpower \d = \d+/);

    const mentor = section(out, 'magic-mentor-section');
    const input = /<input id="([^"]+)"[^>]*aria-describedby="([^"]+)"[^>]*data-testid="magic-mentor-input"/.exec(mentor);
    expect(input).not.toBeNull();
    expect(mentor).toContain(`for="${input![1]}"`);
    expect(mentor).toContain(`id="${input![2]}"`);
    expect(words(mentor)).toContain('only counts once that quality is taken in step 5');
    expect(mentor).toContain('SR5 p.76');
  });

  it('keeps every glyph beside its sentence, however narrow the column', () => {
    const refused = screen(setPriority(conceptBuild('adept'), 'magic', 'D'));
    expect(refused).toContain('data-issue=');
    expect(strandedStepGlyphs(out)).toEqual([]);
    expect(strandedStepGlyphs(refused)).toEqual([]);
  });

  it('keeps headings under the frame’s h1 and names every button', () => {
    expect(out).not.toMatch(/<h1|<h4|<h5/);
    const levels = [...out.matchAll(/<h([23])/g)].map((m) => m[1]);
    expect(levels[0]).toBe('2');
    for (const button of out.match(/<button[^>]*>/g) ?? []) expect(button).toContain('type="button"');
  });

  it('asks for a skill before a granted skill can be taken, tied to the button', () => {
    const b = { ...conceptBuild('street-mage'), grants: { ...conceptBuild('street-mage').grants, skills: [{ id: 'spellcasting', rating: 5 }] } };
    const markup = screen(b);
    const take = /<button[^>]*aria-disabled="true"[^>]*aria-describedby="([^"]+)"[^>]*data-testid="grant-skills-take"/.exec(markup);
    expect(take).not.toBeNull();
    expect(markup).toMatch(new RegExp(`id="${take![1]}"[^>]*>(?:<[^>]+>)*Choose a skill first\\.`));
    expect(markup).toMatch(/<label for="[^"]+" class="mono-label">Add a granted skill<\/label>/);
    expect(markup).toContain('<option value="arcana">Arcana</option>');
    expect(markup).not.toContain('<option value="spellcasting">');
  });

  it('says an overfilled grant in words, with the finding under it', () => {
    let b = conceptBuild('street-mage');
    for (let i = 0; i < 11; i++) b = addFormula(b, { name: `Invented Spell ${i}`, category: 'combat spells' });
    const markup = screen(b);
    expect(words(markup)).toContain('11 picked of 10: 1 too many');
    expect(markup).toContain('data-issue="grant-spells-over"');
    expect(markup).not.toContain('data-testid="spell-picker"');
    expect(markup).toContain('aria-label="remove Invented Spell 0"');
  });
});

describe('the kinds a row does not offer', () => {
  it('stay focusable cards, refusing with the validator’s sentence tied to them', () => {
    const b = setPriority(conceptBuild('adept'), 'magic', 'D');
    const out = screen(b);
    const magician = card(out, 'magician');
    expect(magician).toContain('aria-disabled="true"');
    expect(magician).toContain('data-refused="yes"');
    const described = /aria-describedby="([^"]+)"/.exec(magician)![1]!.split(' ');
    const reason = /<p id="([^"]+)"[^>]*data-refusal="magician"/.exec(magician);
    expect(reason).not.toBeNull();
    expect(described).toContain(reason![1]);
    expect(words(magician)).toContain('Magician is not offered at Magic priority D.');
    expect(card(out, 'adept')).toContain('data-refused="no"');
    expect(words(section(out, 'magic-pp-section'))).toContain('An adept’s power points equal Magic, 2 now');
    // The skill row B granted stays on the record at D, which grants none: listed, removable.
    expect(words(out)).toContain('1 on the record; this kind gets none here');
    expect(out).toContain('data-testid="grant-skills-clear"');

    const cleared = screen({ ...b, grants: { ...b.grants, skills: [] } });
    expect(words(cleared)).toContain('At Magic priority D adept gets nothing more to pick.');
  });
});

describe('links to other steps', () => {
  it('in guided mode, offer no way past this unfinished step; back to step 2 always; in free mode, everywhere', () => {
    // Spells still to pick: step 4 is not complete, so steps 5 and 8 are not reachable yet.
    const b = mystic();
    expect(analysisOf(b).steps[3]!.complete).toBe(false);
    const guided = screen(b);
    expect(guided).not.toMatch(/data-step="[5-9]"/);
    expect(guided).toMatch(/<button[^>]*data-step="2"[^>]*>change priorities in step 2<\/button>/);
    expect(words(guided)).toContain('only counts once that quality is taken in step 5');
    const free = screen(b, { mode: 'free' });
    expect(free).toMatch(/<button[^>]*data-step="5"[^>]*>qualities in step 5<\/button>/);
    expect(free).toMatch(/<button[^>]*data-step="8"[^>]*>Karma spends in step 8<\/button>/);
  });

  it('in guided mode, offer the way forward once every step before it is done', () => {
    let b = mystic();
    b = { ...b, magic: { ...b.magic, waived: ['spells'] } };
    const a = analysisOf(b);
    expect(a.steps[3]!.complete).toBe(true);
    expect(a.steps.slice(0, 4).every((s) => s.complete || s.skipped)).toBe(true);
    expect(screen(b)).toMatch(/<button[^>]*data-step="5"[^>]*>qualities in step 5<\/button>/);
  });
});

describe('the aspected magician', () => {
  it('is told the aspect is for good before choosing, and sees the group it grants', () => {
    const out = screen(conceptBuild('conjurer'));
    const aspect = section(out, 'magic-aspect-section');
    expect(words(aspect)).toContain('This choice is for good: the other two groups, and every skill in them, stay closed to this runner');
    expect(aspect).toContain('SR5 p.69');
    // The sentence describes the group itself, so the group's name can stay short.
    const group = /<div role="radiogroup" aria-label="Aspect" aria-describedby="([^"]+)"/.exec(aspect)!;
    expect(aspect).toMatch(new RegExp('<p id="' + group[1] + '"[^>]*data-testid="magic-aspect-consequence"'));
    expect(card(aspect, 'conjuring')).toContain('aria-checked="true"');
    expect(words(out)).toContain('1 magical skill group at rating 4');
    expect(out).toContain('data-grant-group="conjuring"');
  });

  it('with no aspect yet, the group waits on it', () => {
    const b = conceptBuild('conjurer');
    const { aspect: _a, ...magic } = b.magic;
    const out = screen({ ...b, magic, grants: { ...b.grants, groups: [] } });
    expect(out).toContain('data-testid="grant-groups-wait"');
    expect(out).toContain('data-issue="aspect-missing"');
  });
});

describe('the mystic adept', () => {
  const buying = (bought: number) => setPowerPointsBought(mystic(), bought);

  it('buys power points here with the price quoted against Karma', () => {
    const out = screen(buying(0), { mode: 'free' });
    const pp = section(out, 'magic-pp-section');
    expect(words(pp)).toContain('Power points: 0 of up to 6.');
    expect(words(pp)).toContain('buys them at 5 Karma each');
    expect(pp).toContain('aria-label="increase Power points bought"');
    expect(words(pp)).toMatch(/costs 5 Karma — you have \d+/);
    expect(pp).toContain('Karma spends in step 8');
  });

  it('refuses one past Magic with the engine’s sentence', () => {
    const pp = section(screen(buying(6)), 'magic-pp-section');
    expect(pp).toMatch(/aria-label="increase Power points bought" aria-disabled="true"/);
    expect(words(pp)).toContain('7 power points bought; Magic 6 allows 6.');
  });
});

describe('adept powers', () => {
  it('a staged power the pool cannot pay refuses before it lands, with its price quoted', () => {
    const b = setPriority(conceptBuild('adept'), 'magic', 'D');
    const hit = catalogueHit({ id: 'pw-1', kind: 'power', name: 'Invented Stride', stats: { COST: '3 PP' }, printedPage: 309 });
    const out = html(<PowersSection props={stepProps(b)} issues={[]} initialStaged={{ hit, levels: 1, target: '' }} />);
    const staged = out.slice(out.indexOf('<div role="group"'));
    expect(staged).toContain('data-testid="magic-power-staged"');
    expect(words(staged)).toContain('costs 3 power points — you have 2, 1 short');
    const add = /<button[^>]*aria-describedby="([^"]+)"[^>]*aria-disabled="true"[^>]*data-testid="magic-power-add"/.exec(staged);
    expect(add).not.toBeNull();
    expect(words(staged)).toContain('Powers cost 3 power points; 2 are available.');
    expect(out).toContain('data-testid="power-picker"');
  });

  it('a power whose row prints no readable cost asks for it, and refuses to add until it is typed', () => {
    const b = conceptBuild('adept');
    const hit = catalogueHit({ id: 'pw-3', kind: 'power', name: 'Invented Knack', stats: { COST: 'Varies' } });
    const out = html(<PowersSection props={stepProps(b)} issues={[]} initialStaged={{ hit, levels: 1, target: '' }} />);
    expect(out).not.toContain('adds at 0 PP');
    const input = /<input id="([^"]+)"[^>]*aria-describedby="([^"]+)"[^>]*data-testid="magic-power-cost"/.exec(out);
    expect(input).not.toBeNull();
    expect(out).toContain(`for="${input![1]}"`);
    expect(out).toMatch(new RegExp(`id="${input![2]}"[^>]*>(?:<[^>]+>)*[^<]*no power point cost the app can read`));
    const add = /<button[^>]*aria-describedby="([^"]+)"[^>]*aria-disabled="true"[^>]*data-testid="magic-power-add"/.exec(out);
    expect(add).not.toBeNull();
    expect(out).toMatch(new RegExp(`id="${add![1]}"[^>]*>(?:<[^>]+>)*Type its power point cost first\.`));

    expect(stagePower(hit, 1, '')).toEqual({ power: null, error: 'Type its power point cost first.' });
    expect(stagePower(hit, 1, '', 0.75).power).toMatchObject({ name: 'Invented Knack', cost: 0.75, levels: 1 });
    // A row that prints its cost keeps it, whatever was typed.
    const priced = catalogueHit({ id: 'pw-4', kind: 'power', name: 'Invented Poise', stats: { COST: '1 PP' } });
    expect(stagePower(priced, 1, '', 0.25).power?.cost).toBe(1);

    const typed = html(<PowersSection props={stepProps(b)} issues={[]} initialStaged={{ hit, levels: 1, target: '', cost: '0.5' }} />);
    expect(typed).toMatch(/data-testid="magic-power-add" data-refused="no"/);
    expect(words(typed)).toContain('costs 0.5 power points — you have 6');
  });

  it('a per-level power asks for its levels, and one that fits is offered', () => {
    const b = conceptBuild('adept');
    const hit = catalogueHit({ id: 'pw-2', kind: 'power', name: 'Invented Reflex', stats: { COST: '0.5 PP per level' } });
    const out = html(<PowersSection props={stepProps(b)} issues={[]} initialStaged={{ hit, levels: 2, target: '' }} />);
    expect(out).toContain('aria-label="increase Levels of Invented Reflex"');
    expect(words(out)).toContain('costs 1 power point — you have 6');
    expect(out).toMatch(/data-testid="magic-power-add" data-refused="no"/);
  });
});

describe('the technomancer', () => {
  it('sees the living persona from the derived character, the forms to pick and the cap', () => {
    const out = screen(conceptBuild('technomancer'));
    const persona = section(out, 'magic-persona-section');
    expect(persona).toContain('<dl');
    for (const key of ['attack', 'sleaze', 'dataProcessing', 'firewall', 'deviceRating']) expect(persona).toContain(`data-persona="${key}"`);
    expect(words(persona)).toMatch(/Device Rating \(Resonance\) 6/);
    expect(words(persona)).toContain('Sprites are registered with Karma in step 8.');
    expect(out).toContain('data-testid="form-picker"');
    expect(words(out)).toContain('12 of 12 complex forms left');
    expect(out).not.toContain('data-testid="magic-tradition-section"');
    expect(out).not.toContain('data-testid="magic-mentor-section"');
  });
});

describe('picks an earlier kind left behind', () => {
  it('stay listed with a way to remove them', () => {
    const b = setMagicKind(addFormula(conceptBuild('street-mage'), { name: 'Invented Bolt', category: 'combat spells' }), 'adept');
    const out = screen(b);
    expect(words(out)).toContain('1 on the record; this kind gets none here');
    expect(out).toContain('data-testid="grant-spells-clear"');
    expect(out).toContain('data-pick="Invented Bolt"');
  });
});

describe('read-only', () => {
  it('shows the choices and offers no control', () => {
    const b = addFormula(conceptBuild('street-mage'), { name: 'Invented Bolt', category: 'combat spells' });
    const out = screen({ ...b, magic: { ...b.magic, mentor: 'The Old Heron' } }, { readOnly: true, reviewMode: true });
    expect(out).toContain('aria-readonly="true"');
    expect(out).not.toContain('waive the rest');
    expect(out).not.toMatch(/>remove</);
    expect(out).not.toContain('type="search"');
    expect(out).not.toContain('data-testid="magic-mentor-input"');
    expect(words(out)).toContain('The Old Heron');
    expect(out).toContain('data-pick="Invented Bolt"');
  });
});
