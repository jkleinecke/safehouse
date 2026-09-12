/**
 * books domain plugin — the rules library (M11: FR11.1–11.7) and the FTS
 * substrate the Fixer's rules retrieval sits on (FR12.14).
 *
 * Routes (DESIGN.md §12):
 *   GET    /api/books                 registry listing (shared filter for non-GM)
 *   POST   /api/books                 GM registers an entry
 *   GET    /api/books/search?q=       ranked FTS over extracted pages
 *   GET    /api/books/:id             one registry row
 *   PATCH  /api/books/:id             GM: code/title/offset/shared — calibration
 *   POST   /api/books/:id/detect-offset  GM: measure the offset, propose only
 *   DELETE /api/books/:id             GM
 *   GET    /api/books/:id/pages/:printed   extracted page text (GM; retrieval)
 *   GET    /read/:code?p=426          → { fileUrl, pdfPage } for the web viewer
 *   GET    /files/books/:code         the PDF, with Range support (206)
 *   GET    /api/campaigns/:id/library            bookmarks + recent-refs trail
 *   POST   /api/campaigns/:id/bookmarks          GM: name a page (FR11.6)
 *   PATCH  /api/campaigns/:id/bookmarks/:bmId    GM: rename / pin / re-page
 *   DELETE /api/campaigns/:id/bookmarks/:bmId    GM
 *   POST   /api/campaigns/:id/library/recent     push a ref onto the trail
 *
 * Access: every route is behind a device token; `books.shared === false` is the
 * FR11.5 per-book GM-only toggle, and a campaign-scoped book is only visible to
 * devices bound to that campaign. Global (NULL-campaign) books are table-wide.
 * Range support matters on phones: a reader fetches the byte window for one
 * page, not a 44 MB book (FR11.3).
 */
import { createReadStream, statSync } from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { countBookItems, searchBookPages, type BookPageHit } from '@safehouse/db';
import { assertCampaign, httpError, requireAuth, requireRole } from '../services/auth.js';
import {
  buildOffsetProposal,
  detectOffsetFromDb,
  detectOffsetFromPdf,
  type OffsetDetection,
  type OffsetProposal,
} from '../services/book-offsets.js';
import {
  BooksService,
  parseRangeHeader,
  printedToPdfPage,
  type BookRow,
} from '../services/books.js';
import {
  addBookmark,
  readLibrary,
  recordRecentRef,
  removeBookmark,
  updateBookmark,
  type Bookmark,
} from '../services/bookmarks.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CreateBookBody = z.object({
  code: z.string().min(1).max(8),
  title: z.string().min(1).max(200),
  pageOffset: z.number().int().min(-500).max(500).default(0),
  shared: z.boolean().default(true),
  campaignId: z.string().uuid().nullable().optional(),
  attachmentId: z.string().uuid().nullable().optional(),
});

