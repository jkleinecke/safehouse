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

  it('stages a guard standing in the fog as a GM-only combatant, and counts only the runner in public', async () => {
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

    for (const { role, token } of viewers) {
      const roster = await t.app.inject({
        method: 'GET',
        url: `/api/encounters/${staged.encounterId}`,
        headers: as(token),
      });
      expect(roster.statusCode, role).toBe(200);
      const names = (roster.json() as { combatants: { name: string }[] }).combatants.map((c) => c.name);
      expect(names, role).toEqual(['Rook']);
      expect(roster.body, role).not.toContain(GUARD);
      expect(roster.body, role).not.toContain(guardId);

      // The public word that the fight was staged counts what the table may
      // see. The whole count, less the roster a player is sent, was a
      // head-count of the guards in the dark.
      const log = await t.app.inject({
        method: 'GET',
        url: `/api/campaigns/${fb.campaignId}/log?types=encounter.updated`,
        headers: as(token),
      });
      expect(log.statusCode, role).toBe(200);
      const events = (log.json() as { events: { payload: Record<string, unknown> }[] }).events;
      const word = events.find((e) => e.payload['encounterId'] === staged.encounterId);
      expect(word?.payload['staged'], role).toBe(1);
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

    // Sightlines on: everything the party does not see is hidden, and the
    // party sees nothing yet (no sight pass has run), so the guard leaves the
    // table as a public token.removed and the runner stays. A patch that
    // says only `sight` leaves the dimming switch as it was.
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
