/**
 * Which tileset a scene is drawn in, as three rules the UI cannot get wrong
 * by itself.
 *
 * They were part of the Tiles panel until the set moved onto the mode bar
 * (2026-09-19); they are pure, they are the part with the sharp edges, and
 * they now have two callers.
 */
import type { Scene } from '@safehouse/contracts';
import type { TilesetDef } from './api.js';

/**
 * Which set the palette shows, and whether the STORE is holding a different
 * answer than the one on screen.
 *
 * The two must not diverge. This panel displayed `find(storeId) ?? tilesets[0]`
 * while the canvas painted from `store.tilesetId` (`GridPage`'s `onTilePaint`),
 * so an id matching no served set left the GM watching "Docklands warehouse"
 * sit selected while every stroke came back 400 `unknown_tileset` and vanished
 * without a word — and "Clear floor", which read the displayed set, aimed
 * somewhere else again. `adopt` is what the store has to be told.
 */
export function resolveTileset(
  tilesets: readonly TilesetDef[],
  storeId: string,
): { tileset: TilesetDef | undefined; adopt: string | null } {
  const tileset = tilesets.find((t) => t.id === storeId) ?? tilesets[0];
  return { tileset, adopt: tileset && tileset.id !== storeId ? tileset.id : null };
}

/**
 * The set a painted scene should open on, or null to leave the GM's choice
 * alone. A scene already painted from another set opens on THAT set: the next
 * stroke should extend what is on the canvas, and since switching sets
 * REPLACES the layer server-side, a wrong default is destructive.
 */
export function paintedTilesetToAdopt(
  tilesets: readonly TilesetDef[],
  storeId: string,
  paintedId: string | undefined,
): string | null {
  if (!paintedId || paintedId === storeId) return null;
  return tilesets.some((t) => t.id === paintedId) ? paintedId : null;
}

/**
 * How many squares this scene has anything painted in.
 *
 * Counts the UNION of the three layers, not their sum: a square holding grass,
 * a wall and a chair is one painted square, and reporting three would make
 * "12 cells painted" mean nothing a GM could check against the canvas.
 *
 * `cells` is the drained legacy field — included so an un-migrated scene still
 * counts, and harmless once the server has rewritten it.
 */
export function paintedCells(tiles: Scene['tiles']): number {
  if (!tiles) return 0;
  const keys = new Set<string>();
  for (const map of [tiles.ground, tiles.structure, tiles.object, tiles.cells]) {
    for (const key of Object.keys(map ?? {})) keys.add(key);
  }
  return keys.size;
}
