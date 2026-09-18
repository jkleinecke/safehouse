/**
 * The issues list under the rail (FR3.9, docs/CHARGEN.md §4.4 "every
 * validator finding, grouped error / warning / needs-GM, each a tap to the
 * step that fixes it and a tap to the page").
 *
 * It renders `validate()`'s findings as they are — the engine's own short
 * sentence, its step, its `{ book, page }` — in three groups a player reads in
 * order: what must be fixed, what is worth a look, what the GM decides. Each
 * row carries two controls: the step it belongs to (a button that moves the
 * walkthrough, or a link when the list is shown outside it) and the page
 * chip, which opens the self-hosted reader over the builder
 * (`features/gm/books/RefChip`) so the player never loses their place.
 *
 * Inside the walkthrough the list knows where the player is (`current` and
 * `build`): findings on steps not reached yet and holding nothing
 * (`splitIssues`) are counted apart and folded under "later steps", muted,
 * instead of sitting in "must fix" beside the step on screen. A fresh build
 * no longer opens with a wall of red; nothing is hidden — the fold opens, and
 * the Finish checklist lists everything.
 *
 * Severity is a glyph and a group heading as well as a colour. A GM's decision
 * on an approval issue shows beside it when one is recorded.
 */
import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { ApprovalDecision, BuildStep, Issue } from '@safehouse/contracts';
import { RefChip } from '../../gm/books/RefChip.js';
import { ISSUE_GROUPS, groupIssues, splitIssues, type StepContent } from '../lib.js';
import { stepMeta } from '../steps/meta.js';

export interface IssuesListProps {
  issues: readonly Issue[];
  /** Move the walkthrough to a step (inside the builder). */
  onGoTo?: (step: BuildStep) => void;
  /** Or link to it (outside the builder). Used when `onGoTo` is absent. */
  hrefFor?: (step: BuildStep) => string;
  /** The GM's decisions so far, keyed by issue code. */
  approvals?: Readonly<Record<string, ApprovalDecision>>;
  /**
   * The step the player is on, with the record: findings on steps not reached
   * and holding nothing fold under "later steps". Without both, every finding
   * is listed as it is (outside the walkthrough, and for a reader).
   */
  current?: BuildStep;
  build?: StepContent;
  /** Heading; the rail's list says "Issues". */
  title?: string;
  /** What to say when the build has none. */
  emptyText?: string;
  testId?: string;
}

function StepControl({ step, onGoTo, hrefFor }: Pick<IssuesListProps, 'onGoTo' | 'hrefFor'> & { step: BuildStep }) {
  const meta = stepMeta(step);
  const text = `step ${step} · ${meta.short}`;
  // The name starts with the words on the chip, so saying what you see works (WCAG 2.5.3).
  const label = `${text} — go to ${meta.title}`;
  if (onGoTo) {
    return (
      <button type="button" className="chip text-dim hover:text-cyan pointer-coarse:min-h-10" onClick={() => onGoTo(step)} aria-label={label}>
        {text}
      </button>
    );
  }
  if (hrefFor) {
    return (
      <Link to={hrefFor(step)} className="chip text-dim hover:text-cyan pointer-coarse:min-h-10" aria-label={label}>
        {text}
      </Link>
    );
  }
  return <span className="chip text-faint">{text}</span>;
}

function IssueGroups({
  issues,
  muted,
  onGoTo,
  hrefFor,
  approvals,
}: Pick<IssuesListProps, 'onGoTo' | 'hrefFor'> & { issues: readonly Issue[]; muted: boolean; approvals: Readonly<Record<string, ApprovalDecision>> }) {
  const groups = groupIssues(issues);
  return (
    <>
      {ISSUE_GROUPS.map((group) => {
        const list = groups[group.severity];
        if (list.length === 0) return null;
        const tone = muted ? 'text-faint' : group.tone;
        return (
          <div key={group.severity} className="mt-3" data-issue-group={group.severity}>
            <h3 className={`mono-label ${tone}`}>
              <span aria-hidden>{group.glyph} </span>
              {group.title} <span className="text-faint">({list.length})</span>
            </h3>
            <ul className="mt-1.5 space-y-2">
              {list.map((issue, i) => {
                const decision = issue.severity === 'approval' ? approvals[issue.code] : undefined;
                return (
                  <li
                    key={`${issue.code}-${issue.path ?? ''}-${i}`}
                    className="rounded-md border border-edge bg-deck px-2.5 py-2"
                    data-issue={issue.code}
                    data-severity={issue.severity}
                    data-step={issue.step}
                  >
                    <p className={`text-sm ${muted ? 'text-dim' : 'text-ink'}`}>
                      <span className={`${tone} mr-1`} aria-hidden>
                        {group.glyph}
                      </span>
                      <span className="sr-only">{group.title}: </span>
                      {issue.message}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StepControl step={issue.step} onGoTo={onGoTo} hrefFor={hrefFor} />
                      <RefChip refValue={issue.ref} />
                      {decision && (
                        <span
                          className={`chip ${decision === 'approved' ? 'border-ok/40 text-ok' : 'border-danger/40 text-danger'}`}
                          data-decision={decision}
                        >
                          GM {decision}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

export default function IssuesList({
  issues,
  onGoTo,
  hrefFor,
  approvals = {},
  current,
  build,
  title = 'Issues',
  emptyText = 'Nothing to fix — every check the engine runs passes.',
  testId = 'build-issues',
}: IssuesListProps) {
  const { now, later } = current !== undefined && build ? splitIssues(issues, current, build) : { now: [...issues], later: [] };
  const titleId = useId();

  return (
    <section className="panel p-3" aria-labelledby={titleId} data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={titleId} className="mono-label text-cyan">
          {title}
        </h2>
        <span className="mono-label text-faint" data-testid={`${testId}-count`}>
          {now.length}
          {later.length > 0 && ` · ${later.length} later`}
        </span>
      </div>
      {now.length === 0 && (
        <p className="mt-2 text-sm text-ok" data-testid={`${testId}-empty`}>
          <span aria-hidden>● </span>
          {later.length > 0 ? 'Nothing to fix on the steps so far.' : emptyText}
        </p>
      )}
      <IssueGroups issues={now} muted={false} onGoTo={onGoTo} hrefFor={hrefFor} approvals={approvals} />
      {later.length > 0 && (
        <details className="mt-3 border-t border-edge/60 pt-2" data-testid={`${testId}-later`}>
          <summary className="mono-label flex min-h-8 cursor-pointer items-center text-faint pointer-coarse:min-h-10">
            Later steps ({later.length})
          </summary>
          <p className="mt-1 text-xs text-faint">
            Checks on steps you have not reached yet. Nothing to do about them until you get there; the Finish checklist lists them all.
          </p>
          <IssueGroups issues={later} muted onGoTo={onGoTo} hrefFor={hrefFor} approvals={approvals} />
        </details>
      )}
    </section>
  );
}
