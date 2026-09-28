/**
 * The fight is the map: staging takes every fighting token, a token placed
 * joins the scene's fight (late entry mid-turn, p.160), a deleted token leaves
 * a prep fight but not a live one, a row is public exactly while the table has
 * its token, and a prep fight is the GM's alone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { characters } from '@safehouse/db';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type JoinResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let sceneId: string;
let templateId: string;
let fightId: string;

type Row = { id: string; name: string; tokenId?: string; initBase: number; initScore: number; source: string; copilot?: Record<string, any> };

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}
async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: unknown) {
  return t.app.inject({ method, url, headers: auth(token), ...(payload !== undefined ? { payload: payload as object } : {}) });
}
async function gm<T = Record<string, any>>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<T> {
  const res = await call(method, url, boot.gmToken, payload);
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}
async function place(payload: Record<string, unknown>): Promise<string> {
  return (await gm('POST', `/api/scenes/${sceneId}/tokens`, { x: 3.5, y: 3.5, ...payload }))['token'].id;
}
async function roster(token = boot.gmToken): Promise<Record<string, any>> {
  const res = await call('GET', `/api/encounters/${fightId}`, token);
  expect(res.statusCode).toBe(200);
  return res.json();
}
const rowNamed = (view: Record<string, any>, name: string) => (view['combatants'] as Row[]).find((r) => r.name === name);
async function logTexts(token = boot.gmToken): Promise<string[]> {
  const log = await call('GET', `/api/campaigns/${boot.campaignId}/log?limit=500`, token);
  return (log.json() as { events: { type: string; payload: Record<string, unknown> }[] }).events
    .filter((e) => e.type === 'log.posted')
    .map((e) => String(e.payload['text']));
}

const sheet = (alias: string) => ({
  v: 1,
  identity: { alias },
  attributes: { bod: 6, agi: 3, rea: 4, str: 6, wil: 3, log: 2, int: 3, cha: 2, edg: { max: 2, current: 2 }, ess: 6 },
  skills: [{ id: 'clubs', rating: 4, attr: 'agi' }],
});

beforeAll(async () => {
  t = await makeTestApp('fight-map');
  boot = await bootstrapCampaign(t.app, 'The fight is the map');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  const [mine] = await t.db
    .insert(characters)
    .values({ campaignId: boot.campaignId, ownerUserId: player.user.id, name: 'Static', sheet: sheet('Static') })
    .returning();
  sceneId = (await gm('POST', `/api/campaigns/${boot.campaignId}/scenes`, { name: 'Dockside' }))['scene'].id;
  await gm('POST', `/api/scenes/${sceneId}/activate`, {});
  templateId = (await gm('POST', `/api/campaigns/${boot.campaignId}/npc-templates`, { name: 'Dock bruiser', statblock: sheet('Dock bruiser') }))[
    'template'
  ].id;

  // The generator's row, in a fight of its own with no scene.
  const builder = (await gm('POST', `/api/campaigns/${boot.campaignId}/encounters`, { name: 'Builder' }))['encounter'].id;
  const merc = (await gm('POST', `/api/encounters/${builder}/combatants`, { name: 'Merc', sheet: sheet('Merc') }))['combatant'];

  await place({ source: 'character', sourceId: mine!.id });
  await place({ source: 'npc_template', sourceId: templateId, name: 'Bruiser', level: 1 });
  await place({ source: 'combatant', sourceId: merc.id, name: 'Merc' });
  await place({ source: 'prop', name: 'Crate' });
  await place({ source: 'prop', name: 'Turret', combatant: true, hidden: true });
}, 180_000);

afterAll(async () => {
  await t.close();
});

describe('staging a fight from the map', () => {
  it('takes every fighting token on every floor; a prop only when flagged', async () => {
    fightId = (await gm('POST', `/api/scenes/${sceneId}/stage-encounter`, { name: 'Dock fight' }))['encounterId'];
    const view = await roster();
    expect((view['combatants'] as Row[]).map((r) => r.name).sort()).toEqual(['Bruiser', 'Merc', 'Static', 'Turret']);
    // The generator's body is copied in: its sheet and line, not a blank row.
    const merc = rowNamed(view, 'Merc')!;
    expect(merc.initBase).toBe(7);
    expect(merc.copilot?.['sheet']).toBeDefined();
  });
});

describe('a token placed on a live fight’s scene', () => {
  let lateId: string;
  let lateToken: string;

  it('joins mid-turn with no score, and the roll the GM enters loses 10 per pass gone (p.160)', async () => {
    await gm('POST', `/api/encounters/${fightId}/new-turn`, {});
    await gm('PATCH', `/api/encounters/${fightId}`, { pass: 2 });
    lateToken = await place({ source: 'npc_template', sourceId: templateId, name: 'Late ganger' });

    const row = rowNamed(await roster(), 'Late ganger')!;
    lateId = row.id;
    expect(row.initScore).toBe(0);
    expect(row.copilot?.['lateEntry']).toEqual({ turn: 1, passesGone: 1 });
    expect(await logTexts()).toContain('Late ganger joins Dock fight mid-turn: roll Initiative, −10 for 1 pass gone (p.160)');

    const set = await gm('POST', `/api/combatants/${lateId}/initiative`, { rolled: 6 });
    expect(set['combatant'].initScore).toBe(7 + 6 - 10);
    expect(set['combatant'].copilot['lateEntry']).toBeUndefined();
  });

  it('stays in the live fight when its token is deleted: no token, damage and exchanges kept', async () => {
    await gm('POST', `/api/encounters/${fightId}/damage`, { targetId: lateId, boxes: 3, track: 'physical' });
    const opened = await gm('POST', '/api/exchanges', { target: { kind: 'combatant', id: lateId }, hits: 2, dv: { value: 6, type: 'P' } });
    await gm('DELETE', `/api/tokens/${lateToken}`);

    const row = rowNamed(await roster(), 'Late ganger') as Record<string, any>;
    expect(row).toMatchObject({ tokenId: null, tokenRemoved: true });
    expect(row['monitors'].physical.filled).toBe(3);
    expect((await gm('GET', `/api/exchanges/${opened['exchange'].id}`))['exchange'].state).toBe('awaiting_defense');
    expect(await logTexts()).toContain('Late ganger: token removed, still in Dock fight');

    // A token linked by hand is a token again.
    const standIn = await place({ source: 'prop', name: 'Stand-in' });
    const linked = await gm('PATCH', `/api/combatants/${lateId}`, { tokenId: standIn });
    expect(linked['combatant'].tokenRemoved).toBeUndefined();
  });
});

describe('a row follows its token onto and off the table', () => {
  it('drops off the table’s roster with its token, and the table hears "GM’s turn" while it acts', async () => {
    const before = await roster(player.token);
    expect(rowNamed(before, 'Bruiser')).toBeDefined();
    expect(rowNamed(before, 'Turret')).toBeUndefined();

    const bruiser = rowNamed(await roster(), 'Bruiser')!;
    await gm('POST', `/api/combatants/${bruiser.id}/initiative`, { score: 40 });
    await gm('PATCH', `/api/tokens/${bruiser.tokenId}`, { hidden: true });

    const after = await roster(player.token);
    expect(rowNamed(after, 'Bruiser')).toBeUndefined();
    expect(after['activeCombatantId']).toBeNull();
    expect(after['gmTurn']).toBe(true);
    expect(JSON.stringify(after)).not.toContain(bruiser.id);

    // The public frame the hide sent says the same.
    const log = await call('GET', `/api/campaigns/${boot.campaignId}/log?limit=50`, player.token);
    const frame = (log.json() as { events: { type: string; payload: Record<string, any> }[] }).events.find(
      (e) => e.type === 'encounter.updated' && e.payload['encounterId'] === fightId,
    );
    expect(frame?.payload['gmTurn']).toBe(true);
    expect(JSON.stringify(frame)).not.toContain('Bruiser');
  });
});

describe('a prep fight is the GM’s', () => {
  it('never reaches a phone or the TV, and a deleted token takes its row with it', async () => {
    const tv = await joinAs(t.app, boot.campaignId, boot.gmToken, 'display', 'Table TV');
    const back = (await gm('POST', `/api/campaigns/${boot.campaignId}/scenes`, { name: 'Back lot' }))['scene'].id;
    await gm('POST', `/api/scenes/${back}/activate`, {});
    await gm('POST', `/api/scenes/${back}/tokens`, { source: 'npc_template', sourceId: templateId, name: 'Heavy', x: 2.5, y: 2.5 });
    const prep = (await gm('POST', `/api/scenes/${back}/stage-encounter`, { name: 'Back lot job' }))['encounterId'];
    const extra = (await gm('POST', `/api/scenes/${back}/tokens`, { source: 'npc_template', sourceId: templateId, name: 'Spotter', x: 4.5, y: 4.5 }))['token'].id;
    expect(rowNamed(await gm('GET', `/api/encounters/${prep}`), 'Spotter')).toBeDefined();

    for (const token of [player.token, tv.token]) {
      const list = (await call('GET', `/api/campaigns/${boot.campaignId}/encounters`, token)).json() as { encounters: { id: string }[] };
      expect(list.encounters.map((e) => e.id)).toEqual([fightId]);
      expect((await call('GET', `/api/encounters/${prep}`, token)).statusCode).toBe(404);
    }

    await gm('DELETE', `/api/tokens/${extra}`);
    expect(rowNamed(await gm('GET', `/api/encounters/${prep}`), 'Spotter')).toBeUndefined();
    expect(await logTexts()).toContain('Spotter leaves Back lot job: token removed');
    for (const token of [player.token, tv.token]) {
      const log = await call('GET', `/api/campaigns/${boot.campaignId}/log?limit=500`, token);
      expect(log.body).not.toContain('Back lot job');
      expect(log.body).not.toContain(prep);
    }
  });
});
