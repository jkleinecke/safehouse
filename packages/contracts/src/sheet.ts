/**
 * The versioned character sheet (DESIGN.md §9.3) — what the runner *is*.
 *
 * Every field added after the first stored sheets exists is additive: a new
 * list defaults to empty, a new block defaults to its "nothing here" shape,
 * and a new per-item field is optional. That is the whole migration strategy
 * (there is no sheet migration code, and `splitStoredSheet` answers 500 on a
 * stored sheet that fails to parse), so a field that is required without a
 * default here breaks every character already in the database.
 *
 * The native builder (FR3.9, docs/CHARGEN.md §8.3) is what grew the latest
 * set: knowledge and language skills as their own lists, the Awakened block,
 * a skill's specific target, an implant's grade and rating, and a quality's
 * type, Karma and rating. The small vocabularies both the sheet and the build
 * record use (magic kinds, aspects, implant grades, knowledge categories,
 * quality types) live here, because the build imports the sheet and not the
 * other way round. No book text; numbers, ids and page refs only (§14).
 */
import { z } from 'zod';
import { ModifierSchema } from './modifier.js';
import { RefSchema } from './common.js';

/** The eight core attributes (lowercase codes, DESIGN.md §9.3). */
export const ATTRIBUTE_CODES = ['bod', 'agi', 'rea', 'str', 'wil', 'log', 'int', 'cha'] as const;
export const AttributeCodeSchema = z.enum(ATTRIBUTE_CODES);
export type AttributeCode = z.infer<typeof AttributeCodeSchema>;

/** Attributes a skill may key off (incl. magic/resonance). */
export const SkillAttrSchema = z.enum([...ATTRIBUTE_CODES, 'mag', 'res']);
export type SkillAttr = z.infer<typeof SkillAttrSchema>;

/**
 * What kind of Awakened or Emerged a character is (SR5 p.68–69). `mundane` is
 * the default everywhere: a sheet written before this block existed is a
 * mundane's until someone says otherwise.
 */
export const MAGIC_KINDS = ['mundane', 'magician', 'aspected', 'adept', 'mysticAdept', 'technomancer'] as const;
export const MagicKindSchema = z.enum(MAGIC_KINDS);
export type MagicKind = z.infer<typeof MagicKindSchema>;

/** The one skill group an aspected magician is limited to (SR5 p.69). */
export const MAGIC_ASPECTS = ['sorcery', 'conjuring', 'enchanting'] as const;
export const MagicAspectSchema = z.enum(MAGIC_ASPECTS);
export type MagicAspect = z.infer<typeof MagicAspectSchema>;

/**
 * Implant grades (SR5 p.451). Only standard, alphaware and used are legal at
 * creation (p.95); betaware and deltaware are here because a sheet in play can
 * carry them. The multipliers are the rules engine's, not the contract's.
 */
export const AUGMENT_GRADES = ['standard', 'alphaware', 'betaware', 'deltaware', 'used'] as const;
export const AugmentGradeSchema = z.enum(AUGMENT_GRADES);
export type AugmentGrade = z.infer<typeof AugmentGradeSchema>;

/** Knowledge skill categories (SR5 p.89): academic/professional on LOG, interests/street on INT. */
export const KNOWLEDGE_CATEGORIES = ['academic', 'interests', 'professional', 'street'] as const;
export const KnowledgeCategorySchema = z.enum(KNOWLEDGE_CATEGORIES);
export type KnowledgeCategory = z.infer<typeof KnowledgeCategorySchema>;

/** Positive qualities cost Karma; negative ones give it (SR5 p.71). */
export const QUALITY_TYPES = ['positive', 'negative'] as const;
export const QualityTypeSchema = z.enum(QUALITY_TYPES);
export type QualityType = z.infer<typeof QualityTypeSchema>;

const NonNegInt = z.number().int().min(0);

export const EdgeStateSchema = z.object({
  max: NonNegInt,
  current: NonNegInt,
});
export type EdgeState = z.infer<typeof EdgeStateSchema>;

export const SheetAttributesSchema = z.object({
  bod: NonNegInt,
  agi: NonNegInt,
  rea: NonNegInt,
  str: NonNegInt,
  wil: NonNegInt,
  log: NonNegInt,
  int: NonNegInt,
  cha: NonNegInt,
  edg: EdgeStateSchema,
  ess: z.number().min(0).default(6),
  mag: NonNegInt.default(0),
  res: NonNegInt.default(0),
});
export type SheetAttributes = z.infer<typeof SheetAttributesSchema>;

export const SheetSkillSchema = z.object({
  id: z.string().min(1),
  rating: NonNegInt,
  attr: SkillAttrSchema,
  spec: z.string().nullable().optional(),
  group: z.string().nullable().optional(),
  /**
   * What a "specific" skill is specific to — the weapon of Exotic Melee or
   * Exotic Ranged, the vehicle of Pilot Exotic Vehicle (SR5 p.131, p.147).
   * One skill per target, so two exotic weapons are two rows with one id.
   */
  target: z.string().optional(),
});
export type SheetSkill = z.infer<typeof SheetSkillSchema>;

