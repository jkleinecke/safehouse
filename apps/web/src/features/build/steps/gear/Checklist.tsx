/**
 * "What most runners need" — the short list of things a job goes wrong
 * without, ticking itself as they are bought (FR3.9, docs/CHARGEN.md §4.4
 * Step 7 "a checklist (commlink, fake SIN, licences, armor, a weapon,
 * ammunition, a lifestyle) ticks itself off").
 *
 * A first-timer with 275,000¥ and a catalogue of two thousand rows does not
 * know where to start, and the one who does start usually forgets the SIN.
 * So the step opens with the list, each line saying in words whether the
 * runner has one yet (a tick is not an answer for a screen reader), and each
 * line still open carrying the shelf that sells it. Three lines are the
 * validator's own warnings and tick when the warning goes; the rest read the
 * purchase lists (`runnerChecklist`). Below it, when the build came from a
 * concept card, the card's shopping list in its own plain words — never an
 * item's name — each with its shelf (`conceptSuggestions`).
 *
 * Only the lifestyle is required to finish the step; the panel says so, so
 * the list reads as advice, not a gate.
 */
import { useId } from 'react';
import type { ChecklistRow, ConceptSuggestion, ShelfId } from './gear.js';
import { shelfOf } from './gear.js';
import { GearSection, SubHeading } from './parts.js';

export interface ChecklistProps {
  rows: readonly ChecklistRow[];
  suggestions: { title: string; items: readonly ConceptSuggestion[] } | null;
  /** Open a shelf of the shop; absent when nothing may be bought (read-only). */
  onShelf?: ((shelf: ShelfId) => void) | undefined;
  /** Where the lifestyles section is, for the lifestyle line's link. */
  lifestylesHref: string;
}

export default function Checklist({ rows, suggestions, onShelf, lifestylesHref }: ChecklistProps) {
  const headingId = useId();
  const suggestId = useId();
  const done = rows.filter((r) => r.done).length;
  return (
    <GearSection
      headingId={headingId}
      title="What most runners need"
      aside={
        <span className="mono-label text-faint" data-testid="gear-checklist-count">
          {done} of {rows.length}
        </span>
      }
      testId="gear-checklist"
    >
      <p className="text-xs text-dim">Only the lifestyle is needed to move on; the rest is what most jobs go wrong without.</p>
      <ul className="divide-y divide-edge/60">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 py-1.5"
            data-check={row.key}
            data-done={row.done ? 'yes' : 'no'}
          >
            <span aria-hidden className={row.done ? 'text-ok' : 'text-faint'}>
              {row.done ? '✓' : '○'}
            </span>
            <span className={`min-w-0 flex-1 text-sm ${row.done ? 'text-dim' : 'text-ink'}`}>{row.label}</span>
            <span className={`mono-label ${row.done ? 'text-ok' : 'text-faint'}`}>{row.done ? 'got it' : 'not yet'}</span>
            {!row.done && row.shelf && onShelf && (
              <button
                type="button"
                className="btn px-3 py-1"
                aria-label={`browse ${shelfOf(row.shelf).label} for ${row.label}`}
                onClick={() => onShelf(row.shelf!)}
                data-testid="gear-checklist-browse"
              >
                browse
              </button>
            )}
            {!row.done && row.key === 'lifestyle' && onShelf && (
              <a className="btn px-3 py-1" href={lifestylesHref} aria-label="choose a lifestyle">
                choose
              </a>
            )}
          </li>
        ))}
      </ul>
      {suggestions && (
        <div className="space-y-1.5" data-testid="gear-suggestions">
          <SubHeading id={suggestId}>The {suggestions.title} card suggests</SubHeading>
          <p className="text-xs text-faint">A starting list: it does not tick itself as you buy. The list above does.</p>
          <ul aria-labelledby={suggestId} className="divide-y divide-edge/60">
            {suggestions.items.map((item, i) => (
              <li key={`${item.hint}-${i}`} className="flex min-h-10 flex-wrap items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 text-sm text-ink">
                  {item.hint}
                  {item.qty > 1 && <span className="text-dim"> × {item.qty}</span>}
                </span>
                {onShelf && (
                  <button
                    type="button"
                    className="btn px-3 py-1"
                    aria-label={`browse ${shelfOf(item.shelf).label} for ${item.hint}`}
                    onClick={() => onShelf(item.shelf)}
                  >
                    browse
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </GearSection>
  );
}
