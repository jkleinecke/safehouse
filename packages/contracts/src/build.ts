/**
 * The character build — *how the runner was paid for* (FR3.9,
 * docs/CHARGEN.md §4.1 as amended by §8.3).
 *
 * A sheet is what the runner is; a build is the decisions that produced it:
 * which priority went where, how many points went into each attribute, which
 * spells the Magic column granted, what was bought and what Karma was spent
 * on after. It holds decisions, never results — `attributes` is points spent,
 * not ratings — because that is what keeps every budget recomputable and
 * every validation honest. The rules engine's `compileBuild` turns one of
 * these into a `SheetV1`; nothing in play ever reads the build again.
 *
 * ## Why so much defaults
 *
 * A build is autosaved on every change from the first tap, so the record has
 * to be legal while it is still mostly empty: an unfilled priority slot is
 * `null`, an alias not yet typed is `''`, a contact row added but not named
 * has a blank name. "Is this finished?" is the validator's question
 * (`packages/rules/src/chargen/validate.ts`), answered as `Issue[]` with the
 * page each rule comes from. Nothing in here refines or transforms; the
 * schemas are structural, like every other contract (§7.3). The one shape
 * `CharacterBuildSchema.parse({ v: 1 })` yields is the empty draft; the
 * canonical `emptyBuild()` belongs to the rules package, not this one.
 *
 * Nested defaults that hold arrays are factories, because zod copies a
 * literal default only one level deep and two drafts must never share a list.
 *
 * ## What is not here
 *
 * No book text (§14). The tables that give these decisions meaning — the
 * priority table, metatype base/max, advancement costs, grade multipliers,
 * the level presets' Karma and Resources — are the rules engine's numeric
 * data with page refs. This file carries ids, numbers and `{ book, page }`
 * only. The one table here is `CHARGEN_LEVEL_PRESETS`, and only the part of
 * it a GM's campaign settings can override.
 */
import { z } from 'zod';
import { RefSchema } from './common.js';
import { ModifierSchema } from './modifier.js';
import {
  ATTRIBUTE_CODES,
  AugmentGradeSchema,
  KnowledgeCategorySchema,
  MagicAspectSchema,
  MagicKindSchema,
  QualityTypeSchema,
  SheetArmorSchema,
  SheetAugmentSchema,
  SheetGearSchema,
  SheetV1Schema,
  SheetWeaponSchema,
} from './sheet.js';

const NonNegInt = z.number().int().min(0);
/** A name a player types. Bounded so an autosave cannot carry a novel. */
const Name = z.string().max(200);
const LongText = z.string().max(20_000);

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/** Where a build is in its life (§4.3): only draft and returned are editable. */
export const BUILD_STATES = ['draft', 'submitted', 'returned', 'approved'] as const;
export const BuildStateSchema = z.enum(BUILD_STATES);
export type BuildState = z.infer<typeof BuildStateSchema>;

/** Priority (SR5 p.65) or Sum-to-Ten (RF p.62). Karma build and Life Modules are not offered (§7). */
export const BUILD_METHODS = ['priority', 'sumToTen'] as const;
export const BuildMethodSchema = z.enum(BUILD_METHODS);
export type BuildMethod = z.infer<typeof BuildMethodSchema>;

/** Street, experienced, prime runner (SR5 p.64). The GM sets it per campaign. */
export const CREATION_LEVELS = ['street', 'experienced', 'prime'] as const;
export const CreationLevelSchema = z.enum(CREATION_LEVELS);
export type CreationLevel = z.infer<typeof CreationLevelSchema>;

/**
 * Which printing of the priority table: the core book's (SR5 p.65) or Run
 * Faster's (RF p.63). They differ only in the technomancer cells, and the
 * core book's own technomancer example follows the RF row (§8.3).
 */
export const PRIORITY_TABLES = ['sr5', 'rf'] as const;
export const PriorityTableSchema = z.enum(PRIORITY_TABLES);
export type PriorityTable = z.infer<typeof PriorityTableSchema>;

/** The rows of the priority table. */
export const PRIORITY_LEVELS = ['A', 'B', 'C', 'D', 'E'] as const;
export const PriorityLevelSchema = z.enum(PRIORITY_LEVELS);
export type PriorityLevel = z.infer<typeof PriorityLevelSchema>;

/** The columns of the priority table, in the book's order. */
export const PRIORITY_COLUMNS = ['metatype', 'attributes', 'magic', 'skills', 'resources'] as const;
export const PriorityColumnSchema = z.enum(PRIORITY_COLUMNS);
export type PriorityColumn = z.infer<typeof PriorityColumnSchema>;

/** Edge, Magic, Resonance — the attributes only special points buy (SR5 p.66). */
export const SPECIAL_ATTRIBUTE_CODES = ['edg', 'mag', 'res'] as const;
export const SpecialAttributeCodeSchema = z.enum(SPECIAL_ATTRIBUTE_CODES);
export type SpecialAttributeCode = z.infer<typeof SpecialAttributeCodeSchema>;

/** Any attribute a Karma raise can target. */
export const BuildAttributeIdSchema = z.enum([...ATTRIBUTE_CODES, ...SPECIAL_ATTRIBUTE_CODES]);
export type BuildAttributeId = z.infer<typeof BuildAttributeIdSchema>;

/** The two traditions the core book prints (SR5 p.279). */
export const MAGIC_TRADITIONS = ['hermetic', 'shamanic'] as const;
export const MagicTraditionSchema = z.enum(MAGIC_TRADITIONS);
export type MagicTradition = z.infer<typeof MagicTraditionSchema>;

/**
 * The walkthrough's nine screens (§4.4), in order. A step *number* is the
 * index here plus one; `Issue.step`, `CharacterBuild.step` and `returnedStep`
 * all use that numbering, not the book's chapter steps.
 */
export const BUILD_STEPS = ['concept', 'priorities', 'metatype', 'magic', 'qualities', 'skills', 'gear', 'karma', 'finish'] as const;
export type BuildStepName = (typeof BUILD_STEPS)[number];
export const BuildStepSchema = z.number().int().min(1).max(BUILD_STEPS.length);
export type BuildStep = z.infer<typeof BuildStepSchema>;

/** Guided (Next gated on each step) or free (the strip is a tab bar). */
export const BUILD_MODES = ['guided', 'free'] as const;
export const BuildModeSchema = z.enum(BUILD_MODES);
export type BuildMode = z.infer<typeof BuildModeSchema>;

