/**
 * Ephemeral overlay effects: ruler, AoE template + scatter, fog-draft polygon,
 * ping flashes, pointer trails. Ring/dot pools are preallocated and animated
 * by scale/alpha only — no per-frame Graphics rebuilds or allocations.
 */
import { Container, Graphics } from 'pixi.js';
import type { Point } from '@safehouse/contracts';
import {
  groundRadius,
  rectCorners,
  rectPolygon,
  rulerSegments,
  sceneWorldSize,
  worldFromGrid,
  type SceneMetrics,
} from '../geometry.js';
import type {
  AoeTemplate,
  FogDraft,
  MovementThresholds,
  ScatterResult,
  TileRectMode,
} from '../types.js';
import { C, PACE_COLORS } from './colors.js';

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
  private readonly pings: PoolItem[];
  private readonly trail: PoolItem[];

  constructor() {
    this.root.eventMode = 'none';
    this.root.addChild(this.aoe, this.fogDraft, this.segment, this.rectDraft, this.ruler);
    this.trail = makePool(this.root, TRAIL_POOL, (g) => g.circle(0, 0, 4).fill({ color: C.cyan, alpha: 0.9 }));
    this.pings = makePool(this.root, PING_POOL, (g) =>
      g.circle(0, 0, 26).stroke({ width: 4, color: C.magenta, alpha: 1 }),
    );
  }

  /** Draw the measurement line colored by pace band (FR9.8). */
  setRuler(
    m: SceneMetrics,
    from: Point,
    to: Point,
    meters: number,
    thresholds: MovementThresholds | null,
  ): void {
    const g = this.ruler;
    g.clear();
    const walkM = thresholds?.walkM ?? 0;
    const runM = thresholds?.runM ?? 0;
    const segments = rulerSegments(from, to, meters, walkM, runM);
    for (const seg of segments) {
      const a = worldFromGrid(m, seg.from);
      const b = worldFromGrid(m, seg.to);
      g.moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: 3, color: thresholds ? PACE_COLORS[seg.band] : C.cyan, alpha: 0.95 });
    }
    const a = worldFromGrid(m, from);
    const b = worldFromGrid(m, to);
    g.circle(a.x, a.y, 5).fill({ color: C.cyan, alpha: 1 });
    g.circle(b.x, b.y, 5).stroke({ width: 2, color: C.cyan, alpha: 1 });
  }

  clearRuler(): void {
    this.ruler.clear();
  }

  /** AoE circle template + optional scatter render (FR9.12). */
  setAoe(m: SceneMetrics, aoe: AoeTemplate | null, scatter: ScatterResult | null): void {
    const g = this.aoe;
    g.clear();
    if (!aoe) return;
    // A blast radius is measured on the FLOOR, so it projects like the floor:
    // a circle in plan view, a 2:1 ellipse in isometric. Drawn as a plain
    // circle it covered cells nobody could be standing in and missed ones they
    // were — the one overlay whose job is to say who is caught in it.
    const { rx, ry } = groundRadius(m, aoe.radiusM / Math.max(0.01, m.unitM));
    const at = worldFromGrid(m, aoe.center);
    g.ellipse(at.x, at.y, rx, ry)
      .fill({ color: C.magenta, alpha: 0.12 })
      .stroke({ width: 2, color: C.magenta, alpha: 0.85 });
    g.circle(at.x, at.y, 3).fill({ color: C.magenta, alpha: 1 });

    if (scatter) {
      const land = worldFromGrid(m, scatter.to);
      g.moveTo(at.x, at.y).lineTo(land.x, land.y).stroke({ width: 2, color: C.warn, alpha: 0.9 });
      g.ellipse(land.x, land.y, rx, ry)
        .fill({ color: C.danger, alpha: 0.14 })
        .stroke({ width: 2, color: C.danger, alpha: 0.9 });
      const s = 7;
      g.moveTo(land.x - s, land.y - s)
        .lineTo(land.x + s, land.y + s)
        .moveTo(land.x - s, land.y + s)
        .lineTo(land.x + s, land.y - s)
        .stroke({ width: 3, color: C.danger, alpha: 1 });
    }
  }

  /**
   * GM fog-region draft polygon while clicking vertices (FR9.14).
   *
   * Two points preview the RECTANGLE they will save as, projected through the
   * grid. Drawing the bare line between them was honest in plan view and a
   * trap in isometric: "opposite corners" are opposite in grid space, and two
   * clicks that look like a wide diagonal on screen can be nearly collinear on
   * the grid — the GM saw a big box and saved a sliver. Showing the region
   * itself is what lets them see the sliver before it is saved.
   */
  setFogDraft(m: SceneMetrics, draft: FogDraft | null): void {
    const g = this.fogDraft;
    g.clear();
    if (!draft || draft.points.length === 0) return;
    const pts = draft.points.map((p) => worldFromGrid(m, p));
    const first = pts[0];
    if (!first) return;
    if (pts.length === 2) {
      const [a, b] = draft.points as [Point, Point];
      const box = rectPolygon(a, b).map((p) => worldFromGrid(m, p));
      g.poly(box.flatMap((p) => [p.x, p.y]))
        .fill({ color: C.cyan, alpha: 0.08 })
        .stroke({ width: 1.5, color: C.cyan, alpha: 0.6 });
    }
    if (pts.length >= 3) {
      const flat: number[] = [];
      for (const p of pts) flat.push(p.x, p.y);
      g.poly(flat).fill({ color: C.cyan, alpha: 0.08 });
    }
    g.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i += 1) {
      const p = pts[i];
      if (p) g.lineTo(p.x, p.y);
    }
    g.stroke({ width: 2, color: C.cyan, alpha: 0.9 });
    for (const p of pts) g.circle(p.x, p.y, 4).fill({ color: C.cyan, alpha: 1 });
  }

  /**
   * Rubber band while the GM drags a wall or a door (FR9.2). Doors preview in
   * the same green the open state uses so the two tools read apart at a glance.
   */
  setSegmentDraft(m: SceneMetrics, kind: 'wall' | 'door', from: Point, to: Point): void {
    const g = this.segment;
    g.clear();
    const a = worldFromGrid(m, from);
    const b = worldFromGrid(m, to);
    const color = kind === 'door' ? C.ok : C.ink;
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 4, color, alpha: 0.9 });
    g.circle(a.x, a.y, 5).fill({ color, alpha: 1 });
    g.circle(b.x, b.y, 5).stroke({ width: 2, color, alpha: 1 });
  }

  clearSegmentDraft(): void {
    this.segment.clear();
  }

  /**
   * The cells a room or area drag will fill (FR9.2), in the projection the GM
   * is looking at — a rectangle in plan, a diamond in isometric — with the
   * wall ring drawn heavier for a room so the two tools read apart mid-drag.
   */
  setRectDraft(
    m: SceneMetrics,
    mode: TileRectMode,
    from: { col: number; row: number },
    to: { col: number; row: number },
  ): void {
    const g = this.rectDraft;
    g.clear();
    const c0 = Math.min(from.col, to.col);
    const c1 = Math.max(from.col, to.col) + 1;
    const r0 = Math.min(from.row, to.row);
    const r1 = Math.max(from.row, to.row) + 1;
    const outer = rectCorners(m, c0, r0, c1, r1);
    g.poly(outer.flatMap((p) => [p.x, p.y])).fill({ color: C.cyan, alpha: 0.1 });
    if (mode === 'room' && c1 - c0 > 2 && r1 - r0 > 2) {
      // The inside of the wall ring, so the GM sees the floor they get.
      const inner = rectCorners(m, c0 + 1, r0 + 1, c1 - 1, r1 - 1);
      g.poly(inner.flatMap((p) => [p.x, p.y])).fill({ color: C.cyan, alpha: 0.08 });
    }
    g.poly(outer.flatMap((p) => [p.x, p.y])).stroke({
      width: mode === 'room' ? 4 : 2,
      color: C.cyan,
      alpha: 0.9,
    });
  }

  clearRectDraft(): void {
    this.rectDraft.clear();
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
