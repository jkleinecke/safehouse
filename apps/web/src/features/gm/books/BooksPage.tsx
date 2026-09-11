/**
 * `/c/:campaignId/gm/books` — the rules library shelf (M11).
 *
 * The screen exists for one job the GM cannot do anywhere else: make printed
 * page numbers mean the right PDF page (FR11.1). `pnpm seed:books` gets all
 * seventeen books in in about thirty seconds and leaves every one of them at
 * offset +0; only the core book's +5 was ever measured. So the shelf leads with
 * how many books are still uncalibrated, offers detection for the whole shelf
 * at once (sixteen is the real number), and never applies a detected offset
 * without a click — a proposal is a draft, the GM approves it (Principle 8).
 *
 * Also here: the shared-with-table toggle (FR11.5) and a verify link that opens
 * the reader at a printed page so the mapping can be confirmed end to end.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useBooks, useDetectOffset, useUpdateBook, type BookRecord } from './api.js';
import BookSearch from './BookSearch.js';
import BookShelfCard, { type DetectPhase } from './BookShelfCard.js';
import LibraryPanel from './LibraryPanel.js';
import SeedInstructions from './SeedInstructions.js';
import { BookViewerOverlay } from './RefChip.js';
import {
  clampOffset,
  clampPrinted,
  detectQueue,
  shelfSummary,
  type OffsetProposal,
} from './calibration.js';
import { ErrorNote, GmGuard, SectionTitle, Spinner } from '../ui.js';

interface CalibrationSession {
  book: BookRecord;
  printedPage: number;
  offset: number;
}

type Dict<T> = Record<string, T>;

/** Default probe page: deep enough to be past the front matter of any book. */
const DEFAULT_PROBE = 50;

