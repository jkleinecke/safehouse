import { describe, expect, it } from 'vitest';
import { SheetV1Schema, type GenTemplate } from '@safehouse/contracts';
import {
  generateGruntGroup,
  generateNpc,
  regenerate,
  deriveMonitors,
  validitySweep,
  hashSeed,
  mulberry32,
  type LoadoutCatalog,
} from '../src/index.js';

const template: GenTemplate = {
  roleTags: ['muscle'],
  tiers: [
    {
      id: 'pro',
      label: 'Pro',
      attributes: {
        bod: { min: 4, max: 7 },
        agi: { min: 3, max: 6 },
        rea: { min: 3, max: 5 },
        wil: { min: 2, max: 4 },
      },
      skills: {
        automatics: { min: 3, max: 6 },
        'unarmed-combat': { min: 2, max: 5 },
        perception: { min: 1, max: 3 },
      },
      professionalRating: { min: 3, max: 5 },
      metatypeWeights: { human: 3, ork: 1 },
      loadout: [
        { slot: 'primary-weapon', options: ['Ares Roomsweeper Clone', 'Colt Cousin'], count: { min: 1, max: 1 } },
        { slot: 'armor', options: ['Lined Coat Knockoff'], count: { min: 1, max: 1 } },
      ],
      spells: [],
      augments: [],
    },
  ],
};

const catalog: LoadoutCatalog = {
  weapons: {
    'Ares Roomsweeper Clone': { name: 'Ares Roomsweeper Clone', skillId: 'automatics', acc: 4, dv: '7P', ap: -1 },
    'Colt Cousin': { name: 'Colt Cousin', skillId: 'automatics', acc: 5, dv: '8P', ap: 0 },
  },
  armor: {
    'Lined Coat Knockoff': { name: 'Lined Coat Knockoff', rating: 9, worn: true },
  },
};

describe('prng', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('hashSeed handles numeric and string seeds', () => {
    expect(hashSeed(7)).toBe(7);
    expect(hashSeed('same-run')).toBe(hashSeed('same-run'));
    expect(hashSeed('same-run')).not.toBe(hashSeed('other-run'));
    expect(Number.isInteger(hashSeed(-3.5))).toBe(true);
  });
});

describe('generateNpc', () => {
  it('same seed → identical output', () => {
    const a = generateNpc(template, 'pro', 1234, { catalog });
    const b = generateNpc(template, 'pro', 1234, { catalog });
    expect(a).toEqual(b);
  });

  it('string seeds are deterministic too', () => {
    const a = generateNpc(template, 'pro', 'dockside-ambush');
    const b = generateNpc(template, 'pro', 'dockside-ambush');
    expect(a).toEqual(b);
  });

  it('different seeds diverge', () => {
    const outs = new Set<string>();
    for (let s = 0; s < 20; s++) outs.add(JSON.stringify(generateNpc(template, 'pro', s)));
    expect(outs.size).toBeGreaterThan(10);
  });

  it('emits a schema-valid SheetV1 with derivable monitors', () => {
    const npc = generateNpc(template, 'pro', 99, { catalog });
    expect(SheetV1Schema.safeParse(npc.sheet).success).toBe(true);
    expect(npc.corrections).toEqual([]);
    expect(npc.monitors).toEqual(
      deriveMonitors(npc.sheet.attributes.bod, npc.sheet.attributes.wil),
    );
    expect(npc.monitors.physical).toBeGreaterThanOrEqual(9);
    expect(npc.monitors.stun).toBeGreaterThanOrEqual(9);
  });

  it('fills loadout from the catalog', () => {
    const npc = generateNpc(template, 'pro', 5, { catalog });
    expect(npc.sheet.weapons).toHaveLength(1);
    expect(['Ares Roomsweeper Clone', 'Colt Cousin']).toContain(npc.sheet.weapons[0]?.name);
    expect(npc.sheet.armor[0]?.name).toBe('Lined Coat Knockoff');
    expect(npc.sheet.armor[0]?.worn).toBe(true);
  });

  it('unresolved loadout options fall back to gear entries', () => {
    const npc = generateNpc(template, 'pro', 5); // no catalog
    expect(npc.sheet.weapons).toHaveLength(0);
    expect(npc.sheet.gear.length).toBeGreaterThanOrEqual(2);
  });

  it('has a persona stub with quirk / appearance / motivation', () => {
    const npc = generateNpc(template, 'pro', 8);
    expect(npc.flavor.name.length).toBeGreaterThan(0);
    expect(npc.flavor.quirk.length).toBeGreaterThan(0);
    expect(npc.flavor.appearance.length).toBeGreaterThan(0);
    expect(npc.flavor.motivation.length).toBeGreaterThan(0);
    expect(npc.persona.mannerisms).toEqual([npc.flavor.quirk]);
    expect(npc.persona.goals).toEqual([npc.flavor.motivation]);
    expect(npc.persona.traits).toEqual([npc.flavor.appearance]);
  });

  it('throws on an unknown tier', () => {
    expect(() => generateNpc(template, 'nope', 1)).toThrow(/unknown tier/);
  });
});

