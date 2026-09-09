/**
 * GM notes on the map (FR9.25) live beside the scene's own text notes.
 *
 * The scene's geometry and its free-text `notes` share one JSONB envelope,
 * and the first cut of map notes was called `notes` too: the envelope's
 * string failed the geometry parse, the parse fell back to EMPTY, and the
 * next unrelated write saved that — every wall on the map, gone. This pins
 * the two coexisting, and the map notes never reaching a player.
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
async function patch(payload: unknown, token = boot.gmToken) {
  return t.app.inject({ method: 'PATCH', url: `/api/scenes/${sceneId}`, headers: auth(token), payload: payload as object });
}
async function sceneAs(token: string): Promise<Scene> {
  const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return (res.json() as { scene: Scene }).scene;
}

const WALL = { id: 'w1', a: { x: 0, y: 0 }, b: { x: 8, y: 0 } };
const NOTE = { id: 'note_1', at: { x: 2, y: 2 }, text: 'The guard is asleep until someone shoots.', width: 4 };

beforeAll(async () => {
  t = await makeTestApp('gm-notes');
  boot = await bootstrapCampaign(t.app, 'Notes in the Margin');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  const created = await t.app.inject({
    method: 'POST',
    url: `/api/campaigns/${boot.campaignId}/scenes`,
    headers: auth(boot.gmToken),
    payload: { name: 'Back office' },
  });
  sceneId = (created.json() as { scene: { id: string } }).scene.id;
  await t.app.inject({ method: 'POST', url: `/api/scenes/${sceneId}/activate`, headers: auth(boot.gmToken), payload: {} });
}, 180_000);

afterAll(async () => {
  await t.close();
});

describe('map notes beside scene notes', () => {
  it('a scene with text notes keeps its walls when a map note is added, and after an unrelated write', async () => {
    expect((await patch({ notes: 'Run this one slow.' })).statusCode).toBe(200);
    expect((await patch({ geometry: { walls: [WALL], doors: [], zones: [], pins: [], gmNotes: [NOTE] } })).statusCode).toBe(200);
    let seen = await sceneAs(boot.gmToken);
    expect(seen.notes).toBe('Run this one slow.');
    expect(seen.geometry.walls.map((w) => w.id)).toEqual(['w1']);
    expect(seen.geometry.gmNotes).toEqual([NOTE]);

    // The write that used to save the empty fallback: nothing to do with geometry.
    expect((await patch({ environment: { light: 2 } })).statusCode).toBe(200);
    seen = await sceneAs(boot.gmToken);
    expect(seen.geometry.walls.map((w) => w.id)).toEqual(['w1']);
    expect(seen.geometry.gmNotes).toEqual([NOTE]);
    expect(seen.notes).toBe('Run this one slow.');
  });

  it('a player receives neither kind of note, and nothing says there is a list', async () => {
    const seen = await sceneAs(player.token);
    expect('gmNotes' in seen.geometry).toBe(false);
    expect('notes' in seen).toBe(false);
    expect(JSON.stringify(seen)).not.toContain('asleep');
    expect(seen.geometry.walls.map((w) => w.id)).toEqual(['w1']);
  });
});
