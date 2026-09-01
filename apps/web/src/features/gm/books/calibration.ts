/**
 * Shelf calibration logic (M11 / FR11.1) — pure, no DOM, no network.
 *
 * The whole library problem in one sentence: `pnpm seed:books` registers all
 * seventeen books in about thirty seconds, and every one of them lands at
 * `pageOffset = 0`. That is correct for exactly zero of them. Front matter
 * shifts printed numbering in every production PDF, so an uncalibrated book
 * turns a ref chip for "RG p.104" into the wrong page — silently, with a
 * confident-looking `0` next to it.
 *
 * So the shelf refuses to print a bare `0`. A book that nobody has calibrated
 * reads "not calibrated", because that is what it is: a default, not a
 * measurement (Principle 3 — a number says where it came from).
 *
 * Everything here is exported for the shelf UI and covered by
 * `calibration.test.ts`; the components stay presentational.
 */
import { printedToPdfPage } from '../../reader/index.js';

// ---------------------------------------------------------------------------
// Seeding (FR11.7) — what the empty state tells the GM to run
// ---------------------------------------------------------------------------

/**
 * The commands, in the forms that actually work from the repo root.
 *
 * NOT `pnpm ... seed:books -- --list`: pnpm forwards the bare `--` to the
 * script and the flag parser dies on "unknown flag: --". The script's own
 * header used to print that broken form and no longer does; `books-docs.test.ts`
 * on the server side re-parses every command printed in the docs so it cannot
 * come back. Everything below has been run against the full 17-book library.
 *
 * `SEED_COMMAND` carries `--calibrate` deliberately. Without it every book but
 * the core rulebook lands at offset +0, and that guess is wrong for 15 of the
 * 17 production books — the shelf would open on sixteen "not calibrated"
 * cards, which is exactly the work this screen is trying to save the GM.
 */
export const SEED_COMMAND = 'pnpm seed:books --calibrate';
export const SEED_LIST_COMMAND = 'pnpm seed:books --list';

/**
 * Measured on the owner's own library, not estimated — a wiped DATA_DIR and
 * the full seventeen production PDFs, twice.
 *
 * `SEED_PAGE_COUNT` is the calibrated figure. A plain `pnpm seed:books`
 * indexes four more (3,546), and those four are front-matter pages that a
 * calibrated run correctly refuses to file under a printed number below 1.
 */
export const SEED_BOOK_COUNT = 17;
export const SEED_PAGE_COUNT = 3542;
/**
 * A range, because that is what was measured: three calibrated runs came in at
 * 33 s, 74 s and 85 s. The spread is disk — ~311 MB of PDF copied into the file
 * store, warm cache or cold — not the measurement, which is one extra pass over
 * ~48 pages per book. Quoting the fastest run as "about 30 seconds" would make
 * the first import feel broken.
 */
export const SEED_DURATION = '30–90 seconds';
/** How many of the 17 the measurement got right with no human in the loop. */
export const SEED_MEASURED_COUNT = 17;

/** The honest paragraph the empty shelf shows above the command. */
export const SEED_EXPLANATION =
  `Drop the PDFs in the repo root (or DATA_DIR) and run it once: it registers ` +
  `each file with a guessed code and title, measures the page offset from the ` +
  `numbers printed in the book itself, then extracts per-page text so search ` +
  `and the Fixer can reach it. ${SEED_BOOK_COUNT} books, ` +
  `${SEED_PAGE_COUNT.toLocaleString('en-US')} pages, ${SEED_DURATION}. ` +
  `The PDFs stay on this machine — nothing is uploaded and nothing is committed.`;

/** Why some page counts come back short of the PDF's own page count. */
export const IMAGE_ONLY_NOTE =
  'Pages that are pure scanned image index 0 text, so they are invisible to ' +
  'search and to the Fixer. A gap between indexed and PDF pages is that, not a failure.';

// ---------------------------------------------------------------------------
// Calibration status
// ---------------------------------------------------------------------------

/** Everything the status logic needs from a registry row. */
export interface CalibrationInput {
  pageOffset: number;
  hasFile?: boolean | undefined;
  /**
   * Where the offset came from, when the server says.
   *
   * No route sends this: there is no `offset_source` column, and detect-offset
   * proposes without writing, so nothing is in a position to claim provenance.
   * A nonzero offset stays the only evidence that a human touched it. The
   * field is kept so a build that does start reporting it needs no change here.
   */
  offsetSource?: string | undefined;
}

export type CalibrationState = 'no-file' | 'uncalibrated' | 'calibrated';

