/**
 * The skill list the builder spends points on (FR3.9, docs/CHARGEN.md §8.4):
 * fifteen skill groups, seventy-five active skills, and the knowledge
 * categories — numbers, ids and page refs, no descriptions (DESIGN.md §14).
 *
 * This is the table the rest of the engine had been approximating. `refs.ts`
 * files skills by the Skills chapter's *categories* (combat, social, …) and
 * `generator/validity.ts` guesses linked attributes for NPCs; neither knew
 * the book's skill *groups* (Firearms, Athletics, …), which the priority
 * table's group points buy and which Incompetent and Uncouth bar. The ids are
 * the kebab-case ones those modules already use, so a sheet written by the
 * generator, the Chummer import or the builder names a skill the same way;
 * `chargen-tables.test.ts` holds all three in agreement.
 *
 * Read from the core rulebook: the group and attribute lists on p. 90 (the
 * canonical names — p. 151 reprints the list with drift, "Arcane" and an
 * "Enchanting" standing in for Artificing), the Default line and page of each
 * skill's entry in the Skills chapter, and the restriction headings (p. 89).
 * Exotic Melee Weapon has no chapter entry, so it cites p. 90 and follows its
 * ranged sibling in not defaulting.
 *
 * Pure data. The rules that read it (who may take a restricted skill, the
 * astral-perception fence on Assensing, aspected groups) live in the
 * validator, not here.
 */
import type { KnowledgeCategory, Ref, SkillAttr } from '@safehouse/contracts';
import type { SkillGroup } from '../refs.js';
import { SR5 } from './pages.js';

/**
 * The Skills chapter section a skill is described in — the same keys as
 * `SKILL_GROUP_REFS`. Uncouth doubles `social`, Uneducated `technical`.
 */
export type SkillCategory = SkillGroup;

/** Skills only a character with the matching special attribute may learn (p. 89). */
export type SkillRestriction = 'magic' | 'resonance';

export const SKILL_GROUP_IDS = [
  'acting',
  'athletics',
  'biotech',
  'close-combat',
  'conjuring',
  'cracking',
  'electronics',
  'enchanting',
  'firearms',
  'influence',
  'engineering',
  'outdoors',
  'sorcery',
  'stealth',
  'tasking',
] as const;
export type SkillGroupId = (typeof SKILL_GROUP_IDS)[number];

export const ACTIVE_SKILL_IDS = [
  // Agility
  'archery',
  'automatics',
  'blades',
  'clubs',
  'escape-artist',
  'exotic-melee',
  'exotic-ranged',
  'gunnery',
  'gymnastics',
  'heavy-weapons',
  'locksmith',
  'longarms',
  'palming',
  'pistols',
  'sneaking',
  'throwing-weapons',
  'unarmed-combat',
  // Body
  'diving',
  'free-fall',
  // Reaction
  'pilot-aerospace',
  'pilot-aircraft',
  'pilot-exotic-vehicle',
  'pilot-ground-craft',
  'pilot-walker',
  'pilot-watercraft',
  // Strength
  'running',
  'swimming',
  // Charisma
  'animal-handling',
  'con',
  'etiquette',
  'impersonation',
  'instruction',
  'intimidation',
  'leadership',
  'negotiation',
  'performance',
  // Intuition
  'artisan',
  'assensing',
  'disguise',
  'navigation',
  'perception',
  'tracking',
  // Logic
  'aeronautics-mechanic',
  'arcana',
  'armorer',
  'automotive-mechanic',
  'biotechnology',
  'chemistry',
  'computer',
  'cybercombat',
  'cybertechnology',
  'demolitions',
  'electronic-warfare',
  'first-aid',
  'forgery',
  'hacking',
  'hardware',
  'industrial-mechanic',
  'medicine',
  'nautical-mechanic',
  'software',
  // Willpower
  'astral-combat',
  'survival',
  // Magic
  'alchemy',
  'artificing',
  'banishing',
  'binding',
  'counterspelling',
  'disenchanting',
  'ritual-spellcasting',
  'spellcasting',
  'summoning',
  // Resonance
  'compiling',
  'decompiling',
  'registering',
] as const;
export type ActiveSkillId = (typeof ACTIVE_SKILL_IDS)[number];

export interface ActiveSkillRow {
  id: ActiveSkillId;
  /** The p. 90 name, for labels and catalogue matching. */
  name: string;
  /** Linked attribute. */
  attr: SkillAttr;
  /** The skill group it belongs to, or null for a skill bought only on its own. */
  group: SkillGroupId | null;
  category: SkillCategory;
  restricted: SkillRestriction | null;
  /** Whether an untrained character may default on it (attribute − 1). */
  canDefault: boolean;
  /** One skill per weapon or vehicle — the build names the target (Exotic Ranged Weapon: …). */
  specific: boolean;
  /** The skill's entry in the Skills chapter. */
  ref: Ref;
}

