/**
 * The ref chip opens the self-hosted pdf.js reader, not the browser's plugin.
 *
 * This is the last hop of FR11.3. Everything under it — the offset arithmetic,
 * the byte-range streaming, the auth — was already right; what was missing was
 * a viewer that honours a page number on a phone, because mobile browsers
 * ignore the `#page=` fragment the old `<iframe>` relied on. Until this swap,
 * "one tap opens the printed page" was a desktop-only promise for every ref
 * chip in the app.
 *
 * Two things are pinned. First, identity: `BookViewerOverlay` — the name every
 * ref surface imports — IS the reader's overlay, so a regression to a local
 * iframe implementation fails here rather than silently on a phone at the
 * table. Second, that it renders the printed page it was handed, without
 * needing pdf.js present (the surface is lazy; the chrome is not).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BookViewerOverlay, RefChip, refLink } from './RefChip.js';
import { BookReaderOverlay } from '../../reader/index.js';

/** The reader asks the server for the book's offset once; nothing fetches here. */
function render(node: ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('the ref chip’s viewer (FR11.3)', () => {
  it('is the pdf.js reader overlay, under its historical name', () => {
    expect(BookViewerOverlay).toBe(BookReaderOverlay);
  });

  it('renders as a dialog labelled with the printed page it was asked for', () => {
    const html = render(<BookViewerOverlay code="SR5" printedPage={426} onClose={() => undefined} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('SR5 p.426');
    // The old implementation framed the file URL directly; nothing does now.
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('/files/books/SR5');
  });

  it('still links refs at the shareable /read address', () => {
    expect(refLink({ book: 'SR5', page: 426 })).toBe('/read/SR5?p=426');
  });

  it('renders a chip that says which book and page it opens', () => {
    const html = render(<RefChip refValue={{ book: 'RG', page: 105 }} />);
    expect(html).toContain('RG p.105');
    // Closed until tapped — a chip must never cost a book load on render.
    expect(html).not.toContain('role="dialog"');
  });
});
