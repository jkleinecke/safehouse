/**
 * Initiative the way a table actually does it (FR4.2, FR4.3, FR4.8).
 *
 * Three things a GM sitting down with real dice needs and did not have:
 * a way to type the DICE rather than the sum (the server adds base and
 * wounds), a runner rolling their own row from their own phone, and a turn
 * that opens with blank scores so the dice can come in from the table. And
 * one thing the whole room relies on: there is one live fight at a time.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { characters } from '@safehouse/db';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type JoinResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let sceneId: string;
let encounterId: string;
let ownRow: string;
let otherRow: string;
/** A second fight from the same scene, opened for hand rolls. */
let handId: string;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}
async function call(method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown) {
  return t.app.inject({ method, url, headers: auth(token), ...(payload !== undefined ? { payload: payload as object } : {}) });
}
async function gm<T = Record<string, any>>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown): Promise<T> {
  const res = await call(method, url, boot.gmToken, payload);
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}
async function score(id: string): Promise<number> {
  const view = await gm('GET', `/api/encounters/${encounterId}`);
  return (view['combatants'] as Array<{ id: string; initScore: number }>).find((c) => c.id === id)!.initScore;
}

const sheet = (alias: string) => ({
  v: 1,
  identity: { alias },
  attributes: { bod: 4, agi: 4, rea: 5, str: 3, wil: 4, log: 3, int: 4, cha: 3, edg: { max: 3, current: 3 }, ess: 6 },
  skills: [{ id: 'pistols', rating: 4, attr: 'agi' }],
});

beforeAll(async () => {
  t = await makeTestApp('initiative-hand');
  boot = await bootstrapCampaign(t.app, 'Hand Rolls');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  const [mine] = await t.db
    .insert(characters)
    .values({ campaignId: boot.campaignId, ownerUserId: player.user.id, name: 'Static', sheet: sheet('Static') })
    .returning();
  const [theirs] = await t.db
    .insert(characters)
    .values({ campaignId: boot.campaignId, name: 'Wraith', sheet: sheet('Wraith') })
    .returning();
  const scene = await gm('POST', `/api/campaigns/${boot.campaignId}/scenes`, { name: 'Back alley' });
  sceneId = scene['scene'].id;
  await gm('POST', `/api/scenes/${sceneId}/activate`, {});
  for (const c of [mine!, theirs!]) {
    await gm('POST', `/api/scenes/${sceneId}/tokens`, { source: 'character', sourceId: c.id, name: c.name, x: 1, y: 1 });
  }
  const staged = await gm('POST', `/api/scenes/${sceneId}/stage-encounter`, { name: 'Alley fight' });
  encounterId = staged['encounterId'];
  const view = await gm('GET', `/api/encounters/${encounterId}`);
  const rows = view['combatants'] as Array<{ id: string; name: string }>;
  ownRow = rows.find((r) => r.name === 'Static')!.id;
  otherRow = rows.find((r) => r.name === 'Wraith')!.id;
}, 180_000);

afterAll(async () => {
  await t.close();
});

describe('typing the dice, not the sum', () => {
  it('adds the base to what was rolled — and the wound modifier, which the table forgets', async () => {
    const set = await gm('POST', `/api/combatants/${ownRow}/initiative`, { rolled: 4 });
    expect(set['combatant'].initScore).toBe(13); // REA 5 + INT 4 + 4
    expect(set['combatant'].actedThisPass).toBe(false);

    // Three boxes of physical damage is −1 (FR4.5); rolling 4 again is now 12.
    await gm('POST', `/api/encounters/${encounterId}/damage`, { targetId: ownRow, boxes: 3, track: 'physical' });
    const again = await gm('POST', `/api/combatants/${ownRow}/initiative`, { rolled: 4 });
    expect(again['combatant'].initScore).toBe(12);
    // A typed SCORE is still the blunt override, wounds or not.
    const typed = await gm('POST', `/api/combatants/${ownRow}/initiative`, { score: 20 });
    expect(typed['combatant'].initScore).toBe(20);
    expect((await call('POST', `/api/combatants/${ownRow}/initiative`, boot.gmToken, { rolled: 31 })).statusCode).toBe(400);
  });
});

