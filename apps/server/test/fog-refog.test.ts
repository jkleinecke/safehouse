/**
 * "Fog everything" (`refog`, the GM's fog bar, 2026-09-27): one press, one
 * op, and the map is dark again for the table except what the party can see
 * right now.
 *
 * What is pinned here is what the players and the TV are left with, since
 * that is the whole point of the button and the place a half-done start-over
 * would leak:
 *
 * - every reveal of both fashions is gone (the GM's regions stay, hidden),
 *   every brush mark is gone, and the party's memory of the map is gone, so
 *   no square anywhere is shown as seen before;
 * - the squares a runner sees now are still live, and nothing else is;
 * - the guard the old reveal showed leaves their screens, in the same commit,
 *   after the fog event that hides his room; the guard in the runner's sight
 *   stays;
 * - an open scene is fogged by it too: the switch goes on with the rest;
 * - it is the GM's alone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { characters } from '@safehouse/db';
import { SheetV1Schema, type FogState } from '@safehouse/contracts';
import { cellBitsHas, cellState, decodeCellBits, type CellBits } from '@safehouse/rules';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let phoneToken: string;
let tvToken: string;
let rookId: string;

const COLS = 12;
const ROWS = 9;
/** A wall down column 5, with a shut door in square (5,4): the west room and the east room. */
const WALL: Record<string, string> = {};
for (let row = 0; row < ROWS; row += 1) WALL[`5,${row}`] = row === 4 ? 'door' : 'wall';

const EAST_GUARD = 'Guard-East-Kappa';
const WEST_GUARD = 'Guard-West-Lambda';

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}
async function post(url: string, token: string, payload: unknown) {
  return t.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as object });
}

interface View {
  raw: string;
  fog: FogState;
  tokenIds: string[];
}

async function view(sceneId: string, token: string): Promise<View> {
  const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: auth(token) });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { scene: { fog: FogState }; tokens: { id: string }[] };
  return { raw: res.body, fog: body.scene.fog, tokenIds: body.tokens.map((x) => x.id).sort() };
}

/** One floor's live or explored squares, as a device's copy says them. */
function squares(fog: FogState, part: 'live' | 'explored', level = 0): CellBits {
  const sight = fog.sight;
  expect(sight, 'the fog carries the party sight').toBeDefined();
  return decodeCellBits(sight!.levels[String(level)]?.[part] ?? '', sight!.cols, sight!.rows);
}

async function fogOp(sceneId: string, payload: Record<string, unknown>): Promise<void> {
  const res = await post(`/api/scenes/${sceneId}/fog`, boot.gmToken, payload);
  expect(res.statusCode, JSON.stringify(payload)).toBe(200);
}

/** The newest event id the phone can read, to read what came after it. */
async function mark(): Promise<number> {
  const log = await t.app.inject({ method: 'GET', url: `/api/campaigns/${boot.campaignId}/log?limit=1`, headers: auth(phoneToken) });
  const events = (log.json() as { events: { id: unknown }[] }).events;
  return Math.max(0, ...events.map((e) => Number(e.id)));
}

/** The public events the phone can read back, oldest first, from after `since`. */
async function tableSince(since: number): Promise<{ type: string; payload: Record<string, unknown> }[]> {
  const log = await t.app.inject({
    method: 'GET',
    url: `/api/campaigns/${boot.campaignId}/log?limit=500`,
    headers: auth(phoneToken),
  });
  expect(log.statusCode).toBe(200);
  const events = (log.json() as { events: { id: unknown; type: string; payload: Record<string, unknown> }[] }).events;
  return events
    .filter((e) => Number(e.id) > since)
    .reverse()
    .map((e) => ({ type: e.type, payload: e.payload }));
}

async function newScene(name: string, cols: number, rows: number): Promise<string> {
  const made = await post(`/api/campaigns/${boot.campaignId}/scenes`, boot.gmToken, { name, grid: { cols, rows } });
  expect(made.statusCode).toBe(201);
  const id = (made.json() as { scene: { id: string } }).scene.id;
  expect((await post(`/api/scenes/${id}/activate`, boot.gmToken, {})).statusCode).toBe(200);
  return id;
}

async function place(sceneId: string, body: Record<string, unknown>): Promise<string> {
  const res = await post(`/api/scenes/${sceneId}/tokens`, boot.gmToken, body);
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { token: { id: string } }).token.id;
}

