import { z } from 'zod';

export const TokenSourceSchema = z.enum(['character', 'combatant', 'npc_template', 'prop']);
export type TokenSource = z.infer<typeof TokenSourceSchema>;

/** Aura ring for sustained-spell radii / spirit Force (FR9.6). */
export const TokenAuraSchema = z.object({
  radiusM: z.number().positive(),
  color: z.string().optional(),
  label: z.string().optional(),
});
export type TokenAura = z.infer<typeof TokenAuraSchema>;

/**
 * A token on a scene (DESIGN.md §9.2 `tokens`). Positions are grid units.
 * Hidden tokens' positions are NEVER sent to player/display sockets (FR9.7).
 */
export const TokenSchema = z.object({
  id: z.string(),
  sceneId: z.string(),
  source: TokenSourceSchema,
  sourceId: z.string().nullable().optional(),
  name: z.string().min(1),
  x: z.number(),
  y: z.number(),
  /**
   * Which floor this token is on — an index into the scene's levels, 0 being
   * the ground (FR9.22).
   *
   * On the token rather than derived from position, because two tokens can
   * stand on the same square of two different storeys and the map has to tell
   * them apart. Optional and defaulting to 0, so every existing token and
   * every flat scene is already correct.
   */
  level: z.number().int().min(0).default(0),
  /** Size in grid units (metahuman 1; drones/vehicles/spirits any) — FR9.4. */
  size: z.number().positive().default(1),
  rotation: z.number().default(0),
  /** Attachment id for token art; null → silhouette fallback. */
  artRef: z.string().nullable().optional(),
  hidden: z.boolean().default(false),
  barsVisibility: z.enum(['gm', 'owner', 'public']).default('owner'),
  aura: TokenAuraSchema.nullable().optional(),
});
export type Token = z.infer<typeof TokenSchema>;
export type TokenInput = z.input<typeof TokenSchema>;
