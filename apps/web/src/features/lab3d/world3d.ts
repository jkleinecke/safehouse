/**
 * The 3D lab's world: every painted floor of a scene, built as real geometry.
 *
 * It reads the scene exactly the way the 2D map does — `planTiles` decides
 * what a cell is, which way a wall turns, where an opening's run ends and
 * how the ground splits under an angled wall — and only the DRAWING differs.
 * So a wall that turns a corner on the map turns the same corner here, a
 * double door is one double door, and a curved glass wall is the same curve.
 *
 * World units are the lab's one convention (see `geometry3d.ts`): x east and
 * z south in squares, y up in squares, a storey `storeyUnits(unitM)` tall,
 * and floor L standing at `L * storey`. Every vertex is built in absolute
 * world coordinates, so a floor's group sits at the origin and hiding a floor
 * is hiding its group.
 *
 * Each floor is cut into chunks of `CHUNK` squares a side, one `MeshBuilder`
 * each, so a floor is a few dozen meshes the renderer can cull, not one
 * mesh per sofa and not one mesh per floor. A painted door's leaf is the
 * exception (`BuiltDoor`): each is built apart, then every leaf of a floor
 * goes into one mesh per material whose index draws only the shut ones, so a
 * door opens and shuts by being left out of the draw (`setDoorOpen`) rather
 * than by building its floor again — and a floor's doors cost a draw call
 * or two, not one per leaf, in every frame and every shadow pass.
 *
 * This is lab code: honest, not finished. What it approximates is said where
 * it does it.
 */
import { BufferAttribute, DynamicDrawUsage, Group, type Mesh, type Raycaster } from 'three';
import type { Scene, TileLayer } from '@safehouse/contracts';
import { levelTiles, sceneLevels, WALL_THICKNESS, type TileCut } from '@safehouse/rules';
import { metricsFor } from '../grid/geometry.js';
import { parseColor, shade } from '../grid/stage/colors.js';
import type { CutRun } from '../grid/stage/cuts.js';
import {
  cutOf,
  cutRunFor,
  isStanding,
  planTiles,
  tileDrawInput,
  wallBoxes,
  wallDiagonals,
  type GroundSplit,
  type TileCell,
  type TilePlan,
  type WallJoins,
} from '../grid/stage/tileLayer.js';
import { tileDefKey, type TileDrawDef } from '../grid/types.js';
import {
  disposeBuilt,
  MeshBuilder,
  storeyUnits,
  type BuilderSpans,
  type BuiltMeshes,
  type LabMaterials,
  type V3,
} from './geometry3d.js';
import { buildProp } from './propKit3d.js';

/** How the world is built: storey height, whether walls are cut away, which floors. */
export interface WorldOptions {
  /** Metres per storey (`STOREY_M` is the house figure). */
  storeyM: number;
  /**
   * `full` builds walls to their painted height; `cut` stops every wall at a
   * third of a storey, the architect's cutaway, so a room can be seen into
   * from any angle without hiding the ones beside it.
   */
  walls: 'full' | 'cut';
  /** Floor indices to build (0 is the ground floor). Floors the scene lacks are skipped. */
  levels: readonly number[];
}

/**
 * The part of a painted door that is there only while the door is shut: its
 * leaf. Every leaf of a floor is drawn by the floor's leaf meshes
 * (`BuiltLevel.doorMeshes`), which draw the shut ones only, so opening or
 * shutting a door is leaving its leaf out of that draw or putting it back,
 * not building the floor again.
 *
 * Which parts those are, by where the door stands:
 *   - in a straight run, the leaf panel. A plain door has one leaf per cell
 *     (two cells are a double door, each leaf opening on its own); every other
 *     door design (a roller, a hatch, a glass door) has one leaf across its
 *     whole run, which stands open while any cell of the run does — as the
 *     2D map draws them. The jambs and lintel are wall, and stay;
 *   - across a 45° run, the whole cell: an open diagonal door is a gap;
 *   - where an arc runs through a painted door or window, the whole opening
 *     in that square: open, it is the way through.
 */
export interface BuiltDoor {
  level: number;
  /** The `"col,row"` cells whose door state this leaf follows. */
  cells: readonly string[];
  /** The cells of `cells` standing open now. The leaf is drawn while this is empty. */
  readonly open: ReadonlySet<string>;
}

/** One built floor: where it stands and the meshes it is made of. */
export interface BuiltLevel {
  level: number;
  /** World y of the floor's top surface. */
  y: number;
  /**
   * One entry per non-empty chunk, then the door leaves' (`doorMeshes`) when
   * the floor has any. Every mesh the floor has is in here, which is what
   * the lighting bakes and what hiding a floor hides.
   */
  built: BuiltMeshes[];
  /** The floor's door leaves (`BuiltDoor`). */
  doors: BuiltDoor[];
  /**
   * Every door leaf of the floor, one mesh per material. Their vertices are
   * every leaf's, open or shut (so the lighting's bake of them holds); their
   * index draws the shut leaves only, and is rewritten as doors open and
   * shut (`BuiltWorld.setDoorOpen`) — which the shadows and the raycaster
   * honour too. Also in `built`. Null for a floor without a door.
   */
  doorMeshes: BuiltMeshes | null;
}

/** The whole built world, ready to add to a three.js scene. */
export interface BuiltWorld {
  /** Holds one child group per floor, named `level-${L}`, holding that floor's chunk meshes. */
  group: Group;
  /** Squares per storey, as built. */
  storey: number;
  levels: BuiltLevel[];
  stats: { triangles: number; buildMs: number };
  /**
   * Open or shut the painted door in cell `cell` (`"col,row"`) on floor
   * `level`, as `tiles.doors[cell].open` now says, by leaving its leaves
   * (`BuiltDoor`) out of the floor's leaf meshes or putting them back.
   * Nothing is built. True when the world now matches:
   * also when nothing it built depends on that cell's door (a window, a
   * gap, a cell with no door), since there is then nothing to change. False
   * only for a floor this world was not built with, which only a rebuild can
   * answer.
   *
   * The world's shape changes but its lighting does not know: the owner
   * refreshes the light sources (an open door lets light through) and the
   * shadow maps (the leaf cast one) after flipping doors.
   */
  setDoorOpen(level: number, cell: string, open: boolean): boolean;
  /**
   * The painted door whose shut leaf `raycaster` meets first on floor
   * `level`, as the cell of it the ray meets (`"col,row"`): the pointer's
   * way to a door drawn standing over the squares behind its own. Only the
   * leaves are tested, not what may stand in front of them. Null for none,
   * or when that floor's leaves are not on show.
   */
  pickDoor(level: number, raycaster: Raycaster): string | null;
  /** Free every geometry and detach the groups. Materials are the lab's and stay. */
  dispose(): void;
}

type Kind = 'solid' | 'glass' | 'glow';

/** Squares per chunk side: 16x16 is ~12 chunks a floor on the test scene. */
const CHUNK = 16;
/** A ground-floor slab: a surface to stand on, not a thing with depth. */
const GROUND_SLAB = 0.02;
/**
 * An upper floor's slab: thick enough that a storey reads as a floor plate
 * from the side, in the floor's own colour (`floorTint`).
 */
