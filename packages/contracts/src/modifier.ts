import { z } from 'zod';

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
});
export type Modifier = z.infer<typeof ModifierSchema>;
