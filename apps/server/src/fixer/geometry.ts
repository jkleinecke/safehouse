/**
 * Layout copilot (FR12.11, lane 1) — prompt to **grid-true** structured
 * geometry.
 *
 * The model never draws. It fills in a tiny integer schema — rooms as
 * axis-aligned rectangles measured in GRID SQUARES, doors as an offset along a
 * named room's wall — and this module compiles that into real
 * `SceneGeometry` (walls / doors / zones) plus named fog regions, snapped to
 * the scene's own grid and clamped to its bounds.
 *
 * Why integers: this is the lane where a small local model is strong, because
 * llama.cpp grammars / vLLM guided JSON can hard-constrain the arguments to
 * `LayoutProposalSchema`. Every field is a bounded integer or an enum, so an
 * invalid shape is not expressible; and whatever does arrive is clamped here
 * before it becomes geometry. The output is validated through the same
 * contracts schemas the Grid reads, so an accepted draft cannot corrupt a scene.
 *
 * Nothing here writes: `compileLayout` is pure. The caller stores the result as
 * an `ai_generations` draft (Principle 8).
 */
import { z } from 'zod';
import {
  FogRegionSchema,
  GridSchema,
  SceneGeometrySchema,
  type FogRegion,
  type Grid,
  type SceneGeometry,
} from '@safehouse/contracts';

// ---------------------------------------------------------------------------
// The constrained proposal schema (this is what the model is allowed to emit)
// ---------------------------------------------------------------------------

const Square = z.number().int().min(0).max(999);

export const ROOM_KINDS = [
  'room',
  'corridor',
  'lobby',
  'office',
  'checkpoint',
  'server_room',
  'vault',
  'stairwell',
  'storage',
  'exterior',
] as const;

export const LayoutRoomSchema = z.object({
  name: z.string().min(1).max(60).describe('Short room name, unique within the layout'),
  kind: z.enum(ROOM_KINDS).default('room'),
  x: Square.describe('Left edge, in grid squares from the scene origin'),
  y: Square.describe('Top edge, in grid squares from the scene origin'),
  w: z.number().int().min(1).max(999).describe('Width in grid squares'),
  h: z.number().int().min(1).max(999).describe('Height in grid squares'),
  /** Storeys stack in one scene; the Grid draws them as separate zones. */
  level: z.number().int().min(0).max(9).default(0),
  fogRegion: z
    .boolean()
    .default(true)
    .describe('Also emit a named fog region for staged reveals'),
});
export type LayoutRoom = z.infer<typeof LayoutRoomSchema>;

export const LayoutDoorSchema = z.object({
  room: z.string().min(1).max(60).describe('Name of a room in this proposal'),
  wall: z.enum(['n', 's', 'e', 'w']).describe('Which wall of that room the door sits in'),
  offset: Square.default(0).describe('Squares along that wall from its top/left end'),
  width: z.number().int().min(1).max(20).default(1).describe('Opening width in squares'),
  open: z.boolean().default(false),
  to: z.string().max(60).optional().describe('Room or place on the far side, for the GM'),
});
export type LayoutDoor = z.infer<typeof LayoutDoorSchema>;

export const LayoutProposalSchema = z.object({
  title: z.string().min(1).max(120),
  rooms: z.array(LayoutRoomSchema).min(1).max(60),
  doors: z.array(LayoutDoorSchema).max(160).default([]),
  notes: z.string().max(2000).default(''),
});
export type LayoutProposal = z.infer<typeof LayoutProposalSchema>;
export type LayoutProposalInput = z.input<typeof LayoutProposalSchema>;

