/**
 * The 3D lab's lighting: the rules' lamps as three.js light, at three prices.
 *
 * Every lamp comes from the rules light model (`lightSourcesFor`), with the
 * area it reaches already cut by walls (`lightPolygonsFor`), so the lab
 * lights exactly the squares the dice read as lit. What changes with the
 * device is how much of that light is computed per pixel, per frame:
 *
 *   - LOW (a phone, a TV): no real-time lamps at all. Each lamp's light is
 *     baked into the world's vertices once, and the world is drawn with an
 *     unlit material whose colour is its paint times (ambient + baked).
 *   - MEDIUM (a laptop): the 8 lamps nearest the focus are real three.js
 *     lights, the 3 nearest of those casting shadows; every other lamp stays
 *     baked, added to the lit material's diffuse, so a lamp across the map
 *     still pools on its floor.
 *   - HIGH (a gaming PC): 24 real-time lamps, 8 with shadows, the rest baked.
 *     No bloom: tried, and it smeared the glow over the room and hid the
 *     scene rather than lighting it (2026-09-26).
 *
 * Under all three sit a sky/ground hemisphere and a weak key light (the
 * "moon"), set by the scene's ambient light row.
 *
 * Baked and real-time light are the same light. A baked vertex gets exactly
 * the irradiance a shadowless three.js point light would give it — the same
 * intensity, the same inverse-square falloff and cutoff window, the same
 * N·L — except that walls are the rules' walls (the polygon) rather than a
 * shadow map. So a lamp that moves between the two as the camera pans keeps
 * its brightness; what it gains in real time is per-pixel shape, specular
 * and shadows from things the rules do not count as walls (furniture,
 * figures).
 *
 * The bake is cached on the world (`bakes`), per lamp: the page rebuilds the
 * lighting whenever a token moves or a floor is hidden, and only the lamps
 * that actually changed are baked again.
 *
 * Lab code: honest, not finished. Each approximation is named where it is made.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  CanvasTexture,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Group,
  HemisphereLight,
  Matrix3,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  SpotLight,
  Sprite,
  SpriteMaterial,
  Vector3,
  type InterleavedBufferAttribute,
  type Material,
  type Mesh,
  type Object3D,
  type Scene as ThreeScene,
  type WebGLRenderer,
} from 'three';
import type { Point } from '@safehouse/contracts';
import type { LightRow, LightSource } from '@safehouse/rules';
import type { BuiltWorld } from './world3d.js';

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/** How much of the lighting runs per frame: phones and TVs, laptops, gaming PCs. */
export type LabQuality = 'low' | 'medium' | 'high';

/** One lamp as the lab lights it: the rules' source, the area it reaches, and how high it hangs. */
export interface LabLightSource {
  /** The floor it is on. */
  level: number;
  /** World y of the lamp itself: its floor's y plus its hanging height. */
  y: number;
  /** The lamp as the rules model has it, in grid units. */
  source: LightSource;
  /** The area it reaches with walls respected (`lightPolygon`), in grid units. */
  polygon: Point[];
}

/** A running lighting setup for one world. */
export interface LabLighting {
  /** Switch tiers. The bake is shared by all three, so this is cheap after the first. */
  setQuality(q: LabQuality): void;
  /** Change the ambient row live: the sky, the ground, the key light, and the unlit material's copy of them. */
  setAmbient(row: LightRow): void;
  /**
   * Re-pick which lamps are real-time around `focus` (world units), with
   * enough stickiness that a lamp does not flip in and out as the camera
   * drifts. Meant to be called a few times a second, not every frame.
   */
  update(focus: Vector3): void;
  /** Lamps lit per pixel now, how many of those cast shadows, and how many are baked. */
  stats(): { realtime: number; shadowed: number; baked: number };
  /** Take every light out of the scene and give the world its own materials back. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

interface Tier {
  /** Real-time lamps, spots included. */
  pool: number;
  /** How many real-time point lamps cast shadows. */
  shadows: number;
  /** How many of the pool may be spot lights (beams). */
  spots: number;
  /** Shadow map size for a lamp (a point lamp's is six faces of it). */
  mapSize: number;
  /** Shadow map size for the key light, which covers the whole map. */
  keyMapSize: number;
}

const TIERS: Readonly<Record<LabQuality, Tier>> = {
  low: { pool: 0, shadows: 0, spots: 0, mapSize: 0, keyMapSize: 0 },
  medium: { pool: 8, shadows: 3, spots: 2, mapSize: 512, keyMapSize: 1024 },
  high: { pool: 24, shadows: 8, spots: 4, mapSize: 1024, keyMapSize: 2048 },
};

/**
 * A lamp's intensity, in three's physical units (candela, with world units
 * standing in for metres):
 *
 *   I = LAMP_K × rows × R²,  R = √(radius² + h²),  cutoff D = CUTOFF_SLACK × R,  decay 2
 *
 * where `radius` is the rules' reach on the floor in squares and `h` how high
 * the lamp hangs over its floor. R is the distance from the lamp to the rim
 * of its pool, so R² makes the pool's shape independent of its size: every
 * lamp of the same rows puts the same light on the same FRACTION of its
 * reach. Three gives a matte surface of albedo a the radiance
 * a/π · I·cosθ/d² · (1 − (d/D)⁴)², so for the commonest lamp — a ceiling
 * light, radius 5, hung 2.7 squares up, rows 2 — I ≈ 35.5, and E/π (1.0 is
 * "the surface shows its painted colour") runs ≈ 1.5 straight below, ≈ 0.5 at
 * 2.5 squares, ≈ 0.13 at 4, and 0 at the rim. Full ambient light (row 0) is
 * ≈ 1.1 on a floor, so a lamp in a dark room reads as a pool with a bright
 * middle and a soft edge, and one in a lit room lifts the floor under it by
 * about half again, which ACES rolls off rather than clips. Rows 1 is half as
 * bright, rows 3 half again as bright.
 */
const LAMP_K = 0.55;
/** How far past the rim of its pool a lamp's light is cut off (three's `distance`). */
const CUTOFF_SLACK = 1.15;
/**
 * APPROXIMATION — low lamps are lifted. A lamp hung low over a wide pool (a
 * pool of light painted on the ground, a barrel fire) would, as a point,
 * burn a hot spot under itself and barely reach its rim; the rules mean an
 * even pool. Such a lamp is lit from half its radius up instead (at most
 * `LIFT_MAX_STOREYS` of a storey), baked and real-time alike. Beams keep
 * their height: a flashlight is held where it is held.
 */
