import { describe, expect, it } from 'vitest';
import {
  DerivedCharacterSchema,
  SheetV1Schema,
  type DerivedValue,
  type Modifier,
  type SheetV1,
  type SheetV1Input,
} from '@safehouse/contracts';
import {
  AUGMENTATION_BONUS_CAP,
  dedupeSceneModifiers,
  deriveCharacter,
  environment,
  skillPoolKey,
  woundModifierFor,
} from '../src/index.js';

let nextId = 0;
function mod(partial: Partial<Modifier> & { target: string; value: number }): Modifier {
  return {
    id: `m${nextId++}`,
    source: { kind: 'cyberware' },
    op: 'add',
    active: true,
    ...partial,
  };
}

function makeSheet(over: Partial<SheetV1Input> = {}): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias: 'Testcase' },
    attributes: {
      bod: 4,
      agi: 5,
      rea: 4,
      str: 3,
      wil: 4,
      log: 3,
      int: 4,
      cha: 2,
      edg: { max: 3, current: 3 },
    },
    skills: [
      { id: 'perception', rating: 3, attr: 'int' },
      { id: 'automatics', rating: 4, attr: 'agi' },
    ],
    ...over,
  });
}

function sumBreakdown(v: DerivedValue | { total: number; breakdown: { value: number }[] }): number {
  return v.breakdown.reduce((s, e) => s + e.value, 0);
}

type AttributesInput = SheetV1Input['attributes'];

/** makeSheet's attributes with a few changed. */
function attrs(over: Partial<AttributesInput> = {}): AttributesInput {
  return {
    bod: 4,
    agi: 5,
    rea: 4,
    str: 3,
    wil: 4,
    log: 3,
    int: 4,
    cha: 2,
    edg: { max: 3, current: 3 },
    ...over,
  };
}

describe('deriveCharacter: limits (§10.2)', () => {
  it('computes Physical/Mental/Social limits with ceil', () => {
    const d = deriveCharacter(makeSheet());
    expect(d.limits.physical.value).toBe(Math.ceil((3 * 2 + 4 + 4) / 3)); // 5
    expect(d.limits.mental.value).toBe(Math.ceil((3 * 2 + 4 + 4) / 3)); // 5
    expect(d.limits.social.value).toBe(Math.ceil((2 * 2 + 4 + 6) / 3)); // 5
  });

  it('social limit uses derived (decimal) Essence', () => {
    const d = deriveCharacter(
      makeSheet({ augments: [{ name: 'Datajack', essence: 0.1, mods: [] }] }),
    );
    expect(d.attributes['ess']?.value).toBeCloseTo(5.9);
    expect(d.limits.social.value).toBe(Math.ceil((4 + 4 + 5.9) / 3)); // ceil(13.9/3)=5
  });
});

describe('deriveCharacter: condition monitors (§10.2)', () => {
  it('sizes physical/stun/overflow monitors', () => {
    const d = deriveCharacter(makeSheet());
    expect(d.monitors.physical.value).toBe(8 + Math.ceil(4 / 2)); // 10
    expect(d.monitors.stun.value).toBe(8 + Math.ceil(4 / 2)); // 10
    expect(d.monitors.overflow.value).toBe(4); // BOD
  });

  it('odd BOD rounds up', () => {
    const d = deriveCharacter(makeSheet({ attributes: { bod: 5, agi: 5, rea: 4, str: 3, wil: 3, log: 3, int: 4, cha: 2, edg: { max: 3, current: 3 } } }));
    expect(d.monitors.physical.value).toBe(8 + 3); // ceil(5/2)=3
    expect(d.monitors.stun.value).toBe(8 + 2); // ceil(3/2)=2
  });

  it('monitor modifiers apply (augment monitor.overflow)', () => {
    const d = deriveCharacter(
      makeSheet({
        augments: [
          {
            name: 'Trauma unit',
            essence: 0,
            mods: [mod({ target: 'monitor.overflow', value: 2 })],
          },
        ],
      }),
    );
    expect(d.monitors.overflow.value).toBe(6);
  });
});

