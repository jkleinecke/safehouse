import { z } from 'zod';
import { ModifierSchema } from './modifier.js';
import { VisibilitySchema } from './common.js';
import { EdgeStateSchema } from './sheet.js';

const NonNegInt = z.number().int().min(0);

/** One condition monitor: size + filled boxes. */
export const MonitorStateSchema = z.object({
  max: NonNegInt,
  filled: NonNegInt.default(0),
});
export type MonitorState = z.infer<typeof MonitorStateSchema>;

export const CombatantMonitorsSchema = z.object({
  physical: MonitorStateSchema,
  stun: MonitorStateSchema,
  overflow: MonitorStateSchema,
});
export type CombatantMonitors = z.infer<typeof CombatantMonitorsSchema>;

export const EffectDurationSchema = z.object({
  kind: z.enum(['end_of_turn', 'while_sustained', 'passes', 'manual']).default('manual'),
  /** For kind 'passes': how many passes remain. */
  value: z.number().int().optional(),
});
export type EffectDuration = z.infer<typeof EffectDurationSchema>;

/** A status effect attached to a combatant (FR4.7): prone, blinded, custom… */
export const StatusEffectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  mods: z.array(ModifierSchema).default([]),
  duration: EffectDurationSchema.default({ kind: 'manual' }),
  note: z.string().optional(),
});
export type StatusEffect = z.infer<typeof StatusEffectSchema>;

/** Initiative variant per FR4.2. */
export const InitKindSchema = z.enum(['physical', 'astral', 'matrix_ar', 'vr_cold', 'vr_hot']);
export type InitKind = z.infer<typeof InitKindSchema>;

export const GruntMemberSchema = z.object({
  label: z.string(),
  /** Filled physical boxes for this member's tick row. */
  filled: NonNegInt.default(0),
  down: z.boolean().default(false),
});
export type GruntMember = z.infer<typeof GruntMemberSchema>;

/** Grunt-group state on a single tracker row (FR4.6). */
export const GruntStateSchema = z.object({
  size: z.number().int().min(1),
  professionalRating: NonNegInt,
  groupEdge: NonNegInt.default(0),
  members: z.array(GruntMemberSchema).default([]),
});
export type GruntState = z.infer<typeof GruntStateSchema>;

export const CombatantSourceSchema = z.enum([
  'character',
  'npc_template',
  'generated',
  'grunt_group',
  'manual',
]);
export type CombatantSource = z.infer<typeof CombatantSourceSchema>;

/** A combatant row (DESIGN.md §9.2 `combatants`). */
export const CombatantSchema = z.object({
  id: z.string(),
  encounterId: z.string(),
  tokenId: z.string().nullable().optional(),
  source: CombatantSourceSchema.default('manual'),
  sourceId: z.string().nullable().optional(),
  name: z.string().min(1),
  /** Initiative attribute base (e.g. REA + INT), before dice. */
  initBase: z.number().int().default(0),
  /** Number of initiative d6 (1–5 physical; astral 2; VR 3/4). */
  initDice: z.number().int().min(0).max(5).default(1),
  /** Current Initiative Score this turn (drops by 10 per pass, interrupts, …). */
  initScore: z.number().int().default(0),
  initKind: InitKindSchema.default('physical'),
  monitors: CombatantMonitorsSchema,
  effects: z.array(StatusEffectSchema).default([]),
  visibility: VisibilitySchema.default('public'),
  actedThisPass: z.boolean().default(false),
  /**
   * Holding a Delayed Action (SR5 p.161): the row keeps its score and its
   * place, and "Next" steps over it until the GM says it acts ("Act now"),
   * on whatever score the order has reached. It carries into later passes of
   * the same Combat Turn, and the next turn clears it.
   */
  delayed: z.boolean().optional(),
  /**
   * Spent Edge to Seize the Initiative this Combat Turn (SR5 p.160-161): the
   * row goes before everyone who did not, its score untouched. The next
   * Combat Turn clears it.
   */
  seized: z.boolean().optional(),
  edge: EdgeStateSchema.optional(),
  grunt: GruntStateSchema.optional(),
  /** Copilot state: quick-roll rack config, morale flags (FR10.7–10.9). */
  copilot: z.record(z.string(), z.unknown()).optional(),
});
export type Combatant = z.infer<typeof CombatantSchema>;
export type CombatantInput = z.input<typeof CombatantSchema>;

export const EncounterStateSchema = z.enum(['prep', 'live', 'done']);
export type EncounterState = z.infer<typeof EncounterStateSchema>;

/** An encounter (DESIGN.md §9.2 `encounters`). */
export const EncounterSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  sceneId: z.string().nullable().optional(),
  name: z.string().min(1),
  state: EncounterStateSchema.default('prep'),
  /** Combat turn number (re-rolls initiative each turn, FR4.3). */
  turn: z.number().int().min(0).default(0),
  /** Initiative pass within the turn (scores −10 per pass). */
  pass: z.number().int().min(0).default(0),
  activeCombatantId: z.string().nullable().optional(),
  /**
   * The GM's own arrangement of the order for this Combat Turn: combatant ids,
   * first to act first. Null (or absent) means the book's order — Initiative
   * Score, highest first, ties broken by Edge, Reaction, Intuition (p.159).
   *
   * Moving a row changes its PLACE and nothing else (the GM's decision of
   * 2026-09-28): the score, and so the number of passes it acts in (p.159),
   * stay what the dice said, the way Seize the Initiative and a Delayed Action
   * move someone without rewriting their score (p.160-161). A row the list
   * does not name — a late joiner — is slotted in by score. "Sort by score"
   * sets it back to null, and a new Combat Turn clears it.
   *
   * Optional rather than defaulted because the server only sends it once the
   * fight has one, and older frames and cached lists never had it.
   */
  manualOrder: z.array(z.string()).nullable().optional(),
  /**
   * The table rolls initiative with its own dice: each row takes its dice
   * total (the tracker adds the base and the wounds), and a new Combat Turn —
   * "Next" past the last pass included — starts without the site rolling for
   * everyone. Stored on the fight rather than on one device, so the GM's
   * laptop, the new-turn path and the players' phones agree; absent means the
   * site rolls.
   */
  handRolls: z.boolean().optional(),
  /**
   * The acting order as the server works it out — combatant ids, first to act
   * first — for the viewer it was sent to. Every `encounter.updated` frame and
   * `GET /api/encounters/:id` carry it (at the top level of the payload), and
   * it is the one order a tracker, a phone or the TV should draw: the manual
   * order, seizes, and the ERIC tie-break all live in it, and a client that
   * sorts by score on its own will disagree with the table. Derived, never
   * stored; absent when the source did not carry it.
   */
  turnOrder: z.array(z.string()).optional(),
  /** Player/TV views: someone this viewer may not see is acting ("GM's turn"). */
  gmTurn: z.boolean().optional(),
  /** Present when the API returns the composed view. */
  combatants: z.array(CombatantSchema).optional(),
});
export type Encounter = z.infer<typeof EncounterSchema>;
export type EncounterInput = z.input<typeof EncounterSchema>;
