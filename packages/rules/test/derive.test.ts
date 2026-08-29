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
  dedupeSceneModifiers,
  deriveCharacter,
  environment,
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
    const m3 = mod({ target: 'attr.rea', op: 'set', value: 6, note: 'c' });
    const forward = deriveCharacter(
      makeSheet({ augments: [{ name: 'X', essence: 0, mods: [m1, m2, m3] }] }),
    );
    const reversed = deriveCharacter(
      makeSheet({ augments: [{ name: 'X', essence: 0, mods: [m3, m2, m1] }] }),
    );
    expect(forward.attributes['rea']?.value).toBe(reversed.attributes['rea']?.value);
    expect(forward.attributes['rea']?.value).toBe(9); // set 6, then +1+2
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
