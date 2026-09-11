/**
 * Doors a player can open (FR9.24).
 *
 * The one scene write a player may make, and the one refusal that matters:
 * a locked door. Traced doors by id, painted doors by cell; the lock is the
 * GM's; and what a player is TOLD about a lock is nothing at all — they
 * learn it by trying the handle.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Scene } from '@safehouse/contracts';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type JoinResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let sceneId: string;

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
}, 180_000);

afterAll(async () => {
  await t.close();
});

describe('traced doors', () => {
  it('a player opens an unlocked door, and closes it again', async () => {
    const opened = await door(player.token, { doorId: 'd.front', op: 'open' });
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toEqual({ door: { id: 'd.front', open: true, locked: false } });
    expect((await sceneAs(player.token)).geometry.doors.find((d) => d.id === 'd.front')?.open).toBe(true);

    const closed = await door(player.token, { doorId: 'd.front', op: 'close' });
    expect(closed.statusCode).toBe(200);
    expect((await sceneAs(boot.gmToken)).geometry.doors.find((d) => d.id === 'd.front')?.open).toBe(false);
  });

  it('a locked door refuses a player by name, and stays shut', async () => {
    const res = await door(player.token, { doorId: 'd.vault', op: 'open' });
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('door_locked');
    expect((await sceneAs(boot.gmToken)).geometry.doors.find((d) => d.id === 'd.vault')?.open).toBe(false);
  });

  it('the lock is the GM’s: a player may not lock or unlock; the GM may, and opens through it', async () => {
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

  it('404s a door that is not there', async () => {
    expect((await door(player.token, { doorId: 'd.nowhere', op: 'open' })).statusCode).toBe(404);
    expect((await door(player.token, { op: 'open' })).statusCode).toBe(400);
  });
});

describe('painted doors', () => {
  it('a player opens the door in a cell; the state rides beside the tiles', async () => {
    const res = await door(player.token, { cell: '3,4', op: 'open' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ door: { cell: '3,4', level: 0, open: true, locked: false } });
    const gm = await sceneAs(boot.gmToken);
    expect(gm.tiles?.structure['3,4']).toBe('building/door'); // stored as a slot; still a door
    expect(gm.tiles?.doors).toEqual({ '3,4': { open: true, locked: false } });
  });

  it('the GM locks it; the player is refused, and is not told', async () => {
    await door(boot.gmToken, { cell: '3,4', op: 'close' });
    const locked = await door(boot.gmToken, { cell: '3,4', op: 'lock' });
    expect(locked.json()).toEqual({ door: { cell: '3,4', level: 0, open: false, locked: true } });
    expect(code(await door(player.token, { cell: '3,4', op: 'open' }))).toBe('door_locked');
    const seen = await sceneAs(player.token);
    expect(seen.tiles?.doors?.['3,4']).toBeDefined();
    expect('locked' in (seen.tiles?.doors?.['3,4'] ?? {})).toBe(false);
  });

  it('a wall is not a door, and neither is an empty cell', async () => {
    expect((await door(player.token, { cell: '3,3', op: 'open' })).statusCode).toBe(404);
    expect((await door(player.token, { cell: '7,7', op: 'open' })).statusCode).toBe(404);
  });
});
