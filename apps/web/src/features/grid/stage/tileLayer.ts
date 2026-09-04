/**
 * The painted floor (FR9.2, "assemble"): draws a scene's tile layer beneath
 * everything else.
 *
 * Tiles are drawn, not blitted. Each carries a two-colour palette and a
 * pattern name; the strokes below turn that into concrete, planking, grating
 * and so on. That is why the catalogue is kilobytes instead of an image pack,
 * why it stays crisp at any zoom, and why we ship it at all — a drawn tile is
 * ours, a texture pack would not be (§14).
 *
 * Redrawn only when the tile layer changes, like every other static layer.
 */
import type { Graphics } from 'pixi.js';
import type { Point, TileLayer } from '@safehouse/contracts';
import { WALL_THICKNESS } from '@safehouse/rules';
import {
  cellDepth,
  groundRadius,
  heightRise,
  rectCorners,
  worldFromGrid,
  type SceneMetrics,
} from '../geometry.js';
import { tileDefKey, type TileDrawDef } from '../types.js';
import { FACE_FOOT, FACE_SHADE, parseColor, shade } from './colors.js';

// Type-only pixi import: every draw here is a call on a Graphics-shaped object,
// so the module stays runnable (and testable) without a renderer.
export type { TileDrawDef };

/** `"col,row"` -> tile id, plus the definitions to look those ids up in. */
export interface TileDrawInput {
  /** The catalogue those cell ids belong to — half of the `defs` lookup key. */
  tilesetId: string;
  /**
   * The legacy flat map. Still accepted so a caller holding an un-migrated
   * scene draws something rather than nothing; the server migrates on read, so
   * in practice this is empty.
   */
  cells?: Record<string, string> | undefined;
  /** What the square is made of. */
  ground?: Record<string, string> | undefined;
  /** Walls, windows, doors. */
  structure?: Record<string, string> | undefined;
  /** Furniture and props standing on it. */
  object?: Record<string, string> | undefined;
  defs: Record<string, TileDrawDef>;
}


/**
 * Build the renderer's input from a scene's tile layer.
 *
 * Exists so the SEAM is testable. `drawTiles` handles three layers and the
 * server stores three layers, and both were right while the stage between them
 * passed only `cells` — which drains to empty, so the canvas rendered nothing
 * at all. Neither side's tests could see it, because neither side was wrong.
 *
 * Forwarding every layer explicitly (rather than spreading `tiles`) keeps the
 * compiler on the hook: a fourth layer added to the contract has to be named
 * here before it can be drawn.
 */
export function tileDrawInput(
  tiles: TileLayer,
  defs: Record<string, TileDrawDef>,
): TileDrawInput {
  return {
    tilesetId: tiles.tilesetId,
    cells: tiles.cells,
    ground: tiles.ground,
    structure: tiles.structure,
    object: tiles.object,
    defs,
  };
}

function parseKey(key: string): { col: number; row: number } | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  return m === null ? null : { col: Number(m[1]), row: Number(m[2]) };
}

function poly(g: Graphics, pts: readonly Point[]): Graphics {
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i]!.x, pts[i]!.y);
  return g.closePath();
}

/**
 * One cell, in whichever projection the scene is set to.
 *
 * ## Why this is not "fill a square" any more
 *
 * In plan view a wall could only ever be a slightly different shade of floor —
 * which is exactly the complaint that started this work: the GM could not see
 * their own walls. In isometric a tile with `height` is EXTRUDED: a top face
 * lifted off the ground, plus the two side faces holding it up. A wall becomes
 * a solid with a silhouette rather than a colour.
 *
 * Two consequences worth stating:
 *
 *  - **Faces are shaded, not flat.** One fill across all three reads as a
 *    hexagon; the brightness step is what makes the eye resolve a box.
 *  - **`height` is the same number the rules read.** A tile that looks
 *    waist-high IS waist-high to line of sight, because `stopsSight` and
 *    `givesCover` read the same field. The art cannot lie about the mechanics.
 *
 * The pattern is drawn into the top face's inscribed square rather than sheared
 * onto the diamond. Truly projecting every scratch would be correct and
 * invisible at table zoom, and getting it subtly wrong costs far more than not
 * doing it.
 */
