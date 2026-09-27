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
import type { Scene } from '@safehouse/contracts';
import { TILE_HEIGHTS } from '@safehouse/rules';
import { heightRise, metricsFor, sceneWorldSize, worldFromGrid } from '../geometry.js';
import { RecordingInk, type InkOp } from '../stage3d/floorInk.js';
// The fog a player is sent, shared with the server's tests: what they assert
// the server sends is exactly what these draw (see the file for why).
import { FOG_WIRE_UNREVEALED } from '../../../../../../packages/contracts/test/fog-fixtures.js';
import { SHROUD_ALPHA } from '../plan/shroud.js';
import { COVER_TOTAL } from '../stage3d/cover.js';
import { C } from './colors.js';
import type { Ink, LabelSink } from './ink.js';
import { drawFog, EXPLORED_ALPHA, GM_EXPLORED_ALPHA, GM_FOG_ALPHA } from './layers.js';

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
function tracing(): { g: Ink; cuts: number[][] } {
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
  return { g: g as unknown as Ink, cuts };
}

const noLabels = (): LabelSink => ({ put: () => undefined, sweep: () => undefined });

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
    const labels = noLabels();
    drawFog(f.g, labels,scene(), flat, false);
    expect(f.cuts.length).toBeGreaterThan(0);
  });

  it('leaves the hole flat in plan view, where there is no up', () => {
    // One cut, the floor polygon, and nothing swept: a plan-view scene has no
    // extrusion for the hole to miss.
    const f = tracing();
    const labels = noLabels();
    drawFog(f.g, labels,scene(), flat, false);
    expect(f.cuts).toHaveLength(1);
    const corner = worldFromGrid(flat, { x: 2, y: 2 });
    expect(f.cuts[0]!.slice(0, 2)).toEqual([corner.x, corner.y]);
  });

  it('sweeps the hole upward in isometric, so a revealed room keeps its walls', () => {
    // The defect: cutting the FLOOR polygon alone left the far walls of a
    // revealed room with their tops and upper faces still under the opaque
    // cover — a room revealed with the roof left on.
    const f = tracing();
    const labels = noLabels();
    drawFog(f.g, labels,scene(), iso, false);

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
    const labels = noLabels();
    drawFog(f.g, labels,scene(), iso, false);

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
    const labels = noLabels();
    drawFog(f.g, labels,withShape, iso, false);
    // Floor, lifted, and one band per edge of the triangle.
    expect(f.cuts).toHaveLength(2 + 3);
  });

  it('cuts nothing for a region the GM has not revealed', () => {
    const s = scene();
    const shut = { ...s, fog: { ...s.fog, revealed: [] } } as unknown as Scene;
    const f = tracing();
    const labels = noLabels();
    drawFog(f.g, labels,shut, iso, true);
    expect(f.cuts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A scene with no fog is a scene the table can see
// ---------------------------------------------------------------------------

describe('drawFog with nothing defined', () => {
  /** Records the cover rectangle as well as the cuts. */
  function tracingCover(): { g: Ink; rects: number; cuts: number } {
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
      g: g as unknown as Ink,
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
    const labels = noLabels();
    drawFog(f.g, labels,unfogged(), flat, false);
    expect(f.rects).toBe(0);
    expect(f.cuts).toBe(0);
  });

  it('draws no tint for the GM either, so the two screens agree', () => {
    const f = tracingCover();
    const labels = noLabels();
    drawFog(f.g, labels,unfogged(), iso, true);
    expect(f.rects).toBe(0);
  });

});

// ---------------------------------------------------------------------------
// The copy a player and the TV are actually sent
// ---------------------------------------------------------------------------

/**
 * `drawFog` fed what the server sends (FR9.13), not the GM's copy.
 *
 * This replaces a test that fed a player's `drawFog` the GM's copy of a
 * fogged scene: one region, unrevealed. The GM's copy carries every region,
 * so that test drew a cover and passed. A player's copy carries only the
 * REVEALED regions, so the same scene reached every phone and the TV as
 * `regions: []`. `drawFog` read that as a scene with no fog and drew nothing,
 * and only the GM saw fog. The test checked a copy no player is ever sent.
 *
 * So the input here is `FOG_WIRE_UNREVEALED`, the fixture the server's tests
 * assert a player's and a display device's payload equals. The paints are
 * recorded by a `RecordingInk`, the same recorder the 3D map's inks and the
 * players' fog mask are built on, so what is asserted is the list of fills
 * and holes the mask is then painted from.
 */
describe('drawFog on the copy a player and the TV are sent', () => {
  /** A `RecordingInk` with nothing to paint on: just the paints it recorded. */
  class Recorder extends RecordingInk {
    protected changed(): void {
      // Nothing to repaint: the test reads the list.
    }
    get paints(): readonly InkOp[] {
      return this.ops;
    }
  }

  /** The scene of this file as a player receives it: its fog is the wire copy, varied by `fog`. */
  const wire = (fog: Partial<Scene['fog']> = {}): Scene => ({ ...scene(), fog: { ...FOG_WIRE_UNREVEALED, ...fog } });

  /** The cover `drawFog` lays down: the whole map plus the two-square pad, as `rect` records it. */
  function coverShape(): { pts: number[]; closed: boolean } {
    const { width, height } = sceneWorldSize(flat);
    const pad = flat.cell * 2;
    return { pts: [-pad, -pad, width + pad, -pad, width + pad, height + pad, -pad, height + pad], closed: true };
  }

  const region = scene().fog.regions[0]!;

  it('covers the whole map at full opacity when the scene is fogged with nothing revealed', () => {
    const ink = new Recorder();
    drawFog(ink, noLabels(), wire(), flat, false);
    expect(ink.paints).toHaveLength(1);
    const cover = ink.paints[0]!;
    expect(cover).toMatchObject({ kind: 'fill', alpha: 1 });
    expect(cover.path.shapes).toEqual([coverShape()]);
    expect(cover.path.holes).toEqual([]);
  });

  it('cuts one hole per revealed region, exactly that region, out of the same cover', () => {
    const ink = new Recorder();
    drawFog(ink, noLabels(), wire({ regions: [region], revealed: [region.id] }), flat, false);
    expect(ink.paints).toHaveLength(1);
    const cover = ink.paints[0]!;
    expect(cover).toMatchObject({ kind: 'fill', alpha: 1 });
    expect(cover.path.shapes).toEqual([coverShape()]);
    const hole = region.polygon.flatMap((p) => {
      const w = worldFromGrid(flat, p);
      return [w.x, w.y];
    });
    expect(cover.path.holes).toEqual([{ pts: hole, closed: true }]);
  });

  it('draws nothing when the copy says the fog is off, revealed regions or not', () => {
    // `active: false` is the server's answer, and it wins in both directions:
    // a scene the GM has switched off still carries its revealed regions to
    // the table, and must still open the whole map.
    for (const fog of [{ active: false }, { active: false, regions: [region], revealed: [region.id] }]) {
      const ink = new Recorder();
      drawFog(ink, noLabels(), wire(fog), flat, false);
      expect(ink.paints, JSON.stringify(fog)).toEqual([]);
    }
  });

  it("follows the GM's switch on the GM's copy: off keeps the outlines and drops the tint, on tints a scene with no regions", () => {
    // The GM's copy has no `active`: the switch (`enabled`) says it. Off,
    // the GM keeps each region's outline to lay the scene out, and no tint.
    const off = new Recorder();
    drawFog(off, noLabels(), { ...scene(), fog: { ...scene().fog, enabled: false } }, flat, true);
    expect(off.paints.map((p) => p.kind)).toEqual(['stroke']);

    // On, with no regions at all: the whole map is under the fog for the
    // table, so the GM sees it under the tint.
    const on = new Recorder();
    drawFog(on, noLabels(), { ...scene(), fog: { regions: [], revealed: [], revealedShapes: [], enabled: true } }, flat, true);
    expect(on.paints).toHaveLength(1);
    expect(on.paints[0]).toMatchObject({ kind: 'fill', alpha: 0.4 });
    expect(on.paints[0]!.path.shapes).toEqual([coverShape()]);
  });
});

// ---------------------------------------------------------------------------
// Ground revealed as explored: the map dimmed, as remembered (P6)
// ---------------------------------------------------------------------------

/**
 * The GM's second reveal fashion (the GM, 2026-09-27): ground revealed AS
 * EXPLORED is shown to the table dimmed, as remembered, with nobody on it.
 * On the players' fog mask that is a value short of total, `EXPLORED_ALPHA`,
 * which the cover's shader mixes toward the ground colour rather than
 * discarding (only `COVER_TOTAL` discards). So what is pinned here is the
 * list of fills the mask is painted from: the cover, total, with every
 * revealed area cut out, then the explored opacity over it with only the
 * LIVE areas cut out. Composited, that is 1 on hidden ground, the explored
 * opacity on explored ground, and 0 on live ground.
 */
describe('drawFog on ground revealed as explored (P6)', () => {
  class Recorder extends RecordingInk {
    protected changed(): void {
      // Nothing to repaint: the test reads the list.
    }
    get paints(): readonly InkOp[] {
      return this.ops;
    }
  }

  /** A second region beside the first, for the fashion the first is not in. */
  const lab = {
    id: 'r2',
    name: 'Lab',
    polygon: [
      { x: 7, y: 1 },
      { x: 10, y: 1 },
      { x: 10, y: 4 },
      { x: 7, y: 4 },
    ],
  };
  const bay = scene().fog.regions[0]!;

  const hole = (poly: readonly { x: number; y: number }[]) => ({
    pts: poly.flatMap((p) => {
      const w = worldFromGrid(flat, p);
      return [w.x, w.y];
    }),
    closed: true,
  });

  function coverShape(): { pts: number[]; closed: boolean } {
    const { width, height } = sceneWorldSize(flat);
    const pad = flat.cell * 2;
    return { pts: [-pad, -pad, width + pad, -pad, width + pad, height + pad, -pad, height + pad], closed: true };
  }

  it('draws the explored ground dimmed for a player: the explored opacity over the cover, holed only where it is live', () => {
    const ink = new Recorder();
    const fog = { ...FOG_WIRE_UNREVEALED, regions: [bay, lab], revealed: [bay.id], exploredRegionIds: [lab.id] };
    drawFog(ink, noLabels(), { ...scene(), fog }, flat, false);
    expect(ink.paints).toHaveLength(2);
    const [cover, dimmed] = ink.paints as [InkOp, InkOp];
    // The cover, total, with both revealed areas cut out of it: live and explored.
    expect(cover).toMatchObject({ kind: 'fill', alpha: 1 });
    expect(cover.path.shapes).toEqual([coverShape()]);
    expect(cover.path.holes).toEqual([hole(bay.polygon), hole(lab.polygon)]);
    // The explored opacity over it, the whole map, holed only by the live bay.
    expect(dimmed).toMatchObject({ kind: 'fill', alpha: EXPLORED_ALPHA });
    expect(dimmed.path.shapes).toEqual([coverShape()]);
    expect(dimmed.path.holes).toEqual([hole(bay.polygon)]);
    // The shroud's darkening, and short of total: dimmed on the map, never discarded.
    expect(EXPLORED_ALPHA).toBe(SHROUD_ALPHA);
    expect(EXPLORED_ALPHA).toBeLessThan(COVER_TOTAL);
  });

  it('dims a shape painted as explored the same way, and a live shape over it stays clear', () => {
    const painted = [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 5 },
    ];
    const ink = new Recorder();
    const fog = { ...FOG_WIRE_UNREVEALED, revealedShapes: [bay.polygon], exploredShapes: [painted] };
    drawFog(ink, noLabels(), { ...scene(), fog }, flat, false);
    const [cover, dimmed] = ink.paints as [InkOp, InkOp];
    expect(cover.path.holes).toEqual([hole(bay.polygon), hole(painted)]);
    expect(dimmed).toMatchObject({ kind: 'fill', alpha: EXPLORED_ALPHA });
    expect(dimmed.path.holes).toEqual([hole(bay.polygon)]);
  });

  it('files a region named in both lists as live, as the server does', () => {
    const ink = new Recorder();
    const fog = { ...FOG_WIRE_UNREVEALED, regions: [bay], revealed: [bay.id], exploredRegionIds: [bay.id] };
    drawFog(ink, noLabels(), { ...scene(), fog }, flat, false);
    expect(ink.paints).toHaveLength(1);
    expect(ink.paints[0]!.path.holes).toEqual([hole(bay.polygon)]);
  });

  it("tints the GM's explored ground lighter, keeps hidden ground at the GM's 40%, and outlines each state in its own colour", () => {
    const vault = { id: 'r3', name: 'Vault', polygon: [{ x: 1, y: 6 }, { x: 3, y: 6 }, { x: 3, y: 8 }] };
    const ink = new Recorder();
    const put: [string, number][] = [];
    const labels: LabelSink = { put: (key, label) => void put.push([key, label.color]), sweep: () => undefined };
    const fog = { regions: [bay, lab, vault], revealed: [bay.id], revealedShapes: [], exploredRegionIds: [lab.id], enabled: true };
    drawFog(ink, labels, { ...scene(), fog }, flat, true);

    const fills = ink.paints.filter((p) => p.kind === 'fill');
    expect(fills).toHaveLength(2);
    const [under, over] = fills as [InkOp, InkOp];
    expect(over.alpha).toBe(GM_EXPLORED_ALPHA);
    expect(over.alpha).toBeLessThan(GM_FOG_ALPHA);
    // Where the ground is hidden the two lie one over the other, and come to
    // the GM's usual 40% exactly, explored ground or none.
    expect(1 - (1 - under.alpha) * (1 - over.alpha)).toBeCloseTo(GM_FOG_ALPHA, 12);
    expect(under.path.holes).toEqual([hole(bay.polygon), hole(lab.polygon)]);
    expect(over.path.holes).toEqual([hole(bay.polygon)]);

    // Green live, amber seen before, cyan hidden: outline and name alike.
    const strokes = ink.paints.filter((p) => p.kind === 'stroke').map((p) => p.color);
    expect(strokes).toEqual([C.ok, C.warn, C.cyan]);
    expect(put).toEqual([
      [bay.id, C.ok],
      [lab.id, C.warn],
      [vault.id, C.cyan],
    ]);
  });
});
