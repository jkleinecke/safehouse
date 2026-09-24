/**
 * Build a floor from a description (FR12.11, lane 3). The GM says what the
 * level is — "a clinic: waiting room, two exam rooms, a locked store, a back
 * door" — and the model lays it out as rooms, openings, props and stairs on
 * the scene's grid, in the vocabulary of the scene's tileset. The server
 * compiles that into painted squares (slots, `rules/tilesets/slots.ts`) and
 * hands them back. Nothing is painted here: the GM reads the plan and builds
 * it with one click, as one undoable stroke, or throws it away (Principle 8).
 *
 * The plan speaks the room tool's language: a room INCLUDES its walls — the
 * outer ring of squares is wall, the inside is floor — because that is what
 * `roomFill.ts` draws when the GM drags a room by hand, and a plan the GM
 * cannot extend by hand is a plan they cannot fix.
 */
import { z } from 'zod';
import type { AiEffort } from '@safehouse/contracts';
import type { Db } from '@safehouse/db';
import {
  categoryOf,
  layerOf,
  resolveTile,
  tileBySlot,
  tilesetById,
  toSlot,
  type Tile,
  type Tileset,
} from '@safehouse/rules';
import { httpError } from '../services/auth.js';
import { ScenesService, serializeScene } from '../services/scenes.js';
import { ROOM_KINDS } from './geometry.js';
import {
  LlmClient,
  constrainedEffort,
  type ChatMessage,
  type ChatOptions,
  type ChatTurn,
  type LlmConfig,
  type LlmUsage,
  type ModelSlot,
} from './llm.js';
import { coerceFloorPlan, cutOffError, repairJson, schemaMissError } from './repair.js';
import { usageMeter } from './usage.js';
import { describeKeys, parseModelJson, unwrapEnvelope } from './vision.js';

const FLOOR_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// What the model answers with
// ---------------------------------------------------------------------------

const Square = z.number().int().min(0).max(998);

export const FloorPropSchema = z.object({
  tile: z.string().min(1).max(60).describe('A tile id from the interior or decoration palette'),
  x: Square.describe('Column, in grid squares from the left of the grid'),
  y: Square.describe('Row, in grid squares from the top of the grid'),
});

export const FloorRoomSchema = z.object({
  name: z.string().min(1).max(60).describe('Short room name, unique within the floor'),
  kind: z.enum(ROOM_KINDS).default('room'),
  x: Square.describe('Left edge (the west wall), in grid squares'),
  y: Square.describe('Top edge (the north wall), in grid squares'),
  w: z.number().int().min(2).max(999).describe('Width in squares, walls included'),
  h: z.number().int().min(2).max(999).describe('Height in squares, walls included'),
  floor: z.string().max(60).optional().describe('A ground tile id from the palette; omit for the default floor'),
  props: z.array(FloorPropSchema).max(80).default([]),
});
export type FloorRoom = z.infer<typeof FloorRoomSchema>;

export const FloorOpeningSchema = z.object({
  room: z.string().min(1).max(60).describe('Name of a room in this plan'),
  wall: z.enum(['n', 's', 'e', 'w']).describe('Which wall of that room the opening is in'),
  offset: Square.default(1).describe('Squares along that wall from its top/left end; never 0 (a corner)'),
  width: z.number().int().min(1).max(20).default(1).describe('Opening width in squares'),
  kind: z.enum(['door', 'window']).default('door'),
});
export type FloorOpening = z.infer<typeof FloorOpeningSchema>;

export const FloorStairSchema = z.object({
  x: Square,
  y: Square,
  direction: z.enum(['up', 'down']),
});

/**
 * A patch of other ground outside the rooms: the harbour below a quay, the
 * pond in a park, the row of beach front along it, a pier of boards reaching
 * into the water, a lawn, a road.
 *
 * One ground tile for the whole outside was enough for a warehouse in a car
 * park and useless at the water's edge — "a dock with a pier out into the
 * harbour" is at least three grounds, and the renderer only draws a quay wall,
 * a pier's pilings or a beach running under when the water and the land are
 * painted side by side (`stage/water.ts`). Areas are the plan's way to say so.
 * Unlike a room an area has no walls, so one square wide is a legal area: that
 * is exactly what a row of pier wall along the water is.
 */
export const FloorAreaSchema = z.object({
  ground: z
    .string()
    .min(1)
    .max(60)
    .describe('A ground tile id from the palette for this patch: water, a beach front or pier wall along it, pier boards, a lawn, a road'),
  x: Square.describe('Left edge, in grid squares'),
  y: Square.describe('Top edge, in grid squares'),
  w: z.number().int().min(1).max(999).describe('Width in squares; 1 is a single row or column'),
  h: z.number().int().min(1).max(999).describe('Height in squares; 1 is a single row or column'),
});
export type FloorArea = z.infer<typeof FloorAreaSchema>;

/**
 * Everything that is not a room. A first draft used to leave the rest of the
 * grid unpainted — a building floating in black — so the GM's second job was
 * always "fill in the outside by hand". Now the plan says what the outside
 * is made of, where it changes, and what lies about on it, and the compiler
 * paints every square of the grid on the first pass.
 */
