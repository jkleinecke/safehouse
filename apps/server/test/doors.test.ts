/**
 * Doors a player can open (FR9.24), from next to them (the GM, 2026-09-27).
 *
 * The one scene write a player may make, and the refusals that matter: a
 * locked door, and a door the runner is not standing next to ("a player can
 * open or close a door only when their runner is standing next to it; the
 * GM can from anywhere"). Traced doors by id, painted doors by cell; the
 * lock is the GM's; and what a player is TOLD about a lock is nothing at
 * all — they learn it by trying the handle, and only a runner at the handle
 * can try it. A player across the map hears the same "not next to it" for
 * a locked door, an open one and one that is not there.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Scene } from '@safehouse/contracts';
import { characters } from '@safehouse/db';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type JoinResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let sceneId: string;
let runnerId: string;

/** A token's centre in square (`col`, `row`). */
const sq = (col: number, row: number) => ({ x: col + 0.5, y: row + 0.5 });

/** What a player too far from a door is told, whatever the door. */
const OUT_OF_REACH = { error: { code: 'door_out_of_reach', message: 'Your runner needs to be next to that door' } };

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}
async function post(url: string, token: string, payload: unknown) {
  return t.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as object });
}
async function patch(url: string, token: string, payload: unknown) {
  return t.app.inject({ method: 'PATCH', url, headers: auth(token), payload: payload as object });
}
async function sceneAs(token: string): Promise<Scene> {
  const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return (res.json() as { scene: Scene }).scene;
}
function door(token: string, body: Record<string, unknown>) {
  return post(`/api/scenes/${sceneId}/doors`, token, body);
}
function code(res: { json(): unknown }): string {
  return (res.json() as { error: { code: string } }).error.code;
}
/** The error body without anything that varies per request. */
function refusal(res: { json(): unknown }): unknown {
  const { error } = res.json() as { error: { code: string; message: string } };
  return { error: { code: error.code, message: error.message } };
}

/** The GM puts the player's runner in square (`col`, `row`). */
async function standAt(col: number, row: number): Promise<void> {
  const res = await patch(`/api/tokens/${runnerId}`, boot.gmToken, sq(col, row));
  expect(res.statusCode).toBe(200);
}

/*
 * The map (docklands, the default grid):
 * - traced doors down the grid line x = 4 (d.front, y 0–2) and x = 9
 *   (d.vault, y 0–2, locked);
 * - a painted door in square (3,4), walls above and below it.
 * The player's runner is put beside whichever door a test is about.
 */
beforeAll(async () => {
  t = await makeTestApp('doors');
  boot = await bootstrapCampaign(t.app, 'Locked Ward');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  const created = await post(`/api/campaigns/${boot.campaignId}/scenes`, boot.gmToken, { name: 'Clinic' });
  sceneId = (created.json() as { scene: { id: string } }).scene.id;
  await post(`/api/scenes/${sceneId}/activate`, boot.gmToken, {});
  const traced = await patch(`/api/scenes/${sceneId}`, boot.gmToken, {
    geometry: {
      walls: [],
      doors: [
        { id: 'd.front', a: { x: 4, y: 0 }, b: { x: 4, y: 2 } },
        { id: 'd.vault', a: { x: 9, y: 0 }, b: { x: 9, y: 2 }, locked: true },
      ],
      zones: [],
      pins: [],
    },
  });
  expect(traced.statusCode).toBe(200);
  // A painted door as well: one cell of a structure layer.
  const painted = await post(`/api/scenes/${sceneId}/tiles`, boot.gmToken, {
    tilesetId: 'docklands',
    paint: { '3,4': 'door', '3,3': 'wall', '3,5': 'wall' },
  });
  expect(painted.statusCode).toBe(200);
  // The player's runner, beside the front door to begin with.
  const character = await t.db
    .insert(characters)
    .values({
      campaignId: boot.campaignId,
      ownerUserId: player.user.id,
      name: 'Static',
      sheet: { v: 1, identity: { alias: 'Static' }, attributes: { bod: 4, rea: 5, int: 4, wil: 3 } },
    })
    .returning();
  const runner = await post(`/api/scenes/${sceneId}/tokens`, boot.gmToken, {
    source: 'character',
    sourceId: character[0]!.id,
    ...sq(3, 1),
  });
  expect(runner.statusCode).toBe(201);
  runnerId = (runner.json() as { token: { id: string } }).token.id;
}, 180_000);

