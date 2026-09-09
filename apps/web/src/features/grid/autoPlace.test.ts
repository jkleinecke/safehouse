/**
 * The bridge from a canvas click to a tile id.
 *
 * The scoring itself is tested in the rules package; what is pinned here is
 * the part that reads the SCENE — which is where the mistakes that matter to a
 * GM live. Reading the wrong layer for "is there a wall next door" is
 * invisible in a unit test of the scorer and immediately wrong at the table.
 */
import { describe, expect, it } from 'vitest';
import type { Scene } from '@safehouse/contracts';
import { TILESETS } from '@safehouse/rules';
import type { TilesetDef } from './api.js';
import { autoTileFor } from './autoPlace.js';

const SERVED = TILESETS as unknown as TilesetDef[];

function scene(tiles?: Partial<NonNullable<Scene['tiles']>>): Scene {
  return {
    id: 's1',
    campaignId: 'c1',
    name: 'Street',
    state: 'draft',
    grid: { unitM: 1, cols: 20, rows: 20, offset: { x: 0, y: 0 }, projection: 'iso' as const },
    environment: { light: 0, visibility: 0, glare: 0, wind: 0 },
    vision: { playersSeeOwnSight: false },
    geometry: { walls: [], doors: [], zones: [], pins: [] },
    fog: { regions: [], revealed: [], revealedShapes: [] },
    levels: [],
    mapAttachmentIds: [],
    tiles: tiles
      ? { tilesetId: 'sprawl', cells: {}, ground: {}, structure: {}, object: {}, ...tiles }
      : undefined,
  } as Scene;
}

const call = (over: Partial<Parameters<typeof autoTileFor>[0]>) =>
  autoTileFor({
    scene: scene(),
    tilesets: SERVED,
    tilesetId: 'sprawl',
    category: 'decoration',
    tileId: null,
    col: 3,
    row: 3,
    ...over,
  });

describe('autoTileFor reads the square', () => {
  it('places a wall on empty ground with the Building tool', () => {
    expect(call({ category: 'building' })?.tileId).toBe('wall');
  });

  it('advances an existing wall rather than repainting it', () => {
    const s = scene({ structure: { '3,3': 'wall' } });
    const got = call({ category: 'building', scene: s });
    expect(got?.tileId).not.toBe('wall');
  });

  it('reads the ground under the cell for decorations', () => {
    const onGrass = call({ scene: scene({ ground: { '3,3': 'grass' } }) });
    const onRoad = call({ scene: scene({ ground: { '3,3': 'road' } }) });
    expect(onGrass?.tileId).not.toBe(onRoad?.tileId);
    const grassTile = SERVED.find((t) => t.id === 'sprawl')!.tiles.find((t) => t.id === onGrass!.tileId)!;
    expect(grassTile.placement?.on).toContain('grass');
  });

  it('counts only the STRUCTURE layer as an adjacent wall', () => {
    // A desk is not a wall to put a bench against. Counting the object layer
    // would make a room full of furniture think it was full of walls, and
    // every chair would attract another chair.
    // Corp, because its interior palette splits cleanly on this one signal:
    // desks, terminals and benches want a back, chairs and the fountain do
    // not, and none of them care what ground they are on. That isolates wall
    // adjacency from every other term in the score.
    const corp = (tiles: Partial<NonNullable<Scene['tiles']>>): Scene => {
      const s = scene(tiles);
      s.tiles!.tilesetId = 'corp';
      return s;
    };
    const args = { category: 'interior' as const, tilesetId: 'corp' };
    const nextToFurniture = corp({ ground: { '3,3': 'carpet' }, object: { '2,3': 'desk' } });
    const nextToWall = corp({ ground: { '3,3': 'carpet' }, structure: { '2,3': 'wall' } });

    const a = call({ ...args, scene: nextToFurniture });
    const b = call({ ...args, scene: nextToWall });
    const tiles = SERVED.find((t) => t.id === 'corp')!.tiles;
    expect(tiles.find((t) => t.id === b!.tileId)?.placement?.againstWall).toBe(true);
    expect(tiles.find((t) => t.id === a!.tileId)?.placement?.againstWall).not.toBe(true);
  });

  it('answers null rather than placing something absurd', () => {
    // Nothing in the set declares neon spill, so Decor there should place
    // nothing at all — not a fire hydrant standing in a pool of light.
    expect(call({ scene: scene({ ground: { '3,3': 'neon' } }) })).toBeNull();
  });

  it('honours a pinned tile over the scoring', () => {
    const got = call({ scene: scene({ ground: { '3,3': 'road' } }), tileId: 'tree' });
    expect(got?.tileId).toBe('tree');
  });

  it('is stable for a cell and varies between cells', () => {
    const s = scene({ ground: { '3,3': 'grass', '9,2': 'grass' } });
    expect(call({ scene: s, col: 3, row: 3 })).toEqual(call({ scene: s, col: 3, row: 3 }));
    const seen = new Set<string>();
    for (let col = 0; col < 30; col += 1) {
      const g = scene({ ground: { [`${col},1`]: 'grass' } });
      const got = autoTileFor({
        scene: g,
        tilesets: SERVED,
        tilesetId: 'sprawl',
        category: 'decoration',
        tileId: null,
        col,
        row: 1,
      });
      if (got) seen.add(got.tileId);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('says nothing for a tileset the server did not serve', () => {
    expect(call({ tilesetId: 'atlantis' })).toBeNull();
  });

  it('copes with a scene that has no tiles at all', () => {
    expect(call({ category: 'building', scene: scene() })?.tileId).toBe('wall');
  });
});
