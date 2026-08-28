/**
 * Full-text search helpers (M11 / FR12.14).
 *
 * `book_pages.tsv` is a GENERATED tsvector (english config) with a GIN index;
 * codex search builds its vector on the fly over title + content.
 */
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from './client.js';
import { bookPages, books, wikiPages } from './schema.js';

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
