import { describe, expect, it } from 'vitest';
import {
  SheetV1Schema,
  type Modifier,
  type RangeTables,
  type SceneEnvironment,
  type SheetV1,
} from '@safehouse/contracts';
import {
  deriveCharacter,
  environment,
  environmentCompensationFor,
  environmentLookup,
  foldEnvironment,
  rangeInEnvironment,
  rangeModifier,
} from '../src/index.js';

function scene(over: Partial<SceneEnvironment> = {}): SceneEnvironment {
  return { light: 0, visibility: 0, glare: 0, wind: 0, ...over };
}

describe('environment (FR9.11, §10.2)', () => {
  it('clear conditions emit no modifier', () => {
    expect(environment(scene())).toEqual([]);
  });

  it('maps single-axis tiers to −1 / −3 / −6', () => {
    expect(environment(scene({ light: 1 }))[0]?.value).toBe(-1);
    expect(environment(scene({ visibility: 2 }))[0]?.value).toBe(-3);
    expect(environment(scene({ wind: 3 }))[0]?.value).toBe(-6);
  });

  it('uses the single worst axis when levels differ', () => {
    const [m] = environment(scene({ light: 3, visibility: 1, glare: 1 }));
    expect(m?.value).toBe(-6);
  });

  it('escalates one tier when two columns share the worst row', () => {
    expect(environment(scene({ light: 2, visibility: 2 }))[0]?.value).toBe(-6);
    expect(environment(scene({ light: 3, wind: 3 }))[0]?.value).toBe(-10);
  });

  it('reads glare in the light column, so light and glare never tie (p.175)', () => {
    expect(environment(scene({ light: 1, glare: 1 }))[0]?.value).toBe(-1);
    expect(environment(scene({ light: 1, glare: 3 }))[0]?.value).toBe(-6);
  });

  it('caps at −10 even with every axis maxed', () => {
    const [m] = environment(scene({ light: 3, visibility: 3, glare: 3, wind: 3 }));
    expect(m?.value).toBe(-10);
  });

  it('emits a well-formed scene Modifier aimed at pool.all, carrying its rows', () => {
    const [m] = environment(scene({ light: 2 }));
    expect(m).toMatchObject({
      source: { kind: 'scene' },
      target: 'pool.all',
      op: 'add',
      active: true,
      env: { light: 2 },
    });
    expect(m?.note).toBe('environment: dim light -3');
  });
});

describe('environmentLookup: one read of the p.175 table', () => {
  it('the pistol example: dim light and medium range cost −3, not −4', () => {
    expect(environmentLookup({ light: 2, range: 1 }).value).toBe(-3);
  });

  it("p.176's Wombat: two conditions tied at −3 go a row worse", () => {
    const look = environmentLookup({ visibility: 1, light: 2, wind: 2, range: 1 });
    expect(look.tied).toBe(2);
    expect(look.value).toBe(-6);
  });

  it('…and his thermographic, smartlink and image magnification bring it to −3', () => {
    const look = environmentLookup(
      { visibility: 1, light: 2, wind: 2, range: 1 },
      { compensation: { thermographic: true, smartlink: true, imageMagnification: true } },
    );
    expect(look.rows).toEqual({ visibility: 0, light: 1, wind: 1, range: 0 });
    expect(look.value).toBe(-3);
    expect(look.note).toContain('(thermographic)');
  });

  it("p.176's Full Deck: extreme range is −6, magnified to long it is −3", () => {
    expect(environmentLookup({ range: 3 }).value).toBe(-6);
    expect(environmentLookup({ range: 3 }, { compensation: { imageMagnification: true } }).value).toBe(-3);
  });

  it('low-light clears partial and dim light but not darkness, and not glare', () => {
    const lowLight = { compensation: { lowLight: true } };
    expect(environmentLookup({ light: 2 }, lowLight).value).toBe(0);
    expect(environmentLookup({ light: 3 }, lowLight).value).toBe(-6);
    expect(environmentLookup({ glare: 2 }, lowLight).value).toBe(-3);
  });

  it('two conditions tied at −6 make −10', () => {
    expect(environmentLookup({ light: 3, range: 3 }).value).toBe(-10);
  });

  it('melee and sight tests read only the visibility and light columns', () => {
    expect(environmentLookup({ light: 1, wind: 3, range: 3 }, { columns: ['visibility', 'light'] }).value).toBe(-1);
  });
});

