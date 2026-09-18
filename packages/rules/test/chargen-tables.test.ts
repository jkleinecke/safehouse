/**
 * The character-creation tables (`chargen/`, FR3.9): every number the builder
 * spends against, pinned to the page it was read from.
 *
 * Two kinds of test live here. Structural ones keep the tables honest with
 * themselves — 75 skills and 15 groups whose members exist, nine attributes
 * with base ≤ max on every metatype, five levels by five columns in both
 * printings of the priority table, a page ref on every row — and hold the
 * new skill table, the generator's attribute map and `refs.ts` in agreement
 * so no module drifts away from the others. Pinning ones quote a
 * representative cell per table straight from the book map, each naming its
 * page, so a typo in a table fails a test that says where to look.
 *
 * The advancement costs are checked against the whole printed Karma
 * Advancement Table (SR5 p. 107), cell by cell; the worked examples' own
 * sums (pp. 96–106) back them up. No book text — only numbers and ids.
 */
import { describe, expect, it } from 'vitest';
import {
  AUGMENT_GRADES,
  CHARGEN_LEVEL_PRESETS,
  CREATION_LEVELS,
  PRIORITY_COLUMNS,
  PRIORITY_LEVELS,
  PRIORITY_TABLES,
  type PriorityLevel,
  type Ref,
} from '@safehouse/contracts';
import {
  ACTIVE_SKILL_BY_ID,
  ACTIVE_SKILL_IDS,
  ACTIVE_SKILL_TABLE,
  CORE_METATYPE_IDS,
  CREATION_ATTRIBUTE_RULES,
  CREATION_CONTACT_RULES,
  BOOK_QUALITY_CAP,
  CREATION_LEVEL_PRESETS,
  CREATION_SKILL_RULES,
  DEFAULT_SKILL_ATTRS,
  FOCUS_LIMITS,
  FOCUS_SUBTYPES,
  FOCUS_TYPE_IDS,
  FOCUS_TYPES,
  IMPLANT_GRADES,
  KARMA_COSTS,
  KNOWLEDGE_CATEGORY_TABLE,
  LANGUAGE_SKILL,
  LIFESTYLES,
  MAGIC_KIND_TABLE,
  METATYPE_ATTRIBUTES,
  METATYPE_BY_ID,
  METATYPE_IDS,
  METATYPE_TABLE,
  PRIORITY_CHARTS,
  QUALITY_RULES,
  QUALITY_RULE_BY_ID,
  QUALITY_RULE_IDS,
  RACIAL_QUALITY_TRAITS,
  bornQualities,
  SKILL_GROUP_BY_ID,
  SKILL_GROUP_IDS,
  SKILL_GROUP_TABLE,
  SPRITE_TYPE_IDS,
  SPRITE_TYPES_REF,
  SUM_TO_TEN,
  TRADITIONS,
  activeSkillRow,
  focusBondingKarma,
  focusSpendType,
  focusTypeOf,
  focusTypesOf,
  hasRacialTrait,
  isQualityBuyOff,
  karmaForActiveSkill,
  karmaForAttribute,
  karmaForInitiation,
  karmaForKnowledgeSkill,
  karmaForQualityBuyOff,
  karmaForQualityInPlay,
  karmaForSkillGroup,
  lifestyleMultiplierFor,
  lifestyleRow,
  magicPriorityOption,
  magicRowOffers,
  metatypeKarmaFor,
  metatypeRow,
  normalizeQualityName,
  qualityKarmaFor,
  qualityRatingRange,
  qualityRuleFor,
  racialQualities,
  skillAttrFor,
  skillGroup,
  skillGroupRow,
  specialPointsFor,
  startingNuyenFor,
  trainingTime,
  type MetatypeRow,
} from '../src/index.js';

const expectRef = (ref: Ref, book?: string, page?: number) => {
  expect(['SR5', 'RF']).toContain(ref.book);
  expect(Number.isInteger(ref.page) && ref.page > 0).toBe(true);
  if (book !== undefined) expect(ref.book).toBe(book);
  if (page !== undefined) expect(ref.page).toBe(page);
};

// ---------------------------------------------------------------------------

