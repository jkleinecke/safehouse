/**
 * The engine's findings, said beside the control they concern (FR3.9,
 * docs/CHARGEN.md §4.4 "the screen says exactly what is missing, in the
 * book's words, with the page").
 *
 * The frame names the first thing blocking Next and the rail lists every
 * issue, but on this screen a finding means most where it sits: "Troll cannot
 * be taken at Metatype priority C" under the cards, "Only one attribute may
 * start at its natural maximum" under the attributes. Each note is the
 * validator's sentence, its severity in a word for a screen reader (the glyph
 * and colour are for the eye), the page chip, and — when the validator files
 * the fix on another step, as it does for a maximum a quality would lift —
 * a button that goes there, when the walkthrough would let the player land
 * there now. A list, because several can stand at once.
 */
import type { BuildStep, Issue } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import { ISSUE_GROUPS } from '../../lib.js';
import { stepMeta } from '../meta.js';
import { METATYPE_STEP, type StepNav } from './model.js';

export interface IssueNotesProps {
  issues: readonly Issue[];
  /** Where a finding filed on another step is fixed; offered only where the walkthrough would land. */
  nav: StepNav;
  testId?: string;
  className?: string;
}

/** "step 5 · Qualities" — where a finding filed elsewhere is fixed. */
export function fixStepLabel(step: BuildStep): string {
  return `fix in step ${step} · ${stepMeta(step).short}`;
}

export default function IssueNotes({ issues, nav, testId = 'metatype-issues', className }: IssueNotesProps) {
  if (issues.length === 0) return null;
  return (
    <ul className={`space-y-1.5 ${className ?? ''}`} data-testid={testId}>
      {issues.map((issue, i) => {
        const group = ISSUE_GROUPS.find((g) => g.severity === issue.severity) ?? ISSUE_GROUPS[0]!;
        return (
          <li
            key={`${issue.code}-${issue.path ?? ''}-${i}`}
            className="flex items-baseline gap-1.5 text-sm"
            data-issue={issue.code}
            data-severity={issue.severity}
            data-step={issue.step}
          >
            <span aria-hidden className={`shrink-0 ${group.tone}`}>
              {group.glyph}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="sr-only">{group.title}: </span>
              <span className="text-ink">{issue.message}</span>
              <RefChip refValue={issue.ref} className="pointer-coarse:min-h-10" />
              {issue.step !== METATYPE_STEP && nav.canGo(issue.step) && (
                <button
                  type="button"
                  className="btn px-2 py-0.5 text-xs pointer-coarse:min-h-10"
                  onClick={() => nav.goTo(issue.step)}
                  data-testid="issue-go"
                >
                  {fixStepLabel(issue.step)}
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
