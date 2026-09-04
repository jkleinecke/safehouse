/**
 * Taking the stairs (FR9.22).
 *
 * A painted flight is already a connection — `stairTarget` in the rules reads
 * `connects` and checks the floor it points at exists. This is the part that
 * lets a GM actually walk a token up it.
 *
 * ## Why the view follows the token
 *
 * Changing a token's level without changing the floor on screen makes it
 * VANISH: one floor is drawn at a time, so a runner who goes upstairs while
 * the GM is looking at the ground floor simply disappears, and the GM's only
 * clue is a token that stopped existing. So taking the stairs moves the token
 * AND the view together. That is one action to the person doing it, and it
 * should be one action here.
 *
 * ## Why the token keeps its square
 *
 * A stairwell occupies the same footprint on both floors — that is what makes
 * it a stairwell rather than two unrelated flights. Moving the token in x/y as
 * well would be inventing a destination the map does not describe.
 */
import { useMemo } from 'react';
import type { Scene, Token } from '@safehouse/contracts';
import { sceneLevels, stairTarget } from '@safehouse/rules';
import type { TilesetDef } from './api.js';

export interface StairOffer {
  /** The floor these stairs lead to. */
  target: number;
  /** Its name, for the button — "up to Catwalk" beats "up to level 1". */
  targetName: string;
  /** Which way, for the wording. */
  direction: 'up' | 'down';
}

/**
 * The stairs under this token, or null when it is not standing on any.
 *
 * A PURE function with the hook below as a thin wrapper, so the interesting
 * behaviour is testable without a renderer — the same reason `tileDrawInput`
 * and `autoTileFor` are functions rather than living inside components.
 *
 * Null covers three different situations that all mean the same thing to the
 * caller: no token selected, the token is not on stairs, or the stairs lead to
 * a floor that does not exist yet. The last one is why a GM can sketch a
 * stairwell before building the storey above without the button lying to them.
 */
export function stairOfferFor(
  scene: Scene | null | undefined,
  token: Token | undefined,
  tilesets: readonly TilesetDef[] | undefined,
): StairOffer | null {
  if (!scene || token === undefined || tilesets === undefined) return null;

  // The token's OWN floor. A runner on the catwalk standing where the ground
  // floor happens to have an up-flight must be offered the catwalk's stairs,
  // not the ones beneath their feet.
  const level = token.level ?? 0;
  const key = `${Math.floor(token.x)},${Math.floor(token.y)}`;
  const target = stairTarget(scene, level, key, (tilesetId, tileId) => {
    const set = tilesets.find((t) => t.id === tilesetId);
    return set?.tiles.find((t) => t.id === tileId) ?? null;
  });
  if (target === null) return null;

  const floors = sceneLevels(scene);
  return {
    target,
    // The floor's NAME: "up to Catwalk" is something a GM can picture, and
    // "up to level 1" is not.
    targetName: floors[target]?.name ?? `Level ${target}`,
    direction: target > level ? 'up' : 'down',
  };
}

/** Memoised for the canvas, which re-renders on every token drag frame. */
export function useStairOffer(
  scene: Scene | null | undefined,
  token: Token | undefined,
  tilesets: readonly TilesetDef[] | undefined,
): StairOffer | null {
  return useMemo(() => stairOfferFor(scene, token, tilesets), [scene, token, tilesets]);
}