describe('skills: the p.90 list', () => {
  it('has 75 active skills with unique ids, in the id tuple order', () => {
    expect(ACTIVE_SKILL_TABLE).toHaveLength(75);
    expect(new Set(ACTIVE_SKILL_IDS).size).toBe(75);
    expect(ACTIVE_SKILL_TABLE.map((s) => s.id)).toEqual([...ACTIVE_SKILL_IDS]);
    for (const skill of ACTIVE_SKILL_TABLE) expectRef(skill.ref, 'SR5');
  });

  it('files them under their linked attributes as p.90 counts them (AGI 17 … RES 3)', () => {
    const counts: Record<string, number> = {};
    for (const s of ACTIVE_SKILL_TABLE) counts[s.attr] = (counts[s.attr] ?? 0) + 1;
    expect(counts).toEqual({ agi: 17, bod: 2, rea: 6, str: 2, cha: 9, int: 6, log: 19, wil: 2, mag: 9, res: 3 });
  });

  it('has 15 skill groups, every member a real skill that names the group back (p.90)', () => {
    expect(SKILL_GROUP_TABLE).toHaveLength(15);
    expect(SKILL_GROUP_TABLE.map((g) => g.id)).toEqual([...SKILL_GROUP_IDS]);
    for (const group of SKILL_GROUP_TABLE) {
      expectRef(group.ref, 'SR5', 90);
      expect(group.skills.length).toBe(group.id === 'biotech' || group.id === 'engineering' ? 4 : 3);
      for (const id of group.skills) expect(ACTIVE_SKILL_BY_ID[id].group).toBe(group.id);
    }
    const grouped = ACTIVE_SKILL_TABLE.filter((s) => s.group !== null);
    expect(grouped).toHaveLength(SKILL_GROUP_TABLE.reduce((n, g) => n + g.skills.length, 0));
    expect(SKILL_GROUP_BY_ID.firearms.skills).toEqual(['automatics', 'longarms', 'pistols']);
    expect(SKILL_GROUP_BY_ID.biotech.skills).toEqual(['biotechnology', 'cybertechnology', 'first-aid', 'medicine']);
  });

  it('restricts the Magic and Resonance headings, and their groups, only (p.89; Arcana is not, §8.4)', () => {
    const restricted = ACTIVE_SKILL_TABLE.filter((s) => s.restricted !== null);
    expect(restricted).toHaveLength(12);
    expect(ACTIVE_SKILL_BY_ID.arcana.restricted).toBeNull();
    expect(ACTIVE_SKILL_BY_ID.assensing.restricted).toBeNull();
    expect(ACTIVE_SKILL_BY_ID.spellcasting.restricted).toBe('magic');
    expect(ACTIVE_SKILL_BY_ID.registering.restricted).toBe('resonance');
    const restrictedGroups = SKILL_GROUP_TABLE.filter((g) => g.restricted !== null).map((g) => [g.id, g.restricted]);
    expect(restrictedGroups).toEqual([
      ['conjuring', 'magic'],
      ['enchanting', 'magic'],
      ['sorcery', 'magic'],
      ['tasking', 'resonance'],
    ]);
  });

  it('pins representative rows to their Skills-chapter entries', () => {
    expect(ACTIVE_SKILL_BY_ID.pistols).toMatchObject({ attr: 'agi', group: 'firearms', category: 'combat', canDefault: true });
    expectRef(ACTIVE_SKILL_BY_ID.pistols.ref, 'SR5', 132);
    expect(ACTIVE_SKILL_BY_ID.palming).toMatchObject({ attr: 'agi', group: 'stealth', canDefault: false });
    expectRef(ACTIVE_SKILL_BY_ID.palming.ref, 'SR5', 133);
    expect(ACTIVE_SKILL_BY_ID['exotic-ranged']).toMatchObject({ specific: true, canDefault: false, group: null });
    expectRef(ACTIVE_SKILL_BY_ID['exotic-ranged'].ref, 'SR5', 131);
    expect(ACTIVE_SKILL_BY_ID['exotic-melee'].specific).toBe(true);
    expectRef(ACTIVE_SKILL_BY_ID['exotic-melee'].ref, 'SR5', 90); // no chapter entry
    expect(ACTIVE_SKILL_BY_ID['pilot-exotic-vehicle']).toMatchObject({ attr: 'rea', specific: true });
    expect(ACTIVE_SKILL_BY_ID['pilot-aerospace']).toMatchObject({ attr: 'rea', canDefault: false, category: 'vehicle' });
    expect(ACTIVE_SKILL_BY_ID.gunnery).toMatchObject({ attr: 'agi', category: 'vehicle' });
    expect(ACTIVE_SKILL_BY_ID.survival).toMatchObject({ attr: 'wil', group: 'outdoors' });
    expect(ACTIVE_SKILL_BY_ID.spellcasting).toMatchObject({ attr: 'mag', group: 'sorcery' });
    expectRef(ACTIVE_SKILL_BY_ID.spellcasting.ref, 'SR5', 143);
    expect(ACTIVE_SKILL_TABLE.filter((s) => s.specific).map((s) => s.id)).toEqual([
      'exotic-melee',
      'exotic-ranged',
      'pilot-exotic-vehicle',
    ]);
  });

  it('agrees with the generator attribute map on all 75 skills — artificing, disenchanting and pilot-aerospace included', () => {
    expect(Object.keys(DEFAULT_SKILL_ATTRS).sort()).toEqual([...ACTIVE_SKILL_IDS].sort());
    for (const skill of ACTIVE_SKILL_TABLE) expect([skill.id, DEFAULT_SKILL_ATTRS[skill.id]]).toEqual([skill.id, skill.attr]);
    expect(skillAttrFor('artificing')).toBe('mag');
    expect(skillAttrFor('disenchanting')).toBe('mag');
    expect(skillAttrFor('pilot-aerospace')).toBe('rea');
  });

  it("agrees with refs.ts on each skill's chapter category", () => {
    for (const skill of ACTIVE_SKILL_TABLE) expect([skill.id, skillGroup(skill.id)]).toEqual([skill.id, skill.category]);
  });

  it('looks skills and groups up tolerantly, and refuses what is not there', () => {
    expect(activeSkillRow('Unarmed Combat')?.id).toBe('unarmed-combat');
    expect(activeSkillRow('first_aid')?.id).toBe('first-aid');
    expect(activeSkillRow('street-rumours')).toBeNull();
    expect(skillGroupRow('Close Combat')?.skills).toEqual(['blades', 'clubs', 'unarmed-combat']);
    expect(skillGroupRow('nope')).toBeNull();
  });

  it('links knowledge categories and languages as p.89 and p.91 do', () => {
    expect(KNOWLEDGE_CATEGORY_TABLE.academic.attr).toBe('log');
    expect(KNOWLEDGE_CATEGORY_TABLE.professional.attr).toBe('log');
    expect(KNOWLEDGE_CATEGORY_TABLE.interests.attr).toBe('int');
    expect(KNOWLEDGE_CATEGORY_TABLE.street.attr).toBe('int');
    for (const row of Object.values(KNOWLEDGE_CATEGORY_TABLE)) expectRef(row.ref, 'SR5', 89);
    expect(LANGUAGE_SKILL.attr).toBe('int');
    expectRef(LANGUAGE_SKILL.ref, 'SR5', 91);
  });

  it('caps ratings at 6, 7 with Aptitude, and gives (INT + LOG) × 2 knowledge points (pp.88–91)', () => {
    expect(CREATION_SKILL_RULES).toMatchObject({
      maxRating: 6,
      maxRatingWithAptitude: 7,
      maxRatingInPlay: 12,
      maxRatingInPlayWithAptitude: 13,
      maxKnowledgeRating: 6,
      knowledgePointsPerIntLog: 2,
      nativeLanguages: 1,
      nativeLanguagesWithBilingual: 2,
      specializationPoints: 1,
    });
    // The three worked characters' knowledge pools (pp.91–92): (4+4)×2, (3+3)×2, (4+3)×2.
    expect([4 + 4, 3 + 3, 4 + 3].map((n) => n * CREATION_SKILL_RULES.knowledgePointsPerIntLog)).toEqual([16, 12, 14]);
  });
});

// ---------------------------------------------------------------------------

const range = (m: MetatypeRow) =>
  METATYPE_ATTRIBUTES.map((code) => `${m.attributes[code].base}/${m.attributes[code].max}`).join(' ');

