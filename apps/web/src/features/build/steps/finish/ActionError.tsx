/**
 * An action's refusal, in words, on the Finish step and in the GM's review
 * (FR3.9, docs/CHARGEN.md §8.5 "submit refuses with errors", "approve refuses
 * on errors or undecided approvals").
 *
 * Submit, return, approvals and approve all end the same way when the server
 * (or the page, before asking it) says no: a sentence, and sometimes the
 * findings that made it say no. `useBuildActions` carries both — `error` and
 * `refusalIssues` — and this renders them as an alert with each finding's
 * step and page, so a refused submit reads "the server's check still finds
 * 2 things to fix" followed by the two things, not a toast that vanishes.
 */
import type { BuildStep, Issue } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import { stepMeta } from '../meta.js';

export interface ActionErrorProps {
  error: string | null;
  issues: readonly Issue[];
  onGoTo: (step: BuildStep) => void;
  testId?: string;
}

export default function ActionError({ error, issues, onGoTo, testId = 'finish-action-error' }: ActionErrorProps) {
  if (!error && issues.length === 0) return null;
  return (
    <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2" role="alert" data-testid={testId}>
      {error && <p className="text-sm text-danger">{error}</p>}
      {issues.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${issue.path ?? ''}-${i}`} className="flex flex-wrap items-center gap-1.5 text-sm text-ink" data-issue={issue.code}>
              <span>{issue.message}</span>
              <button
                type="button"
                className="chip text-dim hover:text-cyan pointer-coarse:min-h-10"
                onClick={() => onGoTo(issue.step)}
                aria-label={`step ${issue.step} — go to ${stepMeta(issue.step).title}`}
              >
                step {issue.step}
              </button>
              <RefChip refValue={issue.ref} className="pointer-coarse:min-h-10" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
