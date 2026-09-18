/**
 * Who a runner can be born as (FR3.9, docs/CHARGEN.md §8.4): the five core
 * metatypes and Run Faster's metavariants, metasapients and shapeshifters —
 * attribute base/max, special attribute points per priority, the Karma a
 * metavariant costs, the lifestyle multiplier and the racial traits as ids.
 *
 * Numbers and identifiers only (DESIGN.md §14). A trait is an id the engine
 * can key on (`thermographic`, `reach` +1), never what the trait does in the
 * book's words. Derive reads the row off `identity.metatype` for what it can
 * show — vision modes and a troll's dermal armor — so a compiled build writes
 * no modifier for them and an imported character gets the same; the builder
 * reads the rest (astral perception for Assensing, a metasapient's
 * Uneducated). Any other effect a table needs, a sheet carries as a modifier.
 *
 * Sources: the core Priority Table (SR5 p. 65) and Metatype Attribute Table
 * (p. 66); Run Faster's attribute tables (RF pp. 104–105) and its extended
 * priority charts (RF p. 106 for A and B, p. 107 for C, D and E). Two things
 * the charts imply and this table makes explicit:
 *
 * - A null priority cell means the metatype cannot be taken at that level —
 *   a troll is not on row C, a dwarf not on row D. Zero is a legal row that
 *   grants no special points (the troll on B).
 * - The additional Karma is the same on every row the metatype appears on,
 *   but it is stored per cell because that is how the charts print it, and
 *   it does not count toward the positive-quality cap (RF p. 102). The C
 *   chart's stray "+5" and "+4" (Hobgoblin, Oni) are the same values.
 *
 * Metasapients and shapeshifters are born with Magic 1, which a Magic
 * priority replaces, and can never have Resonance (RF p. 102). Shapeshifter
 * rows are the animal form (RF p. 105); their metahuman form is bought
 * separately and is not modelled here.
 */
import { PRIORITY_LEVELS, type BuildAttributeId, type PriorityLevel, type Ref } from '@safehouse/contracts';
import { AUGMENTATION_BONUS_CAP } from '../derive-pipeline.js';
import { RF, SR5 } from './pages.js';

/** The nine attributes on the metatype tables, in the book's column order. */
export const METATYPE_ATTRIBUTES = ['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha', 'edg'] as const;
export type MetatypeAttribute = (typeof METATYPE_ATTRIBUTES)[number];

/**
 * Every build attribute's name and three-letter code, the one label map the
 * builder's steps read — so step 3's stepper, step 8's raise and the ledger
 * never name an attribute two ways.
 */
export const BUILD_ATTRIBUTE_NAMES: Readonly<Record<BuildAttributeId, { name: string; short: string }>> = {
  bod: { name: 'Body', short: 'BOD' },
  agi: { name: 'Agility', short: 'AGI' },
  rea: { name: 'Reaction', short: 'REA' },
  str: { name: 'Strength', short: 'STR' },
  wil: { name: 'Willpower', short: 'WIL' },
  log: { name: 'Logic', short: 'LOG' },
  int: { name: 'Intuition', short: 'INT' },
  cha: { name: 'Charisma', short: 'CHA' },
  edg: { name: 'Edge', short: 'EDG' },
  mag: { name: 'Magic', short: 'MAG' },
  res: { name: 'Resonance', short: 'RES' },
};

export interface AttributeRange {
  /** The rating a character starts at for free. */
  base: number;
  /** The natural maximum (one mental/physical attribute may sit here at creation). */
  max: number;
}

export type MetatypeFamily = 'core' | 'metavariant' | 'metasapient' | 'shapeshifter';

export const CORE_METATYPE_IDS = ['human', 'elf', 'dwarf', 'ork', 'troll'] as const;
export type CoreMetatypeId = (typeof CORE_METATYPE_IDS)[number];

