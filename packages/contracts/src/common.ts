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
