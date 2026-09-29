/**
 * M9 Grid REST coverage (FR9.1–9.14, Principle 4).
 *
 * The load-bearing assertions: a player's scene GET never contains a hidden
 * token or unrevealed fog geometry — filtered server-side at the query layer,
 * not by the client — and a GM-only map 404s on /files/:id for players.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { characters, combatants, scenes as scenesTable } from '@safehouse/db';
import { SheetV1Schema } from '@safehouse/contracts';
import {
  brushReader,
  cellBitsCount,
  cellBitsHas,
  cellState,
  decodeCellBits,
  type CellBits,
} from '@safehouse/rules';
import { eq } from 'drizzle-orm';
import { ScenesService, activeSceneModifiers, computeScatter } from '../src/services/scenes.js';
// The fog a player is sent, shared with the web's tests so the server's
// output here is exactly the map's input there (see the file for why).
import { FOG_WIRE_UNREVEALED } from '../../../packages/contracts/test/fog-fixtures.js';
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

  it('patches only the keys it is sent: a grid or environment patch keeps the rest of each', async () => {
    // zod fills a missing key's default even in a `.partial()` schema, and the
    // service merges the patch over the stored scene. So widening the map
    // put it back on 1 m squares, uncalibrated and top-down, and darkening
    // it cleared its smoke, glare and wind.
    const made = await post(`/api/campaigns/${boot.campaignId}/scenes`, boot.gmToken, { name: 'Smoky arcade' });
    const id = (made.json() as { scene: { id: string } }).scene.id;
    const patch = async (payload: Record<string, unknown>) => {
      const res = await t.app.inject({ method: 'PATCH', url: `/api/scenes/${id}`, headers: gm(), payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(200);
      return (res.json() as { scene: { grid: Record<string, unknown>; environment: Record<string, unknown> } }).scene;
    };

    await patch({
      grid: { unitM: 2, offset: { x: 0.5, y: 0.25 }, projection: 'iso', opacity: 0.4 },
      environment: { visibility: 2, glare: 1, wind: 3, note: 'smoke machine' },
    });
    const widened = await patch({ grid: { cols: 44 } });
    expect(widened.grid).toEqual({ unitM: 2, cols: 44, rows: 30, offset: { x: 0.5, y: 0.25 }, projection: 'iso', opacity: 0.4 });
    const darkened = await patch({ environment: { light: 3 } });
    expect(darkened.environment).toEqual({ light: 3, visibility: 2, glare: 1, wind: 3, note: 'smoke machine' });
    // Each key keeps its own bounds: a patch still cannot say nonsense.
    for (const payload of [{ grid: { unitM: -1 } }, { grid: { projection: 'fisheye' } }, { environment: { light: 4 } }]) {
      const res = await t.app.inject({ method: 'PATCH', url: `/api/scenes/${id}`, headers: gm(), payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
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

    // A new scene starts with its fog off; the GM throws the switch first.
    expect((await post(`/api/scenes/${sceneId}/fog`, boot.gmToken, { op: 'enable' })).statusCode).toBe(200);
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

  it('hides the region again on op hide, and the player is still told the scene is fogged', async () => {
    expect(
      (await post(`/api/scenes/${sceneId}/fog`, boot.gmToken, { op: 'hide', regionId: revealedRegionId }))
        .statusCode,
    ).toBe(200);
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/scenes/${sceneId}`,
      headers: as(player.token),
    });
    // This used to assert only that the list was empty, and that was the bug
    // itself, written down as the expected answer: a fogged scene with
    // nothing revealed reached the player as `regions: []` and nothing else,
    // which the map read as a scene with no fog. The whole map was open on
    // every phone and the TV. The copy must also say the scene IS fogged, and
    // it must be exactly the copy the web's tests draw (`FOG_WIRE_UNREVEALED`).
    expect((res.json() as { scene: { fog: unknown } }).scene.fog).toEqual(FOG_WIRE_UNREVEALED);
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

  it("lets a player dress and pose their own runner — in every scene — and nobody else's", async () => {
    const look = { archetype: 'decker', metatype: 'elf', colors: { coat: '#202830' } };
    const ok = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${visibleTokenId}`,
      headers: as(player.token),
      payload: { look, pose: 'crouch' },
    });
    expect(ok.statusCode).toBe(200);
    const dressed = (ok.json() as { token: { look: typeof look; pose: string } }).token;
    expect(dressed.look).toMatchObject(look);
    expect(dressed.pose).toBe('crouch');

    // The look is the runner's: a token of theirs placed in another scene arrives dressed.
    const rooftop = await post(`/api/campaigns/${boot.campaignId}/scenes`, boot.gmToken, { name: 'Rooftop' });
    const rooftopId = (rooftop.json() as { scene: { id: string } }).scene.id;
    const placed = await post(`/api/scenes/${rooftopId}/tokens`, boot.gmToken, { source: 'character', sourceId: characterId, x: 1, y: 1 });
    expect((placed.json() as { token: { look: unknown } }).token.look).toMatchObject(look);

    // Only the lists the figure is drawn from.
    const bad = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${visibleTokenId}`,
      headers: as(player.token),
      payload: { look: { archetype: 'dragon' } },
    });
    expect(bad.statusCode).toBe(400);

    // Another player can neither dress it nor ask the AI to.
    const nope = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${visibleTokenId}`,
      headers: as(other.token),
      payload: { look },
    });
    expect(nope.statusCode).toBe(403);
    const ask = await post(`/api/tokens/${visibleTokenId}/look/describe`, other.token, { description: 'a troll in a pink suit' });
    expect(ask.statusCode).toBe(403);
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

/**
 * The fog as it reaches everyone who is not the GM (FR9.13, Principle 4):
 * a player's phone and the table's TV (a `display` device) alike, since the
 * server treats them the same and both of them showed the whole map when the
 * fog broke.
 *
 * Three things are pinned here:
 *
 *   - The copy says the scene is fogged. A scene fogged with nothing revealed
 *     arrives as `FOG_WIRE_UNREVEALED`, the shared fixture the web's tests
 *     draw, with `active: true`. Before, it arrived as a bare empty list and
 *     read as an open map.
 *   - The copy says nothing else. An unrevealed region's id, name and
 *     outline are not in the raw body at all.
 *   - A token standing in unrevealed fog is not on the wire either. Before,
 *     only the client's cover kept the guards behind the fog off the screen,
 *     and one look at the network tab showed every one of them. A runner
 *     (a party token) is never withheld, wherever they stand.
 *
 * Its own campaign, so its fog starts from nothing and the scene the rest of
 * this file relies on stays the active one.
 */
