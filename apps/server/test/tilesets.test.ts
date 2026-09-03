/**
 * Tile painting (FR9.2, the "assemble" half of a scene) — REST + persistence.
 *
 * The painted floor has no column of its own: it rides inside the
 * `scenes.geometry` JSONB next to the walls drawn over it. That buys one
 * atomic write and costs a whole class of collateral damage, so most of what
 * is pinned here is what a paint stroke must NOT disturb — walls, doors, pins,
 * fog, notes, map attachments — and what a geometry edit must not disturb in
 * return.
 *
 * Two behaviours are pinned deliberately even though they read as surprises:
 * painting with a different tileset REPLACES the floor (a layer carries one
 * tileset id, so there is nowhere to put the old cells), and players DO receive
 * the tile layer (Principle 4 note in that describe block — read it before
 * "fixing" either).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scenes as scenesTable } from '@safehouse/db';
import { eq } from 'drizzle-orm';
import { SceneSchema, type Scene } from '@safehouse/contracts';
import { TILESETS } from '@safehouse/rules';
import { ScenesService, normalizeGrid, serializeScene } from '../src/services/scenes.js';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  wsUrl,
  WsTestClient,
  type BootstrapResult,
  type Frame,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let observer: JoinResult;
let display: JoinResult;

const open: WsTestClient[] = [];

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function post(url: string, token: string, payload: unknown) {
  return t.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as object });
}

async function get(url: string, token: string) {
  return t.app.inject({ method: 'GET', url, headers: auth(token) });
}

/** A fresh ACTIVE scene, so player-visibility assertions have something to read. */
async function newScene(name: string, activate = true): Promise<string> {
  const res = await post(`/api/campaigns/${boot.campaignId}/scenes`, boot.gmToken, { name });
  const id = (res.json() as { scene: { id: string } }).scene.id;
  if (activate) await post(`/api/scenes/${id}/activate`, boot.gmToken, {});
  return id;
}

async function paint(sceneId: string, token: string, body: Record<string, unknown>) {
  return post(`/api/scenes/${sceneId}/tiles`, token, body);
}

async function sceneAs(sceneId: string, token: string): Promise<Scene> {
  const res = await get(`/api/scenes/${sceneId}`, token);
  expect(res.statusCode).toBe(200);
  return (res.json() as { scene: Scene }).scene;
}

/**
 * Every painted cell, flattened across the three layers.
 *
 * A scene holds ground, structure and object separately now — a tree stands ON
 * grass, a window is set INTO a wall — so "what is painted here" is a question
 * about all three. These suites are asking whether a stroke landed or was
 * rejected, which is layer-agnostic, so they get the flat view; the layered
 * behaviour is asserted on its own further down.
 *
 * `tiles.cells` is deliberately NOT consulted: the legacy field drains to
 * empty the moment a scene is touched, so reading it would quietly assert
 * nothing at all.
 */
function cellsOf(scene: Scene): Record<string, string> {
  const t = scene.tiles;
  if (!t) return {};
  return { ...t.ground, ...t.structure, ...t.object };
}

beforeAll(async () => {
  t = await makeTestApp('tilesets');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  boot = await bootstrapCampaign(t.app, 'Dockside Job');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  observer = await joinAs(t.app, boot.campaignId, boot.gmToken, 'observer', 'Lurker');
  display = await joinAs(t.app, boot.campaignId, boot.gmToken, 'display', 'Table TV');
}, 180_000);

afterAll(async () => {
  for (const c of open) c.close();
  await t.close();
});

describe('GET /api/tilesets (FR9.2)', () => {
  it('requires a device token', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/tilesets' });
    expect(res.statusCode).toBe(401);
  });

  it('serves the whole catalogue to the GM', async () => {
    const res = await get('/api/tilesets', boot.gmToken);
    expect(res.statusCode).toBe(200);
    const { tilesets } = res.json() as { tilesets: typeof TILESETS };
    expect(tilesets.map((s) => s.id)).toEqual(TILESETS.map((s) => s.id));
    for (const set of tilesets) {
      expect(set.tiles.length).toBeGreaterThan(0);
      for (const tile of set.tiles) {
        expect(typeof tile.pattern).toBe('string');
        expect(tile.colors.length).toBe(2);
      }
    }
  });

  it('is readable by players, observers and the table display', async () => {
    // Not GM-only on purpose: every client that DRAWS the floor needs the
    // palette, and the catalogue is static definitions, not scene content.
    for (const tok of [player.token, observer.token, display.token]) {
      const res = await get('/api/tilesets', tok);
      expect(res.statusCode).toBe(200);
      expect((res.json() as { tilesets: unknown[] }).tilesets.length).toBe(TILESETS.length);
    }
  });
});