export const METATYPE_IDS = [
  ...CORE_METATYPE_IDS,
  // Metavariants (RF p. 104)
  'nartaki',
  'dryad',
  'nocturna',
  'wakyambi',
  'xapiri-thepe',
  'gnome',
  'hanuman',
  'koborokuru',
  'menehune',
  'hobgoblin',
  'ogre',
  'oni',
  'satyr',
  'cyclops',
  'fomorian',
  'giant',
  'minotaur',
  // Metasapients (RF p. 105)
  'centaur',
  'naga',
  'pixie',
  'sasquatch',
  // Shapeshifters, animal form (RF p. 105)
  'shapeshifter-bovine',
  'shapeshifter-canine',
  'shapeshifter-equine',
  'shapeshifter-falconine',
  'shapeshifter-leonine',
  'shapeshifter-lupine',
  'shapeshifter-pantherine',
  'shapeshifter-tigrine',
  'shapeshifter-ursine',
  'shapeshifter-vulpine',
] as const;
export type MetatypeId = (typeof METATYPE_IDS)[number];

/**
 * Racial trait identifiers. The five core ones are what the builder and
 * derive can act on today; the Run Faster ones are ids a GM-facing list can
 * show and a later effect map can key on.
 */
export const RACIAL_TRAIT_IDS = [
  // Core (SR5 p. 66)
  'lowLight',
  'thermographic',
  'reach',
  'dermalArmor',
  'toxinDice',
  // Run Faster (RF pp. 104–105)
  'allergy',
  'arcaneArrester',
  'armor',
  'astralPerception',
  'balanceReceptor',
  'broadenedAuditorySpectrum',
  'celerity',
  'coldBlooded',
  'concealment',
  'cyclopeanEye',
  'dermalAlteration',
  'dualNatured',
  'elongatedLimbs',
  'fangs',
  'glamour',
  'goringHorns',
  'guard',
  'hawkEyed',
  'initiativeDice',
  'keenEared',
  'magicSense',
  'mimicry',
  'monkeyPaws',
  'naturalWeapon',
  'neoteny',
  'nocturnal',
  'ogreStomach',
  'pathogenResistance',
  'pathogenToxinResistance',
  'photometabolism',
  'poorSelfControl',
  'prehensileTail',
  'satyrLegs',
  'search',
  'shift',
  'shivaArms',
  'strikingSkinPigmentation',
  'symbiosis',
  'underwaterVision',
  'uneducated',
  'unusualHair',
  'vanishing',
  'venom',
  'vomeronasalOrgan',
  'webbedDigits',
] as const;
export type RacialTraitId = (typeof RACIAL_TRAIT_IDS)[number];

export interface RacialTrait {
  id: RacialTraitId;
  /** The printed number where the trait has one: Reach +1, dermal armor +1, +2 toxin dice, +2D6 initiative. */
  value?: number;
}

export interface MetatypePriorityCell {
  /** Special attribute points (Edge, Magic, Resonance only). */
  special: number;
  /** Additional Karma the metatype costs at this row; 0 for the core five. */
  karma: number;
  ref: Ref;
}

export interface MetatypeRow {
  id: MetatypeId;
  name: string;
  family: MetatypeFamily;
  /** The core metatype a metavariant descends from — what Human-Looking and the posers gate on. */
  variantOf: CoreMetatypeId | null;
  attributes: Readonly<Record<MetatypeAttribute, AttributeRange>>;
  /** Natural Magic: 0 for metahumans, 1 for metasapients and shapeshifters (replaced by a Magic priority). */
  magic: AttributeRange;
  /** Null where the metatype can never have Resonance. */
  resonance: AttributeRange | null;
  /** Per priority level; null where the metatype is not on that row. */
  priority: Readonly<Record<PriorityLevel, MetatypePriorityCell | null>>;
  /** Lifestyle cost multiplier: dwarf 1.2, troll 2, centaur 2.5. */
  lifestyleMultiplier: number;
  traits: readonly RacialTrait[];
  /** The attribute table row. */
  ref: Ref;
}