describe('distributions stay in range over 500 samples', () => {
  it('attributes, skills, PR, metatype', () => {
    const metatypes = new Map<string, number>();
    for (let s = 0; s < 500; s++) {
      const npc = generateNpc(template, 'pro', s);
      const a = npc.sheet.attributes;
      expect(a.bod).toBeGreaterThanOrEqual(4);
      expect(a.bod).toBeLessThanOrEqual(7);
      expect(a.agi).toBeGreaterThanOrEqual(3);
      expect(a.agi).toBeLessThanOrEqual(6);
      expect(a.rea).toBeGreaterThanOrEqual(3);
      expect(a.rea).toBeLessThanOrEqual(5);
      expect(a.wil).toBeGreaterThanOrEqual(2);
      expect(a.wil).toBeLessThanOrEqual(4);
      for (const skill of npc.sheet.skills) {
        expect(skill.rating).toBeGreaterThanOrEqual(0);
        expect(skill.rating).toBeLessThanOrEqual(12);
      }
      const auto = npc.sheet.skills.find((k) => k.id === 'automatics');
      expect(auto?.rating).toBeGreaterThanOrEqual(3);
      expect(auto?.rating).toBeLessThanOrEqual(6);
      expect(npc.professionalRating).toBeGreaterThanOrEqual(3);
      expect(npc.professionalRating).toBeLessThanOrEqual(5);
      metatypes.set(npc.metatype, (metatypes.get(npc.metatype) ?? 0) + 1);
    }
    expect([...metatypes.keys()].sort()).toEqual(['human', 'ork']);
    // 3:1 weights — humans should clearly dominate over 500 samples.
    expect(metatypes.get('human') ?? 0).toBeGreaterThan(metatypes.get('ork') ?? 0);
  });

  it('validity pass clamps pathological template ranges', () => {
    const wild: GenTemplate = {
      roleTags: [],
      tiers: [
        {
          id: 't',
          label: 'T',
          attributes: { bod: { min: 20, max: 30 } },
          skills: { automatics: { min: 15, max: 20 } },
          professionalRating: { min: 1, max: 1 },
          loadout: [],
          spells: [],
          augments: [],
        },
      ],
    };
    for (let s = 0; s < 50; s++) {
      const npc = generateNpc(wild, 't', s);
      expect(npc.sheet.attributes.bod).toBeLessThanOrEqual(12);
      expect(npc.sheet.skills[0]?.rating).toBeLessThanOrEqual(12);
    }
  });
});

