/**
 * The attribute half of Step 3 (FR3.9, docs/CHARGEN.md §4.4 "the eight
 * attributes as steppers: base at the left, points spent, Karma raises
 * (greyed until Step 8), the augmented total in the book's `4 (6)` form …
 * and the natural max on the right. The special attributes — Edge, Magic,
 * Resonance — sit below with their own pool").
 *
 * One row per attribute, as a list item: the name, the figures that decide
 * the next tap (where it starts, what Karma has added, the rating play will
 * see, how high it may go and whether it is already there — said as "at
 * max", not as a colour), and a refusing stepper on the points. A stepper
 * shuts the moment a tap would break a cap — the natural maximum, the second
 * attribute at its maximum — and says so in the validator's sentence with the
 * page, probed with the same updater the tap applies (`attributeRows` in
 * `./model.ts`). When the sentence is one a quality on step 5 would settle,
 * a single line under the list offers the way there.
 *
 * Magic and Resonance open when the build has a type that uses them, or while
 * step 4 still has the kind to choose and the Magic row offers one that does
 * (the book spends special points before it picks the column). A shut row
 * says why and goes where it would open: step 2 when the Magic row offers
 * nothing, step 4 when a kind already chosen does not use it — each only
 * where guided mode would let the player land. On a phone the figures wrap
 * above the stepper; nothing scrolls sideways.
 */
import { useId } from 'react';
import type { AttributeCode, Budgets, Issue, PriorityLevel, Ref } from '@safehouse/contracts';
import {
  CREATION_ATTRIBUTE_RULES,
  issueRule,
  setAttributePoints,
  setSpecialPoints,
  type MetatypeRow,
} from '@safehouse/rules';
import { RefChip } from '../../../gm/books/RefChip.js';
import LimitStepper from '../../components/LimitStepper.js';
import PoolLine from '../../kit/PoolLine.js';
import WhyLink from '../../kit/WhyLink.js';
import type { BuildUpdater } from '../../session.js';
import { stepMeta } from '../meta.js';
import IssueNotes from './IssueNotes.js';
import {
  attributePriorityWords,
  karmaWords,
  maxWords,
  previewBasesWords,
  qualityWouldLift,
  ratingSpoken,
  ratingText,
  type AttributeRowState,
  type PlacedIssues,
  type SpecialId,
  type StepNav,
} from './model.js';

interface RowsCommon {
  readOnly: boolean;
  update: (fn: BuildUpdater) => void;
  nav: StepNav;
}

export interface AttributeRowProps extends RowsCommon {
  row: AttributeRowState;
  issues: readonly Issue[];
}

/** One attribute: its figures, its points stepper (or why it is shut), and what the engine says about it. */
export function AttributeRow({ row, issues, readOnly, update, nav }: AttributeRowProps) {
  const { line, control, refusal, opensInStep } = row;
  const special = line.id === 'edg' || line.id === 'mag' || line.id === 'res';
  const onChange = (points: number) =>
    update((b) =>
      special ? setSpecialPoints(b, line.id as SpecialId, points) : setAttributePoints(b, line.id as AttributeCode, points),
    );

  return (
    <li
      className="space-y-2 rounded-md border border-edge bg-deck p-3"
      data-testid={`attribute-${line.id}`}
      data-attribute={line.id}
      data-at-max={line.atMax ? 'yes' : 'no'}
      data-control={control}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-ink">
              {line.name}
            </span>
            <span aria-hidden className="mono-label text-faint">
              {line.short}
            </span>
            {line.atMax && (
              <span className="chip border-warn/50 text-warn" data-testid="at-max">
                at max
              </span>
            )}
          </p>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs" data-testid="attribute-figures">
            <div className="flex gap-1">
              <dt className="text-faint">base</dt>
              <dd className="text-ink">{line.base}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-faint">rating</dt>
              <dd className="text-ink" data-testid="attribute-rating">
                <span aria-hidden>{ratingText(line)}</span>
                <span className="sr-only">{ratingSpoken(line)}</span>
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-faint">max</dt>
              <dd className="text-ink">{maxWords(line)}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-faint">Karma</dt>
              <dd className="text-faint" data-testid="attribute-karma">
                {karmaWords(line)}
              </dd>
            </div>
          </dl>
        </div>
        {control === 'stepper' ? (
          <div className="flex max-w-full items-start gap-2 sm:w-72 sm:shrink-0">
            <span aria-hidden className="mono-label pt-2.5 text-faint">
              points
            </span>
            <LimitStepper
              label={`${line.name} points`}
              hideLabel
              value={line.points}
              min={0}
              onChange={onChange}
              refuseIncrease={refusal}
              readOnly={readOnly}
              testId={`attribute-${line.id}-points`}
            />
          </div>
        ) : (
          refusal && (
            <p
              className="flex max-w-full flex-wrap items-center gap-1.5 text-xs text-dim sm:w-72 sm:shrink-0"
              data-testid="attribute-closed"
            >
              <span>{refusal.reason}</span>
              {refusal.ref && <RefChip refValue={refusal.ref} className="pointer-coarse:min-h-10" />}
              {opensInStep !== null && !readOnly && nav.canGo(opensInStep) && (
                <button
                  type="button"
                  className="btn px-2 py-0.5 text-xs pointer-coarse:min-h-10"
                  onClick={() => nav.goTo(opensInStep)}
                  data-testid="attribute-open-step"
                >
                  go to step {opensInStep} · {stepMeta(opensInStep).short}
                </button>
              )}
            </p>
          )
        )}
      </div>
      <IssueNotes issues={issues} nav={nav} testId={`attribute-${line.id}-issues`} />
    </li>
  );
}