export interface SkillGroupRow {
  id: SkillGroupId;
  name: string;
  /** Member skills; a group bought at N gives each of these at N. */
  skills: readonly ActiveSkillId[];
  restricted: SkillRestriction | null;
  ref: Ref;
}

type Row = readonly [
  id: ActiveSkillId,
  name: string,
  attr: SkillAttr,
  group: SkillGroupId | null,
  category: SkillCategory,
  canDefault: boolean,
  page: number,
  specific?: boolean,
];

const ROWS: readonly Row[] = [
  ['archery', 'Archery', 'agi', null, 'combat', true, 130],
  ['automatics', 'Automatics', 'agi', 'firearms', 'combat', true, 130],
  ['blades', 'Blades', 'agi', 'close-combat', 'combat', true, 130],
  ['clubs', 'Clubs', 'agi', 'close-combat', 'combat', true, 131],
  ['escape-artist', 'Escape Artist', 'agi', null, 'physical', true, 133],
  ['exotic-melee', 'Exotic Melee Weapon', 'agi', null, 'combat', false, 90, true],
  ['exotic-ranged', 'Exotic Ranged Weapon', 'agi', null, 'combat', false, 131, true],
  ['gunnery', 'Gunnery', 'agi', null, 'vehicle', true, 146],
  ['gymnastics', 'Gymnastics', 'agi', 'athletics', 'physical', true, 133],
  ['heavy-weapons', 'Heavy Weapons', 'agi', null, 'combat', true, 132],
  ['locksmith', 'Locksmith', 'agi', null, 'technical', false, 145],
  ['longarms', 'Longarms', 'agi', 'firearms', 'combat', true, 132],
  ['palming', 'Palming', 'agi', 'stealth', 'physical', false, 133],
  ['pistols', 'Pistols', 'agi', 'firearms', 'combat', true, 132],
  ['sneaking', 'Sneaking', 'agi', 'stealth', 'physical', true, 133],
  ['throwing-weapons', 'Throwing Weapons', 'agi', null, 'combat', true, 132],
  ['unarmed-combat', 'Unarmed Combat', 'agi', 'close-combat', 'combat', true, 132],
  ['diving', 'Diving', 'bod', null, 'physical', true, 133],
  ['free-fall', 'Free-Fall', 'bod', null, 'physical', true, 133],
  ['pilot-aerospace', 'Pilot Aerospace', 'rea', null, 'vehicle', false, 146],
  ['pilot-aircraft', 'Pilot Aircraft', 'rea', null, 'vehicle', false, 147],
  ['pilot-exotic-vehicle', 'Pilot Exotic Vehicle', 'rea', null, 'vehicle', false, 147, true],
  ['pilot-ground-craft', 'Pilot Ground Craft', 'rea', null, 'vehicle', true, 147],
  ['pilot-walker', 'Pilot Walker', 'rea', null, 'vehicle', false, 147],
  ['pilot-watercraft', 'Pilot Watercraft', 'rea', null, 'vehicle', true, 147],
  ['running', 'Running', 'str', 'athletics', 'physical', true, 133],
  ['swimming', 'Swimming', 'str', 'athletics', 'physical', true, 134],
  ['animal-handling', 'Animal Handling', 'cha', null, 'technical', true, 143],
  ['con', 'Con', 'cha', 'acting', 'social', true, 138],
  ['etiquette', 'Etiquette', 'cha', 'influence', 'social', true, 138],
  ['impersonation', 'Impersonation', 'cha', 'acting', 'social', true, 138],
  ['instruction', 'Instruction', 'cha', null, 'social', true, 138],
  ['intimidation', 'Intimidation', 'cha', null, 'social', true, 139],
  ['leadership', 'Leadership', 'cha', 'influence', 'social', true, 139],
  ['negotiation', 'Negotiation', 'cha', 'influence', 'social', true, 139],
  ['performance', 'Performance', 'cha', 'acting', 'social', true, 139],
  ['artisan', 'Artisan', 'int', null, 'technical', false, 143],
  ['assensing', 'Assensing', 'int', null, 'magical', false, 142],
  ['disguise', 'Disguise', 'int', 'stealth', 'physical', true, 133],
  ['navigation', 'Navigation', 'int', 'outdoors', 'technical', true, 145],
  ['perception', 'Perception', 'int', null, 'physical', true, 133],
  ['tracking', 'Tracking', 'int', 'outdoors', 'physical', true, 134],
  ['aeronautics-mechanic', 'Aeronautics Mechanic', 'log', 'engineering', 'technical', false, 143],
  ['arcana', 'Arcana', 'log', null, 'magical', false, 142],
  ['armorer', 'Armorer', 'log', null, 'technical', true, 143],
  ['automotive-mechanic', 'Automotive Mechanic', 'log', 'engineering', 'technical', false, 143],
  ['biotechnology', 'Biotechnology', 'log', 'biotech', 'technical', false, 144],
  ['chemistry', 'Chemistry', 'log', null, 'technical', false, 144],
  ['computer', 'Computer', 'log', 'electronics', 'technical', true, 144],
  ['cybercombat', 'Cybercombat', 'log', 'cracking', 'technical', true, 144],
  ['cybertechnology', 'Cybertechnology', 'log', 'biotech', 'technical', false, 144],
  ['demolitions', 'Demolitions', 'log', null, 'technical', true, 144],
  ['electronic-warfare', 'Electronic Warfare', 'log', 'cracking', 'technical', false, 144],
  ['first-aid', 'First Aid', 'log', 'biotech', 'technical', true, 144],
  ['forgery', 'Forgery', 'log', null, 'technical', true, 144],
  ['hacking', 'Hacking', 'log', 'cracking', 'technical', true, 145],
  ['hardware', 'Hardware', 'log', 'electronics', 'technical', false, 145],
  ['industrial-mechanic', 'Industrial Mechanic', 'log', 'engineering', 'technical', false, 145],
  ['medicine', 'Medicine', 'log', 'biotech', 'technical', false, 145],
  ['nautical-mechanic', 'Nautical Mechanic', 'log', 'engineering', 'technical', false, 145],
  ['software', 'Software', 'log', 'electronics', 'technical', false, 145],
  ['astral-combat', 'Astral Combat', 'wil', null, 'magical', false, 142],
  ['survival', 'Survival', 'wil', 'outdoors', 'physical', true, 133],
  ['alchemy', 'Alchemy', 'mag', 'enchanting', 'magical', false, 142],
  ['artificing', 'Artificing', 'mag', 'enchanting', 'magical', false, 142],
  ['banishing', 'Banishing', 'mag', 'conjuring', 'magical', false, 142],
  ['binding', 'Binding', 'mag', 'conjuring', 'magical', false, 142],
  ['counterspelling', 'Counterspelling', 'mag', 'sorcery', 'magical', false, 142],
  ['disenchanting', 'Disenchanting', 'mag', 'enchanting', 'magical', false, 142],
  ['ritual-spellcasting', 'Ritual Spellcasting', 'mag', 'sorcery', 'magical', false, 142],
  ['spellcasting', 'Spellcasting', 'mag', 'sorcery', 'magical', false, 143],
  ['summoning', 'Summoning', 'mag', 'conjuring', 'magical', false, 143],
  ['compiling', 'Compiling', 'res', 'tasking', 'resonance', false, 143],
  ['decompiling', 'Decompiling', 'res', 'tasking', 'resonance', false, 143],
  ['registering', 'Registering', 'res', 'tasking', 'resonance', false, 143],
];

