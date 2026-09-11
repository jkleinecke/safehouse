/**
 * Re-skin a painted floor from one tileset to another (FR9.2, asked for at
 * the table).
 *
 * Switching sets used to mean the next stroke replaced the floor, which is
 * the server's rule — one set per floor — read as a threat. What a GM means
 * by "switch to Sprawl" is that the map they built should now be drawn in
 * Sprawl: every square keeps what it IS — a floor, a wall, a window, a door,
 * a stair, a thing standing on the floor — and takes the new set's version
 * of it. The same id wins when the new set has it (`wall` is in every set);
 * otherwise a floor takes the set's first floor, a piece of building the
 * nearest by kind, an opening by whether sight passes it, a stair by which
 * way it leads, and a prop the thing that best fits the NEW ground under it
 * — the same ranking a click would use. A set with nothing of that kind
 * drops the square, and says how many it dropped.
 */
import { ranked } from './place.js';
import type { Tile, Tileset } from './types.js';
import { categoryOf } from './types.js';

/** One floor's three layers, as the scene stores them. */
export interface RestyleInput {
  ground?: Record<string, string> | undefined;
  structure?: Record<string, string> | undefined;
  object?: Record<string, string> | undefined;
}

export interface RestyleResult {
  ground: Record<string, string>;
  structure: Record<string, string>;
  object: Record<string, string>;
  /** Squares the new set had nothing for. */
  dropped: number;
}

interface Where {
  ground?: string | undefined;
  wallAdjacent: boolean;
  col: number;
  row: number;
}

/** The new set's version of one tile, or null when it has nothing of the kind. */
export function restyleTile(from: Tileset, to: Tileset, tileId: string, where: Where): Tile | null {
  const src = from.tiles.find((t) => t.id === tileId);
  if (src === undefined) return null;
  const cat = categoryOf(src);
  const same = to.tiles.find((t) => t.id === tileId && categoryOf(t) === cat);
  if (same !== undefined) return same;

  const pool = to.tiles.filter((t) => categoryOf(t) === cat);
  switch (cat) {
    case 'ground':
      return pool[0] ?? null;
    case 'building': {
      const inWall = src.placement?.inWall === true;
      const seeThrough = src.blocksSight === false;
      return (
        pool.find(
          (t) =>
            t.kind === src.kind && (t.placement?.inWall === true) === inWall && (t.blocksSight === false) === seeThrough,
        ) ??
        pool.find((t) => t.kind === src.kind && (t.placement?.inWall === true) === inWall) ??
        pool.find((t) => (t.placement?.inWall === true) === inWall) ??
        pool[0] ??
        null
      );
    }
    case 'stairs':
      return pool.find((t) => t.connects === src.connects) ?? pool[0] ?? null;
    default: {
      // Interior and decoration: what fits the new ground here, best first.
      const list = ranked(pool, {
        tileset: to,
        here: { ground: where.ground },
        wallAdjacent: where.wallAdjacent,
        col: where.col,
        row: where.row,
      });
      return list[0] ?? null;
    }
  }
}

function parseKey(key: string): { col: number; row: number } {
  const [c, r] = key.split(',').map(Number);
  return { col: c ?? 0, row: r ?? 0 };
}

/** Every layer of a floor, redrawn in the new set. */
export function restyleLayers(from: Tileset, to: Tileset, layers: RestyleInput): RestyleResult {
  const ground: Record<string, string> = {};
  const structure: Record<string, string> = {};
  const object: Record<string, string> = {};
  let dropped = 0;
  const none: Where = { wallAdjacent: false, col: 0, row: 0 };

  for (const [key, id] of Object.entries(layers.ground ?? {})) {
    const t = restyleTile(from, to, id, { ...none, ...parseKey(key) });
    if (t) ground[key] = t.id;
    else dropped += 1;
  }
  for (const [key, id] of Object.entries(layers.structure ?? {})) {
    const t = restyleTile(from, to, id, { ...none, ...parseKey(key) });
    if (t) structure[key] = t.id;
    else dropped += 1;
  }
  // Props read the NEW floor and the NEW walls, so a bench still backs onto
  // the wall it backed onto and a hydrant lands on the pavement it lands on.
  const wallAt = (col: number, row: number) => structure[`${col},${row}`] !== undefined;
  for (const [key, id] of Object.entries(layers.object ?? {})) {
    const { col, row } = parseKey(key);
    const t = restyleTile(from, to, id, {
      ground: ground[key],
      wallAdjacent: wallAt(col - 1, row) || wallAt(col + 1, row) || wallAt(col, row - 1) || wallAt(col, row + 1),
      col,
      row,
    });
    if (t) object[key] = t.id;
    else dropped += 1;
  }
  return { ground, structure, object, dropped };
}
