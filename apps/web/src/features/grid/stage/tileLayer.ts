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
import { SHEEN_ALPHA_MAX, WALL_THICKNESS } from '@safehouse/rules';
import {
  cellDepth,
  groundRadius,
  heightRise,
  rectCorners,
  worldFromGrid,
  type SceneMetrics,
} from '../geometry.js';
import { tileDefKey, type TileDrawDef } from '../types.js';
import type { TileCut, TilePattern } from '@safehouse/rules';
import { C, FACE_FOOT, FACE_SHADE, parseColor, shade } from './colors.js';
import { drawCut, type CutRun } from './cuts.js';
import { drawProp, propFootprint } from './props.js';

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

// ---------------------------------------------------------------------------
// Legibility: the things a painted floor does that a flat fill does not
// ---------------------------------------------------------------------------

/**
 * Per-cell grain, ±4.5% of value.
 *
 * A floor painted from one tile used to be one flat colour across forty
 * cells, which reads as vinyl rather than concrete — and, worse, made the grid
 * lines the only thing giving the eye a scale. This is the study's tier-3
 * budget (6 value points) spent on the cheapest possible material: each cell
 * is hashed to a fixed offset, so a floor looks poured rather than printed and
 * looks the same every time it is drawn.
 */
const GRAIN = 0.045;

function cellSeed(col: number, row: number): number {
  return hash32(`${col},${row}`);
}

function grained(base: number, col: number, row: number): number {
  const t = ((cellSeed(col, row) % 1000) / 1000) * 2 - 1;
  return shade(base, 1 + t * GRAIN);
}

/** Does this tile stand proud of the floor — does it have a silhouette? */
export function isStanding(def: TileDrawDef): boolean {
  return (def.height ?? 0) > 0 || def.footprint === 'stair';
}

/**
 * How far a standing thing's shadow reaches across the floor, in cells per
 * cell of height. Matches the key light's own lean (0.50 : 0.75 — see
 * `KEY_LIGHT`) closely enough that the shadow falls to the same side as the
 * darker face, which is what makes a box sit down instead of hover.
 */
const SHADOW_REACH = 0.14;
const SHADOW_ALPHA = 0.34;

/**
 * The contact shadow under a standing tile, on the floor.
 *
 * This is where most of plan view's legibility comes from, and half of
 * isometric's. The measured face multipliers are deliberately close together
 * (the games paint their form in), so a box lit by them alone barely separates
 * from the floor at table zoom. A dark offset under its foot does what the
 * painter's contact shadow does: it says "this is ON the floor, and this
 * tall". In plan view — where there is no extrusion at all — it is the only
 * thing that says so.
 *
 * Drawn in its own pass, after every floor and before every standing thing,
 * so it lands ON the neighbouring floor and UNDER the box it belongs to.
 */
function drawGroundShadow(
  g: Graphics,
  m: SceneMetrics,
  rect: readonly [number, number, number, number],
  height: number,
): void {
  const d = SHADOW_REACH * Math.max(0.5, height);
  const [x0, y0, x1, y1] = rect;
  poly(g, rectCorners(m, x0 + d, y0 + d, x1 + d, y1 + d)).fill({
    color: C.ground,
    alpha: SHADOW_ALPHA,
  });
}

/**
 * The soft darkening on the floor all round a full-height thing.
 *
 * Distinct from the contact shadow, which falls to one side and says "this
 * stands here". This is the light a wall takes away from the floor beside it
 * on every side — the ambient occlusion a painter puts in every room corner —
 * and it is what makes a room read as enclosed rather than as a floor with a
 * fence on it. Faint and wide; it must never read as a shadow of its own.
 */
const AMBIENT_REACH = 0.22;
const AMBIENT_ALPHA = 0.16;

function drawAmbientRing(
  g: Graphics,
  m: SceneMetrics,
  rect: readonly [number, number, number, number],
): void {
  const [x0, y0, x1, y1] = rect;
  const d = AMBIENT_REACH;
  poly(g, rectCorners(m, x0 - d, y0 - d, x1 + d, y1 + d)).fill({
    color: C.ground,
    alpha: AMBIENT_ALPHA,
  });
}

/**
 * The lit edge along the top of a standing thing.
 *
 * One pixel, a third brighter than the top face. The crown is the edge the
 * key light catches first, and in the games it is the brightest line on any
 * prop — it is what separates a box from the box behind it when both are the
 * same colour.
 */
function drawCrown(g: Graphics, top: readonly Point[], base: number): void {
  poly(g, top).stroke({ width: 1, color: shade(base, 1.35), alpha: 0.42, pixelLine: true });
}

/**
 * Reflected light on a top face — see `Tile.sheen`.
 *
 * A wash, weighted by the reflected colour's own brightness so a faint light
 * gives a faint reflection, plus a lighter streak across the upper half where
 * the reflection would catch the key light. No pool and no bloom: this is a
 * property of the SURFACE, which is why a GM may paint a whole floor with it
 * without the room turning into a disco.
 */
