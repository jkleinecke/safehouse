/**
 * The Priority Table (FR3.9, docs/CHARGEN.md §8.3–8.4): what each level A–E
 * buys in each of the five columns, in both printings, plus the Sum to Ten
 * point costs.
 *
 * Two printings because they disagree. The core rulebook (SR5 p. 65) gives a
 * technomancer three skills from the Resonance, Electronics or Cracking
 * groups and 7/4/3 complex forms; Run Faster's reprint (RF p. 63) gives two
 * Resonance skills and 5/2/1 forms, no skills at C — and the core book's own
 * worked technomancer (p. 70) follows the Run Faster row. Every other cell is
 * identical. A build names its printing (`table: 'sr5' | 'rf'`), so a
 * campaign can run either without anyone editing a number. The vocabularies
 * — levels, columns, printings, magic kinds — are the contracts' enums; this
 * file only gives them numbers.
 *
 * The metatype column is not typed in twice: it is read off the core rows of
 * `metatypes.ts`, which also carries Run Faster's extended charts. Resources
 * are per creation level — street and prime replace the column (SR5 p. 64).
 *
 * Grant pools say what a free skill may be, not which one: `category` reads
 * the Skills chapter section (the "Magical skills" of the table are the
 * magical section — Arcana, Assensing and Astral Combat included — and the
 * validator still applies Assensing's astral fence); `groups` are the
 * member skills of those groups; `any` is any active skill (the adept's).
 *
 * Numbers and ids only (DESIGN.md §14).
 */
import {
  PRIORITY_LEVELS,
  type CreationLevel,
  type MagicKind,
  type PriorityLevel,
  type PriorityTable,
  type Ref,
} from '@safehouse/contracts';
import { CORE_METATYPE_IDS, METATYPE_BY_ID, type CoreMetatypeId } from './metatypes.js';
import { RF, SR5 } from './pages.js';
import type { ActiveSkillRow, SkillCategory, SkillGroupId } from './skills.js';

/** What a granted skill may be. */
export type GrantPool =
  | { kind: 'category'; category: SkillCategory }
  | { kind: 'groups'; groups: readonly SkillGroupId[] }
  | { kind: 'any' };

/**
 * Whether a skill is one a grant's pool includes: any active skill, a Skills
 * chapter section, or a member of the named groups. The validator's reading,
 * and the Magic step's list of what a grant may still be.
 */
export function grantPoolIncludes(row: Pick<ActiveSkillRow, 'category' | 'group'>, pool: GrantPool): boolean {
  switch (pool.kind) {
    case 'any':
      return true;
    case 'category':
      return row.category === pool.category;
    case 'groups':
      return !!row.group && pool.groups.includes(row.group);
  }
}

export interface SkillGrant {
  /** How many skills the player picks. */
  count: number;
  /** The rating each picked skill starts at, free. */
  rating: number;
  pool: GrantPool;
}

export interface GroupGrant {
  count: number;
  rating: number;
  /** The groups one may be picked from. */
  groups: readonly SkillGroupId[];
}

export interface MagicPriorityOption {
  kind: Exclude<MagicKind, 'mundane'>;
  attribute: 'mag' | 'res';
  /** The Magic or Resonance rating the row grants (special points add on top). */
  rating: number;
  skills: SkillGrant | null;
  groups: GroupGrant | null;
  /** Free spells, rituals and/or alchemical preparations. */
  formulae: number;
  /** Free complex forms. */
  forms: number;
  ref: Ref;
}

export interface PriorityRow {
  level: PriorityLevel;
  /** Special attribute points per core metatype; a missing metatype is not on this row. */
  metatype: Readonly<Partial<Record<CoreMetatypeId, number>>>;
  /** Points for the eight mental and physical attributes; all must be spent. */
  attributes: number;
  /** The options this row opens; empty on E (mundane). */
  magic: readonly MagicPriorityOption[];
  /** Individual skill points and skill group points; neither buys the other. */
  skills: { points: number; groupPoints: number };
  /** Starting nuyen by creation level. */
  resources: Readonly<Record<CreationLevel, number>>;
  ref: Ref;
}

/** One printing's five rows. (`PriorityTable` in contracts is the printing's id.) */
export type PriorityChart = Readonly<Record<PriorityLevel, PriorityRow>>;

// ---------------------------------------------------------------------------

const MAGICAL: GrantPool = { kind: 'category', category: 'magical' };
const RESONANCE: GrantPool = { kind: 'category', category: 'resonance' };
const TECHNOMANCER_GROUPS: GrantPool = { kind: 'groups', groups: ['tasking', 'electronics', 'cracking'] };
const ANY: GrantPool = { kind: 'any' };
const MAGICAL_GROUPS: readonly SkillGroupId[] = ['sorcery', 'conjuring', 'enchanting'];

