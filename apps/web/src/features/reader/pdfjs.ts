/**
 * The one file that touches pdf.js.
 *
 * Everything else in `features/reader/` — the printed↔PDF arithmetic, the byte
 * ranges, the fit and zoom maths, the toolbar — is pure TypeScript with its own
 * tests. This module is the seam.
 *
 * ## Why pdf.js is loaded from a URL and not bundled
 *
 * `apps/web/scripts/vendor-pdfjs.mjs` copies the library out of `pdfjs-dist`
 * into `public/pdfjs/` at install and build time, and this module imports it
 * from that same-origin URL (DESIGN.md §13: "pdf.js, **self-hosted** … no
 * external viewer, no CDN"). Three things fall out of that:
 *
 *  - **Bundle budget (§15).** pdf.js and its worker are several times the
 *    500 KB gz initial-JS budget. As a static asset they cost zero bytes until
 *    a ref chip is tapped, with no chunking discipline to get wrong.
 *  - **The worker stays a worker.** pdf.js wants a same-origin module-worker
 *    URL; `/pdfjs/pdf.worker.mjs` is exactly that.
 *  - **It degrades instead of breaking.** If the vendor step has not run, the
 *    import below rejects, `PdfjsUnavailableError` reaches `ReaderCore`, and
 *    the reader falls through to the browser's own viewer. The build stays
 *    green either way — nothing here is resolved by the bundler.
 *
 * `pnpm install` runs the vendor step through `postinstall`, and `build` runs
 * it again; `pnpm --filter @safehouse/web vendor:pdfjs` re-runs it by hand.
 */
import { BookRangeSource } from './range.js';

/** Same-origin asset roots written by `scripts/vendor-pdfjs.mjs`. */
export const PDFJS_BASE_URL = '/pdfjs/';
export const PDFJS_MODULE_URL = `${PDFJS_BASE_URL}pdf.mjs`;
export const PDFJS_WORKER_URL = `${PDFJS_BASE_URL}pdf.worker.mjs`;
export const PDFJS_CMAP_URL = `${PDFJS_BASE_URL}cmaps/`;
export const PDFJS_STANDARD_FONTS_URL = `${PDFJS_BASE_URL}standard_fonts/`;

// --- the slice of pdf.js the viewer actually uses --------------------------

export interface PdfViewportLike {
  width: number;
  height: number;
  scale: number;
}

export interface PdfRenderTask {
  promise: Promise<void>;
  cancel(): void;
}

export interface PdfPageLike {
  getViewport(params: { scale: number; rotation?: number }): PdfViewportLike;
  render(params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewportLike;
    intent?: string;
  }): PdfRenderTask;
  cleanup(): void;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy(): Promise<void>;
}

/** The transport contract pdf.js defines; we override one method of it. */
export interface PdfDataRangeTransportLike {
  requestDataRange(begin: number, end: number): void;
  onDataRange(begin: number, chunk: Uint8Array): void;
  onDataProgress(loaded: number, total: number): void;
  abort(): void;
}

/** The handful of pdf.js entry points the reader uses. */
export interface PdfjsModule {
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfDocumentLike> };
  GlobalWorkerOptions: { workerSrc: string };
  PDFDataRangeTransport: new (
    length: number,
    initialData: Uint8Array,
    progressiveDone?: boolean,
    contentDispositionFilename?: string | null,
  ) => PdfDataRangeTransportLike;
}

/** pdf.js could not be started — the caller falls back to the native viewer. */
export class PdfjsUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PdfjsUnavailableError';
  }
}

// --- lazy library load ------------------------------------------------------

/**
 * pdf.js is vendored into `public/pdfjs/` and imported by runtime URL so it
 * stays out of every bundle (§15) and resolves against the app's own origin.
 *
 * The import is built through `new Function` rather than written literally:
 * `import(/* @vite-ignore *\/ url)` still passes through Vite's dev-time
 * dynamic-import rewrite, which resolves the specifier against the module
 * graph, fails for a `public/` asset, and silently drops the reader to the
 * native viewer in `pnpm dev:web` while working in a production build. An
 * indirect import is invisible to the bundler, so both modes take the same
 * path.
 */
const dynamicImport = new Function('u', 'return import(u)') as (
  url: string,
) => Promise<unknown>;

async function importPdfjs(url: string): Promise<PdfjsModule> {
  const absolute = new URL(url, window.location.origin).href;
  return (await dynamicImport(absolute)) as PdfjsModule;
}

let pending: Promise<PdfjsModule> | null = null;

/**
 * Load pdf.js and point it at its worker. Memoised — a session opens dozens of
 * refs and only the first pays — but a failure clears the memo so reopening the
 * reader retries rather than remembering a bad first load.
 */
export async function loadPdfjs(moduleUrl: string = PDFJS_MODULE_URL): Promise<PdfjsModule> {
  if (!pending) {
    pending = (async () => {
      let lib: PdfjsModule;
      try {
        lib = await importPdfjs(moduleUrl);
      } catch (cause) {
        throw new PdfjsUnavailableError(
          `pdf.js is not vendored at ${moduleUrl} (run: pnpm --filter @safehouse/web vendor:pdfjs)`,
          { cause },
        );
      }
      if (typeof lib?.getDocument !== 'function' || typeof lib?.PDFDataRangeTransport !== 'function') {
        throw new PdfjsUnavailableError(`${moduleUrl} is not a usable pdf.js build`);
      }
      try {
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      } catch {
        // Without a worker pdf.js renders on the main thread: slower on a big
        // page, still correct, and better than no book at the table.
      }
      return lib;
    })().catch((err: unknown) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

/** Drop the memoised library (tests, and the reader's retry affordance). */
export function resetPdfjs(): void {
  pending = null;
}

// --- byte-range transport ---------------------------------------------------

/**
 * Wire a `BookRangeSource` into a pdf.js data-range transport. Exported
 * separately from `openBook` so the wiring can be exercised against a stub
 * transport without pdf.js present.
 */
export function bindRangeTransport(
  transport: PdfDataRangeTransportLike,
  source: BookRangeSource,
  length: number,
): PdfDataRangeTransportLike {
  transport.requestDataRange = (begin: number, end: number): void => {
    void source
      .chunk(begin, end)
      .then((chunk) => {
        transport.onDataRange(begin, chunk);
        transport.onDataProgress(source.bytesFetched, length);
      })
      .catch(() => {
        // A dropped window aborts this page's load; pdf.js surfaces it to the
        // caller and the reader offers the native viewer rather than spinning.
        transport.abort();
      });
  };
  return transport;
}

/**
 * Open one book through `source`, which fetches windows with `Range:` headers
 * and a bearer token. `disableAutoFetch`/`disableStream` are the point: without
 * them pdf.js happily pulls the remaining 40 MB in the background once the
 * first page is up — exactly the bill a phone at the table must not receive
 * (§15 "Media caps").
 */
export async function openBook(source: BookRangeSource): Promise<PdfDocumentLike> {
  const length = await source.length();
  const lib = await loadPdfjs();

  const transport = bindRangeTransport(
    new lib.PDFDataRangeTransport(length, new Uint8Array(0)),
    source,
    length,
  );

  try {
    return await lib.getDocument({
      range: transport,
      length,
      disableAutoFetch: true,
      disableStream: true,
      rangeChunkSize: source.chunkSize,
      cMapUrl: PDFJS_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
      // The table's LAN has no CSP relaxations to spare.
      isEvalSupported: false,
    }).promise;
  } catch (cause) {
    throw new PdfjsUnavailableError('pdf.js could not open this book', { cause });
  }
}