afterAll(async () => {
  await t.close();
});

describe('traced doors', () => {
  it('a player beside an unlocked door opens it, and closes it again', async () => {
    await standAt(3, 1);
    const opened = await door(player.token, { doorId: 'd.front', op: 'open' });
    expect(opened.statusCode).toBe(200);
    // The door's state, less its lock: that is the GM's.
    expect(opened.json()).toEqual({ door: { id: 'd.front', open: true } });
    expect((await sceneAs(player.token)).geometry.doors.find((d) => d.id === 'd.front')?.open).toBe(true);

    const closed = await door(player.token, { doorId: 'd.front', op: 'close' });
    expect(closed.statusCode).toBe(200);
    expect((await sceneAs(boot.gmToken)).geometry.doors.find((d) => d.id === 'd.front')?.open).toBe(false);
  });

  it('a locked door refuses a player beside it by name, and stays shut', async () => {
    await standAt(8, 1);
    const res = await door(player.token, { doorId: 'd.vault', op: 'open' });
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('door_locked');
    expect((await sceneAs(boot.gmToken)).geometry.doors.find((d) => d.id === 'd.vault')?.open).toBe(false);
  });

  it('the lock is the GM’s: a player may not lock or unlock; the GM may, and opens through it', async () => {
    await standAt(8, 1);
    expect((await door(player.token, { doorId: 'd.front', op: 'lock' })).statusCode).toBe(403);
    expect((await door(player.token, { doorId: 'd.vault', op: 'unlock' })).statusCode).toBe(403);

    // The GM opens a locked door without unlocking it (they have the key).
    const gmOpen = await door(boot.gmToken, { doorId: 'd.vault', op: 'open' });
    expect(gmOpen.json()).toEqual({ door: { id: 'd.vault', open: true, locked: true } });
    await door(boot.gmToken, { doorId: 'd.vault', op: 'close' });

    const unlocked = await door(boot.gmToken, { doorId: 'd.vault', op: 'unlock' });
    expect(unlocked.json()).toEqual({ door: { id: 'd.vault', open: false, locked: false } });
    expect((await door(player.token, { doorId: 'd.vault', op: 'open' })).statusCode).toBe(200);

    // …and locks it behind them.
    await door(boot.gmToken, { doorId: 'd.vault', op: 'close' });
    const relocked = await door(boot.gmToken, { doorId: 'd.vault', op: 'lock' });
    expect(relocked.json()).toEqual({ door: { id: 'd.vault', open: false, locked: true } });
    expect(code(await door(player.token, { doorId: 'd.vault', op: 'open' }))).toBe('door_locked');
  });

  it('players are not told which doors are locked', async () => {
    const seen = await sceneAs(player.token);
    for (const d of seen.geometry.doors) expect('locked' in d).toBe(false);
    expect((await sceneAs(boot.gmToken)).geometry.doors.find((d) => d.id === 'd.vault')?.locked).toBe(true);
  });

  it('404s a door that is not there, to the GM; a request naming no door is a 400', async () => {
    expect((await door(boot.gmToken, { doorId: 'd.nowhere', op: 'open' })).statusCode).toBe(404);
    expect((await door(player.token, { op: 'open' })).statusCode).toBe(400);
  });
});

