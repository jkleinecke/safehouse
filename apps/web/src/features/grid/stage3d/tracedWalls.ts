/**
 * The GM's traced walls and doors, standing on the 3D map (P3 of the move to
 * 3D).
 *
 * `scene.geometry.walls` and `doors` are lines the GM drew — over a map image,
 * mostly, where the image shows a wall. The rules read them on every floor
 * (`sightModelFor`): a runner's sightline stops at them, and so does every
 * lamp's area. On the 2D map they are thin lines for the GM and door knobs
 * for everyone. Here they stand up as what they are, on every floor on show
 * — the floor in view, and a copy on each floor seen below it, as the rules
 * stand them on every floor: a lamp's pool downstairs that stops at a
 * traced line stops at a wall there, not at nothing:
 *   - a wall is a slab `WALL_THICKNESS` thick along its line, a storey tall
 *     less the slab above (as a painted wall is, `world3d.ts`), its ends run
 *     on into the next wall's where two meet, so a corner closes;
 *   - a door is a leaf in its opening under a lintel: shut, across the line;
 *     open, swung back from its jamb — two leaves, one from each jamb, when
 *     it is wider than a single door.
 * Everyone sees them, as everyone is sent them (`sceneForViewer`: they are the
 * map's sight geometry). A locked door carries an amber lock plate for the
 * GM, whose payload is the only one that says so; the GM's selected wall or
 * door is tinted magenta, as the 2D map rings it — by a skin drawn a hair
 * proud of it (`drawPicked`), so selecting one changes nothing that stands.
 *
 * ## Light and shadow
 *
 * They are drawn in the world's own lit materials (`createLabMaterials`,
 * under the shroud and the fog, as the painted walls are), in a neutral dark
 * tone, and cast and take shadows at Medium and High. The shadow maps are
 * drawn once, not per frame, so `update` says which lines moved, came or
 * went, for the stage to have only the maps they fall in drawn again. The
 * selection's skin casts none.
 *
 * They are kept OUT of the bake. The bake lives on the world's own meshes
 * (`lighting3d.ts`), which these are not, and what it bakes onto the floor
 * already stops at a traced line, because every lamp's area is cut by it.
 * What lights a traced wall itself is the sky and the key light at every
 * quality, and the real-time lamps round the view at Medium and High; so at
 * Low, and beyond the real-time lamps, it stands as a dark partition in a
 * lamp's pool rather than lit like the painted wall beside it.
 *
 * ## Cost
 *
 * Built afresh, all of it, when what it is built from changes (`keyOf`): the
 * lines, the doors' state, the storey — a few boxes a line in one mesh, well
 * under a millisecond for a building's worth. The GM's selection draws only
 * its skin again. A floor change moves the mesh to the new floor and stands
 * its copies on the floors below again, which share its geometry.
 *
 * ## Picking
 *
 * `targets` is what a press can meet of them: the floor in view's mesh,
 * never the copies below. The stage casts one ray at it and at the world
 * together (`picking.ts`), so a press takes a traced wall only where it is
 * the first thing standing under the pointer, and `pieceAt` names the wall
 * or door the ray met — its face or its leaf, where the floor point under
 * the press is the square behind it in iso.
 */
import { Group, type Mesh, type Object3D } from 'three';
import type { Point, Scene } from '@safehouse/contracts';
import { WALL_THICKNESS } from '@safehouse/rules';
import { distToSegment } from '../geometry.js';
import type { GeometrySelection } from '../types.js';
import { C, shade } from '../stage/colors.js';
import { createLabMaterials, disposeBuilt, MeshBuilder, type BuiltMeshes, type LabMaterials } from '../../lab3d/geometry3d.js';
import { UPPER_SLAB } from '../../lab3d/world3d.js';

/** A traced wall's sides and top: a neutral dark partition. */
const WALL = 0x383e46;
const WALL_TOP = 0x4b525c;
/** A door's leaf: a shade warmer, so a door reads as one. */
const DOOR = 0x5a5046;
const DOOR_TOP = 0x6d6255;
/** The GM's selection, tinted as the 2D map rings it. */
const PICKED = shade(C.magenta, 0.75);
const PICKED_TOP = C.magenta;
/** How far a wall stops short of the storey: the slab above and a hair, as a painted wall does (`world3d.ts`). */
const TOP_TRIM = UPPER_SLAB + 0.04;
/** A door's height, in storeys: 2.1 m of a 3 m storey. */
const DOOR_STOREYS = 0.7;
/** Half a door leaf's thickness, in squares: a leaf is thinner than the wall it hangs in. */
const LEAF_HALF = WALL_THICKNESS / 6;
/** How far an open leaf is swung back from shut, degrees. */
const SWING = 80;
/** A door wider than this, in squares, opens as two leaves, one from each jamb. */
const DOUBLE_OVER = 1.6;
/** A locked door's lock plate: along the leaf, up it (squares), how far proud of each face, and how high it sits (storeys). */
const LOCK = { length: 0.14, height: 0.14, proud: 0.03, at: 0.35 } as const;
/** Two line ends closer than this, in squares, meet. */
const MEET = 1e-3;
/** How far the selection's skin stands proud of what it tints, in squares: drawn over it, not fighting it for the same depth. */
const SKIN = 0.012;

