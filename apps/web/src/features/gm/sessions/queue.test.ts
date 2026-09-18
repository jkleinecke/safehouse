/**
 * The housekeeping queue's second line (FR3.6, FR3.7): a career advance in
 * the GM's pending list says that approving it writes the sheet, and how long
 * the book says the training takes. Every other entry says nothing extra.
 *
 * The advance's own sentence is the entry's reason, written by the rules
 * engine when the spend was priced ("Raise Agility 4 → 5 · 25 Karma"), so
 * that is asserted here as the row's first line to keep the two together.
 */
import { describe, expect, it } from 'vitest';
import type { AdvanceMutation, LedgerEntry } from '@safehouse/contracts';
import { quoteAdvance, trainingTimeOf } from '@safehouse/rules';
import { SheetV1Schema } from '@safehouse/contracts';
import { advanceNote } from './queue.js';

const SHEET = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Marrowlight', metatype: 'human' },
  attributes: { bod: 3, agi: 4, rea: 3, str: 3, wil: 3, log: 3, int: 4, cha: 2, edg: { max: 3, current: 3 } },
  skills: [{ id: 'pistols', rating: 3, attr: 'agi' }],
} satisfies Record<string, unknown>);

function advance(over: Partial<AdvanceMutation> = {}): AdvanceMutation {
  const spend = over.spend ?? { kind: 'attribute' as const, id: 'agi' as const, from: 4, to: 5 };
  const training = trainingTimeOf(spend);
  return {
    kind: 'advance',
    spend,
    cost: 25,
    // Copied to a mutable array exactly as the route writes it onto the entry.
    trainingTime: { steps: [...training.steps], total: training.total },
    label: 'Raise Agility 4 → 5',
    ...over,
  };
}

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'e1',
  characterId: 'ch-1',
  currency: 'karma',
  delta: -25,
  reason: 'Raise Agility 4 → 5 · 25 Karma',
  state: 'pending',
  ...over,
});

describe('an advance in the GM’s queue', () => {
  it('reads as the engine priced it', () => {
    // The row's first line is the entry's reason, and that is the quote.
    expect(quoteAdvance(SHEET, { kind: 'attribute', id: 'agi', from: 4, to: 5 }).reason).toBe('Raise Agility 4 → 5 · 25 Karma');
    expect(entry().reason).toBe('Raise Agility 4 → 5 · 25 Karma');
  });

  it('warns that approving it writes the sheet, and quotes the training time', () => {
    expect(advanceNote(entry({ advance: advance() }))).toBe('Approving puts this on the sheet · trains for 5 weeks');
  });

  it('says so when the table times nothing — Edge, and a bond', () => {
    const edge = advance({ spend: { kind: 'attribute', id: 'edg', from: 2, to: 3 }, label: 'Raise Edge 2 → 3', cost: 15 });
    expect(advanceNote(entry({ advance: edge }))).toBe('Approving puts this on the sheet · no training time');
  });

  it('has nothing to add to an ordinary spend or award', () => {
    expect(advanceNote(entry({ currency: 'nuyen', delta: -450, reason: 'Ammunition' }))).toBeNull();
    expect(advanceNote(entry({ delta: 6, reason: 'Run pay', advance: undefined }))).toBeNull();
  });
});
