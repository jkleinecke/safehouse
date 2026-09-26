/**
 * The 2D stage's holder for the ephemeral overlay effects: one pixi Graphics
 * per effect, drawn by the pixi-free functions in `fx.ts`, and the ping and
 * trail pools. Ring/dot pools are preallocated and animated by scale/alpha
 * only — no per-frame Graphics rebuilds or allocations.
 */
import { Container, Graphics } from 'pixi.js';
import type { Point } from '@safehouse/contracts';
import { sceneWorldSize, type SceneMetrics } from '../geometry.js';
import type {
  AoeTemplate,
  FogDraft,
  MovementThresholds,
  ScatterResult,
  TileRectMode,
} from '../types.js';
import { C } from './colors.js';
import {
  drawAoe,
  drawArcDraft,
  drawFogDraft,
  drawPaintedGhost,
  drawPaintedSelection,
  drawRectDraft,
  drawRuler,
  drawSegmentDraft,
} from './fx.js';
import type { Ink } from './ink.js';

/**
 * A pixi Graphics IS an Ink — the 2D stage hands its own Graphics to the
 * shared draw functions. Type-level only: this stops compiling the day a
 * pixi upgrade or a new Ink method makes that untrue.
 */
type Assert<T extends true> = T;
type GraphicsIsInk = Assert<Graphics extends Ink ? true : false>;

const PING_LIFE_MS = 950;
const TRAIL_LIFE_MS = 700;
const PING_POOL = 12;
const TRAIL_POOL = 48;

interface PoolItem {
  g: Graphics;
  age: number;
  active: boolean;
}

function makePool(parent: Container, count: number, draw: (g: Graphics) => void): PoolItem[] {
  const items: PoolItem[] = [];
  for (let i = 0; i < count; i += 1) {
    const g = new Graphics();
    draw(g);
    g.visible = false;
    g.eventMode = 'none';
    parent.addChild(g);
    items.push({ g, age: 0, active: false });
  }
  return items;
}

function spawn(pool: PoolItem[], x: number, y: number): void {
  let item = pool.find((p) => !p.active);
  if (!item) {
    // Recycle the oldest.
    item = pool.reduce((a, b) => (a.age >= b.age ? a : b));
  }
  if (!item) return;
  item.active = true;
  item.age = 0;
  item.g.visible = true;
  item.g.x = x;
  item.g.y = y;
  item.g.alpha = 1;
  item.g.scale.set(0.2);
}

export class FxLayer {
  readonly root = new Container();
  private readonly ruler = new Graphics();
  private readonly aoe = new Graphics();
  private readonly fogDraft = new Graphics();
  private readonly segment = new Graphics();
  private readonly rectDraft = new Graphics();
  /** The painted object the GM has selected in Build, and its handles. */
  private readonly paintedSel = new Graphics();
  /** Where a dragged painted object will land. */
  private readonly paintedGhost = new Graphics();
  private readonly pings: PoolItem[];
  private readonly trail: PoolItem[];

  constructor() {
    this.root.eventMode = 'none';
    this.root.addChild(
      this.aoe,
      this.fogDraft,
      this.segment,
      this.rectDraft,
      this.paintedSel,
      this.paintedGhost,
      this.ruler,
    );
    this.trail = makePool(this.root, TRAIL_POOL, (g) => g.circle(0, 0, 4).fill({ color: C.cyan, alpha: 0.9 }));
    this.pings = makePool(this.root, PING_POOL, (g) =>
      g.circle(0, 0, 26).stroke({ width: 4, color: C.magenta, alpha: 1 }),
    );
  }

  /** Draw the measurement line colored by pace band (FR9.8) — see `drawRuler`. */
  setRuler(
    m: SceneMetrics,
    from: Point,
    to: Point,
    meters: number,
    thresholds: MovementThresholds | null,
  ): void {
    drawRuler(this.ruler, m, from, to, meters, thresholds);
  }

  clearRuler(): void {
    this.ruler.clear();
  }

  /** AoE circle template + optional scatter render (FR9.12) — see `drawAoe`. */
  setAoe(m: SceneMetrics, aoe: AoeTemplate | null, scatter: ScatterResult | null): void {
    drawAoe(this.aoe, m, aoe, scatter);
  }

  /** GM fog-region draft polygon while clicking vertices (FR9.14) — see `drawFogDraft`. */
  setFogDraft(m: SceneMetrics, draft: FogDraft | null): void {
    drawFogDraft(this.fogDraft, m, draft);
  }

  /** Rubber band while the GM drags a wall or a door (FR9.2) — see `drawSegmentDraft`. */
  setSegmentDraft(m: SceneMetrics, kind: 'wall' | 'door', from: Point, to: Point): void {
    drawSegmentDraft(this.segment, m, kind, from, to);
  }

  /** The arc wall being placed — see `drawArcDraft`. Shares the segment draft's Graphics. */
  setArcDraft(m: SceneMetrics, a: Point, b: Point, bulge: number): void {
    drawArcDraft(this.segment, m, a, b, bulge);
  }

  clearSegmentDraft(): void {
    this.segment.clear();
  }

  /** The cells a room or area drag will fill (FR9.2) — see `drawRectDraft`. */
  setRectDraft(
    m: SceneMetrics,
    mode: TileRectMode,
    from: { col: number; row: number },
    to: { col: number; row: number },
  ): void {
    drawRectDraft(this.rectDraft, m, mode, from, to);
  }

  clearRectDraft(): void {
    this.rectDraft.clear();
  }

  /** Ring every cell of a selected painted object, and its handles — see `drawPaintedSelection`. */
  setPaintedSelection(m: SceneMetrics, cells: readonly string[], handles: readonly Point[]): void {
    drawPaintedSelection(this.paintedSel, m, cells, handles);
  }

  clearPaintedSelection(): void {
    this.paintedSel.clear();
  }

  /** Where the dragged object will land — see `drawPaintedGhost`. */
  setPaintedGhost(m: SceneMetrics, cells: readonly string[]): void {
    drawPaintedGhost(this.paintedGhost, m, cells);
  }

  clearPaintedGhost(): void {
    this.paintedGhost.clear();
  }

  /** Double-tap flash (FR9.15) — world px. */
  ping(x: number, y: number): void {
    spawn(this.pings, x, y);
  }

  /** Pointer-trail sample (FR9.15) — world px. */
  trailPoint(x: number, y: number): void {
    spawn(this.trail, x, y);
  }

  /** Cover sanity: nothing to draw outside scene bounds. */
  sceneSize(m: SceneMetrics): { width: number; height: number } {
    return sceneWorldSize(m);
  }

  tick(deltaMS: number): void {
    for (const p of this.pings) {
      if (!p.active) continue;
      p.age += deltaMS;
      const t = p.age / PING_LIFE_MS;
      if (t >= 1) {
        p.active = false;
        p.g.visible = false;
        continue;
      }
      p.g.scale.set(0.2 + t * 1.6);
      p.g.alpha = 1 - t;
    }
    for (const d of this.trail) {
      if (!d.active) continue;
      d.age += deltaMS;
      const t = d.age / TRAIL_LIFE_MS;
      if (t >= 1) {
        d.active = false;
        d.g.visible = false;
        continue;
      }
      d.g.scale.set(1 - t * 0.5);
      d.g.alpha = 0.9 * (1 - t);
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
