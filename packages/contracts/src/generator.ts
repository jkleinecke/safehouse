import { z } from 'zod';
import { NumRangeSchema, RefSchema } from './common.js';
import { SheetV1Schema } from './sheet.js';

/**
 * NPC persona sheet — the Fixer writes it, the GM accepts it (FR12.5/12.6).
 * All fiction, zero mechanics.
 */
export const PersonaSchema = z.object({
  traits: z.array(z.string()).default([]),
  voice: z.string().optional(),
  goals: z.array(z.string()).default([]),
  /** What they won't reveal — and under what pressure they might. */
  secrets: z.array(z.string()).default([]),
  /** The knowledge boundary: what this NPC actually knows. */
  knowledge: z.array(z.string()).default([]),
  backstory: z.string().optional(),
  mannerisms: z.array(z.string()).default([]),
  hooks: z.array(z.string()).default([]),
});
export type Persona = z.infer<typeof PersonaSchema>;

/** A loadout slot referencing the GM's own gear records by name/id (FR10.1). */
export const LoadoutSlotSchema = z.object({
  /** e.g. 'primary-weapon', 'armor', 'utility'. */
  slot: z.string().min(1),
  /** Candidate gear/weapon record names or ids — user-entered data, never book stat blocks. */
  options: z.array(z.string()).default([]),
  /** How many picks from this slot (default exactly 1). */
  count: NumRangeSchema.optional(),
});
export type LoadoutSlot = z.infer<typeof LoadoutSlotSchema>;

/** One tier of the archetype's dial (street / seasoned / pro / … labels editable). */
export const GenTierSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Per-attribute sampling ranges, keys are attribute codes ('bod', 'agi', …). */
  attributes: z.record(z.string(), NumRangeSchema).default({}),
  /** Per-skill sampling ranges, keys are skill ids. */
  skills: z.record(z.string(), NumRangeSchema).default({}),
  professionalRating: NumRangeSchema,
  /** Relative weights for metatype picks, e.g. { human: 3, ork: 2 }. */
  metatypeWeights: z.record(z.string(), z.number().min(0)).optional(),
  loadout: z.array(LoadoutSlotSchema).default([]),
  /** Optional spell / 'ware pick lists (names of GM-entered records). */
  spells: z.array(z.string()).default([]),
  augments: z.array(z.string()).default([]),
});
export type GenTier = z.infer<typeof GenTierSchema>;

/** Archetype template generation parameters (FR10.1) — data, not stat blocks. */
export const GenTemplateSchema = z.object({
  /** Role tags: muscle, face, mage, adept, decker, rigger, sniper, … */
  roleTags: z.array(z.string()).default([]),
  tiers: z.array(GenTierSchema).min(1),
});
export type GenTemplate = z.infer<typeof GenTemplateSchema>;

/** An NPC/archetype template entity (DESIGN.md §9.2 `npc_templates`). */
export const NpcTemplateSchema = z.object({
  id: z.string(),
  campaignId: z.string().optional(),
  name: z.string().min(1),
  /** User-entered / procedural stats; shape is a (partial) SheetV1. */
  statblock: SheetV1Schema.partial().optional(),
  gen: GenTemplateSchema.optional(),
  persona: PersonaSchema.optional(),
  pageRef: RefSchema.optional(),
});
export type NpcTemplate = z.infer<typeof NpcTemplateSchema>;

/** Request one generated NPC (FR10.2). Seeded for reproducible squads. */
export const GenerateNpcRequestSchema = z.object({
  templateId: z.string(),
  tierId: z.string(),
  seed: z.number().int().optional(),
  /** Field paths to keep fixed while rerolling the rest ("keep the stats, reroll the names"). */
  locks: z.array(z.string()).default([]),
});
export type GenerateNpcRequest = z.infer<typeof GenerateNpcRequestSchema>;

/** Request a grunt group (FR10.2 / FR4.6). */
export const GenerateGroupRequestSchema = z.object({
  templateId: z.string(),
  tierId: z.string(),
  size: z.number().int().min(1),
  seed: z.number().int().optional(),
  locks: z.array(z.string()).default([]),
});
export type GenerateGroupRequest = z.infer<typeof GenerateGroupRequestSchema>;
