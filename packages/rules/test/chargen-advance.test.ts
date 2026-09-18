/**
 * Karma spends (`chargen/advance.ts`, FR3.7 and FR3.9 Step 8): what a spend
 * costs, how long it trains, and what it does to a sheet.
 *
 * The cost tests reproduce the Karma Advancement Table (SR5 p. 107) exactly
 * — every cell of the attribute grid and every column of the four skill rows
 * — through `karmaCostOf`, the function the builder's rail and the
 * advancement route share. The worked downtime examples (p. 106) pin the
 * training times, and Uncouth/Uneducated's doubling (pp. 85, 87) is checked
 * on each kind of spend it touches. `applySpend` is tested on a sheet
 * directly: raises only go up, a raised or specialised group member leaves
 * its group, and what does not live on the sheet leaves it alone.
 *
 * Numbers only; invented names (BUILD_CONVENTIONS hard rule 1).
 */
import { describe, expect, it } from 'vitest';
import { SheetV1Schema, type KarmaSpend, type SheetV1 } from '@safehouse/contracts';
import { applySpend, karmaCostOf, trainingTimeOf } from '../src/index.js';

const plain = { qualities: [] };

function sheet(over: Partial<Parameters<typeof SheetV1Schema.parse>[0]> = {}): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias: 'Ledgerline' },
    attributes: { bod: 3, agi: 4, rea: 3, str: 3, wil: 3, log: 3, int: 4, cha: 2, edg: { max: 3, current: 1 }, mag: 0, res: 0 },
    skills: [
      { id: 'pistols', rating: 3, attr: 'agi', group: 'Firearms' },
      { id: 'longarms', rating: 3, attr: 'agi', group: 'Firearms' },
      { id: 'automatics', rating: 3, attr: 'agi', group: 'Firearms' },
      { id: 'con', rating: 2, attr: 'cha' },
    ],
    knowledge: [{ name: 'Safehouses', category: 'street', rating: 2 }],
    languages: [{ name: 'English', native: true }],
    ...over,
  } as Parameters<typeof SheetV1Schema.parse>[0]);
}

