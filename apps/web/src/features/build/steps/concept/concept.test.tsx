/**
 * Step 1 — Concept, rendered to static markup from a hand-built `StepProps`
 * (docs/CHARGEN.md §4.4 Step 1), and its controls pressed as plain functions.
 *
 * Pinned, for the states that matter:
 * - a blank draft: the alias is required, and while it is missing the
 *   validator's sentence and page sit under it, tied with `aria-describedby`
 *   and marked invalid — words, not colour; no card is chosen and a card is
 *   said to be optional;
 * - the cards: the engine's presets in a radio group, each saying what it
 *   fills in (seen short, heard with the columns named), "start from nothing"
 *   among them;
 * - a card build: its card chosen, the line saying every later step holds the
 *   suggestion; changed by the player, the line names the changes and offers
 *   to put the card back;
 * - the question: a card over the player's work names every change, marks
 *   theirs, and says who the runner is stays; the controls only ask when the
 *   engine's plan says something of the player's would go, apply through
 *   `update` otherwise, and never edit a read-only build;
 * - the campaign's level and table in numbers, with no control to choose them;
 *   a build started under other rules gets the validator's warning and one
 *   button tied to it; settings that could not be read are said so;
 * - read-only and review mode: a definition list and a read-only group, no
 *   inputs, no buttons that edit, no question;
 * - the Fixer's draft box: the mounted step puts it between who the runner is
 *   and the cards, and only where it can be drafted on — the step body itself
 *   says nothing about drafting, so a campaign without the Fixer reads exactly
 *   as it did before it existed (`concept/DescribeRunner.tsx`, tested on its
 *   own in `describeRunner.test.tsx`);
 * - structure: headings in order under the frame's h1, lists as lists, one
 *   column on a phone with 40 px targets on touch, no table to scroll, and no
 *   stub copy.
 *
 * Invented runners only.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { chargenSettingsForLevel, type CharacterBuild, type ChargenSettings } from '@safehouse/contracts';
import { BLANK_CONCEPT_ID, CONCEPT_PRESETS, applyConcept, conceptPreset, setAttributePoints } from '@safehouse/rules';
import { analyseBuild } from '../../analysis.js';
import type { BuildUpdater } from '../../session.js';
import { issuesForStep } from '../../lib.js';
import { BUILD_ID, CAMPAIGN, SETTINGS, blankBuild, conceptBuild } from '../../testing.js';
import ConceptStep, { ConceptStepView, conceptHandlers, type ConceptStepViewProps } from '../Concept.js';
import { draftKeys } from './draft.js';
import { stepMeta } from '../meta.js';
import { inertActions } from '../types.js';

const noop = () => undefined;

function props(build: CharacterBuild, over: Partial<ConceptStepViewProps> = {}, settings: ChargenSettings = SETTINGS): ConceptStepViewProps {
  const analysis = analyseBuild(build, settings);
  return {
    campaignId: CAMPAIGN,
    buildId: BUILD_ID,
    characterId: null,
    isOwner: true,
    meta: stepMeta(1),
    build,
    settings,
    settingsFromCampaign: true,
    budgets: analysis.budgets,
    issues: issuesForStep(analysis.issues, 1),
    allIssues: analysis.issues,
    status: analysis.steps[0]!,
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
    pending: null,
    onPending: noop,
    ...over,
  };
}

const render = (p: ConceptStepViewProps) => renderToStaticMarkup(<ConceptStepView {...p} />);
/** The words a player reads, tags stripped. */
const copy = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');
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

const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
const tagWith = (html: string, testId: string) => html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? '';

/** A card-made build with one attribute point moved by hand. */
function tweaked(id = 'muscle'): CharacterBuild {
  const b = conceptBuild(id);
  return setAttributePoints(setAttributePoints(b, 'bod', b.attributes.bod - 1), 'log', b.attributes.log + 1);
}

