/**
 * Automatic page-offset detection (FR11.1).
 *
 * Three layers:
 *  1. Pure units — candidate extraction, sampling, voting, proposals. No I/O.
 *  2. The real library — the 17 PDFs sit next to DESIGN.md and are the GM's own
 *     property (§14), gitignored, so every PDF-backed test SKIPS when absent.
 *     SR5's +5 was measured by hand (printed 426 = PDF 431); detection has to
 *     recover it, and has to find the offsets nobody measured by hand.
 *  3. The seed path — `--calibrate` writes what it is confident about and never
 *     overwrites a human's calibration without `--recalibrate`.
 *
 * Page text never leaves this machine: the assertions below are about page
 * *numbers* and offsets, never about book prose.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { books } from '@safehouse/db';
import {
  buildOffsetProposal,
  detectOffset,
  detectOffsetFromDb,
  detectOffsetFromPdf,
  extractPdfPageText,
  openPdf,
  pageNumberCandidates,
  planOffsetSample,
  type OffsetDetection,
  type PageSample,
} from '../src/services/book-offsets.js';
import { seedBooks, type SeedBookResult } from '../src/services/books.js';
import { calibrationTable, parseArgs } from '../scripts/seed-books.js';
import { bootstrapCampaign, joinAs, makeTestApp, type TestApp } from './core-helpers.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The rulebook corpus moved from the repo root into `books/`. These tests skip
 * gracefully when a PDF is absent, so a stale path would not fail — it would
 * quietly stop testing, which is worse. Prefer `books/`, fall back to the root.
 */
const BOOKS_DIR = existsSync(`${REPO_ROOT}books`) ? `${REPO_ROOT}books/` : REPO_ROOT;
function booksPath(name: string): string {
  return `${BOOKS_DIR}${name}`;
}
const CORE_PDF = booksPath('shadowrunfiftheditioncorerulebook_V2.pdf');
/** Rigger 5.0 — seeded at +0, actually +1. The bug this feature exists for. */
const RIGGER_PDF = `${REPO_ROOT}rigger5.pdf`;
const RUN_AND_GUN_PDF = `${REPO_ROOT}runandgun.pdf`;

// ---------------------------------------------------------------------------
// 1. Pure units
// ---------------------------------------------------------------------------

describe('pageNumberCandidates', () => {
  it('takes the last number on the page first — that is where a footer sits', () => {
    expect(pageNumberCandidates('a paragraph of prose\n104')[0]).toBe(104);
  });

  it('ignores thousands separators, decimals and cross-references', () => {
    expect(pageNumberCandidates('costs 1,000 and rolls 2.5 dice 96')).toEqual([96]);
    expect(pageNumberCandidates('as noted in SR5 p.195 42')).toEqual([42]);
  });

  it('ignores zero-padded stat blocks', () => {
    expect(pageNumberCandidates('handling 008 99')).toEqual([99]);
  });

  it('reads the running header too, after the footer', () => {
    const found = pageNumberCandidates(`61 a header\n${'x'.repeat(400)}\nsome prose 61`);
    expect(found).toContain(61);
  });

  it('finds nothing on a page with no numerals', () => {
    expect(pageNumberCandidates('nothing here but words')).toEqual([]);
  });
});