describe('a fogged scene reaches players and the TV covered, and tells them nothing more (FR9.13)', () => {
  let fb: { campaignId: string; gmToken: string };
  let viewers: { role: string; token: string }[];
  let fogSceneId: string;
  let runnerCharacterId: string;
  let vaultId: string;
  let guardId: string;
  let runnerId: string;

  const VAULT = 'the vault';
  // Coordinates with more decimals than a timestamp's milliseconds have, so
  // a search of the raw body for one can only ever find the thing itself.
  const VAULT_POLY = [
    { x: 19.1875, y: 19.1875 },
    { x: 27.8125, y: 19.1875 },
    { x: 27.8125, y: 27.8125 },
    { x: 19.1875, y: 27.8125 },
  ];
  const GUARD = 'Guard-Kappa';
  const GUARD_AT = { x: 23.4375, y: 22.5625 };
  /** Inside the vault too: the runner has walked into the dark with the guard. */
  const RUNNER_AT = { x: 24.5, y: 24.5 };

  interface View {
    raw: string;
    fog: Record<string, unknown>;
    tokenIds: string[];
  }

  async function view(token: string): Promise<View> {
    const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${fogSceneId}`, headers: as(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { scene: { fog: Record<string, unknown> }; tokens: { id: string }[] };
    return { raw: res.body, fog: body.scene.fog, tokenIds: body.tokens.map((x) => x.id).sort() };
  }

  async function fogOp(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await post(`/api/scenes/${fogSceneId}/fog`, fb.gmToken, payload);
    expect(res.statusCode, JSON.stringify(payload)).toBe(200);
    return (res.json() as { fog: Record<string, unknown> }).fog;
  }

  /** Nothing of the vault the table has not been shown: not its id, its name, or a corner of it. */
  function expectNoVault(raw: string, role: string): void {
    expect(raw, role).not.toContain(vaultId);
    expect(raw, role).not.toContain(VAULT);
    for (const p of VAULT_POLY) {
      expect(raw, role).not.toContain(String(p.x));
      expect(raw, role).not.toContain(String(p.y));
    }
  }

  /** Nothing of the guard: not his id, his name, or where he stands. */
  function expectNoGuard(v: View, role: string): void {
    expect(v.tokenIds, role).not.toContain(guardId);
    expect(v.raw, role).not.toContain(guardId);
    expect(v.raw, role).not.toContain(GUARD);
    expect(v.raw, role).not.toContain(String(GUARD_AT.x));
    expect(v.raw, role).not.toContain(String(GUARD_AT.y));
  }

  /** The events the table's phone can read back, newest first, with their (ever-growing) ids. */
  async function tableEvents(): Promise<{ id: number; type: string; payload: Record<string, unknown> }[]> {
    const log = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${fb.campaignId}/log?limit=500`,
      headers: as(viewers[0]!.token),
    });
    expect(log.statusCode).toBe(200);
    const events = (log.json() as { events: { id: unknown; type: string; payload: Record<string, unknown> }[] }).events;
    return events.map((e) => ({ id: Number(e.id), type: e.type, payload: e.payload }));
  }

  /** The newest event id the table can see: a mark to read "what arrived since" from. */
  async function mark(): Promise<number> {
    return Math.max(0, ...(await tableEvents()).map((e) => e.id));
  }

  /** The payloads of the public events of one type that arrived after `since`, oldest first. */
  async function tableEventsSince(since: number, type: string): Promise<Record<string, unknown>[]> {
    return (await tableEvents())
      .filter((e) => e.id > since && e.type === type)
      .reverse()
      .map((e) => e.payload);
  }

  beforeAll(async () => {
    // A second campaign of the same GM's (the first-run bootstrap is once per
    // server), with its own GM token.
    const second = await t.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: gm(),
      payload: { name: 'Fogged Table' },
    });
    expect(second.statusCode).toBe(201);
    const created = second.json() as { campaignId: string; token: string };
    fb = { campaignId: created.campaignId, gmToken: created.token };
    const phone = await joinAs(t.app, fb.campaignId, fb.gmToken, 'player', 'Rook');
    const tv = await joinAs(t.app, fb.campaignId, fb.gmToken, 'display', 'Table TV');
    viewers = [
      { role: 'player', token: phone.token },
      { role: 'display', token: tv.token },
    ];
    const inserted = await t.db
      .insert(characters)
      .values({
        campaignId: fb.campaignId,
        ownerUserId: phone.user.id,
        name: 'Rook',
        sheet: { v: 1, identity: { alias: 'Rook' }, attributes: { bod: 3, rea: 4, int: 4, wil: 3 } },
      })
      .returning();
    runnerCharacterId = inserted[0]!.id;
    const made = await post(`/api/campaigns/${fb.campaignId}/scenes`, fb.gmToken, { name: 'Bank basement' });
    fogSceneId = (made.json() as { scene: { id: string } }).scene.id;
    expect((await post(`/api/scenes/${fogSceneId}/activate`, fb.gmToken, {})).statusCode).toBe(200);
  }, 60_000);

  it("starts a new scene with its fog off, so its first reveal area leaves the table's map open", async () => {
    // Before the switch, drawing a scene's first reveal area turned its fog
    // on by itself, and the table's map went black under a GM who was only
    // laying out windows. A new scene's fog is now the GM's switch to throw.
    const fog = await fogOp({ op: 'define', region: { name: VAULT, polygon: VAULT_POLY } });
    expect(fog['enabled']).toBe(false);
    vaultId = (fog['regions'] as { id: string }[])[0]!.id;
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog, role).toEqual({ ...FOG_WIRE_UNREVEALED, active: false });
      expectNoVault(v.raw, role);
    }
    await fogOp({ op: 'remove', regionId: vaultId });

    // From here on the block plays a scene made before the switch existed
    // (no `enabled` stored), which keeps the rule it was made under: fogged
    // once a region exists. Every existing scene is one of those.
    await t.db
      .update(scenesTable)
      .set({ fog: { regions: [], revealed: [], revealedShapes: [] } })
      .where(eq(scenesTable.id, fogSceneId));
  });

  it('sends a player and the TV the covered copy of a scene fogged with nothing revealed', async () => {
    const fog = await fogOp({ op: 'define', region: { name: VAULT, polygon: VAULT_POLY } });
    vaultId = (fog['regions'] as { id: string }[])[0]!.id;

    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog, role).toEqual(FOG_WIRE_UNREVEALED);
      expectNoVault(v.raw, role);
    }
  });

  it("gives the GM the region itself, and no `active`: the GM's copy says it with the region", async () => {
    const v = await view(fb.gmToken);
    expect(v.fog['regions']).toEqual([{ id: vaultId, name: VAULT, polygon: VAULT_POLY }]);
    expect(v.fog['revealed']).toEqual([]);
    expect(v.fog).not.toHaveProperty('active');
  });

  it('withholds a guard standing in the unrevealed fog, and never the runner standing beside him', async () => {
    const guard = await post(`/api/scenes/${fogSceneId}/tokens`, fb.gmToken, {
      source: 'npc_template',
      name: GUARD,
      ...GUARD_AT,
    });
    expect(guard.statusCode).toBe(201);
    guardId = (guard.json() as { token: { id: string } }).token.id;
    const runner = await post(`/api/scenes/${fogSceneId}/tokens`, fb.gmToken, {
      source: 'character',
      sourceId: runnerCharacterId,
      ...RUNNER_AT,
    });
    expect(runner.statusCode).toBe(201);
    runnerId = (runner.json() as { token: { id: string } }).token.id;

    for (const { role, token } of viewers) {
      const v = await view(token);
      // The fog hides what the runners have not found, never the runners.
      expect(v.tokenIds, role).toEqual([runnerId]);
      expectNoGuard(v, role);
    }
    expect((await view(fb.gmToken)).tokenIds).toEqual([guardId, runnerId].sort());
  });

  it('sends the guard once his room is revealed, and takes him back when it is hidden again', async () => {
    await fogOp({ op: 'reveal', regionId: vaultId });
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.tokenIds, role).toEqual([guardId, runnerId].sort());
      expect(v.fog, role).toEqual({
        ...FOG_WIRE_UNREVEALED,
        regions: [{ id: vaultId, name: VAULT, polygon: VAULT_POLY }],
        revealed: [vaultId],
      });
    }

    await fogOp({ op: 'hide', regionId: vaultId });
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.tokenIds, role).toEqual([runnerId]);
      expect(v.fog, role).toEqual(FOG_WIRE_UNREVEALED);
      expectNoGuard(v, role);
      expectNoVault(v.raw, role);
    }
  });

  it('opens the scene when its last region is removed: `active` false, and nothing is under fog', async () => {
    // A scene whose switch was never flipped keeps the old rule: fogged while
    // there is something to reveal, open once there is not.
    await fogOp({ op: 'remove', regionId: vaultId });
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog, role).toEqual({ ...FOG_WIRE_UNREVEALED, active: false });
      // With the fog off the whole map is the table's, the guard included.
      expect(v.tokenIds, role).toEqual([guardId, runnerId].sort());
    }
  });

  it('fogs a scene with no regions at all once the GM switches the fog on: `active` true', async () => {
    const fog = await fogOp({ op: 'enable' });
    expect(fog['enabled']).toBe(true);
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog, role).toEqual(FOG_WIRE_UNREVEALED);
      // The switch itself stays off the wire: `active` is its whole answer.
      expect(v.fog, role).not.toHaveProperty('enabled');
      // Covered everywhere, so the guard is withheld again and the runner is not.
      expect(v.tokenIds, role).toEqual([runnerId]);
      expectNoGuard(v, role);
    }
    const gmView = await view(fb.gmToken);
    expect(gmView.fog['enabled']).toBe(true);
    expect(gmView.fog).not.toHaveProperty('active');
  });

  it("gives the GM's TV preview (`?as=table`) exactly the TV's copy, not the GM's", async () => {
    const read = (token: string, query = '') =>
      t.app.inject({ method: 'GET', url: `/api/scenes/${fogSceneId}${query}`, headers: as(token) });
    const tv = await read(viewers.find((v) => v.role === 'display')!.token);
    const preview = await read(fb.gmToken, '?as=table');
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual(tv.json());
    expect((preview.json() as { scene: { fog: unknown } }).scene.fog).toEqual(FOG_WIRE_UNREVEALED);
    // A player asking for it gets nothing more than their own copy.
    const phone = viewers.find((v) => v.role === 'player')!.token;
    expect((await read(phone, '?as=table')).json()).toEqual((await read(phone)).json());
  });

  it('switching the fog off opens the map and keeps every region and reveal for when it goes back on', async () => {
    const fog = await fogOp({ op: 'define', region: { name: VAULT, polygon: VAULT_POLY } });
    vaultId = (fog['regions'] as { id: string }[])[0]!.id;
    await fogOp({ op: 'reveal', regionId: vaultId });
    const revealedCopy = {
      regions: [{ id: vaultId, name: VAULT, polygon: VAULT_POLY }],
      revealed: [vaultId],
      revealedShapes: [],
    };

    await fogOp({ op: 'disable' });
    for (const { role, token } of viewers) {
      expect((await view(token)).fog, role).toEqual({ ...revealedCopy, active: false });
    }
    const gmView = await view(fb.gmToken);
    expect(gmView.fog['enabled']).toBe(false);
    expect(gmView.fog['regions']).toEqual(revealedCopy.regions);
    expect(gmView.fog['revealed']).toEqual([vaultId]);

    await fogOp({ op: 'enable' });
    for (const { role, token } of viewers) {
      expect((await view(token)).fog, role).toEqual({ ...revealedCopy, active: true });
    }
  });

  it('never lets a scene write that did not touch the fog put back an older copy of it', async () => {
    // The race, played in order. The scene PATCH and a player trying a door
    // both read the scene BEFORE their transaction opens, and the write
    // re-derives every field it is not handed from that row. So a `hide`
    // that committed in between was written straight back open: no
    // `fog.updated` said so, and the next re-read gave the table the room
    // and the guard standing in it.
    const [stale] = await t.db.select().from(scenesTable).where(eq(scenesTable.id, fogSceneId));
    expect((await view(viewers[0]!.token)).tokenIds).toContain(guardId); // the vault is open

    await fogOp({ op: 'hide', regionId: vaultId });
    await new ScenesService(t.db).updateScene(stale!, { name: 'Bank basement' });

    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog, role).toEqual(FOG_WIRE_UNREVEALED);
      expect(v.tokenIds, role).toEqual([runnerId]);
      expectNoGuard(v, role);
    }
  });

  it('stages a guard standing in the fog as a GM-only combatant, and tells the table nothing of a prep fight', async () => {
    // The vault is hidden again (the case above), so the guard is under the
    // fog and the runner beside him is not.
    const res = await post(`/api/scenes/${fogSceneId}/stage-encounter`, fb.gmToken, { name: 'Vault job' });
    expect(res.statusCode).toBe(201);
    const staged = res.json() as { encounterId: string; combatantIds: string[] };
    expect(staged.combatantIds).toHaveLength(2);

    const rows = await t.db.select().from(combatants).where(eq(combatants.encounterId, staged.encounterId));
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.visibility]));
    // Before, only `hidden` decided this, and the guard the map was
    // withholding went onto the public roster, and the TV's ribbon, by name.
    expect(byName).toEqual({ [GUARD]: 'gm', Rook: 'public' });

    // A prep fight is the GM's: no roster, and no word that it was staged.
    for (const { role, token } of viewers) {
      const roster = await t.app.inject({
        method: 'GET',
        url: `/api/encounters/${staged.encounterId}`,
        headers: as(token),
      });
      expect(roster.statusCode, role).toBe(404);
      expect(roster.body, role).not.toContain(GUARD);

      const log = await t.app.inject({
        method: 'GET',
        url: `/api/campaigns/${fb.campaignId}/log?types=encounter.updated`,
        headers: as(token),
      });
      expect(log.statusCode, role).toBe(200);
      expect(log.body, role).not.toContain(staged.encounterId);
      expect(log.body, role).not.toContain(GUARD);
    }
  });

  it('fogs the scene while its sightlines are on, whatever the fog switch says, and sends the guard away and back (P6)', async () => {
    /** PATCH the scene's vision settings, and hand back what the GM's copy then says. */
    async function patchVision(vision: Record<string, unknown>): Promise<Record<string, unknown>> {
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/scenes/${fogSceneId}`,
        headers: as(fb.gmToken),
        payload: { vision },
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { scene: { vision: Record<string, unknown> } }).scene.vision;
    }

    // The fog switch off: the table sees the whole map, the guard included.
    await fogOp({ op: 'disable' });
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog['active'], role).toBe(false);
      expect(v.tokenIds, role).toEqual([guardId, runnerId].sort());
    }

    // The dimming switch is not sightlines: flipping it sends nobody anywhere.
    const beforeDim = await mark();
    expect(await patchVision({ playersSeeOwnSight: true })).toEqual({ playersSeeOwnSight: true });
    expect(await tableEventsSince(beforeDim, 'token.added')).toEqual([]);
    expect(await tableEventsSince(beforeDim, 'token.removed')).toEqual([]);

    // Sightlines on: everything the party does not see is hidden. The vault
    // is pitch black and the runner has normal eyes, so the party sees the
    // square he stands on and nothing else (the sight pass runs with the
    // switch), and the guard two squares off leaves the table as a public
    // token.removed while the runner stays. A patch that says only `sight`
    // leaves the dimming switch as it was.
    const dark = await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${fogSceneId}`,
      headers: as(fb.gmToken),
      payload: { environment: { light: 3 } },
    });
    expect(dark.statusCode).toBe(200);
    const beforeOn = await mark();
    expect(await patchVision({ sight: 'on' })).toEqual({ playersSeeOwnSight: true, sight: 'on' });
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog['active'], role).toBe(true);
      expect(v.tokenIds, role).toEqual([runnerId]);
      expectNoGuard(v, role);
    }
    expect(await tableEventsSince(beforeOn, 'token.removed')).toEqual([{ tokenId: guardId, sceneId: fogSceneId }]);

    // Off again: the fog switch is still off, so the map is open and he is back.
    const beforeOff = await mark();
    expect(await patchVision({ sight: 'off' })).toEqual({ playersSeeOwnSight: true, sight: 'off' });
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog['active'], role).toBe(false);
      expect(v.tokenIds, role).toEqual([guardId, runnerId].sort());
    }
    const added = await tableEventsSince(beforeOff, 'token.added');
    expect(added.map((p) => (p['token'] as { id: string }).id)).toEqual([guardId]);

    // The square the runner stood on is the party's memory now, kept with
    // the sightlines off. Forgotten, the fog is the one this scene had before
    // sightlines, which is what the case after this one plays on; and the
    // lights back on.
    expect((await view(fb.gmToken)).fog['sight']).toBeDefined();
    await fogOp({ op: 'forget' });
    for (const who of [fb.gmToken, ...viewers.map((v) => v.token)]) {
      expect((await view(who)).fog).not.toHaveProperty('sight');
    }
    const lit = await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${fogSceneId}`,
      headers: as(fb.gmToken),
      payload: { environment: { light: 0 } },
    });
    expect(lit.statusCode).toBe(200);
  });

  it('shows the table a vault revealed as seen-before, dimmed and empty of the guard, and sends him once it is revealed live (P6)', async () => {
    // The GM's two reveal fashions (the GM, 2026-09-27). LIVE: the table sees
    // the ground and everyone on it, moving. EXPLORED ("seen before"): the
    // table sees the ground dimmed, as remembered, and NOBODY on it. A guard
    // in a remembered room is withheld exactly as one in the dark is, from
    // the payloads and from every move, until his room goes live.
    const vaultRegion = { id: vaultId, name: VAULT, polygon: VAULT_POLY };
    /** Where the GM walks the guard while the table only remembers the vault: inside it, in decimals nothing else has. */
    const PACED_TO = { x: 25.6875, y: 20.3125 };

    // The fog back on (the case above left its switch off). The vault is
    // hidden, so the guard leaves the table as the fog goes down.
    await fogOp({ op: 'enable' });
    const beforeExplored = await mark();
    const fog = await fogOp({ op: 'reveal', regionId: vaultId, as: 'explored' });
    // The GM's copy files the vault under explored, and only there.
    expect(fog['revealed']).toEqual([]);
    expect(fog['exploredRegionIds']).toEqual([vaultId]);
    for (const { role, token } of viewers) {
      const v = await view(token);
      // The vault's outline, said to be remembered: the map is drawn there,
      // dimmed. The runner is on the table wherever he stands; the guard is not.
      expect(v.fog, role).toEqual({ ...FOG_WIRE_UNREVEALED, regions: [vaultRegion], exploredRegionIds: [vaultId] });
      expect(v.tokenIds, role).toEqual([runnerId]);
      expectNoGuard(v, role);
    }
    // The table heard the reveal and its fashion, and no guard arriving with it.
    expect(await tableEventsSince(beforeExplored, 'fog.updated')).toEqual([
      { sceneId: fogSceneId, op: 'reveal', regionId: vaultId, region: vaultRegion, as: 'explored', active: true },
    ]);
    expect(await tableEventsSince(beforeExplored, 'token.added')).toEqual([]);

    // The GM walks him across the remembered room: the move is the GM's alone.
    const paced = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${guardId}`,
      headers: as(fb.gmToken),
      payload: PACED_TO,
    });
    expect(paced.statusCode).toBe(200);
    expect(await tableEventsSince(beforeExplored, 'token.moved')).toEqual([]);
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.tokenIds, role).toEqual([runnerId]);
      expect(v.raw, role).not.toContain(String(PACED_TO.x));
      expect(v.raw, role).not.toContain(String(PACED_TO.y));
    }

    // Revealed live: he arrives, a NEW token where he now stands, and the
    // vault moves from the remembered list to the live one.
    const beforeLive = await mark();
    const live = await fogOp({ op: 'reveal', regionId: vaultId });
    expect(live['revealed']).toEqual([vaultId]);
    expect(live).not.toHaveProperty('exploredRegionIds');
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog, role).toEqual({ ...FOG_WIRE_UNREVEALED, regions: [vaultRegion], revealed: [vaultId] });
      expect(v.tokenIds, role).toEqual([guardId, runnerId].sort());
    }
    expect((await tableEventsSince(beforeLive, 'fog.updated')).map((p) => p['as'])).toEqual(['live']);
    const arrived = await tableEventsSince(beforeLive, 'token.added');
    expect(arrived.map((p) => p['token'])).toMatchObject([{ id: guardId, ...PACED_TO }]);

    // Dropped back to seen-before (the party has left the vault): he leaves the table again.
    const beforeBack = await mark();
    await fogOp({ op: 'reveal', regionId: vaultId, as: 'explored' });
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog, role).toEqual({ ...FOG_WIRE_UNREVEALED, regions: [vaultRegion], exploredRegionIds: [vaultId] });
      expectNoGuard(v, role);
    }
    expect(await tableEventsSince(beforeBack, 'token.removed')).toEqual([{ tokenId: guardId, sceneId: fogSceneId }]);

    // Hide takes it out of both lists: nothing of the vault on the table,
    // and the GM's copy back to the three lists every scene has.
    const hidden = await fogOp({ op: 'hide', regionId: vaultId });
    expect(hidden['revealed']).toEqual([]);
    expect(hidden).not.toHaveProperty('exploredRegionIds');
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog, role).toEqual(FOG_WIRE_UNREVEALED);
      expectNoVault(v.raw, role);
      expectNoGuard(v, role);
    }
  });

  it('paints squares with the brush: live sends the guard, seen-before shows his ground without him, fogged again hides him inside a live room (P6)', async () => {
    // The square-by-square reveal brush (FR9.13), in the three things it
    // paints. The guard stands where the previous case left him, unsnapped
    // at (25.6875, 20.3125), so he stands on four squares, and he is on the
    // table when ANY of them is live (`tokenLive`).
    const HIS = ['25,19', '26,19', '25,20', '26,20'];
    const vaultRegion = { id: vaultId, name: VAULT, polygon: VAULT_POLY };
    type Brush = { cols: number; rows: number; levels: Record<string, { live: string; explored: string; hidden: string }> };
    const markOf = (brush: unknown, level = 0) => brushReader(brush as Brush | undefined, level)(25, 20);
    /** Everything a brush event may say: the scene, the op, the floor, the marks, and whether the scene is fogged. */
    const BRUSH_EVENT_KEYS = ['active', 'cols', 'level', 'levels', 'op', 'rows', 'sceneId'];

    // Seen before: his squares are shown dimmed, and he is not on the table.
    const beforeExplored = await mark();
    const explored = await fogOp({ op: 'brush', level: 0, brush: { explored: HIS } });
    expect(markOf(explored['brush'])).toBe('explored');
    for (const { role, token } of viewers) {
      const v = await view(token);
      // The table gets the marks as the GM has them: every one is ground it is shown.
      expect(v.fog, role).toEqual({ ...FOG_WIRE_UNREVEALED, brush: explored['brush'] });
      expect(v.tokenIds, role).toEqual([runnerId]);
      expectNoGuard(v, role);
      expectNoVault(v.raw, role);
    }
    const told = await tableEventsSince(beforeExplored, 'fog.updated');
    expect(told).toHaveLength(1);
    expect(Object.keys(told[0]!).sort()).toEqual(BRUSH_EVENT_KEYS);
    expect(told[0]).toMatchObject({ sceneId: fogSceneId, op: 'brush', level: 0, active: true });
    expect(await tableEventsSince(beforeExplored, 'token.added')).toEqual([]);

    // Painted upstairs, the same squares change nothing down here.
    await fogOp({ op: 'brush', level: 1, brush: { live: HIS } });
    for (const { role, token } of viewers) expectNoGuard(await view(token), role);

    // Live: he arrives, where he stands, as a new token.
    const beforeLive = await mark();
    const live = await fogOp({ op: 'brush', level: 0, brush: { live: ['26,20'] } });
    expect(markOf(live['brush'])).toBe('explored');
    expect(brushReader(live['brush'] as Brush, 0)(26, 20)).toBe('live');
    for (const { role, token } of viewers) {
      expect((await view(token)).tokenIds, role).toEqual([guardId, runnerId].sort());
    }
    expect((await tableEventsSince(beforeLive, 'token.added')).map((p) => (p['token'] as { id: string }).id)).toEqual([guardId]);

    // The vault revealed live is the later act over its ground: the marks
    // under it go, on every floor, and the table hears the brush as it is now.
    const beforeVault = await mark();
    const vault = await fogOp({ op: 'reveal', regionId: vaultId });
    expect(vault).not.toHaveProperty('brush');
    expect((await tableEventsSince(beforeVault, 'fog.updated')).map((p) => [p['op'], p['levels']])).toEqual([
      ['reveal', undefined],
      ['brush', {}],
    ]);

    // Fogged again, inside the live vault: he leaves the table, the vault stays open round him.
    const beforeFogged = await mark();
    const fogged = await fogOp({ op: 'brush', level: 0, brush: { hidden: HIS } });
    expect(markOf(fogged['brush'])).toBe('hidden');
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog, role).toEqual({ ...FOG_WIRE_UNREVEALED, regions: [vaultRegion], revealed: [vaultId], brush: fogged['brush'] });
      expect(v.tokenIds, role).toEqual([runnerId]);
      expectNoGuard(v, role);
    }
    expect(await tableEventsSince(beforeFogged, 'token.removed')).toEqual([{ tokenId: guardId, sceneId: fogSceneId }]);

    // Cleared (what an undo sends): the vault decides his squares again, and he is back.
    const beforeClear = await mark();
    const cleared = await fogOp({ op: 'brush', level: 0, brush: { clear: HIS } });
    expect(cleared).not.toHaveProperty('brush');
    for (const { role, token } of viewers) {
      expect((await view(token)).tokenIds, role).toEqual([guardId, runnerId].sort());
    }
    expect((await tableEventsSince(beforeClear, 'token.added')).map((p) => (p['token'] as { id: string }).id)).toEqual([guardId]);

    // The GM's reset takes every reveal back, every square of the brush with it.
    await fogOp({ op: 'brush', level: 0, brush: { live: ['1,1'] } });
    const reset = await fogOp({ op: 'hide' });
    expect(reset).not.toHaveProperty('brush');
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog, role).toEqual(FOG_WIRE_UNREVEALED);
      expectNoGuard(v, role);
      expectNoVault(v.raw, role);
    }

    // Hiding a region the table was never shown takes no mark from under it:
    // marks vanishing there would trace its outline on the players' wire.
    await fogOp({ op: 'brush', level: 0, brush: { live: ['20,20'] } });
    const stillPainted = await fogOp({ op: 'hide', regionId: vaultId });
    expect(brushReader(stillPainted['brush'] as Brush, 0)(20, 20)).toBe('live');

    // A stroke must say what it paints.
    const empty = await post(`/api/scenes/${fogSceneId}/fog`, fb.gmToken, { op: 'brush', level: 0 });
    expect(empty.statusCode).toBe(400);
    const bad = await post(`/api/scenes/${fogSceneId}/fog`, fb.gmToken, { op: 'brush', brush: { live: ['a,b'] } });
    expect(bad.statusCode).toBe(400);
  });
});

