/**
 * Pick a row from the campaign's books — a quality, a spell, a piece of
 * 'ware (FR3.9, docs/CHARGEN.md §4.4 Steps 4, 5 and 7, §8.6 "catalogue
 * picking reuses AddFromBooksView and toSheet with the browse mode").
 *
 * A search box over a list that is already full before anything is typed:
 * the kind browsed alphabetically from the campaign's character-creation
 * books (`useBuilderCatalogue`), "show more" for the next page, and typing
 * narrows it. Each row reads the way the sheet's "add from the books" rows
 * do — the same `HitSummary` (name, table, printed columns) and the reader
 * chip for its page — plus what the builder needs to know before the tap:
 * its price in the currency it is bought with and its Availability, both
 * read at the rating and grade by the rules engine (`hitPrice`,
 * `hitAvailability`).
 *
 * A row over a campaign cap is not hidden. It is greyed, and says which cap
 * and by what number ("Availability 14 is over this campaign's cap of 12"),
 * with the page — the sentence tied to the row's button with
 * `aria-describedby`, the button left focusable but refusing
 * (`aria-disabled`). A step that lets the GM decide such rows passes
 * `allowOverCap`, and the sentence stays as a warning. A row already taken
 * says so the same way. A Restricted or Forbidden row can be picked but says
 * "needs the GM" on the row itself (`hitGmNote`, with the page), tied to its
 * button, so the approval item it will raise is no surprise. A step with caps
 * of its own (a ritual past the rituals cap, a spell past Magic × 2) passes
 * `rowRefusal`, and a row it refuses is shut the same way before the tap
 * rather than refused after it.
 *
 * `onPick(hit)` hands the row back; the step turns it into a build line with
 * the kit's mappers (`hitToQuality`, `hitToPurchase`, …), asking first for a
 * rating (`RatingPicker`, `hitRatingRange`) when the row needs one.
 *
 * `CataloguePickerView` is the half a static render can see; the default
 * export owns the typing (a short pause before the server sees it) and the
 * query.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { AugmentGrade, ChargenSettings } from '@safehouse/contracts';
import { RefChip } from '../../gm/books/RefChip.js';
import { KIND_LABEL, type CatalogueKind } from '../../sheet/catalogue/api.js';
import HitSummary from '../../sheet/catalogue/HitSummary.js';
import type { CatalogueHit } from '../../sheet/catalogue/toSheet.js';
import type { Refusal } from '../components/LimitStepper.js';
import { hitAvailability, hitCapRefusals, hitGmNote, hitPrice, type HitReading } from './catalogue.js';
import { hitRef } from './mappers.js';
import { useBuilderCatalogue } from './useBuilderCatalogue.js';

export type PickerCaps = Pick<ChargenSettings, 'maxAvailability' | 'maxDeviceRating'>;

export interface CataloguePickerViewProps {
  kind: CatalogueKind;
  /** What the rows are called ("qualities"); the kind's own label by default. */
  label?: string;
  query: string;
  onQuery: (q: string) => void;
  hits: readonly CatalogueHit[] | undefined;
  total: number | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: unknown;
  onMore: () => void;
  /** The campaign's caps each row is read against. */
  caps: PickerCaps;
  /** A grade to read 'ware at (its cost and Availability change with it). */
  grade?: AugmentGrade | null;
  onPick: (hit: CatalogueHit) => void;
  /** The word on each row's button (default "add"). */
  pickLabel?: string;
  /** Catalogue ids already on the build: listed, not offered again. */
  taken?: ReadonlySet<string>;
  /** Let a row over a cap be picked (the GM decides it); its sentence stays as a warning. */
  allowOverCap?: boolean;
  /**
   * The step's own answer for a row before the tap — the validator's sentence
   * for a cap the campaign caps do not cover (usually `probe` on the line the
   * row would add). A refused row is shut, whatever `allowOverCap` says.
   */
  rowRefusal?: (hit: CatalogueHit) => Refusal | null;
  /** List only; no buttons. */
  readOnly?: boolean;
  /** What to offer when the campaign's books list none of this kind (a way to write one in). */
  emptyAction?: ReactNode;
  testId?: string;
}

