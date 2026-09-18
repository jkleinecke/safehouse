/**
 * The priority table as a grid — the laptop's way through Step 2 (FR3.9,
 * docs/CHARGEN.md §4.4 Step 2).
 *
 * With room for it, the clearest picture of the step is the table itself:
 * rows A–E down the side, the five columns across, and each column's row lit.
 * Unlike the printed table, every cell here says what it buys *this* runner
 * (the model in `model.ts`), so reading across row B answers "what would B
 * get me in each column?" and reading down Skills answers "what does moving
 * Skills cost?" without a second lookup.
 *
 * It is a keyboard grid (WAI-ARIA grid pattern): one tab stop, arrow keys
 * move a cell at a time, Home and End to the ends of a row, Ctrl+Home and
 * Ctrl+End to the corners, and Enter or Space takes the focused cell. Moving
 * never takes — under the priority table a take swaps rows between columns,
 * and arrowing through a column must not reshuffle the others on the way.
 * Each cell's button is named by its place and figure; its swap, the later
 * step it would reopen and any refusal are text tied to it with
 * `aria-describedby`, shown short in the cell and in full, with the page, in
 * the panel under the grid, which follows the focused (or hovered) cell.
 *
 * The table sits in its own horizontal scroller so a narrow laptop window
 * never scrolls the page sideways; below `lg` the page shows the column
 * pickers instead. Read-only, it is a plain table with each column's row
 * marked in words.
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { PRIORITY_LEVELS, type PriorityColumn, type PriorityLevel } from '@safehouse/contracts';
import { RefChip } from '../../../gm/books/RefChip.js';
import {
  UNUSED_SHORT,
  breaksSentence,
  breaksShort,
  cellAt,
  cellPlace,
  gridKeyTarget,
  gridTabStop,
  swapSentence,
  swapShort,
  type GridPoint,
  type PrioritiesModel,
  type PriorityCell,
} from './model.js';

export interface PriorityGridProps {
  model: PrioritiesModel;
  onPick: (column: PriorityColumn, level: PriorityLevel) => void;
  readOnly?: boolean;
  /** The cell the grid starts on (tests); defaults to the first column's row. */
  initialActive?: GridPoint;
}

function costWords(cost: number): string {
  return `${cost} ${cost === 1 ? 'point' : 'points'}`;
}

