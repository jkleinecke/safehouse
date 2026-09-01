/**
 * Pure projections behind the Scenes manager (`/c/:campaignId/gm/scenes`).
 *
 * The screen is a LIST-level tool: which scenes exist, which one the table is
 * looking at, how big each map is, what fog has been carved out of it and what
 * the weather is doing to everyone's dice. None of that needs a canvas, which
 * is why it lives here and not in the Grid's in-canvas GM panel — and why every
 * function in this file is a plain data transform with no React and no I/O, so
 * the numbers the card prints can be tested without a DOM.
 *
 * The environment readout runs the SAME `environment()` the server injects into
 * rolls (FR9.11, Principle 3): what the GM reads next to the selects is what the
 * roll log will say, not a second implementation of the table.
 */
import type { FogRegion, Grid, Scene, SceneEnvironment } from '@safehouse/contracts';
import { environment } from '@safehouse/rules';

// ---------------------------------------------------------------------------
// Environment (FR9.11)
// ---------------------------------------------------------------------------

export type EnvAxis = 'light' | 'visibility' | 'glare' | 'wind';

export const ENV_AXES: EnvAxis[] = ['light', 'visibility', 'glare', 'wind'];

/**
 * Level names per axis, 0..3. Kept beside the readout rather than imported from
 * the Grid panel so the two screens can word themselves differently without one
 * quietly changing the other's copy; the *numbers* both come from the engine.
 */
export const ENV_LABELS: Record<EnvAxis, [string, string, string, string]> = {
  light: ['full light', 'partial light', 'dim', 'total darkness'],
  visibility: ['clear', 'light haze', 'obscured', 'heavy obscurement'],
  glare: ['none', 'slight', 'strong', 'blinding'],
  wind: ['calm', 'light breeze', 'strong wind', 'gale'],
};

export interface EnvReadout {
  /** Pool modifier the engine composes — 0 when conditions are clear. */
  value: number;
  /** The engine's own provenance note, or null when nothing is injected. */
  note: string | null;
  /** True when no modifier is produced at all. */
  clear: boolean;
  /** Axes above level 0, in axis order ("dim", "strong wind"). */
  contributors: { axis: EnvAxis; level: number; label: string }[];
}

export function envLabel(axis: EnvAxis, level: number): string {
  const labels = ENV_LABELS[axis];
  const clamped = Math.max(0, Math.min(3, Math.round(level)));
  return labels[clamped] ?? labels[0];
}

/** What this scene's weather does to every pool rolled while it is active. */
export function envReadout(env: SceneEnvironment): EnvReadout {
  const mod = environment(env)[0];
  const contributors = ENV_AXES.flatMap((axis) => {
    const level = env[axis] ?? 0;
    return level > 0 ? [{ axis, level, label: envLabel(axis, level) }] : [];
  });
  return {
    value: mod?.value ?? 0,
    note: mod?.note ?? null,
    clear: !mod,
    contributors,
  };
}

/** Short chip text: "clear" or "dim, strong wind". */
export function envSummaryText(readout: EnvReadout): string {
  if (readout.contributors.length === 0) return 'clear';
  return readout.contributors.map((c) => c.label).join(', ');
}

// ---------------------------------------------------------------------------
// Scene cards
// ---------------------------------------------------------------------------

/** Tokens on a scene, as the GM's composed read reports them. */
export interface TokenCount {
  total: number;
  hidden: number;
}

export interface FogRegionRow {
  region: FogRegion;
  revealed: boolean;
}

export interface SceneSummary {
  id: string;
  name: string;
  isLive: boolean;
  isArchived: boolean;
  grid: Grid;
  /** Map size in metres, derived from the calibrated square. */
  widthM: number;
  heightM: number;
  mapCount: number;
  /** Raw first map ref (may carry a `#rot=…` adjustment) or null. */
  mapRef: string | null;
  fog: FogRegionRow[];
  fogRevealed: number;
  freehandReveals: number;
  walls: number;
  doors: number;
  zones: number;
  pins: number;
  env: EnvReadout;
  /** null until the per-scene composed read lands (never "0 tokens" on a guess). */
  tokens: TokenCount | null;
}

