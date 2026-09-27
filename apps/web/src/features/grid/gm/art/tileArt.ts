/**
 * The tile painter (FR9.2): the Build palette's pictures of its tiles.
 *
 * Tiles are drawn, not blitted. Each carries a two-colour palette and a
 * pattern name; the strokes below turn that into concrete, planking, grating
 * and so on. That is why the catalogue is kilobytes instead of an image pack,
 * why it stays crisp at any zoom, and why we ship it at all — a drawn tile is
 * ours, a texture pack would not be (§14).
 *
 * This painter drew the 2D map's floor. The map is 3D now and builds its own
 * geometry from the same plan (`plan/tiles.ts`, read by `lab3d/world3d.ts`);
 * what still draws this way is the palette's sheet of tile pictures
 * (`gm/swatches.ts`), all of it at once.
 */
import type { Point } from '@safehouse/contracts';
import { SHEEN_ALPHA_MAX, WALL_THICKNESS, type TilePattern } from '@safehouse/rules';
import { groundRadius, heightRise, rectCorners, worldFromGrid, type SceneMetrics } from '../../geometry.js';
import {
  band,
  cutOf,
  cutRunFor,
  diagonalOnly,
  isStanding,
  joinsOf,
  planTiles,
  wallBoxes,
  wallDiagonals,
  type CutRun,
  type GroundSplit,
  type TileCell,
  type TileDrawInput,
  type TilePlan,
  type WallJoins,
} from '../../plan/tiles.js';
import { C, FACE_FOOT, FACE_SHADE, parseColor, shade } from '../../stage/colors.js';
import { designFootprint, drawProp, propFootprint, propPlacement } from '../../stage/props.js';
import { tileDefKey, type TileDrawDef } from '../../types.js';
import type { ArtPen } from './canvasPen.js';
import { drawCut } from './cutArt.js';
import { drawShoreTop, drawWaterCell, waterSink } from './waterArt.js';

// Every draw here is a call on an `ArtPen` (`canvasPen.ts`) — the part of a
// pixi Graphics this painter uses, which a Canvas2D pen or a test's recorder
// can be — so the module needs no renderer to run or to test. What to draw
// (which cells, in what order, which way a wall turns) is the plan's
// (`plan/tiles.ts`); how it looks is this module's.

function poly(g: ArtPen, pts: readonly Point[]): ArtPen {
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
  g: ArtPen,
  m: SceneMetrics,
  rect: readonly [number, number, number, number],
  height: number,
  alpha = SHADOW_ALPHA,
): void {
  const d = SHADOW_REACH * Math.max(0.5, height);
  const [x0, y0, x1, y1] = rect;
  poly(g, rectCorners(m, x0 + d, y0 + d, x1 + d, y1 + d)).fill({
    color: C.ground,
    alpha,
  });
}

