/**
 * Ref chips + in-app book viewer (M11, FR11.3): a `{ book, page }` ref renders
 * as a tappable chip; tapping opens the PDF right there — an overlay iframing
 * the browser-native PDF (`/files/books/:code#page=N`, offset resolved by the
 * server's /read JSON) without losing table context. Exported for reuse.
 */
import { useState, type ReactNode } from 'react';
import type { Ref } from '@safehouse/contracts';
import { getToken } from '../../../api/session.js';
import { useReadInfo } from './api.js';
import { bookFileHref, findFreetextRefs, printedToPdf, viewerHref } from './refs.js';

export interface BookViewerOverlayProps {
  code: string;
  printedPage: number;
  onClose: () => void;
  /**
   * Calibration mode (FR11.1): render offset nudge controls and map pages
   * locally with the given offset instead of asking the server.
   */
  calibrate?: {
    offset: number;
    onNudge: (delta: number) => void;
    onSave: () => void;
    saving?: boolean;
  };
}

/** Full-screen overlay: printed-page input → browser-native PDF iframe. */
export function BookViewerOverlay({ code, printedPage, onClose, calibrate }: BookViewerOverlayProps) {
  const [page, setPage] = useState(printedPage);
  const info = useReadInfo(calibrate ? undefined : code, page);
  const token = getToken();

  // Calibrating: local offset math. Otherwise: trust the server's mapping,
  // falling back to raw page while the JSON loads (or if the route 404s).
  const pdfPage = calibrate ? printedToPdf(page, calibrate.offset) : info.data?.pdfPage ?? page;
  const src = info.data?.fileUrl
    ? `${info.data.fileUrl}${info.data.fileUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token ?? '')}#page=${pdfPage}`
    : bookFileHref(code, pdfPage, token);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ground/95 p-3 backdrop-blur" role="dialog" aria-label={`Book ${code}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="chip border-cyan-dim text-cyan">{code}</span>
        {info.data?.title && <span className="truncate text-sm text-dim">{info.data.title}</span>}
        <label className="ml-2 flex items-center gap-1.5">
          <span className="mono-label">p.</span>
          <input
            type="number"
            min={1}
            value={page}
            onChange={(e) => setPage(Math.max(1, Number(e.target.value) || 1))}
            className="w-20 rounded-md border border-edge bg-deck px-2 py-1 text-sm text-ink"
            aria-label="Printed page"
          />
        </label>
        <span className="mono-label text-faint">pdf {pdfPage}</span>
        {calibrate && (
          <span className="flex items-center gap-1.5">
            <button className="btn px-2 py-1" onClick={() => calibrate.onNudge(-1)} aria-label="Offset −1">−</button>
            <span className="chip border-warn/40 text-warn">offset {calibrate.offset >= 0 ? '+' : ''}{calibrate.offset}</span>
            <button className="btn px-2 py-1" onClick={() => calibrate.onNudge(1)} aria-label="Offset +1">+</button>
            <button className="btn btn-accent px-2 py-1" onClick={calibrate.onSave} disabled={calibrate.saving}>
              {calibrate.saving ? 'saving…' : 'save offset'}
            </button>
          </span>
        )}
        <button className="btn ml-auto px-3 py-1" onClick={onClose}>
          close
        </button>
      </div>
      <iframe
        key={src}
        src={src}
        title={`${code} p.${page}`}
        className="min-h-0 w-full flex-1 rounded-md border border-edge bg-deck"
      />
    </div>
  );
}

export interface RefChipProps {
  /** `ref` is reserved in React — hence refValue. */
  refValue: Ref;
  className?: string;
}

/** `{ book, page }` → tappable chip → viewer overlay (FR11.3). */
export function RefChip({ refValue, className }: RefChipProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`chip cursor-pointer border-cyan-dim/60 text-cyan hover:border-cyan ${className ?? ''}`}
        onClick={() => setOpen(true)}
        title={refValue.note ?? `Open ${refValue.book} p.${refValue.page}`}
      >
        {refValue.book} p.{refValue.page}
      </button>
      {open && (
        <BookViewerOverlay code={refValue.book} printedPage={refValue.page} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** Autolink freetext (FR11.4): `SR5 p.426` inside prose becomes a RefChip. */
export function RefText({ text }: { text: string }) {
  const matches = findFreetextRefs(text);
  if (matches.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) parts.push(text.slice(cursor, m.start));
    parts.push(<RefChip key={`${m.ref.book}-${m.ref.page}-${i}`} refValue={m.ref} />);
    cursor = m.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/** Plain link form for contexts that want navigation over an overlay. */
export function refLink(ref: Ref): string {
  return viewerHref(ref);
}