export function summarizeScene(scene: Scene, tokens: TokenCount | null = null): SceneSummary {
  const revealed = new Set(scene.fog.revealed);
  const grid = scene.grid;
  return {
    id: scene.id,
    name: scene.name,
    isLive: scene.state === 'active',
    isArchived: scene.state === 'archived',
    grid,
    widthM: round1(grid.cols * grid.unitM),
    heightM: round1(grid.rows * grid.unitM),
    mapCount: scene.mapAttachmentIds.length,
    mapRef: scene.mapAttachmentIds[0] ?? null,
    fog: scene.fog.regions.map((region) => ({ region, revealed: revealed.has(region.id) })),
    fogRevealed: scene.fog.regions.filter((r) => revealed.has(r.id)).length,
    freehandReveals: scene.fog.revealedShapes.length,
    walls: scene.geometry.walls.length,
    doors: scene.geometry.doors.length,
    zones: scene.geometry.zones.length,
    pins: scene.geometry.pins.length,
    env: envReadout(scene.environment),
    tokens,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** "40 × 30 squares · 1 m per square · 40 × 30 m". */
export function describeGrid(summary: SceneSummary): string {
  const { grid } = summary;
  return (
    `${grid.cols} × ${grid.rows} squares · ${trim(grid.unitM)} m per square · ` +
    `${trim(summary.widthM)} × ${trim(summary.heightM)} m`
  );
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * What has actually been drawn on the canvas, in words rather than the
 * "3w 1d 0z 2p" shorthand a GM has to decode. Zeros are omitted; nothing drawn
 * says so, because "0 walls · 0 doors" reads like a broken widget.
 */
export function describeGeometry(summary: SceneSummary): string {
  const parts = [
    plural(summary.walls, 'wall'),
    plural(summary.doors, 'door'),
    plural(summary.zones, 'zone'),
    plural(summary.pins, 'pin'),
  ].filter((s): s is string => s !== null);
  return parts.length === 0 ? 'nothing drawn yet' : parts.join(' · ');
}

function plural(n: number, noun: string): string | null {
  if (n <= 0) return null;
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// List-level decisions
// ---------------------------------------------------------------------------

export interface SceneCounts {
  total: number;
  live: number;
  drafts: number;
  archived: number;
}

export function sceneCounts(scenes: readonly Scene[]): SceneCounts {
  let live = 0;
  let archived = 0;
  for (const s of scenes) {
    if (s.state === 'active') live += 1;
    else if (s.state === 'archived') archived += 1;
  }
  return { total: scenes.length, live, drafts: scenes.length - live - archived, archived };
}

/**
 * The live scene first — it is the one the table is staring at — then drafts by
 * name, then the archive. A GM scanning this list is nearly always looking for
 * "what is on the table" or "the one I built last Tuesday", in that order.
 */
export function sortScenes(scenes: readonly Scene[]): Scene[] {
  const rank = (s: Scene): number => (s.state === 'active' ? 0 : s.state === 'archived' ? 2 : 1);
  return [...scenes].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return a.name.localeCompare(b.name);
  });
}

/** Non-colliding name for a copy: "Rooftop (copy)", then "(copy 2)", … */
export function duplicateName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const first = `${base} (copy)`;
  if (!taken.has(first.toLowerCase())) return first;
  for (let i = 2; i < 200; i += 1) {
    const candidate = `${base} (copy ${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (copy ${Date.now()})`;
}

/**
 * Archiving the live scene would leave the table pointed at nothing, and the
 * activate route is the only thing that clears `active`. So the manager refuses
 * and says which move comes first (Principle 2: it is a guard rail, not a lock
 * — the GM can activate any other scene and archive this one immediately).
 */
export function archiveBlockedReason(summary: SceneSummary): string | null {
  if (!summary.isLive) return null;
  return 'This is the live scene — activate another scene first, then archive this one.';
}

/** Warning text for the delete confirmation, sharpened when the table is on it. */
export function deleteWarning(summary: SceneSummary): string {
  const parts: string[] = [];
  const tokens = summary.tokens?.total ?? 0;
  if (tokens > 0) parts.push(`${tokens} token${tokens === 1 ? '' : 's'}`);
  if (summary.fog.length > 0) {
    parts.push(`${summary.fog.length} fog region${summary.fog.length === 1 ? '' : 's'}`);
  }
  const geometry = summary.walls + summary.doors + summary.zones + summary.pins;
  if (geometry > 0) parts.push(`${geometry} wall/door/zone/pin`);
  const tail = parts.length > 0 ? ` It takes ${parts.join(', ')} with it.` : '';
  const live = summary.isLive
    ? ' The table is looking at this scene right now — every player screen and the TV will go blank until you activate another.'
    : '';
  return `Deleting “${summary.name}” cannot be undone.${tail}${live}`;
}

/** Defaults for a new scene: one metre per square (FR9.1), a small city block. */
export const NEW_SCENE_DEFAULTS = { unitM: 1, cols: 40, rows: 30 } as const;

export interface NewSceneDraft {
  name: string;
  unitM: number;
  cols: number;
  rows: number;
}

export function blankSceneDraft(): NewSceneDraft {
  return { name: '', ...NEW_SCENE_DEFAULTS };
}

/** Clamp a half-typed create form into something the server will accept. */
export function normalizeDraft(draft: NewSceneDraft): NewSceneDraft {
  return {
    name: draft.name.trim(),
    unitM: positive(draft.unitM, NEW_SCENE_DEFAULTS.unitM),
    cols: intAtLeast(draft.cols, 1, NEW_SCENE_DEFAULTS.cols),
    rows: intAtLeast(draft.rows, 1, NEW_SCENE_DEFAULTS.rows),
  };
}

function positive(n: number, fallback: number): number {
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : fallback;
}

function intAtLeast(n: number, min: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.round(n));
}
