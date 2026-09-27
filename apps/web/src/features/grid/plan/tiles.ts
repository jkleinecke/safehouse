/**
 * The painted layer, planned (FR9.2): what each painted square holds, which
 * way its walls turn, which squares an opening runs across, where the water
 * is — and, between two versions of the layer, which squares changed.
 *
 * Pure: nothing here draws. Two things read the same plan, so they can never
 * disagree about what a square is or which way a wall turns — the 3D world
 * (`lab3d/world3d.ts`), which builds the map's floors, walls and openings
 * from it, and the Build palette's tile painter (`gm/art/tileArt.ts`), which
 * draws each tile's picture from it.
 */
import type { TileLayer } from '@safehouse/contracts';
import { arcPoints, propCells, WALL_THICKNESS, type ArcLike, type TileCut } from '@safehouse/rules';
import { cellDepth, type SceneMetrics } from '../geometry.js';
import { tileDefKey, type TileDrawDef } from '../types.js';
import { mapWater, waterSignature, type WaterEntry, type WaterMap } from './water.js';

/** `"col,row"` -> tile id, plus the definitions to look those ids up in. */
export interface TileDrawInput {
  /** The catalogue those cell ids belong to — half of the `defs` lookup key. */
  tilesetId: string;
  /**
   * The legacy flat map. Still accepted so a caller holding an un-migrated
   * scene draws something rather than nothing; the server migrates on read, so
   * in practice this is empty.
   */
  cells?: Record<string, string> | undefined;
  /** What the square is made of. */
  ground?: Record<string, string> | undefined;
  /** Walls, windows, doors. */
  structure?: Record<string, string> | undefined;
  /** Furniture and props standing on it. */
  object?: Record<string, string> | undefined;
  /** Painted doors' state by cell (FR9.24): an open one draws open. */
  doors?: Record<string, { open: boolean; locked: boolean }> | undefined;
  /** Walls at any angle and curved walls (rules: arcs.ts). */
  arcs?: readonly ArcLike[] | undefined;
  defs: Record<string, TileDrawDef>;
}

/**
 * Build the plan's input from a scene's tile layer.
 *
 * Exists so the SEAM is testable. The painter handled three layers and the
 * server stored three layers, and both were right while the old 2D stage
 * between them passed only `cells` — which drains to empty, so the canvas
 * rendered nothing at all. Neither side's tests could see it, because neither
 * side was wrong.
 *
 * Forwarding every layer explicitly (rather than spreading `tiles`) keeps the
 * compiler on the hook: a fourth layer added to the contract has to be named
 * here before it can be drawn.
 */
export function tileDrawInput(
  tiles: TileLayer,
  defs: Record<string, TileDrawDef>,
): TileDrawInput {
  return {
    tilesetId: tiles.tilesetId,
    cells: tiles.cells,
    ground: tiles.ground,
    structure: tiles.structure,
    object: tiles.object,
    doors: tiles.doors,
    arcs: tiles.arcs,
    defs,
  };
}

function parseKey(key: string): { col: number; row: number } | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  return m === null ? null : { col: Number(m[1]), row: Number(m[2]) };
}

/** Does this tile stand proud of the floor — does it have a silhouette? */
export function isStanding(def: TileDrawDef): boolean {
  return (def.height ?? 0) > 0 || def.footprint === 'stair';
}

/** A band of wall thickness along a line, as four grid points, reaching `over` past each end. */
export function band(a: { x: number; y: number }, b: { x: number; y: number }, over = 0): Array<{ x: number; y: number }> {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const h = WALL_THICKNESS / 2;
  const a2 = { x: a.x - ux * over, y: a.y - uy * over };
  const b2 = { x: b.x + ux * over, y: b.y + uy * over };
  return [
    { x: a2.x - uy * h, y: a2.y + ux * h },
    { x: b2.x - uy * h, y: b2.y + ux * h },
    { x: b2.x + uy * h, y: b2.y - ux * h },
    { x: a2.x + uy * h, y: a2.y - ux * h },
  ];
}

