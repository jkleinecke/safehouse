/**
 * The catalogue, as the sheet reads it: items, spells and powers by name out
 * of the books the GM seeded (`GET /api/catalogue/search`), and what the
 * library holds (`GET /api/catalogue/summary`).
 *
 * The same route browses: a kind with nothing typed lists that kind
 * alphabetically, a page at a time with its total — what the character
 * builder's pickers use, narrowed to the campaign's character-creation books
 * when they pass the campaign (docs/CHARGEN.md §8.5).
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../../api/client.js';
import type { CatalogueHit } from './toSheet.js';

export const CATALOGUE_KINDS = ['weapon', 'ammo', 'armor', 'augmentation', 'vehicle', 'electronics', 'program', 'gear', 'spell', 'power', 'quality', 'complex_form'] as const;
export type CatalogueKind = (typeof CATALOGUE_KINDS)[number];

export const KIND_LABEL: Record<CatalogueKind, string> = {
  weapon: 'weapons',
  ammo: 'ammunition',
  armor: 'armor',
  augmentation: 'cyberware & bioware',
  vehicle: 'vehicles & drones',
  electronics: 'commlinks & decks',
  program: 'programs',
  gear: 'gear',
  spell: 'spells',
  power: 'adept powers',
  quality: 'qualities',
  complex_form: 'complex forms',
};

/** The narrower searches the server takes beyond a query and a kind. */
export interface CatalogueSearchOptions {
  /** Book codes to draw on ("SR5", "RF"); omitted means every book this device may open. */
  books?: readonly string[];
  /**
   * The campaign whose character-creation books to draw on — the builder's
   * view (`settings.chargen.books`, or every shared book when that is empty).
   * It must be the campaign this device is bound to.
   */
  campaignId?: string;
  /** Rows to skip, for the next page. */
  offset?: number;
  /** Rows per page; the server caps it at 100. */
  limit?: number;
}

/** One page of a search or a browse, as `GET /api/catalogue/search` answers it. */
export interface CataloguePage {
  /** The query as searched; empty for a browse. */
  query: string;
  hits: CatalogueHit[];
  /** Every row that matches, across all pages. */
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/** The request path for a search (with `q`) or a browse (a `kind` and no `q`). */
export function catalogueSearchPath(q: string, kind?: CatalogueKind | '', opts: CatalogueSearchOptions = {}): string {
  const params = new URLSearchParams();
  const query = q.trim();
  if (query) params.set('q', query);
  if (kind) params.set('kind', kind);
  if (opts.books && opts.books.length > 0) params.set('books', opts.books.join(','));
  if (opts.campaignId) params.set('campaignId', opts.campaignId);
  if (opts.offset) params.set('offset', String(opts.offset));
  params.set('limit', String(opts.limit ?? 25));
  return `/api/catalogue/search?${params}`;
}

/** The sheet's search box: hits for two or more typed characters. */
export function useCatalogueSearch(q: string, kind?: CatalogueKind | '', opts: CatalogueSearchOptions = {}) {
  const query = q.trim();
  return useQuery({
    queryKey: ['catalogue', 'search', query, kind ?? '', opts.books?.join(',') ?? '', opts.campaignId ?? '', opts.offset ?? 0, opts.limit ?? 25],
    queryFn: async () => (await apiGet<CataloguePage>(catalogueSearchPath(query, kind, opts))).hits,
    enabled: query.length >= 2,
    staleTime: 60_000,
    retry: 0,
  });
}

/**
 * A page of one kind — browsed alphabetically while nothing is typed, searched
 * once something is — with its total, for a picker that lists everything
 * (the builder's qualities, its cyberware).
 */
export function useCataloguePage(kind: CatalogueKind, q = '', opts: CatalogueSearchOptions = {}) {
  const query = q.trim();
  return useQuery({
    queryKey: ['catalogue', 'page', kind, query, opts.books?.join(',') ?? '', opts.campaignId ?? '', opts.offset ?? 0, opts.limit ?? 25],
    queryFn: () => apiGet<CataloguePage>(catalogueSearchPath(query, kind, opts)),
    staleTime: 60_000,
    retry: 0,
  });
}

export interface CatalogueSummary {
  total: number;
  books: Array<{ bookId: string; code: string; title: string; items: number; byKind: Record<string, number> }>;
}

export function useCatalogueSummary() {
  return useQuery({
    queryKey: ['catalogue', 'summary'],
    queryFn: () => apiGet<CatalogueSummary>('/api/catalogue/summary'),
    staleTime: 60_000,
  });
}
