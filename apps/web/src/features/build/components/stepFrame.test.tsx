/**
 * The step frame (docs/CHARGEN.md §4.4 "Next only opens when the step is
 * complete, and the screen says exactly what is missing … Back always
 * works"; free mode "nothing gated but Submit").
 *
 * Also the frame's two companions: the GM's note pinned to the step it names,
 * and the autosave line. Real engine statuses over invented runners.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChargenSettingsSchema, type CharacterBuild } from '@safehouse/contracts';
import { analyseBuild } from '../analysis.js';
import GmNoteBanner, { noteDisplay } from './GmNoteBanner.js';
import SaveIndicator, { saveAnnouncement, saveText } from './SaveIndicator.js';
import StepFrame, { NextConfirmPanel, nextPress } from './StepFrame.js';
import { nextConfirmFor } from '../steps/confirm.js';
import { stepMeta, stepMetaFor } from '../steps/meta.js';
import { analysisOf, blankBuild, conceptBuild } from '../testing.js';

const noop = () => undefined;

describe('StepFrame', () => {
  it("opens with the step's intro and a why-link to its page", () => {
    const a = analysisOf(blankBuild());
    const html = renderToStaticMarkup(
      <StepFrame meta={stepMeta(2)} status={a.steps[1]!} mode="guided" onBack={noop} onNext={noop}>
        body
      </StepFrame>,
    );
    expect(html).toContain('data-testid="step-intro"');
    expect(html).toContain(stepMeta(2).intro.replace(/'/g, '&#x27;'));
    expect(html).toContain('data-testid="step-why"');
    expect(html).toContain('SR5 p.65');
  });

  it('the intro slot replaces the stock sentences but keeps the why-link', () => {
    const a = analysisOf(blankBuild());
    const html = renderToStaticMarkup(
      <StepFrame meta={stepMeta(6)} status={a.steps[5]!} mode="guided" onBack={noop} onNext={noop} intro={<b>Priority C: 28 skill points.</b>}>
        body
      </StepFrame>,
    );
    expect(html).toContain('<b>Priority C: 28 skill points.</b>');
    expect(html).not.toContain(stepMeta(6).intro);
    expect(html).toContain('SR5 p.88');
  });

  it('guided: Next is shut on an incomplete step, and the reason is tied to it', () => {
    const a = analysisOf(blankBuild());
    const html = renderToStaticMarkup(
      <StepFrame meta={stepMeta(2)} status={a.steps[1]!} mode="guided" onBack={noop} onNext={noop}>
        body
      </StepFrame>,
    );
    const next = /<button[^>]*data-testid="step-next"[^>]*>/.exec(html)![0];
    expect(next).toContain('aria-disabled="true"');
    expect(next).toContain('data-open="no"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(next)![1]!;
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toMatch(/Next opens when this is done: Choose a priority for Metatype\. \(and 4 more\)/);
    // Back always works.
    expect(/<button[^>]*data-testid="step-back"[^>]*>/.exec(html)![0]).not.toContain('aria-disabled');
  });

  it('guided: Next opens once the engine says the step is complete', () => {
    const a = analysisOf(conceptBuild('muscle'));
    const html = renderToStaticMarkup(
      <StepFrame meta={stepMeta(2)} status={a.steps[1]!} mode="guided" onBack={noop} onNext={noop}>
        body
      </StepFrame>,
    );
    expect(html).toContain('data-open="yes"');
    expect(html).not.toContain('data-testid="step-gate-reason"');
  });

  it('free: Next is always open and what is missing is a note, not a lock', () => {
    const a = analysisOf(blankBuild());
    const html = renderToStaticMarkup(
      <StepFrame meta={stepMeta(2)} status={a.steps[1]!} mode="free" onBack={noop} onNext={noop} panelId="p">
        body
      </StepFrame>,
    );
    expect(html).toContain('data-open="yes"');
    expect(html).toContain('data-gated="no"');
    expect(html).toContain('Still open on this step:');
    expect(html).toContain('role="tabpanel"');
  });

  it('keeps Back in place on the first step, shut rather than removed, and draws no dead Next on the last', () => {
    // Removing the focused button when the step changes drops focus to the document.
    const a = analysisOf(conceptBuild('muscle'));
    const first = renderToStaticMarkup(
      <StepFrame meta={stepMeta(1)} status={a.steps[0]!} mode="guided" onBack={null} onNext={noop}>
        body
      </StepFrame>,
    );
    const back = /<button[^>]*data-testid="step-back"[^>]*>/.exec(first)![0];
    expect(back).toContain('aria-disabled="true"');
    expect(back).toContain('data-open="no"');
    const last = renderToStaticMarkup(
      <StepFrame meta={stepMeta(9)} status={a.steps[8]!} mode="guided" onBack={noop} onNext={null}>
        body
      </StepFrame>,
    );
    // Finish's own Submit is the way forward; a greyed "next" with no reason said nothing (focus goes to the new heading anyway).
    expect(last).not.toContain('data-testid="step-next"');
    expect(last).toContain('data-testid="step-back"');
  });

  it('the heading can take focus when the step changes, without joining the tab order', () => {
    const a = analysisOf(blankBuild());
    const html = renderToStaticMarkup(
      <StepFrame meta={stepMeta(2)} status={a.steps[1]!} mode="guided" onBack={noop} onNext={noop}>
        body
      </StepFrame>,
    );
    expect(html).toMatch(/<h1[^>]*tabindex="-1"[^>]*>Priorities<\/h1>/);
  });

  it("says when the engine skipped a step (a mundane's Magic step)", () => {
    const a = analysisOf(conceptBuild('muscle'));
    const magic = a.steps[3]!;
    expect(magic.skipped).toBe(true);
    const html = renderToStaticMarkup(
      <StepFrame meta={stepMeta(4)} status={magic} mode="guided" onBack={noop} onNext={noop}>
        body
      </StepFrame>,
    );
    expect(html).toContain('data-testid="step-skipped"');
  });
});

describe('the frame’s copy for the build’s method', () => {
  it('says step 2’s rule the way the method has it: one column a row on the table, repeats under Sum to Ten', () => {
    expect(stepMetaFor(2, 'priority')).toBe(stepMeta(2));
    expect(stepMeta(2).allows).toContain('Each row can hold one column');
    const tens = stepMetaFor(2, 'sumToTen');
    expect(tens.allows).toContain('rows may repeat');
    expect(tens.allows).not.toContain('Each row can hold one column');
    // Only the sentence changes; a step the method does not touch is the stock copy.
    expect({ ...tens, allows: stepMeta(2).allows }).toEqual(stepMeta(2));
    expect(stepMetaFor(3, 'sumToTen')).toBe(stepMeta(3));

    const a = analysisOf(blankBuild());
    const html = renderToStaticMarkup(
      <StepFrame meta={tens} status={a.steps[1]!} mode="guided" onBack={noop} onNext={noop}>
        body
      </StepFrame>,
    );
    expect(html).toContain('rows may repeat');
    expect(html).not.toContain('Each row can hold one column');
  });
});

describe('a loss acknowledged before Next', () => {
  it("asks on step 2 when Sum to Ten leaves priority points unspent, in the engine's words and page", () => {
    const settings = ChargenSettingsSchema.parse({ allowSumToTen: true });
    // B 3 + C 2 + E 0 + D 1 + E 0: six of the ten points.
    const under: CharacterBuild = {
      ...blankBuild(),
      method: 'sumToTen',
      priorities: { metatype: 'B', attributes: 'C', magic: 'E', skills: 'D', resources: 'E' },
    };
    const status = analyseBuild(under, settings).steps[1]!;
    const warning = status.warnings.find((w) => w.code === 'sum-to-ten-under');
    expect(warning?.message).toBe('4 priority points left unspent.');
    const confirm = nextConfirmFor(status)!;
    expect(confirm.lead).toContain('Priority points do not carry over');
    expect(confirm.message).toBe(warning!.message);
    expect(confirm.ref).toEqual({ book: 'RF', page: 62 });
    expect(confirm.confirmLabel).toBe('I meant to — next');
    // All ten spent, or the priority table: nothing to ask.
    const spent = { ...under, priorities: { metatype: 'A', attributes: 'A', magic: 'E', skills: 'C', resources: 'E' } } as CharacterBuild;
    expect(nextConfirmFor(analyseBuild(spent, settings).steps[1]!)).toBeNull();
    expect(nextConfirmFor(analysisOf(conceptBuild('face')).steps[1]!)).toBeNull();
  });

  it("asks on step 3 when special points are unspent, in the engine's words", () => {
    const build = conceptBuild('face');
    expect(build.special.edg).toBeGreaterThan(0);
    const unspent = { ...build, special: { ...build.special, edg: 0 } };
    const status = analysisOf(unspent).steps[2]!;
    const warning = status.warnings.find((w) => w.code === 'special-points-unspent');
    expect(warning).toBeDefined();
    const confirm = nextConfirmFor(status)!;
    expect(confirm.message).toBe(warning!.message);
    expect(confirm.ref).toEqual(warning!.ref);
    // The loss is at the end of creation, not on leaving the step (Back reopens it).
    expect(confirm.lead).toBe('Special points do not carry over: any left unspent when the runner is finished are gone.');

    // Open Next asks first; asked once, the next press goes.
    expect(nextPress(true, true, confirm, false)).toBe('confirm');
    expect(nextPress(true, true, confirm, true)).toBe('go');
    // Shut or last: nothing to ask.
    expect(nextPress(false, true, confirm, false)).toBe('none');
    expect(nextPress(true, false, confirm, false)).toBe('none');
    expect(nextPress(true, true, null, false)).toBe('go');

    const panel = renderToStaticMarkup(<NextConfirmPanel confirm={confirm} onConfirm={noop} onStay={noop} />);
    expect(panel).toContain('data-testid="step-next-confirm"');
    expect(panel).toContain('I meant to — next');
    expect(panel).toContain('stay here');
    expect(panel).toContain('SR5 p.66');
  });

  it('does not ask when nothing is about to be lost, or on a step with no such loss', () => {
    const a = analysisOf(conceptBuild('face'));
    expect(a.steps[2]!.warnings.some((w) => w.code === 'special-points-unspent')).toBe(false);
    expect(nextConfirmFor(a.steps[2]!)).toBeNull();
    expect(nextConfirmFor(a.steps[5]!)).toBeNull();
    // Step 7's loss is nuyen above the carry-over.
    expect(
      nextConfirmFor({
        step: 7,
        warnings: [{ code: 'nuyen-carry-lost', severity: 'warning', step: 7, message: '3,000¥ will not carry over.', ref: { book: 'SR5', page: 94 } }],
      })?.message,
    ).toBe('3,000¥ will not carry over.');
  });
});

describe("the GM's note", () => {
  it('shows in full on the step it names, as a pointer elsewhere, and not at all once resubmitted', () => {
    const base = { state: 'returned' as const, notes: 'Two attributes start at their maximum.', returnedStep: 3 };
    expect(noteDisplay({ ...base, step: 3 })).toBe('full');
    expect(noteDisplay({ ...base, step: 6 })).toBe('pointer');
    expect(noteDisplay({ ...base, returnedStep: null, step: 6 })).toBe('full');
    expect(noteDisplay({ ...base, state: 'submitted', step: 3 })).toBe('none');
    // Finish, where the build is sent back, shows it in full with the way to its step — the one copy on that screen.
    expect(noteDisplay({ ...base, step: 9 })).toBe('full');
    const finish = renderToStaticMarkup(<GmNoteBanner {...base} step={9} onGoTo={noop} />);
    expect(finish).toContain('data-testid="gm-note"');
    expect(finish).not.toContain('data-testid="gm-note-pointer"');
    expect(finish).toContain('data-testid="gm-note-step"');
    expect(finish.split('Two attributes start at their maximum.')).toHaveLength(2);

    const full = renderToStaticMarkup(<GmNoteBanner {...base} step={3} />);
    expect(full).toContain('data-testid="gm-note"');
    expect(full).toContain('Two attributes start at their maximum.');
    const pointer = renderToStaticMarkup(<GmNoteBanner {...base} step={6} onGoTo={noop} />);
    expect(pointer).toContain('data-testid="gm-note-pointer"');
    expect(pointer).toContain('step 3, Metatype &amp; attributes');
  });
});

describe('the autosave line', () => {
  it('says saving, saved, unsaved and not saved in words', () => {
    expect(saveText('saving', false)).toBe('saving…');
    expect(saveText('saved', false)).toBe('saved');
    expect(saveText('dirty', false)).toBe('unsaved changes');
    expect(saveText('error', false)).toBe('not saved');
    expect(saveText('idle', true)).toBe('read only');
    expect(saveText('conflict', true)).toBe('not saved');
  });

  it('offers the two ways out of a stale save, each tied to the sentence that explains it', () => {
    const html = renderToStaticMarkup(
      <SaveIndicator
        status="conflict"
        error="Saved from another device while you were editing."
        readOnly
        stale={{ onKeepMine: noop, onTakeTheirs: noop }}
      />,
    );
    expect(html).toContain('data-testid="save-stale"');
    const id = /<span id="([^"]+)"[^>]*data-testid="save-error"/.exec(html)![1]!;
    expect(html).toMatch(new RegExp(`<button[^>]*aria-describedby="${id}"[^>]*data-testid="save-keep-mine"[^>]*>keep mine</button>`));
    expect(html).toMatch(new RegExp(`<button[^>]*aria-describedby="${id}"[^>]*data-testid="save-take-theirs"[^>]*>take theirs</button>`));
    // Only a conflict asks: once settled, the choice is gone.
    expect(renderToStaticMarkup(<SaveIndicator status="saving" error={null} readOnly={false} stale={{ onKeepMine: noop, onTakeTheirs: noop }} />)).not.toContain(
      'keep mine',
    );
  });

  it('speaks only failures, not the saving cycle every edit runs through', () => {
    expect(saveAnnouncement('dirty', null)).toBe('');
    expect(saveAnnouncement('saving', null)).toBe('');
    expect(saveAnnouncement('saved', null)).toBe('');
    expect(saveAnnouncement('error', 'the host fell over')).toBe('Not saved: the host fell over');
    expect(saveAnnouncement('conflict', null)).toBe('Not saved.');
    const saving = renderToStaticMarkup(<SaveIndicator status="saving" error={null} readOnly={false} />);
    // The word is shown, but the live region is empty.
    expect(saving).toContain('saving…');
    expect(saving).toMatch(/role="status"[^>]*data-testid="save-announcement"><\/span>/);
  });

  it('offers retry on a failure and explains a conflict without offering it', () => {
    const err = renderToStaticMarkup(<SaveIndicator status="error" error="the host fell over" readOnly={false} onRetry={noop} />);
    expect(err).toContain('role="status"');
    expect(err).toContain('Not saved: the host fell over');
    expect(err).toContain('the host fell over');
    expect(err).toMatch(/<button[^>]*>retry<\/button>/);
    const conflict = renderToStaticMarkup(
      <SaveIndicator status="conflict" error="This build was submitted elsewhere." readOnly onRetry={noop} />,
    );
    expect(conflict).toContain('This build was submitted elsewhere.');
    expect(conflict).not.toContain('retry');
    expect(conflict).not.toContain('keep mine');
  });
});
