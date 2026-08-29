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

/**
 * FR12.8 proximity prompts. The geometry was built and unit-tested, but no
 * caller existed: nothing ever nudged the GM, because the scene layer never
 * called it after a move.
 */
describe('fog proximity prompts ride the token.move commit (FR12.8)', () => {
  it('nudges the GM when a token lands at an unrevealed region, and only the GM', async () => {
    gmWs.send({
      cmd: 'fog.reveal',
      sceneId,
      op: 'define',
      region: {
        id: 'server-room',
        name: 'the server room',
        polygon: [
          { x: 40, y: 40 },
          { x: 46, y: 40 },
          { x: 46, y: 46 },
          { x: 40, y: 46 },
        ],
      },
    });
    // A `define` event deliberately carries no geometry, not even to the GM —
    // the op is the whole payload (see `applyFog`).
    await gmWs.next(
      (f) =>
        f.type === 'fog.updated' &&
        (f.payload as { op?: string; sceneId?: string }).op === 'define' &&
        (f.payload as { sceneId?: string }).sceneId === sceneId,
    );

    // A player walking their own token up to the door is the trigger.
    playerWs.send({ cmd: 'token.move', tokenId: ownTokenId, x: 39, y: 43 });
    const nudge = await gmWs.next(
      (f) => f.type === 'fixer.suggestion' && JSON.stringify(f.payload).includes('server-room'),
    );
    expect(nudge.ephemeral).toBe(true);
    const payload = nudge.payload as { kind: string; action: { tool: string } };
    expect(payload.kind).toBe('fog_proximity');
    // A suggestion, never an action (Principle 8): nothing revealed itself.
    expect(payload.action.tool).toBe('suggest_fog_reveal');

    await settle();
    // The unrevealed region's very name is what a player must not learn.
    for (const ws of [playerWs, displayWs]) {
      expect(ws.frames.some((f) => f.type === 'fixer.suggestion')).toBe(false);
      expect(ws.frames.some((f) => JSON.stringify(f).includes('the server room'))).toBe(false);
    }
    // Ephemeral: a replay must not leak it either.
    expect(await persistedTypes()).not.toContain('fixer.suggestion');
  });

  it('does not nag while the token stays inside the ring', async () => {
    const before = gmWs.frames.filter((f) => f.type === 'fixer.suggestion').length;
    playerWs.send({ cmd: 'token.move', tokenId: ownTokenId, x: 39.5, y: 43.5 });
    await gmWs.next(
      (f) => f.type === 'token.moved' && (f.payload as { x?: number }).x === 39.5,
    );
    await settle();
    expect(gmWs.frames.filter((f) => f.type === 'fixer.suggestion')).toHaveLength(before);
  });
});

/**
 * The three table-feel commands (FR9.15/FR9.21). Before this round they had no
 * schema and no handler, so the GM's display console and the pointer trail were
 * client-only gestures that died at the socket.
 */
describe('table gestures: pointer, focus, display (FR9.15/FR9.21)', () => {
  it('relays a pointer trail to everyone, ephemeral and labelled', async () => {
    playerWs.send({ cmd: 'pointer', sceneId, x: 3.25, y: 4.75 });
    for (const ws of [gmWs, displayWs]) {
      const frame = await ws.next((f) => f.type === 'pointer');
      expect(frame.ephemeral).toBe(true);
      expect(frame.id).toBeUndefined();
      expect(frame.payload).toMatchObject({ x: 3.25, y: 4.75, sceneId, kind: 'pointer' });
    }
    await settle();
    expect(await persistedTypes()).not.toContain('pointer');
  });

  it('stamps kind on a plain ping too, so nothing downstream guesses', async () => {
    playerWs.send({ cmd: 'ping', sceneId, x: 1, y: 2 });
    const frame = await gmWs.next((f) => f.type === 'ping');
    expect(frame.payload).toMatchObject({ kind: 'ping' });
  });

  it('carries "focus here" as a ping-family mark with kind: focus', async () => {
    gmWs.send({ cmd: 'scene.focus', sceneId, x: 12, y: 13 });
    for (const ws of [playerWs, displayWs]) {
      const frame = await ws.next(
        (f) => f.type === 'ping' && (f.payload as { kind?: string }).kind === 'focus',
      );
      expect(frame.ephemeral).toBe(true);
      expect(frame.payload).toMatchObject({ x: 12, y: 13, sceneId });
    }
  });

  it('refuses focus from a player — nobody yanks the table camera but the GM', async () => {
    playerWs.send({ cmd: 'scene.focus', sceneId, x: 50, y: 50 });
    const err = await playerWs.next((f) => f.type === 'error');
    expect((err.payload as { code: string }).code).toBe('forbidden');
  });

  it('persists display.set as a public display.updated carrying the FULL state', async () => {
    gmWs.send({ cmd: 'display.set', blank: true });
    for (const ws of [gmWs, playerWs, displayWs]) {
      const frame = await ws.next((f) => f.type === 'display.updated');
      expect(frame.visibility).toBe('public');
      expect(typeof frame.id).toBe('number');
      // `ribbon` was never sent, but the event still answers for it: a TV that
      // reboots reads one event, not a patch history.
      expect(frame.payload).toMatchObject({ blank: true, ribbon: true });
    }
    expect(await persistedTypes()).toContain('display.updated');
  });

  it('merges the next patch onto the stored state instead of resetting it', async () => {
    gmWs.send({ cmd: 'display.set', ribbon: false });
    const frame = await displayWs.next(
      (f) => f.type === 'display.updated' && (f.payload as { ribbon?: boolean }).ribbon === false,
    );
    expect(frame.payload).toMatchObject({ blank: true, ribbon: false });
  });

  it('refuses display.set from a player socket', async () => {
    playerWs.send({ cmd: 'display.set', blank: true });
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