beforeAll(async () => {
  t = await makeTestApp('fog-refog');
  boot = await bootstrapCampaign(t.app, 'Start Over');
  const phone = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Rook');
  const tv = await joinAs(t.app, boot.campaignId, boot.gmToken, 'display', 'Table TV');
  phoneToken = phone.token;
  tvToken = tv.token;
  const made = await t.db
    .insert(characters)
    .values({
      campaignId: boot.campaignId,
      ownerUserId: phone.user.id,
      name: 'Rook',
      sheet: SheetV1Schema.parse({
        v: 1,
        identity: { alias: 'Rook', metatype: 'human' },
        attributes: { bod: 3, agi: 3, rea: 3, str: 3, wil: 3, log: 3, int: 3, cha: 3, edg: { max: 2, current: 2 } },
      }),
    })
    .returning();
  rookId = made[0]!.id;
}, 180_000);

afterAll(async () => {
  await t.close();
});

describe('Fog everything: one op, and the table sees only what the party sees now', () => {
  let sceneId: string;
  let rookTokenId: string;
  let westGuardId: string;
  let eastGuardId: string;
  const viewers = () => [
    { role: 'player', token: phoneToken },
    { role: 'display', token: tvToken },
  ];

  beforeAll(async () => {
    sceneId = await newScene('Loading dock', COLS, ROWS);
    expect((await post(`/api/scenes/${sceneId}/tiles`, boot.gmToken, { tilesetId: 'docklands', paint: WALL })).statusCode).toBe(200);
    rookTokenId = await place(sceneId, { source: 'character', sourceId: rookId, x: 2.5, y: 4.5 });
    // One guard in the runner's room, in plain sight; one behind the door.
    westGuardId = await place(sceneId, { source: 'npc_template', name: WEST_GUARD, x: 3.5, y: 1.5 });
    eastGuardId = await place(sceneId, { source: 'npc_template', name: EAST_GUARD, x: 8.5, y: 4.5 });

    // Sightlines on: the runner sees his room.
    const on = await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      headers: auth(boot.gmToken),
      payload: { vision: { sight: 'on' } },
    });
    expect(on.statusCode).toBe(200);
    // The GM opens the door and shuts it again: the runner saw a line of the
    // east room through the doorway, and the party remembers it.
    for (const op of ['open', 'close'] as const) {
      expect((await post(`/api/scenes/${sceneId}/doors`, boot.gmToken, { cell: '5,4', level: 0, op })).statusCode).toBe(200);
    }
    // The GM's own reveals, every kind of them: the east room live (a named
    // region), a corner of it as seen before (a freehand shape), and two
    // squares painted live with the brush.
    await fogOp(sceneId, {
      op: 'define',
      region: { id: 'fog.east', name: 'East room', polygon: [{ x: 6, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 9 }, { x: 6, y: 9 }] },
    });
    await fogOp(sceneId, { op: 'reveal', regionId: 'fog.east' });
    await fogOp(sceneId, {
      op: 'reveal',
      as: 'explored',
      shape: [{ x: 9, y: 6 }, { x: 11, y: 6 }, { x: 11, y: 8 }, { x: 9, y: 8 }],
    });
    await fogOp(sceneId, { op: 'brush', level: 0, brush: { live: ['6,0', '7,0'] } });
  }, 60_000);

  it('starts from a table that sees the runner’s room, the east room the GM opened, and a memory of the doorway', async () => {
    for (const { role, token } of viewers()) {
      const v = await view(sceneId, token);
      expect(v.fog.active, role).toBe(true);
      expect(v.fog.revealed, role).toEqual(['fog.east']);
      expect(v.fog.brush, role).toBeDefined();
      expect(v.fog.exploredShapes ?? [], role).toHaveLength(1);
      // The doorway line was seen and is remembered, not seen now.
      expect(cellBitsHas(squares(v.fog, 'explored'), 6, 4), role).toBe(true);
      expect(cellBitsHas(squares(v.fog, 'live'), 6, 4), role).toBe(false);
      expect(v.tokenIds, role).toEqual([eastGuardId, rookTokenId, westGuardId].sort());
    }
  });

  it('leaves the players and the TV a map covered everywhere but the runner’s sight, in one commit', async () => {
    const since = await mark();
    await fogOp(sceneId, { op: 'refog' });

    for (const { role, token } of viewers()) {
      const v = await view(sceneId, token);
      expect(v.fog.active, role).toBe(true);
      // Nothing the GM revealed is left on the wire, in either fashion.
      expect(v.fog.revealed, role).toEqual([]);
      expect(v.fog.regions, role).toEqual([]);
      expect(v.fog.revealedShapes, role).toEqual([]);
      expect(v.fog, role).not.toHaveProperty('exploredRegionIds');
      expect(v.fog, role).not.toHaveProperty('exploredShapes');
      expect(v.fog, role).not.toHaveProperty('brush');
      expect(v.raw, role).not.toContain('East room');
      // The memory is only what the runner sees now.
      const live = squares(v.fog, 'live');
      expect(v.fog.sight?.levels['0']?.explored, role).toBe(v.fog.sight?.levels['0']?.live);
      // Square by square: live exactly where he sees, hidden everywhere else,
      // and nothing anywhere shown as seen before.
      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          const want = cellBitsHas(live, col, row) ? 'live' : 'hidden';
          expect(cellState(v.fog, 0, col, row), `${role} ${col},${row}`).toBe(want);
        }
      }
      // His room is what he sees; the east room is dark again.
      expect(cellState(v.fog, 0, 0, 0), role).toBe('live');
      expect(cellState(v.fog, 0, 4, 8), role).toBe('live');
      for (const [col, row] of [[6, 0], [6, 4], [8, 4], [10, 7], [11, 8]] as const) {
        expect(cellState(v.fog, 0, col, row), `${role} ${col},${row}`).toBe('hidden');
      }
      // The guard in the dark is withheld, name and all; the one in sight stays.
      expect(v.tokenIds, role).toEqual([rookTokenId, westGuardId].sort());
      expect(v.raw, role).not.toContain(eastGuardId);
      expect(v.raw, role).not.toContain(EAST_GUARD);
    }

    // The GM keeps the region, hidden, and the switch is on.
    const gm = await view(sceneId, boot.gmToken);
    expect(gm.fog.enabled).toBe(true);
    expect(gm.fog.regions.map((r) => r.id)).toEqual(['fog.east']);
    expect(gm.fog.revealed).toEqual([]);
    expect(gm.fog).not.toHaveProperty('brush');
    expect(gm.tokenIds).toEqual([eastGuardId, rookTokenId, westGuardId].sort());

    // What the table heard: the op itself, bare, then the brush and the
    // memory whole, then the guard leaving; nobody arriving.
    const events = await tableSince(since);
    const fogEvents = events.filter((e) => e.type === 'fog.updated');
    expect(fogEvents.map((e) => e.payload['op'])).toEqual(['refog', 'brush', 'sight']);
    expect(fogEvents[0]!.payload).toEqual({ sceneId, op: 'refog', active: true });
    expect(fogEvents[1]!.payload['levels']).toEqual({});
    const phone = await view(sceneId, phoneToken);
    expect(fogEvents[2]!.payload['levels']).toEqual(phone.fog.sight?.levels);
    const removed = events.findIndex((e) => e.type === 'token.removed');
    expect(events.filter((e) => e.type === 'token.removed').map((e) => e.payload)).toEqual([{ tokenId: eastGuardId, sceneId }]);
    expect(removed).toBeGreaterThan(events.indexOf(fogEvents[0]!));
    expect(events.filter((e) => e.type === 'token.added')).toEqual([]);
  });

  it('is the GM’s alone', async () => {
    const res = await post(`/api/scenes/${sceneId}/fog`, phoneToken, { op: 'refog' });
    expect(res.statusCode).toBe(403);
  });
});

