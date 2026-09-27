/**
 * Ephemeral overlay effects, drawn: ruler, AoE template + scatter, zone
 * draft polygon, wall/door/arc rubber bands, room/area drafts, the fog
 * brush's ring — pure, no three.
 *
 * Each function clears the `Ink` it is handed and draws its effect into it.
 * The 3D stage hands each effect a `FloorInk` of its own
 * (`stage3d/floorInk.ts`), which lays it on the floor in view. (Until P5 the
 * 2D map kept one Graphics per effect, with its ping and trail pools, in its
 * `FxLayer`.) The painted selection and its drag ghost are not flat effects
 * on the 3D map but boxes standing on their squares (`stage3d/selection.ts`).
 */
import { arcPoints, type BrushMark } from '@safehouse/rules';
import type { Point } from '@safehouse/contracts';
import {
  groundRadius,
  rectCorners,
  rectPolygon,
  rulerSegments,
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
import type { Ink } from './ink.js';

/** Draw the measurement line colored by pace band (FR9.8). */
export function drawRuler(
  g: Ink,
  m: SceneMetrics,
  from: Point,
  to: Point,
  meters: number,
  thresholds: MovementThresholds | null,
): void {
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

/** AoE circle template + optional scatter render (FR9.12). A null template draws nothing. */
export function drawAoe(g: Ink, m: SceneMetrics, aoe: AoeTemplate | null, scatter: ScatterResult | null): void {
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
 * The GM's fog brush under the pointer (the fog bar, 2026-09-27): a ring as
 * big as the circle a press will paint, centred where the stroke will put
 * it (`centre`, the snapped centre: `fogBar.ts` `brushCentre`), `radius`
 * squares round, in the colour of what it paints. The colours are the fog
 * outlines' own: green for revealed, amber for seen before, cyan for fogged
 * again. A faint wash inside, so the ring reads as an area rather than a
 * line over a busy floor.
 */
export function drawBrushRing(g: Ink, m: SceneMetrics, centre: Point, radius: number, paint: BrushMark): void {
  g.clear();
  const color = paint === 'live' ? C.ok : paint === 'explored' ? C.warn : C.cyan;
  const { rx, ry } = groundRadius(m, radius);
  const at = worldFromGrid(m, centre);
  g.ellipse(at.x, at.y, rx, ry).fill({ color, alpha: 0.1 }).stroke({ width: 2, color, alpha: 0.9 });
}

/**
 * The zone tool's draft polygon while clicking vertices (FR9.2; fog regions
 * were drafted the same way until the round brush replaced them, FR9.14).
 *
 * Two points preview the RECTANGLE they will save as, projected through the
 * grid. Drawing the bare line between them was honest in plan view and a
 * trap in isometric: "opposite corners" are opposite in grid space, and two
 * clicks that look like a wide diagonal on screen can be nearly collinear on
 * the grid — the GM saw a big box and saved a sliver. Showing the region
 * itself is what lets them see the sliver before it is saved.
 */
export function drawFogDraft(g: Ink, m: SceneMetrics, draft: FogDraft | null): void {
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
export function drawSegmentDraft(g: Ink, m: SceneMetrics, kind: 'wall' | 'door', from: Point, to: Point): void {
  g.clear();
  const a = worldFromGrid(m, from);
  const b = worldFromGrid(m, to);
  const color = kind === 'door' ? C.ok : C.ink;
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 4, color, alpha: 0.9 });
  g.circle(a.x, a.y, 5).fill({ color, alpha: 1 });
  g.circle(b.x, b.y, 5).stroke({ width: 2, color, alpha: 1 });
}

/** The arc wall being placed: the curve, its two ends, and the handle at its middle. */
export function drawArcDraft(g: Ink, m: SceneMetrics, a: Point, b: Point, bulge: number): void {
  g.clear();
  const pts = arcPoints({ id: 'draft', a, b, bulge, tile: '' }, 0.25).map((p) => worldFromGrid(m, p));
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
  g.stroke({ width: 4, color: C.ink, alpha: 0.9 });
  const wa = worldFromGrid(m, a);
  const wb = worldFromGrid(m, b);
  g.circle(wa.x, wa.y, 5).fill({ color: C.ink, alpha: 1 });
  g.circle(wb.x, wb.y, 5).stroke({ width: 2, color: C.ink, alpha: 1 });
  const mid = pts[Math.floor(pts.length / 2)]!;
  g.circle(mid.x, mid.y, 4).stroke({ width: 2, color: C.cyan, alpha: 1 });
}

/**
 * The cells a room or area drag will fill (FR9.2), in the projection the GM
 * is looking at — a rectangle in plan, a diamond in isometric — with the
 * wall ring drawn heavier for a room so the two tools read apart mid-drag.
 */
export function drawRectDraft(
  g: Ink,
  m: SceneMetrics,
  mode: TileRectMode,
  from: { col: number; row: number },
  to: { col: number; row: number },
): void {
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