/** Magician and mystic adept share a cell. */
function casters(rating: number, skills: SkillGrant | null, formulae: number, ref: Ref): MagicPriorityOption[] {
  return (['magician', 'mysticAdept'] as const).map((kind) => ({
    kind,
    attribute: 'mag',
    rating,
    skills,
    groups: null,
    formulae,
    forms: 0,
    ref,
  }));
}

function technomancer(rating: number, skills: SkillGrant | null, forms: number, ref: Ref): MagicPriorityOption {
  return { kind: 'technomancer', attribute: 'res', rating, skills, groups: null, formulae: 0, forms, ref };
}

function adept(rating: number, skills: SkillGrant | null, ref: Ref): MagicPriorityOption {
  return { kind: 'adept', attribute: 'mag', rating, skills, groups: null, formulae: 0, forms: 0, ref };
}

function aspected(rating: number, groups: GroupGrant | null, ref: Ref): MagicPriorityOption {
  return { kind: 'aspected', attribute: 'mag', rating, skills: null, groups, formulae: 0, forms: 0, ref };
}

const grant = (count: number, rating: number, pool: GrantPool): SkillGrant => ({ count, rating, pool });
const groupGrant = (count: number, rating: number): GroupGrant => ({ count, rating, groups: MAGICAL_GROUPS });

/** The metatype column, read off the core metatype rows (SR5 p. 65). */
function metatypeColumn(level: PriorityLevel): Readonly<Partial<Record<CoreMetatypeId, number>>> {
  const out: Partial<Record<CoreMetatypeId, number>> = {};
  for (const id of CORE_METATYPE_IDS) {
    const cell = METATYPE_BY_ID[id].priority[level];
    if (cell) out[id] = cell.special;
  }
  return out;
}

/** The columns both printings share. Street and prime resources: SR5 p. 64. */
const SHARED: Readonly<Record<PriorityLevel, Omit<PriorityRow, 'magic' | 'ref'>>> = {
  A: {
    level: 'A',
    metatype: metatypeColumn('A'),
    attributes: 24,
    skills: { points: 46, groupPoints: 10 },
    resources: { street: 75_000, experienced: 450_000, prime: 500_000 },
  },
  B: {
    level: 'B',
    metatype: metatypeColumn('B'),
    attributes: 20,
    skills: { points: 36, groupPoints: 5 },
    resources: { street: 50_000, experienced: 275_000, prime: 325_000 },
  },
  C: {
    level: 'C',
    metatype: metatypeColumn('C'),
    attributes: 16,
    skills: { points: 28, groupPoints: 2 },
    resources: { street: 25_000, experienced: 140_000, prime: 210_000 },
  },
  D: {
    level: 'D',
    metatype: metatypeColumn('D'),
    attributes: 14,
    skills: { points: 22, groupPoints: 0 },
    resources: { street: 15_000, experienced: 50_000, prime: 150_000 },
  },
  E: {
    level: 'E',
    metatype: metatypeColumn('E'),
    attributes: 12,
    skills: { points: 18, groupPoints: 0 },
    resources: { street: 6_000, experienced: 6_000, prime: 100_000 },
  },
};

/** Magic-column cells identical in both printings (everything but the technomancer). */
function sharedMagic(ref: Ref): Readonly<Record<PriorityLevel, readonly MagicPriorityOption[]>> {
  return {
    A: casters(6, grant(2, 5, MAGICAL), 10, ref),
    B: [...casters(4, grant(2, 4, MAGICAL), 7, ref), adept(6, grant(1, 4, ANY), ref), aspected(5, groupGrant(1, 4), ref)],
    C: [...casters(3, null, 5, ref), adept(4, grant(1, 2, ANY), ref), aspected(3, groupGrant(1, 2), ref)],
    D: [adept(2, null, ref), aspected(2, null, ref)],
    E: [],
  };
}

function table(
  ref: Ref,
  technomancers: Readonly<Record<'A' | 'B' | 'C', MagicPriorityOption>>,
): PriorityChart {
  const magic = sharedMagic(ref);
  const withTechno = (level: PriorityLevel): readonly MagicPriorityOption[] => {
    const cell = magic[level];
    if (level === 'D' || level === 'E') return cell;
    // Technomancer sits after the casters, before adept/aspected, as printed.
    const casterCount = cell.filter((o) => o.kind === 'magician' || o.kind === 'mysticAdept').length;
    return [...cell.slice(0, casterCount), technomancers[level], ...cell.slice(casterCount)];
  };
  const out = {} as Record<PriorityLevel, PriorityRow>;
  for (const level of PRIORITY_LEVELS) out[level] = { ...SHARED[level], magic: withTechno(level), ref };
  return out;
}

const SR5_REF = SR5(65);
const RF_REF = RF(63);