export const UPPER_SLAB = 0.25;

/**
 * Each upper floor's own colour, on the edges of its slab and on its outline,
 * and on its button in the lab's panel — so "which floor is that?" has an
 * answer at a glance (2026-09-26: stacked floors in one colour read as one
 * jumble). Muted, so a slab edge is a label and not a light.
 */
const FLOOR_TINTS: readonly number[] = [0x5b6470, 0x2f8fa3, 0xa3447f, 0xb08a3a, 0x4f9a5a, 0x7a5ab0, 0xa35a3a];

/** Floor `level`'s identity colour as a number (ground is the neutral first entry). */
export function floorTint(level: number): number {
  return FLOOR_TINTS[((level % FLOOR_TINTS.length) + FLOOR_TINTS.length) % FLOOR_TINTS.length]!;
}

/** The same, as `#rrggbb`, for the page. */
export function floorTintCss(level: number): string {
  return `#${floorTint(level).toString(16).padStart(6, '0')}`;
}
/**
 * How far a full-height wall stops short of the storey: the slab above plus a
 * hair. Under a slab the gap is hidden; under an open atrium it keeps the
 * wall below the shade the lab lays over the floors beneath the one in view
 * (labView's `applyFloorVisibility`), which sits in that hair — so a lower
 * floor's walls are shaded to their tops, and the floor above's coloured
 * slab edge is never shaded at all.
 */
const TOP_TRIM = UPPER_SLAB + 0.04;
/** Where `walls: 'cut'` stops a wall, in storeys. */
const CUT_HEIGHT = 0.33;
/** How far a flat object (a rug, a stain) floats above the floor per layer. */
const DECAL_LIFT = 0.01;
/**
 * How far water sits below the land, in squares. A floating prop (a boat)
 * sinks by the same drop so it rides on the surface; the kit takes its
 * `sink` in storeys, as the 2D kit does, so it is handed `WATER_DROP / storey`.
 */
const WATER_DROP = 0.2;
/** The bed under the water, in squares below the land. */
const WATER_BED = 0.7;
/** Glazing: the 2D map's glass tint, so both read as the same glass. */
const GLASS = 0x9fd4e6;
/** The 2D map's per-square grain, same hash, same amplitude: the same floor. */
const GRAIN = 0.045;
const FALLBACK_BASE = 0x3b3f45;
const FALLBACK_ACCENT = 0x5a6068;
/** A sign box's face, behind its tube. */
const SIGN_BOX = 0x141a22;

const WALL_LO = (1 - WALL_THICKNESS) / 2;
const WALL_HI = WALL_LO + WALL_THICKNESS;

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/** FNV-1a, as the 2D map hashes a square, so the grain lands on the same squares. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function grained(base: number, col: number, row: number): number {
  const t = ((hash32(`${col},${row}`) % 1000) / 1000) * 2 - 1;
  return shade(base, 1 + t * GRAIN);
}

function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The tones a tile draws with, derived from its own pair as the 2D map derives them. */
interface Tones {
  base: number;
  accent: number;
  light: number;
  dark: number;
  ink: number;
}

function tonesOf(def: TileDrawDef): Tones {
  const base = parseColor(def.colors[0], FALLBACK_BASE);
  const accent = parseColor(def.colors[1], FALLBACK_ACCENT);
  return { base, accent, light: shade(accent, 1.12), dark: shade(base, 0.84), ink: shade(base, 0.62) };
}

function glowOf(def: TileDrawDef, tones: Tones): number | null {
  return def.emissive === undefined ? null : parseColor(def.emissive, tones.light);
}

// ---------------------------------------------------------------------------
// Walls: joins, heights and a frame to build along
// ---------------------------------------------------------------------------

/** The 8-neighbour joins of a wall cell — the same rule as the 2D map's own `joinsOf`. */
function joinsOf(walls: ReadonlySet<string>, col: number, row: number): WallJoins {
  return {
    n: walls.has(`${col},${row - 1}`),
    s: walls.has(`${col},${row + 1}`),
    w: walls.has(`${col - 1},${row}`),
    e: walls.has(`${col + 1},${row}`),
    nw: walls.has(`${col - 1},${row - 1}`),
    ne: walls.has(`${col + 1},${row - 1}`),
    sw: walls.has(`${col - 1},${row + 1}`),
    se: walls.has(`${col + 1},${row + 1}`),
  };
}

/** Joined only at its corners: a 45° run passes through, with no square post. */
function diagonalOnly(j: WallJoins): boolean {
  return !j.n && !j.e && !j.s && !j.w && Boolean(j.ne || j.nw || j.se || j.sw);
}

/** The octagonal post where a diagonal cell's bands meet, cell-local. */
function diagonalPost(): Array<{ x: number; y: number }> {
  const r = WALL_THICKNESS / 2 / Math.cos(Math.PI / 8);
  return Array.from({ length: 8 }, (_, i) => {
    const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
    return { x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r };
  });
}

/** Which way an opening's run goes from this cell — `cutRunFor`'s own rule. */
function runAxis(j: WallJoins): 'x' | 'y' {
  return (j.w || j.e) && !(j.n || j.s) ? 'x' : j.n || j.s ? 'y' : 'x';
}

/** Is this slab of a wall cell part of the run's band (the centre post or a stub along it)? */
function inBand(r: readonly [number, number, number, number], axis: 'x' | 'y'): boolean {
  const eps = 1e-6;
  return axis === 'x'
    ? r[1] >= WALL_LO - eps && r[3] <= WALL_HI + eps
    : r[0] >= WALL_LO - eps && r[2] <= WALL_HI + eps;
}

interface WallHeights {
  /** The wall's painted height, world units: what design fractions are measured against. */
  full: number;
  /** How high it is actually built (cut away, or trimmed into the slab above). */
  built: number;
  /** Cut away: its top is a section, drawn dark. */
  cutAway: boolean;
}

function wallHeights(def: TileDrawDef, storey: number, walls: WorldOptions['walls']): WallHeights {
  const h = def.height ?? 0;
  const full = Math.max(h * storey, 0.02);
  if (walls === 'cut') {
    return { full, built: Math.max(Math.min(h, CUT_HEIGHT) * storey, 0.02), cutAway: h > CUT_HEIGHT };
  }
  return { full, built: h >= 1 ? full - TOP_TRIM : full, cutAway: false };
}

/**
 * A straight line to build along: `s` runs 0→`len` from `(ax, az)` along
 * `(ux, uz)`, `t` runs across it. For an x-run +t is south; for a y-run +t
 * is WEST (the frame is right-handed), which is why a face-mounted design
 * takes a `side`.
 */
interface Frame {
  ax: number;
  az: number;
  ux: number;
  uz: number;
  len: number;
  /** Half the wall's thickness. */
  half: number;
}

function runFrame(run: CutRun): Frame {
  const [x0, y0, x1, y1] = run.rect;
  return run.axis === 'x'
    ? { ax: x0, az: (y0 + y1) / 2, ux: 1, uz: 0, len: x1 - x0, half: (y1 - y0) / 2 }
    : { ax: (x0 + x1) / 2, az: y0, ux: 0, uz: 1, len: y1 - y0, half: (x1 - x0) / 2 };
}