describe('planOffsetSample', () => {
  const range = (from: number, to: number): number[] =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

  it('has nothing to sample when the book has no pages', () => {
    expect(planOffsetSample([])).toEqual({ sample: [], skippedFront: 0, skippedBack: 0 });
  });

  it('trims front and back matter — a TOC is all page numbers, and none are its own', () => {
    const plan = planOffsetSample(range(1, 100));
    expect(plan.skippedFront).toBe(8);
    expect(plan.skippedBack).toBe(8);
    expect(plan.sample[0]).toBe(9);
    expect(plan.sample[plan.sample.length - 1]!).toBe(92);
  });

  it('caps the trim so a 500-page book is not sampled 40 pages from each end only', () => {
    const plan = planOffsetSample(range(1, 1000));
    expect(plan.skippedFront).toBe(40);
    expect(plan.sample[0]).toBe(41);
    expect(plan.sample[plan.sample.length - 1]!).toBe(960);
  });

  it('spreads a bounded sample through the body instead of reading every page', () => {
    const plan = planOffsetSample(range(1, 1000));
    expect(plan.sample.length).toBeLessThanOrEqual(48);
    expect(plan.sample.length).toBeGreaterThan(40);
    expect([...plan.sample].sort((a, b) => a - b)).toEqual(plan.sample);
  });

  it('keeps every page when there is barely a body to window', () => {
    const plan = planOffsetSample(range(1, 10));
    expect(plan.sample).toEqual(range(1, 10));
    expect(plan.skippedFront).toBe(0);
    expect(plan.skippedBack).toBe(0);
  });

  it('sorts and de-duplicates whatever it is handed', () => {
    expect(planOffsetSample([5, 3, 3, 1]).sample).toEqual([1, 3, 5]);
  });
});

/** `count` body pages whose text ends in their own printed number. */
function numberedPages(count: number, offset: number, from = 20): PageSample[] {
  return Array.from({ length: count }, (_, i) => ({
    pdfPage: from + i,
    text: `a page of prose\n${from + i - offset}`,
  }));
}

describe('detectOffset', () => {
  it('measures the offset every page agrees on', () => {
    const d = detectOffset(numberedPages(40, 5));
    expect(d.offset).toBe(5);
    expect(d.confidence).toBe(1);
    expect(d.agreed).toBe(40);
    expect(d.withText).toBe(40);
    expect(d.evidence[0]).toEqual({ pdfPage: 20, printedPage: 15 });
    expect(d.reason).toBeUndefined();
  });

  it('handles the identity case — a PDF with no front matter at all', () => {
    expect(detectOffset(numberedPages(30, 0)).offset).toBe(0);
  });

  it('refuses to guess when nothing was sampled', () => {
    const d = detectOffset([]);
    expect(d.offset).toBeNull();
    expect(d.reason).toBe('no-pages');
  });

  it('refuses to guess on an image-only scan, and says how many pages held no text', () => {
    const blank = Array.from({ length: 20 }, (_, i) => ({ pdfPage: 20 + i, text: '' }));
    const d = detectOffset(blank);
    expect(d.offset).toBeNull();
    expect(d.reason).toBe('no-page-numbers');
    expect(d.withText).toBe(0);
    expect(d.skipped.noText).toBe(20);
  });

  it('refuses to guess when pages carry text but no numbers', () => {
    const wordy = Array.from({ length: 20 }, (_, i) => ({
      pdfPage: 20 + i,
      text: 'prose with no numerals whatsoever',
    }));
    const d = detectOffset(wordy);
    expect(d.offset).toBeNull();
    expect(d.reason).toBe('no-page-numbers');
    expect(d.skipped.noNumber).toBe(20);
  });

  it('reports low confidence rather than a guess when numbering is sparse', () => {
    const sparse = Array.from({ length: 40 }, (_, i) => ({
      pdfPage: 20 + i,
      text: i % 10 === 0 ? `prose\n${20 + i - 5}` : 'prose with no numerals whatsoever',
    }));
    const d = detectOffset(sparse);
    expect(d.offset).toBeNull();
    expect(d.reason).toBe('low-agreement');
    // The evidence is still surfaced: it leaned +5, on 4 of 40 pages.
    expect(d.leader).toEqual({ offset: 5, agreed: 4 });
    expect(d.confidence).toBeCloseTo(0.1, 5);
  });

  it('calls a split vote ambiguous instead of picking the prettier number', () => {
    const spreads = Array.from({ length: 40 }, (_, i) => ({
      pdfPage: 20 + i,
      text: `left ${20 + i - 6} and right ${20 + i - 5}`,
    }));
    const d = detectOffset(spreads);
    expect(d.offset).toBeNull();
    expect(d.reason).toBe('ambiguous');
    expect(d.runnerUp).not.toBeNull();
    expect(d.agreed).toBe(d.runnerUp!.agreed);
  });

  it('shrugs off noise pages that hold numbers but not their own', () => {
    const samples = numberedPages(40, 5);
    // Five pages are stat tables whose trailing number is not a page number.
    for (const i of [3, 9, 14, 25, 31]) samples[i] = { pdfPage: 20 + i, text: 'table row 12' };
    const d = detectOffset(samples);
    expect(d.offset).toBe(5);
    expect(d.agreed).toBe(35);
    expect(d.confidence).toBeCloseTo(35 / 40, 5);
  });

  it('reports what the sample deliberately skipped', () => {
    const d = detectOffset(numberedPages(40, 5), { skippedFront: 12, skippedBack: 9 });
    expect(d.skipped.frontMatter).toBe(12);
    expect(d.skipped.backMatter).toBe(9);
  });
});

