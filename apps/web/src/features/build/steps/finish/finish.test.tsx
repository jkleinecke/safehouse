/**
 * The Finish step's faces, rendered to static markup (docs/CHARGEN.md §4.4
 * Step 9, §8.6).
 *
 * Pinned, for invented runners with the engine's real findings:
 * - a build with something left: the checklist crosses the line with the
 *   engine's sentence and a labelled "fix in step N"; Submit stays focusable
 *   but refuses, its sentence counting what is left and tied to it by
 *   `aria-describedby`;
 * - a finished build: every line ticked and Submit open;
 * - a refused submit: the refusal and its findings as an alert; a running one
 *   says so;
 * - read only: no box, no Submit, the text instead;
 * - a returned build: "submit again", and the GM's note left to the frame's banner (read once),
 *   Submit for the owner only;
 * - submitted and approved: what the frozen state means, what comes next,
 *   the way to the character;
 * - the server's check in each of its faces;
 * - the sheet preview: its sections in heading order under the frame's h1,
 *   the wide tables in their own scrollers, pools as read-only breakdowns,
 *   the print stylesheet mounted and the print button left out of the page;
 * - the live wrapper names the approved row's character from `StepProps`, and
 *   renders without a query client.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { CharacterBuild, Issue } from '@safehouse/contracts';
import { BUILD_ID, CAMPAIGN, analysisOf, conceptBuild } from '../../testing.js';
import FinishStep, { FinishView, type FinishViewProps } from '../Finish.js';
import type { StepProps } from '../types.js';
import { finishProps, readyBuild, withRestricted, type FinishPropsOver } from './fixtures.js';

const noop = () => undefined;

function view(build: CharacterBuild, over: FinishPropsOver & Partial<Pick<FinishViewProps, 'characterId' | 'onPrint'>> = {}): FinishViewProps {
  const { characterId = null, onPrint = noop, ...rest } = over;
  return { ...finishProps(build, rest), characterId, onApproved: noop, onPrint };
}

const render = (p: FinishViewProps) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/c/${CAMPAIGN}/build/${BUILD_ID}`]}>
      <FinishView {...p} />
    </MemoryRouter>,
  );

const copy = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

/** The element with this test id, from its opening tag. */
const tag = (html: string, testId: string) => new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';

describe('Finish — a build with something left to fix', () => {
  const build = { ...conceptBuild('muscle'), step: 9 };
  const html = render(view(build));

  it('crosses the line with the engine’s sentence and a button to its step', () => {
    expect(html).toContain('data-testid="finish-edit"');
    expect(html).toMatch(/data-check="8" data-done="no"/);
    expect(html).toMatch(/data-check="1" data-done="yes"/);
    expect(html).toMatch(/data-check="4" data-done="skipped"/);
    expect(copy(html)).toContain('Karma left; at most 7 carries into play.');
    expect(html).toMatch(/<button[^>]*aria-label="fix in step 8 · Karma &amp; contacts"[^>]*>fix in step 8<\/button>/);
    // The mark is spoken, not only drawn.
    expect(html).toContain('<span class="sr-only">to do: </span>');
    expect(copy(html)).toContain('7 of 9 done');
  });

  it('keeps Submit focusable but refusing, with the count tied to it', () => {
    const button = tag(html, 'finish-submit-button');
    expect(button).toContain('aria-disabled="true"');
    const described = /aria-describedby="([^"]+)"/.exec(button)?.[1];
    expect(described).toBeTruthy();
    expect(html).toContain(`id="${described}"`);
    expect(copy(html)).toContain('1 thing to fix before this can go to the GM.');
    expect(html).toContain('data-testid="finish-submit-first"');
  });

  it('offers the background box, labelled by its heading and saved as typed', () => {
    const field = tag(html, 'finish-background-field');
    expect(field).toMatch(/^<textarea/);
    const labelled = /aria-labelledby="([^"]+)"/.exec(field)?.[1];
    expect(html).toMatch(new RegExp(`<h2 id="${labelled}"[^>]*>Background</h2>`));
    expect(copy(html)).toContain('Saved as you type');
  });

  it('has not heard from the server yet and says so', () => {
    expect(html).toMatch(/data-testid="finish-server-check" data-face="idle"/);
    expect(copy(html)).toContain('check now');
  });

  it('lays the sheet out under h2 and h3 only, with wide tables in their own scrollers', () => {
    expect(html).not.toMatch(/<h1/);
    expect(html).toMatch(/<h2[^>]*>The runner in play<\/h2>/);
    expect(html).toMatch(/<div class="overflow-x-auto" data-testid="finish-sheet-skills-scroll"><p aria-hidden="true" class="sticky left-0 pb-1 text-xs text-faint sm:hidden" data-testid="table-scroll-hint">swipe the table sideways for limit and pool →<\/p><table/);
    expect(html).toContain('<caption class="sr-only">Active skills with their ratings and dice pools</caption>');
    // Pools are the sheet's read-only breakdowns.
    expect(html).toMatch(/aria-label="Automatics pool: \d+\. Show breakdown"/);
    expect(html).not.toContain('Override…');
  });

  it('mounts the print stylesheet and leaves its own controls off the printout', () => {
    expect(html).toContain('data-testid="finish-print-style"');
    expect(html).toContain('@media print');
    expect(html).toMatch(/data-print-sheet=""/);
    expect(tag(html, 'finish-sheet-print')).toContain('data-print-hide=""');
    expect(tag(html, 'finish-submit')).toContain('data-print-hide=""');
    // The editable screen prints the background inside the sheet only.
    expect(tag(html, 'finish-sheet-background')).toContain('hidden print:block');
  });
});

