/**
 * The shelf as the GM sees it (M11 / FR11.1, FR11.5, FR11.7).
 *
 * These render the real components to markup — there is no DOM in this package
 * (no jsdom, no testing-library), so interaction is exercised by driving the
 * same pure state transitions the handlers call and re-rendering, which is the
 * honest half of the loop. What must not regress:
 *
 *   1. a book still at the seeded +0 looks different from a calibrated one;
 *   2. a detection renders as a *proposal* and writes nothing until applied;
 *   3. changing the offset saves it at once — no save/revert step;
 *   4. an empty shelf prints the command that actually works.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BookShelfRow from './BookShelfRow.js';
import SeedInstructions from './SeedInstructions.js';
import BooksPage from './BooksPage.js';
import { normalizeDetection } from './calibration.js';
import type { BookRecord } from './api.js';

const noop = () => undefined;

function book(over: Partial<BookRecord> = {}): BookRecord {
  return {
    id: 'b1',
    code: 'RG',
    title: 'Run & Gun',
    pageOffset: 0,
    shared: true,
    hasFile: true,
    ...over,
  } as BookRecord;
}

function card(props: Partial<Parameters<typeof BookShelfRow>[0]> = {}): string {
  const b = props.book ?? book();
  return renderToStaticMarkup(
    <table>
      <tbody>
    <BookShelfRow
      book={b}
      offset={b.pageOffset}
      onSetOffset={noop}
      onDetect={noop}
      onApplyProposal={noop}
      onDismissProposal={noop}
      onToggleShared={noop}
      onOpenCalibrate={noop}
      {...props}
    />
      </tbody>
    </table>,
  );
}

describe('an uncalibrated book is visually distinct', () => {
  it('says "not calibrated" instead of printing a confident +0', () => {
    const html = card({ book: book({ pageOffset: 0 }) });
    expect(html).toContain('data-calibration="uncalibrated"');
    expect(html).toContain('not calibrated');
    expect(html).toContain('bg-warn/5'); // the row itself is warn-toned
    expect(html).toMatch(/wrong page/i);
  });

  it('a measured book reads as calibrated and carries no warning', () => {
    const b = book({ id: 'sr5', code: 'SR5', title: 'Core Rulebook', pageOffset: 5 });
    const html = card({ book: b, offset: 5 });
    expect(html).toContain('data-calibration="calibrated"');
    expect(html).toContain('value="5"');
    expect(html).not.toContain('not calibrated');
    expect(html).not.toContain('bg-warn/5');
  });

  it('a registry row with no PDF cannot be detected', () => {
    const html = card({ book: book({ hasFile: false }) });
    expect(html).toContain('data-calibration="no-file"');
    expect(html).toContain('pnpm seed:books');
    // The detect button is present but disabled — nothing to read.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>detect<\/button>/);
  });

  it('prints no zero when a route did not report page counts', () => {
    // The single-book routes carry no counts; only the listing does.
    const html = card();
    expect(html).toContain('—');
    expect(html).not.toContain('not searchable');
  });

  it('reports what the listing sends, and the gap when a PDF count exists', () => {
    const indexedOnly = card({ book: book({ indexedPages: 199 }) });
    expect(indexedOnly).toContain('199');
    // No pdf page count exists anywhere, so no fabricated gap.
    expect(indexedOnly).not.toContain('image-only');

    const withStats = card({ book: book({ pdfPages: 202, indexedPages: 199 }) });
    expect(withStats).toContain('199');
    expect(withStats).toContain('3 image-only');
  });

  /**
   * The failure that looks like success: a seeded book whose scans are pure
   * image indexes nothing, so search silently never matches it. Every other
   * line on the card says the book is fine.
   */
  it('calls out a seeded book that indexed nothing at all', () => {
    const html = card({ book: book({ hasFile: true, indexedPages: 0 }) });
    expect(html).toContain('not searchable');
    expect(html).toContain('text-warn');
  });
});

describe('detection proposes, the GM applies', () => {
  const proposal = normalizeDetection({
    offset: 6,
    confidence: 0.91,
    evidence: 'printed numbers on 8 of 9 sampled pages agree',
    samples: [{ printed: 100, pdf: 106 }],
  })!;

  it('renders the proposal with its confidence and evidence', () => {
    const html = card({ book: book({ pageOffset: 0 }), proposal });
    expect(html).toContain('data-testid="offset-proposal"');
    expect(html).toContain('offset +6');
    expect(html).toContain('91% confident');
    expect(html).toContain('printed numbers on 8 of 9 sampled pages agree');
    expect(html).toContain('Would change +0 → +6.');
  });

  it('does not apply it: the book still reads uncalibrated until the click', () => {
    const onApplyProposal = vi.fn();
    const html = card({ book: book({ pageOffset: 0 }), proposal, onApplyProposal });
    expect(onApplyProposal).not.toHaveBeenCalled();
    expect(html).toContain('data-calibration="uncalibrated"');
    expect(html).toMatch(/apply \+6/);
    expect(html).toContain('dismiss');
  });

  it('says nothing was found rather than proposing a zero', () => {
    const html = card({ detectPhase: 'empty', proposal: null });
    expect(html).toMatch(/no offset could be read/i);
    expect(html).not.toContain('data-testid="offset-proposal"');
  });

  it('gives the server the last word on WHY it declined', () => {
    // The two failure modes need different fixes — a scan needs a human, a
    // split vote needs a look at the book. The card must not flatten them.
    const scanned = card({
      detectPhase: 'empty',
      proposal: null,
      detectNote: 'keeping +0: no printed page numbers found (48 of 48 sampled pages are image-only)',
    });
    expect(scanned).toContain('48 of 48 sampled pages are image-only');

    const split = card({
      detectPhase: 'empty',
      proposal: null,
      detectNote: 'keeping +0: split vote — 21 pages say +1, 19 say +2',
    });
    expect(split).toContain('21 pages say +1');
    expect(split).not.toMatch(/image-only/);
  });

  it('surfaces a detection failure without touching the saved offset', () => {
    const html = card({ detectPhase: 'error', detectError: 'endpoint not found' });
    expect(html).toContain('detect failed: endpoint not found');
    expect(html).toContain('data-calibration="uncalibrated"');
  });
});

