/**
 * The GM's rule (2026-09-27): a player's runner never passes a wall or a
 * closed door; the GM moves anything anywhere.
 *
 * Over both ways a player moves a token — the drop over the socket
 * (`token.move`) and a PATCH of `x`/`y` — and the drag frames in between:
 * a move through a painted wall is refused and the token stays; round it
 * through an open door is fine; a shut painted door and a shut traced door
 * both block until opened; a slanted painted wall cannot be slipped through
 * diagonally; and none of it applies to the GM.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { characters, tokens } from '@safehouse/db';
import { eq } from 'drizzle-orm';
import { ScenesService } from '../src/services/scenes.js';
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
let gmWs: WsTestClient;
let playerWs: WsTestClient;
let sceneId: string;
let tokenId: string;
const open: WsTestClient[] = [];

/** A token's centre in square (`col`, `row`). */
const sq = (col: number, row: number) => ({ x: col + 0.5, y: row + 0.5 });

function headers(token: string) {
  return { authorization: `Bearer ${token}` };
}
async function post(url: string, token: string, payload: unknown) {
  return t.app.inject({ method: 'POST', url, headers: headers(token), payload: payload as object });
}
async function patch(url: string, token: string, payload: unknown) {
  return t.app.inject({ method: 'PATCH', url, headers: headers(token), payload: payload as object });
}
async function connect(token: string): Promise<WsTestClient> {
  const c = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, token));
  open.push(c);
  await c.next((f) => f.type === 'hello');
  return c;
}
function settle(ms = 250): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Where the token is stored. */
async function stored(): Promise<{ x: number; y: number }> {
  const row = (await t.db.select().from(tokens).where(eq(tokens.id, tokenId)).limit(1))[0]!;
  return { x: row.x, y: row.y };
}

/**
 * The GM puts the token somewhere: never judged. Waits for the GM's socket
 * to hear the move, so a test marking the frames after it starts clean.
 */
async function place(at: { x: number; y: number }): Promise<void> {
  const mark = gmWs.frames.length;
  const res = await patch(`/api/tokens/${tokenId}`, boot.gmToken, at);
  expect(res.statusCode).toBe(200);
  expect(await stored()).toEqual(at);
  await nextAfter(gmWs, mark, movedTo(at));
}

/** The first frame on `ws` after `mark` (a count of its frames) that matches. */
function nextAfter(ws: WsTestClient, mark: number, pred: (f: Frame) => boolean): Promise<Frame> {
  return ws.next((f) => ws.frames.indexOf(f) >= mark && pred(f));
}

const movedTo = (at: { x: number; y: number }) => (f: Frame) =>
  f.type === 'token.moved' &&
  (f.payload as { tokenId?: string }).tokenId === tokenId &&
  (f.payload as { x?: number }).x === at.x &&
  (f.payload as { y?: number }).y === at.y;

/** A drop over the socket, by `ws`; resolves with the token.moved or the error that answers it. */
async function drop(ws: WsTestClient, at: { x: number; y: number }): Promise<Frame> {
  const mark = ws.frames.length;
  ws.send({ cmd: 'token.move', tokenId, x: at.x, y: at.y });
  return nextAfter(ws, mark, (f) => f.type === 'error' || movedTo(at)(f));
}

function code(res: { json(): unknown }): string {
  return (res.json() as { error: { code: string } }).error.code;
}

/*
 * The map (docklands, the default 30 × 30 grid):
 * - a painted room, walls round cols 2–8 × rows 2–8, a door in its top wall
 *   at (5,2);
 * - a traced room, walls on the grid lines x 20–24 × y 2–6, a traced door
 *   in its top wall from (22,2) to (23,2);
 * - a slanted painted wall cutting off the bottom-right corner of the map:
 *   squares (20,29), (21,28) … (29,20), which touch only at their corners.
 */
