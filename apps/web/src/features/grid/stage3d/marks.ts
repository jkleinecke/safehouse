/**
 * Pings and the pointer trail on the 3D map: marks that fade on the floor in
 * view, frame by frame (P1 of the move to 3D).
 *
 * The 2D map draws them in its fx layer (`stage/fx.ts`); this draws the same
 * marks with the same timing and look — a ping's magenta ring grows and
 * fades, a trail dot's cyan disc shrinks and fades — without going through a
 * `FloorInk`, which would build and upload a new geometry every frame one is
 * fading, and a sweep of the Pointer tool keeps some fading the whole time.
 *
 * Instead each kind has a fixed pool of meshes, made as they are first needed
 * and all sharing one unit geometry (a ring for pings, a disc for dots): a
 * frame only moves, scales and fades the ones in use and hides the rest.
 * Each mesh has its own material, for its own opacity; they are all the same
 * shader, so none of them costs a compile.
 *
 * World units are the lab's: x = grid x, z = grid y, y up in squares. Marks
 * are handed over in grid units and lie just over the floor in view, among
 * the flat overlays (`FloorInk`'s lift).
 */
import { CircleGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry, type BufferGeometry } from 'three';
import type { Point } from '@safehouse/contracts';
import { C } from '../stage/colors.js';

/** A ping's and a trail dot's life, and how many of each can be on the floor at once (the 2D fx layer's). */
const PING_LIFE_MS = 950;
const TRAIL_LIFE_MS = 700;
const PING_POOL = 12;
const TRAIL_POOL = 48;
/**
 * The 2D marks' sizes, in the 2D map's world px (a square is `cell` of them):
 * a ping is a ring of radius 26 × s drawn 4 × s wide, s growing 0.2 → 1.8
 * over its life; a trail dot is a disc of radius 4, shrinking to half.
 */
const PING_R_PX = 26;
const PING_W_PX = 4;
const DOT_R_PX = 4;
/** How far above the floor the marks lie, in squares: `FloorInk`'s default lift. */
const LIFT = 0.03;

/** A mark fading on the floor: where (grid units) and since when (`performance.now()`). */
interface Mark {
  x: number;
  y: number;
  born: number;
}

/** One kind of mark: its marks, oldest first, and the meshes that show them. */
interface Pool {
  readonly marks: Mark[];
  readonly meshes: Array<Mesh<BufferGeometry, MeshBasicMaterial>>;
  readonly max: number;
  readonly life: number;
  readonly geometry: BufferGeometry;
  readonly color: number;
  readonly renderOrder: number;
}

/** Where the marks are drawn: the 2D metrics' square size, and the floor in view. */
export interface FloorMarksOptions {
  /** World px per square in the 2D metrics the marks' sizes are given in (`SceneMetrics.cell`). */
  cell: () => number;
  /** World y of the floor in view. Read every frame. */
  floorY: () => number;
  /** Draw order among the flat overlays: dots at this, pings just after. */
  renderOrder: number;
}

/**
 * The pings and the pointer trail of one 3D stage. Add `group` to the scene,
 * `ping`/`trail` as they come, and call `tick` from a before-frame hook: it
 * says whether another frame is wanted.
 */
export class FloorMarks {
  /** Holds every mark's mesh; sits at the floor's height. */
  readonly group = new Group();

  private readonly pings: Pool;
  private readonly dots: Pool;
  private disposed = false;

  constructor(private readonly opts: FloorMarksOptions) {
    this.group.name = 'floor-marks';
    // Unit shapes in 2D world px, flat on the floor; scaled per mark and per square.
    const ring = new RingGeometry(PING_R_PX - PING_W_PX / 2, PING_R_PX + PING_W_PX / 2, 48).rotateX(-Math.PI / 2);
    const disc = new CircleGeometry(DOT_R_PX, 16).rotateX(-Math.PI / 2);
    this.dots = { marks: [], meshes: [], max: TRAIL_POOL, life: TRAIL_LIFE_MS, geometry: disc, color: C.cyan, renderOrder: opts.renderOrder };
    this.pings = { marks: [], meshes: [], max: PING_POOL, life: PING_LIFE_MS, geometry: ring, color: C.magenta, renderOrder: opts.renderOrder + 0.25 };
  }

