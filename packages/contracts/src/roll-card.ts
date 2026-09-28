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
 * The guided roll card: one action, laid out the way the book would have you
 * work it out at the table — what kind of action it is and what it costs, the
 * dice pool one line at a time with the page each buff and debuff comes from,
 * the limit, and the situational modifiers the roller may tick. Guided, not
 * automated (the design's pillar 3): the card does the arithmetic and shows
 * its work (Principle 3), and a person decides what applies.
 *
 * ## Who builds it
 *
 * The server, for the actor, from the sheet or the NPC's derived pools and the
 * fight's own scene (DESIGN.md §10.1: the client never tells the server what
 * its dice pool is). The client sends a `CardRequest` — which action, which
 * weapon, which target, what is ticked — and gets a `RollCard` back; it sends
 * the same request again with a `settle` to roll (`CardSettleRequest`).
 *
 * ## The two stages
 *
 * A GM's card opens on `modifiers`: the GM ticks what applies BEFORE seeing
 * the dice count, so the count cannot lean on the choice (the GM's decision of
 * 2026-09-28). The card still carries the total; the client withholds it until
 * the GM presses Done and asks again with `stage: 'dice'`. A player's card
 * opens on `dice`.
 *
 * ## Offers
 *
 * Every situational modifier the action may take is an offer, in the rules
 * catalogue's order (@safehouse/rules combat/situational.ts). Three kinds
 * arrive differently:
 *
 * - the engine's own lines (`auto`: wounds, the environment, recoil, Full
 *   Defense's Willpower, previous defenses) arrive ticked and worked out;
 * - the facts of an incoming attack (`declaredBy`: the fire mode's defense
 *   penalty, a shotgun's spread, the attack's AP) arrive ticked and labelled
 *   with whoever declared them;
 * - everything else arrives unticked — a suggestion (`suggestedBy`, e.g. the
 *   line-of-sight tool's cover call) is shown as a hint, never ticked for the
 *   GM.
 *
 * The pool's lines are the base lines plus every offer that is on, so striking
 * an offer and asking again is how the roller changes the pool.
 *
 * Catalogue data only — ids, numbers and page refs, labels in our own words —
 * never the book's text (DESIGN.md §14).
 */

const NonNegInt = z.number().int().min(0);

// ---------------------------------------------------------------------------
// Vocabulary shared with the rules catalogue (which imports it from here)
// ---------------------------------------------------------------------------

/**
 * Free, Simple, Complex, Interrupt — the Combat Actions table (p.162) — and
 * `none` for a reaction that is not an action at all: the free defense test,
 * damage resistance, a Perception Test the GM calls for. A Phase is two Simple
 * or one Complex, plus one Free (p.163); an Interrupt is paid for in
 * Initiative Score, at once, out of turn (p.167).
 */
export const ActionTypeSchema = z.enum(['free', 'simple', 'complex', 'interrupt', 'none']);
export type ActionType = z.infer<typeof ActionTypeSchema>;

/** An action's part in an attack exchange: it opens one, answers one, or resists its damage. */
export const ExchangeRoleSchema = z.enum(['opens', 'defends', 'soaks']);
export type ExchangeRole = z.infer<typeof ExchangeRoleSchema>;

/** The lines the engine works out itself rather than leaving to a tick. */
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

/**
 * Alternatives: ticking one clears the rest of its group — partial or good
 * cover, one choke setting, a running or a sprinting target.
 */
export const ModifierGroupSchema = z.enum([
  'smartgun',
  'targetMoving',
  'cover',
  'spread',
  'reach',
  'distance',
]);
export type ModifierGroup = z.infer<typeof ModifierGroupSchema>;

/**
 * What a per-unit modifier counts: Take Aim actions, points of net Reach,
 * defenses since the defender last acted, spells sustained, a sense
 * enhancement's rating.
 */
export const PerUnitSchema = z.enum(['aim', 'reach', 'defense', 'spell', 'rating']);
export type PerUnit = z.infer<typeof PerUnitSchema>;

// ---------------------------------------------------------------------------
// Who, and what
// ---------------------------------------------------------------------------

/**
 * Whose card it is, or whom it aims at: a character (a runner's sheet), a
 * tracker row (an NPC or a runner in a fight), or a map token not in any fight
 * (an NPC template's seeded body, the same one staging would give it).
 */
export const CardActorKindSchema = z.enum(['character', 'combatant', 'token']);
export type CardActorKind = z.infer<typeof CardActorKindSchema>;

/** An actor as a request names it. */
export const CardActorRefSchema = z.object({
  kind: CardActorKindSchema,
  id: z.string().min(1),
});
export type CardActorRef = z.infer<typeof CardActorRefSchema>;

/** An actor as a card shows it. */
export const CardActorSchema = CardActorRefSchema.extend({
  name: z.string(),
});
export type CardActor = z.infer<typeof CardActorSchema>;

/**
 * The action, as the card's header shows it: its type chip, its page, and
 * what it costs or what part it plays in an exchange. Straight from the rules
 * catalogue (`COMBAT_ACTIONS`).
 */
export const CardActionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: ActionTypeSchema,
  ref: RefSchema,
  /** Other pages worth a look: the section behind it, the table its numbers sit in. */
  refs: z.array(RefSchema).optional(),
  /** Initiative Score an Interrupt costs (p.167-168). */
  initCost: z.number().int().min(1).optional(),
  exchange: ExchangeRoleSchema.optional(),
  /** For an attack: the kind of attack the defender will be answering. */
  attack: AttackKindSchema.optional(),
  /** For an Interrupt defense: one test (Dodge, Block, Parry) or the rest of the Combat Turn (Full Defense). */
  lasts: z.enum(['test', 'turn']).optional(),
});
export type CardAction = z.infer<typeof CardActionSchema>;

