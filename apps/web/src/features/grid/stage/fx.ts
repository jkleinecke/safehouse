/**
 * Ephemeral overlay effects: ruler, AoE template + scatter, fog-draft polygon,
 * ping flashes, pointer trails. Ring/dot pools are preallocated and animated
 * by scale/alpha only — no per-frame Graphics rebuilds or allocations.
 */
import { Container, Graphics } from 'pixi.js';
import type { Point } from '@safehouse/contracts';
import {
  rulerSegments,
  sceneWorldSize,
  worldFromGrid,
  type SceneMetrics,
} from '../geometry.js';
import type { AoeTemplate, FogDraft, MovementThresholds, ScatterResult } from '../types.js';
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
  private readonly pings: PoolItem[];
  private readonly trail: PoolItem[];

  constructor() {
    this.root.eventMode = 'none';
    this.root.addChild(this.aoe, this.fogDraft, this.ruler);
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
    const radiusPx = (aoe.radiusM / Math.max(0.01, m.unitM)) * m.cell;
    const at = worldFromGrid(m, aoe.center);
    g.circle(at.x, at.y, radiusPx)
      .fill({ color: C.magenta, alpha: 0.12 })
      .stroke({ width: 2, color: C.magenta, alpha: 0.85 });
    g.circle(at.x, at.y, 3).fill({ color: C.magenta, alpha: 1 });

    if (scatter) {
      const land = worldFromGrid(m, scatter.to);
      g.moveTo(at.x, at.y).lineTo(land.x, land.y).stroke({ width: 2, color: C.warn, alpha: 0.9 });
      g.circle(land.x, land.y, radiusPx)
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

  /** GM fog-region draft polygon while clicking vertices (FR9.14). */
  setFogDraft(m: SceneMetrics, draft: FogDraft | null): void {
    const g = this.fogDraft;
    g.clear();
    if (!draft || draft.points.length === 0) return;
    const pts = draft.points.map((p) => worldFromGrid(m, p));
    const first = pts[0];
    if (!first) return;
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
