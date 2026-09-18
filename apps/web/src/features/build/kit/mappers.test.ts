/**
 * A picked catalogue row as a build line (`mappers.ts`). Every row is
 * invented (§14). Pinned: a purchase records the list price, Essence and
 * printed Availability at the rating and *standard* grade — the budget
 * applies the grade — with the device rating a commlink table prints in its
 * own column and a sheet item whose Essence is the rating's, not the formula's
 * first number; a quality records its type, and its Karma flat, per rating at
 * the rating, or chosen inside a band; a pick keeps the category the engine's
 * caps read; a power costs its points at the level count. Each result parses
 * with the contract and prices the same through the engine.
 */
import { describe, expect, it } from 'vitest';
import { BuildPurchaseSchema, type CharacterBuild } from '@safehouse/contracts';
import { compileBuild, formulaGroup, purchaseAvailability, purchaseCost, purchaseEssence } from '@safehouse/rules';
import { SETTINGS, catalogueHit, conceptBuild } from '../testing.js';
import { hitQualityType, hitToPick, hitToPower, hitToPurchase, hitToQuality, purchaseListFor } from './mappers.js';

const knitWeave = catalogueHit({
  id: 'ware-1',
  kind: 'augmentation',
  category: 'BASIC BIOWARE',
  name: 'Knit Weave (Rating 1–3)',
  stats: { ESSENCE: 'Rating x 0.1' },
  avail: '(Rating×2)R',
  costText: 'Rating x 5,000¥',
});

describe('hitToPurchase', () => {
  it("records a 'ware row at its rating, standard figures, with the grade for the budget to apply", () => {
    const line = hitToPurchase(knitWeave, { rating: 2, grade: 'alphaware' });
    expect(line).toMatchObject({
      list: 'augments',
      kind: 'augmentation',
      name: 'Knit Weave (Rating 1–3)',
      catalogueId: 'ware-1',
      category: 'BASIC BIOWARE',
      ref: { book: 'SR5', page: 400 },
      qty: 1,
      rating: 2,
      grade: 'alphaware',
      cost: 10000,
      essence: 0.2,
      avail: '(Rating×2)R',
    });
    // The sheet item's Essence is the rating's, where the formula's first number would read 0.1.
    expect(line.item).toMatchObject({ name: 'Knit Weave (Rating 1–3)', essence: 0.2 });
    // The engine applies alphaware on top: ×1.2 cost, ×0.8 Essence, +2 Availability.
    expect(purchaseCost(line)).toBe(12000);
    expect(purchaseEssence(line)).toBe(0.16);
    expect(purchaseAvailability(line).value).toBe(6);
    expect(hitToPurchase(knitWeave, { rating: 1 }).grade).toBe('standard');
  });

  it('records gear with its quantity, a printed rating, a device rating and a typed-over price', () => {
    const link = catalogueHit({
      id: 'e-1',
      kind: 'electronics',
      category: 'COMMLINKS',
      name: 'Pocket Relay',
      stats: { 'DEVICE RATING': '3' },
      avail: '6',
      cost: 1200,
    });
    const line = hitToPurchase(link, { qty: 2 });
    expect(line).toMatchObject({ list: 'gear', kind: 'electronics', qty: 2, deviceRating: 3, cost: 1200, grade: null, essence: 0, rating: null });
    expect(purchaseCost(line)).toBe(2400);
    expect(hitToPurchase(link, { cost: 900 }).cost).toBe(900);
    const kit = catalogueHit({ kind: 'gear', name: 'Quiet Kit', stats: { RATING: '4' }, cost: 400 });
    expect(hitToPurchase(kit)).toMatchObject({ rating: 4, item: { rating: 4 } });
    expect(hitToPurchase(kit, { rating: 2 })).toMatchObject({ rating: 2, item: { rating: 2 } });
  });

  it('maps weapons and armor onto their lists, and can buy a row onto gear instead', () => {
    const gun = catalogueHit({ kind: 'weapon', category: 'HEAVY PISTOLS', name: 'Spark Pistol', stats: { ACC: '5', DAMAGE: '8P', AP: '-1', MODE: 'SA' }, avail: '5R', cost: 700 });
    expect(hitToPurchase(gun)).toMatchObject({ list: 'weapons', item: { name: 'Spark Pistol', skillId: 'pistols', acc: 5 } });
    expect(purchaseListFor('armor')).toBe('armor');
    expect(purchaseListFor('spell')).toBe('gear');
    const formula = catalogueHit({ kind: 'spell', category: 'COMBAT SPELLS', name: 'Static Lash', cost: 500 });
    expect(hitToPurchase(formula, { list: 'gear' })).toMatchObject({ list: 'gear', kind: 'spell', item: { name: 'Static Lash', qty: 1 } });
  });

  it('leaves out the catalogue id and page of a hand-written row, and parses with the contract', () => {
    const custom = catalogueHit({ id: 'custom', bookCode: '', printedPage: 0, name: 'Grandfather Knife', kind: 'gear', cost: 50 });
    const line = hitToPurchase(custom);
    expect(line).not.toHaveProperty('catalogueId');
    expect(line).not.toHaveProperty('ref');
    expect(BuildPurchaseSchema.parse(line)).toEqual(line);
  });
});