describe('karmaCostOf: the Karma Advancement Table (SR5 p.107)', () => {
  // Rows are the starting rating 1–10, columns the desired rating 2–11 (null = the printed dash).
  const ATTRIBUTE_TABLE: readonly (readonly (number | null)[])[] = [
    [10, 25, 45, 70, 100, 135, null, null, null, null],
    [null, 15, 35, 60, 90, 125, 165, null, null, null],
    [null, null, 20, 45, 75, 110, 150, 195, null, null],
    [null, null, null, 25, 55, 90, 130, 175, 225, null],
    [null, null, null, null, 30, 65, 105, 150, 200, 255],
    [null, null, null, null, null, 35, 75, 120, 170, 225],
    [null, null, null, null, null, null, 40, 85, 135, 190],
    [null, null, null, null, null, null, null, 45, 95, 150],
    [null, null, null, null, null, null, null, null, 50, 105],
    [null, null, null, null, null, null, null, null, null, 55],
  ];

  it('prices every printed cell of the attribute grid as the sum of new rating × 5', () => {
    let cells = 0;
    ATTRIBUTE_TABLE.forEach((row, i) => {
      const from = i + 1;
      row.forEach((printed, j) => {
        const to = j + 2;
        if (printed === null) return;
        expect(karmaCostOf({ kind: 'attribute', id: 'str', from, to }, plain), `${from}→${to}`).toBe(printed);
        cells++;
      });
    });
    expect(cells).toBe(45);
  });

  it('prices the four skill rows from rating 0, column by column, to 12 (13 with Aptitude)', () => {
    const active = [2, 6, 12, 20, 30, 42, 56, 72, 90, 110, 132, 156, 182];
    const group = [5, 15, 30, 50, 75, 105, 140, 180, 225, 275, 330, 390];
    const knowledge = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78, 91];
    active.forEach((printed, i) =>
      expect(karmaCostOf({ kind: 'skill', id: 'pistols', from: 0, to: i + 1 }, plain)).toBe(printed),
    );
    group.forEach((printed, i) =>
      expect(karmaCostOf({ kind: 'group', id: 'firearms', from: 0, to: i + 1 }, plain)).toBe(printed),
    );
    knowledge.forEach((printed, i) => {
      expect(karmaCostOf({ kind: 'knowledge', name: 'Safehouses', from: 0, to: i + 1 }, plain)).toBe(printed);
      expect(karmaCostOf({ kind: 'language', name: 'Cantonese', from: 0, to: i + 1 }, plain)).toBe(printed);
    });
  });

  it('keeps the Character Improvement Table flat costs: specialisation 7, new knowledge 1, spell 5, form 4', () => {
    expect(karmaCostOf({ kind: 'specialization', list: 'active', id: 'pistols', spec: 'Revolvers' }, plain)).toBe(7);
    expect(karmaCostOf({ kind: 'specialization', list: 'language', id: 'English', spec: 'Street slang' }, plain)).toBe(7);
    expect(karmaCostOf({ kind: 'knowledge', name: 'Bike Racing', from: 0, to: 1 }, plain)).toBe(1);
    expect(karmaCostOf({ kind: 'spell', name: 'Flash' }, plain)).toBe(5);
    expect(karmaCostOf({ kind: 'form', name: 'Loop' }, plain)).toBe(4);
  });

  it('prices the creation purchases of p.98, p.69 and p.318: power points 5 each, 1 per service or task, a bond by the Focus Table', () => {
    expect(karmaCostOf({ kind: 'powerPoint', count: 2 }, plain)).toBe(10);
    expect(karmaCostOf({ kind: 'spirit', type: 'water', services: 4 }, plain)).toBe(4);
    expect(karmaCostOf({ kind: 'sprite', type: 'crack', tasks: 3 }, plain)).toBe(3);
    expect(karmaCostOf({ kind: 'focus', name: 'Ring', focusType: 'spell', force: 2, bondKarma: 4 }, plain)).toBe(4);
    // The table's price whenever the type reads, from the label or the name, whatever the spend recorded.
    expect(karmaCostOf({ kind: 'focus', name: 'Power Focus', force: 6, bondKarma: 0 }, plain)).toBe(36);
    expect(karmaCostOf({ kind: 'focus', name: 'Ring', focusType: 'Sustaining', force: 3, bondKarma: 1 }, plain)).toBe(6);
    // A type that does not read keeps the recorded figure, and the validator asks for the type.
    expect(karmaCostOf({ kind: 'focus', name: 'Weighted Chain', force: 2, bondKarma: 5 }, plain)).toBe(5);
  });

  it('reproduces the downtime examples: 2→3 on a skill is 6 Karma, 5→6 is 12 (p.106)', () => {
    expect(karmaCostOf({ kind: 'skill', id: 'throwing-weapons', from: 2, to: 3 }, plain)).toBe(6);
    expect(karmaCostOf({ kind: 'skill', id: 'pistols', from: 2, to: 3 }, plain)).toBe(6);
    expect(karmaCostOf({ kind: 'skill', id: 'spellcasting', from: 5, to: 6 }, plain)).toBe(12);
    expect(karmaCostOf({ kind: 'skill', id: 'locksmith', from: 2, to: 3 }, plain)).toBe(6);
  });

  it('charges nothing for a "raise" that does not go up', () => {
    expect(karmaCostOf({ kind: 'attribute', id: 'agi', from: 4, to: 4 }, plain)).toBe(0);
    expect(karmaCostOf({ kind: 'skill', id: 'con', from: 3, to: 2 }, plain)).toBe(0);
  });
});

describe('karmaCostOf: Uncouth and Uneducated double the price (SR5 p.85, p.87)', () => {
  const uncouth = { qualities: [{ name: 'Uncouth' }] };
  const uneducated = {
    qualities: [{ name: 'Uneducated' }],
    knowledge: [
      { name: 'Corp Law', category: 'academic' as const },
      { name: 'Safehouses', category: 'street' as const },
    ],
  };

  it('Uncouth doubles social skills and their specialisations, nothing else', () => {
    expect(karmaCostOf({ kind: 'skill', id: 'con', from: 0, to: 2 }, uncouth)).toBe(12);
    expect(karmaCostOf({ kind: 'specialization', list: 'active', id: 'con', spec: 'Fast talk' }, uncouth)).toBe(14);
    expect(karmaCostOf({ kind: 'skill', id: 'pistols', from: 0, to: 2 }, uncouth)).toBe(6);
    expect(karmaCostOf({ kind: 'attribute', id: 'cha', from: 2, to: 3 }, uncouth)).toBe(15);
  });

  it('Uneducated doubles technical skills, their groups, and academic/professional knowledge', () => {
    expect(karmaCostOf({ kind: 'skill', id: 'computer', from: 1, to: 2 }, uneducated)).toBe(8);
    expect(karmaCostOf({ kind: 'group', id: 'electronics', from: 0, to: 1 }, uneducated)).toBe(10);
    expect(karmaCostOf({ kind: 'knowledge', name: 'Corp Law', from: 1, to: 2 }, uneducated)).toBe(4);
    expect(karmaCostOf({ kind: 'knowledge', name: 'Safehouses', from: 1, to: 2 }, uneducated)).toBe(2);
    expect(karmaCostOf({ kind: 'knowledge', name: 'New Field', category: 'professional', from: 0, to: 1 }, uneducated)).toBe(2);
    // Outdoors mixes technical and physical skills, so the group is not wholly in scope.
    expect(karmaCostOf({ kind: 'group', id: 'outdoors', from: 0, to: 1 }, uneducated)).toBe(5);
  });
});