const LIFT_OF_RADIUS = 0.5;
const LIFT_MAX_STOREYS = 0.8;
/** A beam wider than this is lit as a lamp shining all round (three's spot tops out at 180°). */
const SPOT_MAX_FOV = 170;
/** A spot's cone is capped a little under a right angle. */
const SPOT_MAX_ANGLE = (83 * Math.PI) / 180;
const SPOT_PENUMBRA = 0.3;
/** A beam aims at the floor this far along its reach: a torch lights the ground ahead, not the far wall. */
const SPOT_AIM = 0.6;

/**
 * The ambient rows, as the Env tab has them: 0 full light, 1 partial, 2 dim,
 * 3 total darkness. `level` scales everything; the colours go from a neutral
 * day to a blue night.
 *
 * Evenly stepped, and total darkness still shows the room (2026-09-26: the
 * first curve, 1 / 0.42 / 0.14 / 0.035, jumped from partial to dim and made
 * dark a black screen with lamps in it — useless on a map). The rules'
 * darkness is the dice modifier; the map's job is to show the players where
 * the dark is while still showing them the room it is in.
 */
const AMBIENT: readonly [AmbientRow, AmbientRow, AmbientRow, AmbientRow] = [
  { level: 1, sky: 0xf4f6ff, ground: 0x8c857a, key: 0xfff1dc },
  { level: 0.62, sky: 0xe2e8ff, ground: 0x7d7a74, key: 0xffe6c4 },
  { level: 0.38, sky: 0xbfcbff, ground: 0x666873, key: 0xc8d4ff },
  { level: 0.2, sky: 0xa9b8ff, ground: 0x545a6a, key: 0xaabbff },
];
interface AmbientRow {
  level: number;
  sky: number;
  ground: number;
  key: number;
}
/**
 * Shares of "full light" (E/π = 1) the hemisphere and the key give a floor
 * at row 0. The key is weak on purpose: it is there to tell one wall face
 * from the next and to ground things with a soft shadow, not to light rooms.
 */
const HEMI_SHARE = 0.8;
const KEY_SHARE = 0.35;
/**
 * Toward the key light: high (55°) and from the south-south-west. The iso
 * camera sits south-east, so of the two wall faces it sees the south ones
 * catch the key and the east ones do not — the two-tone the 2D iso map paints.
 */
const KEY_DIR = new Vector3(-0.35, 1.2, 0.75).normalize();

/**
 * High's lamps over Medium's: none. A tier changes how faithfully the light
 * is drawn (more lamps live, more and sharper shadows), never how bright it
 * is — High once ran 1.3x hotter to make up for floors shadowing themselves
 * (fixed in geometry3d's normals), and on top of Dark's doubled lamps that
 * blew the dark scenes out (2026-09-26).
 */
const HIGH_BOOST = 1;
/**
 * High marks each lamp with a soft glow where it hangs — what bloom was
 * meant to do, without smearing the room. Its size in squares per row of
 * the lamp, and how strongly it shows at each ambient row (stronger in the
 * dark, where a lamp is the thing to find).
 */
const HALO_SQUARES = 0.35;
/**
 * The lamps' strength at each ambient row, over their physical intensity.
 * Partial and Dim are the table's mood settings and are left as they are;
 * at the two ends the lamps are doubled (2026-09-26), because at Full the
 * daylight drowned every pool (the lamps "vanished") and at Dark each lamp
 * lit only the few squares under it. A map is not a light meter: the lamps
 * have to read at every setting, the way the eye adapts to a lit room or a
 * dark one.
 */
const LAMP_GAIN: readonly [number, number, number, number] = [2, 1, 1, 2];
const HALO_OPACITY: readonly [number, number, number, number] = [0.2, 0.26, 0.32, 0.38];

/** Stickiness when re-picking: a lamp already real-time counts as this much nearer. */
const STICK_FACTOR = 0.85;
const STICK_SQUARES = 1;

/** Shadow biases: `bias` in each shadow's own depth units, `normalBias` in squares. */
const KEY_BIAS = -0.0005;
const KEY_NORMAL_BIAS = 0.05;
const POINT_BIAS = -0.003;
const SPOT_BIAS = -0.0008;
const LAMP_NORMAL_BIAS = 0.03;
/**
 * A lamp's shadow camera starts just outside its own fixture, so the pendant,
 * terminal or rack it sits inside (or the figure carrying it) does not
 * swallow its light. This far past the fixture's own squares, at least.
 */
const FIXTURE_CLEAR = 0.05;
const NEAR_MIN = 0.3;
/** A parked pool light: off, and far out of the way. */
const PARK_Y = -10000;
/**
 * Varyings the lab's lit material uses besides shadow coordinates (view
 * position, normal, vertex colour, baked light) plus one spare: each point
 * shadow costs one more, and some GPUs stop at 15.
 */
const VARYINGS_RESERVED = 5;

/** Bake: how far a surface point is nudged along its normal toward the lamp before the polygon test. */
const NUDGE = 0.05;
/** Bake: how far a point is pulled toward its own triangle's middle, so a floor square knows which side of a wall it is on. */
const INWARD = 0.03;
/**
 * APPROXIMATION — the rules block light by whole squares, but a 3D wall is a
 * third of a square thick, standing in the middle of its square. A surface
 * inside a blocking square (a wall's face, a cut wall's top, a rack's lid)
 * is tested this much nearer its lamp, which lets light onto faces up to ~60°
 * off their lamp. The cost: a surface within this distance behind a traced
 * wall (an arc; wall tiles are a whole square thick in the rules) can catch
 * light from the other side. Floors are never moved, so light does not creep
 * under a wall.
 */
const WALL_REACH = 0.7;
/** A surface this close above its floor and facing up is floor, and is not moved toward the lamp. */
const FLOOR_EPS = 0.05;
/** Bake: horizontal slack on a lamp's reach, for points nudged back into its polygon. */
const REACH_SLACK = 0.1;
const MIN_NDL = 1e-3;
/** Bake: contributions below this (before intensity) are dropped. */
const MIN_G = 1e-5;
/** Point-in-polygon bands, in squares. */
const BAND_SQUARES = 0.25;
/** A cached lamp bake no lighting has used for this many rebuilds is dropped. */
const KEEP_GENERATIONS = 4;

/** The two baked attributes: light on the side each vertex's normal faces, and on the other side. */
const ATTR_FRONT = 'bakedFront';
const ATTR_BACK = 'bakedBack';

