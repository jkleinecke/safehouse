/**
 * Attack exchanges: the pure steps, then over the API from a tabletop attack
 * to boxes on the monitor. Original fiction only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SheetV1Schema, type Exchange } from '@safehouse/contracts';
import { characters } from '@safehouse/db';
import { afterDefense, afterSoak } from '../src/services/exchanges-model.js';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type JoinResult, type TestApp } from './core-helpers.js';

const base: Exchange = {
  id: 'x-1',
  encounterId: 'e-1',
  turn: 1,
  attack: 'ranged',
  target: { combatantId: 'c-1', name: 'Bouncer' },
  declared: { dv: { value: 5, type: 'P' }, ap: -1, defenseModifier: 0, extras: [], by: { role: 'gm', name: 'GM' } },
  attackRollId: null,
  attackHits: 3,
  state: 'awaiting_defense',
  createdAt: '2026-09-28T00:00:00.000Z',
};

describe('exchange steps', () => {
  it('turns Physical to Stun when the modified DV falls short of the AP-modified armor', () => {
    const hit = afterDefense(base, { actionId: 'defense', rollId: null, hits: 2, offersOn: [] }, 12);
    expect(hit).toMatchObject({ outcome: 'hit', netHits: 1, state: 'awaiting_soak' });
    const soaked = afterSoak(hit, { rollId: 'r-2', hits: 2 }, 12);
    expect(soaked.damage).toMatchObject({ modifiedDv: 6, modifiedArmor: 11, type: 'S', convertedToStun: true });
    expect(soaked).toMatchObject({ boxes: 4, track: 'stun', state: 'awaiting_apply' });
  });

  it('a direct spell skips the soak: its boxes are the net hits', () => {
    const spell: Exchange = { ...base, attack: 'direct-spell', declared: { ...base.declared, dv: { value: 0, type: 'S' } } };
    const out = afterDefense(spell, { actionId: 'resist_direct_mana', rollId: null, hits: 1, offersOn: [] }, 12);
    expect(out).toMatchObject({ boxes: 2, track: 'stun', state: 'awaiting_apply' });
  });

  it('keeps a 0-0 tie a miss, a tie with hits a graze', () => {
    const none = { ...base, attackHits: 0 };
    expect(afterDefense(none, { actionId: 'defense', rollId: null, hits: 0, offersOn: [] }, 0).outcome).toBe('miss');
    expect(afterDefense(base, { actionId: 'defense', rollId: null, hits: 3, offersOn: [] }, 0)).toMatchObject({
      outcome: 'graze',
      state: 'done',
    });
  });
});

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let encounterId: string;
let bouncer: string;
let lark: string;

async function call(method: 'GET' | 'POST', url: string, token: string, payload?: unknown) {
  return t.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function as<T = Record<string, any>>(token: string, method: 'GET' | 'POST', url: string, payload?: unknown): Promise<T> {
  const res = await call(method, url, token, payload);
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}
const gm = <T = Record<string, any>>(method: 'GET' | 'POST', url: string, payload?: unknown) =>
  as<T>(boot.gmToken, method, url, payload);

const monitors = { physical: { max: 10, filled: 0 }, stun: { max: 10, filled: 0 }, overflow: { max: 4, filled: 0 } };
const physical = async () => {
  const view = await gm('GET', `/api/encounters/${encounterId}`);
  return (view['combatants'] as Array<Record<string, any>>).find((c) => c['id'] === bouncer)!['monitors'].physical.filled;
};

beforeAll(async () => {
  t = await makeTestApp('exchanges');
  boot = await bootstrapCampaign(t.app, 'Velvet Rope');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Lark');
  const [mine] = await t.db
    .insert(characters)
    .values({
      campaignId: boot.campaignId,
      ownerUserId: player.user.id,
      name: 'Lark',
      sheet: SheetV1Schema.parse({
        v: 1,
        identity: { alias: 'Lark' },
        attributes: { bod: 3, agi: 5, rea: 4, str: 2, wil: 3, log: 3, int: 4, cha: 3, edg: { max: 3, current: 3 }, ess: 6 },
        skills: [{ id: 'pistols', rating: 4, attr: 'agi' }],
        weapons: [{ name: 'Hold-out', skillId: 'pistols', acc: 6, dv: '8P', ap: -1, modes: ['SA'] }],
      }),
    })
    .returning();
  const enc = await gm('POST', `/api/campaigns/${boot.campaignId}/encounters`, { name: 'Club door', state: 'live' });
  encounterId = enc['encounter'].id as string;
  const npc = await gm('POST', `/api/encounters/${encounterId}/combatants`, {
    source: 'manual',
    name: 'Bouncer',
    initScore: 9,
    visibility: 'public',
    monitors,
    sheet: SheetV1Schema.parse({
      v: 1,
      identity: { alias: 'Bouncer' },
      attributes: { bod: 5, agi: 3, rea: 3, str: 5, wil: 3, log: 2, int: 3, cha: 2, edg: { max: 1, current: 1 }, ess: 6 },
      armor: [{ name: 'armor jacket', rating: 9, worn: true }],
    }),
  });
  bouncer = npc['combatant'].id as string;
  const pc = await gm('POST', `/api/encounters/${encounterId}/combatants`, {
    source: 'character',
    sourceId: mine!.id,
    name: 'Lark',
    initScore: 12,
    visibility: 'public',
    monitors,
  });
  lark = pc['combatant'].id as string;
}, 120_000);

afterAll(async () => {
  await t.close();
}, 60_000);

describe('exchanges over the API', () => {
  it('tabletop attack → defense → soak → apply, once, undoable; the player sees only their side', async () => {
    const opened = await gm('POST', '/api/exchanges', {
      target: { kind: 'combatant', id: bouncer },
      attacker: { kind: 'combatant', id: lark },
      hits: 4,
      dv: { value: 8, type: 'P' },
      ap: -1,
    });
    const id = opened['exchange'].id as string;
    expect(opened['exchange']).toMatchObject({ state: 'awaiting_defense', attackRollId: null, attackHits: 4 });

    const defended = await gm('POST', '/api/cards/settle', {
      actor: { kind: 'combatant', id: bouncer },
      actionId: 'defense',
      exchangeId: id,
      settle: { hits: 1, glitch: 'none' },
    });
    expect(defended['exchange']).toMatchObject({
      outcome: 'hit',
      netHits: 3,
      state: 'awaiting_soak',
      damage: { modifiedDv: 11, armor: 9, modifiedArmor: 8, type: 'P' },
    });

    const soaked = await gm('POST', '/api/cards/settle', {
      actor: { kind: 'combatant', id: bouncer },
      actionId: 'soak',
      exchangeId: id,
      settle: { hits: 3, glitch: 'none' },
    });
    expect(soaked['exchange']).toMatchObject({ boxes: 8, track: 'physical', state: 'awaiting_apply' });

    const gmView = await gm('GET', `/api/encounters/${encounterId}`);
    expect((gmView['exchanges'] as Exchange[]).map((x) => x.id)).toContain(id);
    const theirs = (await as(player.token, 'GET', `/api/encounters/${encounterId}`))['exchanges'] as Exchange[];
    const copy = theirs.find((x) => x.id === id)!;
    expect(copy).toMatchObject({ outcome: 'hit', attackHits: 4 });
    // netHits would give away the NPC's defense hits.
    for (const k of ['defense', 'damage', 'soak', 'boxes', 'netHits']) expect(copy).not.toHaveProperty(k);

    const applied = await gm('POST', `/api/exchanges/${id}/apply`, {});
    expect(applied['exchange']).toMatchObject({ state: 'done', boxes: 8 });
    const again = await gm('POST', `/api/exchanges/${id}/apply`, {});
    expect(again['exchange'].appliedAt).toBe(applied['exchange'].appliedAt);
    expect(await physical()).toBe(8);

    const undone = await gm('POST', `/api/exchanges/${id}/undo`, {});
    expect(undone['exchange']).toMatchObject({ state: 'awaiting_apply' });
    expect(undone['exchange'].appliedAt).toBeUndefined();
    expect(await physical()).toBe(0);

    await gm('POST', `/api/exchanges/${id}/cancel`, {});
    expect((await call('POST', `/api/exchanges/${id}/apply`, boot.gmToken, {})).statusCode).toBe(409);
  });

  it("a player's attack opens one; a 0-0 defense misses; a new Combat Turn closes what is open", async () => {
    const shot = await as(player.token, 'POST', '/api/cards/settle', {
      actor: { kind: 'combatant', id: lark },
      actionId: 'fire_sa',
      weapon: 'Hold-out',
      target: { kind: 'combatant', id: bouncer },
      settle: { hits: 0, glitch: 'none' },
    });
    const x = shot['exchange'] as Exchange;
    expect(x).toMatchObject({ attackHits: 0, state: 'awaiting_defense', declared: { dv: { value: 8, type: 'P' }, ap: -1 } });

    const missed = await gm('POST', '/api/cards/settle', {
      actor: { kind: 'combatant', id: bouncer },
      actionId: 'defense',
      exchangeId: x.id,
      settle: { hits: 0, glitch: 'none' },
    });
    expect(missed['exchange']).toMatchObject({ outcome: 'miss', state: 'done' });

    const open = await gm('POST', '/api/exchanges', {
      target: { kind: 'combatant', id: lark },
      attackerName: 'Sniper on the roof',
      hits: 2,
      dv: { value: 6, type: 'P' },
    });
    await gm('POST', `/api/encounters/${encounterId}/new-turn`, { roll: false });
    const after = await gm('GET', `/api/exchanges/${open['exchange'].id}`);
    expect(after['exchange'].state).toBe('cancelled');
  });

  it("a player's defense card does not name a hidden attacker", async () => {
    const sniper = await gm('POST', `/api/encounters/${encounterId}/combatants`, {
      source: 'manual',
      name: 'Sniper',
      visibility: 'gm',
      monitors,
    });
    const opened = await gm('POST', '/api/exchanges', {
      target: { kind: 'combatant', id: lark },
      attacker: { kind: 'combatant', id: sniper['combatant'].id },
      hits: 3,
      dv: { value: 6, type: 'P' },
    });
    const card = await as(player.token, 'POST', '/api/cards/preview', {
      actor: { kind: 'combatant', id: lark },
      actionId: 'defense',
      exchangeId: opened['exchange'].id,
    });
    expect(JSON.stringify(card)).not.toContain('Sniper');
  });
});