/** The GM's call on one `approval` issue. */
export const APPROVAL_DECISIONS = ['approved', 'denied'] as const;
export const ApprovalDecisionSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/**
 * The most decisions a build's approvals may hold, and the most one GM write
 * may carry. A build raises a handful of `approval` issues, so this is room
 * to spare, not a budget — it is here so a GM route cannot grow the column
 * without end, one call at a time.
 */
export const MAX_APPROVAL_DECISIONS = 200;
/** An `approval` issue's code, as a decision is keyed. */
export const ApprovalCodeSchema = z.string().min(1).max(200);

/**
 * How long each of the record's lists may be.
 *
 * None of them was bounded, and Fastify's JSON body limit is 1 MiB, so one
 * PATCH could store the better part of a megabyte of record — eleven thousand
 * Karma spends — and every pass the engine makes over the record (`budgets`,
 * `validate`, `compileBuild`) then took seconds rather than milliseconds. The
 * build's own owner could freeze the table's single-process database that way,
 * with a request the routes were happy to accept.
 *
 * So each list stops at a length no runner the book can describe reaches.
 * These are not budgets — the validator holds the book's actual limits (skill
 * points, Karma, the nuyen a priority gives), and a legal build uses a small
 * fraction of any of these. They are the wall past which a record stops being
 * a character and starts being a denial of service.
 *
 * A stored row longer than its cap no longer parses, which is the same fate as
 * a row from before any other schema tightening: the list shows it as a
 * flagged stub, opening it says `build_invalid`, and it can still be deleted.
 */
export const BUILD_LIST_MAX = {
  /** Leftover Karma at creation buys a handful of things; 50 Karma cannot buy 200. */
  karmaSpends: 200,
  /** Charisma × 3 Karma at 2 Karma a contact tops out around a dozen. */
  contacts: 50,
  /** Power points buy at most a few dozen levels of powers. */
  powers: 60,
  /** 25 Karma of positives and 25 of negatives, plus the metatype's buy-offs. */
  qualities: 60,
  /** Every gear line, augment and vehicle a resources priority can pay for. */
  purchases: 300,
  lifestyles: 12,
  /** The Magic column's free picks (skills, groups, spells, complex forms). */
  grants: 60,
  /** The active skill table has fewer than a hundred rows; exotic skills add a row per weapon. */
  activeSkills: 200,
  /** Sixteen skill groups exist. */
  skillGroups: 40,
  /** (INT + LOG) × 2 knowledge points, one per rating, plus what Karma adds. */
  knowledge: 120,
  languages: 40,
} as const;

/** The decisions a GM write carries (`return`, `approve`): bounded in count and key length. */
export const ApprovalDecisionsSchema = z
  .record(ApprovalCodeSchema, ApprovalDecisionSchema)
  .refine((r) => Object.keys(r).length <= MAX_APPROVAL_DECISIONS, `at most ${MAX_APPROVAL_DECISIONS} decisions at once`);

// ---------------------------------------------------------------------------
// Priorities, special points, attribute points
// ---------------------------------------------------------------------------

/**
 * A row per column; `null` while the slot is empty. Under `priority` the five
 * must all differ; under `sumToTen` rows may repeat and must cost 10 (A4 B3
 * C2 D1 E0). Both are the validator's rules — structurally a repeat is legal,
 * so one schema serves both methods.
 */
export const BuildPrioritiesSchema = z.object({
  metatype: PriorityLevelSchema.nullable().default(null),
  attributes: PriorityLevelSchema.nullable().default(null),
  magic: PriorityLevelSchema.nullable().default(null),
  skills: PriorityLevelSchema.nullable().default(null),
  resources: PriorityLevelSchema.nullable().default(null),
});
export type BuildPriorities = z.infer<typeof BuildPrioritiesSchema>;

/** Special attribute points spent (SR5 p.66). */
export const BuildSpecialPointsSchema = z.object({
  edg: NonNegInt.default(0),
  mag: NonNegInt.default(0),
  res: NonNegInt.default(0),
});
export type BuildSpecialPoints = z.infer<typeof BuildSpecialPointsSchema>;

/** Attribute points spent on top of the metatype base (SR5 p.66). */
export const BuildAttributePointsSchema = z.object({
  bod: NonNegInt.default(0),
  agi: NonNegInt.default(0),
  rea: NonNegInt.default(0),
  str: NonNegInt.default(0),
  wil: NonNegInt.default(0),
  log: NonNegInt.default(0),
  int: NonNegInt.default(0),
  cha: NonNegInt.default(0),
});
export type BuildAttributePoints = z.infer<typeof BuildAttributePointsSchema>;

// ---------------------------------------------------------------------------
// Magic and Resonance
// ---------------------------------------------------------------------------

/**
 * What kind of practitioner, and the choices that come with it (SR5 p.68–71).
 * `waived` names grants the player chose not to fill — "every grant is either
 * filled or explicitly waived" is how Step 4 completes (§4.4).
 */
export const BuildMagicSchema = z.object({
  kind: MagicKindSchema.default('mundane'),
  aspect: MagicAspectSchema.optional(),
  tradition: MagicTraditionSchema.optional(),
  mentor: Name.optional(),
  waived: z.array(z.string()).optional(),
});
export type BuildMagic = z.infer<typeof BuildMagicSchema>;

/**
 * Something picked from the catalogue (or typed by hand): a spell, a complex
 * form. `catalogueId` is the book item row it came from, when it came from
 * one; `ref` the printed page.
 *
 * The rest is what the sheet's own spell and complex form lines keep, carried
 * so the approved sheet can roll what the book prints without a second trip
 * to the catalogue: a spell's `drain` code ("F-3") and a form's `fading`
 * ("L+1") and `target`, as `SheetSpellSchema` / `SheetComplexFormSchema`
 * store them, and `note` for the printed type, range, damage and duration.
 * All optional — a pick typed by hand, or saved before these existed, has
 * none, and the sheet then asks for drain by hand as it always has.
 */
export const BuildPickSchema = z.object({
  name: Name.min(1),
  ref: RefSchema.optional(),
  catalogueId: z.string().optional(),
  category: z.string().optional(),
  drain: z.string().max(40).optional(),
  fading: z.string().max(40).optional(),
  target: z.string().max(80).optional(),
  note: Name.optional(),
});
export type BuildPick = z.infer<typeof BuildPickSchema>;