describe('Fog everything on an open scene', () => {
  it('switches the fog on with the rest: without sightlines the table sees nothing but the runners', async () => {
    const sceneId = await newScene('Rooftop', 6, 6);
    const rook = await place(sceneId, { source: 'character', sourceId: rookId, x: 1.5, y: 1.5 });
    const guard = await place(sceneId, { source: 'npc_template', name: 'Sniper-Mu', x: 4.5, y: 4.5 });
    // Never fogged: the table sees the whole roof and everyone on it.
    expect((await view(sceneId, phoneToken)).fog.active).toBe(false);
    expect((await view(sceneId, phoneToken)).tokenIds).toEqual([guard, rook].sort());

    const since = await mark();
    await fogOp(sceneId, { op: 'refog' });

    for (const token of [phoneToken, tvToken]) {
      const v = await view(sceneId, token);
      expect(v.fog.active).toBe(true);
      expect(v.fog).not.toHaveProperty('sight');
      for (let row = 0; row < 6; row += 1) {
        for (let col = 0; col < 6; col += 1) expect(cellState(v.fog, 0, col, row), `${col},${row}`).toBe('hidden');
      }
      // A runner is always on his own table; the sniper is not.
      expect(v.tokenIds).toEqual([rook]);
      expect(v.raw).not.toContain('Sniper-Mu');
    }
    expect((await view(sceneId, boot.gmToken)).fog.enabled).toBe(true);
    const events = await tableSince(since);
    expect(events.filter((e) => e.type === 'fog.updated').map((e) => e.payload)).toEqual([{ sceneId, op: 'refog', active: true }]);
    expect(events.filter((e) => e.type === 'token.removed').map((e) => e.payload['tokenId'])).toEqual([guard]);
  });
});
