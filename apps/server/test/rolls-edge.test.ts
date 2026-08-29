/**
 * Edge actions beyond the dice (FR2.3, FR4.4): Seize the Initiative, Blitz,
 * Close Call — over the real API, against the real tracker.
 *
 * The load-bearing assertions: each action costs exactly one point of Edge and
 * says so out loud in the session log (FR2.3); Seize and Blitz move the
 * combatant in the tracker's ORDER, not just its row; Close Call negates the
 * critical glitch without editing the stored roll (G5, append-only); an NPC
 * pays from its own Edge pool; and a player can only ever spend their own.
 *
 * All fiction here is original (G6/§14).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { SheetV1Schema, type SheetV1 } from '@safehouse/contracts';
import { characters } from '@safehouse/db';
import { getRollService, type RollService } from '../src/services/rolls.js';
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
let svc: RollService;
let characterId: string;

const MONITORS = {
  physical: { max: 10, filled: 0 },
  stun: { max: 10, filled: 0 },
  overflow: { max: 4, filled: 0 },
};

/** REA 5 + INT 4 → initiative base 9, 1d6. Edge 3. Original character. */
const SHEET: SheetV1 = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Vault' },
  attributes: {
    bod: 4,
    agi: 4,
    rea: 5,
    str: 3,
    wil: 4,
    log: 3,
    int: 4,
    cha: 3,
    edg: { max: 3, current: 3 },
    ess: 6,
  },
  skills: [{ id: 'perception', rating: 3, attr: 'int' }],
});