/** A frame along an arc piece's centre line, reaching `over` past each end so a curve closes up. */
function segFrame(a: { x: number; y: number }, b: { x: number; y: number }, over: number): Frame {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uz = (b.y - a.y) / len;
  return { ax: a.x - ux * over, az: a.y - uz * over, ux, uz, len: len + over * 2, half: WALL_THICKNESS / 2 };
}

interface BlockOpts {
  kind?: Kind;
  /** Close its underside too — a lintel seen from below, a floating shelf. */
  bottom?: boolean;
  top?: number;
}

/** A prism along a frame: `s0..s1` along, `t0..t1` across, `y0..y1` up. */
function block(
  b: MeshBuilder,
  f: Frame,
  s0: number,
  s1: number,
  t0: number,
  t1: number,
  y0: number,
  y1: number,
  color: number,
  o: BlockOpts = {},
): void {
  if (s1 - s0 < 1e-4 || t1 - t0 < 1e-4 || y1 - y0 < 1e-4) return;
  const P = (s: number, t: number): [number, number] => [f.ax + f.ux * s - f.uz * t, f.az + f.uz * s + f.ux * t];
  const floor = [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)];
  b.extrude(floor, y0, y1, color, { ...(o.top !== undefined ? { top: o.top } : {}), ...(o.kind ? { kind: o.kind } : {}) });
  if (o.bottom) b.polygon(floor.map(([x, z]): V3 => [x, y0, z]), color, o.kind ?? 'solid');
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

/**
 * What an opening is built as, per design. Fractions are of the wall's own
 * painted height (a full wall is one storey), as the 2D elevation's `v` is.
 *
 * A record over `TileCut`, like the 2D map's switch, so a design added to the
 * catalogue without a build here is a compile error rather than a plain wall.
 */
type Design =
  | { type: 'door'; top: number; pad: number; leaf: 'solid' | 'glass' | 'none' }
  | {
      type: 'window';
      pad: number;
      sill: number;
      head: number;
      fill: 'glass' | 'mesh' | 'louvre' | 'shelf' | 'open';
      mullions: boolean;
    }
  | { type: 'sign' }
  | { type: 'rail'; pales: boolean };

const DESIGNS: Readonly<Record<TileCut, Design>> = {
  door: { type: 'door', top: 0.72, pad: 0.14, leaf: 'solid' },
  maglock: { type: 'door', top: 0.72, pad: 0.1, leaf: 'solid' },
  porthole: { type: 'door', top: 0.72, pad: 0.14, leaf: 'solid' },
  glassdoor: { type: 'door', top: 0.72, pad: 0.08, leaf: 'glass' },
  hatch: { type: 'door', top: 0.72, pad: 0.18, leaf: 'solid' },
  roller: { type: 'door', top: 0.8, pad: 0.05, leaf: 'solid' },
  shutter: { type: 'door', top: 0.86, pad: 0.02, leaf: 'solid' },
  gap: { type: 'door', top: 0.75, pad: 0.2, leaf: 'none' },
  glass: { type: 'window', pad: 0.03, sill: 0.02, head: 0.96, fill: 'glass', mullions: true },
  wireglass: { type: 'window', pad: 0.1, sill: 0.3, head: 0.86, fill: 'glass', mullions: true },
  shopwindow: { type: 'window', pad: 0.04, sill: 0.25, head: 0.9, fill: 'glass', mullions: true },
  serving: { type: 'window', pad: 0.08, sill: 0.36, head: 0.78, fill: 'shelf', mullions: false },
  louvre: { type: 'window', pad: 0.14, sill: 0.36, head: 0.82, fill: 'louvre', mullions: false },
  blown: { type: 'window', pad: 0.14, sill: 0.3, head: 0.82, fill: 'open', mullions: false },
  mesh: { type: 'window', pad: 0.02, sill: 0, head: 0.96, fill: 'mesh', mullions: true },
  sign: { type: 'sign' },
  railing: { type: 'rail', pales: false },
  picket: { type: 'rail', pales: true },
};

/** Designs that are a pane you see through, for a diagonal cell drawn as plain wall. */
const GLASSY: ReadonlySet<TileCut> = new Set<TileCut>(['glass', 'wireglass', 'shopwindow', 'glassdoor', 'mesh']);
/** Designs that can stand open (the 2D map's `DOOR_CUTS`). */
const DOOR_CUTS: ReadonlySet<TileCut> = new Set<TileCut>(['door', 'maglock', 'porthole', 'glassdoor', 'roller', 'shutter', 'hatch']);

interface OpeningCtx {
  /** The floor's y. */
  y: number;
  heights: WallHeights;
  tones: Tones;
  glow: number;
  /** Cells along the run (1 for an arc piece). */
  n: number;
  /** The run's cells as `"col,row"`, first to last (the one square, for an arc piece). */
  cells: readonly string[];
  /**
   * The builder for a door leaf that follows these cells' door state
   * (`LevelCtx.doorLeaf`). Every leaf is built, open or shut; whether it
   * shows is the world's to say, per door, after the build.
   */
  leaf(cells: readonly string[]): MeshBuilder;
  /** A straight run has jambs at its ends and mullions between cells; an arc piece has neither. */
  ends: boolean;
  /** Which side of the frame (+t or -t) faces south or east — the face a sign hangs on. */
  side: 1 | -1;
  top: number;
}

