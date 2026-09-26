/**
 * Scenes to files and back (services/scene-transfer.ts).
 *
 * The round trip must bring the whole scene: its map image as a new file of
 * the campaign it lands in, its tokens with new ids and the token layers
 * pointing at them, and nothing that only meant something where it came from.
 */
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaigns, characters } from '@safehouse/db';
import { SceneFileSchema } from '@safehouse/contracts';
import { importScene, unpackFiles } from '../src/services/scene-transfer.js';
import { ScenesService } from '../src/services/scenes.js';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type JoinResult, type TestApp } from './core-helpers.js';

// A 1×1 PNG: real bytes, so the store's type sniff lets it in.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let t: TestApp;
let home: BootstrapResult;
/** Another campaign on the same server, which the file must open in. */
let awayId: string;
let player: JoinResult;
let sceneId: string;
let characterId: string;
let mapId: string;
let tokenIds: { runner: string; guard: string };

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  t = await makeTestApp('scene-transfer');
  home = await bootstrapCampaign(t.app, 'Home Game');
  awayId = (await t.db.insert(campaigns).values({ name: 'Convention Table', gmUserId: home.gmUserId }).returning())[0]!.id;
  player = await joinAs(t.app, home.campaignId, home.gmToken, 'player', 'Static');
  characterId = (
    await t.db
      .insert(characters)
      .values({ campaignId: home.campaignId, name: 'Static', sheet: { v: 1, identity: { alias: 'Static' } } })
      .returning()
  )[0]!.id;
  const map = await new ScenesService(t.db).saveAttachment({
    campaignId: home.campaignId,
    kind: 'map',
    visibility: 'gm',
    mime: 'image/png',
    file: Readable.from(PNG),
  });
  mapId = map.id;

  const created = await t.app.inject({
    method: 'POST',
    url: `/api/campaigns/${home.campaignId}/scenes`,
    headers: auth(home.gmToken),
    payload: {
      name: 'Warehouse',
      mapAttachmentIds: [mapId],
      notes: 'the ceiling collapses on turn three',
      geometry: {
        walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }],
        doors: [],
        zones: [],
        pins: [{ id: 'p1', at: { x: 1, y: 1 }, label: 'Stash', wikiPageId: 'wiki-1' }],
      },
    },
  });
  sceneId = (created.json() as { scene: { id: string } }).scene.id;
  const place = async (payload: object) =>
    (
      (
        await t.app.inject({ method: 'POST', url: `/api/scenes/${sceneId}/tokens`, headers: auth(home.gmToken), payload })
      ).json() as { token: { id: string } }
    ).token.id;
  tokenIds = {
    runner: await place({ source: 'character', sourceId: characterId, x: 2.5, y: 2.5, look: { archetype: 'decker' } }),
    guard: await place({ source: 'prop', name: 'Crate', x: 5.5, y: 3.5, hidden: true, pose: 'stand' }),
  };
  await t.app.inject({
    method: 'PATCH',
    url: `/api/scenes/${sceneId}`,
    headers: auth(home.gmToken),
    payload: { tokenLayers: [{ id: 'l1', name: 'Ambush', hidden: true, tokenIds: [tokenIds.guard] }] },
  });
}, 180_000);

afterAll(async () => {
  await t.close();
});

async function exportFile() {
  const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}/export`, headers: auth(home.gmToken) });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-disposition']).toContain('Warehouse.safehouse-scene.json');
  return res.json() as {
    format: string;
    tokens: Array<{ id: string; name: string; hidden: boolean }>;
    files: Record<string, { data: string }>;
    scene: { notes?: string };
  };
}

async function importInto(campaign: BootstrapResult, file: unknown) {
  return t.app.inject({
    method: 'POST',
    url: `/api/campaigns/${campaign.campaignId}/scenes/import`,
    headers: auth(campaign.gmToken),
    payload: file as object,
  });
}

async function opened(campaign: BootstrapResult, id: string) {
  const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${id}`, headers: auth(campaign.gmToken) });
  return res.json() as {
    scene: {
      name: string;
      mapAttachmentIds: string[];
      tokenLayers?: Array<{ tokenIds: string[] }>;
      geometry: { walls: unknown[]; pins: Array<{ wikiPageId?: string }> };
      notes?: string;
    };
    tokens: Array<{ id: string; name: string; sourceId: string | null; hidden: boolean; look: { archetype?: string } | null }>;
  };
}

describe('scene export', () => {
  it('packs the scene, every token (hidden ones too) and the files it draws on', async () => {
    const file = await exportFile();
    expect(file.format).toBe('safehouse.scene');
    expect(file.tokens.map((x) => x.name).sort()).toEqual(['Crate', 'Static']);
    expect(Buffer.from(file.files[mapId]!.data, 'base64').equals(PNG)).toBe(true);
    expect(file.scene.notes).toBe('the ceiling collapses on turn three');
  });

  it('is the GM’s alone', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}/export`, headers: auth(player.token) });
    expect(res.statusCode).toBe(403);
  });
});

describe('scene import', () => {
  it('rebuilds it in the same campaign with new ids, links kept, and a name that says it is a copy', async () => {
    const res = await importInto(home, await exportFile());
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { scene: { id: string } }).scene.id;
    expect(id).not.toBe(sceneId);
    const s = await opened(home, id);
    expect(s.scene.name).toBe('Warehouse (imported)');
    expect(s.scene.geometry.walls).toHaveLength(1);
    expect(s.scene.geometry.pins[0]!.wikiPageId).toBe('wiki-1');
    // The map is a new file with the same bytes.
    expect(s.scene.mapAttachmentIds).toHaveLength(1);
    expect(s.scene.mapAttachmentIds[0]).not.toBe(mapId);
    // New tokens; the runner still the runner; the layer holds the new crate.
    const runner = s.tokens.find((x) => x.name === 'Static')!;
    const crate = s.tokens.find((x) => x.name === 'Crate')!;
    expect(runner.id).not.toBe(tokenIds.runner);
    expect(runner.sourceId).toBe(characterId);
    expect(runner.look?.archetype).toBe('decker');
    expect(crate.hidden).toBe(true);
    expect(s.scene.tokenLayers?.[0]?.tokenIds).toEqual([crate.id]);
  });

  it('opens in another campaign, leaving behind the links that only meant something at home', async () => {
    const file = SceneFileSchema.parse(await exportFile());
    const ids = await unpackFiles(t.db, awayId, file);
    const scene = await importScene(t.db, awayId, file, ids);
    const svc = new ScenesService(t.db);
    const s = await svc.composedScene(await svc.sceneRow(scene.id), true);
    expect(s.scene.campaignId).toBe(awayId);
    expect(s.scene.name).toBe('Warehouse');
    expect(s.scene.geometry.pins[0]!.wikiPageId).toBeUndefined();
    const runner = s.tokens.find((x) => x.name === 'Static')!;
    expect(runner.sourceId).toBeNull();
    expect(runner.look?.archetype).toBe('decker');
    // Its map is this campaign's own file.
    const map = await svc.attachment(s.scene.mapAttachmentIds[0]!);
    expect(map?.campaignId).toBe(awayId);
  });

  it('refuses a file that is not a scene, and says so', async () => {
    const res = await importInto(home, { format: 'something.else', version: 1 });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error?: { code?: string }; code?: string }).error?.code ?? (res.json() as { code?: string }).code).toBe('not_a_scene_file');
  });
});
