import { describe, expect, it } from 'vitest';
import type { SheetWeapon } from '@safehouse/contracts';
import { parseDamageCode, resolveAttackChain, type CombatActor } from '../src/index.js';
import { forcedRoll, monitors, mulberry32 } from './combat-helpers.js';

const predatorish: SheetWeapon = {
  name: 'Test Heavy Pistol',
  skillId: 'pistols',
  acc: 5,
  dv: '8P',
  ap: -1,
  modes: ['SA'],
  rangeCat: 'heavy_pistol',
};

function samurai(over: Partial<CombatActor> = {}): CombatActor {
  return { attributes: { bod: 5, rea: 5, int: 4, str: 6, wil: 4 }, attackPool: 12, armor: 12, ...over };
}

function ganger(over: Partial<CombatActor> = {}): CombatActor {
  return {
    attributes: { bod: 3, rea: 3, int: 3, str: 3, wil: 3 },
    attackPool: 7,
    armor: 9,
    monitors: monitors({ overflow: { max: 3 } }),
    ...over,
  };
}

describe('parseDamageCode', () => {
  it('reads plain, tagged, and STR-based codes', () => {
    expect(parseDamageCode('8P')).toMatchObject({ value: 8, type: 'P' });
    expect(parseDamageCode('10S(e)')).toMatchObject({ value: 10, type: 'S', tag: '(e)' });
    expect(parseDamageCode('(STR+2)P', 5)).toMatchObject({ value: 7, type: 'P' });
    expect(parseDamageCode('STR-1S', 4)).toMatchObject({ value: 3, type: 'S' });
    expect(parseDamageCode('gibberish')).toBeNull();
  });
});

