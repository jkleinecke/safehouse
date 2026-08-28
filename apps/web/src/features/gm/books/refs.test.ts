import { describe, expect, it } from 'vitest';
import {
  bookFileHref,
  findFreetextRefs,
  parseFreetextRef,
  pdfToPrinted,
  printedToPdf,
  viewerHref,
} from './refs.js';

describe('printed↔pdf page math (FR11.1)', () => {
  it('applies the offset both ways (core book +5)', () => {
    expect(printedToPdf(426, 5)).toBe(431);
    expect(pdfToPrinted(431, 5)).toBe(426);
  });

  it('handles negative offsets and clamps to page 1', () => {
    expect(printedToPdf(3, -2)).toBe(1);
    expect(printedToPdf(1, -10)).toBe(1);
    expect(pdfToPrinted(1, 5)).toBe(1);
  });
});

describe('freetext ref parsing (FR11.4)', () => {
  it('parses the canonical form', () => {
    expect(parseFreetextRef('see SR5 p.426 for ranges')).toEqual({ book: 'SR5', page: 426 });
  });

  it('parses variants: pg, page, comma, no dot', () => {
    expect(parseFreetextRef('RG pg 105')).toEqual({ book: 'RG', page: 105 });
    expect(parseFreetextRef('SG, page 12')).toEqual({ book: 'SG', page: 12 });
    expect(parseFreetextRef('KC p. 55')).toEqual({ book: 'KC', page: 55 });
  });

  it('finds multiple refs with correct spans', () => {
    const text = 'grenades SR5 p.181, scatter RG p.105';
    const found = findFreetextRefs(text);
    expect(found).toHaveLength(2);
    expect(found[0]?.ref).toEqual({ book: 'SR5', page: 181 });
    expect(found[1]?.ref).toEqual({ book: 'RG', page: 105 });
    expect(text.slice(found[0]!.start, found[0]!.end)).toBe('SR5 p.181');
  });

  it('returns null on plain text', () => {
    expect(parseFreetextRef('no refs here')).toBeNull();
    expect(parseFreetextRef('lowercase p.12 is not a code')).toBeNull();
  });
});

describe('viewer links', () => {
  it('builds the /read route with printed page', () => {
    expect(viewerHref({ book: 'SR5', page: 426 })).toBe('/read/SR5?p=426');
  });

  it('builds the native-PDF file fallback with token and page anchor', () => {
    expect(bookFileHref('SR5', 431, 'tok')).toBe('/files/books/SR5?token=tok#page=431');
    expect(bookFileHref('SR5', 431)).toBe('/files/books/SR5#page=431');
  });
});
