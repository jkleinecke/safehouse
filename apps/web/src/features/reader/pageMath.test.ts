import { describe, expect, it } from 'vitest';
import {
  clampPage,
  describeMapping,
  formatOffset,
  parsePrintedParam,
  pdfToPrintedPage,
  printedToPdfPage,
  resolvePdfPage,
  stepPrinted,
} from './pageMath.js';

describe('printed → pdf page (FR11.1)', () => {
  it('maps the core rulebook at its measured +5 offset', () => {
    // The offset the spec names: SR5 printed p.426 is the 431st page of the file.
    expect(printedToPdfPage(426, 5)).toBe(431);
  });

  it('maps the front of the core rulebook', () => {
    expect(printedToPdfPage(1, 5)).toBe(6);
  });

  it('is the identity at offset 0', () => {
    expect(printedToPdfPage(42, 0)).toBe(42);
  });

  it('handles a negative offset without falling off the front of the file', () => {
    expect(printedToPdfPage(10, -3)).toBe(7);
    expect(printedToPdfPage(1, -9)).toBe(1);
  });

  it('round-trips through the inverse', () => {
    for (const printed of [1, 42, 174, 426, 1093]) {
      expect(pdfToPrintedPage(printedToPdfPage(printed, 5), 5)).toBe(printed);
    }
  });
});

describe('clampPage', () => {
  it('floors at page 1', () => {
    expect(clampPage(0)).toBe(1);
    expect(clampPage(-7)).toBe(1);
    expect(clampPage(Number.NaN)).toBe(1);
  });

  it('ceilings at the document page count when one is known', () => {
    expect(clampPage(900, 494)).toBe(494);
    expect(clampPage(12, 494)).toBe(12);
  });

  it('has no ceiling before the document is open', () => {
    expect(clampPage(9000)).toBe(9000);
    expect(clampPage(9000, 0)).toBe(9000);
  });
});

describe('resolvePdfPage', () => {
  it('resolves SR5 p.426 to pdf 431 with its provenance', () => {
    expect(resolvePdfPage(426, 5, 494)).toEqual({
      printed: 426,
      pdf: 431,
      offset: 5,
      clamped: false,
    });
  });

  it('lands on the last page instead of erroring past the end, and says so', () => {
    const map = resolvePdfPage(600, 5, 494);
    expect(map.pdf).toBe(494);
    expect(map.clamped).toBe(true);
    // The jump box follows the clamp back into printed numbering.
    expect(map.printed).toBe(489);
  });

  it('does not clamp before pdf.js has reported a page count', () => {
    expect(resolvePdfPage(600, 5).clamped).toBe(false);
    expect(resolvePdfPage(600, 5).pdf).toBe(605);
  });
});

describe('stepPrinted', () => {
  it('steps one sheet of paper at a time', () => {
    expect(stepPrinted(426, 1, 5, 494)).toBe(427);
    expect(stepPrinted(426, -1, 5, 494)).toBe(425);
  });

  it('stops at the covers rather than running off either end', () => {
    // printed 1 is pdf 6; stepping back 10 hits pdf 1, i.e. printed −4 → 1.
    expect(stepPrinted(1, -10, 5, 494)).toBe(1);
    expect(stepPrinted(489, 5, 5, 494)).toBe(489);
  });
});

describe('parsePrintedParam', () => {
  it('accepts a positive integer', () => {
    expect(parsePrintedParam('426')).toBe(426);
    expect(parsePrintedParam(' 426 ')).toBe(426);
  });

  it('rejects everything that is not a printed page', () => {
    for (const bad of [null, undefined, '', '0', '-3', '4.5', 'abc', '426abc', '999999']) {
      expect(parsePrintedParam(bad)).toBeNull();
    }
  });
});

describe('provenance strings (Principle 3)', () => {
  it('signs the offset', () => {
    expect(formatOffset(5)).toBe('+5');
    expect(formatOffset(-2)).toBe('−2');
    expect(formatOffset(0)).toBe('0');
  });

  it('explains where the displayed page came from', () => {
    expect(describeMapping(resolvePdfPage(426, 5, 494), 494)).toBe(
      'printed 426 · pdf 431 of 494 · offset +5',
    );
  });
});
