/**
 * How many squares a piece of furniture takes up (FR9.2).
 *
 * A painted object is stored in ONE cell — its anchor — like any tile. What
 * it covers is derived: its real size in metres, over the grid's metres per
 * square (`unitM`), rounded to whole squares, reaching right and down from
 * the anchor. So a 2.1 m bed on a 1 m grid covers two squares by two, the
 * same bed on a 2 m grid covers one, and a grid recalibrated to another size
 * re-derives every footprint without a single stored cell changing.
 *
 * Every square an object covers behaves as the object does — it blocks a
 * step, it stops a sightline, it gives cover — and the whole of it is one
 * thing to select, move and delete. The exceptions are the things that hang
 * or spread OVER the floor rather than standing on it (a tree's crown, a
 * café umbrella, a ceiling light): those are drawn their full size but stand
 * only in their anchor square, so the ground under them stays walkable.
 */
import type { TileProp } from './types.js';

/**
 * Each design's size in metres, along its own ACROSS (u, the design's x) and
 * DOWN (v, its y) — the way the design is drawn, so a car is long across and
 * a bed long down.
 *
 * These are sizes AT THE TABLE, not catalogue dimensions: a two-seat sofa is
 * 2 m by 1.5 m because on a 1 m grid a GM expects it to fill a 2x2 block and
 * two runners to be able to sit on it, and a bed the same. The rule of thumb
 * is to round a real piece up to the squares a player would draw it on.
 */
export const PROP_SIZE_M: Readonly<Record<TileProp, readonly [across: number, down: number]>> = {
  // --- furniture
  desk: [2.0, 1.0], chair: [0.8, 0.8], sofa: [2.0, 1.5], table: [2.0, 1.5], cocktail: [1.0, 1.0],
  booth: [2.0, 1.5], stool: [0.6, 0.6], terminal: [1.0, 1.0], server: [1.0, 1.0], locker: [1.0, 0.8],
  vending: [1.0, 1.0], cooler: [0.6, 0.6], bin: [0.6, 0.6], fountain: [3.0, 3.0], plant: [0.8, 0.8],
  decks: [2.0, 1.0], speakers: [1.0, 1.0], column: [1.0, 1.0],
  bed: [2.0, 2.0], mattress: [2.0, 1.5], counter: [2.0, 1.0], stove: [1.0, 1.0], fridge: [1.0, 1.0],
  sink: [1.0, 0.8], bookshelf: [1.5, 0.6], tv: [1.5, 0.6], bar: [3.0, 1.0], menu: [0.8, 0.6],
  chandelier: [1.5, 1.5], pendant: [0.6, 0.6], grill: [1.0, 1.0],
  // --- industry
  crates: [2.0, 1.5], pallet: [1.5, 1.2], barrel: [0.8, 0.8], forklift: [1.5, 3.0], container: [6.1, 2.5],
  spool: [1.5, 1.5], worklight: [0.8, 0.8], generator: [2.0, 1.0], tank: [3.0, 3.0], valves: [1.0, 0.6],
  pump: [1.5, 1.0], fan: [1.0, 0.6],
  // --- street
  car: [4.5, 2.0], van: [5.5, 2.2], tree: [5.0, 5.0], bush: [1.5, 1.5], planter: [1.0, 1.0],
  hydrant: [0.5, 0.5], bollard: [0.4, 0.4], lamppost: [0.5, 0.5], dumpster: [2.0, 1.5], cone: [0.5, 0.5],
  trash: [1.5, 1.0], fire: [0.8, 0.8], wreck: [4.5, 2.0], tyres: [1.0, 1.0], tent: [3.0, 3.0],
  heap: [2.0, 2.0], lantern: [0.5, 0.5], cart: [1.0, 0.8], umbrella: [2.5, 2.5],
  // --- outside
  statue: [1.0, 1.0], hedge: [2.0, 1.0], bench: [2.0, 0.8], picnic: [2.0, 1.5], signpost: [0.5, 0.5],
  swing: [3.0, 1.5], flag: [0.5, 0.5], bike: [2.0, 0.8], rocks: [1.5, 1.5], firepit: [1.5, 1.5],
  boat: [3.0, 7.0], canoe: [1.0, 5.0], buoy: [0.8, 0.8], cleat: [0.5, 0.5], haybale: [1.5, 1.0],
  tractor: [4.0, 2.5], well: [1.5, 1.5], trough: [2.0, 1.0], logs: [2.0, 1.0],
};

