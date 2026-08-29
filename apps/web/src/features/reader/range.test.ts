import { describe, expect, it, vi } from 'vitest';
import {
  BookRangeError,
  BookRangeSource,
  RangeUnsupportedError,
  parseContentRangeTotal,
  rangeHeader,
} from './range.js';

/** A stand-in for the 43.9 MB core rulebook sitting next to DESIGN.md. */
const BOOK_SIZE = 45_927_104;

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** A fake `/files/books/:code` that honours ranges, recording every call. */
function rangingServer(size = BOOK_SIZE) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    const range = headers['Range'];
    if (!range) {
      // The whole book. Present so a test can prove we never ask for it.
      return new Response(new Uint8Array(size), { status: 200 });
    }
    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    const from = Number(m?.[1] ?? 0);
    const to = Number(m?.[2] ?? 0);
    const body = new Uint8Array(to - from + 1).fill(0x25);
    return new Response(body, {
      status: 206,
      headers: { 'content-range': `bytes ${from}-${to}/${size}` },
    });
  });
  return { calls, fetchImpl };
}

describe('rangeHeader', () => {
  it('renders a half-open window as an inclusive HTTP range', () => {
    expect(rangeHeader(0, 65536)).toBe('bytes=0-65535');
    expect(rangeHeader(65536, 131072)).toBe('bytes=65536-131071');
  });

  it('never emits a backwards or negative range', () => {
    expect(rangeHeader(10, 10)).toBe('bytes=10-10');
    expect(rangeHeader(-5, 3)).toBe('bytes=0-2');
  });
});

describe('parseContentRangeTotal', () => {
  it('reads the total off a 206', () => {
    expect(parseContentRangeTotal('bytes 0-0/45927104')).toBe(45_927_104);
  });

  it('refuses a hidden or absent total', () => {
    expect(parseContentRangeTotal('bytes 0-0/*')).toBeNull();
    expect(parseContentRangeTotal(null)).toBeNull();
    expect(parseContentRangeTotal('pages 1-2/9')).toBeNull();
  });
});

describe('BookRangeSource — a phone must not download the book', () => {
  it('learns the size from a one-byte probe, not a full GET', async () => {
    const { calls, fetchImpl } = rangingServer();
    const src = new BookRangeSource({ url: '/files/books/SR5', fetchImpl });

    expect(await src.length()).toBe(BOOK_SIZE);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers['Range']).toBe('bytes=0-0');
    expect(src.bytesFetched).toBe(1);
  });

  it('sends a Range header on every request and never asks for the whole file', async () => {
    const { calls, fetchImpl } = rangingServer();
    const src = new BookRangeSource({ url: '/files/books/SR5', fetchImpl });

    await src.length();
    await src.chunk(0, 65536);
    await src.chunk(2_293_760, 2_359_296);

    expect(calls.length).toBeGreaterThan(0);
    // The guarantee, stated as the test: not one request left without a window.
    for (const call of calls) {
      expect(call.headers['Range']).toMatch(/^bytes=\d+-\d+$/);
    }
    expect(src.requests.map((r) => `${r.begin}-${r.end}`)).toEqual([
      '0-1',
      '0-65536',
      '2293760-2359296',
    ]);
  });

  it('pulls a page-sized slice, not a book-sized one', async () => {
    const { fetchImpl } = rangingServer();
    const src = new BookRangeSource({ url: '/files/books/SR5', fetchImpl });

    await src.length();
    // What opening one printed page costs pdf.js: a few 64 KB windows.
    for (let i = 0; i < 4; i += 1) await src.chunk(i * 65536, (i + 1) * 65536);

    expect(src.bytesFetched).toBeLessThan(400_000);
    expect(src.fractionFetched()).toBeLessThan(0.01);
  });

  it('carries the device token as a header, never in the URL', async () => {
    const { calls, fetchImpl } = rangingServer();
    const src = new BookRangeSource({ url: '/files/books/SR5', token: 'dev-token', fetchImpl });

    await src.length();

    expect(calls[0]?.headers['Authorization']).toBe('Bearer dev-token');
    expect(calls[0]?.url).toBe('/files/books/SR5');
    expect(calls[0]?.url).not.toContain('dev-token');
  });

  it('returns the requested bytes', async () => {
    const { fetchImpl } = rangingServer();
    const src = new BookRangeSource({ url: '/files/books/SR5', fetchImpl });
    const chunk = await src.chunk(1024, 1024 + 512);
    expect(chunk).toBeInstanceOf(Uint8Array);
    expect(chunk.byteLength).toBe(512);
  });

  it('refuses a server that ignores the range and sends the whole book', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(BOOK_SIZE), { status: 200 }));
    const src = new BookRangeSource({ url: '/files/books/SR5', fetchImpl });

    await expect(src.length()).rejects.toBeInstanceOf(RangeUnsupportedError);
  });

  it('refuses a 206 whose Content-Range hides the total', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array(1), {
          status: 206,
          headers: { 'content-range': 'bytes 0-0/*' },
        }),
    );
    const src = new BookRangeSource({ url: '/files/books/SR5', fetchImpl });

    await expect(src.length()).rejects.toBeInstanceOf(RangeUnsupportedError);
  });

  it('surfaces auth failures with their status so the shell can re-join', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
    const src = new BookRangeSource({ url: '/files/books/SR5', fetchImpl });

    await expect(src.length()).rejects.toMatchObject({ name: 'BookRangeError', status: 401 });
    await expect(src.length()).rejects.toBeInstanceOf(BookRangeError);
  });

  it('caches the size so a page turn costs no extra probe', async () => {
    const { calls, fetchImpl } = rangingServer();
    const src = new BookRangeSource({ url: '/files/books/SR5', fetchImpl });

    await src.length();
    await src.length();
    await src.length();

    expect(calls).toHaveLength(1);
  });

  it('aborts in-flight windows when the reader closes', async () => {
    const { fetchImpl } = rangingServer();
    const src = new BookRangeSource({ url: '/files/books/SR5', fetchImpl });
    await src.length();
    src.abort();
    // Idempotent — closing twice must not throw into React.
    expect(() => src.abort()).not.toThrow();
  });

  it('stays usable after an abort — StrictMode remounts one', async () => {
    // Found in the browser: a single long-lived AbortController meant React's
    // develop-mode double mount left the reader with a dead signal and every
    // window failing "signal is aborted without reason".
    const { fetchImpl } = rangingServer();
    const src = new BookRangeSource({ url: '/files/books/SR5', fetchImpl });

    await src.length();
    src.abort();

    await expect(src.chunk(0, 65536)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('signals each request, so a close really does cancel in flight', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      return new Response(new Uint8Array(1), {
        status: 206,
        headers: { 'content-range': `bytes 0-0/${BOOK_SIZE}` },
      });
    });
    const src = new BookRangeSource({ url: '/files/books/SR5', fetchImpl });

    await src.length();
    expect(signals[0]?.aborted).toBe(false);
    src.abort();
    expect(signals[0]?.aborted).toBe(true);
  });
});
