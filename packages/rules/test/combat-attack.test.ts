import { describe, expect, it } from 'vitest';
import type { SheetWeapon } from '@safehouse/contracts';
import {
  boxesAfterSoak,
  bulletsForMode,
  damageAfterHit,
  defensePool,
  parseDamageCode,
  recoilCompensation,
  recoilLine,
  resolveAttackChain,
  resolveHit,
  soakPool,
  type CombatActor,
} from '../src/index.js';
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

  it('a tie is a grazing hit: contact, but no damage (SR5 p.173)', () => {
    const result = resolveAttackChain(samurai(), ganger(), predatorish, mulberry32(2), {
      rolls: { attack: forcedRoll(3), defense: forcedRoll(3) },
    });
    expect(result.netHits).toBe(0);
    expect(result.outcome).toBe('graze');
    expect(result.damage).toBeUndefined();
    expect(result.applied).toBeUndefined();
    expect(result.notes.join(' ')).toMatch(/graz/i);
  });

  it('a Block brings the Physical limit: 7 hits count as 5 (SR5 p.191, Wombat and the troll)', () => {
    // Wombat is on Full Defense and Blocks the troll's 3-hit punch. He rolls
    // 7 hits, his Physical limit keeps 5 — still enough to avoid it.
    const wombat = ganger({ physicalLimit: 5 });
    const result = resolveAttackChain(samurai(), wombat, predatorish, mulberry32(9), {
      fullDefense: true,
      activeDefense: { id: 'block', rating: 4 },
      rolls: { attack: forcedRoll(3), defense: forcedRoll(7, 5) },
    });
    expect(result.defense.limit).toEqual({ kind: 'physical', value: 5 });
    expect(result.defense.active).toBe('block');
    expect(result.defense.pool).toBe(3 + 3 + 3 + 4); // REA + INT + WIL + Unarmed Combat
    expect(result.netHits).toBe(-2);
    expect(result.outcome).toBe('miss');
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

  it('stays Physical when the modified DV equals the modified armor (SR5 p.173: greater than OR equal)', () => {
    const lightGun: SheetWeapon = { ...predatorish, dv: '6P', ap: -2 };
    const armored = ganger({ armor: 12 });
    // DV 6+4=10 vs armor 12-2=10 -> Physical, not Stun.
    const result = resolveAttackChain(samurai(), armored, lightGun, mulberry32(3), {
      rolls: { attack: forcedRoll(4), defense: forcedRoll(0), soak: forcedRoll(0) },
    });
    expect(result.damage?.convertedToStun).toBe(false);
    expect(result.damage?.type).toBe('P');
    expect(result.soak?.track).toBe('physical');
  });

  it('AP that would raise armor does nothing to a target wearing none (SR5 p.169)', () => {
    const shotgun: SheetWeapon = { ...predatorish, dv: '9P', ap: 2 };
    const bare = ganger({ armor: 0 });
    const result = resolveAttackChain(samurai(), bare, shotgun, mulberry32(4), {
      rolls: { attack: forcedRoll(1), defense: forcedRoll(0), soak: forcedRoll(0) },
    });
    expect(result.damage?.modifiedArmor).toBe(0);
    // Soak is Body alone.
    expect(result.soak?.pool).toBe(bare.attributes.bod);
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

// ---------------------------------------------------------------------------
// The exchange as separate steps, walked through the book's own examples
// ---------------------------------------------------------------------------

describe('the exchange steps (SR5 p.174 ranged example: Wombat shoots Cutter)', () => {
  // Browning Ultra-Power 8P, AP −1, Accuracy 6. Wombat rolls 9 dice for 4 hits.
  const cutter: CombatActor = { attributes: { bod: 3, rea: 3, int: 3, str: 3 }, armor: 12 };

  it('Cutter defends with REA 3 + INT 3 − 1, no limit, and 2 hits leave 2 net hits', () => {
    const defense = defensePool(cutter, {
      modifiers: [{ label: 'situational', value: -1 }],
    });
    expect(defense.pool).toBe(5);
    expect(defense.limit).toBeUndefined(); // no skill, no limit
    expect(resolveHit(4, 2)).toEqual({ netHits: 2, outcome: 'hit' });
  });

  it('10P against armor 12 − 1 = 11 becomes 10S; Body 3 + 11 soaks 5 of it', () => {
    const damage = damageAfterHit({ base: parseDamageCode('8P')!, netHits: 2, armor: 12, ap: -1 });
    expect(damage).toMatchObject({ modifiedDv: 10, modifiedArmor: 11, type: 'S', convertedToStun: true });

    const soak = soakPool(cutter, { ap: -1 });
    expect(soak.pool).toBe(14);
    expect(soak.breakdown.map((l) => [l.label, l.value])).toEqual([
      ['BOD', 3],
      ['Armor', 12],
      ['AP', -1],
    ]);
    expect(boxesAfterSoak(damage, 5)).toEqual({ boxes: 5, track: 'stun' });
  });
});

describe('the exchange steps (SR5 p.174 melee example: Cutter slashes Wombat)', () => {
  // Hand razors (STR + 1)P, AP −3; Cutter STR 3. 8 hits against his
  // Physical limit of 6. Wombat: REA 4, INT 3, BOD 6, lined coat 9.
  const wombat: CombatActor = { attributes: { bod: 6, rea: 4, int: 3 }, armor: 9 };

  it('the limit comes off before the comparison: 6 of 8 hits against 2 is 4 net', () => {
    const defense = defensePool(wombat, { modifiers: [{ label: 'situational', value: -1 }] });
    expect(defense.pool).toBe(6);
    expect(resolveHit(Math.min(8, 6), 2)).toEqual({ netHits: 4, outcome: 'hit' });
  });

  it('8P against armor 9 − 3 = 6 stays Physical; Body 6 + 6 soaks 3, 5 boxes land', () => {
    const base = parseDamageCode('(STR+1)P', 3)!;
    expect(base.value).toBe(4);
    const damage = damageAfterHit({ base, netHits: 4, armor: 9, ap: -3 });
    expect(damage).toMatchObject({ modifiedDv: 8, modifiedArmor: 6, type: 'P', convertedToStun: false });
    expect(soakPool(wombat, { ap: -3 }).pool).toBe(12);
    expect(boxesAfterSoak(damage, 3)).toEqual({ boxes: 5, track: 'physical' });
  });
});

describe('defensePool', () => {
  const runner: CombatActor = {
    attributes: { bod: 4, rea: 5, int: 4, str: 4, wil: 3 },
    woundModifier: -1,
  };

  it('Full Defense adds WIL; the free test and Full Defense alone have no limit (p.168)', () => {
    const plain = defensePool(runner);
    expect(plain.pool).toBe(8); // 5 + 4 − 1 wounds
    const full = defensePool(runner, { fullDefense: true });
    expect(full.pool).toBe(11);
    expect(full.fullDefense).toBe(true);
    expect(full.limit).toBeUndefined();
    expect(full.breakdown.find((l) => l.label === 'WIL (Full Defense)')?.ref?.page).toBe(168);
  });

  it('Dodge adds Gymnastics with the Physical limit, worked out when the sheet gave none', () => {
    const dodge = defensePool(runner, { active: { id: 'dodge', rating: 3 } });
    expect(dodge.pool).toBe(11);
    expect(dodge.active).toBe('dodge');
    // ⌈(STR 4 × 2 + BOD 4 + REA 5) / 3⌉ = 6
    expect(dodge.limit).toEqual({ kind: 'physical', value: 6 });
    const line = dodge.breakdown.find((l) => l.label === 'Gymnastics (Dodge)');
    expect(line?.value).toBe(3);
    expect(line?.ref?.page).toBe(168);
  });

  it('Parry names the weapon skill, stacks with Full Defense and keeps the sheet limit', () => {
    const parry = defensePool(
      { ...runner, physicalLimit: 7 },
      { fullDefense: true, active: { id: 'parry', rating: 5, skill: 'Blades' } },
    );
    expect(parry.pool).toBe(5 + 4 + 3 + 5 - 1);
    expect(parry.limit).toEqual({ kind: 'physical', value: 7 });
    expect(parry.breakdown.map((l) => l.label)).toContain('Blades (Parry)');
  });
});

describe('resolveHit (p.173)', () => {
  it('more hits is a hit, a tie a graze, fewer a miss', () => {
    expect(resolveHit(5, 2)).toEqual({ netHits: 3, outcome: 'hit' });
    expect(resolveHit(3, 3)).toEqual({ netHits: 0, outcome: 'graze' });
    expect(resolveHit(1, 4)).toEqual({ netHits: -3, outcome: 'miss' });
  });

  it('nothing against nothing is a miss: no hits, no contact', () => {
    expect(resolveHit(0, 0)).toEqual({ netHits: 0, outcome: 'miss' });
  });
});

describe('soakPool (p.169-170)', () => {
  it('SR5 p.170: Pauly G rolls Body 9 + Armor 1, and 4 hits take 13P down to 9', () => {
    const soak = soakPool({ attributes: { bod: 9, rea: 0, int: 0 }, armor: 1 });
    expect(soak.pool).toBe(10);
    expect(boxesAfterSoak({ modifiedDv: 13, type: 'P' }, 4)).toEqual({ boxes: 9, track: 'physical' });
  });

  it('AP past the armor leaves Body alone, and never subtracts from it', () => {
    const soak = soakPool({ attributes: { bod: 4, rea: 0, int: 0 }, armor: 3 }, { ap: -6 });
    expect(soak.modifiedArmor).toBe(0);
    expect(soak.pool).toBe(4);
    expect(soak.breakdown.find((l) => l.label === 'AP')?.value).toBe(-3);
  });

  it('AP that would raise armor does nothing on bare skin', () => {
    const soak = soakPool({ attributes: { bod: 2, rea: 0, int: 0 }, armor: 0 }, { ap: 2 });
    expect(soak.pool).toBe(2);
    expect(soak.breakdown.some((l) => l.label === 'AP')).toBe(false);
  });

  it('has no wound line, however hurt the defender is', () => {
    const hurt: CombatActor = { attributes: { bod: 5, rea: 0, int: 0 }, armor: 9, woundModifier: -3 };
    const soak = soakPool(hurt);
    expect(soak.pool).toBe(14);
    expect(soak.breakdown.some((l) => l.label === 'Wounds')).toBe(false);
  });
});

describe('damageAfterHit', () => {
  it('a Stun attack stays Stun, and equal DV and armor stays Physical', () => {
    expect(damageAfterHit({ base: parseDamageCode('6S')!, netHits: 1, armor: 12, ap: 0 }).type).toBe('S');
    const even = damageAfterHit({ base: parseDamageCode('7P')!, netHits: 2, armor: 9, ap: 0 });
    expect(even).toMatchObject({ modifiedDv: 9, modifiedArmor: 9, type: 'P', convertedToStun: false });
  });
});

describe('recoil (p.175-176, 180)', () => {
  it('rounds per mode come from the Firing Mode Table: SA is one round, not two', () => {
    expect(bulletsForMode('SS')).toBe(1);
    expect(bulletsForMode('sa')).toBe(1);
    expect(bulletsForMode('BF')).toBe(3);
    expect(bulletsForMode('FA')).toBe(6);
    expect(bulletsForMode('SA/BF')).toBe(1);
    expect(bulletsForMode(null)).toBe(1);
  });

  it('compensation is 1 free + STR ÷ 3 rounded up + the gun, and the line says so', () => {
    expect(recoilCompensation(1, 4)).toBe(1 + 2 + 1);
    // A burst from STR 3, RC 0: 3 rounds against RC 2.
    const line = recoilLine({ mode: 'BF', bullets: 3, recoilComp: 0, strength: 3 });
    expect(line).toMatchObject({ value: -1, label: 'recoil (3 rounds vs RC 2)' });
    expect(line?.ref?.page).toBe(175);
    // Covered: STR 4, RC 1 absorbs a three-round burst.
    expect(recoilLine({ mode: 'BF', bullets: 3, recoilComp: 1, strength: 4 })).toBeNull();
    // Progressive: a second burst the same turn.
    expect(recoilLine({ mode: 'BF', bullets: 3, firedSoFar: 3, recoilComp: 1, strength: 4 })?.value).toBe(-2);
  });

  it('single shot never recoils', () => {
    expect(recoilLine({ mode: 'SS', bullets: 1, firedSoFar: 9 })).toBeNull();
  });
});
