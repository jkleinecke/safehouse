/**
 * How the web build and the API go over the wire: compressed, and cached for
 * exactly as long as a file can be trusted.
 *
 * Before this the 1.2 MB entry bundle and the 1.4 MB pdf.js worker went out
 * as raw bytes on every load, and nothing said how long a browser could keep
 * them — so a phone at the table either re-downloaded megabytes or kept a
 * bundle past a rebuild. The rules pinned here:
 *
 *  - Hashed build assets are immutable for a year; everything that keeps its
 *    name across builds (index.html, pdf.js) is revalidated every time.
 *  - The build's precompressed siblings are what a browser gets, by its own
 *    Accept-Encoding, with `Vary` saying so.
 *  - Text the build did not precompress, and API JSON, are compressed on the
 *    way out; small responses and non-text bytes are not.
 *  - A missing build asset is a 404, not the SPA shell.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, COMPRESSIBLE, webCacheControl } from '../src/app.js';
import { bootstrapCampaign, makeTestApp, type TestApp } from './core-helpers.js';

const BUNDLE = `export const lines = [\n${Array.from({ length: 400 }, (_, i) => `  "line ${i} of a bundle",`).join('\n')}\n];\n`;
const WORKER = `// pdf.js stand-in\n${'self.onmessage = () => {};\n'.repeat(200)}`;
const IMMUTABLE = 'public, max-age=31536000, immutable';

let t: TestApp;
let app: FastifyInstance;
let dist: string;

beforeAll(async () => {
  t = await makeTestApp('web-delivery');
  dist = mkdtempSync(join(tmpdir(), 'safehouse-webdist-'));
  mkdirSync(join(dist, 'assets'));
  mkdirSync(join(dist, 'pdfjs'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dist, 'assets', 'index-AbC123.js'), BUNDLE);
  // What scripts/precompress.mjs leaves beside the bundle.
  writeFileSync(join(dist, 'assets', 'index-AbC123.js.br'), brotliCompressSync(BUNDLE));
  writeFileSync(join(dist, 'assets', 'index-AbC123.js.gz'), gzipSync(BUNDLE));
  writeFileSync(join(dist, 'pdfjs', 'pdf.worker.mjs'), WORKER);
  await t.app.close();
  app = await buildApp({ db: t.db, webDist: dist, logger: false });
});

afterAll(async () => {
  await app?.close();
  await t?.close();
  rmSync(dist, { recursive: true, force: true });
});

describe('the cache policy', () => {
  it('keeps hashed assets for a year and revalidates everything that keeps its name', () => {
    expect(webCacheControl('assets/index-AbC123.js')).toBe(IMMUTABLE);
    expect(webCacheControl(join('assets', 'CodexPage-x.js'))).toBe(IMMUTABLE);
    expect(webCacheControl('index.html')).toBe('no-cache');
    expect(webCacheControl('pdfjs/pdf.worker.mjs')).toBe('no-cache');
  });

  it('compresses text, JSON, SVG and JavaScript — never raw bytes or an event stream', () => {
    for (const type of [
      'text/html; charset=utf-8',
      'application/json; charset=utf-8',
      'text/javascript',
      'application/javascript',
      'image/svg+xml',
      'text/css',
    ]) {
      expect(COMPRESSIBLE.test(type), type).toBe(true);
    }
    for (const type of ['application/octet-stream', 'application/pdf', 'image/png', 'text/event-stream']) {
      expect(COMPRESSIBLE.test(type), type).toBe(false);
    }
  });
});

describe('the web build over the wire', () => {
  it('serves the brotli sibling of a hashed asset, immutable, varying on Accept-Encoding', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/assets/index-AbC123.js',
      headers: { 'accept-encoding': 'br, gzip' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe(IMMUTABLE);
    expect(String(res.headers['vary'])).toMatch(/accept-encoding/i);
    expect(brotliDecompressSync(res.rawPayload).toString()).toBe(BUNDLE);
  });

  it('serves gzip to a client without brotli, and plain bytes to one that asks for nothing', async () => {
    const gz = await app.inject({
      method: 'GET',
      url: '/assets/index-AbC123.js',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.rawPayload).toString()).toBe(BUNDLE);
    const plain = await app.inject({
      method: 'GET',
      url: '/assets/index-AbC123.js',
      headers: { 'accept-encoding': 'identity' },
    });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body).toBe(BUNDLE);
    expect(plain.headers['cache-control']).toBe(IMMUTABLE);
  });

  it('revalidates index.html, at the root and as the SPA shell for a deep link', async () => {
    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['cache-control']).toBe('no-cache');
    expect(root.headers['etag'] ?? root.headers['last-modified']).toBeDefined();
    const deep = await app.inject({ method: 'GET', url: '/campaigns/x/table', headers: { accept: 'text/html' } });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain('id="root"');
    expect(deep.headers['cache-control']).toBe('no-cache');
  });

  it('answers a revalidation with 304', async () => {
    const first = await app.inject({
      method: 'GET',
      url: '/pdfjs/pdf.worker.mjs',
      headers: { 'accept-encoding': 'identity' },
    });
    const etag = String(first.headers['etag']);
    const again = await app.inject({
      method: 'GET',
      url: '/pdfjs/pdf.worker.mjs',
      headers: { 'accept-encoding': 'identity', 'if-none-match': etag },
    });
    expect(again.statusCode).toBe(304);
  });

  it('compresses a text file the build did not precompress, and still revalidates it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/pdfjs/pdf.worker.mjs',
      headers: { 'accept-encoding': 'br' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(brotliDecompressSync(res.rawPayload).toString()).toBe(WORKER);
  });

  it('404s a build asset that is not there instead of passing the shell off as JavaScript', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/assets/CodexPage-OldHash.js',
      headers: { accept: '*/*' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).not.toMatch(/text\/html/);
  });
});

describe('the API over the wire', () => {
  it('compresses a large JSON answer and leaves a small one alone', async () => {
    const boot = await bootstrapCampaign(app, 'Wire Check');
    const auth = { authorization: `Bearer ${boot.gmToken}` };
    const big = await app.inject({
      method: 'GET',
      url: '/api/tilesets',
      headers: { ...auth, 'accept-encoding': 'br, gzip' },
    });
    expect(big.statusCode).toBe(200);
    expect(big.headers['content-encoding']).toBe('br');
    const body = JSON.parse(brotliDecompressSync(big.rawPayload).toString()) as { tilesets: unknown[] };
    expect(body.tilesets.length).toBeGreaterThan(0);
    expect(big.rawPayload.length).toBeLessThan(Buffer.byteLength(JSON.stringify(body)) / 3);

    const small = await app.inject({ method: 'GET', url: '/healthz', headers: { 'accept-encoding': 'br, gzip' } });
    expect(small.statusCode).toBe(200);
    expect(small.headers['content-encoding']).toBeUndefined();
  });
});
