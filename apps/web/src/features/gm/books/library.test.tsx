/**
 * Search and the library (FR12.14, FR11.6): the search box says why there is
 * nothing, headline marks become marks and never HTML, bookmarks sit pinned
 * first, and only the GM gets the controls. Static markup, as everywhere in
 * this package — the state transitions are pure functions asserted directly.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BookSearch, { MIN_QUERY, searchNote, snippetParts } from './BookSearch.js';
import LibraryPanel, { orderBookmarks } from './LibraryPanel.js';
import { libraryKey, type BookRecord, type Bookmark, type LibraryView } from './api.js';

const BOOKS = [
  { id: 'b1', code: 'SR5', title: 'Core Rulebook', pageOffset: 5, shared: true, hasFile: true },
  { id: 'b2', code: 'RG', title: 'Run & Gun', pageOffset: 0, shared: true, hasFile: true },
  { id: 'b3', code: 'HT', title: 'Hard Targets', pageOffset: 0, shared: false, hasFile: false },
] as unknown as BookRecord[];

function bookmark(over: Partial<Bookmark>): Bookmark {
  return {
    id: 'bm',
    book: 'SR5',
    page: 100,
    label: 'label',
    ref: 'SR5 p.100',
    title: 'Core Rulebook',
    pdfPage: 105,
    readUrl: '/read/SR5?p=100',
    ...over,
  };
}

const LIBRARY: LibraryView = {
  bookmarks: [
    bookmark({ id: 'z', page: 426, label: 'wound modifiers', ref: 'SR5 p.426' }),
    bookmark({ id: 'a', page: 195, label: 'called shots', ref: 'SR5 p.195', pinned: true, note: 'every fight' }),
    bookmark({ id: 'm', page: 173, label: 'initiative', ref: 'SR5 p.173' }),
  ],
  recentRefs: [{ book: 'RG', page: 42, label: 'suppressive fire', ref: 'RG p.42', readUrl: '/read/RG?p=42' }],
};

function render(node: React.ReactElement, seed?: (qc: QueryClient) => void): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(qc);
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('search', () => {
  it('says why there is nothing, and how much there is', () => {
    expect(searchNote('', undefined, false)).toBeNull();
    expect(searchNote('a', undefined, false)).toBe('type a little more');
    expect(searchNote('wound', undefined, true)).toBeNull();
    expect(searchNote('wound', [], false)).toContain('nothing for “wound”');
    expect(searchNote('wound', [{} as never], false)).toBe('1 hit');
    expect(searchNote('wound', [{} as never, {} as never], false)).toBe('2 hits');
    expect(MIN_QUERY).toBe(2);
  });

  it('turns ts_headline marks into marks and drops any other tag', () => {
    expect(snippetParts('a <b>called</b> shot, <i>never</i> as html')).toEqual([
      { text: 'a ', hit: false },
      { text: 'called', hit: true },
      { text: ' shot, never as html', hit: false },
    ]);
    expect(snippetParts('plain')).toEqual([{ text: 'plain', hit: false }]);
  });

  it('renders a search box, with a per-book filter once the shelf has more than one book', () => {
    const many = render(<BookSearch books={BOOKS} />);
    expect(many).toContain('data-testid="book-search"');
    expect(many).toContain('role="search"');
    expect(many).toContain('aria-label="Only this book"');
    // The book without a PDF cannot be searched, so it is not offered.
    expect(many).toContain('<option value="RG">');
    expect(many).not.toContain('<option value="HT">');
    const one = render(<BookSearch books={BOOKS.slice(0, 1)} />);
    expect(one).not.toContain('aria-label="Only this book"');
  });
});

describe('the library', () => {
  it('puts pinned bookmarks first, then the rest by label', () => {
    expect(orderBookmarks(LIBRARY.bookmarks).map((b) => b.id)).toEqual(['a', 'm', 'z']);
  });

  it('shows everyone the same list and the trail, and gives only the GM the controls', () => {
    const player = render(<LibraryPanel campaignId="c1" canEdit={false} books={BOOKS} />, (qc) =>
      qc.setQueryData(libraryKey('c1'), LIBRARY),
    );
    expect(player).toContain('data-testid="bookmark-list"');
    const order = [...player.matchAll(/data-bookmark="(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['a', 'm', 'z']);
    expect(player).toContain('data-pinned="yes"');
    expect(player).toContain('called shots');
    expect(player).toContain('— every fight');
    expect(player).toContain('data-testid="recent-refs"');
    expect(player).toContain('RG p.42');
    expect(player).toContain('suppressive fire');
    expect(player).not.toContain('data-testid="bookmark-form"');
    expect(player).not.toContain('remove-bookmark-');
    expect(player).not.toContain('>rename<');

    const gm = render(<LibraryPanel campaignId="c1" canEdit books={BOOKS} />, (qc) =>
      qc.setQueryData(libraryKey('c1'), LIBRARY),
    );
    expect(gm).toContain('data-testid="bookmark-form"');
    expect(gm).toContain('data-testid="remove-bookmark-a"');
    expect(gm).toContain('>rename<');
    expect(gm).toContain('>unpin<'); // the pinned one offers the reverse
    expect(gm).toContain('>pin<');
    // The add form only offers books with a PDF.
    expect(gm).toMatch(/<option value="SR5"[^>]*>SR5<\/option>/);
    expect(gm).not.toContain('<option value="HT">');
  });

  it('says what an empty library means to each audience', () => {
    const empty: LibraryView = { bookmarks: [], recentRefs: [] };
    const player = render(<LibraryPanel campaignId="c1" canEdit={false} />, (qc) =>
      qc.setQueryData(libraryKey('c1'), empty),
    );
    expect(player).toContain('data-testid="bookmarks-empty"');
    expect(player).toContain('has not bookmarked');
    expect(player).toContain('data-testid="recent-empty"');
    const gm = render(<LibraryPanel campaignId="c1" canEdit />, (qc) =>
      qc.setQueryData(libraryKey('c1'), empty),
    );
    expect(gm).toContain('bookmark button inside any open book');
  });
});