  /** A ping at grid point `at`, the oldest recycled when the pool is full. False when nothing was added. */
  ping(at: Point): boolean {
    return this.spawn(this.pings, at);
  }

  /** A trail dot at grid point `at`, the oldest recycled when the pool is full. False when nothing was added. */
  trail(at: Point): boolean {
    return this.spawn(this.dots, at);
  }

  /**
   * Show the marks as they stand at frame time `now`: the spent ones gone,
   * the rest grown or shrunk and faded, as on the 2D map. True while any is
   * still fading, so the runtime draws the next frame too.
   */
  tick(now: number): boolean {
    if (this.disposed) return false;
    this.group.position.y = this.opts.floorY();
    const k = 1 / Math.max(1e-6, this.opts.cell());
    // A ping's ring grows as it fades; a trail dot shrinks as it fades.
    const pings = this.show(this.pings, now, (t) => (0.2 + t * 1.6) * k, (t) => 1 - t);
    const dots = this.show(this.dots, now, (t) => (1 - t * 0.5) * k, (t) => 0.9 * (1 - t));
    return pings || dots;
  }

  /** Free the meshes and take the group out of the scene. Marks after this are ignored. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pool of [this.pings, this.dots]) {
      for (const mesh of pool.meshes) mesh.material.dispose();
      pool.meshes.length = 0;
      pool.marks.length = 0;
      pool.geometry.dispose();
    }
    this.group.clear();
    this.group.removeFromParent();
  }

  private spawn(pool: Pool, at: Point): boolean {
    if (this.disposed || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return false;
    if (pool.marks.length >= pool.max) pool.marks.shift();
    pool.marks.push({ x: at.x, y: at.y, born: performance.now() });
    return true;
  }

  /**
   * Lay a pool's live marks on its meshes, each scaled and faded by its age
   * (0 new … 1 spent), and hide the meshes left over. True while any is live.
   */
  private show(pool: Pool, now: number, scale: (t: number) => number, alpha: (t: number) => number): boolean {
    const marks = pool.marks;
    const age = (m: Mark) => Math.max(0, now - m.born) / pool.life;
    // Oldest first: once one is live, every later one is too.
    let spent = 0;
    while (spent < marks.length && age(marks[spent]!) >= 1) spent += 1;
    if (spent > 0) marks.splice(0, spent);
    for (let i = 0; i < marks.length; i += 1) {
      const mark = marks[i]!;
      const t = age(mark);
      const mesh = pool.meshes[i] ?? this.addMesh(pool);
      const s = scale(t);
      mesh.position.set(mark.x, LIFT, mark.y);
      mesh.scale.set(s, 1, s);
      mesh.material.opacity = Math.max(0, alpha(t));
      mesh.visible = true;
    }
    for (let i = marks.length; i < pool.meshes.length; i += 1) pool.meshes[i]!.visible = false;
    return marks.length > 0;
  }

  /** One more mesh for a pool: its shared shape, a material of its own for its opacity. */
  private addMesh(pool: Pool): Mesh<BufferGeometry, MeshBasicMaterial> {
    // Unlit and untone-mapped, depth-tested but not depth-writing, pulled a
    // hair toward the camera: the same terms as every `FloorInk` overlay.
    const material = new MeshBasicMaterial({
      color: pool.color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    const mesh = new Mesh(pool.geometry, material);
    mesh.renderOrder = pool.renderOrder;
    // Marks are never what a click lands on.
    mesh.raycast = () => {};
    mesh.visible = false;
    this.group.add(mesh);
    pool.meshes.push(mesh);
    return mesh;
  }
}
