/**
 * Which square a click on something STANDING means, on the 3D map (P3 of
 * the move to 3D).
 *
 * The pointer resolves a press through the floor's plane (`Camera3D.pick`):
 * the grid point on the floor in view under the pointer. For anything flat
 * that is the right square. For anything tall it is not: in the iso view a
 * wall a storey high covers the squares behind its own, so a press on its
 * upper half lands on the floor BEHIND it — the GM reaching for the wall
 * selected whatever stood two squares further back, or nothing.
 *
 * So a press that picks a thing (`PointerHost.pickCell`, `pickTileDoor`,
 * `pickTraced`) is resolved against what is drawn: ONE ray through the
 * pointer, cast at everything standing on the floor in view — the world's
 * walls, openings, door leaves, props, stairs and standing blocks, and the
 * GM's traced walls and doors (`tracedWalls.ts`) — and the first thing it
 * meets is what the press is on (`pickStanding`). One ray for both, so
 * neither is ever taken through the other: a traced door behind a painted
 * wall is not opened by a press on the wall, and a painted prop behind a
 * traced wall is not picked by a press on the traced wall's face. Not cast
 * at the floor's own surface as a thing (a floor square is the floor pick's
 * to answer, and answers the same), not at the flat overlays (the inks never
 * take a ray), not at the figures (tokens have their own pick,
 * `FigurePool.pick`).
 *
 * The ray meets a face, and a face lies on the edge of its square as often
 * as not — the long side of a wall run, the end of one reaching the square's
 * edge — where the hit point is as likely to round into the square beside it
 * as into its own. The hit point is therefore nudged a hair INTO what it hit,
 * against the face's normal, before its square is read: a wall's face gives
 * the wall's square, a table top the table's.
 *
 * Nothing here knows how the world was built beyond the names its builder
 * gives (`world3d.ts`): the world's group is `lab-world`, holding one group
 * per floor named `level-${L}`, whose meshes are that floor's chunks, its
 * lamps' fixtures and its door leaves. The leaves draw their shut ones only
 * (an index and a draw range), and three's mesh raycast honours both, so an
 * open door is not met.
 */
import { Vector3, type Intersection, type Mesh, type Object3D, type Raycaster } from 'three';
import type { Cell } from '../stage/pointer.js';

/** The world's group in the three.js scene, as `buildWorld` names it. */
const WORLD_NAME = 'lab-world';
/**
 * How far above the floor's top, in squares, a hit still counts as the floor
 * itself: the painted decals and rugs lie a hundredth of a square up per
 * layer, and a hit that low on a wall's foot is within a hair of the floor
 * point behind it anyway.
 */
const FLOOR_BAND = 0.06;
/** How far a hit point is pushed into what it hit before its square is read, in squares. */
const NUDGE = 0.02;

/** What `pickStanding` needs to know about the view besides the ray. */
export interface CellPickOptions {
  /** World y of the top of the floor in view (`floor × storey`). */
  floorY: number;
  /**
   * Whether the viewer cannot see what stands at world point (x, z) — a
   * player's fog, which the cover draws nothing through. A hit there is
   * passed through as if nothing stood there. Absent: everything is seen.
   */
  hidden?: ((x: number, z: number) => boolean) | undefined;
  /**
   * What else stands on the floor in view besides the world's own meshes —
   * the GM's traced walls and doors (`TracedWalls.targets`) — met by the same
   * ray on the same terms, except that a hit on one is never the floor,
   * however low on it: a traced wall's foot is still the wall.
   */
  extra?: readonly Mesh[] | undefined;
}

/** What a ray met first of everything standing on the floor in view (`pickStanding`). */
export interface StandingPick {
  /** The square of what it met, read from the hit nudged into it. */
  cell: Cell;
  /** Where and on what: a world mesh (a chunk, a lamp's fixture, the door leaves), or one of `extra`. */
  hit: Intersection;
  /** Whether what it met is one of `CellPickOptions.extra` rather than the world's own. */
  extra: boolean;
}

const normal = new Vector3();

/** Floor `level`'s group in the world under `root`, or null when that floor is not built (or not on show). */
function levelGroup(root: Object3D, level: number): Object3D | null {
  for (const child of root.children) {
    if (child.name !== WORLD_NAME || !child.visible) continue;
    const group = child.getObjectByName(`level-${level}`);
    if (group !== undefined && group.visible) return group;
  }
  return null;
}

/**
 * Every mesh on show on floor `level` of the world under `root` — chunks,
 * fixtures, door leaves — and nothing else: the floor's hairlines are lines,
 * which a ray would "meet" anywhere within a square of them.
 */
export function standingMeshes(root: Object3D, level: number): Mesh[] {
  const group = levelGroup(root, level);
  const out: Mesh[] = [];
  group?.traverseVisible((o) => {
    if ((o as Mesh).isMesh === true) out.push(o as Mesh);
  });
  return out;
}

/**
 * The first thing standing on floor `level` that `raycaster` meets, in the
 * world under `root` (the stage's three.js scene) or among `opts.extra`: its
 * square, the hit, and whether it was one of `extra`. Null when the ray meets
 * the floor first, or nothing — the caller then takes the floor pick's
 * square. `opts.floorY` is where the floor in view lies; `opts.hidden`
 * passes through what the viewer cannot see.
 */
export function pickStanding(
  root: Object3D,
  level: number,
  raycaster: Raycaster,
  opts: CellPickOptions,
): StandingPick | null {
  const extra = opts.extra ?? [];
  const targets = [...standingMeshes(root, level), ...extra];
  if (targets.length === 0) return null;
  // A chunk's box is far tighter than its sphere (a 16-square chunk a storey
  // tall has a sphere 23 squares across): with it, three skips the
  // triangles of every chunk the ray only passes near. Made once per
  // geometry, the first time a ray is cast at it.
  for (const mesh of targets) if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
  const others = new Set<Object3D>(extra);
  const dir = raycaster.ray.direction;
  for (const hit of raycaster.intersectObjects(targets, false)) {
    const p = hit.point;
    const isExtra = others.has(hit.object);
    // The floor (or its slab's edge, or water sunk below it) is nearer than
    // anything standing: the floor's square is the floor pick's answer.
    if (!isExtra && p.y <= opts.floorY + FLOOR_BAND) return null;
    if (opts.hidden?.(p.x, p.z) === true) continue;
    let x = p.x;
    let z = p.z;
    if (hit.face) {
      // The face's normal in the world, turned to face the ray, pushed
      // against: into the wall, down into the table.
      normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      if (normal.dot(dir) > 0) normal.negate();
      x -= normal.x * NUDGE;
      z -= normal.z * NUDGE;
    } else {
      x += dir.x * NUDGE;
      z += dir.z * NUDGE;
    }
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { cell: { col: Math.floor(x), row: Math.floor(z) }, hit, extra: isExtra };
  }
  return null;
}
