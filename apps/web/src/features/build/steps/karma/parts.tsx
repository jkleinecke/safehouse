/**
 * The small pieces every section of the Karma step is built from (FR3.9,
 * docs/CHARGEN.md §4.4 Step 8).
 *
 * Twelve kinds of spend on one screen would otherwise say "costs 10 Karma",
 * "refused, because…" and "this rule, that page" twelve slightly different
 * ways. So they are said here, once, over the step kit: a section with its
 * heading and "why?" chip; a raise row whose stepper refuses with the
 * engine's sentence and quotes the next rating's price only while the tap is
 * open; a button that does the same for a new line; the validator's issues
 * filed under the line they name. Refusals are words tied to their control
 * with `aria-describedby`, never colour alone; buttons stay focusable
 * (`aria-disabled`) so the reason can be reached.
 */
import { useId, type ReactNode } from 'react';
import type { Budgets, Issue, Ref } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import { useLimitStepper, type Refusal } from '../../components/LimitStepper.js';
import CostQuote from '../../kit/CostQuote.js';
import WhyLink from '../../kit/WhyLink.js';
import type { RailPoolKey } from '../../lib.js';
import type { BuildUpdater } from '../../session.js';
import type { TapGate } from './logic.js';
import type { RaiseTap } from './taps.js';

export const inputClass =
  'w-full rounded border border-edge bg-ground px-2 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none';

export const labelClass = 'mono-label mb-1 block text-faint';

/** A step section: an h2 with its page, and a body. */
export function Section({
  title,
  refValue,
  lead,
  testId,
  children,
}: {
  title: string;
  refValue?: Ref | undefined;
  lead?: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="panel space-y-3 p-3 sm:p-4" aria-labelledby={id} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-base font-semibold text-ink">
          {title}
        </h2>
        {refValue && <WhyLink refValue={refValue} />}
      </div>
      {lead && <div className="text-sm text-dim">{lead}</div>}
      {children}
    </section>
  );
}

/** A sub-heading inside a section. */
export function SubHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 {...(id ? { id } : {})} className="mono-label pt-1 text-dim">
      {children}
    </h3>
  );
}

const ISSUE_GLYPH: Readonly<Record<Issue['severity'], string>> = { error: '✕', warning: '!', approval: '?' };
const ISSUE_TONE: Readonly<Record<Issue['severity'], string>> = { error: 'text-danger', warning: 'text-warn', approval: 'text-magenta' };
const ISSUE_WORD: Readonly<Record<Issue['severity'], string>> = { error: 'Must fix:', warning: 'Worth a look:', approval: 'Needs the GM:' };

/** The validator's findings for one line or one section, in its own words, each with its page. */
export function IssueNotes({ issues, testId = 'karma-issues' }: { issues: readonly Issue[]; testId?: string }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1" data-testid={testId}>
      {issues.map((issue, i) => (
        <li
          key={`${issue.code}-${i}`}
          className="flex flex-wrap items-center gap-1.5 text-xs"
          data-issue={issue.code}
          data-severity={issue.severity}
        >
          <span aria-hidden className={ISSUE_TONE[issue.severity]}>
            {ISSUE_GLYPH[issue.severity]}
          </span>
          <span className="sr-only">{ISSUE_WORD[issue.severity]}</span>
          <span className="text-ink">{issue.message}</span>
          <RefChip refValue={issue.ref} className="pointer-coarse:min-h-10" />
        </li>
      ))}
    </ul>
  );
}

/** A refusal said under the control it shuts. */
export function RefusalLine({ refusal, id }: { refusal: Refusal; id: string }) {
  return (
    <p id={id} className="flex flex-wrap items-center gap-1.5 text-xs text-warn" data-testid="karma-refusal">
      <span aria-hidden>⛔</span>
      <span>{refusal.reason}</span>
      {refusal.ref && <RefChip refValue={refusal.ref} className="pointer-coarse:min-h-10" />}
    </p>
  );
}

/** What an open tap leaves to do on another step, in the engine's words. */
export function ConsequenceNote({ gate }: { gate: TapGate }) {
  if (!gate.open || gate.consequences.length === 0) return null;
  return (
    <p className="text-xs text-dim" data-testid="karma-consequence">
      Taking it also leaves: {gate.consequences.map((i) => `${i.message} (step ${i.step})`).join(' ')}
    </p>
  );
}

/** A form's button before its form is filled: shut, with what to do first in plain words (not a refusal). */
export const WAITING: TapGate = { open: false, refusal: null, consequences: [] };

