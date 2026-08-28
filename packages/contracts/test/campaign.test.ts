import { describe, expect, it } from 'vitest';
import { LedgerEntrySchema, RollTableSchema, BookSchema } from '../src/index.js';

describe('LedgerEntrySchema (FR3.6)', () => {
  it('round-trips an approved award', () => {
    const entry = LedgerEntrySchema.parse({
      id: 'led_1',
      characterId: 'chr_1',
      currency: 'karma',
      delta: 6,
      reason: 'Milk run that went sideways — survived anyway',
      state: 'approved',
      sessionId: 'ses_3',
      runId: 'run_2',
      createdBy: 'usr_gm',
      approvedBy: 'usr_gm',
      createdAt: '2076-05-12T23:10:00.000Z',
    });
    expect(LedgerEntrySchema.parse(entry)).toEqual(entry);
  });

  it('defaults player spends to pending', () => {
    const spend = LedgerEntrySchema.parse({
      id: 'led_2',
      characterId: 'chr_1',
      currency: 'nuyen',
      delta: -4000,
      reason: 'new armor',
    });
    expect(spend.state).toBe('pending');
  });

  it('rejects unknown currencies and empty reasons', () => {
    expect(
      LedgerEntrySchema.safeParse({ id: 'x', characterId: 'c', currency: 'euro', delta: 1, reason: 'r' })
        .success,
    ).toBe(false);
    expect(
      LedgerEntrySchema.safeParse({ id: 'x', characterId: 'c', currency: 'karma', delta: 1, reason: '' })
        .success,
    ).toBe(false);
  });
});

describe('RollTableSchema (FR2.11)', () => {
  it('round-trips a weighted table', () => {
    const table = RollTableSchema.parse({
      id: 'rt_1',
      campaignId: 'cmp_1',
      kind: 'custom',
      title: 'Run Complications',
      entries: [
        { weight: 3, text: 'The Johnson is late' },
        { weight: 1, text: 'Rival team on the same job' },
        { text: 'Sudden downpour' },
      ],
      visibility: 'gm',
    });
    expect(RollTableSchema.parse(table)).toEqual(table);
    expect(table.entries[2]?.weight).toBe(1); // default weight
  });

  it('rejects non-positive weights', () => {
    expect(
      RollTableSchema.safeParse({ id: 'x', title: 'T', entries: [{ weight: 0, text: 'nope' }] })
        .success,
    ).toBe(false);
  });
});

describe('BookSchema (M11)', () => {
  it('round-trips a registered book with offset', () => {
    const book = BookSchema.parse({
      id: 'bk_1',
      campaignId: 'cmp_1',
      code: 'SR5',
      title: 'Core Rulebook',
      pageOffset: 5,
      shared: true,
      attachmentId: 'att_9',
    });
    expect(BookSchema.parse(book)).toEqual(book);
  });

  it('defaults offset 0 and shared true', () => {
    const book = BookSchema.parse({ code: 'RG', title: 'Run & Gun' });
    expect(book.pageOffset).toBe(0);
    expect(book.shared).toBe(true);
  });

  it('rejects empty or oversized codes', () => {
    expect(BookSchema.safeParse({ code: '', title: 'T' }).success).toBe(false);
    expect(BookSchema.safeParse({ code: 'X'.repeat(13), title: 'T' }).success).toBe(false);
  });
});
