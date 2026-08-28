/**
 * /read/:bookCode viewer page (FR11.3): asks the server's reader route for the
 * printed → PDF mapping as JSON, then frames the book with the browser's own
 * PDF viewer at `#page=N`. Printed-page input, page stepper, and the `?p=`
 * query stay in sync so a ref chip's link is shareable at the table.
 *
 * This IS the `/read/:bookCode` route element — the shell's ReaderPage
 * re-exports it. Framing the server's `/read` route directly would show its
 * JSON mapping rather than the book.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getToken } from '../../../api/session.js';
import { useReadInfo } from './api.js';
import { bookFileHref } from './refs.js';

export default function BookReader() {
  const { bookCode } = useParams<{ bookCode: string }>();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();

  const queryPage = Number.parseInt(search.get('p') ?? '1', 10);
  const [page, setPage] = useState(Number.isFinite(queryPage) && queryPage > 0 ? queryPage : 1);

  const info = useReadInfo(bookCode, page);
  const token = getToken();

  // Keep `?p=` current so the address bar is a citation.
  useEffect(() => {
    if (search.get('p') === String(page)) return;
    const next = new URLSearchParams(search);
    next.set('p', String(page));
    setSearch(next, { replace: true });
  }, [page, search, setSearch]);

  const pdfPage = info.data?.pdfPage ?? page;
  const src = info.data?.fileUrl
    ? `${info.data.fileUrl}${info.data.fileUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(
        token ?? '',
      )}#page=${pdfPage}`
    : bookFileHref(bookCode ?? '', pdfPage, token);

  return (
    <div className="flex h-dvh flex-col bg-ground p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button className="btn px-2.5 py-1" onClick={() => navigate(-1)}>
          ← back
        </button>
        <span className="chip border-cyan-dim text-cyan">{bookCode}</span>
        {info.data?.title && (
          <span className="min-w-0 truncate text-sm text-dim">{info.data.title}</span>
        )}
        <label className="ml-2 flex items-center gap-1.5">
          <span className="mono-label">printed p.</span>
          <input
            type="number"
            min={1}
            value={page}
            onChange={(e) => setPage(Math.max(1, Number(e.target.value) || 1))}
            className="w-24 rounded-md border border-edge bg-deck px-2 py-1 text-sm text-ink"
            aria-label="Printed page"
          />
        </label>
        <button className="btn px-2 py-1" onClick={() => setPage((p) => Math.max(1, p - 1))}>
          −
        </button>
        <button className="btn px-2 py-1" onClick={() => setPage((p) => p + 1)}>
          +
        </button>
        <span className="mono-label text-faint">
          pdf {pdfPage}
          {info.data ? ` · offset ${info.data.pageOffset >= 0 ? '+' : ''}${info.data.pageOffset}` : ''}
        </span>
        {info.isError && (
          <span className="mono-label text-warn">
            reader mapping unavailable — showing the raw page
          </span>
        )}
      </div>

      <iframe
        key={src}
        src={src}
        title={`${bookCode} p.${page}`}
        className="min-h-0 w-full flex-1 rounded-md border border-edge bg-deck"
      />
    </div>
  );
}