/**
 * The restriction follows the linked attribute: the p. 89 fence is "the
 * skills under the Magic and Resonance headings", which are exactly the MAG
 * and RES skills. Arcana, Assensing and Astral Combat sit in the chapter's
 * magical section but under Logic, Intuition and Willpower on p. 90, so they
 * are not restricted here (§8.4); Assensing's astral-perception fence is the
 * validator's.
 */
function restrictionFor(attr: SkillAttr): SkillRestriction | null {
  if (attr === 'mag') return 'magic';
  if (attr === 'res') return 'resonance';
  return null;
}

/** All 75 active skills, in the p. 90 order (by linked attribute). */
export const ACTIVE_SKILL_TABLE: readonly ActiveSkillRow[] = ROWS.map(
  ([id, name, attr, group, category, canDefault, page, specific]) => ({
    id,
    name,
    attr,
    group,
    category,
    restricted: restrictionFor(attr),
    canDefault,
    specific: specific ?? false,
    ref: SR5(page),
  }),
);

export const ACTIVE_SKILL_BY_ID = Object.fromEntries(
  ACTIVE_SKILL_TABLE.map((row) => [row.id, row]),
) as Readonly<Record<ActiveSkillId, ActiveSkillRow>>;

const GROUP_NAMES: Readonly<Record<SkillGroupId, string>> = {
  acting: 'Acting',
  athletics: 'Athletics',
  biotech: 'Biotech',
  'close-combat': 'Close Combat',
  conjuring: 'Conjuring',
  cracking: 'Cracking',
  electronics: 'Electronics',
  enchanting: 'Enchanting',
  firearms: 'Firearms',
  influence: 'Influence',
  engineering: 'Engineering',
  outdoors: 'Outdoors',
  sorcery: 'Sorcery',
  stealth: 'Stealth',
  tasking: 'Tasking',
};

