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
import type { Db } from '@safehouse/db';
import {
  categoryOf,
  layerOf,
  resolveTile,
  tileBySlot,
  tilesetById,
  toSlot,
  type Tileset,
} from '@safehouse/rules';
import { httpError } from '../services/auth.js';
import { ScenesService, serializeScene } from '../services/scenes.js';
import { ROOM_KINDS } from './geometry.js';
import { LlmClient, type LlmConfig, type LlmUsage, type ModelSlot } from './llm.js';
import { usageMeter } from './usage.js';
import { parseModelJson } from './vision.js';

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

export const FloorPlanSchema = z.object({
  title: z.string().min(1).max(120),
  rooms: z.array(FloorRoomSchema).min(1).max(60),
  openings: z.array(FloorOpeningSchema).max(200).default([]),
  stairs: z.array(FloorStairSchema).max(20).default([]),
  notes: z.string().max(2000).default(''),
});
export type FloorPlan = z.infer<typeof FloorPlanSchema>;
export type FloorPlanInput = z.input<typeof FloorPlanSchema>;

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
  counts: { floor: number; wall: number; door: number; window: number; prop: number; stair: number };
  warnings: string[];
}

const key = (col: number, row: number): string => `${col},${row}`;
const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/**
 * Pure and deterministic: the same plan on the same grid with the same set
 * always paints the same squares. Everything the model got wrong is a
 * warning the GM reads, never a silent fix.
 */
export function compileFloorPlan(
  raw: FloorPlanInput,
  grid: { cols: number; rows: number },
  set: Tileset,
): CompiledFloor {
  const plan = FloorPlanSchema.parse(raw);
  const warnings: string[] = [];
  const ground: Record<string, string> = {};
  const structure: Record<string, string> = {};
  const object: Record<string, string> = {};
  const counts = { floor: 0, wall: 0, door: 0, window: 0, prop: 0, stair: 0 };

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
  if (rooms.length === 0) warnings.push('no room survived clamping — nothing to build');

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
  '7. Prefer fewer, larger, correct rooms. Leave the rest of the grid empty unless the description says otherwise.',
  '8. Name rooms the way a GM says them out loud ("loading dock", "break room"); the GM reads those names back.',
].join('\n');

function palette(set: Tileset): string {
  const list = (category: string) =>
    set.tiles
      .filter((t) => categoryOf(t) === category)
      .map((t) => `  ${t.id} — ${t.name}`)
      .join('\n');
  const stairs = set.tiles.some((t) => categoryOf(t) === 'stairs');
  return [
    `Tileset: ${set.name}.`,
    'Ground tiles (a room\'s "floor"):',
    list('ground'),
    'Interior tiles (furniture — a prop\'s "tile"):',
    list('interior'),
    'Decoration tiles (dressing — also a prop\'s "tile"):',
    list('decoration'),
    stairs ? 'Stairs up and down are available.' : 'This set has no stairs; leave "stairs" empty.',
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
    palette(set),
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

/** One non-streaming ask; the payoff is a whole floor or none. */
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
  const turn = await client.chat(
    {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${userPrompt(scene, ask.level, set, painted, ask.prompt)}\n\nSchema:\n${JSON.stringify(floorPlanJsonSchema())}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 6000,
    },
    { timeoutMs: FLOOR_TIMEOUT_MS },
  );
  const parsed = parseModelJson(turn.content);
  const checked = FloorPlanSchema.safeParse(parsed);
  if (!checked.success) {
    throw httpError(502, 'ai_error', 'the model returned a floor plan the schema rejects', checked.error.issues.slice(0, 8));
  }
  const plan = compileFloorPlan(checked.data, scene.grid, set);
  usageMeter.record(ask.campaignId, { model: turn.model, usage: turn.usage, latencyMs: turn.latencyMs });
  return {
    plan,
    raw: checked.data,
    level: ask.level,
    model: turn.model,
    usage: turn.usage,
    latencyMs: turn.latencyMs,
  };
}
