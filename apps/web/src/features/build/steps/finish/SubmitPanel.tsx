/**
 * Submit for approval (FR3.9, docs/CHARGEN.md §4.4 Step 9 "and Submit for
 * approval. Submitting freezes the build and tells the GM").
 *
 * The button's gate is `submitGate` (pure, in `checklist.ts`): shut while
 * any error remains anywhere in the build, with the count as the sentence
 * beneath it, tied to the button by `aria-describedby`. The button stays
 * focusable when shut (`aria-disabled`, as the frame's Next does), so a
 * keyboard user reaches the reason by reaching the button; a "go to step N"
 * beside the reason takes them to the first thing to fix. What the GM will
 * decide (the approval items) and what is merely worth a look are counted,
 * and said not to stop anything.
 *
 * Pressing it runs `actions.submit`, which saves the last edit, reads the
 * server's check and only then submits; while that runs the panel says so,
 * and when anything refuses, the refusal and its findings show here in words
 * (`ActionError`).
 */
import { useId } from 'react';
import type { BuildStep, Issue } from '@safehouse/contracts';
import type { BuildActions } from '../types.js';
import ActionError from './ActionError.js';
import { firstErrorStep, plural, type SubmitGate } from './checklist.js';

export interface SubmitPanelProps {
  gate: SubmitGate;
  actions: Pick<BuildActions, 'submit' | 'busy' | 'error' | 'refusalIssues'>;
  /** The build's issues, for the first error's step. */
  allIssues: readonly Issue[];
  onGoTo: (step: BuildStep) => void;
  testId?: string;
}

export default function SubmitPanel({ gate, actions, allIssues, onGoTo, testId = 'finish-submit' }: SubmitPanelProps) {
  const headingId = useId();
  const reasonId = useId();
  const first = firstErrorStep(allIssues);
  const counts = [
    gate.errors === 0 ? 'nothing to fix' : `${plural(gate.errors, 'thing', 'things')} to fix`,
    ...(gate.approvals > 0 ? [`${plural(gate.approvals, 'item', 'items')} for the GM`] : []),
    ...(gate.warnings > 0 ? [`${gate.warnings} worth a look`] : []),
  ].join(' · ');

  const press = () => {
    if (!gate.open) return;
    // The refusal is shown from `actions.error`; nothing to do with it here.
    actions.submit().catch(() => undefined);
  };

  return (
    <section aria-labelledby={headingId} className="panel space-y-2 p-3 sm:p-4" data-testid={testId} data-open={gate.open ? 'yes' : 'no'} data-print-hide="">
      <h2 id={headingId} className="text-base font-semibold text-ink">
        Send it to the GM
      </h2>
      <p className="text-sm text-dim" data-testid={`${testId}-counts`}>
        {counts}
      </p>
      {gate.approvals > 0 && gate.errors === 0 && (
        <p className="text-sm text-dim">The items for the GM do not stop you: they decide those when they review the build.</p>
      )}
      <p className="text-sm text-dim">Submitting freezes the build until the GM approves it or returns it with a note.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`btn px-4 py-1.5 ${gate.open ? 'btn-accent' : 'cursor-not-allowed opacity-60'}`}
          onClick={press}
          {...(gate.open ? {} : { 'aria-disabled': 'true' as const })}
          {...(gate.reason ? { 'aria-describedby': reasonId } : {})}
          aria-busy={actions.busy === 'submit'}
          data-testid={`${testId}-button`}
        >
          {gate.label}
        </button>
        {gate.reason && (
          <p id={reasonId} className={`text-sm ${gate.errors > 0 ? 'text-warn' : 'text-dim'}`} data-testid={`${testId}-reason`} {...(actions.busy ? { role: 'status' } : {})}>
            {gate.reason}
          </p>
        )}
        {gate.errors > 0 && first !== null && (
          <button type="button" className="chip text-dim hover:text-cyan pointer-coarse:min-h-10" onClick={() => onGoTo(first)} data-testid={`${testId}-first`}>
            go to step {first}
          </button>
        )}
      </div>
      <ActionError error={actions.error} issues={actions.refusalIssues} onGoTo={onGoTo} testId={`${testId}-error`} />
    </section>
  );
}