/**
 * The slabs that join a wall cell to walls touching it only at a CORNER — a
 * diagonal run, painted square by square, draws as one straight 45° wall.
 * In cell-local coordinates (0..1). A corner already joined through a
 * neighbour beside it needs nothing: the wall turns there on its own.
 */
export function wallDiagonals(joins: WallJoins): Array<Array<{ x: number; y: number }>> {
  const out: Array<Array<{ x: number; y: number }>> = [];
  const centre = { x: 0.5, y: 0.5 };
  const to = (dx: number, dy: number) => band(centre, { x: 0.5 + dx * 0.5, y: 0.5 + dy * 0.5 });
  if (joins.ne && !joins.n && !joins.e) out.push(to(1, -1));
  if (joins.nw && !joins.n && !joins.w) out.push(to(-1, -1));
  if (joins.se && !joins.s && !joins.e) out.push(to(1, 1));
  if (joins.sw && !joins.s && !joins.w) out.push(to(-1, 1));
  return out;
}

/** A cell joined only at its corners: a diagonal run passing through, with no square post. */
export function diagonalOnly(joins: WallJoins): boolean {
  return !joins.n && !joins.e && !joins.s && !joins.w && Boolean(joins.ne || joins.nw || joins.se || joins.sw);
}

/** Which sides of this cell continue the wall run. */
export interface WallJoins {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
  /** The diagonal neighbours: where two runs side by side are one thick wall. */
  ne?: boolean;
  nw?: boolean;
  se?: boolean;
  sw?: boolean;
}

/**
 * The boxes making up a thin wall in one cell, in grid coordinates.
 *
 * A centre post always, plus a stub reaching toward every neighbouring wall.
 * That one rule produces every case correctly without enumerating any of them:
 * two opposite stubs is a straight run, two adjacent is a corner, three is a
 * T, four is a crossing, none is a pillar — which is what a lone wall cell
 * honestly is.
 *
 * Walls side by side are ONE wall. Where a square of four cells is all wall,
 * each cell fills the corner facing the other three, so the hole between the
 * runs closes: two rows of wall read as one thick wall rather than a ladder
 * of thin ones with rungs, and a solid block of wall cells is solid.
 */
export function wallBoxes(joins: WallJoins): Array<[number, number, number, number]> {
  const lo = (1 - WALL_THICKNESS) / 2;
  const hi = lo + WALL_THICKNESS;
  const out: Array<[number, number, number, number]> = [[lo, lo, hi, hi]];
  if (joins.n) out.push([lo, 0, hi, lo]);
  if (joins.s) out.push([lo, hi, hi, 1]);
  if (joins.w) out.push([0, lo, lo, hi]);
  if (joins.e) out.push([hi, lo, 1, hi]);
  if (joins.n && joins.w && joins.nw) out.push([0, 0, lo, lo]);
  if (joins.n && joins.e && joins.ne) out.push([hi, 0, 1, lo]);
  if (joins.s && joins.w && joins.sw) out.push([0, hi, lo, 1]);
  if (joins.s && joins.e && joins.se) out.push([hi, hi, 1, 1]);
  return out;
}

// ---------------------------------------------------------------------------
// The plan: what to draw, in what order, and which cells belong to which chunk
// ---------------------------------------------------------------------------

/** One painted cell, resolved against the palette. */
export interface TileCell {
  col: number;
  row: number;
  /** The tile id within its set — what a run of the same opening is a run OF. */
  id: string;
  def: TileDrawDef;
  /** 0 ground, 1 structure, 2 object — the draw order within a square. */
  layer: number;
  /**
   * Squares a piece of furniture covers, across and down from this one
   * (rules: footprint.ts). Absent is one square.
   */
  span?: readonly [number, number];
  /**
   * A piece of a wall at any angle or a curved wall (an arc): the stretch of
   * its centre line, in grid units, that falls in this square. Drawn in the
   * standing pass with everything else in the square, so it sorts with them.
   */
  seg?: { a: { x: number; y: number }; b: { x: number; y: number } };
  /**
   * The door or window an arc passes through in this square: the arc draws
   * the opening along its curve, and the straight door tile stands down.
   */
  opening?: { open: boolean };
  /** A ground square a wall runs through at an angle: each side takes its neighbours' ground (`groundSplits`). */
  split?: GroundSplit;
}