describe('POST /api/scenes/:id/tiles — authority (§13)', () => {
  let sceneId: string;

  beforeAll(async () => {
    sceneId = await newScene('Authority floor');
  });

  it('lets the GM paint', async () => {
    const res = await paint(sceneId, boot.gmToken, {
      tilesetId: 'docklands',
      paint: { '0,0': 'floor' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses players, observers and the display — 403, before any row is read', async () => {
    for (const tok of [player.token, observer.token, display.token]) {
      const res = await paint(sceneId, tok, { tilesetId: 'docklands', paint: { '1,1': 'floor' } });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe('forbidden');
    }
    expect(Object.keys(cellsOf(await sceneAs(sceneId, boot.gmToken)))).toEqual(['0,0']);
  });

  it('refuses an unauthenticated stroke', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/scenes/${sceneId}/tiles`,
      payload: { tilesetId: 'docklands', paint: { '2,2': 'floor' } },
    });
    expect(res.statusCode).toBe(401);
  });

  it('404s a scene in another campaign', async () => {
    const res = await paint('00000000-0000-4000-8000-000000000000', boot.gmToken, {
      tilesetId: 'docklands',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/scenes/:id/tiles — validation', () => {
  let sceneId: string;

  beforeAll(async () => {
    sceneId = await newScene('Validation floor');
    await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', paint: { '0,0': 'floor' } });
  });

  async function unchanged() {
    expect(cellsOf(await sceneAs(sceneId, boot.gmToken))).toEqual({ '0,0': 'floor' });
  }

  it('400s an unknown tileset', async () => {
    const res = await paint(sceneId, boot.gmToken, { tilesetId: 'atlantis', paint: { '1,1': 'floor' } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('unknown_tileset');
    await unchanged();
  });

  it('400s an unknown tile and rejects the WHOLE stroke', async () => {
    const res = await paint(sceneId, boot.gmToken, {
      tilesetId: 'docklands',
      // The first two are real; the third is not. None may land.
      paint: { '1,1': 'floor', '1,2': 'crates', '1,3': 'chandelier' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('unknown_tile');
    await unchanged();
  });

  it('400s a tile that exists in a DIFFERENT set', async () => {
    // `booth` is club-only. Cross-set ids are the collision hazard the client
    // keying has to survive; the server must not resolve them loosely.
    const res = await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', paint: { '1,1': 'booth' } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('unknown_tile');
    await unchanged();
  });

  it('400s a malformed cell key in `paint`', async () => {
    for (const key of ['1', '1,2,3', '1, 2', ' 1,2', '1.5,2', '', 'a,b']) {
      const res = await paint(sceneId, boot.gmToken, {
        tilesetId: 'docklands',
        paint: { [key]: 'floor' },
      });
      expect(res.statusCode, `key ${JSON.stringify(key)} was accepted`).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe('bad_request');
    }
    await unchanged();
  });

  it('400s a malformed cell key in `erase`', async () => {
    const res = await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', erase: ['0,0', 'nope'] });
    expect(res.statusCode).toBe(400);
    await unchanged();
  });

  it('accepts negative coordinates — the grid origin is not the corner', async () => {
    const res = await paint(sceneId, boot.gmToken, {
      tilesetId: 'docklands',
      paint: { '-3,-4': 'floor' },
    });
    expect(res.statusCode).toBe(200);
    expect(cellsOf(await sceneAs(sceneId, boot.gmToken))['-3,-4']).toBe('floor');
    await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', erase: ['-3,-4'] });
    await unchanged();
  });

  it('400s a stroke past the per-request cell budget', async () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 20_001; i += 1) big[`${i},0`] = 'floor';
    const res = await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', paint: big });
    expect(res.statusCode).toBe(400);
    await unchanged();
  });

  it('never lets a record key reach Object.prototype', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/scenes/${sceneId}/tiles`,
      headers: { ...auth(boot.gmToken), 'content-type': 'application/json' },
      payload: '{"tilesetId":"docklands","paint":{"__proto__":{"pwned":true}}}',
    });
    expect(res.statusCode).toBeLessThan(500);
    expect(({} as Record<string, unknown>)['pwned']).toBeUndefined();
    expect(Object.keys(cellsOf(await sceneAs(sceneId, boot.gmToken)))).not.toContain('__proto__');
  });
});