describe('a blank draft', () => {
  const html = render(props(blankBuild('')));

  it('asks for the alias, and ties the missing-alias sentence to the field in words', () => {
    const input = tagWith(html, 'concept-alias');
    expect(input).toContain('required=""');
    expect(input).toContain('aria-required="true"');
    expect(input).toContain('aria-invalid="true"');
    const described = attr(input, 'aria-describedby')!.split(' ');
    expect(described).toHaveLength(2);
    const [hintId, whyId] = described as [string, string];
    expect(html).toContain(`id="${hintId}"`);
    expect(html).toMatch(new RegExp(`<span id="${whyId}">Give the runner an alias.</span>`));
    expect(html).toMatch(/data-testid="concept-alias-issue">(?:(?!<\/p>)[\s\S])*>SR5 p\.62<\/button>(?:<\/span>)?<\/p>/);
    // Every input has a label pointing at it.
    for (const inputId of [...html.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map((m) => m[1]!)) {
      expect(html, inputId).toContain(`for="${inputId}"`);
    }
  });

  it('offers every card, none chosen, and says a card is optional', () => {
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Concept card"');
    const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(CONCEPT_PRESETS.length);
    expect(radios.some((r) => r.includes('aria-checked="true"'))).toBe(false);
    expect(copy(html)).toContain('Start from nothing');
    expect(tagWith(html, 'concept-card-status')).toContain('data-status="none"');
    expect(copy(html)).toContain('A card is optional');
  });

  it('with an alias, the field is not marked and no issue shows', () => {
    const named = render(props(blankBuild('Kestrel Vane')));
    const input = tagWith(named, 'concept-alias');
    expect(input).toContain('value="Kestrel Vane"');
    expect(input).not.toContain('aria-invalid');
    expect(named).not.toContain('data-testid="concept-alias-issue"');
  });
});

describe('the cards', () => {
  const html = render(props(blankBuild()));

  it('say what each fills in: priorities, the metatype it suggests, the kind of magic — seen and heard', () => {
    const face = conceptPreset('face')!;
    expect(copy(html)).toContain(face.title);
    expect(copy(html)).toContain(face.pitch);
    expect(html).toMatch(/<span aria-hidden="true"[^>]*data-fills="face"[^>]*>C\/B\/E\/A\/D · Elf suggested · no magic<\/span>/);
    expect(html).toContain(
      '<span class="sr-only">Fills in priorities metatype C, attributes B, magic E, skills A, resources D; Elf suggested; no magic.</span>',
    );
    expect(html).toMatch(/data-fills="blank"[^>]*>clears every later step; who the runner is stays</);
  });
});

describe('a card build', () => {
  it('shows its card chosen and says every later step holds the suggestion', () => {
    const html = render(props(conceptBuild('muscle')));
    const chosen = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]).filter((r) => r.includes('aria-checked="true"'));
    expect(chosen).toHaveLength(1);
    expect(html).toMatch(/<div class="[^"]*" data-choice="muscle"><button[^>]*aria-checked="true"/);
    expect(tagWith(html, 'concept-card-status')).toContain('data-status="held"');
    expect(copy(html)).toContain('Every later step holds the “Chromed-up muscle” suggestion; change any of it there.');
    expect(html).not.toContain('data-testid="concept-put-back"');
    expect(html).toMatch(/<p role="status"/);
  });

  it('changed by the player: names what changed and offers to put the card back', () => {
    const html = render(props(tweaked('muscle')));
    expect(tagWith(html, 'concept-card-status')).toContain('data-status="changed"');
    expect(copy(html)).toContain('Changed since the “Chromed-up muscle” card: attribute and special points.');
    expect(html).toMatch(/<button[^>]*data-testid="concept-put-back"[^>]*>put the card back<\/button>/);
  });

  it('started from nothing says so', () => {
    const html = render(props({ ...blankBuild(), identity: { alias: 'Kestrel Vane', concept: BLANK_CONCEPT_ID } }));
    expect(tagWith(html, 'concept-card-status')).toContain('data-status="blank"');
    expect(html).toMatch(/<div class="[^"]*" data-choice="blank"><button[^>]*aria-checked="true"/);
  });
});