/** A skill (or group) the Magic column hands over at a fixed rating. */
export const BuildGrantRatingSchema = z.object({
  id: z.string().min(1),
  rating: NonNegInt,
});
export type BuildGrantRating = z.infer<typeof BuildGrantRatingSchema>;

/** The Magic/Resonance column's free picks (SR5 p.65, RF p.63). */
export const BuildGrantsSchema = z.object({
  skills: z.array(BuildGrantRatingSchema).max(BUILD_LIST_MAX.grants).default([]),
  groups: z.array(BuildGrantRatingSchema).max(BUILD_LIST_MAX.grants).default([]),
  spells: z.array(BuildPickSchema).max(BUILD_LIST_MAX.grants).default([]),
  forms: z.array(BuildPickSchema).max(BUILD_LIST_MAX.grants).default([]),
});
export type BuildGrants = z.infer<typeof BuildGrantsSchema>;

/**
 * An adept power bought with power points (SR5 p.308–311). `cost` is the
 * power points this power takes at `levels` — the whole of it, not per
 * level, because Improved Reflexes' three levels do not cost three times its
 * first. `target` is the skill, attribute or limit a power names.
 */
export const BuildPowerPickSchema = z.object({
  name: Name.min(1),
  ref: RefSchema.optional(),
  catalogueId: z.string().optional(),
  cost: z.number().min(0),
  levels: z.number().int().min(1).default(1),
  target: z.string().optional(),
  mods: z.array(ModifierSchema).default([]),
});
export type BuildPowerPick = z.infer<typeof BuildPowerPickSchema>;

// ---------------------------------------------------------------------------
// Qualities
// ---------------------------------------------------------------------------

/**
 * A quality as bought (SR5 p.71–87). `karma` is the magnitude at its rating —
 * what a positive one cost or a negative one gave. Effects are hand-entered
 * modifiers with the page open (§6.2, §8.1); `target` is the attribute or
 * skill id a quality names (Exceptional Attribute, Aptitude), which is what
 * the validator's whitelist reads instead of parsing it out of the name.
 */
export const BuildQualitySchema = z.object({
  name: Name.min(1),
  ref: RefSchema.optional(),
  catalogueId: z.string().optional(),
  type: QualityTypeSchema,
  karma: NonNegInt,
  rating: z.number().int().min(1).nullable().default(null),
  target: z.string().optional(),
  mods: z.array(ModifierSchema).default([]),
  note: z.string().optional(),
});
export type BuildQuality = z.infer<typeof BuildQualitySchema>;

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/**
 * An active skill bought with skill points (SR5 p.88–89). A specialisation
 * costs one more point. `target` is for the "specific" skills — the weapon of
 * Exotic Melee/Ranged, the vehicle of Pilot Exotic Vehicle.
 */
export const BuildActiveSkillSchema = z.object({
  id: z.string().min(1),
  points: NonNegInt.default(0),
  spec: z.string().nullable().default(null),
  target: z.string().optional(),
});
export type BuildActiveSkill = z.infer<typeof BuildActiveSkillSchema>;

/** A skill group bought with group points. Groups take no specialisation. */
export const BuildSkillGroupSchema = z.object({
  id: z.string().min(1),
  points: NonNegInt.default(0),
});
export type BuildSkillGroup = z.infer<typeof BuildSkillGroupSchema>;

/**
 * A knowledge skill. `points` come from the free (INT + LOG) × 2 pool;
 * `skillPoints` from the active-skill pool, which the book allows to buy
 * knowledge ranks too (SR5 p.88) — the pools mix in that one direction.
 */
export const BuildKnowledgeSkillSchema = z.object({
  name: Name,
  category: KnowledgeCategorySchema,
  points: NonNegInt.default(0),
  skillPoints: NonNegInt.default(0),
  spec: z.string().nullable().default(null),
});
export type BuildKnowledgeSkill = z.infer<typeof BuildKnowledgeSkillSchema>;

/** A language; one native language is free (a second with Bilingual, SR5 p.89). */
export const BuildLanguageSchema = z.object({
  name: Name,
  native: z.boolean().default(false),
  points: NonNegInt.default(0),
  skillPoints: NonNegInt.default(0),
  spec: z.string().nullable().default(null),
});
export type BuildLanguage = z.infer<typeof BuildLanguageSchema>;

export const BuildSkillsSchema = z.object({
  active: z.array(BuildActiveSkillSchema).max(BUILD_LIST_MAX.activeSkills).default([]),
  groups: z.array(BuildSkillGroupSchema).max(BUILD_LIST_MAX.skillGroups).default([]),
  knowledge: z.array(BuildKnowledgeSkillSchema).max(BUILD_LIST_MAX.knowledge).default([]),
  languages: z.array(BuildLanguageSchema).max(BUILD_LIST_MAX.languages).default([]),
});
export type BuildSkills = z.infer<typeof BuildSkillsSchema>;

// ---------------------------------------------------------------------------
// Resources: purchases and lifestyles
// ---------------------------------------------------------------------------

/**
 * Which sheet list a purchase lands on. Spells, powers, forms and qualities
 * are not bought with nuyen at creation; a spell *formula* or a focus is gear.
 */
export const PURCHASE_LISTS = ['gear', 'weapons', 'armor', 'augments'] as const;
export const PurchaseListSchema = z.enum(PURCHASE_LISTS);
export type PurchaseList = z.infer<typeof PurchaseListSchema>;

/**
 * What every purchase carries, whatever list it lands on. `cost` is per unit
 * at list price with the grade NOT applied; `essence` per unit, before grade
 * (§8.3) — the budget applies the multipliers, so changing a grade never
 * means re-reading the catalogue. `avail` is the printed code ("12R", "4F").
 * `kind` is the catalogue's own kind (weapon, ammo, electronics, vehicle…);
 * `category` the table heading the row sat under ("BIOWARE", "COMMLINKS"),
 * which is the only thing that tells bioware from cyberware — the catalogue
 * kind is `augmentation` for both. `deviceRating` is a Matrix device's
 * printed Device Rating, which the commlink and deck tables give in a column
 * of its own rather than as the item's Rating (the creation cap, p.94).
 */
