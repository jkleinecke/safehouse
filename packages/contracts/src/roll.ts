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

export const GlitchSchema = z.enum(['none', 'glitch', 'critical']);
export type Glitch = z.infer<typeof GlitchSchema>;

/**
 * A roll made with the table's own dice: what the roller counted and typed in,
 * hits plus whether it glitched (the GM's decision of 2026-09-28 — hits and
 * the glitch, never every face). The server records it the way it records
 * bought hits: no faces, the limit applied to the typed hits and shown, the
 * full pool receipt kept so the log still says what was owed, and the log
 * marked "table dice", because these are the one kind of result the site
 * cannot vouch for (G5).
 *
 * A glitch with no hits at all is a critical glitch (p.45), so a glitch typed
 * with 0 hits is recorded as critical, and a critical glitch typed WITH hits
 * is refused: one of the two numbers is wrong, and the roller should say
 * which.
 */
export const TableResultSchema = z
  .object({
    hits: z.number().int().min(0),
    glitch: GlitchSchema.default('none'),
  })
  .refine((r) => !(r.glitch === 'critical' && r.hits > 0), {
    message: 'a critical glitch has no hits (p.45)',
    path: ['glitch'],
  })
  .transform((r) => (r.glitch === 'glitch' && r.hits === 0 ? { ...r, glitch: 'critical' as const } : r));
export type TableResult = z.infer<typeof TableResultSchema>;
export type TableResultInput = z.input<typeof TableResultSchema>;

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
  /**
   * Present when the roller used the table's own dice instead of the site's
   * (see `TableResultSchema`). The pool, the receipt, the limit and any Edge
   * spent are still the request's own; only the dice are not the server's.
   */
  tableResult: TableResultSchema.optional(),
});
export type RollRequest = z.infer<typeof RollRequestSchema>;
export type RollRequestInput = z.input<typeof RollRequestSchema>;

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