describe('metatypes: SR5 p.65–66 and Run Faster p.102–107', () => {
  it('lists the five core metatypes, 17 metavariants, 4 metasapients and 10 shapeshifters once each', () => {
    expect(METATYPE_TABLE.map((m) => m.id)).toEqual([...METATYPE_IDS]);
    expect(new Set(METATYPE_IDS).size).toBe(METATYPE_IDS.length);
    const families: Record<string, number> = {};
    for (const m of METATYPE_TABLE) families[m.family] = (families[m.family] ?? 0) + 1;
    expect(families).toEqual({ core: 5, metavariant: 17, metasapient: 4, shapeshifter: 10 });
  });

  it('gives every metatype nine attributes with 1 ≤ base ≤ max, and a page', () => {
    for (const m of METATYPE_TABLE) {
      expect(Object.keys(m.attributes)).toEqual([...METATYPE_ATTRIBUTES]);
      for (const code of METATYPE_ATTRIBUTES) {
        const r = m.attributes[code];
        expect(r.base).toBeGreaterThanOrEqual(1);
        expect(r.base).toBeLessThanOrEqual(r.max);
      }
      expect(m.magic.max).toBe(CREATION_ATTRIBUTE_RULES.specialMax);
      expectRef(m.ref);
    }
  });

  it('pins the core attribute table (p.66)', () => {
    expect(range(METATYPE_BY_ID.human)).toBe('1/6 1/6 1/6 1/6 1/6 1/6 1/6 1/6 2/7');
    expect(range(METATYPE_BY_ID.elf)).toBe('1/6 2/7 1/6 1/6 1/6 1/6 1/6 3/8 1/6');
    expect(range(METATYPE_BY_ID.dwarf)).toBe('3/8 1/6 1/5 3/8 2/7 1/6 1/6 1/6 1/6');
    expect(range(METATYPE_BY_ID.ork)).toBe('4/9 1/6 1/6 3/8 1/6 1/5 1/6 1/5 1/6');
    expect(range(METATYPE_BY_ID.troll)).toBe('5/10 1/5 1/6 5/10 1/6 1/5 1/5 1/4 1/6');
    for (const id of CORE_METATYPE_IDS) expectRef(METATYPE_BY_ID[id].ref, 'SR5', 66);
  });

  it('pins special attribute points per priority, null where the metatype is not on the row (p.65)', () => {
    const special = (id: (typeof CORE_METATYPE_IDS)[number]) => PRIORITY_LEVELS.map((l) => specialPointsFor(id, l));
    expect(special('human')).toEqual([9, 7, 5, 3, 1]);
    expect(special('elf')).toEqual([8, 6, 3, 0, null]);
    expect(special('dwarf')).toEqual([7, 4, 1, null, null]);
    expect(special('ork')).toEqual([7, 4, 0, null, null]);
    expect(special('troll')).toEqual([5, 0, null, null, null]);
    for (const id of CORE_METATYPE_IDS) {
      for (const level of PRIORITY_LEVELS) {
        const cell = METATYPE_BY_ID[id].priority[level];
        if (cell) {
          expect(cell.karma).toBe(0);
          expectRef(cell.ref, 'SR5', 65);
        }
      }
    }
  });

  it('carries the core racial traits and lifestyle surcharges (p.66)', () => {
    expect(hasRacialTrait(METATYPE_BY_ID.elf, 'lowLight')).toBe(true);
    expect(hasRacialTrait(METATYPE_BY_ID.ork, 'lowLight')).toBe(true);
    expect(METATYPE_BY_ID.dwarf.traits).toEqual([{ id: 'thermographic' }, { id: 'toxinDice', value: 2 }]);
    expect(METATYPE_BY_ID.troll.traits).toEqual([
      { id: 'thermographic' },
      { id: 'reach', value: 1 },
      { id: 'dermalArmor', value: 1 },
    ]);
    expect(METATYPE_BY_ID.human.traits).toEqual([]);
    expect(CORE_METATYPE_IDS.map((id) => METATYPE_BY_ID[id].lifestyleMultiplier)).toEqual([1, 1, 1.2, 1, 2]);
    expect(CORE_METATYPE_IDS.map((id) => METATYPE_BY_ID[id].magic.base)).toEqual([0, 0, 0, 0, 0]);
  });

  it('pins Run Faster metavariant attributes (RF p.104) and extended chart cells (RF p.106–107)', () => {
    expect(range(METATYPE_BY_ID.gnome)).toBe('1/4 2/7 1/6 1/4 2/7 2/7 1/6 1/6 1/6');
    expect(range(METATYPE_BY_ID.cyclops)).toBe('5/10 1/5 1/6 6/11 1/6 1/4 1/5 1/4 1/6');
    expect(PRIORITY_LEVELS.map((l) => specialPointsFor('gnome', l))).toEqual([7, 4, 1, null, null]);
    expect(metatypeKarmaFor('gnome', 'C')).toBe(7);
    expect(PRIORITY_LEVELS.map((l) => specialPointsFor('nartaki', l))).toEqual([8, 6, 4, 2, 1]);
    expect(PRIORITY_LEVELS.map((l) => metatypeKarmaFor('wakyambi', l))).toEqual([12, 12, 12, 12, null]);
    expect(PRIORITY_LEVELS.map((l) => specialPointsFor('fomorian', l))).toEqual([5, 0, null, null, null]);
    expect(metatypeKarmaFor('fomorian', 'A')).toBe(12);
    expect(metatypeKarmaFor('hobgoblin', 'C')).toBe(5); // printed "+5", same value
    expect(METATYPE_BY_ID.gnome).toMatchObject({ family: 'metavariant', variantOf: 'dwarf', lifestyleMultiplier: 1.2 });
    expect(METATYPE_BY_ID.minotaur).toMatchObject({ variantOf: 'troll', lifestyleMultiplier: 2 });
    expect(METATYPE_BY_ID.giant.traits).toContainEqual({ id: 'reach', value: 1 });
    expectRef(METATYPE_BY_ID.gnome.priority.A!.ref, 'RF', 106);
    expectRef(METATYPE_BY_ID.gnome.priority.C!.ref, 'RF', 107);
    expectRef(METATYPE_BY_ID.gnome.ref, 'RF', 104);
  });

  it('gives metasapients and shapeshifters natural Magic 1 and no Resonance (RF p.102, p.105)', () => {
    const naga = METATYPE_BY_ID.naga;
    expect(range(naga)).toBe('3/8 1/4 2/7 4/9 2/7 1/6 1/6 2/7 1/5');
    expect(naga).toMatchObject({ family: 'metasapient', variantOf: null, lifestyleMultiplier: 2.5, resonance: null });
    expect(naga.magic).toEqual({ base: 1, max: 6 });
    expect(naga.traits).toContainEqual({ id: 'armor', value: 8 });
    expect(PRIORITY_LEVELS.map((l) => specialPointsFor('centaur', l))).toEqual([6, 3, 0, null, null]);
    expect(metatypeKarmaFor('centaur', 'A')).toBe(25);
    expect(range(METATYPE_BY_ID.pixie)).toBe('1/2 3/8 3/8 1/2 3/8 2/7 2/7 3/8 2/7');
    expect(METATYPE_BY_ID.sasquatch.lifestyleMultiplier).toBe(2);

    const ursine = METATYPE_BY_ID['shapeshifter-ursine'];
    expect(range(ursine)).toBe('6/11 1/5 1/5 7/12 1/5 1/5 1/6 1/6 1/5');
    expect(ursine.traits).toContainEqual({ id: 'initiativeDice', value: 1 });
    expect(METATYPE_BY_ID['shapeshifter-falconine'].traits).toContainEqual({ id: 'initiativeDice', value: 2 });
    expect(PRIORITY_LEVELS.map((l) => specialPointsFor('shapeshifter-bovine', l))).toEqual([8, 6, 4, null, null]);
    expect(PRIORITY_LEVELS.map((l) => specialPointsFor('shapeshifter-vulpine', l))).toEqual([8, 6, 4, null, null]);
    expect(metatypeKarmaFor('shapeshifter-tigrine', 'B')).toBe(25);
    for (const m of METATYPE_TABLE.filter((r) => r.family === 'shapeshifter')) {
      expect(m.attributes.edg).toEqual({ base: 1, max: 5 }); // all shapeshifters, RF p.103
      expect(m.magic.base).toBe(1);
      expect(m.resonance).toBeNull();
      expect(hasRacialTrait(m, 'shift')).toBe(true);
    }
  });

  it('charges each metatype the same extra Karma on every row it appears on', () => {
    for (const m of METATYPE_TABLE) {
      const karma = new Set(PRIORITY_LEVELS.map((l) => m.priority[l]?.karma).filter((k) => k !== undefined));
      expect(karma.size).toBe(1);
      expect(m.priority.A).not.toBeNull(); // every metatype is on row A
    }
  });

  it('finds a metatype by a sheet string (case, spaces, orc)', () => {
    expect(metatypeRow('Troll')?.id).toBe('troll');
    expect(metatypeRow('orc')?.id).toBe('ork');
    expect(metatypeRow('Xapiri Thepe')?.id).toBe('xapiri-thepe');
    expect(metatypeRow('street legend')).toBeNull();
    expect(metatypeRow(undefined)).toBeNull();
  });

  it('keeps the attribute fences of pp.65–66 and the +4 augmentation cap of p.94', () => {
    expect(CREATION_ATTRIBUTE_RULES).toMatchObject({
      specialMax: 6,
      qualityMaxBonus: 1,
      maxAtNaturalLimit: 1,
      augmentedBonusCap: 4,
    });
  });
});

