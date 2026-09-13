/**
 * Water is a body of water, not a floor with waves on it (FR9.2).
 *
 * What is pinned here is what made the old water look like forty framed
 * pictures of water: that a square knows its neighbours. Distance from the
 * shore is real, reed beds stand in the water beside them, ripples cross
 * square borders unbroken, the land drops to the waterline in isometric and
 * not in plan, a beach runs under instead of walling off, things afloat sit
 * below the land — and a stroke three squares from the water still redraws
 * the water it changed.
 */
import { describe, expect, it } from 'vitest';
import type { Graphics } from 'pixi.js';
import { TILESETS } from '@safehouse/rules';
import { gridFromWorld, metricsFor } from '../geometry.js';
import { tileDefKey, tileDefsFromSets, type TileDrawDef } from '../types.js';
import { drawProp } from './props.js';
import { cellSignatures, drawStandingCell, planTiles } from './tileLayer.js';
import { drawShoreTop, drawWaterCell, farWalls, mapWater, SHORE_DROP, WATER_LEVEL, waterSink, type WaterEntry } from './water.js';

const iso = metricsFor({ unitM: 1, cols: 16, rows: 16, offset: { x: 0, y: 0 }, projection: 'iso' as const });
const plan = metricsFor({ unitM: 1, cols: 16, rows: 16, offset: { x: 0, y: 0 }, projection: 'topdown' as const });

const defs = tileDefsFromSets(TILESETS);
const def = (set: string, id: string): TileDrawDef => {
  const d = defs[tileDefKey(set, id)];
  if (!d) throw new Error(`no ${set}/${id}`);
  return d;
};
const HARBOUR = def('marina', 'harbour');
const SHALLOWS = def('marina', 'shallows');
const QUAY = def('marina', 'quay');
const BEACH = def('marina', 'beach');
const PIERWALL = def('marina', 'pierwall');
const REEDS = def('lake', 'reeds');
const DEEP = def('lake', 'deep');

interface Call {
  op: string;
  args: number[];
}

function recorder(): { g: Graphics; calls: Call[] } {
  const calls: Call[] = [];
  const g: Record<string, unknown> = {};
  for (const op of ['clear', 'rect', 'fill', 'moveTo', 'lineTo', 'stroke', 'circle', 'ellipse', 'closePath']) {
    g[op] = (...args: number[]) => {
      calls.push({ op, args });
      return g;
    };
  }
  return { g: g as unknown as Graphics, calls };
}

/** Squares of one tile over a rectangle, as plan entries. */
function area(c0: number, r0: number, c1: number, r1: number, d: TileDrawDef): WaterEntry[] {
  const out: WaterEntry[] = [];
  for (let col = c0; col <= c1; col += 1) for (let row = r0; row <= r1; row += 1) out.push({ col, row, def: d, layer: 0 });
  return out;
}

/** Later entries win a square, as painting over does. */
const floor = (...parts: WaterEntry[][]) => parts.flat();

const count = (calls: readonly Call[], op: string) => calls.filter((c) => c.op === op).length;

