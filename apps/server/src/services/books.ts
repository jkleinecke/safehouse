/**
 * Rules library service (M11: FR11.1–11.7; FR12.14 retrieval substrate).
 *
 * - Filename → {code, offset, title} guessing for `pnpm seed:books` (FR11.7).
 *   The core rulebook's +5 offset is measured (printed p.426 = PDF p.431) and
 *   hardcoded; every other guess starts at 0 for the GM to calibrate (FR11.1).
 * - File-store copy: PDFs land at DATA_DIR/files/books/<CODE>.pdf with an
 *   `attachments` row; the `books` row points at it. PDFs never enter git.
 * - Per-page text extraction via unpdf into `book_pages` (batch inserts);
 *   `maxPages` keeps tests fast. Printed page = PDF page − offset; front
 *   matter (printed < 1) is skipped.
 * - `parseRef('SR5 p.426')` → `{book, page}` for codex/log autolinking (FR11.4).
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { getDocumentProxy } from 'unpdf';
import { attachments, bookPages, books, type Db } from '@safehouse/db';

export type BookRow = typeof books.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;

// ---------------------------------------------------------------------------
// Ref parsing (FR11.2/FR11.4) — 'SR5 p.426' ⇄ { book: 'SR5', page: 426 }
// ---------------------------------------------------------------------------

/** Global scan pattern for `SR5 p.426`-style refs in Markdown/log text. */
export const REF_PATTERN = /\b([A-Z][A-Z0-9]{1,5})\s*,?\s*(?:pp?|pg|page)\.?\s*(\d{1,4})\b/g;

/** Parse one freetext ref (`'SR5 p.426'`, `'RG p 12'`, `'DT page 60'`). */
export function parseRef(text: string): { book: string; page: number } | null {
  const m = /^\s*([A-Za-z][A-Za-z0-9]{1,5})\s*,?\s*(?:pp?|pg|page)\.?\s*(\d{1,4})\s*$/i.exec(text);
  if (!m) return null;
  const page = Number(m[2]);
  if (!Number.isInteger(page) || page < 1) return null;
  return { book: m[1]!.toUpperCase(), page };
}