const PurchaseBase = {
  kind: z.string().min(1),
  name: Name.min(1),
  ref: RefSchema.optional(),
  catalogueId: z.string().optional(),
  category: z.string().max(120).optional(),
  qty: z.number().int().min(1).default(1),
  rating: NonNegInt.nullable().default(null),
  deviceRating: NonNegInt.max(24).optional(),
  grade: AugmentGradeSchema.nullable().default(null),
  cost: z.number().min(0).default(0),
  avail: z.string().nullable().default(null),
  essence: z.number().min(0).default(0),
};

/**
 * A line bought with nuyen. `item` is exactly the sheet item the catalogue
 * mapping (`toSheetItem`) produced, so compile copies it rather than
 * re-deriving stats; the `list` discriminant keeps that item typed. It is the
 * raw mapping — compile is what writes the grade-applied Essence, the rating
 * and the quantity onto the sheet's copy, from the fields above.
 */
export const BuildPurchaseSchema = z.discriminatedUnion('list', [
  z.object({ ...PurchaseBase, list: z.literal('gear'), item: SheetGearSchema }),
  z.object({ ...PurchaseBase, list: z.literal('weapons'), item: SheetWeaponSchema }),
  z.object({ ...PurchaseBase, list: z.literal('armor'), item: SheetArmorSchema }),
  z.object({ ...PurchaseBase, list: z.literal('augments'), item: SheetAugmentSchema }),
]);
export type BuildPurchase = z.infer<typeof BuildPurchaseSchema>;
export type BuildPurchaseInput = z.input<typeof BuildPurchaseSchema>;

/** Lifestyle tiers (SR5 p.373); each also sets the starting-nuyen dice (p.95). */
export const LIFESTYLE_TIERS = ['street', 'squatter', 'low', 'middle', 'high', 'luxury'] as const;
export const LifestyleTierSchema = z.enum(LIFESTYLE_TIERS);
export type LifestyleTier = z.infer<typeof LifestyleTierSchema>;

/**
 * A lifestyle paid ahead. Several may be kept, each at full cost (p.373);
 * `name` is the line as the sheet shows it ("Low (safehouse)"), `tier` is
 * what prices it.
 */
export const BuildLifestyleSchema = z.object({
  tier: LifestyleTierSchema,
  name: Name.min(1),
  months: z.number().int().min(1).default(1),
  ref: RefSchema.optional(),
  note: z.string().optional(),
});
export type BuildLifestyle = z.infer<typeof BuildLifestyleSchema>;

// ---------------------------------------------------------------------------
// Karma: conversion, spends, contacts
// ---------------------------------------------------------------------------

/**
 * The highest rating a Karma spend may ask for. The real ceilings are the
 * rules engine's — 12 for a skill, 13 for the one Aptitude names, a
 * metatype's natural maximum (one more with Exceptional Attribute) for an
 * attribute — and they answer with the rule and its page rather than a 400.
 * This is the bound underneath them: pricing and training walk one step per
 * rating, so an unbounded `to` is an unbounded loop, and no printed maximum
 * in either book comes near this figure even for a house metatype.
 */
export const SPEND_RATING_MAX = 24;
const Rating = z.number().int().min(0).max(SPEND_RATING_MAX);

/** An attribute raised with Karma: new rating × 5 per step (SR5 p.107). */
export const KarmaAttributeSpendSchema = z.object({
  kind: z.literal('attribute'),
  id: BuildAttributeIdSchema,
  from: Rating,
  to: Rating,
});

/** An active skill raised or learned: new × 2 (p.107). `target` for specific skills. */
export const KarmaSkillSpendSchema = z.object({
  kind: z.literal('skill'),
  id: Name.min(1),
  from: Rating,
  to: Rating,
  target: Name.optional(),
});

/** A skill group raised: new × 5 (p.107). */
export const KarmaGroupSpendSchema = z.object({
  kind: z.literal('group'),
  id: Name.min(1),
  from: Rating,
  to: Rating,
});

/** A knowledge skill raised or learned: new × 1 (p.107). Keyed by name. */
export const KarmaKnowledgeSpendSchema = z.object({
  kind: z.literal('knowledge'),
  name: Name.min(1),
  category: KnowledgeCategorySchema.optional(),
  from: Rating,
  to: Rating,
});

/** A language raised or learned: new × 1 (p.107). */
export const KarmaLanguageSpendSchema = z.object({
  kind: z.literal('language'),
  name: Name.min(1),
  from: Rating,
  to: Rating,
});

/**
 * A specialisation: 7 Karma (p.107). `id` is the active skill id, or the name
 * of the knowledge skill or language when `list` says so.
 */
export const KarmaSpecializationSpendSchema = z.object({
  kind: z.literal('specialization'),
  list: z.enum(['active', 'knowledge', 'language']).default('active'),
  id: Name.min(1),
  spec: Name.min(1),
});

/** A spell, ritual or preparation: 5 Karma (p.107). */
export const KarmaSpellSpendSchema = BuildPickSchema.extend({ kind: z.literal('spell') });

/** A complex form: 4 Karma (p.107). */
export const KarmaFormSpendSchema = BuildPickSchema.extend({ kind: z.literal('form') });

/**
 * The highest grade of initiation or submersion a record may carry. Each
 * grade costs 10 + grade × 3 Karma (p.325), so even a prime runner's 35 Karma
 * plus 25 from negative qualities buys grade 1 and no more; the cap is here so
 * pricing and the grade loop are bounded, not as a rule of the book.
 */
export const INITIATION_GRADE_MAX = 12;

/**
 * Initiation (a magician's, p.325) or submersion (a technomancer's, p.259) to
 * a grade. Only a prime runner may take one at creation (p.64, p.98), and
 * `CREATION_LEVEL_PRESETS[level].canInitiate` is what says so — the Step 1
 * screen printed "Initiation at creation: allowed" for a prime table long
 * before any spend could act on it.
 *
 * One spend per grade, so the Karma is the sum of the grades taken and the
 * record says which ones were paid for rather than only where it ended up.
 */
export const KarmaInitiationSpendSchema = z.object({
  kind: z.literal('initiation'),
  grade: z.number().int().min(1).max(INITIATION_GRADE_MAX),
  /** The metamagic or echo taken with the grade, when the player named one. */
  metamagic: Name.optional(),
  ref: RefSchema.optional(),
});

/** Power points for a mystic adept: 5 Karma each, up to Magic (p.69), bought at creation. */
export const KarmaPowerPointSpendSchema = z.object({
  kind: z.literal('powerPoint'),
  count: Rating.min(1),
});