describe('trainingTimeOf: the Training Rate Table (SR5 p.107)', () => {
  it('times attributes at new rating × 1 week and Edge at nothing', () => {
    expect(trainingTimeOf({ kind: 'attribute', id: 'log', from: 2, to: 4 })).toEqual({
      steps: [
        { amount: 3, unit: 'week' },
        { amount: 4, unit: 'week' },
      ],
      total: { amount: 7, unit: 'week' },
    });
    expect(trainingTimeOf({ kind: 'attribute', id: 'edg', from: 2, to: 3 }).total).toEqual({ amount: 0, unit: 'none' });
  });

  it('times skills by band — days to 4, weeks to 8, double weeks beyond — and leaves a mixed total open', () => {
    expect(trainingTimeOf({ kind: 'skill', id: 'pistols', from: 2, to: 3 }).total).toEqual({ amount: 3, unit: 'day' });
    const crossing = trainingTimeOf({ kind: 'skill', id: 'pistols', from: 3, to: 5 });
    expect(crossing.steps).toEqual([
      { amount: 4, unit: 'day' },
      { amount: 5, unit: 'week' },
    ]);
    expect(crossing.total).toBeNull();
    expect(trainingTimeOf({ kind: 'skill', id: 'pistols', from: 8, to: 9 }).total).toEqual({ amount: 18, unit: 'week' });
    expect(trainingTimeOf({ kind: 'knowledge', name: 'Safehouses', from: 1, to: 2 }).total).toEqual({ amount: 2, unit: 'day' });
  });

  it('times groups at new × 2 weeks and a specialisation at a month', () => {
    expect(trainingTimeOf({ kind: 'group', id: 'firearms', from: 2, to: 3 }).total).toEqual({ amount: 6, unit: 'week' });
    expect(trainingTimeOf({ kind: 'specialization', list: 'active', id: 'pistols', spec: 'Revolvers' }).total).toEqual({
      amount: 1,
      unit: 'month',
    });
  });

  it('cuts 6 weeks of Spellcasting to 4.5 with an instructor, as the example prints (p.106), never an attribute', () => {
    expect(trainingTimeOf({ kind: 'skill', id: 'spellcasting', from: 5, to: 6 }, { instructor: true }).total).toEqual({
      amount: 4.5,
      unit: 'week',
    });
    expect(trainingTimeOf({ kind: 'attribute', id: 'log', from: 3, to: 4 }, { instructor: true }).total).toEqual({
      amount: 4,
      unit: 'week',
    });
  });

  it('adds half again for Dependents (p.80) and has no steps for spends the table does not time', () => {
    expect(trainingTimeOf({ kind: 'attribute', id: 'log', from: 3, to: 4 }, { dependents: true }).total).toEqual({
      amount: 6,
      unit: 'week',
    });
    expect(trainingTimeOf({ kind: 'spell', name: 'Flash' })).toEqual({ steps: [], total: null });
  });
});

