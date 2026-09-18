/**
 * `useBuilderCatalogue` — one kind of the campaign's catalogue, a page at a
 * time, for the builder's pickers (FR3.9, docs/CHARGEN.md §8.5 "catalogue
 * search accepts kind without q (browse, alphabetical), books=…, offset",
 * §8.6 "catalogue picking reuses … the browse mode").
 *
 * The sheet's search box waits for two typed characters and shows one page
 * (`useCatalogueSearch`); a builder step cannot work that way — "every
 * quality" and "every piece of cyberware" have to be listable before a
 * first-timer knows a single name. So this reads `GET /api/catalogue/search`
 * in its browse mode: a kind with nothing typed lists that kind alphabetically,
 * something typed searches it, and "more" appends the next page
 * (`useInfiniteQuery`, `nextPageOffset`).
 *
 * The books are the campaign's character-creation books. The hook sends the
 * campaign id and the server narrows to `settings.chargen.books` — every
 * shared book when that list is empty — intersected with what this device may
 * open. It does not send the book codes itself: the server reads the same
 * settings the engine runs with, so the list cannot disagree with the
 * campaign, and a GM-only book on the allowed list stays closed to a player.
 *
 * Hits are the catalogue's typed rows (`CatalogueHit`), ready for the kit's
 * mappers and the picker's price, Availability and cap readings.
 */
import { useMemo } from 'react';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { apiGet } from '../../../api/client.js';
import { catalogueSearchPath, type CatalogueKind, type CataloguePage } from '../../sheet/catalogue/api.js';
import type { CatalogueHit } from '../../sheet/catalogue/toSheet.js';
import { mergeCataloguePages, nextPageOffset, readCataloguePage } from './catalogue.js';

export interface BuilderCatalogueQuery {
  /** The campaign whose character-creation books to draw on. */
  campaignId: string;
  kind: CatalogueKind;
  /** What was typed; empty browses the kind alphabetically. */
  q?: string;
  /** Where the first page starts (default 0). */
  offset?: number;
  /** Rows per page (default 25; the server caps it at 100). */
  limit?: number;
  /** False to hold the request (a picker that is folded away). */
  enabled?: boolean;
}

export interface BuilderCatalogue {
  /** Every row loaded so far, in the server's order, each once. */
  hits: CatalogueHit[];
  /** Every row that matches, across all pages; null until the first page lands. */
  total: number | null;
  hasMore: boolean;
  /** The first page is on its way. */
  loading: boolean;
  /** A further page is on its way. */
  loadingMore: boolean;
  error: unknown;
  /** Fetch the next page, when there is one and none is already coming. */
  loadMore: () => void;
}

export const BUILDER_CATALOGUE_LIMIT = 25;

/** The query key of one browse or search: its own prefix, apart from the sheet's search keys. */
export function builderCatalogueKey(query: BuilderCatalogueQuery): readonly unknown[] {
  return [
    'catalogue',
    'builder',
    query.campaignId,
    query.kind,
    (query.q ?? '').trim(),
    query.offset ?? 0,
    query.limit ?? BUILDER_CATALOGUE_LIMIT,
  ] as const;
}

/** One page's request path: the campaign's books, a kind, what was typed, where the page starts. */
export function builderCataloguePath(query: BuilderCatalogueQuery, offset: number): string {
  return catalogueSearchPath((query.q ?? '').trim(), query.kind, {
    campaignId: query.campaignId,
    offset,
    limit: query.limit ?? BUILDER_CATALOGUE_LIMIT,
  });
}

export function useBuilderCatalogue(query: BuilderCatalogueQuery): BuilderCatalogue {
  const start = query.offset ?? 0;
  const result = useInfiniteQuery<CataloguePage, Error, InfiniteData<CataloguePage, number>, readonly unknown[], number>({
    queryKey: builderCatalogueKey(query),
    queryFn: async ({ pageParam, signal }) =>
      readCataloguePage(await apiGet<unknown>(builderCataloguePath(query, pageParam), { signal }), pageParam),
    initialPageParam: start,
    getNextPageParam: (last) => nextPageOffset(last),
    enabled: Boolean(query.campaignId) && query.enabled !== false,
    staleTime: 60_000,
    retry: 0,
  });
  const pages = result.data?.pages;
  const merged = useMemo(() => mergeCataloguePages(pages ?? []), [pages]);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = result;
  return {
    hits: merged.hits,
    total: pages ? merged.total : null,
    hasMore: Boolean(hasNextPage),
    loading: result.isPending && result.fetchStatus !== 'idle',
    loadingMore: isFetchingNextPage,
    error: result.error,
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
  };
}
