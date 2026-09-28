import { z } from 'zod';
import { RefSchema, VisibilitySchema } from './common.js';
import { LimitKindSchema, ProvenanceEntrySchema } from './derived.js';
import { EdgeActionSchema, TableResultSchema } from './roll.js';
import {
  AttackKindSchema,
  DeclaredBySchema,
  DeclaredDvSchema,
  DeclaredExtraSchema,
  ExchangeDeclarationSchema,
  ExchangeSchema,
} from './exchange.js';

/**
 * The guided roll card: one action, its cost, the pool line by line with the
 * page each line comes from, the limit, and the modifiers the roller may tick.
 * The server builds it (DESIGN.md §10.1); the client sends a `CardRequest` and
 * the same request plus `settle` to roll.
 *
 * A GM's card opens on `modifiers` so the ticks come before the dice count
 * (GM decision, 2026-09-28); a player's opens on `dice`.
 *
 * Offers: engine lines (`auto`) arrive ticked, the attack's declared facts
 * (`declaredBy`) arrive ticked and labelled, the rest arrive unticked; a
 * `suggestedBy` hint never ticks itself. Labels are ours, never book text (§14).
 */

const NonNegInt = z.number().int().min(0);

// ---------------------------------------------------------------------------
// Vocabulary shared with the rules catalogue
// ---------------------------------------------------------------------------

/** The Combat Actions table (p.162); `none` for a test that is no action (defense, soak). */
export const ActionTypeSchema = z.enum(['free', 'simple', 'complex', 'interrupt', 'none']);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ExchangeRoleSchema = z.enum(['opens', 'defends', 'soaks']);
export type ExchangeRole = z.infer<typeof ExchangeRoleSchema>;

/** Lines the engine works out itself. */
export const ModifierAutoSchema = z.enum([
  'wounds',
  'environment',
  'recoil',
  'fireMode',
  'fullDefense',
  'previousDefenses',
  'ap',
  'sustaining',
]);
export type ModifierAuto = z.infer<typeof ModifierAutoSchema>;

/** Ticking one clears the rest of its group. */
export const ModifierGroupSchema = z.enum([
  'smartgun',
  'targetMoving',
  'cover',
  'spread',
  'reach',
  'distance',
]);
export type ModifierGroup = z.infer<typeof ModifierGroupSchema>;

export const PerUnitSchema = z.enum(['aim', 'reach', 'defense', 'spell', 'rating']);
export type PerUnit = z.infer<typeof PerUnitSchema>;

// ---------------------------------------------------------------------------
// Who, and what
// ---------------------------------------------------------------------------

/** A runner's sheet, a tracker row, or a map token outside any fight. */
export const CardActorKindSchema = z.enum(['character', 'combatant', 'token']);
export type CardActorKind = z.infer<typeof CardActorKindSchema>;

export const CardActorRefSchema = z.object({
  kind: CardActorKindSchema,
  id: z.string().min(1),
});
export type CardActorRef = z.infer<typeof CardActorRefSchema>;

export const CardActorSchema = CardActorRefSchema.extend({
  name: z.string(),
});
export type CardActor = z.infer<typeof CardActorSchema>;

/** The card's header, straight from `COMBAT_ACTIONS`. */
export const CardActionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: ActionTypeSchema,
  ref: RefSchema,
  refs: z.array(RefSchema).optional(),
  /** Initiative Score an Interrupt costs (p.167-168). */
  initCost: z.number().int().min(1).optional(),
  exchange: ExchangeRoleSchema.optional(),
  attack: AttackKindSchema.optional(),
  /** Dodge, Block, Parry last one test; Full Defense the Combat Turn. */
  lasts: z.enum(['test', 'turn']).optional(),
});
export type CardAction = z.infer<typeof CardActionSchema>;

/** Success, threshold or opposed (p.44-47); `against` names the other side in words. */
export const CardTestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('success'), ref: RefSchema }),
  z.object({ kind: z.literal('threshold'), threshold: z.number().int().min(1), ref: RefSchema }),
  z.object({ kind: z.literal('opposed'), against: z.string().optional(), ref: RefSchema }),
]);
export type CardTest = z.infer<typeof CardTestSchema>;

export const CardStageSchema = z.enum(['modifiers', 'dice']);
export type CardStage = z.infer<typeof CardStageSchema>;

// ---------------------------------------------------------------------------
// Lines and offers
// ---------------------------------------------------------------------------

/** `neutral`: counted, but worth 0 this time (no wounds, recoil compensated). */
export const CardLineToneSchema = z.enum(['base', 'buff', 'debuff', 'neutral']);
export type CardLineTone = z.infer<typeof CardLineToneSchema>;

/** A receipt line, with the offer it came from so the strike switch sits beside it. */
export const CardLineSchema = ProvenanceEntrySchema.extend({
  tone: CardLineToneSchema,
  offerId: z.string().optional(),
});
export type CardLine = z.infer<typeof CardLineSchema>;

/** Never below 0. */
export const CardPoolSchema = z.object({
  total: NonNegInt,
  lines: z.array(CardLineSchema),
});
export type CardPool = z.infer<typeof CardPoolSchema>;

/** The limit (p.47) and its own receipt. */
export const CardLimitSchema = z.object({
  kind: LimitKindSchema,
  value: NonNegInt,
  ref: RefSchema,
  lines: z.array(CardLineSchema),
});
export type CardLimit = z.infer<typeof CardLimitSchema>;

