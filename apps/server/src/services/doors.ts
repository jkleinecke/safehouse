/**
 * Doors, painted and traced (FR9.24) — the pure half.
 *
 * A traced door is a segment with its own `open`/`locked`. A painted door is
 * a cell in a floor's structure layer holding a door tile, and its state is
 * the floor's `doors[cell]`. Both answer the same two questions — may this
 * caller change it, and what does the scene look like once they have — and
 * this module answers them without touching the database, so the route is
 * wiring and the rules are tested.
 */
import type { Scene, SceneGeometry, SceneLevel, TileDoorState, TileLayer } from '@safehouse/contracts';
import { sceneLevels, tileById } from '@safehouse/rules';

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

/**
 * May this caller do `op` to a door in this state?
 *
 * The GM may do anything. A player may open and close, from their own
 * screen and without asking — that is the point (FR9.24) — but a locked
 * door stays shut to them, and the lock itself is the GM's alone. The
 * refusal names the lock, because "the door is locked" is what the runner
 * learns by trying it and is exactly what the table should hear.
 */
export function doorRefusal(
  gm: boolean,
  state: { locked: boolean },
  op: DoorOp,
): { code: string; message: string } | null {
  if (gm) return null;
  if (op === 'lock' || op === 'unlock') return { code: 'forbidden', message: 'only the GM locks and unlocks doors' };
  if (state.locked) return { code: 'door_locked', message: 'that door is locked' };
  return null;
}

/** The traced door `id` with `state` applied, as a whole geometry to write. */
export function withTracedDoor(
  geometry: SceneGeometry,
  id: string,
  state: { open: boolean; locked: boolean },
): SceneGeometry {
  return { ...geometry, doors: geometry.doors.map((d) => (d.id === id ? { ...d, ...state } : d)) };
}