/** JSON Schema for grammar / guided-JSON constrained decoding (FR12.13). */
export function layoutJsonSchema(): Record<string, unknown> {
  const json = z.toJSONSchema(LayoutProposalSchema, { io: 'input' }) as Record<string, unknown>;
  delete json['$schema'];
  return json;
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

export interface CompiledRoom {
  id: string;
  name: string;
  kind: string;
  level: number;
  /** Snapped rectangle in grid squares. */
  rect: { x: number; y: number; w: number; h: number };
  /** The same rectangle in metres, via the scene's own metres-per-square. */
  sizeM: { w: number; h: number };
  areaM2: number;
}

export interface CompiledLayout {
  title: string;
  unitM: number;
  grid: { cols: number; rows: number; unitM: number };
  rooms: CompiledRoom[];
  geometry: SceneGeometry;
  fogRegions: FogRegion[];
  /** Everything that had to be clamped, dropped, or looked wrong. */
  warnings: string[];
  notes: string;
}

interface Span {
  orient: 'h' | 'v';
  at: number;
  from: number;
  to: number;
}

const KEY = (orient: 'h' | 'v', at: number): string => `${orient}@${at}`;

function slug(value: string, taken: Set<string>, prefix: string): string {
  const base =
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'x';
  let id = `${prefix}-${base}`;
  let n = 2;
  while (taken.has(id)) id = `${prefix}-${base}-${n++}`;
  taken.add(id);
  return id;
}

/** Subtract openings from one wall span, left to right. */
function cut(span: Span, openings: Array<{ from: number; to: number }>): Span[] {
  const sorted = [...openings].sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  let cursor = span.from;
  for (const gap of sorted) {
    const from = Math.max(gap.from, span.from);
    const to = Math.min(gap.to, span.to);
    if (to <= cursor) continue;
    if (from > cursor) out.push({ ...span, from: cursor, to: from });
    cursor = Math.max(cursor, to);
  }
  if (cursor < span.to) out.push({ ...span, from: cursor, to: span.to });
  return out;
}

/**
 * Compile a proposal against a real scene grid. Pure: same inputs, same
 * geometry, every coordinate an integer number of squares.
 */
export function compileLayout(proposal: LayoutProposalInput, gridRaw: unknown): CompiledLayout {
  const raw: LayoutProposal = LayoutProposalSchema.parse(proposal);
  const grid: Grid = GridSchema.parse(gridRaw ?? { cols: 30, rows: 30 });
  const unitM = grid.unitM;
  const warnings: string[] = [];
  const ids = new Set<string>();

  // --- rooms: clamp into the grid, drop anything that survives as nothing ---
  const rooms: CompiledRoom[] = [];
  const rectByName = new Map<string, CompiledRoom>();
  for (const room of raw.rooms) {
    const x = Math.min(room.x, grid.cols - 1);
    const y = Math.min(room.y, grid.rows - 1);
    const w = Math.min(room.w, grid.cols - x);
    const h = Math.min(room.h, grid.rows - y);
    if (w < 1 || h < 1) {
      warnings.push(`room "${room.name}" falls outside the ${grid.cols}x${grid.rows} grid — dropped`);
      continue;
    }
    if (x !== room.x || y !== room.y || w !== room.w || h !== room.h) {
      warnings.push(
        `room "${room.name}" clamped to the grid: ${room.w}x${room.h} at ${room.x},${room.y} → ${w}x${h} at ${x},${y}`,
      );
    }
    if (rectByName.has(room.name.toLowerCase())) {
      warnings.push(`two rooms are called "${room.name}" — doors will attach to the first`);
    }
    const compiled: CompiledRoom = {
      id: slug(room.name, ids, 'room'),
      name: room.name,
      kind: room.kind,
      level: room.level,
      rect: { x, y, w, h },
      sizeM: { w: Number((w * unitM).toFixed(2)), h: Number((h * unitM).toFixed(2)) },
      areaM2: Number((w * h * unitM * unitM).toFixed(2)),
    };
    rooms.push(compiled);
    if (!rectByName.has(room.name.toLowerCase())) rectByName.set(room.name.toLowerCase(), compiled);
  }
  if (rooms.length === 0) {
    warnings.push('no room survived clamping — nothing to draw');
  }
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]!;
      const b = rooms[j]!;
      if (a.level !== b.level) continue;
      const overlapW = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
      const overlapH = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
      if (overlapW > 0 && overlapH > 0) {
        warnings.push(`"${a.name}" and "${b.name}" overlap by ${overlapW}x${overlapH} squares`);
      }
    }
  }

  // --- doors: snapped onto a real wall of a real room ----------------------
  const doors: SceneGeometry['doors'] = [];
  const openings = new Map<string, Array<{ from: number; to: number }>>();
  for (const door of raw.doors) {
    const room = rectByName.get(door.room.toLowerCase());
    if (!room) {
      warnings.push(`door on unknown room "${door.room}" — dropped`);
      continue;
    }
    const { x, y, w, h } = room.rect;
    const horizontal = door.wall === 'n' || door.wall === 's';
    const length = horizontal ? w : h;
    const width = Math.min(door.width, length);
    const offset = Math.min(Math.max(door.offset, 0), length - width);
    if (offset !== door.offset || width !== door.width) {
      warnings.push(
        `door on "${room.name}" (${door.wall}) snapped onto the wall: offset ${door.offset}→${offset}, width ${door.width}→${width}`,
      );
    }
    const at = door.wall === 'n' ? y : door.wall === 's' ? y + h : door.wall === 'w' ? x : x + w;
    const start = (horizontal ? x : y) + offset;
    const end = start + width;
    const orient: 'h' | 'v' = horizontal ? 'h' : 'v';
    const list = openings.get(KEY(orient, at)) ?? [];
    list.push({ from: start, to: end });
    openings.set(KEY(orient, at), list);
    doors.push({
      id: slug(`${room.name}-${door.wall}`, ids, 'door'),
      a: horizontal ? { x: start, y: at } : { x: at, y: start },
      b: horizontal ? { x: end, y: at } : { x: at, y: end },
      open: door.open,
      note: door.to ? `${room.name} → ${door.to}` : room.name,
    });
  }

  // --- walls: every room edge, minus every opening on that same line -------
  const spans: Span[] = [];
  for (const room of rooms) {
    const { x, y, w, h } = room.rect;
    spans.push({ orient: 'h', at: y, from: x, to: x + w });
    spans.push({ orient: 'h', at: y + h, from: x, to: x + w });
    spans.push({ orient: 'v', at: x, from: y, to: y + h });
    spans.push({ orient: 'v', at: x + w, from: y, to: y + h });
  }
  const walls: SceneGeometry['walls'] = [];
  const seen = new Set<string>();
  let wallIndex = 1;
  for (const span of spans) {
    for (const piece of cut(span, openings.get(KEY(span.orient, span.at)) ?? [])) {
      if (piece.to - piece.from <= 0) continue;
      const key = `${piece.orient}|${piece.at}|${piece.from}|${piece.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      walls.push({
        id: `wall-${wallIndex++}`,
        a:
          piece.orient === 'h'
            ? { x: piece.from, y: piece.at }
            : { x: piece.at, y: piece.from },
        b: piece.orient === 'h' ? { x: piece.to, y: piece.at } : { x: piece.at, y: piece.to },
      });
    }
  }

  // --- zones + fog regions -------------------------------------------------
  const rect = (r: CompiledRoom): Array<{ x: number; y: number }> => [
    { x: r.rect.x, y: r.rect.y },
    { x: r.rect.x + r.rect.w, y: r.rect.y },
    { x: r.rect.x + r.rect.w, y: r.rect.y + r.rect.h },
    { x: r.rect.x, y: r.rect.y + r.rect.h },
  ];
  const zones: SceneGeometry['zones'] = rooms.map((room) => ({
    id: room.id,
    name: room.name,
    polygon: rect(room),
    note: `${room.kind}, ${room.sizeM.w}x${room.sizeM.h} m${room.level > 0 ? `, level ${room.level}` : ''}`,
  }));
  const regionIds = new Set<string>();
  const fogRegions: FogRegion[] = [];
  const wantsRegion = new Map(raw.rooms.map((r) => [r.name.toLowerCase(), r.fogRegion]));
  for (const room of rooms) {
    if (wantsRegion.get(room.name.toLowerCase()) === false) continue;
    fogRegions.push(
      FogRegionSchema.parse({
        id: slug(room.name, regionIds, 'region'),
        name: room.name,
        polygon: rect(room),
      }),
    );
  }

  return {
    title: raw.title,
    unitM,
    grid: { cols: grid.cols, rows: grid.rows, unitM },
    rooms,
    // Parsing through the contract is the guarantee: an accepted draft is
    // geometry the Grid already knows how to read.
    geometry: SceneGeometrySchema.parse({ walls, doors, zones, pins: [] }),
    fogRegions,
    warnings,
    notes: raw.notes,
  };
}