describe('deriveCharacter: initiative variants (§10.2, FR4.2)', () => {
  it('physical REA+INT+1d6, astral INT×2+2d6, VR cold 3d6 / hot 4d6', () => {
    const d = deriveCharacter(
      makeSheet({ matrix: { deck: { name: 'Deck', asdf: [4, 3, 5, 2], programs: [] } } }),
    );
    expect(d.initiative.physical.base.value).toBe(8);
    expect(d.initiative.physical.dice.value).toBe(1);
    expect(d.initiative.astral.base.value).toBe(8);
    expect(d.initiative.astral.dice.value).toBe(2);
    expect(d.initiative.matrixAR.base.value).toBe(8);
    expect(d.initiative.matrixAR.dice.value).toBe(1);
    expect(d.initiative.vrCold.base.value).toBe(5 + 4); // DP + INT
    expect(d.initiative.vrCold.dice.value).toBe(3);
    expect(d.initiative.vrHot.base.value).toBe(9);
    expect(d.initiative.vrHot.dice.value).toBe(4);
  });

  it('no deck means DP 0 for the VR lines', () => {
    const d = deriveCharacter(makeSheet());
    expect(d.initiative.vrCold.base.value).toBe(4);
  });

  it('augment initiative dice add but cap at 5d6, with the clip in provenance', () => {
    const d = deriveCharacter(
      makeSheet({
        augments: [
          {
            name: 'Wired reflexes 3',
            essence: 0,
            mods: [
              mod({ target: 'attr.rea', value: 3 }),
              mod({ target: 'initiative.dice', value: 7 }),
            ],
          },
        ],
      }),
    );
    expect(d.initiative.physical.base.value).toBe(7 + 4); // REA 4+3, INT 4
    expect(d.initiative.physical.dice.value).toBe(5);
    expect(sumBreakdown(d.initiative.physical.dice)).toBe(5);
    // astral does not inherit meat augment dice
    expect(d.initiative.astral.dice.value).toBe(2);
  });
});

describe('deriveCharacter: wound modifiers (§10.2)', () => {
  it('steps at 3/6/9 filled boxes', () => {
    expect(woundModifierFor({ physical: 0, stun: 0 })).toBe(0);
    expect(woundModifierFor({ physical: 2, stun: 0 })).toBe(0);
    expect(woundModifierFor({ physical: 3, stun: 0 })).toBe(-1);
    expect(woundModifierFor({ physical: 5, stun: 0 })).toBe(-1);
    expect(woundModifierFor({ physical: 6, stun: 0 })).toBe(-2);
    expect(woundModifierFor({ physical: 9, stun: 0 })).toBe(-3);
    expect(woundModifierFor({ physical: 3, stun: 3 })).toBe(-2); // cumulative
    expect(woundModifierFor({ physical: 6, stun: 6 })).toBe(-4);
  });

  it('applies to pools and every initiative score, not to soak', () => {
    const clean = deriveCharacter(makeSheet());
    const hurt = deriveCharacter(makeSheet(), { wounds: { physical: 6, stun: 3 } });
    expect(hurt.woundModifier?.value).toBe(-3);
    expect(sumBreakdown(hurt.woundModifier!)).toBe(-3);
    expect(hurt.pools['skill.perception']?.total).toBe(
      (clean.pools['skill.perception']?.total ?? 0) - 3,
    );
    expect(hurt.initiative.physical.base.value).toBe(clean.initiative.physical.base.value - 3);
    expect(hurt.initiative.astral.base.value).toBe(clean.initiative.astral.base.value - 3);
    expect(hurt.initiative.vrHot.base.value).toBe(clean.initiative.vrHot.base.value - 3);
    expect(hurt.pools['soak']?.total).toBe(clean.pools['soak']?.total); // resistance exempt
    expect(hurt.initiative.physical.dice.value).toBe(clean.initiative.physical.dice.value);
  });

  it('zero wounds still reports a woundModifier of 0 when supplied', () => {
    const d = deriveCharacter(makeSheet(), { wounds: { physical: 2, stun: 1 } });
    expect(d.woundModifier?.value).toBe(0);
    expect(d.pools['skill.perception']?.total).toBe(7);
  });
});

describe('deriveCharacter: Essence → MAG/RES (§10.2)', () => {
  it('reduces ESS by augment costs and MAG by ceil(essence lost)', () => {
    const d = deriveCharacter(
      makeSheet({
        attributes: { bod: 4, agi: 5, rea: 4, str: 3, wil: 4, log: 3, int: 4, cha: 2, mag: 6, edg: { max: 3, current: 3 } },
        augments: [
          { name: 'Cybereyes', essence: 0.5, mods: [] },
          { name: 'Wired reflexes', essence: 2.0, mods: [] },
        ],
      }),
    );
    expect(d.attributes['ess']?.value).toBeCloseTo(3.5);
    expect(d.attributes['mag']?.value).toBe(6 - Math.ceil(2.5)); // 3
    expect(sumBreakdown(d.attributes['mag']!)).toBe(3);
  });

  it('whole-point loss reduces exactly, and MAG floors at 0', () => {
    const one = deriveCharacter(
      makeSheet({
        attributes: { bod: 4, agi: 5, rea: 4, str: 3, wil: 4, log: 3, int: 4, cha: 2, mag: 6, edg: { max: 3, current: 3 } },
        augments: [{ name: 'Implant', essence: 1, mods: [] }],
      }),
    );
    expect(one.attributes['mag']?.value).toBe(5); // ceil(1) = 1, not 2
    const burned = deriveCharacter(
      makeSheet({
        attributes: { bod: 4, agi: 5, rea: 4, str: 3, wil: 4, log: 3, int: 4, cha: 2, mag: 2, edg: { max: 3, current: 3 } },
        augments: [{ name: 'Full conversion', essence: 5, mods: [] }],
      }),
    );
    expect(burned.attributes['mag']?.value).toBe(0);
    expect(sumBreakdown(burned.attributes['mag']!)).toBe(0);
  });

  it('mundanes (MAG 0) stay 0 without negative values', () => {
    const d = deriveCharacter(
      makeSheet({ augments: [{ name: 'Implant', essence: 3, mods: [] }] }),
    );
    expect(d.attributes['mag']?.value).toBe(0);
  });
});

