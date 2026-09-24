/**
 * A multi-selection of painted squares — pure, no pixi, no React.
 *
 * Clicking one wall selects that wall, whole (`paintedObjects.ts`). This is
 * the other kind of selection: a set of SQUARES, built by dragging a box or
 * Shift-clicking objects in and out of it, and acted on as one piece — moved,
 * copied, pasted, deleted.
 *
 * ## What a box takes
 *
 * If there is anything standing in the box — a wall, a door, a piece of
 * furniture — the box takes those and leaves the floor under them alone:
 * boxing a room's furniture to move it must not drag the carpet along. If
 * the box holds no objects at all, it takes the floor. That is the whole
 * rule; there is no layer switch to set first.
 *
 * The box takes what is INSIDE it. Box half of a long wall and you have half
 * a wall, which is how a section of wall gets moved on its own.
 *
 * ## One request per layer, one undo step
 *
 * A paint request names one tile per square, and erases from one layer or
 * from all three. A selection holding a wall and the crate in front of it
 * needs a request per layer — so every action here returns a list of
 * bodies, which `usePaintBatch` sends as one undo step.
 */
import type { Scene } from '@safehouse/contracts';
import { levelTiles, tileById } from '@safehouse/rules';
import type { PaintBody, TileLayerName } from './history.js';
import { key, parseKey, type CellRef, type PaintedObject } from './paintedObjects.js';

export const LAYERS: readonly TileLayerName[] = ['ground', 'structure', 'object'];

export interface CellSet {
  /** The floor the squares are on. */
  level: number;
  /** Selected squares per layer, as `"col,row"` keys. */
  cells: Record<TileLayerName, string[]>;
}

/** What Ctrl+C holds: squares relative to the selection's top-left corner. */
export interface Clipboard {
  /** Width and height in squares, for the paste ghost. */
  w: number;
  h: number;
  /** Relative `"dc,dr"` → stored slot, per layer. */
  cells: Record<TileLayerName, Record<string, string>>;
}

const empty = (): Record<TileLayerName, string[]> => ({ ground: [], structure: [], object: [] });

function layerMap(scene: Scene, level: number): Record<TileLayerName, Record<string, string>> | null {
  const t = levelTiles(scene, level);
  if (!t) return null;
  return { ground: t.ground ?? {}, structure: t.structure ?? {}, object: t.object ?? {} };
}

export function tilesetOf(scene: Scene, level: number): string | null {
  return levelTiles(scene, level)?.tilesetId ?? null;
}

/** Every selected square, whatever its layer. */
export function allCells(sel: CellSet): string[] {
  return [...new Set(LAYERS.flatMap((l) => sel.cells[l]))];
}

export function isEmptySet(sel: CellSet | null): boolean {
  return !sel || LAYERS.every((l) => sel.cells[l].length === 0);
}

export function containsCell(sel: CellSet | null, cell: CellRef): boolean {
  if (!sel) return false;
  const k = key(cell.col, cell.row);
  return LAYERS.some((l) => sel.cells[l].includes(k));
}

/** How many objects-worth and floor-worth of squares — for the panel. */
export function describeSet(sel: CellSet): string {
  const objects = sel.cells.structure.length + sel.cells.object.length;
  const floor = sel.cells.ground.length;
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  if (objects > 0 && floor > 0) return `${n(objects, 'object square')}, ${n(floor, 'floor square')}`;
  if (objects > 0) return n(objects, 'object square');
  return n(floor, 'floor square');
}

/**
 * What a box from `a` to `b` (corners, either order, inclusive) selects:
 * the objects in it if there are any, the floor in it if not. Null when the
 * box is over nothing painted at all.
 */
export function boxSelect(
  scene: Scene,
  level: number,
  a: CellRef,
  b: CellRef,
  /** Ctrl+Shift: take the objects AND the floor under them — a whole room. */
  everything = false,
): CellSet | null {
  const layers = layerMap(scene, level);
  if (!layers) return null;
  const c0 = Math.min(a.col, b.col);
  const c1 = Math.max(a.col, b.col);
  const r0 = Math.min(a.row, b.row);
  const r1 = Math.max(a.row, b.row);
  const inBox = (k: string) => {
    const { col, row } = parseKey(k);
    return col >= c0 && col <= c1 && row >= r0 && row <= r1;
  };
  const cells = empty();
  cells.structure = Object.keys(layers.structure).filter(inBox);
  cells.object = Object.keys(layers.object).filter(inBox);
  if (everything || cells.structure.length + cells.object.length === 0) {
    cells.ground = Object.keys(layers.ground).filter(inBox);
  }
  const sel = { level, cells };
  return isEmptySet(sel) ? null : sel;
}

