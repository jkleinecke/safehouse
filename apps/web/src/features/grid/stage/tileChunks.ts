/**
 * The painted floor, in chunks (FR9.2).
 *
 * `drawTiles` draws a whole layer into one graphics, and for a while the stage
 * called it on every brush stroke. With the materials drawn properly — courses,
 * boards, grout, rims — that is 170,000 draw calls for a 40×30 scene, measured
 * at 106–147ms per stroke on a real machine: lag under the brush, on the one
 * tool a GM uses most while building.
 *
 * So the layer is cut into `CHUNK`×`CHUNK` squares, each its own graphics, and
 * a stroke redraws only the chunks it touched (plus their neighbours, because
 * a wall run turns its corners from the cells next door). The three-pass
 * structure survives intact: every floor chunk sits below one shadow graphics,
 * which sits below every standing chunk, which sit below one lights graphics.
 * Shadows and lights are redrawn whole — a few hundred polygons — because they
 * are the two passes that cross chunk borders freely and cost nothing.
 *
 * Standing chunks are ordered by chunk depth exactly as cells are ordered
 * within one. Two cells can only overlap on screen when one is directly in
 * front of the other, and that pair never straddles a chunk boundary in the
 * wrong order: the nearer cell's chunk has the greater depth or the same one,
 * and within a chunk the cell sort still holds.
 */
import { Container, Graphics } from 'pixi.js';
import { metricsKey, type SceneMetrics } from '../geometry.js';
import {
  cellSignatures,
  changedCells,
  chunkDepth,
  chunkKey,
  closeLights,
  dirtyChunks,
  drawAmbientFor,
  drawFloorCell,
  drawLights,
  drawShadowFor,
  drawStandingCell,
  expandCutRuns,
  openLights,
  planTiles,
  type PendingLight,
  type TileCell,
  type TileDrawInput,
  type TilePlan,
} from './tileLayer.js';

export class ChunkedTileLayer {
  readonly root = new Container();
  private readonly floors = new Container();
  private readonly shadows = new Graphics();
  private readonly standing = new Container();
  private readonly lights = new Graphics();
  private readonly floorChunks = new Map<string, Graphics>();
  private readonly standingChunks = new Map<string, Graphics>();
  private readonly chunkLights = new Map<string, PendingLight[]>();
  /** What was drawn last time: the world it belongs to, and each cell's signature. */
  private last: { world: string; cells: Map<string, string>; input: TileDrawInput } | null = null;

  constructor() {
    this.root.eventMode = 'none';
    this.standing.sortableChildren = true;
    this.root.addChild(this.floors, this.shadows, this.standing, this.lights);
  }

  /** Throw everything away; the next update draws from scratch. */
  invalidate(): void {
    this.last = null;
  }

  clear(): void {
    for (const g of this.floorChunks.values()) g.destroy();
    for (const g of this.standingChunks.values()) g.destroy();
    this.floorChunks.clear();
    this.standingChunks.clear();
    this.chunkLights.clear();
    this.shadows.clear();
    this.lights.clear();
    this.last = null;
  }

  /**
   * Bring the layer up to date with `input`.
   *
   * `sceneId` and `level` say which world this is; with the metrics they make
   * the key that decides between "redraw what changed" and "start again".
   */
  update(m: SceneMetrics, input: TileDrawInput, sceneId: string, level: number): void {
    const world = `${sceneId}|L${level}|${input.tilesetId}|${metricsKey(m)}`;
    const cells = cellSignatures(input);
    const plan = planTiles(m, input);

    let dirty: Set<string>;
    if (this.last === null || this.last.world !== world) {
      this.clear();
      dirty = new Set<string>();
      for (const cell of plan.cells) dirty.add(chunkKey(cell.col, cell.row));
    } else {
      // An opening is drawn across its whole run from the run's last cell,
      // so a change to any cell of one widens to all of them, old and new.
      dirty = dirtyChunks(
        expandCutRuns(changedCells(this.last.cells, cells), [this.last.input, input]),
      );
    }
    this.last = { world, cells, input };

    if (dirty.size > 0) {
      const t0 = performance.now();
      const byChunk = new Map<string, TileCell[]>();
      for (const cell of plan.cells) {
        const k = chunkKey(cell.col, cell.row);
        if (!dirty.has(k)) continue;
        let list = byChunk.get(k);
        if (!list) byChunk.set(k, (list = []));
        list.push(cell);
      }
      for (const k of dirty) this.redrawChunk(k, byChunk.get(k) ?? [], m, plan);
      const t1 = performance.now();

      // Shadows and lights: whole passes, both cheap, both border-crossing.
      this.shadows.clear();
      for (const cell of plan.standing) drawAmbientFor(this.shadows, m, cell, plan);
      for (const cell of plan.standing) drawShadowFor(this.shadows, m, cell, plan);
      const t2 = performance.now();
      this.lights.clear();
      for (const lights of this.chunkLights.values()) drawLights(this.lights, m, lights);
      const t3 = performance.now();
      // Measured on a 1,570-cell scene: a stroke redraws two to four chunks in
      // 10–16ms with 5–13ms of shadows on top. Anything well past that is a
      // regression worth seeing without a profiler open.
      if (t3 - t0 > 48) {
        console.debug(
          `[grid] tile chunks: ${dirty.size} dirty, chunks ${(t1 - t0).toFixed(0)}ms, shadows ${(t2 - t1).toFixed(0)}ms, lights ${(t3 - t2).toFixed(0)}ms`,
        );
      }
    }
  }

  private redrawChunk(key: string, cells: readonly TileCell[], m: SceneMetrics, plan: TilePlan): void {
    const floor = this.chunk(this.floorChunks, this.floors, key, 0);
    floor.clear();
    for (const cell of cells) drawFloorCell(floor, m, cell, plan);

    const standing = this.chunk(this.standingChunks, this.standing, key, chunkDepth(key));
    standing.clear();
    openLights();
    for (const cell of cells) {
      if (plan.standing.includes(cell)) drawStandingCell(standing, m, cell, plan);
    }
    const lights = closeLights();
    if (lights.length > 0) this.chunkLights.set(key, lights);
    else this.chunkLights.delete(key);

    // An emptied chunk keeps its graphics: a cleared one costs nothing to keep
    // and a stroke that paints the square back does not have to make it again.
  }

  private chunk(pool: Map<string, Graphics>, parent: Container, key: string, z: number): Graphics {
    let g = pool.get(key);
    if (!g) {
      g = new Graphics();
      g.zIndex = z;
      pool.set(key, g);
      parent.addChild(g);
    }
    return g;
  }
}