describe('applySpend: a spend on a sheet (FR3.7)', () => {
  it('raises an attribute, and Edge keeps its spent points spent', () => {
    const s = sheet();
    expect(applySpend(s, { kind: 'attribute', id: 'log', from: 3, to: 4 }).attributes.log).toBe(4);
    const edge = applySpend(s, { kind: 'attribute', id: 'edg', from: 3, to: 4 }).attributes.edg;
    expect(edge).toEqual({ max: 4, current: 2 });
    expect(applySpend(s, { kind: 'attribute', id: 'mag', from: 0, to: 1 }).attributes.mag).toBe(1);
  });

  it('never lowers a rating, whatever `to` says', () => {
    const s = sheet();
    expect(applySpend(s, { kind: 'attribute', id: 'agi', from: 1, to: 2 }).attributes.agi).toBe(4);
    expect(applySpend(s, { kind: 'skill', id: 'con', from: 0, to: 1 }).skills.find((k) => k.id === 'con')?.rating).toBe(2);
  });

  it('learns a new skill with its linked attribute and target, and raising one group member breaks the group', () => {
    const s = sheet();
    const learned = applySpend(s, { kind: 'skill', id: 'exotic-ranged', target: 'Net gun', from: 0, to: 1 });
    expect(learned.skills.at(-1)).toEqual({ id: 'exotic-ranged', rating: 1, attr: 'agi', target: 'Net gun' });
    const raised = applySpend(s, { kind: 'skill', id: 'pistols', from: 3, to: 4 });
    expect(raised.skills.find((k) => k.id === 'pistols')).toMatchObject({ rating: 4, group: null });
    expect(raised.skills.find((k) => k.id === 'longarms')).toMatchObject({ rating: 3, group: 'Firearms' });
  });

  it('raises a whole group, adding members the sheet did not have', () => {
    const s = applySpend(sheet(), { kind: 'group', id: 'athletics', from: 0, to: 2 });
    expect(s.skills.filter((k) => k.group === 'Athletics').map((k) => [k.id, k.rating])).toEqual([
      ['gymnastics', 2],
      ['running', 2],
      ['swimming', 2],
    ]);
    const firearms = applySpend(sheet(), { kind: 'group', id: 'firearms', from: 3, to: 4 });
    expect(firearms.skills.filter((k) => k.group === 'Firearms').every((k) => k.rating === 4)).toBe(true);
  });

  it('raises or learns knowledge and languages by name', () => {
    const s = sheet();
    expect(applySpend(s, { kind: 'knowledge', name: 'safehouses', from: 2, to: 3 }).knowledge).toEqual([
      { name: 'Safehouses', category: 'street', rating: 3 },
    ]);
    expect(applySpend(s, { kind: 'knowledge', name: 'Corp Law', category: 'academic', from: 0, to: 1 }).knowledge.at(-1)).toEqual(
      { name: 'Corp Law', category: 'academic', rating: 1 },
    );
    expect(applySpend(s, { kind: 'language', name: 'Cantonese', from: 0, to: 2 }).languages.at(-1)).toEqual({
      name: 'Cantonese',
      rating: 2,
      native: false,
    });
  });

  it('adds a specialisation beside any the skill has, and a grouped skill leaves its group (p.89)', () => {
    let s = applySpend(sheet(), { kind: 'specialization', list: 'active', id: 'pistols', spec: 'Revolvers' });
    s = applySpend(s, { kind: 'specialization', list: 'active', id: 'pistols', spec: 'Holdouts' });
    expect(s.skills.find((k) => k.id === 'pistols')).toMatchObject({ spec: 'Revolvers, Holdouts', group: null });
    const known = applySpend(sheet(), { kind: 'specialization', list: 'knowledge', id: 'Safehouses', spec: 'Downtown' });
    expect(known.knowledge[0]?.spec).toBe('Downtown');
  });

  it('adds spells, forms and power points, and leaves spirits, sprites and foci to the magic store', () => {
    const s = sheet();
    const spend: KarmaSpend[] = [
      { kind: 'spell', name: 'Flash', category: 'combat' },
      { kind: 'form', name: 'Loop' },
      { kind: 'powerPoint', count: 2 },
    ];
    const after = spend.reduce((sheet, one) => applySpend(sheet, one), s);
    expect(after.spells).toEqual([{ name: 'Flash', category: 'combat' }]);
    expect(after.complexForms).toEqual([{ name: 'Loop' }]);
    expect(after.awakening.powerPoints).toBe(2);
    for (const off of [
      { kind: 'spirit', type: 'air', services: 2 },
      { kind: 'sprite', type: 'data', tasks: 2 },
      { kind: 'focus', name: 'Ring', force: 1, bondKarma: 2 },
    ] as const) {
      expect(applySpend(s, off)).toBe(s);
    }
    expect(SheetV1Schema.parse(after)).toEqual(after);
  });
});
