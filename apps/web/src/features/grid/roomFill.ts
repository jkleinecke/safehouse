/**
 * The room and area tools (FR9.2): what one rectangle drag lays down.
 *
 * Drawing a room is the thing a GM does most when building, and with a brush
 * it was the thing that took longest — a floor is a hundred cells and its
 * walls are forty more, each one a stroke that had to land in the right
 * square. Roll20 never had a tool for this at all; it has a rectangle, and the
 * GM traces dynamic-lighting lines over it afterwards by hand.
 *
 * Here a rectangle IS the room. The drag picks two corners, the floor fills
 * the inside, and — for the room tool — a wall stands on every edge cell. The
 * wall cells are painted into the structure layer on top of floor in the
 * ground layer, so erasing a wall later leaves floor rather than a hole, and
 * the walls are the set's own, which is what makes the sightline model read
 * them without anything else being drawn (`sightModelFor`).
 *
 * Pure so it can be tested on its own: the pointer decides the rectangle, the
 * page decides the request, and this decides what goes where.
 */
import type { TileRectMode } from './types.js';

/** A tile as the palette serves it — only the fields this needs. */
export interface RoomTileLike {
  id: string;
  kind: string;
  category?: string | undefined;
  footprint?: string | undefined;
  placement?: { inWall?: boolean | undefined } | undefined;
}

export interface RoomPlan {
  /** Every cell in the rectangle, `"col,row"`. The floor goes here. */
  floor: string[];
  /** The edge cells, `"col,row"`. Empty for an area fill. */
  walls: string[];
}

/**
 * Which cells get floor and which get a wall, for a rectangle whose corners
 * are INCLUSIVE and already in order.
 *
 * A room of one or two cells across has no inside — every cell is an edge —
 * and that is still a room, just a very small one: a cupboard is walls all the
 * way through. The floor still goes under it, so opening one side later shows
 * something to stand on.
 */
export function roomPlan(
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  mode: TileRectMode,
): RoomPlan {
  const floor: string[] = [];
  const walls: string[] = [];
  for (let col = c0; col <= c1; col += 1) {
    for (let row = r0; row <= r1; row += 1) {
      const key = `${col},${row}`;
      floor.push(key);
      if (mode === 'room' && (col === c0 || col === c1 || row === r0 || row === r1)) {
        walls.push(key);
      }
    }
  }
  return { floor, walls };
}

/**
 * The tiles a rectangle is built from.
 *
 * The floor is whatever ground the GM has picked; with nothing picked (Auto)
 * or a non-ground tile in hand, it is the set's FIRST ground tile, which every
 * set lists as its plain default surface. The wall is the set's first plain
 * wall — solid, full height, not a window or a door (`inWall` marks those as
 * things cut INTO a wall, which cannot be the wall itself).
 *
 * `null` for the wall means the set has no wall to offer, and the room tool
 * then honestly fills an area rather than inventing one.
 */
export function roomTileIds(
  tiles: readonly RoomTileLike[],
  selectedTileId: string | null,
): { floorId: string | null; wallId: string | null } {
  const category = (t: RoomTileLike) => t.category ?? (t.kind === 'floor' ? 'ground' : t.kind);
  const grounds = tiles.filter((t) => category(t) === 'ground');
  const picked = grounds.find((t) => t.id === selectedTileId);
  const floorId = picked?.id ?? grounds[0]?.id ?? null;
  const wall = tiles.find(
    (t) =>
      t.kind === 'wall' &&
      category(t) === 'building' &&
      t.footprint === 'wall' &&
      t.placement?.inWall !== true,
  );
  return { floorId, wallId: wall?.id ?? null };
}
