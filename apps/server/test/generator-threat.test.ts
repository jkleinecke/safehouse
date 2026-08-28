/**
 * M10 threat readout suite (FR10.5/10.6). Two ORIGINAL hand-built sheets — one
 * PC, one opposition — with every number checked against a hand calculation:
 *
 *   Static (PC)     BOD 4 AGI 5 REA 5 INT 4 | automatics 5 | Machine Pistol 8P AP 0
 *                   armor 9  → defense REA+INT = 9, soak BOD+armor = 13,
 *                   weapon pool AGI+skill = 10, init base 9 +1d6
 *   Enforcer (NPC)  BOD 5 AGI 6 REA 4 INT 3 | firearms 6 | Heavy Pistol 8P AP -2
 *                   armor 12 → defense 7, soak 17, weapon pool 12, init base 7 +1d6
 *
 * Enforcer → Static: 12 vs 9 → 4 − 3 = 1 net → DV 8+1 = 9 vs soak 4+max(0,9−2)=11
 *                    → 11/3 = 3.667 soak hits → ~5.333 boxes per connect.
 * Static → Enforcer: 10 vs 7 → 3.333 − 2.333 = 1 net → DV 9 vs soak 5+12 = 17
 *                    → 5.667 soak hits → ~3.333 boxes per connect.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { characters, combatants, encounters } from '@safehouse/db';
import type { SheetV1 } from '@safehouse/contracts';
import { bootstrapCampaign, makeTestApp, type TestApp } from './core-helpers.js';

function sheet(opts: {
  alias: string;
  bod: number;
  agi: number;
  rea: number;
  int: number;
  skill: { id: string; rating: number };
  weapon: { name: string; dv: string; ap: number };
  armor: { name: string; rating: number };
}): SheetV1 {
  return {
    v: 1,
    identity: { alias: opts.alias, metatype: 'human', portraitId: null },
    attributes: {
      bod: opts.bod,
      agi: opts.agi,
      rea: opts.rea,
      str: 3,
      wil: 3,
      log: 3,
      int: opts.int,
      cha: 3,
      edg: { max: 3, current: 3 },
      ess: 6,
      mag: 0,
      res: 0,
    },
    skills: [{ id: opts.skill.id, rating: opts.skill.rating, attr: 'agi' }],
    qualities: [],
    augments: [],
    weapons: [
      {
        name: opts.weapon.name,
        skillId: opts.skill.id,
        dv: opts.weapon.dv,
        ap: opts.weapon.ap,
        modes: [],
      },
    ],
    armor: [{ name: opts.armor.name, rating: opts.armor.rating, worn: true }],
    spells: [],
    powers: [],
    complexForms: [],
    matrix: {},
    gear: [],
    lifestyles: [],
    rangeTables: {},
    overrides: [],
  };
}

const STATIC_SHEET = sheet({
  alias: 'Static',
  bod: 4,
  agi: 5,
  rea: 5,
  int: 4,
  skill: { id: 'automatics', rating: 5 },
  weapon: { name: 'Machine Pistol', dv: '8P', ap: 0 },
  armor: { name: 'Lined Coat', rating: 9 },
});

const ENFORCER_SHEET = sheet({
  alias: 'Enforcer',
  bod: 5,
  agi: 6,
  rea: 4,
  int: 3,
  skill: { id: 'firearms', rating: 6 },
  weapon: { name: 'Heavy Pistol', dv: '8P', ap: -2 },
  armor: { name: 'Armor Jacket', rating: 12 },
});

interface ThreatUnitDto {
  id: string;
  name: string;
  side: string;
  bodies: number;
  defense: number;
  soak: number;
  armor: number;
  initiative: { base: number; dice: number; estScore: number; estPasses: number };
  attacks: Array<{ weapon: string; pool: number; dv: string; ap: number }>;
}

interface ThreatRowDto {
  attackerName: string;
  attackPool: number;
  weapon: string;
  targets: Array<{
    defenderName: string;
    defensePool: number;
    soakPool: number;
    estimate: {
      attackHits: number;
      defenseHits: number;
      netHits: number;
      connects: boolean;
      modifiedDv: number;
      soakHits: number;
      boxesPerConnect: number;
      summary: string;
    };
  }>;
}

interface ThreatDto {
  estimate: true;
  method: string;
  party: ThreatUnitDto[];
  opposition: ThreatUnitDto[];
  oppositionVsParty: ThreatRowDto[];
  partyVsOpposition: ThreatRowDto[];
  initiative: {
    party: { bodies: number; avgEstScore: number; estActionsPerTurn: number };
    opposition: { bodies: number; avgEstScore: number; estActionsPerTurn: number };
  };
  actionEconomy: { party: number; opposition: number; note: string };
  warnings: string[];
}

let t: TestApp;
let campaignId: string;
let gmToken: string;
let encounterId: string;

const gm = (): { authorization: string } => ({ authorization: `Bearer ${gmToken}` });

const readout = async (): Promise<ThreatDto> => {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/encounters/${encounterId}/threat`,
    headers: gm(),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as ThreatDto;
};

beforeAll(async () => {
  t = await makeTestApp('generator-threat');
  const boot = await bootstrapCampaign(t.app, 'Threat Table');
  campaignId = boot.campaignId;
  gmToken = boot.gmToken;

  await t.db.insert(characters).values({ campaignId, name: 'Static', sheet: STATIC_SHEET });

  const encounter = (
    await t.db.insert(encounters).values({ campaignId, name: 'Warehouse standoff' }).returning()
  )[0]!;
  encounterId = encounter.id;

  // One solo NPC and one 3-body grunt group sharing the same statblock.
  await t.db.insert(combatants).values([
    {
      encounterId,
      source: 'generated',
      name: 'Enforcer',
      initBase: 7,
      monitors: {
        physical: { max: 11, filled: 0 },
        stun: { max: 10, filled: 0 },
        overflow: { max: 5, filled: 0 },
      },
      visibility: 'gm',
      copilot: { sheet: ENFORCER_SHEET, initDice: 1, generator: { professionalRating: 3 } },
    },
    {
      encounterId,
      source: 'grunt_group',
      name: 'Dock crew x3',
      initBase: 7,
      monitors: {
        physical: { max: 11, filled: 0 },
        stun: { max: 10, filled: 0 },
        overflow: { max: 5, filled: 0 },
      },
      visibility: 'gm',
      copilot: {
        sheet: ENFORCER_SHEET,
        initDice: 1,
        grunt: { size: 3, professionalRating: 2, groupEdge: 0, members: [] },
      },
    },
  ]);
});

afterAll(async () => {
  await t.close();
});

describe('threat readout (FR10.5)', () => {
  it('derives both sides from live sheets with the hand-calculated pools', async () => {
    const body = await readout();
    expect(body.estimate).toBe(true);
    expect(body.method).toMatch(/pool/);

    expect(body.party).toHaveLength(1);
    const pc = body.party[0]!;
    expect(pc.name).toBe('Static');
    expect(pc.defense).toBe(9); // REA 5 + INT 4
    expect(pc.armor).toBe(9);
    expect(pc.soak).toBe(13); // BOD 4 + armor 9
    expect(pc.attacks).toHaveLength(1);
    expect(pc.attacks[0]!.pool).toBe(10); // AGI 5 + automatics 5
    expect(pc.initiative.base).toBe(9);
    expect(pc.initiative.dice).toBe(1);
    expect(pc.initiative.estScore).toBeCloseTo(12.5, 10); // 9 + 3.5
    expect(pc.initiative.estPasses).toBe(2);

    expect(body.opposition).toHaveLength(2);
    const solo = body.opposition.find((u) => u.name === 'Enforcer')!;
    expect(solo.bodies).toBe(1);
    expect(solo.defense).toBe(7); // REA 4 + INT 3
    expect(solo.armor).toBe(12);
    expect(solo.soak).toBe(17); // BOD 5 + armor 12
    expect(solo.attacks[0]!.pool).toBe(12); // AGI 6 + firearms 6
    expect(solo.initiative.estScore).toBeCloseTo(10.5, 10);
    const crew = body.opposition.find((u) => u.name === 'Dock crew x3')!;
    expect(crew.bodies).toBe(3);
  });

  it('matches the hand calc in the opposition → party direction', async () => {
    const body = await readout();
    const row = body.oppositionVsParty.find((r) => r.attackerName === 'Enforcer')!;
    expect(row.attackPool).toBe(12);
    expect(row.weapon).toBe('Heavy Pistol');
    expect(row.targets).toHaveLength(1);
    const cell = row.targets[0]!;
    expect(cell.defenderName).toBe('Static');
    expect(cell.defensePool).toBe(9);
    expect(cell.soakPool).toBe(11); // BOD 4 + max(0, armor 9 + AP -2) = 4 + 7
    expect(cell.estimate.attackHits).toBeCloseTo(4, 10); // 12 / 3
    expect(cell.estimate.defenseHits).toBeCloseTo(3, 10); // 9 / 3
    expect(cell.estimate.netHits).toBeCloseTo(1, 10);
    expect(cell.estimate.connects).toBe(true);
    expect(cell.estimate.modifiedDv).toBeCloseTo(9, 10); // 8P + 1 net
    expect(cell.estimate.soakHits).toBeCloseTo(11 / 3, 10);
    expect(cell.estimate.boxesPerConnect).toBeCloseTo(9 - 11 / 3, 10); // ~5.333
    expect(cell.estimate.summary).toContain('attack 12 vs defense 9');
  });

  it('matches the hand calc in the party → opposition direction', async () => {
    const body = await readout();
    const rows = body.partyVsOpposition.filter((r) => r.attackerName === 'Static');
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.attackPool).toBe(10);
    expect(row.targets).toHaveLength(2); // solo + grunt row
    const cell = row.targets.find((c) => c.defenderName === 'Enforcer')!;
    expect(cell.defensePool).toBe(7);
    expect(cell.soakPool).toBe(17); // AP 0 → BOD 5 + armor 12
    expect(cell.estimate.attackHits).toBeCloseTo(10 / 3, 10);
    expect(cell.estimate.defenseHits).toBeCloseTo(7 / 3, 10);
    expect(cell.estimate.netHits).toBeCloseTo(1, 10);
    expect(cell.estimate.modifiedDv).toBeCloseTo(9, 10);
    expect(cell.estimate.soakHits).toBeCloseTo(17 / 3, 10);
    expect(cell.estimate.boxesPerConnect).toBeCloseTo(9 - 17 / 3, 10); // ~3.333
  });

  it('compares initiative and action economy by bodies x passes', async () => {
    const body = await readout();
    // Party: one PC, est score 12.5 → 2 passes → 2 actions.
    expect(body.initiative.party.bodies).toBe(1);
    expect(body.initiative.party.avgEstScore).toBeCloseTo(12.5, 10);
    expect(body.actionEconomy.party).toBe(2);
    // Opposition: 1 + 3 bodies, all est score 10.5 → 2 passes each → 8 actions.
    expect(body.initiative.opposition.bodies).toBe(4);
    expect(body.initiative.opposition.avgEstScore).toBeCloseTo(10.5, 10);
    expect(body.actionEconomy.opposition).toBe(8);
    expect(body.actionEconomy.note).toMatch(/passes/);
  });

  it('folds live wound state into the party side', async () => {
    const pcRow = (
      await t.db.select().from(characters)
    )[0]!;
    const [wounded] = await t.db
      .insert(combatants)
      .values({
        encounterId,
        source: 'character',
        sourceId: pcRow.id,
        name: 'Static',
        initBase: 9,
        monitors: {
          physical: { max: 10, filled: 6 },
          stun: { max: 10, filled: 0 },
          overflow: { max: 4, filled: 0 },
        },
        visibility: 'public',
      })
      .returning();

    const body = await readout();
    const pc = body.party[0]!;
    // 6 filled physical boxes → −2 wound modifier on pools and initiative.
    expect(pc.defense).toBe(7);
    expect(pc.attacks[0]!.pool).toBe(8);
    expect(pc.soak).toBe(13); // soak is exempt from wound modifiers
    expect(pc.initiative.base).toBe(7);
    expect(body.party).toHaveLength(1); // the PC combatant row is not a second unit

    await t.db.delete(combatants).where(eq(combatants.id, wounded!.id));
  });
});

describe('balance levers (FR10.6)', () => {
  it('recomputes against hypothetical parts without persisting them', async () => {
    const templateRes = await t.app.inject({
      method: 'POST',
      url: `/api/campaigns/${campaignId}/npc-templates`,
      headers: gm(),
      payload: {
        name: 'Dock Crew',
        statblock: {
          weapons: [{ name: 'Snub Revolver', skillId: 'firearms', dv: '7P', ap: 0 }],
          armor: [{ name: 'Dock Vest', rating: 9, worn: true }],
        },
        gen: {
          roleTags: ['muscle'],
          tiers: [
            {
              id: 'street',
              label: 'Street',
              attributes: { bod: { min: 3, max: 4 }, agi: { min: 3, max: 4 } },
              skills: { firearms: { min: 2, max: 3 } },
              professionalRating: { min: 1, max: 2 },
              loadout: [
                { slot: 'primary', options: ['Snub Revolver'] },
                { slot: 'armor', options: ['Dock Vest'] },
              ],
            },
          ],
        },
      },
    });
    expect(templateRes.statusCode).toBe(201);
    const templateId = (templateRes.json() as { template: { id: string } }).template.id;

    const before = await t.db.select().from(combatants);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/encounters/${encounterId}/threat/recompute`,
      headers: gm(),
      payload: {
        parts: [
          { templateId, tierId: 'street', count: 2, seed: 1234 },
          { templateId, tierId: 'street', size: 6, seed: 5678 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ThreatDto;
    // Levers replace the opposition wholesale: 2 solo NPCs + one 6-body squad.
    expect(body.opposition).toHaveLength(3);
    expect(body.initiative.opposition.bodies).toBe(8);
    expect(body.party).toHaveLength(1);
    expect(body.oppositionVsParty.length).toBeGreaterThan(0);
    expect(body.partyVsOpposition[0]!.targets).toHaveLength(3);

    // Nothing was written (the stored encounter is untouched).
    const after = await t.db.select().from(combatants);
    expect(after).toHaveLength(before.length);

    // Same seeds → identical recompute (reroll-identical levers).
    const twice = await t.app.inject({
      method: 'POST',
      url: `/api/encounters/${encounterId}/threat/recompute`,
      headers: gm(),
      payload: {
        parts: [
          { templateId, tierId: 'street', count: 2, seed: 1234 },
          { templateId, tierId: 'street', size: 6, seed: 5678 },
        ],
      },
    });
    expect((twice.json() as ThreatDto).opposition).toEqual(body.opposition);
  });
});
