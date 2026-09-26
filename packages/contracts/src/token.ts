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
 * How a figure holds itself on the isometric map. Standing is the default and
 * walking is drawn on its own while a token moves; crouched and prone are what
 * a runner chooses (behind cover, under a window). A runner whose condition
 * monitor fills is drawn down whatever this says — that is the sheet's call,
 * not the token's.
 */
export const TokenPoseSchema = z.enum(['stand', 'crouch', 'prone']);
export type TokenPose = z.infer<typeof TokenPoseSchema>;

/**
 * How a token's figure looks on the isometric map (`figure.ts` on the web).
 *
 * Every field is optional: what is left out is chosen as it always was —
 * from the token's name ("Troll Samurai"), else fixed per token. A GM, or a
 * player for their own runner, sets these by hand or by describing the look
 * to the AI, which answers in exactly this shape.
 */
export const FIGURE_ARCHETYPES = ['samurai', 'decker', 'mage', 'rigger', 'face', 'adept', 'ganger', 'security', 'civilian'] as const;
export const FIGURE_METATYPES = ['human', 'elf', 'dwarf', 'ork', 'troll'] as const;
export const FIGURE_OUTFITS = ['jacket', 'duster', 'hoodie', 'armor', 'suit', 'vest'] as const;
export const FIGURE_HEADS = ['mohawk', 'crop', 'long', 'shaved', 'hood', 'helmet', 'topknot'] as const;
export const FIGURE_EYES = ['shades', 'visor', 'cybereye', 'goggles', 'none'] as const;
export const FIGURE_GEAR = ['rifle', 'katana', 'pistol', 'deck', 'focus', 'remote', 'none'] as const;
export const FIGURE_CYBERARMS = ['none', 'left', 'right'] as const;
export const FIGURE_COLORS = ['skin', 'hair', 'coat', 'under', 'legs', 'boots', 'neon', 'chrome'] as const;

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const TokenLookSchema = z.object({
  archetype: z.enum(FIGURE_ARCHETYPES).optional(),
  metatype: z.enum(FIGURE_METATYPES).optional(),
  outfit: z.enum(FIGURE_OUTFITS).optional(),
  headStyle: z.enum(FIGURE_HEADS).optional(),
  eyes: z.enum(FIGURE_EYES).optional(),
  gear: z.enum(FIGURE_GEAR).optional(),
  cyberarm: z.enum(FIGURE_CYBERARMS).optional(),
  /** Plates on the shoulders. */
  pads: z.boolean().optional(),
  /** `#rrggbb` per part; `neon` is the lit trim, which otherwise shows the token's side. */
  colors: z
    .object({
      skin: Hex.optional(),
      hair: Hex.optional(),
      coat: Hex.optional(),
      under: Hex.optional(),
      legs: Hex.optional(),
      boots: Hex.optional(),
      neon: Hex.optional(),
      chrome: Hex.optional(),
    })
    .optional(),
  /** What was asked for, kept so the next edit can start from it. */
  description: z.string().max(600).optional(),
});
export type TokenLook = z.infer<typeof TokenLookSchema>;

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
  /** Standing, crouched or prone (`TokenPoseSchema`); absent is standing. */
  pose: TokenPoseSchema.optional(),
  /** The figure's look on the isometric map (`TokenLookSchema`); null or absent is chosen for it. */
  look: TokenLookSchema.nullable().optional(),
});
export type Token = z.infer<typeof TokenSchema>;
export type TokenInput = z.input<typeof TokenSchema>;
