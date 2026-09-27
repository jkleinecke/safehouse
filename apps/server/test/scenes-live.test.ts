/**
 * M9 Grid realtime coverage (§11): activation broadcast, the ephemeral drag
 * channel (relayed, throttled, never written to `ws_events`), the persisted
 * final move, hidden-token events that never touch a player socket, and the
 * reveal that arrives as a NEW token rather than a position update (FR9.7).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { characters, eventsSince, scenes as scenesTable } from '@safehouse/db';
import { eq } from 'drizzle-orm';
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

/**
 * The first frame in `ws.frames` from index `mark` on that matches `pred`,
 * waiting for it if it has not come yet. `next` alone searches the whole
 * history, and in a file where every block sends the same kinds of frame the
 * one it finds may be an earlier block's.
 */
function nextAfter(ws: WsTestClient, mark: number, pred: (f: Frame) => boolean): Promise<Frame> {
  return ws.next((f) => ws.frames.indexOf(f) >= mark && pred(f));
}

/** Every frame the player's phone and the TV were sent from their marks on, as one string to search. */
function tableSince(marks: { player: number; display: number }): string {
  return JSON.stringify([...playerWs.frames.slice(marks.player), ...displayWs.frames.slice(marks.display)]);
}

const isFog = (op: string) => (f: Frame) =>
  f.type === 'fog.updated' && (f.payload as { op?: string }).op === op;

