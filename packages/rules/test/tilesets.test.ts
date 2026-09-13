/**
 * Tileset catalogue integrity (FR9.2, §14).
 *
 * The catalogue is data that three other places trust blindly: the server
 * validates paint strokes against it, the palette UI lists it, and the web
 * painter draws from it. None of those can tell a typo from a decision, so the
 * invariants they assume are pinned here.
 *
 * The load-bearing one is PATTERN DRIFT. `apps/web/.../stage/tileLayer.ts`
 * switches on `pattern` and silently falls through to a flat fill for anything
 * it does not recognise, and this package cannot import it to check. So
 * `TILE_PATTERNS` is exported as a value and `TilePattern` derived from it:
 * this suite asserts the catalogue only uses members, and the web suite
 * asserts the painter handles every member. Add a thirteenth pattern and
 * exactly one of the two goes red.
 */
import { describe, expect, it } from 'vitest';
import {
  TILESETS,
  TILE_HEIGHTS,
  TILE_KINDS,
  TILE_LIQUIDS,
  TILE_PATTERNS,
  TILE_PROPS,
  TILE_SHORES,
  cellKey,
  layerOf,
  parseCellKey,
  stopsMovement,
  stopsSight,
  tileById,
  tilesetById,
  type Tile,
} from '../src/index.js';

const ALL_TILES: Array<{ setId: string; tile: Tile }> = TILESETS.flatMap((set) =>
  set.tiles.map((tile) => ({ setId: set.id, tile })),
);

const HEX = /^#[0-9a-f]{6}$/;

describe('catalogue shape', () => {
  it('ships the sixteen sets, each with tiles', () => {
    expect(TILESETS.length).toBe(16);
    expect(TILESETS.map((s) => s.id)).toEqual([
      'docklands',
      'corp',
      'sprawl',
      'maintenance',
      'barrens',
      'club',
      'tenement',
      'condo',
      'cafe',
      'restaurant',
      'takeout',
      'plaza',
      'park',
      'marina',
      'countryside',
      'lake',
    ]);
    for (const set of TILESETS) {
      expect(set.tiles.length, `${set.id} has no tiles`).toBeGreaterThan(0);
      expect(set.name.length).toBeGreaterThan(0);
      expect(set.blurb.length).toBeGreaterThan(0);
    }
  });

  it('gives every tileset a unique id', () => {
    const ids = TILESETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every tile a unique id WITHIN its set', () => {
    for (const set of TILESETS) {
      const ids = set.tiles.map((t) => t.id);
      expect(new Set(ids).size, `duplicate tile id in ${set.id}: ${ids.join(',')}`).toBe(ids.length);
    }
  });

  it('names every tile', () => {
    for (const { setId, tile } of ALL_TILES) {
      expect(tile.id.length, `${setId} has an empty tile id`).toBeGreaterThan(0);
      expect(tile.name.length, `${setId}/${tile.id} has no name`).toBeGreaterThan(0);
    }
  });
});