/** A clicked object, as a selection of its own squares. */
export function setOfObject(obj: PaintedObject, level: number): CellSet {
  const cells = empty();
  cells[obj.layer] = [...obj.cells];
  return { level, cells };
}

/**
 * Shift+click: add the object if any of it is missing from the selection,
 * take it out if all of it is already in. A selection on another floor is
 * started afresh — squares from two storeys cannot move as one piece.
 */
export function toggleObject(sel: CellSet | null, obj: PaintedObject, level: number): CellSet | null {
  if (!sel || sel.level !== level) return setOfObject(obj, level);
  const have = new Set(sel.cells[obj.layer]);
  const all = obj.cells.every((k) => have.has(k));
  const cells = { ...sel.cells };
  cells[obj.layer] = all
    ? sel.cells[obj.layer].filter((k) => !obj.cells.includes(k))
    : [...new Set([...sel.cells[obj.layer], ...obj.cells])];
  const next = { level, cells };
  return isEmptySet(next) ? null : next;
}

/** The selection moved by `dc, dr` — to keep it selected after a move. */
export function shiftSet(sel: CellSet, dc: number, dr: number): CellSet {
  const cells = empty();
  for (const l of LAYERS) {
    cells[l] = sel.cells[l].map((k) => {
      const { col, row } = parseKey(k);
      return key(col + dc, row + dr);
    });
  }
  return { level: sel.level, cells };
}

/**
 * Move the selection by `dc, dr`: per layer, paint where it goes and erase
 * where it was. The server paints before it erases, so a square in both —
 * a one-square nudge — is painted and NOT erased.
 */
export function moveBodies(scene: Scene, sel: CellSet, dc: number, dr: number): PaintBody[] {
  const layers = layerMap(scene, sel.level);
  const tilesetId = tilesetOf(scene, sel.level);
  if (!layers || !tilesetId || (dc === 0 && dr === 0)) return [];
  const bodies: PaintBody[] = [];
  for (const l of LAYERS) {
    const cells = sel.cells[l];
    if (cells.length === 0) continue;
    const paint: Record<string, string> = {};
    for (const k of cells) {
      const slot = layers[l][k];
      if (slot === undefined) continue;
      const { col, row } = parseKey(k);
      paint[key(col + dc, row + dr)] = slot;
    }
    const erase = cells.filter((k) => !(k in paint));
    bodies.push({ tilesetId, level: sel.level, layer: l, paint, erase });
  }
  return bodies;
}

/** Erase exactly the selected squares, each from its own layer. */
export function eraseBodies(scene: Scene, sel: CellSet): PaintBody[] {
  const tilesetId = tilesetOf(scene, sel.level);
  if (!tilesetId) return [];
  return LAYERS.filter((l) => sel.cells[l].length > 0).map((l) => ({
    tilesetId,
    level: sel.level,
    layer: l,
    paint: {},
    erase: [...sel.cells[l]],
  }));
}

/** Ctrl+C: the selected squares, relative to their top-left corner. */
export function copySet(scene: Scene, sel: CellSet): Clipboard | null {
  const layers = layerMap(scene, sel.level);
  const all = allCells(sel);
  if (!layers || all.length === 0) return null;
  const pts = all.map(parseKey);
  const c0 = Math.min(...pts.map((p) => p.col));
  const r0 = Math.min(...pts.map((p) => p.row));
  const c1 = Math.max(...pts.map((p) => p.col));
  const r1 = Math.max(...pts.map((p) => p.row));
  const cells: Clipboard['cells'] = { ground: {}, structure: {}, object: {} };
  for (const l of LAYERS) {
    for (const k of sel.cells[l]) {
      const slot = layers[l][k];
      if (slot === undefined) continue;
      const { col, row } = parseKey(k);
      cells[l][key(col - c0, row - r0)] = slot;
    }
  }
  return { w: c1 - c0 + 1, h: r1 - r0 + 1, cells };
}

