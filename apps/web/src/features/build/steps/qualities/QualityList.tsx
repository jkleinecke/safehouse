/**
 * One side of the Qualities screen — the positive list or the negative one —
 * and the line a quality makes on it (FR3.9, docs/CHARGEN.md §4.4 Step 5 "two
 * lists side by side, positive and negative, each with its running Karma
 * against the cap").
 *
 * A side opens with its pool in words (`PoolLine`: "11 of 25 Karma of
 * positive qualities left", an overspend said as one) and the page the cap is
 * printed on. Each line then says everything about itself in one place, so a
 * player never has to match a sentence in the issues list to the quality it
 * means:
 *
 * - what it costs or gives, and its page;
 * - "needs the GM" when the book puts it to the gamemaster, with what the GM
 *   has said so far — and, for the GM reviewing a submitted build, approve
 *   and deny right there;
 * - "buys off a born quality" for a metatype's negative quality paid away;
 * - for a quality the engine knows, what it does in our words, the attribute,
 *   skill or group it names (asked for with a labelled picker), and where
 *   else it sends the player (the second native language on Skills);
 * - every error or warning the validator points at the line, with its page;
 * - the modifiers entered by hand for what the page says it does in play.
 *
 * Pure view over `QualityRowModel` (`model.ts`); edits go out through the
 * callbacks, which the screen turns into `update(fn)` calls.
 */
import { useId } from 'react';
import type { ApprovalDecision, BuildStep, Budgets, Issue, Modifier, QualityType } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import PoolLine from '../../kit/PoolLine.js';
import WhyLink from '../../kit/WhyLink.js';
import { stepMeta } from '../meta.js';
import ModifierEditor, { FIELD_CLASS } from './ModifierEditor.js';
import {
  SIDE_TITLE,
  TARGET_QUESTION,
  approvalWords,
  qualityCapRef,
  targetLabel,
  type QualityRowModel,
  type TargetOption,
  type TargetOptionGroup,
} from './model.js';

/** The pickers a line with a target offers, by kind. */
export interface TargetChoices {
  attribute: readonly TargetOption[];
  skill: readonly TargetOptionGroup[];
  group: readonly TargetOption[];
}

export interface QualityRowActions {
  onRemove(row: QualityRowModel): void;
  onTarget(row: QualityRowModel, target: string | null): void;
  onAddMod(row: QualityRowModel, mod: Modifier): void;
  onRemoveMod(row: QualityRowModel, modId: string): void;
  onGoTo(step: BuildStep): void;
  /** GM review: decide an approval issue. Absent outside review. */
  onDecide?: ((code: string, decision: ApprovalDecision) => void) | undefined;
}

export interface QualityRowProps extends QualityRowActions {
  row: QualityRowModel;
  targets: TargetChoices;
  readOnly: boolean;
  /** The GM's decisions are being saved. */
  deciding?: boolean;
}

const GLYPH: Readonly<Record<Issue['severity'], string>> = { error: '✕', warning: '!', approval: '?' };
const TONE: Readonly<Record<Issue['severity'], string>> = { error: 'text-danger', warning: 'text-warn', approval: 'text-magenta' };

/** An issue as a line: glyph and colour for the eye, the sentence for everyone, the page. */
export function IssueLine({ issue }: { issue: Issue }) {
  return (
    <li className={`flex flex-wrap items-center gap-1.5 text-xs ${TONE[issue.severity]}`} data-issue={issue.code} data-severity={issue.severity}>
      <span aria-hidden>{GLYPH[issue.severity]}</span>
      <span className="sr-only">{issue.severity === 'error' ? 'Must fix: ' : 'Worth a look: '}</span>
      <span>{issue.message}</span>
      <RefChip refValue={issue.ref} />
    </li>
  );
}

