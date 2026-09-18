/**
 * Step 3's screen rendered to static markup from `StepProps` alone
 * (docs/CHARGEN.md §4.4 Step 3, §8.6 "node + renderToStaticMarkup"). The
 * props are built the way the shell builds them — the engine's analysis of an
 * invented runner — so the markup is asserted on real answers.
 *
 * Pinned for the states that matter: an empty build (no priorities, no
 * metatype: the cards, the way to step 2, "Choose a metatype."); a build
 * partly spent (the pool in words, the chosen card marked, traits and the
 * lifestyle multiplier on it, "at max" in words); overspent (said on the pool
 * line, not refused); a stepper refused with the engine's sentence tied to it
 * by `aria-describedby`, and a metatype card refused the same way; Magic shut
 * until a type uses it; metavariants under their own headings when allowed;
 * the book's `4 (6)`; read-only and review mode offering nothing; and the
 * structure a phone relies on — headings in order under the frame's h1, lists
 * as lists, every control labelled, rows that wrap.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CharacterBuildSchema,
  ChargenSettingsSchema,
  type CharacterBuild,
  type ChargenSettings,
} from '@safehouse/contracts';
import { setAttributePoints, setMetatype, setPriority, setSpecialPoints } from '@safehouse/rules';
import { analyseBuild } from '../../analysis.js';
import { issuesForStep } from '../../lib.js';
import { BUILD_ID, CAMPAIGN, SETTINGS, blankBuild, conceptBuild } from '../../testing.js';
import MetatypeStep from '../Metatype.js';
import { stepMeta } from '../meta.js';
import { inertActions, type StepProps } from '../types.js';

const noop = () => undefined;

function stepProps(build: CharacterBuild, over: Partial<StepProps> = {}, settings: ChargenSettings = SETTINGS): StepProps {
  const analysis = analyseBuild(build, settings);
  return {
    campaignId: CAMPAIGN,
    buildId: BUILD_ID,
    characterId: null,
    isOwner: true,
    meta: stepMeta(3),
    build,
    settings,
    settingsFromCampaign: true,
    budgets: analysis.budgets,
    issues: issuesForStep(analysis.issues, 3),
    allIssues: analysis.issues,
    status: analysis.steps[2]!,
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

const render = (props: StepProps) => renderToStaticMarkup(<MetatypeStep {...props} />);

/** The markup of one attribute row. */
function rowOf(html: string, id: string): string {
  const start = html.indexOf(`data-testid="attribute-${id}"`);
  expect(start, `row ${id}`).toBeGreaterThan(-1);
  const end = html.indexOf('</li>', start);
  return html.slice(start, end);
}

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

/** The opening tag of a button by its accessible label. */
function button(html: string, label: string): string {
  const m = new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html);
  expect(m, label).not.toBeNull();
  return m![0];
}