describe('buildOffsetProposal', () => {
  const detection = (over: Partial<OffsetDetection> = {}): OffsetDetection => ({
    offset: 1,
    confidence: 0.95,
    agreed: 38,
    sampled: 40,
    withText: 40,
    numbered: 39,
    leader: { offset: 1, agreed: 38 },
    runnerUp: null,
    evidence: [{ pdfPage: 18, printedPage: 17 }],
    skipped: { frontMatter: 4, backMatter: 4, noText: 0, noNumber: 1 },
    ...over,
  });

  it('proposes a change when the stored offset is still the seeded guess', () => {
    const p = buildOffsetProposal(detection(), { currentOffset: 0, seededOffset: 0 });
    expect(p.status).toBe('apply');
    expect(p.wouldChange).toBe(true);
    expect(p.humanSet).toBe(false);
    expect(p.proposedOffset).toBe(1);
    expect(p.message).toContain('+0 → +1');
    expect(p.message).toContain('printed 17 on PDF page 18');
  });

  it('refuses to overwrite an offset a human already set', () => {
    const p = buildOffsetProposal(detection(), { currentOffset: 3, seededOffset: 0 });
    expect(p.status).toBe('human-set');
    expect(p.humanSet).toBe(true);
    expect(p.proposedOffset).toBe(1);
    expect(p.message).toMatch(/set by hand/);
  });

  it('says nothing to do when the stored offset is already right', () => {
    const p = buildOffsetProposal(detection({ offset: 5 }), {
      currentOffset: 5,
      seededOffset: 5,
    });
    expect(p.status).toBe('unchanged');
    expect(p.wouldChange).toBe(false);
    expect(p.message).toContain('+5 confirmed');
  });

  it('does not call an offset human-set when nobody said what was seeded', () => {
    const p = buildOffsetProposal(detection(), { currentOffset: 3 });
    expect(p.humanSet).toBe(false);
    expect(p.status).toBe('apply');
  });

  it('reports low confidence and keeps the current offset', () => {
    const p = buildOffsetProposal(
      detection({ offset: null, reason: 'low-agreement', agreed: 4, confidence: 0.1 }),
      { currentOffset: 0, seededOffset: 0 },
    );
    expect(p.status).toBe('low-confidence');
    expect(p.proposedOffset).toBeNull();
    expect(p.wouldChange).toBe(false);
    expect(p.message).toContain('keeping +0');
  });

  it('names a split vote in the message so the GM knows it was close', () => {
    const p = buildOffsetProposal(
      detection({
        offset: null,
        reason: 'ambiguous',
        leader: { offset: 1, agreed: 20 },
        runnerUp: { offset: 2, agreed: 19 },
      }),
      { currentOffset: 0, seededOffset: 0 },
    );
    expect(p.status).toBe('low-confidence');
    expect(p.message).toContain('20 pages say +1');
    expect(p.message).toContain('19 say +2');
  });

  it('says there was nothing to measure when no page carried a number', () => {
    const p = buildOffsetProposal(
      detection({ offset: null, reason: 'no-page-numbers', withText: 0, agreed: 0 }),
      { currentOffset: 0, seededOffset: 0 },
    );
    expect(p.status).toBe('undetected');
    expect(p.message).toContain('no printed page numbers');
  });
});