/** The full account of one cell, with its pages — under the grid. */
export function CellDetail({ cell }: { cell: PriorityCell }) {
  return (
    <div className="panel space-y-1.5 p-3" data-testid="priority-grid-detail" data-cell={`${cell.column}-${cell.level}`}>
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-ink">
        <span>{cellPlace(cell)}</span>
        {cell.chosen && <span className="mono-label text-cyan">chosen</span>}
        {cell.cost !== null && <span className="mono-label text-dim">{costWords(cell.cost)}</span>}
      </h3>
      <p className="text-sm text-ink">{cell.figure}</p>
      {cell.detail.length > 0 && (
        <ul className="space-y-0.5 text-xs text-dim">
          {cell.detail.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {cell.swap && (
        <p className="text-xs text-dim">
          <span aria-hidden>↔ </span>Taking it {swapSentence(cell.swap)}.
        </p>
      )}
      {cell.breaks && (
        <p className="flex items-baseline gap-1.5 text-xs text-warn">
          <span aria-hidden className="shrink-0">
            ⚠
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{breaksSentence(cell.breaks)}</span>
            <RefChip refValue={cell.breaks.first.ref} />
          </span>
        </p>
      )}
      {cell.unused && (
        <p className="flex items-baseline gap-1.5 text-xs text-warn" data-unused={cell.level}>
          <span aria-hidden className="shrink-0">
            ⚠
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{cell.unused.message} A mundane runner gets nothing from it.</span>
            <RefChip refValue={cell.unused.ref} />
          </span>
        </p>
      )}
      {cell.refusal && (
        <p className="flex items-baseline gap-1.5 text-xs text-warn">
          <span aria-hidden className="shrink-0">
            ⛔
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{cell.refusal.reason}</span>
            {cell.refusal.ref && <RefChip refValue={cell.refusal.ref} />}
          </span>
        </p>
      )}
    </div>
  );
}

export default function PriorityGrid({ model, onPick, readOnly = false, initialActive }: PriorityGridProps) {
  const id = useId();
  const captionId = `${id}-caption`;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState<GridPoint | null>(initialActive ?? null);
  const rows = PRIORITY_LEVELS.length;
  const cols = model.columns.length;
  const stop = active ?? gridTabStop(model.columns);
  const activeCell = cellAt(model, stop.col, stop.row);

  const moveTo = (point: GridPoint) => {
    setActive(point);
    refs.current[point.row * cols + point.col]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, at: GridPoint) => {
    const target = gridKeyTarget(rows, cols, at, event.key, event.ctrlKey || event.metaKey);
    if (target === null) return;
    event.preventDefault();
    moveTo(target);
  };

  return (
    <div className="space-y-2" data-testid="priority-grid" data-readonly={readOnly ? 'yes' : 'no'}>
      <div className="overflow-x-auto" data-testid="priority-grid-scroll">
        <table
          {...(readOnly ? {} : { role: 'grid' })}
          aria-labelledby={captionId}
          className="w-full min-w-[40rem] table-fixed border-separate border-spacing-1 text-left"
        >
          <caption id={captionId} className="sr-only">
            {readOnly
              ? 'The priority table, with each column’s row marked.'
              : 'The priority table. Arrow keys move between cells; Enter or Space takes a row for its column.'}
          </caption>
          <colgroup>
            <col className="w-14" />
            {model.columns.map((c) => (
              <col key={c.column} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <td />
              {model.columns.map((c) => (
                <th key={c.column} scope="col" className="align-bottom font-normal" data-column={c.column}>
                  <span className="block text-xs font-semibold text-ink">{c.label}</span>
                  <span className={`mono-label block ${c.level ? 'text-cyan' : 'text-warn'}`}>
                    {c.level ? `row ${c.level}` : 'no row yet'}
                  </span>
                  {c.note && <span className="block text-[11px] leading-tight text-faint">{c.note}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRIORITY_LEVELS.map((level, row) => (
              <tr key={level} data-row={level}>
                <th scope="row" className="align-top font-normal">
                  <span className="block font-label text-base text-ink">{level}</span>
                  {model.costs && <span className="mono-label block text-dim">{costWords(model.costs[level])}</span>}
                </th>
                {model.columns.map((column, col) => {
                  const cell = column.cells[row]!;
                  const key = `${cell.column}-${cell.level}`;
                  if (readOnly) {
                    return (
                      <td
                        key={key}
                        className={`rounded-md border p-2 align-top text-xs ${cell.chosen ? 'border-cyan bg-cyan/5' : 'border-edge bg-deck'}`}
                        data-cell={key}
                        data-chosen={cell.chosen ? 'yes' : 'no'}
                      >
                        <span className="block text-ink">{cell.figure}</span>
                        {cell.notes.map((note) => (
                          <span key={note} className="block text-faint">
                            {note}
                          </span>
                        ))}
                        {cell.chosen && <span className="mono-label mt-1 block text-cyan">● chosen</span>}
                      </td>
                    );
                  }
                  const point = { row, col };
                  const refused = cell.refusal !== null;
                  const base = `${id}-${key}`;
                  const describedBy = [
                    ...(cell.notes.length > 0 ? [`${base}-notes`] : []),
                    ...(cell.swap ? [`${base}-swap`] : []),
                    ...(cell.breaks ? [`${base}-breaks`] : []),
                    ...(cell.unused ? [`${base}-unused`] : []),
                    ...(refused ? [`${base}-refusal`] : []),
                  ].join(' ');
                  return (
                    <td key={key} className="h-px p-0 align-top" data-cell={key}>
                      <button
                        ref={(el) => {
                          refs.current[row * cols + col] = el;
                        }}
                        type="button"
                        aria-pressed={cell.chosen}
                        aria-labelledby={`${base}-name`}
                        {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                        {...(refused ? { 'aria-disabled': true } : {})}
                        tabIndex={stop.row === row && stop.col === col ? 0 : -1}
                        onClick={() => {
                          setActive(point);
                          if (!refused && !cell.chosen) onPick(cell.column, cell.level);
                        }}
                        onFocus={() => setActive(point)}
                        onMouseEnter={() => setActive(point)}
                        onKeyDown={(e) => onKeyDown(e, point)}
                        data-chosen={cell.chosen ? 'yes' : 'no'}
                        data-refused={refused ? 'yes' : 'no'}
                        data-breaks={cell.breaks ? 'yes' : 'no'}
                        className={`flex h-full min-h-16 w-full flex-col items-start gap-0.5 rounded-md border p-2 text-left text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                          cell.chosen ? 'border-cyan bg-cyan/5' : 'border-edge bg-deck hover:border-edge-bright'
                        } ${refused ? 'cursor-not-allowed opacity-70' : ''}`}
                      >
                        <span id={`${base}-name`} className={cell.chosen ? 'font-semibold text-ink' : 'text-ink'}>
                          <span className="sr-only">{cellPlace(cell)}: </span>
                          {cell.figure}
                        </span>
                        {cell.notes.length > 0 && (
                          <span id={`${base}-notes`} className="flex flex-col text-faint">
                            {cell.notes.map((note) => (
                              <span key={note}>{note}</span>
                            ))}
                          </span>
                        )}
                        {cell.chosen && (
                          <span aria-hidden className="mono-label text-cyan">
                            ● chosen
                          </span>
                        )}
                        {cell.swap && (
                          <>
                            <span aria-hidden className="text-dim">
                              ↔ {swapShort(cell.swap)}
                            </span>
                            <span id={`${base}-swap`} className="sr-only">
                              Taking it {swapSentence(cell.swap)}.
                            </span>
                          </>
                        )}
                        {cell.breaks && (
                          <>
                            <span aria-hidden className="text-warn">
                              ⚠ {breaksShort(cell.breaks)}
                            </span>
                            <span id={`${base}-breaks`} className="sr-only">
                              {breaksSentence(cell.breaks)}
                            </span>
                          </>
                        )}
                        {cell.unused && (
                          <>
                            <span aria-hidden className="text-warn">
                              ⚠ {UNUSED_SHORT}
                            </span>
                            <span id={`${base}-unused`} className="sr-only">
                              {cell.unused.message} A mundane runner gets nothing from it.
                            </span>
                          </>
                        )}
                        {cell.refusal && (
                          <span id={`${base}-refusal`} className="text-warn" data-refusal={key}>
                            <span aria-hidden>⛔ </span>
                            {cell.refusal.reason}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && activeCell && <CellDetail cell={activeCell} />}
    </div>
  );
}
