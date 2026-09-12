/**
 * The acquisition mechanics as the core book lays them out under Buying Gear
 * (SR5 p.418): availability codes, the delivery band by price, extra dice for
 * money, who rolls what, and how an opposed result reads. Numbers only (§14).
 */
import { describe, expect, it } from 'vitest';
import { acquisitionReason, availabilityOutcome, contactSearcher, deliveryFor, extraDiceForOffer, hoursLabel, parseAvailability, runnerSearcher } from './acquire.js';

describe('parseAvailability', () => {
  it('reads the rating and the legality, or keeps a formula', () => {
    expect(parseAvailability('5R')).toEqual({ rating: 5, legality: 'restricted', formula: null });
    expect(parseAvailability('12F')).toEqual({ rating: 12, legality: 'forbidden', formula: null });
    expect(parseAvailability('4')).toEqual({ rating: 4, legality: 'legal', formula: null });
    expect(parseAvailability('—')).toEqual({ rating: 0, legality: 'legal', formula: null });
    expect(parseAvailability(null)).toEqual({ rating: 0, legality: 'legal', formula: null });
    expect(parseAvailability('(Rating x 2)F')).toEqual({ rating: 0, legality: 'forbidden', formula: '(Rating x 2)F' });
  });
});

describe('deliveryFor and hoursLabel', () => {
  it('follows the price bands', () => {
    expect(deliveryFor(50)).toEqual({ label: '6 hours', hours: 6 });
    expect(deliveryFor(725)).toEqual({ label: '1 day', hours: 24 });
    expect(deliveryFor(8_000)).toEqual({ label: '2 days', hours: 48 });
    expect(deliveryFor(50_000)).toEqual({ label: '1 week', hours: 168 });
    expect(deliveryFor(250_000)).toEqual({ label: '1 month', hours: 720 });
    expect(deliveryFor(null)).toEqual({ label: '6 hours', hours: 6 });
  });
  it('says how long', () => {
    expect(hoursLabel(12)).toBe('12 hours');
    expect(hoursLabel(72)).toBe('3 days');
    expect(hoursLabel(216)).toBe('1 week 2 days');
    expect(hoursLabel(0.4)).toBe('1 hour');
  });
});

describe('extraDiceForOffer', () => {
  it('is one die per extra quarter of list, capped at twelve', () => {
    expect(extraDiceForOffer(1000, 1000)).toBe(0);
    expect(extraDiceForOffer(1000, 1249)).toBe(0);
    expect(extraDiceForOffer(1000, 1250)).toBe(1);
    expect(extraDiceForOffer(1000, 2000)).toBe(4);
    expect(extraDiceForOffer(1000, 4000)).toBe(12);
    expect(extraDiceForOffer(1000, 9000)).toBe(12);
    expect(extraDiceForOffer(null, 500)).toBe(0);
    expect(extraDiceForOffer(0, 500)).toBe(0);
  });
});

describe('who rolls', () => {
  it('the runner rolls Negotiation + Charisma under their Social limit, or bare Charisma without the skill', () => {
    expect(runnerSearcher('Torque', 7, 4, 5)).toMatchObject({ kind: 'runner', name: 'Torque', pool: 7, limit: 5 });
    expect(runnerSearcher('Torque', undefined, 4, undefined)).toMatchObject({ pool: 4, limit: null, breakdown: [{ label: 'CHA (no Negotiation)', value: 4 }] });
  });
  it('a contact rolls the dice the GM gives them, with Connection on their limit', () => {
    expect(contactSearcher('Hoi', 3, 8, 5)).toMatchObject({ kind: 'contact', name: 'Hoi', pool: 8, limit: 8 });
    expect(contactSearcher('Hoi', 3, 8)).toMatchObject({ pool: 8, limit: null });
    expect(contactSearcher('Nobody', 0, -2).pool).toBe(0);
  });
});

describe('availabilityOutcome', () => {
  const day = deliveryFor(725);
  it('reads net hits against the delivery band', () => {
    expect(availabilityOutcome(3, day)).toMatchObject({ found: true, deliveryHours: 8, line: 'found — delivered in 8 hours (3 net hits)' });
    expect(availabilityOutcome(0, day)).toMatchObject({ found: true, deliveryHours: 48, line: 'found on a tie — delivered in 2 days' });
    expect(availabilityOutcome(-2, day)).toMatchObject({ found: false, retryAfterHours: 48, line: 'not found — try again after 2 days' });
  });
  it('carries a glitch as a warning and a critical glitch as the end', () => {
    expect(availabilityOutcome(1, day, 'glitch').line).toContain('glitch: the inquiry drew attention');
    expect(availabilityOutcome(1, day, 'glitch').found).toBe(true);
    expect(availabilityOutcome(4, day, 'critical')).toMatchObject({ found: false, glitch: 'critical' });
  });
});

describe('acquisitionReason', () => {
  it('says what was bought, who found it, when it arrives, and the price against list', () => {
    const item = { name: 'Zap Gun', bookCode: 'SR5', printedPage: 426 };
    expect(acquisitionReason(item, { price: 725 })).toBe('bought Zap Gun (SR5 p.426)');
    expect(acquisitionReason(item, { searcher: contactSearcher('Hoi', 3, 8), outcome: availabilityOutcome(2, deliveryFor(725)), listPrice: 725, price: 906 })).toBe(
      'bought Zap Gun (SR5 p.426) — found by Hoi, delivered in 12 hours — 125% of list (725¥)',
    );
    expect(acquisitionReason(item, { searcher: runnerSearcher('Torque', 5, 3, 4), outcome: availabilityOutcome(-1, deliveryFor(725)), listPrice: 725, price: 725 })).toBe('bought Zap Gun (SR5 p.426) — Torque could not find it');
    expect(acquisitionReason({ name: 'Own thing', bookCode: '', printedPage: 0 }, { listPrice: 300, price: 150 })).toBe('bought Own thing — 50% of list (300¥)');
  });
});
