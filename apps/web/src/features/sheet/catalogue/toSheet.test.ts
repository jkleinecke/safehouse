/**
 * A catalogue row → a sheet item: the book's columns land in the sheet's
 * typed fields, and the page rides along as the ref. Every row here is
 * invented (§14).
 */
import { describe, expect, it } from 'vitest';
import { SheetV1Schema, type SheetV1 } from '@safehouse/contracts';
import { customHit, listFor, rangeCatFor, skillFor, statsLine, toSheetItem, withCatalogueItem, withoutItem, type CatalogueHit } from './toSheet.js';

const hit = (over: Partial<CatalogueHit>): CatalogueHit => ({
  id: 'i1',
  bookId: 'b1',
  bookCode: 'SR5',
  printedPage: 426,
  kind: 'gear',
  category: '',
  name: 'Thing',
  stats: {},
  avail: null,
  cost: null,
  costText: null,
  title: 'Core',
  pdfPage: 431,
  ref: { book: 'SR5', page: 426 },
  readUrl: '/read/SR5?p=426',
  ...over,
});

const blank = (): SheetV1 =>
  SheetV1Schema.parse({
    v: 1,
    identity: { alias: 'Kestrel Vane', metatype: 'human' },
    attributes: { bod: 4, agi: 5, rea: 4, str: 3, wil: 5, log: 3, int: 4, cha: 4, edg: { max: 4, current: 2 }, ess: 6, mag: 0, res: 0 },
    skills: [],
  });