/**
 * A square a diagonal or curved wall runs through, split along the wall: the
 * line in cell-local (u, v) — through `p` along `d` — and the ground tile on
 * each side of it, read off the squares beside it on that side. A side with
 * nothing painted is left open (on an upper floor, the floor below shows).
 */
export interface GroundSplit {
  p: { x: number; y: number };
  d: { x: number; y: number };
  sides: Array<{ sign: 1 | -1; id: string | null }>;
}

/**
 * Every square a wall crosses at an angle, and how to split its ground.
 *
 * Without this the square under a 45° wall or a curve was ONE tile, its own
 * — a stripe of corridor tile under the ballroom's bowed wall, carpet on the
 * terrace side of it. Each side of the wall should look like the floor it is
 * part of: the ballroom's carpet on the inside, the paving on the terrace.
 */
export function groundSplits(input: TileDrawInput): Map<string, GroundSplit> {
  const out = new Map<string, { p: { x: number; y: number }; d: { x: number; y: number } }>();
  const def = (id: string | undefined) => (id === undefined ? undefined : input.defs[tileDefKey(input.tilesetId, id)]);
  const walls = new Set<string>();
  for (const [key, id] of Object.entries(input.structure ?? {})) if (def(id)?.footprint === 'wall') walls.add(key);
  // Painted walls joined only at their corners: a straight diagonal through the square.
  for (const key of walls) {
    const at = parseKey(key);
    if (at === null) continue;
    const j = joinsOf(walls, at.col, at.row);
    if (!diagonalOnly(j)) continue;
    const a = Boolean(j.ne || j.sw);
    const b = Boolean(j.nw || j.se);
    if (a && !b) out.set(key, { p: { x: 1, y: 0 }, d: { x: -1, y: 1 } });
    else if (b && !a) out.set(key, { p: { x: 0, y: 0 }, d: { x: 1, y: 1 } });
  }
  // Arcs: where each one enters and leaves each square it crosses.
  for (const arc of input.arcs ?? []) {
    const pts = arcPoints(arc, 0.05);
    let i = 0;
    while (i < pts.length) {
      const c = Math.floor(pts[i]!.x);
      const r = Math.floor(pts[i]!.y);
      let j = i;
      while (j + 1 < pts.length && Math.floor(pts[j + 1]!.x) === c && Math.floor(pts[j + 1]!.y) === r) j += 1;
      const first = pts[Math.max(0, i - 1)]!;
      const last = pts[Math.min(pts.length - 1, j + 1)]!;
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const key = `${c},${r}`;
      if (Math.hypot(dx, dy) > 0.2 && !out.has(key)) out.set(key, { p: { x: first.x - c, y: first.y - r }, d: { x: dx, y: dy } });
      i = j + 1;
    }
  }
  const ground = { ...(input.cells ?? {}), ...(input.ground ?? {}) };
  const result = new Map<string, GroundSplit>();
  for (const [key, line] of out) {
    const at = parseKey(key)!;
    const len = Math.hypot(line.d.x, line.d.y) || 1;
    const sides = ([1, -1] as const).map((sign) => {
      // Normal to the wall, toward this side.
      const nx = (-line.d.y / len) * sign;
      const ny = (line.d.x / len) * sign;
      for (const t of [0.8, 1.6, 2.4]) {
        const k2 = `${Math.floor(at.col + 0.5 + nx * t)},${Math.floor(at.row + 0.5 + ny * t)}`;
        if (out.has(k2) || walls.has(k2)) continue;
        const id = ground[k2];
        const d2 = def(id);
        if (id !== undefined && d2 !== undefined && !isStanding(d2)) return { sign, id };
        // Nothing painted beside it on this side: open.
        if (id === undefined) return { sign, id: null };
      }
      return { sign, id: ground[key] ?? null };
    });
    result.set(key, { p: line.p, d: line.d, sides });
  }
  return result;
}