describe('seed:books calibration flags', () => {
  it('is off by default — a plain seed never moves an offset', () => {
    const cli = parseArgs([]);
    expect(cli.calibrate).toBe(false);
    expect(cli.recalibrate).toBe(false);
  });

  it('--calibrate turns measurement on but leaves human-set offsets alone', () => {
    const cli = parseArgs(['--calibrate']);
    expect(cli.calibrate).toBe(true);
    expect(cli.recalibrate).toBe(false);
  });

  it('--recalibrate implies --calibrate', () => {
    const cli = parseArgs(['--recalibrate']);
    expect(cli.calibrate).toBe(true);
    expect(cli.recalibrate).toBe(true);
  });

  it('composes with the existing flags', () => {
    const cli = parseArgs(['--only', 'r5', '--max-pages', '40', '--calibrate']);
    expect(cli.only).toBe('R5');
    expect(cli.maxPages).toBe(40);
    expect(cli.calibrate).toBe(true);
  });

  it('drops the bare `--` pnpm forwards, so `pnpm seed:books -- --calibrate` means what it says', () => {
    expect(parseArgs(['--', '--calibrate']).calibrate).toBe(true);
  });
});

describe('calibrationTable (the --calibrate report)', () => {
  const result = (over: Partial<SeedBookResult> = {}): SeedBookResult => ({
    file: 'rigger5.pdf',
    code: 'R5',
    title: 'Rigger 5.0',
    offset: 1,
    bookId: 'b1',
    pagesInserted: 180,
    totalPdfPages: 194,
    ...over,
  });

  it('prints nothing at all when calibration did not run', () => {
    expect(calibrationTable([result()])).toEqual([]);
  });

  it('shows the offset, the confidence and what the sample ignored', () => {
    const rows = calibrationTable([
      result({
        calibration: {
          ...buildOffsetProposal(
            {
              offset: 1,
              confidence: 0.94,
              agreed: 45,
              sampled: 48,
              withText: 48,
              numbered: 46,
              leader: { offset: 1, agreed: 45 },
              runnerUp: null,
              evidence: [{ pdfPage: 19, printedPage: 18 }],
              skipped: { frontMatter: 14, backMatter: 14, noText: 0, noNumber: 2 },
            },
            { currentOffset: 0, seededOffset: 0 },
          ),
          applied: true,
        },
      }),
    ]);
    const body = rows.join('\n');
    expect(body).toContain('R5');
    expect(body).toContain('+1');
    expect(body).toContain('94%');
    expect(body).toContain('45/48');
    expect(body).toContain('14f/14b/0img/2n#');
    expect(body).toContain('applied');
    expect(body).not.toContain('--recalibrate');
  });

  it('points a GM at --recalibrate only when something was actually blocked', () => {
    const blocked = calibrationTable([
      result({
        calibration: {
          ...buildOffsetProposal(
            {
              offset: 1,
              confidence: 0.9,
              agreed: 43,
              sampled: 48,
              withText: 48,
              numbered: 44,
              leader: { offset: 1, agreed: 43 },
              runnerUp: null,
              evidence: [],
              skipped: { frontMatter: 4, backMatter: 4, noText: 0, noNumber: 4 },
            },
            { currentOffset: 7, seededOffset: 0 },
          ),
          applied: false,
        },
      }),
    ]);
    expect(blocked.join('\n')).toContain('--recalibrate');
  });
});

// ---------------------------------------------------------------------------
// 2. The real library
// ---------------------------------------------------------------------------

