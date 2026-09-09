/**
 * Build the sight model a scene implies: painted tiles plus traced geometry.
 *
 * The GM should never have to say the same thing twice. A wall painted from a
 * tileset and a wall traced with the wall tool are both walls, so both end up
 * here and the sightline does not care which the GM reached for. That is the
 * whole point of tiles carrying `height` — the floor the GM built IS the
 * collision map, with no second pass tracing geometry over their own art.
 */
import type { Point } from '@safehouse/contracts';
import { tilesetById } from '../tilesets/catalogue.js';
import { levelTiles, migrateTileLayer, type LayeredTiles } from '../tilesets/layers.js';
import { givesCover, parseCellKey, stopsMovement, stopsSight } from '../tilesets/types.js';
import type { SightCell, SightModel, SightSegment } from './los.js';

/** The parts of a scene this needs — kept structural so callers stay free. */
export interface SightSceneInput {
  tiles?: LayeredTiles | undefined;
  /** Floors above the ground one. Sight is computed on ONE of them. */
  levels?: readonly { id: string; name: string; tiles?: LayeredTiles | undefined }[] | undefined;
  geometry?: {
    walls?: readonly { id: string; a: Point; b: Point }[];
    doors?: readonly { id: string; a: Point; b: Point; open?: boolean }[];
  };
}

/**
 * Compose the model. Unknown tileset or unknown tile ids are skipped rather
 * than guessed at: a scene painted from a set this build does not have should
 * lose its *cover*, not become an impassable slab.
 */
export function sightModelFor(scene: SightSceneInput, level = 0): SightModel {
  const cells = new Map<string, SightCell>();

  // ONE floor's tiles. A wall on the catwalk must not block a shot across
  // the warehouse floor beneath it, and a scene with no levels resolves to
  // its ground floor, which is every scene ever painted.
  const layer = levelTiles(scene, level);
  if (layer) {
    const set = tilesetById(layer.tilesetId);
    if (set !== null) {
      const byId = new Map(set.tiles.map((t) => [t.id, t]));
      // Read through the migration so a scene painted before layers existed
      // is seen exactly as a migrated one is. Sight must not depend on when
      // the map happened to be drawn.
      const layers = migrateTileLayer(layer);

      // EVERY layer, merged hardest-wins per cell. A wall in the structure
      // layer and a chair in the object layer occupy the same square, and the
      // square is as blocked as the most blocking thing standing in it —
      // otherwise a desk pushed against a wall would open a hole in it.
      for (const map of [layers.ground, layers.structure, layers.object]) {
        for (const [key, tileId] of Object.entries(map)) {
          if (parseCellKey(key) === null) continue;
          const tile = byId.get(tileId);
          if (tile === undefined) continue;
          // An OPEN painted door is a doorway (FR9.24): sight and bodies pass.
          // The frame still stands, so its height is kept for the renderer.
          const openDoor =
            map === layers.structure && tile.kind === 'door' && layers.doors?.[key]?.open === true;
          const blocksSight = !openDoor && stopsSight(tile);
          const cover = !openDoor && givesCover(tile);
          const blocksMovement = !openDoor && stopsMovement(tile);
          // An open floor tile is not worth an entry; the map stays sparse.
          const height = tile.height ?? 0;
          if (!blocksSight && !cover && !blocksMovement && height <= 0) continue;
          const prev = cells.get(key);
          cells.set(key, {
            blocksSight: blocksSight || (prev?.blocksSight ?? false),
            givesCover: cover || (prev?.givesCover ?? false),
            blocksMovement: blocksMovement || (prev?.blocksMovement ?? false),
            // Tallest wins, for the same reason blocking does: a chair pushed
            // against a wall must not shorten the wall.
            height: Math.max(height, prev?.height ?? 0),
          });
        }
      }
    }
  }

  const segments: SightSegment[] = [];
  for (const wall of scene.geometry?.walls ?? []) {
    segments.push({ id: wall.id, a: wall.a, b: wall.b, blocksSight: true });
  }
  for (const door of scene.geometry?.doors ?? []) {
    // An open door is a hole in the wall, which is the entire reason doors are
    // a separate kind of geometry rather than a wall with a note on it.
    if (door.open === true) continue;
    segments.push({ id: door.id, a: door.a, b: door.b, blocksSight: true });
  }

  return { cells, segments };
}
