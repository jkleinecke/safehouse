/**
 * Seeded procedural NPC generation (FR10.1–10.3, D13).
 * The engine rolls every number inside GM-authored template ranges; the AI
 * never invents mechanics. Same seed → identical output; per-aspect seed
 * substreams make field-level locks/rerolls independent (FR10.2).
 */
import type {
  GenTemplate,
  GenTier,
  NumRange,
  Persona,
  SheetSkill,
  SheetV1,
  SheetV1Input,
} from '@safehouse/contracts';
import { ATTRIBUTE_CODES, SheetV1Schema } from '@safehouse/contracts';
import { hashSeed, combineSeed, pick, randInt, shuffle, subRng, weightedPick, type Seed } from './prng.js';
import { APPEARANCE_TABLE, MOTIVATION_TABLE, NAME_TABLE, QUIRK_TABLE } from './tables.js';
import {
  ATTR_MAX,
  ATTR_MIN,
  SKILL_MAX,
  SKILL_MIN,
  clampInt,
  skillAttrFor,
  validitySweep,
  type MonitorSizes,
} from './validity.js';

type WeaponInput = NonNullable<SheetV1Input['weapons']>[number];
type ArmorInput = NonNullable<SheetV1Input['armor']>[number];
type GearInput = NonNullable<SheetV1Input['gear']>[number];

/**
 * Resolved gear records for loadout options, keyed by the option string used
 * in the template's slots (FR10.1: slots reference the GM's own records —
 * the server resolves them and passes this catalog; the pure engine does no
 * lookups). Unresolved options land in sheet.gear as named entries.
 */
export interface LoadoutCatalog {
  weapons?: Record<string, WeaponInput>;
  armor?: Record<string, ArmorInput>;
  gear?: Record<string, GearInput>;
}

export interface GenerateOptions {
  catalog?: LoadoutCatalog;
}

/** One-line flavor stub drawn from the original-content tables (FR10.2). */
export interface NpcFlavor {
  name: string;
  quirk: string;
  appearance: string;
  motivation: string;
}

export interface GeneratedNpc {
  name: string;
  /** Normalized uint32 seed that reproduces this NPC exactly. */
  seed: number;
  tierId: string;
  metatype: string;
  professionalRating: number;
  /** A valid SheetV1 — generation output is immediately playable (FR10.2). */
  sheet: SheetV1;
  /** Monitor sizes derived in the validity pass (full derivation: deriveCharacter). */
  monitors: MonitorSizes;
  /** Flavor stub from original-content tables; the Fixer may expand it later (FR12.5). */
  persona: Partial<Persona>;
  flavor: NpcFlavor;
  /** Slot → picked option names, as sampled from the template loadout. */
  loadout: Record<string, string[]>;
  /** Validity-pass corrections (empty when the template ranges were in bounds). */
  corrections: string[];
}

/** Shared-statblock grunt group (FR10.2 / FR4.6): one statblock, many faces. */
export interface GeneratedGruntGroup {
  seed: number;
  tierId: string;
  metatype: string;
  professionalRating: number;
  /** The shared stats; alias is a group label, members carry the names. */
  statblock: SheetV1;
  monitors: MonitorSizes;
  members: GeneratedNpc[];
}

export interface RegenerateLocks {
  /** Keep attributes, skills, Professional Rating (and metatype, unless overridden). */
  stats?: boolean;
  /** Keep metatype independently of the stats lock. */
  metatype?: boolean;
  /** Keep the name. */
  name?: boolean;
  /** Keep quirk / appearance / motivation (name has its own lock). */
  flavor?: boolean;
  /** Keep loadout picks and the resulting weapons/armor/gear. */
  loadout?: boolean;
}

export interface RegenerateOptions extends GenerateOptions {
  lock?: RegenerateLocks;
}

// ---------------------------------------------------------------------------

function requireTier(template: GenTemplate, tierId: string): GenTier {
  const tier = template.tiers.find((t) => t.id === tierId);
  if (!tier) {
    const known = template.tiers.map((t) => t.id).join(', ');
    throw new Error(`generator: unknown tier "${tierId}" (template has: ${known})`);
  }
  return tier;
}

function sampleRange(rng: () => number, range: NumRange, lo: number, hi: number): number {
  return clampInt(randInt(rng, range.min, range.max), lo, hi);
}

interface SampledStats {
  metatype: string;
  core: Record<(typeof ATTRIBUTE_CODES)[number], number>;
  edgMax: number;
  mag: number;
  res: number;
  skills: SheetSkill[];
  professionalRating: number;
  loadout: Record<string, string[]>;
  weapons: WeaponInput[];
  armor: ArmorInput[];
  gear: GearInput[];
}

