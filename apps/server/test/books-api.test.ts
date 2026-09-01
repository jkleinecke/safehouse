/**
 * M11 end-to-end: seed the real core rulebook (`--only SR5 --max-pages 40`)
 * from the repo root into a throwaway PGlite + temp file store, then exercise
 * the library API — FTS retrieval (FR12.14), offset resolution (FR11.1),
 * byte-range PDF streaming (FR11.3), the shared toggle (FR11.5) and CRUD.
 *
 * The PDFs are the GM's own copies and are gitignored, so the suite SKIPS
 * gracefully when the core rulebook is not sitting next to DESIGN.md.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { seedBooks, type SeedBookResult } from '../src/services/books.js';
import { bootstrapCampaign, joinAs, makeTestApp, type TestApp } from './core-helpers.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The rulebook corpus moved from the repo root into `books/`. These tests skip
 * gracefully when a PDF is absent, so a stale path would not fail — it would
 * quietly stop testing, which is worse. Prefer `books/`, fall back to the root.
 */
const BOOKS_DIR = existsSync(`${REPO_ROOT}books`) ? `${REPO_ROOT}books/` : REPO_ROOT;
function booksPath(name: string): string {
  return `${BOOKS_DIR}${name}`;
}
const CORE_PDF = booksPath('shadowrunfiftheditioncorerulebook_V2.pdf');
const HAVE_CORE = existsSync(CORE_PDF);