/** Both printings, keyed by the build's `table`. */
export const PRIORITY_CHARTS: Readonly<Record<PriorityTable, PriorityChart>> = {
  sr5: table(SR5_REF, {
    A: technomancer(6, grant(3, 5, TECHNOMANCER_GROUPS), 7, SR5_REF),
    B: technomancer(4, grant(3, 4, TECHNOMANCER_GROUPS), 4, SR5_REF),
    C: technomancer(3, grant(3, 2, TECHNOMANCER_GROUPS), 3, SR5_REF),
  }),
  rf: table(RF_REF, {
    A: technomancer(6, grant(2, 5, RESONANCE), 5, RF_REF),
    B: technomancer(4, grant(2, 4, RESONANCE), 2, RF_REF),
    C: technomancer(3, null, 1, RF_REF),
  }),
};

/** The option a magic kind has at a level in a printing, or null where the row does not offer it. */
export function magicPriorityOption(
  table: PriorityTable,
  level: PriorityLevel,
  kind: MagicKind,
): MagicPriorityOption | null {
  return PRIORITY_CHARTS[table][level].magic.find((o) => o.kind === kind) ?? null;
}

/**
 * Whether a Magic row offers any type that uses Magic (`mag`) or Resonance
 * (`res`) — the reading the validator makes when it decides whether a
 * special point on an attribute no type uses yet is step 4's to settle (a type
 * still to pick) or step 3's (the row offers none). Step 3 opens the attribute
 * by the same answer.
 */
export function magicRowOffers(table: PriorityTable, level: PriorityLevel, attribute: 'mag' | 'res'): boolean {
  return PRIORITY_CHARTS[table][level].magic.some((option) => option.attribute === attribute);
}

/**
 * Sum to Ten (RF p. 62): ten points buy the five columns' levels, which may
 * repeat; each column is still chosen once. The standard A–E array costs 10.
 */
export const SUM_TO_TEN = {
  points: 10,
  cost: { A: 4, B: 3, C: 2, D: 1, E: 0 } satisfies Readonly<Record<PriorityLevel, number>>,
  ref: RF(62),
} as const;

// ---------------------------------------------------------------------------
// Magic-user types (SR5 p. 69; technomancer p. 98)
// ---------------------------------------------------------------------------

export interface MagicKindRow {
  id: MagicKind;
  attribute: 'mag' | 'res' | null;
  /** Adepts get Power Points equal to Magic; mystic adepts buy them with Karma, up to Magic. */
  powerPoints: 'free' | 'karma' | null;
  /** Sorcery/Conjuring/Enchanting skills: all of them, only the chosen aspect's, or none. */
  magicalGroups: 'all' | 'aspect' | 'none';
  /** Innate for magicians and aspected; only through the Astral Perception power for adepts and mystic adepts. */
  astralPerception: 'innate' | 'power' | null;
  astralProjection: boolean;
  mentorSpirit: boolean;
  /** Formulae known per group at creation ≤ Magic × this; complex forms ≤ Resonance × this. */
  knownPerRating: number;
  ref: Ref;
}

export const MAGIC_KIND_TABLE: Readonly<Record<MagicKind, MagicKindRow>> = {
  mundane: {
    id: 'mundane',
    attribute: null,
    powerPoints: null,
    magicalGroups: 'none',
    astralPerception: null,
    astralProjection: false,
    mentorSpirit: false,
    knownPerRating: 0,
    ref: SR5(68),
  },
  magician: {
    id: 'magician',
    attribute: 'mag',
    powerPoints: null,
    magicalGroups: 'all',
    astralPerception: 'innate',
    astralProjection: true,
    mentorSpirit: true,
    knownPerRating: 2,
    ref: SR5(69),
  },
  aspected: {
    id: 'aspected',
    attribute: 'mag',
    powerPoints: null,
    magicalGroups: 'aspect',
    astralPerception: 'innate',
    astralProjection: false,
    mentorSpirit: true,
    knownPerRating: 2,
    ref: SR5(69),
  },
  adept: {
    id: 'adept',
    attribute: 'mag',
    powerPoints: 'free',
    magicalGroups: 'none',
    astralPerception: 'power',
    astralProjection: false,
    mentorSpirit: true,
    knownPerRating: 0,
    ref: SR5(69),
  },
  mysticAdept: {
    id: 'mysticAdept',
    attribute: 'mag',
    powerPoints: 'karma',
    magicalGroups: 'all',
    astralPerception: 'power',
    astralProjection: false,
    mentorSpirit: true,
    knownPerRating: 2,
    ref: SR5(69),
  },
  technomancer: {
    id: 'technomancer',
    attribute: 'res',
    powerPoints: null,
    magicalGroups: 'none',
    astralPerception: null,
    astralProjection: false,
    mentorSpirit: false,
    knownPerRating: 2,
    ref: SR5(98),
  },
};