describe('the question', () => {
  it('a card over the player’s work names every change, marks theirs, and says who the runner is stays', () => {
    const html = render(props(tweaked('muscle'), { pending: 'decker' }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(copy(html)).toContain('Use “Grid-runner decker”?');
    expect(html).toMatch(/<ul[^>]*data-testid="concept-confirm-changes"/);
    const own = html.match(/<li[^>]*data-section="attributes"[^>]*data-own="yes"[^>]*>[\s\S]*?<\/li>/)?.[0] ?? '';
    expect(copy(own)).toContain("Attribute and special points: replaced with the card's suggestion");
    expect(copy(own)).toContain('your change');
    const theirs = html.match(/<li[^>]*data-section="priorities"[^>]*data-own="no"[^>]*>[\s\S]*?<\/li>/)?.[0] ?? '';
    expect(copy(theirs)).toContain('Priorities: B/C/E/D/A becomes D/B/E/C/A');
    expect(copy(theirs)).not.toContain('your change');
    expect(copy(html)).toContain('Who the runner is — alias, real name, age, sex and background — stays as it is.');
    expect(html).toMatch(/<button[^>]*data-testid="concept-confirm-cancel"[^>]*>keep the build as it is<\/button>/);
    expect(html).toMatch(/<button[^>]*data-testid="concept-confirm-go"[^>]*>use this card<\/button>/);
  });

  it('start from nothing asks in its own words', () => {
    const html = render(props(tweaked('rigger'), { pending: BLANK_CONCEPT_ID }));
    expect(copy(html)).toContain('Start from nothing?');
    expect(html).toMatch(/data-testid="concept-confirm-go"[^>]*>clear and start over</);
    expect(html).toMatch(/<li[^>]*data-section="lifestyles"[^>]*>/);
  });

  it('is not open when nothing is waiting', () => {
    expect(render(props(tweaked('muscle')))).not.toContain('role="dialog"');
  });
});

describe('the controls', () => {
  /** Props whose `update` applies the updater to a running build, and whose `onPending` records the question. */
  function pressable(build: CharacterBuild, over: Partial<ConceptStepViewProps> = {}) {
    const state = { build, pending: over.pending ?? (null as string | null), updates: 0 };
    const p = props(build, {
      ...over,
      update: (fn: BuildUpdater) => {
        state.updates += 1;
        state.build = fn(state.build);
      },
      onPending: (id) => {
        state.pending = id;
      },
    });
    return { state, on: () => conceptHandlers({ ...p, pending: state.pending }) };
  }

  it('a card on a blank draft goes straight on through applyConcept, the alias kept', () => {
    const { state, on } = pressable(blankBuild('Kestrel Vane'));
    on().pick('face');
    expect(state.pending).toBeNull();
    expect(state.build).toEqual(applyConcept(blankBuild('Kestrel Vane'), conceptPreset('face')!, SETTINGS));
    expect(state.build.identity.alias).toBe('Kestrel Vane');
  });

  it('a card over the player’s work waits for yes, and no leaves the build alone', () => {
    const start = tweaked('muscle');
    const { state, on } = pressable(start);
    on().pick('decker');
    expect(state.pending).toBe('decker');
    expect(state.updates).toBe(0);
    on().cancel();
    expect(state.pending).toBeNull();
    expect(state.build).toBe(start);

    on().pick('decker');
    on().confirm();
    expect(state.pending).toBeNull();
    expect(state.build.identity.concept).toBe('decker');
    expect(state.build.priorities).toEqual(conceptPreset('decker')!.priorities);
    expect(state.build.identity.alias).toBe(start.identity.alias);
  });

  it('putting the card back asks, then restores its suggestion', () => {
    const { state, on } = pressable(tweaked('muscle'));
    on().pick('muscle');
    expect(state.pending).toBe('muscle');
    on().confirm();
    expect(state.build.attributes).toEqual(conceptBuild('muscle').attributes);
  });

  it('matches the campaign’s level and table on the record', () => {
    const street = chargenSettingsForLevel('street');
    const { state, on } = pressable(conceptBuild('decker'), { settings: street });
    on().match();
    expect(state.build.level).toBe('street');
  });

  it('a read-only build or the GM’s review edits nothing, whatever is pressed', () => {
    for (const over of [{ readOnly: true }, { reviewMode: true }] as const) {
      const start = tweaked('muscle');
      const { state, on } = pressable(start, { ...over, pending: 'decker' });
      on().pick('face');
      on().pick('decker');
      on().confirm();
      on().match();
      expect(state.updates).toBe(0);
      expect(state.build).toBe(start);
    }
  });
});

describe('what this campaign builds', () => {
  it('shows the level and table in numbers, with nothing to choose them by', () => {
    const html = render(props(conceptBuild('face')));
    const section = html.split('data-testid="concept-campaign"')[1]!;
    const text = copy(section);
    expect(text).toContain('Experienced');
    expect(text).toMatch(/Starting Karma 25/);
    expect(text).toMatch(/Highest Availability 12/);
    expect(text).toContain('Core priority table');
    expect(text).toMatch(/Priority A 3 skills at 5, 7 complex forms/);
    expect(section).toMatch(/<dl[^>]*data-testid="concept-level-facts"/);
    expect(section).not.toMatch(/<(input|select|textarea)|role="radio"/);
    expect(text).toContain('Set by the GM');
  });

  it('follows the campaign’s level', () => {
    const street = chargenSettingsForLevel('street');
    const build = { ...conceptBuild('face'), level: 'street' as const };
    const text = copy(render(props(build, {}, street)));
    expect(text).toContain('Street level');
    expect(text).toMatch(/Starting Karma 13/);
    expect(text).toMatch(/Highest Availability 10/);
    expect(text).not.toContain('this build was started as');
  });

  it('a build started under other rules: the warning, its page, and one button tied to it', () => {
    const street = chargenSettingsForLevel('street');
    const html = render(props(conceptBuild('face'), {}, street));
    expect(copy(html)).toContain('The campaign builds street runners; this build was started as experienced.');
    expect(copy(html)).toContain('SR5 p.64');
    const button = tagWith(html, 'concept-match-campaign');
    const listId = attr(button, 'aria-describedby')!;
    expect(html).toMatch(new RegExp(`<ul id="${listId}"`));
    expect(render(props(conceptBuild('face'), { readOnly: true }, street))).not.toContain('data-testid="concept-match-campaign"');
  });

  it('says when the campaign’s settings could not be read', () => {
    expect(render(props(conceptBuild('face'), { settingsFromCampaign: false }))).toContain('data-testid="concept-settings-note"');
    expect(render(props(conceptBuild('face')))).not.toContain('data-testid="concept-settings-note"');
  });
});

describe('read-only and review', () => {
  it('shows who the runner is as a definition list, the cards read-only, and nothing that edits', () => {
    const build: CharacterBuild = { ...tweaked('muscle'), identity: { alias: 'Kestrel Vane', realName: 'Mara Quell', concept: 'muscle' } };
    for (const over of [{ readOnly: true }, { reviewMode: true }] as const) {
      const html = render(props(build, { ...over, pending: 'decker' }));
      expect(tagWith(html, 'concept-step')).toContain('data-editable="no"');
      expect(html).not.toMatch(/<(input|select|textarea)/);
      expect(html).toMatch(/<dl[^>]*>[\s\S]*<dt[^>]*>Alias<\/dt><dd[^>]*>Kestrel Vane<\/dd>/);
      expect(copy(html)).toContain('Age not given');
      expect(html).toContain('aria-readonly="true"');
      expect(html).not.toContain('data-testid="concept-put-back"');
      expect(html).not.toContain('role="dialog"');
    }
  });
});

describe('structure', () => {
  const html = render(props(tweaked('muscle'), {}, chargenSettingsForLevel('street')));

  it('puts h2s and h3s in order under the frame’s h1', () => {
    expect(html).not.toContain('<h1');
    const headings = [...html.matchAll(/<(h[1-6])[^>]*>([^<]*)<\/h[1-6]>/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(headings).toEqual(['h2 Who the runner is', 'h2 Concept', 'h2 What this campaign builds', 'h3 Street level', 'h3 Core priority table']);
  });

  it('is one column on a phone, reaches 40 px on touch, and has no table to scroll', () => {
    expect(html).not.toContain('<table');
    expect(tagWith(html, 'concept-cards')).toContain('grid-cols-1');
    for (const input of [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0])) {
      expect(input).toContain('w-full');
      expect(input).toContain('pointer-coarse:min-h-10');
    }
    for (const button of [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0])) {
      expect(button, button).toMatch(/\bbtn\b|min-h-11|pointer-coarse:min-h-10/);
    }
  });

  it('keeps every glyph beside its sentence, however narrow the column', () => {
    const blank = render(props(blankBuild('')));
    expect(blank).toContain('data-testid="concept-alias-issue"');
    const mismatch = render(props(conceptBuild('face'), {}, chargenSettingsForLevel('street')));
    expect(mismatch).toContain('data-testid="concept-mismatch"');
    const question = render(props(tweaked('muscle'), { pending: 'decker' }));
    expect(question).toContain('data-own="yes"');
    for (const markup of [blank, mismatch, question]) expect(strandedGlyphs(markup)).toEqual([]);
  });

  it('carries no stub copy, and says nothing of its own about drafting', () => {
    for (const build of [blankBuild(''), conceptBuild('street-mage'), tweaked('muscle')]) {
      const text = copy(render(props(build)));
      expect(text).not.toMatch(/placeholder|coming soon|not implemented|lands here/i);
      // The Fixer's box is the slot's alone, so a campaign without it reads as this step always did.
      expect(text).not.toMatch(/describe your runner|fixer/i);
    }
  });
});

describe('the Fixer’s draft box', () => {
  /** A stand-in for `<DescribeRunner>`, which asks the server whether it works. */
  const slot = <p data-testid="describe-slot">box</p>;

  it('sits between who the runner is and the cards, where the draft lands', () => {
    const html = render(props(blankBuild(), { describe: slot }));
    const order = ['concept-identity', 'describe-slot', 'concept-cards'].map((id) => html.indexOf(`data-testid="${id}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('is the mounted step’s, and only on a build there is something to draft onto', () => {
    const seeded = (over: Partial<ConceptStepViewProps>) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      qc.setQueryData(draftKeys.availability(BUILD_ID), { available: true, reason: null, running: false });
      const p = props(blankBuild(), over);
      return renderToStaticMarkup(
        <QueryClientProvider client={qc}>
          <ConceptStep {...p} />
        </QueryClientProvider>,
      );
    };
    expect(seeded({})).toContain('data-testid="concept-describe"');
    expect(seeded({ readOnly: true })).not.toContain('data-testid="concept-describe"');
    expect(seeded({ reviewMode: true })).not.toContain('data-testid="concept-describe"');
  });
});
