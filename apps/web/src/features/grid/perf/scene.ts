/**
 * The scripted scene behind the Grid frame-budget harness (DESIGN.md §17.4:
 * "scripted scene with 60 tokens + fog on a throttled headless profile").
 *
 * Pure data — no DOM, no pixi, no network. A benchmark whose scene drifts is a
 * benchmark whose numbers cannot be compared across runs, so every coordinate
 * here comes out of a seeded PRNG and nothing is random at run time, and
 * `scene.test.ts` next door pins the properties any measurement over it would
 * depend on (exactly 60 tokens, all in bounds, none overlapping enough to
 * swallow a drag, fog that actually occludes, a stable seed).
 *
 * `apps/web/e2e/perf.spec.ts` is the harness that consumes it: it POSTs this
 * scene through the real REST routes, stages it on a real GM Grid, drives
 * pan / zoom / a token drag over it under a CPU throttle, and asserts the §15
 * budget against the 95th-percentile frame interval. That spec is skipped
 * unless `SAFEHOUSE_PERF=1`, because a throttled timing run does not belong in
 * a blocking suite; CI's `perf` job sets it.
 *
 * Sizing rationale: 40×30 squares at 1 m is a warehouse floor — the kind of map
 * a Shadowrun firefight actually happens on, big enough that a fitted camera
 * puts every one of the 60 tokens on screen at once (which is the worst case for
 * the renderer, and therefore the case worth measuring).
 */
import type { Grid, FogRegion, Point, SceneGeometry } from '@safehouse/contracts';

/** Deterministic scene dimensions — see the module docblock. */
export const PERF_GRID: Grid = {
  unitM: 1,
  cols: 40,
  rows: 30,
  offset: { x: 0, y: 0 }, projection: 'topdown' as const,
  opacity: 0.35,
};

/** §17.4's number. Not a parameter: the budget is quoted against sixty. */
export const PERF_TOKEN_COUNT = 60;

/**
 * The token the drag phase grabs, by name.
 *
 * It sits at the EXACT centre of the map and is 3×3, which is not decoration:
 * a fitted camera puts the map's centre on the canvas's centre, so the harness
 * can press the middle of the canvas and know which token it grabbed without
 * reimplementing the camera's projection in the test — and a 1.5-cell hit
 * radius means a few pixels of layout drift cannot turn the drag phase into a
 * silent pan that measures nothing. `scene.test.ts` pins the property the trick
 * depends on: no OTHER token's hit circle contains this one's centre.
 */
export const DRAG_ANCHOR_NAME = 'Bench-Anchor';

/** Where the anchor sits, in grid units — the middle of the map. */
export const DRAG_ANCHOR_AT = { x: PERF_GRID.cols / 2, y: PERF_GRID.rows / 2 };

/** The POST body `/api/scenes/:id/tokens` takes, narrowed to what we set. */
export interface PerfTokenSpec {
  name: string;
  x: number;
  y: number;
  size: number;
  source: 'prop' | 'npc_template' | 'character' | 'combatant';
  level: 0,
  barsVisibility: 'gm' | 'owner' | 'public';
  aura?: { radiusM: number; color?: string };
}

/** mulberry32 — same generator family the NPC generator uses, 32 bits, seeded. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sixty tokens on a jittered 10×6 lattice.
 *
 * A lattice rather than uniform noise, because uniform noise clusters: two
 * tokens on top of each other are cheaper to draw than two apart (same overdraw,
 * fewer distinct label textures) AND they break the drag step, since
 * `hitToken` would pick whichever is on top. The jitter is ±0.35 of a cell —
 * enough that nothing looks machine-placed, small enough that the minimum
 * centre-to-centre gap stays above the largest token's radius.
 *
 * The mix — mostly 1×1 with a few 2×2 and one 3×3, a handful carrying an aura
 * ring (FR9.6) — is what a staged fight looks like: runners, grunts, a spirit,
 * a drone with a jammer bubble.
 *
 * One of the sixty is then moved onto the exact centre of the map and grown to
 * 3×3 — the drag anchor (see `DRAG_ANCHOR_NAME`). The slot sacrificed is
 * whichever lattice point was already nearest the middle, so the pattern stays
 * even and the count stays at sixty.
 */
export function perfTokens(count = PERF_TOKEN_COUNT): PerfTokenSpec[] {
  const rand = prng(0x5afe4005);
  const cols = 10;
  const rows = Math.ceil(count / cols);
  const stepX = PERF_GRID.cols / (cols + 1);
  const stepY = PERF_GRID.rows / (rows + 1);
  const out: PerfTokenSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    // Big tokens are rare and evenly spread rather than bunched at the end.
    const size = i % 17 === 3 ? 3 : i % 7 === 2 ? 2 : 1;
    const spec: PerfTokenSpec = {
      name: `Bench-${String(i + 1).padStart(2, '0')}`,
      x: round2((cx + 1) * stepX + (rand() - 0.5) * 0.7),
      y: round2((cy + 1) * stepY + (rand() - 0.5) * 0.7),
      size,
      source: i % 5 === 0 ? 'npc_template' : 'prop',
      level: 0,
      barsVisibility: 'public',
    };
    if (i % 11 === 4) spec.aura = { radiusM: 3 + (i % 3), color: '#c026d3' };
    out.push(spec);
  }

  const anchor = out[nearestToCentre(out)];
  if (anchor) {
    anchor.name = DRAG_ANCHOR_NAME;
    anchor.x = DRAG_ANCHOR_AT.x;
    anchor.y = DRAG_ANCHOR_AT.y;
    anchor.size = 3;
    delete anchor.aura;
  }
  return out;
}

