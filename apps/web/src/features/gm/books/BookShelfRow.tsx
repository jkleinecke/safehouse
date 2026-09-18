/**
 * One book on the shelf, as a table row (M11 / FR11.1, FR11.5).
 *
 * Presentational on purpose: every piece of state lives in `BooksPage`, so the
 * row renders identically in a test and at the table. The one thing it insists
 * on is honesty about the offset — a book still at the seeded `+0` reads
 * "not calibrated" in warn colours, not as a confident zero, because every ref
 * chip into it opens the wrong page.
 *
 * A detection's proposal, or its reason for declining, opens a second row
 * under the book; nothing is written until the GM applies it (Principle 8).
 */
import { useState } from 'react';
import type { BookRecord } from './api.js';
import {
  calibrationStatus,
  confidenceBand,
  describeProposal,
  formatConfidence,
  formatOffset,
  type OffsetProposal,
} from './calibration.js';

export type DetectPhase = 'idle' | 'pending' | 'empty' | 'error';

/** Columns in the shelf table — the detail row spans all of them. */
export const SHELF_COLUMNS = 6;

export interface BookShelfRowProps {
  book: BookRecord;
  /** The offset shown — the saved one, or the one just sent to be saved. */
  offset: number;
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
  /** Saves at once — every step and every typed value, no confirm. */
  onSetOffset: (next: number) => void;
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
 * How much of this book is searchable. `GET /api/books` reports
 * `indexedPages`; a seeded book with zero of them is invisible to search and
 * to the Fixer, and nothing else in the row would say so.
 */
function PageStat({ book }: { book: BookRecord }) {
  const indexed = book.indexedPages;
  if (indexed === undefined) return <span className="text-faint">—</span>;
  if (indexed === 0) {
    return (
      <span
        className="text-warn"
        title="No extracted text: this book cannot be searched and the Fixer cannot cite it. Re-seed it, or it is an image-only scan."
      >
        not searchable
      </span>
    );
  }
  const gap = book.pdfPages !== undefined ? book.pdfPages - indexed : 0;
  return (
    <span className="text-dim">
      {indexed}
      {gap > 0 && (
        <span className="text-warn" title="Image-only pages index no text — invisible to search.">
          {' '}
          ({gap} image-only)
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
      className="flex flex-wrap items-center gap-2"
      data-testid="offset-proposal"
      data-proposal-offset={proposal.offset}
    >
      <span className="mono-label text-cyan">proposed</span>
      <span className="chip border-cyan-dim text-cyan">offset {formatOffset(proposal.offset)}</span>
      <span className={`chip ${BAND_CLASS[band] ?? BAND_CLASS['unstated']}`}>
        {formatConfidence(proposal.confidence)}
      </span>
      <span className="text-xs text-dim" title={proposal.evidence}>
        {describeProposal(book.pageOffset, proposal)}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {/* Nothing is written until this is clicked (Principle 8). */}
        <button type="button" className="btn btn-accent px-3 py-1" disabled={saving} onClick={onApply}>
          {saving ? 'applying…' : `apply ${formatOffset(proposal.offset)}`}
        </button>
        <button type="button" className="btn px-3 py-1" onClick={onDismiss}>
          dismiss
        </button>
      </span>
    </div>
  );
}

export default function BookShelfRow({
  book,
  offset,
  proposal,
  detectPhase = 'idle',
  detectNote,
  detectError,
  saving = false,
  onSetOffset,
  onDetect,
  onApplyProposal,
  onDismissProposal,
  onToggleShared,
  onOpenCalibrate,
}: BookShelfRowProps) {
  const status = calibrationStatus(book);
  const uncalibrated = status.state === 'uncalibrated';
  // What is being typed; committed on Enter or leaving the box.
  const [typed, setTyped] = useState<string | null>(null);
  const commitTyped = () => {
    if (typed === null) return;
    const next = Number.parseInt(typed, 10);
    setTyped(null);
    if (Number.isFinite(next) && next !== Math.round(offset)) onSetOffset(next);
  };
  const declined = detectPhase === 'empty' && !proposal;
  const failed = detectPhase === 'error' && Boolean(detectError);
  const hasDetail = Boolean(proposal) || declined || failed;

  return (
    <>
      <tr
        className={`border-t border-edge/60 ${uncalibrated ? 'bg-warn/5' : ''}`}
        data-testid="book-row"
        data-book-code={book.code}
        data-calibration={status.state}
      >
        <td className="py-2 pr-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="mono-label w-10 shrink-0 text-cyan">{book.code}</span>
            <span className="truncate text-sm text-ink" title={book.title}>
              {book.title}
            </span>
          </div>
        </td>

        <td className="py-2 pr-3">
          <div className="flex items-center gap-1">
            <span
              className={`mono-label mr-1 w-24 ${
                uncalibrated ? 'text-warn' : status.state === 'no-file' ? 'text-faint' : 'text-ok'
              }`}
              title={status.detail}
              data-testid="calibration-status"
            >
              {uncalibrated ? 'not calibrated' : status.state === 'no-file' ? 'no PDF' : 'calibrated'}
            </span>
            <button
              type="button"
              className="btn px-2 py-0.5"
              aria-label={`${book.code} offset −1`}
              onClick={() => onSetOffset(offset - 1)}
            >
              −
            </button>
            <input
              type="number"
              className="w-14 rounded-md border border-edge bg-panel px-1 py-0.5 text-center text-sm text-ink focus:border-cyan focus:outline-none"
              value={typed ?? String(offset)}
              aria-label={`${book.code} page offset`}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={commitTyped}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTyped();
                if (e.key === 'Escape') setTyped(null);
              }}
            />
            <button
              type="button"
              className="btn px-2 py-0.5"
              aria-label={`${book.code} offset +1`}
              onClick={() => onSetOffset(offset + 1)}
            >
              +
            </button>
            {saving && <span className="mono-label ml-1 text-faint">saving…</span>}
          </div>
        </td>

        <td className="whitespace-nowrap py-2 pr-3 text-sm">
          <PageStat book={book} />
        </td>

        <td
          className="py-2 pr-3 text-sm text-dim"
          title="Rows the catalogue read off the tables — what a sheet's “+ from the books” can find"
          data-testid="book-catalogue-count"
        >
          {book.catalogueItems ?? <span className="text-faint">—</span>}
        </td>

        <td className="py-2 pr-3 text-center">
          <input
            type="checkbox"
            checked={book.shared}
            aria-label={`${book.code} shared with table`}
            onChange={(e) => onToggleShared(e.target.checked)}
          />
        </td>

        <td className="py-2 text-right">
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              className="btn px-2 py-0.5"
              disabled={!status.actionable}
              onClick={onOpenCalibrate}
              title="Open the book and nudge the offset against the page itself"
            >
              open
            </button>
            <button
              type="button"
              className="btn px-2 py-0.5"
              disabled={detectPhase === 'pending' || !status.actionable}
              onClick={onDetect}
              title="Propose an offset from the page numbers printed in the PDF"
            >
              {detectPhase === 'pending' ? 'detecting…' : 'detect'}
            </button>
          </div>
        </td>
      </tr>

      {hasDetail && (
        <tr data-testid="book-row-detail" data-book-code={book.code}>
          <td colSpan={SHELF_COLUMNS} className="pb-2 pl-4">
            {proposal && (
              <ProposalBlock
                book={book}
                proposal={proposal}
                saving={saving}
                onApply={onApplyProposal}
                onDismiss={onDismissProposal}
              />
            )}
            {declined && (
              <p className="text-xs text-warn" data-testid="detect-declined">
                {/* The server's reason, not ours — it knows whether the pages were
                    image-only, unnumbered, or split between two candidate offsets. */}
                {detectNote
                  ? `Nothing measured — ${detectNote}. Nudge it by hand with open.`
                  : 'No offset could be read from this book. Nudge it by hand with open.'}
              </p>
            )}
            {failed && <p className="text-xs text-danger">detect failed: {detectError}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
