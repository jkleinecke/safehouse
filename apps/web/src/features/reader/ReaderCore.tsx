/**
 * The reader itself, independent of how it was opened (FR11.3).
 *
 * `ReaderRoute` mounts it full-screen at `/read/:bookCode`; `BookReaderOverlay`
 * mounts it as an overlay over whatever the table was already looking at, which
 * is the shape the FR asks for — "opens the book right there … without losing
 * table context".
 *
 * Offset resolution stays on the server (`GET /read/:code?p=`) so a ref chip
 * never has to know a book's front matter; the calibration path (FR11.1) is the
 * one exception, because there the GM is *deciding* the offset and needs the
 * page to move as they nudge it.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { getSession, getToken } from '../../api/session.js';
import { recordRecentRef, useAddBookmark, useReadInfo } from '../gm/books/api.js';
import NativeBookFrame from './NativeBookFrame.js';
import ReaderShell, { type ReaderCalibration } from './ReaderShell.js';
import { nextZoom } from './layout.js';
import {
  resolveReaderMode,
  setNativePreference,
  triageReaderError,
  type ReaderMode,
} from './mode.js';
import { resolvePdfPage, stepPrinted } from './pageMath.js';

/**
 * Two dynamic hops from the route table to pdf.js: this one, and `pdfjs.ts`'s
 * own same-origin `import('/pdfjs/pdf.mjs')`. Nothing about the library — nor
 * the canvas and gesture code around it — is in the initial bundle (§15).
 */
const PdfSurface = lazy(() => import('./PdfSurface.js'));

