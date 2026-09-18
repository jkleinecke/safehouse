/**
 * Full-text search helpers (M11 / FR12.14).
 *
 * `book_pages.tsv` is a GENERATED tsvector (english config) with a GIN index;
 * codex search builds its vector on the fly over title + content.
 */
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from './client.js';
import { bookItems, bookPages, books, wikiPages } from './schema.js';

export interface BookPageHit {
  bookId: string;
  bookCode: string;
  printedPage: number;
  snippet: string;
  rank: number;
}

export interface CodexHit {
  pageId: string;
  title: string;
  snippet: string;
  rank: number;
}

/** Options for book-page full-text search (FR12.14). */
export interface SearchBookPagesOpts {
  bookCode?: string;
  limit?: number;
}

const HEADLINE_OPTS = 'MaxFragments=2, MaxWords=25, MinWords=8, StartSel=**, StopSel=**';

/**
 * Ranked FTS over extracted book pages. Returns printed page numbers (the
 * reader applies the book's page offset). `query` is free text
 * (websearch syntax: quoted phrases, `-exclusions`, `or`).
 */
export async function searchBookPages(
  db: Db,
  query: string,
  opts: SearchBookPagesOpts = {},
): Promise<BookPageHit[]> {
  const q = sql`websearch_to_tsquery('english', ${query})`;
  const conditions: SQL[] = [sql`${bookPages.tsv} @@ ${q}`];
  if (opts.bookCode !== undefined) conditions.push(eq(books.code, opts.bookCode));
  const rank = sql<number>`ts_rank(${bookPages.tsv}, ${q})`;
  const rows = await db
    .select({
      bookId: books.id,
      bookCode: books.code,
      printedPage: bookPages.printedPage,
      snippet: sql<string>`ts_headline('english', ${bookPages.text}, ${q}, ${HEADLINE_OPTS})`,
      rank,
    })
    .from(bookPages)
    .innerJoin(books, eq(bookPages.bookId, books.id))
    .where(and(...conditions))
    .orderBy(desc(rank), books.code, bookPages.printedPage)
    .limit(opts.limit ?? 10);
  return rows;
}

/** Ranked FTS over campaign codex pages (title + markdown content). */
export async function searchCodex(
  db: Db,
  query: string,
  opts: { campaignId?: string; limit?: number } = {},
): Promise<CodexHit[]> {
  const q = sql`websearch_to_tsquery('english', ${query})`;
  const vec = sql`to_tsvector('english', ${wikiPages.title} || ' ' || ${wikiPages.contentMd})`;
  const conditions: SQL[] = [sql`${vec} @@ ${q}`];
  if (opts.campaignId !== undefined) conditions.push(eq(wikiPages.campaignId, opts.campaignId));
  const rank = sql<number>`ts_rank(${vec}, ${q})`;
  const rows = await db
    .select({
      pageId: wikiPages.id,
      title: wikiPages.title,
      snippet: sql<string>`ts_headline('english', ${wikiPages.contentMd}, ${q}, ${HEADLINE_OPTS})`,
      rank,
    })
    .from(wikiPages)
    .where(and(...conditions))
    .orderBy(desc(rank), wikiPages.title)
    .limit(opts.limit ?? 10);
  return rows;
}

// ---------------------------------------------------------------------------
// The catalogue — `book_items` (FR11.2 / §14): pick an item by name
// ---------------------------------------------------------------------------

export interface BookItemHit {
  id: string;
  bookId: string;
  bookCode: string;
  printedPage: number;
  kind: string;
  category: string;
  name: string;
  stats: Record<string, string>;
  avail: string | null;
  cost: number | null;
  costText: string | null;
}

export interface SearchBookItemsOpts {
  kind?: string;
  /** One book, by code — the old single-book filter. */
  bookCode?: string;
  /** Several books by code: an item from any of them. Empty finds nothing. */
  bookCodes?: readonly string[];
  /**
   * Several books by id: what a caller that has already worked out which
   * books a device may open passes, because a code is not unique across
   * campaigns and an id is. Empty finds nothing.
   */
  bookIds?: readonly string[];
  limit?: number;
  /** Rows to skip, for paging; the order is stable, so page two follows page one. */
  offset?: number;
}

/** One page of catalogue rows, and how many rows match in all. */
export interface BookItemPage {
  hits: BookItemHit[];
  total: number;
}

/**
 * `q` as the body of a LIKE pattern. Backslash, `%` and `_` are escaped with
 * a backslash, which is Postgres' default LIKE escape, so "100%" looks for a
 * percent sign and "a_b" for an underscore rather than matching everything.
 * (The first version wrote the replacement as a template string with an
 * escaped dollar sign, so every `%` and `_` in a query became the literal
 * text `${c}` and the name match silently failed.)
 */
