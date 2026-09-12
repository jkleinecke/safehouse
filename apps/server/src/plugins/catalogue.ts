/**
 * The catalogue's routes — find an item, spell or power by name in the books
 * the GM seeded, with its stats and its page (services/catalogue.ts).
 *
 *   GET  /api/catalogue/search?q=&kind=&book=&limit=   any member; GM-only books hidden
 *   GET  /api/catalogue/summary                        items per book per kind
 *   POST /api/books/:id/catalogue                      GM: recompile from the stored pages
 *
 * Visibility is the library's own (FR11.5): an item is readable exactly when
 * the book it came from is, so a GM-only book's gear is not a back door to
 * the book. Nothing here writes to a sheet — acquiring is the sheet's own
 * PATCH, done by the player with the GM (the app keeps the inventory and
 * the stats; how the runner came by it is the table's business).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { countBookItems, searchBookItems, type BookItemHit } from '@safehouse/db';
import { httpError, requireAuth, requireRole } from '../services/auth.js';
import { BooksService, printedToPdfPage } from '../services/books.js';
import { compileCatalogue, ITEM_KINDS } from '../services/catalogue.js';

const SearchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  kind: z.enum(ITEM_KINDS).optional(),
  book: z.string().trim().min(1).max(12).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw httpError(400, 'bad_request', 'invalid request', parsed.error.issues);
  return parsed.data;
}

/** What the client gets: the row plus where to read about it. */
export interface CatalogueHitDto extends BookItemHit {
  title: string;
  pdfPage: number;
  ref: { book: string; page: number };
  readUrl: string;
}

export default async function cataloguePlugin(app: FastifyInstance): Promise<void> {
  const svc = new BooksService(app.db);

  function scopeOf(req: FastifyRequest): { campaignId: string | null; sharedOnly: boolean } {
    const auth = requireAuth(req);
    return { campaignId: auth.campaignId, sharedOnly: auth.role !== 'gm' };
  }

  app.get('/api/catalogue/search', async (req, reply) => {
    const query = parse(SearchQuery, req.query);
    const visible = await svc.visibleBookCodes(scopeOf(req));
    const bookCode = query.book?.toUpperCase();
    if (bookCode !== undefined && !visible.has(bookCode)) {
      throw httpError(403, 'forbidden', 'unknown or GM-only book');
    }
    // Over-fetch, then drop hits from books this device may not open (FR11.5).
    const raw = await searchBookItems(app.db, query.q, {
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(bookCode !== undefined ? { bookCode } : {}),
      limit: query.limit * 3,
    });
    const registry = await svc.booksByCodes([...visible]);
    const hits: CatalogueHitDto[] = raw
      .filter((h) => visible.has(h.bookCode))
      .slice(0, query.limit)
      .map((h) => {
        const book = registry.get(h.bookCode);
        return {
          ...h,
          title: book?.title ?? h.bookCode,
          pdfPage: printedToPdfPage(h.printedPage, book?.pageOffset ?? 0),
          ref: { book: h.bookCode, page: h.printedPage },
          readUrl: `/read/${encodeURIComponent(h.bookCode)}?p=${h.printedPage}`,
        };
      });
    return reply.send({ query: query.q, hits });
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
    const book = await svc.getBookById(id);
    if (!book) throw httpError(404, 'not_found', 'unknown book');
    const summary = await compileCatalogue(app.db, book.id);
    return reply.send({ book: { id: book.id, code: book.code, title: book.title }, ...summary });
  });
}