/** A part that was built, by what a press on it means: its line on the plan (world x/z). */
interface Piece {
  kind: 'wall' | 'door';
  id: string;
  a: Point;
  b: Point;
}

/** What a traced wall or door a ray met is: the pointer's own terms for it. */
export interface TracedHit {
  kind: 'wall' | 'door';
  id: string;
}

/** A line on the plan (grid x/y) along which what stands changed: where its shadow may have (`TracedWalls.update`). */
export interface TracedLine {
  a: Point;
  b: Point;
}

/** A door's colours: its lintel's sides and top, its leaves' sides and top. */
interface DoorLook {
  wall: number;
  wallTop: number;
  leaf: number;
  leafTop: number;
}

const DOOR_LOOK: DoorLook = { wall: WALL, wallTop: WALL_TOP, leaf: DOOR, leafTop: DOOR_TOP };
const PICKED_LOOK: DoorLook = { wall: PICKED, wallTop: PICKED_TOP, leaf: PICKED, leafTop: PICKED_TOP };

/** Everything the build reads: the lines, the doors' state, the storey. */
function keyOf(scene: Scene, storey: number): string {
  const geo = scene.geometry;
  return [
    storey,
    geo.walls.map((w) => `${w.id}:${w.a.x},${w.a.y},${w.b.x},${w.b.y}`).join(','),
    geo.doors.map((d) => `${d.id}:${d.open ? 1 : 0}:${d.locked ? 1 : 0}:${d.a.x},${d.a.y},${d.b.x},${d.b.y}`).join(','),
  ].join('|');
}

/** What one wall or door is built from, keyed `kind:id` (`TracedWalls.sigs`): the same signature, the same parts. */
function wallSignature(w: Scene['geometry']['walls'][number]): string {
  return `${w.a.x},${w.a.y},${w.b.x},${w.b.y}`;
}

/** `wallSignature` for a door: whether it is open or locked as well as its line. */
function doorSignature(d: Scene['geometry']['doors'][number]): string {
  return `${d.open ? 1 : 0}:${d.locked ? 1 : 0}:${d.a.x},${d.a.y},${d.b.x},${d.b.y}`;
}

/**
 * The lines of the walls and doors that changed between two builds — came,
 * went, moved, opened, shut, locked — where they stood and where they
 * stand: every part of each (a door's lintel and leaves, shut or swung).
 */
function changedLines(
  before: readonly Piece[],
  was: ReadonlyMap<string, string>,
  after: readonly Piece[],
  now: ReadonlyMap<string, string>,
): TracedLine[] {
  const changed = new Set<string>();
  for (const [k, sig] of now) if (was.get(k) !== sig) changed.add(k);
  for (const k of was.keys()) if (!now.has(k)) changed.add(k);
  const out: TracedLine[] = [];
  if (changed.size === 0) return out;
  for (const list of [before, after]) {
    for (const p of list) if (changed.has(`${p.kind}:${p.id}`)) out.push({ a: p.a, b: p.b });
  }
  return out;
}

/** What building a wall or a door reads besides its own line: the heights, and where walls meet. */
interface BuildCtx {
  wallH: number;
  doorH: number;
  storey: number;
  /** How far a wall end runs on past its line's end: half a wall where two walls meet, so the corner closes; none at a free end or a door's jamb. */
  over: (p: Point) => number;
}

function buildCtxOf(scene: Scene, storey: number): BuildCtx {
  const wallH = Math.max(0.2, storey - TOP_TRIM);
  const half = WALL_THICKNESS / 2;
  const ends = new Map<string, number>();
  for (const w of scene.geometry.walls) {
    for (const p of [w.a, w.b]) ends.set(endKey(p), (ends.get(endKey(p)) ?? 0) + 1);
  }
  return {
    wallH,
    doorH: Math.min(wallH, storey * DOOR_STOREYS),
    storey,
    over: (p) => ((ends.get(endKey(p)) ?? 0) > 1 ? half : 0),
  };
}

