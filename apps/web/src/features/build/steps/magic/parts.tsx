/**
 * The small pieces every section of Step 4 is built from (FR3.9,
 * docs/CHARGEN.md §4.4 Step 4).
 *
 * Eight sections say the same four things — a heading, a finding of the
 * validator's under the control it is about, a refusal tied to the button it
 * shuts, a way to the step that fixes something — and they say them the same
 * way here: an issue is a list item with its glyph, its sentence and its page;
 * a refusal is a sentence with an id for `aria-describedby`, never a colour
 * alone; a glyph keeps to the left of its sentence however narrow the line
 * (its own column, the words and page wrapping beside it, never below it); a jump to another step is a real button that calls `goTo`, because a
 * step does not navigate on its own.
 */
import type { ReactNode } from 'react';
import type { BuildStep, Issue } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import type { Refusal } from '../../components/LimitStepper.js';
import { canReach } from '../../lib.js';
import { stepMeta } from '../meta.js';
import type { StepProps } from '../types.js';

/** One section of the screen: an `h2` under the frame's `h1`, and what it holds. */
export function Section({ id, title, children, testId }: { id: string; title: string; children: ReactNode; testId: string }) {
  return (
    <section aria-labelledby={id} className="panel space-y-3 p-3 sm:p-4" data-testid={testId}>
      <h2 id={id} className="text-sm font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

const GLYPH: Readonly<Record<Issue['severity'], { glyph: string; tone: string }>> = {
  error: { glyph: '✕', tone: 'text-danger' },
  warning: { glyph: '!', tone: 'text-warn' },
  approval: { glyph: '?', tone: 'text-magenta' },
};

/** The validator's findings about one part of the screen, where that part is. */
export function IssueNotes({ issues, testId = 'magic-issues' }: { issues: readonly Issue[]; testId?: string }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1" data-testid={testId}>
      {issues.map((issue, i) => (
        <li
          key={`${issue.code}-${issue.path ?? ''}-${i}`}
          className="flex items-baseline gap-1.5 text-xs"
          data-issue={issue.code}
          data-severity={issue.severity}
        >
          <span aria-hidden className={`shrink-0 ${GLYPH[issue.severity].tone}`}>
            {GLYPH[issue.severity].glyph}
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="sr-only">{issue.severity === 'error' ? 'Must fix:' : issue.severity === 'warning' ? 'Worth a look:' : 'Needs the GM:'}</span>
            <span className="text-ink">{issue.message}</span>
            <RefChip refValue={issue.ref} className="pointer-coarse:min-h-10" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Why a control is shut, as a sentence with an id. `tone="hint"` is for a
 * control waiting on a choice ("choose a skill first") rather than a rule
 * saying no.
 */
export function RefusalLine({ id, refusal, tone = 'refusal', testId = 'magic-refusal' }: { id: string; refusal: Refusal; tone?: 'refusal' | 'hint'; testId?: string }) {
  return (
    <p id={id} className={`flex items-baseline gap-1.5 text-xs ${tone === 'hint' ? 'text-faint' : 'text-warn'}`} data-testid={testId}>
      {tone === 'refusal' && (
        <span aria-hidden className="shrink-0">
          ⛔
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
        <span>{refusal.reason}</span>
        {refusal.ref && <RefChip refValue={refusal.ref} className="pointer-coarse:min-h-10" />}
      </span>
    </p>
  );
}

/** What a link to another step needs to know: where the walkthrough is, and how it moves. */
export type StepJump = Pick<StepProps, 'goTo' | 'steps' | 'meta' | 'mode'>;

/**
 * "change priorities in step 2" — a button, since only the shell moves the
 * walkthrough. The shell's `goTo` is not gated, so a link forward is offered
 * only where the progress strip would let the player land (`canReach`): in
 * guided mode, not past a step that is still unfinished. Back always works.
 */
export function StepLink({ step, label, jump, testId }: { step: BuildStep; label?: string; jump: StepJump; testId?: string }) {
  if (!canReach(jump.steps, step, jump.meta.step, jump.mode)) return null;
  const meta = stepMeta(step);
  return (
    <button
      type="button"
      className="btn px-3 py-1 text-xs pointer-coarse:min-h-10"
      onClick={() => jump.goTo(step)}
      data-testid={testId ?? `magic-goto-${step}`}
      data-step={step}
    >
      {label ?? `step ${step} · ${meta.short.toLowerCase()}`}
    </button>
  );
}

/** A remove button whose accessible name says what goes. */
export function RemoveButton({ what, onRemove, testId }: { what: string; onRemove: () => void; testId: string }) {
  return (
    <button type="button" className="btn px-2.5 py-1 text-xs" aria-label={`remove ${what}`} onClick={onRemove} data-testid={testId}>
      remove
    </button>
  );
}
