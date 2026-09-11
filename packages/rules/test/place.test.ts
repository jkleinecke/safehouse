/**
 * Single-click tile placement (FR9.2).
 *
 * The thing under test is a judgement call, so it is tested the way judgement
 * calls have to be: on the properties a GM would notice being wrong, not on
 * whichever tile the current scoring happens to return.
 *
 * The property that matters most is STABILITY. Where several decorations tie,
 * the winner comes from hashing the cell — never from randomness — so a field
 * of grass gets variety and the cell at 4,7 yields the same tree every time it
 * is drawn, re-queried, or opened next week. A map that reshuffled its own
 * scenery on redraw would feel broken in a way that is hard to describe and
 * impossible to ignore.
 */
import { describe, expect, it } from 'vitest';
import {
  LAYER_FOR_CATEGORY,
  TILE_CATEGORIES,
  TILESETS,
  categoryOf,
  layerOf,
  migrateTileLayer,
  stairTarget,
  stopsMovement,
  stopsSight,
  pickTile,
  tilesetById,
  type PlacementContext,
  tileById,
} from '../src/index.js';

const sprawl = tilesetById('sprawl')!;
const corp = tilesetById('corp')!;

function ctx(over: Partial<PlacementContext> = {}): PlacementContext {
  return {
    tileset: sprawl,
    here: {},
    wallAdjacent: false,
    col: 3,
    row: 4,
    ...over,
  };
}

describe('categories map onto layers', () => {
  it('sorts every catalogue tile into one of the four tools', () => {
    for (const set of TILESETS) {
      for (const tile of set.tiles) {
        expect(TILE_CATEGORIES, `${set.id}/${tile.id}`).toContain(categoryOf(tile));
      }
    }
  });

  it('puts interior and decoration on the same layer, and the others apart', () => {
    // Four tools, three layers: a square holds a chair or a plant, not both.
    expect(LAYER_FOR_CATEGORY.interior).toBe(LAYER_FOR_CATEGORY.decoration);
    expect(LAYER_FOR_CATEGORY.ground).not.toBe(LAYER_FOR_CATEGORY.building);
    expect(LAYER_FOR_CATEGORY.ground).not.toBe(LAYER_FOR_CATEGORY.interior);
    // Three distinct layers out of four tools — no more, no fewer.
    expect(new Set(Object.values(LAYER_FOR_CATEGORY)).size).toBe(3);
  });

  it('gives every set something for every tool', () => {
    // A tool with an empty palette is a button that does nothing.
    for (const set of TILESETS) {
      for (const category of TILE_CATEGORIES) {
        const n = set.tiles.filter((t) => categoryOf(t) === category).length;
        expect(n, `${set.id} has no ${category} tiles`).toBeGreaterThan(0);
      }
    }
  });
});

describe('Building cycles wall → cut → back', () => {
  it('puts a wall on an empty cell', () => {
    const got = pickTile('building', ctx());
    expect(got?.tileId).toBe('wall');
    expect(got?.layer).toBe('structure');
  });

  it('turns an existing wall into something cut through it', () => {
    const got = pickTile('building', ctx({ here: { structure: 'wall' } }));
    expect(got?.tileId).not.toBe('wall');
    // Whatever it advanced to must be a thing that only exists inside a wall.
    const tile = sprawl.tiles.find((t) => t.id === got?.tileId);
    expect(tile?.placement?.inWall).toBe(true);
  });

  it('comes back round to a solid wall', () => {
    // Clicking repeatedly must not strand the GM on a door they cannot undo.
    let current: string | undefined;
    const seen: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const got = pickTile('building', ctx({ here: { structure: current } }));
      expect(got).not.toBeNull();
      current = got!.tileId;
      seen.push(current);
    }
    expect(seen).toContain('wall');
    // Every step is a building tile; the cycle never leaves the category.
    for (const id of seen) {
      const tile = sprawl.tiles.find((t) => t.id === id)!;
      expect(categoryOf(tile)).toBe('building');
    }
  });

  it('never offers a window or door where there is no wall', () => {
    // A door frame in the middle of a car park is the failure this prevents.
    for (const set of TILESETS) {
      const got = pickTile('building', ctx({ tileset: set, here: {} }));
      const tile = set.tiles.find((t) => t.id === got?.tileId);
      expect(tile?.placement?.inWall, `${set.id}`).not.toBe(true);
    }
  });
});