describe('deriveCharacter: movement (FR9.8)', () => {
  it('walk AGI×2, run AGI×4, augments to AGI propagate', () => {
    const d = deriveCharacter(makeSheet());
    expect(d.movement.walk.value).toBe(10);
    expect(d.movement.run.value).toBe(20);
    const boosted = deriveCharacter(
      makeSheet({
        augments: [{ name: 'Muscle toner', essence: 0, mods: [mod({ target: 'attr.agi', value: 2 })] }],
      }),
    );
    expect(boosted.movement.walk.value).toBe(14);
    expect(boosted.movement.run.value).toBe(28);
  });
});

describe('deriveCharacter: pools (FR3.3)', () => {
  const sheet = makeSheet({
    attributes: { bod: 4, agi: 5, rea: 4, str: 3, wil: 4, log: 3, int: 4, cha: 2, mag: 5, edg: { max: 3, current: 3 } },
    skills: [
      { id: 'perception', rating: 3, attr: 'int' },
      { id: 'automatics', rating: 4, attr: 'agi' },
      { id: 'spellcasting', rating: 4, attr: 'mag' },
    ],
    weapons: [
      { name: 'AK-97', skillId: 'automatics', acc: 5, dv: '10P', ap: -2, rangeCat: 'assault_rifle' },
      { name: 'Fists', skillId: 'unarmed' }, // skill not on the sheet -> defaulting
    ],
    armor: [
      { name: 'Armor jacket', rating: 12, worn: true },
      { name: 'Vest', rating: 9, worn: true },
      { name: 'Fancy suit', rating: 8, worn: false },
    ],
    spells: [{ name: 'Stunbolt' }],
  });

  it('skill pools are attribute + rating with an inherent limit attached', () => {
    const d = deriveCharacter(sheet);
    expect(d.pools['skill.perception']?.total).toBe(4 + 3);
    expect(d.pools['skill.perception']?.limit).toEqual({ kind: 'mental', value: 5 });
    expect(d.pools['skill.automatics']?.total).toBe(5 + 4);
    expect(d.pools['skill.automatics']?.limit?.kind).toBe('physical');
  });

  it('weapon pools use the linked skill and carry Accuracy as the limit', () => {
    const d = deriveCharacter(sheet);
    expect(d.pools['weapon.AK-97']?.total).toBe(9);
    expect(d.pools['weapon.AK-97']?.limit).toEqual({ kind: 'accuracy', value: 5 });
  });

  it('missing weapon skill defaults to AGI − 1', () => {
    const d = deriveCharacter(sheet);
    expect(d.pools['weapon.Fists']?.total).toBe(5 - 1);
    expect(
      d.pools['weapon.Fists']?.breakdown.some((e) => e.label.includes('defaulting')),
    ).toBe(true);
  });

  it('spell pools are MAG + spellcasting', () => {
    const d = deriveCharacter(sheet);
    expect(d.pools['spell.Stunbolt']?.total).toBe(5 + 4);
  });

  it('armor is the best worn item; soak is BOD + armor', () => {
    const d = deriveCharacter(sheet);
    expect(d.pools['armor']?.total).toBe(12);
    expect(d.pools['soak']?.total).toBe(4 + 12);
  });

  it('defense is REA + INT', () => {
    const d = deriveCharacter(sheet);
    expect(d.pools['defense']?.total).toBe(8);
  });

  it('pool.all modifiers hit skill/weapon/spell/defense but not soak or armor', () => {
    const sustaining = mod({
      target: 'pool.all',
      value: -2,
      source: { kind: 'spell' },
      note: 'sustaining',
    });
    const d = deriveCharacter(sheet, { situational: [] });
    const s = deriveCharacter(
      makeSheet({ ...{}, powers: [{ name: 'Sustain', mods: [sustaining] }], skills: [{ id: 'perception', rating: 3, attr: 'int' }], armor: [{ name: 'Jacket', rating: 12, worn: true }] }),
    );
    expect(s.pools['skill.perception']?.total).toBe(7 - 2);
    expect(s.pools['defense']?.total).toBe(8 - 2);
    expect(s.pools['soak']?.total).toBe(4 + 12);
    expect(s.pools['armor']?.total).toBe(12);
    expect(d.pools['skill.perception']?.total).toBe(7);
  });

  it('inactive modifiers do nothing', () => {
    const d = deriveCharacter(
      makeSheet({
        qualities: [
          { name: 'Toggle', mods: [mod({ target: 'pool.all', value: -4, active: false, source: { kind: 'quality' } })] },
        ],
      }),
    );
    expect(d.pools['skill.perception']?.total).toBe(7);
  });
});

