/**
 * The small pieces the Skills screen repeats on every row (FR3.9,
 * docs/CHARGEN.md §4.4 Step 6): an issue said under the row it is about, a
 * labelled text field that turns into plain text when the build is read-only,
 * a text button sized for a thumb, a badge, and the one-per-skill
 * specialisation slot.
 *
 * Seventy-five skills, fifteen groups and a knowledge list each say the same
 * few things, so they are said here once. The issue line is the engine's
 * sentence and page (`Issue.message`, `Issue.ref`) with our glyph in front —
 * the glyph is decoration, the words carry the severity for a screen reader
 * ("must fix" / "worth a look"), so colour is never the only signal.
 */
import type { Budgets, Issue } from '@safehouse/contracts';
import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { RefChip } from '../../../gm/books/RefChip.js';
import { inputClass } from '../../../gm/ui.js';
import type { Refusal } from '../../components/LimitStepper.js';
import { CostQuote } from '../../kit/index.js';
import type { SkillPoolKey } from './model.js';

const SEVERITY = {
  error: { glyph: '✕', tone: 'text-danger', spoken: 'must fix' },
  warning: { glyph: '!', tone: 'text-warn', spoken: 'worth a look' },
  approval: { glyph: '?', tone: 'text-magenta', spoken: 'needs the GM' },
} as const;

