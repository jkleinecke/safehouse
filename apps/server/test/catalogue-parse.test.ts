/**
 * The catalogue parser (services/catalogue.ts) against the SHAPES the books
 * print — every name and number here is invented (§14: no book content in
 * code or fixtures); what is real is the layout pdf.js hands back.
 */
import { describe, expect, it } from 'vitest';
import { BuildPurchaseSchema, BuildQualitySchema } from '@safehouse/contracts';
import { parseAvailability, purchaseAvailability, purchaseCost, purchaseEssence } from '@safehouse/rules';
import {
  essenceCell,
  isHeading,
  parseHeader,
  parsePageItems,
  parseRow,
  parseStatBlock,
  qualityPrice,
  splitCells,
  titleCase,
  wareFigures,
} from '../src/services/catalogue.js';

describe('parseHeader', () => {
  it('reads a weapon table header: heading, columns, kind', () => {
    const h = parseHeader('HEAVY PISTOLS ACC DAMAGE AP MODE RC AMMO AVAIL COST');
    expect(h).toEqual({ category: 'HEAVY PISTOLS', kind: 'weapon', stats: ['ACC', 'DAMAGE', 'AP', 'MODE', 'RC', 'AMMO'], hasPageColumn: false });
  });
  it('knows the other shapes', () => {
    expect(parseHeader('ARMOR ARMOR RATING AVAIL COST')).toMatchObject({ category: 'ARMOR', kind: 'armor', stats: ['ARMOR RATING'] });
    expect(parseHeader('CYBEREYES ESSENCE CAPACITY AVAILABILITY COST')).toMatchObject({ kind: 'augmentation', stats: ['ESSENCE', 'CAPACITY'] });
    expect(parseHeader('BIKES HANDL SPEED ACCEL BODY ARM PILOT SENS SEATS AVAIL COST')).toMatchObject({ kind: 'vehicle', stats: ['HANDL', 'SPEED', 'ACCEL', 'BODY', 'ARM', 'PILOT', 'SENS', 'SEATS'] });
    expect(parseHeader('COMMLINKS DEVICE RATING AVAIL COST')).toMatchObject({ kind: 'electronics', stats: ['DEVICE RATING'] });
    expect(parseHeader('AMMUNITION DAMAGE AP AVAIL COST')).toMatchObject({ kind: 'ammo', stats: ['DAMAGE', 'AP'] });
    expect(parseHeader('BLADES ACC REACH DV AP AVAIL COST PAGE')).toMatchObject({ kind: 'weapon', stats: ['ACC', 'REACH', 'DV', 'AP'], hasPageColumn: true });
    expect(parseHeader('ITEM AVAILABILITY COST')).toMatchObject({ kind: 'gear', stats: [] });
    expect(parseHeader('BIOWARE ESSENCE AVAIL COST REF')).toMatchObject({ kind: 'augmentation', hasPageColumn: true });
  });
  it('is not fooled by prose that mentions availability and cost', () => {
    expect(parseHeader('they have an Availability of 4F, a cost of 50 nuyen, and')).toBeNull();
    expect(parseHeader('THEY HAVE AN AVAILABILITY OF 4F, A COST OF 50 NUYEN, AN AD-')).toBeNull();
    expect(parseHeader('RATING 1, AVAILABILITY 2, COST (BODY X BODY) X 100')).toBeNull();
    expect(parseHeader('Some Pistol 5 (7) 8P –1 SA — 15 (c) 5R 725¥')).toBeNull();
  });
});

describe('splitCells', () => {
  it('keeps groups, joins slashes, attaches notes to numbers', () => {
    expect(splitCells('Some Pistol 5 (7) 8P –1 SA — 15 (c) 5R 725¥')).toEqual(['Some', 'Pistol', '5 (7)', '8P', '–1', 'SA', '—', '15 (c)', '5R', '725¥']);
    expect(splitCells('Twin Gun 5 (6) 6P / 7P 0 / –1 SA / SS — 6 (cy) 3R 300¥')).toEqual(['Twin', 'Gun', '5 (6)', '6P / 7P', '0 / –1', 'SA / SS', '—', '6 (cy)', '3R', '300¥']);
    expect(splitCells('Burst Gun 6 6P — SA / BF (1) 21 (c) 7R 210¥')).toEqual(['Burst', 'Gun', '6', '6P', '—', 'SA / BF', '(1)', '21 (c)', '7R', '210¥']);
    expect(splitCells('Big Hammer 3 1 (STR + 4)P — 1 40¥')).toEqual(['Big', 'Hammer', '3', '1', '(STR + 4)P', '—', '1', '40¥']);
    // A formula is one cell, whether it is the availability or the price.
    expect(splitCells('Hex Cuffs — — — — (Force x 6)R Force x 800¥')).toEqual(['Hex', 'Cuffs', '—', '—', '—', '—', '(Force x 6)R', 'Force x 800¥']);
    expect(splitCells('Muscle knot (Rating 1–4) Rating x 0.2 (Rating x 5)R Rating x 32,000¥')).toEqual(['Muscle', 'knot', '(Rating 1–4)', 'Rating x 0.2', '(Rating x 5)R', 'Rating x 32,000¥']);
  });
});

