/**
 * Painted objects: the walls, doors and furniture on a floor, as things a GM
 * can pick up — pure, no pixi, no React (unit-tested).
 *
 * A painted floor is stored one cell at a time, three layers deep
 * (`ground`, `structure`, `object`), which is the right shape for a brush and
 * the wrong one for a hand. Nobody thinks of the east wall as eleven cells.
 * So this module reads an OBJECT back out of the cells under a click:
 *
 * - a **wall** is the whole straight run it belongs to — walls and any doors
 *   cut into them, because sliding a wall should carry its door with it;
 * - a **door** is the run of door cells along its wall;
 * - a **prop** (interior or decor) is every cell of the same tile touching
 *   the one clicked, so a counter stretched over four squares is one counter.
 *
 * And it turns a drag into the paint that makes it so. Every edit is one
 * `{ paint, erase }` delta for `POST /api/scenes/:id/tiles`, which means one
 * request and one undo step.
 *
 * ## The server applies `paint` before `erase`
 *
 * So a move that overlaps where it came from — a wall slid one square — must
 * not list the overlapping cells in `erase`, or it erases its own new
 * position. `delta()` below is the one place that rule lives.
 */
import type { Scene } from '@safehouse/contracts';
import { levelTiles, objectCoverage, propCoverage, tileById } from '@safehouse/rules';

export type PaintedRole = 'wall' | 'door' | 'prop';
export type PaintedLayer = 'structure' | 'object';
export type Axis = 'h' | 'v';

/** A cell as integer column and row. */
export interface CellRef {
  col: number;
  row: number;
}

export interface PaintedObject {
  role: PaintedRole;
  layer: PaintedLayer;
  /** The cells it occupies, as `"col,row"` keys. */
  cells: string[];
  /** What each of those cells holds — the stored slot, which paint accepts back. */
  slots: Record<string, string>;
  /**
   * The squares a piece of furniture takes up on the map, when that is more
   * than the one it is stored in (rules: footprint.ts) — what the selection
   * rings and a click anywhere on it finds. `cells` stays the stored square,
   * so a move or a delete touches only what is really there.
   */
  covers?: string[];
  /** The line a wall or door runs along; props have none. */
  axis?: Axis;
  /** Bounding box, inclusive, in cells. */
  min: CellRef;
  max: CellRef;
  /** The tileset this floor is drawn in — every edit is sent under it. */
  tilesetId: string;
  /** A name a GM can read: "Corrugated wall ×6", "Pallet stack". */
  label: string;
}

/** One edit, as the paint endpoint takes it. */
export interface PaintDelta {
  paint: Record<string, string>;
  erase: string[];
  layer: PaintedLayer;
}

export const key = (col: number, row: number): string => `${col},${row}`;

export function parseKey(k: string): CellRef {
  const [c, r] = k.split(',');
  return { col: Number(c), row: Number(r) };
}

/** A painted selection's id, as it rides in `GeometrySelection`: `"structure:4,7"`. */
export function paintedId(layer: PaintedLayer, cell: CellRef): string {
  return `${layer}:${key(cell.col, cell.row)}`;
}

export function parsePaintedId(id: string): { layer: PaintedLayer; cell: CellRef } | null {
  const [layer, k] = id.split(':');
  if ((layer !== 'structure' && layer !== 'object') || k === undefined) return null;
  return { layer, cell: parseKey(k) };
}

interface Floor {
  tilesetId: string;
  structure: Record<string, string>;
  object: Record<string, string>;
}

function floorOf(scene: Scene, level: number): Floor | null {
  const t = levelTiles(scene, level);
  if (!t) return null;
  return { tilesetId: t.tilesetId, structure: t.structure ?? {}, object: t.object ?? {} };
}

function kindAt(floor: Floor, layer: Record<string, string>, k: string): string | null {
  const slot = layer[k];
  if (slot === undefined) return null;
  return tileById(floor.tilesetId, slot)?.kind ?? null;
}

const isStructural = (kind: string | null): boolean => kind === 'wall' || kind === 'door';

