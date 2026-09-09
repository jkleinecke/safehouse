/**
 * Token layers (FR9.26): a whole ambush behind one switch.
 *
 * A layer the GM has hidden hides every token on it exactly as `hidden`
 * hides one: absent from a player's scene, its events on GM sockets only,
 * and showing the layer is tokens ARRIVING (token.added) rather than a
 * flag flipping somewhere the player never saw. The layers themselves —
 * their names, their membership — never reach a player at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Scene, Token } from '@safehouse/contracts';
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
let sceneId: string;
let ganger: string;
let guard: string;
let gmWs: WsTestClient;
let playerWs: WsTestClient;
const open: WsTestClient[] = [];

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}
async function post(url: string, token: string, payload: unknown) {
  return t.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as object });
}
async function patch(url: string, token: string, payload: unknown) {
  return t.app.inject({ method: 'PATCH', url, headers: auth(token), payload: payload as object });
}
async function composed(token: string): Promise<{ scene: Scene; tokens: Token[] }> {
  const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json() as { scene: Scene; tokens: Token[] };
}
async function placeNpc(name: string, x: number): Promise<string> {
  const res = await post(`/api/scenes/${sceneId}/tokens`, boot.gmToken, { source: 'npc_template', name, x, y: 2 });
  expect(res.statusCode).toBe(201);
  return (res.json() as { token: { id: string } }).token.id;
}
async function connect(token: string): Promise<WsTestClient> {
  const c = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, token));
  open.push(c);
  await c.next((f) => f.type === 'hello');
  return c;
}
function settle(ms = 200): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
/** A cursor on a socket: frames from now on, not the ones already seen. */
function fromNow(ws: WsTestClient) {
  const seen = new Set(ws.frames);
  return {
    next: (pred: (f: Frame) => boolean) => ws.next((f) => !seen.has(f) && pred(f)),
    all: () => ws.frames.filter((f) => !seen.has(f)),
  };
}
function layers(list: { id: string; name: string; hidden?: boolean; tokenIds: string[] }[]) {
  return patch(`/api/scenes/${sceneId}`, boot.gmToken, { tokenLayers: list });
}

beforeAll(async () => {
  t = await makeTestApp('token-layers');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  boot = await bootstrapCampaign(t.app, 'Ambush at the Stuffer Shack');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  const created = await post(`/api/campaigns/${boot.campaignId}/scenes`, boot.gmToken, { name: 'Stuffer Shack' });
  sceneId = (created.json() as { scene: { id: string } }).scene.id;
  await post(`/api/scenes/${sceneId}/activate`, boot.gmToken, {});
  ganger = await placeNpc('Halloweener', 3);
  guard = await placeNpc('Rent-a-cop', 6);
  gmWs = await connect(boot.gmToken);
  playerWs = await connect(player.token);
}, 180_000);

afterAll(async () => {
  for (const c of open) c.close();
  await t.close();
});

describe('a hidden layer', () => {
  it('takes its tokens off the players’ table — the player sees them leave, the GM sees them stay', async () => {
    expect((await composed(player.token)).tokens.map((k) => k.id).sort()).toEqual([ganger, guard].sort());

    const wire = fromNow(playerWs);
    const res = await layers([{ id: 'l.ambush', name: 'Ambush', hidden: true, tokenIds: [ganger] }]);
    expect(res.statusCode).toBe(200);

    const gone = await wire.next((f) => f.type === 'token.removed');
    expect((gone.payload as { tokenId: string }).tokenId).toBe(ganger);

    expect((await composed(player.token)).tokens.map((k) => k.id)).toEqual([guard]);
    const gm = await composed(boot.gmToken);
    expect(gm.tokens.map((k) => k.id).sort()).toEqual([ganger, guard].sort());
    expect(gm.scene.tokenLayers).toEqual([{ id: 'l.ambush', name: 'Ambush', hidden: true, tokenIds: [ganger] }]);
  });

  it('is the GM’s alone: the player’s scene carries no layers, not even the list', async () => {
    const seen = await composed(player.token);
    expect('tokenLayers' in seen.scene).toBe(false);
    expect(JSON.stringify(seen)).not.toContain('Ambush');
  });

  it('keeps its tokens’ movement off player sockets while it is hidden', async () => {
    const gmWire = fromNow(gmWs);
    const playerWire = fromNow(playerWs);
    const moved = await patch(`/api/tokens/${ganger}`, boot.gmToken, { x: 4, y: 2 });
    expect(moved.statusCode).toBe(200);
    const gmFrame = await gmWire.next((f) => f.type === 'token.updated' || f.type === 'token.moved');
    expect(JSON.stringify(gmFrame.payload)).toContain(ganger);
    await settle();
    expect(playerWire.all().filter((f) => JSON.stringify(f.payload).includes(ganger))).toEqual([]);
  });

  it('shown again, its tokens ARRIVE for the players, as new tokens', async () => {
    const wire = fromNow(playerWs);
    const res = await layers([{ id: 'l.ambush', name: 'Ambush', hidden: false, tokenIds: [ganger] }]);
    expect(res.statusCode).toBe(200);
    const arrived = await wire.next((f) => f.type === 'token.added');
    expect((arrived.payload as { token: { id: string; x: number } }).token).toMatchObject({ id: ganger, x: 4 });
    expect((await composed(player.token)).tokens.map((k) => k.id).sort()).toEqual([ganger, guard].sort());
  });

  it('is not a way for a player to see a token that is hidden on its own account', async () => {
    let wire = fromNow(playerWs);
    const hid = await patch(`/api/tokens/${guard}`, boot.gmToken, { hidden: true });
    expect(hid.statusCode).toBe(200);
    await wire.next((f) => f.type === 'token.removed');
    // Putting the hidden guard on a layer, then hiding and showing the layer,
    // must not announce them: their own flag still says hidden.
    wire = fromNow(playerWs);
    await layers([{ id: 'l.ambush', name: 'Ambush', hidden: true, tokenIds: [ganger, guard] }]);
    await wire.next((f) => f.type === 'token.removed'); // the ganger, again
    wire = fromNow(playerWs);
    await layers([{ id: 'l.ambush', name: 'Ambush', hidden: false, tokenIds: [ganger, guard] }]);
    const back = await wire.next((f) => f.type === 'token.added');
    expect((back.payload as { token: { id: string } }).token.id).toBe(ganger);
    await settle();
    expect(wire.all().filter((f) => f.type === 'token.added')).toHaveLength(1);
    expect((await composed(player.token)).tokens.map((k) => k.id)).toEqual([ganger]);
  });

  it('is the GM’s to set: a player may not write layers', async () => {
    const res = await patch(`/api/scenes/${sceneId}`, player.token, { tokenLayers: [] });
    expect(res.statusCode).toBe(403);
  });
});