// ---------------------------------------------------------------------------

describe('priority table: SR5 p.65 and RF p.63', () => {
  it('has five levels by five columns in both printings', () => {
    for (const id of PRIORITY_TABLES) {
      const table = PRIORITY_CHARTS[id];
      expect(Object.keys(table)).toEqual([...PRIORITY_LEVELS]);
      for (const level of PRIORITY_LEVELS) {
        const row = table[level];
        expect(row.level).toBe(level);
        for (const column of PRIORITY_COLUMNS) expect(row).toHaveProperty(column);
        expectRef(row.ref, id === 'sr5' ? 'SR5' : 'RF', id === 'sr5' ? 65 : 63);
        for (const option of row.magic) expectRef(option.ref);
      }
    }
  });

  it('pins the attribute, skill and experienced resource columns (p.65)', () => {
    const t = PRIORITY_CHARTS.sr5;
    expect(PRIORITY_LEVELS.map((l) => t[l].attributes)).toEqual([24, 20, 16, 14, 12]);
    expect(PRIORITY_LEVELS.map((l) => [t[l].skills.points, t[l].skills.groupPoints])).toEqual([
      [46, 10],
      [36, 5],
      [28, 2],
      [22, 0],
      [18, 0],
    ]);
    expect(PRIORITY_LEVELS.map((l) => t[l].resources.experienced)).toEqual([450_000, 275_000, 140_000, 50_000, 6_000]);
  });

  it('pins street and prime resources (p.64)', () => {
    const t = PRIORITY_CHARTS.sr5;
    expect(PRIORITY_LEVELS.map((l) => t[l].resources.street)).toEqual([75_000, 50_000, 25_000, 15_000, 6_000]);
    expect(PRIORITY_LEVELS.map((l) => t[l].resources.prime)).toEqual([500_000, 325_000, 210_000, 150_000, 100_000]);
  });

  it('reads the metatype column off the metatype table — no troll on C, only humans on E (p.65)', () => {
    const t = PRIORITY_CHARTS.sr5;
    expect(t.A.metatype).toEqual({ human: 9, elf: 8, dwarf: 7, ork: 7, troll: 5 });
    expect(t.C.metatype).toEqual({ human: 5, elf: 3, dwarf: 1, ork: 0 });
    expect(t.E.metatype).toEqual({ human: 1 });
  });

  it('says whether a Magic row offers a type that uses Magic or Resonance', () => {
    expect(magicRowOffers('sr5', 'A', 'mag')).toBe(true);
    expect(magicRowOffers('sr5', 'A', 'res')).toBe(true);
    // Row D: adept and aspected magician only — Magic, never Resonance; E offers nothing.
    expect(magicRowOffers('sr5', 'D', 'mag')).toBe(true);
    expect(magicRowOffers('sr5', 'D', 'res')).toBe(false);
    expect(magicRowOffers('sr5', 'E', 'mag')).toBe(false);
    expect(magicRowOffers('sr5', 'E', 'res')).toBe(false);
  });

  it('pins the magic column the printings share (p.65)', () => {
    expect(magicPriorityOption('sr5', 'A', 'magician')).toMatchObject({
      attribute: 'mag',
      rating: 6,
      skills: { count: 2, rating: 5, pool: { kind: 'category', category: 'magical' } },
      formulae: 10,
    });
    expect(magicPriorityOption('sr5', 'A', 'mysticAdept')?.formulae).toBe(10);
    expect(magicPriorityOption('sr5', 'B', 'magician')).toMatchObject({ rating: 4, skills: { count: 2, rating: 4 }, formulae: 7 });
    expect(magicPriorityOption('sr5', 'C', 'magician')).toMatchObject({ rating: 3, skills: null, formulae: 5 });
    expect(magicPriorityOption('sr5', 'B', 'adept')).toMatchObject({ rating: 6, skills: { count: 1, rating: 4, pool: { kind: 'any' } } });
    expect(magicPriorityOption('sr5', 'C', 'adept')).toMatchObject({ rating: 4, skills: { count: 1, rating: 2 } });
    expect(magicPriorityOption('sr5', 'B', 'aspected')).toMatchObject({
      rating: 5,
      groups: { count: 1, rating: 4, groups: ['sorcery', 'conjuring', 'enchanting'] },
    });
    expect(magicPriorityOption('sr5', 'D', 'adept')).toMatchObject({ rating: 2, skills: null });
    expect(magicPriorityOption('sr5', 'D', 'aspected')).toMatchObject({ rating: 2, groups: null });
    expect(magicPriorityOption('sr5', 'A', 'adept')).toBeNull();
    expect(magicPriorityOption('sr5', 'D', 'magician')).toBeNull();
    expect(PRIORITY_CHARTS.sr5.E.magic).toEqual([]);
  });

  it('gives the core technomancer three skills from Resonance/Electronics/Cracking and 7/4/3 forms (SR5 p.65)', () => {
    const pool = { kind: 'groups', groups: ['tasking', 'electronics', 'cracking'] };
    expect(magicPriorityOption('sr5', 'A', 'technomancer')).toMatchObject({ attribute: 'res', rating: 6, skills: { count: 3, rating: 5, pool }, forms: 7 });
    expect(magicPriorityOption('sr5', 'B', 'technomancer')).toMatchObject({ rating: 4, skills: { count: 3, rating: 4 }, forms: 4 });
    expect(magicPriorityOption('sr5', 'C', 'technomancer')).toMatchObject({ rating: 3, skills: { count: 3, rating: 2 }, forms: 3 });
  });

  it("gives Run Faster's technomancer two Resonance skills and 5/2/1 forms, none at C — the row the p.70 example follows (RF p.63)", () => {
    const pool = { kind: 'category', category: 'resonance' };
    expect(magicPriorityOption('rf', 'A', 'technomancer')).toMatchObject({ rating: 6, skills: { count: 2, rating: 5, pool }, forms: 5 });
    expect(magicPriorityOption('rf', 'B', 'technomancer')).toMatchObject({ rating: 4, skills: { count: 2, rating: 4, pool }, forms: 2 });
    expect(magicPriorityOption('rf', 'C', 'technomancer')).toMatchObject({ rating: 3, skills: null, forms: 1 });
  });

  it('differs between printings only in the technomancer cells', () => {
    const strip = (level: PriorityLevel, id: 'sr5' | 'rf') => {
      const { ref: _ref, magic, ...rest } = PRIORITY_CHARTS[id][level];
      return { ...rest, magic: magic.filter((o) => o.kind !== 'technomancer').map(({ ref: _r, ...o }) => o) };
    };
    for (const level of PRIORITY_LEVELS) expect(strip(level, 'rf')).toEqual(strip(level, 'sr5'));
  });

  it('prices Sum to Ten at A4 B3 C2 D1 E0 from 10 points, the standard array exactly 10 (RF p.62)', () => {
    expect(SUM_TO_TEN.points).toBe(10);
    expect(PRIORITY_LEVELS.map((l) => SUM_TO_TEN.cost[l])).toEqual([4, 3, 2, 1, 0]);
    expect(PRIORITY_LEVELS.reduce((sum, l) => sum + SUM_TO_TEN.cost[l], 0)).toBe(10);
    expectRef(SUM_TO_TEN.ref, 'RF', 62);
  });

  it('fences the magic-user types as p.69 lists them', () => {
    expect(MAGIC_KIND_TABLE.adept).toMatchObject({ powerPoints: 'free', magicalGroups: 'none', astralPerception: 'power' });
    expect(MAGIC_KIND_TABLE.mysticAdept).toMatchObject({ powerPoints: 'karma', magicalGroups: 'all', astralProjection: false });
    expect(MAGIC_KIND_TABLE.aspected).toMatchObject({ magicalGroups: 'aspect', astralPerception: 'innate', knownPerRating: 2 });
    expect(MAGIC_KIND_TABLE.magician).toMatchObject({ astralProjection: true, knownPerRating: 2 });
    expect(MAGIC_KIND_TABLE.technomancer).toMatchObject({ attribute: 'res', knownPerRating: 2 });
  });
});

