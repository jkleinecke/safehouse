/**
 * Concept presets — the cards on Step 1 (FR3.9, docs/CHARGEN.md §4.4 Step 1,
 * §8.2).
 *
 * A first-time player knows they want "the one who talks us in" or "the one
 * with the drones" long before they know what Priority B buys. Each preset
 * is one such card: an original title built from genre role words, a
 * one-line pitch in our own words, a priority order, a metatype suggestion
 * (or none), a magic kind, and a suggested spend for the steps after it —
 * attribute points, skills and groups by rating, a few knowledge skills and
 * languages, a lifestyle, and gear as *intent* ("a heavy pistol"), never as a
 * catalogue line. Everything a card fills in stays editable; "start from
 * nothing" is a card too.
 *
 * Why these are hand-authored rather than read off the generator's sixteen
 * archetypes: those are NPC opposition (§8.2) — a bouncer, a patrol officer,
 * the civilian behind the bar — with attribute spans that ignore metatype
 * maxima. A starting runner has to be legal to the last point, so the
 * numbers here are written against the creation tables and tested there.
 *
 * ## How a spend fits a build
 *
 * Each spend is authored for its suggested metatype (human when it has none)
 * under the core printing, and for that case `applyConcept` reproduces it
 * exactly. Any other case — the player's own metatype, the Run Faster
 * printing, a quality that bars a group — changes what the same card can
 * buy, so the spend is *fitted* rather than copied:
 *
 * - Attributes are points. Each is clamped under its natural maximum, and
 *   only the concept's first emphasis may sit at the maximum (p. 66); points
 *   the clamp frees go round the emphasis list, then the rest.
 * - Skills, groups, knowledge and languages are ratings, because the Magic
 *   column's free skills make "points" mean different things per printing:
 *   the technomancer's Hacking 6 costs one point where the core table grants
 *   it at 5 and six where Run Faster does not. A skill inside an owned group,
 *   a group holding a granted skill, and anything the magic kind or a
 *   quality fences off (pp. 69, 81, 85, 89, 142) are skipped; what they
 *   would have cost goes to the rest of the list, then to a short fallback.
 * - Knowledge points follow the fitted Intuition and Logic.
 *
 * So a card never leaves Step 3 or Step 6 blocked — every attribute, skill,
 * group and knowledge point spent, nothing over a maximum, nothing on a
 * skill the build may not hold.
 *
 * What `applyConcept` writes and what it leaves: it replaces the spend a card
 * suggests (priorities, metatype, special and attribute points, the magic
 * kind and its free skills, skills) and clears the Karma spends, which are
 * priced off the ratings it just replaced. It keeps the player's identity
 * (setting only `identity.concept`, the contract's slot for a preset id),
 * qualities, purchases, contacts and native languages; it adds the suggested
 * lifestyle only when none is kept. The blank card is the exception: "start
 * from nothing" empties all of it (`clearSpend`) and keeps only the identity.
 *
 * Pure — no I/O. No book text (DESIGN.md §14, CHARGEN.md §7): titles,
 * pitches and knowledge names are ours, gear hints are kinds of thing rather
 * than item names, and no published archetype name is used.
 */
import {
  ATTRIBUTE_CODES,
  PRIORITY_COLUMNS,
  type AttributeCode,
  type BuildGrantRating,
  type BuildKnowledgeSkill,
  type BuildLanguage,
  type BuildLifestyle,
  type BuildMagic,
  type CharacterBuild,
  type ChargenSettings,
  type KnowledgeCategory,
  type LifestyleTier,
  type MagicAspect,
  type MagicKind,
  type MagicTradition,
  type PriorityColumn,
  type PriorityLevel,
  type PurchaseList,
  type SpecialAttributeCode,
} from '@safehouse/contracts';
import { costDoubling, doublesGroup, doublesKnowledge, doublesSkill } from './advance.js';
import { formulaGroup, knowsFormulaGroup } from './budget.js';
import { eligibilityContext, groupEligibilityIn, skillEligibilityIn } from './eligibility.js';
import { clearSpend, setAttributePoints, setMagicKind, setMetatype, setPriority, setSpecialPoints } from './build.js';
import {
  CREATION_ATTRIBUTE_RULES,
  METATYPE_BY_ID,
  metatypeRow,
  type CoreMetatypeId,
  type MetatypeRow,
} from './metatypes.js';
import { MAGIC_KIND_TABLE, PRIORITY_CHARTS, magicPriorityOption, type GrantPool } from './priority.js';
import { qualityEffects, ratings } from './ratings.js';
import {
  ACTIVE_SKILL_IDS,
  CREATION_SKILL_RULES,
  SKILL_GROUP_IDS,
  activeSkillRow,
  skillGroupRow,
  type ActiveSkillId,
  type ActiveSkillRow,
  type SkillGroupId,
  type SkillGroupRow,
} from './skills.js';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export const CONCEPT_IDS = [
  'face',
  'decker',
  'rigger',
  'technomancer',
  'adept',
  'street-mage',
  'shaman',
  'conjurer',
  'muscle',
  'overwatch',
  'infiltrator',
  'street-doc',
  'investigator',
  'smuggler',
  'blank',
] as const;
export type ConceptId = (typeof CONCEPT_IDS)[number];

/** The "start from nothing" card: it clears a card's spend and suggests nothing. */
export const BLANK_CONCEPT_ID = 'blank' as const satisfies ConceptId;

/** Kinds of gear a concept asks for; the Gear step turns each into a catalogue search. */
export const CONCEPT_GEAR_KINDS = [
  'weapon',
  'ammo',
  'armor',
  'augment',
  'commlink',
  'cyberdeck',
  'rcc',
  'drone',
  'vehicle',
  'electronics',
  'identity',
  'tools',
  'medical',
  'magical',
  'gear',
] as const;
export type ConceptGearKind = (typeof CONCEPT_GEAR_KINDS)[number];

/** Which build purchase list a gear intent lands on once it is bought. */
export const CONCEPT_GEAR_LISTS: Readonly<Record<ConceptGearKind, PurchaseList>> = {
  weapon: 'weapons',
  ammo: 'gear',
  armor: 'armor',
  augment: 'augments',
  commlink: 'gear',
  cyberdeck: 'gear',
  rcc: 'gear',
  drone: 'gear',
  vehicle: 'gear',
  electronics: 'gear',
  identity: 'gear',
  tools: 'gear',
  medical: 'gear',
  magical: 'gear',
  gear: 'gear',
};

