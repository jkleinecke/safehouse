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
export interface LayeredTiles {
  tilesetId: string;
  cells?: Record<string, string> | undefined;
  ground?: Record<string, string> | undefined;
  structure?: Record<string, string> | undefined;
  object?: Record<string, string> | undefined;
}

export interface ResolvedTileLayers {
  tilesetId: string;
  ground: Record<string, string>;
  structure: Record<string, string>;
  object: Record<string, string>;
}

/**
 * Fold any legacy `cells` into the three layers.
 *
 * Already-layered data wins: a cell present in both is one that has been
 * repainted since the upgrade, and the newer answer is the layered one.
 */
export function migrateTileLayer(tiles: LayeredTiles): ResolvedTileLayers {
  const out: ResolvedTileLayers = {
    tilesetId: tiles.tilesetId,
    ground: { ...(tiles.ground ?? {}) },
    structure: { ...(tiles.structure ?? {}) },
    object: { ...(tiles.object ?? {}) },
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