function TargetPicker({ row, targets, readOnly, onTarget }: Pick<QualityRowProps, 'row' | 'targets' | 'readOnly' | 'onTarget'>) {
  const id = useId();
  const target = row.target;
  if (!target) return null;
  const question = TARGET_QUESTION[target.kind];
  if (readOnly) {
    return (
      <p className="text-xs text-dim" data-testid="quality-target">
        <span className="mono-label mr-1.5">{question.replace('?', '')}</span>
        <span className="text-ink">{targetLabel(target.kind, target.value) ?? 'not named yet'}</span>
      </p>
    );
  }
  const value = target.value ?? '';
  return (
    <label htmlFor={id} className="block max-w-sm" data-testid="quality-target">
      <span className="mono-label block">{question}</span>
      <select
        id={id}
        className={FIELD_CLASS}
        value={value}
        onChange={(e) => onTarget(row, e.target.value || null)}
        aria-label={`${question} — for ${row.quality.name}`}
        data-testid="quality-target-select"
      >
        <option value="">choose…</option>
        {target.kind === 'attribute' &&
          targets.attribute.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        {target.kind === 'group' &&
          targets.group.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        {target.kind === 'skill' &&
          targets.skill.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
    </label>
  );
}

function ApprovalChip({ row, onDecide, deciding }: Pick<QualityRowProps, 'row' | 'onDecide' | 'deciding'>) {
  const id = useId();
  const approval = row.approval;
  if (!approval) return null;
  const tone = approval.decision === 'approved' ? 'border-ok/40 text-ok' : approval.decision === 'denied' ? 'border-danger/50 text-danger' : 'border-magenta/50 text-magenta';
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="quality-approval" data-decision={approval.decision ?? 'waiting'}>
      <span id={id} className={`chip ${tone}`}>
        <span aria-hidden>?&nbsp;</span>needs the GM · {approvalWords(approval.decision)}
      </span>
      <RefChip refValue={approval.ref} />
      {onDecide && (
        <>
          <button
            type="button"
            className="btn px-3 py-1"
            aria-describedby={id}
            aria-label={`approve ${row.quality.name}`}
            {...(deciding || approval.decision === 'approved' ? { 'aria-disabled': true } : {})}
            onClick={() => {
              if (!deciding && approval.decision !== 'approved') onDecide(approval.code, 'approved');
            }}
            data-testid="quality-approve"
          >
            approve
          </button>
          <button
            type="button"
            className="btn px-3 py-1"
            aria-describedby={id}
            aria-label={`deny ${row.quality.name}`}
            {...(deciding || approval.decision === 'denied' ? { 'aria-disabled': true } : {})}
            onClick={() => {
              if (!deciding && approval.decision !== 'denied') onDecide(approval.code, 'denied');
            }}
            data-testid="quality-deny"
          >
            deny
          </button>
        </>
      )}
    </div>
  );
}

export function QualityRow(props: QualityRowProps) {
  const { row, readOnly } = props;
  const q = row.quality;
  return (
    <li
      className="space-y-2 rounded-md border border-edge bg-deck p-3"
      data-testid="quality-row"
      data-type={q.type}
      data-index={row.index}
      data-whitelisted={row.entry && !row.buyOff ? 'yes' : 'no'}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-40">
          <h3 className="break-words text-sm font-semibold text-ink">
            {q.name}
            {q.rating !== null && <span className="font-normal text-dim"> · rating {q.rating}</span>}
          </h3>
          <p className="text-xs text-dim" data-testid="quality-karma">
            {row.karmaText}
          </p>
        </div>
        {q.ref && <RefChip refValue={q.ref} className="pointer-coarse:min-h-10" />}
        {!readOnly && (
          <button
            type="button"
            className="btn px-3 py-1"
            aria-label={`remove ${q.name}`}
            onClick={() => props.onRemove(row)}
            data-testid="quality-remove"
          >
            remove
          </button>
        )}
      </div>

      {row.buyOff && (
        <p className="chip border-cyan-dim/60 text-cyan" data-testid="quality-buy-off">
          buys off a born quality
        </p>
      )}
      <ApprovalChip row={row} onDecide={props.onDecide} deciding={props.deciding} />

      {row.effects.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-dim" aria-label={`What ${q.name} changes at creation`} data-testid="quality-effects">
          {row.effects.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <TargetPicker row={row} targets={props.targets} readOnly={readOnly} onTarget={props.onTarget} />

      {row.reminders.length > 0 && (
        <ul className="space-y-1" data-testid="quality-reminders">
          {row.reminders.map((r) => (
            <li key={r.text} className="flex flex-wrap items-center gap-2 text-xs text-cyan">
              <span>{r.text}</span>
              <button
                type="button"
                className="chip text-dim hover:text-cyan pointer-coarse:min-h-10"
                onClick={() => props.onGoTo(r.step)}
                aria-label={`step ${r.step} — go to ${stepMeta(r.step).title}`}
              >
                step {r.step}
              </button>
            </li>
          ))}
        </ul>
      )}

      {row.problems.length > 0 && (
        <ul className="space-y-1" aria-label={`Checks on ${q.name}`} data-testid="quality-problems">
          {row.problems.map((issue, i) => (
            <IssueLine key={`${issue.code}-${i}`} issue={issue} />
          ))}
        </ul>
      )}

      <ModifierEditor
        quality={q}
        readOnly={readOnly}
        onAdd={(mod) => props.onAddMod(row, mod)}
        onRemove={(modId) => props.onRemoveMod(row, modId)}
      />
    </li>
  );
}

export interface QualitySideProps extends QualityRowActions {
  type: QualityType;
  rows: readonly QualityRowModel[];
  budgets: Budgets;
  targets: TargetChoices;
  readOnly: boolean;
  deciding?: boolean;
}

/** One list with its pool and its cap's page. */
export default function QualitySide(props: QualitySideProps) {
  const { type, rows, budgets, readOnly } = props;
  const headingId = useId();
  const poolId = useId();
  const ref = qualityCapRef(type);
  const pool = type === 'positive' ? 'positiveQualities' : 'negativeQualities';
  return (
    <section aria-labelledby={headingId} aria-describedby={poolId} className="min-w-0 space-y-2" data-testid={`qualities-${type}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h2 id={headingId} className="mono-label text-cyan">
          {SIDE_TITLE[type]}
        </h2>
        {ref && <WhyLink refValue={ref} label="cap" />}
      </div>
      <PoolLine budgets={budgets} pool={pool} id={poolId} />
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-edge px-3 py-2 text-sm text-faint" data-testid={`qualities-${type}-empty`}>
          {type === 'positive'
            ? readOnly
              ? 'No positive qualities taken.'
              : 'None taken. Positive qualities cost Karma; add one below, or leave this empty.'
            : readOnly
              ? 'No negative qualities taken.'
              : 'None taken. Negative qualities give Karma; add one below, or leave this empty.'}
        </p>
      ) : (
        <ul className="space-y-2" aria-labelledby={headingId}>
          {rows.map((row) => (
            <QualityRow
              key={`${row.index}-${row.quality.name}`}
              row={row}
              targets={props.targets}
              readOnly={readOnly}
              deciding={props.deciding}
              onRemove={props.onRemove}
              onTarget={props.onTarget}
              onAddMod={props.onAddMod}
              onRemoveMod={props.onRemoveMod}
              onGoTo={props.onGoTo}
              onDecide={props.onDecide}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