/**
 * A knowledge skill (SR5 p.89). Kept apart from `skills` because it has its
 * own point pool at creation, its own linked attribute by category, and no
 * defaulting. Chummer-imported sheets still carry theirs inside `skills`; the
 * importer is left as it is.
 */
export const SheetKnowledgeSchema = z.object({
  name: z.string().min(1),
  category: KnowledgeCategorySchema,
  rating: NonNegInt,
  spec: z.string().nullable().optional(),
});
export type SheetKnowledge = z.infer<typeof SheetKnowledgeSchema>;

/**
 * A language (SR5 p.89, p.150). A native language has no rating to roll
 * against — the book writes it `N` — so `native` says so and `rating` is
 * what was bought on top of that, usually 0.
 */
export const SheetLanguageSchema = z.object({
  name: z.string().min(1),
  rating: NonNegInt.default(0),
  native: z.boolean().default(false),
  spec: z.string().nullable().optional(),
});
export type SheetLanguage = z.infer<typeof SheetLanguageSchema>;

export const SheetQualitySchema = z.object({
  name: z.string().min(1),
  ref: RefSchema.optional(),
  mods: z.array(ModifierSchema).default([]),
  note: z.string().optional(),
  /** Positive or negative. Absent on sheets written before the builder. */
  type: QualityTypeSchema.optional(),
  /** What it cost (positive) or gave (negative), as a magnitude, at its rating. */
  karma: NonNegInt.optional(),
  /** For rated qualities; absent for the rest. */
  rating: z.number().int().min(1).optional(),
});
export type SheetQuality = z.infer<typeof SheetQualitySchema>;

export const SheetAugmentSchema = z.object({
  name: z.string().min(1),
  /**
   * Essence this implant costs, with its grade ALREADY applied (alphaware
   * × 0.8, used × 1.25, …). derive subtracts it as written; `grade` below is
   * the record of why the number is what it is, not an instruction to apply
   * the multiplier a second time.
   */
  essence: z.number().min(0).default(0),
  ref: RefSchema.optional(),
  mods: z.array(ModifierSchema).default([]),
  note: z.string().optional(),
  grade: AugmentGradeSchema.optional(),
  rating: z.number().int().min(0).optional(),
});
export type SheetAugment = z.infer<typeof SheetAugmentSchema>;

export const AmmoStateSchema = z.object({
  cap: NonNegInt,
  current: NonNegInt,
});
export type AmmoState = z.infer<typeof AmmoStateSchema>;

export const SheetWeaponSchema = z.object({
  name: z.string().min(1),
  skillId: z.string().min(1),
  /** Accuracy (feeds limit kind 'accuracy'). */
  acc: z.number().int().optional(),
  /** Damage value code, e.g. '8P', '10S(e)' — user-entered. */
  dv: z.string().optional(),
  /** Armor penetration (negative pierces). */
  ap: z.number().int().default(0),
  /** Fire modes, e.g. SS/SA/BF/FA — user-entered strings. */
  modes: z.array(z.string()).default([]),
  /** Key into the sheet's rangeTables (ranged weapons only). */
  rangeCat: z.string().optional(),
  ammo: AmmoStateSchema.optional(),
  /** Recoil compensation total (progressive recoil counter lives in play state, FR3.4). */
  recoilComp: z.number().int().optional(),
  ref: RefSchema.optional(),
  note: z.string().optional(),
});
export type SheetWeapon = z.infer<typeof SheetWeaponSchema>;

export const SheetArmorSchema = z.object({
  name: z.string().min(1),
  rating: z.number().int(),
  worn: z.boolean().default(false),
  ref: RefSchema.optional(),
  note: z.string().optional(),
});
export type SheetArmor = z.infer<typeof SheetArmorSchema>;

export const SheetSpellSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  /** User-entered drain code, e.g. 'F-3' (FR8.1). */
  drain: z.string().optional(),
  ref: RefSchema.optional(),
  note: z.string().optional(),
});
export type SheetSpell = z.infer<typeof SheetSpellSchema>;

export const SheetPowerSchema = z.object({
  name: z.string().min(1),
  rating: z.number().int().optional(),
  /** Power point cost. */
  cost: z.number().optional(),
  mods: z.array(ModifierSchema).default([]),
  ref: RefSchema.optional(),
  note: z.string().optional(),
});
export type SheetPower = z.infer<typeof SheetPowerSchema>;

export const SheetComplexFormSchema = z.object({
  name: z.string().min(1),
  target: z.string().optional(),
  fading: z.string().optional(),
  ref: RefSchema.optional(),
  note: z.string().optional(),
});
export type SheetComplexForm = z.infer<typeof SheetComplexFormSchema>;