export interface AttributeSectionProps extends RowsCommon {
  rows: readonly AttributeRowState[];
  placed: PlacedIssues;
  budgets: Budgets;
  level: PriorityLevel | null;
  /** The chosen metatype's row; null while the rows preview a human's. */
  metatype: Pick<MetatypeRow, 'id'> | null;
}

/** The eight mental and physical attributes, their pool, and the one-at-maximum rule. */
export function AttributeSection({ rows, placed, budgets, level, metatype, readOnly, update, nav }: AttributeSectionProps) {
  const headingId = useId();
  const preview = previewBasesWords(metatype);
  return (
    <section aria-labelledby={headingId} className="space-y-3" data-testid="attribute-section">
      <div className="space-y-1">
        <h2 id={headingId} className="text-base font-semibold text-ink">
          Attributes
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-dim">
          <span>{attributePriorityWords(level)}</span>
          {level === null && !readOnly && (
            <button type="button" className="btn px-2 py-0.5 text-xs pointer-coarse:min-h-10" onClick={() => nav.goTo(2)}>
              choose priorities
            </button>
          )}
        </p>
        {preview && (
          <p className="text-sm text-dim" data-testid="attribute-preview-bases">
            {preview}
          </p>
        )}
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-dim">
          <span>Only one of the eight may start at its natural maximum.</span>
          <WhyLink refValue={CREATION_ATTRIBUTE_RULES.ref} />
        </p>
        <PoolLine budgets={budgets} pool="attributes" />
      </div>
      <IssueNotes issues={placed.attributes} nav={nav} testId="attribute-issues" />
      <ul aria-label="The eight attributes" className="space-y-2">
        {rows.map((row) => (
          <AttributeRow
            key={row.line.id}
            row={row}
            issues={placed.rows[row.line.id] ?? []}
            readOnly={readOnly}
            update={update}
            nav={nav}
          />
        ))}
      </ul>
      {!readOnly && qualityWouldLift(rows) && <LiftNote nav={nav} />}
    </section>
  );
}

/** Under the list when a refusal is one a quality would settle: the way to step 5, once the walkthrough would land there. */
function LiftNote({ nav }: { nav: StepNav }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-dim" data-testid="attribute-lift-note">
      <span>A quality taken on step 5 can lift one natural maximum by one.</span>
      {nav.canGo(5) && (
        <button type="button" className="btn px-2 py-0.5 text-xs pointer-coarse:min-h-10" onClick={() => nav.goTo(5)}>
          go to step 5 · {stepMeta(5).short}
        </button>
      )}
    </p>
  );
}

export interface SpecialSectionProps extends RowsCommon {
  rows: readonly AttributeRowState[];
  placed: PlacedIssues;
  budgets: Budgets;
}

/** Edge, Magic and Resonance with the special pool. */
export function SpecialSection({ rows, placed, budgets, readOnly, update, nav }: SpecialSectionProps) {
  const headingId = useId();
  const poolRef: Ref | undefined = issueRule('special-points-unspent')?.ref;
  return (
    <section aria-labelledby={headingId} className="space-y-3" data-testid="special-section">
      <div className="space-y-1">
        <h2 id={headingId} className="text-base font-semibold text-ink">
          Special attributes
        </h2>
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-dim">
          <span>Special points buy only Edge, Magic and Resonance, and any left unspent are lost.</span>
          {poolRef && <WhyLink refValue={poolRef} />}
        </p>
        <PoolLine budgets={budgets} pool="special" />
      </div>
      <IssueNotes issues={placed.special} nav={nav} testId="special-issues" />
      <ul aria-label="The special attributes" className="space-y-2">
        {rows.map((row) => (
          <AttributeRow
            key={row.line.id}
            row={row}
            issues={placed.rows[row.line.id] ?? []}
            readOnly={readOnly}
            update={update}
            nav={nav}
          />
        ))}
      </ul>
    </section>
  );
}