/**
 * One standing face, banded from foot to crown.
 *
 * The measured face multipliers are close together — 0.688 to 0.875 — because
 * in the games the form is PAINTED IN rather than shaded in. Flat-filling a
 * face at those values makes a box dissolve, so each standing face is drawn as
 * a few horizontal bands running from `FACE_FOOT` of its shade at the bottom to
 * full at the top. That is the nearest a procedural renderer gets to the
 * gradient a painter would put there, and it is what makes a wall grow out of
 * the floor instead of being pasted onto it.
 *
 * Four bands: enough that the step is not visible at table zoom, few enough
 * that a wall costs four polygons instead of forty.
 */
const FACE_BANDS = 4;

function drawStandingFace(
  g: Graphics,
  a: Point,
  b: Point,
  rise: number,
  base: number,
  faceShade: number,
): void {
  for (let i = 0; i < FACE_BANDS; i += 1) {
    const lo = (i / FACE_BANDS) * rise;
    const hi = ((i + 1) / FACE_BANDS) * rise;
    // Band centres run 1/8, 3/8, 5/8, 7/8 up the face, so neither the foot nor
    // the crown is drawn at an extreme the model never reaches.
    const t = (i + 0.5) / FACE_BANDS;
    const lit = faceShade * (FACE_FOOT + (1 - FACE_FOOT) * t);
    poly(g, [
      { x: a.x, y: a.y - lo },
      { x: b.x, y: b.y - lo },
      { x: b.x, y: b.y - hi },
      { x: a.x, y: a.y - hi },
    ]).fill({ color: shade(base, lit) });
  }
}

/**
 * One extruded box, given its footprint in GRID coordinates.
 *
 * A whole cell for an ordinary tile; a third-of-a-cell slab for a piece of
 * wall. Returns the top face so the caller can put a pattern or a glow on it.
 */
function drawBox(
  g: Graphics,
  m: SceneMetrics,
  rect: readonly [number, number, number, number],
  rise: number,
  base: number,
): Point[] {
  const [x0, y0, x1, y1] = rect;
  const ground = rectCorners(m, x0, y0, x1, y1);
  const top: Point[] = rise > 0 ? ground.map((p) => ({ x: p.x, y: p.y - rise })) : [...ground];

  if (rise > 0) {
    // Only the two faces turned toward the viewer. `ground` runs clockwise from
    // the north corner ([N, E, S, W]), so those are W→S and S→E; the back pair
    // is hidden by the solid itself and drawing it would show through the
    // translucent bloom on emissive tiles.
    drawStandingFace(g, ground[3]!, ground[2]!, rise, base, FACE_SHADE.left);
    drawStandingFace(g, ground[2]!, ground[1]!, rise, base, FACE_SHADE.right);
  }

  poly(g, top).fill({ color: rise > 0 ? shade(base, FACE_SHADE.top) : base });
  return top;
}

/**
 * An extruded PRISM — a cylinder, near enough.
 *
 * A four-sided box makes a tree crown read as a green cube, which is exactly
 * the complaint that "the decorations are just coloured cells" was about.
 * Eight sides is the cheapest count that stops reading as boxy at table zoom
 * and still costs a handful of polygons.
 *
 * Side faces are painted back to front by their own midpoint depth, so the
 * ones turned toward the viewer cover the ones behind without needing to work
 * out which those are — the same painter's-algorithm trick the cell sort uses.
 */