// ---------------------------------------------------------------------------

describe('creation levels (p.62, p.64, p.94, p.98)', () => {
  it('pins street, experienced and prime', () => {
    expect(Object.keys(CREATION_LEVEL_PRESETS)).toEqual([...CREATION_LEVELS]);
    expect(CREATION_LEVEL_PRESETS.street).toMatchObject({
      karma: 13,
      qualityCap: 26,
      maxAvailability: 10,
      maxDeviceRating: 4,
      karmaToNuyenMax: 5,
      contactKarmaPerCharisma: 3,
      canInitiate: false,
    });
    expect(CREATION_LEVEL_PRESETS.experienced).toMatchObject({
      karma: 25,
      qualityCap: 25,
      maxAvailability: 12,
      maxDeviceRating: 6,
      karmaToNuyenMax: 10,
      contactKarmaPerCharisma: 3,
      canInitiate: false,
    });
    expect(CREATION_LEVEL_PRESETS.prime).toMatchObject({
      karma: 35,
      qualityCap: 70,
      maxAvailability: 15,
      maxDeviceRating: 6,
      karmaToNuyenMax: 25,
      contactKarmaPerCharisma: 6,
      canInitiate: true,
    });
    for (const level of CREATION_LEVELS) {
      expect(CREATION_LEVEL_PRESETS[level]).toMatchObject({ nuyenPerKarma: 2_000, karmaCarry: 7, nuyenCarry: 5_000 });
      // The overridable caps are the contracts' settings defaults, not a second copy.
      expect(CREATION_LEVEL_PRESETS[level]).toMatchObject(CHARGEN_LEVEL_PRESETS[level]);
      expectRef(CREATION_LEVEL_PRESETS[level].ref, 'SR5');
    }
    expect(BOOK_QUALITY_CAP).toBe(25); // p.71
  });

  it("converts street's 5 Karma to 10,000¥ and prime's 25 to 50,000¥ (p.64)", () => {
    const p = CREATION_LEVEL_PRESETS;
    expect(p.street.karmaToNuyenMax * p.street.nuyenPerKarma).toBe(10_000);
    expect(p.experienced.karmaToNuyenMax * p.experienced.nuyenPerKarma).toBe(20_000);
    expect(p.prime.karmaToNuyenMax * p.prime.nuyenPerKarma).toBe(50_000);
  });

  it('prices contacts at 2 to 7 Karma, one per Connection and Loyalty point (p.98)', () => {
    expect(CREATION_CONTACT_RULES).toMatchObject({ minKarmaPerContact: 2, maxKarmaPerContact: 7, karmaPerPoint: 1 });
  });
});

// ---------------------------------------------------------------------------

