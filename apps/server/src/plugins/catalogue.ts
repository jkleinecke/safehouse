/**
 * The catalogue's routes — find an item, spell or power by name in the books
 * the GM seeded, with its stats and its page (services/catalogue.ts).
 *
 *   GET  /api/catalogue/search?q=&kind=&book=&books=&offset=&limit=&campaignId=
 *                                                      any member; GM-only books hidden
 *   GET  /api/catalogue/summary                        items per book per kind
 *   POST /api/books/:id/catalogue                      GM: recompile from the stored pages
 *
 * Visibility is the library's own (FR11.5): an item is readable exactly when
 * the book it came from is, so a GM-only book's gear is not a back door to
 * the book. Nothing here writes to a sheet — acquiring is the sheet's own
 * PATCH, done by the player with the GM (the app keeps the inventory and
 * the stats; how the runner came by it is the table's business).
 *
 * Search has two modes. With `q` it ranks by name, as the sheet's search box
 * always has. With a `kind` and no `q` it BROWSES that kind alphabetically —
 * the character builder's "every quality", "every piece of cyberware" — and
 * pages with `offset`/`limit`, answering `total` and `hasMore` so a list can
 * say how long it is. A browse without a kind is refused: the whole catalogue
 * in one list is nobody's picker. `books=SR5,RF` narrows to several books;
 * the older single `book=` still works and joins them.
 *
 * `campaignId` asks for the builder's view (docs/CHARGEN.md §8.5): only the
 * books that campaign's character creation allows (`settings.chargen.books`,
 * and when that list is empty, every shared book). The device must be bound
 * to that campaign. The campaign a device belongs to is still its token's —
 * the parameter is a request for a narrower list, never a way into another
 * campaign's books — and a GM-only book on the allowed list stays closed to
 * a player: the list narrows what a device may open, it never widens it.
 *
 * Which books a device may open is worked out first and handed to the query
 * by id, so paging and the total count only visible rows. (The first version
 * over-fetched three times the limit and filtered afterwards, which cannot
 * page, and matched books by code, which is not unique across campaigns.)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ChargenSettingsSchema } from '@safehouse/contracts';
import { countBookItems, findBookItems, type BookItemHit } from '@safehouse/db';
import { assertCampaign, httpError, requireAuth, requireRole } from '../services/auth.js';
import { BooksService, printedToPdfPage, type BookRow } from '../services/books.js';
import { compileCatalogue, ITEM_KINDS } from '../services/catalogue.js';
import { campaignSettings } from '../services/discord.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The longest code a request may name: the shelf stores at most 8, chargen settings at most 12. */
const MAX_BOOK_CODE = 12;
const MAX_BOOKS = 32;

const SearchQuery = z
  .object({
    q: z.string().trim().max(120).default(''),
    kind: z.enum(ITEM_KINDS).optional(),
    book: z.string().trim().min(1).max(12).optional(),
    /** Comma-separated book codes: "SR5,RF". */
    books: z.string().trim().max(400).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    campaignId: z.string().trim().regex(UUID_RE, 'campaignId must be a campaign id').optional(),
  })
  .refine((v) => v.q.length > 0 || v.kind !== undefined, {
    message: 'give a query, or a kind to browse',
    path: ['q'],
  });

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid request', parsed.error.issues);
  return parsed.data;
}

/**
 * The codes a request names, upper-cased and de-duplicated: `book=` and
 * `books=` together. A code is checked for length only. The shelf accepts
 * any code of up to 8 characters ("R&G", "SR5 GM"), so a narrower pattern
 * here would leave books on the shelf that search could not name; the codes
 * reach SQL only as bound parameters, so an odd one is just an unknown book.
 */
export function requestedBookCodes(book: string | undefined, books: string | undefined): string[] | null {
  const codes = [book ?? '', ...(books ?? '').split(',')].map((c) => c.trim().toUpperCase()).filter((c) => c.length > 0);
  if (codes.length === 0) return null;
  const bad = codes.find((c) => c.length > MAX_BOOK_CODE);
  if (bad !== undefined) throw httpError(400, 'bad_request', `"${bad}" is not a book code`);
  const unique = [...new Set(codes)];
  if (unique.length > MAX_BOOKS) throw httpError(400, 'bad_request', `at most ${MAX_BOOKS} books at once`);
  return unique;
}

/** What the client gets: the row plus where to read about it. */
export interface CatalogueHitDto extends BookItemHit {
  title: string;
  pdfPage: number;
  ref: { book: string; page: number };
  readUrl: string;
}

