/**
 * M11 pure units: ref parsing (FR11.2/11.4), filename→code guessing (FR11.7),
 * the printed⇄PDF offset math (FR11.1), Range header parsing (FR11.3) and the
 * seed CLI flag parser. No db, no PDFs — fast.
 */
import { describe, expect, it } from 'vitest';
import {
  findRefs,
  guessBookFromFilename,
  parseRangeHeader,
  parseRef,
  pdfToPrintedPage,
  printedToPdfPage,
} from '../src/services/books.js';
import { parseArgs } from '../scripts/seed-books.js';

describe('parseRef (FR11.2)', () => {
  it('parses the canonical freetext form', () => {
    expect(parseRef('SR5 p.426')).toEqual({ book: 'SR5', page: 426 });
  });

  it('tolerates spacing, commas and long-form page words', () => {
    expect(parseRef('RG p 12')).toEqual({ book: 'RG', page: 12 });
    expect(parseRef('DT page 60')).toEqual({ book: 'DT', page: 60 });
    expect(parseRef('  CF, pg. 7 ')).toEqual({ book: 'CF', page: 7 });
    expect(parseRef('sr5 pp.180')).toEqual({ book: 'SR5', page: 180 });
  });

  it('rejects non-refs', () => {
    expect(parseRef('just some prose')).toBeNull();
    expect(parseRef('SR5 426')).toBeNull();
    expect(parseRef('SR5 p.0')).toBeNull();
  });
});

describe('findRefs (FR11.4 autolinking)', () => {
  it('finds every ref in a blob of codex markdown', () => {
    const md = 'Called shots (SR5 p.195) and grenade scatter (RG p.62) came up again.';
    const found = findRefs(md);
    expect(found.map((r) => `${r.book}:${r.page}`)).toEqual(['SR5:195', 'RG:62']);
    expect(md.slice(found[0]!.index, found[0]!.index + found[0]!.match.length)).toBe('SR5 p.195');
  });

  it('returns nothing for text with no refs', () => {
    expect(findRefs('the team took the freight elevator')).toEqual([]);
  });
});

describe('guessBookFromFilename (FR11.7)', () => {
  it('knows the core rulebook and its measured +5 offset', () => {
    const g = guessBookFromFilename('shadowrunfiftheditioncorerulebook_V2.pdf');
    expect(g.code).toBe('SR5');
    expect(g.offset).toBe(5);
  });

  it('maps the rest of the library to short codes at offset 0', () => {
    const expected: Record<string, string> = {
      'runandgun.pdf': 'RG',
      'streetgrimoire.pdf': 'SG',
      'datatrails.pdf': 'DT',
      'chromeflesh.pdf': 'CF',
      'rigger5.pdf': 'R5',
      'killcode.pdf': 'KC',
      'runfaster.pdf': 'RF',
      'howlingshadows.pdf': 'HS',
      'streetlethal.pdf': 'SL',
      'forbiddenarcana.pdf': 'FA',
      'darkterrors.pdf': 'DKT',
      'stolensouls.pdf': 'SS',
      'marketpanic.pdf': 'MP',
      'serratededge.pdf': 'SE',
      'completetrog.pdf': 'CT',
      'seattlesprawl.pdf': 'SEA',
    };
    for (const [file, code] of Object.entries(expected)) {
      const g = guessBookFromFilename(file);
      expect(g.code, file).toBe(code);
      expect(g.offset, file).toBe(0);
    }
  });

  it('falls back to a stem-derived code for unknown files', () => {
    const g = guessBookFromFilename('some-third-party-supplement.pdf');
    expect(g.offset).toBe(0);
    expect(g.code).toMatch(/^[A-Z0-9]{1,6}$/);
    expect(g.title).toBe('some-third-party-supplement');
  });
});

describe('offset math (FR11.1)', () => {
  it('resolves the measured SR5 pair: printed 426 → PDF 431', () => {
    expect(printedToPdfPage(426, 5)).toBe(431);
    expect(pdfToPrintedPage(431, 5)).toBe(426);
  });

  it('treats front matter as printed < 1', () => {
    expect(pdfToPrintedPage(3, 5)).toBeLessThan(1);
    expect(pdfToPrintedPage(6, 5)).toBe(1);
  });

  it('is an identity at offset 0', () => {
    expect(printedToPdfPage(62, 0)).toBe(62);
  });
});

describe('parseRangeHeader (FR11.3)', () => {
  const size = 1000;

  it('returns null when there is no usable Range header', () => {
    expect(parseRangeHeader(undefined, size)).toBeNull();
    expect(parseRangeHeader('bytes=0-99, 200-299', size)).toBeNull(); // multi-range
    expect(parseRangeHeader('pages=1-2', size)).toBeNull();
    expect(parseRangeHeader('bytes=-', size)).toBeNull();
  });

  it('parses closed, open and suffix ranges', () => {
    expect(parseRangeHeader('bytes=0-99', size)).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader('bytes=500-', size)).toEqual({ start: 500, end: 999 });
    expect(parseRangeHeader('bytes=-100', size)).toEqual({ start: 900, end: 999 });
  });

  it('clamps an over-long end to the last byte', () => {
    expect(parseRangeHeader('bytes=990-5000', size)).toEqual({ start: 990, end: 999 });
  });

  it('flags unsatisfiable ranges (→ 416)', () => {
    expect(parseRangeHeader('bytes=1000-1100', size)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=-0', size)).toBe('unsatisfiable');
  });
});

describe('seed:books CLI flags (FR11.7)', () => {
  it('defaults to books/ under the repo root (or the root itself) with no limits', () => {
    const cli = parseArgs([], {});
    expect(cli.only).toBeUndefined();
    expect(cli.maxPages).toBeUndefined();
    expect(cli.list).toBe(false);
    expect(cli.dir.length).toBeGreaterThan(0);
    expect(cli.dirFrom).toBe('default');
  });

  it('reads BOOKS_DIR from the environment — the line .env ships — before falling back', () => {
    expect(parseArgs([], { BOOKS_DIR: 'D:/books' })).toMatchObject({ dir: 'D:/books', dirFrom: 'env' });
    expect(parseArgs([], { SAFEHOUSE_BOOKS_DIR: 'E:/pdfs' })).toMatchObject({ dir: 'E:/pdfs', dirFrom: 'env' });
    // --dir wins over the environment.
    expect(parseArgs(['--dir', 'F:/x'], { BOOKS_DIR: 'D:/books' })).toMatchObject({ dir: 'F:/x', dirFrom: 'flag' });
  });

  it('takes --dir=path and ignores the bare -- pnpm forwards', () => {
    expect(parseArgs(['--dir=D:/my books', '--max-pages=3'], {})).toMatchObject({ dir: 'D:/my books', maxPages: 3 });
    expect(parseArgs(['--', '--dir', 'D:/books', '--list'], {})).toMatchObject({ dir: 'D:/books', list: true });
  });

  it('parses --only (upper-cased) and --max-pages', () => {
    const cli = parseArgs(['--only', 'sr5', '--max-pages', '40', '--dir', 'D:/books']);
    expect(cli.only).toBe('SR5');
    expect(cli.maxPages).toBe(40);
    expect(cli.dir).toBe('D:/books');
  });

  it('rejects bad flags and bad page counts', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown flag/);
    expect(() => parseArgs(['--max-pages', 'lots'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--only'])).toThrow(/needs a value/);
  });
});
