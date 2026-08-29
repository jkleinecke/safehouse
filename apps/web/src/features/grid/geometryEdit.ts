/**
 * Pure GM-layer geometry authoring (FR9.2 walls/doors/zones, FR9.3 pins).
 *
 * The server takes geometry as a whole-object replacement
 * (`PATCH /api/scenes/:id { geometry }` → `SceneGeometrySchema`), so every
 * editor gesture is "old geometry in, new geometry out". Keeping that here —
 * pure, immutable, no React, no pixi — means the editors are three lines of
 * wiring each and the rules are unit-tested instead of clicked.
 *
 * Ids are deterministic (`wall_1`, `wall_2`, …) rather than random: a test can
 * assert them, and a GM reading a scene JSON can tell what they are looking at.
 */
import {
  SceneGeometrySchema,
  type Door,
  type Pin,
  type Point,
  type SceneGeometry,
  type Wall,
  type Zone,
} from '@safehouse/contracts';
import { gridDist, isDegenerateSegment, MIN_SEGMENT, snapVertex } from './geometry.js';

// The two pure gestures live in `geometry.ts` so the pixi stage can reach them
// without pulling the contract schemas in; re-exported here as the editors'
// natural home.
export { isDegenerateSegment, MIN_SEGMENT, snapVertex };

/** What the GM's active drawing tool is authoring. */
export type GeometryKind = 'wall' | 'door' | 'zone' | 'pin';

/** A zone needs three vertices to be a polygon at all. */
export const MIN_POLYGON_POINTS = 3;

export function emptyGeometry(): SceneGeometry {
  return { walls: [], doors: [], zones: [], pins: [] };
}

/**
 * Coerce anything scene-shaped into a valid `SceneGeometry`. Used before a
 * PATCH so a half-typed editor field can never post a body the server rejects.
 */
export function normalizeGeometry(raw: unknown): SceneGeometry {
  const parsed = SceneGeometrySchema.safeParse(
    typeof raw === 'object' && raw !== null ? raw : {},
  );
  return parsed.success ? parsed.data : emptyGeometry();
}

/** Does this object survive the contract? (editor "save" guard). */
export function isValidGeometry(raw: unknown): boolean {
  return SceneGeometrySchema.safeParse(raw).success;
}

// ---------------------------------------------------------------------------
// Ids and geometric guards
// ---------------------------------------------------------------------------

