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
import { useEffect, useState } from 'react';
import { ErrorNote, Spinner, inputClass } from '../ui.js';
import { useBookSearch, type BookRecord, type BookSearchHit } from './api.js';
import { BookViewerOverlay } from './RefChip.js';
import { useCatalogueSearch } from '../../sheet/catalogue/api.js';
import { statsLine } from '../../sheet/catalogue/toSheet.js';

export const MIN_QUERY = 2;

/** What the shelf can answer with: how many books, how many with text in the index. */
export interface ShelfIndex {
  total: number;
  indexed: number;
}

export function shelfIndex(books: readonly BookRecord[] | undefined): ShelfIndex | undefined {
  if (!books) return undefined;
  const withFile = books.filter((b) => b.hasFile !== false);
  return { total: withFile.length, indexed: withFile.filter((b) => (b.indexedPages ?? 0) > 0).length };
}

/**
 * The one line under the box: why there is nothing, or how much there is.
 * "Nothing" has two very different causes — the words are not in the books,
 * or the books have no words in the index yet — and only one of them is
 * fixed by typing something else.
 */
export function searchNote(
  q: string,
  hits: readonly BookSearchHit[] | undefined,
  pending: boolean,
  shelf?: ShelfIndex | undefined,
): string | null {
  const query = q.trim();
  if (query.length === 0) return null;
  if (query.length < MIN_QUERY) return 'type a little more';
  if (pending || hits === undefined) return null;
  if (hits.length === 0) {
    if (shelf && shelf.total > 0 && shelf.indexed === 0) {
      return `none of the ${shelf.total} book${shelf.total === 1 ? '' : 's'} on this shelf has searchable text yet — pnpm seed:books indexes them`;
    }
    if (shelf && shelf.total === 0) return 'no books on this shelf to search — the GM seeds them with pnpm seed:books';
    return `nothing for “${query}” in the books this device can open`;
  }
  return `${hits.length} hit${hits.length === 1 ? '' : 's'}`;
}

/**
 * The server's headlines mark matches with `**…**` (`packages/db/src/fts.ts`,
 * HEADLINE_OPTS); those become marks. A `<b>` pair is read the same way, and
 * any other tag is dropped, so page text is never handed to the browser as HTML.
 */
export function snippetParts(snippet: string): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = [];
  const re = /\*\*([\s\S]*?)\*\*|<b>([\s\S]*?)<\/b>/gi;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet)) !== null) {
    if (m.index > cursor) out.push({ text: strip(snippet.slice(cursor, m.index)), hit: false });
    out.push({ text: strip(m[1] ?? m[2] ?? ''), hit: true });
    cursor = m.index + m[0].length;
  }
  if (cursor < snippet.length) out.push({ text: strip(snippet.slice(cursor)), hit: false });
  return out.filter((p) => p.text.length > 0);
}

/**
 * Tags out, and the PDF's typesetting with them: extracted page text keeps
 * every line break and end-of-line hyphen ("penal-\nty"), which is how a
 * snippet ends up reading like a ransom note. Prose again, on one line.
 */
function strip(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/(\p{Ll})-\r?\n\s*(?=\p{Ll})/gu, '$1')
    .replace(/\s*\r?\n\s*/g, ' ');
}

export interface BookSearchProps {
  /** The shelf, for the per-book filter; omitted or short means no filter. */
  books?: readonly BookRecord[] | undefined;
  /** Hits without their snippet — for a narrow column. */
  compact?: boolean;
  /** What the box opens with — a "find" chip's item name, a `?q=` link — and searches for at once. */
  initialQuery?: string | undefined;
  /** Land the cursor in the box (the overlay; never a page that has other work on it). */
  autoFocus?: boolean | undefined;
  /** Told when a hit opens or closes the book, so a host can keep Escape for the book first. */
  onViewerChange?: ((open: boolean) => void) | undefined;
}

export default function BookSearch({ books, compact, initialQuery, autoFocus, onViewerChange }: BookSearchProps) {
  const [draft, setDraft] = useState(initialQuery ?? '');
  const [q, setQ] = useState(initialQuery ?? '');
  // A new opening query replaces what was there: the overlay is one box, and
  // the second chip tapped means the second thing.
  useEffect(() => {
    if (initialQuery === undefined) return;
    setDraft(initialQuery);
    setQ(initialQuery);
  }, [initialQuery]);
  const [book, setBook] = useState('');
  const [open, setOpenState] = useState<{ code: string; page: number } | null>(null);
  const setOpen = (next: { code: string; page: number } | null) => {
    setOpenState(next);
    onViewerChange?.(next !== null);
  };
  const search = useBookSearch(q, book || undefined);
  // The same words against the catalogue: an item by name answers before a page does.
  const items = useCatalogueSearch(q);
  const itemHits = (items.data ?? []).filter((h) => !book || h.bookCode === book).slice(0, 8);
  const note = searchNote(q, search.data, search.isFetching, shelfIndex(books));
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
          autoFocus={autoFocus}
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

      {itemHits.length > 0 && (
        <div className="mt-3" data-testid="book-search-items">
          <div className="mono-label text-dim">Items &amp; spells</div>
          <ul className="mt-1 divide-y divide-edge/60">
            {itemHits.map((hit) => (
              <li key={hit.id} className="flex items-center gap-2 py-1.5" data-kind={hit.kind}>
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-ink">{hit.name}</span>
                  <span className="mono-label ml-2 text-faint">{hit.category.toLowerCase() || hit.kind}</span>
                  {!compact && <div className="mono-label truncate text-dim">{statsLine(hit)}</div>}
                </div>
                <button
                  type="button"
                  className="chip cursor-pointer border-cyan-dim/60 text-cyan hover:border-cyan"
                  onClick={() => setOpen({ code: hit.bookCode, page: hit.printedPage })}
                  title={`Open ${hit.title} at printed page ${hit.printedPage}`}
                >
                  {hit.bookCode} p.{hit.printedPage}
                </button>
              </li>
            ))}
          </ul>
          <p className="mono-label mt-1 text-faint">from the tables the seeder read · add one from a sheet's Gear, Combat or Magic tab</p>
        </div>
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
