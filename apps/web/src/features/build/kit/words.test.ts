/**
 * The kit's words about pools and prices (`words.ts`). Pinned: a pool is
 * "N of M … left" in its own unit, an overspend is said in words with how far
 * over and never as a negative number, a unit of one is singular, and a
 * quoted price says whether the pool can pay it and by how much it cannot —
 * or that the pool gains, for a negative quality.
 */
import { describe, expect, it } from 'vitest';
import type { BudgetPool } from '@safehouse/contracts';
import { amountOf, costQuote, poolOf, poolSentence } from './words.js';
import { SETTINGS, conceptBuild } from '../testing.js';
import { budgets } from '@safehouse/rules';

const pool = (available: number, spent: number): BudgetPool => ({ available, spent, remaining: available - spent });

describe('poolSentence', () => {
  it('says what is left of a pool in its own unit', () => {
    expect(poolSentence('skills', pool(28, 16))).toBe('12 of 28 skill points left');
    expect(poolSentence('karma', pool(25, 0))).toBe('25 of 25 Karma left');
    expect(poolSentence('nuyen', pool(50000, 38000))).toBe('12,000¥ of 50,000¥ left');
    expect(poolSentence('powerPoints', pool(6, 5.5))).toBe('0.5 of 6 power points left');
    expect(poolSentence('contactKarma', pool(9, 9))).toBe('0 of 9 contact Karma left');
  });

  it('says an overspend in words, with how far over and what was spent', () => {
    expect(poolSentence('skills', pool(28, 31))).toBe('3 skill points over: 31 spent of 28');
    expect(poolSentence('skills', pool(28, 29))).toBe('1 skill point over: 29 spent of 28');
    expect(poolSentence('nuyen', pool(50000, 51200))).toBe('1,200¥ over: 51,200¥ spent of 50,000¥');
    expect(poolSentence('skills', pool(28, 31))).not.toMatch(/-\d/);
  });

  it('reads the pool off the engine\'s budgets', () => {
    const b = budgets(conceptBuild('muscle'), SETTINGS);
    const skills = poolOf(b, 'skills');
    expect(skills).toBeDefined();
    expect(poolSentence('skills', skills!)).toBe(`${skills!.remaining} of ${skills!.available} skill points left`);
  });
});

describe('amountOf', () => {
  it('names one unit in the singular and the rest in the plural', () => {
    expect(amountOf('special', 1)).toBe('1 special point');
    expect(amountOf('forms', 2)).toBe('2 complex forms');
    expect(amountOf('karma', 1)).toBe('1 Karma');
    expect(amountOf('nuyen', 2000)).toBe('2,000¥');
  });
});

describe('costQuote', () => {
  it('quotes a price the pool can pay', () => {
    expect(costQuote(10, 'karma', pool(26, 0))).toEqual({ text: 'costs 10 Karma — you have 26', short: false });
    expect(costQuote(26, 'karma', pool(26, 0)).short).toBe(false);
  });

  it('says how short the pool is, or that it is over already', () => {
    expect(costQuote(10, 'karma', pool(26, 20))).toEqual({ text: 'costs 10 Karma — you have 6, 4 short', short: true });
    expect(costQuote(5, 'karma', pool(25, 28))).toEqual({ text: 'costs 5 Karma — you are already 3 over', short: true });
    expect(costQuote(5000, 'nuyen', pool(50000, 48000))).toEqual({ text: 'costs 5,000¥ — you have 2,000¥, 3,000¥ short', short: true });
  });

  it('says a negative amount gives, and quotes only the price without a pool', () => {
    expect(costQuote(-10, 'karma', pool(26, 0))).toEqual({ text: 'gives 10 Karma — you have 26', short: false });
    expect(costQuote(7, 'karma', undefined)).toEqual({ text: 'costs 7 Karma', short: false });
  });
});
