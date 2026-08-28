/**
 * Dice service sanity (DESIGN.md §10.1, G5): CSPRNG-backed d6 faces in range,
 * exact counts, and an rng() the pure rules engine can consume.
 */
import { describe, expect, it } from 'vitest';
import { rng, rollDice, rollDie } from '../src/services/dice.js';

describe('services/dice', () => {
  it('rollDie yields integers 1..6 and covers every face', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const face = rollDie();
      expect(Number.isInteger(face)).toBe(true);
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(6);
      seen.add(face);
    }
    expect(seen.size).toBe(6);
  });

  it('rollDice(n) returns exactly n faces; negatives and fractions clamp', () => {
    expect(rollDice(12)).toHaveLength(12);
    expect(rollDice(0)).toEqual([]);
    expect(rollDice(-4)).toEqual([]);
    expect(rollDice(3.9)).toHaveLength(3);
    for (const face of rollDice(50)) {
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(6);
    }
  });

  it('rng() stays in [0, 1) and maps uniformly onto d6 faces', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      counts[Math.floor(x * 6)]! += 1;
    }
    for (const c of counts) expect(c).toBeGreaterThan(0);
  });
});
