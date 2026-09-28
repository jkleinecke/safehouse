import { z } from 'zod';

/** Who may see a thing (DESIGN.md FR2.7, §13). */
export const VisibilitySchema = z.enum(['public', 'gm', 'gm_owner']);
export type Visibility = z.infer<typeof VisibilitySchema>;

/** Membership / device roles (FR1.3, FR9.19). */
export const RoleSchema = z.enum(['gm', 'player', 'observer', 'display']);
export type Role = z.infer<typeof RoleSchema>;

/** Structured book reference — printed page, never book text (M11, FR11.2). */
export const RefSchema = z.object({
  book: z.string().min(1),
  page: z.number().int().min(1),
  note: z.string().optional(),
});
export type Ref = z.infer<typeof RefSchema>;

/**
 * One row index, 0–3, of the Environmental Modifiers table (SR5 p.175): 0 is
 * the clear row (full light, calm air, short range), then the −1, −3 and −6
 * rows. The −10 row has no condition of its own — only two conditions tied at
 * −6 reach it — so no single condition is ever 4.
 */
export const EnvRowSchema = z.number().int().min(0).max(3);

/**
 * Which row of the environment table each condition sits on, for a modifier
 * or a receipt line that stands for part of that table. Only the conditions
 * that were looked at are present; a missing one is the clear row.
 *
 * Glare is its own key because gear treats it apart from darkness (low-light
 * eyes help in the dim, not in the glare), but it is not its own column: the
 * book's column is Light/Glare, so the two are read as one when the rows are
 * compared. Range is here because the book counts it as one more
 * environmental condition (p.173), which is why a range band folds into the
 * scene's line rather than adding on top of it.
 */
export const EnvRowsSchema = z.object({
  visibility: EnvRowSchema.optional(),
  light: EnvRowSchema.optional(),
  glare: EnvRowSchema.optional(),
  wind: EnvRowSchema.optional(),
  range: EnvRowSchema.optional(),
});
export type EnvRows = z.infer<typeof EnvRowsSchema>;

/** A point in scene/grid coordinates (grid units unless stated otherwise). */
export const PointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof PointSchema>;

/** Canonical API error envelope (§12). */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Inclusive integer range used by the generator's tier curves (FR10.1). */
export const NumRangeSchema = z.object({
  min: z.number().int(),
  max: z.number().int(),
});
export type NumRange = z.infer<typeof NumRangeSchema>;