/** One opening, built once across its whole run (or along one arc piece). */
function buildOpening(b: MeshBuilder, f: Frame, cut: TileCut, c: OpeningCtx): void {
  const d = DESIGNS[cut];
  const y = (frac: number) => c.y + Math.min(frac * c.heights.full, c.heights.built);
  const h = f.half;
  const len = f.len;
  const cl = len / Math.max(1, c.n);
  const wall = (s0: number, s1: number, f0: number, f1: number, bottom = false) =>
    block(b, f, s0, s1, -h, h, y(f0), y(f1), c.tones.base, { bottom, top: c.top });

  switch (d.type) {
    case 'door': {
      const pad = c.ends ? d.pad * cl : 0;
      if (pad > 0) {
        wall(0, pad, 0, 1);
        wall(len - pad, len, 0, 1);
      }
      if (y(d.top) < y(1) - 1e-4) wall(pad, len - pad, d.top, 1, true);
      if (d.leaf === 'none') return;
      const color = d.leaf === 'glass' ? GLASS : c.tones.dark;
      const kind: Kind = d.leaf === 'glass' ? 'glass' : 'solid';
      const thin = h * 0.3;
      if (cut === 'door') {
        // One leaf per cell: two cells are a double door, and each leaf opens on its own.
        for (let i = 0; i < c.n; i += 1) {
          const s0 = i === 0 ? pad : i * cl + 0.01;
          const s1 = i === c.n - 1 ? len - pad : (i + 1) * cl - 0.01;
          block(c.leaf(c.cells.slice(i, i + 1)), f, s0, s1, -thin, thin, c.y, y(d.top), color, { kind });
        }
      } else {
        // One leaf across the run, open while any cell of it is.
        block(c.leaf(c.cells), f, pad, len - pad, -thin, thin, c.y, y(d.top), color, { kind });
      }
      return;
    }
    case 'window': {
      const pad = c.ends ? d.pad * cl : 0;
      if (pad > 0) {
        wall(0, pad, 0, 1);
        wall(len - pad, len, 0, 1);
      }
      if (d.sill > 0) wall(pad, len - pad, 0, d.sill);
      if (y(d.head) < y(1) - 1e-4) wall(pad, len - pad, d.head, 1, true);
      const y0 = y(d.sill);
      const y1 = y(d.head);
      switch (d.fill) {
        case 'glass':
          block(b, f, pad, len - pad, -h * 0.25, h * 0.25, y0, y1, GLASS, { kind: 'glass' });
          break;
        case 'mesh':
          block(b, f, pad, len - pad, -h * 0.1, h * 0.1, y0, y1, c.tones.ink, { kind: 'glass' });
          break;
        case 'louvre': {
          const step = (y1 - y0) / 4;
          for (let k = 0; k < 4; k += 1) {
            block(b, f, pad, len - pad, -h * 0.6, h * 0.6, y0 + step * (k + 0.3), y0 + step * (k + 0.7), c.tones.ink, { bottom: true });
          }
          break;
        }
        case 'shelf':
          block(b, f, pad, len - pad, -h * 1.8, h * 1.8, y0, y0 + 0.04, c.tones.light, { bottom: true });
          break;
        case 'open':
          break;
      }
      if (d.mullions && c.ends) {
        for (let i = 1; i < c.n; i += 1) block(b, f, i * cl - 0.03, i * cl + 0.03, -h * 0.5, h * 0.5, y0, y1, c.tones.dark);
      }
      return;
    }
    case 'sign': {
      wall(0, len, 0, 1);
      // A dark box proud of the south/east face, and the tube across it.
      const face = c.side * h;
      const box: [number, number] = c.side > 0 ? [face, face + 0.04] : [face - 0.04, face];
      const tube: [number, number] = c.side > 0 ? [face + 0.04, face + 0.07] : [face - 0.07, face - 0.04];
      block(b, f, len * 0.08, len * 0.92, box[0], box[1], y(0.5), y(0.88), SIGN_BOX, { bottom: true });
      block(b, f, len * 0.15, len * 0.85, tube[0], tube[1], y(0.66), y(0.72), c.glow, { kind: 'glow', bottom: true });
      return;
    }
    case 'rail': {
      const top = y(1);
      const posts = [0.05, ...Array.from({ length: Math.max(0, c.n - 1) }, (_, i) => (i + 1) * cl), len - 0.05];
      for (const s of posts) block(b, f, s - 0.04, s + 0.04, -0.04, 0.04, c.y, top, c.tones.base);
      if (!d.pales) {
        block(b, f, 0, len, -0.03, 0.03, y(0.9), top, c.tones.base, { bottom: true });
        block(b, f, 0, len, -0.025, 0.025, y(0.47), y(0.53), c.tones.base, { bottom: true });
        return;
      }
      for (let s = 0.12; s < len - 0.08; s += 0.16) block(b, f, s - 0.035, s + 0.035, -0.02, 0.02, c.y, y(0.95), c.tones.base);
      block(b, f, 0, len, 0.02, 0.05, y(0.25), y(0.31), c.tones.dark, { bottom: true });
      block(b, f, 0, len, 0.02, 0.05, y(0.7), y(0.76), c.tones.dark, { bottom: true });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// One floor
// ---------------------------------------------------------------------------

interface LevelCtx {
  level: number;
  /** World y of the floor's top. */
  y: number;
  storey: number;
  unitM: number;
  opts: WorldOptions;
  plan: TilePlan;
  chunk(col: number, row: number): MeshBuilder;
  /**
   * The builder for one door leaf (`BuiltDoor`), keyed by the cells it
   * follows: asked twice for the same cells (the two half-square pieces of
   * an arc in one square), it is the same leaf.
   */
  doorLeaf(cells: readonly string[]): MeshBuilder;
  /**
   * The chunk for things that are themselves lights — a ceiling light, a
   * lamppost, a terminal. Built apart because they cast no shadow: a live
   * lamp sits inside its own fixture, and a pendant's shade under its bulb
   * shadowed the lamp's whole pool off the floor (2026-09-26: High, which
   * shadows the most lamps, had no pools at all). They still take light and
   * still hide what is behind them.
   */
  emitterChunk(col: number, row: number): MeshBuilder;
  propFailures: number;
}

interface FloorSquare {
  col: number;
  row: number;
  color: number;
  kind: Kind;
}

/** A square of floor: its top, its underside on an upper floor, and a side where it ends. */
function emitFloor(ctx: LevelCtx, f: FloorSquare, has: (col: number, row: number) => boolean): void {
  const b = ctx.chunk(f.col, f.row);
  const x0 = f.col;
  const x1 = f.col + 1;
  const z0 = f.row;
  const z1 = f.row + 1;
  const y = ctx.y;
  const yb = y - (ctx.level === 0 ? GROUND_SLAB : UPPER_SLAB);
  b.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], f.color, f.kind);
  if (ctx.level > 0) b.quad([x0, yb, z0], [x0, yb, z1], [x1, yb, z1], [x1, yb, z0], shade(f.color, 0.8));
  // An upper floor's slab edge is its colour, and its rim a bright line of
  // it: a mezzanine reads as that floor from across the atrium. The ground
  // floor's edges are the map's edge and keep the floor's own tone.
  const upper = ctx.level > 0;
  const edge = upper ? floorTint(ctx.level) : shade(f.color, 0.7);
  const rim = shade(floorTint(ctx.level), 1.6);
  if (!has(f.col, f.row - 1)) {
    b.quad([x1, yb, z0], [x0, yb, z0], [x0, y, z0], [x1, y, z0], edge);
    if (upper) b.line([[x0, y, z0], [x1, y, z0]], rim);
  }
  if (!has(f.col, f.row + 1)) {
    b.quad([x0, yb, z1], [x1, yb, z1], [x1, y, z1], [x0, y, z1], edge);
    if (upper) b.line([[x0, y, z1], [x1, y, z1]], rim);
  }
  if (!has(f.col - 1, f.row)) {
    b.quad([x0, yb, z0], [x0, yb, z1], [x0, y, z1], [x0, y, z0], edge);
    if (upper) b.line([[x0, y, z0], [x0, y, z1]], rim);
  }
  if (!has(f.col + 1, f.row)) {
    b.quad([x1, yb, z1], [x1, yb, z0], [x1, y, z0], [x1, y, z1], edge);
    if (upper) b.line([[x1, y, z0], [x1, y, z1]], rim);
  }
}

/**
 * A square split along an angled wall: each side's half clipped by the line
 * and drawn in the ground beside it on that side (as `drawSplitGround`
 * does). A side with nothing beside it stays open — unless the square has
 * ground of its own painted, in which case that half is its own ground: a
 * floored square is never half a hole.
 */
function emitSplit(ctx: LevelCtx, cell: TileCell, split: GroundSplit): void {
  const b = ctx.chunk(cell.col, cell.row);
  const len = Math.hypot(split.d.x, split.d.y) || 1;
  const own = ctx.plan.grounded.has(`${cell.col},${cell.row}`);
  const square: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (const side of split.sides) {
    if (side.id === null && !own) continue;
    const def = (side.id === null ? undefined : ctx.plan.defs[tileDefKey(ctx.plan.tilesetId, side.id)]) ?? cell.def;
    const nx = (-split.d.y / len) * side.sign;
    const ny = (split.d.x / len) * side.sign;
    const keep = (u: number, v: number) => (u - split.p.x) * nx + (v - split.p.y) * ny;
    const half: Array<[number, number]> = [];
    for (let i = 0; i < square.length; i += 1) {
      const a = square[i]!;
      const c = square[(i + 1) % square.length]!;
      const da = keep(a[0], a[1]);
      const dc = keep(c[0], c[1]);
      if (da >= 0) half.push(a);
      if (da >= 0 !== dc >= 0) {
        const t = da / (da - dc);
        half.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]);
      }
    }
    if (half.length < 3) continue;
    const color = grained(parseColor(def.colors[0], FALLBACK_BASE), cell.col, cell.row);
    b.polygon(half.map(([u, v]): V3 => [cell.col + u, ctx.y, cell.row + v]), color);
    if (ctx.level > 0) {
      const yb = ctx.y - UPPER_SLAB;
      b.polygon(half.map(([u, v]): V3 => [cell.col + u, yb, cell.row + v]), shade(color, 0.8));
    }
  }
}