describe('Finish — a finished build', () => {
  it('ticks every line and opens Submit', () => {
    const html = render(view(withRestricted()));
    expect(copy(html)).toContain('9 of 9 done');
    expect(html).not.toMatch(/data-done="no"/);
    const button = tag(html, 'finish-submit-button');
    expect(button).not.toContain('aria-disabled');
    expect(button).toContain('btn-accent');
    expect(copy(html)).toContain('nothing to fix · 1 item for the GM');
    expect(copy(html)).toContain('The items for the GM do not stop you');
  });
});

describe('Finish — submitting', () => {
  const refusal: Issue = {
    code: 'karma-carry-over',
    severity: 'error',
    step: 8,
    message: 'The server finds too much Karma left.',
    ref: { book: 'SR5', page: 98 },
  };

  it('shows a refusal and the findings that caused it as an alert', () => {
    const html = render(
      view(readyBuild(), {
        actions: { error: "The server's check still finds 1 thing to fix, so nothing was submitted.", refusalIssues: [refusal] },
      }),
    );
    const alert = /<div[^>]*role="alert"[^>]*data-testid="finish-submit-error">(.*?)<\/div>/.exec(html)?.[1] ?? '';
    expect(copy(alert)).toContain('still finds 1 thing to fix');
    expect(copy(alert)).toContain('The server finds too much Karma left.');
    expect(alert).toContain('SR5 p.98');
  });

  it('says it is sending while the submit runs', () => {
    const p = view(readyBuild());
    const html = render({ ...p, actions: { ...p.actions, busy: 'submit' } });
    const button = tag(html, 'finish-submit-button');
    expect(button).toContain('aria-busy="true"');
    expect(button).toContain('aria-disabled="true"');
    expect(copy(html)).toContain('submitting…');
    expect(copy(html)).toContain('Sending the build to the GM.');
  });
});

describe('Finish — read only', () => {
  it('shows the background as text and no Submit to someone who cannot write the build', () => {
    const html = render(view(readyBuild(), { readOnly: true, role: 'gm', mode: 'free' }));
    expect(html).not.toContain('data-testid="finish-background-field"');
    expect(html).toContain('data-testid="finish-background-text"');
    expect(html).not.toContain('data-testid="finish-submit"');
    expect(copy(html)).toContain('The player sends this build when it is ready');
  });
});

describe('Finish — returned by the GM', () => {
  const returned: CharacterBuild = { ...readyBuild(), state: 'returned', notes: 'Swap the carbine for something quieter.', returnedStep: 7 };

  it("offers 'submit again', and leaves the note to the frame’s banner so it is read once", () => {
    const html = render(view(returned));
    expect(copy(html)).toContain('submit again');
    // The banner above this screen shows it in full on Finish (buildPage.test); no second copy here.
    for (const r of [returned, { ...returned, returnedStep: null }, { ...returned, returnedStep: 9 as const }]) {
      const face = render(view(r));
      expect(face).not.toContain('data-testid="finish-gm-note"');
      expect(copy(face)).not.toContain('Swap the carbine for something quieter.');
    }
  });
});