/**
 * Everything a build or a draw needs, computed once from the layer maps.
 *
 * Shared by the 3D world (`lab3d/world3d.ts`) and the Build palette's tile
 * painter (`gm/art/tileArt.ts`), so the two can never disagree about what a
 * cell is or which way a wall turns.
 */
export interface TilePlan {
  /** Every drawable cell, back to front, ground before structure before object. */
  cells: TileCell[];
  /** `"col,row"` of every cell holding a thin-footprint tile — the wall runs. */
  walls: Set<string>;
  /** `"col,row"` of every cell with a floor of its own. */
  grounded: Set<string>;
  /** `"col,row"` of every cell with anything drawn in it — where the map is. */
  occupied: Set<string>;
  /** `"col,row"` → tile id for every structure cell, so an opening can find its run. */
  structure: Map<string, string>;
  /** The cells that stand proud of the floor, in draw order. */
  standing: TileCell[];
  /** `"col,row"` of every painted door standing open (FR9.24). */
  openDoors: Set<string>;
  /** The floor's water, resolved as bodies, and the shores around them (`water.ts`). */
  water: WaterMap;
  /** The palette and set, for ground split under an angled wall. */
  defs: Record<string, TileDrawDef>;
  tilesetId: string;
  /**
   * Every square an angled or curved wall crosses, with the ground found on
   * each side (`groundSplits`) — including the ones where neither side found
   * any, which `cells` leaves out. The palette's painter reads `cells`; the
   * 3D world fills those sides from the squares beside them.
   */
  splits: ReadonlyMap<string, GroundSplit>;
}

