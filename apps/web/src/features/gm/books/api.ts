/**
 * Books data layer (M11): registry CRUD (DESIGN §12: CRUD /api/books,
 * PATCH code/offset/shared) and the reader mapping JSON for the viewer.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Book } from '@safehouse/contracts';
import { apiGet, apiPatch, apiPost, queryClient } from '../../../api/client.js';
import { detectionNote, normalizeDetection, type OffsetProposal } from './calibration.js';

export type BookRecord = Book & {
  id: string;
  /** False for a registry row with no PDF seeded yet. */
  hasFile?: boolean;
  fileUrl?: string;
  readUrl?: string;
  /**
   * How many pages of this book hold extracted, searchable text.
   *
   * Sent by `GET /api/books` only (one grouped count covers the whole shelf);
   * the single-book routes leave it undefined, and the shelf says "unknown"
   * rather than showing a zero that would read as "nothing indexed".
   */
  indexedPages?: number;
  /**
   * The book's PDF page count. NOT sent by any route: nothing in the schema
   * records it, and the only source is opening the file — too expensive for a
   * listing. Kept in the type because the shelf's "N image-only pages" line is
   * the useful thing to say once a counter for it exists, and because a
   * guessed number here would be worse than the honest unknown.
   */
  pdfPages?: number;
  /**
   * 'seed' | 'manual' | 'detected' — provenance for `pageOffset`.
   *
   * Also not sent: there is no `offset_source` column, and detect-offset
   * deliberately never writes, so no route is in a position to claim one. A
   * nonzero offset remains the only evidence that a human touched it.
   */
  offsetSource?: string;
};

/**
 * GET /api/books. The scope comes from the device token — this campaign's
 * books plus the global library, and non-GM devices see only `shared` ones —
 * so there is no campaign query parameter to get wrong (Principle 4).
 */
export function useBooks(campaignId: string) {
  return useQuery({
    queryKey: ['campaign', campaignId, 'books'],
    queryFn: async () => (await apiGet<{ books: BookRecord[] }>('/api/books')).books,
    enabled: Boolean(campaignId),
  });
}

export interface BookPatch {
  code?: string;
  title?: string;
  pageOffset?: number;
  shared?: boolean;
}

export function useUpdateBook(campaignId: string) {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: BookPatch }) =>
      apiPatch<BookRecord>(`/api/books/${id}`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'books'] });
    },
  });
}

/**
 * POST /api/books/:id/detect-offset — ask the server to *propose* an offset by
 * reading printed page numbers out of the extracted page text.
 *
 * Nothing here writes. The proposal comes back, the GM looks at the evidence,
 * and applying it is a separate `PATCH` (Principle 8: a machine drafts, the GM
 * approves). `normalizeDetection` reads the payload defensively, so a shape
 * mismatch surfaces as "no proposal" instead of a wrong offset saved.
 *
 * The server route is `apps/server/src/plugins/books.ts`; it answers with
 * `proposedOffset`, a 0–1 `confidence` and an `evidence` array of
 * `{ printedPage, pdfPage }` pairs, all of which `normalizeDetection` reads.
 * It is GM-only and it never writes — `apply` in its payload is the PATCH the
 * confirm step sends.
 */
export const DETECT_PATH = (id: string) => `/api/books/${encodeURIComponent(id)}/detect-offset`;

export interface DetectResult {
  bookId: string;
  proposal: OffsetProposal | null;
  /**
   * The server's own one-line verdict, shown as-is. When it declined, this is
   * the only place the *reason* lives — "no printed page numbers found (48 of
   * 48 sampled pages are image-only)" and "split vote — 21 pages say +1, 19
   * say +2" need different fixes from the GM, and the card must not flatten
   * them into a single guess.
   */
  note: string | null;
  /** Kept for the "no proposal" case so the card can say what came back. */
  raw: unknown;
}

export function useDetectOffset() {
  return useMutation({
    mutationFn: async (bookId: string): Promise<DetectResult> => {
      const raw = await apiPost<unknown>(DETECT_PATH(bookId), {});
      return { bookId, proposal: normalizeDetection(raw), note: detectionNote(raw), raw };
    },
  });
}

/**
 * GET /read/:bookCode?p=N — the server resolves printed → PDF page (FR11.7)
 * and hands back the file URL for the browser-native PDF iframe, already
 * anchored at the right page.
 */
export interface ReadInfo {
  bookId: string;
  /** The book's short code, e.g. the campaign's own registry key. */
  book: string;
  title: string;
  printedPage: number;
  pdfPage: number;
  pageOffset: number;
  /** The PDF itself, byte-range streamed (§12 `/files/books/:code`). */
  fileUrl: string;
  /** `fileUrl#page=N` — what the iframe src wants. */
  viewerUrl: string;
}

export function useReadInfo(bookCode: string | undefined, printedPage: number) {
  return useQuery({
    queryKey: ['read', bookCode, printedPage],
    queryFn: () => apiGet<ReadInfo>(`/read/${encodeURIComponent(bookCode ?? '')}?p=${printedPage}`),
    enabled: Boolean(bookCode),
    staleTime: 5 * 60_000,
    retry: 0,
  });
}
