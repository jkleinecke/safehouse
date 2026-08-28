import { describe, expect, it } from 'vitest';
import { SheetV1Schema, type SheetV1Input } from '../src/index.js';

// Original fiction only — no book content (BUILD_CONVENTIONS hard rule 1).
const sample: SheetV1Input = {
  v: 1,
  identity: { alias: 'Static', metatype: 'elf', portraitId: null, notes: 'demo runner' },
  attributes: {
    bod: 3,
    agi: 5,
    rea: 4,
    str: 2,
    wil: 4,
    log: 6,
    int: 4,
    cha: 3,
    edg: { max: 4, current: 3 },
    ess: 4.2,
    mag: 0,
    res: 0,
  },
  skills: [
    { id: 'hacking', rating: 6, attr: 'log', spec: 'Hosts', group: null },
    { id: 'pistols', rating: 4, attr: 'agi' },
  ],
  qualities: [
    {
      name: 'Wired for Trouble',
      ref: { book: 'SR5', page: 71 },
      mods: [
        {
          id: 'q-wft-1',
          source: { kind: 'quality' },
          target: 'pool.skill.hacking',
          op: 'add',
          value: 2,
          active: true,
        },
      ],
    },
  ],
  augments: [{ name: 'Neural Shunt', essence: 0.1, ref: { book: 'SR5', page: 452 }, mods: [] }],
  weapons: [
    {
      name: 'Vesper Mk3',
      skillId: 'pistols',
      acc: 5,
      dv: '8P',
      ap: -1,
      modes: ['SA'],
      rangeCat: 'heavy-pistol',
      ammo: { cap: 15, current: 15 },
      ref: { book: 'SR5', page: 426 },
    },
  ],
  armor: [{ name: 'Lined Longcoat', rating: 12, worn: true, ref: { book: 'SR5', page: 437 } }],
  lifestyles: [{ name: 'Low', costPerMonth: 2000, paidThrough: '2076-06-01' }],
  rangeTables: { 'heavy-pistol': [5, 20, 40, 60] },
  overrides: [],
};

describe('SheetV1Schema', () => {
  it('round-trips the sample sheet (parse is idempotent)', () => {
    const once = SheetV1Schema.parse(sample);
    const twice = SheetV1Schema.parse(once);
    expect(twice).toEqual(once);
    // survives JSON serialization too
    const thawed = SheetV1Schema.parse(JSON.parse(JSON.stringify(once)));
    expect(thawed).toEqual(once);
  });

  it('fills defaults for a minimal sheet', () => {
    const sheet = SheetV1Schema.parse({
      v: 1,
      identity: { alias: 'Ghost' },
      attributes: {
        bod: 3,
        agi: 3,
        rea: 3,
        str: 3,
        wil: 3,
        log: 3,
        int: 3,
        cha: 3,
        edg: { max: 2, current: 2 },
      },
    });
    expect(sheet.identity.metatype).toBe('human');
    expect(sheet.identity.portraitId).toBeNull();
    expect(sheet.attributes.ess).toBe(6);
    expect(sheet.attributes.mag).toBe(0);
    expect(sheet.skills).toEqual([]);
    expect(sheet.weapons).toEqual([]);
    expect(sheet.rangeTables).toEqual({});
    expect(sheet.overrides).toEqual([]);
    expect(sheet.matrix).toEqual({});
  });

  it('preserves refs as {book,page,note?}', () => {
    const sheet = SheetV1Schema.parse(sample);
    expect(sheet.weapons[0]?.ref).toEqual({ book: 'SR5', page: 426 });
  });

  it('rejects unknown sheet versions', () => {
    expect(SheetV1Schema.safeParse({ ...sample, v: 2 }).success).toBe(false);
  });

  it('rejects a bad ref (page 0)', () => {
    const bad = {
      ...sample,
      armor: [{ name: 'X', rating: 1, worn: false, ref: { book: 'SR5', page: 0 } }],
    };
    expect(SheetV1Schema.safeParse(bad).success).toBe(false);
  });

  it('rejects range tables that are not 4-band tuples', () => {
    const bad = { ...sample, rangeTables: { 'heavy-pistol': [5, 20, 40] } };
    expect(SheetV1Schema.safeParse(bad).success).toBe(false);
  });
});