describe('parseRow', () => {
  const pistols = parseHeader('HEAVY PISTOLS ACC DAMAGE AP MODE RC AMMO AVAIL COST')!;
  it('reads a weapon row from the right: cost, avail, one cell per column, the rest is the name', () => {
    expect(parseRow('Some Pistol 5 (7) 8P –1 SA — 15 (c) 5R 725¥', pistols, null, 426)).toEqual({
      kind: 'weapon',
      category: 'HEAVY PISTOLS',
      name: 'Some Pistol',
      stats: { ACC: '5 (7)', DAMAGE: '8P', AP: '–1', MODE: 'SA', RC: '—', AMMO: '15 (c)' },
      avail: '5R',
      cost: 725,
      costText: null,
      printedPage: 426,
    });
    expect(parseRow('Twin Gun 5 (6) 6P / 7P 0 / –1 SA / SS — 6 (cy) 3R 300¥', pistols, null, 1)!.stats).toEqual({
      ACC: '5 (6)',
      DAMAGE: '6P / 7P',
      AP: '0 / –1',
      MODE: 'SA / SS',
      RC: '—',
      AMMO: '6 (cy)',
    });
    expect(parseRow('Burst Gun 6 6P — SA / BF (1) 21 (c) 7R 210¥', pistols, null, 1)!.stats).toMatchObject({ MODE: 'SA / BF', RC: '(1)' });
  });
  it('keeps a formula price as text and a number as a number', () => {
    const gear = parseHeader('GEAR RATING AVAIL COST')!;
    expect(parseRow('Damping Kit [Rating] 10R Rating x 500¥', gear, null, 443)).toMatchObject({ name: 'Damping Kit', stats: { RATING: '[Rating]' }, avail: '10R', cost: null, costText: 'Rating x 500¥' });
    expect(parseRow('Plain Kit 3 4 1,250¥', gear, null, 443)).toMatchObject({ name: 'Plain Kit', stats: { RATING: '3' }, avail: '4', cost: 1250, costText: null });
    const augs = parseHeader('IMPLANT WEAPONS ESSENCE AVAIL COST')!;
    expect(parseRow('Arm Gun 0.3 8F Gun + 3,000¥', augs, null, 1)).toMatchObject({ name: 'Arm Gun', avail: '8F', costText: 'Gun + 3,000¥' });
  });
  it('takes the name from the line above when the row is only numbers', () => {
    const bikes = parseHeader('BIKES HANDL SPEED ACCEL BODY ARM PILOT SENS SEATS AVAIL COST')!;
    expect(parseRow('4/3 5 2 8 8 2 3 2 — 22,000¥', bikes, 'Rustbucket Runner', 46)).toMatchObject({
      name: 'Rustbucket Runner',
      stats: { HANDL: '4/3', SPEED: '5', ACCEL: '2', BODY: '8', ARM: '8', PILOT: '2', SENS: '3', SEATS: '2' },
      avail: '—',
      cost: 22000,
    });
    // …from the heading over a one-row table when the line above is the header itself…
    expect(parseRow('4/3 5 2 8 8 2 3 2 — 22,000¥', bikes, 'BIKES HANDL SPEED ACCEL BODY ARM PILOT SENS SEATS AVAIL COST', 46, 'Rustbucket Runner')).toMatchObject({ name: 'Rustbucket Runner' });
    // …but not from a header with nothing over it, a price row, or nothing.
    expect(parseRow('4/3 5 2 8 8 2 3 2 — 22,000¥', bikes, 'BIKES HANDL SPEED ACCEL BODY ARM PILOT SENS SEATS AVAIL COST', 46)).toBeNull();
    expect(parseRow('4/3 5 2 8 8 2 3 2 — 22,000¥', bikes, 'BIKES HANDL SPEED ACCEL BODY ARM PILOT SENS SEATS AVAIL COST', 46, 'Other Bike 4/3 5 2 8 8 2 3 2 — 9,000¥')).toBeNull();
    expect(parseRow('4/3 5 2 8 8 2 3 2 — 22,000¥', bikes, null, 46)).toBeNull();
  });
  it('cites the row\'s own page when the table has a PAGE column', () => {
    const blades = parseHeader('BLADES ACC REACH DV AP AVAIL COST PAGE')!;
    expect(parseRow('Big Hammer 3 1 (STR + 4)P — 1 40¥ 22', blades, null, 8)).toMatchObject({ name: 'Big Hammer', stats: { DV: '(STR + 4)P', AP: '—' }, avail: '1', cost: 40, printedPage: 22 });
    const bio = parseHeader('BIOWARE ESSENCE AVAIL COST REF')!;
    expect(parseRow('Spare Kidney 0.2 8 8,000¥ SR5 p. 461', bio, null, 3)).toMatchObject({ name: 'Spare Kidney', cost: 8000, printedPage: 461 });
  });
  it('refuses lines that are not rows', () => {
    expect(parseRow('When you shoot a heavy pistol, you use the Pistols skill.', pistols, null, 1)).toBeNull();
    expect(parseRow('Starting Nuyen (3D6 x 60) + 2,785¥ = 3,505¥', pistols, null, 1)).toBeNull();
  });
});