describe('resolveAttackChain (FR10.8)', () => {
  it('runs end-to-end with forced rolls: net hits -> DV -> soak -> boxes -> monitor', () => {
    const result = resolveAttackChain(samurai(), ganger(), predatorish, mulberry32(1), {
      rolls: {
        attack: forcedRoll(5, 4), // accuracy 5 not binding here; forced limited 4
        defense: forcedRoll(2),
        soak: forcedRoll(3),
      },
    });

    expect(result.attack.pool).toBe(12);
    expect(result.attack.limit).toEqual({ kind: 'accuracy', value: 5 });
    expect(result.defense.pool).toBe(6); // REA 3 + INT 3
    expect(result.netHits).toBe(2);
    expect(result.outcome).toBe('hit');

    expect(result.damage).toMatchObject({
      modifiedDv: 10, // 8P + 2 net
      armor: 9,
      ap: -1,
      modifiedArmor: 8,
      type: 'P',
      convertedToStun: false,
    });
    expect(result.soak?.pool).toBe(11); // BOD 3 + armor 9 + AP -1
    expect(result.soak?.boxes).toBe(7); // 10 - 3 soak hits
    expect(result.soak?.track).toBe('physical');

    // FR4.5: boxes land, wounds recompute.
    expect(result.applied?.monitors.physical.filled).toBe(7);
    expect(result.applied?.woundModifier.delta).toBe(-2);
  });

  it('is deterministic under a seeded rng and internally consistent', () => {
    const run = () => resolveAttackChain(samurai(), ganger(), predatorish, mulberry32(99));
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.attack.roll.faces).toHaveLength(12);
    expect(a.netHits).toBe(a.attack.roll.limitedHits - a.defense.roll.hits);
    if (a.outcome === 'hit' && a.damage && a.soak) {
      expect(a.damage.modifiedDv).toBe(8 + a.netHits);
      expect(a.soak.boxes).toBe(Math.max(0, a.damage.modifiedDv - a.soak.roll.hits));
    }
  });

  it('ties go to the defender', () => {
    const result = resolveAttackChain(samurai(), ganger(), predatorish, mulberry32(2), {
      rolls: { attack: forcedRoll(3), defense: forcedRoll(3) },
    });
    expect(result.netHits).toBe(0);
    expect(result.outcome).toBe('miss');
    expect(result.damage).toBeUndefined();
    expect(result.applied).toBeUndefined();
  });

  it('converts to Stun when modified DV does not beat modified armor (§10.2)', () => {
    const lightGun: SheetWeapon = { ...predatorish, dv: '6P', ap: -2 };
    const armored = ganger({ armor: 12 });
    const result = resolveAttackChain(samurai(), armored, lightGun, mulberry32(3), {
      rolls: { attack: forcedRoll(1), defense: forcedRoll(0), soak: forcedRoll(0) },
    });
    // DV 6+1=7 vs armor 12-2=10 -> Stun
    expect(result.damage?.convertedToStun).toBe(true);
    expect(result.damage?.type).toBe('S');
    expect(result.soak?.track).toBe('stun');
    expect(result.applied?.monitors.stun.filled).toBe(7);
    expect(result.applied?.monitors.physical.filled).toBe(0);
  });

  it('full defense adds WIL to the defense pool', () => {
    const result = resolveAttackChain(samurai(), ganger(), predatorish, mulberry32(4), {
      fullDefense: true,
      rolls: { attack: forcedRoll(0), defense: forcedRoll(0) },
    });
    expect(result.defense.pool).toBe(9); // REA 3 + INT 3 + WIL 3
    expect(result.defense.fullDefense).toBe(true);
  });

  it('applies wound modifiers and situational mods to the pools', () => {
    const hurtAttacker = samurai({ woundModifier: -2 });
    const hurtDefender = ganger({ woundModifier: -1 });
    const result = resolveAttackChain(hurtAttacker, hurtDefender, predatorish, mulberry32(5), {
      attackModifiers: [
        { label: 'Range: medium', value: -1, source: 'range' },
        { label: 'Dim light', value: -1, source: 'scene' },
      ],
      rolls: { attack: forcedRoll(0), defense: forcedRoll(0) },
    });
    expect(result.attack.pool).toBe(8); // 12 - 2 wounds - 2 situational
    expect(result.defense.pool).toBe(5); // 6 - 1 wounds
    expect(result.attack.breakdown.map((e) => e.label)).toContain('Wounds');
  });

  it('asks for manual DV when the code is unreadable, but supports overrides', () => {
    const oddWeapon: SheetWeapon = { ...predatorish, dv: 'special' };
    const unread = resolveAttackChain(samurai(), ganger(), oddWeapon, mulberry32(6), {
      rolls: { attack: forcedRoll(3), defense: forcedRoll(0) },
    });
    expect(unread.outcome).toBe('hit');
    expect(unread.damage).toBeUndefined();
    expect(unread.notes.join(' ')).toMatch(/manual/i);

    const overridden = resolveAttackChain(samurai(), ganger(), oddWeapon, mulberry32(6), {
      dvOverride: { value: 9, type: 'S' },
      rolls: { attack: forcedRoll(3), defense: forcedRoll(0), soak: forcedRoll(2) },
    });
    expect(overridden.damage?.modifiedDv).toBe(12);
    expect(overridden.soak?.track).toBe('stun');
  });

  it('melee: STR-based DV uses the attacker STR', () => {
    const blade: SheetWeapon = {
      name: 'Test Blade',
      skillId: 'blades',
      acc: 6,
      dv: '(STR+2)P',
      ap: -2,
      modes: [],
    };
    const result = resolveAttackChain(samurai(), ganger(), blade, mulberry32(7), {
      rolls: { attack: forcedRoll(4), defense: forcedRoll(1), soak: forcedRoll(2) },
    });
    expect(result.damage?.base.value).toBe(8); // STR 6 + 2
    expect(result.damage?.modifiedDv).toBe(11);
  });

  it('fully soaked hits land zero boxes and apply nothing', () => {
    const result = resolveAttackChain(samurai(), ganger(), predatorish, mulberry32(8), {
      rolls: { attack: forcedRoll(1), defense: forcedRoll(0), soak: forcedRoll(12) },
    });
    expect(result.soak?.boxes).toBe(0);
    expect(result.applied).toBeUndefined();
    expect(result.notes.join(' ')).toMatch(/soaked/i);
  });
});