/**
 * A button that adds a line: open, it quotes the price beside it; shut by a
 * rule, it says why in the quote's place; shut because its form is not filled
 * yet, it says what to fill, quietly. Whichever sentence shows is its
 * description.
 */
export function TapButton({
  label,
  ariaLabel,
  gate,
  hint,
  price,
  budgets,
  pool = 'karma',
  quoteLead,
  onPress,
  readOnly,
  testId,
}: {
  label: string;
  ariaLabel: string;
  /** The tap's gate; ignored while `hint` is set. */
  gate: TapGate;
  /** What to fill in first ("Choose a skill first."); the button waits until it is null. */
  hint?: string | null;
  price: number | null;
  budgets: Budgets;
  pool?: RailPoolKey;
  /** Words before the quote ("uses the last 1 contact Karma and"). */
  quoteLead?: string;
  onPress: () => void;
  readOnly: boolean;
  testId: string;
}) {
  const id = useId();
  if (readOnly) return null;
  const waiting = hint != null && hint !== '';
  const open = !waiting && gate.open;
  const refusal = waiting ? null : gate.refusal;
  const quoted = open && price !== null;
  const described = waiting || refusal !== null || quoted;
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`btn px-3 ${open ? '' : 'cursor-not-allowed opacity-60'}`}
          aria-label={ariaLabel}
          {...(open ? {} : { 'aria-disabled': true })}
          {...(described ? { 'aria-describedby': id } : {})}
          data-testid={testId}
          data-refused={refusal ? 'yes' : 'no'}
          data-open={open ? 'yes' : 'no'}
          onClick={() => {
            if (open) onPress();
          }}
        >
          {label}
        </button>
        {quoted && (
          <span id={id} className="text-xs text-dim">
            {quoteLead ? `${quoteLead} ` : ''}
            <CostQuote amount={price} budgets={budgets} pool={pool} />
          </span>
        )}
        {waiting && (
          <span id={id} className="text-xs text-faint" data-testid="karma-hint">
            {hint}
          </span>
        )}
      </div>
      {refusal && <RefusalLine refusal={refusal} id={id} />}
      {!waiting && <ConsequenceNote gate={gate} />}
    </div>
  );
}

/**
 * One thing Karma raises — an attribute, a skill, a group, a knowledge skill
 * or a language: its name and where its rating came from, a stepper whose
 * increase refuses with the engine's sentence, and the next rating's price
 * while the increase is open. The refusal sits under the whole row, so a
 * refused row's buttons stay in the column the others make.
 */
export function RaiseRow({
  name,
  detail,
  tap,
  budgets,
  update,
  readOnly,
  children,
}: {
  name: string;
  /** Where the rating came from, in a few words ("3 from points · max 6"). */
  detail: string;
  tap: RaiseTap;
  budgets: Budgets;
  update: (fn: BuildUpdater) => void;
  readOnly: boolean;
  children?: ReactNode;
}) {
  const quoteId = useId();
  const { gate, rating, floor } = tap;
  const { controls, refusal } = useLimitStepper({
    label: name,
    hideLabel: true,
    value: rating,
    min: floor,
    onChange: (value) => {
      if (value > rating) update(tap.up);
      else if (tap.down) update(tap.down);
    },
    refuseIncrease: gate.refusal,
    readOnly,
    // The next rating's price is read with the + button it prices.
    ...(!readOnly && gate.open ? { increaseDescribedBy: quoteId } : {}),
  });
  return (
    <li className="space-y-1 py-2" data-testid="karma-raise" data-raise={`${tap.target.kind}:${rating}`} data-refused={gate.open ? 'no' : 'yes'}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-40">
          <div className="text-sm text-ink">{name}</div>
          <div className="text-xs text-faint">{detail}</div>
        </div>
        <div className="shrink-0" data-testid="karma-raise-stepper">
          {controls}
        </div>
      </div>
      {refusal}
      {!readOnly && gate.open && (
        <p id={quoteId} className="text-xs text-dim" data-testid="karma-next-price">
          <span>to {rating + 1}: </span>
          <CostQuote amount={tap.price} budgets={budgets} />
        </p>
      )}
      {!readOnly && <ConsequenceNote gate={gate} />}
      {children}
    </li>
  );
}

/** A list that is empty says what goes in it. */
export function EmptyLine({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="text-sm text-faint" {...(testId ? { 'data-testid': testId } : {})}>
      {children}
    </p>
  );
}
