/**
 * The stored initiative order (SR5 p.159-161), over the real API.
 *
 * What the table relies on, and what these pin:
 *  - the GM moves a row by PLACE and no score changes (the GM's decision of
 *    2026-09-28), players draw the same order without learning a hidden id,
 *    and "Sort by score" goes back to the book;
 *  - a Delayed Action keeps its score, is stepped over, holds the pass open
 *    until the GM calls it, and its phase is marked for the −1 die (p.161);
 *  - a tie is broken by Edge off the rows' own sheets (ERIC, p.159);
 *  - "Next" carries who the GM saw acting, so a second press cannot skip the
 *    row after (409 `stale_actor`);
 *  - a new Combat Turn clears the manual order, seizes and delays, and a
 *    fight set to hand rolls opens it blank.
 *
 * All fiction here is original (G6/§14).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SheetV1Schema, type SheetV1 } from '@safehouse/contracts';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type JoinResult, type TestApp } from './core-helpers.js';

const MONITORS = {
  physical: { max: 10, filled: 0 },
  stun: { max: 10, filled: 0 },
  overflow: { max: 4, filled: 0 },
};

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;

type Row = {
  id: string;
  name: string;
  initScore: number;
  actedThisPass: boolean;
  delayed?: boolean;
  seized?: boolean;
  copilot?: Record<string, unknown>;
};
type View = {
  turnOrder: string[];
  activeCombatantId: string | null;
  combatants: Row[];
  encounter: { manualOrder?: string[] | null; turn: number; pass: number; handRolls?: boolean };
};

async function call(method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown) {
  return t.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function gm<T = Record<string, any>>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown): Promise<T> {
  const res = await call(method, url, boot.gmToken, payload);
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

const view = (id: string) => gm<View>('GET', `/api/encounters/${id}`);

/** An original sheet whose Edge is the only thing that differs. */
function sheet(alias: string, edge: number): SheetV1 {
  return SheetV1Schema.parse({
    v: 1,
    identity: { alias },
    attributes: { bod: 3, agi: 3, rea: 4, str: 3, wil: 3, log: 3, int: 4, cha: 3, edg: { max: edge, current: edge }, ess: 6 },
    skills: [],
  });
}

/** A fight of public rows with the given scores (a hidden one when asked). */
async function fight(
  name: string,
  rows: Array<{ name: string; score: number; hidden?: boolean; sheet?: SheetV1; edge?: number }>,
) {
  const enc = await gm('POST', `/api/campaigns/${boot.campaignId}/encounters`, { name });
  const id = enc['encounter'].id as string;
  const ids: Record<string, string> = {};
  for (const r of rows) {
    const out = await gm('POST', `/api/encounters/${id}/combatants`, {
      source: 'manual',
      name: r.name,
      initBase: 8,
      initDice: 1,
      initScore: r.score,
      visibility: r.hidden ? 'gm' : 'public',
      monitors: MONITORS,
      ...(r.sheet ? { sheet: r.sheet } : {}),
      ...(r.edge ? { edge: { max: r.edge, current: r.edge } } : {}),
    });
    ids[r.name] = out['combatant'].id as string;
  }
  return { id, ids };
}

