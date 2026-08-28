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
});
export type SheetSkill = z.infer<typeof SheetSkillSchema>;

export const SheetQualitySchema = z.object({
  name: z.string().min(1),
  ref: RefSchema.optional(),
  mods: z.array(ModifierSchema).default([]),
  note: z.string().optional(),
});
export type SheetQuality = z.infer<typeof SheetQualitySchema>;

export const SheetAugmentSchema = z.object({
  name: z.string().min(1),
  essence: z.number().min(0).default(0),
  ref: RefSchema.optional(),
  mods: z.array(ModifierSchema).default([]),
  note: z.string().optional(),
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
});
export type SheetIdentity = z.infer<typeof SheetIdentitySchema>;

/** The versioned character sheet JSON (DESIGN.md §9.3). */
export const SheetV1Schema = z.object({
  v: z.literal(1),
  identity: SheetIdentitySchema,
  attributes: SheetAttributesSchema,
  skills: z.array(SheetSkillSchema).default([]),
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
  /** Modifier[] with source.kind = 'override' (Principle 2). */
  overrides: z.array(ModifierSchema).default([]),
});
export type SheetV1 = z.infer<typeof SheetV1Schema>;
export type SheetV1Input = z.input<typeof SheetV1Schema>;