describe('tile ids are NOT globally unique — the client must key by set', () => {
  /**
   * Not a defect: `floor` meaning different things in a warehouse and a club is
   * the point of a tileset. It is pinned because a consumer that flattens all
   * six sets into one map keyed by tile id renders Docklands in Club purple,
   * and that bug is invisible in review. `TileLayer` stores exactly one
   * `tilesetId`, so the qualified key is always available.
   */
  it('documents the known cross-set collisions', () => {
    const bySet = new Map<string, string[]>();
    for (const { setId, tile } of ALL_TILES) {
      bySet.set(tile.id, [...(bySet.get(tile.id) ?? []), setId]);
    }
    expect(bySet.get('wall')).toEqual([
      'docklands',
      'corp',
      'sprawl',
      'maintenance',
      'barrens',
      'club',
    ]);
    expect(bySet.get('door')).toEqual(['docklands', 'corp', 'sprawl', 'club']);
    expect(bySet.get('floor')).toEqual(['docklands', 'club']);
  });

  it('gives colliding ids genuinely different definitions', () => {
    const docklands = tileById('docklands', 'floor');
    const club = tileById('club', 'floor');
    expect(docklands?.colors[0]).not.toBe(club?.colors[0]);
    expect(docklands?.pattern).not.toBe(club?.pattern);
  });

  it('makes `${tilesetId}/${tileId}` unique across the whole catalogue', () => {
    const keys = ALL_TILES.map(({ setId, tile }) => `${setId}/${tile.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('every tile is drawable', () => {
  it('uses only patterns from TILE_PATTERNS', () => {
    const known = new Set<string>(TILE_PATTERNS);
    for (const { setId, tile } of ALL_TILES) {
      expect(known.has(tile.pattern), `${setId}/${tile.id} uses unknown pattern ${tile.pattern}`).toBe(
        true,
      );
    }
  });

  it('lists each pattern once, so a consumer can switch on the array', () => {
    expect(new Set(TILE_PATTERNS).size).toBe(TILE_PATTERNS.length);
    expect(TILE_PATTERNS.length).toBe(19);
  });

  it('pins the pattern list the web painter must handle', () => {
    // The mirror of this assertion lives in the web painter's suite. If this
    // one is edited, that one has to be too — that is the whole mechanism.
    expect([...TILE_PATTERNS].sort()).toEqual([
      'brick',
      'carpet',
      'cobble',
      'concrete',
      'dirt',
      'field',
      'grass',
      'grating',
      'gravel',
      'hatch',
      'marble',
      'panel',
      'planks',
      'reeds',
      'rubble',
      'sand',
      'solid',
      'tile',
      'water',
    ]);
  });

  it('uses only kinds from TILE_KINDS', () => {
    const known = new Set<string>(TILE_KINDS);
    for (const { setId, tile } of ALL_TILES) {
      expect(known.has(tile.kind), `${setId}/${tile.id} has unknown kind ${tile.kind}`).toBe(true);
    }
  });

  it('gives every tile two parseable #rrggbb colours', () => {
    for (const { setId, tile } of ALL_TILES) {
      expect(tile.colors.length, `${setId}/${tile.id}`).toBe(2);
      for (const c of tile.colors) {
        expect(HEX.test(c), `${setId}/${tile.id} colour ${c} is not #rrggbb`).toBe(true);
      }
    }
  });

  it('keeps base and accent distinguishable', () => {
    for (const { setId, tile } of ALL_TILES) {
      expect(tile.colors[0], `${setId}/${tile.id} draws its pattern in its own base colour`).not.toBe(
        tile.colors[1],
      );
    }
  });
});

describe('tile semantics', () => {
  it('marks every wall as blocking movement and sight', () => {
    // Asserted through the SEMANTICS, not the raw fields: blocking is now
    // derived from `height` so that the isometric silhouette and the rules
    // read one number and cannot disagree. A wall that renders full-height
    // and lets bullets through would be the worst possible bug here, so the
    // property is unchanged — only how the tile spells it.
    for (const { setId, tile } of ALL_TILES) {
      if (tile.kind !== 'wall') continue;
      expect(stopsMovement(tile), `${setId}/${tile.id}`).toBe(true);
      expect(tile.height, `${setId}/${tile.id} must stand full height`).toBe(TILE_HEIGHTS.FULL);
      // See-through walls are a real category — glass partitions, wire-glass
      // windows, vent grilles, a blown-out frame with no glass left in it —
      // and each one says so with `blocksSight: false`. Asserted against that
      // declaration rather than a list of ids, which went stale the moment
      // every set grew a window.
      if (tile.blocksSight !== false) {
        expect(stopsSight(tile), `${setId}/${tile.id}`).toBe(true);
      }
    }
  });

  it('never blocks sight without blocking movement', () => {
    for (const { setId, tile } of ALL_TILES) {
      if (!stopsSight(tile)) continue;
      expect(stopsMovement(tile), `${setId}/${tile.id} stops eyes but not bodies`).toBe(true);
    }
  });

  it('gives every set something that reads at table distance', () => {
    // The failure this catches is the one that made the first catalogue
    // unusable: six sets of near-black grey, indistinguishable across a room.
    // Each set must own at least one light source, and its floors must not all
    // collapse into the same narrow band of dark.
    for (const set of TILESETS) {
      const emissive = set.tiles.filter((t) => t.emissive !== undefined);
      expect(emissive.length, `${set.id} has no light source`).toBeGreaterThan(0);

      const floors = set.tiles.filter((t) => t.kind === 'floor');
      const lightness = floors.map((t) => {
        const hex = t.colors[0];
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
      });
      const spread = Math.max(...lightness) - Math.min(...lightness);
      expect(spread, `${set.id} floors are all the same brightness`).toBeGreaterThan(0.04);
    }
  });

  it('leaves floors passable', () => {
    for (const { setId, tile } of ALL_TILES) {
      if (tile.kind !== 'floor') continue;
      expect(tile.blocksMovement ?? false, `${setId}/${tile.id}`).toBe(false);
    }
  });

  it('gives every set at least one floor and one wall to build with', () => {
    for (const set of TILESETS) {
      expect(set.tiles.some((t) => t.kind === 'floor'), `${set.id} has no floor`).toBe(true);
      expect(set.tiles.some((t) => t.kind === 'wall'), `${set.id} has no wall`).toBe(true);
    }
  });
});