describe('toSheetItem', () => {
  it('a weapon: acc, dv, ap, modes, ammo and recoil become the sheet\'s fields', () => {
    const { list, item } = toSheetItem(
      hit({
        kind: 'weapon',
        category: 'HEAVY PISTOLS',
        name: 'Zap Gun',
        stats: { ACC: '5 (7)', DAMAGE: '8P', AP: '–1', MODE: 'SA / BF', RC: '(1)', AMMO: '15 (c)' },
        avail: '5R',
        cost: 725,
      }),
    );
    expect(list).toBe('weapons');
    expect(item).toEqual({
      name: 'Zap Gun',
      skillId: 'pistols',
      acc: 5,
      dv: '8P',
      ap: -1,
      modes: ['SA', 'BF'],
      rangeCat: 'heavy_pistol',
      ammo: { cap: 15, current: 15 },
      recoilComp: 1,
      ref: { book: 'SR5', page: 426 },
      note: 'heavy pistols · avail 5R · 725¥',
    });
  });
  it('a melee weapon has no range table and reads its reach into the note', () => {
    const { item } = toSheetItem(hit({ kind: 'weapon', category: 'BLADES', name: 'Long Knife', stats: { ACC: '6', REACH: '1', DV: '(STR + 2)P', AP: '–2' }, avail: '4R', cost: 350 }));
    expect(item).toMatchObject({ skillId: 'blades', acc: 6, dv: '(STR+2)P', ap: -2, modes: [], note: 'blades · reach 1 · avail 4R · 350¥' });
    expect((item as { rangeCat?: string }).rangeCat).toBeUndefined();
  });
  it('armor, ware, spells, powers, complex forms, qualities and gear', () => {
    expect(toSheetItem(hit({ kind: 'armor', category: 'ARMOR', name: 'Crate Coat', stats: { 'ARMOR RATING': '9' }, avail: '2', cost: 900 }))).toEqual({
      list: 'armor',
      item: { name: 'Crate Coat', rating: 9, worn: false, ref: { book: 'SR5', page: 426 }, note: 'avail 2 · 900¥' },
    });
    expect(toSheetItem(hit({ kind: 'augmentation', name: 'Spare Kidney', stats: { ESSENCE: '0.2', CAPACITY: '[1]' }, avail: '8', cost: 8000 })).item).toEqual({
      name: 'Spare Kidney',
      essence: 0.2,
      mods: [],
      ref: { book: 'SR5', page: 426 },
      note: 'capacity [1] · avail 8 · 8,000¥',
    });
    expect(toSheetItem(hit({ kind: 'spell', category: 'COMBAT SPELLS', name: 'Stone Fist', stats: { TYPE: 'P', RANGE: 'LOS', DAMAGE: 'S', DURATION: 'I', DRAIN: 'F – 3' } })).item).toEqual({
      name: 'Stone Fist',
      category: 'combat',
      drain: 'F-3',
      ref: { book: 'SR5', page: 426 },
      note: 'type P · range LOS · damage S · duration I',
    });
    expect(toSheetItem(hit({ kind: 'power', name: 'Quick Hands', stats: { COST: '0.5 PP per level', ACTIVATION: 'Free Action' } })).item).toEqual({
      name: 'Quick Hands',
      mods: [],
      cost: 0.5,
      ref: { book: 'SR5', page: 426 },
      note: '0.5 PP per level · activation Free Action',
    });
    expect(toSheetItem(hit({ kind: 'complex_form', name: 'Static Veil', stats: { TARGET: 'Device', DURATION: 'S', FV: 'L + 1' } })).item).toEqual({
      name: 'Static Veil',
      target: 'Device',
      fading: 'L+1',
      ref: { book: 'SR5', page: 426 },
      note: 'duration S',
    });
    expect(toSheetItem(hit({ kind: 'quality', name: 'Lucky Streak', stats: { KARMA: '12', TYPE: 'positive' } })).item).toEqual({
      name: 'Lucky Streak',
      mods: [],
      ref: { book: 'SR5', page: 426 },
      note: '12 karma · positive',
    });
    expect(toSheetItem(hit({ kind: 'electronics', category: 'COMMLINKS', name: 'Pocket Link', stats: { 'DEVICE RATING': '3' }, avail: '6', cost: 1000 }))).toEqual({
      list: 'gear',
      item: { name: 'Pocket Link', qty: 1, ref: { book: 'SR5', page: 426 }, note: 'commlinks · device rating 3 · avail 6 · 1,000¥' },
    });
    expect(toSheetItem(hit({ kind: 'gear', category: 'TOOLS', name: 'Damping Kit', stats: { RATING: '4' }, avail: '10R', costText: 'Rating x 500¥' })).item).toMatchObject({ qty: 1, rating: 4 });
  });
  it('every item it makes satisfies the sheet contract', () => {
    const rows: CatalogueHit[] = [
      hit({ kind: 'weapon', category: 'SUBMACHINE GUNS', name: 'Buzz', stats: { ACC: '4', DAMAGE: '7P', AP: '—', MODE: 'SA / BF / FA', RC: '(1)', AMMO: '30 (c)' } }),
      hit({ kind: 'armor', name: 'Vest', stats: { ARMOR: '6' } }),
      hit({ kind: 'augmentation', name: 'Eyes', stats: { ESSENCE: '0.1 x Rating' } }),
      hit({ kind: 'spell', name: 'Fog', stats: { DRAIN: 'F' } }),
      hit({ kind: 'vehicle', category: 'BIKES', name: 'Scoot', stats: { HANDL: '4/3', SPEED: '5' } }),
    ];
    let sheet = blank();
    for (const r of rows) sheet = withCatalogueItem(sheet, r).sheet;
    expect(() => SheetV1Schema.parse(sheet)).not.toThrow();
    expect(sheet.weapons[0]).toMatchObject({ skillId: 'automatics', ap: 0, modes: ['SA', 'BF', 'FA'], rangeCat: 'smg' });
    expect(sheet.augments[0]).toMatchObject({ essence: 0.1 });
    expect(sheet.gear[0]).toMatchObject({ name: 'Scoot', note: 'bikes · handl 4/3 · speed 5' });
  });
});

