import { z } from 'zod';
import { VisibilitySchema } from './common.js';
import { LimitRefSchema, ProvenanceEntrySchema } from './derived.js';

export const RollKindSchema = z.enum(['simple', 'opposed', 'threshold', 'extended', 'teamwork']);
export type RollKind = z.infer<typeof RollKindSchema>;

/** Edge semantics carried on a roll (FR2.3). */
export const EdgeActionSchema = z.enum(['push_pre', 'push_post', 'second_chance']);
export type EdgeAction = z.infer<typeof EdgeActionSchema>;

/** Who is rolling. Exactly one of the three shapes is expected in practice. */
export const RollActorSchema = z.object({
  characterId: z.string().optional(),
  combatantId: z.string().optional(),
  gm: z.literal(true).optional(),
});
export type RollActor = z.infer<typeof RollActorSchema>;

/** A request to roll — client intent AND the stored provenance (FR2.6). */
export const RollRequestSchema = z.object({
  kind: RollKindSchema.default('simple'),
  pool: z.number().int().min(0),
  /** Pool provenance: attribute + skill + each modifier (Principle 3). */
  breakdown: z.array(ProvenanceEntrySchema).default([]),
  limit: LimitRefSchema.optional(),
  edge: EdgeActionSchema.nullable().optional(),
  visibility: VisibilitySchema.default('public'),
  actor: RollActorSchema.default({}),
  /** Kind-specific extras: threshold, interval, opposedRollId, helpers, … */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type RollRequest = z.infer<typeof RollRequestSchema>;
export type RollRequestInput = z.input<typeof RollRequestSchema>;

export const GlitchSchema = z.enum(['none', 'glitch', 'critical']);
export type Glitch = z.infer<typeof GlitchSchema>;

/** The resolved dice (server-rolled, immutable — G5). */
export const RollResultSchema = z.object({
  /** Raw faces in roll order, 1–6. */
  faces: z.array(z.number().int().min(1).max(6)),
  hits: z.number().int().min(0),
  ones: z.number().int().min(0),
  glitch: GlitchSchema,
  /** Hits after the limit is applied (equal to hits when no limit / limit ignored). */
  limitedHits: z.number().int().min(0),
  /** Extra faces from Rule of Six explosions, when Edge was pushed. */
  exploded: z.array(z.number().int().min(1).max(6)).optional(),
});
export type RollResult = z.infer<typeof RollResultSchema>;
