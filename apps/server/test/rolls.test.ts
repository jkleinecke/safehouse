/**
 * M2 dice path (DESIGN.md §10.1, FR2.1–2.9, §17.2).
 *
 * The load-bearing assertions: the server recomputes the pool with its own
 * engine and a lying client pool changes nothing; glitch flags land in the
 * immutable record; a GM-visibility roll never reaches a player socket
 * (Principle 4, asserted at the socket); opposed rolls link and net out.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { SheetV1Schema, type SheetV1 } from '@safehouse/contracts';
import { characters, scenes } from '@safehouse/db';
import { getRollService, type RollService } from '../src/services/rolls.js';
import {
  bootstrapCampaign,
  joinAs,
  makeTestApp,
  wsUrl,
  WsTestClient,
  type BootstrapResult,
  type JoinResult,
  type TestApp,
} from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let other: JoinResult;
let svc: RollService;
let characterId: string;
const open: WsTestClient[] = [];

/** INT 5 + Perception 3 = pool 8; mental limit ⌈(3×2+5+3)/3⌉ = 5. */
const SHEET: SheetV1 = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Static' },
  attributes: {
    bod: 4,
    agi: 4,
    rea: 4,
    str: 3,
    wil: 3,
    log: 3,
    int: 5,
    cha: 3,
    edg: { max: 3, current: 3 },
    ess: 6,
  },
  skills: [{ id: 'perception', rating: 3, attr: 'int' }],
});

/** Every die shows `face` — deterministic dice for exact assertions (§17). */
const fixedFace = (face: number) => () => (face - 1) / 6 + 1e-9;

async function post(url: string, token: string, payload: Record<string, unknown>) {
  return t.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });
}

