/**
 * What the picker says about a row before it is picked (`catalogue.ts`), on
 * invented rows (§14). Pinned: a price in the currency the row is bought with
 * (nuyen at the rating and grade, a quality's Karma in each shape, a power's
 * points, none for a spell); Availability read at the rating and grade, or
 * the printed code with why it cannot be read yet; the caps a row is over,
 * each sentence with its number and the validator's page — Availability
 * pushed over by alphaware too, and a device's rating — and none for a row
 * within them; which rows ask for a rating; and browse pages laid end to end.
 */
import { describe, expect, it } from 'vitest';
import { ChargenSettingsSchema } from '@safehouse/contracts';
import { issueRule } from '@safehouse/rules';
import type { CataloguePage } from '../../sheet/catalogue/api.js';
import { catalogueHit } from '../testing.js';
import { hitAvailability, hitCapRefusals, hitPrice, hitRatingRange, mergeCataloguePages, nextPageOffset, readCataloguePage } from './catalogue.js';

const CAPS = ChargenSettingsSchema.parse({});

const skullDeck = catalogueHit({ id: 'h-1', kind: 'augmentation', name: 'Skull Deck', stats: { ESSENCE: '0.2' }, avail: '12F', cost: 4000 });
const hookClaw = catalogueHit({ id: 'h-2', kind: 'augmentation', name: 'Hook Claw', stats: { ESSENCE: '—', CAPACITY: '[2]' }, avail: 'Rating x 6R', costText: 'Rating x 900¥' });
const bigRelay = catalogueHit({ id: 'h-3', kind: 'electronics', category: 'COMMLINKS', name: 'Big Relay', stats: { 'DEVICE RATING': '8' }, avail: '10', cost: 9000 });

describe('hitPrice', () => {
  it('prices a row in nuyen at its rating and grade, or shows the formula until a rating is chosen', () => {
    expect(hitPrice(skullDeck)).toBe('4,000¥');
    expect(hitPrice(skullDeck, { grade: 'alphaware' })).toBe('4,800¥');
    expect(hitPrice(hookClaw)).toBe('Rating x 900¥');
    expect(hitPrice(hookClaw, { rating: 2 })).toBe('1,800¥');
    expect(hitPrice(catalogueHit({ kind: 'gear', name: 'Mystery Box' }))).toBe('no price printed');
  });

  it("prices a quality in Karma in each printed shape, a power in points, and a spell not at all", () => {
    const q = (stats: Record<string, string>) => hitPrice(catalogueHit({ kind: 'quality', stats }));
    expect(q({ KARMA: '12', TYPE: 'positive' })).toBe('12 Karma');
    expect(q({ KARMA: '4', PER: 'rating', MAX: '3' })).toBe('4 Karma per rating, up to 3');
    expect(q({ KARMA: '2', PER: 'rating' })).toBe('2 Karma per rating');
    expect(q({ KARMA: '4-20' })).toBe('4–20 Karma');
    expect(q({ KARMA: '7 or 14' })).toBe('7 or 14 Karma');
    expect(q({ KARMA: '3, 6, OR 9' })).toBe('3, 6 or 9 Karma');
    expect(q({})).toBe('Karma not printed');
    expect(hitPrice(catalogueHit({ kind: 'power', stats: { COST: '0.25 PP per level' } }))).toBe('0.25 PP per level');
    expect(hitPrice(catalogueHit({ kind: 'spell' }))).toBeNull();
  });
});

describe('hitAvailability', () => {
  it('reads Availability at the rating and grade, and says why a code cannot be read yet', () => {
    expect(hitAvailability(skullDeck)).toBe('Availability 12F');
    expect(hitAvailability(skullDeck, { grade: 'alphaware' })).toBe('Availability 14F');
    expect(hitAvailability(hookClaw)).toBe('Availability Rating x 6R, depends on the rating');
    expect(hitAvailability(hookClaw, { rating: 1 })).toBe('Availability 6R');
    expect(hitAvailability(catalogueHit({ avail: '+2' }))).toBe('Availability +2, added to what it mounts on');
    expect(hitAvailability(catalogueHit({ avail: '—' }))).toBeNull();
    expect(hitAvailability(catalogueHit({ kind: 'quality', avail: '12' }))).toBeNull();
  });
});