function likeBody(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const ITEM_COLUMNS = {
  id: bookItems.id,
  bookId: bookItems.bookId,
  bookCode: books.code,
  printedPage: bookItems.printedPage,
  kind: bookItems.kind,
  category: bookItems.category,
  name: bookItems.name,
  stats: bookItems.stats,
  avail: bookItems.avail,
  cost: bookItems.cost,
  costText: bookItems.costText,
};

/**
 * Items by name: a substring match on the name OR a word match on
 * name + category, exact names first, then names that start with the query,
 * then the rest by length — so "predator" finds the pistol before the
 * pistol's ammunition, and "heavy pistol" finds every heavy pistol.
 *
 * An empty query finds nothing here (the Fixer's tool and the sheet's search
 * box both mean "nothing typed yet"); `findBookItems` is the one that browses.
 */
export async function searchBookItems(
  db: Db,
  query: string,
  opts: SearchBookItemsOpts = {},
): Promise<BookItemHit[]> {
  if (query.trim().length === 0) return [];
  return (await findBookItems(db, query, opts)).hits;
}

/**
 * A page of the catalogue with its total. With a query it ranks as
 * `searchBookItems` does; with none it BROWSES — every row the filters let
 * through, alphabetically — which is how the character builder lists all the
 * qualities or all the cyberware in a campaign's books without inventing a
 * query (docs/CHARGEN.md §8.5). A browse over the whole catalogue is the
 * caller's to allow or refuse; the route insists on a kind.
 *
 * Every order ends on the row id, so offset paging never shows a row twice
 * or skips one between two equally-named rows. The total rides along as a
 * window count in the same query; only a page past the end, which has no row
 * to carry it, costs a second count.
 */
export async function findBookItems(
  db: Db,
  query: string,
  opts: SearchBookItemsOpts = {},
): Promise<BookItemPage> {
  const q = query.trim();
  const conditions: SQL[] = [];
  if (opts.kind !== undefined) conditions.push(eq(bookItems.kind, opts.kind));
  if (opts.bookCode !== undefined) conditions.push(eq(books.code, opts.bookCode));
  if (opts.bookCodes !== undefined) {
    if (opts.bookCodes.length === 0) return { hits: [], total: 0 };
    conditions.push(inArray(books.code, [...opts.bookCodes]));
  }
  if (opts.bookIds !== undefined) {
    if (opts.bookIds.length === 0) return { hits: [], total: 0 };
    conditions.push(inArray(bookItems.bookId, [...opts.bookIds]));
  }
  let order: SQL[];
  if (q.length > 0) {
    const body = likeBody(q);
    const pattern = `%${body}%`;
    const tsq = sql`websearch_to_tsquery('simple', ${q})`;
    conditions.push(sql`(${bookItems.name} ILIKE ${pattern} OR ${bookItems.tsv} @@ ${tsq})`);
    const tier = sql`CASE WHEN lower(${bookItems.name}) = lower(${q}) THEN 0 WHEN lower(${bookItems.name}) LIKE lower(${`${body}%`}) THEN 1 WHEN ${bookItems.name} ILIKE ${pattern} THEN 2 ELSE 3 END`;
    order = [tier, sql`length(${bookItems.name})`, sql`${bookItems.name}`, sql`${books.code}`, sql`${bookItems.printedPage}`, sql`${bookItems.id}`];
  } else {
    order = [sql`lower(${bookItems.name})`, sql`${bookItems.name}`, sql`${books.code}`, sql`${bookItems.printedPage}`, sql`${bookItems.id}`];
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const rows = await db
    .select({ ...ITEM_COLUMNS, total: sql<number>`count(*) over ()` })
    .from(bookItems)
    .innerJoin(books, eq(bookItems.bookId, books.id))
    .where(where)
    .orderBy(...order)
    .limit(opts.limit ?? 20)
    .offset(offset);
  if (rows.length > 0) {
    const total = Number(rows[0]!.total);
    const hits: BookItemHit[] = rows.map((r) => ({
      id: r.id,
      bookId: r.bookId,
      bookCode: r.bookCode,
      printedPage: r.printedPage,
      kind: r.kind,
      category: r.category,
      name: r.name,
      stats: r.stats,
      avail: r.avail,
      cost: r.cost,
      costText: r.costText,
    }));
    return { hits, total };
  }
  if (offset === 0) return { hits: [], total: 0 };
  const counted = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookItems)
    .innerJoin(books, eq(bookItems.bookId, books.id))
    .where(where);
  return { hits: [], total: Number(counted[0]?.n ?? 0) };
}

/** How many items of each kind each book holds — the shelf's "what was read". */
export async function countBookItems(db: Db): Promise<Array<{ bookId: string; kind: string; items: number }>> {
  const rows = await db
    .select({ bookId: bookItems.bookId, kind: bookItems.kind, items: sql<number>`count(*)::int` })
    .from(bookItems)
    .groupBy(bookItems.bookId, bookItems.kind);
  return rows.map((r) => ({ bookId: r.bookId, kind: r.kind, items: Number(r.items) }));
}
