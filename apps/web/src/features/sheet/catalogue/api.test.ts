/**
 * The catalogue request as the client builds it: a search, a browse, several
 * books and the builder's campaign all go to the one route, and an old
 * caller's search reads exactly as it did.
 */
import { describe, expect, it } from 'vitest';
import { catalogueSearchPath } from './api.js';

const paramsOf = (path: string) => Object.fromEntries(new URL(path, 'http://x').searchParams);

describe('catalogueSearchPath', () => {
  it('sends an old caller\'s search as before', () => {
    expect(paramsOf(catalogueSearchPath(' zap ', 'weapon'))).toEqual({ q: 'zap', kind: 'weapon', limit: '25' });
    expect(paramsOf(catalogueSearchPath('zap'))).toEqual({ q: 'zap', limit: '25' });
  });

  it('browses a kind with no query, a page at a time, from several books or the campaign\'s', () => {
    expect(paramsOf(catalogueSearchPath('', 'quality', { books: ['SR5', 'RF'], offset: 50, limit: 50, campaignId: 'c-1' }))).toEqual({
      kind: 'quality',
      books: 'SR5,RF',
      campaignId: 'c-1',
      offset: '50',
      limit: '50',
    });
    expect(catalogueSearchPath('', 'quality', { books: [] })).toBe('/api/catalogue/search?kind=quality&limit=25');
  });
});