export const FloorOutsideSchema = z.object({
  ground: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe('A ground tile id from the palette for the land everything outside the rooms and areas stands on: asphalt, a quay, grass, a gravel path'),
  areas: z
    .array(FloorAreaSchema)
    .max(40)
    .default([])
    .describe('Patches of other ground outside the rooms, painted in order so a later area lies on top of an earlier one: water, a row of beach front or pier wall along it, a pier into it. Rooms are built over areas'),
  scatter: z
    .array(z.string().min(1).max(60))
    .max(12)
    .default([])
    .describe('Decoration tile ids that belong outside; the builder scatters a few on the ground each one fits, and puts nothing on water that does not float there'),
});

export const FloorPlanSchema = z.object({
  title: z.string().min(1).max(120),
  rooms: z.array(FloorRoomSchema).min(1).max(60),
  openings: z.array(FloorOpeningSchema).max(200).default([]),
  stairs: z.array(FloorStairSchema).max(20).default([]),
  // Zod 4: a default is the OUTPUT and is not parsed, so it spells out every
  // defaulted field of the outside.
  outside: FloorOutsideSchema.default({ areas: [], scatter: [] }),
  notes: z.string().max(2000).default(''),
});
export type FloorPlan = z.infer<typeof FloorPlanSchema>;
export type FloorPlanInput = z.input<typeof FloorPlanSchema>;

/**
 * A plan the chat is still drawing (chat/floor-draft.ts): the same plan, but
 * it may have no rooms yet — a floor that has only been started is just its
 * outside ground.
 */
export const DraftPlanSchema = FloorPlanSchema.extend({
  rooms: z.array(FloorRoomSchema).max(60).default([]),
});

/**
 * The first pass: the building without its furniture. Everything the plan
 * says except the props — which is most of what used to make a plan long
 * enough to be cut off.
 */
export const FloorSkeletonSchema = FloorPlanSchema.extend({
  rooms: z.array(FloorRoomSchema.omit({ props: true })).min(1).max(60),
});

/** The second pass, a few rooms at a time: just their furniture. */
export const FloorFurnishSchema = z.object({
  rooms: z
    .array(
      z.object({
        name: z.string().min(1).max(60).describe('The room, by the name it was given'),
        props: z.array(FloorPropSchema).max(80).default([]),
      }),
    )
    .max(20),
});

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete json['$schema'];
  return json;
}

export function floorPlanJsonSchema(): Record<string, unknown> {
  const json = z.toJSONSchema(FloorPlanSchema, { io: 'input' }) as Record<string, unknown>;
  delete json['$schema'];
  return json;
}

// ---------------------------------------------------------------------------
// Compilation: rooms → squares
// ---------------------------------------------------------------------------

export interface CompiledFloor {
  title: string;
  notes: string;
  tilesetId: string;
  rooms: Array<{ name: string; kind: string; rect: { x: number; y: number; w: number; h: number } }>;
  /** Slots, keyed `"col,row"` — exactly what `POST /api/scenes/:id/tiles` takes as `paint`. */
  layers: {
    ground: Record<string, string>;
    structure: Record<string, string>;
    object: Record<string, string>;
  };
  counts: {
    floor: number;
    wall: number;
    door: number;
    window: number;
    /** Props the plan placed by hand, inside rooms. */
    prop: number;
    stair: number;
    /** Squares outside every room, painted with the outside ground or an area's. */
    outside: number;
    /** Areas of other ground that were painted (dropped ones are warnings). */
    areas: number;
    /** Decoration the compiler scattered across the outside. */
    scatter: number;
    /** Furniture the compiler added to rooms the plan left bare. */
    dressed: number;
  };
  warnings: string[];
}

const key = (col: number, row: number): string => `${col},${row}`;
const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/**
 * A small deterministic generator (mulberry32) seeded from the plan, so the
 * same plan on the same grid scatters the same props — a rebuild must not
 * reshuffle a map the GM has already looked at.
 */
function prng(seedText: string): () => number {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i += 1) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ground tiles that read as "outside" by their ids and names, in order of preference. */
const OUTSIDE_WORDS = [
  'road', 'asphalt', 'street', 'pavement', 'walk', 'setts', 'paving', 'yard', 'track', 'path', 'grass', 'lawn',
  'meadow', 'shore', 'quay', 'planking', 'jetty', 'harbour', 'deep', 'alley', 'dirt', 'gravel', 'rubble', 'lot',
];

/** The set's best guess at an outside ground when the plan names none. */
export function outsideGroundFor(set: Tileset): Tile | null {
  const grounds = set.tiles.filter((t) => categoryOf(t) === 'ground' && t.emissive === undefined && t.connects === undefined);
  // Whole words only: "catwalk" is not a walk, and a "sludge channel" is not
  // a road. The id and the name are searched together.
  for (const word of OUTSIDE_WORDS) {
    const re = new RegExp(`\\b${word}\\b`);
    const hit = grounds.find((t) => re.test(`${t.id} ${t.name.toLowerCase()}`));
    if (hit) return hit;
  }
  return grounds[0] ?? null;
}

/** One prop per this many floor squares is "dressed"; below it a room is bare. */
const DRESS_PER_SQUARES = 12;
/** One scattered decoration per this many outside squares. */
const SCATTER_PER_SQUARES = 16;
const SCATTER_MAX = 80;

/**
 * Pure and deterministic: the same plan on the same grid with the same set
 * always paints the same squares. Everything the model got wrong is a
 * warning the GM reads, never a silent fix.
 */
