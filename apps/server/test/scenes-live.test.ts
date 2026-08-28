/**
 * M9 Grid realtime coverage (§11): activation broadcast, the ephemeral drag
 * channel (relayed, throttled, never written to `ws_events`), the persisted
 * final move, hidden-token events that never touch a player socket, and the
 * reveal that arrives as a NEW token rather than a position update (FR9.7).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { characters, eventsSince } from '@safehouse/db';
import { PerKeyThrottle } from '../src/services/scenes.js';
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
let display: JoinResult;
let gmWs: WsTestClient;
let playerWs: WsTestClient;
let displayWs: WsTestClient;
let sceneId: string;
let ownTokenId: string;
let hiddenTokenId: string;

const open: WsTestClient[] = [];
const HIDDEN_NAME = 'Wraith-Nine';

function headers(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function post(url: string, token: string, payload: unknown) {
  return t.app.inject({ method: 'POST', url, headers: headers(token), payload: payload as object });
}

async function connect(token: string): Promise<WsTestClient> {
  const c = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, token));
  open.push(c);
  await c.next((f) => f.type === 'hello');
  return c;
}

/** Give the hub a beat to deliver anything it was going to deliver. */
function settle(ms = 250): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function persistedTypes(): Promise<string[]> {
  const rows = await eventsSince(t.db, boot.campaignId, 0, 5000);
  return rows.map((r) => r.type);
}

beforeAll(async () => {
  t = await makeTestApp('scenes-live');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  boot = await bootstrapCampaign(t.app, 'Live Grid Table');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  display = await joinAs(t.app, boot.campaignId, boot.gmToken, 'display', 'Table TV');

  const inserted = await t.db
    .insert(characters)
    .values({
      campaignId: boot.campaignId,
      ownerUserId: player.user.id,
      name: 'Static',
      sheet: { v: 1, identity: { alias: 'Static' }, attributes: { bod: 4, rea: 5, int: 4, wil: 3 } },
    })
    .returning();
  const characterId = inserted[0]!.id;

  const scene = await post(`/api/campaigns/${boot.campaignId}/scenes`, boot.gmToken, { name: 'Loading dock' });
  sceneId = (scene.json() as { scene: { id: string } }).scene.id;

  gmWs = await connect(boot.gmToken);
  playerWs = await connect(player.token);
  displayWs = await connect(display.token);

  const own = await post(`/api/scenes/${sceneId}/tokens`, boot.gmToken, {
    source: 'character',
    sourceId: characterId,
    x: 1,
    y: 1,
  });
  ownTokenId = (own.json() as { token: { id: string } }).token.id;
}, 180_000);

afterAll(async () => {
  for (const c of open) c.close();
  await t.close();
});

describe('scene.activated broadcast (FR9.1)', () => {
  it('reaches the GM, the players, and the table display', async () => {
    const res = await post(`/api/scenes/${sceneId}/activate`, boot.gmToken, {});
    expect(res.statusCode).toBe(200);
    const match = (f: Frame) =>
      f.type === 'scene.activated' && (f.payload as { sceneId?: string }).sceneId === sceneId;
    for (const ws of [gmWs, playerWs, displayWs]) {
      const frame = await ws.next(match);
      expect(frame.ephemeral).toBeUndefined();
      expect(typeof frame.id).toBe('number');
    }
    expect(await persistedTypes()).toContain('scene.activated');
  });
});

describe('token drag: ephemeral in motion, persisted at rest (FR9.5, §11)', () => {
  it('relays token.dragging without ever writing it to ws_events', async () => {
    playerWs.send({ cmd: 'token.drag', tokenId: ownTokenId, x: 2.5, y: 3.5 });
    const frame = await gmWs.next((f) => f.type === 'token.dragging');
    expect(frame.ephemeral).toBe(true);
    expect(frame.id).toBeUndefined();
    expect(frame.payload).toMatchObject({ tokenId: ownTokenId, x: 2.5, y: 3.5 });

    await settle();
    expect(await persistedTypes()).not.toContain('token.dragging');
  });

  it('persists the final position as token.moved for everyone', async () => {
    playerWs.send({ cmd: 'token.move', tokenId: ownTokenId, x: 7, y: 8 });
    const match = (f: Frame) =>
      f.type === 'token.moved' && (f.payload as { tokenId?: string }).tokenId === ownTokenId;
    for (const ws of [gmWs, playerWs, displayWs]) {
      const frame = await ws.next(match);
      expect(frame.payload).toMatchObject({ x: 7, y: 8 });
      expect(typeof frame.id).toBe('number');
    }
    expect(await persistedTypes()).toContain('token.moved');
  });

  it('refuses a token the sender does not control', async () => {
    const otherPlayer = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Bolt');
    const ws = await connect(otherPlayer.token);
    ws.send({ cmd: 'token.move', tokenId: ownTokenId, x: 99, y: 99 });
    const err = await ws.next((f) => f.type === 'error');
    expect((err.payload as { code: string }).code).toBe('forbidden');
  });
});