/** What one row may do and why not: the caps it is over, that it is already taken, or the step's own refusal. */
export function pickerRowGate(
  hit: CatalogueHit,
  opts: Pick<CataloguePickerViewProps, 'caps' | 'grade' | 'taken' | 'allowOverCap' | 'rowRefusal'>,
): { refusals: Refusal[]; over: boolean; taken: boolean; canPick: boolean; gm: Refusal | null } {
  const reading: HitReading = { grade: opts.grade ?? null };
  const taken = opts.taken?.has(hit.id) ?? false;
  const capRefusals = hitCapRefusals(hit, opts.caps, reading);
  const stepRefusal = taken ? null : (opts.rowRefusal?.(hit) ?? null);
  const refusals = [
    ...(taken ? [{ reason: `${hit.name} is already on this runner.` }] : []),
    ...(stepRefusal ? [stepRefusal] : []),
    ...capRefusals,
  ];
  const over = capRefusals.length > 0;
  const note = hitGmNote(hit, reading);
  const gm = note ? { reason: note.reason, ...(note.ref ? { ref: note.ref } : {}) } : null;
  return { refusals, over, taken, canPick: !taken && !stepRefusal && (!over || opts.allowOverCap === true), gm };
}

/** "Showing 25 of 212 qualities" — or what is being looked for, while it loads. */
export function pickerCountLine(shown: number, total: number | null, label: string, query: string): string {
  if (total === null) return query.trim() ? `Looking for “${query.trim()}”…` : `Loading ${label}…`;
  if (total === 0) return query.trim() ? `No ${label} match “${query.trim()}”.` : `This campaign's books list no ${label}.`;
  return `Showing ${Math.min(shown, total)} of ${total} ${label}`;
}

function PickerRow({
  hit,
  gate,
  grade,
  pickLabel,
  readOnly,
  onPick,
  testId,
}: {
  hit: CatalogueHit;
  gate: ReturnType<typeof pickerRowGate>;
  grade: AugmentGrade | null;
  pickLabel: string;
  readOnly: boolean;
  onPick: (hit: CatalogueHit) => void;
  testId: string;
}) {
  const reasonId = useId();
  const gmId = useId();
  const reading: HitReading = { grade };
  const price = hitPrice(hit, reading);
  const availability = hitAvailability(hit, reading);
  const figures = [price, availability].filter((x): x is string => Boolean(x));
  const ref = hitRef(hit);
  const shut = !gate.canPick;
  return (
    <li
      className="flex flex-wrap items-center gap-2 py-2"
      data-testid={`${testId}-hit`}
      data-kind={hit.kind}
      data-over={gate.over ? 'yes' : 'no'}
      data-taken={gate.taken ? 'yes' : 'no'}
    >
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
        <HitSummary hit={hit} priced={false} muted={gate.over || gate.taken} wrap bare />
        {figures.length > 0 && (
          <div className={`text-xs ${gate.over ? 'text-faint' : 'text-dim'}`} data-testid={`${testId}-figures`}>
            {figures.join(' · ')}
          </div>
        )}
        {gate.refusals.length > 0 && (
          <div id={reasonId} className="flex flex-col gap-0.5" data-testid={`${testId}-refusal`}>
            {gate.refusals.map((r) => (
              // The glyph stays beside the first line of its sentence on a narrow row.
              <p key={r.reason} className="flex items-baseline gap-1.5 text-xs text-warn">
                <span aria-hidden className="shrink-0">
                  {gate.canPick ? '!' : '⛔'}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span>{r.reason}</span>
                  {r.ref && <RefChip refValue={r.ref} />}
                </span>
              </p>
            ))}
          </div>
        )}
        {gate.gm && (
          <p id={gmId} className="flex items-baseline gap-1.5 text-xs text-magenta" data-testid={`${testId}-gm`}>
            <span aria-hidden className="shrink-0">
              ?
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>{gate.gm.reason}</span>
              {gate.gm.ref && <RefChip refValue={gate.gm.ref} />}
            </span>
          </p>
        )}
      </div>
      {ref && <RefChip refValue={ref} className="pointer-coarse:min-h-10" />}
      {!readOnly && (
        <button
          type="button"
          className={`btn px-3 py-1 ${shut ? 'cursor-not-allowed opacity-60' : 'btn-accent'}`}
          aria-label={`${pickLabel} ${hit.name}`}
          {...(shut ? { 'aria-disabled': true } : {})}
          {...(gate.refusals.length > 0 || gate.gm
            ? { 'aria-describedby': [...(gate.refusals.length > 0 ? [reasonId] : []), ...(gate.gm ? [gmId] : [])].join(' ') }
            : {})}
          data-testid={`${testId}-pick`}
          onClick={() => {
            if (!shut) onPick(hit);
          }}
        >
          {gate.taken ? 'taken' : pickLabel}
        </button>
      )}
    </li>
  );
}

