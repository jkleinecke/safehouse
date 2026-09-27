/**
 * The 3D map's geometry builder: everything the runtime draws goes through one
 * of these, so a whole floor's walls, furniture and figures end up as a
 * handful of meshes — a draw call per material, not per sofa.
 *
 * World units (the 3D world's one convention, shared by every builder here):
 *   x = the grid's x (squares, east),
 *   z = the grid's y (squares, south),
 *   y = up, in squares — a storey is `storeyUnits(unitM)` squares tall.
 * A point handed to the builder is already in world units.
 *
 * Colours are sRGB hex numbers as the 2D map used them; lighting is the
 * engine's, so nothing here pre-shades a face. `emissive` parts (a lamp's
 * shade, a screen, a neon strip) go to their own mesh with an emissive
 * material, which is what the bloom pass and the light model key on.
 */
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  ShapeUtils,
  Vector2,
  type Material,
  type Object3D,
} from 'three';
import { applyCover, type CoverMode } from '../grid/stage3d/cover.js';

export type V3 = readonly [number, number, number];

/** How tall one storey is, in squares: a storey is `STOREY_M` metres, and a square is `unitM`. */
export const STOREY_M = 3;
export function storeyUnits(unitM: number, storeyM = STOREY_M): number {
  return storeyM / (unitM > 0 ? unitM : 1);
}

const tmpColor = new Color();

