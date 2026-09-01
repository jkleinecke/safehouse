/**
 * What the books shelf can honestly say about a book (M11 / FR11.7).
 *
 * `GET /api/books` reports `indexedPages` — how many pages of a book hold
 * extracted, searchable text. The number exists to explain the one failure
 * that looks exactly like success: a registered, seeded book of pure image
 * scans indexes nothing, so FTS never matches it and the Fixer can never cite
 * it, while every other field on the row says the book is fine.
 *
 * Deliberately narrow. There is no PDF page count anywhere in the schema, so
 * the DTO does not invent one, and the shelf renders "unknown" rather than a
 * fabricated total. This suite pins both halves: the count is real, and the
 * fields nothing can source are genuinely absent.
 *
 * No PDF required — the rows go in directly, which is also the only way to
 * make the zero-indexed case on purpose.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookPages } from '@safehouse/db';
import { bootstrapCampaign, joinAs, makeTestApp, type TestApp } from './core-helpers.js';

let t: TestApp;
let gmToken: string;
let campaignId: string;

interface ShelfBook {
  id: string;
  code: string;
  title: string;
  hasFile: boolean;
  pageOffset: number;
  indexedPages?: number;
  pdfPages?: number;
  offsetSource?: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function shelf(token = gmToken): Promise<ShelfBook[]> {
  const res = await t.app.inject({ method: 'GET', url: '/api/books', headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return (res.json() as { books: ShelfBook[] }).books;
}

async function register(code: string, title: string): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/books',
    headers: auth(gmToken),
    payload: { code, title, campaignId, shared: true },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

beforeAll(async () => {
  t = await makeTestApp('books-shelf');
  const boot = await bootstrapCampaign(t.app, 'Ash Tuesday');
  gmToken = boot.gmToken;
  campaignId = boot.campaignId;
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe('indexed page counts on the shelf', () => {
  let indexedId: string;
  let bareId: string;

  beforeAll(async () => {
    indexedId = await register('IDX', 'A book that extracted cleanly');
    bareId = await register('IMG', 'A book of photographs of a book');
    await t.db.insert(bookPages).values(
      [11, 12, 13, 14].map((printedPage) => ({
        bookId: indexedId,
        printedPage,
        text: `page ${printedPage}: original filler written for this test`,
      })),
    );
  });

  it('counts the pages that actually hold text', async () => {
    const rows = await shelf();
    expect(rows.find((b) => b.id === indexedId)?.indexedPages).toBe(4);
  });

  /**
   * The point of the whole field: this book is registered, shared and looks
   * healthy, and it will never match a search. Zero has to be *reported*, not
   * omitted — an absent field reads as "not measured".
   */
  it('reports a hard zero for a book that indexed nothing', async () => {
    const rows = await shelf();
    const bare = rows.find((b) => b.id === bareId);
    expect(bare?.indexedPages).toBe(0);
    expect(bare?.indexedPages).not.toBeUndefined();
  });

  /** One grouped count, so a bigger shelf is not a bigger page load. */
  it('answers for every row of the shelf in one listing', async () => {
    const rows = await shelf();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(typeof row.indexedPages).toBe('number');
  });

  /**
   * Nothing in the schema records a PDF page count or where an offset came
   * from, so the DTO must not claim either. A guessed number here would be
   * worse than the honest "unknown" the shelf renders.
   */
  it('invents neither a PDF page count nor an offset provenance', async () => {
    for (const row of await shelf()) {
      expect(row.pdfPages).toBeUndefined();
      expect(row.offsetSource).toBeUndefined();
    }
  });

  /** The single-book route carries no count — only the listing pays for one. */
  it('does not put a count on the single-book route', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/books/${indexedId}`,
      headers: auth(gmToken),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ShelfBook).indexedPages).toBeUndefined();
  });

  /** FR11.5 scoping is unchanged: the count rides on rows a device may see. */
  it('reaches a player only on the books that player can see', async () => {
    const player = await joinAs(t.app, campaignId, gmToken, 'player', 'Wisp');
    const patched = await t.app.inject({
      method: 'PATCH',
      url: `/api/books/${bareId}`,
      headers: auth(gmToken),
      payload: { shared: false },
    });
    expect(patched.statusCode).toBe(200);

    const seen = await shelf(player.token);
    expect(seen.some((b) => b.id === bareId)).toBe(false);
    expect(seen.find((b) => b.id === indexedId)?.indexedPages).toBe(4);
  });
});
