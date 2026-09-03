/**
 * The bridge between a click on the canvas and `pickTile` in the rules.
 *
 * The engine is pure and lives in `@safehouse/rules` so the server could reach
 * the same answer; this is the part that reads it out of the scene the browser
 * is holding. Kept out of `GridPage` because the interesting behaviour — what
 * the square already contains, which neighbours count as walls — is worth
 * testing without a canvas.
 */
import type { Scene } from '@safehouse/contracts';
import { pickTile, type TileCategory } from '@safehouse/rules';
import type { TilesetDef } from './api.js';

/** Everything a click needs to become a tile id. */
export interface AutoPlaceInput {
  scene: Scene;
  tilesets: readonly TilesetDef[];
  tilesetId: string;
  category: TileCategory;
  /** The GM's pinned tile, or null for Auto. */
  tileId: string | null;
  col: number;
  row: number;
}

/**
 * Which cells count as "a wall is here" when scoring.
 *
 * The STRUCTURE layer only. A desk is not a wall to put a bench against, and
 * counting the object layer would make a room full of furniture think it was
 * full of walls — every chair would then attract another chair.
 */
function wallAt(scene: Scene, col: number, row: number): boolean {
  return scene.tiles?.structure?.[`${col},${row}`] !== undefined;
}

/**
 * The tile a single click should place, or null when this tool has nothing to
 * offer for this square.
 *
 * Null is a real answer, not a failure: clicking Decor on a neon-lit floor
 * that no prop declares is better answered with nothing than with a fire
 * hydrant standing in a puddle of light.
 */
export function autoTileFor(input: AutoPlaceInput): { tileId: string } | null {
  const set = input.tilesets.find((t) => t.id === input.tilesetId);
  if (set === undefined) return null;

  const key = `${input.col},${input.row}`;
  const tiles = input.scene.tiles;
  const here = {
    ground: tiles?.ground?.[key],
    structure: tiles?.structure?.[key],
    object: tiles?.object?.[key],
  };

  const result = pickTile(
    input.category,
    {
      // The served catalogue is the same data the rules package exports; the
      // cast is the wire crossing, not a type being papered over.
      tileset: set as unknown as Parameters<typeof pickTile>[1]['tileset'],
      here,
      wallAdjacent:
        wallAt(input.scene, input.col - 1, input.row) ||
        wallAt(input.scene, input.col + 1, input.row) ||
        wallAt(input.scene, input.col, input.row - 1) ||
        wallAt(input.scene, input.col, input.row + 1),
      col: input.col,
      row: input.row,
    },
    input.tileId ?? undefined,
  );

  return result === null ? null : { tileId: result.tileId };
}
