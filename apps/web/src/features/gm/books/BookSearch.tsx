/**
 * Full-text search over the table's own books. The route (`GET
 * /api/books/search`, FR12.14) has ranked hits since M11; this is its first
 * entry point (docs/UX_AUDIT.md, "built server-side, no UI entry point").
 * One box, ranked hits, and a tap opens the printed page over whatever the
 * table was already looking at — the same overlay every ref chip uses.
 *
 * Scope is the device's: the server drops hits from books this device may
 * not open (FR11.5), so a player searching sees only what the GM shared.
 */
import { useState } from 'react';
import { ErrorNote, Spinner, inputClass } from '../ui.js';
import { useBookSearch, type BookRecord, type BookSearchHit } from './api.js';
import { BookViewerOverlay } from './RefChip.js';

export const MIN_QUERY = 2;

/** The one line under the box: why there is nothing, or how much there is. */
export function searchNote(
  q: string,
  hits: readonly BookSearchHit[] | undefined,
  pending: boolean,
): string | null {
  const query = q.trim();
  if (query.length === 0) return null;
  if (query.length < MIN_QUERY) return 'type a little more';
  if (pending || hits === undefined) return null;
  if (hits.length === 0) return `nothing for “${query}” in the books this device can open`;
  return `${hits.length} hit${hits.length === 1 ? '' : 's'}`;
}

/**
 * FTS headlines mark matches with `<b>…</b>`; those become marks and any
 * other tag is dropped, so page text is never handed to the browser as HTML.
 */
export function snippetParts(snippet: string): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = [];
  const re = /<b>([\s\S]*?)<\/b>/gi;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet)) !== null) {
    if (m.index > cursor) out.push({ text: strip(snippet.slice(cursor, m.index)), hit: false });
    out.push({ text: strip(m[1] ?? ''), hit: true });
    cursor = m.index + m[0].length;
  }
  if (cursor < snippet.length) out.push({ text: strip(snippet.slice(cursor)), hit: false });
  return out.filter((p) => p.text.length > 0);
}

function strip(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

export interface BookSearchProps {
  /** The shelf, for the per-book filter; omitted or short means no filter. */
  books?: readonly BookRecord[] | undefined;
  /** Hits without their snippet — for a narrow column. */
  compact?: boolean;
}

export default function BookSearch({ books, compact }: BookSearchProps) {
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [book, setBook] = useState('');
  const [open, setOpen] = useState<{ code: string; page: number } | null>(null);
  const search = useBookSearch(q, book || undefined);
  const note = searchNote(q, search.data, search.isFetching);
  const shelf = (books ?? []).filter((b) => b.hasFile !== false);

  return (
    <div className="panel p-4" data-testid="book-search">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="mono-label text-dim">Search the books</h2>
        <span className="mono-label text-faint">ranked, over every page with text in it</span>
      </div>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft);
        }}
      >
        <input
          className={`${inputClass} min-w-[12rem] flex-1`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="called shot, Matrix perception, wound modifier…"
          aria-label="Search the books"
          type="search"
        />
        {shelf.length > 1 && (
          <select
            className={`${inputClass} w-auto`}
            value={book}
            onChange={(e) => setBook(e.target.value)}
            aria-label="Only this book"
          >
            <option value="">every book</option>
            {shelf.map((b) => (
              <option key={b.id} value={b.code}>
                {b.code}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="btn btn-accent px-3 py-1.5"
          disabled={draft.trim().length < MIN_QUERY}
        >
          search
        </button>
      </form>

      {search.isFetching && (
        <div className="mt-2">
          <Spinner label="searching" />
        </div>
      )}
      <ErrorNote error={search.error} />
      {note && (
        <p className="mono-label mt-2 text-faint" data-testid="book-search-note">
          {note}
        </p>
      )}

      {search.data && search.data.length > 0 && (
        <ol className="mt-2 divide-y divide-edge/60" data-testid="book-search-hits">
          {search.data.map((hit) => (
            <li key={`${hit.book}-${hit.page}`} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="chip cursor-pointer border-cyan-dim/60 text-cyan hover:border-cyan"
                  onClick={() => setOpen({ code: hit.book, page: hit.page })}
                  title={`Open ${hit.title} at printed page ${hit.page}`}
                >
                  {hit.ref}
                </button>
                <span className="text-sm text-ink">{hit.title}</span>
              </div>
              {!compact && hit.snippet && (
                <p className="mt-1 text-xs text-dim">
                  {snippetParts(hit.snippet).map((part, i) =>
                    part.hit ? (
                      <mark key={i} className="rounded bg-cyan/20 px-0.5 text-ink">
                        {part.text}
                      </mark>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {open && (
        <BookViewerOverlay code={open.code} printedPage={open.page} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