describe('paint / erase / clear round-trip through the geometry JSONB', () => {
  let sceneId: string;

  beforeAll(async () => {
    sceneId = await newScene('Warehouse floor');
  });

  it('persists a first stroke', async () => {
    const res = await paint(sceneId, boot.gmToken, {
      tilesetId: 'docklands',
      paint: { '0,0': 'floor', '1,0': 'floor', '2,0': 'wall' },
    });
    expect(res.statusCode).toBe(200);
    const scene = await sceneAs(sceneId, boot.gmToken);
    expect(scene.tiles?.tilesetId).toBe('docklands');
    expect(cellsOf(scene)).toEqual({ '0,0': 'floor', '1,0': 'floor', '2,0': 'wall' });
  });

  it('MERGES a second stroke rather than replacing the layer', async () => {
    const res = await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', paint: { '3,0': 'crates' } });
    expect(cellsOf(await sceneAs(sceneId, boot.gmToken))).toEqual({
      '0,0': 'floor',
      '1,0': 'floor',
      '2,0': 'wall',
      '3,0': 'crates',
    });
    // `painted` is the SIZE OF THE LAYER after the stroke, not the size of the
    // stroke — one cell went in and it reports four. Pinned because the name
    // reads the other way and nothing on the wire says which.
    expect((res.json() as { painted: number }).painted).toBe(4);
  });

  it('repaints a cell in place', async () => {
    await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', paint: { '0,0': 'stain' } });
    expect(cellsOf(await sceneAs(sceneId, boot.gmToken))['0,0']).toBe('stain');
  });

  it('erases the keys it is given and leaves the rest', async () => {
    await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', erase: ['1,0', '3,0'] });
    expect(Object.keys(cellsOf(await sceneAs(sceneId, boot.gmToken))).sort()).toEqual(['0,0', '2,0']);
  });

  it('applies erase AFTER paint, so a cell painted and erased in one stroke is gone', async () => {
    const res = await paint(sceneId, boot.gmToken, {
      tilesetId: 'docklands',
      paint: { '9,9': 'floor' },
      erase: ['9,9'],
    });
    expect(res.statusCode).toBe(200);
    expect(cellsOf(await sceneAs(sceneId, boot.gmToken))['9,9']).toBeUndefined();
  });

  it('ignores an erase for a cell that was never painted', async () => {
    const before = cellsOf(await sceneAs(sceneId, boot.gmToken));
    const res = await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', erase: ['40,40'] });
    expect(res.statusCode).toBe(200);
    expect(cellsOf(await sceneAs(sceneId, boot.gmToken))).toEqual(before);
  });

  it('wipes then applies with `clear: true`', async () => {
    const res = await paint(sceneId, boot.gmToken, {
      tilesetId: 'docklands',
      clear: true,
      paint: { '5,5': 'grate' },
    });
    expect(res.statusCode).toBe(200);
    expect(cellsOf(await sceneAs(sceneId, boot.gmToken))).toEqual({ '5,5': 'grate' });
  });

  it('keeps cells outside the grid — shrinking a scene must not lose paint', async () => {
    const outside = '9999,9999';
    await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', paint: { [outside]: 'floor' } });
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      headers: auth(boot.gmToken),
      payload: { grid: { cols: 5, rows: 5 } },
    });
    expect(patch.statusCode).toBe(200);
    expect(cellsOf(await sceneAs(sceneId, boot.gmToken))[outside]).toBe('floor');
    await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', erase: [outside] });
  });

  it('leaves a valid, re-serialisable scene when the LAST cell is erased', async () => {
    // `updateScene` reads `undefined` as "keep", so there is no path that
    // removes the key once written: an emptied floor persists as
    // `{ tilesetId, cells: {} }` and every consumer must tolerate it.
    const res = await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', erase: ['5,5'] });
    expect(res.statusCode).toBe(200);
    const scene = await sceneAs(sceneId, boot.gmToken);
    expect(scene.tiles).toEqual({ tilesetId: 'docklands', cells: {}, ground: {}, structure: {}, object: {} });
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    expect((res.json() as { painted: number }).painted).toBe(0);
  });

  it('survives serialize -> parse -> serialize unchanged', async () => {
    await paint(sceneId, boot.gmToken, {
      tilesetId: 'sprawl',
      clear: true,
      paint: { '0,0': 'road', '-1,-1': 'puddle', '2,7': 'wall' },
    });
    const first = await sceneAs(sceneId, boot.gmToken);
    const parsed = SceneSchema.parse(first);
    expect(parsed.tiles).toEqual(first.tiles);
    const second = await sceneAs(sceneId, boot.gmToken);
    expect(second).toEqual(first);
  });
});

