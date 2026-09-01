/**
 * Automatic page-offset detection (FR11.1) — measure `printed page + offset =
 * PDF page` instead of asking the GM to nudge a slider once per book.
 *
 * A book's offset is constant across its body, so it can be *read off the
 * page*: nearly every rulebook page prints its own number in the header or
 * footer, and that number survives text extraction. Sample pages spread
 * through the body, pull the number-shaped tokens out of each page's head and
 * tail, and every `pdfPage − printedCandidate` is a vote for one offset. The
 * true offset wins by a landslide; noise (cross-refs, prices, years, index
 * columns) scatters across dozens of values and is pruned by a plausibility
 * window.
 *
 * Two sources, one core:
 *   - `detectOffsetFromPdf` reads the PDF directly — used by `seed:books
 *     --calibrate` *before* extraction, so pages are indexed at the right
 *     printed number the first time.
 *   - `detectOffsetFromDb` reads `book_pages` — used by
 *     `POST /api/books/:id/detect-offset`, which proposes and never applies.
 *
 * Honesty is the whole point: a wrong offset is worse than none, because every
 * ref chip in that book then lands on the wrong page *silently*. Sparse
 * numbering, image-only scans and split votes all return `offset: null` with a
 * reason rather than a confident guess.
 *
 * Front matter and back matter are deliberately excluded from the sample:
 * tables of contents and indices are dense with page numbers that belong to
 * *other* pages.
 */
import { readFile } from 'node:fs/promises';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDocumentProxy } from 'unpdf';
import { bookPages, type Db } from '@safehouse/db';

/** One sampled page: its 1-based PDF index and its extracted text. */
export interface PageSample {
  pdfPage: number;
  text: string;
}

/** A single "printed N was found on PDF page N+offset" observation. */
export interface OffsetEvidence {
  pdfPage: number;
  printedPage: number;
}

/** Why detection declined to name an offset. */
export type OffsetFailure =
  /** The book has no indexed/readable pages at all. */
  | 'no-pages'
  /** Pages were read but none carried a plausible page number (image-only scans). */
  | 'no-page-numbers'
  /** Numbers were found but too few pages agreed on one offset. */
  | 'low-agreement'
  /** Two offsets are close enough that picking one would be a coin flip. */
  | 'ambiguous';

