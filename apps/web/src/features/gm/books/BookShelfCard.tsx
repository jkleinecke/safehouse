/**
 * One book on the shelf (M11 / FR11.1, FR11.5).
 *
 * Presentational on purpose: every piece of state lives in `BooksPage`, so this
 * card renders identically in a test and at the table. The one thing it insists
 * on is honesty about the offset — a book still at the seeded `+0` is drawn as
 * "not calibrated" in warn colours, not as a confident zero, because after a
 * fresh `pnpm seed:books` that is sixteen of the seventeen books and every ref
 * chip into them opens the wrong page.
 */
import type { BookRecord } from './api.js';
import {
  calibrationStatus,
  confidenceBand,
  describeProposal,
  formatConfidence,
  formatOffset,
  previewPage,
  type OffsetProposal,
} from './calibration.js';
import { viewerHref } from './refs.js';

export type DetectPhase = 'idle' | 'pending' | 'empty' | 'error';

export interface BookShelfCardProps {
  book: BookRecord;
  /** The offset the GM is currently stepping (starts at the saved one). */
  draftOffset: number;
  /** Printed page used for the resolve preview and the verify link. */
  probePrinted: number;
  proposal?: OffsetProposal | null | undefined;
  detectPhase?: DetectPhase;
  /**
   * The server's own sentence about the last detection. Rendered verbatim when
   * it declined, because "no printed page numbers found" and "split vote — 21
   * pages say +1, 19 say +2" are different problems with different fixes.
   */
  detectNote?: string | null | undefined;
  detectError?: string | null | undefined;
  saving?: boolean;
  onDraftOffset: (next: number) => void;
  onProbePrinted: (next: number) => void;
  onSaveOffset: () => void;
  onRevertOffset: () => void;
  onDetect: () => void;
  onApplyProposal: () => void;
  onDismissProposal: () => void;
  onToggleShared: (next: boolean) => void;
  onOpenCalibrate: () => void;
}

const BAND_CLASS: Record<string, string> = {
  high: 'border-ok/40 text-ok',
  medium: 'border-warn/40 text-warn',
  low: 'border-danger/40 text-danger',
  unstated: 'border-edge text-dim',
};

/**
 * How much of this book is actually searchable.
 *
 * `GET /api/books` reports `indexedPages`; nothing reports a PDF page count
 * (no column holds one, and opening every file to find out is not a listing's
 * job), so the "N image-only" gap only appears if a build ever starts sending
 * `pdfPages`. The case worth shouting about is the one that otherwise looks
 * healthy: a seeded book with zero indexed pages is invisible to search and to
 * the Fixer, and nothing else on the card would say so.
 */
function PageStat({ book }: { book: BookRecord }) {
  const pdf = book.pdfPages;
  const indexed = book.indexedPages;
  if (pdf === undefined && indexed === undefined) {
    // A single-book route, which does not carry counts. Say so rather than
    // printing a zero that would read as "nothing indexed".
    return <span className="mono-label text-faint">page counts not reported</span>;
  }
  if (indexed === 0) {
    return (
      <span
        className="mono-label text-warn"
        title="No extracted text: this book cannot be searched and the Fixer cannot cite it. Re-seed it, or it is an image-only scan."
      >
        0 pages indexed — not searchable
      </span>
    );
  }
  const gap = pdf !== undefined && indexed !== undefined ? pdf - indexed : 0;
  const items = book.catalogueItems;
  return (
    <span className="mono-label text-faint">
      {pdf !== undefined && <>{pdf} pdf pages · </>}
      {indexed ?? '?'} pages indexed
      {items !== undefined && (
        <span title="Rows the catalogue read off the tables — what a sheet's “+ from the books” can find" data-testid="book-catalogue-count">
          {' '}
          · {items} item{items === 1 ? '' : 's'} catalogued
        </span>
      )}
      {gap > 0 && (
        <span className="text-warn" title="Image-only pages index no text — invisible to search.">
          {' '}
          · {gap} image-only
        </span>
      )}
    </span>
  );
}