describe('deriveCharacter: scene environment integration (FR9.11)', () => {
  it('scene modifiers land in pools with provenance and skip soak', () => {
    const sceneMods = environment({ light: 2, visibility: 0, glare: 0, wind: 0 });
    const d = deriveCharacter(makeSheet(), { situational: sceneMods });
    expect(d.pools['skill.perception']?.total).toBe(7 - 3);
    const entry = d.pools['skill.perception']?.breakdown.find((e) => e.source === 'scene');
    expect(entry?.value).toBe(-3);
    expect(d.pools['soak']?.total).toBe(4); // no armor worn, unaffected by scene
  });
});

describe('deriveCharacter: overrides (Principle 2)', () => {
  it('override set wins last and provenance still sums', () => {
    const d = deriveCharacter(
      makeSheet({
        overrides: [
          mod({ target: 'limit.physical', op: 'set', value: 9, source: { kind: 'override' }, note: 'GM: chrome legend' }),
        ],
      }),
    );
    expect(d.limits.physical.value).toBe(9);
    expect(sumBreakdown(d.limits.physical)).toBe(9);
  });

  it('override applies after situational modifiers', () => {
    const d = deriveCharacter(
      makeSheet({
        overrides: [mod({ target: 'pool.skill.perception', op: 'set', value: 12, source: { kind: 'override' } })],
      }),
      { situational: environment({ light: 3, visibility: 0, glare: 0, wind: 0 }) },
    );
    expect(d.pools['skill.perception']?.total).toBe(12);
  });
});