/** One material's worth of triangles, with a colour per vertex. */
class TriBuffer {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];

  push(a: V3, b: V3, c: V3, n: V3, color: number): void {
    tmpColor.setHex(color, 'srgb');
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Newell's method: the normal of a (possibly non-convex, roughly planar) polygon. */
export function polygonNormal(pts: readonly V3[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    x += (p[1] - q[1]) * (p[2] + q[2]);
    y += (p[2] - q[2]) * (p[0] + q[0]);
    z += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return norm([x, y, z]);
}

export interface BuiltMeshes {
  /** The lit, shadow-casting surfaces. */
  solid: Mesh | null;
  /** Glass and other see-through surfaces: lit, not shadow-casting, blended. */
  glass: Mesh | null;
  /** Things that give off light: their own emissive material. */
  glow: Mesh | null;
  /** Hairlines — seams, trim, cables — unlit one-pixel lines. */
  lines: LineSegments | null;
  /** Everything above, as one list, for adding to a scene and disposing. */
  all: Object3D[];
}

/** A run of vertices in one of a builder's meshes: the first, and how many. */
export interface VertexSpan {
  start: number;
  count: number;
}

/** Where one builder's geometry landed in another's (`MeshBuilder.absorb`), per output mesh. */
export interface BuilderSpans {
  solid: VertexSpan;
  glass: VertexSpan;
  glow: VertexSpan;
  lines: VertexSpan;
}

/**
 * Collects triangles by material. Build once per chunk of the world, then
 * `finish()` hands back at most four objects.
 */
export class MeshBuilder {
  private readonly solid = new TriBuffer();
  private readonly glass = new TriBuffer();
  private readonly glowTris = new TriBuffer();
  private readonly lineBuf: number[] = [];
  private readonly lineCol: number[] = [];

  private target(kind: 'solid' | 'glass' | 'glow'): TriBuffer {
    return kind === 'glass' ? this.glass : kind === 'glow' ? this.glowTris : this.solid;
  }

  /**
   * A planar polygon, any winding, convex or not (triangulated in its own
   * plane). Faces both ways.
   *
   * A mostly-horizontal polygon is turned to face UP whatever order its
   * points came in: a floor, a lid, a table top. The normal matters beyond
   * shading — a shadow is looked up a little way out along it (three's
   * `normalBias`), and a floor whose normal pointed down looked it up inside
   * itself and shadowed itself in fine diagonal stripes (2026-09-26: the
   * "moiré" on every floor at Medium and High). Winding is reversed with the
   * normal, so double-sided shading still agrees with it.
   */
  polygon(pts: readonly V3[], color: number, kind: 'solid' | 'glass' | 'glow' = 'solid'): void {
    if (pts.length < 3) return;
    let n = polygonNormal(pts);
    if (n[1] < -0.5) {
      pts = [...pts].reverse();
      n = [-n[0], -n[1], -n[2]];
    }
    const buf = this.target(kind);
    // Every triangle wound to face the way its normal does. Three's
    // triangulator winds its triangles its own way, whatever order the
    // points came in, and on a double-sided material a triangle wound
    // against its normal is drawn as its back face — with the normal turned
    // over, so a floor lit as if it faced the ground (2026-09-26: a black
    // half-square along the inside of every diagonal wall on the security
    // floor, and a dark spot on each diagonal wall's post).
    const tri = (a: V3, b: V3, c: V3) => {
      const f = cross(sub(b, a), sub(c, a));
      if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] < 0) buf.push(a, c, b, n, color);
      else buf.push(a, b, c, n, color);
    };
    if (pts.length === 3 || pts.length === 4) {
      // The common case, and convex in every design that draws one.
      for (let i = 1; i + 1 < pts.length; i += 1) tri(pts[0]!, pts[i]!, pts[i + 1]!);
      return;
    }
    // Project to the plane's dominant axes and let three triangulate.
    const ax = Math.abs(n[0]);
    const ay = Math.abs(n[1]);
    const az = Math.abs(n[2]);
    const flat = pts.map((p) =>
      ax >= ay && ax >= az ? new Vector2(p[1], p[2]) : ay >= az ? new Vector2(p[0], p[2]) : new Vector2(p[0], p[1]),
    );
    let tris: number[][];
    try {
      tris = ShapeUtils.triangulateShape(flat, []);
    } catch {
      tris = [];
    }
    if (tris.length === 0) {
      for (let i = 1; i + 1 < pts.length; i += 1) tri(pts[0]!, pts[i]!, pts[i + 1]!);
      return;
    }
    for (const [a, b, c] of tris) tri(pts[a!]!, pts[b!]!, pts[c!]!);
  }

  /** A quad a→b→c→d. */
  quad(a: V3, b: V3, c: V3, d: V3, color: number, kind: 'solid' | 'glass' | 'glow' = 'solid'): void {
    this.polygon([a, b, c, d], color, kind);
  }

  /**
   * An axis-aligned box in world units, all six faces. `top` colours the lid
   * separately (a desk's surface, a crate's lid).
   */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, opts: { top?: number; kind?: 'solid' | 'glass' | 'glow'; bottom?: boolean } = {}): void {
    const k = opts.kind ?? 'solid';
    const top = opts.top ?? color;
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], top, k); // top
    if (opts.bottom) this.quad([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], color, k);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, k); // south (+z)
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, k); // north (-z)
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, k); // east (+x)
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, k); // west (-x)
  }

  /**
   * A vertical prism over a floor polygon (x, z pairs), from y0 to y1: sides
   * and a lid. Walls at any angle, arc pieces, octagonal posts.
   */
  extrude(floor: ReadonlyArray<readonly [number, number]>, y0: number, y1: number, color: number, opts: { top?: number; kind?: 'solid' | 'glass' | 'glow' } = {}): void {
    const k = opts.kind ?? 'solid';
    const n = floor.length;
    if (n < 3 || y1 <= y0) return;
    // Sides face OUT whichever way round the ring was given (see `polygon`
    // on why a normal's direction matters): a ring with positive area in
    // (x, z) would put every side's normal inside the solid.
    let area = 0;
    for (let i = 0; i < n; i += 1) {
      const [ax, az] = floor[i]!;
      const [bx, bz] = floor[(i + 1) % n]!;
      area += ax * bz - bx * az;
    }
    if (area > 0) floor = [...floor].reverse();
    for (let i = 0; i < n; i += 1) {
      const [ax, az] = floor[i]!;
      const [bx, bz] = floor[(i + 1) % n]!;
      this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], color, k);
    }
    this.polygon(floor.map(([x, z]): V3 => [x, y1, z]), opts.top ?? color, k);
  }

  /** A cylinder (a prism of `sides`) standing on (cx, cz). */
  cylinder(cx: number, cz: number, r: number, y0: number, y1: number, color: number, opts: { sides?: number; top?: number; kind?: 'solid' | 'glass' | 'glow' } = {}): void {
    const sides = Math.max(3, opts.sides ?? 10);
    const ring: Array<[number, number]> = [];
    for (let i = 0; i < sides; i += 1) {
      const a = (i / sides) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    this.extrude(ring, y0, y1, color, { ...(opts.top !== undefined ? { top: opts.top } : {}), ...(opts.kind ? { kind: opts.kind } : {}) });
  }

  /**
   * A low-poly UV sphere centred on (cx, cy, cz): `segments` round the
   * middle and three quarters as many rings pole to pole (8 × 6 by default).
   * Faceted, like everything else here — a head, a lamp globe, an LED.
   */
  sphere(cx: number, cy: number, cz: number, r: number, color: number, kind: 'solid' | 'glass' | 'glow' = 'solid', segments = 8): void {
    const seg = Math.max(3, Math.round(segments));
    const rings = Math.max(2, Math.round(seg * 0.75));
    const at = (i: number, j: number): V3 => {
      const lat = (j / rings) * Math.PI; // 0 at the top pole, π at the bottom
      const lon = (i / seg) * Math.PI * 2;
      const ring = Math.sin(lat) * r;
      return [cx + Math.cos(lon) * ring, cy + Math.cos(lat) * r, cz + Math.sin(lon) * ring];
    };
    for (let j = 0; j < rings; j += 1) {
      for (let i = 0; i < seg; i += 1) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const d = at(i, j + 1);
        // The poles are fans of triangles, not quads with a zero-length edge.
        if (j === 0) this.polygon([a, c, d], color, kind);
        else if (j === rings - 1) this.polygon([a, b, d], color, kind);
        else this.quad(a, b, c, d, color, kind);
      }
    }
  }

  /**
   * A thick line as a square beam through its points: poles, rails, a
   * lamppost's arm, a figure's limbs. `r` is the half-thickness in world units.
   */
  beam(pts: readonly V3[], r: number, color: number, kind: 'solid' | 'glass' | 'glow' = 'solid'): void {
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const d = sub(b, a);
      if (Math.hypot(d[0], d[1], d[2]) < 1e-6) continue;
      const dir = norm(d);
      const ref: V3 = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = norm(cross(dir, ref));
      const v = norm(cross(dir, u));
      const corner = (p: V3, su: number, sv: number): V3 => [
        p[0] + (u[0] * su + v[0] * sv) * r,
        p[1] + (u[1] * su + v[1] * sv) * r,
        p[2] + (u[2] * su + v[2] * sv) * r,
      ];
      const ring: Array<[number, number]> = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      for (let j = 0; j < 4; j += 1) {
        const [s0, t0] = ring[j]!;
        const [s1, t1] = ring[(j + 1) % 4]!;
        this.quad(corner(a, s0, t0), corner(b, s0, t0), corner(b, s1, t1), corner(a, s1, t1), color, kind);
      }
    }
  }

  /** A hairline through its points (unlit, one pixel, whatever the zoom). */
  line(pts: readonly V3[], color: number): void {
    tmpColor.setHex(color, 'srgb');
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      this.lineBuf.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      this.lineCol.push(tmpColor.r, tmpColor.g, tmpColor.b, tmpColor.r, tmpColor.g, tmpColor.b);
    }
  }

  get empty(): boolean {
    return this.solid.empty && this.glass.empty && this.glowTris.empty && this.lineBuf.length === 0;
  }

  /**
   * Take everything `other` has collected onto the end of this builder's
   * own, and say where it landed: per output mesh, the first vertex and how
   * many. So several things built apart can be finished as one mesh per
   * material and still be told apart in it (the world's door leaves,
   * `world3d.ts`). `other` is left as it was.
   */
  absorb(other: MeshBuilder): BuilderSpans {
    const take = (to: number[], from: readonly number[]) => {
      for (let i = 0; i < from.length; i += 1) to.push(from[i]!);
    };
    const tris = (to: TriBuffer, from: TriBuffer): VertexSpan => {
      const span: VertexSpan = { start: to.pos.length / 3, count: from.pos.length / 3 };
      take(to.pos, from.pos);
      take(to.nor, from.nor);
      take(to.col, from.col);
      return span;
    };
    const lines: VertexSpan = { start: this.lineBuf.length / 3, count: other.lineBuf.length / 3 };
    take(this.lineBuf, other.lineBuf);
    take(this.lineCol, other.lineCol);
    return {
      solid: tris(this.solid, other.solid),
      glass: tris(this.glass, other.glass),
      glow: tris(this.glowTris, other.glowTris),
      lines,
    };
  }

  /** Hand the collected geometry over as meshes. The builder should not be used after. */
  finish(materials: LabMaterials): BuiltMeshes {
    const all: Object3D[] = [];
    const solid = this.solid.empty ? null : new Mesh(this.solid.geometry(), materials.solid);
    if (solid) {
      solid.castShadow = true;
      solid.receiveShadow = true;
      // Its shadow passes are three's own, with no fog in them: a wall the
      // players' fog hides still casts, so a hidden room's walls keep its
      // lamp's light in rather than letting it through onto revealed floor
      // (`grid/stage3d/cover.ts`, Shadows).
      all.push(solid);
    }
    const glass = this.glass.empty ? null : new Mesh(this.glass.geometry(), materials.glass);
    if (glass) {
      glass.receiveShadow = true;
      glass.renderOrder = 2;
      all.push(glass);
    }
    const glow = this.glowTris.empty ? null : new Mesh(this.glowTris.geometry(), materials.glow);
    if (glow) all.push(glow);
    let lines: LineSegments | null = null;
    if (this.lineBuf.length > 0) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(this.lineBuf, 3));
      g.setAttribute('color', new Float32BufferAttribute(this.lineCol, 3));
      lines = new LineSegments(g, materials.lines);
      all.push(lines);
    }
    return { solid, glass, glow, lines, all };
  }
}

