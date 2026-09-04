/**
 * Taking the stairs (FR9.22).
 *
 * The offer has to be honest in both directions: it must appear when a token
 * really is standing on a flight that goes somewhere, and it must NOT appear
 * for stairs the GM sketched before building the floor above — a button that
 * walks a runner onto a storey that does not exist is worse than no button.
 */
import { describe, expect, it } from 'vitest';
import type { Scene, Token } from '@safehouse/contracts';
import { TILESETS } from '@safehouse/rules';
import type { TilesetDef } from './api.js';
import { stairOfferFor } from './useStairs.js';

const SERVED = TILESETS as unknown as TilesetDef[];

/** The pure half; the hook is a `useMemo` wrapper around exactly this. */
const offer = (scene: Scene | null, token: Token | undefined) =>
  stairOfferFor(scene, token, SERVED);

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Stairwell',
    state: 'active',
    grid: { unitM: 1, cols: 12, rows: 9, offset: { x: 0, y: 0 }, projection: 'iso' as const },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    fog: { regions: [], revealed: [], revealedShapes: [] },
    levels: [],
    mapAttachmentIds: [],
    tiles: {
      tilesetId: 'docklands',
      cells: {},
      ground: {},
      structure: { '8,4': 'stairup' },
      object: {},
    },
    ...over,
  } as Scene;
}

const token = (over: Partial<Token> = {}): Token =>
  ({
    id: 't1',
    sceneId: 's1',
    source: 'character',
    sourceId: 'c1',
    name: 'Torque',
    // Tokens sit on cell centres, so 8.5/4.5 is the square 8,4.
    x: 8.5,
    y: 4.5,
    level: 0,
    size: 1,
    rotation: 0,
    hidden: false,
    barsVisibility: 'public',
    ...over,
  }) as Token;

const twoStorey = () =>
  scene({
    levels: [
      {
        id: 'catwalk',
        name: 'Catwalk',
        tiles: {
          tilesetId: 'docklands',
          cells: {},
          ground: {},
          structure: { '8,4': 'stairdown' },
          object: {},
        },
      },
    ],
  });

describe('useStairOffer', () => {
  it('offers the way up when a token stands on an up-flight', () => {
    const got = offer(twoStorey(), token());
    expect(got).toEqual({ target: 1, targetName: 'Catwalk', direction: 'up' });
  });

  it('names the floor rather than its index', () => {
    // "up to Catwalk" is a thing a GM can picture; "up to level 1" is not.
    expect(offer(twoStorey(), token())?.targetName).toBe('Catwalk');
  });

  it('offers the way down from the floor above', () => {
    const got = offer(twoStorey(), token({ level: 1 }));
    expect(got).toMatchObject({ target: 0, direction: 'down' });
    // The ground floor keeps its default name.
    expect(got?.targetName).toBe('Ground');
  });

  it('says nothing when the token is not on stairs', () => {
    expect(offer(twoStorey(), token({ x: 1.5, y: 1.5 }))).toBeNull();
  });

  it('says nothing for stairs that lead to a floor which does not exist', () => {
    // Sketching a stairwell before building the storey is reasonable; a button
    // that walks a runner off the top of the building is not.
    expect(offer(scene(), token())).toBeNull();
  });

  it('reads the token’s OWN floor, not the ground', () => {
    // A token on the catwalk standing where the ground floor has an up-flight
    // must be offered the catwalk's down-flight, not the one beneath it.
    const got = offer(twoStorey(), token({ level: 1 }));
    expect(got?.direction).toBe('down');
  });

  it('says nothing with no token selected, or no scene', () => {
    expect(offer(twoStorey(), undefined)).toBeNull();
    expect(offer(null, token())).toBeNull();
  });

  it('is not fooled by an ordinary wall in the same layer', () => {
    // Stairs share the structure layer with walls; only `connects` counts.
    const walled = scene({
      tiles: {
        tilesetId: 'docklands',
        cells: {},
        ground: {},
        structure: { '8,4': 'wall' },
        object: {},
      },
      levels: [{ id: 'up', name: 'Up' }],
    });
    expect(offer(walled, token())).toBeNull();
  });
});