/** Sample every mechanical value from its own seed substream (order-independent). */
function sampleStats(tier: GenTier, seed: number, catalog?: LoadoutCatalog): SampledStats {
  const metatype = weightedPick(subRng(seed, 'metatype'), tier.metatypeWeights ?? {}) ?? 'human';

  const core = { bod: 3, agi: 3, rea: 3, str: 3, wil: 3, log: 3, int: 3, cha: 3 };
  for (const code of ATTRIBUTE_CODES) {
    const range = tier.attributes[code];
    if (range) core[code] = sampleRange(subRng(seed, `attr:${code}`), range, ATTR_MIN, ATTR_MAX);
  }
  const magRange = tier.attributes['mag'];
  const resRange = tier.attributes['res'];
  const mag = magRange ? sampleRange(subRng(seed, 'attr:mag'), magRange, 0, ATTR_MAX) : 0;
  const res = resRange ? sampleRange(subRng(seed, 'attr:res'), resRange, 0, ATTR_MAX) : 0;

  const professionalRating = sampleRange(subRng(seed, 'pr'), tier.professionalRating, 0, 12);
  const edgRange = tier.attributes['edg'];
  const edgMax = edgRange
    ? sampleRange(subRng(seed, 'attr:edg'), edgRange, 1, 7)
    : clampInt(Math.ceil(professionalRating / 2), 1, 7);

  const skills: SheetSkill[] = Object.keys(tier.skills)
    .sort()
    .map((id) => {
      const range = tier.skills[id] as NumRange;
      return {
        id,
        rating: sampleRange(subRng(seed, `skill:${id}`), range, SKILL_MIN, SKILL_MAX),
        attr: skillAttrFor(id),
      };
    });

  const loadout: Record<string, string[]> = {};
  const weapons: WeaponInput[] = [];
  const armor: ArmorInput[] = [];
  const gear: GearInput[] = [];
  for (const slot of tier.loadout) {
    if (slot.options.length === 0) {
      loadout[slot.slot] = [];
      continue;
    }
    const countRange = slot.count ?? { min: 1, max: 1 };
    const n = clampInt(
      randInt(subRng(seed, `loadout:${slot.slot}:count`), countRange.min, countRange.max),
      0,
      slot.options.length,
    );
    const picks = shuffle(subRng(seed, `loadout:${slot.slot}:pick`), slot.options).slice(0, n);
    loadout[slot.slot] = picks;
    for (const option of picks) {
      const weapon = catalog?.weapons?.[option];
      if (weapon) {
        weapons.push({ ...weapon });
        continue;
      }
      const armorRec = catalog?.armor?.[option];
      if (armorRec) {
        armor.push({ ...armorRec, worn: armorRec.worn ?? true });
        continue;
      }
      const gearRec = catalog?.gear?.[option];
      if (gearRec) {
        gear.push({ ...gearRec });
        continue;
      }
      // INTEGRATION: unresolved loadout option — the server generator plugin
      // should resolve gear record ids/names into a LoadoutCatalog.
      gear.push({ name: option, qty: 1, note: `slot: ${slot.slot}` });
    }
  }

  return { metatype, core, edgMax, mag, res, skills, professionalRating, loadout, weapons, armor, gear };
}

function sampleFlavor(seed: number): NpcFlavor {
  return {
    name: pick(subRng(seed, 'name'), NAME_TABLE),
    quirk: pick(subRng(seed, 'flavor:quirk'), QUIRK_TABLE),
    appearance: pick(subRng(seed, 'flavor:appearance'), APPEARANCE_TABLE),
    motivation: pick(subRng(seed, 'flavor:motivation'), MOTIVATION_TABLE),
  };
}

function personaStub(flavor: NpcFlavor): Partial<Persona> {
  return {
    traits: [flavor.appearance],
    mannerisms: [flavor.quirk],
    goals: [flavor.motivation],
  };
}

function assembleNpc(
  template: GenTemplate,
  tier: GenTier,
  seed: number,
  stats: SampledStats,
  flavor: NpcFlavor,
): GeneratedNpc {
  const roles = template.roleTags.join(', ') || 'none';
  const input: SheetV1Input = {
    v: 1,
    identity: {
      alias: flavor.name,
      metatype: stats.metatype,
      portraitId: null,
      notes: `Generated NPC — roles: ${roles}; tier: ${tier.label}; PR ${stats.professionalRating}`,
    },
    attributes: {
      ...stats.core,
      edg: { max: stats.edgMax, current: stats.edgMax },
      ess: 6,
      mag: stats.mag,
      res: stats.res,
    },
    skills: stats.skills,
    weapons: stats.weapons,
    armor: stats.armor,
    gear: stats.gear,
    spells: tier.spells.map((name) => ({ name })),
    augments: tier.augments.map((name) => ({ name, essence: 0 })),
  };
  const swept = validitySweep(SheetV1Schema.parse(input));
  return {
    name: flavor.name,
    seed,
    tierId: tier.id,
    metatype: stats.metatype,
    professionalRating: stats.professionalRating,
    sheet: swept.sheet,
    monitors: swept.monitors,
    persona: personaStub(flavor),
    flavor,
    loadout: stats.loadout,
    corrections: swept.corrections,
  };
}