/**
 * A bound spirit: 1 Karma per service, Force = Magic, at most Charisma of them
 * (p.98). The bounds are the magic store's (`spiritType` 80 characters,
 * services 999), so an approved build always fits the record it becomes.
 */
export const KarmaSpiritSpendSchema = z.object({
  kind: z.literal('spirit'),
  type: z.string().min(1).max(80),
  services: z.number().int().min(1).max(999),
});

/** A registered sprite: 1 Karma per task, Level = Resonance, at most Charisma (p.98). Bounded like a spirit. */
export const KarmaSpriteSpendSchema = z.object({
  kind: z.literal('sprite'),
  type: z.string().min(1).max(80),
  tasks: z.number().int().min(1).max(999),
});

/**
 * A focus bonded at creation (SR5 p.318; total Force ≤ Magic × 2, p.98).
 * The focus itself is a purchase (matched by `catalogueId`, else by name);
 * this is the Karma to bond it. `focusType` (spell, spirit, power, weapon,
 * qi, enchanting, metamagic — or a sub-type such as sustaining) is what the
 * bonding cost is checked against; the engine falls back to reading the type
 * out of the name. What the focus feeds in play — `sourceKind`, `targets`
 * (the pools its Force adds to) or explicit `mods` — is entered by hand with
 * the page open, as for any focus added in play (FR8.4), and rides through
 * to the magic store's record so a focus bonded at creation is not inert on
 * approval. The bounds are the magic store's (name 120, kind 60, Force 12,
 * twelve targets of 80 characters, twelve modifiers).
 */
/** The highest Force a focus is recorded at — the magic store's bound. */
export const FOCUS_FORCE_MAX = 12;

export const KarmaFocusSpendSchema = z.object({
  kind: z.literal('focus'),
  name: z.string().min(1).max(120),
  focusType: z.string().max(60).optional(),
  force: z.number().int().min(1).max(FOCUS_FORCE_MAX),
  bondKarma: NonNegInt,
  ref: RefSchema.optional(),
  catalogueId: z.string().optional(),
  sourceKind: z.enum(['power', 'spell']).optional(),
  targets: z.array(z.string().min(1).max(80)).max(12).optional(),
  mods: z.array(ModifierSchema).max(12).optional(),
});

/** One thing leftover Karma bought (SR5 p.98–99, costs p.107). */
export const KarmaSpendSchema = z.discriminatedUnion('kind', [
  KarmaAttributeSpendSchema,
  KarmaSkillSpendSchema,
  KarmaGroupSpendSchema,
  KarmaKnowledgeSpendSchema,
  KarmaLanguageSpendSchema,
  KarmaSpecializationSpendSchema,
  KarmaSpellSpendSchema,
  KarmaFormSpendSchema,
  KarmaPowerPointSpendSchema,
  KarmaInitiationSpendSchema,
  KarmaSpiritSpendSchema,
  KarmaSpriteSpendSchema,
  KarmaFocusSpendSchema,
]);
export type KarmaSpend = z.infer<typeof KarmaSpendSchema>;
export type KarmaSpendInput = z.input<typeof KarmaSpendSchema>;
export type KarmaSpendKind = KarmaSpend['kind'];
export const KARMA_SPEND_KINDS = [
  'attribute',
  'skill',
  'group',
  'knowledge',
  'language',
  'specialization',
  'spell',
  'form',
  'powerPoint',
  'initiation',
  'spirit',
  'sprite',
  'focus',
] as const satisfies readonly KarmaSpendKind[];

/**
 * A contact bought with the free Charisma × 3 Karma (SR5 p.98). `role` is the
 * `contacts` table's `archetype`; approval inserts a row there (§8.2). The
 * bounds are the table's (connection 1–12, loyalty 1–6); the creation limit
 * of 7 per contact is the validator's.
 */
/** The contacts table's bounds (§8.2), which a build's contact steppers stop at. */
export const CONTACT_BOUNDS = {
  connection: { min: 1, max: 12 },
  loyalty: { min: 1, max: 6 },
} as const;

export const BuildContactSchema = z.object({
  name: Name.default(''),
  role: Name.default(''),
  connection: z.number().int().min(CONTACT_BOUNDS.connection.min).max(CONTACT_BOUNDS.connection.max).default(1),
  loyalty: z.number().int().min(CONTACT_BOUNDS.loyalty.min).max(CONTACT_BOUNDS.loyalty.max).default(1),
  notes: z.string().max(4000).optional(),
});
export type BuildContact = z.infer<typeof BuildContactSchema>;

export const BuildKarmaSchema = z.object({
  /** Karma converted to nuyen at 2,000¥ each (SR5 p.94; cap by level, p.64). */
  toNuyen: NonNegInt.default(0),
  spends: z.array(KarmaSpendSchema).max(BUILD_LIST_MAX.karmaSpends).default([]),
  contacts: z.array(BuildContactSchema).max(BUILD_LIST_MAX.contacts).default([]),
});
export type BuildKarma = z.infer<typeof BuildKarmaSchema>;

// ---------------------------------------------------------------------------
// Identity and the record
// ---------------------------------------------------------------------------

/** Who the runner is. Only the alias is needed to finish Step 1; `concept` is a preset id. */
export const BuildIdentitySchema = z.object({
  alias: Name.default(''),
  realName: Name.optional(),
  age: z.number().int().min(0).nullable().optional(),
  sex: Name.optional(),
  background: LongText.optional(),
  concept: z.string().optional(),
});
export type BuildIdentity = z.infer<typeof BuildIdentitySchema>;