function drawPrism(
  g: Graphics,
  m: SceneMetrics,
  centre: { x: number; y: number },
  radius: number,
  rise: number,
  base: number,
  sides = 8,
): Point[] {
  const ring: Array<{ grid: { x: number; y: number }; world: Point }> = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
    const grid = { x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius };
    ring.push({ grid, world: worldFromGrid(m, grid) });
  }

  if (rise > 0) {
    const faces = ring.map((p, i) => {
      const q = ring[(i + 1) % sides]!;
      return {
        // Depth of the edge's midpoint in grid space; higher is nearer.
        depth: (p.grid.x + p.grid.y + q.grid.x + q.grid.y) / 2,
        a: p.world,
        b: q.world,
        // Two shades so the curve reads as a curve rather than one flat band.
        shade: i % 2 === 0 ? FACE_SHADE.left : FACE_SHADE.right,
      };
    });
    faces.sort((a, b) => a.depth - b.depth);
    for (const f of faces) drawStandingFace(g, f.a, f.b, rise, base, f.shade);
  }

  const top = ring.map((p) => ({ x: p.world.x, y: p.world.y - rise }));
  poly(g, top).fill({ color: rise > 0 ? shade(base, FACE_SHADE.top) : base });
  return top;
}

/** The largest axis-aligned square inside a face, for laying a pattern into. */
function inscribed(face: readonly Point[]): { x: number; y: number; s: number } {
  const xs = face.map((p) => p.x);
  const ys = face.map((p) => p.y);
  const s = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2 - s / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2 - s / 2,
    s,
  };
}

/**
 * The surface texture, drawn into a square region of a face.
 *
 * Patterns are laid out axis-aligned rather than sheared onto the diamond.
 * Truly projecting every scratch would be correct and invisible at table zoom,
 * and getting it subtly wrong costs far more than not doing it.
 */