describe('the scene and the range band fold into one line', () => {
  const tables: RangeTables = { heavy_pistol: [5, 20, 40, 60] };
  const medium = rangeModifier(10, 'heavy_pistol', tables)!;

  function sheet(over: Record<string, unknown> = {}): SheetV1 {
    return SheetV1Schema.parse({
      v: 1,
      identity: { alias: 'Shooter' },
      attributes: { bod: 4, agi: 5, rea: 4, str: 3, wil: 4, log: 3, int: 4, cha: 2, edg: { max: 3, current: 3 } },
      skills: [
        { id: 'pistols', rating: 4, attr: 'agi' },
        { id: 'perception', rating: 3, attr: 'int' },
      ],
      weapons: [{ name: 'Ultra-Power', skillId: 'pistols', rangeCat: 'heavy_pistol' }],
      ...over,
    });
  }
  /** The range band as the roll dialog sends it: a chip aimed at the weapon's pool. */
  const chip = (m: Modifier): Modifier => ({ ...m, target: 'pool.weapon.Ultra-Power' });

  it('a weapon pool in dim light at medium range takes −3 on one line', () => {
    const d = deriveCharacter(sheet(), {
      situational: [...environment(scene({ light: 2 })), chip(medium)],
    });
    const pool = d.pools['weapon.Ultra-Power']!;
    expect(pool.total).toBe(9 - 3);
    const env = pool.breakdown.filter((e) => e.source === 'scene' || e.source === 'range');
    expect(env).toHaveLength(1);
    expect(env[0]).toMatchObject({ value: -3, env: { light: 2, range: 1 } });
    expect(env[0]?.label).toContain('medium range');
  });

  it('a range chip from before modifiers carried rows folds by its value', () => {
    const legacy: Modifier = chip(medium);
    delete legacy.env;
    const d = deriveCharacter(sheet(), { situational: [...environment(scene({ light: 2 })), legacy] });
    expect(d.pools['weapon.Ultra-Power']?.total).toBe(9 - 3);
  });

  it("the character's eyes are read before the worst row is picked", () => {
    const troll = sheet({ identity: { alias: 'Slab', metatype: 'troll' } });
    expect(environmentCompensationFor(troll)).toEqual({ thermographic: true });
    const d = deriveCharacter(troll, { situational: environment(scene({ light: 2 })) });
    // Thermographic takes dim light (−3) to partial (−1).
    expect(d.pools['skill.perception']?.total).toBe(7 - 1);
  });

  it('a smartlink steadies the gun in the wind and nothing else', () => {
    const linked = sheet({ augments: [{ name: 'Smartlink', essence: 0.2 }] });
    const d = deriveCharacter(linked, { situational: environment(scene({ wind: 2 })) });
    expect(d.pools['weapon.Ultra-Power']?.total).toBe(9 - 1);
    expect(d.pools['skill.perception']?.total).toBe(7 - 3);
  });

  it('a lone band on a clear night keeps its own line', () => {
    expect(foldEnvironment([medium])).toMatchObject({ label: medium.note, value: -1, source: 'range' });
  });

  it('prices a band against the environment line a pool already carries', () => {
    const dim = { label: 'environment: dim light -3', value: -3, source: 'scene', env: { light: 2 } };
    expect(rangeInEnvironment([dim], { range: 1 })).toMatchObject({ value: 0, combined: -3, folded: true });
    const partial = { label: 'environment: partial light -1', value: -1, source: 'scene', env: { light: 1 } };
    // Two conditions tied at −1: −3 in all, so the band costs −2 more.
    expect(rangeInEnvironment([partial], { range: 1 })).toMatchObject({ value: -2, combined: -3 });
    expect(rangeInEnvironment([], { range: 1 })).toMatchObject({ value: -1, folded: false });
  });
});

describe('rangeModifier (FR9.9, §10.2)', () => {
  const tables: RangeTables = { assault_rifle: [25, 150, 350, 550], pistol: [5, 15, 30, 50] };

  it('short/medium/long/extreme map to 0/−1/−3/−6', () => {
    expect(rangeModifier(10, 'assault_rifle', tables)?.value).toBe(0);
    expect(rangeModifier(100, 'assault_rifle', tables)?.value).toBe(-1);
    expect(rangeModifier(300, 'assault_rifle', tables)?.value).toBe(-3);
    expect(rangeModifier(500, 'assault_rifle', tables)?.value).toBe(-6);
  });

  it('band edges are inclusive upper bounds', () => {
    expect(rangeModifier(25, 'assault_rifle', tables)?.value).toBe(0);
    expect(rangeModifier(26, 'assault_rifle', tables)?.value).toBe(-1);
    expect(rangeModifier(150, 'assault_rifle', tables)?.value).toBe(-1);
    expect(rangeModifier(151, 'assault_rifle', tables)?.value).toBe(-3);
    expect(rangeModifier(350, 'assault_rifle', tables)?.value).toBe(-3);
    expect(rangeModifier(351, 'assault_rifle', tables)?.value).toBe(-6);
    expect(rangeModifier(550, 'assault_rifle', tables)?.value).toBe(-6);
  });

  it('returns null beyond extreme, for unknown categories, and negative distances', () => {
    expect(rangeModifier(551, 'assault_rifle', tables)).toBeNull();
    expect(rangeModifier(10, 'sniper_rifle', tables)).toBeNull();
    expect(rangeModifier(-1, 'pistol', tables)).toBeNull();
  });

  it('emits a range Modifier aimed at pool.all with the category as ref and its row', () => {
    const m = rangeModifier(20, 'pistol', tables);
    expect(m).toMatchObject({
      source: { kind: 'range', ref: 'pistol' },
      target: 'pool.all',
      op: 'add',
      value: -3,
      active: true,
      env: { range: 2 },
    });
    expect(m?.note).toContain('long');
  });
});