export function planTiles(m: SceneMetrics, input: TileDrawInput): TilePlan {
  const cells: TileCell[] = [];
  const walls = new Set<string>();

  // The legacy flat map draws as if it were ground: an un-migrated scene shows
  // its floor rather than nothing while the server catches up.
  const maps: Array<[Record<string, string> | undefined, number]> = [
    [input.cells, 0],
    [input.ground, 0],
    [input.structure, 1],
    [input.object, 2],
  ];

  for (const [map, layer] of maps) {
    for (const [key, tileId] of Object.entries(map ?? {})) {
      const at = parseKey(key);
      if (at === null) continue;
      if (at.col < 0 || at.row < 0 || at.col >= m.cols || at.row >= m.rows) continue;
      const def = input.defs[tileDefKey(input.tilesetId, tileId)];
      if (def === undefined) continue; // unknown id (tileset changed) — draw nothing, lose nothing
      // Furniture covers as many squares as it is big on this grid.
      const span = layer === 2 && def.prop !== undefined && !m.designSize ? propCells(def.prop, m.unitM) : undefined;
      cells.push({ col: at.col, row: at.row, id: tileId, def, layer, ...(span && (span[0] > 1 || span[1] > 1) ? { span } : {}) });
      if (def.footprint === 'wall') walls.add(`${at.col},${at.row}`);
    }
  }

  const structure = new Map<string, string>();
  for (const c of cells) {
    if (c.def.footprint === 'wall') structure.set(`${c.col},${c.row}`, c.id);
  }

  // Walls at any angle and curved walls, cut into pieces half a square long,
  // each filed under the square its middle is in. Where a door or window is
  // painted in that square, the opening stands there instead.
  const arcOpenings = new Set<string>();
  for (const arc of input.arcs ?? []) {
    const def = input.defs[tileDefKey(input.tilesetId, arc.tile)];
    if (def === undefined) continue;
    const pts = arcPoints(arc, 0.5);
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const col = Math.floor((a.x + b.x) / 2);
      const row = Math.floor((a.y + b.y) / 2);
      if (col < 0 || row < 0 || col >= m.cols || row >= m.rows) continue;
      const key = `${col},${row}`;
      const here = structure.get(key);
      const hereDef = here === undefined ? undefined : input.defs[tileDefKey(input.tilesetId, here)];
      if (hereDef !== undefined && cutOf(hereDef) !== null) {
        // A door or window where the arc runs: it follows the curve, drawn by
        // the arc in its own colours, and the straight tile stands down.
        cells.push({ col, row, id: here!, def: hereDef, layer: 1, seg: { a, b }, opening: { open: input.doors?.[key]?.open === true } });
        arcOpenings.add(key);
        continue;
      }
      cells.push({ col, row, id: arc.tile, def, layer: 1, seg: { a, b } });
    }
  }

  // A piece of furniture over several squares is as near as its nearest
  // corner: drawn after whatever stands behind any part of it.
  const depthOf = (c: TileCell) => cellDepth(c.col + (c.span?.[0] ?? 1) - 1, c.row + (c.span?.[1] ?? 1) - 1);
  cells.sort(
    (a, b) =>
      depthOf(a) - depthOf(b) ||
      a.layer - b.layer ||
      a.col - b.col,
  );

  /**
   * Cells with a floor of their own, so no default is drawn under them.
   *
   * Judged by what is DRAWN there, not by which map the key came from: the
   * legacy `cells` map held walls and props as well as floors, so "a key in
   * `cells`" is not "a floor in this cell".
   */
  const grounded = new Set<string>();
  for (const c of cells) {
    if (c.layer === 0 && !isStanding(c.def) && (c.def.footprint ?? 'fill') === 'fill') {
      grounded.add(`${c.col},${c.row}`);
    }
  }

  const occupied = new Set<string>();
  // Where the map is: what was painted. An arc crossing bare ground does not
  // make the ground there part of the map.
  for (const c of cells) if (c.seg === undefined) occupied.add(`${c.col},${c.row}`);

  // The straight door tiles an arc now draws.
  if (arcOpenings.size > 0) {
    for (let i = cells.length - 1; i >= 0; i -= 1) {
      const c = cells[i]!;
      if (c.layer === 1 && c.seg === undefined && arcOpenings.has(`${c.col},${c.row}`)) cells.splice(i, 1);
    }
  }

  // Ground under an angled or curved wall, split along it.
  const splits = groundSplits(input);
  for (const [key, split] of splits) {
    const at = parseKey(key)!;
    if (at.col < 0 || at.row < 0 || at.col >= m.cols || at.row >= m.rows) continue;
    const own = cells.find((c) => c.layer === 0 && c.seg === undefined && c.col === at.col && c.row === at.row);
    if (own) {
      own.split = split;
      continue;
    }
    // No ground of its own: the split stands in for it, if either side has any.
    const side = split.sides.find((sd) => sd.id !== null);
    const d = side ? input.defs[tileDefKey(input.tilesetId, side.id!)] : undefined;
    if (side && d) cells.push({ col: at.col, row: at.row, id: side.id!, def: d, layer: 0, split });
  }

  cells.sort(
    (a, b) =>
      depthOf(a) - depthOf(b) ||
      a.layer - b.layer ||
      a.col - b.col,
  );

  // Flat furniture over several squares — a mattress, a pallet — joins the
  // standing pass: drawn with the floor, the next square's floor would be
  // painted over the part of it that reaches there.
  const standing = cells.filter(
    (c) => isStanding(c.def) || c.def.footprint === 'wall' || c.span !== undefined || c.seg !== undefined,
  );
  const openDoors = new Set<string>();
  for (const [key, d] of Object.entries(input.doors ?? {})) if (d.open) openDoors.add(key);
  const water = waterOf(input);
  return { cells, walls, grounded, occupied, structure, standing, openDoors, water, defs: input.defs, tilesetId: input.tilesetId, splits };
}

/** The design an opening draws with: named on the tile, or the plain fallback. */
export function cutOf(def: TileDrawDef): TileCut | null {
  if (def.cut !== undefined) return def.cut;
  if (def.footprint !== 'wall') return null;
  if (def.kind === 'door') return 'door';
  // Only a FULL-height see-through wall is glazing. A railing or a velvet
  // rope is see-through because it is low, not because it is glass.
  if (def.blocksSight === false && (def.height ?? 0) >= 1) return 'glass';
  return null;
}

/** The opening: where it is, which way it runs, how many cells it spans. */
export interface CutRun {
  /** Union of the run's slab rects, in grid units. */
  rect: readonly [number, number, number, number];
  /** Which way the wall runs. */
  axis: 'x' | 'y';
  /** Cells in the run. */
  n: number;
}