/**
 * The creation fences around attributes that hold for every metatype
 * (SR5 pp. 65–66, 94).
 */
export const CREATION_ATTRIBUTE_RULES = {
  /** Magic and Resonance start at 0 (natural Magic 1 for metasapients) and top out at 6. */
  specialMax: 6,
  /** Exceptional Attribute lifts one attribute, Magic/Resonance included, by this much; Lucky lifts Edge. */
  qualityMaxBonus: 1,
  /** Mental/physical attributes that may sit at their natural maximum at creation. */
  maxAtNaturalLimit: 1,
  /** Attribute points buy +1 rating each; special points the same. */
  pointsPerRating: 1,
  /** The most any attribute may be raised by augmentation, from all sources (p. 94) — derive's own cap, one constant. */
  augmentedBonusCap: AUGMENTATION_BONUS_CAP,
  ref: SR5(66),
} as const;

/** `'1/6 2/7 …'` in the table's column order → base/max per attribute. */
function attrs(spec: string): Readonly<Record<MetatypeAttribute, AttributeRange>> {
  const pairs = spec.trim().split(/\s+/);
  if (pairs.length !== METATYPE_ATTRIBUTES.length) throw new Error(`metatypes: expected 9 ranges, got "${spec}"`);
  const out = {} as Record<MetatypeAttribute, AttributeRange>;
  METATYPE_ATTRIBUTES.forEach((code, i) => {
    const [base, max] = (pairs[i] ?? '').split('/').map(Number);
    if (base === undefined || max === undefined || !Number.isInteger(base) || !Number.isInteger(max)) {
      throw new Error(`metatypes: bad range "${pairs[i]}" in "${spec}"`);
    }
    out[code] = { base, max };
  });
  return out;
}

/** Core priority cells: every level on SR5 p. 65, no extra Karma. */
function corePriority(special: readonly (number | null)[]): Readonly<Record<PriorityLevel, MetatypePriorityCell | null>> {
  return cells(special, 0, () => SR5(65));
}

/** Run Faster's extended charts: A and B on p. 106, C–E on p. 107. */
function rfPriority(
  special: readonly (number | null)[],
  karma: number,
): Readonly<Record<PriorityLevel, MetatypePriorityCell | null>> {
  return cells(special, karma, (level) => RF(level === 'A' || level === 'B' ? 106 : 107));
}

function cells(
  special: readonly (number | null)[],
  karma: number,
  ref: (level: PriorityLevel) => Ref,
): Readonly<Record<PriorityLevel, MetatypePriorityCell | null>> {
  const out = {} as Record<PriorityLevel, MetatypePriorityCell | null>;
  PRIORITY_LEVELS.forEach((level, i) => {
    const points = special[i] ?? null;
    out[level] = points === null ? null : { special: points, karma, ref: ref(level) };
  });
  return out;
}

const t = (id: RacialTraitId, value?: number): RacialTrait => (value === undefined ? { id } : { id, value });

const MUNDANE_MAGIC: AttributeRange = { base: 0, max: 6 };
const NATURAL_MAGIC: AttributeRange = { base: 1, max: 6 };
const RESONANCE: AttributeRange = { base: 0, max: 6 };

interface Spec {
  id: MetatypeId;
  name: string;
  family: MetatypeFamily;
  variantOf: CoreMetatypeId | null;
  attrs: string;
  priority: Readonly<Record<PriorityLevel, MetatypePriorityCell | null>>;
  lifestyle?: number;
  traits: readonly RacialTrait[];
  ref: Ref;
}

function row(spec: Spec): MetatypeRow {
  const awakenedByBirth = spec.family === 'metasapient' || spec.family === 'shapeshifter';
  return {
    id: spec.id,
    name: spec.name,
    family: spec.family,
    variantOf: spec.variantOf,
    attributes: attrs(spec.attrs),
    magic: awakenedByBirth ? NATURAL_MAGIC : MUNDANE_MAGIC,
    resonance: awakenedByBirth ? null : RESONANCE,
    priority: spec.priority,
    lifestyleMultiplier: spec.lifestyle ?? 1,
    traits: spec.traits,
    ref: spec.ref,
  };
}