export function compileFloorPlan(
  raw: FloorPlanInput,
  grid: { cols: number; rows: number },
  set: Tileset,
  /**
   * `draft`: a plan the chat is drawing one edit at a time. It may have no
   * rooms yet, and the compiler adds nothing of its own — no furniture in a
   * bare room, no scatter the plan did not name — because the Fixer is still
   * going, and furniture that appears and vanishes between edits is noise.
   */
  opts: { draft?: boolean } = {},
): CompiledFloor {
  const plan = opts.draft ? DraftPlanSchema.parse(raw) : FloorPlanSchema.parse(raw);
  const warnings: string[] = [];
  const ground: Record<string, string> = {};
  const structure: Record<string, string> = {};
  const object: Record<string, string> = {};
  const counts = { floor: 0, wall: 0, door: 0, window: 0, prop: 0, stair: 0, outside: 0, areas: 0, scatter: 0, dressed: 0 };

  const grounds = set.tiles.filter((t) => categoryOf(t) === 'ground');
  const defaultFloor = (grounds[0] && toSlot(set, grounds[0].id)) ?? 'ground/1';
  const WALL = 'building/wall';
  const DOOR = 'building/door';
  const WINDOW = tileBySlot(set, 'building/window') ? 'building/window' : WALL;

  const rooms: CompiledFloor['rooms'] = [];
  const byName = new Map<string, CompiledFloor['rooms'][number]>();
  /** Floor squares that are not a wall — where props and stairs may stand. */
  const interior = new Set<string>();

  for (const room of plan.rooms) {
    const x = clamp(room.x, 0, grid.cols - 1);
    const y = clamp(room.y, 0, grid.rows - 1);
    const w = Math.min(room.w, grid.cols - x);
    const h = Math.min(room.h, grid.rows - y);
    if (w < 2 || h < 2) {
      warnings.push(`room "${room.name}" falls outside the ${grid.cols}x${grid.rows} grid — dropped`);
      continue;
    }
    if (x !== room.x || y !== room.y || w !== room.w || h !== room.h) {
      warnings.push(
        `room "${room.name}" clamped to the grid: ${room.w}x${room.h} at ${room.x},${room.y} → ${w}x${h} at ${x},${y}`,
      );
    }
    let floorSlot = defaultFloor;
    if (room.floor) {
      const tile = resolveTile(set, room.floor);
      if (tile && categoryOf(tile) === 'ground') floorSlot = toSlot(set, tile.id) ?? defaultFloor;
      else warnings.push(`room "${room.name}": "${room.floor}" is not a ground tile in ${set.name} — default floor used`);
    }
    for (let c = x; c < x + w; c += 1) {
      for (let r = y; r < y + h; r += 1) {
        const k = key(c, r);
        ground[k] = floorSlot;
        const edge = c === x || c === x + w - 1 || r === y || r === y + h - 1;
        if (edge) {
          if (structure[k] === undefined) structure[k] = WALL;
        } else {
          interior.add(k);
        }
      }
    }
    const compiled = { name: room.name, kind: room.kind, rect: { x, y, w, h } };
    rooms.push(compiled);
    const lower = room.name.toLowerCase();
    if (byName.has(lower)) warnings.push(`two rooms are called "${room.name}" — openings will attach to the first`);
    else byName.set(lower, compiled);
  }
  if (rooms.length === 0 && (plan.rooms.length > 0 || !opts.draft)) {
    warnings.push('no room survived clamping — nothing to build');
  }

  // Two rooms that share a wall overlap by one square; more than that is a
  // room inside a room, which the GM should hear about.
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i]!.rect;
      const b = rooms[j]!.rect;
      const ow = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ow > 1 && oh > 1) {
        warnings.push(`"${rooms[i]!.name}" and "${rooms[j]!.name}" overlap by ${ow}x${oh} squares`);
      }
    }
  }

  for (const opening of plan.openings) {
    const room = byName.get(opening.room.toLowerCase());
    if (!room) {
      warnings.push(`${opening.kind} on unknown room "${opening.room}" — dropped`);
      continue;
    }
    const { x, y, w, h } = room.rect;
    const horizontal = opening.wall === 'n' || opening.wall === 's';
    const length = horizontal ? w : h;
    if (length < 3) {
      warnings.push(`${opening.kind} on "${room.name}" (${opening.wall}): that wall has no square between its corners — dropped`);
      continue;
    }
    // Corners are never openings: the run is squares 1 … length-2 of the wall.
    const offset = clamp(opening.offset, 1, length - 2);
    const width = clamp(opening.width, 1, length - 1 - offset);
    if (offset !== opening.offset || width !== opening.width) {
      warnings.push(
        `${opening.kind} on "${room.name}" (${opening.wall}) snapped onto the wall: offset ${opening.offset}→${offset}, width ${opening.width}→${width}`,
      );
    }
    const slot = opening.kind === 'door' ? DOOR : WINDOW;
    for (let i = 0; i < width; i += 1) {
      const c = horizontal ? x + offset + i : opening.wall === 'w' ? x : x + w - 1;
      const r = horizontal ? (opening.wall === 'n' ? y : y + h - 1) : y + offset + i;
      structure[key(c, r)] = slot;
    }
    counts[opening.kind] += width;
  }

  for (const room of plan.rooms) {
    const compiled = byName.get(room.name.toLowerCase());
    if (!compiled) continue;
    for (const prop of room.props) {
      const tile = resolveTile(set, prop.tile);
      const category = tile ? categoryOf(tile) : null;
      if (!tile || (category !== 'interior' && category !== 'decoration')) {
        warnings.push(`"${prop.tile}" is not a prop in ${set.name} — dropped from "${room.name}"`);
        continue;
      }
      const k = key(prop.x, prop.y);
      if (!interior.has(k)) {
        warnings.push(`${tile.name} at ${prop.x},${prop.y} is not on a floor square inside "${room.name}" — dropped`);
        continue;
      }
      if (object[k] !== undefined) {
        warnings.push(`two props on square ${prop.x},${prop.y} — ${tile.name} dropped`);
        continue;
      }
      object[k] = toSlot(set, tile.id) ?? tile.id;
      counts.prop += 1;
    }
  }

  for (const stair of plan.stairs) {
    const slot = `stairs/${stair.direction}`;
    const tile = tileBySlot(set, slot);
    if (!tile) {
      warnings.push(`${set.name} has no ${stair.direction} stairs — dropped`);
      continue;
    }
    const k = key(stair.x, stair.y);
    if (!interior.has(k)) {
      warnings.push(`stairs ${stair.direction} at ${stair.x},${stair.y} are not on a floor square — dropped`);
      continue;
    }
    const layer = layerOf(tile);
    const target = layer === 'ground' ? ground : layer === 'structure' ? structure : object;
    target[k] = slot;
    counts.stair += 1;
  }

  // --- The outside: every square not inside a room is painted too ------------
  // A first draft used to stop at the walls and leave the rest of the grid
  // black. The plan names the outside ground (or the set's best guess) and
  // the areas of other ground on it; the compiler paints them edge to edge,
  // then scatters the decoration that belongs on each — clear of doors, so
  // nothing blocks a way in.
  const outsideCells: string[] = [];
  let outsideTile: Tile | null = null;
  if (plan.outside.ground) {
    const named = resolveTile(set, plan.outside.ground);
    if (named && categoryOf(named) === 'ground') outsideTile = named;
    else warnings.push(`"${plan.outside.ground}" is not a ground tile in ${set.name} — the outside uses the set's own`);
  }
  outsideTile ??= outsideGroundFor(set);

  // Areas, in order, so a later one lies on top: a pier over the water it
  // reaches into. Rooms were painted first and keep their squares, which is
  // the same thing as building them over the areas.
  const areaAt = new Map<string, Tile>();
  plan.outside.areas.forEach((area, i) => {
    const label = `area ${i + 1} (${area.ground})`;
    const tile = resolveTile(set, area.ground);
    if (!tile || categoryOf(tile) !== 'ground') {
      warnings.push(`${label}: "${area.ground}" is not a ground tile in ${set.name} — dropped, the outside ground shows there`);
      return;
    }
    if (area.x >= grid.cols || area.y >= grid.rows) {
      warnings.push(`${label} falls outside the ${grid.cols}x${grid.rows} grid — dropped`);
      return;
    }
    const w = Math.min(area.w, grid.cols - area.x);
    const h = Math.min(area.h, grid.rows - area.y);
    if (w !== area.w || h !== area.h) {
      warnings.push(`${label} clamped to the grid: ${area.w}x${area.h} at ${area.x},${area.y} → ${w}x${h} at ${area.x},${area.y}`);
    }
    for (let c = area.x; c < area.x + w; c += 1) {
      for (let r = area.y; r < area.y + h; r += 1) areaAt.set(key(c, r), tile);
    }
    counts.areas += 1;
  });

  /** The ground tile of each outside square — what the scatter asks of it. */
  const outsideGround = new Map<string, Tile | null>();
  for (let c = 0; c < grid.cols; c += 1) {
    for (let r = 0; r < grid.rows; r += 1) {
      const k = key(c, r);
      if (ground[k] !== undefined) continue;
      const tile = areaAt.get(k) ?? outsideTile;
      ground[k] = tile ? (toSlot(set, tile.id) ?? defaultFloor) : defaultFloor;
      outsideGround.set(k, tile);
      outsideCells.push(k);
    }
  }
  counts.outside = outsideCells.length;

  const rand = prng(`${plan.title}|${grid.cols}x${grid.rows}|${set.id}`);
  const doorCells = new Set(Object.entries(structure).filter(([, s]) => s === DOOR).map(([k]) => k));
  const nearDoor = (c: number, r: number): boolean => {
    for (let dc = -1; dc <= 1; dc += 1) for (let dr = -1; dr <= 1; dr += 1) if (doorCells.has(key(c + dc, r + dr))) return true;
    return false;
  };
  const nearWall = (c: number, r: number): boolean => {
    for (let dc = -1; dc <= 1; dc += 1) for (let dr = -1; dr <= 1; dr += 1) if (structure[key(c + dc, r + dr)] !== undefined) return true;
    return false;
  };

  // What may lie about outside: the plan's list, else every decoration the
  // set has that is not a light and does not want a wall at its back. Each
  // square is asked about its OWN ground — the outside is not one ground any
  // more — so a bench lands on the quay, a buoy only on the harbour it is
  // meant for, and nothing that does not float goes in the water.
  const named = [...new Set(plan.outside.scatter)]
    .map((id) => resolveTile(set, id))
    .filter((t): t is Tile => t !== null && (categoryOf(t) === 'decoration' || categoryOf(t) === 'interior'));
  for (const id of plan.outside.scatter) {
    if (!resolveTile(set, id)) warnings.push(`"${id}" is not a tile in ${set.name} — left out of the scatter`);
  }
  const fits = (t: Tile, g: Tile | null): boolean =>
    t.placement?.on && t.placement.on.length > 0 ? g !== null && t.placement.on.includes(g.id) : g?.liquid === undefined;
  const fitsSomewhere = (t: Tile): boolean => [...outsideGround.values()].some((g) => fits(t, g));
  // Only a real mismatch is worth the GM's attention: a floor whose rooms
  // fill the grid has no outside at all, and every tile "fits nowhere" there.
  for (const t of outsideCells.length > 0 ? named : []) {
    if (!fitsSomewhere(t)) {
      warnings.push(`${t.name} fits none of the ground outside (it stands on ${t.placement?.on?.join('/') ?? 'dry ground'}) — left out of the scatter`);
    }
  }
  const scatterPool = (
    named.length > 0
      ? named
      : opts.draft
        ? []
        : set.tiles.filter((t) => categoryOf(t) === 'decoration' && t.emissive === undefined && !t.placement?.againstWall)
  ).filter(fitsSomewhere);
  // How much to scatter comes from the squares something can stand on, not
  // from the whole outside: a grid that is mostly harbour must not pack all
  // of its decoration onto the strip of quay that is left.
  const standable = outsideCells.filter((k) => scatterPool.some((t) => fits(t, outsideGround.get(k) ?? null)));
  if (scatterPool.length > 0 && standable.length > 0) {
    const want = Math.min(SCATTER_MAX, Math.floor(standable.length / SCATTER_PER_SQUARES));
    const order = [...standable].sort(() => rand() - 0.5);
    for (const k of order) {
      if (counts.scatter >= want) break;
      const [c, r] = k.split(',').map(Number) as [number, number];
      if (object[k] !== undefined || structure[k] !== undefined || nearDoor(c, r)) continue;
      const g = outsideGround.get(k) ?? null;
      const fitting = scatterPool.filter((t) => fits(t, g));
      const tile = fitting[Math.floor(rand() * fitting.length)]!;
      object[k] = toSlot(set, tile.id) ?? tile.id;
      counts.scatter += 1;
    }
  }

  // --- Dressing: a room the plan left bare gets its furniture ----------------
  // One prop per twelve floor squares is the line; below it the room reads as
  // a box. Things that want a wall at their back go along the walls, the rest
  // in the open, and never in front of a door.
  const furniture = set.tiles.filter((t) => categoryOf(t) === 'interior' && t.emissive === undefined && !t.placement?.on);
  const wallSide = furniture.filter((t) => t.placement?.againstWall === true);
  const open = furniture.filter((t) => t.placement?.againstWall !== true && t.footprint !== 'wall');
  if (furniture.length > 0 && !opts.draft) {
    for (const room of rooms) {
      const { x, y, w, h } = room.rect;
      const cells: string[] = [];
      for (let c = x + 1; c < x + w - 1; c += 1) for (let r = y + 1; r < y + h - 1; r += 1) cells.push(key(c, r));
      const have = cells.filter((k) => object[k] !== undefined || structure[k] !== undefined).length;
      let need = Math.floor(cells.length / DRESS_PER_SQUARES) - have;
      if (need <= 0) continue;
      const free = cells.filter((k) => {
        const [c, r] = k.split(',').map(Number) as [number, number];
        return object[k] === undefined && structure[k] === undefined && !nearDoor(c, r);
      });
      const byWall = free.filter((k) => {
        const [c, r] = k.split(',').map(Number) as [number, number];
        return nearWall(c, r);
      });
      const inOpen = free.filter((k) => !byWall.includes(k));
      const pick = (pool: string[], from: Tile[]): boolean => {
        if (pool.length === 0 || from.length === 0) return false;
        const k = pool.splice(Math.floor(rand() * pool.length), 1)[0]!;
        const tile = from[Math.floor(rand() * from.length)]!;
        object[k] = toSlot(set, tile.id) ?? tile.id;
        counts.dressed += 1;
        need -= 1;
        return true;
      };
      while (need > 0) {
        // Alternate: something against the wall, then something in the room.
        const first = wallSide.length > 0 ? pick(byWall, wallSide) : false;
        const second = need > 0 ? pick(inOpen, open.length > 0 ? open : furniture) : false;
        if (!first && !second) {
          // Nothing left that fits the rule: use whatever square and piece remain.
          if (!pick(free.filter((k) => object[k] === undefined), furniture)) break;
        }
      }
    }
  }

  counts.floor = Object.keys(ground).length;
  counts.wall = Object.values(structure).filter((s) => s === WALL).length;

  return {
    title: plan.title,
    notes: plan.notes,
    tilesetId: set.id,
    rooms,
    layers: { ground, structure, object },
    counts,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// The ask
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You lay out one floor of a tabletop battle map for a Shadowrun 5th Edition game master, from their description.',
  'Answer with JSON only, matching the schema you are given. No prose, no markdown fence.',
  '',
  'Rules:',
  '1. Everything is measured in WHOLE GRID SQUARES from the top-left of the grid: x to the right, y downwards. Stay inside the grid you are given.',
  '2. A room is an axis-aligned rectangle that INCLUDES its walls: the outer ring of squares is wall, everything inside is floor. A room is at least 3x3; a 5x4 room has 3x2 squares of floor.',
  '3. Neighbouring rooms share their wall squares: place the next room so its rectangle overlaps the neighbour by exactly one square along the shared wall. A corridor is a room too — a long, thin one.',
  "4. Doors and windows are openings in a named room's wall: which wall (n, s, e, w), how many squares along from that wall's top or left end, how wide. Never at a corner (offset 0). Every room the runners are meant to enter needs a door, and two rooms that share a wall need a door in it.",
  '5. Floor and prop tiles come ONLY from the palette in the request — use the ids exactly as written. Props stand on floor squares inside a room, never on a wall, one per square, and only where the description calls for furniture or dressing.',
  '6. Stairs go on a floor square inside a room, only if the description asks for another floor.',
  '7. Prefer fewer, larger, correct rooms — and EVERY square of the grid ends up painted. Rooms cover what is built. "outside.ground" names the land everything else stands on (asphalt, a quay, grass — whatever the description implies). "outside.areas" are rectangles of OTHER ground outside the rooms, painted in order so a later area lies on top of an earlier one: the water of a harbour or a pond, a one-square row of beach front or pier wall along the water\'s edge, a pier as a thin area of pier boards reaching into the water, a lawn, a road. Rooms are built over areas. "outside.scatter" lists a few decoration ids that belong outside; the builder scatters each on ground it fits and never puts anything on water that does not float there.',
  '   Example of areas (these ids are from a marina palette — always use the ids in YOUR palette): a 30x20 grid with the harbour to the south is outside.ground "quay" with areas [{"ground":"harbour","x":0,"y":12,"w":30,"h":8},{"ground":"pierwall","x":0,"y":11,"w":30,"h":1},{"ground":"planking","x":13,"y":11,"w":3,"h":6}] — the pier comes after the water, so it lies on top of it and stops short of the far edge.',
  '8. Dress every room: at least one prop per ten floor squares, chosen for what the room is — furniture against the walls, the rest in the open, nothing in front of a door. A bare room is a mistake.',
  '9. Name rooms the way a GM says them out loud ("loading dock", "break room"); the GM reads those names back.',
].join('\n');