export interface CalibrationStatus {
  state: CalibrationState;
  /** Chip text. Never a bare number for an uncalibrated book. */
  label: string;
  /** One line the GM can act on. */
  detail: string;
  /** True when detect / calibrate can do anything at all. */
  actionable: boolean;
}

/** Sources that mean a human (or a measurement) set this offset. */
const MEASURED_SOURCES = new Set(['manual', 'detected', 'measured', 'calibrated', 'gm']);

/**
 * Is this book's offset a measurement or a default?
 *
 * `+0` with no provenance is the default failure mode after a fresh seed, and
 * it is reported as such. A nonzero offset is treated as calibrated because
 * nothing in the seed path writes one — only a GM save or an applied detection
 * does.
 */
export function calibrationStatus(book: CalibrationInput): CalibrationStatus {
  if (book.hasFile === false) {
    return {
      state: 'no-file',
      label: 'no PDF',
      detail: `Registry row with no file behind it. Run ${SEED_COMMAND} to attach one.`,
      actionable: false,
    };
  }
  const source = book.offsetSource?.toLowerCase();
  const measured = source !== undefined && MEASURED_SOURCES.has(source);
  if (measured || Math.round(book.pageOffset) !== 0) {
    return {
      state: 'calibrated',
      label: `offset ${formatOffset(book.pageOffset)}`,
      detail: `Printed page + ${formatOffset(book.pageOffset)} = PDF page.`,
      actionable: true,
    };
  }
  return {
    state: 'uncalibrated',
    label: 'not calibrated',
    detail:
      'Still at the seeded default of +0. Front matter shifts almost every ' +
      'book, so refs into this one will open the wrong page until it is ' +
      `measured — detect below, or re-import with ${SEED_COMMAND}.`,
    actionable: true,
  };
}

/** `+5` / `−2` / `+0` — signed, always, so a zero reads as a choice. */
export function formatOffset(offset: number): string {
  const n = Math.round(offset) || 0;
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

// ---------------------------------------------------------------------------
// The manual nudge loop (FR11.1)
// ---------------------------------------------------------------------------

/** Offsets outside this are not front matter, they are a typo. */
export const MIN_OFFSET = -50;
export const MAX_OFFSET = 500;

export function clampOffset(offset: number): number {
  const n = Math.round(Number(offset));
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, n));
}

export function stepOffset(offset: number, delta: number): number {
  return clampOffset(clampOffset(offset) + Math.round(delta));
}

export function clampPrinted(printed: number): number {
  const n = Math.round(Number(printed));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(9999, n);
}

/** What the card shows while the GM steps: printed in, PDF out. */
export interface PagePreview {
  printed: number;
  pdf: number;
  offset: number;
  line: string;
}

export function previewPage(printed: number, offset: number): PagePreview {
  const p = clampPrinted(printed);
  const o = clampOffset(offset);
  const pdf = printedToPdfPage(p, o);
  return { printed: p, pdf, offset: o, line: `printed p.${p} → PDF page ${pdf} (${formatOffset(o)})` };
}

// ---------------------------------------------------------------------------
// Detection proposals
// ---------------------------------------------------------------------------

export interface OffsetSample {
  printed: number;
  pdf: number;
  note?: string;
}

export interface OffsetProposal {
  offset: number;
  /** 0..1, or null when the server did not say. */
  confidence: number | null;
  /** Always a sentence — falls back to a count of the samples. */
  evidence: string;
  samples: OffsetSample[];
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

/** A confidence given as 0–100 is rescaled; anything else is clamped to 0..1. */
function normalizeConfidence(raw: unknown): number | null {
  const n = num(raw);
  if (n === null) return null;
  const scaled = n > 1 ? n / 100 : n;
  if (!Number.isFinite(scaled)) return null;
  return Math.min(1, Math.max(0, scaled));
}

function normalizeSamples(raw: unknown): OffsetSample[] {
  if (!Array.isArray(raw)) return [];
  const out: OffsetSample[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const o = entry as Record<string, unknown>;
    const printed = num(pick(o, ['printed', 'printedPage', 'page']));
    const pdf = num(pick(o, ['pdf', 'pdfPage', 'index']));
    if (printed === null || pdf === null) continue;
    const note = pick(o, ['note', 'text', 'match']);
    out.push({
      printed: Math.round(printed),
      pdf: Math.round(pdf),
      ...(typeof note === 'string' && note.trim() !== '' ? { note: note.trim() } : {}),
    });
  }
  return out;
}

/**
 * Read a detect-offset response into a proposal, tolerantly.
 *
 * `POST /api/books/:id/detect-offset` answers with `proposedOffset`, a 0–1
 * `confidence` and an `evidence` array of `{ printedPage, pdfPage }` pairs —
 * all three are read below. The field names stay read defensively (offset /
 * pageOffset / proposedOffset, confidence as 0–1 or 0–100, evidence as a
 * sentence or as samples) so a shape drift degrades to "no proposal" instead
 * of applying a wrong number. Returns null when there is no usable offset in
 * the payload.
 */
export function normalizeDetection(raw: unknown): OffsetProposal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const root = raw as Record<string, unknown>;
  const body =
    typeof root['proposal'] === 'object' && root['proposal'] !== null
      ? (root['proposal'] as Record<string, unknown>)
      : typeof root['detection'] === 'object' && root['detection'] !== null
        ? (root['detection'] as Record<string, unknown>)
        : root;