beforeAll(async () => {
  t = await makeTestApp('walls-walk');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  boot = await bootstrapCampaign(t.app, 'Walled Table');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  const inserted = await t.db
    .insert(characters)
    .values({
      campaignId: boot.campaignId,
      ownerUserId: player.user.id,
      name: 'Static',
      sheet: { v: 1, identity: { alias: 'Static' }, attributes: { bod: 4, rea: 5, int: 4, wil: 3 } },
    })
    .returning();

  const created = await post(`/api/campaigns/${boot.campaignId}/scenes`, boot.gmToken, { name: 'Compound' });
  sceneId = (created.json() as { scene: { id: string } }).scene.id;
  expect((await post(`/api/scenes/${sceneId}/activate`, boot.gmToken, {})).statusCode).toBe(200);

  const paint: Record<string, string> = {};
  for (let i = 2; i <= 8; i += 1) {
    paint[`${i},2`] = 'wall';
    paint[`${i},8`] = 'wall';
    paint[`2,${i}`] = 'wall';
    paint[`8,${i}`] = 'wall';
  }
  paint['5,2'] = 'door';
  for (let i = 0; i <= 9; i += 1) paint[`${20 + i},${29 - i}`] = 'wall';
  expect((await post(`/api/scenes/${sceneId}/tiles`, boot.gmToken, { tilesetId: 'docklands', paint })).statusCode).toBe(200);

  const traced = await patch(`/api/scenes/${sceneId}`, boot.gmToken, {
    geometry: {
      walls: [
        { id: 'w.left', a: { x: 20, y: 2 }, b: { x: 20, y: 6 } },
        { id: 'w.right', a: { x: 24, y: 2 }, b: { x: 24, y: 6 } },
        { id: 'w.bottom', a: { x: 20, y: 6 }, b: { x: 24, y: 6 } },
        { id: 'w.top1', a: { x: 20, y: 2 }, b: { x: 22, y: 2 } },
        { id: 'w.top2', a: { x: 23, y: 2 }, b: { x: 24, y: 2 } },
      ],
      doors: [{ id: 'd.room', a: { x: 22, y: 2 }, b: { x: 23, y: 2 } }],
      zones: [],
      pins: [],
    },
  });
  expect(traced.statusCode).toBe(200);

  const token = await post(`/api/scenes/${sceneId}/tokens`, boot.gmToken, {
    source: 'character',
    sourceId: inserted[0]!.id,
    ...sq(5, 0),
  });
  tokenId = (token.json() as { token: { id: string } }).token.id;

  gmWs = await connect(boot.gmToken);
  playerWs = await connect(player.token);
}, 180_000);

afterAll(async () => {
  for (const c of open) c.close();
  await t.close();
});