describe('lookups', () => {
  it('finds a set and a tile by id', () => {
    expect(tilesetById('docklands')?.name).toBe('Docklands warehouse');
    expect(tileById('docklands', 'crates')?.kind).toBe('feature');
  });

  it('returns null rather than throwing for an unknown set', () => {
    expect(tilesetById('atlantis')).toBeNull();
    expect(tilesetById('')).toBeNull();
    expect(tileById('atlantis', 'floor')).toBeNull();
  });

  it('returns null for a tile that exists in a DIFFERENT set', () => {
    // `forklift` is docklands-only; asking club for it must not fall back.
    expect(tileById('club', 'forklift')).toBeNull();
    expect(tileById('docklands', 'booth')).toBeNull();
  });

  it('resolves every catalogue entry through the public lookups', () => {
    for (const { setId, tile } of ALL_TILES) {
      expect(tileById(setId, tile.id), `${setId}/${tile.id}`).toEqual(tile);
    }
  });
});

describe('cell keys', () => {
  it('round-trips, negatives included', () => {
    for (const [col, row] of [
      [0, 0],
      [3, 7],
      [-1, 4],
      [12, -9],
      [-40, -40],
      [999, 1000],
    ] as const) {
      const key = cellKey(col, row);
      expect(key).toBe(`${col},${row}`);
      expect(parseCellKey(key)).toEqual({ col, row });
    }
  });

  it('rejects everything that is not exactly two integers', () => {
    for (const bad of ['', '1', '1,2,3', '1, 2', ' 1,2', '1,2 ', '1.5,2', '+1,2', 'a,b', ',', '1,', ',2', '--1,2', '1;2', '1e3,2']) {
      expect(parseCellKey(bad), `parsed ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it('treats -0 as 0 so one cell has one key', () => {
    expect(cellKey(-0, 0)).toBe('0,0');
  });
});

describe('props are designs the renderer draws', () => {
  it('lists each design once, so a consumer can key a record by the array', () => {
    expect(new Set(TILE_PROPS).size).toBe(TILE_PROPS.length);
  });

  it('uses only designs from TILE_PROPS, and only on the object layer', () => {
    // A design on a wall or a floor would be drawn by nothing: the object
    // renderer is the only thing that reads `prop`.
    const known = new Set<string>(TILE_PROPS);
    for (const { setId, tile } of ALL_TILES) {
      if (tile.prop === undefined) continue;
      expect(known.has(tile.prop), `${setId}/${tile.id} names unknown design ${tile.prop}`).toBe(true);
      expect(layerOf(tile), `${setId}/${tile.id} has a design but is not an object`).toBe('object');
    }
  });

  it('gives every design at least one tile, so none is dead weight in the renderer', () => {
    const used = new Set(ALL_TILES.map(({ tile }) => tile.prop).filter((p) => p !== undefined));
    for (const design of TILE_PROPS) expect(used.has(design), `no tile uses ${design}`).toBe(true);
  });

  it('dresses every set with designed furniture and props — not four blobs in six browns', () => {
    for (const set of TILESETS) {
      const designed = set.tiles.filter((t) => t.prop !== undefined);
      expect(designed.length, `${set.id} has ${designed.length} designed props`).toBeGreaterThanOrEqual(8);
      // …and a set is a world, so its designs must not all be one thing.
      expect(new Set(designed.map((t) => t.prop)).size, set.id).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('water is a body, and the land knows how it meets it', () => {
  /** The three places a campaign goes to the water. */
  const WATERSIDE = ['marina', 'park', 'lake'];

  it('lists each liquid and each shore once', () => {
    expect(new Set(TILE_LIQUIDS).size).toBe(TILE_LIQUIDS.length);
    expect(new Set(TILE_SHORES).size).toBe(TILE_SHORES.length);
  });

  it('marks water only on the ground, and shores only on dry ground', () => {
    // The renderer reads `liquid` and `shore` off the ground layer and nowhere
    // else: a liquid prop would be drawn as a floor, and a shore on water
    // would be a quay wall standing in the harbour.
    for (const { setId, tile } of ALL_TILES) {
      if (tile.liquid !== undefined) {
        expect(layerOf(tile), `${setId}/${tile.id}`).toBe('ground');
        expect(TILE_LIQUIDS).toContain(tile.liquid);
        expect(tile.shore, `${setId}/${tile.id} is water with a shore`).toBeUndefined();
      }
      if (tile.shore !== undefined) {
        expect(layerOf(tile), `${setId}/${tile.id}`).toBe('ground');
        expect(TILE_SHORES).toContain(tile.shore);
      }
    }
  });

  it('keeps water a floor you can wade into — swimming is a test, not a wall', () => {
    for (const { setId, tile } of ALL_TILES) {
      if (tile.liquid === undefined) continue;
      expect(stopsMovement(tile), `${setId}/${tile.id}`).toBe(false);
      expect(stopsSight(tile), `${setId}/${tile.id}`).toBe(false);
    }
  });

  it('makes every stretch of water at the waterside a true body of water', () => {
    for (const id of WATERSIDE) {
      const set = tilesetById(id)!;
      const water = set.tiles.filter((t) => layerOf(t) === 'ground' && (t.pattern === 'water' || t.pattern === 'reeds'));
      expect(water.length, id).toBeGreaterThanOrEqual(2);
      for (const t of water) expect(t.liquid, `${id}/${t.id} is painted water that is not a liquid`).toBeDefined();
      // Deep and shallow both, so a GM can shelve a shore by hand.
      expect(new Set(water.map((t) => t.liquid)), id).toEqual(new Set(['deep', 'shallow']));
    }
  });

  it('gives every waterside set a beach front and a pier wall', () => {
    for (const id of WATERSIDE) {
      const set = tilesetById(id)!;
      const beach = set.tiles.find((t) => t.id === 'beach');
      const pier = set.tiles.find((t) => t.id === 'pierwall');
      expect(beach?.name, id).toBe('Beach front');
      expect(beach?.shore, id).toBe('beach');
      expect(pier?.name, id).toBe('Pier wall');
      expect(pier?.shore, id).toBe('pier');
      // Built from: the sets' own boards and sand, not a new material.
      expect(beach?.pattern, id).toBe('sand');
      expect(pier?.pattern, id).toBe('planks');
    }
  });

  it('says how the made ground at the waterside meets the water', () => {
    // Boards are piers and concrete is a quay; only earth is left to `bank`.
    for (const id of WATERSIDE) {
      for (const t of tilesetById(id)!.tiles) {
        if (layerOf(t) !== 'ground' || t.liquid !== undefined || t.emissive !== undefined) continue;
        if (t.pattern === 'planks') expect(t.shore, `${id}/${t.id}`).toBe('pier');
        if (t.pattern === 'sand') expect(t.shore, `${id}/${t.id}`).toBe('beach');
      }
    }
    expect(tileById('marina', 'quay')?.shore).toBe('quay');
  });
});
