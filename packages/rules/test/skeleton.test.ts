import { describe, expect, it } from 'vitest';
import { buyHits, deriveCharacter, environment, resolveRoll } from '../src/index.js';

// Skeleton smoke test: the public API surface exists. The rules agent's own
// suites replace the behavioral coverage.
describe('@safehouse/rules skeleton', () => {
  it('exports the engine functions', () => {
    expect(typeof deriveCharacter).toBe('function');
    expect(typeof resolveRoll).toBe('function');
    expect(typeof environment).toBe('function');
    expect(typeof buyHits).toBe('function');
  });

  it('buys hits at 4 dice : 1 hit', () => {
    expect(buyHits(0)).toBe(0);
    expect(buyHits(7)).toBe(1);
    expect(buyHits(12)).toBe(3);
  });
});