/** The engine's findings about one row, under that row. */
export function IssueNotes({ issues, id, testId = 'skill-issues' }: { issues: readonly Issue[]; id?: string; testId?: string }) {
  if (issues.length === 0) return null;
  return (
    <ul {...(id ? { id } : {})} className="mt-1.5 space-y-1" data-testid={testId}>
      {issues.map((issue, i) => {
        const s = SEVERITY[issue.severity];
        return (
          <li key={`${issue.code}-${i}`} className={`flex flex-wrap items-center gap-1.5 text-xs ${s.tone}`} data-issue={issue.code} data-severity={issue.severity}>
            <span aria-hidden>{s.glyph}</span>
            <span className="sr-only">{s.spoken}:</span>
            <span>{issue.message}</span>
            <RefChip refValue={issue.ref} />
          </li>
        );
      })}
    </ul>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  /** Shown before anything is typed; never a label. */
  hint?: string;
  /** Visually hide the label (the row names the field). */
  hideLabel?: boolean;
  describedBy?: string;
  testId?: string;
  className?: string;
  /** What a read-only field says when empty. */
  emptyText?: string;
  autoFocus?: boolean;
}

/** A labelled one-line field; read-only, the value as text. */
export function TextField({ label, value, onChange, readOnly, hint, hideLabel = false, describedBy, testId, className, emptyText = '—', autoFocus }: TextFieldProps) {
  if (readOnly) {
    return (
      <span className={`inline-flex min-w-0 flex-wrap items-baseline gap-1.5 text-sm ${className ?? ''}`} data-testid={testId}>
        <span className={hideLabel ? 'sr-only' : 'mono-label text-faint'}>{label}</span>
        <span className={value.trim() ? 'text-ink' : 'text-faint'}>{value.trim() || emptyText}</span>
      </span>
    );
  }
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ''}`}>
      <span className={hideLabel ? 'sr-only' : 'mono-label text-faint'}>{label}</span>
      <input
        type="text"
        className={inputClass}
        value={value}
        maxLength={200}
        {...(hint ? { placeholder: hint } : {})}
        {...(describedBy ? { 'aria-describedby': describedBy } : {})}
        {...(autoFocus ? { autoFocus: true } : {})}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        data-testid={testId}
      />
    </label>
  );
}

/** A plain text button with a thumb-sized target. */
export function TextButton({
  children,
  onClick,
  label,
  testId,
  tone = 'plain',
}: {
  children: ReactNode;
  onClick: () => void;
  label?: string;
  testId?: string;
  tone?: 'plain' | 'danger';
}) {
  return (
    <button
      type="button"
      className={`btn px-3 py-1.5 ${tone === 'danger' ? 'hover:border-danger/60 hover:text-danger' : ''}`}
      onClick={onClick}
      {...(label ? { 'aria-label': label } : {})}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {children}
    </button>
  );
}

/**
 * A small badge on a row: a grant, the group a skill rides on, the dice.
 * `spoken` replaces the visible short form for a screen reader ("9 dice [M 5]"
 * is read "dice pool 9, Mental limit 5").
 */
export function Badge({ children, tone = 'text-dim', spoken, testId }: { children: ReactNode; tone?: string; spoken?: string; testId?: string }) {
  return (
    <span className={`chip ${tone}`} {...(testId ? { 'data-testid': testId } : {})}>
      {spoken ? (
        <>
          <span aria-hidden>{children}</span>
          <span className="sr-only">{spoken}</span>
        </>
      ) : (
        children
      )}
    </span>
  );
}

export interface SpecSlotViewProps {
  /** The skill's name, for the labels ("Specialisation for Pistols"). */
  name: string;
  spec: string;
  /** The skill has a rating to specialise. */
  rated: boolean;
  readOnly: boolean;
  /** The player asked to add one: the field is open before anything is typed. */
  adding: boolean;
  onAdding: () => void;
  onChange: (text: string) => void;
  /** What one would cost, asked of the engine only while the field is open and empty. */
  price: () => { pool: SkillPoolKey; amount: number } | null;
  budgets: Budgets;
  testId: string;
}

/**
 * A skill's one specialisation. Closed, it is a small "+ specialisation"
 * button — seventy-five open fields, each quoting a price in the warning
 * colour when the pool is spent, would drown the list — and open, a field
 * with the price quoted beside it and read with it (`aria-describedby`).
 * Clearing the text takes the specialisation off; the engine's budgets give
 * the point back.
 */
export function SpecSlotView({ name, spec, rated, readOnly, adding, onAdding, onChange, price, budgets, testId }: SpecSlotViewProps) {
  const quoteId = useId();
  const has = spec.trim() !== '';
  if (readOnly) {
    return has ? <TextField label={`Specialisation for ${name}`} value={spec} onChange={onChange} readOnly testId={`${testId}-input`} /> : null;
  }
  if (!has && !adding) {
    if (!rated) return null;
    return (
      <button type="button" className="btn px-3 py-1.5 text-dim" onClick={onAdding} aria-label={`+ specialisation for ${name}`} data-testid={`${testId}-add`}>
        + specialisation
      </button>
    );
  }
  const quote = has ? null : price();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid={testId}>
      <TextField
        label={`Specialisation for ${name}`}
        hideLabel
        value={spec}
        onChange={onChange}
        readOnly={false}
        hint="specialisation"
        className="min-w-[10rem] flex-1"
        autoFocus={adding && !has}
        {...(quote ? { describedBy: quoteId } : {})}
        testId={`${testId}-input`}
      />
      {quote && <CostQuote id={quoteId} amount={quote.amount} pool={quote.pool} budgets={budgets} />}
    </div>
  );
}

/** `SpecSlotView` with its one piece of state: whether the player opened it. */
export function SpecSlot(props: Omit<SpecSlotViewProps, 'adding' | 'onAdding'>) {
  const [adding, setAdding] = useState(false);
  return <SpecSlotView {...props} adding={adding} onAdding={() => setAdding(true)} />;
}

/**
 * Why a row is closed to this runner, said quietly: a skill or group nobody
 * can take is not a mistake to fix, so it reads as information (the engine's
 * sentence and page), not as the red ⛔ a pressed refusal earns.
 */
export function ClosedNote({ refusal, testId }: { refusal: Refusal; testId?: string }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-dim" {...(testId ? { 'data-testid': testId } : {})}>
      <span className="sr-only">Closed:</span>
      <span>{refusal.reason}</span>
      {refusal.ref && <RefChip refValue={refusal.ref} />}
    </p>
  );
}