/** Gear as intent: what kind of thing, in plain words, never an item's name. */
export interface ConceptGearSlot {
  kind: ConceptGearKind;
  hint: string;
  qty?: number;
}

/** A suggested active skill rating — what the skill ends at, free grant included. */
export interface ConceptSkill {
  id: ActiveSkillId;
  rating: number;
}

/** A suggested skill group rating. */
export interface ConceptGroup {
  id: SkillGroupId;
  rating: number;
}

export interface ConceptKnowledge {
  name: string;
  category: KnowledgeCategory;
  rating: number;
}

/** A spoken language beyond the native one, which stays the player's pick. */
export interface ConceptLanguage {
  name: string;
  rating: number;
}

export interface ConceptMagic {
  kind: MagicKind;
  aspect?: MagicAspect;
  tradition?: MagicTradition;
}

export interface ConceptSpend {
  /** Attribute points (not ratings), exact for the suggested metatype — human when there is none. */
  attributes: Readonly<Record<AttributeCode, number>>;
  /** What the concept leans on, first to last. Only the first may start at its natural maximum. */
  emphasis: readonly AttributeCode[];
  /** Where special points go first; Edge and the build's own special attribute follow. */
  special: readonly SpecialAttributeCode[];
  /** Preferred free skills for the Magic/Resonance column, best first; the first that fit the grant are taken. */
  grantSkills: readonly ActiveSkillId[];
  groups: readonly ConceptGroup[];
  skills: readonly ConceptSkill[];
  knowledge: readonly ConceptKnowledge[];
  languages: readonly ConceptLanguage[];
  /** Added only when the build keeps no lifestyle. */
  lifestyle: LifestyleTier;
  gear: readonly ConceptGearSlot[];
}

export interface ConceptPreset {
  id: ConceptId;
  /** The card's name: our own, made of genre role words. */
  title: string;
  /** One line on what the runner is for, in our words. */
  pitch: string;
  /** A level per column, valid under the Priority method; null on the blank card. */
  priorities: Readonly<Record<PriorityColumn, PriorityLevel>> | null;
  /** A metatype that suits the concept, or null for "any" (human when nothing else is picked). */
  metatype: CoreMetatypeId | null;
  magic: ConceptMagic;
  /** Null on the blank card. */
  spend: ConceptSpend | null;
}

// ---------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------

/** Priorities in the table's column order: metatype, attributes, magic, skills, resources. */
const prio = (
  metatype: PriorityLevel,
  attributes: PriorityLevel,
  magic: PriorityLevel,
  skills: PriorityLevel,
  resources: PriorityLevel,
): Readonly<Record<PriorityColumn, PriorityLevel>> => ({ metatype, attributes, magic, skills, resources });

const skills = (...pairs: readonly (readonly [ActiveSkillId, number])[]): ConceptSkill[] =>
  pairs.map(([id, rating]) => ({ id, rating }));
const groups = (...pairs: readonly (readonly [SkillGroupId, number])[]): ConceptGroup[] =>
  pairs.map(([id, rating]) => ({ id, rating }));
const know = (name: string, category: KnowledgeCategory, rating: number): ConceptKnowledge => ({ name, category, rating });
const lang = (name: string, rating: number): ConceptLanguage => ({ name, rating });
const kit = (kind: ConceptGearKind, hint: string, qty?: number): ConceptGearSlot =>
  qty === undefined ? { kind, hint } : { kind, hint, qty };

const COMMLINK = kit('commlink', 'commlink');
const FAKE_SIN = kit('identity', 'fake SIN');
const ARMORED_CLOTHES = kit('armor', 'armored clothing');

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