function drawPattern(g: Graphics, def: TileDrawDef, accent: number, at: ReturnType<typeof inscribed>): void {
  const { x, y, s } = at;
  const half = s / 2;
  switch (def.pattern) {
    case 'planks': {
      for (let i = 1; i < 4; i += 1) {
        const yy = y + (s * i) / 4;
        g.moveTo(x, yy).lineTo(x + s, yy);
      }
      g.stroke({ width: 1, color: accent, alpha: 0.55, pixelLine: true });
      break;
    }
    case 'concrete': {
      // Two short seams, offset, so a floor of these does not look tiled.
      g.moveTo(x + s * 0.15, y + s * 0.3).lineTo(x + s * 0.6, y + s * 0.3);
      g.moveTo(x + s * 0.45, y + s * 0.75).lineTo(x + s * 0.9, y + s * 0.75);
      g.stroke({ width: 1, color: accent, alpha: 0.4, pixelLine: true });
      break;
    }
    case 'grating': {
      for (let i = 1; i < 4; i += 1) {
        g.moveTo(x + (s * i) / 4, y).lineTo(x + (s * i) / 4, y + s);
      }
      g.stroke({ width: 1, color: accent, alpha: 0.7, pixelLine: true });
      break;
    }
    case 'tile': {
      g.moveTo(x + half, y).lineTo(x + half, y + s);
      g.moveTo(x, y + half).lineTo(x + s, y + half);
      g.stroke({ width: 1, color: accent, alpha: 0.5, pixelLine: true });
      break;
    }
    case 'carpet': {
      for (let i = 0; i < 4; i += 1) {
        const yy = y + s * (0.2 + i * 0.2);
        g.moveTo(x + s * 0.1, yy).lineTo(x + s * 0.9, yy);
      }
      g.stroke({ width: 1, color: accent, alpha: 0.28, pixelLine: true });
      break;
    }
    case 'gravel': {
      const dots: Array<[number, number]> = [
        [0.25, 0.3],
        [0.65, 0.22],
        [0.45, 0.6],
        [0.8, 0.72],
        [0.18, 0.78],
      ];
      for (const [dx, dy] of dots) {
        g.circle(x + s * dx, y + s * dy, Math.max(0.6, s * 0.04)).fill({
          color: accent,
          alpha: 0.6,
        });
      }
      break;
    }
    case 'water': {
      for (let i = 0; i < 3; i += 1) {
        const yy = y + s * (0.25 + i * 0.25);
        g.moveTo(x + s * 0.1, yy)
          .quadraticCurveTo(x + half, yy + s * 0.08, x + s * 0.9, yy);
      }
      g.stroke({ width: 1, color: accent, alpha: 0.55, pixelLine: true });
      break;
    }
    case 'brick': {
      for (let i = 1; i < 4; i += 1) {
        const yy = y + (s * i) / 4;
        g.moveTo(x, yy).lineTo(x + s, yy);
      }
      // Staggered head joints, so courses read as brick rather than as a grid.
      for (let row = 0; row < 4; row += 1) {
        const yy = y + (s * row) / 4;
        const xx = x + (row % 2 === 0 ? half : s * 0.25);
        g.moveTo(xx, yy).lineTo(xx, yy + s / 4);
      }
      g.stroke({ width: 1, color: accent, alpha: 0.5, pixelLine: true });
      break;
    }
    case 'panel': {
      g.rect(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76).stroke({
        width: 1,
        color: accent,
        alpha: 0.6,
        pixelLine: true,
      });
      break;
    }
    case 'rubble': {
      const chunks: Array<[number, number, number]> = [
        [0.22, 0.28, 0.1],
        [0.6, 0.35, 0.13],
        [0.4, 0.7, 0.11],
        [0.78, 0.68, 0.08],
      ];
      for (const [dx, dy, r] of chunks) {
        g.rect(x + s * dx, y + s * dy, s * r, s * r).fill({ color: accent, alpha: 0.65 });
      }
      break;
    }
    case 'hatch': {
      g.moveTo(x, y).lineTo(x + s, y + s);
      g.moveTo(x + s, y).lineTo(x, y + s);
      g.stroke({ width: 1, color: accent, alpha: 0.5, pixelLine: true });
      break;
    }
    case 'solid':
      break;
    default: {
      // A pattern added to `TilePattern` without a case above is a COMPILE
      // error here, not a floor that silently renders as flat base colour —
      // the failure mode that made this switch look correct while it drifted.
      // At runtime we still fall through: the catalogue arrives over the wire,
      // and an older client must degrade to base colour rather than throw.
      const unhandled: never = def.pattern;
      void unhandled;
      break;
    }
  }
}

/**
 * The lights collected during a pass, drawn after every tile.
 *
 * Emissive is an UNLIT LAYER — it receives no ambient and no directional light
 * and composites over the finished scene. Drawn inline it was neither: a tile
 * painted later covered the bloom of one painted earlier, so a neon sign lit
 * only the sliver of wall it was bolted to and nothing around it.
 *
 * Module-scoped because `drawTiles` is the only entry point and it is
 * synchronous; a direct caller with no pass open still draws immediately.
 */
let PENDING_LIGHTS: Array<{ face: Point[]; glow: number }> | null = null;

/**
 * Light a tile GIVES OFF — an unlit layer over the finished scene.
 *
 * "Unlit" is the load-bearing word and it is the shipped convention: a glowing
 * element receives neither ambient nor directional light and renders at 100% of
 * its painted value. Ours used to be a 20%-alpha wash over the tile, which is a
 * tile that has been tinted, not a light — and in a catalogue where only about
 * 1% of the frame may be bright, a light that does not read means the scene has
 * no focal point at all.
 *
 * It is drawn the way the study describes a practical: a hot CORE at full
 * value, a falloff around it, and a BLOOM that spills past the tile's own
 * footprint. That last part is what makes signage work. A wall slab is a third
 * of a cell, so a neon tube confined to its own face is a coloured pixel; the
 * bloom is what throws it onto the floor either side and makes it read across
 * a room, which is the entire job of a sign.
 */
