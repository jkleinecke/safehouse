/**
 * Step 2 — Priorities (FR3.9, docs/CHARGEN.md §4.4 Step 2).
 *
 * Five columns — metatype, attributes, magic or resonance, skills, resources
 * — each take a row from A to E, and the row decides how much of that column
 * the runner starts with. §4.4 draws it as labels dropped into slots; this
 * screen keeps the rule (under the priority table a row sits in one column,
 * so taking a row another column holds swaps the two, `setPriority`) and
 * drops the drag, which a keyboard, a screen reader and a thumb all do badly:
 *
 * - on a phone, each column is a row picker (`priorities/ColumnPicker`);
 * - on a laptop, the table itself is a keyboard grid (`priorities/PriorityGrid`).
 *
 * Both read one model (`priorities/model.ts`), in which every cell says what
 * it buys *this* runner — special points for the metatype chosen or leaned
 * toward and which metatypes the row shuts out, attribute points, the kinds
 * of magic the row offers and their grants, skill and group points, nuyen at
 * the campaign's level — and, before the tap, what taking it would do: the
 * column it swaps with, the later step whose spend it would reopen (the
 * walkthrough's `probe`, so nothing is lost by going back but nothing breaks
 * silently either), and under Sum to Ten a refusal in the validator's words
 * when the rows would cost more than ten points.
 *
 * Around the table: how full the step is, who the metatype cells speak for,
 * the concept card's rows (and a way back to them), why a mundane card puts
 * Magic at E, the method section when the campaign allows Sum to Ten, and
 * this step's remaining issues with their pages. The step is complete when
 * the engine says so — all five columns set. Read-only (a submitted build,
 * the GM's review) shows the same table with each column's row marked and
 * offers nothing to press.
 */
import { useCallback, useId, useMemo } from 'react';
import type { PriorityColumn, PriorityLevel } from '@safehouse/contracts';
import { RefChip } from '../../gm/books/RefChip.js';
import { canReach } from '../lib.js';
import ColumnPicker from './priorities/ColumnPicker.js';
import MethodSwitch from './priorities/MethodSwitch.js';
import PriorityGrid from './priorities/PriorityGrid.js';
import {
  applyRows,
  filledSentence,
  leanSentence,
  listedIssues,
  methodModel,
  mundaneSentence,
  pickRow,
  prioritiesModel,
  switchMethod,
  type PrioritiesModel,
} from './priorities/model.js';
import type { StepProps } from './types.js';

const SEVERITY = {
  error: { glyph: '✕', tone: 'text-danger', word: 'must fix' },
  warning: { glyph: '!', tone: 'text-warn', word: 'worth a look' },
  approval: { glyph: '?', tone: 'text-magenta', word: 'needs the GM' },
} as const;

interface NotesProps {
  model: PrioritiesModel;
  display: boolean;
  onRestoreRows: () => void;
  /** Jump to step 3, or null where the walkthrough would not let the player land there yet. */
  onGoToMetatype: (() => void) | null;
}

