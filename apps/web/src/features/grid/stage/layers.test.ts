/**
 * The static scene layers — the grid overlay and the fog (FR9.1, FR9.13/9.14).
 *
 * Both had the same defect and it is worth naming once: they were written in
 * GRID space and drawn in SCREEN space, which is the same thing only in plan
 * view. An isometric scene therefore got a square lattice over diamond tiles,
 * and a revealed room whose walls were cut off at the ankles.
 *
 * So these tests are about agreement rather than appearance. The overlay's
 * endpoints must be what `worldFromGrid` says they are, and the fog's hole must
 * reach as high as `heightRise` lifts a wall — the same two functions every
 * other layer draws through.
 */
import { describe, expect, it } from 'vitest';
import type { Container, Graphics, Text } from 'pixi.js';
import type { Scene } from '@safehouse/contracts';
import { TILE_HEIGHTS } from '@safehouse/rules';
import { heightRise, metricsFor, worldFromGrid } from '../geometry.js';
import { drawFog } from './layers.js';

const iso = metricsFor({
  unitM: 1,
  cols: 12,
  rows: 8,
  offset: { x: 0, y: 0 },
  projection: 'iso' as const,
});
const flat = metricsFor({
  unitM: 1,
  cols: 12,
  rows: 8,
  offset: { x: 0, y: 0 },
  projection: 'topdown' as const,
});

/** Records the polygons that were CUT, which is the whole subject here. */
function tracing(): { g: Graphics; cuts: number[][] } {
  const cuts: number[][] = [];
  let last: number[] = [];
  const g: Record<string, unknown> = {
    clear: () => g,
    rect: () => g,
    circle: () => g,
    moveTo: () => g,
    lineTo: () => g,
    closePath: () => g,
    fill: () => g,
    stroke: () => g,
    poly: (pts: number[]) => {
      last = pts;
      return g;
    },
    cut: () => {
      cuts.push(last);
      return g;
    },
  };
  return { g: g as unknown as Graphics, cuts };
}

const noLabels = () => ({
  layer: { addChild: () => undefined } as unknown as Container,
  pool: new Map<string, Text>(),
});

/** A scene with one revealed square region, and nothing else. */
function scene(): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Fogged',
    state: 'active',
    grid: { unitM: 1, cols: 12, rows: 8, offset: { x: 0, y: 0 } },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    levels: [],
    mapAttachmentIds: [],
    fog: {
      regions: [
        {
          id: 'r1',
          name: 'Loading bay',
          polygon: [
            { x: 2, y: 2 },
            { x: 6, y: 2 },
            { x: 6, y: 6 },
            { x: 2, y: 6 },
          ],
        },
      ],
      revealed: ['r1'],
      revealedShapes: [],
    },
  } as unknown as Scene;
}

const ys = (poly: number[]): number[] => poly.filter((_, i) => i % 2 === 1);