export default function BooksPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [search] = useSearchParams();
  const q = search.get('q') ?? undefined;
  const books = useBooks(campaignId ?? '');
  const update = useUpdateBook(campaignId ?? '');
  const detect = useDetectOffset();

  const [drafts, setDrafts] = useState<Dict<number>>({});
  const [probes, setProbes] = useState<Dict<number>>({});
  const [proposals, setProposals] = useState<Dict<OffsetProposal | null>>({});
  /** The server's own verdict per book — the reason, when it declined. */
  const [notes, setNotes] = useState<Dict<string | null>>({});
  const [phases, setPhases] = useState<Dict<DetectPhase>>({});
  const [errors, setErrors] = useState<Dict<string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [session, setSession] = useState<CalibrationSession | null>(null);
  const [sweep, setSweep] = useState<{ done: number; total: number } | null>(null);
  const [sweepNote, setSweepNote] = useState<string | null>(null);
  const cancelSweep = useRef(false);

  const rows = useMemo(() => books.data ?? [], [books.data]);

  // Hydrate on mount (and whenever the shelf reloads): every card starts from
  // the saved offset, so "dirty" means the GM moved it, not that we did.
  useEffect(() => {
    if (rows.length === 0) return;
    setDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const b of rows) {
        if (next[b.id] === undefined) {
          next[b.id] = b.pageOffset;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setProbes((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const b of rows) {
        if (next[b.id] === undefined) {
          next[b.id] = DEFAULT_PROBE;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const summary = useMemo(() => shelfSummary(rows), [rows]);

  const saveOffset = useCallback(
    (book: BookRecord, offset: number) => {
      setSavingId(book.id);
      update.mutate(
        { id: book.id, patch: { pageOffset: clampOffset(offset) } },
        {
          onSettled: () => setSavingId(null),
          onSuccess: () => {
            setDrafts((d) => ({ ...d, [book.id]: clampOffset(offset) }));
            setProposals((p) => ({ ...p, [book.id]: null }));
            setNotes((n) => ({ ...n, [book.id]: null }));
            setPhases((p) => ({ ...p, [book.id]: 'idle' }));
          },
        },
      );
    },
    [update],
  );

  /** One detection. Never writes — it parks a proposal on the card. */
  const runDetect = useCallback(
    async (book: BookRecord): Promise<boolean> => {
      setPhases((p) => ({ ...p, [book.id]: 'pending' }));
      setErrors((e) => ({ ...e, [book.id]: '' }));
      try {
        const result = await detect.mutateAsync(book.id);
        setProposals((p) => ({ ...p, [book.id]: result.proposal }));
        setNotes((n) => ({ ...n, [book.id]: result.note }));
        setPhases((p) => ({ ...p, [book.id]: result.proposal ? 'idle' : 'empty' }));
        return true;
      } catch (err) {
        setPhases((p) => ({ ...p, [book.id]: 'error' }));
        setErrors((e) => ({
          ...e,
          [book.id]: err instanceof Error ? err.message : String(err),
        }));
        return false;
      }
    },
    [detect],
  );

  /**
   * Detect across the shelf, one book at a time. Sequential because each
   * detection reads page text on the server, and because a GM watching sixteen
   * books resolve wants to see them land in order, not all at once at the end.
   */
  const runDetectAll = useCallback(
    async (includeCalibrated: boolean) => {
      const ids = detectQueue(rows, { includeCalibrated });
      if (ids.length === 0) return;
      cancelSweep.current = false;
      setSweepNote(null);
      setSweep({ done: 0, total: ids.length });
      for (const [i, id] of ids.entries()) {
        if (cancelSweep.current) break;
        const book = rows.find((b) => b.id === id);
        const ok = book ? await runDetect(book) : true;
        setSweep({ done: i + 1, total: ids.length });
        // If the very first book fails, detection is not available on this
        // server (or is broken); firing sixteen more doomed requests only
        // buries the reason. Stop and say so.
        if (!ok && i === 0) {
          if (ids.length > 1) {
            setSweepNote(
              'Detection failed on the first book, so the rest were not attempted — ' +
                'see that card for the reason. Every book can still be calibrated by hand.',
            );
          }
          break;
        }
      }
      setSweep(null);
    },
    [rows, runDetect],
  );

  const pendingSweep = sweep !== null;
  const queueSize = useMemo(() => detectQueue(rows).length, [rows]);

  return (
    <GmGuard>
      <div className="p-6">
        <SectionTitle hint="the table's own PDFs, seeded with pnpm seed:books">
          Rules library
        </SectionTitle>
        <h1 className="mt-1 text-lg font-semibold">Books</h1>

        {/* Look it up, and name the page (FR12.14, FR11.6) — above the calibration work. */}
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
          <BookSearch books={rows} initialQuery={q} />
          <LibraryPanel campaignId={campaignId ?? ''} canEdit books={rows} />
        </div>

        {books.isLoading && (
          <div className="mt-6">
            <Spinner label="loading shelf" />
          </div>
        )}
        <ErrorNote error={books.error} />
        <ErrorNote error={update.error} />

        {books.data && rows.length === 0 && (
          <div className="mt-4 max-w-3xl">
            <SeedInstructions />
          </div>
        )}

        {rows.length > 0 && (
          <div className="panel mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
            <span className="mono-label">
              {summary.total} book{summary.total === 1 ? '' : 's'}
            </span>
            <span className="mono-label text-ok">{summary.calibrated} calibrated</span>
            <span
              className={`mono-label ${summary.uncalibrated > 0 ? 'text-warn' : 'text-faint'}`}
              data-testid="uncalibrated-count"
            >
              {summary.uncalibrated} not calibrated
            </span>
            {summary.missingFile > 0 && (
              <span className="mono-label text-faint">{summary.missingFile} without a PDF</span>
            )}

            <span className="ml-auto flex flex-wrap items-center gap-2">
              {pendingSweep ? (
                <>
                  <Spinner label={`detecting ${sweep.done}/${sweep.total}`} />
                  <button
                    type="button"
                    className="btn px-3 py-1.5"
                    onClick={() => {
                      cancelSweep.current = true;
                    }}
                  >
                    stop
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-accent px-3 py-1.5"
                    disabled={queueSize === 0}
                    onClick={() => void runDetectAll(false)}
                    title="Propose an offset for every book still at the seeded default"
                  >
                    detect all ({queueSize})
                  </button>
                  <button
                    type="button"
                    className="btn px-3 py-1.5"
                    onClick={() => void runDetectAll(true)}
                    title="Include books that already have a measured offset"
                  >
                    re-detect everything
                  </button>
                </>
              )}
            </span>

            <p className="mono-label w-full text-faint">
              detection proposes; nothing is saved until you apply it per book
            </p>
            {sweepNote && (
              <p className="w-full text-xs text-warn" data-testid="sweep-note">
                {sweepNote}
              </p>
            )}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((book) => (
            <BookShelfCard
              key={book.id}
              book={book}
              draftOffset={drafts[book.id] ?? book.pageOffset}
              probePrinted={probes[book.id] ?? DEFAULT_PROBE}
              proposal={proposals[book.id] ?? null}
              detectPhase={phases[book.id] ?? 'idle'}
              detectNote={notes[book.id] ?? null}
              detectError={errors[book.id] ?? null}
              saving={savingId === book.id}
              onDraftOffset={(next) =>
                setDrafts((d) => ({ ...d, [book.id]: clampOffset(next) }))
              }
              onProbePrinted={(next) =>
                setProbes((p) => ({ ...p, [book.id]: clampPrinted(next) }))
              }
              onSaveOffset={() => saveOffset(book, drafts[book.id] ?? book.pageOffset)}
              onRevertOffset={() => setDrafts((d) => ({ ...d, [book.id]: book.pageOffset }))}
              onDetect={() => void runDetect(book)}
              onApplyProposal={() => {
                const p = proposals[book.id];
                if (p) saveOffset(book, p.offset);
              }}
              onDismissProposal={() => {
                setProposals((s) => ({ ...s, [book.id]: null }));
                setNotes((s) => ({ ...s, [book.id]: null }));
                setPhases((s) => ({ ...s, [book.id]: 'idle' }));
              }}
              onToggleShared={(next) => update.mutate({ id: book.id, patch: { shared: next } })}
              onOpenCalibrate={() =>
                setSession({
                  book,
                  printedPage: probes[book.id] ?? DEFAULT_PROBE,
                  offset: drafts[book.id] ?? book.pageOffset,
                })
              }
            />
          ))}
        </div>

        {rows.length > 0 && (
          <details className="mt-6 max-w-3xl">
            <summary className="mono-label cursor-pointer text-faint">
              adding or re-importing books
            </summary>
            <div className="mt-2">
              <SeedInstructions />
            </div>
          </details>
        )}

        {/* The nudge loop with the page itself beside it (FR11.1). */}
        {session && (
          <BookViewerOverlay
            code={session.book.code}
            printedPage={session.printedPage}
            calibrate={{
              offset: session.offset,
              onNudge: (delta) =>
                setSession((s) => (s ? { ...s, offset: clampOffset(s.offset + delta) } : s)),
              onSave: () => {
                const target = session.book;
                const offset = session.offset;
                setDrafts((d) => ({ ...d, [target.id]: offset }));
                saveOffset(target, offset);
                setSession(null);
              },
              saving: savingId === session.book.id,
            }}
            onClose={() => {
              // Keep the nudged value on the card so it is not lost on close.
              setDrafts((d) => ({ ...d, [session.book.id]: session.offset }));
              setSession(null);
            }}
          />
        )}
      </div>
    </GmGuard>
  );
}
