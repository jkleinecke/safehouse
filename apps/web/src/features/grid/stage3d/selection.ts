/**
 * The Build selection on the 3D map, standing up (P3 of the move to 3D).
 *
 * The 2D map ringed every square of a selected painted object on the floor
 * (`stage/fx.ts` `drawPaintedSelection`), and laid a faint copy of it where a
 * drag or a paste would put it (`drawPaintedGhost`). Flat on a 3D floor both
 * lie at the FOOT of what they mean — a wall's ring is half hidden behind the
 * wall it rings, and a ghost reads as a rug. So here each is a box as tall as
 * what stands on its squares:
 *   - the selection (a wall run, a door, a prop, or the squares a marquee
 *     took) as the 2D map's magenta fill on the floor under each square, and
 *     the outline of the boxes over them — every edge of their union, the
 *     ones behind what stands in front drawn faint, so the box reads as a box;
 *   - the ghost as translucent cyan boxes with the same outline.
 *
 * How tall a square's box is comes from what its tile is (`tileTop`), read
 * the way the world builder reads it (`world3d.ts`): a painted height in
 * storeys, a full wall stopping just under the slab above, stairs at their
 * rise. So a box stands a hair over the wall it holds, and a ghost — whose
 * squares hold nothing yet — stands as tall as what is on its way there
 * (`boxTops`, from the slots the pointer says the drag or paste will paint,
 * `GhostFill`).
 *
 * The selected object's handles are drawn over the canvas as DOM discs
 * (`SelectionHandles`), at the floor points the pointer's hit test measures
 * them at (`PointerController.beginPaintedHandle` projects `handlesOf(obj)`
 * onto the floor): a handle is where a press takes it, and a wall standing in
 * front never hides one.
 *
 * Colours are the 2D map's (`stage/colors.ts`). Everything here is drawn over
 * the players' cover, as the 2D fx layer was over its fog — only the GM ever
 * builds — and never takes a ray.
 */
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  GreaterDepth,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Material,
  type Object3D,
  type Side,
} from 'three';
import type { Point } from '@safehouse/contracts';
import { C } from '../stage/colors.js';
import type { GhostFill } from '../stage/pointer.js';
import { tileDefKey, type TileDrawDef } from '../types.js';
import { UPPER_SLAB } from '../../lab3d/world3d.js';
import { exemptFromCover } from './cover.js';

/** How far above the floor the fills and the foot of each box lie, in squares: `FloorInk`'s lift. */
const LIFT = 0.03;
/** How far a box stands over what it holds, in squares, so its top edge is seen over a wall's top. */
const PAD = 0.04;
/**
 * How far a full-height wall or standing block stops short of the storey, in
 * squares: the slab above and a hair, as the world builds them (`world3d.ts`
 * `TOP_TRIM`). Furniture, posts, trees and stairs are built to their full
 * height.
 */
const TOP_TRIM = UPPER_SLAB + 0.04;
/** The height a piece of furniture with none of its own is built at, in storeys (`propKit3d.ts` `buildProp`). */
const PROP_DEFAULT_HEIGHT = 0.5;
/**
 * How far everything is drawn toward the camera, in squares. The camera is
 * orthographic, so this moves nothing on screen; it only puts an edge that
 * runs along a wall's own edge (a run's end) in front of the wall, not
 * fighting it for the same depth.
 */
const TOWARD_CAMERA = 0.02;
/** Two heights closer than this (squares) are the same height. */
const EPS = 1e-4;

/**
 * How tall what tile `def` builds stands, in squares above its floor, on a
 * world whose storey is `storey` squares — as the world builder builds it,
 * case for case in its order (`world3d.ts` `buildStanding`): a piece of
 * furniture at its height, or half a storey when it has none (`buildProp`);
 * a wall or a standing block trimmed under the slab above when it is a
 * storey tall; stairs at their rise; a post with its cap, a tree with its
 * crown, a round object to its top (`buildObject`). 0 for anything flat, or
 * a tile the palette does not know.
 */