describe('drawFog', () => {
  it('cuts a revealed region out of the cover', () => {
    const f = tracing();
    const { layer, pool } = noLabels();
    drawFog(f.g, layer, pool, scene(), flat, false);
    expect(f.cuts.length).toBeGreaterThan(0);
  });

  it('leaves the hole flat in plan view, where there is no up', () => {
    // One cut, the floor polygon, and nothing swept: a plan-view scene has no
    // extrusion for the hole to miss.
    const f = tracing();
    const { layer, pool } = noLabels();
    drawFog(f.g, layer, pool, scene(), flat, false);
    expect(f.cuts).toHaveLength(1);
    const corner = worldFromGrid(flat, { x: 2, y: 2 });
    expect(f.cuts[0]!.slice(0, 2)).toEqual([corner.x, corner.y]);
  });

  it('sweeps the hole upward in isometric, so a revealed room keeps its walls', () => {
    // The defect: cutting the FLOOR polygon alone left the far walls of a
    // revealed room with their tops and upper faces still under the opaque
    // cover — a room revealed with the roof left on.
    const f = tracing();
    const { layer, pool } = noLabels();
    drawFog(f.g, layer, pool, scene(), iso, false);

    // The floor polygon, the same polygon lifted, and one band per edge.
    expect(f.cuts).toHaveLength(2 + 4);

    const rise = heightRise(iso, TILE_HEIGHTS.FULL);
    const floorTop = Math.min(...ys(f.cuts[0]!));
    const holeTop = Math.min(...f.cuts.flatMap((c) => ys(c)));
    expect(holeTop).toBeCloseTo(floorTop - rise, 6);
  });

  it('joins the lifted polygon to the floor one, leaving no gap in between', () => {
    // The bands are what make the three cuts a single volume rather than two
    // holes with opaque cover stranded between them.
    const f = tracing();
    const { layer, pool } = noLabels();
    drawFog(f.g, layer, pool, scene(), iso, false);

    const rise = heightRise(iso, TILE_HEIGHTS.FULL);
    const bands = f.cuts.slice(2);
    expect(bands).toHaveLength(4);
    for (const band of bands) {
      expect(band).toHaveLength(8); // a quad
      const [ax, ay, bx, by, cx, cy, dx, dy] = band as [
        number, number, number, number, number, number, number, number,
      ];
      // The top edge is the bottom edge lifted, vertex for vertex. Comparing
      // the band's total y-span instead would prove nothing: in isometric a
      // region's edge is not horizontal on screen, so the span is the edge's
      // own drop PLUS the rise, and it stays large even if the lift is zero.
      expect([cx, cy]).toEqual([bx, by - rise]);
      expect([dx, dy]).toEqual([ax, ay - rise]);
    }
  });

  it('cuts a free-drawn reveal the same way it cuts a named region', () => {
    // `revealedShapes` is the GM's brush rather than a saved region, and a
    // brushed reveal that beheaded walls while a named one did not would be
    // the sort of inconsistency nobody can diagnose from the table.
    const s = scene();
    const withShape = {
      ...s,
      fog: {
        ...s.fog,
        regions: [],
        revealed: [],
        revealedShapes: [
          [
            { x: 1, y: 1 },
            { x: 3, y: 1 },
            { x: 3, y: 3 },
          ],
        ],
      },
    } as unknown as Scene;
    const f = tracing();
    const { layer, pool } = noLabels();
    drawFog(f.g, layer, pool, withShape, iso, false);
    // Floor, lifted, and one band per edge of the triangle.
    expect(f.cuts).toHaveLength(2 + 3);
  });

  it('cuts nothing for a region the GM has not revealed', () => {
    const s = scene();
    const shut = { ...s, fog: { ...s.fog, revealed: [] } } as unknown as Scene;
    const f = tracing();
    const { layer, pool } = noLabels();
    drawFog(f.g, layer, pool, shut, iso, true);
    expect(f.cuts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A scene with no fog is a scene the table can see
// ---------------------------------------------------------------------------

describe('drawFog with nothing defined', () => {
  /** Records the cover rectangle as well as the cuts. */
  function tracingCover(): { g: Graphics; rects: number; cuts: number } {
    const out = { rects: 0, cuts: 0 };
    const g: Record<string, unknown> = {
      clear: () => g,
      rect: () => {
        out.rects += 1;
        return g;
      },
      circle: () => g,
      moveTo: () => g,
      lineTo: () => g,
      closePath: () => g,
      fill: () => g,
      stroke: () => g,
      poly: () => g,
      cut: () => {
        out.cuts += 1;
        return g;
      },
    };
    return {
      g: g as unknown as Graphics,
      get rects() {
        return out.rects;
      },
      get cuts() {
        return out.cuts;
      },
    };
  }

  const unfogged = (): Scene => {
    const s = scene();
    return { ...s, fog: { regions: [], revealed: [], revealedShapes: [] } } as Scene;
  };

  it('draws no cover at all for a player', () => {
    // The defect: the opaque cover went down regardless and was cut only
    // where a region was revealed, so a scene with no regions yet — every
    // freshly built one — reached the phones and the TV as a black screen.
    const f = tracingCover();
    const { layer, pool } = noLabels();
    drawFog(f.g, layer, pool, unfogged(), flat, false);
    expect(f.rects).toBe(0);
    expect(f.cuts).toBe(0);
  });

  it('draws no tint for the GM either, so the two screens agree', () => {
    const f = tracingCover();
    const { layer, pool } = noLabels();
    drawFog(f.g, layer, pool, unfogged(), iso, true);
    expect(f.rects).toBe(0);
  });

  it('still covers once a single region exists, revealed or not', () => {
    const f = tracingCover();
    const { layer, pool } = noLabels();
    const s = scene();
    const hidden = { ...s, fog: { ...s.fog, revealed: [] } } as Scene;
    drawFog(f.g, layer, pool, hidden, flat, false);
    expect(f.rects).toBe(1);
    expect(f.cuts).toBe(0);
  });
});