const core = (
  id: CoreMetatypeId,
  name: string,
  spec: string,
  special: readonly (number | null)[],
  traits: readonly RacialTrait[],
  lifestyle?: number,
): MetatypeRow =>
  row({
    id,
    name,
    family: 'core',
    variantOf: null,
    attrs: spec,
    priority: corePriority(special),
    ...(lifestyle === undefined ? {} : { lifestyle }),
    traits,
    ref: SR5(66),
  });

const variant = (
  id: MetatypeId,
  name: string,
  of: CoreMetatypeId,
  spec: string,
  special: readonly (number | null)[],
  karma: number,
  traits: readonly RacialTrait[],
  lifestyle?: number,
): MetatypeRow =>
  row({
    id,
    name,
    family: 'metavariant',
    variantOf: of,
    attrs: spec,
    priority: rfPriority(special, karma),
    ...(lifestyle === undefined ? {} : { lifestyle }),
    traits,
    ref: RF(104),
  });

const sapient = (
  id: MetatypeId,
  name: string,
  spec: string,
  special: readonly (number | null)[],
  karma: number,
  traits: readonly RacialTrait[],
  lifestyle: number,
): MetatypeRow =>
  row({
    id,
    name,
    family: 'metasapient',
    variantOf: null,
    attrs: spec,
    priority: rfPriority(special, karma),
    lifestyle,
    traits,
    ref: RF(105),
  });

/** Shapeshifters share their chart cell with a partner species (Bovine with Vulpine, …). */
const shifter = (
  id: MetatypeId,
  name: string,
  spec: string,
  special: readonly (number | null)[],
  karma: number,
  initiativeDice: number,
  traits: readonly RacialTrait[],
): MetatypeRow =>
  row({
    id,
    name,
    family: 'shapeshifter',
    variantOf: null,
    attrs: spec,
    priority: rfPriority(special, karma),
    traits: [...traits, t('shift'), t('initiativeDice', initiativeDice)],
    ref: RF(105),
  });

// Chart cells shared by each shapeshifter pair (RF pp. 106–107).
const BOVINE_VULPINE = [8, 6, 4, null, null] as const;
const CANINE_FALCONINE = [7, 5, 3, null, null] as const;
const LUPINE_EQUINE = [6, 4, 2, null, null] as const;
const URSINE_LEONINE = [4, 2, 0, null, null] as const;
const PANTHERINE_TIGRINE = [4, 2, 0, null, null] as const;

const ELF_LINE = [8, 6, 3, 0, null] as const;
const DWARF_LINE = [7, 4, 1, null, null] as const;
const ORK_LINE = [7, 4, 0, null, null] as const;
const TROLL_LINE = [5, 0, null, null, null] as const;