/** Designs that spread or hang over the floor: drawn full size, standing only in their anchor. */
const OVERHEAD: ReadonlySet<TileProp> = new Set<TileProp>(['tree', 'umbrella', 'chandelier', 'pendant']);

/** Whether a design stands on every square it covers, or only on its anchor. */
export function propStandsOnFootprint(prop: TileProp): boolean {
  return !OVERHEAD.has(prop);
}

/**
 * How far a prop is turned, in degrees clockwise, normalised to a multiple of
 * 45 in 0..315. A painted prop's angle is kept by its anchor in the floor's
 * `angles` map; absent is 0.
 */
export function normAngle(angle: number | undefined): number {
  if (angle === undefined || !Number.isFinite(angle)) return 0;
  const step = Math.round(angle / 45);
  return (((step % 8) + 8) % 8) * 45;
}

/** Whether an angle (already normalised) lies on a diagonal: 45, 135, 225 or 315. */
export function isDiagonalAngle(angle: number): boolean {
  return angle % 90 !== 0;
}

/**
 * The squares a design covers, turned: its bounding box in squares, and the
 * squares inside it it stands on, as offsets right and down from the box's
 * top-left square — the anchor.
 */
export interface PropShape {
  /** The bounding box, in squares across and down. Never less than one. */
  across: number;
  down: number;
  /** The squares covered, `[dc, dr]` from the anchor, top to bottom and left to right. */
  cells: ReadonlyArray<readonly [number, number]>;
  /** The square under the shape's centre, from the anchor. Always one of `cells`. */
  centre: readonly [number, number];
}

const shapes = new Map<string, PropShape>();

/**
 * A design's shape on a grid of `unitM` metres a square, turned `angle`
 * degrees clockwise about its centre (`normAngle`).
 *
 * Square angles keep the rounded footprint: 0 and 180 as drawn, 90 and 270
 * with across and down swapped, every square of the box covered. On a
 * diagonal the design's true size (`PROP_SIZE_M` over `unitM`) is turned
 * about its centre; the box is the square that holds it, ceil((w + d) / √2)
 * squares a side, and the squares covered are those whose centre lies inside
 * the turned rectangle — always at least the square under its centre, so even
 * a stool turned on the diagonal stands somewhere.
 *
 * The anchor is the box's top-left square at every angle, so turning a prop
 * never moves its anchor (and its selection); the shape may shift a little
 * about it instead.
 */
