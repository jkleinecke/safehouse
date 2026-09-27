/**
 * Doors, painted and traced (FR9.24) — the pure half.
 *
 * A traced door is a segment with its own `open`/`locked`. A painted door is
 * a cell in a floor's structure layer holding a door tile, and its state is
 * the floor's `doors[cell]`. Both answer the same two questions — may this
 * caller change it, and what does the scene look like once they have — and
 * this module answers them without touching the database, so the route is
 * wiring and the rules are tested. "May this caller" includes where their
 * runner stands: a player works a door only from next to it (`doorRefusal`,
 * `runnersReach`; the geometry is the rules', movement/reach.ts, which the
 * map asks too before it offers a player a door).
 */
import type { Scene, SceneGeometry, SceneLevel, TileDoorState, TileLayer } from '@safehouse/contracts';
import { reachesDoor, sceneLevels, tileById, type DoorPlace } from '@safehouse/rules';

export type DoorOp = 'open' | 'close' | 'lock' | 'unlock';

/** A painted door: which floor, which cell. */
export interface TileDoorRef {
  level: number;
  cell: string;
}

const SHUT: TileDoorState = { open: false, locked: false };

/**
 * The state of the painted door at `ref`, or null when that cell holds no
 * door tile — a door state for a cell that is a wall would be a ghost.
 */
export function tileDoorState(scene: Scene, ref: TileDoorRef): TileDoorState | null {
  const floor = sceneLevels(scene)[ref.level];
  if (!floor?.tiles) return null;
  const tileId = floor.tiles.structure?.[ref.cell];
  if (tileId === undefined) return null;
  const tile = tileById(floor.tiles.tilesetId, tileId);
  if (tile === null || tile.kind !== 'door') return null;
  const state = floor.tiles.doors?.[ref.cell];
  return { open: state?.open ?? SHUT.open, locked: state?.locked ?? SHUT.locked };
}

/**
 * The scene write that sets a painted door's state: the ground floor lives in
 * `tiles`, every other floor in `levels`, and the door map rides with its
 * floor. Returns the slice of `SceneWriteInput` to send.
 */
export function withTileDoor(
  scene: Scene,
  ref: TileDoorRef,
  state: TileDoorState,
): { tiles: TileLayer } | { levels: SceneLevel[] } | null {
  if (ref.level === 0) {
    if (!scene.tiles) return null;
    return { tiles: { ...scene.tiles, doors: { ...(scene.tiles.doors ?? {}), [ref.cell]: state } } };
  }
  const index = ref.level - 1;
  const level = scene.levels[index];
  if (!level?.tiles) return null;
  const levels = scene.levels.map((l, i) =>
    i === index && l.tiles
      ? { ...l, tiles: { ...l.tiles, doors: { ...(l.tiles.doors ?? {}), [ref.cell]: state } } }
      : l,
  );
  return { levels };
}

/** What `op` does to a door's state. */
export function applyDoorOp(state: { open: boolean; locked: boolean }, op: DoorOp): { open: boolean; locked: boolean } {
  const { open, locked } = state;
  switch (op) {
    case 'open':
      return { open: true, locked };
    case 'close':
      return { open: false, locked };
    case 'lock':
      return { open, locked: true };
    case 'unlock':
      return { open, locked: false };
  }
}

/** Why a door did not move, and the HTTP status that says it. */
export interface DoorRefusal {
  status: 403 | 404;
  code: string;
  message: string;
}

/**
 * What a player is told when no runner of theirs stands next to the door
 * (the GM's rule, 2026-09-27: `reachesDoor`, rules movement/reach.ts).
 */
export const DOOR_OUT_OF_REACH = {
  status: 403,
  code: 'door_out_of_reach',
  message: 'Your runner needs to be next to that door',
} as const satisfies DoorRefusal;

/**
 * May this caller do `op` to this door?
 *
 * `door` is the door's state, or null when there is no door by that name.
 * `nextTo` is whether a runner the caller controls stands next to it
 * (`runnersReach`); false when there is no door to stand next to.
 *
 * The GM may do anything, to any door, from anywhere; only a door that is
 * not there is refused them. A player may open and close, from their own
 * screen and without asking — that is the point (FR9.24) — but only with
 * their runner standing next to the door (THE GM'S RULE, 2026-09-27: "a
 * player can open or close a door only when their runner is standing next
 * to it; the GM can from anywhere"). A locked door stays shut to them, and
 * the lock itself is the GM's alone.
 *
 * The ORDER is the secrecy. Whether a door is locked is not on a player's
 * wire (`sceneForViewer`); a runner learns it by trying the handle, and only
 * a runner at the handle can try it. So, for a player:
 * 1. Lock or unlock is refused outright, whatever the door and wherever the
 *    runner: that answer says nothing about any door.
 * 2. Not next to it is the next answer, and the same one whether the door is
 *    locked, unlocked, open, shut or not there at all. A player probing the
 *    doors across the map from their chair hears only that they are too far
 *    away, never which of them is locked.
 * 3. Only then, a runner at the handle: a cell with no door painted in it is
 *    a 404 (the map already shows them what is painted there), and a locked
 *    door they try to OPEN is refused by name — "that door is locked" is
 *    what the runner learns by trying it and is exactly what the table
 *    should hear.
 * Shutting a door is never refused for its lock: a locked door can be
 * pulled to, the latch does not care. Were it refused, "close" on a door the
 * GM left standing open would tell the player it was locked. And opening a
 * door that already stands open is no refusal either, locked or not (it
 * stays open): the lock of a door standing open is not the runner's to
 * learn by pushing on it.
 */
export function doorRefusal(
  gm: boolean,
  door: { open: boolean; locked: boolean } | null,
  op: DoorOp,
  nextTo: boolean,
): DoorRefusal | null {
  if (gm) return door === null ? { status: 404, code: 'not_found', message: 'no such door' } : null;
  if (op === 'lock' || op === 'unlock') {
    return { status: 403, code: 'forbidden', message: 'only the GM locks and unlocks doors' };
  }
  if (!nextTo) return DOOR_OUT_OF_REACH;
  if (door === null) return { status: 404, code: 'not_found', message: 'no such door' };
  if (op === 'open' && door.locked && !door.open) return { status: 403, code: 'door_locked', message: 'that door is locked' };
  return null;
}

/**
 * Does any of `runners` stand next to the door at `place` (`reachesDoor`)?
 * `runners` are the tokens the caller controls on the door's scene, each
 * with its floor and size; `place` null (no such door) is next to nobody.
 */
export function runnersReach(
  runners: readonly { x: number; y: number; level: number; size: number }[],
  place: DoorPlace | null,
): boolean {
  return place !== null && runners.some((r) => reachesDoor(r, place));
}

/** The traced door `id` with `state` applied, as a whole geometry to write. */
export function withTracedDoor(
  geometry: SceneGeometry,
  id: string,
  state: { open: boolean; locked: boolean },
): SceneGeometry {
  return { ...geometry, doors: geometry.doors.map((d) => (d.id === id ? { ...d, ...state } : d)) };
}