/** A line end as a key, to the thousandth of a square: where two walls meet. */
function endKey(p: Point): string {
  return `${Math.round(p.x / MEET)},${Math.round(p.y / MEET)}`;
}

/**
 * A slab along the line a→b (grid x/y, world x/z), `half` either side of it,
 * run on `overA` past a and `overB` past b, from y0 up to y1. False when the
 * line has no length or the slab no height.
 */
function slab(
  b: MeshBuilder,
  a: Point,
  c: Point,
  half: number,
  overA: number,
  overB: number,
  y0: number,
  y1: number,
  color: number,
  top: number,
): boolean {
  const len = Math.hypot(c.x - a.x, c.y - a.y);
  if (len < 1e-6 || y1 <= y0) return false;
  const ux = (c.x - a.x) / len;
  const uz = (c.y - a.y) / len;
  const nx = -uz * half;
  const nz = ux * half;
  const sx = a.x - ux * overA;
  const sz = a.y - uz * overA;
  const ex = c.x + ux * overB;
  const ez = c.y + uz * overB;
  b.extrude(
    [
      [sx + nx, sz + nz],
      [ex + nx, ez + nz],
      [ex - nx, ez - nz],
      [sx - nx, sz - nz],
    ],
    y0,
    y1,
    color,
    { top },
  );
  return true;
}

/** `p` moved `dist` along the unit direction (ux, uz). */
function along(p: Point, ux: number, uz: number, dist: number): Point {
  return { x: p.x + ux * dist, y: p.y + uz * dist };
}

/**
 * Wall `w` into `b`, in `color` with its top in `top`, `grow` proud of its
 * own size all round (0 for the wall; `SKIN` for the selection's skin over
 * it). False when its line has no length.
 */
function emitWall(b: MeshBuilder, w: Scene['geometry']['walls'][number], ctx: BuildCtx, grow: number, color: number, top: number): boolean {
  return slab(b, w.a, w.b, WALL_THICKNESS / 2 + grow, ctx.over(w.a) + grow, ctx.over(w.b) + grow, 0, ctx.wallH + grow, color, top);
}

/**
 * Door `d` into `b` — the lintel over its opening, its leaves, its lock
 * plate — in `look`'s colours, `grow` proud of its own size all round; the
 * lines of the parts built, the lintel's first (none when its line has no
 * length).
 */