function drawSheen(g: Graphics, def: TileDrawDef, top: readonly Point[]): void {
  if (def.sheen === undefined) return;
  const tint = parseColor(def.sheen, C.cyan);
  const v = Math.max((tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff) / 255;
  poly(g, top).fill({ color: tint, alpha: SHEEN_ALPHA_MAX * v });
  // The streak: the top face shrunk toward its upper-left, where the light
  // comes from.
  let cx = 0;
  let cy = 0;
  for (const p of top) {
    cx += p.x;
    cy += p.y;
  }
  cx /= top.length;
  cy /= top.length;
  const streak = top.map((p) => ({
    x: cx + (p.x - cx) * 0.55 - (p.x - cx) * 0.1,
    y: cy + (p.y - cy) * 0.45 - Math.abs(p.y - cy) * 0.15,
  }));
  poly(g, streak).fill({ color: tint, alpha: SHEEN_ALPHA_MAX * v * 0.55 });
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
  material?: { pattern: TilePattern | undefined; tones: Tones },
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
  if (material) drawFaceCourses(g, a, b, rise, material.pattern, material.tones);
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
  standing = false,
  material?: { pattern: TilePattern | undefined; tones: Tones },
): Point[] {
  const [x0, y0, x1, y1] = rect;
  const ground = rectCorners(m, x0, y0, x1, y1);
  const top: Point[] = rise > 0 ? ground.map((p) => ({ x: p.x, y: p.y - rise })) : [...ground];

  if (rise > 0) {
    // Only the two faces turned toward the viewer. `ground` runs clockwise from
    // the north corner ([N, E, S, W]), so those are W→S and S→E; the back pair
    // is hidden by the solid itself and drawing it would show through the
    // translucent bloom on emissive tiles.
    drawStandingFace(g, ground[3]!, ground[2]!, rise, base, FACE_SHADE.left, material);
    drawStandingFace(g, ground[2]!, ground[1]!, rise, base, FACE_SHADE.right, material);
  }

  poly(g, top).fill({ color: rise > 0 ? shade(base, FACE_SHADE.top) : base });
  // A thing that stands gets its ink line and its lit edge in both
  // projections. In plan view they are, with the contact shadow, the whole
  // of what says "this is not floor".
  if (rise > 0 && material) drawOutline(g, ground, top, material.tones);
  if (rise === 0 && standing && material) {
    poly(g, top).stroke({ width: 1, color: material.tones.ink, alpha: 0.5, pixelLine: true });
  }
  if (rise > 0 || standing) drawCrown(g, top, base);
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
  /** Per-vertex radius jitter, 0..1 of `radius` — what makes a crown organic. */
  jitter = 0,
  seed = 0,
): Point[] {
  const ring: Array<{ grid: { x: number; y: number }; world: Point }> = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
    const r = radius * (1 - jitter * rnd(seed, 100 + i));
    const grid = { x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r };
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

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** A face's footprint in GRID units: `[x0, y0, x1, y1]`. */
type FaceRect = readonly [number, number, number, number];

/** Maps a cell-local `(u, v)` in 0..1 onto a face lifted by `rise`, in world px. */
type FaceMap = (u: number, v: number) => Point;

function faceMapper(m: SceneMetrics, rect: FaceRect, rise: number): FaceMap {
  const [x0, y0, x1, y1] = rect;
  const w = x1 - x0;
  const h = y1 - y0;
  return (u, v) => {
    const p = worldFromGrid(m, { x: x0 + u * w, y: y0 + v * h });
    return { x: p.x, y: p.y - rise };
  };
}

/** Deterministic 0..1 from a cell seed and a salt, so a texture never flickers. */
function rnd(seed: number, salt: number): number {
  return (hash32(`${seed}:${salt}`) % 10007) / 10007;
}

/** The tones a material is drawn with, all derived from the tile's own pair. */
interface Tones {
  base: number;
  accent: number;
  /** A touch lighter than the accent: the lit edge of a plank, a rivet. */
  light: number;
  /** A touch darker than the base: grout, gaps, the shadow side of a chunk. */
  dark: number;
  /** The darkest line the material may carry: a crack, a mortar joint. */
  ink: number;
}

function tonesOf(base: number, accent: number): Tones {
  return {
    base,
    accent,
    light: shade(accent, 1.12),
    dark: shade(base, 0.84),
    ink: shade(base, 0.62),
  };
}

function uvLine(g: Graphics, P: FaceMap, pts: ReadonlyArray<readonly [number, number]>): Graphics {
  const first = pts[0];
  if (first === undefined) return g;
  const a = P(first[0], first[1]);
  g.moveTo(a.x, a.y);
  for (let i = 1; i < pts.length; i += 1) {
    const p = P(pts[i]![0], pts[i]![1]);
    g.lineTo(p.x, p.y);
  }
  return g;
}

function uvPoly(g: Graphics, P: FaceMap, pts: ReadonlyArray<readonly [number, number]>): Graphics {
  return poly(
    g,
    pts.map(([u, v]) => P(u, v)),
  );
}

/** A quad in uv space, filled. */
function uvRect(
  g: Graphics,
  P: FaceMap,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  style: { color: number; alpha: number },
): void {
  uvPoly(g, P, [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ]).fill(style);
}

/** A dot on the face: a circle on the ground, so an ellipse in isometric. */
function uvDot(
  g: Graphics,
  m: SceneMetrics,
  P: FaceMap,
  u: number,
  v: number,
  r: number,
  style: { color: number; alpha: number },
): void {
  const c = P(u, v);
  const { rx, ry } = groundRadius(m, r);
  g.ellipse(c.x, c.y, Math.max(0.6, rx), Math.max(0.5, ry)).fill(style);
}

/**
 * The surface texture, drawn across the WHOLE face in grid space.
 *
 * ## Why grid space and not a square in the middle
 *
 * The first renderer laid every pattern into the largest axis-aligned square
 * inside the face. In plan view that is the face. In isometric it is the
 * middle third of a diamond, and a 1px line at 50% alpha across the middle
 * third of a diamond is invisible at table zoom — which is why every floor
 * read as flat vinyl whatever it was called. Drawing in cell-local (u, v)
 * and projecting each point through `worldFromGrid` puts the courses of a
 * brick wall, the boards of a deck and the grout of a tiled floor where the
 * eye expects them: foreshortened, running with the diamond, edge to edge.
 *
 * ## Why three tones
 *
 * A material is not one line colour. Each pattern is drawn from a small
 * derived palette — the tile's base and accent, a lighter lit edge, a darker
 * gap, and one ink for cracks and joints — with the bulk of each texture kept
 * inside the study's tier-2 budget (the accent stays within twelve value
 * points of the base) and only hairlines allowed the ink. Per-cell seeds vary
 * the boards, chunks and cracks so forty cells of one tile do not tile.
 */
function drawPattern(
  g: Graphics,
  m: SceneMetrics,
  def: TileDrawDef,
  tones: Tones,
  rect: FaceRect,
  rise: number,
  seed: number,
): void {
  const P = faceMapper(m, rect, rise);
  const { accent, light, dark, ink } = tones;
  const line = (
    pts: ReadonlyArray<readonly [number, number]>,
    color: number,
    alpha: number,
    width = 1,
  ) =>
    uvLine(g, P, pts).stroke({ width, color, alpha, ...(width <= 1 ? { pixelLine: true } : {}) });

  switch (def.pattern) {
    case 'planks': {
      const boards = 4;
      for (let i = 0; i < boards; i += 1) {
        const v0 = i / boards;
        const v1 = (i + 1) / boards;
        // Each board its own tone, so a deck reads as boards rather than stripes.
        const tone = shade(tones.base, 0.95 + rnd(seed, i) * 0.1);
        uvRect(g, P, 0, v0, 1, v1, { color: tone, alpha: 0.9 });
        // Grain: one or two long strokes, never quite the full length.
        const gv = v0 + (0.3 + rnd(seed, 10 + i) * 0.4) * (v1 - v0);
        line(
          [
            [0.05 + rnd(seed, 20 + i) * 0.15, gv],
            [0.6 + rnd(seed, 30 + i) * 0.35, gv],
          ],
          light,
          0.28,
        );
      }
      for (let i = 1; i < boards; i += 1) {
        line(
          [
            [0, i / boards],
            [1, i / boards],
          ],
          ink,
          0.55,
        );
      }
      break;
    }
    case 'concrete': {
      // Mottling: a few soft patches either side of the base, then cracks.
      for (let i = 0; i < 5; i += 1) {
        const u = rnd(seed, i) * 0.7;
        const v = rnd(seed, 10 + i) * 0.7;
        const w = 0.15 + rnd(seed, 20 + i) * 0.3;
        const h = 0.12 + rnd(seed, 30 + i) * 0.28;
        const tone = i % 2 === 0 ? shade(tones.base, 1.06) : dark;
        uvRect(g, P, u, v, Math.min(1, u + w), Math.min(1, v + h), { color: tone, alpha: 0.35 });
      }
      const cu = rnd(seed, 40) * 0.5;
      const cv = rnd(seed, 41) * 0.6;
      line(
        [
          [cu, cv],
          [cu + 0.18, cv + 0.12 + rnd(seed, 42) * 0.15],
          [cu + 0.36 + rnd(seed, 43) * 0.2, cv + 0.05],
        ],
        ink,
        0.5,
      );
      for (let i = 0; i < 3; i += 1) {
        uvDot(g, m, P, rnd(seed, 50 + i), rnd(seed, 60 + i), 0.02, { color: dark, alpha: 0.6 });
      }
      break;
    }
    case 'tile': {
      const n = 3;
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
          const tone = shade(tones.base, 0.96 + rnd(seed, i * n + j) * 0.08);
          uvRect(g, P, i / n, j / n, (i + 1) / n, (j + 1) / n, { color: tone, alpha: 0.6 });
        }
      }
      for (let i = 1; i < n; i += 1) {
        line(
          [
            [i / n, 0],
            [i / n, 1],
          ],
          ink,
          0.6,
        );
        line(
          [
            [0, i / n],
            [1, i / n],
          ],
          ink,
          0.6,
        );
      }
      break;
    }
    case 'carpet': {
      // A fine diagonal weave, plus two blotches of wear.
      for (let k = 1; k < 8; k += 1) {
        const t = k / 8;
        line(
          [
            [t, 0],
            [0, t],
          ],
          accent,
          0.22,
        );
        line(
          [
            [1, t],
            [t, 1],
          ],
          accent,
          0.22,
        );
      }
      for (let i = 0; i < 2; i += 1) {
        const u = rnd(seed, i) * 0.6;
        const v = rnd(seed, 5 + i) * 0.6;
        uvRect(g, P, u, v, u + 0.25, v + 0.2, { color: dark, alpha: 0.18 });
      }
      break;
    }
    case 'grating': {
      // Dark below, bars above: the whole reason a grate reads as a grate is
      // that something is visible through it.
      uvRect(g, P, 0, 0, 1, 1, { color: ink, alpha: 0.35 });
      const n = 5;
      for (let i = 0; i <= n; i += 1) {
        const t = i / n;
        line(
          [
            [t, 0],
            [t, 1],
          ],
          accent,
          0.9,
          2,
        );
        line(
          [
            [0, t],
            [1, t],
          ],
          light,
          0.6,
          1,
        );
      }
      break;
    }
    case 'gravel': {
      for (let i = 0; i < 16; i += 1) {
        const tone = i % 3 === 0 ? light : i % 3 === 1 ? accent : dark;
        uvDot(g, m, P, rnd(seed, i), rnd(seed, 40 + i), 0.025 + rnd(seed, 80 + i) * 0.035, {
          color: tone,
          alpha: 0.7,
        });
      }
      break;
    }
    case 'water': {
      uvRect(g, P, 0, 0, 1, 1, { color: dark, alpha: 0.25 });
      for (let i = 0; i < 3; i += 1) {
        const v = 0.2 + i * 0.28 + rnd(seed, i) * 0.08;
        line(
          [
            [0.05, v],
            [0.3, v + 0.04],
            [0.55, v - 0.03],
            [0.8, v + 0.03],
            [0.95, v],
          ],
          accent,
          0.55,
        );
      }
      // Two highlights where the surface catches the key light.
      for (let i = 0; i < 2; i += 1) {
        const u = 0.15 + rnd(seed, 20 + i) * 0.5;
        const v = 0.15 + rnd(seed, 30 + i) * 0.5;
        line(
          [
            [u, v],
            [u + 0.18, v - 0.02],
          ],
          light,
          0.4,
          2,
        );
      }
      break;
    }
    case 'brick': {
      const courses = 5;
      const bw = 0.5;
      for (let c = 0; c < courses; c += 1) {
        const v0 = c / courses;
        const v1 = (c + 1) / courses;
        const off = c % 2 === 0 ? 0 : bw / 2;
        for (let u = -bw; u < 1; u += bw) {
          const u0 = Math.max(0, u + off);
          const u1 = Math.min(1, u + off + bw);
          if (u1 <= u0) continue;
          const tone = shade(tones.base, 0.94 + rnd(seed, c * 7 + Math.round(u * 10)) * 0.12);
          uvRect(g, P, u0 + 0.01, v0 + 0.015, u1 - 0.01, v1 - 0.015, { color: tone, alpha: 0.8 });
        }
        if (c > 0) {
          line(
            [
              [0, v0],
              [1, v0],
            ],
            ink,
            0.55,
          );
        }
      }
      break;
    }
    case 'panel': {
      // A bevelled plate: lit on the two edges toward the key light, shadowed
      // on the other two, with a rivet in each corner.
      const i0 = 0.09;
      const i1 = 0.91;
      line(
        [
          [i0, i1],
          [i0, i0],
          [i1, i0],
        ],
        light,
        0.55,
      );
      line(
        [
          [i1, i0],
          [i1, i1],
          [i0, i1],
        ],
        ink,
        0.55,
      );
      for (const [u, v] of [
        [0.14, 0.14],
        [0.86, 0.14],
        [0.14, 0.86],
        [0.86, 0.86],
      ] as const) {
        uvDot(g, m, P, u, v, 0.028, { color: light, alpha: 0.85 });
      }
      break;
    }
    case 'rubble': {
      for (let i = 0; i < 9; i += 1) {
        const u = rnd(seed, i) * 0.8;
        const v = rnd(seed, 20 + i) * 0.8;
        const w = 0.07 + rnd(seed, 40 + i) * 0.16;
        const h = 0.06 + rnd(seed, 60 + i) * 0.14;
        const tone = i % 3 === 0 ? light : i % 3 === 1 ? accent : dark;
        // A shadow edge under each chunk, so the pile has depth.
        uvRect(g, P, u + 0.015, v + 0.015, Math.min(1, u + w + 0.015), Math.min(1, v + h + 0.015), {
          color: ink,
          alpha: 0.45,
        });
        uvRect(g, P, u, v, Math.min(1, u + w), Math.min(1, v + h), { color: tone, alpha: 0.85 });
      }
      break;
    }
    case 'hatch': {
      uvPoly(g, P, [
        [0.06, 0.06],
        [0.94, 0.06],
        [0.94, 0.94],
        [0.06, 0.94],
      ]).stroke({ width: 1, color: light, alpha: 0.35, pixelLine: true });
      line(
        [
          [0.1, 0.1],
          [0.9, 0.9],
        ],
        accent,
        0.75,
        3,
      );
      line(
        [
          [0.9, 0.1],
          [0.1, 0.9],
        ],
        accent,
        0.75,
        3,
      );
      break;
    }
    case 'grass': {
      // Soft mottling under short tufts leaning the same way, as turf does.
      for (let i = 0; i < 3; i += 1) {
        const u = rnd(seed, i) * 0.6;
        const v = rnd(seed, 10 + i) * 0.6;
        uvRect(g, P, u, v, u + 0.3, v + 0.25, {
          color: i === 1 ? dark : shade(tones.base, 1.06),
          alpha: 0.3,
        });
      }
      for (let i = 0; i < 14; i += 1) {
        const u = 0.05 + rnd(seed, 20 + i) * 0.9;
        const v = 0.08 + rnd(seed, 40 + i) * 0.88;
        const lean = 0.03 + rnd(seed, 60 + i) * 0.03;
        line(
          [
            [u, v],
            [u + lean, v - 0.07 - rnd(seed, 80 + i) * 0.05],
          ],
          i % 3 === 0 ? light : accent,
          0.7,
        );
      }
      break;
    }
    case 'dirt': {
      for (let i = 0; i < 6; i += 1) {
        const u = rnd(seed, i) * 0.7;
        const v = rnd(seed, 10 + i) * 0.7;
        uvRect(g, P, u, v, Math.min(1, u + 0.18 + rnd(seed, 20 + i) * 0.25), Math.min(1, v + 0.15 + rnd(seed, 30 + i) * 0.2), {
          color: i % 2 === 0 ? dark : shade(tones.base, 1.05),
          alpha: 0.32,
        });
      }
      const cu = rnd(seed, 40) * 0.6;
      const cv = 0.2 + rnd(seed, 41) * 0.5;
      line(
        [
          [cu, cv],
          [cu + 0.15, cv + 0.06],
          [cu + 0.32, cv - 0.04],
        ],
        ink,
        0.35,
      );
      for (let i = 0; i < 5; i += 1) {
        uvDot(g, m, P, rnd(seed, 50 + i), rnd(seed, 60 + i), 0.018 + rnd(seed, 70 + i) * 0.02, {
          color: i % 2 === 0 ? accent : dark,
          alpha: 0.7,
        });
      }
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
 * The courses on a STANDING face — brick joints, panel seams, plank gaps —
 * so a wall's side is the same material as its top rather than a smooth
 * band. Hairlines only, and only when the face is tall enough to carry them.
 */
function drawFaceCourses(
  g: Graphics,
  a: Point,
  b: Point,
  rise: number,
  pattern: TilePattern | undefined,
  tones: Tones,
): void {
  if (rise < 10) return;
  const rows = pattern === 'brick' ? 4 : pattern === 'panel' || pattern === 'planks' ? 2 : 0;
  if (rows === 0) return;
  for (let i = 1; i < rows + (pattern === 'brick' ? 1 : 0); i += 1) {
    const y = (i / (rows + (pattern === 'brick' ? 1 : 0))) * rise;
    g.moveTo(a.x, a.y - y)
      .lineTo(b.x, b.y - y)
      .stroke({ width: 1, color: tones.ink, alpha: 0.4, pixelLine: true });
  }
  if (pattern === 'brick') {
    // Staggered head joints, alternating courses.
    const n = 3;
    for (let c = 0; c < 4; c += 1) {
      const y0 = (c / 5) * rise;
      const y1 = ((c + 1) / 5) * rise;
      for (let k = 0; k < n; k += 1) {
        const t = (k + (c % 2 === 0 ? 0.5 : 0.25)) / n;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        g.moveTo(x, y - y0)
          .lineTo(x, y - y1)
          .stroke({ width: 1, color: tones.ink, alpha: 0.3, pixelLine: true });
      }
    }
  }
}

/**
 * The ink line around a standing thing.
 *
 * Every hand-painted isometric game draws one, because two adjacent props of
 * the same colour have no other way to be two things. Half-transparent and a
 * pixel wide, in the tile's own darkest tone rather than black, so it reads as
 * an edge and not as a cartoon.
 */
function drawOutline(g: Graphics, ground: readonly Point[], top: readonly Point[], tones: Tones): void {
  // Silhouette: the top's back edges and the ground's front edges, joined by
  // the two outer verticals. `ground`/`top` run [N, E, S, W].
  const [tn, te, , tw] = top as [Point, Point, Point, Point];
  const [, ge, gs, gw] = ground as [Point, Point, Point, Point];
  poly(g, [tn, te, ge, gs, gw, tw]).stroke({
    width: 1,
    color: tones.ink,
    alpha: 0.5,
    pixelLine: true,
  });
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
  // Alphas measured up from the first cut, which read as a tinted fixture on
  // a dark floor rather than a light in a room: at table zoom the outer pool
  // was below the grid overlay's own opacity and vanished under it.
  for (const [r, alpha] of [
    [1.7, 0.07],
    [1.1, 0.13],
    [0.64, 0.2],
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
/**
 * The floor under a thin or standing tile, from the set's own default.
 *
 * Drawn only when the cell has no ground of its own: the room tool paints
 * ground under every wall it stands, and a set's default concrete drawn over
 * the bar decking the GM chose would be the wrong floor in the right place.
 */
function drawUnderlay(
  g: Graphics,
  def: TileDrawDef,
  m: SceneMetrics,
  col: number,
  row: number,
): void {
  const under = def.underlay;
  if (under === undefined) return;
  const base = grained(parseColor(under.colors[0], 0x3b3f45), col, row);
  const accent = parseColor(under.colors[1], 0x5a6068);
  const rect: FaceRect = [col, row, col + 1, row + 1];
  drawBox(g, m, rect, 0, base);
  drawPattern(g, m, { ...def, pattern: under.pattern }, tonesOf(base, accent), rect, 0, cellSeed(col, row));
}

/**
 * The bevel on a standing block's top — a lit edge toward the key light and
 * a shadowed one away from it — so a crate, a car or a counter reads as a
 * made thing with a lip rather than a slab of colour.
 */
function drawBevel(g: Graphics, m: SceneMetrics, rect: FaceRect, rise: number, tones: Tones): void {
  const P = faceMapper(m, rect, rise);
  const i0 = 0.07;
  const i1 = 0.93;
  uvLine(g, P, [
    [i0, i1],
    [i0, i0],
    [i1, i0],
  ]).stroke({ width: 1, color: tones.light, alpha: 0.5, pixelLine: true });
  uvLine(g, P, [
    [i1, i0],
    [i1, i1],
    [i0, i1],
  ]).stroke({ width: 1, color: tones.ink, alpha: 0.5, pixelLine: true });
}

/** The slabs a wall cell is made of, in scene cells, nearest last. */
function wallRects(col: number, row: number, joins: WallJoins): Array<[number, number, number, number]> {
  // `wallBoxes` works in CELL-LOCAL fractions (0..1) so the join rule can be
  // stated and tested without coordinates; translating to the cell is this
  // function's job. Forgetting it drew every wall on the map stacked at the
  // grid origin — one lonely pillar and no rooms at all.
  return wallBoxes(joins)
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
    .sort((a, b) => a.depth - b.depth)
    .map(({ r }) => r);
}

/**
 * A wall cell: a thin slab standing on whatever floor is there.
 *
 * The slab is a third of a cell (`WALL_THICKNESS`) and orients itself from
 * its neighbours, so the GM paints cells and gets architecture.
 */
function drawWallTile(
  g: Graphics,
  def: TileDrawDef,
  m: SceneMetrics,
  col: number,
  row: number,
  joins: WallJoins,
  run: CutRun | null,
): void {
  const base = parseColor(def.colors[0], 0x3b3f45);
  const accent = parseColor(def.colors[1], 0x5a6068);
  const rise = heightRise(m, def.height ?? 0);
  const tones = tonesOf(base, accent);
  const material = { pattern: def.pattern, tones };
  const seed = cellSeed(col, row);
  const opening = cutOf(def) !== null;

  let lastTop: Point[] = [];
  for (const r of wallRects(col, row, joins)) {
    lastTop = drawBox(g, m, r, rise, base, true, material);
    // The material runs along the top of the slab too — brick courses, mesh,
    // boards. A panel's bevel and rivets would be nonsense on a strip a third
    // of a cell wide, so panelled walls carry their seams on the faces only;
    // and an opening carries its own design instead.
    if (!opening && def.pattern !== 'panel' && def.pattern !== 'solid') {
      drawPattern(g, m, def, tones, r, rise, seed);
    }
  }
  // The opening's design, once per run, from the run's last cell.
  if (run !== null) {
    const cut = cutOf(def);
    if (cut !== null) drawCut(g, m, cut, run, rise, tones, def.emissive);
  }
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
  const tones = tonesOf(base, accent);
  const seed = cellSeed(col, row);
  const material = { pattern: undefined, tones };

  const centre = { x: col + 0.5, y: row + 0.5 };
  // A `round` prop is squat and wide; a post and a trunk are narrow.
  const radius = shape === 'round' ? 0.34 : 0.15;
  /** A disc on the top face — a rim, a cap, a lid. */
  const disc = (r: number, color: number, alpha: number, ink = false) => {
    const c = worldFromGrid(m, centre);
    const { rx, ry } = groundRadius(m, r);
    const e = g.ellipse(c.x, c.y - rise, rx, ry).fill({ color, alpha });
    if (ink) e.stroke({ width: 1, color: tones.ink, alpha: 0.45, pixelLine: true });
  };

  if (shape === 'canopy') {
    // Trunk first, then the crown above it — drawing order IS the occlusion,
    // so the crown has to come second or the trunk sits on top of it.
    drawPrism(g, m, centre, radius, rise * 0.55, shade(base, 0.6), 6);
    // A wide round crown on a narrow trunk: narrow-then-wide is the whole
    // silhouette, and it is what a box crown could never give. The crown's
    // radius is jittered per vertex so no two trees are the same shape, and
    // a lighter lump sits on its lit side.
    const lifted = drawPrism(g, m, centre, 0.42, rise, base, 8, 0.35, seed);
    drawPattern(g, m, def, tones, objectRect(def, col, row), rise, seed);
    drawPrism(g, m, { x: centre.x - 0.1, y: centre.y - 0.1 }, 0.2, rise * 1.08, shade(base, 1.14), 7, 0.3, seed + 1);
    drawGlow(g, m, def, accent, lifted);
    return;
  }

  const top = drawPrism(g, m, centre, radius, rise, base, shape === 'round' ? 8 : 6);
  if (shape === 'round') {
    // A rim and a lid: a drum, a planter and a fountain all read from the
    // ring at the top, which a flat disc never gave them.
    disc(radius * 0.72, shade(base, 1.08), 0.7, true);
    drawPattern(g, m, def, tones, [centre.x - radius * 0.7, centre.y - radius * 0.7, centre.x + radius * 0.7, centre.y + radius * 0.7], rise, seed);
  } else {
    // A cap wider than the post: a stool seat, a hydrant top, a bollard head.
    disc(radius * 1.6, shade(base, 1.15), 1, true);
    disc(radius * 0.9, shade(base, 1.28), 0.7);
  }
  drawCrown(g, top, base);
  void material;
  drawGlow(g, m, def, accent, top);
}

/** The square a prop's shadow falls from — its own footprint, not its cell. */
function objectRect(
  def: TileDrawDef,
  col: number,
  row: number,
): [number, number, number, number] {
  if (def.prop !== undefined) return propFootprint(def.prop, col, row);
  const r = def.footprint === 'canopy' ? 0.42 : def.footprint === 'round' ? 0.34 : 0.15;
  return [col + 0.5 - r, row + 0.5 - r, col + 0.5 + r, row + 0.5 + r];
}

/**
 * A designed prop — a desk, a car, a lamp post — built by `stage/props.ts`
 * in the tile's own tones. Any light it gives off is handed to the light
 * pass from the face the design says is the fixture.
 */
function drawPropTile(
  g: Graphics,
  def: TileDrawDef,
  m: SceneMetrics,
  col: number,
  row: number,
): void {
  if (def.prop === undefined) return;
  const base = parseColor(def.colors[0], 0x3b3f45);
  const accent = parseColor(def.colors[1], 0x5a6068);
  const glow = def.emissive === undefined ? null : parseColor(def.emissive, accent);
  const face = drawProp(
    g,
    m,
    def.prop,
    col,
    row,
    def.height ?? 0,
    heightRise(m, 1),
    tonesOf(base, accent),
    cellSeed(col, row),
    glow,
  );
  if (face !== null) drawGlow(g, m, def, accent, face);
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
  const tones = tonesOf(base, accent);
  const material = { pattern: def.pattern, tones };

  const TREADS = 4;
  let top: Point[] = [];
  let last: FaceRect = [col, row, col + 1, row + 1];
  let lastRise = 0;
  for (let i = 0; i < TREADS; i += 1) {
    const y0 = row + (i / TREADS);
    const y1 = row + ((i + 1) / TREADS);
    // Rising away from the viewer, or falling into the floor for a descent.
    const step = ((down ? TREADS - 1 - i : i) + 1) / TREADS;
    last = [col + 0.12, y0, col + 0.88, y1];
    lastRise = rise * step;
    // In plan view the treads are bands of stepped brightness — the same
    // ladder of shades, read as a flight the way a floor plan draws one.
    top = drawBox(g, m, last, lastRise, shade(base, 0.9 + i * 0.06), true, material);
  }
  drawPattern(g, m, def, tones, last, lastRise, cellSeed(col, row));
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
  const standing = isStanding(def);
  // Grain on the floor only. A crate is one object and should be one colour;
  // forty cells of concrete should not be.
  const base = standing
    ? parseColor(def.colors[0], 0x3b3f45)
    : grained(parseColor(def.colors[0], 0x3b3f45), col, row);
  const accent = parseColor(def.colors[1], 0x5a6068);
  const rise = heightRise(m, def.height ?? 0);
  const tones = tonesOf(base, accent);
  const rect: FaceRect = [col, row, col + 1, row + 1];
  const top = drawBox(g, m, rect, rise, base, standing, { pattern: def.pattern, tones });
  drawPattern(g, m, def, tones, rect, rise, cellSeed(col, row));
  // A standing block is a made thing — a crate, a counter, a car — and gets
  // a lip. A floor is a surface and does not.
  if (standing) drawBevel(g, m, rect, rise, tones);
  drawSheen(g, def, top);
  drawGlow(g, m, def, accent, top);
}

// ---------------------------------------------------------------------------
// The plan: what to draw, in what order, and which cells belong to which chunk
// ---------------------------------------------------------------------------

/** One painted cell, resolved against the palette. */
export interface TileCell {
  col: number;
  row: number;
  /** The tile id within its set — what a run of the same opening is a run OF. */
  id: string;
  def: TileDrawDef;
  /** 0 ground, 1 structure, 2 object — the draw order within a square. */
  layer: number;
}

/**
 * Everything a draw pass needs, computed once from the layer maps.
 *
 * Shared by the one-shot `drawTiles` (tests, and anything without a stage)
 * and the chunked layer the stage uses, so the two can never disagree about
 * what a cell is or which way a wall turns.
 */
export interface TilePlan {
  /** Every drawable cell, back to front, ground before structure before object. */
  cells: TileCell[];
  /** `"col,row"` of every cell holding a thin-footprint tile — the wall runs. */
  walls: Set<string>;
  /** `"col,row"` of every cell with a floor of its own. */
  grounded: Set<string>;
  /** `"col,row"` of every cell with anything drawn in it — where the map is. */
  occupied: Set<string>;
  /** `"col,row"` → tile id for every structure cell, so an opening can find its run. */
  structure: Map<string, string>;
  /** The cells that stand proud of the floor, in draw order. */
  standing: TileCell[];
}

export function planTiles(m: SceneMetrics, input: TileDrawInput): TilePlan {
  const cells: TileCell[] = [];
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
      cells.push({ col: at.col, row: at.row, id: tileId, def, layer });
      if (def.footprint === 'wall') walls.add(`${at.col},${at.row}`);
    }
  }

  const structure = new Map<string, string>();
  for (const c of cells) {
    if (c.def.footprint === 'wall') structure.set(`${c.col},${c.row}`, c.id);
  }

  cells.sort(
    (a, b) =>
      cellDepth(a.col, a.row) - cellDepth(b.col, b.row) ||
      a.layer - b.layer ||
      a.col - b.col,
  );

  /**
   * Cells with a floor of their own, so no default is drawn under them.
   *
   * Judged by what is DRAWN there, not by which map the key came from: the
   * legacy `cells` map held walls and props as well as floors, so "a key in
   * `cells`" is not "a floor in this cell".
   */
  const grounded = new Set<string>();
  for (const c of cells) {
    if (c.layer === 0 && !isStanding(c.def) && (c.def.footprint ?? 'fill') === 'fill') {
      grounded.add(`${c.col},${c.row}`);
    }
  }

  const occupied = new Set<string>();
  for (const c of cells) occupied.add(`${c.col},${c.row}`);

  const standing = cells.filter((c) => isStanding(c.def) || c.def.footprint === 'wall');
  return { cells, walls, grounded, occupied, structure, standing };
}

/** The design an opening draws with: named on the tile, or the plain fallback. */
export function cutOf(def: TileDrawDef): TileCut | null {
  if (def.cut !== undefined) return def.cut;
  if (def.footprint !== 'wall') return null;
  if (def.kind === 'door') return 'door';
  // Only a FULL-height see-through wall is glazing. A railing or a velvet
  // rope is see-through because it is low, not because it is glass.
  if (def.blocksSight === false && (def.height ?? 0) >= 1) return 'glass';
  return null;
}

/**
 * The run of one opening this cell ends, or null.
 *
 * Adjacent cells of the same cut tile are one opening. It is drawn ONCE, from
 * the run's last cell — the nearest, the one drawn last — so nothing of the
 * run is painted over it afterwards. Every other cell of the run draws its
 * slab and nothing else. The run follows the wall: along x when the cell is
 * joined east or west, along y when north or south, and along x for a cell
 * that stands alone.
 */
export function cutRunFor(
  plan: Pick<TilePlan, 'structure' | 'walls'>,
  cell: Pick<TileCell, 'col' | 'row' | 'id' | 'def'>,
): CutRun | null {
  const cut = cutOf(cell.def);
  if (cut === null) return null;
  const j = joinsOf(plan.walls, cell.col, cell.row);
  const axis: 'x' | 'y' = (j.w || j.e) && !(j.n || j.s) ? 'x' : j.n || j.s ? 'y' : 'x';
  const [dc, dr] = axis === 'x' ? [1, 0] : [0, 1];
  const same = (c: number, r: number) => plan.structure.get(`${c},${r}`) === cell.id;
  if (same(cell.col + dc, cell.row + dr)) return null; // not the last of its run
  let n = 1;
  while (n < 32 && same(cell.col - dc * n, cell.row - dr * n)) n += 1;
  const lo = (1 - WALL_THICKNESS) / 2;
  const hi = lo + WALL_THICKNESS;
  const rect: CutRun['rect'] =
    axis === 'x'
      ? [cell.col - (n - 1), cell.row + lo, cell.col + 1, cell.row + hi]
      : [cell.col + lo, cell.row - (n - 1), cell.col + hi, cell.row + 1];
  return { rect, axis, n };
}

/**
 * Widen a set of changed cells to the whole of any opening they belong to.
 *
 * An opening is drawn from its last cell across all of them, so a change to
 * ANY cell of a run — or beside one, which can split or extend it — has to
 * redraw the run's whole span. Both the old and the new layer are walked,
 * because a cell that used to end a run and a cell that now does are not
 * the same cell.
 */
export function expandCutRuns(
  changed: Iterable<string>,
  inputs: ReadonlyArray<TileDrawInput | null>,
): Set<string> {
  const out = new Set<string>(changed);
  for (const input of inputs) {
    if (input === null) continue;
    const structure = { ...(input.cells ?? {}), ...(input.structure ?? {}) };
    const isCut = (id: string | undefined): boolean => {
      if (id === undefined) return false;
      const def = input.defs[tileDefKey(input.tilesetId, id)];
      return def !== undefined && cutOf(def) !== null;
    };
    for (const key of changed) {
      const at = parseKey(key);
      if (at === null) continue;
      // The cell itself and its four neighbours: a change here may have
      // joined or split a run that runs through any of them.
      for (const [sc, sr] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const c0 = at.col + sc;
        const r0 = at.row + sr;
        const id = structure[`${c0},${r0}`];
        if (!isCut(id)) continue;
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          for (let k = 1; k < 32; k += 1) {
            const kk = `${c0 + dc * k},${r0 + dr * k}`;
            if (structure[kk] !== id) break;
            out.add(kk);
          }
        }
        out.add(`${c0},${r0}`);
      }
    }
  }
  return out;
}

/**
 * The edge of the map: where a painted square meets nothing.
 *
 * A floor that simply stops reads as tiles laid on a table. A floor with an
 * edge — an ink line along the drop and a shadow falling off the near sides —
 * reads as a slab with a thickness, and the unpainted void around it as
 * space rather than an unfinished job. Drawn per floor cell against the four
 * neighbours, so it costs nothing where the map continues.
 */
const EDGE_DROP = 0.16;
const EDGE_ALPHA = 0.55;

function drawFloorEdge(
  g: Graphics,
  m: SceneMetrics,
  cell: TileCell,
  occupied: ReadonlySet<string>,
): void {
  const { col, row } = cell;
  const has = (c: number, r: number) => occupied.has(`${c},${r}`);
  const [n, e, s, w] = rectCorners(m, col, row, col + 1, row + 1);
  const base = parseColor(cell.def.colors[0], 0x3b3f45);
  const ink = shade(base, 0.5);
  const edge = (a: Point, b: Point) =>
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: ink, alpha: EDGE_ALPHA });
  // The two sides that face the viewer take a shadow that falls off the slab.
  const drop = (a: Point, b: Point, dx: number, dy: number) => {
    const [a2, b2] = [
      worldFromGrid(m, { x: 0, y: 0 }),
      worldFromGrid(m, { x: dx, y: dy }),
    ];
    const ox = b2.x - a2.x;
    const oy = b2.y - a2.y;
    poly(g, [a, b, { x: b.x + ox, y: b.y + oy }, { x: a.x + ox, y: a.y + oy }]).fill({
      color: C.ground,
      alpha: 0.35,
    });
  };
  if (!has(col, row - 1)) edge(n, e);
  if (!has(col - 1, row)) edge(w, n);
  if (!has(col + 1, row)) {
    drop(e, s, EDGE_DROP, 0);
    edge(e, s);
  }
  if (!has(col, row + 1)) {
    drop(s, w, 0, EDGE_DROP);
    edge(s, w);
  }
}

function joinsOf(walls: ReadonlySet<string>, col: number, row: number): WallJoins {
  return {
    n: walls.has(`${col},${row - 1}`),
    s: walls.has(`${col},${row + 1}`),
    w: walls.has(`${col - 1},${row}`),
    e: walls.has(`${col + 1},${row}`),
  };
}

// ---------------------------------------------------------------------------
// The three passes, one cell at a time
// ---------------------------------------------------------------------------

/**
 * Pass 1: everything flat — floors, stains, drains, and the default floor
 * under a standing tile whose cell has no ground of its own.
 */
export function drawFloorCell(
  g: Graphics,
  m: SceneMetrics,
  cell: TileCell,
  plan: Pick<TilePlan, 'grounded' | 'occupied'>,
): void {
  const key = `${cell.col},${cell.row}`;
  if (isStanding(cell.def) || cell.def.footprint === 'wall') {
    if (!plan.grounded.has(key)) {
      drawUnderlay(g, cell.def, m, cell.col, cell.row);
      drawFloorEdge(g, m, cell, plan.occupied);
    }
    return;
  }
  // Flat props with a partial footprint — a storm drain, an oil stain —
  // still want the default floor beneath them when nothing was painted.
  if (cell.def.footprint !== undefined && cell.def.footprint !== 'fill' && !plan.grounded.has(key)) {
    drawUnderlay(g, cell.def, m, cell.col, cell.row);
  }
  if (cell.def.prop !== undefined) {
    // A flat designed prop — a pallet, a mattress — lies on the floor rather
    // than being the floor, so it wants ground under it like a thin tile.
    if (!plan.grounded.has(key)) drawUnderlay(g, cell.def, m, cell.col, cell.row);
    drawPropTile(g, cell.def, m, cell.col, cell.row);
    if (cell.layer === 0 || !plan.grounded.has(key)) drawFloorEdge(g, m, cell, plan.occupied);
    return;
  }
  drawFillTile(g, cell.def, m, cell.col, cell.row);
  // The edge is drawn by whichever flat thing sits lowest in the square: the
  // ground when there is one, otherwise the flat prop standing in for it.
  if (cell.layer === 0 || !plan.grounded.has(key)) drawFloorEdge(g, m, cell, plan.occupied);
}

/** Pass 2a: the ambient ring a full-height thing takes out of the floor around it. */
export function drawAmbientFor(
  g: Graphics,
  m: SceneMetrics,
  cell: TileCell,
  plan: Pick<TilePlan, 'walls'>,
): void {
  if ((cell.def.height ?? 0) < 1) return;
  const shape = cell.def.footprint;
  if (cell.def.prop !== undefined) {
    // A designed thing takes light from the floor around its own footprint,
    // and only when it is solid enough to: a lamp post and a tree are full
    // height but a sightline passes them, and so does the light.
    if (cell.def.blocksSight !== false) drawAmbientRing(g, m, objectRect(cell.def, cell.col, cell.row));
  } else if (shape === 'wall') {
    for (const r of wallRects(cell.col, cell.row, joinsOf(plan.walls, cell.col, cell.row))) {
      drawAmbientRing(g, m, r);
    }
  } else if (shape === undefined || shape === 'fill') {
    drawAmbientRing(g, m, [cell.col, cell.row, cell.col + 1, cell.row + 1]);
  }
}

/** Pass 2b: the contact shadow a standing thing casts on the floor. */
export function drawShadowFor(
  g: Graphics,
  m: SceneMetrics,
  cell: TileCell,
  plan: Pick<TilePlan, 'walls'>,
): void {
  const h = cell.def.height ?? (cell.def.footprint === 'stair' ? 0.5 : 0);
  const shape = cell.def.footprint;
  if (cell.def.prop !== undefined) {
    // A flat designed prop lies on the floor and casts nothing; a standing
    // one casts from the footprint its design declares.
    if (h > 0) drawGroundShadow(g, m, objectRect(cell.def, cell.col, cell.row), h);
  } else if (shape === 'wall') {
    for (const r of wallRects(cell.col, cell.row, joinsOf(plan.walls, cell.col, cell.row))) {
      drawGroundShadow(g, m, r, h);
    }
  } else if (shape === 'post' || shape === 'canopy' || shape === 'round') {
    drawGroundShadow(g, m, objectRect(cell.def, cell.col, cell.row), h);
  } else if (shape === 'stair') {
    drawGroundShadow(g, m, [cell.col + 0.12, cell.row, cell.col + 0.88, cell.row + 1], h);
  } else {
    drawGroundShadow(g, m, [cell.col, cell.row, cell.col + 1, cell.row + 1], h);
  }
}

/**
 * Pass 3: one standing tile. Any light it gives off is collected into the
 * open light pass (`PENDING_LIGHTS`) rather than drawn here — see `drawGlow`.
 */
export function drawStandingCell(
  g: Graphics,
  m: SceneMetrics,
  cell: TileCell,
  plan: Pick<TilePlan, 'walls' | 'structure'>,
): void {
  const shape = cell.def.footprint;
  if (cell.def.prop !== undefined) {
    // A design beats a footprint: the footprint still says where the shadow
    // falls, but the thing itself is built by its design.
    drawPropTile(g, cell.def, m, cell.col, cell.row);
  } else if (shape === 'stair') {
    drawStairTile(g, cell.def, m, cell.col, cell.row);
  } else if (shape === 'post' || shape === 'canopy' || shape === 'round') {
    drawObjectTile(g, cell.def, m, cell.col, cell.row);
  } else if (shape === 'wall') {
    // Joins are read from the finished set, not from draw order, so a run
    // looks the same whichever end the GM painted from.
    drawWallTile(
      g,
      cell.def,
      m,
      cell.col,
      cell.row,
      joinsOf(plan.walls, cell.col, cell.row),
      cutRunFor(plan as TilePlan, cell),
    );
  } else {
    drawFillTile(g, cell.def, m, cell.col, cell.row);
  }
}

/** A light waiting for the unlit pass. */
export interface PendingLight {
  face: Point[];
  glow: number;
}

/**
 * Open a light pass. Every `drawGlow` until `closeLights` is called is
 * collected rather than drawn, so the caller can paint the lights over
 * whatever else it draws — a whole layer, or one chunk of one.
 */
export function openLights(): void {
  PENDING_LIGHTS = [];
}

export function closeLights(): PendingLight[] {
  const lights = PENDING_LIGHTS ?? [];
  PENDING_LIGHTS = null;
  return lights;
}

/** The unlit pass: every collected light, over everything. */
export function drawLights(g: Graphics, m: SceneMetrics, lights: readonly PendingLight[]): void {
  for (const light of lights) paintGlow(g, m, light.face, light.glow);
}

// ---------------------------------------------------------------------------
// Chunks: the unit of redraw
// ---------------------------------------------------------------------------

/**
 * Cells per chunk side. The stage redraws a chunk when any of its cells
 * changes, so this is the trade between "one stroke redraws the world" (a
 * single chunk) and "a thousand tiny graphics" (one per cell). Eight squared
 * is sixty-four cells: a stroke touches one or two, a 40×30 scene has twenty.
 */
export const CHUNK = 8;

export function chunkKey(col: number, row: number): string {
  return `${Math.floor(col / CHUNK)},${Math.floor(row / CHUNK)}`;
}

/** Chunk draw order for standing things: nearer chunks later, like cells. */
export function chunkDepth(key: string): number {
  const [cx, cy] = key.split(',').map(Number) as [number, number];
  return cx + cy;
}

/**
 * The per-cell signature the diff compares, one string per painted square:
 * every layer's tile id, so a change in any of them is a change.
 */
export function cellSignatures(input: TileDrawInput): Map<string, string> {
  const out = new Map<string, string>();
  const add = (map: Record<string, string> | undefined, layer: string) => {
    for (const [key, tileId] of Object.entries(map ?? {})) {
      out.set(key, `${out.get(key) ?? ''}${layer}=${tileId};`);
    }
  };
  add(input.cells, 'c');
  add(input.ground, 'g');
  add(input.structure, 's');
  add(input.object, 'o');
  return out;
}

/**
 * Which chunks a set of changed cells dirties.
 *
 * A cell's rendering depends on its four orthogonal neighbours — wall runs
 * turn corners from them, and a shadow or an ambient ring reaches into them —
 * so a change on a chunk's edge dirties the chunk next door as well.
 */
export function dirtyChunks(changed: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const key of changed) {
    const at = parseKey(key);
    if (at === null) continue;
    for (const [dc, dr] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      out.add(chunkKey(at.col + dc, at.row + dr));
    }
  }
  return out;
}

