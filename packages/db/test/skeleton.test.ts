import { describe, expect, it } from 'vitest';
import * as db from '../src/index.js';

// Skeleton smoke test: the exported surface exists (the db agent replaces
// behavioral coverage with real PGlite-backed tests).
describe('@safehouse/db skeleton', () => {
  it('exports the client factory and FTS helpers', () => {
    expect(typeof db.getDb).toBe('function');
    expect(typeof db.searchBookPages).toBe('function');
    expect(typeof db.searchCodex).toBe('function');
  });
});