/** The card (and its refusal) for one metatype. */
function cardOf(html: string, id: string): string {
  const start = html.indexOf(`data-choice="${id}"`);
  expect(start, `card ${id}`).toBeGreaterThan(-1);
  const next = html.indexOf('data-choice=', start + 12);
  return html.slice(start, next === -1 ? undefined : next);
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Metatype step — empty build', () => {
  const html = render(stepProps(blankBuild()));

  it('opens with the three sections as h2s under the frame, and no h1 of its own', () => {
    expect(html).not.toContain('<h1');
    const headings = [...html.matchAll(/<h([23])[^>]*>([^<]+)<\/h\1>/g)].map((m) => `h${m[1]} ${m[2]}`);
    expect(headings).toEqual(['h2 Metatype', 'h2 Attributes', 'h2 Special attributes']);
  });

  it('offers the core five as a labelled radio group, with special points for every row', () => {
    expect(html).toMatch(/role="radiogroup" aria-label="Metatypes"/);
    expect((html.match(/role="radio"/g) ?? []).length).toBe(5);
    expect(html).not.toContain('aria-checked="true"');
    expect(text(html)).toContain('special points by row: A 9 · B 7 · C 5 · D 3 · E 1');
    expect(text(html)).toContain('No Metatype priority yet');
    expect(html).toMatch(/<button[^>]*>choose priorities<\/button>/);
    expect(html).not.toContain('data-family="metavariant"');
    expect(html).toContain('data-testid="attribute-preview-bases"');
  });

  it("says what is missing in the engine's words beside the cards", () => {
    const notes = html.slice(html.indexOf('data-testid="metatype-issues"'));
    expect(notes).toContain('data-issue="metatype-missing"');
    expect(text(notes)).toContain('Choose a metatype.');
    expect(text(notes)).toContain('Must fix:');
  });

  it('lists the eight and the special three as lists, each stepper labelled', () => {
    expect(html).toMatch(/<ul aria-label="The eight attributes"/);
    expect(html).toMatch(/<ul aria-label="The special attributes"/);
    expect((html.match(/data-testid="attribute-[a-z]{3}"/g) ?? []).length).toBe(11);
    for (const name of ['Body', 'Agility', 'Reaction', 'Strength', 'Willpower', 'Logic', 'Intuition', 'Charisma', 'Edge']) {
      button(html, `increase ${name} points`);
      button(html, `decrease ${name} points`);
    }
  });
});

describe('Metatype step — a build partly spent', () => {
  const build = setAttributePoints(conceptBuild('muscle'), 'wil', 0);
  const html = render(stepProps(build));

  it('says the pool in words and marks the chosen card in words', () => {
    expect(text(html)).toContain('1 of 16 attribute points left');
    const troll = cardOf(html, 'troll');
    expect(troll).toContain('aria-checked="true"');
    expect(troll).toContain('chosen');
    expect(text(troll)).toContain('no special points');
    expect(text(troll)).toContain('thermographic vision, +1 Reach, +1 armor from tough skin');
    expect(text(troll)).toContain('lifestyles cost ×2');
    expect(troll).toContain('Body 5 to 10');
    expect(text(html)).toContain('Metatype is priority B');
    expect(text(html)).toContain('Attributes is priority C');
    expect(html).not.toContain('attribute-preview-bases');
  });

  it('shows each row’s figures, with a maximum reached said as "at max"', () => {
    const bod = rowOf(html, 'bod');
    expect(bod).toContain('data-at-max="yes"');
    expect(text(bod)).toContain('at max');
    expect(text(bod)).toMatch(/base 5 rating 10 Body 10 max 10 Karma none yet, raised in step 8/);
    expect(rowOf(html, 'str')).toContain('data-at-max="no"');
  });
});

describe('Metatype step — overspent', () => {
  it('says the overspend on the pool line and does not refuse the next point', () => {
    const html = render(stepProps(setAttributePoints(conceptBuild('muscle'), 'wil', 2)));
    expect(html).toMatch(/data-pool="attributes" data-over="yes"/);
    expect(text(html)).toContain('1 attribute point over: 17 spent of 16');
    expect(button(rowOf(html, 'rea'), 'increase Reaction points')).not.toContain('aria-disabled');
  });
});

