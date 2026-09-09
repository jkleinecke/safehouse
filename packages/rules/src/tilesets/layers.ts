/**
 * Moving a scene from one tile per cell to three layers.
 *
 * Every scene painted before layers existed holds its tiles in a single flat
 * `cells` map. Those scenes have to keep opening — a GM's warehouse is not
 * disposable — so the ids are sorted into the layer each tile belongs to on
 * the way out, using the catalogue as the authority.
 *
 * The migration is READ-side and idempotent. Nothing writes `cells` any more,
 * so a scene upgrades itself the first time it is saved and the legacy field
 * drains to empty on its own, with no migration script and no flag day.
 *
 * An id the catalogue no longer knows is DROPPED rather than guessed at. The
 * alternative is putting a tile on a layer it does not belong to, and a wall
 * that lands in the decoration layer is worse than a wall that is gone: it is
 * a wall the GM can see and line of sight cannot.
 */
import { tilesetById } from './catalogue.js';
import { layerOf } from './types.js';

/** The layered shape, structural so contracts stays the owner of the schema. */
/** Open/locked state of a painted door, keyed by its cell (FR9.24). */
export interface TileDoorStateLike {
  open?: boolean | undefined;
  locked?: boolean | undefined;
}

export interface LayeredTiles {
  tilesetId: string;
  cells?: Record<string, string> | undefined;
  ground?: Record<string, string> | undefined;
  structure?: Record<string, string> | undefined;
  object?: Record<string, string> | undefined;
  doors?: Record<string, TileDoorStateLike> | undefined;
}

/** A painted door's state once resolved: both switches answered. */
export interface TileDoorState {
  open: boolean;
  locked: boolean;
}

export interface ResolvedTileLayers {
  tilesetId: string;
  ground: Record<string, string>;
  structure: Record<string, string>;
  object: Record<string, string>;
  doors?: Record<string, TileDoorState> | undefined;
}

/**
 * Fold any legacy `cells` into the three layers.
 *
 * Already-layered data wins: a cell present in both is one that has been
 * repainted since the upgrade, and the newer answer is the layered one.
 */
function resolveDoors(doors: Record<string, TileDoorStateLike>): Record<string, TileDoorState> {
  const out: Record<string, TileDoorState> = {};
  for (const [cell, d] of Object.entries(doors)) out[cell] = { open: d.open === true, locked: d.locked === true };
  return out;
}

export function migrateTileLayer(tiles: LayeredTiles): ResolvedTileLayers {
  const out: ResolvedTileLayers = {
    tilesetId: tiles.tilesetId,
    ground: { ...(tiles.ground ?? {}) },
    structure: { ...(tiles.structure ?? {}) },
    object: { ...(tiles.object ?? {}) },
    // Door state rides along, keyed by cell rather than by layer; a switch
    // left unsaid is off.
    ...(tiles.doors !== undefined ? { doors: resolveDoors(tiles.doors) } : {}),
  };

  const legacy = tiles.cells;
  if (legacy === undefined) return out;
  const set = tilesetById(tiles.tilesetId);
  if (set === null) return out; // unknown catalogue — see the header
  const byId = new Map(set.tiles.map((t) => [t.id, t]));

  for (const [key, tileId] of Object.entries(legacy)) {
    const tile = byId.get(tileId);
    if (tile === undefined) continue;
    const layer = layerOf(tile);
    if (out[layer][key] === undefined) out[layer][key] = tileId;
  }
  return out;
}

/** Everything in one cell, across the three layers. */
export function cellContents(
  layers: ResolvedTileLayers,
  key: string,
): { ground?: string; structure?: string; object?: string } {
  const out: { ground?: string; structure?: string; object?: string } = {};
  const g = layers.ground[key];
  const s = layers.structure[key];
  const o = layers.object[key];
  if (g !== undefined) out.ground = g;
  if (s !== undefined) out.structure = s;
  if (o !== undefined) out.object = o;
  return out;
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

/** One floor, resolved: always has an id, a name and a tile layer to draw. */
export interface ResolvedLevel {
  id: string;
  name: string;
  tiles: LayeredTiles | undefined;
}

/** What a scene needs to expose for its floors to be read. */
export interface LevelledScene {
  tiles?: LayeredTiles | undefined;
  levels?: readonly { id: string; name: string; tiles?: LayeredTiles | undefined }[] | undefined;
}

/** The name a scene's ground floor gets when nobody has named it. */
export const GROUND_LEVEL_NAME = 'Ground';

/**
 * Every floor of a scene, ground first.
 *
 * `scene.tiles` IS level 0. Keeping it there rather than folding it into the
 * array means every scene ever painted is already a one-level scene with no
 * migration at all, and the overwhelmingly common case — a building with one
 * floor — costs nothing extra to store or reason about.
 *
 * Always returns at least one entry, so callers never have to handle "a scene
 * with no floors", which is not a thing a map can be.
 */
export function sceneLevels(scene: LevelledScene): ResolvedLevel[] {
  const ground: ResolvedLevel = {
    id: 'ground',
    name: GROUND_LEVEL_NAME,
    tiles: scene.tiles,
  };
  return [ground, ...(scene.levels ?? []).map((l) => ({ id: l.id, name: l.name, tiles: l.tiles }))];
}

/**
 * The tiles on one floor, clamped to the floors that exist.
 *
 * Clamped rather than throwing: a token left on floor 3 of a scene the GM has
 * since cut back to two is a data state that WILL happen, and dropping that
 * token off the map is worse than standing it on the top floor.
 */
export function levelTiles(scene: LevelledScene, level: number): LayeredTiles | undefined {
  const all = sceneLevels(scene);
  const index = Math.min(Math.max(0, Math.floor(level)), all.length - 1);
  return all[index]?.tiles;
}

/**
 * Where the stairs in this cell lead, or null if there are none.
 *
 * This is what makes a painted stairwell a CONNECTION rather than a drawing of
 * one. The tile says which way it goes; this checks the floor it points at
 * actually exists, so a flight of stairs the GM painted before adding the
 * storey above leads nowhere rather than off the top of the building.
 */
export function stairTarget(
  scene: LevelledScene,
  level: number,
  key: string,
  tileFor: (tilesetId: string, tileId: string) => { connects?: 'up' | 'down' } | null,
): number | null {
  const floors = sceneLevels(scene);
  const here = floors[level]?.tiles;
  if (here === undefined) return null;

  const tileId = here.structure?.[key] ?? here.cells?.[key];
  if (tileId === undefined) return null;
  const tile = tileFor(here.tilesetId, tileId);
  if (tile?.connects === undefined) return null;

  const target = tile.connects === 'up' ? level + 1 : level - 1;
  // A storey that does not exist is not somewhere a runner can go.
  return target >= 0 && target < floors.length ? target : null;
}