/**
 * The skeleton pass is told the same rules, less the one that made a plan
 * long: the furniture comes afterwards, room by room, in calls of its own.
 */
const SKELETON_SYSTEM = SYSTEM_PROMPT.replace(
  /\n8\. Dress every room:[^\n]*/,
  '\n8. Do NOT place props: leave every room empty. Furniture is placed afterwards, a few rooms at a time.',
);

const FURNISH_SYSTEM = [
  'You furnish rooms of a tabletop battle map floor for a Shadowrun 5th Edition game master. The rooms are already laid out; you only place props in them.',
  'Answer with JSON only, matching the schema you are given. No prose, no markdown fence.',
  '',
  'Rules:',
  '1. Coordinates are WHOLE GRID SQUARES from the top-left of the grid: x to the right, y downwards.',
  "2. A prop stands on one of the room's FLOOR squares — the ranges you are given — never on its wall ring, one prop per square.",
  '3. Prop tiles come ONLY from the interior and decoration palette — use the ids exactly as written. A tile marked "against a wall" goes on a floor square next to a wall.',
  '4. Never in front of a door: leave the square just inside every door clear.',
  '5. About one prop per ten floor squares, chosen for what the room is. Name every room you were given, by its name, even if you leave one bare.',
].join('\n');

/** The palette as the model reads it — exported so what it is told can be pinned. */
export function floorPalette(set: Tileset): string {
  // Each tile with the one fact the model needs to place it: what it stands
  // on, whether it wants a wall at its back.
  const where = (t: Tile): string => {
    const bits: string[] = [];
    if (t.placement?.on && t.placement.on.length > 0) bits.push(`on ${t.placement.on.join('/')}`);
    if (t.placement?.againstWall) bits.push('against a wall');
    if (t.emissive) bits.push('a light');
    // Water and the edges of it: the renderer draws painted water as one body
    // and drops the land beside it to the waterline, so the model should know
    // which squares are water and which ground makes a beach or a pier wall.
    if (t.liquid) bits.push(`${t.liquid} water`);
    if (t.shore === 'beach') bits.push('runs into water as a beach');
    if (t.shore === 'pier') bits.push('meets water as a pier wall');
    if (t.shore === 'quay') bits.push('meets water as a quay wall');
    return bits.length > 0 ? ` (${bits.join(', ')})` : '';
  };
  const list = (category: string) =>
    set.tiles
      .filter((t) => categoryOf(t) === category)
      .map((t) => `  ${t.id} — ${t.name}${where(t)}`)
      .join('\n');
  const stairs = set.tiles.some((t) => categoryOf(t) === 'stairs');
  const outside = outsideGroundFor(set);
  return [
    `Tileset: ${set.name}.`,
    'Ground tiles (a room\'s "floor", "outside.ground", and an area\'s "ground"):',
    list('ground'),
    'Interior tiles (furniture — a prop\'s "tile"):',
    list('interior'),
    'Decoration tiles (dressing — a prop\'s "tile", and "outside.scatter"):',
    list('decoration'),
    stairs ? 'Stairs up and down are available.' : 'This set has no stairs; leave "stairs" empty.',
    outside ? `If you name no "outside.ground", the builder uses ${outside.id} (${outside.name}).` : '',
  ].join('\n');
}