/** `--max-pages 40` at offset +5 covers printed pages 1–35. */
const MAX_PAGES = 40;
const LAST_PRINTED = MAX_PAGES - 5;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe.skipIf(!HAVE_CORE)('books library API (M11)', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let gmToken: string;
  let playerToken: string;
  let campaignId: string;
  let seeded: SeedBookResult;
  let bookId: string;

  beforeAll(async () => {
    t = await makeTestApp('books');
    app = t.app;
    const boot = await bootstrapCampaign(app, 'Blackout Rain');
    gmToken = boot.gmToken;
    campaignId = boot.campaignId;
    playerToken = (await joinAs(app, campaignId, gmToken, 'player', 'Wisp')).token;

    const results = await seedBooks(t.db, {
      dir: BOOKS_DIR,
      only: 'SR5',
      maxPages: MAX_PAGES,
      dataDir: t.dataDir,
    });
    expect(results, 'seed --only SR5 registered exactly one book').toHaveLength(1);
    seeded = results[0]!;
    bookId = seeded.bookId;
  }, 300_000);

  afterAll(async () => {
    await t?.close();
  });

  // --- seeding (FR11.7) ---------------------------------------------------

  it('registers the core rulebook with the measured +5 offset', () => {
    expect(seeded.code).toBe('SR5');
    expect(seeded.offset).toBe(5);
    expect(seeded.totalPdfPages).toBeGreaterThan(400);
  });

  it('extracts only the scanned window, skipping front matter', () => {
    // pdf 1–5 have no printed number; the rest carry text.
    expect(seeded.pagesInserted).toBeGreaterThan(20);
    expect(seeded.pagesInserted).toBeLessThanOrEqual(LAST_PRINTED);
  });

  it('lists the book for the whole table (FR11.5 shared)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/books', headers: auth(playerToken) });
    expect(res.statusCode).toBe(200);
    const { books } = res.json() as { books: Array<Record<string, unknown>> };
    const sr5 = books.find((b) => b['code'] === 'SR5');
    expect(sr5).toBeDefined();
    expect(sr5!['shared']).toBe(true);
    expect(sr5!['pageOffset']).toBe(5);
    expect(sr5!['hasFile']).toBe(true);
    expect(sr5!['fileUrl']).toBe('/files/books/SR5');
  });

  it('refuses unauthenticated access to the library', async () => {
    for (const url of ['/api/books', '/read/SR5?p=10', '/files/books/SR5']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect((res.json() as { error: { code: string } }).error.code).toBe('unauthorized');
    }
  });

  // --- retrieval (FR12.14) ------------------------------------------------

  it('full-text searches the extracted pages and returns page provenance', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/books/search?q=shadowrun&limit=5',
      headers: auth(playerToken),
    });
    expect(res.statusCode).toBe(200);
    const { hits } = res.json() as {
      hits: Array<{ book: string; page: number; pdfPage: number; snippet: string; ref: string }>;
    };
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.book).toBe('SR5');
      expect(hit.page).toBeGreaterThanOrEqual(1);
      expect(hit.page).toBeLessThanOrEqual(LAST_PRINTED);
      // Provenance comes from the retrieval layer, never the model (FR12.2).
      expect(hit.pdfPage).toBe(hit.page + 5);
      expect(hit.ref).toBe(`SR5 p.${hit.page}`);
      expect(hit.snippet.length).toBeGreaterThan(0);
    }
  });

  it('returns no hits for a phrase outside the scanned window', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/books/search?q=%22zzqx%20nonexistent%20phrase%22',
      headers: auth(gmToken),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { hits: unknown[] }).hits).toEqual([]);
  });

  it('rejects a search with no query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/books/search',
      headers: auth(gmToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('serves one extracted page to the GM (the Fixer get_page tool)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/books/${bookId}/pages/10`,
      headers: auth(gmToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { book: string; page: number; pdfPage: number; text: string };
    expect(body.book).toBe('SR5');
    expect(body.pdfPage).toBe(15);
    expect(body.text.length).toBeGreaterThan(0);

    const denied = await app.inject({
      method: 'GET',
      url: `/api/books/${bookId}/pages/10`,
      headers: auth(playerToken),
    });
    expect(denied.statusCode).toBe(403);
  });

  // --- reader resolution (FR11.1/FR11.3) ----------------------------------

  it('resolves printed 426 to PDF page 431', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/read/SR5?p=426',
      headers: auth(playerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      book: string;
      printedPage: number;
      pdfPage: number;
      pageOffset: number;
      fileUrl: string;
      viewerUrl: string;
    };
    expect(body.book).toBe('SR5');
    expect(body.printedPage).toBe(426);
    expect(body.pdfPage).toBe(431);
    expect(body.pageOffset).toBe(5);
    expect(body.fileUrl).toBe('/files/books/SR5');
    expect(body.viewerUrl).toBe('/files/books/SR5#page=431');
  });

  it('accepts ?token= so a phone can open a ref chip directly', async () => {
    const res = await app.inject({ method: 'GET', url: `/read/SR5?p=195&token=${playerToken}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { pdfPage: number }).pdfPage).toBe(200);
  });

  it('rejects a nonsense printed page and an unknown code', async () => {
    const bad = await app.inject({
      method: 'GET',
      url: '/read/SR5?p=zero',
      headers: auth(gmToken),
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'GET',
      url: '/read/NOPE?p=1',
      headers: auth(gmToken),
    });
    expect(missing.statusCode).toBe(404);
  });

  // --- byte-range streaming (FR11.3) --------------------------------------

  it('serves the whole PDF with Accept-Ranges advertised', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/files/books/SR5',
      headers: auth(playerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
  });

  it('answers a Range request with 206 and just that window', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/files/books/SR5',
      headers: { ...auth(playerToken), range: 'bytes=0-1023' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.rawPayload.length).toBe(1024);
    expect(Number(res.headers['content-length'])).toBe(1024);
    const contentRange = String(res.headers['content-range']);
    expect(contentRange).toMatch(/^bytes 0-1023\/\d+$/);
    const total = Number(contentRange.split('/')[1]);
    expect(total).toBeGreaterThan(1024 * 1024); // the real book, not a stub
    expect(res.rawPayload.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('serves a mid-file window (how a phone fetches one page)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/files/books/SR5',
      headers: { ...auth(playerToken), range: 'bytes=1048576-1050575' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.rawPayload.length).toBe(2000);
    expect(res.headers['content-range']).toMatch(/^bytes 1048576-1050575\/\d+$/);
  });

  it('answers an out-of-bounds range with 416', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/files/books/SR5',
      headers: { ...auth(playerToken), range: 'bytes=99999999999-' },
    });
    expect(res.statusCode).toBe(416);
    expect(res.headers['content-range']).toMatch(/^bytes \*\/\d+$/);
  });

  // --- calibration + CRUD (FR11.1/FR11.5) ---------------------------------

  it('PATCHes the page offset and the reader follows (calibration)', async () => {
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/books/${bookId}`,
      headers: auth(gmToken),
      payload: { pageOffset: 7 },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { pageOffset: number }).pageOffset).toBe(7);

    const read = await app.inject({
      method: 'GET',
      url: '/read/SR5?p=426',
      headers: auth(gmToken),
    });
    expect((read.json() as { pdfPage: number }).pdfPage).toBe(433);

    // Nudge back to the measured value.
    const restored = await app.inject({
      method: 'PATCH',
      url: `/api/books/${bookId}`,
      headers: auth(gmToken),
      payload: { pageOffset: 5 },
    });
    expect((restored.json() as { pageOffset: number }).pageOffset).toBe(5);
  });

  it('PATCHes shared=false to back-pocket a book from the table', async () => {
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/books/${bookId}`,
      headers: auth(gmToken),
      payload: { shared: false },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { shared: boolean }).shared).toBe(false);

    for (const url of ['/read/SR5?p=426', '/files/books/SR5', `/api/books/${bookId}`]) {
      const denied = await app.inject({ method: 'GET', url, headers: auth(playerToken) });
      expect(denied.statusCode, url).toBe(403);
    }
    const listed = await app.inject({
      method: 'GET',
      url: '/api/books',
      headers: auth(playerToken),
    });
    expect((listed.json() as { books: unknown[] }).books).toHaveLength(0);
    const search = await app.inject({
      method: 'GET',
      url: '/api/books/search?q=shadowrun',
      headers: auth(playerToken),
    });
    expect((search.json() as { hits: unknown[] }).hits).toEqual([]);

    // The GM still reads it, and the search still finds it.
    const gmRead = await app.inject({
      method: 'GET',
      url: '/read/SR5?p=426',
      headers: auth(gmToken),
    });
    expect(gmRead.statusCode).toBe(200);
    const gmSearch = await app.inject({
      method: 'GET',
      url: '/api/books/search?q=shadowrun',
      headers: auth(gmToken),
    });
    expect((gmSearch.json() as { hits: unknown[] }).hits.length).toBeGreaterThan(0);

    await app.inject({
      method: 'PATCH',
      url: `/api/books/${bookId}`,
      headers: auth(gmToken),
      payload: { shared: true },
    });
  });

  it('keeps calibration out of player hands', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/books/${bookId}`,
      headers: auth(playerToken),
      payload: { pageOffset: 99 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('re-seeding refreshes the file but preserves GM calibration', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/api/books/${bookId}`,
      headers: auth(gmToken),
      payload: { pageOffset: 5, shared: true },
    });
    const again = await seedBooks(t.db, {
      dir: BOOKS_DIR,
      only: 'SR5',
      maxPages: 8,
      dataDir: t.dataDir,
    });
    expect(again[0]!.bookId).toBe(bookId);
    expect(again[0]!.offset).toBe(5);
    // maxPages 8 at offset +5 leaves printed pages 1–3 only.
    expect(again[0]!.pagesInserted).toBeLessThanOrEqual(3);
  }, 300_000);

  it('creates and deletes a registry entry with no file yet', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/books',
      headers: auth(gmToken),
      payload: { code: 'RG', title: 'Run & Gun', pageOffset: 0, shared: true },
    });
    expect(created.statusCode).toBe(201);
    const rg = created.json() as { id: string; code: string; readUrl: string; hasFile: boolean };
    expect(rg.code).toBe('RG');
    expect(rg.readUrl).toBe('/read/RG');
    expect(rg.hasFile).toBe(false);

    // Registered but unseeded: the reader resolves, the file 404s.
    const read = await app.inject({ method: 'GET', url: '/read/RG?p=62', headers: auth(gmToken) });
    expect((read.json() as { pdfPage: number }).pdfPage).toBe(62);
    const file = await app.inject({
      method: 'GET',
      url: '/files/books/RG',
      headers: auth(gmToken),
    });
    expect(file.statusCode).toBe(404);

    const gone = await app.inject({
      method: 'DELETE',
      url: `/api/books/${rg.id}`,
      headers: auth(gmToken),
    });
    expect(gone.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: `/api/books/${rg.id}`,
      headers: auth(gmToken),
    });
    expect(after.statusCode).toBe(404);
  });

  it('refuses book creation from a player', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/books',
      headers: auth(playerToken),
      payload: { code: 'SG', title: 'Street Grimoire' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe.skipIf(HAVE_CORE)('books library API (M11) — skipped', () => {
  it('needs the core rulebook PDF beside DESIGN.md', () => {
    expect(HAVE_CORE).toBe(false);
  });
});
