/**
 * Printed ↔ PDF page arithmetic for the in-app reader (FR11.1/FR11.3).
 *
 * A book's `pageOffset` is `pdfPage − printedPage`: front matter shifts the
 * numbering, so the core rulebook's offset is +5 and printed 426 is the 431st
 * page of the file. The server resolves the mapping for us (`GET /read/:code`)
 * — this module is the client's half: it keeps the stepper, the jump box and
 * the `?p=` query in the *printed* numbering the table speaks, clamps against
 * the document's real page count once pdf.js has opened it, and carries the
 * provenance line the viewer prints under the page ("printed 426 · pdf 431 ·
 * offset +5", Principle 3).
 *
 * Pure — no DOM, no pdf.js, no network. The viewer's whole numbering story is
 * testable without either.
 */

/** One resolved page position, with everything the toolbar needs to explain it. */
export interface PageMapping {
  /** Printed page number as it appears on the paper page. */
  printed: number;
  /** 1-based page index inside the PDF file. */
  pdf: number;
  /** `pdf − printed` for this book. */
  offset: number;
  /** True when `pdf` was pulled back inside `[1, pageCount]`. */
  clamped: boolean;
}

/** Printed page + offset = PDF page (FR11.1; the core book's offset is +5). */
export function printedToPdfPage(printed: number, offset: number): number {
  return Math.max(1, Math.round(printed) + Math.round(offset));
}

/** Inverse mapping — what the reader shows in the jump box for a PDF page. */
export function pdfToPrintedPage(pdf: number, offset: number): number {
  return Math.max(1, Math.round(pdf) - Math.round(offset));
}

/** Pull `page` inside `[1, max]`; `max` unknown (undefined/0) means no ceiling. */
export function clampPage(page: number, max?: number): number {
  const floored = Math.max(1, Math.round(page) || 1);
  if (!max || max < 1) return floored;
  return Math.min(floored, Math.round(max));
}

/**
 * Resolve a printed page against a book's offset and (once known) the file's
 * real page count. Asking for a printed page past the end of the book lands on
 * the last page rather than on a render error, and says so via `clamped`.
 */
export function resolvePdfPage(printed: number, offset: number, pageCount?: number): PageMapping {
  const wanted = printedToPdfPage(printed, offset);
  const pdf = clampPage(wanted, pageCount);
  const norm = Math.round(offset);
  return {
    printed: pdf === wanted ? Math.max(1, Math.round(printed)) : pdfToPrintedPage(pdf, norm),
    pdf,
    offset: norm,
    clamped: pdf !== wanted,
  };
}

/**
 * Step by whole *PDF* pages and report the printed number to show. Stepping is
 * done in PDF space because that is where "the next sheet of paper" lives —
 * printed numbering can restart or skip, the file's never does.
 */
export function stepPrinted(printed: number, delta: number, offset: number, pageCount?: number): number {
  const from = printedToPdfPage(printed, offset);
  const next = clampPage(from + Math.round(delta), pageCount);
  return pdfToPrintedPage(next, offset);
}

/**
 * Parse the `?p=` query (or the jump box) into a printed page. Anything that is
 * not a positive integer is `null` so the caller can keep the page it has
 * rather than jumping to a garbage one.
 */
export function parsePrintedParam(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** `+5` / `−2` / `0` — the offset as the toolbar prints it (Principle 3). */
export function formatOffset(offset: number): string {
  const n = Math.round(offset);
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/** The one-line provenance the reader shows under the page. */
export function describeMapping(map: PageMapping, pageCount?: number): string {
  const tail = pageCount ? ` of ${pageCount}` : '';
  return `printed ${map.printed} · pdf ${map.pdf}${tail} · offset ${formatOffset(map.offset)}`;
}