describe('the water knows where the shore is', () => {
  it('measures distance from the land, square by square, and not from the edge of the map', () => {
    // Quay along row 0, water below it, running off the bottom of the map.
    const map = mapWater(floor(area(0, 1, 5, 7, HARBOUR), area(0, 0, 5, 0, QUAY)));
    expect(map.water.get('2,1')!.dist).toBe(1);
    expect(map.water.get('2,2')!.dist).toBe(2);
    expect(map.water.get('2,3')!.dist).toBe(3);
    // The map's own edge is not a shore: water running off it stays open.
    expect(map.water.get('0,5')!.dist).toBe(map.water.get('3,5')!.dist);
    expect(map.water.get('3,7')!.dist).toBeGreaterThan(3);
  });

  it('shelves: water is lighter by the shore than out in the open', () => {
    const map = mapWater(floor(area(0, 1, 5, 7, HARBOUR), area(0, 0, 5, 0, QUAY)));
    const v = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff);
    expect(v(map.water.get('2,1')!.surface)).toBeGreaterThan(v(map.water.get('2,2')!.surface));
    expect(v(map.water.get('2,2')!.surface)).toBeGreaterThan(v(map.water.get('2,6')!.surface));
  });

  it('stands a reed bed in the water beside it rather than painting green water', () => {
    const map = mapWater(floor(area(0, 0, 6, 6, DEEP), area(3, 3, 3, 3, REEDS)));
    const reed = map.water.get('3,3')!;
    const open = map.water.get('2,3')!;
    // The reeds' own palette is green; the water it stands in is the lake's.
    expect(reed.deep).toBe(open.deep);
  });

  it('blends a deep tile into a shallows tile beside it', () => {
    const map = mapWater(floor(area(0, 0, 3, 6, HARBOUR), area(4, 0, 7, 6, SHALLOWS)));
    const a = map.water.get('3,3')!.deep;
    const b = map.water.get('4,3')!.deep;
    const far = map.water.get('0,3')!.deep;
    // Either side of the join is closer to the other than open harbour is.
    expect(Math.abs((a & 0xff) - (b & 0xff))).toBeLessThan(Math.abs((far & 0xff) - (b & 0xff)));
  });
});