describe('Metatype step — refused before the fact', () => {
  const build = setAttributePoints(conceptBuild('muscle'), 'str', 4);
  const html = render(stepProps(build));

  it("refuses the second attribute reaching its maximum, the sentence tied to the button", () => {
    const str = rowOf(html, 'str');
    const up = button(str, 'increase Strength points');
    expect(up).toContain('aria-disabled="true"');
    const id = /aria-describedby="([^"]+)"/.exec(up)![1]!;
    expect(str).toMatch(new RegExp(`<p id="${id}"[^>]*data-refusal="increase"`));
    expect(text(str)).toContain(
      'Only one attribute may start at its natural maximum: Body, Strength are. Exceptional Attribute on one of them would allow it.',
    );
    expect(str).toContain('SR5 p.72');
  });

  it('names the quality that would allow it once, and offers the way there only where guided mode would land', () => {
    expect((html.match(/data-testid="attribute-lift-note"/g) ?? []).length).toBe(1);
    // One point over the pool: step 3 is not finished, so guided mode has no way past it.
    expect(text(html)).toContain('1 attribute point over');
    expect(text(html)).not.toContain('go to step 5');
    const free = render(stepProps(build, { mode: 'free' }));
    expect((free.match(/data-testid="attribute-lift-note"/g) ?? []).length).toBe(1);
    expect(text(free)).toContain('go to step 5 · Qualities');
  });

  it('refuses a metatype card off the row with its reason tied to the card', () => {
    const offRow = render(stepProps(setPriority(conceptBuild('muscle'), 'metatype', 'C')));
    const troll = cardOf(offRow, 'troll');
    expect(troll).toContain('data-refused="yes"');
    expect(troll).toContain('aria-disabled="true"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(troll)![1]!.split(' ');
    const reasonId = describedBy.find((d) => troll.includes(`<p id="${d}"`));
    expect(reasonId).toBeDefined();
    expect(text(troll)).toContain('Troll cannot be taken at Metatype priority C.');
    expect(cardOf(offRow, 'human')).toContain('data-refused="no"');
    expect(offRow.split('Troll cannot be taken at Metatype priority C.').length - 1).toBe(1);
  });
});

describe('Metatype step — special attributes', () => {
  it('keeps Magic shut for a mundane runner whose Magic row offers nothing, with the way to step 2, not to the skipped step 4', () => {
    const html = render(stepProps(conceptBuild('muscle')));
    const mag = rowOf(html, 'mag');
    expect(mag).toContain('data-control="closed"');
    expect(mag).not.toContain('increase Magic points');
    expect(text(mag)).toContain('Magic priority E gives no Magic.');
    expect(text(mag)).toContain('go to step 2 · Priorities');
    expect(html).not.toContain('go to step 4');
    expect(text(rowOf(html, 'res'))).toContain('Magic priority E gives no Resonance.');
    expect(text(html)).toContain('0 of 0 special points left');
  });

  it('opens Magic before step 4 while the Magic row offers a type that uses it, and puts step 4’s finding beside it', () => {
    let b = blankBuild();
    b = setPriority(b, 'metatype', 'D');
    b = setPriority(b, 'attributes', 'B');
    b = setPriority(b, 'magic', 'A');
    b = setPriority(b, 'skills', 'C');
    b = setPriority(b, 'resources', 'E');
    b = setMetatype(b, 'human');
    const open = render(stepProps(b));
    const mag = rowOf(open, 'mag');
    expect(mag).toContain('data-control="stepper"');
    expect(button(mag, 'increase Magic points')).not.toContain('aria-disabled');
    expect(open).not.toContain('Magic opens');

    const spent = setSpecialPoints(b, 'mag', 1);
    const guided = rowOf(render(stepProps(spent)), 'mag');
    expect(guided).toContain('data-issue="special-points-no-magic"');
    expect(guided).toContain('data-step="4"');
    expect(button(guided, 'increase Magic points')).not.toContain('aria-disabled');
    // Step 3 still has attribute points to spend, so guided mode offers no way past it…
    expect(guided).not.toContain('fix in step 4');
    // …and free mode does.
    expect(text(rowOf(render(stepProps(spent, { mode: 'free' })), 'mag'))).toContain('fix in step 4 · Magic');
  });

  it("writes an augmented attribute in the book's 4 (6) form", () => {
    const build = CharacterBuildSchema.parse({
      ...conceptBuild('muscle'),
      purchases: [
        {
          list: 'augments',
          kind: 'augmentation',
          name: 'Reflex Lattice',
          cost: 1_000,
          essence: 0.5,
          item: {
            name: 'Reflex Lattice',
            essence: 0.5,
            mods: [{ id: 'm-lattice', source: { kind: 'cyberware' }, target: 'attr.rea', op: 'add', value: 2, active: true }],
          },
        },
      ],
    });
    const rea = rowOf(render(stepProps(build)), 'rea');
    expect(rea).toMatch(/<span aria-hidden="true">4 \(6\)<\/span><span class="sr-only">Reaction 4, augmented 6<\/span>/);
  });
});