/** The cells whose signature differs between two layers, either way round. */
export function changedCells(
  prev: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): string[] {
  const out: string[] = [];
  for (const [key, sig] of next) if (prev.get(key) !== sig) out.push(key);
  for (const key of prev.keys()) if (!next.has(key)) out.push(key);
  return out;
}

/**
 * Draw the whole painted layer into ONE graphics. Cells outside the grid are
 * skipped.
 *
 * THREE PASSES, because a contact shadow has to land on the floor next to a
 * thing and under the thing itself, and one depth-sorted pass cannot put it
 * there: the floor in front of a wall is nearer than the wall, so it is drawn
 * later, over anything the wall's turn painted onto it.
 *
 *   1. Everything flat.
 *   2. Every standing tile's ambient ring, then its shadow, on that floor.
 *   3. Every standing tile, nearest last — then every light, over all of it.
 *
 * Pass 1 never occludes pass 3: a flat cell sits at ground level, and a
 * standing thing behind it rises AWAY from it on screen. So the split costs
 * nothing in correctness and buys the shadows a floor to fall on.
 *
 * This is the one-shot form. The stage draws the same passes through
 * `ChunkedTileLayer`, which redraws only the chunks a stroke touched.
 */
export function drawTiles(g: Graphics, m: SceneMetrics, input: TileDrawInput): void {
  g.clear();
  const plan = planTiles(m, input);
  openLights();
  for (const cell of plan.cells) drawFloorCell(g, m, cell, plan);
  for (const cell of plan.standing) drawAmbientFor(g, m, cell, plan);
  for (const cell of plan.standing) drawShadowFor(g, m, cell, plan);
  for (const cell of plan.standing) drawStandingCell(g, m, cell, plan);
  drawLights(g, m, closeLights());
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