// ---------------------------------------------------------------------------
// The bake, cached per world
// ---------------------------------------------------------------------------

/** One world mesh the bake writes into. */
interface MeshRec {
  mesh: Mesh;
  level: number;
  count: number;
  /** Positions and unit normals in the world group's own frame (world units). */
  pos: Float32Array;
  nor: Float32Array;
  /** A triangle soup, as `MeshBuilder` makes: vertex i belongs to triangle ⌊i/3⌋ alone. */
  soup: boolean;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
  front: Float32Array;
  back: Float32Array;
  frontAttr: BufferAttribute;
  backAttr: BufferAttribute;
}

/** One lamp's light on one mesh: which vertices, and how much (before intensity and colour). */
interface BakePart {
  rec: number;
  idx: Uint32Array;
  /** Irradiance per unit intensity; positive on the normal's side, negative on the other. */
  g: Float32Array;
}

interface LampBake {
  parts: BakePart[];
  entries: number;
  /** The generation that last used it. */
  used: number;
}

interface WorldBake {
  recs: MeshRec[];
  lamps: Map<string, LampBake>;
  gen: number;
}

/**
 * The bake, kept with the world it was made for. The baked attributes live
 * on the world's own geometry and go when the world disposes it; they are
 * reused, never re-created, by each lighting built on that world.
 */
const bakes = new WeakMap<BuiltWorld, WorldBake>();

const IDENTITY = new Matrix4();

/** An attribute's xyz as a flat Float32Array, without a copy when it already is one. */
function floats3(attr: BufferAttribute | InterleavedBufferAttribute): Float32Array {
  if (attr instanceof BufferAttribute && attr.itemSize === 3 && !attr.normalized && attr.array instanceof Float32Array) {
    return attr.array;
  }
  const out = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i += 1) {
    out[i * 3] = attr.getX(i);
    out[i * 3 + 1] = attr.getY(i);
    out[i * 3 + 2] = attr.getZ(i);
  }
  return out;
}