describe('Metatype step — metavariants allowed', () => {
  const allow = ChargenSettingsSchema.parse({ allowMetavariants: true });
  const html = render(stepProps(conceptBuild('muscle'), {}, allow));

  it('groups the rest under their family headings, folded, each saying its Karma', () => {
    const headings = [...html.matchAll(/<h([23])[^>]*>([^<]+)<\/h\1>/g)].map((m) => `h${m[1]} ${m[2]}`);
    expect(headings.slice(0, 6)).toEqual([
      'h2 Metatype',
      'h3 Metatypes',
      'h3 Metavariants',
      'h3 Metasapients',
      'h3 Shapeshifters',
      'h2 Attributes',
    ]);
    expect(html).toMatch(/<details class="[^"]*" data-testid="metatype-fold-metavariant">/);
    expect(text(html)).toContain('17 to choose from');
    const wakyambi = text(cardOf(html, 'wakyambi'));
    expect(wakyambi).toContain('6 special points');
    expect(wakyambi).toContain('costs 12 Karma');
    expect(text(html)).toContain('does not count toward the cap on positive qualities');
  });
});

describe('Metatype step — read-only and review', () => {
  for (const [label, over] of [
    ['read-only', { readOnly: true }],
    ['review mode', { reviewMode: true }],
  ] as const) {
    it(`${label} shows the chosen card and the figures, and offers nothing`, () => {
      const html = render(stepProps(setAttributePoints(conceptBuild('muscle'), 'str', 4), over));
      expect(html).toContain('data-readonly="yes"');
      expect((html.match(/role="radio"/g) ?? []).length).toBe(1);
      expect(html).toContain('aria-readonly="true"');
      expect(html).not.toContain('aria-label="increase');
      expect(html).not.toContain('data-refusal=');
      expect(html).not.toContain('choose priorities');
      expect(html).not.toContain('attribute-lift-note');
      expect(html).not.toContain('go to step 4');
      expect(text(rowOf(html, 'str'))).toContain('rating 9');
    });
  }
});

describe('Metatype step — phone structure', () => {
  const html = render(stepProps(setAttributePoints(conceptBuild('muscle'), 'str', 4)));

  it('wraps rows rather than scrolling sideways, and keeps touch targets large', () => {
    expect(html).not.toMatch(/min-w-\[(?:[4-9]\d\d|\d{4})px\]/);
    expect(html).not.toContain('whitespace-nowrap flex');
    for (const id of ['bod', 'str', 'edg']) expect(rowOf(html, id)).toContain('flex flex-wrap items-start justify-between');
    // Every goTo button grows on a coarse pointer.
    for (const m of html.matchAll(/<button type="button" class="btn px-2[^"]*"/g)) expect(m[0]).toContain('pointer-coarse:min-h-10');
  });

  it('keeps every glyph beside its sentence, however narrow the column', () => {
    const blank = render(stepProps(blankBuild()));
    expect(blank).toContain('data-issue=');
    expect(strandedStepGlyphs(html)).toEqual([]);
    expect(strandedStepGlyphs(blank)).toEqual([]);
  });

  it('labels every button', () => {
    for (const m of html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)) {
      const hasName = /aria-label(ledby)?="[^"]+"/.test(m[0]) || text(m[1] ?? '').trim().length > 0;
      expect(hasName, m[0].slice(0, 120)).toBe(true);
    }
  });
});
