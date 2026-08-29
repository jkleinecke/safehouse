/**
 * The pdf.js page surface — the lazy chunk (§15: neither pdf.js nor the canvas
 * and gesture code around it enters the initial bundle; `ReaderCore` reaches
 * this file through `React.lazy`, and this file reaches pdf.js through a
 * second, same-origin dynamic import).
 *
 * What happens here, in order:
 *
 *   1. A `BookRangeSource` opens the book over `Range:` requests only — a
 *      one-byte probe for the length, then the windows pdf.js asks for. A phone
 *      opening one printed page pulls a few hundred KB of a 44 MB file.
 *   2. `planRender` sizes the bitmap for the container and the display, capped
 *      so a pinch cannot ask a three-year-old phone for 26 megapixels.
 *   3. Pinch-zoom is live (a CSS transform while the fingers move) and then
 *      committed (a real re-render at the new scale, so the type is crisp).
 *
 * Rendering is cancellable: turning the page mid-render cancels the old task
 * rather than racing it onto the canvas. Every number this file uses comes from
 * `layout.ts`, which is tested on its own at 390 px.
 */
import { useCallback, useEffect, useRef, useState, type WheelEvent } from 'react';
import { clampZoom, pinchZoom, planRender, touchDistance, type Size } from './layout.js';
import { bookRangeUrl } from './mode.js';
import { openBook, type PdfDocumentLike, type PdfRenderTask } from './pdfjs.js';
import { BookRangeSource } from './range.js';

export interface PdfSurfaceProps {
  code: string;
  token?: string | null;
  /** 1-based page inside the file (the offset is already applied). */
  pdfPage: number;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onPageCount: (pages: number) => void;
  onError: (error: unknown) => void;
  onLoadingChange?: ((loading: boolean) => void) | undefined;
}

/** Gutter around the page, in CSS px — the same value `layout` is tested with. */
const GUTTER = 8;

