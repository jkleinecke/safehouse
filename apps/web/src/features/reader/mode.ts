/**
 * Which viewer opens the book, and the URLs each one needs.
 *
 * The default is the self-hosted pdf.js viewer (§13 "PDF viewer"): it is the
 * only one that honours a page number on a phone, because mobile browsers
 * ignore the `#page=` fragment their own PDF plugin advertises — which is what
 * made "one tap opens the printed page" a desktop-only promise.
 *
 * The browser-native viewer stays as the **documented fallback** (§13 names it
 * as the rejected alternative "kept as fallback"), reachable three ways:
 *
 *   - `?native=1` on any reader URL — a per-link escape hatch, shareable, and
 *     what a support answer says when a device renders badly;
 *   - a remembered per-device preference (`safehouse.reader.native`), set from
 *     the reader's own toolbar;
 *   - automatically, when pdf.js cannot start at all (asset missing, WASM/worker
 *     blocked, a server that will not honour byte ranges). Degrading beats a
 *     blank screen mid-session.
 *
 * Pure and storage-injected, so all three paths are tested without a DOM.
 */

export type ReaderMode = 'pdfjs' | 'native';

/** `?native=1` forces the browser's viewer; `?native=0` forces pdf.js. */
export const NATIVE_PARAM = 'native';
/** Per-device remembered preference. */
export const NATIVE_STORAGE_KEY = 'safehouse.reader.native';

/** The slice of `Storage` we use (see `api/session.ts` for the same shape). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function readFlag(storage: StorageLike | null | undefined, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    // Private mode / locked-down kiosk — the preference just does not persist.
    return null;
  }
}

function asSearch(search: string | URLSearchParams | null | undefined): URLSearchParams {
  if (!search) return new URLSearchParams();
  return typeof search === 'string' ? new URLSearchParams(search) : search;
}

/** `1`/`true`/`yes`/`on` → true; `0`/`false`/`no`/`off` → false; anything else null. */
export function parseBoolFlag(raw: string | null | undefined): boolean | null {
  if (raw === null || raw === undefined) return null;
  const v = raw.trim().toLowerCase();
  if (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return null;
}

/**
 * The viewer to open with. An explicit `?native=` in the link always wins — a
 * link someone shared at the table is a decision, not a suggestion.
 */
export function resolveReaderMode(
  search: string | URLSearchParams | null | undefined,
  storage?: StorageLike | null,
): ReaderMode {
  const fromUrl = parseBoolFlag(asSearch(search).get(NATIVE_PARAM));
  if (fromUrl !== null) return fromUrl ? 'native' : 'pdfjs';
  const stored = parseBoolFlag(readFlag(storage, NATIVE_STORAGE_KEY));
  return stored === true ? 'native' : 'pdfjs';
}

/** Remember (or forget) this device's preference for the native viewer. */
export function setNativePreference(native: boolean, storage?: StorageLike | null): void {
  if (!storage) return;
  try {
    if (native) storage.setItem(NATIVE_STORAGE_KEY, '1');
    else storage.removeItem(NATIVE_STORAGE_KEY);
  } catch {
    // ignore — the toggle still applies to this view
  }
}

/**
 * The byte-range endpoint pdf.js reads through. No token in the URL: a real
 * `fetch` carries `Authorization`, so the reader's normal path never puts a
 * credential in an address bar or a referrer (§8).
 */
export function bookRangeUrl(code: string): string {
  return `/files/books/${encodeURIComponent(code)}`;
}

/**
 * Fallback URL for the browser's own viewer. An `<iframe>` cannot set a header,
 * so this one — and only this one — carries `?token=`, exactly as the file
 * route already accepts it (BUILD_CONVENTIONS "Auth").
 */
export function nativeBookHref(code: string, pdfPage: number, token?: string | null): string {
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${bookRangeUrl(code)}${q}#page=${Math.max(1, Math.round(pdfPage) || 1)}`;
}

/** The route DESIGN §12 names for the viewer: `/read/:bookCode?p=426`. */
export const READER_PATH = '/read';
/**
 * Second address on the same route, kept for **hard** navigations
 * (`target="_blank"`, a pasted link, a refresh) from any client whose `Accept`
 * header the server's content negotiation cannot read as a navigation.
 * `/read/:code` is also a server route (the JSON offset mapping); it now serves
 * the SPA shell to `Accept: text/html` and the JSON to everyone else
 * (`plugins/books.ts#wantsSpaShell`), so `/read` is the address to share.
 * `/book/:code` is claimed by nobody and resolves to this same route in dev and
 * in prod.
 */
export const READER_ALIAS_PATH = '/book';

function readerQuery(printedPage: number, native?: boolean): string {
  const page = Math.max(1, Math.round(printedPage) || 1);
  return `?p=${page}${native ? `&${NATIVE_PARAM}=1` : ''}`;
}

/**
 * In-app reader route for a printed page — what a ref chip links to (FR11.3).
 * Safe for router-internal navigation (`<Link>`, `navigate()`), which never
 * touches the server.
 */
export function readerHref(book: string, printedPage: number, opts: { native?: boolean } = {}): string {
  return `${READER_PATH}/${encodeURIComponent(book)}${readerQuery(printedPage, opts.native)}`;
}

/**
 * The same page, as a URL the browser can load cold. Use this for any `<a>`
 * that leaves the SPA — a new tab, a link pasted into Discord, a QR code.
 */
export function readerDeepLinkHref(
  book: string,
  printedPage: number,
  opts: { native?: boolean } = {},
): string {
  return `${READER_ALIAS_PATH}/${encodeURIComponent(book)}${readerQuery(printedPage, opts.native)}`;
}

/**
 * What to do when the reader cannot show a page.
 *
 * `blocked` — the *book* is the problem: this device may not read it (FR11.5's
 * per-book GM-only toggle) or the registry row has no PDF behind it. The
 * browser's viewer would fetch the same URL with the same token and show the
 * same failure dressed as a broken document, so we say so instead.
 *
 * `degrade` — the *viewer* is the problem: pdf.js not vendored, a blocked
 * worker, an endpoint that will not honour byte ranges. Mid-session the right
 * answer is the book on the screen, so fall through to the native viewer.
 */
export type ReaderFailure = { kind: 'blocked'; message: string } | { kind: 'degrade' };

export function triageReaderError(err: unknown): ReaderFailure {
  const status = (err as { status?: number } | null | undefined)?.status;
  if (status === 401 || status === 403) {
    return {
      kind: 'blocked',
      message: 'This book is not shared with your device. Ask the GM to share it.',
    };
  }
  if (status === 404) {
    return { kind: 'blocked', message: 'This book has no PDF in the file store yet.' };
  }
  return { kind: 'degrade' };
}

/** Flip `?native=` on an existing query without disturbing the rest of it. */
export function withNativeFlag(search: string | URLSearchParams, native: boolean): string {
  const next = new URLSearchParams(asSearch(search));
  if (native) next.set(NATIVE_PARAM, '1');
  else next.delete(NATIVE_PARAM);
  return next.toString();
}