function bounds(cells: readonly string[]): { min: CellRef; max: CellRef } {
  let minC = Infinity;
  let minR = Infinity;
  let maxC = -Infinity;
  let maxR = -Infinity;
  for (const k of cells) {
    const { col, row } = parseKey(k);
    minC = Math.min(minC, col);
    minR = Math.min(minR, row);
    maxC = Math.max(maxC, col);
    maxR = Math.max(maxR, row);
  }
  return { min: { col: minC, row: minR }, max: { col: maxC, row: maxR } };
}

/** Which way a wall or door cell runs: along whichever neighbours are also walls. */
function axisAt(floor: Floor, { col, row }: CellRef): Axis {
  const s = floor.structure;
  const h = isStructural(kindAt(floor, s, key(col - 1, row))) || isStructural(kindAt(floor, s, key(col + 1, row)));
  if (h) return 'h';
  const v = isStructural(kindAt(floor, s, key(col, row - 1))) || isStructural(kindAt(floor, s, key(col, row + 1)));
  return v ? 'v' : 'h';
}

/** Walk a line from `cell` both ways while `keep` holds, and return the run in order. */
function runAlong(cell: CellRef, axis: Axis, keep: (k: string) => boolean): string[] {
  const step = axis === 'h' ? { dc: 1, dr: 0 } : { dc: 0, dr: 1 };
  const before: string[] = [];
  const after: string[] = [];
  for (let i = 1; i < 10_000; i += 1) {
    const k = key(cell.col - step.dc * i, cell.row - step.dr * i);
    if (!keep(k)) break;
    before.unshift(k);
  }
  for (let i = 1; i < 10_000; i += 1) {
    const k = key(cell.col + step.dc * i, cell.row + step.dr * i);
    if (!keep(k)) break;
    after.push(k);
  }
  return [...before, key(cell.col, cell.row), ...after];
}

function labelFor(floor: Floor, slot: string | undefined, n: number): string {
  const name = slot === undefined ? 'Painted object' : (tileById(floor.tilesetId, slot)?.name ?? 'Painted object');
  return n > 1 ? `${name} ×${n}` : name;
}

function objectFrom(
  floor: Floor,
  role: PaintedRole,
  layer: PaintedLayer,
  cells: string[],
  axis: Axis | undefined,
): PaintedObject {
  const src = layer === 'structure' ? floor.structure : floor.object;
  const slots: Record<string, string> = {};
  for (const k of cells) {
    const s = src[k];
    if (s !== undefined) slots[k] = s;
  }
  const first = cells[0];
  return {
    role,
    layer,
    cells,
    slots,
    ...(axis ? { axis } : {}),
    ...bounds(cells),
    tilesetId: floor.tilesetId,
    label: labelFor(floor, first === undefined ? undefined : src[first], cells.length),
  };
}

/**
 * The painted object under `cell` on floor `level`, or null.
 *
 * Furniture before walls: a bench stands against a wall and the GM who
 * clicked the bench meant the bench. `prefer` narrows it to one layer — a
 * selection is re-read from its own layer so it cannot jump to a different
 * object that happens to share the anchor cell.
 */
export function pickPainted(
  scene: Scene,
  level: number,
  cell: CellRef,
  prefer?: PaintedLayer,
): PaintedObject | null {
  const floor = floorOf(scene, level);
  if (!floor) return null;
  const k = key(cell.col, cell.row);

  // Furniture covers as many squares as it is big, and a click on any of
  // them is a click on it.
  const unitM = scene.grid.unitM ?? 1;
  const at = objectCoverage(floor.object, unitM, (v) => tileById(floor.tilesetId, v)?.prop).get(k);
  const objectSlot = at === undefined ? undefined : floor.object[at];
  if (at !== undefined && objectSlot !== undefined && prefer !== 'structure') {
    const prop = tileById(floor.tilesetId, objectSlot)?.prop;
    if (prop !== undefined) {
      // A designed piece is ONE piece, however many like it stand beside it:
      // two desks side by side are two desks.
      const a = parseKey(at);
      const covers = propCoverage(prop, a.col, a.row, unitM);
      return { ...objectFrom(floor, 'prop', 'object', [at], undefined), covers, ...bounds(covers) };
    }
    // Every cell of the same tile touching this one, 4-connected.
    const start = parseKey(at);
    const seen = new Set<string>([at]);
    const queue: CellRef[] = [start];
    while (queue.length > 0 && seen.size < 4096) {
      const c = queue.shift()!;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const n = key(c.col + dc, c.row + dr);
        if (!seen.has(n) && floor.object[n] === objectSlot) {
          seen.add(n);
          queue.push({ col: c.col + dc, row: c.row + dr });
        }
      }
    }
    return objectFrom(floor, 'prop', 'object', [...seen].sort(), undefined);
  }

  const kind = kindAt(floor, floor.structure, k);
  if (!isStructural(kind) || prefer === 'object') return null;
  const axis = axisAt(floor, cell);

  if (kind === 'door') {
    const doorSlot = floor.structure[k];
    const cells = runAlong(cell, axis, (n) => floor.structure[n] === doorSlot);
    return objectFrom(floor, 'door', 'structure', cells, axis);
  }
  // A wall carries the doors cut into it: they are part of the same plane.
  const cells = runAlong(cell, axis, (n) => isStructural(kindAt(floor, floor.structure, n)));
  return objectFrom(floor, 'wall', 'structure', cells, axis);
}

