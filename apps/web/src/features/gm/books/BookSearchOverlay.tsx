/**
 * The book search as an overlay (FR12.14, for the GM and every player). Opens
 * from the campaign header, from a "find" chip on a sheet row that has no
 * page of its own, or with `/` anywhere a text field is not focused — and
 * closes with Escape, leaving the screen underneath exactly as it was.
 *
 * Mounted once in `CampaignLayout`; the store (`searchStore.ts`) is the only
 * way in, so no screen needs to know where the overlay lives.
 */
import { useEffect, useState } from 'react';
import { Sheet } from '../../sheet/components/ui.js';
import BookSearch from './BookSearch.js';
import { useBooks, type BookRecord } from './api.js';
import { useBookSearchStore } from './searchStore.js';

function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export interface BookSearchSheetProps {
  open: boolean;
  query: string;
  onClose: () => void;
  books?: readonly BookRecord[] | undefined;
}

/** The overlay itself, given its state — the half a static render can see. */
export function BookSearchSheet({ open, query, onClose, books }: BookSearchSheetProps) {
  // A hit opens the book over the search. Escape then closes the book, not
  // the search — both listen on the window, so the search has to know.
  const [reading, setReading] = useState(false);
  const close = () => {
    if (!reading) onClose();
  };
  return (
    <Sheet open={open} onClose={close} title="Search the books">
      <div data-testid="book-search-overlay">
        <BookSearch books={books} initialQuery={query} autoFocus compact={false} onViewerChange={setReading} />
        <p className="mono-label mt-2 text-faint">esc closes · / opens from anywhere</p>
      </div>
    </Sheet>
  );
}

export default function BookSearchOverlay({ campaignId }: { campaignId: string }) {
  const open = useBookSearchStore((s) => s.open);
  const query = useBookSearchStore((s) => s.query);
  const openSearch = useBookSearchStore((s) => s.openSearch);
  const closeSearch = useBookSearchStore((s) => s.closeSearch);
  const books = useBooks(campaignId);

  // `/` opens it, the way it does on every site a runner has used.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || inTextField(e.target)) return;
      e.preventDefault();
      openSearch('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSearch]);

  return <BookSearchSheet open={open} query={query} onClose={closeSearch} books={books.data} />;
}
