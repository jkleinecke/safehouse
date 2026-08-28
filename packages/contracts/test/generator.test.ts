import { describe, expect, it } from 'vitest';
import {
  GenTemplateSchema,
  NpcTemplateSchema,
  PersonaSchema,
  GenerateNpcRequestSchema,
  GenerateGroupRequestSchema,
} from '../src/index.js';

const genTemplate = {
  roleTags: ['muscle', 'ganger'],
  tiers: [
    {
      id: 'street',
      label: 'Street',
      attributes: {
        bod: { min: 3, max: 5 },
        agi: { min: 2, max: 4 },
        rea: { min: 2, max: 4 },
      },
      skills: {
        clubs: { min: 2, max: 4 },
        intimidation: { min: 1, max: 3 },
      },
      professionalRating: { min: 0, max: 1 },
      metatypeWeights: { human: 3, ork: 2, troll: 1 },
      loadout: [
        { slot: 'primary-weapon', options: ['Bat, Taped', 'Chain, Rusty'] },
        { slot: 'armor', options: ['Gang Colors, Lined'], count: { min: 0, max: 1 } },
      ],
    },
    {
      id: 'pro',
      label: 'Pro',
      attributes: { bod: { min: 4, max: 6 } },
      skills: { automatics: { min: 4, max: 6 } },
      professionalRating: { min: 3, max: 4 },
    },
  ],
};

describe('GenTemplateSchema (FR10.1)', () => {
  it('round-trips a two-tier archetype', () => {
    const once = GenTemplateSchema.parse(genTemplate);
    expect(GenTemplateSchema.parse(once)).toEqual(once);
    expect(once.tiers).toHaveLength(2);
    expect(once.tiers[0]?.loadout[0]?.slot).toBe('primary-weapon');
    // defaults filled on the sparse tier
    expect(once.tiers[1]?.loadout).toEqual([]);
    expect(once.tiers[1]?.spells).toEqual([]);
  });

  it('requires at least one tier and a PR range per tier', () => {
    expect(GenTemplateSchema.safeParse({ roleTags: [], tiers: [] }).success).toBe(false);
    expect(
      GenTemplateSchema.safeParse({
        tiers: [{ id: 't', label: 'T', attributes: {}, skills: {} }],
      }).success,
    ).toBe(false);
  });
});

describe('PersonaSchema (FR12.5/12.6)', () => {
  it('round-trips and defaults its lists', () => {
    const persona = PersonaSchema.parse({
      traits: ['patient', 'keeps receipts'],
      voice: 'low, unhurried, drops articles',
      goals: ['retire to Salish territory'],
      secrets: ['skims from the boss'],
      knowledge: ['dock schedules', 'who moved the shipment'],
    });
    expect(PersonaSchema.parse(persona)).toEqual(persona);
    expect(persona.mannerisms).toEqual([]);
    expect(PersonaSchema.parse({}).secrets).toEqual([]);
  });
});

describe('NpcTemplateSchema', () => {
  it('round-trips a template with gen params, persona, and page ref', () => {
    const tpl = NpcTemplateSchema.parse({
      id: 'npt_1',
      campaignId: 'cmp_1',
      name: 'Dock Gang Muscle',
      statblock: { weapons: [], armor: [] },
      gen: genTemplate,
      persona: { traits: ['loud'], goals: [], secrets: [], knowledge: [] },
      pageRef: { book: 'SR5', page: 381, note: 'grunt rules' },
    });
    expect(NpcTemplateSchema.parse(tpl)).toEqual(tpl);
  });
});

describe('generation requests', () => {
  it('round-trips seeded npc + group requests', () => {
    const npc = GenerateNpcRequestSchema.parse({
      templateId: 'npt_1',
      tierId: 'street',
      seed: 1337,
      locks: ['attributes'],
    });
    expect(GenerateNpcRequestSchema.parse(npc)).toEqual(npc);

    const grp = GenerateGroupRequestSchema.parse({
      templateId: 'npt_1',
      tierId: 'street',
      size: 4,
      seed: 1337,
    });
    expect(grp.locks).toEqual([]);
    expect(GenerateGroupRequestSchema.safeParse({ templateId: 'x', tierId: 't', size: 0 }).success).toBe(false);
  });
});