export function tileTop(def: TileDrawDef | undefined, storey: number): number {
  if (def === undefined) return 0;
  if (def.prop !== undefined) return (def.height !== undefined && def.height > 0 ? def.height : PROP_DEFAULT_HEIGHT) * storey;
  const h = def.height ?? 0;
  if (def.footprint === 'wall') return h > 0 ? h * storey - (h >= 1 ? TOP_TRIM : 0) : 0;
  if (def.footprint === 'stair') return (def.height ?? 0.5) * storey;
  if (!(h > 0)) return 0;
  const top = h * storey;
  // A tree's crown sits over its height; a post wears a cap.
  if (def.footprint === 'canopy') return top * 1.1;
  if (def.footprint === 'post') return top + 0.05;
  if (def.footprint === 'round') return top;
  return Math.max(0, top - (h >= 1 ? TOP_TRIM : 0));
}

/**
 * How tall each of `cells` (`"col,row"`) stands, in squares above the floor
 * (0 flat), from what `fills` put there (palette `defs`, storey `storey`
 * squares): the tallest thing any of them puts in the square. A square no
 * fill names — a big piece of furniture's other squares, stored in one —
 * takes the tallest thing in any of them. With no fills every square is flat,
 * which is how the 2D map drew its ghost.
 */
export function boxTops(
  cells: readonly string[],
  fills: readonly GhostFill[],
  defs: Readonly<Record<string, TileDrawDef>>,
  storey: number,
): Map<string, number> {
  const own = new Map<string, number>();
  let tallest = 0;
  for (const fill of fills) {
    for (const [k, slot] of Object.entries(fill.slots)) {
      const h = tileTop(defs[tileDefKey(fill.tilesetId, slot)], storey);
      own.set(k, Math.max(own.get(k) ?? 0, h));
      tallest = Math.max(tallest, h);
    }
  }
  const out = new Map<string, number>();
  for (const k of cells) out.set(k, own.get(k) ?? tallest);
  return out;
}

/** How a set of boxes is drawn: its colour and each part's opacity (the 2D map's). */
export interface BoxStyle {
  color: number;
  /** The fill on the floor under each square (the 2D map's cell fill); under a box with faces, only a flat square's. */
  floorAlpha: number;
  /** The boxes' own faces, top and sides; 0 draws none — an outline only. */
  faceAlpha: number;
  /** The edges in view. */
  lineAlpha: number;
  /** The edges behind what stands in front of them. */
  hiddenAlpha: number;
}

/** The view the boxes are drawn for: which way the camera looks, and how wide an edge is. */
export interface BoxView {
  /** The camera's forward direction, in the world. It never turns, so an edge's width is laid across it once, when drawn. */
  dir: Vector3;
  /** An edge's width, in squares: the 2D map's stroke, in its world px over the square's (`width / cell`). */
  width: number;
}

/** Where a set of boxes is drawn. */
export interface SelectionBoxesOptions {
  /** World y of the floor in view. Read whenever the boxes are drawn or placed. */
  floorY: () => number;
  /** Draw order among the overlays: faces at this, edges just after. */
  renderOrder: number;
  style: BoxStyle;
}

/** One edge: its two ends, x y z each, in squares relative to the floor. */
type Edge = readonly [number, number, number, number, number, number];

/** Nothing here is what a click lands on: the pointer resolves what is under it. */
function noRaycast(): void {}

function keyOf(col: number, row: number): string {
  return `${col},${row}`;
}

/** A face made from quads, each wound to face out along its normal (so a front-side material draws the outside). */
class Faces {
  readonly pos: number[] = [];

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, outward: Vector3): void {
    const ab = tmpA.subVectors(b, a);
    const ac = tmpB.subVectors(c, a);
    const flip = tmpC.crossVectors(ab, ac).dot(outward) < 0;
    const [p, q, r, s] = flip ? [a, d, c, b] : [a, b, c, d];
    this.pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
    this.pos.push(p.x, p.y, p.z, r.x, r.y, r.z, s.x, s.y, s.z);
  }
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const UP = new Vector3(0, 1, 0);
const SIDES = [
  // North, south, west, east: the neighbour, the edge's two corners (cell-local), the outward normal.
  { dc: 0, dr: -1, a: [0, 0], b: [1, 0], n: new Vector3(0, 0, -1) },
  { dc: 0, dr: 1, a: [0, 1], b: [1, 1], n: new Vector3(0, 0, 1) },
  { dc: -1, dr: 0, a: [0, 0], b: [0, 1], n: new Vector3(-1, 0, 0) },
  { dc: 1, dr: 0, a: [1, 0], b: [1, 1], n: new Vector3(1, 0, 0) },
] as const;

function v3(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}