describe('advancement Karma: the p.107 tables', () => {
  // KARMA ADVANCEMENT TABLE FOR ATTRIBUTES, starting rating → desired 2..11 (null = printed "—").
  const ATTRIBUTE_TABLE: Record<number, readonly (number | null)[]> = {
    1: [10, 25, 45, 70, 100, 135, null, null, null, null],
    2: [null, 15, 35, 60, 90, 125, 165, null, null, null],
    3: [null, null, 20, 45, 75, 110, 150, 195, null, null],
    4: [null, null, null, 25, 55, 90, 130, 175, 225, null],
    5: [null, null, null, null, 30, 65, 105, 150, 200, 255],
    6: [null, null, null, null, null, 35, 75, 120, 170, 225],
    7: [null, null, null, null, null, null, 40, 85, 135, 190],
    8: [null, null, null, null, null, null, null, 45, 95, 150],
    9: [null, null, null, null, null, null, null, null, 50, 105],
    10: [null, null, null, null, null, null, null, null, null, 55],
  };

  it('prices every printed attribute cell as new rating × 5 per step', () => {
    let cells = 0;
    for (const [start, row] of Object.entries(ATTRIBUTE_TABLE)) {
      row.forEach((printed, i) => {
        if (printed === null) return;
        const desired = i + 2;
        expect([Number(start), desired, karmaForAttribute(Number(start), desired)]).toEqual([Number(start), desired, printed]);
        cells++;
      });
    }
    expect(cells).toBe(45);
  });

  it('prices active skills, groups and knowledge/language skills from 0 as the skill table prints (p.107)', () => {
    const upTo = (fn: (from: number, to: number) => number, n: number) => Array.from({ length: n }, (_, i) => fn(0, i + 1));
    expect(upTo(karmaForActiveSkill, 13)).toEqual([2, 6, 12, 20, 30, 42, 56, 72, 90, 110, 132, 156, 182]);
    expect(upTo(karmaForSkillGroup, 12)).toEqual([5, 15, 30, 50, 75, 105, 140, 180, 225, 275, 330, 390]);
    expect(upTo(karmaForKnowledgeSkill, 13)).toEqual([1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78, 91]);
  });

  it("reproduces the worked examples' sums (pp.99, 105–106)", () => {
    expect(karmaForAttribute(4, 5)).toBe(25); // p.105
    expect(karmaForAttribute(4, 6)).toBe(55); // p.105
    expect(karmaForActiveSkill(0, 3)).toBe(12); // a new skill to 3, p.105
    expect(karmaForActiveSkill(7, 8)).toBe(16); // p.106
    expect(karmaForAttribute(2, 3)).toBe(15); // raising Reaction, p.106
    expect(karmaForActiveSkill(1, 2)).toBe(4); // p.106
    expect(karmaForActiveSkill(2, 3) * 2).toBe(12); // two skills to 3, p.106
    expect(karmaForActiveSkill(5, 6)).toBe(12); // p.106
    expect(karmaForActiveSkill(0, 2)).toBe(6); // a new skill to 2, p.99
    expect(karmaForKnowledgeSkill(1, 2)).toBe(2); // a language 1→2, p.99
  });

  it('prices nothing for a raise that is not one', () => {
    expect(karmaForAttribute(4, 4)).toBe(0);
    expect(karmaForActiveSkill(5, 3)).toBe(0);
  });

  it('keeps the flat costs of the Character Improvement Table (p.107) and the p.98 purchases', () => {
    expect(KARMA_COSTS).toMatchObject({
      specialization: 7,
      newKnowledgeSkill: 1,
      spell: 5,
      complexForm: 4,
      powerPoint: 5,
      spiritService: 1,
      spriteTask: 1,
    });
    expect(karmaForInitiation(1)).toBe(13);
    expect(karmaForInitiation(3)).toBe(19);
    expect(karmaForQualityInPlay(14)).toBe(28);
    expect(karmaForQualityBuyOff(5)).toBe(10);
    expect(KARMA_COSTS.powerPoint * 2).toBe(10); // 10 Karma → 2 PP, p.70
  });

  it('times training by the Training Rate Table (p.107)', () => {
    expect(trainingTime('attribute', 3)).toEqual({ amount: 3, unit: 'week' }); // p.106
    expect(trainingTime('edge', 4)).toEqual({ amount: 0, unit: 'none' });
    expect(trainingTime('skill', 2)).toEqual({ amount: 2, unit: 'day' }); // p.106
    expect(trainingTime('skill', 4)).toEqual({ amount: 4, unit: 'day' });
    expect(trainingTime('skill', 6)).toEqual({ amount: 6, unit: 'week' }); // p.106
    expect(trainingTime('skill', 8)).toEqual({ amount: 8, unit: 'week' });
    expect(trainingTime('skill', 9)).toEqual({ amount: 18, unit: 'week' });
    expect(trainingTime('skillGroup', 3)).toEqual({ amount: 6, unit: 'week' });
    expect(trainingTime('specialization')).toEqual({ amount: 1, unit: 'month' });
  });
});

// ---------------------------------------------------------------------------

describe('implant grades (p.451; creation grades p.95)', () => {
  it('pins Essence, Availability and cost multipliers', () => {
    expect(Object.keys(IMPLANT_GRADES)).toEqual([...AUGMENT_GRADES]);
    expect(IMPLANT_GRADES.alphaware).toMatchObject({ essence: 0.8, availability: 2, cost: 1.2 });
    expect(IMPLANT_GRADES.betaware).toMatchObject({ essence: 0.7, availability: 4, cost: 1.5 });
    expect(IMPLANT_GRADES.deltaware).toMatchObject({ essence: 0.5, availability: 8, cost: 2.5 });
    expect(IMPLANT_GRADES.used).toMatchObject({ essence: 1.25, availability: -4, cost: 0.75 });
    for (const g of AUGMENT_GRADES) expectRef(IMPLANT_GRADES[g].ref, 'SR5', 451);
  });

  it('allows only standard, alphaware and used at creation', () => {
    expect(AUGMENT_GRADES.filter((g) => IMPLANT_GRADES[g].atCreation)).toEqual(['standard', 'alphaware', 'used']);
  });
});

describe('foci (bonding p.318, price p.461)', () => {
  it('bonds at Force × 2, 3 or 6 by type', () => {
    expect(focusBondingKarma('power', 3)).toBe(18);
    expect(focusBondingKarma('qi', 2)).toBe(4);
    expect(focusBondingKarma('weapon', 4)).toBe(12);
    expect(focusBondingKarma('spell', 1)).toBe(2);
    expect(Object.values(FOCUS_TYPES).map((f) => f.bondingKarmaPerForce)).toEqual([3, 3, 6, 2, 2, 2, 3]);
    for (const f of Object.values(FOCUS_TYPES)) {
      expectRef(f.ref, 'SR5', 318);
      expectRef(f.priceRef, 'SR5', 461);
    }
  });

  it('prices and gates by Force, which Availability 12 stops at Force 3 or 4', () => {
    expect(FOCUS_TYPES.weapon).toMatchObject({ nuyenPerForce: 7_000, availabilityPerForce: 4 });
    expect(FOCUS_TYPES.power).toMatchObject({ nuyenPerForce: 18_000, availabilityPerForce: 4 });
    expect(FOCUS_TYPES.qi).toMatchObject({ nuyenPerForce: 3_000, availabilityPerForce: 3 });
    const maxForceAt12 = (per: number) => Math.floor(12 / per);
    expect(maxForceAt12(FOCUS_TYPES.power.availabilityPerForce)).toBe(3);
    expect(maxForceAt12(FOCUS_TYPES.spell.availabilityPerForce)).toBe(4);
    expect(FOCUS_LIMITS).toMatchObject({ creationForcePerMagic: 2, playForcePerMagic: 5 });
  });
});

describe('traditions (p.279–280)', () => {
  it('resists Drain with LOG + WIL or CHA + WIL, and maps categories to spirits', () => {
    expect(TRADITIONS.hermetic.drain).toEqual(['log', 'wil']);
    expect(TRADITIONS.shamanic.drain).toEqual(['cha', 'wil']);
    expect(TRADITIONS.hermetic.spirits.combat).toBe('fire');
    expect(TRADITIONS.shamanic.spirits.combat).toBe('beasts');
    expect(TRADITIONS.shamanic.spirits.detection).toBe('water');
    expectRef(TRADITIONS.hermetic.ref, 'SR5', 279);
    expectRef(TRADITIONS.shamanic.ref, 'SR5', 280);
  });
});

describe('sprite types (p.258)', () => {
  it('lists the five a technomancer registers, as ids', () => {
    expect([...SPRITE_TYPE_IDS]).toEqual(['courier', 'crack', 'data', 'fault', 'machine']);
    expectRef(SPRITE_TYPES_REF, 'SR5', 258);
  });
});