describe('Decoration reads the ground beneath', () => {
  it('gives soil-loving scenery on grass and never a hydrant', () => {
    const got = pickTile('decoration', ctx({ here: { ground: 'grass' } }));
    expect(got).not.toBeNull();
    const tile = sprawl.tiles.find((t) => t.id === got!.tileId)!;
    expect(tile.placement?.on).toContain('grass');
    expect(got!.tileId).not.toBe('hydrant');
  });

  it('gives road scenery on the road, and never a tree', () => {
    const got = pickTile('decoration', ctx({ here: { ground: 'road' } }));
    const tile = sprawl.tiles.find((t) => t.id === got!.tileId)!;
    expect(tile.placement?.on).toContain('road');
    expect(got!.tileId).not.toBe('tree');
  });

  it('puts a hydrant on pavement', () => {
    // Pavement is the only ground a hydrant declares, so it must be reachable.
    const seen = new Set<string>();
    for (let col = 0; col < 40; col += 1) {
      const got = pickTile('decoration', ctx({ col, here: { ground: 'walk' } }));
      if (got !== null) seen.add(got.tileId);
    }
    expect(seen).toContain('hydrant');
  });

  it('says nothing rather than something wrong when no decoration fits', () => {
    // Neon spill has no decoration declaring it; an answer here would be a
    // hydrant in a puddle of light, which is worse than an empty click.
    expect(pickTile('decoration', ctx({ here: { ground: 'neon' } }))).toBeNull();
  });
});

describe('Interior reads the walls', () => {
  it('prefers something with a back to it when a wall is adjacent', () => {
    const got = pickTile('interior', ctx({ tileset: corp, wallAdjacent: true, here: { ground: 'carpet' } }));
    const tile = corp.tiles.find((t) => t.id === got!.tileId)!;
    expect(tile.placement?.againstWall).toBe(true);
  });

  it('picks free-standing furniture in the middle of a room', () => {
    const got = pickTile('interior', ctx({ tileset: corp, wallAdjacent: false, here: { ground: 'carpet' } }));
    const tile = corp.tiles.find((t) => t.id === got!.tileId)!;
    expect(tile.placement?.againstWall).not.toBe(true);
  });
});