describe('switching tilesets REPLACES the floor (destructive, and deliberate)', () => {
  /**
   * A `TileLayer` carries exactly one `tilesetId` for all its cells, so a
   * stroke from another set has nowhere to merge: the old cells name tiles the
   * new set may not have. The palette warns the GM before this happens.
   *
   * Pinned so nobody "fixes" it by accident. If the product decision changes —
   * refuse the stroke, or keep a layer per set — this test is the one to
   * argue with, not silently delete.
   */
  it('drops every cell painted with the previous set', async () => {
    const sceneId = await newScene('Repainted floor');
    await paint(sceneId, boot.gmToken, {
      tilesetId: 'docklands',
      paint: { '0,0': 'floor', '1,0': 'floor', '2,0': 'wall' },
    });
    const res = await paint(sceneId, boot.gmToken, { tilesetId: 'club', paint: { '9,9': 'bar' } });
    expect(res.statusCode).toBe(200);
    const scene = await sceneAs(sceneId, boot.gmToken);
    expect(scene.tiles?.tilesetId).toBe('club');
    expect(cellsOf(scene)).toEqual({ '9,9': 'bar' });
  });

  it('wipes the floor even when the stroke paints nothing at all', async () => {
    const sceneId = await newScene('Wiped floor');
    await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', paint: { '0,0': 'floor' } });
    const res = await paint(sceneId, boot.gmToken, { tilesetId: 'club' });
    expect(res.statusCode).toBe(200);
    expect(cellsOf(await sceneAs(sceneId, boot.gmToken))).toEqual({});
  });

  it('does NOT resolve a colliding id against the old set', async () => {
    // `wall` exists in both, so the cell survives the switch by NAME while
    // meaning a different tile. The layer's tilesetId is the only thing that
    // disambiguates it — a client keying its palette by tile id alone paints
    // a warehouse in club colours.
    const sceneId = await newScene('Colliding ids');
    await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', paint: { '0,0': 'wall' } });
    await paint(sceneId, boot.gmToken, { tilesetId: 'club', paint: { '0,0': 'wall' } });
    const scene = await sceneAs(sceneId, boot.gmToken);
    // A wall lands in the STRUCTURE layer, and `cells` is empty because the
    // legacy field drains the moment a scene is written.
    expect(scene.tiles).toEqual({
      tilesetId: 'club',
      cells: {},
      ground: {},
      structure: { '0,0': 'wall' },
      object: {},
    });
  });
});