export function CataloguePickerView(p: CataloguePickerViewProps) {
  const label = p.label ?? KIND_LABEL[p.kind];
  const testId = p.testId ?? 'catalogue-picker';
  const pickLabel = p.pickLabel ?? 'add';
  const countId = useId();
  const hits = p.hits ?? [];
  const errorText = p.error ? (p.error instanceof Error ? p.error.message : String(p.error)) : null;
  return (
    <div className="space-y-2" data-testid={testId}>
      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <input
          type="search"
          className="w-full rounded-md border border-edge bg-deck px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none pointer-coarse:min-h-10"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          placeholder={`part of a name, or scroll the ${label}`}
          aria-label={`Search ${label}`}
          aria-describedby={countId}
          data-testid={`${testId}-search`}
        />
      </form>
      <p id={countId} className="mono-label text-faint" role="status" aria-live="polite" data-testid={`${testId}-count`}>
        {p.loading ? pickerCountLine(0, null, label, p.query) : pickerCountLine(hits.length, p.total, label, p.query)}
      </p>
      {p.emptyAction && !p.loading && p.total === 0 && !p.query.trim() && (
        <div className="flex flex-wrap items-center gap-2" data-testid={`${testId}-empty-action`}>
          {p.emptyAction}
        </div>
      )}
      {errorText && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert" data-testid={`${testId}-error`}>
          {errorText}
        </p>
      )}
      {hits.length > 0 && (
        <ul className="divide-y divide-edge/60" aria-label={label} data-testid={`${testId}-hits`}>
          {hits.map((hit) => (
            <PickerRow
              key={hit.id}
              hit={hit}
              gate={pickerRowGate(hit, p)}
              grade={p.grade ?? null}
              pickLabel={pickLabel}
              readOnly={p.readOnly === true}
              onPick={p.onPick}
              testId={testId}
            />
          ))}
        </ul>
      )}
      {p.hasMore && (
        <button
          type="button"
          className="btn w-full px-3 py-1.5"
          onClick={p.onMore}
          {...(p.loadingMore ? { 'aria-disabled': true } : {})}
          aria-label={`Show more ${label}`}
          data-testid={`${testId}-more`}
        >
          {p.loadingMore ? 'loading…' : 'show more'}
        </button>
      )}
    </div>
  );
}

export interface CataloguePickerProps extends Omit<
  CataloguePickerViewProps,
  'query' | 'onQuery' | 'hits' | 'total' | 'hasMore' | 'loading' | 'loadingMore' | 'error' | 'onMore'
> {
  campaignId: string;
  /** Rows per page (default 25). */
  pageSize?: number;
  /** Told how many rows the books hold with nothing typed, once known (a step may open another way in when it is 0). */
  onTotal?: (total: number) => void;
}

/** The live picker: typing, with a short pause before the server sees it, over `useBuilderCatalogue`. */
export default function CataloguePicker({ campaignId, pageSize, onTotal, ...view }: CataloguePickerProps) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(draft), 250);
    return () => clearTimeout(t);
  }, [draft]);
  const catalogue = useBuilderCatalogue({
    campaignId,
    kind: view.kind,
    q: query,
    ...(pageSize ? { limit: pageSize } : {}),
  });
  const browsedTotal = query.trim() === '' && !catalogue.loading ? catalogue.total : null;
  useEffect(() => {
    if (browsedTotal !== null) onTotal?.(browsedTotal);
  }, [browsedTotal, onTotal]);
  return (
    <CataloguePickerView
      {...view}
      query={draft}
      onQuery={setDraft}
      hits={catalogue.hits}
      total={catalogue.total}
      hasMore={catalogue.hasMore}
      loading={catalogue.loading}
      loadingMore={catalogue.loadingMore}
      error={catalogue.error}
      onMore={catalogue.loadMore}
    />
  );
}