function drawGlow(
  g: Graphics,
  m: SceneMetrics,
  def: TileDrawDef,
  accent: number,
  face: readonly Point[],
): void {
  if (def.emissive === undefined) return;
  const glow = parseColor(def.emissive, accent);
  if (PENDING_LIGHTS !== null) {
    PENDING_LIGHTS.push({ face: [...face], glow });
    return;
  }
  paintGlow(g, m, face, glow);
}

function paintGlow(g: Graphics, m: SceneMetrics, face: readonly Point[], glow: number): void {
  let cx = 0;
  let cy = 0;
  for (const p of face) {
    cx += p.x;
    cy += p.y;
  }
  cx /= face.length;
  cy /= face.length;
  const scaled = (k: number): Point[] =>
    face.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));

  // THE POOL takes the shape of the FLOOR, not of the fixture.
  //
  // Scaling the emitter's own outline was the obvious thing and it was wrong:
  // a wall slab is a third of a cell, so a neon sign's bloom came out as a
  // thin sliver of pink and read as a coloured pixel. Light does not take the
  // shape of the thing emitting it once you are more than a few centimetres
  // away — it falls on the ground as a pool. `groundRadius` is the same helper
  // an AoE template uses, so the pool is a circle in plan view and the correct
  // 2:1 ellipse in isometric.
  for (const [r, alpha] of [
    [1.6, 0.05],
    [1.05, 0.09],
    [0.62, 0.14],
  ] as const) {
    const { rx, ry } = groundRadius(m, r);
    g.ellipse(cx, cy, rx, ry).fill({ color: glow, alpha });
  }

  // THE FIXTURE keeps its own shape, brightening to a core at full value —
  // the only thing in a scene allowed to be this bright, which is exactly why
  // it carries the composition.
  poly(g, scaled(1)).fill({ color: glow, alpha: 0.26 });
  poly(g, scaled(0.72)).fill({ color: glow, alpha: 0.4 });
  poly(g, scaled(0.46)).fill({ color: glow, alpha: 0.66 });
  poly(g, scaled(0.24)).fill({ color: glow, alpha: 1 });
}

