/**
 * The scripted scene the frame-budget harness measures over, pinned.
 *
 * These are not "does the array have 60 entries" tests for their own sake.
 * Every property here is one the measurement silently depends on, and each one
 * has a specific way of going wrong that would leave the harness green and the
 * number meaningless:
 *
 *  - fewer than 60 tokens → the budget is quoted against a scene §17.4 does not
 *    describe;
 *  - a drifting seed → this week's p95 cannot be compared with last week's;
 *  - a token whose hit circle covers the map's centre → the drag phase grabs
 *    the wrong token, or pans instead, and measures a gesture nobody made;
 *  - fog that reveals nothing (or everything) → the `.cut()` path that costs
 *    the most is never exercised.
 */
import { describe, expect, it } from 'vitest';
import {
  DRAG_ANCHOR_AT,
  DRAG_ANCHOR_NAME,
  PERF_GRID,
  PERF_TOKEN_COUNT,
  dragAnchor,
  perfFog,
  perfGeometry,
  perfTokens,
  tokenHitAt,
} from './scene.js';

describe('perfTokens', () => {
  const tokens = perfTokens();

  it('is exactly the sixty §17.4 asks for, with unique names', () => {
    expect(PERF_TOKEN_COUNT).toBe(60);
    expect(tokens).toHaveLength(60);
    expect(new Set(tokens.map((t) => t.name)).size).toBe(60);
  });

  it('is deterministic — the same scene every run', () => {
    // Two independent calls, not a cached reference: a `Math.random` slipping
    // into the generator would make every future comparison worthless.
    expect(perfTokens()).toEqual(perfTokens());
  });

  it('keeps every token inside the map, including its own footprint', () => {
    for (const t of tokens) {
      const r = t.size / 2;
      expect(t.x - r, t.name).toBeGreaterThanOrEqual(0);
      expect(t.y - r, t.name).toBeGreaterThanOrEqual(0);
      expect(t.x + r, t.name).toBeLessThanOrEqual(PERF_GRID.cols);
      expect(t.y + r, t.name).toBeLessThanOrEqual(PERF_GRID.rows);
    }
  });

  it('mixes footprints and auras, so the renderer is not drawing 60 of one thing', () => {
    const sizes = new Set(tokens.map((t) => t.size));
    expect(sizes.size).toBeGreaterThanOrEqual(3);
    expect(tokens.filter((t) => t.aura).length).toBeGreaterThan(0);
  });

  it('never puts one token centre inside another token circle', () => {
    // The property `hitToken` needs to stay unambiguous: pressing dead on any
    // token must grab that token. Overlapping circles would make the drag
    // phase's target depend on array order.
    for (const token of tokens) {
      const hit = tokenHitAt(tokens, { x: token.x, y: token.y });
      expect(hit?.name, `press on ${token.name} grabbed ${hit?.name ?? 'nothing'}`).toBe(token.name);
    }
  });
});

describe('the drag anchor', () => {
  const tokens = perfTokens();

  it('sits on the exact centre of the map', () => {
    const anchor = dragAnchor(tokens);
    expect(anchor).not.toBeNull();
    expect(anchor?.name).toBe(DRAG_ANCHOR_NAME);
    expect(anchor?.x).toBe(DRAG_ANCHOR_AT.x);
    expect(anchor?.y).toBe(DRAG_ANCHOR_AT.y);
    expect(DRAG_ANCHOR_AT).toEqual({ x: PERF_GRID.cols / 2, y: PERF_GRID.rows / 2 });
  });

  it('is the only token a press on the map centre can grab', () => {
    // This is what lets the harness press the middle of the canvas instead of
    // reimplementing the camera projection. If it ever stops holding, the drag
    // phase becomes a pan and measures the wrong gesture.
    expect(tokenHitAt(tokens, DRAG_ANCHOR_AT)?.name).toBe(DRAG_ANCHOR_NAME);
  });

  it('has enough slack that a few pixels of layout drift still hits it', () => {
    const anchor = dragAnchor(tokens);
    const radius = (anchor?.size ?? 0) / 2;
    expect(radius).toBeGreaterThanOrEqual(1.5);
    // Nearest neighbour must be outside that radius by a clear margin.
    const nearest = Math.min(
      ...tokens
        .filter((t) => t.name !== DRAG_ANCHOR_NAME)
        .map((t) => Math.hypot(t.x - DRAG_ANCHOR_AT.x, t.y - DRAG_ANCHOR_AT.y)),
    );
    expect(nearest).toBeGreaterThan(radius + 0.5);
  });

  it('reports null on a scene too small to have one', () => {
    expect(dragAnchor([])).toBeNull();
  });
});

describe('perfFog', () => {
  const { regions, revealedIds } = perfFog();

  it('exercises both fog states — some revealed, most not', () => {
    expect(regions.length).toBeGreaterThanOrEqual(6);
    expect(revealedIds.length).toBeGreaterThan(0);
    expect(revealedIds.length).toBeLessThan(regions.length);
  });

  it('reveals only regions that exist', () => {
    const ids = new Set(regions.map((r) => r.id));
    for (const id of revealedIds) expect(ids.has(id), id).toBe(true);
    expect(new Set(ids).size).toBe(regions.length);
  });

  it('covers a real share of the map, so the cover is not a token-sized patch', () => {
    let covered = 0;
    for (const region of regions) {
      const xs = region.polygon.map((p) => p.x);
      const ys = region.polygon.map((p) => p.y);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      expect(region.polygon.length).toBeGreaterThanOrEqual(3);
      expect(w * h, region.name).toBeGreaterThan(0);
      covered += w * h;
    }
    const map = PERF_GRID.cols * PERF_GRID.rows;
    expect(covered / map).toBeGreaterThan(0.5);
  });

  it('stays inside the map', () => {
    for (const region of regions) {
      for (const p of region.polygon) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(PERF_GRID.cols);
        expect(p.y).toBeLessThanOrEqual(PERF_GRID.rows);
      }
    }
  });
});

describe('perfGeometry', () => {
  const geometry = perfGeometry();

  it('gives the renderer walls, doors and pins to rebuild, not an empty layer', () => {
    expect(geometry.walls.length).toBeGreaterThanOrEqual(20);
    expect(geometry.doors.length).toBeGreaterThanOrEqual(4);
    expect(geometry.pins.length).toBeGreaterThanOrEqual(4);
  });

  it('has both door states and both pin visibilities', () => {
    // A GM screen draws an open door differently from a shut one, and a GM-only
    // pin differently from a public one — measure both paths.
    expect(new Set(geometry.doors.map((d) => d.open))).toEqual(new Set([true, false]));
    expect(new Set(geometry.pins.map((p) => p.visibility))).toEqual(new Set(['gm', 'public']));
  });

  it('uses unique ids and stays inside the map', () => {
    const ids = [
      ...geometry.walls.map((w) => w.id),
      ...geometry.doors.map((d) => d.id),
      ...geometry.pins.map((p) => p.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    const inside = (p: { x: number; y: number }) =>
      p.x >= 0 && p.y >= 0 && p.x <= PERF_GRID.cols && p.y <= PERF_GRID.rows;
    for (const w of geometry.walls) expect(inside(w.a) && inside(w.b), w.id).toBe(true);
    for (const d of geometry.doors) expect(inside(d.a) && inside(d.b), d.id).toBe(true);
    for (const p of geometry.pins) expect(inside(p.at), p.id).toBe(true);
  });
});