/** Where a hint came from: line of sight, the attack, a status, the turn's bookkeeping. */
export const CardSuggestionSchema = z.enum(['los', 'attack', 'status', 'turn']);
export type CardSuggestion = z.infer<typeof CardSuggestionSchema>;

/** `per` for each `unit`, `count` now, capped at `max` when the book sets one (Take Aim, p.166). */
export const CardStepperSchema = z.object({
  per: z.number().int(),
  unit: PerUnitSchema,
  count: NonNegInt,
  max: NonNegInt.optional(),
});
export type CardStepper = z.infer<typeof CardStepperSchema>;

/** One modifier the roller may tick; `value` is its worth as things stand. */
export const CardOfferSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  value: z.number().int(),
  stepper: CardStepperSchema.optional(),
  /** Changes the limit, not the pool. */
  target: z.literal('limit').optional(),
  ref: RefSchema,
  on: z.boolean(),
  group: ModifierGroupSchema.optional(),
  auto: ModifierAutoSchema.optional(),
  declaredBy: DeclaredBySchema.optional(),
  suggestedBy: CardSuggestionSchema.optional(),
  /** How the engine got its number. */
  note: z.string().optional(),
  /** Unaware: no defense test at all (p.189). */
  noDefense: z.literal(true).optional(),
});
export type CardOffer = z.infer<typeof CardOfferSchema>;

/** An Interrupt's score cost ("14 → 9", p.168) and the rounds fired (p.180). */
export const CardCostSchema = z.object({
  initScore: z.object({ from: z.number().int(), to: z.number().int() }).optional(),
  rounds: z.number().int().min(1).optional(),
});
export type CardCost = z.infer<typeof CardCostSchema>;

/** Site dice, table dice, or neither for an action with no test. */
export const CardSettleModesSchema = z.object({
  app: z.boolean(),
  table: z.boolean(),
});
export type CardSettleModes = z.infer<typeof CardSettleModesSchema>;

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export const RollCardSchema = z.object({
  actor: CardActorSchema,
  action: CardActionSchema,
  /** Null for an action with no test. */
  test: CardTestSchema.nullable(),
  stage: CardStageSchema,
  pool: CardPoolSchema.nullable(),
  limit: CardLimitSchema.nullable(),
  offers: z.array(CardOfferSchema),
  target: CardActorSchema.optional(),
  /** An attack's facts for the defender, editable before the dice. */
  declare: ExchangeDeclarationSchema.optional(),
  /** GM only: the attack a defense or soak answers. */
  context: z.object({ exchange: ExchangeSchema }).optional(),
  cost: CardCostSchema.optional(),
  /** An NPC's roll is the GM's. */
  defaultVisibility: VisibilitySchema,
  settle: CardSettleModesSchema,
});
export type RollCard = z.infer<typeof RollCardSchema>;

// ---------------------------------------------------------------------------
// Asking for a card, and settling it
// ---------------------------------------------------------------------------

/** A GM's own line, for a call the catalogue lacks. */
export const CardExtraSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.number().int(),
});
export type CardExtra = z.infer<typeof CardExtraSchema>;

/** Only what the attacker changed; left out means "as the weapon says". */
export const DeclarationEditSchema = z.object({
  dv: DeclaredDvSchema.optional(),
  ap: z.number().int().optional(),
  defenseModifier: z.number().int().max(0).optional(),
  extras: z.array(DeclaredExtraSchema).optional(),
  note: z.string().max(500).optional(),
});
export type DeclarationEdit = z.infer<typeof DeclarationEditSchema>;

export const CardRequestSchema = z.object({
  actor: CardActorRefSchema,
  actionId: z.string().min(1),
  /** The weapon's name on the sheet. */
  weapon: z.string().min(1).optional(),
  /** The skill a Use Skill rolls. */
  skill: z.string().min(1).optional(),
  target: CardActorRefSchema.optional(),
  /** The ruler's distance; else the tokens'. */
  distanceM: z.number().min(0).optional(),
  /** Exactly the offers that are on, engine lines included; absent means the defaults. */
  offersOn: z.array(z.string()).optional(),
  /** Per-unit counts by offer id. */
  steppers: z.record(z.string(), NonNegInt).optional(),
  extras: z.array(CardExtraSchema).max(12).optional(),
  exchangeId: z.string().optional(),
  /** A threshold the GM sets (Perception's 1-4, p.136). */
  threshold: z.number().int().min(1).optional(),
  declare: DeclarationEditSchema.optional(),
  stage: CardStageSchema.optional(),
});
export type CardRequest = z.infer<typeof CardRequestSchema>;
export type CardRequestInput = z.input<typeof CardRequestSchema>;

/** The same choices plus the dice: `'app'`, or the table's hits and glitch. */
export const CardSettleRequestSchema = CardRequestSchema.extend({
  settle: z.union([z.literal('app'), TableResultSchema]),
  edge: EdgeActionSchema.nullable().optional(),
  visibility: VisibilitySchema.optional(),
  /** GM only: who rolled when the GM enters it for them ("Ari, at the table"). */
  forActorBy: DeclaredBySchema.optional(),
});
export type CardSettleRequest = z.infer<typeof CardSettleRequestSchema>;
export type CardSettleRequestInput = z.input<typeof CardSettleRequestSchema>;
