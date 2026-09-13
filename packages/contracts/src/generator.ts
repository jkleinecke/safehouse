import { z } from 'zod';
import { NumRangeSchema, RefSchema } from './common.js';
import { SheetV1Schema } from './sheet.js';

/**
 * NPC persona sheet — the Fixer writes it, the GM accepts it (FR12.5/12.6).
 * All fiction, zero mechanics.
 */
/**
 * The registers an NPC can speak in (FR12.6, the NPC manager). A dialect is
 * a palette entry — a label, how it sounds, three sample lines — so the
 * converse prompt can ask for the register by example rather than by name.
 * Original wording throughout; none of it is book text (§14).
 */
export const DIALECTS = [
  {
    id: 'sprawl-street',
    label: 'Sprawl street',
    register: 'clipped, slangy, drops articles, swears casually, never explains',
    samples: ['Chummer, you got the cred or you got a problem.', 'Nah. Not for that. Not tonight.', 'Drek, keep your head down and walk.'],
  },
  {
    id: 'corp-formal',
    label: 'Corporate formal',
    register: 'polished, indirect, passive voice, euphemism for everything, never says no outright',
    samples: [
      'I am sure an arrangement can be reached that satisfies all parties.',
      'That information is not something I am in a position to discuss.',
      'We value discretion. I trust you do too.',
    ],
  },
  {
    id: 'old-fixer',
    label: 'Old fixer',
    register: 'unhurried, dry, speaks in favours and debts, one sentence more than needed',
    samples: ['You owe me twice now. I am keeping count.', 'Everybody wants it yesterday. It costs more yesterday.', 'Sit. Eat. Then we talk.'],
  },
  {
    id: 'ork-underground',
    label: 'Ork underground',
    register: 'warm to kin, blunt to everyone else, proud, short vowels, family first',
    samples: ['You are not from down here. Say what you want and go.', 'My cousin runs that door. Mention me. Or don’t.', 'Stand up straight when you talk to me.'],
  },
  {
    id: 'salish-elder',
    label: 'Salish elder',
    register: 'measured, plain, patient, answers questions with the question that matters',
    samples: ['Why do you need to know that today?', 'The land was here before the pier. It will be here after.', 'Sit with that a while.'],
  },
  {
    id: 'vory',
    label: 'Vory',
    register: 'formal menace, few contractions, proverbs, calls people by full name',
    samples: ['James, you and I both know how this ends.', 'A debt is a debt. It does not care who is sorry.', 'Sit. We are civilised people.'],
  },
  {
    id: 'street-doc',
    label: 'Street doc',
    register: 'tired, quick, clinical, kind underneath, talks while working',
    samples: ['Hold still. This is the part that hurts.', 'Cash first. I do not take promises as anaesthetic.', 'You will live. Whether you deserve to is not my department.'],
  },
  {
    id: 'flat-drone',
    label: 'Flat, machine-like',
    register: 'monotone, literal, no idiom, states facts and options',
    samples: ['Access denied. Two attempts remain.', 'Your request is logged.', 'That door is not on your route.'],
  },
] as const;
export type DialectId = (typeof DIALECTS)[number]['id'];

export const PersonaSchema = z.object({
  traits: z.array(z.string()).default([]),
  voice: z.string().optional(),
  /** A `DIALECTS` id, or a free description of the register ("Glaswegian, cheerful"). */
  dialect: z.string().max(120).optional(),
  goals: z.array(z.string()).default([]),
  /** What they won't reveal — and under what pressure they might. */
  secrets: z.array(z.string()).default([]),
  /** The knowledge boundary: what this NPC actually knows. */
  knowledge: z.array(z.string()).default([]),
  backstory: z.string().optional(),
  mannerisms: z.array(z.string()).default([]),
  hooks: z.array(z.string()).default([]),
  /** The GM's private notes on this NPC — never part of any prompt or player payload. */
  notes: z.string().max(20000).optional(),
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