export function propShape(prop: TileProp, unitM: number, angle?: number): PropShape {
  const m = unitM > 0 ? unitM : 1;
  const a = normAngle(angle);
  const id = `${prop}|${m}|${a}`;
  const hit = shapes.get(id);
  if (hit !== undefined) return hit;
  const [wm, dm] = PROP_SIZE_M[prop];
  const w = wm / m;
  const d = dm / m;
  let shape: PropShape;
  if (!isDiagonalAngle(a)) {
    const across0 = Math.max(1, Math.round(w));
    const down0 = Math.max(1, Math.round(d));
    const [across, down] = a % 180 === 90 ? [down0, across0] : [across0, down0];
    const cells: Array<readonly [number, number]> = [];
    for (let r = 0; r < down; r += 1) for (let c = 0; c < across; c += 1) cells.push([c, r]);
    shape = { across, down, cells, centre: [Math.floor(across / 2), Math.floor(down / 2)] };
  } else {
    const side = Math.max(1, Math.ceil((w + d) / Math.SQRT2 - 1e-9));
    const half = side / 2;
    const rad = (a * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const centre: readonly [number, number] = [Math.floor(half), Math.floor(half)];
    const cells: Array<readonly [number, number]> = [];
    const EPS = 1e-9;
    for (let r = 0; r < side; r += 1) {
      for (let c = 0; c < side; c += 1) {
        // The square's centre from the shape's, turned back into the design's own frame.
        const x = c + 0.5 - half;
        const y = r + 0.5 - half;
        const u = x * cos + y * sin;
        const v = -x * sin + y * cos;
        const inside = Math.abs(u) <= w / 2 + EPS && Math.abs(v) <= d / 2 + EPS;
        if (inside || (c === centre[0] && r === centre[1])) cells.push([c, r]);
      }
    }
    shape = { across: side, down: side, cells, centre };
  }
  shapes.set(id, shape);
  return shape;
}

/**
 * Squares a design's bounding box spans on a grid of `unitM` metres a square,
 * turned `angle` degrees (`propShape`): across, then down. Never less than
 * one. The box reaches right and down from the anchor.
 */
export function propCells(prop: TileProp, unitM: number, angle?: number): readonly [across: number, down: number] {
  const s = propShape(prop, unitM, angle);
  return [s.across, s.down];
}

/** The squares, as `"col,row"` keys, a design anchored at `col,row` (turned `angle` degrees) covers. */
export function propCoverage(prop: TileProp, col: number, row: number, unitM: number, angle?: number): string[] {
  return propShape(prop, unitM, angle).cells.map(([dc, dr]) => `${col + dc},${row + dr}`);
}

/**
 * Every square the objects on a floor cover, mapped to the anchor that
 * covers it — the anchors map to themselves. `propOf` turns a stored object
 * value (a slot or a tile id) into its design, or undefined for an object
 * with none, which covers only its own square.
 *
 * Two objects reaching over the same square: the one whose anchor comes
 * first, top to bottom and left to right, keeps it. An anchor always keeps
 * its own square, even inside another object's reach, so nothing stored is
 * ever hidden by something drawn over it.
 *
 * `standingOnly` leaves out what hangs overhead — the squares under a
 * tree's crown or a ceiling light — for the questions a floor answers:
 * can I step here, can I see past it.
 *
 * `angles` is the floor's map of turned props, keyed by anchor: a turned prop
 * covers its turned shape (`propShape`). A prop turned on the diagonal has
 * its anchor at the corner of its box, which may be bare floor: for the
 * floor's questions (`standingOnly`) that anchor is not its square unless
 * the shape covers it, and if it hangs overhead it stands on the square
 * under its centre instead. Picking it (not `standingOnly`) still finds it
 * by its anchor, so a selection made of the anchor holds.
 */
export function objectCoverage(
  objects: Readonly<Record<string, string>> | undefined,
  unitM: number,
  propOf: (value: string) => TileProp | undefined,
  standingOnly = false,
  angles?: Readonly<Record<string, number>>,
): Map<string, string> {
  const out = new Map<string, string>();
  if (!objects) return out;
  const anchors = Object.keys(objects)
    .map((key) => {
      const [c, r] = key.split(',').map(Number) as [number, number];
      return { key, c, r };
    })
    .filter((a) => Number.isFinite(a.c) && Number.isFinite(a.r))
    .sort((a, b) => a.r - b.r || a.c - b.c);
  const diagonal = (a: { key: string }, prop: TileProp | undefined): boolean =>
    prop !== undefined && isDiagonalAngle(normAngle(angles?.[a.key]));
  for (const a of anchors) {
    if (standingOnly && diagonal(a, propOf(objects[a.key]!))) continue;
    out.set(a.key, a.key);
  }
  for (const a of anchors) {
    const prop = propOf(objects[a.key]!);
    if (prop === undefined) continue;
    const angle = angles?.[a.key];
    if (standingOnly && !propStandsOnFootprint(prop)) {
      // Overhead: its anchor alone — or, turned on the diagonal, the square under its centre.
      if (diagonal(a, prop)) {
        const [dc, dr] = propShape(prop, unitM, angle).centre;
        const k = `${a.c + dc},${a.r + dr}`;
        if (!out.has(k)) out.set(k, a.key);
      }
      continue;
    }
    for (const k of propCoverage(prop, a.c, a.r, unitM, angle)) {
      if (!out.has(k)) out.set(k, a.key);
    }
  }
  return out;
}
