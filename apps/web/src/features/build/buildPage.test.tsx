/**
 * The walkthrough page as a whole (docs/CHARGEN.md §4.4, §8.6), rendered to
 * static markup through `BuildPageView` — the live wrapper only adds queries,
 * the session and the socket, all tested on their own.
 *
 * Pinned: the shell's parts are all present and wired to the same analysis
 * (strip, frame, rail, issues); two columns from `lg` with the rail folded
 * into a bottom bar below it; the GM's note on the step it names; review mode
 * for a GM on a submitted build; no stub copy anywhere a player reads; and
 * the step contract — every step screen renders from a hand-built
 * `StepProps`. Invented runners only.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { CharacterBuild } from '@safehouse/contracts';
import { BuildPageView, railSummary, type BuildPageViewProps } from './BuildPage.js';
import { issuesForStep, splitIssues, toStep } from './lib.js';
import { STEP_META, STEP_SCREENS, inertActions, stepMeta, type StepProps } from './steps/index.js';
import SkillsStep from './steps/Skills.js';
import { BUILD_ID, CAMPAIGN, SETTINGS, analysisOf, blankBuild, conceptBuild, recordOf } from './testing.js';

const noop = () => undefined;

function props(build: CharacterBuild, over: Partial<BuildPageViewProps> = {}): BuildPageViewProps {
  return {
    campaignId: CAMPAIGN,
    buildId: BUILD_ID,
    record: recordOf(build),
    isOwner: true,
    build,
    settings: SETTINGS,
    settingsFromCampaign: true,
    analysis: analysisOf(build),
    mode: build.mode,
    readOnly: false,
    reviewMode: false,
    role: 'player',
    save: { status: 'saved', error: null, retry: noop },
    update: noop,
    goTo: noop,
    setMode: noop,
    actions: inertActions(),
    ...over,
  };
}

const render = (p: BuildPageViewProps) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/c/${CAMPAIGN}/build/${BUILD_ID}`]}>
      <BuildPageView {...p} />
    </MemoryRouter>,
  );

const copy = (html: string) => html.replace(/<[^>]*>/g, ' ');

describe('BuildPageView', () => {
  it('assembles the strip, the frame, the rail and the issues from one analysis', () => {
    const build = { ...conceptBuild('muscle'), step: 3 };
    const html = render(props(build));
    expect(html).toContain('data-testid="progress-strip"');
    expect(html).toContain('data-testid="step-frame"');
    expect(html).toMatch(/data-testid="step-frame" data-step="3"/);
    expect(html).toContain('data-testid="build-rail"');
    expect(html).toContain('data-testid="build-issues"');
    expect(html).toContain('data-testid="build-alias"');
    expect(copy(html)).toContain('Kestrel Vane');
    expect(html).toContain('data-testid="save-indicator"');
  });

  it('is two columns from lg, with the rail folded into a bottom bar below it', () => {
    const html = render(props(blankBuild()));
    expect(html).toContain('lg:grid-cols-[minmax(0,1fr)_20rem]');
    expect(html).toMatch(/<aside class="hidden lg:block"/);
    expect(html).toMatch(/class="[^"]*lg:hidden[^"]*" data-testid="rail-bar"/);
    expect(html).toMatch(/aria-expanded="false"/);
  });

  it('summarises what is left on the phone bar, naming an overspent pool', () => {
    const a = analysisOf(blankBuild());
    expect(railSummary(a)).toMatch(/^\d+ to fix/);
    expect(railSummary({ ...a, issues: [] })).toBe('nothing to fix');
    const over = analysisOf({ ...conceptBuild('muscle'), karma: { ...conceptBuild('muscle').karma, toNuyen: 0 } });
    const pools = { ...over.budgets.pools, nuyen: { available: 1000, spent: 2500, remaining: -1500 } };
    const summary = railSummary({ issues: [], budgets: { ...over.budgets, pools } });
    expect(summary).toBe('nothing to fix · Nuyen over by 1,500¥');
    // A pool the bar already shows for this step is not said twice.
    expect(railSummary({ issues: [], budgets: { ...over.budgets, pools } }, ['nuyen'])).toBe('nothing to fix');
    // Checks on steps not reached are counted apart, last.
    expect(railSummary({ issues: [], budgets: over.budgets }, [], 14)).toBe('nothing to fix · 14 later');
  });

  it('does not shout on a fresh build: the bar and the issues list count later steps apart', () => {
    const fresh = blankBuild();
    const all = analysisOf(fresh).issues;
    const { now, later } = splitIssues(all, 1, fresh);
    expect(later.length).toBeGreaterThan(0);
    const html = render(props(fresh));
    const summary = copy(/data-testid="rail-bar-summary">(.*?)<\/span>/.exec(html)![1]!);
    expect(summary).toContain(`${later.length} later`);
    expect(summary).not.toContain(`${all.filter((i) => i.severity === 'error').length} to fix`);
    expect(html).toContain('data-testid="build-issues-later"');
    expect(copy(/data-testid="build-issues-count">(.*?)<\/span>/.exec(html)![1]!)).toBe(`${now.length} · ${later.length} later`);
    // A reader (the GM's review) is not walking the steps: every finding counts.
    const review = render(props({ ...conceptBuild('muscle'), state: 'submitted' }, { readOnly: true, reviewMode: true, role: 'gm' }));
    expect(review).not.toContain('data-testid="build-issues-later"');
  });

  it("puts the step's own pools on the phone bar, above the home indicator", () => {
    const build = { ...conceptBuild('muscle'), step: 6 };
    const html = render(props(build));
    const bar = /data-testid="rail-bar-pools">(.*?)<\/span><\/button>/.exec(html)![1]!;
    expect(bar).toContain('data-pool="skills"');
    expect(bar).toContain('data-pool="groups"');
    expect(bar).toContain('data-pool="knowledge"');
    expect(copy(bar)).toMatch(/Skill points \d+ left/);
    expect(html).toContain('pb-[max(0.5rem,env(safe-area-inset-bottom))]');
    // Nothing to control until the sheet exists.
    expect(/<button[^>]*aria-expanded="false"[^>]*>/.exec(html)![0]).not.toContain('aria-controls');
    // A step that spends no pool shows none.
    expect(render(props({ ...conceptBuild('muscle'), step: 1 }))).not.toContain('data-testid="rail-bar-pools"');
  });

  it("a GM on a player's open build reads it until they switch on edit-as-GM", () => {
    const build = conceptBuild('muscle');
    let asked: boolean | null = null;
    const reading = render(
      props(build, { role: 'gm', readOnly: true, mode: 'free', gmEdit: { available: true, on: false, set: (on) => (asked = on) } }),
    );
    expect(reading).toMatch(/aria-pressed="false"[^>]*data-testid="gm-edit"/);
    expect(reading).not.toContain('data-testid="mode-guided"');
    expect(reading).not.toContain('data-testid="gm-edit-note"');
    expect(asked).toBeNull();
    const editing = render(props(build, { role: 'gm', mode: 'free', gmEdit: { available: true, on: true, set: noop } }));
    expect(editing).toMatch(/aria-pressed="true"[^>]*data-testid="gm-edit"/);
    expect(editing).toContain('data-testid="gm-edit-note"');
    // Gated steps never apply to the GM.
    expect(editing).not.toContain('data-testid="mode-free"');
    expect(render(props(build))).not.toContain('data-testid="gm-edit"');
  });

  it("pins a returned build's GM note to the step it names", () => {
    const build: CharacterBuild = {
      ...conceptBuild('muscle'),
      state: 'returned',
      notes: 'The lifestyle is missing.',
      returnedStep: 7,
      step: 7,
    };
    const onStep = render(props(build));
    expect(onStep).toContain('data-testid="gm-note"');
    expect(copy(onStep)).toContain('The lifestyle is missing.');
    const elsewhere = render(props({ ...build, step: 2 }));
    expect(elsewhere).toContain('data-testid="gm-note-pointer"');
    // On Finish the note is read once: in full in the frame, never a pointer and a copy.
    const finish = render(props({ ...build, step: 9 }));
    expect(finish).not.toContain('data-testid="gm-note-pointer"');
    expect(finish.split('The lifestyle is missing.')).toHaveLength(2);
  });

  it("frames step 2 with the rule for the build's method", () => {
    const tens: CharacterBuild = { ...conceptBuild('face'), method: 'sumToTen', step: 2 };
    expect(copy(render(props(tens)))).toContain('rows may repeat');
    expect(copy(render(props({ ...tens, method: 'priority' })))).toContain('Each row can hold one column');
  });

  it('a GM on a submitted build is in review: read only, free, no mode switch', () => {
    const build: CharacterBuild = { ...conceptBuild('muscle'), state: 'submitted' };
    const html = render(props(build, { role: 'gm', reviewMode: true, readOnly: true, mode: 'free' }));
    expect(html).toMatch(/data-testid="build-state"[^>]*>review</);
    expect(html).not.toContain('data-testid="mode-guided"');
    expect(html).toContain('role="tablist"');
    expect(copy(html)).toContain('read only');
  });

  it("says a refused approve or deny on the step where the GM pressed it, not only on the review screen", () => {
    const build: CharacterBuild = { ...conceptBuild('muscle'), state: 'submitted', step: 7 };
    const refused = { ...inertActions(), error: 'The build changed since you opened it.' };
    const onGear = render(props(build, { role: 'gm', reviewMode: true, readOnly: true, mode: 'free', actions: refused }));
    expect(onGear).toMatch(/role="alert" data-testid="review-step-error"/);
    expect(copy(onGear)).toContain('The build changed since you opened it.');
    // Nothing refused, nothing said; and the review screen (step 9) keeps its own alert.
    expect(render(props(build, { role: 'gm', reviewMode: true, readOnly: true, mode: 'free' }))).not.toContain('review-step-error');
    expect(render(props({ ...build, step: 9 }, { role: 'gm', reviewMode: true, readOnly: true, mode: 'free', actions: refused }))).not.toContain(
      'review-step-error',
    );
    // A player is never shown the GM's refusals here.
    expect(render(props(build, { readOnly: true, actions: refused }))).not.toContain('review-step-error');
  });

  it("opens Finish with words for where the build stands: sent, in the GM's review, or approved", () => {
    const sent: CharacterBuild = { ...conceptBuild('muscle'), state: 'submitted', step: 9 };
    const player = copy(render(props(sent, { readOnly: true })));
    expect(player).toContain('The runner is with the GM now');
    expect(player).not.toContain('send it to the GM');
    const gm = copy(render(props(sent, { role: 'gm', reviewMode: true, readOnly: true, mode: 'free' })));
    expect(gm).toContain('Read the runner as it will play and decide what the rules leave to you.');
    expect(copy(render(props({ ...conceptBuild('muscle'), step: 9 })))).toContain('send it to the GM');
    expect(copy(render(props({ ...sent, state: 'approved' }, { readOnly: true })))).toContain('on the roster');
  });

  it('on a phone: the header scrolls away, the strip stays, and the bar is one line with the full words for a screen reader', () => {
    const html = render(props({ ...conceptBuild('muscle'), step: 6 }));
    expect(html).toMatch(/<div class="border-b border-edge bg-deck" data-testid="build-header">/);
    expect(html).toMatch(/<div class="sticky top-0 z-30[^"]*" data-testid="build-strip">/);
    const bar = html.slice(html.indexOf('data-testid="rail-bar-pools"'), html.indexOf('data-testid="rail-bar-summary"'));
    expect(bar).toMatch(/<span aria-hidden="true">Skill \d+<\/span><span class="sr-only">Skill points \d+ left<\/span>/);
    expect(html).toContain('pools<span class="hidden sm:inline"> &amp; issues</span>');
    // Issues first in the laptop aside, each in its own scroll, so what blocks Next is in view.
    const aside = html.slice(html.indexOf('data-testid="build-aside"'));
    expect(aside.indexOf('data-testid="build-aside-issues"')).toBeLessThan(aside.indexOf('data-testid="build-aside-pools"'));
    // Thumb-sized: the way back to the list, the mode chips.
    expect(html).toMatch(/class="mono-label inline-flex min-h-10[^"]*"[^>]*>← builds/);
    expect(/<button[^>]*data-testid="mode-guided"/.exec(html)![0]).toContain('pointer-coarse:min-h-10');
  });

  it('offers guided and free, pressed as the build remembers', () => {
    const html = render(props({ ...blankBuild(), mode: 'free' }, { mode: 'free' }));
    expect(html).toMatch(/aria-pressed="true"[^>]*data-testid="mode-free"/);
  });

  it("says when the campaign's settings could not be read", () => {
    const html = render(props(blankBuild(), { settingsFromCampaign: false }));
    expect(copy(html)).toContain("creation settings could not be read");
  });

  it('renders no stub copy on any step', () => {
    for (const meta of STEP_META) {
      const html = render(props({ ...conceptBuild('street-mage'), step: meta.step }));
      expect(copy(html), `step ${meta.step}`).not.toMatch(/placeholder|coming soon|not implemented|lands here/i);
    }
  });
});

describe('the step contract', () => {
  function stepProps(build: CharacterBuild): StepProps {
    const analysis = analysisOf(build);
    const step = toStep(build.step);
    return {
      campaignId: CAMPAIGN,
      buildId: BUILD_ID,
      characterId: null,
      isOwner: true,
      meta: stepMeta(step),
      build,
      settings: SETTINGS,
      settingsFromCampaign: true,
      budgets: analysis.budgets,
      issues: issuesForStep(analysis.issues, step),
      allIssues: analysis.issues,
      status: analysis.steps[step - 1]!,
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
    };
  }

  it('registers a lazy screen for each of the nine steps', () => {
    expect(Object.keys(STEP_SCREENS)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(STEP_META.map((m) => m.name)).toEqual([
      'concept',
      'priorities',
      'metatype',
      'magic',
      'qualities',
      'skills',
      'gear',
      'karma',
      'finish',
    ]);
  });

  it('every step opens with two sentences and a page, in our words', () => {
    for (const meta of STEP_META) {
      expect(meta.intro.split(/(?<=\.)\s+/).length, meta.name).toBe(2);
      expect(meta.allows.length).toBeGreaterThan(20);
      expect(meta.ref.book).toBe('SR5');
    }
  });

  it("a step body renders from StepProps alone, with what blocks it in the engine's words", () => {
    // A stub screen: the contract is that StepProps carries what blocks the step, sentence and page, and nothing else is needed.
    function Stub({ status }: StepProps) {
      return status.blocking.length > 0 ? (
        <ul data-testid="stub-blocking">
          {status.blocking.map((i) => (
            <li key={i.code}>
              {i.message} {i.ref.book} p.{i.ref.page}
            </li>
          ))}
        </ul>
      ) : (
        <p data-testid="stub-complete">done</p>
      );
    }
    const blank = renderToStaticMarkup(<Stub {...stepProps({ ...blankBuild(), step: 2 })} />);
    expect(blank).toContain('Choose a priority for Metatype.');
    expect(blank).toContain('SR5 p.65');
    expect(renderToStaticMarkup(<Stub {...stepProps({ ...conceptBuild('muscle'), step: 2 })} />)).toContain('data-testid="stub-complete"');

    // And a real screen needs nothing but StepProps either.
    expect(renderToStaticMarkup(<SkillsStep {...stepProps({ ...conceptBuild('muscle'), step: 6 })} />)).toContain('data-testid="skills-step"');
  });
});