/** Index of the token whose lattice slot is closest to the map's middle. */
function nearestToCentre(tokens: readonly PerfTokenSpec[]): number {
  let best = 0;
  let bestDist = Infinity;
  tokens.forEach((token, i) => {
    const d = Math.hypot(token.x - DRAG_ANCHOR_AT.x, token.y - DRAG_ANCHOR_AT.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Axis-aligned rectangle as the 4-point polygon the fog schema wants. */
function rect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * Eight named fog regions laid out as rooms off a central corridor, three of
 * them already revealed.
 *
 * Both states matter to the measurement. A revealed region is a `.cut()` on the
 * fog Graphics — the expensive path, because the cover has to be re-tessellated
 * around every hole. An unrevealed one still costs the GM an outline and a
 * pooled label. Revealing nothing would measure a single filled rectangle and
 * report a budget the real table never sees.
 */
export function perfFog(): { regions: FogRegion[]; revealedIds: string[] } {
  const regions: FogRegion[] = [
    { id: 'perf-fog-1', name: 'Loading dock', polygon: rect(1, 1, 12, 9) },
    { id: 'perf-fog-2', name: 'Cold store', polygon: rect(14, 1, 25, 9) },
    { id: 'perf-fog-3', name: 'Office block', polygon: rect(27, 1, 38, 9) },
    { id: 'perf-fog-4', name: 'Corridor', polygon: rect(1, 11, 38, 15) },
    { id: 'perf-fog-5', name: 'Machine floor', polygon: rect(1, 17, 12, 28) },
    { id: 'perf-fog-6', name: 'Server cage', polygon: rect(14, 17, 25, 22) },
    { id: 'perf-fog-7', name: 'Sub-basement stair', polygon: rect(14, 24, 25, 28) },
    { id: 'perf-fog-8', name: 'Rooftop access', polygon: rect(27, 17, 38, 28) },
  ];
  return { regions, revealedIds: ['perf-fog-1', 'perf-fog-4', 'perf-fog-6'] };
}

/**
 * Walls, doors and pins for the same floorplan (FR9.2/9.3).
 *
 * Not decoration: on a GM screen these are three more Graphics rebuilds in
 * `update()` and three more layers under the camera transform every frame. A
 * scene of bare tokens over bare fog would flatter the renderer.
 */
export function perfGeometry(): SceneGeometry {
  const walls = [];
  for (let i = 0; i < 24; i += 1) {
    const y = i < 12 ? 10 : 16;
    const x = (i % 12) * 3 + 1;
    walls.push({ id: `perf-wall-${i}`, a: { x, y }, b: { x: x + 2, y } });
  }
  const doors = [
    { id: 'perf-door-1', a: { x: 6, y: 10 }, b: { x: 8, y: 10 }, open: true, locked: false },
    { id: 'perf-door-2', a: { x: 19, y: 10 }, b: { x: 21, y: 10 }, open: false, locked: false },
    { id: 'perf-door-3', a: { x: 6, y: 16 }, b: { x: 8, y: 16 }, open: false, locked: false },
    { id: 'perf-door-4', a: { x: 31, y: 16 }, b: { x: 33, y: 16 }, open: true, locked: false },
  ];
  const pins = [
    { id: 'perf-pin-1', at: { x: 6, y: 5 }, label: 'Truck bay', visibility: 'public' as const },
    { id: 'perf-pin-2', at: { x: 20, y: 5 }, label: 'Freezer door', visibility: 'gm' as const },
    { id: 'perf-pin-3', at: { x: 33, y: 5 }, label: 'Site manager', visibility: 'gm' as const },
    { id: 'perf-pin-4', at: { x: 6, y: 22 }, label: 'Press line', visibility: 'public' as const },
    { id: 'perf-pin-5', at: { x: 20, y: 19 }, label: 'Rack 4', visibility: 'gm' as const },
    { id: 'perf-pin-6', at: { x: 33, y: 22 }, label: 'Stair head', visibility: 'public' as const },
  ];
  return { walls, doors, zones: [], pins };
}

/**
 * The spec named by `DRAG_ANCHOR_NAME`, or null if the scene was built with too
 * few tokens for one to exist.
 */
export function dragAnchor(tokens: readonly PerfTokenSpec[]): PerfTokenSpec | null {
  return tokens.find((t) => t.name === DRAG_ANCHOR_NAME) ?? null;
}

/**
 * `hitToken`'s rule, restated for the harness: the token a press at `at` grabs
 * is the closest one whose circle (radius `max(0.4, size/2)`) contains it.
 *
 * Duplicated deliberately rather than imported from `stage/hit.ts`. The unit
 * test uses this to prove a press on the canvas centre can only land on the
 * anchor; importing the implementation would make that check tautological.
 */
export function tokenHitAt(tokens: readonly PerfTokenSpec[], at: Point): PerfTokenSpec | null {
  let best: PerfTokenSpec | null = null;
  let bestDist = Infinity;
  for (const token of tokens) {
    const radius = Math.max(0.4, token.size / 2);
    const d = Math.hypot(at.x - token.x, at.y - token.y);
    if (d > radius) continue;
    if (d <= bestDist) {
      bestDist = d;
      best = token;
    }
  }
  return best;
}