describe('the same cell always gives the same answer', () => {
  it('is stable across repeated calls', () => {
    // Redrawing the canvas must not reshuffle the scenery.
    const first = pickTile('decoration', ctx({ col: 4, row: 7, here: { ground: 'grass' } }));
    for (let i = 0; i < 20; i += 1) {
      expect(pickTile('decoration', ctx({ col: 4, row: 7, here: { ground: 'grass' } }))).toEqual(first);
    }
  });

  it('still varies across cells, or a hedge would be one repeated tile', () => {
    const seen = new Set<string>();
    for (let col = 0; col < 30; col += 1) {
      for (let row = 0; row < 3; row += 1) {
        const got = pickTile('decoration', ctx({ col, row, here: { ground: 'grass' } }));
        if (got !== null) seen.add(got.tileId);
      }
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('an explicit choice always wins', () => {
  it('places exactly what the GM picked, ignoring the scoring', () => {
    // Auto-placement is a default, not a constraint.
    const got = pickTile('decoration', ctx({ here: { ground: 'road' } }), 'tree');
    expect(got?.tileId).toBe('tree');
    expect(got?.layer).toBe('object');
  });

  it('falls back to scoring when the chosen id is not in this set', () => {
    const got = pickTile('decoration', ctx({ here: { ground: 'grass' } }), 'not-a-tile');
    expect(got?.tileId).not.toBe('not-a-tile');
  });
});

describe('migrating a scene painted before layers existed', () => {
  it('sorts flat cells into the layer each tile belongs to', () => {
    const out = migrateTileLayer({
      tilesetId: 'sprawl',
      cells: { '0,0': 'road', '1,0': 'wall', '2,0': 'tree', '3,0': 'car' },
    });
    // Every square comes out as a SLOT (slots.ts), read back through the set.
    expect(tileById('sprawl', out.ground['0,0']!)?.id).toBe('road');
    expect(tileById('sprawl', out.structure['1,0']!)?.id).toBe('wall');
    expect(tileById('sprawl', out.object['2,0']!)?.id).toBe('tree');
    // A car is interior, which shares the object layer with decoration.
    expect(tileById('sprawl', out.object['3,0']!)?.id).toBe('car');
    expect(out.structure['1,0']).toBe('building/wall');
  });

  it('lets already-layered data win, because it is the newer answer', () => {
    const out = migrateTileLayer({
      tilesetId: 'sprawl',
      cells: { '0,0': 'road' },
      ground: { '0,0': 'grass' },
    });
    expect(tileById('sprawl', out.ground['0,0']!)?.id).toBe('grass');
  });

  it('drops an id the catalogue no longer knows rather than guessing a layer', () => {
    // A wall that lands in the decoration layer is worse than one that is
    // gone: the GM can see it and line of sight cannot.
    const out = migrateTileLayer({ tilesetId: 'sprawl', cells: { '0,0': 'gone' } });
    expect(out.ground).toEqual({});
    expect(out.structure).toEqual({});
    expect(out.object).toEqual({});
  });

  it('is idempotent, so running it on every read is safe', () => {
    const once = migrateTileLayer({ tilesetId: 'sprawl', cells: { '0,0': 'road', '1,0': 'wall' } });
    const twice = migrateTileLayer({ ...once, cells: {} });
    expect(twice).toEqual(once);
  });

  it('survives an unknown tileset without inventing layers', () => {
    const out = migrateTileLayer({ tilesetId: 'atlantis', cells: { '0,0': 'road' } });
    expect(out.ground).toEqual({});
  });
});

describe('every placement hint refers to something real', () => {
  it('names ground tiles that exist in the same set', () => {
    // A typo here is invisible: the tile simply never gets offered, and the
    // tool quietly has one fewer option than the catalogue claims.
    for (const set of TILESETS) {
      const groundIds = new Set(set.tiles.filter((t) => categoryOf(t) === 'ground').map((t) => t.id));
      for (const tile of set.tiles) {
        for (const on of tile.placement?.on ?? []) {
          expect(groundIds, `${set.id}/${tile.id} sits on unknown ground "${on}"`).toContain(on);
        }
      }
    }
  });

  it('only marks building tiles as inWall', () => {
    for (const set of TILESETS) {
      for (const tile of set.tiles) {
        if (tile.placement?.inWall !== true) continue;
        expect(categoryOf(tile), `${set.id}/${tile.id}`).toBe('building');
        expect(layerOf(tile)).toBe('structure');
      }
    }
  });

  it('leaves at least one solid wall per set for the cut ones to live in', () => {
    for (const set of TILESETS) {
      const solid = set.tiles.filter(
        (t) => categoryOf(t) === 'building' && t.placement?.inWall !== true,
      );
      expect(solid.length, `${set.id} has no solid wall`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------

/**
 * Stairs (FR9.22) are the one tool whose answer depends on the BUILDING rather
 * than on the square. Which way a flight leads follows from the floors the
 * scene has, because on the ground floor of a two-storey map there is only one
 * direction that means anything.
 */
describe('the Stairs tool reads the building', () => {
  it('goes up when there is a floor above', () => {
    const got = pickTile('stairs', ctx({ level: 0, levelCount: 2 }));
    const tile = sprawl.tiles.find((t) => t.id === got!.tileId)!;
    expect(tile.connects).toBe('up');
    expect(got!.why).toContain('above');
  });

  it('goes down from the top floor', () => {
    const got = pickTile('stairs', ctx({ level: 1, levelCount: 2 }));
    const tile = sprawl.tiles.find((t) => t.id === got!.tileId)!;
    expect(tile.connects).toBe('down');
  });

  it('still places a flight on a one-floor scene, and says it leads nowhere yet', () => {
    // Sketching a stairwell before adding the storey is reasonable; refusing
    // would make the GM build in an order the tool decided.
    const got = pickTile('stairs', ctx({ level: 0, levelCount: 1 }));
    expect(got).not.toBeNull();
    expect(got!.why).toMatch(/no floor|add one/i);
  });

  it('lands in the structure layer, beside the walls', () => {
    // A square holds a wall or a stairwell, never both.
    expect(pickTile('stairs', ctx({ level: 0, levelCount: 2 }))!.layer).toBe('structure');
  });

  it('never blocks, whatever height it is drawn at', () => {
    // Stairs share a layer with walls, so without the override a stairwell
    // would be a stair nobody can walk onto — a picture of a stair.
    for (const set of TILESETS) {
      for (const tile of set.tiles) {
        if (tile.connects === undefined) continue;
        expect(stopsMovement(tile), `${set.id}/${tile.id}`).toBe(false);
        expect(stopsSight(tile), `${set.id}/${tile.id}`).toBe(false);
      }
    }
  });

  it('gives every set a way up and a way down', () => {
    for (const set of TILESETS) {
      const stairs = set.tiles.filter((t) => categoryOf(t) === 'stairs');
      expect(stairs.map((t) => t.connects).sort(), set.id).toEqual(['down', 'up']);
    }
  });
});

describe('stairTarget — a painted flight is a connection, not a picture', () => {
  const tileFor = (tilesetId: string, tileId: string) =>
    tilesetById(tilesetId)?.tiles.find((t) => t.id === tileId) ?? null;

  const twoStorey = {
    tiles: { tilesetId: 'sprawl', structure: { '1,1': 'stairup' } },
    levels: [{ id: 'up', name: 'Upstairs', tiles: { tilesetId: 'sprawl', structure: { '4,4': 'stairdown' } } }],
  };

  it('leads up from the ground floor', () => {
    expect(stairTarget(twoStorey, 0, '1,1', tileFor)).toBe(1);
  });

  it('leads back down from the floor above', () => {
    expect(stairTarget(twoStorey, 1, '4,4', tileFor)).toBe(0);
  });

  it('leads nowhere from a cell with no stairs', () => {
    expect(stairTarget(twoStorey, 0, '9,9', tileFor)).toBeNull();
  });

  it('refuses to lead off the top of the building', () => {
    // Stairs painted before the storey above exists must not walk a token
    // onto a floor that is not there.
    const oneStorey = { tiles: { tilesetId: 'sprawl', structure: { '1,1': 'stairup' } } };
    expect(stairTarget(oneStorey, 0, '1,1', tileFor)).toBeNull();
  });

  it('is not fooled by an ordinary wall in the same layer', () => {
    const walled = { tiles: { tilesetId: 'sprawl', structure: { '2,2': 'wall' } }, levels: [{ id: 'u', name: 'U' }] };
    expect(stairTarget(walled, 0, '2,2', tileFor)).toBeNull();
  });
});