/** Every card, in the order the strip shows them; the blank card last. Original fiction only. */
export const CONCEPT_PRESETS: readonly ConceptPreset[] = [
  {
    id: 'face',
    title: 'Back-room face',
    pitch: 'Talks the team into the job, the price up, and the guards out of the way.',
    priorities: prio('C', 'B', 'E', 'A', 'D'),
    metatype: 'elf',
    magic: { kind: 'mundane' },
    spend: {
      attributes: { bod: 2, agi: 2, rea: 2, str: 1, wil: 3, log: 2, int: 3, cha: 5 },
      emphasis: ['cha', 'int', 'wil'],
      special: ['edg'],
      grantSkills: [],
      groups: groups(['influence', 6], ['acting', 4]),
      skills: skills(
        ['intimidation', 6],
        ['perception', 6],
        ['pistols', 5],
        ['computer', 4],
        ['sneaking', 4],
        ['disguise', 4],
        ['palming', 3],
        ['forgery', 3],
        ['pilot-ground-craft', 3],
        ['gymnastics', 2],
        ['unarmed-combat', 2],
        ['first-aid', 2],
        ['instruction', 2],
      ),
      knowledge: [
        know('Fixer circles', 'street', 4),
        know('Boardroom manners', 'professional', 3),
        know('Nightclub scene', 'interests', 3),
        know('Contract law', 'academic', 2),
      ],
      languages: [lang('Japanese', 2)],
      lifestyle: 'middle',
      gear: [
        kit('commlink', 'top-end commlink'),
        kit('identity', 'fake SIN', 2),
        kit('identity', 'fake licences'),
        kit('weapon', 'concealable pistol'),
        kit('armor', 'armored business clothes'),
        kit('electronics', 'bug scanner'),
      ],
    },
  },
  {
    id: 'decker',
    title: 'Grid-runner decker',
    pitch: "Owns the building's cameras, doors and files from a chair down the block.",
    priorities: prio('D', 'B', 'E', 'C', 'A'),
    metatype: null,
    magic: { kind: 'mundane' },
    spend: {
      attributes: { bod: 1, agi: 2, rea: 3, str: 0, wil: 3, log: 5, int: 4, cha: 2 },
      emphasis: ['log', 'int', 'wil', 'rea'],
      special: ['edg'],
      grantSkills: [],
      groups: groups(['firearms', 2]),
      skills: skills(
        ['hacking', 6],
        ['cybercombat', 5],
        ['computer', 5],
        ['electronic-warfare', 4],
        ['software', 4],
        ['hardware', 2],
        ['perception', 2],
      ),
      knowledge: [
        know('Host security designs', 'professional', 5),
        know('Data havens', 'street', 4),
        know('Corporate org charts', 'professional', 4),
        know('Shadow forums', 'street', 3),
        know('Old-web trivia', 'interests', 3),
      ],
      languages: [lang('Mandarin', 3)],
      lifestyle: 'middle',
      gear: [
        kit('cyberdeck', 'cyberdeck'),
        kit('commlink', 'backup commlink'),
        kit('augment', 'headware data port'),
        FAKE_SIN,
        kit('tools', 'hardware toolkit'),
        kit('weapon', 'light pistol'),
        ARMORED_CLOTHES,
      ],
    },
  },
  {
    id: 'rigger',
    title: 'Rotor-and-wheel rigger',
    pitch: 'Drives the getaway, flies the eyes overhead, and brings the guns on wheels.',
    priorities: prio('D', 'C', 'E', 'B', 'A'),
    metatype: null,
    magic: { kind: 'mundane' },
    spend: {
      attributes: { bod: 1, agi: 2, rea: 5, str: 0, wil: 1, log: 3, int: 3, cha: 1 },
      emphasis: ['rea', 'int', 'log'],
      special: ['edg'],
      grantSkills: [],
      groups: groups(['engineering', 3], ['firearms', 2]),
      skills: skills(
        ['pilot-ground-craft', 6],
        ['pilot-aircraft', 6],
        ['gunnery', 6],
        ['perception', 4],
        ['pilot-watercraft', 3],
        ['navigation', 3],
        ['electronic-warfare', 3],
        ['computer', 3],
        ['hardware', 2],
      ),
      knowledge: [
        know('Drone makes and models', 'professional', 4),
        know('Street racing circuits', 'interests', 3),
        know('Highway patrol habits', 'street', 3),
        know('Traffic control grids', 'professional', 3),
      ],
      languages: [lang('Spanish', 3)],
      lifestyle: 'middle',
      gear: [
        kit('rcc', 'rigger command console'),
        kit('augment', 'vehicle control implant'),
        kit('drone', 'small surveillance drone', 2),
        kit('drone', 'armed ground drone'),
        kit('vehicle', 'armored van'),
        kit('tools', 'vehicle toolkit'),
        kit('weapon', 'submachine gun'),
        COMMLINK,
        FAKE_SIN,
      ],
    },
  },
  {
    id: 'technomancer',
    title: 'Signal-born technomancer',
    pitch: 'Hears the Matrix without a deck and talks it into doing favours.',
    priorities: prio('E', 'B', 'A', 'C', 'D'),
    metatype: null,
    magic: { kind: 'technomancer' },
    spend: {
      attributes: { bod: 1, agi: 1, rea: 2, str: 0, wil: 5, log: 4, int: 4, cha: 3 },
      emphasis: ['wil', 'log', 'int', 'cha'],
      special: ['res', 'edg'],
      grantSkills: ['compiling', 'registering', 'hacking', 'decompiling', 'cybercombat', 'computer'],
      groups: groups(['stealth', 2]),
      skills: skills(
        ['hacking', 6],
        ['compiling', 6],
        ['registering', 6],
        ['cybercombat', 5],
        ['computer', 5],
        ['electronic-warfare', 4],
        ['software', 4],
        ['perception', 4],
        ['decompiling', 3],
      ),
      knowledge: [
        know('Grid ghost stories', 'interests', 4),
        know('Hacker crews', 'street', 4),
        know('Wireless protocols', 'academic', 4),
        know('Squatter blocks', 'street', 4),
      ],
      languages: [lang('Korean', 4)],
      lifestyle: 'low',
      gear: [kit('commlink', 'commlink for cover'), FAKE_SIN, kit('weapon', 'light pistol'), ARMORED_CLOTHES],
    },
  },
  {
    id: 'adept',
    title: 'Quiet-fist adept',
    pitch: 'No chrome and no spells — a body the mana tuned to strike, dodge and climb.',
    priorities: prio('E', 'A', 'B', 'C', 'D'),
    metatype: null,
    magic: { kind: 'adept' },
    spend: {
      attributes: { bod: 4, agi: 5, rea: 4, str: 4, wil: 3, log: 0, int: 3, cha: 1 },
      emphasis: ['agi', 'rea', 'bod', 'str'],
      special: ['mag', 'edg'],
      grantSkills: ['unarmed-combat', 'blades', 'gymnastics'],
      groups: groups(['outdoors', 2]),
      skills: skills(
        ['unarmed-combat', 6],
        ['blades', 5],
        ['gymnastics', 5],
        ['sneaking', 4],
        ['perception', 4],
        ['running', 3],
        ['pistols', 3],
        ['throwing-weapons', 2],
      ),
      knowledge: [
        know('Underground fight clubs', 'street', 3),
        know('Gang colours', 'street', 3),
        know('Martial traditions', 'academic', 2),
      ],
      languages: [lang('Cantonese', 2)],
      lifestyle: 'low',
      gear: [
        kit('weapon', 'melee blade'),
        kit('weapon', 'throwing knives'),
        kit('weapon', 'light pistol'),
        kit('armor', 'light body armor'),
        COMMLINK,
        FAKE_SIN,
      ],
    },
  },
  {
    id: 'street-mage',
    title: 'Night-school street mage',
    pitch: 'Self-taught formulae, a cramped lab over a noodle bar, and no patience for wards.',
    priorities: prio('D', 'B', 'A', 'C', 'E'),
    metatype: null,
    magic: { kind: 'magician', tradition: 'hermetic' },
    spend: {
      attributes: { bod: 1, agi: 2, rea: 2, str: 1, wil: 4, log: 5, int: 3, cha: 2 },
      emphasis: ['log', 'wil', 'int'],
      special: ['mag', 'edg'],
      grantSkills: ['spellcasting', 'counterspelling', 'summoning'],
      groups: groups(['conjuring', 2]),
      skills: skills(
        ['spellcasting', 6],
        ['counterspelling', 6],
        ['assensing', 4],
        ['arcana', 4],
        ['perception', 4],
        ['astral-combat', 3],
        ['ritual-spellcasting', 3],
        ['pistols', 2],
        ['sneaking', 2],
        ['etiquette', 2],
        ['first-aid', 2],
      ),
      knowledge: [
        know('Formula theory', 'academic', 5),
        know('Astral hazards', 'professional', 4),
        know('Occult history', 'academic', 4),
        know('Talisman shops', 'street', 3),
        know('Local gangs', 'street', 2),
      ],
      languages: [lang('Latin', 2)],
      lifestyle: 'squatter',
      gear: [
        kit('magical', 'casting focus'),
        kit('magical', 'reagents'),
        COMMLINK,
        FAKE_SIN,
        kit('weapon', 'light pistol'),
        ARMORED_CLOTHES,
      ],
    },
  },
  {
    id: 'shaman',
    title: 'Spirit-talker shaman',
    pitch: "Asks the city's spirits for help, and usually gets it, for a price.",
    priorities: prio('E', 'C', 'A', 'B', 'D'),
    metatype: null,
    magic: { kind: 'magician', tradition: 'shamanic' },
    spend: {
      attributes: { bod: 1, agi: 1, rea: 1, str: 0, wil: 4, log: 1, int: 3, cha: 5 },
      emphasis: ['cha', 'wil', 'int'],
      special: ['mag', 'edg'],
      grantSkills: ['summoning', 'spellcasting', 'binding'],
      groups: groups(['outdoors', 3], ['influence', 2]),
      skills: skills(
        ['summoning', 6],
        ['spellcasting', 5],
        ['binding', 5],
        ['assensing', 5],
        ['banishing', 4],
        ['astral-combat', 4],
        ['counterspelling', 4],
        ['perception', 4],
        ['arcana', 3],
        ['first-aid', 2],
        ['clubs', 2],
        ['sneaking', 2],
      ),
      knowledge: [
        know('Spirits of the sprawl', 'interests', 4),
        know('Street healers', 'street', 3),
        know('Urban botany', 'academic', 3),
      ],
      languages: [lang('Portuguese', 2)],
      lifestyle: 'low',
      gear: [
        kit('magical', 'conjuring focus'),
        kit('magical', 'reagents'),
        COMMLINK,
        FAKE_SIN,
        kit('weapon', 'staff or club'),
        ARMORED_CLOTHES,
      ],
    },
  },
  {
    id: 'conjurer',
    title: 'Hedge conjurer',
    pitch: 'Cannot sling a single spell, but always has a spirit or two owing a favour.',
    priorities: prio('C', 'A', 'B', 'D', 'E'),
    metatype: null,
    magic: { kind: 'aspected', aspect: 'conjuring', tradition: 'shamanic' },
    spend: {
      attributes: { bod: 2, agi: 2, rea: 2, str: 2, wil: 4, log: 3, int: 4, cha: 5 },
      emphasis: ['cha', 'wil', 'int', 'log'],
      special: ['mag', 'edg'],
      grantSkills: [],
      groups: [],
      skills: skills(
        ['assensing', 5],
        ['arcana', 4],
        ['perception', 4],
        ['astral-combat', 3],
        ['first-aid', 2],
        ['sneaking', 2],
        ['clubs', 2],
      ),
      knowledge: [
        know('Spirit bargaining', 'professional', 5),
        know('Haunted places', 'street', 4),
        know('Folk remedies', 'interests', 3),
        know('Reagent dealers', 'street', 3),
      ],
      languages: [lang('Irish', 3)],
      lifestyle: 'squatter',
      gear: [
        kit('magical', 'conjuring focus'),
        kit('magical', 'reagents'),
        COMMLINK,
        FAKE_SIN,
        kit('weapon', 'club'),
        ARMORED_CLOTHES,
      ],
    },
  },
  {
    id: 'muscle',
    title: 'Chromed-up muscle',
    pitch: 'Walks in first, takes the hits, and makes the other side regret the argument.',
    priorities: prio('B', 'C', 'E', 'D', 'A'),
    metatype: 'troll',
    magic: { kind: 'mundane' },
    spend: {
      attributes: { bod: 5, agi: 3, rea: 3, str: 3, wil: 1, log: 0, int: 1, cha: 0 },
      emphasis: ['bod', 'str', 'agi', 'rea'],
      special: ['edg'],
      grantSkills: [],
      groups: [],
      skills: skills(
        ['automatics', 5],
        ['pistols', 4],
        ['blades', 4],
        ['unarmed-combat', 3],
        ['intimidation', 3],
        ['perception', 3],
      ),
      knowledge: [
        know('Gang turf lines', 'street', 3),
        know('Close protection', 'professional', 2),
        know('Cage fighting', 'interests', 1),
      ],
      languages: [],
      lifestyle: 'low',
      gear: [
        kit('augment', 'reaction-boosting implant'),
        kit('augment', 'subdermal armor implant'),
        kit('augment', 'cybernetic eyes'),
        kit('weapon', 'assault rifle'),
        kit('weapon', 'heavy pistol'),
        kit('weapon', 'melee blade'),
        kit('ammo', 'rifle ammunition', 3),
        kit('armor', 'heavy body armor'),
        COMMLINK,
        FAKE_SIN,
        kit('identity', 'weapon licence'),
      ],
    },
  },
  {
    id: 'overwatch',
    title: 'Rooftop overwatch',
    pitch: 'Finds the high spot before the run and makes sure nobody follows the team out.',
    priorities: prio('D', 'A', 'E', 'C', 'B'),
    metatype: null,
    magic: { kind: 'mundane' },
    spend: {
      attributes: { bod: 3, agi: 5, rea: 4, str: 2, wil: 3, log: 2, int: 4, cha: 1 },
      emphasis: ['agi', 'int', 'rea', 'wil'],
      special: ['edg'],
      grantSkills: [],
      groups: groups(['athletics', 2]),
      skills: skills(
        ['longarms', 6],
        ['perception', 6],
        ['sneaking', 5],
        ['pistols', 4],
        ['navigation', 3],
        ['survival', 2],
        ['first-aid', 2],
      ),
      knowledge: [
        know('Ballistics', 'academic', 4),
        know('Rapid-response teams', 'professional', 4),
        know('Wind and weather', 'interests', 3),
        know('Rooftop routes', 'street', 3),
      ],
      languages: [lang('Arabic', 2)],
      lifestyle: 'low',
      gear: [
        kit('weapon', 'sniper rifle'),
        kit('weapon', 'heavy pistol'),
        kit('ammo', 'rifle ammunition', 2),
        kit('electronics', 'rangefinding binoculars'),
        kit('armor', 'light body armor'),
        COMMLINK,
        FAKE_SIN,
      ],
    },
  },
  {
    id: 'infiltrator',
    title: 'Ghost-step infiltrator',
    pitch: 'Gets in, gets the thing, and leaves the guards arguing about whether anyone came.',
    priorities: prio('C', 'A', 'E', 'B', 'D'),
    metatype: null,
    magic: { kind: 'mundane' },
    spend: {
      attributes: { bod: 2, agi: 5, rea: 4, str: 2, wil: 2, log: 3, int: 4, cha: 2 },
      emphasis: ['agi', 'int', 'rea'],
      special: ['edg'],
      grantSkills: [],
      groups: groups(['stealth', 5]),
      skills: skills(
        ['locksmith', 6],
        ['perception', 6],
        ['gymnastics', 5],
        ['hardware', 4],
        ['pistols', 4],
        ['unarmed-combat', 3],
        ['escape-artist', 3],
        ['computer', 3],
        ['running', 2],
      ),
      knowledge: [
        know('Alarm systems', 'professional', 5),
        know('Architecture', 'academic', 4),
        know('Guard habits', 'street', 4),
        know('Service tunnels', 'interests', 2),
      ],
      languages: [lang('French', 3)],
      lifestyle: 'low',
      gear: [
        kit('tools', 'lock bypass kit'),
        kit('gear', 'climbing gear'),
        kit('electronics', 'signal jammer'),
        kit('weapon', 'suppressed pistol'),
        kit('armor', 'camouflage suit'),
        COMMLINK,
        FAKE_SIN,
      ],
    },
  },
  {
    id: 'street-doc',
    title: 'Shadow-clinic street doc',
    pitch: 'Patches bullet holes, swaps out bad chrome, and never asks where the blood came from.',
    priorities: prio('D', 'C', 'E', 'A', 'B'),
    metatype: null,
    magic: { kind: 'mundane' },
    spend: {
      attributes: { bod: 1, agi: 2, rea: 1, str: 0, wil: 2, log: 5, int: 3, cha: 2 },
      emphasis: ['log', 'int', 'agi'],
      special: ['edg'],
      grantSkills: [],
      groups: groups(['biotech', 6], ['electronics', 2], ['influence', 2]),
      skills: skills(
        ['chemistry', 6],
        ['perception', 5],
        ['pistols', 4],
        ['con', 4],
        ['pilot-ground-craft', 4],
        ['sneaking', 4],
        ['instruction', 3],
        ['intimidation', 3],
        ['palming', 3],
        ['unarmed-combat', 3],
        ['animal-handling', 3],
        ['navigation', 2],
        ['gymnastics', 2],
      ),
      knowledge: [
        know('Street drugs', 'street', 5),
        know('Implant manufacturers', 'professional', 5),
        know('Black-market clinics', 'street', 4),
        know('Pharmacology', 'academic', 4),
      ],
      languages: [lang('Russian', 2)],
      lifestyle: 'middle',
      gear: [
        kit('medical', 'field surgery kit'),
        kit('medical', 'portable life support'),
        kit('medical', 'drug and antidote supply'),
        kit('tools', 'implant repair tools'),
        kit('vehicle', 'van'),
        kit('weapon', 'light pistol'),
        ARMORED_CLOTHES,
        COMMLINK,
        FAKE_SIN,
        kit('identity', 'medical licence'),
      ],
    },
  },
  {
    id: 'investigator',
    title: 'Paper-trail investigator',
    pitch: 'Follows the money, the rumours and the footprints until somebody gets nervous.',
    priorities: prio('B', 'C', 'E', 'A', 'D'),
    metatype: 'dwarf',
    magic: { kind: 'mundane' },
    spend: {
      attributes: { bod: 1, agi: 1, rea: 1, str: 0, wil: 2, log: 4, int: 5, cha: 2 },
      emphasis: ['int', 'log', 'wil', 'cha'],
      special: ['edg'],
      grantSkills: [],
      groups: groups(['influence', 3], ['acting', 3], ['outdoors', 2], ['firearms', 2]),
      skills: skills(
        ['perception', 6],
        ['computer', 5],
        ['sneaking', 5],
        ['intimidation', 4],
        ['disguise', 3],
        ['pilot-ground-craft', 3],
        ['electronic-warfare', 3],
        ['unarmed-combat', 3],
        ['locksmith', 3],
        ['hardware', 3],
        ['first-aid', 2],
        ['gymnastics', 2],
        ['running', 2],
        ['chemistry', 2],
      ),
      knowledge: [
        know('Police procedure', 'professional', 5),
        know('Crime families', 'street', 5),
        know('Forensic accounting', 'academic', 4),
        know('News feeds', 'interests', 3),
        know('Informant networks', 'street', 3),
      ],
      languages: [lang('German', 2)],
      lifestyle: 'low',
      gear: [
        kit('electronics', 'surveillance bugs'),
        kit('electronics', 'image-enhancing goggles'),
        kit('weapon', 'heavy pistol'),
        kit('armor', 'armored long coat'),
        kit('vehicle', 'unremarkable sedan'),
        COMMLINK,
        FAKE_SIN,
        kit('identity', 'investigator licence'),
      ],
    },
  },
  {
    id: 'smuggler',
    title: 'Border-run smuggler',
    pitch: 'Moves anything past anyone — cargo, people, the team — and knows every back road.',
    priorities: prio('C', 'D', 'E', 'B', 'A'),
    metatype: 'ork',
    magic: { kind: 'mundane' },
    spend: {
      attributes: { bod: 0, agi: 2, rea: 5, str: 0, wil: 1, log: 1, int: 3, cha: 2 },
      emphasis: ['rea', 'int', 'cha'],
      special: ['edg'],
      grantSkills: [],
      groups: groups(['influence', 3], ['stealth', 2]),
      skills: skills(
        ['pilot-ground-craft', 6],
        ['pilot-watercraft', 5],
        ['pilot-aircraft', 4],
        ['con', 4],
        ['perception', 4],
        ['pistols', 4],
        ['automotive-mechanic', 3],
        ['navigation', 3],
        ['forgery', 3],
      ),
      knowledge: [
        know('Checkpoint routines', 'street', 4),
        know('Back roads and waterways', 'street', 3),
        know('Black-market prices', 'professional', 3),
      ],
      languages: [lang('Spanish', 2)],
      lifestyle: 'low',
      gear: [
        kit('vehicle', 'fast boat'),
        kit('vehicle', 'cargo van with hidden compartments'),
        kit('electronics', 'signal jammer'),
        kit('weapon', 'shotgun'),
        ARMORED_CLOTHES,
        COMMLINK,
        kit('identity', 'fake SIN', 2),
        kit('identity', 'driver and pilot licences'),
      ],
    },
  },
  {
    id: 'blank',
    title: 'Start from nothing',
    pitch: 'An empty build and the nine steps; every choice is yours.',
    priorities: null,
    metatype: null,
    magic: { kind: 'mundane' },
    spend: null,
  },
];

