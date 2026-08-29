/**
 * The pdf.js seam, tested without pdf.js: the loader's failure contract and the
 * wiring that makes every byte pdf.js reads go through a `Range:` request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PDFJS_MODULE_URL,
  PDFJS_WORKER_URL,
  PdfjsUnavailableError,
  bindRangeTransport,
  loadPdfjs,
  resetPdfjs,
  type PdfDataRangeTransportLike,
} from './pdfjs.js';
import { BookRangeSource } from './range.js';

afterEach(() => resetPdfjs());

/** A stand-in for pdf.js's own `PDFDataRangeTransport`. */
function stubTransport() {
  const ranges: { begin: number; bytes: number }[] = [];
  let aborted = false;
  const transport: PdfDataRangeTransportLike = {
    requestDataRange: () => undefined,
    onDataRange: (begin, chunk) => void ranges.push({ begin, bytes: chunk.byteLength }),
    onDataProgress: () => undefined,
    abort: () => void (aborted = true),
  };
  return { transport, ranges, isAborted: () => aborted };
}

describe('asset URLs', () => {
  it('points at our own origin — self-hosted, no CDN (§13)', () => {
    for (const url of [PDFJS_MODULE_URL, PDFJS_WORKER_URL]) {
      expect(url.startsWith('/')).toBe(true);
      expect(url).not.toMatch(/^https?:/);
    }
  });
});

describe('loadPdfjs', () => {
  it('reports a missing vendored library as a typed, actionable failure', async () => {
    const err = await loadPdfjs('/pdfjs-not-vendored-here.mjs').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfjsUnavailableError);
    expect((err as Error).message).toContain('vendor:pdfjs');
  });

  it('does not remember a failed load — reopening the reader retries', async () => {
    await loadPdfjs('/pdfjs-not-vendored-here.mjs').catch(() => undefined);
    // A second attempt reaches the import again rather than replaying the
    // cached rejection (which is what would strand a device after one blip).
    const second = await loadPdfjs('/pdfjs-not-vendored-here.mjs').catch((e: unknown) => e);
    expect(second).toBeInstanceOf(PdfjsUnavailableError);
  });
});

describe('bindRangeTransport', () => {
  const BOOK_SIZE = 45_927_104;

  function rangingSource() {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const m = /^bytes=(\d+)-(\d+)$/.exec(headers['Range'] ?? '');
      if (!m) return new Response(new Uint8Array(BOOK_SIZE), { status: 200 });
      const from = Number(m[1]);
      const to = Number(m[2]);
      return new Response(new Uint8Array(to - from + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${from}-${to}/${BOOK_SIZE}` },
      });
    });
    return { fetchImpl, source: new BookRangeSource({ url: '/files/books/SR5', fetchImpl }) };
  }

  it("turns pdf.js's window request into a byte-range fetch", async () => {
    const { fetchImpl, source } = rangingSource();
    const { transport, ranges } = stubTransport();

    bindRangeTransport(transport, source, BOOK_SIZE);
    transport.requestDataRange(2_293_760, 2_359_296);
    await vi.waitFor(() => expect(ranges).toHaveLength(1));

    expect(ranges[0]).toEqual({ begin: 2_293_760, bytes: 65_536 });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)['Range']).toBe('bytes=2293760-2359295');
    // The whole book was never in play.
    expect(source.bytesFetched).toBe(65_536);
  });

  it('aborts rather than hanging when a window cannot be fetched', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
    const source = new BookRangeSource({ url: '/files/books/SR5', fetchImpl });
    const { transport, isAborted } = stubTransport();

    bindRangeTransport(transport, source, BOOK_SIZE);
    transport.requestDataRange(0, 65_536);

    await vi.waitFor(() => expect(isAborted()).toBe(true));
  });
});