/** Every ref found in a blob of text, with match offsets (codex autolinking). */
export function findRefs(
  text: string,
): Array<{ book: string; page: number; index: number; match: string }> {
  const out: Array<{ book: string; page: number; index: number; match: string }> = [];
  for (const m of text.matchAll(REF_PATTERN)) {
    const page = Number(m[2]);
    if (page >= 1) out.push({ book: m[1]!.toUpperCase(), page, index: m.index, match: m[0] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filename → code guessing (FR11.7)
// ---------------------------------------------------------------------------

export interface BookGuess {
  code: string;
  /** printed page + offset = PDF page. SR5's +5 is measured; others start 0. */
  offset: number;
  title: string;
}

/** Known filename stems (lowercased, alphanumerics only) → registry entries. */
const KNOWN_BOOKS: Record<string, BookGuess> = {
  shadowrunfiftheditioncorerulebookv2: {
    code: 'SR5',
    offset: 5, // measured: printed p.426 = PDF p.431
    title: 'Shadowrun Fifth Edition Core Rulebook',
  },
  runandgun: { code: 'RG', offset: 0, title: 'Run & Gun' },
  streetgrimoire: { code: 'SG', offset: 0, title: 'Street Grimoire' },
  datatrails: { code: 'DT', offset: 0, title: 'Data Trails' },
  chromeflesh: { code: 'CF', offset: 0, title: 'Chrome Flesh' },
  rigger5: { code: 'R5', offset: 0, title: 'Rigger 5.0' },
  killcode: { code: 'KC', offset: 0, title: 'Kill Code' },
  runfaster: { code: 'RF', offset: 0, title: 'Run Faster' },
  howlingshadows: { code: 'HS', offset: 0, title: 'Howling Shadows' },
  streetlethal: { code: 'SL', offset: 0, title: 'Street Lethal' },
  forbiddenarcana: { code: 'FA', offset: 0, title: 'Forbidden Arcana' },
  darkterrors: { code: 'DKT', offset: 0, title: 'Dark Terrors' },
  stolensouls: { code: 'SS', offset: 0, title: 'Stolen Souls' },
  marketpanic: { code: 'MP', offset: 0, title: 'Market Panic' },
  serratededge: { code: 'SE', offset: 0, title: 'Serrated Edge' },
  completetrog: { code: 'CT', offset: 0, title: 'The Complete Trog' },
  seattlesprawl: { code: 'SEA', offset: 0, title: 'Seattle Sprawl' },
};

/** Guess registry code/offset/title from a PDF filename (GM confirms later). */
export function guessBookFromFilename(filename: string): BookGuess {
  const stem = basename(filename).replace(/\.pdf$/i, '');
  const norm = stem.toLowerCase().replace(/[^a-z0-9]/g, '');
  const known = KNOWN_BOOKS[norm];
  if (known) return { ...known };
  // The core book sometimes ships without the _V2 suffix — same measured offset.
  if (norm.startsWith('shadowrunfiftheditioncorerulebook')) {
    return { ...KNOWN_BOOKS['shadowrunfiftheditioncorerulebookv2']! };
  }
  const fallback = norm.toUpperCase().slice(0, 6) || 'BOOK';
  return { code: fallback, offset: 0, title: stem };
}

// ---------------------------------------------------------------------------
// Offset math (FR11.1) — printed page + offset = PDF page
// ---------------------------------------------------------------------------

/** Printed → PDF page. The measured SR5 pair: printed 426 + 5 = PDF 431. */
export function printedToPdfPage(printedPage: number, pageOffset: number): number {
  return printedPage + pageOffset;
}

/** PDF → printed page; a result < 1 is front matter (no printed number). */
export function pdfToPrintedPage(pdfPage: number, pageOffset: number): number {
  return pdfPage - pageOffset;
}

// ---------------------------------------------------------------------------
// HTTP Range parsing (byte-range streaming — phones fetch pages, not books)
// ---------------------------------------------------------------------------

export type ByteRange = { start: number; end: number } | null | 'unsatisfiable';

/**
 * Parse a single-range `Range: bytes=` header against a file of `size` bytes.
 * `null` → serve the whole file (absent/malformed/multi-range headers);
 * `'unsatisfiable'` → respond 416.
 */
export function parseRangeHeader(header: string | undefined, size: number): ByteRange {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-range or malformed: fall back to 200
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    // suffix range: last N bytes
    const n = Number(rawEnd);
    if (n === 0) return 'unsatisfiable';
    const start = Math.max(0, size - n);
    return size === 0 ? 'unsatisfiable' : { start, end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const PAGE_INSERT_CHUNK = 100;

export interface ExtractResult {
  /** Pages of the PDF actually scanned (≤ maxPages). */
  scannedPdfPages: number;
  totalPdfPages: number;
  /** book_pages rows written (front matter + blank pages are skipped). */
  inserted: number;
}

export interface RegisterBookOptions {
  pdfPath: string;
  code: string;
  title: string;
  pageOffset: number;
  shared?: boolean;
  campaignId?: string | null;
}

export class BooksService {
  readonly dataDir: string;
  readonly filesRoot: string;

  constructor(
    private readonly db: Db,
    dataDir?: string,
  ) {
    this.dataDir = resolve(dataDir ?? process.env.DATA_DIR ?? './data');
    this.filesRoot = join(this.dataDir, 'files');
  }

  /** Absolute path of a registered book's PDF in the file store. */
  bookFilePath(attachment: Pick<AttachmentRow, 'path'>): string {
    return join(this.filesRoot, attachment.path);
  }

  /**
   * Registry listing. `campaignId` narrows to that campaign's books plus the
   * global (NULL-campaign) library; `sharedOnly` applies the FR11.5 per-book
   * GM-only toggle for non-GM devices.
   */
  async listBooks(
    opts: { campaignId?: string | null; sharedOnly?: boolean } = {},
  ): Promise<BookRow[]> {
    const scoped =
      opts.campaignId == null
        ? this.db.select().from(books)
        : this.db
            .select()
            .from(books)
            .where(or(isNull(books.campaignId), eq(books.campaignId, opts.campaignId)));
    const rows = await scoped.orderBy(asc(books.code));
    return opts.sharedOnly === true ? rows.filter((b) => b.shared) : rows;
  }

  /** Extracted text of one printed page (the Fixer's `get_page`, FR12.17). */
  async getPageText(
    bookId: string,
    printedPage: number,
  ): Promise<{ printedPage: number; text: string } | undefined> {
    const rows = await this.db
      .select({ printedPage: bookPages.printedPage, text: bookPages.text })
      .from(bookPages)
      .where(and(eq(bookPages.bookId, bookId), eq(bookPages.printedPage, printedPage)))
      .limit(1);
    return rows[0];
  }

  /** Codes of books this device may open — used to filter FTS hits (FR11.5). */
  async visibleBookCodes(opts: { campaignId?: string | null; sharedOnly?: boolean }): Promise<
    Set<string>
  > {
    const rows = await this.listBooks(opts);
    return new Set(rows.map((b) => b.code));
  }

  /** Registry rows for a set of codes (FTS hit enrichment). */
  async booksByCodes(codes: string[]): Promise<Map<string, BookRow>> {
    if (codes.length === 0) return new Map();
    const rows = await this.db.select().from(books).where(inArray(books.code, codes));
    return new Map(rows.map((b) => [b.code, b]));
  }

  async getBookById(id: string): Promise<BookRow | undefined> {
    return (await this.db.select().from(books).where(eq(books.id, id)).limit(1))[0];
  }

  async getBookByCode(code: string, campaignId?: string | null): Promise<BookRow | undefined> {
    const scope =
      campaignId == null ? isNull(books.campaignId) : eq(books.campaignId, campaignId);
    const rows = await this.db
      .select()
      .from(books)
      .where(and(eq(books.code, code.toUpperCase()), scope))
      .limit(1);
    // Fall back to any-campaign match so /files/books/:code works table-wide.
    if (rows[0]) return rows[0];
    return (
      await this.db.select().from(books).where(eq(books.code, code.toUpperCase())).limit(1)
    )[0];
  }

  async getAttachment(id: string): Promise<AttachmentRow | undefined> {
    return (await this.db.select().from(attachments).where(eq(attachments.id, id)).limit(1))[0];
  }

  async createBook(fields: {
    code: string;
    title: string;
    pageOffset?: number;
    shared?: boolean;
    campaignId?: string | null;
    attachmentId?: string | null;
  }): Promise<BookRow> {
    const row = (
      await this.db
        .insert(books)
        .values({
          code: fields.code.toUpperCase(),
          title: fields.title,
          pageOffset: fields.pageOffset ?? 0,
          shared: fields.shared ?? true,
          campaignId: fields.campaignId ?? null,
          attachmentId: fields.attachmentId ?? null,
        })
        .returning()
    )[0]!;
    return row;
  }

  async updateBook(
    id: string,
    patch: Partial<Pick<BookRow, 'code' | 'title' | 'pageOffset' | 'shared'>>,
  ): Promise<BookRow | undefined> {
    const set: Record<string, unknown> = {};
    if (patch.code !== undefined) set['code'] = patch.code.toUpperCase();
    if (patch.title !== undefined) set['title'] = patch.title;
    if (patch.pageOffset !== undefined) set['pageOffset'] = patch.pageOffset;
    if (patch.shared !== undefined) set['shared'] = patch.shared;
    if (Object.keys(set).length === 0) return this.getBookById(id);
    return (await this.db.update(books).set(set).where(eq(books.id, id)).returning())[0];
  }

  async deleteBook(id: string): Promise<boolean> {
    const gone = await this.db.delete(books).where(eq(books.id, id)).returning({ id: books.id });
    return gone.length > 0;
  }

  /**
   * Copy a PDF into the file store and upsert its registry row (FR11.7).
   * Re-registering an existing code refreshes the file + title but preserves
   * GM-calibrated `pageOffset`/`shared` (FR11.1 calibration survives re-seed).
   */
  async registerBookFromPdf(opts: RegisterBookOptions): Promise<BookRow> {
    const code = opts.code.toUpperCase();
    const storeDir = join(this.filesRoot, 'books');
    mkdirSync(storeDir, { recursive: true });
    const relPath = join('books', `${code}.pdf`);
    const absPath = join(this.filesRoot, relPath);
    copyFileSync(opts.pdfPath, absPath);
    const size = statSync(absPath).size;

    const existing = await this.getBookByCode(code, opts.campaignId ?? null);
    if (existing) {
      let attachmentId = existing.attachmentId;
      if (attachmentId) {
        await this.db
          .update(attachments)
          .set({ path: relPath, mime: 'application/pdf', size })
          .where(eq(attachments.id, attachmentId));
      } else {
        attachmentId = (await this.insertAttachment(relPath, size)).id;
      }
      return (
        await this.db
          .update(books)
          .set({ title: opts.title, attachmentId })
          .where(eq(books.id, existing.id))
          .returning()
      )[0]!;
    }
    const attachment = await this.insertAttachment(relPath, size);
    return this.createBook({
      code,
      title: opts.title,
      pageOffset: opts.pageOffset,
      shared: opts.shared ?? true,
      campaignId: opts.campaignId ?? null,
      attachmentId: attachment.id,
    });
  }

  private async insertAttachment(relPath: string, size: number): Promise<AttachmentRow> {
    return (
      await this.db
        .insert(attachments)
        .values({
          campaignId: null, // global library file (§9.2 attachments note)
          kind: 'asset',
          path: relPath,
          mime: 'application/pdf',
          size,
          visibility: 'public', // per-book gating happens on the books routes
        })
        .returning()
    )[0]!;
  }

  /**
   * Extract per-page text into `book_pages` (FR12.14). Replaces any prior
   * extraction for the book. Printed page = PDF page − pageOffset; pages that
   * resolve to printed < 1 (front matter) or hold no text are skipped.
   */
  async extractPages(
    bookId: string,
    pdfPath: string,
    opts: { pageOffset: number; maxPages?: number },
  ): Promise<ExtractResult> {
    const buf = await readFile(pdfPath);
    const doc = await getDocumentProxy(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    const totalPdfPages: number = doc.numPages;
    const scan = Math.min(totalPdfPages, opts.maxPages ?? totalPdfPages);

    await this.db.delete(bookPages).where(eq(bookPages.bookId, bookId));

    let inserted = 0;
    let batch: Array<{ bookId: string; printedPage: number; text: string }> = [];
    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      await this.db.insert(bookPages).values(batch);
      inserted += batch.length;
      batch = [];
    };

    try {
      for (let pdfPage = 1; pdfPage <= scan; pdfPage++) {
        const printedPage = pdfToPrintedPage(pdfPage, opts.pageOffset);
        if (printedPage < 1) continue; // front matter has no printed number
        const page = await doc.getPage(pdfPage);
        const content = await page.getTextContent();
        const text = content.items
          .map((it) => {
            const item = it as { str?: unknown; hasEOL?: unknown };
            if (typeof item.str !== 'string') return '';
            return item.str + (item.hasEOL === true ? '\n' : ' ');
          })
          .join('')
          // Postgres text columns reject NUL; PDF glyph maps sometimes emit it.
          .replace(/\u0000/g, '')
          .replace(/[ \t]+/g, ' ')
          .replace(/\s*\n\s*/g, '\n')
          .trim();
        page.cleanup();
        if (text.length === 0) continue; // image-only page
        batch.push({ bookId, printedPage, text });
        if (batch.length >= PAGE_INSERT_CHUNK) await flush();
      }
      await flush();
    } finally {
      await doc.loadingTask.destroy();
    }
    return { scannedPdfPages: scan, totalPdfPages, inserted };
  }
}

// ---------------------------------------------------------------------------
// Seeding (FR11.7) — scan a folder of PDFs, register + extract each
// ---------------------------------------------------------------------------

export interface SeedBooksOptions {
  /** Folder to scan for *.pdf (the 17 rulebooks sit at repo root). */
  dir: string;
  /** Limit to one guessed code (`--only SR5`) — fast targeted runs/tests. */
  only?: string;
  /** Extract at most N PDF pages per book (`--max-pages 40`) — fast tests. */
  maxPages?: number;
  dataDir?: string;
  log?: (line: string) => void;
}

export interface SeedBookResult {
  file: string;
  code: string;
  title: string;
  offset: number;
  bookId: string;
  pagesInserted: number;
  totalPdfPages: number;
}

/** One-shot library import: the folder next to DESIGN.md becomes the app's library. */
export async function seedBooks(db: Db, opts: SeedBooksOptions): Promise<SeedBookResult[]> {
  const log = opts.log ?? (() => undefined);
  const svc = new BooksService(db, opts.dataDir);
  const pdfs = readdirSync(opts.dir)
    .filter((f) => /\.pdf$/i.test(f))
    .sort();
  const results: SeedBookResult[] = [];
  for (const file of pdfs) {
    const guess = guessBookFromFilename(file);
    if (opts.only && guess.code !== opts.only.toUpperCase()) continue;
    const pdfPath = join(opts.dir, file);
    log(`[seed:books] ${file} -> ${guess.code} (offset ${guess.offset >= 0 ? '+' : ''}${guess.offset})`);
    const book = await svc.registerBookFromPdf({
      pdfPath,
      code: guess.code,
      title: guess.title,
      pageOffset: guess.offset,
      shared: true, // library is shared with the table (Q12 / FR11.5)
    });
    const extraction = await svc.extractPages(book.id, pdfPath, {
      pageOffset: book.pageOffset,
      ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
    });
    log(
      `[seed:books]   ${extraction.inserted} pages indexed (${extraction.scannedPdfPages}/${extraction.totalPdfPages} pdf pages scanned)`,
    );
    results.push({
      file,
      code: book.code,
      title: book.title,
      offset: book.pageOffset,
      bookId: book.id,
      pagesInserted: extraction.inserted,
      totalPdfPages: extraction.totalPdfPages,
    });
  }
  return results;
}
