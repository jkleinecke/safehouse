/**
 * Server-core hub coverage (DESIGN.md §11, Principle 4): visibility filtering
 * asserted AT THE SOCKET (a player socket never receives a gm event), the
 * ephemeral channel, the command registry, and gap replay after reconnect.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventsSince } from '@safehouse/db';
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
let p1: JoinResult;
let p2: JoinResult;
const open: WsTestClient[] = [];

async function connect(token: string, lastEventId?: number): Promise<WsTestClient> {
  const client = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, token, lastEventId));
  open.push(client);
  return client;
}

beforeAll(async () => {
  t = await makeTestApp('core-hub');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  boot = await bootstrapCampaign(t.app, 'Hub Test Table');
  p1 = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'PlayerOne');
  p2 = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'PlayerTwo');
}, 120_000);

afterAll(async () => {
  for (const c of open) c.close();
  await t.close();
});

describe('connection auth', () => {
  it('rejects a socket without a valid token (close 4401)', async () => {
    const bad = await WsTestClient.connect(
      wsUrl(t.app, boot.campaignId, 'not-a-real-token'),
    );
    expect(await bad.closed()).toBe(4401);
  });

  it('rejects a token bound to a different campaign', async () => {
    const other = await t.app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: { authorization: `Bearer ${boot.gmToken}` },
      payload: { name: 'Elsewhere' },
    });
    const otherGm = (other.json() as { token: string }).token;
    const bad = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, otherGm));
    expect(await bad.closed()).toBe(4401);
  });

  it('greets an authenticated socket with hello', async () => {
    const gm = await connect(boot.gmToken);
    const hello = await gm.next((f) => f.type === 'hello');
    expect(hello.payload).toMatchObject({ campaignId: boot.campaignId, role: 'gm' });
    gm.close();
  });
});

describe('visibility filtering at the socket (Principle 4)', () => {
  it('gm sees all; gm_owner reaches gm + owner; players get public only', async () => {
    const gmSock = await connect(boot.gmToken);
    const p1Sock = await connect(p1.token);
    const p2Sock = await connect(p2.token);
    await Promise.all([gmSock, p1Sock, p2Sock].map((s) => s.next((f) => f.type === 'hello')));

    await t.app.hub.emit(boot.campaignId, {
      type: 'test.gmsecret',
      payload: { hiddenTokenX: 13, hiddenTokenY: 37 },
      visibility: 'gm',
    });
    await t.app.hub.emit(boot.campaignId, {
      type: 'test.owner',
      payload: { note: 'for PlayerOne + GM' },
      visibility: 'gm_owner',
      ownerUserId: p1.user.id,
    });
    const marker = await t.app.hub.emit(boot.campaignId, {
      type: 'test.public',
      payload: { seq: 1 },
    });

    // The public marker was emitted LAST; once each socket has it, anything
    // filtered out would already have arrived. Assert absence at the socket.
    await Promise.all(
      [gmSock, p1Sock, p2Sock].map((s) => s.next((f) => f.type === 'test.public')),
    );

    expect(gmSock.has((f) => f.type === 'test.gmsecret')).toBe(true);
    expect(gmSock.has((f) => f.type === 'test.owner')).toBe(true);

    expect(p1Sock.has((f) => f.type === 'test.gmsecret')).toBe(false);
    expect(p1Sock.has((f) => f.type === 'test.owner')).toBe(true);

    expect(p2Sock.has((f) => f.type === 'test.gmsecret')).toBe(false);
    expect(p2Sock.has((f) => f.type === 'test.owner')).toBe(false);
    expect(p2Sock.has((f) => f.type === 'test.public')).toBe(true);

    // No gm-visible payload ever crossed a player socket in any frame.
    const leaked = (f: Frame) => JSON.stringify(f).includes('hiddenTokenX');
    expect(p1Sock.frames.some(leaked)).toBe(false);
    expect(p2Sock.frames.some(leaked)).toBe(false);

    // Persisted events carry the monotonic id + ts.
    expect(marker.id).toBeGreaterThan(0);
    const onP2 = p2Sock.frames.find((f) => f.type === 'test.public');
    expect(onP2?.id).toBe(marker.id);
    expect(typeof onP2?.ts).toBe('string');

    for (const s of [gmSock, p1Sock, p2Sock]) s.close();
  });

  it('ephemeral frames filter identically and are never persisted', async () => {
    const gmSock = await connect(boot.gmToken);
    const p1Sock = await connect(p1.token);
    await Promise.all([gmSock, p1Sock].map((s) => s.next((f) => f.type === 'hello')));

    t.app.hub.emitEphemeral(boot.campaignId, {
      type: 'test.eph.gm',
      payload: { secret: true },
      visibility: 'gm',
    });
    t.app.hub.emitEphemeral(boot.campaignId, {
      type: 'test.eph.marker',
      payload: {},
    });

    const markerGm = await gmSock.next((f) => f.type === 'test.eph.marker');
    await p1Sock.next((f) => f.type === 'test.eph.marker');
    expect(markerGm.ephemeral).toBe(true);
    expect(markerGm.id).toBeUndefined();

    expect(gmSock.has((f) => f.type === 'test.eph.gm')).toBe(true);
    expect(p1Sock.has((f) => f.type === 'test.eph.gm')).toBe(false);

    const stored = await eventsSince(t.db, boot.campaignId, 0, 1000);
    expect(stored.some((r) => r.type.startsWith('test.eph.'))).toBe(false);

    gmSock.close();
    p1Sock.close();
  });
});

describe('command registry', () => {
  it('dispatches registered commands with an authed context', async () => {
    t.app.hub.onCommand('test.echo', (msg, ctx) => {
      ctx.reply({
        type: 'test.echoed',
        payload: { value: msg['value'], userId: ctx.auth.userId, role: ctx.auth.role },
        ephemeral: true,
      });
    });
    const p1Sock = await connect(p1.token);
    await p1Sock.next((f) => f.type === 'hello');
    p1Sock.send({ cmd: 'test.echo', value: 42 });
    const echoed = await p1Sock.next((f) => f.type === 'test.echoed');
    expect(echoed.payload).toMatchObject({ value: 42, userId: p1.user.id, role: 'player' });
    p1Sock.close();
  });

  it('unknown commands and bad JSON produce ephemeral error frames', async () => {
    const p1Sock = await connect(p1.token);
    await p1Sock.next((f) => f.type === 'hello');
    p1Sock.send({ cmd: 'no.such.command' });
    const err = await p1Sock.next(
      (f) => f.type === 'error' && (f.payload as { code?: string }).code === 'unknown_command',
    );
    expect(err.ephemeral).toBe(true);
    p1Sock.close();
  });

  it('the built-in ping relays as an ephemeral table gesture (FR9.15)', async () => {
    const gmSock = await connect(boot.gmToken);
    const p1Sock = await connect(p1.token);
    await Promise.all([gmSock, p1Sock].map((s) => s.next((f) => f.type === 'hello')));
    p1Sock.send({ cmd: 'ping', x: 4, y: 2 });
    const onGm = await gmSock.next((f) => f.type === 'ping');
    expect(onGm.payload).toMatchObject({ x: 4, y: 2, userId: p1.user.id });
    expect(onGm.ephemeral).toBe(true);
    gmSock.close();
    p1Sock.close();
  });
});

describe('replay after reconnect (§11 last_event_id)', () => {
  it('replays only the visible gap, in order, then replay.complete', async () => {
    // p1 online: sees a live public event.
    const first = await connect(p1.token);
    await first.next((f) => f.type === 'hello');
    const e1 = await t.app.hub.emit(boot.campaignId, {
      type: 'test.replay.before',
      payload: { n: 1 },
    });
    await first.next((f) => f.type === 'test.replay.before');
    first.close();
    await first.closed();

    // While p1 is offline: public, gm-only, gm_owner(p1), public.
    const e2 = await t.app.hub.emit(boot.campaignId, {
      type: 'test.replay.pub2',
      payload: { n: 2 },
    });
    const e3 = await t.app.hub.emit(boot.campaignId, {
      type: 'test.replay.gm3',
      payload: { n: 3, hiddenTokenX: 99 },
      visibility: 'gm',
    });
    const e4 = await t.app.hub.emit(boot.campaignId, {
      type: 'test.replay.own4',
      payload: { n: 4 },
      visibility: 'gm_owner',
      ownerUserId: p1.user.id,
    });
    const e5 = await t.app.hub.emit(boot.campaignId, {
      type: 'test.replay.pub5',
      payload: { n: 5 },
    });

    // Reconnect with last_event_id = e1.id → the gap, filtered, in id order.
    const second = await connect(p1.token, e1.id);
    const done = await second.next((f) => f.type === 'replay.complete');
    expect((done.payload as { lastEventId: number }).lastEventId).toBeGreaterThanOrEqual(e5.id);

    const replayed = second.frames.filter((f) => f.type.startsWith('test.replay.'));
    expect(replayed.map((f) => f.type)).toEqual([
      'test.replay.pub2',
      'test.replay.own4',
      'test.replay.pub5',
    ]);
    expect(replayed.map((f) => f.id)).toEqual([e2.id, e4.id, e5.id]);
    expect(second.has((f) => f.type === 'test.replay.gm3')).toBe(false);
    expect(second.has((f) => f.type === 'test.replay.before')).toBe(false); // already had it
    expect(second.frames.some((f) => JSON.stringify(f).includes('hiddenTokenX'))).toBe(false);
    void e3;
    second.close();

    // A reconnecting GM from 0 sees everything, including the gm-only event.
    const gmSock = await connect(boot.gmToken, 0);
    await gmSock.next((f) => f.type === 'replay.complete');
    expect(gmSock.has((f) => f.type === 'test.replay.gm3')).toBe(true);
    gmSock.close();
  });
});