describe('the manual nudge loop', () => {
  it('steps the offset straight to a save, with nothing to confirm', () => {
    const onSetOffset = vi.fn();
    const html = card({ offset: 4, onSetOffset });
    expect(html).toContain('aria-label="RG offset +1"');
    expect(html).toContain('value="4"');
    expect(html).not.toMatch(/save \+|revert/);
    expect(card({ saving: true })).toContain('saving…');
  });

  it('opens the book to nudge against the page itself', () => {
    expect(card()).toMatch(/<button[^>]*>open<\/button>/);
    // A registry row with no file has nothing to open.
    expect(card({ book: book({ hasFile: false }) })).toMatch(/<button[^>]*disabled[^>]*>open<\/button>/);
  });
});

describe('the empty shelf tells the GM exactly what to run (FR11.7)', () => {
  it('prints the working commands, the cost, and the privacy rule', () => {
    const html = renderToStaticMarkup(<SeedInstructions />);
    expect(html).toContain('pnpm seed:books --list');
    expect(html).toContain('pnpm seed:books --calibrate');
    expect(html).not.toContain('-- --list'); // the broken separator form
    expect(html).toContain('17 books');
    expect(html).toContain('3,542 pages');
    expect(html).toContain('30–90 seconds');
    expect(html).toContain('--only SR5');
    expect(html).toMatch(/nothing is uploaded/i);
    expect(html).toMatch(/single-process/i);
  });

  it('does not send the GM off with the form that leaves 15 books wrong', () => {
    // The import step must carry --calibrate. Without it the run is faster and
    // the shelf comes back with sixteen books at +0, fifteen of which are not.
    const html = renderToStaticMarkup(<SeedInstructions />);
    const importStep = html.slice(html.indexOf('2 ·'), html.indexOf('3 ·'));
    expect(importStep).toContain('pnpm seed:books --calibrate');
    expect(importStep).toMatch(/15 of the 17/);
  });
});

// --- the whole page -------------------------------------------------------

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

function renderPage(shelf: BookRecord[] | undefined): string {
  const store = fakeStorage();
  store.setItem(
    'safehouse.session.gm',
    JSON.stringify({ token: 't', role: 'gm', campaignId: 'c1' }),
  );
  const prevLocal = Reflect.get(globalThis, 'localStorage');
  const prevTab = Reflect.get(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: fakeStorage(),
    configurable: true,
  });
  try {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (shelf) qc.setQueryData(['campaign', 'c1', 'books'], shelf);
    const tree: ReactNode = (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/c/c1/gm/books']}>
          <Routes>
            <Route path="/c/:campaignId/gm/books" element={<BooksPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    return renderToStaticMarkup(tree);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      value: prevLocal,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: prevTab,
      configurable: true,
    });
  }
}

describe('BooksPage', () => {
  it('hydrates the shelf and leads with how many books are uncalibrated', () => {
    const html = renderPage([
      book({ id: 'sr5', code: 'SR5', title: 'Core Rulebook', pageOffset: 5 }),
      book({ id: 'rg', code: 'RG', title: 'Run & Gun', pageOffset: 0 }),
      book({ id: 'sg', code: 'SG', title: 'Street Grimoire', pageOffset: 0 }),
    ]);
    expect(html).toContain('3 books');
    expect(html).toContain('1 calibrated');
    expect(html).toContain('2 not calibrated');
    // Detect-all targets the uncalibrated ones — sixteen is the real case.
    expect(html).toContain('detect all (2)');
    expect(html).toContain('nothing is saved until you apply it per book');
    expect(html).toContain('data-book-code="SR5"');
    expect(html).toContain('data-book-code="RG"');
    // Each row starts from its own saved offset without waiting for effects.
    expect(html).toContain('data-calibration="calibrated"');
    expect(html).toContain('data-calibration="uncalibrated"');
  });

  it('shows the seed instructions when the shelf is empty', () => {
    const html = renderPage([]);
    expect(html).toContain('data-testid="seed-instructions"');
    expect(html).toContain('pnpm seed:books --list');
    expect(html).not.toContain('data-testid="book-row"');
    expect(html).not.toContain('detect all');
  });
});