/** The convex hull of some grid points (monotone chain). */
function hull(pts: ReadonlyArray<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Array<{ x: number; y: number }> = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Array<{ x: number; y: number }> = [];
  for (let i = p.length - 1; i >= 0; i -= 1) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The contact shadow of a footprint at any angle — a piece of a curved or
 * angled wall: the footprint swept along the light's lean, as its hull with
 * a copy pushed away from the light. The axis-aligned box that stood in for
 * it was a square round every half-square of a curve, and a curve drawn as
 * overlapping squares came out as a staircase of blotches.
 */
function drawGroundShadowPoly(
  g: ArtPen,
  m: SceneMetrics,
  footprint: ReadonlyArray<{ x: number; y: number }>,
  height: number,
  alpha = SHADOW_ALPHA,
): void {
  const d = SHADOW_REACH * Math.max(0.5, height);
  const swept = hull([...footprint, ...footprint.map((q) => ({ x: q.x + d, y: q.y + d }))]);
  poly(g, swept.map((q) => worldFromGrid(m, q))).fill({ color: C.ground, alpha });
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
  g: ArtPen,
  m: SceneMetrics,
  rect: readonly [number, number, number, number],
  alpha = AMBIENT_ALPHA,
): void {
  const [x0, y0, x1, y1] = rect;
  const d = AMBIENT_REACH;
  poly(g, rectCorners(m, x0 - d, y0 - d, x1 + d, y1 + d)).fill({
    color: C.ground,
    alpha,
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
function drawCrown(g: ArtPen, top: readonly Point[], base: number): void {
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
function drawSheen(g: ArtPen, def: TileDrawDef, top: readonly Point[]): void {
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
  g: ArtPen,
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
  g: ArtPen,
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
 * An extruded slab of any convex footprint, given in GRID coordinates — the
 * piece of a wall that does not run along the grid: a diagonal join, a
 * stretch of a curved wall.
 *
 * Only the faces turned toward the viewer are drawn (their outward normal
 * points down or right on the grid), shaded between the two lit faces a box
 * has by which way they face, back to front.
 */
function drawSlabPoly(
  g: ArtPen,
  m: SceneMetrics,
  ground: ReadonlyArray<{ x: number; y: number }>,
  rise: number,
  base: number,
  tones?: Tones,
): Point[] {
  const world = ground.map((p) => worldFromGrid(m, p));
  const top = world.map((p) => ({ x: p.x, y: p.y - rise }));
  if (rise > 0) {
    const cx = ground.reduce((n, p) => n + p.x, 0) / ground.length;
    const cy = ground.reduce((n, p) => n + p.y, 0) / ground.length;
    const faces: Array<{ depth: number; i: number; lit: number }> = [];
    for (let i = 0; i < ground.length; i += 1) {
      const p = ground[i]!;
      const q = ground[(i + 1) % ground.length]!;
      let nx = q.y - p.y;
      let ny = p.x - q.x;
      // Outward: away from the middle of the slab.
      if (nx * ((p.x + q.x) / 2 - cx) + ny * ((p.y + q.y) / 2 - cy) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const len = Math.hypot(nx, ny) || 1;
      const ex = Math.max(0, nx / len);
      const ey = Math.max(0, ny / len);
      if (ex + ey < 1e-3) continue;
      faces.push({ depth: p.x + p.y + q.x + q.y, i, lit: (ey * FACE_SHADE.left + ex * FACE_SHADE.right) / (ex + ey) });
    }
    faces.sort((a, b) => a.depth - b.depth);
    for (const f of faces) {
      drawStandingFace(g, world[f.i]!, world[(f.i + 1) % world.length]!, rise, base, f.lit);
    }
  }
  poly(g, top).fill({ color: rise > 0 ? shade(base, FACE_SHADE.top) : base });
  if (tones) poly(g, top).stroke({ width: 1, color: tones.ink, alpha: 0.5, pixelLine: true });
  if (rise > 0) drawCrown(g, top, base);
  return top;
}

/** A stretch of a wall at any angle or a curved wall, in its tile's material. */
function drawArcPiece(
  g: ArtPen,
  def: TileDrawDef,
  m: SceneMetrics,
  seg: { a: { x: number; y: number }; b: { x: number; y: number } },
  opening?: { open: boolean },
): void {
  const base = parseColor(def.colors[0], 0x3b3f45);
  const accent = parseColor(def.colors[1], 0x5a6068);
  const tones = tonesOf(base, accent);
  if (opening !== undefined) {
    // A door along the curve: open, it is a gap with its threshold on the
    // floor; shut, a leaf the door's colours with its seam down the middle.
    // A window is glass to sill height, see-through.
    if (opening.open) {
      const t = band(seg.a, seg.b, 0.04).map((p) => worldFromGrid(m, p));
      poly(g, t).fill({ color: tones.dark, alpha: 0.5 });
      return;
    }
    const glass = def.blocksSight === false;
    const rise = heightRise(m, glass ? Math.min(def.height ?? 1, 1) : (def.height ?? 1));
    const top = drawSlabPoly(g, m, band(seg.a, seg.b, 0.04), rise, glass ? shade(base, 1.1) : base, tones);
    const mid = [seg.a, seg.b].map((p) => {
      const w = worldFromGrid(m, p);
      return { x: w.x, y: w.y - rise };
    });
    g.moveTo(mid[0]!.x, mid[0]!.y).lineTo(mid[1]!.x, mid[1]!.y).stroke({
      width: glass ? 2 : 1,
      color: glass ? 0x9fd4e6 : tones.ink,
      alpha: glass ? 0.7 : 0.6,
      ...(glass ? {} : { pixelLine: true }),
    });
    drawGlow(g, m, def, accent, top);
    return;
  }
  // A hair past each end, so the pieces of a curve close up without a seam.
  const top = drawSlabPoly(g, m, band(seg.a, seg.b, 0.04), heightRise(m, def.height ?? 1), base, tones);
  drawGlow(g, m, def, accent, top);
}

/**
 * A square of ground split along a wall that crosses it at an angle: each
 * half drawn as the ground beside it on that side, its texture clipped to the
 * half, so the floor runs up to the wall on both sides as if the square were
 * theirs. A side with nothing beside it stays open.
 */
function drawSplitGround(
  g: ArtPen,
  m: SceneMetrics,
  cell: TileCell,
  split: GroundSplit,
  defs: Record<string, TileDrawDef> | undefined,
  tilesetId: string | undefined,
): void {
  const { col, row } = cell;
  const len = Math.hypot(split.d.x, split.d.y) || 1;
  const square: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (const side of split.sides) {
    if (side.id === null) continue;
    const def = defs && tilesetId !== undefined ? defs[tileDefKey(tilesetId, side.id)] : cell.def;
    if (def === undefined) continue;
    const nx = (-split.d.y / len) * side.sign;
    const ny = (split.d.x / len) * side.sign;
    CLIP = (u, v) => (u - split.p.x) * nx + (v - split.p.y) * ny;
    try {
      const half = clipPoly(square);
      if (half.length < 3) continue;
      const base = grained(parseColor(def.colors[0], 0x3b3f45), col, row);
      const accent = parseColor(def.colors[1], 0x5a6068);
      poly(
        g,
        half.map(([u, v]) => worldFromGrid(m, { x: col + u, y: row + v })),
      ).fill({ color: base });
      drawPattern(g, m, def, tonesOf(base, accent), [col, row, col + 1, row + 1], 0, cellSeed(col, row));
    } finally {
      CLIP = null;
    }
  }
}

/** The eight-sided post at the middle of a diagonal cell, where its bands meet. */
function diagonalPost(): Array<{ x: number; y: number }> {
  const r = WALL_THICKNESS / 2 / Math.cos(Math.PI / 8);
  return Array.from({ length: 8 }, (_, i) => {
    const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
    return { x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r };
  });
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
  g: ArtPen,
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

/**
 * A half-plane in cell-local (u, v) that every pattern primitive is clipped
 * to while it is set — how half a square takes the carpet and the other half
 * the paving where a wall runs through it at an angle (`groundSplits`).
 * Positive or zero is kept.
 */
let CLIP: ((u: number, v: number) => number) | null = null;

/** Sutherland–Hodgman against `CLIP`: the part of a polygon on the kept side. */
function clipPoly(pts: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  if (CLIP === null) return pts.map(([u, v]) => [u, v]);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const da = CLIP(a[0], a[1]);
    const db = CLIP(b[0], b[1]);
    if (da >= 0) out.push([a[0], a[1]]);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function uvLine(g: ArtPen, P: FaceMap, pts: ReadonlyArray<readonly [number, number]>): ArtPen {
  const first = pts[0];
  if (first === undefined) return g;
  if (CLIP !== null) {
    // Only the pieces on the kept side, each its own run.
    const clip = CLIP;
    for (let i = 0; i + 1 < pts.length; i += 1) {
      let [au, av] = pts[i]!;
      let [bu, bv] = pts[i + 1]!;
      const da = clip(au, av);
      const db = clip(bu, bv);
      if (da < 0 && db < 0) continue;
      if (da < 0) {
        const t = da / (da - db);
        au += (bu - au) * t;
        av += (bv - av) * t;
      } else if (db < 0) {
        const t = da / (da - db);
        bu = au + (bu - au) * t;
        bv = av + (bv - av) * t;
      }
      const a = P(au, av);
      const b = P(bu, bv);
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
    }
    return g;
  }
  const a = P(first[0], first[1]);
  g.moveTo(a.x, a.y);
  for (let i = 1; i < pts.length; i += 1) {
    const p = P(pts[i]![0], pts[i]![1]);
    g.lineTo(p.x, p.y);
  }
  return g;
}

function uvPoly(g: ArtPen, P: FaceMap, pts: ReadonlyArray<readonly [number, number]>): ArtPen {
  const kept = clipPoly(pts);
  // Nothing on the kept side: an empty path, so the fill or stroke that
  // follows has nothing to paint.
  if (kept.length < 3) return g.beginPath();
  return poly(
    g,
    kept.map(([u, v]) => P(u, v)),
  );
}

/** A quad in uv space, filled. */
function uvRect(
  g: ArtPen,
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
  g: ArtPen,
  m: SceneMetrics,
  P: FaceMap,
  u: number,
  v: number,
  r: number,
  style: { color: number; alpha: number },
): void {
  if (CLIP !== null && CLIP(u, v) < 0) return;
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
 *
 * ## Why no pattern draws a grid of its own
 *
 * The map's grid lines are the one set of straight lines a GM counts squares
 * by. A texture that ALSO draws straight, full-length, dark lines — grout on
 * thirds, a board seam across the middle, bars along the cell's own edges, a
 * bevel a hair inside them — reads as a second, finer grid, doubles the real
 * one, and makes the squares hard to count. So: nothing is drawn on or hugging
 * a cell edge, nothing splits the cell evenly in half, and the seams that do
 * run across a cell (boards, grout, courses, joints) are drawn soft — the
 * `dark` tone at low alpha, never the ink — and broken where the material
 * would break them. Ink is for cracks and chips, which no one mistakes for a
 * grid line.
 */
function drawPattern(
  g: ArtPen,
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
      const boards = 5;
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
      // Seams between boards, soft; each board has a butt joint somewhere
      // along it, staggered, so the seams read as boards and not ruled lines.
      for (let i = 1; i < boards; i += 1) {
        line(
          [
            [0, i / boards],
            [1, i / boards],
          ],
          dark,
          0.3,
        );
      }
      for (let i = 0; i < boards; i += 1) {
        const u = 0.2 + rnd(seed, 50 + i) * 0.6;
        line(
          [
            [u, (i + 0.15) / boards],
            [u, (i + 0.85) / boards],
          ],
          dark,
          0.35,
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
      // Grout, soft: the tiles are told apart by tone, the joints only hinted.
      for (let i = 1; i < n; i += 1) {
        line(
          [
            [i / n, 0],
            [i / n, 1],
          ],
          dark,
          0.25,
        );
        line(
          [
            [0, i / n],
            [1, i / n],
          ],
          dark,
          0.25,
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
      // Bars at the middle of each run, never on the cell's own edges, where
      // they would sit on the grid line and thicken it.
      const n = 5;
      for (let i = 0; i < n; i += 1) {
        const t = (i + 0.5) / n;
        line(
          [
            [t, 0],
            [t, 1],
          ],
          accent,
          0.75,
          2,
        );
        line(
          [
            [0, t],
            [1, t],
          ],
          light,
          0.4,
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
      // A liquid is drawn as a body by `waterArt.ts`; this is the printed kind —
      // a puddle, an oil slick, a fountain's bowl.
      if (def.liquid !== undefined) break;
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
            dark,
            0.35,
          );
        }
      }
      break;
    }
    case 'panel': {
      // A bevelled plate: lit on the two edges toward the key light, shadowed
      // on the other two, with a rivet in each corner.
      // Inset well clear of the edge: a bevel a hair inside the cell is a
      // second grid line drawn beside the first.
      const i0 = 0.17;
      const i1 = 0.83;
      line(
        [
          [i0, i1],
          [i0, i0],
          [i1, i0],
        ],
        light,
        0.4,
      );
      line(
        [
          [i1, i0],
          [i1, i1],
          [i0, i1],
        ],
        dark,
        0.45,
      );
      for (const [u, v] of [
        [0.22, 0.22],
        [0.78, 0.22],
        [0.22, 0.78],
        [0.78, 0.78],
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
        [0.16, 0.16],
        [0.84, 0.16],
        [0.84, 0.84],
        [0.16, 0.84],
      ]).stroke({ width: 1, color: light, alpha: 0.25, pixelLine: true });
      line(
        [
          [0.2, 0.2],
          [0.8, 0.8],
        ],
        accent,
        0.75,
        3,
      );
      line(
        [
          [0.8, 0.2],
          [0.2, 0.8],
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
    case 'cobble': {
      // Setts in offset courses: each stone its own tone, rounded by a lit
      // top-left edge and a dark joint below and right.
      const cols = 4;
      const rows = 4;
      for (let j = 0; j < rows; j += 1) {
        const off = j % 2 === 0 ? 0 : 0.5;
        for (let i = -1; i < cols; i += 1) {
          const u0 = Math.max(0, (i + off) / cols + 0.02);
          const u1 = Math.min(1, (i + off + 1) / cols - 0.02);
          if (u1 <= u0) continue;
          const v0 = j / rows + 0.02;
          const v1 = (j + 1) / rows - 0.02;
          const tone = shade(tones.base, 0.94 + rnd(seed, i * 7 + j * 13 + 3) * 0.12);
          uvRect(g, P, u0, v0, u1, v1, { color: tone, alpha: 0.85 });
          line([[u0, v0], [u1, v0]], light, 0.25);
          line([[u0, v1], [u1, v1]], dark, 0.4);
        }
      }
      break;
    }
    case 'marble': {
      // Two big slabs, a soft vein across each, one hairline joint. Kept
      // quiet: polished stone is read by its sheen, not its pattern.
      // The slabs are told apart by tone alone: a joint across the middle of
      // every cell is a half-grid.
      uvRect(g, P, 0, 0, 1, 0.5, { color: shade(tones.base, 1.03), alpha: 0.5 });
      uvRect(g, P, 0, 0.5, 1, 1, { color: shade(tones.base, 0.98), alpha: 0.5 });
      for (let i = 0; i < 2; i += 1) {
        const v = 0.1 + i * 0.5 + rnd(seed, i) * 0.3;
        const u = rnd(seed, 10 + i) * 0.4;
        line(
          [
            [u, v],
            [u + 0.25, v + 0.08 + rnd(seed, 20 + i) * 0.06],
            [u + 0.55, v - 0.04],
          ],
          i === 0 ? light : accent,
          0.28,
        );
      }
      break;
    }
    case 'sand': {
      // Grain as a fine stipple, a ripple line, two pebbles.
      for (let i = 0; i < 18; i += 1) {
        uvDot(g, m, P, rnd(seed, i), rnd(seed, 30 + i), 0.012, {
          color: i % 3 === 0 ? light : dark,
          alpha: 0.45,
        });
      }
      const v = 0.3 + rnd(seed, 60) * 0.4;
      line(
        [
          [0.05, v],
          [0.3, v - 0.05],
          [0.55, v + 0.04],
          [0.8, v - 0.03],
          [0.95, v + 0.02],
        ],
        accent,
        0.4,
      );
      for (let i = 0; i < 2; i += 1) {
        uvDot(g, m, P, 0.15 + rnd(seed, 70 + i) * 0.7, 0.15 + rnd(seed, 80 + i) * 0.7, 0.03, { color: dark, alpha: 0.8 });
      }
      break;
    }
    case 'field': {
      // Furrows: five parallel ridges, lit on one side, with the odd break.
      const n = 5;
      for (let i = 0; i < n; i += 1) {
        const v = (i + 0.5) / n;
        const gap = rnd(seed, i) < 0.25;
        const cut = 0.3 + rnd(seed, 10 + i) * 0.4;
        uvRect(g, P, 0, v - 0.06, gap ? cut : 1, v + 0.06, { color: dark, alpha: 0.35 });
        if (gap) uvRect(g, P, cut + 0.1, v - 0.06, 1, v + 0.06, { color: dark, alpha: 0.35 });
        line([[0, v - 0.06], [1, v - 0.06]], light, 0.25);
      }
      for (let i = 0; i < 4; i += 1) {
        uvDot(g, m, P, rnd(seed, 20 + i), rnd(seed, 30 + i), 0.02, { color: accent, alpha: 0.7 });
      }
      break;
    }
    case 'reeds': {
      // Dark water, then standing stalks leaning together, a seed head on some.
      // In a liquid the water is the body underneath, so only the stalks.
      if (def.liquid === undefined) uvRect(g, P, 0, 0, 1, 1, { color: dark, alpha: 0.3 });
      for (let i = 0; i < 12; i += 1) {
        const u = 0.05 + rnd(seed, i) * 0.9;
        const v = 0.25 + rnd(seed, 20 + i) * 0.7;
        const lean = -0.02 + rnd(seed, 40 + i) * 0.05;
        const tall = 0.18 + rnd(seed, 60 + i) * 0.14;
        line([[u, v], [u + lean, v - tall]], i % 4 === 0 ? light : accent, 0.85);
        if (i % 3 === 0) uvDot(g, m, P, u + lean, v - tall, 0.014, { color: light, alpha: 0.8 });
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
  g: ArtPen,
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
function drawOutline(g: ArtPen, ground: readonly Point[], top: readonly Point[], tones: Tones): void {
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
  g: ArtPen,
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

function paintGlow(g: ArtPen, m: SceneMetrics, face: readonly Point[], glow: number): void {
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
  g: ArtPen,
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
function drawBevel(g: ArtPen, m: SceneMetrics, rect: FaceRect, rise: number, tones: Tones): void {
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
  g: ArtPen,
  def: TileDrawDef,
  m: SceneMetrics,
  col: number,
  row: number,
  joins: WallJoins,
  run: CutRun | null,
  open: readonly boolean[] = [],
): void {
  const base = parseColor(def.colors[0], 0x3b3f45);
  const accent = parseColor(def.colors[1], 0x5a6068);
  const rise = heightRise(m, def.height ?? 0);
  const tones = tonesOf(base, accent);
  const material = { pattern: def.pattern, tones };
  const seed = cellSeed(col, row);
  const opening = cutOf(def) !== null;

  let lastTop: Point[] = [];
  const diagonal = diagonalOnly(joins);
  // A diagonal door or window: its opening design is drawn along the grid,
  // so across a 45° run it is the wall in the opening's own colours, and an
  // open one is a gap.
  if (diagonal && opening && open[0] === true) return;
  const toGrid = (poly: Array<{ x: number; y: number }>) => poly.map((p) => ({ x: col + p.x, y: row + p.y }));
  if (diagonal) lastTop = drawSlabPoly(g, m, toGrid(diagonalPost()), rise, base, tones);
  for (const d of wallDiagonals(joins)) lastTop = drawSlabPoly(g, m, toGrid(d), rise, base, tones);
  for (const r of diagonal ? [] : wallRects(col, row, joins)) {
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
  if (run !== null && !diagonal) {
    const cut = cutOf(def);
    if (cut !== null) drawCut(g, m, cut, run, rise, tones, def.emissive, open);
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
  g: ArtPen,
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
    drawPattern(g, m, def, tones, objectRect(def, col, row, m), rise, seed);
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
  m: SceneMetrics,
): [number, number, number, number] {
  if (def.prop !== undefined) {
    if (!m.designSize) return propFootprint(def.prop, col, row, m.unitM);
    const [u0, v0, u1, v1] = designFootprint(def.prop);
    return [col + u0, row + v0, col + u1, row + v1];
  }
  const r = def.footprint === 'canopy' ? 0.42 : def.footprint === 'round' ? 0.34 : 0.15;
  return [col + 0.5 - r, row + 0.5 - r, col + 0.5 + r, row + 0.5 + r];
}

/**
 * A designed prop — a desk, a car, a lamp post — built by `stage/props.ts`
 * in the tile's own tones. Any light it gives off is handed to the light
 * pass from the face the design says is the fixture.
 */
function drawPropTile(
  g: ArtPen,
  def: TileDrawDef,
  m: SceneMetrics,
  col: number,
  row: number,
  /** Cells below the land it stands at: a boat floats `WATER_LEVEL` down. */
  sink = 0,
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
    sink,
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
  g: ArtPen,
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
  g: ArtPen,
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

/**
 * Per cell of an opening's run, first to last, whether its painted door
 * stands open (FR9.24). Empty when nothing on the floor is open, so a run
 * with no doors costs nothing to ask.
 */
export function runOpen(
  run: CutRun,
  last: { col: number; row: number },
  openDoors: ReadonlySet<string> | undefined,
): boolean[] {
  if (!openDoors || openDoors.size === 0) return [];
  const [dc, dr] = run.axis === 'x' ? [1, 0] : [0, 1];
  const out: boolean[] = [];
  for (let i = run.n - 1; i >= 0; i -= 1) out.push(openDoors.has(`${last.col - dc * i},${last.row - dr * i}`));
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
  g: ArtPen,
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

// ---------------------------------------------------------------------------
// The three passes, one cell at a time
// ---------------------------------------------------------------------------

/**
 * Pass 1: everything flat — floors, stains, drains, and the default floor
 * under a standing tile whose cell has no ground of its own.
 */
function drawFloorCell(
  g: ArtPen,
  m: SceneMetrics,
  cell: TileCell,
  plan: Pick<TilePlan, 'grounded' | 'occupied'> & Partial<Pick<TilePlan, 'water' | 'defs' | 'tilesetId'>>,
): void {
  const key = `${cell.col},${cell.row}`;
  if (cell.seg !== undefined) return;
  if (cell.split !== undefined && cell.layer === 0) {
    drawSplitGround(g, m, cell, cell.split, plan.defs, plan.tilesetId);
    return;
  }
  if (isStanding(cell.def) || cell.def.footprint === 'wall' || cell.span !== undefined) {
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
    drawPropTile(g, cell.def, m, cell.col, cell.row, plan.water?.water.has(key) ? waterSink(m) : 0);
    if (cell.layer === 0 || !plan.grounded.has(key)) drawFloorEdge(g, m, cell, plan.occupied);
    return;
  }
  if (cell.layer === 0 && cell.def.liquid !== undefined && plan.water !== undefined) {
    // Water is one body, drawn knowing its neighbours (reed beds included).
    drawWaterCell(g, m, cell.col, cell.row, plan.water);
    drawFloorEdge(g, m, cell, plan.occupied);
    return;
  }
  drawFillTile(g, cell.def, m, cell.col, cell.row);
  // Ground beside water shows how it meets it: wet sand, a coping, a beam.
  if (cell.layer === 0 && plan.water !== undefined) drawShoreTop(g, m, cell.col, cell.row, plan.water);
  // The edge is drawn by whichever flat thing sits lowest in the square: the
  // ground when there is one, otherwise the flat prop standing in for it.
  if (cell.layer === 0 || !plan.grounded.has(key)) drawFloorEdge(g, m, cell, plan.occupied);
}

/** Pass 2a: the ambient ring a full-height thing takes out of the floor around it. */
function drawAmbientFor(
  g: ArtPen,
  m: SceneMetrics,
  cell: TileCell,
  plan: Pick<TilePlan, 'walls'>,
  alpha = AMBIENT_ALPHA,
): void {
  if ((cell.def.height ?? 0) < 1) return;
  if (cell.seg !== undefined) {
    // A curved or angled wall darkens the floor along both its sides, as a
    // straight one does: its band, widened by the reach, ends rounded.
    if (cell.def.blocksSight === false) return;
    const { a, b } = cell.seg;
    const r = WALL_THICKNESS / 2 + AMBIENT_REACH;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 16; i += 1) {
      const t = (i / 16) * Math.PI * 2;
      const ox = Math.cos(t) * r;
      const oy = Math.sin(t) * r;
      pts.push({ x: a.x + ox, y: a.y + oy }, { x: b.x + ox, y: b.y + oy });
    }
    poly(g, hull(pts).map((q) => worldFromGrid(m, q))).fill({ color: C.ground, alpha });
    return;
  }
  const shape = cell.def.footprint;
  if (cell.def.prop !== undefined) {
    // A designed thing takes light from the floor around its own footprint,
    // and only when it is solid enough to: a lamp post and a tree are full
    // height but a sightline passes them, and so does the light.
    if (cell.def.blocksSight !== false) drawAmbientRing(g, m, objectRect(cell.def, cell.col, cell.row, m), alpha);
  } else if (shape === 'wall') {
    for (const r of wallRects(cell.col, cell.row, joinsOf(plan.walls, cell.col, cell.row))) {
      drawAmbientRing(g, m, r, alpha);
    }
  } else if (shape === undefined || shape === 'fill') {
    drawAmbientRing(g, m, [cell.col, cell.row, cell.col + 1, cell.row + 1], alpha);
  }
}

/** Pass 2b: the contact shadow a standing thing casts on the floor. */
function drawShadowFor(
  g: ArtPen,
  m: SceneMetrics,
  cell: TileCell,
  plan: Pick<TilePlan, 'walls'> & Partial<Pick<TilePlan, 'water'>>,
  alpha = SHADOW_ALPHA,
): void {
  const h = cell.def.height ?? (cell.def.footprint === 'stair' ? 0.5 : 0);
  const shape = cell.def.footprint;
  if (cell.seg !== undefined) {
    // A piece of an arc casts from its own slab, at its own angle; the
    // overlap into the next piece keeps a curve's shadow unbroken.
    if (h > 0) drawGroundShadowPoly(g, m, band(cell.seg.a, cell.seg.b, 0.02), h, alpha);
    return;
  }
  if (cell.def.prop !== undefined) {
    // A flat designed prop lies on the floor and casts nothing; a standing
    // one casts from the footprint its design declares — on the water, where
    // it floats, when it floats.
    const sink = plan.water?.water.has(`${cell.col},${cell.row}`) ? waterSink(m) : 0;
    const [x0, y0, x1, y1] = objectRect(cell.def, cell.col, cell.row, m);
    const up = propPlacement(cell.def.prop, m.unitM).up;
    if (h > 0) drawGroundShadow(g, m, [x0 + sink, y0 + sink, x1 + sink, y1 + sink], h * up, alpha);
  } else if (shape === 'wall') {
    for (const r of wallRects(cell.col, cell.row, joinsOf(plan.walls, cell.col, cell.row))) {
      drawGroundShadow(g, m, r, h, alpha);
    }
  } else if (shape === 'post' || shape === 'canopy' || shape === 'round') {
    drawGroundShadow(g, m, objectRect(cell.def, cell.col, cell.row, m), h, alpha);
  } else if (shape === 'stair') {
    drawGroundShadow(g, m, [cell.col + 0.12, cell.row, cell.col + 0.88, cell.row + 1], h, alpha);
  } else {
    drawGroundShadow(g, m, [cell.col, cell.row, cell.col + 1, cell.row + 1], h, alpha);
  }
}

/**
 * Pass 3: one standing tile. Any light it gives off is collected into the
 * open light pass (`PENDING_LIGHTS`) rather than drawn here — see `drawGlow`.
 */
export function drawStandingCell(
  g: ArtPen,
  m: SceneMetrics,
  cell: TileCell,
  plan: Pick<TilePlan, 'walls' | 'structure'> & Partial<Pick<TilePlan, 'openDoors' | 'water'>>,
): void {
  const shape = cell.def.footprint;
  if (cell.seg !== undefined) {
    drawArcPiece(g, cell.def, m, cell.seg, cell.opening);
    return;
  }
  if (cell.def.prop !== undefined) {
    // A design beats a footprint: the footprint still says where the shadow
    // falls, but the thing itself is built by its design.
    const sink = plan.water?.water.has(`${cell.col},${cell.row}`) ? waterSink(m) : 0;
    drawPropTile(g, cell.def, m, cell.col, cell.row, sink);
  } else if (shape === 'stair') {
    drawStairTile(g, cell.def, m, cell.col, cell.row);
  } else if (shape === 'post' || shape === 'canopy' || shape === 'round') {
    drawObjectTile(g, cell.def, m, cell.col, cell.row);
  } else if (shape === 'wall') {
    // Joins are read from the finished set, not from draw order, so a run
    // looks the same whichever end the GM painted from.
    const run = cutRunFor(plan as TilePlan, cell);
    drawWallTile(
      g,
      cell.def,
      m,
      cell.col,
      cell.row,
      joinsOf(plan.walls, cell.col, cell.row),
      run,
      run === null ? [] : runOpen(run, cell, plan.openDoors),
    );
  } else {
    drawFillTile(g, cell.def, m, cell.col, cell.row);
  }
}

/** A light waiting for the unlit pass. */
interface PendingLight {
  face: Point[];
  glow: number;
}

/**
 * Open a light pass. Every `drawGlow` until `closeLights` is called is
 * collected rather than drawn, so `drawTiles` can paint the lights over
 * everything else it draws.
 */
function openLights(): void {
  PENDING_LIGHTS = [];
}

function closeLights(): PendingLight[] {
  const lights = PENDING_LIGHTS ?? [];
  PENDING_LIGHTS = null;
  return lights;
}

/** The unlit pass: every collected light, over everything. */
function drawLights(g: ArtPen, m: SceneMetrics, lights: readonly PendingLight[]): void {
  for (const light of lights) paintGlow(g, m, light.face, light.glow);
}

/**
 * Draw the whole painted layer with ONE pen. Cells outside the grid are
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
 * The map itself is 3D now and does not come here; what draws this way is
 * the Build palette's sheet of tile pictures (`gm/swatches.ts`), all of it
 * at once.
 */
export function drawTiles(g: ArtPen, m: SceneMetrics, input: TileDrawInput): void {
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