describe('a painted wall and a painted door', () => {
  it('refuses a player’s drop through the wall, and the token stays where it was', async () => {
    await place(sq(5, 0));
    const gmMark = gmWs.frames.length;
    const answer = await drop(playerWs, sq(5, 5));
    expect(answer.type).toBe('error');
    expect(answer.payload).toEqual({ code: 'blocked', message: "Your runner can't go through walls" });
    expect(await stored()).toEqual(sq(5, 0));
    // Every other screen's drag ghost is sent home to the square it never left.
    const home = await nextAfter(gmWs, gmMark, (f) => f.type === 'token.dragging');
    expect(home.payload).toMatchObject({ tokenId, ...sq(5, 0) });
    expect(gmWs.frames.slice(gmMark).some(movedTo(sq(5, 5)))).toBe(false);
  });

  it('refuses the same move by PATCH', async () => {
    const res = await patch(`/api/tokens/${tokenId}`, player.token, sq(5, 5));
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('blocked');
    expect(await stored()).toEqual(sq(5, 0));
    // Only one axis sent: judged from the stored other one, and still a wall.
    const half = await patch(`/api/tokens/${tokenId}`, player.token, { y: 5.5 });
    expect(half.statusCode).toBe(403);
    expect(await stored()).toEqual(sq(5, 0));
  });

  it('refuses a step into the shut door itself', async () => {
    const answer = await drop(playerWs, sq(5, 2));
    expect(answer.type).toBe('error');
    expect(await stored()).toEqual(sq(5, 0));
  });

  it('lets the runner in through the door once it is open, and round inside the room', async () => {
    // The runner steps up to the door, and the player opens it from there.
    expect((await drop(playerWs, sq(5, 1))).type).toBe('token.moved');
    const opened = await post(`/api/scenes/${sceneId}/doors`, player.token, { cell: '5,2', level: 0, op: 'open' });
    expect(opened.statusCode).toBe(200);
    const answer = await drop(playerWs, sq(3, 7));
    expect(answer.type).toBe('token.moved');
    expect(await stored()).toEqual(sq(3, 7));
    // …and out again by PATCH, the same way.
    const out = await patch(`/api/tokens/${tokenId}`, player.token, sq(12, 5));
    expect(out.statusCode).toBe(200);
    expect(await stored()).toEqual(sq(12, 5));
    // Walking past a wall on the outside was never a question.
    expect((await drop(playerWs, sq(12, 1))).type).toBe('token.moved');
  });

  it('shut again, it blocks again', async () => {
    await place(sq(4, 1));
    const closed = await post(`/api/scenes/${sceneId}/doors`, player.token, { cell: '5,2', level: 0, op: 'close' });
    expect(closed.statusCode).toBe(200);
    await place(sq(5, 0));
    expect((await drop(playerWs, sq(5, 4))).type).toBe('error');
    expect(await stored()).toEqual(sq(5, 0));
  });
});

describe('a traced wall and a traced door', () => {
  it('a shut traced door blocks; opening it lets the move through', async () => {
    await place(sq(22, 0));
    expect((await drop(playerWs, sq(22, 4))).type).toBe('error');
    expect(await stored()).toEqual(sq(22, 0));
    const res = await patch(`/api/tokens/${tokenId}`, player.token, sq(21, 3));
    expect(res.statusCode).toBe(403);

    // Up to the door, which the player opens from there.
    expect((await drop(playerWs, sq(22, 1))).type).toBe('token.moved');
    const opened = await post(`/api/scenes/${sceneId}/doors`, player.token, { doorId: 'd.room', op: 'open' });
    expect(opened.statusCode).toBe(200);
    expect((await drop(playerWs, sq(22, 4))).type).toBe('token.moved');
    expect(await stored()).toEqual(sq(22, 4));
    // With the door open, the far side of the room's wall is a walk out of
    // the door and round: allowed, however far.
    expect((await patch(`/api/tokens/${tokenId}`, player.token, sq(25, 4))).statusCode).toBe(200);
    expect((await drop(playerWs, sq(22, 4))).type).toBe('token.moved');

    // Shut behind them, the room's walls hold them in.
    await post(`/api/scenes/${sceneId}/doors`, boot.gmToken, { doorId: 'd.room', op: 'close' });
    expect((await drop(playerWs, sq(25, 4))).type).toBe('error');
    expect((await drop(playerWs, sq(22, 1))).type).toBe('error');
    expect(await stored()).toEqual(sq(22, 4));
  });
});

describe('a slanted painted wall', () => {
  it('cannot be slipped through between two squares that touch at a corner', async () => {
    // (26,22) and (27,23) are diagonal neighbours either side of the wall,
    // between its squares (27,22) and (26,23).
    await place(sq(26, 22));
    expect((await drop(playerWs, sq(27, 23))).type).toBe('error');
    expect(await stored()).toEqual(sq(26, 22));
    const res = await patch(`/api/tokens/${tokenId}`, player.token, sq(28, 28));
    expect(res.statusCode).toBe(403);
    expect(await stored()).toEqual(sq(26, 22));
    // Along its own side of the wall, a runner walks.
    expect((await drop(playerWs, sq(25, 22))).type).toBe('token.moved');
  });
});