describe('fog over the wire (FR9.13/9.14)', () => {
  it('fogs the open scene with its first define: the table hears that one bit, and nothing of the region', async () => {
    // The scene has had no region until now, so this define is what turns
    // its fog on. The GM's own define event is the GM's. Before, it was the
    // only one, so no player device and no TV was ever told the scene was
    // now fogged; they went on drawing the whole map until someone reloaded.
    // Now the table is sent a public word too, and it is ONE bit: no id, no
    // name, no outline of a region nobody has revealed.
    //
    // A NEW scene starts with its fog switched off, so for this to be the
    // define that fogs it the scene plays one made before the switch existed
    // (no `enabled` stored): those keep the old rule, on once a region exists.
    await t.db
      .update(scenesTable)
      .set({ fog: { regions: [], revealed: [], revealedShapes: [] } })
      .where(eq(scenesTable.id, sceneId));
    const marks = { player: playerWs.frames.length, display: displayWs.frames.length };
    gmWs.send({
      cmd: 'fog.reveal',
      sceneId,
      op: 'define',
      region: { id: 'east-wing', name: 'east wing', polygon: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }] },
    });
    // The GM's own event, scoped to the GM.
    await gmWs.next((f) => isFog('define')(f) && f.visibility === 'gm');

    for (const [ws, mark] of [
      [playerWs, marks.player],
      [displayWs, marks.display],
    ] as const) {
      const word = await nextAfter(ws, mark, isFog('define'));
      expect(word.visibility).toBe('public');
      expect(word.payload).toEqual({ sceneId, op: 'define', active: true });
    }
    await settle();
    const table = tableSince(marks);
    expect(table).not.toContain('east wing');
    expect(table).not.toContain('east-wing');
    expect(table).not.toContain('polygon');
  });

  it('reveals the region to all', async () => {
    gmWs.send({ cmd: 'fog.reveal', sceneId, op: 'reveal', regionId: 'east-wing', announce: true });
    const revealed = await playerWs.next(
      (f) => f.type === 'fog.updated' && (f.payload as { op?: string }).op === 'reveal',
    );
    expect(revealed.visibility).toBe('public');
    expect((revealed.payload as { region: { name: string } }).region.name).toBe('east wing');
    await playerWs.next((f) => f.type === 'log.posted');
    expect(await persistedTypes()).toContain('fog.updated');
  });

  it('keeps the table covered through a reset: a hide with no region still says `active: true`', async () => {
    // The GM's reset takes back every reveal and leaves the fog whole. A
    // device folding events (the TV) must hear that the scene is still
    // fogged, or the last reveal taken back reads as the fog going away.
    const marks = { player: playerWs.frames.length, display: displayWs.frames.length };
    gmWs.send({ cmd: 'fog.reveal', sceneId, op: 'hide' });
    for (const [ws, mark] of [
      [playerWs, marks.player],
      [displayWs, marks.display],
    ] as const) {
      const reset = await nextAfter(ws, mark, isFog('hide'));
      expect(reset.visibility).toBe('public');
      expect(reset.payload).toEqual({ sceneId, op: 'hide', active: true });
    }
  });

  it("sends the GM's fog switch to the table as that bit alone: off opens the map, on covers it", async () => {
    let marks = { player: playerWs.frames.length, display: displayWs.frames.length };
    gmWs.send({ cmd: 'fog.reveal', sceneId, op: 'disable' });
    for (const [ws, mark] of [
      [playerWs, marks.player],
      [displayWs, marks.display],
    ] as const) {
      const off = await nextAfter(ws, mark, isFog('disable'));
      expect(off.visibility).toBe('public');
      expect(off.payload).toEqual({ sceneId, op: 'disable', active: false });
    }

    // Back on, so the rest of this file plays on a fogged scene as before.
    marks = { player: playerWs.frames.length, display: displayWs.frames.length };
    gmWs.send({ cmd: 'fog.reveal', sceneId, op: 'enable' });
    for (const [ws, mark] of [
      [playerWs, marks.player],
      [displayWs, marks.display],
    ] as const) {
      const on = await nextAfter(ws, mark, isFog('enable'));
      expect(on.payload).toEqual({ sceneId, op: 'enable', active: true });
    }
    await settle();
    expect(tableSince(marks)).not.toContain('east wing');
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
 * Tokens standing in fog nobody has revealed exist only on GM sockets
 * (FR9.13, Principle 4), exactly as hidden tokens do (FR9.7).
 *
 * Before, the fog was only ever a cover the client drew. Every guard behind
 * it was on every player's socket and the TV's: where he was placed, every
 * frame of the GM dragging him, and where he was dropped. Now the server
 * withholds him until the ground he stands on is revealed, sends him then as
 * a NEW token arriving (`token.added`, as a hidden token's reveal does), and
 * takes him back with `token.removed` when the ground is hidden again. A
 * runner (a party token) is never withheld: the fog hides what the runners
 * have not found, never the runners themselves.
 *
 * The scene's fog is on here: the blocks above defined regions on it and left
 * its switch on.
 */
describe('tokens under the fog exist only on GM sockets (FR9.13, Principle 4)', () => {
  const VAULT_ID = 'vault-7';
  const VAULT_POLY = [
    { x: 60, y: 60 },
    { x: 70, y: 60 },
    { x: 70, y: 70 },
    { x: 60, y: 70 },
  ];
  const GUARD = 'Guard-Lambda';
  // Coordinates with more decimals than a timestamp's milliseconds have, so a
  // search of the frames for one can only ever find the guard himself.
  const GUARD_AT = { x: 63.4375, y: 64.5625 };
  const DRAGGED_TO = { x: 65.3125, y: 66.6875 };
  const MOVED_TO = { x: 66.1875, y: 62.8125 };
  /** Under the fog too, but outside the vault. */
  const OUT_IN_THE_DARK = { x: 75.4375, y: 76.5625 };
  let guardId: string;

  const tableMarks = () => ({ player: playerWs.frames.length, display: displayWs.frames.length });
  const hasGuard = (f: Frame) => JSON.stringify(f).includes(guardId);

  it('never sends the table a guard placed in fog nobody has revealed', async () => {
    const gmMark = gmWs.frames.length;
    gmWs.send({ cmd: 'fog.reveal', sceneId, op: 'define', region: { id: VAULT_ID, name: 'the vault', polygon: VAULT_POLY } });
    await nextAfter(gmWs, gmMark, (f) => isFog('define')(f) && f.visibility === 'gm');

    const marks = tableMarks();
    const res = await post(`/api/scenes/${sceneId}/tokens`, boot.gmToken, {
      source: 'npc_template',
      name: GUARD,
      ...GUARD_AT,
    });
    expect(res.statusCode).toBe(201);
    guardId = (res.json() as { token: { id: string } }).token.id;

    const added = await gmWs.next((f) => f.type === 'token.added' && hasGuard(f));
    expect(added.visibility).toBe('gm');
    await settle();
    const table = tableSince(marks);
    expect(table).not.toContain(guardId);
    expect(table).not.toContain(GUARD);
    expect(table).not.toContain(String(GUARD_AT.x));
    expect(table).not.toContain(String(GUARD_AT.y));
  });

  it('keeps his drag and his move off the table while he stays in the fog', async () => {
    const marks = tableMarks();
    const gmMark = gmWs.frames.length;
    // A drag frame is ephemeral and carries no `visibility` of its own on
    // the wire; that it reached the GM and nothing reached the table is the
    // whole of it.
    gmWs.send({ cmd: 'token.drag', tokenId: guardId, ...DRAGGED_TO });
    await nextAfter(gmWs, gmMark, (f) => f.type === 'token.dragging' && hasGuard(f));

    gmWs.send({ cmd: 'token.move', tokenId: guardId, ...MOVED_TO });
    const moved = await nextAfter(gmWs, gmMark, (f) => f.type === 'token.moved' && hasGuard(f));
    expect(moved.visibility).toBe('gm');
    await settle();

    const table = tableSince(marks);
    expect(table).not.toContain(guardId);
    for (const n of [DRAGGED_TO.x, DRAGGED_TO.y, MOVED_TO.x, MOVED_TO.y]) expect(table).not.toContain(String(n));
  });

  it('sends him as a NEW token once his room is revealed, and takes him away when it is hidden', async () => {
    let marks = tableMarks();
    gmWs.send({ cmd: 'fog.reveal', sceneId, op: 'reveal', regionId: VAULT_ID });
    for (const [ws, mark] of [
      [playerWs, marks.player],
      [displayWs, marks.display],
    ] as const) {
      const arrival = await nextAfter(ws, mark, (f) => f.type === 'token.added' && hasGuard(f));
      expect(arrival.visibility).toBe('public');
      // Where he stands NOW: the move the table was never shown is folded in.
      expect((arrival.payload as { token: unknown }).token).toMatchObject({ id: guardId, name: GUARD, ...MOVED_TO });
      // After the reveal itself, so a device folding in order has the hole
      // in its fog before the guard standing in it arrives.
      const revealAt = ws.frames.findIndex((f, i) => i >= mark && isFog('reveal')(f));
      expect(revealAt).toBeGreaterThanOrEqual(mark);
      expect(revealAt).toBeLessThan(ws.frames.indexOf(arrival));
    }

    // Visible now, but dragged back into the dark: the drag must not draw
    // his path through the fog on the table's screens.
    marks = tableMarks();
    const gmMark = gmWs.frames.length;
    gmWs.send({ cmd: 'token.drag', tokenId: guardId, ...OUT_IN_THE_DARK });
    await nextAfter(gmWs, gmMark, (f) => f.type === 'token.dragging' && hasGuard(f));
    await settle();
    expect(tableSince(marks)).not.toContain('token.dragging');
    expect(tableSince(marks)).not.toContain(String(OUT_IN_THE_DARK.x));

    marks = tableMarks();
    gmWs.send({ cmd: 'fog.reveal', sceneId, op: 'hide', regionId: VAULT_ID });
    for (const [ws, mark] of [
      [playerWs, marks.player],
      [displayWs, marks.display],
    ] as const) {
      const gone = await nextAfter(ws, mark, (f) => f.type === 'token.removed' && hasGuard(f));
      expect(gone.visibility).toBe('public');
      expect(gone.payload).toEqual({ tokenId: guardId, sceneId });
    }
    await settle();
    // Gone, and nothing else of him: not a GM-side update of where he is.
    const after = [...playerWs.frames.slice(marks.player), ...displayWs.frames.slice(marks.display)];
    expect(after.filter(hasGuard).map((f) => f.type)).toEqual(['token.removed', 'token.removed']);
  });

  it('never withholds a runner, wherever they walk', async () => {
    // The vault is fogged again, and the runner walks into it.
    const marks = tableMarks();
    playerWs.send({ cmd: 'token.move', tokenId: ownTokenId, x: 61.5, y: 68.5 });
    const moved = await nextAfter(
      displayWs,
      marks.display,
      (f) => f.type === 'token.moved' && (f.payload as { tokenId?: string }).tokenId === ownTokenId,
    );
    expect(moved.visibility).toBe('public');
    expect(moved.payload).toMatchObject({ x: 61.5, y: 68.5 });
    expect(tableSince(marks)).not.toContain('token.removed');

    const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: headers(display.token) });
    const ids = (res.json() as { tokens: { id: string }[] }).tokens.map((x) => x.id);
    expect(ids).toContain(ownTokenId);
    expect(ids).not.toContain(guardId);
  });

  it('shows the table his room as seen-before and never him, his drag or his move; revealed live, he arrives (P6)', async () => {
    // The GM's second reveal fashion (the GM, 2026-09-27): EXPLORED shows the
    // table the ground dimmed, as remembered, with nobody on it. So revealing
    // the vault that way must put its outline on the table's sockets and
    // nothing of the guard standing in it: no arrival, no drag frame, no move.
    /** Where the GM drags and drops him inside the remembered vault, in decimals nothing else has. */
    const PACING = { x: 67.3125, y: 61.6875 };
    const PACED_TO = { x: 68.4375, y: 63.5625 };
    const tables = (m: { player: number; display: number }) =>
      [
        [playerWs, m.player],
        [displayWs, m.display],
      ] as const;

    let marks = tableMarks();
    gmWs.send({ cmd: 'fog.reveal', sceneId, op: 'reveal', regionId: VAULT_ID, as: 'explored' });
    for (const [ws, mark] of tables(marks)) {
      const word = await nextAfter(ws, mark, isFog('reveal'));
      expect(word.visibility).toBe('public');
      expect(word.payload).toMatchObject({ sceneId, op: 'reveal', regionId: VAULT_ID, as: 'explored', active: true });
      expect((word.payload as { region: { name: string } }).region.name).toBe('the vault');
    }

    const gmMark = gmWs.frames.length;
    gmWs.send({ cmd: 'token.drag', tokenId: guardId, ...PACING });
    await nextAfter(gmWs, gmMark, (f) => f.type === 'token.dragging' && hasGuard(f));
    gmWs.send({ cmd: 'token.move', tokenId: guardId, ...PACED_TO });
    const moved = await nextAfter(gmWs, gmMark, (f) => f.type === 'token.moved' && hasGuard(f));
    expect(moved.visibility).toBe('gm');
    await settle();
    const table = tableSince(marks);
    expect(table).not.toContain(guardId);
    expect(table).not.toContain(GUARD);
    expect(table).not.toContain('token.dragging');
    for (const n of [PACING.x, PACING.y, PACED_TO.x, PACED_TO.y]) expect(table).not.toContain(String(n));

    // A fresh read says the same: the vault remembered, the guard not there.
    for (const who of [player, display]) {
      const res = await t.app.inject({ method: 'GET', url: `/api/scenes/${sceneId}`, headers: headers(who.token) });
      const body = res.json() as { scene: { fog: { revealed: string[]; exploredRegionIds?: string[] } }; tokens: { id: string }[] };
      expect(body.scene.fog.exploredRegionIds).toEqual([VAULT_ID]);
      expect(body.scene.fog.revealed).not.toContain(VAULT_ID);
      expect(body.tokens.map((x) => x.id)).not.toContain(guardId);
      expect(res.body).not.toContain(guardId);
    }

    // Revealed live: he arrives as a NEW token, where the GM left him, after
    // the reveal that says it is live now.
    marks = tableMarks();
    gmWs.send({ cmd: 'fog.reveal', sceneId, op: 'reveal', regionId: VAULT_ID, as: 'live' });
    for (const [ws, mark] of tables(marks)) {
      const arrival = await nextAfter(ws, mark, (f) => f.type === 'token.added' && hasGuard(f));
      expect(arrival.visibility).toBe('public');
      expect((arrival.payload as { token: unknown }).token).toMatchObject({ id: guardId, name: GUARD, ...PACED_TO });
      const word = ws.frames.find((f, i) => i >= mark && isFog('reveal')(f));
      expect(word?.payload).toMatchObject({ regionId: VAULT_ID, as: 'live' });
      expect(ws.frames.indexOf(word!)).toBeLessThan(ws.frames.indexOf(arrival));
    }

    // Dropped back to seen-before: he leaves the table again, and nothing else of him goes with it.
    marks = tableMarks();
    gmWs.send({ cmd: 'fog.reveal', sceneId, op: 'reveal', regionId: VAULT_ID, as: 'explored' });
    for (const [ws, mark] of tables(marks)) {
      const gone = await nextAfter(ws, mark, (f) => f.type === 'token.removed' && hasGuard(f));
      expect(gone.visibility).toBe('public');
      expect(gone.payload).toEqual({ tokenId: guardId, sceneId });
    }
    await settle();
    const after = [...playerWs.frames.slice(marks.player), ...displayWs.frames.slice(marks.display)];
    expect(after.filter(hasGuard).map((f) => f.type)).toEqual(['token.removed', 'token.removed']);

    // The vault back under the fog, as the blocks after this one found it.
    marks = tableMarks();
    gmWs.send({ cmd: 'fog.reveal', sceneId, op: 'hide', regionId: VAULT_ID });
    for (const [ws, mark] of tables(marks)) await nextAfter(ws, mark, isFog('hide'));
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

/**
 * The party's sight rides the drop (P6 sightlines): a runner's `token.move`
 * works the pooled sight out again in the same commit, and the table's
 * sockets hear the move, then the sight (`fog.updated`, op 'sight'), then
 * whoever the move brought into view (`token.added`), in that order.
 *
 * Played on this file's scene as the blocks above left it (the fog on, the
 * runner at (61.5, 68.5)), made big enough for him, and dark.
 */
describe('the party’s sight rides the token.move commit (P6)', () => {
  it('a runner with a flashlight walks up to a guard in the dark: the table hears the move, the sight, then the guard', async () => {
    const tables = (m: { player: number; display: number }) =>
      [
        [playerWs, m.player],
        [displayWs, m.display],
      ] as const;
    const patchScene = async (payload: Record<string, unknown>) => {
      const res = await t.app.inject({ method: 'PATCH', url: `/api/scenes/${sceneId}`, headers: headers(boot.gmToken), payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(200);
    };

    // A grid the runner stands on, pitch black, with its sightlines on.
    await patchScene({ grid: { cols: 80, rows: 80 }, environment: { light: 3 }, vision: { sight: 'on' } });
    const guard = await post(`/api/scenes/${sceneId}/tokens`, boot.gmToken, { source: 'npc_template', name: 'Guard-Mu', x: 66.5, y: 68.5 });
    expect(guard.statusCode).toBe(201);
    const guardId = (guard.json() as { token: { id: string } }).token.id;
    const hasGuard = (f: Frame) => JSON.stringify(f).includes(guardId);

    // The GM hands the runner a flashlight: three metres of light round him,
    // not yet reaching the guard five squares off.
    const lit = await t.app.inject({
      method: 'PATCH',
      url: `/api/tokens/${ownTokenId}`,
      headers: headers(boot.gmToken),
      payload: { light: { radiusM: 3 } },
    });
    expect(lit.statusCode).toBe(200);
    await settle();

    const marks = { player: playerWs.frames.length, display: displayWs.frames.length };
    playerWs.send({ cmd: 'token.move', tokenId: ownTokenId, x: 64.5, y: 68.5 });
    for (const [ws, mark] of tables(marks)) {
      const moved = await nextAfter(ws, mark, (f) => f.type === 'token.moved' && (f.payload as { tokenId?: string }).tokenId === ownTokenId);
      const sight = await nextAfter(ws, mark, isFog('sight'));
      const arrival = await nextAfter(ws, mark, (f) => f.type === 'token.added' && hasGuard(f));
      expect(sight.visibility).toBe('public');
      expect(sight.payload).toMatchObject({ sceneId, op: 'sight', cols: 80, rows: 80, active: true });
      expect(arrival.visibility).toBe('public');
      expect((arrival.payload as { token: unknown }).token).toMatchObject({ id: guardId, x: 66.5, y: 68.5 });
      // In order: the move, the sight it gave, the guard standing in it.
      expect(ws.frames.indexOf(moved)).toBeLessThan(ws.frames.indexOf(sight));
      expect(ws.frames.indexOf(sight)).toBeLessThan(ws.frames.indexOf(arrival));
    }

    // Sightlines off again, and the lights back on, for whatever follows.
    await patchScene({ environment: { light: 0 }, vision: { sight: 'off' } });
  });
});

/**
 * A scene the GM is staging has no table (P6 secrecy sweep): nobody but the
 * GM can open it, so nothing that happens on it reaches a player's phone or
 * the TV, not even the ephemeral frames of a guard being dragged across it.
 * Before, a guard placed, dragged and dropped on a staged scene went out on
 * every socket with his name and every square he crossed.
 */
describe('a scene the GM is staging exists only on GM sockets (P6)', () => {
  it('keeps a guard placed, dragged and dropped there off the table, and the region revealed there too', async () => {
    const made = await post(`/api/campaigns/${boot.campaignId}/scenes`, boot.gmToken, { name: 'Next job' });
    expect(made.statusCode).toBe(201);
    const stagedId = (made.json() as { scene: { id: string } }).scene.id;
    const GUARD = 'Guard-Rho';
    const ROOM = 'the room being staged';
    const marks = { player: playerWs.frames.length, display: displayWs.frames.length };
    const gmMark = gmWs.frames.length;

    const guard = await post(`/api/scenes/${stagedId}/tokens`, boot.gmToken, { source: 'npc_template', name: GUARD, x: 5.4375, y: 6.5625 });
    expect(guard.statusCode).toBe(201);
    const guardId = (guard.json() as { token: { id: string } }).token.id;
    const hasGuard = (f: Frame) => JSON.stringify(f).includes(guardId);
    const added = await nextAfter(gmWs, gmMark, (f) => f.type === 'token.added' && hasGuard(f));
    expect(added.visibility).toBe('gm');

    gmWs.send({ cmd: 'token.drag', tokenId: guardId, x: 7.3125, y: 8.6875 });
    await nextAfter(gmWs, gmMark, (f) => f.type === 'token.dragging' && hasGuard(f));
    gmWs.send({ cmd: 'token.move', tokenId: guardId, x: 9.1875, y: 10.8125 });
    const moved = await nextAfter(gmWs, gmMark, (f) => f.type === 'token.moved' && hasGuard(f));
    expect(moved.visibility).toBe('gm');

    const room = [
      { x: 4, y: 4 },
      { x: 12, y: 4 },
      { x: 12, y: 12 },
      { x: 4, y: 12 },
    ];
    gmWs.send({ cmd: 'fog.reveal', sceneId: stagedId, op: 'enable' });
    gmWs.send({ cmd: 'fog.reveal', sceneId: stagedId, op: 'define', region: { id: 'staged-room', name: ROOM, polygon: room } });
    gmWs.send({ cmd: 'fog.reveal', sceneId: stagedId, op: 'reveal', regionId: 'staged-room' });
    const revealed = await nextAfter(gmWs, gmMark, (f) => isFog('reveal')(f) && JSON.stringify(f).includes(ROOM));
    expect(revealed.visibility).toBe('gm');
    await settle();

    const table = tableSince(marks);
    for (const secret of [guardId, GUARD, '7.3125', '8.6875', '9.1875', '10.8125', 'staged-room', ROOM]) {
      expect(table, secret).not.toContain(secret);
    }
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