describe('deriveCharacter: pipeline properties (§17.1)', () => {
  it('is order-independent within a phase', () => {
    const m1 = mod({ target: 'attr.rea', value: 1, note: 'a' });
    const m2 = mod({ target: 'attr.rea', value: 2, note: 'b' });
    // Set 5 rather than 6: +5 would meet the +4 augmentation cap, which has
    // its own tests below; this one is about set/add order alone.
    const m3 = mod({ target: 'attr.rea', op: 'set', value: 5, note: 'c' });
    const forward = deriveCharacter(
      makeSheet({ augments: [{ name: 'X', essence: 0, mods: [m1, m2, m3] }] }),
    );
    const reversed = deriveCharacter(
      makeSheet({ augments: [{ name: 'X', essence: 0, mods: [m3, m2, m1] }] }),
    );
    expect(forward.attributes['rea']?.value).toBe(reversed.attributes['rea']?.value);
    expect(forward.attributes['rea']?.value).toBe(8); // set 5, then +1+2
  });

  it('cap op clamps and records the clip', () => {
    const d = deriveCharacter(
      makeSheet({
        overrides: [mod({ target: 'attr.agi', op: 'cap', value: 3, source: { kind: 'override' } })],
      }),
    );
    expect(d.attributes['agi']?.value).toBe(3);
    expect(sumBreakdown(d.attributes['agi']!)).toBe(3);
  });

  it('every derived value provenance sums to its total', () => {
    const d = deriveCharacter(
      makeSheet({
        attributes: { bod: 4, agi: 5, rea: 4, str: 3, wil: 4, log: 3, int: 4, cha: 2, mag: 6, edg: { max: 3, current: 3 } },
        augments: [
          {
            name: 'Wired reflexes',
            essence: 2,
            mods: [mod({ target: 'attr.rea', value: 2 }), mod({ target: 'initiative.dice', value: 2 })],
          },
        ],
        skills: [
          { id: 'perception', rating: 3, attr: 'int' },
          { id: 'spellcasting', rating: 4, attr: 'mag' },
        ],
        weapons: [{ name: 'Pistol', skillId: 'pistols' }],
        armor: [{ name: 'Jacket', rating: 12, worn: true }],
        spells: [{ name: 'Manabolt' }],
        overrides: [mod({ target: 'pool.all', value: -1, source: { kind: 'override' }, note: 'table rule' })],
      }),
      {
        wounds: { physical: 4, stun: 3 },
        situational: environment({ light: 1, visibility: 1, glare: 0, wind: 0 }),
      },
    );
    const values: DerivedValue[] = [
      ...Object.values(d.attributes),
      d.limits.physical,
      d.limits.mental,
      d.limits.social,
      d.monitors.physical,
      d.monitors.stun,
      d.monitors.overflow,
      d.movement.walk,
      d.movement.run,
      ...Object.values(d.initiative).flatMap((line) => [line.base, line.dice]),
      ...(d.woundModifier ? [d.woundModifier] : []),
    ];
    for (const v of values) {
      expect(sumBreakdown(v), JSON.stringify(v)).toBeCloseTo(v.value, 10);
    }
    for (const [key, pool] of Object.entries(d.pools)) {
      expect(sumBreakdown(pool), key).toBeCloseTo(pool.total, 10);
    }
  });

  it('output conforms to the DerivedCharacter contract', () => {
    const d = deriveCharacter(makeSheet(), { wounds: { physical: 3, stun: 0 } });
    expect(() => DerivedCharacterSchema.parse(d)).not.toThrow();
  });

  it('pools and monitors never go negative', () => {
    const d = deriveCharacter(
      makeSheet({
        overrides: [
          mod({ target: 'pool.all', value: -30, source: { kind: 'override' } }),
          mod({ target: 'monitor.overflow', value: -30, source: { kind: 'override' } }),
        ],
      }),
      { wounds: { physical: 9, stun: 9 } },
    );
    for (const pool of Object.values(d.pools)) {
      expect(pool.total).toBeGreaterThanOrEqual(0);
    }
    expect(d.monitors.overflow.value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The +4 augmentation bonus cap (SR5 p.94)
// ---------------------------------------------------------------------------

describe('deriveCharacter: +4 augmentation bonus cap (SR5 p.94)', () => {
  const capLine = (v: DerivedValue) => v.breakdown.find((e) => e.label.includes('augmentation bonus cap'));

  it('is four points', () => {
    expect(AUGMENTATION_BONUS_CAP).toBe(4);
  });

  it('a natural Strength 4 with muscle augmentation 2 records as Strength 4 (6) (SR5 p.95)', () => {
    const sheet = makeSheet({
      attributes: attrs({ str: 4 }),
      augments: [
        { name: 'Muscle augmentation 2', essence: 0.4, mods: [mod({ target: 'attr.str', value: 2 })] },
      ],
    });
    const d = deriveCharacter(sheet);
    // The book's "4 (6)": the natural rating stays on the sheet, the augmented one is derived.
    expect(sheet.attributes.str).toBe(4);
    expect(d.attributes['str']?.value).toBe(6);
    expect(capLine(d.attributes['str']!)).toBeUndefined();
  });

  it('holds a stack of two augmentations to +4, with the clip on the receipt', () => {
    const d = deriveCharacter(
      makeSheet({
        attributes: attrs({ str: 4 }),
        augments: [
          { name: 'Muscle augmentation 3', essence: 0.6, mods: [mod({ target: 'attr.str', value: 3, note: 'Muscle augmentation 3' })] },
          { name: 'Cyberarm strength 2', essence: 0, mods: [mod({ target: 'attr.str', value: 2, note: 'Cyberarm strength 2' })] },
        ],
      }),
    );
    const str = d.attributes['str']!;
    expect(str.value).toBe(8); // 4 + 5, held to 4 + 4
    expect(capLine(str)).toEqual({ label: 'augmentation bonus cap (+4)', value: -1, source: 'engine' });
    expect(sumBreakdown(str)).toBe(8);
    // Everything downstream reads the capped rating.
    expect(d.limits.physical.value).toBe(Math.ceil((8 * 2 + 4 + 4) / 3));
  });

  it('counts every source together: implant, adept power and spell (SR5 p.94 "combination of sources")', () => {
    const d = deriveCharacter(
      makeSheet({
        augments: [{ name: 'Wired reflexes 2', essence: 3, mods: [mod({ target: 'attr.rea', value: 2 })] }],
        powers: [
          {
            name: 'Improved reflexes 1',
            mods: [mod({ target: 'attr.rea', value: 1, source: { kind: 'power' } })],
          },
          {
            name: 'Sustained quickening',
            mods: [mod({ target: 'attr.rea', value: 3, source: { kind: 'spell' } })],
          },
        ],
      }),
    );
    expect(d.attributes['rea']?.value).toBe(4 + 4); // +6 held to +4
    expect(capLine(d.attributes['rea']!)?.value).toBe(-2);
    expect(d.initiative.physical.base.value).toBe(8 + 4); // REA 8 + INT 4
    expect(d.pools['defense']?.total).toBe(8 + 4);
  });

  it('takes a penalty off the capped rating, not out of the excess', () => {
    const d = deriveCharacter(
      makeSheet({
        attributes: attrs({ agi: 4 }),
        augments: [{ name: 'Muscle toner 4 and cyberarm', essence: 0, mods: [mod({ target: 'attr.agi', value: 6 })] }],
        powers: [
          {
            name: 'Nerve stall',
            mods: [mod({ target: 'attr.agi', value: -2, source: { kind: 'status' }, note: 'nerve stall' })],
          },
        ],
      }),
    );
    const agi = d.attributes['agi']!;
    expect(agi.value).toBe(4 + 4 - 2);
    expect(sumBreakdown(agi)).toBe(agi.value);
  });

  it('measures from the natural rating, which includes qualities', () => {
    const d = deriveCharacter(
      makeSheet({
        qualities: [
          { name: 'Hand-entered trait', mods: [mod({ target: 'attr.bod', value: 1, source: { kind: 'quality' } })] },
        ],
        augments: [{ name: 'Bone density 4', essence: 1.2, mods: [mod({ target: 'attr.bod', value: 4 })] }],
      }),
    );
    expect(d.attributes['bod']?.value).toBe(4 + 1 + 4);
    expect(capLine(d.attributes['bod']!)).toBeUndefined();
  });

  it('leaves the GM the last word: overrides apply after the cap (Principle 2)', () => {
    const chromed = [{ name: 'Prototype limbs', essence: 2, mods: [mod({ target: 'attr.agi', value: 6 })] }];
    const added = deriveCharacter(
      makeSheet({
        augments: chromed,
        overrides: [mod({ target: 'attr.agi', value: 1, source: { kind: 'override' }, note: 'GM: prototype' })],
      }),
    );
    expect(added.attributes['agi']?.value).toBe(5 + 4 + 1);
    const breakdown = added.attributes['agi']!.breakdown;
    const capAt = breakdown.findIndex((e) => e.source === 'engine');
    const overrideAt = breakdown.findIndex((e) => e.source === 'override');
    expect(capAt).toBeGreaterThan(-1);
    expect(overrideAt).toBeGreaterThan(capAt);
    expect(sumBreakdown(added.attributes['agi']!)).toBe(10);

    const set = deriveCharacter(
      makeSheet({
        augments: chromed,
        overrides: [mod({ target: 'attr.agi', op: 'set', value: 11, source: { kind: 'override' } })],
      }),
    );
    expect(set.attributes['agi']?.value).toBe(11);
  });

  it('does not touch Magic, Resonance or Essence', () => {
    const d = deriveCharacter(
      makeSheet({
        attributes: attrs({ mag: 3 }),
        powers: [{ name: 'Table rule', mods: [mod({ target: 'attr.mag', value: 5, source: { kind: 'power' } })] }],
      }),
    );
    expect(d.attributes['mag']?.value).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Living persona (SR5 p.101, p.250)
// ---------------------------------------------------------------------------

describe('deriveCharacter: living persona (SR5 p.101, p.250)', () => {
  // Original fiction only — no book content. An invented technomancer.
  const emerged = (over: Partial<SheetV1Input> = {}): SheetV1 =>
    makeSheet({
      identity: { alias: 'Lattice' },
      attributes: attrs({ cha: 3, int: 4, log: 4, wil: 3, res: 6 }),
      ...over,
    });

  it('reads Attack CHA, Sleaze INT, Data Processing LOG, Firewall WIL, Device Rating RES', () => {
    const d = deriveCharacter(emerged());
    const p = d.livingPersona;
    expect(p).not.toBeNull();
    expect(p?.attack.value).toBe(3);
    expect(p?.sleaze.value).toBe(4);
    expect(p?.dataProcessing.value).toBe(4);
    expect(p?.firewall.value).toBe(3);
    expect(p?.deviceRating.value).toBe(6);
    for (const v of Object.values(p!)) expect(sumBreakdown(v)).toBe(v.value);
    expect(() => DerivedCharacterSchema.parse(d)).not.toThrow();
  });

  it('is null for someone with no Resonance', () => {
    const d = deriveCharacter(makeSheet());
    expect(d.livingPersona).toBeNull();
    expect(DerivedCharacterSchema.parse(d).livingPersona).toBeNull();
  });

  it('counts Resonance alone, so an imported sheet with a mundane awakening block still has one', () => {
    const sheet = emerged({ attributes: attrs({ res: 3 }) });
    expect(sheet.awakening.kind).toBe('mundane');
    expect(deriveCharacter(sheet).livingPersona?.deviceRating.value).toBe(3);
  });

  it('keeps the persona of a technomancer whose Resonance has burned out, at Device Rating 0', () => {
    const d = deriveCharacter(
      emerged({
        attributes: attrs({ res: 2 }),
        awakening: { kind: 'technomancer' },
        augments: [{ name: 'Heavy chrome', essence: 2.5, mods: [] }],
      }),
    );
    expect(d.attributes['res']?.value).toBe(0);
    expect(d.livingPersona?.deviceRating.value).toBe(0);
  });

  it('VR initiative uses the persona Data Processing when there is no deck', () => {
    const d = deriveCharacter(emerged());
    expect(d.initiative.vrCold.base.value).toBe(4 + 4); // DP (LOG) + INT
    expect(d.initiative.vrCold.dice.value).toBe(3);
    expect(d.initiative.vrHot.base.value).toBe(8);
    expect(d.initiative.vrHot.dice.value).toBe(4);
    expect(d.initiative.vrCold.base.breakdown[0]?.label).toBe('Data Processing (living persona)');
    // AR is meat initiative; the persona does not touch it.
    expect(d.initiative.matrixAR.base.value).toBe(4 + 4); // REA + INT
  });

  it('a deck, when there is one, still supplies the Data Processing', () => {
    const d = deriveCharacter(
      emerged({ matrix: { deck: { name: 'Deck', asdf: [4, 3, 5, 2], programs: [] } } }),
    );
    expect(d.initiative.vrCold.base.value).toBe(5 + 4);
    expect(d.initiative.vrCold.base.breakdown[0]?.label).toBe('Data Processing');
    expect(d.livingPersona?.dataProcessing.value).toBe(4);
  });

  it('follows augmented attributes and takes echoes as persona.<attribute> modifiers (SR5 p.257)', () => {
    const d = deriveCharacter(
      emerged({
        augments: [{ name: 'Cerebral booster 2', essence: 0.4, mods: [mod({ target: 'attr.log', value: 2 })] }],
        qualities: [
          {
            name: 'Attack upgrade',
            mods: [mod({ target: 'persona.attack', value: 1, source: { kind: 'power' }, note: 'echo' })],
          },
        ],
      }),
    );
    expect(d.livingPersona?.dataProcessing.value).toBe(6);
    expect(d.livingPersona?.attack.value).toBe(4);
    expect(d.livingPersona?.attack.breakdown.at(-1)).toEqual({ label: 'echo', value: 1, source: 'power' });
    expect(d.initiative.vrHot.base.value).toBe(6 + 4);
  });
});

// ---------------------------------------------------------------------------
// Racial armor (SR5 p.66)
// ---------------------------------------------------------------------------

describe('deriveCharacter: racial dermal armor (SR5 p.66)', () => {
  const racialLine = (d: ReturnType<typeof deriveCharacter>) =>
    d.pools['armor']?.breakdown.find((e) => e.source === 'racial');

  it('a troll adds +1 dermal armor to what is worn, and it reaches soak', () => {
    const d = deriveCharacter(
      makeSheet({
        identity: { alias: 'Slab', metatype: 'troll' },
        armor: [{ name: 'Armor jacket', rating: 12, worn: true }],
      }),
    );
    expect(d.pools['armor']?.total).toBe(13);
    expect(racialLine(d)).toEqual({ label: 'dermal armor (troll)', value: 1, source: 'racial' });
    expect(d.pools['soak']?.total).toBe(4 + 13);
    expect(sumBreakdown(d.pools['armor']!)).toBe(13);
  });

  it('with nothing worn the skin is still armor, whatever the metatype is spelled', () => {
    const d = deriveCharacter(makeSheet({ identity: { alias: 'Slab', metatype: 'Troll' } }));
    expect(d.pools['armor']?.total).toBe(1);
  });

  it('orthoskin replaces the natural dermal deposits and their bonus (SR5 p.94)', () => {
    const d = deriveCharacter(
      makeSheet({
        identity: { alias: 'Slab', metatype: 'troll' },
        augments: [{ name: 'Orthoskin 2', essence: 0.5, mods: [mod({ target: 'armor', value: 2, note: 'Orthoskin 2' })] }],
      }),
    );
    expect(racialLine(d)).toBeUndefined();
    expect(d.pools['armor']?.total).toBe(2);
  });

  it('nobody else is born armored', () => {
    for (const metatype of ['human', 'elf', 'dwarf', 'ork', 'spirit']) {
      const d = deriveCharacter(makeSheet({ identity: { alias: 'Case', metatype } }));
      expect(d.pools['armor']?.total, metatype).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// One authority per scene modifier (LIVE-2)
// ---------------------------------------------------------------------------

describe('scene modifiers are counted exactly once', () => {
  /** What the server derives for an active scene with dim light. */
  const sceneMods = environment({ light: 1, visibility: 0, glare: 0, wind: 0 });

  it('collapses the same scene modifier arriving twice', () => {
    const once = deriveCharacter(makeSheet(), { situational: sceneMods });
    // The client echoes the chip back with its own id and note — same scene,
    // same target: the penalty must not double (the live bug: pool 4 with the
    // environment line printed twice while the sheet showed 5).
    const echoed = deriveCharacter(makeSheet(), {
      situational: [
        ...sceneMods,
        {
          id: 'client.env.copy',
          source: { kind: 'scene' },
          target: 'pool.all',
          op: 'add',
          value: -1,
          active: true,
          note: 'environment: light 1 → light (-1)',
        },
      ],
    });
    const pool = echoed.pools['skill.perception']!;
    expect(pool.total).toBe(once.pools['skill.perception']!.total);
    expect(pool.breakdown.filter((e) => e.source === 'scene')).toHaveLength(1);
    expect(sumBreakdown(pool)).toBe(pool.total);
  });

  it('keeps two genuinely different scene modifiers', () => {
    const d = deriveCharacter(makeSheet(), {
      situational: [
        ...sceneMods,
        {
          id: 'scene.noise',
          source: { kind: 'scene', ref: 'crowd noise' },
          target: 'pool.all',
          op: 'add',
          value: -2,
          active: true,
          note: 'crowd noise (−2)',
        },
      ],
    });
    const pool = d.pools['skill.perception']!;
    expect(pool.breakdown.filter((e) => e.source === 'scene')).toHaveLength(2);
    expect(sumBreakdown(pool)).toBe(pool.total);
  });

  it('exposes the collapse as a helper the server can reuse', () => {
    const doubled = [...sceneMods, ...sceneMods];
    expect(dedupeSceneModifiers(doubled)).toHaveLength(1);
    // Non-scene sources are never touched, and order is preserved.
    const mixed = dedupeSceneModifiers([
      mod({ target: 'pool.all', value: -1, source: { kind: 'situational' } }),
      ...doubled,
      mod({ target: 'pool.all', value: -2, source: { kind: 'situational' } }),
    ]);
    expect(mixed.map((m) => m.source.kind)).toEqual(['situational', 'scene', 'situational']);
  });
});

// ---------------------------------------------------------------------------
// Skills that name a target (Exotic Ranged, Exotic Melee, Pilot Exotic Vehicle)
// ---------------------------------------------------------------------------

/**
 * `SheetSkillSchema.target` says "one skill per target, so two exotic weapons
 * are two rows with one id", and the builder's validator lets both through.
 * Keying the pool by the id alone made the second row overwrite the first, so
 * a runner with two exotic weapons had one pool — whichever row came last.
 */
describe('a skill row with a target gets a pool of its own', () => {
  const sheet = makeSheet({
    skills: [
      { id: 'exotic-ranged-weapon', rating: 4, attr: 'agi', target: 'Dart pistol' },
      { id: 'exotic-ranged-weapon', rating: 1, attr: 'agi', target: 'Blowgun' },
      { id: 'perception', rating: 3, attr: 'int' },
    ],
  });

  it('gives each target its own key and its own number', () => {
    const d = deriveCharacter(sheet);
    expect(d.pools['skill.exotic-ranged-weapon::dart-pistol']?.total).toBe(5 + 4);
    expect(d.pools['skill.exotic-ranged-weapon::blowgun']?.total).toBe(5 + 1);
    // The bare key is not claimed by either row, so nothing reads one row's
    // number for the other.
    expect(d.pools['skill.exotic-ranged-weapon']).toBeUndefined();
    // An untargeted skill keeps the key everything already reads.
    expect(d.pools['skill.perception']?.total).toBe(4 + 3);
  });

  it('exposes the key builder so every reader spells it the same way', () => {
    expect(skillPoolKey('exotic-ranged-weapon', 'Dart pistol')).toBe(
      'skill.exotic-ranged-weapon::dart-pistol',
    );
    expect(skillPoolKey('perception')).toBe('skill.perception');
    expect(skillPoolKey('perception', '   ')).toBe('skill.perception');
  });

  it('takes a modifier aimed at the pair, and one aimed at the skill for every target', () => {
    const d = deriveCharacter(sheet, {
      situational: [
        mod({ target: 'pool.skill.exotic-ranged-weapon::dart-pistol', value: 2, source: { kind: 'power' } }),
      ],
    });
    expect(d.pools['skill.exotic-ranged-weapon::dart-pistol']?.total).toBe(5 + 4 + 2);
    expect(d.pools['skill.exotic-ranged-weapon::blowgun']?.total).toBe(5 + 1);

    const both = deriveCharacter(sheet, {
      situational: [mod({ target: 'pool.skill.exotic-ranged-weapon', value: 1, source: { kind: 'power' } })],
    });
    expect(both.pools['skill.exotic-ranged-weapon::dart-pistol']?.total).toBe(5 + 4 + 1);
    expect(both.pools['skill.exotic-ranged-weapon::blowgun']?.total).toBe(5 + 1 + 1);
  });
});
