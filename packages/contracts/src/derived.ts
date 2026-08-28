import { z } from 'zod';

/** One line of a derived value's receipt (Principle 3: show your work). */
export const ProvenanceEntrySchema = z.object({
  label: z.string(),
  value: z.number(),
  source: z.string().optional(),
});
export type ProvenanceEntry = z.infer<typeof ProvenanceEntrySchema>;

/** A computed number carrying its provenance. */
export const DerivedValueSchema = z.object({
  value: z.number(),
  breakdown: z.array(ProvenanceEntrySchema),
});
export type DerivedValue = z.infer<typeof DerivedValueSchema>;

export const LimitKindSchema = z.enum(['physical', 'mental', 'social', 'accuracy', 'force']);
export type LimitKind = z.infer<typeof LimitKindSchema>;

export const LimitRefSchema = z.object({
  kind: LimitKindSchema,
  value: z.number().int(),
});
export type LimitRef = z.infer<typeof LimitRefSchema>;

/** A dice pool with its receipt; the unit the sheet UI rolls from. */
export const PoolBreakdownSchema = z.object({
  total: z.number(),
  breakdown: z.array(ProvenanceEntrySchema),
  limit: LimitRefSchema.optional(),
});
export type PoolBreakdown = z.infer<typeof PoolBreakdownSchema>;

/** One initiative variant: base score + number of d6 (FR4.2). */
export const InitiativeLineSchema = z.object({
  base: DerivedValueSchema,
  dice: DerivedValueSchema,
});
export type InitiativeLine = z.infer<typeof InitiativeLineSchema>;

/** Output of the rules engine's deriveCharacter (§7.2, BUILD_CONVENTIONS). */
export const DerivedCharacterSchema = z.object({
  attributes: z.record(z.string(), DerivedValueSchema),
  limits: z.object({
    physical: DerivedValueSchema,
    mental: DerivedValueSchema,
    social: DerivedValueSchema,
  }),
  /** Monitor SIZES (boxes), not fill state. */
  monitors: z.object({
    physical: DerivedValueSchema,
    stun: DerivedValueSchema,
    overflow: DerivedValueSchema,
  }),
  initiative: z.object({
    physical: InitiativeLineSchema,
    astral: InitiativeLineSchema,
    matrixAR: InitiativeLineSchema,
    vrCold: InitiativeLineSchema,
    vrHot: InitiativeLineSchema,
  }),
  /** Meters per combat turn: walk AGI×2 / run AGI×4 (FR9.8). */
  movement: z.object({
    walk: DerivedValueSchema,
    run: DerivedValueSchema,
  }),
  /** Keyed pools, e.g. 'skill.perception', 'weapon.<name>', 'defense', 'soak'. */
  pools: z.record(z.string(), PoolBreakdownSchema),
  /** Current wound modifier (negative), when wounds were supplied to derivation. */
  woundModifier: DerivedValueSchema.optional(),
});
export type DerivedCharacter = z.infer<typeof DerivedCharacterSchema>;