/**
 * The kind of test (p.44-47): a Success Test counts hits, a Threshold Test
 * needs a number of them (a Perception Test's 1-4, p.136), an Opposed Test is
 * measured against someone else's roll — `against` says whose, in words
 * ("Door heavy's defense", "Ari's Sneaking").
 */
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

/**
 * How a line reads at a glance: `base` is what the pool is built from (an
 * attribute, a skill, the armor), `buff` and `debuff` are modifiers that add
 * or take dice, and `neutral` is a modifier that is on the card but comes to 0
 * this time (no wounds yet, recoil fully compensated) — shown, so the roller
 * can see it was counted.
 */
export const CardLineToneSchema = z.enum(['base', 'buff', 'debuff', 'neutral']);
export type CardLineTone = z.infer<typeof CardLineToneSchema>;

/**
 * One line of the card's pool or limit: a receipt line (label, value, source,
 * its page, the environment rows it was read from) with its tone, and the
 * offer it came from when it came from one — so the card can put the strike
 * switch beside the line it strikes.
 */
export const CardLineSchema = ProvenanceEntrySchema.extend({
  tone: CardLineToneSchema,
  offerId: z.string().optional(),
});
export type CardLine = z.infer<typeof CardLineSchema>;

/**
 * The dice pool: the total and its receipt. The total is never below 0 — a
 * pool the modifiers take below nothing rolls nothing.
 */
export const CardPoolSchema = z.object({
  total: NonNegInt,
  lines: z.array(CardLineSchema),
});
export type CardPool = z.infer<typeof CardPoolSchema>;

/**
 * The limit on the hits (p.47): its kind, its value, the page, and its own
 * receipt — the weapon's Accuracy and a Take Aim's +1, or the Physical limit
 * a Dodge brings (p.188).
 */
export const CardLimitSchema = z.object({
  kind: LimitKindSchema,
  value: NonNegInt,
  ref: RefSchema,
  lines: z.array(CardLineSchema),
});
export type CardLimit = z.infer<typeof CardLimitSchema>;

/**
 * Where a suggestion came from, when an offer arrives with a hint beside it:
 * the line-of-sight tool's cover call, the declared attack, a status effect on
 * the row (prone), or the turn's own bookkeeping (defenses since the row last
 * acted, a Delayed Action cutting in).
 */
export const CardSuggestionSchema = z.enum(['los', 'attack', 'status', 'turn']);
export type CardSuggestion = z.infer<typeof CardSuggestionSchema>;

/**
 * A per-unit offer's stepper: `per` dice (or Accuracy) for each `unit`,
 * `count` of them now, never more than `max` when the book sets one (Take Aim
 * tops out at half the character's Willpower, rounded up, p.166). The roller
 * changes `count` through the request's `steppers`, keyed by the offer's id;
 * the engine fills it in itself for the ones it counts (previous defenses,
 * spells sustained).
 */
export const CardStepperSchema = z.object({
  per: z.number().int(),
  unit: PerUnitSchema,
  count: NonNegInt,
  max: NonNegInt.optional(),
});
export type CardStepper = z.infer<typeof CardStepperSchema>;

/**
 * One situational modifier the roller may tick, with the page that explains
 * it. `value` is what it is worth as things stand — the engine's number for an
 * `auto` line, `per` × `count` for a per-unit one — so the card can show it
 * before it is ticked.
 */
export const CardOfferSchema = z.object({
  /** The catalogue id (`cover_partial`, `aim_dice`, `environment`, …). */
  id: z.string().min(1),
  label: z.string(),
  value: z.number().int(),
  stepper: CardStepperSchema.optional(),
  /** It changes the limit rather than the pool (Take Aim's +1 Accuracy). */
  target: z.literal('limit').optional(),
  ref: RefSchema,
  on: z.boolean(),
  group: ModifierGroupSchema.optional(),
  auto: ModifierAutoSchema.optional(),
  /** A fact of the incoming attack, and who declared it. */
  declaredBy: DeclaredBySchema.optional(),
  suggestedBy: CardSuggestionSchema.optional(),
  /** How the engine got its number: 'dim light −3, medium range −1 → worst row −3'. */
  note: z.string().optional(),
  /** Ticking it means there is no defense test at all (the defender is unaware, p.189). */
  noDefense: z.literal(true).optional(),
});
export type CardOffer = z.infer<typeof CardOfferSchema>;

