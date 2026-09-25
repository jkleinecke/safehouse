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

/** Squares a design covers on a grid of `unitM` metres a square: across, then down. Never less than one. */
export function propCells(prop: TileProp, unitM: number): readonly [across: number, down: number] {
  const [w, d] = PROP_SIZE_M[prop];
  const m = unitM > 0 ? unitM : 1;
  return [Math.max(1, Math.round(w / m)), Math.max(1, Math.round(d / m))];
}

/** The squares, as `"col,row"` keys, a design anchored at `col,row` covers. */
export function propCoverage(prop: TileProp, col: number, row: number, unitM: number): string[] {
  const [w, d] = propCells(prop, unitM);
  const out: string[] = [];
  for (let r = row; r < row + d; r += 1) for (let c = col; c < col + w; c += 1) out.push(`${c},${r}`);
  return out;
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
 */
export function objectCoverage(
  objects: Readonly<Record<string, string>> | undefined,
  unitM: number,
  propOf: (value: string) => TileProp | undefined,
  standingOnly = false,
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
  for (const a of anchors) out.set(a.key, a.key);
  for (const a of anchors) {
    const prop = propOf(objects[a.key]!);
    if (prop === undefined) continue;
    if (standingOnly && !propStandsOnFootprint(prop)) continue;
    for (const k of propCoverage(prop, a.c, a.r, unitM)) {
      if (!out.has(k)) out.set(k, a.key);
    }
  }
  return out;
}