describe('lifestyles (p.95; metatype surcharge p.66)', () => {
  it('pins monthly costs and the starting-nuyen dice', () => {
    expect(Object.values(LIFESTYLES).map((l) => l.monthly)).toEqual([0, 500, 2_000, 5_000, 10_000, 100_000]);
    expect(Object.values(LIFESTYLES).map((l) => `${l.startingDice}D6×${l.startingMultiplier}`)).toEqual([
      '1D6×20',
      '2D6×40',
      '3D6×60',
      '4D6×100',
      '5D6×500',
      '6D6×1000',
    ]);
    for (const l of Object.values(LIFESTYLES)) expectRef(l.ref, 'SR5', 95);
    expect(lifestyleRow('Middle')?.monthly).toBe(5_000);
    expect(lifestyleRow('hospitalized')).toBeNull();
  });

  it("turns the worked examples' dice into their starting nuyen (pp.96–97)", () => {
    // Middle, 4D6 totalling 22, plus a 4,995¥ carry-over = 7,195¥ (p.96).
    expect(startingNuyenFor('middle', 22) + 4_995).toBe(7_195);
    // Low, 3D6 totalling 12, plus 2,785¥ = 3,505¥ (p.97).
    expect(startingNuyenFor('low', 12) + 2_785).toBe(3_505);
  });

  it('reads the metatype multiplier off the metatype rows — dwarf ×1.2, troll ×2 (p.66), centaur ×2.5 (RF p.105)', () => {
    expect(lifestyleMultiplierFor('dwarf')).toBe(1.2);
    expect(lifestyleMultiplierFor('Troll')).toBe(2);
    expect(lifestyleMultiplierFor('centaur')).toBe(2.5);
    expect(lifestyleMultiplierFor('elf')).toBe(1);
    expect(lifestyleMultiplierFor(undefined)).toBe(1);
    // Low for 3 months as a troll: 2,000 × 3 × 2 = 12,000¥ (p.97).
    expect(LIFESTYLES.low.monthly * 3 * lifestyleMultiplierFor('troll')).toBe(12_000);
  });
});

// ---------------------------------------------------------------------------

describe('quality whitelist (§8.4)', () => {
  it('lists each whitelisted quality once, with at least one rule and its page', () => {
    expect(QUALITY_RULES.map((q) => q.id)).toEqual([...QUALITY_RULE_IDS]);
    for (const q of QUALITY_RULES) {
      expect(q.rules.length).toBeGreaterThan(0);
      expectRef(q.ref, 'SR5');
      for (const alias of q.aliases) expect(normalizeQualityName(alias)).toBe(alias);
      expect(qualityRuleFor(q.name)?.id).toBe(q.id);
    }
  });

  it("matches the book's own name drift", () => {
    expect(qualityRuleFor('Magical Resistance')?.id).toBe('magicResistance'); // p.73 table
    expect(qualityRuleFor('Magic Resistance')?.id).toBe('magicResistance'); // p.76 entry
    expect(qualityRuleFor('Dependent(s)')?.id).toBe('dependents');
    expect(qualityRuleFor('Dependents (6)')?.id).toBe('dependents');
    expect(qualityRuleFor('Exceptional Attribute [Strength]')?.id).toBe('exceptionalAttribute');
    expect(qualityRuleFor('Exceptional Attribute (Agility)')?.id).toBe('exceptionalAttribute');
    expect(qualityRuleFor('Exceptional Attribute - Charisma')?.id).toBe('exceptionalAttribute');
    expect(qualityRuleFor('Focused Concentration (Rating 2)')?.id).toBe('focusedConcentration');
    expect(qualityRuleFor('Will to Live 2')?.id).toBe('willToLive');
    expect(qualityRuleFor('Human Looking')?.id).toBe('humanLooking');
    expect(qualityRuleFor('HUMAN-LOOKING')?.id).toBe('humanLooking');
    expect(qualityRuleFor('Mentor Spirit: Sea')?.id).toBe('mentorSpirit');
    expect(qualityRuleFor('Incompetent (Outdoors)')?.id).toBe('incompetent');
  });

  it('leaves everything else to the page', () => {
    expect(qualityRuleFor('SINner (National)')).toBeNull();
    expect(qualityRuleFor('Natural Hardening')).toBeNull();
    expect(qualityRuleFor('Luckless')).toBeNull();
    expect(qualityRuleFor('')).toBeNull();
  });

  it('keeps exclusions symmetric: Exceptional Attribute with Lucky (p.66), Distinctive Style with Blandness (p.81)', () => {
    for (const q of QUALITY_RULES) {
      for (const rule of q.rules) {
        if (rule.kind !== 'exclusive') continue;
        for (const other of rule.with) {
          const back = QUALITY_RULE_BY_ID[other].rules.find((r) => r.kind === 'exclusive');
          expect(back?.kind === 'exclusive' && back.with.includes(q.id)).toBe(true);
        }
      }
    }
    expect(QUALITY_RULE_BY_ID.exceptionalAttribute.rules).toContainEqual({ kind: 'exclusive', with: ['lucky'] });
  });

  it('flags Exceptional Attribute and Lucky for the GM, once each (pp.66, 72, 76)', () => {
    expect(QUALITY_RULES.filter((q) => q.needsApproval).map((q) => q.id)).toEqual(['exceptionalAttribute', 'lucky']);
    expect(QUALITY_RULE_BY_ID.exceptionalAttribute.rules[0]).toEqual({ kind: 'attributeMaxPlusOne', excludes: ['edg'] });
    expect(QUALITY_RULE_BY_ID.lucky.rules[0]).toEqual({ kind: 'edgeMaxPlusOne' });
    expect(QUALITY_RULE_BY_ID.aptitude).toMatchObject({ once: true, rules: [{ kind: 'skillCapPlusOne' }] });
  });

  it('closes the social groups and doubles social costs for Uncouth (p.85); technical and academic/professional for Uneducated (p.87)', () => {
    expect(QUALITY_RULE_BY_ID.uncouth.rules).toContainEqual({ kind: 'barsGroup', groups: ['acting', 'influence'] });
    expect(QUALITY_RULE_BY_ID.uncouth.rules).toContainEqual(
      expect.objectContaining({ kind: 'doublesCosts', scope: expect.objectContaining({ skillCategories: ['social'] }) }),
    );
    expect(QUALITY_RULE_BY_ID.uneducated.rules[0]).toMatchObject({
      kind: 'doublesCosts',
      scope: { skillCategories: ['technical'], knowledgeCategories: ['academic', 'professional'], groups: true },
    });
    expect(QUALITY_RULE_BY_ID.incompetent.rules).toEqual([{ kind: 'barsGroup', groups: 'chosen' }]);
  });

  it('surcharges lifestyle 10/20/30% for Dependents at 3/6/9 Karma (p.80)', () => {
    const rule = QUALITY_RULE_BY_ID.dependents.rules.find((r) => r.kind === 'lifestyleMultiplierByRating');
    expect(rule?.kind === 'lifestyleMultiplierByRating' && rule.levels.map((l) => [l.karma, l.multiplier])).toEqual([
      [3, 1.1],
      [6, 1.2],
      [9, 1.3],
    ]);
  });

  it('gates the posers and Human-Looking by core metatype (pp.75, 81, 82)', () => {
    const gate = (id: 'humanLooking' | 'elfPoser' | 'orkPoser') => {
      const rule = QUALITY_RULE_BY_ID[id].rules[0];
      return rule?.kind === 'metatypeGate' ? rule.metatypes : null;
    };
    expect(gate('humanLooking')).toEqual(['elf', 'dwarf', 'ork']);
    expect(gate('elfPoser')).toEqual(['human']);
    expect(gate('orkPoser')).toEqual(['human', 'elf']);
  });

  it('fences the Awakened-only qualities and Magic Resistance (pp.72–85)', () => {
    const who = (id: (typeof QUALITY_RULE_IDS)[number]) =>
      QUALITY_RULE_BY_ID[id].rules.flatMap((r) => (r.kind === 'requiresAwakened' ? [r.who] : []));
    expect(who('mentorSpirit')).toEqual(['magicRating']);
    expect(who('astralChameleon')).toEqual(['magicRating']);
    expect(who('spiritAffinity')).toEqual(['magicRating']);
    expect(who('spiritBane')).toEqual(['magicRating']);
    expect(who('focusedConcentration')).toEqual(['spellcasterOrTechnomancer']);
    expect(QUALITY_RULE_BY_ID.magicResistance.rules).toEqual([{ kind: 'forbiddenWithMagic' }]);
    expect(QUALITY_RULE_BY_ID.sensitiveSystem.rules).toEqual([{ kind: 'cyberEssenceTimes2' }, { kind: 'noBioware' }]);
    expect(QUALITY_RULE_BY_ID.willToLive.rules).toEqual([{ kind: 'overflowPerRating', max: 3, karmaPerRating: 3 }]);
  });

  it('knows the Uneducated a metasapient is born with, and reads a positive line of that quality as its buy-off (RF pp.102–105)', () => {
    expect(RACIAL_QUALITY_TRAITS).toEqual({ uneducated: 'uneducated' });
    expect(racialQualities('sasquatch', [])).toEqual(['uneducated']);
    expect(racialQualities('troll', [])).toEqual([]);
    expect(racialQualities('sasquatch', [{ name: 'Uneducated', type: 'positive' }])).toEqual([]);
    expect(bornQualities('sasquatch')).toEqual(['uneducated']);
    expect(bornQualities('human')).toEqual([]);
    expect(isQualityBuyOff({ name: 'Uneducated', type: 'positive' }, 'sasquatch')).toBe(true);
    expect(isQualityBuyOff({ name: 'Uneducated', type: 'negative' }, 'sasquatch')).toBe(false);
    expect(isQualityBuyOff({ name: 'Uneducated' }, 'sasquatch')).toBe(false);
    // Only a quality the metatype is born with can be bought off: anyone else's positive line is a slip.
    expect(isQualityBuyOff({ name: 'Uneducated', type: 'positive' }, 'human')).toBe(false);
    expect(isQualityBuyOff({ name: 'Uncouth', type: 'positive' }, 'sasquatch')).toBe(false);
    // A positive quality recorded as negative is a slip, not a buy-off.
    expect(isQualityBuyOff({ name: 'Lucky', type: 'negative' }, 'sasquatch')).toBe(false);
  });

  it('reads the legal ratings of the rated whitelist qualities with their Karma: Will to Live 3 a rating (p.77), Dependents 3/6/9 (p.80)', () => {
    expect(qualityRatingRange(QUALITY_RULE_BY_ID.willToLive)).toEqual({
      min: 1,
      max: 3,
      levels: [
        { rating: 1, karma: 3 },
        { rating: 2, karma: 6 },
        { rating: 3, karma: 9 },
      ],
    });
    expect(qualityRatingRange(qualityRuleFor('Dependent(s)'))?.levels.map((l) => l.karma)).toEqual([3, 6, 9]);
    expect(qualityKarmaFor(QUALITY_RULE_BY_ID.dependents, 2)).toBe(6);
    expect(qualityKarmaFor(QUALITY_RULE_BY_ID.willToLive, 3)).toBe(9);
    // Off the range, unrated, off the whitelist: the catalogue row's price stands.
    expect(qualityKarmaFor(QUALITY_RULE_BY_ID.willToLive, 4)).toBeNull();
    expect(qualityKarmaFor(QUALITY_RULE_BY_ID.willToLive, 0)).toBeNull();
    expect(qualityRatingRange(QUALITY_RULE_BY_ID.lucky)).toBeNull();
    expect(qualityRatingRange(qualityRuleFor('SINner (National)'))).toBeNull();
    expect(qualityRatingRange(null)).toBeNull();
  });
});

