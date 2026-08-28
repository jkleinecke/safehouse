import { z } from 'zod';
import { PointSchema } from './common.js';

/** Square grid config — SR5 measures in meters; default 1 m per square (FR9.1). */
export const GridSchema = z.object({
  unitM: z.number().positive().default(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  offset: PointSchema.default({ x: 0, y: 0 }),
  opacity: z.number().min(0).max(1).optional(),
});
export type Grid = z.infer<typeof GridSchema>;

/**
 * Environment severity level per axis: 0 = clear/full light/no glare/calm,
 * 1..3 = worsening tiers. The rules engine maps levels to the standard
 * −1/−3/−6/−10 modifier tiers (FR9.11, §10.2). Labels are UI concerns.
 */
export const EnvLevelSchema = z.number().int().min(0).max(3);
export type EnvLevel = z.infer<typeof EnvLevelSchema>;

export const SceneEnvironmentSchema = z.object({
  light: EnvLevelSchema.default(0),
  visibility: EnvLevelSchema.default(0),
  glare: EnvLevelSchema.default(0),
  wind: EnvLevelSchema.default(0),
  note: z.string().optional(),
});
export type SceneEnvironment = z.infer<typeof SceneEnvironmentSchema>;

export const WallSchema = z.object({
  id: z.string(),
  a: PointSchema,
  b: PointSchema,
  note: z.string().optional(),
});
export type Wall = z.infer<typeof WallSchema>;

export const DoorSchema = z.object({
  id: z.string(),
  a: PointSchema,
  b: PointSchema,
  open: z.boolean().default(false),
  note: z.string().optional(),
});
export type Door = z.infer<typeof DoorSchema>;

export const ZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  polygon: z.array(PointSchema).min(3),
  color: z.string().optional(),
  note: z.string().optional(),
});
export type Zone = z.infer<typeof ZoneSchema>;

/** Map pin linking to codex pages / handouts (FR9.3). */
export const PinSchema = z.object({
  id: z.string(),
  at: PointSchema,
  label: z.string().optional(),
  wikiPageId: z.string().optional(),
  attachmentId: z.string().optional(),
  visibility: z.enum(['public', 'gm']).default('gm'),
});
export type Pin = z.infer<typeof PinSchema>;

export const SceneGeometrySchema = z.object({
  walls: z.array(WallSchema).default([]),
  doors: z.array(DoorSchema).default([]),
  zones: z.array(ZoneSchema).default([]),
  pins: z.array(PinSchema).default([]),
});
export type SceneGeometry = z.infer<typeof SceneGeometrySchema>;

/** A named fog region for staged reveals ("east wing", "the lab") — FR9.14. */
export const FogRegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  polygon: z.array(PointSchema).min(3),
});
export type FogRegion = z.infer<typeof FogRegionSchema>;

/** Server-authoritative fog state per scene (FR9.13). */
export const FogStateSchema = z.object({
  regions: z.array(FogRegionSchema).default([]),
  /** Ids of revealed named regions. */
  revealed: z.array(z.string()).default([]),
  /** Freeform revealed polygons from brush/polygon painting. */
  revealedShapes: z.array(z.array(PointSchema)).default([]),
});
export type FogState = z.infer<typeof FogStateSchema>;

export const SceneStateSchema = z.enum(['draft', 'active', 'archived']);
export type SceneState = z.infer<typeof SceneStateSchema>;

/** A scene entity (DESIGN.md §9.2 `scenes`). */
export const SceneSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  name: z.string().min(1),
  state: SceneStateSchema.default('draft'),
  grid: GridSchema,
  environment: SceneEnvironmentSchema.default({ light: 0, visibility: 0, glare: 0, wind: 0 }),
  geometry: SceneGeometrySchema.default({ walls: [], doors: [], zones: [], pins: [] }),
  fog: FogStateSchema.default({ regions: [], revealed: [], revealedShapes: [] }),
  /** Background map image attachment ids, draw order first→last. */
  mapAttachmentIds: z.array(z.string()).default([]),
  notes: z.string().optional(),
  audioRef: z.string().optional(),
});
export type Scene = z.infer<typeof SceneSchema>;
export type SceneInput = z.input<typeof SceneSchema>;
