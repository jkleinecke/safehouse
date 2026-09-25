/**
 * Drawing a floor in the chat, one small edit at a time.
 *
 * `draft_floor` asked a second model for a whole floor in one answer, and a
 * whole floor is long: a big building, or a model that thinks at length, ran
 * out of room before the plan was finished. Here the Fixer draws the floor
 * itself with small tools — start it, add a few rooms, put the doors in,
 * furnish a room, lay the ground outside — so no one answer is more than a
 * few hundred tokens however big the building is, and a failed edit is one
 * small call retried under the turn's retry policy, not a lost floor.
 *
 * The plan lives in the conversation's memory, one per floor drawn, so "make
 * the lobby bigger" three turns later edits the same plan. Each edit compiles
 * the whole plan (floor-plan.ts, `compileFloorPlan`) and hands the panel only
 * what changed. What changed is measured against the last edit AND against
 * what the floor actually holds: a square the drawing needs that is empty on
 * the map — the GM undid the Fixer's work, or the panel missed an edit — is
 * painted again, while a square the GM painted over by hand is left alone.
 * The panel paints each edit through the GM's own undo history, the turn's
 * edits as one step (web: gm/fixer/floorEdits.ts).
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { levelTiles, objectCoverage, resolveTile, tileBySlot, tilesetById, type Tileset } from '@safehouse/rules';
import { ScenesService, serializeScene } from '../../services/scenes.js';
import {
  DraftPlanSchema,
  FloorAreaSchema,
  FloorOpeningSchema,
  FloorPropSchema,
  FloorRoomSchema,
  FloorStairSchema,
  compileFloorPlan,
  floorPalette,
  type CompiledFloor,
  type FloorPlan,
} from '../floor-plan.js';
import { ROOM_KINDS } from '../geometry.js';
import type { AiContext } from '../context.js';
import type { ToolContext } from '../tools.js';
import type { ConversationMemory, FloorDraft } from './memory.js';

/** Every set a scene can be drawn in has an id; this is the one a blank scene starts in. */
const FALLBACK_TILESET = 'docklands';

type Layer = 'ground' | 'structure' | 'object';
const LAYERS: readonly Layer[] = ['ground', 'structure', 'object'];

/** Per layer: the squares to paint, and the squares to erase. */
export type FloorDiff = Record<Layer, { paint: Record<string, string>; erase: string[] }>;

/** What a floor edit hands the panel — and, through `summary`, the model. */
export interface FloorEditOutput {
  /** First, so an old turn's receipt (memory.ts) reads as what happened. */
  summary: string;
  kind: 'floor-edit';
  sceneId: string;
  level: number;
  tilesetId: string;
  title: string;
  /** Erase the whole floor — clear_floor. */
  clear?: boolean;
  diff: FloorDiff;
  /** What this edit got wrong, as the compiler saw it. */
  warnings: string[];
  /** For the model only: the rules and the palette, once per drawing. */
  guide?: string;
}

/**
 * This turn's floor work. Edits run one at a time — the SDK runs a step's
 * tool calls side by side, and two edits reading the same plan would each
 * write back half of it — and "the floor" means the one this turn drew last.
 */
export interface FloorTurn {
  key?: string;
  lock: Promise<unknown>;
}

export function newFloorTurn(): FloorTurn {
  return { lock: Promise.resolve() };
}

export interface FloorToolDeps {
  ctx: ToolContext;
  where: AiContext | undefined;
  memory: ConversationMemory;
  turn: FloorTurn;
}

/** A tool body under the turn's retry policy (tools.ts). */
export type Guarded = (name: string, run: () => Promise<unknown>) => Promise<unknown>;

const keyOf = (sceneId: string, level: number): string => `${sceneId}:${level}`;

// ---------------------------------------------------------------------------
// The diff — pure, so it is testable without a scene
// ---------------------------------------------------------------------------

