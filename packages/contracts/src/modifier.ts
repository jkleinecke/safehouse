import { z } from 'zod';
import { RefSchema } from './common.js';

/** Where a modifier comes from (DESIGN.md §7.2). */
export const ModifierSourceKindSchema = z.enum([
  'cyberware',
  'quality',
  'power',
  'spell',
  'wound',
  'status',
  'scene',
  'range',
  'situational',
  'override',
]);
export type ModifierSourceKind = z.infer<typeof ModifierSourceKindSchema>;

export const ModifierOpSchema = z.enum(['add', 'set', 'cap']);
export type ModifierOp = z.infer<typeof ModifierOpSchema>;

/**
 * The engine's core abstraction: everything that changes a number is a Modifier
 * (§7.2). `target` examples: `attr.rea`, `initiative.dice`, `initiative.score`,
 * `limit.physical`, `pool.skill.<id>`, `pool.all`, `armor`.
 */
export const ModifierSchema = z.object({
  id: z.string(),
  source: z.object({
    kind: ModifierSourceKindSchema,
    ref: z.string().optional(),
  }),
  target: z.string(),
  op: ModifierOpSchema,
  value: z.number(),
  active: z.boolean(),
  note: z.string().optional(),
  /**
   * The printed page that explains this modifier — `{ book, page }`, never
   * book text (M11). Named `bookRef` because `source.ref` was already taken:
   * that one names the THING the modifier came from (a spell, a focus, a range
   * category), this one names the PAGE. `applyPipeline` copies it onto the
   * receipt line as `ProvenanceEntry.ref`; a quality, implant or power without
   * its own gets the item's page stamped on by `deriveCharacter`.
   */
  bookRef: RefSchema.optional(),
});
export type Modifier = z.infer<typeof ModifierSchema>;