describe('a paint stroke does no collateral damage', () => {
  let sceneId: string;

  beforeAll(async () => {
    sceneId = await newScene('Furnished floor');
    await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      headers: auth(boot.gmToken),
      payload: {
        notes: 'the ceiling gives way on turn three',
        geometry: {
          walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }],
          doors: [{ id: 'd1', a: { x: 4, y: 0 }, b: { x: 6, y: 0 }, open: false }],
          zones: [],
          pins: [{ id: 'p1', at: { x: 2, y: 2 }, label: 'the crate', visibility: 'gm' }],
        },
      },
    });
    await post(`/api/scenes/${sceneId}/fog`, boot.gmToken, {
      op: 'define',
      region: { name: 'east wing', polygon: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] },
    });
  });

  it('leaves walls, doors, pins, fog and notes intact', async () => {
    const before = await sceneAs(sceneId, boot.gmToken);
    const res = await paint(sceneId, boot.gmToken, {
      tilesetId: 'docklands',
      paint: { '0,0': 'floor', '1,1': 'wall' },
    });
    expect(res.statusCode).toBe(200);
    const after = await sceneAs(sceneId, boot.gmToken);
    expect(after.geometry).toEqual(before.geometry);
    expect(after.fog).toEqual(before.fog);
    expect(after.notes).toBe(before.notes);
    expect(after.grid).toEqual(before.grid);
    expect(after.mapAttachmentIds).toEqual(before.mapAttachmentIds);
    expect(after.name).toBe(before.name);
    expect(after.state).toBe(before.state);
  });

  it('survives a geometry-only PATCH — tiles are not part of SceneGeometry', async () => {
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      headers: auth(boot.gmToken),
      payload: { geometry: { walls: [], doors: [], zones: [], pins: [] } },
    });
    expect(patch.statusCode).toBe(200);
    const scene = await sceneAs(sceneId, boot.gmToken);
    expect(scene.geometry.walls).toEqual([]);
    expect(cellsOf(scene)).toEqual({ '0,0': 'floor', '1,1': 'wall' });
  });

  it('does not leak the tile layer back into `geometry` on read', async () => {
    const scene = await sceneAs(sceneId, boot.gmToken);
    expect((scene.geometry as Record<string, unknown>)['tiles']).toBeUndefined();
    expect(Object.keys(scene.geometry).sort()).toEqual(['doors', 'pins', 'walls', 'zones']);
  });

  it('degrades a corrupt tiles blob to "no floor" instead of throwing', async () => {
    const id = await newScene('Corrupt floor');
    await t.db
      .update(scenesTable)
      .set({ geometry: { walls: [], doors: [], zones: [], pins: [], tiles: 'not a layer' } })
      .where(eq(scenesTable.id, id));
    const scene = await sceneAs(id, boot.gmToken);
    expect(scene.tiles).toBeUndefined();
    // And the next stroke rebuilds it rather than inheriting the garbage.
    await paint(id, boot.gmToken, { tilesetId: 'barrens', paint: { '0,0': 'dirt' } });
    expect(cellsOf(await sceneAs(id, boot.gmToken))).toEqual({ '0,0': 'dirt' });
  });
});

describe('concurrent strokes (lost-update guard)', () => {
  /**
   * READ THIS BEFORE SIMPLIFYING THE ROUTE. A scene write is a read-modify-
   * write: `updateScene` re-derives every field it is not handed from the row
   * it is given, so the row it is given must be read inside the same
   * transaction as the write. The first test below pins that hazard directly
   * — it is the reason the tile route re-reads through `tx.db` instead of
   * reusing the row `openScene` already fetched.
   *
   * The second test is a smoke check, not a proof: on PGlite a single embedded
   * connection serializes everything, so a plain read cannot actually
   * interleave with somebody else's open transaction and the race closes
   * itself. Against the Postgres the deploy target runs (§16) it does not, so
   * the stale-snapshot version of this route is a real lost update that no
   * test here can turn red.
   */
  it('pins the hazard: updateScene reverts whatever the row it was handed does not know about', async () => {
    const svc = new ScenesService(t.db);
    const sceneId = await newScene('Stale snapshot');
    const stale = await svc.sceneRow(sceneId); // the snapshot a request handler takes on the way in
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      headers: auth(boot.gmToken),
      payload: {
        geometry: {
          walls: [{ id: 'drawn-meanwhile', a: { x: 0, y: 0 }, b: { x: 3, y: 3 } }],
          doors: [],
          zones: [],
          pins: [],
        },
      },
    });
    expect(patch.statusCode).toBe(200);

    await svc.updateScene(stale, {
      tiles: { tilesetId: 'docklands', cells: {}, ground: { '0,0': 'floor' }, structure: {}, object: {} },
    });
    const after = serializeScene(await svc.sceneRow(sceneId));
    // Read from the layer it was written to. `cells` is the drained legacy
    // field and asserting on it would pass for any write at all.
    expect(after.tiles?.ground).toEqual({ '0,0': 'floor' });
    expect(after.geometry.walls).toEqual([]); // the wall is gone — a tile write undid a wall draw
  });

  it('merges strokes issued in the same tick', async () => {
    // The client flushes its paint buffer on any pause mid-drag, so several
    // strokes in flight is a pause, not a contrived race.
    const sceneId = await newScene('Contended floor');
    const strokes = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) =>
        paint(sceneId, boot.gmToken, { tilesetId: 'docklands', paint: { [`${i},${i}`]: 'floor' } }),
      ),
    );
    for (const s of strokes) expect(s.statusCode).toBe(200);
    expect(Object.keys(cellsOf(await sceneAs(sceneId, boot.gmToken))).sort()).toEqual([
      '1,1',
      '2,2',
      '3,3',
      '4,4',
      '5,5',
      '6,6',
    ]);
  });

  it('does not roll back a wall drawn while the stroke was in flight', async () => {
    const sceneId = await newScene('Contended geometry');
    await paint(sceneId, boot.gmToken, { tilesetId: 'docklands', paint: { '0,0': 'floor' } });
    const [patch, stroke] = await Promise.all([
      t.app.inject({
        method: 'PATCH',
        url: `/api/scenes/${sceneId}`,
        headers: auth(boot.gmToken),
        payload: {
          geometry: {
            walls: [{ id: 'late', a: { x: 0, y: 0 }, b: { x: 3, y: 3 } }],
            doors: [],
            zones: [],
            pins: [],
          },
        },
      }),
      paint(sceneId, boot.gmToken, { tilesetId: 'docklands', paint: { '4,4': 'crates' } }),
    ]);
    expect(patch.statusCode).toBe(200);
    expect(stroke.statusCode).toBe(200);
    const scene = await sceneAs(sceneId, boot.gmToken);
    expect(scene.geometry.walls.map((w) => w.id)).toEqual(['late']);
    expect(cellsOf(scene)).toEqual({ '0,0': 'floor', '4,4': 'crates' });
  });
});

