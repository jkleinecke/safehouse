/**
 * The documented fallback (§13, "Browser-native viewer via `#page=` — kept as
 * fallback; inconsistent on mobile").
 *
 * It is genuinely useful on a desktop — the OS viewer has text selection,
 * search and printing we do not — and it is the safety net when pdf.js cannot
 * start on a device. It is *not* the default, and the reason is the whole point
 * of this feature: iOS Safari and most Android browsers hand a PDF to a plugin
 * that ignores the `#page=` fragment, so a ref chip lands the player on page 1
 * of a 500-page book and the promise "one tap opens the printed page" quietly
 * becomes desktop-only.
 *
 * An `<iframe>` cannot set an `Authorization` header, so this path — and only
 * this path — passes the device token in the query string, exactly as
 * `/files/books/:code` already accepts it.
 */
import { nativeBookHref } from './mode.js';

export interface NativeBookFrameProps {
  code: string;
  /** 1-based page inside the file (offset already applied). */
  pdfPage: number;
  /** Printed page, for the frame title. */
  printedPage: number;
  token?: string | null;
}

export default function NativeBookFrame({
  code,
  pdfPage,
  printedPage,
  token,
}: NativeBookFrameProps) {
  const src = nativeBookHref(code, pdfPage, token);
  return (
    <iframe
      // Remounting on page change is deliberate: a fragment-only change does
      // not re-navigate an already-loaded PDF plugin.
      key={src}
      src={src}
      title={`${code} p.${printedPage}`}
      className="h-full w-full border-0 bg-deck"
      data-testid="native-book-frame"
    />
  );
}
