/**
 * /c/:campaignId/gm/books — the rules library shelf (M11): registered PDFs as
 * a grid of cards with code, title, printed→PDF page-offset editor with a
 * calibration stepper (FR11.1), shared-with-table toggle (FR11.5), and
 * one-tap open into the in-app viewer (FR11.3).
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useBooks, useUpdateBook, type BookRecord } from './books/api.js';
import { BookViewerOverlay } from './books/RefChip.js';
import { ErrorNote, Field, GmGuard, inputClass, SectionTitle, Spinner } from './ui.js';

interface CalibrationState {
  book: BookRecord;
  printedPage: number;
  offset: number;
}

function BookCard({
  book,
  campaignId,
  onCalibrate,
  onOpen,
}: {
  book: BookRecord;
  campaignId: string;
  onCalibrate: (state: CalibrationState) => void;
  onOpen: (book: BookRecord) => void;
}) {
  const update = useUpdateBook(campaignId);
  const [offset, setOffset] = useState(book.pageOffset);
  const [calPage, setCalPage] = useState(1);
  const dirty = offset !== book.pageOffset;

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="chip border-cyan-dim text-cyan">{book.code}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{book.title}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Page offset">
          <input
            type="number"
            className={inputClass}
            value={offset}
            onChange={(e) => setOffset(Math.round(Number(e.target.value) || 0))}
            aria-label={`${book.code} page offset`}
          />
        </Field>
        <Field label="Calibrate at printed p.">
          <input
            type="number"
            min={1}
            className={inputClass}
            value={calPage}
            onChange={(e) => setCalPage(Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>
      </div>
      <p className="mono-label text-faint">printed + offset = pdf page (core book is +5)</p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn px-3 py-1.5"
          onClick={() => onCalibrate({ book, printedPage: calPage, offset })}
        >
          calibrate
        </button>
        <button className="btn btn-accent px-3 py-1.5" onClick={() => onOpen(book)}>
          open
        </button>
        {dirty && (
          <button
            className="btn px-3 py-1.5 text-warn"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: book.id, patch: { pageOffset: offset } })}
          >
            {update.isPending ? 'saving…' : 'save offset'}
          </button>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={book.shared}
            onChange={(e) => update.mutate({ id: book.id, patch: { shared: e.target.checked } })}
          />
          <span className="mono-label">shared with table</span>
        </label>
      </div>
      <ErrorNote error={update.error} />
    </div>
  );
}

export default function BooksPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const books = useBooks(campaignId ?? '');
  const update = useUpdateBook(campaignId ?? '');
  const [calibrating, setCalibrating] = useState<CalibrationState | null>(null);
  const [viewing, setViewing] = useState<BookRecord | null>(null);

  return (
    <GmGuard>
      <div className="p-6">
        <SectionTitle hint="M11 — the table's own PDFs, seeded via pnpm seed:books">
          Rules library
        </SectionTitle>
        <h1 className="mt-1 text-lg font-semibold">Books</h1>

        {books.isLoading && <div className="mt-6"><Spinner label="loading shelf" /></div>}
        <ErrorNote error={books.error} />

        {books.data && books.data.length === 0 && (
          <p className="mt-4 text-sm text-dim">
            No books registered. Run <code className="text-cyan">pnpm seed:books</code> on the
            server to import the PDF folder (FR11.7).
          </p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(books.data ?? []).map((book) => (
            <BookCard
              key={book.id}
              book={book}
              campaignId={campaignId ?? ''}
              onCalibrate={setCalibrating}
              onOpen={setViewing}
            />
          ))}
        </div>

        {viewing && (
          <BookViewerOverlay
            code={viewing.code}
            printedPage={1}
            onClose={() => setViewing(null)}
          />
        )}

        {calibrating && (
          <BookViewerOverlay
            code={calibrating.book.code}
            printedPage={calibrating.printedPage}
            calibrate={{
              offset: calibrating.offset,
              onNudge: (delta) =>
                setCalibrating((s) => (s ? { ...s, offset: s.offset + delta } : s)),
              onSave: () => {
                update.mutate(
                  { id: calibrating.book.id, patch: { pageOffset: calibrating.offset } },
                  { onSuccess: () => setCalibrating(null) },
                );
              },
              saving: update.isPending,
            }}
            onClose={() => setCalibrating(null)}
          />
        )}
      </div>
    </GmGuard>
  );
}
