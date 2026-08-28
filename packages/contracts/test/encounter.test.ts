import { describe, expect, it } from 'vitest';
import { CombatantSchema, EncounterSchema, DerivedCharacterSchema } from '../src/index.js';

describe('CombatantSchema', () => {
  it('round-trips a grunt-group row', () => {
    const input = {
      id: 'cbt_1',
      encounterId: 'enc_1',
      tokenId: 'tok_9',
      source: 'grunt_group',
      sourceId: 'grp_1',
      name: 'Dock Gang',
      initBase: 7,
      initDice: 1,
      initScore: 12,
      initKind: 'physical',
      monitors: {
        physical: { max: 10, filled: 3 },
        stun: { max: 10, filled: 0 },
        overflow: { max: 3, filled: 0 },
      },
      effects: [
        {
          id: 'eff_1',
          name: 'suppressed',
          mods: [
            {
              id: 'm1',
              source: { kind: 'status' },
              target: 'pool.all',
              op: 'add',
              value: -2,
              active: true,
            },
          ],
          duration: { kind: 'end_of_turn' },
        },
      ],
      visibility: 'public',
      actedThisPass: false,
      grunt: {
        size: 4,
        professionalRating: 2,
        groupEdge: 2,
        members: [
          { label: '#1', filled: 3, down: false },
          { label: '#2', filled: 0, down: false },
          { label: '#3', filled: 10, down: true },
          { label: '#4', filled: 0, down: false },
        ],
      },
    };
    const once = CombatantSchema.parse(input);
    expect(CombatantSchema.parse(once)).toEqual(once);
    expect(once.grunt?.members).toHaveLength(4);
  });

  it('applies defaults for a "dumb mode" hand-typed row (FR4.8)', () => {
    const c = CombatantSchema.parse({
      id: 'cbt_2',
      encounterId: 'enc_1',
      name: 'Mystery Goon',
      monitors: {
        physical: { max: 9 },
        stun: { max: 9 },
        overflow: { max: 3 },
      },
    });
    expect(c.source).toBe('manual');
    expect(c.initKind).toBe('physical');
    expect(c.monitors.physical.filled).toBe(0);
    expect(c.effects).toEqual([]);
    expect(c.actedThisPass).toBe(false);
  });

  it('rejects initiative dice beyond 5 and unknown init kinds', () => {
    const base = {
      id: 'c',
      encounterId: 'e',
      name: 'x',
      monitors: { physical: { max: 9 }, stun: { max: 9 }, overflow: { max: 3 } },
    };
    expect(CombatantSchema.safeParse({ ...base, initDice: 6 }).success).toBe(false);
    expect(CombatantSchema.safeParse({ ...base, initKind: 'vr_scalding' }).success).toBe(false);
  });
});

describe('EncounterSchema', () => {
  it('round-trips with embedded combatants', () => {
    const enc = EncounterSchema.parse({
      id: 'enc_1',
      campaignId: 'cmp_1',
      sceneId: 'scn_1',
      name: 'Warehouse Ambush',
      state: 'live',
      turn: 2,
      pass: 1,
      activeCombatantId: 'cbt_1',
      combatants: [
        {
          id: 'cbt_1',
          encounterId: 'enc_1',
          name: 'Static',
          source: 'character',
          sourceId: 'chr_1',
          monitors: { physical: { max: 10 }, stun: { max: 10 }, overflow: { max: 3 } },
        },
      ],
    });
    expect(EncounterSchema.parse(enc)).toEqual(enc);
    expect(enc.combatants?.[0]?.name).toBe('Static');
  });

  it('defaults to prep state', () => {
    const enc = EncounterSchema.parse({ id: 'e', campaignId: 'c', name: 'Draft' });
    expect(enc.state).toBe('prep');
    expect(enc.turn).toBe(0);
    expect(enc.pass).toBe(0);
  });
});

describe('DerivedCharacterSchema', () => {
  it('round-trips an engine output with provenance', () => {
    const dv = (value: number, label: string) => ({ value, breakdown: [{ label, value }] });
    const derived = DerivedCharacterSchema.parse({
      attributes: { rea: dv(4, 'REA'), int: dv(4, 'INT') },
      limits: { physical: dv(4, 'formula'), mental: dv(6, 'formula'), social: dv(5, 'formula') },
      monitors: { physical: dv(10, '8+ceil(BOD/2)'), stun: dv(10, '8+ceil(WIL/2)'), overflow: dv(3, 'BOD') },
      initiative: {
        physical: { base: dv(8, 'REA+INT'), dice: dv(1, 'base') },
        astral: { base: dv(8, 'INT×2'), dice: dv(2, 'astral') },
        matrixAR: { base: dv(8, 'REA+INT'), dice: dv(1, 'AR') },
        vrCold: { base: dv(9, 'DP+INT'), dice: dv(3, 'cold-sim') },
        vrHot: { base: dv(9, 'DP+INT'), dice: dv(4, 'hot-sim') },
      },
      movement: { walk: dv(10, 'AGI×2'), run: dv(20, 'AGI×4') },
      pools: {
        'skill.perception': {
          total: 8,
          breakdown: [
            { label: 'INT', value: 4 },
            { label: 'Perception', value: 3 },
            { label: 'dim light', value: -1, source: 'scene' },
          ],
          limit: { kind: 'mental', value: 6 },
        },
      },
      woundModifier: dv(-1, '3 boxes physical'),
    });
    expect(DerivedCharacterSchema.parse(derived)).toEqual(derived);
    expect(derived.pools['skill.perception']?.total).toBe(8);
  });
});