/** The record — see the file header. */
export const CharacterBuildSchema = z.object({
  v: z.literal(1),
  method: BuildMethodSchema.default('priority'),
  level: CreationLevelSchema.default('experienced'),
  table: PriorityTableSchema.default('sr5'),
  priorities: BuildPrioritiesSchema.default({
    metatype: null,
    attributes: null,
    magic: null,
    skills: null,
    resources: null,
  }),
  /**
   * An id from the rules engine's metatype table (human, elf, dwarf, ork,
   * troll, and Run Faster's metavariants when the campaign allows them);
   * `null` until one is picked.
   */
  metatype: z.string().min(1).nullable().default(null),
  special: BuildSpecialPointsSchema.default({ edg: 0, mag: 0, res: 0 }),
  attributes: BuildAttributePointsSchema.default({ bod: 0, agi: 0, rea: 0, str: 0, wil: 0, log: 0, int: 0, cha: 0 }),
  magic: BuildMagicSchema.default({ kind: 'mundane' }),
  grants: BuildGrantsSchema.default(() => ({ skills: [], groups: [], spells: [], forms: [] })),
  powers: z.array(BuildPowerPickSchema).max(BUILD_LIST_MAX.powers).default([]),
  qualities: z.array(BuildQualitySchema).max(BUILD_LIST_MAX.qualities).default([]),
  skills: BuildSkillsSchema.default(() => ({ active: [], groups: [], knowledge: [], languages: [] })),
  purchases: z.array(BuildPurchaseSchema).max(BUILD_LIST_MAX.purchases).default([]),
  lifestyles: z.array(BuildLifestyleSchema).max(BUILD_LIST_MAX.lifestyles).default([]),
  karma: BuildKarmaSchema.default(() => ({ toNuyen: 0, spends: [], contacts: [] })),
  identity: BuildIdentitySchema.default({ alias: '' }),
  /**
   * The GM's per-item decisions on `approval` issues, keyed by issue code.
   * Each code names one decision — the item and the fields that made it need
   * approval — so a decision never carries over to a different item or an
   * edited one. GM-owned, like `notes`, `returnedStep` and `state`
   * (`GM_BUILD_FIELDS`): not part of a player's write.
   */
  approvals: z.record(z.string(), ApprovalDecisionSchema).default({}),
  /** The GM's note when a build is returned. */
  notes: LongText.nullable().default(null),
  /** The step the GM's note is pinned to. */
  returnedStep: BuildStepSchema.nullable().default(null),
  mode: BuildModeSchema.default('guided'),
  /** Where the walkthrough was when it was last saved. */
  step: BuildStepSchema.default(1),
  state: BuildStateSchema.default('draft'),
});
export type CharacterBuild = z.infer<typeof CharacterBuildSchema>;
export type CharacterBuildInput = z.input<typeof CharacterBuildSchema>;

// ---------------------------------------------------------------------------
// What the engine says about a build
// ---------------------------------------------------------------------------

/**
 * How bad a finding is (§4.2): `error` stops Submit, `warning` is worth a
 * look, `approval` is the book saying the GM decides.
 */
export const ISSUE_SEVERITIES = ['error', 'warning', 'approval'] as const;
export const IssueSeveritySchema = z.enum(ISSUE_SEVERITIES);
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;

/**
 * One validator finding. `code` is stable (approvals are keyed by it), the
 * message is our own short words, `ref` the page the rule is on, `path` the
 * build field it points at ("skills.active.3.points") when there is one.
 */
export const IssueSchema = z.object({
  code: z.string().min(1),
  severity: IssueSeveritySchema,
  step: BuildStepSchema,
  message: z.string(),
  ref: RefSchema,
  path: z.string().optional(),
});
export type Issue = z.infer<typeof IssueSchema>;

/** One pool on the rail. `remaining` goes negative when a pool is overspent. */
export const BudgetPoolSchema = z.object({
  available: z.number(),
  spent: z.number(),
  remaining: z.number(),
});
export type BudgetPool = z.infer<typeof BudgetPoolSchema>;

/** The pools every build has, in the order the rail lists them. */
export const BUDGET_POOLS = [
  'special',
  'attributes',
  'skills',
  'groups',
  'knowledge',
  'karma',
  'nuyen',
  'contactKarma',
  'powerPoints',
  'spells',
  'forms',
  'foci',
] as const;
export type BudgetPoolKey = (typeof BUDGET_POOLS)[number];

/**
 * Numbers the rail shows that are not pools. All optional: the rules engine
 * fills what it knows, and the derived sheet (initiative, limits, monitors)
 * comes from `deriveCharacter` on the compiled sheet instead.
 */
export const BudgetPreviewSchema = z.object({
  /** Essence after implants, grades applied. */
  essence: z.number().optional(),
  magic: z.number().int().optional(),
  resonance: z.number().int().optional(),
  /** Karma that would carry into play (capped), and what the cap would lose. */
  karmaCarried: z.number().int().optional(),
  karmaLost: z.number().int().optional(),
  /** Nuyen that would carry into play (capped), and what the cap would lose. */
  nuyenCarried: z.number().optional(),
  nuyenLost: z.number().optional(),
  /** The starting-nuyen roll the chosen lifestyle sets: `dice`D6 × `multiplier` (SR5 p.95). */
  startingNuyen: z.object({ dice: z.number().int().min(0), multiplier: z.number().int().min(0) }).optional(),
  /** The metatype's lifestyle multiplier (troll 2, dwarf 1.2). */
  lifestyleMultiplier: z.number().optional(),
});
export type BudgetPreview = z.infer<typeof BudgetPreviewSchema>;

/**
 * Every pool and what is left in it (§4.2 `budgets(build)`). The two quality
 * caps are pools too (25 each at experienced), optional so an engine that
 * reports them only once a quality exists is still conformant; so is Sum to
 * Ten's ten priority points (RF p.62), present only under that method.
 */
export const BudgetsSchema = z.object({
  pools: z.object({
    special: BudgetPoolSchema,
    attributes: BudgetPoolSchema,
    skills: BudgetPoolSchema,
    groups: BudgetPoolSchema,
    knowledge: BudgetPoolSchema,
    karma: BudgetPoolSchema,
    nuyen: BudgetPoolSchema,
    contactKarma: BudgetPoolSchema,
    powerPoints: BudgetPoolSchema,
    spells: BudgetPoolSchema,
    forms: BudgetPoolSchema,
    foci: BudgetPoolSchema,
    positiveQualities: BudgetPoolSchema.optional(),
    negativeQualities: BudgetPoolSchema.optional(),
    priorityPoints: BudgetPoolSchema.optional(),
  }),
  preview: BudgetPreviewSchema.optional(),
});
export type Budgets = z.infer<typeof BudgetsSchema>;

// ---------------------------------------------------------------------------
// Campaign chargen settings (`campaigns.settings.chargen`)
// ---------------------------------------------------------------------------

/**
 * The part of each creation level a GM's settings carry (SR5 p.64 for street
 * and prime; p.94–98 for experienced). Karma to start, Resources per row,
 * the conversion cap and contact multiplier are the rules engine's level
 * table — they are the level, not a house rule. Carry-over is 7 Karma and
 * 5,000¥ at every level (p.94, p.98).
 */