export default function PdfSurface({
  code,
  token,
  pdfPage,
  zoom,
  onZoomChange,
  onPageCount,
  onError,
  onLoadingChange,
}: PdfSurfaceProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PdfDocumentLike | null>(null);
  const taskRef = useRef<PdfRenderTask | null>(null);

  // Callbacks live in a ref so a parent re-render never re-opens the book.
  const cb = useRef({ onZoomChange, onPageCount, onError, onLoadingChange });
  cb.current = { onZoomChange, onPageCount, onError, onLoadingChange };

  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [docReady, setDocReady] = useState(0);
  const [liveScale, setLiveScale] = useState(1);

  // --- open the book (once per book) ----------------------------------------
  // The source is built *inside* the effect, not memoised outside it: React's
  // StrictMode mounts, tears down and remounts, and a source shared across that
  // cycle comes back with an aborted signal (observed in the browser — the
  // reader fell back to the native viewer on every dev load).
  useEffect(() => {
    let alive = true;
    const source = new BookRangeSource({ url: bookRangeUrl(code), token: token ?? null });
    cb.current.onLoadingChange?.(true);
    docRef.current = null;

    void openBook(source)
      .then((doc) => {
        if (!alive) {
          void doc.destroy().catch(() => undefined);
          return;
        }
        docRef.current = doc;
        cb.current.onPageCount(doc.numPages);
        setDocReady((n) => n + 1);
      })
      .catch((err: unknown) => {
        if (alive) cb.current.onError(err);
      })
      .finally(() => {
        if (alive) cb.current.onLoadingChange?.(false);
      });

    return () => {
      alive = false;
      taskRef.current?.cancel();
      taskRef.current = null;
      source.abort();
      const doc = docRef.current;
      docRef.current = null;
      if (doc) void doc.destroy().catch(() => undefined);
    };
  }, [code, token]);

  // --- track the container ---------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport({ width: el.clientWidth || 0, height: el.clientHeight || 0 });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      globalThis.addEventListener('resize', measure);
      return () => globalThis.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- render the page --------------------------------------------------------
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || viewport.width <= 0) return;

    let alive = true;
    cb.current.onLoadingChange?.(true);

    void (async () => {
      try {
        const page = await doc.getPage(Math.min(Math.max(1, pdfPage), doc.numPages));
        if (!alive) return;
        const base = page.getViewport({ scale: 1 });
        const unzoomed: Size = { width: base.width, height: base.height };

        const plan = planRender(unzoomed, viewport, zoom, globalThis.devicePixelRatio || 1, {
          padding: GUTTER,
        });
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('this browser refused a 2d canvas');

        canvas.width = plan.canvasWidth;
        canvas.height = plan.canvasHeight;
        canvas.style.width = `${Math.round(plan.cssWidth)}px`;
        canvas.style.height = `${Math.round(plan.cssHeight)}px`;

        taskRef.current?.cancel();
        const task = page.render({
          canvasContext: ctx,
          viewport: page.getViewport({ scale: plan.renderScale }),
        });
        taskRef.current = task;
        await task.promise;
        if (taskRef.current === task) taskRef.current = null;
        page.cleanup();
      } catch (err) {
        // A cancelled render is the normal cost of turning pages quickly.
        const name = (err as { name?: string } | null)?.name;
        if (alive && name !== 'RenderingCancelledException' && name !== 'AbortError') {
          cb.current.onError(err);
        }
      } finally {
        if (alive) cb.current.onLoadingChange?.(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [pdfPage, zoom, viewport.width, viewport.height, docReady]);

  // --- pinch to zoom ----------------------------------------------------------
  const pinch = useRef<{ startDistance: number; startZoom: number } | null>(null);
  const liveScaleRef = useRef(1);

  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const a = e.touches[0];
      const b = e.touches[1];
      if (!a || !b) return;
      pinch.current = {
        startDistance: touchDistance({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY }),
        startZoom: zoom,
      };
    },
    [zoom],
  );

  const onTouchMove = useCallback((e: TouchEvent) => {
    const state = pinch.current;
    if (!state || e.touches.length !== 2) return;
    const a = e.touches[0];
    const b = e.touches[1];
    if (!a || !b) return;
    // Only now do we take the gesture from the browser — one finger still pans.
    e.preventDefault();
    const next = pinchZoom(
      state.startZoom,
      state.startDistance,
      touchDistance({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY }),
    );
    liveScaleRef.current = next / state.startZoom;
    setLiveScale(liveScaleRef.current);
  }, []);

  const endPinch = useCallback(() => {
    const state = pinch.current;
    if (!state) return;
    pinch.current = null;
    // Read the gesture from a ref, not from inside a state updater: React
    // double-invokes updaters in development, and a callback in there would
    // fire twice.
    const committed = clampZoom(state.startZoom * liveScaleRef.current);
    liveScaleRef.current = 1;
    setLiveScale(1);
    cb.current.onZoomChange(committed);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', endPinch);
    el.addEventListener('touchcancel', endPinch);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', endPinch);
      el.removeEventListener('touchcancel', endPinch);
    };
  }, [onTouchStart, onTouchMove, endPinch]);

  // Desktop trackpad pinch arrives as ctrl+wheel.
  const onWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      cb.current.onZoomChange(clampZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    },
    [zoom],
  );

  return (
    <div
      ref={scrollRef}
      onWheel={onWheel}
      className="h-full w-full overflow-auto overscroll-contain bg-deck"
      // One finger pans natively; two fingers are ours (see onTouchMove).
      style={{ touchAction: 'pan-x pan-y' }}
      data-testid="pdf-surface"
    >
      <div className="flex min-h-full w-full justify-center" style={{ padding: GUTTER }}>
        <canvas
          ref={canvasRef}
          className="h-auto max-w-none rounded-sm bg-white shadow-lg"
          style={{
            transform: liveScale === 1 ? undefined : `scale(${liveScale})`,
            transformOrigin: 'top center',
          }}
        />
      </div>
    </div>
  );
}
