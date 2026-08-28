/**
 * Books data layer (M11): registry CRUD (DESIGN §12: CRUD /api/books,
 * PATCH code/offset/shared) and the reader mapping JSON for the viewer.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Book } from '@safehouse/contracts';
import { apiGet, apiPatch, apiPost, queryClient } from '../../../api/client.js';

export type BookRecord = Book & {
  id: string;
  /** False for a registry row with no PDF seeded yet. */
  hasFile?: boolean;
  fileUrl?: string;
  readUrl?: string;
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