describe('parseStatBlock', () => {
  it('reads a spell, a power, a quality and a complex form', () => {
    expect(parseStatBlock('STONE FIST', ['Type: P Range: LOS Damage: S', 'Duration: I Drain: F – 3'], 'COMBAT SPELLS', 284)).toEqual({
      kind: 'spell',
      category: 'COMBAT SPELLS',
      name: 'Stone Fist',
      stats: { TYPE: 'P', RANGE: 'LOS', DAMAGE: 'S', DURATION: 'I', DRAIN: 'F – 3' },
      avail: null,
      cost: null,
      costText: null,
      printedPage: 284,
    });
    expect(parseStatBlock('FOG SIGHT', ['Type: M Range: LOS (A) Duration: S', 'Drain: F + 1'], 'DETECTION SPELLS', 1)).toMatchObject({ kind: 'spell', stats: { RANGE: 'LOS (A)', DURATION: 'S', DRAIN: 'F + 1' } });
    expect(parseStatBlock('QUICK HANDS', ['Cost: 0.5 PP per level', 'Activation: Free Action'], 'ADEPT POWERS', 309)).toMatchObject({ kind: 'power', name: 'Quick Hands', stats: { COST: '0.5 PP per level', ACTIVATION: 'Free Action' } });
    expect(parseStatBlock('LUCKY STREAK', ['Cost: 12 Karma'], 'POSITIVE QUALITIES', 72)).toMatchObject({ kind: 'quality', stats: { KARMA: '12', TYPE: 'positive' } });
    expect(parseStatBlock('BAD KNEES', ['Bonus: 5 Karma'], 'NEGATIVE QUALITIES', 78)).toMatchObject({ kind: 'quality', stats: { KARMA: '5', TYPE: 'negative' } });
    expect(parseStatBlock('STATIC VEIL', ['Target: Device Duration: S FV: L + 1'], 'COMPLEX FORMS', 252)).toMatchObject({ kind: 'complex_form', stats: { TARGET: 'Device', DURATION: 'S', FV: 'L + 1' } });
  });
  it('reads labels printed in capitals', () => {
    expect(parseStatBlock('STILL WATER', ['COST: 0.25 PP PER LEVEL', 'ACTIVATION: FREE ACTION'], 'ADEPT POWERS', 170)).toMatchObject({ kind: 'power', name: 'Still Water', stats: { COST: '0.25 PP PER LEVEL', ACTIVATION: 'FREE ACTION' } });
    expect(parseStatBlock('STONE FIST', ['TYPE: P RANGE: LOS DAMAGE: S', 'DURATION: I DRAIN: F – 3'], 'COMBAT SPELLS', 284)).toMatchObject({ kind: 'spell', stats: { TYPE: 'P', RANGE: 'LOS', DAMAGE: 'S', DURATION: 'I', DRAIN: 'F – 3' } });
    expect(parseStatBlock('STATIC VEIL', ['TARGET: Device DURATION: S FV: L + 1'], 'COMPLEX FORMS', 252)).toMatchObject({ kind: 'complex_form', stats: { TARGET: 'Device', DURATION: 'S', FV: 'L + 1' } });
  });
  it('ignores headings with no stat line under them', () => {
    expect(parseStatBlock('HEAVY PISTOLS', ['Heavy pistols are powerful sidearms.'], '', 1)).toBeNull();
    expect(parseStatBlock('ARMOR', ['Advances in ballistic fabrics'], '', 1)).toBeNull();
  });
});