describe.skipIf(!existsSync(CORE_PDF))('detection against the core rulebook', () => {
  // The core book is 44 MB; read it once and assert against the one result.
  let core: OffsetDetection;
  beforeAll(async () => {
    core = await detectOffsetFromPdf(CORE_PDF);
  }, 300_000);

  it('recovers the hand-measured +5', () => {
    expect(core.offset).toBe(5);
    expect(core.confidence).toBeGreaterThan(0.8);
    expect(core.evidence.length).toBeGreaterThan(0);
    for (const e of core.evidence) expect(e.pdfPage - e.printedPage).toBe(5);
  });

  it('agrees with the ref chip the GM already trusts: printed 426 = PDF 431', () => {
    expect(426 + (core.offset ?? 0)).toBe(431);
  });

  it('finds no offset in a stretch of unnumbered back matter', async () => {
    // The last leaves of the core book are ads and blank endpapers. Detection
    // must say "I do not know" there rather than latch onto a stray numeral.
    const doc = await openPdf(CORE_PDF);
    try {
      const samples: PageSample[] = [];
      for (let p = doc.numPages - 6; p <= doc.numPages; p++) {
        samples.push({ pdfPage: p, text: await extractPdfPageText(doc, p) });
      }
      const d = detectOffset(samples);
      expect(d.offset).toBeNull();
      expect(d.reason === 'no-page-numbers' || d.reason === 'low-agreement').toBe(true);
    } finally {
      await doc.loadingTask.destroy();
    }
  }, 120_000);
});

describe.skipIf(!existsSync(RIGGER_PDF))('detection against a book nobody calibrated', () => {
  it('measures Rigger 5.0 at +1 — the seeded +0 opens every ref one page early', async () => {
    const d = await detectOffsetFromPdf(RIGGER_PDF);
    expect(d.offset).toBe(1);
    expect(d.confidence).toBeGreaterThan(0.8);
    for (const e of d.evidence) expect(e.pdfPage - e.printedPage).toBe(1);
  }, 120_000);
});

