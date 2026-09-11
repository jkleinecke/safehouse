/**
 * A set switch is a render decision (rules/tilesets/slots.ts): the squares
 * hold slots, the route changes one field per floor, and everything else —
 * the door's lock, the stair's direction, the map itself — is exactly as it
 * was. Painting under another set no longer replaces the floor either.
 */
import { describe, expect, it } from 'vitest';
import { bootstrapCampaign, makeTestApp } from './core-helpers.js';

async function sceneWithFloor() {
  const t = await makeTestApp('tileset-switch');
  const app = t.app;
  const { gmToken: gm, campaignId } = await bootstrapCampaign(app);
  const created = await app.inject({
    method: 'POST',
    url: `/api/campaigns/${campaignId}/scenes`,
    headers: { authorization: `Bearer ${gm}` },
    payload: { name: 'Slots' },
  });
  const sceneId = (created.json() as { scene: { id: string } }).scene.id;
  const paint = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/scenes/${sceneId}/tiles`, headers: { authorization: `Bearer ${gm}` }, payload });
  await paint({ tilesetId: 'docklands', paint: { '1,1': 'floor', '2,1': 'stain', '2,2': 'wall', '3,2': 'door', '1,2': 'crates' }, erase: [], level: 0 });
  const read = async () =>
    (await app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: { authorization: `Bearer ${gm}` } })).json() as { scene: { tiles: { tilesetId: string; ground: Record<string, string>; structure: Record<string, string>; object: Record<string, string>; doors?: Record<string, { open: boolean; locked: boolean }> } } };
  return { app, t, gm, sceneId, paint, read };
}

describe('slots on the server', () => {
  it('stores what was painted as slots, whatever id the client sent', async () => {
    const { t: app, read } = await sceneWithFloor();
    const t = (await read()).scene.tiles;
    expect(t.ground).toEqual({ '1,1': 'ground/1', '2,1': 'ground/2' });
    expect(t.structure).toEqual({ '2,2': 'building/wall', '3,2': 'building/door' });
    expect(t.object).toEqual({ '1,2': 'interior/1' });
    await app.close();
  });

  it('switches the set with one field, keeping every square and the door’s lock', async () => {
    const { app, t: test, gm, sceneId, read } = await sceneWithFloor();
    const locked = await app.inject({
      method: 'POST',
      url: `/api/scenes/${sceneId}/doors`,
      headers: { authorization: `Bearer ${gm}` },
      payload: { cell: '3,2', level: 0, op: 'lock' },
    });
    expect(locked.statusCode, locked.body).toBe(200);
    const before = (await read()).scene.tiles;
    expect(before.doors?.['3,2']?.locked).toBe(true);

    const switched = await app.inject({
      method: 'POST',
      url: `/api/scenes/${sceneId}/tileset`,
      headers: { authorization: `Bearer ${gm}` },
      payload: { tilesetId: 'corp' },
    });
    expect(switched.statusCode, switched.body).toBe(200);
    const after = (await read()).scene.tiles;
    expect(after.tilesetId).toBe('corp');
    expect(after.ground).toEqual(before.ground);
    expect(after.structure).toEqual(before.structure);
    expect(after.object).toEqual(before.object);
    expect(after.doors).toEqual(before.doors);

    const unknown = await app.inject({
      method: 'POST',
      url: `/api/scenes/${sceneId}/tileset`,
      headers: { authorization: `Bearer ${gm}` },
      payload: { tilesetId: 'no-such-set' },
    });
    expect(unknown.statusCode).toBe(400);
    await test.close();
  });

  it('a stroke under another set keeps the floor and changes only what it is drawn in', async () => {
    const { t: app, paint, read } = await sceneWithFloor();
    const res = await paint({ tilesetId: 'sprawl', paint: { '5,5': 'road' }, erase: [], level: 0 });
    expect(res.statusCode, res.body).toBe(200);
    const t = (await read()).scene.tiles;
    expect(t.tilesetId).toBe('sprawl');
    expect(t.ground['1,1']).toBe('ground/1');
    expect(t.ground['5,5']).toBe('ground/1');
    expect(t.structure['3,2']).toBe('building/door');
    await app.close();
  });

  it('a slot is accepted as paint, and a legacy id keeps its meaning', async () => {
    const { t: app, paint, read } = await sceneWithFloor();
    const res = await paint({ tilesetId: 'docklands', paint: { '6,6': 'interior/3', '7,7': 'barrel' }, erase: [], level: 0 });
    expect(res.statusCode, res.body).toBe(200);
    const t = (await read()).scene.tiles;
    expect(t.object['6,6']).toBe('interior/3');
    expect(t.object['7,7']).toBe('decoration/1');
    await app.close();
  });
});