  const offset = num(
    pick(body, ['offset', 'pageOffset', 'proposedOffset', 'detectedOffset', 'suggestedOffset']),
  );
  if (offset === null) return null;

  const confidence = normalizeConfidence(pick(body, ['confidence', 'score', 'certainty']));
  const samples = normalizeSamples(pick(body, ['samples', 'evidence', 'matches', 'observations']));
  const rawEvidence = pick(body, ['evidence', 'reason', 'explanation', 'note', 'detail']);
  const evidence =
    typeof rawEvidence === 'string' && rawEvidence.trim() !== ''
      ? rawEvidence.trim()
      : samples.length > 0
        ? `${samples.length} printed page number${samples.length === 1 ? '' : 's'} matched at this offset.`
        : 'The server proposed this offset without saying how.';

  return { offset: clampOffset(offset), confidence, evidence, samples };
}

/**
 * The server's own sentence about a detection — kept even (especially) when
 * there is no offset to show.
 *
 * `POST /api/books/:id/detect-offset` always answers with a `message` saying
 * what it did and why: `"keeping +0: no printed page numbers found (48 of 48
 * sampled pages are image-only)"`, or `"keeping +0: split vote — 21 pages say
 * +1, 19 say +2"`. Those are different problems with different fixes, and a
 * card that replaced them with one canned guess ("probably image-only") would
 * be wrong about half the books it declined. So the message is carried through
 * verbatim and the UI adds nothing to it.
 *
 * Returns null when the payload has no sentence in it, which is the signal for
 * the card to fall back to its own generic line.
 */
export function detectionNote(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const root = raw as Record<string, unknown>;
  const note = pick(root, ['message', 'note', 'detail', 'explanation']);
  if (typeof note === 'string' && note.trim() !== '') return note.trim();
  const reason = pick(root, ['reason', 'status']);
  return typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null;
}

export type ConfidenceBand = 'high' | 'medium' | 'low' | 'unstated';

export function confidenceBand(confidence: number | null): ConfidenceBand {
  if (confidence === null) return 'unstated';
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

export function formatConfidence(confidence: number | null): string {
  if (confidence === null) return 'confidence unstated';
  return `${Math.round(confidence * 100)}% confident`;
}

/**
 * A proposal is never applied on arrival — the GM clicks. This is the line the
 * button and the summary share, so the two can never disagree about what would
 * happen.
 */
export function describeProposal(current: number, proposal: OffsetProposal): string {
  if (clampOffset(current) === proposal.offset) {
    return `Agrees with the saved offset (${formatOffset(proposal.offset)}).`;
  }
  return `Would change ${formatOffset(current)} → ${formatOffset(proposal.offset)}.`;
}

// ---------------------------------------------------------------------------
// Detect all
// ---------------------------------------------------------------------------

export interface QueueCandidate {
  id: string;
  hasFile?: boolean | undefined;
  pageOffset: number;
  offsetSource?: string | undefined;
}

/**
 * Which books "detect all" should actually hit. Sixteen uncalibrated books is
 * the real case, so the default skips the ones already measured rather than
 * re-proposing over a GM's own measurement.
 */
export function detectQueue(
  books: readonly QueueCandidate[],
  opts: { includeCalibrated?: boolean } = {},
): string[] {
  return books
    .filter((b) => calibrationStatus(b).actionable)
    .filter((b) => opts.includeCalibrated === true || calibrationStatus(b).state === 'uncalibrated')
    .map((b) => b.id);
}

/** Shelf-level counts for the header line. */
export function shelfSummary(books: readonly QueueCandidate[]): {
  total: number;
  calibrated: number;
  uncalibrated: number;
  missingFile: number;
} {
  let calibrated = 0;
  let uncalibrated = 0;
  let missingFile = 0;
  for (const b of books) {
    const s = calibrationStatus(b).state;
    if (s === 'calibrated') calibrated += 1;
    else if (s === 'uncalibrated') uncalibrated += 1;
    else missingFile += 1;
  }
  return { total: books.length, calibrated, uncalibrated, missingFile };
}