export interface OffsetDetection {
  /** The measured offset, or null when the evidence does not support one. */
  offset: number | null;
  /** agreed ÷ pages sampled that had any text (0–1). */
  confidence: number;
  /** Sampled pages that voted for `offset` (or for the leader, when null). */
  agreed: number;
  /** Pages actually read. */
  sampled: number;
  /** Of those, how many held any extractable text. */
  withText: number;
  /** Of those, how many yielded at least one plausible page-number token. */
  numbered: number;
  /** The offset that led the vote — kept even when it was rejected, so the
   *  GM can see *what* was almost measured and how close it came. */
  leader: { offset: number; agreed: number } | null;
  /** The next-best offset — how close the vote was. */
  runnerUp: { offset: number; agreed: number } | null;
  /** A few "printed N found on PDF page N+k" pairs, for the GM to eyeball. */
  evidence: OffsetEvidence[];
  /** What the sample deliberately left out. */
  skipped: { frontMatter: number; backMatter: number; noText: number; noNumber: number };
  reason?: OffsetFailure;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Plausibility window for `pdfPage − printedPage`. Real books sit in 0…+16. */
const MIN_PLAUSIBLE_OFFSET = -10;
const MAX_PLAUSIBLE_OFFSET = 40;

/** How much of a page's text can hold its own page number. */
const HEAD_CHARS = 160;
const TAIL_CHARS = 200;
/** Per-page candidate caps — the footer number is the *last* token far more
 *  often than not, so the tail is scanned back-to-front and weighted first. */
const MAX_TAIL_CANDIDATES = 4;
const MAX_HEAD_CANDIDATES = 2;

/** Body window: trim this share of the page list off each end (TOC / index). */
const EDGE_FRACTION = 0.08;
const EDGE_CAP = 40;
/** Below this many body pages, sampling the whole list beats windowing it. */
const MIN_BODY_PAGES = 12;

const DEFAULT_MAX_SAMPLE = 48;

/** Acceptance thresholds — deliberately strict; null is a fine answer. */
const MIN_CONFIDENCE = 0.6;
const MIN_AGREED = 6;
/** The winner must out-poll the runner-up by this factor, or it is a coin flip. */
const MIN_MARGIN = 2;

// ---------------------------------------------------------------------------
// Candidate extraction
// ---------------------------------------------------------------------------

/**
 * Standalone 1–4 digit integers in a slice of page text.
 *
 * The lookarounds reject anything glued to a word character, a dot or a comma,
 * which throws out the three biggest sources of false page numbers in a
 * rulebook: thousands separators (`1,000` → neither `1` nor `000`), decimals
 * and dice codes (`2.5`, `12S`), and cross-references (`p.195`). Leading zeros
 * are dropped too — `008` is a vehicle stat, not a page.
 */
function scanNumbers(slice: string): number[] {
  const out: number[] = [];
  for (const m of slice.matchAll(/(?<![\w.,])(\d{1,4})(?![\w.,])/g)) {
    const raw = m[1]!;
    if (raw.length > 1 && raw.startsWith('0')) continue;
    const n = Number(raw);
    if (n >= 1) out.push(n);
  }
  return out;
}

/**
 * Page-number candidates for one page, best guess first: the tail read
 * backwards (a footer number is usually the very last token), then the head (a
 * few books number in the running header).
 */
export function pageNumberCandidates(text: string): number[] {
  const out: number[] = [];
  const push = (n: number): void => {
    if (!out.includes(n)) out.push(n);
  };
  const tail = scanNumbers(text.slice(-TAIL_CHARS));
  for (const n of tail.slice(-MAX_TAIL_CANDIDATES).reverse()) push(n);
  const head = scanNumbers(text.slice(0, HEAD_CHARS));
  for (const n of head.slice(0, MAX_HEAD_CANDIDATES)) push(n);
  return out;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

export interface OffsetSamplePlan {
  /** PDF page numbers to read text for, ascending. */
  sample: number[];
  /** Pages trimmed off the front of the list (front matter / TOC). */
  skippedFront: number;
  /** Pages trimmed off the back (index, ads, blank endpapers). */
  skippedBack: number;
}

/**
 * Choose which PDF pages to read. Trims the front and back — a table of
 * contents lists *other* pages' numbers by the dozen and would out-vote the
 * body — then spreads the sample evenly through what is left so a single
 * mis-numbered chapter cannot dominate.
 */
export function planOffsetSample(
  pdfPages: number[],
  opts: { maxSample?: number } = {},
): OffsetSamplePlan {
  const pages = [...new Set(pdfPages)].sort((a, b) => a - b);
  if (pages.length === 0) return { sample: [], skippedFront: 0, skippedBack: 0 };

  const edge = Math.min(EDGE_CAP, Math.floor(pages.length * EDGE_FRACTION));
  let body = pages.slice(edge, pages.length - edge);
  let skippedFront = edge;
  let skippedBack = edge;
  if (body.length < MIN_BODY_PAGES) {
    body = pages;
    skippedFront = 0;
    skippedBack = 0;
  }

  const maxSample = Math.max(1, opts.maxSample ?? DEFAULT_MAX_SAMPLE);
  if (body.length <= maxSample) return { sample: body, skippedFront, skippedBack };

  const sample: number[] = [];
  for (let i = 0; i < maxSample; i++) {
    const at = Math.round((i * (body.length - 1)) / (maxSample - 1));
    const page = body[at]!;
    if (sample[sample.length - 1] !== page) sample.push(page);
  }
  return { sample, skippedFront, skippedBack };
}

// ---------------------------------------------------------------------------
// Detection core
// ---------------------------------------------------------------------------

function emptyDetection(
  reason: OffsetFailure,
  plan: Pick<OffsetSamplePlan, 'skippedFront' | 'skippedBack'>,
  counts: { sampled: number; withText: number; numbered: number; noNumber: number } = {
    sampled: 0,
    withText: 0,
    numbered: 0,
    noNumber: 0,
  },
): OffsetDetection {
  return {
    offset: null,
    confidence: 0,
    agreed: 0,
    sampled: counts.sampled,
    withText: counts.withText,
    numbered: counts.numbered,
    leader: null,
    runnerUp: null,
    evidence: [],
    skipped: {
      frontMatter: plan.skippedFront,
      backMatter: plan.skippedBack,
      noText: counts.sampled - counts.withText,
      noNumber: counts.noNumber,
    },
    reason,
  };
}

/**
 * Vote the sampled pages into an offset. Each page contributes at most one
 * vote per distinct offset, so a number-dense index page cannot stuff the
 * ballot for the value it happens to mention twice.
 */
export function detectOffset(
  samples: PageSample[],
  plan: Pick<OffsetSamplePlan, 'skippedFront' | 'skippedBack'> = {
    skippedFront: 0,
    skippedBack: 0,
  },
): OffsetDetection {
  if (samples.length === 0) return emptyDetection('no-pages', plan);

  const votes = new Map<number, number>();
  const examples = new Map<number, OffsetEvidence[]>();
  let withText = 0;
  let numbered = 0;
  let noNumber = 0;

  for (const sample of samples) {
    if (sample.text.trim().length === 0) continue; // image-only page
    withText++;
    const seen = new Set<number>();
    for (const printedPage of pageNumberCandidates(sample.text)) {
      const offset = sample.pdfPage - printedPage;
      if (offset < MIN_PLAUSIBLE_OFFSET || offset > MAX_PLAUSIBLE_OFFSET) continue;
      if (seen.has(offset)) continue;
      seen.add(offset);
      votes.set(offset, (votes.get(offset) ?? 0) + 1);
      const ex = examples.get(offset) ?? [];
      if (ex.length < 5) ex.push({ pdfPage: sample.pdfPage, printedPage });
      examples.set(offset, ex);
    }
    if (seen.size === 0) noNumber++;
    else numbered++;
  }

  const counts = { sampled: samples.length, withText, numbered, noNumber };
  if (withText === 0) return emptyDetection('no-page-numbers', plan, counts);
  if (votes.size === 0) return emptyDetection('no-page-numbers', plan, counts);

  // Most votes wins; ties break toward the smaller shift (books rarely bury
  // their first printed page 30 leaves deep).
  const ranked = [...votes.entries()]
    .map(([offset, agreed]) => ({ offset, agreed }))
    .sort((a, b) => b.agreed - a.agreed || Math.abs(a.offset) - Math.abs(b.offset));
  const winner = ranked[0]!;
  const runnerUp = ranked[1] ?? null;
  const confidence = withText === 0 ? 0 : winner.agreed / withText;

  const base: OffsetDetection = {
    offset: winner.offset,
    confidence,
    agreed: winner.agreed,
    sampled: samples.length,
    withText,
    numbered,
    leader: winner,
    runnerUp,
    evidence: examples.get(winner.offset) ?? [],
    skipped: {
      frontMatter: plan.skippedFront,
      backMatter: plan.skippedBack,
      noText: samples.length - withText,
      noNumber,
    },
  };

  if (winner.agreed < MIN_AGREED || confidence < MIN_CONFIDENCE) {
    return { ...base, offset: null, reason: 'low-agreement' };
  }
  if (runnerUp !== null && winner.agreed < runnerUp.agreed * MIN_MARGIN) {
    return { ...base, offset: null, reason: 'ambiguous' };
  }
  return base;
}

// ---------------------------------------------------------------------------
// PDF text (shared with BooksService.extractPages)
// ---------------------------------------------------------------------------

export type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/** Open a PDF for page-by-page text reads. Caller destroys the loading task. */
export async function openPdf(pdfPath: string): Promise<PdfDocument> {
  const buf = await readFile(pdfPath);
  return getDocumentProxy(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}

/**
 * Extracted, whitespace-normalized text of one PDF page. NULs are stripped
 * because Postgres text columns reject them and PDF glyph maps sometimes emit
 * them. An empty string means the page is image-only — invisible to search,
 * to the Fixer, and to this detector.
 */
export async function extractPdfPageText(doc: PdfDocument, pdfPage: number): Promise<string> {
  const page = await doc.getPage(pdfPage);
  try {
    const content = await page.getTextContent();
    return content.items
      .map((it) => {
        const item = it as { str?: unknown; hasEOL?: unknown };
        if (typeof item.str !== 'string') return '';
        return item.str + (item.hasEOL === true ? '\n' : ' ');
      })
      .join('')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
  } finally {
    page.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export interface DetectFromPdfOptions {
  maxSample?: number;
  /** Pretend the PDF ends here — keeps `--max-pages` test runs honest. */
  maxPdfPages?: number;
}

/** Detect straight from a PDF file — no database, nothing indexed yet. */
export async function detectOffsetFromPdf(
  pdfPath: string,
  opts: DetectFromPdfOptions = {},
): Promise<OffsetDetection> {
  const doc = await openPdf(pdfPath);
  try {
    const total = Math.min(doc.numPages, opts.maxPdfPages ?? doc.numPages);
    const pages = Array.from({ length: total }, (_, i) => i + 1);
    const plan = planOffsetSample(pages, {
      ...(opts.maxSample !== undefined ? { maxSample: opts.maxSample } : {}),
    });
    if (plan.sample.length === 0) return emptyDetection('no-pages', plan);
    const samples: PageSample[] = [];
    for (const pdfPage of plan.sample) {
      samples.push({ pdfPage, text: await extractPdfPageText(doc, pdfPage) });
    }
    return detectOffset(samples, plan);
  } finally {
    await doc.loadingTask.destroy();
  }
}

export interface DetectFromDbOptions {
  bookId: string;
  /** The book's *current* offset — `book_pages` is keyed by printed page. */
  currentOffset: number;
  maxSample?: number;
}

/**
 * Detect from already-indexed pages — no PDF re-parse, no file store.
 *
 * CAVEAT, and it matters: `book_pages.printed_page` was written as `pdfPage −
 * (the offset in force when the book was indexed)`, and that PDF index is only
 * recoverable if `currentOffset` is still that same value. Change a book's
 * offset without re-seeding and every row goes stale — this function then
 * measures `trueOffset + currentOffset − indexedOffset`, i.e. it would happily
 * "confirm" the wrong number a human just typed in.
 *
 * So: pass the offset the rows were indexed with (right after a seed, that is
 * the book's current offset), and prefer `detectOffsetFromPdf` whenever the
 * PDF is on hand — the file is the only absolute reference.
 */
export async function detectOffsetFromDb(
  db: Db,
  opts: DetectFromDbOptions,
): Promise<OffsetDetection> {
  const rows = await db
    .select({ printedPage: bookPages.printedPage })
    .from(bookPages)
    .where(eq(bookPages.bookId, opts.bookId))
    .orderBy(asc(bookPages.printedPage));
  if (rows.length === 0) return emptyDetection('no-pages', { skippedFront: 0, skippedBack: 0 });

  const plan = planOffsetSample(
    rows.map((r) => r.printedPage + opts.currentOffset),
    { ...(opts.maxSample !== undefined ? { maxSample: opts.maxSample } : {}) },
  );
  if (plan.sample.length === 0) return emptyDetection('no-pages', plan);

  const wanted = plan.sample.map((pdfPage) => pdfPage - opts.currentOffset);
  const texts = await db
    .select({ printedPage: bookPages.printedPage, text: bookPages.text })
    .from(bookPages)
    .where(and(eq(bookPages.bookId, opts.bookId), inArray(bookPages.printedPage, wanted)));
  const byPrinted = new Map(texts.map((r) => [r.printedPage, r.text]));
  const samples: PageSample[] = plan.sample.map((pdfPage) => ({
    pdfPage,
    text: byPrinted.get(pdfPage - opts.currentOffset) ?? '',
  }));
  return detectOffset(samples, plan);
}

// ---------------------------------------------------------------------------
// Proposals — detection never applies itself
// ---------------------------------------------------------------------------

export type OffsetProposalStatus =
  /** Confident, different from what is stored, and safe to write. */
  | 'apply'
  /** Confident and already correct — nothing to do. */
  | 'unchanged'
  /** Confident, but the stored offset was set by a human. Needs confirmation. */
  | 'human-set'
  /** Numbers were found but the vote was not decisive enough to trust. */
  | 'low-confidence'
  /** Nothing to measure — no indexed pages, or no printed numbers at all. */
  | 'undetected';

export interface OffsetProposal {
  detection: OffsetDetection;
  currentOffset: number;
  /** The offset detection would write, or null when it declines. */
  proposedOffset: number | null;
  wouldChange: boolean;
  /** True when the stored offset differs from what seeding guessed. */
  humanSet: boolean;
  status: OffsetProposalStatus;
  /** One line a GM can act on. */
  message: string;
}

function sign(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function evidenceLine(detection: OffsetDetection): string {
  const first = detection.evidence[0];
  if (!first) return '';
  return `, e.g. printed ${first.printedPage} on PDF page ${first.pdfPage}`;
}

function agreementLine(detection: OffsetDetection): string {
  return `${detection.agreed}/${detection.withText} sampled pages agree`;
}

/**
 * Turn a detection into a decision, without making it. `seededOffset` is what
 * `seed:books` would guess from the filename; a stored offset that differs
 * from it is a human calibration and is never overwritten silently.
 */
export function buildOffsetProposal(
  detection: OffsetDetection,
  ctx: { currentOffset: number; seededOffset?: number },
): OffsetProposal {
  const humanSet = ctx.seededOffset !== undefined && ctx.currentOffset !== ctx.seededOffset;
  const base = {
    detection,
    currentOffset: ctx.currentOffset,
    proposedOffset: detection.offset,
    wouldChange: detection.offset !== null && detection.offset !== ctx.currentOffset,
    humanSet,
  };

  if (detection.offset === null) {
    const undetected = detection.reason === 'no-pages' || detection.reason === 'no-page-numbers';
    const leader = detection.leader;
    const runnerUp = detection.runnerUp;
    const why =
      detection.reason === 'no-pages'
        ? 'no readable pages to measure'
        : detection.reason === 'no-page-numbers'
          ? `no printed page numbers found (${detection.skipped.noText} of ${detection.sampled} sampled pages are image-only)`
          : detection.reason === 'ambiguous' && leader !== null && runnerUp !== null
            ? `split vote — ${leader.agreed} pages say ${sign(leader.offset)}, ${runnerUp.agreed} say ${sign(runnerUp.offset)}`
            : `only ${agreementLine(detection)}${leader === null ? '' : ` on ${sign(leader.offset)}`} — too sparse to trust`;
    return {
      ...base,
      status: undetected ? 'undetected' : 'low-confidence',
      message: `keeping ${sign(ctx.currentOffset)}: ${why}`,
    };
  }

  if (detection.offset === ctx.currentOffset) {
    return {
      ...base,
      status: 'unchanged',
      message: `${sign(ctx.currentOffset)} confirmed (${agreementLine(detection)}${evidenceLine(detection)})`,
    };
  }
  if (humanSet) {
    return {
      ...base,
      status: 'human-set',
      message: `detected ${sign(detection.offset)} (${agreementLine(detection)}) but ${sign(ctx.currentOffset)} was set by hand — confirm before overwriting`,
    };
  }
  return {
    ...base,
    status: 'apply',
    message: `${sign(ctx.currentOffset)} → ${sign(detection.offset)} (${agreementLine(detection)}${evidenceLine(detection)})`,
  };
}