/** A square of water: a see-through surface below the land, a dark bed, and banks where it meets land. */
function emitWater(ctx: LevelCtx, cell: TileCell, isWater: (col: number, row: number) => boolean): void {
  const b = ctx.chunk(cell.col, cell.row);
  const base = parseColor(cell.def.colors[0], FALLBACK_BASE);
  const x0 = cell.col;
  const x1 = cell.col + 1;
  const z0 = cell.row;
  const z1 = cell.row + 1;
  const ys = ctx.y - WATER_DROP;
  const yb = ctx.y - WATER_BED;
  b.quad([x0, ys, z0], [x1, ys, z0], [x1, ys, z1], [x0, ys, z1], base, 'glass');
  b.quad([x0, yb, z0], [x1, yb, z0], [x1, yb, z1], [x0, yb, z1], shade(base, 0.35));
  const bank = shade(base, 0.45);
  const y = ctx.y;
  if (!isWater(cell.col, cell.row - 1)) b.quad([x1, yb, z0], [x0, yb, z0], [x0, y, z0], [x1, y, z0], bank);
  if (!isWater(cell.col, cell.row + 1)) b.quad([x0, yb, z1], [x1, yb, z1], [x1, y, z1], [x0, y, z1], bank);
  if (!isWater(cell.col - 1, cell.row)) b.quad([x0, yb, z0], [x0, yb, z1], [x0, y, z1], [x0, y, z0], bank);
  if (!isWater(cell.col + 1, cell.row)) b.quad([x1, yb, z1], [x1, yb, z0], [x1, y, z0], [x1, y, z1], bank);
}

/** A wall cell: its slabs from its joins, and — from a run's last cell — the run's opening. */
function buildWallCell(ctx: LevelCtx, cell: TileCell): void {
  const { col, row, def } = cell;
  const b = ctx.chunk(col, row);
  const joins = joinsOf(ctx.plan.walls, col, row);
  const tones = tonesOf(def);
  const heights = wallHeights(def, ctx.storey, ctx.opts.walls);
  const y0 = ctx.y;
  const y1 = ctx.y + heights.built;
  const top = heights.cutAway ? shade(tones.base, 0.55) : tones.base;
  const cut = cutOf(def);
  // A see-through wall with no design — a velvet rope, a low screen — is
  // built as the glass it reads as, in its own colour.
  const kind: Kind = def.blocksSight === false && cut === null ? 'glass' : 'solid';
  const lift = (poly: ReadonlyArray<{ x: number; y: number }>) =>
    poly.map((p): [number, number] => [col + p.x, row + p.y]);

  if (diagonalOnly(joins)) {
    // A diagonal door or window: its design runs along the grid, so across a
    // 45° run it is the wall in the opening's colours (glass if glazed), and
    // an open door is a gap — as the 2D map draws it. So a door's whole cell
    // is its leaf.
    const into = cut !== null && DOOR_CUTS.has(cut) ? ctx.doorLeaf([`${col},${row}`]) : b;
    const glassy = cut !== null && GLASSY.has(cut);
    const k: Kind = glassy ? 'glass' : kind;
    const color = glassy ? GLASS : tones.base;
    into.extrude(lift(diagonalPost()), y0, y1, color, { top, kind: k });
    for (const d of wallDiagonals(joins)) into.extrude(lift(d), y0, y1, color, { top, kind: k });
    return;
  }

  for (const d of wallDiagonals(joins)) b.extrude(lift(d), y0, y1, tones.base, { top, kind });
  // An opening's cells leave their slabs ALONG the run to the opening, which
  // is built once across the whole run; stubs off the run stay wall.
  const axis = cut === null ? null : runAxis(joins);
  for (const r of wallBoxes(joins)) {
    if (axis !== null && inBand(r, axis)) continue;
    b.box(col + r[0], y0, row + r[1], col + r[2], y1, row + r[3], tones.base, { top, kind });
  }

  if (cut !== null) {
    const run = cutRunFor(ctx.plan, cell);
    if (run === null) return;
    // The run's cells, first to last: this cell is its last.
    const [dc, dr] = run.axis === 'x' ? [1, 0] : [0, 1];
    const cells = Array.from({ length: run.n }, (_, k) => `${col - dc * (run.n - 1 - k)},${row - dr * (run.n - 1 - k)}`);
    buildOpening(b, runFrame(run), cut, {
      y: ctx.y,
      heights,
      tones,
      glow: glowOf(def, tones) ?? tones.light,
      n: run.n,
      cells,
      leaf: ctx.doorLeaf,
      ends: true,
      side: run.axis === 'x' ? 1 : -1,
      top,
    });
    return;
  }
  const glow = glowOf(def, tones);
  if (glow !== null) {
    // A lit wall (neon trim, a light strip): a glowing strip along its crown.
    b.box(col + WALL_LO, y1, row + WALL_LO, col + WALL_HI, y1 + 0.03, row + WALL_HI, glow, { kind: 'glow' });
  }
}