describe('the map’s edge', () => {
  /*
   * The walls review (2026-09-27): a drop far off the map made the server
   * search every square between the map and it. A player's move now has to
   * end on the map (widened only to take in where the runner stands), and
   * that is asked before any search, so the answer is the edge's own.
   */
  const OFF_MAP = { code: 'blocked', message: "Your runner can't leave the map" };

  it('refuses a player’s move off the map, near or far, over the socket and by PATCH', async () => {
    await place(sq(5, 0));
    const step = await drop(playerWs, sq(5, -1));
    expect(step.type).toBe('error');
    expect(step.payload).toEqual(OFF_MAP);
    expect(await stored()).toEqual(sq(5, 0));
    // Along an open row, a hundred thousand squares out: a walk with no wall
    // in the way, which the search would have taken. Refused at the edge.
    const far = await drop(playerWs, { x: 100_000.5, y: 0.5 });
    expect(far.type).toBe('error');
    expect(far.payload).toEqual(OFF_MAP);
    // From inside the shut room, to a million squares out: refused at the
    // edge, not by the wall, so no search was ever made.
    await place(sq(5, 5));
    const patched = await patch(`/api/tokens/${tokenId}`, player.token, { x: 1_000_000.5, y: 5.5 });
    expect(patched.statusCode).toBe(403);
    expect(patched.json()).toMatchObject({ error: OFF_MAP });
    expect(await stored()).toEqual(sq(5, 5));
  });

  it('never relays a player’s drag frame off the map', async () => {
    await place(sq(12, 12));
    await settle(150);
    const mark = gmWs.frames.length;
    playerWs.send({ cmd: 'token.drag', tokenId, ...sq(12, -3) });
    await settle(150);
    playerWs.send({ cmd: 'token.drag', tokenId, ...sq(12, 0) });
    const frame = await nextAfter(gmWs, mark, (f) => f.type === 'token.dragging');
    expect(frame.payload).toMatchObject({ tokenId, ...sq(12, 0) });
    await settle();
    const frames = gmWs.frames.slice(mark).filter((f) => f.type === 'token.dragging');
    expect(frames.map((f) => f.payload)).toEqual([expect.objectContaining(sq(12, 0))]);
  });

  it('lets a runner the GM left off the map walk back onto it, and no further out', async () => {
    await place(sq(-3, 12));
    expect((await drop(playerWs, sq(1, 12))).type).toBe('token.moved');
    await place(sq(-3, 12));
    // Still on the ground it stands on: the map widened to take in its square.
    expect((await drop(playerWs, sq(-2, 12))).type).toBe('token.moved');
    // From there, further out is off it.
    const out = await drop(playerWs, sq(-4, 12));
    expect(out.type).toBe('error');
    expect(out.payload).toEqual(OFF_MAP);
    expect(await stored()).toEqual(sq(-2, 12));
  });

  it('never stops the GM', async () => {
    await place(sq(5, 0));
    expect((await drop(gmWs, sq(5, -4))).type).toBe('token.moved');
    expect((await patch(`/api/tokens/${tokenId}`, boot.gmToken, { x: 1_000_000.5, y: 0.5 })).statusCode).toBe(200);
  });
});

describe('the GM', () => {
  it('moves a token through walls and shut doors, over the socket and by PATCH', async () => {
    await place(sq(5, 0));
    expect((await drop(gmWs, sq(5, 5))).type).toBe('token.moved');
    expect(await stored()).toEqual(sq(5, 5));
    const res = await patch(`/api/tokens/${tokenId}`, boot.gmToken, sq(22, 4));
    expect(res.statusCode).toBe(200);
    expect(await stored()).toEqual(sq(22, 4));
    expect((await drop(gmWs, sq(28, 28))).type).toBe('token.moved');
    expect(await stored()).toEqual(sq(28, 28));
  });

  it('puts a runner inside a shut room, where the player walks about in it and not out of it', async () => {
    await place(sq(5, 5));
    expect((await drop(playerWs, sq(5, 0))).type).toBe('error');
    expect((await drop(playerWs, sq(6, 6))).type).toBe('token.moved');
  });
});