function userPrompt(
  scene: { name: string; grid: { cols: number; rows: number; unitM: number } },
  level: number,
  set: Tileset,
  painted: number,
  description: string,
): string {
  return [
    `Scene: "${scene.name}", floor ${level === 0 ? 'ground (0)' : level}.`,
    `The grid is ${scene.grid.cols} squares wide and ${scene.grid.rows} tall, ${scene.grid.unitM} m per square.`,
    painted > 0
      ? `This floor already has ${painted} painted squares; your plan is laid on top of them, so leave room or say what you replace.`
      : 'This floor is empty.',
    '',
    floorPalette(set),
    '',
    `The GM describes the floor: ${description.trim()}`,
    '',
    'Return the floor plan as JSON.',
  ].join('\n');
}

export interface FloorAsk {
  campaignId: string;
  sceneId: string;
  level: number;
  tilesetId: string;
  prompt: string;
  slot?: ModelSlot | undefined;
  signal?: AbortSignal | undefined;
}

export interface FloorResult {
  plan: CompiledFloor;
  /** The model's answer as it came, for the GM's paper trail. */
  raw: FloorPlan;
  level: number;
  model: string;
  usage: LlmUsage;
  latencyMs: number;
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/** Floor squares a batch of rooms may add up to before it is split. */
const FURNISH_BATCH_SQUARES = 100;
const FURNISH_BATCH_ROOMS = 3;

type SkeletonRoom = FloorPlan['rooms'][number];

/** A room's floor squares: its rectangle less the wall ring. */
function floorSquares(room: SkeletonRoom): number {
  return Math.max(0, room.w - 2) * Math.max(0, room.h - 2);
}

/** Rooms in batches small enough that their furniture fits in one short answer. */
export function furnishBatches(rooms: readonly SkeletonRoom[]): SkeletonRoom[][] {
  const batches: SkeletonRoom[][] = [];
  let batch: SkeletonRoom[] = [];
  let squares = 0;
  for (const room of rooms) {
    const n = floorSquares(room);
    if (n === 0) continue;
    if (batch.length > 0 && (batch.length >= FURNISH_BATCH_ROOMS || squares + n > FURNISH_BATCH_SQUARES)) {
      batches.push(batch);
      batch = [];
      squares = 0;
    }
    batch.push(room);
    squares += n;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** One room as the furnishing pass reads it: where its floor is, where its doors are. */
function describeRoom(room: SkeletonRoom, openings: FloorPlan['openings']): string {
  const doors = openings
    .filter((o) => o.room === room.name)
    .map((o) => `${o.kind} on the ${({ n: 'north', s: 'south', e: 'east', w: 'west' } as const)[o.wall]} wall at ${o.offset}${o.width > 1 ? `, ${o.width} wide` : ''}`);
  return [
    `- "${room.name}" (${room.kind}): walls x ${room.x}..${room.x + room.w - 1}, y ${room.y}..${room.y + room.h - 1};`,
    `  floor squares x ${room.x + 1}..${room.x + room.w - 2}, y ${room.y + 1}..${room.y + room.h - 2}`,
    doors.length > 0 ? `; ${doors.join('; ')}` : '',
  ].join('');
}

interface FurnishResult {
  plan: FloorPlan;
  usage: LlmUsage;
  latencyMs: number;
  warnings: string[];
}

/**
 * Furniture for every room, a batch at a time.
 *
 * Each call asks only for the props of a few rooms, so no single answer is
 * long enough to run out of room. A batch that is cut off anyway is split in
 * half and asked again; a single room that still will not fit is left to the
 * compiler's own dressing (`compileFloorPlan` furnishes a bare room from the
 * palette), with a warning — one room without chosen furniture is not worth
 * failing a whole floor over.
 */
async function furnishRooms(
  client: LlmClient,
  req: { model: string; effort: AiEffort },
  opts: ChatOptions,
  skeleton: FloorPlan,
  set: Tileset,
  description: string,
): Promise<FurnishResult> {
  const palette = floorPalette(set);
  const props = new Map<string, FloorPlan['rooms'][number]['props']>();
  const warnings: string[] = [];
  let usage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let latencyMs = 0;

  const ask = async (rooms: SkeletonRoom[]): Promise<void> => {
    const messages: ChatMessage[] = [
      { role: 'system', content: FURNISH_SYSTEM },
      {
        role: 'user',
        content: [
          `The floor is: ${description.trim()}`,
          '',
          palette,
          '',
          'Furnish these rooms:',
          ...rooms.map((r) => describeRoom(r, skeleton.openings)),
          '',
          `Schema:\n${JSON.stringify(jsonSchemaOf(FloorFurnishSchema))}`,
        ].join('\n'),
      },
    ];
    // Cancelled, or the box went quiet: that is the whole floor's problem, so it throws.
    const turn: ChatTurn = await client.chat({ model: req.model, messages, temperature: 0.4, effort: req.effort }, opts);
    usage = addUsage(usage, turn.usage);
    latencyMs += turn.latencyMs;
    const cutOff = turn.finishReason === 'length' && !/\}\s*$/.test(turn.content.trim());
    if (cutOff) {
      if (rooms.length > 1) {
        const half = Math.ceil(rooms.length / 2);
        await ask(rooms.slice(0, half));
        await ask(rooms.slice(half));
        return;
      }
      warnings.push(`"${rooms[0]!.name}": its furniture ran too long to place — the builder dressed it instead`);
      return;
    }
    let parsed: unknown;
    try {
      parsed = unwrapEnvelope(parseModelJson(turn.content, 'the furniture'), 'rooms');
    } catch {
      warnings.push(`${rooms.map((r) => `"${r.name}"`).join(', ')}: the furniture came back unreadable — the builder dressed ${rooms.length === 1 ? 'it' : 'them'} instead`);
      return;
    }
    const checked = FloorFurnishSchema.safeParse(parsed);
    if (!checked.success) {
      warnings.push(`${rooms.map((r) => `"${r.name}"`).join(', ')}: the furniture did not fit the schema — the builder dressed ${rooms.length === 1 ? 'it' : 'them'} instead`);
      return;
    }
    const wanted = new Set(rooms.map((r) => r.name));
    for (const r of checked.data.rooms) {
      if (wanted.has(r.name)) props.set(r.name, r.props);
    }
  };

  for (const batch of furnishBatches(skeleton.rooms)) await ask(batch);

  return {
    plan: { ...skeleton, rooms: skeleton.rooms.map((r) => ({ ...r, props: props.get(r.name) ?? r.props ?? [] })) },
    usage,
    latencyMs,
    warnings,
  };
}

/**
 * A floor in two passes: the building, then its furniture a few rooms at a
 * time — so no one answer is long enough to be cut off.
 */
export async function proposeFloor(db: Db, config: LlmConfig | null, ask: FloorAsk): Promise<FloorResult> {
  if (!config) {
    throw httpError(
      503,
      'ai_disabled',
      'the Fixer is switched off: set LLM_BASE_URL to point at an OpenAI-compatible server',
    );
  }
  const service = new ScenesService(db);
  const row = await service.sceneRow(ask.sceneId).catch(() => null);
  if (!row || row.campaignId !== ask.campaignId) throw httpError(404, 'not_found', 'no such scene');
  const scene = serializeScene(row);
  const floors = 1 + (scene.levels ?? []).length;
  if (ask.level >= floors) {
    throw httpError(400, 'bad_request', `this scene has ${floors} floor${floors === 1 ? '' : 's'}; there is no level ${ask.level}`);
  }
  const set = tilesetById(ask.tilesetId);
  if (!set) throw httpError(400, 'unknown_tileset', `no such tileset: ${ask.tilesetId}`);
  const tiles = ask.level === 0 ? scene.tiles : scene.levels?.[ask.level - 1]?.tiles;
  const painted = tiles
    ? Object.keys(tiles.ground ?? {}).length +
      Object.keys(tiles.structure ?? {}).length +
      Object.keys(tiles.object ?? {}).length
    : 0;

  const client = new LlmClient(config);
  const model = ask.slot === 'fast' ? config.fast : config.primary;
  const opts = { timeoutMs: FLOOR_TIMEOUT_MS, ...(ask.signal ? { signal: ask.signal } : {}) };
  const effort = constrainedEffort(config);

  // --- Pass 1: the building, without its furniture ---------------------------
  // One answer for every room with its furniture was the plan that kept being
  // cut off: most of its length was props. The skeleton is small and reliable.
  const messages: ChatMessage[] = [
    { role: 'system', content: SKELETON_SYSTEM },
    {
      role: 'user',
      content: `${userPrompt(scene, ask.level, set, painted, ask.prompt)}\n\nSchema:\n${JSON.stringify(jsonSchemaOf(FloorSkeletonSchema))}`,
    },
  ];
  // No output limit: a floor is as long as the model needs to write it.
  const turn = await client.chat({ model, messages, temperature: 0.2, effort }, opts);
  if (turn.finishReason === 'length' && !/\}\s*$/.test(turn.content.trim())) {
    throw cutOffError('the floor plan', turn, effort);
  }
  const parsed = unwrapEnvelope(parseModelJson(turn.content, 'the floor plan'), 'rooms');
  // Bend the numbers and the names into bounds first; if the schema still
  // says no, one correction turn with the issues by path (fixer/repair.ts).
  let checked = FloorPlanSchema.safeParse(coerceFloorPlan(parsed, ROOM_KINDS));
  let usage = turn.usage;
  let latencyMs = turn.latencyMs;
  if (!checked.success) {
    const repaired = await repairJson(
      client,
      { model, effort },
      opts,
      { messages, badContent: turn.content, issues: checked.error.issues, what: 'the floor plan', mustHave: 'rooms' },
    );
    usage = addUsage(usage, repaired.turn.usage);
    latencyMs += repaired.turn.latencyMs;
    checked = FloorPlanSchema.safeParse(coerceFloorPlan(repaired.parsed, ROOM_KINDS));
    if (!checked.success) throw schemaMissError(`floor plan (it sent ${describeKeys(parsed)})`, checked.error.issues);
  }

  // --- Pass 2: furniture, a few rooms at a time -----------------------------
  const furnished = await furnishRooms(client, { model, effort }, opts, checked.data, set, ask.prompt);
  usage = addUsage(usage, furnished.usage);
  latencyMs += furnished.latencyMs;

  const plan = compileFloorPlan(furnished.plan, scene.grid, set);
  plan.warnings.push(...furnished.warnings);
  usageMeter.record(ask.campaignId, { model: turn.model, usage, latencyMs });
  return {
    plan,
    raw: furnished.plan,
    level: ask.level,
    model: turn.model,
    usage,
    latencyMs,
  };
}