// ---------------------------------------------------------------------------

/**
 * Generate one NPC from an archetype template + tier (FR10.2).
 * Deterministic: the same (template, tierId, seed) always yields the same NPC.
 */
export function generateNpc(
  template: GenTemplate,
  tierId: string,
  seed: Seed,
  opts?: GenerateOptions,
): GeneratedNpc {
  const s = hashSeed(seed);
  const tier = requireTier(template, tierId);
  return assembleNpc(template, tier, s, sampleStats(tier, s, opts?.catalog), sampleFlavor(s));
}

/**
 * Field-level reroll (FR10.2 "keep the stats, reroll the names"):
 * regenerate with a new seed, holding locked aspects from a previous result.
 */
export function regenerate(
  prev: GeneratedNpc,
  template: GenTemplate,
  tierId: string,
  seed: Seed,
  opts?: RegenerateOptions,
): GeneratedNpc {
  const lock = opts?.lock ?? {};
  const fresh = generateNpc(template, tierId, seed, opts);

  const name = lock.name ? prev.name : fresh.name;
  const flavor: NpcFlavor = {
    name,
    quirk: lock.flavor ? prev.flavor.quirk : fresh.flavor.quirk,
    appearance: lock.flavor ? prev.flavor.appearance : fresh.flavor.appearance,
    motivation: lock.flavor ? prev.flavor.motivation : fresh.flavor.motivation,
  };
  const statsSrc = lock.stats ? prev : fresh;
  const metatype = (lock.metatype ?? lock.stats) ? prev.metatype : fresh.metatype;
  const loadoutSrc = lock.loadout ? prev : fresh;

  const merged: SheetV1 = {
    ...fresh.sheet,
    identity: { ...fresh.sheet.identity, alias: name, metatype },
    attributes: statsSrc.sheet.attributes,
    skills: statsSrc.sheet.skills,
    weapons: loadoutSrc.sheet.weapons,
    armor: loadoutSrc.sheet.armor,
    gear: loadoutSrc.sheet.gear,
  };
  const swept = validitySweep(merged);
  return {
    name,
    seed: fresh.seed,
    tierId: fresh.tierId,
    metatype,
    professionalRating: statsSrc.professionalRating,
    sheet: swept.sheet,
    monitors: swept.monitors,
    persona: personaStub(flavor),
    flavor,
    loadout: loadoutSrc.loadout,
    corrections: swept.corrections,
  };
}

/**
 * Generate a grunt group: ONE shared statblock, `size` named members
 * (FR10.2). Same seed → identical squad, names distinct while the table lasts.
 */
export function generateGruntGroup(
  template: GenTemplate,
  tierId: string,
  size: number,
  seed: Seed,
  opts?: GenerateOptions,
): GeneratedGruntGroup {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`generator.generateGruntGroup: size must be a positive integer (got ${size})`);
  }
  const s = hashSeed(seed);
  const tier = requireTier(template, tierId);
  const stats = sampleStats(tier, s, opts?.catalog);

  const shuffledNames = shuffle(subRng(s, 'group:names'), NAME_TABLE);
  const members: GeneratedNpc[] = [];
  for (let i = 0; i < size; i++) {
    const base = shuffledNames[i % shuffledNames.length] as string;
    const round = Math.floor(i / shuffledNames.length);
    const memberSeed = combineSeed(s, `member:${i}`);
    const flavor: NpcFlavor = {
      name: round === 0 ? base : `${base} ${round + 1}`,
      quirk: pick(subRng(memberSeed, 'flavor:quirk'), QUIRK_TABLE),
      appearance: pick(subRng(memberSeed, 'flavor:appearance'), APPEARANCE_TABLE),
      motivation: pick(subRng(memberSeed, 'flavor:motivation'), MOTIVATION_TABLE),
    };
    const member = assembleNpc(template, tier, memberSeed, stats, flavor);
    members.push(member);
  }

  const label = `${template.roleTags[0] ?? 'grunt'} (${tier.label})`;
  const statblockFlavor: NpcFlavor = {
    name: label,
    quirk: '',
    appearance: '',
    motivation: '',
  };
  const statblock = assembleNpc(template, tier, s, stats, statblockFlavor);

  return {
    seed: s,
    tierId: tier.id,
    metatype: stats.metatype,
    professionalRating: stats.professionalRating,
    statblock: statblock.sheet,
    monitors: statblock.monitors,
    members,
  };
}