describe('drag frames', () => {
  it('relays a frame the runner could walk to, and never one through a wall', async () => {
    await place(sq(5, 0));
    const mark = gmWs.frames.length;
    playerWs.send({ cmd: 'token.drag', tokenId, ...sq(5, 5) });
    // Past the per-token throttle, so the next frame is not dropped for it.
    await settle(150);
    playerWs.send({ cmd: 'token.drag', tokenId, ...sq(9, 0) });
    const frame = await nextAfter(gmWs, mark, (f) => f.type === 'token.dragging');
    expect(frame.payload).toMatchObject({ tokenId, ...sq(9, 0) });
    await settle();
    const frames = gmWs.frames.slice(mark).filter((f) => f.type === 'token.dragging');
    expect(frames.map((f) => f.payload)).toEqual([expect.objectContaining(sq(9, 0))]);
  });

  it('relays the GM’s frames through walls', async () => {
    await settle(150);
    const mark = playerWs.frames.length;
    gmWs.send({ cmd: 'token.drag', tokenId, ...sq(5, 5) });
    const frame = await nextAfter(playerWs, mark, (f) => f.type === 'token.dragging');
    expect(frame.payload).toMatchObject({ tokenId, ...sq(5, 5) });
  });
});

describe('a GM’s move that lands while the player’s is in flight', () => {
  /*
   * The GM drops the runner into the shut painted room while the player is
   * still dragging it about outside. The player's request read the token
   * where it stood BEFORE the GM's move; the move has to be judged from where
   * it stands now, inside the room, or the player's drop walks the runner
   * back out through the room's wall. PGlite runs one transaction at a time,
   * so the GM's move is put in between the request's read and its
   * transaction by hand: the read is answered, and then the row is moved.
   */
  function gmMovesItMeanwhile(to: { x: number; y: number }) {
    const real = ScenesService.prototype.tokenWithScene;
    return vi.spyOn(ScenesService.prototype, 'tokenWithScene').mockImplementationOnce(async function (
      this: ScenesService,
      id: string,
    ) {
      const read = await real.call(this, id);
      await t.db.update(tokens).set(to).where(eq(tokens.id, id));
      return read;
    });
  }

  it('judges the player’s drop from the cell the GM put the runner in', async () => {
    await place(sq(5, 0));
    const spy = gmMovesItMeanwhile(sq(5, 5));
    try {
      const gmMark = gmWs.frames.length;
      // Outside, from where the request read it; through the wall, from the cell.
      const answer = await drop(playerWs, sq(12, 1));
      expect(spy).toHaveBeenCalled();
      expect(answer.type).toBe('error');
      expect(answer.payload).toMatchObject({ code: 'blocked' });
      expect(await stored()).toEqual(sq(5, 5));
      // The ghost goes home to the cell, where the runner is.
      const home = await nextAfter(gmWs, gmMark, (f) => f.type === 'token.dragging');
      expect(home.payload).toMatchObject({ tokenId, ...sq(5, 5) });
    } finally {
      spy.mockRestore();
    }
  });

  it('and a PATCH the same way', async () => {
    await place(sq(5, 0));
    const spy = gmMovesItMeanwhile(sq(5, 5));
    try {
      const res = await patch(`/api/tokens/${tokenId}`, player.token, sq(12, 1));
      expect(spy).toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(code(res)).toBe('blocked');
      expect(await stored()).toEqual(sq(5, 5));
      // Inside the cell the runner still walks about.
      expect((await patch(`/api/tokens/${tokenId}`, player.token, sq(6, 6))).statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });
});
