/**
 * Byte-range source for the in-app reader (FR11.3, §15 "Media caps").
 *
 * The books are the table's own scans: the core rulebook is ~44 MB and the
 * library runs to 200 MB a volume. A player tapping `SR5 p.426` on a phone at
 * the table must pull the ~200 KB pdf.js needs for that one page — never the
 * book. So the reader never points an `<img>`/`<iframe>`/`fetch` at the whole
 * file: it drives `GET /files/books/:code` with explicit `Range:` headers and
 * feeds the windows to pdf.js through a data-range transport.
 *
 * This module is the transport's *pure half*: the request policy, the header
 * arithmetic and the response validation, with `fetch` injected. The pdf.js
 * binding that subclasses `PDFDataRangeTransport` lives in `pdfjs.ts` and is a
 * dozen lines of delegation, so the part that decides what leaves the phone is
 * unit-tested without pdf.js installed.
 *
 * Auth rides as `Authorization: Bearer` — a real `fetch`, unlike an iframe, can
 * carry a header, so the token never has to go in a URL (§8, privacy).
 */

/** The slice of `fetch` we use, so tests can hand in a fake. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** pdf.js asks for windows; 64 KB is its own default and suits a LAN. */
export const DEFAULT_RANGE_CHUNK = 65536;

/** One window actually requested — kept so tests (and the HUD) can prove restraint. */
export interface RangeWindow {
  begin: number;
  /** Exclusive. */
  end: number;
}

/** The server answered 200 with the whole file: ranges are not honoured here. */
export class RangeUnsupportedError extends Error {
  constructor(message = 'the book endpoint answered without a byte range') {
    super(message);
    this.name = 'RangeUnsupportedError';
  }
}

/** Any other failure reaching the book (401, 404, network). */
export class BookRangeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'BookRangeError';
    this.status = status;
  }
}

/** `bytes=0-65535` for the half-open window `[begin, end)`. */
export function rangeHeader(begin: number, endExclusive: number): string {
  const from = Math.max(0, Math.floor(begin));
  const to = Math.max(from, Math.floor(endExclusive) - 1);
  return `bytes=${from}-${to}`;
}

/**
 * Total size out of `Content-Range: bytes 0-0/45927104`. `null` when the header
 * is missing or the server hid the total behind `*` — either way we cannot
 * drive a range transport and must fall back.
 */
export function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const m = /^\s*bytes\s+(?:\d+-\d+|\*)\/(\d+)\s*$/i.exec(header);
  const total = m?.[1];
  if (!total) return null;
  const n = Number.parseInt(total, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface BookRangeSourceOptions {
  /** App-relative book URL, e.g. `/files/books/SR5`. */
  url: string;
  /** Device bearer token (BUILD_CONVENTIONS "Auth"). */
  token?: string | null;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  chunkSize?: number;
}

/**
 * A ranged reader over one book. Stateless apart from bookkeeping: every call
 * is an independent conditional GET, so a dropped Wi-Fi frame costs one window.
 */
export class BookRangeSource {
  readonly url: string;
  readonly chunkSize: number;
  /** Every window asked for, in order — the evidence for "not the whole file". */
  readonly requests: RangeWindow[] = [];
  /** Bytes pulled so far. */
  bytesFetched = 0;

  private readonly token: string | null;
  private readonly fetchImpl: FetchLike;
  /**
   * Recreated after every `abort()`. A single long-lived controller looks
   * tidier and is a trap: React StrictMode mounts, unmounts and remounts an
   * effect, so the second mount inherits an already-aborted signal and every
   * request fails with "signal is aborted without reason" — which is exactly
   * how this was found, in the browser, with the reader permanently falling
   * back to the native viewer in dev.
   */
  private controller: AbortController | null = null;
  private total: number | null = null;

  constructor(opts: BookRangeSourceOptions) {
    this.url = opts.url;
    this.token = opts.token ?? null;
    this.chunkSize = opts.chunkSize ?? DEFAULT_RANGE_CHUNK;
    const injected = opts.fetchImpl;
    this.fetchImpl =
      injected ?? ((input, init) => globalThis.fetch(input, init));
  }

  private headers(range: string): Record<string, string> {
    const h: Record<string, string> = { Range: range };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async request(begin: number, endExclusive: number): Promise<Response> {
    const range = rangeHeader(begin, endExclusive);
    this.requests.push({ begin, end: endExclusive });
    this.controller ??= new AbortController();
    const res = await this.fetchImpl(this.url, {
      method: 'GET',
      headers: this.headers(range),
      signal: this.controller.signal,
      // A cached 200 of the whole book would defeat the point.
      cache: 'no-store',
    });
    if (res.status === 200) {
      throw new RangeUnsupportedError(
        `${this.url} ignored ${range} and answered 200 with the whole file`,
      );
    }
    if (res.status !== 206) {
      throw new BookRangeError(res.status, `book range request failed (${res.status})`);
    }
    return res;
  }

  /**
   * The file's size, learned from a **one-byte** probe (`bytes=0-0`) — the
   * cheapest legal way to ask "how big is this?" that also proves the endpoint
   * really honours ranges before we commit to a transport.
   */
  async length(): Promise<number> {
    if (this.total !== null) return this.total;
    const res = await this.request(0, 1);
    const total = parseContentRangeTotal(res.headers.get('content-range'));
    if (total === null) {
      throw new RangeUnsupportedError(`${this.url} answered 206 without a usable Content-Range`);
    }
    // Drain the probe byte so the connection is reusable.
    await res.arrayBuffer().catch(() => undefined);
    this.bytesFetched += 1;
    this.total = total;
    return total;
  }

  /** One window `[begin, end)` as bytes. */
  async chunk(begin: number, endExclusive: number): Promise<Uint8Array> {
    const res = await this.request(begin, endExclusive);
    const buf = new Uint8Array(await res.arrayBuffer());
    this.bytesFetched += buf.byteLength;
    return buf;
  }

  /**
   * Cancel every in-flight window (the reader closing, or the page changing).
   * The source stays usable: a later request opens a fresh controller, so an
   * abort cancels work rather than retiring the object.
   */
  abort(): void {
    const controller = this.controller;
    this.controller = null;
    if (controller && !controller.signal.aborted) controller.abort();
  }

  /** Fraction of the book actually pulled — for the "streamed, not downloaded" chip. */
  fractionFetched(): number {
    if (!this.total) return 0;
    return this.bytesFetched / this.total;
  }
}
