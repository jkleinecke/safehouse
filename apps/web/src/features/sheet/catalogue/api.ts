/**
 * The catalogue, as the sheet reads it: items, spells and powers by name out
 * of the books the GM seeded (`GET /api/catalogue/search`), and what the
 * library holds (`GET /api/catalogue/summary`).
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

export function useCatalogueSearch(q: string, kind?: CatalogueKind | '') {
  const query = q.trim();
  return useQuery({
    queryKey: ['catalogue', 'search', query, kind ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams({ q: query, limit: '25' });
      if (kind) params.set('kind', kind);
      return (await apiGet<{ query: string; hits: CatalogueHit[] }>(`/api/catalogue/search?${params}`)).hits;
    },
    enabled: query.length >= 2,
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
