/**
 * `/c/:campaignId/books` — the rules library, for whoever is holding the device.
 *
 * FR11.5 shares a book with the table by default, and the seeded core book comes
 * back `shared: true`, but the shelf only ever existed at `/c/:id/gm/books`
 * behind a GM guard. A player could reach a rulebook exactly one way: tap a ref
 * chip that happened to be embedded in something they were already reading. So
 * "look it up" had no affordance on a phone at all.
 *
 * One route, two audiences:
 *   - GM  → the calibration shelf (printed-page offsets, shared toggles);
 *   - everyone else → the shared shelf, one tap to open a book in place.
 *
 * `/c/:id/gm/books` still resolves, so anything already linking there is fine.
 */
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getSession } from '../../api/session.js';
import GmBooksPage from '../gm/BooksPage.js';
import { useBooks, type BookRecord } from '../gm/books/api.js';
import BookSearch from '../gm/books/BookSearch.js';
import LibraryPanel from '../gm/books/LibraryPanel.js';
import { BookViewerOverlay } from '../gm/books/RefChip.js';
import { EmptyState, ErrorNote, SectionTitle, Spinner } from '../gm/ui.js';

function ShelfCard({ book, onOpen }: { book: BookRecord; onOpen: (page: number) => void }) {
  const [page, setPage] = useState('');
  const jump = () => {
    const n = Number.parseInt(page, 10);
    onOpen(Number.isFinite(n) && n > 0 ? n : 1);
  };

  return (
    <div className="panel p-4" data-book-code={book.code}>
      <div className="flex items-baseline gap-2">
        <span className="chip shrink-0 text-cyan">{book.code}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{book.title}</span>
      </div>
      {book.hasFile === false ? (
        <p className="mt-2 text-xs text-warn">
          Registered, but the PDF has not been seeded on this server yet.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn btn-accent px-3 py-1.5" onClick={() => onOpen(1)}>
            open
          </button>
          <label className="flex items-center gap-1.5">
            <span className="mono-label">printed p.</span>
            <input
              className="w-20 rounded-md border border-edge bg-deck px-2 py-1 text-sm text-ink focus:border-cyan focus:outline-none"
              value={page}
              inputMode="numeric"
              placeholder="426"
              aria-label={`Printed page in ${book.title}`}
              onChange={(e) => setPage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') jump();
              }}
            />
          </label>
          <button className="btn px-2.5 py-1" onClick={jump}>
            go
          </button>
        </div>
      )}
      <p className="mono-label mt-2 text-faint">
        printed page numbers — the app maps them onto the PDF
      </p>
    </div>
  );
}

/** The shared shelf a player, observer or kiosk sees. */
export function SharedShelf({ campaignId }: { campaignId: string }) {
  const books = useBooks(campaignId);
  const [search] = useSearchParams();
  const q = search.get('q') ?? undefined;
  const [open, setOpen] = useState<{ code: string; page: number } | null>(null);
  const rows = books.data ?? [];

  return (
    <div className="p-4 md:p-6">
      <SectionTitle hint="what the GM shared with the table">Rules library</SectionTitle>
      <h1 className="mt-1 text-lg font-semibold">Books</h1>

      {/* Look it up, and what the table looked up (FR12.14, FR11.6). */}
      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <BookSearch books={rows} initialQuery={q} />
        <LibraryPanel campaignId={campaignId} canEdit={false} books={rows} />
      </div>

      {books.isLoading && (
        <div className="mt-6">
          <Spinner label="loading shelf" />
        </div>
      )}
      <ErrorNote error={books.error} />

      {books.data && rows.length === 0 && (
        <div className="mt-4 max-w-xl">
          <EmptyState
            testId="library-empty"
            title="No shared books"
            blurb="The GM has not shared a rulebook with the table yet. Once they do, it shows up here and every SR5 p.426 style reference in the app opens straight to that page."
            actions={
              <Link className="btn btn-accent px-3 py-1.5" to={`/c/${campaignId}`}>
                back to the table
              </Link>
            }
            hint="Ask the GM to flip a book to shared on their library screen."
          />
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((b) => (
            <ShelfCard
              key={b.id}
              book={b}
              onOpen={(page) => setOpen({ code: b.code, page })}
            />
          ))}
        </div>
      )}

      {/* Opens over the current screen so a player mid-fight keeps their place. */}
      {open && (
        <BookViewerOverlay
          code={open.code}
          printedPage={open.page}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

export default function LibraryPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const session = getSession();
  if (!campaignId) return null;
  // The GM's version of this screen is the calibration shelf: same books, plus
  // the offset work only they can do.
  if (session?.role === 'gm') return <GmBooksPage />;
  return <SharedShelf campaignId={campaignId} />;
}
