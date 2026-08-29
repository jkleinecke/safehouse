/**
 * `GET /read/:code` serves two audiences on one address (FR11.3, DESIGN §12).
 *
 * The collision this pins down is real and was found by driving the app: the
 * spec gives `/read/:bookCode?p=426` to the *viewer*, while the server had
 * already claimed it for the printed→PDF offset mapping and listed `/read` in
 * `API_PREFIXES`, so the SPA fallback never saw it. Every cold load of a ref
 * chip — `target="_blank"`, a link pasted into Discord, a refresh — was
 * answered with JSON instead of a book, which is the single most-used ref
 * affordance in the app.
 *
 * The rule under test: a request that asks for `text/html` gets the SPA shell;
 * everything else — a `fetch`, an explicit `application/json`, `?format=json` —
 * still gets the mapping. Both halves matter, so both are asserted here, and
 * the JSON half is asserted on the exact numbers the GM measured (SR5 printed
 * 426 → PDF 431, offset +5).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { wantsSpaShell } from '../src/plugins/books.js';
import { bootstrapCampaign, joinAs, makeTestApp, type TestApp } from './core-helpers.js';

const SPA_MARKER = '<div id="root"><!-- safehouse spa --></div>';
const HTML = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let t: TestApp;
let app: FastifyInstance;
let gmToken: string;
let playerToken: string;

beforeAll(async () => {
  t = await makeTestApp('reader-route');
  // A stand-in for `apps/web/dist`: the reader route only needs *an*
  // index.html, and building the real SPA inside a unit test would be absurd.
  const webDist = mkdtempSync(join(tmpdir(), 'safehouse-webdist-'));
  writeFileSync(join(webDist, 'index.html'), `<!doctype html><html><body>${SPA_MARKER}</body></html>`);
  await t.app.close();
  app = await buildApp({ db: t.db, webDist, logger: false });

  const boot = await bootstrapCampaign(app, 'Paper Trail');
  gmToken = boot.gmToken;
  playerToken = (await joinAs(app, boot.campaignId, gmToken, 'player', 'Wisp')).token;

  const created = await app.inject({
    method: 'POST',
    url: '/api/books',
    headers: auth(gmToken),
    payload: { code: 'SR5', title: 'Core rulebook (the GM’s own copy)', pageOffset: 5 },
  });
  expect(created.statusCode).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('wantsSpaShell (the negotiation rule itself)', () => {
  const req = (accept?: string, query: Record<string, unknown> = {}) =>
    ({ headers: accept === undefined ? {} : { accept }, query }) as never;

  it('says yes to a browser navigation', () => {
    expect(wantsSpaShell(req(HTML.accept))).toBe(true);
    expect(wantsSpaShell(req('text/html'))).toBe(true);
  });

  it('says no to fetch, to an explicit JSON ask, and to no Accept at all', () => {
    // `fetch` defaults to the wildcard; the app's API client asks for JSON.
    expect(wantsSpaShell(req('*/*'))).toBe(false);
    expect(wantsSpaShell(req('application/json'))).toBe(false);
    expect(wantsSpaShell(req('text/html,application/json'))).toBe(false);
    expect(wantsSpaShell(req(undefined))).toBe(false);
  });

  it('honours ?format=json as the override for a client that guesses wrong', () => {
    expect(wantsSpaShell(req(HTML.accept, { format: 'json' }))).toBe(false);
  });
});

describe('GET /read/:code — the viewer half', () => {
  it('serves the SPA shell to a browser navigating to a ref chip', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/read/SR5?p=426',
      headers: { ...auth(playerToken), ...HTML },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(SPA_MARKER);
  });

  it('serves it to a cold, tokenless tab too — the app explains itself better than a 401 does', async () => {
    const res = await app.inject({ method: 'GET', url: '/read/SR5?p=426', headers: HTML });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(SPA_MARKER);
  });

  it('serves it for an unregistered book rather than a raw 404 envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/read/NOPE?p=1', headers: HTML });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(SPA_MARKER);
  });
});

describe('GET /read/:code — the mapping half still works', () => {
  it('answers a fetch with the offset mapping: printed 426 → PDF 431', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/read/SR5?p=426',
      headers: { ...auth(playerToken), accept: '*/*' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      book: 'SR5',
      printedPage: 426,
      pdfPage: 431,
      pageOffset: 5,
      fileUrl: '/files/books/SR5',
    });
  });

  it('answers ?format=json even when the Accept header says html', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/read/SR5?p=426&format=json',
      headers: { ...auth(gmToken), ...HTML },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { pdfPage: number }).pdfPage).toBe(431);
  });

  it('keeps its guards on the JSON path: a bad page 400s, an unknown book 404s', async () => {
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
});