const fixedFace = (face: number) => () => (face - 1) / 6 + 1e-9;

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  payload?: unknown,
) {
  return t.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function json<T = Record<string, any>>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  payload?: unknown,
): Promise<T> {
  const res = await call(method, url, token, payload);
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

/** Current Edge on the PC's sheet. */
async function edgeLeft(): Promise<number> {
  const row = (
    await t.db.select().from(characters).where(eq(characters.id, characterId)).limit(1)
  )[0]!;
  return (row.sheet as SheetV1).attributes.edg.current;
}

async function resetEdge(current = 3): Promise<void> {
  const row = (
    await t.db.select().from(characters).where(eq(characters.id, characterId)).limit(1)
  )[0]!;
  const sheet = row.sheet as SheetV1;
  await t.db
    .update(characters)
    .set({ sheet: { ...sheet, attributes: { ...sheet.attributes, edg: { max: 3, current } } } })
    .where(eq(characters.id, characterId));
}

/** Edge log lines posted to the session feed, NEWEST FIRST (the log's order). */
async function edgeLog(token: string): Promise<{ text: string; extra: Record<string, unknown> }[]> {
  const body = await json<{ events: { payload: Record<string, unknown> }[] }>(
    'GET',
    `/api/campaigns/${boot.campaignId}/log?types=log.posted&limit=200`,
    token,
  );
  return body.events
    .filter((e) => e.payload['kind'] === 'edge')
    .map((e) => ({ text: String(e.payload['text']), extra: e.payload as Record<string, unknown> }));
}

/** An encounter with the PC and a faster NPC that has its own Edge. */
async function stagedFight(name: string): Promise<{ id: string; pc: any; npc: any }> {
  const enc = await json('POST', `/api/campaigns/${boot.campaignId}/encounters`, boot.gmToken, {
    name,
  });
  const id = enc['encounter'].id as string;
  const pc = (
    await json('POST', `/api/encounters/${id}/combatants`, boot.gmToken, {
      source: 'character',
      sourceId: characterId,
      initScore: 11,
    })
  )['combatant'];
  const npc = (
    await json('POST', `/api/encounters/${id}/combatants`, boot.gmToken, {
      source: 'manual',
      name: 'Dock enforcer',
      initBase: 8,
      initDice: 2,
      initScore: 24,
      visibility: 'public',
      monitors: MONITORS,
      edge: { max: 2, current: 2 },
    })
  )['combatant'];
  return { id, pc, npc };
}

beforeAll(async () => {
  t = await makeTestApp('rolls-edge');
  boot = await bootstrapCampaign(t.app, 'Edge Table');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Vault');
  other = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Ash');
  svc = getRollService(t.db, t.app.hub);
  const row = (
    await t.db
      .insert(characters)
      .values({
        campaignId: boot.campaignId,
        ownerUserId: player.user.id,
        name: 'Vault',
        sheet: SHEET,
      })
      .returning()
  )[0]!;
  characterId = row.id;
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

describe('Seize the Initiative (FR2.3/FR4.4)', () => {
  it('puts the actor at the head of the pass and bills one point of Edge', async () => {
    await resetEdge(3);
    const fight = await stagedFight('Cargo lift');
    const before = await edgeLeft();

    const out = await json('POST', '/api/edge/seize-initiative', player.token, {
      combatantId: fight.pc.id,
    });
    expect(out['action']).toBe('seize_initiative');
    expect(out['outcome'].from).toBe(11);
    expect(out['outcome'].to).toBe(25); // ahead of the enforcer's 24
    expect(out['edge'].current).toBe(before - 1);
    expect(await edgeLeft()).toBe(before - 1);

    // The TRACKER agrees: the seizer is the next to act (FR4.4).
    const view = await json('GET', `/api/encounters/${fight.id}`, boot.gmToken);
    expect(view['activeCombatantId']).toBe(fight.pc.id);
    expect((view['turnOrder'] as string[])[0]).toBe(fight.pc.id);
    const rows = view['combatants'] as { id: string; initScore: number }[];
    expect(rows.find((c) => c.id === fight.pc.id)?.initScore).toBe(25);

    const log = await edgeLog(boot.gmToken);
    const line = log[0]!;
    expect(line.text).toContain('Seize the Initiative');
    expect(line.text).toContain('Vault spends 1 Edge');
    expect(line.text).toContain(`(${before - 1}/3 left)`);
    expect(line.extra['edgeAction']).toBe('seize_initiative');
  });

  it('un-marks an actor who already acted this pass', async () => {
    await resetEdge(3);
    const fight = await stagedFight('Stairwell');
    await json('PATCH', `/api/combatants/${fight.pc.id}`, boot.gmToken, { actedThisPass: true });
    const out = await json('POST', '/api/edge/seize-initiative', boot.gmToken, {
      combatantId: fight.pc.id,
    });
    expect(out['combatant'].actedThisPass).toBe(false);
  });

  it('refuses when the character is out of Edge', async () => {
    await resetEdge(0);
    const fight = await stagedFight('Dry well');
    const res = await call('POST', '/api/edge/seize-initiative', player.token, {
      combatantId: fight.pc.id,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('no_edge');
    await resetEdge(3);
  });

  it("refuses a player spending someone else's Edge (§13)", async () => {
    await resetEdge(3);
    const fight = await stagedFight('Catwalk');
    const res = await call('POST', '/api/edge/seize-initiative', other.token, {
      combatantId: fight.pc.id,
    });
    expect(res.statusCode).toBe(403);
    expect(await edgeLeft()).toBe(3);
  });

  it('spends an NPC\'s own Edge, never a character sheet', async () => {
    await resetEdge(3);
    const fight = await stagedFight('Freight yard');
    await json('PATCH', `/api/combatants/${fight.pc.id}`, boot.gmToken, { initScore: 30 });
    const out = await json('POST', '/api/edge/seize-initiative', boot.gmToken, {
      combatantId: fight.npc.id,
    });
    expect(out['outcome'].to).toBe(31);
    expect(out['edge']).toEqual({ max: 2, current: 1 });
    // The returned row is the one that paid — score moved AND Edge debited.
    expect(out['combatant'].edge).toEqual({ max: 2, current: 1 });
    expect(out['combatant'].initScore).toBe(31);
    expect(await edgeLeft()).toBe(3); // the PC's sheet is untouched
  });
});

describe('Blitz (FR2.3/FR4.4)', () => {
  it('re-rolls initiative with five dice and bills one point of Edge', async () => {
    await resetEdge(3);
    const fight = await stagedFight('Rooftop');
    svc.setRng(fixedFace(6)); // every initiative die shows 6
    const out = await json('POST', '/api/edge/blitz', player.token, {
      combatantId: fight.pc.id,
    });
    expect(out['action']).toBe('blitz');
    expect(out['outcome'].dice).toBe(5);
    expect(out['outcome'].rolls).toEqual([6, 6, 6, 6, 6]);
    expect(out['outcome'].addedDice).toBe(4); // a PC normally throws 1d6
    expect(out['outcome'].score).toBe(39); // base 9 + 30
    expect(out['combatant'].initScore).toBe(39);
    expect(out['edge'].current).toBe(2);

    const view = await json('GET', `/api/encounters/${fight.id}`, boot.gmToken);
    const rows = view['combatants'] as { id: string; initScore: number }[];
    expect(rows.find((c) => c.id === fight.pc.id)?.initScore).toBe(39);

    const log = await edgeLog(boot.gmToken);
    expect(log[0]!.text).toContain('Blitz');
    expect(log[0]!.text).toContain('5d6');
  });

  it('pays the wound modifier like any other initiative roll', async () => {
    await resetEdge(3);
    const fight = await stagedFight('Sub-basement');
    await json('PATCH', `/api/combatants/${fight.pc.id}`, boot.gmToken, {
      monitors: { ...MONITORS, physical: { max: 10, filled: 6 } },
    });
    svc.setRng(fixedFace(1));
    const out = await json('POST', '/api/edge/blitz', boot.gmToken, {
      combatantId: fight.pc.id,
    });
    expect(out['outcome'].woundModifier).toBe(-2);
    expect(out['outcome'].score).toBe(12); // 9 + 5 − 2
  });
});

describe('Close Call (FR2.3)', () => {
  /** A roll where every die shows 1: eight ones, no hits → critical glitch. */
  async function criticalGlitch(): Promise<{ id: string; glitch: string }> {
    svc.setRng(fixedFace(1));
    const res = await json('POST', '/api/rolls', player.token, {
      pool: 8,
      actor: { characterId },
      meta: { poolRef: 'skill.perception', title: 'Perception' },
    });
    return res['roll'] as { id: string; glitch: string };
  }

  it('negates the critical glitch, bills Edge, and leaves the roll on record (G5)', async () => {
    await resetEdge(3);
    const roll = await criticalGlitch();
    expect(roll.glitch).toBe('critical');

    const out = await json('POST', '/api/edge/close-call', player.token, { rollId: roll.id });
    expect(out['action']).toBe('close_call');
    expect(out['negated']).toBe('critical');
    expect(out['result'].glitch).toBe('none');
    expect(out['edge'].current).toBe(2);
    expect(await edgeLeft()).toBe(2);

    // The immutable record still says what the dice said.
    const stored = await json('GET', `/api/rolls/${roll.id}`, boot.gmToken);
    expect(stored['roll'].glitch).toBe('critical');

    // …and the negation is its own log line, pointing back at the roll.
    const log = await edgeLog(player.token);
    const line = log[0]!;
    expect(line.text).toContain('Close Call');
    expect(line.text).toContain('critical glitch negated');
    expect(line.extra['rollId']).toBe(roll.id);
    expect(line.extra['negated']).toBe('critical');
  });

  it('refuses a roll that did not glitch, and costs nothing', async () => {
    await resetEdge(3);
    svc.setRng(fixedFace(5));
    const clean = await json('POST', '/api/rolls', player.token, {
      pool: 4,
      actor: { characterId },
      meta: { poolRef: 'skill.perception' },
    });
    const res = await call('POST', '/api/edge/close-call', player.token, {
      rollId: clean['roll'].id,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('no_glitch');
    expect(await edgeLeft()).toBe(3);
  });

  it('404s a roll the caller may not see (Principle 4)', async () => {
    await resetEdge(3);
    svc.setRng(fixedFace(1));
    const hidden = await json('POST', '/api/rolls', boot.gmToken, {
      pool: 6,
      visibility: 'gm',
      actor: { gm: true },
    });
    const res = await call('POST', '/api/edge/close-call', player.token, {
      rollId: hidden['roll'].id,
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses another player's Close Call (§13)", async () => {
    await resetEdge(3);
    const roll = await criticalGlitch();
    const res = await call('POST', '/api/edge/close-call', other.token, { rollId: roll.id });
    expect(res.statusCode).toBe(403);
    expect(await edgeLeft()).toBe(3);
  });
});

describe('§13 capability gate', () => {
  it('never lets an observer spend Edge', async () => {
    await resetEdge(3);
    const watcher = await joinAs(t.app, boot.campaignId, boot.gmToken, 'observer', 'Ghost');
    const fight = await stagedFight('Observer deck');
    const res = await call('POST', '/api/edge/seize-initiative', watcher.token, {
      combatantId: fight.pc.id,
    });
    expect(res.statusCode).toBe(403);
    expect(await edgeLeft()).toBe(3);
  });
});
