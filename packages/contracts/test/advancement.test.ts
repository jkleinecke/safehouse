/**
 * Advancement's wire shapes (FR3.7, docs/CHARGEN.md §8.5): the advance
 * request is a build's Karma spend, a ledger entry may carry the change it
 * pays for, and a character row's build summary is the handful of fields
 * "built with Priority B/A/E/C/D" needs.
 *
 * Invented names only (§14).
 */
import { describe, expect, it } from 'vitest';
import {
  AdvanceMutationSchema,
  AdvanceRequestSchema,
  CharacterBuildSummarySchema,
  LedgerEntrySchema,
  SPEND_RATING_MAX,
} from '../src/index.js';

const raise = { kind: 'attribute', id: 'agi', from: 4, to: 5 } as const;

describe('AdvanceRequestSchema', () => {
  it('carries one Karma spend, and an optional state for the GM', () => {
    expect(AdvanceRequestSchema.parse({ spend: raise })).toEqual({ spend: raise });
    expect(AdvanceRequestSchema.parse({ spend: raise, state: 'pending' }).state).toBe('pending');
    expect(AdvanceRequestSchema.safeParse({ spend: raise, state: 'rejected' }).success).toBe(false);
    expect(AdvanceRequestSchema.safeParse({ spend: { kind: 'attribute', id: 'luck', from: 1, to: 2 } }).success).toBe(false);
  });

  it('defaults a specialisation to an active skill, as a build spend does', () => {
    const parsed = AdvanceRequestSchema.parse({ spend: { kind: 'specialization', id: 'pistols', spec: 'Revolvers' } });
    expect(parsed.spend).toEqual({ kind: 'specialization', list: 'active', id: 'pistols', spec: 'Revolvers' });
  });

  it('bounds the rating asked for, so no loop is asked to walk to a billion', () => {
    const rated = [
      { kind: 'skill', id: 'pistols', from: 3 },
      { kind: 'group', id: 'firearms', from: 3 },
      { kind: 'attribute', id: 'agi', from: 3 },
      { kind: 'knowledge', name: 'Safehouses', from: 3 },
      { kind: 'language', name: 'Sperethiel', from: 3 },
    ];
    for (const spend of rated) {
      expect(AdvanceRequestSchema.safeParse({ spend: { ...spend, to: 4 } }).success).toBe(true);
      expect(AdvanceRequestSchema.safeParse({ spend: { ...spend, to: SPEND_RATING_MAX } }).success).toBe(true);
      expect(AdvanceRequestSchema.safeParse({ spend: { ...spend, to: SPEND_RATING_MAX + 1 } }).success).toBe(false);
      expect(AdvanceRequestSchema.safeParse({ spend: { ...spend, to: 1_000_000_000 } }).success).toBe(false);
      expect(AdvanceRequestSchema.safeParse({ spend: { ...spend, from: SPEND_RATING_MAX + 1, to: 4 } }).success).toBe(false);
    }
    expect(AdvanceRequestSchema.safeParse({ spend: { kind: 'powerPoint', count: 4 } }).success).toBe(true);
    expect(AdvanceRequestSchema.safeParse({ spend: { kind: 'powerPoint', count: 1_000_000_000 } }).success).toBe(false);
  });

  it('bounds the free text a spend names its thing by, as every other name is bounded', () => {
    const long = 'a'.repeat(201);
    expect(AdvanceRequestSchema.safeParse({ spend: { kind: 'skill', id: 'pistols', from: 3, to: 4, target: 'Net gun' } }).success).toBe(true);
    expect(AdvanceRequestSchema.safeParse({ spend: { kind: 'skill', id: 'pistols', from: 3, to: 4, target: long } }).success).toBe(false);
    expect(AdvanceRequestSchema.safeParse({ spend: { kind: 'skill', id: long, from: 3, to: 4 } }).success).toBe(false);
    expect(AdvanceRequestSchema.safeParse({ spend: { kind: 'group', id: long, from: 3, to: 4 } }).success).toBe(false);
    expect(AdvanceRequestSchema.safeParse({ spend: { kind: 'specialization', id: long, spec: 'Revolvers' } }).success).toBe(false);
    expect(AdvanceRequestSchema.safeParse({ spend: { kind: 'specialization', id: 'pistols', spec: long } }).success).toBe(false);
  });
});

describe('a ledger entry carrying an advance', () => {
  const advance = {
    kind: 'advance' as const,
    spend: raise,
    cost: 25,
    trainingTime: { steps: [{ amount: 5, unit: 'week' as const }], total: { amount: 5, unit: 'week' as const } },
    label: 'Raise Agility 4 → 5',
  };

  it('round-trips the change with the entry', () => {
    const entry = LedgerEntrySchema.parse({
      id: 'led_9',
      characterId: 'chr_4',
      currency: 'karma',
      delta: -25,
      reason: 'Raise Agility 4 → 5 · 25 Karma',
      advance,
    });
    expect(entry.advance).toEqual(advance);
    expect(AdvanceMutationSchema.parse(advance)).toEqual(advance);
  });

  it('is absent on every other entry, and refuses a malformed one', () => {
    expect(LedgerEntrySchema.parse({ id: 'x', characterId: 'c', currency: 'karma', delta: 5, reason: 'Run pay' }).advance).toBeUndefined();
    expect(AdvanceMutationSchema.safeParse({ ...advance, cost: -1 }).success).toBe(false);
    expect(AdvanceMutationSchema.safeParse({ ...advance, trainingTime: { steps: [], total: { amount: 1, unit: 'year' } } }).success).toBe(
      false,
    );
  });
});

describe('CharacterBuildSummarySchema', () => {
  it('holds the method, level, printing, priorities, metatype and magic type', () => {
    const summary = {
      method: 'priority',
      level: 'experienced',
      table: 'sr5',
      priorities: { metatype: 'B', attributes: 'A', magic: 'E', skills: 'C', resources: 'D' },
      metatype: 'troll',
      magic: 'mundane',
    } as const;
    expect(CharacterBuildSummarySchema.parse(summary)).toEqual(summary);
  });
});