describe('a quality\'s price (CHARGEN.md §5 P4, §8.5)', () => {
  const quality = (line: string, heading = 'POSITIVE QUALITIES') => parseStatBlock('IRON NERVE', [line], heading, 77)?.stats ?? null;

  it('keeps a price per rating and its maximum instead of dropping them', () => {
    expect(quality('Cost: 4 Karma per rating (max rating 3)')).toEqual({ KARMA: '4', PER: 'rating', MAX: '3', TYPE: 'positive' });
    expect(quality('Bonus: 3 Karma per level (max 4)', 'NEGATIVE QUALITIES')).toEqual({ KARMA: '3', PER: 'rating', MAX: '4', TYPE: 'negative' });
    expect(quality('Cost: 5 Karma per rating (maximum rating of 6)')).toEqual({ KARMA: '5', PER: 'rating', MAX: '6', TYPE: 'positive' });
    // No maximum printed: none invented.
    expect(quality('Cost: 2 Karma per rating')).toEqual({ KARMA: '2', PER: 'rating', TYPE: 'positive' });
  });

  it('reads a band the table picks within as "A-B", however the dash was printed, and now finds "A to B" at all', () => {
    expect(quality('Bonus: 5 to 20 Karma')).toEqual({ KARMA: '5-20', TYPE: 'negative' });
    expect(quality('Bonus: 5 to 20 Karma (see the text)')).toEqual({ KARMA: '5-20', TYPE: 'negative' });
    expect(quality('Bonus: 4 – 25 Karma')).toEqual({ KARMA: '4-25', TYPE: 'negative' });
    expect(quality('Bonus: 4-25 Karma')).toEqual({ KARMA: '4-25', TYPE: 'negative' });
    expect(quality('Cost: 3 to 9 Karma')).toEqual({ KARMA: '3-9', TYPE: 'positive' });
  });

  it('leaves a flat price and a list of prices as they were, and a price with no number out', () => {
    expect(quality('Cost: 12 Karma')).toEqual({ KARMA: '12', TYPE: 'positive' });
    expect(quality('Cost: 7 or 14 Karma')).toEqual({ KARMA: '7 or 14', TYPE: 'positive' });
    expect(quality('Cost: 5, 10 or 15 Karma')).toEqual({ KARMA: '5, 10 or 15', TYPE: 'positive' });
    expect(quality('Cost: Varies')).toBeNull();
  });

  it('reads the price lines the books print in capitals, as the mixed-case ones', () => {
    // Most quality sections print their labels in capitals; before the stat
    // line was matched without regard to case, not one of these was read.
    expect(quality('COST: 12 KARMA')).toEqual({ KARMA: '12', TYPE: 'positive' });
    expect(quality('BONUS: 6 KARMA', 'NEGATIVE QUALITIES')).toEqual({ KARMA: '6', TYPE: 'negative' });
    expect(quality('BONUS: 4 TO 20 KARMA', 'NEGATIVE QUALITIES')).toEqual({ KARMA: '4-20', TYPE: 'negative' });
    expect(quality('COST: 3 KARMA PER LEVEL (MAX 4)')).toEqual({ KARMA: '3', PER: 'rating', MAX: '4', TYPE: 'positive' });
    expect(quality('COST: 5 OR 10 KARMA')).toEqual({ KARMA: '5 OR 10', TYPE: 'positive' });
    // A list with a comma before its "or" is still a list.
    expect(quality('BONUS: 3, 6, OR 9 KARMA', 'NEGATIVE QUALITIES')).toEqual({ KARMA: '3, 6, OR 9', TYPE: 'negative' });
    expect(qualityPrice({ KARMA: '3, 6, OR 9', TYPE: 'negative' })).toMatchObject({ karma: null, range: { min: 3, max: 9 } });
  });

  it('joins a price line the page broke after "per" to the line that finishes it', () => {
    const wrapped = (lines: string[]) => parseStatBlock('NIGHT OWL', lines, 'POSITIVE QUALITIES', 80)?.stats ?? null;
    expect(wrapped(['COST: 3 KARMA PER', 'RATING (MAX 3)', 'Up all night, in our words.'])).toEqual({ KARMA: '3', PER: 'rating', MAX: '3', TYPE: 'positive' });
    expect(wrapped(['COST: 2 KARMA PER', 'RATING (MAX RATING 5)'])).toEqual({ KARMA: '2', PER: 'rating', MAX: '5', TYPE: 'positive' });
    expect(wrapped(['Cost: 4 Karma per', 'level (max 2)'])).toEqual({ KARMA: '4', PER: 'rating', MAX: '2', TYPE: 'positive' });
    expect(wrapped(['COST: 6 KARMA PER RATING (MAX', 'RATING 3)'])).toEqual({ KARMA: '6', PER: 'rating', MAX: '3', TYPE: 'positive' });
    // A finished line is not joined to the prose under it, whatever the prose says.
    expect(wrapped(['COST: 2 KARMA PER RATING', 'The max 6 here is prose, not a price.'])).toEqual({ KARMA: '2', PER: 'rating', TYPE: 'positive' });
    // …and a page that ends on the dangling word keeps what it has.
    expect(wrapped(['COST: 2 KARMA PER'])).toEqual({ KARMA: '2', TYPE: 'positive' });
  });

  it('compiles a capitalised quality section from a whole page', () => {
    const page = ['POSITIVE QUALITIES', 'NIGHT OWL', 'COST: 3 KARMA PER', 'RATING (MAX 3)', 'Awake after dark, in our words.', 'NEGATIVE QUALITIES', 'GLASS JAW', 'BONUS: 4 TO 20 KARMA', 'Folds at a tap.'].join('\n');
    const { items } = parsePageItems(page, 81);
    expect(items.map((i) => [i.kind, i.name, i.category, i.stats])).toEqual([
      ['quality', 'Night Owl', 'POSITIVE QUALITIES', { KARMA: '3', PER: 'rating', MAX: '3', TYPE: 'positive' }],
      ['quality', 'Glass Jaw', 'NEGATIVE QUALITIES', { KARMA: '4-20', TYPE: 'negative' }],
    ]);
  });

  it('reads each shape back as the Karma a build records', () => {
    expect(qualityPrice({ KARMA: '12', TYPE: 'positive' })).toEqual({ type: 'positive', karma: 12, rated: null, range: null });
    expect(qualityPrice({ KARMA: '4', PER: 'rating', MAX: '3', TYPE: 'positive' }, 2)).toEqual({ type: 'positive', karma: 8, rated: { perRating: 4, maxRating: 3 }, range: null });
    expect(qualityPrice({ KARMA: '4', PER: 'rating', MAX: '3', TYPE: 'positive' })).toMatchObject({ karma: null, rated: { perRating: 4, maxRating: 3 } });
    expect(qualityPrice({ KARMA: '2', PER: 'rating', TYPE: 'negative' }, 5)).toEqual({ type: 'negative', karma: 10, rated: { perRating: 2, maxRating: null }, range: null });
    expect(qualityPrice({ KARMA: '5-20', TYPE: 'negative' })).toEqual({ type: 'negative', karma: null, rated: null, range: { min: 5, max: 20 } });
    expect(qualityPrice({ KARMA: '7 or 14', TYPE: 'positive' })).toMatchObject({ karma: null, range: { min: 7, max: 14 } });
  });

  it('round-trips a rated quality from its printed line to a build\'s quality', () => {
    const item = parsePageItems(['POSITIVE QUALITIES', 'IRON NERVE', 'Cost: 4 Karma per rating (max rating 3)', 'Nerves of iron, in our words.'].join('\n'), 77).items[0]!;
    expect(item).toMatchObject({ kind: 'quality', name: 'Iron Nerve', category: 'POSITIVE QUALITIES' });
    const price = qualityPrice(item.stats, 3);
    const built = BuildQualitySchema.parse({ name: item.name, ref: { book: 'SR5', page: item.printedPage }, type: price.type, karma: price.karma, rating: 3 });
    expect(built).toMatchObject({ name: 'Iron Nerve', type: 'positive', karma: 12, rating: 3, ref: { book: 'SR5', page: 77 } });
    // A rating over the printed maximum is priced, not clamped — the validator says it is over.
    expect(qualityPrice(item.stats, 4).karma).toBe(16);
  });
});