describe('focus types (SR5 pp.318–320)', () => {
  it('reads a focus type out of a label or a name, sub-types included, and nothing out of a proper name', () => {
    expect(focusTypeOf('power')).toBe('power');
    expect(focusTypeOf('Power Focus')).toBe('power');
    expect(focusTypeOf('Sustaining Focus (Health)')).toBe('spell');
    expect(focusTypeOf('counterspelling focus')).toBe('spell');
    expect(focusTypeOf('Banishing Focus: Spirits of Air')).toBe('spirit');
    expect(focusTypeOf('Alchemical Focus')).toBe('enchanting');
    expect(focusTypeOf('Flexible Signature Focus')).toBe('metamagic');
    expect(focusTypeOf('qi focus: Improved Reflexes')).toBe('qi');
    expect(focusTypeOf('Weighted Chain')).toBeNull();
    expect(focusTypeOf('')).toBeNull();
    expect(Object.values(FOCUS_SUBTYPES).every((t) => (FOCUS_TYPE_IDS as readonly string[]).includes(t))).toBe(true);
    expect(focusSpendType({ name: 'Power Focus', focusType: 'Sword' })).toBe('power');
    expect(focusSpendType({ name: 'Ring', focusType: 'Sustaining' })).toBe('spell');
  });

  it('prices a label and a name that disagree at the dearer bond, never the one the label names (SR5 p.318)', () => {
    expect(focusTypesOf('spell', 'Power Focus', 'Sustaining Focus', 'Ring')).toEqual(['power', 'spell']);
    // Equal bonds keep the table's order.
    expect(focusTypesOf('qi', 'Weapon Focus (Katana)', 'enchanting')).toEqual(['enchanting', 'weapon', 'qi']);
    expect(focusTypesOf('Ring', null, undefined)).toEqual([]);
    expect(focusSpendType({ name: 'Power Focus', focusType: 'spell' })).toBe('power');
    expect(focusSpendType({ name: 'Power Focus', focusType: 'qi' })).toBe('power');
    expect(focusSpendType({ name: 'Weapon Focus (Katana)', focusType: 'spirit' })).toBe('weapon');
  });
});
