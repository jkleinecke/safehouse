/**
 * The catalogue parser (services/catalogue.ts) against the SHAPES the books
 * print — every name and number here is invented (§14: no book content in
 * code or fixtures); what is real is the layout pdf.js hands back.
 */
import { describe, expect, it } from 'vitest';
import { isHeading, parseHeader, parsePageItems, parseRow, parseStatBlock, splitCells, titleCase } from '../src/services/catalogue.js';

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
  it('ignores headings with no stat line under them', () => {
    expect(parseStatBlock('HEAVY PISTOLS', ['Heavy pistols are powerful sidearms.'], '', 1)).toBeNull();
    expect(parseStatBlock('ARMOR', ['Advances in ballistic fabrics'], '', 1)).toBeNull();
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