describe('scene.updated rides with the write (§11, atomicity)', () => {
  it('broadcasts once, with the layer size, to every socket', async () => {
    const sceneId = await newScene('Broadcast floor');
    const gmWs = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, boot.gmToken));
    const playerWs = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, player.token));
    open.push(gmWs, playerWs);
    await Promise.all([gmWs.next((f) => f.type === 'hello'), playerWs.next((f) => f.type === 'hello')]);

    const res = await paint(sceneId, boot.gmToken, {
      tilesetId: 'maintenance',
      paint: { '0,0': 'duct', '0,1': 'walkway' },
    });
    expect(res.statusCode).toBe(200);

    const match = (f: Frame) =>
      f.type === 'scene.updated' && (f.payload as { sceneId?: string }).sceneId === sceneId;
    for (const ws of [gmWs, playerWs]) {
      const frame = await ws.next(match);
      const payload = frame.payload as { changed: string[]; tilesPainted: number };
      expect(payload.changed).toContain('tiles');
      expect(payload.tilesPainted).toBe(2);
      expect(typeof frame.id).toBe('number'); // persisted, not ephemeral
    }
  });

  it('emits nothing when the stroke is rejected', async () => {
    const sceneId = await newScene('Silent floor');
    const ws = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, boot.gmToken));
    open.push(ws);
    await ws.next((f) => f.type === 'hello');
    const before = ws.frames.length;
    const res = await paint(sceneId, boot.gmToken, {
      tilesetId: 'docklands',
      paint: { '0,0': 'chandelier' },
    });
    expect(res.statusCode).toBe(400);
    await new Promise((r) => setTimeout(r, 250));
    expect(
      ws.frames.slice(before).filter((f) => (f.payload as { sceneId?: string })?.sceneId === sceneId),
    ).toEqual([]);
  });
});

