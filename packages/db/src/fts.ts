/**
 * Full-text search helpers (M11 / FR12.14).
 *
 * `book_pages.tsv` is a GENERATED tsvector (english config) with a GIN index;
 * codex search builds its vector on the fly over title + content.
 */
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
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
  bookCode?: string;
  limit?: number;
}

/**
 * Items by name: a substring match on the name OR a word match on
 * name + category, exact names first, then names that start with the query,
 * then the rest by length — so "predator" finds the pistol before the
 * pistol's ammunition, and "heavy pistol" finds every heavy pistol.
 */
export async function searchBookItems(
  db: Db,
  query: string,
  opts: SearchBookItemsOpts = {},
): Promise<BookItemHit[]> {
  const q = query.trim();
  if (q.length === 0) return [];
  const pattern = `%${q.replace(/[\%_]/g, (c) => `\${c}`)}%`;
  const tsq = sql`websearch_to_tsquery('simple', ${q})`;
  const conditions: SQL[] = [sql`(${bookItems.name} ILIKE ${pattern} OR ${bookItems.tsv} @@ ${tsq})`];
  if (opts.kind !== undefined) conditions.push(eq(bookItems.kind, opts.kind));
  if (opts.bookCode !== undefined) conditions.push(eq(books.code, opts.bookCode));
  const tier = sql<number>`CASE WHEN lower(${bookItems.name}) = lower(${q}) THEN 0 WHEN lower(${bookItems.name}) LIKE lower(${q}) || '%' THEN 1 WHEN ${bookItems.name} ILIKE ${pattern} THEN 2 ELSE 3 END`;
  return db
    .select({
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
    })
    .from(bookItems)
    .innerJoin(books, eq(bookItems.bookId, books.id))
    .where(and(...conditions))
    .orderBy(tier, sql`length(${bookItems.name})`, bookItems.name, books.code)
    .limit(opts.limit ?? 20);
}

/** How many items of each kind each book holds — the shelf's "what was read". */
export async function countBookItems(db: Db): Promise<Array<{ bookId: string; kind: string; items: number }>> {
  const rows = await db
    .select({ bookId: bookItems.bookId, kind: bookItems.kind, items: sql<number>`count(*)::int` })
    .from(bookItems)
    .groupBy(bookItems.bookId, bookItems.kind);
  return rows.map((r) => ({ bookId: r.bookId, kind: r.kind, items: Number(r.items) }));
}
