/**
 * "Describe your runner" on Step 1, every state rendered to static markup,
 * and its controls pressed as plain functions (docs/CHARGEN.md §4.4 Step 1,
 * §8.5 `propose_build`).
 *
 * Pinned, for the states that matter:
 * - **off**: no box at all while the campaign has not turned drafts on, has
 *   no model, or has not answered yet — and none on a read-only build or the
 *   GM's review, where there is nothing to draft onto;
 * - **idle**: the heading, what the box does, a described textarea, and a
 *   Draft button that refuses a description too short to send;
 * - **drafting**: the button says so and is busy, a stop button is there, and
 *   the status line warns a local model takes a minute;
 * - **the proposal**: each line as "was → would be", the arrow and the
 *   strike-through hidden from a reader and the same fact given as a
 *   sentence, what the rules would flag, what the Fixer could not find, the
 *   promise that who the runner is stays the player's, and the two buttons;
 * - **stopped and refused**: the player's own stop said as a stop, a refusal
 *   as an alert in the lane's words;
 * - **the controls**: Draft only with enough words and never while one is
 *   running, Accept through one pure `update` that lays the draft over the
 *   build as it stands, Discard changing nothing, and neither editing a
 *   read-only build;
 * - **structure**: one column on a phone with 40 px targets on touch, the
 *   heading under the frame's h1, and no glyph stranded from its sentence.
 *
 * Invented runners only (DESIGN.md §14).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CharacterBuild } from '@safehouse/contracts';
import { SETTINGS, blankBuild, conceptBuild } from '../../testing.js';
import type { BuildUpdater } from '../../session.js';
import {
  DRAFT_KEPT_WORDS,
  DescribeRunnerView,
  describeRunnerHandlers,
  describeStatus,
  type DescribeRunnerDeps,
  type DescribeRunnerViewProps,
} from './DescribeRunner.js';
import { acceptProposal, proposalSummary, type BuildProposal, type ProposalSummary } from './draft.js';

const noop = () => undefined;

const CURRENT = blankBuild('Kestrel Vane');
const DRAFTED = conceptBuild('muscle', 'Kestrel Vane');

function proposal(over: Partial<BuildProposal> = {}): BuildProposal {
  return {
    build: DRAFTED,
    issues: [],
    warnings: [],
    note: null,
    model: 'mock-primary',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    latencyMs: 40,
    ...over,
  };
}

const summaryOf = (over: Partial<BuildProposal> = {}, current: CharacterBuild = CURRENT): ProposalSummary =>
  proposalSummary(current, proposal(over), SETTINGS);

function props(over: Partial<DescribeRunnerViewProps> = {}): DescribeRunnerViewProps {
  return {
    availability: { available: true, reason: null, running: false },
    readOnly: false,
    prompt: '',
    busy: false,
    stopping: false,
    error: null,
    stopped: false,
    summary: null,
    taken: false,
    onPrompt: noop,
    onDraft: noop,
    onStop: noop,
    onAccept: noop,
    onDiscard: noop,
    ...over,
  };
}

const render = (over: Partial<DescribeRunnerViewProps> = {}) => renderToStaticMarkup(<DescribeRunnerView {...props(over)} />);
/** The words a player reads, tags stripped. */
const copy = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');
const tagWith = (html: string, testid: string) => html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`))?.[0] ?? '';
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;

const DESCRIPTION = 'an ork who drove for a gang: loud, loyal, bad with money';

// ---------------------------------------------------------------------------
// Off
// ---------------------------------------------------------------------------

describe('the box is only there when it works', () => {
  it('renders nothing while the campaign has not turned drafts on, has no model, or has not answered', () => {
    expect(render({ availability: { available: false, reason: 'drafts_off', running: false } })).toBe('');
    expect(render({ availability: { available: false, reason: 'ai_off', running: false } })).toBe('');
    expect(render({ availability: null })).toBe('');
  });

  it('renders nothing on a build that cannot be edited — there is nothing to draft onto', () => {
    expect(render({ readOnly: true })).toBe('');
    expect(render({ readOnly: true, summary: summaryOf() })).toBe('');
  });

  it('says nothing about a provider, a model or a key when it is off', () => {
    const text = copy(render({ availability: { available: false, reason: 'ai_off', running: false } }));
    expect(text.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Idle
// ---------------------------------------------------------------------------

describe('waiting for a description', () => {
  const html = render();

  it('says what it is and what it does, before it is used', () => {
    const text = copy(html);
    expect(text).toContain('Describe your runner');
    expect(text).toMatch(/drafts a whole build from this campaign's books/);
    expect(text).toContain('shows what it would change first');
    expect(text).toContain('Nothing on the build changes until you use a draft.');
  });

  it('ties the textarea to its label and to what the box does', () => {
    const area = tagWith(html, 'concept-describe-prompt');
    const labelFor = html.match(/<label for="([^"]*)"/)?.[1];
    expect(attr(area, 'id')).toBe(labelFor);
    const describedBy = attr(area, 'aria-describedby')!;
    expect(copy(html.slice(html.indexOf(`id="${describedBy}"`)))).toContain('The Fixer drafts');
    // React renders this one camel-cased into static markup.
    expect(attr(area, 'maxLength')).toBe('2000');
  });

  it('will not draft from too few words, and will from a description', () => {
    expect(tagWith(html, 'concept-describe-draft')).toContain('disabled');
    const ready = render({ prompt: DESCRIPTION });
    expect(tagWith(ready, 'concept-describe-draft')).not.toContain('disabled');
    expect(copy(ready)).toContain('draft a runner');
    expect(ready).not.toContain('data-testid="concept-describe-stop"');
  });

  it('says when a draft for this runner is already being written somewhere else', () => {
    const html2 = render({ availability: { available: true, reason: null, running: true } });
    expect(copy(html2)).toContain('already being written on another screen');
  });
});

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

describe('while the Fixer drafts', () => {
  const html = render({ prompt: DESCRIPTION, busy: true });

  it('says so on the button, marks it busy, and warns a local model takes a minute', () => {
    const button = tagWith(html, 'concept-describe-draft');
    expect(button).toContain('aria-busy="true"');
    expect(button).toContain('disabled');
    expect(copy(html)).toContain('drafting…');
    expect(copy(html)).toContain('A local model can take a minute or two.');
    expect(html).toContain('data-state="drafting"');
  });

  it('offers a stop of its own, and says it is stopping once pressed', () => {
    expect(html).toContain('data-testid="concept-describe-stop"');
    expect(copy(html)).toContain('stop');
    const stopping = render({ prompt: DESCRIPTION, busy: true, stopping: true });
    expect(copy(stopping)).toContain('stopping…');
    expect(tagWith(stopping, 'concept-describe-stop')).toContain('disabled');
  });

  it('keeps the words on screen but not editable, so nothing is lost and nothing changes under the model', () => {
    const area = tagWith(html, 'concept-describe-prompt');
    expect(area).toContain('readOnly=""');
    expect(html).toContain(DESCRIPTION);
  });

  it('holds the last draft back until this one is answered', () => {
    const over = render({ prompt: DESCRIPTION, busy: true, summary: summaryOf() });
    expect(over).not.toContain('data-testid="concept-draft"');
  });
});

// ---------------------------------------------------------------------------
// The proposal
// ---------------------------------------------------------------------------

describe('the draft, before anything changes', () => {
  const html = render({
    prompt: DESCRIPTION,
    summary: summaryOf({
      issues: [
        { code: 'attr-unspent', severity: 'error', step: 3, message: 'Attribute points are left.', ref: { book: 'SR5', page: 65 } },
        { code: 'nuyen-carry', severity: 'warning', step: 7, message: 'Nuyen above the carry-over.', ref: { book: 'SR5', page: 94 } },
      ],
      warnings: ['“Stone Fist” is not a quality in this campaign’s books — left out'],
      note: 'Took a pistol over the rifle to leave nuyen for the doc.',
    }),
  });

  it('is a card of its own that changes nothing yet, with the Fixer named', () => {
    expect(html).toContain('data-testid="concept-draft"');
    expect(html).toContain('data-state="proposed"');
    expect(copy(html)).toContain('The Fixer&#x27;s draft'.replace('&#x27;', "'"));
    expect(copy(html)).toContain('draft again');
  });

  it('says what the draft would change, and how much of it', () => {
    expect(copy(html)).toMatch(/The draft would change \d+ of the 9 lines below\./);
    const lines = [...html.matchAll(/data-line="(\w+)" data-changed="(yes|no)"/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(lines).toHaveLength(9);
    expect(lines).toContain('metatype:yes');
    expect(lines).toContain('magic:no');
  });

  it('gives a changed line as a sentence as well as an arrow, and an unchanged one as staying', () => {
    expect(html).toContain('<span class="sr-only">was none, would be Troll</span>');
    expect(html).toContain('→');
    // Every decorative arrow and strike-through is hidden from a reader.
    for (const m of html.matchAll(/<span aria-hidden="true">([^<]*)<\/span>/g)) expect(m[1]).not.toMatch(/\w{4}/);
    expect(html).toContain('<span class="sr-only"> (stays)</span>');
  });

  it('says what the rules would flag and where they will be seen', () => {
    const issues = copy(html.slice(html.indexOf('concept-draft-issues')));
    expect(issues).toContain('The rules flag 1 error to fix and 1 warning.');
    expect(issues).toContain('The rail and the issues list show them once the draft is used.');
    expect(tagWith(html, 'concept-draft-issues')).toContain('data-errors="1"');
  });

  it('lists what the Fixer named and could not find, in the server’s own words', () => {
    expect(html).toContain('data-testid="concept-draft-left-out"');
    expect(copy(html)).toContain('Left out');
    expect(copy(html)).toContain('“Stone Fist” is not a quality in this campaign’s books — left out');
  });

  it('carries the Fixer’s own note about the draft', () => {
    expect(copy(html)).toContain('Took a pistol over the rifle to leave nuyen for the doc.');
  });

  it('promises who the runner is stays, and ties that promise to the Accept button', () => {
    expect(copy(html)).toContain('stays as you typed it; the draft only fills blanks');
    const accept = tagWith(html, 'concept-draft-accept');
    const keptId = attr(accept, 'aria-describedby')!;
    expect(html).toContain(`id="${keptId}"`);
    expect(copy(html.slice(html.indexOf(`id="${keptId}"`)))).toContain(copy(DRAFT_KEPT_WORDS).slice(0, 40));
  });

  it('offers taking it and throwing it away, in those words', () => {
    expect(copy(html)).toContain('use this draft');
    expect(copy(html)).toContain('discard');
  });

  it('leaves out the sections it has nothing to say about', () => {
    const bare = render({ summary: summaryOf() });
    expect(bare).not.toContain('data-testid="concept-draft-left-out"');
    expect(bare).not.toContain('data-testid="concept-draft-note"');
    expect(copy(bare)).toContain('Nothing for the rules to flag.');
  });

  it('says the draft matches when it would change nothing', () => {
    const same = render({ summary: summaryOf({}, DRAFTED) });
    expect(copy(same)).toContain('The draft matches the build as it is.');
  });
});

// ---------------------------------------------------------------------------
// Stopped, refused, taken
// ---------------------------------------------------------------------------

describe('a draft that did not arrive', () => {
  it('says a stop was a stop, and that nothing changed', () => {
    const html = render({ prompt: DESCRIPTION, stopped: true });
    expect(copy(html)).toContain('Stopped. Nothing on the build changed.');
    expect(html).not.toContain('data-testid="concept-describe-error"');
  });

  it('says a refusal as an alert, in the lane’s words', () => {
    const html = render({
      prompt: DESCRIPTION,
      error: 'The Fixer is already drafting a runner — wait for that draft to finish, or stop it if it is this one.',
    });
    const tag = tagWith(html, 'concept-describe-error');
    expect(tag).toContain('role="alert"');
    expect(copy(html)).toContain('already drafting a runner');
  });

  it('says a draft that was taken is now on every step, and is the player’s to change', () => {
    const html = render({ taken: true });
    expect(copy(html)).toContain('every step now holds it, and all of it is yours to change there');
    expect(html).not.toContain('data-testid="concept-draft"');
  });
});

describe('the status line', () => {
  const state = (over: Partial<DescribeRunnerViewProps>) => describeStatus(props(over));

  it('says one thing at a time, drafting first', () => {
    expect(state({ busy: true, stopped: true, taken: true, summary: summaryOf() })).toContain('The Fixer is drafting');
    expect(state({ stopped: true, taken: true })).toContain('Stopped');
    expect(state({ taken: true, summary: summaryOf() })).toContain('Draft taken');
  });
});

// ---------------------------------------------------------------------------
// The controls
// ---------------------------------------------------------------------------

describe('the controls', () => {
  function deps(over: Partial<DescribeRunnerDeps> = {}) {
    const drafted: string[] = [];
    const updates: BuildUpdater[] = [];
    const stops: number[] = [];
    const proposals: (BuildProposal | null)[] = [];
    const takens: boolean[] = [];
    const base: DescribeRunnerDeps = {
      prompt: DESCRIPTION,
      busy: false,
      proposal: proposal(),
      editable: true,
      update: (fn) => updates.push(fn),
      draft: (text) => drafted.push(text),
      stop: () => stops.push(1),
      setProposal: (p) => proposals.push(p),
      setTaken: (t) => takens.push(t),
      ...over,
    };
    return { on: describeRunnerHandlers(base), drafted, updates, stops, proposals, takens };
  }

  it('drafts the trimmed description, and clears the last "taken" line as it goes', () => {
    const d = deps({ prompt: `  ${DESCRIPTION}  ` });
    d.on.onDraft();
    expect(d.drafted).toEqual([DESCRIPTION]);
    expect(d.takens).toEqual([false]);
  });

  it('will not draft from too few words, while one is running, or on a build it may not edit', () => {
    for (const over of [{ prompt: 'a' }, { busy: true }, { editable: false }]) {
      expect(deps(over).drafted).toEqual([]);
      const d = deps(over);
      d.on.onDraft();
      expect(d.drafted).toEqual([]);
    }
  });

  it('stops only the draft that is running', () => {
    const running = deps({ busy: true });
    running.on.onStop();
    expect(running.stops).toEqual([1]);
    const idle = deps();
    idle.on.onStop();
    expect(idle.stops).toEqual([]);
  });

  it('takes the draft as one pure updater over the build as it stands, and puts the card away', () => {
    const d = deps();
    d.on.onAccept();
    expect(d.updates).toHaveLength(1);
    const out = d.updates[0]!(CURRENT);
    expect(out).toEqual(acceptProposal(CURRENT, DRAFTED));
    expect(out.metatype).toBe('troll');
    // The record it is laid over is the one the shell hands the updater, not a copy taken earlier.
    const moved: CharacterBuild = { ...CURRENT, identity: { ...CURRENT.identity, alias: 'Typed Later' } };
    expect(d.updates[0]!(moved).identity.alias).toBe('Typed Later');
    expect(d.proposals).toEqual([null]);
    expect(d.takens).toEqual([true]);
  });

  it('takes nothing from a read-only build, and nothing when there is no draft', () => {
    for (const over of [{ editable: false }, { proposal: null }]) {
      const d = deps(over);
      d.on.onAccept();
      expect(d.updates).toEqual([]);
      expect(d.takens).toEqual([]);
    }
  });

  it('throws a draft away without touching the build', () => {
    const d = deps();
    d.on.onDiscard();
    expect(d.proposals).toEqual([null]);
    expect(d.updates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe('structure', () => {
  const html = render({
    prompt: DESCRIPTION,
    summary: summaryOf({ warnings: ['“Zap Gun” is not in this campaign’s books — left out'], note: 'Kept it cheap.' }),
  });

  it('puts its heading under the frame’s h1, with the card’s under that', () => {
    expect(html).not.toContain('<h1');
    const headings = [...html.matchAll(/<(h[1-6])[^>]*>([^<]*)<\/h[1-6]>/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(headings[0]).toBe('h2 Describe your runner');
    expect(headings).toContain('h4 Left out');
    const section = tagWith(html, 'concept-describe');
    expect(html).toContain(`id="${attr(section, 'aria-labelledby')}"`);
  });

  it('is one column on a phone, and reaches 40 px on touch', () => {
    expect(html).not.toContain('<table');
    expect(tagWith(html, 'concept-draft-lines')).toContain('grid-cols-1');
    expect(tagWith(html, 'concept-describe-prompt')).toContain('pointer-coarse:min-h-10');
    for (const button of [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0])) {
      expect(button, button).toMatch(/\bbtn\b|min-h-11|pointer-coarse:min-h-10/);
    }
  });

  it('keeps long words and the model’s own sentences from pushing the column sideways', () => {
    for (const testid of ['concept-draft-note', 'concept-describe-error']) {
      const tag = tagWith(render({ error: 'a'.repeat(200), summary: summaryOf({ note: 'b'.repeat(200) }) }), testid);
      expect(tag, testid).toContain('break-words');
    }
    expect(tagWith(html, 'concept-draft-left-out')).toBeTruthy();
    expect(html).toMatch(/<li class="break-words">/);
  });

  it('carries no stub copy', () => {
    expect(copy(html)).not.toMatch(/placeholder|coming soon|not implemented|lands here|TODO/i);
  });
});