describe('regenerate locks', () => {
  const first = generateNpc(template, 'pro', 1000, { catalog });

  it('lock.stats keeps attributes/skills/PR/metatype, rerolls the name', () => {
    const re = regenerate(first, template, 'pro', 2000, { lock: { stats: true }, catalog });
    expect(re.sheet.attributes).toEqual(first.sheet.attributes);
    expect(re.sheet.skills).toEqual(first.sheet.skills);
    expect(re.professionalRating).toBe(first.professionalRating);
    expect(re.metatype).toBe(first.metatype);
    const fresh = generateNpc(template, 'pro', 2000, { catalog });
    expect(re.name).toBe(fresh.name);
    expect(re.flavor).toEqual(fresh.flavor);
  });

  it('lock.name keeps the name, rerolls the stats', () => {
    const re = regenerate(first, template, 'pro', 2000, { lock: { name: true }, catalog });
    expect(re.name).toBe(first.name);
    expect(re.sheet.identity.alias).toBe(first.name);
    const fresh = generateNpc(template, 'pro', 2000, { catalog });
    expect(re.sheet.attributes).toEqual(fresh.sheet.attributes);
    expect(re.professionalRating).toBe(fresh.professionalRating);
  });

  it('lock.flavor + lock.loadout hold those aspects', () => {
    const re = regenerate(first, template, 'pro', 3000, {
      lock: { flavor: true, loadout: true },
      catalog,
    });
    expect(re.flavor.quirk).toBe(first.flavor.quirk);
    expect(re.flavor.appearance).toBe(first.flavor.appearance);
    expect(re.flavor.motivation).toBe(first.flavor.motivation);
    expect(re.loadout).toEqual(first.loadout);
    expect(re.sheet.weapons).toEqual(first.sheet.weapons);
    expect(re.sheet.armor).toEqual(first.sheet.armor);
  });

  it('no locks ≡ plain generate with the new seed', () => {
    const re = regenerate(first, template, 'pro', 4000, { catalog });
    expect(re).toEqual(generateNpc(template, 'pro', 4000, { catalog }));
  });

  it('regenerate is deterministic', () => {
    const a = regenerate(first, template, 'pro', 5000, { lock: { stats: true }, catalog });
    const b = regenerate(first, template, 'pro', 5000, { lock: { stats: true }, catalog });
    expect(a).toEqual(b);
  });
});

describe('generateGruntGroup', () => {
  it('same seed → identical squad', () => {
    const a = generateGruntGroup(template, 'pro', 5, 77, { catalog });
    const b = generateGruntGroup(template, 'pro', 5, 77, { catalog });
    expect(a).toEqual(b);
  });

  it('members share the statblock but carry distinct names', () => {
    const group = generateGruntGroup(template, 'pro', 6, 42, { catalog });
    expect(group.members).toHaveLength(6);
    const names = new Set(group.members.map((m) => m.name));
    expect(names.size).toBe(6);
    for (const m of group.members) {
      expect(m.sheet.attributes).toEqual(group.statblock.attributes);
      expect(m.sheet.skills).toEqual(group.statblock.skills);
      expect(m.sheet.weapons).toEqual(group.statblock.weapons);
      expect(m.professionalRating).toBe(group.professionalRating);
      expect(m.metatype).toBe(group.metatype);
      expect(m.sheet.identity.alias).toBe(m.name);
      expect(SheetV1Schema.safeParse(m.sheet).success).toBe(true);
    }
  });

  it('rejects a non-positive size', () => {
    expect(() => generateGruntGroup(template, 'pro', 0, 1)).toThrow(/size/);
  });
});

describe('validitySweep directly', () => {
  it('reports corrections on out-of-bounds input and none on clean input', () => {
    const clean = generateNpc(template, 'pro', 3).sheet;
    expect(validitySweep(clean).ok).toBe(true);
    const dirty = {
      ...clean,
      attributes: { ...clean.attributes, bod: 99, agi: 0 },
      skills: [{ id: 'automatics', rating: 44, attr: 'agi' as const }],
    };
    const swept = validitySweep(dirty);
    expect(swept.ok).toBe(false);
    expect(swept.sheet.attributes.bod).toBe(12);
    expect(swept.sheet.attributes.agi).toBe(1);
    expect(swept.sheet.skills[0]?.rating).toBe(12);
    expect(swept.corrections.length).toBe(3);
  });
});