/**
 * The fifteen groups (p. 90), members read off the skill rows so a group can
 * never name a skill the table does not have. A group is restricted when its
 * members are — Conjuring, Enchanting and Sorcery to Magic, Tasking to
 * Resonance.
 */
export const SKILL_GROUP_TABLE: readonly SkillGroupRow[] = SKILL_GROUP_IDS.map((id) => {
  const skills = ACTIVE_SKILL_TABLE.filter((s) => s.group === id).map((s) => s.id);
  const restricted = ACTIVE_SKILL_BY_ID[skills[0] ?? 'archery'].restricted;
  return { id, name: GROUP_NAMES[id], skills, restricted, ref: SR5(90) };
});

export const SKILL_GROUP_BY_ID = Object.fromEntries(
  SKILL_GROUP_TABLE.map((row) => [row.id, row]),
) as Readonly<Record<SkillGroupId, SkillGroupRow>>;

/** The groups a Magic skill grant or an aspected magician chooses among (pp. 65, 69). */
export const MAGICAL_SKILL_GROUP_IDS = ['sorcery', 'conjuring', 'enchanting'] as const satisfies readonly SkillGroupId[];

const normalise = (id: string): string => id.trim().toLowerCase().replace(/[\s_]+/g, '-');

/** An active skill by id, tolerant of `Unarmed Combat` / `unarmed_combat`; null for anything else. */
export function activeSkillRow(id: string): ActiveSkillRow | null {
  return (ACTIVE_SKILL_BY_ID as Readonly<Record<string, ActiveSkillRow | undefined>>)[normalise(id)] ?? null;
}

/** A skill group by id, tolerant of `Close Combat` / `close_combat`; null for anything else. */
export function skillGroupRow(id: string): SkillGroupRow | null {
  return (SKILL_GROUP_BY_ID as Readonly<Record<string, SkillGroupRow | undefined>>)[normalise(id)] ?? null;
}

// ---------------------------------------------------------------------------
// Knowledge and language skills (pp. 89–91)
// ---------------------------------------------------------------------------

export interface KnowledgeCategoryRow {
  id: KnowledgeCategory;
  attr: 'log' | 'int';
  ref: Ref;
}

/** Academic and Professional roll Logic; Interests and Street roll Intuition (p. 89). */
export const KNOWLEDGE_CATEGORY_TABLE: Readonly<Record<KnowledgeCategory, KnowledgeCategoryRow>> = {
  academic: { id: 'academic', attr: 'log', ref: SR5(89) },
  interests: { id: 'interests', attr: 'int', ref: SR5(89) },
  professional: { id: 'professional', attr: 'log', ref: SR5(89) },
  street: { id: 'street', attr: 'int', ref: SR5(89) },
};

/** Languages link to Intuition (p. 91). */
export const LANGUAGE_SKILL = { attr: 'int', ref: SR5(91) } as const satisfies { attr: SkillAttr; ref: Ref };

/**
 * The numbers Step Five spends against (pp. 88–91): ratings, the free
 * knowledge pool, native languages and the one-point specialisation.
 */
export const CREATION_SKILL_RULES = {
  /** Highest skill or group rating at creation (p. 88). */
  maxRating: 6,
  /** One skill — never a group — may reach 7 with Aptitude (p. 88). */
  maxRatingWithAptitude: 7,
  /** After creation (p. 88); 13 for the Aptitude skill. */
  maxRatingInPlay: 12,
  maxRatingInPlayWithAptitude: 13,
  /** Knowledge and language skills at creation (p. 91). */
  maxKnowledgeRating: 6,
  /** Free knowledge/language points = (INT + LOG) × this (p. 89). */
  knowledgePointsPerIntLog: 2,
  /** Native languages granted free; Bilingual makes it two (pp. 89, 91). */
  nativeLanguages: 1,
  nativeLanguagesWithBilingual: 2,
  /** A specialisation costs one skill point, one per skill, never on a group (p. 89). */
  specializationPoints: 1,
  maxSpecializationsPerSkill: 1,
  ref: SR5(88),
} as const;

/**
 * The free knowledge and language points natural INT and LOG give, (INT +
 * LOG) × 2 (p. 89) — the pool the budget fills and Step 6 quotes.
 */
export function freeKnowledgePoints(int: number, log: number): number {
  return (int + log) * CREATION_SKILL_RULES.knowledgePointsPerIntLog;
}