describe('customHit — an item in the player\'s own words', () => {
  it('lands through the same mapping, with no ref unless a page was given', () => {
    const noPage = customHit({ kind: 'weapon', name: ' Slugthrower ', category: 'heavy pistols', stats: { ACC: '4', DAMAGE: '7P', AP: '', MODE: 'SA', AMMO: '6 (cy)' }, cost: 300, avail: '4R' });
    expect(noPage).toMatchObject({ id: 'custom', bookCode: '', printedPage: 0, name: 'Slugthrower', category: 'HEAVY PISTOLS', stats: { ACC: '4', DAMAGE: '7P', MODE: 'SA', AMMO: '6 (cy)' }, cost: 300, avail: '4R' });
    const { list, item } = toSheetItem(noPage);
    expect(list).toBe('weapons');
    expect(item).toEqual({ name: 'Slugthrower', skillId: 'pistols', acc: 4, dv: '7P', ap: 0, modes: ['SA'], rangeCat: 'heavy_pistol', ammo: { cap: 6, current: 6 }, note: 'heavy pistols · avail 4R · 300¥' });
    expect('ref' in item).toBe(false);

    const withPage = customHit({ kind: 'gear', name: 'Lockpick set', stats: { RATING: '4' }, ref: { book: 'sr5', page: 449 } });
    expect(toSheetItem(withPage).item).toMatchObject({ name: 'Lockpick set', qty: 1, rating: 4, ref: { book: 'SR5', page: 449 } });
    expect(customHit({ kind: 'gear', name: 'x', stats: {}, cost: 0, ref: { book: '', page: 0 } })).toMatchObject({ cost: null, bookCode: '' });
  });
});

describe('withCatalogueItem / withoutItem', () => {
  it('adds once, counts gear up, refuses a second copy of anything else', () => {
    const gear = hit({ kind: 'gear', name: 'Rope' });
    let s = withCatalogueItem(blank(), gear);
    expect(s).toMatchObject({ added: true, list: 'gear' });
    s = withCatalogueItem(s.sheet, gear);
    expect(s.sheet.gear).toEqual([expect.objectContaining({ name: 'Rope', qty: 2 })]);
    const spell = hit({ kind: 'spell', name: 'Fog', stats: { DRAIN: 'F' } });
    const once = withCatalogueItem(s.sheet, spell);
    const twice = withCatalogueItem(once.sheet, spell);
    expect(twice.added).toBe(false);
    expect(twice.sheet.spells).toHaveLength(1);
    expect(withoutItem(twice.sheet, 'spells', 'Fog').spells).toEqual([]);
    expect(withoutItem(twice.sheet, 'gear', 'Rope').gear).toEqual([]);
  });
});

describe('the small helpers', () => {
  it('listFor', () => {
    expect(['weapon', 'armor', 'augmentation', 'spell', 'power', 'complex_form', 'quality', 'ammo', 'vehicle'].map(listFor)).toEqual(['weapons', 'armor', 'augments', 'spells', 'powers', 'complexForms', 'qualities', 'gear', 'gear']);
  });
  it('skillFor and rangeCatFor read the table heading', () => {
    expect(skillFor('LIGHT PISTOLS', { MODE: 'SA' })).toBe('pistols');
    expect(skillFor('MACHINE PISTOLS', { MODE: 'SA' })).toBe('automatics');
    expect(skillFor('ASSAULT RIFLES', {})).toBe('automatics');
    expect(skillFor('SNIPER RIFLES', {})).toBe('longarms');
    expect(skillFor('LIGHT MACHINE GUNS', {})).toBe('heavy-weapons');
    expect(skillFor('CLUBS', {})).toBe('clubs');
    expect(skillFor('BOWS', {})).toBe('archery');
    expect(skillFor('THROWING WEAPONS', {})).toBe('throwing-weapons');
    expect(skillFor('ODDITIES', { MODE: 'SS' })).toBe('exotic-ranged');
    expect(skillFor('ODDITIES', {})).toBe('exotic-melee');
    expect(rangeCatFor('HOLD-OUTS', { MODE: 'SS' })).toBe('holdout');
    expect(rangeCatFor('SNIPER RIFLES', { MODE: 'SA' })).toBe('marksman');
    expect(rangeCatFor('ASSAULT RIFLES', { MODE: 'SA' })).toBe('carbine');
    expect(rangeCatFor('LASER WEAPONS', { MODE: 'SA' })).toBe('laser_weapon');
    expect(rangeCatFor('BLADES', {})).toBeUndefined();
  });
  it('statsLine reads as one line', () => {
    expect(statsLine({ stats: { ACC: '5', RC: '—' }, avail: '5R', cost: 725, costText: null })).toBe('acc 5 · avail 5R · 725¥');
    expect(statsLine({ stats: {}, avail: null, cost: null, costText: 'Rating x 500¥' })).toBe('Rating x 500¥');
  });
});