type Layers = CompiledFloor['layers'];
type OnMap = Partial<Record<Layer, Record<string, string>>> | undefined;

/**
 * What the panel paints to turn the map from the last edit into this one.
 *
 * Paint a square when this edit changed it, or when the map has nothing
 * there (undone, or never painted). Erase a square the last edit painted and
 * this one does not — unless the GM has since painted something else on it,
 * which is theirs.
 */
export function diffFloor(before: Layers | null, after: Layers, onMap: OnMap): FloorDiff {
  const diff = {} as FloorDiff;
  for (const layer of LAYERS) {
    const was = before?.[layer] ?? {};
    const now = after[layer];
    const map = onMap?.[layer] ?? {};
    const paint: Record<string, string> = {};
    const erase: string[] = [];
    for (const [k, slot] of Object.entries(now)) {
      if (was[k] !== slot || map[k] === undefined) paint[k] = slot;
    }
    for (const [k, slot] of Object.entries(was)) {
      if (now[k] !== undefined) continue;
      if (map[k] === undefined || map[k] === slot) erase.push(k);
    }
    diff[layer] = { paint, erase };
  }
  return diff;
}

// ---------------------------------------------------------------------------
// The picture — what view_floor shows the model
// ---------------------------------------------------------------------------

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * The floor as text, one character a square, with the column and row numbers
 * on the edges — so the model can check what it drew the way the GM would
 * look at the map: is the door where the corridor meets the room, does the
 * lobby really touch the street.
 */