/** Where a paste at `at` (the clipboard's top-left) lands, per layer. */
export function pastedSet(clip: Clipboard, at: CellRef, level: number): CellSet {
  const cells = empty();
  for (const l of LAYERS) {
    cells[l] = Object.keys(clip.cells[l]).map((rk) => {
      const { col, row } = parseKey(rk);
      return key(at.col + col, at.row + row);
    });
  }
  return { level, cells };
}

/**
 * Ctrl+V, placed: paint the clipboard with its top-left at `at`, one body
 * per layer. Paste lays down; it never erases — what was under it on a
 * layer the clipboard does not carry stays where it was.
 */
export function pasteBodies(clip: Clipboard, at: CellRef, level: number, tilesetId: string): PaintBody[] {
  const bodies: PaintBody[] = [];
  for (const l of LAYERS) {
    const paint: Record<string, string> = {};
    for (const [rk, slot] of Object.entries(clip.cells[l])) {
      const { col, row } = parseKey(rk);
      paint[key(at.col + col, at.row + row)] = slot;
    }
    if (Object.keys(paint).length > 0) bodies.push({ tilesetId, level, paint, erase: [] });
  }
  return bodies;
}

// ---------------------------------------------------------------------------
// Moving a selection that holds walls
// ---------------------------------------------------------------------------

/**
 * One direction of a wall move, on a scratch copy of the structure layer.
 *
 * `movers` are the selected squares that travel in this direction — the
 * squares of walls whose normal it is. Everything else, selected or not, is
 * a wall that may have to follow: grown after a mover that left it behind,
 * cut back where a mover came in past it, left whole where a mover crossed
 * it. A square grown out of a SELECTED wall joins the selection, so the next
 * direction moves it too — which is how a corner between two selected walls
 * stays a corner.
 */
function slideStep(
  map: Record<string, string>,
  sel: Set<string>,
  movers: Set<string>,
  mc: number,
  mr: number,
  isWall: (slot: string | undefined) => boolean,
  wallFill: (slot: string) => string,
): { map: Record<string, string>; sel: Set<string> } {
  const dist = Math.abs(mc) + Math.abs(mr);
  const sc = Math.sign(mc);
  const sr = Math.sign(mr);
  const at = (k: string, i: number) => {
    const { col, row } = parseKey(k);
    return key(col + sc * i, row + sr * i);
  };
  const next: Record<string, string> = { ...map };
  const nextSel = new Set([...sel].filter((k) => !movers.has(k)));
  for (const k of movers) delete next[k];

  for (const k of movers) {
    const ahead = at(k, 1);
    const behind = at(k, -1);
    const aheadWall = !movers.has(ahead) && isWall(map[ahead]);
    const behindWall = !movers.has(behind) && isWall(map[behind]);
    if (aheadWall && behindWall) {
      // A wall it crosses stays whole where the mover left it.
      next[k] = map[k]!;
      continue;
    }
    if (behindWall) {
      const slot = wallFill(map[behind]!);
      for (let i = 0; i < dist; i += 1) {
        const f = at(k, i);
        next[f] = slot;
        if (sel.has(behind)) nextSel.add(f);
      }
      continue;
    }
    if (aheadWall) {
      for (let i = 1; i < dist; i += 1) {
        const c = at(k, i);
        if (!isWall(map[c])) break;
        delete next[c];
        nextSel.delete(c);
      }
    }
  }
  for (const k of movers) {
    const { col, row } = parseKey(k);
    const nk = key(col + mc, row + mr);
    next[nk] = map[k]!;
    nextSel.add(nk);
  }
  return { map: next, sel: nextSel };
}

/**
 * Which selected wall squares travel with a move along x and which along y.
 * A square runs the way its selected neighbours run; one with none runs the
 * way the walls around it do. A selected corner runs both ways, and so moves
 * with both of its walls.
 */