describe('hitToQuality', () => {
  it('prices a flat quality, a rated one at its rating, and a band at the chosen Karma', () => {
    const flat = catalogueHit({ id: 'q-1', kind: 'quality', category: 'POSITIVE QUALITIES', name: 'Steady Hands', stats: { KARMA: '12', TYPE: 'positive' } });
    expect(hitToQuality(flat)).toEqual({
      name: 'Steady Hands',
      ref: { book: 'SR5', page: 400 },
      catalogueId: 'q-1',
      type: 'positive',
      karma: 12,
      rating: null,
      mods: [],
    });
    const rated = catalogueHit({ kind: 'quality', name: 'Iron Calm', stats: { KARMA: '4', PER: 'rating', MAX: '3', TYPE: 'positive' } });
    expect(hitToQuality(rated, { rating: 3 })).toMatchObject({ type: 'positive', karma: 12, rating: 3 });
    expect(hitToQuality(rated)).toMatchObject({ karma: 4, rating: 1 });
    const band = catalogueHit({ kind: 'quality', name: 'Bad Nerves', stats: { KARMA: '4-20', TYPE: 'negative' } });
    expect(hitToQuality(band, { karma: 10 })).toMatchObject({ type: 'negative', karma: 10, rating: null });
    expect(hitToQuality(band)).toMatchObject({ karma: 4 });
  });

  it("takes the book's type over the player's, and the player's for a row that prints none", () => {
    const printed = catalogueHit({ kind: 'quality', name: 'Bad Nerves', stats: { KARMA: '6', TYPE: 'negative' } });
    expect(hitToQuality(printed, { type: 'positive' }).type).toBe('negative');
    const handWritten = catalogueHit({ id: 'custom', kind: 'quality', name: 'Old Debt', stats: {} });
    expect(hitToQuality(handWritten, { type: 'negative', karma: 5 })).toMatchObject({ type: 'negative', karma: 5 });
  });

  it('reads a row’s side the one way every caller agrees on: its column, the whitelist, then its table heading', () => {
    const headed = catalogueHit({ kind: 'quality', category: 'NEGATIVE QUALITIES', name: 'Odd Habit', stats: { KARMA: '6' } });
    expect(hitQualityType(headed)).toBe('negative');
    // Without a type answer from the player, the heading is what the line records.
    expect(hitToQuality(headed).type).toBe('negative');
    expect(hitToQuality(headed, { type: 'positive' }).type).toBe('positive');
    expect(hitQualityType(catalogueHit({ kind: 'quality', category: 'POSITIVE QUALITIES', name: 'Keen Ear', stats: { KARMA: '3' } }))).toBe('positive');
    // The whitelist knows Lucky is positive, whatever table it sat under.
    expect(hitQualityType(catalogueHit({ kind: 'quality', category: 'QUALITIES', name: 'Lucky', stats: { KARMA: '12' } }))).toBe('positive');
    expect(hitQualityType(catalogueHit({ kind: 'quality', category: 'POSITIVE QUALITIES', name: 'Bad Nerves', stats: { KARMA: '6', TYPE: 'negative' } }))).toBe('negative');
    expect(hitQualityType(catalogueHit({ id: 'custom', kind: 'quality', category: '', name: 'Old Debt', stats: {} }))).toBeNull();
  });
});