describe('hitCapRefusals', () => {
  it('names each cap a row is over with its number and the page the validator cites', () => {
    expect(hitCapRefusals(skullDeck, CAPS)).toEqual([]);
    expect(hitCapRefusals(skullDeck, CAPS, { grade: 'alphaware' })).toEqual([
      { reason: "Availability 14 is over this campaign's cap of 12.", ref: issueRule('availability-over')!.ref },
    ]);
    expect(hitCapRefusals(hookClaw, CAPS, { rating: 3 })).toEqual([
      { reason: "Availability 18 is over this campaign's cap of 12.", ref: issueRule('availability-over')!.ref },
    ]);
    expect(hitCapRefusals(bigRelay, CAPS)).toEqual([
      { reason: "Device rating 8 is over this campaign's cap of 6.", ref: issueRule('device-rating-over')!.ref },
    ]);
    // A street campaign's caps are lower; a quality has none.
    expect(hitCapRefusals(catalogueHit({ avail: '11' }), { maxAvailability: 10, maxDeviceRating: 4 })).toHaveLength(1);
    expect(hitCapRefusals(catalogueHit({ kind: 'quality', avail: '20' }), CAPS)).toEqual([]);
  });
});

describe('hitRatingRange', () => {
  it('asks for a rating where the row is priced or read by one, up to the printed maximum', () => {
    expect(hitRatingRange(catalogueHit({ kind: 'quality', stats: { KARMA: '4', PER: 'rating', MAX: '3' } }))).toEqual({ min: 1, max: 3 });
    expect(hitRatingRange(catalogueHit({ kind: 'quality', stats: { KARMA: '4' } }))).toBeNull();
    expect(hitRatingRange(catalogueHit({ kind: 'power', stats: { COST: '0.5 PP per level' } }))).toEqual({ min: 1, max: null });
    expect(hitRatingRange(catalogueHit({ kind: 'augmentation', name: 'Knit Weave (Rating 1–3)', stats: { ESSENCE: 'Rating x 0.1' } }))).toEqual({ min: 1, max: 3 });
    expect(hitRatingRange(hookClaw)).toEqual({ min: 1, max: null });
    expect(hitRatingRange(skullDeck)).toBeNull();
    expect(hitRatingRange(catalogueHit({ kind: 'augmentation', name: 'Lens Mods (Rating 2)', cost: 500 }))).toBeNull();
    expect(hitRatingRange(catalogueHit({ kind: 'spell' }))).toBeNull();
  });
});

describe('browse pages', () => {
  const page = (offset: number, ids: string[], total: number, hasMore: boolean): CataloguePage => ({
    query: '',
    hits: ids.map((id) => catalogueHit({ id, name: id })),
    total,
    offset,
    limit: 2,
    hasMore,
  });

  it('pages on from where the last page ended, and stops at the end', () => {
    expect(nextPageOffset(page(0, ['a', 'b'], 5, true))).toBe(2);
    expect(nextPageOffset(page(4, ['e'], 5, false))).toBeUndefined();
    expect(nextPageOffset(page(2, [], 5, true))).toBeUndefined();
  });

  it('lays pages end to end, each row once, with the latest total', () => {
    const merged = mergeCataloguePages([page(0, ['a', 'b'], 5, true), page(2, ['b', 'c'], 6, true)]);
    expect(merged.hits.map((h) => h.id)).toEqual(['a', 'b', 'c']);
    expect(merged).toMatchObject({ total: 6, hasMore: true });
    expect(mergeCataloguePages([])).toEqual({ hits: [], total: null, hasMore: false });
  });

  it('reads an older server\'s page, which sends no total or paging', () => {
    expect(readCataloguePage({ hits: [catalogueHit()] }, 0)).toMatchObject({ total: 1, offset: 0, hasMore: false });
    expect(readCataloguePage(null, 25)).toMatchObject({ hits: [], total: 0, offset: 25 });
  });
});