/**
 * The four shared materials every builder's output uses. One set per runtime —
 * and one more per map stage, for its figures (`FigurePool`).
 */
export interface LabMaterials {
  solid: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  glow: MeshStandardMaterial;
  lines: LineBasicMaterial;
  dispose(): void;
}

/**
 * A set of the four materials. Every one wears the fog-and-shroud cover
 * (`grid/stage3d/cover.ts`), which does nothing until a map stage shows a
 * viewer's masks; `cover` says which masks hide what is drawn with the set:
 * both for the world (the default), the fog alone for a stage's figures, as
 * the 2D map drew its tokens over its shroud.
 */
export function createLabMaterials(cover: CoverMode = 'full'): LabMaterials {
  const solid = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: DoubleSide });
  const glass = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.1,
    metalness: 0.1,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: DoubleSide,
  });
  // Vertex colours drive the emissive colour too: the glow is the colour painted.
  const glow = new MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.6, side: DoubleSide });
  glow.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;',
    );
  };
  const lines = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 });
  const list: Material[] = [solid, glass, glow, lines];
  // After the glow's own hook, which the cover's wraps.
  for (const m of list) applyCover(m, cover);
  return {
    solid,
    glass,
    glow,
    lines,
    dispose: () => {
      for (const m of list) m.dispose();
    },
  };
}

/** Free a built chunk's geometry (materials are shared and freed by their owner). */
export function disposeBuilt(built: BuiltMeshes): void {
  for (const o of built.all) {
    const g = (o as Mesh).geometry;
    g?.dispose();
    o.removeFromParent();
  }
}