export interface ReaderCoreProps {
  code: string;
  printedPage: number;
  /** Reported whenever the reader moves, so the route can keep `?p=` current. */
  onPrintedPageChange?: ((printedPage: number) => void) | undefined;
  onClose?: (() => void) | undefined;
  closeLabel?: string;
  /** GM offset calibration (FR11.1) — maps locally instead of asking the server. */
  calibrate?: ReaderCalibration | undefined;
  /** Where the mode resolution started (the route reads `?native=`). */
  initialMode?: ReaderMode;
  /** Reported when the viewer changes, so the route can keep `?native=` honest. */
  onModeChange?: ((mode: ReaderMode) => void) | undefined;
  /** Remember a mode change on this device. */
  rememberMode?: boolean;
  className?: string;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export default function ReaderCore({
  code,
  printedPage,
  onPrintedPageChange,
  onClose,
  closeLabel,
  calibrate,
  initialMode,
  onModeChange,
  rememberMode = false,
  className,
}: ReaderCoreProps) {
  const [page, setPage] = useState(printedPage);
  const [mode, setMode] = useState<ReaderMode>(
    () => initialMode ?? resolveReaderMode(null, storage()),
  );
  const [pageCount, setPageCount] = useState<number | undefined>(undefined);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  // A new ref chip on the same open reader jumps it; so does a `?p=` change.
  useEffect(() => setPage(printedPage), [printedPage]);
  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  // One mapping request per book, not per page turn: the reader needs the
  // book's `pageOffset` and title, and `resolvePdfPage` does the rest locally.
  // Keying the query on the live page would put a round trip on every tap of
  // "next" — on a phone, on the table's Wi-Fi.
  const [anchorPage] = useState(printedPage);

  // The trail (FR11.6): opening a book puts it on the table's recently-read
  // list — once per opening, not per page turn, and calibrating is not reading.
  const session = getSession();
  const campaignId = session?.campaignId;
  const calibrating = calibrate !== undefined;
  useEffect(() => {
    if (!campaignId || calibrating) return;
    recordRecentRef(campaignId, { book: code, page: anchorPage });
  }, [campaignId, calibrating, code, anchorPage]);

  // Naming the page you are on (FR11.6): the GM's, and only inside a campaign.
  const addBookmark = useAddBookmark(campaignId ?? '');
  const [marked, setMarked] = useState<string | null>(null);
  // While calibrating, the offset is the GM's live guess, not the stored one.
  const info = useReadInfo(calibrate ? undefined : code, anchorPage);
  const offset = calibrate ? calibrate.offset : (info.data?.pageOffset ?? 0);
  const mapping = useMemo(() => resolvePdfPage(page, offset, pageCount), [page, offset, pageCount]);

  const token = getToken();

  const move = useCallback(
    (next: number) => {
      setPage(next);
      onPrintedPageChange?.(next);
    },
    [onPrintedPageChange],
  );

  const onStep = useCallback(
    (delta: number) => move(stepPrinted(page, delta, offset, pageCount)),
    [move, page, offset, pageCount],
  );

  const onToggleNative = useCallback(
    (native: boolean) => {
      const next: ReaderMode = native ? 'native' : 'pdfjs';
      setMode(next);
      setFatal(null);
      setNotice(null);
      if (rememberMode) setNativePreference(native, storage());
      onModeChange?.(next);
    },
    [rememberMode, onModeChange],
  );

  /**
   * Two different failures, two different answers.
   *
   * If the *book* is the problem — this device may not read it (FR11.5's
   * GM-only toggle) or the registry row has no file — the browser's viewer
   * would fetch the same URL with the same token and show the same error
   * dressed as a broken PDF. Say so instead.
   *
   * Everything else is the *viewer* being the problem: pdf.js not vendored, a
   * blocked worker, an endpoint that will not honour byte ranges. Mid-session
   * the right answer is the book on the screen, so fall through to the
   * browser's own viewer and label it (NG7's habit, applied to a viewer).
   */
  const onError = useCallback((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    const failure = triageReaderError(err);
    if (failure.kind === 'blocked') {
      setFatal(failure.message);
      return;
    }
    setMode('native');
    setNotice('in-app viewer unavailable — browser viewer');
    setFatal(null);
    if (typeof console !== 'undefined') console.warn('[reader] pdf.js unavailable:', detail);
  }, []);

  const surface =
    mode === 'native' ? (
      <NativeBookFrame
        code={code}
        pdfPage={mapping.pdf}
        printedPage={mapping.printed}
        token={token}
      />
    ) : (
      <Suspense fallback={<ReaderSpinner />}>
        <PdfSurface
          code={code}
          token={token}
          pdfPage={mapping.pdf}
          zoom={zoom}
          onZoomChange={setZoom}
          onPageCount={setPageCount}
          onError={onError}
          onLoadingChange={setLoading}
        />
      </Suspense>
    );

  const status =
    notice ??
    (mode === 'native' ? 'browser viewer' : loading ? 'streaming…' : null) ??
    (info.isError ? 'offset unavailable' : null);

  return (
    <ReaderShell
      code={code}
      title={info.data?.title}
      mapping={mapping}
      pageCount={pageCount}
      mode={mode}
      onStep={onStep}
      onJump={move}
      onToggleNative={onToggleNative}
      onClose={onClose}
      {...(closeLabel ? { closeLabel } : {})}
      zoom={
        mode === 'pdfjs'
          ? {
              value: zoom,
              onIn: () => setZoom((z) => nextZoom(z, 1)),
              onOut: () => setZoom((z) => nextZoom(z, -1)),
              onFit: () => setZoom(1),
            }
          : undefined
      }
      calibrate={calibrate}
      bookmark={
        campaignId && session?.role === 'gm' && !calibrating
          ? {
              onSave: (label) =>
                addBookmark.mutate(
                  { book: code, page, label },
                  {
                    onSuccess: (b) => setMarked(`saved as “${b.label}”`),
                    onError: (err) => setMarked(err instanceof Error ? err.message : 'could not save'),
                  },
                ),
              saving: addBookmark.isPending,
              saved: marked,
            }
          : undefined
      }
      status={status}
      error={fatal}
      {...(className ? { className } : {})}
    >
      {surface}
    </ReaderShell>
  );
}

function ReaderSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="mono-label text-faint">opening the book…</span>
    </div>
  );
}
