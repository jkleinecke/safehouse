/**
 * The book, opened over whatever the table was already looking at (FR11.3:
 * "tapping opens the book right there … without losing table context").
 *
 * This IS the overlay the ref chips open: `features/gm/books/RefChip.tsx`
 * re-exports it under its historical name `BookViewerOverlay`, so every chip in
 * the app — sheet, codex, generator, log — reaches pdf.js and gets a printed
 * page that actually opens on a phone. Props are unchanged from the iframe
 * version it replaced, calibration included (FR11.1).
 */
import { useEffect } from 'react';
import ReaderCore from './ReaderCore.js';
import type { ReaderCalibration } from './ReaderShell.js';

export interface BookReaderOverlayProps {
  code: string;
  printedPage: number;
  onClose: () => void;
  /** Calibration mode (FR11.1): nudge the offset until the page matches. */
  calibrate?: ReaderCalibration;
}

export default function BookReaderOverlay({
  code,
  printedPage,
  onClose,
  calibrate,
}: BookReaderOverlayProps) {
  // Escape closes it — the reader is a detour, never a destination.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-ground/95 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label={`${code} p.${printedPage}`}
    >
      <ReaderCore
        code={code}
        printedPage={printedPage}
        onClose={onClose}
        closeLabel="close"
        calibrate={calibrate}
        rememberMode
      />
    </div>
  );
}
