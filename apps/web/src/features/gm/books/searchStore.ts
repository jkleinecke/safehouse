/**
 * The book search, reachable from anywhere (FR12.14 for everyone at the
 * table). One store, so a "find" chip on a sheet row, the header button and
 * a keyboard shortcut all open the same overlay with the same query — over
 * whatever the table was looking at, without losing it (FR11.3's rule).
 */
import { create } from 'zustand';

export interface BookSearchState {
  open: boolean;
  /** What the box opens with; the user edits from there. */
  query: string;
  openSearch: (query?: string) => void;
  closeSearch: () => void;
}

export const useBookSearchStore = create<BookSearchState>((set) => ({
  open: false,
  query: '',
  openSearch: (query = '') => set({ open: true, query }),
  closeSearch: () => set({ open: false }),
}));

/** For code that is not a component: a chip's click handler, a shortcut. */
export function openBookSearch(query = ''): void {
  useBookSearchStore.getState().openSearch(query);
}