function makeRec(mesh: Mesh, level: number, toGroup: Matrix4): MeshRec | null {
  if (!(mesh.material instanceof MeshStandardMaterial)) return null;
  const geo = mesh.geometry;
  const posAttr = geo.getAttribute('position');
  const norAttr = geo.getAttribute('normal');
  if (!posAttr || !norAttr || posAttr.count !== norAttr.count || posAttr.count === 0) return null;
  const count = posAttr.count;
  let pos = floats3(posAttr);
  let nor = floats3(norAttr);

  // The world builds in absolute coordinates, so this is the identity in
  // practice; anything else is carried into the world group's frame.
  const rel = new Matrix4().multiplyMatrices(toGroup, mesh.matrixWorld);
  if (!rel.equals(IDENTITY)) {
    const e = rel.elements;
    const nm = new Matrix3().getNormalMatrix(rel).elements;
    const p2 = new Float32Array(count * 3);
    const n2 = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      const x = pos[i]!;
      const y = pos[i + 1]!;
      const z = pos[i + 2]!;
      p2[i] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      p2[i + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      p2[i + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
      const a = nor[i]!;
      const b = nor[i + 1]!;
      const c = nor[i + 2]!;
      const nx = nm[0]! * a + nm[3]! * b + nm[6]! * c;
      const ny = nm[1]! * a + nm[4]! * b + nm[7]! * c;
      const nz = nm[2]! * a + nm[5]! * b + nm[8]! * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      n2[i] = nx / l;
      n2[i + 1] = ny / l;
      n2[i + 2] = nz / l;
    }
    pos = p2;
    nor = n2;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count * 3; i += 3) {
    const x = pos[i]!;
    const y = pos[i + 1]!;
    const z = pos[i + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const front = new Float32Array(count * 3);
  const back = new Float32Array(count * 3);
  const frontAttr = new BufferAttribute(front, 3).setUsage(DynamicDrawUsage);
  const backAttr = new BufferAttribute(back, 3).setUsage(DynamicDrawUsage);
  geo.setAttribute(ATTR_FRONT, frontAttr);
  geo.setAttribute(ATTR_BACK, backAttr);

  return {
    mesh,
    level,
    count,
    pos,
    nor,
    soup: geo.index === null && count % 3 === 0,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    front,
    back,
    frontAttr,
    backAttr,
  };
}

/** The world's bake cache, made (with its attributes) the first time a lighting is built on it. */
function worldBakeFor(world: BuiltWorld): WorldBake {
  const known = bakes.get(world);
  if (known) return known;
  world.group.updateWorldMatrix(true, true);
  const toGroup = world.group.matrixWorld.clone().invert();
  const recs: MeshRec[] = [];
  for (const lv of world.levels) {
    for (const b of lv.built) {
      for (const mesh of [b.solid, b.glass]) {
        if (!mesh) continue;
        const rec = makeRec(mesh, lv.level, toGroup);
        if (rec) recs.push(rec);
      }
    }
  }
  const made: WorldBake = { recs, lamps: new Map(), gen: 0 };
  bakes.set(world, made);
  return made;
}

/** A light polygon made quick to test: its edges filed by horizontal band. */
interface Poly {
  xs: Float64Array;
  ys: Float64Array;
  n: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  bandH: number;
  bands: Int32Array[];
}

function preparePolygon(points: readonly Point[]): Poly | null {
  const n = points.length;
  if (n < 3) return null;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const p = points[i]!;
    xs[i] = p.x;
    ys[i] = p.y;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const nb = Math.max(1, Math.min(64, Math.ceil((maxY - minY) / BAND_SQUARES)));
  const bandH = (maxY - minY) / nb || 1;
  const lists: number[][] = Array.from({ length: nb }, () => []);
  const band = (y: number) => Math.max(0, Math.min(nb - 1, Math.floor((y - minY) / bandH)));
  for (let i = 0; i < n; i += 1) {
    const a = ys[i]!;
    const b = ys[(i + 1) % n]!;
    const b1 = band(Math.max(a, b));
    for (let k = band(Math.min(a, b)); k <= b1; k += 1) lists[k]!.push(i);
  }
  return { xs, ys, n, minX, maxX, minY, maxY, bandH, bands: lists.map((l) => Int32Array.from(l)) };
}

/**
 * Even-odd point-in-polygon, looking only at the edges in the point's band:
 * any edge a horizontal ray through the point could cross spans its y, so it
 * is filed in that band.
 */
function inPolygon(p: Poly, x: number, y: number): boolean {
  if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) return false;
  const edges = p.bands[Math.min(p.bands.length - 1, Math.floor((y - p.minY) / p.bandH))]!;
  let inside = false;
  for (let k = 0; k < edges.length; k += 1) {
    const i = edges[k]!;
    const j = i + 1 === p.n ? 0 : i + 1;
    const yi = p.ys[i]!;
    const yj = p.ys[j]!;
    if (yi > y !== yj > y) {
      const xi = p.xs[i]!;
      if (x < ((p.xs[j]! - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * One lamp's light on every vertex of its own floor, per unit intensity.
 *
 * A vertex is lit when its lamp could see it: the point, nudged off its
 * surface toward the lamp (and into its own triangle, and — for anything but
 * floor — `WALL_REACH` nearer the lamp), lies in the lamp's polygon. How much
 * is exactly what three's physical point light would give it:
 * cosθ/d² · (1 − (d/D)⁴)². Surfaces are drawn from both sides and their
 * normals point either way, so the light is filed by side: on the side the
 * normal faces (positive) or the other (negative). A lamp lights one side of
 * a surface, never both.
 */
function bakeLamp(lamp: Lamp, poly: Poly, recs: readonly MeshRec[]): LampBake {
  const parts: BakePart[] = [];
  let entries = 0;
  const reach = lamp.radius + REACH_SLACK;
  const reach2 = reach * reach;
  const cut2 = lamp.cutoff * lamp.cutoff;
  const ax = lamp.x;
  const ay = lamp.y;
  const az = lamp.z;
  const floorTop = lamp.floorY + FLOOR_EPS;
  for (let r = 0; r < recs.length; r += 1) {
    const rec = recs[r]!;
    if (rec.level !== lamp.level) continue;
    if (rec.maxX < ax - reach || rec.minX > ax + reach || rec.maxZ < az - reach || rec.minZ > az + reach) continue;
    const P = rec.pos;
    const N = rec.nor;
    const idx: number[] = [];
    const gs: number[] = [];
    for (let i = 0; i < rec.count; i += 1) {
      const o = i * 3;
      const px = P[o]!;
      const py = P[o + 1]!;
      const pz = P[o + 2]!;
      const lx = ax - px;
      const lz = az - pz;
      const h2 = lx * lx + lz * lz;
      if (h2 > reach2) continue;
      const ly = ay - py;
      const d2 = h2 + ly * ly;
      if (d2 >= cut2) continue;
      const nx = N[o]!;
      const ny = N[o + 1]!;
      const nz = N[o + 2]!;
      const dot = nx * lx + ny * ly + nz * lz;
      const side = dot > 0 ? 1 : -1;
      const ndl = (dot * side) / Math.sqrt(d2);
      if (!(ndl > MIN_NDL)) continue;

      let tx = px + side * nx * NUDGE;
      let tz = pz + side * nz * NUDGE;
      if (rec.soup) {
        const t = o - (o % 9);
        const cx = (P[t]! + P[t + 3]! + P[t + 6]!) / 3 - px;
        const cz = (P[t + 2]! + P[t + 5]! + P[t + 8]!) / 3 - pz;
        const cl = Math.hypot(cx, cz);
        if (cl > 1e-6) {
          const k = Math.min(INWARD, cl * 0.5) / cl;
          tx += cx * k;
          tz += cz * k;
        }
      }
      const floor = py < floorTop && Math.abs(ny) > 0.7;
      if (!floor && h2 > 1e-12) {
        const hl = Math.sqrt(h2);
        const k = Math.min(WALL_REACH, hl) / hl;
        tx += lx * k;
        tz += lz * k;
      }
      if (!inPolygon(poly, tx, tz)) continue;

      const q = d2 / cut2;
      const w = 1 - q * q;
      const g = (ndl / Math.max(d2, 0.01)) * w * w;
      if (g < MIN_G) continue;
      idx.push(i);
      gs.push(side * g);
    }
    if (idx.length > 0) {
      parts.push({ rec: r, idx: Uint32Array.from(idx), g: Float32Array.from(gs) });
      entries += idx.length;
    }
  }
  return { parts, entries, used: 0 };
}

// ---------------------------------------------------------------------------
// Lamps
// ---------------------------------------------------------------------------

/** A source made ready to light: where its light comes from, how strong, and what shape. */
interface Lamp {
  src: LabLightSource;
  level: number;
  /** The lamp in the world group's frame (x = grid x, z = grid y). */
  x: number;
  y: number;
  z: number;
  floorY: number;
  radius: number;
  cutoff: number;
  intensity: number;
  color: Color;
  /** Colour × intensity, linear: what one unit of baked `g` is worth. */
  rgb: readonly [number, number, number];
  spot: boolean;
  angle: number;
  aimX: number;
  aimZ: number;
  near: number;
  /** What its bake depends on, for the cache. */
  key: string;
  bake: LampBake | null;
}

/** How far a lamp's own fixture reaches along any axis: its own squares, or the one it stands in. */
function fixtureReach(src: LightSource): number {
  let reach = 0.5;
  for (const key of src.own ?? []) {
    const [c, r] = key.split(',').map(Number);
    if (c === undefined || r === undefined || !Number.isFinite(c) || !Number.isFinite(r)) continue;
    reach = Math.max(reach, Math.abs(c - src.at.x), Math.abs(c + 1 - src.at.x), Math.abs(r - src.at.y), Math.abs(r + 1 - src.at.y));
  }
  return reach;
}

/** A soft round glow, white at the middle and gone at the edge; tinted per lamp by its sprite's colour. */
function makeHaloTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

function makeLamp(s: LabLightSource, floorY: number, storey: number): Lamp | null {
  const src = s.source;
  if (!(src.radius > 0) || s.polygon.length < 3) return null;
  const spot = src.fov !== undefined && src.fov < SPOT_MAX_FOV;
  const hung = Math.max(0.05, s.y - floorY);
  const h = spot ? hung : Math.max(hung, Math.min(src.radius * LIFT_OF_RADIUS, storey * LIFT_MAX_STOREYS));
  const R = Math.hypot(src.radius, h);
  const cutoff = CUTOFF_SLACK * R;
  const rows = Math.min(3, Math.max(1, src.rows));
  const intensity = LAMP_K * rows * R * R;
  const color = new Color();
  try {
    color.setStyle(src.color);
  } catch {
    color.setHex(0xffffff);
  }
  const facing = ((src.facing ?? 0) * Math.PI) / 180;
  const aim = src.radius * SPOT_AIM;
  const x = src.at.x;
  const y = floorY + h;
  const z = src.at.y;
  const poly = s.polygon.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
  return {
    src: s,
    level: s.level,
    x,
    y,
    z,
    floorY,
    radius: src.radius,
    cutoff,
    intensity,
    color,
    rgb: [color.r * intensity, color.g * intensity, color.b * intensity],
    spot,
    angle: Math.min(SPOT_MAX_ANGLE, (((src.fov ?? 90) / 2) * Math.PI) / 180),
    aimX: x + Math.cos(facing) * aim,
    aimZ: z + Math.sin(facing) * aim,
    near: Math.max(NEAR_MIN, Math.min(fixtureReach(src) + FIXTURE_CLEAR, src.radius * 0.4)),
    key: `${s.level}|${x}|${y.toFixed(4)}|${z}|${src.radius}|${cutoff.toFixed(4)}|${poly}`,
    bake: null,
  };
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** The uniforms Low's unlit material reads the ambient from. */
interface LowUniforms {
  sky: { value: Color };
  ground: { value: Color };
  keyColor: { value: Color };
  keyDir: { value: Vector3 };
}

/**
 * Which side of a surface the camera sees, in the vertex shader: the side its
 * normal faces toward the eye. Every vertex of a flat triangle agrees, so it
 * picks the same baked side for the whole face that `gl_FrontFacing` would,
 * and costs one varying rather than two.
 */
const SIDE_GLSL = /* glsl */ `
	vec3 labViewNormal = normalize( normalMatrix * normal );
	bool labFront = isOrthographic ? labViewNormal.z > 0.0 : dot( labViewNormal, - mvPosition.xyz ) > 0.0;
`;

const LOW_VERTEX_PARS = /* glsl */ `
attribute vec3 ${ATTR_FRONT};
attribute vec3 ${ATTR_BACK};
uniform vec3 labSky;
uniform vec3 labGround;
uniform vec3 labKeyColor;
uniform vec3 labKeyDir;
varying vec3 vLabLight;
`;

/** Low: the whole irradiance per vertex — hemisphere, key and baked lamps. Faces are flat, so per vertex is per face. */
const LOW_VERTEX_MAIN = /* glsl */ `${SIDE_GLSL}
	vec3 labNormal = normalize( mat3( modelMatrix ) * normal ) * ( labFront ? 1.0 : - 1.0 );
	vLabLight = mix( labGround, labSky, 0.5 * labNormal.y + 0.5 )
		+ labKeyColor * max( dot( labNormal, labKeyDir ), 0.0 )
		+ ( labFront ? ${ATTR_FRONT} : ${ATTR_BACK} );
`;

const LOW_FRAGMENT_PARS = /* glsl */ `
uniform float labDiffuse;
varying vec3 vLabLight;
`;

const LIT_VERTEX_PARS = /* glsl */ `
attribute vec3 ${ATTR_FRONT};
attribute vec3 ${ATTR_BACK};
varying vec3 vLabBaked;
`;

const LIT_VERTEX_MAIN = /* glsl */ `${SIDE_GLSL}
	vLabBaked = labFront ? ${ATTR_FRONT} : ${ATTR_BACK};
`;

const LIT_FRAGMENT_PARS = /* glsl */ `
varying vec3 vLabBaked;
`;

/** Baked lamps are diffuse only: no specular highlight from a lamp that is not real-time. */
const LIT_FRAGMENT_MAIN = /* glsl */ `
	reflectedLight.directDiffuse += vLabBaked * BRDF_Lambert( material.diffuseColor );
`;

function insertAfter(src: string, anchor: string, code: string): string {
  if (!src.includes(anchor)) {
    console.warn(`[lab3d] lighting: shader anchor not found: ${anchor}`);
    return src;
  }
  return src.replace(anchor, `${anchor}\n${code}`);
}

function replaceOnce(src: string, target: string, code: string): string {
  if (!src.includes(target)) {
    console.warn(`[lab3d] lighting: shader line not found: ${target}`);
    return src;
  }
  return src.replace(target, code);
}

/**
 * Low's material for a world material: unlit, its colour the vertex paint
 * times (hemisphere + key + baked) / π — what the lit material's diffuse term
 * would make of the same light, without its specular, shadows or per-pixel
 * anything.
 */
function lowVariant(orig: MeshStandardMaterial, u: LowUniforms): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    color: orig.color,
    vertexColors: orig.vertexColors,
    side: orig.side,
    transparent: orig.transparent,
    opacity: orig.opacity,
    depthWrite: orig.depthWrite,
    depthTest: orig.depthTest,
    alphaTest: orig.alphaTest,
  });
  m.name = `${orig.name || 'lab'}:baked-unlit`;
  const diffuse = { value: 1 - orig.metalness };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.labSky = u.sky;
    shader.uniforms.labGround = u.ground;
    shader.uniforms.labKeyColor = u.keyColor;
    shader.uniforms.labKeyDir = u.keyDir;
    shader.uniforms.labDiffuse = diffuse;
    shader.vertexShader = LOW_VERTEX_PARS + insertAfter(shader.vertexShader, '#include <project_vertex>', LOW_VERTEX_MAIN);
    shader.fragmentShader =
      LOW_FRAGMENT_PARS +
      replaceOnce(
        shader.fragmentShader,
        'reflectedLight.indirectDiffuse += vec3( 1.0 );',
        'reflectedLight.indirectDiffuse += vLabLight * ( labDiffuse * RECIPROCAL_PI );',
      );
  };
  m.customProgramCacheKey = () => 'lab3d-baked-unlit';
  return m;
}

/** Medium and High's material for a world material: the same lit material, plus the baked lamps in its diffuse. */
function litVariant(orig: MeshStandardMaterial): MeshStandardMaterial {
  const m = orig.clone();
  m.name = `${orig.name || 'lab'}:baked-lit`;
  m.onBeforeCompile = (shader, renderer) => {
    orig.onBeforeCompile(shader, renderer);
    shader.vertexShader = LIT_VERTEX_PARS + insertAfter(shader.vertexShader, '#include <project_vertex>', LIT_VERTEX_MAIN);
    shader.fragmentShader = LIT_FRAGMENT_PARS + insertAfter(shader.fragmentShader, '#include <lights_fragment_end>', LIT_FRAGMENT_MAIN);
  };
  m.customProgramCacheKey = () => `lab3d-baked-lit|${orig.customProgramCacheKey()}`;
  return m;
}

// ---------------------------------------------------------------------------
// The lighting
// ---------------------------------------------------------------------------

/** One real-time light in the pool, and the lamp it is showing (-1: parked). */
interface Slot {
  light: PointLight | SpotLight;
  spot: boolean;
  shadow: boolean;
  lamp: number;
}

/**
 * Light a built world with the rules' lamps. Starts at Medium when the
 * renderer has a shadow map and at Low when it does not; the page sets the
 * tier it wants straight after.
 */
export function createLighting(ctx: {
  scene: ThreeScene;
  renderer: WebGLRenderer;
  world: BuiltWorld;
  sources: readonly LabLightSource[];
  ambientRow: LightRow;
  storey: number;
}): LabLighting {
  const { world, renderer } = ctx;
  const storey = ctx.storey > 0 ? ctx.storey : world.storey;

  // Everything lives in one group that follows the world's frame, so the
  // lamps stand where the world's vertices say, whatever the page does
  // with the world group.
  const root = new Group();
  root.name = 'lab-lighting';
  root.matrixAutoUpdate = false;
  const toLocal = new Matrix4();
  const syncFrame = () => {
    world.group.updateWorldMatrix(true, false);
    root.matrix.copy(world.group.matrixWorld);
    root.matrixWorldNeedsUpdate = true;
    toLocal.copy(root.matrix).invert();
  };
  syncFrame();
  ctx.scene.add(root);

  // --- lamps and their bake ------------------------------------------------

  const cache = worldBakeFor(world);
  const recs = cache.recs;
  cache.gen += 1;
  const floorYs = new Map<number, number>(world.levels.map((l) => [l.level, l.y]));
  const lamps: Lamp[] = [];
  for (const s of ctx.sources) {
    const lamp = makeLamp(s, floorYs.get(s.level) ?? s.level * storey, storey);
    if (lamp) lamps.push(lamp);
  }
  /**
   * The multiplier on every lamp: the tier's (`HIGH_BOOST`) times the
   * ambient row's (`LAMP_GAIN`). Set by `applyQuality` and `applyAmbient`
   * through `setBoost`.
   */
  let boost = 1;
  let tierBoost = 1;
  let ambientGain = 1;

  // High's glow at each lamp: one soft sprite per lamp, where the lamp
  // actually hangs (not where a low lamp is lifted to for its pool).
  const haloTexture = makeHaloTexture();
  const halos = new Group();
  halos.name = 'lab-lamp-halos';
  halos.visible = false;
  const haloMaterials: SpriteMaterial[] = [];
  for (const lamp of lamps) {
    const mat = new SpriteMaterial({
      map: haloTexture,
      color: lamp.color,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    haloMaterials.push(mat);
    const sprite = new Sprite(mat);
    const rows = Math.min(3, Math.max(1, lamp.src.source.rows));
    const size = HALO_SQUARES * (1 + rows);
    sprite.scale.set(size, size, 1);
    sprite.position.set(lamp.x, lamp.src.y, lamp.z);
    halos.add(sprite);
  }
  root.add(halos);

  {
    const t0 = performance.now();
    let fresh = 0;
    let scanned = 0;
    for (const lamp of lamps) {
      let b = cache.lamps.get(lamp.key);
      if (!b) {
        const poly = preparePolygon(lamp.src.polygon);
        b = poly ? bakeLamp(lamp, poly, recs) : { parts: [], entries: 0, used: 0 };
        cache.lamps.set(lamp.key, b);
        fresh += 1;
        scanned += b.entries;
      }
      b.used = cache.gen;
      lamp.bake = b;
    }
    for (const [key, b] of cache.lamps) if (b.used < cache.gen - KEEP_GENERATIONS) cache.lamps.delete(key);
    if (fresh > 0) {
      let verts = 0;
      for (const rec of recs) verts += rec.count;
      console.info(
        `[lab3d] light bake: ${fresh} of ${lamps.length} lamps baked (${lamps.length - fresh} cached), ` +
          `${scanned} lit vertices of ${verts}, ${(performance.now() - t0).toFixed(1)} ms`,
      );
    }
  }

  /** Per mesh, the lamps whose light falls on it. */
  const recLamps: Array<Array<{ lamp: number; part: BakePart }>> = recs.map(() => []);
  lamps.forEach((lamp, i) => {
    for (const part of lamp.bake?.parts ?? []) recLamps[part.rec]!.push({ lamp: i, part });
  });

  /** 1 where a lamp is real-time now (and so left out of the bake). */
  let realtime = new Uint8Array(lamps.length);

  /** Rewrite one mesh's baked attributes from every lamp on it that is not real-time. */
  function accumulate(r: number): void {
    const rec = recs[r]!;
    const F = rec.front;
    const B = rec.back;
    F.fill(0);
    B.fill(0);
    for (const { lamp, part } of recLamps[r]!) {
      if (realtime[lamp]) continue;
      const [lr, lg, lb] = lamps[lamp]!.rgb;
      const cr = lr * boost;
      const cg = lg * boost;
      const cb = lb * boost;
      const idx = part.idx;
      const g = part.g;
      for (let k = 0; k < idx.length; k += 1) {
        const v = idx[k]! * 3;
        const s = g[k]!;
        if (s > 0) {
          F[v] = F[v]! + cr * s;
          F[v + 1] = F[v + 1]! + cg * s;
          F[v + 2] = F[v + 2]! + cb * s;
        } else {
          B[v] = B[v]! - cr * s;
          B[v + 1] = B[v + 1]! - cg * s;
          B[v + 2] = B[v + 2]! - cb * s;
        }
      }
    }
    rec.frontAttr.needsUpdate = true;
    rec.backAttr.needsUpdate = true;
  }

  // --- materials -----------------------------------------------------------

  const lowU: LowUniforms = {
    sky: { value: new Color() },
    ground: { value: new Color() },
    keyColor: { value: new Color() },
    keyDir: { value: new Vector3(0, 1, 0) },
  };
  const originals = new Map<Mesh, Material | Material[]>();
  const variants = new Map<Material, { low: MeshBasicMaterial; lit: MeshStandardMaterial }>();
  for (const rec of recs) {
    const orig = rec.mesh.material;
    originals.set(rec.mesh, orig);
    if (orig instanceof MeshStandardMaterial && !variants.has(orig)) {
      variants.set(orig, { low: lowVariant(orig, lowU), lit: litVariant(orig) });
    }
  }
  function dressWorld(low: boolean): void {
    for (const rec of recs) {
      const orig = originals.get(rec.mesh);
      const v = orig instanceof MeshStandardMaterial ? variants.get(orig) : undefined;
      if (v) rec.mesh.material = low ? v.low : v.lit;
    }
  }

  // --- ambient -------------------------------------------------------------

  const hemi = new HemisphereLight(0xffffff, 0x000000, 0);
  hemi.name = 'lab-sky';
  const key = new DirectionalLight(0xffffff, 0);
  key.name = 'lab-key';
  key.shadow.bias = KEY_BIAS;
  key.shadow.normalBias = KEY_NORMAL_BIAS;
  root.add(hemi, key, key.target);

  // The key's shadow covers the whole world: its bounds, as a sphere.
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let by0 = Infinity;
  let by1 = -Infinity;
  let bz0 = Infinity;
  let bz1 = -Infinity;
  for (const rec of recs) {
    bx0 = Math.min(bx0, rec.minX);
    bx1 = Math.max(bx1, rec.maxX);
    by0 = Math.min(by0, rec.minY);
    by1 = Math.max(by1, rec.maxY);
    bz0 = Math.min(bz0, rec.minZ);
    bz1 = Math.max(bz1, rec.maxZ);
  }
  if (!Number.isFinite(bx0)) {
    bx0 = by0 = bz0 = 0;
    bx1 = bz1 = 1;
    by1 = storey;
  }
  const center = new Vector3((bx0 + bx1) / 2, (by0 + by1) / 2, (bz0 + bz1) / 2);
  const span = Math.max(1, 0.5 * Math.hypot(bx1 - bx0, by1 - by0, bz1 - bz0));
  key.target.position.copy(center);
  key.position.copy(center).addScaledVector(KEY_DIR, span + 10);
  {
    const cam = key.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 1;
    cam.far = 2 * span + 20;
    cam.updateProjectionMatrix();
  }

  let ambientRow: LightRow = ctx.ambientRow;
  function applyAmbient(): void {
    const row = Math.min(3, Math.max(0, Math.round(Number.isFinite(ambientRow) ? ambientRow : 0))) as LightRow;
    const a = AMBIENT[row];
    ambientGain = LAMP_GAIN[row];
    hemi.color.setHex(a.sky);
    hemi.groundColor.setHex(a.ground);
    hemi.intensity = Math.PI * HEMI_SHARE * a.level;
    key.color.setHex(a.key);
    key.intensity = Math.PI * KEY_SHARE * a.level;
    lowU.sky.value.copy(hemi.color).multiplyScalar(hemi.intensity);
    lowU.ground.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity);
    lowU.keyColor.value.copy(key.color).multiplyScalar(key.intensity);
    lowU.keyDir.value.copy(KEY_DIR).transformDirection(root.matrix);
    for (const m of haloMaterials) m.opacity = HALO_OPACITY[row];
  }
  applyAmbient();

  // --- the real-time pool --------------------------------------------------

  let quality: LabQuality | null = null;
  let slots: Slot[] = [];
  const focus = new Vector3().copy(center);
  const tmp = new Vector3();
  let disposed = false;

  function park(slot: Slot): void {
    slot.lamp = -1;
    slot.light.intensity = 0;
    slot.light.position.set(0, PARK_Y, 0);
    slot.light.shadow.autoUpdate = false;
  }

  function place(slot: Slot, i: number): void {
    const L = lamps[i]!;
    const light = slot.light;
    light.position.set(L.x, L.y, L.z);
    light.color.copy(L.color);
    light.intensity = L.intensity * boost;
    light.distance = L.cutoff;
    light.decay = 2;
    if (light instanceof SpotLight) {
      light.angle = L.angle;
      light.penumbra = SPOT_PENUMBRA;
      light.target.position.set(L.aimX, L.floorY, L.aimZ);
    }
    if (slot.shadow) {
      const cam = light.shadow.camera;
      if (cam.near !== L.near) {
        cam.near = L.near;
        cam.updateProjectionMatrix();
      }
      // Drawn once where it lands, not every frame: nothing in the lab moves
      // but the camera, and a shadow does not depend on the camera.
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = true;
    }
    slot.lamp = i;
  }

  function makeSlot(spot: boolean, shadow: boolean, mapSize: number): Slot {
    const light = spot ? new SpotLight(0xffffff, 0, 1, Math.PI / 4, SPOT_PENUMBRA, 2) : new PointLight(0xffffff, 0, 1, 2);
    light.castShadow = shadow;
    if (shadow) {
      light.shadow.mapSize.set(mapSize, mapSize);
      light.shadow.bias = spot ? SPOT_BIAS : POINT_BIAS;
      light.shadow.normalBias = LAMP_NORMAL_BIAS;
    }
    root.add(light);
    if (light instanceof SpotLight) root.add(light.target);
    const slot: Slot = { light, spot, shadow, lamp: -1 };
    park(slot);
    return slot;
  }

  function dropSlots(): void {
    for (const slot of slots) {
      if (slot.light instanceof SpotLight) slot.light.target.removeFromParent();
      slot.light.removeFromParent();
      slot.light.dispose();
    }
    slots = [];
  }

  /** Is this object drawn: it and everything above it visible? */
  function shown(o: Object3D | null): boolean {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  /**
   * The highest floor on show. Only its lamps go real-time: a floor slab
   * stops a lamp's light only in a shadow map, and most real-time lamps have
   * none, so a lamp downstairs would light the walls upstairs through the
   * floor. What is under the top floor keeps its baked light.
   */
  function topShownLevel(): number | null {
    let top: number | null = null;
    for (const lv of world.levels) {
      if (top !== null && lv.level <= top) continue;
      if (lv.built.some((b) => b.all.some((o) => shown(o)))) top = lv.level;
    }
    return top;
  }

  /**
   * Choose the real-time lamps around the focus and move the pool onto
   * them. Nearest first, by distance on the floor plane; a lamp already
   * real-time counts as nearer (`STICK_*`), and so does one already casting
   * a shadow when shadows are handed out, so neither pops as the focus
   * drifts. Lights keep their slot while they stay chosen, and the pool
   * never grows or shrinks — three recompiles every lit shader when the
   * number of lights changes. Returns the meshes whose bake must change.
   */
  function pick(): Set<number> {
    const before = realtime;
    const next = new Uint8Array(lamps.length);
    if (slots.length > 0) {
      tmp.copy(focus).applyMatrix4(toLocal);
      const top = topShownLevel();
      const order: Array<{ i: number; raw: number; score: number }> = [];
      lamps.forEach((L, i) => {
        if (top !== null && L.level !== top) return;
        const raw = Math.hypot(L.x - tmp.x, L.z - tmp.z);
        order.push({ i, raw, score: before[i] ? raw * STICK_FACTOR - STICK_SQUARES : raw });
      });
      order.sort((a, b) => a.score - b.score);

      const spotSlots = slots.filter((s) => s.spot);
      const shadowSlots = slots.filter((s) => !s.spot && s.shadow);
      const plainSlots = slots.filter((s) => !s.spot && !s.shadow);
      const pointRoom = shadowSlots.length + plainSlots.length;
      const spots: number[] = [];
      const points: Array<{ i: number; raw: number }> = [];
      for (const o of order) {
        if (lamps[o.i]!.spot) {
          if (spots.length < spotSlots.length) spots.push(o.i);
        } else if (points.length < pointRoom) {
          points.push(o);
        }
        if (spots.length >= spotSlots.length && points.length >= pointRoom) break;
      }

      const wasShadowed = new Set(shadowSlots.map((s) => s.lamp));
      const byShadow = points
        .map((o) => ({ i: o.i, score: wasShadowed.has(o.i) ? o.raw * STICK_FACTOR - STICK_SQUARES : o.raw }))
        .sort((a, b) => a.score - b.score);
      assign(shadowSlots, byShadow.slice(0, shadowSlots.length).map((o) => o.i));
      assign(plainSlots, byShadow.slice(shadowSlots.length).map((o) => o.i));
      assign(spotSlots, spots);
      for (const slot of slots) if (slot.lamp >= 0) next[slot.lamp] = 1;
    }
    realtime = next;

    const dirty = new Set<number>();
    for (let i = 0; i < lamps.length; i += 1) {
      if (before[i] === next[i]) continue;
      for (const part of lamps[i]!.bake?.parts ?? []) dirty.add(part.rec);
    }
    return dirty;
  }

  /** Put `want` into `group`, leaving lamps already there where they are and parking what is left. */
  function assign(group: readonly Slot[], want: readonly number[]): void {
    const wanted = new Set(want);
    const kept = new Set<number>();
    const free: Slot[] = [];
    for (const slot of group) {
      if (slot.lamp >= 0 && wanted.has(slot.lamp)) kept.add(slot.lamp);
      else free.push(slot);
    }
    let k = 0;
    for (const i of want) {
      if (kept.has(i)) continue;
      const slot = free[k];
      if (!slot) break;
      k += 1;
      place(slot, i);
    }
    for (; k < free.length; k += 1) park(free[k]!);
  }

  function applyQuality(q: LabQuality): void {
    quality = q;
    tierBoost = q === 'high' ? HIGH_BOOST : 1;
    boost = tierBoost * ambientGain;
    halos.visible = q === 'high';
    const tier = TIERS[q];
    const shadowsOn = tier.pool > 0 && renderer.shadowMap.enabled;

    // The pool, sized once per tier so the light count never changes.
    dropSlots();
    const beams = lamps.filter((l) => l.spot).length;
    const spotCount = Math.min(tier.spots, beams);
    const pointCount = Math.min(tier.pool - spotCount, lamps.length - beams);
    const caps = renderer.capabilities;
    const keyShadows = shadowsOn ? 1 : 0;
    const spotShadows = shadowsOn ? spotCount : 0;
    // A point shadow costs a varying and a texture unit; stay inside both.
    const room = Math.min(caps.maxVaryings - VARYINGS_RESERVED, caps.maxTextures - 1) - keyShadows - spotShadows;
    const pointShadows = shadowsOn ? Math.max(0, Math.min(tier.shadows, pointCount, room)) : 0;
    for (let i = 0; i < pointCount; i += 1) slots.push(makeSlot(false, i < pointShadows, tier.mapSize));
    for (let i = 0; i < spotCount; i += 1) slots.push(makeSlot(true, shadowsOn, tier.mapSize));

    key.castShadow = shadowsOn;
    if (shadowsOn && key.shadow.mapSize.x !== tier.keyMapSize) {
      key.shadow.mapSize.set(tier.keyMapSize, tier.keyMapSize);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }
    // Like the lamps' shadows: drawn when the lighting is set up, not per frame.
    key.shadow.autoUpdate = false;
    key.shadow.needsUpdate = true;

    dressWorld(q === 'low');
    realtime = new Uint8Array(lamps.length);
    pick();
    for (let r = 0; r < recs.length; r += 1) accumulate(r);
  }

  applyQuality(renderer.shadowMap.enabled ? 'medium' : 'low');

  return {
    setQuality(q) {
      if (disposed || q === quality) return;
      applyQuality(q);
    },

    setAmbient(row) {
      if (disposed) return;
      ambientRow = row;
      applyAmbient();
      // The lamps' gain moved with the row: re-light the real-time lamps and
      // re-add the baked ones (the bake itself, per unit of light, stands).
      const next = tierBoost * ambientGain;
      if (next !== boost && quality !== null) {
        boost = next;
        for (const slot of slots) if (slot.lamp >= 0) slot.light.intensity = lamps[slot.lamp]!.intensity * boost;
        for (let r = 0; r < recs.length; r += 1) accumulate(r);
      }
    },

    update(f) {
      if (disposed) return;
      focus.copy(f);
      syncFrame();
      lowU.keyDir.value.copy(KEY_DIR).transformDirection(root.matrix);
      if (slots.length === 0) return;
      for (const r of pick()) accumulate(r);
    },

    stats() {
      let rt = 0;
      let shadowed = 0;
      for (const slot of slots) {
        if (slot.lamp < 0) continue;
        rt += 1;
        if (slot.shadow) shadowed += 1;
      }
      return { realtime: rt, shadowed, baked: lamps.length - rt };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      dropSlots();
      for (const [mesh, mat] of originals) mesh.material = mat;
      for (const v of variants.values()) {
        v.low.dispose();
        v.lit.dispose();
      }
      variants.clear();
      originals.clear();
      hemi.dispose();
      key.dispose();
      for (const m of haloMaterials) m.dispose();
      haloTexture.dispose();
      root.removeFromParent();
      // The baked attributes stay on the world's geometry: the next lighting
      // on this world reuses them (and the per-lamp bake), and they are freed
      // with that geometry when the world is disposed.
    },
  };
}
