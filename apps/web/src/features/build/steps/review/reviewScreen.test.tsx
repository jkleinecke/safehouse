/**
 * The GM's review, rendered to static markup (docs/CHARGEN.md §4.4 Step 9
 * "the sheet, the build's choices step by step, the issues list including the
 * needs-GM items with approve/deny per item, and two buttons").
 *
 * Pinned, for an invented runner with one Restricted line:
 * - the Finish step shows the review for a GM on a submitted build, with the
 *   sheet, the choices (each with a labelled way to its step), the items to
 *   decide, the server's check and both actions;
 * - an open item: approve and deny unpressed, Approve refusing with the
 *   sentence tied to it;
 * - a decided item: its decision pressed, Approve open; a denied one keeps
 *   Approve shut and says to return the build;
 * - the confirmation before approving, and the way to the new sheet after;
 * - Return's note is required: the reason shows once the GM tries, tied to
 *   the field; the picker defaults to the first step with an error;
 * - a build with nothing to decide says so.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { CharacterBuild } from '@safehouse/contracts';
import { BUILD_ID, CAMPAIGN, SETTINGS } from '../../testing.js';
import { FinishView } from '../Finish.js';
import { finishProps, restrictedCode, withRestricted, type FinishPropsOver } from '../finish/fixtures.js';
import { ApprovalList, ReviewView, type ReviewViewProps } from './ReviewScreen.js';
import { approvalItems } from './review.js';

const noop = () => undefined;

function review(build: CharacterBuild, over: Partial<Omit<ReviewViewProps, 'actions'>> & FinishPropsOver = {}): ReviewViewProps {
  const { notes = '', returnStep = '', triedReturn = false, confirming = false, characterId = null, items, ...rest } = over;
  return {
    ...finishProps(build, { readOnly: true, reviewMode: true, role: 'gm', mode: 'free', ...rest }),
    items: items ?? approvalItems(build, SETTINGS),
    notes,
    returnStep,
    triedReturn,
    confirming,
    characterId,
    onNotes: noop,
    onReturnStep: noop,
    onReturn: noop,
    onDecide: noop,
    onApprovePress: noop,
    onApproveConfirm: noop,
    onApproveCancel: noop,
  };
}

const render = (p: ReviewViewProps) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/c/${CAMPAIGN}/build/${BUILD_ID}`]}>
      <ReviewView {...p} />
    </MemoryRouter>,
  );

const copy = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const tag = (html: string, testId: string) => new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';
const tags = (html: string, testId: string) => [...html.matchAll(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`, 'g'))].map((m) => m[0]);

const submitted = (): CharacterBuild => ({ ...withRestricted(), state: 'submitted' });

describe('the Finish step in review mode', () => {
  it('shows the review — sheet, choices, decisions, check and both actions — to a GM on a submitted build', () => {
    const build = submitted();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <FinishView
          {...finishProps(build, { readOnly: true, reviewMode: true, role: 'gm', mode: 'free' })}
          characterId={null}
          onApproved={noop}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('data-phase="review"');
    for (const id of ['finish-sheet', 'review-choices', 'review-approvals', 'finish-server-check', 'review-return', 'review-approve']) {
      expect(html, id).toContain(`data-testid="${id}"`);
    }
    expect(html).not.toContain('data-testid="finish-checklist"');
    expect(html).not.toContain('data-testid="finish-submit"');
    expect(html).not.toMatch(/<h1/);
    // The choices each open their step, by name.
    expect(tags(html, 'review-choices-open')).toHaveLength(9);
    expect(html).toMatch(/aria-label="open step 7 · Gear"/);
  });
});

describe('ReviewView — the items to decide', () => {
  it('leaves an open item unpressed and Approve refusing with its sentence', () => {
    const html = render(review(submitted()));
    expect(html).toMatch(/data-approval="approval-gear-lockpick-roll[^"]*" data-decision="open"/);
    expect(tags(html, 'review-approvals-approved')[0]).toContain('aria-pressed="false"');
    expect(tags(html, 'review-approvals-denied')[0]).toContain('aria-pressed="false"');
    expect(html).toMatch(/role="group" aria-label="Your decision: Lockpick Roll is Restricted; the GM decides\."/);
    const approve = tag(html, 'review-approve-button');
    expect(approve).toContain('aria-disabled="true"');
    const described = /aria-describedby="([^"]+)"/.exec(approve)?.[1];
    expect(html).toContain(`id="${described}"`);
    expect(copy(html)).toContain('1 item still to decide above before this build can be approved.');
    expect(copy(html)).toContain('0 approved · 0 denied · 1 open');
  });

  it('presses the decision already on the row and opens Approve', () => {
    const base = submitted();
    const build = { ...base, approvals: { [restrictedCode(base)]: 'approved' as const } };
    const html = render(review(build));
    expect(html).toMatch(/data-decision="approved"/);
    expect(tags(html, 'review-approvals-approved')[0]).toContain('aria-pressed="true"');
    const approve = tag(html, 'review-approve-button');
    expect(approve).not.toContain('aria-disabled');
    expect(approve).toContain('btn-accent');
  });

  it('keeps Approve shut on a denied item and points at returning the build', () => {
    const base = submitted();
    const build = { ...base, approvals: { [restrictedCode(base)]: 'denied' as const } };
    const html = render(review(build));
    expect(tags(html, 'review-approvals-denied')[0]).toContain('aria-pressed="true"');
    expect(tag(html, 'review-approve-button')).toContain('aria-disabled="true"');
    expect(copy(html)).toContain('1 item you denied, so it cannot be approved as it stands. Return it with a note');
  });

  it('marks the buttons busy while a decision is being saved', () => {
    const [item] = approvalItems(submitted(), SETTINGS);
    const html = renderToStaticMarkup(<ApprovalList items={[item!]} busy onDecide={noop} onGoTo={noop} />);
    expect(html).toMatch(/data-testid="review-approvals" aria-busy="true"/);
    expect(tags(html, 'review-approvals-approved')[0]).toContain('aria-disabled="true"');
  });

  it('says when nothing needs a decision', () => {
    const html = renderToStaticMarkup(<ApprovalList items={[]} busy={false} onDecide={noop} onGoTo={noop} />);
    expect(html).toContain('data-testid="review-approvals-empty"');
    expect(copy(html)).toContain('Nothing in this build needs your approval.');
  });
});

describe('ReviewView — approving', () => {
  const approvedBuild = () => {
    const base = submitted();
    return { ...base, approvals: { [restrictedCode(base)]: 'approved' as const } };
  };

  it('asks once more before approving', () => {
    const html = render(review(approvedBuild(), { confirming: true }));
    expect(html).toMatch(/role="group" aria-labelledby="[^"]+" class="[^"]*" data-testid="review-approve-confirm"/);
    expect(copy(html)).toContain('Approve this build and create the character now?');
    expect(html).toContain('data-testid="review-approve-go"');
    expect(html).toContain('data-testid="review-approve-cancel"');
  });

  it('says it is approving while it runs', () => {
    const p = review(approvedBuild());
    const html = render({ ...p, actions: { ...p.actions, busy: 'approve' } });
    expect(tag(html, 'review-approve-button')).toContain('aria-busy="true"');
    expect(copy(html)).toContain('approving…');
  });

  it("offers the new character's sheet once approved, and no return form", () => {
    const html = render(review(approvedBuild(), { characterId: 'char-7' }));
    expect(html).toMatch(/data-testid="review-approve" data-state="approved"/);
    expect(tag(html, 'review-approve-sheet')).toContain(`href="/c/${CAMPAIGN}/sheet/char-7"`);
    expect(html).not.toContain('data-testid="review-return"');
  });

  it("shows an action's refusal in words", () => {
    const html = render(review(approvedBuild(), { actions: { error: 'Only the GM approves builds.' } }));
    expect(html).toMatch(/role="alert" data-testid="review-error"/);
    expect(copy(html)).toContain('Only the GM approves builds.');
  });
});

describe('ReviewView — returning with notes', () => {
  it('labels the note and the step picker, and holds the reason until the GM tries', () => {
    const html = render(review(submitted(), { returnStep: '7' }));
    const notes = tag(html, 'review-return-notes');
    const notesId = /id="([^"]+)"/.exec(notes)?.[1];
    expect(html).toContain(`for="${notesId}"`);
    expect(notes).not.toContain('aria-invalid');
    expect(html).toMatch(/<option value="7" selected="">Step 7 · Gear<\/option>/);
    expect(tag(html, 'review-return-send')).toContain('aria-disabled="true"');
    expect(tag(html, 'review-return-reason')).toContain('sr-only');

    const tried = render(review(submitted(), { triedReturn: true }));
    const field = tag(tried, 'review-return-notes');
    expect(field).toContain('aria-invalid="true"');
    const described = /aria-describedby="([^"]+)"/.exec(field)?.[1];
    expect(tried).toMatch(new RegExp(`<p id="${described}" class="text-sm text-warn"[^>]*>Write a note first`));
  });

  it('opens once there is a note', () => {
    const html = render(review(submitted(), { notes: 'Pick something quieter than the carbine.' }));
    expect(tag(html, 'review-return-send')).not.toContain('aria-disabled');
    expect(html).toContain('Pick something quieter than the carbine.');
  });
});

describe('ReviewView — in the order a GM acts', () => {
  it('puts the decisions, Return and Approve before the sheet and the step-by-step summary', () => {
    const html = render(review(submitted()));
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const decisions = at('Needs your decision');
    const sheet = at('The runner in play');
    expect(decisions).toBeLessThan(sheet);
    expect(at('data-testid="review-approve"')).toBeLessThan(sheet);
    expect(copy(html)).not.toContain('This build is waiting on you.');
  });
});