describe('Principle 4 — what a player sees of the painted floor', () => {
  /**
   * PLAYERS RECEIVE THE TILE LAYER, UNFILTERED. That is required for the
   * feature to work at all: the table display and every player device draw the
   * floor themselves, and there is no second, redacted copy to send them.
   * `sceneForViewer` strips notes, walls, doors, zones, non-public pins and
   * unrevealed fog regions, and passes `tiles` straight through — the same
   * treatment `mapAttachmentIds` gets, since an uploaded map image is shipped
   * whole too.
   *
   * The consequence is real and is asserted below: cells inside an UNREVEALED
   * fog region are on every player socket, occluded only by the client drawing
   * fog on top. A player reading the JSON can see the floor plan of a room
   * they have not entered. A barrier drawn with the wall tool is stripped; the
   * same barrier painted as a wall TILE is not.
   */
  let sceneId: string;

  beforeAll(async () => {
    sceneId = await newScene('Player-visible floor');
    await post(`/api/scenes/${sceneId}/fog`, boot.gmToken, {
      op: 'define',
      region: {
        name: 'the back room',
        polygon: [{ x: 20, y: 20 }, { x: 26, y: 20 }, { x: 26, y: 26 }],
      },
    });
    await paint(sceneId, boot.gmToken, {
      tilesetId: 'docklands',
      paint: { '1,1': 'floor', '2,1': 'wall', '22,22': 'crates' },
    });
  });

  it('gives players the floor they need to draw', async () => {
    const scene = await sceneAs(sceneId, player.token);
    expect(scene.tiles?.tilesetId).toBe('docklands');
    expect(cellsOf(scene)['1,1']).toBe('floor');
  });

  it('gives the table display the same floor (FR9.19)', async () => {
    const scene = await sceneAs(sceneId, display.token);
    expect(cellsOf(scene)).toEqual(cellsOf(await sceneAs(sceneId, player.token)));
  });

  it('still strips the GM layer around it', async () => {
    const scene = await sceneAs(sceneId, player.token);
    expect(scene.geometry.walls).toEqual([]);
    expect(scene.notes).toBeUndefined();
    expect(scene.fog.regions).toEqual([]); // nothing revealed yet
  });

  it('DOES ship cells inside an unrevealed fog region — occlusion is client-side only', async () => {
    // Documented, not endorsed. Changing this means filtering tiles by
    // revealed geometry in sceneForViewer, which is a design decision (the
    // map-image precedent cuts the other way), not a local fix.
    const scene = await sceneAs(sceneId, player.token);
    expect(cellsOf(scene)['22,22']).toBe('crates');
  });

  it('404s a staged scene rather than admitting its floor exists', async () => {
    const staged = await newScene('Staged floor', false);
    await paint(staged, boot.gmToken, { tilesetId: 'club', paint: { '0,0': 'floor' } });
    const res = await get(`/api/scenes/${staged}`, player.token);
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Projection persistence
// ---------------------------------------------------------------------------

/**
 * A scene's projection is a per-scene setting the GM flips in the Map tab, and
 * the failure mode if it does not round-trip is the worst kind: the toggle
 * moves, the canvas redraws, and the next time the scene loads it is flat
 * again with nothing to explain why.
 *
 * `normalizeGrid` spreads stored values over the defaults, so this is really
 * asserting that the default cannot shadow a stored choice.
 */
describe('grid projection survives the round trip', () => {
  it('defaults to top-down, so every existing scene is unmoved', () => {
    expect(normalizeGrid({ cols: 10, rows: 10 }).projection).toBe('topdown');
    expect(normalizeGrid(undefined).projection).toBe('topdown');
    expect(normalizeGrid({}).projection).toBe('topdown');
  });

  it('keeps an isometric scene isometric', () => {
    expect(normalizeGrid({ cols: 10, rows: 10, projection: 'iso' }).projection).toBe('iso');
  });

  it('falls back to top-down for a value it does not recognise', () => {
    // Garbage in the column must not strand a scene on an unrenderable view.
    expect(normalizeGrid({ cols: 10, rows: 10, projection: 'hexagonal' }).projection).toBe(
      'topdown',
    );
  });
});

describe('a bad projection does not take the calibration with it', () => {
  it('keeps cols, rows and metres when the projection is unrecognised', () => {
    // The failure this guards is silent and expensive: `normalizeGrid` falls
    // back all-or-nothing, so before the enum was handled separately a single
    // unknown string turned a calibrated 14x9 at 2 m/square into a default
    // 30x30 at 1 m — the GM's calibration gone, with nothing logged. A scene
    // written by a build that knows a third projection is exactly how that
    // would arrive.
    const g = normalizeGrid({ cols: 14, rows: 9, unitM: 2, projection: 'hexagonal' });
    expect(g.cols).toBe(14);
    expect(g.rows).toBe(9);
    expect(g.unitM).toBe(2);
    expect(g.projection).toBe('topdown');
  });

  it('still discards a grid that is genuinely unusable', () => {
    // The strictness is deliberate everywhere else: a grid with a string where
    // `cols` belongs is not a grid, and the default IS the right answer.
    const g = normalizeGrid({ cols: 'lots', rows: 9 });
    expect(g.cols).toBe(30);
    expect(g.rows).toBe(30);
  });
});