export const CONCEPT_PRESET_BY_ID = Object.fromEntries(CONCEPT_PRESETS.map((p) => [p.id, p])) as Readonly<
  Record<ConceptId, ConceptPreset>
>;

/** A card by id (what `identity.concept` holds); null for anything else. */
export function conceptPreset(id: string | null | undefined): ConceptPreset | null {
  return (CONCEPT_PRESET_BY_ID as Readonly<Record<string, ConceptPreset | undefined>>)[(id ?? '').trim()] ?? null;
}

// ---------------------------------------------------------------------------
// Fitting
// ---------------------------------------------------------------------------

/** One place points can go: how many ranks are wanted, how many fit, what a rank costs. */
interface Slot {
  want: number;
  cap: number;
  cost: number;
}

/** How far one fallback slot is filled before the next is started. */
const FALLBACK_CHUNK = 4;

/**
 * Spend `budget` over the slots: each primary slot its want, in order, while
 * the budget lasts; then one rank at a time round the primary slots up to
 * their caps. Only then the fallbacks, one slot at a time up to
 * `FALLBACK_CHUNK` and round them to their caps — a card that lost its
 * groups to a quality gets a group or two at a useful rating, not ten at 1.
 * Returns ranks per slot, primary then fallback.
 */
function distribute(budget: number, primary: readonly Slot[], fallback: readonly Slot[] = []): number[] {
  const slots = [...primary, ...fallback];
  const out = slots.map(() => 0);
  let left = Math.max(0, budget);
  const fill = (i: number, upTo: number): void => {
    const s = slots[i];
    if (!s) return;
    const have = out[i] ?? 0;
    const n = Math.max(0, Math.min(Math.min(upTo, s.cap) - have, Math.floor(left / s.cost)));
    out[i] = have + n;
    left -= n * s.cost;
  };
  primary.forEach((s, i) => fill(i, Math.max(0, s.want)));
  const topUp = (from: number, to: number): void => {
    let moved = true;
    while (moved && left > 0) {
      moved = false;
      for (let i = from; i < to && left > 0; i++) {
        const s = slots[i];
        const have = out[i] ?? 0;
        if (s && have < s.cap && s.cost <= left) {
          out[i] = have + 1;
          left -= s.cost;
          moved = true;
        }
      }
    }
  };
  topUp(0, primary.length);
  for (let i = primary.length; i < slots.length && left > 0; i++) fill(i, FALLBACK_CHUNK);
  topUp(primary.length, slots.length);
  return out;
}