function ProposalBlock({
  book,
  proposal,
  onApply,
  onDismiss,
  saving,
}: {
  book: BookRecord;
  proposal: OffsetProposal;
  onApply: () => void;
  onDismiss: () => void;
  saving?: boolean;
}) {
  const band = confidenceBand(proposal.confidence);
  return (
    <div
      className="rounded-md border border-cyan-dim/50 bg-deck p-3"
      data-testid="offset-proposal"
      data-proposal-offset={proposal.offset}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono-label text-cyan">proposed</span>
        <span className="chip border-cyan-dim text-cyan">offset {formatOffset(proposal.offset)}</span>
        <span className={`chip ${BAND_CLASS[band] ?? BAND_CLASS['unstated']}`}>
          {formatConfidence(proposal.confidence)}
        </span>
      </div>
      <p className="mt-2 text-xs text-dim">{describeProposal(book.pageOffset, proposal)}</p>
      <p className="mt-1 text-xs text-faint">{proposal.evidence}</p>
      {proposal.samples.length > 0 && (
        <ul className="mono-label mt-2 space-y-0.5 text-faint">
          {proposal.samples.slice(0, 4).map((s, i) => (
            <li key={`${s.printed}-${s.pdf}-${i}`}>
              printed {s.printed} found on pdf page {s.pdf}
              {s.note ? ` · ${s.note}` : ''}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Nothing is written until this is clicked (Principle 8). */}
        <button
          type="button"
          className="btn btn-accent px-3 py-1.5"
          disabled={saving}
          onClick={onApply}
        >
          {saving ? 'applying…' : `apply ${formatOffset(proposal.offset)}`}
        </button>
        <button type="button" className="btn px-3 py-1.5" onClick={onDismiss}>
          dismiss
        </button>
        <span className="mono-label text-faint">not saved yet</span>
      </div>
    </div>
  );
}

export default function BookShelfCard({
  book,
  draftOffset,
  probePrinted,
  proposal,
  detectPhase = 'idle',
  detectNote,
  detectError,
  saving = false,
  onDraftOffset,
  onProbePrinted,
  onSaveOffset,
  onRevertOffset,
  onDetect,
  onApplyProposal,
  onDismissProposal,
  onToggleShared,
  onOpenCalibrate,
}: BookShelfCardProps) {
  const status = calibrationStatus(book);
  const uncalibrated = status.state === 'uncalibrated';
  const preview = previewPage(probePrinted, draftOffset);
  const dirty = Math.round(draftOffset) !== Math.round(book.pageOffset);

  return (
    <div
      className={`panel flex flex-col gap-3 p-4 ${uncalibrated ? 'border-warn/50' : ''}`}
      data-testid="book-card"
      data-book-code={book.code}
      data-calibration={status.state}
    >
      <div className="flex items-center gap-2">
        <span className="chip border-cyan-dim text-cyan">{book.code}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={book.title}>
          {book.title}
        </span>
        <span
          className={`chip ${
            uncalibrated
              ? 'border-warn/60 text-warn'
              : status.state === 'no-file'
                ? 'border-edge text-faint'
                : 'border-ok/40 text-ok'
          }`}
          data-testid="calibration-chip"
        >
          {status.label}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <PageStat book={book} />
      </div>

      <p className={`text-xs ${uncalibrated ? 'text-warn' : 'text-faint'}`}>{status.detail}</p>

      {/* --- the nudge loop (FR11.1) ---------------------------------------- */}
      <div className="rounded-md border border-edge bg-deck p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mono-label block">printed page</span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              className="mt-1 w-24 rounded-md border border-edge bg-panel px-2 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
              value={probePrinted}
              aria-label={`${book.code} printed page to check`}
              onChange={(e) => onProbePrinted(Number(e.target.value))}
            />
          </label>

          <div className="flex items-end gap-1.5">
            <button
              type="button"
              className="btn min-h-11 px-3"
              aria-label={`${book.code} offset −1`}
              onClick={() => onDraftOffset(draftOffset - 1)}
            >
              −
            </button>
            <label className="block">
              <span className="mono-label block">offset</span>
              <input
                type="number"
                className="mt-1 w-20 rounded-md border border-edge bg-panel px-2 py-1.5 text-center text-sm text-ink focus:border-cyan focus:outline-none"
                value={draftOffset}
                aria-label={`${book.code} page offset`}
                onChange={(e) => onDraftOffset(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              className="btn min-h-11 px-3"
              aria-label={`${book.code} offset +1`}
              onClick={() => onDraftOffset(draftOffset + 1)}
            >
              +
            </button>
          </div>
        </div>

        {/* Principle 3: the resolved page, spelled out, before anything opens. */}
        <p className="mono-label mt-2 text-cyan" data-testid="resolve-line">
          {preview.line}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-accent px-3 py-1.5" onClick={onOpenCalibrate}>
            open p.{preview.printed} & nudge
          </button>
          {/* Verify end to end: the same address a ref chip links to. */}
          <a
            className="btn px-3 py-1.5"
            href={viewerHref({ book: book.code, page: preview.printed })}
            target="_blank"
            rel="noreferrer"
            title="Open the reader in a new tab at this printed page"
          >
            verify ↗
          </a>
          {dirty && (
            <>
              <button
                type="button"
                className="btn btn-accent px-3 py-1.5"
                disabled={saving}
                onClick={onSaveOffset}
              >
                {saving ? 'saving…' : `save ${formatOffset(draftOffset)}`}
              </button>
              <button type="button" className="btn px-3 py-1.5" onClick={onRevertOffset}>
                revert
              </button>
            </>
          )}
        </div>
      </div>

      {/* --- detection ------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn px-3 py-1.5"
          disabled={detectPhase === 'pending' || !status.actionable}
          onClick={onDetect}
        >
          {detectPhase === 'pending' ? 'detecting…' : 'detect offset'}
        </button>
        <label className="ml-auto flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={book.shared}
            aria-label={`${book.code} shared with table`}
            onChange={(e) => onToggleShared(e.target.checked)}
          />
          <span className="mono-label">shared with table</span>
        </label>
      </div>

      {detectPhase === 'empty' && !proposal && (
        <p className="text-xs text-warn" data-testid="detect-declined">
          {/* The server's reason, not ours — it knows whether the pages were
              image-only, unnumbered, or split between two candidate offsets. */}
          {detectNote
            ? `Nothing measured — ${detectNote}. Calibrate it by hand above.`
            : 'No offset could be read from this book. Calibrate it by hand above.'}
        </p>
      )}
      {detectPhase === 'error' && detectError && (
        <p className="text-xs text-danger">detect failed: {detectError}</p>
      )}

      {proposal && (
        <ProposalBlock
          book={book}
          proposal={proposal}
          saving={saving}
          onApply={onApplyProposal}
          onDismiss={onDismissProposal}
        />
      )}
    </div>
  );
}