/** A piece of a wall at any angle or a curved wall, half a square long. */
function buildArcPiece(ctx: LevelCtx, cell: TileCell, seg: NonNullable<TileCell['seg']>): void {
  const { def } = cell;
  const b = ctx.chunk(cell.col, cell.row);
  const tones = tonesOf(def);
  const heights = wallHeights(def, ctx.storey, ctx.opts.walls);
  const top = heights.cutAway ? shade(tones.base, 0.55) : tones.base;
  const f = segFrame(seg.a, seg.b, 0.04);
  const y0 = ctx.y;
  const y1 = ctx.y + heights.built;
  const h = f.half;

  if (cell.opening !== undefined) {
    // A door or window the arc runs through: open, it is the way through. So
    // the whole opening in this square is the leaf of the door painted here.
    const cut = cutOf(def);
    if (cut !== null) {
      const cells = [`${cell.col},${cell.row}`];
      const leaf = ctx.doorLeaf(cells);
      buildOpening(leaf, f, cut, {
        y: ctx.y,
        heights,
        tones,
        glow: glowOf(def, tones) ?? tones.light,
        n: 1,
        cells,
        leaf: () => leaf,
        ends: false,
        side: 1,
        top,
      });
      return;
    }
  }

  if (cutOf(def) === 'glass' || def.blocksSight === false) {
    // Glazing on a curve: a kerb, a pane a third as thick as the wall, a cap rail.
    const kerb = Math.min(0.03, heights.built);
    const cap = heights.built > 0.2 ? 0.04 : 0;
    block(b, f, 0, f.len, -h, h, y0, y0 + kerb, tones.base, { top });
    block(b, f, 0, f.len, -h * 0.35, h * 0.35, y0 + kerb, y1 - cap, GLASS, { kind: 'glass' });
    if (cap > 0) block(b, f, 0, f.len, -h * 0.6, h * 0.6, y1 - cap, y1, tones.base, { top, bottom: true });
  } else {
    block(b, f, 0, f.len, -h, h, y0, y1, tones.base, { top });
  }
  const glow = glowOf(def, tones);
  if (glow !== null && cell.opening === undefined) block(b, f, 0, f.len, -h * 0.4, h * 0.4, y1, y1 + 0.03, glow, { kind: 'glow' });
}

/** A flight of stairs: four treads climbing across the square (reversed for a down-flight), as the 2D map draws them. */
function buildStair(ctx: LevelCtx, cell: TileCell): void {
  const { col, row, def } = cell;
  const b = ctx.chunk(col, row);
  const base = parseColor(def.colors[0], FALLBACK_BASE);
  const rise = (def.height ?? 0.5) * ctx.storey;
  const down = def.connects === 'down';
  const TREADS = 4;
  for (let i = 0; i < TREADS; i += 1) {
    const step = ((down ? TREADS - 1 - i : i) + 1) / TREADS;
    b.box(col + 0.12, ctx.y, row + i / TREADS, col + 0.88, ctx.y + rise * step, row + (i + 1) / TREADS, shade(base, 0.9 + i * 0.06));
  }
}

/** A legacy object with no design: a post, a squat round, or a tree (trunk and crown). */
function buildObject(ctx: LevelCtx, cell: TileCell): void {
  const { col, row, def } = cell;
  const b = ctx.chunk(col, row);
  const tones = tonesOf(def);
  const base = tones.base;
  const glow = glowOf(def, tones);
  const h = (def.height ?? 0) * ctx.storey;
  const y = ctx.y;
  const cx = col + 0.5;
  const cz = row + 0.5;
  if (def.footprint === 'canopy') {
    b.cylinder(cx, cz, 0.12, y, y + h * 0.55, shade(base, 0.6), { sides: 6 });
    b.cylinder(cx, cz, 0.42, y + h * 0.4, y + h, base, { sides: 8 });
    b.cylinder(cx - 0.1, cz - 0.1, 0.22, y + h, y + h * 1.08, shade(base, 1.14), { sides: 7 });
    if (glow !== null) b.cylinder(cx, cz, 0.18, y + h * 1.08, y + h * 1.1, glow, { sides: 7, kind: 'glow' });
    return;
  }
  if (def.footprint === 'round') {
    b.cylinder(cx, cz, 0.34, y, y + h, base, { sides: 12, top: shade(base, 1.08) });
    if (glow !== null) b.cylinder(cx, cz, 0.24, y + h, y + h + 0.01, glow, { sides: 12, kind: 'glow' });
    return;
  }
  // A post: a narrow column with a cap wider than itself (a lit cap if it gives off light).
  b.cylinder(cx, cz, 0.15, y, y + h, base, { sides: 8 });
  b.cylinder(cx, cz, 0.24, y + h, y + h + 0.05, glow ?? shade(base, 1.15), { sides: 8, kind: glow !== null ? 'glow' : 'solid' });
}

/** A standing block filling its square — a crate stack, a counter — with a lit panel on top if it glows. */
function buildBlock(ctx: LevelCtx, cell: TileCell): void {
  const { col, row, def } = cell;
  const b = ctx.chunk(col, row);
  const tones = tonesOf(def);
  const hh = def.height ?? 0;
  const h = hh * ctx.storey - (hh >= 1 ? TOP_TRIM : 0);
  b.box(col, ctx.y, row, col + 1, ctx.y + h, row + 1, tones.base);
  const glow = glowOf(def, tones);
  if (glow !== null) b.box(col + 0.1, ctx.y + h, row + 0.1, col + 0.9, ctx.y + h + 0.01, row + 0.9, glow, { kind: 'glow' });
}

/** Everything standing on one square: a prop, a wall, stairs, an object or a block. */
function buildStanding(ctx: LevelCtx, cell: TileCell): void {
  const { def } = cell;
  // A glowing thing standing in the room is a light's fixture (a sign in a
  // wall is a wall, and keeps its shadow).
  const emits = def.emissive !== undefined && def.emissive !== '' && def.footprint !== 'wall';
  const at: LevelCtx = emits ? { ...ctx, chunk: ctx.emitterChunk } : ctx;
  if (def.prop !== undefined) {
    // The kit's sink is in storeys; the water's drop is in squares.
    const sink = ctx.plan.water.water.has(`${cell.col},${cell.row}`) && ctx.storey > 0 ? WATER_DROP / ctx.storey : 0;
    try {
      buildProp(at.chunk(cell.col, cell.row), def, cell.col, cell.row, { unitM: ctx.unitM, storey: ctx.storey, baseY: ctx.y }, sink > 0 ? { sink } : undefined);
    } catch {
      // One broken design must not cost the whole floor.
      ctx.propFailures += 1;
    }
    return;
  }
  if (def.footprint === 'wall') buildWallCell(ctx, cell);
  else if (def.footprint === 'stair') buildStair(at, cell);
  else if (!isStanding(def)) return;
  else if (def.footprint === 'post' || def.footprint === 'canopy' || def.footprint === 'round') buildObject(at, cell);
  else buildBlock(at, cell);
}

