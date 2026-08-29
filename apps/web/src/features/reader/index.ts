/**
 * Public surface of the reader (M11 / FR11.3) — the self-hosted pdf.js viewer.
 *
 * Import from here, never from deep paths. Two entry points:
 *
 *   - `ReaderRoute`   — the `/read/:bookCode?p=` page (router.tsx).
 *   - `BookReaderOverlay` — the book over the current screen, prop-compatible
 *     with the ref chips' existing `BookViewerOverlay`.
 *
 * Both reach pdf.js through two dynamic hops (`React.lazy` → `PdfSurface` →
 * a same-origin `import('/pdfjs/pdf.mjs')`), so neither the library nor its
 * worker is in the initial bundle — or in the bundle at all (§15: initial JS
 * < 500 KB gz). `scripts/vendor-pdfjs.mjs` copies them into `public/pdfjs/`
 * from `pdfjs-dist` on `postinstall` and again on `build`; if that step has not
 * run, the import rejects and the reader falls through to the browser's own
 * viewer rather than showing a blank screen.
 */
export { default as ReaderRoute } from './ReaderRoute.js';
export { default as BookReaderOverlay } from './BookReaderOverlay.js';
export type { BookReaderOverlayProps } from './BookReaderOverlay.js';
export { default as ReaderCore } from './ReaderCore.js';
export type { ReaderCoreProps } from './ReaderCore.js';
export { default as ReaderShell } from './ReaderShell.js';
export type { ReaderShellProps, ReaderCalibration, ReaderZoomControls } from './ReaderShell.js';
export { default as NativeBookFrame } from './NativeBookFrame.js';
export type { NativeBookFrameProps } from './NativeBookFrame.js';

// Pure helpers — printed↔PDF arithmetic, byte ranges, fit/zoom, mode flags.
export {
  clampPage,
  describeMapping,
  formatOffset,
  parsePrintedParam,
  pdfToPrintedPage,
  printedToPdfPage,
  resolvePdfPage,
  stepPrinted,
} from './pageMath.js';
export type { PageMapping } from './pageMath.js';

export {
  BookRangeError,
  BookRangeSource,
  DEFAULT_RANGE_CHUNK,
  RangeUnsupportedError,
  parseContentRangeTotal,
  rangeHeader,
} from './range.js';
export type { BookRangeSourceOptions, RangeWindow } from './range.js';

export {
  MAX_CANVAS_PIXELS,
  MAX_ZOOM,
  MIN_ZOOM,
  MOBILE_VIEWPORT_WIDTH,
  clampZoom,
  fitScale,
  nextZoom,
  pinchZoom,
  planRender,
  touchDistance,
} from './layout.js';
export type { FitMode, PlanOptions, RenderPlan, Size } from './layout.js';

export {
  NATIVE_PARAM,
  NATIVE_STORAGE_KEY,
  READER_ALIAS_PATH,
  READER_PATH,
  bookRangeUrl,
  nativeBookHref,
  parseBoolFlag,
  readerDeepLinkHref,
  readerHref,
  resolveReaderMode,
  setNativePreference,
  triageReaderError,
  withNativeFlag,
} from './mode.js';
export type { ReaderFailure, ReaderMode } from './mode.js';