describe('hidden tokens exist only on GM sockets (FR9.7, Principle 4)', () => {
  it('never announces a hidden token to players or the display', async () => {
    const res = await post(`/api/scenes/${sceneId}/tokens`, boot.gmToken, {
      source: 'prop',
      name: HIDDEN_NAME,
      x: 20,
      y: 21,
      hidden: true,
    });
    hiddenTokenId = (res.json() as { token: { id: string } }).token.id;

    const added = await gmWs.next(
      (f) => f.type === 'token.added' && JSON.stringify(f.payload).includes(hiddenTokenId),
    );
    expect(added.visibility).toBe('gm');

    await settle();
    for (const ws of [playerWs, displayWs]) {
      expect(ws.frames.some((f) => JSON.stringify(f).includes(hiddenTokenId))).toBe(false);
      expect(ws.frames.some((f) => JSON.stringify(f).includes(HIDDEN_NAME))).toBe(false);
    }
  });

  it('keeps a hidden token’s coordinates off player sockets while it moves', async () => {
    gmWs.send({ cmd: 'token.drag', tokenId: hiddenTokenId, x: 22, y: 23 });
    await gmWs.next(
      (f) => f.type === 'token.dragging' && (f.payload as { tokenId?: string }).tokenId === hiddenTokenId,
    );
    const before = playerWs.frames.length;

    gmWs.send({ cmd: 'token.move', tokenId: hiddenTokenId, x: 24, y: 25 });
    await gmWs.next(
      (f) => f.type === 'token.moved' && (f.payload as { tokenId?: string }).tokenId === hiddenTokenId,
    );
    await settle();

    const leaked = playerWs.frames
      .slice(before)
      .filter((f) => JSON.stringify(f).includes(hiddenTokenId) || JSON.stringify(f).includes('24'));
    expect(leaked).toEqual([]);
  });

  it('reveals as a NEW token arriving, not a position update', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${hiddenTokenId}`,
      headers: headers(boot.gmToken),
      payload: { hidden: false },
    });
    expect(res.statusCode).toBe(200);

    const arrival = await playerWs.next(
      (f) => f.type === 'token.added' && JSON.stringify(f.payload).includes(hiddenTokenId),
    );
    expect(arrival.visibility).toBe('public');
    expect((arrival.payload as { token: { name: string; x: number } }).token.name).toBe(HIDDEN_NAME);
    expect(
      playerWs.frames.some(
        (f) => f.type === 'token.updated' && JSON.stringify(f.payload).includes(hiddenTokenId),
      ),
    ).toBe(false);
  });

  it('re-hiding removes it from players and keeps the edit GM-only', async () => {
    await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${hiddenTokenId}`,
      headers: headers(boot.gmToken),
      payload: { hidden: true },
    });
    const removed = await playerWs.next(
      (f) => f.type === 'token.removed' && (f.payload as { tokenId?: string }).tokenId === hiddenTokenId,
    );
    expect(removed.visibility).toBe('public');
    await settle();
    expect(
      playerWs.frames.some(
        (f) => f.type === 'token.updated' && JSON.stringify(f.payload).includes(hiddenTokenId),
      ),
    ).toBe(false);
    expect(
      gmWs.frames.some(
        (f) => f.type === 'token.updated' && JSON.stringify(f.payload).includes(hiddenTokenId),
      ),
    ).toBe(true);
  });
});

describe('fog over the wire (FR9.13/9.14)', () => {
  it('keeps a defined-but-unrevealed region GM-only, then reveals it to all', async () => {
    gmWs.send({
      cmd: 'fog.reveal',
      sceneId,
      op: 'define',
      region: { id: 'east-wing', name: 'east wing', polygon: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }] },
    });
    const defined = await gmWs.next(
      (f) => f.type === 'fog.updated' && (f.payload as { op?: string }).op === 'define',
    );
    expect(defined.visibility).toBe('gm');
    await settle();
    expect(playerWs.frames.some((f) => JSON.stringify(f).includes('east wing'))).toBe(false);

    gmWs.send({ cmd: 'fog.reveal', sceneId, op: 'reveal', regionId: 'east-wing', announce: true });
    const revealed = await playerWs.next(
      (f) => f.type === 'fog.updated' && (f.payload as { op?: string }).op === 'reveal',
    );
    expect(revealed.visibility).toBe('public');
    expect((revealed.payload as { region: { name: string } }).region.name).toBe('east wing');
    await playerWs.next((f) => f.type === 'log.posted');
    expect(await persistedTypes()).toContain('fog.updated');
  });

  it('refuses fog commands from a player socket', async () => {
    playerWs.send({ cmd: 'fog.reveal', sceneId, op: 'hide' });
    const err = await playerWs.next((f) => f.type === 'error');
    expect((err.payload as { code: string }).code).toBe('forbidden');
  });
});

describe('PerKeyThrottle (the ~15 Hz drag relay budget)', () => {
  it('passes the leading edge and swallows the rest of the window, per key', () => {
    let now = 1_000;
    const th = new PerKeyThrottle(66, () => now);
    expect(th.allow('a')).toBe(true);
    expect(th.allow('a')).toBe(false);
    expect(th.allow('b')).toBe(true); // independent key
    now += 65;
    expect(th.allow('a')).toBe(false);
    now += 1;
    expect(th.allow('a')).toBe(true);
    th.clear('a');
    expect(th.allow('a')).toBe(true);
  });
});
