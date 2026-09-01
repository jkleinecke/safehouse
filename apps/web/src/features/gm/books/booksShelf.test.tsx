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
 *   3. stepping the offset moves the resolved PDF page the card advertises;
 *   4. an empty shelf prints the command that actually works.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BookShelfCard from './BookShelfCard.js';
import SeedInstructions from './SeedInstructions.js';
import BooksPage from './BooksPage.js';
import { normalizeDetection, stepOffset } from './calibration.js';
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

function card(props: Partial<Parameters<typeof BookShelfCard>[0]> = {}): string {
  const b = props.book ?? book();
  return renderToStaticMarkup(
    <BookShelfCard
      book={b}
      draftOffset={b.pageOffset}
      probePrinted={104}
      onDraftOffset={noop}
      onProbePrinted={noop}
      onSaveOffset={noop}
      onRevertOffset={noop}
      onDetect={noop}
      onApplyProposal={noop}
      onDismissProposal={noop}
      onToggleShared={noop}
      onOpenCalibrate={noop}
      {...props}
    />,
  );
}

describe('an uncalibrated book is visually distinct', () => {
  it('says "not calibrated" instead of printing a confident +0', () => {
    const html = card({ book: book({ pageOffset: 0 }) });
    expect(html).toContain('data-calibration="uncalibrated"');
    expect(html).toContain('not calibrated');
    expect(html).toContain('border-warn/50'); // the card itself is warn-toned
    expect(html).toMatch(/wrong page/i);
  });

  it('a measured book reads as calibrated and carries no warning', () => {
    const b = book({ id: 'sr5', code: 'SR5', title: 'Core Rulebook', pageOffset: 5 });
    const html = card({ book: b, draftOffset: 5 });
    expect(html).toContain('data-calibration="calibrated"');
    expect(html).toContain('offset +5');
    expect(html).not.toContain('not calibrated');
    expect(html).not.toContain('border-warn/50');
  });

  it('a registry row with no PDF cannot be detected', () => {
    const html = card({ book: book({ hasFile: false }) });
    expect(html).toContain('data-calibration="no-file"');
    expect(html).toContain('pnpm seed:books');
    // The detect button is present but disabled — nothing to read.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>detect offset<\/button>/);
  });

  it('is honest when a route did not report page counts', () => {
    // The single-book routes carry no counts; only the listing does.
    expect(card()).toContain('page counts not reported');
  });

  it('reports what the listing sends, and the gap when a PDF count exists', () => {
    const indexedOnly = card({ book: book({ indexedPages: 199 }) });
    expect(indexedOnly).toContain('199 pages indexed');
    // No pdf page count exists anywhere, so no fabricated total and no gap.
    expect(indexedOnly).not.toContain('pdf pages');
    expect(indexedOnly).not.toContain('image-only');

    const withStats = card({ book: book({ pdfPages: 202, indexedPages: 199 }) });
    expect(withStats).toContain('202 pdf pages');
    expect(withStats).toContain('199 pages indexed');
    expect(withStats).toContain('3 image-only');
  });

  /**
   * The failure that looks like success: a seeded book whose scans are pure
   * image indexes nothing, so search silently never matches it. Every other
   * line on the card says the book is fine.
   */
  it('calls out a seeded book that indexed nothing at all', () => {
    const html = card({ book: book({ hasFile: true, indexedPages: 0 }) });
    expect(html).toContain('0 pages indexed');
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
    expect(html).toContain('printed 100 found on pdf page 106');
    expect(html).toContain('Would change +0 → +6.');
  });

  it('does not apply it: the book still reads uncalibrated until the click', () => {
    const onApplyProposal = vi.fn();
    const html = card({ book: book({ pageOffset: 0 }), proposal, onApplyProposal });
    expect(onApplyProposal).not.toHaveBeenCalled();
    expect(html).toContain('data-calibration="uncalibrated"');
    expect(html).toContain('not saved yet');
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
  it('shows the PDF page a printed page resolves to', () => {
    expect(card({ probePrinted: 104, draftOffset: 0 })).toContain(
      'printed p.104 → PDF page 104 (+0)',
    );
  });

  it('stepping the offset moves the resolved PDF page', () => {
    let offset = 0;
    const onDraftOffset = (next: number) => {
      offset = next;
    };
    // Render, then drive the same transition the ± buttons drive.
    const before = card({ probePrinted: 104, draftOffset: offset, onDraftOffset });
    expect(before).toContain('PDF page 104');
    expect(before).toContain('aria-label="RG offset +1"');

    offset = stepOffset(offset, 1);
    expect(card({ probePrinted: 104, draftOffset: offset })).toContain(
      'printed p.104 → PDF page 105 (+1)',
    );

    offset = stepOffset(offset, 4);
    const at5 = card({ probePrinted: 104, draftOffset: offset });
    expect(at5).toContain('printed p.104 → PDF page 109 (+5)');
    // A moved offset offers to save; an untouched one does not.
    expect(at5).toMatch(/save \+5/);
    expect(card({ probePrinted: 104, draftOffset: 0 })).not.toMatch(/save \+/);
  });

  it('offers both the in-app nudge and a shareable verify link', () => {
    const html = card({ probePrinted: 104 });
    expect(html).toContain('open p.104 &amp; nudge');
    expect(html).toContain('href="/read/RG?p=104"');
    expect(html).toContain('verify');
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
    // Each card starts from its own saved offset without waiting for effects.
    expect(html).toContain('data-calibration="calibrated"');
    expect(html).toContain('data-calibration="uncalibrated"');
  });

  it('shows the seed instructions when the shelf is empty', () => {
    const html = renderPage([]);
    expect(html).toContain('data-testid="seed-instructions"');
    expect(html).toContain('pnpm seed:books --list');
    expect(html).not.toContain('data-testid="book-card"');
    expect(html).not.toContain('detect all');
  });
});