/** The lines above the table: how full the step is, the lean, the card's rows, the mundane note. */
function PrioritiesNotes({ model, display, onRestoreRows, onGoToMetatype }: NotesProps) {
  const done = model.filled === model.columns.length;
  return (
    <div className="space-y-1.5 text-sm" data-testid="priority-notes">
      <p className={done ? 'text-ok' : 'text-dim'} data-testid="priority-filled" data-filled={model.filled}>
        <span aria-hidden>{done ? '● ' : '○ '}</span>
        {filledSentence(model.filled)}
      </p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-dim" data-testid="priority-lean" data-lean={model.lean?.row.id ?? 'none'}>
        <span>{leanSentence(model.lean, model.concept)}</span>
        {!display && onGoToMetatype && (
          <button type="button" className="btn px-2.5 py-1" onClick={onGoToMetatype} data-testid="priority-go-metatype">
            go to step 3
          </button>
        )}
      </p>
      {model.concept && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-dim" data-testid="priority-concept" data-matches={model.concept.matches ? 'yes' : 'no'}>
          <span>
            {model.concept.matches
              ? `These are the ${model.concept.title} card’s rows (${model.concept.line}); shuffle them as you like.`
              : `The ${model.concept.title} card suggested ${model.concept.line}.`}
          </span>
          {!model.concept.matches && !display && (
            <button type="button" className="btn px-2.5 py-1" onClick={onRestoreRows} data-testid="priority-restore-rows">
              put the card’s rows back
            </button>
          )}
        </p>
      )}
      {model.mundane && (
        <p
          className={`flex items-baseline gap-1.5 ${model.mundane.kind === 'unused' ? 'text-warn' : 'text-dim'}`}
          data-testid="priority-mundane"
          data-kind={model.mundane.kind}
        >
          {model.mundane.kind === 'unused' && (
            <span aria-hidden className="shrink-0">
              !
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{mundaneSentence(model.mundane)}</span>
            {model.mundane.kind === 'unused' && <RefChip refValue={model.mundane.issue.ref} />}
          </span>
        </p>
      )}
    </div>
  );
}

export default function PrioritiesStep(props: StepProps) {
  const { build, settings, budgets, issues, allIssues, probe, update, goTo, readOnly, reviewMode, steps, meta, mode } = props;
  // The shell's goTo is not gated, so a shortcut forward must not walk round
  // guided mode's Next: offer it only where the progress strip would.
  const metatypeReachable = canReach(steps, 3, meta.step, mode);
  // A submitted build and the GM's review both show the choices and offer nothing to press.
  const display = readOnly || reviewMode;
  const tableHeadingId = useId();
  const issuesHeadingId = useId();

  const model = useMemo(
    () => prioritiesModel({ build, settings, probe: display ? undefined : probe, allIssues }),
    [build, settings, probe, allIssues, display],
  );
  const method = useMemo(() => methodModel(build, settings, allIssues), [build, settings, allIssues]);
  const listed = useMemo(() => listedIssues(issues), [issues]);

  const pick = useCallback((column: PriorityColumn, level: PriorityLevel) => update(pickRow(column, level)), [update]);
  const concept = model.concept;

  return (
    <div className="space-y-5" data-testid="priorities-step" data-method={build.method} data-display={display ? 'yes' : 'no'}>
      <PrioritiesNotes
        model={model}
        display={display}
        onRestoreRows={() => {
          if (concept) update(applyRows(concept.rows));
        }}
        onGoToMetatype={metatypeReachable ? () => goTo(3) : null}
      />

      <MethodSwitch method={method} budgets={budgets} readOnly={display} onSwitch={(target) => update(switchMethod(target))} />

      <div className="space-y-5 lg:hidden" data-testid="priority-columns">
        {model.columns.map((column) => (
          <ColumnPicker key={column.column} column={column} readOnly={display} onPick={(level) => pick(column.column, level)} />
        ))}
      </div>

      <section aria-labelledby={tableHeadingId} className="hidden space-y-2 lg:block" data-testid="priority-table">
        <h2 id={tableHeadingId} className="mono-label text-cyan">
          Priority table
        </h2>
        <PriorityGrid model={model} readOnly={display} onPick={pick} />
      </section>

      {listed.length > 0 && (
        <section aria-labelledby={issuesHeadingId} className="panel space-y-2 p-3" data-testid="priority-issues">
          <h2 id={issuesHeadingId} className="mono-label text-dim">
            Still on this step
          </h2>
          <ul className="space-y-1.5">
            {listed.map((issue, i) => (
              <li
                key={`${issue.code}-${issue.path ?? ''}-${i}`}
                className="flex items-baseline gap-1.5 text-sm"
                data-issue={issue.code}
                data-severity={issue.severity}
              >
                <span aria-hidden className={`shrink-0 ${SEVERITY[issue.severity].tone}`}>
                  {SEVERITY[issue.severity].glyph}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="sr-only">{SEVERITY[issue.severity].word}: </span>
                  <span className="text-ink">{issue.message}</span>
                  <RefChip refValue={issue.ref} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