async function get(url: string, token: string) {
  return t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

async function connect(token: string): Promise<WsTestClient> {
  const client = await WsTestClient.connect(wsUrl(t.app, boot.campaignId, token));
  open.push(client);
  await client.next((f) => f.type === 'hello');
  return client;
}

beforeAll(async () => {
  t = await makeTestApp('rolls');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  boot = await bootstrapCampaign(t.app, 'Dice Table');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  other = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Nyx');
  svc = getRollService(t.db, t.app.hub);
  const row = (
    await t.db
      .insert(characters)
      .values({
        campaignId: boot.campaignId,
        ownerUserId: player.user.id,
        name: 'Static',
        sheet: SHEET,
      })
      .returning()
  )[0]!;
  characterId = row.id;
}, 120_000);

afterAll(async () => {
  for (const c of open) c.close();
  await t.close();
});

beforeEach(() => {
  svc.setRng(fixedFace(4)); // no hits, no ones unless a test says otherwise
});

describe('authoritative recompute (§10.1)', () => {
  it('ignores a lying client pool for a sheet-backed roll', async () => {
    svc.setRng(fixedFace(6));
    const res = await post('/api/rolls', player.token, {
      kind: 'simple',
      pool: 99,
      breakdown: [{ label: 'trust me', value: 99 }],
      actor: { characterId },
      meta: { poolRef: 'skill.perception' },
    });
    expect(res.statusCode).toBe(201);
    const { roll } = res.json() as { roll: Record<string, unknown> };
    expect(roll['request']).toMatchObject({ pool: 8 });
    expect((roll['faces'] as number[]).length).toBe(8);
    expect(roll['hits']).toBe(8);
    // The limit clips the effective result and the claim is kept for the log.
    expect(roll['limitedHits']).toBe(5);
    expect(roll['limit']).toMatchObject({ kind: 'mental', value: 5 });
    const meta = (roll['request'] as { meta: Record<string, unknown> }).meta;
    expect(meta['claimedPool']).toBe(99);
    expect(meta['recomputed']).toBe(true);
    // Provenance survives (FR2.6): the receipt, not the client's label.
    const breakdown = (roll['request'] as { breakdown: { label: string }[] }).breakdown;
    expect(breakdown.map((b) => b.label)).toEqual(['INT', 'perception']);
  });

  it('takes a free-form pool as given (FR2.8)', async () => {
    svc.setRng(fixedFace(5));
    const res = await post('/api/rolls', player.token, { pool: 6, actor: {} });
    const { roll } = res.json() as { roll: { faces: number[]; hits: number } };
    expect(roll.faces.length).toBe(6);
    expect(roll.hits).toBe(6);
  });

  it('applies the ACTIVE scene itself, not the client\'s copy of it (FR9.7/2.6)', async () => {
    // Dim light on the active scene: one axis at level 1 → −1 to every pool.
    const scene = (
      await t.db
        .insert(scenes)
        .values({
          campaignId: boot.campaignId,
          name: 'Warehouse — dim light',
          state: 'active',
          environment: { light: 1, visibility: 0, glare: 0, wind: 0 },
        })
        .returning()
    )[0]!;
    try {
      svc.setRng(fixedFace(6));
      const res = await post('/api/rolls', player.token, {
        pool: 8,
        actor: { characterId },
        meta: {
          poolRef: 'skill.perception',
          mods: [
            // A client echo of the scene chip must NOT be counted twice, and a
            // situational chip the server cannot know about must be.
            {
              id: 'env.scene',
              source: { kind: 'scene' },
              target: 'pool.all',
              op: 'add',
              value: -1,
              active: true,
              note: 'dim light (client copy)',
            },
            {
              id: 'situational.smoke',
              source: { kind: 'situational' },
              target: 'pool.all',
              op: 'add',
              value: -2,
              active: true,
              note: 'thermal smoke',
            },
          ],
        },
      });
      const { roll } = res.json() as {
        roll: {
          faces: number[];
          request: { pool: number; breakdown: { label: string; value: number; source?: string }[] };
        };
      };
      expect(roll.request.pool).toBe(5); // 8 − 1 scene − 2 situational
      expect(roll.faces.length).toBe(5);
      const labels = roll.request.breakdown.map((b) => b.label);
      expect(labels.some((l) => l.startsWith('environment: light 1'))).toBe(true);
      expect(labels).toContain('thermal smoke');
      expect(labels).not.toContain('dim light (client copy)');
      // Principle 3: the receipt sums to the pool.
      expect(roll.request.breakdown.reduce((s, b) => s + b.value, 0)).toBe(5);
    } finally {
      await t.db.delete(scenes).where(eq(scenes.id, scene.id));
    }
  });

  /**
   * LIVE-2, found by driving the real app: the sheet's roll dialog builds its
   * receipt from `GET /api/characters/:id/derived` — which has ALREADY applied
   * the active scene — and then offers the same scene as a removable chip. Both
   * were counted: the sheet read Perception 7, the dialog offered 6d6, and the
   * persisted breakdown printed the environment line twice. The server is the
   * one authority: the echo is dropped and the die comes back.
   */
  it('counts the active scene ONCE when the client re-sends it as a chip (LIVE-2)', async () => {
    const scene = (
      await t.db
        .insert(scenes)
        .values({
          campaignId: boot.campaignId,
          name: 'Sub-level — dim light',
          state: 'active',
          environment: { light: 1, visibility: 0, glare: 0, wind: 0 },
        })
        .returning()
    )[0]!;
    try {
      // What the sheet shows: the derived pool, scene included, exactly once.
      const derivedRes = await get(`/api/characters/${characterId}/derived`, player.token);
      const view = derivedRes.json() as {
        derived: {
          pools: Record<
            string,
            { total: number; breakdown: { label: string; value: number; source?: string }[] }
          >;
        };
      };
      const shown = view.derived.pools['skill.perception']!;
      expect(shown.total).toBe(7); // INT 5 + Perception 3 − 1 scene
      expect(shown.breakdown.filter((b) => b.source === 'scene')).toHaveLength(1);

      // What the dialog sent: that receipt PLUS the scene chip again, no
      // poolRef (the live client does not send one).
      const echo = shown.breakdown.find((b) => b.source === 'scene')!;
      svc.setRng(fixedFace(4));
      const res = await post('/api/rolls', player.token, {
        pool: shown.total + echo.value,
        breakdown: [...shown.breakdown, echo],
        actor: { characterId },
        meta: { title: 'Perception' },
      });
      expect(res.statusCode).toBe(201);
      const { roll } = res.json() as {
        roll: {
          faces: number[];
          request: {
            pool: number;
            breakdown: { label: string; value: number; source?: string }[];
            meta: Record<string, unknown>;
          };
        };
      };
      const scenes_ = roll.request.breakdown.filter((b) => b.source === 'scene');
      expect(scenes_).toHaveLength(1);
      expect(roll.request.pool).toBe(shown.total);
      // Principle 3: the pool equals the sum of its own receipt.
      expect(roll.request.breakdown.reduce((s, b) => s + b.value, 0)).toBe(roll.request.pool);
      expect(roll.faces.length).toBe(roll.request.pool);
      // …and the refusal is on the record, not silent.
      expect(roll.request.meta['claimedPool']).toBe(shown.total - 1);
      expect(roll.request.meta['dedupedScene']).toEqual([
        { label: echo.label, value: echo.value },
      ]);
    } finally {
      await t.db.delete(scenes).where(eq(scenes.id, scene.id));
    }
  });

  it('leaves an honest receipt alone (no scene, nothing dropped)', async () => {
    svc.setRng(fixedFace(4));
    const res = await post('/api/rolls', player.token, {
      pool: 6,
      breakdown: [
        { label: 'AGI', value: 4, source: 'attribute' },
        { label: 'blades', value: 2, source: 'skill' },
      ],
      actor: { characterId },
    });
    const { roll } = res.json() as {
      roll: { request: { pool: number; breakdown: unknown[]; meta: Record<string, unknown> } };
    };
    expect(roll.request.pool).toBe(6);
    expect(roll.request.breakdown).toHaveLength(2);
    expect(roll.request.meta['dedupedScene']).toBeUndefined();
  });

  it('takes wounds from live play state, not from a player\'s claim (FR3.4)', async () => {
    const hurt = { ...SHEET, play: { monitors: { physical: 6, stun: 0, overflow: 0 } } };
    await t.db.update(characters).set({ sheet: hurt }).where(eq(characters.id, characterId));
    try {
      svc.setRng(fixedFace(6));
      const res = await post('/api/rolls', player.token, {
        pool: 8,
        actor: { characterId },
        meta: { poolRef: 'skill.perception', wounds: { physical: 0, stun: 0 } },
      });
      const { roll } = res.json() as { roll: { request: { pool: number } } };
      expect(roll.request.pool).toBe(6); // −2 for six filled physical boxes
    } finally {
      await t.db.update(characters).set({ sheet: SHEET }).where(eq(characters.id, characterId));
    }
  });

  it('rejects an unknown pool ref', async () => {
    const res = await post('/api/rolls', player.token, {
      pool: 3,
      actor: { characterId },
      meta: { poolRef: 'skill.nope' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('unknown_pool');
  });

  it("refuses a roll from another player's sheet", async () => {
    const res = await post('/api/rolls', other.token, {
      pool: 8,
      actor: { characterId },
      meta: { poolRef: 'skill.perception' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('glitches and limits (FR2.1/2.2)', () => {
  it('persists a critical glitch', async () => {
    svc.setRng(fixedFace(1));
    const res = await post('/api/rolls', player.token, {
      pool: 8,
      actor: { characterId },
      meta: { poolRef: 'skill.perception' },
    });
    const { roll } = res.json() as { roll: { id: string; ones: number; glitch: string } };
    expect(roll.ones).toBe(8);
    expect(roll.glitch).toBe('critical');
    const stored = await get(`/api/rolls/${roll.id}`, boot.gmToken);
    expect((stored.json() as { roll: { glitch: string } }).roll.glitch).toBe('critical');
  });

  it('buys hits without rolling (FR2.4)', async () => {
    const res = await post('/api/rolls/buy-hits', player.token, { pool: 12, actor: {} });
    const { roll } = res.json() as { roll: { faces: number[]; hits: number } };
    expect(roll.faces).toEqual([]);
    expect(roll.hits).toBe(3);
  });
});

describe('edge (FR2.3)', () => {
  it('spends a point of Edge and logs it', async () => {
    svc.setRng(fixedFace(5));
    const res = await post('/api/rolls', player.token, {
      pool: 8,
      edge: 'push_pre',
      actor: { characterId },
      meta: { poolRef: 'skill.perception' },
    });
    expect(res.statusCode).toBe(201);
    const { roll } = res.json() as { roll: { faces: number[]; limitedHits: number } };
    // +3 Edge dice, and Push the Limit ignores the limit entirely.
    expect(roll.faces.length).toBe(11);
    expect(roll.limitedHits).toBe(11);
    const row = (
      await t.db.select().from(characters).where(eq(characters.id, characterId)).limit(1)
    )[0]!;
    expect((row.sheet as SheetV1).attributes.edg.current).toBe(2);
    const log = await get(`/api/campaigns/${boot.campaignId}/log?types=log.posted`, boot.gmToken);
    const events = (log.json() as { events: { payload: { kind: string } }[] }).events;
    expect(events.some((e) => e.payload.kind === 'edge')).toBe(true);
  });

  it('does not debit Edge when the roll is rejected', async () => {
    const before = await currentEdge();
    const res = await post('/api/rolls', player.token, {
      pool: 8,
      edge: 'second_chance',
      actor: { characterId },
      meta: { poolRef: 'skill.perception', opposedRollId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(res.statusCode).toBe(404);
    expect(await currentEdge()).toBe(before);
  });

  it('refuses when the character has no Edge left', async () => {
    const drained = { ...SHEET, attributes: { ...SHEET.attributes, edg: { max: 3, current: 0 } } };
    await t.db.update(characters).set({ sheet: drained }).where(eq(characters.id, characterId));
    const res = await post('/api/rolls', player.token, {
      pool: 8,
      edge: 'push_pre',
      actor: { characterId },
      meta: { poolRef: 'skill.perception' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('no_edge');
    await t.db.update(characters).set({ sheet: SHEET }).where(eq(characters.id, characterId));
  });
});

async function currentEdge(): Promise<number> {
  const row = (
    await t.db.select().from(characters).where(eq(characters.id, characterId)).limit(1)
  )[0]!;
  return (row.sheet as SheetV1).attributes.edg.current;
}

describe('opposed, extended, teamwork (FR2.5)', () => {
  it('links an opposed roll and nets the hits', async () => {
    svc.setRng(fixedFace(4));
    const defense = await post('/api/rolls', boot.gmToken, { pool: 6, actor: { gm: true } });
    const defenseRoll = (defense.json() as { roll: { id: string; limitedHits: number } }).roll;
    expect(defenseRoll.limitedHits).toBe(0);

    svc.setRng(fixedFace(6));
    const attack = await post('/api/rolls', player.token, {
      kind: 'opposed',
      pool: 6,
      actor: {},
      meta: { opposedRollId: defenseRoll.id },
    });
    const roll = (attack.json() as { roll: { netHits: number; opposedLink: string } }).roll;
    expect(roll.opposedLink).toBe(defenseRoll.id);
    expect(roll.netHits).toBe(6);
  });

  it('runs an extended test with a shrinking pool', async () => {
    svc.setRng(fixedFace(5));
    const res = await post('/api/rolls', boot.gmToken, {
      kind: 'extended',
      pool: 4,
      actor: { gm: true },
      meta: { threshold: 6, interval: '1 hour' },
    });
    const { roll } = res.json() as {
      roll: { faces: number[]; detail: { intervalsUsed: number; success: boolean } };
    };
    // 4 then 3 dice: 4 + 3 = 7 hits ≥ threshold 6, so it stops after two.
    expect(roll.detail.intervalsUsed).toBe(2);
    expect(roll.detail.success).toBe(true);
    expect(roll.faces.length).toBe(7);
  });

  it('adds helper hits as dice in a teamwork test', async () => {
    svc.setRng(fixedFace(5));
    const res = await post('/api/rolls', boot.gmToken, {
      kind: 'teamwork',
      pool: 4,
      actor: { gm: true },
      meta: { helpers: [2, { pool: 3 }] },
    });
    const { roll } = res.json() as { roll: { faces: number[]; detail: { bonusDice: number } } };
    expect(roll.detail.bonusDice).toBe(5);
    expect(roll.faces.length).toBe(9);
  });
});

describe('visibility (FR2.7, Principle 4)', () => {
  it('never puts a gm-visibility roll on a player socket', async () => {
    const gmSock = await connect(boot.gmToken);
    const playerSock = await connect(player.token);

    svc.setRng(fixedFace(6));
    const hidden = await post('/api/rolls', boot.gmToken, {
      pool: 4,
      visibility: 'gm',
      actor: { gm: true },
      meta: { tag: 'behind-the-screen' },
    });
    const hiddenId = (hidden.json() as { roll: { id: string } }).roll.id;
    const shown = await post('/api/rolls', boot.gmToken, {
      pool: 4,
      visibility: 'public',
      actor: { gm: true },
      meta: { tag: 'open' },
    });
    const shownId = (shown.json() as { roll: { id: string } }).roll.id;

    await gmSock.next((f) => f.type === 'roll.created' && rollIdOf(f.payload) === hiddenId);
    await playerSock.next((f) => f.type === 'roll.created' && rollIdOf(f.payload) === shownId);
    expect(playerSock.has((f) => rollIdOf(f.payload) === hiddenId)).toBe(false);

    // …and it is absent from the player's log query too (filtered in SQL).
    const list = await get(`/api/campaigns/${boot.campaignId}/rolls?limit=200`, player.token);
    const ids = (list.json() as { rolls: { id: string }[] }).rolls.map((r) => r.id);
    expect(ids).toContain(shownId);
    expect(ids).not.toContain(hiddenId);
    const gmList = await get(`/api/campaigns/${boot.campaignId}/rolls?limit=200`, boot.gmToken);
    expect((gmList.json() as { rolls: { id: string }[] }).rolls.map((r) => r.id)).toContain(hiddenId);
    expect(await get(`/api/rolls/${hiddenId}`, player.token).then((r) => r.statusCode)).toBe(404);
  });

  it('keeps a gm_owner roll between the GM and its owner', async () => {
    svc.setRng(fixedFace(6));
    const res = await post('/api/rolls', player.token, {
      pool: 5,
      visibility: 'gm_owner',
      actor: { characterId },
      meta: { poolRef: 'skill.perception' },
    });
    const id = (res.json() as { roll: { id: string } }).roll.id;
    const mine = await get(`/api/campaigns/${boot.campaignId}/rolls?limit=200`, player.token);
    expect((mine.json() as { rolls: { id: string }[] }).rolls.map((r) => r.id)).toContain(id);
    const theirs = await get(`/api/campaigns/${boot.campaignId}/rolls?limit=200`, other.token);
    expect((theirs.json() as { rolls: { id: string }[] }).rolls.map((r) => r.id)).not.toContain(id);
  });

  it('refuses a player rolling behind the screen', async () => {
    const res = await post('/api/rolls', player.token, { pool: 4, visibility: 'gm', actor: {} });
    expect(res.statusCode).toBe(403);
  });
});

describe('WS roll.request (§10.1)', () => {
  it('recomputes and broadcasts from the live socket', async () => {
    const playerSock = await connect(player.token);
    svc.setRng(fixedFace(6));
    playerSock.send({
      cmd: 'roll.request',
      pool: 42,
      actor: { characterId },
      visibility: 'public',
      meta: { poolRef: 'skill.perception', tag: 'ws' },
    });
    const ack = await playerSock.next((f) => f.type === 'roll.ack');
    const rollId = (ack.payload as { rollId: string }).rollId;
    const created = await playerSock.next(
      (f) => f.type === 'roll.created' && rollIdOf(f.payload) === rollId,
    );
    const payload = created.payload as { request: { pool: number }; faces: number[] };
    expect(payload.request.pool).toBe(8);
    expect(payload.faces.length).toBe(8);
  });

  it('replies with an error frame instead of throwing', async () => {
    const playerSock = await connect(player.token);
    playerSock.send({ cmd: 'roll.request', pool: -3, actor: {} });
    const err = await playerSock.next((f) => f.type === 'error');
    expect((err.payload as { code: string }).code).toBe('bad_request');
  });
});

describe('log + pagination (FR2.9, §12)', () => {
  it('posts table talk and scene markers', async () => {
    const res = await post(`/api/campaigns/${boot.campaignId}/log`, player.token, {
      kind: 'talk',
      text: 'I check the loading dock for cameras.',
    });
    expect(res.statusCode).toBe(201);
    const marker = await post(`/api/campaigns/${boot.campaignId}/log`, boot.gmToken, {
      kind: 'marker',
      text: 'Scene: the dock, 03:14',
    });
    expect(marker.statusCode).toBe(201);
    const log = await get(`/api/campaigns/${boot.campaignId}/log?types=log.posted`, player.token);
    const texts = (log.json() as { events: { payload: { text: string } }[] }).events.map(
      (e) => e.payload.text,
    );
    expect(texts).toContain('Scene: the dock, 03:14');
  });

  /**
   * `?session=` has to tell "quiet session" apart from "wrong id" (FR6.1/#4):
   * a malformed value used to reach Postgres as a uuid comparison (a 500) and a
   * foreign id returned an empty page that looked like a real answer.
   */
  describe('?session= (FR6.1)', () => {
    it('404s on a malformed or foreign session id instead of guessing', async () => {
      const bad = await get(`/api/campaigns/${boot.campaignId}/rolls?session=not-a-uuid`, boot.gmToken);
      expect(bad.statusCode).toBe(404);
      expect((bad.json() as { error: { code: string } }).error.code).toBe('unknown_session');
      const foreign = await get(
        `/api/campaigns/${boot.campaignId}/rolls?session=00000000-0000-4000-8000-000000000000`,
        boot.gmToken,
      );
      expect(foreign.statusCode).toBe(404);
    });

    it('404s on session=current when no session is running', async () => {
      const res = await get(`/api/campaigns/${boot.campaignId}/rolls?session=current`, boot.gmToken);
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe('no_active_session');
    });

    it('returns the live session\'s rolls for session=current, and stamps new ones', async () => {
      const started = await post(`/api/campaigns/${boot.campaignId}/sessions/start`, boot.gmToken, {});
      expect(started.statusCode).toBe(201);
      const sessionId = (started.json() as { session: { id: string } }).session.id;
      try {
        svc.setRng(fixedFace(5));
        const rolled = await post('/api/rolls', player.token, {
          pool: 4,
          actor: { characterId },
          meta: { poolRef: 'skill.perception' },
        });
        const id = (rolled.json() as { roll: { id: string; sessionId: string } }).roll.id;

        const byAlias = await get(
          `/api/campaigns/${boot.campaignId}/rolls?session=current&limit=200`,
          boot.gmToken,
        );
        const page = byAlias.json() as { rolls: { id: string }[]; sessionId: string };
        expect(page.sessionId).toBe(sessionId);
        expect(page.rolls.map((r) => r.id)).toContain(id);

        // The explicit id answers identically…
        const byId = await get(
          `/api/campaigns/${boot.campaignId}/rolls?session=${sessionId}&limit=200`,
          boot.gmToken,
        );
        expect((byId.json() as { rolls: { id: string }[] }).rolls.map((r) => r.id)).toContain(id);
        // …and rolls made before the session started are NOT in it.
        const all = await get(`/api/campaigns/${boot.campaignId}/rolls?limit=200`, boot.gmToken);
        const total = (all.json() as { rolls: unknown[] }).rolls.length;
        expect(total).toBeGreaterThan(page.rolls.length);
      } finally {
        await post(`/api/sessions/${sessionId}/end`, boot.gmToken, {});
      }
    });
  });

  it('pages the roll log with a cursor', async () => {
    const first = await get(`/api/campaigns/${boot.campaignId}/rolls?limit=2`, boot.gmToken);
    const page1 = first.json() as { rolls: { id: string }[]; nextCursor: string | null };
    expect(page1.rolls.length).toBe(2);
    expect(page1.nextCursor).toBeTruthy();
    const second = await get(
      `/api/campaigns/${boot.campaignId}/rolls?limit=2&before=${encodeURIComponent(page1.nextCursor!)}`,
      boot.gmToken,
    );
    const page2 = second.json() as { rolls: { id: string }[] };
    const overlap = page2.rolls.filter((r) => page1.rolls.some((p) => p.id === r.id));
    expect(overlap).toEqual([]);
  });
});

function rollIdOf(payload: unknown): string | null {
  return typeof payload === 'object' && payload !== null && 'id' in payload
    ? String((payload as { id: unknown }).id)
    : null;
}