export const CHARGEN_LEVEL_PRESETS = {
  street: { maxAvailability: 10, maxDeviceRating: 4, karmaCarry: 7, nuyenCarry: 5000 },
  experienced: { maxAvailability: 12, maxDeviceRating: 6, karmaCarry: 7, nuyenCarry: 5000 },
  prime: { maxAvailability: 15, maxDeviceRating: 6, karmaCarry: 7, nuyenCarry: 5000 },
} as const satisfies Readonly<
  Record<CreationLevel, { maxAvailability: number; maxDeviceRating: number; karmaCarry: number; nuyenCarry: number }>
>;

const EXPERIENCED = CHARGEN_LEVEL_PRESETS.experienced;

/**
 * The most books a campaign's character creation may name. Far more than the
 * line has; a cap so the settings blob the roll path and the Fixer cache
 * cannot be grown without end.
 */
export const MAX_CHARGEN_BOOKS = 64;
const ChargenBooksSchema = z.array(z.string().min(1).max(12)).max(MAX_CHARGEN_BOOKS);

/**
 * How a campaign runs character creation (§8.3). Every field defaults, and
 * the defaults are the experienced level's; `chargenSettingsForLevel` gives
 * another level's. Players read this through its own member route — they
 * cannot read `campaigns.settings` (§8.2).
 */
export const ChargenSettingsSchema = z.object({
  level: CreationLevelSchema.default('experienced'),
  table: PriorityTableSchema.default('sr5'),
  maxAvailability: NonNegInt.default(EXPERIENCED.maxAvailability),
  maxDeviceRating: NonNegInt.default(EXPERIENCED.maxDeviceRating),
  karmaCarry: NonNegInt.default(EXPERIENCED.karmaCarry),
  nuyenCarry: NonNegInt.default(EXPERIENCED.nuyenCarry),
  /** Book codes the builder's catalogue draws on; empty = every shared book. */
  books: ChargenBooksSchema.default([]),
  allowSumToTen: z.boolean().default(false),
  allowMetavariants: z.boolean().default(false),
  /** The Fixer's `propose_build` lane, on top of AI being configured at all. */
  aiDrafts: z.boolean().default(false),
  /** Whether Uncouth/Uneducated also double priority skill points, not just Karma (§8.4). */
  uncouthDoublesPriorityPoints: z.boolean().default(false),
  /**
   * Read street's "maximum 26 Karma" and prime's "maximum 70" (p.64) as the
   * positive and negative quality caps at that level, replacing 25 (§8.4).
   * The book does not say what the maximum bounds; this is the house reading,
   * on by default, and the toggle is how a table reads it otherwise.
   */
  levelQualityCaps: z.boolean().default(true),
});
export type ChargenSettings = z.infer<typeof ChargenSettingsSchema>;
export type ChargenSettingsInput = z.input<typeof ChargenSettingsSchema>;

/**
 * A partial settings write. Field by field rather than `.partial()`, because
 * `.partial()` keeps each field's default and a save that changed one toggle
 * would silently reset the rest (see `AiSettingsWriteSchema`).
 */
export const ChargenSettingsWriteSchema = z.object({
  level: CreationLevelSchema.optional(),
  table: PriorityTableSchema.optional(),
  maxAvailability: NonNegInt.optional(),
  maxDeviceRating: NonNegInt.optional(),
  karmaCarry: NonNegInt.optional(),
  nuyenCarry: NonNegInt.optional(),
  books: ChargenBooksSchema.optional(),
  allowSumToTen: z.boolean().optional(),
  allowMetavariants: z.boolean().optional(),
  aiDrafts: z.boolean().optional(),
  uncouthDoublesPriorityPoints: z.boolean().optional(),
  levelQualityCaps: z.boolean().optional(),
});
export type ChargenSettingsWrite = z.infer<typeof ChargenSettingsWriteSchema>;

/**
 * Full settings for a level: that level's preset caps, then whatever the
 * overrides actually set (an `undefined` field is absent, not a blank).
 * The level argument wins over any `level` inside `overrides`.
 */
export function chargenSettingsForLevel(level: CreationLevel, overrides: ChargenSettingsWrite = {}): ChargenSettings {
  const defined = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  return ChargenSettingsSchema.parse({ ...CHARGEN_LEVEL_PRESETS[level], ...defined, level });
}

/**
 * A partial write applied to the settings a campaign already has — what
 * `PUT /api/campaigns/:id/chargen` stores. Every field the write leaves out
 * keeps its current value (books, toggles, a GM's own caps). Only a change
 * of `level` resets the four preset fields — Availability, device rating and
 * the two carry-overs — to the new level's preset, and even then a value the
 * same write sets wins. `chargenSettingsForLevel` is for a fresh campaign;
 * this is for an existing one.
 */
export function mergeChargenSettings(current: ChargenSettings, write: ChargenSettingsWrite): ChargenSettings {
  const defined = Object.fromEntries(Object.entries(write).filter(([, v]) => v !== undefined)) as ChargenSettingsWrite;
  const level = defined.level ?? current.level;
  const preset = level === current.level ? {} : CHARGEN_LEVEL_PRESETS[level];
  return ChargenSettingsSchema.parse({ ...current, ...preset, ...defined, level });
}

// ---------------------------------------------------------------------------
// Route shapes (§8.5)
// ---------------------------------------------------------------------------

/**
 * A `builds` row as the API returns it. `state` and `notes` are the row's
 * and authoritative; `build.state`, `build.notes`, `build.approvals` and
 * `build.returnedStep` are the server's copies of the row (see
 * `GM_BUILD_FIELDS`), never what a player last sent.
 */
export const BuildDtoSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  ownerUserId: z.string(),
  state: BuildStateSchema,
  build: CharacterBuildSchema,
  notes: z.string().nullable(),
  /** The character an approval created; null until then (and after that character is deleted). */
  characterId: z.string().nullable().default(null),
  /** ISO timestamps. `updatedAt` is also an autosave's precondition (`BuildPatchSchema.baseUpdatedAt`). */
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BuildDto = z.infer<typeof BuildDtoSchema>;

/**
 * A row of the list whose stored record no longer reads as a build — an
 * older draft after the record's schema tightened. It is listed by its
 * columns alone, flagged, so one such row never fails the whole list and the
 * owner or GM can still see it is there and delete it. Opening it answers
 * `build_invalid`.
 */