describe('\'ware rows: Essence and price as numbers, Availability as printed (CHARGEN.md §5 P4)', () => {
  const page = [
    'HEADWARE ESSENCE CAPACITY AVAIL COST',
    'Brain Box 0.2* — 12F 4,000¥',
    'Ear Plugs .1 [2] 6R 1,500¥',
    'Eye Mods',
    'Rating 1 — [1] — 500¥',
    'Hand Blade — [2] Rating x 6R Rating x 900¥',
    'BASIC BIOWARE ESSENCE AVAIL COST',
    'Bone knit (Rating 1–3) (Rating × 0.1) (Rating×2)R Rating x 5,000¥',
    'Stubborn Gland 0.25 4 12,000¥',
    'CYBERLIMB ACCESSORIES ESSENCE CAPACITY AVAIL COST',
    'Grip Pad — [1] +2 800¥',
    'Arm Gun 0.3 — 8F Gun + 3,000¥',
  ].join('\n');
  const items = parsePageItems(page, 452).items;
  const byName = (name: string) => items.find((i) => i.name === name)!;

  it('reads every row, with Essence in a form arithmetic reads', () => {
    expect(items.map((i) => [i.name, i.stats['ESSENCE'], i.avail, i.cost ?? i.costText])).toEqual([
      ['Brain Box', '0.2', '12F', 4000],
      ['Ear Plugs', '0.1', '6R', 1500],
      ['Eye Mods (Rating 1)', '—', '—', 500],
      ['Hand Blade', '—', 'Rating x 6R', 'Rating x 900¥'],
      ['Bone knit (Rating 1–3)', 'Rating x 0.1', '(Rating×2)R', 'Rating x 5,000¥'],
      ['Stubborn Gland', '0.25', '4', 12000],
      ['Grip Pad', '—', '+2', 800],
      ['Arm Gun', '0.3', '8F', 'Gun + 3,000¥'],
    ]);
    expect(essenceCell('0.20')).toBe('0.2');
    expect(essenceCell('(Level x .05)')).toBe('Rating x 0.05');
    expect(essenceCell('[Rating]')).toBe('[Rating]');
  });

  it('keeps every Availability form the parser emits verbatim, and the rules engine reads each one', () => {
    const forms = [...new Set(items.map((i) => i.avail))];
    expect(forms).toEqual(['12F', '6R', '—', 'Rating x 6R', '(Rating×2)R', '4', '+2', '8F']);
    // Read with the rating a purchase would record — 2 — as the builder does.
    const read = Object.fromEntries(forms.map((f) => [f, parseAvailability(f, 2)]));
    expect(read).toEqual({
      '12F': { value: 12, legality: 'F', status: 'ok' },
      '6R': { value: 6, legality: 'R', status: 'ok' },
      '—': { value: null, legality: null, status: 'none' },
      'Rating x 6R': { value: 12, legality: 'R', status: 'ok' },
      '(Rating×2)R': { value: 4, legality: 'R', status: 'ok' },
      '4': { value: 4, legality: null, status: 'ok' },
      '+2': { value: null, legality: null, status: 'relative' },
      '8F': { value: 8, legality: 'F', status: 'ok' },
    });
    // Without a rating a formula is flagged, never read as 0.
    expect(parseAvailability('(Rating×2)R', null).status).toBe('needsRating');
    // The other shapes the table reader accepts, read the same way.
    expect(parseAvailability('16+', null)).toEqual({ value: 16, legality: null, status: 'ok' });
    expect(parseAvailability('(Force x 6)R', 3)).toEqual({ value: 18, legality: 'R', status: 'ok' });
    expect(parseAvailability('(Rating x 5)R', 4)).toEqual({ value: 20, legality: 'R', status: 'ok' });
    expect(parseAvailability('+4R', null)).toEqual({ value: null, legality: 'R', status: 'relative' });
    for (const f of forms) expect(parseAvailability(f, 2).status, String(f)).not.toBe('unreadable');
  });

  it('turns a row and a rating into the standard-grade numbers a purchase records', () => {
    expect(wareFigures(byName('Brain Box'))).toEqual({ essence: 0.2, cost: 4000, avail: '12F', rating: null, maxRating: null, needsRating: false });
    expect(wareFigures(byName('Eye Mods (Rating 1)'))).toEqual({ essence: 0, cost: 500, avail: '—', rating: 1, maxRating: null, needsRating: false });
    expect(wareFigures(byName('Bone knit (Rating 1–3)'))).toEqual({ essence: null, cost: null, avail: '(Rating×2)R', rating: null, maxRating: 3, needsRating: true });
    expect(wareFigures(byName('Bone knit (Rating 1–3)'), 2)).toEqual({ essence: 0.2, cost: 10000, avail: '(Rating×2)R', rating: 2, maxRating: 3, needsRating: false });
    expect(wareFigures(byName('Hand Blade'), 3)).toMatchObject({ essence: 0, cost: 2700, avail: 'Rating x 6R', needsRating: false });
    // A price in terms of another item is not a number on its own.
    expect(wareFigures(byName('Arm Gun'))).toMatchObject({ essence: 0.3, cost: null, needsRating: false });
  });

  it('leaves the grade to the build: the engine applies alphaware and used on top of the catalogue\'s numbers', () => {
    const row = byName('Stubborn Gland');
    const figures = wareFigures(row);
    const purchase = (grade: 'standard' | 'alphaware' | 'used') =>
      BuildPurchaseSchema.parse({
        list: 'augments',
        kind: row.kind,
        category: row.category,
        name: row.name,
        cost: figures.cost,
        essence: figures.essence,
        avail: figures.avail,
        grade,
        item: { name: row.name, essence: figures.essence },
      });
    expect([purchaseCost(purchase('standard')), purchaseEssence(purchase('standard')), purchaseAvailability(purchase('standard')).value]).toEqual([12000, 0.25, 4]);
    expect([purchaseCost(purchase('alphaware')), purchaseEssence(purchase('alphaware')), purchaseAvailability(purchase('alphaware')).value]).toEqual([14400, 0.2, 6]);
    expect([purchaseCost(purchase('used')), purchaseEssence(purchase('used')), purchaseAvailability(purchase('used')).value]).toEqual([9000, 0.3125, 0]);
  });
});