/**
 * What the action costs besides the Phase it uses: Initiative Score for an
 * Interrupt, shown as the score it leaves ("14 → 9", p.168), and the rounds a
 * firing action spends (p.180).
 */
export const CardCostSchema = z.object({
  initScore: z.object({ from: z.number().int(), to: z.number().int() }).optional(),
  rounds: z.number().int().min(1).optional(),
});
export type CardCost = z.infer<typeof CardCostSchema>;

/**
 * How the card may be settled: the site's dice ("Roll 9d6 here"), the table's
 * ("I rolled: hits + glitch"), both, or neither for an action with no test.
 */
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
  /** Null for an action with no test (Drop Prone, Take Cover). */
  test: CardTestSchema.nullable(),
  stage: CardStageSchema,
  /** Null for an action with no test. */
  pool: CardPoolSchema.nullable(),
  /** Null when the test has no limit (the defense test, soak, attribute-only tests). */
  limit: CardLimitSchema.nullable(),
  offers: z.array(CardOfferSchema),
  /** For an attack: whom it is aimed at. */
  target: CardActorSchema.optional(),
  /**
   * For an attack: what the defender will be told — DV and AP from the weapon,
   * the fire mode's defense penalty — filled in for the attacker to check and
   * change before the dice.
   */
  declare: ExchangeDeclarationSchema.optional(),
  /** For a defense or a soak: the attack it answers, with the attacker's declared facts. */
  context: z.object({ exchange: ExchangeSchema }).optional(),
  cost: CardCostSchema.optional(),
  /** Who sees the roll unless the roller says otherwise: an NPC's roll is the GM's. */
  defaultVisibility: VisibilitySchema,
  settle: CardSettleModesSchema,
});
export type RollCard = z.infer<typeof RollCardSchema>;

// ---------------------------------------------------------------------------
// Asking for a card, and settling it
// ---------------------------------------------------------------------------

/** A line the GM adds by hand — a call the catalogue has no entry for. It has no page. */
export const CardExtraSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.number().int(),
});
export type CardExtra = z.infer<typeof CardExtraSchema>;

/**
 * The attacker's changes to the pre-filled declaration: only what they touched.
 * Written out rather than derived from the declaration so that nothing here
 * has a default — a field left out means "as the weapon says", never 0.
 */
export const DeclarationEditSchema = z.object({
  dv: DeclaredDvSchema.optional(),
  ap: z.number().int().optional(),
  defenseModifier: z.number().int().max(0).optional(),
  extras: z.array(DeclaredExtraSchema).optional(),
  note: z.string().max(500).optional(),
});
export type DeclarationEdit = z.infer<typeof DeclarationEditSchema>;

/**
 * Build (or rebuild) a card. Everything the roller has chosen so far rides
 * along, and the server answers with the whole card again.
 */
export const CardRequestSchema = z.object({
  actor: CardActorRefSchema,
  /** The catalogue action (`fire_sa`, `dodge`, `observe_in_detail`, …). */
  actionId: z.string().min(1),
  /** The weapon's name on the sheet, for an action that fires or swings one. */
  weapon: z.string().min(1).optional(),
  target: CardActorRefSchema.optional(),
  /** A measured distance in meters, when the ruler handed one over; else the tokens' own. */
  distanceM: z.number().min(0).optional(),
  /**
   * Exactly the offers that are on, by id — the engine's own lines included,
   * so striking one is leaving it out. Absent means the card's defaults.
   */
  offersOn: z.array(z.string()).optional(),
  /** Per-unit counts by offer id: aims taken, points of reach, spells sustained. */
  steppers: z.record(z.string(), NonNegInt).optional(),
  extras: z.array(CardExtraSchema).max(12).optional(),
  /** The exchange a defense or a soak answers. */
  exchangeId: z.string().optional(),
  /** For a threshold test the GM sets (a Perception Test's 1-4, p.136). */
  threshold: z.number().int().min(1).optional(),
  declare: DeclarationEditSchema.optional(),
  stage: CardStageSchema.optional(),
});
export type CardRequest = z.infer<typeof CardRequestSchema>;
export type CardRequestInput = z.input<typeof CardRequestSchema>;

/**
 * Settle a card: the same choices, plus how the dice were rolled — `'app'` for
 * the site's dice, or the table's hits and glitch — any Edge spent, and who
 * sees the result.
 */
export const CardSettleRequestSchema = CardRequestSchema.extend({
  settle: z.union([z.literal('app'), TableResultSchema]),
  edge: EdgeActionSchema.nullable().optional(),
  visibility: VisibilitySchema.optional(),
});
export type CardSettleRequest = z.infer<typeof CardSettleRequestSchema>;
export type CardSettleRequestInput = z.input<typeof CardSettleRequestSchema>;