/**
 * The party's sight, kept by the server (P6 sightlines, the sight pass in
 * services/sight.ts).
 *
 * With a scene's sightlines on, the table sees what the runners see: walls
 * and shut doors stop an eye, darkness stops it unless the runner's eyes see
 * through (strict SR5), and what any runner sees is LIVE on every phone and
 * the TV at once (pooled). What they have seen stays as EXPLORED memory,
 * ORed in at once (always automatic) and wiped only by the GM (`forget`).
 * The server works it out after every committed change and withholds every
 * token standing anywhere the party does not see right now.
 *
 * The map, 12 x 9, painted in the docklands set: a wall down column 5 with a
 * door in it at (5,4). The runner starts in the west room, the guard stands
 * in the east one, straight through the door from him.
 *
 * Its own campaign, so its events and its scene are its own.
 */
describe('sightlines: the party’s pooled sight unmasks the map, and the server keeps it (P6)', () => {
  let sb: { campaignId: string; gmToken: string };
  let viewers: { role: string; token: string }[];
  let phoneToken: string;
  let sightSceneId: string;
  let rookId: string;
  let oxId: string;
  let rookTokenId: string;
  let guardId: string;

  const GUARD = 'Guard-Sigma';
  const WALL: Record<string, string> = {};
  for (let row = 0; row < 9; row += 1) WALL[`5,${row}`] = row === 4 ? 'door' : 'wall';

  interface View {
    raw: string;
    fog: { active?: boolean; sight?: { cols: number; rows: number; levels: Record<string, { live: string; explored: string }> } };
    tokenIds: string[];
  }

  async function view(token: string): Promise<View> {
    const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${sightSceneId}`, headers: as(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { scene: { fog: View['fog'] }; tokens: { id: string }[] };
    return { raw: res.body, fog: body.scene.fog, tokenIds: body.tokens.map((x) => x.id).sort() };
  }

  /** One floor's live or explored squares, as the copy a device was sent says them. */
  function squares(fog: View['fog'], part: 'live' | 'explored', level = 0): CellBits {
    const sight = fog.sight;
    expect(sight, 'the fog carries the party sight').toBeDefined();
    return decodeCellBits(sight!.levels[String(level)]?.[part] ?? '', sight!.cols, sight!.rows);
  }

  async function patchScene(payload: Record<string, unknown>): Promise<void> {
    const res = await t.app.inject({ method: 'PATCH', url: `/api/scenes/${sightSceneId}`, headers: as(sb.gmToken), payload });
    expect(res.statusCode, JSON.stringify(payload)).toBe(200);
  }

  async function fogOp(payload: Record<string, unknown>): Promise<void> {
    const res = await post(`/api/scenes/${sightSceneId}/fog`, sb.gmToken, payload);
    expect(res.statusCode, JSON.stringify(payload)).toBe(200);
  }

  /** The public events the phone can read back, oldest first, from after `since`. */
  async function tableSince(since: number): Promise<{ id: number; type: string; payload: Record<string, unknown> }[]> {
    const log = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${sb.campaignId}/log?limit=500`,
      headers: as(phoneToken),
    });
    expect(log.statusCode).toBe(200);
    const events = (log.json() as { events: { id: unknown; type: string; payload: Record<string, unknown> }[] }).events;
    return events
      .map((e) => ({ id: Number(e.id), type: e.type, payload: e.payload }))
      .filter((e) => e.id > since)
      .reverse();
  }

  async function mark(): Promise<number> {
    const log = await t.app.inject({ method: 'GET', url: `/api/campaigns/${sb.campaignId}/log?limit=1`, headers: as(phoneToken) });
    const events = (log.json() as { events: { id: unknown }[] }).events;
    return Math.max(0, ...events.map((e) => Number(e.id)));
  }

  const sightEvents = (events: { type: string; payload: Record<string, unknown> }[]) =>
    events.filter((e) => e.type === 'fog.updated' && e.payload['op'] === 'sight').map((e) => e.payload);

  function sheet(alias: string, metatype: string) {
    return SheetV1Schema.parse({
      v: 1,
      identity: { alias, metatype },
      attributes: { bod: 3, agi: 3, rea: 3, str: 3, wil: 3, log: 3, int: 3, cha: 3, edg: { max: 2, current: 2 } },
    });
  }

  beforeAll(async () => {
    const second = await t.app.inject({ method: 'POST', url: '/api/campaigns', headers: gm(), payload: { name: 'Dark Docks' } });
    expect(second.statusCode).toBe(201);
    const created = second.json() as { campaignId: string; token: string };
    sb = { campaignId: created.campaignId, gmToken: created.token };
    const phone = await joinAs(t.app, sb.campaignId, sb.gmToken, 'player', 'Rook');
    const tv = await joinAs(t.app, sb.campaignId, sb.gmToken, 'display', 'Table TV');
    phoneToken = phone.token;
    viewers = [
      { role: 'player', token: phone.token },
      { role: 'display', token: tv.token },
    ];
    const made = await t.db
      .insert(characters)
      .values([
        { campaignId: sb.campaignId, ownerUserId: phone.user.id, name: 'Rook', sheet: sheet('Rook', 'human') },
        { campaignId: sb.campaignId, ownerUserId: phone.user.id, name: 'Ox', sheet: sheet('Ox', 'troll') },
      ])
      .returning();
    rookId = made.find((c) => c.name === 'Rook')!.id;
    oxId = made.find((c) => c.name === 'Ox')!.id;

    const scene = await post(`/api/campaigns/${sb.campaignId}/scenes`, sb.gmToken, { name: 'Loading dock', grid: { cols: 12, rows: 9 } });
    sightSceneId = (scene.json() as { scene: { id: string } }).scene.id;
    expect((await post(`/api/scenes/${sightSceneId}/activate`, sb.gmToken, {})).statusCode).toBe(200);
    const painted = await post(`/api/scenes/${sightSceneId}/tiles`, sb.gmToken, { tilesetId: 'docklands', paint: WALL });
    expect(painted.statusCode).toBe(200);

    const rook = await post(`/api/scenes/${sightSceneId}/tokens`, sb.gmToken, { source: 'character', sourceId: rookId, x: 2.5, y: 4.5 });
    rookTokenId = (rook.json() as { token: { id: string } }).token.id;
    const guard = await post(`/api/scenes/${sightSceneId}/tokens`, sb.gmToken, { source: 'npc_template', name: GUARD, x: 8.5, y: 4.5 });
    guardId = (guard.json() as { token: { id: string } }).token.id;
  }, 60_000);

  it('leaves a scene without sightlines as it always was: a step and a door store no sight and tell the table only themselves', async () => {
    // Every runner's step and every door runs the sight pass, on every scene.
    // On one whose sightlines were never switched on it must be invisible:
    // no party memory written into the fog, no sight event, nobody arriving
    // or leaving, only the move and the door the table always heard.
    const since = await mark();
    const step = async (x: number) => {
      const moved = await t.app.inject({
        method: 'PATCH',
        url: `/api/tokens/${rookTokenId}`,
        headers: as(phoneToken),
        payload: { x, y: 4.5 },
      });
      expect(moved.statusCode).toBe(200);
    };
    // Up to the door (a player works a door only from beside it), open it
    // and shut it again, and home.
    for (const x of [3.5, 4.5]) await step(x);
    for (const op of ['open', 'close'] as const) {
      expect((await post(`/api/scenes/${sightSceneId}/doors`, phoneToken, { cell: '5,4', level: 0, op })).statusCode).toBe(200);
    }
    await step(2.5);

    expect((await view(sb.gmToken)).fog).not.toHaveProperty('sight');
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog, role).not.toHaveProperty('sight');
      expect(v.fog.active, role).toBe(false);
      expect(v.tokenIds, role).toEqual([guardId, rookTokenId].sort());
    }
    const events = await tableSince(since);
    expect(events.filter((e) => e.type === 'fog.updated')).toEqual([]);
    expect(events.filter((e) => e.type === 'token.added' || e.type === 'token.removed')).toEqual([]);
    expect(events.filter((e) => e.type === 'token.moved').map((e) => e.payload['x'])).toEqual([3.5, 4.5, 2.5]);
  });

  it('switched on, shows the table the runner’s room and its walls, and nothing through the shut door', async () => {
    // The scene starts open (its fog switch off), so the guard is on the table until the sightlines go on.
    expect((await view(viewers[0]!.token)).tokenIds).toEqual([guardId, rookTokenId].sort());
    const since = await mark();
    await patchScene({ vision: { sight: 'on' } });

    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.fog.active, role).toBe(true);
      expect(v.fog.sight?.cols, role).toBe(12);
      expect(v.fog.sight?.rows, role).toBe(9);
      const live = squares(v.fog, 'live');
      // His square, his whole room, its walls and the shut door's face...
      for (const [col, row] of [[2, 4], [0, 0], [4, 8], [5, 0], [5, 4]] as const) {
        expect(cellBitsHas(live, col, row), `${role} ${col},${row}`).toBe(true);
      }
      // ...and nothing behind the door.
      for (const [col, row] of [[6, 4], [8, 4], [11, 0]] as const) {
        expect(cellBitsHas(live, col, row), `${role} ${col},${row}`).toBe(false);
      }
      // Seen is remembered at once: the memory is exactly what is live.
      expect(v.fog.sight?.levels['0']?.explored, role).toBe(v.fog.sight?.levels['0']?.live);
      // The guard behind the door is not on the wire at all.
      expect(v.tokenIds, role).toEqual([rookTokenId]);
      expect(v.raw, role).not.toContain(guardId);
      expect(v.raw, role).not.toContain(GUARD);
    }

    const events = await tableSince(since);
    const heard = sightEvents(events);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ sceneId: sightSceneId, cols: 12, rows: 9, active: true });
    expect(heard[0]!['levels']).toEqual((await view(viewers[0]!.token)).fog.sight?.levels);
    expect(events.filter((e) => e.type === 'token.removed').map((e) => e.payload)).toEqual([
      { tokenId: guardId, sceneId: sightSceneId },
    ]);
  });

  it('delivers the guard behind the door as a NEW token the moment the runner opens it', async () => {
    // He steps up to the shut door, which shows him nothing new...
    const walk = (x: number) =>
      t.app.inject({ method: 'PATCH', url: `/api/tokens/${rookTokenId}`, headers: as(phoneToken), payload: { x, y: 4.5 } });
    expect((await walk(4.5)).statusCode).toBe(200);
    const since = await mark();
    const opened = await post(`/api/scenes/${sightSceneId}/doors`, phoneToken, { cell: '5,4', level: 0, op: 'open' });
    expect(opened.statusCode).toBe(200);
    // ...and back to where he stood, looking through the open doorway.
    expect((await walk(2.5)).statusCode).toBe(200);

    const events = await tableSince(since);
    const sightAt = events.findIndex((e) => e.type === 'fog.updated' && e.payload['op'] === 'sight');
    const arrivedAt = events.findIndex((e) => e.type === 'token.added');
    expect(sightAt).toBeGreaterThanOrEqual(0);
    // After the sight that shows him, so a device folding in order has the
    // hole in its fog before the man standing in it arrives.
    expect(arrivedAt).toBeGreaterThan(sightAt);
    expect(events[arrivedAt]!.payload['token']).toMatchObject({ id: guardId, name: GUARD, x: 8.5, y: 4.5 });

    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(v.tokenIds, role).toEqual([guardId, rookTokenId].sort());
      const live = squares(v.fog, 'live');
      expect(cellBitsHas(live, 6, 4), role).toBe(true);
      expect(cellBitsHas(live, 8, 4), role).toBe(true);
      // Through the doorway only: the east room's far corner is still behind the wall.
      expect(cellBitsHas(live, 11, 0), role).toBe(false);
    }
  });

  it('grows the party’s memory as the runner walks, and the table hears the sight with the move', async () => {
    const was = squares((await view(sb.gmToken)).fog, 'explored');
    const since = await mark();
    // The runner's own player walks him through the door into the east room.
    const moved = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${rookTokenId}`,
      headers: as(phoneToken),
      payload: { x: 8.5, y: 1.5 },
    });
    expect(moved.statusCode).toBe(200);

    const v = await view(sb.gmToken);
    const live = squares(v.fog, 'live');
    const explored = squares(v.fog, 'explored');
    // The whole east room now...
    expect(cellBitsHas(live, 11, 0)).toBe(true);
    expect(cellBitsHas(live, 11, 8)).toBe(true);
    // ...and the west room out of sight, but remembered.
    expect(cellBitsHas(live, 0, 0)).toBe(false);
    expect(cellBitsHas(explored, 0, 0)).toBe(true);
    // Memory only grows: every square it held, it still holds, and more.
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 12; col += 1) {
        if (cellBitsHas(was, col, row)) expect(cellBitsHas(explored, col, row), `${col},${row}`).toBe(true);
      }
    }
    expect(cellBitsCount(explored)).toBeGreaterThan(cellBitsCount(was));

    const events = await tableSince(since);
    expect(events.find((e) => e.type === 'token.moved')?.payload).toMatchObject({ tokenId: rookTokenId, x: 8.5, y: 1.5 });
    const heard = sightEvents(events);
    expect(heard).toHaveLength(1);
    expect(heard[0]!['levels']).toEqual(v.fog.sight?.levels);
    // The guard was in sight before and is in sight still: nothing about him.
    expect(events.filter((e) => e.type === 'token.added' || e.type === 'token.removed')).toEqual([]);
  });

  it('fogs again with the brush only what the party has left: a remembered square goes dark, one in sight keeps no mark', async () => {
    // The runner stands in the east room; the west room is remembered. The GM
    // fogs one square of each again. What a runner is looking at stays on the
    // table (the sight pass takes the mark straight off it); the square the
    // party only remembers goes dark, over the memory, which is left as it was.
    type Brush = { cols: number; rows: number; levels: Record<string, { live: string; explored: string; hidden: string }> };
    const since = await mark();
    await fogOp({ op: 'brush', level: 0, brush: { hidden: ['0,0', '11,0'] } });
    for (const { role, token } of [{ role: 'gm', token: sb.gmToken }, ...viewers]) {
      const v = await view(token);
      const fog = v.fog as View['fog'] & { brush?: Brush };
      const marks = brushReader(fog.brush, 0);
      expect(marks(0, 0), role).toBe('hidden');
      expect(marks(11, 0), role).toBeNull();
      // The memory is the party's, and the brush did not touch it.
      expect(cellBitsHas(squares(v.fog, 'explored'), 0, 0), role).toBe(true);
      if (role !== 'gm') {
        expect(cellState(fog as Parameters<typeof cellState>[0], 0, 0, 0), role).toBe('hidden');
        expect(cellState(fog as Parameters<typeof cellState>[0], 0, 11, 0), role).toBe('live');
        expect(cellState(fog as Parameters<typeof cellState>[0], 0, 1, 1), role).toBe('explored');
      }
    }
    // The stroke, then the pass's own word on the brush: the square in sight let go.
    const brushEvents = (await tableSince(since)).filter((e) => e.type === 'fog.updated' && e.payload['op'] === 'brush');
    expect(brushEvents).toHaveLength(2);
    const gmBrush = ((await view(sb.gmToken)).fog as { brush?: Brush }).brush;
    expect(brushEvents[1]!.payload['levels']).toEqual(gmBrush?.levels);
    expect(brushReader(brushEvents[0]!.payload as unknown as Brush, 0)(11, 0)).toBe('hidden');

    // Undone: the square is remembered again, and the record is gone.
    await fogOp({ op: 'brush', level: 0, brush: { clear: ['0,0'] } });
    expect((await view(sb.gmToken)).fog).not.toHaveProperty('brush');
  });

  it('switched off, nobody is seen live any more and the memory is kept', async () => {
    const remembered = (await view(sb.gmToken)).fog.sight?.levels['0']?.explored;
    expect(remembered).toBeTruthy();
    const since = await mark();
    await patchScene({ vision: { sight: 'off' } });
    for (const { role, token } of viewers) {
      const v = await view(token);
      // The fog switch was never thrown, so the map is open again...
      expect(v.fog.active, role).toBe(false);
      // ...and the party's memory stands, with no live squares in it.
      expect(v.fog.sight?.levels, role).toEqual({ '0': { live: '', explored: remembered } });
    }
    expect(sightEvents(await tableSince(since))).toMatchObject([{ active: false, levels: { '0': { live: '', explored: remembered } } }]);
  });

  it('forgets on the GM’s word: a floor never seen is a no-op, and the rest keeps only what the runners see now', async () => {
    // Back on: the runner in the east room sees it, and the memory still holds the west room.
    await patchScene({ vision: { sight: 'on' } });
    let v = await view(sb.gmToken);
    expect(cellBitsHas(squares(v.fog, 'explored'), 0, 0)).toBe(true);
    expect(cellBitsHas(squares(v.fog, 'live'), 0, 0)).toBe(false);
    const levels = v.fog.sight?.levels;

    // The roof has no memory to forget: the op is heard, and the sight is not.
    let since = await mark();
    await fogOp({ op: 'forget', level: 1 });
    expect((await view(sb.gmToken)).fog.sight?.levels).toEqual(levels);
    let events = await tableSince(since);
    expect(events.filter((e) => e.type === 'fog.updated').map((e) => e.payload)).toEqual([
      { sceneId: sightSceneId, op: 'forget', level: 1, active: true },
    ]);

    // Every floor: the west room goes; the room they stand in is remembered again at once.
    since = await mark();
    await fogOp({ op: 'forget' });
    v = await view(sb.gmToken);
    expect(cellBitsHas(squares(v.fog, 'explored'), 0, 0)).toBe(false);
    expect(v.fog.sight?.levels['0']?.explored).toBe(v.fog.sight?.levels['0']?.live);
    events = await tableSince(since);
    expect(events.filter((e) => e.type === 'fog.updated').map((e) => e.payload['op'])).toEqual(['forget', 'sight']);
    expect(sightEvents(events)[0]!['levels']).toEqual(v.fog.sight?.levels);

    // Off and forgotten: no sight left at all, on any copy.
    await patchScene({ vision: { sight: 'off' } });
    await fogOp({ op: 'forget' });
    for (const token of [sb.gmToken, ...viewers.map((x) => x.token)]) {
      expect((await view(token)).fog, token).not.toHaveProperty('sight');
    }
  });

  it('shows a dark room to thermographic eyes and not to normal ones, and follows a runner’s eyes when the sheet changes', async () => {
    // Lights out, and sightlines back on. The runner (a human, normal eyes)
    // stands three squares from the guard in the pitch-black east room.
    const since = await mark();
    await patchScene({ environment: { light: 3 }, vision: { sight: 'on' } });
    for (const { role, token } of viewers) {
      const v = await view(token);
      const live = squares(v.fog, 'live');
      // A runner knows where he stands, and in the dark that is all.
      expect(cellBitsCount(live), role).toBe(1);
      expect(cellBitsHas(live, 8, 1), role).toBe(true);
      expect(v.tokenIds, role).toEqual([rookTokenId]);
      expect(v.raw, role).not.toContain(guardId);
    }
    expect((await tableSince(since)).filter((e) => e.type === 'token.removed').map((e) => e.payload['tokenId'])).toEqual([guardId]);

    // A troll steps up beside him: thermographic eyes see the whole dark room, guard and all.
    let mark2 = await mark();
    const ox = await post(`/api/scenes/${sightSceneId}/tokens`, sb.gmToken, { source: 'character', sourceId: oxId, x: 9.5, y: 1.5 });
    expect(ox.statusCode).toBe(201);
    const oxTokenId = (ox.json() as { token: { id: string } }).token.id;
    for (const { role, token } of viewers) {
      const v = await view(token);
      const live = squares(v.fog, 'live');
      expect(cellBitsHas(live, 8, 4), role).toBe(true);
      expect(cellBitsHas(live, 11, 8), role).toBe(true);
      expect(v.tokenIds, role).toEqual([guardId, oxTokenId, rookTokenId].sort());
    }
    let events = await tableSince(mark2);
    expect(events.filter((e) => e.type === 'token.added').map((e) => (e.payload['token'] as { id: string }).id)).toEqual([
      oxTokenId,
      guardId,
    ]);

    // The troll leaves: the dark closes over the guard again.
    mark2 = await mark();
    const gone = await t.app.inject({ method: 'DELETE', url: `/api/tokens/${oxTokenId}`, headers: as(sb.gmToken) });
    expect(gone.statusCode).toBe(200);
    for (const { role, token } of viewers) {
      expect((await view(token)).tokenIds, role).toEqual([rookTokenId]);
    }
    events = await tableSince(mark2);
    expect(events.filter((e) => e.type === 'token.removed').map((e) => e.payload['tokenId'])).toEqual([oxTokenId, guardId]);

    // The runner's player fits thermographic cybereyes: his own eyes now see
    // the room, with the save that fitted them.
    mark2 = await mark();
    const fitted = await t.app.inject({
      method: 'PATCH',
      url: `/api/characters/${rookId}`,
      headers: as(phoneToken),
      payload: { sheet: { augments: [{ name: 'Cybereyes (rating 2)', essence: 0.2, note: 'thermographic vision' }] } },
    });
    expect(fitted.statusCode, fitted.body).toBe(200);
    for (const { role, token } of viewers) {
      const v = await view(token);
      expect(cellBitsHas(squares(v.fog, 'live'), 8, 4), role).toBe(true);
      expect(v.tokenIds, role).toEqual([guardId, rookTokenId].sort());
    }
    events = await tableSince(mark2);
    expect(sightEvents(events)).toHaveLength(1);
    expect(events.filter((e) => e.type === 'token.added').map((e) => (e.payload['token'] as { id: string }).id)).toEqual([guardId]);
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

  /**
   * A real PNG signature followed by whatever the caller wants to say.
   *
   * The store checks that an upload's BYTES agree with its declared mime, so
   * these fixtures have to be honest about being PNGs. That check is the
   * reason a player may upload at all: the client picks the content type and
   * the client can lie.
   */
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = (body: string) => Buffer.concat([PNG_MAGIC, Buffer.from(body)]);

  async function upload(visibility: string, body: string) {
    return t.app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: gm({ 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }),
      payload: multipart(
        { kind: 'map', visibility, campaign: boot.campaignId },
        png(body),
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
    expect(asGm.body).toContain('gm-only-map-bytes');

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
    expect(viaQuery.body).toContain('shared-map-bytes');
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

  it('sends players the sight geometry and the public pins, and none of the GM annotations', async () => {
    // This scene's fog is on (the block above), and a public pin is sent
    // only where the table is shown its ground (`pinsForTable`, P6): the
    // loading bay is revealed first, so the pin in it is the table's.
    const bay = await post(`/api/scenes/${sceneId}/fog`, boot.gmToken, {
      op: 'reveal',
      shape: [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }, { x: 1, y: 4 }],
    });
    expect(bay.statusCode).toBe(200);
    await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      headers: gm(),
      payload: {
        geometry: {
          walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, note: 'load-bearing, do not blow' }],
          doors: [{ id: 'd1', a: { x: 4, y: 0 }, b: { x: 5, y: 0 }, open: false, note: 'maglock rating 4' }],
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
    // Walls and doors reach the player — their device cuts its own sightline
    // on them (FR9.16) — but the GM's notes on them do not.
    expect(geo.walls).toEqual([{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }]);
    expect(geo.doors).toEqual([{ id: 'd1', a: { x: 4, y: 0 }, b: { x: 5, y: 0 }, open: false }]);
    expect(res.body).not.toContain('load-bearing');
    expect(res.body).not.toContain('maglock rating');
    expect(geo.pins.map((p) => p.id)).toEqual(['p-open']);
    expect(res.body).not.toContain('the stash');
  });
});

describe('the players’ own sightline is a scene setting (FR9.16)', () => {
  it('starts off, flips when the GM says so, and reaches a player device', async () => {
    const before = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: as(player.token) });
    expect((before.json() as { scene: { vision: { playersSeeOwnSight: boolean } } }).scene.vision).toEqual({
      playersSeeOwnSight: false,
    });
    const flip = await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      headers: gm(),
      payload: { vision: { playersSeeOwnSight: true } },
    });
    expect(flip.statusCode).toBe(200);
    const after = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: as(player.token) });
    expect((after.json() as { scene: { vision: { playersSeeOwnSight: boolean } } }).scene.vision.playersSeeOwnSight).toBe(true);
  });

  it('is the GM’s switch alone', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      headers: as(player.token),
      payload: { vision: { playersSeeOwnSight: false } },
    });
    expect(res.statusCode).toBe(403);
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

/**
 * The secrecy sweep (P6, 2026-09-27): what the map withholds from the table,
 * no other channel carries. The fog review found these still open after the
 * map itself was closed:
 *
 *   - a scene the GM is staging put every guard placed on it, every step he
 *     took, every region revealed on it, the party's sight on it, every
 *     drawing and its weather note on public events, persisted for replay;
 *   - a public pin in a room the table had not found was sent, label and all;
 *   - a combatant staged in the open kept his token's id on the table's
 *     roster after his token walked into the dark;
 *   - a runner's new look went out on every token of theirs, one held back on
 *     a hidden layer or standing on a staged scene included (a new portrait
 *     did the same: portrait.test.ts);
 *   - and the Fixer's spoiler guard knew only the `hidden` flag
 *     (fixer-tools.test.ts).
 *
 * Its own campaign, so the table's log is this block's alone.
 */
describe('the secrecy sweep: what the map withholds, no other channel carries (P6)', () => {
  let sw: { campaignId: string; gmToken: string };
  let viewers: { role: string; token: string }[];
  let phoneToken: string;
  let runnerCharacterId: string;
  let houseId: string;
  let guardId: string;
  let crateId: string;
  let runnerTokenId: string;
  let roomId: string;

  const GUARD = 'Guard-Tau';
  const CRATE = 'Crate-Tau';
  // Coordinates with more decimals than anything else in a log has, so a
  // search of the raw events for one can only ever find the guard.
  const GUARD_AT = { x: 16.4375, y: 15.5625 };
  const MOVED_TO = { x: 17.4375, y: 16.5625 };
  const OUT_IN_THE_DARK = { x: 25.4375, y: 5.5625 };
  const ROOM = 'the counting room';
  const ROOM_POLY = [
    { x: 12, y: 12 },
    { x: 20, y: 12 },
    { x: 20, y: 20 },
    { x: 12, y: 20 },
  ];
  const SMOKE = 'smoke pouring from the vents';
  const DRAWING = 'kill zone by the safe';
  const SAFE = 'the safe behind the painting';

  interface Logged {
    id: number;
    type: string;
    payload: Record<string, unknown>;
    visibility: string;
  }

  /** Every event `token`'s holder can read back from the log, oldest first. */
  async function logOf(token: string): Promise<Logged[]> {
    const log = await t.app.inject({
      method: 'GET',
      url: `/api/campaigns/${sw.campaignId}/log?limit=500`,
      headers: as(token),
    });
    expect(log.statusCode).toBe(200);
    const events = (
      log.json() as { events: { id: unknown; type: string; payload: Record<string, unknown>; visibility: string }[] }
    ).events;
    return events.map((e) => ({ id: Number(e.id), type: e.type, payload: e.payload, visibility: e.visibility })).reverse();
  }

  /** The newest event id of all (the GM reads every one): a mark to read "what came after" from. */
  async function mark(): Promise<number> {
    return Math.max(0, ...(await logOf(sw.gmToken)).map((e) => e.id));
  }

  async function since(token: string, from: number): Promise<Logged[]> {
    return (await logOf(token)).filter((e) => e.id > from);
  }

  async function fogOp(sceneId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await post(`/api/scenes/${sceneId}/fog`, sw.gmToken, payload);
    expect(res.statusCode, JSON.stringify(payload)).toBe(200);
    return (res.json() as { fog: Record<string, unknown> }).fog;
  }

  async function patchScene(sceneId: string, payload: Record<string, unknown>): Promise<void> {
    const res = await t.app.inject({ method: 'PATCH', url: `/api/scenes/${sceneId}`, headers: as(sw.gmToken), payload });
    expect(res.statusCode, JSON.stringify(payload)).toBe(200);
  }

  async function patchToken(tokenId: string, payload: Record<string, unknown>, who?: string): Promise<void> {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${tokenId}`,
      headers: as(who ?? sw.gmToken),
      payload,
    });
    expect(res.statusCode, JSON.stringify(payload)).toBe(200);
  }

  async function sceneFor(token: string, sceneId: string) {
    const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: as(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      scene: { geometry: { pins: { id: string }[] }; fog: { regions: { id: string }[] } };
      tokens: { id: string }[];
    };
    return {
      raw: res.body,
      pinIds: body.scene.geometry.pins.map((p) => p.id).sort(),
      regionIds: body.scene.fog.regions.map((r) => r.id),
      tokenIds: body.tokens.map((x) => x.id),
    };
  }

  beforeAll(async () => {
    const third = await t.app.inject({ method: 'POST', url: '/api/campaigns', headers: gm(), payload: { name: 'Counting House' } });
    expect(third.statusCode).toBe(201);
    const created = third.json() as { campaignId: string; token: string };
    sw = { campaignId: created.campaignId, gmToken: created.token };
    const phone = await joinAs(t.app, sw.campaignId, sw.gmToken, 'player', 'Wren');
    const tv = await joinAs(t.app, sw.campaignId, sw.gmToken, 'display', 'Table TV');
    phoneToken = phone.token;
    viewers = [
      { role: 'player', token: phone.token },
      { role: 'display', token: tv.token },
    ];
    const inserted = await t.db
      .insert(characters)
      .values({
        campaignId: sw.campaignId,
        ownerUserId: phone.user.id,
        name: 'Wren',
        sheet: { v: 1, identity: { alias: 'Wren' }, attributes: { bod: 3, rea: 4, int: 4, wil: 3 } },
      })
      .returning();
    runnerCharacterId = inserted[0]!.id;
  }, 60_000);

  it('keeps a scene the GM is staging off the table: its guard, his every step, its fog, its sight, its marks, its weather', async () => {
    const made = await post(`/api/campaigns/${sw.campaignId}/scenes`, sw.gmToken, {
      name: 'Counting house',
      grid: { cols: 30, rows: 30 },
    });
    expect(made.statusCode).toBe(201);
    houseId = (made.json() as { scene: { id: string } }).scene.id;
    const from = await mark();

    // The GM builds the job in private: a guard placed and walked, a crate
    // placed and taken away again, the runner put at the door, the room
    // fogged and opened (announced, as a GM might out of habit), the
    // sightlines on, the weather written, and a template laid.
    const guard = await post(`/api/scenes/${houseId}/tokens`, sw.gmToken, { source: 'npc_template', name: GUARD, ...GUARD_AT });
    expect(guard.statusCode).toBe(201);
    guardId = (guard.json() as { token: { id: string } }).token.id;
    await patchToken(guardId, MOVED_TO);
    const crate = await post(`/api/scenes/${houseId}/tokens`, sw.gmToken, { source: 'prop', name: CRATE, x: 3.5, y: 3.5 });
    crateId = (crate.json() as { token: { id: string } }).token.id;
    expect((await t.app.inject({ method: 'DELETE', url: `/api/tokens/${crateId}`, headers: as(sw.gmToken) })).statusCode).toBe(200);
    const runner = await post(`/api/scenes/${houseId}/tokens`, sw.gmToken, {
      source: 'character',
      sourceId: runnerCharacterId,
      x: 14.5,
      y: 14.5,
    });
    runnerTokenId = (runner.json() as { token: { id: string } }).token.id;
    await fogOp(houseId, { op: 'enable' });
    const fog = await fogOp(houseId, { op: 'define', region: { name: ROOM, polygon: ROOM_POLY } });
    roomId = (fog['regions'] as { id: string }[])[0]!.id;
    await fogOp(houseId, { op: 'reveal', regionId: roomId, announce: true });
    await patchScene(houseId, { vision: { sight: 'on' }, environment: { note: SMOKE } });
    const drawn = await post(`/api/scenes/${houseId}/drawings`, sw.gmToken, {
      kind: 'template',
      geometry: { shape: 'circle', center: MOVED_TO, radiusM: 3, label: DRAWING },
    });
    expect(drawn.statusCode).toBe(201);

    // The GM heard every step of it, on the GM's own sockets alone.
    const gmHeard = await since(sw.gmToken, from);
    const about = (e: Logged) => JSON.stringify(e.payload);
    expect(gmHeard.some((e) => e.type === 'token.added' && about(e).includes(guardId))).toBe(true);
    expect(gmHeard.some((e) => e.type === 'token.moved' && e.payload['tokenId'] === guardId)).toBe(true);
    expect(gmHeard.some((e) => e.type === 'token.removed' && e.payload['tokenId'] === crateId)).toBe(true);
    expect(gmHeard.some((e) => e.type === 'fog.updated' && e.payload['op'] === 'reveal')).toBe(true);
    expect(gmHeard.some((e) => e.type === 'fog.updated' && e.payload['op'] === 'sight')).toBe(true);
    expect(gmHeard.some((e) => e.type === 'log.posted' && about(e).includes(ROOM))).toBe(true);
    expect(gmHeard.some((e) => e.type === 'drawing.added')).toBe(true);
    const onTheScene = gmHeard.filter((e) => /^(token|fog|drawing)\./.test(e.type) || e.type === 'log.posted');
    for (const e of onTheScene) expect(e.visibility, `${e.type} ${about(e)}`).toBe('gm');

    // And the table none of it: no token, fog or drawing event, and not a
    // trace of the guard, the crate, the runner's token there, the room, the
    // weather note or the template. That the scene exists and was changed is
    // all it hears (`scene.updated`, which says nothing of what is on it).
    for (const { role, token } of viewers) {
      const heard = await since(token, from);
      expect(heard.filter((e) => /^(token|fog|drawing)\./.test(e.type) || e.type === 'log.posted'), role).toEqual([]);
      const raw = JSON.stringify(heard);
      for (const secret of [guardId, GUARD, crateId, CRATE, runnerTokenId, roomId, ROOM, SMOKE, DRAWING, String(MOVED_TO.x)]) {
        expect(raw, `${role}: ${secret}`).not.toContain(secret);
      }
    }
  });

  it('goes live whole: the table’s first read of the scene has the room, the guard in it and the runner', async () => {
    expect((await post(`/api/scenes/${houseId}/activate`, sw.gmToken, {})).statusCode).toBe(200);
    for (const { role, token } of viewers) {
      const v = await sceneFor(token, houseId);
      expect(v.tokenIds.sort(), role).toEqual([guardId, runnerTokenId].sort());
      expect(v.regionIds, role).toEqual([roomId]);
    }
  });

  it('withholds a public pin under the fog, and tells the table to read the scene again when the fog moves off it or back', async () => {
    // Only the GM's reveals decide from here: the sightlines off, the party's
    // memory forgotten, the room fogged, and the front of the house open.
    await patchScene(houseId, { vision: { sight: 'off' } });
    await fogOp(houseId, { op: 'forget' });
    await fogOp(houseId, { op: 'hide', regionId: roomId });
    await fogOp(houseId, { op: 'reveal', shape: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }] });
    await patchScene(houseId, {
      geometry: {
        walls: [],
        doors: [],
        zones: [],
        pins: [
          { id: 'pin-safe', at: { x: 16.5, y: 17.5 }, label: SAFE, visibility: 'public' },
          { id: 'pin-door', at: { x: 2.5, y: 2.5 }, label: 'the front door', visibility: 'public' },
          { id: 'pin-note', at: { x: 3.5, y: 2.5 }, label: 'the GM’s own', visibility: 'gm' },
        ],
      },
    });

    for (const { role, token } of viewers) {
      const v = await sceneFor(token, houseId);
      expect(v.pinIds, role).toEqual(['pin-door']);
      expect(v.raw, role).not.toContain('pin-safe');
      expect(v.raw, role).not.toContain(SAFE);
      // The scene list a device reads is the same filtered copy.
      const list = await t.app.inject({ method: 'GET', url: `/api/campaigns/${sw.campaignId}/scenes`, headers: as(token) });
      expect(list.statusCode, role).toBe(200);
      expect(list.body, role).not.toContain(SAFE);
    }
    expect((await sceneFor(sw.gmToken, houseId)).pinIds).toEqual(['pin-door', 'pin-note', 'pin-safe']);

    const pinsTold = (heard: Logged[]) =>
      heard.filter((e) => e.type === 'scene.updated' && e.payload['sceneId'] === houseId).map((e) => e.payload['changed']);

    // Revealed as seen before: the room's map is the table's, its pins
    // included, and nobody in it.
    let from = await mark();
    await fogOp(houseId, { op: 'reveal', regionId: roomId, as: 'explored' });
    for (const { role, token } of viewers) {
      const v = await sceneFor(token, houseId);
      expect(v.pinIds, role).toEqual(['pin-door', 'pin-safe']);
      expect(v.tokenIds, role).not.toContain(guardId);
      expect(pinsTold(await since(token, from)), role).toContainEqual(['pins']);
    }

    // Fogged again: the pin goes with the room, and the table is told so.
    from = await mark();
    await fogOp(houseId, { op: 'hide', regionId: roomId });
    for (const { role, token } of viewers) {
      expect((await sceneFor(token, houseId)).pinIds, role).toEqual(['pin-door']);
      expect(pinsTold(await since(token, from)), role).toContainEqual(['pins']);
    }

    // A fog op that uncovers no pin says nothing of pins.
    from = await mark();
    await fogOp(houseId, { op: 'reveal', shape: [{ x: 25, y: 25 }, { x: 28, y: 25 }, { x: 28, y: 28 }] });
    for (const { role, token } of viewers) expect(pinsTold(await since(token, from)), role).toEqual([]);
  });

  it('shows a combatant’s row, and names its token, only while the table has that token', async () => {
    await fogOp(houseId, { op: 'reveal', regionId: roomId });
    const res = await post(`/api/scenes/${houseId}/stage-encounter`, sw.gmToken, { name: 'Counting house job' });
    expect(res.statusCode).toBe(201);
    const encounterId = (res.json() as { encounterId: string }).encounterId;
    // Only a live fight reaches the table.
    const live = await t.app.inject({ method: 'PATCH', url: `/api/encounters/${encounterId}`, headers: as(sw.gmToken), payload: { state: 'live' } });
    expect(live.statusCode).toBe(200);

    async function roster(token: string) {
      const read = await t.app.inject({ method: 'GET', url: `/api/encounters/${encounterId}`, headers: as(token) });
      expect(read.statusCode).toBe(200);
      const rows = (read.json() as { combatants: { name: string; tokenId?: string }[] }).combatants;
      return {
        raw: read.body,
        names: rows.map((r) => r.name).sort(),
        tokenOf: (name: string) => rows.find((r) => r.name === name)?.tokenId,
      };
    }

    // Staged in the lit room: on the table's roster, and tied to his figure.
    for (const { role, token } of viewers) {
      const r = await roster(token);
      expect(r.names, role).toEqual([GUARD, 'Wren'].sort());
      expect(r.tokenOf(GUARD), role).toBe(guardId);
      expect(r.tokenOf('Wren'), role).toBe(runnerTokenId);
    }

    // He walks out into the dark: his row follows his token off the table (the GM's rule).
    await patchToken(guardId, OUT_IN_THE_DARK);
    for (const { role, token } of viewers) {
      const r = await roster(token);
      expect(r.names, role).toEqual(['Wren']);
      expect(r.raw, role).not.toContain(GUARD);
      expect(r.raw, role).not.toContain(guardId);
      expect(r.tokenOf('Wren'), role).toBe(runnerTokenId);
    }
    expect((await roster(sw.gmToken)).tokenOf(GUARD)).toBe(guardId);

    // Back in the room, and back on the table's roster.
    await patchToken(guardId, MOVED_TO);
    for (const { role, token } of viewers) expect((await roster(token)).tokenOf(GUARD), role).toBe(guardId);
  });

  it('tells the table a runner’s new look only on the tokens it has: not one held back on a layer, nor one on a staged scene', async () => {
    const held = await post(`/api/scenes/${houseId}/tokens`, sw.gmToken, {
      source: 'character',
      sourceId: runnerCharacterId,
      x: 4.5,
      y: 4.5,
    });
    const heldId = (held.json() as { token: { id: string } }).token.id;
    await patchScene(houseId, { tokenLayers: [{ id: 'layer-held', name: 'Held back', hidden: true, tokenIds: [heldId] }] });
    const next = await post(`/api/campaigns/${sw.campaignId}/scenes`, sw.gmToken, { name: 'Next week' });
    const nextId = (next.json() as { scene: { id: string } }).scene.id;
    const elsewhere = await post(`/api/scenes/${nextId}/tokens`, sw.gmToken, {
      source: 'character',
      sourceId: runnerCharacterId,
      x: 1.5,
      y: 1.5,
    });
    const elsewhereId = (elsewhere.json() as { token: { id: string } }).token.id;

    const from = await mark();
    await patchToken(runnerTokenId, { look: { archetype: 'decker', metatype: 'elf' } }, phoneToken);
    const dressed = (heard: Logged[]) =>
      heard
        .filter((e) => e.type === 'token.updated')
        .map((e) => (e.payload['token'] as { id: string }).id)
        .sort();

    expect(dressed(await since(sw.gmToken, from))).toEqual([elsewhereId, heldId, runnerTokenId].sort());
    for (const { role, token } of viewers) {
      const heard = await since(token, from);
      expect(dressed(heard), role).toEqual([runnerTokenId]);
      const raw = JSON.stringify(heard);
      expect(raw, role).not.toContain(heldId);
      expect(raw, role).not.toContain(elsewhereId);
    }
  });

  it('sends the table the GM’s lamps, and not the labels only the GM’s map draws', async () => {
    const LAMP = 'the ritual circle, still warm';
    const gmRead = await t.app.inject({ method: 'GET', url: `/api/scenes/${houseId}`, headers: as(sw.gmToken) });
    const geometry = (gmRead.json() as { scene: { geometry: Record<string, unknown> } }).scene.geometry;
    // A lamp in the counting room, labelled as a GM labels one for herself.
    await patchScene(houseId, {
      geometry: { ...geometry, lights: [{ id: 'lamp-circle', at: { x: 16.5, y: 16.5 }, label: LAMP }] },
    });
    const lampsOf = (raw: string) =>
      ((JSON.parse(raw) as { scene: { geometry: { lights?: Record<string, unknown>[] } } }).scene.geometry.lights ?? []);

    expect(lampsOf((await sceneFor(sw.gmToken, houseId)).raw)[0]?.['label']).toBe(LAMP);
    for (const { role, token } of viewers) {
      const v = await sceneFor(token, houseId);
      // The lamp itself still comes: it lights what the table sees of the floor.
      const lamps = lampsOf(v.raw);
      expect(lamps.map((l) => l['id']), role).toEqual(['lamp-circle']);
      expect(lamps[0], role).not.toHaveProperty('label');
      expect(v.raw, role).not.toContain(LAMP);
      const list = await t.app.inject({ method: 'GET', url: `/api/campaigns/${sw.campaignId}/scenes`, headers: as(token) });
      expect(list.body, role).not.toContain(LAMP);
    }
  });

  it('judges a token event against the fog a transaction still in flight is writing, not the fog before it', async () => {
    // Postgres reads committed rows. A plain read of the scene, made while
    // the GM's hide (or a runner's sight pass) has not committed yet, gets
    // the fog from before it; a read FOR UPDATE waits for it and gets the
    // fog it wrote. PGlite runs one transaction at a time, so that moment is
    // staged: once the room is hidden, every UNLOCKED read of this scene is
    // handed the row as it stood before the hide, which is exactly what such
    // a read got in production, and a locked read the scene as it now is.
    // The guard in the room was on the table, and has just been taken off.
    const [before] = await t.db.select().from(scenesTable).where(eq(scenesTable.id, houseId));
    await fogOp(houseId, { op: 'hide', regionId: roomId });
    const from = await mark();

    const RENAMED = 'Guard-Upsilon';
    const PLACED_NAME = 'Guard-Phi';
    const STEP = { x: 18.4375, y: 13.5625 };
    const PLACED = { x: 13.4375, y: 18.5625 };
    let placedId = '';
    const real = ScenesService.prototype.sceneRow;
    const spy = vi
      .spyOn(ScenesService.prototype, 'sceneRow')
      .mockImplementation(function (this: ScenesService, id: string, opts?: { lock?: boolean }) {
        return id === houseId && opts?.lock !== true ? Promise.resolve(before!) : real.call(this, id, opts);
      });
    try {
      // The GM, in that same moment: the guard walked on inside the room,
      // renamed, a second guard placed in it and taken away again.
      await patchToken(guardId, STEP);
      await patchToken(guardId, { name: RENAMED });
      const placed = await post(`/api/scenes/${houseId}/tokens`, sw.gmToken, { source: 'npc_template', name: PLACED_NAME, ...PLACED });
      expect(placed.statusCode).toBe(201);
      placedId = (placed.json() as { token: { id: string } }).token.id;
      expect((await t.app.inject({ method: 'DELETE', url: `/api/tokens/${placedId}`, headers: as(sw.gmToken) })).statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }

    // The GM heard every one of them, on the GM's sockets alone.
    const gmHeard = (await since(sw.gmToken, from)).filter((e) => e.type.startsWith('token.'));
    expect(gmHeard.map((e) => e.type)).toEqual(['token.moved', 'token.updated', 'token.added', 'token.removed']);
    for (const e of gmHeard) expect(e.visibility, e.type).toBe('gm');
    // The table none of it: the room it was told had gone dark stays dark.
    for (const { role, token } of viewers) {
      const heard = await since(token, from);
      expect(heard.filter((e) => e.type.startsWith('token.')), role).toEqual([]);
      const raw = JSON.stringify(heard);
      for (const secret of [guardId, placedId, RENAMED, PLACED_NAME, String(STEP.x), String(PLACED.x)]) {
        expect(raw, `${role}: ${secret}`).not.toContain(secret);
      }
      expect((await sceneFor(token, houseId)).tokenIds, role).not.toContain(guardId);
    }
  });

  it('never lets a player’s door write back the scene it read before the GM’s last change', async () => {
    // A crate in the open at the front, and a door beside it.
    const CRATE2 = 'Crate-Upsilon';
    const crate = await post(`/api/scenes/${houseId}/tokens`, sw.gmToken, { source: 'prop', name: CRATE2, x: 1.4375, y: 4.5625 });
    expect(crate.statusCode).toBe(201);
    const crate2Id = (crate.json() as { token: { id: string } }).token.id;
    // Wren at the door, whose player opens it (a player works a door only
    // with a runner beside it).
    const atDoor = await post(`/api/scenes/${houseId}/tokens`, sw.gmToken, {
      source: 'character',
      sourceId: runnerCharacterId,
      x: 5.5,
      y: 1.5,
    });
    expect(atDoor.statusCode).toBe(201);
    const gmRead = async () =>
      (
        (await t.app.inject({ method: 'GET', url: `/api/scenes/${houseId}`, headers: as(sw.gmToken) })).json() as {
          scene: { geometry: Record<string, unknown> & { doors: { id: string; open: boolean }[] }; tokenLayers?: { id: string; hidden: boolean; tokenIds: string[] }[] };
        }
      ).scene;
    const now = await gmRead();
    await patchScene(houseId, {
      geometry: { ...now.geometry, doors: [{ id: 'door-front', a: { x: 6, y: 1 }, b: { x: 6, y: 2 }, open: false, locked: false }] },
    });
    for (const { role, token } of viewers) expect((await sceneFor(token, houseId)).tokenIds, role).toContain(crate2Id);

    // The GM puts the crate on a hidden layer, and it leaves the table. A
    // player's door opened in that same moment read the scene before it.
    const [before] = await t.db.select().from(scenesTable).where(eq(scenesTable.id, houseId));
    await patchScene(houseId, {
      tokenLayers: [...(now.tokenLayers ?? []), { id: 'layer-crates', name: 'Crates', hidden: true, tokenIds: [crate2Id] }],
    });
    const real = ScenesService.prototype.sceneRow;
    const spy = vi
      .spyOn(ScenesService.prototype, 'sceneRow')
      .mockImplementation(function (this: ScenesService, id: string, opts?: { lock?: boolean }) {
        return id === houseId && opts?.lock !== true ? Promise.resolve(before!) : real.call(this, id, opts);
      });
    try {
      const opened = await post(`/api/scenes/${houseId}/doors`, phoneToken, { doorId: 'door-front', op: 'open' });
      expect(opened.statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }

    // The door is open, and the GM's layer is still hidden: the crate stays off the table.
    const after = await gmRead();
    expect(after.geometry.doors.find((d) => d.id === 'door-front')?.open).toBe(true);
    expect(after.tokenLayers?.find((l) => l.id === 'layer-crates')).toMatchObject({ hidden: true, tokenIds: [crate2Id] });
    for (const { role, token } of viewers) {
      const v = await sceneFor(token, houseId);
      expect(v.tokenIds, role).not.toContain(crate2Id);
      expect(v.raw, role).not.toContain(CRATE2);
    }
  });
});
