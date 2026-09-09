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
  type Camera,
  type Door,
  type Note,
  type Scene,
  type Pin,
  type Point,
  type SceneGeometry,
  type Wall,
  type Zone,
} from '@safehouse/contracts';
import { sceneLevels } from '@safehouse/rules';
import { gridDist, isDegenerateSegment, MIN_SEGMENT, snapVertex } from './geometry.js';

// The two pure gestures live in `geometry.ts` so the pixi stage can reach them
// without pulling the contract schemas in; re-exported here as the editors'
// natural home.
export { isDegenerateSegment, MIN_SEGMENT, snapVertex };

/** What the GM's active drawing tool is authoring. */
export type GeometryKind = 'wall' | 'door' | 'zone' | 'pin' | 'camera' | 'note';

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
  /** Locked doors refuse a player's hand (FR9.24); the GM's key always turns. */
  locked?: boolean;
}

export function addDoor(geo: SceneGeometry, a: Point, b: Point, opts: DoorOptions = {}): SceneGeometry {
  if (isDegenerateSegment(a, b)) return geo;
  const door: Door = {
    id: opts.id ?? nextGeometryId('door', geo.doors),
    a: roundPoint(a),
    b: roundPoint(b),
    open: opts.open ?? false,
    locked: opts.locked ?? false,
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
/** Lock or unlock a traced door (FR9.24) — the GM's switch; players learn it by trying. */
export function setDoorLocked(geo: SceneGeometry, id: string, locked: boolean): SceneGeometry {
  return { ...geo, doors: geo.doors.map((d) => (d.id === id ? { ...d, locked } : d)) };
}

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
    camera: camerasOf(geo).length,
    note: notesOf(geo).length,
  };
}

// ---------------------------------------------------------------------------
// Cameras (FR9.23 — a fixed eye only the GM sees)
// ---------------------------------------------------------------------------

/** What a click mounts, before the GM has touched a dial. */
export const CAMERA_DEFAULTS = { facing: 90, fov: 90, range: 12 } as const;

/** The list, whether or not the scene has ever had one. */
export function camerasOf(geo: SceneGeometry): readonly Camera[] {
  return geo.cameras ?? [];
}

/** A bearing on the compass, 0 ≤ deg < 360, to a tenth of a degree. */
export function normalizeFacing(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  return Math.round(d * 10) / 10;
}

export interface CameraOptions {
  id?: string;
  facing?: number;
  fov?: number;
  range?: number;
  level?: number;
  label?: string;
}

export function addCamera(geo: SceneGeometry, at: Point, opts: CameraOptions = {}): SceneGeometry {
  const cameras = camerasOf(geo);
  const camera: Camera = {
    id: opts.id ?? nextGeometryId('cam', cameras),
    at: roundPoint(at),
    facing: normalizeFacing(opts.facing ?? CAMERA_DEFAULTS.facing),
    fov: clampFov(opts.fov ?? CAMERA_DEFAULTS.fov),
    range: clampRange(opts.range ?? CAMERA_DEFAULTS.range),
    level: Math.max(0, Math.floor(opts.level ?? 0)),
    active: true,
    ...(opts.label?.trim() ? { label: opts.label.trim() } : {}),
  };
  return { ...geo, cameras: [...cameras, camera] };
}

export type CameraPatch = {
  at?: Point;
  facing?: number;
  fov?: number;
  range?: number;
  level?: number;
  active?: boolean;
  /** `null` clears the label. */
  label?: string | null;
};

export function updateCamera(geo: SceneGeometry, id: string, patch: CameraPatch): SceneGeometry {
  return {
    ...geo,
    cameras: camerasOf(geo).map((c) => {
      if (c.id !== id) return c;
      const next: Camera = { ...c };
      if (patch.at) next.at = roundPoint(patch.at);
      if (patch.facing !== undefined) next.facing = normalizeFacing(patch.facing);
      if (patch.fov !== undefined) next.fov = clampFov(patch.fov);
      if (patch.range !== undefined) next.range = clampRange(patch.range);
      if (patch.level !== undefined) next.level = Math.max(0, Math.floor(patch.level));
      if (patch.active !== undefined) next.active = patch.active;
      if (patch.label !== undefined) {
        const label = patch.label?.trim() ?? '';
        if (label === '') delete next.label;
        else next.label = label;
      }
      return next;
    }),
  };
}

export function removeCamera(geo: SceneGeometry, id: string): SceneGeometry {
  return { ...geo, cameras: camerasOf(geo).filter((c) => c.id !== id) };
}

// ---------------------------------------------------------------------------
// GM notes (FR9.25 — a box of text on the map that only the GM ever sees)
// ---------------------------------------------------------------------------

export const NOTE_DEFAULT_WIDTH = 4;
export const NOTE_MAX_CHARS = 2000;

/** An old scene has no note list; read it as none. */
export function notesOf(geo: SceneGeometry): readonly Note[] {
  return geo.gmNotes ?? [];
}

export interface NoteOptions {
  id?: string;
  text?: string;
  width?: number;
  color?: string;
}

/** Drop a note at a grid point (its top-left corner), with a placeholder to overwrite. */
export function addNote(geo: SceneGeometry, at: Point, opts: NoteOptions = {}): SceneGeometry {
  const notes = notesOf(geo);
  const note: Note = {
    id: opts.id ?? nextGeometryId('note', notes),
    at: roundPoint(at),
    text: (opts.text ?? 'GM note').slice(0, NOTE_MAX_CHARS),
    width: clampNoteWidth(opts.width ?? NOTE_DEFAULT_WIDTH),
  };
  if (opts.color) note.color = opts.color;
  return { ...geo, gmNotes: [...notes, note] };
}

export type NotePatch = {
  at?: Point;
  text?: string;
  width?: number;
  /** null clears the colour. */
  color?: string | null;
};

/** Every dial kept inside the contract, whatever the GM types. */
export function updateNote(geo: SceneGeometry, id: string, patch: NotePatch): SceneGeometry {
  return {
    ...geo,
    gmNotes: notesOf(geo).map((n) => {
      if (n.id !== id) return n;
      const next: Note = { ...n };
      if (patch.at !== undefined) next.at = roundPoint(patch.at);
      if (patch.text !== undefined) next.text = patch.text.slice(0, NOTE_MAX_CHARS);
      if (patch.width !== undefined) next.width = clampNoteWidth(patch.width);
      if (patch.color === null) delete next.color;
      else if (patch.color !== undefined) next.color = patch.color;
      return next;
    }),
  };
}

export function removeNote(geo: SceneGeometry, id: string): SceneGeometry {
  return { ...geo, gmNotes: notesOf(geo).filter((n) => n.id !== id) };
}

function clampNoteWidth(w: number): number {
  return Math.min(20, Math.max(1, Math.round(Number.isFinite(w) ? w : NOTE_DEFAULT_WIDTH)));
}

// ---------------------------------------------------------------------------
// Painted doors (FR9.24) — reading their state off the floor they are on
// ---------------------------------------------------------------------------

/** Is the painted door in `cell` on floor `level` standing open? Shut when unsaid. */
export function tileDoorOpen(scene: Scene, level: number, cell: string): boolean {
  const floor = sceneLevels(scene)[level];
  return floor?.tiles?.doors?.[cell]?.open === true;
}

/** The contract's bounds: narrower than a keyhole or wider than a dome is a typo. */
function clampFov(fov: number): number {
  return Math.min(360, Math.max(5, Math.round(fov)));
}

function clampRange(range: number): number {
  return Math.min(200, Math.max(1, Math.round(range * 10) / 10));
}
