/**
 * Ref chips (M11, FR11.3/FR11.4): a `{ book, page }` ref renders as a tappable
 * chip; tapping opens the book right there, over whatever the table was already
 * looking at, without losing context.
 *
 * The overlay itself is `features/reader`'s pdf.js viewer. It used to be an
 * `<iframe>` around the browser's own PDF plugin with a `#page=` fragment — the
 * fragment mobile browsers ignore, which is what made "one tap opens the printed
 * page" a desktop-only promise. The name `BookViewerOverlay` is kept because
 * every ref surface in the app imports it; the props are unchanged, calibration
 * included, and the browser-native viewer survives inside it as the documented
 * fallback (`?native=1`, or automatically when pdf.js cannot start).
 */
import { useState, type ReactNode } from 'react';
import type { Ref } from '@safehouse/contracts';
import { BookReaderOverlay } from '../../reader/index.js';
import type { BookReaderOverlayProps } from '../../reader/index.js';
import { findFreetextRefs, viewerHref } from './refs.js';

export type BookViewerOverlayProps = BookReaderOverlayProps;

/** Full-screen overlay: printed-page controls → the self-hosted pdf.js viewer. */
export const BookViewerOverlay = BookReaderOverlay;

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