/** Skills a card falls back on when its own list cannot take every point: broadly useful, no restriction. */
const FALLBACK_SKILLS: readonly ActiveSkillId[] = [
  'perception',
  'sneaking',
  'pistols',
  'first-aid',
  'etiquette',
  'running',
  'gymnastics',
  'unarmed-combat',
  'computer',
  'pilot-ground-craft',
  'navigation',
  'intimidation',
  'blades',
  'survival',
  'swimming',
  'palming',
  'disguise',
  'con',
  'negotiation',
  'locksmith',
  'throwing-weapons',
  'armorer',
  'chemistry',
  'forgery',
  'escape-artist',
  'archery',
  'free-fall',
  'diving',
  'animal-handling',
  'artisan',
];

/** Groups in the order a card falls back on them. */
const FALLBACK_GROUPS: readonly SkillGroupId[] = [
  'athletics',
  'outdoors',
  'stealth',
  'firearms',
  'close-combat',
  'influence',
  'acting',
  'electronics',
  'engineering',
  'biotech',
  'cracking',
];

const FALLBACK_KNOWLEDGE: readonly ConceptKnowledge[] = [
  know('Neighbourhood rumours', 'street', 0),
  know('Sprawl geography', 'street', 0),
  know('Sports teams', 'interests', 0),
  know('Corporate news', 'professional', 0),
  know('Local politics', 'academic', 0),
];