describe('painted doors', () => {
  it('a player beside the door in a cell opens it; the state rides beside the tiles', async () => {
    await standAt(2, 4);
    const res = await door(player.token, { cell: '3,4', op: 'open' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ door: { cell: '3,4', level: 0, open: true } });
    const gm = await sceneAs(boot.gmToken);
    expect(gm.tiles?.structure['3,4']).toBe('building/door'); // stored as a slot; still a door
    expect(gm.tiles?.doors).toEqual({ '3,4': { open: true, locked: false } });
  });

  it('the GM locks it; the player beside it is refused, and is not told', async () => {
    await standAt(2, 4);
    await door(boot.gmToken, { cell: '3,4', op: 'close' });
    const locked = await door(boot.gmToken, { cell: '3,4', op: 'lock' });
    expect(locked.json()).toEqual({ door: { cell: '3,4', level: 0, open: false, locked: true } });
    expect(code(await door(player.token, { cell: '3,4', op: 'open' }))).toBe('door_locked');
    const seen = await sceneAs(player.token);
    expect(seen.tiles?.doors?.['3,4']).toBeDefined();
    expect('locked' in (seen.tiles?.doors?.['3,4'] ?? {})).toBe(false);
    // Unlocked again for the tests after.
    await door(boot.gmToken, { cell: '3,4', op: 'unlock' });
  });

  it('beside a wall or an empty cell, there is no door to open', async () => {
    await standAt(2, 3);
    expect((await door(player.token, { cell: '3,3', op: 'open' })).statusCode).toBe(404);
    await standAt(7, 7);
    expect((await door(player.token, { cell: '7,7', op: 'open' })).statusCode).toBe(404);
  });
});