describe('parsePageItems', () => {
  const page = [
    'HEAVY PISTOLS',
    'Heavy pistols are powerful sidearms. When you shoot one, you use the Pistols skill.',
    'Some Pistol: The newest iteration of a popular handgun.',
    'HEAVY PISTOLS ACC DAMAGE AP MODE RC AMMO AVAIL COST',
    'Some Pistol 5 (7) 8P –1 SA — 15 (c) 5R 725¥',
    'Burst Gun 6 6P — SA / BF (1) 21 (c) 7R 210¥',
    'Some Pistol 5 (7) 8P –1 SA — 15 (c) 5R 725¥',
    'ARMOR',
    'Modern armor is lightweight and flexible.',
    'ARMOR ARMOR RATING AVAIL COST',
    'Crate Coat 9 2 900¥',
    'Armor Jacket 12 2 1,000¥',
    'This is prose again, and the table has ended.',
    'A second line of prose.',
    'Not A Row 12 2 1,000¥',
    'COMBAT SPELLS',
    'STONE FIST',
    'Type: P Range: LOS Damage: S',
    'Duration: I Drain: F – 3',
    'Stone Fist hits with the force of a thrown rock.',
    'ROCK BLAST',
    'Type: P Range: LOS (A) Damage: S',
    'Duration: I Drain: F',
  ].join('\n');

  it('reads every table and stat block on a page and nothing else', () => {
    const { items, skipped } = parsePageItems(page, 426);
    expect(items.map((i) => [i.kind, i.name])).toEqual([
      ['weapon', 'Some Pistol'],
      ['weapon', 'Burst Gun'],
      ['weapon', 'Some Pistol'],
      ['armor', 'Crate Coat'],
      ['armor', 'Armor Jacket'],
      ['spell', 'Stone Fist'],
      ['spell', 'Rock Blast'],
    ]);
    expect(items[3]).toMatchObject({ category: 'ARMOR', stats: { 'ARMOR RATING': '9' }, avail: '2', cost: 900 });
    expect(items[5]).toMatchObject({ category: 'COMBAT SPELLS' });
    // "Not A Row" came after the table had ended; it is not counted as skipped either.
    expect(skipped).toBe(0);
  });

  it('reads the one-row tables the weapon books print: a heading, the columns, the numbers', () => {
    const page = ['COMBAT HATCHET', 'ACC REACH DV AP AVAIL COST', '5 1 (STR + 3)P –3 8R 900¥', 'A hatchet made for a fight.', 'RIOT STICK', 'ACC REACH DV AP AVAIL COST', '5 1 (STR + 2)S — 4 75¥'].join('\n');
    const { items } = parsePageItems(page, 19);
    expect(items.map((i) => [i.name, i.stats['DV'], i.cost])).toEqual([
      ['Combat Hatchet', '(STR + 3)P', 900],
      ['Riot Stick', '(STR + 2)S', 75],
    ]);
    expect(items[0]).toMatchObject({ kind: 'weapon', category: 'COMBAT HATCHET' });
  });

  it('names a run of rating rows after the sub-heading they sit under, and a bare range after the line above', () => {
    const page = [
      'EYEWARE ESSENCE CAPACITY AVAIL COST',
      'Glass Eyes',
      'Rating 1 0.2 [4] 3 4,000¥',
      'Rating 2 0.3 [8] 6 6,000¥',
      'Wired Nerves (Rating 1-3)',
      'Rating 1 2 — 8R 39,000¥',
      'BASIC BIOWARE ESSENCE AVAIL COST',
      'Muscle knot (Rating 1–4) Rating x 0.2 (Rating x 5)R Rating x 32,000¥',
      'COMMUNICATIONS AVAIL COST',
      'Tag eraser',
      '(Rating 1-6) (Rating x 2)F Rating x 200¥',
    ].join('\n');
    const { items } = parsePageItems(page, 454);
    expect(items.map((i) => [i.name, i.stats['ESSENCE'], i.avail, i.costText ?? i.cost])).toEqual([
      ['Glass Eyes (Rating 1)', '0.2', '3', 4000],
      ['Glass Eyes (Rating 2)', '0.3', '6', 6000],
      ['Wired Nerves (Rating 1)', '2', '8R', 39000],
      ['Muscle knot (Rating 1–4)', 'Rating x 0.2', '(Rating x 5)R', 'Rating x 32,000¥'],
      ['Tag eraser (Rating 1-6)', undefined, '(Rating x 2)F', 'Rating x 200¥'],
    ]);
  });

  it('carries the spell section from one page to the next, and reads ACCURACY as a column', () => {
    const carry = { spellHeading: '' };
    parsePageItems(['HEALTH SPELLS', 'FAST HANDS', 'Type: P Range: T', 'Duration: S Drain: F'].join('\n'), 288, carry);
    const next = parsePageItems(['FASTER HANDS', 'Type: P Range: T', 'Duration: S Drain: F + 1'].join('\n'), 289, carry);
    expect(next.items[0]).toMatchObject({ name: 'Faster Hands', category: 'HEALTH SPELLS' });
    const blades = parsePageItems(['BLADES ACCURACY REACH DAMAGE AP AVAIL COST', 'Big Cleaver 4 2 (STR + 5)P –4 12R 4,000¥'].join('\n'), 423);
    expect(blades.items[0]).toMatchObject({ kind: 'weapon', name: 'Big Cleaver', category: 'BLADES', stats: { ACCURACY: '4', REACH: '2', DAMAGE: '(STR + 5)P', AP: '–4' } });
  });

  it('names an unlabelled table after the heading above it', () => {
    const { items } = parsePageItems(['GRAPPLE GEAR', 'AVAIL COST', 'Hook Line 4 250¥'].join('\n'), 9);
    expect(items).toEqual([{ kind: 'gear', category: 'GRAPPLE GEAR', name: 'Hook Line', stats: {}, avail: '4', cost: 250, costText: null, printedPage: 9 }]);
  });
});

describe('the small helpers', () => {
  it('isHeading', () => {
    expect(isHeading('ARMOR')).toBe(true);
    expect(isHeading('COMBAT SPELLS')).toBe(true);
    expect(isHeading('Armor')).toBe(false);
    expect(isHeading('AB')).toBe(false);
    expect(isHeading('SOME PISTOL 725¥')).toBe(false);
  });
  it('titleCase', () => {
    expect(titleCase('MANABOLT')).toBe('Manabolt');
    expect(titleCase('ANALYZE DEVICE')).toBe('Analyze Device');
    expect(titleCase('CLOUT OF THE ANCIENTS')).toBe('Clout of the Ancients');
    expect(titleCase("MAGE'S BANE (ORDER)")).toBe("Mage's Bane (Order)");
  });
});