beforeAll(async () => {
  t = await makeTestApp('encounter-order');
  boot = await bootstrapCampaign(t.app, 'Order of Battle');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Lark');
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

describe('the manual order: place only', () => {
  it('moves a row, leaves every score alone, and never shows a player a hidden row’s id', async () => {
    const { id, ids } = await fight('Loading dock', [
      { name: 'Hook', score: 20 },
      { name: 'Wren', score: 14 },
      { name: 'Ambusher', score: 17, hidden: true },
    ]);
    const moved = await gm<View>('POST', `/api/encounters/${id}/order`, { move: { combatantId: ids['Wren'], toIndex: 0 } });
    expect(moved.turnOrder).toEqual([ids['Wren'], ids['Hook'], ids['Ambusher']]);
    expect(moved.activeCombatantId).toBe(ids['Wren']);
    expect(moved.encounter.manualOrder).toEqual([ids['Wren'], ids['Hook'], ids['Ambusher']]);
    expect(moved.combatants.find((c) => c.id === ids['Wren'])?.initScore).toBe(14);

    // A player draws the same order, cut to what they may see: not even the
    // hidden row's id rides in the manual order (FR4.9). Only a live fight is theirs to read.
    await gm('PATCH', `/api/encounters/${id}`, { state: 'live' });
    const res = await call('GET', `/api/encounters/${id}`, player.token);
    const theirs = res.json() as View;
    expect(theirs.turnOrder).toEqual([ids['Wren'], ids['Hook']]);
    expect(theirs.encounter.manualOrder).toEqual([ids['Wren'], ids['Hook']]);
    expect(res.body).not.toContain(ids['Ambusher']!);

    const sorted = await gm<View>('POST', `/api/encounters/${id}/order`, { sort: 'score' });
    expect(sorted.encounter.manualOrder).toBeNull();
    expect(sorted.turnOrder).toEqual([ids['Hook'], ids['Ambusher'], ids['Wren']]);
  });

  it('breaks a tied score on Edge read off the rows’ own sheets (ERIC, p.159)', async () => {
    const { id, ids } = await fight('Stair landing', [
      { name: 'Dull', score: 12, sheet: sheet('Dull', 2) },
      { name: 'Lucky', score: 12, sheet: sheet('Lucky', 5) },
    ]);
    expect((await view(id)).turnOrder).toEqual([ids['Lucky'], ids['Dull']]);
  });
});

describe('a Delayed Action (p.161) and the double-press guard on Next', () => {
  it('steps over the delay, waits for it, calls it with −1 die marked, and refuses a stale press', async () => {
    const { id, ids } = await fight('Hellhound yard', [
      { name: 'Cutter', score: 13 },
      { name: 'Painkiller', score: 11 },
    ]);
    const cutter = ids['Cutter']!;
    const painkiller = ids['Painkiller']!;
    expect((await view(id)).activeCombatantId).toBe(cutter);

    const held = await gm('POST', `/api/combatants/${cutter}/delay`, {});
    expect(held['combatant']).toMatchObject({ delayed: true, initScore: 13 });
    let now = await view(id);
    expect(now.activeCombatantId).toBe(painkiller);
    expect(now.turnOrder).toEqual([cutter, painkiller]); // the delayed row keeps its place

    // Painkiller acts; nobody else is up, but the pass waits on Cutter.
    const step = await gm('POST', `/api/encounters/${id}/advance`, { expectedActorId: painkiller });
    expect(step['step']).toBe('waiting');
    expect(step['encounter'].pass).toBe(0);

    // A second press of the same Next — the GM saw Painkiller — does nothing.
    const stale = await call('POST', `/api/encounters/${id}/advance`, boot.gmToken, { expectedActorId: painkiller });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as { error: { code: string } }).error.code).toBe('stale_actor');
    now = await view(id);
    expect(now.combatants.find((c) => c.id === cutter)?.initScore).toBe(13);

    // Cutter intervenes: acting now, on his own 13, his phase a Delayed Action.
    const called = await gm<View>('POST', `/api/encounters/${id}/order`, { actNow: cutter });
    expect(called.activeCombatantId).toBe(cutter);
    const row = called.combatants.find((c) => c.id === cutter)!;
    expect(row.delayed).toBeUndefined();
    expect(row.initScore).toBe(13);
    expect(row.copilot?.['delayedAction']).toBe(true);

    // Next past him ends the pass: −10 each, and the −1 die is spent with it.
    const passed = await gm('POST', `/api/encounters/${id}/advance`, { expectedActorId: cutter });
    expect(passed['step']).toBe('pass');
    const after = (passed['combatants'] as Row[]).find((c) => c.id === cutter)!;
    expect(after.initScore).toBe(3);
    expect(after.copilot?.['delayedAction']).toBeUndefined();
  });
});

describe('a new Combat Turn', () => {
  it('clears the manual order, seizes and delays, and opens blank when the fight rolls by hand', async () => {
    const { id, ids } = await fight('Rooftop', [
      { name: 'Vane', score: 9, edge: 2 },
      { name: 'Grit', score: 16 },
      { name: 'Moss', score: 5 },
    ]);
    await gm('POST', `/api/encounters/${id}/order`, { move: { combatantId: ids['Moss'], toIndex: 0 } });
    await gm('POST', `/api/combatants/${ids['Grit']}/delay`, {});
    await gm('POST', `/api/edge/seize-initiative`, { combatantId: ids['Vane'] });
    await gm('PATCH', `/api/encounters/${id}`, { handRolls: true });
    const before = await view(id);
    expect(before.turnOrder[0]).toBe(ids['Vane']); // seized: on top, on her own 9
    expect(before.combatants.find((c) => c.id === ids['Vane'])).toMatchObject({ seized: true, initScore: 9 });
    expect(before.combatants.find((c) => c.id === ids['Grit'])?.delayed).toBe(true);
    expect(before.encounter.manualOrder).toEqual([ids['Moss'], ids['Grit']]);

    const out = await gm('POST', `/api/encounters/${id}/new-turn`, {});
    expect(out['encounter']).toMatchObject({ manualOrder: null, handRolls: true, pass: 1 });
    for (const c of out['combatants'] as Row[]) {
      expect(c.initScore).toBe(0); // hand rolls: the lines wait for the table's dice
      expect(c.delayed).toBeUndefined();
      expect(c.seized).toBeUndefined();
    }
  });
});
