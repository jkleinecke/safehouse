/**
 * Reading a catalogue row's numbers back (`chargen/catalogue.ts`; FR3.9
 * P4–P5, docs/CHARGEN.md §8.3, §8.5).
 *
 * The seeder stores cells as printed strings; these readers are the one place
 * they become the numbers a build records, shared by the builder's steps and
 * the server. What is pinned: every quality price shape the parser emits
 * (flat, per rating with and without a maximum, a band, a list, nothing),
 * the Karma a choice records inside those shapes, an adept power's cost per
 * level, and a 'ware row's cost / Essence / Availability / capacity at a
 * rating — with an implant grade's multipliers from `IMPLANT_GRADES` only
 * when one is asked for, since a purchase records the standard figures and
 * the budget applies the grade. Every row is invented (§14).
 */
import { describe, expect, it } from 'vitest';
import { BuildPurchaseSchema } from '@safehouse/contracts';
import {
  IMPLANT_GRADES,
  catalogueQualityKarma,
  catalogueQualityPrice,
  cataloguePowerPoints,
  catalogueWareFigures,
  purchaseAvailability,
  purchaseCost,
  purchaseEssence,
} from '../src/index.js';

describe('catalogueQualityPrice', () => {
  it('reads a flat price, a price per rating, a band, a list and nothing', () => {
    expect(catalogueQualityPrice({ KARMA: '12', TYPE: 'positive' })).toEqual({ type: 'positive', karma: 12, perRating: null });
    expect(catalogueQualityPrice({ KARMA: '4', PER: 'rating', MAX: '3', TYPE: 'positive' })).toEqual({
      type: 'positive',
      karma: 4,
      perRating: { max: 3 },
    });
    expect(catalogueQualityPrice({ KARMA: '2', PER: 'rating', TYPE: 'negative' })).toEqual({ type: 'negative', karma: 2, perRating: { max: null } });
    expect(catalogueQualityPrice({ KARMA: '4-20', TYPE: 'negative' })).toEqual({ type: 'negative', karma: { min: 4, max: 20 }, perRating: null });
    expect(catalogueQualityPrice({ KARMA: '4 to 20', TYPE: 'negative' })).toEqual({ type: 'negative', karma: { min: 4, max: 20 }, perRating: null });
    expect(catalogueQualityPrice({ KARMA: '7 or 14', TYPE: 'positive' })).toEqual({
      type: 'positive',
      karma: { min: 7, max: 14 },
      choices: [7, 14],
      perRating: null,
    });
    expect(catalogueQualityPrice({ KARMA: '3, 6, OR 9', TYPE: 'negative' })).toMatchObject({ karma: { min: 3, max: 9 }, choices: [3, 6, 9] });
    expect(catalogueQualityPrice({ KARMA: 'Varies' })).toEqual({ type: null, karma: null, perRating: null });
    expect(catalogueQualityPrice({})).toEqual({ type: null, karma: null, perRating: null });
  });
});

describe('catalogueQualityKarma', () => {
  const rated = catalogueQualityPrice({ KARMA: '4', PER: 'rating', MAX: '3', TYPE: 'positive' });
  const band = catalogueQualityPrice({ KARMA: '4-20', TYPE: 'negative' });

  it('prices a rated quality at its rating — past the maximum too, which the validator reports', () => {
    expect(catalogueQualityKarma(rated, { rating: 3 })).toBe(12);
    expect(catalogueQualityKarma(rated)).toBe(4);
    expect(catalogueQualityKarma(rated, { rating: 4 })).toBe(16);
  });

  it('keeps a band\'s chosen Karma inside its bounds, starting at the lower one', () => {
    expect(catalogueQualityKarma(band, { karma: 10 })).toBe(10);
    expect(catalogueQualityKarma(band)).toBe(4);
    expect(catalogueQualityKarma(band, { karma: 30 })).toBe(20);
    expect(catalogueQualityKarma(band, { karma: 1 })).toBe(4);
  });

  it('takes a list price only at an amount it lists — the nearest, never one between ("7 or 14" is not 10)', () => {
    const list = catalogueQualityPrice({ KARMA: '7 or 14', TYPE: 'positive' });
    expect(catalogueQualityKarma(list)).toBe(7);
    expect(catalogueQualityKarma(list, { karma: 14 })).toBe(14);
    expect(catalogueQualityKarma(list, { karma: 10 })).toBe(7);
    expect(catalogueQualityKarma(list, { karma: 11 })).toBe(14);
    expect(catalogueQualityKarma(list, { karma: 30 })).toBe(14);
    const three = catalogueQualityPrice({ KARMA: '3, 6, OR 9', TYPE: 'negative' });
    expect([4, 5, 8].map((karma) => catalogueQualityKarma(three, { karma }))).toEqual([3, 6, 9]);
  });

  it('ignores a choice on a flat price, and takes the typed Karma when nothing is printed', () => {
    expect(catalogueQualityKarma(catalogueQualityPrice({ KARMA: '12' }), { rating: 3, karma: 2 })).toBe(12);
    expect(catalogueQualityKarma(catalogueQualityPrice({ KARMA: 'Varies' }), { karma: 6 })).toBe(6);
    expect(catalogueQualityKarma(catalogueQualityPrice({ KARMA: 'Varies' }))).toBe(0);
  });
});