describe('a player’s runner must stand next to the door (the GM, 2026-09-27)', () => {
  it('a player far from every door hears the same answer, locked, unlocked, open or not there', async () => {
    // One door of each kind open, one shut, one locked: the GM sets them.
    await door(boot.gmToken, { doorId: 'd.front', op: 'open' });
    await door(boot.gmToken, { cell: '3,4', op: 'lock' });
    await standAt(20, 20);
    const asks: Record<string, unknown>[] = [
      { doorId: 'd.front' }, // open, unlocked
      { doorId: 'd.vault' }, // shut, locked
      { doorId: 'd.nowhere' }, // not there
      { cell: '3,4' }, // shut, locked
      { cell: '3,3' }, // a wall
      { cell: '7,7' }, // bare floor
      { cell: '3,4', level: 3 }, // a floor the scene does not have
    ];
    for (const ask of asks) {
      for (const op of ['open', 'close'] as const) {
        const res = await door(player.token, { ...ask, op });
        expect(res.statusCode, `${JSON.stringify(ask)} ${op}`).toBe(403);
        expect(refusal(res), `${JSON.stringify(ask)} ${op}`).toEqual(OUT_OF_REACH);
      }
    }
    // And nothing moved.
    const gm = await sceneAs(boot.gmToken);
    expect(gm.geometry.doors.find((d) => d.id === 'd.front')?.open).toBe(true);
    expect(gm.geometry.doors.find((d) => d.id === 'd.vault')?.open).toBe(false);
    expect(gm.tiles?.doors?.['3,4']).toEqual({ open: false, locked: true });
    await door(boot.gmToken, { doorId: 'd.front', op: 'close' });
    await door(boot.gmToken, { cell: '3,4', op: 'unlock' });
  });

  it('a player with no runner on the scene, and the table’s display, are next to no door', async () => {
    const stranger = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Nobody');
    const tv = await joinAs(t.app, boot.campaignId, boot.gmToken, 'display', 'Table TV');
    for (const token of [stranger.token, tv.token]) {
      for (const ask of [{ doorId: 'd.front' }, { doorId: 'd.vault' }, { cell: '3,4' }]) {
        const res = await door(token, { ...ask, op: 'open' });
        expect(res.statusCode).toBe(403);
        expect(refusal(res)).toEqual(OUT_OF_REACH);
      }
    }
  });

  it('shutting a door never answers “locked”, even one the GM left standing open and locked', async () => {
    await door(boot.gmToken, { doorId: 'd.vault', op: 'open' });
    expect((await sceneAs(boot.gmToken)).geometry.doors.find((d) => d.id === 'd.vault')).toMatchObject({ open: true, locked: true });
    await standAt(8, 1);
    // Pushing on a door that stands open is no refusal either, and tells nothing.
    const pushed = await door(player.token, { doorId: 'd.vault', op: 'open' });
    expect(pushed.statusCode).toBe(200);
    expect(pushed.json()).toEqual({ door: { id: 'd.vault', open: true } });
    const shut = await door(player.token, { doorId: 'd.vault', op: 'close' });
    expect(shut.statusCode).toBe(200);
    expect(shut.json()).toEqual({ door: { id: 'd.vault', open: false } });
    // Shut, it is still locked, and now the handle says so.
    expect((await sceneAs(boot.gmToken)).geometry.doors.find((d) => d.id === 'd.vault')).toMatchObject({ open: false, locked: true });
    expect(code(await door(player.token, { doorId: 'd.vault', op: 'open' }))).toBe('door_locked');
    // The same for a painted door: locked and open, shut by the runner beside it.
    await door(boot.gmToken, { cell: '3,4', op: 'lock' });
    await door(boot.gmToken, { cell: '3,4', op: 'open' });
    await standAt(4, 4);
    const shutPainted = await door(player.token, { cell: '3,4', op: 'close' });
    expect(shutPainted.statusCode).toBe(200);
    expect(shutPainted.json()).toEqual({ door: { cell: '3,4', level: 0, open: false } });
    expect(code(await door(player.token, { cell: '3,4', op: 'open' }))).toBe('door_locked');
    await door(boot.gmToken, { cell: '3,4', op: 'unlock' });
  });

  it('the GM opens, shuts, locks and unlocks from anywhere, with no runner at all', async () => {
    for (const op of ['open', 'close', 'unlock', 'lock'] as const) {
      expect((await door(boot.gmToken, { doorId: 'd.vault', op })).statusCode, op).toBe(200);
      expect((await door(boot.gmToken, { cell: '3,4', op })).statusCode, op).toBe(200);
    }
    await door(boot.gmToken, { cell: '3,4', op: 'unlock' });
  });

  it('a painted door is reached from its own square and the eight round it, not from two away', async () => {
    for (const [col, row] of [[2, 3], [4, 5], [2, 4], [4, 4]] as const) {
      await standAt(col, row);
      expect((await door(player.token, { cell: '3,4', op: 'open' })).statusCode, `${col},${row}`).toBe(200);
      expect((await door(player.token, { cell: '3,4', op: 'close' })).statusCode, `${col},${row}`).toBe(200);
    }
    for (const [col, row] of [[1, 4], [5, 4], [3, 6], [5, 2]] as const) {
      await standAt(col, row);
      const res = await door(player.token, { cell: '3,4', op: 'open' });
      expect(refusal(res), `${col},${row}`).toEqual(OUT_OF_REACH);
    }
  });

  it('a traced door is reached from the squares either side of its line and off its ends, not from a square back', async () => {
    // d.front runs down x = 4 from y = 0 to y = 2: squares (3, 0..1) on its
    // left, (4, 0..1) on its right, and (3,2) and (4,2) diagonally off its
    // lower end, all touch the box a square round the runner's middle.
    for (const [col, row] of [[3, 0], [4, 1], [3, 2], [4, 2]] as const) {
      await standAt(col, row);
      expect((await door(player.token, { doorId: 'd.front', op: 'open' })).statusCode, `${col},${row}`).toBe(200);
      expect((await door(player.token, { doorId: 'd.front', op: 'close' })).statusCode, `${col},${row}`).toBe(200);
    }
    // A square back from the line, or a square past its end.
    for (const [col, row] of [[2, 1], [5, 1], [3, 3], [4, 3]] as const) {
      await standAt(col, row);
      const res = await door(player.token, { doorId: 'd.front', op: 'open' });
      expect(refusal(res), `${col},${row}`).toEqual(OUT_OF_REACH);
    }
  });
});
