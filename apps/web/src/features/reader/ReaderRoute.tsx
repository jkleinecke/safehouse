/**
 * `/read/:bookCode?p=426` — the in-app rulebook viewer (FR11.3, §12).
 *
 * The address bar is the citation: `?p=` is a **printed** page, so a link a GM
 * pastes into Discord means the same thing as the page number in the book, and
 * `?native=1` on the end is the documented fallback if a device renders badly.
 * Both stay in sync as the reader moves, which is what makes a ref chip's link
 * shareable at the table.
 *
 * ## The `/read` collision, and how it is settled
 *
 * DESIGN §12 gives `/read/:bookCode?p=426` to the viewer, but the server also
 * registers `GET /read/:code` as the JSON offset mapping
 * (`apps/server/src/plugins/books.ts`) and lists `/read` in `API_PREFIXES`
 * (`apps/server/src/app.ts`), so a cold load of `/read/SR5?p=426` — a new tab,
 * a pasted link, a refresh — used to be answered with JSON instead of a book.
 * That was not hypothetical: the sheet's ref chip
 * (`features/sheet/components/ui.tsx`) is
 * `<a href={readerHref(ref)} target="_blank">`, the single most-used ref
 * affordance in the app.
 *
 * The route now content-negotiates (`plugins/books.ts#wantsSpaShell`): a
 * request asking for `text/html` gets the SPA shell and lands here; a `fetch`
 * or an explicit `?format=json` still gets `{ fileUrl, pdfPage }`. The Vite dev
 * proxy mirrors the same rule with a `bypass`. `/book/:bookCode` stays as a
 * second address on this same route — nothing else claims it, so it is the
 * belt to the negotiation's braces for any client with an odd `Accept`.
 */
import { useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ReaderCore from './ReaderCore.js';
import { NATIVE_PARAM, resolveReaderMode, type ReaderMode } from './mode.js';
import { parsePrintedParam } from './pageMath.js';

export default function ReaderRoute() {
  const { bookCode } = useParams<{ bookCode: string }>();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();

  const printedPage = parsePrintedParam(search.get('p')) ?? 1;
  const mode: ReaderMode = useMemo(
    () => resolveReaderMode(search, safeLocalStorage()),
    [search],
  );

  const onPrintedPageChange = useCallback(
    (next: number) => {
      setSearch(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set('p', String(next));
          return params;
        },
        { replace: true },
      );
    },
    [setSearch],
  );

  const onModeChange = useCallback(
    (next: ReaderMode) => {
      setSearch(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'native') params.set(NATIVE_PARAM, '1');
          else params.delete(NATIVE_PARAM);
          return params;
        },
        { replace: true },
      );
    },
    [setSearch],
  );

  if (!bookCode) {
    return (
      <div className="flex h-dvh items-center justify-center bg-ground p-6 text-center">
        <p className="text-sm text-warn">No book code in this link.</p>
      </div>
    );
  }

  return (
    <ReaderCore
      code={bookCode}
      printedPage={printedPage}
      initialMode={mode}
      onPrintedPageChange={onPrintedPageChange}
      onModeChange={onModeChange}
      onClose={() => navigate(-1)}
      closeLabel="← back"
      rememberMode
    />
  );
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