const LIFESTYLE_LABELS: Readonly<Record<LifestyleTier, string>> = {
  street: 'Street',
  squatter: 'Squatter',
  low: 'Low',
  middle: 'Middle',
  high: 'High',
  luxury: 'Luxury',
};

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Casters who pick a tradition (its drain attributes). */
const TRADITION_KINDS: ReadonlySet<MagicKind> = new Set(['magician', 'aspected', 'mysticAdept']);

export interface ApplyConceptOptions {
  /**
   * Use this metatype instead of the card's suggestion — how the walkthrough
   * keeps a metatype the player already chose. Ignored when it is unknown,
   * not on the card's Metatype row, or a metavariant the campaign does not allow.
   */
  metatype?: string | null;
}

/** The first candidate that is known, on the row, and allowed; human (on every row) otherwise. */
function resolveMetatype(
  candidates: readonly (string | null | undefined)[],
  level: PriorityLevel,
  settings: ChargenSettings,
): MetatypeRow {
  for (const candidate of candidates) {
    const row = candidate ? metatypeRow(candidate) : null;
    if (!row || !row.priority[level]) continue;
    if (row.family !== 'core' && !settings.allowMetavariants) continue;
    return row;
  }
  return METATYPE_BY_ID.human;
}

/** The native languages a build keeps through a card: named, distinct, as many as are free, no ranks on them. */
function keptNatives(build: CharacterBuild): BuildLanguage[] {
  const limit = qualityEffects(build).nativeLanguages;
  const out: BuildLanguage[] = [];
  for (const l of build.skills.languages) {
    if (out.length >= limit) break;
    if (!l.native || !l.name.trim() || out.some((o) => same(o.name, l.name))) continue;
    out.push({ name: l.name.trim(), native: true, points: 0, skillPoints: 0, spec: null });
  }
  return out;
}

