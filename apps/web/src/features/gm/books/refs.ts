/**
 * Pure ref helpers (M11): printed↔PDF page math (FR11.1) and freetext ref
 * parsing (`SR5 p.426` → { book, page }, FR11.4). No DOM.
 */
import type { Ref } from '@safehouse/contracts';

/** Printed page + offset = PDF page (FR11.1; core book offset is +5). */
export function printedToPdf(printed: number, offset: number): number {
  return Math.max(1, Math.round(printed) + Math.round(offset));
}

/** Inverse mapping for the calibration stepper. */
export function pdfToPrinted(pdf: number, offset: number): number {
  return Math.max(1, Math.round(pdf) - Math.round(offset));
}

/**
 * Freetext ref pattern (FR11.4): `SR5 p.426`, `RG pg 105`, `SG, page 12`,
 * `KC p12`. Book codes are 2–12 chars, uppercase-led alphanumerics.
 */
export const REF_PATTERN = /\b([A-Z][A-Z0-9]{1,11})\s*,?\s+?p(?:g|age)?\.?\s*(\d{1,4})\b/g;

export interface FreetextRefMatch {
  ref: Ref;
  /** Index range of the match in the source string. */
  start: number;
  end: number;
  /** The exact matched text, e.g. 'SR5 p.426'. */
  text: string;
}

/** All `CODE p.N`-style refs in a text, in order. */
export function findFreetextRefs(text: string): FreetextRefMatch[] {
  const out: FreetextRefMatch[] = [];
  const re = new RegExp(REF_PATTERN.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const book = m[1];
    const page = m[2];
    if (!book || !page) continue;
    out.push({
      ref: { book, page: Number.parseInt(page, 10) },
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
    });
  }
  return out;
}

/** Parse a single freetext ref, or null when the text holds none. */
export function parseFreetextRef(text: string): Ref | null {
  return findFreetextRefs(text)[0]?.ref ?? null;
}

/** Route to the in-app viewer page at a printed page (`?p=` per conventions). */
export function viewerHref(ref: Pick<Ref, 'book' | 'page'>): string {
  return `/read/${encodeURIComponent(ref.book)}?p=${ref.page}`;
}

/**
 * Direct file URL (FR11.3): the browser's native PDF viewer, opened at the
 * mapped page. `/files/books/:code` streams by byte range, so a phone opening
 * one page does not pull the whole book; `?token=` carries auth because an
 * iframe cannot send an Authorization header.
 */
export function bookFileHref(code: string, pdfPage: number, token?: string | null): string {
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `/files/books/${encodeURIComponent(code)}${q}#page=${Math.max(1, pdfPage)}`;
}
