/** Guided initiative: call, recipes, entries from anyone, NPCs in one go, start with blanks. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { characters } from '@safehouse/db';
import { bootstrapCampaign, joinAs, makeTestApp, type BootstrapResult, type JoinResult, type TestApp } from './core-helpers.js';

let t: TestApp;
let boot: BootstrapResult;
let player: JoinResult;
let fightId: string;
const ids: Record<string, string> = {};

type Row = { id: string; initScore: number; copilot?: Record<string, unknown> };
type Recipe = {
  combatantId: string;
  base: number;
  dice: number;
  baseLines: Array<{ label: string; value: number; ref?: { page: number } }>;
  diceLines: Array<{ label: string; value: number }>;
  entry?: { via: string; by: string; score: number };
};

async function call(method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown) {
  const headers = { authorization: `Bearer ${token}` };
  return t.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
}
async function gm<T = Record<string, any>>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown): Promise<T> {
  const res = await call(method, url, boot.gmToken, payload);
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
}
const view = () => gm('GET', `/api/encounters/${fightId}`);
const scoreOf = async (id: string) => ((await view())['combatants'] as Row[]).find((c) => c.id === id)!.initScore;

const wired = {
  name: 'Wired Reflexes 1',
  essence: 2,
  ref: { book: 'SR5', page: 455 },
  mods: [
    { id: 'wr.rea', source: { kind: 'cyberware' }, target: 'attr.rea', op: 'add', value: 1, active: true, note: 'Wired Reflexes' },
    { id: 'wr.dice', source: { kind: 'cyberware' }, target: 'initiative.dice', op: 'add', value: 1, active: true, note: 'Wired Reflexes' },
  ],
};
const sheet = (alias: string, augments: unknown[] = []) => ({
  v: 1,
  identity: { alias },
  attributes: { bod: 4, agi: 4, rea: 5, str: 3, wil: 4, log: 3, int: 4, cha: 3, edg: { max: 3, current: 3 }, ess: 6 },
  augments,
});

beforeAll(async () => {
  t = await makeTestApp('initiative-call');
  boot = await bootstrapCampaign(t.app, 'Guided Initiative');
  player = await joinAs(t.app, boot.campaignId, boot.gmToken, 'player', 'Static');
  const [mine] = await t.db
    .insert(characters)
    .values({ campaignId: boot.campaignId, ownerUserId: player.user.id, name: 'Static', sheet: sheet('Static', [wired]) })
    .returning();
  const [theirs] = await t.db.insert(characters).values({ campaignId: boot.campaignId, name: 'Wraith', sheet: sheet('Wraith') }).returning();
  const scene = await gm('POST', `/api/campaigns/${boot.campaignId}/scenes`, { name: 'Loading dock' });
  const sceneId = scene['scene'].id as string;
  await gm('POST', `/api/scenes/${sceneId}/activate`, {});
  for (const c of [mine!, theirs!]) {
    await gm('POST', `/api/scenes/${sceneId}/tokens`, { source: 'character', sourceId: c.id, name: c.name, x: 1, y: 1 });
  }
  fightId = (await gm('POST', `/api/scenes/${sceneId}/stage-encounter`, { name: 'Dock fight' }))['encounterId'];
  for (const r of (await view())['combatants'] as Array<{ id: string; name: string }>) ids[r.name] = r.id;
  ids['Ganger'] = (await gm('POST', `/api/encounters/${fightId}/combatants`, { name: 'Ganger', initBase: 7, initDice: 1 }))['combatant'].id;
}, 180_000);

afterAll(async () => {
  await t.close();
});

describe('calling for initiative', () => {
  it('starts the fight gathering, blank, with each row’s recipe and its pages', async () => {
    const out = await gm('POST', `/api/encounters/${fightId}/initiative/call`, {});
    expect(out).toMatchObject({ turn: 1, pass: 1, gathering: true });
    const rows = out['rows'] as Recipe[];
    const stat = rows.find((r) => r.combatantId === ids['Static'])!;
    expect(stat).toMatchObject({ base: 10, dice: 2 });
    expect(stat.baseLines.find((l) => l.label === 'Wired Reflexes (REA)')).toMatchObject({ value: 1, ref: { page: 455 } });
    expect(stat.diceLines.find((l) => l.label === 'Wired Reflexes')?.value).toBe(1);
    expect(rows.find((r) => r.combatantId === ids['Ganger'])).toMatchObject({ base: 7, dice: 1 });

    const v = await view();
    expect(v['encounter']).toMatchObject({ state: 'live', gathering: true });
    expect((v['combatants'] as Row[]).every((c) => c.initScore === 0)).toBe(true);
    // A second call while gathering changes nothing.
    expect(await gm('POST', `/api/encounters/${fightId}/initiative/call`, {})).toMatchObject({ turn: 1, gathering: true });

    const mine = (await call('GET', `/api/encounters/${fightId}/initiative`, player.token)).json() as { rows: Recipe[] };
    expect(mine.rows.map((r) => r.combatantId)).toEqual([ids['Static']]);
  });

  it('takes scores from the GM for anyone and a player for their own, and nobody is up yet', async () => {
    const own = await call('POST', `/api/combatants/${ids['Static']}/initiative/enter`, player.token, { rolled: 7 });
    expect((own.json() as { recipe: Recipe }).recipe.entry).toMatchObject({ via: 'dice', by: 'player', score: 17 });
    expect((await call('POST', `/api/combatants/${ids['Wraith']}/initiative/enter`, player.token, { rolled: 7 })).statusCode).toBe(403);
    expect((await call('POST', `/api/combatants/${ids['Wraith']}/initiative/enter`, boot.gmToken, { rolled: 3, score: 9 })).statusCode).toBe(400);

    const app = await gm('POST', `/api/combatants/${ids['Wraith']}/initiative/enter`, { app: true });
    expect(app['recipe'].entry).toMatchObject({ via: 'app', by: 'gm' });
    expect(app['detail'].rolls).toHaveLength(1);

    const npcs = await gm('POST', `/api/encounters/${fightId}/initiative/roll-npcs`, {});
    expect((npcs['details'] as unknown[]).length).toBe(1);
    expect((await gm('POST', `/api/encounters/${fightId}/initiative/roll-npcs`, {}))['details']).toEqual([]);

    const v = await view();
    expect(v['activeCombatantId']).toBeNull();
    expect(v['turnOrder'][0]).toBe(ids['Static']);
  });

  it('starts with a blank row, which joins late at −10 a pass gone', async () => {
    ids['Lookout'] = (await gm('POST', `/api/encounters/${fightId}/combatants`, { name: 'Lookout', initBase: 12, initDice: 1 }))['combatant'].id;
    const started = await gm('POST', `/api/encounters/${fightId}/initiative/start`, {});
    expect(started['late']).toEqual([ids['Lookout']]);
    expect(started['encounter'].gathering).toBe(false);
    expect(started['activeCombatantId']).toBe(ids['Static']);

    for (let i = 0; i < 6 && (await view())['encounter'].pass < 2; i += 1) {
      await gm('POST', `/api/encounters/${fightId}/advance`, {});
    }
    expect((await view())['encounter'].pass).toBe(2);
    await gm('POST', `/api/combatants/${ids['Lookout']}/initiative/enter`, { rolled: 3 });
    expect(await scoreOf(ids['Lookout']!)).toBe(5); // 12 + 3 − 10
  });

  it('with hand rolls, the turn’s end gathers and the next press starts it', async () => {
    await gm('PATCH', `/api/encounters/${fightId}`, { handRolls: true });
    let step = '';
    for (let i = 0; i < 12 && step !== 'turn'; i += 1) {
      step = (await gm('POST', `/api/encounters/${fightId}/advance`, {}))['step'];
    }
    expect(step).toBe('turn');
    expect((await view())['encounter']).toMatchObject({ turn: 2, gathering: true });
    const next = await gm('POST', `/api/encounters/${fightId}/advance`, { expectedActorId: null });
    expect(next['step']).toBe('start');
    expect((await view())['encounter'].gathering).toBe(false);
  });

  it('counts a sheetless row’s effect once, roll after roll and turn after turn', async () => {
    const row = (await gm('POST', `/api/encounters/${fightId}/combatants`, { name: 'Jazzed', initBase: 6, initDice: 1 }))[
      'combatant'
    ].id as string;
    const jazz = {
      id: 'jazz',
      name: 'Jazz',
      mods: [{ id: 'jazz.dice', source: { kind: 'status' }, target: 'initiative.dice', op: 'add', value: 1, active: true }],
    };
    await gm('PATCH', `/api/combatants/${row}`, { effects: [jazz] });
    for (let i = 0; i < 2; i += 1) await gm('POST', `/api/encounters/${fightId}/roll-initiative`, { combatantIds: [row] });
    await gm('POST', `/api/encounters/${fightId}/new-turn`, { roll: false });
    const rows = (await gm('GET', `/api/encounters/${fightId}/initiative`))['rows'] as Recipe[];
    expect(rows.find((r) => r.combatantId === row)).toMatchObject({ base: 6, dice: 2 });
  });
});