/** One page of a search or a browse. */
export interface CatalogueSearchDto {
  /** The query as searched; empty for a browse. */
  query: string;
  hits: CatalogueHitDto[];
  /** Every row that matches, across all pages. */
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export default async function cataloguePlugin(app: FastifyInstance): Promise<void> {
  const svc = new BooksService(app.db);

  function scopeOf(req: FastifyRequest): { campaignId: string | null; sharedOnly: boolean } {
    const auth = requireAuth(req);
    return { campaignId: auth.campaignId, sharedOnly: auth.role !== 'gm' };
  }

  /** The books a character-creation catalogue draws on: the allowed list, or every shared book when it is empty. */
  async function chargenBooks(campaignId: string, visible: readonly BookRow[]): Promise<BookRow[]> {
    const parsed = ChargenSettingsSchema.safeParse((await campaignSettings(app.db, campaignId))['chargen'] ?? {});
    const allowed = new Set((parsed.success ? parsed.data.books : []).map((c) => c.trim().toUpperCase()));
    return allowed.size === 0 ? visible.filter((b) => b.shared) : visible.filter((b) => allowed.has(b.code.toUpperCase()));
  }

  app.get('/api/catalogue/search', async (req, reply) => {
    const auth = requireAuth(req);
    const query = parse(SearchQuery, req.query);
    const requested = requestedBookCodes(query.book, query.books);
    if (query.campaignId !== undefined) assertCampaign(auth, query.campaignId);

    const visible = await svc.listBooks(scopeOf(req));
    const visibleCodes = new Set(visible.map((b) => b.code.toUpperCase()));
    let pool = query.campaignId !== undefined ? await chargenBooks(query.campaignId, visible) : visible;
    if (requested !== null) {
      for (const code of requested) {
        if (!visibleCodes.has(code)) throw httpError(403, 'forbidden', 'unknown or GM-only book');
        if (!pool.some((b) => b.code.toUpperCase() === code)) {
          throw httpError(403, 'forbidden', `${code} is not one of this campaign's character-creation books`);
        }
      }
      pool = pool.filter((b) => requested.includes(b.code.toUpperCase()));
    }

    const page = await findBookItems(app.db, query.q, {
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      bookIds: pool.map((b) => b.id),
      offset: query.offset,
      limit: query.limit,
    });
    const registry = new Map(pool.map((b) => [b.id, b]));
    const hits: CatalogueHitDto[] = page.hits.map((h) => {
      const book = registry.get(h.bookId);
      return {
        ...h,
        title: book?.title ?? h.bookCode,
        pdfPage: printedToPdfPage(h.printedPage, book?.pageOffset ?? 0),
        ref: { book: h.bookCode, page: h.printedPage },
        readUrl: `/read/${encodeURIComponent(h.bookCode)}?p=${h.printedPage}`,
      };
    });
    const body: CatalogueSearchDto = {
      query: query.q,
      hits,
      total: page.total,
      offset: query.offset,
      limit: query.limit,
      hasMore: query.offset + hits.length < page.total,
    };
    return reply.send(body);
  });

  app.get('/api/catalogue/summary', async (req, reply) => {
    const books = await svc.listBooks(scopeOf(req));
    const counts = await countBookItems(app.db);
    const byBook = new Map<string, { items: number; byKind: Record<string, number> }>();
    for (const c of counts) {
      const entry = byBook.get(c.bookId) ?? { items: 0, byKind: {} };
      entry.items += c.items;
      entry.byKind[c.kind] = (entry.byKind[c.kind] ?? 0) + c.items;
      byBook.set(c.bookId, entry);
    }
    return reply.send({
      books: books.map((b) => ({ bookId: b.id, code: b.code, title: b.title, ...(byBook.get(b.id) ?? { items: 0, byKind: {} }) })),
      total: books.reduce((n, b) => n + (byBook.get(b.id)?.items ?? 0), 0),
    });
  });

  app.post('/api/books/:id/catalogue', async (req, reply) => {
    requireRole(req, 'gm');
    const { id } = req.params as { id: string };
    // A malformed id would reach Postgres as a cast error and answer 500.
    if (!UUID_RE.test(id)) throw httpError(404, 'not_found', 'unknown book');
    const book = await svc.getBookById(id);
    if (!book) throw httpError(404, 'not_found', 'unknown book');
    const summary = await compileCatalogue(app.db, book.id);
    return reply.send({ book: { id: book.id, code: book.code, title: book.title }, ...summary });
  });
}
