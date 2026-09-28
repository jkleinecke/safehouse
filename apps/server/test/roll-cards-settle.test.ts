/**
 * Settling a roll card over the real API: table dice recorded without faces,
 * an Interrupt paid from the row in the roll's transaction unless its cost is
 * struck, NPC rolls kept behind the screen. Original fiction only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SheetV1Schema } from '@safehouse/contracts';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type JoinResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;

async function call(method: 'GET' | 'POST', url: string, token: string, payload?: unknown) {
  return t.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function gm<T = Record<string, any>>(method: 'GET' | 'POST', url: string, payload?: unknown): Promise<T> {
  const res = await call(method, url, boot.gmToken, payload);
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

const sheet = SheetV1Schema.parse({
  v: 1,
  identity: { alias: 'Door heavy' },
  attributes: { bod: 4, agi: 3, rea: 4, str: 3, wil: 3, log: 2, int: 4, cha: 2, edg: { max: 2, current: 2 }, ess: 6 },
  skills: [{ id: 'gymnastics', rating: 2, attr: 'agi' }],
});

let encounterId: string;
let rowId: string;

beforeAll(async () => {
  t = await makeTestApp('roll-cards-settle');
  boot = await bootstrapCampaign(t.app, 'Loading Bay');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Lark');
  const enc = await gm('POST', `/api/campaigns/${boot.campaignId}/encounters`, { name: 'Bay doors', state: 'live' });
  encounterId = enc['encounter'].id as string;
  const row = await gm('POST', `/api/encounters/${encounterId}/combatants`, {
    source: 'manual',
    name: 'Door heavy',
    initBase: 8,
    initScore: 14,
    visibility: 'public',
    monitors: { physical: { max: 10, filled: 0 }, stun: { max: 10, filled: 0 }, overflow: { max: 4, filled: 0 } },
    edge: { max: 2, current: 2 },
    sheet,
  });
  rowId = row['combatant'].id as string;
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

const copilotOf = async () => {
  const view = await gm('GET', `/api/encounters/${encounterId}`);
  return (view['combatants'] as Array<Record<string, any>>).find((c) => c['id'] === rowId)!;
};

describe('settling a card', () => {
  it('records table dice with no faces, applies the limit, and pays a Dodge from the row', async () => {
    const out = await gm('POST', '/api/cards/settle', {
      actor: { kind: 'combatant', id: rowId },
      actionId: 'dodge',
      settle: { hits: 9, glitch: 'none' },
    });
    const limit = out['card'].limit.value as number;
    expect(out['roll']).toMatchObject({ faces: [], hits: 9, limitedHits: limit, visibility: 'gm' });
    expect(out['roll'].request).toMatchObject({ tableResult: { hits: 9 }, meta: { tableDice: true, actorName: 'Door heavy' } });
    expect(out['initScore']).toEqual({ combatantId: rowId, from: 14, to: 9 });

    const row = await copilotOf();
    expect(row['initScore']).toBe(9);
    expect(row['copilot'].defendedSinceAction).toBe(1);

    const log = await gm('GET', `/api/campaigns/${boot.campaignId}/log?types=log.posted`);
    const line = (log['events'] as Array<Record<string, any>>).find((e) => e['payload'].kind === 'interrupt');
    expect(line).toMatchObject({ visibility: 'gm', payload: { text: 'Door heavy: Dodge costs 5 Initiative (14 → 9)' } });

    // Behind the screen: the player sees neither the roll nor the cost line.
    expect((await call('GET', `/api/rolls/${out['roll'].id}`, player.token)).statusCode).toBe(404);
    const theirs = (await call('GET', `/api/campaigns/${boot.campaignId}/log`, player.token)).json();
    expect(JSON.stringify(theirs)).not.toContain('Dodge');
  });

  it('Full Defense with pushed Edge: app dice, the row remembers the turn and the defenses', async () => {
    const out = await gm('POST', '/api/cards/settle', {
      actor: { kind: 'combatant', id: rowId },
      actionId: 'full_defense',
      settle: 'app',
      edge: 'push_pre',
    });
    expect(out['roll'].faces.length).toBe(out['card'].pool.total + 2);
    expect(out['initScore']).toMatchObject({ from: 9, to: -1 });
    const row = await copilotOf();
    expect(row['copilot']).toMatchObject({ fullDefenseTurn: 0, defendedSinceAction: 2, edge: { max: 2, current: 1 } });

    const next = await gm('POST', '/api/cards/preview', { actor: { kind: 'combatant', id: rowId }, actionId: 'defense' });
    const offers = next['card'].offers as Array<Record<string, any>>;
    expect(offers.find((o) => o['id'] === 'full_defense')).toMatchObject({ on: true, value: 3 });
    expect(offers.find((o) => o['id'] === 'previous_defenses')).toMatchObject({ on: true, value: -2 });
  });

  it("takes no Initiative when the Interrupt's cost is struck", async () => {
    const out = await gm('POST', '/api/cards/settle', {
      actor: { kind: 'combatant', id: rowId },
      actionId: 'dodge',
      offersOn: [],
      settle: { hits: 1, glitch: 'none' },
    });
    expect((out['card'].offers as Array<Record<string, any>>).find((o) => o['id'] === 'init_cost')).toMatchObject({ on: false });
    expect(out['initScore']).toBeUndefined();
    expect((await copilotOf())['initScore']).toBe(-1);
  });
});
