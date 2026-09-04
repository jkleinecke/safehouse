/**
 * M9 Grid REST coverage (FR9.1–9.14, Principle 4).
 *
 * The load-bearing assertions: a player's scene GET never contains a hidden
 * token or unrevealed fog geometry — filtered server-side at the query layer,
 * not by the client — and a GM-only map 404s on /files/:id for players.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { characters, combatants, scenes as scenesTable } from '@safehouse/db';
import { eq } from 'drizzle-orm';
import { activeSceneModifiers, computeScatter } from '../src/services/scenes.js';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let other: JoinResult;
let sceneId: string;
let characterId: string;

const HIDDEN_NAME = 'Ambusher-Zeta';
const SECRET_X = 987.5; // only ever inside the unrevealed fog region
const GM_NOTE = 'the ceiling collapses on turn three';

function gm(extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${boot.gmToken}`, ...extra };
}
function as(tok: string, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${tok}`, ...extra };
}

async function post(url: string, token: string, payload: unknown) {
  return t.app.inject({ method: 'POST', url, headers: as(token), payload: payload as object });
}

beforeAll(async () => {
  t = await makeTestApp('scenes');
  boot = await bootstrapCampaign(t.app, 'Redmond Barrens Job');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  other = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Bolt');

  const inserted = await t.db
    .insert(characters)
    .values({
      campaignId: boot.campaignId,
      ownerUserId: player.user.id,
      name: 'Static',
      sheet: { v: 1, identity: { alias: 'Static' }, attributes: { bod: 4, rea: 5, int: 4, wil: 3 } },
    })
    .returning();
  characterId = inserted[0]!.id;
}, 180_000);

afterAll(async () => {
  await t.close();
});

describe('scene CRUD + activation (FR9.1)', () => {
  it('creates a scene with the 1 m per square default grid', async () => {
    const res = await post(`/api/campaigns/${boot.campaignId}/scenes`, boot.gmToken, {
      name: 'Warehouse floor',
      notes: GM_NOTE,
    });
    expect(res.statusCode).toBe(201);
    const { scene } = res.json() as { scene: { id: string; grid: { unitM: number }; state: string } };
    expect(scene.grid.unitM).toBe(1);
    expect(scene.state).toBe('draft');
    sceneId = scene.id;
  });

  it('refuses scene authoring to players (§13 capability matrix)', async () => {
    const res = await post(`/api/campaigns/${boot.campaignId}/scenes`, player.token, { name: 'Nope' });
    expect(res.statusCode).toBe(403);
  });

  it('404s a staged (non-active) scene for players — no existence oracle', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: as(player.token) });
    expect(res.statusCode).toBe(404);
  });

  it('activates exactly one scene per campaign', async () => {
    const second = await post(`/api/campaigns/${boot.campaignId}/scenes`, boot.gmToken, { name: 'Rooftop' });
    const secondId = (second.json() as { scene: { id: string } }).scene.id;

    expect((await post(`/api/scenes/${secondId}/activate`, boot.gmToken, {})).statusCode).toBe(200);
    expect((await post(`/api/scenes/${sceneId}/activate`, boot.gmToken, {})).statusCode).toBe(200);

    const rows = await t.db.select().from(scenesTable).where(eq(scenesTable.campaignId, boot.campaignId));
    expect(rows.filter((r) => r.state === 'active').map((r) => r.id)).toEqual([sceneId]);
  });

  it('merges an environment patch (FR9.11) and keeps the rest of the scene', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      headers: gm(),
      payload: { environment: { light: 2 } },
    });
    expect(res.statusCode).toBe(200);
    const { scene } = res.json() as { scene: { environment: Record<string, number>; name: string } };
    expect(scene.environment.light).toBe(2);
    expect(scene.environment.wind).toBe(0);
    expect(scene.name).toBe('Warehouse floor');
  });
});

describe('hidden tokens and fog never reach a player payload (Principle 4)', () => {
  let hiddenTokenId: string;
  let visibleTokenId: string;
  let revealedRegionId: string;

  it('places a visible and a hidden token, plus two fog regions', async () => {
    const visible = await post(`/api/scenes/${sceneId}/tokens`, boot.gmToken, {
      source: 'character',
      sourceId: characterId,
      x: 3,
      y: 4,
    });
    expect(visible.statusCode).toBe(201);
    const vTok = (visible.json() as { token: { id: string; name: string } }).token;
    expect(vTok.name).toBe('Static'); // defaulted from the character (FR9.4)
    visibleTokenId = vTok.id;

    const hidden = await post(`/api/scenes/${sceneId}/tokens`, boot.gmToken, {
      source: 'prop',
      name: HIDDEN_NAME,
      x: 11,
      y: 12,
      hidden: true,
    });
    hiddenTokenId = (hidden.json() as { token: { id: string } }).token.id;

    const define = async (name: string, x: number) =>
      post(`/api/scenes/${sceneId}/fog`, boot.gmToken, {
        op: 'define',
        region: { name, polygon: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x, y: 1 }] },
      });
    expect((await define('east wing', 1)).statusCode).toBe(200);
    expect((await define('the lab', SECRET_X)).statusCode).toBe(200);

    const row = (await t.db.select().from(scenesTable).where(eq(scenesTable.id, sceneId)))[0]!;
    const fog = row.fog as { regions: { id: string; name: string }[] };
    revealedRegionId = fog.regions.find((r) => r.name === 'east wing')!.id;
    const reveal = await post(`/api/scenes/${sceneId}/fog`, boot.gmToken, {
      op: 'reveal',
      regionId: revealedRegionId,
      announce: true,
    });
    expect(reveal.statusCode).toBe(200);
  });

  it('gives the GM everything', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: gm() });
    const body = res.json() as {
      scene: { fog: { regions: unknown[] }; notes?: string };
      tokens: { id: string }[];
    };
    expect(body.tokens.map((x) => x.id).sort()).toEqual([hiddenTokenId, visibleTokenId].sort());
    expect(body.scene.fog.regions).toHaveLength(2);
    expect(body.scene.notes).toBe(GM_NOTE);
  });

  it('gives a player neither the hidden token nor unrevealed fog geometry', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/scenes/${sceneId}`,
      headers: as(player.token),
    });
    expect(res.statusCode).toBe(200);
    const raw = res.body;
    const body = res.json() as {
      scene: { fog: { regions: { id: string }[] }; notes?: string; geometry: { walls: unknown[] } };
      tokens: { id: string }[];
    };

    expect(body.tokens.map((x) => x.id)).toEqual([visibleTokenId]);
    expect(body.scene.fog.regions.map((r) => r.id)).toEqual([revealedRegionId]);
    expect(body.scene.notes).toBeUndefined();

    // Byte-level: the wire never carried the secret at all (Principle 4).
    expect(raw).not.toContain(HIDDEN_NAME);
    expect(raw).not.toContain(hiddenTokenId);
    expect(raw).not.toContain(String(SECRET_X));
    expect(raw).not.toContain(GM_NOTE);
  });

  it('hides the region again on op hide', async () => {
    expect(
      (await post(`/api/scenes/${sceneId}/fog`, boot.gmToken, { op: 'hide', regionId: revealedRegionId }))
        .statusCode,
    ).toBe(200);
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/scenes/${sceneId}`,
      headers: as(player.token),
    });
    expect((res.json() as { scene: { fog: { regions: unknown[] } } }).scene.fog.regions).toHaveLength(0);
    await post(`/api/scenes/${sceneId}/fog`, boot.gmToken, { op: 'reveal', regionId: revealedRegionId });
  });

  it('lets the owning player move only their own token (FR9.5)', async () => {
    const ok = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${visibleTokenId}`,
      headers: as(player.token),
      payload: { x: 9, y: 9 },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { token: { x: number } }).token.x).toBe(9);

    const nope = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${visibleTokenId}`,
      headers: as(other.token),
      payload: { x: 1, y: 1 },
    });
    expect(nope.statusCode).toBe(403);

    const notAProperty = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${visibleTokenId}`,
      headers: as(player.token),
      payload: { hidden: true },
    });
    expect(notAProperty.statusCode).toBe(403);
  });

  it('lets only the GM move a token between floors (FR9.5/9.22)', async () => {
    // Which storey somebody is on is a GM call, not a player one. A player may
    // walk their own token around a floor; taking the stairs is the GM saying
    // the run has moved. The rule falls out of `level` being a non-positional
    // property, and this pins that down so a later widening of the positional
    // set cannot quietly hand the decision to the table.
    const nope = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${visibleTokenId}`,
      headers: as(player.token),
      payload: { level: 1 },
    });
    expect(nope.statusCode).toBe(403);

    // Not even alongside a move they ARE allowed to make.
    const smuggled = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${visibleTokenId}`,
      headers: as(player.token),
      payload: { x: 4, y: 4, level: 1 },
    });
    expect(smuggled.statusCode).toBe(403);

    // And the floor really is untouched, not merely un-echoed.
    const after = await t.app.inject({
      method: 'GET',
      url: `/api/scenes/${sceneId}`,
      headers: as(boot.gmToken),
    });
    const seen = (after.json() as { tokens: { id: string; level: number }[] }).tokens;
    expect(seen.find((x) => x.id === visibleTokenId)?.level).toBe(0);

    // The GM's own hand moves it.
    const gmOk = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${visibleTokenId}`,
      headers: as(boot.gmToken),
      payload: { level: 1 },
    });
    expect(gmOk.statusCode).toBe(200);
    expect((gmOk.json() as { token: { level: number } }).token.level).toBe(1);
    await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${visibleTokenId}`,
      headers: as(boot.gmToken),
      payload: { level: 0 },
    });
  });

  it('moves a token between floors, and places one on the floor asked for (FR9.22)', async () => {
    // Both halves of taking the stairs. The route already accepted `level`
    // while the write dropped it, so the request came back 200 with the old
    // floor in the response — a runner who climbed the stairs and stayed put.
    const placed = await post(`/api/scenes/${sceneId}/tokens`, boot.gmToken, {
      source: 'prop',
      name: 'Crate',
      x: 3,
      y: 3,
      level: 1,
    });
    expect(placed.statusCode).toBe(201);
    const crate = (placed.json() as { token: { id: string; level: number } }).token;
    expect(crate.level).toBe(1);

    const moved = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${crate.id}`,
      headers: as(boot.gmToken),
      payload: { level: 0 },
    });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as { token: { level: number } }).token.level).toBe(0);

    // And it STUCK — a re-read, not just the write's own echo.
    const back = await t.app.inject({
      method: 'GET',
      url: `/api/scenes/${sceneId}`,
      headers: as(boot.gmToken),
    });
    const tokens = (back.json() as { tokens: { id: string; level: number }[] }).tokens;
    expect(tokens.find((x) => x.id === crate.id)?.level).toBe(0);
  });

  it('stages combatants from scene tokens, GM-hiding the hidden one (FR9.10)', async () => {
    const res = await post(`/api/scenes/${sceneId}/stage-encounter`, boot.gmToken, { name: 'Ambush' });
    expect(res.statusCode).toBe(201);
    const staged = res.json() as { encounterId: string; combatantIds: string[]; createdEncounter: boolean };
    expect(staged.createdEncounter).toBe(true);

    const rows = await t.db
      .select()
      .from(combatants)
      .where(eq(combatants.encounterId, staged.encounterId));
    // Only the character token stages: the hidden one is a prop (FR9.10).
    expect(rows.map((r) => r.name)).toEqual(['Static']);
    const staticRow = rows[0]!;
    expect(staticRow.tokenId).toBe(visibleTokenId);
    expect(staticRow.initBase).toBe(9); // REA 5 + INT 4
    expect((staticRow.monitors as { physical: { max: number } }).physical.max).toBe(10);
  });
});

describe('map uploads and /files/:id visibility (FR9.2, §13)', () => {
  const BOUNDARY = '----safehouseSceneTest';

  function multipart(fields: Record<string, string>, bytes: Buffer, mime: string): Buffer {
    const parts: Buffer[] = [];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
      );
    }
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="map.png"\r\n` +
          `Content-Type: ${mime}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    );
    return Buffer.concat(parts);
  }

  async function upload(visibility: string, body: string) {
    return t.app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: gm({ 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }),
      payload: multipart(
        { kind: 'map', visibility, campaign: boot.campaignId },
        Buffer.from(body),
        'image/png',
      ),
    });
  }

  it('rejects a mime type outside the allow list', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: gm({ 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }),
      payload: multipart({ kind: 'map' }, Buffer.from('nope'), 'application/x-msdownload'),
    });
    expect(res.statusCode).toBe(415);
  });

  it('serves a GM-only map to the GM and 404s it for a player', async () => {
    const res = await upload('gm', 'gm-only-map-bytes');
    expect(res.statusCode).toBe(201);
    const { attachment } = res.json() as { attachment: { id: string; url: string } };
    expect(attachment.url).toBe(`/files/${attachment.id}`);

    const asGm = await t.app.inject({ method: 'GET', url: attachment.url, headers: gm() });
    expect(asGm.statusCode).toBe(200);
    expect(asGm.body).toBe('gm-only-map-bytes');

    const asPlayer = await t.app.inject({ method: 'GET', url: attachment.url, headers: as(player.token) });
    expect(asPlayer.statusCode).toBe(404);

    const anon = await t.app.inject({ method: 'GET', url: attachment.url });
    expect(anon.statusCode).toBe(401);
  });

  it('serves a public map to a player, including via ?token=', async () => {
    const res = await upload('public', 'shared-map-bytes');
    const { attachment } = res.json() as { attachment: { id: string } };
    const viaHeader = await t.app.inject({
      method: 'GET',
      url: `/files/${attachment.id}`,
      headers: as(player.token),
    });
    expect(viaHeader.statusCode).toBe(200);
    const viaQuery = await t.app.inject({
      method: 'GET',
      url: `/files/${attachment.id}?token=${player.token}`,
    });
    expect(viaQuery.statusCode).toBe(200);
    expect(viaQuery.body).toBe('shared-map-bytes');
  });
});

describe('scene → roll bridge and pin visibility (FR9.11, FR9.3)', () => {
  it('exposes the active scene environment as scene modifiers for the rolls service', async () => {
    await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      headers: gm(),
      payload: { environment: { light: 3, visibility: 3 } },
    });
    const mods = await activeSceneModifiers(t.db, boot.campaignId);
    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({ source: { kind: 'scene' }, target: 'pool.all', op: 'add', active: true });
    expect(mods[0]!.value).toBe(-10); // two axes at the worst tier escalate
    expect(mods[0]!.note).toContain('environment');

    // Back to a workable dark: one axis at level 2 → −3.
    await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      headers: gm(),
      payload: { environment: { light: 2, visibility: 0 } },
    });
    expect((await activeSceneModifiers(t.db, boot.campaignId))[0]!.value).toBe(-3);
  });

  it('returns no modifiers when the campaign has no active scene', async () => {
    expect(await activeSceneModifiers(t.db, randomUUID())).toEqual([]);
  });

  it('sends players the public pins and none of the GM-layer geometry', async () => {
    await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      headers: gm(),
      payload: {
        geometry: {
          walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }],
          doors: [{ id: 'd1', a: { x: 4, y: 0 }, b: { x: 5, y: 0 }, open: false }],
          zones: [],
          pins: [
            { id: 'p-open', at: { x: 2, y: 2 }, label: 'loading bay', visibility: 'public' },
            { id: 'p-secret', at: { x: 8, y: 8 }, label: 'the stash', visibility: 'gm' },
          ],
        },
      },
    });
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/scenes/${sceneId}`,
      headers: as(player.token),
    });
    const geo = (res.json() as { scene: { geometry: { walls: unknown[]; doors: unknown[]; pins: { id: string }[] } } })
      .scene.geometry;
    expect(geo.walls).toEqual([]);
    expect(geo.doors).toEqual([]);
    expect(geo.pins.map((p) => p.id)).toEqual(['p-open']);
    expect(res.body).not.toContain('the stash');
  });
});

describe('scatter helper math (FR9.12)', () => {
  it('deviates by sum(dice) − net hits along the direction die sector', () => {
    const north = computeScatter({ x: 10, y: 10, directionDie: 1, distanceDice: [3, 4], netHits: 2 });
    expect(north.rawDistanceM).toBe(7);
    expect(north.distanceM).toBe(5);
    expect(north.angleDeg).toBe(0);
    expect(north.to.x).toBeCloseTo(10, 6);
    expect(north.to.y).toBeCloseTo(5, 6); // grid north is −y

    const south = computeScatter({ x: 10, y: 10, directionDie: 4, distanceDice: [3, 4], netHits: 2 });
    expect(south.angleDeg).toBe(180);
    expect(south.to.y).toBeCloseTo(15, 6);
  });

  it('never scatters a negative distance, however good the throw', () => {
    const r = computeScatter({ x: 0, y: 0, directionDie: 2, distanceDice: [1, 1], netHits: 12 });
    expect(r.distanceM).toBe(0);
    expect(r.to).toEqual({ x: 0, y: 0 });
  });

  it('converts metres to grid units when a square is not 1 m', () => {
    const r = computeScatter({ x: 0, y: 0, directionDie: 1, distanceDice: [6], netHits: 0, gridUnitM: 2 });
    expect(r.distanceM).toBe(6);
    expect(r.to.y).toBeCloseTo(-3, 6); // 6 m over 2 m squares = 3 units
  });

  it('rolls its own dice when none are supplied, honouring scatterDice', () => {
    const r = computeScatter({ x: 0, y: 0, scatterDice: 3 });
    expect(r.distanceDice).toHaveLength(3);
    for (const d of r.distanceDice) expect(d).toBeGreaterThanOrEqual(1);
    for (const d of r.distanceDice) expect(d).toBeLessThanOrEqual(6);
    expect(r.directionDie).toBeGreaterThanOrEqual(1);
    expect(r.directionDie).toBeLessThanOrEqual(6);
  });

  it('places an AoE template drawing when asked', async () => {
    const res = await post(`/api/scenes/${sceneId}/scatter`, boot.gmToken, {
      x: 2,
      y: 2,
      directionDie: 1,
      distanceDice: [2],
      scatterDice: 1,
      netHits: 0,
      placeTemplate: true,
      radiusM: 4,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { drawing: { kind: string; geometry: { radiusM: number } } };
    expect(body.drawing.kind).toBe('template');
    expect(body.drawing.geometry.radiusM).toBe(4);
  });
});