export const UnreadableBuildDtoSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  ownerUserId: z.string(),
  state: BuildStateSchema,
  notes: z.string().nullable(),
  characterId: z.string().nullable(),
  unreadable: z.literal(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UnreadableBuildDto = z.infer<typeof UnreadableBuildDtoSchema>;

/** `GET /api/campaigns/:id/builds` — the GM sees all, a player their own; an unreadable row comes as its stub. */
export const BuildListDtoSchema = z.object({
  campaignId: z.string(),
  builds: z.array(z.union([BuildDtoSchema, UnreadableBuildDtoSchema])),
});
export type BuildListDto = z.infer<typeof BuildListDtoSchema>;

/**
 * `GET /api/builds/:id/check` — the server's word on a build: its pools, its
 * issues, the compiled sheet, and the derived character when derivation ran
 * (typed `unknown` here; it is a `DerivedCharacter` when present).
 */
export const BuildCheckDtoSchema = z.object({
  budgets: BudgetsSchema,
  issues: z.array(IssueSchema),
  sheet: SheetV1Schema,
  derived: z.unknown().optional(),
});
export type BuildCheckDto = z.infer<typeof BuildCheckDtoSchema>;

/**
 * The fields of a build only the gamemaster (or the server) writes: the
 * per-item approvals, the return note and the step it is pinned to, and the
 * life-cycle state. A player owns the draft, so these must never ride in on
 * a player's write — otherwise a player could approve their own Exceptional
 * Attribute. The `builds` row is their one source of truth (`BuildDto.state`
 * and `.notes`); the server copies them onto `build` when it reads a row, so
 * `validate` sees the GM's decisions.
 */
export const GM_BUILD_FIELDS = ['approvals', 'notes', 'returnedStep', 'state'] as const;

/**
 * What an owner may write: the whole record minus `GM_BUILD_FIELDS`. zod
 * strips unknown keys, so a player's body that carries `approvals` or
 * `state` parses with them gone rather than failing.
 */
export const BuildWritableSchema = CharacterBuildSchema.omit({
  approvals: true,
  notes: true,
  returnedStep: true,
  state: true,
});
export type BuildWritable = z.infer<typeof BuildWritableSchema>;

/**
 * `POST /api/campaigns/:id/builds` — every field optional: an empty body is a
 * blank draft. `build` is a starting record (a Fixer draft); `alias` the
 * street name typed where the button sat; `conceptId` a concept card to
 * apply (`CONCEPT_IDS` in the rules; an unknown one is refused). `ownerUserId`
 * starts the build for someone else at the table — the GM's alone, which is
 * the server's rule to enforce, not this schema's.
 */
export const BuildCreateSchema = z.object({
  build: BuildWritableSchema.optional(),
  alias: z.string().max(200).optional(),
  conceptId: z.string().min(1).max(60).optional(),
  ownerUserId: z.string().uuid().optional(),
});
export type BuildCreate = z.infer<typeof BuildCreateSchema>;

/** An ISO timestamp as a row's `updatedAt` is written. */
const IsoTimestamp = z
  .string()
  .min(1)
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'an ISO timestamp');

/**
 * `PATCH /api/builds/:id` — the whole player-owned record. GM-owned fields
 * are not part of it (`BuildWritableSchema`); the server keeps the stored
 * row's.
 *
 * `baseUpdatedAt` is the optimistic precondition: the `updatedAt` of the row
 * this device's draft was built on. When it is given and the stored row has
 * moved on since (another device's autosave), the save is refused with
 * `409 build_stale` and the row as it now stands (`BuildDto`) in
 * `error.details`, so two open devices never silently overwrite each other.
 * Without it the save is last-write-wins, as it always was.
 */
export const BuildPatchSchema = z.object({
  build: BuildWritableSchema,
  baseUpdatedAt: IsoTimestamp.optional(),
});
export type BuildPatch = z.infer<typeof BuildPatchSchema>;

/** The error code a refused stale autosave carries (`BuildPatchSchema.baseUpdatedAt`). */
export const BUILD_STALE_CODE = 'build_stale';

/** `POST /api/builds/:id/return` — the GM's note, the step it belongs to, any decisions made so far (merged over the row's). */
export const BuildReturnSchema = z.object({
  notes: LongText.min(1),
  step: BuildStepSchema.nullable().optional(),
  approvals: ApprovalDecisionsSchema.optional(),
});
export type BuildReturn = z.infer<typeof BuildReturnSchema>;

/**
 * `POST /api/builds/:id/approve` — the GM's decisions on the `approval`
 * issues travel with the approval, since a submitted build is not PATCHable.
 */
export const BuildApproveSchema = z.object({
  approvals: ApprovalDecisionsSchema.optional(),
});
export type BuildApprove = z.infer<typeof BuildApproveSchema>;

/**
 * `POST /api/builds/:id/approvals` — the GM's decisions on `approval` issues,
 * merged over the row's; `null` takes a decision back. At least one, at most
 * `MAX_APPROVAL_DECISIONS` per call.
 */
export const BuildApprovalsSchema = z.object({
  approvals: z
    .record(ApprovalCodeSchema, ApprovalDecisionSchema.nullable())
    .refine((r) => Object.keys(r).length > 0, 'at least one decision')
    .refine((r) => Object.keys(r).length <= MAX_APPROVAL_DECISIONS, `at most ${MAX_APPROVAL_DECISIONS} decisions at once`),
});
export type BuildApprovals = z.infer<typeof BuildApprovalsSchema>;

/**
 * `POST /api/builds/:id/approve` answers `201` with this: the approved row,
 * the character it created (its full DTO; only the id is pinned here), its
 * first revision, what carried into play, and the starting-nuyen roll made on
 * the record — `sum` is the dice total, `nuyen` is `sum × multiplier`.
 */
export const BuildApproveResultSchema = z.object({
  build: BuildDtoSchema,
  character: z.looseObject({ id: z.string() }),
  revision: z.number().int(),
  opening: z.looseObject({ karma: z.number(), nuyenCarry: z.number() }),
  roll: z.object({
    id: z.string(),
    faces: z.array(z.number().int()),
    sum: z.number().int(),
    multiplier: z.number(),
    nuyen: z.number(),
  }),
});
export type BuildApproveResult = z.infer<typeof BuildApproveResultSchema>;
