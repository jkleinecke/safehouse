/**
 * One priority column as a row picker — the phone's way through Step 2
 * (FR3.9, docs/CHARGEN.md §4.4 Step 2).
 *
 * §4.4 draws the step as labels dropped into slots, and dragging is the one
 * gesture a keyboard, a screen reader and a thumb on a 375 px screen all do
 * badly. So on a phone each of the five columns is its own short list of
 * rows A–E, each row saying what it buys this runner, and taking a row is a
 * tap. It is a radio group — one row is the column's — with one difference
 * from the usual pattern, on purpose: arrow keys move focus between rows but
 * do not take them; Enter or Space does. Under the priority table taking a
 * row swaps it with the column that held it, so a radio group that took
 * every row an arrow passed over would reshuffle two other columns on the way
 * down the list. A row the rules shut (Sum to Ten past its points) stays
 * focusable with the validator's sentence under it, tied by
 * `aria-describedby`; a swap, or a later step the tap would reopen, is said
 * the same way before the tap.
 *
 * Said, but not shouted. Twenty unchosen rows each carrying a full swap
 * sentence, an amber "reopens step 6" sentence and a page chip made the step
 * about 5,400 px tall on a phone, mostly amber. So a row keeps one short
 * muted line ("↔ swaps with Skills · ⚠ reopens step 6") and the whole
 * account — the sentences and the page — opens under the row that has focus
 * (arrowed to, or tabbed in), the way the laptop grid's detail panel follows
 * its focused cell. The full sentences stay the button's description either
 * way, so a screen reader hears them on every row.
 *
 * Everything shown is the column model's (`model.ts`); this only lays it out.
 * Read-only (a submitted build, the GM's review) shows the chosen row alone.
 */
import { useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { PriorityLevel } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import { choiceKeyTarget } from '../../kit/ChoiceCards.js';
import {
  UNUSED_SHORT,
  breaksSentence,
  breaksShort,
  columnTabStop,
  swapSentence,
  swapShort,
  type PriorityCell,
  type PriorityColumnModel,
} from './model.js';

export interface ColumnPickerProps {
  column: PriorityColumnModel;
  onPick: (level: PriorityLevel) => void;
  readOnly?: boolean;
  /** The row that starts with focus, its account open (tests; a live picker follows focus). */
  initialFocus?: PriorityLevel;
}

function costWords(cost: number): string {
  return `${cost} ${cost === 1 ? 'point' : 'points'}`;
}

/** The chosen row's figure and detail, as a read-only line. */
function ChosenRow({ cell }: { cell: PriorityCell }) {
  return (
    <div className="rounded-md border border-cyan/60 bg-cyan/5 p-3" data-testid="priority-chosen" data-level={cell.level}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink">
        <span className="font-label text-base text-cyan">{cell.level}</span>
        <span className="font-semibold">{cell.figure}</span>
        {cell.cost !== null && <span className="mono-label text-dim">{costWords(cell.cost)}</span>}
      </p>
      {cell.detail.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-dim">
          {cell.detail.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ColumnPicker({ column, onPick, readOnly = false, initialFocus }: ColumnPickerProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabStop = columnTabStop(column);
  const chosen = column.cells.find((c) => c.chosen) ?? null;
  // The row whose swap and reopened steps are spelled out in full: the one with focus.
  const [focused, setFocused] = useState<PriorityLevel | null>(initialFocus ?? null);
  const leave = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = choiceKeyTarget(column.cells.length, index, event.key);
    if (target === null) return;
    event.preventDefault();
    refs.current[target]?.focus();
  };

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-2"
      data-testid={`priority-column-${column.column}`}
      data-level={column.level ?? 'none'}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h2 id={headingId} className="text-sm font-semibold text-ink">
          {column.label}
        </h2>
        <span className={`mono-label ${column.level ? 'text-cyan' : 'text-warn'}`}>
          {column.level ? `row ${column.level}` : 'no row yet'}
        </span>
      </div>
      {column.note && <p className="text-xs text-faint">{column.note}</p>}

      {readOnly ? (
        chosen ? (
          <ChosenRow cell={chosen} />
        ) : (
          <p className="text-sm text-warn" data-testid="priority-unchosen">
            <span aria-hidden>○ </span>No row chosen for {column.label}.
          </p>
        )
      ) : (
        <div role="radiogroup" aria-labelledby={headingId} className="space-y-1.5" onBlur={leave}>
          {column.cells.map((cell, index) => {
            const refused = cell.refusal !== null;
            const titleId = `${id}-${cell.level}-title`;
            const detailId = `${id}-${cell.level}-detail`;
            const swapId = `${id}-${cell.level}-swap`;
            const breaksId = `${id}-${cell.level}-breaks`;
            const refusalId = `${id}-${cell.level}-refusal`;
            const unusedId = `${id}-${cell.level}-unused`;
            const open = focused === cell.level;
            const describedBy = [
              ...(cell.detail.length > 0 ? [detailId] : []),
              ...(cell.swap ? [swapId] : []),
              ...(cell.breaks ? [breaksId] : []),
              ...(cell.unused ? [unusedId] : []),
              ...(refused ? [refusalId] : []),
            ].join(' ');
            return (
              <div key={cell.level} className="min-w-0" data-cell={`${cell.column}-${cell.level}`}>
                <button
                  ref={(el) => {
                    refs.current[index] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={cell.chosen}
                  aria-labelledby={titleId}
                  {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                  {...(refused ? { 'aria-disabled': true } : {})}
                  tabIndex={index === tabStop ? 0 : -1}
                  onClick={() => {
                    if (!refused && !cell.chosen) onPick(cell.level);
                  }}
                  onKeyDown={(e) => onKeyDown(e, index)}
                  onFocus={() => setFocused(cell.level)}
                  data-checked={cell.chosen ? 'yes' : 'no'}
                  data-open={open ? 'yes' : 'no'}
                  data-refused={refused ? 'yes' : 'no'}
                  data-breaks={cell.breaks ? 'yes' : 'no'}
                  className={`flex min-h-11 w-full flex-col items-start gap-1 rounded-md border p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                    cell.chosen ? 'border-cyan bg-cyan/5' : 'border-edge bg-deck hover:border-edge-bright'
                  } ${refused ? 'cursor-not-allowed opacity-70' : ''}`}
                >
                  <span className="flex w-full flex-wrap items-baseline gap-x-2">
                    <span aria-hidden className={cell.chosen ? 'text-cyan' : 'text-faint'}>
                      {cell.chosen ? '●' : '○'}
                    </span>
                    <span id={titleId} className="min-w-0 flex-1 text-sm text-ink">
                      <span className="mr-2 font-label text-base">{cell.level}</span>
                      <span className="font-semibold">{cell.figure}</span>
                    </span>
                    {cell.cost !== null && <span className="mono-label text-dim">{costWords(cell.cost)}</span>}
                    {cell.chosen && (
                      <span aria-hidden className="mono-label text-cyan">
                        chosen
                      </span>
                    )}
                  </span>
                  {cell.detail.length > 0 && (
                    <span id={detailId} className="flex flex-col gap-0.5 text-xs text-dim">
                      {cell.detail.map((line) => (
                        <span key={line}>{line}</span>
                      ))}
                    </span>
                  )}
                </button>
                {!open && (cell.swap || cell.breaks || cell.unused) && (
                  // The short form every row keeps; the sentences it stands for are the button's description.
                  <p aria-hidden className="mt-1 flex flex-wrap gap-x-3 text-xs" data-testid="priority-cell-brief">
                    {cell.swap && <span className="text-dim">↔ {swapShort(cell.swap)}</span>}
                    {cell.breaks && <span className="text-warn">⚠ {breaksShort(cell.breaks)}</span>}
                    {cell.unused && <span className="text-warn">⚠ {UNUSED_SHORT}</span>}
                  </p>
                )}
                {cell.unused && (
                  <p id={unusedId} className={open ? 'mt-1 flex items-baseline gap-1.5 text-xs text-warn' : 'sr-only'} data-unused={cell.level}>
                    <span aria-hidden className="shrink-0">
                      ⚠
                    </span>
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span>{cell.unused.message} A mundane runner gets nothing from it.</span>
                      {open && <RefChip refValue={cell.unused.ref} className="pointer-coarse:min-h-10" />}
                    </span>
                  </p>
                )}
                {cell.swap && (
                  <p id={swapId} className={open ? 'mt-1 text-xs text-dim' : 'sr-only'} data-swap={cell.swap.column}>
                    <span aria-hidden>↔ </span>
                    {swapSentence(cell.swap)}
                  </p>
                )}
                {cell.breaks && (
                  <p
                    id={breaksId}
                    className={open ? 'mt-1 flex items-baseline gap-1.5 text-xs text-warn' : 'sr-only'}
                    data-breaks-steps={cell.breaks.steps.join(',')}
                  >
                    <span aria-hidden className="shrink-0">
                      ⚠
                    </span>
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span>{breaksSentence(cell.breaks)}</span>
                      {open && <RefChip refValue={cell.breaks.first.ref} className="pointer-coarse:min-h-10" />}
                    </span>
                  </p>
                )}
                {cell.refusal && (
                  <p id={refusalId} className="mt-1 flex items-baseline gap-1.5 text-xs text-warn" data-refusal={cell.level}>
                    <span aria-hidden className="shrink-0">
                      ⛔
                    </span>
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span>{cell.refusal.reason}</span>
                      {cell.refusal.ref && <RefChip refValue={cell.refusal.ref} className="pointer-coarse:min-h-10" />}
                    </span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
