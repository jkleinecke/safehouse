/**
 * How lit each square of a floor is, for the GM's light-map view
 * (docs/VISION.md §4.1).
 *
 * Computed here in React land, like the shroud and the camera cones, and
 * handed to the stage as a finished map: the stage draws, it does not think.
 * Recomputed when something that moves light changes — a wall, a door, a
 * painted lamp, a GM light, the scene's ambient row, or a token carrying a
 * torch — and never per frame. A token without a light is not in the key:
 * a body does not block light in this model, so shuffling one is free.
 *
 * Pass a null scene to switch it off. The view is a GM toggle, off by
 * default, and there is no reason to trace forty lamps for a map nobody is
 * looking at.
 */
import { useMemo } from 'react';
import type { Scene, Token } from '@safehouse/contracts';
import { lightMapFor, type LightMap } from '@safehouse/rules';

export function useLightMap(
  scene: Scene | null | undefined,
  level: number,
  tokens: readonly Token[],
): LightMap | null {
  // Only the tokens that carry a light, and only what about them moves it.
  const carried = tokens.filter((t) => t.light);
  const tokenKey = JSON.stringify(
    carried.map((t) => [t.id, t.x, t.y, t.level ?? 0, t.rotation, t.light]),
  );
  return useMemo(() => {
    if (!scene) return null;
    return lightMapFor(scene, level, {
      tokens: carried,
      cols: scene.grid.cols,
      rows: scene.grid.rows,
    });
    // Stringified because these are fresh objects on every fetch and identity
    // would defeat the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scene?.id,
    level,
    // The WHOLE tile record, not its structure and object layers alone: the
    // ground floor's painted doors and lamps live in it too (`doors`, `ground`),
    // and a door swung open lets a room's light out.
    JSON.stringify(scene?.tiles ?? null),
    // Upper floors carry their own tiles, doors and lamps.
    JSON.stringify(scene?.levels ?? []),
    JSON.stringify(scene?.geometry.walls ?? []),
    JSON.stringify(scene?.geometry.doors ?? []),
    JSON.stringify(scene?.geometry.lights ?? []),
    // The ambient row every lamp lifts from.
    JSON.stringify(scene?.environment ?? null),
    scene?.grid.cols,
    scene?.grid.rows,
    // Metres a square: a lamp's reach in squares, and how big furniture is.
    scene?.grid.unitM,
    tokenKey,
  ]);
}