function buildLevel(
  scene: Scene,
  level: number,
  defs: Readonly<Record<string, TileDrawDef>>,
  materials: LabMaterials,
  opts: WorldOptions,
  storey: number,
): { built: BuiltMeshes[]; leaves: LeafLayer | null; chunkKeys: string[]; propFailures: number } {
  const tiles = levelTiles(scene, level) as TileLayer | undefined;
  if (tiles === undefined) return { built: [], leaves: null, chunkKeys: [], propFailures: 0 };
  const m = metricsFor(scene.grid);
  const plan = planTiles(m, tileDrawInput(tiles, defs as Record<string, TileDrawDef>));
  const builders = new Map<string, MeshBuilder>();
  const emitters = new Map<string, MeshBuilder>();
  const leaves = new Map<string, { cells: string[]; b: MeshBuilder }>();
  const ctx: LevelCtx = {
    level,
    y: level * storey,
    storey,
    unitM: m.unitM,
    opts,
    plan,
    chunk(col, row) {
      const key = `${Math.floor(col / CHUNK)},${Math.floor(row / CHUNK)}`;
      let b = builders.get(key);
      if (b === undefined) {
        b = new MeshBuilder();
        builders.set(key, b);
      }
      return b;
    },
    emitterChunk(col, row) {
      const key = `${Math.floor(col / CHUNK)},${Math.floor(row / CHUNK)}`;
      let b = emitters.get(key);
      if (b === undefined) {
        b = new MeshBuilder();
        emitters.set(key, b);
      }
      return b;
    },
    doorLeaf(cells) {
      const key = cells.join('+');
      let leaf = leaves.get(key);
      if (leaf === undefined) {
        leaf = { cells: [...cells], b: new MeshBuilder() };
        leaves.set(key, leaf);
      }
      return leaf.b;
    },
    propFailures: 0,
  };

  // --- What is floor, and what kind -------------------------------------
  const splitCells: Array<{ cell: TileCell; split: GroundSplit }> = [];
  const waterCells: TileCell[] = [];
  const special = new Set<string>();
  for (const cell of plan.cells) {
    if (cell.seg !== undefined || cell.layer !== 0) continue;
    const key = `${cell.col},${cell.row}`;
    if (cell.split !== undefined) {
      splitCells.push({ cell, split: cell.split });
      special.add(key);
    } else if (cell.def.liquid !== undefined) {
      waterCells.push(cell);
      special.add(key);
    }
  }
  const waterKeys = new Set(waterCells.map((c) => `${c.col},${c.row}`));

  const floors = new Map<string, FloorSquare>();
  /** The plain (unlit) ground painted in each square, for filling under unpainted walls. */
  const groundOf = new Map<string, TileDrawDef>();
  const decals: Array<{ cell: TileCell; color: number; kind: Kind }> = [];
  const underlay = (cell: TileCell) => {
    const key = `${cell.col},${cell.row}`;
    const under = cell.def.underlay;
    if (under === undefined || plan.grounded.has(key) || special.has(key) || floors.has(key)) return;
    floors.set(key, { col: cell.col, row: cell.row, color: grained(parseColor(under.colors[0], FALLBACK_BASE), cell.col, cell.row), kind: 'solid' });
  };
  for (const cell of plan.cells) {
    if (cell.seg !== undefined) continue;
    const key = `${cell.col},${cell.row}`;
    if (cell.layer === 0 && special.has(key)) continue;
    const { def } = cell;
    const standingish = isStanding(def) || def.footprint === 'wall' || cell.span !== undefined || def.prop !== undefined;
    if (standingish) {
      underlay(cell);
      continue;
    }
    // A flat tile with a partial footprint still wants the set's floor under it.
    if (def.footprint !== undefined && def.footprint !== 'fill') underlay(cell);
    const tones = tonesOf(def);
    const glow = glowOf(def, tones);
    const color = glow !== null ? mix(tones.base, glow, 0.5) : grained(tones.base, cell.col, cell.row);
    const kind: Kind = glow !== null ? 'glow' : 'solid';
    if (cell.layer === 0) {
      floors.set(key, { col: cell.col, row: cell.row, color, kind });
      if (glow === null) groundOf.set(key, def);
    } else decals.push({ cell, color, kind });
  }

  // Ground under a wall or a piece of furniture the GM never painted: the
  // floor most of its neighbours have. A wall stands on a floor; drawn
  // without one, the square was a hole down to the (shaded, nearly black)
  // floor below — 93 of them on Sapphire's security floor, most under its
  // diagonal walls (2026-09-26). A square with no painted ground round it at
  // all stays open: that is outside, not a gap.
  const neighbourGround = (col: number, row: number): TileDrawDef | null => {
    const count = new Map<TileDrawDef, number>();
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dc === 0 && dr === 0) continue;
        const d = groundOf.get(`${col + dc},${row + dr}`);
        if (d !== undefined) count.set(d, (count.get(d) ?? 0) + 1);
      }
    }
    let best: TileDrawDef | null = null;
    let most = 0;
    for (const [d, n] of count) {
      if (n > most) {
        best = d;
        most = n;
      }
    }
    return best;
  };
  for (const cell of plan.cells) {
    if (cell.seg !== undefined) continue;
    const key = `${cell.col},${cell.row}`;
    if (floors.has(key) || special.has(key) || plan.grounded.has(key)) continue;
    const { def } = cell;
    const standingish = isStanding(def) || def.footprint === 'wall' || cell.span !== undefined || def.prop !== undefined;
    if (!standingish) continue;
    const ground = neighbourGround(cell.col, cell.row);
    if (ground === null) continue;
    floors.set(key, { col: cell.col, row: cell.row, color: grained(tonesOf(ground).base, cell.col, cell.row), kind: 'solid' });
  }

  const has = (col: number, row: number) => {
    const key = `${col},${row}`;
    return floors.has(key) || special.has(key);
  };
  for (const f of floors.values()) emitFloor(ctx, f, has);
  for (const { cell, split } of splitCells) emitSplit(ctx, cell, split);
  for (const cell of waterCells) emitWater(ctx, cell, (c, r) => waterKeys.has(`${c},${r}`));
  for (const { cell, color, kind } of decals) {
    const y = ctx.y + cell.layer * DECAL_LIFT;
    const x0 = cell.col;
    const z0 = cell.row;
    ctx.chunk(cell.col, cell.row).quad([x0, y, z0], [x0 + 1, y, z0], [x0 + 1, y, z0 + 1], [x0, y, z0 + 1], color, kind);
  }

  // --- Everything standing ----------------------------------------------
  for (const cell of plan.cells) {
    if (cell.seg !== undefined) buildArcPiece(ctx, cell, cell.seg);
    else buildStanding(ctx, cell);
  }

  const built: BuiltMeshes[] = [];
  const chunkKeys: string[] = [];
  for (const [key, b] of builders) {
    if (b.empty) continue;
    const meshes = b.finish(materials);
    for (const o of meshes.all) o.name = `level-${level}:chunk-${key}`;
    built.push(meshes);
    chunkKeys.push(key);
  }
  for (const [key, b] of emitters) {
    if (b.empty) continue;
    const meshes = b.finish(materials);
    if (meshes.solid) meshes.solid.castShadow = false;
    for (const o of meshes.all) o.name = `level-${level}:lights-${key}`;
    built.push(meshes);
    chunkKeys.push(`lights:${key}`);
  }
  // Every door leaf in one mesh per material, each leaf's span of it kept,
  // drawing the shut ones as the painted doors say.
  const merged = new MeshBuilder();
  const doors: DoorRec[] = [];
  for (const leaf of leaves.values()) {
    if (leaf.b.empty) continue;
    const spans = merged.absorb(leaf.b);
    const open = new Set(leaf.cells.filter((c) => plan.openDoors.has(c)));
    doors.push({ level, cells: leaf.cells, open, spans });
  }
  let layer: LeafLayer | null = null;
  if (!merged.empty) {
    const meshes = merged.finish(materials);
    for (const o of meshes.all) o.name = `level-${level}:doors`;
    for (const part of LEAF_PARTS) {
      const geometry = meshes[part]?.geometry;
      if (!geometry) continue;
      const count = geometry.getAttribute('position').count;
      geometry.setIndex(new BufferAttribute(new Uint32Array(count), 1).setUsage(DynamicDrawUsage));
      // Still a triangle soup — vertex i belongs to triangle ⌊i/3⌋ alone —
      // whose index only leaves whole leaves out; the lighting's bake reads
      // this to treat it as the soup it is (`lighting3d.ts`).
      geometry.userData.soup = true;
    }
    layer = { meshes, doors };
    drawShutLeaves(layer);
  }
  return { built, leaves: layer, chunkKeys, propFailures: ctx.propFailures };
}