export const METATYPE_TABLE: readonly MetatypeRow[] = [
  // --- Core (SR5 pp. 65–66) ---
  core('human', 'Human', '1/6 1/6 1/6 1/6 1/6 1/6 1/6 1/6 2/7', [9, 7, 5, 3, 1], []),
  core('elf', 'Elf', '1/6 2/7 1/6 1/6 1/6 1/6 1/6 3/8 1/6', [8, 6, 3, 0, null], [t('lowLight')]),
  core(
    'dwarf',
    'Dwarf',
    '3/8 1/6 1/5 3/8 2/7 1/6 1/6 1/6 1/6',
    [7, 4, 1, null, null],
    [t('thermographic'), t('toxinDice', 2)],
    1.2,
  ),
  core('ork', 'Ork', '4/9 1/6 1/6 3/8 1/6 1/5 1/6 1/5 1/6', [7, 4, 0, null, null], [t('lowLight')]),
  core(
    'troll',
    'Troll',
    '5/10 1/5 1/6 5/10 1/6 1/5 1/5 1/4 1/6',
    [5, 0, null, null, null],
    [t('thermographic'), t('reach', 1), t('dermalArmor', 1)],
    2,
  ),

  // --- Metavariants (RF p. 104; charts pp. 106–107) ---
  variant('nartaki', 'Nartaki', 'human', '1/6 1/6 1/6 1/6 1/6 1/6 1/6 1/6 2/7', [8, 6, 4, 2, 1], 0, [
    t('shivaArms'),
    t('strikingSkinPigmentation'),
  ]),
  variant('dryad', 'Dryad', 'elf', '1/6 2/7 1/6 1/5 1/6 1/6 1/6 3/8 1/6', ELF_LINE, 0, [
    t('glamour'),
    t('lowLight'),
    t('symbiosis'),
  ]),
  variant('nocturna', 'Nocturna', 'elf', '1/5 3/8 1/6 1/6 1/6 1/6 1/6 2/7 1/6', ELF_LINE, 0, [
    t('allergy'),
    t('lowLight'),
    t('keenEared'),
    t('nocturnal'),
    t('unusualHair'),
  ]),
  variant('wakyambi', 'Wakyambi', 'elf', '1/6 2/7 1/6 1/6 1/6 1/5 2/7 1/6 1/6', ELF_LINE, 12, [
    t('celerity'),
    t('elongatedLimbs'),
    t('lowLight'),
  ]),
  variant('xapiri-thepe', 'Xapiri Thëpë', 'elf', '1/6 2/7 1/6 1/6 1/6 1/5 1/6 2/7 1/6', ELF_LINE, 0, [
    t('allergy'),
    t('lowLight'),
    t('photometabolism'),
  ]),
  variant(
    'gnome',
    'Gnome',
    'dwarf',
    '1/4 2/7 1/6 1/4 2/7 2/7 1/6 1/6 1/6',
    DWARF_LINE,
    7,
    [t('arcaneArrester', 2), t('neoteny'), t('thermographic')],
    1.2,
  ),
  variant(
    'hanuman',
    'Hanuman',
    'dwarf',
    '1/6 2/7 1/6 2/7 1/6 1/5 2/7 1/5 1/6',
    DWARF_LINE,
    5,
    [t('monkeyPaws'), t('prehensileTail'), t('thermographic'), t('unusualHair')],
    1.2,
  ),
  variant(
    'koborokuru',
    'Koborokuru',
    'dwarf',
    '2/7 1/6 1/6 2/7 2/7 1/6 1/6 1/6 1/6',
    DWARF_LINE,
    0,
    [t('celerity'), t('pathogenToxinResistance'), t('thermographic'), t('unusualHair')],
    1.2,
  ),
  variant(
    'menehune',
    'Menehune',
    'dwarf',
    '2/7 2/7 1/5 2/7 1/6 1/6 1/6 1/6 1/6',
    DWARF_LINE,
    2,
    [t('pathogenResistance'), t('thermographic'), t('underwaterVision'), t('webbedDigits')],
    1.2,
  ),
  variant('hobgoblin', 'Hobgoblin', 'ork', '3/8 1/6 1/6 2/7 1/6 1/5 1/6 1/5 1/6', ORK_LINE, 5, [
    t('fangs'),
    t('keenEared'),
    t('lowLight'),
    t('poorSelfControl'),
  ]),
  variant('ogre', 'Ogre', 'ork', '4/9 1/6 1/5 3/8 2/7 1/5 1/6 1/4 1/6', ORK_LINE, 8, [
    t('lowLight'),
    t('ogreStomach'),
  ]),
  variant('oni', 'Oni', 'ork', '3/8 2/7 1/6 2/7 1/6 1/5 1/6 2/7 1/6', ORK_LINE, 4, [
    t('lowLight'),
    t('strikingSkinPigmentation'),
  ]),
  variant('satyr', 'Satyr', 'ork', '2/7 1/6 2/7 2/7 1/6 1/6 1/6 1/5 1/6', ORK_LINE, 10, [
    t('lowLight'),
    t('satyrLegs'),
  ]),
  variant(
    'cyclops',
    'Cyclops',
    'troll',
    '5/10 1/5 1/6 6/11 1/6 1/4 1/5 1/4 1/6',
    TROLL_LINE,
    2,
    [t('cyclopeanEye'), t('reach', 1), t('thermographic')],
    2,
  ),
  variant(
    'fomorian',
    'Fomorian',
    'troll',
    '4/9 1/5 1/6 5/10 1/5 1/4 1/4 1/5 1/6',
    TROLL_LINE,
    12,
    [t('arcaneArrester', 1), t('thermographic'), t('reach', 1)],
    2,
  ),
  variant(
    'giant',
    'Giant',
    'troll',
    '5/10 1/5 1/5 5/10 1/6 1/5 1/5 1/5 1/6',
    TROLL_LINE,
    2,
    [t('dermalAlteration'), t('thermographic'), t('reach', 1)],
    2,
  ),
  variant(
    'minotaur',
    'Minotaur',
    'troll',
    '6/11 1/5 1/6 5/10 1/6 1/5 1/6 1/4 1/6',
    TROLL_LINE,
    2,
    [t('goringHorns'), t('thermographic'), t('reach', 1)],
    2,
  ),

  // --- Metasapients (RF p. 105; charts pp. 106–107) ---
  sapient(
    'centaur',
    'Centaur',
    '3/8 1/6 1/6 3/8 1/6 1/6 1/5 1/5 1/5',
    [6, 3, 0, null, null],
    25,
    [t('lowLight'), t('thermographic'), t('magicSense'), t('naturalWeapon'), t('search')],
    2.5,
  ),
  sapient(
    'naga',
    'Naga',
    '3/8 1/4 2/7 4/9 2/7 1/6 1/6 2/7 1/5',
    [4, 2, 0, null, null],
    25,
    [t('armor', 8), t('coldBlooded'), t('dualNatured'), t('guard'), t('naturalWeapon'), t('venom')],
    2.5,
  ),
  sapient(
    'pixie',
    'Pixie',
    '1/2 3/8 3/8 1/2 3/8 2/7 2/7 3/8 2/7',
    [6, 3, 0, null, null],
    15,
    [t('astralPerception'), t('concealment'), t('uneducated'), t('vanishing')],
    2,
  ),
  sapient(
    'sasquatch',
    'Sasquatch',
    '6/11 1/6 1/6 5/10 1/6 1/6 1/6 1/6 1/6',
    [5, 2, 0, null, null],
    20,
    [t('dualNatured'), t('mimicry'), t('naturalWeapon'), t('uneducated')],
    2,
  ),

  // --- Shapeshifters, animal form (RF p. 105; charts pp. 106–107) ---
  shifter('shapeshifter-bovine', 'Shapeshifter (Bovine)', '3/8 1/4 1/4 4/9 1/6 1/5 1/6 1/6 1/5', BOVINE_VULPINE, 5, 1, [
    t('goringHorns'),
    t('uneducated'),
  ]),
  shifter('shapeshifter-canine', 'Shapeshifter (Canine)', '1/5 1/6 2/7 1/5 2/7 1/5 2/7 2/7 1/5', CANINE_FALCONINE, 10, 1, [
    t('broadenedAuditorySpectrum'),
    t('lowLight'),
    t('naturalWeapon'),
    t('vomeronasalOrgan'),
  ]),
  shifter('shapeshifter-equine', 'Shapeshifter (Equine)', '4/9 1/4 1/6 5/10 1/6 1/6 1/6 1/6 1/5', LUPINE_EQUINE, 15, 1, [
    t('keenEared'),
    t('uneducated'),
  ]),
  shifter(
    'shapeshifter-falconine',
    'Shapeshifter (Falconine)',
    '1/4 2/7 3/8 1/4 1/6 1/5 2/7 2/7 1/5',
    CANINE_FALCONINE,
    10,
    2,
    [t('hawkEyed'), t('naturalWeapon'), t('uneducated')],
  ),
  shifter('shapeshifter-leonine', 'Shapeshifter (Leonine)', '3/8 1/6 2/7 4/9 1/5 1/4 2/7 2/7 1/5', URSINE_LEONINE, 20, 2, [
    t('balanceReceptor'),
    t('broadenedAuditorySpectrum'),
    t('lowLight'),
    t('naturalWeapon'),
    t('uneducated'),
  ]),
  shifter('shapeshifter-lupine', 'Shapeshifter (Lupine)', '1/6 2/7 1/6 1/6 1/6 1/5 2/7 2/7 1/5', LUPINE_EQUINE, 15, 2, [
    t('broadenedAuditorySpectrum'),
    t('lowLight'),
    t('naturalWeapon'),
    t('uneducated'),
    t('vomeronasalOrgan'),
  ]),
  shifter(
    'shapeshifter-pantherine',
    'Shapeshifter (Pantherine)',
    '2/7 2/7 2/7 1/6 1/6 1/5 3/8 3/8 1/5',
    PANTHERINE_TIGRINE,
    25,
    2,
    [t('balanceReceptor'), t('broadenedAuditorySpectrum'), t('lowLight'), t('naturalWeapon'), t('uneducated')],
  ),
  shifter(
    'shapeshifter-tigrine',
    'Shapeshifter (Tigrine)',
    '3/8 2/7 2/7 3/8 1/5 1/4 3/8 2/7 1/5',
    PANTHERINE_TIGRINE,
    25,
    2,
    [t('balanceReceptor'), t('broadenedAuditorySpectrum'), t('lowLight'), t('naturalWeapon'), t('uneducated')],
  ),
  shifter('shapeshifter-ursine', 'Shapeshifter (Ursine)', '6/11 1/5 1/5 7/12 1/5 1/5 1/6 1/6 1/5', URSINE_LEONINE, 20, 1, [
    t('broadenedAuditorySpectrum'),
    t('keenEared'),
    t('lowLight'),
    t('naturalWeapon'),
    t('uneducated'),
    t('vomeronasalOrgan'),
  ]),
  shifter('shapeshifter-vulpine', 'Shapeshifter (Vulpine)', '1/4 2/7 1/6 1/4 1/6 1/5 2/7 2/7 1/5', BOVINE_VULPINE, 5, 2, [
    t('broadenedAuditorySpectrum'),
    t('keenEared'),
    t('lowLight'),
    t('naturalWeapon'),
    t('uneducated'),
    t('vomeronasalOrgan'),
  ]),
];

export const METATYPE_BY_ID = Object.fromEntries(METATYPE_TABLE.map((m) => [m.id, m])) as Readonly<
  Record<MetatypeId, MetatypeRow>
>;

/** A metatype by id, case-insensitive (`'Troll'` works; `'orc'` reads as ork); null for anything else. */
export function metatypeRow(id: string | undefined): MetatypeRow | null {
  const key = (id ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const canonical = key === 'orc' ? 'ork' : key;
  return (METATYPE_BY_ID as Readonly<Record<string, MetatypeRow | undefined>>)[canonical] ?? null;
}

/** Special attribute points for a metatype at a priority level; null where it is not on that row. */
export function specialPointsFor(id: MetatypeId, level: PriorityLevel): number | null {
  return METATYPE_BY_ID[id].priority[level]?.special ?? null;
}

/** The additional Karma a metatype costs at a priority level; null where it is not on that row. */
export function metatypeKarmaFor(id: MetatypeId, level: PriorityLevel): number | null {
  return METATYPE_BY_ID[id].priority[level]?.karma ?? null;
}

/** Whether a metatype carries a racial trait (by id). */
export function hasRacialTrait(row: MetatypeRow, id: RacialTraitId): boolean {
  return row.traits.some((trait) => trait.id === id);
}
