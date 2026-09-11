/**
 * Search from anywhere (FR12.14 for everyone): the store opens the overlay
 * with a query, the overlay renders the box with that query, a "find" chip
 * on a sheet row feeds it, and the library screens take `?q=`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BookSearch from './BookSearch.js';
import BookSearchOverlay, { BookSearchSheet } from './BookSearchOverlay.js';
import { openBookSearch, useBookSearchStore } from './searchStore.js';

function render(node: React.ReactElement): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

afterEach(() => useBookSearchStore.setState({ open: false, query: '' }));

describe('the store', () => {
  it('opens with a query, and closes', () => {
    expect(useBookSearchStore.getState().open).toBe(false);
    openBookSearch('Ares Predator');
    expect(useBookSearchStore.getState()).toMatchObject({ open: true, query: 'Ares Predator' });
    useBookSearchStore.getState().closeSearch();
    expect(useBookSearchStore.getState().open).toBe(false);
    openBookSearch();
    expect(useBookSearchStore.getState().query).toBe('');
  });
});

describe('the overlay', () => {
  it('renders nothing while closed', () => {
    expect(render(<BookSearchOverlay campaignId="c1" />)).toBe('');
  });

  it('opens on the query it was given, focused, and says how to close', () => {
    // A static render sees the store's initial state, so the pure half is
    // exercised directly with the state the store would hand it.
    const html = render(<BookSearchSheet open query="wound modifier" onClose={() => undefined} />);
    expect(html).toContain('data-testid="book-search-overlay"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('value="wound modifier"');
    expect(html).toContain('autofocus=""');
    expect(html).toContain('esc closes');
  });
});

describe('the box', () => {
  it('starts on its initial query so a link can arrive already searching', () => {
    const html = render(<BookSearch initialQuery="called shot" />);
    expect(html).toContain('value="called shot"');
    expect(html).not.toContain('autofocus=""');
  });
});