/** Which sides of this cell continue the wall run. */
export interface WallJoins {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

/**
 * The boxes making up a thin wall in one cell, in grid coordinates.
 *
 * A centre post always, plus a stub reaching toward every neighbouring wall.
 * That one rule produces every case correctly without enumerating any of them:
 * two opposite stubs is a straight run, two adjacent is a corner, three is a
 * T, four is a crossing, none is a pillar — which is what a lone wall cell
 * honestly is.
 */
export function wallBoxes(joins: WallJoins): Array<[number, number, number, number]> {
  const lo = (1 - WALL_THICKNESS) / 2;
  const hi = lo + WALL_THICKNESS;
  const out: Array<[number, number, number, number]> = [[lo, lo, hi, hi]];
  if (joins.n) out.push([lo, 0, hi, lo]);
  if (joins.s) out.push([lo, hi, hi, 1]);
  if (joins.w) out.push([0, lo, lo, hi]);
  if (joins.e) out.push([hi, lo, 1, hi]);
  return out;
}

/**
 * A wall cell: floor underneath, then a thin slab standing on it.
 *
 * The underlay matters more than it sounds. A wall only occupies a third of
 * its cell, so without floor beneath it every wall would be a hole in the
 * map — the grid showing through where a room's edge should be. The floor
 * drawn here is the set's own default, so a warehouse wall stands on warehouse
 * concrete.
 */
function drawWallTile(
  g: Graphics,
  def: TileDrawDef,
  m: SceneMetrics,
  col: number,
  row: number,
  joins: WallJoins,
): void {
  const base = parseColor(def.colors[0], 0x3b3f45);
  const accent = parseColor(def.colors[1], 0x5a6068);
  const rise = heightRise(m, def.height ?? 0);

  const under = def.underlay;
  if (under !== undefined) {
    const floor = drawBox(g, m, [col, row, col + 1, row + 1], 0, parseColor(under.colors[0], base));
    drawPattern(g, { ...def, pattern: under.pattern }, parseColor(under.colors[1], accent), inscribed(floor));
  }

  // `wallBoxes` works in CELL-LOCAL fractions (0..1) so the join rule can be
  // stated and tested without coordinates; translating to the cell is this
  // function's job. Forgetting it drew every wall on the map stacked at the
  // grid origin — one lonely pillar and no rooms at all.
  const boxes = wallBoxes(joins)
    .map(([x0, y0, x1, y1]): [number, number, number, number] => [
      col + x0,
      row + y0,
      col + x1,
      row + y1,
    ])
    // Back to front within the cell too: the north stub is furthest from the
    // viewer and the south stub nearest, so a corner joins cleanly instead of
    // showing the seam where two slabs overlap.
    .map((r) => ({ r, depth: r[0] + r[1] + r[2] + r[3] }))
    .sort((a, b) => a.depth - b.depth);

  let lastTop: Point[] = [];
  for (const { r } of boxes) lastTop = drawBox(g, m, r, rise, base);
  if (lastTop.length > 0) drawGlow(g, m, def, accent, lastTop);
}

/**
 * An object standing on the floor, drawn as a SHAPE rather than a cuboid.
 *
 * A catalogue where every prop is a coloured box tells the GM nothing at a
 * glance: colour alone does not separate a fire hydrant from a refuse pile at
 * table zoom, and both read as "some cube". A silhouette does.
 *
 *  - `post`   a narrow column — hydrant, bollard, valve stack
 *  - `canopy` a post carrying a wide crown — which is what makes a tree a tree
 *  - `round`  a squat cylinder — barrel, fountain basin, planter
 *
 * All still drawn, so the catalogue stays kilobytes and stays ours (§14).
 */
function drawObjectTile(
  g: Graphics,
  def: TileDrawDef,
  m: SceneMetrics,
  col: number,
  row: number,
): void {
  const base = parseColor(def.colors[0], 0x3b3f45);
  const accent = parseColor(def.colors[1], 0x5a6068);
  const rise = heightRise(m, def.height ?? 0);
  const shape = def.footprint;

  // Floor first: these cover a fraction of their cell, and without it every
  // prop would be a hole in the map with the grid showing through.
  const under = def.underlay;
  if (under !== undefined) {
    const floor = drawBox(g, m, [col, row, col + 1, row + 1], 0, parseColor(under.colors[0], base));
    drawPattern(
      g,
      { ...def, pattern: under.pattern },
      parseColor(under.colors[1], accent),
      inscribed(floor),
    );
  }

  const centre = { x: col + 0.5, y: row + 0.5 };
  // A `round` prop is squat and wide; a post and a trunk are narrow.
  const radius = shape === 'round' ? 0.34 : 0.15;

  if (shape === 'canopy') {
    // Trunk first, then the crown above it — drawing order IS the occlusion,
    // so the crown has to come second or the trunk sits on top of it.
    drawPrism(g, m, centre, radius, rise * 0.55, shade(base, 0.6), 6);
    // A wide round crown on a narrow trunk: narrow-then-wide is the whole
    // silhouette, and it is what a box crown could never give.
    const lifted = drawPrism(g, m, centre, 0.42, rise, base, 8);
    drawPattern(g, def, accent, inscribed(lifted));
    drawGlow(g, m, def, accent, lifted);
    return;
  }

  const top = drawPrism(g, m, centre, radius, rise, base, shape === 'round' ? 8 : 6);
  drawPattern(g, def, accent, inscribed(top));
  drawGlow(g, m, def, accent, top);
}

/**
 * A flight of stairs: treads climbing across the cell.
 *
 * Four ascending slabs rather than one ramp, because at table zoom a ramp
 * reads as a wedge of floor and treads read as stairs. Drawn back to front so
 * each tread's face covers the one behind it, which is what gives the
 * staircase its profile.
 *
 * The direction is cosmetic here — `connects` is what actually decides which
 * floor the stairs lead to (`stairTarget`). A down-flight simply descends
 * across the cell instead of rising, so the two are distinguishable at a
 * glance without the GM having to read a label.
 */
function drawStairTile(
  g: Graphics,
  def: TileDrawDef,
  m: SceneMetrics,
  col: number,
  row: number,
): void {
  const base = parseColor(def.colors[0], 0x3b3f45);
  const accent = parseColor(def.colors[1], 0x5a6068);
  const rise = heightRise(m, def.height ?? 0);
  const down = def.connects === 'down';

  // Floor underneath: a flight covers only part of its cell.
  const under = def.underlay;
  if (under !== undefined) {
    const floor = drawBox(g, m, [col, row, col + 1, row + 1], 0, parseColor(under.colors[0], base));
    drawPattern(
      g,
      { ...def, pattern: under.pattern },
      parseColor(under.colors[1], accent),
      inscribed(floor),
    );
  }

  const TREADS = 4;
  let top: Point[] = [];
  for (let i = 0; i < TREADS; i += 1) {
    const y0 = row + (i / TREADS);
    const y1 = row + ((i + 1) / TREADS);
    // Rising away from the viewer, or falling into the floor for a descent.
    const step = ((down ? TREADS - 1 - i : i) + 1) / TREADS;
    top = drawBox(g, m, [col + 0.12, y0, col + 0.88, y1], rise * step, shade(base, 0.9 + i * 0.06));
  }
  drawPattern(g, def, accent, inscribed(top));
  drawGlow(g, m, def, accent, top);
}

/** An ordinary tile: the whole cell, extruded by its height. */
function drawFillTile(
  g: Graphics,
  def: TileDrawDef,
  m: SceneMetrics,
  col: number,
  row: number,
): void {
  // Fallbacks keep a malformed palette visible rather than invisible: a tile
  // that fails to parse should look wrong, not vanish from the floor.
  const base = parseColor(def.colors[0], 0x3b3f45);
  const accent = parseColor(def.colors[1], 0x5a6068);
  const rise = heightRise(m, def.height ?? 0);
  const top = drawBox(g, m, [col, row, col + 1, row + 1], rise, base);
  drawPattern(g, def, accent, inscribed(top));
  drawGlow(g, m, def, accent, top);
}

/**
 * Draw the whole painted layer. Cells outside the grid are skipped.
 *
 * Painted BACK TO FRONT by `cellDepth`, because in isometric the draw order is
 * the depth buffer: there is no z-test here, so a wall only hides the floor
 * behind it if it is drawn after it. In plan view nothing overlaps and the
 * sort is a no-op that costs one comparison per cell.
 */
export function drawTiles(g: Graphics, m: SceneMetrics, input: TileDrawInput): void {
  g.clear();
  PENDING_LIGHTS = [];

  const drawable: Array<{ col: number; row: number; def: TileDrawDef; layer: number }> = [];
  /** Cells holding a thin-footprint tile, so a run can find its own corners. */
  const walls = new Set<string>();

  // The legacy flat map draws as if it were ground: an un-migrated scene shows
  // its floor rather than nothing while the server catches up.
  const maps: Array<[Record<string, string> | undefined, number]> = [
    [input.cells, 0],
    [input.ground, 0],
    [input.structure, 1],
    [input.object, 2],
  ];

  for (const [map, layer] of maps) {
    for (const [key, tileId] of Object.entries(map ?? {})) {
      const at = parseKey(key);
      if (at === null) continue;
      if (at.col < 0 || at.row < 0 || at.col >= m.cols || at.row >= m.rows) continue;
      const def = input.defs[tileDefKey(input.tilesetId, tileId)];
      if (def === undefined) continue; // unknown id (tileset changed) — draw nothing, lose nothing
      drawable.push({ col: at.col, row: at.row, def, layer });
      if (def.footprint === 'wall') walls.add(`${at.col},${at.row}`);
    }
  }

  drawable.sort(
    (a, b) =>
      cellDepth(a.col, a.row) - cellDepth(b.col, b.row) ||
      a.layer - b.layer ||
      a.col - b.col,
  );

  for (const cell of drawable) {
    const shape = cell.def.footprint;
    if (shape === 'stair') {
      drawStairTile(g, cell.def, m, cell.col, cell.row);
    } else if (shape === 'post' || shape === 'canopy' || shape === 'round') {
      drawObjectTile(g, cell.def, m, cell.col, cell.row);
    } else if (shape === 'wall') {
      // Joins are read from the finished set, not from draw order, so a run
      // looks the same whichever end the GM painted from.
      drawWallTile(g, cell.def, m, cell.col, cell.row, {
        n: walls.has(`${cell.col},${cell.row - 1}`),
        s: walls.has(`${cell.col},${cell.row + 1}`),
        w: walls.has(`${cell.col - 1},${cell.row}`),
        e: walls.has(`${cell.col + 1},${cell.row}`),
      });
    } else {
      drawFillTile(g, cell.def, m, cell.col, cell.row);
    }
  }

  // The unlit pass. Every light in the scene, over every tile in it — so a
  // sign's bloom lands on the floor in front of it rather than being painted
  // over by the next cell in the depth sort.
  const lights = PENDING_LIGHTS ?? [];
  PENDING_LIGHTS = null;
  for (const light of lights) paintGlow(g, m, light.face, light.glow);
}

/** FNV-1a. Cheap, stable, and it notices a one-character change. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Redraw key for the painted layer — the cheap "did this change?" the stage
 * compares before re-tessellating (see the layer keys in `stage/index.ts`).
 *
 * The key this replaces was `tilesetId:cellCount:JSON.stringify(cells).length`,
 * which is blind to the edit a GM makes most: repainting a cell with a
 * different tile of the same id LENGTH. Neither term moves, so no redraw fired
 * and the canvas kept the old floor while the server had the new one — in the
 * shipped catalogue that is docklands `floor`→`stain`→`grate`, `wall`→`rail`→
 * `door`, sprawl `road`/`walk`/`wall`/`door`, barrens `dirt`/`slab`/`wall`/
 * `fire`, maintenance `valve`→`hatch`, club `floor`→`booth`. It also missed a
 * stroke that erased N cells and painted N same-length ones, and it omitted the
 * scene id even though one Stage is reused across scene switches (`useStage`),
 * so two same-sized scenes could collide.
 *
 * Content-hashed instead: summed per-cell hashes, so it is order-independent
 * (a re-serialised layer must not force a pointless redraw) and moves for any
 * cell whose tile changed.
 */
export function tileLayerKey(sceneId: string, tiles: TileLayer | null | undefined): string {
  if (!tiles) return `${sceneId}|none`;
  let acc = 0;
  let count = 0;
  // EVERY layer, and the layer name in the hash. Hashing only `cells` would
  // now be a key that never changes — the legacy field drains to empty, so the
  // canvas would draw once and then ignore every stroke the GM made. Including
  // the layer name is what stops moving a tile between layers from cancelling
  // out to the same sum.
  for (const layer of ['ground', 'structure', 'object', 'cells'] as const) {
    for (const [key, tileId] of Object.entries(tiles[layer] ?? {})) {
      acc = (acc + hash32(`${layer}/${key}=${tileId}`)) >>> 0;
      count += 1;
    }
  }
  return `${sceneId}|${tiles.tilesetId}|${count}|${acc.toString(16)}`;
}