const PatchBookBody = z
  .object({
    code: z.string().min(1).max(8).optional(),
    title: z.string().min(1).max(200).optional(),
    /** Calibration (FR11.1): nudge until the displayed page matches. */
    pageOffset: z.number().int().min(-500).max(500).optional(),
    /** FR11.5 per-book GM-only toggle. */
    shared: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

/** `POST /api/books/:id/detect-offset` — everything is optional. */
const DetectOffsetBody = z.object({
  /** How many pages to read. More is slower and rarely more certain. */
  maxSample: z.coerce.number().int().min(8).max(200).optional(),
});

const SearchQuery = z.object({
  q: z.string().min(1).max(400),
  book: z.string().min(1).max(8).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** FR11.6 — a named page the table keeps arguing about. */
const CreateBookmarkBody = z.object({
  book: z.string().min(1).max(8),
  page: z.number().int().min(1).max(2000),
  label: z.string().min(1).max(120),
  note: z.string().max(500).optional(),
  pinned: z.boolean().optional(),
});

const PatchBookmarkBody = z
  .object({
    label: z.string().min(1).max(120).optional(),
    note: z.string().max(500).optional(),
    pinned: z.boolean().optional(),
    page: z.number().int().min(1).max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

const RecentRefBody = z.object({
  book: z.string().min(1).max(8),
  page: z.number().int().min(1).max(2000),
  label: z.string().max(120).optional(),
});

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw httpError(400, 'bad_request', 'invalid request', parsed.error.issues);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

interface BookDto {
  id: string;
  code: string;
  title: string;
  campaignId: string | null;
  attachmentId: string | null;
  pageOffset: number;
  shared: boolean;
  /** False for a registry row the GM added by hand but never seeded a PDF for. */
  hasFile: boolean;
  fileUrl: string;
  readUrl: string;
  /**
   * How many pages of this book hold extracted, searchable text.
   *
   * Sent only on the listing, where one grouped count covers every row. The
   * shelf uses it to explain the thing that otherwise reads as a bug: a book
   * whose scans are pure image indexes zero pages, so it is invisible to
   * search and to the Fixer, and the GM deserves to be told that rather than
   * left wondering why their 300-page book never matches anything.
   *
   * There is deliberately no `pdfPages` beside it. Nothing in the schema
   * records a book's PDF page count, and the only way to get one is to open
   * the file — too expensive for a listing, and a guessed number here would be
   * worse than the honest "unknown" the shelf already renders.
   */
  indexedPages?: number;
  /** Items the catalogue read off this book's pages (services/catalogue.ts). */
  catalogueItems?: number;
}

function toDto(row: BookRow, indexedPages?: number, catalogueItems?: number): BookDto {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    campaignId: row.campaignId,
    attachmentId: row.attachmentId,
    pageOffset: row.pageOffset,
    shared: row.shared,
    hasFile: row.attachmentId !== null,
    fileUrl: `/files/books/${encodeURIComponent(row.code)}`,
    readUrl: `/read/${encodeURIComponent(row.code)}`,
    ...(indexedPages !== undefined ? { indexedPages } : {}),
    ...(catalogueItems !== undefined ? { catalogueItems } : {}),
  };
}

/**
 * An offset *proposal* on the wire. Deliberately carries `applied: false` and
 * the exact call that would apply it: detection measures, the GM confirms.
 */
function toOffsetDto(
  book: BookRow,
  proposal: OffsetProposal,
  source: 'pages' | 'pdf',
): Record<string, unknown> {
  const d = proposal.detection;
  return {
    book: { id: book.id, code: book.code, title: book.title },
    source,
    /** Why the weaker source was used, and what that costs the answer. */
    sourceNote:
      source === 'pdf'
        ? null
        : 'measured from indexed pages, not the PDF: those rows are keyed by the offset that was in force when the book was last seeded, so re-seed for an absolute answer',
    applied: false,
    currentOffset: proposal.currentOffset,
    proposedOffset: proposal.proposedOffset,
    wouldChange: proposal.wouldChange,
    status: proposal.status,
    message: proposal.message,
    confidence: Number(d.confidence.toFixed(3)),
    agreed: d.agreed,
    sampled: d.sampled,
    withText: d.withText,
    numbered: d.numbered,
    runnerUp: d.runnerUp,
    evidence: d.evidence,
    skipped: d.skipped,
    reason: d.reason ?? null,
    /** What the "Detect" button's confirm step should send. */
    apply:
      proposal.proposedOffset === null || !proposal.wouldChange
        ? null
        : {
            method: 'PATCH',
            url: `/api/books/${book.id}`,
            body: { pageOffset: proposal.proposedOffset },
          },
  };
}

/**
 * Is this `GET /read/:code` a *browser navigating* to the reader, or a client
 * *fetching* the offset mapping?
 *
 * A navigation sends `Accept: text/html,…` and never asks for JSON; `fetch`
 * defaults to the wildcard Accept, and the app's API client asks for JSON
 * outright. `?format=json` is the explicit override for anything that guesses
 * wrong (curl with `-H 'Accept: text/html'`, a webview with an odd default).
 */
export function wantsSpaShell(req: FastifyRequest): boolean {
  const q = (req.query ?? {}) as Record<string, unknown>;
  if (q['format'] === 'json') return false;
  const accept = req.headers['accept'];
  if (typeof accept !== 'string') return false;
  const lower = accept.toLowerCase();
  if (lower.includes('application/json')) return false;
  return lower.includes('text/html');
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default async function booksPlugin(app: FastifyInstance): Promise<void> {
  const svc = new BooksService(app.db);

  /** Scope used by every read path: this device's campaign + global library. */
  function scopeOf(req: FastifyRequest): { campaignId: string | null; sharedOnly: boolean } {
    const auth = requireAuth(req);
    return { campaignId: auth.campaignId, sharedOnly: auth.role !== 'gm' };
  }

  /** Resolve a book by id or code, enforcing campaign + shared visibility. */
  async function readableBook(
    req: FastifyRequest,
    by: { id?: string; code?: string },
  ): Promise<BookRow> {
    const { campaignId, sharedOnly } = scopeOf(req);
    const row =
      by.id !== undefined
        ? await svc.getBookById(by.id)
        : await svc.getBookByCode(by.code!, campaignId);
    if (!row) throw httpError(404, 'not_found', 'unknown book');
    if (row.campaignId !== null && row.campaignId !== campaignId) {
      throw httpError(403, 'forbidden', 'book belongs to another campaign');
    }
    if (sharedOnly && !row.shared) {
      throw httpError(403, 'forbidden', 'this book is GM-only');
    }
    return row;
  }

  // --- registry -----------------------------------------------------------

  app.get('/api/books', async (req, reply) => {
    const rows = await svc.listBooks(scopeOf(req));
    // One grouped count for the shelf, not one per row. A book with no rows in
    // `book_pages` reports 0 rather than being left silent: "0 indexed" is the
    // answer to "why does search never find anything in this book".
    const indexed = await svc.indexedPageCounts(rows.map((r) => r.id));
    // And how many items the catalogue read off those pages — "0 items" on a
    // rulebook is the answer to "why can nobody add anything from it".
    const items = new Map<string, number>();
    for (const c of await countBookItems(app.db)) items.set(c.bookId, (items.get(c.bookId) ?? 0) + c.items);
    return reply.send({ books: rows.map((r) => toDto(r, indexed.get(r.id) ?? 0, items.get(r.id) ?? 0)) });
  });

  app.post('/api/books', async (req, reply) => {
    const auth = requireRole(req, 'gm');
    const body = parse(CreateBookBody, req.body);
    if (body.campaignId != null) assertCampaign(auth, body.campaignId);
    const created = await svc.createBook({
      code: body.code,
      title: body.title,
      pageOffset: body.pageOffset,
      shared: body.shared,
      campaignId: body.campaignId ?? null,
      attachmentId: body.attachmentId ?? null,
    });
    return reply.status(201).send(toDto(created));
  });

  // --- FTS (FR12.14) — declared before /api/books/:id so the literal wins ---

  app.get('/api/books/search', async (req, reply) => {
    requireAuth(req);
    const query = parse(SearchQuery, req.query);
    const visible = await svc.visibleBookCodes(scopeOf(req));
    if (query.book !== undefined && !visible.has(query.book.toUpperCase())) {
      throw httpError(403, 'forbidden', 'unknown or GM-only book');
    }
    // Over-fetch, then drop hits from books this device may not open (FR11.5).
    const raw: BookPageHit[] = await searchBookPages(app.db, query.q, {
      ...(query.book !== undefined ? { bookCode: query.book.toUpperCase() } : {}),
      limit: query.limit * 3,
    });
    const registry = await svc.booksByCodes([...visible]);
    const hits = raw
      .filter((h) => visible.has(h.bookCode))
      .slice(0, query.limit)
      .map((h) => {
        const book = registry.get(h.bookCode);
        const pageOffset = book?.pageOffset ?? 0;
        return {
          book: h.bookCode,
          bookId: h.bookId,
          title: book?.title ?? h.bookCode,
          page: h.printedPage,
          pdfPage: printedToPdfPage(h.printedPage, pageOffset),
          snippet: h.snippet,
          rank: h.rank,
          ref: `${h.bookCode} p.${h.printedPage}`,
          readUrl: `/read/${encodeURIComponent(h.bookCode)}?p=${h.printedPage}`,
        };
      });
    return reply.send({ query: query.q, hits });
  });

  app.get('/api/books/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(toDto(await readableBook(req, { id })));
  });

  /** Calibration (FR11.1) + the FR11.5 shared toggle — GM only. */
  app.patch('/api/books/:id', async (req, reply) => {
    requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    const patch = parse(PatchBookBody, req.body);
    const existing = await svc.getBookById(id);
    if (!existing) throw httpError(404, 'not_found', 'unknown book');
    const updated = await svc.updateBook(id, patch);
    if (!updated) throw httpError(404, 'not_found', 'unknown book');
    return reply.send(toDto(updated));
  });

  /**
   * Measure this book's page offset (FR11.1) and *propose* it — nothing is
   * written. The GM's "Detect" button shows the number, the confidence and an
   * example ("printed 36 was found on PDF page 41"), then confirms by PATCHing
   * `pageOffset` itself. An offset applied without a human looking is how every
   * ref chip in a book starts opening the wrong page silently.
   *
   * Measured from the PDF in the file store, not from `book_pages`: the
   * indexed rows are keyed by the offset that was in force when they were
   * written, so a book whose offset was changed by hand without a re-seed
   * would have its wrong offset *confirmed* by its own rows. The PDF is the
   * only absolute reference, and reading ~48 of its pages costs under a
   * second. Indexed pages are the fallback for a registry row with no file.
   *
   * The consumer is the GM shelf, `apps/web/src/features/gm/books`: its
   * "detect" button POSTs here and renders `proposedOffset`, `confidence`,
   * `message` and the `evidence` pairs; applying is a second, human click that
   * sends `apply.body` as `PATCH /api/books/:id`. `apply` is null when there is
   * nothing to change (declined, or already correct), and the shelf's "detect
   * all" walks the queue one book at a time — each call holds a whole PDF in
   * memory, so seventeen at once is a 350 MB spike for no gain when a book
   * takes well under a second.
   *
   * After applying, re-extract that book (`pnpm seed:books --only <CODE>`) so
   * `book_pages` is keyed by the new printed numbers; `--calibrate` at seed
   * time avoids the round trip entirely and is what docs/BOOKS.md §2 tells the
   * GM to run for a first import.
   */
  app.post('/api/books/:id/detect-offset', async (req, reply) => {
    requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    const body = parse(DetectOffsetBody, req.body);
    const book = await readableBook(req, { id });
    const sample = body.maxSample !== undefined ? { maxSample: body.maxSample } : {};

    let detection: OffsetDetection | null = null;
    if (book.attachmentId !== null) {
      const attachment = await svc.getAttachment(book.attachmentId);
      if (attachment) {
        try {
          detection = await detectOffsetFromPdf(svc.bookFilePath(attachment), sample);
        } catch {
          detection = null; // file missing from the store — fall back below
        }
      }
    }
    const source: 'pages' | 'pdf' = detection === null ? 'pages' : 'pdf';
    detection ??= await detectOffsetFromDb(app.db, {
      bookId: book.id,
      currentOffset: book.pageOffset,
      ...sample,
    });
    // No `seededOffset` here: the route never writes, so "was this set by a
    // human?" is the confirm dialog's question, not ours.
    const proposal = buildOffsetProposal(detection, { currentOffset: book.pageOffset });
    return reply.send(toOffsetDto(book, proposal, source));
  });

  app.delete('/api/books/:id', async (req, reply) => {
    requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    if (!(await svc.deleteBook(id))) throw httpError(404, 'not_found', 'unknown book');
    return reply.send({ deleted: true, id });
  });

  /** Extracted page text — the Fixer's `get_page` (FR12.17). GM only. */
  app.get('/api/books/:id/pages/:printed', async (req, reply) => {
    requireRole(req, 'gm');
    const { id, printed } = req.params as { id: string; printed: string };
    const book = await readableBook(req, { id });
    const printedPage = Number(printed);
    if (!Number.isInteger(printedPage) || printedPage < 1) {
      throw httpError(400, 'bad_request', 'printed page must be a positive integer');
    }
    const page = await svc.getPageText(book.id, printedPage);
    if (!page) throw httpError(404, 'not_found', 'page not extracted');
    return reply.send({
      book: book.code,
      page: page.printedPage,
      pdfPage: printedToPdfPage(page.printedPage, book.pageOffset),
      text: page.text,
    });
  });

  // --- reader resolution (FR11.3) -----------------------------------------

  /**
   * `GET /read/:code?p=426` — one path, two audiences (DESIGN.md §12 gives this
   * address to the *viewer*; the app's own client needs the mapping behind it).
   *
   * A **browser navigation** — a ref chip's `target="_blank"`, a link pasted
   * into Discord, a refresh — asks for `text/html` and gets the SPA, which
   * mounts the reader at the printed page in `?p=`. That is what makes a ref
   * chip's link shareable at the table.
   *
   * Anything else — `fetch` (wildcard Accept), an explicit `application/json`,
   * or `?format=json` — gets `{ fileUrl, pdfPage }`: the web viewer opens `fileUrl`
   * at `pdfPage` (or follows `viewerUrl`'s `#page=` fragment as the no-JS
   * fallback). Offset resolution stays server-side so a ref chip never has to
   * know a book's front matter.
   *
   * The HTML branch is deliberately ahead of the auth check: `index.html` is
   * public on every other route too, and a 401 in the address bar is a worse
   * answer than the app's own "this book is not shared with your device".
   */
  app.get('/read/:code', async (req, reply) => {
    if (wantsSpaShell(req) && typeof reply.sendFile === 'function') {
      return reply.type('text/html').sendFile('index.html');
    }
    const { code } = req.params as { code: string };
    const book = await readableBook(req, { code });
    const q = (req.query ?? {}) as Record<string, unknown>;
    const rawPrinted = q['p'] ?? q['page'];
    const printedPage = rawPrinted === undefined ? 1 : Number(rawPrinted);
    if (!Number.isInteger(printedPage) || printedPage < 1) {
      throw httpError(400, 'bad_request', 'p must be a positive printed page number');
    }
    const pdfPage = Math.max(1, printedToPdfPage(printedPage, book.pageOffset));
    const fileUrl = `/files/books/${encodeURIComponent(book.code)}`;
    return reply.send({
      bookId: book.id,
      book: book.code,
      title: book.title,
      printedPage,
      pdfPage,
      pageOffset: book.pageOffset,
      fileUrl,
      viewerUrl: `${fileUrl}#page=${pdfPage}`,
    });
  });

  // --- byte-range PDF streaming (FR11.3) ----------------------------------

  app.get('/files/books/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const book = await readableBook(req, { code });
    if (!book.attachmentId) throw httpError(404, 'not_found', 'book has no file');
    const attachment = await svc.getAttachment(book.attachmentId);
    if (!attachment) throw httpError(404, 'not_found', 'book has no file');
    const path = svc.bookFilePath(attachment);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      throw httpError(404, 'not_found', 'book file is missing from the file store');
    }

    const range = parseRangeHeader(req.headers['range'], size);
    void reply
      .header('accept-ranges', 'bytes')
      .header('content-type', attachment.mime || 'application/pdf')
      .header('content-disposition', `inline; filename="${book.code}.pdf"`)
      .header('cache-control', 'private, max-age=3600');

    if (range === 'unsatisfiable') {
      return reply
        .status(416)
        .header('content-type', 'application/json; charset=utf-8')
        .header('content-range', `bytes */${size}`)
        .send({
          error: { code: 'range_not_satisfiable', message: 'requested range is outside the file' },
        });
    }
    if (range === null) {
      return reply.status(200).header('content-length', String(size)).send(createReadStream(path));
    }
    return reply
      .status(206)
      .header('content-range', `bytes ${range.start}-${range.end}/${size}`)
      .header('content-length', String(range.end - range.start + 1))
      .send(createReadStream(path, { start: range.start, end: range.end }));
  });

  // --- bookmarks + the recently-opened trail (FR11.6) ----------------------

  /** GM-only books keep their bookmarks GM-only too (FR11.5). */
  async function visibleCodes(req: FastifyRequest): Promise<Set<string>> {
    return svc.visibleBookCodes(scopeOf(req));
  }

  /** A bookmark plus the one-tap open URL a ref chip uses (FR11.3). */
  async function decorate(rows: Bookmark[]): Promise<unknown[]> {
    const registry = await svc.booksByCodes([...new Set(rows.map((b) => b.book))]);
    return rows.map((b) => {
      const book = registry.get(b.book);
      return {
        ...b,
        ref: `${b.book} p.${b.page}`,
        title: book?.title ?? b.book,
        pdfPage: printedToPdfPage(b.page, book?.pageOffset ?? 0),
        readUrl: `/read/${encodeURIComponent(b.book)}?p=${b.page}`,
      };
    });
  }

  /** The campaign this request may touch — bookmarks are per campaign. */
  function campaignOf(req: FastifyRequest, id: string): string {
    assertCampaign(requireAuth(req), id);
    return id;
  }

  app.get('/api/campaigns/:id/library', async (req, reply) => {
    const { id } = req.params as { id: string };
    const campaignId = campaignOf(req, id);
    const codes = await visibleCodes(req);
    const library = await readLibrary(app.db, campaignId);
    return reply.send({
      bookmarks: await decorate(library.bookmarks.filter((b) => codes.has(b.book))),
      recentRefs: library.recentRefs
        .filter((r) => codes.has(r.book))
        .map((r) => ({
          ...r,
          ref: `${r.book} p.${r.page}`,
          readUrl: `/read/${encodeURIComponent(r.book)}?p=${r.page}`,
        })),
    });
  });

  app.post('/api/campaigns/:id/bookmarks', async (req, reply) => {
    requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    const campaignId = campaignOf(req, id);
    const body = parse(CreateBookmarkBody, req.body);
    // Bookmarking a book this device cannot open would be a dead chip.
    const book = await readableBook(req, { code: body.book });
    const { bookmark } = await addBookmark(app.db, campaignId, {
      book: book.code,
      page: body.page,
      label: body.label,
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
    });
    const [decorated] = await decorate([bookmark]);
    return reply.status(201).send(decorated);
  });

  app.patch('/api/campaigns/:id/bookmarks/:bookmarkId', async (req, reply) => {
    requireRole(req, 'gm');
    const { id, bookmarkId } = req.params as { id: string; bookmarkId: string };
    const campaignId = campaignOf(req, id);
    const patch = parse(PatchBookmarkBody, req.body);
    const { bookmark } = await updateBookmark(app.db, campaignId, bookmarkId, patch);
    const [decorated] = await decorate([bookmark]);
    return reply.send(decorated);
  });

  app.delete('/api/campaigns/:id/bookmarks/:bookmarkId', async (req, reply) => {
    requireRole(req, 'gm');
    const { id, bookmarkId } = req.params as { id: string; bookmarkId: string };
    const campaignId = campaignOf(req, id);
    await removeBookmark(app.db, campaignId, bookmarkId);
    return reply.send({ deleted: true, id: bookmarkId });
  });

  /**
   * The trail: any member who opens a ref adds to it, so "what were we just
   * reading?" survives the argument. Only books this device may open count.
   */
  app.post('/api/campaigns/:id/library/recent', async (req, reply) => {
    const { id } = req.params as { id: string };
    const campaignId = campaignOf(req, id);
    const body = parse(RecentRefBody, req.body);
    const book = await readableBook(req, { code: body.book });
    const library = await recordRecentRef(app.db, campaignId, {
      book: book.code,
      page: body.page,
      ...(body.label !== undefined ? { label: body.label } : {}),
    });
    return reply.status(201).send({ recentRefs: library.recentRefs });
  });
}