/** A door leaf as the world keeps it: `BuiltDoor`, with its open cells writable and its spans in the floor's leaf meshes. */
interface DoorRec extends BuiltDoor {
  readonly open: Set<string>;
  readonly spans: BuilderSpans;
}

/** A floor's door leaves as drawn: its leaf meshes, and every leaf in them. */
interface LeafLayer {
  meshes: BuiltMeshes;
  doors: DoorRec[];
}

/** The leaf meshes' parts, each with a span per leaf. */
const LEAF_PARTS = ['solid', 'glass', 'glow', 'lines'] as const;
/** The parts a ray can hit: hairlines are not what anyone clicks. */
const LEAF_SURFACES = ['solid', 'glass', 'glow'] as const;

/**
 * Write each leaf mesh's index to draw the shut leaves only, whole and in
 * order, and draw no further than them. The vertices stay put.
 */
function drawShutLeaves(layer: LeafLayer): void {
  for (const part of LEAF_PARTS) {
    const geometry = layer.meshes[part]?.geometry;
    const index = geometry?.getIndex();
    if (!geometry || !index || !(index.array instanceof Uint32Array)) continue;
    const out = index.array;
    let n = 0;
    for (const d of layer.doors) {
      if (d.open.size > 0) continue;
      const span = d.spans[part];
      for (let k = 0; k < span.count; k += 1) out[n++] = span.start + k;
    }
    geometry.setDrawRange(0, n);
    index.needsUpdate = true;
  }
}

function trianglesOf(built: BuiltMeshes): number {
  let n = 0;
  for (const mesh of [built.solid, built.glass, built.glow]) {
    const pos = mesh?.geometry.getAttribute('position');
    if (pos !== undefined) n += pos.count / 3;
  }
  return n;
}

/**
 * Build the requested floors of a scene from its painted tiles.
 *
 * `defs` is the web palette (`tileDefsFromSets`), keyed by `tileDefKey`.
 * Floors are built in absolute world coordinates, each under its own group
 * named `level-${L}`; a floor index the scene does not have is skipped rather
 * than clamped to the top floor (which is what `levelTiles` would do).
 */
export function buildWorld(
  scene: Scene,
  defs: Readonly<Record<string, TileDrawDef>>,
  materials: LabMaterials,
  opts: WorldOptions,
): BuiltWorld {
  const started = performance.now();
  const storey = storeyUnits(scene.grid.unitM, opts.storeyM);
  const group = new Group();
  group.name = 'lab-world';
  const floorCount = sceneLevels(scene).length;
  const wanted = [...new Set(opts.levels)].filter((l) => Number.isInteger(l) && l >= 0 && l < floorCount).sort((a, b) => a - b);

  const levels: BuiltLevel[] = [];
  /** Per floor built, each door cell's leaves (a cell of a wide door and a leaf of its own share one). */
  const doorIndex = new Map<number, Map<string, DoorRec[]>>();
  /** Per floor built, its leaf meshes; null for a floor without a door. */
  const leafLayers = new Map<number, LeafLayer | null>();
  let triangles = 0;
  let propFailures = 0;
  for (const level of wanted) {
    const levelGroup = new Group();
    levelGroup.name = `level-${level}`;
    levelGroup.userData = { level };
    const out = buildLevel(scene, level, defs, materials, opts, storey);
    // Counted open or shut: every leaf is on the GPU either way.
    const built = out.leaves ? [...out.built, out.leaves.meshes] : out.built;
    for (const b of built) {
      for (const o of b.all) levelGroup.add(o);
      triangles += trianglesOf(b);
    }
    const index = new Map<string, DoorRec[]>();
    for (const d of out.leaves?.doors ?? []) {
      for (const cell of d.cells) {
        const list = index.get(cell);
        if (list) list.push(d);
        else index.set(cell, [d]);
      }
    }
    doorIndex.set(level, index);
    leafLayers.set(level, out.leaves);
    propFailures += out.propFailures;
    group.add(levelGroup);
    levels.push({ level, y: level * storey, built, doors: out.leaves?.doors ?? [], doorMeshes: out.leaves?.meshes ?? null });
  }
  if (propFailures > 0) console.warn(`[lab3d] ${propFailures} prop(s) failed to build and were left out`);

  return {
    group,
    storey,
    levels,
    stats: { triangles: Math.round(triangles), buildMs: performance.now() - started },
    setDoorOpen(level, cell, open) {
      const index = doorIndex.get(level);
      if (index === undefined) return false;
      let changed = false;
      for (const d of index.get(cell) ?? []) {
        if (d.open.has(cell) === open) continue;
        if (open) d.open.add(cell);
        else d.open.delete(cell);
        changed = true;
      }
      const layer = leafLayers.get(level);
      if (changed && layer) drawShutLeaves(layer);
      return true;
    },
    pickDoor(level, raycaster) {
      const layer = leafLayers.get(level);
      if (!layer) return null;
      const targets: Mesh[] = [];
      for (const part of LEAF_SURFACES) {
        const mesh = layer.meshes[part];
        if (mesh?.visible) targets.push(mesh);
      }
      if (targets.length === 0) return null;
      const hit = raycaster.intersectObjects(targets, false)[0];
      const part = LEAF_SURFACES.find((p) => layer.meshes[p] === hit?.object);
      const vertex = hit?.face?.a;
      if (hit === undefined || part === undefined || vertex === undefined) return null;
      for (const d of layer.doors) {
        const span = d.spans[part];
        if (d.open.size > 0 || vertex < span.start || vertex >= span.start + span.count) continue;
        // The square of the leaf the ray met: one leaf can span a run of them.
        const cell = `${Math.floor(hit.point.x)},${Math.floor(hit.point.z)}`;
        return d.cells.includes(cell) ? cell : (d.cells[0] ?? null);
      }
      return null;
    },
    dispose() {
      for (const l of levels) for (const b of l.built) disposeBuilt(b);
      for (const child of [...group.children]) child.removeFromParent();
      group.removeFromParent();
    },
  };
}
