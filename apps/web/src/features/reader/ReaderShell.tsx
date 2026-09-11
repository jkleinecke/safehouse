/**
 * The reader's chrome: everything around the page surface (FR11.3).
 *
 * Presentational and prop-driven on purpose — no router, no query client, no
 * canvas — so the phone layout is rendered and asserted in tests without a DOM
 * environment. The controls live in a **bottom** bar because this is a view a
 * player holds one-handed at the table: page turn, printed-page jump and zoom
 * are all in thumb reach at 390 px, and the top bar keeps only the things you
 * read rather than press.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { describeMapping, parsePrintedParam, type PageMapping } from './pageMath.js';
import type { ReaderMode } from './mode.js';

export interface ReaderZoomControls {
  value: number;
  onIn: () => void;
  onOut: () => void;
  /** Back to fit-width — the state the page opened in. */
  onFit: () => void;
}

/** Offset calibration (FR11.1), shown only when the GM opened the book to calibrate. */
export interface ReaderCalibration {
  offset: number;
  onNudge: (delta: number) => void;
  onSave: () => void;
  saving?: boolean;
}

/** Name this page for the table (FR11.6) — offered to the GM inside a campaign. */
export interface ReaderBookmark {
  onSave: (label: string) => void;
  saving?: boolean | undefined;
  /** What the last save came to — "saved as …", or why not. */
  saved?: string | null | undefined;
}

export interface ReaderShellProps {
  code: string;
  title?: string | undefined;
  mapping: PageMapping;
  pageCount?: number | undefined;
  mode: ReaderMode;
  /** The page surface: a pdf.js canvas, or the native viewer's iframe. */
  children: ReactNode;
  onStep: (delta: number) => void;
  onJump: (printedPage: number) => void;
  onToggleNative?: ((native: boolean) => void) | undefined;
  onClose?: (() => void) | undefined;
  closeLabel?: string;
  zoom?: ReaderZoomControls | undefined;
  calibrate?: ReaderCalibration | undefined;
  bookmark?: ReaderBookmark | undefined;
  /** Non-fatal note ("streaming…", "native viewer"), rendered in the top bar. */
  status?: ReactNode;
  /** Fatal-for-this-view message; the surface is replaced by it. */
  error?: string | null | undefined;
  /** Extra classes on the root (the overlay adds its backdrop here). */
  className?: string;
}

const TAP = 'min-h-11 min-w-11'; // 44 px touch targets at 390 px.

