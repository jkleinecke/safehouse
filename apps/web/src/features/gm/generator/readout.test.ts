import { describe, expect, it } from 'vitest';
import { SheetV1Schema } from '@safehouse/contracts';
import { actionEconomy, estPasses, profileFromSheet, readoutRows, type SideProfile } from './readout.js';

const sheet = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Test Ganger' },
  attributes: {
    bod: 3, agi: 5, rea: 4, str: 2, wil: 4, log: 3, int: 4, cha: 2,
    edg: { max: 3, current: 3 },
  },
  skills: [{ id: 'pistols', rating: 5, attr: 'agi' }],
  weapons: [
    { name: 'Sidearm', skillId: 'pistols', dv: '8P', ap: -1, acc: 5, rangeCat: 'heavy-pistol' },
  ],
  armor: [{ name: 'Jacket', rating: 12, worn: true }],
  rangeTables: { 'heavy-pistol': [5, 20, 40, 60] },
});

function profile(over: Partial<SideProfile>): SideProfile {
  return {
    name: 'X',
    side: 'opposition',
    attackPool: 0,
    attackLabel: '-',
    dv: '0S',
    defensePool: 0,
    soakPool: 0,
    physicalBoxes: 10,
    initEst: 10,
    passesEst: 1,
    bodies: 1,
    ...over,
  };
}

describe('estPasses (FR4.3 −10 loop, estimated)', () => {
  it('one pass at score ≤ 10, two by 12, three by 21', () => {
    expect(estPasses(7)).toBe(1);
    expect(estPasses(10)).toBe(1);
    expect(estPasses(12)).toBe(2);
    expect(estPasses(21)).toBe(3);
    expect(estPasses(0)).toBe(1);
  });
});

describe('profileFromSheet (engine-derived, SR5 core formulas §10.2)', () => {
  it('picks the best weapon pool and carries its DV', () => {
    const p = profileFromSheet('Ganger', 'opposition', sheet);
    expect(p.attackLabel).toBe('Sidearm');
    expect(p.dv).toBe('8P');
    expect(p.attackPool).toBe(10); // AGI 5 + pistols 5
    expect(p.defensePool).toBe(8); // REA 4 + INT 4
    expect(p.soakPool).toBe(15); // BOD 3 + armor 12
    expect(p.physicalBoxes).toBe(10); // 8 + ceil(BOD/2)
  });

  it('estimates initiative passes from base + dice × 3.5', () => {
    const p = profileFromSheet('Ganger', 'opposition', sheet);
    expect(p.initEst).toBeCloseTo(11.5); // REA 4 + INT 4 + 1d6 avg
    expect(p.passesEst).toBe(2);
  });

  it('carries grunt bodies through', () => {
    const p = profileFromSheet('Squad', 'opposition', sheet, { bodies: 4 });
    expect(p.bodies).toBe(4);
  });
});

describe('readoutRows (FR10.5 — the spec example)', () => {
  it('attack 12 vs defense 9 → ~1 net → DV 9P vs soak 15 → ~4 boxes, 3 connects to drop', () => {
    const attacker = profile({ name: 'Sniper', attackPool: 12, dv: '8P' });
    const defender = profile({
      name: 'Static', side: 'party', defensePool: 9, soakPool: 15, physicalBoxes: 10,
    });
    const rows = readoutRows([attacker], [defender]);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.est.netHits).toBeCloseTo(1);
    expect(row.est.modifiedDv).toBeCloseTo(9);
    expect(row.est.boxesPerConnect).toBeCloseTo(4);
    expect(row.connectsToDrop).toBe(3);
  });

  it('an expected miss never drops the defender', () => {
    const attacker = profile({ attackPool: 6, dv: '8P' });
    const defender = profile({ side: 'party', defensePool: 9, soakPool: 20 });
    const row = readoutRows([attacker], [defender])[0]!;
    expect(row.est.connects).toBe(false);
    expect(row.connectsToDrop).toBeNull();
  });

  it('is a full cross product, one direction', () => {
    const a = [profile({ name: 'A1' }), profile({ name: 'A2' })];
    const d = [profile({ name: 'D1', side: 'party' })];
    expect(readoutRows(a, d)).toHaveLength(2);
  });
});

describe('actionEconomy (bodies × passes)', () => {
  it('sums bodies and actions, tracks top initiative', () => {
    const side = [
      profile({ bodies: 4, passesEst: 1, initEst: 9 }),
      profile({ bodies: 1, passesEst: 2, initEst: 14 }),
    ];
    const eco = actionEconomy(side);
    expect(eco.bodies).toBe(5);
    expect(eco.actionsPerTurn).toBe(6); // 4×1 + 1×2
    expect(eco.topInit).toBe(14);
  });
});