describe('cataloguePowerPoints', () => {
  it('multiplies a per-level cost by the levels and keeps quarters exact', () => {
    expect(cataloguePowerPoints({ COST: '0.25 PP per level' }, 3)).toEqual({ points: 0.75, perLevel: true });
    expect(cataloguePowerPoints({ COST: '0.5 PP PER LEVEL' })).toEqual({ points: 0.5, perLevel: true });
    expect(cataloguePowerPoints({ COST: '1 PP' }, 4)).toEqual({ points: 1, perLevel: false });
    expect(cataloguePowerPoints({ COST: '.5' })).toEqual({ points: 0.5, perLevel: false });
    expect(cataloguePowerPoints({ COST: 'Varies' })).toEqual({ points: null, perLevel: false });
  });
});

describe('catalogueWareFigures', () => {
  const rows = {
    skullCase: { name: 'Skull Case', stats: { ESSENCE: '0.2', CAPACITY: '—' }, avail: '12F', cost: 4000, costText: null },
    hookClaw: { name: 'Hook Claw', stats: { ESSENCE: '—', CAPACITY: '[2]' }, avail: 'Rating x 6R', cost: null, costText: 'Rating x 900¥' },
    knitWeave: { name: 'Knit Weave (Rating 1–3)', stats: { ESSENCE: 'Rating x 0.1' }, avail: '(Rating×2)R', cost: null, costText: 'Rating x 5,000¥' },
    lensMods: { name: 'Lens Mods (Rating 2)', stats: { ESSENCE: '—', CAPACITY: '[Rating]' }, avail: '—', cost: 500, costText: null },
    gripStud: { name: 'Grip Stud', stats: { ESSENCE: '—', CAPACITY: '[1]' }, avail: '+2', cost: 800, costText: null },
    wristGun: { name: 'Wrist Gun', stats: { ESSENCE: '0.3' }, avail: '8F', cost: null, costText: 'Gun + 3,000¥' },
    steadyGland: { name: 'Steady Gland', stats: { ESSENCE: '0.25' }, avail: '4', cost: 12000, costText: null },
  };

  it('reads a plain row: price, Essence and Availability as numbers, nothing needing a rating', () => {
    expect(catalogueWareFigures(rows.skullCase)).toEqual({
      cost: 4000,
      essence: 0.2,
      avail: { value: 12, legality: 'F', status: 'ok', printed: '12F' },
      capacity: null,
      rating: null,
      maxRating: null,
      needsRating: false,
    });
  });

  it('evaluates Rating formulas at the rating, and says when a rating is needed', () => {
    expect(catalogueWareFigures(rows.knitWeave)).toMatchObject({
      cost: null,
      essence: null,
      avail: { value: null, status: 'needsRating' },
      maxRating: 3,
      needsRating: true,
    });
    expect(catalogueWareFigures(rows.knitWeave, { rating: 2 })).toMatchObject({
      cost: 10000,
      essence: 0.2,
      avail: { value: 4, legality: 'R', status: 'ok', printed: '(Rating×2)R' },
      rating: 2,
      maxRating: 3,
      needsRating: false,
    });
    expect(catalogueWareFigures(rows.hookClaw, { rating: 3 })).toMatchObject({ cost: 2700, essence: 0, capacity: 2, avail: { value: 18 } });
  });

  it('takes a rating printed in the name, reads capacity in brackets, and leaves an item-relative price unread', () => {
    expect(catalogueWareFigures(rows.lensMods)).toMatchObject({ rating: 2, capacity: 2, cost: 500, avail: { status: 'none' } });
    expect(catalogueWareFigures(rows.gripStud)).toMatchObject({ capacity: 1, avail: { value: null, status: 'relative' } });
    expect(catalogueWareFigures(rows.wristGun)).toMatchObject({ cost: null, essence: 0.3, needsRating: false });
  });

  it('applies a grade\'s cost, Essence and Availability multipliers only when one is asked for', () => {
    expect(catalogueWareFigures(rows.steadyGland, { grade: 'standard' })).toMatchObject({ cost: 12000, essence: 0.25, avail: { value: 4 } });
    expect(catalogueWareFigures(rows.steadyGland, { grade: 'alphaware' })).toMatchObject({ cost: 14400, essence: 0.2, avail: { value: 6 } });
    expect(catalogueWareFigures(rows.steadyGland, { grade: 'used' })).toMatchObject({ cost: 9000, essence: 0.3125, avail: { value: 0 } });
    expect(catalogueWareFigures(rows.knitWeave, { rating: 3, grade: 'deltaware' })).toMatchObject({
      cost: Math.round(15000 * IMPLANT_GRADES.deltaware.cost),
      essence: 0.15,
      avail: { value: 6 + IMPLANT_GRADES.deltaware.availability },
    });
  });

  it('agrees with the budget: standard figures on a purchase, graded by the engine, equal the graded figures', () => {
    const standard = catalogueWareFigures(rows.steadyGland);
    for (const grade of ['standard', 'alphaware', 'used'] as const) {
      const purchase = BuildPurchaseSchema.parse({
        list: 'augments',
        kind: 'augmentation',
        name: rows.steadyGland.name,
        cost: standard.cost,
        essence: standard.essence,
        avail: standard.avail.printed,
        grade,
        item: { name: rows.steadyGland.name, essence: standard.essence },
      });
      const graded = catalogueWareFigures(rows.steadyGland, { grade });
      expect([purchaseCost(purchase), purchaseEssence(purchase), purchaseAvailability(purchase).value], grade).toEqual([
        graded.cost,
        graded.essence,
        graded.avail.value,
      ]);
    }
  });
});
