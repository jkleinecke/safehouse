/**
 * The Step 1 concept cards (`chargen/concepts.ts`; FR3.9, docs/CHARGEN.md
 * §4.4 Step 1, §8.2).
 *
 * Three promises are held here. The cards are ours: original titles, one-line
 * pitches, gear as intent, no published archetype name. Each card is legal as
 * written — its priorities are a valid Priority order, its magic kind is on
 * its Magic row, and for the metatype it suggests (human when it suggests
 * none) `applyConcept` reproduces its spend exactly with nothing left over.
 * And whatever the build brings to it — another metatype on the row, the Run
 * Faster printing, a creation level, a quality that fences off a group or
 * doubles a cost — a card never leaves Step 3 or Step 6 blocked, and never
 * touches who the runner is.
 *
 * Original fiction only — no book content (BUILD_CONVENTIONS hard rule 1).
 */
import { describe, expect, it } from 'vitest';
import {
  CharacterBuildSchema,
  PRIORITY_COLUMNS,
  PRIORITY_LEVELS,
  type CharacterBuild,
  type ChargenSettings,
  type Issue,
} from '@safehouse/contracts';
import {
  ACTIVE_SKILL_BY_ID,
  BLANK_CONCEPT_ID,
  CONCEPT_GEAR_KINDS,
  CONCEPT_GEAR_LISTS,
  CONCEPT_IDS,
  CONCEPT_PRESETS,
  CONCEPT_PRESET_BY_ID,
  CORE_METATYPE_IDS,
  METATYPE_BY_ID,
  SKILL_GROUP_BY_ID,
  applyConcept,
  budgets,
  clearSpend,
  conceptPreset,
  emptyBuild,
  magicPriorityOption,
  ratings,
  stepStatus,
  validate,
  type ConceptPreset,
} from '../src/index.js';
import { EXPERIENCED, EXPERIENCED_RF, settings as settingsFor } from './chargen-fixtures.js';

const CARDS = CONCEPT_PRESETS.filter((p) => p.spend !== null);
const BLANK = CONCEPT_PRESET_BY_ID[BLANK_CONCEPT_ID];

const fresh = (s: ChargenSettings = EXPERIENCED, alias = 'Lanternjaw'): CharacterBuild => emptyBuild(s, { alias });

/** The metatypes a card can be applied with: every core metatype on its Metatype row. */
function metatypesOnRow(card: ConceptPreset): string[] {
  const level = card.priorities!.metatype;
  return CORE_METATYPE_IDS.filter((id) => METATYPE_BY_ID[id].priority[level] !== null);
}

/** What blocks Step 3 and Step 6, as the walkthrough's Next button sees it. */
function blockers(build: CharacterBuild, s: ChargenSettings): Issue[] {
  const status = stepStatus(build, s);
  return [...status[2]!.blocking, ...status[5]!.blocking];
}

const describeBlockers = (issues: readonly Issue[]): string[] => issues.map((i) => `${i.code}: ${i.message}`);