/**
 * Boxes standing on squares of the floor in view: one set of them (the
 * selection, or the ghost). Add `group` to the scene and `draw` whenever
 * what they stand on changes; a draw of the same boxes in the same view does
 * nothing.
 */
export class SelectionBoxes {
  /** Holds the boxes' meshes; sits at the floor's height. Add it to the scene. */
  readonly group = new Group();

  private readonly floorY: () => number;
  private readonly renderOrder: number;
  private readonly style: BoxStyle;
  private readonly fillMat: MeshBasicMaterial;
  private readonly faceMat: MeshBasicMaterial;
  private readonly ribbonMat: MeshBasicMaterial;
  private readonly lineMat: LineBasicMaterial;
  private readonly hiddenMat: LineBasicMaterial;
  private readonly geometries: BufferGeometry[] = [];
  /** What is drawn now (`draw`'s boxes and view), so the same draw again costs nothing. */
  private drawn = '';
  /** Which way the camera looked when last drawn: the boxes are pulled toward it (`TOWARD_CAMERA`). */
  private readonly dir = new Vector3(0, -1, 0);
  private disposed = false;

  constructor(options: SelectionBoxesOptions) {
    this.floorY = options.floorY;
    this.renderOrder = options.renderOrder;
    this.style = options.style;
    this.group.name = 'selection-boxes';
    const basic = (opacity: number, side: Side): MeshBasicMaterial =>
      new MeshBasicMaterial({
        color: options.style.color,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: true,
        side,
        toneMapped: false,
        fog: false,
      });
    this.fillMat = basic(options.style.floorAlpha, DoubleSide);
    this.faceMat = basic(options.style.faceAlpha, FrontSide);
    this.ribbonMat = basic(options.style.lineAlpha, DoubleSide);
    this.lineMat = new LineBasicMaterial({
      color: options.style.color,
      transparent: true,
      opacity: options.style.lineAlpha,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      fog: false,
    });
    // The same edges again where something stands in front of them, faint.
    this.hiddenMat = new LineBasicMaterial({
      color: options.style.color,
      transparent: true,
      opacity: options.style.hiddenAlpha,
      depthWrite: false,
      depthTest: true,
      depthFunc: GreaterDepth,
      toneMapped: false,
      fog: false,
    });
    for (const m of this.materials()) {
      m.name = 'selection-box';
      // Over the cover: the 2D map drew the selection and the ghost in its fx layer, above the fog.
      exemptFromCover(m);
    }
  }