describe('Finish — who may submit', () => {
  it('offers Submit to the owner only: a GM editing a player’s draft gets the sentence instead', () => {
    expect(render(view(readyBuild()))).toContain('data-testid="finish-submit"');
    const gm = render(view(readyBuild(), { role: 'gm', isOwner: false }));
    expect(gm).not.toContain('data-testid="finish-submit"');
    expect(copy(gm)).toContain('The player sends this build when it is ready');
    // A GM building a runner of their own is its owner, and submits it.
    expect(render(view(readyBuild(), { role: 'gm', isOwner: true }))).toContain('data-testid="finish-submit"');
  });
});

describe('Finish — submitted and approved', () => {
  it('explains the frozen build and what happens next, with the sheet and its background', () => {
    const html = render(view({ ...withRestricted(), state: 'submitted' }, { readOnly: true }));
    expect(html).toContain('data-phase="submitted"');
    expect(copy(html)).toContain('Waiting for the GM');
    expect(copy(html)).toContain('What happens next');
    expect(copy(html)).toContain('1 item waits on the GM');
    expect(html).not.toContain('data-testid="finish-checklist"');
    expect(tag(html, 'finish-sheet-background')).not.toContain('hidden');
    expect(copy(html)).toContain('Grew up hauling crates on the night docks.');
  });

  it('links an approved build to the character it became', () => {
    const html = render(view({ ...readyBuild(), state: 'approved' }, { readOnly: true, characterId: 'char-9' }));
    expect(html).toContain('data-phase="approved"');
    expect(tag(html, 'finish-character-link')).toContain(`href="/c/${CAMPAIGN}/sheet/char-9"`);
    const without = render(view({ ...readyBuild(), state: 'approved' }, { readOnly: true }));
    expect(without).not.toContain('data-testid="finish-character-link"');
    expect(copy(without)).toContain('The sheet is on the party roster.');
  });
});

describe("Finish — the server's check", () => {
  const build = readyBuild();
  const a = analysisOf(build);
  const data = { budgets: a.budgets, issues: a.issues, sheet: a.preview.compiled!.sheet };
  const withCheck = (check: Partial<StepProps['actions']['check']>) => {
    const p = view(build);
    return render({ ...p, actions: { ...p.actions, check: { ...p.actions.check, ...check } } });
  };

  it('says it is checking, or why it could not, in words', () => {
    const loading = withCheck({ loading: true });
    expect(loading).toMatch(/data-face="loading" aria-busy="true"/);
    expect(loading).toMatch(/role="status"[^>]*>Checking the saved build on the server…/);
    expect(tag(loading, 'finish-server-check-refresh')).toContain('aria-disabled="true"');
    const failed = withCheck({ error: 'The host did not answer.' });
    expect(failed).toMatch(/role="alert"[^>]*>The server&#x27;s check could not be read: The host did not answer\./);
  });

  it('agrees, or lists what only one side finds', () => {
    expect(copy(withCheck({ data }))).toContain('The server agrees with this page: nothing to fix.');
    const extra: Issue = { code: 'server-only', severity: 'error', step: 6, message: 'A rule this page does not know.', ref: { book: 'SR5', page: 88 } };
    const differs = withCheck({ data: { ...data, issues: [...a.issues, extra] } });
    expect(differs).toContain('data-face="differs"');
    const only = /data-testid="finish-server-check-only-server">(.*?)<\/ul>/.exec(differs)?.[1] ?? '';
    expect(copy(only)).toContain('A rule this page does not know.');
    expect(only).toMatch(/aria-label="step 6 — go to Skills"/);
    expect(differs).not.toContain('data-testid="finish-server-check-only-local"');
  });
});

describe('Finish — a record that cannot compile', () => {
  it('says so instead of showing numbers', () => {
    const p = view(readyBuild());
    const html = render({ ...p, preview: { compiled: null, derived: null, error: 'unknown metatype' } });
    expect(html).toMatch(/data-testid="finish-sheet" data-state="error"/);
    expect(copy(html)).toContain('cannot be put together from this build yet (unknown metatype)');
  });
});

describe('FinishStep (live)', () => {
  it("names an approved build's character from StepProps, the row the shell holds", () => {
    const build = { ...readyBuild(), state: 'approved' as const };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <FinishStep {...finishProps(build, { readOnly: true, characterId: 'char-42' })} />
      </MemoryRouter>,
    );
    expect(tag(html, 'finish-character-link')).toContain(`href="/c/${CAMPAIGN}/sheet/char-42"`);
  });

  it('renders without a query client', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <FinishStep {...finishProps(readyBuild())} />
      </MemoryRouter>,
    );
    expect(html).toContain('data-phase="edit"');
  });
});