export function floorPicture(
  floor: CompiledFloor,
  grid: { cols: number; rows: number; unitM?: number | undefined },
  set: Tileset,
): string {
  const inside = new Map<string, string>();
  floor.rooms.forEach((room, i) => {
    const ch = LETTERS[i] ?? '?';
    const { x, y, w, h } = room.rect;
    for (let c = x + 1; c < x + w - 1; c += 1) for (let r = y + 1; r < y + h - 1; r += 1) inside.set(`${c},${r}`, ch);
  });
  const { ground, structure, object } = floor.layers;
  // Furniture covers as many squares as it is big: every one of them is a prop.
  const covered = objectCoverage(object, grid.unitM ?? 1, (v) => resolveTile(set, v)?.prop);
  const cell = (c: number, r: number): string => {
    const k = `${c},${r}`;
    const s = structure[k];
    const o = object[k] ?? (covered.has(k) ? object[covered.get(k)!] : undefined);
    const stairs = [s, o, ground[k]].find((v) => v?.startsWith('stairs/'));
    if (stairs) return stairs === 'stairs/up' ? '^' : 'v';
    if (s === 'building/door') return 'D';
    if (s === 'building/window') return 'W';
    if (s !== undefined) return '#';
    if (o !== undefined) return '*';
    const room = inside.get(k);
    if (room) return room;
    const g = ground[k];
    if (g && tileBySlot(set, g)?.liquid) return '~';
    return g ? '.' : ' ';
  };
  const pad = String(grid.rows - 1).length;
  const lines: string[] = [];
  const cols = Array.from({ length: grid.cols }, (_, c) => c);
  lines.push(`${' '.repeat(pad + 1)}${cols.map((c) => (c % 10 === 0 ? String(Math.floor(c / 10) % 10) : ' ')).join('')}`);
  lines.push(`${' '.repeat(pad + 1)}${cols.map((c) => String(c % 10)).join('')}`);
  for (let r = 0; r < grid.rows; r += 1) {
    lines.push(`${String(r).padStart(pad)} ${cols.map((c) => cell(c, r)).join('')}`);
  }
  const legend = floor.rooms.map((room, i) => {
    const { x, y, w, h } = room.rect;
    return `${LETTERS[i] ?? '?'} = ${room.name} (${room.kind}) ${w}x${h} at ${x},${y}; floor x ${x + 1}..${x + w - 2}, y ${y + 1}..${y + h - 2}`;
  });
  return [
    `"${floor.title}" — ${grid.cols}x${grid.rows} squares. # wall, D door, W window, * prop, ^ v stairs, ~ water, . outside ground; a letter is a room's floor.`,
    ...lines,
    ...(legend.length > 0 ? ['Rooms:', ...legend] : ['No rooms yet.']),
    ...(floor.warnings.length > 0 ? ['Warnings:', ...floor.warnings.map((w) => `- ${w}`)] : []),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const RULES = [
  'How to draw:',
  '- Squares are whole grid squares from the top-left: x to the right, y downwards. Stay inside the grid.',
  '- A room is a rectangle that INCLUDES its walls: the outer ring is wall, the inside is floor. At least 3x3; a 5x4 room has 3x2 squares of floor.',
  '- Neighbouring rooms share a wall: overlap their rectangles by exactly one square. A corridor is a room too, a long thin one.',
  "- A door or window is in one of a room's walls (n, s, e, w), `offset` squares from that wall's top or left end — never 0, which is a corner. Every room the runners enter needs a door; two rooms that share a wall need a door in it.",
  '- Work in small steps: a few rooms per add_rooms, then the doors and windows, then furnish_room one room at a time, then set_outside. Call view_floor after the layout and fix what is wrong with change_room.',
  '- EDIT, never rebuild. To change a floor that is already drawn — bigger, smaller, a room moved, split, renamed or gone — change what is there: change_room, add_rooms, remove_openings and add_openings, furnish_room, set_outside. Keep every room the GM did not ask to change. start_floor again or clear_floor only when the GM says to start over.',
  '- Furniture: about one prop per ten floor squares, chosen for the room; a tile marked "against a wall" goes on a floor square next to a wall; nothing in front of a door.',
  '- Tile ids come ONLY from the palette below, exactly as written. In set_outside, "ground" is the palette\'s "outside.ground", "areas" its "outside.areas", "scatter" its "outside.scatter".',
].join('\n');

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function describeFloor(f: CompiledFloor): string {
  const c = f.counts;
  const bits = [
    f.rooms.length > 0 ? `${plural(f.rooms.length, 'room')} (${f.rooms.map((r) => r.name).join(', ')})` : 'no rooms yet',
    plural(c.door, 'door square'),
  ];
  if (c.window > 0) bits.push(plural(c.window, 'window square'));
  if (c.prop > 0) bits.push(plural(c.prop, 'prop'));
  if (c.stair > 0) bits.push(plural(c.stair, 'stair'));
  if (c.areas > 0) bits.push(plural(c.areas, 'outside area'));
  if (c.scatter > 0) bits.push(`${c.scatter} scattered outside`);
  return `The floor now has ${bits.join(', ')}.`;
}

function setOf(id: string): Tileset {
  const set = tilesetById(id);
  if (!set) throw new Error(`no such tileset: ${id}`);
  return set;
}

async function sceneOf(ctx: ToolContext, sceneId: string) {
  const row = await new ScenesService(ctx.db).sceneRow(sceneId).catch(() => null);
  if (!row || row.campaignId !== ctx.campaignId) {
    throw new Error(`no scene [${sceneId}] in this campaign — check the id, or ask the GM which scene`);
  }
  return serializeScene(row);
}

function findRoom(plan: FloorPlan, name: string): number {
  const i = plan.rooms.findIndex((r) => r.name.toLowerCase() === name.trim().toLowerCase());
  if (i < 0) {
    const names = plan.rooms.map((r) => `"${r.name}"`).join(', ') || 'none yet';
    throw new Error(`no room called "${name}" on this floor. The rooms are: ${names}`);
  }
  return i;
}

/** Inside a room's walls — where its stairs stand. */
function within(room: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }): boolean {
  return p.x > room.x && p.x < room.x + room.w - 1 && p.y > room.y && p.y < room.y + room.h - 1;
}

/** What an edit hands the model: what happened, what went wrong, and the guide once. */
function forModel({ output }: { output: unknown }) {
  const o = output as FloorEditOutput | { summary: string } | { error: string; guidance?: string };
  if ('error' in o) return { type: 'error-text' as const, value: [o.error, o.guidance].filter(Boolean).join('\n') };
  const edit = o as Partial<FloorEditOutput> & { summary: string };
  return {
    type: 'text' as const,
    value: [
      edit.summary,
      edit.warnings && edit.warnings.length > 0 ? `Problems this edit caused:\n${edit.warnings.map((w) => `- ${w}`).join('\n')}` : '',
      edit.guide ?? '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

const RoomInput = FloorRoomSchema.omit({ props: true });

export function floorTools(deps: FloorToolDeps, guarded: Guarded): ToolSet {
  const { ctx, memory, turn } = deps;

  /** One at a time, in the order they were called. */
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = turn.lock.then(run, run);
    turn.lock = next.catch(() => undefined);
    return next;
  };

  /** The floor an edit means: the one this turn drew, the one on screen, the last one drawn. */
  const current = (): { key: string; draft: FloorDraft } => {
    const where = deps.where?.sceneId ? keyOf(deps.where.sceneId, deps.where.level ?? 0) : undefined;
    for (const k of [turn.key, where, memory.activeFloor]) {
      const draft = k ? memory.floors[k] : undefined;
      if (k && draft) return { key: k, draft };
    }
    throw new Error('No floor is being drawn. Call start_floor first — it opens the floor the GM is looking at, or the one you name.');
  };

  /** Compile the next plan, remember it, and say what the panel should paint. */
  const commit = async (
    key: string,
    previous: FloorDraft | null,
    draft: FloorDraft,
    next: FloorPlan,
    what: string,
    guide?: string,
  ): Promise<FloorEditOutput> => {
    const scene = await sceneOf(ctx, draft.sceneId);
    const grid = { cols: scene.grid.cols, rows: scene.grid.rows, unitM: scene.grid.unitM };
    const before = previous ? compileFloorPlan(previous.plan, previous.grid, setOf(previous.tilesetId), { draft: true }) : null;
    const after = compileFloorPlan(next, grid, setOf(draft.tilesetId), { draft: true });
    const diff = diffFloor(before?.layers ?? null, after.layers, levelTiles(scene, draft.level));
    memory.floors = { ...memory.floors, [key]: { ...draft, grid, plan: next } };
    memory.activeFloor = key;
    turn.key = key;
    const seen = new Set(before?.warnings ?? []);
    return {
      summary: `${what} ${describeFloor(after)}`,
      kind: 'floor-edit',
      sceneId: draft.sceneId,
      level: draft.level,
      tilesetId: draft.tilesetId,
      title: next.title,
      diff,
      warnings: after.warnings.filter((w) => !seen.has(w)),
      ...(guide ? { guide } : {}),
    };
  };

  /** An edit to the floor being drawn: change its plan, and commit it. */
  const edit = (name: string, change: (plan: FloorPlan) => { plan: FloorPlan; what: string }) =>
    serial(() =>
      guarded(name, async () => {
        const { key, draft } = current();
        const { plan, what } = change(draft.plan);
        return commit(key, draft, draft, DraftPlanSchema.parse(plan), what);
      }),
    );

  const tools: ToolSet = {};

  tools['start_floor'] = tool({
    description:
      "Begin drawing one floor of a scene on the map. Use it when the GM asks for a floor, a building, a room layout or a map to be drawn and the floor has no drawing yet. A floor already drawn is EDITED, not started again: it refuses unless startOver is set, which is only for when the GM asks to start over. Leave sceneId and level out for the floor the GM is looking at. The floor is painted with the outside ground at once; then add_rooms, add_openings, furnish_room, set_outside and set_stairs build it up, each edit on the map as it lands (one Ctrl+Z takes the turn's work back). Returns the grid size, the rules and the tile palette.",
    inputSchema: z.object({
      title: z.string().min(1).max(120).describe('What the floor is, as the GM would name it: "Clinic, ground floor".'),
      outsideGround: z.string().max(60).optional().describe('A ground tile id for the land around the building; leave out until you have seen the palette, and set it with set_outside.'),
      notes: z.string().max(2000).optional().describe('Anything the GM should know about the floor.'),
      sceneId: z.string().optional().describe("Scene id; defaults to the scene on the GM's screen."),
      level: z.number().int().min(0).optional().describe('Floor index, 0 for the ground; defaults to the floor on screen.'),
      startOver: z
        .boolean()
        .optional()
        .describe("Throw this floor's drawing away and begin again. ONLY when the GM asked to start over — to change a drawing, edit it."),
    }),
    execute: ({ title, outsideGround, notes, sceneId, level, startOver }) =>
      serial(() =>
        guarded('start_floor', async () => {
          const sid = sceneId ?? deps.where?.sceneId;
          if (!sid) throw new Error('No scene to draw on: the GM is not looking at one. Ask the GM which scene (ask_gm), or to open it on the Map.');
          const scene = await sceneOf(ctx, sid);
          const lvl = level ?? (sid === deps.where?.sceneId ? deps.where?.level : undefined) ?? 0;
          const floors = 1 + (scene.levels ?? []).length;
          if (lvl >= floors) throw new Error(`scene [${sid}] has ${plural(floors, 'floor')}; there is no level ${lvl}`);
          const onMap = levelTiles(scene, lvl);
          const tilesetId = onMap?.tilesetId ?? scene.tiles?.tilesetId ?? FALLBACK_TILESET;
          const set = setOf(tilesetId);
          const key = keyOf(sid, lvl);
          const previous = memory.floors[key] ?? null;
          if (previous && !startOver) {
            // The drawing stays, and the edits that follow land on it.
            memory.activeFloor = key;
            turn.key = key;
            const rooms = previous.plan.rooms.map((r) => `"${r.name}" ${r.w}x${r.h} at ${r.x},${r.y}`).join('; ') || 'none yet';
            throw new Error(
              `Floor ${lvl} of scene [${sid}] is already drawn as "${previous.plan.title}" (rooms: ${rooms}). Edit it instead of starting over: change_room to move, resize, rename or remove a room; add_rooms; remove_openings and add_openings; furnish_room; set_outside; view_floor to see it. Set startOver only if the GM asked to start this floor over.`,
            );
          }
          const plan = DraftPlanSchema.parse({
            title,
            rooms: [],
            outside: { ...(outsideGround ? { ground: outsideGround } : {}), areas: [], scatter: [] },
            notes: notes ?? '',
          });
          const painted = LAYERS.reduce((n, l) => n + Object.keys(onMap?.[l] ?? {}).length, 0);
          const guide = [
            `Grid: ${scene.grid.cols}x${scene.grid.rows} squares (x 0..${scene.grid.cols - 1}, y 0..${scene.grid.rows - 1}), ${scene.grid.unitM} m a square.`,
            painted > 0 && !previous
              ? `This floor already had ${plural(painted, 'painted square')} (all layers). Your drawing paints over them where it reaches; walls and props outside it stay. If the GM wants a clean start, call clear_floor first.`
              : '',
            RULES,
            floorPalette(set, scene.grid.unitM),
          ]
            .filter(Boolean)
            .join('\n');
          const what = previous
            ? `Started "${title}" over on scene [${sid}] floor ${lvl}; the earlier drawing comes off the map.`
            : `Started "${title}" on scene [${sid}] floor ${lvl}.`;
          return commit(key, previous, { sceneId: sid, level: lvl, tilesetId, grid: scene.grid, plan }, plan, what, guide);
        }),
      ),
    toModelOutput: forModel,
  });

  tools['add_rooms'] = tool({
    description:
      'Add up to six rooms to the floor being drawn. A room includes its walls; neighbours overlap by one square along the wall they share. Each room needs a name no other room on the floor has.',
    inputSchema: z.object({ rooms: z.array(RoomInput).min(1).max(6) }),
    execute: ({ rooms }) =>
      edit('add_rooms', (plan) => {
        const taken = new Set(plan.rooms.map((r) => r.name.toLowerCase()));
        const clash: string[] = [];
        for (const r of rooms) {
          if (taken.has(r.name.toLowerCase())) clash.push(`"${r.name}"`);
          taken.add(r.name.toLowerCase());
        }
        if (clash.length > 0) {
          throw new Error(`there is already a room called ${clash.join(', ')} — use change_room to move or resize it, or give the new room another name`);
        }
        return {
          plan: { ...plan, rooms: [...plan.rooms, ...rooms.map((r) => ({ ...r, props: [] }))] },
          what: `Added ${rooms.map((r) => `"${r.name}" ${r.w}x${r.h} at ${r.x},${r.y}`).join('; ')}.`,
        };
      }),
    toModelOutput: forModel,
  });

  tools['change_room'] = tool({
    description:
      'Move, resize, rename or remove one room of the floor being drawn — the way to change a room, rather than removing it and adding it again. Give only what changes. Its doors, windows, furniture and stairs move with it; removing it removes them too.',
    inputSchema: z.object({
      room: z.string().min(1).describe('The room, by name.'),
      x: z.number().int().min(0).optional(),
      y: z.number().int().min(0).optional(),
      w: z.number().int().min(3).optional().describe('Width, walls included.'),
      h: z.number().int().min(3).optional().describe('Height, walls included.'),
      kind: z.enum(ROOM_KINDS).optional(),
      floor: z.string().max(60).optional().describe('A ground tile id for its floor.'),
      rename: z.string().min(1).max(60).optional(),
      remove: z.boolean().optional().describe('Take the room off the floor.'),
    }),
    execute: (input) =>
      edit('change_room', (plan) => {
        const i = findRoom(plan, input.room);
        const old = plan.rooms[i]!;
        const same = (name: string) => name.toLowerCase() === old.name.toLowerCase();
        if (input.remove) {
          return {
            plan: {
              ...plan,
              rooms: plan.rooms.filter((_, j) => j !== i),
              openings: plan.openings.filter((o) => !same(o.room)),
              stairs: plan.stairs.filter((s) => !within(old, s)),
            },
            what: `Removed "${old.name}" with its doors, windows, furniture and stairs.`,
          };
        }
        const name = input.rename?.trim() || old.name;
        if (input.rename && plan.rooms.some((r, j) => j !== i && r.name.toLowerCase() === name.toLowerCase())) {
          throw new Error(`there is already a room called "${name}"`);
        }
        const x = input.x ?? old.x;
        const y = input.y ?? old.y;
        const dx = x - old.x;
        const dy = y - old.y;
        const room = {
          ...old,
          name,
          x,
          y,
          w: input.w ?? old.w,
          h: input.h ?? old.h,
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.floor ? { floor: input.floor } : {}),
          props: old.props.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
        };
        const changed = [
          dx !== 0 || dy !== 0 ? `moved to ${x},${y}` : '',
          room.w !== old.w || room.h !== old.h ? `now ${room.w}x${room.h}` : '',
          name !== old.name ? `renamed "${name}"` : '',
          input.kind ? `a ${input.kind}` : '',
          input.floor ? `floored with ${input.floor}` : '',
        ].filter(Boolean);
        return {
          plan: {
            ...plan,
            rooms: plan.rooms.map((r, j) => (j === i ? room : r)),
            openings: plan.openings.map((o) => (same(o.room) ? { ...o, room: name } : o)),
            stairs: plan.stairs.map((s) => (within(old, s) ? { ...s, x: s.x + dx, y: s.y + dy } : s)),
          },
          what: `"${old.name}": ${changed.join(', ') || 'nothing changed'}.`,
        };
      }),
    toModelOutput: forModel,
  });

  tools['add_openings'] = tool({
    description:
      "Put doors and windows into rooms' walls on the floor being drawn — up to twelve at a time. A shared wall needs its door only once, on either room.",
    inputSchema: z.object({ openings: z.array(FloorOpeningSchema).min(1).max(12) }),
    execute: ({ openings }) =>
      edit('add_openings', (plan) => {
        for (const o of openings) findRoom(plan, o.room);
        return {
          plan: { ...plan, openings: [...plan.openings, ...openings] },
          what: `Added ${openings.map((o) => `a ${o.kind} in "${o.room}" (${o.wall} wall, offset ${o.offset}${o.width > 1 ? `, ${o.width} wide` : ''})`).join('; ')}.`,
        };
      }),
    toModelOutput: forModel,
  });

  tools['remove_openings'] = tool({
    description: "Take a room's doors and windows out of the floor being drawn — all of them, or those in one wall — so they can be put back right.",
    inputSchema: z.object({
      room: z.string().min(1),
      wall: z.enum(['n', 's', 'e', 'w']).optional().describe('Only this wall; leave out for every wall.'),
    }),
    execute: ({ room, wall }) =>
      edit('remove_openings', (plan) => {
        const name = plan.rooms[findRoom(plan, room)]!.name.toLowerCase();
        const hit = (o: FloorPlan['openings'][number]) => o.room.toLowerCase() === name && (!wall || o.wall === wall);
        const n = plan.openings.filter(hit).length;
        return {
          plan: { ...plan, openings: plan.openings.filter((o) => !hit(o)) },
          what: n > 0 ? `Removed ${plural(n, 'opening')} from "${room}".` : `"${room}" had no openings${wall ? ` in its ${wall} wall` : ''}.`,
        };
      }),
    toModelOutput: forModel,
  });

  tools['furnish_room'] = tool({
    description:
      "Place one room's furniture and dressing on the floor being drawn. Props stand on the room's floor squares (inside its walls), one per square. Replaces what the room had unless keep is true.",
    inputSchema: z.object({
      room: z.string().min(1),
      props: z.array(FloorPropSchema).max(40),
      keep: z.boolean().optional().describe("Add to the room's furniture instead of replacing it."),
    }),
    execute: ({ room, props, keep }) =>
      edit('furnish_room', (plan) => {
        const i = findRoom(plan, room);
        const old = plan.rooms[i]!;
        return {
          plan: { ...plan, rooms: plan.rooms.map((r, j) => (j === i ? { ...r, props: keep ? [...old.props, ...props] : props } : r)) },
          what: `Furnished "${old.name}" with ${plural(props.length, 'prop')}.`,
        };
      }),
    toModelOutput: forModel,
  });

  tools['set_outside'] = tool({
    description:
      'Say what lies outside the rooms on the floor being drawn: the ground everything stands on, areas of other ground (water, a beach front or pier wall along it, a pier, a lawn, a road — painted in order, later on top), and decoration to scatter outside. Give only what changes.',
    inputSchema: z.object({
      ground: z.string().max(60).optional(),
      areas: z.array(FloorAreaSchema).max(40).optional(),
      scatter: z.array(z.string().min(1).max(60)).max(12).optional(),
    }),
    execute: ({ ground, areas, scatter }) =>
      edit('set_outside', (plan) => ({
        plan: {
          ...plan,
          outside: {
            ...plan.outside,
            ...(ground ? { ground } : {}),
            ...(areas ? { areas } : {}),
            ...(scatter ? { scatter } : {}),
          },
        },
        what: `Outside: ${[ground ? `ground ${ground}` : '', areas ? plural(areas.length, 'area') : '', scatter ? `scatter ${scatter.join(', ')}` : ''].filter(Boolean).join(', ') || 'unchanged'}.`,
      })),
    toModelOutput: forModel,
  });

  tools['set_stairs'] = tool({
    description: "Set the floor's stairs — each on a floor square inside a room, going up or down. Replaces the stairs it had; an empty list removes them.",
    inputSchema: z.object({ stairs: z.array(FloorStairSchema).max(20) }),
    execute: ({ stairs }) =>
      edit('set_stairs', (plan) => ({
        plan: { ...plan, stairs },
        what: stairs.length > 0 ? `Stairs: ${stairs.map((s) => `${s.direction} at ${s.x},${s.y}`).join('; ')}.` : 'No stairs.',
      })),
    toModelOutput: forModel,
  });

  tools['view_floor'] = tool({
    description:
      'Look at the floor being drawn: a picture of the grid, one character a square, with every room, door, window, prop and stair, and what is wrong with it. Use it after laying out the rooms, and whenever the GM asks for a change to something you cannot place.',
    inputSchema: z.object({}),
    execute: () =>
      serial(() =>
        guarded('view_floor', async () => {
          const { draft } = current();
          const set = setOf(draft.tilesetId);
          const scene = await sceneOf(ctx, draft.sceneId);
          const grid = { cols: scene.grid.cols, rows: scene.grid.rows, unitM: scene.grid.unitM };
          return { summary: floorPicture(compileFloorPlan(draft.plan, grid, set, { draft: true }), grid, set) };
        }),
      ),
    toModelOutput: forModel,
  });

  tools['clear_floor'] = tool({
    description:
      "Erase every square of one floor — every layer, the GM's own painting included — and forget its drawing. ONLY when the GM asks to wipe the floor or start over; never to fix or change a drawing, which is edited instead. Leave sceneId and level out for the floor being drawn, or the one on screen.",
    inputSchema: z.object({
      sceneId: z.string().optional(),
      level: z.number().int().min(0).optional(),
    }),
    execute: ({ sceneId, level }) =>
      serial(() =>
        guarded('clear_floor', async () => {
          let sid = sceneId;
          let lvl = level;
          if (!sid) {
            const drawing = (() => {
              try {
                return current().draft;
              } catch {
                return null;
              }
            })();
            sid = drawing?.sceneId ?? deps.where?.sceneId;
            lvl ??= drawing && drawing.sceneId === sid ? drawing.level : deps.where?.level;
          }
          if (!sid) throw new Error('No floor to clear: nothing is being drawn and the GM is not looking at a scene. Ask which one.');
          lvl ??= 0;
          const scene = await sceneOf(ctx, sid);
          const floors = 1 + (scene.levels ?? []).length;
          if (lvl >= floors) throw new Error(`scene [${sid}] has ${plural(floors, 'floor')}; there is no level ${lvl}`);
          const key = keyOf(sid, lvl);
          const title = memory.floors[key]?.plan.title ?? scene.name;
          const { [key]: _gone, ...rest } = memory.floors;
          memory.floors = rest;
          if (memory.activeFloor === key) delete memory.activeFloor;
          if (turn.key === key) delete turn.key;
          const empty = { paint: {}, erase: [] };
          const out: FloorEditOutput = {
            summary: `Cleared scene [${sid}] floor ${lvl}: every square erased and its drawing forgotten. Call start_floor to draw it again.`,
            kind: 'floor-edit',
            sceneId: sid,
            level: lvl,
            tilesetId: levelTiles(scene, lvl)?.tilesetId ?? scene.tiles?.tilesetId ?? FALLBACK_TILESET,
            title,
            clear: true,
            diff: { ground: empty, structure: empty, object: empty },
            warnings: [],
          };
          return out;
        }),
      ),
    toModelOutput: forModel,
  });

  return tools;
}
