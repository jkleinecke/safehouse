/**
 * The creation checklist on the Finish step (FR3.9, docs/CHARGEN.md §4.4
 * Step 9 "the p. 101 checklist rendered as a list with a tick or a cross per
 * line, each cross linking back").
 *
 * One line per walkthrough step, from `checklistLines` — the engine's step
 * statuses with our one-line summary of what each step is checked for. A
 * ticked line is a tick; a crossed line is a cross *and* the engine's own
 * sentences for what is wrong, each with its page, and a button that takes
 * the player to the step that fixes it. A mark is never a colour alone: the
 * glyph is hidden from screen readers and the state is spoken ("done",
 * "to do", "skipped"), and the row carries `data-done` for tests.
 *
 * Warnings and the GM's items are counted on their line but never cross it —
 * they do not stop Submit, and the rail's issues list already names them.
 */
import { useId } from 'react';
import type { BuildStep } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import { stepMeta } from '../meta.js';
import { checklistCount, crossNote, plural, type CheckLine } from './checklist.js';

export interface ChecklistProps {
  lines: readonly CheckLine[];
  onGoTo: (step: BuildStep) => void;
  testId?: string;
}

const MARK: Readonly<Record<CheckLine['mark'], { glyph: string; spoken: string; tone: string }>> = {
  done: { glyph: '✓', spoken: 'done', tone: 'text-ok' },
  todo: { glyph: '✕', spoken: 'to do', tone: 'text-danger' },
  skipped: { glyph: '–', spoken: 'skipped', tone: 'text-faint' },
};

export default function ChecklistPanel({ lines, onGoTo, testId = 'finish-checklist' }: ChecklistProps) {
  const headingId = useId();
  const { done, total } = checklistCount(lines);
  return (
    <section aria-labelledby={headingId} className="panel p-3 sm:p-4" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold text-ink">
          Creation checklist
        </h2>
        <span className="mono-label text-dim" data-testid={`${testId}-count`}>
          {done} of {total} done
        </span>
      </div>
      <ol className="mt-2 divide-y divide-edge/60">
        {lines.map((line) => {
          const mark = MARK[line.mark];
          const meta = stepMeta(line.step);
          const note = crossNote(line);
          const gm = line.approvals.length;
          const look = line.warnings.length;
          return (
            <li
              key={line.step}
              className="py-2"
              data-check={line.step}
              data-done={line.mark === 'done' ? 'yes' : line.mark === 'skipped' ? 'skipped' : 'no'}
            >
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 w-4 shrink-0 text-center font-label ${mark.tone}`} aria-hidden>
                  {mark.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">
                    <span className="sr-only">{mark.spoken}: </span>
                    <span className="mono-label mr-1.5 text-faint">
                      {line.step} · {meta.short}
                    </span>
                    {line.check}
                  </p>
                  {line.blocking.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {line.blocking.map((issue, i) => (
                        <li
                          key={`${issue.code}-${issue.path ?? ''}-${i}`}
                          className="flex flex-wrap items-center gap-1.5 text-sm text-danger"
                          data-issue={issue.code}
                        >
                          <span>{issue.message}</span>
                          <RefChip refValue={issue.ref} className="pointer-coarse:min-h-10" />
                        </li>
                      ))}
                    </ul>
                  )}
                  {note && <p className="mt-1 text-sm text-dim">{note}</p>}
                  {(gm > 0 || look > 0) && (
                    <p className="mt-0.5 text-xs text-faint">
                      {[
                        ...(gm > 0 ? [`${plural(gm, 'item', 'items')} for the GM`] : []),
                        ...(look > 0 ? [`${look} worth a look`] : []),
                      ].join(' · ')}
                    </p>
                  )}
                </div>
                {line.fixAt !== null && (
                  <button
                    type="button"
                    className="btn shrink-0 px-2.5 py-1"
                    onClick={() => onGoTo(line.fixAt!)}
                    aria-label={`fix in step ${line.fixAt} · ${stepMeta(line.fixAt).title}`}
                    data-testid={`${testId}-fix`}
                    data-step={line.fixAt}
                  >
                    fix in step {line.fixAt}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
