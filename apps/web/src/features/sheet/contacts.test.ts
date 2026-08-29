/**
 * Contacts on the sheet (FR3.2 tab / FR5.8 data). The route landed after the
 * client did, so the normaliser has to cope with both the plugin's envelope
 * and the older shapes the sheet used to guess at.
 */
import { describe, expect, it } from 'vitest';
import { favourTotals, normalizeContacts } from './contacts.js';

/** Exactly what `GET /api/characters/:id/contacts` returns today. */
const ENVELOPE = {
  characterId: 'char-1',
  contacts: [
    {
      id: 'c2',
      characterId: 'char-1',
      name: 'Dozer',
      archetype: 'fixer',
      connection: 4,
      loyalty: 3,
      notes: 'Runs the Redmond end.',
      favours: { owed: 2, owing: 1 },
      npcPageId: 'page-9',
    },
    {
      id: 'c1',
      characterId: 'char-1',
      name: 'Ashline',
      archetype: 'talismonger',
      connection: 2,
      loyalty: 5,
      notes: '',
      favours: { owed: 0, owing: 0 },
      npcPageId: null,
    },
  ],
};

describe('normalizeContacts', () => {
  it('reads the plugin envelope and sorts by name', () => {
    const out = normalizeContacts(ENVELOPE);
    expect(out.map((c) => c.name)).toEqual(['Ashline', 'Dozer']);
    expect(out[1]).toMatchObject({
      id: 'c2',
      archetype: 'fixer',
      connection: 4,
      loyalty: 3,
      favours: { owed: 2, owing: 1 },
      npcPageId: 'page-9',
    });
  });

  it('accepts a bare array too', () => {
    expect(normalizeContacts(ENVELOPE.contacts)).toHaveLength(2);
  });

  it('fills in the fields an older row omitted', () => {
    const out = normalizeContacts([{ id: 'c', name: 'Wisp' }]);
    expect(out[0]).toEqual({
      id: 'c',
      name: 'Wisp',
      archetype: '',
      connection: 0,
      loyalty: 0,
      notes: '',
      favours: { owed: 0, owing: 0 },
      npcPageId: null,
    });
  });

  it('drops rows with nothing to identify them by', () => {
    expect(normalizeContacts([{ name: 'no id' }, { id: 'x' }, null, 7])).toEqual([]);
  });

  it('returns an empty list for a 404-shaped body rather than throwing', () => {
    expect(normalizeContacts({ error: { code: 'not_found', message: 'nope' } })).toEqual([]);
    expect(normalizeContacts(undefined)).toEqual([]);
  });
});

describe('favourTotals', () => {
  it('adds up who owes whom across the book', () => {
    expect(favourTotals(normalizeContacts(ENVELOPE))).toEqual({ owed: 2, owing: 1 });
    expect(favourTotals([])).toEqual({ owed: 0, owing: 0 });
  });
});