describe.skipIf(!existsSync(RUN_AND_GUN_PDF))('detection when the seeded guess is right', () => {
  it('confirms Run & Gun at +0 instead of inventing a shift', async () => {
    const d = await detectOffsetFromPdf(RUN_AND_GUN_PDF);
    expect(d.offset).toBe(0);
    expect(d.confidence).toBeGreaterThan(0.8);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 3. The seed path
// ---------------------------------------------------------------------------

/** Enough PDF pages for the db-source sample to land in the book's body. */
const MAX_PAGES = 40;

describe.skipIf(!existsSync(RIGGER_PDF))('seed:books --calibrate (FR11.1, FR11.7)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await makeTestApp('book-offsets');
  }, 300_000);

  afterAll(async () => {
    await t?.close();
  });

  const seed = async (over: { calibrate?: boolean; recalibrate?: boolean } = {}) => {
    const results = await seedBooks(t.db, {
      dir: BOOKS_DIR,
      only: 'R5',
      maxPages: MAX_PAGES,
      dataDir: t.dataDir,
      ...over,
    });
    expect(results).toHaveLength(1);
    return results[0]!;
  };

  const storedOffset = async (bookId: string): Promise<number> => {
    const row = (await t.db.select().from(books).where(eq(books.id, bookId)))[0]!;
    return row.pageOffset;
  };

  it('leaves the wrong seeded offset alone without the flag', async () => {
    const r = await seed();
    expect(r.offset).toBe(0);
    expect(r.calibration).toBeUndefined();
    expect(await storedOffset(r.bookId)).toBe(0);
  }, 300_000);

  it('measures and writes the real offset, and indexes pages at the right printed number', async () => {
    const r = await seed({ calibrate: true });
    expect(r.calibration?.status).toBe('apply');
    expect(r.calibration?.applied).toBe(true);
    expect(r.calibration?.currentOffset).toBe(0);
    expect(r.calibration?.proposedOffset).toBe(1);
    expect(r.calibration?.detection.confidence).toBeGreaterThan(0.8);
    expect(r.offset).toBe(1);
    expect(await storedOffset(r.bookId)).toBe(1);
    // Pages were indexed in the same pass, keyed by the *measured* printed
    // page: PDF page 1 is front matter now, so one fewer row than PDF pages.
    expect(r.pagesInserted).toBeLessThanOrEqual(MAX_PAGES - 1);
  }, 300_000);

  it('re-detects the same offset from the indexed pages, with no PDF in hand', async () => {
    const r = await seed({ calibrate: true });
    const d = await detectOffsetFromDb(t.db, { bookId: r.bookId, currentOffset: r.offset });
    expect(d.offset).toBe(1);
    expect(d.confidence).toBeGreaterThan(0.8);

    // …but only *relative to how those rows were keyed*. They were written as
    // printed = pdf − 1; tell the detector the book now claims +4 and it
    // measures +4. `book_pages` cannot contradict a stale offset, which is
    // exactly why the API route reads the PDF instead.
    const stale = await detectOffsetFromDb(t.db, { bookId: r.bookId, currentOffset: 4 });
    expect(stale.offset).toBe(4);
  }, 300_000);

  it('never overwrites a human-set offset without --recalibrate', async () => {
    const first = await seed({ calibrate: true });
    // The GM calibrated by hand and got something else. That wins.
    await t.db.update(books).set({ pageOffset: 3 }).where(eq(books.id, first.bookId));

    const kept = await seed({ calibrate: true });
    expect(kept.calibration?.status).toBe('human-set');
    expect(kept.calibration?.applied).toBe(false);
    expect(kept.calibration?.proposedOffset).toBe(1);
    expect(await storedOffset(first.bookId)).toBe(3);

    const forced = await seed({ calibrate: true, recalibrate: true });
    expect(forced.calibration?.applied).toBe(true);
    expect(await storedOffset(first.bookId)).toBe(1);
  }, 300_000);

  it('is a no-op on a second calibrate run — a measured offset is not "human-set"', async () => {
    await seed({ calibrate: true });
    const again = await seed({ calibrate: true });
    expect(again.calibration?.status).toBe('unchanged');
    expect(again.calibration?.applied).toBe(false);
    expect(again.offset).toBe(1);
  }, 300_000);

  // --- POST /api/books/:id/detect-offset -----------------------------------

  describe('the GM-facing "Detect" endpoint', () => {
    let gmToken: string;
    let playerToken: string;
    let bookId: string;

    beforeAll(async () => {
      const boot = await bootstrapCampaign(t.app, 'Rain Check');
      gmToken = boot.gmToken;
      playerToken = (await joinAs(t.app, boot.campaignId, gmToken, 'player', 'Wisp')).token;
      const r = await seed({ calibrate: true });
      bookId = r.bookId;
      // Put the wrong offset back, so the proposal has something to say.
      await t.db.update(books).set({ pageOffset: 0 }).where(eq(books.id, bookId));
    }, 300_000);

    it('proposes the measured offset and applies nothing', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/books/${bookId}/detect-offset`,
        headers: { authorization: `Bearer ${gmToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body['currentOffset']).toBe(0);
      expect(body['proposedOffset']).toBe(1);
      expect(body['wouldChange']).toBe(true);
      expect(body['applied']).toBe(false);
      expect(body['status']).toBe('apply');
      // The PDF, not the indexed rows: those were keyed at +1 and would have
      // "confirmed" whatever offset the book row currently claims.
      expect(body['source']).toBe('pdf');
      expect(body['sourceNote']).toBeNull();
      expect(body['reason']).toBeNull();
      expect(body['apply']).toEqual({
        method: 'PATCH',
        url: `/api/books/${bookId}`,
        body: { pageOffset: 1 },
      });
      // Detection measures; the GM's confirm writes.
      expect(await storedOffset(bookId)).toBe(0);
    }, 120_000);

    it('hands back the evidence a GM can check by opening the book', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/books/${bookId}/detect-offset`,
        headers: { authorization: `Bearer ${gmToken}` },
        payload: { maxSample: 16 },
      });
      const body = res.json() as {
        evidence: Array<{ pdfPage: number; printedPage: number }>;
        agreed: number;
        sampled: number;
        confidence: number;
      };
      expect(body.sampled).toBeLessThanOrEqual(16);
      expect(body.evidence.length).toBeGreaterThan(0);
      for (const e of body.evidence) expect(e.pdfPage - e.printedPage).toBe(1);
      expect(body.confidence).toBeGreaterThan(0.8);
    }, 120_000);

    it('is GM-only — a player cannot re-page the table\'s library', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/books/${bookId}/detect-offset`,
        headers: { authorization: `Bearer ${playerToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    });

    it('404s on an unknown book', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/books/00000000-0000-4000-8000-000000000000/detect-offset',
        headers: { authorization: `Bearer ${gmToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