  /**
   * Draw a box on each square of `tops` (`"col,row"` → how tall what stands
   * there is, squares above the floor; 0 flat), as `view` sees them. An empty
   * map draws nothing. True when what is drawn changed, and a frame is due
   * to show it; the same boxes in the same view again cost nothing and say
   * false.
   */
  draw(tops: ReadonlyMap<string, number>, view: BoxView): boolean {
    if (this.disposed) return false;
    let key = `${view.dir.x.toFixed(4)},${view.dir.y.toFixed(4)},${view.dir.z.toFixed(4)}|${view.width.toFixed(4)}`;
    for (const [k, h] of tops) key += `;${k}:${h.toFixed(3)}`;
    if (key === this.drawn) {
      this.place();
      return false;
    }
    this.drawn = key;
    this.drop();
    this.dir.copy(view.dir).normalize();
    this.place();
    if (tops.size === 0) return true;

    // Each square's box top, squares above the floor: its foot for a flat one.
    const top = (k: string): number | undefined => {
      const h = tops.get(k);
      return h === undefined ? undefined : h > EPS ? h + PAD : LIFT;
    };
    const edges: Edge[] = [];
    const fills = new Faces();
    const faces = new Faces();
    const withFaces = this.style.faceAlpha > 0;
    const corners = new Set<string>();

    for (const k of tops.keys()) {
      const [c, r] = k.split(',').map(Number) as [number, number];
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
      const t = top(k)!;
      const tall = t > LIFT + EPS;
      for (const [dc, dr] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        corners.add(keyOf(c + dc, r + dr));
      }
      if (this.style.floorAlpha > 0 && (!withFaces || !tall)) {
        fills.quad(v3(c, LIFT, r), v3(c + 1, LIFT, r), v3(c + 1, LIFT, r + 1), v3(c, LIFT, r + 1), UP);
      }
      if (withFaces && tall) faces.quad(v3(c, t, r), v3(c + 1, t, r), v3(c + 1, t, r + 1), v3(c, t, r + 1), UP);
      for (const side of SIDES) {
        const tn = top(keyOf(c + side.dc, r + side.dr));
        const ax = c + side.a[0];
        const az = r + side.a[1];
        const bx = c + side.b[0];
        const bz = r + side.b[1];
        // The foot of the union's outside wall.
        if (tn === undefined) edges.push([ax, LIFT, az, bx, LIFT, bz]);
        // Its top, wherever the square beside it is not as tall; and a flat
        // square's edge where a taller one rises beside it.
        if (tall && (tn === undefined || Math.abs(tn - t) > EPS)) edges.push([ax, t, az, bx, t, bz]);
        if (!tall && tn !== undefined && tn > t + EPS) edges.push([ax, t, az, bx, t, bz]);
        // A side face wherever this box rises over what is beside it.
        if (withFaces && tall && (tn === undefined || tn < t - EPS)) {
          const y0 = tn === undefined ? LIFT : Math.max(LIFT, tn);
          faces.quad(v3(ax, y0, az), v3(bx, y0, bz), v3(bx, t, bz), v3(ax, t, az), side.n);
        }
      }
    }

    // The upright edges: at each corner, between each pair of heights, where
    // the boxes standing that high round it turn a corner (one of the four
    // squares, three, or two across the diagonal) — not along a straight
    // run, and not inside the union.
    for (const v of corners) {
      const [x, z] = v.split(',').map(Number) as [number, number];
      const round = [top(keyOf(x - 1, z - 1)), top(keyOf(x, z - 1)), top(keyOf(x - 1, z)), top(keyOf(x, z))];
      const heights = [...new Set(round.filter((h): h is number => h !== undefined && h > LIFT + EPS))].sort((a, b) => a - b);
      let lo = LIFT;
      for (const hi of heights) {
        const occ = round.map((h) => h !== undefined && h >= hi - EPS);
        const n = occ.filter(Boolean).length;
        const corner = n === 1 || n === 3 || (n === 2 && occ[0] === occ[3]);
        if (corner) edges.push([x, lo, z, x, hi, z]);
        lo = hi;
      }
    }

    if (fills.pos.length > 0) this.addMesh(fills.pos, this.fillMat, this.renderOrder);
    if (faces.pos.length > 0) this.addMesh(faces.pos, this.faceMat, this.renderOrder + 0.1);
    if (edges.length === 0) return true;

    // The edges: camera-facing ribbons the 2D stroke's width (they grow and
    // shrink with the zoom, as the 2D map's strokes did), over hairlines that
    // keep them a pixel wide however far out the view is zoomed.
    const ribbons: number[] = [];
    const lines: number[] = [];
    const hw = view.width / 2;
    const along = new Vector3();
    const across = new Vector3();
    for (const [x0, y0, z0, x1, y1, z1] of edges) {
      lines.push(x0, y0, z0, x1, y1, z1);
      along.set(x1 - x0, y1 - y0, z1 - z0);
      across.crossVectors(along, this.dir);
      const len = across.length();
      // An edge seen end-on (an upright one from straight above) is a point.
      if (len < 1e-6 || !(hw > 0)) continue;
      across.multiplyScalar(hw / len);
      const { x: ox, y: oy, z: oz } = across;
      ribbons.push(x0 + ox, y0 + oy, z0 + oz, x1 + ox, y1 + oy, z1 + oz, x1 - ox, y1 - oy, z1 - oz);
      ribbons.push(x0 + ox, y0 + oy, z0 + oz, x1 - ox, y1 - oy, z1 - oz, x0 - ox, y0 - oy, z0 - oz);
    }
    if (ribbons.length > 0) this.addMesh(ribbons, this.ribbonMat, this.renderOrder + 0.2);
    const lineGeometry = this.geometry(lines);
    const visible = new LineSegments(lineGeometry, this.lineMat);
    visible.renderOrder = this.renderOrder + 0.3;
    const hidden = new LineSegments(lineGeometry, this.hiddenMat);
    hidden.renderOrder = this.renderOrder + 0.05;
    for (const o of [visible, hidden]) {
      o.raycast = noRaycast;
      this.group.add(o);
    }
    return true;
  }

  /** Draw nothing. True when something was drawn, and a frame is due to show it gone. */
  clear(): boolean {
    if (this.disposed || this.drawn === '') return false;
    this.drawn = '';
    this.drop();
    return true;
  }