function moversFor(
  map: Record<string, string>,
  sel: Set<string>,
  isWall: (slot: string | undefined) => boolean,
): { x: Set<string>; y: Set<string> } {
  const x = new Set<string>();
  const y = new Set<string>();
  for (const k of sel) {
    const { col, row } = parseKey(k);
    const selH = sel.has(key(col - 1, row)) || sel.has(key(col + 1, row));
    const selV = sel.has(key(col, row - 1)) || sel.has(key(col, row + 1));
    let h = selH;
    let v = selV;
    if (!h && !v) {
      h = isWall(map[key(col - 1, row)]) || isWall(map[key(col + 1, row)]);
      v = !h && (isWall(map[key(col, row - 1)]) || isWall(map[key(col, row + 1)]));
      if (!h && !v) h = true;
    }
    // A horizontal wall's normal is y; a vertical wall's is x.
    if (v) x.add(k);
    if (h) y.add(k);
  }
  return { x, y };
}

export interface SelectionMove {
  bodies: PaintBody[];
  /** The selection afterwards — where the moved squares went, and what grew out of them. */
  sel: CellSet;
  /** Every square the move paints — the ghost drawn while dragging. */
  ghost: string[];
}

/**
 * Drag a selection by `dc, dr`.
 *
 * Its walls do what one wall does when it is dragged: each moves only along
 * its own normal, and every wall it meets — selected or not — grows or
 * shrinks so no corner comes apart. The move is done x first, then y, on a
 * scratch copy, so each step has one direction to think about and a corner
 * shared by two selected walls follows them both. Furniture and floor in
 * the selection move rigidly by the whole drag.
 *
 * Structure is diffed against where it started into one body; the other
 * layers are `moveBodies`' rigid move. One undo step either way.
 */
export function moveSelection(scene: Scene, sel: CellSet, dc: number, dr: number): SelectionMove {
  const layers = layerMap(scene, sel.level);
  const tilesetId = tilesetOf(scene, sel.level);
  const none = { bodies: [], sel, ghost: [] };
  if (!layers || !tilesetId || (dc === 0 && dr === 0)) return none;

  const kind = (slot: string | undefined) => (slot === undefined ? null : (tileById(tilesetId, slot)?.kind ?? null));
  const isWall = (slot: string | undefined) => {
    const k = kind(slot);
    return k === 'wall' || k === 'door';
  };
  const selectedWall = sel.cells.structure.find((k) => kind(layers.structure[k]) === 'wall');
  // A wall grows in its own material — never the door beside the corner.
  const wallFill = (slot: string) =>
    kind(slot) === 'door' ? (selectedWall !== undefined ? layers.structure[selectedWall]! : slot) : slot;

  // Structure: two steps on a scratch copy.
  let map: Record<string, string> = { ...layers.structure };
  let wallSel = new Set(sel.cells.structure);
  const firstMovers = moversFor(map, wallSel, isWall);
  if (dc !== 0 && firstMovers.x.size > 0) {
    ({ map, sel: wallSel } = slideStep(map, wallSel, firstMovers.x, dc, 0, isWall, wallFill));
  }
  if (dr !== 0) {
    const { y } = moversFor(map, wallSel, isWall);
    if (y.size > 0) ({ map, sel: wallSel } = slideStep(map, wallSel, y, 0, dr, isWall, wallFill));
  }

  const bodies: PaintBody[] = [];
  const paint: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) if (layers.structure[k] !== v) paint[k] = v;
  const erase = Object.keys(layers.structure).filter((k) => !(k in map));
  if (Object.keys(paint).length + erase.length > 0) {
    bodies.push({ tilesetId, level: sel.level, layer: 'structure', paint, erase });
  }

  // Everything that is not a wall moves rigidly by the whole drag.
  const rest: CellSet = { level: sel.level, cells: { ...sel.cells, structure: [] } };
  const restBodies = moveBodies(scene, rest, dc, dr);
  bodies.push(...restBodies);

  const moved = shiftSet(rest, dc, dr);
  const nextSel: CellSet = { level: sel.level, cells: { ...moved.cells, structure: [...wallSel] } };
  const ghost = [...new Set(bodies.flatMap((b) => Object.keys(b.paint)))];
  return { bodies, sel: nextSel, ghost };
}