/** `prefix_N` with N one past the highest existing numeric suffix. */
export function nextGeometryId(prefix: string, existing: readonly { id: string }[]): string {
  const head = `${prefix}_`;
  let max = 0;
  for (const item of existing) {
    if (!item.id.startsWith(head)) continue;
    const n = Number.parseInt(item.id.slice(head.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${head}${max + 1}`;
}

export function segmentLength(a: Point, b: Point): number {
  return gridDist(a, b);
}

function roundPoint(p: Point, places = 3): Point {
  const f = 10 ** places;
  return { x: Math.round(p.x * f) / f, y: Math.round(p.y * f) / f };
}

// ---------------------------------------------------------------------------
// Walls (FR9.2)
// ---------------------------------------------------------------------------

export interface SegmentOptions {
  id?: string;
  note?: string;
}

/** Append a wall. Degenerate drags are rejected — geometry comes back unchanged. */
export function addWall(geo: SceneGeometry, a: Point, b: Point, opts: SegmentOptions = {}): SceneGeometry {
  if (isDegenerateSegment(a, b)) return geo;
  const wall: Wall = {
    id: opts.id ?? nextGeometryId('wall', geo.walls),
    a: roundPoint(a),
    b: roundPoint(b),
    ...(opts.note ? { note: opts.note } : {}),
  };
  return { ...geo, walls: [...geo.walls, wall] };
}

export function updateWall(
  geo: SceneGeometry,
  id: string,
  patch: Partial<Omit<Wall, 'id'>>,
): SceneGeometry {
  return {
    ...geo,
    walls: geo.walls.map((w) => (w.id === id ? { ...w, ...patch, id: w.id } : w)),
  };
}

export function removeWall(geo: SceneGeometry, id: string): SceneGeometry {
  return { ...geo, walls: geo.walls.filter((w) => w.id !== id) };
}

// ---------------------------------------------------------------------------
// Doors (FR9.2 — open/closed toggle)
// ---------------------------------------------------------------------------

export interface DoorOptions extends SegmentOptions {
  open?: boolean;
}

export function addDoor(geo: SceneGeometry, a: Point, b: Point, opts: DoorOptions = {}): SceneGeometry {
  if (isDegenerateSegment(a, b)) return geo;
  const door: Door = {
    id: opts.id ?? nextGeometryId('door', geo.doors),
    a: roundPoint(a),
    b: roundPoint(b),
    open: opts.open ?? false,
    ...(opts.note ? { note: opts.note } : {}),
  };
  return { ...geo, doors: [...geo.doors, door] };
}

export function updateDoor(
  geo: SceneGeometry,
  id: string,
  patch: Partial<Omit<Door, 'id'>>,
): SceneGeometry {
  return {
    ...geo,
    doors: geo.doors.map((d) => (d.id === id ? { ...d, ...patch, id: d.id } : d)),
  };
}

export function setDoorOpen(geo: SceneGeometry, id: string, open: boolean): SceneGeometry {
  return updateDoor(geo, id, { open });
}

/** The canvas gesture: click the knob, flip the state (FR9.2). */
export function toggleDoor(geo: SceneGeometry, id: string): SceneGeometry {
  const door = geo.doors.find((d) => d.id === id);
  if (!door) return geo;
  return setDoorOpen(geo, id, !door.open);
}

export function removeDoor(geo: SceneGeometry, id: string): SceneGeometry {
  return { ...geo, doors: geo.doors.filter((d) => d.id !== id) };
}

/**
 * Promote an existing wall into a door in place — the common authoring move
 * ("that segment is the entrance"). Keeps the endpoints, drops the wall.
 */
export function convertWallToDoor(geo: SceneGeometry, wallId: string): SceneGeometry {
  const wall = geo.walls.find((w) => w.id === wallId);
  if (!wall) return geo;
  const withoutWall = removeWall(geo, wallId);
  return addDoor(withoutWall, wall.a, wall.b, wall.note ? { note: wall.note } : {});
}

// ---------------------------------------------------------------------------
// Zones (FR9.2 — named areas / labels)
// ---------------------------------------------------------------------------

export interface ZoneOptions {
  id?: string;
  name?: string;
  color?: string;
  note?: string;
}

/** Append a zone from clicked vertices. Fewer than 3 points is not a polygon. */
export function addZone(geo: SceneGeometry, polygon: readonly Point[], opts: ZoneOptions = {}): SceneGeometry {
  if (polygon.length < MIN_POLYGON_POINTS) return geo;
  const zone: Zone = {
    id: opts.id ?? nextGeometryId('zone', geo.zones),
    name: opts.name?.trim() || `Zone ${geo.zones.length + 1}`,
    polygon: polygon.map((p) => roundPoint(p)),
    ...(opts.color ? { color: opts.color } : {}),
    ...(opts.note ? { note: opts.note } : {}),
  };
  return { ...geo, zones: [...geo.zones, zone] };
}

export function updateZone(
  geo: SceneGeometry,
  id: string,
  patch: Partial<Omit<Zone, 'id'>>,
): SceneGeometry {
  return {
    ...geo,
    zones: geo.zones.map((z) => (z.id === id ? { ...z, ...patch, id: z.id } : z)),
  };
}

export function removeZone(geo: SceneGeometry, id: string): SceneGeometry {
  return { ...geo, zones: geo.zones.filter((z) => z.id !== id) };
}

// ---------------------------------------------------------------------------
// Pins (FR9.3 — link a map point to a codex page or a handout)
// ---------------------------------------------------------------------------

export interface PinOptions {
  id?: string;
  label?: string;
  /** Codex page (FR5.3) this pin opens. */
  wikiPageId?: string;
  /** Or a handout attachment. */
  attachmentId?: string;
  /** GM pins are filtered out of player payloads SERVER-side (Principle 4). */
  visibility?: Pin['visibility'];
}

export function addPin(geo: SceneGeometry, at: Point, opts: PinOptions = {}): SceneGeometry {
  const pin: Pin = {
    id: opts.id ?? nextGeometryId('pin', geo.pins),
    at: roundPoint(at),
    visibility: opts.visibility ?? 'gm',
    ...(opts.label?.trim() ? { label: opts.label.trim() } : {}),
    ...(opts.wikiPageId ? { wikiPageId: opts.wikiPageId } : {}),
    ...(opts.attachmentId ? { attachmentId: opts.attachmentId } : {}),
  };
  return { ...geo, pins: [...geo.pins, pin] };
}

/**
 * Patch a pin. `null` clears an optional link — `{ wikiPageId: null }` unlinks
 * the codex page rather than leaving a dangling id behind.
 */
export type PinPatch = {
  at?: Point;
  label?: string | null;
  wikiPageId?: string | null;
  attachmentId?: string | null;
  visibility?: Pin['visibility'];
};

export function updatePin(geo: SceneGeometry, id: string, patch: PinPatch): SceneGeometry {
  return {
    ...geo,
    pins: geo.pins.map((p) => {
      if (p.id !== id) return p;
      const next: Pin = { ...p };
      if (patch.at) next.at = roundPoint(patch.at);
      if (patch.visibility) next.visibility = patch.visibility;
      applyOptional(next, 'label', patch.label?.trim?.() ?? patch.label);
      applyOptional(next, 'wikiPageId', patch.wikiPageId);
      applyOptional(next, 'attachmentId', patch.attachmentId);
      return next;
    }),
  };
}

function applyOptional(
  pin: Pin,
  key: 'label' | 'wikiPageId' | 'attachmentId',
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null || value === '') delete pin[key];
  else pin[key] = value;
}

export function removePin(geo: SceneGeometry, id: string): SceneGeometry {
  return { ...geo, pins: geo.pins.filter((p) => p.id !== id) };
}

/** A pin with no destination is a dot on a map — the editor warns on these. */
export function isPinLinked(pin: Pin): boolean {
  return Boolean(pin.wikiPageId || pin.attachmentId);
}

/** Count of what the GM has authored — the panel's tab badges. */
export function geometryCounts(geo: SceneGeometry): Record<GeometryKind, number> {
  return {
    wall: geo.walls.length,
    door: geo.doors.length,
    zone: geo.zones.length,
    pin: geo.pins.length,
  };
}