/**
 * Put a card on a build (§4.4 Step 1): its priorities, metatype, magic and a
 * spend fitted to the build as the file header describes. Returns a new
 * build; the input is left alone. The blank card is `clearSpend` — every
 * section of the spend emptied, qualities, gear, contacts and languages
 * included, the identity kept — and suggests nothing in its place.
 */
export function applyConcept(
  build: CharacterBuild,
  preset: ConceptPreset,
  settings: ChargenSettings,
  options: ApplyConceptOptions = {},
): CharacterBuild {
  const { priorities, spend } = preset;
  // The blank card is "an empty build and the nine steps" (its pitch, §4.4
  // Step 1): the whole spend cleared, the runner's identity kept.
  if (!priorities || !spend) return { ...clearSpend(build), identity: { ...build.identity, concept: preset.id } };

  const natives = keptNatives(build);
  let next: CharacterBuild = {
    ...build,
    identity: { ...build.identity, concept: preset.id },
    karma: { ...build.karma, spends: [] },
  };

  // --- Priorities, metatype, magic kind ---
  for (const column of PRIORITY_COLUMNS) next = setPriority(next, column, priorities[column]);
  const meta = resolveMetatype([options.metatype, preset.metatype, build.metatype, 'human'], priorities.metatype, settings);
  next = setMetatype(next, meta.id);

  const kind = preset.magic.kind;
  const kindRow = MAGIC_KIND_TABLE[kind];
  const option = kind === 'mundane' ? null : magicPriorityOption(settings.table, priorities.magic, kind);
  const aspect: MagicAspect | undefined =
    kind === 'aspected' ? (preset.magic.aspect ?? option?.groups?.groups[0] ?? 'sorcery') as MagicAspect : undefined;
  const tradition = TRADITION_KINDS.has(kind) ? (preset.magic.tradition ?? build.magic.tradition) : undefined;
  const mentor = kindRow.mentorSpirit ? build.magic.mentor : undefined;
  next = setMagicKind(next, kind);
  const magic: BuildMagic = {
    kind,
    ...(aspect ? { aspect } : {}),
    ...(tradition ? { tradition } : {}),
    ...(mentor ? { mentor } : {}),
  };

  // --- Special points: the card's order, then Edge, then the build's own special attribute ---
  const room: Record<SpecialAttributeCode, number> = {
    edg: meta.attributes.edg.max - meta.attributes.edg.base,
    mag:
      kindRow.attribute === 'mag'
        ? Math.max(0, Math.min(meta.magic.max, CREATION_ATTRIBUTE_RULES.specialMax) - (option?.rating ?? meta.magic.base))
        : 0,
    res:
      kindRow.attribute === 'res' && meta.resonance
        ? Math.max(0, Math.min(meta.resonance.max, CREATION_ATTRIBUTE_RULES.specialMax) - (option?.rating ?? meta.resonance.base))
        : 0,
  };
  let special = meta.priority[priorities.metatype]?.special ?? 0;
  for (const code of new Set<SpecialAttributeCode>([...spend.special, 'edg', 'mag', 'res'])) {
    const n = Math.min(special, room[code]);
    next = setSpecialPoints(next, code, n);
    special -= n;
  }

  // --- Attributes: clamped under the natural maximum, one peak (p. 66) ---
  const chart = PRIORITY_CHARTS[settings.table];
  const attributeOrder = [...new Set<AttributeCode>([...spend.emphasis, ...ATTRIBUTE_CODES])];
  const attributeSlots = attributeOrder.map((code, i): Slot => {
    const range = meta.attributes[code];
    const top = i === 0 ? range.max : range.max - 1;
    return { want: spend.attributes[code], cap: Math.max(0, top - range.base), cost: 1 };
  });
  const attributePoints = distribute(chart[priorities.attributes].attributes, attributeSlots);
  attributeOrder.forEach((code, i) => {
    next = setAttributePoints(next, code, attributePoints[i] ?? 0);
  });

  // --- What the build may hold (pp. 69, 81, 85, 89, 142) ---
  const doubling = costDoubling(build.qualities, meta.id);
  const pointCost = (doubled: boolean): number => (settings.uncouthDoublesPriorityPoints && doubled ? 2 : 1);
  const powers = kindRow.powerPoints !== null ? build.powers : [];
  // The fences Step 6 and the validator use (eligibility.ts), read for the
  // character this card is about to make rather than the draft it replaces.
  const fences = eligibilityContext({ ...next, magic: { kind, ...(aspect ? { aspect } : {}) }, powers }, settings);
  const skillAllowed = (row: ActiveSkillRow): boolean => !row.specific && skillEligibilityIn(fences, row).allowed;

  // --- The Magic/Resonance column's free skills and group ---
  const inPool = (row: ActiveSkillRow, pool: GrantPool): boolean =>
    pool.kind === 'any' ||
    (pool.kind === 'category' && row.category === pool.category) ||
    (pool.kind === 'groups' && !!row.group && pool.groups.includes(row.group));
  const grantedSkills: BuildGrantRating[] = [];
  if (option?.skills) {
    const grant = option.skills;
    for (const id of new Set<ActiveSkillId>([...spend.grantSkills, ...ACTIVE_SKILL_IDS])) {
      if (grantedSkills.length >= grant.count) break;
      const row = activeSkillRow(id);
      if (row && inPool(row, grant.pool) && skillAllowed(row)) grantedSkills.push({ id: row.id, rating: grant.rating });
    }
  }
  const grantedGroups: BuildGrantRating[] =
    option?.groups && aspect && option.groups.groups.includes(aspect) ? [{ id: aspect, rating: option.groups.rating }] : [];
  const grantOf = (list: readonly BuildGrantRating[], id: string): number => list.find((g) => g.id === id)?.rating ?? 0;
  // The draft's free spells and forms stay only where the new card may hold
  // them: formulae of a group this type knows (an aspected conjurer knows
  // none), no more than its priority grants.
  const grants = {
    skills: grantedSkills,
    groups: grantedGroups,
    spells: option?.formulae
      ? build.grants.spells.filter((pick) => knowsFormulaGroup({ kind, aspect }, formulaGroup(pick))).slice(0, option.formulae)
      : [],
    forms: kind === 'technomancer' && option?.forms ? build.grants.forms.slice(0, option.forms) : [],
  };

  // --- Groups ---
  const maxRating = CREATION_SKILL_RULES.maxRating;
  const groupAllowed = (row: SkillGroupRow): boolean =>
    groupEligibilityIn(fences, row).allowed && !row.skills.some((id) => grantOf(grantedSkills, id) > 0);
  const groupSlot = (id: SkillGroupId, rating: number): Slot => ({
    want: Math.max(0, Math.min(rating, maxRating) - grantOf(grantedGroups, id)),
    cap: Math.max(0, maxRating - grantOf(grantedGroups, id)),
    cost: pointCost(doublesGroup(doubling, id)),
  });
  const presetGroups = [...new Map(spend.groups.map((g) => [g.id, g])).values()].filter((g) => {
    const row = skillGroupRow(g.id);
    return !!row && groupAllowed(row);
  });
  const suggested = new Set<string>(spend.skills.filter((s) => s.rating > 0).map((s) => s.id));
  const fallbackGroupIds = [...FALLBACK_GROUPS, ...SKILL_GROUP_IDS]
    .filter((id, i, all) => all.indexOf(id) === i)
    .filter((id) => !presetGroups.some((g) => g.id === id) && grantOf(grantedGroups, id) === 0)
    .filter((id) => {
      const row = skillGroupRow(id);
      return !!row && groupAllowed(row);
    })
    // Groups that would swallow a suggested skill go last.
    .sort((a, b) => Number(collides(a, suggested)) - Number(collides(b, suggested)));
  const groupPoints = distribute(
    chart[priorities.skills].skills.groupPoints,
    presetGroups.map((g) => groupSlot(g.id, g.rating)),
    fallbackGroupIds.map((id) => groupSlot(id, 0)),
  );
  const groupIds = [...presetGroups.map((g) => g.id), ...fallbackGroupIds];
  const boughtGroups = groupIds
    .map((id, i) => ({ id, points: groupPoints[i] ?? 0 }))
    .filter((g) => g.points > 0);
  const owned = new Set<string>([...boughtGroups.map((g) => g.id), ...grantedGroups.map((g) => g.id)]);

  // --- Active skills ---
  const skillEligible = (row: ActiveSkillRow): boolean => skillAllowed(row) && !(row.group && owned.has(row.group));
  const skillSlot = (id: ActiveSkillId, rating: number): Slot => ({
    want: Math.max(0, Math.min(rating, maxRating) - grantOf(grantedSkills, id)),
    cap: Math.max(0, maxRating - grantOf(grantedSkills, id)),
    cost: pointCost(doublesSkill(doubling, id)),
  });
  const presetSkills = [...new Map(spend.skills.map((s) => [s.id, s])).values()].filter((s) => {
    const row = activeSkillRow(s.id);
    return !!row && skillEligible(row);
  });
  const fallbackSkillIds = FALLBACK_SKILLS.filter((id) => {
    const row = activeSkillRow(id);
    return !presetSkills.some((s) => s.id === id) && !!row && skillEligible(row);
  });
  const skillPoints = distribute(
    chart[priorities.skills].skills.points,
    presetSkills.map((s) => skillSlot(s.id, s.rating)),
    fallbackSkillIds.map((id) => skillSlot(id, 0)),
  );
  const active = [...presetSkills.map((s) => s.id), ...fallbackSkillIds]
    .map((id, i) => ({ id, points: skillPoints[i] ?? 0, spec: null }))
    .filter((s) => s.points > 0);

  // --- Knowledge and languages, on the fitted Intuition and Logic ---
  next = { ...next, grants, skills: { active, groups: boughtGroups, knowledge: [], languages: natives } };
  const fitted = ratings(next, settings).attributes;
  const free = (fitted.int.rating + fitted.log.rating) * CREATION_SKILL_RULES.knowledgePointsPerIntLog;
  const maxKnowledge = CREATION_SKILL_RULES.maxKnowledgeRating;
  const presetKnowledge = spend.knowledge.filter((k, i, all) => all.findIndex((o) => same(o.name, k.name)) === i);
  const presetLanguages = spend.languages.filter(
    (l, i, all) =>
      all.findIndex((o) => same(o.name, l.name)) === i &&
      !natives.some((n) => same(n.name, l.name)) &&
      !presetKnowledge.some((k) => same(k.name, l.name)),
  );
  const fallbackKnowledge = FALLBACK_KNOWLEDGE.filter(
    (k) => !presetKnowledge.some((o) => same(o.name, k.name)) && !natives.some((n) => same(n.name, k.name)),
  );
  const knowledgeSlot = (k: ConceptKnowledge): Slot => ({
    want: k.rating,
    cap: maxKnowledge,
    cost: pointCost(doublesKnowledge(doubling, k.category)),
  });
  const knowledgePoints = distribute(
    free,
    [...presetKnowledge.map(knowledgeSlot), ...presetLanguages.map((l): Slot => ({ want: l.rating, cap: maxKnowledge, cost: 1 }))],
    fallbackKnowledge.map(knowledgeSlot),
  );
  const pointsAt = (i: number): number => knowledgePoints[i] ?? 0;
  const knowledge: BuildKnowledgeSkill[] = [
    ...presetKnowledge.map((k, i) => ({ k, points: pointsAt(i) })),
    ...fallbackKnowledge.map((k, i) => ({ k, points: pointsAt(presetKnowledge.length + presetLanguages.length + i) })),
  ]
    .filter(({ points }) => points > 0)
    .map(({ k, points }) => ({ name: k.name, category: k.category, points, skillPoints: 0, spec: null }));
  const languages: BuildLanguage[] = [
    ...natives,
    ...presetLanguages
      .map((l, i) => ({ l, points: pointsAt(presetKnowledge.length + i) }))
      .filter(({ points }) => points > 0)
      .map(({ l, points }) => ({ name: l.name, native: false, points, skillPoints: 0, spec: null })),
  ];

  const lifestyles: BuildLifestyle[] =
    build.lifestyles.length > 0
      ? build.lifestyles
      : [{ tier: spend.lifestyle, name: LIFESTYLE_LABELS[spend.lifestyle], months: 1 }];

  return {
    ...next,
    magic,
    powers,
    skills: { active, groups: boughtGroups, knowledge, languages },
    lifestyles,
  };
}

/** Whether buying a group would lock a skill the card suggests at its own rating. */
function collides(groupId: SkillGroupId, suggested: ReadonlySet<string>): boolean {
  return (skillGroupRow(groupId)?.skills ?? []).some((id) => suggested.has(id));
}