  /**
   * One of each thing the boxes are drawn with, never shown: for the stage
   * to have their shaders compiled before the first box of a session needs
   * them (`Runtime3D.precompile`). The caller frees their geometry.
   */
  sample(): Object3D[] {
    const tri = (): BufferGeometry => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
      return g;
    };
    return [
      new Mesh(tri(), this.fillMat),
      new Mesh(tri(), this.faceMat),
      new Mesh(tri(), this.ribbonMat),
      new LineSegments(tri(), this.lineMat),
      new LineSegments(tri(), this.hiddenMat),
    ];
  }

  /** Stand the boxes on the floor `floorY` now names: call after the floor in view changed under an unchanged drawing. */
  place(): void {
    if (this.disposed) return;
    this.group.position.set(-this.dir.x * TOWARD_CAMERA, this.floorY() - this.dir.y * TOWARD_CAMERA, -this.dir.z * TOWARD_CAMERA);
  }

  /** Free the meshes and the materials, and take the group out of the scene. Draws nothing after this. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.drop();
    for (const m of this.materials()) m.dispose();
    this.group.removeFromParent();
  }

  private materials(): Material[] {
    return [this.fillMat, this.faceMat, this.ribbonMat, this.lineMat, this.hiddenMat];
  }

  private geometry(pos: number[]): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.geometries.push(g);
    return g;
  }

  private addMesh(pos: number[], material: MeshBasicMaterial, renderOrder: number): void {
    const mesh = new Mesh(this.geometry(pos), material);
    mesh.renderOrder = renderOrder;
    mesh.raycast = noRaycast;
    this.group.add(mesh);
  }

  private drop(): void {
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    this.group.clear();
  }
}

/** A colour as CSS `#rrggbb`. */
function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** A handle's size on screen, px: the 2D map's handle (radius 6, a 2-wide ring) at a table zoom. */
const HANDLE_PX = 12;

/**
 * The selected painted object's handles — a wall run's two ends, a prop's
 * corner — as discs over the canvas, at the floor points `set` is handed,
 * which are where the pointer's hit test measures a press against them.
 * Laid out after every frame (`layout`): a handle follows the view exactly.
 */
export class SelectionHandles {
  private readonly els: HTMLElement[] = [];
  private points: Point[] = [];
  /** The transform each element was last given, so an unmoved one is not written again. */
  private readonly laid: string[] = [];

  constructor(private readonly overlay: HTMLElement) {}

  /** Show a handle at each of `points` (grid units, on the floor in view), and no others. */
  set(points: readonly Point[]): void {
    this.points = points.map((p) => ({ x: p.x, y: p.y }));
    const doc = this.overlay.ownerDocument;
    while (this.els.length < this.points.length) {
      const el = doc.createElement('div');
      el.style.cssText = [
        'position:absolute',
        `left:${-HANDLE_PX / 2}px`,
        `top:${-HANDLE_PX / 2}px`,
        `width:${HANDLE_PX}px`,
        `height:${HANDLE_PX}px`,
        'box-sizing:border-box',
        'border-radius:50%',
        `background:${css(C.ground)}f2`,
        `border:2px solid ${css(C.magenta)}`,
        'pointer-events:none',
        // Placed by the first layout, not at the corner before it.
        'visibility:hidden',
      ].join(';');
      this.overlay.appendChild(el);
      this.els.push(el);
      this.laid.push('');
    }
    while (this.els.length > this.points.length) {
      this.els.pop()?.remove();
      this.laid.pop();
    }
    this.laid.fill('');
  }

  /** Put each handle where `project` (grid point on the floor → host px) says the view now draws its point. */
  layout(project: (grid: Point) => Point): void {
    for (let i = 0; i < this.els.length; i += 1) {
      const el = this.els[i]!;
      const p = this.points[i];
      if (p === undefined) continue;
      const s = project(p);
      const ok = Number.isFinite(s.x) && Number.isFinite(s.y);
      const t = ok ? `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px)` : 'hidden';
      if (this.laid[i] === t) continue;
      this.laid[i] = t;
      if (ok) {
        el.style.transform = t;
        el.style.visibility = 'visible';
      } else el.style.visibility = 'hidden';
    }
  }

  dispose(): void {
    for (const el of this.els) el.remove();
    this.els.length = 0;
    this.laid.length = 0;
    this.points = [];
  }
}