describe('concept cards: the registry (§8.2)', () => {
  it('holds 12–16 cards plus "start from nothing", ids matching CONCEPT_IDS', () => {
    expect(CARDS.length).toBeGreaterThanOrEqual(12);
    expect(CARDS.length).toBeLessThanOrEqual(16);
    expect(CONCEPT_PRESETS.map((p) => p.id)).toEqual([...CONCEPT_IDS]);
    expect(new Set(CONCEPT_IDS).size).toBe(CONCEPT_IDS.length);
    expect(BLANK.spend).toBeNull();
    expect(BLANK.priorities).toBeNull();
  });

  it('covers the role words the plan names', () => {
    for (const id of [
      'face',
      'decker',
      'rigger',
      'technomancer',
      'adept',
      'street-mage',
      'shaman',
      'muscle',
      'infiltrator',
      'street-doc',
      'investigator',
      'smuggler',
    ]) {
      expect(conceptPreset(id), id).not.toBeNull();
    }
  });

  it('looks cards up by id, and nothing else', () => {
    expect(conceptPreset('rigger')?.id).toBe('rigger');
    expect(conceptPreset(' decker ')?.id).toBe('decker');
    expect(conceptPreset('street-samurai')).toBeNull();
    expect(conceptPreset(undefined)).toBeNull();
    expect(conceptPreset(null)).toBeNull();
  });

  it('titles are our own: distinct, and never a published archetype name (§7, §14)', () => {
    const titles = CONCEPT_PRESETS.map((p) => p.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
    const exact = ['face', 'decker', 'rigger', 'technomancer', 'adept', 'smuggler', 'tank', 'spellcaster'];
    const phrases = [
      'street samurai',
      'street shaman',
      'combat mage',
      'occult investigator',
      'covert ops',
      'brawling adept',
      'gunslinger adept',
      'weapons specialist',
      'drone rigger',
    ];
    for (const title of titles) {
      expect(exact, title).not.toContain(title);
      for (const phrase of phrases) expect(title, title).not.toContain(phrase);
    }
  });

  it('pitches are one short line each', () => {
    for (const p of CONCEPT_PRESETS) {
      expect(p.pitch.length, p.id).toBeGreaterThan(10);
      expect(p.pitch.length, p.id).toBeLessThanOrEqual(100);
      expect(p.pitch, p.id).not.toMatch(/\n/);
    }
  });

  it('gear is intent — a known kind and a short plain hint — and every kind maps to a purchase list', () => {
    for (const kind of CONCEPT_GEAR_KINDS) expect(['gear', 'weapons', 'armor', 'augments']).toContain(CONCEPT_GEAR_LISTS[kind]);
    for (const card of CARDS) {
      expect(card.spend!.gear.length, card.id).toBeGreaterThan(0);
      for (const slot of card.spend!.gear) {
        expect(CONCEPT_GEAR_KINDS, card.id).toContain(slot.kind);
        expect(slot.hint.length, `${card.id} ${slot.hint}`).toBeLessThanOrEqual(40);
        expect(slot.hint, `${card.id} ${slot.hint}`).toMatch(/^[a-z][a-zA-Z -]*$/);
        if (slot.qty !== undefined) expect(slot.qty).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('concept cards: legal as written (SR5 pp. 65–69, 88–90)', () => {
  it('priorities are a valid Priority order: all five columns, five different rows', () => {
    for (const card of CARDS) {
      const levels = PRIORITY_COLUMNS.map((c) => card.priorities![c]);
      expect([...levels].sort(), card.id).toEqual([...PRIORITY_LEVELS]);
    }
  });

  it('the magic kind is offered on its Magic row in both printings; mundanes put Magic at E', () => {
    for (const card of CARDS) {
      const level = card.priorities!.magic;
      if (card.magic.kind === 'mundane') {
        expect(level, card.id).toBe('E');
        continue;
      }
      expect(magicPriorityOption('sr5', level, card.magic.kind), card.id).not.toBeNull();
      expect(magicPriorityOption('rf', level, card.magic.kind), card.id).not.toBeNull();
      if (card.magic.kind === 'aspected') expect(card.magic.aspect, card.id).toBeDefined();
    }
  });

  it('a suggested metatype is on the card’s Metatype row', () => {
    for (const card of CARDS) {
      if (card.metatype === null) continue;
      expect(METATYPE_BY_ID[card.metatype].priority[card.priorities!.metatype], card.id).not.toBeNull();
    }
  });

  it('every skill, group and knowledge rating is a real id within the creation maximum of 6', () => {
    for (const card of CARDS) {
      const s = card.spend!;
      for (const sk of [...s.skills, ...s.grantSkills.map((id) => ({ id, rating: 1 }))]) {
        expect(ACTIVE_SKILL_BY_ID[sk.id], `${card.id} ${sk.id}`).toBeDefined();
        expect(sk.rating).toBeLessThanOrEqual(6);
      }
      for (const g of s.groups) {
        expect(SKILL_GROUP_BY_ID[g.id], `${card.id} ${g.id}`).toBeDefined();
        expect(g.rating).toBeLessThanOrEqual(6);
      }
      for (const k of [...s.knowledge, ...s.languages]) {
        expect(k.name.trim().length, card.id).toBeGreaterThan(0);
        expect(k.rating).toBeGreaterThan(0);
        expect(k.rating).toBeLessThanOrEqual(6);
      }
      const attributeTotal = Object.values(s.attributes).reduce((a, b) => a + b, 0);
      expect(attributeTotal, card.id).toBe(EXPERIENCED_TABLE_POINTS[card.priorities!.attributes]);
      expect(s.emphasis.length, card.id).toBeGreaterThan(0);
    }
  });

  it('applied for its own metatype under the core printing, the spend comes out exactly as written', () => {
    for (const card of CARDS) {
      const applied = applyConcept(fresh(), card, EXPERIENCED);
      const s = card.spend!;
      expect(applied.metatype, card.id).toBe(card.metatype ?? 'human');
      expect(applied.attributes, card.id).toEqual(s.attributes);

      const r = ratings(applied, EXPERIENCED);
      for (const sk of s.skills) {
        expect(r.skills.find((x) => x.id === sk.id)?.rating, `${card.id} ${sk.id}`).toBe(sk.rating);
      }
      for (const g of s.groups) {
        expect(r.groups.find((x) => x.id === g.id)?.rating, `${card.id} ${g.id}`).toBe(g.rating);
      }
      for (const k of s.knowledge) {
        expect(r.knowledge.find((x) => x.name === k.name)?.rating, `${card.id} ${k.name}`).toBe(k.rating);
      }
      for (const l of s.languages) {
        expect(r.languages.find((x) => x.name === l.name)?.rating, `${card.id} ${l.name}`).toBe(l.rating);
      }
      // Nothing the card did not write crept in from the fallbacks.
      expect(applied.skills.active.map((a) => a.id).sort(), card.id).toEqual(
        s.skills
          .filter((sk) => sk.rating > (applied.grants.skills.find((g) => g.id === sk.id)?.rating ?? 0))
          .map((sk) => sk.id)
          .sort(),
      );
      expect(applied.skills.knowledge.map((k) => k.name), card.id).toEqual(s.knowledge.map((k) => k.name));

      const pools = budgets(applied, EXPERIENCED).pools;
      for (const pool of ['attributes', 'skills', 'groups', 'knowledge'] as const) {
        expect(pools[pool].remaining, `${card.id} ${pool}`).toBe(0);
      }
    }
  });
});

const EXPERIENCED_TABLE_POINTS = { A: 24, B: 20, C: 16, D: 14, E: 12 } as const;

describe('applyConcept: never leaves Step 3 or Step 6 blocked (§4.4)', () => {
  it('for every card, with its suggested metatype or the human default', () => {
    for (const card of CARDS) {
      const applied = applyConcept(fresh(), card, EXPERIENCED);
      expect(describeBlockers(blockers(applied, EXPERIENCED)), card.id).toEqual([]);
    }
  });

  it('for every card with human, under both printings and all three creation levels', () => {
    for (const s of [EXPERIENCED, EXPERIENCED_RF, settingsFor({ level: 'street' }), settingsFor({ level: 'prime', table: 'rf' })]) {
      for (const card of CARDS) {
        const applied = applyConcept(fresh(s), card, s, { metatype: 'human' });
        expect(applied.metatype).toBe('human');
        expect(describeBlockers(blockers(applied, s)), `${card.id} ${s.level}/${s.table}`).toEqual([]);
      }
    }
  });

  it('for every card with every core metatype on its Metatype row, under both printings', () => {
    for (const s of [EXPERIENCED, EXPERIENCED_RF]) {
      for (const card of CARDS) {
        for (const metatype of metatypesOnRow(card)) {
          const applied = applyConcept(fresh(s), card, s, { metatype });
          expect(applied.metatype).toBe(metatype);
          expect(describeBlockers(blockers(applied, s)), `${card.id} as ${metatype} (${s.table})`).toEqual([]);
          const pools = budgets(applied, s).pools;
          for (const pool of ['attributes', 'skills', 'groups', 'knowledge'] as const) {
            expect(pools[pool].remaining, `${card.id} as ${metatype} ${pool}`).toBe(0);
          }
        }
      }
    }
  });

  it('Step 2 is complete too: five priorities, none repeated', () => {
    for (const card of CARDS) {
      const status = stepStatus(applyConcept(fresh(), card, EXPERIENCED), EXPERIENCED);
      expect(status[1]!.complete, card.id).toBe(true);
    }
  });

  it('only the first emphasis starts at its natural maximum, whatever the metatype (p. 66)', () => {
    for (const card of CARDS) {
      for (const metatype of metatypesOnRow(card)) {
        const r = ratings(applyConcept(fresh(), card, EXPERIENCED, { metatype }), EXPERIENCED);
        const atMax = (['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha'] as const).filter(
          (c) => r.attributes[c].rating >= r.attributes[c].tableMax,
        );
        expect(atMax.length, `${card.id} as ${metatype}`).toBeLessThanOrEqual(1);
        if (atMax.length === 1) expect(atMax[0]).toBe(card.spend!.emphasis[0]);
      }
    }
  });

  it('the result is a record the contract accepts unchanged', () => {
    for (const card of CONCEPT_PRESETS) {
      const applied = applyConcept(fresh(), card, EXPERIENCED);
      expect(CharacterBuildSchema.parse(applied), card.id).toEqual(applied);
    }
  });
});

describe('applyConcept: the Magic/Resonance column (pp. 65, 69; RF p. 63)', () => {
  it('fills the free skills from the card’s preferences, legal in either printing', () => {
    const card = CONCEPT_PRESET_BY_ID.technomancer;
    const core = applyConcept(fresh(), card, EXPERIENCED);
    expect(core.grants.skills).toEqual([
      { id: 'compiling', rating: 5 },
      { id: 'registering', rating: 5 },
      { id: 'hacking', rating: 5 },
    ]);
    const rf = applyConcept(fresh(EXPERIENCED_RF), card, EXPERIENCED_RF);
    expect(rf.grants.skills).toEqual([
      { id: 'compiling', rating: 5 },
      { id: 'registering', rating: 5 },
    ]);
    // Hacking 6 either way: one point on a grant, or six without one.
    expect(ratings(core, EXPERIENCED).skills.find((s) => s.id === 'hacking')?.rating).toBe(6);
    expect(ratings(rf, EXPERIENCED_RF).skills.find((s) => s.id === 'hacking')?.rating).toBe(6);
    for (const [b, s] of [
      [core, EXPERIENCED],
      [rf, EXPERIENCED_RF],
    ] as const) {
      const codes = validate(b, s).map((i) => i.code);
      expect(codes).not.toContain('grant-skill-invalid');
      expect(codes).not.toContain('grant-skills-over');
      expect(codes).not.toContain('grant-skills-unfilled');
    }
  });

  it('gives every awakened card its grants with no Step 4 grant errors but the spell/form picks the catalogue fills', () => {
    const catalogueGrants = new Set(['grant-spells-unfilled', 'grant-forms-unfilled']);
    for (const card of CARDS) {
      if (card.magic.kind === 'mundane') continue;
      for (const s of [EXPERIENCED, EXPERIENCED_RF]) {
        const applied = applyConcept(fresh(s), card, s);
        const step4 = stepStatus(applied, s)[3]!.blocking.filter((i) => !catalogueGrants.has(i.code));
        expect(describeBlockers(step4), `${card.id} (${s.table})`).toEqual([]);
      }
    }
  });

  it('an aspected card takes its aspect and the aspect’s group as the grant', () => {
    const applied = applyConcept(fresh(), CONCEPT_PRESET_BY_ID.conjurer, EXPERIENCED);
    expect(applied.magic).toEqual({ kind: 'aspected', aspect: 'conjuring', tradition: 'shamanic' });
    expect(applied.grants.groups).toEqual([{ id: 'conjuring', rating: 4 }]);
    // Magic 5 on the row, raised to 6 with a special point first.
    expect(ratings(applied, EXPERIENCED).attributes.mag.rating).toBe(6);
  });

  it('a mundane card clears a previous card’s magic, grants and powers', () => {
    const mage = applyConcept(fresh(), CONCEPT_PRESET_BY_ID['street-mage'], EXPERIENCED);
    const withPicks = CharacterBuildSchema.parse({
      ...mage,
      grants: { ...mage.grants, spells: [{ name: 'Stun lash' }] },
    });
    const muscle = applyConcept(withPicks, CONCEPT_PRESET_BY_ID.muscle, EXPERIENCED, { metatype: 'human' });
    expect(muscle.magic).toEqual({ kind: 'mundane' });
    expect(muscle.grants).toEqual({ skills: [], groups: [], spells: [], forms: [] });
    expect(muscle.special).toEqual({ edg: 5, mag: 0, res: 0 });
  });

  it('keeps a previous card’s free spells only where the new type may learn them, and no more than its row grants (pp. 65, 69)', () => {
    const mage = applyConcept(fresh(), CONCEPT_PRESET_BY_ID['street-mage'], EXPERIENCED);
    const spells = (n: number, category = 'combat') => Array.from({ length: n }, (_, i) => ({ name: `Spell ${i + 1}`, category }));
    const withPicks = (picks: object[]) => CharacterBuildSchema.parse({ ...mage, grants: { ...mage.grants, spells: picks } });
    // An aspected conjurer learns no formulae: the spells go, and nothing on Step 4 refuses the card.
    const conjurer = applyConcept(withPicks(spells(5)), CONCEPT_PRESET_BY_ID.conjurer, EXPERIENCED);
    expect(conjurer.grants.spells).toEqual([]);
    const refused = validate(conjurer, EXPERIENCED).filter((i) => ['formulae-not-caster', 'grant-spells-over'].includes(i.code));
    expect(describeBlockers(refused)).toEqual([]);
    // A magician keeps them, up to what its Magic row grants.
    const grant = magicPriorityOption(EXPERIENCED.table, mage.priorities.magic!, 'magician')!.formulae!;
    const again = applyConcept(withPicks(spells(grant + 3)), CONCEPT_PRESET_BY_ID['street-mage'], EXPERIENCED);
    expect(again.grants.spells).toHaveLength(grant);
  });
});

describe('applyConcept: what it keeps', () => {
  const settled = (): CharacterBuild =>
    CharacterBuildSchema.parse({
      ...fresh(),
      identity: { alias: 'Lanternjaw', realName: 'Odile Brask', age: 31, sex: 'F', background: 'Grew up over a laundromat.' },
      metatype: 'dwarf',
      qualities: [{ name: 'Night owl', type: 'positive', karma: 3 }],
      skills: {
        active: [{ id: 'archery', points: 3 }],
        languages: [
          { name: 'English', native: true, points: 2 },
          { name: 'Basque', native: true },
          { name: 'Welsh', points: 3 },
        ],
      },
      purchases: [{ list: 'gear', kind: 'gear', name: 'Rope', cost: 50, item: { name: 'Rope' } }],
      lifestyles: [{ tier: 'high', name: 'High (loft)', months: 2 }],
      karma: {
        toNuyen: 4,
        spends: [{ kind: 'skill', id: 'archery', from: 3, to: 4 }],
        contacts: [{ name: 'Mother Ruin', role: 'fence', connection: 3, loyalty: 2 }],
      },
    });

  it('never overwrites identity; it only records which card was picked', () => {
    const before = settled();
    for (const card of CONCEPT_PRESETS) {
      const applied = applyConcept(before, card, EXPERIENCED);
      expect(applied.identity).toEqual({ ...before.identity, concept: card.id });
    }
  });

  it('leaves its input untouched', () => {
    const before = settled();
    const copy = structuredClone(before);
    for (const card of CONCEPT_PRESETS) applyConcept(before, card, EXPERIENCED);
    expect(before).toEqual(copy);
  });

  it('keeps qualities, purchases, contacts, Karma-to-nuyen and a kept lifestyle; clears Karma spends', () => {
    const before = settled();
    const applied = applyConcept(before, CONCEPT_PRESET_BY_ID.decker, EXPERIENCED);
    expect(applied.qualities).toEqual(before.qualities);
    expect(applied.purchases).toEqual(before.purchases);
    expect(applied.karma.contacts).toEqual(before.karma.contacts);
    expect(applied.karma.toNuyen).toBe(4);
    expect(applied.karma.spends).toEqual([]);
    expect(applied.lifestyles).toEqual(before.lifestyles);
    expect(applied.skills.active.some((s) => s.id === 'archery')).toBe(false);
  });

  it('keeps one named native language, without ranks, and drops the rest of the old languages', () => {
    const applied = applyConcept(settled(), CONCEPT_PRESET_BY_ID.decker, EXPERIENCED);
    expect(applied.skills.languages).toEqual([
      { name: 'English', native: true, points: 0, skillPoints: 0, spec: null },
      { name: 'Mandarin', native: false, points: 3, skillPoints: 0, spec: null },
    ]);
  });

  it('keeps two native languages with Bilingual', () => {
    const before = CharacterBuildSchema.parse({
      ...settled(),
      qualities: [{ name: 'Bilingual', type: 'positive', karma: 5 }],
    });
    const applied = applyConcept(before, CONCEPT_PRESET_BY_ID.face, EXPERIENCED);
    expect(applied.skills.languages.filter((l) => l.native).map((l) => l.name)).toEqual(['English', 'Basque']);
    expect(describeBlockers(blockers(applied, EXPERIENCED))).toEqual([]);
  });

  it('a suggested language the player already speaks natively is not bought twice', () => {
    const before = CharacterBuildSchema.parse({
      ...fresh(),
      skills: { languages: [{ name: 'Japanese', native: true }] },
    });
    const applied = applyConcept(before, CONCEPT_PRESET_BY_ID.face, EXPERIENCED);
    expect(applied.skills.languages.filter((l) => l.name === 'Japanese')).toHaveLength(1);
    expect(budgets(applied, EXPERIENCED).pools.knowledge.remaining).toBe(0);
    expect(validate(applied, EXPERIENCED).map((i) => i.code)).not.toContain('native-language-rated');
  });

  it('adds the suggested lifestyle only when the build keeps none', () => {
    const applied = applyConcept(fresh(), CONCEPT_PRESET_BY_ID.smuggler, EXPERIENCED);
    expect(applied.lifestyles).toEqual([{ tier: 'low', name: 'Low', months: 1 }]);
  });

  it('metatype: the explicit choice, then the card’s suggestion, then the build’s own, then human — each only if on the row', () => {
    const face = CONCEPT_PRESET_BY_ID.face; // Metatype C, suggests elf
    const decker = CONCEPT_PRESET_BY_ID.decker; // Metatype D, no suggestion
    expect(applyConcept(fresh(), face, EXPERIENCED).metatype).toBe('elf');
    expect(applyConcept(fresh(), face, EXPERIENCED, { metatype: 'ork' }).metatype).toBe('ork');
    expect(applyConcept(fresh(), face, EXPERIENCED, { metatype: 'troll' }).metatype).toBe('elf'); // no troll on C
    expect(applyConcept(fresh(), face, EXPERIENCED, { metatype: 'oni' }).metatype).toBe('elf'); // metavariants off
    expect(applyConcept(settled(), decker, EXPERIENCED).metatype).toBe('human'); // no dwarf on D
    const elfDraft = CharacterBuildSchema.parse({ ...fresh(), metatype: 'elf' });
    expect(applyConcept(elfDraft, decker, EXPERIENCED).metatype).toBe('elf');
    expect(applyConcept(elfDraft, CONCEPT_PRESET_BY_ID.muscle, EXPERIENCED).metatype).toBe('troll');
  });

  it('re-applying: the last card wins and nothing of the first leaks through', () => {
    for (const first of CARDS) {
      for (const second of [CONCEPT_PRESET_BY_ID.rigger, CONCEPT_PRESET_BY_ID.shaman, CONCEPT_PRESET_BY_ID.infiltrator]) {
        const twice = applyConcept(applyConcept(fresh(), first, EXPERIENCED), second, EXPERIENCED, { metatype: 'human' });
        const once = applyConcept(fresh(), second, EXPERIENCED, { metatype: 'human' });
        expect({ ...twice, lifestyles: once.lifestyles }, `${first.id} then ${second.id}`).toEqual(once);
      }
    }
  });

  it('under Sum to Ten the card’s order is kept (it costs exactly 10)', () => {
    const s = settingsFor({ allowSumToTen: true });
    const draft = CharacterBuildSchema.parse({ ...fresh(s), method: 'sumToTen' });
    const applied = applyConcept(draft, CONCEPT_PRESET_BY_ID.adept, s);
    expect(applied.method).toBe('sumToTen');
    expect(applied.priorities).toEqual(CONCEPT_PRESET_BY_ID.adept.priorities);
    expect(budgets(applied, s).pools.priorityPoints?.remaining).toBe(0);
    expect(describeBlockers(blockers(applied, s))).toEqual([]);
  });
});

describe('applyConcept: qualities that change what a card can buy (pp. 81, 85; §8.4)', () => {
  it('Incompetent in a group the card buys: the group is skipped and its points spent elsewhere', () => {
    const before = CharacterBuildSchema.parse({
      ...fresh(),
      qualities: [{ name: 'Incompetent', type: 'negative', karma: 5, target: 'Influence' }],
    });
    const applied = applyConcept(before, CONCEPT_PRESET_BY_ID.face, EXPERIENCED);
    expect(applied.skills.groups.some((g) => g.id === 'influence')).toBe(false);
    expect(budgets(applied, EXPERIENCED).pools.groups.remaining).toBe(0);
    expect(describeBlockers(blockers(applied, EXPERIENCED))).toEqual([]);
  });

  it('Uncouth with doubled priority points: social groups barred, social skills at two points a rank, still fully spent', () => {
    const s = settingsFor({ uncouthDoublesPriorityPoints: true });
    const before = CharacterBuildSchema.parse({
      ...fresh(s),
      qualities: [{ name: 'Uncouth', type: 'negative', karma: 14 }],
    });
    for (const card of CARDS) {
      const applied = applyConcept(before, card, s);
      expect(describeBlockers(blockers(applied, s)), card.id).toEqual([]);
      expect(applied.skills.groups.some((g) => g.id === 'influence' || g.id === 'acting'), card.id).toBe(false);
    }
    // The face's ten group points find a couple of homes at a useful rating,
    // away from the skills it suggests, rather than ten groups at 1.
    const face = applyConcept(before, CONCEPT_PRESET_BY_ID.face, s);
    expect(face.skills.groups.length).toBeLessThanOrEqual(3);
    const suggested = new Set(CONCEPT_PRESET_BY_ID.face.spend!.skills.map((sk) => sk.id));
    for (const g of face.skills.groups) {
      expect(SKILL_GROUP_BY_ID[g.id as keyof typeof SKILL_GROUP_BY_ID].skills.some((id) => suggested.has(id)), g.id).toBe(false);
    }
    expect(ratings(face, s).skills.find((sk) => sk.id === 'intimidation')?.rating).toBe(6);
  });

  it('Uneducated with doubled priority points: every card still spends to the last point', () => {
    const s = settingsFor({ uncouthDoublesPriorityPoints: true });
    const before = CharacterBuildSchema.parse({
      ...fresh(s),
      qualities: [{ name: 'Uneducated', type: 'negative', karma: 20 }],
    });
    for (const card of CARDS) {
      expect(describeBlockers(blockers(applyConcept(before, card, s), s)), card.id).toEqual([]);
    }
  });
});

describe('applyConcept: "start from nothing"', () => {
  it('is an empty build and the nine steps: every section of the spend cleared, the identity kept (its pitch, §4.4 Step 1)', () => {
    const carded = applyConcept(
      CharacterBuildSchema.parse({
        ...fresh(),
        identity: { alias: 'Lantern', realName: 'Ada Vell', background: 'Grew up over a noodle bar.' },
        qualities: [{ name: 'Guts', catalogueId: 'q-guts', type: 'positive', karma: 10 }],
        skills: { languages: [{ name: 'English', native: true }] },
        karma: { toNuyen: 3, contacts: [{ name: 'Mother Ruin', role: 'fence', connection: 3, loyalty: 2 }] },
      }),
      CONCEPT_PRESET_BY_ID.shaman,
      EXPERIENCED,
    );
    const blank = applyConcept(carded, BLANK, EXPERIENCED);
    const empty = fresh();
    for (const field of [
      'priorities',
      'metatype',
      'special',
      'attributes',
      'magic',
      'grants',
      'powers',
      'qualities',
      'skills',
      'purchases',
      'lifestyles',
      'karma',
    ] as const) {
      expect(blank[field], field).toEqual(empty[field]);
    }
    expect(blank.identity).toEqual({ ...carded.identity, concept: 'blank' });
    expect([blank.method, blank.level, blank.table, blank.step, blank.mode]).toEqual([carded.method, carded.level, carded.table, carded.step, carded.mode]);
    // One behaviour: the engine's blank card is `clearSpend` with the card marked.
    expect(blank).toEqual({ ...clearSpend(carded), identity: { ...carded.identity, concept: 'blank' } });
  });
});