describe('a runner rolls their own row from their phone (FR4.2)', () => {
  it('may enter or roll their own initiative, and nobody else’s', async () => {
    const mine = await call('POST', `/api/combatants/${ownRow}/initiative`, player.token, { rolled: 6 });
    expect(mine.statusCode).toBe(200);
    expect(await score(ownRow)).toBe(14); // 9 + 6 − 1 (still wounded)

    expect((await call('POST', `/api/combatants/${otherRow}/initiative`, player.token, { rolled: 6 })).statusCode).toBe(403);
    // The line is the GM's: a player cannot give themself a second die.
    expect((await call('POST', `/api/combatants/${ownRow}/initiative`, player.token, { dice: 5 })).statusCode).toBe(403);

    const rolled = await call('POST', `/api/encounters/${encounterId}/roll-initiative`, player.token, { combatantIds: [ownRow] });
    expect(rolled.statusCode).toBe(200);
    expect((rolled.json() as { details: unknown[] }).details).toHaveLength(1);
    expect((await call('POST', `/api/encounters/${encounterId}/roll-initiative`, player.token, {})).statusCode).toBe(403);
    expect(
      (await call('POST', `/api/encounters/${encounterId}/roll-initiative`, player.token, { combatantIds: [ownRow, otherRow] }))
        .statusCode,
    ).toBe(403);
  });
});

describe('a turn that waits for the table’s dice', () => {
  it('opens live, at turn 1 pass 1, with every score blank', async () => {
    // A fresh fight: the one above has had its clock started by the player's roll.
    const staged = await gm('POST', `/api/scenes/${sceneId}/stage-encounter`, { name: 'Alley fight, take two' });
    handId = staged['encounterId'];
    const out = await gm('POST', `/api/encounters/${handId}/new-turn`, { roll: false });
    expect(out['encounter']).toMatchObject({ state: 'live', turn: 1, pass: 1 });
    for (const c of out['combatants'] as Array<{ initScore: number; actedThisPass: boolean }>) {
      expect(c.initScore).toBe(0);
      expect(c.actedThisPass).toBe(false);
    }
    // …and the next turn, rolled by the server, is turn 2 with real scores.
    const next = await gm('POST', `/api/encounters/${handId}/new-turn`, {});
    expect(next['encounter']).toMatchObject({ state: 'live', turn: 2, pass: 1 });
    expect((next['combatants'] as Array<{ initScore: number }>).every((c) => c.initScore > 0)).toBe(true);
  });
});

describe('one live fight at a time', () => {
  it('starting another retires the first, and so does flipping one live by hand', async () => {
    const second = await gm('POST', `/api/campaigns/${boot.campaignId}/encounters`, { name: 'Rooftop' });
    const secondId = second['encounter'].id as string;
    await gm('POST', `/api/encounters/${secondId}/new-turn`, {});
    let list = (await gm('GET', `/api/campaigns/${boot.campaignId}/encounters`))['encounters'] as Array<{ id: string; state: string }>;
    expect(list.find((e) => e.id === handId)?.state).toBe('done');
    expect(list.find((e) => e.id === secondId)?.state).toBe('live');

    await gm('PATCH', `/api/encounters/${encounterId}`, { state: 'live' });
    list = (await gm('GET', `/api/campaigns/${boot.campaignId}/encounters`))['encounters'] as Array<{ id: string; state: string }>;
    expect(list.find((e) => e.id === encounterId)?.state).toBe('live');
    expect(list.find((e) => e.id === secondId)?.state).toBe('done');
    expect(list.filter((e) => e.state === 'live')).toHaveLength(1);
  });
});

describe('what a phone can read of the line (FR4.2 / FR4.9)', () => {
  it('shows a runner their own dice and a teammate’s, and never an NPC’s', async () => {
    await gm('POST', `/api/encounters/${encounterId}/combatants`, {
      source: 'manual',
      name: 'Drone',
      visibility: 'public',
      initBase: 7,
      initDice: 3,
    });
    const view = await call('GET', `/api/encounters/${encounterId}`, player.token);
    expect(view.statusCode).toBe(200);
    const rows = (view.json() as { combatants: Array<{ name: string; own: boolean; initBase?: number; initDice?: number }> }).combatants;
    const mine = rows.find((r) => r.name === 'Static')!;
    const mate = rows.find((r) => r.name === 'Wraith')!;
    const drone = rows.find((r) => r.name === 'Drone')!;
    expect(mine).toMatchObject({ own: true, initBase: 9, initDice: 1 });
    expect(mate).toMatchObject({ own: false, initBase: 9, initDice: 1 });
    expect('initBase' in drone).toBe(false);
    expect('initDice' in drone).toBe(false);
  });
});