/**
 * The run of one opening this cell ends, or null.
 *
 * Adjacent cells of the same cut tile are one opening. It is drawn ONCE, from
 * the run's last cell — the nearest, the one drawn last — so nothing of the
 * run is painted over it afterwards. Every other cell of the run draws its
 * slab and nothing else. The run follows the wall: along x when the cell is
 * joined east or west, along y when north or south, and along x for a cell
 * that stands alone.
 */
export function cutRunFor(
  plan: Pick<TilePlan, 'structure' | 'walls'>,
  cell: Pick<TileCell, 'col' | 'row' | 'id' | 'def'>,
): CutRun | null {
  const cut = cutOf(cell.def);
  if (cut === null) return null;
  const j = joinsOf(plan.walls, cell.col, cell.row);
  const axis: 'x' | 'y' = (j.w || j.e) && !(j.n || j.s) ? 'x' : j.n || j.s ? 'y' : 'x';
  const [dc, dr] = axis === 'x' ? [1, 0] : [0, 1];
  const same = (c: number, r: number) => plan.structure.get(`${c},${r}`) === cell.id;
  if (same(cell.col + dc, cell.row + dr)) return null; // not the last of its run
  let n = 1;
  while (n < 32 && same(cell.col - dc * n, cell.row - dr * n)) n += 1;
  const lo = (1 - WALL_THICKNESS) / 2;
  const hi = lo + WALL_THICKNESS;
  const rect: CutRun['rect'] =
    axis === 'x'
      ? [cell.col - (n - 1), cell.row + lo, cell.col + 1, cell.row + hi]
      : [cell.col + lo, cell.row - (n - 1), cell.col + hi, cell.row + 1];
  return { rect, axis, n };
}

/**
 * Widen a set of changed cells to the whole of any opening they belong to.
 *
 * An opening is drawn from its last cell across all of them, so a change to
 * ANY cell of a run — or beside one, which can split or extend it — has to
 * redraw the run's whole span. Both the old and the new layer are walked,
 * because a cell that used to end a run and a cell that now does are not
 * the same cell.
 */
export function expandCutRuns(
  changed: Iterable<string>,
  inputs: ReadonlyArray<TileDrawInput | null>,
): Set<string> {
  const out = new Set<string>(changed);
  for (const input of inputs) {
    if (input === null) continue;
    const structure = { ...(input.cells ?? {}), ...(input.structure ?? {}) };
    const isCut = (id: string | undefined): boolean => {
      if (id === undefined) return false;
      const def = input.defs[tileDefKey(input.tilesetId, id)];
      return def !== undefined && cutOf(def) !== null;
    };
    for (const key of changed) {
      const at = parseKey(key);
      if (at === null) continue;
      // The cell itself and its four neighbours: a change here may have
      // joined or split a run that runs through any of them.
      for (const [sc, sr] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const c0 = at.col + sc;
        const r0 = at.row + sr;
        const id = structure[`${c0},${r0}`];
        if (!isCut(id)) continue;
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          for (let k = 1; k < 32; k += 1) {
            const kk = `${c0 + dc * k},${r0 + dr * k}`;
            if (structure[kk] !== id) break;
            out.add(kk);
          }
        }
        out.add(`${c0},${r0}`);
      }
    }
  }
  return out;
}

/** Which of the eight squares round this one hold a wall — how its wall run turns. */
export function joinsOf(walls: ReadonlySet<string>, col: number, row: number): WallJoins {
  return {
    n: walls.has(`${col},${row - 1}`),
    s: walls.has(`${col},${row + 1}`),
    w: walls.has(`${col - 1},${row}`),
    e: walls.has(`${col + 1},${row}`),
    nw: walls.has(`${col - 1},${row - 1}`),
    ne: walls.has(`${col + 1},${row - 1}`),
    sw: walls.has(`${col - 1},${row + 1}`),
    se: walls.has(`${col + 1},${row + 1}`),
  };
}

// ---------------------------------------------------------------------------
// Chunks and the diff: what a change to the layer has to build again
// ---------------------------------------------------------------------------