/** Re-read a selection from its id, or null when the object is no longer there. */
export function objectForSelection(scene: Scene, level: number, id: string): PaintedObject | null {
  const parsed = parsePaintedId(id);
  if (!parsed) return null;
  return pickPainted(scene, level, parsed.cell, parsed.layer);
}

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

export type HandleId = 'start' | 'end' | 'corner';

export interface Handle {
  id: HandleId;
  /** Grid coordinates of the handle's centre — on the object's outer edge. */
  at: { x: number; y: number };
}

/**
 * Where a selected object can be grabbed to change its size: the two ends of
 * a wall or door run, on the outside edge so they do not cover the tile; the
 * bottom-right corner of a prop.
 */
export function handlesOf(obj: PaintedObject): Handle[] {
  const { min, max } = obj;
  // A piece of furniture is as big as it is: nothing to drag bigger.
  if (obj.covers !== undefined) return [];
  if (obj.role === 'prop') return [{ id: 'corner', at: { x: max.col + 1, y: max.row + 1 } }];
  if (obj.axis === 'v') {
    return [
      { id: 'start', at: { x: min.col + 0.5, y: min.row } },
      { id: 'end', at: { x: min.col + 0.5, y: max.row + 1 } },
    ];
  }
  return [
    { id: 'start', at: { x: min.col, y: min.row + 0.5 } },
    { id: 'end', at: { x: max.col + 1, y: min.row + 0.5 } },
  ];
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export type EditOp =
  /** A wall's body: slide perpendicular to its own line. */
  | { kind: 'slide' }
  /** A prop's body: move freely. */
  | { kind: 'move' }
  /** A wall or door end: lengthen or shorten along the line. */
  | { kind: 'stretch'; handle: 'start' | 'end' }
  /** A prop's corner: grow or shrink the rectangle it fills. */
  | { kind: 'resize' };

export interface EditResult {
  /** The cells the object will occupy — the ghost drawn while dragging. */
  cells: string[];
  delta: PaintDelta;
  /** A cell of the edited object, to keep it selected after the write. */
  anchor: CellRef;
  /** Nothing changes: a drag that came back to where it started. */
  noop: boolean;
}

/**
 * Build the delta from what a layer should hold afterwards.
 *
 * `before` is what the object occupied; `after` maps each cell it will
 * occupy to its slot. The server paints before it erases, so a cell in both
 * is painted and NOT erased — otherwise a one-square slide erases itself.
 */
function delta(layer: PaintedLayer, before: readonly string[], after: Record<string, string>): PaintDelta {
  const erase = before.filter((k) => !(k in after));
  return { paint: after, erase, layer };
}

function unchanged(before: readonly string[], after: Record<string, string>, obj: PaintedObject): boolean {
  if (before.length !== Object.keys(after).length) return false;
  return before.every((k) => after[k] === obj.slots[k]);
}

/** A slot to lay a new wall cell with: the run's own wall, not its door. */
function wallSlot(obj: PaintedObject): string | undefined {
  for (const k of obj.cells) {
    const slot = obj.slots[k];
    if (slot !== undefined && tileById(obj.tilesetId, slot)?.kind === 'wall') return slot;
  }
  return obj.slots[obj.cells[0] ?? ''];
}

/**
 * The wall a door is cut into, just beyond one end of it — what a shortened
 * door gives its squares back to. Undefined when the door stands alone.
 */
function wallBeside(scene: Scene, level: number, obj: PaintedObject): string | undefined {
  const floor = floorOf(scene, level);
  if (!floor || !obj.axis) return undefined;
  const beyond =
    obj.axis === 'h'
      ? [key(obj.min.col - 1, obj.min.row), key(obj.max.col + 1, obj.min.row)]
      : [key(obj.min.col, obj.min.row - 1), key(obj.min.col, obj.max.row + 1)];
  for (const k of beyond) {
    const slot = floor.structure[k];
    if (slot !== undefined && tileById(floor.tilesetId, slot)?.kind === 'wall') return slot;
  }
  return undefined;
}

/**
 * A wall does not slide on its own: the walls it meets go with it, so the
 * room gets bigger or smaller rather than coming apart at the corners.
 *
 * Moving the east wall east, the north and south walls end at its corners;
 * they have to grow by the same distance or two gaps open where they used
 * to meet. Moving it back west, they have to shrink, or their ends poke
 * past the new corner into the corridor. So, for each square of the wall
 * being slid, look along the direction of travel:
 *
 * - a wall BEHIND it (the side it leaves) extends to follow — every square
 *   from where it was up to where it lands becomes that wall;
 * - a wall AHEAD of it (the side it moves into) is cut back — the squares
 *   between where it was and where it lands are taken out;
 * - a wall on BOTH sides is one it crosses, and that wall is left whole.
 *
 * `after` is the slid wall itself. The server paints before it erases, so
 * nothing painted here may also be erased.
 */
function followConnected(
  scene: Scene,
  level: number,
  obj: PaintedObject,
  mc: number,
  mr: number,
  after: Record<string, string>,
): { paint: Record<string, string>; erase: string[] } {
  const floor = floorOf(scene, level);
  const paint: Record<string, string> = { ...after };
  const erase = new Set<string>(obj.cells);
  const keep = new Set<string>();
  if (!floor) return { paint, erase: [...erase].filter((k) => !(k in paint)) };

  // The direction of travel, as a unit step, and how far it goes.
  const dist = Math.abs(mc) + Math.abs(mr);
  const sc = Math.sign(mc);
  const sr = Math.sign(mr);
  const wallAt = (c: number, r: number) => isStructural(kindAt(floor, floor.structure, key(c, r)));
  const own = new Set(obj.cells);

  for (const k of obj.cells) {
    const { col, row } = parseKey(k);
    // Neighbours along the direction of travel — never the slid wall itself.
    const aheadK = key(col + sc, row + sr);
    const behindK = key(col - sc, row - sr);
    const ahead = !own.has(aheadK) && wallAt(col + sc, row + sr);
    const behind = !own.has(behindK) && wallAt(col - sc, row - sr);

    if (ahead && behind) {
      // A wall it crosses: leave that wall whole where the slid one left it.
      keep.add(k);
      continue;
    }
    if (behind) {
      // Grow to follow: this square and every one up to the new position,
      // in the connected wall's own material — unless the square beside the
      // corner is a door, which is not what a wall is extended with.
      const beside = floor.structure[behindK]!;
      const slot =
        tileById(floor.tilesetId, beside)?.kind === 'door' ? (wallSlot(obj) ?? beside) : beside;
      for (let i = 0; i < dist; i += 1) {
        const fk = key(col + sc * i, row + sr * i);
        if (!(fk in paint)) paint[fk] = slot;
      }
      continue;
    }
    if (ahead) {
      // Cut back: the squares between here and the new position, while
      // they are still that wall.
      for (let i = 1; i < dist; i += 1) {
        const c = col + sc * i;
        const r = row + sr * i;
        if (!wallAt(c, r)) break;
        erase.add(key(c, r));
      }
    }
  }

  return { paint, erase: [...erase].filter((k) => !(k in paint) && !keep.has(k)) };
}

/**
 * What a drag from `from` to `to` (both cells) does to `obj`.
 *
 * `scene` and `level` are only read to find the wall a shortened door hands
 * its squares back to.
 */
export function applyEdit(
  scene: Scene,
  level: number,
  obj: PaintedObject,
  op: EditOp,
  from: CellRef,
  to: CellRef,
): EditResult {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  const before = obj.cells;
  const after: Record<string, string> = {};

  if (op.kind === 'slide' || op.kind === 'move') {
    // A wall slides on its own plane's normal only: it never tilts and never
    // changes length, whatever the pointer does along it.
    const mc = op.kind === 'slide' ? (obj.axis === 'v' ? dc : 0) : dc;
    const mr = op.kind === 'slide' ? (obj.axis === 'v' ? 0 : dr) : dr;
    for (const k of before) {
      const { col, row } = parseKey(k);
      const slot = obj.slots[k];
      if (slot !== undefined) after[key(col + mc, row + mr)] = slot;
    }
    const anchor = parseKey(before[0] ?? '0,0');
    const result = {
      anchor: { col: anchor.col + mc, row: anchor.row + mr },
      noop: mc === 0 && mr === 0,
    };
    // Furniture's ghost is every square it will take up, not only its anchor.
    if (obj.covers !== undefined && op.kind === 'move') {
      const ghost = obj.covers.map((k) => {
        const { col, row } = parseKey(k);
        return key(col + mc, row + mr);
      });
      return { ...result, cells: ghost, delta: delta(obj.layer, before, after) };
    }
    if (op.kind === 'slide' && !result.noop) {
      const { paint, erase } = followConnected(scene, level, obj, mc, mr, after);
      return { ...result, cells: Object.keys(paint), delta: { paint, erase, layer: obj.layer } };
    }
    return { ...result, cells: Object.keys(after), delta: delta(obj.layer, before, after) };
  }

  if (op.kind === 'resize') {
    // The corner moves with the pointer; the top-left stays put, and the
    // prop is never smaller than one square.
    const slot = obj.slots[before[0] ?? ''];
    const maxC = Math.max(obj.min.col, obj.max.col + dc);
    const maxR = Math.max(obj.min.row, obj.max.row + dr);
    if (slot !== undefined) {
      for (let c = obj.min.col; c <= maxC; c += 1) {
        for (let r = obj.min.row; r <= maxR; r += 1) after[key(c, r)] = slot;
      }
    }
    return {
      cells: Object.keys(after),
      delta: delta(obj.layer, before, after),
      anchor: obj.min,
      noop: unchanged(before, after, obj),
    };
  }

  // Stretch: along the axis only.
  const along = obj.axis === 'v' ? dr : dc;
  const lo = obj.axis === 'v' ? obj.min.row : obj.min.col;
  const hi = obj.axis === 'v' ? obj.max.row : obj.max.col;
  const fixed = obj.axis === 'v' ? obj.min.col : obj.min.row;
  const newLo = op.handle === 'start' ? Math.min(hi, lo + along) : lo;
  const newHi = op.handle === 'end' ? Math.max(lo, hi + along) : hi;
  const at = (i: number) => (obj.axis === 'v' ? key(fixed, i) : key(i, fixed));

  // What a new square is laid with: a door's own slot for a door; the run's
  // wall — not the door cut into it — for a wall.
  const fill = obj.role === 'door' ? obj.slots[before[0] ?? ''] : wallSlot(obj);
  for (let i = newLo; i <= newHi; i += 1) {
    const k = at(i);
    const slot = obj.slots[k] ?? fill;
    if (slot !== undefined) after[k] = slot;
  }
  const d = delta(obj.layer, before, after);

  // A door that shrinks gives its squares back to the wall it is cut into,
  // rather than leaving a hole: the GM narrowed a doorway, not knocked
  // through the wall beside it.
  if (obj.role === 'door' && d.erase.length > 0) {
    const wall = wallBeside(scene, level, obj);
    if (wall !== undefined) {
      for (const k of d.erase) d.paint[k] = wall;
      d.erase = [];
    }
  }

  return {
    cells: Object.keys(after),
    delta: d,
    anchor: parseKey(at(newLo)),
    noop: newLo === lo && newHi === hi,
  };
}