function emitDoor(b: MeshBuilder, d: Scene['geometry']['doors'][number], ctx: BuildCtx, grow: number, look: DoorLook): Array<[Point, Point]> {
  const len = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
  if (len < 1e-6) return [];
  const lines: Array<[Point, Point]> = [];
  // The lintel over the opening, of a piece with the walls either side.
  slab(b, d.a, d.b, WALL_THICKNESS / 2 + grow, grow, grow, ctx.doorH - grow, ctx.wallH + grow, look.wall, look.wallTop);
  lines.push([d.a, d.b]);

  const ux = (d.b.x - d.a.x) / len;
  const uz = (d.b.y - d.a.y) / len;
  // The leaves, as lines: across the opening while shut; swung back from
  // the jamb they hang on while open, to the same side.
  const leaves: Array<[Point, Point]> = [];
  if (!d.open) leaves.push([d.a, d.b]);
  else {
    const t = (SWING * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    // The side the leaves swing to: the left of a→b, as the grid is drawn.
    const nx = -uz;
    const nz = ux;
    if (len <= DOUBLE_OVER) {
      leaves.push([d.a, along(d.a, ux * cos + nx * sin, uz * cos + nz * sin, len)]);
    } else {
      leaves.push([d.a, along(d.a, ux * cos + nx * sin, uz * cos + nz * sin, len / 2)]);
      leaves.push([d.b, along(d.b, -ux * cos + nx * sin, -uz * cos + nz * sin, len / 2)]);
    }
  }
  for (const [p, q] of leaves) {
    if (slab(b, p, q, LEAF_HALF + grow, grow, grow, 0, ctx.doorH + grow, look.leaf, look.leafTop)) lines.push([p, q]);
  }

  // The lock, the GM's to know (a player's payload never says): a plate
  // through the middle of the first leaf, proud of both its faces.
  const first = leaves[0];
  if (d.locked && first) {
    const [p, q] = first;
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const ll = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const lx = (q.x - p.x) / ll;
    const lz = (q.y - p.y) / ll;
    const y0 = Math.min(ctx.doorH - LOCK.height, ctx.storey * LOCK.at);
    slab(
      b,
      along(mid, lx, lz, -LOCK.length / 2),
      along(mid, lx, lz, LOCK.length / 2),
      LEAF_HALF + LOCK.proud + grow,
      grow,
      grow,
      y0 - grow,
      y0 + LOCK.height + grow,
      C.warn,
      C.warn,
    );
  }
  return lines;
}

/** Nothing here takes a ray but the floor in view's own mesh (`TracedWalls.targets`). */
function noRaycast(): void {}

/**
 * One stage's traced walls and doors (see the module note). Add `group` to
 * the scene and hand every state to `update`.
 */
export class TracedWalls {
  /** Holds everything drawn: the floor in view's, and the copies on the floors below it. Add it to the scene. */
  readonly group = new Group();

  /** The floor in view's walls and doors and the selection's skin, at its height. */
  private readonly inView = new Group();
  /** A copy of them on each floor shown below the one in view, sharing their mesh. */
  private readonly below = new Group();
  private readonly materials: LabMaterials = createLabMaterials('full');
  private built: BuiltMeshes | null = null;
  /** The GM's selected wall or door, again, a hair proud and in magenta (`drawPicked`). */
  private skin: BuiltMeshes | null = null;
  private pieces: Piece[] = [];
  /** Each wall's and door's signature as last built, by `kind:id`; null when two shared an id, and a change cannot be placed. */
  private sigs: Map<string, string> | null = new Map();
  /** What the last build was from, compared by identity first: most updates hand over the same geometry. */
  private lastGeo: object | null = null;
  private lastStorey = Number.NaN;
  private lastKey = '';
  private lastPicked = '';
  private lastFloor = -1;
  private disposed = false;

  constructor() {
    this.group.name = 'traced-walls';
    this.group.add(this.inView, this.below);
  }

  /**
   * Stand `scene`'s traced walls and doors on floor `floor` and each floor
   * below it, `storey` tall, the GM's `selection` tinted when it is one of
   * them. Says where what casts a shadow changed, for the caller to have the
   * shadow maps it falls in drawn again: the lines of the walls and doors
   * that came, went, moved, opened or shut (`TracedLine`, on every floor they
   * stand on), `'all'` when every one of them changed (a new storey, or ids
   * that cannot be told apart), null when none did. A selection draws only
   * its skin, which casts no shadow; a floor change only moves them, and the
   * runtime redraws its shadows for that itself.
   */
  update(scene: Scene, floor: number, storey: number, selection: GeometrySelection | null): readonly TracedLine[] | 'all' | null {
    if (this.disposed) return null;
    const picked = selection && (selection.kind === 'wall' || selection.kind === 'door') ? `${selection.kind}:${selection.id}` : '';
    const geo = scene.geometry;
    let moved: readonly TracedLine[] | 'all' | null = null;
    let rebuilt = false;
    if (geo !== this.lastGeo || storey !== this.lastStorey) {
      const storeyChanged = storey !== this.lastStorey;
      this.lastGeo = geo;
      this.lastStorey = storey;
      const key = keyOf(scene, storey);
      if (key !== this.lastKey) {
        this.lastKey = key;
        const pieces = this.pieces;
        const sigs = this.sigs;
        this.build(scene, storey);
        rebuilt = true;
        if (pieces.length > 0 || this.pieces.length > 0) {
          moved = storeyChanged || sigs === null || this.sigs === null ? 'all' : changedLines(pieces, sigs, this.pieces, this.sigs);
          if (moved !== 'all' && moved.length === 0) moved = null;
        }
      }
    }
    if (rebuilt || picked !== this.lastPicked) {
      this.lastPicked = picked;
      this.drawPicked(scene, storey, picked);
    }
    if (rebuilt || floor !== this.lastFloor) {
      this.lastFloor = floor;
      this.standFloors(floor, storey);
    }
    return moved;
  }

  /**
   * What a press can meet of them: the floor in view's mesh, placed where it
   * now stands — never the copies below, nor the selection's skin. Empty
   * when there are none.
   */
  targets(): Mesh[] {
    const mesh = this.built?.solid;
    if (this.disposed || !mesh || !this.group.visible) return [];
    // The group may have moved floor since the last frame drew it.
    this.group.updateMatrixWorld(true);
    return [mesh];
  }

  /**
   * The wall or door a ray met on `targets` at world `point`: the hit lies on
   * a face of the part it met, so the part is the one whose line runs
   * nearest it. Null when there are none.
   */
  pieceAt(point: { x: number; z: number }): TracedHit | null {
    let best: Piece | null = null;
    let bestD = Infinity;
    for (const piece of this.pieces) {
      const d = distToSegment({ x: point.x, y: point.z }, piece.a, piece.b);
      if (d < bestD) {
        bestD = d;
        best = piece;
      }
    }
    return best ? { kind: best.kind, id: best.id } : null;
  }

  /**
   * A short piece of wall in this set's materials, never shown: for the
   * stage to have its shaders compiled before the first traced wall of a
   * session needs them (`Runtime3D.precompile`). The caller frees it
   * (`disposeBuilt`).
   */
  sample(): BuiltMeshes {
    const b = new MeshBuilder();
    slab(b, { x: 0, y: 0 }, { x: 1, y: 0 }, WALL_THICKNESS / 2, 0, 0, 0, 1, WALL, WALL_TOP);
    return b.finish(this.materials);
  }

  /** Free the mesh and the materials, and leave the scene. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.below.clear();
    if (this.built) disposeBuilt(this.built);
    if (this.skin) disposeBuilt(this.skin);
    this.built = null;
    this.skin = null;
    this.pieces = [];
    this.materials.dispose();
    this.group.removeFromParent();
  }

  /** The skin over the GM's selection `picked` (`kind:id`), or none: the piece built again a hair proud, in magenta, casting nothing. */
  private drawPicked(scene: Scene, storey: number, picked: string): void {
    if (this.skin) disposeBuilt(this.skin);
    this.skin = null;
    if (picked === '') return;
    const ctx = buildCtxOf(scene, storey);
    const b = new MeshBuilder();
    for (const w of scene.geometry.walls) if (picked === `wall:${w.id}`) emitWall(b, w, ctx, SKIN, PICKED, PICKED_TOP);
    for (const d of scene.geometry.doors) if (picked === `door:${d.id}`) emitDoor(b, d, ctx, SKIN, PICKED_LOOK);
    if (b.empty) return;
    const skin = b.finish(this.materials);
    for (const o of skin.all) {
      o.castShadow = false;
      o.raycast = noRaycast;
    }
    this.inView.add(...skin.all);
    this.skin = skin;
  }

  /**
   * Stand the built mesh on floor `floor`, and a copy of it on each floor
   * below, as the runtime shows them, under its shade (runtime3d's
   * `applyFloorVisibility`). The copies share its geometry and materials, so
   * they cost a draw and nothing to build; they are never picked.
   */
  private standFloors(floor: number, storey: number): void {
    this.inView.position.y = floor * storey;
    this.below.clear();
    const built = this.built;
    if (built === null) return;
    for (let level = 0; level < floor; level += 1) {
      const copy = new Group();
      copy.position.y = level * storey;
      for (const o of built.all) {
        const c: Object3D = o.clone();
        // The shadow passes' cover, which a clone does not carry over.
        c.customDepthMaterial = o.customDepthMaterial;
        c.customDistanceMaterial = o.customDistanceMaterial;
        c.raycast = noRaycast;
        copy.add(c);
      }
      this.below.add(copy);
    }
  }

  /** Build every wall and door afresh, and note what each was built from (`sigs`). */
  private build(scene: Scene, storey: number): void {
    if (this.built) disposeBuilt(this.built);
    this.built = null;
    const pieces: Piece[] = [];
    const sigs = new Map<string, string>();
    let told = true;
    const b = new MeshBuilder();
    const ctx = buildCtxOf(scene, storey);
    const geo = scene.geometry;

    for (const w of geo.walls) {
      const k = `wall:${w.id}`;
      if (sigs.has(k)) told = false;
      sigs.set(k, wallSignature(w));
      if (emitWall(b, w, ctx, 0, WALL, WALL_TOP)) pieces.push({ kind: 'wall', id: w.id, a: w.a, b: w.b });
    }
    for (const d of geo.doors) {
      const k = `door:${d.id}`;
      if (sigs.has(k)) told = false;
      sigs.set(k, doorSignature(d));
      for (const [p, q] of emitDoor(b, d, ctx, 0, DOOR_LOOK)) pieces.push({ kind: 'door', id: d.id, a: p, b: q });
    }

    this.pieces = pieces;
    this.sigs = told ? sigs : null;
    if (b.empty) return;
    const built = b.finish(this.materials);
    if (built.all.length > 0) this.inView.add(...built.all);
    this.built = built;
  }
}
