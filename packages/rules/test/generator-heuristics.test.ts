import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_TABLE,
  MOTIVATION_TABLE,
  NAME_TABLE,
  QUIRK_TABLE,
  exchangeEstimate,
  exchangePair,
  expectedHits,
  parseDv,
} from '../src/index.js';

describe('expectedHits', () => {
  it('is pool / 3', () => {
    expect(expectedHits(12)).toBe(4);
    expect(expectedHits(9)).toBe(3);
    expect(expectedHits(15)).toBe(5);
    expect(expectedHits(10)).toBeCloseTo(10 / 3);
    expect(expectedHits(0)).toBe(0);
    expect(expectedHits(-4)).toBe(0);
  });
});

describe('parseDv', () => {
  it('parses common user-entered damage codes', () => {
    expect(parseDv('8P')).toEqual({ base: 8, type: 'P' });
    expect(parseDv('10S(e)')).toEqual({ base: 10, type: 'S', tag: 'e' });
    expect(parseDv('12p(f)')).toEqual({ base: 12, type: 'P', tag: 'f' });
    expect(parseDv('9')).toEqual({ base: 9, type: 'P' });
    expect(() => parseDv('banana')).toThrow(/unparseable/);
  });
});

describe('exchangeEstimate — FR10.5 spec example', () => {
  // "attack 12 vs. defense 9 → ~1 net hit → DV 8P+1 vs. soak 15 → ~4 boxes per connect"
  it('attack 12 vs defense 9, DV 8P, soak 15 → 1 net, 4 boxes', () => {
    const est = exchangeEstimate(12, 9, '8P', 15);
    expect(est.attackHits).toBe(4);
    expect(est.defenseHits).toBe(3);
    expect(est.netHits).toBe(1);
    expect(est.connects).toBe(true);
    expect(est.modifiedDv).toBe(9);
    expect(est.soakHits).toBe(5);
    expect(est.boxesPerConnect).toBe(4);
    expect(est.dv.type).toBe('P');
    expect(est.summary).toContain('attack 12 vs defense 9');
    expect(est.summary).toContain('~1 net');
    expect(est.summary).toContain('~4 boxes');
  });

  it('expected miss when defense outweighs attack', () => {
    const est = exchangeEstimate(6, 12, '8P', 9);
    expect(est.netHits).toBe(0);
    expect(est.connects).toBe(false);
    expect(est.boxesPerConnect).toBe(0);
    expect(est.summary).toContain('expected miss');
  });

  it('soak can zero out the damage without going negative', () => {
    const est = exchangeEstimate(12, 9, '2S', 21);
    expect(est.connects).toBe(true);
    expect(est.modifiedDv).toBe(3);
    expect(est.soakHits).toBe(7);
    expect(est.boxesPerConnect).toBe(0);
  });

  it('stun codes carry through', () => {
    const est = exchangeEstimate(15, 6, '10S(e)', 9);
    expect(est.dv).toEqual({ base: 10, type: 'S', tag: 'e' });
    expect(est.netHits).toBe(3);
    expect(est.modifiedDv).toBe(13);
    expect(est.boxesPerConnect).toBe(10);
  });
});

describe('exchangePair — both directions (FR10.5)', () => {
  it('computes A→B and B→A', () => {
    const { aVsB, bVsA } = exchangePair(
      { attackPool: 12, defensePool: 9, dv: '8P', soakPool: 12 },
      { attackPool: 9, defensePool: 9, dv: '7P', soakPool: 15 },
    );
    expect(aVsB).toEqual(exchangeEstimate(12, 9, '8P', 15));
    expect(bVsA).toEqual(exchangeEstimate(9, 9, '7P', 12));
  });
});

describe('flavor tables', () => {
  it('meet the size floors (FR10.2 shipped defaults)', () => {
    expect(NAME_TABLE.length).toBeGreaterThanOrEqual(60);
    expect(QUIRK_TABLE.length).toBeGreaterThanOrEqual(40);
    expect(APPEARANCE_TABLE.length).toBeGreaterThanOrEqual(40);
    expect(MOTIVATION_TABLE.length).toBeGreaterThanOrEqual(40);
  });

  it('contain no duplicates or empty entries', () => {
    for (const table of [NAME_TABLE, QUIRK_TABLE, APPEARANCE_TABLE, MOTIVATION_TABLE]) {
      expect(new Set(table).size).toBe(table.length);
      for (const entry of table) expect(entry.trim().length).toBeGreaterThan(0);
    }
  });
});