/**
 * The chunk a cell belongs to, as `"cx,cy"`. `size` is the chunk's side in
 * cells: the 3D world builds each floor in chunks of its own size (16 squares
 * a side, `lab3d/world3d.ts`).
 */
export function chunkKey(col: number, row: number, size: number): string {
  return `${Math.floor(col / size)},${Math.floor(row / size)}`;
}

/**
 * The per-cell signature the diff compares, one string per painted square:
 * every layer's tile id, so a change in any of them is a change.
 */
export function cellSignatures(input: TileDrawInput): Map<string, string> {
  const out = new Map<string, string>();
  const add = (map: Record<string, string> | undefined, layer: string) => {
    for (const [key, tileId] of Object.entries(map ?? {})) {
      out.set(key, `${out.get(key) ?? ''}${layer}=${tileId};`);
    }
  };
  add(input.cells, 'c');
  add(input.ground, 'g');
  add(input.structure, 's');
  add(input.object, 'o');
  // A split square reads its neighbours' ground: when they change, it does.
  for (const [key, split] of groundSplits(input)) {
    out.set(key, `${out.get(key) ?? ''}x=${split.sides.map((sd) => sd.id ?? '-').join('/')};`);
  }
  // An arc is in every square it crosses: moving or bending it is a change
  // there, so the chunks it runs through redraw.
  for (const arc of input.arcs ?? []) {
    const sig = `a=${arc.id}:${arc.tile}@${arc.a.x},${arc.a.y},${arc.b.x},${arc.b.y},${arc.bulge};`;
    for (const p of arcPoints(arc, 0.5)) {
      const key = `${Math.floor(p.x)},${Math.floor(p.y)}`;
      out.set(key, `${out.get(key) ?? ''}${sig}`);
    }
  }
  // A door swinging open is a change in its cell (FR9.24), and the run rule
  // widens it to the whole opening.
  for (const [key, d] of Object.entries(input.doors ?? {})) {
    if (out.has(key)) out.set(key, `${out.get(key)}d=${d.open ? 1 : 0};`);
  }
  // Water reaches further than a wall run: a square's depth colour moves when
  // land is painted three squares off, and its foam when a neighbour's shore
  // changes. Folding what it depends on into its signature makes those real
  // changes to the diff, so the one-square dirty rule still holds.
  const water = waterOf(input);
  if (water.water.size > 0) {
    for (const [key, sig] of out) {
      const at = parseKey(key);
      const w = at === null ? '' : waterSignature(water, at.col, at.row);
      if (w !== '') out.set(key, `${sig}${w};`);
    }
  }
  return out;
}

/**
 * The floor's water, resolved once per input.
 *
 * A stroke asks twice — the signatures to find what changed, then the plan to
 * draw it — with the same input, and on a harbour the resolve is the larger
 * share of the stroke's fixed cost. Keyed weakly by the input object, so a
 * new layer is a new resolve and an old one is collected with its input.
 */
const WATER_BY_INPUT = new WeakMap<TileDrawInput, WaterMap>();

function waterOf(input: TileDrawInput): WaterMap {
  const hit = WATER_BY_INPUT.get(input);
  if (hit !== undefined) return hit;
  const entries: WaterEntry[] = [];
  for (const [map, layer] of [[input.cells, 0], [input.ground, 0], [input.structure, 1], [input.object, 2]] as const) {
    for (const [key, tileId] of Object.entries(map ?? {})) {
      const at = parseKey(key);
      const def = input.defs[tileDefKey(input.tilesetId, tileId)];
      if (at !== null && def !== undefined) entries.push({ col: at.col, row: at.row, def, layer });
    }
  }
  const water = mapWater(entries);
  WATER_BY_INPUT.set(input, water);
  return water;
}

/** The cells whose signature differs between two layers, either way round. */
export function changedCells(
  prev: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): string[] {
  const out: string[] = [];
  for (const [key, sig] of next) if (prev.get(key) !== sig) out.push(key);
  for (const key of prev.keys()) if (!next.has(key)) out.push(key);
  return out;
}
