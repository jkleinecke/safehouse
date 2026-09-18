/**
 * Step 3 — Metatype and attributes (FR3.9, docs/CHARGEN.md §4.4 Step 3).
 *
 * The shell lazy-loads this screen through `steps/index.ts` and hands it
 * `StepProps` (`types.ts` has the rules a step follows). It is three sections
 * under the frame's heading, in the order the book asks for the decisions:
 * the metatype cards (`metatype/MetatypeCards.tsx`), the eight attributes
 * with their pool, and Edge, Magic and Resonance with the special pool
 * (`metatype/AttributeRows.tsx`).
 *
 * Everything on it is the engine's answer laid out by `metatype/model.ts`:
 * the cards and why one cannot be taken, every row's rating and maximum, and
 * what each + would break, probed with the updater the tap applies. Every
 * finding the validator has about these choices sits beside the control it
 * concerns — including the ones it files on another step because that is
 * where they are fixed (a maximum a quality would lift, special points on
 * Magic before a type uses it), each with a way there. What is spent past a
 * pool is shown in words on the pool line rather than refused tap by tap; the
 * warning about unspent special points at Next is the frame's (`confirm.ts`).
 *
 * Read-only (a submitted build, the GM's review) shows the chosen card and
 * the rows' figures, and offers nothing to change. A button to another step
 * is offered only where guided mode would let the player land (`stepNav`), so
 * no shortcut here walks round Next's gate.
 */
import { useMemo } from 'react';
import { AttributeSection, SpecialSection } from './metatype/AttributeRows.js';
import IssueNotes from './metatype/IssueNotes.js';
import MetatypeCards from './metatype/MetatypeCards.js';
import { attributeRows, issuesElsewhere, metatypeSection, placeIssues, stepNav } from './metatype/model.js';
import type { StepProps } from './types.js';

export default function MetatypeStep(props: StepProps) {
  const { build, settings, budgets, issues, allIssues, preview, ratings, probe, update, goTo, steps, meta, mode } = props;
  const locked = props.readOnly || props.reviewMode;
  // The shell's goTo is not gated: a way forward is offered only where the progress strip would land.
  const nav = useMemo(() => stepNav({ goTo, steps, meta, mode }), [goTo, steps, meta, mode]);

  const section = useMemo(
    () => metatypeSection({ build, settings, probe, readOnly: locked }),
    [build, settings, probe, locked],
  );
  const rows = useMemo(
    () => attributeRows({ build, table: settings.table, ratings, derived: preview.derived, probe, allIssues, readOnly: locked }),
    [build, settings.table, ratings, preview.derived, probe, allIssues, locked],
  );
  const placed = useMemo(() => placeIssues([...issues, ...issuesElsewhere(allIssues)]), [issues, allIssues]);

  return (
    <div className="space-y-6" data-testid="metatype-step" data-readonly={locked ? 'yes' : 'no'}>
      <MetatypeCards section={section} issues={placed.metatype} readOnly={locked} update={update} nav={nav} />
      <AttributeSection
        rows={rows.eight}
        placed={placed}
        budgets={budgets}
        level={build.priorities.attributes}
        metatype={ratings.metatype}
        readOnly={locked}
        update={update}
        nav={nav}
      />
      <SpecialSection rows={rows.special} placed={placed} budgets={budgets} readOnly={locked} update={update} nav={nav} />
      {placed.other.length > 0 && (
        <section aria-label="Also on this step" className="space-y-2" data-testid="metatype-other">
          <IssueNotes issues={placed.other} nav={nav} testId="metatype-other-issues" />
        </section>
      )}
    </div>
  );
}