describe('hitToPick and hitToPower', () => {
  it('keeps the category that tells the engine a ritual or a preparation from a spell', () => {
    const ritual = hitToPick(catalogueHit({ id: 's-9', kind: 'spell', category: 'RITUALS', name: 'Quiet Ward' }));
    expect(ritual).toEqual({ name: 'Quiet Ward', ref: { book: 'SR5', page: 400 }, catalogueId: 's-9', category: 'rituals' });
    expect(formulaGroup(ritual)).toBe('rituals');
    expect(formulaGroup(hitToPick(catalogueHit({ kind: 'spell', category: 'ALCHEMICAL PREPARATIONS', name: 'Slow Draught' })))).toBe('preparations');
    expect(formulaGroup(hitToPick(catalogueHit({ kind: 'spell', category: 'COMBAT SPELLS', name: 'Static Lash' })))).toBe('spells');
    expect(hitToPick(catalogueHit({ kind: 'complex_form', category: '', name: 'Soft Echo' }))).not.toHaveProperty('category');
  });

  it('keeps a spell’s drain code and printed line, as the sheet writes them, all the way onto the approved sheet (FR8.1)', () => {
    // The shape the seeder reads out of a COMBAT SPELLS table (invented row).
    const row = catalogueHit({
      id: 's-2',
      kind: 'spell',
      category: 'COMBAT SPELLS',
      name: 'Static Lash',
      stats: { TYPE: 'P', RANGE: 'LOS', DAMAGE: 'S', DURATION: 'I', DRAIN: 'F – 3' },
    });
    const pick = hitToPick(row);
    expect(pick).toEqual({
      name: 'Static Lash',
      ref: { book: 'SR5', page: 400 },
      catalogueId: 's-2',
      category: 'combat',
      drain: 'F-3',
      note: 'type P · range LOS · damage S · duration I',
    });
    expect(formulaGroup(pick)).toBe('spells');
    // Granted in step 4 and bought in step 8 alike, the approved sheet rolls drain off the code.
    const mage = conceptBuild('street-mage');
    const built: CharacterBuild = {
      ...mage,
      grants: { ...mage.grants, spells: [pick] },
      karma: { ...mage.karma, spends: [...mage.karma.spends, { kind: 'spell', ...hitToPick({ ...row, id: 's-3', name: 'Quiet Lash' }) }] },
    };
    const { sheet } = compileBuild(built, SETTINGS);
    expect(sheet.spells.find((s) => s.name === 'Static Lash')).toMatchObject({ category: 'combat', drain: 'F-3' });
    expect(sheet.spells.find((s) => s.name === 'Quiet Lash')).toMatchObject({ drain: 'F-3', note: 'type P · range LOS · damage S · duration I' });
  });

  it('keeps a complex form’s target and fading, and clips a printed line to what the record holds', () => {
    const form = hitToPick(
      catalogueHit({ id: 'f-1', kind: 'complex_form', category: 'COMPLEX FORMS', name: 'Soft Echo', stats: { TARGET: 'Device', DURATION: 'S', FV: 'L + 1' } }),
    );
    expect(form).toMatchObject({ category: 'complex forms', target: 'Device', fading: 'L+1', note: 'duration S' });
    const wordy = hitToPick(catalogueHit({ kind: 'spell', category: 'HEALTH SPELLS', name: 'Long Mend', stats: { TYPE: 'M', RANGE: 'x'.repeat(260) } }));
    expect(wordy.note).toHaveLength(200);
    expect(wordy).not.toHaveProperty('drain');
  });

  it('costs a power at its level count, and a flat power once', () => {
    const quick = catalogueHit({ id: 'p-1', kind: 'power', category: 'ADEPT POWERS', name: 'Quick Step', stats: { COST: '0.25 PP per level' } });
    expect(hitToPower(quick, 3)).toEqual({ name: 'Quick Step', ref: { book: 'SR5', page: 400 }, catalogueId: 'p-1', cost: 0.75, levels: 3, mods: [] });
    const sense = catalogueHit({ kind: 'power', name: 'Keen Nose', stats: { COST: '0.5 PP' } });
    expect(hitToPower(sense)).toMatchObject({ cost: 0.5, levels: 1 });
    expect(hitToPower(sense, 1, 'perception')).toMatchObject({ target: 'perception' });
  });
});