export default function ReaderShell({
  code,
  title,
  mapping,
  pageCount,
  mode,
  children,
  onStep,
  onJump,
  onToggleNative,
  onClose,
  closeLabel = 'close',
  zoom,
  calibrate,
  bookmark,
  status,
  error,
  className,
}: ReaderShellProps) {
  const [draft, setDraft] = useState(String(mapping.printed));
  const [marking, setMarking] = useState(false);
  const [mark, setMark] = useState('');

  // The jump box follows the page when it moves for any other reason (stepper,
  // a clamp at the back cover, a new ref chip opening the same reader).
  useEffect(() => {
    setDraft(String(mapping.printed));
  }, [mapping.printed]);

  const atFront = mapping.pdf <= 1;
  const atBack = pageCount !== undefined && pageCount > 0 && mapping.pdf >= pageCount;

  return (
    <div
      className={`flex h-dvh min-h-0 w-full flex-col bg-ground ${className ?? ''}`}
      data-reader-mode={mode}
    >
      {/* --- top bar: identity and provenance (read, don't press) --------- */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge px-2 py-1.5">
        {onClose && (
          <button type="button" className={`btn px-2.5 ${TAP}`} onClick={onClose}>
            {closeLabel}
          </button>
        )}
        <span className="chip border-cyan-dim text-cyan">{code}</span>
        {title && <span className="min-w-0 flex-1 truncate text-sm text-dim">{title}</span>}
        {status && <span className="mono-label text-faint">{status}</span>}
        {onToggleNative && (
          <button
            type="button"
            className={`btn ml-auto px-2 ${TAP}`}
            aria-pressed={mode === 'native'}
            onClick={() => onToggleNative(mode !== 'native')}
            title={
              mode === 'native'
                ? 'Back to the in-app viewer'
                : "Fall back to the browser's own PDF viewer"
            }
          >
            {mode === 'native' ? 'in-app viewer' : 'browser viewer'}
          </button>
        )}
      </div>

      {/* --- the page ----------------------------------------------------- */}
      <div className="relative min-h-0 flex-1">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-warn">{error}</p>
            {onToggleNative && mode !== 'native' && (
              <button type="button" className="btn btn-accent" onClick={() => onToggleNative(true)}>
                open in the browser viewer
              </button>
            )}
          </div>
        ) : (
          children
        )}
      </div>

      {/* --- bottom bar: page turn, jump, zoom (thumb reach) -------------- */}
      <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-edge px-2 py-1.5">
        <button
          type="button"
          className={`btn px-3 ${TAP}`}
          onClick={() => onStep(-1)}
          disabled={atFront}
          aria-label="Previous page"
        >
          ‹ prev
        </button>

        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = parsePrintedParam(draft);
            if (parsed === null) setDraft(String(mapping.printed));
            else onJump(parsed);
          }}
        >
          <label className="mono-label" htmlFor="reader-printed-page">
            p.
          </label>
          <input
            id="reader-printed-page"
            name="printedPage"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="go"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            className={`w-16 rounded-md border border-edge bg-deck px-2 text-center text-base text-ink ${TAP}`}
            aria-label="Jump to printed page"
          />
          <button type="submit" className={`btn px-2.5 ${TAP}`}>
            go
          </button>
        </form>

        <button
          type="button"
          className={`btn px-3 ${TAP}`}
          onClick={() => onStep(1)}
          disabled={atBack}
          aria-label="Next page"
        >
          next ›
        </button>

        {zoom && (
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              className={`btn px-2.5 ${TAP}`}
              onClick={zoom.onOut}
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className={`btn px-2 ${TAP}`}
              onClick={zoom.onFit}
              aria-label="Fit page width"
            >
              {Math.round(zoom.value * 100)}%
            </button>
            <button
              type="button"
              className={`btn px-2.5 ${TAP}`}
              onClick={zoom.onIn}
              aria-label="Zoom in"
            >
              +
            </button>
          </span>
        )}

        {calibrate && (
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              className={`btn px-2.5 ${TAP}`}
              onClick={() => calibrate.onNudge(-1)}
              aria-label="Offset −1"
            >
              −
            </button>
            <span className="chip border-warn/40 text-warn">offset {calibrate.offset}</span>
            <button
              type="button"
              className={`btn px-2.5 ${TAP}`}
              onClick={() => calibrate.onNudge(1)}
              aria-label="Offset +1"
            >
              +
            </button>
            <button
              type="button"
              className={`btn btn-accent px-2.5 ${TAP}`}
              onClick={calibrate.onSave}
              disabled={calibrate.saving}
            >
              {calibrate.saving ? 'saving…' : 'save offset'}
            </button>
          </span>
        )}

        {bookmark && (
          <span className="flex flex-wrap items-center gap-1" data-testid="reader-bookmark">
            {marking ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const label = mark.trim();
                  if (!label) return;
                  bookmark.onSave(label);
                  setMarking(false);
                  setMark('');
                }}
              >
                <input
                  className={`rounded-md border border-edge bg-deck px-2 text-sm text-ink placeholder:text-faint focus:border-cyan focus:outline-none ${TAP}`}
                  value={mark}
                  autoFocus
                  placeholder="what this page is"
                  aria-label="Bookmark label"
                  onChange={(e) => setMark(e.target.value)}
                />
                <button type="submit" className={`btn btn-accent px-2.5 ${TAP}`} disabled={bookmark.saving}>
                  {bookmark.saving ? 'saving…' : 'save'}
                </button>
                <button type="button" className={`btn px-2.5 ${TAP}`} onClick={() => setMarking(false)}>
                  cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                className={`btn px-2.5 ${TAP}`}
                onClick={() => setMarking(true)}
                title="Name this page for the table — it lands in the library's bookmarks"
              >
                bookmark p.{mapping.printed}
              </button>
            )}
            {bookmark.saved && <span className="mono-label text-ok">{bookmark.saved}</span>}
          </span>
        )}

        {/* Principle 3: the page you are looking at says where it came from. */}
        <span className="mono-label w-full text-center text-faint">
          {describeMapping(mapping, pageCount)}
          {mapping.clamped ? ' · last page' : ''}
        </span>
      </div>
    </div>
  );
}
