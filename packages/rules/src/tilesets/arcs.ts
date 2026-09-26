/**
 * Walls at any angle, and curved walls (contracts: `ArcWallSchema`).
 *
 * An arc is stored as its two ends and a bulge — the sagitta, how far the
 * middle of the wall stands off the straight line between them, to the LEFT
 * of a→b as the grid is drawn (y down). Everything else is derived here, in
 * one place, so the renderer that draws an arc, the sight model that blocks
 * on it and the tool that places it cannot disagree about where it runs.
 */

export interface ArcLike {
  id: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
  bulge: number;
  tile: string;
}

type Pt = { x: number; y: number };

/** The circle an arc lies on, or null for a straight wall. */
export function arcCircle(arc: ArcLike): { cx: number; cy: number; r: number; start: number; sweep: number } | null {
  const s = arc.bulge ?? 0;
  const dx = arc.b.x - arc.a.x;
  const dy = arc.b.y - arc.a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9 || Math.abs(s) < 1e-3) return null;
  // Left of a→b, with y down: (dy, -dx).
  const nx = dy / L;
  const ny = -dx / L;
  const mx = (arc.a.x + arc.b.x) / 2;
  const my = (arc.a.y + arc.b.y) / 2;
  const r = (L * L) / 4 / (2 * Math.abs(s)) + Math.abs(s) / 2;
  // The centre sits on the far side of the chord from the bulge.
  const k = Math.sign(s) * (Math.abs(s) - r);
  const cx = mx + nx * k;
  const cy = my + ny * k;
  const start = Math.atan2(arc.a.y - cy, arc.a.x - cx);
  const apex = Math.atan2(my + ny * s - cy, mx + nx * s - cx);
  let half = apex - start;
  while (half > Math.PI) half -= Math.PI * 2;
  while (half <= -Math.PI) half += Math.PI * 2;
  return { cx, cy, r, start, sweep: half * 2 };
}

/** The arc's length, in squares. */
export function arcLength(arc: ArcLike): number {
  const c = arcCircle(arc);
  if (c === null) return Math.hypot(arc.b.x - arc.a.x, arc.b.y - arc.a.y);
  return Math.abs(c.sweep) * c.r;
}

/** Points along the arc, `a` to `b` inclusive, no more than `step` squares apart. */
export function arcPoints(arc: ArcLike, step = 0.25): Pt[] {
  const n = Math.max(1, Math.ceil(arcLength(arc) / Math.max(0.01, step)));
  const c = arcCircle(arc);
  const out: Pt[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    if (c === null) {
      out.push({ x: arc.a.x + (arc.b.x - arc.a.x) * t, y: arc.a.y + (arc.b.y - arc.a.y) * t });
    } else {
      const th = c.start + c.sweep * t;
      out.push({ x: c.cx + Math.cos(th) * c.r, y: c.cy + Math.sin(th) * c.r });
    }
  }
  return out;
}

/**
 * The squares an arc passes through, as `"col,row"` keys, in order along it.
 * Sampled finely enough that no square it crosses is skipped; where it passes
 * exactly through a corner the two squares it touches diagonally are enough —
 * a sightline cannot slip between two diagonal blockers (vision/los.ts).
 */
export function arcCells(arc: ArcLike): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of arcPoints(arc, 0.05)) {
    const k = `${Math.floor(p.x)},${Math.floor(p.y)}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** The shortest distance from a point to an arc, in squares — for picking one up. */
export function distanceToArc(arc: ArcLike, p: Pt): number {
  const c = arcCircle(arc);
  if (c === null) {
    const dx = arc.b.x - arc.a.x;
    const dy = arc.b.y - arc.a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - arc.a.x) * dx + (p.y - arc.a.y) * dy) / len2));
    return Math.hypot(p.x - (arc.a.x + dx * t), p.y - (arc.a.y + dy * t));
  }
  let best = Infinity;
  for (const q of arcPoints(arc, 0.1)) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
  return best;
}

/** The bulge that puts an arc's middle through point `p` — how the tool reads the pointer. */
export function bulgeThrough(a: Pt, b: Pt, p: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return 0;
  // Signed distance from the chord, positive to the left of a→b.
  return ((p.x - a.x) * dy - (p.y - a.y) * dx) / L;
}