describe('a square of water is drawn as part of a body', () => {
  it('runs its ripples straight across the border into the next square', () => {
    // Open water, no land anywhere: ripples at full strength in every square.
    const map = mapWater(area(0, 0, 11, 11, HARBOUR));
    const ends = (col: number, row: number) => {
      const r = recorder();
      drawWaterCell(r.g, iso, col, row, map);
      const pts: Array<{ x: number; y: number }> = [];
      let run: Call[] = [];
      for (const c of r.calls) {
        if (c.op === 'moveTo' || c.op === 'lineTo') run.push(c);
        else if (c.op === 'stroke') {
          if (run.length > 0) {
            pts.push({ x: run[0]!.args[0]!, y: run[0]!.args[1]! });
            pts.push({ x: run[run.length - 1]!.args[0]!, y: run[run.length - 1]!.args[1]! });
          }
          run = [];
        } else run = [];
      }
      return pts;
    };
    // Along a row of squares, every ripple end one square leaves on the
    // border with the next (grid x = col + 1, give or take the ripple's own
    // wobble)…
    let checked = 0;
    for (let col = 1; col < 10; col += 1) {
      const a = ends(col, 5);
      const b = ends(col + 1, 5);
      const onBorder = a.filter((p) => Math.abs(gridFromWorld(iso, p).x - (col + 1)) < 0.015);
      // …the next square picks up at the same point.
      for (const p of onBorder) {
        checked += 1;
        expect(b.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.75), `ripple broken at ${p.x},${p.y}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(2);
  });

  it('drops a quay wall to the waterline in isometric, and draws the plan symbol instead in plan', () => {
    const withQuay = mapWater(floor(area(0, 0, 4, 4, HARBOUR), area(0, 0, 4, 0, QUAY)));
    const open = mapWater(area(0, 0, 4, 4, HARBOUR));
    const draw = (m: typeof iso, map: ReturnType<typeof mapWater>) => {
      const r = recorder();
      drawWaterCell(r.g, m, 2, 1, map);
      return r.calls;
    };
    // The wall is several more polygons than open water in isometric.
    expect(count(draw(iso, withQuay), 'fill') - count(draw(iso, open), 'fill')).toBeGreaterThanOrEqual(4);
    // The wall is made of the quay's warm stone; water is cool. In isometric
    // some fill takes the wall's colour; in plan none does — it is a line.
    const fillColours = (calls: Call[]) =>
      calls.filter((c) => c.op === 'fill').map((c) => (c.args[0] as unknown as { color: number }).color);
    const warm = (c: number) => ((c >> 16) & 0xff) > (c & 0xff);
    expect(fillColours(draw(iso, withQuay)).some(warm)).toBe(true);
    const planCalls = draw(plan, withQuay);
    expect(fillColours(planCalls).filter(warm)).toEqual([]);
    // The quay's plan symbol: the wall's heavy line along the edge.
    const heavy = (calls: Call[]) =>
      calls.filter((c, i) => {
        if (c.op !== 'stroke' || (c.args[0] as unknown as { width?: number }).width !== 2) return false;
        const path: Call[] = [];
        for (let j = i - 1; j >= 0 && (calls[j]!.op === 'moveTo' || calls[j]!.op === 'lineTo'); j -= 1) path.push(calls[j]!);
        return path.length >= 2 && path.every((p) => Math.abs(gridFromWorld(plan, { x: p.args[0]!, y: p.args[1]! }).y - 1) < 0.02);
      }).length;
    expect(heavy(planCalls)).toBeGreaterThan(0);
    expect(heavy(draw(plan, open))).toBe(0);
  });

  it('lets a beach run under the water: no wall, however it is projected', () => {
    const withQuay = mapWater(floor(area(0, 0, 4, 4, HARBOUR), area(0, 0, 4, 0, QUAY)));
    const withBeach = mapWater(floor(area(0, 0, 4, 4, HARBOUR), area(0, 0, 4, 0, BEACH), area(0, 0, 0, 4, BEACH)));
    // The decision the renderer draws from: a quay drops, a beach does not…
    expect(farWalls(withQuay, iso, 2, 1)).toEqual({ n: SHORE_DROP.quay, w: 0, nw: SHORE_DROP.quay });
    expect(farWalls(withBeach, iso, 1, 1)).toEqual({ n: 0, w: 0, nw: 0 });
    // …and nothing drops in plan, where there is no height to drop through.
    expect(farWalls(withQuay, plan, 2, 1)).toEqual({ n: 0, w: 0, nw: 0 });
    // What that looks like: the quay's warm stone shows; the beach's sand
    // only ever tints the water.
    const warmWall = (map: ReturnType<typeof mapWater>, col: number) => {
      const r = recorder();
      drawWaterCell(r.g, iso, col, 1, map);
      return r.calls.filter((c) => c.op === 'fill' && ((c.args[0] as unknown as { alpha?: number }).alpha ?? 1) === 1).map((c) => (c.args[0] as unknown as { color: number }).color).filter((c) => ((c >> 16) & 0xff) > ((c & 0xff) + 12));
    };
    expect(warmWall(withQuay, 2).length).toBeGreaterThan(0);
    expect(warmWall(withBeach, 1)).toEqual([]);
  });

  it('keeps a square of water inside its own square in plan, whatever shore surrounds it', () => {
    for (const shore of [QUAY, BEACH, PIERWALL, def('park', 'grass')]) {
      const map = mapWater(floor(area(0, 0, 4, 4, shore), area(2, 2, 2, 2, HARBOUR)));
      const r = recorder();
      drawWaterCell(r.g, plan, 2, 2, map);
      for (const c of r.calls) {
        if (!['moveTo', 'lineTo', 'circle', 'ellipse'].includes(c.op)) continue;
        const p = gridFromWorld(plan, { x: c.args[0]!, y: c.args[1]! });
        expect(p.x, `${shore.pattern} x`).toBeGreaterThan(2 - 2 / plan.cell);
        expect(p.x, `${shore.pattern} x`).toBeLessThan(3 + 2 / plan.cell);
        expect(p.y, `${shore.pattern} y`).toBeGreaterThan(2 - 2 / plan.cell);
        expect(p.y, `${shore.pattern} y`).toBeLessThan(3 + 2 / plan.cell);
      }
    }
  });

  it('shows how the land meets the water on the land itself', () => {
    const wet = mapWater(floor(area(0, 0, 4, 4, HARBOUR), area(0, 0, 4, 1, BEACH)));
    const dry = mapWater(area(0, 0, 4, 4, BEACH));
    const r1 = recorder();
    drawShoreTop(r1.g, iso, 2, 1, wet);
    const r2 = recorder();
    drawShoreTop(r2.g, iso, 2, 1, dry);
    expect(count(r1.calls, 'fill')).toBeGreaterThan(2);
    expect(r2.calls.length).toBe(0);
  });
});

describe('things afloat', () => {
  it('sit below the land in isometric, and exactly where they are in plan', () => {
    expect(waterSink(iso)).toBe(WATER_LEVEL);
    expect(waterSink(plan)).toBe(0);
    const tones = { base: 0x8f8776, accent: 0x9b9382, light: 0xa9a08e, dark: 0x786f60, ink: 0x5a5347 };
    const unit = iso.cell * 0.5;
    const dry = recorder();
    drawProp(dry.g, iso, 'boat', 3, 4, 0.5, unit, tones, 7, null);
    const afloat = recorder();
    drawProp(afloat.g, iso, 'boat', 3, 4, 0.5, unit, tones, 7, null, WATER_LEVEL);
    const ys = (calls: Call[]) => calls.filter((c) => c.op === 'moveTo').map((c) => c.args[1]!);
    const shift = ys(afloat.calls)[0]! - ys(dry.calls)[0]!;
    expect(shift).toBeCloseTo(WATER_LEVEL * unit, 5);
    expect(ys(afloat.calls).every((y, i) => Math.abs(y - ys(dry.calls)[i]! - shift) < 1e-6)).toBe(true);
  });

  it('are floated by the floor pass when the square they stand on is water', () => {
    const input = (ground: string) => ({
      tilesetId: 'marina',
      ground: { '3,3': ground },
      structure: {},
      object: { '3,3': 'boat' },
      defs,
    });
    const ys = (ground: string) => {
      const p = planTiles(iso, input(ground));
      const boat = p.standing.find((c) => c.def.prop === 'boat')!;
      const r = recorder();
      drawStandingCell(r.g, iso, boat, p);
      return r.calls.filter((c) => c.op === 'moveTo').map((c) => c.args[1]!);
    };
    const afloat = ys('harbour');
    const moored = ys('quay');
    expect(afloat.length).toBe(moored.length);
    for (let i = 0; i < afloat.length; i += 1) expect(afloat[i]! - moored[i]!).toBeCloseTo(WATER_LEVEL * iso.cell * 0.5, 5);
  });
});

describe('the chunk diff sees water change from a distance', () => {
  it('re-signs a square of water when land is painted three squares away', () => {
    const base = { tilesetId: 'marina', structure: {}, object: {}, defs };
    const water: Record<string, string> = {};
    for (let c = 0; c < 8; c += 1) water[`${c},0`] = 'harbour';
    const before = cellSignatures({ ...base, ground: water });
    const after = cellSignatures({ ...base, ground: { ...water, '0,0': 'quay' } });
    // Square 3 is three squares from the new quay: its colour moved, so its
    // signature must — even though the dirty rule only reaches one square.
    expect(after.get('3,0')).not.toBe(before.get('3,0'));
  });

  it('re-signs the water beside a shore that changes kind', () => {
    const base = { tilesetId: 'marina', structure: {}, object: {}, defs };
    const ground = { '0,0': 'quay', '0,1': 'harbour', '1,1': 'harbour' };
    const quay = cellSignatures({ ...base, ground });
    const beach = cellSignatures({ ...base, ground: { ...ground, '0,0': 'beach' } });
    expect(beach.get('1,1')).not.toBe(quay.get('1,1'));
  });

  it('leaves a dry floor’s signatures exactly as they were', () => {
    const base = { tilesetId: 'marina', structure: {}, object: {}, defs };
    const sig = cellSignatures({ ...base, ground: { '0,0': 'quay', '1,0': 'planking' } });
    expect(sig.get('0,0')).toBe('g=quay;');
  });
});

describe('the catalogue reaches the painter', () => {
  it('carries liquid and shore through the palette', () => {
    expect(HARBOUR.liquid).toBe('deep');
    expect(SHALLOWS.liquid).toBe('shallow');
    expect(QUAY.shore).toBe('quay');
    expect(PIERWALL.shore).toBe('pier');
    expect(BEACH.shore).toBe('beach');
    for (const set of ['marina', 'park', 'lake']) {
      expect(def(set, 'beach').shore, set).toBe('beach');
      expect(def(set, 'pierwall').shore, set).toBe('pier');
    }
  });
});