export const SheetDeckSchema = z.object({
  name: z.string().min(1),
  /** Attack / Sleaze / Data Processing / Firewall. */
  asdf: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
  programs: z.array(z.string()).default([]),
});
export type SheetDeck = z.infer<typeof SheetDeckSchema>;

export const SheetMatrixSchema = z.object({
  deck: SheetDeckSchema.optional(),
});
export type SheetMatrix = z.infer<typeof SheetMatrixSchema>;

export const SheetGearSchema = z.object({
  name: z.string().min(1),
  qty: z.number().int().min(1).default(1),
  rating: z.number().int().optional(),
  ref: RefSchema.optional(),
  note: z.string().optional(),
});
export type SheetGear = z.infer<typeof SheetGearSchema>;

export const SheetLifestyleSchema = z.object({
  name: z.string().min(1),
  costPerMonth: z.number().min(0),
  /** In-game date, ISO-ish string (e.g. '2076-06-01'). */
  paidThrough: z.string().optional(),
});
export type SheetLifestyle = z.infer<typeof SheetLifestyleSchema>;

/** short / medium / long / extreme band edges in meters (user-entered, G6). */
export const RangeBandsSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type RangeBands = z.infer<typeof RangeBandsSchema>;

export const RangeTablesSchema = z.record(z.string(), RangeBandsSchema);
export type RangeTables = z.infer<typeof RangeTablesSchema>;

export const SheetIdentitySchema = z.object({
  alias: z.string().min(1),
  metatype: z.string().default('human'),
  portraitId: z.string().nullable().default(null),
  notes: z.string().optional(),
  realName: z.string().optional(),
  age: z.number().int().min(0).optional(),
  sex: z.string().optional(),
});
export type SheetIdentity = z.infer<typeof SheetIdentitySchema>;

/**
 * The Awakened / Emerged block (SR5 p.68–71, p.279–280). The Magic or
 * Resonance *rating* stays in `attributes`; this is what kind of practitioner
 * the rating belongs to, which the validator, the Magic tab and drain rolls
 * all need and no attribute can say.
 *
 * `tradition` is a free id rather than an enum because traditions beyond the
 * core two exist in the GM's other books; `drain` is the pair of attributes
 * the tradition resists drain with (a technomancer's fading pair lives here
 * too), so a roll never has to know the tradition to find it.
 */
export const SheetAwakeningSchema = z.object({
  kind: MagicKindSchema.default('mundane'),
  aspect: MagicAspectSchema.nullable().default(null),
  tradition: z.string().nullable().default(null),
  drain: z.tuple([SkillAttrSchema, SkillAttrSchema]).nullable().default(null),
  mentor: z.string().nullable().default(null),
  /** Adept power points available (free = Magic for adepts; bought for mystic adepts). */
  powerPoints: NonNegInt.default(0),
  /**
   * Initiate grade (SR5 p.325), or submersion grade for a technomancer
   * (p.259). 0 for everyone who has taken neither, which is every character
   * made before the builder could buy one — so the field defaults rather than
   * being absent on an older sheet.
   */
  grade: NonNegInt.default(0),
});
export type SheetAwakening = z.infer<typeof SheetAwakeningSchema>;

/** The versioned character sheet JSON (DESIGN.md §9.3). */
export const SheetV1Schema = z.object({
  v: z.literal(1),
  identity: SheetIdentitySchema,
  attributes: SheetAttributesSchema,
  skills: z.array(SheetSkillSchema).default([]),
  knowledge: z.array(SheetKnowledgeSchema).default([]),
  languages: z.array(SheetLanguageSchema).default([]),
  qualities: z.array(SheetQualitySchema).default([]),
  augments: z.array(SheetAugmentSchema).default([]),
  weapons: z.array(SheetWeaponSchema).default([]),
  armor: z.array(SheetArmorSchema).default([]),
  spells: z.array(SheetSpellSchema).default([]),
  powers: z.array(SheetPowerSchema).default([]),
  complexForms: z.array(SheetComplexFormSchema).default([]),
  matrix: SheetMatrixSchema.default({}),
  gear: z.array(SheetGearSchema).default([]),
  lifestyles: z.array(SheetLifestyleSchema).default([]),
  rangeTables: RangeTablesSchema.default({}),
  awakening: SheetAwakeningSchema.default(() => ({
    kind: 'mundane' as const,
    aspect: null,
    tradition: null,
    drain: null,
    mentor: null,
    powerPoints: 0,
    grade: 0,
  })),
  /** Modifier[] with source.kind = 'override' (Principle 2). */
  overrides: z.array(ModifierSchema).default([]),
});
export type SheetV1 = z.infer<typeof SheetV1Schema>;
export type SheetV1Input = z.input<typeof SheetV1Schema>;
